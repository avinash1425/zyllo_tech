-- =====================================================================
-- 190_hr_reports_analytics.sql — Module 12: HR Reports & Analytics
-- =====================================================================
-- Depends on 100–118 and 120 (base HRMS schema). Uses ONLY base-schema
-- columns, so it applies on top of the parallel module migrations
-- (125, 128, 130, 160, 170, ...) in any order. Numbered 190 so it sorts after
-- them: reports consume data that those modules own and never duplicate it.
--
-- What this migration adds (nothing here stores report data):
--   1. Employee + work-location filters for every existing report, through
--      the shared scope function hr_private.scoped_employees() (same
--      signature, GUC-driven like the company filter added in 116).
--   2. Shared, documented calculation helpers (headcount as of a date,
--      expected working days / attendance). The analytics, the report
--      templates and the exports all call the SAME helpers, so a chart and
--      its table can never disagree.
--   3. public.hr_report_analytics(category, filters): summary cards, chart
--      series + tables and calculation definitions for overview, headcount,
--      attendance, leave, payroll, hiring, attrition and performance.
--   4. public.hr_report(): fixes for gaps confirmed by the HRMS audit
--      (FINAL_REQUIREMENTS_GAP_ANALYSIS.md §4.12 / §5):
--        * attendance_summary / absence / late_arrivals / daily_report_compliance
--          now REFUSE without module access instead of returning zeros/empty;
--        * new_joiners counts joiners who have since left (was an undercount);
--        * recruitment_pipeline honours department, employment type, hiring
--          manager and From, and reports which filters do not apply;
--        * payroll_summary labels each run Final / Provisional and, when an
--          employee filter is set, lists only runs with someone in scope;
--        * new row-level templates: attendance_employee, attendance_daily,
--          attendance_regularizations, upcoming_leave, completed_exits.
--   5. public.hr_report_page(): server-side paging, status filter, totals.
--   6. public.hr_report_export(): the ONLY export path. Enforces
--      reports.export (+ payroll.export for payroll data) on the server,
--      caps the row count and writes an audit event (no row data logged).
--   7. public.hr_my_report_summary(): employee self-service summary.
--
-- Everything is SECURITY INVOKER (caller RLS) except the existing SECURITY
-- DEFINER helpers it reuses. Sections a caller cannot access are returned in
-- `unavailable` with a reason — never as a misleading zero.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Scope: employee + location filters (GUCs, transaction-local)
-- ---------------------------------------------------------------------
create or replace function hr_private.scoped_employees(
  p_all_permission text, p_department uuid default null, p_manager uuid default null,
  p_type text default null, p_status text default null, p_include_former boolean default false)
returns setof public.hr_employees language sql stable security invoker set search_path = '' as $$
  select e.* from public.hr_employees e
  where (p_department is null or e.department_id = p_department)
    and (p_manager is null or e.manager_id = p_manager)
    and (p_type is null or e.employment_type = p_type)
    and (p_status is null or e.status = p_status)
    and (p_include_former or e.status not in ('exited','archived'))
    and (nullif(current_setting('hr.filter_legal_entity', true), '') is null
         or e.legal_entity_id = nullif(current_setting('hr.filter_legal_entity', true), '')::uuid)
    and (nullif(current_setting('hr.filter_employee', true), '') is null
         or e.id = nullif(current_setting('hr.filter_employee', true), '')::uuid)
    and (nullif(current_setting('hr.filter_location', true), '') is null
         or e.work_location_id = nullif(current_setting('hr.filter_location', true), '')::uuid)
    -- Scalar subquery: the caller-level permission is evaluated once per query (InitPlan),
    -- not once per employee row (~1 s saved per 2,000 employees). Same predicate as 116.
    and ((select hr_private.has_permission(p_all_permission)) or hr_private.is_manager_of(e.id))
$$;

create or replace function hr_private.ra_set_filters(p_legal_entity uuid, p_employee uuid, p_location uuid)
returns void language plpgsql volatile set search_path = '' as $$
begin
  perform set_config('hr.filter_legal_entity', coalesce(p_legal_entity::text, ''), true);
  perform set_config('hr.filter_employee', coalesce(p_employee::text, ''), true);
  perform set_config('hr.filter_location', coalesce(p_location::text, ''), true);
end $$;

create or replace function hr_private.ra_clear_filters()
returns void language sql volatile set search_path = '' as $$
  select hr_private.ra_set_filters(null, null, null)
$$;

-- Filter validation shared by every entry point.
create or replace function hr_private.ra_validate(p_from date, p_to date, p_employment_type text)
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_from is null or p_to is null then perform hr_private.fail('Choose a start and an end date.', 'invalid_range'); end if;
  if p_from < date '2000-01-01' or p_to > date '2100-12-31' then perform hr_private.fail('Dates must be between 2000 and 2100.', 'invalid_range'); end if;
  if p_to < p_from then perform hr_private.fail('The end date is before the start date.', 'invalid_range'); end if;
  if p_to - p_from > 366 then perform hr_private.fail('Choose a range of at most one year.', 'range_too_long'); end if;
  if p_employment_type is not null and p_employment_type !~ '^[a-z0-9_]{1,40}$' then
    perform hr_private.fail('Unknown employment type.', 'invalid_filter');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Shared calculation helpers
-- ---------------------------------------------------------------------
-- HEADCOUNT AS OF DATE D (single definition used everywhere in this module):
--   counted  <=> status <> 'onboarding'                      (has not joined)
--            and coalesce(joining_date, D) <= D               (joined on/before D;
--                                                              a missing joining date
--                                                              is reported as a data gap)
--            and (last_working_date is null or last_working_date >= D)
--            and not (status in ('exited','archived') and last_working_date is null)
--                                                             (former records that cannot
--                                                              be placed in time are excluded)
-- Archived records without a last working day are treated as void
-- (duplicates / created in error) and never counted.
create or replace function hr_private.ra_in_headcount(p_status text, p_joined date, p_lwd date, p_on date)
returns boolean language sql immutable set search_path = '' as $$
  select p_status <> 'onboarding'
     and coalesce(p_joined, p_on) <= p_on
     and (p_lwd is null or p_lwd >= p_on)
     and not (p_status in ('exited','archived') and p_lwd is null)
$$;

-- Employees in scope (current AND former) for the caller + filters.
create or replace function hr_private.ra_load_scope(p_all_permission text, p_department uuid, p_manager uuid, p_type text)
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  create temp table if not exists pg_temp.ra_emp (id uuid primary key, employee_code text, name text, status text,
    employment_type text, employment_type_label text, department_id uuid, department text, designation text, location text,
    legal_entity_id uuid, manager_id uuid, joining_date date, last_working_date date) on commit drop;
  truncate pg_temp.ra_emp;
  insert into pg_temp.ra_emp
  select e.id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), e.status,
         e.employment_type, coalesce(t.name, e.employment_type), e.department_id, coalesce(d.name, 'Unassigned'),
         coalesce(g.name, 'Not recorded'), coalesce(l.name, 'Not recorded'), e.legal_entity_id, e.manager_id,
         e.joining_date, e.last_working_date
  from hr_private.scoped_employees(p_all_permission, p_department, p_manager, p_type, null, true) e
  left join public.hr_departments d on d.id = e.department_id
  left join public.hr_designations g on g.id = e.designation_id
  left join public.hr_locations l on l.id = e.work_location_id
  left join public.hr_employment_types t on t.code = e.employment_type
  where not (e.status = 'archived' and e.last_working_date is null);
end $$;

-- The signed-in employee only (self-service).
create or replace function hr_private.ra_load_self()
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  create temp table if not exists pg_temp.ra_emp (id uuid primary key, employee_code text, name text, status text,
    employment_type text, employment_type_label text, department_id uuid, department text, designation text, location text,
    legal_entity_id uuid, manager_id uuid, joining_date date, last_working_date date) on commit drop;
  truncate pg_temp.ra_emp;
  insert into pg_temp.ra_emp
  select e.id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), e.status,
         e.employment_type, e.employment_type, e.department_id, null, null, null, e.legal_entity_id, e.manager_id,
         e.joining_date, e.last_working_date
  from public.hr_employees e where e.id = hr_private.current_employee_id();
end $$;

-- ATTENDANCE (reuses Module 5 data; computes no punch logic of its own).
-- One row per employee per WORKING day in [p_from, min(p_to, yesterday)]:
--   * only days on which the employee was in headcount (joined, not left);
--   * working day = the employee's weekly working days (shift) and not a
--     holiday for their location (hr_private.is_working_day_for);
--   * kind = 'leave'  : approved leave (is_on_approved_leave) or an
--                       attendance row marked on_leave — excluded from the
--                       denominator;
--            'excluded': attendance row marked holiday/weekend — excluded;
--            otherwise the attendance status (present, late, half_day,
--            absent, missing_punch) or 'unrecorded' when no row exists.
-- Approved attendance corrections are already applied to hr_attendance by
-- Module 5 (source = 'correction'), so they are reflected automatically.
-- Today is excluded because the day is not complete yet.
--
-- PERFORMANCE (set-based; measured in the integration rehearsal): calling the
-- per-day helpers (is_working_day_for / is_on_approved_leave) once per
-- employee-day took ~227 s for 2,000 employees × 31 days with Module 5 applied.
-- The same shared definitions are evaluated in bulk instead:
--   * weekly working days: hr_private.employee_working_days(employee), once per employee;
--   * holidays: hr_private.is_holiday(date, employee) once per (work location,
--     legal entity, date) — every version of is_holiday (103, 125, 160) depends
--     only on those two employee attributes — using one representative employee;
--   * approved leave: hr_private.ra_approved_leave_days(), the set form of
--     is_on_approved_leave (same predicate), SECURITY DEFINER like the original
--     so callers without leave access never see leave days as absences.
-- Integration note: Module 5's date-specific shift assignments and n-th-weekday
-- weekly-off rules are applied through employee_working_days (current shift)
-- only; see MODULE_12_INTEGRATION_READINESS.md §3.
create or replace function hr_private.ra_approved_leave_days(p_employees uuid[], p_from date, p_to date)
returns table (employee_id uuid, d date) language sql stable security definer set search_path = '' as $$
  select distinct r.employee_id, g::date
  from public.hr_leave_requests r
  cross join lateral generate_series(greatest(r.start_date, p_from), least(r.end_date, p_to), interval '1 day') g
  where r.employee_id = any (p_employees) and r.status = 'approved' and r.start_date <= p_to and r.end_date >= p_from
$$;
revoke execute on function hr_private.ra_approved_leave_days(uuid[], date, date) from public, anon;

-- Attendance rows for a set of employees and a window. Applies EXACTLY the
-- hr_attendance RLS predicate (hr_private.can_access_employee(employee, 'attendance'))
-- but once per employee instead of once per attendance row, then reads each
-- permitted employee's rows through the (employee_id, work_date) unique index.
-- (Per-row RLS evaluation cost ~45 s on 128k rows in the rehearsal.)
create or replace function hr_private.ra_attendance_rows(p_employees uuid[], p_from date, p_to date)
returns table (id uuid, employee_id uuid, work_date date, status text, worked_minutes int, late_minutes int, overtime_minutes int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if hr_private.has_permission('attendance.view') then
    -- can_access_employee(x, 'attendance') is true for every employee for this caller.
    return query select a.id, a.employee_id, a.work_date, a.status, a.worked_minutes, a.late_minutes, a.overtime_minutes
      from public.hr_attendance a where a.employee_id = any (p_employees) and a.work_date between p_from and p_to;
  else
    return query select a.id, a.employee_id, a.work_date, a.status, a.worked_minutes, a.late_minutes, a.overtime_minutes
      from (select x from unnest(p_employees) x where hr_private.can_access_employee(x, 'attendance')) ok
      join public.hr_attendance a on a.employee_id = ok.x and a.work_date between p_from and p_to;
  end if;
end $$;
revoke execute on function hr_private.ra_attendance_rows(uuid[], date, date) from public, anon;

create or replace function hr_private.ra_load_attendance(p_from date, p_to date)
returns void language plpgsql volatile security invoker set search_path = '' as $$
declare v_end date := least(p_to, hr_private.business_today() - 1);
begin
  create temp table if not exists pg_temp.ra_att (employee_id uuid, d date, kind text, worked_minutes int, late_minutes int,
    overtime_minutes int, primary key (employee_id, d)) on commit drop;
  truncate pg_temp.ra_att;
  if v_end < p_from then return; end if;

  create temp table if not exists pg_temp.ra_att_emp (id uuid primary key, loc uuid, le uuid, wd smallint[], status text,
    joining_date date, last_working_date date) on commit drop;
  truncate pg_temp.ra_att_emp;
  insert into pg_temp.ra_att_emp
  select e.id, x.work_location_id, x.legal_entity_id, hr_private.employee_working_days(e.id), e.status, e.joining_date, e.last_working_date
  from pg_temp.ra_emp e join public.hr_employees x on x.id = e.id;

  create temp table if not exists pg_temp.ra_att_hol (loc uuid, le uuid, d date) on commit drop;
  truncate pg_temp.ra_att_hol;
  insert into pg_temp.ra_att_hol
  select g.loc, g.le, s::date
  from (select loc, le, min(id::text)::uuid rep from pg_temp.ra_att_emp group by loc, le) g
  cross join generate_series(p_from, v_end, interval '1 day') s
  where hr_private.is_holiday(s::date, g.rep);

  create temp table if not exists pg_temp.ra_att_leave (employee_id uuid, d date, primary key (employee_id, d)) on commit drop;
  truncate pg_temp.ra_att_leave;
  insert into pg_temp.ra_att_leave
  select * from hr_private.ra_approved_leave_days((select array_agg(id) from pg_temp.ra_att_emp), p_from, v_end);

  create temp table if not exists pg_temp.ra_att_rows (id uuid, employee_id uuid, work_date date, status text, worked_minutes int,
    late_minutes int, overtime_minutes int, primary key (employee_id, work_date)) on commit drop;
  truncate pg_temp.ra_att_rows;
  insert into pg_temp.ra_att_rows
  select * from hr_private.ra_attendance_rows((select array_agg(id) from pg_temp.ra_att_emp), p_from, v_end);

  insert into pg_temp.ra_att
  select e.id, s.d,
         case when a.status in ('holiday','weekend') then 'excluded'
              when a.status = 'on_leave' or l.d is not null then 'leave'
              when a.id is null then 'unrecorded'
              else a.status end,
         a.worked_minutes, coalesce(a.late_minutes, 0), coalesce(a.overtime_minutes, 0)
  from pg_temp.ra_att_emp e
  cross join lateral generate_series(greatest(p_from, coalesce(e.joining_date, p_from)),
                                     least(v_end, coalesce(e.last_working_date, v_end)), interval '1 day') g(x)
  cross join lateral (select g.x::date d) s
  left join pg_temp.ra_att_hol h on h.d = s.d and h.loc is not distinct from e.loc and h.le is not distinct from e.le
  left join pg_temp.ra_att_leave l on l.employee_id = e.id and l.d = s.d
  left join pg_temp.ra_att_rows a on a.employee_id = e.id and a.work_date = s.d
  where hr_private.ra_in_headcount(e.status, e.joining_date, e.last_working_date, s.d)
    and extract(isodow from s.d)::smallint = any (e.wd)
    and h.d is null;
end $$;

-- ATTENDANCE % (documented formula):
--   expected = working days - leave days - excluded days
--   attended = present + late + missing_punch + 0.5 × half_day
--              (a missing punch has a check-in, so the day was attended)
--   absent   = absent + unrecorded + 0.5 × half_day
--   attendance % = attended / expected × 100   (null when expected = 0)
create or replace function hr_private.ra_att_metrics(p_kinds text[])
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'expected', e, 'attended', a, 'absent', b,
    'pct', case when e = 0 then null else round(100.0 * a / e, 1) end)
  from (select count(*) filter (where k not in ('leave','excluded')) e,
               count(*) filter (where k in ('present','late','missing_punch')) + 0.5 * count(*) filter (where k = 'half_day') a,
               count(*) filter (where k in ('absent','unrecorded')) + 0.5 * count(*) filter (where k = 'half_day') b
        from unnest(p_kinds) k) x
$$;

-- Section / card builders.
create or replace function hr_private.ra_card(p_key text, p_label text, p_value numeric, p_format text, p_hint text default null)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('key', p_key, 'label', p_label, 'value', p_value, 'format', p_format, 'hint', p_hint)
$$;
create or replace function hr_private.ra_section(p_key text, p_title text, p_chart jsonb, p_columns jsonb, p_rows jsonb, p_note text default null)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('key', p_key, 'title', p_title, 'chart', p_chart, 'columns', p_columns,
                            'rows', coalesce(p_rows, '[]'::jsonb), 'note', p_note)
$$;
create or replace function hr_private.ra_def(p_metric text, p_formula text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('metric', p_metric, 'formula', p_formula)
$$;
create or replace function hr_private.ra_unavailable(p_reason text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('cards', '[]'::jsonb, 'sections', '[]'::jsonb, 'definitions', '[]'::jsonb, 'unavailable', p_reason)
$$;

-- Months touched by [p_from, p_to] with the clipped start/end of each.
create or replace function hr_private.ra_months(p_from date, p_to date)
returns table (month text, ms date, me date) language sql immutable set search_path = '' as $$
  select to_char(m, 'YYYY-MM'), greatest(m::date, p_from), least((m + interval '1 month' - interval '1 day')::date, p_to)
  from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
$$;

-- Exit category from the latest non-withdrawn exit case (Module 4).
create or replace function hr_private.ra_exit_category(p_exit_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_exit_type when 'resignation' then 'Voluntary (resignation)' when 'termination' then 'Involuntary (termination)'
    when 'retirement' then 'Retirement' when 'contract_end' then 'Contract end' when 'other' then 'Other' else 'Not recorded' end
$$;

-- ---------------------------------------------------------------------
-- 3. Category analytics (each returns {cards, sections, definitions, unavailable})
-- ---------------------------------------------------------------------

-- HEADCOUNT (source: Employee Management, hr_employees)
create or replace function hr_private.ra_headcount(p_from date, p_to date, p_detail boolean)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_asof date := least(p_to, hr_private.business_today());
  c record; v_sections jsonb := '[]'::jsonb; v_rows jsonb;
begin
  select count(*) filter (where hr_private.ra_in_headcount(status, joining_date, last_working_date, v_asof)) total,
         count(*) filter (where hr_private.ra_in_headcount(status, joining_date, last_working_date, v_asof) and status in ('active','probation','notice_period')) active,
         count(*) filter (where hr_private.ra_in_headcount(status, joining_date, last_working_date, v_asof) and status = 'suspended') suspended,
         count(*) filter (where status = 'onboarding') onboarding,
         count(*) filter (where joining_date between p_from and p_to and status <> 'onboarding') joiners,
         count(*) filter (where status in ('exited','archived') and last_working_date between p_from and p_to) exits,
         count(*) filter (where status in ('exited','archived')) former,
         count(*) filter (where joining_date is null and status not in ('exited','archived','onboarding')) no_joining
    into c from pg_temp.ra_emp;

  if p_detail then
    -- Department-wise
    select jsonb_agg(jsonb_build_object('department', department, 'headcount', hc, 'active', act, 'joiners', j, 'exits', x) order by hc desc, department) into v_rows
      from (select department,
                   count(*) filter (where hr_private.ra_in_headcount(status, joining_date, last_working_date, v_asof)) hc,
                   count(*) filter (where hr_private.ra_in_headcount(status, joining_date, last_working_date, v_asof) and status in ('active','probation','notice_period')) act,
                   count(*) filter (where joining_date between p_from and p_to and status <> 'onboarding') j,
                   count(*) filter (where status in ('exited','archived') and last_working_date between p_from and p_to) x
            from pg_temp.ra_emp group by department) s where hc + j + x > 0;
    v_sections := v_sections || hr_private.ra_section('by_department', 'Department-wise headcount',
      '{"type":"bar","x":"department","y":["headcount"]}',
      '[{"key":"department","label":"Department","type":"text"},{"key":"headcount","label":"Headcount","type":"int","total":true},{"key":"active","label":"Active","type":"int","total":true},{"key":"joiners","label":"Joiners in period","type":"int","total":true},{"key":"exits","label":"Exits in period","type":"int","total":true}]',
      v_rows);
    -- Designation-wise
    select jsonb_agg(jsonb_build_object('designation', designation, 'headcount', n) order by n desc, designation) into v_rows
      from (select designation, count(*) n from pg_temp.ra_emp
            where hr_private.ra_in_headcount(status, joining_date, last_working_date, v_asof) group by 1) s;
    v_sections := v_sections || hr_private.ra_section('by_designation', 'Designation-wise headcount',
      '{"type":"bar","x":"designation","y":["headcount"]}',
      '[{"key":"designation","label":"Designation","type":"text"},{"key":"headcount","label":"Headcount","type":"int","total":true}]', v_rows);
    -- Employment type
    select jsonb_agg(jsonb_build_object('employment_type', employment_type_label, 'headcount', n,
             'pct', round(100.0 * n / nullif(c.total, 0), 1)) order by n desc) into v_rows
      from (select employment_type_label, count(*) n from pg_temp.ra_emp
            where hr_private.ra_in_headcount(status, joining_date, last_working_date, v_asof) group by 1) s;
    v_sections := v_sections || hr_private.ra_section('by_employment_type', 'Employment type breakdown',
      '{"type":"pie","x":"employment_type","y":["headcount"]}',
      '[{"key":"employment_type","label":"Employment type","type":"text"},{"key":"headcount","label":"Headcount","type":"int","total":true},{"key":"pct","label":"% of headcount","type":"pct"}]', v_rows);
    -- Monthly trend (headcount at month end, or at the as-of date for the current month)
    select jsonb_agg(jsonb_build_object('month', m.month, 'as_of', least(m.me, v_asof), 'headcount', t.hc, 'joiners', t.j, 'exits', t.x) order by m.ms) into v_rows
      from hr_private.ra_months(p_from, p_to) m
      cross join lateral (select count(*) filter (where hr_private.ra_in_headcount(status, joining_date, last_working_date, least(m.me, v_asof))) hc,
                                 count(*) filter (where joining_date between m.ms and m.me and status <> 'onboarding') j,
                                 count(*) filter (where status in ('exited','archived') and last_working_date between m.ms and m.me) x
                          from pg_temp.ra_emp) t
      where m.ms <= v_asof;
    v_sections := v_sections || hr_private.ra_section('trend', 'Monthly headcount trend',
      '{"type":"line","x":"month","y":["headcount","joiners","exits"]}',
      '[{"key":"month","label":"Month","type":"text"},{"key":"as_of","label":"Headcount as of","type":"date"},{"key":"headcount","label":"Headcount","type":"int"},{"key":"joiners","label":"Joiners","type":"int","total":true},{"key":"exits","label":"Exits","type":"int","total":true}]', v_rows);
  end if;

  return jsonb_build_object(
    'cards', jsonb_build_array(
      hr_private.ra_card('total_employees', 'Total employees', c.total, 'int', 'Headcount as of ' || to_char(v_asof, 'DD Mon YYYY')),
      hr_private.ra_card('active_employees', 'Active employees', c.active, 'int', 'Active, probation or notice period'),
      hr_private.ra_card('inactive_employees', 'Inactive (suspended)', c.suspended, 'int', 'Employed but suspended'),
      hr_private.ra_card('new_joiners', 'New joiners', c.joiners, 'int', 'Joined in the period (includes those who later left)'),
      hr_private.ra_card('exits', 'Employee exits', c.exits, 'int', 'Last working day in the period'),
      hr_private.ra_card('onboarding', 'Joining pending', c.onboarding, 'int', 'Onboarding records, not yet in headcount'),
      hr_private.ra_card('former', 'Former employees', c.former, 'int', 'All exited records in scope'),
      hr_private.ra_card('missing_joining_date', 'Missing joining date', c.no_joining, 'int', 'Data gap: counted in headcount for every date')),
    'sections', v_sections,
    'definitions', jsonb_build_array(
      hr_private.ra_def('Headcount as of a date', 'Employees who have joined on or before the date (status not onboarding) and whose last working day is not before it. Exited/archived records without a last working day are excluded.'),
      hr_private.ra_def('As-of date', 'The report end date, or today if the end date is in the future.'),
      hr_private.ra_def('Active / inactive', 'Uses the employee''s current status: active = active, probation or notice period; inactive = suspended.'),
      hr_private.ra_def('New joiners', 'Joining date within the period, including employees who have since left.'),
      hr_private.ra_def('Exits', 'Exited or archived employees whose last working day is within the period.')),
    'unavailable', null);
end $$;

-- ATTENDANCE (source: Module 5 Attendance & Time)
create or replace function hr_private.ra_attendance(p_from date, p_to date, p_detail boolean)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_from date := greatest(p_from, p_to - 92);          -- at most 93 days of day-level calculation
  v_end date := least(p_to, hr_private.business_today() - 1);
  m jsonb; c record; v_sections jsonb := '[]'::jsonb; v_rows jsonb; v_note text;
begin
  if hr_private.has_permission('attendance.view') then
    null;
  elsif hr_private.has_permission('attendance.view_team') then
    -- Rows the caller cannot read would look like absences: restrict to the team.
    delete from pg_temp.ra_emp e where not hr_private.is_manager_of(e.id);
  else
    return hr_private.ra_unavailable('Attendance reports need attendance access (attendance.view or attendance.view_team).');
  end if;
  perform hr_private.ra_load_attendance(v_from, p_to);
  v_note := 'Attendance window: ' || to_char(v_from, 'DD Mon YYYY') || ' – ' || to_char(greatest(least(v_end, p_to), v_from), 'DD Mon YYYY')
            || case when v_from > p_from then ' (day-level attendance is limited to the last 93 days of the range)' else '' end
            || '. Today is excluded until the day is complete.';

  m := hr_private.ra_att_metrics(coalesce((select array_agg(kind) from pg_temp.ra_att), '{}'));
  select count(*) filter (where kind = 'late') late, count(*) filter (where kind = 'leave') leave_days,
         count(*) filter (where kind = 'missing_punch') missing, coalesce(sum(worked_minutes), 0) worked,
         coalesce(sum(overtime_minutes), 0) ot
    into c from pg_temp.ra_att;

  if p_detail then
    -- Daily
    select jsonb_agg(jsonb_build_object('date', d, 'expected', (x ->> 'expected')::numeric, 'attended', (x ->> 'attended')::numeric,
             'absent', (x ->> 'absent')::numeric, 'late', l, 'on_leave', lv, 'pct', (x ->> 'pct')::numeric) order by d) into v_rows
      from (select d, hr_private.ra_att_metrics(array_agg(kind)) x, count(*) filter (where kind = 'late') l, count(*) filter (where kind = 'leave') lv
            from pg_temp.ra_att group by d) s;
    v_sections := v_sections || hr_private.ra_section('daily', 'Daily attendance',
      '{"type":"line","x":"date","y":["pct"]}',
      '[{"key":"date","label":"Date","type":"date"},{"key":"expected","label":"Expected","type":"int","total":true},{"key":"attended","label":"Attended","type":"num","total":true},{"key":"absent","label":"Absent","type":"num","total":true},{"key":"late","label":"Late","type":"int","total":true},{"key":"on_leave","label":"On leave","type":"int","total":true},{"key":"pct","label":"Attendance %","type":"pct"}]',
      v_rows, v_note);
    -- Monthly
    select jsonb_agg(jsonb_build_object('month', mo, 'expected', (x ->> 'expected')::numeric, 'attended', (x ->> 'attended')::numeric,
             'absent', (x ->> 'absent')::numeric, 'late', l, 'worked_hours', round(w / 60.0, 2), 'pct', (x ->> 'pct')::numeric) order by mo) into v_rows
      from (select to_char(d, 'YYYY-MM') mo, hr_private.ra_att_metrics(array_agg(kind)) x, count(*) filter (where kind = 'late') l,
                   coalesce(sum(worked_minutes), 0) w
            from pg_temp.ra_att group by 1) s;
    v_sections := v_sections || hr_private.ra_section('monthly', 'Monthly attendance',
      '{"type":"bar","x":"month","y":["pct"]}',
      '[{"key":"month","label":"Month","type":"text"},{"key":"expected","label":"Expected days","type":"int","total":true},{"key":"attended","label":"Attended","type":"num","total":true},{"key":"absent","label":"Absent","type":"num","total":true},{"key":"late","label":"Late","type":"int","total":true},{"key":"worked_hours","label":"Worked hours","type":"num","total":true},{"key":"pct","label":"Attendance %","type":"pct"}]',
      v_rows, v_note);
    -- Department-wise
    select jsonb_agg(jsonb_build_object('department', dep, 'employees', n, 'expected', (x ->> 'expected')::numeric, 'attended', (x ->> 'attended')::numeric,
             'absent', (x ->> 'absent')::numeric, 'late', l, 'pct', (x ->> 'pct')::numeric) order by dep) into v_rows
      from (select e.department dep, count(distinct a.employee_id) n, hr_private.ra_att_metrics(array_agg(a.kind)) x, count(*) filter (where a.kind = 'late') l
            from pg_temp.ra_att a join pg_temp.ra_emp e on e.id = a.employee_id group by 1) s;
    v_sections := v_sections || hr_private.ra_section('by_department', 'Department-wise attendance',
      '{"type":"bar","x":"department","y":["pct"]}',
      '[{"key":"department","label":"Department","type":"text"},{"key":"employees","label":"Employees","type":"int","total":true},{"key":"expected","label":"Expected days","type":"int","total":true},{"key":"attended","label":"Attended","type":"num","total":true},{"key":"absent","label":"Absent","type":"num","total":true},{"key":"late","label":"Late","type":"int","total":true},{"key":"pct","label":"Attendance %","type":"pct"}]',
      v_rows, v_note);
    -- Regularizations (attendance corrections requested for days in the window)
    select jsonb_agg(jsonb_build_object('status', s, 'requests', n) order by s) into v_rows
      from (select r.status s, count(*) n from public.hr_attendance_corrections r join pg_temp.ra_emp e on e.id = r.employee_id
            where r.work_date between v_from and p_to group by 1) x;
    v_sections := v_sections || hr_private.ra_section('regularizations', 'Attendance regularizations',
      '{"type":"bar","x":"status","y":["requests"]}',
      '[{"key":"status","label":"Status","type":"text"},{"key":"requests","label":"Requests","type":"int","total":true}]', v_rows,
      'Approved corrections are already applied to the attendance records above.');
  end if;

  return jsonb_build_object(
    'cards', jsonb_build_array(
      hr_private.ra_card('attendance_rate', 'Attendance rate', (m ->> 'pct')::numeric, 'pct', v_note),
      hr_private.ra_card('present_days', 'Attended days', (m ->> 'attended')::numeric, 'num', 'Present + late + missing punch + ½ half days'),
      hr_private.ra_card('absent_days', 'Absent days', (m ->> 'absent')::numeric, 'num', 'Marked absent or no record on a working day'),
      hr_private.ra_card('late_arrivals', 'Late arrivals', c.late, 'int', null),
      hr_private.ra_card('leave_days', 'Leave days', c.leave_days, 'int', 'Excluded from the denominator'),
      hr_private.ra_card('missing_punch', 'Missing punches', c.missing, 'int', null),
      hr_private.ra_card('worked_hours', 'Worked hours', round(c.worked / 60.0, 2), 'num', null),
      hr_private.ra_card('overtime_hours', 'Overtime hours', round(c.ot / 60.0, 2), 'num', null)),
    'sections', v_sections,
    'definitions', jsonb_build_array(
      hr_private.ra_def('Expected working days', 'Days in the window on which the employee was employed, the day is one of their weekly working days, it is not a holiday for their location, and they were not on approved leave. Today is excluded.'),
      hr_private.ra_def('Attended', 'present + late + missing punch + 0.5 × half day (from Module 5 attendance records, including approved corrections).'),
      hr_private.ra_def('Absent', 'marked absent + working days without any attendance record + 0.5 × half day.'),
      hr_private.ra_def('Attendance %', 'Attended ÷ expected working days × 100.'),
      hr_private.ra_def('Window', 'Day-level attendance covers at most the last 93 days of the selected range.')),
    'unavailable', null);
end $$;

-- LEAVE (source: Module 6 Leave Management; balances from hr_leave_balances)
create or replace function hr_private.ra_leave(p_from date, p_to date, p_detail boolean)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_today date := hr_private.business_today();
  v_asof date := least(p_to, hr_private.business_today());
  v_year int := extract(year from p_to)::int;
  c record; bal record; v_sections jsonb := '[]'::jsonb; v_rows jsonb;
begin
  if not hr_private.any_permission(array['leave.view','leave.view_team','leave.manage']) then
    return hr_private.ra_unavailable('Leave reports need leave access (leave.view or leave.view_team).');
  end if;
  create temp table if not exists pg_temp.ra_leave (id uuid primary key, employee_id uuid, leave_type text, start_date date,
    end_date date, days numeric, status text) on commit drop;
  truncate pg_temp.ra_leave;
  insert into pg_temp.ra_leave
  select l.id, l.employee_id, t.name, l.start_date, l.end_date, l.days, l.status
  from public.hr_leave_requests l join pg_temp.ra_emp e on e.id = l.employee_id join public.hr_leave_types t on t.id = l.leave_type_id
  where l.status <> 'draft' and l.start_date <= greatest(p_to, v_today + 30) and l.end_date >= p_from;

  select coalesce(sum(days) filter (where status = 'approved' and start_date between p_from and p_to), 0) approved_days,
         count(*) filter (where status = 'approved' and start_date between p_from and p_to) approved,
         count(*) filter (where status = 'pending_approval' and start_date between p_from and p_to) pending,
         coalesce(sum(days) filter (where status = 'pending_approval' and start_date between p_from and p_to), 0) pending_days,
         count(*) filter (where status = 'rejected' and start_date between p_from and p_to) rejected,
         count(distinct employee_id) filter (where status = 'approved' and v_asof between start_date and end_date) on_leave,
         count(*) filter (where status in ('approved','pending_approval') and start_date between v_today + 1 and v_today + 30) upcoming
    into c from pg_temp.ra_leave;
  select coalesce(sum(b.used), 0) used, coalesce(sum(b.pending), 0) pend, coalesce(sum(b.accrued + b.carried_forward + b.adjusted), 0) credited,
         coalesce(sum(b.available), 0) available
    into bal from public.hr_leave_balances b join pg_temp.ra_emp e on e.id = b.employee_id where b.year = v_year;

  if p_detail then
    select jsonb_agg(jsonb_build_object('leave_type', lt, 'approved_days', ad, 'pending_days', pd, 'rejected', rj,
             'credited', cr, 'used', us, 'available', av, 'utilization_pct', case when cr > 0 then round(100.0 * us / cr, 1) end) order by lt) into v_rows
      from (select t.name lt,
                   coalesce((select sum(days) from pg_temp.ra_leave r where r.leave_type = t.name and r.status = 'approved' and r.start_date between p_from and p_to), 0) ad,
                   coalesce((select sum(days) from pg_temp.ra_leave r where r.leave_type = t.name and r.status = 'pending_approval' and r.start_date between p_from and p_to), 0) pd,
                   (select count(*) from pg_temp.ra_leave r where r.leave_type = t.name and r.status = 'rejected' and r.start_date between p_from and p_to) rj,
                   coalesce(sum(bl.accrued + bl.carried_forward + bl.adjusted), 0) cr, coalesce(sum(bl.used), 0) us, coalesce(sum(bl.available), 0) av
            from public.hr_leave_types t
            left join public.hr_leave_balances bl on bl.leave_type_id = t.id and bl.year = v_year and bl.employee_id in (select id from pg_temp.ra_emp)
            group by t.id, t.name) s
      where ad + pd + rj + cr + us > 0;
    v_sections := v_sections || hr_private.ra_section('by_type', 'Leave type summary',
      '{"type":"bar","x":"leave_type","y":["used","available"]}',
      '[{"key":"leave_type","label":"Leave type","type":"text"},{"key":"approved_days","label":"Approved days (period)","type":"num","total":true},{"key":"pending_days","label":"Pending days (period)","type":"num","total":true},{"key":"rejected","label":"Rejected requests","type":"int","total":true},{"key":"credited","label":"Credited (year)","type":"num","total":true},{"key":"used","label":"Used (year)","type":"num","total":true},{"key":"available","label":"Available (year)","type":"num","total":true},{"key":"utilization_pct","label":"Utilization %","type":"pct"}]',
      v_rows, 'Balances are for ' || v_year || ' (the year of the end date). Pending leave is never counted as used.');
    select jsonb_agg(jsonb_build_object('department', dep, 'approved_days', ad, 'pending', pn, 'employees_on_leave', ol) order by dep) into v_rows
      from (select e.department dep,
                   coalesce(sum(r.days) filter (where r.status = 'approved' and r.start_date between p_from and p_to), 0) ad,
                   count(r.id) filter (where r.status = 'pending_approval' and r.start_date between p_from and p_to) pn,
                   count(distinct r.employee_id) filter (where r.status = 'approved' and v_asof between r.start_date and r.end_date) ol
            from pg_temp.ra_emp e left join pg_temp.ra_leave r on r.employee_id = e.id group by 1) s
      where ad + pn + ol > 0;
    v_sections := v_sections || hr_private.ra_section('by_department', 'Department-wise leave',
      '{"type":"bar","x":"department","y":["approved_days"]}',
      '[{"key":"department","label":"Department","type":"text"},{"key":"approved_days","label":"Approved days","type":"num","total":true},{"key":"pending","label":"Pending requests","type":"int","total":true},{"key":"employees_on_leave","label":"On leave (as of)","type":"int","total":true}]', v_rows);
    select jsonb_agg(jsonb_build_object('month', m.month, 'approved_days', coalesce(t.ad, 0), 'pending_days', coalesce(t.pd, 0), 'rejected', coalesce(t.rj, 0)) order by m.ms) into v_rows
      from hr_private.ra_months(p_from, p_to) m
      left join lateral (select sum(days) filter (where status = 'approved') ad, sum(days) filter (where status = 'pending_approval') pd,
                                count(*) filter (where status = 'rejected') rj
                         from pg_temp.ra_leave r where r.start_date between m.ms and m.me) t on true;
    v_sections := v_sections || hr_private.ra_section('trend', 'Monthly leave trend',
      '{"type":"bar","x":"month","y":["approved_days","pending_days"],"stacked":true}',
      '[{"key":"month","label":"Month","type":"text"},{"key":"approved_days","label":"Approved days","type":"num","total":true},{"key":"pending_days","label":"Pending days","type":"num","total":true},{"key":"rejected","label":"Rejected requests","type":"int","total":true}]',
      v_rows, 'Each request is attributed to the month in which it starts.');
  end if;

  return jsonb_build_object(
    'cards', jsonb_build_array(
      hr_private.ra_card('on_leave', 'Employees on leave', c.on_leave, 'int', 'Approved leave covering ' || to_char(v_asof, 'DD Mon YYYY')),
      hr_private.ra_card('approved_days', 'Approved leave days', c.approved_days, 'num', c.approved || ' approved requests starting in the period'),
      hr_private.ra_card('pending_requests', 'Pending requests', c.pending, 'int', c.pending_days || ' days awaiting approval'),
      hr_private.ra_card('rejected_requests', 'Rejected requests', c.rejected, 'int', null),
      hr_private.ra_card('upcoming_leave', 'Upcoming leave (30 days)', c.upcoming, 'int', 'Approved or pending, starting in the next 30 days'),
      hr_private.ra_card('utilization', 'Leave utilization', case when bal.credited > 0 then round(100.0 * bal.used / bal.credited, 1) end, 'pct', 'Used ÷ credited for ' || v_year)),
    'sections', v_sections,
    'definitions', jsonb_build_array(
      hr_private.ra_def('Approved / pending / rejected', 'Leave requests (drafts excluded) whose start date falls in the period, by current status.'),
      hr_private.ra_def('Employees on leave', 'Distinct employees with approved leave covering the as-of date.'),
      hr_private.ra_def('Leave utilization', 'Used ÷ (accrued + carried forward + adjusted) × 100 from the leave balance ledger for the year of the end date. Pending leave is not counted as used.')),
    'unavailable', null);
end $$;

-- PAYROLL (source: Module 7 Payroll & Salary; never recalculated here)
create or replace function hr_private.ra_payroll(p_from date, p_to date, p_detail boolean)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  c record; v_sections jsonb := '[]'::jsonb; v_rows jsonb; v_currencies text[]; v_multi boolean;
begin
  if not hr_private.has_permission('payroll.view') then
    return hr_private.ra_unavailable('Payroll reports need payroll access (payroll.view).');
  end if;
  create temp table if not exists pg_temp.ra_pay (item_id uuid primary key, run_id uuid, period_start date, period_end date, run_status text,
    final boolean, employee_id uuid, department text, currency text, gross numeric, allowances numeric, deductions numeric,
    employer numeric, reimbursements numeric, net numeric, breakdown jsonb) on commit drop;
  truncate pg_temp.ra_pay;
  insert into pg_temp.ra_pay
  select i.id, r.id, r.period_start, r.period_end, r.status, r.status in ('finalized','paid'), i.employee_id, e.department, i.currency,
         i.gross,
         coalesce((select sum((l ->> 'amount')::numeric) from jsonb_array_elements(coalesce(i.breakdown -> 'earnings', '[]')) l
                   where l ->> 'code' is distinct from 'BASIC'), 0),
         i.total_deductions, i.employer_contributions, i.reimbursements, i.net, i.breakdown
  from public.hr_payroll_runs r join public.hr_payroll_items i on i.run_id = r.id join pg_temp.ra_emp e on e.id = i.employee_id
  where r.period_start <= p_to and r.period_end >= p_from;

  select array_agg(distinct currency) into v_currencies from pg_temp.ra_pay;
  v_multi := coalesce(cardinality(v_currencies), 0) > 1;
  select coalesce(sum(gross) filter (where final), 0) gross, coalesce(sum(allowances) filter (where final), 0) allowances,
         coalesce(sum(deductions) filter (where final), 0) deductions, coalesce(sum(net) filter (where final), 0) net,
         coalesce(sum(employer) filter (where final), 0) employer,
         count(distinct employee_id) filter (where final) employees,
         coalesce(sum(gross) filter (where not final), 0) prov_gross,
         count(distinct run_id) filter (where final) final_runs, count(distinct run_id) filter (where not final) prov_runs,
         count(distinct run_id) filter (where run_status = 'paid') paid_runs, count(distinct run_id) filter (where run_status = 'finalized') unpaid_runs
    into c from pg_temp.ra_pay;

  if p_detail then
    select jsonb_agg(jsonb_build_object('period', to_char(ps, 'YYYY-MM-DD') || ' – ' || to_char(pe, 'YYYY-MM-DD'), 'month', to_char(ps, 'YYYY-MM'),
             'status', st, 'basis', case when fin then 'Final' else 'Provisional' end, 'paid', st = 'paid', 'currency', cur,
             'employees', n, 'gross', g, 'allowances', al, 'deductions', d, 'employer_contributions', ec, 'net', nt) order by ps) into v_rows
      from (select run_id, period_start ps, period_end pe, run_status st, final fin, currency cur, count(*) n, sum(gross) g, sum(allowances) al,
                   sum(deductions) d, sum(employer) ec, sum(net) nt
            from pg_temp.ra_pay group by run_id, period_start, period_end, run_status, final, currency) s;
    v_sections := v_sections || hr_private.ra_section('by_period', 'Payroll period comparison & approval status',
      '{"type":"bar","x":"month","y":["gross","deductions","net"]}',
      '[{"key":"period","label":"Period","type":"text"},{"key":"status","label":"Run status","type":"text"},{"key":"basis","label":"Basis","type":"text"},{"key":"paid","label":"Paid","type":"bool"},{"key":"currency","label":"Currency","type":"text"},{"key":"employees","label":"Employees","type":"int"},{"key":"gross","label":"Gross","type":"money","total":true},{"key":"allowances","label":"Allowances","type":"money","total":true},{"key":"deductions","label":"Deductions","type":"money","total":true},{"key":"employer_contributions","label":"Employer contributions","type":"money","total":true},{"key":"net","label":"Net","type":"money","total":true}]',
      v_rows, 'Provisional runs (draft, calculated, reviewed, approved) can still change. Totals mix Final and Provisional rows; the summary cards use Final runs only.');
    select jsonb_agg(jsonb_build_object('department', dep, 'currency', cur, 'employees', n, 'gross', g, 'deductions', d, 'employer_contributions', ec,
             'net', nt, 'cost', g + ec) order by g + ec desc) into v_rows
      from (select department dep, currency cur, count(distinct employee_id) n, sum(gross) g, sum(deductions) d, sum(employer) ec, sum(net) nt
            from pg_temp.ra_pay where final group by 1, 2) s;
    v_sections := v_sections || hr_private.ra_section('by_department', 'Department-wise payroll cost (final runs)',
      '{"type":"bar","x":"department","y":["cost"]}',
      '[{"key":"department","label":"Department","type":"text"},{"key":"currency","label":"Currency","type":"text"},{"key":"employees","label":"Employees","type":"int","total":true},{"key":"gross","label":"Gross","type":"money","total":true},{"key":"deductions","label":"Deductions","type":"money","total":true},{"key":"employer_contributions","label":"Employer contributions","type":"money","total":true},{"key":"net","label":"Net","type":"money","total":true},{"key":"cost","label":"Employer cost (gross + contributions)","type":"money","total":true}]', v_rows);
    select jsonb_agg(jsonb_build_object('component', nm, 'code', cd, 'kind', kd, 'currency', cur, 'employees', n, 'amount', amt) order by kd, nm) into v_rows
      from (select l ->> 'name' nm, l ->> 'code' cd, l ->> 'kind' kd, p.currency cur, count(distinct p.employee_id) n, sum((l ->> 'amount')::numeric) amt
            from pg_temp.ra_pay p
            cross join lateral jsonb_array_elements(coalesce(p.breakdown -> 'deductions', '[]') || coalesce(p.breakdown -> 'employer_contributions', '[]')) l
            join public.hr_salary_components sc on sc.code = l ->> 'code' and sc.is_statutory
            where p.final group by 1, 2, 3, 4) s;
    v_sections := v_sections || hr_private.ra_section('statutory', 'Statutory component summary (final runs)', null,
      '[{"key":"component","label":"Component","type":"text"},{"key":"code","label":"Code","type":"text"},{"key":"kind","label":"Kind","type":"text"},{"key":"currency","label":"Currency","type":"text"},{"key":"employees","label":"Employees","type":"int"},{"key":"amount","label":"Amount","type":"money","total":true}]',
      v_rows, 'Only components configured as statutory in Payroll settings. No statutory rates are assumed by this report.');
  end if;

  return jsonb_build_object(
    'cards', jsonb_build_array(
      hr_private.ra_card('gross', 'Gross salary', case when v_multi then null else c.gross end, 'money', 'Final runs only'),
      hr_private.ra_card('allowances', 'Total allowances', case when v_multi then null else c.allowances end, 'money', 'Earnings other than BASIC'),
      hr_private.ra_card('deductions', 'Total deductions', case when v_multi then null else c.deductions end, 'money', null),
      hr_private.ra_card('net', 'Net salary', case when v_multi then null else c.net end, 'money', null),
      hr_private.ra_card('employees_paid', 'Employees in final runs', c.employees, 'int', null),
      hr_private.ra_card('final_runs', 'Final runs', c.final_runs, 'int', c.paid_runs || ' paid, ' || c.unpaid_runs || ' finalized but unpaid'),
      hr_private.ra_card('provisional_runs', 'Provisional runs', c.prov_runs, 'int', 'Not finalized; excluded from the totals above'),
      hr_private.ra_card('provisional_gross', 'Provisional gross', case when v_multi then null else c.prov_gross end, 'money', 'May still change')),
    'currency', case when v_multi then null else coalesce(v_currencies[1], 'INR') end,
    'sections', v_sections,
    'definitions', jsonb_build_array(
      hr_private.ra_def('Basis', 'Final = runs finalized or paid. Provisional = draft, calculated, reviewed or approved runs; shown separately and never added to the final totals.'),
      hr_private.ra_def('Gross / deductions / net', 'Stored payroll item amounts produced by Module 7 for runs whose period overlaps the range. Nothing is recalculated.'),
      hr_private.ra_def('Allowances', 'Sum of earning lines other than the BASIC component.'),
      hr_private.ra_def('Employer cost', 'Gross + employer contributions.'),
      hr_private.ra_def('Currency', 'When more than one currency is present, money cards are blank and tables are split by currency.')),
    'unavailable', null);
end $$;

-- HIRING (source: Module 3 Recruitment & Hiring)
create or replace function hr_private.ra_hiring(p_from date, p_to date, p_department uuid, p_manager uuid, p_type text, p_detail boolean)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  c record; v_sections jsonb := '[]'::jsonb; v_rows jsonb;
  v_order constant text[] := array['applied','screening','shortlisted','interview','selected','offered','joined'];
begin
  if not hr_private.any_permission(array['recruitment.view','recruitment.manage']) then
    return hr_private.ra_unavailable('Hiring reports need recruitment access (recruitment.view).');
  end if;
  create temp table if not exists pg_temp.ra_open (id uuid primary key, title text, status text, openings int) on commit drop;
  truncate pg_temp.ra_open;
  insert into pg_temp.ra_open
  select o.id, o.title, o.status, o.openings from public.hr_job_openings o
  where (p_department is null or o.department_id = p_department) and (p_type is null or o.employment_type = p_type)
    and (p_manager is null or o.hiring_manager_id = p_manager);

  create temp table if not exists pg_temp.ra_app (id uuid primary key, opening_id uuid, stage text, created date, reached int,
    joined_on date) on commit drop;
  truncate pg_temp.ra_app;
  insert into pg_temp.ra_app
  select a.id, a.opening_id, a.stage, a.created_at::date,
         greatest(coalesce(array_position(v_order, a.stage), 0),
                  coalesce((select max(array_position(v_order, ev.to_stage)) from public.hr_candidate_stage_events ev where ev.application_id = a.id), 1)),
         case when a.stage = 'joined' then coalesce((select max(ev.changed_at)::date from public.hr_candidate_stage_events ev
                                                     where ev.application_id = a.id and ev.to_stage = 'joined'), a.stage_changed_at::date) end
  from public.hr_candidate_applications a join pg_temp.ra_open o on o.id = a.opening_id;

  select (select count(*) from pg_temp.ra_open where status = 'open') open_reqs,
         (select coalesce(sum(openings), 0) from pg_temp.ra_open where status = 'open') open_positions,
         count(*) filter (where created between p_from and p_to) received,
         count(*) filter (where created between p_from and p_to and reached >= 2) screened,
         count(*) filter (where stage not in ('rejected','withdrawn','joined')) in_pipeline,
         count(*) filter (where joined_on between p_from and p_to) hired,
         round(avg(joined_on - created) filter (where joined_on between p_from and p_to), 1) tth,
         count(*) filter (where joined_on between p_from and p_to) tth_n
    into c from pg_temp.ra_app;

  return (
    with iv as (select count(*) filter (where i.status <> 'cancelled') sched, count(*) filter (where i.status = 'completed') done,
                       count(*) filter (where i.status = 'no_show') noshow
                from public.hr_interviews i join pg_temp.ra_app a on a.id = i.application_id
                where i.scheduled_at::date between p_from and p_to),
         ofr as (select count(*) filter (where f.sent_at::date between p_from and p_to) issued,
                        count(*) filter (where f.status = 'accepted' and f.responded_at::date between p_from and p_to) accepted,
                        count(*) filter (where f.status = 'declined' and f.responded_at::date between p_from and p_to) declined
                 from public.hr_offers f join pg_temp.ra_app a on a.id = f.application_id)
    select jsonb_build_object(
      'cards', jsonb_build_array(
        hr_private.ra_card('open_positions', 'Open positions', c.open_positions, 'int', c.open_reqs || ' open requisitions (current)'),
        hr_private.ra_card('applications', 'Applications received', c.received, 'int', null),
        hr_private.ra_card('screened', 'Candidates screened', c.screened, 'int', 'Applications received in the period that reached screening or later'),
        hr_private.ra_card('interviews_scheduled', 'Interviews scheduled', iv.sched, 'int', 'Scheduled in the period, not cancelled'),
        hr_private.ra_card('interviews_completed', 'Interviews completed', iv.done, 'int', null),
        hr_private.ra_card('offers_issued', 'Offers issued', ofr.issued, 'int', null),
        hr_private.ra_card('offers_accepted', 'Offers accepted', ofr.accepted, 'int', ofr.declined || ' declined'),
        hr_private.ra_card('hired', 'Employees hired', c.hired, 'int', 'Moved to Joined in the period'),
        hr_private.ra_card('pending_recruitment', 'Pending recruitment', c.in_pipeline, 'int', 'Active applications not yet joined, rejected or withdrawn'),
        hr_private.ra_card('time_to_hire', 'Avg time to hire (days)', c.tth, 'num', case when c.tth_n > 0 then 'Based on ' || c.tth_n || ' hires with both dates' else 'No hires with both dates' end)),
      'sections', case when not p_detail then '[]'::jsonb else jsonb_build_array(
        hr_private.ra_section('funnel', 'Hiring funnel (applications received in the period)',
          '{"type":"funnel","x":"stage","y":["applications"]}',
          '[{"key":"stage","label":"Stage reached","type":"text"},{"key":"applications","label":"Applications","type":"int"},{"key":"pct_of_applied","label":"% of applied","type":"pct"}]',
          (select jsonb_agg(jsonb_build_object('stage', initcap(st), 'applications', n,
                    'pct_of_applied', round(100.0 * n / nullif(c.received, 0), 1)) order by o)
             from (select st, o, (select count(*) from pg_temp.ra_app a where a.created between p_from and p_to and a.reached >= o) n
                   from unnest(v_order) with ordinality u(st, o)) s),
          'An application counts at every stage it reached (from stage history), so rejected candidates are counted up to the stage they reached.'),
        hr_private.ra_section('pipeline', 'Current recruitment pipeline', '{"type":"bar","x":"stage","y":["applications"]}',
          '[{"key":"stage","label":"Current stage","type":"text"},{"key":"applications","label":"Applications","type":"int","total":true}]',
          (select jsonb_agg(jsonb_build_object('stage', initcap(stage), 'applications', n) order by array_position(v_order, stage) nulls last)
             from (select stage, count(*) n from pg_temp.ra_app where stage not in ('rejected','withdrawn','joined') group by 1) s)),
        hr_private.ra_section('trend', 'Hiring trend', '{"type":"line","x":"month","y":["applications","offers","hires"]}',
          '[{"key":"month","label":"Month","type":"text"},{"key":"applications","label":"Applications","type":"int","total":true},{"key":"offers","label":"Offers issued","type":"int","total":true},{"key":"hires","label":"Hires","type":"int","total":true}]',
          (select jsonb_agg(jsonb_build_object('month', m.month,
                    'applications', (select count(*) from pg_temp.ra_app a where a.created between m.ms and m.me),
                    'offers', (select count(*) from public.hr_offers f join pg_temp.ra_app a on a.id = f.application_id where f.sent_at::date between m.ms and m.me),
                    'hires', (select count(*) from pg_temp.ra_app a where a.joined_on between m.ms and m.me)) order by m.ms)
             from hr_private.ra_months(p_from, p_to) m)),
        hr_private.ra_section('openings', 'Open positions by requisition', null,
          '[{"key":"opening","label":"Opening","type":"text"},{"key":"status","label":"Status","type":"text"},{"key":"openings","label":"Positions","type":"int","total":true},{"key":"active_applications","label":"Active applications","type":"int","total":true},{"key":"hired","label":"Hired (all time)","type":"int","total":true}]',
          (select jsonb_agg(jsonb_build_object('opening', o.title, 'status', o.status, 'openings', o.openings,
                    'active_applications', (select count(*) from pg_temp.ra_app a where a.opening_id = o.id and a.stage not in ('rejected','withdrawn','joined')),
                    'hired', (select count(*) from pg_temp.ra_app a where a.opening_id = o.id and a.stage = 'joined')) order by o.title)
             from pg_temp.ra_open o where o.status in ('open','on_hold')))) end,
      'definitions', jsonb_build_array(
        hr_private.ra_def('Open positions', 'Sum of positions on requisitions currently in Open status (not period-bound).'),
        hr_private.ra_def('Screened', 'Applications received in the period whose current stage or stage history reached Screening or later.'),
        hr_private.ra_def('Hired', 'Applications moved to Joined in the period (date from stage history).'),
        hr_private.ra_def('Time to hire', 'Average days from application received to Joined, for hires in the period. Hires without both dates are left out, never estimated.'),
        hr_private.ra_def('Filters', 'Department, employment type and manager (= hiring manager) apply to requisitions. Company, employee and location do not apply to recruitment records.')),
      'filters_ignored', jsonb_build_array('company', 'employee', 'location'),
      'unavailable', null)
    from iv, ofr);
end $$;

-- ATTRITION (source: Employee Management + Module 4 exits)
create or replace function hr_private.ra_attrition(p_from date, p_to date, p_detail boolean)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_asof date := least(p_to, hr_private.business_today());
  c record; r record; v_sections jsonb := '[]'::jsonb; v_rows jsonb;
begin
  create temp table if not exists pg_temp.ra_exit (employee_id uuid primary key, category text, voluntary boolean, tenure_years numeric) on commit drop;
  truncate pg_temp.ra_exit;
  insert into pg_temp.ra_exit
  select e.id, hr_private.ra_exit_category(x.exit_type), x.exit_type = 'resignation',
         case when e.joining_date is not null then round((e.last_working_date - e.joining_date) / 365.25, 2) end
  from pg_temp.ra_emp e
  left join lateral (select x.exit_type from public.hr_exits x where x.employee_id = e.id and x.status not in ('withdrawn','rejected')
                     order by x.created_at desc limit 1) x on true
  where e.status in ('exited','archived') and e.last_working_date between p_from and p_to;

  select count(*) filter (where hr_private.ra_in_headcount(status, joining_date, last_working_date, p_from)) opening,
         count(*) filter (where hr_private.ra_in_headcount(status, joining_date, last_working_date, v_asof)) closing
    into c from pg_temp.ra_emp;
  select count(*) exits, count(*) filter (where voluntary) vol, round(avg(tenure_years), 2) tenure, count(tenure_years) tenure_n
    into r from pg_temp.ra_exit;

  if p_detail then
    select jsonb_agg(jsonb_build_object('category', category, 'exits', n, 'pct', round(100.0 * n / nullif(r.exits, 0), 1)) order by n desc) into v_rows
      from (select category, count(*) n from pg_temp.ra_exit group by 1) s;
    v_sections := v_sections || hr_private.ra_section('by_category', 'Exits by category', '{"type":"pie","x":"category","y":["exits"]}',
      '[{"key":"category","label":"Category","type":"text"},{"key":"exits","label":"Completed exits","type":"int","total":true},{"key":"pct","label":"% of exits","type":"pct"}]', v_rows);
    select jsonb_agg(jsonb_build_object('department', dep, 'opening', op, 'closing', cl, 'exits', x,
             'attrition_pct', case when op + cl > 0 then round(100.0 * x / ((op + cl) / 2.0), 2) end) order by x desc, dep) into v_rows
      from (select e.department dep,
                   count(*) filter (where hr_private.ra_in_headcount(e.status, e.joining_date, e.last_working_date, p_from)) op,
                   count(*) filter (where hr_private.ra_in_headcount(e.status, e.joining_date, e.last_working_date, v_asof)) cl,
                   count(x.employee_id) x
            from pg_temp.ra_emp e left join pg_temp.ra_exit x on x.employee_id = e.id group by 1) s
      where op + cl + x > 0;
    v_sections := v_sections || hr_private.ra_section('by_department', 'Department-wise attrition', '{"type":"bar","x":"department","y":["attrition_pct"]}',
      '[{"key":"department","label":"Department","type":"text"},{"key":"opening","label":"Opening headcount","type":"int","total":true},{"key":"closing","label":"Closing headcount","type":"int","total":true},{"key":"exits","label":"Completed exits","type":"int","total":true},{"key":"attrition_pct","label":"Attrition %","type":"pct"}]', v_rows);
    select jsonb_agg(jsonb_build_object('month', m.month, 'exits', t.x, 'voluntary', t.v, 'avg_headcount', (t.op + t.cl) / 2.0,
             'attrition_pct', case when t.op + t.cl > 0 then round(100.0 * t.x / ((t.op + t.cl) / 2.0), 2) end) order by m.ms) into v_rows
      from hr_private.ra_months(p_from, p_to) m
      cross join lateral (select count(*) filter (where hr_private.ra_in_headcount(e.status, e.joining_date, e.last_working_date, m.ms)) op,
                                 count(*) filter (where hr_private.ra_in_headcount(e.status, e.joining_date, e.last_working_date, least(m.me, v_asof))) cl,
                                 count(x.employee_id) filter (where e.last_working_date between m.ms and m.me) x,
                                 count(x.employee_id) filter (where e.last_working_date between m.ms and m.me and x.voluntary) v
                          from pg_temp.ra_emp e left join pg_temp.ra_exit x on x.employee_id = e.id) t
      where m.ms <= v_asof;
    v_sections := v_sections || hr_private.ra_section('trend', 'Monthly exit trend', '{"type":"line","x":"month","y":["attrition_pct"]}',
      '[{"key":"month","label":"Month","type":"text"},{"key":"exits","label":"Completed exits","type":"int","total":true},{"key":"voluntary","label":"Voluntary","type":"int","total":true},{"key":"avg_headcount","label":"Avg headcount","type":"num"},{"key":"attrition_pct","label":"Monthly attrition %","type":"pct"}]', v_rows);
    select jsonb_agg(jsonb_build_object('employee_code', e.employee_code, 'employee', e.name, 'department', e.department, 'category', x.category,
             'joining_date', e.joining_date, 'last_working_date', e.last_working_date, 'tenure_years', x.tenure_years) order by e.last_working_date desc, e.name) into v_rows
      from pg_temp.ra_exit x join pg_temp.ra_emp e on e.id = x.employee_id;
    v_sections := v_sections || hr_private.ra_section('exits', 'Completed exits', null,
      '[{"key":"employee_code","label":"ID","type":"text"},{"key":"employee","label":"Employee","type":"text"},{"key":"department","label":"Department","type":"text"},{"key":"category","label":"Category","type":"text"},{"key":"joining_date","label":"Joined","type":"date"},{"key":"last_working_date","label":"Last working day","type":"date"},{"key":"tenure_years","label":"Tenure (years)","type":"num"}]', v_rows);
    -- Resignations (requests) are reported separately from completed exits: never added together.
    select jsonb_agg(jsonb_build_object('status', st, 'requests', n) order by st) into v_rows
      from (select x.status st, count(*) n from public.hr_exits x join pg_temp.ra_emp e on e.id = x.employee_id
            where x.exit_type = 'resignation' and coalesce(x.resignation_date, x.created_at::date) between p_from and p_to group by 1) s;
    v_sections := v_sections || hr_private.ra_section('resignations', 'Resignations submitted (by current status)', '{"type":"bar","x":"status","y":["requests"]}',
      '[{"key":"status","label":"Status","type":"text"},{"key":"requests","label":"Resignations","type":"int","total":true}]', v_rows,
      'Resignation requests are counted by submission date and are not added to completed exits.');
  end if;

  return jsonb_build_object(
    'cards', jsonb_build_array(
      hr_private.ra_card('completed_exits', 'Completed exits', r.exits, 'int', 'Last working day in the period'),
      hr_private.ra_card('voluntary_exits', 'Voluntary exits', r.vol, 'int', 'Exit type = resignation'),
      hr_private.ra_card('resignations', 'Resignations submitted', (select count(*) from public.hr_exits x join pg_temp.ra_emp e on e.id = x.employee_id
           where x.exit_type = 'resignation' and coalesce(x.resignation_date, x.created_at::date) between p_from and p_to), 'int', 'Requests, not completed exits'),
      hr_private.ra_card('attrition_rate', 'Attrition rate', case when c.opening + c.closing > 0 then round(100.0 * r.exits / ((c.opening + c.closing) / 2.0), 2) end, 'pct',
           'Exits ÷ avg headcount (' || c.opening || ' opening, ' || c.closing || ' closing)'),
      hr_private.ra_card('avg_tenure', 'Avg tenure of leavers (years)', r.tenure, 'num', case when r.tenure_n < r.exits then (r.exits - r.tenure_n) || ' leavers without a joining date excluded' end)),
    'sections', v_sections,
    'definitions', jsonb_build_array(
      hr_private.ra_def('Completed exit', 'An exited or archived employee whose last working day falls in the period (Employee Management is authoritative).'),
      hr_private.ra_def('Attrition rate', 'Completed exits during the period ÷ average headcount × 100, where average headcount = (headcount at the start date + headcount at the as-of date) ÷ 2.'),
      hr_private.ra_def('Category', 'Exit type of the latest non-withdrawn exit case (Module 4). Voluntary = resignation. "Not recorded" when the employee left without an exit case or the case is not visible to you.'),
      hr_private.ra_def('Resignations', 'Resignation requests by submission date. Shown separately; never added to completed exits.'),
      hr_private.ra_def('Tenure', '(last working day − joining date) ÷ 365.25.')),
    'unavailable', null);
end $$;

-- PERFORMANCE (source: existing Performance & KPI module; aggregates only)
create or replace function hr_private.ra_performance(p_from date, p_to date, p_detail boolean)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare c record; v_sections jsonb := '[]'::jsonb; v_rows jsonb;
begin
  if not hr_private.any_permission(array['performance.view','performance.view_team','performance.manage']) then
    return hr_private.ra_unavailable('Performance reports need performance access (performance.view or performance.view_team).');
  end if;
  create temp table if not exists pg_temp.ra_rev (id uuid primary key, employee_id uuid, cycle text, cycle_end date, status text, final_rating numeric) on commit drop;
  truncate pg_temp.ra_rev;
  insert into pg_temp.ra_rev
  select pr.id, pr.employee_id, cy.name, cy.period_end, pr.status, pr.final_rating
  from public.hr_performance_reviews pr join public.hr_review_cycles cy on cy.id = pr.cycle_id join pg_temp.ra_emp e on e.id = pr.employee_id
  where cy.period_start <= p_to and cy.period_end >= p_from and pr.employee_id is distinct from hr_private.current_employee_id();

  select count(*) total, count(*) filter (where status = 'finalized') done, round(avg(final_rating) filter (where status = 'finalized'), 2) avg_rating
    into c from pg_temp.ra_rev;

  if p_detail then
    select jsonb_agg(jsonb_build_object('rating', b || ' – ' || case b when 1 then 'Needs improvement' when 2 then 'Below expectations' when 3 then 'Meets expectations'
             when 4 then 'Exceeds expectations' else 'Outstanding' end, 'reviews', coalesce(n, 0)) order by b) into v_rows
      from generate_series(1, 5) b left join (select least(5, greatest(1, round(final_rating)))::int r, count(*) n from pg_temp.ra_rev where status = 'finalized' group by 1) s on s.r = b;
    v_sections := v_sections || hr_private.ra_section('distribution', 'Final rating distribution', '{"type":"bar","x":"rating","y":["reviews"]}',
      '[{"key":"rating","label":"Final rating (rounded)","type":"text"},{"key":"reviews","label":"Finalized reviews","type":"int","total":true}]', v_rows);
    select jsonb_agg(jsonb_build_object('department', dep, 'reviews', n, 'finalized', f, 'completion_pct', round(100.0 * f / nullif(n, 0), 1), 'avg_rating', ar) order by dep) into v_rows
      from (select e.department dep, count(*) n, count(*) filter (where r.status = 'finalized') f, round(avg(r.final_rating) filter (where r.status = 'finalized'), 2) ar
            from pg_temp.ra_rev r join pg_temp.ra_emp e on e.id = r.employee_id group by 1) s;
    v_sections := v_sections || hr_private.ra_section('by_department', 'Department performance summary', '{"type":"bar","x":"department","y":["completion_pct"]}',
      '[{"key":"department","label":"Department","type":"text"},{"key":"reviews","label":"Reviews","type":"int","total":true},{"key":"finalized","label":"Finalized","type":"int","total":true},{"key":"completion_pct","label":"Completion %","type":"pct"},{"key":"avg_rating","label":"Avg final rating","type":"num"}]', v_rows);
    select jsonb_agg(jsonb_build_object('cycle', cycle, 'period_end', ce, 'reviews', n, 'finalized', f, 'completion_pct', round(100.0 * f / nullif(n, 0), 1), 'avg_rating', ar) order by ce) into v_rows
      from (select cycle, max(cycle_end) ce, count(*) n, count(*) filter (where status = 'finalized') f, round(avg(final_rating) filter (where status = 'finalized'), 2) ar
            from pg_temp.ra_rev group by cycle) s;
    v_sections := v_sections || hr_private.ra_section('trend', 'Performance trend by cycle', '{"type":"line","x":"cycle","y":["completion_pct"]}',
      '[{"key":"cycle","label":"Cycle","type":"text"},{"key":"period_end","label":"Cycle end","type":"date"},{"key":"reviews","label":"Reviews","type":"int","total":true},{"key":"finalized","label":"Finalized","type":"int","total":true},{"key":"completion_pct","label":"Completion %","type":"pct"},{"key":"avg_rating","label":"Avg final rating","type":"num"}]', v_rows);
    select jsonb_agg(jsonb_build_object('kpi', k.name, 'unit', k.unit, 'goals', n, 'achieved', a, 'missed', ms, 'avg_score', sc) order by k.name) into v_rows
      from (select g.kpi_id, count(*) n, count(*) filter (where g.status = 'achieved') a, count(*) filter (where g.status = 'missed') ms, round(avg(g.score), 2) sc
            from public.hr_goals g join public.hr_review_cycles cy on cy.id = g.cycle_id join pg_temp.ra_emp e on e.id = g.employee_id
            where g.kpi_id is not null and cy.period_start <= p_to and cy.period_end >= p_from
              and g.employee_id is distinct from hr_private.current_employee_id()
            group by 1) s join public.hr_kpi_definitions k on k.id = s.kpi_id;
    v_sections := v_sections || hr_private.ra_section('kpis', 'KPI results', null,
      '[{"key":"kpi","label":"KPI","type":"text"},{"key":"unit","label":"Unit","type":"text"},{"key":"goals","label":"Goals","type":"int","total":true},{"key":"achieved","label":"Achieved","type":"int","total":true},{"key":"missed","label":"Missed","type":"int","total":true},{"key":"avg_score","label":"Avg score","type":"num"}]', v_rows);
  end if;

  return jsonb_build_object(
    'cards', jsonb_build_array(
      hr_private.ra_card('reviews_completed', 'Reviews completed', c.done, 'int', 'Finalized reviews in cycles overlapping the period'),
      hr_private.ra_card('reviews_pending', 'Pending reviews', c.total - c.done, 'int', null),
      hr_private.ra_card('review_completion', 'Review completion', round(100.0 * c.done / nullif(c.total, 0), 1), 'pct', null),
      hr_private.ra_card('avg_final_rating', 'Avg final rating', c.avg_rating, 'num', 'Finalized reviews only (1–5)')),
    'sections', v_sections,
    'definitions', jsonb_build_array(
      hr_private.ra_def('Reviews in scope', 'Reviews in review cycles whose period overlaps the range, for employees you may see. Your own review is excluded.'),
      hr_private.ra_def('Completion %', 'Finalized reviews ÷ all reviews × 100.'),
      hr_private.ra_def('Ratings', 'Only finalized ratings are aggregated; self and draft manager ratings are never shown here.'),
      hr_private.ra_def('Use of results', 'For review and planning only. These figures must not drive automated disciplinary decisions.')),
    'unavailable', null);
end $$;

-- ---------------------------------------------------------------------
-- 3b. Public analytics entry point
-- ---------------------------------------------------------------------
create or replace function public.hr_report_analytics(
  p_category text, p_from date default null, p_to date default null, p_department uuid default null,
  p_manager uuid default null, p_employment_type text default null, p_legal_entity uuid default null,
  p_employee uuid default null, p_location uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', hr_private.business_today())::date);
  v_to date := coalesce(p_to, hr_private.business_today());
  v_titles constant jsonb := '{"overview":"Reports overview","headcount":"Headcount","attendance":"Attendance","leave":"Leave","payroll":"Payroll","hiring":"Hiring","attrition":"Attrition","performance":"Performance"}';
  r jsonb; v_parts jsonb; v_cards jsonb := '[]'::jsonb; v_unavail jsonb := '[]'::jsonb; k text; v_pick text[];
begin
  if not hr_private.any_permission(array['reports.view','reports.view_team']) then
    perform hr_private.fail('You do not have access to HR reports.', 'forbidden');
  end if;
  if p_category is null or not (v_titles ? p_category) then perform hr_private.fail('Unknown report category.', 'unknown_report'); end if;
  perform hr_private.ra_validate(v_from, v_to, p_employment_type);
  perform hr_private.ra_set_filters(p_legal_entity, p_employee, p_location);
  perform hr_private.ra_load_scope('reports.view', p_department, p_manager, p_employment_type);

  if p_category = 'overview' then
    -- Overview = the headline card of each category, computed by the same functions.
    v_parts := jsonb_build_object(
      'headcount', hr_private.ra_headcount(v_from, v_to, false),
      'leave', hr_private.ra_leave(v_from, v_to, false),
      'hiring', hr_private.ra_hiring(v_from, v_to, p_department, p_manager, p_employment_type, false),
      'attrition', hr_private.ra_attrition(v_from, v_to, false),
      'performance', hr_private.ra_performance(v_from, v_to, false),
      'attendance', hr_private.ra_attendance(v_from, v_to, false));   -- last: may narrow ra_emp to the team
    foreach k in array array['headcount','attendance','leave','hiring','attrition','performance'] loop
      v_pick := case k when 'headcount' then array['total_employees','new_joiners','exits'] when 'attendance' then array['attendance_rate']
        when 'leave' then array['on_leave'] when 'hiring' then array['pending_recruitment'] when 'attrition' then array['attrition_rate']
        else array['review_completion'] end;
      if v_parts -> k ->> 'unavailable' is not null then
        v_unavail := v_unavail || jsonb_build_object('category', k, 'reason', v_parts -> k ->> 'unavailable');
      else
        v_cards := v_cards || coalesce((select jsonb_agg(x || jsonb_build_object('category', k)) from jsonb_array_elements(v_parts -> k -> 'cards') x
                                        where x ->> 'key' = any (v_pick)), '[]'::jsonb);
      end if;
    end loop;
    r := jsonb_build_object('cards', v_cards, 'sections', '[]'::jsonb, 'unavailable', null,
           'definitions', jsonb_build_array(hr_private.ra_def('Overview', 'Each card is the headline figure of its category report, calculated with the same definitions. Open the category for details.')));
  else
    r := case p_category
      when 'headcount' then hr_private.ra_headcount(v_from, v_to, true)
      when 'attendance' then hr_private.ra_attendance(v_from, v_to, true)
      when 'leave' then hr_private.ra_leave(v_from, v_to, true)
      when 'payroll' then hr_private.ra_payroll(v_from, v_to, true)
      when 'hiring' then hr_private.ra_hiring(v_from, v_to, p_department, p_manager, p_employment_type, true)
      when 'attrition' then hr_private.ra_attrition(v_from, v_to, true)
      when 'performance' then hr_private.ra_performance(v_from, v_to, true) end;
    if r ->> 'unavailable' is not null then
      v_unavail := jsonb_build_array(jsonb_build_object('category', p_category, 'reason', r ->> 'unavailable'));
    end if;
  end if;
  perform hr_private.ra_clear_filters();

  return jsonb_build_object(
    'category', p_category, 'title', v_titles ->> p_category, 'from', v_from, 'to', v_to,
    'as_of', least(v_to, hr_private.business_today()), 'generated_at', now(),
    'scope', case when hr_private.has_permission('reports.view') then 'company' else 'team' end,
    'filters', jsonb_strip_nulls(jsonb_build_object('department', p_department, 'manager', p_manager, 'employment_type', p_employment_type,
                                                    'legal_entity', p_legal_entity, 'employee', p_employee, 'location', p_location)),
    'cards', coalesce(r -> 'cards', '[]'::jsonb), 'sections', coalesce(r -> 'sections', '[]'::jsonb),
    'definitions', coalesce(r -> 'definitions', '[]'::jsonb), 'unavailable', v_unavail,
    'currency', r -> 'currency', 'filters_ignored', r -> 'filters_ignored');
end $$;

-- ---------------------------------------------------------------------
-- 4. hr_report(): audit fixes + new row-level templates
-- ---------------------------------------------------------------------
alter function public.hr_report(text, date, date, uuid, uuid, text, uuid) set schema hr_private;
alter function hr_private.hr_report(text, date, date, uuid, uuid, text, uuid) rename to hr_report_v116;

create or replace function public.hr_report(
  p_report text, p_from date default null, p_to date default null, p_department uuid default null,
  p_manager uuid default null, p_employment_type text default null, p_legal_entity uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', hr_private.business_today())::date);
  v_to date := coalesce(p_to, hr_private.business_today());
  v_today date := hr_private.business_today();
  v_new constant text[] := array['new_joiners','recruitment_pipeline','payroll_summary','attendance_employee','attendance_daily',
    'attendance_regularizations','upcoming_leave','completed_exits','attendance_summary'];
  v_rows jsonb; v_cols jsonb; v_title text; v_note text; v_ignored jsonb; v_win date;
begin
  if not hr_private.any_permission(array['reports.view','reports.view_team']) then
    perform hr_private.fail('You do not have access to HR reports.', 'forbidden');
  end if;
  -- Refuse instead of returning zeros / empty results (audit RP4).
  if p_report in ('attendance_summary','absence','late_arrivals','attendance_employee','attendance_daily','attendance_regularizations')
     and not hr_private.any_permission(array['attendance.view','attendance.view_team']) then
    perform hr_private.fail('Attendance reports need attendance access.', 'forbidden');
  end if;
  if p_report = 'daily_report_compliance' and not hr_private.any_permission(array['daily_reports.view','daily_reports.view_team']) then
    perform hr_private.fail('Daily report compliance needs daily report access.', 'forbidden');
  end if;
  if p_report = 'upcoming_leave' and not hr_private.any_permission(array['leave.view','leave.view_team','leave.manage']) then
    perform hr_private.fail('Leave reports need leave access.', 'forbidden');
  end if;
  if not (p_report = any (v_new)) then
    return hr_private.hr_report_v116(p_report, p_from, p_to, p_department, p_manager, p_employment_type, p_legal_entity);
  end if;

  perform hr_private.ra_validate(v_from, v_to, p_employment_type);
  perform set_config('hr.filter_legal_entity', coalesce(p_legal_entity::text, ''), true);
  perform hr_private.ra_load_scope('reports.view', p_department, p_manager, p_employment_type);

  case p_report
  when 'new_joiners' then
    v_title := 'New joiners';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"designation","label":"Designation"},{"key":"employment_type","label":"Type"},{"key":"joining_date","label":"Joined"},{"key":"status","label":"Current status"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', employee_code, 'employee', name, 'department', department, 'designation', designation,
             'employment_type', employment_type_label, 'joining_date', joining_date, 'status', status) order by joining_date desc, name), '[]') into v_rows
      from pg_temp.ra_emp where joining_date between v_from and v_to and status <> 'onboarding';
    v_note := 'Includes joiners who have since left.';

  when 'recruitment_pipeline' then
    if not hr_private.any_permission(array['recruitment.view','recruitment.manage']) then
      perform hr_private.fail('Recruitment reports need recruitment access.', 'forbidden');
    end if;
    v_title := 'Recruitment pipeline';
    v_cols := '[{"key":"opening","label":"Opening"},{"key":"status","label":"Status"},{"key":"openings","label":"Openings"},{"key":"received","label":"Received in period"},{"key":"applied","label":"Applied"},{"key":"screening","label":"Screening"},{"key":"shortlisted","label":"Shortlisted"},{"key":"interview","label":"Interview"},{"key":"selected","label":"Selected"},{"key":"offered","label":"Offered"},{"key":"joined","label":"Joined"},{"key":"rejected","label":"Rejected"},{"key":"withdrawn","label":"Withdrawn"}]';
    select coalesce(jsonb_agg(row order by row ->> 'opening'), '[]') into v_rows from (
      select jsonb_build_object('opening', o.title, 'status', o.status, 'openings', o.openings,
             'received', count(a.*) filter (where a.created_at::date between v_from and v_to),
             'applied', count(a.*) filter (where a.stage = 'applied'), 'screening', count(a.*) filter (where a.stage = 'screening'),
             'shortlisted', count(a.*) filter (where a.stage = 'shortlisted'), 'interview', count(a.*) filter (where a.stage = 'interview'),
             'selected', count(a.*) filter (where a.stage = 'selected'), 'offered', count(a.*) filter (where a.stage = 'offered'),
             'joined', count(a.*) filter (where a.stage = 'joined'), 'rejected', count(a.*) filter (where a.stage = 'rejected'),
             'withdrawn', count(a.*) filter (where a.stage = 'withdrawn')) row
      from public.hr_job_openings o left join public.hr_candidate_applications a on a.opening_id = o.id
      where (p_department is null or o.department_id = p_department) and (p_employment_type is null or o.employment_type = p_employment_type)
        and (p_manager is null or o.hiring_manager_id = p_manager)
        and o.created_at::date <= v_to
        and (o.status in ('open','on_hold') or o.updated_at::date >= v_from)
      group by o.id, o.title, o.status, o.openings) x;
    v_note := 'Stage columns show current stage counts. Manager = hiring manager.';
    v_ignored := '["company","employee","location"]';

  when 'payroll_summary' then
    if not hr_private.has_permission('payroll.view') then
      perform hr_private.fail('Payroll reports require payroll access.', 'forbidden');
    end if;
    v_title := 'Payroll summary';
    v_cols := '[{"key":"period","label":"Period"},{"key":"status","label":"Run status"},{"key":"basis","label":"Basis"},{"key":"currency","label":"Currency"},{"key":"employees","label":"Employees"},{"key":"gross","label":"Gross"},{"key":"deductions","label":"Deductions"},{"key":"reimbursements","label":"Reimbursements"},{"key":"net","label":"Net"}]';
    select coalesce(jsonb_agg(row order by ps desc, row ->> 'currency'), '[]') into v_rows from (
      select r.period_start ps, jsonb_build_object('period', r.period_start || ' – ' || r.period_end, 'status', r.status,
             'basis', case when r.status in ('finalized','paid') then 'Final' else 'Provisional' end, 'currency', i.currency,
             'employees', count(i.*), 'gross', coalesce(sum(i.gross), 0), 'deductions', coalesce(sum(i.total_deductions), 0),
             'reimbursements', coalesce(sum(i.reimbursements), 0), 'net', coalesce(sum(i.net), 0)) row
      from public.hr_payroll_runs r
      left join public.hr_payroll_items i on i.run_id = r.id and i.employee_id in (select id from pg_temp.ra_emp)
      where r.period_start <= v_to and r.period_end >= v_from
      group by r.id, r.period_start, r.period_end, r.status, i.currency
      having count(i.*) > 0
          or (p_department is null and p_manager is null and p_employment_type is null and p_legal_entity is null
              and nullif(current_setting('hr.filter_employee', true), '') is null and nullif(current_setting('hr.filter_location', true), '') is null)) x;
    v_note := 'Final = finalized or paid. Provisional runs may still change.';

  when 'attendance_employee', 'attendance_daily' then
    if not hr_private.has_permission('attendance.view') then
      delete from pg_temp.ra_emp e where not hr_private.is_manager_of(e.id);
    end if;
    v_win := greatest(v_from, v_to - 92);
    perform hr_private.ra_load_attendance(v_win, v_to);
    v_note := 'Window ' || v_win || ' – ' || least(v_to, v_today - 1) || ' (max 93 days, today excluded). Attendance % = attended ÷ expected working days.';
    if p_report = 'attendance_employee' then
      v_title := 'Employee-wise attendance';
      v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"expected","label":"Expected days"},{"key":"attended","label":"Attended"},{"key":"absent","label":"Absent"},{"key":"late","label":"Late"},{"key":"on_leave","label":"Leave days"},{"key":"missing_punch","label":"Missing punch"},{"key":"worked_hours","label":"Worked hours"},{"key":"attendance_pct","label":"Attendance %"}]';
      select coalesce(jsonb_agg(jsonb_build_object('employee_code', e.employee_code, 'employee', e.name, 'department', e.department,
               'expected', (x ->> 'expected')::numeric, 'attended', (x ->> 'attended')::numeric, 'absent', (x ->> 'absent')::numeric,
               'late', l, 'on_leave', lv, 'missing_punch', mp, 'worked_hours', round(w / 60.0, 2), 'attendance_pct', (x ->> 'pct')::numeric) order by e.name), '[]') into v_rows
        from (select employee_id, hr_private.ra_att_metrics(array_agg(kind)) x, count(*) filter (where kind = 'late') l,
                     count(*) filter (where kind = 'leave') lv, count(*) filter (where kind = 'missing_punch') mp, coalesce(sum(worked_minutes), 0) w
              from pg_temp.ra_att group by employee_id) s join pg_temp.ra_emp e on e.id = s.employee_id;
    else
      v_title := 'Daily attendance';
      v_cols := '[{"key":"date","label":"Date"},{"key":"expected","label":"Expected"},{"key":"attended","label":"Attended"},{"key":"absent","label":"Absent"},{"key":"late","label":"Late"},{"key":"on_leave","label":"On leave"},{"key":"attendance_pct","label":"Attendance %"}]';
      select coalesce(jsonb_agg(jsonb_build_object('date', d, 'expected', (x ->> 'expected')::numeric, 'attended', (x ->> 'attended')::numeric,
               'absent', (x ->> 'absent')::numeric, 'late', l, 'on_leave', lv, 'attendance_pct', (x ->> 'pct')::numeric) order by d desc), '[]') into v_rows
        from (select d, hr_private.ra_att_metrics(array_agg(kind)) x, count(*) filter (where kind = 'late') l, count(*) filter (where kind = 'leave') lv
              from pg_temp.ra_att group by d) s;
    end if;

  when 'attendance_summary' then
    -- Same columns and semantics as the 112 template (status counts per employee,
    -- former employees included, zero rows kept); rows are read through
    -- hr_private.ra_attendance_rows (RLS predicate evaluated per employee).
    v_title := 'Attendance summary';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"present","label":"Present"},{"key":"late","label":"Late"},{"key":"half_day","label":"Half day"},{"key":"absent","label":"Absent (recorded)"},{"key":"missing_punch","label":"Missing punch"},{"key":"on_leave","label":"On leave"},{"key":"worked_hours","label":"Worked hours"},{"key":"overtime_hours","label":"Overtime hours"}]';
    select coalesce(jsonb_agg(row order by row ->> 'employee'), '[]') into v_rows from (
      select jsonb_build_object('employee_code', e.employee_code, 'employee', e.name, 'department', e.department,
        'present', count(a.*) filter (where a.status = 'present'), 'late', count(a.*) filter (where a.status = 'late'),
        'half_day', count(a.*) filter (where a.status = 'half_day'), 'absent', count(a.*) filter (where a.status = 'absent'),
        'missing_punch', count(a.*) filter (where a.status = 'missing_punch'), 'on_leave', count(a.*) filter (where a.status = 'on_leave'),
        'worked_hours', round(coalesce(sum(a.worked_minutes), 0) / 60.0, 2), 'overtime_hours', round(coalesce(sum(a.overtime_minutes), 0) / 60.0, 2)) row
      from pg_temp.ra_emp e
      left join hr_private.ra_attendance_rows((select array_agg(id) from pg_temp.ra_emp), v_from, v_to) a on a.employee_id = e.id
      group by e.id, e.employee_code, e.name, e.department) x;

  when 'attendance_regularizations' then
    v_title := 'Attendance regularizations';
    v_cols := '[{"key":"work_date","label":"Work date"},{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"requested_check_in_at","label":"Requested check-in"},{"key":"requested_check_out_at","label":"Requested check-out"},{"key":"status","label":"Status"},{"key":"reviewed_at","label":"Reviewed"}]';
    select coalesce(jsonb_agg(jsonb_build_object('work_date', c.work_date, 'employee_code', e.employee_code, 'employee', e.name, 'department', e.department,
             'requested_check_in_at', c.requested_check_in_at, 'requested_check_out_at', c.requested_check_out_at, 'status', c.status,
             'reviewed_at', c.reviewed_at) order by c.work_date desc, e.name), '[]') into v_rows
      from public.hr_attendance_corrections c join pg_temp.ra_emp e on e.id = c.employee_id
      where c.work_date between v_from and v_to;

  when 'upcoming_leave' then
    v_title := 'Upcoming leave (next 30 days)';
    v_cols := '[{"key":"start_date","label":"From"},{"key":"end_date","label":"To"},{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"leave_type","label":"Leave type"},{"key":"days","label":"Days"},{"key":"status","label":"Status"}]';
    select coalesce(jsonb_agg(jsonb_build_object('start_date', l.start_date, 'end_date', l.end_date, 'employee_code', e.employee_code, 'employee', e.name,
             'department', e.department, 'leave_type', t.name, 'days', l.days, 'status', l.status) order by l.start_date, e.name), '[]') into v_rows
      from public.hr_leave_requests l join pg_temp.ra_emp e on e.id = l.employee_id join public.hr_leave_types t on t.id = l.leave_type_id
      where l.status in ('approved','pending_approval') and l.start_date between v_today + 1 and v_today + 30
        and e.status not in ('exited','archived');
    v_note := 'Relative to today; the date range does not apply.';

  when 'completed_exits' then
    perform hr_private.ra_attrition(v_from, v_to, false);
    v_title := 'Completed exits';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"category","label":"Category"},{"key":"joining_date","label":"Joined"},{"key":"last_working_date","label":"Last working day"},{"key":"tenure_years","label":"Tenure (years)"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', e.employee_code, 'employee', e.name, 'department', e.department, 'category', x.category,
             'joining_date', e.joining_date, 'last_working_date', e.last_working_date, 'tenure_years', x.tenure_years) order by e.last_working_date desc, e.name), '[]') into v_rows
      from pg_temp.ra_exit x join pg_temp.ra_emp e on e.id = x.employee_id;
  end case;

  perform set_config('hr.filter_legal_entity', '', true);
  return jsonb_build_object('report', p_report, 'title', v_title, 'from', v_from, 'to', v_to, 'columns', v_cols,
           'rows', coalesce(v_rows, '[]'::jsonb), 'total', jsonb_array_length(coalesce(v_rows, '[]'::jsonb)),
           'scope', case when hr_private.has_permission('reports.view') then 'company' else 'team' end,
           'generated_at', now(), 'note', v_note, 'filters_ignored', v_ignored);
end $$;

-- ---------------------------------------------------------------------
-- 5. Paging, status filter, totals
-- ---------------------------------------------------------------------
-- Columns never summed (ratios, ratings, identifiers, dates, balances-as-of).
create or replace function hr_private.ra_is_summable(p_key text)
returns boolean language sql immutable set search_path = '' as $$
  select p_key !~ '(pct|rating|avg|level|year|days_left|days_overdue|score|code|_date|_at|^date$|^from$|^to$|tenure|^employee$)'
$$;

create or replace function hr_private.ra_report_full(
  p_report text, p_from date, p_to date, p_department uuid, p_manager uuid, p_employment_type text,
  p_legal_entity uuid, p_employee uuid, p_location uuid, p_status text)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare r jsonb; v_rows jsonb; v_statuses jsonb; v_totals jsonb;
begin
  if p_status is not null and length(p_status) > 40 then perform hr_private.fail('Invalid status filter.', 'invalid_filter'); end if;
  perform hr_private.ra_set_filters(null, p_employee, p_location);
  r := public.hr_report(p_report, p_from, p_to, p_department, p_manager, p_employment_type, p_legal_entity);
  perform hr_private.ra_clear_filters();
  v_rows := coalesce(r -> 'rows', '[]'::jsonb);
  select coalesce(jsonb_agg(distinct x ->> 'status') filter (where x ->> 'status' is not null), '[]') into v_statuses from jsonb_array_elements(v_rows) x;
  if p_status is not null then
    select coalesce(jsonb_agg(x order by o), '[]') into v_rows from jsonb_array_elements(v_rows) with ordinality t(x, o) where x ->> 'status' = p_status;
  end if;
  select coalesce(jsonb_object_agg(k, s), '{}') into v_totals from (
    select c ->> 'key' k, sum((x ->> (c ->> 'key'))::numeric) filter (where jsonb_typeof(x -> (c ->> 'key')) = 'number') s
    from jsonb_array_elements(r -> 'columns') c cross join jsonb_array_elements(v_rows) x
    where hr_private.ra_is_summable(c ->> 'key')
    group by c ->> 'key'
    having bool_and(jsonb_typeof(x -> (c ->> 'key')) in ('number','null')) and bool_or(jsonb_typeof(x -> (c ->> 'key')) = 'number')) t;
  return r || jsonb_build_object('rows', v_rows, 'total', jsonb_array_length(v_rows), 'status_values', v_statuses, 'totals', v_totals,
    'filters', jsonb_strip_nulls(jsonb_build_object('department', p_department, 'manager', p_manager, 'employment_type', p_employment_type,
                                                    'legal_entity', p_legal_entity, 'employee', p_employee, 'location', p_location, 'status', p_status)));
end $$;

create or replace function public.hr_report_page(
  p_report text, p_from date default null, p_to date default null, p_department uuid default null,
  p_manager uuid default null, p_employment_type text default null, p_legal_entity uuid default null,
  p_employee uuid default null, p_location uuid default null, p_status text default null,
  p_offset int default 0, p_limit int default 50)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare r jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then perform hr_private.fail('Page size must be between 1 and 500.', 'invalid_filter'); end if;
  if p_offset is null or p_offset < 0 then perform hr_private.fail('Invalid page.', 'invalid_filter'); end if;
  r := hr_private.ra_report_full(p_report, p_from, p_to, p_department, p_manager, p_employment_type, p_legal_entity, p_employee, p_location, p_status);
  return r || jsonb_build_object('offset', p_offset, 'limit', p_limit,
    'rows', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(r -> 'rows') with ordinality t(x, o)
                      where o > p_offset and o <= p_offset + p_limit), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 6. Export: server-enforced permission, row cap, audit
-- ---------------------------------------------------------------------
create or replace function public.hr_report_export(
  p_source text, p_key text, p_format text, p_from date default null, p_to date default null,
  p_department uuid default null, p_manager uuid default null, p_employment_type text default null,
  p_legal_entity uuid default null, p_employee uuid default null, p_location uuid default null, p_status text default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_max constant int := 50000;
  v_payroll boolean := (p_source = 'analytics' and p_key = 'payroll') or (p_source = 'report' and p_key like 'payroll%');
  r jsonb; v_rows int;
begin
  if p_source not in ('report','analytics') then perform hr_private.fail('Unknown export source.', 'invalid_filter'); end if;
  if p_format not in ('csv','xlsx','pdf') then perform hr_private.fail('Unsupported export format.', 'invalid_filter'); end if;
  if not hr_private.has_permission('reports.export') then
    perform hr_private.fail('You do not have permission to export reports.', 'forbidden');
  end if;
  if v_payroll and not hr_private.has_permission('payroll.export') then
    perform hr_private.fail('Exporting payroll data needs payroll export permission.', 'forbidden');
  end if;
  -- Confidential evaluations: exporting them needs an explicit performance
  -- permission (defence in depth on top of the review RLS).
  if ((p_source = 'analytics' and p_key = 'performance') or (p_source = 'report' and p_key = 'performance_summary'))
     and not hr_private.any_permission(array['performance.view','performance.view_team','performance.manage']) then
    perform hr_private.fail('Exporting performance data needs performance access.', 'forbidden');
  end if;

  if p_source = 'report' then
    r := hr_private.ra_report_full(p_key, p_from, p_to, p_department, p_manager, p_employment_type, p_legal_entity, p_employee, p_location, p_status);
    v_rows := (r ->> 'total')::int;
  else
    r := public.hr_report_analytics(p_key, p_from, p_to, p_department, p_manager, p_employment_type, p_legal_entity, p_employee, p_location);
    select coalesce(sum(jsonb_array_length(s -> 'rows')), 0) into v_rows from jsonb_array_elements(r -> 'sections') s;
  end if;
  if v_rows > v_max then
    perform hr_private.fail(format('This export has %s rows (limit %s). Narrow the filters or the date range.', v_rows, v_max), 'too_many_rows');
  end if;

  -- Audit WHO exported WHAT and with which filters — never the row data.
  perform hr_private.audit_event('report_export', case when v_payroll then 'hr_payroll_report' else 'hr_report' end, p_key,
    jsonb_strip_nulls(jsonb_build_object('source', p_source, 'format', p_format, 'rows', v_rows, 'from', r ->> 'from', 'to', r ->> 'to',
      'department', p_department, 'manager', p_manager, 'employment_type', p_employment_type, 'legal_entity', p_legal_entity,
      'employee', p_employee, 'location', p_location, 'status', p_status, 'scope', r ->> 'scope')));
  return r || jsonb_build_object('export', jsonb_build_object('format', p_format, 'rows', v_rows, 'exported_at', now()));
end $$;

-- ---------------------------------------------------------------------
-- 7. Employee self-service summary (own records only, caller RLS)
-- ---------------------------------------------------------------------
create or replace function public.hr_my_report_summary(p_from date default null, p_to date default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_from date := coalesce(p_from, date_trunc('month', hr_private.business_today())::date);
  v_to date := coalesce(p_to, hr_private.business_today());
  v_win date; m jsonb; c record;
begin
  if v_me is null then perform hr_private.fail('Your account is not linked to an employee record.', 'forbidden'); end if;
  perform hr_private.ra_validate(v_from, v_to, null);
  v_win := greatest(v_from, v_to - 92);
  perform hr_private.ra_load_self();
  perform hr_private.ra_load_attendance(v_win, v_to);
  m := hr_private.ra_att_metrics(coalesce((select array_agg(kind) from pg_temp.ra_att), '{}'));
  select count(*) filter (where kind = 'late') late, count(*) filter (where kind = 'leave') leave_days,
         round(coalesce(sum(worked_minutes), 0) / 60.0, 2) worked into c from pg_temp.ra_att;

  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'generated_at', now(),
    'attendance', m || jsonb_build_object('late', c.late, 'leave_days', c.leave_days, 'worked_hours', c.worked,
                     'window_from', v_win, 'window_to', least(v_to, hr_private.business_today() - 1)),
    'leave', jsonb_build_object(
      'balances', coalesce((select jsonb_agg(jsonb_build_object('leave_type', t.name, 'credited', b.accrued + b.carried_forward + b.adjusted,
                    'used', b.used, 'pending', b.pending, 'available', b.available) order by t.sort_order, t.name)
                  from public.hr_leave_balances b join public.hr_leave_types t on t.id = b.leave_type_id
                  where b.employee_id = v_me and b.year = extract(year from v_to)::int), '[]'::jsonb),
      'requests', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.hr_leave_requests
                  where employee_id = v_me and status <> 'draft' and start_date between v_from and v_to group by 1) s), '{}'::jsonb),
      'approved_days', coalesce((select sum(days) from public.hr_leave_requests where employee_id = v_me and status = 'approved'
                  and start_date between v_from and v_to), 0)),
    'payslips', coalesce((select jsonb_agg(jsonb_build_object('period_start', p.period_start, 'period_end', p.period_end, 'currency', p.currency,
                  'gross', p.gross, 'deductions', p.total_deductions, 'net', p.net, 'published_at', p.published_at) order by p.period_start desc)
                from public.hr_payslips p where p.employee_id = v_me and p.published_at is not null
                  and p.period_start <= v_to and p.period_end >= (v_to - 366)), '[]'::jsonb),
    'daily_work', (select jsonb_build_object('submitted', count(*) filter (where status in ('submitted','under_review','reviewed','revision_requested')),
                    'reviewed', count(*) filter (where status = 'reviewed'), 'revision_requested', count(*) filter (where status = 'revision_requested'),
                    'drafts', count(*) filter (where status = 'draft'), 'hours', coalesce(sum(total_hours) filter (where status <> 'draft'), 0))
                  from public.hr_daily_reports where employee_id = v_me and report_date between v_from and v_to),
    'performance', coalesce((select jsonb_agg(jsonb_build_object('cycle', cy.name, 'period_end', cy.period_end, 'final_rating', pr.final_rating,
                  'finalized_at', pr.finalized_at) order by cy.period_end desc)
                from public.hr_performance_reviews pr join public.hr_review_cycles cy on cy.id = pr.cycle_id
                where pr.employee_id = v_me and pr.status = 'finalized'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.hr_report(text, date, date, uuid, uuid, text, uuid) from anon, public;
grant execute on function public.hr_report(text, date, date, uuid, uuid, text, uuid) to authenticated;
revoke execute on function public.hr_report_analytics(text, date, date, uuid, uuid, text, uuid, uuid, uuid) from anon, public;
grant execute on function public.hr_report_analytics(text, date, date, uuid, uuid, text, uuid, uuid, uuid) to authenticated;
revoke execute on function public.hr_report_page(text, date, date, uuid, uuid, text, uuid, uuid, uuid, text, int, int) from anon, public;
grant execute on function public.hr_report_page(text, date, date, uuid, uuid, text, uuid, uuid, uuid, text, int, int) to authenticated;
revoke execute on function public.hr_report_export(text, text, text, date, date, uuid, uuid, text, uuid, uuid, uuid, text) from anon, public;
grant execute on function public.hr_report_export(text, text, text, date, date, uuid, uuid, text, uuid, uuid, uuid, text) to authenticated;
revoke execute on function public.hr_my_report_summary(date, date) from anon, public;
grant execute on function public.hr_my_report_summary(date, date) to authenticated;
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

-- =====================================================================
-- 112_hr_dashboard_reports.sql — HR Dashboard metrics + HR Reports
-- =====================================================================
-- Every function here is SECURITY INVOKER: all counts and rows are computed
-- under the CALLER's Row Level Security, so totals always equal the records
-- that user is authorised to see. Team-scoped users (dashboard.view_team /
-- reports.view_team) are additionally limited to their reporting line.
-- Sections for modules the caller cannot access are returned as null
-- (never a misleading zero).
-- =====================================================================

-- Employees in scope for the caller + filters (RLS applies: invoker).
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
    and (hr_private.has_permission(p_all_permission) or hr_private.is_manager_of(e.id))
$$;

-- Next occurrence (on or after p_today) of the month/day of p_date. Interval
-- arithmetic maps 29 Feb to 28 Feb in non-leap years.
create or replace function hr_private.next_anniversary(p_date date, p_today date)
returns date language sql immutable set search_path = '' as $$
  select case when this_year < p_today then (p_date + make_interval(years => yrs + 1))::date else this_year end
  from (select (p_date + make_interval(years => yrs))::date this_year, yrs
        from (select (extract(year from p_today) - extract(year from p_date))::int yrs) y) z
$$;
create or replace function hr_private.is_working_day_for(p_employee uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_date)::smallint = any (hr_private.employee_working_days(p_employee))
     and not hr_private.is_holiday(p_date, p_employee)
$$;

create or replace function hr_private.any_permission(p_keys text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from unnest(p_keys) k where hr_private.has_permission(k))
$$;

-- ---------------------------------------------------------------------
-- HR Dashboard
-- ---------------------------------------------------------------------
create or replace function public.hr_dashboard(
  p_from date default null, p_to date default null, p_department uuid default null,
  p_employment_type text default null, p_manager uuid default null, p_status text default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_today date := hr_private.business_today();
  v_from date := coalesce(p_from, date_trunc('month', hr_private.business_today())::date);
  v_to date := coalesce(p_to, hr_private.business_today());
  v_all boolean := hr_private.has_permission('dashboard.view');
  r jsonb := '{}'::jsonb;
  k jsonb := '{}'::jsonb;
begin
  if not (v_all or hr_private.has_permission('dashboard.view_team')) then
    perform hr_private.fail('You do not have access to the HR dashboard.', 'forbidden');
  end if;
  if v_to < v_from then perform hr_private.fail('The end date is before the start date.', 'invalid_range'); end if;
  if v_to - v_from > 366 then perform hr_private.fail('Choose a range of at most one year.', 'range_too_long'); end if;

  create temp table if not exists pg_temp.dash_emp (id uuid primary key, status text, employment_type text, department_id uuid,
    joining_date date, probation_end_date date, contract_end_date date, first_name text, last_name text, display_name text, employee_code text) on commit drop;
  truncate pg_temp.dash_emp;
  insert into pg_temp.dash_emp
  select id, status, employment_type, department_id, joining_date, probation_end_date, contract_end_date, first_name, last_name, display_name, employee_code
  from hr_private.scoped_employees('dashboard.view', p_department, p_manager, p_employment_type, p_status);

  -- ---- headline KPIs (people)
  k := k || jsonb_build_object(
    'total_employees', (select count(*) from pg_temp.dash_emp),
    'active_employees', (select count(*) from pg_temp.dash_emp where status in ('active','probation','notice_period')),
    'interns', (select count(*) from pg_temp.dash_emp where employment_type = 'intern'),
    'on_probation', (select count(*) from pg_temp.dash_emp where status = 'probation' or (probation_end_date >= v_today and status not in ('notice_period','suspended'))),
    'notice_period', (select count(*) from pg_temp.dash_emp where status = 'notice_period'),
    'contract_expirations_60d', (select count(*) from pg_temp.dash_emp where contract_end_date between v_today and v_today + 60));

  -- ---- attendance (null if no attendance access)
  if hr_private.any_permission(array['attendance.view','attendance.view_team']) then
    k := k || jsonb_build_object(
      'present_today', (select count(*) from public.hr_attendance a join pg_temp.dash_emp e on e.id = a.employee_id
                        where a.work_date = v_today and a.status in ('present','late','half_day')),
      'late_today', (select count(*) from public.hr_attendance a join pg_temp.dash_emp e on e.id = a.employee_id
                     where a.work_date = v_today and (a.status = 'late' or a.late_minutes > 0)),
      'on_leave_today', (select count(*) from pg_temp.dash_emp e where e.status in ('active','probation','notice_period') and hr_private.is_on_approved_leave(e.id, v_today)),
      'absent_today', (select count(*) from pg_temp.dash_emp e
                       where e.status in ('active','probation','notice_period') and (e.joining_date is null or e.joining_date <= v_today)
                         and hr_private.is_working_day_for(e.id, v_today) and not hr_private.is_on_approved_leave(e.id, v_today)
                         and not exists (select 1 from public.hr_attendance a where a.employee_id = e.id and a.work_date = v_today and a.check_in_at is not null)));
    r := r || jsonb_build_object('attendance_overview', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d, 'present', pr, 'late', lt, 'half_day', hd, 'absent', ab, 'on_leave', ol, 'missing_punch', mp) order by d), '[]'::jsonb)
      from (
        select d::date d,
          count(*) filter (where a.status = 'present') pr, count(*) filter (where a.status = 'late') lt,
          count(*) filter (where a.status = 'half_day') hd, count(*) filter (where a.status = 'absent') ab,
          count(*) filter (where a.status = 'on_leave') ol, count(*) filter (where a.status = 'missing_punch') mp
        from generate_series(greatest(v_from, v_to - 30), v_to, interval '1 day') d
        left join public.hr_attendance a on a.work_date = d::date and a.employee_id in (select id from pg_temp.dash_emp)
        group by d) x));
  else
    k := k || jsonb_build_object('present_today', null, 'late_today', null, 'on_leave_today', null, 'absent_today', null);
    r := r || jsonb_build_object('attendance_overview', null);
  end if;

  -- ---- leave
  if hr_private.any_permission(array['leave.view','leave.view_team','leave.approve','leave.approve_team']) then
    k := k || jsonb_build_object('pending_leave_approvals', (
      select count(*) from public.hr_leave_requests l join pg_temp.dash_emp e on e.id = l.employee_id where l.status = 'pending_approval'));
    r := r || jsonb_build_object('leave_overview', (
      select coalesce(jsonb_agg(jsonb_build_object('leave_type', t.name, 'approved_days', ad, 'pending_requests', pr) order by t.sort_order), '[]'::jsonb)
      from public.hr_leave_types t
      cross join lateral (
        select coalesce(sum(l.days) filter (where l.status = 'approved'), 0) ad, count(*) filter (where l.status = 'pending_approval') pr
        from public.hr_leave_requests l join pg_temp.dash_emp e on e.id = l.employee_id
        where l.leave_type_id = t.id and l.start_date <= v_to and l.end_date >= v_from) s
      where t.active));
  else
    k := k || jsonb_build_object('pending_leave_approvals', null);
    r := r || jsonb_build_object('leave_overview', null);
  end if;

  -- ---- daily reports
  if hr_private.any_permission(array['daily_reports.view','daily_reports.view_team']) then
    k := k || jsonb_build_object(
      'pending_daily_reports', (select count(*) from public.hr_daily_reports d join pg_temp.dash_emp e on e.id = d.employee_id where d.status in ('submitted','under_review')),
      'missing_daily_reports_today', (select count(*) from public.hr_missing_daily_reports(v_today) m where m.employee_id in (select id from pg_temp.dash_emp)));
    r := r || jsonb_build_object('daily_report_status', (
      select jsonb_build_object(
        'date', v_today,
        'submitted', count(*) filter (where d.status = 'submitted'), 'under_review', count(*) filter (where d.status = 'under_review'),
        'reviewed', count(*) filter (where d.status = 'reviewed'), 'revision_requested', count(*) filter (where d.status = 'revision_requested'))
      from public.hr_daily_reports d join pg_temp.dash_emp e on e.id = d.employee_id where d.report_date = v_today));
  else
    k := k || jsonb_build_object('pending_daily_reports', null, 'missing_daily_reports_today', null);
    r := r || jsonb_build_object('daily_report_status', null);
  end if;

  -- ---- HR requests (RLS: requester / hr_requests.view / manage)
  if hr_private.any_permission(array['hr_requests.view','hr_requests.manage']) then
    k := k || jsonb_build_object('pending_hr_requests', (select count(*) from public.hr_requests q where q.status in ('open','in_progress','waiting_on_employee')));
  else
    k := k || jsonb_build_object('pending_hr_requests', null);
  end if;

  -- ---- recruitment
  if hr_private.any_permission(array['recruitment.view','recruitment.manage']) then
    k := k || jsonb_build_object(
      'open_positions', (select coalesce(sum(o.openings), 0) from public.hr_job_openings o where o.status = 'open'),
      'candidates_in_pipeline', (select count(*) from public.hr_candidate_applications a where a.stage not in ('rejected','withdrawn','joined')));
    r := r || jsonb_build_object('recruitment_pipeline', (
      select coalesce(jsonb_agg(jsonb_build_object('stage', s.stage, 'count', coalesce(c.n, 0)) order by s.ord), '[]'::jsonb)
      from (values ('applied',1),('screening',2),('shortlisted',3),('interview',4),('selected',5),('offered',6),('joined',7),('rejected',8)) s(stage, ord)
      left join (select stage, count(*) n from public.hr_candidate_applications group by stage) c on c.stage = s.stage));
  else
    k := k || jsonb_build_object('open_positions', null, 'candidates_in_pipeline', null);
    r := r || jsonb_build_object('recruitment_pipeline', null);
  end if;

  -- ---- documents
  if hr_private.any_permission(array['documents.view','documents.view_team','documents.manage']) then
    k := k || jsonb_build_object('expiring_documents_30d', (
      select count(*) from public.hr_documents d join pg_temp.dash_emp e on e.id = d.employee_id
      where d.archived_at is null and d.expiry_date is not null and d.expiry_date <= v_today + 30));
  else
    k := k || jsonb_build_object('expiring_documents_30d', null);
  end if;

  -- ---- birthdays (PII: only with employees.view_sensitive)
  if hr_private.has_permission('employees.view_sensitive') then
    k := k || jsonb_build_object('upcoming_birthdays_30d', (
      select count(*) from public.hr_employee_private p join pg_temp.dash_emp e on e.id = p.employee_id
      where p.date_of_birth is not null
        and hr_private.next_anniversary(p.date_of_birth, v_today) - v_today between 0 and 30));
  else
    k := k || jsonb_build_object('upcoming_birthdays_30d', null);
  end if;

  r := r || jsonb_build_object('kpis', k);

  -- ---- department headcount
  r := r || jsonb_build_object('department_headcount', (
    select coalesce(jsonb_agg(jsonb_build_object('department', coalesce(dp.name, 'Unassigned'), 'headcount', n, 'interns', ni) order by n desc), '[]'::jsonb)
    from (select department_id, count(*) n, count(*) filter (where employment_type = 'intern') ni from pg_temp.dash_emp group by department_id) x
    left join public.hr_departments dp on dp.id = x.department_id));

  -- ---- pending approvals (counts the caller can act on / see)
  r := r || jsonb_build_object('pending_approvals', jsonb_build_object(
    'leave', k -> 'pending_leave_approvals',
    'attendance_corrections', case when hr_private.any_permission(array['attendance.approve','attendance.approve_team','attendance.view','attendance.view_team'])
      then (select count(*) from public.hr_attendance_corrections c join pg_temp.dash_emp e on e.id = c.employee_id where c.status = 'pending') end,
    'daily_reports', k -> 'pending_daily_reports',
    'asset_requests', case when hr_private.any_permission(array['assets.view','assets.manage'])
      then (select count(*) from public.hr_asset_requests q where q.status = 'pending') end,
    'exits', case when hr_private.any_permission(array['exit.view','exit.view_team','exit.manage'])
      then (select count(*) from public.hr_exits x join pg_temp.dash_emp e on e.id = x.employee_id where x.status in ('submitted','manager_review','hr_review')) end,
    'hr_requests', k -> 'pending_hr_requests'));

  -- ---- upcoming events (next 30 days)
  r := r || jsonb_build_object('upcoming_events', (
    select coalesce(jsonb_agg(ev order by (ev ->> 'date')), '[]'::jsonb) from (
      select jsonb_build_object('type', 'work_anniversary', 'date', hr_private.next_anniversary(e.joining_date, v_today),
                                'employee', coalesce(e.display_name, e.first_name || ' ' || e.last_name), 'employee_id', e.id,
                                'years', extract(year from age(hr_private.next_anniversary(e.joining_date, v_today), e.joining_date))::int) ev
      from pg_temp.dash_emp e
      where e.joining_date is not null and e.joining_date <= v_today - 365
        and hr_private.next_anniversary(e.joining_date, v_today) between v_today and v_today + 30
      union all
      select jsonb_build_object('type', 'probation_end', 'date', e.probation_end_date, 'employee', coalesce(e.display_name, e.first_name || ' ' || e.last_name), 'employee_id', e.id)
      from pg_temp.dash_emp e where e.probation_end_date between v_today and v_today + 30
      union all
      select jsonb_build_object('type', 'contract_end', 'date', e.contract_end_date, 'employee', coalesce(e.display_name, e.first_name || ' ' || e.last_name), 'employee_id', e.id)
      from pg_temp.dash_emp e where e.contract_end_date between v_today and v_today + 30
      union all
      select jsonb_build_object('type', 'holiday', 'date', h.holiday_date, 'name', h.name)
      from public.hr_holidays h where h.holiday_date between v_today and v_today + 30 and h.type <> 'optional'
    ) s));

  -- ---- announcements (RLS: visible to caller)
  r := r || jsonb_build_object('announcements', (
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'category', a.category, 'published_at', a.published_at) order by a.published_at desc), '[]'::jsonb)
    from (select * from public.hr_announcements where status = 'published' order by published_at desc limit 5) a));

  -- ---- recent HR activity (employment history visible to the caller)
  r := r || jsonb_build_object('recent_activity', (
    select coalesce(jsonb_agg(jsonb_build_object('at', h.changed_at, 'type', h.change_type, 'old', h.old_value, 'new', h.new_value,
                                                 'employee', coalesce(e.display_name, e.first_name || ' ' || e.last_name), 'employee_id', e.id) order by h.changed_at desc), '[]'::jsonb)
    from (select * from public.hr_employee_history hh where hh.employee_id in (select id from pg_temp.dash_emp) order by hh.changed_at desc limit 12) h
    join pg_temp.dash_emp e on e.id = h.employee_id));

  return r || jsonb_build_object('scope', case when v_all then 'company' else 'team' end, 'from', v_from, 'to', v_to, 'today', v_today,
                                 'generated_at', now());
end $$;

-- ---------------------------------------------------------------------
-- HR Reports: hr_report(report, from, to, department, manager, employment type)
-- returns { report, title, columns: [{key,label}], rows: [...], total }.
-- ---------------------------------------------------------------------
create or replace function public.hr_report(
  p_report text, p_from date default null, p_to date default null, p_department uuid default null,
  p_manager uuid default null, p_employment_type text default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', hr_private.business_today())::date);
  v_to date := coalesce(p_to, hr_private.business_today());
  v_today date := hr_private.business_today();
  v_rows jsonb; v_cols jsonb; v_title text;
begin
  if not hr_private.any_permission(array['reports.view','reports.view_team']) then
    perform hr_private.fail('You do not have access to HR reports.', 'forbidden');
  end if;
  if v_to < v_from then perform hr_private.fail('The end date is before the start date.', 'invalid_range'); end if;
  if v_to - v_from > 366 then perform hr_private.fail('Choose a range of at most one year.', 'range_too_long'); end if;

  create temp table if not exists pg_temp.rep_emp (id uuid primary key, employee_code text, name text, status text, employment_type text,
    department_id uuid, department text, manager_id uuid, joining_date date, last_working_date date) on commit drop;
  truncate pg_temp.rep_emp;
  insert into pg_temp.rep_emp
  select e.id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), e.status, e.employment_type,
         e.department_id, coalesce(d.name, 'Unassigned'), e.manager_id, e.joining_date, e.last_working_date
  from hr_private.scoped_employees('reports.view', p_department, p_manager, p_employment_type, null,
         p_report in ('employee_status','exit_summary','payroll_summary','leave_history','attendance_summary','document_expiry')) e
  left join public.hr_departments d on d.id = e.department_id;

  case p_report
  when 'headcount' then
    v_title := 'Employee headcount';
    v_cols := '[{"key":"department","label":"Department"},{"key":"employment_type","label":"Employment type"},{"key":"headcount","label":"Headcount"}]';
    select coalesce(jsonb_agg(jsonb_build_object('department', department, 'employment_type', employment_type, 'headcount', n) order by department, employment_type), '[]')
      into v_rows from (select department, employment_type, count(*) n from pg_temp.rep_emp group by 1, 2) x;

  when 'department_distribution' then
    v_title := 'Department distribution';
    v_cols := '[{"key":"department","label":"Department"},{"key":"headcount","label":"Headcount"},{"key":"interns","label":"Interns"},{"key":"avg_tenure_months","label":"Avg tenure (months)"}]';
    select coalesce(jsonb_agg(jsonb_build_object('department', department, 'headcount', n, 'interns', ni, 'avg_tenure_months', t) order by n desc), '[]')
      into v_rows from (select department, count(*) n, count(*) filter (where employment_type = 'intern') ni,
                               round(avg(((v_today - joining_date) / 30.44)::numeric) filter (where joining_date is not null), 1) t
                        from pg_temp.rep_emp group by department) x;

  when 'employee_status' then
    v_title := 'Employee status';
    v_cols := '[{"key":"status","label":"Status"},{"key":"count","label":"Employees"}]';
    select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', n) order by n desc), '[]')
      into v_rows from (select status, count(*) n from pg_temp.rep_emp group by status) x;

  when 'attendance_summary' then
    v_title := 'Attendance summary';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"present","label":"Present"},{"key":"late","label":"Late"},{"key":"half_day","label":"Half day"},{"key":"absent","label":"Absent (recorded)"},{"key":"missing_punch","label":"Missing punch"},{"key":"on_leave","label":"On leave"},{"key":"worked_hours","label":"Worked hours"},{"key":"overtime_hours","label":"Overtime hours"}]';
    select coalesce(jsonb_agg(row order by row ->> 'employee'), '[]') into v_rows from (
      select jsonb_build_object('employee_code', e.employee_code, 'employee', e.name, 'department', e.department,
        'present', count(a.*) filter (where a.status = 'present'), 'late', count(a.*) filter (where a.status = 'late'),
        'half_day', count(a.*) filter (where a.status = 'half_day'), 'absent', count(a.*) filter (where a.status = 'absent'),
        'missing_punch', count(a.*) filter (where a.status = 'missing_punch'), 'on_leave', count(a.*) filter (where a.status = 'on_leave'),
        'worked_hours', round(coalesce(sum(a.worked_minutes), 0) / 60.0, 2), 'overtime_hours', round(coalesce(sum(a.overtime_minutes), 0) / 60.0, 2)) row
      from pg_temp.rep_emp e left join public.hr_attendance a on a.employee_id = e.id and a.work_date between v_from and v_to
      group by e.id, e.employee_code, e.name, e.department) x;

  when 'late_arrivals' then
    v_title := 'Late arrivals';
    v_cols := '[{"key":"date","label":"Date"},{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"check_in_at","label":"Check-in"},{"key":"late_minutes","label":"Minutes late"}]';
    select coalesce(jsonb_agg(jsonb_build_object('date', a.work_date, 'employee_code', e.employee_code, 'employee', e.name, 'department', e.department,
                                                 'check_in_at', a.check_in_at, 'late_minutes', a.late_minutes) order by a.work_date desc, e.name), '[]')
      into v_rows from public.hr_attendance a join pg_temp.rep_emp e on e.id = a.employee_id
      where a.work_date between v_from and v_to and a.late_minutes > 0;

  when 'absence' then
    v_title := 'Absence report';
    if v_to - v_from > 92 then perform hr_private.fail('The absence report covers at most 93 days.', 'range_too_long'); end if;
    v_cols := '[{"key":"date","label":"Date"},{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"reason","label":"Basis"}]';
    select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'employee_code', e.employee_code, 'employee', e.name, 'department', e.department,
                                                 'reason', case when a.status = 'absent' then 'marked absent' else 'no check-in on a working day' end) order by d desc, e.name), '[]')
      into v_rows
      from pg_temp.rep_emp e cross join generate_series(v_from, least(v_to, v_today - 1), interval '1 day') d
      left join public.hr_attendance a on a.employee_id = e.id and a.work_date = d::date
      where e.status in ('active','probation','notice_period')
        and (e.joining_date is null or e.joining_date <= d::date)
        and hr_private.is_working_day_for(e.id, d::date)
        and not hr_private.is_on_approved_leave(e.id, d::date)
        and (a.id is null or a.status = 'absent' or (a.check_in_at is null and a.status not in ('on_leave','holiday','weekend')))
        and (hr_private.any_permission(array['attendance.view','attendance.view_team']));

  when 'leave_balances' then
    v_title := 'Leave balances';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"leave_type","label":"Leave type"},{"key":"year","label":"Year"},{"key":"entitled","label":"Entitled"},{"key":"accrued","label":"Accrued"},{"key":"carried_forward","label":"Carried forward"},{"key":"adjusted","label":"Adjusted"},{"key":"used","label":"Used"},{"key":"pending","label":"Pending"},{"key":"available","label":"Available"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', e.employee_code, 'employee', e.name, 'leave_type', t.name, 'year', b.year,
             'entitled', b.entitled, 'accrued', b.accrued, 'carried_forward', b.carried_forward, 'adjusted', b.adjusted, 'used', b.used,
             'pending', b.pending, 'available', b.available) order by e.name, t.sort_order), '[]')
      into v_rows from public.hr_leave_balances b join pg_temp.rep_emp e on e.id = b.employee_id join public.hr_leave_types t on t.id = b.leave_type_id
      where b.year = extract(year from v_to)::int;

  when 'leave_history' then
    v_title := 'Leave history';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"leave_type","label":"Leave type"},{"key":"start_date","label":"From"},{"key":"end_date","label":"To"},{"key":"days","label":"Days"},{"key":"status","label":"Status"},{"key":"decided_at","label":"Decided"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', e.employee_code, 'employee', e.name, 'leave_type', t.name, 'start_date', l.start_date,
             'end_date', l.end_date, 'days', l.days, 'status', l.status, 'decided_at', l.decided_at) order by l.start_date desc), '[]')
      into v_rows from public.hr_leave_requests l join pg_temp.rep_emp e on e.id = l.employee_id join public.hr_leave_types t on t.id = l.leave_type_id
      where l.start_date <= v_to and l.end_date >= v_from;

  when 'daily_report_compliance' then
    v_title := 'Daily report compliance';
    if v_to - v_from > 92 then perform hr_private.fail('The compliance report covers at most 93 days.', 'range_too_long'); end if;
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"working_days","label":"Working days"},{"key":"submitted","label":"Submitted"},{"key":"missing","label":"Missing"},{"key":"compliance_pct","label":"Compliance %"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', employee_code, 'employee', name, 'department', department, 'working_days', wd,
             'submitted', sub, 'missing', greatest(wd - sub, 0), 'compliance_pct', case when wd = 0 then null else round(100.0 * least(sub, wd) / wd, 1) end) order by name), '[]')
      into v_rows from (
        select e.employee_code, e.name, e.department,
          (select count(*) from generate_series(greatest(v_from, coalesce(e.joining_date, v_from)), least(v_to, v_today), interval '1 day') d
            where hr_private.is_working_day_for(e.id, d::date) and not hr_private.is_on_approved_leave(e.id, d::date)) wd,
          (select count(*) from public.hr_daily_reports r where r.employee_id = e.id and r.report_date between v_from and v_to
            and r.status in ('submitted','under_review','reviewed','revision_requested')) sub
        from pg_temp.rep_emp e where e.status in ('active','probation','notice_period')
          and hr_private.any_permission(array['daily_reports.view','daily_reports.view_team'])) x;

  when 'project_activity' then
    v_title := 'Project-wise employee activity';
    v_cols := '[{"key":"project","label":"Project"},{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"reports","label":"Reports"},{"key":"hours","label":"Hours logged"}]';
    select coalesce(jsonb_agg(jsonb_build_object('project', coalesce(p.name, 'Internal / no project'), 'employee_code', e.employee_code, 'employee', e.name,
             'reports', n, 'hours', h) order by coalesce(p.name, 'zzz'), e.name), '[]')
      into v_rows from (
        select i.project_id, r.employee_id, count(distinct r.id) n, round(sum(i.hours), 2) h
        from public.hr_daily_report_items i join public.hr_daily_reports r on r.id = i.report_id
        where r.report_date between v_from and v_to and r.status in ('submitted','under_review','reviewed','revision_requested')
        group by 1, 2) x
      join pg_temp.rep_emp e on e.id = x.employee_id left join public.hr_projects p on p.id = x.project_id;

  when 'recruitment_pipeline' then
    if not hr_private.any_permission(array['recruitment.view','recruitment.manage']) then
      perform hr_private.fail('Recruitment reports need recruitment access.', 'forbidden');
    end if;
    v_title := 'Recruitment pipeline';
    v_cols := '[{"key":"opening","label":"Opening"},{"key":"status","label":"Status"},{"key":"openings","label":"Openings"},{"key":"applied","label":"Applied"},{"key":"screening","label":"Screening"},{"key":"shortlisted","label":"Shortlisted"},{"key":"interview","label":"Interview"},{"key":"selected","label":"Selected"},{"key":"offered","label":"Offered"},{"key":"joined","label":"Joined"},{"key":"rejected","label":"Rejected"}]';
    select coalesce(jsonb_agg(row order by row ->> 'opening'), '[]') into v_rows from (
      select jsonb_build_object('opening', o.title, 'status', o.status, 'openings', o.openings,
             'applied', count(a.*) filter (where a.stage = 'applied'), 'screening', count(a.*) filter (where a.stage = 'screening'),
             'shortlisted', count(a.*) filter (where a.stage = 'shortlisted'), 'interview', count(a.*) filter (where a.stage = 'interview'),
             'selected', count(a.*) filter (where a.stage = 'selected'), 'offered', count(a.*) filter (where a.stage = 'offered'),
             'joined', count(a.*) filter (where a.stage = 'joined'), 'rejected', count(a.*) filter (where a.stage = 'rejected')) row
      from public.hr_job_openings o left join public.hr_candidate_applications a on a.opening_id = o.id
      where (p_department is null or o.department_id = p_department) and (o.created_at::date <= v_to)
      group by o.id, o.title, o.status, o.openings) x;

  when 'intern_progress' then
    v_title := 'Intern progress';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Intern"},{"key":"department","label":"Department"},{"key":"start_date","label":"Start"},{"key":"end_date","label":"End"},{"key":"status","label":"Status"},{"key":"evaluations","label":"Finalized evaluations"},{"key":"avg_rating","label":"Avg rating"},{"key":"certificate_eligible","label":"Certificate eligible"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', e.employee_code, 'employee', e.name, 'department', e.department, 'start_date', i.start_date,
             'end_date', i.end_date, 'status', i.status, 'evaluations', ev.n, 'avg_rating', ev.avg_rating, 'certificate_eligible', i.certificate_eligible) order by e.name), '[]')
      into v_rows from public.hr_internships i join pg_temp.rep_emp e on e.id = i.employee_id
      cross join lateral (select count(*) n, round(avg(x.overall_rating), 2) avg_rating from public.hr_intern_evaluations x
                          where x.internship_id = i.id and x.status = 'finalized') ev
      where i.start_date <= v_to and (i.end_date is null or i.end_date >= v_from);

  when 'payroll_summary' then
    if not hr_private.has_permission('payroll.view') then
      perform hr_private.fail('Payroll reports require payroll access.', 'forbidden');
    end if;
    v_title := 'Payroll summary';
    v_cols := '[{"key":"period","label":"Period"},{"key":"status","label":"Status"},{"key":"employees","label":"Employees"},{"key":"gross","label":"Gross"},{"key":"deductions","label":"Deductions"},{"key":"reimbursements","label":"Reimbursements"},{"key":"net","label":"Net"}]';
    select coalesce(jsonb_agg(row order by ps desc), '[]') into v_rows from (
      select r.period_start ps, jsonb_build_object('period', r.period_start || ' – ' || r.period_end, 'status', r.status,
             'employees', count(i.*), 'gross', coalesce(sum(i.gross), 0), 'deductions', coalesce(sum(i.total_deductions), 0),
             'reimbursements', coalesce(sum(i.reimbursements), 0), 'net', coalesce(sum(i.net), 0)) row
      from public.hr_payroll_runs r
      left join public.hr_payroll_items i on i.run_id = r.id and i.employee_id in (select id from pg_temp.rep_emp)
      where r.period_start <= v_to and r.period_end >= v_from
      group by r.id, r.period_start, r.period_end, r.status) x;

  when 'performance_summary' then
    v_title := 'Performance summary';
    v_cols := '[{"key":"cycle","label":"Cycle"},{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"status","label":"Status"},{"key":"self_rating","label":"Self"},{"key":"manager_rating","label":"Manager"},{"key":"goal_score","label":"Goal score"},{"key":"final_rating","label":"Final"}]';
    select coalesce(jsonb_agg(jsonb_build_object('cycle', c.name, 'employee_code', e.employee_code, 'employee', e.name, 'status', pr.status,
             'self_rating', pr.self_rating, 'manager_rating', pr.manager_rating, 'goal_score', pr.goal_score, 'final_rating', pr.final_rating)
             order by c.period_start desc, e.name), '[]')
      into v_rows from public.hr_performance_reviews pr join public.hr_review_cycles c on c.id = pr.cycle_id
      join pg_temp.rep_emp e on e.id = pr.employee_id
      where c.period_start <= v_to and c.period_end >= v_from;

  when 'document_expiry' then
    v_title := 'Document expiry';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"title","label":"Document"},{"key":"expiry_date","label":"Expiry"},{"key":"days_left","label":"Days left"},{"key":"verification_status","label":"Status"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', e.employee_code, 'employee', e.name, 'title', d.title, 'expiry_date', d.expiry_date,
             'days_left', d.expiry_date - v_today, 'verification_status', d.verification_status) order by d.expiry_date), '[]')
      into v_rows from public.hr_documents d join pg_temp.rep_emp e on e.id = d.employee_id
      where d.archived_at is null and d.expiry_date is not null and d.expiry_date <= v_to;

  when 'asset_assignment' then
    v_title := 'Asset assignment';
    v_cols := '[{"key":"asset_tag","label":"Asset tag"},{"key":"asset_type","label":"Type"},{"key":"model","label":"Brand / model"},{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"assigned_at","label":"Assigned"},{"key":"expected_return_date","label":"Expected return"},{"key":"acknowledged","label":"Acknowledged"}]';
    select coalesce(jsonb_agg(jsonb_build_object('asset_tag', a.asset_tag, 'asset_type', a.asset_type, 'model', btrim(coalesce(a.brand, '') || ' ' || coalesce(a.model, '')),
             'employee_code', e.employee_code, 'employee', e.name, 'assigned_at', s.assigned_at, 'expected_return_date', s.expected_return_date,
             'acknowledged', s.acknowledged_at is not null) order by a.asset_tag), '[]')
      into v_rows from public.hr_asset_assignments s join public.hr_assets a on a.id = s.asset_id join pg_temp.rep_emp e on e.id = s.employee_id
      where s.status = 'active';

  when 'exit_summary' then
    v_title := 'Employee exit summary';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"department","label":"Department"},{"key":"exit_type","label":"Type"},{"key":"resignation_date","label":"Resignation"},{"key":"last_working_day","label":"Last working day"},{"key":"status","label":"Status"},{"key":"closed_at","label":"Closed"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', e.employee_code, 'employee', e.name, 'department', e.department, 'exit_type', x.exit_type,
             'resignation_date', x.resignation_date, 'last_working_day', coalesce(x.approved_last_working_day, x.proposed_last_working_day),
             'status', x.status, 'closed_at', x.closed_at) order by coalesce(x.approved_last_working_day, x.proposed_last_working_day) desc nulls last), '[]')
      into v_rows from public.hr_exits x join pg_temp.rep_emp e on e.id = x.employee_id
      where coalesce(x.resignation_date, x.created_at::date) <= v_to
        and coalesce(x.approved_last_working_day, x.proposed_last_working_day, v_to) >= v_from;

  else
    perform hr_private.fail('Unknown report.', 'unknown_report');
  end case;

  return jsonb_build_object('report', p_report, 'title', v_title, 'from', v_from, 'to', v_to, 'columns', v_cols,
                            'rows', coalesce(v_rows, '[]'::jsonb), 'total', jsonb_array_length(coalesce(v_rows, '[]'::jsonb)),
                            'scope', case when hr_private.has_permission('reports.view') then 'company' else 'team' end,
                            'generated_at', now());
end $$;

revoke execute on function public.hr_dashboard(date, date, uuid, text, uuid, text) from anon, public;
grant execute on function public.hr_dashboard(date, date, uuid, text, uuid, text) to authenticated;
revoke execute on function public.hr_report(text, date, date, uuid, uuid, text) from anon, public;
grant execute on function public.hr_report(text, date, date, uuid, uuid, text) to authenticated;

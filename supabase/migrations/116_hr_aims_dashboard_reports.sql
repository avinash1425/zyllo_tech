-- =====================================================================
-- 116_hr_aims_dashboard_reports.sql — Dashboard analytics, report
-- templates and HR request types aligned with the AIMS ERP reference
-- =====================================================================
-- Depends on 100–115. The tested hr_dashboard() / hr_report() bodies from
-- 112 are kept unchanged: they move to hr_private as *_core and the public
-- functions become thin wrappers that
--   * add an optional legal-entity (company) filter, applied through
--     hr_private.scoped_employees() so every existing KPI/report honours it;
--   * add new sections / report templates that only read data that exists.
-- Everything stays SECURITY INVOKER (caller RLS); sections a caller cannot
-- access are null, never a misleading zero.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Company filter inside the shared scope function (same signature).
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
    and (hr_private.has_permission(p_all_permission) or hr_private.is_manager_of(e.id))
$$;

alter function public.hr_dashboard(date, date, uuid, text, uuid, text) set schema hr_private;
alter function hr_private.hr_dashboard(date, date, uuid, text, uuid, text) rename to hr_dashboard_core;
alter function public.hr_report(text, date, date, uuid, uuid, text) set schema hr_private;
alter function hr_private.hr_report(text, date, date, uuid, uuid, text) rename to hr_report_core;

-- Label helpers
create or replace function hr_private.arrangement_label(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'office' then 'Office (WFO)' when 'remote' then 'Remote (WFH)' when 'hybrid' then 'Hybrid' else 'Not recorded' end
$$;
create or replace function hr_private.tenure_band(p_joined date, p_today date)
returns text language sql immutable set search_path = '' as $$
  select case when p_joined is null then 'Not recorded'
              when p_joined > p_today then 'Joining soon'
              when age(p_today, p_joined) < interval '1 year' then 'Under 1 year'
              when age(p_today, p_joined) < interval '3 years' then '1–3 years'
              when age(p_today, p_joined) < interval '5 years' then '3–5 years'
              when age(p_today, p_joined) < interval '10 years' then '5–10 years'
              else '10+ years' end
$$;
create or replace function hr_private.tenure_band_order(p text)
returns int language sql immutable set search_path = '' as $$
  select case p when 'Joining soon' then 0 when 'Under 1 year' then 1 when '1–3 years' then 2 when '3–5 years' then 3
                when '5–10 years' then 4 when '10+ years' then 5 else 9 end
$$;

-- Field-level completeness over the employees in pg_temp.x_emp (caller RLS).
create or replace function hr_private.completeness_rows()
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare v_total bigint; v_rows jsonb := '[]'::jsonb; v_sens boolean := hr_private.has_permission('employees.view_sensitive');
  v_id boolean := hr_private.has_permission('employees.view_identity');
begin
  select count(*) into v_total from pg_temp.x_emp;
  if v_total = 0 then return '[]'::jsonb; end if;
  -- One pass over the employees (each table read once; RLS evaluated once per row).
  with c as (
    select count(e.company_email) c1, count(e.legal_entity_id) c2, count(e.department_id) c3, count(e.designation_id) c4, count(e.grade_id) c5,
           count(e.manager_id) c6, count(e.work_location_id) c7, count(e.employment_type) c8, count(e.work_arrangement) c9, count(e.joining_date) c10,
           count(e.contract_type) c11, count(e.notice_period_days) c12,
           count(p.date_of_birth) p1, count(p.gender) p2, count(p.nationality) p3, count(p.phone) p4, count(p.emergency_contact_phone) p5,
           count(*) filter (where i.national_id_number is not null or i.passport_number is not null) i1
    from pg_temp.x_emp x
    join public.hr_employees e on e.id = x.id
    left join public.hr_employee_private p on v_sens and p.employee_id = x.id
    left join public.hr_employee_identity i on v_id and i.employee_id = x.id
  )
  select jsonb_agg(jsonb_build_object('field', f, 'label', l, 'group', g, 'filled', n, 'total', v_total, 'pct', round(100.0 * n / v_total, 1)) order by o)
    into v_rows
  from c cross join lateral (values
    (1, 'company_email', 'Work email', 'Contact', c.c1, true), (2, 'legal_entity', 'Company / legal entity', 'Employment', c.c2, true),
    (3, 'department', 'Department', 'Employment', c.c3, true), (4, 'designation', 'Position / designation', 'Employment', c.c4, true),
    (5, 'grade', 'Grade / band', 'Employment', c.c5, true), (6, 'manager', 'Reporting manager', 'Employment', c.c6, true),
    (7, 'work_location', 'Work location', 'Employment', c.c7, true), (8, 'employment_type', 'Employment type', 'Employment', c.c8, true),
    (9, 'work_arrangement', 'WFO / WFH / hybrid', 'Employment', c.c9, true), (10, 'joining_date', 'Joining date', 'Employment', c.c10, true),
    (11, 'contract_type', 'Contract type', 'Contract', c.c11, true), (12, 'notice_period', 'Notice period', 'Contract', c.c12, true),
    (20, 'date_of_birth', 'Date of birth', 'Personal', c.p1, v_sens), (21, 'gender', 'Gender', 'Personal', c.p2, v_sens),
    (22, 'nationality', 'Nationality', 'Personal', c.p3, v_sens), (23, 'phone', 'Mobile number', 'Contact', c.p4, v_sens),
    (24, 'emergency_contact', 'Emergency contact', 'Contact', c.p5, v_sens),
    (30, 'identity', 'National ID or passport', 'Identification', c.i1, v_id)
  ) v(o, f, l, g, n, show)
  where v.show;
  return coalesce(v_rows, '[]'::jsonb);
end $$;

create or replace function hr_private.load_x_emp(p_all_permission text, p_department uuid, p_manager uuid, p_type text, p_status text, p_include_former boolean)
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  create temp table if not exists pg_temp.x_emp (id uuid primary key, employee_code text, name text, status text, employment_type text, legal_entity_id uuid,
    department_id uuid, designation_id uuid, grade_id uuid, work_location_id uuid, manager_id uuid, work_arrangement text, deployment_status text,
    deployment_client text, deployment_project_code text, deployment_start_date date, deployment_end_date date, joining_date date,
    probation_end_date date, contract_type text, contract_end_date date) on commit drop;
  truncate pg_temp.x_emp;
  insert into pg_temp.x_emp
  select id, employee_code, coalesce(display_name, btrim(first_name || ' ' || last_name)), status, employment_type, legal_entity_id,
         department_id, designation_id, grade_id, work_location_id, manager_id, work_arrangement, deployment_status,
         deployment_client, deployment_project_code, deployment_start_date, deployment_end_date, joining_date,
         probation_end_date, contract_type, contract_end_date
  from hr_private.scoped_employees(p_all_permission, p_department, p_manager, p_type, p_status, p_include_former);
end $$;

-- ---------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------
create or replace function public.hr_dashboard(
  p_from date default null, p_to date default null, p_department uuid default null,
  p_employment_type text default null, p_manager uuid default null, p_status text default null,
  p_legal_entity uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  r jsonb; k jsonb; x jsonb := '{}'::jsonb;
  v_from date; v_to date; v_today date;
  v_sens boolean := hr_private.has_permission('employees.view_sensitive');
begin
  perform set_config('hr.filter_legal_entity', coalesce(p_legal_entity::text, ''), true);
  r := hr_private.hr_dashboard_core(p_from, p_to, p_department, p_employment_type, p_manager, p_status);
  v_from := (r ->> 'from')::date; v_to := (r ->> 'to')::date; v_today := (r ->> 'today')::date;
  perform hr_private.load_x_emp('dashboard.view', p_department, p_manager, p_employment_type, p_status, false);
  k := r -> 'kpis';

  k := k || jsonb_build_object(
    'new_joiners', (select count(*) from pg_temp.x_emp where joining_date between v_from and v_to),
    'deployed_employees', (select count(*) from pg_temp.x_emp where deployment_status = 'deployed'));

  x := x || jsonb_build_object(
    'by_company', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(le.name, 'Unassigned'), 'id', x.legal_entity_id, 'count', n) order by n desc, le.name), '[]')
                   from (select legal_entity_id, count(*) n from pg_temp.x_emp group by 1) x left join public.hr_legal_entities le on le.id = x.legal_entity_id),
    'by_location', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(l.name, 'Unassigned'), 'count', n) order by n desc, l.name), '[]')
                    from (select work_location_id, count(*) n from pg_temp.x_emp group by 1) x left join public.hr_locations l on l.id = x.work_location_id),
    'by_employment_type', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(t.name, x.employment_type), 'count', n) order by n desc), '[]')
                           from (select employment_type, count(*) n from pg_temp.x_emp group by 1) x left join public.hr_employment_types t on t.code = x.employment_type),
    'by_grade', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(g.name, 'Not recorded'), 'count', n) order by g.level nulls last, g.name), '[]')
                 from (select grade_id, count(*) n from pg_temp.x_emp group by 1) x left join public.hr_grades g on g.id = x.grade_id),
    'by_work_arrangement', (select coalesce(jsonb_agg(jsonb_build_object('label', hr_private.arrangement_label(work_arrangement), 'count', n) order by n desc), '[]')
                            from (select work_arrangement, count(*) n from pg_temp.x_emp group by 1) x),
    'tenure_bands', (select coalesce(jsonb_agg(jsonb_build_object('label', b, 'count', n) order by hr_private.tenure_band_order(b)), '[]')
                     from (select hr_private.tenure_band(joining_date, v_today) b, count(*) n from pg_temp.x_emp group by 1) x),
    'new_joiners_list', (select coalesce(jsonb_agg(jsonb_build_object('employee_id', x.id, 'employee', x.name, 'employee_code', x.employee_code,
                            'department', d.name, 'joining_date', x.joining_date) order by x.joining_date desc), '[]')
                         from (select * from pg_temp.x_emp where joining_date between v_from and v_to order by joining_date desc limit 8) x
                         left join public.hr_departments d on d.id = x.department_id),
    'deployment', case when exists (select 1 from pg_temp.x_emp where deployment_status is not null) then jsonb_build_object(
        'by_status', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(replace(deployment_status, '_', ' '), 'Not recorded'), 'count', n) order by n desc), '[]')
                      from (select deployment_status, count(*) n from pg_temp.x_emp group by 1) s),
        'by_client', (select coalesce(jsonb_agg(jsonb_build_object('label', deployment_client, 'count', n) order by n desc, deployment_client), '[]')
                      from (select deployment_client, count(*) n from pg_temp.x_emp where deployment_status = 'deployed' group by 1 order by 2 desc limit 10) c)) end,
    'data_completeness', hr_private.completeness_rows());

  -- Demographics: only with access to personal data.
  if v_sens then
    x := x || jsonb_build_object(
      'by_nationality', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(n.nat, 'Not recorded'), 'count', n.c) order by n.c desc, n.nat), '[]')
                         from (select p.nationality nat, count(*) c from pg_temp.x_emp e left join public.hr_employee_private p on p.employee_id = e.id group by 1 order by 2 desc limit 15) n),
      'by_gender', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(initcap(replace(g.gender, '_', ' ')), 'Not recorded'), 'count', g.c) order by g.c desc), '[]')
                    from (select p.gender, count(*) c from pg_temp.x_emp e left join public.hr_employee_private p on p.employee_id = e.id group by 1) g));
  else
    x := x || jsonb_build_object('by_nationality', null, 'by_gender', null);
  end if;

  -- Identity documents (identity officers only).
  if hr_private.has_permission('employees.view_identity') then
    k := k || jsonb_build_object('expiring_identity_60d', (select count(*) from public.hr_expiring_identity_documents(60) d where d.employee_id in (select id from pg_temp.x_emp)));
  else
    k := k || jsonb_build_object('expiring_identity_60d', null);
  end if;

  -- Training
  if hr_private.any_permission(array['training.view','training.view_team']) then
    x := x || jsonb_build_object('training_summary', (
      select jsonb_build_object(
        'assigned', count(*) filter (where a.status = 'assigned'),
        'in_progress', count(*) filter (where a.status = 'in_progress'),
        'completed_in_period', count(*) filter (where a.status = 'completed' and a.completion_date between v_from and v_to),
        'overdue', count(*) filter (where a.status in ('assigned','in_progress') and a.due_date < v_today),
        'unverified', count(*) filter (where a.status = 'completed' and a.verified_at is null))
      from public.hr_training_assignments a where a.employee_id in (select id from pg_temp.x_emp)));
    k := k || jsonb_build_object('training_overdue', (x -> 'training_summary' ->> 'overdue')::int);
  else
    x := x || jsonb_build_object('training_summary', null);
    k := k || jsonb_build_object('training_overdue', null);
  end if;

  -- Benefits
  if hr_private.any_permission(array['benefits.view','benefits.manage']) then
    x := x || jsonb_build_object('benefits_summary', (
      select coalesce(jsonb_agg(jsonb_build_object('label', t.name, 'count', s.n) order by s.n desc, t.name), '[]')
      from public.hr_benefit_types t
      cross join lateral (select count(*) n from public.hr_benefit_enrollments b
                          where b.benefit_type_id = t.id and b.status = 'active' and b.employee_id in (select id from pg_temp.x_emp)) s
      where t.active));
    k := k || jsonb_build_object('active_benefit_enrollments', (select count(*) from public.hr_benefit_enrollments b
                                  where b.status = 'active' and b.employee_id in (select id from pg_temp.x_emp)));
  else
    x := x || jsonb_build_object('benefits_summary', null);
    k := k || jsonb_build_object('active_benefit_enrollments', null);
  end if;

  perform set_config('hr.filter_legal_entity', '', true);
  return r || x || jsonb_build_object('kpis', k, 'legal_entity', p_legal_entity);
end $$;

-- ---------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------
create or replace function public.hr_report(
  p_report text, p_from date default null, p_to date default null, p_department uuid default null,
  p_manager uuid default null, p_employment_type text default null, p_legal_entity uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', hr_private.business_today())::date);
  v_to date := coalesce(p_to, hr_private.business_today());
  v_today date := hr_private.business_today();
  v_rows jsonb; v_cols jsonb; v_title text; v_total bigint;
  v_new text[] := array['workforce_by_company','workforce_by_location','workforce_by_grade','employment_type_breakdown','new_joiners',
    'tenure_bands','nationality_mix','gender_mix','age_bands','org_units','reporting_lines','deployment_summary','deployment_roster',
    'data_completeness','identity_expiry','identity_compliance','contract_expiry','probation_due','benefits_enrollment','benefits_roster',
    'training_completion','training_overdue'];
  r jsonb;
begin
  perform set_config('hr.filter_legal_entity', coalesce(p_legal_entity::text, ''), true);
  if not (p_report = any (v_new)) then
    r := hr_private.hr_report_core(p_report, p_from, p_to, p_department, p_manager, p_employment_type);
    perform set_config('hr.filter_legal_entity', '', true);
    return r;
  end if;

  if not hr_private.any_permission(array['reports.view','reports.view_team']) then
    perform hr_private.fail('You do not have access to HR reports.', 'forbidden');
  end if;
  if v_to < v_from then perform hr_private.fail('The end date is before the start date.', 'invalid_range'); end if;
  if v_to - v_from > 366 then perform hr_private.fail('Choose a range of at most one year.', 'range_too_long'); end if;
  perform hr_private.load_x_emp('reports.view', p_department, p_manager, p_employment_type, null, false);
  select count(*) into v_total from pg_temp.x_emp;

  case p_report
  when 'workforce_by_company' then
    v_title := 'Headcount by company';
    v_cols := '[{"key":"company","label":"Company / legal entity"},{"key":"country","label":"Country"},{"key":"headcount","label":"Headcount"},{"key":"active","label":"Active"},{"key":"interns","label":"Interns"},{"key":"pct","label":"% of total"}]';
    select coalesce(jsonb_agg(jsonb_build_object('company', coalesce(le.name, 'Unassigned'), 'country', le.country, 'headcount', n, 'active', a, 'interns', i,
             'pct', round(100.0 * n / nullif(v_total, 0), 1)) order by n desc), '[]') into v_rows
      from (select legal_entity_id, count(*) n, count(*) filter (where status in ('active','probation','notice_period')) a,
                   count(*) filter (where employment_type = 'intern') i from pg_temp.x_emp group by 1) x
      left join public.hr_legal_entities le on le.id = x.legal_entity_id;

  when 'workforce_by_location' then
    v_title := 'Headcount by work location';
    v_cols := '[{"key":"location","label":"Work location"},{"key":"city","label":"City"},{"key":"headcount","label":"Headcount"},{"key":"office","label":"WFO"},{"key":"remote","label":"WFH"},{"key":"hybrid","label":"Hybrid"}]';
    select coalesce(jsonb_agg(jsonb_build_object('location', coalesce(l.name, 'Unassigned'), 'city', l.city, 'headcount', n, 'office', o, 'remote', rm, 'hybrid', h) order by n desc), '[]') into v_rows
      from (select work_location_id, count(*) n, count(*) filter (where work_arrangement = 'office') o, count(*) filter (where work_arrangement = 'remote') rm,
                   count(*) filter (where work_arrangement = 'hybrid') h from pg_temp.x_emp group by 1) x
      left join public.hr_locations l on l.id = x.work_location_id;

  when 'workforce_by_grade' then
    v_title := 'Headcount by grade / band';
    v_cols := '[{"key":"grade","label":"Grade / band"},{"key":"level","label":"Level"},{"key":"headcount","label":"Headcount"}]';
    select coalesce(jsonb_agg(jsonb_build_object('grade', coalesce(g.name, 'Not recorded'), 'level', g.level, 'headcount', n) order by g.level nulls last, g.name), '[]') into v_rows
      from (select grade_id, count(*) n from pg_temp.x_emp group by 1) x left join public.hr_grades g on g.id = x.grade_id;

  when 'employment_type_breakdown' then
    v_title := 'Employment type breakdown';
    v_cols := '[{"key":"employment_type","label":"Employment type"},{"key":"headcount","label":"Headcount"},{"key":"pct","label":"% of total"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employment_type', coalesce(t.name, x.employment_type), 'headcount', n, 'pct', round(100.0 * n / nullif(v_total, 0), 1)) order by n desc), '[]') into v_rows
      from (select employment_type, count(*) n from pg_temp.x_emp group by 1) x left join public.hr_employment_types t on t.code = x.employment_type;

  when 'new_joiners' then
    v_title := 'New joiners';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"company","label":"Company"},{"key":"department","label":"Department"},{"key":"designation","label":"Designation"},{"key":"employment_type","label":"Type"},{"key":"joining_date","label":"Joined"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', x.employee_code, 'employee', x.name, 'company', le.name, 'department', d.name, 'designation', g.name,
             'employment_type', x.employment_type, 'joining_date', x.joining_date) order by x.joining_date desc, x.name), '[]') into v_rows
      from pg_temp.x_emp x left join public.hr_legal_entities le on le.id = x.legal_entity_id
      left join public.hr_departments d on d.id = x.department_id left join public.hr_designations g on g.id = x.designation_id
      where x.joining_date between v_from and v_to;

  when 'tenure_bands' then
    v_title := 'Employee tenure';
    v_cols := '[{"key":"band","label":"Tenure"},{"key":"headcount","label":"Headcount"},{"key":"pct","label":"% of total"}]';
    select coalesce(jsonb_agg(jsonb_build_object('band', b, 'headcount', n, 'pct', round(100.0 * n / nullif(v_total, 0), 1)) order by hr_private.tenure_band_order(b)), '[]') into v_rows
      from (select hr_private.tenure_band(joining_date, v_to) b, count(*) n from pg_temp.x_emp group by 1) x;

  when 'nationality_mix', 'gender_mix', 'age_bands' then
    if not hr_private.has_permission('employees.view_sensitive') then
      perform hr_private.fail('Demographic reports need access to personal data (employees.view_sensitive).', 'forbidden');
    end if;
    if p_report = 'nationality_mix' then
      v_title := 'Nationality mix';
      v_cols := '[{"key":"nationality","label":"Nationality (ISO code)"},{"key":"headcount","label":"Headcount"},{"key":"pct","label":"% of total"}]';
      select coalesce(jsonb_agg(jsonb_build_object('nationality', coalesce(nat, 'Not recorded'), 'headcount', n, 'pct', round(100.0 * n / nullif(v_total, 0), 1)) order by n desc), '[]') into v_rows
        from (select p.nationality nat, count(*) n from pg_temp.x_emp x left join public.hr_employee_private p on p.employee_id = x.id group by 1) s;
    elsif p_report = 'gender_mix' then
      v_title := 'Gender distribution';
      v_cols := '[{"key":"gender","label":"Gender"},{"key":"headcount","label":"Headcount"},{"key":"pct","label":"% of total"}]';
      select coalesce(jsonb_agg(jsonb_build_object('gender', coalesce(initcap(replace(gender, '_', ' ')), 'Not recorded'), 'headcount', n, 'pct', round(100.0 * n / nullif(v_total, 0), 1)) order by n desc), '[]') into v_rows
        from (select p.gender, count(*) n from pg_temp.x_emp x left join public.hr_employee_private p on p.employee_id = x.id group by 1) s;
    else
      v_title := 'Age bands';
      v_cols := '[{"key":"band","label":"Age"},{"key":"headcount","label":"Headcount"}]';
      select coalesce(jsonb_agg(jsonb_build_object('band', b, 'headcount', n) order by o), '[]') into v_rows from (
        select case when a is null then 'Not recorded' when a < 25 then 'Under 25' when a < 35 then '25–34' when a < 45 then '35–44' when a < 55 then '45–54' else '55+' end b,
               case when a is null then 9 when a < 25 then 1 when a < 35 then 2 when a < 45 then 3 when a < 55 then 4 else 5 end o, count(*) n
        from (select extract(year from age(v_to, p.date_of_birth))::int a from pg_temp.x_emp x left join public.hr_employee_private p on p.employee_id = x.id) y
        group by 1, 2) s;
    end if;

  when 'org_units' then
    v_title := 'Organisation units';
    v_cols := '[{"key":"code","label":"Code"},{"key":"unit","label":"Unit"},{"key":"unit_type","label":"Type"},{"key":"parent","label":"Parent unit"},{"key":"company","label":"Company"},{"key":"head","label":"Head"},{"key":"headcount","label":"Headcount"}]';
    select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'unit', d.name, 'unit_type', d.unit_type, 'parent', p.name, 'company', le.name,
             'head', coalesce(h.display_name, btrim(h.first_name || ' ' || h.last_name)),
             'headcount', (select count(*) from pg_temp.x_emp x where x.department_id = d.id)) order by coalesce(p.name, d.name), d.name), '[]') into v_rows
      from public.hr_departments d left join public.hr_departments p on p.id = d.parent_id
      left join public.hr_legal_entities le on le.id = d.legal_entity_id left join public.hr_employees h on h.id = d.head_employee_id
      where d.active and (p_department is null or d.id = p_department) and (p_legal_entity is null or d.legal_entity_id = p_legal_entity);

  when 'reporting_lines' then
    v_title := 'Reporting lines';
    v_cols := '[{"key":"manager_code","label":"Manager ID"},{"key":"manager","label":"Manager"},{"key":"department","label":"Department"},{"key":"direct_reports","label":"Direct reports"}]';
    select coalesce(jsonb_agg(jsonb_build_object('manager_code', m.employee_code, 'manager', coalesce(m.display_name, btrim(m.first_name || ' ' || m.last_name)),
             'department', d.name, 'direct_reports', n) order by n desc, m.first_name), '[]') into v_rows
      from (select manager_id, count(*) n from pg_temp.x_emp where manager_id is not null group by 1) x
      join public.hr_employees m on m.id = x.manager_id left join public.hr_departments d on d.id = m.department_id;

  when 'deployment_summary' then
    v_title := 'Deployment summary';
    v_cols := '[{"key":"client","label":"Client"},{"key":"projects","label":"Projects / job numbers"},{"key":"deployed","label":"Deployed employees"}]';
    select coalesce(jsonb_agg(jsonb_build_object('client', deployment_client, 'projects', p, 'deployed', n) order by n desc, deployment_client), '[]') into v_rows
      from (select deployment_client, string_agg(distinct deployment_project_code, ', ') p, count(*) n from pg_temp.x_emp
            where deployment_status = 'deployed' group by 1) x;

  when 'deployment_roster' then
    v_title := 'Deployment roster';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"status","label":"Deployment"},{"key":"client","label":"Client"},{"key":"project","label":"Project / job no."},{"key":"start_date","label":"From"},{"key":"end_date","label":"To"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', employee_code, 'employee', name, 'status', deployment_status, 'client', deployment_client,
             'project', deployment_project_code, 'start_date', deployment_start_date, 'end_date', deployment_end_date) order by deployment_client nulls last, name), '[]') into v_rows
      from pg_temp.x_emp where deployment_status is not null;

  when 'data_completeness' then
    v_title := 'Employee data completeness';
    v_cols := '[{"key":"group","label":"Section"},{"key":"label","label":"Field"},{"key":"filled","label":"Recorded"},{"key":"total","label":"Employees"},{"key":"pct","label":"Complete %"}]';
    v_rows := hr_private.completeness_rows();

  when 'identity_expiry', 'identity_compliance' then
    if not hr_private.has_permission('employees.view_identity') then
      perform hr_private.fail('Identity reports need identity document access (employees.view_identity).', 'forbidden');
    end if;
    if p_report = 'identity_expiry' then
      v_title := 'Passport, visa & permit expiry';
      v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"document","label":"Document"},{"key":"number_last4","label":"Number (last 4)"},{"key":"expiry_date","label":"Expiry"},{"key":"days_left","label":"Days left"}]';
      select coalesce(jsonb_agg(jsonb_build_object('employee_code', d.employee_code, 'employee', d.employee_name, 'document', d.document, 'number_last4', d.number_last4,
               'expiry_date', d.expiry_date, 'days_left', d.days_left) order by d.expiry_date), '[]') into v_rows
        from public.hr_expiring_identity_documents(greatest(v_to - v_today, 0)) d where d.employee_id in (select id from pg_temp.x_emp);
    else
      v_title := 'Identity compliance (country rules)';
      v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"country","label":"Rules"},{"key":"missing","label":"Missing / expired"}]';
      select coalesce(jsonb_agg(jsonb_build_object('employee_code', employee_code, 'employee', name, 'country', c, 'missing', array_to_string(m, ', ')) order by name), '[]') into v_rows
        from (select x.employee_code, x.name, hr_private.employee_country(x.id) c, hr_private.identity_missing(x.id) m from pg_temp.x_emp x) s
        where cardinality(m) > 0;
    end if;

  when 'contract_expiry' then
    v_title := 'Contract expiry';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"contract_type","label":"Contract type"},{"key":"contract_end_date","label":"Contract end"},{"key":"days_left","label":"Days left"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', employee_code, 'employee', name, 'contract_type', contract_type, 'contract_end_date', contract_end_date,
             'days_left', contract_end_date - v_today) order by contract_end_date), '[]') into v_rows
      from pg_temp.x_emp where contract_end_date between v_from and v_to;

  when 'probation_due' then
    v_title := 'Probation reviews due';
    v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"joining_date","label":"Joined"},{"key":"probation_end_date","label":"Probation ends"},{"key":"status","label":"Status"}]';
    select coalesce(jsonb_agg(jsonb_build_object('employee_code', employee_code, 'employee', name, 'joining_date', joining_date, 'probation_end_date', probation_end_date,
             'status', status) order by probation_end_date), '[]') into v_rows
      from pg_temp.x_emp where probation_end_date between v_from and v_to;

  when 'benefits_enrollment', 'benefits_roster' then
    if not hr_private.any_permission(array['benefits.view','benefits.manage']) then
      perform hr_private.fail('Benefit reports need benefits access.', 'forbidden');
    end if;
    if p_report = 'benefits_enrollment' then
      v_title := 'Benefit enrollment summary';
      v_cols := '[{"key":"plan","label":"Plan"},{"key":"category","label":"Category"},{"key":"active","label":"Active"},{"key":"suspended","label":"Suspended"},{"key":"ended_in_period","label":"Ended in period"},{"key":"employer_contribution","label":"Employer contribution (active, per period)"}]';
      select coalesce(jsonb_agg(jsonb_build_object('plan', t.name, 'category', t.category, 'active', s.a, 'suspended', s.su, 'ended_in_period', s.en,
               'employer_contribution', s.ec) order by t.category, t.name), '[]') into v_rows
        from public.hr_benefit_types t cross join lateral (
          select count(*) filter (where b.status = 'active') a, count(*) filter (where b.status = 'suspended') su,
                 count(*) filter (where b.status = 'ended' and b.end_date between v_from and v_to) en,
                 coalesce(sum(b.employer_contribution) filter (where b.status = 'active'), 0) ec
          from public.hr_benefit_enrollments b where b.benefit_type_id = t.id and b.employee_id in (select id from pg_temp.x_emp)) s;
    else
      v_title := 'Benefit enrollments';
      v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"plan","label":"Plan"},{"key":"status","label":"Status"},{"key":"coverage_level","label":"Coverage"},{"key":"start_date","label":"From"},{"key":"end_date","label":"To"}]';
      select coalesce(jsonb_agg(jsonb_build_object('employee_code', x.employee_code, 'employee', x.name, 'plan', t.name, 'status', b.status,
               'coverage_level', b.coverage_level, 'start_date', b.start_date, 'end_date', b.end_date) order by x.name, t.name), '[]') into v_rows
        from public.hr_benefit_enrollments b join pg_temp.x_emp x on x.id = b.employee_id join public.hr_benefit_types t on t.id = b.benefit_type_id
        where b.start_date <= v_to and (b.end_date is null or b.end_date >= v_from);
    end if;

  when 'training_completion', 'training_overdue' then
    if not hr_private.any_permission(array['training.view','training.view_team']) then
      perform hr_private.fail('Training reports need training access.', 'forbidden');
    end if;
    if p_report = 'training_completion' then
      v_title := 'Training completion';
      v_cols := '[{"key":"course","label":"Course"},{"key":"mandatory","label":"Mandatory"},{"key":"assigned","label":"Open"},{"key":"completed","label":"Completed in period"},{"key":"passed","label":"Passed"},{"key":"overdue","label":"Overdue"},{"key":"completion_pct","label":"Completion %"}]';
      select coalesce(jsonb_agg(jsonb_build_object('course', c.title, 'mandatory', c.is_mandatory, 'assigned', s.op, 'completed', s.cp, 'passed', s.ps, 'overdue', s.od,
               'completion_pct', case when s.op + s.cp = 0 then null else round(100.0 * s.cp / (s.op + s.cp), 1) end) order by c.title), '[]') into v_rows
        from public.hr_training_courses c cross join lateral (
          select count(*) filter (where a.status in ('assigned','in_progress')) op,
                 count(*) filter (where a.status = 'completed' and a.completion_date between v_from and v_to) cp,
                 count(*) filter (where a.status = 'completed' and a.result = 'passed' and a.completion_date between v_from and v_to) ps,
                 count(*) filter (where a.status in ('assigned','in_progress') and a.due_date < v_today) od
          from public.hr_training_assignments a where a.course_id = c.id and a.employee_id in (select id from pg_temp.x_emp)) s
        where s.op + s.cp > 0;
    else
      v_title := 'Overdue training';
      v_cols := '[{"key":"employee_code","label":"ID"},{"key":"employee","label":"Employee"},{"key":"course","label":"Course"},{"key":"status","label":"Status"},{"key":"due_date","label":"Due"},{"key":"days_overdue","label":"Days overdue"}]';
      select coalesce(jsonb_agg(jsonb_build_object('employee_code', x.employee_code, 'employee', x.name, 'course', c.title, 'status', a.status, 'due_date', a.due_date,
               'days_overdue', v_today - a.due_date) order by a.due_date, x.name), '[]') into v_rows
        from public.hr_training_assignments a join pg_temp.x_emp x on x.id = a.employee_id join public.hr_training_courses c on c.id = a.course_id
        where a.status in ('assigned','in_progress') and a.due_date < v_today;
    end if;
  end case;

  perform set_config('hr.filter_legal_entity', '', true);
  return jsonb_build_object('report', p_report, 'title', v_title, 'from', v_from, 'to', v_to, 'columns', v_cols,
                            'rows', coalesce(v_rows, '[]'::jsonb), 'total', jsonb_array_length(coalesce(v_rows, '[]'::jsonb)),
                            'scope', case when hr_private.has_permission('reports.view') then 'company' else 'team' end,
                            'generated_at', now());
end $$;

revoke execute on function public.hr_dashboard(date, date, uuid, text, uuid, text, uuid) from anon, public;
grant execute on function public.hr_dashboard(date, date, uuid, text, uuid, text, uuid) to authenticated;
revoke execute on function public.hr_report(text, date, date, uuid, uuid, text, uuid) from anon, public;
grant execute on function public.hr_report(text, date, date, uuid, uuid, text, uuid) to authenticated;
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

-- ---------------------------------------------------------------------
-- HR request types (reference: profile updates, travel, letters, loans).
-- Leave is applied in Leave Management, never through HR Requests (no
-- duplicate approval chain); "leave_query" stays a question channel.
-- Loans / advances are off until the company enables them in HR Settings.
-- ---------------------------------------------------------------------
insert into public.hr_request_categories (code, name, description, default_assignee_role, sla_hours, is_confidential, active, sort_order) values
  ('profile_update', 'Profile update',       'Correction to personal, contact, bank or identity details held by HR', 'hr_admin', 72, false, true, 8),
  ('travel',         'Travel request',       'Business travel booking, visa letter or travel advance',                 'hr_admin', 72, false, true, 9),
  ('loan_advance',   'Loan / salary advance','Salary advance or employee loan (subject to company policy)',            'payroll_admin', 120, true, false, 10),
  ('benefits_query', 'Benefits query',       'Insurance, retirement or other benefit questions',                      'hr_admin', 72, false, true, 11),
  ('training_request','Training request',    'Request a course, certification or learning budget',                    'hr_admin', 120, false, true, 12)
on conflict (code) do nothing;
update public.hr_request_categories set name = 'Letter / certificate request' where code = 'document_request' and name = 'Document request';

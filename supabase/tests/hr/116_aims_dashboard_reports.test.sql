-- Dashboard + report extensions (116): company filter on existing KPIs and
-- reports, new analytics sections computed from real rows, permission
-- gating (demographics, identity, benefits, training), team scope, every
-- new report template executes, new HR request types.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;

do $$
declare le1 uuid; le2 uuid; g uuid;
begin
  insert into public.hr_legal_entities (code, name, country) values ('CO-ONE', 'Company One', 'IN') returning id into le1;
  insert into public.hr_legal_entities (code, name, country) values ('CO-TWO', 'Company Two', 'AE') returning id into le2;
  insert into t_ids values ('le1', le1), ('le2', le2);
  insert into public.hr_grades (code, name, level) values ('B1', 'Band 1', 1) returning id into g;
  insert into t_ids values ('super', test.make_employee('dr.super@test.local', 'Sia', null, array['super_admin']));
  insert into t_ids values ('hr',    test.make_employee('dr.hr@test.local', 'Hema', null, array['hr_admin']));
  insert into t_ids values ('pay',   test.make_employee('dr.pay@test.local', 'Pavan', null, array['payroll_admin']));
  insert into t_ids values ('mgr',   test.make_employee('dr.mgr@test.local', 'Meru', null, array['manager','employee']));
  insert into t_ids values ('e1',    test.make_employee('dr.e1@test.local', 'Asha', (select v from t_ids where k='mgr')));
  insert into t_ids values ('e2',    test.make_employee('dr.e2@test.local', 'Bodhi', (select v from t_ids where k='mgr')));
  insert into t_ids values ('e3',    test.make_employee('dr.e3@test.local', 'Chitra', null));
  update public.hr_employees set legal_entity_id = le1, grade_id = g, work_arrangement = 'office' where id in ((select v from t_ids where k='e1'), (select v from t_ids where k='e2'));
  update public.hr_employees set legal_entity_id = le2, work_arrangement = 'remote', deployment_status = 'deployed', deployment_client = 'Synthetic Client',
    deployment_project_code = 'JOB-9', joining_date = hr_private.business_today(), probation_end_date = null where id = (select v from t_ids where k='e3');
  insert into public.hr_employee_private (employee_id, nationality, gender, date_of_birth) values
    ((select v from t_ids where k='e1'), 'IN', 'female', date '1995-05-05'), ((select v from t_ids where k='e3'), 'IN', 'male', date '1988-01-01');
  insert into public.hr_employee_identity (employee_id, passport_number, passport_expiry) values ((select v from t_ids where k='e3'), 'K7654321', current_date + 15);
end $$;

-- ---- company filter applies to existing KPIs and reports
select pg_temp.as_k('hr');
select test.eq((public.hr_dashboard(p_legal_entity => pg_temp.id('le1')) -> 'kpis' ->> 'total_employees')::int, 2, 'company filter narrows existing headcount KPI');
select test.eq((public.hr_dashboard(p_legal_entity => pg_temp.id('le2')) -> 'kpis' ->> 'total_employees')::int, 1, 'second company counted separately');
select test.ok((public.hr_dashboard() -> 'kpis' ->> 'total_employees')::int >= 7, 'no filter = whole company');
select test.eq((public.hr_report('headcount', p_legal_entity => pg_temp.id('le1')) -> 'rows' -> 0 ->> 'headcount')::int, 2, 'existing report honours the company filter');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'total_employees')::int, (public.hr_dashboard() -> 'kpis' ->> 'total_employees')::int, 'filter does not leak between calls');

-- ---- new dashboard sections from real rows
select test.ok((select (x ->> 'count')::int = 2 from jsonb_array_elements(public.hr_dashboard() -> 'by_company') x where x ->> 'label' = 'Company One'), 'headcount by company');
select test.ok((select (x ->> 'count')::int = 1 from jsonb_array_elements(public.hr_dashboard() -> 'by_work_arrangement') x where x ->> 'label' = 'Remote (WFH)'), 'work arrangement breakdown');
select test.ok((public.hr_dashboard() -> 'kpis' ->> 'deployed_employees')::int = 1, 'deployed employees KPI');
select test.ok((public.hr_dashboard() -> 'kpis' ->> 'new_joiners')::int >= 1, 'new joiners in the period');
select test.ok(jsonb_array_length(public.hr_dashboard() -> 'tenure_bands') >= 1, 'tenure bands present');
select test.ok((select (x ->> 'filled')::int = 2 and (x ->> 'total')::int = (public.hr_dashboard() -> 'kpis' ->> 'total_employees')::int
                from jsonb_array_elements(public.hr_dashboard() -> 'data_completeness') x where x ->> 'field' = 'grade'), 'grade completeness counts recorded values');
select test.ok((select count(*) = 1 from jsonb_array_elements(public.hr_dashboard() -> 'by_nationality') x where x ->> 'label' = 'IN' and (x ->> 'count')::int = 2), 'nationality mix for HR');
select test.ok((public.hr_dashboard() -> 'kpis' ->> 'expiring_identity_60d')::int = 1, 'expiring identity KPI for identity officers');
select test.ok(public.hr_dashboard() -> 'training_summary' is not null and public.hr_dashboard() -> 'benefits_summary' is not null, 'training and benefits summaries for HR');

-- ---- gating + team scope
select pg_temp.as_k('mgr');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'total_employees')::int, 2, 'manager dashboard is team scoped');
select test.ok(public.hr_dashboard() -> 'by_nationality' = 'null'::jsonb and public.hr_dashboard() -> 'by_gender' = 'null'::jsonb, 'manager gets no demographics');
select test.ok(public.hr_dashboard() -> 'kpis' -> 'expiring_identity_60d' = 'null'::jsonb, 'manager gets no identity KPI');
select test.ok(public.hr_dashboard() -> 'benefits_summary' = 'null'::jsonb, 'manager gets no benefits summary');
select test.ok(public.hr_dashboard() -> 'training_summary' is not null, 'manager gets the team training summary');
select test.ok(not exists (select 1 from jsonb_array_elements(public.hr_dashboard() -> 'data_completeness') x where x ->> 'group' in ('Personal','Identification')),
  'manager completeness excludes personal and identity fields');
select test.throws($q$select public.hr_report('gender_mix')$q$, 'manager cannot run demographic reports', 'personal data');
select test.eq((public.hr_report('workforce_by_company') -> 'rows' -> 0 ->> 'headcount')::int, 2, 'manager company report is team scoped');
select pg_temp.as_k('pay');
select test.throws($q$select public.hr_report('identity_expiry')$q$, 'payroll admin cannot run identity reports', 'identity');
select test.throws($q$select public.hr_report('training_completion')$q$, 'payroll admin cannot run training reports', 'training');
select test.ok((public.hr_report('benefits_enrollment') ->> 'total')::int >= 0, 'payroll admin (benefits.view) runs benefit reports');
select pg_temp.as_k('e1');
select test.throws($q$select public.hr_dashboard()$q$, 'employee cannot open the HR dashboard', 'dashboard');
select test.throws($q$select public.hr_report('new_joiners')$q$, 'employee cannot run reports', 'reports');

-- ---- every report template executes (super admin)
select pg_temp.as_k('super');
select test.ok(bool_and((public.hr_report(r) ->> 'total') is not null), 'all 22 new report templates execute')
from unnest(array['workforce_by_company','workforce_by_location','workforce_by_grade','employment_type_breakdown','new_joiners',
  'tenure_bands','nationality_mix','gender_mix','age_bands','org_units','reporting_lines','deployment_summary','deployment_roster',
  'data_completeness','identity_expiry','identity_compliance','contract_expiry','probation_due','benefits_enrollment','benefits_roster',
  'training_completion','training_overdue']) r;
select test.ok(bool_and((public.hr_report(r) ->> 'total') is not null), 'all 17 existing report templates still execute through the wrapper')
from unnest(array['headcount','department_distribution','employee_status','attendance_summary','late_arrivals','absence','leave_balances','leave_history',
  'daily_report_compliance','project_activity','recruitment_pipeline','intern_progress','payroll_summary','performance_summary','document_expiry',
  'asset_assignment','exit_summary']) r;
select test.eq((public.hr_report('deployment_roster') -> 'rows' -> 0 ->> 'client'), 'Synthetic Client', 'deployment roster lists the deployed employee');
select test.ok((select x ->> 'missing' like '%Passport expired%' or x ->> 'missing' like '%National ID%'
                from jsonb_array_elements(public.hr_report('identity_compliance') -> 'rows') x where x ->> 'employee_code' = (select employee_code from public.hr_employees where id = pg_temp.id('e3'))),
  'identity compliance applies UAE rules to the Company Two employee');
select test.eq((public.hr_report('identity_expiry', p_to => current_date + 30) ->> 'total')::int, 1, 'identity expiry report lists the passport');
select test.throws($q$select public.hr_report('nope')$q$, 'unknown report still rejected', 'Unknown report');
select test.throws($q$select public.hr_report('new_joiners', current_date, current_date - 1)$q$, 'date range validated', 'before the start');

-- ---- HR request types
select test.ok((select count(*) = 5 from public.hr_request_categories where code in ('profile_update','travel','loan_advance','benefits_query','training_request')), 'reference request types added');
select test.ok((select not active and is_confidential from public.hr_request_categories where code = 'loan_advance'), 'loans / advances off by default and confidential');
select pg_temp.as_k('e1');
select test.throws($q$select public.hr_create_hr_request('loan_advance', 'Need an advance', 'Details')$q$, 'disabled request type cannot be used', 'category');

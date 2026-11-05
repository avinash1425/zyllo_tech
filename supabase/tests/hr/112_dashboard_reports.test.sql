-- Dashboard + reports: scoping by permission/RLS, KPI correctness, report
-- totals, forbidden cases, date helpers.
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select v from t_ids where k = p $$;
create or replace function pg_temp.su(p text) returns void language plpgsql as $$
declare u uuid; begin perform test.as_owner(); u := test.user_of(pg_temp.id(p)); perform test.as_user(u); end $$;

-- Every day is a working day so results do not depend on the weekday the test runs.
update public.hr_settings set value = jsonb_set(value, '{working_days}', '[1,2,3,4,5,6,7]') where key = 'company';

do $$
declare eng uuid; ops uuid;
begin
  insert into public.hr_departments (code, name) values ('ENG', 'Engineering') returning id into eng;
  insert into public.hr_departments (code, name) values ('OPS', 'Operations') returning id into ops;
  insert into t_ids values ('eng', eng), ('ops', ops);
  insert into t_ids values ('hr', test.make_employee('hr@test.local', 'Hira', null, array['hr_admin'], 'full_time', ops));
  insert into t_ids values ('pay', test.make_employee('pay@test.local', 'Pay', null, array['payroll_admin'], 'full_time', ops));
  insert into t_ids values ('mgr', test.make_employee('mgr@test.local', 'Mona', null, array['manager','employee'], 'full_time', eng));
  insert into t_ids values ('emp1', test.make_employee('emp1@test.local', 'Eli', (select v from t_ids where k='mgr'), array['employee'], 'full_time', eng));
  insert into t_ids values ('intern', test.make_employee('intern@test.local', 'Ira', (select v from t_ids where k='mgr'), array['intern'], 'intern', eng));
  insert into t_ids values ('emp2', test.make_employee('emp2@test.local', 'Ezra', null, array['employee'], 'full_time', ops));
end $$;

-- emp1 checked in late today (direct fixture as owner).
insert into public.hr_attendance (employee_id, work_date, check_in_at, status, late_minutes)
values (pg_temp.id('emp1'), hr_private.business_today(), now(), 'late', 15);

-- emp2 is on approved leave today, through the real workflow.
select pg_temp.su('emp2');
select public.hr_apply_leave((select id from public.hr_leave_types where code = 'CL'), hr_private.business_today(), hr_private.business_today(), 'Synthetic test leave');
select pg_temp.su('hr');
select public.hr_decide_leave((select id from public.hr_leave_requests where employee_id = pg_temp.id('emp2')), true, null);
select test.as_owner();
select test.eq((select status from public.hr_leave_requests where employee_id = pg_temp.id('emp2')), 'approved', 'fixture: leave approved via workflow');

-- ---- HR admin: company scope
select pg_temp.su('hr');
create temp table d as select public.hr_dashboard() j;
select test.eq((select j ->> 'scope' from d), 'company', 'HR dashboard is company-scoped');
select test.eq((select (j -> 'kpis' ->> 'total_employees')::int from d), 6, 'total employees = all 6 current employees');
select test.eq((select (j -> 'kpis' ->> 'interns')::int from d), 1, 'interns counted');
select test.eq((select (j -> 'kpis' ->> 'present_today')::int from d), 1, 'present today = the one check-in');
select test.eq((select (j -> 'kpis' ->> 'late_today')::int from d), 1, 'late arrivals today');
select test.eq((select (j -> 'kpis' ->> 'on_leave_today')::int from d), 1, 'on leave today from approved leave');
select test.eq((select (j -> 'kpis' ->> 'absent_today')::int from d), 4, 'absent = active, working day, not on leave, no check-in');
select test.ok((select j -> 'kpis' -> 'upcoming_birthdays_30d' is not null from d), 'HR (view_sensitive) gets birthday count');
select test.eq((select sum((x ->> 'headcount')::int) from d, jsonb_array_elements(j -> 'department_headcount') x), 6::bigint, 'department headcount sums to total');
select test.ok((select j -> 'recruitment_pipeline' is not null from d), 'HR sees recruitment pipeline section');
drop table d;

-- report totals match records
select test.eq((select sum((x ->> 'headcount')::int) from jsonb_array_elements(public.hr_report('headcount') -> 'rows') x), 6::bigint, 'headcount report total = 6');
select test.eq((public.hr_report('late_arrivals', hr_private.business_today(), hr_private.business_today()) ->> 'total')::int, 1, 'late arrivals report lists the late check-in');
select test.eq((public.hr_report('absence', hr_private.business_today() - 1, hr_private.business_today() - 1) ->> 'total')::int, 6,
  'absence report: every active employee absent yesterday (no check-ins, no leave)');
select test.eq((public.hr_report('leave_history', hr_private.business_today(), hr_private.business_today()) ->> 'total')::int, 1, 'leave history lists the approved leave');
select test.throws($q$select public.hr_report('payroll_summary')$q$, 'HR admin cannot run payroll report', 'payroll access');
select test.throws($q$select public.hr_report('no_such_report')$q$, 'unknown report rejected', 'Unknown report');
select test.throws($q$select public.hr_report('absence', current_date - 200, current_date)$q$, 'absence range capped', 'at most 93 days');
select test.throws($q$select public.hr_dashboard(current_date, current_date - 1)$q$, 'reversed range rejected', 'before the start');

-- ---- Manager: team scope only
select pg_temp.su('mgr');
create temp table d as select public.hr_dashboard() j;
select test.eq((select j ->> 'scope' from d), 'team', 'manager dashboard is team-scoped');
select test.eq((select (j -> 'kpis' ->> 'total_employees')::int from d), 2, 'manager sees only direct/indirect reports');
select test.eq((select (j -> 'kpis' ->> 'absent_today')::int from d), 1, 'manager: intern absent, emp1 present');
select test.ok((select j -> 'kpis' -> 'upcoming_birthdays_30d' = 'null'::jsonb from d), 'manager gets no PII-derived birthday count');
select test.ok((select j -> 'recruitment_pipeline' = 'null'::jsonb from d), 'manager without recruitment access gets null, not 0');
drop table d;
select test.eq((select sum((x ->> 'headcount')::int) from jsonb_array_elements(public.hr_report('headcount') -> 'rows') x), 2::bigint, 'manager headcount report = team only');
select test.eq((public.hr_report('absence', hr_private.business_today() - 1, hr_private.business_today() - 1) ->> 'total')::int, 2, 'manager absence report = team only');
select test.throws($q$select public.hr_report('recruitment_pipeline')$q$, 'manager cannot run recruitment report', 'recruitment access');

-- ---- Payroll admin: payroll report allowed; no dashboard permission
select pg_temp.su('pay');
select test.ok((public.hr_report('payroll_summary') ->> 'report') = 'payroll_summary', 'payroll admin can run payroll summary');
select test.throws($q$select public.hr_dashboard()$q$, 'payroll admin without dashboard permission refused', 'do not have access');

-- ---- Employee: no dashboard, no reports
select pg_temp.su('emp1');
select test.throws($q$select public.hr_dashboard()$q$, 'employee cannot open HR dashboard', 'do not have access');
select test.throws($q$select public.hr_report('headcount')$q$, 'employee cannot run reports', 'do not have access');
select test.as_owner();

-- ---- anon
select test.as_anon();
select test.throws($q$select public.hr_dashboard()$q$, 'anon cannot call hr_dashboard', 'permission denied');
select test.as_owner();

-- ---- date helper
select test.eq(hr_private.next_anniversary('2000-02-29', '2027-03-01'), date '2028-02-29', 'leap-day anniversary resolves to next leap year');
select test.eq(hr_private.next_anniversary('2000-02-29', '2027-01-01'), date '2027-02-28', 'leap-day anniversary maps to 28 Feb in non-leap year');
select test.eq(hr_private.next_anniversary('1990-12-31', '2026-11-02'), date '2026-12-31', 'anniversary later this year');
select test.eq(hr_private.next_anniversary('1990-01-15', '2026-11-02'), date '2027-01-15', 'anniversary already passed rolls to next year');

-- ---- smoke: every report executes for a Super Admin and returns a rows array
do $$
declare v_super uuid; r text; res jsonb;
begin
  perform test.as_owner();
  v_super := test.make_employee('super.reports@test.local', 'Sup', null, array['super_admin']);
  perform test.as_user(test.user_of(v_super));
  foreach r in array array['headcount','department_distribution','employee_status','attendance_summary','late_arrivals','absence',
    'leave_balances','leave_history','daily_report_compliance','project_activity','recruitment_pipeline','intern_progress',
    'payroll_summary','performance_summary','document_expiry','asset_assignment','exit_summary'] loop
    res := public.hr_report(r, hr_private.business_today() - 30, hr_private.business_today());
    perform test.ok(jsonb_typeof(res -> 'rows') = 'array' and jsonb_typeof(res -> 'columns') = 'array'
                    and (res ->> 'total')::int = jsonb_array_length(res -> 'rows'), 'report runs: ' || r);
  end loop;
  perform test.ok((public.hr_dashboard() -> 'kpis') ? 'open_positions', 'super admin dashboard includes recruitment KPIs');
  perform test.as_owner();
end $$;

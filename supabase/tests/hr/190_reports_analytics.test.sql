-- Module 12 — HR Reports & Analytics (190). Synthetic data only.
-- Numeric assertions for every category (values derived by hand from the
-- documented formulas), filters, manager scope, role gating, paging, the
-- audit-gap fixes, server-enforced + audited exports and self-service.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.su(p_k text) returns void language plpgsql as $$
begin perform test.as_owner(); perform test.as_user(test.user_of((select v from t_ids where k = p_k))); end $$;
create function pg_temp.t() returns date language sql as $$ select hr_private.business_today() $$;
create function pg_temp.card(j jsonb, k text) returns numeric language sql as $$
  select (x ->> 'value')::numeric from jsonb_array_elements(j -> 'cards') x where x ->> 'key' = k $$;
create function pg_temp.sec(j jsonb, k text) returns jsonb language sql as $$
  select x -> 'rows' from jsonb_array_elements(j -> 'sections') x where x ->> 'key' = k $$;

-- Every day is a working day so results do not depend on the weekday the test runs.
update public.hr_settings set value = jsonb_set(value, '{working_days}', '[1,2,3,4,5,6,7]') where key = 'company';
delete from public.hr_holidays;

do $$
declare eng uuid; ops uuid; le uuid; loc uuid; t date := hr_private.business_today(); nid uuid;
begin
  insert into public.hr_departments (code, name) values ('RENG', 'R Engineering') returning id into eng;
  insert into public.hr_departments (code, name) values ('ROPS', 'R Operations') returning id into ops;
  insert into public.hr_legal_entities (code, name, country) values ('R-CO', 'Report Co', 'IN') returning id into le;
  insert into public.hr_locations (name) values ('Report Office') returning id into loc;
  insert into t_ids values ('eng', eng), ('ops', ops), ('le', le), ('loc', loc);
  -- Custom roles: reports without module access; payroll viewer without payroll.export.
  insert into public.hr_roles (key, name) values ('rep_only', 'Reports only (test)'), ('pay_viewer', 'Payroll viewer (test)');
  insert into public.hr_role_permissions (role_key, permission_key) values
    ('rep_only', 'reports.view'), ('rep_only', 'reports.export'),
    ('pay_viewer', 'reports.view'), ('pay_viewer', 'reports.export'), ('pay_viewer', 'payroll.view');

  insert into t_ids values ('super', test.make_employee('r.super@test.local', 'Sam', null, array['super_admin']));
  insert into t_ids values ('hr',    test.make_employee('r.hr@test.local', 'Hari', null, array['hr_admin'], 'full_time', ops));
  insert into t_ids values ('pay',   test.make_employee('r.pay@test.local', 'Priya', null, array['payroll_admin'], 'full_time', ops));
  insert into t_ids values ('mgr',   test.make_employee('r.mgr@test.local', 'Mira', null, array['manager','employee'], 'full_time', eng));
  insert into t_ids values ('e1',    test.make_employee('r.e1@test.local', 'Arun', (select v from t_ids where k='mgr'), array['employee'], 'full_time', eng));
  insert into t_ids values ('e2',    test.make_employee('r.e2@test.local', 'Bela', (select v from t_ids where k='mgr'), array['employee'], 'full_time', eng));
  insert into t_ids values ('o1',    test.make_employee('r.o1@test.local', 'Chen', null, array['employee'], 'full_time', ops));
  insert into t_ids values ('sus',   test.make_employee('r.sus@test.local', 'Dev', null, array['employee']));
  insert into t_ids values ('j1',    test.make_employee('r.j1@test.local', 'Esha', (select v from t_ids where k='mgr'), array['employee'], 'full_time', eng));
  insert into t_ids values ('ronly', test.make_employee('r.ronly@test.local', 'Ravi', null, array['rep_only']));
  insert into t_ids values ('pview', test.make_employee('r.pview@test.local', 'Pia', null, array['pay_viewer']));
  -- ronly / pview are report users; place them before the window so they don't join in range.
  update public.hr_employees set status = 'suspended' where id = (select v from t_ids where k='sus');
  update public.hr_employees set joining_date = t - 30, probation_end_date = null where id = (select v from t_ids where k='j1');
  update public.hr_employees set legal_entity_id = le where id in ((select v from t_ids where k='e1'), (select v from t_ids where k='e2'));
  update public.hr_employees set work_location_id = loc where id = (select v from t_ids where k='o1');

  -- Former / void / not-yet-joined records (inserted directly as the owner).
  insert into public.hr_employees (first_name, last_name, status, joining_date, last_working_date, department_id)
    values ('Xavi', 'Former', 'exited', t - 700, t - 20, ops) returning id into nid;  insert into t_ids values ('x1', nid);
  insert into public.hr_exits (employee_id, initiated_by, exit_type, resignation_date, approved_last_working_day, status)
    values (nid, 'employee', 'resignation', t - 50, t - 20, 'closed');
  insert into public.hr_employees (first_name, last_name, status, joining_date, last_working_date, department_id, manager_id)
    values ('Yara', 'Former', 'exited', t - 300, t - 50, eng, (select v from t_ids where k='mgr')) returning id into nid;  insert into t_ids values ('x2', nid);
  insert into public.hr_employees (first_name, last_name, status, joining_date, last_working_date)
    values ('Zed', 'Old', 'exited', t - 900, t - 500) returning id into nid;  insert into t_ids values ('x3', nid);
  insert into public.hr_employees (first_name, last_name, status, joining_date, last_working_date, department_id)
    values ('Quin', 'Short', 'exited', t - 60, t - 5, ops) returning id into nid;  insert into t_ids values ('x4', nid);
  insert into public.hr_employees (first_name, last_name, status, joining_date)
    values ('Void', 'Duplicate', 'archived', t - 100) returning id into nid;  insert into t_ids values ('arch', nid);
  insert into public.hr_employees (first_name, last_name, status, joining_date, department_id)
    values ('Olu', 'Onboarding', 'onboarding', t + 10, eng) returning id into nid;  insert into t_ids values ('onb', nid);
end $$;
-- Report users joined long ago but are outside the departments used below; move them out of the date window.
update public.hr_employees set joining_date = pg_temp.t() - 400 where id in (pg_temp.id('ronly'), pg_temp.id('pview'));

-- ============ Headcount (HR admin, company scope) ============
-- Current: super, hr, pay, mgr, e1, e2, o1, sus, j1, ronly, pview = 11 in headcount today
-- (sus suspended; j1 joined T-30). Former x1 (T-20), x2 (T-50), x4 (T-5) left in range; x3 long ago;
-- arch is void; onb has not joined.
select pg_temp.su('hr');
create temp table h as select public.hr_report_analytics('headcount', pg_temp.t() - 120, pg_temp.t()) j;
select test.eq(pg_temp.card((select j from h), 'total_employees'), 11::numeric, 'headcount as of today = 11 (former, void and onboarding excluded)');
select test.eq(pg_temp.card((select j from h), 'active_employees'), 10::numeric, 'active = headcount minus suspended');
select test.eq(pg_temp.card((select j from h), 'inactive_employees'), 1::numeric, 'inactive (suspended) counted separately');
select test.eq(pg_temp.card((select j from h), 'new_joiners'), 2::numeric, 'new joiners include a joiner who already left (j1 + x4)');
select test.eq(pg_temp.card((select j from h), 'exits'), 3::numeric, 'exits = last working day in range (x1, x2, x4)');
select test.eq(pg_temp.card((select j from h), 'onboarding'), 1::numeric, 'onboarding record not in headcount');
select test.eq((select sum((x ->> 'headcount')::int) from h, jsonb_array_elements(pg_temp.sec(j, 'by_department')) x), 11::bigint, 'department-wise headcount sums to the total');
select test.eq((select (x ->> 'headcount')::int from h, jsonb_array_elements(pg_temp.sec(j, 'by_department')) x where x ->> 'department' = 'R Engineering'), 4, 'R Engineering = mgr, e1, e2, j1');
select test.eq((select sum((x ->> 'headcount')::int) from h, jsonb_array_elements(pg_temp.sec(j, 'by_employment_type')) x), 11::bigint, 'employment type breakdown sums to the total');
select test.eq((select sum((x ->> 'joiners')::int) from h, jsonb_array_elements(pg_temp.sec(j, 'trend')) x), 2::bigint, 'monthly trend joiners = card');
select test.eq((select sum((x ->> 'exits')::int) from h, jsonb_array_elements(pg_temp.sec(j, 'trend')) x), 3::bigint, 'monthly trend exits = card');
select test.eq((select (x ->> 'headcount')::int from h, jsonb_array_elements(pg_temp.sec(j, 'trend')) x order by x ->> 'month' desc limit 1), 11, 'latest trend point = headcount card');
select test.ok((select jsonb_array_length(j -> 'definitions') >= 4 from h), 'headcount definitions are returned');
drop table h;
-- Filters
select test.eq(pg_temp.card(public.hr_report_analytics('headcount', pg_temp.t() - 120, pg_temp.t(), p_department => pg_temp.id('ops')), 'total_employees'), 3::numeric, 'department filter (hr, pay, o1)');
select test.eq(pg_temp.card(public.hr_report_analytics('headcount', pg_temp.t() - 120, pg_temp.t(), p_employee => pg_temp.id('e1')), 'total_employees'), 1::numeric, 'employee filter');
select test.eq(pg_temp.card(public.hr_report_analytics('headcount', pg_temp.t() - 120, pg_temp.t(), p_legal_entity => pg_temp.id('le')), 'total_employees'), 2::numeric, 'company filter');
select test.eq(pg_temp.card(public.hr_report_analytics('headcount', pg_temp.t() - 120, pg_temp.t(), p_location => pg_temp.id('loc')), 'total_employees'), 1::numeric, 'location filter');
select test.eq(pg_temp.card(public.hr_report_analytics('headcount', pg_temp.t() - 120, pg_temp.t(), p_manager => pg_temp.id('mgr')), 'total_employees'), 3::numeric, 'manager filter (direct reports e1, e2, j1)');
select test.eq(pg_temp.card(public.hr_report_analytics('headcount', pg_temp.t() - 120, pg_temp.t(), p_employment_type => 'intern'), 'total_employees'), 0::numeric, 'employment type filter');
select test.eq((public.hr_report('headcount', p_department => pg_temp.id('ops')) -> 'rows' -> 0 ->> 'headcount')::int, 3, 'existing report still works');
select test.eq(coalesce(current_setting('hr.filter_employee', true), ''), '', 'filters do not leak after a call');
-- Validation
select test.throws($q$select public.hr_report_analytics('headcount', current_date, current_date - 1)$q$, 'reversed range rejected', 'before the start');
select test.throws($q$select public.hr_report_analytics('headcount', current_date - 400, current_date)$q$, 'range capped at one year', 'at most one year');
select test.throws($q$select public.hr_report_analytics('nope')$q$, 'unknown category rejected', 'Unknown report category');
select test.throws($q$select public.hr_report_analytics('headcount', p_employment_type => 'x''; drop table x;--')$q$, 'malformed employment type rejected', 'employment type');

-- ============ Attrition ============
-- Opening (T-120): 7 + sus + ronly + pview + x1 + x2 = 12 (j1, x4 not yet joined). Closing: 11.
-- Attrition = 3 / ((12 + 11) / 2) × 100 = 26.09. Voluntary = 1 (x1 resignation).
create temp table a as select public.hr_report_analytics('attrition', pg_temp.t() - 120, pg_temp.t()) j;
select test.eq(pg_temp.card((select j from a), 'completed_exits'), 3::numeric, 'completed exits');
select test.eq(pg_temp.card((select j from a), 'attrition_rate'), 26.09::numeric, 'attrition = exits / avg(opening, closing) × 100');
select test.eq(pg_temp.card((select j from a), 'voluntary_exits'), 1::numeric, 'voluntary = resignation only');
select test.eq(pg_temp.card((select j from a), 'resignations'), 1::numeric, 'resignation requests counted separately');
select test.eq(pg_temp.card((select j from a), 'avg_tenure'), 0.90::numeric, 'average tenure of leavers (1.86, 0.68, 0.15)');
select test.eq((select (x ->> 'exits')::int from a, jsonb_array_elements(pg_temp.sec(j, 'by_category')) x where x ->> 'category' = 'Not recorded'), 2, 'exits without a case are "Not recorded", never guessed');
select test.eq((select sum((x ->> 'exits')::int) from a, jsonb_array_elements(pg_temp.sec(j, 'by_department')) x), 3::bigint, 'department attrition sums to total exits');
select test.eq((select jsonb_array_length(pg_temp.sec(j, 'exits')) from a), 3, 'completed exits table = card');
select test.eq((public.hr_report('completed_exits', pg_temp.t() - 120, pg_temp.t()) ->> 'total')::int, 3, 'completed_exits template uses the same definition');
drop table a;

-- ============ Attendance ============
-- e1, window T-10..T-1: 6 present, 1 late, 1 half day, 1 absent, 1 unrecorded -> expected 10, attended 7.5, 75.0%.
-- e2: approved leave T-6, present the other 9 days -> expected 9, attended 9, 100%.
select test.as_owner();
insert into public.hr_attendance (employee_id, work_date, check_in_at, check_out_at, worked_minutes, status, late_minutes)
select pg_temp.id('e1'), pg_temp.t() - d, now() - make_interval(days => d, hours => 9), now() - make_interval(days => d), 480,
       case d when 4 then 'late' when 3 then 'half_day' else 'present' end, case d when 4 then 20 else 0 end
from generate_series(3, 10) d;
insert into public.hr_attendance (employee_id, work_date, status) values (pg_temp.id('e1'), pg_temp.t() - 2, 'absent');
insert into public.hr_attendance (employee_id, work_date, check_in_at, status)
select pg_temp.id('e2'), pg_temp.t() - d, now() - make_interval(days => d), 'present' from generate_series(1, 10) d where d <> 6;
insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status)
values (pg_temp.id('e2'), (select id from public.hr_leave_types where code = 'CL'), pg_temp.t() - 6, pg_temp.t() - 6, 1,
        extract(year from pg_temp.t() - 6)::int, 'Synthetic leave', 'approved');
insert into public.hr_attendance_corrections (employee_id, work_date, requested_check_in_at, reason, status)
values (pg_temp.id('e1'), pg_temp.t() - 1, now() - interval '1 day', 'Forgot to punch', 'pending');

select pg_temp.su('hr');
create temp table at as select public.hr_report_analytics('attendance', pg_temp.t() - 10, pg_temp.t() - 1, p_employee => pg_temp.id('e1')) j;
select test.eq(pg_temp.card((select j from at), 'attendance_rate'), 75.0::numeric, 'attendance % = attended / expected working days');
select test.eq(pg_temp.card((select j from at), 'present_days'), 7.5::numeric, 'attended counts half days as 0.5');
select test.eq(pg_temp.card((select j from at), 'absent_days'), 2.5::numeric, 'absent includes unrecorded working days');
select test.eq(pg_temp.card((select j from at), 'late_arrivals'), 1::numeric, 'late arrivals');
select test.eq((select sum((x ->> 'expected')::int) from at, jsonb_array_elements(pg_temp.sec(j, 'daily')) x), 10::bigint, 'daily table expected days = 10');
select test.eq((select (x ->> 'requests')::int from at, jsonb_array_elements(pg_temp.sec(j, 'regularizations')) x where x ->> 'status' = 'pending'), 1, 'regularization requests listed');
drop table at;
select test.eq(pg_temp.card(public.hr_report_analytics('attendance', pg_temp.t() - 10, pg_temp.t() - 1, p_employee => pg_temp.id('e2')), 'attendance_rate'), 100.0::numeric, 'approved leave excluded from the denominator');
select test.eq(pg_temp.card(public.hr_report_analytics('attendance', pg_temp.t() - 10, pg_temp.t() - 1, p_employee => pg_temp.id('e2')), 'leave_days'), 1::numeric, 'leave day reported');
select test.eq((select (x ->> 'attendance_pct')::numeric from jsonb_array_elements(public.hr_report('attendance_employee', pg_temp.t() - 10, pg_temp.t() - 1, p_department => pg_temp.id('eng')) -> 'rows') x
                where x ->> 'employee' like 'Arun%'), 75.0::numeric, 'employee-wise template matches the analytics card');
-- Manager (attendance.view_team): team e1, e2, j1 -> expected 10 + 9 + 10 = 29, attended 16.5 -> 56.9%
select pg_temp.su('mgr');
select test.eq(pg_temp.card(public.hr_report_analytics('attendance', pg_temp.t() - 10, pg_temp.t() - 1), 'attendance_rate'), 56.9::numeric, 'manager attendance is team-scoped');
select test.eq((public.hr_report_analytics('attendance', pg_temp.t() - 10, pg_temp.t() - 1) ->> 'scope'), 'team', 'manager scope labelled team');
-- No attendance access: refusal, not zeros (audit RP4)
select pg_temp.su('ronly');
select test.ok((select x ->> 'reason' like '%attendance access%' from jsonb_array_elements(public.hr_report_analytics('attendance') -> 'unavailable') x), 'attendance analytics unavailable without access');
select test.eq(jsonb_array_length(public.hr_report_analytics('attendance') -> 'cards'), 0, 'no misleading zero cards');
select test.throws($q$select public.hr_report('attendance_summary')$q$, 'attendance_summary refuses without attendance access', 'attendance access');
select test.throws($q$select public.hr_report('absence', current_date - 2, current_date - 1)$q$, 'absence refuses without attendance access', 'attendance access');
select test.throws($q$select public.hr_report('daily_report_compliance')$q$, 'daily report compliance refuses without access', 'daily report access');

-- ============ Leave ============
select test.as_owner();
insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status)
values (pg_temp.id('o1'), (select id from public.hr_leave_types where code = 'CL'), pg_temp.t() - 15, pg_temp.t() - 15, 1, extract(year from pg_temp.t() - 15)::int, 'Synthetic rejected', 'rejected'),
       (pg_temp.id('o1'), (select id from public.hr_leave_types where code = 'CL'), pg_temp.t() + 5, pg_temp.t() + 5, 1, extract(year from pg_temp.t() + 5)::int, 'Synthetic upcoming', 'pending_approval');
insert into public.hr_leave_balances (employee_id, leave_type_id, year, accrued, used, pending)
values (pg_temp.id('e1'), (select id from public.hr_leave_types where code = 'CL'), extract(year from pg_temp.t())::int, 12, 3, 1)
on conflict (employee_id, leave_type_id, year) do update set accrued = 12, used = 3, pending = 1, carried_forward = 0, adjusted = 0;
update public.hr_leave_balances set used = 0, pending = 0, accrued = 0, carried_forward = 0, adjusted = 0
 where year = extract(year from pg_temp.t())::int
   and not (employee_id = pg_temp.id('e1') and leave_type_id = (select id from public.hr_leave_types where code = 'CL'));
select pg_temp.su('hr');
create temp table lv as select public.hr_report_analytics('leave', pg_temp.t() - 120, pg_temp.t()) j;
select test.eq(pg_temp.card((select j from lv), 'approved_days'), 1::numeric, 'approved leave days');
select test.eq(pg_temp.card((select j from lv), 'rejected_requests'), 1::numeric, 'rejected leave');
select test.eq(pg_temp.card((select j from lv), 'pending_requests'), 0::numeric, 'pending leave starting after the range is not in the period');
select test.eq(pg_temp.card((select j from lv), 'upcoming_leave'), 1::numeric, 'upcoming leave (next 30 days)');
select test.eq(pg_temp.card((select j from lv), 'utilization'), 25.0::numeric, 'utilization = used / credited; pending (1) not counted as used');
select test.eq((select (x ->> 'available')::numeric from lv, jsonb_array_elements(pg_temp.sec(j, 'by_type')) x where x ->> 'leave_type' = (select name from public.hr_leave_types where code = 'CL')),
  8::numeric, 'type summary available matches the ledger (12 - 3 - 1)');
drop table lv;
select test.eq((public.hr_report('upcoming_leave') ->> 'total')::int, 1, 'upcoming_leave template');
select test.eq((public.hr_report_page('leave_history', pg_temp.t() - 120, pg_temp.t() + 10, p_status => 'rejected') ->> 'total')::int, 1, 'status filter applied on the server');
select test.ok((public.hr_report_page('leave_history', pg_temp.t() - 120, pg_temp.t() + 10) -> 'status_values') ? 'approved', 'status values offered for the filter');

-- ============ Payroll ============
select test.as_owner();
insert into public.hr_salary_components (code, name, kind, calc_type, is_statutory, statutory_note) values
  ('RBASIC', 'Basic (test)', 'earning', 'fixed', false, null), ('RPF', 'Provident fund (test)', 'deduction', 'fixed', true, 'Synthetic test component');
do $$
declare ra uuid; rb uuid; t date := hr_private.business_today();
begin
  insert into public.hr_payroll_runs (period_start, period_end, status) values (t - 60, t - 31, 'draft') returning id into ra;
  insert into public.hr_payroll_runs (period_start, period_end, status) values (t - 30, t - 1, 'draft') returning id into rb;
  insert into t_ids values ('run_a', ra), ('run_b', rb);
  insert into public.hr_payroll_items (run_id, employee_id, working_days, payable_days, gross, total_deductions, employer_contributions, net, breakdown) values
    (ra, (select v from t_ids where k='e1'), 30, 30, 50000, 5000, 2000, 45000,
     '{"earnings":[{"code":"BASIC","kind":"earning","amount":30000},{"code":"HRA","kind":"earning","amount":20000}],"deductions":[{"code":"RPF","name":"Provident fund (test)","kind":"deduction","amount":3600},{"code":"TDS","kind":"deduction","amount":1400}]}'),
    (ra, (select v from t_ids where k='o1'), 30, 30, 40000, 4000, 0, 36000,
     '{"earnings":[{"code":"BASIC","kind":"earning","amount":25000},{"code":"HRA","kind":"earning","amount":15000}],"deductions":[{"code":"RPF","name":"Provident fund (test)","kind":"deduction","amount":3000},{"code":"TDS","kind":"deduction","amount":1000}]}'),
    (rb, (select v from t_ids where k='e1'), 30, 30, 52000, 5200, 2000, 46800, '{"earnings":[{"code":"BASIC","kind":"earning","amount":31000}]}');
  update public.hr_payroll_runs set status = 'finalized' where id = ra;
  update public.hr_payroll_runs set status = 'paid' where id = ra;
  insert into public.hr_payslips (run_id, employee_id, period_start, period_end, currency, working_days, payable_days, lop_days, gross, total_deductions, net, breakdown, published_at)
    values (ra, (select v from t_ids where k='e1'), t - 60, t - 31, 'INR', 30, 30, 0, 50000, 5000, 45000, '{}', now());
end $$;
select pg_temp.su('pay');
create temp table p as select public.hr_report_analytics('payroll', pg_temp.t() - 120, pg_temp.t()) j;
select test.eq(pg_temp.card((select j from p), 'gross'), 90000::numeric, 'gross = final runs only');
select test.eq(pg_temp.card((select j from p), 'allowances'), 35000::numeric, 'allowances = earnings other than BASIC');
select test.eq(pg_temp.card((select j from p), 'deductions'), 9000::numeric, 'deductions');
select test.eq(pg_temp.card((select j from p), 'net'), 81000::numeric, 'net');
select test.eq(pg_temp.card((select j from p), 'provisional_runs'), 1::numeric, 'provisional run counted separately');
select test.eq(pg_temp.card((select j from p), 'provisional_gross'), 52000::numeric, 'provisional gross labelled, not added');
select test.eq((select count(*) from p, jsonb_array_elements(pg_temp.sec(j, 'by_period')) x where x ->> 'basis' = 'Provisional'), 1::bigint, 'period comparison labels basis');
select test.eq((select (x ->> 'amount')::numeric from p, jsonb_array_elements(pg_temp.sec(j, 'statutory')) x where x ->> 'code' = 'RPF'), 6600::numeric, 'statutory summary from configured components only');
select test.eq((select sum((x ->> 'gross')::numeric) from p, jsonb_array_elements(pg_temp.sec(j, 'by_department')) x), 90000::numeric, 'department costs reconcile to gross');
drop table p;
select test.eq(pg_temp.card(public.hr_report_analytics('payroll', pg_temp.t() - 120, pg_temp.t(), p_department => pg_temp.id('ops')), 'gross'), 40000::numeric, 'payroll department filter');
select test.eq((public.hr_report_page('payroll_summary', pg_temp.t() - 120, pg_temp.t(), p_employee => pg_temp.id('o1')) ->> 'total')::int, 1, 'payroll_summary lists only runs with someone in scope (audit RP3)');
select test.eq((select count(*) from jsonb_array_elements(public.hr_report('payroll_summary', pg_temp.t() - 120, pg_temp.t()) -> 'rows') x where x ->> 'basis' in ('Final','Provisional')), 2::bigint, 'payroll_summary labels each run');
select pg_temp.su('hr');
select test.ok((select x ->> 'reason' like '%payroll access%' from jsonb_array_elements(public.hr_report_analytics('payroll') -> 'unavailable') x), 'HR admin gets no payroll analytics');
select pg_temp.su('mgr');
select test.ok((public.hr_report_analytics('payroll') -> 'unavailable') @> '[{"category":"payroll"}]', 'manager gets no payroll analytics');

-- ============ Hiring ============
select test.as_owner();
do $$
declare o1 uuid; o2 uuid; c uuid; a uuid; t date := hr_private.business_today();
begin
  insert into public.hr_job_openings (title, department_id, employment_type, openings, status, hiring_manager_id)
    values ('R Engineer', (select v from t_ids where k='eng'), 'full_time', 2, 'open', (select v from t_ids where k='mgr')) returning id into o1;
  insert into public.hr_job_openings (title, department_id, employment_type, openings, status)
    values ('R Ops Analyst', (select v from t_ids where k='ops'), 'full_time', 1, 'open') returning id into o2;
  insert into t_ids values ('open1', o1), ('open2', o2);
  -- a1: joined (applied T-40, joined T-10) with an accepted offer
  insert into public.hr_candidates (full_name, email) values ('Cand One', 'c1@test.local') returning id into c;
  -- Applications start as 'applied' (the insert trigger logs that stage); later stages are set afterwards.
  insert into public.hr_candidate_applications (candidate_id, opening_id, stage, created_at) values (c, o1, 'applied', (t - 40)::timestamp + interval '12 hours') returning id into a;
  update public.hr_candidate_applications set stage = 'joined', stage_changed_at = (t - 10)::timestamp + interval '12 hours' where id = a;
  insert into public.hr_candidate_stage_events (application_id, from_stage, to_stage, changed_at) values
    (a, 'applied', 'screening', now() - interval '35 days'), (a, 'screening', 'interview', now() - interval '30 days'),
    (a, 'interview', 'offered', now() - interval '20 days'), (a, 'offered', 'joined', (t - 10)::timestamp + interval '12 hours');
  insert into public.hr_offers (application_id, employment_type, status, sent_at, responded_at) values (a, 'full_time', 'accepted', now() - interval '20 days', now() - interval '15 days');
  -- a2: rejected after screening, cancelled interview
  insert into public.hr_candidates (full_name, email) values ('Cand Two', 'c2@test.local') returning id into c;
  insert into public.hr_candidate_applications (candidate_id, opening_id, stage, created_at) values (c, o1, 'applied', now() - interval '30 days') returning id into a;
  update public.hr_candidate_applications set stage = 'rejected' where id = a;
  insert into public.hr_candidate_stage_events (application_id, from_stage, to_stage) values (a, 'applied', 'screening'), (a, 'screening', 'rejected');
  insert into public.hr_interviews (application_id, scheduled_at, status) values (a, now() - interval '6 days', 'cancelled');
  -- a3: in interview, one completed interview
  insert into public.hr_candidates (full_name, email) values ('Cand Three', 'c3@test.local') returning id into c;
  insert into public.hr_candidate_applications (candidate_id, opening_id, stage, created_at) values (c, o1, 'applied', now() - interval '20 days') returning id into a;
  update public.hr_candidate_applications set stage = 'interview' where id = a;
  insert into public.hr_interviews (application_id, scheduled_at, status) values (a, now() - interval '5 days', 'completed');
  -- a4: just applied (operations)
  insert into public.hr_candidates (full_name, email) values ('Cand Four', 'c4@test.local') returning id into c;
  insert into public.hr_candidate_applications (candidate_id, opening_id, stage, created_at) values (c, o2, 'applied', now() - interval '3 days');
end $$;
select pg_temp.su('hr');
create temp table hi as select public.hr_report_analytics('hiring', pg_temp.t() - 120, pg_temp.t()) j;
select test.eq(pg_temp.card((select j from hi), 'open_positions'), 3::numeric, 'open positions = sum of openings on open requisitions');
select test.eq(pg_temp.card((select j from hi), 'applications'), 4::numeric, 'applications received');
select test.eq(pg_temp.card((select j from hi), 'screened'), 3::numeric, 'screened uses stage history (a1, a2, a3)');
select test.eq(pg_temp.card((select j from hi), 'interviews_scheduled'), 1::numeric, 'cancelled interviews excluded');
select test.eq(pg_temp.card((select j from hi), 'interviews_completed'), 1::numeric, 'interviews completed');
select test.eq(pg_temp.card((select j from hi), 'offers_issued'), 1::numeric, 'offers issued');
select test.eq(pg_temp.card((select j from hi), 'offers_accepted'), 1::numeric, 'offers accepted');
select test.eq(pg_temp.card((select j from hi), 'hired'), 1::numeric, 'hired');
select test.eq(pg_temp.card((select j from hi), 'time_to_hire'), 30.0::numeric, 'time to hire from real dates (T-40 -> T-10)');
select test.eq(pg_temp.card((select j from hi), 'pending_recruitment'), 2::numeric, 'pending recruitment (a3, a4)');
select test.eq((select (x ->> 'applications')::int from hi, jsonb_array_elements(pg_temp.sec(j, 'funnel')) x where x ->> 'stage' = 'Interview'), 2, 'funnel: reached interview (a1 via history, a3)');
select test.ok((select j -> 'filters_ignored' ? 'company' from hi), 'hiring reports which filters do not apply');
drop table hi;
select test.eq(pg_temp.card(public.hr_report_analytics('hiring', pg_temp.t() - 120, pg_temp.t(), p_department => pg_temp.id('ops')), 'applications'), 1::numeric, 'hiring department filter');
select test.eq(pg_temp.card(public.hr_report_analytics('hiring', pg_temp.t() - 120, pg_temp.t(), p_manager => pg_temp.id('mgr')), 'open_positions'), 2::numeric, 'manager filter = hiring manager');
-- recruitment_pipeline fixes (audit RP3)
select test.eq((public.hr_report('recruitment_pipeline', pg_temp.t() - 120, pg_temp.t(), p_department => pg_temp.id('ops')) ->> 'total')::int, 1, 'pipeline department filter');
select test.eq((public.hr_report('recruitment_pipeline', pg_temp.t() - 120, pg_temp.t(), p_employment_type => 'intern') ->> 'total')::int, 0, 'pipeline honours employment type');
select test.eq((public.hr_report('recruitment_pipeline', pg_temp.t() - 120, pg_temp.t(), p_manager => pg_temp.id('mgr')) ->> 'total')::int, 1, 'pipeline honours hiring manager');
select test.ok((public.hr_report('recruitment_pipeline') -> 'filters_ignored') ? 'company', 'pipeline labels the company filter as not applicable');
select pg_temp.su('mgr');
select test.ok((public.hr_report_analytics('hiring') -> 'unavailable') @> '[{"category":"hiring"}]', 'manager without recruitment access gets no hiring analytics');

-- ============ Performance ============
select test.as_owner();
do $$
declare cy uuid; kid uuid; t date := hr_private.business_today();
begin
  insert into public.hr_review_cycles (name, cycle_type, period_start, period_end, status) values ('R Q-test', 'quarterly', t - 90, t - 1, 'draft') returning id into cy;
  insert into public.hr_performance_reviews (employee_id, cycle_id, status, final_rating, finalized_at) values
    ((select v from t_ids where k='e1'), cy, 'finalized', 4.0, now()), ((select v from t_ids where k='e2'), cy, 'finalized', 3.0, now());
  insert into public.hr_performance_reviews (employee_id, cycle_id, status) values
    ((select v from t_ids where k='o1'), cy, 'manager_review'), ((select v from t_ids where k='j1'), cy, 'not_started');
  insert into public.hr_kpi_definitions (name) values ('R Tickets closed') returning id into kid;
  -- score is computed by the Performance module's trigger (goal_score); never set here.
  insert into public.hr_goals (employee_id, cycle_id, kpi_id, title, status, target_value, actual_value, weight) values
    ((select v from t_ids where k='e1'), cy, kid, 'Close tickets', 'achieved', 100, 90, 10), ((select v from t_ids where k='e2'), cy, kid, 'Close tickets', 'missed', 100, 40, 10);
end $$;
select pg_temp.su('hr');
create temp table pf as select public.hr_report_analytics('performance', pg_temp.t() - 120, pg_temp.t()) j;
select test.eq(pg_temp.card((select j from pf), 'reviews_completed'), 2::numeric, 'reviews completed');
select test.eq(pg_temp.card((select j from pf), 'reviews_pending'), 2::numeric, 'pending reviews');
select test.eq(pg_temp.card((select j from pf), 'review_completion'), 50.0::numeric, 'completion %');
select test.eq(pg_temp.card((select j from pf), 'avg_final_rating'), 3.50::numeric, 'average final rating (finalized only)');
select test.eq((select sum((x ->> 'reviews')::int) from pf, jsonb_array_elements(pg_temp.sec(j, 'distribution')) x), 2::bigint, 'distribution = finalized reviews');
select test.as_owner();
create temp table kexp as select round(avg(score), 2) v from public.hr_goals g join public.hr_kpi_definitions k on k.id = g.kpi_id where k.name = 'R Tickets closed';
grant select on kexp to authenticated;
select pg_temp.su('hr');
select test.ok((select v from kexp) is not null, 'fixture: KPI goals scored by the Performance module');
select test.eq((select (x ->> 'avg_score')::numeric from pf, jsonb_array_elements(pg_temp.sec(j, 'kpis')) x where x ->> 'kpi' = 'R Tickets closed'), (select v from kexp), 'KPI results average the module''s goal scores');
select test.eq((select (x ->> 'achieved')::int from pf, jsonb_array_elements(pg_temp.sec(j, 'kpis')) x where x ->> 'kpi' = 'R Tickets closed'), 1, 'KPI achieved count');
drop table pf;
select pg_temp.su('mgr');
select test.eq(pg_temp.card(public.hr_report_analytics('performance', pg_temp.t() - 120, pg_temp.t()), 'review_completion'), 66.7::numeric, 'manager sees team reviews only (2 of 3)');
select pg_temp.su('pay');
select test.ok((public.hr_report_analytics('performance') -> 'unavailable') @> '[{"category":"performance"}]', 'payroll admin gets no performance analytics');

-- ============ Overview ============
select pg_temp.su('hr');
create temp table ov as select public.hr_report_analytics('overview', pg_temp.t() - 120, pg_temp.t()) j;
select test.eq(pg_temp.card((select j from ov), 'total_employees'), 11::numeric, 'overview headcount = headcount report');
select test.eq(pg_temp.card((select j from ov), 'attrition_rate'), 26.09::numeric, 'overview attrition = attrition report');
select test.eq(pg_temp.card((select j from ov), 'pending_recruitment'), 2::numeric, 'overview pending recruitment');
select test.eq(pg_temp.card((select j from ov), 'review_completion'), 50.0::numeric, 'overview review completion');
select test.ok((select pg_temp.card(j, 'attendance_rate') is null or pg_temp.card(j, 'attendance_rate') >= 0 from ov), 'overview attendance card present');
drop table ov;
select pg_temp.su('ronly');
select test.ok(jsonb_array_length(public.hr_report_analytics('overview') -> 'unavailable') >= 4, 'overview lists unavailable categories with reasons');
select pg_temp.su('e1');
select test.throws($q$select public.hr_report_analytics('overview')$q$, 'employee cannot open HR analytics', 'access to HR reports');
select test.throws($q$select public.hr_report_page('headcount')$q$, 'employee cannot page HR reports', 'access to HR reports');

-- ============ Paging + totals ============
select pg_temp.su('hr');
select test.eq(jsonb_array_length(public.hr_report_page('attendance_daily', pg_temp.t() - 10, pg_temp.t() - 1, p_employee => pg_temp.id('e1'), p_offset => 4, p_limit => 4) -> 'rows'), 4, 'page size honoured');
select test.eq(jsonb_array_length(public.hr_report_page('attendance_daily', pg_temp.t() - 10, pg_temp.t() - 1, p_employee => pg_temp.id('e1'), p_offset => 8, p_limit => 4) -> 'rows'), 2, 'last page');
select test.eq((public.hr_report_page('attendance_daily', pg_temp.t() - 10, pg_temp.t() - 1, p_employee => pg_temp.id('e1'), p_limit => 4) ->> 'total')::int, 10, 'total counts all rows, not the page');
select test.eq((public.hr_report_page('attendance_daily', pg_temp.t() - 10, pg_temp.t() - 1, p_employee => pg_temp.id('e1'), p_limit => 4) -> 'totals' ->> 'expected')::numeric, 10::numeric, 'totals over all rows');
select test.ok(not (public.hr_report_page('attendance_daily', pg_temp.t() - 10, pg_temp.t() - 1, p_employee => pg_temp.id('e1')) -> 'totals' ? 'attendance_pct'), 'percentages are never summed');
select test.throws($q$select public.hr_report_page('headcount', p_limit => 5000)$q$, 'page size capped', 'between 1 and 500');

-- ============ Exports: server-enforced + audited ============
select pg_temp.su('hr');
select test.eq((public.hr_report_export('analytics', 'headcount', 'xlsx', pg_temp.t() - 120, pg_temp.t()) -> 'export' ->> 'format'), 'xlsx', 'HR admin can export workforce analytics');
select test.eq((public.hr_report_export('report', 'leave_history', 'csv', pg_temp.t() - 120, pg_temp.t() + 10, p_status => 'rejected') ->> 'total')::int, 1, 'export uses the selected filters');
select test.throws($q$select public.hr_report_export('report', 'payroll_summary', 'csv')$q$, 'HR admin cannot export payroll', 'payroll');
select test.throws($q$select public.hr_report_export('report', 'headcount', 'docx')$q$, 'unsupported format rejected', 'format');
select test.as_owner();
select test.eq((select count(*) from public.hr_audit_log where action = 'report_export' and table_name = 'hr_report' and actor_employee_id = pg_temp.id('hr')), 2::bigint, 'each export is audited');
select test.ok((select context ->> 'status' = 'rejected' and not (context ? 'rows_data') and (context ->> 'rows')::int = 1
                from public.hr_audit_log where action = 'report_export' and record_id = 'leave_history'), 'audit stores filters and row count, not row data');
select pg_temp.su('mgr');
select test.throws($q$select public.hr_report_export('analytics', 'headcount', 'csv')$q$, 'manager without reports.export cannot export', 'permission to export');
select pg_temp.su('pview');
select test.throws($q$select public.hr_report_export('analytics', 'payroll', 'pdf')$q$, 'payroll viewer without payroll.export cannot export payroll', 'payroll export');
select test.ok((public.hr_report_export('analytics', 'headcount', 'csv') -> 'export') is not null, 'payroll viewer can export non-payroll reports');
select pg_temp.su('pay');
select test.ok((public.hr_report_export('analytics', 'payroll', 'pdf', pg_temp.t() - 120, pg_temp.t()) -> 'export') is not null, 'payroll admin can export payroll');
select pg_temp.su('hr');
select test.eq(test.count_rows($q$select 1 from public.hr_audit_log where table_name = 'hr_payroll_report'$q$), 0::bigint, 'payroll export audit rows hidden from HR without payroll access');
select pg_temp.su('super');
select test.ok(test.count_rows($q$select 1 from public.hr_audit_log where table_name = 'hr_payroll_report'$q$) >= 1, 'payroll export audited');

-- ============ Employee self-service ============
select pg_temp.su('e1');
create temp table me as select public.hr_my_report_summary(pg_temp.t() - 10, pg_temp.t() - 1) j;
select test.eq((select (j -> 'attendance' ->> 'pct')::numeric from me), 75.0::numeric, 'my attendance uses the same formula');
select test.eq((select (x ->> 'used')::numeric from me, jsonb_array_elements(j -> 'leave' -> 'balances') x where x ->> 'leave_type' = (select name from public.hr_leave_types where code = 'CL')), 3::numeric, 'my leave balance');
select test.eq((select jsonb_array_length(j -> 'payslips') from me), 1, 'my published payslip');
select test.eq((select jsonb_array_length(j -> 'performance') from me), 1, 'my finalized review');
drop table me;
select pg_temp.su('o1');
select test.eq((select jsonb_array_length(public.hr_my_report_summary(pg_temp.t() - 10, pg_temp.t() - 1) -> 'payslips')), 0, 'other employees'' payslips never appear');
select test.eq((select jsonb_array_length(public.hr_my_report_summary(pg_temp.t() - 120, pg_temp.t()) -> 'performance')), 0, 'unfinalized review not shown to the employee');
select test.as_anon();
select test.throws($q$select public.hr_my_report_summary()$q$, 'anonymous users cannot call self-service', null);
select test.throws($q$select public.hr_report_analytics('overview')$q$, 'anonymous users cannot call analytics', null);

-- ============ Integration readiness: templates, export authorization, audit metadata ============
-- All 39 pre-existing report templates (112 core + 116) remain available, plus the 5 Module 12 templates.
select pg_temp.su('super');
create temp table tpl (k text, legacy boolean);
insert into tpl select k, true from unnest(array['headcount','workforce_by_company','workforce_by_location','workforce_by_grade','employment_type_breakdown',
  'department_distribution','employee_status','new_joiners','tenure_bands','nationality_mix','gender_mix','age_bands','org_units','reporting_lines',
  'deployment_summary','deployment_roster','data_completeness','document_expiry','identity_expiry','identity_compliance','contract_expiry','probation_due',
  'asset_assignment','leave_balances','leave_history','attendance_summary','late_arrivals','absence','daily_report_compliance','project_activity',
  'payroll_summary','recruitment_pipeline','intern_progress','training_completion','training_overdue','performance_summary','benefits_enrollment',
  'benefits_roster','exit_summary']) k;
insert into tpl select k, false from unnest(array['attendance_employee','attendance_daily','attendance_regularizations','upcoming_leave','completed_exits']) k;
grant select on tpl to authenticated;
select test.eq((select count(*) from tpl where legacy), 39::bigint, 'fixture: the 39 legacy template keys');
select test.ok(bool_and((public.hr_report(k, pg_temp.t() - 60, pg_temp.t()) ->> 'total') is not null
                    and jsonb_array_length(public.hr_report(k, pg_temp.t() - 60, pg_temp.t()) -> 'columns') > 0), 'all 39 legacy templates still execute with columns')
  from tpl where legacy;
select test.ok(bool_and((public.hr_report_page(k, pg_temp.t() - 60, pg_temp.t(), p_limit => 10) ->> 'total') is not null), 'all 44 templates page through hr_report_page')
  from tpl;
select test.ok(bool_and((public.hr_report_export('report', k, 'csv', pg_temp.t() - 60, pg_temp.t()) -> 'export') is not null), 'all 44 templates export for a fully privileged user')
  from tpl;

-- Confidential performance exports need performance access (defence in depth).
select pg_temp.su('pay');
select test.throws($q$select public.hr_report_export('analytics', 'performance', 'csv')$q$, 'payroll admin cannot export performance analytics', 'performance access');
select test.throws($q$select public.hr_report_export('report', 'performance_summary', 'xlsx')$q$, 'payroll admin cannot export individual reviews', 'performance access');
select pg_temp.su('ronly');
select test.throws($q$select public.hr_report_export('report', 'performance_summary', 'csv')$q$, 'reports.export alone is not enough for performance', 'performance access');
select test.throws($q$select public.hr_report_export('report', 'payroll_summary', 'csv')$q$, 'reports.export alone is not enough for payroll', 'payroll');
select test.throws($q$select public.hr_report_export('report', 'attendance_summary', 'csv')$q$, 'export inherits the attendance refusal', 'attendance access');
select test.throws($q$select public.hr_report_export('bogus', 'headcount', 'csv')$q$, 'unknown export source rejected', 'export source');
select pg_temp.su('hr');
select test.ok((public.hr_report_export('report', 'performance_summary', 'csv', pg_temp.t() - 120, pg_temp.t()) ->> 'total')::int >= 2, 'HR admin (performance.view) can export reviews');

-- Audit rows hold metadata only: whitelisted keys, scalar values, no employee names or amounts.
select test.as_owner();
select test.ok(not exists (select 1 from public.hr_audit_log a, jsonb_object_keys(a.context) k where a.action = 'report_export'
  and k not in ('source','format','rows','from','to','department','manager','employment_type','legal_entity','employee','location','status','scope')),
  'export audit context uses whitelisted metadata keys only');
select test.ok(not exists (select 1 from public.hr_audit_log a, jsonb_each(a.context) e where a.action = 'report_export'
  and jsonb_typeof(e.value) in ('array','object')), 'export audit context never stores arrays or objects (no rows)');
select test.ok(not exists (select 1 from public.hr_audit_log a where a.action = 'report_export'
  and (a.context::text ~* '(Arun|Bela|Chen|Xavi|Provident|90000|45000)' or a.old_data is not null or a.new_data is not null)),
  'export audit rows contain no names, salary amounts or row snapshots');
select test.ok((select bool_and(actor_user_id is not null and record_id is not null and occurred_at is not null) from public.hr_audit_log where action = 'report_export'),
  'export audit rows identify who, which report and when');

-- ============ Set-based attendance: location holidays and leave visibility ============
-- A holiday at o1's work location on T-3 removes that day from o1's expected days only.
select test.as_owner();
insert into public.hr_holidays (holiday_date, name, location_id) values (pg_temp.t() - 3, 'Synthetic location holiday', pg_temp.id('loc'));
select pg_temp.su('hr');
select test.eq((select sum((x ->> 'expected')::int) from jsonb_array_elements(pg_temp.sec(public.hr_report_analytics('attendance', pg_temp.t() - 10, pg_temp.t() - 1,
  p_employee => pg_temp.id('o1')), 'daily')) x), 9::bigint, 'location holiday excluded from expected days');
select test.ok(not exists (select 1 from jsonb_array_elements(pg_temp.sec(public.hr_report_analytics('attendance', pg_temp.t() - 10, pg_temp.t() - 1,
  p_employee => pg_temp.id('o1')), 'daily')) x where (x ->> 'date')::date = pg_temp.t() - 3), 'holiday date has no expected row');
select test.eq(pg_temp.card(public.hr_report_analytics('attendance', pg_temp.t() - 10, pg_temp.t() - 1, p_employee => pg_temp.id('e1')), 'attendance_rate'),
  75.0::numeric, 'holiday at another location does not affect e1');
-- The bulk path agrees with the shared per-day helpers for every employee-day in the window.
select test.as_owner();
create temp table chk as
select e.id, d::date d, hr_private.is_working_day_for(e.id, d::date) wd, hr_private.is_on_approved_leave(e.id, d::date) lv
from public.hr_employees e cross join generate_series(pg_temp.t() - 10, pg_temp.t() - 1, interval '1 day') d
where e.id in (pg_temp.id('e1'), pg_temp.id('e2'), pg_temp.id('o1'), pg_temp.id('j1'));
grant select on chk to authenticated;
select pg_temp.su('super');
select hr_private.ra_set_filters(null, null, null);
select hr_private.ra_load_scope('reports.view', null, null, null);
select hr_private.ra_load_attendance(pg_temp.t() - 10, pg_temp.t() - 1);
select test.eq((select count(*) from chk c where c.wd and not exists (select 1 from pg_temp.ra_att a where a.employee_id = c.id and a.d = c.d)), 0::bigint,
  'every working day from is_working_day_for is present in the bulk calculation');
select test.eq((select count(*) from pg_temp.ra_att a join chk c on c.id = a.employee_id and c.d = a.d where not c.wd), 0::bigint,
  'no non-working day from is_working_day_for appears in the bulk calculation');
select test.eq((select count(*) from pg_temp.ra_att a join chk c on c.id = a.employee_id and c.d = a.d where (a.kind = 'leave') <> c.lv), 0::bigint,
  'leave days match is_on_approved_leave');
-- A caller with attendance access but no leave access still sees leave days as leave, not absence.
select test.as_owner();
insert into public.hr_roles (key, name) values ('att_only', 'Attendance only (test)');
insert into public.hr_role_permissions (role_key, permission_key) values ('att_only', 'reports.view'), ('att_only', 'attendance.view'), ('att_only', 'employees.view');
insert into t_ids values ('aonly', test.make_employee('r.aonly@test.local', 'Ana', null, array['att_only']));
select pg_temp.su('aonly');
select test.eq(pg_temp.card(public.hr_report_analytics('attendance', pg_temp.t() - 10, pg_temp.t() - 1, p_employee => pg_temp.id('e2')), 'attendance_rate'),
  100.0::numeric, 'leave excluded even when the caller cannot read leave requests');
-- attendance_summary (re-implemented on the fast reader) keeps the 112 semantics.
select pg_temp.su('hr');
select test.ok((select (x ->> 'present')::int = 6 and (x ->> 'late')::int = 1 and (x ->> 'half_day')::int = 1 and (x ->> 'absent')::int = 1
                from jsonb_array_elements(public.hr_report('attendance_summary', pg_temp.t() - 10, pg_temp.t() - 1) -> 'rows') x
                where x ->> 'employee' like 'Arun%'), 'attendance_summary status counts unchanged');
select test.ok((select count(*) >= 3 from jsonb_array_elements(public.hr_report('attendance_summary', pg_temp.t() - 10, pg_temp.t() - 1) -> 'rows') x
                where x ->> 'employee' like any (array['Xavi%','Yara%','Quin%'])), 'attendance_summary still lists former employees');
select pg_temp.su('mgr');
select test.ok(not exists (select 1 from jsonb_array_elements(public.hr_report('attendance_summary', pg_temp.t() - 10, pg_temp.t() - 1) -> 'rows') x
                where x ->> 'employee' like 'Chen%'), 'attendance_summary stays team-scoped for managers');

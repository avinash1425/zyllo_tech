-- Benefits (114): catalogue permissions, eligibility (type + tenure),
-- override with reason, duplicates, status changes, privacy, self-action
-- guard, auto-end on exit.
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
begin
  insert into t_ids values ('hr',   test.make_employee('bn.hr@test.local', 'Hema', null, array['hr_admin']));
  insert into t_ids values ('hr2',  test.make_employee('bn.hr2@test.local', 'Hans', null, array['hr_admin']));
  insert into t_ids values ('pay',  test.make_employee('bn.pay@test.local', 'Pavan', null, array['payroll_admin']));
  insert into t_ids values ('mgr',  test.make_employee('bn.mgr@test.local', 'Meru', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('bn.emp1@test.local', 'Asha', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('bn.emp2@test.local', 'Bodhi', null));
  insert into t_ids values ('int1', test.make_employee('bn.int1@test.local', 'Ira', null, array['intern'], 'intern'));
  insert into t_ids values ('new1', test.make_employee('bn.new1@test.local', 'Neel', null));
end $$;
update public.hr_employees set joining_date = current_date - 30, probation_end_date = null where id = pg_temp.id('new1');

-- ---- catalogue
select pg_temp.as_k('hr');
with x as (insert into public.hr_benefit_types (code, name, category, eligible_employment_types, min_tenure_months, employer_contribution, allows_dependants)
           values ('MED', 'Group medical', 'health', array['full_time','part_time'], 3, 1500, true) returning id)
insert into t_ids select 'med', id from x;
with x as (insert into public.hr_benefit_types (code, name, category) values ('WELL', 'Wellness allowance', 'wellness') returning id)
insert into t_ids select 'well', id from x;
select test.throws($q$insert into public.hr_benefit_types (code, name, category) values ('BAD', 'Bad category', 'crypto')$q$, 'benefit category validated', 'check constraint');
select pg_temp.as_k('emp1');
select test.throws($q$insert into public.hr_benefit_types (code, name) values ('EMP', 'Employee plan')$q$, 'employee cannot create plans', 'row-level security');
select test.eq(test.count_rows('select 1 from public.hr_benefit_types'), 2::bigint, 'employees can browse the plan catalogue');
select test.throws($q$select public.hr_enroll_benefit(pg_temp.id('emp2'), pg_temp.id('well'), current_date)$q$, 'employee cannot enroll anyone', 'not allowed');
select test.throws($q$insert into public.hr_benefit_enrollments (employee_id, benefit_type_id, start_date) values (pg_temp.id('emp1'), pg_temp.id('well'), current_date)$q$, 'no direct enrollment inserts', 'row-level security');

-- ---- eligibility
select test.ok((select bool_and(eligible) from public.hr_benefit_eligibility(pg_temp.id('emp1'))), 'full-time employee with tenure is eligible for every plan');
select test.throws($q$select * from public.hr_benefit_eligibility(pg_temp.id('emp2'))$q$, 'cannot see a colleague''s eligibility', 'not allowed');
select pg_temp.as_k('hr');
select test.ok((select not eligible and reason like '%not eligible%' from public.hr_benefit_eligibility(pg_temp.id('int1')) where code = 'MED'), 'intern not eligible by employment type');
select test.ok((select not eligible and reason like '%months of service%' from public.hr_benefit_eligibility(pg_temp.id('new1')) where code = 'MED'), 'new joiner not eligible before minimum tenure');
select test.throws($q$select public.hr_enroll_benefit(pg_temp.id('int1'), pg_temp.id('med'), current_date)$q$, 'ineligible enrollment rejected', 'override reason');
do $$ begin
  insert into t_ids values ('e_int', public.hr_enroll_benefit(pg_temp.id('int1'), pg_temp.id('med'), current_date, 'employee', 0, null, null, 'Approved by management for project insurance'));
end $$;
select test.ok((select eligibility_override is not null from public.hr_benefit_enrollments where id = pg_temp.id('e_int')), 'override reason stored on the enrollment');
-- Tenure measured at the start date: future start after 3 months is eligible.
do $$ begin
  insert into t_ids values ('e_new', public.hr_enroll_benefit(pg_temp.id('new1'), pg_temp.id('med'), current_date + 90));
end $$;
select test.ok(pg_temp.id('e_new') is not null, 'eligible once tenure is reached by the start date');

-- ---- enrollment rules
do $$ begin
  insert into t_ids values ('e1', public.hr_enroll_benefit(pg_temp.id('emp1'), pg_temp.id('med'), current_date, 'family', 3, 'POL-001'));
end $$;
select test.ok((select employer_contribution = 1500 and dependants = 3 and status = 'active' from public.hr_benefit_enrollments where id = pg_temp.id('e1')), 'enrollment takes plan contribution defaults');
select test.throws($q$select public.hr_enroll_benefit(pg_temp.id('emp1'), pg_temp.id('med'), current_date)$q$, 'duplicate live enrollment rejected', 'already enrolled');
select test.throws($q$select public.hr_enroll_benefit(pg_temp.id('emp1'), pg_temp.id('well'), current_date, 'family', 2)$q$, 'dependants only where the plan allows', 'dependants');
select test.throws($q$select public.hr_enroll_benefit(pg_temp.id('hr'), pg_temp.id('well'), current_date)$q$, 'HR cannot enroll themselves', 'yourself');
select test.throws($q$select public.hr_set_benefit_enrollment_status(pg_temp.id('e1'), 'suspended')$q$, 'suspension needs a reason', 'reason');
select public.hr_set_benefit_enrollment_status(pg_temp.id('e1'), 'suspended', null, 'Unpaid leave');
select test.eq((select status from public.hr_benefit_enrollments where id = pg_temp.id('e1')), 'suspended', 'enrollment suspended');
select public.hr_set_benefit_enrollment_status(pg_temp.id('e1'), 'active');
select test.throws($q$select public.hr_set_benefit_enrollment_status(pg_temp.id('e1'), 'ended', current_date - 400, 'Plan change')$q$, 'end date not before start', 'end date');
select public.hr_set_benefit_enrollment_status(pg_temp.id('e1'), 'ended', current_date, 'Plan change');
select test.throws($q$select public.hr_set_benefit_enrollment_status(pg_temp.id('e1'), 'active')$q$, 'closed enrollment cannot be reopened', 'closed');
do $$ begin
  insert into t_ids values ('e2', public.hr_enroll_benefit(pg_temp.id('emp1'), pg_temp.id('med'), current_date));
end $$;
select test.ok(pg_temp.id('e2') is not null, 'can re-enroll after the previous enrollment ended');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp1')) and type = 'benefit_enrolled'), 'employee notified of enrollment');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_benefit_enrollments' and record_id = pg_temp.id('e1')::text and action = 'UPDATE'), 'enrollment changes audited');

-- ---- privacy
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_benefit_enrollments'), 2::bigint, 'employee sees own enrollments');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_benefit_enrollments'), 0::bigint, 'colleague sees no enrollments');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_benefit_enrollments'), 0::bigint, 'manager cannot see team benefits');
select pg_temp.as_k('pay');
select test.ok(test.count_rows('select 1 from public.hr_benefit_enrollments') >= 4, 'payroll admin (benefits.view) sees enrollments');
select test.throws($q$select public.hr_enroll_benefit(pg_temp.id('emp2'), pg_temp.id('well'), current_date)$q$, 'benefits.view alone cannot enroll', 'not allowed');

-- ---- exit ends live enrollments
select test.as_owner();
select set_config('hr.privileged_write', 'on', true);
update public.hr_employees set status = 'exited', last_working_date = current_date where id = pg_temp.id('emp1');
select set_config('hr.privileged_write', 'off', true);
select test.ok((select status = 'ended' and end_reason = 'Employee exited' from public.hr_benefit_enrollments where id = pg_temp.id('e2')), 'live enrollment ended when the employee exits');

select test.as_anon();
select test.throws($q$select 1 from public.hr_benefit_types$q$, 'anon cannot read plans', 'permission denied');

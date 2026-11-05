-- Module 7 integration checks with Leave (6 / 160), Attendance (5 / 125) and
-- Exit (4 / 130). Runs standalone (module-specific blocks skip themselves when
-- that module's objects are absent) and in a combined integration database.
-- Synthetic data only; the runner rolls the transaction back.
--
-- Hand-computed: Sep 2025 = 22 working days, Oct 2025 = 23 (Mon-Fri).
-- BASIC 22000 => Sep 1000/day.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin perform test.as_owner(); perform test.as_user(test.user_of((select v from t_ids where k = p_k))); end $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.item(p_run text, p_emp text) returns public.hr_payroll_items language sql as $$
  select * from public.hr_payroll_items where run_id = (select v from t_ids where k = p_run) and employee_id = (select v from t_ids where k = p_emp) $$;

do $$
declare v_k text; s uuid;
begin
  insert into t_ids values ('pay1', test.make_employee('i7.pay1@test.local', 'Ira',  null, array['payroll_admin']));
  insert into t_ids values ('pay2', test.make_employee('i7.pay2@test.local', 'Ivan', null, array['payroll_admin']));
  insert into t_ids values ('emp1', test.make_employee('i7.emp1@test.local', 'Isha'));
  insert into t_ids values ('emp2', test.make_employee('i7.emp2@test.local', 'Indu'));
  insert into t_ids values ('emp3', test.make_employee('i7.emp3@test.local', 'Ilan'));
  update public.hr_employees set joining_date = date '2024-01-01', probation_end_date = null where id in (select v from t_ids where t_ids.k like 'emp%');
  -- Approved structures (seed-style owner insert: privileged, active).
  foreach v_k in array array['emp1','emp2','emp3'] loop
    insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc) values ((select v from t_ids where t_ids.k = v_k), date '2025-01-01', 264000) returning id into s;
    insert into public.hr_salary_structure_items (structure_id, component_id, amount) values (s, (select id from public.hr_salary_components where code = 'BASIC'), 22000);
  end loop;
  -- emp1, September: half-day unpaid (Wed 3 Sep, first half), full unpaid (Wed 10 Sep), paid casual leave (Thu 11 Sep).
  insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, start_half, end_half, days, year, reason, status) values
    ((select v from t_ids where t_ids.k = 'emp1'), (select id from public.hr_leave_types where code = 'LOP'), date '2025-09-03', date '2025-09-03', true, false, 0.5, 2025, 'Synthetic half day', 'approved'),
    ((select v from t_ids where t_ids.k = 'emp1'), (select id from public.hr_leave_types where code = 'LOP'), date '2025-09-10', date '2025-09-10', false, false, 1, 2025, 'Synthetic full day', 'approved'),
    ((select v from t_ids where t_ids.k = 'emp1'), (select id from public.hr_leave_types where code = 'CL'),  date '2025-09-11', date '2025-09-11', false, false, 1, 2025, 'Synthetic paid day', 'approved');
end $$;

-- ---------------------------------------------------------------- leave -> LOP (Module 6 function)
select test.eq(hr_private.payroll_lop_days(pg_temp.id('emp1'), date '2025-09-01', date '2025-09-30', false), 1.5::numeric,
  'leave->LOP: half-day unpaid counts 0.5, full unpaid 1, paid leave 0');
select test.eq(hr_private.payroll_lop_days(pg_temp.id('emp1'), date '2025-09-04', date '2025-09-09', false), 0::numeric, 'leave->LOP: range filter respected');
select test.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'hr_private' and p.proname = 'payroll_lop_days'
                           and pg_get_function_identity_arguments(p.oid) <> 'p_employee uuid, p_from date, p_to date, p_from_attendance boolean'),
  'leave->LOP: single function with the agreed 4-argument signature');

-- ---------------------------------------------------------------- September run
select pg_temp.su('pay1');
insert into t_ids select 'sep', (public.hr_create_payroll_run(date '2025-09-01', date '2025-09-30') ->> 'id')::uuid;
select public.hr_calculate_payroll_run(pg_temp.id('sep'));
-- emp1: 22 working days, 1.5 LOP -> 20.5 payable; 22000 * 20.5 / 22 = 20500.00
select test.ok(((pg_temp.item('sep','emp1')).lop_days, (pg_temp.item('sep','emp1')).payable_days, (pg_temp.item('sep','emp1')).gross) = (1.5, 20.5, 20500.00),
  'payroll: half-day + full-day unpaid leave -> 1.5 LOP, gross 20500.00');
select public.hr_review_payroll_run(pg_temp.id('sep'));
select pg_temp.su('pay2');
select public.hr_approve_payroll_run(pg_temp.id('sep'));
select public.hr_finalize_payroll_run(pg_temp.id('sep'));
select public.hr_record_payroll_payments(array[(select id from public.hr_payroll_payments where run_id = pg_temp.id('sep') and employee_id = pg_temp.id('emp1'))],
  'paid', 'bank_transfer', 'UTR-I7-0001', date '2025-10-01');

-- ---------------------------------------------------------------- changes after finalization
select test.as_owner();
insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status, updated_at)
values (pg_temp.id('emp1'), (select id from public.hr_leave_types where code = 'LOP'), date '2025-09-15', date '2025-09-15', 1, 2025, 'Synthetic late approval', 'approved', now() + interval '1 minute');
select test.eq(hr_private.payroll_lop_days(pg_temp.id('emp1'), date '2025-09-01', date '2025-09-30', false), 2.5::numeric, 'late-approved leave is visible to the LOP function');
select test.ok(((pg_temp.item('sep','emp1')).lop_days, (pg_temp.item('sep','emp1')).gross) = (1.5, 20500.00), 'finalized item unchanged by a later leave approval');
select test.eq((select gross from public.hr_payslips where run_id = pg_temp.id('sep') and employee_id = pg_temp.id('emp1')), 20500.00::numeric, 'finalized payslip unchanged');
select pg_temp.su('pay1');
select test.throws(format('select public.hr_calculate_payroll_run(%L)', pg_temp.id('sep')), 'finalized run cannot be recalculated', 'Only draft or calculated');
select test.as_owner();
select test.throws($q$update public.hr_payroll_items set gross = 1$q$, 'finalized items immutable even for the owner', 'cannot be changed');
select pg_temp.su('pay1');
select test.ok(exists (select 1 from public.hr_payroll_post_finalization_changes(pg_temp.id('sep')) where change_type = 'leave' and employee_id = pg_temp.id('emp1')),
  'late leave change listed for a controlled correction');
do $$
begin
  if to_regprocedure('hr_private.assert_attendance_unlocked(date)') is not null then
    perform test.throws($q$select hr_private.assert_attendance_unlocked(date '2025-09-12')$q$, 'Module 5: attendance inside a finalized payroll period is locked', 'locked by a finalized payroll run');
    perform test.ok(not hr_private.attendance_period_locked(date '2025-10-12'), 'Module 5: open period not locked');
  else
    raise notice 'skip: Module 5 attendance period lock not present';
  end if;
end $$;

-- ---------------------------------------------------------------- settlement coverage (Module 7 table)
select pg_temp.su('pay2');
select public.hr_record_settlement_coverage(pg_temp.id('emp2'), date '2025-10-10', 'FNF-I7-COV', 'Synthetic coverage');

-- ---------------------------------------------------------------- Module 4 (130) settlements
do $$
declare v_x uuid; v_s uuid; v_pay uuid;
begin
  if to_regclass('public.hr_payroll_settlements') is null then
    raise notice 'skip: Module 4 settlement tables not present';
    return;
  end if;
  perform test.as_owner();
  -- (a) emp1's September payslip is already paid through payroll: a settlement line for it is not added.
  insert into public.hr_exits (employee_id, initiated_by, exit_type, status) values (pg_temp.id('emp1'), 'hr', 'resignation', 'final_settlement') returning id into v_x;
  insert into public.hr_payroll_settlements (exit_id, employee_id, status) values (v_x, pg_temp.id('emp1'), 'draft') returning id into v_s;
  insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, amount, source_ref)
  values (v_s, 'unpaid_salary', 'Unpaid payroll Sep 2025', 20500, 'payroll_item:' || (pg_temp.item('sep','emp1')).id);
  perform test.eq((select count(*) from public.hr_payroll_settlement_lines where settlement_id = v_s), 0::bigint,
    'Module 4: settlement does not re-pay a payslip already paid through payroll');
  -- (b) emp2's September payslip is unpaid: the settlement pays it; payroll may not record it separately.
  insert into public.hr_exits (employee_id, initiated_by, exit_type, status) values (pg_temp.id('emp2'), 'hr', 'resignation', 'final_settlement') returning id into v_x;
  insert into public.hr_payroll_settlements (exit_id, employee_id, status) values (v_x, pg_temp.id('emp2'), 'approved') returning id into v_s;
  insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, amount, source_ref)
  values (v_s, 'unpaid_salary', 'Unpaid payroll Sep 2025', (pg_temp.item('sep','emp2')).net, 'payroll_item:' || (pg_temp.item('sep','emp2')).id);
  v_pay := (select id from public.hr_payroll_payments where run_id = pg_temp.id('sep') and employee_id = pg_temp.id('emp2'));
  perform pg_temp.su('pay2');
  perform test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L, %L, %L, %L)', v_pay, 'paid', 'bank_transfer', 'UTR-DOUBLE', '2025-10-02'),
    'Module 4: payroll refuses to record a payment the settlement is paying', 'final settlement');
  perform test.throws(format('select public.hr_mark_payroll_paid(%L, %L)', pg_temp.id('sep'), 'BATCH-DOUBLE'),
    'Module 4: batch mark-paid refused while a payslip is in a settlement', 'final settlement');
  perform test.as_owner();
  update public.hr_payroll_settlements set status = 'paid', paid_on = date '2025-10-05', paid_by = test.user_of(pg_temp.id('pay2')), payment_reference = 'FNF-I7-0002' where id = v_s;
  perform test.ok((select status = 'paid' and method = 'other' and reference like 'Final settlement FNF-I7-0002%' and amount_paid = amount
                   from public.hr_payroll_payments where id = v_pay), 'Module 4: settlement payment recorded on the payroll payment (evidence carried over)');
  perform test.ok((select status = 'finalized' and payment_status = 'partially_paid' from public.hr_payroll_runs where id = pg_temp.id('sep')), 'Module 4: run status reflects the settled payment (emp3 still pending, so not paid)');
  -- (c) emp3: approved settlement pays salary to 17 Oct -> October payroll starts 18 Oct.
  insert into public.hr_exits (employee_id, initiated_by, exit_type, status, approved_last_working_day) values (pg_temp.id('emp3'), 'hr', 'resignation', 'final_settlement', date '2025-10-31') returning id into v_x;
  insert into public.hr_payroll_settlements (exit_id, employee_id, status, last_working_day) values (v_x, pg_temp.id('emp3'), 'approved', date '2025-10-17') returning id into v_s;
  insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, amount) values (v_s, 'salary_due', 'Salary 01 Oct - 17 Oct 2025', 12434.78);
end $$;

-- ---------------------------------------------------------------- October run: no double payment
select pg_temp.su('pay1');
insert into t_ids select 'oct', (public.hr_create_payroll_run(date '2025-10-01', date '2025-10-31') ->> 'id')::uuid;
select public.hr_calculate_payroll_run(pg_temp.id('oct'));
-- emp2: coverage to 10 Oct -> 13-31 Oct = 15 of 23 days; 22000 * 15 / 23 = 14347.83
select test.ok(((pg_temp.item('oct','emp2')).payable_days, (pg_temp.item('oct','emp2')).gross) = (15.0, 14347.83),
  'settlement coverage: days already paid in the settlement are excluded (15 of 23 payable)');
do $$
begin
  if to_regclass('public.hr_payroll_settlements') is null then
    perform test.eq((pg_temp.item('oct','emp3')).payable_days, 23.0, 'standalone: no settlement -> full month');
  else
    -- 20-31 Oct = 10 working days; 22000 * 10 / 23 = 9565.22
    perform test.ok(((pg_temp.item('oct','emp3')).payable_days, (pg_temp.item('oct','emp3')).gross) = (10.0, 9565.22),
      'Module 4: approved settlement salary_due excludes days to its last working day (10 of 23 payable)');
  end if;
end $$;

-- ---------------------------------------------------------------- separation of duties (summary re-check)
select test.throws(format('select public.hr_approve_payroll_run(%L)', pg_temp.id('oct')), 'run preparer cannot approve', 'Only reviewed');
select public.hr_review_payroll_run(pg_temp.id('oct'));
select test.throws(format('select public.hr_approve_payroll_run(%L)', pg_temp.id('oct')), 'run preparer cannot approve after submitting', 'different person');
select test.throws(format('insert into public.hr_employee_bank_accounts (employee_id, bank_name, account_holder, account_number) values (%L, %L, %L, %L)',
  pg_temp.id('pay1'), 'Example Bank', 'Self', '123412341234'), 'no own bank account', 'row-level security');
select test.throws(format('insert into public.hr_payroll_statutory_enrollments (employee_id, rule_code, effective_from, declared_monthly_amount) values (%L, %L, %L, 0)',
  pg_temp.id('pay1'), 'TDS', '2025-01-01'), 'no own tax declaration', 'row-level security');
select test.as_owner();

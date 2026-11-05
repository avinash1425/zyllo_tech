-- Payroll: strict separation from HR, structures, bank masking, run workflow,
-- LOP/proration math, approver separation, immutability after finalize,
-- payslip visibility, reimbursements and post-finalization corrections.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;

create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.comp(p_code text) returns uuid language sql as $$ select id from public.hr_salary_components where code = p_code $$;

do $$
begin
  insert into t_ids values ('hr',   test.make_employee('pr.hr@test.local', 'Harsha', null, array['hr_admin']));
  insert into t_ids values ('pay1', test.make_employee('pr.pay1@test.local', 'Priya', null, array['payroll_admin']));
  insert into t_ids values ('pay2', test.make_employee('pr.pay2@test.local', 'Pavan', null, array['payroll_admin']));
  insert into t_ids values ('emp1', test.make_employee('pr.emp1@test.local', 'Esther'));
  insert into t_ids values ('emp2', test.make_employee('pr.emp2@test.local', 'Emil'));
  update public.hr_employees set joining_date = date '2024-01-01', probation_end_date = null where id = (select v from t_ids where k='emp1');
  update public.hr_employees set joining_date = date '2025-06-16', probation_end_date = null where id = (select v from t_ids where k='emp2');
  -- 3 days of approved unpaid leave (Tue 10 - Thu 12 June 2025)
  insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status)
  values ((select v from t_ids where k='emp1'), (select id from public.hr_leave_types where code = 'LOP'),
          date '2025-06-10', date '2025-06-12', 3, 2025, 'Personal matter', 'approved');
end $$;

-- ---- HR admin has no payroll access at all
select pg_temp.su('hr');
select test.ok(not hr_private.has_permission('payroll.view'), 'HR admin lacks payroll.view');
select test.throws($q$insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc) values (hr_private.current_employee_id(), current_date, 1)$q$,
  'HR admin cannot create salary structures', 'row-level security');
select test.throws($q$select public.hr_create_payroll_run(date '2025-06-01', date '2025-06-30')$q$, 'HR admin cannot create payroll runs', 'not allowed');
select test.eq(test.count_rows('select 1 from public.hr_salary_components'), 0::bigint, 'HR admin cannot read salary components');

-- ---- structures (payroll admin)
select pg_temp.su('pay1');
insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc) values (pg_temp.id('emp1'), date '2025-01-01', 352800);
insert into t_ids select 's1', id from public.hr_salary_structures where employee_id = pg_temp.id('emp1');
insert into public.hr_salary_structure_items (structure_id, component_id, amount, percent) values
  (pg_temp.id('s1'), pg_temp.comp('BASIC'), 21000, null),
  (pg_temp.id('s1'), pg_temp.comp('HRA'), null, 40),
  (pg_temp.id('s1'), pg_temp.comp('OTHER_DEDUCTION'), 1000, null);
insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc) values (pg_temp.id('emp2'), date '2025-06-16', 252000);
insert into public.hr_salary_structure_items (structure_id, component_id, amount)
select id, pg_temp.comp('BASIC'), 21000 from public.hr_salary_structures where employee_id = pg_temp.id('emp2');
-- (170) Structures are drafts until approved; overlap is enforced at approval (see below).
select test.ok((select bool_and(status = 'draft') from public.hr_salary_structures), 'new structures start as drafts (maker-checker)');
select test.throws(format('insert into public.hr_salary_structure_items (structure_id, component_id) values (%L, %L)', pg_temp.id('s1'), pg_temp.comp('SPECIAL')),
  'fixed component needs an amount', 'monthly amount');
-- statutory components stay unverified (and are skipped) until verified
insert into public.hr_salary_components (code, name, kind, calc_type, default_value, is_statutory, statutory_note)
values ('STAT_TEST', 'Configured Statutory Deduction', 'deduction', 'percent_of_gross', 10, true, 'Rate to be confirmed by a payroll consultant');
select test.ok((select requires_verification from public.hr_salary_components where code = 'STAT_TEST'), 'statutory component flagged requires_verification');
select test.throws($q$update public.hr_salary_components set verified_at = now() where code = 'STAT_TEST'$q$, 'verification cannot be set directly', 'verification action');
insert into public.hr_salary_structure_items (structure_id, component_id) values (pg_temp.id('s1'), pg_temp.comp('STAT_TEST'));
-- (170) maker-checker: pay1 submits, pay2 approves
select public.hr_submit_salary_structure(id) from public.hr_salary_structures where employee_id in (pg_temp.id('emp1'), pg_temp.id('emp2'));
select test.throws(format('select public.hr_approve_salary_structure(%L)', pg_temp.id('s1')), 'preparer cannot approve own structure', 'different person');
select pg_temp.su('pay2');
select public.hr_approve_salary_structure(id) from public.hr_salary_structures where employee_id in (pg_temp.id('emp1'), pg_temp.id('emp2'));
select pg_temp.su('pay1');
insert into public.hr_salary_structures (employee_id, effective_from, effective_to, annual_ctc) values (pg_temp.id('emp1'), date '2024-12-01', date '2025-12-31', 1);
insert into t_ids select 'ov', id from public.hr_salary_structures where employee_id = pg_temp.id('emp1') and effective_from = date '2024-12-01';
insert into public.hr_salary_structure_items (structure_id, component_id, amount) values (pg_temp.id('ov'), pg_temp.comp('BASIC'), 1);
select public.hr_submit_salary_structure(pg_temp.id('ov'));
select pg_temp.su('pay2');
select test.throws(format('select public.hr_approve_salary_structure(%L)', pg_temp.id('ov')), 'overlapping salary structures rejected at approval', 'overlaps an approved structure');
select public.hr_reject_salary_structure(pg_temp.id('ov'), 'Overlaps the current structure');
select pg_temp.su('pay1');

-- ---- bank account: payroll-only; employee sees masked own
insert into public.hr_employee_bank_accounts (employee_id, bank_name, account_holder, account_number, ifsc)
values (pg_temp.id('emp1'), 'Example Bank', 'Esther Test', '123456789012', 'ABCD0123456');
select pg_temp.su('emp1');
select test.eq(test.count_rows('select 1 from public.hr_employee_bank_accounts'), 0::bigint, 'employee cannot read bank table');
select test.eq((select account_last4 from public.hr_my_bank_accounts()), '9012', 'employee sees own account masked to last 4');
select test.ok((select to_jsonb(b)::text not like '%12345678%' from public.hr_my_bank_accounts() b), 'full account number never returned');
select pg_temp.su('hr');
select test.eq(test.count_rows('select 1 from public.hr_employee_bank_accounts'), 0::bigint, 'HR admin cannot read bank accounts');
-- HR admin holds audit.view but not payroll.view: payroll audit rows are hidden entirely.
select test.eq(test.count_rows($q$select 1 from public.hr_audit_log where table_name in ('hr_employee_bank_accounts','hr_salary_structures')$q$), 0::bigint,
  'HR admin cannot see payroll/bank audit rows');
select test.as_owner();
select test.ok((select count(*) > 0 and bool_and(new_data ->> 'account_number' = '[redacted]') from public.hr_audit_log where table_name = 'hr_employee_bank_accounts'),
  'account number redacted in audit log');
select test.ok((select count(*) > 0 and bool_and(new_data ->> 'annual_ctc' = '[redacted]') from public.hr_audit_log where table_name = 'hr_salary_structures'),
  'salary redacted in audit log');
select pg_temp.su('hr');
select test.eq(test.count_rows('select 1 from public.hr_salary_structures'), 0::bigint, 'HR admin cannot read salary structures');

-- ---- reimbursement: legacy 'submitted' claim (backlog), payroll decides.
-- Since 196, employees cannot self-submit here (claims go through HR Requests / 180);
-- the backlog claim is created as owner.
select pg_temp.su('emp1');
select test.throws($q$select public.hr_submit_reimbursement(date '2025-06-20', 'internet', 300, 'Home broadband June')$q$,
  'employee direct claim refused (use HR Requests)', 'My HR Requests');
select test.as_owner();
with c as (insert into public.hr_reimbursements (employee_id, claim_date, category, amount, description)
           values (pg_temp.id('emp1'), date '2025-06-20', 'internet', 300, 'Home broadband June') returning id)
insert into t_ids select 'rb1', id from c;
select pg_temp.su('emp1');
select test.eq(test.count_rows('select 1 from public.hr_reimbursements'), 1::bigint, 'employee sees own claim');
select test.throws(format('select public.hr_decide_reimbursement(%L, true)', pg_temp.id('rb1')), 'employee cannot approve claims', 'not allowed');
select test.throws($q$insert into public.hr_reimbursements (employee_id, claim_date, category, amount, description) values (hr_private.current_employee_id(), current_date, 'other', 5, 'direct')$q$,
  'direct claim insert blocked', 'permission denied');
select pg_temp.su('pay1');
select test.eq(public.hr_decide_reimbursement(pg_temp.id('rb1'), true) ->> 'status', 'approved', 'payroll approves claim');

-- ---- run creation
insert into t_ids select 'run6', (public.hr_create_payroll_run(date '2025-06-01', date '2025-06-30') ->> 'id')::uuid;
select test.throws($q$select public.hr_create_payroll_run(date '2025-06-01', date '2025-06-30')$q$, 'duplicate run rejected', 'already exists');
select test.throws($q$select public.hr_create_payroll_run(date '2025-06-15', date '2025-07-14')$q$, 'overlapping run rejected', 'already exists');
select public.hr_add_payroll_adjustment(pg_temp.id('run6'), pg_temp.id('emp1'), 500, 'Spot award for release', 'Spot bonus');
select pg_temp.su('emp1');
select test.throws(format('select public.hr_calculate_payroll_run(%L)', pg_temp.id('run6')), 'employee cannot calculate payroll', 'not allowed');

-- ---- calculation + LOP math
select pg_temp.su('pay1');
select test.eq((public.hr_calculate_payroll_run(pg_temp.id('run6')) ->> 'employees')::int, 2, 'two employees with structures calculated');
-- emp1: 21 working days in June 2025, 3 LOP -> 18 payable. Earnings (21000 + 8400) * 18/21 = 25200, + 500 bonus = 25700.
-- Deduction 1000 (fixed, not prorated). Reimbursement 300. Net = 25700 - 1000 + 300 = 25000.
select test.ok((select working_days = 21 and lop_days = 3 and payable_days = 18 from public.hr_payroll_items where employee_id = pg_temp.id('emp1')),
  'LOP from unpaid leave: 21 working, 3 LOP, 18 payable');
select test.eq((select gross from public.hr_payroll_items where employee_id = pg_temp.id('emp1')), 25700.00::numeric, 'prorated gross incl. adjustment');
select test.eq((select total_deductions from public.hr_payroll_items where employee_id = pg_temp.id('emp1')), 1000.00::numeric,
  'unverified statutory component not applied');
select test.eq((select net from public.hr_payroll_items where employee_id = pg_temp.id('emp1')), 25000.00::numeric, 'net includes approved reimbursement');
select test.ok((select breakdown -> 'skipped_unverified' ? 'STAT_TEST' from public.hr_payroll_items where employee_id = pg_temp.id('emp1')),
  'skipped unverified component reported in breakdown');
-- emp2 joined Mon 16 June: 11 payable of 21 -> 21000 * 11/21 = 11000
select test.ok((select payable_days = 11 and gross = 11000 and net = 11000 from public.hr_payroll_items where employee_id = pg_temp.id('emp2')),
  'mid-month joiner prorated (11/21)');
select test.eq(public.hr_calculate_payroll_run(pg_temp.id('run6')) ->> 'net', '36000.00', 'recalculation is repeatable');

-- ---- review / approve with separation of duties
select test.eq(public.hr_review_payroll_run(pg_temp.id('run6')) ->> 'status', 'reviewed', 'run reviewed');
select test.throws(format('select public.hr_approve_payroll_run(%L)', pg_temp.id('run6')), 'preparer cannot approve own run', 'different person');
select pg_temp.su('pay2');
select test.eq(public.hr_approve_payroll_run(pg_temp.id('run6')) ->> 'status', 'approved', 'second payroll admin approves');
select test.throws(format('select public.hr_add_payroll_adjustment(%L, %L, 100, %L)', pg_temp.id('run6'), pg_temp.id('emp1'), 'late add'),
  'no adjustments after approval', 'before the run is approved');
select test.throws(format('select public.hr_calculate_payroll_run(%L)', pg_temp.id('run6')), 'no recalculation after approval', 'Only draft or calculated');
select pg_temp.su('emp1');
select test.eq(test.count_rows('select 1 from public.hr_payslips'), 0::bigint, 'no payslip visible before finalization');
select test.eq(test.count_rows('select 1 from public.hr_payroll_items'), 0::bigint, 'employee cannot read payroll items');

-- ---- finalize -> payslips
select pg_temp.su('pay2');
select test.eq((public.hr_finalize_payroll_run(pg_temp.id('run6')) ->> 'payslips')::int, 2, 'finalize creates payslips');
select test.as_owner();
select test.throws($q$update public.hr_payroll_items set net = 1$q$, 'finalized items immutable (even for the table owner)', 'cannot be changed');
select test.throws($q$delete from public.hr_payroll_adjustments$q$, 'finalized adjustments immutable', 'cannot be changed');
select test.throws($q$update public.hr_payslips set net = 1$q$, 'payslips immutable', 'immutable');
select test.throws(format('update public.hr_payroll_runs set period_end = %L where id = %L', '2025-06-29', pg_temp.id('run6')), 'finalized run frozen', 'finalized');
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp1')) and type = 'payroll.payslip_published'),
  'employee notified of payslip');

select pg_temp.su('emp1');
select test.eq(test.count_rows('select 1 from public.hr_payslips'), 1::bigint, 'employee sees only own payslip');
select test.eq((select net from public.hr_payslips), 25000.00::numeric, 'payslip carries the finalized net');
select test.eq((select breakdown ->> 'bank_account_last4' from public.hr_payslips), '9012', 'payslip shows masked bank account');
select pg_temp.su('emp2');
select test.eq(test.count_rows('select 1 from public.hr_payslips'), 1::bigint, 'second employee sees only own payslip');
select pg_temp.su('hr');
select test.eq(test.count_rows('select 1 from public.hr_payslips'), 0::bigint, 'HR admin cannot read payslips');
select test.eq(test.count_rows('select 1 from public.hr_payroll_runs'), 0::bigint, 'HR admin cannot read payroll runs');
select test.eq(test.count_rows('select 1 from public.hr_payroll_items'), 0::bigint, 'HR admin cannot read payroll items');

-- ---- mark paid (status only)
select pg_temp.su('hr');
select test.throws(format('select public.hr_mark_payroll_paid(%L, %L)', pg_temp.id('run6'), 'UTR-TEST-001'), 'HR admin cannot mark payroll paid', 'not allowed');
select pg_temp.su('pay2');
select test.eq(public.hr_mark_payroll_paid(pg_temp.id('run6'), 'UTR-TEST-001') ->> 'status', 'paid', 'run marked paid with reference');
select test.eq((select status from public.hr_reimbursements where id = pg_temp.id('rb1')), 'paid', 'reimbursement paid with the run');

-- ---- post-finalization correction goes to the next run
select pg_temp.su('pay1');
select test.throws(format('select public.hr_create_payroll_correction(%L, %L, -200, %L)', pg_temp.id('run6'), pg_temp.id('hr'), 'x'),
  'correction only for employees in the run', 'not part of');
select public.hr_create_payroll_correction(pg_temp.id('run6'), pg_temp.id('emp1'), -200, 'Allowance over-paid in June');
select test.ok((select run_id is null and source = 'correction' from public.hr_payroll_adjustments where source_run_id = pg_temp.id('run6')),
  'correction parked until the next run');
insert into t_ids select 'run7', (public.hr_create_payroll_run(date '2025-07-01', date '2025-07-31') ->> 'id')::uuid;
select test.throws(format('select public.hr_create_payroll_correction(%L, %L, 50, %L)', pg_temp.id('run7'), pg_temp.id('emp1'), 'x'),
  'corrections only against finalized runs', 'finalized runs only');
select public.hr_calculate_payroll_run(pg_temp.id('run7'));
-- July 2025: 23 working days, no LOP; 29400 gross; 1000 + 200 correction deductions
select test.ok((select gross = 29400 and total_deductions = 1200 and net = 28200 from public.hr_payroll_items where run_id = pg_temp.id('run7') and employee_id = pg_temp.id('emp1')),
  'correction applied in next run');
select test.eq((select run_id from public.hr_payroll_adjustments where source_run_id = pg_temp.id('run6')), pg_temp.id('run7'), 'correction attached to next run');
select test.eq((select net from public.hr_payroll_items where run_id = pg_temp.id('run6') and employee_id = pg_temp.id('emp1')), 25000.00::numeric,
  'finalized June data unchanged by correction');
select test.as_owner();

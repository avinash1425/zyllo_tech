-- Module 7 (170): self-adjustment / self-approval denial, salary structure
-- maker-checker and revisions, component eligibility, variable-pay approval,
-- duplicate prevention, statutory rule validation + calculation basis, LOP,
-- run return-for-correction, finalization, payments (partial / failed /
-- reconciled), correction requests, final-settlement coverage, holds, scope,
-- bank verification, overview / reports, employee self-service and RLS.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.
--
-- Hand-computed expectations (Mon-Fri working days):
--   Aug 2025 = 21 working days, Sep 2025 = 22 (1-15 Sep = 11, 16-30 Sep = 11).

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;

create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.comp(p_code text) returns uuid language sql as $$ select id from public.hr_salary_components where code = p_code $$;
create or replace function pg_temp.item(p_run text, p_emp text) returns public.hr_payroll_items language sql as $$
  select * from public.hr_payroll_items where run_id = (select v from t_ids where k = p_run) and employee_id = (select v from t_ids where k = p_emp) $$;
create or replace function pg_temp.pay(p_run text, p_emp text) returns uuid language sql as $$
  select id from public.hr_payroll_payments where run_id = (select v from t_ids where k = p_run) and employee_id = (select v from t_ids where k = p_emp) $$;

do $$
begin
  insert into t_ids values ('hr',   test.make_employee('m7.hr@test.local',   'Hema',  null, array['hr_admin']));
  insert into t_ids values ('pay1', test.make_employee('m7.pay1@test.local', 'Prem',  null, array['payroll_admin']));
  insert into t_ids values ('pay2', test.make_employee('m7.pay2@test.local', 'Padma', null, array['payroll_admin']));
  insert into t_ids values ('pay3', test.make_employee('m7.pay3@test.local', 'Pran',  null, array['payroll_admin']));
  insert into t_ids values ('sup',  test.make_employee('m7.sup@test.local',  'Sunil', null, array['super_admin']));
  insert into t_ids values ('emp1', test.make_employee('m7.emp1@test.local', 'Esha'));
  insert into t_ids values ('emp2', test.make_employee('m7.emp2@test.local', 'Ekam'));
  update public.hr_employees set joining_date = date '2024-01-01', probation_end_date = null
   where id in (select v from t_ids where k in ('pay1','pay2','pay3','emp1','emp2'));
  -- emp2: one approved unpaid-leave day on Tue 5 Aug 2025
  insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status)
  values ((select v from t_ids where k = 'emp2'), (select id from public.hr_leave_types where code = 'LOP'),
          date '2025-08-05', date '2025-08-05', 1, 2025, 'Synthetic personal day', 'approved');
  insert into public.hr_legal_entities (code, name, country) values ('M7-A', 'Synthetic Entity A', 'IN'), ('M7-B', 'Synthetic Entity B', 'IN');
  insert into t_ids select 'le_a', id from public.hr_legal_entities where code = 'M7-A';
  insert into t_ids select 'le_b', id from public.hr_legal_entities where code = 'M7-B';
end $$;

-- =================================================================== P4: self-protection
select pg_temp.su('pay1');
select test.throws(format('insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc) values (%L, %L, 1)', pg_temp.id('pay1'), '2025-01-01'),
  'payroll admin cannot create own salary structure', 'own salary structure');
select test.throws(format('insert into public.hr_employee_bank_accounts (employee_id, bank_name, account_holder, account_number) values (%L, %L, %L, %L)',
  pg_temp.id('pay1'), 'Example Bank', 'Prem Test', '999988887777'), 'payroll admin cannot add own bank account', 'row-level security');
select test.throws(format('insert into public.hr_payroll_employee_identifiers (employee_id, tax_id) values (%L, %L)', pg_temp.id('pay1'), 'TEST1234'),
  'payroll admin cannot set own payroll identifiers', 'row-level security');
select test.throws(format('insert into public.hr_payroll_statutory_enrollments (employee_id, rule_code, effective_from, declared_monthly_amount) values (%L, %L, %L, 0)',
  pg_temp.id('pay1'), 'TDS', '2025-01-01'), 'payroll admin cannot set own statutory enrolment / declared tax', 'row-level security');

-- =================================================================== structures: maker-checker
with x as (insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc, status) values (pg_temp.id('emp1'), date '2025-01-01', 523200, 'active') returning id, status)
insert into t_ids select 's_e1', id from x;
select test.eq((select status from public.hr_salary_structures where id = pg_temp.id('s_e1')), 'draft', 'structure forced to draft even if inserted as active');
insert into public.hr_salary_structure_items (structure_id, component_id, amount, percent) values
  (pg_temp.id('s_e1'), pg_temp.comp('BASIC'), 30000, null),
  (pg_temp.id('s_e1'), pg_temp.comp('HRA'), null, 40),
  (pg_temp.id('s_e1'), pg_temp.comp('CONVEYANCE'), 1600, null),
  (pg_temp.id('s_e1'), pg_temp.comp('OTHER_DEDUCTION'), 500, null);
select test.throws(format('insert into public.hr_salary_structure_items (structure_id, component_id, amount) values (%L, %L, 100)', pg_temp.id('s_e1'), pg_temp.comp('PF_EMPLOYEE')),
  'statutory-rule components cannot be put in a structure (no duplicate deduction)', 'statutory rule');
select test.throws(format('update public.hr_salary_structures set status = %L where id = %L', 'active', pg_temp.id('s_e1')),
  'structure cannot be activated directly', 'approval workflow');
select test.eq((public.hr_salary_structure_preview(pg_temp.id('s_e1')) ->> 'gross')::numeric, 43600::numeric, 'structure preview: 30000 + 40% HRA + 1600 = 43600 monthly gross');
select public.hr_submit_salary_structure(pg_temp.id('s_e1'), 'New joiner structure');
select test.throws(format('update public.hr_salary_structures set notes = %L where id = %L', 'x', pg_temp.id('s_e1')),
  'submitted structure is locked', 'cannot be edited');

with x as (insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc) values (pg_temp.id('emp2'), date '2025-01-01', 252000) returning id)
insert into t_ids select 's_e2', id from x;
insert into public.hr_salary_structure_items (structure_id, component_id, amount) values
  (pg_temp.id('s_e2'), pg_temp.comp('BASIC'), 20000), (pg_temp.id('s_e2'), pg_temp.comp('OTHER_ALLOWANCE'), 1000);
-- Component effective dating: OTHER_ALLOWANCE only from 1 Sep 2025.
update public.hr_salary_components set effective_from = date '2025-09-01' where code = 'OTHER_ALLOWANCE';
select public.hr_submit_salary_structure(pg_temp.id('s_e2'));

-- pay1's own structure must be prepared by someone else (pay2) and approved by a third person.
select pg_temp.su('pay2');
with x as (insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc) values (pg_temp.id('pay1'), date '2025-01-01', 600000) returning id)
insert into t_ids select 's_p1', id from x;
insert into public.hr_salary_structure_items (structure_id, component_id, amount) values (pg_temp.id('s_p1'), pg_temp.comp('BASIC'), 50000);
select public.hr_submit_salary_structure(pg_temp.id('s_p1'));
select test.throws(format('select public.hr_approve_salary_structure(%L)', pg_temp.id('s_p1')), 'preparer cannot approve the structure they prepared', 'different person');
select pg_temp.su('pay1');
select test.throws(format('select public.hr_approve_salary_structure(%L)', pg_temp.id('s_p1')), 'payroll admin cannot approve own salary structure', 'for yourself');
select test.throws(format('select public.hr_approve_salary_structure(%L)', pg_temp.id('s_e1')), 'preparer cannot approve own prepared structure', 'different person');
select pg_temp.su('pay3');
select test.eq(public.hr_approve_salary_structure(pg_temp.id('s_p1')) ->> 'status', 'active', 'third payroll user approves pay1''s structure');
select pg_temp.su('pay2');
select test.eq(public.hr_approve_salary_structure(pg_temp.id('s_e1')) ->> 'status', 'active', 'approver activates emp1 structure');
select public.hr_approve_salary_structure(pg_temp.id('s_e2'));
select test.ok((select approved_by = auth.uid() and approved_at is not null from public.hr_salary_structures where id = pg_temp.id('s_e1')), 'approval recorded');
select pg_temp.su('pay1');
select test.throws(format('update public.hr_salary_structure_items set amount = 99999 where structure_id = %L and component_id = %L', pg_temp.id('s_e1'), pg_temp.comp('BASIC')),
  'approved structure components are locked', 'only be changed while');

-- HR admin and employee: no salary-structure access
select pg_temp.su('hr');
select test.eq(test.count_rows('select 1 from public.hr_salary_structures'), 0::bigint, 'HR admin cannot read salary structures');
select test.throws(format('select public.hr_submit_salary_structure(%L)', pg_temp.id('s_e1')), 'HR admin cannot submit structures', 'not allowed');
select pg_temp.su('emp1');
select test.eq(test.count_rows('select 1 from public.hr_salary_structures'), 0::bigint, 'employee cannot read the structures table');

-- =================================================================== statutory rule setup (validation gate)
select pg_temp.su('pay1');
select test.throws($q$select public.hr_submit_statutory_rule((select id from public.hr_payroll_statutory_rules where code = 'EPF'))$q$,
  'template rule without rates cannot be submitted', 'contribution rate');
-- Synthetic TEST values only (not legal rates).
update public.hr_payroll_statutory_rules set employee_rate = 10, employer_rate = 10, wage_ceiling = 20000, effective_from = date '2025-01-01'
 where code = 'EPF';
select public.hr_submit_statutory_rule((select id from public.hr_payroll_statutory_rules where code = 'EPF'));
insert into public.hr_payroll_statutory_enrollments (employee_id, rule_code, effective_from) values (pg_temp.id('emp1'), 'EPF', date '2025-01-01');

-- =================================================================== August run: adjustments and separation
insert into t_ids select 'aug', (public.hr_create_payroll_run(date '2025-08-01', date '2025-08-31', 'Synthetic August') ->> 'id')::uuid;
select test.throws($q$select public.hr_create_payroll_run(date '2025-08-01', date '2025-08-31')$q$, 'duplicate company-wide run rejected', 'already exists');
select test.throws(format('select public.hr_create_payroll_run(%L, %L, null, %L)', '2025-08-10', '2025-09-09', pg_temp.id('le_a')),
  'entity run overlapping a company-wide run rejected', 'already exists');
select public.hr_calculate_payroll_run(pg_temp.id('aug'));

select test.throws(format('select public.hr_add_payroll_adjustment(%L, %L, 5000, %L)', pg_temp.id('aug'), pg_temp.id('pay1'), 'Self bonus'),
  'P4: payroll admin cannot add an adjustment to own pay', 'for yourself');
insert into t_ids select 'adj_var', public.hr_add_payroll_adjustment(pg_temp.id('aug'), pg_temp.id('emp1'), 2000, 'Synthetic on-call allowance', null, pg_temp.comp('VARIABLE_PAY'));
select test.eq((select status from public.hr_payroll_adjustments where id = pg_temp.id('adj_var')), 'pending', 'variable-pay entry needs approval');
select test.throws(format('select public.hr_add_payroll_adjustment(%L, %L, 100, %L, null, %L)', pg_temp.id('aug'), pg_temp.id('emp1'), 'again', pg_temp.comp('VARIABLE_PAY')),
  'duplicate component adjustment rejected', 'already has an adjustment');
select test.throws(format('select public.hr_add_payroll_adjustment(%L, %L, -100, %L, null, %L)', pg_temp.id('aug'), pg_temp.id('emp1'), 'manual pf', pg_temp.comp('PF_EMPLOYEE')),
  'statutory component cannot be a manual adjustment', 'statutory');
select test.throws(format('select public.hr_add_payroll_adjustment(%L, %L, 100, %L, null, %L)', pg_temp.id('aug'), pg_temp.id('emp1'), 'wrong sign', pg_temp.comp('SALARY_RECOVERY')),
  'deduction component with a positive amount rejected', 'does not match');
select public.hr_calculate_payroll_run(pg_temp.id('aug'));
select test.ok(((pg_temp.item('aug', 'emp1')).breakdown -> 'validation' -> 'errors') @> '[{"code":"pending_adjustment"}]', 'pending adjustment flagged as validation error');
select test.throws(format('select public.hr_review_payroll_run(%L)', pg_temp.id('aug')), 'run with pending adjustments cannot be submitted', 'waiting for approval');
select test.throws(format('select public.hr_decide_payroll_adjustment(%L, true)', pg_temp.id('adj_var')), 'creator cannot approve own adjustment', 'you created');
select pg_temp.su('emp1');
select test.throws(format('select public.hr_decide_payroll_adjustment(%L, true)', pg_temp.id('adj_var')), 'employee cannot approve adjustments', 'not allowed');
select pg_temp.su('pay2');
select test.eq(public.hr_decide_payroll_adjustment(pg_temp.id('adj_var'), true) ->> 'status', 'approved', 'different approver approves the variable pay');
select public.hr_add_payroll_adjustment(pg_temp.id('aug'), pg_temp.id('emp2'), 300, 'Synthetic referral award', 'Referral award');
select public.hr_add_payroll_adjustment(pg_temp.id('aug'), pg_temp.id('pay3'), 500, 'Synthetic spot award', 'Spot award');
select pg_temp.su('pay1');
select (public.hr_calculate_payroll_run(pg_temp.id('aug')) ->> 'employees')::int;
select test.eq((select count(*) from public.hr_payroll_items where run_id = pg_temp.id('aug')), 3::bigint, 'August: emp1, emp2, pay1 have approved structures');
-- emp1: 30000 + 12000 + 1600 + 2000 variable = 45600; deduction 500; EPF pending -> not applied.
select test.ok(((pg_temp.item('aug', 'emp1')).gross, (pg_temp.item('aug', 'emp1')).total_deductions, (pg_temp.item('aug', 'emp1')).net)
               = (45600.00, 500.00, 45100.00), 'emp1 August: gross 45600, deductions 500, net 45100');
select test.ok((pg_temp.item('aug', 'emp1')).breakdown -> 'statutory_pending' ? 'EPF', 'EPF pending validation reported, not applied');
select test.ok(((pg_temp.item('aug', 'emp1')).breakdown -> 'validation' -> 'warnings') @> '[{"code":"statutory_pending_validation"}]', 'statutory pending warning');
-- emp2: 1 LOP day -> 20/21 payable; 20000 * 20/21 = 19047.619 -> 19047.62 (half-up); + 300 = 19347.62. Allowance not yet effective.
select test.ok(((pg_temp.item('aug', 'emp2')).lop_days, (pg_temp.item('aug', 'emp2')).payable_days, (pg_temp.item('aug', 'emp2')).gross)
               = (1.0, 20.0, 19347.62), 'emp2 August: 1 LOP day, 20 payable, gross 19347.62 (rounded half-up per line)');
select test.ok((pg_temp.item('aug', 'emp2')).breakdown -> 'skipped_ineligible' @> '[{"code":"OTHER_ALLOWANCE","reason":"not_eligible_or_not_effective"}]',
  'component not yet effective is skipped and reported');
select test.ok(((pg_temp.item('aug', 'emp2')).breakdown -> 'validation' -> 'warnings') @> '[{"code":"no_bank_account"}]', 'missing bank account warned');
select public.hr_review_payroll_run(pg_temp.id('aug'), 'Submitted for approval');
-- Approvals: pay2 created adjustments; pay3 is the subject of one; pay1 prepared the run.
select pg_temp.su('pay2');
select test.throws(format('select public.hr_approve_payroll_run(%L)', pg_temp.id('aug')), 'approver who created an adjustment in the run is refused', 'you created an adjustment');
select pg_temp.su('pay3');
select test.throws(format('select public.hr_approve_payroll_run(%L)', pg_temp.id('aug')), 'approver whose own pay is adjusted is refused', 'your own pay');
select pg_temp.su('pay1');
select test.throws(format('select public.hr_approve_payroll_run(%L)', pg_temp.id('aug')), 'preparer cannot approve', 'different person');
select pg_temp.su('emp1');
select test.throws(format('select public.hr_approve_payroll_run(%L)', pg_temp.id('aug')), 'employee cannot approve payroll', 'not allowed');
select pg_temp.su('sup');
select test.eq(public.hr_approve_payroll_run(pg_temp.id('aug')) ->> 'status', 'approved', 'independent approver approves');
select test.throws(format('select public.hr_finalize_payroll_run(%L)', '00000000-0000-0000-0000-000000000000'), 'finalize unknown run', 'not found');
select test.eq((public.hr_finalize_payroll_run(pg_temp.id('aug')) ->> 'payslips')::int, 3, 'finalization publishes 3 payslips');
select test.eq((select payment_status from public.hr_payroll_runs where id = pg_temp.id('aug')), 'pending', 'finalized run: payment pending');
select test.eq((select count(*) from public.hr_payroll_payments where run_id = pg_temp.id('aug') and status = 'pending'), 3::bigint, 'one pending payment per employee');
select test.throws(format('update public.hr_payroll_runs set notes = %L where id = %L', 'edit', pg_temp.id('aug')), 'no direct run updates by any app user', 'permission denied');
select test.as_owner();
select test.throws(format('update public.hr_payroll_runs set notes = %L where id = %L', 'edit', pg_temp.id('aug')), 'finalized run frozen even for the owner (except payment tracking)', 'finalized');
select test.throws(format('update public.hr_payroll_runs set status = %L where id = %L', 'draft', pg_temp.id('aug')), 'finalized run cannot be reopened', 'finalized');

-- =================================================================== payslips: visibility & content
select pg_temp.su('emp1');
select test.eq(test.count_rows('select 1 from public.hr_payslips'), 1::bigint, 'employee sees only own payslip');
select test.ok((select net = 45100 and breakdown ? 'employer' and breakdown -> 'employee' ->> 'employee_code' is not null and not (breakdown ? 'validation')
                from public.hr_payslips), 'payslip: net, employer and employee details; internal validation removed');
select test.eq(test.count_rows('select 1 from public.hr_payroll_payments'), 0::bigint, 'employee cannot read the payments table');
select pg_temp.su('hr');
select test.eq(test.count_rows('select 1 from public.hr_payslips'), 0::bigint, 'HR admin cannot read payslips');
select test.eq(test.count_rows('select 1 from public.hr_payroll_payments'), 0::bigint, 'HR admin cannot read payments');
select test.eq(test.count_rows('select 1 from public.hr_payroll_statutory_rules'), 0::bigint, 'HR admin cannot read statutory rules');
select test.throws($q$select public.hr_payroll_overview()$q$, 'HR admin cannot open the payroll overview', 'not allowed');

-- =================================================================== payments: evidence, partial, failed, reconciled
select pg_temp.su('pay1');
select test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L, %L, %L, %L)', pg_temp.pay('aug', 'pay1'), 'paid', 'bank_transfer', 'UTR-SELF', '2025-09-01'),
  'payroll user cannot record own salary payment', 'for yourself');
select pg_temp.su('pay2');
select test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L)', pg_temp.pay('aug', 'emp1'), 'paid'),
  'paid requires a payment reference', 'reference');
select test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L, %L, %L, %L)', pg_temp.pay('aug', 'emp1'), 'paid', 'bank_transfer', 'UTR-0001', '2999-01-01'),
  'payment date cannot be in the future', 'future');
select test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L)', pg_temp.pay('aug', 'emp1'), 'reconciled'),
  'reconciled is not a recordable status', 'reconciliation');
select public.hr_record_payroll_payments(array[pg_temp.pay('aug', 'emp1')], 'paid', 'bank_transfer', 'UTR-SYN-0001', date '2025-09-01');
select test.ok((select status = 'finalized' and payment_status = 'partially_paid' from public.hr_payroll_runs where id = pg_temp.id('aug')),
  'one of three paid: run stays finalized, payment partially paid');
select test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L, %L, %L, %L, %L)', pg_temp.pay('aug', 'emp2'), 'partially_paid', 'bank_transfer', 'UTR-SYN-0002', '2025-09-01', 99999),
  'partial amount must be below net', 'partial payment');
select public.hr_record_payroll_payments(array[pg_temp.pay('aug', 'emp2')], 'partially_paid', 'bank_transfer', 'UTR-SYN-0002', date '2025-09-01', 10000);
select test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L)', pg_temp.pay('aug', 'emp2'), 'failed'),
  'failure needs a reason', 'failure reason');
select public.hr_record_payroll_payments(array[pg_temp.pay('aug', 'emp2')], 'failed', null, null, null, null, 'Synthetic: beneficiary account closed');
select test.ok((select status = 'failed' and amount_paid = 10000 from public.hr_payroll_payments where id = pg_temp.pay('aug', 'emp2')),
  'failed payment keeps the amount already paid');
select test.throws(format('select public.hr_mark_payroll_paid(%L, %L)', pg_temp.id('aug'), 'BATCH-1'),
  'bulk mark-paid refused while a payment failed', 'failed or were partially paid');
select public.hr_record_payroll_payments(array[pg_temp.pay('aug', 'emp2')], 'paid', 'bank_transfer', 'UTR-SYN-0003', date '2025-09-03');
select test.eq((select count(*) from public.hr_payroll_payment_events where payment_id = pg_temp.pay('aug', 'emp2')), 3::bigint, 'payment history keeps every transition');
select test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L)', pg_temp.pay('aug', 'emp2'), 'processing'),
  'paid payment cannot go back to processing', 'cannot move');
select public.hr_record_payroll_payments(array[pg_temp.pay('aug', 'pay1')], 'paid', 'bank_transfer', 'UTR-SYN-0004', date '2025-09-01');
select test.ok((select status = 'paid' and payment_status = 'paid' and payment_reference = 'Multiple references' from public.hr_payroll_runs where id = pg_temp.id('aug')),
  'all payments recorded: run paid');
select test.throws(format('select public.hr_reconcile_payroll_payments(array[%L]::uuid[], %L)', pg_temp.pay('aug', 'emp1'), 'Bank statement 0925'),
  'recorder cannot reconcile own entry', 'different person');
select test.throws($q$update public.hr_payroll_payment_events set note = 'x'$q$, 'payment history is append-only', 'permission denied');
select pg_temp.su('pay3');
select test.eq((public.hr_reconcile_payroll_payments(array[pg_temp.pay('aug', 'emp1')], 'Synthetic bank statement 09/2025') ->> 'reconciled')::int, 1, 'second person reconciles');
select pg_temp.su('emp1');
select test.eq((select status from public.hr_my_payroll_payments()), 'reconciled', 'employee sees own payment status');

-- =================================================================== statutory validation gate
select pg_temp.su('pay1');
select test.throws($q$select public.hr_approve_statutory_rule((select id from public.hr_payroll_statutory_rules where code = 'EPF'), 'Validated by consultant')$q$,
  'preparer cannot validate own statutory rule', 'different person');
select pg_temp.su('pay2');
select test.throws($q$select public.hr_approve_statutory_rule((select id from public.hr_payroll_statutory_rules where code = 'EPF'), '')$q$,
  'validation reference required', 'validated');
select test.eq(public.hr_approve_statutory_rule((select id from public.hr_payroll_statutory_rules where code = 'EPF'),
  'SYNTHETIC TEST - professional validation reference placeholder') ->> 'status', 'approved', 'rule approved with validation reference');
select test.throws($q$update public.hr_payroll_statutory_rules set employee_rate = 12 where code = 'EPF'$q$, 'approved rule cannot be edited', 'new version');

-- =================================================================== correction request (employee query)
select pg_temp.su('emp1');
insert into t_ids select 'q1', public.hr_submit_payroll_query((select id from public.hr_payslips), 'missing_earning', 'Synthetic: shift allowance missing for August');
select test.throws(format('select public.hr_submit_payroll_query(%L, %L, %L)',
  (select id from public.hr_payslips where employee_id = pg_temp.id('emp2')), 'other', 'not mine'), 'employee cannot query another person''s payslip', 'not found');
select test.eq(test.count_rows('select 1 from public.hr_payroll_correction_requests'), 1::bigint, 'employee sees own query');
select pg_temp.su('emp2');
select test.eq(test.count_rows('select 1 from public.hr_payroll_correction_requests'), 0::bigint, 'other employee cannot see it');
select pg_temp.su('pay1');
select test.throws(format('select public.hr_create_payroll_correction(%L, %L, 100, %L)', pg_temp.id('aug'), pg_temp.id('pay1'), 'self'),
  'P4: payroll admin cannot create a correction for own pay', 'for yourself');
insert into t_ids select 'q_self', public.hr_submit_payroll_query((select id from public.hr_payslips where employee_id = pg_temp.id('pay1')), 'other', 'Synthetic: own query as an employee');
select test.throws(format('select public.hr_prepare_payroll_correction(%L, 1000, %L)', pg_temp.id('q_self'), 'self'),
  'payroll admin cannot prepare a correction to own pay', 'for yourself');
select public.hr_prepare_payroll_correction(pg_temp.id('q1'), 750, 'Synthetic: 5 shifts x 150');
select test.throws(format('select public.hr_decide_payroll_correction(%L, true)', pg_temp.id('q1')), 'preparer cannot approve the correction', 'someone other');
select pg_temp.su('pay2');
select test.eq(public.hr_decide_payroll_correction(pg_temp.id('q1'), true, 'OK') ->> 'status', 'applied', 'correction approved and applied');
select test.ok((select run_id is null and source = 'correction' and created_by = test.user_of(pg_temp.id('pay1')) and amount = 750
                from public.hr_payroll_adjustments where correction_request_id = pg_temp.id('q1')), 'correction parked for the next run; finalized August untouched');
select test.eq((pg_temp.item('aug', 'emp1')).net, 45100.00::numeric, 'finalized August item unchanged');

-- =================================================================== salary revision (effective dates, history)
select pg_temp.su('pay1');
insert into t_ids select 's_e1r', public.hr_create_salary_revision(pg_temp.id('s_e1'), date '2025-09-16', 'Synthetic annual increment', 559200);
update public.hr_salary_structure_items set amount = 33000 where structure_id = pg_temp.id('s_e1r') and component_id = pg_temp.comp('BASIC');
select public.hr_submit_salary_structure(pg_temp.id('s_e1r'));
select pg_temp.su('pay2');
select test.ok((public.hr_approve_salary_structure(pg_temp.id('s_e1r')) -> 'ended_structures') @> format('[{"id":"%s","effective_to":"2025-09-15"}]', pg_temp.id('s_e1'))::jsonb,
  'approving a revision end-dates the previous structure the day before');
select test.eq((select count(*) from public.hr_salary_structures where employee_id = pg_temp.id('emp1') and status = 'active'), 2::bigint, 'salary history preserved (2 active periods)');
select pg_temp.su('emp1');
select test.eq((public.hr_my_salary_structure() -> 'current' ->> 'gross')::numeric, 47800::numeric, 'My Salary shows the current structure (33000 + 13200 + 1600)');
select test.eq(jsonb_array_length(public.hr_my_salary_structure() -> 'history'), 2, 'My Salary history');

-- =================================================================== September run: statutory, revision split, settlement, hold, return
select pg_temp.su('pay2');
select test.throws(format('select public.hr_record_settlement_coverage(%L, %L, %L)', pg_temp.id('pay2'), '2025-09-12', 'FNF-SELF'),
  'cannot record settlement coverage for yourself', 'for yourself');
select public.hr_record_settlement_coverage(pg_temp.id('emp2'), date '2025-09-12', 'FNF-SYN-0001', 'Synthetic: days to 12 Sep paid in settlement');
select pg_temp.su('pay1');
insert into t_ids select 'sep', (public.hr_create_payroll_run(date '2025-09-01', date '2025-09-30', 'Synthetic September') ->> 'id')::uuid;
select test.as_owner();
insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status)
values (pg_temp.id('emp1'), (select id from public.hr_leave_types where code = 'LOP'), date '2025-09-25', date '2025-09-25', 1, 2025, 'Synthetic pending', 'pending_approval');
select pg_temp.su('pay1');
select test.throws(format('select public.hr_set_payroll_hold(%L, %L, true, %L)', pg_temp.id('sep'), pg_temp.id('pay1'), 'self'), 'cannot hold own pay', 'for yourself');
select pg_temp.su('pay2');
select public.hr_set_payroll_hold(pg_temp.id('sep'), pg_temp.id('pay1'), true, 'Synthetic: pending clearance');
select pg_temp.su('pay1');
select public.hr_calculate_payroll_run(pg_temp.id('sep'));
select test.ok((select validation -> 'excluded' @> format('[{"employee_id":"%s","reason":"on_hold"}]', pg_temp.id('pay1'))::jsonb from public.hr_payroll_runs where id = pg_temp.id('sep')),
  'held employee excluded and listed');
-- emp1 Sep: seg 1-15 (11 days, factor 0.5) old structure, seg 16-30 (11 days) revision.
-- Earnings: BASIC 15000+16500, HRA 6000+6600, CONV 800+800 = 45700; + 750 correction = 46450.
-- EPF (synthetic 10%/10%, ceiling 20000 split 11/22 per segment = 10000): employee 1000+1000, employer 1000+1000.
-- Deductions: OTHER_DEDUCTION 250+250 + PF 2000 = 2500. Net = 46450 - 2500 = 43950.
select test.ok(((pg_temp.item('sep', 'emp1')).gross, (pg_temp.item('sep', 'emp1')).total_deductions,
                (pg_temp.item('sep', 'emp1')).employer_contributions, (pg_temp.item('sep', 'emp1')).net) = (46450.00, 2500.00, 2000.00, 43950.00),
  'emp1 September: revision split, statutory applied with ceiling, correction included');
select test.eq(jsonb_array_length((pg_temp.item('sep', 'emp1')).breakdown -> 'segments'), 2, 'two salary structure segments');
select test.ok((select bool_and((x ->> 'contribution_base')::numeric = 10000 and (x ->> 'employee_amount')::numeric = 1000 and x ->> 'validation_reference' is not null)
                from jsonb_array_elements((pg_temp.item('sep', 'emp1')).breakdown -> 'statutory') x), 'statutory basis recorded per segment (base, ceiling, amounts, validation ref)');
select test.ok(((pg_temp.item('sep', 'emp1')).breakdown -> 'validation' -> 'warnings') @> '[{"code":"leave_pending"}]', 'pending leave in period warned (not counted)');
-- emp2: settlement covers to 12 Sep -> window 13-30 Sep = 12 working days of 22.
-- BASIC 20000*12/22 = 10909.09; OTHER_ALLOWANCE (now effective) 1000*12/22 = 545.45; gross 11454.54. Not enrolled in EPF.
select test.ok(((pg_temp.item('sep', 'emp2')).payable_days, (pg_temp.item('sep', 'emp2')).gross) = (12.0, 11454.54),
  'final-settlement coverage excludes already-settled days (no double payment)');
select test.ok((pg_temp.item('sep', 'emp2')).breakdown -> 'statutory' @> '[{"code":"EPF","applied":false,"reason":"not_enrolled"}]', 'non-enrolled employee: rule not applied, reason recorded');
select public.hr_review_payroll_run(pg_temp.id('sep'));
select pg_temp.su('pay2');
select test.throws(format('select public.hr_return_payroll_run(%L, %L)', pg_temp.id('sep'), ''), 'return needs a reason', 'reason');
select public.hr_return_payroll_run(pg_temp.id('sep'), 'Synthetic: re-check hold');
select test.ok((select status = 'calculated' and returned_by is not null and reviewed_by is null from public.hr_payroll_runs
                where id = pg_temp.id('sep')), 'run returned for correction');
select pg_temp.su('pay1');
select public.hr_review_payroll_run(pg_temp.id('sep'), 'Re-submitted');
select pg_temp.su('pay2');
select test.eq(public.hr_approve_payroll_run(pg_temp.id('sep')) ->> 'status', 'approved', 'September approved (correction prepared by someone else)');
select public.hr_finalize_payroll_run(pg_temp.id('sep'));
select test.eq((select count(*) from public.hr_payroll_runs where status in ('finalized','paid')), 2::bigint, 'historical runs preserved');

-- Reports
select test.ok((select employee_amount = 2000 and employer_amount = 2000 and contribution_base = 20000 from public.hr_payroll_statutory_report(pg_temp.id('sep'))
                where rule_code = 'EPF'), 'statutory report aggregates employee/employer contributions');
select test.eq((public.hr_payroll_overview(date '2025-08-01') -> 'totals' ->> 'employees')::int, 3, 'overview: August employees');
select test.eq((public.hr_payroll_overview(date '2025-08-01') -> 'totals' ->> 'net')::numeric,
               (select sum(net) from public.hr_payroll_items where run_id = pg_temp.id('aug')), 'overview totals come from payroll records');
select test.eq((public.hr_payroll_overview(date '2025-09-01') -> 'payments' -> 'pending' ->> 'count')::int, 2, 'overview: September payments pending');
select test.eq((public.hr_payroll_overview(date '2025-08-01', null, null, pg_temp.id('emp1')) -> 'totals' ->> 'employees')::int, 1, 'overview employee filter');
-- Post-finalization change: approved unpaid leave in August recorded after finalization.
select test.as_owner();
-- (one transaction => now() is constant; stamp the late approval explicitly after finalization)
insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status, updated_at)
values (pg_temp.id('emp1'), (select id from public.hr_leave_types where code = 'LOP'), date '2025-08-20', date '2025-08-20', 1, 2025, 'Synthetic late approval', 'approved',
        now() + interval '1 minute');
select pg_temp.su('pay1');
select test.ok(exists (select 1 from public.hr_payroll_post_finalization_changes(pg_temp.id('aug')) where change_type = 'leave' and employee_id = pg_temp.id('emp1')),
  'leave approved after finalization is listed for a controlled correction');
select test.eq((pg_temp.item('aug', 'emp1')).lop_days, 0.0, 'finalized August LOP not silently changed');

-- Exports are audited and need payroll.export
select public.hr_log_payroll_export('payroll_register', pg_temp.id('aug'), 3);
select pg_temp.su('hr');
select test.throws(format('select public.hr_log_payroll_export(%L, %L)', 'payroll_register', pg_temp.id('aug')), 'HR admin cannot export payroll', 'not allowed');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where action = 'PAYROLL_EXPORT' and context ->> 'kind' = 'payroll_register'), 'export audited');
select test.ok((select count(*) > 0 and bool_and(new_data ->> 'amount' = '[redacted]') from public.hr_audit_log where table_name = 'hr_payroll_payments'),
  'payment amounts redacted in audit log');

-- =================================================================== run scope (company / legal entity)
select pg_temp.su('pay1');
select public.hr_create_payroll_run(date '2025-10-01', date '2025-10-31', 'Entity A October', pg_temp.id('le_a'));
select test.ok((public.hr_create_payroll_run(date '2025-10-01', date '2025-10-31', 'Entity B October', pg_temp.id('le_b')) ->> 'id') is not null,
  'different legal entities can run the same period');
select test.throws($q$select public.hr_create_payroll_run(date '2025-10-01', date '2025-10-31')$q$, 'company-wide run overlapping entity runs rejected', 'already exists');

-- =================================================================== bank verification
with x as (insert into public.hr_employee_bank_accounts (employee_id, bank_name, account_holder, account_number, ifsc, verified)
           values (pg_temp.id('emp1'), 'Example Bank', 'Esha Test', '123456789012', 'ABCD0123456', true) returning id)
insert into t_ids select 'bank1', id from x;
select test.eq((select verified from public.hr_employee_bank_accounts where id = pg_temp.id('bank1')), false, 'bank account cannot be inserted as verified');
select test.throws(format('select public.hr_verify_bank_account(%L)', pg_temp.id('bank1')), 'enterer cannot verify the account', 'different person');
select pg_temp.su('pay2');
select test.eq((public.hr_verify_bank_account(pg_temp.id('bank1')) ->> 'verified')::boolean, true, 'second person verifies');
select pg_temp.su('pay1');
update public.hr_employee_bank_accounts set account_number = '123456789099' where id = pg_temp.id('bank1');
select test.eq((select verified from public.hr_employee_bank_accounts where id = pg_temp.id('bank1')), false, 'changing the account number voids verification');

select test.as_owner();

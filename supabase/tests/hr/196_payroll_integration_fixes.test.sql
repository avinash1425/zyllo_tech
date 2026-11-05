-- 196 — Payroll integration fixes:
--   A. Employees can no longer file reimbursements through Payroll's legacy
--      hr_submit_reimbursement (it skipped manager approval).
--   B. Module 10 (180) reimbursement flow still works end to end into a real
--      payroll run: request -> receipt -> manager -> finance -> approved claim
--      -> attached at calculation -> paid with the payroll payment -> request
--      completed.
--   C. Module 4 (130) final settlement: a lowered 'unpaid_salary' line makes the
--      payroll payment record only the lowered amount (partially paid); a full
--      line still records 'paid' and pays the payslip's attached claims.
-- Synthetic data only; the runner rolls the transaction back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_txt (k text primary key, v text);
grant all on t_ids, t_txt to authenticated, anon, service_role;
create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin perform test.as_owner(); perform test.as_user(test.user_of((select v from t_ids where k = p_k))); end $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.txt(p_k text) returns text language sql as $$ select v from t_txt where k = p_k $$;
-- Read as definer so RLS never hides fixtures from assertions.
create or replace function pg_temp.stage(p_req text) returns uuid language plpgsql security definer as $$
declare v_out uuid;
begin
  execute 'select id from public.hr_request_approvals where request_id = $1 and status = ''pending''' into v_out using (select t.v from t_ids t where t.k = p_req);
  return v_out;
end $$;
create or replace function pg_temp.req_status(p_req text) returns text language plpgsql security definer as $$
declare v_out text;
begin
  execute 'select status from public.hr_requests where id = $1' into v_out using (select t.v from t_ids t where t.k = p_req);
  return v_out;
end $$;
create or replace function pg_temp.payment(p_emp text) returns public.hr_payroll_payments language sql security definer as $$
  select * from public.hr_payroll_payments where run_id = (select v from t_ids where k = 'run') and employee_id = (select v from t_ids where k = p_emp) $$;

do $$
declare v_k text; s uuid;
begin
  insert into t_ids values ('pay1', test.make_employee('f196.pay1@test.local', 'Fia',  null, array['payroll_admin','employee']));
  insert into t_ids values ('pay2', test.make_employee('f196.pay2@test.local', 'Fynn', null, array['payroll_admin','employee']));
  insert into t_ids values ('mgr',  test.make_employee('f196.mgr@test.local',  'Faye', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('f196.emp1@test.local', 'Ferd', (select v from t_ids where k = 'mgr')));
  insert into t_ids values ('emp2', test.make_employee('f196.emp2@test.local', 'Flor'));
  insert into t_ids values ('emp3', test.make_employee('f196.emp3@test.local', 'Finn'));
  update public.hr_employees set joining_date = date '2024-01-01', probation_end_date = null where id in (select v from t_ids where t_ids.k like 'emp%');
  foreach v_k in array array['emp1','emp2','emp3'] loop
    insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc) values ((select v from t_ids where t_ids.k = v_k), date '2025-01-01', 264000) returning id into s;
    insert into public.hr_salary_structure_items (structure_id, component_id, amount) values (s, (select id from public.hr_salary_components where code = 'BASIC'), 22000);
  end loop;
  insert into t_txt values ('d1', (current_date - 3)::text);
  insert into t_txt values ('pstart', date_trunc('month', current_date - 3)::date::text);
  insert into t_txt values ('pend', (date_trunc('month', current_date - 3) + interval '1 month - 1 day')::date::text);
  -- Approved payroll-side claims for the settlement scenarios (C); attached at calculation.
  insert into public.hr_reimbursements (employee_id, claim_date, category, amount, description, status)
  values ((select v from t_ids where k = 'emp2'), current_date - 3, 'meals', 400, 'Synthetic approved claim (196)', 'approved') returning id into s;
  insert into t_ids values ('rb2', s);
  insert into public.hr_reimbursements (employee_id, claim_date, category, amount, description, status)
  values ((select v from t_ids where k = 'emp3'), current_date - 3, 'internet', 300, 'Synthetic approved claim (196)', 'approved') returning id into s;
  insert into t_ids values ('rb3', s);
end $$;

-- =====================================================================
-- A. Legacy Payroll direct submit is refused
-- =====================================================================
select pg_temp.su('emp1');
select test.throws(format('select public.hr_submit_reimbursement(%L::date, %L, 500, %L)', pg_temp.txt('d1'), 'travel', 'Direct taxi claim'),
  'employee direct reimbursement submit refused, pointing to HR Requests', 'My HR Requests');
select test.throws(format('select public.hr_submit_reimbursement(%L::date, %L, 500, %L, %L)', pg_temp.txt('d1'), 'travel', 'Direct taxi claim', 'receipt.pdf'),
  'direct submit refused even with a receipt reference', 'manager and finance approval');
select test.throws($q$insert into public.hr_reimbursements (employee_id, claim_date, category, amount, description) values (hr_private.current_employee_id(), current_date, 'other', 5, 'direct')$q$,
  'direct table insert still blocked', 'permission denied');
select pg_temp.su('pay1');
select test.throws(format('select public.hr_submit_reimbursement(%L::date, %L, 500, %L)', pg_temp.txt('d1'), 'meals', 'Payroll self claim'),
  'payroll staff cannot self-submit through Payroll either', 'My HR Requests');
select test.as_owner();
select test.eq((select count(*) from public.hr_reimbursements where employee_id in (pg_temp.id('emp1'), pg_temp.id('pay1'))), 0::bigint,
  'refused submissions created no claim rows');
select test.ok((select p.prosecdef and pg_get_functiondef(p.oid) like '%use_hr_requests%' from pg_proc p
                where p.oid = 'public.hr_submit_reimbursement(date, text, numeric, text, text)'::regprocedure),
  'hr_submit_reimbursement is the retired stub (error code use_hr_requests)');

-- =====================================================================
-- B. Module 10 reimbursement -> payroll, end to end
-- =====================================================================
select pg_temp.su('emp1');
do $$ declare j jsonb; begin
  insert into t_ids values ('rb1', public.hr_create_workflow_request('reimbursement', jsonb_build_object(
    'category','travel','expense_date', pg_temp.txt('d1'),'amount','1250.50','currency','INR','purpose','Client visit taxi (196)'), null, false));
  j := public.hr_register_request_attachment(pg_temp.id('rb1'), 'receipt', 'taxi196.pdf', 'application/pdf', 5000, repeat('c', 64));
  insert into t_txt values ('rpath1', j ->> 'storage_path');
end $$;
insert into storage.objects (bucket_id, name, owner) values ('hr-request-files', pg_temp.txt('rpath1'), auth.uid());
select public.hr_submit_workflow_request(pg_temp.id('rb1'));
select test.eq(pg_temp.req_status('rb1'), 'pending_approval', 'Module 10 claim submitted for approval');
select test.as_owner();
select test.eq((select count(*) from public.hr_reimbursements where employee_id = pg_temp.id('emp1')), 0::bigint, 'no payroll claim before approval');
select pg_temp.su('pay1');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('rb1'), 'approve')$q$, 'finance cannot skip the manager stage', 'not allowed');
select pg_temp.su('mgr');
select public.hr_decide_request_stage(pg_temp.stage('rb1'), 'approve', 'Manager OK');
select pg_temp.su('pay1');
select public.hr_decide_request_stage(pg_temp.stage('rb1'), 'approve', 'Finance OK');
select test.as_owner();
select test.ok((select r.status = 'approved' and z.status = 'approved' and z.amount = 1250.50 and z.payroll_run_id is null
                from public.hr_requests r join public.hr_reimbursements z on z.id = r.linked_entity_id where r.id = pg_temp.id('rb1')),
  'final approval writes one approved claim to Payroll');
select test.eq((select count(*) from public.hr_reimbursements where employee_id = pg_temp.id('emp1')), 1::bigint, 'exactly one payroll claim');

-- Payroll run for the claim's month: pay1 prepares, pay2 approves / finalizes / records payments.
select pg_temp.su('pay1');
insert into t_ids select 'run', (public.hr_create_payroll_run(pg_temp.txt('pstart')::date, pg_temp.txt('pend')::date) ->> 'id')::uuid;
select public.hr_calculate_payroll_run(pg_temp.id('run'));
select test.as_owner();
select test.ok((select z.payroll_run_id = pg_temp.id('run') from public.hr_requests r join public.hr_reimbursements z on z.id = r.linked_entity_id where r.id = pg_temp.id('rb1')),
  'approved request claim attached to the payroll run at calculation');
select test.eq((select reimbursements from public.hr_payroll_items where run_id = pg_temp.id('run') and employee_id = pg_temp.id('emp1')), 1250.50::numeric,
  'claim amount on the payroll item');
select test.ok(exists (select 1 from public.hr_request_events where request_id = pg_temp.id('rb1') and note = 'Included in a payroll run.'),
  'request history shows the claim was included in a payroll run');
select test.ok((select bool_and(payroll_run_id = pg_temp.id('run')) from public.hr_reimbursements where id in (pg_temp.id('rb2'), pg_temp.id('rb3'))),
  'payroll-side approved claims attached to the same run');
select pg_temp.su('pay1');
select public.hr_review_payroll_run(pg_temp.id('run'));
select pg_temp.su('pay2');
select public.hr_approve_payroll_run(pg_temp.id('run'));
select public.hr_finalize_payroll_run(pg_temp.id('run'));
select public.hr_record_payroll_payments(array[(pg_temp.payment('emp1')).id], 'paid', 'bank_transfer', 'UTR-196-0001', current_date);
select test.as_owner();
select test.ok((select z.status = 'paid' from public.hr_requests r join public.hr_reimbursements z on z.id = r.linked_entity_id where r.id = pg_temp.id('rb1')),
  'claim marked paid when payroll records the employee''s payment');
select test.eq(pg_temp.req_status('rb1'), 'completed', 'Module 10 request completed by the payroll payment');
select test.ok(exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('rb1')::text and title = 'Reimbursement paid'),
  'employee notified that the reimbursement was paid');

-- =====================================================================
-- C. Final settlement (Module 4) vs payroll payment
-- =====================================================================
do $$
declare v_x uuid; v_s uuid; v_line uuid; v_net numeric; v_low numeric; v_pay uuid;
begin
  if to_regclass('public.hr_payroll_settlements') is null then
    raise notice 'skip: Module 4 settlement tables not present';
    return;
  end if;
  -- (a) emp2: the preparer lowers the unpaid-salary line; payroll records only the lowered amount.
  perform test.as_owner();
  v_net := (pg_temp.payment('emp2')).amount;
  v_low := v_net - 1000;
  perform test.ok(v_net > 1000 and (pg_temp.payment('emp2')).status = 'pending', 'fixture: emp2 payslip unpaid in a finalized run');
  insert into public.hr_exits (employee_id, initiated_by, exit_type, status) values (pg_temp.id('emp2'), 'hr', 'resignation', 'final_settlement') returning id into v_x;
  insert into public.hr_payroll_settlements (exit_id, employee_id, status, prepared_by) values (v_x, pg_temp.id('emp2'), 'draft', test.user_of(pg_temp.id('pay1'))) returning id into v_s;
  insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, amount, source_ref)
  values (v_s, 'unpaid_salary', 'Unpaid payroll (196)', v_net, 'payroll_item:' || (pg_temp.payment('emp2')).item_id) returning id into v_line;
  insert into t_ids values ('s2', v_s);
  perform pg_temp.su('pay1');
  perform public.hr_save_settlement_line(v_s, v_line, 'unpaid_salary', 'Unpaid payroll (196), lowered', v_low, null, null, 'Lowered by preparer');
  perform public.hr_submit_settlement(v_s);
  perform pg_temp.su('pay2');
  perform public.hr_approve_settlement(v_s, true, 'OK');
  perform public.hr_mark_settlement_paid(v_s, 'FNF-196-0002', current_date);
  perform test.as_owner();
  perform test.eq((select amount from public.hr_payroll_settlement_lines where id = v_line), v_low, 'settlement line was lowered (source link kept)');
  perform test.ok((select status = 'partially_paid' and amount_paid = v_low and amount = v_net and method = 'other'
                          and reference like 'Final settlement FNF-196-0002%' and payment_date = current_date
                   from public.hr_payroll_payments where id = (pg_temp.payment('emp2')).id),
    'lowered settlement line: payroll payment records only the settled amount (partially paid)');
  perform test.ok(exists (select 1 from public.hr_payroll_payment_events where payment_id = (pg_temp.payment('emp2')).id
                          and to_status = 'partially_paid' and amount_paid = v_low),
    'payment history records the settled (lowered) amount');
  perform test.ok(not exists (select 1 from public.hr_payroll_payment_events where payment_id = (pg_temp.payment('emp2')).id and to_status = 'paid'),
    'no "paid in full" event for the lowered settlement');
  perform test.eq((select status from public.hr_reimbursements where id = pg_temp.id('rb2')), 'approved',
    'claim on a partly settled payslip is not marked paid');
  perform test.ok((select status = 'finalized' and payment_status = 'partially_paid' from public.hr_payroll_runs where id = pg_temp.id('run')),
    'run stays finalized / partially paid');
  v_pay := (pg_temp.payment('emp2')).id;
  perform pg_temp.su('pay2');
  perform test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L, %L, %L, %L)', v_pay, 'paid', 'bank_transfer', 'UTR-196-DBL', current_date),
    'payroll still refuses a separate payment for a payslip settled in the final settlement', 'final settlement');

  -- (b) emp3: full line -> paid in full, attached claim paid.
  perform test.as_owner();
  v_net := (pg_temp.payment('emp3')).amount;
  insert into public.hr_exits (employee_id, initiated_by, exit_type, status) values (pg_temp.id('emp3'), 'hr', 'resignation', 'final_settlement') returning id into v_x;
  insert into public.hr_payroll_settlements (exit_id, employee_id, status) values (v_x, pg_temp.id('emp3'), 'approved') returning id into v_s;
  insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, amount, source_ref)
  values (v_s, 'unpaid_salary', 'Unpaid payroll (196)', v_net, 'payroll_item:' || (pg_temp.payment('emp3')).item_id);
  update public.hr_payroll_settlements set status = 'paid', paid_on = current_date, paid_by = test.user_of(pg_temp.id('pay2')), payment_reference = 'FNF-196-0003' where id = v_s;
  perform test.ok((select status = 'paid' and amount_paid = amount and amount = v_net from public.hr_payroll_payments where id = (pg_temp.payment('emp3')).id),
    'full settlement line: payroll payment recorded as paid in full');
  perform test.eq((select status from public.hr_reimbursements where id = pg_temp.id('rb3')), 'paid',
    'claim on a fully settled payslip is marked paid');
end $$;

-- 209 — Payroll duty separation (least privilege):
--   A. Catalog and role defaults: four new keys; payroll_admin / super_admin hold them,
--      hr_admin and custom roles do not.
--   B. A "Finance & Payroll Checker" (custom role: hr_requests.finance, hr_requests.payroll,
--      payroll.view, payroll.approve) can approve a run but cannot finalize it, record,
--      mark paid or reconcile payments, or pay final settlements.
--   C. Single-duty roles: payroll.finalize finalizes (preparer separation kept);
--      payroll.payments_record records but cannot reconcile; payroll.payments_reconcile
--      reconciles but cannot record; recorder <> reconciler kept.
--   D. Salary advances: the checker cannot record, verify or record repayments,
--      gets no "record disbursement" inbox action and no disbursement notifications;
--      Payroll Admin still can (recorder <> verifier kept).
-- Synthetic data only; the runner rolls the transaction back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_txt (k text primary key, v text);
grant all on t_ids, t_txt to authenticated, anon, service_role;
create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin perform test.as_owner(); perform test.as_user(test.user_of((select v from t_ids where k = p_k))); end $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.txt(p_k text) returns text language sql as $$ select v from t_txt where k = p_k $$;
create or replace function pg_temp.payment(p_emp text) returns public.hr_payroll_payments language sql security definer as $$
  select * from public.hr_payroll_payments where run_id = (select v from t_ids where k = 'run') and employee_id = (select v from t_ids where k = p_emp) $$;
create or replace function pg_temp.stage(p_req text) returns uuid language plpgsql security definer as $$
declare v_out uuid;
begin
  execute 'select id from public.hr_request_approvals where request_id = $1 and status = ''pending''' into v_out using (select t.v from t_ids t where t.k = p_req);
  return v_out;
end $$;
create or replace function pg_temp.notes(p_k text, p_title text) returns bigint language plpgsql security definer as $$
declare v_out bigint;
begin
  execute 'select count(*) from public.hr_notifications where recipient_user_id = $1 and title = $2'
    into v_out using test.user_of((select t.v from t_ids t where t.k = p_k)), p_title;
  return v_out;
end $$;

do $$
declare v_k text; s uuid;
begin
  insert into public.hr_roles (key, name) values
    ('chk_dup',   'Finance & Payroll Checker (test)'),
    ('fin_dup',   'Payroll finalizer (test)'),
    ('rec_dup',   'Payment recorder (test)'),
    ('recon_dup', 'Payment reconciler (test)');
  insert into public.hr_role_permissions (role_key, permission_key) values
    ('chk_dup', 'hr_requests.finance'), ('chk_dup', 'hr_requests.payroll'), ('chk_dup', 'payroll.view'), ('chk_dup', 'payroll.approve'),
    ('fin_dup', 'payroll.view'), ('fin_dup', 'payroll.finalize'),
    ('rec_dup', 'payroll.view'), ('rec_dup', 'payroll.payments_record'),
    ('recon_dup', 'payroll.view'), ('recon_dup', 'payroll.payments_reconcile');
  insert into t_ids values ('hr',    test.make_employee('p209.hr@test.local',    'Hana',  null, array['hr_admin','employee']));
  insert into t_ids values ('pay',   test.make_employee('p209.pay@test.local',   'Pia',   null, array['payroll_admin','employee']));
  insert into t_ids values ('pay2',  test.make_employee('p209.pay2@test.local',  'Paul',  null, array['payroll_admin','employee']));
  insert into t_ids values ('chk',   test.make_employee('p209.chk@test.local',   'Cleo',  null, array['chk_dup','employee']));
  insert into t_ids values ('fin',   test.make_employee('p209.fin@test.local',   'Finn',  null, array['fin_dup','employee']));
  insert into t_ids values ('rec',   test.make_employee('p209.rec@test.local',   'Remy',  null, array['rec_dup','employee']));
  insert into t_ids values ('recon', test.make_employee('p209.recon@test.local', 'Rona',  null, array['recon_dup','employee']));
  insert into t_ids values ('mgr',   test.make_employee('p209.mgr@test.local',   'Mira',  null, array['manager','employee']));
  insert into t_ids values ('emp1',  test.make_employee('p209.emp1@test.local',  'Esha',  (select v from t_ids where k = 'mgr')));
  insert into t_ids values ('emp2',  test.make_employee('p209.emp2@test.local',  'Emil'));
  update public.hr_employees set joining_date = date '2024-01-01', probation_end_date = null where id in (select v from t_ids where t_ids.k like 'emp%');
  foreach v_k in array array['emp1','emp2'] loop
    insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc) values ((select v from t_ids where t_ids.k = v_k), date '2025-01-01', 1200000) returning id into s;
    insert into public.hr_salary_structure_items (structure_id, component_id, amount) values (s, (select id from public.hr_salary_components where code = 'BASIC'), 100000);
  end loop;
  insert into t_txt values ('pstart', date_trunc('month', current_date - 3)::date::text);
  insert into t_txt values ('pend', (date_trunc('month', current_date - 3) + interval '1 month - 1 day')::date::text);
end $$;

-- =====================================================================
-- A. Catalog and role defaults
-- =====================================================================
select test.eq((select count(*) from public.hr_permissions where key in ('payroll.finalize','payroll.payments_record','payroll.payments_reconcile','payroll.settlement_pay')),
  4::bigint, 'four payroll duty permissions exist');
select test.eq((select count(*) from public.hr_role_permissions where role_key = 'payroll_admin'
                and permission_key in ('payroll.finalize','payroll.payments_record','payroll.payments_reconcile','payroll.settlement_pay')),
  4::bigint, 'Payroll Admin keeps every payroll duty');
select test.eq((select count(*) from public.hr_role_permissions where role_key = 'hr_admin' and permission_key like 'payroll.%'),
  0::bigint, 'HR Admin still has no payroll permission');
select test.ok((select description like '%Does not finalize%' from public.hr_permissions where key = 'payroll.approve'),
  'payroll.approve description states it does not finalize or pay');
select test.ok(not has_function_privilege('authenticated', 'hr_private.notify_permission_holders_all(text[], text, text, text, text, text, text, uuid)', 'execute'),
  'notification helper is not callable by API users');

-- =====================================================================
-- B / C. Payroll run: approve, finalize, record, reconcile
-- =====================================================================
select pg_temp.su('pay');
insert into t_ids select 'run', (public.hr_create_payroll_run(pg_temp.txt('pstart')::date, pg_temp.txt('pend')::date) ->> 'id')::uuid;
select public.hr_calculate_payroll_run(pg_temp.id('run'));
select public.hr_review_payroll_run(pg_temp.id('run'));

select pg_temp.su('chk');
select test.throws(format('select public.hr_finalize_payroll_run(%L)', pg_temp.id('run')), 'checker cannot finalize a reviewed run', 'not allowed to finalize');
select public.hr_approve_payroll_run(pg_temp.id('run'));
select test.ok((select status = 'approved' from public.hr_payroll_runs where id = pg_temp.id('run')), 'checker approves the run (payroll.approve unchanged)');
select test.throws(format('select public.hr_finalize_payroll_run(%L)', pg_temp.id('run')), 'checker cannot finalize an approved run', 'not allowed to finalize');
select test.throws(format('select public.hr_mark_payroll_paid(%L, %L)', pg_temp.id('run'), 'UTR-209-X'), 'checker cannot mark a run paid', 'not allowed to mark payroll as paid');

select pg_temp.su('rec');
select test.throws(format('select public.hr_finalize_payroll_run(%L)', pg_temp.id('run')), 'payment recorder cannot finalize', 'not allowed to finalize');
select test.throws(format('select public.hr_approve_payroll_run(%L)', pg_temp.id('run')), 'payment recorder cannot approve', 'not allowed');

select pg_temp.su('pay');
select test.throws(format('select public.hr_finalize_payroll_run(%L)', pg_temp.id('run')), 'preparer (Payroll Admin) still cannot finalize own run', 'different person');

select pg_temp.su('fin');
select public.hr_finalize_payroll_run(pg_temp.id('run'));
select test.ok((select status = 'finalized' and finalized_by = test.user_of(pg_temp.id('fin')) from public.hr_payroll_runs where id = pg_temp.id('run')),
  'finalize-only role finalizes an approved run');
select test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L, %L, %L, %L)', (pg_temp.payment('emp1')).id, 'paid', 'bank_transfer', 'UTR-209-F', current_date),
  'finalizer cannot record payments', 'not allowed to record payroll payments');

select pg_temp.su('chk');
select test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L, %L, %L, %L)', (pg_temp.payment('emp1')).id, 'paid', 'bank_transfer', 'UTR-209-C', current_date),
  'checker cannot create payment records', 'not allowed to record payroll payments');
select test.throws(format('select public.hr_mark_payroll_paid(%L, %L)', pg_temp.id('run'), 'UTR-209-C'), 'checker cannot mark a finalized run paid', 'not allowed to mark payroll as paid');

select pg_temp.su('recon');
select test.throws(format('select public.hr_record_payroll_payments(array[%L]::uuid[], %L, %L, %L, %L)', (pg_temp.payment('emp1')).id, 'paid', 'bank_transfer', 'UTR-209-R', current_date),
  'reconciler cannot record payments', 'not allowed to record payroll payments');

select pg_temp.su('rec');
select public.hr_record_payroll_payments(array[(pg_temp.payment('emp1')).id], 'paid', 'bank_transfer', 'UTR-209-0001', current_date);
select test.ok((select status = 'paid' and recorded_by = test.user_of(pg_temp.id('rec')) from pg_temp.payment('emp1')), 'payment recorder records payments');
select test.throws(format('select public.hr_reconcile_payroll_payments(array[%L]::uuid[], %L)', (pg_temp.payment('emp1')).id, 'STMT-209'),
  'recorder role cannot reconcile', 'not allowed to reconcile');

select pg_temp.su('chk');
select test.throws(format('select public.hr_reconcile_payroll_payments(array[%L]::uuid[], %L)', (pg_temp.payment('emp1')).id, 'STMT-209'),
  'checker cannot reconcile payments', 'not allowed to reconcile');

select pg_temp.su('recon');
select public.hr_reconcile_payroll_payments(array[(pg_temp.payment('emp1')).id], 'STMT-209-01');
select test.ok((select status = 'reconciled' from pg_temp.payment('emp1')), 'reconcile-only role reconciles a payment someone else recorded');

-- Recorder <> reconciler is still enforced for a user holding both duties.
select pg_temp.su('pay');
select public.hr_record_payroll_payments(array[(pg_temp.payment('emp2')).id], 'paid', 'bank_transfer', 'UTR-209-0002', current_date);
select test.throws(format('select public.hr_reconcile_payroll_payments(array[%L]::uuid[], %L)', (pg_temp.payment('emp2')).id, 'STMT-209-02'),
  'recorder <> reconciler still enforced', 'different person');
select pg_temp.su('pay2');
select public.hr_reconcile_payroll_payments(array[(pg_temp.payment('emp2')).id], 'STMT-209-02');
select test.ok((select status = 'reconciled' from pg_temp.payment('emp2')), 'Payroll Admin (system role) still reconciles');

-- Settlement payment actions (permission is checked before anything else).
select pg_temp.su('chk');
select test.throws(format('select public.hr_mark_settlement_paid(%L, %L)', gen_random_uuid(), 'FNF-209'), 'checker cannot record a settlement payment', 'not allowed to record settlement payments');
select test.throws(format('select public.hr_record_settlement_coverage(%L, current_date, %L)', pg_temp.id('emp1'), 'FNF-209'), 'checker cannot record settlement coverage', 'not allowed to record final settlements');
select test.throws(format('select public.hr_void_settlement_coverage(%L, %L)', gen_random_uuid(), 'mistake'), 'checker cannot void settlement coverage', 'not allowed to record final settlements');
select pg_temp.su('pay');
select test.throws(format('select public.hr_mark_settlement_paid(%L, %L)', gen_random_uuid(), 'FNF-209'), 'Payroll Admin passes the settlement permission gate', 'not found');

-- =====================================================================
-- D. Salary advances
-- =====================================================================
select pg_temp.su('hr');
select public.hr_save_request_policy('salary_advances', '{"enabled":true,"max_percent_of_monthly_ctc":50,"min_service_months":6,"max_repayment_months":6}'::jsonb);
select pg_temp.su('emp1');
do $$ begin insert into t_ids values ('adv', public.hr_create_workflow_request('loan_advance', '{"amount":"30000","repayment_months":"3","reason":"Medical bills"}'::jsonb)); end $$;
select pg_temp.su('mgr');
select public.hr_decide_request_stage(pg_temp.stage('adv'), 'approve', 'Supported');
select pg_temp.su('pay');
select public.hr_decide_request_stage(pg_temp.stage('adv'), 'approve', 'Within policy');
select pg_temp.su('emp1');
select public.hr_accept_advance_agreement(pg_temp.id('adv'), false);
select test.eq(pg_temp.notes('chk', 'Salary advance ready for disbursement'), 0::bigint, 'checker is not notified to disburse');
select test.ok(pg_temp.notes('pay', 'Salary advance ready for disbursement') >= 1, 'Payroll Admin is notified to disburse');

select pg_temp.su('chk');
select test.throws(format('select public.hr_record_advance_disbursement(%L, 30000, %L, current_date)', pg_temp.id('adv'), 'NEFT-209-C'),
  'checker cannot record an advance disbursement', 'allowed to record payments');
select test.throws(format('select public.hr_register_request_attachment(%L, %L, %L, %L, 1000)', pg_temp.id('adv'), 'payment_evidence', 'proof.pdf', 'application/pdf'),
  'checker cannot upload payment evidence', 'cannot attach');
select test.ok((public.hr_request_detail(pg_temp.id('adv')) ->> 'pending_action') is distinct from 'record_disbursement',
  'checker request detail offers no record-disbursement action');

select pg_temp.su('pay');
select public.hr_record_advance_disbursement(pg_temp.id('adv'), 30000, 'NEFT-209-0001', current_date);
select test.eq(pg_temp.notes('chk', 'Verify salary advance disbursement'), 0::bigint, 'checker is not notified to verify');
select test.ok(pg_temp.notes('pay2', 'Verify salary advance disbursement') >= 1, 'second Payroll Admin is notified to verify');

select pg_temp.su('chk');
select test.ok(not coalesce((public.hr_request_detail(pg_temp.id('adv')) -> 'advance' ->> 'can_verify')::boolean, false), 'checker detail: cannot verify');
select test.throws(format('select public.hr_verify_advance_disbursement(%L)', pg_temp.id('adv')), 'checker cannot verify a disbursement', 'allowed to reconcile');

select pg_temp.su('pay');
select test.throws(format('select public.hr_verify_advance_disbursement(%L)', pg_temp.id('adv')), 'recorder <> verifier still enforced', 'different Finance user');
select pg_temp.su('pay2');
select test.ok(coalesce((public.hr_request_detail(pg_temp.id('adv')) -> 'advance' ->> 'can_verify')::boolean, false), 'second Payroll Admin detail: can verify');
select public.hr_verify_advance_disbursement(pg_temp.id('adv'));

select pg_temp.su('chk');
select test.ok(not coalesce((public.hr_request_detail(pg_temp.id('adv')) -> 'advance' ->> 'can_record_repayment')::boolean, false), 'checker detail: cannot record repayment');
select test.throws(format('select public.hr_record_advance_repayment(%L, 10000, %L, %L, current_date)', pg_temp.id('adv'), 'direct_payment', 'RP-209-C'),
  'checker cannot record a repayment', 'allowed to record payments');
select pg_temp.su('pay2');
select public.hr_record_advance_repayment(pg_temp.id('adv'), 10000, 'direct_payment', 'RP-209-1', current_date);
select test.as_owner();
select test.eq((select count(*) from public.hr_salary_advance_repayments r join public.hr_salary_advances v on v.id = r.advance_id where v.request_id = pg_temp.id('adv')),
  1::bigint, 'only the authorised repayment was recorded');

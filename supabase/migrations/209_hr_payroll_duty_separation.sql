-- =====================================================================
-- 209_hr_payroll_duty_separation.sql — least-privilege payroll duties
-- =====================================================================
-- Until now payroll.approve covered review/approval AND every step after
-- it: finalizing a run, recording and reconciling payments, and paying
-- final settlements. This migration splits those duties:
--
--   payroll.approve            review / approve / return runs, salary
--                              structures, bank accounts, components,
--                              statutory rules, adjustments, corrections
--                              and settlements (UNCHANGED gates)
--   payroll.finalize           hr_finalize_payroll_run
--   payroll.payments_record    hr_mark_payroll_paid, hr_record_payroll_payments,
--                              salary-advance disbursement / repayment recording
--   payroll.payments_reconcile hr_reconcile_payroll_payments,
--                              salary-advance disbursement verification
--   payroll.settlement_pay     hr_mark_settlement_paid,
--                              hr_record_settlement_coverage, hr_void_settlement_coverage
--
-- Salary-advance payment steps were gated by hr_requests.finance alone; they
-- now need hr_requests.finance AND the matching payments key (a pure
-- narrowing: nobody gains access).
--
-- Maker-checker rules are unchanged: preparer <> approver/finalizer
-- (payroll_check_separation), own-pay checks, recorder <> reconciler,
-- recorder <> disbursement verifier, settlement preparer <> approver.
--
-- Role defaults: payroll_admin and super_admin get all four new keys, so
-- system roles keep exactly their current capabilities. Custom roles get
-- nothing: holders of payroll.approve in a custom role (e.g. the demo
-- "HR Approver" and "Finance & Payroll Checker") can still approve but can
-- no longer finalize, record or reconcile payments or pay settlements.
--
-- Data: no table rows other than the permission catalog and role grants are
-- written. No payroll run, item, payment, settlement, approval or audit
-- history is touched. Only CREATE OR REPLACE of existing functions (bodies
-- copied verbatim from the 105/130/170/180/197 definitions; only the
-- permission checks and notification targets change) plus one new helper.
--
-- Depends on: 100, 105, 130, 170, 180, 197. Idempotent (safe to re-run).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permission catalog
-- ---------------------------------------------------------------------
insert into public.hr_permissions (key, module, action, description) values
  ('payroll.finalize',           'payroll', 'finalize',           'Finalize approved payroll runs (locks the run and publishes payslips)'),
  ('payroll.payments_record',    'payroll', 'payments_record',    'Record payroll payments and mark runs paid; record salary-advance disbursements and repayments (with Finance / Payroll request access)'),
  ('payroll.payments_reconcile', 'payroll', 'payments_reconcile', 'Reconcile recorded payroll payments and verify salary-advance disbursements (never your own recording)'),
  ('payroll.settlement_pay',     'payroll', 'settlement_pay',     'Record final-settlement payments and settlement pay-through coverage')
on conflict (key) do update set module = excluded.module, action = excluded.action, description = excluded.description;

update public.hr_permissions
   set description = 'Review and approve payroll runs, salary structures, bank accounts, components, statutory rules, adjustments, corrections and settlements. Does not finalize or record payments.'
 where key = 'payroll.approve';
update public.hr_permissions
   set description = 'Finance-stage approval of reimbursements and salary advances. Recording / verifying advance payments also needs payroll.payments_record / payroll.payments_reconcile.'
 where key = 'hr_requests.finance';

-- ---------------------------------------------------------------------
-- 2. System roles keep their current capabilities
-- ---------------------------------------------------------------------
insert into public.hr_role_permissions (role_key, permission_key)
select r.role_key, p.key
from (values ('payroll_admin'), ('super_admin')) r(role_key)
cross join (values ('payroll.finalize'), ('payroll.payments_record'), ('payroll.payments_reconcile'), ('payroll.settlement_pay')) p(key)
where exists (select 1 from public.hr_roles x where x.key = r.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Notify users holding ALL of the given permissions (super_admin always).
-- ---------------------------------------------------------------------
create or replace function hr_private.notify_permission_holders_all(p_permissions text[], p_type text, p_title text, p_body text,
                                                                    p_link text, p_entity_type text, p_entity_id text,
                                                                    p_exclude_employee uuid default null)
returns void language sql security definer set search_path = '' as $$
  select hr_private.notify_user(u.user_id, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id)
  from (select distinct ur.user_id from public.hr_user_roles ur) u
  where (exists (select 1 from public.hr_user_roles s where s.user_id = u.user_id and s.role_key = 'super_admin')
         or not exists (select 1 from unnest(p_permissions) k(key)
                        where not exists (select 1 from public.hr_user_roles ur2
                                          join public.hr_role_permissions rp on rp.role_key = ur2.role_key
                                          where ur2.user_id = u.user_id and rp.permission_key = k.key)))
    and not exists (select 1 from public.hr_employees e where e.user_id = u.user_id
                    and (not e.portal_access or e.status in ('exited','archived','suspended') or e.id = p_exclude_employee))
$$;
revoke execute on function hr_private.notify_permission_holders_all(text[], text, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function hr_private.notify_permission_holders_all(text[], text, text, text, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. Functions (CREATE OR REPLACE keeps existing grants)
-- ---------------------------------------------------------------------
-- Finalizing (locks the run, publishes payslips, opens payment records) needs payroll.finalize. Separation from the preparer and the own-pay check are unchanged.
CREATE OR REPLACE FUNCTION public.hr_finalize_payroll_run(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare run public.hr_payroll_runs; r record; v_count int := 0; v_company jsonb := coalesce(hr_private.setting('company'), '{}'::jsonb);
begin
  if not hr_private.has_permission('payroll.finalize') then
    perform hr_private.fail('You are not allowed to finalize payroll.', 'forbidden');
  end if;
  select * into run from public.hr_payroll_runs where id = p_id for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status <> 'approved' then perform hr_private.fail('Only approved runs can be finalized (status: ' || run.status || ').', 'invalid_state'); end if;
  perform hr_private.payroll_check_separation(run);
  perform hr_private.payroll_check_own_compensation(run.id);
  update public.hr_payroll_runs set status = 'finalized', finalized_by = auth.uid(), finalized_at = now(), payment_status = 'pending'
   where id = p_id returning * into run;
  for r in
    insert into public.hr_payslips (run_id, employee_id, period_start, period_end, currency, working_days, payable_days, lop_days,
                                    gross, total_deductions, reimbursements, net, breakdown, published_at)
    select i.run_id, i.employee_id, run.period_start, run.period_end, i.currency, i.working_days, i.payable_days, i.lop_days,
           i.gross, i.total_deductions, i.reimbursements, i.net,
           (i.breakdown - 'validation') || jsonb_build_object(
             'employee', jsonb_build_object('employee_code', e.employee_code,
                                            'name', coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
                                            'department', (select d.name from public.hr_departments d where d.id = e.department_id),
                                            'designation', (select g.name from public.hr_designations g where g.id = e.designation_id),
                                            'joining_date', e.joining_date),
             'employer', coalesce((select jsonb_build_object('name', le.name, 'legal_name', le.legal_name, 'registration_number', le.registration_number,
                                                             'tax_number', le.tax_number, 'address', le.address)
                                   from public.hr_legal_entities le where le.id = e.legal_entity_id),
                                  jsonb_build_object('name', v_company ->> 'name', 'legal_name', v_company ->> 'legal_name', 'address', v_company ->> 'address')),
             'pay_frequency', 'monthly',
             'employer_contributions_total', i.employer_contributions,
             'bank_account_last4', (select right(b.account_number, 4) from public.hr_employee_bank_accounts b
                                    where b.employee_id = e.id and b.is_primary and b.active limit 1)),
           now()
    from public.hr_payroll_items i join public.hr_employees e on e.id = i.employee_id
    where i.run_id = p_id
    returning id, employee_id
  loop
    v_count := v_count + 1;
    perform hr_private.notify_employee(r.employee_id, 'payroll.payslip_published', 'Payslip available',
      'Your payslip for ' || to_char(run.period_start, 'DD Mon YYYY') || ' - ' || to_char(run.period_end, 'DD Mon YYYY') || ' is available.',
      '/employee/payslips', 'hr_payslips', r.id::text);
  end loop;
  insert into public.hr_payroll_payments (run_id, item_id, employee_id, currency, amount)
  select i.run_id, i.id, i.employee_id, i.currency, i.net from public.hr_payroll_items i where i.run_id = p_id and i.net > 0;
  perform hr_private.payroll_refresh_payment_status(p_id);
  select * into run from public.hr_payroll_runs where id = p_id;
  return to_jsonb(run) || jsonb_build_object('payslips', v_count);
end $function$;

-- Recording a whole run as paid is payment recording: payroll.payments_record.
CREATE OR REPLACE FUNCTION public.hr_mark_payroll_paid(p_id uuid, p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare run public.hr_payroll_runs;
begin
  if not hr_private.has_permission('payroll.payments_record') then
    perform hr_private.fail('You are not allowed to mark payroll as paid.', 'forbidden');
  end if;
  select * into run from public.hr_payroll_runs where id = p_id for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status <> 'finalized' then perform hr_private.fail('Only finalized runs can be marked as paid.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reference, ''))) < 3 then
    perform hr_private.fail('Enter the bank / payment reference for this payout.', 'reference_required');
  end if;
  if exists (select 1 from public.hr_payroll_payments where run_id = p_id and status in ('failed','partially_paid')) then
    perform hr_private.fail('Some payments failed or were partially paid. Record them individually on the Payments tab so the run is not marked paid incorrectly.', 'payments_need_attention');
  end if;
  if exists (select 1 from public.hr_payroll_payments where run_id = p_id and status in ('pending','processing')
             and hr_private.payroll_item_in_settlement(item_id) is not null) then
    perform hr_private.fail('At least one payslip in this run is being paid through a final settlement (Exit). Record the other payments individually; settlement payments are recorded when the settlement is paid.', 'in_final_settlement');
  end if;
  with upd as (
    update public.hr_payroll_payments set status = 'paid', amount_paid = amount, method = coalesce(method, 'bank_transfer'),
           payment_date = hr_private.business_today(), reference = btrim(p_reference), recorded_by = auth.uid(), recorded_at = now(), updated_at = now()
     where run_id = p_id and status in ('pending','processing')
    returning id, amount
  )
  insert into public.hr_payroll_payment_events (payment_id, from_status, to_status, amount_paid, method, reference, payment_date, note)
  select upd.id, 'pending', 'paid', upd.amount, 'bank_transfer', btrim(p_reference), hr_private.business_today(), 'Recorded as one batch' from upd;
  update public.hr_reimbursements set status = 'paid' where payroll_run_id = p_id and status = 'approved';
  if not exists (select 1 from public.hr_payroll_payments where run_id = p_id) then
    update public.hr_payroll_runs set status = 'paid', payment_status = 'paid', paid_by = auth.uid(), paid_at = now(), payment_reference = btrim(p_reference)
     where id = p_id;
  else
    perform hr_private.payroll_refresh_payment_status(p_id);
  end if;
  select * into run from public.hr_payroll_runs where id = p_id;
  return to_jsonb(run);
end $function$;

-- Recording individual payment outcomes: payroll.payments_record.
CREATE OR REPLACE FUNCTION public.hr_record_payroll_payments(p_payment_ids uuid[], p_status text, p_method text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_payment_date date DEFAULT NULL::date, p_amount_paid numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.hr_payroll_payments; v_runs uuid[] := '{}'; v_n int := 0; v_paid numeric; v_run uuid; v_found int;
begin
  if not hr_private.has_permission('payroll.payments_record') then perform hr_private.fail('You are not allowed to record payroll payments.', 'forbidden'); end if;
  if p_status is null or p_status not in ('pending','processing','paid','partially_paid','failed') then
    perform hr_private.fail('Choose a valid payment status (reconciliation is a separate step).', 'invalid_status');
  end if;
  if coalesce(cardinality(p_payment_ids), 0) = 0 then perform hr_private.fail('Choose at least one payment.', 'nothing_selected'); end if;
  select count(*) into v_found from public.hr_payroll_payments where id = any(p_payment_ids);
  if v_found <> cardinality(p_payment_ids) then perform hr_private.fail('One or more payments were not found.', 'not_found'); end if;
  if p_status in ('paid','partially_paid') then
    if length(btrim(coalesce(p_reference, ''))) < 3 then
      perform hr_private.fail('Enter the bank / payment reference as evidence of the payment.', 'reference_required');
    end if;
    if p_method is null or p_method not in ('bank_transfer','cheque','cash','other') then
      perform hr_private.fail('Choose the payment method.', 'method_required');
    end if;
    if p_payment_date is null or p_payment_date > hr_private.business_today() then
      perform hr_private.fail('Enter the date the payment was made (it cannot be in the future).', 'invalid_date');
    end if;
  end if;
  if p_status = 'partially_paid' and cardinality(p_payment_ids) > 1 then
    perform hr_private.fail('Record partial payments one employee at a time.', 'one_at_a_time');
  end if;
  if p_status = 'failed' and length(btrim(coalesce(p_note, ''))) < 3 then
    perform hr_private.fail('Give the failure reason (for example the bank''s rejection message).', 'note_required');
  end if;
  for p in select * from public.hr_payroll_payments where id = any(p_payment_ids) order by id for update loop
    perform hr_private.payroll_assert_not_self(p.employee_id, 'record the payment status of a salary payment');
    if hr_private.payroll_item_in_settlement(p.item_id) is not null then
      perform hr_private.fail('This payslip is being paid through the employee''s final settlement (Exit). Its payment is recorded there, not here.', 'in_final_settlement');
    end if;
    if not ((p.status = 'pending' and p_status in ('processing','paid','partially_paid','failed'))
         or (p.status = 'processing' and p_status in ('pending','paid','partially_paid','failed'))
         or (p.status = 'partially_paid' and p_status in ('paid','partially_paid','failed'))
         or (p.status = 'failed' and p_status in ('pending','processing','paid','partially_paid'))) then
      perform hr_private.fail('A payment cannot move from ' || replace(p.status, '_', ' ') || ' to ' || replace(p_status, '_', ' ') || '.', 'invalid_transition');
    end if;
    v_paid := case p_status when 'paid' then p.amount
                            when 'partially_paid' then round(coalesce(p_amount_paid, -1), 2)
                            else p.amount_paid end;
    if p_status = 'partially_paid' and (v_paid <= p.amount_paid or v_paid >= p.amount) then
      perform hr_private.fail('A partial payment must be more than the amount already paid and less than the net pay; record the full amount as "paid".', 'invalid_amount');
    end if;
    update public.hr_payroll_payments set
           status = p_status, amount_paid = v_paid,
           method = case when p_status in ('paid','partially_paid') then p_method else method end,
           payment_date = case when p_status in ('paid','partially_paid') then p_payment_date else payment_date end,
           reference = case when p_status in ('paid','partially_paid') then btrim(p_reference) else reference end,
           failure_reason = case when p_status = 'failed' then btrim(p_note) when p_status in ('paid','partially_paid') then null else failure_reason end,
           notes = coalesce(nullif(btrim(p_note), ''), notes),
           recorded_by = auth.uid(), recorded_at = now(), updated_at = now()
     where id = p.id;
    insert into public.hr_payroll_payment_events (payment_id, from_status, to_status, amount_paid, method, reference, payment_date, note)
    values (p.id, p.status, p_status, v_paid, p_method, nullif(btrim(p_reference), ''), p_payment_date, nullif(btrim(p_note), ''));
    if p_status = 'paid' then
      update public.hr_reimbursements set status = 'paid' where payroll_run_id = p.run_id and employee_id = p.employee_id and status = 'approved';
    end if;
    if not (p.run_id = any(v_runs)) then v_runs := v_runs || p.run_id; end if;
    v_n := v_n + 1;
  end loop;
  foreach v_run in array v_runs loop perform hr_private.payroll_refresh_payment_status(v_run); end loop;
  return jsonb_build_object('updated', v_n,
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'payment_status', r.payment_status)), '[]'::jsonb)
             from public.hr_payroll_runs r where r.id = any(v_runs)));
end $function$;

-- Reconciliation: payroll.payments_reconcile. Recorder <> reconciler and the own-pay check are unchanged.
CREATE OR REPLACE FUNCTION public.hr_reconcile_payroll_payments(p_payment_ids uuid[], p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.hr_payroll_payments; v_runs uuid[] := '{}'; v_n int := 0; v_run uuid;
begin
  if not hr_private.has_permission('payroll.payments_reconcile') then perform hr_private.fail('You are not allowed to reconcile payroll payments.', 'forbidden'); end if;
  if coalesce(cardinality(p_payment_ids), 0) = 0 then perform hr_private.fail('Choose at least one payment.', 'nothing_selected'); end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    perform hr_private.fail('Enter the reconciliation evidence (for example the bank statement reference).', 'note_required');
  end if;
  for p in select * from public.hr_payroll_payments where id = any(p_payment_ids) order by id for update loop
    perform hr_private.payroll_assert_not_self(p.employee_id, 'reconcile a salary payment');
    if p.status <> 'paid' then perform hr_private.fail('Only payments recorded as paid can be reconciled.', 'invalid_state'); end if;
    if p.recorded_by = auth.uid() then
      perform hr_private.fail('Reconciliation must be done by a different person from the one who recorded the payment.', 'separation_of_duties');
    end if;
    update public.hr_payroll_payments set status = 'reconciled', reconciled_by = auth.uid(), reconciled_at = now(),
           reconciliation_note = btrim(p_note), updated_at = now()
     where id = p.id;
    insert into public.hr_payroll_payment_events (payment_id, from_status, to_status, amount_paid, note)
    values (p.id, p.status, 'reconciled', p.amount_paid, btrim(p_note));
    if not (p.run_id = any(v_runs)) then v_runs := v_runs || p.run_id; end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> cardinality(p_payment_ids) then perform hr_private.fail('One or more payments were not found.', 'not_found'); end if;
  foreach v_run in array v_runs loop perform hr_private.payroll_refresh_payment_status(v_run); end loop;
  return jsonb_build_object('reconciled', v_n);
end $function$;

-- Recording a final-settlement payment: payroll.settlement_pay (approval of the settlement stays payroll.approve).
CREATE OR REPLACE FUNCTION public.hr_mark_settlement_paid(p_settlement uuid, p_reference text, p_paid_on date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_s public.hr_payroll_settlements;
begin
  if not hr_private.has_permission('payroll.settlement_pay') then
    perform hr_private.fail('You are not allowed to record settlement payments.', 'forbidden');
  end if;
  select * into v_s from public.hr_payroll_settlements where id = p_settlement for update;
  if v_s.id is null then perform hr_private.fail('Settlement not found.', 'not_found'); end if;
  if v_s.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot record your own settlement payment.', 'self_action'); end if;
  if v_s.status <> 'approved' then perform hr_private.fail('Only approved settlements can be marked as paid.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reference, ''))) < 3 then perform hr_private.fail('Enter the bank / payment reference.', 'reference_required'); end if;
  if p_paid_on is not null and p_paid_on > hr_private.business_today() then perform hr_private.fail('The payment date cannot be in the future.', 'invalid_date'); end if;
  update public.hr_payroll_settlements set status = 'paid', paid_by = auth.uid(), paid_at = now(),
         paid_on = coalesce(p_paid_on, hr_private.business_today()), payment_reference = btrim(p_reference)
   where id = v_s.id;
  update public.hr_reimbursements r set status = 'paid'
    from public.hr_payroll_settlement_lines l
   where l.settlement_id = v_s.id and l.line_type = 'reimbursement' and l.source_ref = 'reimbursement:' || r.id::text
     and r.status = 'approved' and r.employee_id = v_s.employee_id;
  perform hr_private.exit_log(v_s.exit_id, 'settlement_paid', null, null, null);
  perform hr_private.notify_employee(v_s.employee_id, 'exit_update', 'Final settlement paid',
    'Payment reference: ' || btrim(p_reference), '/employee/resignation', 'hr_payroll_settlement', v_s.id::text);
end $function$;

-- Settlement pay-through coverage is part of paying a settlement: payroll.settlement_pay.
CREATE OR REPLACE FUNCTION public.hr_record_settlement_coverage(p_employee uuid, p_covered_through date, p_reference text, p_note text DEFAULT NULL::text, p_exit uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.hr_payroll_settlement_coverage; v_paid_through date;
begin
  if not hr_private.has_permission('payroll.settlement_pay') then perform hr_private.fail('You are not allowed to record final settlements.', 'forbidden'); end if;
  perform hr_private.payroll_assert_not_self(p_employee, 'record a final-settlement coverage');
  if not exists (select 1 from public.hr_employees where id = p_employee) then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if p_exit is not null and not exists (select 1 from public.hr_exits where id = p_exit and employee_id = p_employee) then
    perform hr_private.fail('That exit case belongs to a different employee.', 'invalid_exit');
  end if;
  if p_covered_through is null then perform hr_private.fail('Enter the last day paid through the final settlement.', 'invalid_date'); end if;
  if length(btrim(coalesce(p_reference, ''))) < 3 then perform hr_private.fail('Enter the settlement reference.', 'reference_required'); end if;
  if exists (select 1 from public.hr_payroll_settlement_coverage where employee_id = p_employee and status = 'active') then
    perform hr_private.fail('An active settlement coverage already exists for this employee. Void it first.', 'duplicate');
  end if;
  select max(r.period_end) into v_paid_through from public.hr_payroll_items i join public.hr_payroll_runs r on r.id = i.run_id
   where i.employee_id = p_employee and r.status in ('approved','finalized','paid');
  insert into public.hr_payroll_settlement_coverage (employee_id, exit_id, covered_through, settlement_reference, note)
  values (p_employee, p_exit, p_covered_through, btrim(p_reference), nullif(btrim(p_note), ''))
  returning * into c;
  -- Informational: the last payroll period already approved/paid for this employee.
  -- Payroll staff confirm the settlement does not also pay those days.
  return to_jsonb(c) || jsonb_build_object('payroll_paid_through', v_paid_through,
    'overlaps_paid_payroll', v_paid_through is not null and v_paid_through >= p_covered_through);
end $function$;

-- Voiding settlement coverage: payroll.settlement_pay.
CREATE OR REPLACE FUNCTION public.hr_void_settlement_coverage(p_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.hr_payroll_settlement_coverage;
begin
  if not hr_private.has_permission('payroll.settlement_pay') then perform hr_private.fail('You are not allowed to record final settlements.', 'forbidden'); end if;
  select * into c from public.hr_payroll_settlement_coverage where id = p_id for update;
  if c.id is null then perform hr_private.fail('Settlement coverage not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(c.employee_id, 'void a final-settlement coverage');
  if c.status <> 'active' then perform hr_private.fail('Already void.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason.', 'reason_required'); end if;
  update public.hr_payroll_settlement_coverage set status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason)
   where id = p_id returning * into c;
  return to_jsonb(c);
end $function$;

-- Notify only users who can actually record the disbursement (Finance AND payments_record).
CREATE OR REPLACE FUNCTION public.hr_accept_advance_agreement(p_request uuid, p_authorize_payroll_deduction boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.hr_requests; v public.hr_salary_advances; v_allow boolean := coalesce((hr_private.setting('salary_advances') ->> 'allow_payroll_deduction')::boolean, false);
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or r.employee_id is distinct from hr_private.current_employee_id() or r.workflow <> 'salary_advance' then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  select * into v from public.hr_salary_advances where request_id = r.id for update;
  if v.status <> 'approved' then perform hr_private.fail('The agreement can be accepted only once, after approval.', 'invalid_state'); end if;
  if coalesce(p_authorize_payroll_deduction, false) and not v_allow then
    perform hr_private.fail('Payroll deduction of advances is not enabled; repayments will be recorded by Finance.', 'deduction_not_enabled');
  end if;
  update public.hr_salary_advances set status = 'agreed', agreement_accepted_at = now(), agreement_accepted_by = auth.uid(),
         payroll_deduction_authorized = coalesce(p_authorize_payroll_deduction, false),
         first_repayment_month = (date_trunc('month', hr_private.business_today()) + interval '1 month')::date
   where id = v.id returning * into v;
  perform hr_internal.request_event(r.id, 'agreement_accepted',
    case when v.payroll_deduction_authorized then 'Repayment agreement accepted; payroll deduction authorised.' else 'Repayment agreement accepted.' end);
  perform hr_private.notify_permission_holders_all(array['hr_requests.finance','payroll.payments_record'], 'hr_request.approval', 'Salary advance ready for disbursement',
    'An approved salary advance is waiting for disbursement.', '/hr/requests/' || r.id, 'hr_request', r.id::text, r.employee_id);
  return to_jsonb(v) - 'max_permitted';
end $function$;

-- Recording an advance disbursement is a payment record: Finance AND payroll.payments_record (a pure narrowing).
CREATE OR REPLACE FUNCTION public.hr_record_advance_disbursement(p_request uuid, p_amount numeric, p_reference text, p_paid_on date, p_attachment uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.hr_requests; v public.hr_salary_advances; v_ref text := btrim(coalesce(p_reference, ''));
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or r.workflow <> 'salary_advance' or not hr_private.request_row_visible(r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot record payments for your own advance.', 'self_approval'); end if;
  if not (hr_private.has_permission('hr_requests.finance') and hr_private.has_permission('payroll.payments_record')) then
    perform hr_private.fail('Only Finance users allowed to record payments can record disbursements.', 'forbidden');
  end if;
  select * into v from public.hr_salary_advances where request_id = r.id for update;
  if v.status in ('disbursement_recorded','repaying','repaid') then perform hr_private.fail('The disbursement has already been recorded.', 'already_disbursed'); end if;
  if v.status <> 'agreed' then perform hr_private.fail('The employee must accept the repayment agreement first.', 'invalid_state'); end if;
  if p_amount is null or round(p_amount, 2) <> v.amount then
    perform hr_private.fail('The disbursed amount must equal the approved amount.', 'invalid_amount');
  end if;
  if length(v_ref) < 3 or length(v_ref) > 120 then perform hr_private.fail('Enter the bank / payment reference.', 'reference_required'); end if;
  if exists (select 1 from public.hr_salary_advances x where upper(btrim(x.disbursement_reference)) = upper(v_ref)) then
    perform hr_private.fail('This payment reference is already recorded for another advance.', 'duplicate_reference');
  end if;
  if p_paid_on is null or p_paid_on > hr_private.business_today() or p_paid_on < r.decided_at::date then
    perform hr_private.fail('Enter the payment date (after approval, not in the future).', 'invalid_date');
  end if;
  if p_attachment is not null and not exists (select 1 from public.hr_request_attachments a where a.id = p_attachment and a.request_id = r.id
                                                and a.kind = 'payment_evidence' and a.removed_at is null) then
    perform hr_private.fail('Unknown payment evidence file.', 'invalid_attachment');
  end if;
  update public.hr_salary_advances set status = 'disbursement_recorded', disbursed_amount = v.amount, disbursement_reference = v_ref,
         disbursed_on = p_paid_on, disbursement_attachment_id = p_attachment, disbursement_recorded_by = auth.uid(), disbursement_recorded_at = now()
   where id = v.id returning * into v;
  perform hr_internal.request_event(r.id, 'disbursement_recorded', 'Disbursement recorded; awaiting verification by a second Finance user.');
  perform hr_private.notify_permission_holders_all(array['hr_requests.finance','payroll.payments_reconcile'], 'hr_request.approval', 'Verify salary advance disbursement',
    'A recorded disbursement needs verification by a second Finance user.', '/hr/requests/' || r.id, 'hr_request', r.id::text, r.employee_id);
  return to_jsonb(v) - 'max_permitted';
end $function$;

-- Verifying a recorded disbursement is reconciliation: Finance AND payroll.payments_reconcile. Recorder <> verifier unchanged.
CREATE OR REPLACE FUNCTION public.hr_verify_advance_disbursement(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.hr_requests; v public.hr_salary_advances;
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or r.workflow <> 'salary_advance' or not hr_private.request_row_visible(r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot verify payments for your own advance.', 'self_approval'); end if;
  if not (hr_private.has_permission('hr_requests.finance') and hr_private.has_permission('payroll.payments_reconcile')) then
    perform hr_private.fail('Only Finance users allowed to reconcile payments can verify disbursements.', 'forbidden');
  end if;
  select * into v from public.hr_salary_advances where request_id = r.id for update;
  if v.status in ('repaying','repaid') then perform hr_private.fail('The disbursement has already been verified.', 'already_verified'); end if;
  if v.status <> 'disbursement_recorded' then perform hr_private.fail('No recorded disbursement to verify.', 'invalid_state'); end if;
  if v.disbursement_recorded_by = auth.uid() then
    perform hr_private.fail('A different Finance user must verify the disbursement you recorded.', 'distinct_approver_required');
  end if;
  update public.hr_salary_advances set status = 'repaying', disbursement_verified_by = auth.uid(), disbursement_verified_at = now()
   where id = v.id returning * into v;
  update public.hr_requests set status = 'completed', completed_at = now(), last_activity_at = now() where id = r.id;
  perform hr_internal.request_event(r.id, 'disbursement_verified', 'Disbursement verified. Repayments are tracked on the advance.', null, 'approved', 'completed');
  perform hr_internal.notify_requester(r.id, 'hr_request.payment', 'Salary advance disbursed', 'Your salary advance was paid. Repayments are shown on the request.');
  return to_jsonb(v) - 'max_permitted';
end $function$;

-- Recording a repayment is a payment record: (Finance OR Payroll) AND payroll.payments_record.
CREATE OR REPLACE FUNCTION public.hr_record_advance_repayment(p_request uuid, p_amount numeric, p_method text, p_reference text, p_paid_on date, p_payroll_run uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.hr_requests; v public.hr_salary_advances; run public.hr_payroll_runs; v_ref text := btrim(coalesce(p_reference, ''));
  v_balance numeric; v_amount numeric := round(p_amount, 2);
  v_allow boolean := coalesce((hr_private.setting('salary_advances') ->> 'allow_payroll_deduction')::boolean, false);
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or r.workflow <> 'salary_advance' or not hr_private.request_row_visible(r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot record repayments for your own advance.', 'self_approval'); end if;
  if not ((hr_private.has_permission('hr_requests.finance') or hr_private.has_permission('hr_requests.payroll'))
          and hr_private.has_permission('payroll.payments_record')) then
    perform hr_private.fail('Only Finance or Payroll users allowed to record payments can record repayments.', 'forbidden');
  end if;
  select * into v from public.hr_salary_advances where request_id = r.id for update;
  if v.status <> 'repaying' then perform hr_private.fail('Repayments can be recorded only after the disbursement is verified.', 'invalid_state'); end if;
  v_balance := v.disbursed_amount - coalesce((select sum(amount) from public.hr_salary_advance_repayments where advance_id = v.id), 0);
  if v_amount is null or v_amount <= 0 or v_amount > v_balance then
    perform hr_private.fail('Enter an amount greater than zero and not more than the remaining balance (' || to_char(v_balance, 'FM999999999990.00') || ').', 'invalid_amount');
  end if;
  if p_method is null or p_method not in ('payroll_deduction','direct_payment') then perform hr_private.fail('Choose the repayment method.', 'invalid_method'); end if;
  if length(v_ref) < 3 or length(v_ref) > 120 then perform hr_private.fail('Enter the repayment reference.', 'reference_required'); end if;
  if exists (select 1 from public.hr_salary_advance_repayments x where x.advance_id = v.id and upper(btrim(x.reference)) = upper(v_ref)) then
    perform hr_private.fail('This repayment reference is already recorded.', 'duplicate_reference');
  end if;
  if p_paid_on is null or p_paid_on > hr_private.business_today() or p_paid_on < v.disbursed_on then
    perform hr_private.fail('Enter the repayment date (after the disbursement, not in the future).', 'invalid_date');
  end if;
  if p_method = 'payroll_deduction' then
    if not v_allow or not v.payroll_deduction_authorized then
      perform hr_private.fail('Payroll deduction is not authorised for this advance (policy and the employee''s agreement are both required).', 'deduction_not_authorised');
    end if;
    select * into run from public.hr_payroll_runs where id = p_payroll_run;
    if run.id is null or run.status not in ('finalized','paid') or run.period_end < v.disbursed_on then
      perform hr_private.fail('Choose the finalized payroll run in which the deduction was made.', 'invalid_payroll_run');
    end if;
    if exists (select 1 from public.hr_salary_advance_repayments x where x.advance_id = v.id and x.payroll_run_id = run.id) then
      perform hr_private.fail('A deduction for this payroll run is already recorded.', 'duplicate_reference');
    end if;
  elsif p_payroll_run is not null then
    perform hr_private.fail('A direct payment is not linked to a payroll run.', 'invalid');
  end if;
  insert into public.hr_salary_advance_repayments (advance_id, amount, method, reference, paid_on, payroll_run_id, note, recorded_employee_id)
  values (v.id, v_amount, p_method, v_ref, p_paid_on, case when p_method = 'payroll_deduction' then run.id end,
          left(nullif(btrim(p_note), ''), 1000), hr_private.current_employee_id());
  v_balance := v_balance - v_amount;
  if v_balance = 0 then
    update public.hr_salary_advances set status = 'repaid', repaid_at = now() where id = v.id;
    perform hr_internal.request_event(r.id, 'repayment_recorded', 'Final repayment recorded; the advance is fully repaid.');
    perform hr_internal.notify_requester(r.id, 'hr_request.payment', 'Salary advance fully repaid', 'Your salary advance has been fully repaid.');
  else
    perform hr_internal.request_event(r.id, 'repayment_recorded', 'Repayment recorded.');
    perform hr_internal.notify_requester(r.id, 'hr_request.payment', 'Advance repayment recorded', 'A repayment of your salary advance was recorded.');
  end if;
  return jsonb_build_object('advance_id', v.id, 'remaining_balance', v_balance, 'status', case when v_balance = 0 then 'repaid' else 'repaying' end);
end $function$;

-- Inbox next action mirrors the RPC gates above.
CREATE OR REPLACE FUNCTION hr_internal.request_pending_action(p_request uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.hr_requests; v public.hr_salary_advances; v_me uuid := hr_private.current_employee_id();
begin
  select * into r from public.hr_requests where id = p_request;
  if r.id is null or r.status <> 'approved' then return null; end if;
  if r.workflow = 'hr_letter' then
    return case when hr_internal.can_issue_letter(r.id) then 'issue_letter' end;
  end if;
  if r.workflow = 'salary_advance' then
    select * into v from public.hr_salary_advances where request_id = r.id;
    if r.employee_id = v_me then return case when v.status = 'approved' then 'accept_agreement' end; end if;
    if not hr_private.has_permission('hr_requests.finance') then return null; end if;
    if v.status = 'agreed' and hr_private.has_permission('payroll.payments_record') then return 'record_disbursement'; end if;
    if v.status = 'disbursement_recorded' and v.disbursement_recorded_by is distinct from auth.uid()
       and hr_private.has_permission('payroll.payments_reconcile') then return 'verify_disbursement'; end if;
  end if;
  return null;
end $function$;

-- Payment evidence is uploaded while recording a disbursement: same gate as hr_record_advance_disbursement.
CREATE OR REPLACE FUNCTION public.hr_register_request_attachment(p_request uuid, p_kind text, p_file_name text, p_mime_type text, p_size_bytes bigint, p_checksum text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.hr_requests; v_me uuid := hr_private.current_employee_id(); v_req boolean; v_name text; v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_id uuid := gen_random_uuid(); v_path text; v_sum text := lower(nullif(btrim(p_checksum), '')); v_ok boolean := false;
begin
  if auth.uid() is null or hr_private.caller_is_revoked() then perform hr_private.fail('Sign in first.', 'not_authenticated'); end if;
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or not hr_private.request_row_visible(r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  v_req := coalesce(r.employee_id = v_me, false);
  if p_kind in ('receipt','evidence','supporting') then
    v_ok := v_req and (r.status in ('draft','returned') or (r.workflow = 'helpdesk' and r.status in ('open','in_progress','waiting_on_employee')))
            and (p_kind <> 'receipt' or r.workflow = 'reimbursement');
    if not v_ok and r.workflow = 'helpdesk' and p_kind = 'supporting' and r.status in ('open','in_progress','waiting_on_employee') then
      v_ok := hr_private.request_can_handle(r.id);
    end if;
  elsif p_kind = 'issued_letter' then
    v_ok := hr_internal.can_issue_letter(r.id);
  elsif p_kind = 'payment_evidence' then
    v_ok := not v_req and r.workflow = 'salary_advance' and r.status = 'approved' and hr_private.has_permission('hr_requests.finance')
            and hr_private.has_permission('payroll.payments_record');
  else
    perform hr_private.fail('Unknown attachment type.', 'invalid');
  end if;
  if not v_ok then perform hr_private.fail('You cannot attach this file to the request at its current stage.', 'forbidden'); end if;
  if (select count(*) from public.hr_request_attachments where request_id = r.id and removed_at is null) >= 10 then
    perform hr_private.fail('A request can have at most 10 files.', 'too_many_files');
  end if;
  v_name := hr_private.document_validate_file(p_file_name, v_mime, p_size_bytes);
  if v_mime not in ('application/pdf','image/png','image/jpeg','image/webp') then
    perform hr_private.fail('Only PDF, PNG, JPEG and WEBP files can be attached to requests.', 'invalid_file_type');
  end if;
  if v_sum is not null and v_sum !~ '^[a-f0-9]{64}$' then v_sum := null; end if;
  v_path := r.id::text || '/' || v_id::text || '-' || v_name;
  insert into public.hr_request_attachments (id, request_id, kind, storage_path, file_name, mime_type, size_bytes, checksum, uploaded_by, uploaded_employee_id)
  values (v_id, r.id, p_kind, v_path, v_name, v_mime, p_size_bytes, v_sum, auth.uid(), v_me);
  perform hr_internal.request_event(r.id, 'attachment_added', replace(p_kind, '_', ' ') || ': ' || v_name);
  return jsonb_build_object('attachment_id', v_id, 'bucket', 'hr-request-files', 'storage_path', v_path);
end $function$;

-- UI flags mirror the RPC gates (verify -> payments_reconcile, repayment -> payments_record).
CREATE OR REPLACE FUNCTION public.hr_request_detail(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.hr_requests; c public.hr_request_categories; e public.hr_employees; v public.hr_salary_advances;
  v_me uuid := hr_private.current_employee_id(); v_req boolean; v_money boolean; v_out jsonb; z public.hr_reimbursements; run public.hr_payroll_runs;
begin
  select * into r from public.hr_requests where id = p_request;
  if r.id is null or not hr_private.request_row_visible(r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  select * into c from public.hr_request_categories where id = r.category_id;
  select * into e from public.hr_employees where id = r.employee_id;
  v_req := coalesce(r.employee_id = v_me, false);
  v_money := v_req or hr_private.has_permission('hr_requests.finance') or hr_private.has_permission('hr_requests.payroll');
  v_out := (to_jsonb(r) - 'details') || jsonb_build_object(
    'details', r.details,
    'is_requester', v_req,
    'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'workflow', c.workflow, 'sla_hours', c.sla_hours,
                                   'requires_attachment', c.requires_attachment, 'approval_stages', c.approval_stages),
    'employee', jsonb_build_object('id', e.id, 'employee_code', e.employee_code, 'first_name', e.first_name, 'last_name', e.last_name,
                                   'display_name', e.display_name,
                                   'department', (select name from public.hr_departments where id = e.department_id),
                                   'company', (select name from public.hr_legal_entities where id = e.legal_entity_id)),
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', a.id, 'round', a.round, 'stage_no', a.stage_no, 'stage_role', a.stage_role, 'status', a.status,
                 'approver', (select coalesce(nullif(x.display_name, ''), btrim(x.first_name || ' ' || x.last_name)) from public.hr_employees x where x.id = a.approver_employee_id),
                 'delegate', (select coalesce(nullif(x.display_name, ''), btrim(x.first_name || ' ' || x.last_name)) from public.hr_employees x where x.id = a.delegate_employee_id),
                 'decided_by', (select coalesce(nullif(x.display_name, ''), btrim(x.first_name || ' ' || x.last_name)) from public.hr_employees x where x.id = a.decided_by_employee_id),
                 'decided_at', a.decided_at, 'activated_at', a.activated_at, 'decision_basis', a.decision_basis, 'comment', a.comment,
                 'delegation_reason', a.delegation_reason,
                 'can_act', hr_internal.stage_can_act(a.id) is not null,
                 'can_delegate', a.status = 'pending' and a.stage_role = 'manager' and not v_req
                                 and ((v_me is not null and v_me = coalesce(a.delegate_employee_id, a.approver_employee_id)) or hr_private.has_permission('hr_requests.manage')))
               order by a.round, a.stage_no) from public.hr_request_approvals a where a.request_id = r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', ev.id, 'action', ev.action, 'round', ev.round, 'stage_role', ev.stage_role,
                 'from_status', ev.from_status, 'to_status', ev.to_status, 'note', ev.note, 'created_at', ev.created_at,
                 'actor', (select coalesce(nullif(x.display_name, ''), btrim(x.first_name || ' ' || x.last_name)) from public.hr_employees x where x.id = ev.actor_employee_id))
               order by ev.created_at, ev.id) from public.hr_request_events ev where ev.request_id = r.id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'file_name', a.file_name, 'mime_type', a.mime_type,
                 'size_bytes', a.size_bytes, 'storage_path', a.storage_path, 'created_at', a.created_at, 'mine', a.uploaded_by = auth.uid(),
                 'uploaded', exists (select 1 from storage.objects o where o.bucket_id = 'hr-request-files' and o.name = a.storage_path))
               order by a.created_at) from public.hr_request_attachments a where a.request_id = r.id and hr_private.request_attachment_visible(a.id)), '[]'::jsonb),
    'can_handle', hr_private.request_can_handle(r.id),
    'pending_action', hr_internal.request_pending_action(r.id),
    'can_edit', v_req and r.workflow <> 'helpdesk' and r.status in ('draft','returned'),
    'can_cancel', v_req and ((r.workflow = 'helpdesk' and r.status = 'open') or (r.workflow <> 'helpdesk' and r.status in ('draft','pending_approval','returned'))));
  if r.workflow = 'profile_change' then
    v_out := v_out || jsonb_build_object('profile_changes', hr_internal.profile_diff(r.id));
  end if;
  if r.workflow = 'hr_letter' and r.issued_document_id is not null then
    v_out := v_out || jsonb_build_object('issued_document', (select jsonb_build_object('id', d.id, 'title', d.title) from public.hr_documents d where d.id = r.issued_document_id));
  end if;
  if r.workflow = 'salary_advance' and v_money then
    select * into v from public.hr_salary_advances where request_id = r.id;
    if v.id is not null then
      v_out := v_out || jsonb_build_object('advance', to_jsonb(v) || jsonb_build_object(
        'repaid', coalesce((select sum(p.amount) from public.hr_salary_advance_repayments p where p.advance_id = v.id), 0),
        'remaining_balance', case when v.disbursed_amount is null then null
                                  else v.disbursed_amount - coalesce((select sum(p.amount) from public.hr_salary_advance_repayments p where p.advance_id = v.id), 0) end,
        'repayments', coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_on, p.created_at) from public.hr_salary_advance_repayments p where p.advance_id = v.id), '[]'::jsonb),
        'can_verify', v.status = 'disbursement_recorded' and not v_req and hr_private.has_permission('hr_requests.finance')
                      and hr_private.has_permission('payroll.payments_reconcile')
                      and v.disbursement_recorded_by is distinct from auth.uid(),
        'can_record_repayment', v.status = 'repaying' and not v_req
                                and (hr_private.has_permission('hr_requests.finance') or hr_private.has_permission('hr_requests.payroll'))
                                and hr_private.has_permission('payroll.payments_record')));
    end if;
  end if;
  if r.linked_entity_type = 'hr_reimbursements' then
    select * into z from public.hr_reimbursements where id = r.linked_entity_id;
    select * into run from public.hr_payroll_runs where id = z.payroll_run_id;
    v_out := v_out || jsonb_build_object('payment', jsonb_strip_nulls(jsonb_build_object(
      'claim_status', z.status, 'payroll_period_start', run.period_start, 'payroll_period_end', run.period_end,
      'payroll_status', run.status, 'paid_at', run.paid_at,
      'payment_reference', case when hr_private.has_permission('hr_requests.finance') or hr_private.has_permission('payroll.view') then run.payment_reference end)));
  end if;
  return v_out;
end $function$;

-- Dashboard 'runs awaiting your step': finalize / mark-paid counts follow payroll.finalize / payroll.payments_record.
CREATE OR REPLACE FUNCTION public.hr_dashboard(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_department uuid DEFAULT NULL::uuid, p_employment_type text DEFAULT NULL::text, p_manager uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_legal_entity uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r jsonb; k jsonb; v_appr jsonb; v_alerts jsonb; v_item jsonb; v_idx int; v_n bigint;
  v_open constant text[] := array['open','in_progress','waiting_on_employee','pending_approval','approved'];
  v_view boolean := hr_private.any_permission(array['hr_requests.view','hr_requests.manage']);
  v_desk boolean := hr_private.any_permission(array['hr_requests.manage','hr_requests.payroll','hr_requests.finance']);
  v_team boolean := hr_private.has_permission('hr_requests.approve_team');
begin
  r := hr_private.hr_dashboard_v117(p_from, p_to, p_department, p_employment_type, p_manager, p_status, p_legal_entity);
  k := r -> 'kpis';
  v_appr := coalesce(r -> 'my_approvals', '[]'::jsonb);
  v_alerts := coalesce(r -> 'alerts', '[]'::jsonb);

  -- 209: steps after approval have their own permissions.
  if jsonb_typeof(r -> 'payroll' -> 'pending_actions') = 'object' then
    r := jsonb_set(r, '{payroll,pending_actions}', (r -> 'payroll' -> 'pending_actions') || jsonb_build_object(
      'finalize', case when hr_private.has_permission('payroll.finalize')
                       then (select count(*) from public.hr_payroll_runs where status = 'approved') else 0 end,
      'mark_paid', case when hr_private.has_permission('payroll.payments_record')
                        then (select count(*) from public.hr_payroll_runs where status = 'finalized') else 0 end));
    select o::int - 1 into v_idx from jsonb_array_elements(v_appr) with ordinality t(a, o) where a ->> 'key' = 'payroll_runs' limit 1;
    if v_idx is not null then
      v_appr := jsonb_set(v_appr, array[v_idx::text, 'count'],
        to_jsonb((select coalesce(sum(value::int), 0) from jsonb_each_text(r -> 'payroll' -> 'pending_actions'))));
    end if;
  end if;

  -- KPI (gate unchanged from 112: request viewers; counted under RLS)
  if v_view then
    k := k || jsonb_build_object('pending_hr_requests', (select count(*) from public.hr_requests q where q.status = any (v_open)));
  end if;

  -- Approvals card
  select o::int - 1 into v_idx from jsonb_array_elements(v_appr) with ordinality t(a, o) where a ->> 'key' = 'hr_requests' limit 1;
  if v_desk or v_team then
    v_n := coalesce((public.hr_requests_overview('{}'::jsonb) ->> 'awaiting_me')::bigint, 0)
         - coalesce((public.hr_requests_overview('{"workflow":"attendance_correction"}'::jsonb) ->> 'awaiting_me')::bigint, 0);
    v_item := case when v_desk
      then jsonb_build_object('key', 'hr_requests', 'label', 'HR requests awaiting your action', 'path', '/hr/requests?tab=inbox&box=assigned', 'count', v_n)
      else jsonb_build_object('key', 'team_requests', 'label', 'Team requests to approve', 'path', '/hr/requests?tab=inbox&box=assigned', 'count', v_n) end;
    if v_idx is not null then v_appr := jsonb_set(v_appr, array[v_idx::text], v_item);
    else v_appr := v_appr || jsonb_build_array(v_item); end if;
  elsif v_idx is not null then
    v_appr := v_appr - v_idx;
  end if;

  -- SLA alert
  v_alerts := coalesce((select jsonb_agg(a) from jsonb_array_elements(v_alerts) a where a ->> 'type' <> 'hr_request_sla'), '[]'::jsonb);
  v_n := 0;
  if v_view then
    select count(*) into v_n from public.hr_requests q
      where q.status = any (v_open) and (q.sla_due_at < now() or q.priority = 'urgent');
    if v_n > 0 then
      v_alerts := v_alerts || jsonb_build_object('type', 'hr_request_sla', 'priority', 'high', 'title', 'HR requests overdue or urgent',
        'detail', v_n || ' open request(s) past their SLA or marked urgent', 'count', v_n, 'path', '/hr/requests?tab=inbox&box=overdue');
    end if;
  elsif v_desk or v_team then
    select count(*) into v_n from jsonb_array_elements(public.hr_approval_inbox('overdue', '{}'::jsonb)) x
      where x ->> 'source' = 'request' and x ->> 'next_action' is not null;
    if v_n > 0 then
      v_alerts := v_alerts || jsonb_build_object('type', 'hr_request_sla', 'priority', 'high', 'title', 'Requests awaiting you are overdue',
        'detail', v_n || ' request(s) awaiting your action are past their SLA', 'count', v_n, 'path', '/hr/requests?tab=inbox&box=overdue');
    end if;
  end if;

  return r || jsonb_build_object('kpis', k, 'my_approvals', v_appr, 'alerts', (
    select coalesce(jsonb_agg(a order by case a ->> 'priority' when 'high' then 0 when 'medium' then 1 else 2 end,
                                         a ->> 'date' nulls last, a ->> 'title'), '[]'::jsonb)
    from jsonb_array_elements(v_alerts) a));
end $function$;

-- End of 209.

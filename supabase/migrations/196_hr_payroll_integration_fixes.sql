-- =====================================================================
-- 196_hr_payroll_integration_fixes.sql — Payroll (Module 7) integration
-- fixes with Requests & Approvals (Module 10, 180) and Exit / full & final
-- settlement (Module 4, 130 + 171). Requires 105, 170, 171, 180.
-- =====================================================================
--
-- 1. Reimbursement approval bypass (Module 7 vs Module 10).
--    `public.hr_submit_reimbursement` (105) let an employee create a
--    `hr_reimbursements` claim in 'submitted' state that payroll could approve
--    directly, skipping the manager stage, the receipt and the duplicate
--    checks. Module 10 is now the only path: claims are filed with
--    `hr_create_workflow_request('reimbursement', ...)`, approved manager ->
--    finance, and on final approval 180's `hr_internal.finalize_request`
--    inserts ONE already-approved `hr_reimbursements` row (direct insert as
--    the definer; it never called this RPC). `reimbursement_request_sync`
--    (trigger on hr_reimbursements) and payroll's attach/mark-paid steps are
--    untouched. `hr_decide_reimbursement` stays for any backlog of legacy
--    'submitted' claims; request-created claims are inserted 'approved', so it
--    cannot act on them.
--
-- 2. Final settlement lowered below the payslip (Module 4 vs 171).
--    171's `payroll_sync_settlement_paid` set the payroll payment to 'paid'
--    with amount_paid = the full net pay whenever the settlement was paid,
--    even when the preparer lowered (or zeroed) the 'unpaid_salary' line. The
--    payroll record then claimed money had been paid that the settlement never
--    paid. Now the payment records only what the settlement actually paid for
--    that payslip (sum of its 'unpaid_salary' lines, on top of any earlier
--    partial payroll payment, capped at net pay):
--      * settled amount = remaining balance -> 'paid' (as before), and the
--        reimbursements attached to that payslip are marked paid (same as
--        170's per-payment 'paid' path, so Module 10 requests complete);
--      * settled amount < remaining balance -> 'partially_paid' with the
--        settled amount; attached reimbursements stay 'approved' (not paid);
--      * nothing settled for the payslip (line lowered to 0) -> the payment is
--        left unchanged.
--    The payslip remains linked to the (paid) settlement, so payroll still
--    refuses a separate payment for it (170 `payroll_item_in_settlement`):
--    the settlement is the final word on exit pay; any shortfall is visible
--    on the payroll payment and must be handled as a controlled correction.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Legacy direct-submit reimbursement RPC: refuse self-service claims.
-- ---------------------------------------------------------------------
create or replace function public.hr_submit_reimbursement(p_claim_date date, p_category text, p_amount numeric,
                                                          p_description text, p_receipt_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform hr_private.fail('Reimbursement claims are submitted in My HR Requests (New request -> Reimbursement claim), '
    || 'which routes them for manager and finance approval before Payroll pays them.', 'use_hr_requests');
  return null;
end $$;
comment on function public.hr_submit_reimbursement(date, text, numeric, text, text) is
  'Retired (196): always refuses. File claims with hr_create_workflow_request(''reimbursement'', ...) (Module 10).';

-- ---------------------------------------------------------------------
-- 2. Settlement paid -> payroll payment records only the settled amount.
-- ---------------------------------------------------------------------
do $outer$
begin
  if to_regclass('public.hr_payroll_settlement_lines') is null or to_regclass('public.hr_payroll_settlements') is null
     or to_regclass('public.hr_payroll_payments') is null then
    raise notice '196: Module 4 settlement or Module 7 payment tables not present; settlement fix skipped.';
    return;
  end if;

  execute $f$
    create or replace function hr_private.payroll_sync_settlement_paid()
    returns trigger language plpgsql security definer set search_path = '' as $b$
    declare l record; p public.hr_payroll_payments; v_paid numeric; v_status text; v_ref text; v_date date;
    begin
      if new.status <> 'paid' or old.status = 'paid' then return new; end if;
      v_ref := left('Final settlement ' || coalesce(new.payment_reference, new.id::text), 120);
      v_date := coalesce(new.paid_on, hr_private.business_today());
      for l in
        select hr_private.payroll_item_from_ref(ln.source_ref) item_id, coalesce(sum(ln.amount), 0) settled
          from public.hr_payroll_settlement_lines ln
         where ln.settlement_id = new.id and ln.line_type = 'unpaid_salary' and hr_private.payroll_item_from_ref(ln.source_ref) is not null
         group by 1
      loop
        select * into p from public.hr_payroll_payments where item_id = l.item_id for update;
        if p.id is null or p.status in ('paid','reconciled') then continue; end if;
        -- Only what the settlement actually paid for this payslip (on top of any earlier partial payment).
        v_paid := least(p.amount, p.amount_paid + greatest(round(l.settled, 2), 0));
        if v_paid <= p.amount_paid then continue; end if;      -- nothing paid for this payslip in the settlement
        v_status := case when v_paid >= p.amount then 'paid' else 'partially_paid' end;
        update public.hr_payroll_payments set status = v_status, amount_paid = v_paid, method = 'other',
               payment_date = v_date, reference = v_ref,
               notes = case when v_status = 'paid' then 'Paid through the employee''s full & final settlement.'
                            else left('Partly paid through the employee''s full & final settlement: ' || v_paid || ' of ' || p.amount
                                      || '; the settlement did not pay the balance.', 1000) end,
               failure_reason = null, recorded_by = new.paid_by, recorded_at = now(), updated_at = now()
         where id = p.id;
        insert into public.hr_payroll_payment_events (payment_id, from_status, to_status, amount_paid, method, reference, payment_date, note)
        values (p.id, p.status, v_status, v_paid, 'other', v_ref, v_date,
                case when v_status = 'paid' then 'Paid through final settlement ' || new.id::text
                     else 'Partly paid through final settlement ' || new.id::text || ' (settlement line lower than the unpaid balance)' end);
        if v_status = 'paid' then
          -- Same as a payroll 'paid' payment (170): claims attached to this payslip are now paid
          -- (Module 10's reimbursement_request_sync completes the originating requests).
          update public.hr_reimbursements set status = 'paid'
           where payroll_run_id = p.run_id and employee_id = p.employee_id and status = 'approved';
        end if;
        perform hr_private.payroll_refresh_payment_status(p.run_id);
      end loop;
      return new;
    end $b$;
  $f$;
  -- Trigger from 171 already points at this function; recreate defensively in case 171 skipped it.
  execute 'drop trigger if exists hr_payroll_settlements_payroll_sync on public.hr_payroll_settlements';
  execute 'create trigger hr_payroll_settlements_payroll_sync after update of status on public.hr_payroll_settlements
           for each row execute function hr_private.payroll_sync_settlement_paid()';
end $outer$;

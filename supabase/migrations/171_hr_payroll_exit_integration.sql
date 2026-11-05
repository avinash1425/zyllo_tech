-- =====================================================================
-- 171_hr_payroll_exit_integration.sql — Payroll (Module 7) <-> Exit /
-- full & final settlement (Module 4, migration 130): no double payment.
-- =====================================================================
-- Owned by Module 7; kept separate from 170 so the Module 4 owner can review
-- it. Does NOTHING when 130's settlement tables are not present.
--
-- Why: 130 adds an 'unpaid_salary' settlement line for every payroll item of
-- a run whose status is 'finalized'. Since 170, a run stays 'finalized' until
-- EVERY employee's payment is recorded, so an exiting employee whose own
-- payroll payment is already paid would be paid again by the settlement.
--
--  1. Settlement lines (BEFORE INSERT/UPDATE): an 'unpaid_salary' line for a
--     payroll item already paid/reconciled through payroll is skipped on insert
--     (refused on update); a partly paid item is capped at the unpaid balance.
--  2. Settlement paid (AFTER UPDATE): payroll payments that the settlement paid
--     are recorded as paid with the settlement's evidence (reference, date,
--     actor), logged in the payment history, and the run's status refreshed.
--
-- Also relied on (in 170): approved/paid settlements with a 'salary_due' line
-- exclude days up to the last working day from later payroll runs, and payroll
-- refuses to record a payment for an item included in a live settlement.
-- =====================================================================

create or replace function hr_private.payroll_item_from_ref(p_ref text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p_ref ~ '^payroll_item:[0-9a-fA-F-]{36}$' then substring(p_ref from 14)::uuid end
$$;

do $outer$
begin
  if to_regclass('public.hr_payroll_settlement_lines') is null or to_regclass('public.hr_payroll_settlements') is null then
    raise notice '171: Module 4 settlement tables not present; nothing to integrate.';
    return;
  end if;

  execute $f$
    create or replace function hr_private.payroll_settlement_line_guard()
    returns trigger language plpgsql security definer set search_path = '' as $b$
    declare p public.hr_payroll_payments; v_left numeric;
    begin
      if new.line_type <> 'unpaid_salary' or hr_private.payroll_item_from_ref(new.source_ref) is null then return new; end if;
      select * into p from public.hr_payroll_payments where item_id = hr_private.payroll_item_from_ref(new.source_ref);
      if p.id is null then return new; end if;
      if p.status in ('paid','reconciled') then
        if tg_op = 'INSERT' then return null; end if;          -- already paid through payroll: do not add it
        perform hr_private.fail('This payslip is already recorded as paid through payroll; it cannot be paid again in the final settlement.', 'already_paid');
      end if;
      v_left := p.amount - p.amount_paid;
      if new.amount > v_left then
        new.amount := v_left;
        new.note := left(coalesce(new.note || ' ', '') || 'Capped at the unpaid balance (' || p.amount_paid || ' already paid through payroll).', 1000);
      end if;
      return new;
    end $b$;
  $f$;
  execute 'drop trigger if exists hr_payroll_settlement_lines_payroll_guard on public.hr_payroll_settlement_lines';
  execute 'create trigger hr_payroll_settlement_lines_payroll_guard before insert or update on public.hr_payroll_settlement_lines
           for each row execute function hr_private.payroll_settlement_line_guard()';

  execute $f$
    create or replace function hr_private.payroll_sync_settlement_paid()
    returns trigger language plpgsql security definer set search_path = '' as $b$
    declare l record; p public.hr_payroll_payments;
    begin
      if new.status <> 'paid' or old.status = 'paid' then return new; end if;
      for l in
        select hr_private.payroll_item_from_ref(ln.source_ref) item_id from public.hr_payroll_settlement_lines ln
        where ln.settlement_id = new.id and ln.line_type = 'unpaid_salary' and hr_private.payroll_item_from_ref(ln.source_ref) is not null
      loop
        select * into p from public.hr_payroll_payments where item_id = l.item_id for update;
        if p.id is null or p.status in ('paid','reconciled') then continue; end if;
        update public.hr_payroll_payments set status = 'paid', amount_paid = amount, method = 'other',
               payment_date = coalesce(new.paid_on, hr_private.business_today()),
               reference = left('Final settlement ' || coalesce(new.payment_reference, new.id::text), 120),
               notes = 'Paid through the employee''s full & final settlement.', failure_reason = null,
               recorded_by = new.paid_by, recorded_at = now(), updated_at = now()
         where id = p.id;
        insert into public.hr_payroll_payment_events (payment_id, from_status, to_status, amount_paid, method, reference, payment_date, note)
        values (p.id, p.status, 'paid', p.amount, 'other', left('Final settlement ' || coalesce(new.payment_reference, new.id::text), 120),
                coalesce(new.paid_on, hr_private.business_today()), 'Paid through final settlement ' || new.id::text);
        perform hr_private.payroll_refresh_payment_status(p.run_id);
      end loop;
      return new;
    end $b$;
  $f$;
  execute 'drop trigger if exists hr_payroll_settlements_payroll_sync on public.hr_payroll_settlements';
  execute 'create trigger hr_payroll_settlements_payroll_sync after update of status on public.hr_payroll_settlements
           for each row execute function hr_private.payroll_sync_settlement_paid()';
end $outer$;

grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

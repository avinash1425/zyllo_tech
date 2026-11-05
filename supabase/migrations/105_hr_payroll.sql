-- =====================================================================
-- 105_hr_payroll.sql — Payroll (strictly separated: payroll.* only)
-- =====================================================================
-- Salary components and effective-dated structures, bank accounts, payroll
-- runs (draft -> calculated -> reviewed -> approved -> finalized -> paid),
-- items, adjustments, reimbursements and immutable payslips.
--
-- * Only payroll.* permissions grant access; HR Admin has none by default.
-- * No statutory rules or rates are hardcoded. Statutory components must be
--   configured by payroll staff and stay `requires_verification` (and are
--   skipped by the calculator) until verified by a payroll.approve holder.
-- * hr_mark_payroll_paid() records status only. Nothing here initiates a
--   bank transfer or any payment.
-- * The shared audit log is readable by audit.view holders (HR Admin), so
--   salary amounts and account numbers are REDACTED in audit rows.
--
-- Depends on: 100_hr_foundation.sql, 103_hr_leave.sql (unpaid leave -> LOP),
-- 101_hr_attendance.sql (optional LOP from attendance).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

create extension if not exists btree_gist;

insert into public.hr_settings (key, value, description) values
  ('payroll', jsonb_build_object(
      'require_separate_approver', true,      -- approver/finalizer must differ from the run's creator and calculator
      'lop_from_attendance', false,           -- also count attendance rows with status 'absent' as LOP days
      'proration_basis', 'working_days',      -- working_days | calendar_days
      'currency', 'INR'
   ),
   'Payroll: approval separation, LOP sources and proration basis')
on conflict (key) do nothing;

-- Shared calendar helper (identical body to 101/102/103).
create or replace function hr_private.employee_working_days(p_employee uuid)
returns smallint[] language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.working_days from public.hr_employees e join public.hr_shifts s on s.id = e.shift_id where e.id = p_employee),
    (select s.working_days from public.hr_shifts s where s.is_default and s.active limit 1),
    (select array_agg(x::smallint) from jsonb_array_elements_text(hr_private.setting('company') -> 'working_days') x),
    '{1,2,3,4,5}'::smallint[])
$$;

create or replace function hr_private.is_privileged_write()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('hr.privileged_write', true), '') = 'on' or auth.uid() is null
$$;

-- ---------------------------------------------------------------------
-- Salary components
-- ---------------------------------------------------------------------
create table public.hr_salary_components (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  name                  text not null check (length(btrim(name)) between 2 and 120),
  kind                  text not null check (kind in ('earning','deduction','employer_contribution')),
  calc_type             text not null check (calc_type in ('fixed','percent_of_basic','percent_of_gross','manual')),
  default_value         numeric(14,4) check (default_value >= 0),
  taxable               boolean not null default true,
  is_statutory          boolean not null default false,
  statutory_note        text check (length(statutory_note) <= 2000),
  requires_verification boolean not null default false,
  verified_by           uuid,
  verified_at           timestamptz,
  active                boolean not null default true,
  sort_order            smallint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
select hr_private.secure_table('public.hr_salary_components');
select hr_private.enable_audit('public.hr_salary_components');

create or replace function hr_private.salary_components_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.is_privileged_write() then
    if tg_op = 'INSERT' then
      new.verified_by := null; new.verified_at := null;
    elsif new.verified_at is distinct from old.verified_at or new.verified_by is distinct from old.verified_by then
      perform hr_private.fail('Components are verified through the verification action.', 'use_workflow');
    end if;
  end if;
  -- Changing how a verified statutory component calculates voids the verification.
  if tg_op = 'UPDATE' and new.is_statutory and new.verified_at is not null and not hr_private.is_privileged_write()
     and (new.calc_type, new.default_value, new.kind) is distinct from (old.calc_type, old.default_value, old.kind) then
    new.verified_at := null; new.verified_by := null;
  end if;
  if new.is_statutory and new.verified_at is null then
    new.requires_verification := true;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger hr_salary_components_before_write before insert or update on public.hr_salary_components
  for each row execute function hr_private.salary_components_before_write();

create policy hr_salary_components_read on public.hr_salary_components for select to authenticated using (hr_private.has_permission('payroll.view'));
create policy hr_salary_components_insert on public.hr_salary_components for insert to authenticated with check (hr_private.has_permission('payroll.manage'));
create policy hr_salary_components_update on public.hr_salary_components for update to authenticated
  using (hr_private.has_permission('payroll.manage')) with check (hr_private.has_permission('payroll.manage'));
-- No delete: deactivate (active = false).

-- Generic components only; amounts/percentages are set per salary structure.
insert into public.hr_salary_components (code, name, kind, calc_type, default_value, taxable, sort_order) values
  ('BASIC',           'Basic Salary',          'earning',   'fixed',            null, true, 1),
  ('HRA',             'House Rent Allowance',  'earning',   'percent_of_basic', null, true, 2),
  ('SPECIAL',         'Special Allowance',     'earning',   'fixed',            null, true, 3),
  ('OTHER_DEDUCTION', 'Other Deduction',       'deduction', 'manual',           null, false, 50)
on conflict (code) do nothing;

create or replace function public.hr_verify_salary_component(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.hr_salary_components;
begin
  if not hr_private.has_permission('payroll.approve') then
    perform hr_private.fail('You are not allowed to verify salary components.', 'forbidden');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_salary_components set verified_by = auth.uid(), verified_at = now(), requires_verification = false,
         statutory_note = coalesce(nullif(btrim(p_note), ''), statutory_note)
   where id = p_id returning * into c;
  perform set_config('hr.privileged_write', 'off', true);
  if c.id is null then perform hr_private.fail('Component not found.', 'not_found'); end if;
  return to_jsonb(c);
end $$;

-- ---------------------------------------------------------------------
-- Salary structures (effective-dated, non-overlapping per employee)
-- ---------------------------------------------------------------------
create table public.hr_salary_structures (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.hr_employees(id) on delete restrict,
  effective_from date not null,
  effective_to   date,
  annual_ctc     numeric(14,2) not null check (annual_ctc >= 0),
  currency       text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  status         text not null default 'active' check (status in ('draft','active','archived')),
  notes          text check (length(notes) <= 2000),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  constraint hr_salary_structures_no_overlap exclude using gist (
    employee_id with =, daterange(effective_from, effective_to, '[]') with &&) where (status <> 'archived')
);
select hr_private.secure_table('public.hr_salary_structures');
create trigger hr_salary_structures_touch before update on public.hr_salary_structures for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_salary_structures', array['annual_ctc']);
create policy hr_salary_structures_read on public.hr_salary_structures for select to authenticated using (hr_private.has_permission('payroll.view'));
create policy hr_salary_structures_insert on public.hr_salary_structures for insert to authenticated with check (hr_private.has_permission('payroll.manage'));
create policy hr_salary_structures_update on public.hr_salary_structures for update to authenticated
  using (hr_private.has_permission('payroll.manage')) with check (hr_private.has_permission('payroll.manage'));

create table public.hr_salary_structure_items (
  id           uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.hr_salary_structures(id) on delete cascade,
  component_id uuid not null references public.hr_salary_components(id) on delete restrict,
  amount       numeric(14,2) check (amount >= 0),          -- monthly amount (fixed / manual)
  percent      numeric(7,4) check (percent between 0 and 100),   -- percent_of_basic / percent_of_gross (else component default)
  unique (structure_id, component_id)
);
select hr_private.secure_table('public.hr_salary_structure_items');
select hr_private.enable_audit('public.hr_salary_structure_items', array['amount','percent']);
create policy hr_salary_structure_items_read on public.hr_salary_structure_items for select to authenticated using (hr_private.has_permission('payroll.view'));
create policy hr_salary_structure_items_insert on public.hr_salary_structure_items for insert to authenticated with check (hr_private.has_permission('payroll.manage'));
create policy hr_salary_structure_items_update on public.hr_salary_structure_items for update to authenticated
  using (hr_private.has_permission('payroll.manage')) with check (hr_private.has_permission('payroll.manage'));
create policy hr_salary_structure_items_delete on public.hr_salary_structure_items for delete to authenticated using (hr_private.has_permission('payroll.manage'));

create or replace function hr_private.salary_structure_items_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.hr_salary_components;
begin
  select * into c from public.hr_salary_components where id = new.component_id;
  if c.calc_type = 'fixed' and new.amount is null then
    perform hr_private.fail('Enter a monthly amount for ' || c.name || '.', 'amount_required');
  end if;
  if c.calc_type in ('percent_of_basic','percent_of_gross') and new.percent is null and c.default_value is null then
    perform hr_private.fail('Enter a percentage for ' || c.name || '.', 'percent_required');
  end if;
  return new;
end $$;
create trigger hr_salary_structure_items_validate before insert or update on public.hr_salary_structure_items
  for each row execute function hr_private.salary_structure_items_validate();

-- ---------------------------------------------------------------------
-- Bank accounts (payroll-only; employees see a masked view of their own)
-- ---------------------------------------------------------------------
create table public.hr_employee_bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.hr_employees(id) on delete restrict,
  bank_name      text not null check (length(btrim(bank_name)) between 2 and 120),
  account_holder text not null check (length(btrim(account_holder)) between 2 and 120),
  account_number text not null check (account_number ~ '^[0-9A-Za-z]{6,34}$'),
  ifsc           text check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  is_primary     boolean not null default true,
  verified       boolean not null default false,
  verified_by    uuid,
  verified_at    timestamptz,
  active         boolean not null default true,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index hr_employee_bank_accounts_primary on public.hr_employee_bank_accounts(employee_id) where is_primary and active;
select hr_private.secure_table('public.hr_employee_bank_accounts');
create trigger hr_employee_bank_accounts_touch before update on public.hr_employee_bank_accounts for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_employee_bank_accounts', array['account_number']);
create policy hr_employee_bank_accounts_read on public.hr_employee_bank_accounts for select to authenticated using (hr_private.has_permission('payroll.view'));
create policy hr_employee_bank_accounts_insert on public.hr_employee_bank_accounts for insert to authenticated with check (hr_private.has_permission('payroll.manage'));
create policy hr_employee_bank_accounts_update on public.hr_employee_bank_accounts for update to authenticated
  using (hr_private.has_permission('payroll.manage')) with check (hr_private.has_permission('payroll.manage'));

create or replace function public.hr_my_bank_accounts()
returns table (id uuid, bank_name text, account_holder text, account_last4 text, ifsc text, is_primary boolean, verified boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id();
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  return query
    select b.id, b.bank_name, b.account_holder, right(b.account_number, 4), b.ifsc, b.is_primary, b.verified
    from public.hr_employee_bank_accounts b
    where b.employee_id = v_me and b.active
    order by b.is_primary desc, b.created_at;
end $$;

-- ---------------------------------------------------------------------
-- Payroll runs, items, adjustments, reimbursements, payslips
-- ---------------------------------------------------------------------
create table public.hr_payroll_runs (
  id                uuid primary key default gen_random_uuid(),
  period_start      date not null,
  period_end        date not null,
  status            text not null default 'draft'
                    check (status in ('draft','calculated','reviewed','approved','finalized','paid')),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  calculated_by     uuid,
  calculated_at     timestamptz,
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  approved_by       uuid,
  approved_at       timestamptz,
  finalized_by      uuid,
  finalized_at      timestamptz,
  paid_by           uuid,
  paid_at           timestamptz,
  payment_reference text check (length(payment_reference) <= 120),
  notes             text check (length(notes) <= 2000),
  updated_at        timestamptz not null default now(),
  check (period_end >= period_start),
  check (period_end - period_start <= 62),
  unique (period_start, period_end),
  constraint hr_payroll_runs_no_overlap exclude using gist (daterange(period_start, period_end, '[]') with &&)
);
select hr_private.secure_table('public.hr_payroll_runs');
select hr_private.enable_audit('public.hr_payroll_runs');
create policy hr_payroll_runs_read on public.hr_payroll_runs for select to authenticated using (hr_private.has_permission('payroll.view'));
revoke insert, update, delete, truncate on public.hr_payroll_runs from authenticated;

-- Finalized / paid runs are frozen; the only later change is finalized -> paid.
create or replace function hr_private.payroll_runs_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then perform hr_private.fail('Only draft payroll runs can be deleted.', 'run_locked'); end if;
    return old;
  end if;
  if old.status = 'paid'
     or (old.status = 'finalized'
         and (new.status <> 'paid'
              or (new.period_start, new.period_end, new.created_by, new.calculated_at, new.approved_by, new.finalized_at, new.finalized_by)
                 is distinct from (old.period_start, old.period_end, old.created_by, old.calculated_at, old.approved_by, old.finalized_at, old.finalized_by))) then
    perform hr_private.fail('This payroll run is finalized and cannot be changed.', 'run_locked');
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger hr_payroll_runs_guard before update or delete on public.hr_payroll_runs
  for each row execute function hr_private.payroll_runs_guard();

create or replace function hr_private.payroll_run_locked(p_run uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_payroll_runs where id = p_run and status in ('approved','finalized','paid'))
$$;

create table public.hr_payroll_items (
  id                     uuid primary key default gen_random_uuid(),
  run_id                 uuid not null references public.hr_payroll_runs(id) on delete restrict,
  employee_id            uuid not null references public.hr_employees(id) on delete restrict,
  structure_id           uuid references public.hr_salary_structures(id) on delete restrict,
  currency               text not null default 'INR',
  working_days           numeric(5,1) not null,
  payable_days           numeric(5,1) not null,
  lop_days               numeric(5,1) not null default 0,
  gross                  numeric(14,2) not null,
  total_deductions       numeric(14,2) not null,
  employer_contributions numeric(14,2) not null default 0,
  reimbursements         numeric(14,2) not null default 0,
  net                    numeric(14,2) not null,
  breakdown              jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  unique (run_id, employee_id)
);
select hr_private.secure_table('public.hr_payroll_items');
select hr_private.enable_audit('public.hr_payroll_items', array['gross','total_deductions','employer_contributions','reimbursements','net','breakdown']);
create policy hr_payroll_items_read on public.hr_payroll_items for select to authenticated using (hr_private.has_permission('payroll.view'));
revoke insert, update, delete, truncate on public.hr_payroll_items from authenticated;

create table public.hr_payroll_adjustments (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid references public.hr_payroll_runs(id) on delete restrict,   -- null = correction waiting for the next run
  employee_id   uuid not null references public.hr_employees(id) on delete restrict,
  component_id  uuid references public.hr_salary_components(id) on delete restrict,
  label         text not null check (length(btrim(label)) between 2 and 120),
  amount        numeric(14,2) not null check (amount <> 0),     -- positive = earning, negative = deduction
  reason        text not null check (length(btrim(reason)) between 3 and 1000),
  source        text not null default 'manual' check (source in ('manual','correction')),
  source_run_id uuid references public.hr_payroll_runs(id) on delete restrict,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  check (run_id is not null or source = 'correction'),
  check (source = 'manual' or source_run_id is not null)
);
create index hr_payroll_adjustments_run on public.hr_payroll_adjustments(run_id, employee_id);
select hr_private.secure_table('public.hr_payroll_adjustments');
select hr_private.enable_audit('public.hr_payroll_adjustments', array['amount']);
create policy hr_payroll_adjustments_read on public.hr_payroll_adjustments for select to authenticated using (hr_private.has_permission('payroll.view'));
revoke insert, update, delete, truncate on public.hr_payroll_adjustments from authenticated;

create table public.hr_reimbursements (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.hr_employees(id) on delete restrict,
  claim_date     date not null,
  category       text not null check (category in ('travel','meals','internet','equipment','medical','training','other')),
  amount         numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  description    text not null check (length(btrim(description)) between 3 and 2000),
  receipt_path   text check (receipt_path is null or (length(receipt_path) <= 500 and receipt_path !~ '\.\.')),
  status         text not null default 'submitted' check (status in ('submitted','approved','rejected','paid')),
  payroll_run_id uuid references public.hr_payroll_runs(id) on delete restrict,
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text check (length(decision_note) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index hr_reimbursements_emp on public.hr_reimbursements(employee_id, status);
select hr_private.secure_table('public.hr_reimbursements');
create trigger hr_reimbursements_touch before update on public.hr_reimbursements for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_reimbursements');
create policy hr_reimbursements_read on public.hr_reimbursements for select to authenticated
  using (employee_id = hr_private.current_employee_id() or hr_private.has_permission('payroll.view'));
revoke insert, update, delete, truncate on public.hr_reimbursements from authenticated;

create table public.hr_payslips (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.hr_payroll_runs(id) on delete restrict,
  employee_id      uuid not null references public.hr_employees(id) on delete restrict,
  period_start     date not null,
  period_end       date not null,
  currency         text not null,
  working_days     numeric(5,1) not null,
  payable_days     numeric(5,1) not null,
  lop_days         numeric(5,1) not null,
  gross            numeric(14,2) not null,
  total_deductions numeric(14,2) not null,
  reimbursements   numeric(14,2) not null default 0,
  net              numeric(14,2) not null,
  breakdown        jsonb not null,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index hr_payslips_emp on public.hr_payslips(employee_id, period_start desc);
select hr_private.secure_table('public.hr_payslips');
select hr_private.enable_audit('public.hr_payslips', array['gross','total_deductions','reimbursements','net','breakdown']);
-- Runs are hidden from employees by RLS, so the payslip policy checks the run via a definer helper.
create or replace function hr_private.payroll_run_released(p_run uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_payroll_runs where id = p_run and status in ('finalized','paid'))
$$;
create policy hr_payslips_read on public.hr_payslips for select to authenticated using (
     hr_private.has_permission('payroll.view')
  or (employee_id = hr_private.current_employee_id()
      and published_at is not null
      and hr_private.payroll_run_released(run_id)));
revoke insert, update, delete, truncate on public.hr_payslips from authenticated;

-- Locks: items/adjustments cannot change once the run is approved; payslips never change.
create or replace function hr_private.payroll_items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op <> 'INSERT' and hr_private.payroll_run_locked(old.run_id))
     or (tg_op <> 'DELETE' and hr_private.payroll_run_locked(new.run_id)) then
    perform hr_private.fail('This payroll run is approved or finalized; its items cannot be changed.', 'run_locked');
  end if;
  return coalesce(new, old);
end $$;
create trigger hr_payroll_items_guard before insert or update or delete on public.hr_payroll_items
  for each row execute function hr_private.payroll_items_guard();
create trigger hr_payroll_adjustments_guard before insert or update or delete on public.hr_payroll_adjustments
  for each row execute function hr_private.payroll_items_guard();

create or replace function hr_private.payslips_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform hr_private.fail('Payslips are immutable. Use a payroll correction in the next run.', 'payslip_locked');
  return null;
end $$;
create trigger hr_payslips_guard before update or delete on public.hr_payslips
  for each row execute function hr_private.payslips_guard();

-- ---------------------------------------------------------------------
-- Reimbursement RPCs
-- ---------------------------------------------------------------------
create or replace function public.hr_submit_reimbursement(p_claim_date date, p_category text, p_amount numeric,
                                                          p_description text, p_receipt_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  if p_claim_date is null or p_claim_date > hr_private.business_today() then
    perform hr_private.fail('Claim date cannot be in the future.', 'invalid_date');
  end if;
  if p_amount is null or p_amount <= 0 then perform hr_private.fail('Enter a positive amount.', 'invalid_amount'); end if;
  if p_category not in ('travel','meals','internet','equipment','medical','training','other') then
    perform hr_private.fail('Choose a valid category.', 'invalid_category');
  end if;
  if length(btrim(coalesce(p_description, ''))) < 3 then perform hr_private.fail('Describe the expense.', 'description_required'); end if;
  insert into public.hr_reimbursements (employee_id, claim_date, category, amount, description, receipt_path)
  values (v_me, p_claim_date, p_category, round(p_amount, 2), btrim(p_description), nullif(btrim(p_receipt_path), ''))
  returning id into v_id;
  perform hr_private.notify_permission_holders('payroll.manage', 'payroll.reimbursement_submitted', 'Reimbursement claim submitted',
    'A new reimbursement claim is awaiting review.', '/hr/payroll', 'hr_reimbursements', v_id::text, v_me);
  return v_id;
end $$;

create or replace function public.hr_decide_reimbursement(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_reimbursements;
begin
  if not hr_private.has_permission('payroll.manage') then
    perform hr_private.fail('You are not allowed to decide reimbursements.', 'forbidden');
  end if;
  select * into r from public.hr_reimbursements where id = p_id for update;
  if r.id is null then perform hr_private.fail('Claim not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot decide your own reimbursement claim.', 'self_approval');
  end if;
  if r.status <> 'submitted' then perform hr_private.fail('This claim has already been ' || r.status || '.', 'already_decided'); end if;
  if not coalesce(p_approve, false) and length(btrim(coalesce(p_note, ''))) = 0 then
    perform hr_private.fail('Please give a reason for rejecting.', 'note_required');
  end if;
  update public.hr_reimbursements set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_id returning * into r;
  perform hr_private.notify_employee(r.employee_id, 'payroll.reimbursement_' || r.status, 'Reimbursement ' || r.status,
    'Your ' || r.category || ' claim of ' || r.amount || ' was ' || r.status || '.', '/employee/payslips', 'hr_reimbursements', p_id::text);
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- Calculation helpers
-- ---------------------------------------------------------------------
create or replace function hr_private.payroll_counted_days(p_employee uuid, p_from date, p_to date, p_basis text)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
  where p_to >= p_from
    and (p_basis = 'calendar_days' or extract(isodow from g.d)::smallint = any(hr_private.employee_working_days(p_employee)))
$$;

-- Loss-of-pay days in a range: approved leave of unpaid types (+ attendance
-- 'absent' working days not covered by approved leave, when enabled).
create or replace function hr_private.payroll_lop_days(p_employee uuid, p_from date, p_to date, p_from_attendance boolean)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v numeric := 0; r record;
begin
  if p_to < p_from then return 0; end if;
  for r in
    select lr.leave_type_id, lr.start_date, lr.end_date, lr.start_half, lr.end_half
    from public.hr_leave_requests lr join public.hr_leave_types t on t.id = lr.leave_type_id
    where lr.employee_id = p_employee and lr.status = 'approved' and not t.paid
      and lr.start_date <= p_to and lr.end_date >= p_from
  loop
    v := v + hr_private.leave_days(p_employee, r.leave_type_id, greatest(r.start_date, p_from), least(r.end_date, p_to),
                                   r.start_half and r.start_date >= p_from, r.end_half and r.end_date <= p_to);
  end loop;
  if p_from_attendance and to_regclass('public.hr_attendance') is not null then
    v := v + (select count(*) from public.hr_attendance a
              where a.employee_id = p_employee and a.status = 'absent' and a.work_date between p_from and p_to
                and extract(isodow from a.work_date)::smallint = any(hr_private.employee_working_days(p_employee))
                and not hr_private.is_on_approved_leave(p_employee, a.work_date));
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Run workflow RPCs
-- ---------------------------------------------------------------------
create or replace function public.hr_create_payroll_run(p_period_start date, p_period_end date, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_payroll_runs;
begin
  if not hr_private.has_permission('payroll.manage') then
    perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden');
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    perform hr_private.fail('Choose a valid payroll period.', 'invalid_period');
  end if;
  if p_period_end - p_period_start > 62 then
    perform hr_private.fail('A payroll period cannot be longer than two months.', 'invalid_period');
  end if;
  perform pg_advisory_xact_lock(hashtext('hr_payroll_runs'));
  if exists (select 1 from public.hr_payroll_runs x
             where daterange(x.period_start, x.period_end, '[]') && daterange(p_period_start, p_period_end, '[]')) then
    perform hr_private.fail('A payroll run already exists for an overlapping period.', 'duplicate_run');
  end if;
  insert into public.hr_payroll_runs (period_start, period_end, created_by, notes)
  values (p_period_start, p_period_end, auth.uid(), nullif(btrim(p_notes), ''))
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.hr_calculate_payroll_run(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.hr_payroll_runs;
  cfg jsonb := coalesce(hr_private.setting('payroll'), '{}'::jsonb);
  v_basis text := coalesce(cfg ->> 'proration_basis', 'working_days');
  v_att boolean := coalesce((cfg ->> 'lop_from_attendance')::boolean, false);
  e record; s record; c record;
  v_ws date; v_we date; v_seg_s date; v_seg_e date;
  v_wd int; v_window_days int; v_seg_days int;
  v_seg_lop numeric; v_seg_pay numeric; v_factor numeric; v_share numeric;
  v_payable numeric; v_lop numeric;
  v_basic numeric; v_gross_pre numeric; v_gross_full numeric; v_amt numeric;
  v_lines jsonb; v_segments jsonb; v_skipped jsonb; v_adj jsonb; v_reimb jsonb;
  v_adj_pos numeric; v_adj_neg numeric; v_reimb_total numeric;
  v_earn numeric; v_ded numeric; v_employer numeric; v_net numeric;
  v_structure uuid; v_currency text;
  v_count int := 0; v_tot_gross numeric := 0; v_tot_ded numeric := 0; v_tot_net numeric := 0;
begin
  if not hr_private.has_permission('payroll.manage') then
    perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden');
  end if;
  select * into run from public.hr_payroll_runs where id = p_id for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status not in ('draft','calculated') then
    perform hr_private.fail('Only draft or calculated runs can be (re)calculated (status: ' || run.status || ').', 'invalid_state');
  end if;
  if v_basis not in ('working_days','calendar_days') then v_basis := 'working_days'; end if;

  -- Start clean: items are rebuilt; corrections and reimbursements re-attached below.
  delete from public.hr_payroll_items where run_id = p_id;
  update public.hr_reimbursements set payroll_run_id = null where payroll_run_id = p_id and status = 'approved';
  update public.hr_payroll_adjustments set run_id = null where run_id = p_id and source = 'correction';

  for e in
    select emp.id, emp.joining_date, emp.last_working_date, emp.employee_code
    from public.hr_employees emp
    where emp.status <> 'archived'
      and coalesce(emp.joining_date, run.period_start) <= run.period_end
      and coalesce(emp.last_working_date, run.period_end) >= run.period_start
      and exists (select 1 from public.hr_salary_structures ss
                  where ss.employee_id = emp.id and ss.status = 'active'
                    and ss.effective_from <= least(run.period_end, coalesce(emp.last_working_date, run.period_end))
                    and coalesce(ss.effective_to, run.period_end) >= greatest(run.period_start, coalesce(emp.joining_date, run.period_start)))
    order by emp.employee_code
  loop
    v_ws := greatest(run.period_start, coalesce(e.joining_date, run.period_start));
    v_we := least(run.period_end, coalesce(e.last_working_date, run.period_end));
    v_wd := hr_private.payroll_counted_days(e.id, run.period_start, run.period_end, v_basis);
    v_window_days := hr_private.payroll_counted_days(e.id, v_ws, v_we, v_basis);
    v_lines := '{}'; v_segments := '[]'; v_skipped := '[]';
    v_payable := 0; v_lop := 0; v_structure := null; v_currency := coalesce(cfg ->> 'currency', 'INR');

    for s in
      select ss.id, ss.effective_from, ss.effective_to, ss.currency from public.hr_salary_structures ss
      where ss.employee_id = e.id and ss.status = 'active'
        and ss.effective_from <= v_we and coalesce(ss.effective_to, v_we) >= v_ws
      order by ss.effective_from
    loop
      v_structure := coalesce(v_structure, s.id);
      v_currency := s.currency;
      v_seg_s := greatest(v_ws, s.effective_from);
      v_seg_e := least(v_we, coalesce(s.effective_to, v_we));
      v_seg_days := hr_private.payroll_counted_days(e.id, v_seg_s, v_seg_e, v_basis);
      v_seg_lop := least(v_seg_days, hr_private.payroll_lop_days(e.id, v_seg_s, v_seg_e, v_att));
      v_seg_pay := v_seg_days - v_seg_lop;
      v_factor := case when v_wd > 0 then v_seg_pay / v_wd else 0 end;         -- proration of earnings
      v_share := case when v_window_days > 0 then v_seg_days::numeric / v_window_days else 0 end;  -- split of fixed deductions
      v_payable := v_payable + v_seg_pay;
      v_lop := v_lop + v_seg_lop;
      v_segments := v_segments || jsonb_build_object('structure_id', s.id, 'from', v_seg_s, 'to', v_seg_e,
                                                     'days', v_seg_days, 'lop_days', v_seg_lop, 'payable_days', v_seg_pay);

      -- Monthly BASIC and gross (before percent_of_gross earnings), verified active components only.
      select coalesce(sum(i.amount), 0) into v_basic
      from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
      where i.structure_id = s.id and k.code = 'BASIC' and k.active and not k.requires_verification;
      select coalesce(sum(case k.calc_type when 'percent_of_basic' then v_basic * coalesce(i.percent, k.default_value, 0) / 100
                                           else coalesce(i.amount, 0) end), 0) into v_gross_pre
      from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
      where i.structure_id = s.id and k.kind = 'earning' and k.calc_type <> 'percent_of_gross' and k.active and not k.requires_verification;
      select v_gross_pre + coalesce(sum(v_gross_pre * coalesce(i.percent, k.default_value, 0) / 100), 0) into v_gross_full
      from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
      where i.structure_id = s.id and k.kind = 'earning' and k.calc_type = 'percent_of_gross' and k.active and not k.requires_verification;

      for c in
        select k.code, k.name, k.kind, k.calc_type, k.active, k.requires_verification, i.amount,
               coalesce(i.percent, k.default_value, 0) as pct
        from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
        where i.structure_id = s.id
        order by k.sort_order, k.code
      loop
        if not c.active or c.requires_verification then
          v_skipped := v_skipped || to_jsonb(c.code);
          continue;
        end if;
        if c.kind in ('earning','employer_contribution') then
          v_amt := (case c.calc_type when 'percent_of_basic' then v_basic * c.pct / 100
                                     when 'percent_of_gross' then v_gross_full * c.pct / 100
                                     else coalesce(c.amount, 0) end) * v_factor;
        else
          -- Percentage deductions follow the prorated base; fixed/manual deductions are not prorated
          -- (split between structure segments by days).
          v_amt := case c.calc_type when 'percent_of_basic' then v_basic * v_factor * c.pct / 100
                                    when 'percent_of_gross' then v_gross_full * v_factor * c.pct / 100
                                    else coalesce(c.amount, 0) * v_share end;
        end if;
        v_amt := round(v_amt, 2);
        v_lines := jsonb_set(v_lines, array[c.code], jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind,
                     'amount', coalesce((v_lines -> c.code ->> 'amount')::numeric, 0) + v_amt));
      end loop;
    end loop;

    -- Corrections from earlier finalized runs that are waiting for a run.
    update public.hr_payroll_adjustments adj set run_id = p_id
    where adj.employee_id = e.id and adj.run_id is null and adj.source = 'correction'
      and exists (select 1 from public.hr_payroll_runs src where src.id = adj.source_run_id and src.period_end < run.period_start);
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'amount', a.amount, 'reason', a.reason,
                                                 'source', a.source, 'source_run_id', a.source_run_id) order by a.created_at), '[]'::jsonb),
           coalesce(sum(a.amount) filter (where a.amount > 0), 0),
           coalesce(-sum(a.amount) filter (where a.amount < 0), 0)
      into v_adj, v_adj_pos, v_adj_neg
    from public.hr_payroll_adjustments a where a.run_id = p_id and a.employee_id = e.id;

    -- Approved reimbursements not yet paid through payroll.
    update public.hr_reimbursements set payroll_run_id = p_id
    where employee_id = e.id and status = 'approved' and payroll_run_id is null and claim_date <= run.period_end;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'category', x.category, 'amount', x.amount, 'claim_date', x.claim_date)
                              order by x.claim_date), '[]'::jsonb),
           coalesce(sum(x.amount), 0)
      into v_reimb, v_reimb_total
    from public.hr_reimbursements x where x.payroll_run_id = p_id and x.employee_id = e.id;

    select coalesce(sum((l ->> 'amount')::numeric) filter (where l ->> 'kind' = 'earning'), 0),
           coalesce(sum((l ->> 'amount')::numeric) filter (where l ->> 'kind' = 'deduction'), 0),
           coalesce(sum((l ->> 'amount')::numeric) filter (where l ->> 'kind' = 'employer_contribution'), 0)
      into v_earn, v_ded, v_employer
    from jsonb_each(v_lines) j(k, l);
    v_earn := v_earn + v_adj_pos;
    v_ded := v_ded + v_adj_neg;
    v_net := v_earn - v_ded + v_reimb_total;

    insert into public.hr_payroll_items (run_id, employee_id, structure_id, currency, working_days, payable_days, lop_days,
                                         gross, total_deductions, employer_contributions, reimbursements, net, breakdown)
    values (p_id, e.id, v_structure, v_currency, v_wd, v_payable, v_lop, v_earn, v_ded, v_employer, v_reimb_total, v_net,
      jsonb_build_object(
        'earnings', coalesce((select jsonb_agg(l order by l ->> 'code') from jsonb_each(v_lines) j(k, l) where l ->> 'kind' = 'earning'), '[]'::jsonb),
        'deductions', coalesce((select jsonb_agg(l order by l ->> 'code') from jsonb_each(v_lines) j(k, l) where l ->> 'kind' = 'deduction'), '[]'::jsonb),
        'employer_contributions', coalesce((select jsonb_agg(l order by l ->> 'code') from jsonb_each(v_lines) j(k, l) where l ->> 'kind' = 'employer_contribution'), '[]'::jsonb),
        'adjustments', v_adj,
        'reimbursements', v_reimb,
        'segments', v_segments,
        'skipped_unverified', coalesce((select jsonb_agg(distinct x) from jsonb_array_elements(v_skipped) x), '[]'::jsonb),
        'proration_basis', v_basis,
        'lop_from_attendance', v_att,
        'working_days', v_wd, 'payable_days', v_payable, 'lop_days', v_lop,
        'employment_window', jsonb_build_object('from', v_ws, 'to', v_we)));
    v_count := v_count + 1;
    v_tot_gross := v_tot_gross + v_earn; v_tot_ded := v_tot_ded + v_ded; v_tot_net := v_tot_net + v_net;
  end loop;

  update public.hr_payroll_runs set status = 'calculated', calculated_by = auth.uid(), calculated_at = now(),
         reviewed_by = null, reviewed_at = null
   where id = p_id;
  return jsonb_build_object('run_id', p_id, 'employees', v_count, 'gross', v_tot_gross, 'deductions', v_tot_ded, 'net', v_tot_net);
end $$;

create or replace function public.hr_add_payroll_adjustment(p_run_id uuid, p_employee uuid, p_amount numeric, p_reason text,
                                                            p_label text default null, p_component uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare run public.hr_payroll_runs; v_id uuid;
begin
  if not hr_private.has_permission('payroll.manage') then
    perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden');
  end if;
  select * into run from public.hr_payroll_runs where id = p_run_id for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status not in ('draft','calculated','reviewed') then
    perform hr_private.fail('Adjustments can only be added before the run is approved.', 'run_locked');
  end if;
  if not exists (select 1 from public.hr_employees where id = p_employee) then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if p_amount is null or p_amount = 0 then perform hr_private.fail('Adjustment amount cannot be zero.', 'invalid_amount'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('A reason is required.', 'reason_required'); end if;
  insert into public.hr_payroll_adjustments (run_id, employee_id, component_id, label, amount, reason, source)
  values (p_run_id, p_employee, p_component,
          coalesce(nullif(btrim(p_label), ''), case when p_amount > 0 then 'Additional earning' else 'Additional deduction' end),
          round(p_amount, 2), btrim(p_reason), 'manual')
  returning id into v_id;
  -- Any change after calculation requires recalculation.
  if run.status <> 'draft' then
    update public.hr_payroll_runs set status = 'draft', reviewed_by = null, reviewed_at = null where id = p_run_id;
  end if;
  return v_id;
end $$;

create or replace function public.hr_review_payroll_run(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run public.hr_payroll_runs;
begin
  if not (hr_private.has_permission('payroll.manage') or hr_private.has_permission('payroll.approve')) then
    perform hr_private.fail('You are not allowed to review payroll.', 'forbidden');
  end if;
  select * into run from public.hr_payroll_runs where id = p_id for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status <> 'calculated' then perform hr_private.fail('Only calculated runs can be marked reviewed.', 'invalid_state'); end if;
  update public.hr_payroll_runs set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(),
         notes = coalesce(nullif(btrim(p_note), ''), notes)
   where id = p_id returning * into run;
  return to_jsonb(run);
end $$;

create or replace function hr_private.payroll_check_separation(run public.hr_payroll_runs)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce((hr_private.setting('payroll') ->> 'require_separate_approver')::boolean, true)
     and (auth.uid() = run.created_by or auth.uid() = run.calculated_by) then
    perform hr_private.fail('Payroll must be approved by a different person than the one who prepared it.', 'separation_of_duties');
  end if;
end $$;

create or replace function public.hr_approve_payroll_run(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run public.hr_payroll_runs;
begin
  if not hr_private.has_permission('payroll.approve') then
    perform hr_private.fail('You are not allowed to approve payroll.', 'forbidden');
  end if;
  select * into run from public.hr_payroll_runs where id = p_id for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status <> 'reviewed' then perform hr_private.fail('Only reviewed runs can be approved (status: ' || run.status || ').', 'invalid_state'); end if;
  perform hr_private.payroll_check_separation(run);
  update public.hr_payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_id returning * into run;
  return to_jsonb(run);
end $$;

create or replace function public.hr_finalize_payroll_run(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run public.hr_payroll_runs; r record; v_count int := 0;
begin
  if not hr_private.has_permission('payroll.approve') then
    perform hr_private.fail('You are not allowed to finalize payroll.', 'forbidden');
  end if;
  select * into run from public.hr_payroll_runs where id = p_id for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status <> 'approved' then perform hr_private.fail('Only approved runs can be finalized (status: ' || run.status || ').', 'invalid_state'); end if;
  perform hr_private.payroll_check_separation(run);
  update public.hr_payroll_runs set status = 'finalized', finalized_by = auth.uid(), finalized_at = now()
   where id = p_id returning * into run;
  for r in
    insert into public.hr_payslips (run_id, employee_id, period_start, period_end, currency, working_days, payable_days, lop_days,
                                    gross, total_deductions, reimbursements, net, breakdown, published_at)
    select i.run_id, i.employee_id, run.period_start, run.period_end, i.currency, i.working_days, i.payable_days, i.lop_days,
           i.gross, i.total_deductions, i.reimbursements, i.net,
           i.breakdown || jsonb_build_object(
             'employee', jsonb_build_object('employee_code', e.employee_code,
                                            'name', coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
                                            'department', (select d.name from public.hr_departments d where d.id = e.department_id),
                                            'designation', (select g.name from public.hr_designations g where g.id = e.designation_id)),
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
  return to_jsonb(run) || jsonb_build_object('payslips', v_count);
end $$;

-- Records that payment happened outside the system. NEVER initiates a payment.
create or replace function public.hr_mark_payroll_paid(p_id uuid, p_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run public.hr_payroll_runs;
begin
  if not hr_private.has_permission('payroll.approve') then
    perform hr_private.fail('You are not allowed to mark payroll as paid.', 'forbidden');
  end if;
  select * into run from public.hr_payroll_runs where id = p_id for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status <> 'finalized' then perform hr_private.fail('Only finalized runs can be marked as paid.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reference, ''))) < 3 then
    perform hr_private.fail('Enter the bank / payment reference for this payout.', 'reference_required');
  end if;
  update public.hr_payroll_runs set status = 'paid', paid_by = auth.uid(), paid_at = now(), payment_reference = btrim(p_reference)
   where id = p_id returning * into run;
  update public.hr_reimbursements set status = 'paid' where payroll_run_id = p_id and status = 'approved';
  return to_jsonb(run);
end $$;

-- Post-finalization correction: never edits finalized data; records an
-- adjustment for the NEXT open run (or parks it until the next run is calculated).
create or replace function public.hr_create_payroll_correction(p_run_id uuid, p_employee uuid, p_amount numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare src public.hr_payroll_runs; nxt public.hr_payroll_runs; a public.hr_payroll_adjustments;
begin
  if not hr_private.has_permission('payroll.manage') then
    perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden');
  end if;
  select * into src from public.hr_payroll_runs where id = p_run_id;
  if src.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if src.status not in ('finalized','paid') then
    perform hr_private.fail('Corrections apply to finalized runs only; add an adjustment to an open run instead.', 'invalid_state');
  end if;
  if not exists (select 1 from public.hr_payroll_items where run_id = p_run_id and employee_id = p_employee) then
    perform hr_private.fail('This employee was not part of that payroll run.', 'not_in_run');
  end if;
  if p_amount is null or p_amount = 0 then perform hr_private.fail('Correction amount cannot be zero.', 'invalid_amount'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('A reason is required.', 'reason_required'); end if;
  select * into nxt from public.hr_payroll_runs
  where period_start > src.period_end and status in ('draft','calculated')
  order by period_start limit 1
  for update;
  insert into public.hr_payroll_adjustments (run_id, employee_id, label, amount, reason, source, source_run_id)
  values (nxt.id, p_employee,
          'Correction for ' || to_char(src.period_start, 'DD Mon YYYY') || ' - ' || to_char(src.period_end, 'DD Mon YYYY'),
          round(p_amount, 2), btrim(p_reason), 'correction', src.id)
  returning * into a;
  if nxt.id is not null and nxt.status <> 'draft' then
    update public.hr_payroll_runs set status = 'draft', reviewed_by = null, reviewed_at = null where id = nxt.id;
  end if;
  perform hr_private.audit_event('PAYROLL_CORRECTION', 'hr_payroll_adjustments', a.id::text,
    jsonb_build_object('source_run_id', src.id, 'target_run_id', nxt.id, 'employee_id', p_employee));
  return to_jsonb(a);
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

revoke execute on function public.hr_verify_salary_component(uuid, text), public.hr_my_bank_accounts(),
  public.hr_submit_reimbursement(date, text, numeric, text, text), public.hr_decide_reimbursement(uuid, boolean, text),
  public.hr_create_payroll_run(date, date, text), public.hr_calculate_payroll_run(uuid),
  public.hr_add_payroll_adjustment(uuid, uuid, numeric, text, text, uuid), public.hr_review_payroll_run(uuid, text),
  public.hr_approve_payroll_run(uuid), public.hr_finalize_payroll_run(uuid), public.hr_mark_payroll_paid(uuid, text),
  public.hr_create_payroll_correction(uuid, uuid, numeric, text) from anon, public;
grant execute on function public.hr_verify_salary_component(uuid, text), public.hr_my_bank_accounts(),
  public.hr_submit_reimbursement(date, text, numeric, text, text), public.hr_decide_reimbursement(uuid, boolean, text),
  public.hr_create_payroll_run(date, date, text), public.hr_calculate_payroll_run(uuid),
  public.hr_add_payroll_adjustment(uuid, uuid, numeric, text, text, uuid), public.hr_review_payroll_run(uuid, text),
  public.hr_approve_payroll_run(uuid), public.hr_finalize_payroll_run(uuid), public.hr_mark_payroll_paid(uuid, text),
  public.hr_create_payroll_correction(uuid, uuid, numeric, text) to authenticated;

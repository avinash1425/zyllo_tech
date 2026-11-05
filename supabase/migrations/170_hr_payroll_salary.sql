-- =====================================================================
-- 170_hr_payroll_salary.sql — Module 7: Payroll & Salary (enhancement)
-- =====================================================================
-- Extends 105_hr_payroll.sql. Nothing is duplicated: the same runs, items,
-- adjustments, payslips and structures are used, with these additions:
--
--  SECURITY (audit finding P4 and related paths)
--  * No payroll user can create/change their OWN salary structure, structure
--    components, bank account, payroll identifiers or statutory enrolment
--    (RESTRICTIVE RLS policies + trigger checks), nor add an adjustment or a
--    correction for themselves, nor decide their own adjustment/correction.
--  * A run cannot be approved or finalized by anyone who created an
--    adjustment in it, or whose own pay is changed by an adjustment in it.
--  * Salary structures follow maker-checker: draft -> pending_approval ->
--    active (approved by a payroll.approve holder who is neither the subject
--    nor the preparer). Approved structures are immutable; changes are
--    revisions with their own effective dates (history preserved).
--
--  FUNCTIONALITY
--  * Components: fixed/variable, category, tax treatment (default
--    "not_configured" — no statutory assumption), employment-type eligibility,
--    effective dates, per-entry approval for variable pay.
--  * Adjustments: pending/approved/rejected, duplicate prevention.
--  * Statutory rules (EPF/ESI/PT/TDS/...): effective-dated, jurisdiction,
--    wage base, ceiling, eligibility threshold, employee/employer split,
--    slabs, rounding. NO rates are seeded. A rule is applied only after a
--    payroll.approve holder (not the preparer) records the professional
--    validation reference. Each applied line stores its calculation basis.
--  * Runs: optional legal-entity scope, payroll holds, validation errors /
--    warnings, return-for-correction, payment tracking per employee
--    (pending/processing/paid/partially_paid/failed/reconciled). A run is
--    marked paid only when every payment is paid. Nothing initiates a payment.
--  * Final-settlement coverage (prevents paying the same days twice).
--  * Correction requests (employee query or payroll-raised) with maker-checker,
--    applied as correction adjustments in the next run (finalized data untouched).
--  * Overview, statutory report, post-finalization change report, export audit,
--    employee self-service RPCs.
--
--  MONEY / ROUNDING RULES (documented here and in docs/hrms/PAYROLL_MODULE7.md)
--  * All money is numeric (exact decimal), never float.
--  * Each payslip line is rounded once to 2 decimals, half away from zero
--    (PostgreSQL round(numeric, 2)); totals are sums of rounded lines, so a
--    payslip always adds up exactly.
--  * Statutory lines use the rule's own rounding_mode (half_up | up | down)
--    and precision (0 or 2), as configured and validated.
--
-- Depends on 100, 101, 103, 105, 110, 113. Calls hr_private.payroll_lop_days
-- (owned by Leave; signature (uuid, date, date, boolean) -> numeric).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

update public.hr_settings
   set value = jsonb_build_object(
         'require_structure_approval', true,           -- salary structures need maker-checker approval
         'employee_can_view_salary_structure', true,   -- My Salary in the employee portal
         'money_rounding', 'line_half_up_2dp'          -- informational; see header
       ) || value
 where key = 'payroll';

-- ---------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------
create or replace function hr_private.round_money(p_value numeric, p_mode text default 'half_up', p_precision int default 2)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when p_value is null then null
    when p_mode = 'up'   then round(ceil(p_value * power(10::numeric, p_precision)) / power(10::numeric, p_precision), p_precision)
    when p_mode = 'down' then round(floor(p_value * power(10::numeric, p_precision)) / power(10::numeric, p_precision), p_precision)
    else round(p_value, p_precision) end
$$;

create or replace function hr_private.payroll_cfg_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((hr_private.setting('payroll') ->> p_key)::boolean, p_default)
$$;

create or replace function hr_private.payroll_assert_not_self(p_employee uuid, p_what text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_employee is not null and p_employee = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot ' || p_what || ' for yourself. Another authorised payroll user must do this.', 'self_action');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Salary components: allowance / deduction configuration
-- ---------------------------------------------------------------------
alter table public.hr_salary_components
  add column component_type            text not null default 'fixed' check (component_type in ('fixed','variable')),
  add column category                  text not null default 'allowance'
             check (category in ('basic','allowance','bonus','incentive','reimbursement','statutory','recovery','advance','loan','other_deduction','employer_cost','other')),
  add column tax_treatment             text not null default 'not_configured' check (tax_treatment in ('taxable','exempt','partially_exempt','not_configured')),
  add column tax_note                  text check (tax_note is null or length(tax_note) <= 2000),
  add column eligible_employment_types text[],
  add column effective_from            date,
  add column effective_to              date,
  add column requires_approval         boolean not null default false,
  add column calculation_note          text check (calculation_note is null or length(calculation_note) <= 2000),
  add constraint hr_salary_components_effective check (effective_from is null or effective_to is null or effective_to >= effective_from);

update public.hr_salary_components set category = case
    when code = 'BASIC' then 'basic'
    when kind = 'deduction' then 'other_deduction'
    when kind = 'employer_contribution' then 'employer_cost'
    else 'allowance' end;

insert into public.hr_salary_components (code, name, kind, calc_type, default_value, sort_order, component_type, category, requires_approval, active, is_statutory, statutory_note) values
  ('CONVEYANCE',       'Conveyance Allowance',          'earning',   'fixed',  null,  4, 'fixed',    'allowance',  false, true,  false, null),
  ('OTHER_ALLOWANCE',  'Other Fixed Allowance',         'earning',   'fixed',  null,  5, 'fixed',    'allowance',  false, true,  false, null),
  ('VARIABLE_PAY',     'Variable Allowance',            'earning',   'manual', null, 20, 'variable', 'allowance',  true,  true,  false, null),
  ('BONUS',            'Bonus',                         'earning',   'manual', null, 21, 'variable', 'bonus',      true,  false, false, null),
  ('INCENTIVE',        'Incentive',                     'earning',   'manual', null, 22, 'variable', 'incentive',  true,  false, false, null),
  ('SALARY_RECOVERY',  'Authorised Recovery',           'deduction', 'manual', null, 51, 'variable', 'recovery',   true,  true,  false, null),
  ('ADVANCE_RECOVERY', 'Salary Advance Recovery',       'deduction', 'manual', null, 52, 'variable', 'advance',    true,  false, false, null),
  -- Labels for lines produced by statutory RULES (calculated there, never entered by hand).
  ('PF_EMPLOYEE',      'Provident Fund (employee)',      'deduction',             'manual', null, 60, 'fixed', 'statutory', false, true, true, 'Calculated by the EPF statutory rule after professional validation.'),
  ('PF_EMPLOYER',      'Provident Fund (employer)',      'employer_contribution', 'manual', null, 61, 'fixed', 'statutory', false, true, true, 'Calculated by the EPF statutory rule after professional validation.'),
  ('ESI_EMPLOYEE',     'State Insurance (employee)',     'deduction',             'manual', null, 62, 'fixed', 'statutory', false, true, true, 'Calculated by the ESI statutory rule after professional validation.'),
  ('ESI_EMPLOYER',     'State Insurance (employer)',     'employer_contribution', 'manual', null, 63, 'fixed', 'statutory', false, true, true, 'Calculated by the ESI statutory rule after professional validation.'),
  ('PROFESSIONAL_TAX', 'Professional Tax',               'deduction',             'manual', null, 64, 'fixed', 'statutory', false, true, true, 'Calculated by the PT statutory rule (state slabs) after professional validation.'),
  ('TDS',              'Income Tax (TDS)',               'deduction',             'manual', null, 65, 'fixed', 'statutory', false, true, true, 'Monthly amount from the employee''s tax computation, applied by the TDS rule.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Statutory rules (no legal rates are seeded)
-- ---------------------------------------------------------------------
create table public.hr_payroll_statutory_rules (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null check (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  name                    text not null check (length(btrim(name)) between 2 and 160),
  scheme                  text not null check (scheme in ('provident_fund','state_insurance','professional_tax','income_tax','labour_welfare_fund','other')),
  country                 text not null default 'IN' check (country ~ '^[A-Z]{2}$'),
  state_code              text check (state_code is null or state_code ~ '^[A-Z0-9]{2,3}$'),
  legal_entity_id         uuid references public.hr_legal_entities(id) on delete restrict,
  effective_from          date not null,
  effective_to            date,
  calc_method             text not null check (calc_method in ('percent_of_wage','slab','fixed','employee_declared')),
  wage_base_components    text[] not null default '{}',
  wage_ceiling            numeric(14,2) check (wage_ceiling is null or wage_ceiling >= 0),
  eligibility_wage_max    numeric(14,2) check (eligibility_wage_max is null or eligibility_wage_max >= 0),
  eligibility_basis       text not null default 'wage_base' check (eligibility_basis in ('wage_base','gross')),
  employee_rate           numeric(7,4) check (employee_rate is null or employee_rate between 0 and 100),
  employer_rate           numeric(7,4) check (employer_rate is null or employer_rate between 0 and 100),
  employee_amount         numeric(14,2) check (employee_amount is null or employee_amount >= 0),
  employer_amount         numeric(14,2) check (employer_amount is null or employer_amount >= 0),
  slabs                   jsonb not null default '[]'::jsonb check (jsonb_typeof(slabs) = 'array'),
  employee_component_code text references public.hr_salary_components(code) on update cascade on delete restrict,
  employer_component_code text references public.hr_salary_components(code) on update cascade on delete restrict,
  rounding_mode           text not null default 'half_up' check (rounding_mode in ('half_up','up','down')),
  rounding_precision      smallint not null default 2 check (rounding_precision in (0, 2)),
  applies_to              text not null default 'enrolled' check (applies_to in ('all','enrolled')),
  status                  text not null default 'draft' check (status in ('draft','pending_validation','approved','retired')),
  legal_reference         text check (legal_reference is null or length(legal_reference) <= 2000),
  validation_reference    text check (validation_reference is null or length(validation_reference) <= 500),
  prepared_by             uuid,
  submitted_at            timestamptz,
  validated_by            uuid,
  validated_at            timestamptz,
  return_reason           text check (return_reason is null or length(return_reason) <= 1000),
  notes                   text check (notes is null or length(notes) <= 2000),
  created_by              uuid default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  constraint hr_payroll_statutory_rules_no_overlap exclude using gist (
    code with =, (coalesce(state_code, '')) with =,
    (coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    daterange(effective_from, effective_to, '[]') with &&) where (status = 'approved')
);
select hr_private.secure_table('public.hr_payroll_statutory_rules');
select hr_private.enable_audit('public.hr_payroll_statutory_rules');
create policy hr_payroll_statutory_rules_read on public.hr_payroll_statutory_rules for select to authenticated using (hr_private.has_permission('payroll.view'));
create policy hr_payroll_statutory_rules_insert on public.hr_payroll_statutory_rules for insert to authenticated with check (hr_private.has_permission('payroll.manage'));
create policy hr_payroll_statutory_rules_update on public.hr_payroll_statutory_rules for update to authenticated
  using (hr_private.has_permission('payroll.manage')) with check (hr_private.has_permission('payroll.manage'));
-- No delete: retire instead.

create or replace function hr_private.statutory_rules_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_keys text[] := array['status','effective_to','updated_at','prepared_by','submitted_at','validated_by','validated_at','validation_reference','return_reason'];
begin
  new.updated_at := now();
  if hr_private.is_privileged_write() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.validated_by := null; new.validated_at := null; new.validation_reference := null;
    new.submitted_at := null; new.return_reason := null; new.prepared_by := auth.uid(); new.created_by := auth.uid();
    return new;
  end if;
  -- Validation fields only change through the workflow RPCs.
  new.validated_by := old.validated_by; new.validated_at := old.validated_at; new.validation_reference := old.validation_reference;
  new.submitted_at := old.submitted_at; new.return_reason := old.return_reason; new.created_by := old.created_by;
  if old.status = 'retired' then
    perform hr_private.fail('Retired statutory rules cannot be changed.', 'rule_locked');
  elsif old.status = 'approved' then
    if (to_jsonb(new) - v_keys) is distinct from (to_jsonb(old) - v_keys) or new.status not in ('approved','retired')
       or (new.effective_to is distinct from old.effective_to and (new.effective_to is null or new.effective_to < new.effective_from)) then
      perform hr_private.fail('Approved statutory rules cannot be edited. End-date or retire it and create a new version with a later effective date.', 'rule_locked');
    end if;
    new.prepared_by := old.prepared_by;
  else
    -- draft / pending_validation: any edit returns the rule to draft (re-validation needed).
    if new.status not in ('draft','retired') then
      perform hr_private.fail('Statutory rules are submitted and approved through the validation workflow.', 'use_workflow');
    end if;
    if new.status = 'draft' then new.submitted_at := null; end if;
    new.prepared_by := auth.uid();
  end if;
  return new;
end $$;
create trigger hr_payroll_statutory_rules_guard before insert or update on public.hr_payroll_statutory_rules
  for each row execute function hr_private.statutory_rules_guard();

create or replace function hr_private.payroll_managed_codes()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}'::text[]) from (
    select employee_component_code x from public.hr_payroll_statutory_rules where status <> 'retired'
    union all
    select employer_component_code from public.hr_payroll_statutory_rules where status <> 'retired') t
  where x is not null
$$;

-- Templates ONLY: no rates, ceilings, thresholds or slabs. They cannot be
-- submitted until configured, and are never applied until validated.
insert into public.hr_payroll_statutory_rules
  (code, name, scheme, effective_from, calc_method, wage_base_components, employee_component_code, employer_component_code, applies_to, eligibility_basis, notes) values
  ('EPF', 'Employees'' Provident Fund — template', 'provident_fund',  date '2026-04-01', 'percent_of_wage', '{BASIC}', 'PF_EMPLOYEE', 'PF_EMPLOYER', 'enrolled', 'wage_base',
   'TEMPLATE. Configure the wage base, contribution rates, wage ceiling, employer split and eligibility from current law and have them validated by a qualified professional before submitting.'),
  ('ESI', 'Employees'' State Insurance — template', 'state_insurance', date '2026-04-01', 'percent_of_wage', '{}',      'ESI_EMPLOYEE', 'ESI_EMPLOYER', 'enrolled', 'gross',
   'TEMPLATE. Configure the wage base, rates and the wage eligibility threshold from current notifications and have them validated before submitting.'),
  ('PT',  'Professional Tax — template (per state)', 'professional_tax', date '2026-04-01', 'slab',          '{}',      'PROFESSIONAL_TAX', null, 'enrolled', 'gross',
   'TEMPLATE. Create one version per state (state code) with that state''s slabs; set the employee''s state on their statutory enrolment. Validate before submitting.'),
  ('TDS', 'Income Tax (TDS) — employee-declared monthly amount', 'income_tax', date '2026-04-01', 'employee_declared', '{}', 'TDS', null, 'enrolled', 'gross',
   'TEMPLATE. The monthly TDS amount comes from each employee''s tax computation (entered on the statutory enrolment). This system does not compute income tax.');

-- Employee statutory enrolment (eligibility, jurisdiction, declared amounts)
create table public.hr_payroll_statutory_enrollments (
  id                      uuid primary key default gen_random_uuid(),
  employee_id             uuid not null references public.hr_employees(id) on delete restrict,
  rule_code               text not null check (rule_code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  enrolled                boolean not null default true,
  state_code              text check (state_code is null or state_code ~ '^[A-Z0-9]{2,3}$'),
  declared_monthly_amount numeric(14,2) check (declared_monthly_amount is null or declared_monthly_amount >= 0),
  effective_from          date not null,
  effective_to            date,
  note                    text check (note is null or length(note) <= 1000),
  updated_by              uuid default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  constraint hr_payroll_statutory_enrollments_no_overlap exclude using gist (
    employee_id with =, rule_code with =, daterange(effective_from, effective_to, '[]') with &&)
);
select hr_private.secure_table('public.hr_payroll_statutory_enrollments');
select hr_private.enable_audit('public.hr_payroll_statutory_enrollments', array['declared_monthly_amount']);
create or replace function hr_private.statutory_enrollments_touch()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger hr_payroll_statutory_enrollments_touch before insert or update on public.hr_payroll_statutory_enrollments
  for each row execute function hr_private.statutory_enrollments_touch();
create policy hr_payroll_statutory_enrollments_read on public.hr_payroll_statutory_enrollments for select to authenticated using (hr_private.has_permission('payroll.view'));
create policy hr_payroll_statutory_enrollments_insert on public.hr_payroll_statutory_enrollments for insert to authenticated with check (hr_private.has_permission('payroll.manage'));
create policy hr_payroll_statutory_enrollments_update on public.hr_payroll_statutory_enrollments for update to authenticated
  using (hr_private.has_permission('payroll.manage')) with check (hr_private.has_permission('payroll.manage'));
create policy hr_payroll_statutory_enrollments_delete on public.hr_payroll_statutory_enrollments for delete to authenticated using (hr_private.has_permission('payroll.manage'));
create policy hr_payroll_statutory_enrollments_not_self_ins on public.hr_payroll_statutory_enrollments as restrictive for insert to authenticated
  with check (employee_id is distinct from hr_private.current_employee_id());
create policy hr_payroll_statutory_enrollments_not_self_upd on public.hr_payroll_statutory_enrollments as restrictive for update to authenticated
  using (employee_id is distinct from hr_private.current_employee_id()) with check (employee_id is distinct from hr_private.current_employee_id());
create policy hr_payroll_statutory_enrollments_not_self_del on public.hr_payroll_statutory_enrollments as restrictive for delete to authenticated
  using (employee_id is distinct from hr_private.current_employee_id());

create or replace function public.hr_submit_statutory_rule(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_payroll_statutory_rules; v_bad text;
begin
  if not hr_private.has_permission('payroll.manage') then perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden'); end if;
  select * into r from public.hr_payroll_statutory_rules where id = p_id for update;
  if r.id is null then perform hr_private.fail('Statutory rule not found.', 'not_found'); end if;
  if r.status <> 'draft' then perform hr_private.fail('Only draft rules can be submitted for validation.', 'invalid_state'); end if;
  if r.calc_method = 'percent_of_wage' then
    if cardinality(r.wage_base_components) = 0 then perform hr_private.fail('Choose the earning components that make up the wage base.', 'config_incomplete'); end if;
    if r.employee_rate is null and r.employer_rate is null then perform hr_private.fail('Enter the employee and/or employer contribution rate.', 'config_incomplete'); end if;
  elsif r.calc_method = 'slab' then
    if jsonb_array_length(r.slabs) = 0 then perform hr_private.fail('Add at least one slab.', 'config_incomplete'); end if;
    if exists (select 1 from jsonb_array_elements(r.slabs) x(v)
               where jsonb_typeof(x.v) <> 'object' or (x.v ->> 'from') is null
                  or coalesce((x.v ->> 'from')::numeric, -1) < 0
                  or ((x.v ->> 'to') is not null and (x.v ->> 'to')::numeric < (x.v ->> 'from')::numeric)) then
      perform hr_private.fail('Each slab needs a "from" amount (and a "to" amount not below it).', 'config_incomplete');
    end if;
    if r.wage_base_components = '{}' and r.eligibility_basis = 'wage_base' then
      perform hr_private.fail('Slabs are looked up on the wage base; choose its components (or set the basis to gross).', 'config_incomplete');
    end if;
  elsif r.calc_method = 'fixed' then
    if r.employee_amount is null and r.employer_amount is null then perform hr_private.fail('Enter the fixed employee and/or employer amount.', 'config_incomplete'); end if;
  end if;
  select string_agg(x, ', ') into v_bad from unnest(r.wage_base_components) x
   where not exists (select 1 from public.hr_salary_components k where k.code = x and k.kind = 'earning');
  if v_bad is not null then perform hr_private.fail('Wage base components must be earning components: ' || v_bad || '.', 'config_incomplete'); end if;
  if r.employee_component_code is not null and not exists (select 1 from public.hr_salary_components where code = r.employee_component_code and kind = 'deduction') then
    perform hr_private.fail('The employee component must be a deduction component.', 'config_incomplete');
  end if;
  if r.employer_component_code is not null and not exists (select 1 from public.hr_salary_components where code = r.employer_component_code and kind = 'employer_contribution') then
    perform hr_private.fail('The employer component must be an employer-contribution component.', 'config_incomplete');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_payroll_statutory_rules set status = 'pending_validation', submitted_at = now(), prepared_by = auth.uid(), return_reason = null
   where id = p_id returning * into r;
  perform set_config('hr.privileged_write', 'off', true);
  perform hr_private.notify_permission_holders('payroll.approve', 'payroll.statutory_submitted', 'Statutory rule awaiting validation',
    'Statutory rule ' || r.code || ' is waiting for professional validation.', '/hr/payroll?tab=statutory', 'hr_payroll_statutory_rules', r.id::text);
  return to_jsonb(r);
end $$;

create or replace function public.hr_approve_statutory_rule(p_id uuid, p_validation_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_payroll_statutory_rules;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to approve statutory rules.', 'forbidden'); end if;
  select * into r from public.hr_payroll_statutory_rules where id = p_id for update;
  if r.id is null then perform hr_private.fail('Statutory rule not found.', 'not_found'); end if;
  if r.status <> 'pending_validation' then perform hr_private.fail('Only rules pending validation can be approved.', 'invalid_state'); end if;
  if auth.uid() = r.prepared_by or auth.uid() = r.created_by then
    perform hr_private.fail('A statutory rule must be approved by a different person from the one who prepared it.', 'separation_of_duties');
  end if;
  if length(btrim(coalesce(p_validation_reference, ''))) < 5 then
    perform hr_private.fail('Record who validated this rule professionally and the reference (e.g. consultant name, date, document).', 'validation_reference_required');
  end if;
  if exists (select 1 from public.hr_payroll_statutory_rules x where x.status = 'approved' and x.id <> r.id and x.code = r.code
              and coalesce(x.state_code, '') = coalesce(r.state_code, '')
              and x.legal_entity_id is not distinct from r.legal_entity_id
              and daterange(x.effective_from, x.effective_to, '[]') && daterange(r.effective_from, r.effective_to, '[]')) then
    perform hr_private.fail('An approved version of this rule overlaps these dates. End-date the existing version first.', 'overlap');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_payroll_statutory_rules set status = 'approved', validated_by = auth.uid(), validated_at = now(),
         validation_reference = btrim(p_validation_reference)
   where id = p_id returning * into r;
  perform set_config('hr.privileged_write', 'off', true);
  perform hr_private.audit_event('STATUTORY_RULE_APPROVED', 'hr_payroll_statutory_rules', r.id::text,
    jsonb_build_object('code', r.code, 'state_code', r.state_code, 'effective_from', r.effective_from));
  return to_jsonb(r);
end $$;

create or replace function public.hr_return_statutory_rule(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_payroll_statutory_rules;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to validate statutory rules.', 'forbidden'); end if;
  select * into r from public.hr_payroll_statutory_rules where id = p_id for update;
  if r.id is null then perform hr_private.fail('Statutory rule not found.', 'not_found'); end if;
  if r.status <> 'pending_validation' then perform hr_private.fail('Only rules pending validation can be returned.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason for returning the rule.', 'reason_required'); end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_payroll_statutory_rules set status = 'draft', submitted_at = null, return_reason = btrim(p_reason) where id = p_id returning * into r;
  perform set_config('hr.privileged_write', 'off', true);
  return to_jsonb(r);
end $$;

-- Component eligibility for a given date / employment type.
create or replace function hr_private.component_applies(p_comp public.hr_salary_components, p_on date, p_employment_type text, p_managed text[])
returns boolean language sql stable set search_path = '' as $$
  select p_comp.active and not p_comp.requires_verification
     and (p_comp.effective_from is null or p_comp.effective_from <= p_on)
     and (p_comp.effective_to is null or p_comp.effective_to >= p_on)
     and (p_comp.eligible_employment_types is null or cardinality(p_comp.eligible_employment_types) = 0
          or p_employment_type = any(p_comp.eligible_employment_types))
     and not (p_comp.code = any(coalesce(p_managed, '{}'::text[])))
$$;

-- ---------------------------------------------------------------------
-- Salary structures: maker-checker, revisions, self-protection
-- ---------------------------------------------------------------------
alter table public.hr_salary_structures
  add column pay_frequency   text not null default 'monthly' check (pay_frequency in ('monthly')),
  add column revision_of     uuid references public.hr_salary_structures(id) on delete restrict,
  add column revision_reason text check (revision_reason is null or length(revision_reason) <= 1000),
  add column submitted_by    uuid,
  add column submitted_at    timestamptz,
  add column approved_by     uuid,
  add column approved_at     timestamptz,
  add column rejected_by     uuid,
  add column rejected_at     timestamptz,
  add column decision_note   text check (decision_note is null or length(decision_note) <= 1000);
alter table public.hr_salary_structures drop constraint hr_salary_structures_status_check;
alter table public.hr_salary_structures add constraint hr_salary_structures_status_check
  check (status in ('draft','pending_approval','active','rejected','archived'));
-- Only APPROVED (active) structures may not overlap; drafts/revisions may.
alter table public.hr_salary_structures drop constraint hr_salary_structures_no_overlap;
alter table public.hr_salary_structures add constraint hr_salary_structures_no_overlap exclude using gist (
  employee_id with =, daterange(effective_from, effective_to, '[]') with &&) where (status = 'active');
update public.hr_salary_structures set approved_at = created_at where status = 'active' and approved_at is null;

create or replace function hr_private.salary_structures_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_me uuid; v_approval boolean;
begin
  if hr_private.is_privileged_write() then return new; end if;
  if not hr_private.has_permission('payroll.manage') then return new; end if;   -- RLS rejects the write
  v_approval := hr_private.payroll_cfg_bool('require_structure_approval', true);
  v_me := hr_private.current_employee_id();
  if v_me is not null and (new.employee_id = v_me or (tg_op = 'UPDATE' and old.employee_id = v_me)) then
    perform hr_private.fail('You cannot create or change your own salary structure. Another payroll user must prepare it and a separate approver must approve it.', 'self_compensation');
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.submitted_by := null; new.submitted_at := null; new.approved_by := null; new.approved_at := null;
    new.rejected_by := null; new.rejected_at := null; new.decision_note := null;
    if v_approval then new.status := 'draft'; end if;
    return new;
  end if;
  if new.employee_id <> old.employee_id then
    perform hr_private.fail('The employee of a salary structure cannot be changed.', 'invalid_change');
  end if;
  if (new.created_by, new.submitted_by, new.submitted_at, new.approved_by, new.approved_at, new.rejected_by, new.rejected_at, new.revision_of, new.decision_note)
     is distinct from (old.created_by, old.submitted_by, old.submitted_at, old.approved_by, old.approved_at, old.rejected_by, old.rejected_at, old.revision_of, old.decision_note) then
    perform hr_private.fail('Approval fields are set by the approval workflow.', 'use_workflow');
  end if;
  if not v_approval then return new; end if;
  if old.status not in ('draft','rejected') then
    perform hr_private.fail('Submitted, approved and archived salary structures cannot be edited. Create a revision instead.', 'structure_locked');
  end if;
  if new.status not in ('draft','rejected','archived') then
    perform hr_private.fail('Salary structures are submitted and approved through the approval workflow.', 'use_workflow');
  end if;
  if old.status = 'rejected' and new.status = 'rejected' then new.status := 'draft'; end if;   -- editing a returned structure reopens it
  return new;
end $$;
create trigger hr_salary_structures_guard before insert or update on public.hr_salary_structures
  for each row execute function hr_private.salary_structures_guard();

create or replace function hr_private.structure_employee(p_structure uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select employee_id from public.hr_salary_structures where id = p_structure
$$;

create or replace function hr_private.salary_structure_items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_salary_structures; v_me uuid; v_code text;
begin
  if hr_private.is_privileged_write() or not hr_private.has_permission('payroll.manage') then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and (new.structure_id <> old.structure_id or new.component_id <> old.component_id) then
    perform hr_private.fail('Remove the component and add the new one instead.', 'invalid_change');
  end if;
  select * into v_s from public.hr_salary_structures where id = coalesce(new.structure_id, old.structure_id);
  v_me := hr_private.current_employee_id();
  if v_me is not null and v_s.employee_id = v_me then
    perform hr_private.fail('You cannot change the components of your own salary structure.', 'self_compensation');
  end if;
  if hr_private.payroll_cfg_bool('require_structure_approval', true) and v_s.status not in ('draft','rejected') then
    perform hr_private.fail('Components can only be changed while the salary structure is a draft. Create a revision to change an approved structure.', 'structure_locked');
  end if;
  if tg_op <> 'DELETE' then
    select code into v_code from public.hr_salary_components where id = new.component_id;
    if v_code = any(hr_private.payroll_managed_codes()) then
      perform hr_private.fail(v_code || ' is calculated by a statutory rule and cannot be added to a salary structure.', 'statutory_component');
    end if;
  end if;
  if v_s.status = 'rejected' then
    perform set_config('hr.privileged_write', 'on', true);
    update public.hr_salary_structures set status = 'draft' where id = v_s.id;
    perform set_config('hr.privileged_write', 'off', true);
  end if;
  return coalesce(new, old);
end $$;
create trigger hr_salary_structure_items_guard before insert or update or delete on public.hr_salary_structure_items
  for each row execute function hr_private.salary_structure_items_guard();

create policy hr_salary_structures_not_self_ins on public.hr_salary_structures as restrictive for insert to authenticated
  with check (employee_id is distinct from hr_private.current_employee_id());
create policy hr_salary_structures_not_self_upd on public.hr_salary_structures as restrictive for update to authenticated
  using (employee_id is distinct from hr_private.current_employee_id()) with check (employee_id is distinct from hr_private.current_employee_id());
create policy hr_salary_structure_items_not_self_ins on public.hr_salary_structure_items as restrictive for insert to authenticated
  with check (hr_private.structure_employee(structure_id) is distinct from hr_private.current_employee_id());
create policy hr_salary_structure_items_not_self_upd on public.hr_salary_structure_items as restrictive for update to authenticated
  using (hr_private.structure_employee(structure_id) is distinct from hr_private.current_employee_id())
  with check (hr_private.structure_employee(structure_id) is distinct from hr_private.current_employee_id());
create policy hr_salary_structure_items_not_self_del on public.hr_salary_structure_items as restrictive for delete to authenticated
  using (hr_private.structure_employee(structure_id) is distinct from hr_private.current_employee_id());

-- Monthly (unprorated) breakdown of a structure; shared by preview and My Salary.
create or replace function hr_private.structure_monthly_lines(p_structure uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.hr_salary_structures; v_type text; v_on date; v_managed text[] := hr_private.payroll_managed_codes();
  v_basic numeric; v_pre numeric; v_full numeric; c record; v_amt numeric;
  v_lines jsonb := '[]'::jsonb; v_e numeric := 0; v_d numeric := 0; v_r numeric := 0; v_today date := hr_private.business_today();
begin
  select * into s from public.hr_salary_structures where id = p_structure;
  if s.id is null then return null; end if;
  select employment_type into v_type from public.hr_employees where id = s.employee_id;
  v_on := case when v_today >= s.effective_from and v_today <= coalesce(s.effective_to, v_today) then v_today else s.effective_from end;
  select coalesce(sum(i.amount), 0) into v_basic from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
   where i.structure_id = s.id and k.code = 'BASIC' and hr_private.component_applies(k, v_on, v_type, v_managed);
  select coalesce(sum(case k.calc_type when 'percent_of_basic' then v_basic * coalesce(i.percent, k.default_value, 0) / 100 else coalesce(i.amount, 0) end), 0) into v_pre
    from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
   where i.structure_id = s.id and k.kind = 'earning' and k.calc_type <> 'percent_of_gross' and hr_private.component_applies(k, v_on, v_type, v_managed);
  select v_pre + coalesce(sum(v_pre * coalesce(i.percent, k.default_value, 0) / 100), 0) into v_full
    from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
   where i.structure_id = s.id and k.kind = 'earning' and k.calc_type = 'percent_of_gross' and hr_private.component_applies(k, v_on, v_type, v_managed);
  for c in
    select k.code, k.name, k.kind, k.calc_type, k.component_type, k.active, k.requires_verification, i.amount,
           coalesce(i.percent, k.default_value, 0) pct, hr_private.component_applies(k, v_on, v_type, v_managed) applies,
           k.code = any(v_managed) managed
    from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
    where i.structure_id = s.id order by k.sort_order, k.code
  loop
    v_amt := round(case c.calc_type when 'percent_of_basic' then v_basic * c.pct / 100
                                    when 'percent_of_gross' then v_full * c.pct / 100 else coalesce(c.amount, 0) end, 2);
    v_lines := v_lines || jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind, 'calc_type', c.calc_type,
      'component_type', c.component_type, 'percent', case when c.calc_type like 'percent%' then c.pct end, 'amount', v_amt, 'applied', c.applies,
      'note', case when c.applies then null when not c.active then 'inactive' when c.requires_verification then 'unverified'
                   when c.managed then 'statutory rule' else 'not eligible / not effective' end);
    if c.applies then
      if c.kind = 'earning' then v_e := v_e + v_amt; elsif c.kind = 'deduction' then v_d := v_d + v_amt; else v_r := v_r + v_amt; end if;
    end if;
  end loop;
  return jsonb_build_object('structure_id', s.id, 'as_of', v_on, 'currency', s.currency, 'pay_frequency', s.pay_frequency,
    'basic', v_basic, 'gross', v_e, 'deductions', v_d, 'employer_contributions', v_r, 'net_before_statutory', v_e - v_d,
    'annual_gross', v_e * 12, 'lines', v_lines);
end $$;

create or replace function public.hr_salary_structure_preview(p_structure uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('payroll.view') then perform hr_private.fail('You are not allowed to view payroll.', 'forbidden'); end if;
  return hr_private.structure_monthly_lines(p_structure);
end $$;

create or replace function public.hr_submit_salary_structure(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.hr_salary_structures;
begin
  if not hr_private.has_permission('payroll.manage') then perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden'); end if;
  select * into s from public.hr_salary_structures where id = p_id for update;
  if s.id is null then perform hr_private.fail('Salary structure not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(s.employee_id, 'submit a salary structure');
  if s.status not in ('draft','rejected') then perform hr_private.fail('Only draft or returned structures can be submitted.', 'invalid_state'); end if;
  if not exists (select 1 from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
                 where i.structure_id = s.id and k.kind = 'earning') then
    perform hr_private.fail('Add at least one earning component before submitting.', 'no_components');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_salary_structures set status = 'pending_approval', submitted_by = auth.uid(), submitted_at = now(),
         rejected_by = null, rejected_at = null, decision_note = nullif(btrim(p_note), '')
   where id = p_id returning * into s;
  perform set_config('hr.privileged_write', 'off', true);
  perform hr_private.notify_permission_holders('payroll.approve', 'payroll.structure_submitted', 'Salary structure awaiting approval',
    'A salary structure change is waiting for approval.', '/hr/payroll?tab=structures', 'hr_salary_structures', s.id::text, s.employee_id);
  return to_jsonb(s);
end $$;

create or replace function public.hr_approve_salary_structure(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.hr_salary_structures; prev record; v_ended jsonb := '[]'::jsonb; v_retro boolean;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to approve salary structures.', 'forbidden'); end if;
  select * into s from public.hr_salary_structures where id = p_id for update;
  if s.id is null then perform hr_private.fail('Salary structure not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(s.employee_id, 'approve a salary structure');
  if s.status <> 'pending_approval' then perform hr_private.fail('Only submitted structures can be approved.', 'invalid_state'); end if;
  if hr_private.payroll_cfg_bool('require_separate_approver', true) and (auth.uid() = s.created_by or auth.uid() = s.submitted_by) then
    perform hr_private.fail('A salary structure must be approved by a different person from the one who prepared it.', 'separation_of_duties');
  end if;
  perform pg_advisory_xact_lock(hashtext('hr_salary_structures:' || s.employee_id::text));
  if exists (select 1 from public.hr_salary_structures a where a.employee_id = s.employee_id and a.status = 'active' and a.id <> s.id
              and a.effective_from >= s.effective_from
              and daterange(a.effective_from, a.effective_to, '[]') && daterange(s.effective_from, s.effective_to, '[]')) then
    perform hr_private.fail('This structure overlaps an approved structure that starts on or after ' || to_char(s.effective_from, 'DD Mon YYYY')
      || '. End-date or revise that structure instead.', 'overlap');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  for prev in
    select a.id, a.effective_from, a.effective_to from public.hr_salary_structures a
    where a.employee_id = s.employee_id and a.status = 'active' and a.id <> s.id
      and daterange(a.effective_from, a.effective_to, '[]') && daterange(s.effective_from, s.effective_to, '[]')
  loop
    if s.effective_to is not null and (prev.effective_to is null or prev.effective_to > s.effective_to) then
      perform hr_private.fail('A revision with an end date cannot split an existing structure. Remove the end date or adjust the existing structure.', 'overlap');
    end if;
    update public.hr_salary_structures set effective_to = s.effective_from - 1 where id = prev.id;
    v_ended := v_ended || jsonb_build_object('id', prev.id, 'effective_to', s.effective_from - 1);
  end loop;
  select exists (select 1 from public.hr_payroll_items i join public.hr_payroll_runs r on r.id = i.run_id
                 where i.employee_id = s.employee_id and r.status in ('approved','finalized','paid') and r.period_end >= s.effective_from) into v_retro;
  update public.hr_salary_structures set status = 'active', approved_by = auth.uid(), approved_at = now(),
         decision_note = coalesce(nullif(btrim(p_note), ''), decision_note)
   where id = p_id returning * into s;
  perform set_config('hr.privileged_write', 'off', true);
  perform hr_private.audit_event('SALARY_STRUCTURE_APPROVED', 'hr_salary_structures', s.id::text,
    jsonb_build_object('employee_id', s.employee_id, 'effective_from', s.effective_from, 'ended', v_ended, 'retroactive', v_retro));
  perform hr_private.notify_employee(s.employee_id, 'payroll.salary_revised', 'Salary structure updated',
    'A salary structure effective ' || to_char(s.effective_from, 'DD Mon YYYY') || ' has been approved.', '/employee/payslips', 'hr_salary_structures', s.id::text);
  return to_jsonb(s) || jsonb_build_object('ended_structures', v_ended, 'retroactive', v_retro);
end $$;

create or replace function public.hr_reject_salary_structure(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.hr_salary_structures;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to approve salary structures.', 'forbidden'); end if;
  select * into s from public.hr_salary_structures where id = p_id for update;
  if s.id is null then perform hr_private.fail('Salary structure not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(s.employee_id, 'decide a salary structure');
  if s.status <> 'pending_approval' then perform hr_private.fail('Only submitted structures can be returned.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason for returning the structure.', 'reason_required'); end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_salary_structures set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(), decision_note = btrim(p_reason)
   where id = p_id returning * into s;
  perform set_config('hr.privileged_write', 'off', true);
  perform hr_private.notify_user(s.submitted_by, 'payroll.structure_returned', 'Salary structure returned',
    'A salary structure you submitted was returned: ' || left(btrim(p_reason), 200), '/hr/payroll?tab=structures', 'hr_salary_structures', s.id::text);
  return to_jsonb(s);
end $$;

create or replace function public.hr_create_salary_revision(p_structure uuid, p_effective_from date, p_reason text, p_annual_ctc numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare src public.hr_salary_structures; v_id uuid;
begin
  if not hr_private.has_permission('payroll.manage') then perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden'); end if;
  select * into src from public.hr_salary_structures where id = p_structure;
  if src.id is null then perform hr_private.fail('Salary structure not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(src.employee_id, 'revise a salary structure');
  if src.status <> 'active' then perform hr_private.fail('Only an approved (active) structure can be revised.', 'invalid_state'); end if;
  if p_effective_from is null or p_effective_from <= src.effective_from then
    perform hr_private.fail('The revision must start after ' || to_char(src.effective_from, 'DD Mon YYYY') || '.', 'invalid_date');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason for the revision.', 'reason_required'); end if;
  if p_annual_ctc is not null and p_annual_ctc < 0 then perform hr_private.fail('Annual CTC cannot be negative.', 'invalid_amount'); end if;
  insert into public.hr_salary_structures (employee_id, effective_from, effective_to, annual_ctc, currency, pay_frequency, status, notes, revision_of, revision_reason)
  values (src.employee_id, p_effective_from, null, round(coalesce(p_annual_ctc, src.annual_ctc), 2), src.currency, src.pay_frequency, 'draft', src.notes, src.id, btrim(p_reason))
  returning id into v_id;
  insert into public.hr_salary_structure_items (structure_id, component_id, amount, percent)
  select v_id, i.component_id, i.amount, i.percent from public.hr_salary_structure_items i where i.structure_id = src.id;
  return v_id;
end $$;

create or replace function public.hr_end_salary_structure(p_id uuid, p_effective_to date, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.hr_salary_structures;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to end salary structures.', 'forbidden'); end if;
  select * into s from public.hr_salary_structures where id = p_id for update;
  if s.id is null then perform hr_private.fail('Salary structure not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(s.employee_id, 'end a salary structure');
  if s.status <> 'active' then perform hr_private.fail('Only an active structure can be end-dated.', 'invalid_state'); end if;
  if p_effective_to is null or p_effective_to < s.effective_from then perform hr_private.fail('The end date must be on or after the start date.', 'invalid_date'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason.', 'reason_required'); end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_salary_structures set effective_to = p_effective_to where id = p_id returning * into s;
  perform set_config('hr.privileged_write', 'off', true);
  perform hr_private.audit_event('SALARY_STRUCTURE_ENDED', 'hr_salary_structures', s.id::text,
    jsonb_build_object('employee_id', s.employee_id, 'effective_to', p_effective_to, 'reason', btrim(p_reason)));
  return to_jsonb(s);
end $$;

-- ---------------------------------------------------------------------
-- Bank accounts & payroll identifiers: no self-edit, verification action
-- ---------------------------------------------------------------------
create or replace function hr_private.bank_accounts_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if hr_private.is_privileged_write() then return new; end if;
  if tg_op = 'INSERT' then
    new.verified := false; new.verified_by := null; new.verified_at := null; new.created_by := auth.uid();
    return new;
  end if;
  -- Verification is only set by hr_verify_bank_account(); any change to the account voids it.
  new.verified := old.verified; new.verified_by := old.verified_by; new.verified_at := old.verified_at;
  if (new.account_number, new.ifsc, new.iban, new.swift_code, new.bank_name, new.account_holder)
     is distinct from (old.account_number, old.ifsc, old.iban, old.swift_code, old.bank_name, old.account_holder) then
    new.verified := false; new.verified_by := null; new.verified_at := null;
  end if;
  return new;
end $$;
create trigger hr_employee_bank_accounts_guard before insert or update on public.hr_employee_bank_accounts
  for each row execute function hr_private.bank_accounts_guard();
create policy hr_employee_bank_accounts_not_self_ins on public.hr_employee_bank_accounts as restrictive for insert to authenticated
  with check (employee_id is distinct from hr_private.current_employee_id());
create policy hr_employee_bank_accounts_not_self_upd on public.hr_employee_bank_accounts as restrictive for update to authenticated
  using (employee_id is distinct from hr_private.current_employee_id()) with check (employee_id is distinct from hr_private.current_employee_id());
create policy hr_payroll_employee_identifiers_not_self_ins on public.hr_payroll_employee_identifiers as restrictive for insert to authenticated
  with check (employee_id is distinct from hr_private.current_employee_id());
create policy hr_payroll_employee_identifiers_not_self_upd on public.hr_payroll_employee_identifiers as restrictive for update to authenticated
  using (employee_id is distinct from hr_private.current_employee_id()) with check (employee_id is distinct from hr_private.current_employee_id());

create or replace function public.hr_verify_bank_account(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.hr_employee_bank_accounts;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to verify bank accounts.', 'forbidden'); end if;
  select * into b from public.hr_employee_bank_accounts where id = p_id for update;
  if b.id is null then perform hr_private.fail('Bank account not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(b.employee_id, 'verify a bank account');
  if b.verified then perform hr_private.fail('This account is already verified.', 'already_verified'); end if;
  if b.created_by = auth.uid() then
    perform hr_private.fail('A bank account must be verified by a different person from the one who entered it.', 'separation_of_duties');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employee_bank_accounts set verified = true, verified_by = auth.uid(), verified_at = now() where id = p_id returning * into b;
  perform set_config('hr.privileged_write', 'off', true);
  perform hr_private.audit_event('BANK_ACCOUNT_VERIFIED', 'hr_employee_bank_accounts', b.id::text,
    jsonb_build_object('employee_id', b.employee_id, 'note', nullif(btrim(p_note), '')));
  return jsonb_build_object('id', b.id, 'verified', b.verified, 'verified_at', b.verified_at);
end $$;

-- ---------------------------------------------------------------------
-- Runs: scope, return, validation, payment status
-- ---------------------------------------------------------------------
-- Finalized/paid runs: only payment-tracking columns may change, and status
-- may only move finalized -> paid. Everything else stays frozen.
create or replace function hr_private.payroll_runs_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_keys text[] := array['status','payment_status','paid_by','paid_at','payment_reference','updated_at'];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then perform hr_private.fail('Only draft payroll runs can be deleted.', 'run_locked'); end if;
    return old;
  end if;
  if old.status in ('finalized','paid')
     and ((to_jsonb(new) - v_keys) is distinct from (to_jsonb(old) - v_keys)
          or new.status not in (old.status, 'paid')) then
    perform hr_private.fail('This payroll run is finalized and cannot be changed.', 'run_locked');
  end if;
  new.updated_at := now();
  return new;
end $$;

alter table public.hr_payroll_runs
  add column legal_entity_id uuid references public.hr_legal_entities(id) on delete restrict,
  add column returned_by     uuid,
  add column returned_at     timestamptz,
  add column return_reason   text check (return_reason is null or length(return_reason) <= 1000),
  add column payment_status  text not null default 'not_started'
             check (payment_status in ('not_started','pending','processing','partially_paid','paid','failed','reconciled')),
  add column validation      jsonb not null default '{}'::jsonb;
update public.hr_payroll_runs set payment_status = case status when 'paid' then 'paid' when 'finalized' then 'pending' else 'not_started' end;
alter table public.hr_payroll_runs drop constraint if exists hr_payroll_runs_period_start_period_end_key;
alter table public.hr_payroll_runs drop constraint hr_payroll_runs_no_overlap;
alter table public.hr_payroll_runs add constraint hr_payroll_runs_no_overlap exclude using gist (
  (coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =, daterange(period_start, period_end, '[]') with &&);

-- Employees held out of a run (e.g. disputed pay, pending clearance).
create table public.hr_payroll_run_holds (
  run_id      uuid not null references public.hr_payroll_runs(id) on delete restrict,
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  reason      text not null check (length(btrim(reason)) between 3 and 500),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (run_id, employee_id)
);
select hr_private.secure_table('public.hr_payroll_run_holds');
select hr_private.enable_audit('public.hr_payroll_run_holds');
create policy hr_payroll_run_holds_read on public.hr_payroll_run_holds for select to authenticated using (hr_private.has_permission('payroll.view'));
revoke insert, update, delete, truncate on public.hr_payroll_run_holds from authenticated;

-- Final-settlement coverage: days up to covered_through are paid through the
-- exit's full-and-final settlement, so payroll must not pay them again.
create table public.hr_payroll_settlement_coverage (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.hr_employees(id) on delete restrict,
  exit_id              uuid references public.hr_exits(id) on delete restrict,
  covered_through      date not null,
  settlement_reference text not null check (length(btrim(settlement_reference)) between 3 and 120),
  note                 text check (note is null or length(note) <= 1000),
  status               text not null default 'active' check (status in ('active','void')),
  recorded_by          uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  voided_by            uuid,
  voided_at            timestamptz,
  void_reason          text check (void_reason is null or length(void_reason) <= 1000)
);
create unique index hr_payroll_settlement_coverage_active on public.hr_payroll_settlement_coverage(employee_id) where status = 'active';
select hr_private.secure_table('public.hr_payroll_settlement_coverage');
select hr_private.enable_audit('public.hr_payroll_settlement_coverage');
create policy hr_payroll_settlement_coverage_read on public.hr_payroll_settlement_coverage for select to authenticated using (hr_private.has_permission('payroll.view'));
revoke insert, update, delete, truncate on public.hr_payroll_settlement_coverage from authenticated;

-- ---------------------------------------------------------------------
-- Adjustments: approval, evidence, duplicate prevention
-- ---------------------------------------------------------------------
alter table public.hr_payroll_adjustments
  add column status                text not null default 'approved' check (status in ('pending','approved','rejected')),
  add column decided_by            uuid,
  add column decided_at            timestamptz,
  add column decision_note         text check (decision_note is null or length(decision_note) <= 1000),
  add column evidence_note         text check (evidence_note is null or length(evidence_note) <= 1000),
  add column correction_request_id uuid;
create unique index hr_payroll_adjustments_no_duplicate on public.hr_payroll_adjustments (run_id, employee_id, component_id)
  where component_id is not null and source = 'manual' and status <> 'rejected';

-- ---------------------------------------------------------------------
-- Payments (status tracking only — nothing here moves money)
-- ---------------------------------------------------------------------
create table public.hr_payroll_payments (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references public.hr_payroll_runs(id) on delete restrict,
  item_id             uuid not null unique references public.hr_payroll_items(id) on delete restrict,
  employee_id         uuid not null references public.hr_employees(id) on delete restrict,
  currency            text not null,
  amount              numeric(14,2) not null check (amount >= 0),
  amount_paid         numeric(14,2) not null default 0 check (amount_paid >= 0),
  status              text not null default 'pending' check (status in ('pending','processing','paid','partially_paid','failed','reconciled')),
  method              text check (method is null or method in ('bank_transfer','cheque','cash','other')),
  payment_date        date,
  reference           text check (reference is null or length(reference) <= 120),
  notes               text check (notes is null or length(notes) <= 1000),
  failure_reason      text check (failure_reason is null or length(failure_reason) <= 1000),
  recorded_by         uuid,
  recorded_at         timestamptz,
  reconciled_by       uuid,
  reconciled_at       timestamptz,
  reconciliation_note text check (reconciliation_note is null or length(reconciliation_note) <= 1000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (amount_paid <= amount),
  check (status not in ('paid','reconciled') or (reference is not null and payment_date is not null and method is not null and amount_paid = amount)),
  check (status <> 'partially_paid' or (reference is not null and payment_date is not null and amount_paid > 0 and amount_paid < amount)),
  check (status <> 'reconciled' or reconciled_by is not null)
);
create index hr_payroll_payments_run on public.hr_payroll_payments(run_id, status);
create index hr_payroll_payments_emp on public.hr_payroll_payments(employee_id);
select hr_private.secure_table('public.hr_payroll_payments');
select hr_private.enable_audit('public.hr_payroll_payments', array['amount','amount_paid']);
create policy hr_payroll_payments_read on public.hr_payroll_payments for select to authenticated using (hr_private.has_permission('payroll.view'));
revoke insert, update, delete, truncate on public.hr_payroll_payments from authenticated;

create table public.hr_payroll_payment_events (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references public.hr_payroll_payments(id) on delete restrict,
  from_status   text,
  to_status     text not null,
  amount_paid   numeric(14,2),
  method        text,
  reference     text,
  payment_date  date,
  note          text,
  actor_user_id uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index hr_payroll_payment_events_payment on public.hr_payroll_payment_events(payment_id, created_at);
select hr_private.secure_table('public.hr_payroll_payment_events');
create policy hr_payroll_payment_events_read on public.hr_payroll_payment_events for select to authenticated using (hr_private.has_permission('payroll.view'));
revoke insert, update, delete, truncate on public.hr_payroll_payment_events from authenticated;
create or replace function hr_private.payroll_append_only_guard()
returns trigger language plpgsql set search_path = '' as $$
begin perform hr_private.fail('This history is append-only.', 'append_only'); return null; end $$;
create trigger hr_payroll_payment_events_guard before update or delete on public.hr_payroll_payment_events
  for each row execute function hr_private.payroll_append_only_guard();

-- Backfill payments for runs finalized before this migration.
insert into public.hr_payroll_payments (run_id, item_id, employee_id, currency, amount, amount_paid, status, method, payment_date, reference, recorded_by, recorded_at)
select i.run_id, i.id, i.employee_id, i.currency, i.net,
       case when r.status = 'paid' then i.net else 0 end,
       case when r.status = 'paid' then 'paid' else 'pending' end,
       case when r.status = 'paid' then 'bank_transfer' end,
       case when r.status = 'paid' then (r.paid_at at time zone 'UTC')::date end,
       case when r.status = 'paid' then coalesce(r.payment_reference, 'legacy') end,
       case when r.status = 'paid' then r.paid_by end,
       case when r.status = 'paid' then r.paid_at end
from public.hr_payroll_items i join public.hr_payroll_runs r on r.id = i.run_id
where r.status in ('finalized','paid') and i.net > 0
on conflict (item_id) do nothing;

-- Module 4 (130) integration: the (non-cancelled) final settlement that pays this
-- payroll item as an 'unpaid_salary' line, if any. Such a payment is recorded by
-- the settlement, never separately here (no double payment). Null when 130 is absent.
create or replace function hr_private.payroll_item_in_settlement(p_item uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  if p_item is null or to_regclass('public.hr_payroll_settlement_lines') is null then return null; end if;
  select st.id into v
  from public.hr_payroll_settlement_lines l join public.hr_payroll_settlements st on st.id = l.settlement_id
  where l.line_type = 'unpaid_salary' and l.source_ref = 'payroll_item:' || p_item::text and st.status <> 'cancelled'
  limit 1;
  return v;
end $$;

create or replace function hr_private.payroll_refresh_payment_status(p_run uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v record; v_status text; r public.hr_payroll_runs; v_ref text;
begin
  select count(*) total,
         count(*) filter (where status = 'reconciled') rec,
         count(*) filter (where status in ('paid','reconciled')) done,
         count(*) filter (where status = 'partially_paid') part,
         count(*) filter (where status = 'failed') failed,
         count(*) filter (where status = 'processing') proc
    into v from public.hr_payroll_payments where run_id = p_run;
  v_status := case when v.total = 0 then 'paid'
                   when v.rec = v.total then 'reconciled'
                   when v.done = v.total then 'paid'
                   when v.done > 0 or v.part > 0 then 'partially_paid'
                   when v.failed > 0 then 'failed'
                   when v.proc > 0 then 'processing'
                   else 'pending' end;
  select * into r from public.hr_payroll_runs where id = p_run for update;
  if r.status = 'finalized' and v.total > 0 and v_status in ('paid','reconciled') then
    select case when count(distinct reference) = 1 then max(reference) else 'Multiple references' end into v_ref
      from public.hr_payroll_payments where run_id = p_run;
    update public.hr_payroll_runs set status = 'paid', payment_status = v_status, paid_by = auth.uid(), paid_at = now(),
           payment_reference = left(coalesce(v_ref, payment_reference), 120)
     where id = p_run;
  elsif r.status in ('finalized','paid') then
    update public.hr_payroll_runs set payment_status = v_status where id = p_run and payment_status is distinct from v_status;
  end if;
  return v_status;
end $$;

-- ---------------------------------------------------------------------
-- Correction requests
-- ---------------------------------------------------------------------
create table public.hr_payroll_correction_requests (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.hr_employees(id) on delete restrict,
  run_id            uuid not null references public.hr_payroll_runs(id) on delete restrict,
  payslip_id        uuid references public.hr_payslips(id) on delete restrict,
  raised_by         uuid not null default auth.uid(),
  raised_via        text not null check (raised_via in ('employee','payroll')),
  category          text not null check (category in ('missing_earning','incorrect_deduction','loss_of_pay','attendance_change','leave_change','reimbursement','statutory','other')),
  description       text not null check (length(btrim(description)) between 5 and 2000),
  evidence_note     text check (evidence_note is null or length(evidence_note) <= 1000),
  status            text not null default 'submitted' check (status in ('submitted','prepared','applied','rejected')),
  proposed_amount   numeric(14,2) check (proposed_amount is null or proposed_amount <> 0),
  prepared_by       uuid,
  prepared_at       timestamptz,
  preparation_note  text check (preparation_note is null or length(preparation_note) <= 1000),
  decided_by        uuid,
  decided_at        timestamptz,
  decision_note     text check (decision_note is null or length(decision_note) <= 1000),
  adjustment_id     uuid references public.hr_payroll_adjustments(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index hr_payroll_correction_requests_emp on public.hr_payroll_correction_requests(employee_id, created_at desc);
create index hr_payroll_correction_requests_status on public.hr_payroll_correction_requests(status);
select hr_private.secure_table('public.hr_payroll_correction_requests');
create trigger hr_payroll_correction_requests_touch before update on public.hr_payroll_correction_requests for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_payroll_correction_requests', array['proposed_amount']);
create policy hr_payroll_correction_requests_read on public.hr_payroll_correction_requests for select to authenticated
  using (employee_id = hr_private.current_employee_id() or hr_private.has_permission('payroll.view'));
revoke insert, update, delete, truncate on public.hr_payroll_correction_requests from authenticated;
alter table public.hr_payroll_adjustments add constraint hr_payroll_adjustments_correction_request_fk
  foreign key (correction_request_id) references public.hr_payroll_correction_requests(id) on delete restrict;

-- Internal: book a correction for a finalized run into the next open run
-- (or park it until the next run is calculated). Finalized data is never edited.
create or replace function hr_private.payroll_post_correction(p_src_run uuid, p_employee uuid, p_amount numeric, p_reason text,
  p_created_by uuid, p_request uuid default null, p_decided_by uuid default null)
returns public.hr_payroll_adjustments language plpgsql security definer set search_path = '' as $$
declare src public.hr_payroll_runs; nxt public.hr_payroll_runs; a public.hr_payroll_adjustments; v_entity uuid;
begin
  select * into src from public.hr_payroll_runs where id = p_src_run;
  if src.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if src.status not in ('finalized','paid') then
    perform hr_private.fail('Corrections apply to finalized runs only; add an adjustment to an open run instead.', 'invalid_state');
  end if;
  if not exists (select 1 from public.hr_payroll_items where run_id = p_src_run and employee_id = p_employee) then
    perform hr_private.fail('This employee was not part of that payroll run.', 'not_in_run');
  end if;
  if p_amount is null or p_amount = 0 then perform hr_private.fail('Correction amount cannot be zero.', 'invalid_amount'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('A reason is required.', 'reason_required'); end if;
  select legal_entity_id into v_entity from public.hr_employees where id = p_employee;
  select * into nxt from public.hr_payroll_runs
  where period_start > src.period_end and status in ('draft','calculated')
    and (legal_entity_id is null or legal_entity_id is not distinct from v_entity)
  order by period_start limit 1
  for update;
  insert into public.hr_payroll_adjustments (run_id, employee_id, label, amount, reason, source, source_run_id, created_by, status,
                                             decided_by, decided_at, correction_request_id)
  values (nxt.id, p_employee,
          'Correction for ' || to_char(src.period_start, 'DD Mon YYYY') || ' - ' || to_char(src.period_end, 'DD Mon YYYY'),
          round(p_amount, 2), left(btrim(p_reason), 1000), 'correction', src.id, p_created_by, 'approved',
          p_decided_by, case when p_decided_by is not null then now() end, p_request)
  returning * into a;
  if nxt.id is not null and nxt.status <> 'draft' then
    update public.hr_payroll_runs set status = 'draft', reviewed_by = null, reviewed_at = null where id = nxt.id;
  end if;
  perform hr_private.audit_event('PAYROLL_CORRECTION', 'hr_payroll_adjustments', a.id::text,
    jsonb_build_object('source_run_id', src.id, 'target_run_id', nxt.id, 'employee_id', p_employee, 'request_id', p_request));
  return a;
end $$;

-- ---------------------------------------------------------------------
-- Separation-of-duties helpers
-- ---------------------------------------------------------------------
-- The person approving/finalizing a run must not have created any adjustment
-- in it, and must not be the subject of any adjustment in it.
create or replace function hr_private.payroll_check_own_compensation(p_run uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id();
begin
  if exists (select 1 from public.hr_payroll_adjustments a
             where a.run_id = p_run and a.status <> 'rejected' and v_me is not null and a.employee_id = v_me) then
    perform hr_private.fail('This run contains an adjustment to your own pay. Another payroll approver must approve and finalize it.', 'self_approval');
  end if;
  if exists (select 1 from public.hr_payroll_adjustments a
             where a.run_id = p_run and a.status <> 'rejected' and a.created_by = auth.uid()) then
    perform hr_private.fail('You created an adjustment in this run, so you cannot approve or finalize it.', 'self_approval');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Run workflow RPCs (redefined; same names, behaviour extended)
-- ---------------------------------------------------------------------
drop function public.hr_create_payroll_run(date, date, text);
create function public.hr_create_payroll_run(p_period_start date, p_period_end date, p_notes text default null, p_legal_entity uuid default null)
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
  if p_legal_entity is not null and not exists (select 1 from public.hr_legal_entities where id = p_legal_entity and active) then
    perform hr_private.fail('Choose an active company / legal entity.', 'invalid_entity');
  end if;
  perform pg_advisory_xact_lock(hashtext('hr_payroll_runs'));
  -- Same scope, or a company-wide run against any company run (either way round), may not overlap.
  if exists (select 1 from public.hr_payroll_runs x
             where daterange(x.period_start, x.period_end, '[]') && daterange(p_period_start, p_period_end, '[]')
               and (x.legal_entity_id is null or p_legal_entity is null or x.legal_entity_id = p_legal_entity)) then
    perform hr_private.fail('A payroll run already exists for an overlapping period and scope.', 'duplicate_run');
  end if;
  insert into public.hr_payroll_runs (period_start, period_end, created_by, notes, legal_entity_id)
  values (p_period_start, p_period_end, auth.uid(), nullif(btrim(p_notes), ''), p_legal_entity)
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.hr_set_payroll_hold(p_run uuid, p_employee uuid, p_hold boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run public.hr_payroll_runs;
begin
  if not hr_private.has_permission('payroll.manage') then perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden'); end if;
  select * into run from public.hr_payroll_runs where id = p_run for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status not in ('draft','calculated') then perform hr_private.fail('Holds can only be changed before the run is submitted.', 'run_locked'); end if;
  perform hr_private.payroll_assert_not_self(p_employee, 'change a payroll hold');
  if coalesce(p_hold, false) then
    if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason for holding this employee''s pay.', 'reason_required'); end if;
    insert into public.hr_payroll_run_holds (run_id, employee_id, reason) values (p_run, p_employee, btrim(p_reason))
    on conflict (run_id, employee_id) do update set reason = excluded.reason;
  else
    delete from public.hr_payroll_run_holds where run_id = p_run and employee_id = p_employee;
  end if;
  if run.status <> 'draft' then
    update public.hr_payroll_runs set status = 'draft', reviewed_by = null, reviewed_at = null where id = p_run;
  end if;
  return jsonb_build_object('run_id', p_run, 'employee_id', p_employee, 'held', coalesce(p_hold, false));
end $$;

create or replace function public.hr_calculate_payroll_run(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.hr_payroll_runs;
  cfg jsonb := coalesce(hr_private.setting('payroll'), '{}'::jsonb);
  v_basis text := coalesce(cfg ->> 'proration_basis', 'working_days');
  v_att boolean := coalesce((cfg ->> 'lop_from_attendance')::boolean, false);
  v_managed text[] := hr_private.payroll_managed_codes();
  e record; s record; c record; r record; v_enr record;
  v_ws date; v_we date; v_seg_s date; v_seg_e date; v_cover date;
  v_wd int; v_window_days int; v_seg_days int;
  v_seg_lop numeric; v_seg_pay numeric; v_factor numeric; v_share numeric; v_ceil_share numeric;
  v_payable numeric; v_lop numeric;
  v_basic numeric; v_gross_pre numeric; v_gross_full numeric; v_amt numeric; v_full_amt numeric;
  v_lines jsonb; v_seg_full jsonb; v_segments jsonb; v_skipped jsonb; v_inelig jsonb; v_adj jsonb; v_reimb jsonb;
  v_stat jsonb; v_stat_pending jsonb; v_errors jsonb; v_warnings jsonb; v_currencies text[];
  v_adj_pos numeric; v_adj_neg numeric; v_reimb_total numeric; v_pending_adj int;
  v_earn numeric; v_ded numeric; v_employer numeric; v_net numeric;
  v_structure uuid; v_currency text;
  v_base_full numeric; v_base numeric; v_ceiling numeric; v_cbase numeric; v_elig_wage numeric; v_ee numeric; v_er numeric;
  v_eligible boolean; v_why text; v_slab jsonb; v_code text; v_name text;
  v_count int := 0; v_err_count int := 0; v_warn_count int := 0;
  v_tot_gross numeric := 0; v_tot_ded numeric := 0; v_tot_net numeric := 0;
  v_excluded jsonb := '[]'::jsonb;
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
    select emp.id, emp.joining_date, emp.last_working_date, emp.employee_code, emp.employment_type, emp.legal_entity_id
    from public.hr_employees emp
    where emp.status <> 'archived'
      and (run.legal_entity_id is null or emp.legal_entity_id = run.legal_entity_id)
      and coalesce(emp.joining_date, run.period_start) <= run.period_end
      and coalesce(emp.last_working_date, run.period_end) >= run.period_start
      and exists (select 1 from public.hr_salary_structures ss
                  where ss.employee_id = emp.id and ss.status = 'active'
                    and ss.effective_from <= least(run.period_end, coalesce(emp.last_working_date, run.period_end))
                    and coalesce(ss.effective_to, run.period_end) >= greatest(run.period_start, coalesce(emp.joining_date, run.period_start)))
    order by emp.employee_code
  loop
    if exists (select 1 from public.hr_payroll_run_holds h where h.run_id = p_id and h.employee_id = e.id) then
      v_excluded := v_excluded || jsonb_build_object('employee_id', e.id, 'employee_code', e.employee_code, 'reason', 'on_hold');
      continue;
    end if;
    v_ws := greatest(run.period_start, coalesce(e.joining_date, run.period_start));
    v_we := least(run.period_end, coalesce(e.last_working_date, run.period_end));
    select max(sc.covered_through) into v_cover from public.hr_payroll_settlement_coverage sc where sc.employee_id = e.id and sc.status = 'active';
    -- Module 4 (130) full & final settlement: an approved/paid settlement with a salary_due line
    -- pays salary up to its last working day, so payroll must not pay those days again.
    -- Guarded: the statement only runs when that module's table exists.
    if to_regclass('public.hr_payroll_settlements') is not null then
      select greatest(v_cover, max(st.last_working_day)) into v_cover
      from public.hr_payroll_settlements st
      where st.employee_id = e.id and st.status in ('approved','paid')
        and exists (select 1 from public.hr_payroll_settlement_lines l where l.settlement_id = st.id and l.line_type = 'salary_due');
    end if;
    if v_cover is not null and v_cover >= v_ws then
      v_ws := v_cover + 1;
      if v_ws > v_we then
        v_excluded := v_excluded || jsonb_build_object('employee_id', e.id, 'employee_code', e.employee_code,
                                                       'reason', 'covered_by_final_settlement', 'covered_through', v_cover);
        continue;
      end if;
    end if;
    v_wd := hr_private.payroll_counted_days(e.id, run.period_start, run.period_end, v_basis);
    v_window_days := hr_private.payroll_counted_days(e.id, v_ws, v_we, v_basis);
    v_lines := '{}'; v_segments := '[]'; v_skipped := '[]'; v_inelig := '[]'; v_stat := '[]'; v_stat_pending := '[]';
    v_errors := '[]'; v_warnings := '[]'; v_currencies := '{}';
    v_payable := 0; v_lop := 0; v_structure := null; v_currency := coalesce(cfg ->> 'currency', 'INR');

    for s in
      select ss.id, ss.effective_from, ss.effective_to, ss.currency from public.hr_salary_structures ss
      where ss.employee_id = e.id and ss.status = 'active'
        and ss.effective_from <= v_we and coalesce(ss.effective_to, v_we) >= v_ws
      order by ss.effective_from
    loop
      v_structure := coalesce(v_structure, s.id);
      v_currency := s.currency;
      if not (s.currency = any(v_currencies)) then v_currencies := v_currencies || s.currency; end if;
      v_seg_s := greatest(v_ws, s.effective_from);
      v_seg_e := least(v_we, coalesce(s.effective_to, v_we));
      v_seg_days := hr_private.payroll_counted_days(e.id, v_seg_s, v_seg_e, v_basis);
      v_seg_lop := least(v_seg_days, hr_private.payroll_lop_days(e.id, v_seg_s, v_seg_e, v_att));
      v_seg_pay := v_seg_days - v_seg_lop;
      v_factor := case when v_wd > 0 then v_seg_pay / v_wd else 0 end;          -- proration of earnings
      v_share := case when v_window_days > 0 then v_seg_days::numeric / v_window_days else 0 end;  -- split of fixed deductions
      v_ceil_share := case when v_wd > 0 then v_seg_days::numeric / v_wd else 0 end;  -- share of a monthly wage ceiling
      v_payable := v_payable + v_seg_pay;
      v_lop := v_lop + v_seg_lop;
      v_seg_full := '{}';
      v_segments := v_segments || jsonb_build_object('structure_id', s.id, 'from', v_seg_s, 'to', v_seg_e,
                                                     'days', v_seg_days, 'lop_days', v_seg_lop, 'payable_days', v_seg_pay);

      select coalesce(sum(i.amount), 0) into v_basic
      from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
      where i.structure_id = s.id and k.code = 'BASIC' and hr_private.component_applies(k, v_seg_e, e.employment_type, v_managed);
      select coalesce(sum(case k.calc_type when 'percent_of_basic' then v_basic * coalesce(i.percent, k.default_value, 0) / 100
                                           else coalesce(i.amount, 0) end), 0) into v_gross_pre
      from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
      where i.structure_id = s.id and k.kind = 'earning' and k.calc_type <> 'percent_of_gross'
        and hr_private.component_applies(k, v_seg_e, e.employment_type, v_managed);
      select v_gross_pre + coalesce(sum(v_gross_pre * coalesce(i.percent, k.default_value, 0) / 100), 0) into v_gross_full
      from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
      where i.structure_id = s.id and k.kind = 'earning' and k.calc_type = 'percent_of_gross'
        and hr_private.component_applies(k, v_seg_e, e.employment_type, v_managed);

      for c in
        select k.code, k.name, k.kind, k.calc_type, k.active, k.requires_verification, i.amount,
               coalesce(i.percent, k.default_value, 0) as pct,
               hr_private.component_applies(k, v_seg_e, e.employment_type, v_managed) as applies,
               (k.code = any(v_managed)) as managed
        from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
        where i.structure_id = s.id
        order by k.sort_order, k.code
      loop
        if not c.active or c.requires_verification then
          v_skipped := v_skipped || to_jsonb(c.code);
          continue;
        end if;
        if not c.applies then
          v_inelig := v_inelig || jsonb_build_object('code', c.code,
                        'reason', case when c.managed then 'managed_by_statutory_rule' else 'not_eligible_or_not_effective' end);
          continue;
        end if;
        if c.kind in ('earning','employer_contribution') then
          v_full_amt := case c.calc_type when 'percent_of_basic' then v_basic * c.pct / 100
                                         when 'percent_of_gross' then v_gross_full * c.pct / 100
                                         else coalesce(c.amount, 0) end;
          v_amt := v_full_amt * v_factor;
          if c.kind = 'earning' then
            v_seg_full := v_seg_full || jsonb_build_object(c.code, coalesce((v_seg_full ->> c.code)::numeric, 0) + v_full_amt);
          end if;
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

      -- Statutory rules in force on the last day of this segment. Only APPROVED
      -- (professionally validated) rules are applied; pending ones are reported.
      for r in
        select distinct on (sr.code, coalesce(sr.state_code, '')) sr.*
        from public.hr_payroll_statutory_rules sr
        where sr.status in ('approved','pending_validation')
          and sr.effective_from <= v_seg_e and coalesce(sr.effective_to, v_seg_e) >= v_seg_e
          and (sr.legal_entity_id is null or sr.legal_entity_id is not distinct from e.legal_entity_id)
        order by sr.code, coalesce(sr.state_code, ''), (sr.status = 'approved') desc, (sr.legal_entity_id is not null) desc, sr.effective_from desc
      loop
        select en.enrolled, en.state_code, en.declared_monthly_amount into v_enr
        from public.hr_payroll_statutory_enrollments en
        where en.employee_id = e.id and en.rule_code = r.code
          and en.effective_from <= v_seg_e and coalesce(en.effective_to, v_seg_e) >= v_seg_e
        order by en.effective_from desc limit 1;
        v_eligible := case when r.applies_to = 'all' then coalesce(v_enr.enrolled, true) else coalesce(v_enr.enrolled, false) end;
        v_why := case when not v_eligible then 'not_enrolled' end;
        if v_eligible and r.state_code is not null and v_enr.state_code is distinct from r.state_code then
          v_eligible := false; v_why := 'jurisdiction_mismatch';
        end if;
        select coalesce(sum(j.value::numeric), 0) into v_base_full from jsonb_each_text(v_seg_full) j where j.key = any(r.wage_base_components);
        if v_eligible and r.eligibility_wage_max is not null then
          v_elig_wage := case r.eligibility_basis when 'gross' then v_gross_full else v_base_full end;
          if v_elig_wage > r.eligibility_wage_max then v_eligible := false; v_why := 'above_eligibility_threshold'; end if;
        end if;
        if r.status <> 'approved' then
          if v_eligible and not (v_stat_pending ? r.code) then v_stat_pending := v_stat_pending || to_jsonb(r.code); end if;
          continue;
        end if;
        if not v_eligible then
          v_stat := v_stat || jsonb_build_object('rule_id', r.id, 'code', r.code, 'state_code', r.state_code,
                      'segment_from', v_seg_s, 'segment_to', v_seg_e, 'applied', false, 'reason', v_why);
          continue;
        end if;
        v_base := v_base_full * v_factor;
        v_ceiling := case when r.wage_ceiling is null then null else r.wage_ceiling * v_ceil_share end;
        v_cbase := case when v_ceiling is null then v_base else least(v_base, v_ceiling) end;
        v_slab := null;
        if r.calc_method = 'percent_of_wage' then
          v_ee := v_cbase * coalesce(r.employee_rate, 0) / 100;
          v_er := v_cbase * coalesce(r.employer_rate, 0) / 100;
        elsif r.calc_method = 'slab' then
          select x.v into v_slab from jsonb_array_elements(r.slabs) as x(v)
           where coalesce((x.v ->> 'from')::numeric, 0) <= (case r.eligibility_basis when 'gross' then v_gross_full else v_base_full end)
             and ((x.v ->> 'to') is null or (case r.eligibility_basis when 'gross' then v_gross_full else v_base_full end) <= (x.v ->> 'to')::numeric)
           order by coalesce((x.v ->> 'from')::numeric, 0) desc limit 1;
          v_ee := coalesce((v_slab ->> 'employee_amount')::numeric, 0) * v_share;
          v_er := coalesce((v_slab ->> 'employer_amount')::numeric, 0) * v_share;
        elsif r.calc_method = 'fixed' then
          v_ee := coalesce(r.employee_amount, 0) * v_share;
          v_er := coalesce(r.employer_amount, 0) * v_share;
        else
          v_ee := coalesce(v_enr.declared_monthly_amount, 0) * v_share;
          v_er := 0;
        end if;
        v_ee := hr_private.round_money(v_ee, r.rounding_mode, r.rounding_precision);
        v_er := hr_private.round_money(v_er, r.rounding_mode, r.rounding_precision);
        if v_ee > 0 then
          v_code := coalesce(r.employee_component_code, r.code || '_EMPLOYEE');
          v_name := coalesce((select k.name from public.hr_salary_components k where k.code = r.employee_component_code), r.name || ' (employee)');
          v_lines := jsonb_set(v_lines, array[v_code], jsonb_build_object('code', v_code, 'name', v_name, 'kind', 'deduction', 'statutory_rule', r.code,
                       'amount', coalesce((v_lines -> v_code ->> 'amount')::numeric, 0) + v_ee));
        end if;
        if v_er > 0 then
          v_code := coalesce(r.employer_component_code, r.code || '_EMPLOYER');
          v_name := coalesce((select k.name from public.hr_salary_components k where k.code = r.employer_component_code), r.name || ' (employer)');
          v_lines := jsonb_set(v_lines, array[v_code], jsonb_build_object('code', v_code, 'name', v_name, 'kind', 'employer_contribution', 'statutory_rule', r.code,
                       'amount', coalesce((v_lines -> v_code ->> 'amount')::numeric, 0) + v_er));
        end if;
        v_stat := v_stat || jsonb_build_object('rule_id', r.id, 'code', r.code, 'state_code', r.state_code, 'applied', true,
          'segment_from', v_seg_s, 'segment_to', v_seg_e, 'method', r.calc_method, 'rule_effective_from', r.effective_from,
          'wage_base_components', to_jsonb(r.wage_base_components), 'wage_base_monthly', round(v_base_full, 2),
          'wage_base_prorated', round(v_base, 2), 'ceiling', round(v_ceiling, 2), 'contribution_base', round(v_cbase, 2),
          'employee_rate', r.employee_rate, 'employer_rate', r.employer_rate, 'slab', v_slab,
          'employee_amount', v_ee, 'employer_amount', v_er, 'rounding', r.rounding_mode || ' / ' || r.rounding_precision || 'dp',
          'validation_reference', r.validation_reference);
      end loop;
    end loop;

    if v_structure is null then
      v_excluded := v_excluded || jsonb_build_object('employee_id', e.id, 'employee_code', e.employee_code, 'reason', 'no_structure_in_window');
      continue;
    end if;

    -- Corrections from earlier finalized runs that are waiting for a run.
    update public.hr_payroll_adjustments adj set run_id = p_id
    where adj.employee_id = e.id and adj.run_id is null and adj.source = 'correction' and adj.status = 'approved'
      and exists (select 1 from public.hr_payroll_runs src where src.id = adj.source_run_id and src.period_end < run.period_start);
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'amount', a.amount, 'reason', a.reason,
                                                 'source', a.source, 'source_run_id', a.source_run_id) order by a.created_at), '[]'::jsonb),
           coalesce(sum(a.amount) filter (where a.amount > 0), 0),
           coalesce(-sum(a.amount) filter (where a.amount < 0), 0)
      into v_adj, v_adj_pos, v_adj_neg
    from public.hr_payroll_adjustments a where a.run_id = p_id and a.employee_id = e.id and a.status = 'approved';
    select count(*) into v_pending_adj from public.hr_payroll_adjustments a where a.run_id = p_id and a.employee_id = e.id and a.status = 'pending';

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

    -- Validation: errors block submission; warnings must be reviewed.
    if v_net < 0 then
      v_errors := v_errors || jsonb_build_object('code', 'negative_net', 'message', 'Deductions exceed earnings; net pay would be negative.');
    end if;
    if cardinality(v_currencies) > 1 then
      v_errors := v_errors || jsonb_build_object('code', 'mixed_currency', 'message', 'Salary structures in this period use different currencies.');
    end if;
    if v_pending_adj > 0 then
      v_errors := v_errors || jsonb_build_object('code', 'pending_adjustment', 'message', v_pending_adj || ' adjustment(s) are waiting for approval.');
    end if;
    if v_earn = 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'zero_gross', 'message', 'No earnings for this period (check LOP and structure dates).');
    end if;
    if jsonb_array_length(v_skipped) > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'unverified_components', 'message', 'Unverified or inactive components were skipped.');
    end if;
    if jsonb_array_length(v_stat_pending) > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'statutory_pending_validation',
        'message', 'Statutory rule(s) pending professional validation were NOT applied: '
                   || (select string_agg(x, ', ') from jsonb_array_elements_text(v_stat_pending) x) || '.');
    end if;
    if exists (select 1 from jsonb_array_elements(v_inelig) x where x ->> 'reason' = 'managed_by_statutory_rule') then
      v_warnings := v_warnings || jsonb_build_object('code', 'statutory_component_in_structure',
        'message', 'A structure line for a statutory component was ignored to avoid a duplicate deduction.');
    end if;
    if not exists (select 1 from public.hr_employee_bank_accounts b where b.employee_id = e.id and b.is_primary and b.active) then
      v_warnings := v_warnings || jsonb_build_object('code', 'no_bank_account', 'message', 'No active primary bank account.');
    elsif not exists (select 1 from public.hr_employee_bank_accounts b where b.employee_id = e.id and b.is_primary and b.active and b.verified) then
      v_warnings := v_warnings || jsonb_build_object('code', 'bank_unverified', 'message', 'Primary bank account is not verified.');
    end if;
    if exists (select 1 from public.hr_attendance_corrections ac where ac.employee_id = e.id and ac.status = 'pending'
               and ac.work_date between v_ws and v_we) then
      v_warnings := v_warnings || jsonb_build_object('code', 'attendance_pending', 'message', 'Attendance corrections in this period are still pending.');
    end if;
    if exists (select 1 from public.hr_leave_requests lr where lr.employee_id = e.id and lr.status = 'pending_approval'
               and lr.start_date <= v_we and lr.end_date >= v_ws) then
      v_warnings := v_warnings || jsonb_build_object('code', 'leave_pending', 'message', 'Leave requests in this period are still pending approval (not counted).');
    end if;
    if v_cover is null and exists (select 1 from public.hr_exits x where x.employee_id = e.id
               and x.status in ('clearance','final_settlement','closed')
               and coalesce(x.approved_last_working_day, x.proposed_last_working_day) <= run.period_end) then
      v_warnings := v_warnings || jsonb_build_object('code', 'exit_settlement_unreconciled',
        'message', 'Employee is in exit/final settlement and no settlement coverage is recorded. Confirm these days are not also paid in the settlement.');
    end if;
    if v_cover is not null then
      v_warnings := v_warnings || jsonb_build_object('code', 'settlement_coverage',
        'message', 'Days up to ' || to_char(v_cover, 'DD Mon YYYY') || ' are paid through the final settlement and were excluded.');
    end if;
    if v_att then
      v_warnings := v_warnings || jsonb_build_object('code', 'lop_from_attendance', 'message', 'Attendance absences are counted as LOP (company policy setting).');
    end if;

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
        'skipped_ineligible', v_inelig,
        'statutory', v_stat,
        'statutory_pending', v_stat_pending,
        'validation', jsonb_build_object('errors', v_errors, 'warnings', v_warnings),
        'settlement_covered_through', v_cover,
        'proration_basis', v_basis,
        'lop_from_attendance', v_att,
        'rounding', 'Each line rounded half-up to 2 decimals; statutory lines use the rule''s rounding.',
        'working_days', v_wd, 'payable_days', v_payable, 'lop_days', v_lop,
        'employment_window', jsonb_build_object('from', v_ws, 'to', v_we)));
    v_count := v_count + 1;
    if jsonb_array_length(v_errors) > 0 then v_err_count := v_err_count + 1; end if;
    if jsonb_array_length(v_warnings) > 0 then v_warn_count := v_warn_count + 1; end if;
    v_tot_gross := v_tot_gross + v_earn; v_tot_ded := v_tot_ded + v_ded; v_tot_net := v_tot_net + v_net;
  end loop;

  update public.hr_payroll_runs set status = 'calculated', calculated_by = auth.uid(), calculated_at = now(),
         reviewed_by = null, reviewed_at = null,
         validation = jsonb_build_object('employees', v_count, 'items_with_errors', v_err_count, 'items_with_warnings', v_warn_count,
                                         'excluded', v_excluded, 'calculated_at', now())
   where id = p_id;
  return jsonb_build_object('run_id', p_id, 'employees', v_count, 'gross', v_tot_gross, 'deductions', v_tot_ded, 'net', v_tot_net,
                            'items_with_errors', v_err_count, 'items_with_warnings', v_warn_count, 'excluded', jsonb_array_length(v_excluded));
end $$;

create or replace function public.hr_add_payroll_adjustment(p_run_id uuid, p_employee uuid, p_amount numeric, p_reason text,
                                                            p_label text default null, p_component uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare run public.hr_payroll_runs; v_id uuid; k public.hr_salary_components; v_status text := 'approved';
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
  perform hr_private.payroll_assert_not_self(p_employee, 'add a payroll adjustment');
  if p_amount is null or p_amount = 0 then perform hr_private.fail('Adjustment amount cannot be zero.', 'invalid_amount'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('A reason is required.', 'reason_required'); end if;
  if p_component is not null then
    select * into k from public.hr_salary_components where id = p_component;
    if k.id is null then perform hr_private.fail('Component not found.', 'not_found'); end if;
    if not k.active then perform hr_private.fail(k.name || ' is not enabled.', 'inactive_component'); end if;
    if k.code = any(hr_private.payroll_managed_codes()) then
      perform hr_private.fail('Statutory components are calculated from statutory rules and cannot be added as manual adjustments.', 'statutory_component');
    end if;
    if k.kind = 'employer_contribution' then perform hr_private.fail('Employer contributions are not paid as adjustments.', 'invalid_component'); end if;
    if (k.kind = 'earning' and p_amount < 0) or (k.kind = 'deduction' and p_amount > 0) then
      perform hr_private.fail('The amount does not match the component (earnings are added, deductions are subtracted).', 'sign_mismatch');
    end if;
    if exists (select 1 from public.hr_payroll_adjustments a where a.run_id = p_run_id and a.employee_id = p_employee
               and a.component_id = p_component and a.source = 'manual' and a.status <> 'rejected') then
      perform hr_private.fail('This employee already has an adjustment for ' || k.name || ' in this run. Reject it before adding another.', 'duplicate_adjustment');
    end if;
    if k.requires_approval then v_status := 'pending'; end if;
  end if;
  insert into public.hr_payroll_adjustments (run_id, employee_id, component_id, label, amount, reason, source, status)
  values (p_run_id, p_employee, p_component,
          coalesce(nullif(btrim(p_label), ''), k.name, case when p_amount > 0 then 'Additional earning' else 'Additional deduction' end),
          round(p_amount, 2), btrim(p_reason), 'manual', v_status)
  returning id into v_id;
  if v_status = 'pending' then
    perform hr_private.notify_permission_holders('payroll.approve', 'payroll.adjustment_submitted', 'Payroll adjustment awaiting approval',
      'A ' || k.name || ' entry is waiting for approval.', '/hr/payroll/runs/' || p_run_id, 'hr_payroll_adjustments', v_id::text, p_employee);
  end if;
  -- Any change after calculation requires recalculation.
  if run.status <> 'draft' then
    update public.hr_payroll_runs set status = 'draft', reviewed_by = null, reviewed_at = null where id = p_run_id;
  end if;
  return v_id;
end $$;

create or replace function public.hr_decide_payroll_adjustment(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.hr_payroll_adjustments; run public.hr_payroll_runs;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to approve payroll adjustments.', 'forbidden'); end if;
  select * into a from public.hr_payroll_adjustments where id = p_id for update;
  if a.id is null then perform hr_private.fail('Adjustment not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(a.employee_id, 'decide a payroll adjustment');
  if a.created_by = auth.uid() then perform hr_private.fail('You cannot approve an adjustment you created.', 'self_approval'); end if;
  if a.status <> 'pending' then perform hr_private.fail('This adjustment has already been ' || a.status || '.', 'already_decided'); end if;
  select * into run from public.hr_payroll_runs where id = a.run_id for update;
  if run.status not in ('draft','calculated','reviewed') then perform hr_private.fail('The run is locked.', 'run_locked'); end if;
  if not coalesce(p_approve, false) and length(btrim(coalesce(p_note, ''))) < 3 then
    perform hr_private.fail('Please give a reason for rejecting.', 'note_required');
  end if;
  update public.hr_payroll_adjustments set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_id returning * into a;
  if run.status <> 'draft' then
    update public.hr_payroll_runs set status = 'draft', reviewed_by = null, reviewed_at = null where id = run.id;
  end if;
  return to_jsonb(a);
end $$;

-- Submit for approval (the existing "review" step).
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
  if exists (select 1 from public.hr_payroll_adjustments where run_id = p_id and status = 'pending') then
    perform hr_private.fail('Some adjustments in this run are waiting for approval. Decide them and recalculate first.', 'pending_adjustments');
  end if;
  if exists (select 1 from public.hr_payroll_items where run_id = p_id
             and jsonb_array_length(coalesce(breakdown -> 'validation' -> 'errors', '[]'::jsonb)) > 0) then
    perform hr_private.fail('Some payroll items have validation errors. Fix them and recalculate before submitting.', 'validation_errors');
  end if;
  update public.hr_payroll_runs set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(),
         notes = coalesce(nullif(btrim(p_note), ''), notes)
   where id = p_id returning * into run;
  perform hr_private.notify_permission_holders('payroll.approve', 'payroll.run_submitted', 'Payroll submitted for approval',
    'Payroll for ' || to_char(run.period_start, 'Mon YYYY') || ' is waiting for approval.', '/hr/payroll/runs/' || run.id, 'hr_payroll_runs', run.id::text);
  return to_jsonb(run);
end $$;

create or replace function public.hr_return_payroll_run(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run public.hr_payroll_runs;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to approve payroll.', 'forbidden'); end if;
  select * into run from public.hr_payroll_runs where id = p_id for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status not in ('reviewed','approved') then
    perform hr_private.fail('Only submitted or approved (not yet finalized) runs can be returned for correction.', 'invalid_state');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason for returning the run.', 'reason_required'); end if;
  update public.hr_payroll_runs set status = 'calculated', reviewed_by = null, reviewed_at = null, approved_by = null, approved_at = null,
         returned_by = auth.uid(), returned_at = now(), return_reason = btrim(p_reason)
   where id = p_id returning * into run;
  perform hr_private.notify_user(run.created_by, 'payroll.run_returned', 'Payroll returned for correction',
    'Payroll for ' || to_char(run.period_start, 'Mon YYYY') || ' was returned: ' || left(btrim(p_reason), 200), '/hr/payroll/runs/' || run.id, 'hr_payroll_runs', run.id::text);
  return to_jsonb(run);
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
  perform hr_private.payroll_check_own_compensation(run.id);
  update public.hr_payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_id returning * into run;
  return to_jsonb(run);
end $$;

create or replace function public.hr_finalize_payroll_run(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run public.hr_payroll_runs; r record; v_count int := 0; v_company jsonb := coalesce(hr_private.setting('company'), '{}'::jsonb);
begin
  if not hr_private.has_permission('payroll.approve') then
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
end $$;

-- ---------------------------------------------------------------------
-- Payment recording (status only — NEVER initiates a payment)
-- ---------------------------------------------------------------------
create or replace function public.hr_record_payroll_payments(p_payment_ids uuid[], p_status text, p_method text default null,
  p_reference text default null, p_payment_date date default null, p_amount_paid numeric default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.hr_payroll_payments; v_runs uuid[] := '{}'; v_n int := 0; v_paid numeric; v_run uuid; v_found int;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to record payroll payments.', 'forbidden'); end if;
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
end $$;

create or replace function public.hr_reconcile_payroll_payments(p_payment_ids uuid[], p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.hr_payroll_payments; v_runs uuid[] := '{}'; v_n int := 0; v_run uuid;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to reconcile payroll payments.', 'forbidden'); end if;
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
end $$;

-- Legacy one-click "record whole run as paid" (one batch reference). Refuses
-- when any payment failed or was partial, so a run is never marked paid wrongly.
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
end $$;

-- ---------------------------------------------------------------------
-- Corrections (direct, by payroll) and correction requests
-- ---------------------------------------------------------------------
create or replace function public.hr_create_payroll_correction(p_run_id uuid, p_employee uuid, p_amount numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.hr_payroll_adjustments;
begin
  if not hr_private.has_permission('payroll.manage') then
    perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden');
  end if;
  perform hr_private.payroll_assert_not_self(p_employee, 'create a payroll correction');
  a := hr_private.payroll_post_correction(p_run_id, p_employee, p_amount, p_reason, auth.uid());
  return to_jsonb(a);
end $$;

create or replace function public.hr_submit_payroll_query(p_payslip uuid, p_category text, p_description text, p_evidence text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); ps public.hr_payslips; v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into ps from public.hr_payslips where id = p_payslip and employee_id = v_me and published_at is not null;
  if ps.id is null or not hr_private.payroll_run_released(ps.run_id) then perform hr_private.fail('Payslip not found.', 'not_found'); end if;
  if p_category is null or p_category not in ('missing_earning','incorrect_deduction','loss_of_pay','attendance_change','leave_change','reimbursement','statutory','other') then
    perform hr_private.fail('Choose what the query is about.', 'invalid_category');
  end if;
  if length(btrim(coalesce(p_description, ''))) < 5 then perform hr_private.fail('Describe the issue (at least 5 characters).', 'description_required'); end if;
  if exists (select 1 from public.hr_payroll_correction_requests where payslip_id = p_payslip and status in ('submitted','prepared') and category = p_category) then
    perform hr_private.fail('You already have an open query of this type for this payslip.', 'duplicate_query');
  end if;
  insert into public.hr_payroll_correction_requests (employee_id, run_id, payslip_id, raised_via, category, description, evidence_note)
  values (v_me, ps.run_id, ps.id, 'employee', p_category, btrim(p_description), nullif(btrim(p_evidence), ''))
  returning id into v_id;
  perform hr_private.notify_permission_holders('payroll.manage', 'payroll.query_submitted', 'Payroll query raised',
    'An employee raised a payroll query about a payslip.', '/hr/payroll?tab=corrections', 'hr_payroll_correction_requests', v_id::text, v_me);
  return v_id;
end $$;

create or replace function public.hr_create_payroll_correction_request(p_run uuid, p_employee uuid, p_category text, p_description text, p_evidence text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; run public.hr_payroll_runs;
begin
  if not hr_private.has_permission('payroll.manage') then perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden'); end if;
  perform hr_private.payroll_assert_not_self(p_employee, 'raise a payroll correction');
  select * into run from public.hr_payroll_runs where id = p_run;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status not in ('finalized','paid') then perform hr_private.fail('Corrections apply to finalized runs only; use an adjustment for open runs.', 'invalid_state'); end if;
  if not exists (select 1 from public.hr_payroll_items where run_id = p_run and employee_id = p_employee) then
    perform hr_private.fail('This employee was not part of that payroll run.', 'not_in_run');
  end if;
  if p_category is null or p_category not in ('missing_earning','incorrect_deduction','loss_of_pay','attendance_change','leave_change','reimbursement','statutory','other') then
    perform hr_private.fail('Choose a category.', 'invalid_category');
  end if;
  if length(btrim(coalesce(p_description, ''))) < 5 then perform hr_private.fail('Describe the correction (at least 5 characters).', 'description_required'); end if;
  insert into public.hr_payroll_correction_requests (employee_id, run_id, payslip_id, raised_via, category, description, evidence_note)
  values (p_employee, p_run, (select id from public.hr_payslips where run_id = p_run and employee_id = p_employee), 'payroll',
          p_category, btrim(p_description), nullif(btrim(p_evidence), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.hr_prepare_payroll_correction(p_id uuid, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.hr_payroll_correction_requests;
begin
  if not hr_private.has_permission('payroll.manage') then perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden'); end if;
  select * into q from public.hr_payroll_correction_requests where id = p_id for update;
  if q.id is null then perform hr_private.fail('Correction request not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(q.employee_id, 'prepare a payroll correction');
  if q.status not in ('submitted','prepared') then perform hr_private.fail('This request has already been ' || q.status || '.', 'invalid_state'); end if;
  if p_amount is null or p_amount = 0 then perform hr_private.fail('Enter the correction amount (positive to pay, negative to recover).', 'invalid_amount'); end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then perform hr_private.fail('Explain how the amount was calculated.', 'note_required'); end if;
  update public.hr_payroll_correction_requests set status = 'prepared', proposed_amount = round(p_amount, 2), prepared_by = auth.uid(),
         prepared_at = now(), preparation_note = btrim(p_note)
   where id = p_id returning * into q;
  perform hr_private.notify_permission_holders('payroll.approve', 'payroll.correction_prepared', 'Payroll correction awaiting approval',
    'A payroll correction is waiting for approval.', '/hr/payroll?tab=corrections', 'hr_payroll_correction_requests', q.id::text, q.employee_id);
  return to_jsonb(q);
end $$;

create or replace function public.hr_decide_payroll_correction(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.hr_payroll_correction_requests; a public.hr_payroll_adjustments;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to approve payroll corrections.', 'forbidden'); end if;
  select * into q from public.hr_payroll_correction_requests where id = p_id for update;
  if q.id is null then perform hr_private.fail('Correction request not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(q.employee_id, 'decide a payroll correction');
  if coalesce(p_approve, false) then
    if q.status <> 'prepared' then perform hr_private.fail('Only prepared corrections can be approved.', 'invalid_state'); end if;
    if auth.uid() = q.prepared_by or auth.uid() = q.raised_by then
      perform hr_private.fail('A correction must be approved by someone other than the person who raised or prepared it.', 'separation_of_duties');
    end if;
    a := hr_private.payroll_post_correction(q.run_id, q.employee_id, q.proposed_amount,
           'Correction request (' || replace(q.category, '_', ' ') || '): ' || coalesce(q.preparation_note, q.description), q.prepared_by, q.id, auth.uid());
    update public.hr_payroll_correction_requests set status = 'applied', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(p_note), ''), adjustment_id = a.id
     where id = p_id returning * into q;
    perform hr_private.notify_employee(q.employee_id, 'payroll.correction_applied', 'Payroll correction approved',
      'A correction of ' || q.proposed_amount || ' will be applied in your next payslip.', '/employee/payslips', 'hr_payroll_correction_requests', q.id::text);
  else
    if q.status not in ('submitted','prepared') then perform hr_private.fail('This request has already been ' || q.status || '.', 'invalid_state'); end if;
    if length(btrim(coalesce(p_note, ''))) < 3 then perform hr_private.fail('Please give a reason for rejecting.', 'note_required'); end if;
    update public.hr_payroll_correction_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note)
     where id = p_id returning * into q;
    perform hr_private.notify_employee(q.employee_id, 'payroll.correction_rejected', 'Payroll query closed',
      'Your payroll query was reviewed and closed: ' || left(btrim(p_note), 200), '/employee/payslips', 'hr_payroll_correction_requests', q.id::text);
  end if;
  return to_jsonb(q);
end $$;

-- ---------------------------------------------------------------------
-- Final-settlement coverage
-- ---------------------------------------------------------------------
create or replace function public.hr_record_settlement_coverage(p_employee uuid, p_covered_through date, p_reference text,
  p_note text default null, p_exit uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.hr_payroll_settlement_coverage; v_paid_through date;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to record final settlements.', 'forbidden'); end if;
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
end $$;

create or replace function public.hr_void_settlement_coverage(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.hr_payroll_settlement_coverage;
begin
  if not hr_private.has_permission('payroll.approve') then perform hr_private.fail('You are not allowed to record final settlements.', 'forbidden'); end if;
  select * into c from public.hr_payroll_settlement_coverage where id = p_id for update;
  if c.id is null then perform hr_private.fail('Settlement coverage not found.', 'not_found'); end if;
  perform hr_private.payroll_assert_not_self(c.employee_id, 'void a final-settlement coverage');
  if c.status <> 'active' then perform hr_private.fail('Already void.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason.', 'reason_required'); end if;
  update public.hr_payroll_settlement_coverage set status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason)
   where id = p_id returning * into c;
  return to_jsonb(c);
end $$;

-- ---------------------------------------------------------------------
-- Overview, reports, exports
-- ---------------------------------------------------------------------
create or replace function public.hr_payroll_overview(p_month date default null, p_legal_entity uuid default null,
  p_department uuid default null, p_employee uuid default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from date; v_to date; v_runs uuid[]; v jsonb;
begin
  if not hr_private.has_permission('payroll.view') then perform hr_private.fail('You are not allowed to view payroll.', 'forbidden'); end if;
  v_from := date_trunc('month', coalesce(p_month, (select max(r.period_start) from public.hr_payroll_runs r), hr_private.business_today()))::date;
  v_to := (v_from + interval '1 month' - interval '1 day')::date;
  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_runs from public.hr_payroll_runs r
   where r.period_start <= v_to and r.period_end >= v_from
     and (p_legal_entity is null or r.legal_entity_id is null or r.legal_entity_id = p_legal_entity)
     and (p_status is null or r.status = p_status or r.payment_status = p_status);
  with it as (
    select i.* from public.hr_payroll_items i join public.hr_employees e on e.id = i.employee_id
    where i.run_id = any(v_runs)
      and (p_department is null or e.department_id = p_department)
      and (p_employee is null or i.employee_id = p_employee)
      and (p_legal_entity is null or e.legal_entity_id = p_legal_entity)
  ), pay as (
    select p.* from public.hr_payroll_payments p join it on it.id = p.item_id
  )
  select jsonb_build_object(
    'month', v_from, 'month_end', v_to,
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'period_start', r.period_start, 'period_end', r.period_end,
               'status', r.status, 'payment_status', r.payment_status,
               'legal_entity', (select le.name from public.hr_legal_entities le where le.id = r.legal_entity_id),
               'employees', (select count(*) from it where it.run_id = r.id),
               'gross', (select coalesce(sum(it.gross), 0) from it where it.run_id = r.id),
               'deductions', (select coalesce(sum(it.total_deductions), 0) from it where it.run_id = r.id),
               'net', (select coalesce(sum(it.net), 0) from it where it.run_id = r.id),
               'items_with_errors', coalesce((r.validation ->> 'items_with_errors')::int, 0),
               'items_with_warnings', coalesce((r.validation ->> 'items_with_warnings')::int, 0)) order by r.period_start desc), '[]'::jsonb)
             from public.hr_payroll_runs r where r.id = any(v_runs)),
    'totals', (select jsonb_build_object('employees', count(distinct it.employee_id), 'gross', coalesce(sum(it.gross), 0),
               'deductions', coalesce(sum(it.total_deductions), 0), 'employer_contributions', coalesce(sum(it.employer_contributions), 0),
               'reimbursements', coalesce(sum(it.reimbursements), 0), 'net', coalesce(sum(it.net), 0)) from it),
    'payments', (select coalesce(jsonb_object_agg(x.status, jsonb_build_object('count', x.n, 'amount', x.amt, 'amount_paid', x.paid)), '{}'::jsonb)
                 from (select pay.status, count(*) n, sum(pay.amount) amt, sum(pay.amount_paid) paid from pay group by pay.status) x),
    'pending', jsonb_build_object(
       'runs_to_submit', (select count(*) from public.hr_payroll_runs where status = 'calculated'),
       'runs_to_approve', (select count(*) from public.hr_payroll_runs where status = 'reviewed'),
       'runs_to_finalize', (select count(*) from public.hr_payroll_runs where status = 'approved'),
       'runs_payment_open', (select count(*) from public.hr_payroll_runs where status = 'finalized'),
       'structures', (select count(*) from public.hr_salary_structures where status = 'pending_approval'),
       'adjustments', (select count(*) from public.hr_payroll_adjustments where status = 'pending'),
       'statutory_rules', (select count(*) from public.hr_payroll_statutory_rules where status = 'pending_validation'),
       'corrections_to_prepare', (select count(*) from public.hr_payroll_correction_requests where status = 'submitted'),
       'corrections_to_approve', (select count(*) from public.hr_payroll_correction_requests where status = 'prepared'),
       'bank_accounts_unverified', (select count(*) from public.hr_employee_bank_accounts where active and is_primary and not verified)),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('month', t.m, 'gross', t.g, 'net', t.n) order by t.m), '[]'::jsonb) from (
        select date_trunc('month', r.period_start)::date m, sum(i.gross) g, sum(i.net) n
        from public.hr_payroll_runs r join public.hr_payroll_items i on i.run_id = r.id
        where r.status in ('approved','finalized','paid') and r.period_start >= (v_from - interval '5 months') and r.period_start <= v_to
        group by 1) t)
  ) into v;
  return v;
end $$;

create or replace function public.hr_payroll_statutory_report(p_run uuid)
returns table (employee_id uuid, employee_code text, employee_name text, rule_code text, state_code text,
               contribution_base numeric, employee_amount numeric, employer_amount numeric, validation_reference text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('payroll.view') then perform hr_private.fail('You are not allowed to view payroll.', 'forbidden'); end if;
  return query
    select i.employee_id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
           x ->> 'code', x ->> 'state_code',
           sum((x ->> 'contribution_base')::numeric), sum((x ->> 'employee_amount')::numeric), sum((x ->> 'employer_amount')::numeric),
           max(x ->> 'validation_reference')
    from public.hr_payroll_items i join public.hr_employees e on e.id = i.employee_id
         cross join lateral jsonb_array_elements(coalesce(i.breakdown -> 'statutory', '[]'::jsonb)) x
    where i.run_id = p_run and (x ->> 'applied')::boolean
    group by i.employee_id, e.employee_code, e.display_name, e.first_name, e.last_name, x ->> 'code', x ->> 'state_code'
    order by x ->> 'code', e.employee_code;
end $$;

-- Leave / attendance changed after a run was finalized: candidates for a correction.
create or replace function public.hr_payroll_post_finalization_changes(p_run uuid)
returns table (change_type text, employee_id uuid, employee_code text, employee_name text, record_id uuid, work_date date, detail text, changed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare run public.hr_payroll_runs;
begin
  if not hr_private.has_permission('payroll.view') then perform hr_private.fail('You are not allowed to view payroll.', 'forbidden'); end if;
  select * into run from public.hr_payroll_runs where id = p_run;
  if run.id is null or run.finalized_at is null then return; end if;
  return query
    select 'leave'::text, lr.employee_id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), lr.id, lr.start_date,
           t.name || ' ' || lr.status || ' (' || to_char(lr.start_date, 'DD Mon') || ' - ' || to_char(lr.end_date, 'DD Mon') || ')' ||
           case when t.paid then '' else ' · unpaid' end, lr.updated_at
    from public.hr_leave_requests lr
         join public.hr_leave_types t on t.id = lr.leave_type_id
         join public.hr_employees e on e.id = lr.employee_id
    where exists (select 1 from public.hr_payroll_items i where i.run_id = p_run and i.employee_id = lr.employee_id)
      and lr.start_date <= run.period_end and lr.end_date >= run.period_start
      and lr.updated_at > run.finalized_at and lr.status in ('approved','cancelled')
    union all
    select 'attendance', a.employee_id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), a.id, a.work_date,
           'Attendance now ' || replace(a.status, '_', ' '), a.updated_at
    from public.hr_attendance a join public.hr_employees e on e.id = a.employee_id
    where exists (select 1 from public.hr_payroll_items i where i.run_id = p_run and i.employee_id = a.employee_id)
      and a.work_date between run.period_start and run.period_end and a.updated_at > run.finalized_at
    order by 8 desc;
end $$;

create or replace function public.hr_log_payroll_export(p_kind text, p_run uuid default null, p_rows int default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('payroll.export') then perform hr_private.fail('You are not allowed to export payroll data.', 'forbidden'); end if;
  if p_kind is null or p_kind !~ '^[a-z_]{3,40}$' then perform hr_private.fail('Invalid export type.', 'invalid_kind'); end if;
  perform hr_private.audit_event('PAYROLL_EXPORT', 'hr_payroll_runs', p_run::text, jsonb_build_object('kind', p_kind, 'rows', p_rows));
end $$;

-- ---------------------------------------------------------------------
-- Employee self-service
-- ---------------------------------------------------------------------
create or replace function public.hr_my_salary_structure()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  if not hr_private.payroll_cfg_bool('employee_can_view_salary_structure', true) then
    return jsonb_build_object('visible', false);
  end if;
  select s.id into v_id from public.hr_salary_structures s
   where s.employee_id = v_me and s.status = 'active' and s.effective_from <= hr_private.business_today()
   order by s.effective_from desc limit 1;
  return jsonb_build_object('visible', true,
    'current', case when v_id is null then null else hr_private.structure_monthly_lines(v_id) end,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('effective_from', s.effective_from, 'effective_to', s.effective_to,
                                          'currency', s.currency, 'revision_reason', s.revision_reason) order by s.effective_from desc), '[]'::jsonb)
                from public.hr_salary_structures s where s.employee_id = v_me and s.status = 'active'));
end $$;

create or replace function public.hr_my_payroll_payments()
returns table (payslip_id uuid, run_id uuid, period_start date, period_end date, currency text, net numeric,
               status text, amount_paid numeric, payment_date date, method text)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id();
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  return query
    select ps.id, ps.run_id, ps.period_start, ps.period_end, ps.currency, ps.net,
           coalesce(p.status, case when r.status = 'paid' then 'paid' else 'pending' end),
           coalesce(p.amount_paid, case when r.status = 'paid' then ps.net else 0 end), p.payment_date, p.method
    from public.hr_payslips ps join public.hr_payroll_runs r on r.id = ps.run_id
         left join public.hr_payroll_payments p on p.run_id = ps.run_id and p.employee_id = ps.employee_id
    where ps.employee_id = v_me and ps.published_at is not null and r.status in ('finalized','paid')
    order by ps.period_start desc;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'hr_submit_statutory_rule','hr_approve_statutory_rule','hr_return_statutory_rule',
      'hr_salary_structure_preview','hr_submit_salary_structure','hr_approve_salary_structure','hr_reject_salary_structure',
      'hr_create_salary_revision','hr_end_salary_structure','hr_verify_bank_account',
      'hr_create_payroll_run','hr_set_payroll_hold','hr_calculate_payroll_run','hr_add_payroll_adjustment','hr_decide_payroll_adjustment',
      'hr_review_payroll_run','hr_return_payroll_run','hr_approve_payroll_run','hr_finalize_payroll_run',
      'hr_record_payroll_payments','hr_reconcile_payroll_payments','hr_mark_payroll_paid',
      'hr_create_payroll_correction','hr_submit_payroll_query','hr_create_payroll_correction_request',
      'hr_prepare_payroll_correction','hr_decide_payroll_correction',
      'hr_record_settlement_coverage','hr_void_settlement_coverage',
      'hr_payroll_overview','hr_payroll_statutory_report','hr_payroll_post_finalization_changes','hr_log_payroll_export',
      'hr_my_salary_structure','hr_my_payroll_payments'])
  loop
    execute format('revoke execute on function %s from anon, public', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

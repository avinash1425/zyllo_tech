-- =====================================================================
-- 160_hr_leave_management.sql — Leave Management enhancements (Module 6)
-- =====================================================================
-- Builds on 103_hr_leave.sql. Nothing is replaced wholesale: the tested
-- apply / decide / cancel RPCs from 103 move to hr_private.*_core and the
-- public functions become thin wrappers (same pattern as 116), so every
-- existing rule, message and notification is kept.
--
-- Adds
--   * Configurable, versioned leave POLICIES: eligibility by employment
--     type, min/max days per request, advance notice, quarterly accrual,
--     carry-forward expiry, effective dates. Changes are maker-checker
--     ("policy_approval": "required", the default): one HR user proposes,
--     another approves. Every applied change is snapshotted in
--     hr_leave_policy_versions; requests record the version applied.
--   * Transactional balance LEDGER (hr_leave_ledger): a trigger records
--     every change to every balance bucket (whatever code path made it),
--     linked to the request it belongs to. Unique keys make a second
--     reserve / consume / release / restore for the same request impossible
--     (no double deduction even if a bug retried an approval).
--   * Stored per-day leave breakdown (hr_leave_request_days). It is the
--     authoritative "which day, how much" source for attendance and payroll,
--     so later holiday edits cannot silently change approved leave.
--   * Holiday-change review: editing hr_holidays flags affected pending /
--     approved requests (holiday_review_required) instead of changing them;
--     an approver recalculates explicitly (audited, ledgered).
--   * Opening balances, carry-forward expiry, year-end close (frozen years,
--     carry-forward true-up), real supporting documents (hr_documents).
--   * Read RPCs: overview, scoped team calendar (private details masked),
--     my holidays, attendance leave days, payroll leave summary.
--
-- Holidays: hr_holidays (103) remains the single holiday master shared with
-- Attendance & Time. If migration 125 (attendance) is present it owns
-- is_holiday / holiday_on; this migration only defines a fallback.
--
-- Leave year = calendar year (unchanged).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Internal schema. Helpers that write data or would bypass a wrapper's
-- checks (the 103 apply/decide/cancel cores, the policy writer, ledger
-- context/linking, expiry) live here: no grants to API roles, and
-- unaffected by blanket "grant execute on all functions in schema
-- hr_private" statements in other migrations. Only SECURITY DEFINER code in
-- 160 (running as the owner) calls them.
-- ---------------------------------------------------------------------
create schema if not exists hr_leave_internal;
revoke all on schema hr_leave_internal from public, anon, authenticated;
alter default privileges in schema hr_leave_internal revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- 0. Settings (only missing keys are added; existing values win)
-- ---------------------------------------------------------------------
update public.hr_settings
   set value = jsonb_build_object('policy_approval', 'required') || value
 where key = 'leave';

-- Context for ledger entries written by the RPCs below (transaction-local).
create or replace function hr_leave_internal.leave_ctx_set(p jsonb)
returns void language plpgsql set search_path = '' as $$ begin perform set_config('hr.leave_ctx', p::text, true); end $$;
create or replace function hr_leave_internal.leave_ctx_clear()
returns void language plpgsql set search_path = '' as $$ begin perform set_config('hr.leave_ctx', '', true); end $$;
create or replace function hr_leave_internal.leave_ctx()
returns jsonb language sql stable set search_path = '' as $$ select nullif(current_setting('hr.leave_ctx', true), '')::jsonb $$;

-- ---------------------------------------------------------------------
-- 1. Holidays: company (legal entity) scope. Same column / index as 125.
-- ---------------------------------------------------------------------
alter table public.hr_holidays
  add column if not exists legal_entity_id uuid references public.hr_legal_entities(id) on delete cascade;
alter table public.hr_holidays drop constraint if exists hr_holidays_holiday_date_location_id_key;
create unique index if not exists hr_holidays_scope_unique on public.hr_holidays
  (holiday_date, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Fallback is_holiday with location + company applicability. When 125 is
-- applied it defines hr_private.holiday_on and its is_holiday stays.
do $do$
begin
  if to_regprocedure('hr_private.holiday_on(date,uuid,boolean)') is null then
    execute $f$
      create or replace function hr_private.is_holiday(p_date date, p_employee uuid default null)
      returns boolean language sql stable security definer set search_path = '' as $b$
        select exists (
          select 1 from public.hr_holidays h
          left join public.hr_employees e on e.id = p_employee
          where h.holiday_date = p_date and h.type <> 'optional'
            and (h.location_id is null or h.location_id = e.work_location_id)
            and (h.legal_entity_id is null or h.legal_entity_id = e.legal_entity_id))
      $b$ $f$;
  end if;
end $do$;

-- ---------------------------------------------------------------------
-- 2. Leave policy columns
-- ---------------------------------------------------------------------
alter table public.hr_leave_types
  add column if not exists eligible_employment_types text[],                       -- null = every employment type
  add column if not exists min_days_per_request numeric(5,1) check (min_days_per_request > 0),
  add column if not exists max_days_per_request numeric(5,1) check (max_days_per_request > 0),
  add column if not exists min_notice_days smallint check (min_notice_days between 0 and 365),
  add column if not exists carry_forward_expiry_months smallint check (carry_forward_expiry_months between 1 and 12),
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists policy_version int not null default 1;
alter table public.hr_leave_types drop constraint if exists hr_leave_types_accrual_check;
alter table public.hr_leave_types add constraint hr_leave_types_accrual_check check (accrual in ('monthly','quarterly','annual','none'));
-- 0 = a document is always required.
alter table public.hr_leave_types drop constraint if exists hr_leave_types_requires_document_after_days_check;
alter table public.hr_leave_types add constraint hr_leave_types_requires_document_after_days_check check (requires_document_after_days >= 0);
alter table public.hr_leave_types add constraint hr_leave_types_entitlement_max check (annual_entitlement <= 366 and carry_forward_max <= 366);
alter table public.hr_leave_types add constraint hr_leave_types_request_range check (max_days_per_request is null or min_days_per_request is null or max_days_per_request >= min_days_per_request);
alter table public.hr_leave_types add constraint hr_leave_types_effective_range check (effective_to is null or effective_from is null or effective_to >= effective_from);

-- Policy change requests (maker-checker) and applied versions.
create table public.hr_leave_policy_changes (
  id             uuid primary key default gen_random_uuid(),
  leave_type_id  uuid references public.hr_leave_types(id) on delete restrict,   -- null until a new type is created
  action         text not null check (action in ('create','update')),
  proposed       jsonb not null check (jsonb_typeof(proposed) = 'object'),
  previous       jsonb,
  base_version   int,
  reason         text not null check (length(btrim(reason)) between 3 and 1000),
  effective_from date,
  status         text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  proposed_by    uuid default auth.uid(),
  proposed_at    timestamptz not null default now(),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text check (length(decision_note) <= 1000),
  applied_version int
);
create unique index hr_leave_policy_changes_one_pending on public.hr_leave_policy_changes(leave_type_id) where status = 'pending' and leave_type_id is not null;
create unique index hr_leave_policy_changes_one_pending_code on public.hr_leave_policy_changes((proposed ->> 'code')) where status = 'pending' and action = 'create';
select hr_private.secure_table('public.hr_leave_policy_changes');
select hr_private.enable_audit('public.hr_leave_policy_changes');
create policy hr_leave_policy_changes_read on public.hr_leave_policy_changes for select to authenticated
  using (hr_private.has_permission('leave.manage') or hr_private.has_permission('leave.view'));
revoke insert, update, delete, truncate on public.hr_leave_policy_changes from authenticated;

create table public.hr_leave_policy_versions (
  id             uuid primary key default gen_random_uuid(),
  leave_type_id  uuid not null references public.hr_leave_types(id) on delete restrict,
  version        int not null,
  snapshot       jsonb not null,
  effective_from date,
  change_id      uuid references public.hr_leave_policy_changes(id) on delete restrict,
  changed_by     uuid,
  created_at     timestamptz not null default now(),
  unique (leave_type_id, version)
);
select hr_private.secure_table('public.hr_leave_policy_versions');
create policy hr_leave_policy_versions_read on public.hr_leave_policy_versions for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('leave.view') or hr_private.has_permission('leave.manage'));
revoke insert, update, delete, truncate on public.hr_leave_policy_versions from authenticated;

-- Validation + maker-checker gate + version bump.
create or replace function hr_private.leave_types_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_bad text;
begin
  if auth.uid() is not null
     and coalesce(hr_private.setting('leave') ->> 'policy_approval', 'required') = 'required'
     and coalesce(current_setting('hr.leave_policy_apply', true), '') <> 'on' then
    perform hr_private.fail('Leave policy changes need a second HR approver. Submit the change as a policy change request.', 'policy_approval_required');
  end if;
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    perform hr_private.fail('A leave type code cannot be changed.', 'immutable');
  end if;
  if new.eligible_employment_types is not null then
    if cardinality(new.eligible_employment_types) = 0 then
      new.eligible_employment_types := null;
    else
      select x into v_bad from unnest(new.eligible_employment_types) x
       where not exists (select 1 from public.hr_employment_types et where et.code = x) limit 1;
      if v_bad is not null then perform hr_private.fail('Unknown employment type: ' || v_bad || '.', 'invalid'); end if;
    end if;
  end if;
  if not new.allow_negative then new.max_negative := null; end if;
  if tg_op = 'INSERT' then
    new.policy_version := 1;
  elsif (to_jsonb(new) - 'updated_at' - 'policy_version') is distinct from (to_jsonb(old) - 'updated_at' - 'policy_version') then
    new.policy_version := old.policy_version + 1;
  else
    new.policy_version := old.policy_version;
  end if;
  return new;
end $$;
create trigger hr_leave_types_guard before insert or update on public.hr_leave_types
  for each row execute function hr_private.leave_types_guard();

create or replace function hr_private.leave_types_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.policy_version <> old.policy_version then
    insert into public.hr_leave_policy_versions (leave_type_id, version, snapshot, effective_from, change_id, changed_by)
    values (new.id, new.policy_version, to_jsonb(new) - 'created_at' - 'updated_at',
            coalesce(nullif(current_setting('hr.leave_policy_effective', true), '')::date, hr_private.business_today()),
            nullif(current_setting('hr.leave_policy_change', true), '')::uuid, auth.uid())
    on conflict (leave_type_id, version) do nothing;
  end if;
  return null;
end $$;
create trigger hr_leave_types_version after insert or update on public.hr_leave_types
  for each row execute function hr_private.leave_types_version();

insert into public.hr_leave_policy_versions (leave_type_id, version, snapshot, effective_from)
select t.id, t.policy_version, to_jsonb(t) - 'created_at' - 'updated_at', t.created_at::date from public.hr_leave_types t
on conflict (leave_type_id, version) do nothing;

-- Further common leave types, INACTIVE with zero entitlement: HR sets the
-- company's own entitlement and activates them (no statutory values here).
insert into public.hr_leave_types (code, name, description, paid, annual_entitlement, accrual, carry_forward_max, allow_half_day,
                                   allow_during_probation, active, sort_order) values
  ('ML', 'Maternity Leave',  'Configure the entitlement per company policy before activating.', true, 0, 'annual', 0, false, true, false, 5),
  ('PL', 'Paternity Leave',  'Configure the entitlement per company policy before activating.', true, 0, 'annual', 0, false, true, false, 6),
  ('CO', 'Compensatory Off', 'Credited by HR as a balance adjustment for approved extra work. Activate only if company policy uses it.',
   true, 0, 'none', 0, true, true, false, 7)
on conflict do nothing;

-- Eligibility (null = eligible). Probation is checked by the 103 core.
create or replace function hr_private.leave_type_eligibility(p_type uuid, p_employee uuid, p_start date default null, p_end date default null)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when lt.eligible_employment_types is not null and not (e.employment_type = any(lt.eligible_employment_types))
      then lt.name || ' is not available for your employment type.'
    when p_start is not null and lt.effective_from is not null and p_start < lt.effective_from
      then lt.name || ' can only be taken from ' || to_char(lt.effective_from, 'DD Mon YYYY') || '.'
    when p_end is not null and lt.effective_to is not null and p_end > lt.effective_to
      then lt.name || ' cannot be taken after ' || to_char(lt.effective_to, 'DD Mon YYYY') || '.'
  end
  from public.hr_leave_types lt, public.hr_employees e
  where lt.id = p_type and e.id = p_employee
$$;

-- ---------------------------------------------------------------------
-- 3. Policy change workflow
-- ---------------------------------------------------------------------
create or replace function hr_private.leave_policy_fields()
returns text[] language sql immutable set search_path = '' as $$
  select array['name','description','paid','annual_entitlement','accrual','carry_forward_max','carry_forward_expiry_months',
               'allow_half_day','requires_document_after_days','allow_during_probation','allow_negative','max_negative',
               'counts_weekends','counts_holidays','active','sort_order','eligible_employment_types','min_days_per_request',
               'max_days_per_request','min_notice_days','effective_from','effective_to']
$$;

-- Insert (p_type null) or update a leave type from a jsonb of policy fields.
create or replace function hr_leave_internal.leave_policy_write(p_type uuid, p_changes jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.hr_leave_types;
begin
  -- Defence in depth: hr_private is not exposed by the API, but EXECUTE on it
  -- is granted broadly by later migrations; never write policy for a caller
  -- who could not propose it.
  if auth.uid() is not null and not hr_private.has_permission('leave.manage') then
    perform hr_private.fail('You are not allowed to change leave policies.', 'forbidden');
  end if;
  perform set_config('hr.leave_policy_apply', 'on', true);
  if p_type is null then
    v := jsonb_populate_record(null::public.hr_leave_types,
      jsonb_build_object('id', gen_random_uuid(), 'created_at', now(), 'updated_at', now(), 'paid', true, 'annual_entitlement', 0,
                         'accrual', 'annual', 'carry_forward_max', 0, 'allow_half_day', true, 'allow_during_probation', true,
                         'allow_negative', false, 'counts_weekends', false, 'counts_holidays', false, 'active', true,
                         'sort_order', 10, 'policy_version', 1) || p_changes);
    v.code := upper(btrim(v.code));
    insert into public.hr_leave_types select (v).*;
  else
    select * into v from public.hr_leave_types where id = p_type for update;
    if v.id is null then perform hr_private.fail('Leave type not found.', 'not_found'); end if;
    v := jsonb_populate_record(v, p_changes - 'id' - 'code' - 'policy_version' - 'created_at' - 'updated_at');
    update public.hr_leave_types x set
      name = v.name, description = v.description, paid = v.paid, annual_entitlement = v.annual_entitlement, accrual = v.accrual,
      carry_forward_max = v.carry_forward_max, carry_forward_expiry_months = v.carry_forward_expiry_months,
      allow_half_day = v.allow_half_day, requires_document_after_days = v.requires_document_after_days,
      allow_during_probation = v.allow_during_probation, allow_negative = v.allow_negative, max_negative = v.max_negative,
      counts_weekends = v.counts_weekends, counts_holidays = v.counts_holidays, active = v.active, sort_order = v.sort_order,
      eligible_employment_types = v.eligible_employment_types, min_days_per_request = v.min_days_per_request,
      max_days_per_request = v.max_days_per_request, min_notice_days = v.min_notice_days,
      effective_from = v.effective_from, effective_to = v.effective_to
    where x.id = p_type;
  end if;
  perform set_config('hr.leave_policy_apply', '', true);
  return v.id;
end $$;

-- Validate by applying inside a sub-transaction that is always rolled back.
create or replace function hr_leave_internal.leave_policy_dry_run(p_type uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_con text;
begin
  begin
    perform hr_leave_internal.leave_policy_write(p_type, p_changes);
    raise exception using errcode = 'HR999', message = 'dry run';
  exception
    when sqlstate 'HR999' then null;
    when unique_violation then perform hr_private.fail('A leave type with this code or name already exists.', 'duplicate');
    when check_violation or not_null_violation or invalid_text_representation or datatype_mismatch or numeric_value_out_of_range then
      get stacked diagnostics v_con = constraint_name;
      perform hr_private.fail('Invalid policy value' || coalesce(' (' || v_con || ')', '') || ': ' || sqlerrm, 'invalid');
  end;
end $$;

create or replace function hr_leave_internal.leave_policy_commit(p_change uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.hr_leave_policy_changes; v_cur int; v_id uuid;
begin
  select * into c from public.hr_leave_policy_changes where id = p_change for update;
  if c.leave_type_id is not null then
    select policy_version into v_cur from public.hr_leave_types where id = c.leave_type_id for update;
    if v_cur is distinct from c.base_version then
      perform hr_private.fail('The policy has changed since this request was made. Ask for a fresh proposal.', 'stale');
    end if;
  end if;
  perform set_config('hr.leave_policy_change', c.id::text, true);
  perform set_config('hr.leave_policy_effective', coalesce(c.effective_from, hr_private.business_today())::text, true);
  v_id := hr_leave_internal.leave_policy_write(c.leave_type_id, c.proposed);
  perform set_config('hr.leave_policy_change', '', true);
  perform set_config('hr.leave_policy_effective', '', true);
  update public.hr_leave_policy_changes
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), ''), leave_type_id = v_id,
         applied_version = (select policy_version from public.hr_leave_types where id = v_id)
   where id = p_change;
end $$;

create or replace function public.hr_propose_leave_policy(p_leave_type uuid, p_changes jsonb, p_reason text, p_effective_from date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_bad text;
  v_cur public.hr_leave_types;
  v_changes jsonb;
  v_mode text := coalesce(hr_private.setting('leave') ->> 'policy_approval', 'required');
  c public.hr_leave_policy_changes;
begin
  if not hr_private.has_permission('leave.manage') then
    perform hr_private.fail('You are not allowed to change leave policies.', 'forbidden');
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    perform hr_private.fail('No policy changes were given.', 'invalid');
  end if;
  select k into v_bad from jsonb_object_keys(p_changes) k
   where not (k = any(hr_private.leave_policy_fields())) and not (k = 'code' and p_leave_type is null) limit 1;
  if v_bad is not null then perform hr_private.fail('Unknown or read-only policy field: ' || v_bad || '.', 'invalid_field'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform hr_private.fail('Give a reason for the policy change.', 'reason_required');
  end if;
  -- Approved changes apply immediately (there is no scheduled activation), so
  -- a future "effective" date would be misleading: refuse it. A past date is
  -- kept only as the documented decision date; nothing is recalculated.
  if p_effective_from is not null and p_effective_from > hr_private.business_today() then
    perform hr_private.fail('Future-dated policy changes are not supported: an approved change applies immediately. '
                            || 'Submit it on or after the date it should start, or limit when leave can be taken with "Leave can be taken from".',
                            'future_effective_date');
  end if;
  if p_leave_type is not null then
    select * into v_cur from public.hr_leave_types where id = p_leave_type;
    if v_cur.id is null then perform hr_private.fail('Leave type not found.', 'not_found'); end if;
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_changes
      from jsonb_each(p_changes) x(k, v) where (to_jsonb(v_cur) -> k) is distinct from v;
    if v_changes = '{}'::jsonb then perform hr_private.fail('Nothing would change.', 'no_change'); end if;
    if exists (select 1 from public.hr_leave_policy_changes where leave_type_id = p_leave_type and status = 'pending') then
      perform hr_private.fail('There is already a pending change for this leave type.', 'pending_exists');
    end if;
  else
    v_changes := p_changes;
    if length(btrim(coalesce(v_changes ->> 'code', ''))) = 0 or length(btrim(coalesce(v_changes ->> 'name', ''))) = 0 then
      perform hr_private.fail('Code and name are required for a new leave type.', 'invalid');
    end if;
    v_changes := v_changes || jsonb_build_object('code', upper(btrim(v_changes ->> 'code')));
    if exists (select 1 from public.hr_leave_policy_changes where action = 'create' and status = 'pending' and proposed ->> 'code' = v_changes ->> 'code') then
      perform hr_private.fail('A new leave type with this code is already awaiting approval.', 'pending_exists');
    end if;
  end if;

  perform hr_leave_internal.leave_policy_dry_run(p_leave_type, v_changes);

  insert into public.hr_leave_policy_changes (leave_type_id, action, proposed, previous, base_version, reason, effective_from)
  values (p_leave_type, case when p_leave_type is null then 'create' else 'update' end, v_changes,
          case when p_leave_type is not null then (select coalesce(jsonb_object_agg(k, to_jsonb(v_cur) -> k), '{}'::jsonb) from jsonb_object_keys(v_changes) k) end,
          v_cur.policy_version, btrim(p_reason), p_effective_from)
  returning * into c;

  if v_mode <> 'required' then
    perform hr_leave_internal.leave_policy_commit(c.id, 'Applied directly: the leave settings do not require a second approver.');
    select * into c from public.hr_leave_policy_changes where id = c.id;
  else
    perform hr_private.notify_permission_holders('leave.manage', 'leave.policy_change', 'Leave policy change to review',
      coalesce(v_cur.name, v_changes ->> 'name') || ': ' || btrim(p_reason), '/hr/leave?tab=policies', 'hr_leave_policy_changes', c.id::text,
      hr_private.current_employee_id());
  end if;
  return to_jsonb(c);
end $$;

create or replace function public.hr_decide_leave_policy(p_change uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.hr_leave_policy_changes;
begin
  if not hr_private.has_permission('leave.manage') then
    perform hr_private.fail('You are not allowed to decide leave policy changes.', 'forbidden');
  end if;
  select * into c from public.hr_leave_policy_changes where id = p_change for update;
  if c.id is null then perform hr_private.fail('Policy change not found.', 'not_found'); end if;
  if c.status <> 'pending' then perform hr_private.fail('This policy change is already ' || c.status || '.', 'already_decided'); end if;
  if c.proposed_by is not distinct from auth.uid() then
    perform hr_private.fail('You cannot decide your own policy change; another HR approver must review it.', 'self_approval');
  end if;
  if p_approve is null then perform hr_private.fail('Choose approve or reject.', 'invalid'); end if;
  if p_approve then
    perform hr_leave_internal.leave_policy_commit(c.id, p_note);
  else
    if length(btrim(coalesce(p_note, ''))) < 3 then perform hr_private.fail('Give a reason for rejecting.', 'note_required'); end if;
    update public.hr_leave_policy_changes set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note)
     where id = c.id;
  end if;
  select * into c from public.hr_leave_policy_changes where id = p_change;
  perform hr_private.notify_user(c.proposed_by, 'leave.policy_' || c.status, 'Leave policy change ' || c.status,
    coalesce(c.decision_note, coalesce(c.proposed ->> 'name', 'Leave policy') || ' change ' || c.status || '.'),
    '/hr/leave?tab=policies', 'hr_leave_policy_changes', c.id::text);
  return to_jsonb(c);
end $$;

create or replace function public.hr_withdraw_leave_policy_change(p_change uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.hr_leave_policy_changes;
begin
  select * into c from public.hr_leave_policy_changes where id = p_change for update;
  if c.id is null or c.proposed_by is distinct from auth.uid() then perform hr_private.fail('Policy change not found.', 'not_found'); end if;
  if c.status <> 'pending' then perform hr_private.fail('Only pending changes can be withdrawn.', 'invalid_state'); end if;
  update public.hr_leave_policy_changes set status = 'withdrawn', decided_by = auth.uid(), decided_at = now() where id = c.id returning * into c;
  return to_jsonb(c);
end $$;

-- ---------------------------------------------------------------------
-- 4. Balances: informational columns, ledger, closed years
-- ---------------------------------------------------------------------
-- opening / cf_expired are already included in `adjusted` (available is unchanged).
alter table public.hr_leave_balances
  add column if not exists opening numeric(6,2) not null default 0 check (opening >= 0),
  add column if not exists cf_expires_on date,
  add column if not exists cf_expired numeric(6,2) not null default 0 check (cf_expired >= 0);

alter table public.hr_leave_balance_adjustments drop constraint if exists hr_leave_balance_adjustments_kind_check;
alter table public.hr_leave_balance_adjustments add constraint hr_leave_balance_adjustments_kind_check
  check (kind in ('manual','carry_forward','opening','expiry'));

create table public.hr_leave_years (
  year       int primary key check (year between 2000 and 2100),
  status     text not null default 'open' check (status in ('open','closed')),
  closed_by  uuid,
  closed_at  timestamptz,
  summary    jsonb,
  created_at timestamptz not null default now()
);
select hr_private.secure_table('public.hr_leave_years');
select hr_private.enable_audit('public.hr_leave_years');
create policy hr_leave_years_read on public.hr_leave_years for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('leave.view') or hr_private.has_permission('leave.manage'));
revoke insert, update, delete, truncate on public.hr_leave_years from authenticated;

create or replace function hr_private.leave_year_closed(p_year int)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_leave_years y where y.year = p_year and y.status = 'closed')
$$;

create table public.hr_leave_ledger (
  id              bigint generated always as identity primary key,
  balance_id      uuid not null references public.hr_leave_balances(id) on delete restrict,
  employee_id     uuid not null references public.hr_employees(id) on delete restrict,
  leave_type_id   uuid not null references public.hr_leave_types(id) on delete restrict,
  year            int not null,
  bucket          text not null check (bucket in ('entitled','opening','accrued','carried_forward','adjusted','used','pending','cf_expired')),
  entry_type      text not null check (entry_type in ('create','accrual','opening','carry_forward','adjustment','reserve','release',
                                                      'consume','restore','expiry','recalculation','year_end','system')),
  amount          numeric(7,2) not null check (amount <> 0),
  effect          numeric(7,2) not null,            -- signed effect on `available`
  available_after numeric(7,2),
  request_id      uuid references public.hr_leave_requests(id) on delete restrict,
  reason          text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index hr_leave_ledger_balance on public.hr_leave_ledger(balance_id, id);
create index hr_leave_ledger_emp on public.hr_leave_ledger(employee_id, year);
-- A request reserves, consumes, releases or restores a bucket at most once.
create unique index hr_leave_ledger_request_once on public.hr_leave_ledger(request_id, bucket, entry_type)
  where request_id is not null and entry_type in ('reserve','consume','release','restore');
select hr_private.secure_table('public.hr_leave_ledger');
create policy hr_leave_ledger_read on public.hr_leave_ledger for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'leave'));
revoke insert, update, delete, truncate on public.hr_leave_ledger from authenticated;

create or replace function hr_private.leave_ledger_capture()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ctx jsonb := hr_leave_internal.leave_ctx();
  b text; v_old numeric; v_new numeric; d numeric; v_entry text;
  jn jsonb := to_jsonb(new);
  jo jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  foreach b in array array['entitled','opening','accrued','carried_forward','adjusted','used','pending','cf_expired'] loop
    v_new := coalesce((jn ->> b)::numeric, 0);
    v_old := coalesce((jo ->> b)::numeric, 0);
    d := v_new - v_old;
    continue when d = 0;
    v_entry := coalesce(ctx ->> 'entry', case
      when tg_op = 'INSERT' then 'create'
      when b = 'accrued' then 'accrual'
      when b = 'opening' then 'opening'
      when b = 'carried_forward' then 'carry_forward'
      when b = 'adjusted' then 'adjustment'
      when b = 'cf_expired' then 'expiry'
      when b = 'pending' and d > 0 then 'reserve'
      when b = 'pending' and d < 0 and new.used > old.used then 'consume'
      when b = 'pending' then 'release'
      when b = 'used' and d > 0 then 'consume'
      when b = 'used' then 'restore'
      else 'system' end);
    insert into public.hr_leave_ledger (balance_id, employee_id, leave_type_id, year, bucket, entry_type, amount, effect,
                                        available_after, request_id, reason)
    values (new.id, new.employee_id, new.leave_type_id, new.year, b, v_entry, d,
            case b when 'accrued' then d when 'carried_forward' then d when 'adjusted' then d
                   when 'used' then -d when 'pending' then -d else 0 end,
            new.available, nullif(ctx ->> 'request', '')::uuid, ctx ->> 'reason');
  end loop;
  return null;
end $$;
create trigger hr_leave_balances_ledger after insert or update on public.hr_leave_balances
  for each row execute function hr_private.leave_ledger_capture();

-- Frozen years: no signed-in user may change a closed year's balances.
create or replace function hr_private.leave_balance_year_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and hr_private.leave_year_closed(new.year) then
    perform hr_private.fail('Leave year ' || new.year || ' is closed; its balances can no longer change.', 'year_closed');
  end if;
  return new;
end $$;
create trigger hr_leave_balances_year_guard before insert or update on public.hr_leave_balances
  for each row execute function hr_private.leave_balance_year_guard();
create trigger hr_leave_balance_adjustments_year_guard before insert on public.hr_leave_balance_adjustments
  for each row execute function hr_private.leave_balance_year_guard();

-- Ledger starting point for balances that already exist.
insert into public.hr_leave_ledger (balance_id, employee_id, leave_type_id, year, bucket, entry_type, amount, effect, available_after, reason, created_by)
select b.id, b.employee_id, b.leave_type_id, b.year, x.bucket, 'system', x.amount,
       case when x.bucket in ('used','pending') then -x.amount when x.bucket = 'entitled' then 0 else x.amount end,
       b.available, 'Balance when the ledger started (migration 160)', null
from public.hr_leave_balances b
cross join lateral (values ('entitled', b.entitled), ('accrued', b.accrued), ('carried_forward', b.carried_forward),
                           ('adjusted', b.adjusted), ('used', b.used), ('pending', b.pending)) x(bucket, amount)
where x.amount <> 0;

-- Link ledger rows written by a core RPC call to the request they belong to.
create or replace function hr_leave_internal.leave_link_ledger(p_mark bigint, p_request uuid)
returns void language sql security definer set search_path = '' as $$
  update public.hr_leave_ledger l set request_id = p_request
  from public.hr_leave_requests r
  where r.id = p_request and l.id > p_mark and l.request_id is null
    and l.employee_id = r.employee_id and l.leave_type_id = r.leave_type_id and l.year = r.year
    and l.entry_type in ('reserve','consume','release','restore')
$$;

create or replace function hr_leave_internal.leave_ledger_mark()
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(max(id), 0) from public.hr_leave_ledger
$$;

-- ---------------------------------------------------------------------
-- 5. Accrual (adds quarterly), carry-forward expiry, ensure balance
-- ---------------------------------------------------------------------
create or replace function hr_private.leave_accrued(p_type uuid, p_employee uuid, p_year int, p_as_of date)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  t public.hr_leave_types;
  v_ent numeric := hr_private.leave_entitlement(p_type, p_employee, p_year);
  v_join date;
  v_first int;
  v_last int;
begin
  select * into t from public.hr_leave_types where id = p_type;
  if t.accrual = 'none' then return 0; end if;
  if t.accrual = 'annual' then return v_ent; end if;
  select joining_date into v_join from public.hr_employees where id = p_employee;
  v_first := case when v_join is not null and extract(year from v_join)::int = p_year then extract(month from v_join)::int else 1 end;
  v_last := case when extract(year from p_as_of)::int > p_year then 12
                 when extract(year from p_as_of)::int < p_year then 0
                 else extract(month from p_as_of)::int end;
  if t.accrual = 'quarterly' then
    if v_last = 0 then return 0; end if;
    return least(v_ent, round(t.annual_entitlement / 4.0 * greatest((v_last - 1) / 3 - (v_first - 1) / 3 + 1, 0), 2));
  end if;
  return least(v_ent, round(t.annual_entitlement / 12.0 * greatest(v_last - v_first + 1, 0), 2));
end $$;

create or replace function hr_private.leave_cf_expiry_date(p_type uuid, p_year int)
returns date language sql stable security definer set search_path = '' as $$
  select (make_date(p_year, 1, 1) + make_interval(months => t.carry_forward_expiry_months))::date - 1
  from public.hr_leave_types t where t.id = p_type and t.carry_forward_expiry_months is not null
$$;

-- Expire unused carried-forward days once the expiry date has passed.
-- Approved leave taken up to the expiry date uses carried-forward days first.
create or replace function hr_leave_internal.leave_apply_expiry(p_balance uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare b public.hr_leave_balances; v_used numeric; v numeric; v_name text;
begin
  select * into b from public.hr_leave_balances where id = p_balance;
  if b.id is null or b.cf_expires_on is null or b.carried_forward <= 0 or b.cf_expired > 0
     or hr_private.business_today() <= b.cf_expires_on or hr_private.leave_year_closed(b.year) then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtext('hr_leave:' || b.employee_id::text));
  select * into b from public.hr_leave_balances where id = p_balance for update;
  if b.cf_expired > 0 then return 0; end if;
  select coalesce(sum(d.portion), 0) into v_used
    from public.hr_leave_request_days d join public.hr_leave_requests r on r.id = d.request_id
   where r.employee_id = b.employee_id and r.leave_type_id = b.leave_type_id and r.status = 'approved'
     and d.leave_date between make_date(b.year, 1, 1) and b.cf_expires_on;
  v := greatest(0, least(b.carried_forward - v_used, b.available));
  if v <= 0 then return 0; end if;
  perform hr_leave_internal.leave_ctx_set(jsonb_build_object('entry', 'expiry', 'reason', 'Carried-forward leave expired on ' || to_char(b.cf_expires_on, 'DD Mon YYYY')));
  update public.hr_leave_balances set cf_expired = v, adjusted = adjusted - v where id = b.id;
  perform hr_leave_internal.leave_ctx_clear();
  insert into public.hr_leave_balance_adjustments (balance_id, employee_id, leave_type_id, year, kind, delta, reason, created_by)
  values (b.id, b.employee_id, b.leave_type_id, b.year, 'expiry', -v,
          'Unused carried-forward leave expired on ' || to_char(b.cf_expires_on, 'DD Mon YYYY'), auth.uid());
  select name into v_name from public.hr_leave_types where id = b.leave_type_id;
  perform hr_private.notify_employee(b.employee_id, 'leave.carry_forward_expired', 'Carried-forward leave expired',
    v || ' day(s) of carried-forward ' || v_name || ' expired on ' || to_char(b.cf_expires_on, 'DD Mon YYYY') || '.',
    '/employee/leave', 'hr_leave_balances', b.id::text);
  return v;
end $$;

create or replace function hr_private.ensure_leave_balance(p_employee uuid, p_type uuid, p_year int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.hr_leave_types;
  prev public.hr_leave_balances;
  v_id uuid;
  v_cf numeric := 0;
  v_prev_avail numeric;
  v_closed boolean := hr_private.leave_year_closed(p_year);
begin
  select * into t from public.hr_leave_types where id = p_type;
  if t.id is null then perform hr_private.fail('Leave type not found.', 'not_found'); end if;
  select id into v_id from public.hr_leave_balances where employee_id = p_employee and leave_type_id = p_type and year = p_year;
  if v_id is null then
    if v_closed then return null; end if;
    select * into prev from public.hr_leave_balances where employee_id = p_employee and leave_type_id = p_type and year = p_year - 1;
    if prev.id is not null and t.carry_forward_max > 0 then
      v_prev_avail := greatest(prev.accrued, hr_private.leave_accrued(p_type, p_employee, p_year - 1, make_date(p_year - 1, 12, 31)))
                      + prev.carried_forward + prev.adjusted - prev.used - prev.pending;
      v_cf := least(t.carry_forward_max, greatest(v_prev_avail, 0));
    end if;
    insert into public.hr_leave_balances (employee_id, leave_type_id, year, entitled, accrued, carried_forward, cf_expires_on)
    values (p_employee, p_type, p_year, hr_private.leave_entitlement(p_type, p_employee, p_year),
            hr_private.leave_accrued(p_type, p_employee, p_year, hr_private.business_today()), v_cf,
            case when v_cf > 0 then hr_private.leave_cf_expiry_date(p_type, p_year) end)
    on conflict (employee_id, leave_type_id, year) do nothing
    returning id into v_id;
    if v_id is not null and v_cf > 0 then
      insert into public.hr_leave_balance_adjustments (balance_id, employee_id, leave_type_id, year, kind, delta, reason, created_by)
      values (v_id, p_employee, p_type, p_year, 'carry_forward', v_cf, 'Carried forward from ' || (p_year - 1), auth.uid());
    end if;
    if v_id is null then
      select id into v_id from public.hr_leave_balances where employee_id = p_employee and leave_type_id = p_type and year = p_year;
    end if;
  end if;
  if not v_closed then
    update public.hr_leave_balances b
       set accrued = greatest(b.accrued, hr_private.leave_accrued(p_type, p_employee, p_year, hr_private.business_today()))
     where b.id = v_id
       and b.accrued < hr_private.leave_accrued(p_type, p_employee, p_year, hr_private.business_today());
    perform hr_leave_internal.leave_apply_expiry(v_id);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Requests: new columns, state guard, per-day breakdown
-- ---------------------------------------------------------------------
alter table public.hr_leave_requests
  add column if not exists document_id uuid references public.hr_documents(id) on delete set null,
  add column if not exists policy_version int,
  add column if not exists holiday_review_required boolean not null default false;
create index if not exists hr_leave_requests_review on public.hr_leave_requests(holiday_review_required) where holiday_review_required;

-- Supporting documents (e.g. medical certificates) are real hr_documents in
-- their own category: the employee uploads and sees them; documents RLS lets
-- HR document viewers open them; line managers see only that one is attached.
insert into public.hr_document_categories
  (code, name, description, requires_expiry, employee_can_upload, employee_can_view, is_confidential, checklist_required, sort_order)
values ('leave_supporting', 'Leave supporting document', 'Medical certificate or other proof attached to a leave request', false, true, true, false, false, 20)
on conflict (code) do nothing;

-- Same body as 107, except line managers (documents.view_team) cannot open
-- leave supporting documents: medical proof stays with the employee and HR.
create or replace function hr_private.document_can_view(p_employee uuid, p_category uuid, p_archived timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('documents.view')
      or hr_private.has_permission('documents.manage')
      or (p_archived is null and exists (
            select 1 from public.hr_document_categories c
            where c.id = p_category and not c.is_confidential
              and ((p_employee = hr_private.current_employee_id() and c.employee_can_view)
                   or (hr_private.has_permission('documents.view_team') and hr_private.is_manager_of(p_employee)
                       and c.code <> 'leave_supporting'))))
$$;

alter table public.hr_leave_request_events drop constraint if exists hr_leave_request_events_action_check;
alter table public.hr_leave_request_events add constraint hr_leave_request_events_action_check
  check (action in ('applied','manager_approved','approved','rejected','clarification_requested','clarification_response',
                    'cancelled','holiday_changed','recalculated'));

-- Status can only move forward; the leave itself (who, what, when) never changes.
create or replace function hr_private.leave_request_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.employee_id is distinct from old.employee_id or new.leave_type_id is distinct from old.leave_type_id
     or new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date
     or new.start_half is distinct from old.start_half or new.end_half is distinct from old.end_half or new.year is distinct from old.year then
    perform hr_private.fail('The dates and type of a leave request cannot be changed; cancel it and apply again.', 'immutable');
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('pending_approval','cancelled'))
    or (old.status = 'pending_approval' and new.status in ('approved','rejected','cancelled'))
    or (old.status = 'approved' and new.status = 'cancelled')) then
    perform hr_private.fail('This leave request is already ' || replace(old.status, '_', ' ') || '.', 'invalid_state');
  end if;
  if new.days is distinct from old.days and coalesce(hr_leave_internal.leave_ctx() ->> 'entry', '') <> 'recalculation' then
    perform hr_private.fail('Leave days can only change through a recalculation.', 'immutable');
  end if;
  return new;
end $$;
create trigger hr_leave_requests_guard before update on public.hr_leave_requests
  for each row execute function hr_private.leave_request_guard();

create table public.hr_leave_request_days (
  request_id  uuid not null references public.hr_leave_requests(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  leave_date  date not null,
  portion     numeric(2,1) not null check (portion in (0.5, 1.0)),
  half        text check (half in ('first','second')),        -- null = full day; 'first' = morning off
  primary key (request_id, leave_date)
);
create index hr_leave_request_days_emp on public.hr_leave_request_days(employee_id, leave_date);
select hr_private.secure_table('public.hr_leave_request_days');
create policy hr_leave_request_days_read on public.hr_leave_request_days for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'leave'));
revoke insert, update, delete, truncate on public.hr_leave_request_days from authenticated;

-- Weekly-off test shared with Attendance & Time. When migration 125 is
-- present it is the single source of truth: the shift in effect ON THAT DATE
-- (dated assignments) plus its weekly-off rules (e.g. 2nd/4th Saturday),
-- exactly as hr_private.attendance_day_type classifies the day. Without 125
-- it falls back to the 103 rule (current shift's working days). Checked at
-- call time so the result never depends on migration order.
create or replace function hr_private.leave_is_weekly_off(p_employee uuid, p_date date)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v boolean;
begin
  if to_regprocedure('hr_private.employee_shift_on(uuid,date)') is not null
     and to_regprocedure('hr_private.is_weekly_off_rule(jsonb,date)') is not null then
    execute 'select not (extract(isodow from $2)::smallint = any(s.working_days))
                    or coalesce(hr_private.is_weekly_off_rule(s.weekly_off_rules, $2), false)
             from hr_private.employee_shift_on($1, $2) s'
      into v using p_employee, p_date;
    return coalesce(v, false);
  end if;
  return not (extract(isodow from p_date)::smallint = any(hr_private.employee_working_days(p_employee)));
end $$;

-- Same counting rules as hr_private.leave_days, one row per counted day.
create or replace function hr_private.leave_day_rows(p_employee uuid, p_type uuid, p_start date, p_end date,
                                                     p_start_half boolean default false, p_end_half boolean default false)
returns table (o_date date, o_portion numeric, o_half text)
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.hr_leave_types;
  d date;
  sh boolean := coalesce(p_start_half, false);
  eh boolean := coalesce(p_end_half, false);
begin
  select * into t from public.hr_leave_types where id = p_type;
  if t.id is null then perform hr_private.fail('Leave type not found.', 'not_found'); end if;
  if p_start is null or p_end is null or p_end < p_start then return; end if;
  d := p_start;
  while d <= p_end loop
    if (t.counts_weekends or not hr_private.leave_is_weekly_off(p_employee, d))
       and (t.counts_holidays or not hr_private.is_holiday(d, p_employee)) then
      o_date := d;
      if d = p_start and d = p_end and (sh or eh) then
        o_portion := 0.5; o_half := case when sh then 'second' else 'first' end;
      elsif d = p_start and sh then
        o_portion := 0.5; o_half := 'second';
      elsif d = p_end and eh then
        o_portion := 0.5; o_half := 'first';
      else
        o_portion := 1; o_half := null;
      end if;
      return next;
    end if;
    d := d + 1;
  end loop;
end $$;

-- 103's day counter, now on the shared weekly-off test (same signature and
-- results without 125). Used by the apply/decide cores, recalculation and
-- the holiday-change review.
create or replace function hr_private.leave_days(p_employee uuid, p_type uuid, p_start date, p_end date,
                                                 p_start_half boolean default false, p_end_half boolean default false)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(x.o_portion), 0)
  from hr_private.leave_day_rows(p_employee, p_type, p_start, p_end, p_start_half, p_end_half) x
$$;

create or replace function hr_private.leave_request_days_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.hr_leave_request_days where request_id = new.id;
  insert into public.hr_leave_request_days (request_id, employee_id, leave_date, portion, half)
  select new.id, new.employee_id, x.o_date, x.o_portion, x.o_half
  from hr_private.leave_day_rows(new.employee_id, new.leave_type_id, new.start_date, new.end_date, new.start_half, new.end_half) x;
  return null;
end $$;
create trigger hr_leave_requests_days_ins after insert on public.hr_leave_requests
  for each row execute function hr_private.leave_request_days_sync();
create trigger hr_leave_requests_days_upd after update of days on public.hr_leave_requests
  for each row when (old.days is distinct from new.days) execute function hr_private.leave_request_days_sync();

insert into public.hr_leave_request_days (request_id, employee_id, leave_date, portion, half)
select r.id, r.employee_id, x.o_date, x.o_portion, x.o_half
from public.hr_leave_requests r
cross join lateral hr_private.leave_day_rows(r.employee_id, r.leave_type_id, r.start_date, r.end_date, r.start_half, r.end_half) x
on conflict do nothing;

-- Portion (0, 0.5, 1) of a day an employee is on APPROVED leave — for attendance.
create or replace function hr_private.leave_portion_on(p_employee uuid, p_date date)
returns numeric language sql stable security definer set search_path = '' as $$
  select least(coalesce(sum(d.portion), 0), 1)
  from public.hr_leave_request_days d join public.hr_leave_requests r on r.id = d.request_id
  where d.employee_id = p_employee and d.leave_date = p_date and r.status = 'approved'
$$;

-- Payroll LOP (same signature as 105): unpaid approved leave from the stored
-- per-day breakdown, so a later holiday edit cannot change approved leave.
create or replace function hr_private.payroll_lop_days(p_employee uuid, p_from date, p_to date, p_from_attendance boolean)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v numeric := 0;
begin
  if p_to < p_from then return 0; end if;
  select coalesce(sum(d.portion), 0) into v
    from public.hr_leave_request_days d
    join public.hr_leave_requests lr on lr.id = d.request_id
    join public.hr_leave_types t on t.id = lr.leave_type_id
   where d.employee_id = p_employee and lr.status = 'approved' and not t.paid
     and d.leave_date between p_from and p_to;
  if p_from_attendance and to_regclass('public.hr_attendance') is not null then
    v := v + (select count(*) from public.hr_attendance a
              where a.employee_id = p_employee and a.status = 'absent' and a.work_date between p_from and p_to
                and extract(isodow from a.work_date)::smallint = any(hr_private.employee_working_days(p_employee))
                and not hr_private.is_on_approved_leave(p_employee, a.work_date));
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 7. Holiday changes flag affected leave (never changes it silently)
-- ---------------------------------------------------------------------
create or replace function hr_private.leave_holiday_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  jn jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  jo jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_dates date[];
  v_rec boolean := coalesce((jn ->> 'is_recurring')::boolean, false) or coalesce((jo ->> 'is_recurring')::boolean, false);
  r record;
  v_new numeric;
begin
  v_dates := array_remove(array[(jo ->> 'holiday_date')::date, (jn ->> 'holiday_date')::date], null);
  for r in
    select q.id, q.employee_id, q.leave_type_id, q.start_date, q.end_date, q.start_half, q.end_half, q.days, q.status, q.current_level
    from public.hr_leave_requests q join public.hr_leave_types lt on lt.id = q.leave_type_id
    where q.status in ('pending_approval','approved') and not lt.counts_holidays and not q.holiday_review_required
      and exists (select 1 from unnest(v_dates) x
                  where x between q.start_date and q.end_date
                     or (v_rec and exists (select 1 from generate_series(q.start_date::timestamp, q.end_date::timestamp, interval '1 day') g
                                           where to_char(g, 'MM-DD') = to_char(x, 'MM-DD'))))
  loop
    v_new := hr_private.leave_days(r.employee_id, r.leave_type_id, r.start_date, r.end_date, r.start_half, r.end_half);
    if v_new is distinct from r.days then
      update public.hr_leave_requests set holiday_review_required = true where id = r.id;
      perform hr_private.leave_event(r.id, 'holiday_changed', r.status, r.status, r.current_level,
        'Holiday calendar changed: these dates now count ' || v_new || ' day(s) instead of ' || r.days
        || '. Days and balance stay unchanged until the request is recalculated.');
      perform hr_private.notify_permission_holders('leave.approve', 'leave.holiday_review', 'Leave affected by a holiday change',
        'A holiday change affects a ' || replace(r.status, '_', ' ') || ' leave request; review and recalculate it.',
        '/hr/leave?tab=requests&review=1', 'hr_leave_requests', r.id::text, null);
    end if;
  end loop;
  return null;
end $$;
create trigger hr_holidays_leave_review after insert or update or delete on public.hr_holidays
  for each row execute function hr_private.leave_holiday_changed();

create or replace function public.hr_recalculate_leave_request(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_leave_requests;
  t public.hr_leave_types;
  b public.hr_leave_balances;
  v_new numeric;
  d numeric;
begin
  select * into r from public.hr_leave_requests where id = p_id;
  if r.id is null then perform hr_private.fail('Leave request not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot recalculate your own leave request.', 'self_approval');
  end if;
  if not ((r.status = 'pending_approval' and hr_private.leave_can_act(r))
          or hr_private.has_permission('leave.approve') or hr_private.has_permission('leave.manage')) then
    perform hr_private.fail('You are not allowed to recalculate this leave request.', 'forbidden');
  end if;
  if r.status not in ('pending_approval','approved') then
    perform hr_private.fail('Only pending or approved leave can be recalculated.', 'invalid_state');
  end if;
  if hr_private.leave_year_closed(r.year) then
    perform hr_private.fail('Leave year ' || r.year || ' is closed.', 'year_closed');
  end if;
  perform pg_advisory_xact_lock(hashtext('hr_leave:' || r.employee_id::text));
  select * into r from public.hr_leave_requests where id = p_id for update;
  select * into t from public.hr_leave_types where id = r.leave_type_id;
  v_new := hr_private.leave_days(r.employee_id, r.leave_type_id, r.start_date, r.end_date, r.start_half, r.end_half);
  if v_new <= 0 then
    perform hr_private.fail('After recalculation these dates contain no working days; cancel the request instead.', 'no_working_days');
  end if;
  d := v_new - r.days;
  perform hr_leave_internal.leave_ctx_set(jsonb_build_object('entry', 'recalculation', 'request', r.id,
    'reason', coalesce(nullif(btrim(p_note), ''), 'Recalculated after a holiday change')));
  if d <> 0 then
    select * into b from public.hr_leave_balances where employee_id = r.employee_id and leave_type_id = r.leave_type_id and year = r.year for update;
    if d > 0 and b.available - d < 0 and (not t.allow_negative or (t.max_negative is not null and b.available - d < -t.max_negative)) then
      perform hr_leave_internal.leave_ctx_clear();
      perform hr_private.fail('Insufficient ' || t.name || ' balance for the recalculated days.', 'insufficient_balance');
    end if;
    if r.status = 'pending_approval' then
      update public.hr_leave_balances set pending = pending + d where id = b.id;
    else
      update public.hr_leave_balances set used = used + d where id = b.id;
    end if;
  end if;
  update public.hr_leave_requests set days = v_new, holiday_review_required = false where id = p_id returning * into r;
  perform hr_leave_internal.leave_ctx_clear();
  perform hr_private.leave_event(p_id, 'recalculated', r.status, r.status, r.current_level,
    'Days ' || (v_new - d) || ' -> ' || v_new || coalesce('. ' || nullif(btrim(p_note), ''), ''));
  if d <> 0 then
    perform hr_private.notify_employee(r.employee_id, 'leave.recalculated', 'Leave recalculated',
      t.name || ' from ' || to_char(r.start_date, 'DD Mon YYYY') || ' now counts ' || v_new || ' day(s) after a holiday change.',
      '/employee/leave', 'hr_leave_requests', p_id::text);
  end if;
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- 8. Apply / decide / cancel: 103 cores + wrappers
-- ---------------------------------------------------------------------
alter function public.hr_apply_leave(uuid, date, date, text, boolean, boolean, text) set schema hr_leave_internal;
alter function hr_leave_internal.hr_apply_leave(uuid, date, date, text, boolean, boolean, text) rename to apply_leave_core;
alter function public.hr_decide_leave(uuid, boolean, text) set schema hr_leave_internal;
alter function hr_leave_internal.hr_decide_leave(uuid, boolean, text) rename to decide_leave_core;
alter function public.hr_cancel_leave(uuid, text) set schema hr_leave_internal;
alter function hr_leave_internal.hr_cancel_leave(uuid, text) rename to cancel_leave_core;

create or replace function public.hr_apply_leave(
  p_leave_type uuid, p_start date, p_end date, p_reason text,
  p_start_half boolean default false, p_end_half boolean default false, p_document_path text default null,
  p_document_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_today date := hr_private.business_today();
  t public.hr_leave_types;
  doc public.hr_documents;
  v_why text;
  v_days numeric;
  v_mark bigint;
  v_res jsonb;
  v_id uuid;
  v_path text := nullif(btrim(p_document_path), '');
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into t from public.hr_leave_types where id = p_leave_type;
  -- Extra policy rules; basic validation stays in the core (same messages as before).
  if t.id is not null and t.active and p_start is not null and p_end is not null and p_end >= p_start then
    if hr_private.leave_year_closed(extract(year from p_start)::int) or hr_private.leave_year_closed(extract(year from p_end)::int) then
      perform hr_private.fail('Leave year ' || extract(year from p_start)::int || ' is closed.', 'year_closed');
    end if;
    v_why := hr_private.leave_type_eligibility(t.id, v_me, p_start, p_end);
    if v_why is not null then perform hr_private.fail(v_why, 'not_eligible'); end if;
    if coalesce(t.min_notice_days, 0) > 0 and p_start - v_today < t.min_notice_days then
      perform hr_private.fail(t.name || ' must be applied for at least ' || t.min_notice_days || ' day(s) in advance.', 'notice_period');
    end if;
    v_days := case when (coalesce(p_start_half, false) or coalesce(p_end_half, false)) and not t.allow_half_day then 0   -- core reports it
                   else hr_private.leave_days(v_me, t.id, p_start, p_end, coalesce(p_start_half, false), coalesce(p_end_half, false)) end;
    if v_days > 0 and t.min_days_per_request is not null and v_days < t.min_days_per_request then
      perform hr_private.fail(t.name || ' must be at least ' || t.min_days_per_request || ' day(s) per request.', 'below_minimum');
    end if;
    if v_days > 0 and t.max_days_per_request is not null and v_days > t.max_days_per_request then
      perform hr_private.fail(t.name || ' can be at most ' || t.max_days_per_request || ' day(s) per request.', 'above_maximum');
    end if;
  end if;
  if p_document_id is not null then
    select * into doc from public.hr_documents where id = p_document_id;
    if doc.id is null or doc.employee_id is distinct from v_me or doc.archived_at is not null then
      perform hr_private.fail('Supporting document not found.', 'invalid_document');
    end if;
    v_path := coalesce(v_path, 'hr-document:' || doc.id::text);
  end if;

  v_mark := hr_leave_internal.leave_ledger_mark();
  v_res := hr_leave_internal.apply_leave_core(p_leave_type, p_start, p_end, p_reason, p_start_half, p_end_half, v_path);
  v_id := (v_res ->> 'id')::uuid;
  update public.hr_leave_requests set document_id = p_document_id, policy_version = t.policy_version where id = v_id;
  perform hr_leave_internal.leave_link_ledger(v_mark, v_id);
  return (select to_jsonb(x) from public.hr_leave_requests x where x.id = v_id);
end $$;

create or replace function public.hr_decide_leave(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_leave_requests; v_mark bigint; v_res jsonb;
begin
  select * into r from public.hr_leave_requests where id = p_id;
  if r.id is not null and r.status = 'pending_approval' and hr_private.leave_can_act(r) then
    if hr_private.leave_year_closed(r.year) then
      perform hr_private.fail('Leave year ' || r.year || ' is closed.', 'year_closed');
    end if;
    if p_approve and r.holiday_review_required then
      perform hr_private.fail('The holiday calendar changed for these dates. Recalculate the request before approving it.', 'holiday_review');
    end if;
  end if;
  v_mark := hr_leave_internal.leave_ledger_mark();
  v_res := hr_leave_internal.decide_leave_core(p_id, p_approve, p_note);
  perform hr_leave_internal.leave_link_ledger(v_mark, p_id);
  return v_res;
end $$;

create or replace function public.hr_cancel_leave(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_mark bigint := hr_leave_internal.leave_ledger_mark(); v_res jsonb;
begin
  v_res := hr_leave_internal.cancel_leave_core(p_id, p_note);
  perform hr_leave_internal.leave_link_ledger(v_mark, p_id);
  return v_res;
end $$;

-- ---------------------------------------------------------------------
-- 9. Balance administration: opening balance, expiry run, year init/close
-- ---------------------------------------------------------------------
create or replace function public.hr_set_opening_leave_balance(p_employee uuid, p_leave_type uuid, p_year int, p_days numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.hr_leave_balances; t public.hr_leave_types; v_bal uuid; d numeric;
begin
  if not hr_private.has_permission('leave.adjust') then
    perform hr_private.fail('You are not allowed to adjust leave balances.', 'forbidden');
  end if;
  if p_employee is not distinct from hr_private.current_employee_id() then
    perform hr_private.fail('You cannot adjust your own leave balance.', 'self_adjust');
  end if;
  if not exists (select 1 from public.hr_employees where id = p_employee) then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if p_days is null or p_days < 0 or p_days > 366 or round(p_days * 2) <> p_days * 2 then
    perform hr_private.fail('Opening balance must be between 0 and 366 days, in half days.', 'invalid');
  end if;
  if p_year is null or p_year not between 2000 and 2100 then perform hr_private.fail('Invalid year.', 'invalid'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('A reason is required.', 'reason_required'); end if;
  if hr_private.leave_year_closed(p_year) then perform hr_private.fail('Leave year ' || p_year || ' is closed.', 'year_closed'); end if;
  select * into t from public.hr_leave_types where id = p_leave_type;
  if t.id is null then perform hr_private.fail('Leave type not found.', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtext('hr_leave:' || p_employee::text));
  v_bal := hr_private.ensure_leave_balance(p_employee, p_leave_type, p_year);
  select * into b from public.hr_leave_balances where id = v_bal for update;
  d := p_days - b.opening;
  if d = 0 then perform hr_private.fail('The opening balance is already ' || p_days || '.', 'no_change'); end if;
  if b.available + d < 0 and not t.allow_negative then
    perform hr_private.fail('This opening balance would make the balance negative.', 'negative_balance');
  end if;
  perform hr_leave_internal.leave_ctx_set(jsonb_build_object('entry', 'opening', 'reason', btrim(p_reason)));
  update public.hr_leave_balances set opening = p_days, adjusted = adjusted + d where id = b.id returning * into b;
  perform hr_leave_internal.leave_ctx_clear();
  insert into public.hr_leave_balance_adjustments (balance_id, employee_id, leave_type_id, year, kind, delta, reason, created_by)
  values (b.id, p_employee, p_leave_type, p_year, 'opening', d, btrim(p_reason), auth.uid());
  perform hr_private.notify_employee(p_employee, 'leave.balance_adjusted', 'Opening leave balance set',
    t.name || ' ' || p_year || ': opening balance ' || p_days || ' day(s). ' || btrim(p_reason), '/employee/leave', 'hr_leave_balances', b.id::text);
  return to_jsonb(b);
end $$;

create or replace function public.hr_process_leave_expiry(p_year int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_year int := coalesce(p_year, extract(year from hr_private.business_today())::int); r record; v numeric; n int := 0; total numeric := 0;
begin
  if not hr_private.has_permission('leave.manage') then perform hr_private.fail('You are not allowed to manage leave.', 'forbidden'); end if;
  for r in select id from public.hr_leave_balances
           where year = v_year and cf_expires_on is not null and cf_expires_on < hr_private.business_today()
             and cf_expired = 0 and carried_forward > 0
  loop
    v := hr_leave_internal.leave_apply_expiry(r.id);
    if v > 0 then n := n + 1; total := total + v; end if;
  end loop;
  perform hr_private.audit_event('LEAVE_EXPIRY_PROCESSED', 'hr_leave_balances', v_year::text, jsonb_build_object('balances', n, 'days', total));
  return jsonb_build_object('year', v_year, 'balances', n, 'days', total);
end $$;

-- Same contract as 103, plus: closed years refused, eligibility respected.
create or replace function public.hr_initialize_leave_year(p_year int)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count int := 0; r record; v_cur int := extract(year from hr_private.business_today())::int;
begin
  if not hr_private.has_permission('leave.manage') then
    perform hr_private.fail('You are not allowed to manage leave.', 'forbidden');
  end if;
  if p_year is null or p_year not between v_cur - 1 and v_cur + 1 then
    perform hr_private.fail('Leave years can be initialised for the previous, current or next year only.', 'invalid_year');
  end if;
  if hr_private.leave_year_closed(p_year) then
    perform hr_private.fail('Leave year ' || p_year || ' is closed.', 'year_closed');
  end if;
  for r in
    select e.id as employee_id, t.id as leave_type_id
    from public.hr_employees e cross join public.hr_leave_types t
    where t.active
      and (t.eligible_employment_types is null or e.employment_type = any(t.eligible_employment_types))
      and e.status in ('onboarding','probation','active','notice_period')
      and (e.joining_date is null or e.joining_date <= make_date(p_year, 12, 31))
      and not exists (select 1 from public.hr_leave_balances b
                      where b.employee_id = e.id and b.leave_type_id = t.id and b.year = p_year)
  loop
    perform hr_private.ensure_leave_balance(r.employee_id, r.leave_type_id, p_year);
    v_count := v_count + 1;
  end loop;
  perform hr_private.audit_event('LEAVE_YEAR_INITIALIZED', 'hr_leave_balances', p_year::text, jsonb_build_object('created', v_count));
  return v_count;
end $$;

-- Year-end: finalise accrual, true-up next year's carry-forward from the
-- final balance, record lapsed days, then freeze the year.
create or replace function public.hr_close_leave_year(p_year int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := hr_private.business_today();
  v_cur int := extract(year from v_today)::int;
  b record;
  nb public.hr_leave_balances;
  v_final numeric; v_cf numeric; v_next uuid;
  n_bal int := 0; n_cf int := 0; v_lapsed numeric := 0; v_carried numeric := 0;
  v_summary jsonb;
  v_pending int;
begin
  if not hr_private.has_permission('leave.manage') then perform hr_private.fail('You are not allowed to manage leave.', 'forbidden'); end if;
  if p_year is null or p_year < 2000 or p_year > v_cur or (p_year = v_cur and extract(month from v_today) < 12) then
    perform hr_private.fail('Only a finished leave year (or the current year during December) can be closed.', 'invalid_year');
  end if;
  if hr_private.leave_year_closed(p_year) then perform hr_private.fail('Leave year ' || p_year || ' is already closed.', 'already_closed'); end if;
  select count(*) into v_pending from public.hr_leave_requests where year = p_year and status = 'pending_approval';
  if v_pending > 0 then
    perform hr_private.fail(v_pending || ' pending leave request(s) in ' || p_year || ' must be decided first.', 'pending_requests');
  end if;
  if exists (select 1 from public.hr_leave_requests where year = p_year and status = 'approved' and holiday_review_required) then
    perform hr_private.fail('Some approved leave in ' || p_year || ' is waiting for a holiday recalculation.', 'holiday_review');
  end if;

  perform hr_leave_internal.leave_ctx_set(jsonb_build_object('entry', 'year_end', 'reason', 'Year-end close ' || p_year));
  for b in
    select x.id, x.employee_id, x.leave_type_id, lt.carry_forward_max, lt.active, lt.carry_forward_expiry_months, e.status as emp_status
    from public.hr_leave_balances x
    join public.hr_leave_types lt on lt.id = x.leave_type_id
    join public.hr_employees e on e.id = x.employee_id
    where x.year = p_year
    order by x.employee_id
  loop
    perform pg_advisory_xact_lock(hashtext('hr_leave:' || b.employee_id::text));
    update public.hr_leave_balances x
       set accrued = greatest(x.accrued, hr_private.leave_accrued(b.leave_type_id, b.employee_id, p_year, make_date(p_year, 12, 31)))
     where x.id = b.id;
    select available into v_final from public.hr_leave_balances where id = b.id;
    n_bal := n_bal + 1;
    v_cf := case when b.carry_forward_max > 0 then least(b.carry_forward_max, greatest(v_final, 0)) else 0 end;
    if b.active and b.emp_status in ('onboarding','probation','active','notice_period') then
      v_next := hr_private.ensure_leave_balance(b.employee_id, b.leave_type_id, p_year + 1);
      select * into nb from public.hr_leave_balances where id = v_next for update;
      if nb.id is not null and nb.carried_forward <> v_cf and nb.cf_expired = 0 then
        update public.hr_leave_balances
           set carried_forward = v_cf,
               cf_expires_on = case when v_cf > 0 then hr_private.leave_cf_expiry_date(b.leave_type_id, p_year + 1) end
         where id = nb.id;
        insert into public.hr_leave_balance_adjustments (balance_id, employee_id, leave_type_id, year, kind, delta, reason, created_by)
        values (nb.id, b.employee_id, b.leave_type_id, p_year + 1, 'carry_forward', v_cf - nb.carried_forward,
                'Year-end true-up from ' || p_year, auth.uid());
        n_cf := n_cf + 1;
      end if;
    else
      v_cf := 0;
    end if;
    v_carried := v_carried + v_cf;
    v_lapsed := v_lapsed + greatest(greatest(v_final, 0) - v_cf, 0);
  end loop;
  perform hr_leave_internal.leave_ctx_clear();

  v_summary := jsonb_build_object('balances', n_bal, 'carry_forward_trued_up', n_cf, 'days_carried', v_carried, 'days_lapsed', v_lapsed);
  insert into public.hr_leave_years (year, status, closed_by, closed_at, summary)
  values (p_year, 'closed', auth.uid(), now(), v_summary)
  on conflict (year) do update set status = 'closed', closed_by = excluded.closed_by, closed_at = excluded.closed_at, summary = excluded.summary;
  perform hr_private.audit_event('LEAVE_YEAR_CLOSED', 'hr_leave_years', p_year::text, v_summary);
  return v_summary || jsonb_build_object('year', p_year);
end $$;

-- ---------------------------------------------------------------------
-- 10. Read helpers
-- ---------------------------------------------------------------------
drop function if exists public.hr_my_leave_balances(int);
create function public.hr_my_leave_balances(p_year int default null)
returns table (balance_id uuid, leave_type_id uuid, code text, name text, paid boolean, year int, entitled numeric, accrued numeric,
               carried_forward numeric, adjusted numeric, used numeric, pending numeric, available numeric,
               opening numeric, cf_expires_on date, cf_expired numeric, allow_negative boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_me uuid := hr_private.current_employee_id(); v_year int := coalesce(p_year, extract(year from hr_private.business_today())::int);
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  perform hr_private.ensure_leave_balance(v_me, lt.id, v_year)
     from public.hr_leave_types lt
    where lt.active and hr_private.leave_type_eligibility(lt.id, v_me) is null;
  return query
    select b.id, lt.id, lt.code, lt.name, lt.paid, b.year, b.entitled, b.accrued, b.carried_forward, b.adjusted, b.used, b.pending,
           b.available, b.opening, b.cf_expires_on, b.cf_expired, lt.allow_negative
    from public.hr_leave_balances b join public.hr_leave_types lt on lt.id = b.leave_type_id
    where b.employee_id = v_me and b.year = v_year
    order by lt.sort_order, lt.code;
end $$;

-- Active leave types with the caller's eligibility (for the apply form).
create or replace function public.hr_my_leave_types()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_today date := hr_private.business_today();
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  return coalesce((
    select jsonb_agg((to_jsonb(lt) - 'created_at' - 'updated_at') || jsonb_build_object(
             'eligibility_issue', hr_private.leave_type_eligibility(lt.id, v_me),
             'probation_restricted', (not lt.allow_during_probation and (e.status = 'probation' or coalesce(e.probation_end_date >= v_today, false))))
           order by lt.sort_order, lt.code)
    from public.hr_leave_types lt cross join public.hr_employees e
    where lt.active and e.id = v_me), '[]'::jsonb);
end $$;

-- Holiday occurrences in a range from the single holiday master. Rows marked
-- recurring (column added by Attendance 125; read through to_jsonb so this
-- works with or without it) repeat every year on the same month/day from
-- their first date, exactly as hr_private.holiday_on matches them.
create or replace function hr_private.leave_holiday_occurrences(p_from date, p_to date)
returns table (o_id uuid, o_date date, o_name text, o_type text, o_location uuid, o_legal_entity uuid, o_recurring boolean)
language sql stable security definer set search_path = '' as $$
  select h.id, d.occ, h.name, h.type, h.location_id, h.legal_entity_id, x.rec
  from public.hr_holidays h
  cross join lateral (select coalesce((to_jsonb(h) ->> 'is_recurring')::boolean, false) as rec) x
  cross join lateral (
    select h.holiday_date as occ where not x.rec and h.holiday_date between p_from and p_to
    union all
    select make_date(y, extract(month from h.holiday_date)::int, extract(day from h.holiday_date)::int)
    from generate_series(extract(year from p_from)::int, extract(year from p_to)::int) y
    where x.rec and not (extract(month from h.holiday_date) = 2 and extract(day from h.holiday_date) = 29)
      and make_date(y, extract(month from h.holiday_date)::int, extract(day from h.holiday_date)::int) between greatest(p_from, h.holiday_date) and p_to
  ) d
$$;

-- Holidays that apply to the caller (location + company), recurring ones
-- expanded. p_all (leave.view / leave.manage) returns every holiday, for HR
-- calendars; HR without an employee record also sees every holiday.
drop function if exists public.hr_my_holidays(date, date);
create function public.hr_my_holidays(p_from date, p_to date, p_all boolean default false)
returns table (id uuid, holiday_date date, name text, type text, location_id uuid, legal_entity_id uuid, is_recurring boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_me uuid := hr_private.current_employee_id();
  v_hr boolean := hr_private.has_permission('leave.view') or hr_private.has_permission('leave.manage');
  v_all boolean;
  e public.hr_employees;
begin
  if v_me is null and not v_hr then
    perform hr_private.fail('Sign in with an active employee account.', 'not_employee');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    perform hr_private.fail('Choose a valid date range of at most one year.', 'invalid_range');
  end if;
  v_all := v_me is null or (coalesce(p_all, false) and v_hr);
  select * into e from public.hr_employees where hr_employees.id = v_me;
  return query
    select o.o_id, o.o_date, o.o_name, o.o_type, o.o_location, o.o_legal_entity, o.o_recurring
    from hr_private.leave_holiday_occurrences(p_from, p_to) o
    where v_all or ((o.o_location is null or o.o_location = e.work_location_id)
                    and (o.o_legal_entity is null or o.o_legal_entity = e.legal_entity_id))
    order by o.o_date, o.o_name;
end $$;

-- Employees in the caller's leave scope, with optional filters.
create or replace function hr_private.leave_scope(p_department uuid default null, p_legal_entity uuid default null, p_employee uuid default null)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.hr_employees e
  where (p_department is null or e.department_id = p_department)
    and (p_legal_entity is null or e.legal_entity_id = p_legal_entity)
    and (p_employee is null or e.id = p_employee)
    and hr_private.can_access_employee(e.id, 'leave')
$$;

-- Team leave calendar (replaces 103's; the two-argument call still works).
-- Rows the caller may fully see show the leave type; teammates' approved
-- leave (shared manager) shows only "On leave". Reasons are never returned.
drop function if exists public.hr_leave_calendar(date, date);
create function public.hr_leave_calendar(p_from date, p_to date, p_department uuid default null, p_employee uuid default null,
                                         p_legal_entity uuid default null, p_include_pending boolean default true)
returns table (request_id uuid, employee_id uuid, employee_name text, department_id uuid, legal_entity_id uuid, leave_type_code text,
               leave_type_name text, start_date date, end_date date, start_half boolean, end_half boolean, days numeric, status text,
               visibility text, is_mine boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_me uuid := hr_private.current_employee_id(); v_mgr uuid := hr_private.my_manager_id();
begin
  if v_me is null and not hr_private.has_permission('leave.view') then
    perform hr_private.fail('Sign in with an active employee account.', 'not_employee');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    perform hr_private.fail('Choose a valid date range of at most one year.', 'invalid_range');
  end if;
  return query
    select r.id, r.employee_id, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), e.department_id, e.legal_entity_id,
           case when a.full_access then lt.code else 'LEAVE' end,
           case when a.full_access then lt.name else 'On leave' end,
           r.start_date, r.end_date, r.start_half, r.end_half, r.days, r.status,
           case when a.full_access then 'full' else 'limited' end,
           r.employee_id = v_me
    from public.hr_leave_requests r
    join public.hr_employees e on e.id = r.employee_id
    join public.hr_leave_types lt on lt.id = r.leave_type_id
    cross join lateral (select hr_private.can_access_employee(r.employee_id, 'leave') as full_access) a
    where r.status in ('pending_approval','approved')
      and (p_include_pending or r.status = 'approved')
      and r.start_date <= p_to and r.end_date >= p_from
      and (p_department is null or e.department_id = p_department)
      and (p_employee is null or r.employee_id = p_employee)
      and (p_legal_entity is null or e.legal_entity_id = p_legal_entity)
      and (a.full_access or (r.status = 'approved' and e.manager_id is not null and e.manager_id = v_mgr))
    order by r.start_date, e.first_name;
end $$;

-- Leave Management overview for HR / managers (scoped like the request list).
create or replace function public.hr_leave_overview(p_from date default null, p_to date default null, p_department uuid default null,
                                                    p_leave_type uuid default null, p_legal_entity uuid default null, p_employee uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := hr_private.business_today();
  v_from date := coalesce(p_from, date_trunc('month', hr_private.business_today())::date);
  v_to date := coalesce(p_to, (date_trunc('month', hr_private.business_today()) + interval '1 month - 1 day')::date);
  v_year int := extract(year from hr_private.business_today())::int;
  v_scope uuid[];
begin
  if not hr_private.any_permission(array['leave.view','leave.view_team','leave.approve','leave.approve_team','leave.manage']) then
    perform hr_private.fail('You do not have access to leave management.', 'forbidden');
  end if;
  if v_to < v_from or v_to - v_from > 366 then perform hr_private.fail('Choose a valid date range of at most one year.', 'invalid_range'); end if;
  v_scope := array(select hr_private.leave_scope(p_department, p_legal_entity, p_employee));

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'today', v_today),
    'pending_requests', (select count(*) from public.hr_leave_requests r
       where r.status = 'pending_approval' and r.employee_id = any(v_scope) and (p_leave_type is null or r.leave_type_id = p_leave_type)),
    'awaiting_my_approval', (select count(*) from public.hr_leave_requests r
       where r.status = 'pending_approval' and r.employee_id = any(v_scope) and (p_leave_type is null or r.leave_type_id = p_leave_type)
         and hr_private.leave_can_act(r)),
    'holiday_review', (select count(*) from public.hr_leave_requests r
       where r.status in ('pending_approval','approved') and r.holiday_review_required and r.employee_id = any(v_scope)),
    'on_leave_today', (select coalesce(jsonb_agg(jsonb_build_object('request_id', r.id, 'employee_id', e.id, 'employee_code', e.employee_code,
         'employee_name', coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), 'department', dp.name,
         'leave_type', lt.name, 'half', d.half, 'end_date', r.end_date) order by e.first_name), '[]'::jsonb)
       from public.hr_leave_request_days d
       join public.hr_leave_requests r on r.id = d.request_id
       join public.hr_employees e on e.id = r.employee_id
       join public.hr_leave_types lt on lt.id = r.leave_type_id
       left join public.hr_departments dp on dp.id = e.department_id
       where d.leave_date = v_today and r.status = 'approved' and r.employee_id = any(v_scope)
         and (p_leave_type is null or r.leave_type_id = p_leave_type)),
    'approved_in_period', (select jsonb_build_object('requests', count(distinct r.id), 'days', coalesce(sum(d.portion), 0),
                                                     'employees', count(distinct r.employee_id))
       from public.hr_leave_requests r join public.hr_leave_request_days d on d.request_id = r.id
       where r.status = 'approved' and d.leave_date between v_from and v_to and r.employee_id = any(v_scope)
         and (p_leave_type is null or r.leave_type_id = p_leave_type)),
    'upcoming', (select coalesce(jsonb_agg(x order by x ->> 'start_date', x ->> 'employee_name'), '[]'::jsonb) from (
       select jsonb_build_object('request_id', r.id, 'employee_id', e.id, 'employee_code', e.employee_code,
         'employee_name', coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), 'department', dp.name,
         'leave_type', lt.name, 'start_date', r.start_date, 'end_date', r.end_date, 'days', r.days, 'status', r.status) x
       from public.hr_leave_requests r
       join public.hr_employees e on e.id = r.employee_id
       join public.hr_leave_types lt on lt.id = r.leave_type_id
       left join public.hr_departments dp on dp.id = e.department_id
       where r.status in ('approved','pending_approval') and r.start_date > v_today and r.start_date <= v_today + 30
         and r.employee_id = any(v_scope) and (p_leave_type is null or r.leave_type_id = p_leave_type)
       order by r.start_date limit 25) s),
    'by_type', (select coalesce(jsonb_agg(jsonb_build_object('leave_type_id', lt.id, 'code', lt.code, 'name', lt.name, 'paid', lt.paid,
         'approved_days', coalesce(a.days, 0), 'pending_requests', coalesce(p.n, 0)) order by lt.sort_order, lt.code), '[]'::jsonb)
       from public.hr_leave_types lt
       left join lateral (select sum(d.portion) days from public.hr_leave_request_days d join public.hr_leave_requests r on r.id = d.request_id
                          where r.leave_type_id = lt.id and r.status = 'approved' and d.leave_date between v_from and v_to
                            and r.employee_id = any(v_scope)) a on true
       left join lateral (select count(*) n from public.hr_leave_requests r
                          where r.leave_type_id = lt.id and r.status = 'pending_approval' and r.employee_id = any(v_scope)) p on true
       where (lt.active or coalesce(a.days, 0) > 0 or coalesce(p.n, 0) > 0) and (p_leave_type is null or lt.id = p_leave_type)),
    'balances', (select coalesce(jsonb_agg(jsonb_build_object('leave_type_id', lt.id, 'code', lt.code, 'name', lt.name, 'year', v_year,
         'employees', s.n, 'entitled', s.entitled, 'used', s.used, 'pending', s.pending, 'available', s.available, 'low', s.low)
         order by lt.sort_order, lt.code), '[]'::jsonb)
       from public.hr_leave_types lt
       join lateral (select count(*) n, sum(b.entitled) entitled, sum(b.used) used, sum(b.pending) pending, sum(b.available) available,
                            count(*) filter (where b.available < 1 and lt.accrual <> 'none') low
                     from public.hr_leave_balances b where b.leave_type_id = lt.id and b.year = v_year and b.employee_id = any(v_scope)) s on s.n > 0
       where p_leave_type is null or lt.id = p_leave_type),
    'upcoming_holidays', (select coalesce(jsonb_agg(jsonb_build_object('id', o.o_id, 'date', o.o_date, 'name', o.o_name, 'type', o.o_type,
         'recurring', o.o_recurring) order by o.o_date), '[]'::jsonb)
       from hr_private.leave_holiday_occurrences(v_today, v_today + 45) o
       where p_legal_entity is null or o.o_legal_entity is null or o.o_legal_entity = p_legal_entity)
  );
end $$;

-- Approved leave per day for attendance (leave or attendance viewers).
create or replace function public.hr_leave_attendance_days(p_from date, p_to date, p_employee uuid default null)
returns table (employee_id uuid, leave_date date, portion numeric, half text, leave_type_code text, paid boolean, request_id uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 93 then
    perform hr_private.fail('Choose a valid date range of at most 93 days.', 'invalid_range');
  end if;
  return query
    select d.employee_id, d.leave_date, d.portion, d.half, lt.code, lt.paid, r.id
    from public.hr_leave_request_days d
    join public.hr_leave_requests r on r.id = d.request_id
    join public.hr_leave_types lt on lt.id = r.leave_type_id
    where r.status = 'approved' and d.leave_date between p_from and p_to
      and (p_employee is null or d.employee_id = p_employee)
      and (hr_private.can_access_employee(d.employee_id, 'leave') or hr_private.can_access_employee(d.employee_id, 'attendance'))
    order by d.employee_id, d.leave_date;
end $$;

-- Paid / unpaid approved leave per employee for a payroll period. Read-only:
-- payroll decides what (if anything) to deduct under its approved policy.
create or replace function public.hr_leave_payroll_summary(p_from date, p_to date)
returns table (employee_id uuid, employee_code text, employee_name text, paid_leave_days numeric, unpaid_leave_days numeric,
               holiday_review_pending bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (hr_private.has_permission('payroll.view') or hr_private.has_permission('leave.view')) then
    perform hr_private.fail('You are not allowed to view the payroll leave summary.', 'forbidden');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 93 then
    perform hr_private.fail('Choose a valid date range of at most 93 days.', 'invalid_range');
  end if;
  return query
    select e.id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
           coalesce(sum(d.portion) filter (where lt.paid), 0), coalesce(sum(d.portion) filter (where not lt.paid), 0),
           count(distinct r.id) filter (where r.holiday_review_required)
    from public.hr_leave_request_days d
    join public.hr_leave_requests r on r.id = d.request_id
    join public.hr_leave_types lt on lt.id = r.leave_type_id
    join public.hr_employees e on e.id = d.employee_id
    where r.status = 'approved' and d.leave_date between p_from and p_to
    group by e.id, e.employee_code, e.display_name, e.first_name, e.last_name
    order by e.employee_code;
end $$;

-- ---------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------
-- No blanket grant on hr_private (it would re-expose helpers other
-- migrations restricted). 100's default privileges grant EXECUTE on new
-- hr_private functions to authenticated, so 160's new hr_private helpers are
-- revoked explicitly: every caller is SECURITY DEFINER code or a trigger.
revoke execute on all functions in schema hr_leave_internal from public, anon, authenticated;
revoke execute on function
  hr_private.leave_types_guard(), hr_private.leave_types_version(), hr_private.leave_type_eligibility(uuid, uuid, date, date),
  hr_private.leave_policy_fields(), hr_private.leave_year_closed(int), hr_private.leave_ledger_capture(),
  hr_private.leave_balance_year_guard(), hr_private.leave_cf_expiry_date(uuid, int), hr_private.leave_request_guard(),
  hr_private.leave_is_weekly_off(uuid, date), hr_private.leave_day_rows(uuid, uuid, date, date, boolean, boolean),
  hr_private.leave_request_days_sync(), hr_private.leave_portion_on(uuid, date), hr_private.leave_holiday_changed(),
  hr_private.leave_scope(uuid, uuid, uuid), hr_private.leave_holiday_occurrences(date, date)
from public, anon, authenticated;

revoke execute on function
  public.hr_apply_leave(uuid, date, date, text, boolean, boolean, text, uuid), public.hr_decide_leave(uuid, boolean, text),
  public.hr_cancel_leave(uuid, text), public.hr_propose_leave_policy(uuid, jsonb, text, date),
  public.hr_decide_leave_policy(uuid, boolean, text), public.hr_withdraw_leave_policy_change(uuid),
  public.hr_recalculate_leave_request(uuid, text), public.hr_set_opening_leave_balance(uuid, uuid, int, numeric, text),
  public.hr_process_leave_expiry(int), public.hr_initialize_leave_year(int), public.hr_close_leave_year(int),
  public.hr_my_leave_balances(int), public.hr_my_leave_types(), public.hr_my_holidays(date, date, boolean),
  public.hr_leave_calendar(date, date, uuid, uuid, uuid, boolean),
  public.hr_leave_overview(date, date, uuid, uuid, uuid, uuid), public.hr_leave_attendance_days(date, date, uuid),
  public.hr_leave_payroll_summary(date, date)
from anon, public;
grant execute on function
  public.hr_apply_leave(uuid, date, date, text, boolean, boolean, text, uuid), public.hr_decide_leave(uuid, boolean, text),
  public.hr_cancel_leave(uuid, text), public.hr_propose_leave_policy(uuid, jsonb, text, date),
  public.hr_decide_leave_policy(uuid, boolean, text), public.hr_withdraw_leave_policy_change(uuid),
  public.hr_recalculate_leave_request(uuid, text), public.hr_set_opening_leave_balance(uuid, uuid, int, numeric, text),
  public.hr_process_leave_expiry(int), public.hr_initialize_leave_year(int), public.hr_close_leave_year(int),
  public.hr_my_leave_balances(int), public.hr_my_leave_types(), public.hr_my_holidays(date, date, boolean),
  public.hr_leave_calendar(date, date, uuid, uuid, uuid, boolean),
  public.hr_leave_overview(date, date, uuid, uuid, uuid, uuid), public.hr_leave_attendance_days(date, date, uuid),
  public.hr_leave_payroll_summary(date, date)
to authenticated;

-- =====================================================================
-- 208_hr_benefits_module.sql — Benefits Management (HR + Employee Portal)
-- =====================================================================
-- Extends 114_hr_benefits.sql (hr_benefit_types = plans, hr_benefit_enrollments).
-- Nothing in 114 is dropped or rewritten; existing rows stay valid.
--
--   * hr_benefit_categories: configurable categories (health insurance,
--     wellness, learning allowance, meal, ...). hr_benefit_types.category
--     keeps its text value and now references a category code (the 114
--     check constraint is replaced by an FK + a guard trigger; every legacy
--     value is seeded as a category first).
--   * Plans gain coverage amount, annual claim limit, plan-year start month,
--     contribution notes, claimable / self-enrollment flags and eligibility
--     by grade, location and probation (hr_private.benefit_ineligibility is
--     replaced with the same signature, so 114's RPCs apply the new rules).
--   * Enrollment changes (coverage, dependants, policy number, contributions)
--     and named dependants; enrollment requests (employee self-enrollment for
--     plans that allow it, decided by HR).
--   * Claims: an employee claims against an enrolled, claimable plan with
--     supporting documents (private bucket hr-benefit-claims, registered-path
--     upload like the 180 receipt pattern). HR approves / rejects / returns.
--     Amount must fit the remaining annual limit for the plan year.
--     Separation of duties: nobody decides or records payment on their own
--     claim, enrollment request or enrollment.
--   * NO payroll integration: an approved claim is only 'approved'; HR may
--     record 'paid_externally' with a reference. No hr_payroll_adjustments,
--     no payroll-run changes, no hr_reimbursements rows.
--   * Privacy: claims, claim documents, amounts and events are visible only to
--     the employee and to benefits.view / benefits.manage holders (managers
--     see nothing). Amounts, descriptions and file names are redacted in the
--     generic audit log (audit.view holders may lack benefits access).
--   * hr_benefit_events: append-only benefit history (enrollments via
--     trigger, requests and claims via the RPCs).
--
-- Depends on 100, 103 (notify_permission_holders), 107 (document_validate_file),
-- 112 (any_permission), 113 (grade_id), 114. Independent of 206 / 207.
-- Idempotent: safe to re-run. Apply ONLY to a local / isolated test database.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Internal schema (no API usage; write helpers live here)
-- ---------------------------------------------------------------------
create schema if not exists hr_benefits_internal;
revoke all on schema hr_benefits_internal from public;
revoke all on schema hr_benefits_internal from anon;
revoke all on schema hr_benefits_internal from authenticated;
alter default privileges in schema hr_benefits_internal revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- 1. Categories
-- ---------------------------------------------------------------------
create table if not exists public.hr_benefit_categories (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name              text not null unique check (length(btrim(name)) between 2 and 80),
  description       text check (description is null or length(description) <= 1000),
  claimable_default boolean not null default false,
  active            boolean not null default true,
  sort_order        integer not null default 100 check (sort_order between 0 and 10000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

insert into public.hr_benefit_categories (code, name, description, claimable_default, sort_order) values
  ('health_insurance', 'Health insurance',   'Group medical / hospitalisation cover', false, 10),
  ('wellness',         'Wellness',           'Gym, fitness and wellbeing benefits', true, 20),
  ('learning',         'Learning allowance', 'Courses, certifications, books and conferences', true, 30),
  ('meal',             'Meal benefit',       'Meal cards and food allowances', true, 40),
  ('insurance',        'Insurance (other)',  'Life, accident and other insurance', false, 50),
  ('health',           'Health',             'Health check-ups and other health benefits', true, 60),
  ('retirement',       'Retirement',         'Retirement and savings benefits', false, 70),
  ('allowance',        'Allowance',          'Other allowances', true, 80),
  ('leave',            'Leave benefit',      'Leave-related benefits', false, 90),
  ('other',            'Other',              'Anything else', false, 100)
on conflict do nothing;
-- Any category value already used by a plan becomes a category (keeps existing rows valid).
insert into public.hr_benefit_categories (code, name)
select distinct t.category, initcap(replace(t.category, '_', ' ')) || ' (' || t.category || ')'
from public.hr_benefit_types t
where t.category ~ '^[a-z][a-z0-9_]{1,39}$'
  and not exists (select 1 from public.hr_benefit_categories c where c.code = t.category)
on conflict do nothing;

drop trigger if exists hr_benefit_categories_touch on public.hr_benefit_categories;
create trigger hr_benefit_categories_touch before update on public.hr_benefit_categories
  for each row execute function hr_private.touch_updated_at();
select hr_private.secure_table('public.hr_benefit_categories');
select hr_private.enable_audit('public.hr_benefit_categories');

drop policy if exists hr_benefit_categories_read on public.hr_benefit_categories;
create policy hr_benefit_categories_read on public.hr_benefit_categories for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('benefits.view')
         or hr_private.has_permission('benefits.manage') or hr_private.has_permission('settings.view'));
drop policy if exists hr_benefit_categories_insert on public.hr_benefit_categories;
create policy hr_benefit_categories_insert on public.hr_benefit_categories for insert to authenticated
  with check (hr_private.has_permission('benefits.manage'));
drop policy if exists hr_benefit_categories_update on public.hr_benefit_categories;
create policy hr_benefit_categories_update on public.hr_benefit_categories for update to authenticated
  using (hr_private.has_permission('benefits.manage')) with check (hr_private.has_permission('benefits.manage'));
-- Categories are deactivated, never deleted (plans reference them).
revoke delete, truncate on public.hr_benefit_categories from authenticated;

-- A category code is referenced by plans: renaming the code is refused once used.
create or replace function hr_benefits_internal.category_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.code is distinct from old.code
     and exists (select 1 from public.hr_benefit_types t where t.category = old.code) then
    perform hr_private.fail('This category is used by benefit plans; its code cannot change.', 'category_in_use');
  end if;
  return new;
end $$;
drop trigger if exists hr_benefit_categories_guard on public.hr_benefit_categories;
create trigger hr_benefit_categories_guard before update on public.hr_benefit_categories
  for each row execute function hr_benefits_internal.category_guard();

-- Replace 114's fixed category list by the category table.
alter table public.hr_benefit_types drop constraint if exists hr_benefit_types_category_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hr_benefit_types_category_fkey'
                 and conrelid = 'public.hr_benefit_types'::regclass) then
    alter table public.hr_benefit_types add constraint hr_benefit_types_category_fkey
      foreign key (category) references public.hr_benefit_categories(code) on update restrict on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Plan columns (hr_benefit_types)
-- ---------------------------------------------------------------------
alter table public.hr_benefit_types
  add column if not exists coverage_amount            numeric(14,2) check (coverage_amount is null or coverage_amount >= 0),
  add column if not exists annual_limit               numeric(12,2) check (annual_limit is null or annual_limit > 0),
  add column if not exists claimable                  boolean not null default false,
  add column if not exists claim_requires_document    boolean not null default true,
  add column if not exists self_enrollment            boolean not null default false,
  add column if not exists plan_year_start_month      smallint not null default 4 check (plan_year_start_month between 1 and 12),
  add column if not exists employer_contribution_note text check (employer_contribution_note is null or length(employer_contribution_note) <= 500),
  add column if not exists employee_contribution_note text check (employee_contribution_note is null or length(employee_contribution_note) <= 500),
  add column if not exists eligible_grade_ids         uuid[],
  add column if not exists eligible_location_ids      uuid[],
  add column if not exists allow_during_probation     boolean not null default true;

-- Plan writes (direct, benefits.manage under 114's RLS): category must be an
-- active category (clear message), empty eligibility lists mean "everyone",
-- and the plan year cannot move once claims exist (claims store their year).
create or replace function hr_benefits_internal.plan_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.category is distinct from old.category)
     and not exists (select 1 from public.hr_benefit_categories c where c.code = new.category and c.active) then
    raise exception using errcode = '23514',
      message = 'Unknown or inactive benefit category "' || coalesce(new.category, '') || '" (violates check constraint hr_benefit_types_category_check)',
      hint = 'invalid_category';
  end if;
  if new.eligible_employment_types is not null and cardinality(new.eligible_employment_types) = 0 then new.eligible_employment_types := null; end if;
  if new.eligible_grade_ids is not null and cardinality(new.eligible_grade_ids) = 0 then new.eligible_grade_ids := null; end if;
  if new.eligible_location_ids is not null and cardinality(new.eligible_location_ids) = 0 then new.eligible_location_ids := null; end if;
  if tg_op = 'UPDATE' and new.plan_year_start_month is distinct from old.plan_year_start_month
     and exists (select 1 from public.hr_benefit_claims c where c.benefit_type_id = new.id and c.status not in ('draft','cancelled')) then
    perform hr_private.fail('The plan year cannot change once claims exist for this plan.', 'plan_year_locked');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Eligibility (same signature as 114: grades, locations, probation added)
-- ---------------------------------------------------------------------
create or replace function hr_private.benefit_ineligibility(p_employee uuid, p_type uuid, p_on date)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when e.id is null then 'Employee not found.'
    when t.id is null then 'Benefit plan not found.'
    when not t.active then 'This benefit plan is inactive.'
    when e.status in ('exited','archived','suspended') then 'The employee is not active.'
    when t.eligible_employment_types is not null and not (e.employment_type = any (t.eligible_employment_types))
      then 'Employment type ' || replace(e.employment_type, '_', ' ') || ' is not eligible for this plan.'
    when t.min_tenure_months > 0 and (e.joining_date is null or e.joining_date + make_interval(months => t.min_tenure_months) > p_on)
      then 'Requires ' || t.min_tenure_months || ' months of service by the start date.'
    when t.eligible_grade_ids is not null and (e.grade_id is null or not (e.grade_id = any (t.eligible_grade_ids)))
      then 'The employee''s grade is not eligible for this plan.'
    when t.eligible_location_ids is not null and (e.work_location_id is null or not (e.work_location_id = any (t.eligible_location_ids)))
      then 'The employee''s work location is not eligible for this plan.'
    when not t.allow_during_probation and (e.status = 'probation' or (e.probation_end_date is not null and e.probation_end_date >= p_on))
      then 'Not available during probation' || coalesce(' (probation ends ' || to_char(e.probation_end_date, 'DD Mon YYYY') || ')', '') || '.'
  end
  from (select 1) one
  left join public.hr_employees e on e.id = p_employee
  left join public.hr_benefit_types t on t.id = p_type
$$;

-- Plan year containing p_on for a plan whose year starts in p_month.
create or replace function hr_private.benefit_plan_year_start(p_month int, p_on date)
returns date language sql immutable set search_path = '' as $$
  select case when extract(month from p_on)::int >= p_month
              then make_date(extract(year from p_on)::int, p_month, 1)
              else make_date(extract(year from p_on)::int - 1, p_month, 1) end
$$;

-- ---------------------------------------------------------------------
-- 4. Enrollment requests (self-enrollment)
-- ---------------------------------------------------------------------
create table if not exists public.hr_benefit_enrollment_requests (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references public.hr_employees(id) on delete restrict,
  benefit_type_id        uuid not null references public.hr_benefit_types(id) on delete restrict,
  requested_start_date   date not null,
  coverage_level         text not null default 'employee' check (coverage_level in ('employee','employee_spouse','employee_children','family')),
  dependants             smallint not null default 0 check (dependants between 0 and 20),
  note                   text check (note is null or length(note) <= 1000),
  status                 text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by             uuid,
  decided_by_employee_id uuid references public.hr_employees(id) on delete set null,
  decided_at             timestamptz,
  decision_note          text check (decision_note is null or length(decision_note) <= 1000),
  enrollment_id          uuid references public.hr_benefit_enrollments(id) on delete restrict,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists hr_benefit_enrollment_requests_open
  on public.hr_benefit_enrollment_requests (employee_id, benefit_type_id) where status = 'pending';
create index if not exists hr_benefit_enrollment_requests_status on public.hr_benefit_enrollment_requests (status, created_at desc);

-- ---------------------------------------------------------------------
-- 5. Dependants (optional, per enrollment)
-- ---------------------------------------------------------------------
create table if not exists public.hr_benefit_dependants (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.hr_benefit_enrollments(id) on delete restrict,
  full_name     text not null check (length(btrim(full_name)) between 2 and 120),
  relationship  text not null check (relationship in ('spouse','child','parent','parent_in_law','sibling','other')),
  date_of_birth date,
  added_by      uuid,
  created_at    timestamptz not null default now(),
  removed_at    timestamptz,
  removed_by    uuid,
  remove_reason text check (remove_reason is null or length(remove_reason) <= 500)
);
create index if not exists hr_benefit_dependants_enrollment on public.hr_benefit_dependants (enrollment_id) where removed_at is null;

-- ---------------------------------------------------------------------
-- 6. Claims + documents
-- ---------------------------------------------------------------------
create sequence if not exists public.hr_benefit_claim_seq;
create table if not exists public.hr_benefit_claims (
  id                     uuid primary key default gen_random_uuid(),
  claim_number           text not null unique default ('BC-' || lpad(nextval('public.hr_benefit_claim_seq')::text, 6, '0')),
  employee_id            uuid not null references public.hr_employees(id) on delete restrict,
  enrollment_id          uuid not null references public.hr_benefit_enrollments(id) on delete restrict,
  benefit_type_id        uuid not null references public.hr_benefit_types(id) on delete restrict,
  expense_date           date not null,
  plan_year_start        date not null,
  amount                 numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  approved_amount        numeric(12,2) check (approved_amount is null or approved_amount > 0),
  currency               text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  description            text not null check (length(btrim(description)) between 3 and 2000),
  status                 text not null default 'draft'
                         check (status in ('draft','submitted','returned','approved','rejected','cancelled','paid_externally')),
  submitted_at           timestamptz,
  decided_at             timestamptz,
  decided_by             uuid,
  decided_by_employee_id uuid references public.hr_employees(id) on delete set null,
  decision_note          text check (decision_note is null or length(decision_note) <= 2000),
  payment_reference      text check (payment_reference is null or length(btrim(payment_reference)) between 2 and 120),
  paid_on                date,
  paid_recorded_by       uuid,
  paid_recorded_at       timestamptz,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint hr_benefit_claims_approved_le_amount check (approved_amount is null or approved_amount <= amount),
  constraint hr_benefit_claims_approved_needs_amount check (status not in ('approved','paid_externally') or approved_amount is not null),
  constraint hr_benefit_claims_paid_needs_reference check (status <> 'paid_externally' or (payment_reference is not null and paid_on is not null))
);
create index if not exists hr_benefit_claims_employee on public.hr_benefit_claims (employee_id, status);
create index if not exists hr_benefit_claims_plan_year on public.hr_benefit_claims (enrollment_id, plan_year_start, status);
create index if not exists hr_benefit_claims_status on public.hr_benefit_claims (status, submitted_at);

create table if not exists public.hr_benefit_claim_documents (
  id                   uuid primary key default gen_random_uuid(),
  claim_id             uuid not null references public.hr_benefit_claims(id) on delete restrict,
  storage_path         text not null unique,
  file_name            text not null check (length(file_name) between 1 and 160),
  mime_type            text not null check (mime_type in ('application/pdf','image/png','image/jpeg','image/webp')),
  size_bytes           bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  checksum             text check (checksum is null or checksum ~ '^[a-f0-9]{64}$'),
  uploaded_by          uuid,
  uploaded_employee_id uuid references public.hr_employees(id) on delete set null,
  created_at           timestamptz not null default now(),
  removed_at           timestamptz,
  removed_by           uuid
);
create index if not exists hr_benefit_claim_documents_claim on public.hr_benefit_claim_documents (claim_id);
create index if not exists hr_benefit_claim_documents_checksum on public.hr_benefit_claim_documents (checksum) where checksum is not null and removed_at is null;

-- ---------------------------------------------------------------------
-- 7. Benefit history (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.hr_benefit_events (
  id                bigint generated always as identity primary key,
  employee_id       uuid not null references public.hr_employees(id) on delete restrict,
  benefit_type_id   uuid references public.hr_benefit_types(id) on delete restrict,
  enrollment_id     uuid references public.hr_benefit_enrollments(id) on delete restrict,
  claim_id          uuid references public.hr_benefit_claims(id) on delete restrict,
  request_id        uuid references public.hr_benefit_enrollment_requests(id) on delete restrict,
  action            text not null check (action ~ '^[a-z_]{2,40}$'),
  from_status       text,
  to_status         text,
  note              text check (note is null or length(note) <= 2000),
  actor_user_id     uuid,
  actor_employee_id uuid,
  occurred_at       timestamptz not null default now()
);
create index if not exists hr_benefit_events_employee on public.hr_benefit_events (employee_id, occurred_at desc);
create index if not exists hr_benefit_events_claim on public.hr_benefit_events (claim_id) where claim_id is not null;

create or replace function hr_benefits_internal.append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'Benefit history cannot be changed.', hint = 'append_only';
end $$;
drop trigger if exists hr_benefit_events_append_only on public.hr_benefit_events;
create trigger hr_benefit_events_append_only before update or delete on public.hr_benefit_events
  for each row execute function hr_benefits_internal.append_only();

create or replace function hr_benefits_internal.event(p_employee uuid, p_action text, p_type uuid default null, p_enrollment uuid default null,
  p_claim uuid default null, p_request uuid default null, p_from text default null, p_to text default null, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_benefit_events (employee_id, benefit_type_id, enrollment_id, claim_id, request_id, action, from_status, to_status, note,
                                        actor_user_id, actor_employee_id)
  values (p_employee, p_type, p_enrollment, p_claim, p_request, p_action, p_from, p_to, left(nullif(btrim(p_note), ''), 2000),
          auth.uid(), hr_private.current_employee_id())
$$;

-- Enrollment history for every path (114 RPCs, 208 RPCs, auto-end on exit).
create or replace function hr_benefits_internal.enrollment_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform hr_benefits_internal.event(new.employee_id, 'enrolled', new.benefit_type_id, new.id, null, null, null, new.status,
      coalesce(nullif(current_setting('hr_benefits.note', true), ''), case when new.eligibility_override is not null then 'Eligibility override: ' || new.eligibility_override end));
  elsif new.status is distinct from old.status then
    perform hr_benefits_internal.event(new.employee_id,
      case new.status when 'ended' then 'enrollment_ended' when 'cancelled' then 'enrollment_cancelled'
                      when 'suspended' then 'enrollment_suspended' else 'enrollment_reactivated' end,
      new.benefit_type_id, new.id, null, null, old.status, new.status,
      concat_ws(' · ', case when new.end_date is not null and new.status in ('ended','cancelled') then 'End date ' || to_char(new.end_date, 'DD Mon YYYY') end, new.end_reason));
  elsif (new.coverage_level, new.dependants, new.policy_number, new.employer_contribution, new.employee_contribution, new.notes)
        is distinct from (old.coverage_level, old.dependants, old.policy_number, old.employer_contribution, old.employee_contribution, old.notes) then
    perform hr_benefits_internal.event(new.employee_id, 'enrollment_changed', new.benefit_type_id, new.id, null, null, old.status, new.status,
      nullif(current_setting('hr_benefits.note', true), ''));
  end if;
  return new;
end $$;
drop trigger if exists hr_benefit_enrollments_history on public.hr_benefit_enrollments;
create trigger hr_benefit_enrollments_history after insert or update on public.hr_benefit_enrollments
  for each row execute function hr_benefits_internal.enrollment_history();

drop trigger if exists hr_benefit_types_guard on public.hr_benefit_types;
create trigger hr_benefit_types_guard before insert or update on public.hr_benefit_types
  for each row execute function hr_benefits_internal.plan_guard();

-- ---------------------------------------------------------------------
-- 8. Visibility helpers (hr_private: read-only predicates used by RLS)
-- ---------------------------------------------------------------------
create or replace function hr_private.benefits_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('benefits.view') or hr_private.has_permission('benefits.manage')
$$;

-- Claims: the claimant always; benefits staff once the claim left draft.
create or replace function hr_private.benefit_claim_visible(p_claim uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.employee_id = hr_private.current_employee_id()
                          or (c.status <> 'draft' and hr_private.benefits_staff())
                   from public.hr_benefit_claims c where c.id = p_claim), false)
$$;

create or replace function hr_private.benefit_object_can_upload(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and not hr_private.caller_is_revoked()
     and exists (select 1 from public.hr_benefit_claim_documents d join public.hr_benefit_claims c on c.id = d.claim_id
                 where d.storage_path = p_name and d.uploaded_by = auth.uid() and d.removed_at is null
                   and d.created_at > now() - interval '24 hours' and c.status in ('draft','returned'))
     and not exists (select 1 from storage.objects o where o.bucket_id = 'hr-benefit-claims' and o.name = p_name)
$$;

create or replace function hr_private.benefit_object_readable(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_benefit_claim_documents d
                 where d.storage_path = p_name and d.removed_at is null and hr_private.benefit_claim_visible(d.claim_id))
$$;

-- ---------------------------------------------------------------------
-- 9. RLS (new tables: read policies only; writes through RPCs)
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_benefit_enrollment_requests');
select hr_private.secure_table('public.hr_benefit_dependants');
select hr_private.secure_table('public.hr_benefit_claims');
select hr_private.secure_table('public.hr_benefit_claim_documents');
select hr_private.secure_table('public.hr_benefit_events');

drop policy if exists hr_benefit_enrollment_requests_read on public.hr_benefit_enrollment_requests;
create policy hr_benefit_enrollment_requests_read on public.hr_benefit_enrollment_requests for select to authenticated
  using (employee_id = hr_private.current_employee_id() or hr_private.benefits_staff());
drop policy if exists hr_benefit_dependants_read on public.hr_benefit_dependants;
create policy hr_benefit_dependants_read on public.hr_benefit_dependants for select to authenticated
  using (exists (select 1 from public.hr_benefit_enrollments x where x.id = enrollment_id
                 and (x.employee_id = hr_private.current_employee_id() or hr_private.benefits_staff())));
drop policy if exists hr_benefit_claims_read on public.hr_benefit_claims;
create policy hr_benefit_claims_read on public.hr_benefit_claims for select to authenticated
  using (employee_id = hr_private.current_employee_id() or (status <> 'draft' and hr_private.benefits_staff()));
drop policy if exists hr_benefit_claim_documents_read on public.hr_benefit_claim_documents;
create policy hr_benefit_claim_documents_read on public.hr_benefit_claim_documents for select to authenticated
  using (removed_at is null and hr_private.benefit_claim_visible(claim_id));
drop policy if exists hr_benefit_events_read on public.hr_benefit_events;
create policy hr_benefit_events_read on public.hr_benefit_events for select to authenticated
  using (employee_id = hr_private.current_employee_id()
         or (hr_private.benefits_staff()
             and (claim_id is null or exists (select 1 from public.hr_benefit_claims c where c.id = claim_id and c.status <> 'draft'))));

revoke insert, update, delete, truncate on public.hr_benefit_enrollment_requests, public.hr_benefit_dependants,
  public.hr_benefit_claims, public.hr_benefit_claim_documents, public.hr_benefit_events from authenticated;
revoke all on sequence public.hr_benefit_claim_seq from anon, authenticated, public;

drop trigger if exists hr_benefit_enrollment_requests_touch on public.hr_benefit_enrollment_requests;
create trigger hr_benefit_enrollment_requests_touch before update on public.hr_benefit_enrollment_requests
  for each row execute function hr_private.touch_updated_at();
drop trigger if exists hr_benefit_claims_touch on public.hr_benefit_claims;
create trigger hr_benefit_claims_touch before update on public.hr_benefit_claims
  for each row execute function hr_private.touch_updated_at();

-- Audit: amounts, descriptions, notes, file names and dependant details are
-- redacted (audit.view holders do not necessarily hold benefits access).
select hr_private.enable_audit('public.hr_benefit_enrollment_requests', array['note','decision_note']);
select hr_private.enable_audit('public.hr_benefit_dependants', array['full_name','date_of_birth','remove_reason']);
select hr_private.enable_audit('public.hr_benefit_claims', array['amount','approved_amount','description','decision_note','payment_reference']);
select hr_private.enable_audit('public.hr_benefit_claim_documents', array['file_name','storage_path','checksum']);

-- Storage: private bucket for claim documents (registered-path upload, like 180).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('hr-benefit-claims', 'hr-benefit-claims', false, 10485760, array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
drop policy if exists "hr-benefit-claims: registered upload" on storage.objects;
create policy "hr-benefit-claims: registered upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-benefit-claims' and hr_private.benefit_object_can_upload(name));
drop policy if exists "hr-benefit-claims: permitted read" on storage.objects;
create policy "hr-benefit-claims: permitted read" on storage.objects for select to authenticated
  using (bucket_id = 'hr-benefit-claims' and hr_private.benefit_object_readable(name));
-- No UPDATE / DELETE policies: files are immutable; removal is a flag on the document row.

-- ---------------------------------------------------------------------
-- 10. Internal helpers
-- ---------------------------------------------------------------------
-- Approved (used) and pending amounts for one enrollment and plan year.
create or replace function hr_benefits_internal.claim_usage(p_enrollment uuid, p_year_start date, p_exclude uuid default null,
  out used numeric, out pending numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(c.approved_amount) filter (where c.status in ('approved','paid_externally')), 0)::numeric,
         coalesce(sum(c.amount) filter (where c.status = 'submitted'), 0)::numeric
  from public.hr_benefit_claims c
  where c.enrollment_id = p_enrollment and c.plan_year_start = p_year_start and c.id is distinct from p_exclude
$$;

create or replace function hr_benefits_internal.money(p numeric)
returns text language sql immutable set search_path = '' as $$
  select 'INR ' || to_char(coalesce(p, 0), 'FM999,999,999,990.00')
$$;

-- Is the enrollment open for a claim on this expense date?
create or replace function hr_benefits_internal.claim_enrollment_issue(x public.hr_benefit_enrollments, t public.hr_benefit_types, p_expense date)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when x.id is null then 'Enrollment not found.'
    when t.id is null or not t.active then 'This benefit plan is no longer active.'
    when not t.claimable then 'This benefit plan does not accept claims.'
    when p_expense is null then 'Enter the expense date.'
    when p_expense > hr_private.business_today() then 'The expense date cannot be in the future.'
    when x.status not in ('active','ended') then 'Claims need an active enrollment.'
    when p_expense < x.start_date then 'The expense date is before your enrollment started (' || to_char(x.start_date, 'DD Mon YYYY') || ').'
    when x.end_date is not null and p_expense > x.end_date then 'The expense date is after your enrollment ended (' || to_char(x.end_date, 'DD Mon YYYY') || ').'
  end
$$;

-- ---------------------------------------------------------------------
-- 11. RPCs — enrollment changes and dependants (benefits.manage)
-- ---------------------------------------------------------------------
create or replace function public.hr_update_benefit_enrollment(p_enrollment uuid, p_coverage_level text default null, p_dependants int default null,
  p_policy_number text default null, p_notes text default null, p_employer_contribution numeric default null,
  p_employee_contribution numeric default null, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_benefit_enrollments; t public.hr_benefit_types;
begin
  if not hr_private.has_permission('benefits.manage') then perform hr_private.fail('You are not allowed to manage benefit enrollments.', 'forbidden'); end if;
  select * into v from public.hr_benefit_enrollments where id = p_enrollment for update;
  if v.id is null then perform hr_private.fail('Enrollment not found.', 'not_found'); end if;
  if v.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot change your own enrollment.', 'self_action'); end if;
  if v.status not in ('active','suspended') then perform hr_private.fail('Only active or suspended enrollments can be changed.', 'closed'); end if;
  select * into t from public.hr_benefit_types where id = v.benefit_type_id;
  if p_coverage_level is not null and p_coverage_level not in ('employee','employee_spouse','employee_children','family') then
    perform hr_private.fail('Unknown coverage level.', 'invalid');
  end if;
  if p_dependants is not null and (p_dependants < 0 or p_dependants > 20) then perform hr_private.fail('Dependants must be between 0 and 20.', 'invalid'); end if;
  if coalesce(p_dependants, 0) > 0 and not t.allows_dependants then perform hr_private.fail('This plan does not cover dependants.', 'no_dependants'); end if;
  if coalesce(p_employer_contribution, 0) < 0 or coalesce(p_employee_contribution, 0) < 0 then perform hr_private.fail('Contributions cannot be negative.', 'invalid'); end if;
  if nullif(btrim(p_reason), '') is null then perform hr_private.fail('Give a reason for the change.', 'reason_required'); end if;
  perform set_config('hr_benefits.note', left(btrim(p_reason), 1000), true);
  update public.hr_benefit_enrollments set
    coverage_level = coalesce(p_coverage_level, coverage_level),
    dependants = coalesce(p_dependants, dependants),
    policy_number = case when p_policy_number is null then policy_number else nullif(btrim(p_policy_number), '') end,
    notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
    employer_contribution = coalesce(p_employer_contribution, employer_contribution),
    employee_contribution = coalesce(p_employee_contribution, employee_contribution)
  where id = v.id;
  perform set_config('hr_benefits.note', '', true);
  perform hr_private.notify_employee(v.employee_id, 'benefit_updated', 'Benefit enrollment updated: ' || t.name,
    'HR updated your ' || t.name || ' enrollment.', '/employee/benefits', 'hr_benefit_enrollment', v.id::text);
end $$;

create or replace function public.hr_add_benefit_dependant(p_enrollment uuid, p_full_name text, p_relationship text, p_date_of_birth date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.hr_benefit_enrollments; t public.hr_benefit_types; v_id uuid; v_n int;
begin
  if not hr_private.has_permission('benefits.manage') then perform hr_private.fail('You are not allowed to manage benefit enrollments.', 'forbidden'); end if;
  select * into v from public.hr_benefit_enrollments where id = p_enrollment for update;
  if v.id is null then perform hr_private.fail('Enrollment not found.', 'not_found'); end if;
  if v.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot change your own enrollment.', 'self_action'); end if;
  if v.status not in ('active','suspended') then perform hr_private.fail('Only active or suspended enrollments can be changed.', 'closed'); end if;
  select * into t from public.hr_benefit_types where id = v.benefit_type_id;
  if not t.allows_dependants then perform hr_private.fail('This plan does not cover dependants.', 'no_dependants'); end if;
  if length(btrim(coalesce(p_full_name, ''))) < 2 then perform hr_private.fail('Enter the dependant''s name.', 'invalid'); end if;
  if p_relationship is null or p_relationship not in ('spouse','child','parent','parent_in_law','sibling','other') then
    perform hr_private.fail('Choose the relationship.', 'invalid');
  end if;
  if p_date_of_birth is not null and p_date_of_birth > hr_private.business_today() then perform hr_private.fail('The date of birth is in the future.', 'invalid'); end if;
  select count(*) into v_n from public.hr_benefit_dependants where enrollment_id = v.id and removed_at is null;
  if v_n >= 20 then perform hr_private.fail('An enrollment can list at most 20 dependants.', 'too_many'); end if;
  insert into public.hr_benefit_dependants (enrollment_id, full_name, relationship, date_of_birth, added_by)
  values (v.id, btrim(p_full_name), p_relationship, p_date_of_birth, auth.uid()) returning id into v_id;
  perform set_config('hr_benefits.note', 'Dependant added (' || replace(p_relationship, '_', ' ') || ')', true);
  update public.hr_benefit_enrollments set dependants = v_n + 1 where id = v.id;
  perform set_config('hr_benefits.note', '', true);
  return v_id;
end $$;

create or replace function public.hr_remove_benefit_dependant(p_dependant uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.hr_benefit_dependants; v public.hr_benefit_enrollments;
begin
  if not hr_private.has_permission('benefits.manage') then perform hr_private.fail('You are not allowed to manage benefit enrollments.', 'forbidden'); end if;
  select * into d from public.hr_benefit_dependants where id = p_dependant;
  if d.id is null or d.removed_at is not null then perform hr_private.fail('Dependant not found.', 'not_found'); end if;
  select * into v from public.hr_benefit_enrollments where id = d.enrollment_id for update;
  if v.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot change your own enrollment.', 'self_action'); end if;
  if v.status not in ('active','suspended') then perform hr_private.fail('Only active or suspended enrollments can be changed.', 'closed'); end if;
  update public.hr_benefit_dependants set removed_at = now(), removed_by = auth.uid(), remove_reason = nullif(btrim(p_reason), '') where id = d.id;
  perform set_config('hr_benefits.note', 'Dependant removed (' || replace(d.relationship, '_', ' ') || ')', true);
  update public.hr_benefit_enrollments set dependants = (select count(*) from public.hr_benefit_dependants where enrollment_id = v.id and removed_at is null)
  where id = v.id;
  perform set_config('hr_benefits.note', '', true);
end $$;

-- ---------------------------------------------------------------------
-- 12. RPCs — enrollment requests
-- ---------------------------------------------------------------------
create or replace function public.hr_request_benefit_enrollment(p_benefit_type uuid, p_start_date date default null,
  p_coverage_level text default 'employee', p_dependants int default 0, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); t public.hr_benefit_types; v_start date; v_reason text; v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Only employees can request a benefit enrollment.', 'forbidden'); end if;
  select * into t from public.hr_benefit_types where id = p_benefit_type;
  if t.id is null or not t.active then perform hr_private.fail('Benefit plan not found.', 'not_found'); end if;
  if not t.self_enrollment then perform hr_private.fail('This plan does not accept enrollment requests; contact HR.', 'self_enrollment_off'); end if;
  v_start := coalesce(p_start_date, hr_private.business_today());
  if v_start < hr_private.business_today() then perform hr_private.fail('The start date cannot be in the past.', 'invalid_start'); end if;
  if v_start > hr_private.business_today() + 365 then perform hr_private.fail('The start date must be within the next year.', 'invalid_start'); end if;
  if coalesce(p_coverage_level, 'employee') not in ('employee','employee_spouse','employee_children','family') then perform hr_private.fail('Unknown coverage level.', 'invalid'); end if;
  if coalesce(p_dependants, 0) < 0 or coalesce(p_dependants, 0) > 20 then perform hr_private.fail('Dependants must be between 0 and 20.', 'invalid'); end if;
  if coalesce(p_dependants, 0) > 0 and not t.allows_dependants then perform hr_private.fail('This plan does not cover dependants.', 'no_dependants'); end if;
  v_reason := hr_private.benefit_ineligibility(v_me, t.id, v_start);
  if v_reason is not null then perform hr_private.fail(v_reason, 'not_eligible'); end if;
  if exists (select 1 from public.hr_benefit_enrollments where employee_id = v_me and benefit_type_id = t.id and status in ('active','suspended')) then
    perform hr_private.fail('You are already enrolled in this plan.', 'already_enrolled');
  end if;
  if exists (select 1 from public.hr_benefit_enrollment_requests where employee_id = v_me and benefit_type_id = t.id and status = 'pending') then
    perform hr_private.fail('You already have a pending request for this plan.', 'duplicate_request');
  end if;
  insert into public.hr_benefit_enrollment_requests (employee_id, benefit_type_id, requested_start_date, coverage_level, dependants, note, created_by)
  values (v_me, t.id, v_start, coalesce(p_coverage_level, 'employee'), coalesce(p_dependants, 0), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  perform hr_benefits_internal.event(v_me, 'enrollment_requested', t.id, null, null, v_id, null, 'pending', nullif(btrim(p_note), ''));
  perform hr_private.notify_permission_holders('benefits.manage', 'benefit_request', 'Benefit enrollment request: ' || t.name,
    'An employee requested enrollment in ' || t.name || '.', '/hr/benefits?tab=enrollments', 'hr_benefit_enrollment_request', v_id::text, v_me);
  return v_id;
end $$;

create or replace function public.hr_cancel_benefit_enrollment_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_benefit_enrollment_requests;
begin
  select * into r from public.hr_benefit_enrollment_requests where id = p_request for update;
  if r.id is null or r.employee_id is distinct from hr_private.current_employee_id() then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if r.status <> 'pending' then perform hr_private.fail('Only pending requests can be cancelled.', 'invalid_state'); end if;
  update public.hr_benefit_enrollment_requests set status = 'cancelled' where id = r.id;
  perform hr_benefits_internal.event(r.employee_id, 'enrollment_request_cancelled', r.benefit_type_id, null, null, r.id, 'pending', 'cancelled', null);
end $$;

create or replace function public.hr_decide_benefit_enrollment_request(p_request uuid, p_approve boolean, p_note text default null,
  p_start_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.hr_benefit_enrollment_requests; t public.hr_benefit_types; v_enr uuid;
begin
  if not hr_private.has_permission('benefits.manage') then perform hr_private.fail('You are not allowed to decide benefit requests.', 'forbidden'); end if;
  select * into r from public.hr_benefit_enrollment_requests where id = p_request for update;
  if r.id is null then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() or r.created_by = auth.uid() then
    perform hr_private.fail('You cannot decide your own request; another HR user must do it.', 'self_action');
  end if;
  if r.status <> 'pending' then perform hr_private.fail('This request has already been decided.', 'invalid_state'); end if;
  select * into t from public.hr_benefit_types where id = r.benefit_type_id;
  if p_approve is null then perform hr_private.fail('Choose approve or reject.', 'invalid'); end if;
  if not p_approve then
    if nullif(btrim(p_note), '') is null then perform hr_private.fail('Give a reason for the rejection.', 'reason_required'); end if;
    update public.hr_benefit_enrollment_requests set status = 'rejected', decided_by = auth.uid(), decided_by_employee_id = hr_private.current_employee_id(),
      decided_at = now(), decision_note = btrim(p_note) where id = r.id;
    perform hr_benefits_internal.event(r.employee_id, 'enrollment_request_rejected', r.benefit_type_id, null, null, r.id, 'pending', 'rejected', p_note);
    perform hr_private.notify_employee(r.employee_id, 'benefit_request_decided', 'Benefit request rejected: ' || t.name,
      'Your enrollment request was rejected: ' || btrim(p_note), '/employee/benefits', 'hr_benefit_enrollment_request', r.id::text);
    return null;
  end if;
  -- Approve: 114's enroll RPC re-checks eligibility (no override) and duplicates, and notifies the employee.
  perform set_config('hr_benefits.note', 'Approved enrollment request' || coalesce(': ' || nullif(btrim(p_note), ''), ''), true);
  v_enr := public.hr_enroll_benefit(r.employee_id, r.benefit_type_id, coalesce(p_start_date, greatest(r.requested_start_date, hr_private.business_today())),
                                    r.coverage_level, r.dependants, null, nullif(btrim(p_note), ''), null, null, null);
  perform set_config('hr_benefits.note', '', true);
  update public.hr_benefit_enrollment_requests set status = 'approved', decided_by = auth.uid(), decided_by_employee_id = hr_private.current_employee_id(),
    decided_at = now(), decision_note = nullif(btrim(p_note), ''), enrollment_id = v_enr where id = r.id;
  perform hr_benefits_internal.event(r.employee_id, 'enrollment_request_approved', r.benefit_type_id, v_enr, null, r.id, 'pending', 'approved', p_note);
  return v_enr;
end $$;

-- ---------------------------------------------------------------------
-- 13. RPCs — claims (employee)
-- ---------------------------------------------------------------------
-- Create (p_claim null) or update an own draft / returned claim.
create or replace function public.hr_save_benefit_claim(p_claim uuid, p_enrollment uuid, p_expense_date date, p_amount numeric, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); c public.hr_benefit_claims; x public.hr_benefit_enrollments; t public.hr_benefit_types;
        v_issue text; v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Only employees can submit benefit claims.', 'forbidden'); end if;
  if p_claim is not null then
    select * into c from public.hr_benefit_claims where id = p_claim for update;
    if c.id is null or c.employee_id <> v_me then perform hr_private.fail('Claim not found.', 'not_found'); end if;
    if c.status not in ('draft','returned') then perform hr_private.fail('Only draft or returned claims can be edited.', 'invalid_state'); end if;
  end if;
  select * into x from public.hr_benefit_enrollments where id = p_enrollment;
  if x.id is null or x.employee_id <> v_me then perform hr_private.fail('Choose one of your benefit enrollments.', 'not_found'); end if;
  select * into t from public.hr_benefit_types where id = x.benefit_type_id;
  v_issue := hr_benefits_internal.claim_enrollment_issue(x, t, p_expense_date);
  if v_issue is not null then perform hr_private.fail(v_issue, 'invalid_claim'); end if;
  if p_amount is null or p_amount <= 0 then perform hr_private.fail('Enter an amount greater than zero.', 'invalid_amount'); end if;
  if p_amount > 10000000 then perform hr_private.fail('The amount is too large.', 'invalid_amount'); end if;
  if round(p_amount, 2) <> p_amount then perform hr_private.fail('Use at most two decimal places.', 'invalid_amount'); end if;
  if length(btrim(coalesce(p_description, ''))) < 3 then perform hr_private.fail('Describe the expense (at least 3 characters).', 'invalid'); end if;
  if length(p_description) > 2000 then perform hr_private.fail('The description is too long (2000 characters).', 'invalid'); end if;
  if c.id is null then
    insert into public.hr_benefit_claims (employee_id, enrollment_id, benefit_type_id, expense_date, plan_year_start, amount, description, created_by)
    values (v_me, x.id, x.benefit_type_id, p_expense_date, hr_private.benefit_plan_year_start(t.plan_year_start_month, p_expense_date),
            p_amount, btrim(p_description), auth.uid())
    returning id into v_id;
    perform hr_benefits_internal.event(v_me, 'claim_created', x.benefit_type_id, x.id, v_id, null, null, 'draft', null);
  else
    update public.hr_benefit_claims set enrollment_id = x.id, benefit_type_id = x.benefit_type_id, expense_date = p_expense_date,
      plan_year_start = hr_private.benefit_plan_year_start(t.plan_year_start_month, p_expense_date), amount = p_amount, description = btrim(p_description)
    where id = c.id;
    v_id := c.id;
    perform hr_benefits_internal.event(v_me, 'claim_updated', x.benefit_type_id, x.id, v_id, null, c.status, c.status, null);
  end if;
  return v_id;
end $$;

create or replace function public.hr_submit_benefit_claim(p_claim uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); c public.hr_benefit_claims; x public.hr_benefit_enrollments; t public.hr_benefit_types;
        v_issue text; u record; d record; v_avail numeric;
begin
  select * into c from public.hr_benefit_claims where id = p_claim;
  if c.id is null or v_me is null or c.employee_id <> v_me then perform hr_private.fail('Claim not found.', 'not_found'); end if;
  -- Serialise claims on the same enrollment (limit checks) before locking the claim.
  select * into x from public.hr_benefit_enrollments where id = c.enrollment_id for update;
  select * into c from public.hr_benefit_claims where id = p_claim for update;
  if c.status not in ('draft','returned') then perform hr_private.fail('Only draft or returned claims can be submitted.', 'invalid_state'); end if;
  select * into t from public.hr_benefit_types where id = c.benefit_type_id;
  v_issue := hr_benefits_internal.claim_enrollment_issue(x, t, c.expense_date);
  if v_issue is not null then perform hr_private.fail(v_issue, 'invalid_claim'); end if;
  -- Documents: every registered file must be uploaded; at least one when the plan requires it.
  for d in select * from public.hr_benefit_claim_documents where claim_id = c.id and removed_at is null loop
    if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-benefit-claims' and o.name = d.storage_path) then
      perform hr_private.fail('The file "' || d.file_name || '" did not finish uploading. Remove it and attach it again.', 'upload_incomplete');
    end if;
    if d.checksum is not null and exists (
         select 1 from public.hr_benefit_claim_documents o join public.hr_benefit_claims oc on oc.id = o.claim_id
         where o.checksum = d.checksum and o.claim_id <> c.id and o.removed_at is null and oc.status not in ('draft','cancelled','rejected')) then
      perform hr_private.fail('The document "' || d.file_name || '" was already used on another claim.', 'duplicate_document');
    end if;
  end loop;
  if t.claim_requires_document and not exists (select 1 from public.hr_benefit_claim_documents where claim_id = c.id and removed_at is null) then
    perform hr_private.fail('Attach a supporting document (bill, receipt or certificate) before submitting.', 'document_required');
  end if;
  if t.annual_limit is not null then
    select * into u from hr_benefits_internal.claim_usage(x.id, c.plan_year_start, c.id);
    v_avail := t.annual_limit - u.used - u.pending;
    if c.amount > v_avail then
      perform hr_private.fail('The amount exceeds the remaining annual limit: ' || hr_benefits_internal.money(greatest(v_avail, 0))
        || ' available of ' || hr_benefits_internal.money(t.annual_limit)
        || case when u.pending > 0 then ' (' || hr_benefits_internal.money(u.pending) || ' is in other pending claims)' else '' end || '.', 'limit_exceeded');
    end if;
  end if;
  update public.hr_benefit_claims set status = 'submitted', submitted_at = now(), decided_at = null, decided_by = null, decided_by_employee_id = null
  where id = c.id;
  perform hr_benefits_internal.event(v_me, case when c.status = 'returned' then 'claim_resubmitted' else 'claim_submitted' end,
    c.benefit_type_id, c.enrollment_id, c.id, null, c.status, 'submitted', p_note);
  perform hr_private.notify_permission_holders('benefits.manage', 'benefit_claim', 'Benefit claim ' || c.claim_number || ': ' || t.name,
    'A benefit claim is waiting for review.', '/hr/benefits?tab=claims', 'hr_benefit_claim', c.id::text, v_me);
end $$;

create or replace function public.hr_cancel_benefit_claim(p_claim uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.hr_benefit_claims;
begin
  select * into c from public.hr_benefit_claims where id = p_claim for update;
  if c.id is null or c.employee_id is distinct from hr_private.current_employee_id() then perform hr_private.fail('Claim not found.', 'not_found'); end if;
  if c.status not in ('draft','returned','submitted') then perform hr_private.fail('This claim can no longer be withdrawn.', 'invalid_state'); end if;
  update public.hr_benefit_claims set status = 'cancelled' where id = c.id;
  perform hr_benefits_internal.event(c.employee_id, 'claim_cancelled', c.benefit_type_id, c.enrollment_id, c.id, null, c.status, 'cancelled', p_reason);
end $$;

create or replace function public.hr_register_benefit_claim_document(p_claim uuid, p_file_name text, p_mime_type text, p_size_bytes bigint,
  p_checksum text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.hr_benefit_claims; v_me uuid := hr_private.current_employee_id(); v_id uuid := gen_random_uuid(); v_name text; v_path text;
        v_mime text := lower(btrim(coalesce(p_mime_type, ''))); v_sum text := lower(nullif(btrim(p_checksum), ''));
begin
  if auth.uid() is null or hr_private.caller_is_revoked() then perform hr_private.fail('Sign in first.', 'not_authenticated'); end if;
  select * into c from public.hr_benefit_claims where id = p_claim for update;
  if c.id is null or v_me is null or c.employee_id <> v_me then perform hr_private.fail('Claim not found.', 'not_found'); end if;
  if c.status not in ('draft','returned') then perform hr_private.fail('Documents can be added only while the claim is a draft or returned to you.', 'invalid_state'); end if;
  if (select count(*) from public.hr_benefit_claim_documents where claim_id = c.id and removed_at is null) >= 10 then
    perform hr_private.fail('A claim can have at most 10 documents.', 'too_many_files');
  end if;
  v_name := hr_private.document_validate_file(p_file_name, v_mime, p_size_bytes);
  if v_mime not in ('application/pdf','image/png','image/jpeg','image/webp') then
    perform hr_private.fail('Only PDF, PNG, JPEG and WEBP files can be attached to claims.', 'invalid_file_type');
  end if;
  if v_sum is not null and v_sum !~ '^[a-f0-9]{64}$' then v_sum := null; end if;
  v_path := c.id::text || '/' || v_id::text || '-' || v_name;
  insert into public.hr_benefit_claim_documents (id, claim_id, storage_path, file_name, mime_type, size_bytes, checksum, uploaded_by, uploaded_employee_id)
  values (v_id, c.id, v_path, v_name, v_mime, p_size_bytes, v_sum, auth.uid(), v_me);
  perform hr_benefits_internal.event(c.employee_id, 'claim_document_added', c.benefit_type_id, c.enrollment_id, c.id, null, c.status, c.status, v_name);
  return jsonb_build_object('document_id', v_id, 'bucket', 'hr-benefit-claims', 'storage_path', v_path);
end $$;

create or replace function public.hr_remove_benefit_claim_document(p_document uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.hr_benefit_claim_documents; c public.hr_benefit_claims;
begin
  select * into d from public.hr_benefit_claim_documents where id = p_document;
  if d.id is null or d.removed_at is not null or d.uploaded_by is distinct from auth.uid() then perform hr_private.fail('File not found.', 'not_found'); end if;
  select * into c from public.hr_benefit_claims where id = d.claim_id for update;
  if c.status not in ('draft','returned') then perform hr_private.fail('Files cannot be removed once the claim is submitted.', 'invalid_state'); end if;
  update public.hr_benefit_claim_documents set removed_at = now(), removed_by = auth.uid() where id = d.id;
  perform hr_benefits_internal.event(c.employee_id, 'claim_document_removed', c.benefit_type_id, c.enrollment_id, c.id, null, c.status, c.status, d.file_name);
end $$;

-- ---------------------------------------------------------------------
-- 14. RPCs — claims (HR: benefits.manage, never on one's own claim)
-- ---------------------------------------------------------------------
create or replace function public.hr_decide_benefit_claim(p_claim uuid, p_action text, p_note text default null, p_approved_amount numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.hr_benefit_claims; x public.hr_benefit_enrollments; t public.hr_benefit_types; u record; v_amount numeric; v_to text;
begin
  if not hr_private.has_permission('benefits.manage') then perform hr_private.fail('You are not allowed to decide benefit claims.', 'forbidden'); end if;
  select * into c from public.hr_benefit_claims where id = p_claim;
  if c.id is null or c.status = 'draft' then perform hr_private.fail('Claim not found.', 'not_found'); end if;
  if c.employee_id = hr_private.current_employee_id() or c.created_by = auth.uid() then
    perform hr_private.fail('You cannot decide your own claim; another HR user must do it.', 'self_action');
  end if;
  select * into x from public.hr_benefit_enrollments where id = c.enrollment_id for update;
  select * into c from public.hr_benefit_claims where id = p_claim for update;
  if c.status <> 'submitted' then perform hr_private.fail('Only submitted claims can be decided.', 'invalid_state'); end if;
  if p_action not in ('approve','reject','return') then perform hr_private.fail('Unknown action.', 'invalid'); end if;
  select * into t from public.hr_benefit_types where id = c.benefit_type_id;
  if p_action in ('reject','return') then
    if nullif(btrim(p_note), '') is null then
      perform hr_private.fail(case when p_action = 'reject' then 'Give a reason for the rejection.' else 'Tell the employee what to change.' end, 'reason_required');
    end if;
    v_to := case when p_action = 'reject' then 'rejected' else 'returned' end;
    update public.hr_benefit_claims set status = v_to, decided_at = now(), decided_by = auth.uid(),
      decided_by_employee_id = hr_private.current_employee_id(), decision_note = btrim(p_note) where id = c.id;
  else
    v_amount := coalesce(p_approved_amount, c.amount);
    if v_amount <= 0 or v_amount > c.amount then perform hr_private.fail('The approved amount must be more than zero and at most the claimed amount.', 'invalid_amount'); end if;
    if round(v_amount, 2) <> v_amount then perform hr_private.fail('Use at most two decimal places.', 'invalid_amount'); end if;
    if v_amount < c.amount and nullif(btrim(p_note), '') is null then
      perform hr_private.fail('Explain why less than the claimed amount is approved.', 'reason_required');
    end if;
    if t.annual_limit is not null then
      select * into u from hr_benefits_internal.claim_usage(x.id, c.plan_year_start, c.id);
      if v_amount > t.annual_limit - u.used then
        perform hr_private.fail('Approving this amount would exceed the annual limit: ' || hr_benefits_internal.money(greatest(t.annual_limit - u.used, 0))
          || ' remains of ' || hr_benefits_internal.money(t.annual_limit) || '.', 'limit_exceeded');
      end if;
    end if;
    v_to := 'approved';
    update public.hr_benefit_claims set status = 'approved', approved_amount = v_amount, decided_at = now(), decided_by = auth.uid(),
      decided_by_employee_id = hr_private.current_employee_id(), decision_note = nullif(btrim(p_note), '') where id = c.id;
  end if;
  perform hr_benefits_internal.event(c.employee_id, 'claim_' || v_to, c.benefit_type_id, c.enrollment_id, c.id, null, 'submitted', v_to,
    concat_ws(' · ', case when v_to = 'approved' and v_amount < c.amount then 'Approved ' || hr_benefits_internal.money(v_amount) || ' of ' || hr_benefits_internal.money(c.amount) end,
              nullif(btrim(p_note), '')));
  perform hr_private.notify_employee(c.employee_id, 'benefit_claim_decided', 'Benefit claim ' || c.claim_number || ' ' || v_to,
    case v_to when 'approved' then 'Your ' || t.name || ' claim was approved. Payment is handled outside payroll; HR records it when paid.'
              when 'returned' then 'Your ' || t.name || ' claim was returned for changes: ' || btrim(p_note)
              else 'Your ' || t.name || ' claim was rejected: ' || btrim(p_note) end,
    '/employee/benefits?tab=claims', 'hr_benefit_claim', c.id::text);
end $$;

-- Manual record that an approved claim was paid OUTSIDE payroll (no payroll effect).
create or replace function public.hr_record_benefit_claim_payment(p_claim uuid, p_reference text, p_paid_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.hr_benefit_claims;
begin
  if not hr_private.has_permission('benefits.manage') then perform hr_private.fail('You are not allowed to record benefit payments.', 'forbidden'); end if;
  select * into c from public.hr_benefit_claims where id = p_claim for update;
  if c.id is null or c.status = 'draft' then perform hr_private.fail('Claim not found.', 'not_found'); end if;
  if c.employee_id = hr_private.current_employee_id() or c.created_by = auth.uid() then
    perform hr_private.fail('You cannot record payment of your own claim.', 'self_action');
  end if;
  if c.status <> 'approved' then perform hr_private.fail('Only approved claims can be marked as paid.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reference, ''))) < 2 or length(btrim(p_reference)) > 120 then
    perform hr_private.fail('Enter the payment reference (2–120 characters).', 'reference_required');
  end if;
  if p_paid_on is null or p_paid_on > hr_private.business_today() then perform hr_private.fail('Enter the payment date (today or earlier).', 'invalid_date'); end if;
  if p_paid_on < c.decided_at::date then perform hr_private.fail('The payment date is before the approval.', 'invalid_date'); end if;
  update public.hr_benefit_claims set status = 'paid_externally', payment_reference = btrim(p_reference), paid_on = p_paid_on,
    paid_recorded_by = auth.uid(), paid_recorded_at = now() where id = c.id;
  perform hr_benefits_internal.event(c.employee_id, 'claim_paid_externally', c.benefit_type_id, c.enrollment_id, c.id, null, 'approved', 'paid_externally',
    'Paid on ' || to_char(p_paid_on, 'DD Mon YYYY'));
  perform hr_private.notify_employee(c.employee_id, 'benefit_claim_paid', 'Benefit claim ' || c.claim_number || ' paid',
    'HR recorded the payment of your claim on ' || to_char(p_paid_on, 'DD Mon YYYY') || '.', '/employee/benefits?tab=claims', 'hr_benefit_claim', c.id::text);
end $$;

-- ---------------------------------------------------------------------
-- 15. Read RPCs — balances and overview
-- ---------------------------------------------------------------------
-- Annual-limit balance per enrollment (own, or benefits staff for anyone).
create or replace function public.hr_benefit_balances(p_employee uuid default null, p_on date default null)
returns table (enrollment_id uuid, benefit_type_id uuid, plan_name text, status text, claimable boolean, plan_year_start date, plan_year_end date,
               annual_limit numeric, used numeric, pending numeric, remaining numeric, available numeric)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_emp uuid := coalesce(p_employee, hr_private.current_employee_id()); v_on date := coalesce(p_on, hr_private.business_today());
begin
  if v_emp is null then return; end if;
  if not (v_emp = hr_private.current_employee_id() or hr_private.benefits_staff()) then
    perform hr_private.fail('You are not allowed to view this employee''s benefits.', 'forbidden');
  end if;
  return query
    select x.id, t.id, t.name, x.status, t.claimable, y.ys, (y.ys + interval '1 year' - interval '1 day')::date,
           t.annual_limit, u.used, u.pending,
           case when t.annual_limit is null then null else greatest(t.annual_limit - u.used, 0) end,
           case when t.annual_limit is null then null else greatest(t.annual_limit - u.used - u.pending, 0) end
    from public.hr_benefit_enrollments x
    join public.hr_benefit_types t on t.id = x.benefit_type_id
    cross join lateral (select hr_private.benefit_plan_year_start(t.plan_year_start_month, least(v_on, coalesce(x.end_date, v_on))) ys) y
    cross join lateral hr_benefits_internal.claim_usage(x.id, y.ys, null) u
    where x.employee_id = v_emp and x.status in ('active','suspended','ended')
    order by (x.status = 'ended'), t.name;
end $$;

create or replace function public.hr_benefits_overview(p_on date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_on date := coalesce(p_on, hr_private.business_today()); v jsonb;
begin
  if not hr_private.benefits_staff() then perform hr_private.fail('Benefit reports need benefits access.', 'forbidden'); end if;
  with plans as (
    select t.*, hr_private.benefit_plan_year_start(t.plan_year_start_month, v_on) ys from public.hr_benefit_types t
  ), per as (
    select p.id, p.code, p.name, p.category, coalesce(c.name, p.category) category_name, p.active, p.claimable, p.annual_limit, p.ys plan_year_start,
      (select count(*) from public.hr_benefit_enrollments e where e.benefit_type_id = p.id and e.status = 'active') enrolled,
      (select count(*) from public.hr_benefit_enrollments e where e.benefit_type_id = p.id and e.status = 'suspended') suspended,
      (select count(*) from public.hr_benefit_claims k where k.benefit_type_id = p.id and k.status = 'submitted') pending_claims,
      (select coalesce(sum(k.amount), 0) from public.hr_benefit_claims k where k.benefit_type_id = p.id and k.status = 'submitted') pending_amount,
      (select count(*) from public.hr_benefit_claims k where k.benefit_type_id = p.id and k.plan_year_start = p.ys and k.status in ('approved','paid_externally')) approved_claims,
      (select coalesce(sum(k.approved_amount), 0) from public.hr_benefit_claims k where k.benefit_type_id = p.id and k.plan_year_start = p.ys and k.status in ('approved','paid_externally')) approved_amount,
      (select coalesce(sum(k.approved_amount), 0) from public.hr_benefit_claims k where k.benefit_type_id = p.id and k.plan_year_start = p.ys and k.status = 'paid_externally') paid_amount,
      (select count(*) from public.hr_benefit_claims k where k.benefit_type_id = p.id and k.plan_year_start = p.ys and k.status = 'rejected') rejected_claims
    from plans p left join public.hr_benefit_categories c on c.code = p.category
  ), per2 as (
    select per.*, case when claimable and annual_limit is not null then annual_limit * enrolled end limit_total from per
  )
  select jsonb_build_object(
    'as_of', v_on,
    'kpis', jsonb_build_object(
      'enrolled_employees', (select count(distinct employee_id) from public.hr_benefit_enrollments where status = 'active'),
      'active_enrollments', (select count(*) from public.hr_benefit_enrollments where status = 'active'),
      'plans_active', (select count(*) from public.hr_benefit_types where active),
      'plans_total', (select count(*) from public.hr_benefit_types),
      'pending_claims', (select count(*) from public.hr_benefit_claims where status = 'submitted'),
      'pending_claim_amount', (select coalesce(sum(amount), 0) from public.hr_benefit_claims where status = 'submitted'),
      'approved_unpaid_claims', (select count(*) from public.hr_benefit_claims where status = 'approved'),
      'pending_enrollment_requests', (select count(*) from public.hr_benefit_enrollment_requests where status = 'pending'),
      'approved_amount_year', (select coalesce(sum(approved_amount), 0) from per2),
      'limit_total_year', (select coalesce(sum(limit_total), 0) from per2),
      'utilisation_pct', (select case when coalesce(sum(limit_total), 0) > 0
                                      then round(100 * sum(approved_amount) filter (where limit_total is not null) / sum(limit_total), 1) end from per2)),
    'plans', coalesce((select jsonb_agg(to_jsonb(per2) || jsonb_build_object('utilisation_pct',
                         case when limit_total > 0 then round(100 * approved_amount / limit_total, 1) end) order by per2.active desc, per2.name) from per2), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'category_name', category_name, 'plans', n, 'enrolled', enrolled,
                         'approved_amount', approved_amount) order by category_name)
                       from (select category, category_name, count(*) n, sum(enrolled) enrolled, sum(approved_amount) approved_amount from per2 group by 1, 2) g), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 16. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.hr_update_benefit_enrollment(uuid, text, int, text, text, numeric, numeric, text),
  public.hr_add_benefit_dependant(uuid, text, text, date),
  public.hr_remove_benefit_dependant(uuid, text),
  public.hr_request_benefit_enrollment(uuid, date, text, int, text),
  public.hr_cancel_benefit_enrollment_request(uuid),
  public.hr_decide_benefit_enrollment_request(uuid, boolean, text, date),
  public.hr_save_benefit_claim(uuid, uuid, date, numeric, text),
  public.hr_submit_benefit_claim(uuid, text),
  public.hr_cancel_benefit_claim(uuid, text),
  public.hr_register_benefit_claim_document(uuid, text, text, bigint, text),
  public.hr_remove_benefit_claim_document(uuid),
  public.hr_decide_benefit_claim(uuid, text, text, numeric),
  public.hr_record_benefit_claim_payment(uuid, text, date),
  public.hr_benefit_balances(uuid, date),
  public.hr_benefits_overview(date)
from anon, public;
grant execute on function
  public.hr_update_benefit_enrollment(uuid, text, int, text, text, numeric, numeric, text),
  public.hr_add_benefit_dependant(uuid, text, text, date),
  public.hr_remove_benefit_dependant(uuid, text),
  public.hr_request_benefit_enrollment(uuid, date, text, int, text),
  public.hr_cancel_benefit_enrollment_request(uuid),
  public.hr_decide_benefit_enrollment_request(uuid, boolean, text, date),
  public.hr_save_benefit_claim(uuid, uuid, date, numeric, text),
  public.hr_submit_benefit_claim(uuid, text),
  public.hr_cancel_benefit_claim(uuid, text),
  public.hr_register_benefit_claim_document(uuid, text, text, bigint, text),
  public.hr_remove_benefit_claim_document(uuid),
  public.hr_decide_benefit_claim(uuid, text, text, numeric),
  public.hr_record_benefit_claim_payment(uuid, text, date),
  public.hr_benefit_balances(uuid, date),
  public.hr_benefits_overview(date)
to authenticated;

-- RLS predicates must be executable by signed-in users; nothing for anon.
revoke execute on function hr_private.benefits_staff(), hr_private.benefit_claim_visible(uuid), hr_private.benefit_object_can_upload(text),
  hr_private.benefit_object_readable(text), hr_private.benefit_plan_year_start(int, date), hr_private.benefit_ineligibility(uuid, uuid, date) from anon, public;
grant execute on function hr_private.benefits_staff(), hr_private.benefit_claim_visible(uuid), hr_private.benefit_object_can_upload(text),
  hr_private.benefit_object_readable(text), hr_private.benefit_plan_year_start(int, date), hr_private.benefit_ineligibility(uuid, uuid, date) to authenticated, service_role;

-- Internal helpers: owner only.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'hr_benefits_internal' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

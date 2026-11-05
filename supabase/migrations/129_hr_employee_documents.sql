-- =====================================================================
-- 129_hr_employee_documents.sql — Module 9: Employee Documents
--   (central document service on top of 107_hr_documents.sql)
-- =====================================================================
-- Depends on 100 (foundation), 103 (notify_permission_holders), 104
-- (offers / internships), 105 (salary structures), 107 (documents),
-- 113 (legal entities). Reads 120 (offer letter versions) at RUN time
-- only, and only when that table exists.
--
-- Everything here is ADDITIVE. No 107 table, column, RPC signature or
-- storage policy is removed or renamed, so every existing screen, test
-- 107 and the local harness keep working. hr_documents stays the single
-- document record and the private 'hr-documents' bucket stays the single
-- file store (letters, contracts, certificates and policy PDFs included).
--
-- Adds:
--   * category groups (offer / appointment / contract / certificate /
--     letter / policy / identity ...), compensation flag, per-category
--     reminder schedule; new categories (appointment letter, internship
--     certificate, employment confirmation, experience / relieving letter,
--     contract attachment)
--   * document metadata: source (upload / generated / recruitment),
--     issue / effective / renewal dates, contract type + status,
--     supersedes (renewals) and parent (attachments) links, notes,
--     acknowledgement requirement, 'replaced' verification status
--   * compensation restriction: documents that include compensation are
--     readable only by the employee and holders of documents.compensation
--   * verification history (every status change) + review notes; HR is
--     notified in-app when an employee's own upload lands in storage
--   * letter templates (draft -> approved snapshot -> archived) with an
--     allow-list of {{placeholders}} (no code execution), permission-gated
--     compensation placeholders, preview and issue; the rendered text is
--     stored server-side (immutable) and the PDF built from it is stored
--     as a normal document version
--   * offer letters: Recruitment keeps the offer, its template, status and
--     acceptance; an accepted offer's letter can be FILED to the hired
--     employee's documents (one record per offer, no second workflow)
--   * contract renewal (new record supersedes the old one; old versions
--     and the old record stay untouched) and supporting attachments
--   * company policies (draft -> published -> archived) with immutable
--     published versions, audience targeting and optional PDF
--   * acknowledgements (policies and documents, per version, append-only)
--     with pending tracking and throttled reminders. An acknowledgement is
--     a record of receipt, NOT a digital signature.
--   * staged expiry / renewal reminders (configurable days, recipients,
--     email opt-in) with a run log; callable by the service role (scheduler)
--     or HR. No scheduler is configured by this migration.
--   * overview + filtered directory RPCs (counts from real rows, scoped by
--     the same read rules as the tables)
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permission + settings
-- ---------------------------------------------------------------------
insert into public.hr_permissions (key, module, action, description) values
  ('documents.compensation', 'documents', 'compensation', 'Generate and read letters that contain compensation details')
on conflict (key) do nothing;
-- super_admin passes every check; HR Admin gets it explicitly. Auto-filling
-- salary figures from payroll additionally requires payroll.view.
insert into public.hr_role_permissions (role_key, permission_key) values ('hr_admin', 'documents.compensation')
on conflict do nothing;

insert into public.hr_settings (key, value, description) values
  ('documents', jsonb_build_object(
     'expiry_reminder_days', jsonb_build_array(30, 15, 7, 0),
     'renewal_reminder_days', jsonb_build_array(60, 30, 15, 0),
     'expiring_soon_days', 30,
     'notify_employee', true,
     'notify_hr', true,
     'notify_manager', false,
     'email_reminders', false,
     'acknowledgement_reminder_hours', 24),
   'Employee documents: reminder schedule (days before expiry / renewal; 0 = on the day), recipients, email opt-in')
on conflict (key) do nothing;

-- Settings merged over defaults (a partially edited row never breaks the job).
create or replace function hr_private.doc_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
     'expiry_reminder_days', jsonb_build_array(30, 15, 7, 0),
     'renewal_reminder_days', jsonb_build_array(60, 30, 15, 0),
     'expiring_soon_days', 30, 'notify_employee', true, 'notify_hr', true, 'notify_manager', false,
     'email_reminders', false, 'acknowledgement_reminder_hours', 24)
   || coalesce(hr_private.setting('documents'), '{}'::jsonb)
$$;

create or replace function hr_private.doc_int_array(p jsonb)
returns int[] language sql immutable set search_path = '' as $$
  select coalesce(array(select distinct (x)::int from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
                        where x ~ '^\d{1,3}$' order by 1 desc), '{}')
$$;

-- ---------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------
create or replace function hr_private.doc_jtext(p jsonb, k text, p_max int default 200)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(regexp_replace(coalesce(p ->> k, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), '');
begin
  if v is not null and length(v) > p_max then
    perform hr_private.fail(replace(k, '_', ' ') || ' is too long (' || p_max || ' characters maximum).', 'invalid');
  end if;
  return v;
end $$;

create or replace function hr_private.doc_juuid(p jsonb, k text)
returns uuid language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(p ->> k, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then btrim(p ->> k)::uuid end
$$;

create or replace function hr_private.doc_jdate(p jsonb, k text)
returns date language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p ->> k, '')), '');
begin
  if v is null then return null; end if;
  if v !~ '^\d{4}-\d{2}-\d{2}$' then perform hr_private.fail('Enter ' || replace(k, '_', ' ') || ' as a date.', 'invalid'); end if;
  return v::date;
exception when datetime_field_overflow or invalid_datetime_format then
  perform hr_private.fail('Enter ' || replace(k, '_', ' ') || ' as a valid date.', 'invalid');
  return null;
end $$;

create or replace function hr_private.doc_fmt_date(d date)
returns text language sql immutable set search_path = '' as $$
  select to_char(d, 'DD Mon YYYY')
$$;

-- SECURITY NOTE (all hr_private helpers below): 100 sets default privileges
-- that grant EXECUTE on every new hr_private function to authenticated, and
-- later migrations re-run blanket grants. Revokes are therefore not a control.
-- Every helper that reads beyond the caller's scope or writes data checks
-- permissions itself, so a direct call through the Data API gains nothing.
create or replace function hr_private.doc_employee_name(p_employee uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)) from public.hr_employees e
  where e.id = p_employee
    and (e.id = hr_private.current_employee_id()
         or hr_private.has_permission('documents.manage') or hr_private.has_permission('documents.view')
         or hr_private.can_access_employee(e.id, 'employees'))
$$;

-- 'none' | 'valid' | 'expiring' | 'expired' (replaced records never count as expiring).
create or replace function hr_private.doc_expiry_status(p_expiry date, p_status text, p_today date, p_soon int)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_status = 'replaced' then 'none'
    when p_status = 'expired' or (p_expiry is not null and p_expiry < p_today) then 'expired'
    when p_expiry is null then 'none'
    when p_expiry <= p_today + p_soon then 'expiring'
    else 'valid' end
$$;

-- Append-only records (letter text, template snapshots, acknowledgements).
create or replace function hr_private.doc_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform hr_private.fail('This record is permanent and cannot be changed or deleted.', 'immutable');
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Categories: groups, compensation, reminder schedule, new categories
-- ---------------------------------------------------------------------
alter table public.hr_document_categories
  add column doc_group text not null default 'other'
    check (doc_group in ('offer_letter','appointment_letter','contract','certificate','letter','policy','identity','attachment','confidential','other')),
  add column contains_compensation boolean not null default false,
  add column reminder_days smallint[]
    check (reminder_days is null or (cardinality(reminder_days) between 1 and 8 and 0 <= all (reminder_days) and 365 >= all (reminder_days)));

update public.hr_document_categories set doc_group = case code
    when 'offer_letter' then 'offer_letter'
    when 'employment_agreement' then 'contract'
    when 'id_proof' then 'identity' when 'passport' then 'identity' when 'work_permit' then 'identity'
    when 'visa' then 'identity' when 'national_id' then 'identity'
    when 'education_certificate' then 'certificate' when 'experience_certificate' then 'certificate'
    when 'training_certificate' then 'certificate'
    when 'hr_letter' then 'letter'
    when 'policy_acknowledgement' then 'policy'
    when 'hr_confidential' then 'confidential'
    else doc_group end;
update public.hr_document_categories set contains_compensation = true where code = 'offer_letter';

insert into public.hr_document_categories
  (code, name, description, requires_expiry, employee_can_upload, employee_can_view, is_confidential, checklist_required, sort_order, doc_group, contains_compensation) values
  ('appointment_letter',      'Appointment letter',          'Appointment letter issued by HR after hiring',              false, false, true, false, false, 20, 'appointment_letter', false),
  ('internship_certificate',  'Internship certificate',      'Internship completion certificate',                         false, true,  true, false, false, 21, 'certificate', false),
  ('employment_confirmation', 'Employment confirmation',     'Confirmation of employment / probation completion letter',  false, false, true, false, false, 22, 'certificate', false),
  ('experience_letter',       'Experience letter (issued)',  'Experience letter issued by Zyllo Tech',                    false, false, true, false, false, 23, 'certificate', false),
  ('relieving_letter',        'Relieving letter',            'Relieving letter issued on exit',                           false, false, true, false, false, 24, 'letter', false),
  ('contract_attachment',     'Contract attachment',         'Supporting attachment to an employment contract',           false, false, true, false, false, 25, 'attachment', false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Document metadata
-- ---------------------------------------------------------------------
alter table public.hr_documents drop constraint if exists hr_documents_verification_status_check;
alter table public.hr_documents add constraint hr_documents_verification_status_check
  check (verification_status in ('pending','verified','rejected','expired','replaced'));

alter table public.hr_documents
  add column source                 text not null default 'upload' check (source in ('upload','generated','recruitment')),
  add column source_ref             text check (source_ref is null or length(source_ref) <= 80),
  add column template_id            uuid,
  add column includes_compensation  boolean not null default false,
  add column requires_acknowledgement boolean not null default false,
  add column issue_date             date,
  add column effective_date         date,
  add column renewal_date           date,
  add column contract_type          text check (contract_type is null or contract_type in ('permanent','fixed_term','probationary','internship','consultancy','other')),
  add column contract_status        text check (contract_status is null or contract_status in ('active','expiring','expired','renewed','terminated')),
  add column supersedes_document_id uuid references public.hr_documents(id) on delete restrict,
  add column parent_document_id     uuid references public.hr_documents(id) on delete restrict,
  add column verification_notes     text check (verification_notes is null or length(verification_notes) <= 1000),
  add column notes                  text check (notes is null or length(notes) <= 2000),
  add constraint hr_documents_no_self_link check (supersedes_document_id is distinct from id and parent_document_id is distinct from id);

create unique index hr_documents_source_ref on public.hr_documents(source, source_ref) where source_ref is not null and archived_at is null;
create index hr_documents_status_open on public.hr_documents(verification_status) where archived_at is null;
create index hr_documents_created on public.hr_documents(created_at desc);
create index hr_documents_renewal on public.hr_documents(renewal_date) where archived_at is null and renewal_date is not null;
create index hr_documents_template on public.hr_documents(employee_id, template_id) where template_id is not null;

-- Which generated letter text a stored file renders (null for uploads).
alter table public.hr_document_versions add column letter_content_id uuid;

-- Compensation: a category that holds compensation marks the document, and
-- only documents.compensation holders may add one for somebody else.
create or replace function hr_private.documents_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.hr_document_categories c where c.id = new.category_id and c.contains_compensation) then
    new.includes_compensation := true;
  end if;
  if new.includes_compensation and auth.uid() is not null
     and new.employee_id is distinct from hr_private.current_employee_id()
     and not hr_private.has_permission('documents.compensation') then
    perform hr_private.fail('Documents with compensation details can only be added by authorised HR users.', 'forbidden');
  end if;
  return new;
end $$;
create trigger hr_documents_before_insert before insert on public.hr_documents
  for each row execute function hr_private.documents_before_insert();

-- Read rule from 107 + the compensation restriction.
create or replace function hr_private.document_can_read(p_document uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (hr_private.document_can_view(d.employee_id, d.category_id, d.archived_at)
            or (d.archived_at is null
                and d.employee_id = hr_private.current_employee_id()
                and exists (select 1 from public.hr_document_versions v where v.document_id = d.id and v.uploaded_by = auth.uid())))
       and (not d.includes_compensation
            or (d.archived_at is null and d.employee_id = hr_private.current_employee_id())
            or hr_private.has_permission('documents.compensation'))
    from public.hr_documents d where d.id = p_document), false)
$$;

-- ---------------------------------------------------------------------
-- Verification history (every status change)
-- ---------------------------------------------------------------------
create table public.hr_document_reviews (
  id           bigint generated always as identity primary key,
  document_id  uuid not null references public.hr_documents(id) on delete restrict,
  version      int not null,
  from_status  text,
  to_status    text not null,
  notes        text,
  reason       text,
  actor_user_id uuid,
  created_at   timestamptz not null default now()
);
create index hr_document_reviews_doc on public.hr_document_reviews(document_id, created_at desc);

create or replace function hr_private.documents_review_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.verification_status is distinct from old.verification_status then
    insert into public.hr_document_reviews (document_id, version, from_status, to_status, notes, reason, actor_user_id)
    values (new.id, new.current_version, old.verification_status, new.verification_status,
            case when new.verification_status in ('verified','rejected') then new.verification_notes end,
            case when new.verification_status = 'rejected' then new.rejection_reason end,
            auth.uid());
  end if;
  return null;
end $$;
create trigger hr_documents_review_history after update of verification_status on public.hr_documents
  for each row execute function hr_private.documents_review_history();

-- ---------------------------------------------------------------------
-- Letter templates
-- ---------------------------------------------------------------------
create table public.hr_document_templates (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name                     text not null unique check (length(btrim(name)) between 2 and 120),
  template_type            text not null check (template_type in ('appointment_letter','employment_contract','experience_letter',
                             'employment_confirmation','internship_certificate','relieving_letter','other_letter')),
  category_code            text not null references public.hr_document_categories(code) on update cascade,
  title                    text not null check (length(btrim(title)) between 2 and 200),
  body                     text not null check (length(body) between 20 and 20000),
  requires_acknowledgement boolean not null default false,
  includes_compensation    boolean not null default false,          -- derived from the placeholders
  status                   text not null default 'draft' check (status in ('draft','approved','archived')),
  current_version          int not null default 1 check (current_version >= 1),
  approved_version         int,                                      -- latest approved snapshot (used for issuing)
  approved_by              uuid,
  approved_at              timestamptz,
  created_by               uuid default auth.uid(),
  updated_by               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger hr_document_templates_touch before update on public.hr_document_templates
  for each row execute function hr_private.touch_updated_at();

create table public.hr_document_template_versions (
  id                       uuid primary key default gen_random_uuid(),
  template_id              uuid not null references public.hr_document_templates(id) on delete restrict,
  version                  int not null,
  name                     text not null,
  title                    text not null,
  body                     text not null,
  requires_acknowledgement boolean not null,
  includes_compensation    boolean not null,
  approved_by              uuid,
  approved_at              timestamptz not null default now(),
  unique (template_id, version)
);
create trigger hr_document_template_versions_immutable before update or delete on public.hr_document_template_versions
  for each row execute function hr_private.doc_immutable();

alter table public.hr_documents
  add constraint hr_documents_template_fk foreign key (template_id) references public.hr_document_templates(id) on delete restrict;

-- Generated letter text (authoritative copy of what a stored PDF renders).
create table public.hr_document_letter_content (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.hr_documents(id) on delete restrict,
  seq              int not null check (seq >= 1),
  template_id      uuid references public.hr_document_templates(id) on delete restrict,
  template_version int,
  template_name    text not null,
  title            text not null,
  body             text not null,
  reference        text not null,
  merge_data       jsonb not null default '{}'::jsonb,
  generated_by     uuid,
  generated_at     timestamptz not null default now(),
  unique (document_id, seq)
);
create trigger hr_document_letter_content_immutable before update or delete on public.hr_document_letter_content
  for each row execute function hr_private.doc_immutable();
alter table public.hr_document_versions
  add constraint hr_document_versions_letter_fk foreign key (letter_content_id) references public.hr_document_letter_content(id) on delete restrict;
create unique index hr_document_versions_letter on public.hr_document_versions(letter_content_id) where letter_content_id is not null;

-- Allowed placeholders: (key, compensation?, may the issuer supply it?).
create or replace function hr_private.doc_placeholders()
returns table (key text, compensation boolean, overridable boolean) language sql immutable set search_path = '' as $$
  values ('employee_name', false, false), ('employee_first_name', false, false), ('employee_id', false, false),
         ('department', false, false), ('designation', false, false), ('joining_date', false, false),
         ('confirmation_date', false, false), ('employment_type', false, false), ('work_location', false, true),
         ('manager_name', false, false), ('last_working_date', false, false),
         ('internship_start_date', false, false), ('internship_end_date', false, false),
         ('contract_type', false, true), ('contract_start_date', false, true), ('contract_end_date', false, true),
         ('issue_date', false, true), ('effective_date', false, true), ('reference', false, false),
         ('signatory_name', false, true), ('signatory_title', false, true),
         ('company_name', false, false), ('company_legal_name', false, false),
         ('terms_and_conditions', false, true), ('additional_notes', false, true),
         ('annual_ctc', true, true), ('monthly_gross', true, true), ('currency', true, true)
$$;

-- Validate a template: only {{allowed_key}} placeholders, no other template
-- syntax. Returns whether it uses compensation placeholders.
create or replace function hr_private.doc_check_template(p_title text, p_body text)
returns boolean language plpgsql stable set search_path = '' as $$
declare v_text text := coalesce(p_title, '') || E'\n' || coalesce(p_body, ''); v_bad text;
begin
  if v_text ~ '\{%|%\}|\{#|#\}|\$\{|<\s*script' then
    perform hr_private.fail('Templates are plain text with {{placeholders}} only; logic or script syntax is not allowed.', 'invalid');
  end if;
  select string_agg(distinct btrim(m[1]), ', ') into v_bad
    from regexp_matches(v_text, '\{\{([^}]*)\}\}', 'g') m
   where not exists (select 1 from hr_private.doc_placeholders() p where p.key = btrim(m[1]));
  if v_bad is not null then
    perform hr_private.fail('Unknown placeholder(s) in the template: ' || v_bad || '.', 'invalid');
  end if;
  -- Unbalanced braces would leave raw markup in a letter.
  if (length(v_text) - length(replace(v_text, '{{', ''))) <> (length(v_text) - length(replace(v_text, '}}', ''))) then
    perform hr_private.fail('A placeholder is not closed: use {{name}}.', 'invalid');
  end if;
  return exists (select 1 from regexp_matches(v_text, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') m
                 join hr_private.doc_placeholders() p on p.key = m[1] and p.compensation);
end $$;

-- Replace placeholders. Values cannot inject placeholders ({{ is broken up).
-- Strict mode fails on any unfilled placeholder; preview mode marks it.
create or replace function hr_private.doc_render(p_text text, p_data jsonb, p_strict boolean)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := p_text; r record; v_missing text;
begin
  for r in select key, value from jsonb_each_text(p_data) where value is not null loop
    v := regexp_replace(v, '\{\{\s*' || r.key || '\s*\}\}',
                        replace(replace(replace(r.value, '{{', '{ {'), '}}', '} }'), '\', '\\'), 'g');
  end loop;
  select string_agg(distinct replace(m[1], '_', ' '), ', ') into v_missing
    from regexp_matches(v, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') m;
  if v_missing is not null then
    if p_strict then
      perform hr_private.fail('Fill in these details before issuing the letter: ' || v_missing || '.', 'letter_incomplete');
    end if;
    v := regexp_replace(v, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', '[missing: \1]', 'g');
  end if;
  return v;
end $$;

create or replace function hr_private.doc_missing(p_text text, p_data jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}')
  from regexp_matches(coalesce(p_text, ''), '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') m
  where not (p_data ? m[1]) or p_data ->> m[1] is null
$$;

-- Merge data for an employee (null = sample data for template previews).
-- Identity / employment values come from Employee Management and cannot be
-- overridden; the issuer may supply only the "overridable" keys. Compensation
-- keys need documents.compensation; auto-fill from payroll needs payroll.view.
create or replace function hr_private.doc_merge_data(p_employee uuid, p_values jsonb, p_reference text, p_uses_comp boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v      jsonb := coalesce(p_values, '{}'::jsonb);
  v_co   jsonb := coalesce(hr_private.setting('company'), '{}'::jsonb);
  e      public.hr_employees;
  v_data jsonb;
  v_over jsonb := '{}'::jsonb;
  r      record;
  v_txt  text;
  v_num  numeric;
  v_ctc  numeric;
  v_cur  text;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to generate letters.', 'forbidden');
  end if;
  if jsonb_typeof(v) <> 'object' then perform hr_private.fail('Letter values must be an object.', 'invalid'); end if;
  -- Unknown or non-overridable keys are refused (never silently ignored).
  select string_agg(k, ', ') into v_txt from jsonb_object_keys(v) k
   where k not in ('renews_document_id')
     and not exists (select 1 from hr_private.doc_placeholders() p where p.key = k and p.overridable);
  if v_txt is not null then perform hr_private.fail('These values cannot be set on a letter: ' || v_txt || '.', 'invalid'); end if;

  if (v ? 'annual_ctc' or v ? 'monthly_gross' or v ? 'currency') and not hr_private.has_permission('documents.compensation') then
    perform hr_private.fail('You are not allowed to add compensation details to letters.', 'forbidden');
  end if;

  for r in select p.key from hr_private.doc_placeholders() p where p.overridable loop
    if r.key in ('issue_date','effective_date','contract_start_date','contract_end_date') then
      v_over := v_over || jsonb_build_object(r.key, hr_private.doc_fmt_date(hr_private.doc_jdate(v, r.key)));
    elsif r.key in ('annual_ctc','monthly_gross') then
      v_txt := nullif(btrim(coalesce(v ->> r.key, '')), '');
      if v_txt is not null then
        if v_txt !~ '^\d{1,12}(\.\d{1,2})?$' then perform hr_private.fail(replace(r.key, '_', ' ') || ' must be a number.', 'invalid'); end if;
        v_num := v_txt::numeric;
        v_over := v_over || jsonb_build_object(r.key, btrim(to_char(v_num, 'FM999,999,999,990.00')));
      end if;
    elsif r.key = 'currency' then
      v_txt := upper(nullif(btrim(coalesce(v ->> 'currency', '')), ''));
      if v_txt is not null and v_txt !~ '^[A-Z]{3}$' then perform hr_private.fail('Currency must be a 3-letter code.', 'invalid'); end if;
      v_over := v_over || jsonb_build_object('currency', v_txt);
    elsif r.key = 'contract_type' then
      v_txt := hr_private.doc_jtext(v, 'contract_type', 40);
      if v_txt is not null and v_txt not in ('permanent','fixed_term','probationary','internship','consultancy','other') then
        perform hr_private.fail('Unknown contract type.', 'invalid');
      end if;
      v_over := v_over || jsonb_build_object('contract_type', replace(v_txt, '_', ' '));
    elsif r.key in ('terms_and_conditions','additional_notes') then
      v_over := v_over || jsonb_build_object(r.key, hr_private.doc_jtext(v, r.key, 6000));
    else
      v_over := v_over || jsonb_build_object(r.key, hr_private.doc_jtext(v, r.key, 200));
    end if;
  end loop;

  if p_employee is null then
    v_data := jsonb_build_object(
      'employee_name', 'Sample Employee', 'employee_first_name', 'Sample', 'employee_id', 'ZT-0000',
      'department', 'Engineering', 'designation', 'Software Engineer', 'joining_date', hr_private.doc_fmt_date(hr_private.business_today()),
      'confirmation_date', hr_private.doc_fmt_date(hr_private.business_today() + 180), 'employment_type', 'Full-time',
      'work_location', 'Head Office', 'manager_name', 'Sample Manager', 'last_working_date', hr_private.doc_fmt_date(hr_private.business_today() + 30),
      'internship_start_date', hr_private.doc_fmt_date(hr_private.business_today() - 90), 'internship_end_date', hr_private.doc_fmt_date(hr_private.business_today()),
      'annual_ctc', case when p_uses_comp then '0.00' end, 'monthly_gross', case when p_uses_comp then '0.00' end,
      'currency', case when p_uses_comp then coalesce(v_co ->> 'currency', 'INR') end);
  else
    select * into e from public.hr_employees where id = p_employee;
    v_data := jsonb_build_object(
      'employee_name', coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
      'employee_first_name', e.first_name,
      'employee_id', e.employee_code,
      'department', (select name from public.hr_departments where id = e.department_id),
      'designation', (select name from public.hr_designations where id = e.designation_id),
      'joining_date', hr_private.doc_fmt_date(e.joining_date),
      'confirmation_date', hr_private.doc_fmt_date(coalesce(e.confirmation_date, e.probation_end_date)),
      'employment_type', (select name from public.hr_employment_types where code = e.employment_type),
      'work_location', (select name from public.hr_locations where id = e.work_location_id),
      'manager_name', hr_private.doc_employee_name(e.manager_id),
      'last_working_date', hr_private.doc_fmt_date(e.last_working_date),
      'contract_type', replace(e.contract_type, '_', ' '),
      'contract_start_date', hr_private.doc_fmt_date(e.contract_start_date),
      'contract_end_date', hr_private.doc_fmt_date(e.contract_end_date),
      'internship_start_date', (select hr_private.doc_fmt_date(i.start_date) from public.hr_internships i where i.employee_id = e.id order by i.start_date desc limit 1),
      'internship_end_date', (select hr_private.doc_fmt_date(coalesce(i.completion_date, i.end_date)) from public.hr_internships i where i.employee_id = e.id order by i.start_date desc limit 1));
    if p_uses_comp and hr_private.has_permission('documents.compensation') and hr_private.has_permission('payroll.view') then
      select s.annual_ctc, s.currency into v_ctc, v_cur from public.hr_salary_structures s
       where s.employee_id = e.id and s.status = 'active' and s.effective_from <= hr_private.business_today()
         and (s.effective_to is null or s.effective_to >= hr_private.business_today())
       order by s.effective_from desc limit 1;
      if v_ctc is not null then
        v_data := v_data || jsonb_build_object('annual_ctc', btrim(to_char(v_ctc, 'FM999,999,999,990.00')),
                                               'monthly_gross', btrim(to_char(round(v_ctc / 12, 2), 'FM999,999,999,990.00')),
                                               'currency', v_cur);
      end if;
    end if;
  end if;

  v_data := v_data || jsonb_build_object(
    'issue_date', hr_private.doc_fmt_date(hr_private.business_today()),
    'reference', p_reference,
    'company_name', coalesce(v_co ->> 'name', 'Zyllo Tech'),
    'company_legal_name', coalesce(v_co ->> 'legal_name', v_co ->> 'name', 'Zyllo Tech'));
  -- Issuer-supplied values win for overridable keys only (nulls ignored).
  return jsonb_strip_nulls(v_data || jsonb_strip_nulls(v_over));
end $$;

-- ---------------------------------------------------------------------
-- Company policies + acknowledgements
-- ---------------------------------------------------------------------
create table public.hr_policies (
  id                       uuid primary key default gen_random_uuid(),
  title                    text not null check (length(btrim(title)) between 2 and 200),
  category                 text not null default 'general' check (category in ('general','code_of_conduct','hr','leave_attendance',
                             'it_security','health_safety','compliance','benefits','other')),
  status                   text not null default 'draft' check (status in ('draft','published','archived')),
  current_version          int not null default 0,         -- published version number (0 = never published)
  requires_acknowledgement boolean not null default true,
  employee_visible         boolean not null default true,
  audience_type            text not null default 'all' check (audience_type in ('all','departments','locations','employment_types','employees')),
  audience_ids             uuid[] not null default '{}',
  audience_codes           text[] not null default '{}',
  published_at             timestamptz,
  archived_at              timestamptz,
  created_by               uuid default auth.uid(),
  updated_by               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger hr_policies_touch before update on public.hr_policies for each row execute function hr_private.touch_updated_at();

create table public.hr_policy_versions (
  id                 uuid primary key default gen_random_uuid(),
  policy_id          uuid not null references public.hr_policies(id) on delete restrict,
  version            int not null check (version >= 1),
  status             text not null default 'draft' check (status in ('draft','published','superseded','archived')),
  content            text check (content is null or length(content) <= 100000),
  effective_date     date,
  change_summary     text check (change_summary is null or length(change_summary) <= 1000),
  storage_path       text unique,
  file_name          text,
  mime_type          text,
  size_bytes         bigint check (size_bytes is null or (size_bytes > 0 and size_bytes <= 10485760)),
  file_registered_by uuid,
  file_registered_at timestamptz,
  published_by       uuid,
  published_at       timestamptz,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  unique (policy_id, version)
);
create unique index hr_policy_versions_one_draft on public.hr_policy_versions(policy_id) where status = 'draft';
create unique index hr_policy_versions_one_published on public.hr_policy_versions(policy_id) where status = 'published';

-- Published history is immutable: only the status may move on
-- (published -> superseded / archived); drafts may be edited or discarded.
create or replace function hr_private.policy_versions_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then perform hr_private.fail('Published policy versions cannot be deleted.', 'immutable'); end if;
    return old;
  end if;
  if old.status <> 'draft' and (new.policy_id, new.version, new.content, new.effective_date, new.change_summary, new.storage_path,
                                new.file_name, new.mime_type, new.size_bytes, new.published_at, new.published_by)
       is distinct from (old.policy_id, old.version, old.content, old.effective_date, old.change_summary, old.storage_path,
                         old.file_name, old.mime_type, old.size_bytes, old.published_at, old.published_by) then
    perform hr_private.fail('A published policy version cannot be changed. Create a new version instead.', 'immutable');
  end if;
  if old.status <> 'draft' and new.status = 'draft' then
    perform hr_private.fail('A published policy version cannot return to draft.', 'immutable');
  end if;
  return new;
end $$;
create trigger hr_policy_versions_guard before update or delete on public.hr_policy_versions
  for each row execute function hr_private.policy_versions_guard();

create or replace function hr_private.policy_targets(p_policy uuid)
returns table (employee_id uuid) language sql stable security definer set search_path = '' as $$
  select e.id
  from public.hr_policies p
  join public.hr_employees e on e.status not in ('exited','archived','suspended')
  where p.id = p_policy
    and case p.audience_type
          when 'all'              then true
          when 'departments'      then e.department_id = any (p.audience_ids)
          when 'locations'        then e.work_location_id = any (p.audience_ids)
          when 'employment_types' then e.employment_type = any (p.audience_codes)
          when 'employees'        then e.id = any (p.audience_ids)
          else false end
    -- HR sees the whole audience; anyone else only learns about themselves.
    and (e.id = hr_private.current_employee_id()
         or hr_private.has_permission('documents.manage') or hr_private.has_permission('documents.view'))
$$;

create or replace function hr_private.policy_includes(p_policy uuid, p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_employee is not null and exists (select 1 from hr_private.policy_targets(p_policy) t where t.employee_id = p_employee)
$$;

-- HR (documents.manage / documents.view) sees every policy; an employee sees
-- a published, employee-visible policy addressed to them.
create or replace function hr_private.policy_can_read(p_policy uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('documents.manage') or hr_private.has_permission('documents.view')
      or exists (select 1 from public.hr_policies p
                 where p.id = p_policy and p.status = 'published' and p.employee_visible
                   and hr_private.policy_includes(p.id, hr_private.current_employee_id()))
$$;

create or replace function hr_private.policy_version_can_read(p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_policy_versions v
                 where v.id = p_version
                   and (hr_private.has_permission('documents.manage') or hr_private.has_permission('documents.view')
                        or (v.status = 'published' and hr_private.policy_can_read(v.policy_id))))
$$;

create table public.hr_document_acknowledgements (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.hr_employees(id) on delete restrict,
  subject_type      text not null check (subject_type in ('policy','document')),
  policy_id         uuid references public.hr_policies(id) on delete restrict,
  policy_version_id uuid references public.hr_policy_versions(id) on delete restrict,
  document_id       uuid references public.hr_documents(id) on delete restrict,
  version           int not null check (version >= 1),
  title             text not null,
  statement         text not null,
  acknowledged_at   timestamptz not null default now(),
  acknowledged_by   uuid not null,
  check ((subject_type = 'policy' and policy_version_id is not null and policy_id is not null and document_id is null)
      or (subject_type = 'document' and document_id is not null and policy_version_id is null and policy_id is null))
);
create unique index hr_document_ack_policy on public.hr_document_acknowledgements(employee_id, policy_version_id) where policy_version_id is not null;
create unique index hr_document_ack_document on public.hr_document_acknowledgements(employee_id, document_id, version) where document_id is not null;
create trigger hr_document_acknowledgements_immutable before update or delete on public.hr_document_acknowledgements
  for each row execute function hr_private.doc_immutable();

create table public.hr_acknowledgement_reminders (
  id                bigint generated always as identity primary key,
  employee_id       uuid not null references public.hr_employees(id) on delete restrict,
  policy_version_id uuid references public.hr_policy_versions(id) on delete restrict,
  document_id       uuid references public.hr_documents(id) on delete restrict,
  version           int not null,
  reminded_at       timestamptz not null default now(),
  reminded_by       uuid
);
create index hr_acknowledgement_reminders_lookup on public.hr_acknowledgement_reminders(employee_id, reminded_at desc);

-- ---------------------------------------------------------------------
-- Renewal requests + reminder engine ledger
-- ---------------------------------------------------------------------
create table public.hr_document_renewal_requests (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references public.hr_documents(id) on delete restrict,
  message               text check (message is null or length(message) <= 1000),
  due_date              date,
  status                text not null default 'open' check (status in ('open','fulfilled','cancelled')),
  requested_by          uuid default auth.uid(),
  requested_at          timestamptz not null default now(),
  fulfilled_at          timestamptz,
  fulfilled_version     int,
  fulfilled_document_id uuid references public.hr_documents(id) on delete restrict,
  cancelled_by          uuid,
  cancelled_at          timestamptz
);
create unique index hr_document_renewal_one_open on public.hr_document_renewal_requests(document_id) where status = 'open';

create table public.hr_document_reminder_runs (
  id              uuid primary key default gen_random_uuid(),
  trigger_source  text not null check (trigger_source in ('scheduler','manual')),
  as_of           date not null,
  triggered_by    uuid,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  expired_marked  int not null default 0,
  reminders       int not null default 0,
  notifications   int not null default 0,
  emails_queued   int not null default 0,
  status          text not null default 'running' check (status in ('running','completed'))
);

create table public.hr_document_reminder_log (
  id          bigint generated always as identity primary key,
  document_id uuid not null references public.hr_documents(id) on delete restrict,
  event       text not null check (event in ('expiry','renewal')),
  due_date    date not null,
  stage_days  int not null,
  run_id      uuid references public.hr_document_reminder_runs(id) on delete restrict,
  emailed     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (document_id, event, due_date, stage_days)
);

-- When a new version of a document is registered, an open renewal request is fulfilled.
create or replace function hr_private.document_version_fulfils_renewal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.version > 1 then
    update public.hr_document_renewal_requests
       set status = 'fulfilled', fulfilled_at = now(), fulfilled_version = new.version
     where document_id = new.document_id and status = 'open';
  end if;
  return null;
end $$;
create trigger hr_document_versions_fulfil_renewal after insert on public.hr_document_versions
  for each row execute function hr_private.document_version_fulfils_renewal();

-- ---------------------------------------------------------------------
-- Storage: policy PDFs share the private hr-documents bucket under
-- policies/<policy_id>/<version>-<token>-<file>. Additional policies only
-- (storage policies combine with OR); 107's policies are unchanged.
-- ---------------------------------------------------------------------
create or replace function hr_private.policy_object_can_upload(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and not hr_private.caller_is_revoked()
     and hr_private.has_permission('documents.manage')
     and exists (select 1 from public.hr_policy_versions v
                 where v.storage_path = p_name and v.status = 'draft'
                   and v.file_registered_by = auth.uid() and v.file_registered_at > now() - interval '24 hours')
     and not exists (select 1 from storage.objects o where o.bucket_id = 'hr-documents' and o.name = p_name)
$$;

create or replace function hr_private.policy_object_readable(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_policy_versions v where v.storage_path = p_name and hr_private.policy_version_can_read(v.id))
$$;

drop policy if exists "hr-documents: policy file upload" on storage.objects;
create policy "hr-documents: policy file upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-documents' and name like 'policies/%' and hr_private.policy_object_can_upload(name));

drop policy if exists "hr-documents: policy file read" on storage.objects;
create policy "hr-documents: policy file read"
  on storage.objects for select to authenticated
  using (bucket_id = 'hr-documents' and name like 'policies/%' and hr_private.policy_object_readable(name));

-- When a document file lands: an issued letter becomes verified and the
-- employee is told; an employee's own upload notifies HR for verification.
create or replace function hr_private.document_object_uploaded()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.hr_document_versions; d public.hr_documents; c public.hr_document_categories;
begin
  select * into v from public.hr_document_versions where storage_path = new.name;
  if v.id is null then return null; end if;
  select * into d from public.hr_documents where id = v.document_id;
  select * into c from public.hr_document_categories where id = d.category_id;
  if v.letter_content_id is not null then
    if v.version = d.current_version and d.verification_status = 'pending' then
      update public.hr_documents
         set verification_status = 'verified', verified_by = v.uploaded_by, verified_at = now(), rejection_reason = null,
             verification_notes = case d.source when 'recruitment' then 'Filed from Recruitment (accepted offer)' else 'Issued by HR from an approved template' end
       where id = d.id;
    end if;
    if c.employee_can_view and not c.is_confidential then
      perform hr_private.notify_employee(d.employee_id, 'document_issued', 'New document: ' || d.title,
        case when d.requires_acknowledgement then 'Please read it and acknowledge receipt in My Documents.' else 'It is available in My Documents.' end,
        '/employee/documents', 'hr_document', d.id::text);
    end if;
  elsif v.uploaded_by is not distinct from hr_private.employee_user_id(d.employee_id) then
    perform hr_private.notify_permission_holders('documents.manage', 'document_uploaded', 'Document uploaded for verification',
      coalesce(hr_private.doc_employee_name(d.employee_id), 'An employee') || ' · ' || d.title || ' (v' || v.version || ')',
      '/hr/documents?tab=verification', 'hr_document', d.id::text, d.employee_id);
  end if;
  return null;
end $$;
drop trigger if exists hr_documents_object_uploaded on storage.objects;
create trigger hr_documents_object_uploaded after insert on storage.objects
  for each row when (new.bucket_id = 'hr-documents') execute function hr_private.document_object_uploaded();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_document_reviews');
select hr_private.secure_table('public.hr_document_templates');
select hr_private.secure_table('public.hr_document_template_versions');
select hr_private.secure_table('public.hr_document_letter_content');
select hr_private.secure_table('public.hr_policies');
select hr_private.secure_table('public.hr_policy_versions');
select hr_private.secure_table('public.hr_document_acknowledgements');
select hr_private.secure_table('public.hr_acknowledgement_reminders');
select hr_private.secure_table('public.hr_document_renewal_requests');
select hr_private.secure_table('public.hr_document_reminder_runs');
select hr_private.secure_table('public.hr_document_reminder_log');

create policy hr_document_reviews_read on public.hr_document_reviews for select to authenticated
  using (hr_private.document_can_read(document_id));
create policy hr_document_templates_read on public.hr_document_templates for select to authenticated
  using (hr_private.has_permission('documents.manage'));
create policy hr_document_template_versions_read on public.hr_document_template_versions for select to authenticated
  using (hr_private.has_permission('documents.manage'));
create policy hr_document_letter_content_read on public.hr_document_letter_content for select to authenticated
  using (hr_private.document_can_read(document_id));
create policy hr_policies_read on public.hr_policies for select to authenticated
  using (hr_private.policy_can_read(id));
create policy hr_policy_versions_read on public.hr_policy_versions for select to authenticated
  using (hr_private.policy_version_can_read(id));
create policy hr_document_acknowledgements_read on public.hr_document_acknowledgements for select to authenticated
  using (employee_id = hr_private.current_employee_id()
         or hr_private.has_permission('documents.manage') or hr_private.has_permission('documents.view'));
create policy hr_acknowledgement_reminders_read on public.hr_acknowledgement_reminders for select to authenticated
  using (hr_private.has_permission('documents.manage') or hr_private.has_permission('documents.view'));
create policy hr_document_renewal_requests_read on public.hr_document_renewal_requests for select to authenticated
  using (hr_private.document_can_read(document_id));
create policy hr_document_reminder_runs_read on public.hr_document_reminder_runs for select to authenticated
  using (hr_private.has_permission('documents.manage'));
create policy hr_document_reminder_log_read on public.hr_document_reminder_log for select to authenticated
  using (hr_private.has_permission('documents.manage'));
-- Every table above is written only through the SECURITY DEFINER RPCs below.
revoke insert, update, delete on public.hr_document_reviews, public.hr_document_templates, public.hr_document_template_versions,
  public.hr_document_letter_content, public.hr_policies, public.hr_policy_versions, public.hr_document_acknowledgements,
  public.hr_acknowledgement_reminders, public.hr_document_renewal_requests, public.hr_document_reminder_runs,
  public.hr_document_reminder_log from authenticated;

select hr_private.enable_audit('public.hr_document_templates');
select hr_private.enable_audit('public.hr_policies');
select hr_private.enable_audit('public.hr_policy_versions');
select hr_private.enable_audit('public.hr_document_acknowledgements');
select hr_private.enable_audit('public.hr_document_renewal_requests');

-- ---------------------------------------------------------------------
-- Default templates (approved, version 1)
-- ---------------------------------------------------------------------
insert into public.hr_document_templates (code, name, template_type, category_code, title, body, requires_acknowledgement, includes_compensation, status, current_version, approved_version, approved_at)
values
('appointment_letter', 'Appointment letter', 'appointment_letter', 'appointment_letter', 'Appointment letter — {{employee_name}}',
$tpl$Ref: {{reference}}
Date: {{issue_date}}

Dear {{employee_name}},

Further to your acceptance of our offer, we are pleased to appoint you as {{designation}} in the {{department}} department of {{company_legal_name}} with effect from {{joining_date}}.

Employee ID: {{employee_id}}
Employment type: {{employment_type}}
Work location: {{work_location}}
Reporting to: {{manager_name}}

Terms and conditions:
{{terms_and_conditions}}

Your compensation details are shared with you separately in your compensation letter.

Please read this letter and acknowledge its receipt in the Employee Portal.

For {{company_legal_name}}

{{signatory_name}}
{{signatory_title}}$tpl$, true, false, 'approved', 1, 1, now()),
('appointment_letter_with_ctc', 'Appointment letter (with compensation)', 'appointment_letter', 'appointment_letter', 'Appointment letter — {{employee_name}}',
$tpl$Ref: {{reference}}
Date: {{issue_date}}

Dear {{employee_name}},

We are pleased to appoint you as {{designation}} in the {{department}} department of {{company_legal_name}} with effect from {{joining_date}}.

Employee ID: {{employee_id}}
Employment type: {{employment_type}}
Work location: {{work_location}}
Annual compensation (CTC): {{currency}} {{annual_ctc}}
Monthly gross: {{currency}} {{monthly_gross}}

Terms and conditions:
{{terms_and_conditions}}

Please read this letter and acknowledge its receipt in the Employee Portal. Compensation details are confidential.

For {{company_legal_name}}

{{signatory_name}}
{{signatory_title}}$tpl$, true, true, 'approved', 1, 1, now()),
('employment_contract', 'Employment contract', 'employment_contract', 'employment_agreement', 'Employment contract — {{employee_name}}',
$tpl$Ref: {{reference}}
Date: {{issue_date}}

EMPLOYMENT CONTRACT

This contract is made between {{company_legal_name}} ("the Company") and {{employee_name}} (Employee ID {{employee_id}}).

Position: {{designation}}, {{department}}
Contract type: {{contract_type}}
Effective from: {{contract_start_date}}
Valid until: {{contract_end_date}}
Work location: {{work_location}}

Terms and conditions:
{{terms_and_conditions}}

This document records the agreed terms. Any signatures are captured outside this system.

For {{company_legal_name}}

{{signatory_name}}
{{signatory_title}}$tpl$, true, false, 'approved', 1, 1, now()),
('experience_letter', 'Experience letter', 'experience_letter', 'experience_letter', 'Experience letter — {{employee_name}}',
$tpl$Ref: {{reference}}
Date: {{issue_date}}

TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee_name}} (Employee ID {{employee_id}}) was employed with {{company_legal_name}} as {{designation}} in the {{department}} department from {{joining_date}} to {{last_working_date}}.

{{additional_notes}}

We wish them every success in their future endeavours.

For {{company_legal_name}}

{{signatory_name}}
{{signatory_title}}$tpl$, false, false, 'approved', 1, 1, now()),
('employment_confirmation', 'Employment confirmation letter', 'employment_confirmation', 'employment_confirmation', 'Confirmation of employment — {{employee_name}}',
$tpl$Ref: {{reference}}
Date: {{issue_date}}

Dear {{employee_name}},

We are pleased to confirm your employment as {{designation}} in the {{department}} department with effect from {{effective_date}}, on successful completion of your probation period.

Employee ID: {{employee_id}}
Date of joining: {{joining_date}}

All other terms of your appointment remain unchanged.

For {{company_legal_name}}

{{signatory_name}}
{{signatory_title}}$tpl$, true, false, 'approved', 1, 1, now()),
('internship_certificate', 'Internship certificate', 'internship_certificate', 'internship_certificate', 'Internship certificate — {{employee_name}}',
$tpl$Ref: {{reference}}
Date: {{issue_date}}

CERTIFICATE OF INTERNSHIP

This is to certify that {{employee_name}} completed an internship with {{company_legal_name}} in the {{department}} department from {{internship_start_date}} to {{internship_end_date}}.

{{additional_notes}}

For {{company_legal_name}}

{{signatory_name}}
{{signatory_title}}$tpl$, false, false, 'approved', 1, 1, now()),
('relieving_letter', 'Relieving letter', 'relieving_letter', 'relieving_letter', 'Relieving letter — {{employee_name}}',
$tpl$Ref: {{reference}}
Date: {{issue_date}}

Dear {{employee_name}},

This is to confirm that you have been relieved from your duties as {{designation}} in the {{department}} department of {{company_legal_name}} at the close of business on {{last_working_date}}, after completing the exit formalities.

Employee ID: {{employee_id}}
Date of joining: {{joining_date}}

We thank you for your contributions and wish you success.

For {{company_legal_name}}

{{signatory_name}}
{{signatory_title}}$tpl$, false, false, 'approved', 1, 1, now())
on conflict (code) do nothing;

insert into public.hr_document_template_versions (template_id, version, name, title, body, requires_acknowledgement, includes_compensation, approved_at)
select t.id, 1, t.name, t.title, t.body, t.requires_acknowledgement, t.includes_compensation, now()
from public.hr_document_templates t
where not exists (select 1 from public.hr_document_template_versions v where v.template_id = t.id);

-- ---------------------------------------------------------------------
-- RPCs: settings
-- ---------------------------------------------------------------------
create or replace function public.hr_document_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (hr_private.has_permission('documents.manage') or hr_private.has_permission('settings.view')) then
    perform hr_private.fail('You are not allowed to view document settings.', 'forbidden');
  end if;
  return hr_private.doc_settings();
end $$;

create or replace function public.hr_save_document_settings(p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := coalesce(p_values, '{}'::jsonb); v_new jsonb := hr_private.doc_settings(); k text; a int[];
begin
  if not (hr_private.has_permission('documents.manage') or hr_private.has_permission('settings.manage')) then
    perform hr_private.fail('You are not allowed to change document settings.', 'forbidden');
  end if;
  foreach k in array array['expiry_reminder_days','renewal_reminder_days'] loop
    if v ? k then
      if jsonb_typeof(v -> k) <> 'array' then perform hr_private.fail('Reminder days must be a list.', 'invalid'); end if;
      if exists (select 1 from jsonb_array_elements_text(v -> k) x where x !~ '^\d{1,3}$' or x::int > 365) then
        perform hr_private.fail('Reminder days must be whole numbers between 0 and 365.', 'invalid');
      end if;
      a := hr_private.doc_int_array(v -> k);
      if cardinality(a) not between 1 and 8 then perform hr_private.fail('Give between 1 and 8 reminder days.', 'invalid'); end if;
      v_new := v_new || jsonb_build_object(k, to_jsonb(a));
    end if;
  end loop;
  if v ? 'expiring_soon_days' then
    if (v ->> 'expiring_soon_days') !~ '^\d{1,3}$' or (v ->> 'expiring_soon_days')::int not between 1 and 365 then
      perform hr_private.fail('"Expiring soon" must be between 1 and 365 days.', 'invalid');
    end if;
    v_new := v_new || jsonb_build_object('expiring_soon_days', (v ->> 'expiring_soon_days')::int);
  end if;
  if v ? 'acknowledgement_reminder_hours' then
    if (v ->> 'acknowledgement_reminder_hours') !~ '^\d{1,4}$' or (v ->> 'acknowledgement_reminder_hours')::int not between 1 and 720 then
      perform hr_private.fail('The acknowledgement reminder gap must be between 1 and 720 hours.', 'invalid');
    end if;
    v_new := v_new || jsonb_build_object('acknowledgement_reminder_hours', (v ->> 'acknowledgement_reminder_hours')::int);
  end if;
  foreach k in array array['notify_employee','notify_hr','notify_manager','email_reminders'] loop
    if v ? k then
      if jsonb_typeof(v -> k) <> 'boolean' then perform hr_private.fail(replace(k, '_', ' ') || ' must be true or false.', 'invalid'); end if;
      v_new := v_new || jsonb_build_object(k, v -> k);
    end if;
  end loop;
  insert into public.hr_settings (key, value, description, updated_by)
  values ('documents', v_new, 'Employee documents: reminder schedule, recipients, email opt-in', auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = auth.uid();
  return v_new;
end $$;

-- Per-category reminder schedule override (null = use the default).
create or replace function public.hr_set_category_reminder_days(p_category uuid, p_days int[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (hr_private.has_permission('documents.manage') or hr_private.has_permission('settings.manage')) then
    perform hr_private.fail('You are not allowed to change document categories.', 'forbidden');
  end if;
  if p_days is not null and (cardinality(p_days) not between 1 and 8 or exists (select 1 from unnest(p_days) d where d is null or d < 0 or d > 365)) then
    perform hr_private.fail('Give between 1 and 8 reminder days between 0 and 365.', 'invalid');
  end if;
  update public.hr_document_categories
     set reminder_days = case when p_days is null then null else (select array_agg(distinct d order by d desc)::smallint[] from unnest(p_days) d) end
   where id = p_category;
  if not found then perform hr_private.fail('Category not found.', 'not_found'); end if;
end $$;

-- ---------------------------------------------------------------------
-- RPCs: document details, review, renewal, attachments
-- ---------------------------------------------------------------------
-- HR edits metadata that does not change the stored file. Keys:
-- issue_date, effective_date, renewal_date, contract_type, contract_status,
-- requires_acknowledgement, notes, includes_compensation.
create or replace function hr_private.doc_apply_details(p_document uuid, p_values jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v jsonb := coalesce(p_values, '{}'::jsonb); d public.hr_documents; v_txt text; v_bad text;
begin
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(v) k
   where k not in ('issue_date','effective_date','renewal_date','contract_type','contract_status','requires_acknowledgement','notes','includes_compensation');
  if v_bad is not null then perform hr_private.fail('Unknown document field(s): ' || v_bad || '.', 'invalid'); end if;
  select * into d from public.hr_documents where id = p_document for update;
  -- HR may edit any readable document; an employee may only date their own
  -- just-registered upload (hr_register_document_upload_ex).
  if d.id is null or not hr_private.document_can_read(d.id) then perform hr_private.fail('Document not found.', 'not_found'); end if;
  if not hr_private.has_permission('documents.manage')
     and not (d.employee_id = hr_private.current_employee_id() and d.uploaded_by = auth.uid() and d.current_version = 1
              and not exists (select 1 from jsonb_object_keys(v) k where k <> 'issue_date')) then
    perform hr_private.fail('You are not allowed to edit document details.', 'forbidden');
  end if;
  if v ? 'issue_date' then d.issue_date := hr_private.doc_jdate(v, 'issue_date'); end if;
  if v ? 'effective_date' then d.effective_date := hr_private.doc_jdate(v, 'effective_date'); end if;
  if v ? 'renewal_date' then d.renewal_date := hr_private.doc_jdate(v, 'renewal_date'); end if;
  if v ? 'contract_type' then
    v_txt := hr_private.doc_jtext(v, 'contract_type', 40);
    if v_txt is not null and v_txt not in ('permanent','fixed_term','probationary','internship','consultancy','other') then
      perform hr_private.fail('Unknown contract type.', 'invalid');
    end if;
    d.contract_type := v_txt;
  end if;
  if v ? 'contract_status' then
    v_txt := hr_private.doc_jtext(v, 'contract_status', 40);
    if v_txt is not null and v_txt not in ('active','expiring','expired','terminated') then
      perform hr_private.fail('Contract status must be active, expiring, expired or terminated (renewal sets "renewed").', 'invalid');
    end if;
    d.contract_status := v_txt;
  end if;
  if v ? 'requires_acknowledgement' then
    if jsonb_typeof(v -> 'requires_acknowledgement') <> 'boolean' then perform hr_private.fail('requires acknowledgement must be true or false.', 'invalid'); end if;
    d.requires_acknowledgement := (v ->> 'requires_acknowledgement')::boolean;
  end if;
  if v ? 'notes' then d.notes := hr_private.doc_jtext(v, 'notes', 2000); end if;
  if v ? 'includes_compensation' then
    if jsonb_typeof(v -> 'includes_compensation') <> 'boolean' then perform hr_private.fail('includes compensation must be true or false.', 'invalid'); end if;
    if (v ->> 'includes_compensation')::boolean is distinct from d.includes_compensation and not hr_private.has_permission('documents.compensation') then
      perform hr_private.fail('Only authorised HR users can change the compensation flag.', 'forbidden');
    end if;
    if not (v ->> 'includes_compensation')::boolean
       and exists (select 1 from public.hr_document_categories c where c.id = d.category_id and c.contains_compensation) then
      perform hr_private.fail('Documents of this category always contain compensation details.', 'invalid');
    end if;
    d.includes_compensation := (v ->> 'includes_compensation')::boolean;
  end if;
  if d.effective_date is not null and d.expiry_date is not null and d.expiry_date < d.effective_date then
    perform hr_private.fail('The expiry date is before the effective date.', 'invalid');
  end if;
  if d.renewal_date is not null and d.expiry_date is not null and d.renewal_date > d.expiry_date then
    perform hr_private.fail('The renewal date must be on or before the expiry date.', 'invalid');
  end if;
  if d.contract_type is not null and d.contract_status is null then d.contract_status := 'active'; end if;
  update public.hr_documents
     set issue_date = d.issue_date, effective_date = d.effective_date, renewal_date = d.renewal_date,
         contract_type = d.contract_type, contract_status = d.contract_status,
         requires_acknowledgement = d.requires_acknowledgement, notes = d.notes, includes_compensation = d.includes_compensation
   where id = d.id;
end $$;

create or replace function public.hr_set_document_details(p_document uuid, p_values jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.hr_documents;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to edit documents.', 'forbidden');
  end if;
  select * into d from public.hr_documents where id = p_document;
  if d.id is null or not hr_private.document_can_read(d.id) then perform hr_private.fail('Document not found.', 'not_found'); end if;
  if d.archived_at is not null then perform hr_private.fail('This document is archived.', 'invalid_state'); end if;
  perform hr_private.doc_apply_details(d.id, p_values);
end $$;

-- One-call upload registration with metadata (wraps 107's registration so
-- every validation rule stays in one place). Employees may only add an
-- issue date to their own upload.
create or replace function public.hr_register_document_upload_ex(
  p_employee uuid, p_category text, p_title text, p_file_name text, p_mime_type text, p_size_bytes bigint,
  p_expiry_date date default null, p_details jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb; v jsonb := coalesce(p_details, '{}'::jsonb);
begin
  if jsonb_typeof(v) <> 'object' then perform hr_private.fail('Document details must be an object.', 'invalid'); end if;
  if not hr_private.has_permission('documents.manage') and exists (select 1 from jsonb_object_keys(v) k where k <> 'issue_date') then
    perform hr_private.fail('Only HR can set these document details.', 'forbidden');
  end if;
  r := public.hr_register_document_upload(p_employee, p_category, p_title, p_file_name, p_mime_type, p_size_bytes, p_expiry_date);
  if v <> '{}'::jsonb then perform hr_private.doc_apply_details((r ->> 'document_id')::uuid, v); end if;
  return r;
end $$;

-- Verify / reject with review notes (history is written by the trigger).
create or replace function public.hr_review_document(p_document uuid, p_approve boolean, p_reason text default null, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to verify documents.', 'forbidden');
  end if;
  if not hr_private.document_can_read(p_document) then perform hr_private.fail('Document not found.', 'not_found'); end if;
  if p_notes is not null and length(p_notes) > 1000 then perform hr_private.fail('Notes are too long (1000 characters maximum).', 'invalid'); end if;
  update public.hr_documents set verification_notes = nullif(btrim(coalesce(p_notes, '')), '') where id = p_document;
  perform public.hr_verify_document(p_document, p_approve, p_reason);
end $$;

create or replace function public.hr_request_document_renewal(p_document uuid, p_message text default null, p_due_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.hr_documents; c public.hr_document_categories; v_id uuid;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to request renewals.', 'forbidden');
  end if;
  select * into d from public.hr_documents where id = p_document for update;
  if d.id is null or not hr_private.document_can_read(d.id) then perform hr_private.fail('Document not found.', 'not_found'); end if;
  if d.archived_at is not null or d.verification_status = 'replaced' then perform hr_private.fail('This document is no longer current.', 'invalid_state'); end if;
  if p_message is not null and length(p_message) > 1000 then perform hr_private.fail('The message is too long (1000 characters maximum).', 'invalid'); end if;
  if p_due_date is not null and p_due_date < hr_private.business_today() then perform hr_private.fail('The due date is in the past.', 'invalid'); end if;
  if exists (select 1 from public.hr_document_renewal_requests where document_id = d.id and status = 'open') then
    perform hr_private.fail('A renewal request is already open for this document.', 'duplicate');
  end if;
  insert into public.hr_document_renewal_requests (document_id, message, due_date)
  values (d.id, nullif(btrim(coalesce(p_message, '')), ''), p_due_date) returning id into v_id;
  select * into c from public.hr_document_categories where id = d.category_id;
  if c.employee_can_upload and c.employee_can_view and not c.is_confidential then
    perform hr_private.notify_employee(d.employee_id, 'document_renewal_request', 'Please upload a renewed copy: ' || d.title,
      coalesce(nullif(btrim(coalesce(p_message, '')), ''), 'HR asked for a renewed copy of this document.')
        || case when p_due_date is not null then ' Due by ' || hr_private.doc_fmt_date(p_due_date) || '.' else '' end,
      '/employee/documents?tab=expiring', 'hr_document', d.id::text);
  end if;
  return v_id;
end $$;

create or replace function public.hr_cancel_document_renewal(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to cancel renewal requests.', 'forbidden');
  end if;
  update public.hr_document_renewal_requests set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_request and status = 'open';
  if not found then perform hr_private.fail('Open renewal request not found.', 'not_found'); end if;
end $$;

-- Mark p_old as replaced by p_new (contract renewals). The old record and
-- all its versions stay untouched apart from its status.
create or replace function hr_private.doc_supersede(p_old uuid, p_new uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('documents.manage')
     or not hr_private.document_can_read(p_old) or not hr_private.document_can_read(p_new) then
    perform hr_private.fail('You are not allowed to renew documents.', 'forbidden');
  end if;
  update public.hr_documents set supersedes_document_id = p_old where id = p_new;
  update public.hr_documents
     set verification_status = 'replaced',
         contract_status = case when contract_status is not null or contract_type is not null then 'renewed' else contract_status end
   where id = p_old;
  update public.hr_document_renewal_requests
     set status = 'fulfilled', fulfilled_at = now(), fulfilled_document_id = p_new
   where document_id = p_old and status = 'open';
end $$;

-- Renew a contract by uploading the renewed (signed) contract as a NEW
-- record that supersedes the old one.
create or replace function public.hr_renew_contract(
  p_document uuid, p_file_name text, p_mime_type text, p_size_bytes bigint, p_expiry_date date default null,
  p_details jsonb default '{}'::jsonb, p_title text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.hr_documents; c public.hr_document_categories; r jsonb; v_new uuid;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to renew contracts.', 'forbidden');
  end if;
  select * into d from public.hr_documents where id = p_document for update;
  if d.id is null or not hr_private.document_can_read(d.id) then perform hr_private.fail('Document not found.', 'not_found'); end if;
  select * into c from public.hr_document_categories where id = d.category_id;
  if c.doc_group <> 'contract' then perform hr_private.fail('Only contracts can be renewed this way. Upload a new version instead.', 'invalid'); end if;
  if d.archived_at is not null or d.verification_status = 'replaced' then
    perform hr_private.fail('This contract has already been renewed or archived.', 'invalid_state');
  end if;
  r := public.hr_register_document_upload(d.employee_id, c.code, coalesce(nullif(btrim(p_title), ''), d.title),
                                          p_file_name, p_mime_type, p_size_bytes, p_expiry_date);
  v_new := (r ->> 'document_id')::uuid;
  update public.hr_documents set contract_type = coalesce(d.contract_type, 'fixed_term'), contract_status = 'active',
         includes_compensation = d.includes_compensation or includes_compensation, requires_acknowledgement = d.requires_acknowledgement
   where id = v_new;
  if coalesce(p_details, '{}'::jsonb) <> '{}'::jsonb then perform hr_private.doc_apply_details(v_new, p_details); end if;
  perform hr_private.doc_supersede(d.id, v_new);
  return r;
end $$;

-- Supporting attachment for a contract (or any HR document).
create or replace function public.hr_register_document_attachment(
  p_parent uuid, p_title text, p_file_name text, p_mime_type text, p_size_bytes bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.hr_documents; r jsonb;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to add attachments.', 'forbidden');
  end if;
  select * into d from public.hr_documents where id = p_parent;
  if d.id is null or not hr_private.document_can_read(d.id) then perform hr_private.fail('Document not found.', 'not_found'); end if;
  if d.archived_at is not null then perform hr_private.fail('This document is archived.', 'invalid_state'); end if;
  if d.parent_document_id is not null then perform hr_private.fail('Attachments cannot have attachments of their own.', 'invalid'); end if;
  r := public.hr_register_document_upload(d.employee_id, 'contract_attachment',
         coalesce(nullif(btrim(p_title), ''), 'Attachment — ' || left(d.title, 180)), p_file_name, p_mime_type, p_size_bytes, null);
  update public.hr_documents set parent_document_id = d.id, includes_compensation = d.includes_compensation
   where id = (r ->> 'document_id')::uuid;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- RPCs: templates and letters
-- ---------------------------------------------------------------------
-- Create or edit a template. Editing an approved template opens a new draft
-- revision; the last approved snapshot stays in use until it is approved.
-- Keys: code (new only), name, template_type, category_code, title, body, requires_acknowledgement.
create or replace function public.hr_save_document_template(p_template uuid, p_values jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v jsonb := coalesce(p_values, '{}'::jsonb); t public.hr_document_templates; v_id uuid; v_comp boolean;
        v_name text; v_title text; v_body text; v_type text; v_cat text; v_ack boolean; v_code text;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to manage document templates.', 'forbidden');
  end if;
  if p_template is not null then
    select * into t from public.hr_document_templates where id = p_template for update;
    if t.id is null then perform hr_private.fail('Template not found.', 'not_found'); end if;
    if t.status = 'archived' then perform hr_private.fail('An archived template cannot be edited.', 'invalid_state'); end if;
  end if;
  v_name  := coalesce(hr_private.doc_jtext(v, 'name', 120), t.name);
  v_title := coalesce(hr_private.doc_jtext(v, 'title', 200), t.title);
  v_body  := coalesce(nullif(v ->> 'body', ''), t.body);
  v_type  := coalesce(hr_private.doc_jtext(v, 'template_type', 40), t.template_type);
  v_cat   := coalesce(hr_private.doc_jtext(v, 'category_code', 40), t.category_code);
  v_ack   := coalesce((v ->> 'requires_acknowledgement')::boolean, t.requires_acknowledgement, false);
  if v_name is null or length(v_name) < 2 then perform hr_private.fail('Give the template a name.', 'invalid'); end if;
  if v_title is null or length(v_title) < 2 then perform hr_private.fail('Give the document title pattern.', 'invalid'); end if;
  if v_body is null or length(v_body) < 20 then perform hr_private.fail('The template text is too short.', 'invalid'); end if;
  if length(v_body) > 20000 then perform hr_private.fail('The template text is too long (20000 characters maximum).', 'invalid'); end if;
  if v_type not in ('appointment_letter','employment_contract','experience_letter','employment_confirmation','internship_certificate','relieving_letter','other_letter') then
    perform hr_private.fail('Unknown template type.', 'invalid');
  end if;
  if not exists (select 1 from public.hr_document_categories c where c.code = v_cat and c.active and not c.is_confidential) then
    perform hr_private.fail('Choose an active, non-confidential document category for issued letters.', 'invalid');
  end if;
  if exists (select 1 from public.hr_document_categories c where c.code = v_cat and c.doc_group = 'offer_letter') then
    perform hr_private.fail('Offer letter templates are managed in Recruitment.', 'invalid');
  end if;
  v_comp := hr_private.doc_check_template(v_title, v_body);
  if v_comp and not hr_private.has_permission('documents.compensation') then
    perform hr_private.fail('Only authorised HR users can create templates with compensation placeholders.', 'forbidden');
  end if;
  if p_template is null then
    v_code := coalesce(hr_private.doc_jtext(v, 'code', 41),
                       't_' || left(regexp_replace(lower(regexp_replace(v_name, '[^A-Za-z0-9]+', '_', 'g')), '^_+|_+$', '', 'g'), 28)
                         || '_' || substr(md5(gen_random_uuid()::text), 1, 6));
    if v_code !~ '^[a-z][a-z0-9_]{1,40}$' then perform hr_private.fail('The template code must use lower-case letters, digits and underscores.', 'invalid'); end if;
    insert into public.hr_document_templates (code, name, template_type, category_code, title, body, requires_acknowledgement, includes_compensation, status, updated_by)
    values (v_code, v_name, v_type, v_cat, v_title, v_body, v_ack, v_comp, 'draft', auth.uid()) returning id into v_id;
  else
    update public.hr_document_templates
       set name = v_name, template_type = v_type, category_code = v_cat, title = v_title, body = v_body,
           requires_acknowledgement = v_ack, includes_compensation = v_comp, updated_by = auth.uid(),
           current_version = case when status = 'approved' then current_version + 1 else current_version end,
           status = 'draft'
     where id = t.id;
    v_id := t.id;
  end if;
  return v_id;
end $$;

-- Approve (HR administrators: settings.manage) or archive a template.
create or replace function public.hr_set_document_template_status(p_template uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.hr_document_templates;
begin
  select * into t from public.hr_document_templates where id = p_template for update;
  if t.id is null or not hr_private.has_permission('documents.manage') then perform hr_private.fail('Template not found.', 'not_found'); end if;
  if p_status = 'approved' then
    if not hr_private.has_permission('settings.manage') then
      perform hr_private.fail('Only HR administrators can approve templates.', 'forbidden');
    end if;
    if t.status <> 'draft' then perform hr_private.fail('Only a draft can be approved.', 'invalid_state'); end if;
    if t.includes_compensation and not hr_private.has_permission('documents.compensation') then
      perform hr_private.fail('Only authorised HR users can approve templates with compensation placeholders.', 'forbidden');
    end if;
    perform hr_private.doc_check_template(t.title, t.body);
    insert into public.hr_document_template_versions (template_id, version, name, title, body, requires_acknowledgement, includes_compensation, approved_by)
    values (t.id, t.current_version, t.name, t.title, t.body, t.requires_acknowledgement, t.includes_compensation, auth.uid())
    on conflict (template_id, version) do nothing;
    update public.hr_document_templates set status = 'approved', approved_version = t.current_version, approved_by = auth.uid(), approved_at = now()
     where id = t.id;
  elsif p_status = 'archived' then
    update public.hr_document_templates set status = 'archived' where id = t.id;
  else
    perform hr_private.fail('Unknown template status.', 'invalid');
  end if;
end $$;

-- Reference shown on letters: <TEMPLATE CODE>/<EMPLOYEE CODE>/<seq> (stable
-- between preview and issue, so the preview is exactly what is issued).
create or replace function hr_private.doc_letter_reference(p_template public.hr_document_templates, p_employee uuid, p_seq int)
returns text language sql stable security definer set search_path = '' as $$
  select upper(left(regexp_replace(p_template.code, '_', '', 'g'), 8)) || '/' ||
         coalesce((select employee_code from public.hr_employees where id = p_employee and hr_private.has_permission('documents.manage')), 'SAMPLE') || '/' || p_seq
$$;

-- The current (non-replaced, non-archived) generated letter of this template for an employee.
create or replace function hr_private.doc_current_letter(p_template uuid, p_employee uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select d.id from public.hr_documents d
  where d.employee_id = p_employee and d.template_id = p_template and d.source = 'generated'
    and d.archived_at is null and d.verification_status <> 'replaced'
    and hr_private.has_permission('documents.manage')
  order by d.created_at desc limit 1
$$;

-- Preview: renders the approved snapshot (or the draft with p_draft) for an
-- employee (or sample data when p_employee is null). Writes nothing.
create or replace function public.hr_preview_document_letter(p_template uuid, p_employee uuid default null,
                                                             p_values jsonb default '{}'::jsonb, p_draft boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.hr_document_templates; s public.hr_document_template_versions; v_title text; v_body text; v_comp boolean;
        v_doc uuid; v_seq int; v_data jsonb; v_ref text; v_renews uuid := hr_private.doc_juuid(p_values, 'renews_document_id');
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to generate letters.', 'forbidden');
  end if;
  select * into t from public.hr_document_templates where id = p_template;
  if t.id is null then perform hr_private.fail('Template not found.', 'not_found'); end if;
  if coalesce(p_draft, false) then
    v_title := t.title; v_body := t.body; v_comp := t.includes_compensation;
  else
    select * into s from public.hr_document_template_versions where template_id = t.id and version = t.approved_version;
    if s.id is null or t.status = 'archived' then perform hr_private.fail('This template has no approved version to use.', 'template_not_approved'); end if;
    v_title := s.title; v_body := s.body; v_comp := s.includes_compensation;
  end if;
  if v_comp and not hr_private.has_permission('documents.compensation') then
    perform hr_private.fail('This template contains compensation details you are not allowed to see.', 'forbidden');
  end if;
  if p_employee is not null and not exists (select 1 from public.hr_employees where id = p_employee) then
    perform hr_private.fail('Employee not found.', 'not_found');
  end if;
  v_doc := case when v_renews is null and p_employee is not null then hr_private.doc_current_letter(t.id, p_employee) end;
  v_seq := coalesce((select count(*)::int from public.hr_document_letter_content c join public.hr_documents d on d.id = c.document_id
                     where d.employee_id = p_employee and d.template_id = t.id), 0) + 1;
  v_ref := hr_private.doc_letter_reference(t, p_employee, v_seq);
  v_data := hr_private.doc_merge_data(p_employee, p_values - 'renews_document_id', v_ref, v_comp);
  return jsonb_build_object(
    'title', hr_private.doc_render(v_title, v_data, false),
    'body', hr_private.doc_render(v_body, v_data, false),
    'reference', v_ref,
    'missing', to_jsonb(hr_private.doc_missing(v_title || E'\n' || v_body, v_data)),
    'includes_compensation', v_comp,
    'template_version', case when coalesce(p_draft, false) then t.current_version else t.approved_version end,
    'reissue_of', v_doc,
    'reissue_version', case when v_doc is not null then (select current_version + 1 from public.hr_documents where id = v_doc) end);
end $$;

-- Issue: stores the rendered text (immutable) as the next letter of the
-- employee's document for this template (a new record for the first issue,
-- or for a contract renewal via values.renews_document_id). The browser then
-- builds the PDF from the returned text and registers it with
-- hr_register_letter_file(). Returns { document_id, letter_id, title, body, reference }.
create or replace function public.hr_issue_document_letter(p_template uuid, p_employee uuid, p_values jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.hr_document_templates; s public.hr_document_template_versions; e public.hr_employees; c public.hr_document_categories;
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_renews uuid := hr_private.doc_juuid(p_values, 'renews_document_id');
  v_old public.hr_documents;
  v_doc uuid; v_seq int; v_ref text; v_data jsonb; v_title text; v_body text; v_letter uuid;
  v_issue date; v_eff date; v_end date; v_ctype text;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to issue letters.', 'forbidden');
  end if;
  select * into t from public.hr_document_templates where id = p_template;
  if t.id is null then perform hr_private.fail('Template not found.', 'not_found'); end if;
  select * into s from public.hr_document_template_versions where template_id = t.id and version = t.approved_version;
  if s.id is null or t.status = 'archived' then perform hr_private.fail('Only an approved template can be used.', 'template_not_approved'); end if;
  if s.includes_compensation and not hr_private.has_permission('documents.compensation') then
    perform hr_private.fail('This template contains compensation details you are not allowed to issue.', 'forbidden');
  end if;
  select * into e from public.hr_employees where id = p_employee;
  if e.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if e.status = 'archived' then perform hr_private.fail('Letters cannot be issued to an archived employee.', 'invalid_state'); end if;
  if e.id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot issue a letter to yourself; another HR user must issue it.', 'self_action');
  end if;
  select * into c from public.hr_document_categories where code = t.category_code;

  if v_renews is not null then
    select * into v_old from public.hr_documents where id = v_renews for update;
    if v_old.id is null or v_old.employee_id <> e.id or not hr_private.document_can_read(v_old.id) then
      perform hr_private.fail('The contract to renew was not found for this employee.', 'not_found');
    end if;
    if v_old.archived_at is not null or v_old.verification_status = 'replaced' then
      perform hr_private.fail('That contract has already been renewed or archived.', 'invalid_state');
    end if;
    if not exists (select 1 from public.hr_document_categories x where x.id = v_old.category_id and x.doc_group = 'contract') then
      perform hr_private.fail('Only contracts can be renewed.', 'invalid');
    end if;
    v_doc := null;
  else
    v_doc := hr_private.doc_current_letter(t.id, e.id);
  end if;

  if v_doc is not null then
    perform 1 from public.hr_documents where id = v_doc for update;
    if exists (select 1 from public.hr_document_letter_content lc where lc.document_id = v_doc
               and not exists (select 1 from public.hr_document_versions dv where dv.letter_content_id = lc.id)) then
      perform hr_private.fail('A previously issued version is still waiting for its PDF. Finish that upload first.', 'letter_file_pending');
    end if;
  end if;

  v_seq := coalesce((select count(*)::int from public.hr_document_letter_content lc join public.hr_documents d on d.id = lc.document_id
                     where d.employee_id = e.id and d.template_id = t.id), 0) + 1;
  v_ref := hr_private.doc_letter_reference(t, e.id, v_seq);
  v_data := hr_private.doc_merge_data(e.id, v_values - 'renews_document_id', v_ref, s.includes_compensation);
  v_title := left(hr_private.doc_render(s.title, v_data, true), 200);
  v_body := hr_private.doc_render(s.body, v_data, true);

  v_issue := coalesce(hr_private.doc_jdate(v_values, 'issue_date'), hr_private.business_today());
  v_eff := coalesce(hr_private.doc_jdate(v_values, 'effective_date'), hr_private.doc_jdate(v_values, 'contract_start_date'));
  v_end := hr_private.doc_jdate(v_values, 'contract_end_date');
  v_ctype := hr_private.doc_jtext(v_values, 'contract_type', 40);
  if t.template_type = 'employment_contract' then
    v_eff := coalesce(v_eff, e.contract_start_date, e.joining_date);
    v_end := coalesce(v_end, e.contract_end_date);
    v_ctype := coalesce(v_ctype, e.contract_type, 'permanent');
    if v_end is not null and v_end < hr_private.business_today() then
      perform hr_private.fail('The contract end date is already in the past.', 'invalid_expiry');
    end if;
  end if;

  if v_doc is null then
    insert into public.hr_documents (employee_id, category_id, title, current_version, verification_status, uploaded_by, source,
                                     template_id, includes_compensation, requires_acknowledgement, issue_date, effective_date,
                                     expiry_date, contract_type, contract_status)
    values (e.id, c.id, v_title, 0, 'pending', auth.uid(), 'generated', t.id, s.includes_compensation, s.requires_acknowledgement,
            v_issue, v_eff, case when t.template_type = 'employment_contract' then v_end end,
            case when t.template_type = 'employment_contract' then v_ctype end,
            case when t.template_type = 'employment_contract' then 'active' end)
    returning id into v_doc;
    if v_renews is not null then perform hr_private.doc_supersede(v_renews, v_doc); end if;
  else
    update public.hr_documents
       set title = v_title, issue_date = v_issue, effective_date = coalesce(v_eff, effective_date),
           includes_compensation = s.includes_compensation, requires_acknowledgement = s.requires_acknowledgement,
           expiry_date = case when t.template_type = 'employment_contract' then coalesce(v_end, expiry_date) else expiry_date end,
           contract_type = case when t.template_type = 'employment_contract' then v_ctype else contract_type end
     where id = v_doc;
  end if;

  insert into public.hr_document_letter_content (document_id, seq, template_id, template_version, template_name, title, body, reference, merge_data, generated_by)
  values (v_doc, v_seq, t.id, s.version, s.name, v_title, v_body, v_ref, v_data, auth.uid())
  returning id into v_letter;

  return jsonb_build_object('document_id', v_doc, 'letter_id', v_letter, 'title', v_title, 'body', v_body, 'reference', v_ref,
                            'issue_date', v_issue, 'includes_compensation', s.includes_compensation);
end $$;

-- Register the PDF of the latest issued letter text as the next document
-- version. Returns the storage path the browser must upload to.
create or replace function public.hr_register_letter_file(p_document uuid, p_size_bytes bigint, p_checksum text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.hr_documents; lc public.hr_document_letter_content; v_name text; v_next int; v_path text; v_ver uuid; e public.hr_employees;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to store issued letters.', 'forbidden');
  end if;
  select * into d from public.hr_documents where id = p_document for update;
  if d.id is null or not hr_private.document_can_read(d.id) then perform hr_private.fail('Document not found.', 'not_found'); end if;
  if d.archived_at is not null then perform hr_private.fail('This document is archived.', 'invalid_state'); end if;
  select * into lc from public.hr_document_letter_content c
   where c.document_id = d.id and not exists (select 1 from public.hr_document_versions v where v.letter_content_id = c.id)
   order by c.seq desc limit 1;
  if lc.id is null then perform hr_private.fail('There is no issued letter waiting for its PDF.', 'not_found'); end if;
  if p_checksum is not null and p_checksum !~ '^[0-9a-f]{64}$' then perform hr_private.fail('The checksum must be a SHA-256 hex digest.', 'invalid'); end if;
  select * into e from public.hr_employees where id = d.employee_id;
  v_name := hr_private.document_validate_file(regexp_replace(lc.title, '\s+—\s+.*$', '') || '_' || e.employee_code || '.pdf', 'application/pdf', p_size_bytes);
  v_next := d.current_version + 1;
  v_path := d.employee_id::text || '/' || d.id::text || '/' || v_next::text || '-' || v_name;
  update public.hr_documents set current_version = v_next, verification_status = 'pending', verified_by = null, verified_at = null,
         rejection_reason = null, verification_notes = null
   where id = d.id;
  insert into public.hr_document_versions (document_id, version, storage_path, file_name, mime_type, size_bytes, checksum, uploaded_by, letter_content_id)
  values (d.id, v_next, v_path, v_name, 'application/pdf', p_size_bytes, p_checksum, auth.uid(), lc.id)
  returning id into v_ver;
  return jsonb_build_object('document_id', d.id, 'version_id', v_ver, 'version', v_next, 'bucket', 'hr-documents', 'storage_path', v_path,
                            'title', lc.title, 'body', lc.body, 'reference', lc.reference);
end $$;

-- Letter text waiting for a PDF (to resume an interrupted issue).
create or replace function public.hr_pending_letter(p_document uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lc public.hr_document_letter_content;
begin
  if not hr_private.has_permission('documents.manage') or not hr_private.document_can_read(p_document) then
    perform hr_private.fail('Document not found.', 'not_found');
  end if;
  select * into lc from public.hr_document_letter_content c
   where c.document_id = p_document and not exists (select 1 from public.hr_document_versions v where v.letter_content_id = c.id)
   order by c.seq desc limit 1;
  if lc.id is null then return null; end if;
  return jsonb_build_object('letter_id', lc.id, 'title', lc.title, 'body', lc.body, 'reference', lc.reference, 'generated_at', lc.generated_at);
end $$;

-- ---------------------------------------------------------------------
-- RPCs: offer letters (Recruitment owns offers; Documents files them)
-- ---------------------------------------------------------------------
-- Offers with their letter state and, when hired, the employee + filed record.
create or replace function public.hr_offer_letters_for_documents()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not (hr_private.has_permission('recruitment.manage')
          or (hr_private.has_permission('documents.manage') and hr_private.has_permission('documents.compensation'))) then
    perform hr_private.fail('You are not allowed to view offer letters.', 'forbidden');
  end if;
  if to_regclass('public.hr_offer_letter_versions') is null then
    return jsonb_build_object('available', false, 'rows', '[]'::jsonb);
  end if;
  execute $q$
    select coalesce(jsonb_agg(x order by x.updated_at desc), '[]'::jsonb) from (
      select f.id as offer_id, f.status, f.current_version, f.issued_on, f.expires_on, f.responded_at, f.updated_at,
             c.full_name as candidate_name, o.title as job_title,
             e.id as employee_id, e.employee_code,
             (select d.id from public.hr_documents d where d.source = 'recruitment' and d.source_ref = f.id::text and d.archived_at is null) as document_id,
             (select d.current_version from public.hr_documents d where d.source = 'recruitment' and d.source_ref = f.id::text and d.archived_at is null) as document_version
      from public.hr_offers f
      join public.hr_candidate_applications a on a.id = f.application_id
      join public.hr_candidates c on c.id = a.candidate_id
      join public.hr_job_openings o on o.id = a.opening_id
      left join public.hr_employees e on e.source = 'candidate' and e.source_ref = f.application_id
      where f.current_version > 0
      order by f.updated_at desc limit 300) x $q$ into v;
  return jsonb_build_object('available', true, 'rows', v);
end $$;

-- File the current letter of an ACCEPTED offer into the hired employee's
-- documents (category offer_letter, includes compensation). One record per
-- offer; filing again after Recruitment regenerated the letter adds a version.
create or replace function public.hr_file_offer_letter(p_offer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_status text; v_app uuid; v_cur int; v_issued date; v_subject text; v_body text; v_merge jsonb; v_tname text;
  v_emp uuid; v_doc uuid; v_cat uuid; v_letter uuid; v_seq int; v_ref text;
begin
  if not (hr_private.has_permission('documents.manage') and hr_private.has_permission('documents.compensation')) then
    perform hr_private.fail('You are not allowed to file offer letters.', 'forbidden');
  end if;
  if to_regclass('public.hr_offer_letter_versions') is null then
    perform hr_private.fail('Offer letters are not available (Recruitment letter versions are not installed).', 'unavailable');
  end if;
  execute 'select status, application_id, current_version, issued_on from public.hr_offers where id = $1 for update'
    into v_status, v_app, v_cur, v_issued using p_offer;
  if v_app is null then perform hr_private.fail('Offer not found.', 'not_found'); end if;
  if v_status <> 'accepted' then perform hr_private.fail('Only an accepted offer can be filed. Recruitment records the acceptance.', 'invalid_state'); end if;
  if coalesce(v_cur, 0) < 1 then perform hr_private.fail('This offer has no generated letter.', 'invalid_state'); end if;
  select id into v_emp from public.hr_employees where source = 'candidate' and source_ref = v_app;
  if v_emp is null then perform hr_private.fail('Convert the candidate to an employee first; the letter is filed on the employee record.', 'invalid_state'); end if;
  if v_emp = hr_private.current_employee_id() then perform hr_private.fail('You cannot file your own offer letter.', 'self_action'); end if;
  execute 'select subject, body, merge_data, template_name from public.hr_offer_letter_versions where offer_id = $1 and version = $2'
    into v_subject, v_body, v_merge, v_tname using p_offer, v_cur;
  if v_body is null then perform hr_private.fail('The offer letter text was not found.', 'not_found'); end if;
  v_ref := 'OFFER/' || upper(left(replace(p_offer::text, '-', ''), 8)) || '/v' || v_cur;

  select id into v_doc from public.hr_documents where source = 'recruitment' and source_ref = p_offer::text and archived_at is null for update;
  if v_doc is not null then
    if exists (select 1 from public.hr_document_letter_content where document_id = v_doc and reference = v_ref) then
      perform hr_private.fail('This version of the offer letter is already filed.', 'duplicate');
    end if;
    if exists (select 1 from public.hr_document_letter_content lc where lc.document_id = v_doc
               and not exists (select 1 from public.hr_document_versions dv where dv.letter_content_id = lc.id)) then
      perform hr_private.fail('A previously filed version is still waiting for its PDF. Finish that upload first.', 'letter_file_pending');
    end if;
  else
    select id into v_cat from public.hr_document_categories where code = 'offer_letter';
    insert into public.hr_documents (employee_id, category_id, title, current_version, verification_status, uploaded_by, source, source_ref,
                                     includes_compensation, issue_date)
    values (v_emp, v_cat, left(coalesce(v_subject, 'Offer letter'), 200), 0, 'pending', auth.uid(), 'recruitment', p_offer::text, true, v_issued)
    returning id into v_doc;
  end if;
  v_seq := coalesce((select max(seq) from public.hr_document_letter_content where document_id = v_doc), 0) + 1;
  insert into public.hr_document_letter_content (document_id, seq, template_id, template_version, template_name, title, body, reference, merge_data, generated_by)
  values (v_doc, v_seq, null, v_cur, coalesce(v_tname, 'Recruitment offer letter'), left(coalesce(v_subject, 'Offer letter'), 200), v_body, v_ref,
          coalesce(v_merge, '{}'::jsonb), auth.uid())
  returning id into v_letter;
  return jsonb_build_object('document_id', v_doc, 'letter_id', v_letter, 'title', left(coalesce(v_subject, 'Offer letter'), 200), 'body', v_body, 'reference', v_ref);
end $$;

-- ---------------------------------------------------------------------
-- RPCs: directory + overview
-- ---------------------------------------------------------------------
-- Filters (all optional): employee, department, legal_entity, category,
-- group, status, expiry_status (none|valid|expiring|expired), uploaded_from,
-- uploaded_to (dates), search, source, archived (bool), needs_acknowledgement (bool).
create or replace function hr_private.doc_filtered(p_filters jsonb)
returns table (id uuid, employee_id uuid, employee_code text, employee_name text, department_id uuid, department_name text,
               category_id uuid, category_code text, category_name text, doc_group text, is_confidential boolean,
               title text, current_version int, expiry_date date, renewal_date date, verification_status text, expiry_status text,
               source text, includes_compensation boolean, requires_acknowledgement boolean, contract_type text, contract_status text,
               issue_date date, effective_date date, supersedes_document_id uuid, parent_document_id uuid,
               file_uploaded boolean, last_uploaded_at timestamptz, created_at timestamptz, archived_at timestamptz, rejection_reason text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_today date := hr_private.business_today();
  v_soon int := coalesce((hr_private.doc_settings() ->> 'expiring_soon_days')::int, 30);
  v_tz text := hr_private.business_timezone();
  v_search text := nullif(btrim(left(coalesce(f ->> 'search', ''), 100)), '');
  v_from date := hr_private.doc_jdate(f, 'uploaded_from');
  v_to date := hr_private.doc_jdate(f, 'uploaded_to');
begin
  return query
  select d.id, d.employee_id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
         e.department_id, dep.name, c.id, c.code, c.name, c.doc_group, c.is_confidential,
         d.title, d.current_version, d.expiry_date, d.renewal_date, d.verification_status,
         hr_private.doc_expiry_status(d.expiry_date, d.verification_status, v_today, v_soon),
         d.source, d.includes_compensation, d.requires_acknowledgement, d.contract_type, d.contract_status,
         d.issue_date, d.effective_date, d.supersedes_document_id, d.parent_document_id,
         exists (select 1 from public.hr_document_versions v join storage.objects o on o.bucket_id = 'hr-documents' and o.name = v.storage_path
                 where v.document_id = d.id and v.version = d.current_version),
         (select max(v.uploaded_at) from public.hr_document_versions v where v.document_id = d.id),
         d.created_at, d.archived_at, d.rejection_reason
  from public.hr_documents d
  join public.hr_document_categories c on c.id = d.category_id
  join public.hr_employees e on e.id = d.employee_id
  left join public.hr_departments dep on dep.id = e.department_id
  where hr_private.document_can_read(d.id)
    and (case when coalesce((f ->> 'archived')::boolean, false) then d.archived_at is not null else d.archived_at is null end)
    and (hr_private.doc_juuid(f, 'employee') is null or d.employee_id = hr_private.doc_juuid(f, 'employee'))
    and (hr_private.doc_juuid(f, 'department') is null or e.department_id = hr_private.doc_juuid(f, 'department'))
    and (hr_private.doc_juuid(f, 'legal_entity') is null or e.legal_entity_id = hr_private.doc_juuid(f, 'legal_entity'))
    and (hr_private.doc_juuid(f, 'category') is null or d.category_id = hr_private.doc_juuid(f, 'category'))
    and (nullif(f ->> 'group', '') is null or c.doc_group = f ->> 'group')
    and (nullif(f ->> 'status', '') is null or d.verification_status = f ->> 'status')
    and (nullif(f ->> 'source', '') is null or d.source = f ->> 'source')
    and (nullif(f ->> 'expiry_status', '') is null or hr_private.doc_expiry_status(d.expiry_date, d.verification_status, v_today, v_soon) = f ->> 'expiry_status')
    and (v_from is null or (d.created_at at time zone v_tz)::date >= v_from)
    and (v_to is null or (d.created_at at time zone v_tz)::date <= v_to)
    and (not coalesce((f ->> 'needs_acknowledgement')::boolean, false) or d.requires_acknowledgement)
    and (v_search is null or d.title ilike '%' || v_search || '%' or e.employee_code ilike '%' || v_search || '%'
         or coalesce(e.display_name, e.first_name || ' ' || e.last_name) ilike '%' || v_search || '%');
end $$;

create or replace function public.hr_search_documents(p_filters jsonb default '{}'::jsonb, p_page int default 1, p_page_size int default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_size int := least(greatest(coalesce(p_page_size, 25), 1), 200); v_page int := greatest(coalesce(p_page, 1), 1); v jsonb;
begin
  if auth.uid() is null then perform hr_private.fail('Sign in first.', 'not_signed_in'); end if;
  with r as materialized (select * from hr_private.doc_filtered(p_filters))
  select jsonb_build_object(
    'total', (select count(*) from r),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id)
                      from (select * from r order by created_at desc, id limit v_size offset (v_page - 1) * v_size) x), '[]'::jsonb))
    into v;
  return v;
end $$;

-- Pending acknowledgements (policies + documents) for the employees in scope.
create or replace function hr_private.pending_acknowledgements(p_employee uuid default null)
returns table (employee_id uuid, subject_type text, item_id uuid, policy_version_id uuid, version int, title text, requested_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- Scope: HR (documents.manage / documents.view) for anyone; others only themselves.
  with scope as (select hr_private.has_permission('documents.manage') or hr_private.has_permission('documents.view') as hr,
                        hr_private.current_employee_id() as me)
  select t.employee_id, 'policy', p.id, pv.id, pv.version, p.title, pv.published_at
  from public.hr_policies p
  join public.hr_policy_versions pv on pv.policy_id = p.id and pv.status = 'published'
  cross join lateral hr_private.policy_targets(p.id) t
  cross join scope s
  where p.status = 'published' and p.requires_acknowledgement and p.employee_visible
    and (p_employee is null or t.employee_id = p_employee)
    and (s.hr or t.employee_id = s.me)
    and not exists (select 1 from public.hr_document_acknowledgements a where a.employee_id = t.employee_id and a.policy_version_id = pv.id)
  union all
  select d.employee_id, 'document', d.id, null::uuid, d.current_version, d.title, v.uploaded_at
  from public.hr_documents d
  join public.hr_document_versions v on v.document_id = d.id and v.version = d.current_version
  join public.hr_employees e on e.id = d.employee_id and e.status not in ('exited','archived','suspended')
  join public.hr_document_categories c on c.id = d.category_id and c.employee_can_view and not c.is_confidential
  cross join scope s
  where d.requires_acknowledgement and d.archived_at is null and d.current_version > 0
    and d.verification_status not in ('rejected','replaced')
    and (p_employee is null or d.employee_id = p_employee)
    and (s.hr or d.employee_id = s.me)
    and exists (select 1 from storage.objects o where o.bucket_id = 'hr-documents' and o.name = v.storage_path)
    and not exists (select 1 from public.hr_document_acknowledgements a where a.employee_id = d.employee_id and a.document_id = d.id and a.version = d.current_version)
$$;

create or replace function public.hr_documents_overview(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_hr boolean := hr_private.has_permission('documents.manage') or hr_private.has_permission('documents.view');
        f jsonb := coalesce(p_filters, '{}'::jsonb); v_today date := hr_private.business_today();
begin
  if not (v_hr or hr_private.has_permission('documents.view_team')) then
    perform hr_private.fail('You are not allowed to view the documents overview.', 'forbidden');
  end if;
  with r as materialized (select * from hr_private.doc_filtered(f))
  select jsonb_build_object(
    'total', (select count(*) from r),
    'pending_verification', (select count(*) from r where verification_status = 'pending' and file_uploaded),
    'awaiting_file', (select count(*) from r where not file_uploaded),
    'verified', (select count(*) from r where verification_status = 'verified'),
    'rejected', (select count(*) from r where verification_status = 'rejected'),
    'expiring_soon', (select count(*) from r where expiry_status = 'expiring'),
    'expired', (select count(*) from r where expiry_status = 'expired'),
    'renewals_due', (select count(*) from r where renewal_date is not null and renewal_date <= v_today + 30
                      and coalesce(contract_status, '') not in ('renewed','terminated') and verification_status <> 'replaced'),
    'pending_acknowledgements', case when v_hr then (
        select count(*) from hr_private.pending_acknowledgements() pa
        join public.hr_employees e on e.id = pa.employee_id
        where (hr_private.doc_juuid(f, 'employee') is null or pa.employee_id = hr_private.doc_juuid(f, 'employee'))
          and (hr_private.doc_juuid(f, 'department') is null or e.department_id = hr_private.doc_juuid(f, 'department'))
          and (hr_private.doc_juuid(f, 'legal_entity') is null or e.legal_entity_id = hr_private.doc_juuid(f, 'legal_entity'))
          and (pa.subject_type = 'policy' or hr_private.document_can_read(pa.item_id))) end,
    'expiring_soon_days', coalesce((hr_private.doc_settings() ->> 'expiring_soon_days')::int, 30),
    'by_group', coalesce((select jsonb_object_agg(g.doc_group, g.n) from (select doc_group, count(*) n from r group by doc_group) g), '{}'::jsonb),
    'recently_uploaded', coalesce((select jsonb_agg(to_jsonb(x) order by x.last_uploaded_at desc) from (
        select r.id, r.title, r.employee_id, r.employee_code, r.employee_name, r.category_name, r.verification_status, r.current_version, r.last_uploaded_at
        from r where r.last_uploaded_at is not null order by r.last_uploaded_at desc limit 8) x), '[]'::jsonb))
    into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- RPCs: policies
-- ---------------------------------------------------------------------
-- Create / edit a policy. Header keys: title, category, requires_acknowledgement,
-- employee_visible, audience_type, audience_ids, audience_codes.
-- Content keys (edit the draft version; a published policy gets a new draft):
-- content, effective_date, change_summary.
create or replace function public.hr_save_policy(p_policy uuid, p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := coalesce(p_values, '{}'::jsonb); p public.hr_policies; v_id uuid; v_draft public.hr_policy_versions;
        v_type text; v_ids uuid[]; v_codes text[]; v_bad text; v_next int;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to manage policies.', 'forbidden');
  end if;
  if jsonb_typeof(v) <> 'object' then perform hr_private.fail('Policy values must be an object.', 'invalid'); end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(v) k
   where k not in ('title','category','requires_acknowledgement','employee_visible','audience_type','audience_ids','audience_codes',
                   'content','effective_date','change_summary');
  if v_bad is not null then perform hr_private.fail('Unknown policy field(s): ' || v_bad || '.', 'invalid'); end if;
  if length(coalesce(v ->> 'content', '')) > 100000 then
    perform hr_private.fail('The policy text is too long (100000 characters maximum).', 'invalid');
  end if;
  if p_policy is not null then
    select * into p from public.hr_policies where id = p_policy for update;
    if p.id is null then perform hr_private.fail('Policy not found.', 'not_found'); end if;
    if p.status = 'archived' then perform hr_private.fail('An archived policy cannot be edited.', 'invalid_state'); end if;
  end if;
  p.title := coalesce(hr_private.doc_jtext(v, 'title', 200), p.title);
  if p.title is null or length(p.title) < 2 then perform hr_private.fail('Give the policy a title.', 'invalid'); end if;
  p.category := coalesce(hr_private.doc_jtext(v, 'category', 40), p.category, 'general');
  if p.category not in ('general','code_of_conduct','hr','leave_attendance','it_security','health_safety','compliance','benefits','other') then
    perform hr_private.fail('Unknown policy category.', 'invalid');
  end if;
  if v ? 'requires_acknowledgement' then p.requires_acknowledgement := (v ->> 'requires_acknowledgement')::boolean; end if;
  if v ? 'employee_visible' then p.employee_visible := (v ->> 'employee_visible')::boolean; end if;
  v_type := coalesce(hr_private.doc_jtext(v, 'audience_type', 40), p.audience_type, 'all');
  if v_type not in ('all','departments','locations','employment_types','employees') then perform hr_private.fail('Unknown audience.', 'invalid'); end if;
  v_ids := case when v ? 'audience_ids' then coalesce(array(select hr_private.doc_juuid(jsonb_build_object('x', x), 'x')
                                                             from jsonb_array_elements_text(v -> 'audience_ids') x), '{}') else coalesce(p.audience_ids, '{}') end;
  if array_position(v_ids, null) is not null then perform hr_private.fail('Audience contains an invalid id.', 'invalid'); end if;
  v_codes := case when v ? 'audience_codes' then coalesce(array(select x from jsonb_array_elements_text(v -> 'audience_codes') x), '{}') else coalesce(p.audience_codes, '{}') end;
  if v_type in ('departments','locations','employees') and cardinality(v_ids) = 0
     or v_type = 'employment_types' and cardinality(v_codes) = 0 then
    perform hr_private.fail('Choose who the policy applies to.', 'audience_required');
  end if;
  if v_type = 'all' then v_ids := '{}'; v_codes := '{}'; elsif v_type = 'employment_types' then v_ids := '{}'; else v_codes := '{}'; end if;

  if p_policy is null then
    insert into public.hr_policies (title, category, requires_acknowledgement, employee_visible, audience_type, audience_ids, audience_codes, updated_by)
    values (p.title, p.category, coalesce(p.requires_acknowledgement, true), coalesce(p.employee_visible, true), v_type, v_ids, v_codes, auth.uid())
    returning id into v_id;
  else
    update public.hr_policies set title = p.title, category = p.category, requires_acknowledgement = p.requires_acknowledgement,
           employee_visible = p.employee_visible, audience_type = v_type, audience_ids = v_ids, audience_codes = v_codes, updated_by = auth.uid()
     where id = p.id;
    v_id := p.id;
  end if;

  if p_policy is null or v ? 'content' or v ? 'effective_date' or v ? 'change_summary' then
    select * into v_draft from public.hr_policy_versions where policy_id = v_id and status = 'draft';
    if v_draft.id is null then
      v_next := coalesce((select max(version) from public.hr_policy_versions where policy_id = v_id), 0) + 1;
      insert into public.hr_policy_versions (policy_id, version, status, content, effective_date, change_summary)
      values (v_id, v_next, 'draft',
              case when v ? 'content' then nullif(v ->> 'content', '') else (select content from public.hr_policy_versions where policy_id = v_id and status = 'published') end,
              hr_private.doc_jdate(v, 'effective_date'), hr_private.doc_jtext(v, 'change_summary', 1000));
    else
      update public.hr_policy_versions
         set content = case when v ? 'content' then nullif(v ->> 'content', '') else content end,
             effective_date = case when v ? 'effective_date' then hr_private.doc_jdate(v, 'effective_date') else effective_date end,
             change_summary = case when v ? 'change_summary' then hr_private.doc_jtext(v, 'change_summary', 1000) else change_summary end
       where id = v_draft.id;
    end if;
  end if;
  return jsonb_build_object('policy_id', v_id,
    'draft_version', (select version from public.hr_policy_versions where policy_id = v_id and status = 'draft'));
end $$;

-- Register a PDF for the policy's draft version.
create or replace function public.hr_register_policy_file(p_policy uuid, p_file_name text, p_mime_type text, p_size_bytes bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_draft public.hr_policy_versions; v_name text; v_path text;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to manage policies.', 'forbidden');
  end if;
  select * into v_draft from public.hr_policy_versions where policy_id = p_policy and status = 'draft' for update;
  if v_draft.id is null then perform hr_private.fail('Start a new draft version before attaching a file.', 'invalid_state'); end if;
  if lower(btrim(coalesce(p_mime_type, ''))) <> 'application/pdf' then perform hr_private.fail('Policy files must be PDF.', 'invalid_file_type'); end if;
  v_name := hr_private.document_validate_file(p_file_name, p_mime_type, p_size_bytes);
  v_path := 'policies/' || p_policy::text || '/' || v_draft.version || '-' || substr(md5(gen_random_uuid()::text), 1, 8) || '-' || v_name;
  update public.hr_policy_versions set storage_path = v_path, file_name = v_name, mime_type = 'application/pdf', size_bytes = p_size_bytes,
         file_registered_by = auth.uid(), file_registered_at = now()
   where id = v_draft.id;
  return jsonb_build_object('policy_id', p_policy, 'version', v_draft.version, 'bucket', 'hr-documents', 'storage_path', v_path);
end $$;

create or replace function public.hr_publish_policy(p_policy uuid, p_change_summary text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare p public.hr_policies; v_draft public.hr_policy_versions; v_n int := 0; r record;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to publish policies.', 'forbidden');
  end if;
  select * into p from public.hr_policies where id = p_policy for update;
  if p.id is null then perform hr_private.fail('Policy not found.', 'not_found'); end if;
  if p.status = 'archived' then perform hr_private.fail('An archived policy cannot be published.', 'invalid_state'); end if;
  select * into v_draft from public.hr_policy_versions where policy_id = p.id and status = 'draft' for update;
  if v_draft.id is null then perform hr_private.fail('There is no draft version to publish.', 'invalid_state'); end if;
  if nullif(btrim(coalesce(v_draft.content, '')), '') is null and v_draft.storage_path is null then
    perform hr_private.fail('Add the policy text or attach a PDF before publishing.', 'invalid');
  end if;
  if v_draft.storage_path is not null and not exists (select 1 from storage.objects o where o.bucket_id = 'hr-documents' and o.name = v_draft.storage_path) then
    perform hr_private.fail('The attached PDF has not finished uploading.', 'upload_missing');
  end if;
  if v_draft.version > 1 and nullif(btrim(coalesce(p_change_summary, v_draft.change_summary, '')), '') is null then
    perform hr_private.fail('Describe what changed in this version.', 'reason_required');
  end if;
  update public.hr_policy_versions set status = 'superseded' where policy_id = p.id and status = 'published';
  update public.hr_policy_versions
     set status = 'published', published_by = auth.uid(), published_at = now(),
         effective_date = coalesce(effective_date, hr_private.business_today()),
         change_summary = coalesce(nullif(btrim(coalesce(p_change_summary, '')), ''), change_summary)
   where id = v_draft.id;
  update public.hr_policies set status = 'published', current_version = v_draft.version, published_at = now() where id = p.id;
  if p.employee_visible then
    for r in select t.employee_id from hr_private.policy_targets(p.id) t loop
      perform hr_private.notify_employee(r.employee_id, 'policy_published',
        case when v_draft.version > 1 then 'Policy updated: ' else 'New policy: ' end || p.title,
        case when p.requires_acknowledgement then 'Please read it and acknowledge it in My Documents → Policies.' else 'It is available in My Documents → Policies.' end,
        '/employee/documents?tab=policies', 'hr_policy', p.id::text);
      v_n := v_n + 1;
    end loop;
  end if;
  return v_n;
end $$;

create or replace function public.hr_archive_policy(p_policy uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to archive policies.', 'forbidden');
  end if;
  update public.hr_policies set status = 'archived', archived_at = now() where id = p_policy and status <> 'archived';
  if not found then perform hr_private.fail('Policy not found or already archived.', 'not_found'); end if;
  update public.hr_policy_versions set status = 'archived' where policy_id = p_policy and status = 'published';
  delete from public.hr_policy_versions where policy_id = p_policy and status = 'draft';
end $$;

create or replace function public.hr_discard_policy_draft(p_policy uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to manage policies.', 'forbidden');
  end if;
  if not exists (select 1 from public.hr_policy_versions where policy_id = p_policy and status <> 'draft') then
    perform hr_private.fail('This policy has never been published; archive it instead.', 'invalid_state');
  end if;
  delete from public.hr_policy_versions where policy_id = p_policy and status = 'draft';
  if not found then perform hr_private.fail('There is no draft to discard.', 'not_found'); end if;
end $$;

-- ---------------------------------------------------------------------
-- RPCs: acknowledgements
-- ---------------------------------------------------------------------
create or replace function public.hr_acknowledge_policy(p_policy uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); p public.hr_policies; pv public.hr_policy_versions; v_at timestamptz;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into p from public.hr_policies where id = p_policy;
  if p.id is null or p.status <> 'published' or not p.employee_visible or not hr_private.policy_includes(p.id, v_me) then
    perform hr_private.fail('Policy not found.', 'not_found');
  end if;
  if not p.requires_acknowledgement then perform hr_private.fail('This policy does not require acknowledgement.', 'not_required'); end if;
  select * into pv from public.hr_policy_versions where policy_id = p.id and status = 'published';
  select acknowledged_at into v_at from public.hr_document_acknowledgements where employee_id = v_me and policy_version_id = pv.id;
  if v_at is not null then return v_at; end if;
  insert into public.hr_document_acknowledgements (employee_id, subject_type, policy_id, policy_version_id, version, title, statement, acknowledged_by)
  values (v_me, 'policy', p.id, pv.id, pv.version, p.title,
          'I confirm that I have received and read "' || p.title || '" (version ' || pv.version || '). This is a record of receipt, not a digital signature.',
          auth.uid())
  returning acknowledged_at into v_at;
  return v_at;
end $$;

create or replace function public.hr_acknowledge_document(p_document uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); d public.hr_documents; v_path text; v_at timestamptz;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into d from public.hr_documents where id = p_document;
  if d.id is null or d.employee_id <> v_me or not hr_private.document_can_read(d.id) then perform hr_private.fail('Document not found.', 'not_found'); end if;
  if not d.requires_acknowledgement then perform hr_private.fail('This document does not require acknowledgement.', 'not_required'); end if;
  if d.verification_status in ('rejected','replaced') then perform hr_private.fail('This document is no longer current.', 'invalid_state'); end if;
  select storage_path into v_path from public.hr_document_versions where document_id = d.id and version = d.current_version;
  if v_path is null or not exists (select 1 from storage.objects o where o.bucket_id = 'hr-documents' and o.name = v_path) then
    perform hr_private.fail('The document file is not available yet.', 'upload_missing');
  end if;
  select acknowledged_at into v_at from public.hr_document_acknowledgements where employee_id = v_me and document_id = d.id and version = d.current_version;
  if v_at is not null then return v_at; end if;
  insert into public.hr_document_acknowledgements (employee_id, subject_type, document_id, version, title, statement, acknowledged_by)
  values (v_me, 'document', d.id, d.current_version, d.title,
          'I confirm that I have received "' || d.title || '" (version ' || d.current_version || '). This is a record of receipt, not a digital signature.',
          auth.uid())
  returning acknowledged_at into v_at;
  return v_at;
end $$;

create or replace function public.hr_my_pending_acknowledgements()
returns table (subject_type text, item_id uuid, version int, title text, requested_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_me uuid := hr_private.current_employee_id();
begin
  if v_me is null then return; end if;
  return query select pa.subject_type, pa.item_id, pa.version, pa.title, pa.requested_at
               from hr_private.pending_acknowledgements(v_me) pa order by pa.requested_at;
end $$;

-- HR tracker. Filters: subject_type, policy, employee, department, status (pending|acknowledged).
create or replace function public.hr_acknowledgement_tracker(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v jsonb;
begin
  if not (hr_private.has_permission('documents.manage') or hr_private.has_permission('documents.view')) then
    perform hr_private.fail('You are not allowed to view acknowledgements.', 'forbidden');
  end if;
  with items as (
    select pa.employee_id, pa.subject_type, pa.item_id, pa.version, pa.title, pa.requested_at, 'pending'::text as status, null::timestamptz as acknowledged_at
    from hr_private.pending_acknowledgements() pa
    where pa.subject_type = 'policy' or hr_private.document_can_read(pa.item_id)
    union all
    select a.employee_id, a.subject_type, coalesce(a.policy_id, a.document_id), a.version, a.title,
           coalesce(pv.published_at, dv.uploaded_at), 'acknowledged', a.acknowledged_at
    from public.hr_document_acknowledgements a
    left join public.hr_policies p on p.id = a.policy_id
    left join public.hr_policy_versions pv on pv.id = a.policy_version_id
    left join public.hr_documents d on d.id = a.document_id
    left join public.hr_document_versions dv on dv.document_id = a.document_id and dv.version = a.version
    where (a.subject_type = 'policy' and pv.status = 'published' and p.status = 'published')
       or (a.subject_type = 'document' and d.archived_at is null and a.version = d.current_version and hr_private.document_can_read(d.id))
  ), scoped as (
    select i.*, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)) as employee_name,
           dep.name as department_name,
           (select max(r.reminded_at) from public.hr_acknowledgement_reminders r where r.employee_id = i.employee_id
              and ((i.subject_type = 'policy' and r.policy_version_id = (select id from public.hr_policy_versions where policy_id = i.item_id and version = i.version))
                or (i.subject_type = 'document' and r.document_id = i.item_id and r.version = i.version))) as last_reminded_at,
           (select count(*) from public.hr_acknowledgement_reminders r where r.employee_id = i.employee_id
              and ((i.subject_type = 'policy' and r.policy_version_id = (select id from public.hr_policy_versions where policy_id = i.item_id and version = i.version))
                or (i.subject_type = 'document' and r.document_id = i.item_id and r.version = i.version))) as reminder_count
    from items i
    join public.hr_employees e on e.id = i.employee_id
    left join public.hr_departments dep on dep.id = e.department_id
    where (nullif(f ->> 'subject_type', '') is null or i.subject_type = f ->> 'subject_type')
      and (hr_private.doc_juuid(f, 'policy') is null or (i.subject_type = 'policy' and i.item_id = hr_private.doc_juuid(f, 'policy')))
      and (hr_private.doc_juuid(f, 'employee') is null or i.employee_id = hr_private.doc_juuid(f, 'employee'))
      and (hr_private.doc_juuid(f, 'department') is null or e.department_id = hr_private.doc_juuid(f, 'department'))
      and (nullif(f ->> 'status', '') is null or i.status = f ->> 'status')
  )
  select jsonb_build_object(
    'totals', jsonb_build_object('pending', (select count(*) from scoped where status = 'pending'),
                                 'acknowledged', (select count(*) from scoped where status = 'acknowledged')),
    'by_item', coalesce((select jsonb_agg(x order by x.pending desc, x.title) from (
        select subject_type, item_id, title, version, count(*) filter (where status = 'pending') as pending,
               count(*) filter (where status = 'acknowledged') as acknowledged
        from scoped group by subject_type, item_id, title, version) x), '[]'::jsonb),
    'by_employee', coalesce((select jsonb_agg(x order by x.pending desc, x.employee_name) from (
        select employee_id, employee_code, employee_name, department_name,
               count(*) filter (where status = 'pending') as pending, count(*) filter (where status = 'acknowledged') as acknowledged
        from scoped group by employee_id, employee_code, employee_name, department_name) x), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.status desc, x.requested_at desc nulls last) from (select * from scoped order by status desc, requested_at desc nulls last limit 500) x), '[]'::jsonb))
  into v;
  return v;
end $$;

-- Remind pending employees (throttled by acknowledgement_reminder_hours).
create or replace function public.hr_send_acknowledgement_reminders(p_policy uuid default null, p_document uuid default null, p_employee uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0; v_hours int := coalesce((hr_private.doc_settings() ->> 'acknowledgement_reminder_hours')::int, 24);
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to send reminders.', 'forbidden');
  end if;
  for r in
    select pa.* from hr_private.pending_acknowledgements(p_employee) pa
    where (p_policy is null or (pa.subject_type = 'policy' and pa.item_id = p_policy))
      and (p_document is null or (pa.subject_type = 'document' and pa.item_id = p_document))
      and (pa.subject_type = 'policy' or hr_private.document_can_read(pa.item_id))
      and not exists (select 1 from public.hr_acknowledgement_reminders x
                      where x.employee_id = pa.employee_id and x.version = pa.version
                        and (x.policy_version_id = pa.policy_version_id or (pa.subject_type = 'document' and x.document_id = pa.item_id))
                        and x.reminded_at > now() - make_interval(hours => v_hours))
  loop
    perform hr_private.notify_employee(r.employee_id, 'acknowledgement_reminder', 'Acknowledgement pending: ' || r.title,
      'Please read it and acknowledge it in My Documents.',
      case when r.subject_type = 'policy' then '/employee/documents?tab=policies' else '/employee/documents?tab=acknowledgements' end,
      case when r.subject_type = 'policy' then 'hr_policy' else 'hr_document' end, r.item_id::text);
    insert into public.hr_acknowledgement_reminders (employee_id, policy_version_id, document_id, version, reminded_by)
    values (r.employee_id, r.policy_version_id, case when r.subject_type = 'document' then r.item_id end, r.version, auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Reminder engine (scheduler-ready)
-- ---------------------------------------------------------------------
-- Marks expired documents / contracts, then sends ONE reminder per stage
-- reached (the most urgent configured stage at or below the days left), once
-- per document + event + due date + stage. Recipients and email follow the
-- 'documents' settings. Called by the service role (scheduler, may pass
-- p_as_of for testing) or by HR (always today).
create or replace function public.hr_run_document_reminders(p_as_of date default null, p_trigger text default 'manual')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_today date;
  s jsonb := hr_private.doc_settings();
  v_soon int := coalesce((s ->> 'expiring_soon_days')::int, 30);
  v_exp_days int[] := hr_private.doc_int_array(s -> 'expiry_reminder_days');
  v_ren_days int[] := hr_private.doc_int_array(s -> 'renewal_reminder_days');
  v_run uuid; v_before bigint; v_expired int := 0; v_tmp int; v_rem int := 0; v_mail int := 0;
  r record; v_stage int; v_left int; v_title text; v_body text; v_emailed boolean; v_who text;
begin
  if not (v_service or hr_private.has_permission('documents.manage')) then
    perform hr_private.fail('You are not allowed to run document reminders.', 'forbidden');
  end if;
  v_today := case when v_service then coalesce(p_as_of, hr_private.business_today()) else hr_private.business_today() end;
  insert into public.hr_document_reminder_runs (trigger_source, as_of, triggered_by)
  values (case when v_service and p_trigger = 'scheduler' then 'scheduler' else 'manual' end, v_today, auth.uid())
  returning id into v_run;
  select count(*) into v_before from public.hr_notifications;

  update public.hr_documents set verification_status = 'expired'
   where archived_at is null and expiry_date < v_today and verification_status in ('pending','verified');
  get diagnostics v_expired = row_count;
  update public.hr_documents set contract_status = 'expired'
   where archived_at is null and expiry_date < v_today and contract_status in ('active','expiring');
  update public.hr_documents set contract_status = 'expiring'
   where archived_at is null and expiry_date between v_today and v_today + v_soon and contract_status = 'active';

  for r in
    select d.id, d.employee_id, d.title, d.expiry_date, d.renewal_date, d.includes_compensation, d.contract_status,
           c.employee_can_view, c.employee_can_upload, c.is_confidential, c.reminder_days,
           e.company_email, e.manager_id, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)) as emp_name,
           ev.event, ev.due_date
    from public.hr_documents d
    join public.hr_document_categories c on c.id = d.category_id
    join public.hr_employees e on e.id = d.employee_id and e.status not in ('exited','archived')
    cross join lateral (values ('expiry', d.expiry_date), ('renewal', d.renewal_date)) ev(event, due_date)
    where d.archived_at is null and d.verification_status <> 'replaced' and ev.due_date is not null
      and (ev.event = 'expiry' or coalesce(d.contract_status, '') not in ('renewed','terminated'))
    order by ev.due_date
  loop
    v_left := r.due_date - v_today;
    select min(x) into v_stage from unnest(case when r.event = 'expiry' then coalesce(r.reminder_days::int[], v_exp_days) else v_ren_days end) x
     where v_left <= x;
    continue when v_stage is null;
    continue when exists (select 1 from public.hr_document_reminder_log l
                          where l.document_id = r.id and l.event = r.event and l.due_date = r.due_date and l.stage_days = v_stage);
    v_who := case when v_left < 0 then 'expired on ' when v_left = 0 then 'expires today, ' else 'expires on ' end;
    if r.event = 'expiry' then
      v_title := case when v_left < 0 then 'Document expired' when v_left = 0 then 'Document expires today' else 'Document expiring in ' || v_left || ' day' || case when v_left = 1 then '' else 's' end end;
      v_body := r.title || ' ' || v_who || hr_private.doc_fmt_date(r.due_date) || '.';
    else
      v_title := case when v_left <= 0 then 'Contract renewal due' else 'Contract renewal in ' || v_left || ' day' || case when v_left = 1 then '' else 's' end end;
      v_body := r.title || ': renewal date ' || hr_private.doc_fmt_date(r.due_date) || '.';
    end if;
    v_emailed := false;
    -- Employee (expiry only; never for confidential categories)
    if r.event = 'expiry' and coalesce((s ->> 'notify_employee')::boolean, true) and r.employee_can_view and not r.is_confidential then
      perform hr_private.notify_employee(r.employee_id, 'document_expiry', v_title,
        v_body || case when r.employee_can_upload then ' Please upload a renewed copy.' else ' HR will arrange a renewed copy.' end,
        '/employee/documents?tab=expiring', 'hr_document', r.id::text);
      if coalesce((s ->> 'email_reminders')::boolean, false) and r.company_email is not null then
        perform hr_private.queue_email(r.company_email::text, v_title || ': ' || r.title,
          v_body || ' Please sign in to the Employee Portal to upload a renewed copy.', 'document_expiry', 'hr_document', r.id::text);
        v_emailed := true; v_mail := v_mail + 1;
      end if;
    end if;
    -- HR
    if coalesce((s ->> 'notify_hr')::boolean, true) or r.event = 'renewal' then
      perform hr_private.notify_permission_holders('documents.manage', 'document_' || r.event, v_title,
        r.emp_name || ' · ' || v_body, '/hr/documents?tab=expiry', 'hr_document', r.id::text, r.employee_id);
    end if;
    -- Manager (team-visible, non-compensation documents only)
    if coalesce((s ->> 'notify_manager')::boolean, false) and r.manager_id is not null and not r.is_confidential and not r.includes_compensation then
      perform hr_private.notify_employee(r.manager_id, 'document_' || r.event, v_title || ' (team)', r.emp_name || ' · ' || v_body,
        '/hr/documents?tab=expiry', 'hr_document', r.id::text);
    end if;
    insert into public.hr_document_reminder_log (document_id, event, due_date, stage_days, run_id, emailed)
    values (r.id, r.event, r.due_date, v_stage, v_run, v_emailed);
    v_rem := v_rem + 1;
  end loop;

  select count(*) - v_before into v_before from public.hr_notifications;
  update public.hr_document_reminder_runs
     set finished_at = now(), status = 'completed', expired_marked = v_expired, reminders = v_rem,
         notifications = v_before::int, emails_queued = v_mail
   where id = v_run;
  return jsonb_build_object('run_id', v_run, 'as_of', v_today, 'expired_marked', v_expired, 'reminders', v_rem,
                            'notifications', v_before, 'emails_queued', v_mail);
end $$;

-- Upcoming reminders (what the next runs will send) for the HR screen.
create or replace function public.hr_document_reminder_schedule(p_days int default 60)
returns table (document_id uuid, employee_id uuid, employee_code text, employee_name text, title text, category_name text,
               event text, due_date date, days_left int, next_stage int, last_stage_sent int, last_sent_at timestamptz,
               verification_status text, renewal_request_open boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare s jsonb := hr_private.doc_settings(); v_today date := hr_private.business_today();
        v_exp int[] := hr_private.doc_int_array(s -> 'expiry_reminder_days'); v_ren int[] := hr_private.doc_int_array(s -> 'renewal_reminder_days');
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to view reminders.', 'forbidden');
  end if;
  return query
  select d.id, d.employee_id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), d.title, c.name,
         ev.event, ev.due_date, (ev.due_date - v_today)::int,
         (select max(x) from unnest(case when ev.event = 'expiry' then coalesce(c.reminder_days::int[], v_exp) else v_ren end) x
           where x < coalesce((select min(l.stage_days) from public.hr_document_reminder_log l
                                where l.document_id = d.id and l.event = ev.event and l.due_date = ev.due_date), 2147483647)),
         (select min(l.stage_days) from public.hr_document_reminder_log l where l.document_id = d.id and l.event = ev.event and l.due_date = ev.due_date),
         (select max(l.created_at) from public.hr_document_reminder_log l where l.document_id = d.id and l.event = ev.event and l.due_date = ev.due_date),
         d.verification_status,
         exists (select 1 from public.hr_document_renewal_requests rr where rr.document_id = d.id and rr.status = 'open')
  from public.hr_documents d
  join public.hr_document_categories c on c.id = d.category_id
  join public.hr_employees e on e.id = d.employee_id and e.status not in ('exited','archived')
  cross join lateral (values ('expiry', d.expiry_date), ('renewal', d.renewal_date)) ev(event, due_date)
  where d.archived_at is null and d.verification_status <> 'replaced' and ev.due_date is not null
    and (ev.event = 'expiry' or coalesce(d.contract_status, '') not in ('renewed','terminated'))
    and ev.due_date <= v_today + greatest(coalesce(p_days, 60), 0)
    and hr_private.document_can_read(d.id)
  order by ev.due_date, e.employee_code;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function
  hr_private.doc_settings(), hr_private.doc_immutable(), hr_private.doc_int_array(jsonb), hr_private.doc_jtext(jsonb, text, int), hr_private.doc_juuid(jsonb, text),
  hr_private.doc_jdate(jsonb, text), hr_private.doc_fmt_date(date), hr_private.doc_employee_name(uuid),
  hr_private.doc_expiry_status(date, text, date, int), hr_private.documents_before_insert(), hr_private.documents_review_history(),
  hr_private.doc_placeholders(), hr_private.doc_check_template(text, text), hr_private.doc_render(text, jsonb, boolean),
  hr_private.doc_missing(text, jsonb), hr_private.doc_merge_data(uuid, jsonb, text, boolean), hr_private.policy_versions_guard(),
  hr_private.policy_targets(uuid), hr_private.policy_includes(uuid, uuid), hr_private.policy_can_read(uuid),
  hr_private.policy_version_can_read(uuid), hr_private.document_version_fulfils_renewal(), hr_private.policy_object_can_upload(text),
  hr_private.policy_object_readable(text), hr_private.document_object_uploaded(), hr_private.doc_apply_details(uuid, jsonb),
  hr_private.doc_supersede(uuid, uuid), hr_private.doc_letter_reference(public.hr_document_templates, uuid, int),
  hr_private.doc_current_letter(uuid, uuid), hr_private.doc_filtered(jsonb), hr_private.pending_acknowledgements(uuid)
from anon, public;
-- Helpers referenced by RLS / storage policies must be executable by the API roles.
grant execute on function
  hr_private.policy_can_read(uuid), hr_private.policy_version_can_read(uuid), hr_private.policy_targets(uuid),
  hr_private.policy_includes(uuid, uuid), hr_private.policy_object_can_upload(text), hr_private.policy_object_readable(text)
to authenticated, service_role;

revoke execute on function
  public.hr_document_settings(), public.hr_save_document_settings(jsonb), public.hr_set_category_reminder_days(uuid, int[]),
  public.hr_set_document_details(uuid, jsonb),
  public.hr_register_document_upload_ex(uuid, text, text, text, text, bigint, date, jsonb),
  public.hr_review_document(uuid, boolean, text, text), public.hr_request_document_renewal(uuid, text, date),
  public.hr_cancel_document_renewal(uuid), public.hr_renew_contract(uuid, text, text, bigint, date, jsonb, text),
  public.hr_register_document_attachment(uuid, text, text, text, bigint),
  public.hr_save_document_template(uuid, jsonb), public.hr_set_document_template_status(uuid, text),
  public.hr_preview_document_letter(uuid, uuid, jsonb, boolean), public.hr_issue_document_letter(uuid, uuid, jsonb),
  public.hr_register_letter_file(uuid, bigint, text), public.hr_pending_letter(uuid),
  public.hr_offer_letters_for_documents(), public.hr_file_offer_letter(uuid),
  public.hr_search_documents(jsonb, int, int), public.hr_documents_overview(jsonb),
  public.hr_save_policy(uuid, jsonb), public.hr_register_policy_file(uuid, text, text, bigint), public.hr_publish_policy(uuid, text),
  public.hr_archive_policy(uuid), public.hr_discard_policy_draft(uuid),
  public.hr_acknowledge_policy(uuid), public.hr_acknowledge_document(uuid), public.hr_my_pending_acknowledgements(),
  public.hr_acknowledgement_tracker(jsonb), public.hr_send_acknowledgement_reminders(uuid, uuid, uuid),
  public.hr_run_document_reminders(date, text), public.hr_document_reminder_schedule(int)
from anon, public;
grant execute on function
  public.hr_document_settings(), public.hr_save_document_settings(jsonb), public.hr_set_category_reminder_days(uuid, int[]),
  public.hr_set_document_details(uuid, jsonb),
  public.hr_register_document_upload_ex(uuid, text, text, text, text, bigint, date, jsonb),
  public.hr_review_document(uuid, boolean, text, text), public.hr_request_document_renewal(uuid, text, date),
  public.hr_cancel_document_renewal(uuid), public.hr_renew_contract(uuid, text, text, bigint, date, jsonb, text),
  public.hr_register_document_attachment(uuid, text, text, text, bigint),
  public.hr_save_document_template(uuid, jsonb), public.hr_set_document_template_status(uuid, text),
  public.hr_preview_document_letter(uuid, uuid, jsonb, boolean), public.hr_issue_document_letter(uuid, uuid, jsonb),
  public.hr_register_letter_file(uuid, bigint, text), public.hr_pending_letter(uuid),
  public.hr_offer_letters_for_documents(), public.hr_file_offer_letter(uuid),
  public.hr_search_documents(jsonb, int, int), public.hr_documents_overview(jsonb),
  public.hr_save_policy(uuid, jsonb), public.hr_register_policy_file(uuid, text, text, bigint), public.hr_publish_policy(uuid, text),
  public.hr_archive_policy(uuid), public.hr_discard_policy_draft(uuid),
  public.hr_acknowledge_policy(uuid), public.hr_acknowledge_document(uuid), public.hr_my_pending_acknowledgements(),
  public.hr_acknowledgement_tracker(jsonb), public.hr_send_acknowledgement_reminders(uuid, uuid, uuid),
  public.hr_run_document_reminders(date, text), public.hr_document_reminder_schedule(int)
to authenticated;
grant execute on function public.hr_run_document_reminders(date, text) to service_role;

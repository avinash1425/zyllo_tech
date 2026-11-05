-- =====================================================================
-- 113_hr_employee_master_org.sql — Employee Master + Org Structure
-- (AIMS ERP reference alignment, additive only)
-- =====================================================================
-- Depends on 100–112. Nothing here drops or rewrites existing data:
--   * new master data: legal entities, grades, country identity rules
--   * new nullable work-record columns on hr_employees (company, grade,
--     source department, work arrangement, contract type, notice period,
--     deployment block, optional Arabic name)
--   * new PII columns on hr_employee_private (nationality, marital status)
--   * new protected tables:
--       hr_employee_identity          national ID / passport / permit / visa
--                                     (self + employees.view_identity)
--       hr_employee_confidential      HR remarks (employees.view_sensitive)
--       hr_payroll_employee_identifiers  tax / social-security / WPS ids
--                                     (payroll only; audit hidden from HR)
--   * org units: departments gain a legal entity + unit type; department
--     hierarchy cycles are rejected (employee reporting cycles already are)
--   * identity expiry list + reminder job, identity compliance per country
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into public.hr_permissions (key, module, action, description) values
  ('employees.view_identity', 'employees', 'view_identity', 'View and (with employees.edit) maintain identity documents: national ID, passport, work permit, visa')
on conflict (key) do nothing;
insert into public.hr_role_permissions (role_key, permission_key) values
  ('super_admin', 'employees.view_identity'),
  ('hr_admin', 'employees.view_identity')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Master data: legal entities, grades, identity requirements per country
-- ---------------------------------------------------------------------
create table public.hr_legal_entities (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name                text not null unique check (length(btrim(name)) between 2 and 120),
  legal_name          text check (legal_name is null or length(legal_name) <= 200),
  country             text not null default 'IN' check (country ~ '^[A-Z]{2}$'),
  registration_number text check (registration_number is null or length(registration_number) <= 60),
  tax_number          text check (tax_number is null or length(tax_number) <= 60),
  address             text check (address is null or length(address) <= 500),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.hr_grades (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name        text not null unique check (length(btrim(name)) between 1 and 120),
  level       smallint check (level between 1 and 50),
  description text check (description is null or length(description) <= 500),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Which identity documents a country requires. "Foreign" = the employee's
-- nationality differs from the legal entity's country.
create table public.hr_identity_requirements (
  country                     text primary key check (country ~ '^[A-Z]{2}$'),
  country_name                text not null check (length(btrim(country_name)) between 2 and 80),
  national_id_types           text[] not null default '{}',
  national_id_required        boolean not null default false,
  passport_required           boolean not null default false,
  work_permit_required_foreign boolean not null default false,
  visa_required_foreign       boolean not null default false,
  expiry_reminder_days        smallint not null default 60 check (expiry_reminder_days between 1 and 365),
  notes                       text check (notes is null or length(notes) <= 1000),
  active                      boolean not null default true,
  updated_at                  timestamptz not null default now()
);
insert into public.hr_identity_requirements
  (country, country_name, national_id_types, national_id_required, passport_required, work_permit_required_foreign, visa_required_foreign, expiry_reminder_days, notes) values
  ('IN', 'India', array['PAN','Voter ID','Driving Licence','Other'], false, false, true, true, 60,
   'Do not record full Aadhaar numbers unless the organisation is legally permitted to store them. Foreign nationals need a valid visa / employment permit.'),
  ('AE', 'United Arab Emirates', array['Emirates ID'], true, true, true, true, 60,
   'Emirates ID and passport are mandatory; expatriates need a work permit (labour card) and residence visa.')
on conflict (country) do nothing;

do $$
declare t text;
begin
  foreach t in array array['hr_legal_entities','hr_grades','hr_identity_requirements'] loop
    perform hr_private.secure_table(('public.' || t)::regclass);
    execute format('create policy %I on public.%I for select to authenticated using (hr_private.current_employee_id() is not null or hr_private.has_permission(''settings.view'') or hr_private.has_permission(''employees.view''))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (hr_private.has_permission(''settings.manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (hr_private.has_permission(''settings.manage'')) with check (hr_private.has_permission(''settings.manage''))', t || '_update', t);
    execute format('create trigger %I before update on public.%I for each row execute function hr_private.touch_updated_at()', t || '_touch', t);
    perform hr_private.enable_audit(('public.' || t)::regclass);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Org units: departments belong to a legal entity and have a unit type
-- ---------------------------------------------------------------------
alter table public.hr_departments
  add column legal_entity_id uuid references public.hr_legal_entities(id) on delete restrict,
  add column unit_type text not null default 'department' check (unit_type in ('division','department','unit','team'));
create index hr_departments_parent on public.hr_departments(parent_id);
create index hr_departments_entity on public.hr_departments(legal_entity_id);

create or replace function hr_private.departments_check_cycle()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cycle boolean;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then perform hr_private.fail('A department cannot be its own parent.', 'department_cycle'); end if;
  with recursive chain(id, depth) as (
    select new.parent_id, 1
    union all
    select d.parent_id, c.depth + 1 from public.hr_departments d join chain c on d.id = c.id
    where d.parent_id is not null and c.depth < 50
  )
  select exists (select 1 from chain where id = new.id) into v_cycle;
  if v_cycle then perform hr_private.fail('This parent would create a circular organisation hierarchy.', 'department_cycle'); end if;
  return new;
end $$;
create trigger hr_departments_cycle before insert or update of parent_id on public.hr_departments
  for each row execute function hr_private.departments_check_cycle();

-- ---------------------------------------------------------------------
-- Employee work record: new nullable columns
-- ---------------------------------------------------------------------
alter table public.hr_employees
  add column legal_entity_id       uuid references public.hr_legal_entities(id) on delete restrict,
  add column grade_id              uuid references public.hr_grades(id) on delete restrict,
  add column source_department_id  uuid references public.hr_departments(id) on delete restrict,
  add column name_arabic           text check (name_arabic is null or length(btrim(name_arabic)) between 1 and 120),
  add column work_arrangement      text check (work_arrangement is null or work_arrangement in ('office','remote','hybrid')),
  add column contract_type         text check (contract_type is null or contract_type in ('permanent','fixed_term','probationary','internship','consultancy','other')),
  add column notice_period_days    smallint check (notice_period_days is null or notice_period_days between 0 and 365),
  add column deployment_status     text check (deployment_status is null or deployment_status in ('not_deployed','deployed','bench')),
  add column deployment_client     text check (deployment_client is null or length(btrim(deployment_client)) between 1 and 200),
  add column deployment_project_code text check (deployment_project_code is null or deployment_project_code ~ '^[A-Za-z0-9/_. -]{1,60}$'),
  add column deployment_start_date date,
  add column deployment_end_date   date,
  add constraint hr_employees_deployment_dates check (deployment_end_date is null or deployment_start_date is null or deployment_end_date >= deployment_start_date),
  -- A deployment needs at least the client; the block stays optional for ordinary staff.
  add constraint hr_employees_deployment_client check (deployment_status is distinct from 'deployed' or deployment_client is not null);
create index hr_employees_entity on public.hr_employees(legal_entity_id);
create index hr_employees_grade on public.hr_employees(grade_id);
create index hr_employees_location on public.hr_employees(work_location_id);

-- History: allow the new change types and capture them.
alter table public.hr_employee_history drop constraint hr_employee_history_change_type_check;
alter table public.hr_employee_history add constraint hr_employee_history_change_type_check
  check (change_type in ('created','status','department','designation','manager','employment_type','location','shift','portal_access','role','conversion','note',
                         'legal_entity','grade','work_arrangement','deployment','contract'));

create or replace function hr_private.employees_history_ext()
returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if new.legal_entity_id is distinct from old.legal_entity_id then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by)
    values (new.id, 'legal_entity', (select name from public.hr_legal_entities where id = old.legal_entity_id), (select name from public.hr_legal_entities where id = new.legal_entity_id), uid);
  end if;
  if new.grade_id is distinct from old.grade_id then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by)
    values (new.id, 'grade', (select name from public.hr_grades where id = old.grade_id), (select name from public.hr_grades where id = new.grade_id), uid);
  end if;
  if new.work_arrangement is distinct from old.work_arrangement then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by) values (new.id, 'work_arrangement', old.work_arrangement, new.work_arrangement, uid);
  end if;
  if (new.deployment_status, new.deployment_client, new.deployment_project_code) is distinct from (old.deployment_status, old.deployment_client, old.deployment_project_code) then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by)
    values (new.id, 'deployment',
            nullif(concat_ws(' · ', old.deployment_status, old.deployment_client, old.deployment_project_code), ''),
            nullif(concat_ws(' · ', new.deployment_status, new.deployment_client, new.deployment_project_code), ''), uid);
  end if;
  if (new.contract_type, new.contract_end_date, new.notice_period_days) is distinct from (old.contract_type, old.contract_end_date, old.notice_period_days) then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by)
    values (new.id, 'contract',
            nullif(concat_ws(' · ', old.contract_type, old.contract_end_date::text, old.notice_period_days || ' days notice'), ''),
            nullif(concat_ws(' · ', new.contract_type, new.contract_end_date::text, new.notice_period_days || ' days notice'), ''), uid);
  end if;
  return new;
end $$;
create trigger hr_employees_history_ext after update on public.hr_employees
  for each row execute function hr_private.employees_history_ext();

-- ---------------------------------------------------------------------
-- Personal (PII): nationality + marital status
-- ---------------------------------------------------------------------
alter table public.hr_employee_private
  add column nationality    text check (nationality is null or nationality ~ '^[A-Z]{2}$'),
  add column marital_status text check (marital_status is null or marital_status in ('single','married','divorced','widowed','separated','prefer_not_to_say'));

-- ---------------------------------------------------------------------
-- Identity documents (strictly protected PII)
-- ---------------------------------------------------------------------
create table public.hr_employee_identity (
  employee_id         uuid primary key references public.hr_employees(id) on delete cascade,
  national_id_type    text check (national_id_type is null or length(btrim(national_id_type)) between 2 and 60),
  national_id_number  text check (national_id_number is null or national_id_number ~ '^[A-Za-z0-9 -]{4,40}$'),
  national_id_expiry  date,
  passport_number     text check (passport_number is null or passport_number ~ '^[A-Za-z0-9]{5,20}$'),
  passport_country    text check (passport_country is null or passport_country ~ '^[A-Z]{2}$'),
  passport_issue_date date,
  passport_expiry     date,
  work_permit_type    text check (work_permit_type is null or length(btrim(work_permit_type)) between 2 and 60),
  work_permit_number  text check (work_permit_number is null or work_permit_number ~ '^[A-Za-z0-9/ -]{3,40}$'),
  work_permit_expiry  date,
  visa_type           text check (visa_type is null or length(btrim(visa_type)) between 2 and 60),
  visa_number         text check (visa_number is null or visa_number ~ '^[A-Za-z0-9/ -]{3,40}$'),
  visa_expiry         date,
  updated_by          uuid,
  updated_at          timestamptz not null default now(),
  check (passport_expiry is null or passport_issue_date is null or passport_expiry > passport_issue_date),
  check (national_id_number is null or national_id_type is not null)
);
-- Uniqueness: one person per passport / national ID.
create unique index hr_employee_identity_passport on public.hr_employee_identity (upper(passport_number)) where passport_number is not null;
create unique index hr_employee_identity_national on public.hr_employee_identity (lower(national_id_type), upper(regexp_replace(national_id_number, '[ -]', '', 'g'))) where national_id_number is not null;

select hr_private.secure_table('public.hr_employee_identity');
select hr_private.enable_audit('public.hr_employee_identity', array['national_id_number','passport_number','work_permit_number','visa_number']);
create or replace function hr_private.identity_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.passport_number := upper(nullif(btrim(new.passport_number), ''));
  return new;
end $$;
create trigger hr_employee_identity_before before insert or update on public.hr_employee_identity
  for each row execute function hr_private.identity_before_write();
create policy hr_employee_identity_read on public.hr_employee_identity for select to authenticated
  using (employee_id = hr_private.current_employee_id() or hr_private.has_permission('employees.view_identity'));
create policy hr_employee_identity_insert on public.hr_employee_identity for insert to authenticated
  with check (hr_private.has_permission('employees.view_identity') and hr_private.has_permission('employees.edit'));
create policy hr_employee_identity_update on public.hr_employee_identity for update to authenticated
  using (hr_private.has_permission('employees.view_identity') and hr_private.has_permission('employees.edit'))
  with check (hr_private.has_permission('employees.view_identity') and hr_private.has_permission('employees.edit'));

-- ---------------------------------------------------------------------
-- HR-only remarks (never visible to the employee or their manager)
-- ---------------------------------------------------------------------
create table public.hr_employee_confidential (
  employee_id uuid primary key references public.hr_employees(id) on delete cascade,
  remarks     text check (remarks is null or length(remarks) <= 4000),
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
select hr_private.secure_table('public.hr_employee_confidential');
select hr_private.enable_audit('public.hr_employee_confidential');
create or replace function hr_private.confidential_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger hr_employee_confidential_before before insert or update on public.hr_employee_confidential
  for each row execute function hr_private.confidential_before_write();
create policy hr_employee_confidential_read on public.hr_employee_confidential for select to authenticated
  using (hr_private.has_permission('employees.view_sensitive'));
create policy hr_employee_confidential_insert on public.hr_employee_confidential for insert to authenticated
  with check (hr_private.has_permission('employees.view_sensitive') and hr_private.has_permission('employees.edit'));
create policy hr_employee_confidential_update on public.hr_employee_confidential for update to authenticated
  using (hr_private.has_permission('employees.view_sensitive') and hr_private.has_permission('employees.edit'))
  with check (hr_private.has_permission('employees.view_sensitive') and hr_private.has_permission('employees.edit'));

-- ---------------------------------------------------------------------
-- Banking & payroll identifiers (payroll only)
-- ---------------------------------------------------------------------
alter table public.hr_employee_bank_accounts
  add column iban       text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  add column swift_code text check (swift_code is null or swift_code ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  add column branch     text check (branch is null or length(branch) <= 120);
-- Redact the IBAN in audit rows as well (re-create the trigger with the wider list).
select hr_private.enable_audit('public.hr_employee_bank_accounts', array['account_number','iban']);

-- Named hr_payroll_* so its audit rows are hidden from non-payroll auditors.
create table public.hr_payroll_employee_identifiers (
  employee_id            uuid primary key references public.hr_employees(id) on delete cascade,
  payment_mode           text not null default 'bank_transfer' check (payment_mode in ('bank_transfer','wps','cheque','cash')),
  tax_id                 text check (tax_id is null or tax_id ~ '^[A-Za-z0-9/-]{4,30}$'),
  social_security_number text check (social_security_number is null or social_security_number ~ '^[A-Za-z0-9/-]{4,30}$'),
  pension_number         text check (pension_number is null or pension_number ~ '^[A-Za-z0-9/-]{4,30}$'),
  health_insurance_number text check (health_insurance_number is null or health_insurance_number ~ '^[A-Za-z0-9/-]{4,30}$'),
  wps_person_id          text check (wps_person_id is null or wps_person_id ~ '^[A-Za-z0-9-]{4,30}$'),
  payroll_code           text check (payroll_code is null or payroll_code ~ '^[A-Za-z0-9/_-]{1,30}$'),
  updated_by             uuid,
  updated_at             timestamptz not null default now()
);
create unique index hr_payroll_employee_identifiers_tax on public.hr_payroll_employee_identifiers (upper(tax_id)) where tax_id is not null;
select hr_private.secure_table('public.hr_payroll_employee_identifiers');
select hr_private.enable_audit('public.hr_payroll_employee_identifiers', array['tax_id','social_security_number','pension_number','health_insurance_number','wps_person_id']);
create trigger hr_payroll_employee_identifiers_before before insert or update on public.hr_payroll_employee_identifiers
  for each row execute function hr_private.confidential_before_write();
create policy hr_payroll_employee_identifiers_read on public.hr_payroll_employee_identifiers for select to authenticated
  using (hr_private.has_permission('payroll.view'));
create policy hr_payroll_employee_identifiers_insert on public.hr_payroll_employee_identifiers for insert to authenticated
  with check (hr_private.has_permission('payroll.manage'));
create policy hr_payroll_employee_identifiers_update on public.hr_payroll_employee_identifiers for update to authenticated
  using (hr_private.has_permission('payroll.manage')) with check (hr_private.has_permission('payroll.manage'));

-- ---------------------------------------------------------------------
-- Identity document categories for attachments (existing Documents module)
-- ---------------------------------------------------------------------
insert into public.hr_document_categories
  (code, name, description, requires_expiry, employee_can_upload, employee_can_view, is_confidential, checklist_required, sort_order) values
  ('passport',    'Passport',              'Passport bio page',                        true, true, true, false, false, 10),
  ('work_permit', 'Work permit / labour card', 'Work authorisation issued by the authority', true, true, true, false, false, 11),
  ('visa',        'Visa / residence permit', 'Visa or residence permit page',          true, true, true, false, false, 12),
  ('national_id', 'National ID card',      'National identity card (where lawful)',     false, true, true, false, false, 13)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Identity: expiring items + compliance per country rules
-- ---------------------------------------------------------------------
-- The country whose rules apply: the employee's legal entity, else the company default.
create or replace function hr_private.employee_country(p_employee uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(le.country, upper(coalesce(hr_private.setting('company') ->> 'country', 'IN')))
  from public.hr_employees e left join public.hr_legal_entities le on le.id = e.legal_entity_id
  where e.id = p_employee
$$;

-- Expiring identity items. SECURITY INVOKER: RLS on hr_employee_identity limits
-- rows to the caller's own record unless they hold employees.view_identity.
create or replace function public.hr_expiring_identity_documents(p_days int default 60)
returns table (employee_id uuid, employee_code text, employee_name text, document text, number_last4 text, expiry_date date, days_left int)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), x.doc,
         right(x.num, 4), x.exp, (x.exp - hr_private.business_today())::int
  from public.hr_employee_identity i
  join public.hr_employees e on e.id = i.employee_id
  cross join lateral (values ('Passport', i.passport_number, i.passport_expiry),
                             ('Work permit', i.work_permit_number, i.work_permit_expiry),
                             ('Visa', i.visa_number, i.visa_expiry),
                             (coalesce(i.national_id_type, 'National ID'), i.national_id_number, i.national_id_expiry)) x(doc, num, exp)
  where x.exp is not null and x.exp <= hr_private.business_today() + greatest(coalesce(p_days, 60), 0)
    and e.status not in ('exited','archived')
  order by x.exp, 3
$$;

-- Missing identity items required by the employee's country rules.
create or replace function hr_private.identity_missing(p_employee uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_remove(array[
    case when r.national_id_required and i.national_id_number is null then 'National ID' end,
    case when r.passport_required and i.passport_number is null then 'Passport' end,
    case when r.work_permit_required_foreign and p.nationality is not null and p.nationality <> r.country and i.work_permit_number is null then 'Work permit' end,
    case when r.visa_required_foreign and p.nationality is not null and p.nationality <> r.country and i.visa_number is null then 'Visa' end,
    case when i.passport_expiry < hr_private.business_today() then 'Passport expired' end,
    case when i.work_permit_expiry < hr_private.business_today() then 'Work permit expired' end,
    case when i.visa_expiry < hr_private.business_today() then 'Visa expired' end
  ], null), '{}')
  from public.hr_employees e
  left join public.hr_identity_requirements r on r.country = hr_private.employee_country(e.id) and r.active
  left join public.hr_employee_identity i on i.employee_id = e.id
  left join public.hr_employee_private p on p.employee_id = e.id
  where e.id = p_employee
$$;

create table public.hr_identity_expiry_reminders (
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  document    text not null,
  expiry_date date not null,
  sent_at     timestamptz not null default now(),
  primary key (employee_id, document, expiry_date)
);
select hr_private.secure_table('public.hr_identity_expiry_reminders');
create policy hr_identity_expiry_reminders_read on public.hr_identity_expiry_reminders for select to authenticated
  using (hr_private.has_permission('employees.view_identity'));

-- Daily job (service role or an identity officer): one reminder per item and expiry date.
create or replace function public.hr_generate_identity_expiry_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0; v_today date := hr_private.business_today(); v_staff uuid;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or hr_private.has_permission('employees.view_identity')) then
    perform hr_private.fail('You are not allowed to run identity reminders.', 'forbidden');
  end if;
  for r in
    select i.employee_id, x.doc, x.exp, e.employee_code
    from public.hr_employee_identity i
    join public.hr_employees e on e.id = i.employee_id
    left join public.hr_identity_requirements q on q.country = hr_private.employee_country(e.id)
    cross join lateral (values ('Passport', i.passport_expiry), ('Work permit', i.work_permit_expiry),
                               ('Visa', i.visa_expiry), (coalesce(i.national_id_type, 'National ID'), i.national_id_expiry)) x(doc, exp)
    where x.exp is not null and x.exp <= v_today + coalesce(q.expiry_reminder_days, 60)
      and e.status not in ('exited','archived')
      and not exists (select 1 from public.hr_identity_expiry_reminders m where m.employee_id = i.employee_id and m.document = x.doc and m.expiry_date = x.exp)
  loop
    insert into public.hr_identity_expiry_reminders (employee_id, document, expiry_date) values (r.employee_id, r.doc, r.exp);
    perform hr_private.notify_employee(r.employee_id, 'identity_expiry',
      case when r.exp < v_today then r.doc || ' expired' else r.doc || ' expiring soon' end,
      'Your ' || lower(r.doc) || ' expires on ' || to_char(r.exp, 'DD Mon YYYY') || '. Please share the renewed document with HR.',
      '/employee/documents', 'hr_employee_identity', r.employee_id::text);
    -- Identity officers (employees.view_identity), never the document number.
    for v_staff in
      select distinct ur.user_id from public.hr_user_roles ur
      join public.hr_employees s on s.user_id = ur.user_id and s.portal_access and s.status not in ('exited','archived','suspended')
      where ur.role_key = 'super_admin'
         or exists (select 1 from public.hr_role_permissions rp where rp.role_key = ur.role_key and rp.permission_key = 'employees.view_identity')
    loop
      perform hr_private.notify_user(v_staff, 'identity_expiry', r.doc || ' expiry: ' || r.employee_code,
        r.doc || ' of ' || r.employee_code || ' expires on ' || to_char(r.exp, 'DD Mon YYYY') || '.',
        '/hr/employees/' || r.employee_id::text, 'hr_employee_identity', r.employee_id::text);
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Identity compliance for one employee (for the profile page).
create or replace function public.hr_employee_identity_status(p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_employee = hr_private.current_employee_id() or hr_private.has_permission('employees.view_identity')) then
    perform hr_private.fail('You are not allowed to view identity compliance for this employee.', 'forbidden');
  end if;
  return jsonb_build_object('country', hr_private.employee_country(p_employee), 'missing', to_jsonb(hr_private.identity_missing(p_employee)));
end $$;

revoke execute on function public.hr_expiring_identity_documents(int), public.hr_generate_identity_expiry_reminders(),
  public.hr_employee_identity_status(uuid) from anon, public;
grant execute on function public.hr_expiring_identity_documents(int), public.hr_generate_identity_expiry_reminders(),
  public.hr_employee_identity_status(uuid) to authenticated;
grant execute on function public.hr_generate_identity_expiry_reminders() to service_role;
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

-- ---------------------------------------------------------------------
-- Employee self-view: the employee's own profile now shows the work-record
-- fields through the existing hr_employees RLS (self row). Self-service
-- contact edits continue through hr_update_my_contact(); nationality,
-- marital status and identity numbers are maintained by HR.
-- ---------------------------------------------------------------------

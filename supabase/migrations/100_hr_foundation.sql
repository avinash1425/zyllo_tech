-- =====================================================================
-- 100_hr_foundation.sql — HRMS security + data foundation
-- =====================================================================
-- Single authoritative HR store on Supabase (see docs/hrms/ARCHITECTURE.md).
-- Provides: settings, org structure (departments, designations, employment
-- types, locations, shifts), roles & permissions, employees (+ private
-- PII split), employment history, audit log, notifications, email outbox,
-- and the hr_private helper functions every later module uses.
--
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------
-- Private helper schema (NOT exposed through the Data API)
-- ---------------------------------------------------------------------
create schema if not exists hr_private;
revoke all on schema hr_private from public;
grant usage on schema hr_private to authenticated, service_role;
-- Functions created later in hr_private are NOT executable by PUBLIC by default.
alter default privileges in schema hr_private revoke execute on functions from public;
alter default privileges in schema hr_private grant execute on functions to authenticated, service_role;

-- updated_at maintenance
create or replace function hr_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Enable RLS and remove anon access on an HR table (defence in depth:
-- Supabase grants table privileges to anon by default).
create or replace function hr_private.secure_table(p_table regclass)
returns void language plpgsql set search_path = '' as $$
begin
  -- Not FORCE: SECURITY DEFINER helpers run as the table owner and must
  -- bypass RLS, otherwise policies that call them recurse.
  execute format('alter table %s enable row level security', p_table);
  execute format('revoke all on table %s from anon', p_table);
  execute format('revoke all on table %s from public', p_table);
end $$;

-- Standard error helper so the frontend can show a clean message.
create or replace function hr_private.fail(p_message text, p_code text default 'hr_error')
returns void language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end $$;

-- ---------------------------------------------------------------------
-- Settings (key/value, admin-managed)
-- ---------------------------------------------------------------------
create table public.hr_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
select hr_private.secure_table('public.hr_settings');
create trigger hr_settings_touch before update on public.hr_settings
  for each row execute function hr_private.touch_updated_at();

insert into public.hr_settings (key, value, description) values
  ('company', jsonb_build_object(
      'name', 'Zyllo Tech',
      'legal_name', 'Zyllo Tech Software Solutions Private Limited',
      'country', 'IN',
      'timezone', 'Asia/Kolkata',
      'currency', 'INR',
      'working_days', jsonb_build_array(1,2,3,4,5),   -- ISO day of week, 1 = Monday
      'fiscal_year_start_month', 4),
   'Company profile, business timezone and default working week'),
  ('employee_id', jsonb_build_object('prefix', 'ZT', 'separator', '-', 'padding', 4),
   'Employee ID format: <prefix><separator><zero-padded sequence>'),
  ('audit', jsonb_build_object('retention_days', 2555),
   'Audit log retention (days). Purging is a manual, approved operation.');

-- Business timezone and "today" in that timezone.
create or replace function hr_private.business_timezone()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select value ->> 'timezone' from public.hr_settings where key = 'company'), 'Asia/Kolkata')
$$;

create or replace function hr_private.business_today()
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone hr_private.business_timezone())::date
$$;

create or replace function hr_private.setting(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.hr_settings where key = p_key
$$;

-- ---------------------------------------------------------------------
-- Organisation structure
-- ---------------------------------------------------------------------
create table public.hr_departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name        text not null unique check (length(btrim(name)) between 2 and 120),
  parent_id   uuid references public.hr_departments(id) on delete restrict,
  head_employee_id uuid,               -- FK added after hr_employees exists
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.hr_designations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique check (length(btrim(name)) between 2 and 120),
  department_id uuid references public.hr_departments(id) on delete set null,
  level         smallint check (level between 1 and 20),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.hr_employment_types (
  code            text primary key check (code ~ '^[a-z_]{2,30}$'),
  name            text not null unique,
  probation_months smallint not null default 0 check (probation_months between 0 and 24),
  is_intern       boolean not null default false,
  active          boolean not null default true,
  sort_order      smallint not null default 0
);
insert into public.hr_employment_types (code, name, probation_months, is_intern, sort_order) values
  ('full_time',  'Full-time',  6, false, 1),
  ('part_time',  'Part-time',  3, false, 2),
  ('contract',   'Contract',   0, false, 3),
  ('intern',     'Intern',     0, true,  4),
  ('consultant', 'Consultant', 0, false, 5);

create table public.hr_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  address    text,
  city       text,
  timezone   text not null default 'Asia/Kolkata',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hr_shifts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  start_time      time not null,
  end_time        time not null,
  grace_minutes   smallint not null default 10 check (grace_minutes between 0 and 240),
  break_minutes   smallint not null default 60 check (break_minutes between 0 and 480),
  early_leave_grace_minutes smallint not null default 10 check (early_leave_grace_minutes between 0 and 240),
  overtime_after_minutes smallint check (overtime_after_minutes between 0 and 1440),
  working_days    smallint[] not null default '{1,2,3,4,5}',
  is_default      boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (start_time <> end_time),
  check (working_days <@ array[1,2,3,4,5,6,7]::smallint[])
);
create unique index hr_shifts_one_default on public.hr_shifts (is_default) where is_default;

-- ---------------------------------------------------------------------
-- Roles & permissions (configurable, least privilege)
-- ---------------------------------------------------------------------
create table public.hr_roles (
  key         text primary key check (key ~ '^[a-z][a-z_]{1,40}$'),
  name        text not null unique,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.hr_permissions (
  key         text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module      text not null,
  action      text not null,
  description text not null
);

create table public.hr_role_permissions (
  role_key       text not null references public.hr_roles(key) on delete cascade,
  permission_key text not null references public.hr_permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

create table public.hr_user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role_key   text not null references public.hr_roles(key) on delete restrict,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_key)
);
create index hr_user_roles_role on public.hr_user_roles(role_key);

insert into public.hr_roles (key, name, description, is_system) values
  ('super_admin',   'Super Admin',     'Full access to every HR module, settings, roles and payroll.', true),
  ('hr_admin',      'HR Admin',        'Manages people operations. No payroll salary data unless also Payroll Admin.', true),
  ('payroll_admin', 'Payroll Admin',   'Prepares, reviews and finalizes payroll. Separate from ordinary HR access.', true),
  ('manager',       'Manager / Team Lead', 'Sees and approves records of their reporting line only.', true),
  ('employee',      'Employee',        'Self-service access to own records.', true),
  ('intern',        'Intern',          'Self-service access to own records.', true);

-- Permission catalogue. Self-service access to one's OWN records needs no
-- permission (RLS checks ownership). "view" = all employees,
-- "view_team" = caller's reporting line only.
insert into public.hr_permissions (key, module, action, description) values
  ('dashboard.view',           'dashboard', 'view', 'Company-wide HR dashboard'),
  ('dashboard.view_team',      'dashboard', 'view_team', 'Team dashboard'),
  ('employees.view',           'employees', 'view', 'View all employee records'),
  ('employees.view_team',      'employees', 'view_team', 'View own team members'),
  ('employees.view_sensitive', 'employees', 'view_sensitive', 'View personal/PII fields (DOB, address, personal contact)'),
  ('employees.create',         'employees', 'create', 'Create employees'),
  ('employees.edit',           'employees', 'edit', 'Edit employees, transfers, manager changes'),
  ('employees.archive',        'employees', 'archive', 'Deactivate / archive employees'),
  ('employees.invite',         'employees', 'invite', 'Send portal invitations / toggle portal access'),
  ('employees.import',         'employees', 'import', 'Bulk import employees'),
  ('employees.export',         'employees', 'export', 'Export employee data'),
  ('attendance.view',          'attendance', 'view', 'View all attendance'),
  ('attendance.view_team',     'attendance', 'view_team', 'View team attendance'),
  ('attendance.approve',       'attendance', 'approve', 'Approve/reject any attendance correction'),
  ('attendance.approve_team',  'attendance', 'approve_team', 'Approve/reject team attendance corrections'),
  ('attendance.manage',        'attendance', 'manage', 'Manage shifts, exceptions and manual entries'),
  ('attendance.export',        'attendance', 'export', 'Export attendance'),
  ('daily_reports.view',       'daily_reports', 'view', 'View all daily reports'),
  ('daily_reports.view_team',  'daily_reports', 'view_team', 'View team daily reports'),
  ('daily_reports.review',     'daily_reports', 'review', 'Review any daily report'),
  ('daily_reports.review_team','daily_reports', 'review_team', 'Review team daily reports'),
  ('daily_reports.export',     'daily_reports', 'export', 'Export daily reports'),
  ('daily_reports.manage',     'daily_reports', 'manage', 'Manage projects, tasks and reminder schedules'),
  ('leave.view',               'leave', 'view', 'View all leave'),
  ('leave.view_team',          'leave', 'view_team', 'View team leave'),
  ('leave.approve',            'leave', 'approve', 'Decide any leave request (HR level)'),
  ('leave.approve_team',       'leave', 'approve_team', 'Decide team leave requests (manager level)'),
  ('leave.adjust',             'leave', 'adjust', 'Adjust leave balances'),
  ('leave.manage',             'leave', 'manage', 'Manage leave types, policies and holidays'),
  ('leave.export',             'leave', 'export', 'Export leave data'),
  ('recruitment.view',         'recruitment', 'view', 'View recruitment pipeline and candidates'),
  ('recruitment.manage',       'recruitment', 'manage', 'Manage openings, candidates, interviews and offers'),
  ('recruitment.convert',      'recruitment', 'convert', 'Convert candidate/intern to employee'),
  ('recruitment.export',       'recruitment', 'export', 'Export recruitment data'),
  ('interns.view',             'interns', 'view', 'View all intern programmes'),
  ('interns.view_team',        'interns', 'view_team', 'View mentored interns'),
  ('interns.manage',           'interns', 'manage', 'Manage internships and evaluations'),
  ('payroll.view',             'payroll', 'view', 'View salary, payroll runs and payslips'),
  ('payroll.manage',           'payroll', 'manage', 'Edit salary structures, components and draft runs'),
  ('payroll.approve',          'payroll', 'approve', 'Approve and finalize payroll runs'),
  ('payroll.export',           'payroll', 'export', 'Export payroll data'),
  ('performance.view',         'performance', 'view', 'View all performance records'),
  ('performance.view_team',    'performance', 'view_team', 'View team performance'),
  ('performance.review_team',  'performance', 'review_team', 'Write manager assessments for team'),
  ('performance.manage',       'performance', 'manage', 'Manage cycles, KPIs and finalize reviews'),
  ('documents.view',           'documents', 'view', 'View all employee documents'),
  ('documents.view_team',      'documents', 'view_team', 'View team documents (non-confidential categories)'),
  ('documents.manage',         'documents', 'manage', 'Upload, verify and manage documents'),
  ('announcements.manage',     'announcements', 'manage', 'Create, publish and archive announcements'),
  ('assets.view',              'assets', 'view', 'View asset inventory and assignments'),
  ('assets.manage',            'assets', 'manage', 'Manage assets and assignments'),
  ('reports.view',             'reports', 'view', 'Run company-wide HR reports'),
  ('reports.view_team',        'reports', 'view_team', 'Run team reports'),
  ('reports.export',           'reports', 'export', 'Export reports'),
  ('exit.view',                'exit', 'view', 'View all exit cases'),
  ('exit.view_team',           'exit', 'view_team', 'View team exit cases'),
  ('exit.approve_team',        'exit', 'approve_team', 'Manager review of team resignations'),
  ('exit.manage',              'exit', 'manage', 'HR review, clearance and closure of exits'),
  ('hr_requests.view',         'hr_requests', 'view', 'View all HR requests'),
  ('hr_requests.manage',       'hr_requests', 'manage', 'Respond to and resolve HR requests'),
  ('announcements.view_all',   'announcements', 'view_all', 'View every announcement regardless of audience'),
  ('settings.view',            'settings', 'view', 'View HR settings'),
  ('settings.manage',          'settings', 'manage', 'Change HR settings and master data'),
  ('roles.manage',             'roles', 'manage', 'Assign roles and edit role permissions'),
  ('audit.view',               'audit', 'view', 'View the audit log');

-- Role grants (super_admin passes every check in has_permission()).
insert into public.hr_role_permissions (role_key, permission_key)
select 'super_admin', key from public.hr_permissions;

insert into public.hr_role_permissions (role_key, permission_key)
select 'hr_admin', key from public.hr_permissions
where module not in ('payroll', 'roles')
  and key not in ('audit.view');            -- audit stays with super admins by default
insert into public.hr_role_permissions values ('hr_admin', 'audit.view');

insert into public.hr_role_permissions (role_key, permission_key)
select 'payroll_admin', key from public.hr_permissions
where module = 'payroll' or key in ('employees.view', 'reports.view', 'reports.export', 'attendance.view', 'leave.view');

insert into public.hr_role_permissions (role_key, permission_key)
select 'manager', key from public.hr_permissions
where key in ('dashboard.view_team', 'employees.view_team', 'attendance.view_team', 'attendance.approve_team',
              'daily_reports.view_team', 'daily_reports.review_team', 'leave.view_team', 'leave.approve_team',
              'interns.view_team', 'performance.view_team', 'performance.review_team', 'documents.view_team',
              'reports.view_team', 'exit.view_team', 'exit.approve_team');
-- employee / intern: self-service only, no catalogue permissions.

-- ---------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------
create sequence public.hr_employee_code_seq start 1;

create table public.hr_employees (
  id                  uuid primary key default gen_random_uuid(),
  employee_code       text not null unique,
  user_id             uuid unique references auth.users(id) on delete set null,
  first_name          text not null check (length(btrim(first_name)) between 1 and 80),
  last_name           text not null default '' check (length(last_name) <= 80),
  display_name        text check (length(display_name) <= 120),
  photo_path          text,
  company_email       citext unique check (company_email is null or company_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  department_id       uuid references public.hr_departments(id) on delete restrict,
  designation_id      uuid references public.hr_designations(id) on delete restrict,
  manager_id          uuid references public.hr_employees(id) on delete set null,
  employment_type     text not null default 'full_time' references public.hr_employment_types(code),
  joining_date        date,
  probation_end_date  date,
  work_location_id    uuid references public.hr_locations(id) on delete restrict,
  shift_id            uuid references public.hr_shifts(id) on delete restrict,
  status              text not null default 'onboarding'
                      check (status in ('onboarding','probation','active','notice_period','suspended','exited','archived')),
  contract_start_date date,
  contract_end_date   date,
  resignation_date    date,
  last_working_date   date,
  portal_access       boolean not null default false,
  invited_at          timestamptz,
  activated_at        timestamptz,
  source              text not null default 'manual' check (source in ('manual','import','candidate','intern_conversion')),
  source_ref          uuid,          -- candidate / internship id for conversions
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  check (manager_id is null or manager_id <> id),
  check (probation_end_date is null or joining_date is null or probation_end_date >= joining_date),
  check (contract_end_date is null or contract_start_date is null or contract_end_date >= contract_start_date),
  check (last_working_date is null or resignation_date is null or last_working_date >= resignation_date)
);
create index hr_employees_department on public.hr_employees(department_id);
create index hr_employees_manager on public.hr_employees(manager_id);
create index hr_employees_status on public.hr_employees(status);
create index hr_employees_type on public.hr_employees(employment_type);
create unique index hr_employees_source_ref on public.hr_employees(source, source_ref) where source_ref is not null;
create index hr_employees_name_search on public.hr_employees using gin (to_tsvector('simple', coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(display_name,'') || ' ' || employee_code));

alter table public.hr_departments
  add constraint hr_departments_head_fk foreign key (head_employee_id) references public.hr_employees(id) on delete set null;

-- Personal / PII fields, separately protected.
create table public.hr_employee_private (
  employee_id        uuid primary key references public.hr_employees(id) on delete cascade,
  date_of_birth      date check (date_of_birth is null or date_of_birth between date '1930-01-01' and current_date),
  gender             text check (gender is null or gender in ('female','male','non_binary','prefer_not_to_say','other')),
  personal_email     citext check (personal_email is null or personal_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text check (phone is null or phone ~ '^[+0-9 ()-]{7,20}$'),
  address_line1      text,
  address_line2      text,
  city               text,
  state              text,
  postal_code        text,
  country            text default 'IN',
  emergency_contact_name     text,
  emergency_contact_relation text,
  emergency_contact_phone    text check (emergency_contact_phone is null or emergency_contact_phone ~ '^[+0-9 ()-]{7,20}$'),
  updated_at         timestamptz not null default now()
);

create table public.hr_employee_history (
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references public.hr_employees(id) on delete cascade,
  change_type  text not null check (change_type in ('created','status','department','designation','manager','employment_type','location','shift','portal_access','role','conversion','note')),
  old_value    text,
  new_value    text,
  effective_date date not null default current_date,
  note         text,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);
create index hr_employee_history_emp on public.hr_employee_history(employee_id, changed_at desc);

-- Employee code generation (unique, never reused).
create or replace function hr_private.next_employee_code()
returns text language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := coalesce(hr_private.setting('employee_id'), '{}'::jsonb);
  v_prefix text := coalesce(cfg ->> 'prefix', 'ZT');
  v_sep text := coalesce(cfg ->> 'separator', '-');
  v_pad int := greatest(3, least(8, coalesce((cfg ->> 'padding')::int, 4)));
  v_code text;
begin
  loop
    v_code := v_prefix || v_sep || lpad(nextval('public.hr_employee_code_seq')::text, v_pad, '0');
    exit when not exists (select 1 from public.hr_employees where employee_code = v_code);
  end loop;
  return v_code;
end $$;

create or replace function hr_private.employees_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Codes are always system generated; a client cannot choose one.
    new.employee_code := hr_private.next_employee_code();
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.probation_end_date is null and new.joining_date is not null then
      select case when et.probation_months > 0 then (new.joining_date + make_interval(months => et.probation_months))::date end
        into new.probation_end_date
        from public.hr_employment_types et where et.code = new.employment_type;
    end if;
  else
    if new.employee_code is distinct from old.employee_code then
      perform hr_private.fail('Employee ID cannot be changed.', 'immutable_employee_code');
    end if;
    if new.user_id is distinct from old.user_id and old.user_id is not null and new.user_id is not null then
      perform hr_private.fail('This employee is already linked to a different user account.', 'user_already_linked');
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger hr_employees_before_write before insert or update on public.hr_employees
  for each row execute function hr_private.employees_before_write();

-- Detect manager-cycles (A manages B manages A).
create or replace function hr_private.employees_check_manager_cycle()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cycle boolean;
begin
  if new.manager_id is null then return new; end if;
  with recursive chain(id, depth) as (
    select new.manager_id, 1
    union all
    select e.manager_id, c.depth + 1 from public.hr_employees e join chain c on e.id = c.id
    where e.manager_id is not null and c.depth < 50
  )
  select exists (select 1 from chain where id = new.id) into v_cycle;
  if v_cycle then perform hr_private.fail('Reporting manager would create a reporting cycle.', 'manager_cycle'); end if;
  return new;
end $$;
create trigger hr_employees_manager_cycle before insert or update of manager_id on public.hr_employees
  for each row execute function hr_private.employees_check_manager_cycle();

-- Employment history capture.
create or replace function hr_private.employees_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.hr_employee_history (employee_id, change_type, new_value, effective_date, changed_by)
    values (new.id, 'created', new.status, coalesce(new.joining_date, current_date), uid);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by) values (new.id, 'status', old.status, new.status, uid);
  end if;
  if new.department_id is distinct from old.department_id then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by)
    values (new.id, 'department', (select name from public.hr_departments where id = old.department_id), (select name from public.hr_departments where id = new.department_id), uid);
  end if;
  if new.designation_id is distinct from old.designation_id then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by)
    values (new.id, 'designation', (select name from public.hr_designations where id = old.designation_id), (select name from public.hr_designations where id = new.designation_id), uid);
  end if;
  if new.manager_id is distinct from old.manager_id then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by)
    values (new.id, 'manager', (select employee_code from public.hr_employees where id = old.manager_id), (select employee_code from public.hr_employees where id = new.manager_id), uid);
  end if;
  if new.employment_type is distinct from old.employment_type then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by) values (new.id, 'employment_type', old.employment_type, new.employment_type, uid);
  end if;
  if new.work_location_id is distinct from old.work_location_id then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by)
    values (new.id, 'location', (select name from public.hr_locations where id = old.work_location_id), (select name from public.hr_locations where id = new.work_location_id), uid);
  end if;
  if new.shift_id is distinct from old.shift_id then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by)
    values (new.id, 'shift', (select name from public.hr_shifts where id = old.shift_id), (select name from public.hr_shifts where id = new.shift_id), uid);
  end if;
  if new.portal_access is distinct from old.portal_access then
    insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, changed_by) values (new.id, 'portal_access', old.portal_access::text, new.portal_access::text, uid);
  end if;
  return new;
end $$;
create trigger hr_employees_history after insert or update on public.hr_employees
  for each row execute function hr_private.employees_history();

-- ---------------------------------------------------------------------
-- Identity & permission helpers (SECURITY DEFINER, stable)
-- ---------------------------------------------------------------------
-- The caller's employee record, only while their portal access is live.
create or replace function hr_private.current_employee_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.hr_employees e
  where e.user_id = auth.uid()
    and e.portal_access
    and e.status not in ('exited','archived','suspended')
  limit 1
$$;

-- True when the caller is linked to an employee whose access has been revoked.
create or replace function hr_private.caller_is_revoked()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hr_employees e
    where e.user_id = auth.uid()
      and (not e.portal_access or e.status in ('exited','archived','suspended'))
  )
$$;

create or replace function hr_private.has_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and not hr_private.caller_is_revoked()
     and exists (select 1 from public.hr_user_roles where user_id = auth.uid() and role_key = p_role)
$$;

create or replace function hr_private.has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and not hr_private.caller_is_revoked()
     and exists (
       select 1 from public.hr_user_roles ur
       where ur.user_id = auth.uid()
         and (ur.role_key = 'super_admin'
              or exists (select 1 from public.hr_role_permissions rp
                         where rp.role_key = ur.role_key and rp.permission_key = p_permission))
     )
$$;

-- Is p_target in the caller's reporting line (direct or indirect report)?
create or replace function hr_private.is_manager_of(p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with recursive chain(id, manager_id, depth) as (
    select e.id, e.manager_id, 1 from public.hr_employees e where e.id = p_target
    union all
    select e.id, e.manager_id, c.depth + 1
    from public.hr_employees e join chain c on e.id = c.manager_id
    where c.depth < 20
  )
  select hr_private.current_employee_id() is not null
     and p_target <> hr_private.current_employee_id()
     and exists (select 1 from chain where manager_id = hr_private.current_employee_id())
$$;

-- Generic record-level check used by module policies:
-- self, OR <module>.view (all), OR <module>.view_team for the caller's reporting line.
create or replace function hr_private.can_access_employee(p_target uuid, p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_target is not null and (
       p_target = hr_private.current_employee_id()
    or hr_private.has_permission(p_module || '.view')
    or (hr_private.has_permission(p_module || '.view_team') and hr_private.is_manager_of(p_target))
  )
$$;

-- Team-or-all approval check (manager approves team, HR approves anyone).
create or replace function hr_private.can_act_on_employee(p_target uuid, p_all_permission text, p_team_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_target is not null
     and p_target is distinct from hr_private.current_employee_id()   -- nobody approves their own request
     and (hr_private.has_permission(p_all_permission)
          or (hr_private.has_permission(p_team_permission) and hr_private.is_manager_of(p_target)))
$$;

create or replace function hr_private.my_manager_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select e.manager_id from public.hr_employees e where e.id = hr_private.current_employee_id()
$$;

-- user_id for an employee (for notifications).
create or replace function hr_private.employee_user_id(p_employee uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select user_id from public.hr_employees where id = p_employee
$$;

grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

-- ---------------------------------------------------------------------
-- RLS: settings & org structure
-- ---------------------------------------------------------------------
-- Org reference data is readable by any signed-in active HR user
-- (needed to render names); writes need settings.manage.
do $$
declare t text;
begin
  foreach t in array array['hr_departments','hr_designations','hr_employment_types','hr_locations','hr_shifts'] loop
    perform hr_private.secure_table(('public.' || t)::regclass);
    execute format('create policy %I on public.%I for select to authenticated using (hr_private.current_employee_id() is not null or hr_private.has_permission(''settings.view'') or hr_private.has_permission(''employees.view''))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (hr_private.has_permission(''settings.manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (hr_private.has_permission(''settings.manage'')) with check (hr_private.has_permission(''settings.manage''))', t || '_update', t);
    -- No delete policy: master data is deactivated (active = false), never deleted.
  end loop;
end $$;
create trigger hr_departments_touch before update on public.hr_departments for each row execute function hr_private.touch_updated_at();
create trigger hr_designations_touch before update on public.hr_designations for each row execute function hr_private.touch_updated_at();
create trigger hr_locations_touch before update on public.hr_locations for each row execute function hr_private.touch_updated_at();
create trigger hr_shifts_touch before update on public.hr_shifts for each row execute function hr_private.touch_updated_at();

create policy hr_settings_read on public.hr_settings for select to authenticated
  using (hr_private.has_permission('settings.view') or key in ('company'));
create policy hr_settings_write on public.hr_settings for update to authenticated
  using (hr_private.has_permission('settings.manage')) with check (hr_private.has_permission('settings.manage'));
create policy hr_settings_insert on public.hr_settings for insert to authenticated
  with check (hr_private.has_permission('settings.manage'));

-- Roles & permissions
select hr_private.secure_table('public.hr_roles');
select hr_private.secure_table('public.hr_permissions');
select hr_private.secure_table('public.hr_role_permissions');
select hr_private.secure_table('public.hr_user_roles');
create policy hr_roles_read on public.hr_roles for select to authenticated using (auth.uid() is not null);
create policy hr_roles_write on public.hr_roles for all to authenticated
  using (hr_private.has_permission('roles.manage') and not is_system)
  with check (hr_private.has_permission('roles.manage') and not is_system);
create policy hr_permissions_read on public.hr_permissions for select to authenticated using (auth.uid() is not null);
create policy hr_role_permissions_read on public.hr_role_permissions for select to authenticated using (auth.uid() is not null);
create policy hr_role_permissions_write on public.hr_role_permissions for insert to authenticated
  with check (hr_private.has_permission('roles.manage') and role_key <> 'super_admin');
create policy hr_role_permissions_delete on public.hr_role_permissions for delete to authenticated
  using (hr_private.has_permission('roles.manage') and role_key <> 'super_admin');
create policy hr_user_roles_read on public.hr_user_roles for select to authenticated
  using (user_id = auth.uid() or hr_private.has_permission('roles.manage') or hr_private.has_permission('employees.view'));
-- Role assignment goes through hr_assign_role()/hr_revoke_role() (audited, guarded).

-- ---------------------------------------------------------------------
-- RLS: employees
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_employees');
select hr_private.secure_table('public.hr_employee_private');
select hr_private.secure_table('public.hr_employee_history');

create policy hr_employees_read on public.hr_employees for select to authenticated using (
     id = hr_private.current_employee_id()
  or hr_private.has_permission('employees.view')
  or (hr_private.has_permission('employees.view_team') and hr_private.is_manager_of(id))
  -- an employee may see their own manager's work record (name, title)
  or id = hr_private.my_manager_id()
);
create policy hr_employees_insert on public.hr_employees for insert to authenticated
  with check (hr_private.has_permission('employees.create') and user_id is null and portal_access = false);
create policy hr_employees_update on public.hr_employees for update to authenticated
  using (hr_private.has_permission('employees.edit'))
  with check (hr_private.has_permission('employees.edit'));
-- No DELETE policy: employees are archived, never deleted.

-- Sensitive columns that only privileged RPCs may change.
create or replace function hr_private.employees_guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Direct table writes by API users cannot link accounts, grant access or exit people;
  -- those go through hr_set_portal_access / invite / exit workflows (which set a flag).
  if current_setting('hr.privileged_write', true) = 'on' or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
       or new.portal_access is distinct from old.portal_access
       or new.invited_at is distinct from old.invited_at
       or new.activated_at is distinct from old.activated_at then
      perform hr_private.fail('Portal access is changed through the invitation / access workflow.', 'use_access_workflow');
    end if;
    if new.status in ('exited') and old.status is distinct from 'exited' then
      perform hr_private.fail('Employees are exited through the Exit Management workflow.', 'use_exit_workflow');
    end if;
    if new.status = 'archived' and old.status is distinct from 'archived' and not hr_private.has_permission('employees.archive') then
      perform hr_private.fail('You are not allowed to archive employees.', 'forbidden');
    end if;
  end if;
  return new;
end $$;
create trigger hr_employees_guard before update on public.hr_employees
  for each row execute function hr_private.employees_guard_privileged_columns();

create policy hr_employee_private_read on public.hr_employee_private for select to authenticated
  using (employee_id = hr_private.current_employee_id() or hr_private.has_permission('employees.view_sensitive'));
create policy hr_employee_private_insert on public.hr_employee_private for insert to authenticated
  with check (hr_private.has_permission('employees.view_sensitive') and hr_private.has_permission('employees.edit'));
create policy hr_employee_private_update on public.hr_employee_private for update to authenticated
  using (hr_private.has_permission('employees.view_sensitive') and hr_private.has_permission('employees.edit'))
  with check (hr_private.has_permission('employees.view_sensitive') and hr_private.has_permission('employees.edit'));
create trigger hr_employee_private_touch before update on public.hr_employee_private for each row execute function hr_private.touch_updated_at();

create policy hr_employee_history_read on public.hr_employee_history for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'employees'));
-- History rows are written by triggers only.

-- ---------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------
create table public.hr_audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_user_id uuid,
  actor_employee_id uuid,
  action       text not null,              -- INSERT / UPDATE / DELETE / or a named event
  table_name   text,
  record_id    text,
  old_data     jsonb,
  new_data     jsonb,
  context      jsonb
);
create index hr_audit_log_time on public.hr_audit_log(occurred_at desc);
create index hr_audit_log_record on public.hr_audit_log(table_name, record_id);
select hr_private.secure_table('public.hr_audit_log');
-- Audit rows of payroll / salary / bank tables are readable only by holders of
-- audit.view AND payroll.view (HR admins have audit.view but no payroll access;
-- even redacted payroll audit rows reveal who was paid and when).
create or replace function hr_private.audit_table_is_payroll(p_table text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_table ~ '^hr_(payroll_|salary_|payslips|employee_bank_accounts|reimbursements)', false)
$$;
create policy hr_audit_log_read on public.hr_audit_log for select to authenticated using (
  hr_private.has_permission('audit.view')
  and (not hr_private.audit_table_is_payroll(table_name) or hr_private.has_permission('payroll.view'))
);
-- No insert/update/delete policies: only SECURITY DEFINER code writes here.
revoke insert, update, delete, truncate on public.hr_audit_log from authenticated;

create or replace function hr_private.audit_event(p_action text, p_table text, p_record text, p_context jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_audit_log (actor_user_id, actor_employee_id, action, table_name, record_id, context)
  values (auth.uid(), hr_private.current_employee_id(), p_action, p_table, p_record, p_context)
$$;

create or replace function hr_private.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_col text;
begin
  -- Redact columns passed as trigger arguments (e.g. bank account numbers).
  if tg_nargs > 0 then
    foreach v_col in array tg_argv loop
      if v_old ? v_col then v_old := jsonb_set(v_old, array[v_col], '"[redacted]"'); end if;
      if v_new ? v_col then v_new := jsonb_set(v_new, array[v_col], '"[redacted]"'); end if;
    end loop;
  end if;
  insert into public.hr_audit_log (actor_user_id, actor_employee_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), hr_private.current_employee_id(), tg_op, tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'key', v_old ->> 'key', v_new ->> 'employee_id', v_old ->> 'employee_id'),
          v_old, v_new);
  return coalesce(new, old);
end $$;

create or replace function hr_private.enable_audit(p_table regclass, p_redact text[] default '{}')
returns void language plpgsql set search_path = '' as $$
declare v_args text := '';
begin
  if array_length(p_redact, 1) > 0 then
    select string_agg(quote_literal(c), ',') into v_args from unnest(p_redact) c;
  end if;
  execute format('drop trigger if exists hr_audit on %s', p_table);
  execute format('create trigger hr_audit after insert or update or delete on %s for each row execute function hr_private.audit_trigger(%s)', p_table, v_args);
end $$;

select hr_private.enable_audit('public.hr_settings');
select hr_private.enable_audit('public.hr_departments');
select hr_private.enable_audit('public.hr_designations');
select hr_private.enable_audit('public.hr_locations');
select hr_private.enable_audit('public.hr_shifts');
select hr_private.enable_audit('public.hr_employment_types');
select hr_private.enable_audit('public.hr_role_permissions');
select hr_private.enable_audit('public.hr_user_roles');
select hr_private.enable_audit('public.hr_employees');
select hr_private.enable_audit('public.hr_employee_private',
  array['date_of_birth','personal_email','phone','address_line1','address_line2','postal_code','emergency_contact_phone']);

-- ---------------------------------------------------------------------
-- Notifications (in-app) + email outbox
-- ---------------------------------------------------------------------
create table public.hr_notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  link         text check (link is null or link ~ '^/[A-Za-z0-9/_?=&.%-]*$'),   -- in-app paths only
  entity_type  text,
  entity_id    text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index hr_notifications_recipient on public.hr_notifications(recipient_user_id, created_at desc);
select hr_private.secure_table('public.hr_notifications');
create policy hr_notifications_read on public.hr_notifications for select to authenticated using (recipient_user_id = auth.uid());
create policy hr_notifications_mark_read on public.hr_notifications for update to authenticated
  using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());
revoke insert, delete on public.hr_notifications from authenticated;
-- Only read_at may be changed by the recipient.
create or replace function hr_private.notifications_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (new.title, new.body, new.type, new.recipient_user_id, new.link, new.entity_id)
       is distinct from (old.title, old.body, old.type, old.recipient_user_id, old.link, old.entity_id) then
    perform hr_private.fail('Only the read status of a notification can be changed.', 'forbidden');
  end if;
  return new;
end $$;
create trigger hr_notifications_guard before update on public.hr_notifications for each row execute function hr_private.notifications_guard();

create or replace function hr_private.notify_user(p_user uuid, p_type text, p_title text, p_body text default null,
                                                  p_link text default null, p_entity_type text default null, p_entity_id text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_notifications (recipient_user_id, type, title, body, link, entity_type, entity_id)
  select p_user, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id where p_user is not null
$$;

create or replace function hr_private.notify_employee(p_employee uuid, p_type text, p_title text, p_body text default null,
                                                      p_link text default null, p_entity_type text default null, p_entity_id text default null)
returns void language sql security definer set search_path = '' as $$
  select hr_private.notify_user(hr_private.employee_user_id(p_employee), p_type, p_title, p_body, p_link, p_entity_type, p_entity_id)
$$;

-- Notification templates (configurable copy for notifications / emails).
create table public.hr_notification_templates (
  key        text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),
  channel    text not null default 'in_app' check (channel in ('in_app','email','both')),
  subject    text not null,
  body       text not null,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
select hr_private.secure_table('public.hr_notification_templates');
create policy hr_notification_templates_read on public.hr_notification_templates for select to authenticated using (hr_private.has_permission('settings.view'));
create policy hr_notification_templates_write on public.hr_notification_templates for all to authenticated
  using (hr_private.has_permission('settings.manage')) with check (hr_private.has_permission('settings.manage'));
select hr_private.enable_audit('public.hr_notification_templates');

-- Email outbox: rows are delivered by the hr-email-dispatch Edge Function
-- (service role). Status reflects REAL delivery; UI must not claim "sent"
-- until status = 'sent'.
create table public.hr_email_outbox (
  id           uuid primary key default gen_random_uuid(),
  to_email     citext not null check (to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject      text not null check (length(subject) <= 250),
  body_text    text not null,
  template_key text,
  entity_type  text,
  entity_id    text,
  status       text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled')),
  attempts     smallint not null default 0,
  last_error   text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index hr_email_outbox_status on public.hr_email_outbox(status, created_at);
select hr_private.secure_table('public.hr_email_outbox');
create policy hr_email_outbox_read on public.hr_email_outbox for select to authenticated
  using (hr_private.has_permission('settings.view') or created_by = auth.uid());
revoke insert, update, delete on public.hr_email_outbox from authenticated;

create or replace function hr_private.queue_email(p_to text, p_subject text, p_body text, p_template text default null,
                                                  p_entity_type text default null, p_entity_id text default null)
returns uuid language sql security definer set search_path = '' as $$
  insert into public.hr_email_outbox (to_email, subject, body_text, template_key, entity_type, entity_id, created_by)
  values (p_to, p_subject, p_body, p_template, p_entity_type, p_entity_id, auth.uid())
  returning id
$$;

-- ---------------------------------------------------------------------
-- Public RPCs (exposed through the Data API)
-- ---------------------------------------------------------------------
-- Who am I: employee record, roles and effective permissions. UI gating only;
-- every table/RPC re-checks on the server.
create or replace function public.hr_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'employee', (select jsonb_build_object(
        'id', e.id, 'employee_code', e.employee_code, 'first_name', e.first_name, 'last_name', e.last_name,
        'display_name', coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
        'employment_type', e.employment_type, 'status', e.status, 'department_id', e.department_id,
        'manager_id', e.manager_id, 'photo_path', e.photo_path, 'activated_at', e.activated_at)
      from public.hr_employees e where e.id = hr_private.current_employee_id()),
    'revoked', hr_private.caller_is_revoked(),
    'roles', coalesce((select jsonb_agg(role_key order by role_key) from public.hr_user_roles
                       where user_id = auth.uid() and not hr_private.caller_is_revoked()), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(distinct p.key order by p.key) from public.hr_permissions p
                             where hr_private.has_permission(p.key)), '[]'::jsonb),
    'is_manager', exists (select 1 from public.hr_employees x where x.manager_id = hr_private.current_employee_id()
                          and x.status not in ('exited','archived'))
  )
  where auth.uid() is not null
$$;

-- First sign-in after an invitation: mark the account activated.
create or replace function public.hr_activate_my_account()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees;
begin
  select * into v_emp from public.hr_employees where user_id = auth.uid();
  if v_emp.id is null then perform hr_private.fail('No employee record is linked to this account.', 'not_linked'); end if;
  if not v_emp.portal_access or v_emp.status in ('exited','archived','suspended') then
    perform hr_private.fail('Portal access for this account is disabled.', 'access_disabled');
  end if;
  if v_emp.activated_at is null then
    perform set_config('hr.privileged_write', 'on', true);
    update public.hr_employees set activated_at = now() where id = v_emp.id;
    perform set_config('hr.privileged_write', 'off', true);
    perform hr_private.audit_event('ACCOUNT_ACTIVATED', 'hr_employees', v_emp.id::text);
  end if;
  return public.hr_me();
end $$;

-- Employee self-service profile update (limited fields only).
create or replace function public.hr_update_my_contact(
  p_phone text default null, p_personal_email text default null,
  p_address_line1 text default null, p_address_line2 text default null, p_city text default null,
  p_state text default null, p_postal_code text default null,
  p_emergency_name text default null, p_emergency_relation text default null, p_emergency_phone text default null,
  p_display_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id();
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  insert into public.hr_employee_private (employee_id) values (v_me) on conflict (employee_id) do nothing;
  update public.hr_employee_private set
    phone = nullif(btrim(p_phone), ''),
    personal_email = nullif(btrim(p_personal_email), ''),
    address_line1 = nullif(btrim(p_address_line1), ''),
    address_line2 = nullif(btrim(p_address_line2), ''),
    city = nullif(btrim(p_city), ''),
    state = nullif(btrim(p_state), ''),
    postal_code = nullif(btrim(p_postal_code), ''),
    emergency_contact_name = nullif(btrim(p_emergency_name), ''),
    emergency_contact_relation = nullif(btrim(p_emergency_relation), ''),
    emergency_contact_phone = nullif(btrim(p_emergency_phone), '')
  where employee_id = v_me;
  if p_display_name is not null then
    update public.hr_employees set display_name = nullif(btrim(p_display_name), '') where id = v_me;
  end if;
end $$;

-- Role management (guarded, audited via hr_user_roles trigger).
create or replace function public.hr_assign_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('roles.manage') then perform hr_private.fail('You are not allowed to manage roles.', 'forbidden'); end if;
  if p_role = 'super_admin' and not hr_private.has_role('super_admin') then
    perform hr_private.fail('Only a Super Admin can grant Super Admin.', 'forbidden');
  end if;
  if not exists (select 1 from public.hr_roles where key = p_role) then perform hr_private.fail('Unknown role.', 'invalid'); end if;
  insert into public.hr_user_roles (user_id, role_key, granted_by) values (p_user, p_role, auth.uid())
  on conflict do nothing;
  insert into public.hr_employee_history (employee_id, change_type, new_value, changed_by)
  select id, 'role', '+' || p_role, auth.uid() from public.hr_employees where user_id = p_user;
end $$;

create or replace function public.hr_revoke_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('roles.manage') then perform hr_private.fail('You are not allowed to manage roles.', 'forbidden'); end if;
  if p_role = 'super_admin' then
    if not hr_private.has_role('super_admin') then perform hr_private.fail('Only a Super Admin can revoke Super Admin.', 'forbidden'); end if;
    if (select count(*) from public.hr_user_roles where role_key = 'super_admin') <= 1 then
      perform hr_private.fail('The last Super Admin cannot be removed.', 'last_super_admin');
    end if;
  end if;
  delete from public.hr_user_roles where user_id = p_user and role_key = p_role;
  insert into public.hr_employee_history (employee_id, change_type, new_value, changed_by)
  select id, 'role', '-' || p_role, auth.uid() from public.hr_employees where user_id = p_user;
end $$;

-- Portal access toggle (activate / deactivate) — not for linking accounts.
create or replace function public.hr_set_portal_access(p_employee uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees;
begin
  if not hr_private.has_permission('employees.invite') then perform hr_private.fail('You are not allowed to change portal access.', 'forbidden'); end if;
  select * into v_emp from public.hr_employees where id = p_employee for update;
  if v_emp.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if p_enabled and v_emp.status in ('exited','archived') then
    perform hr_private.fail('Access cannot be enabled for an exited or archived employee.', 'invalid_state');
  end if;
  if p_enabled and v_emp.user_id is null then
    perform hr_private.fail('Send an invitation first; this employee has no linked account.', 'not_linked');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employees set portal_access = p_enabled where id = p_employee;
  perform set_config('hr.privileged_write', 'off', true);
end $$;

-- Called ONLY by the hr-invite-employee Edge Function (service role) after
-- Supabase Auth has created/invited the user. Links the account.
create or replace function public.hr_link_invited_user(p_employee uuid, p_user uuid, p_invited_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform hr_private.fail('This operation is reserved for the invitation service.', 'forbidden');
  end if;
  select * into v_emp from public.hr_employees where id = p_employee for update;
  if v_emp.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if v_emp.user_id is not null and v_emp.user_id <> p_user then
    perform hr_private.fail('Employee is already linked to another account.', 'user_already_linked');
  end if;
  if exists (select 1 from public.hr_employees where user_id = p_user and id <> p_employee) then
    perform hr_private.fail('That account is already linked to another employee.', 'user_already_linked');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employees set user_id = p_user, portal_access = true, invited_at = now() where id = p_employee;
  perform set_config('hr.privileged_write', 'off', true);
  -- Default self-service role from employment type.
  insert into public.hr_user_roles (user_id, role_key, granted_by)
  values (p_user, case when v_emp.employment_type = 'intern' then 'intern' else 'employee' end, p_invited_by)
  on conflict do nothing;
  insert into public.hr_audit_log (actor_user_id, action, table_name, record_id, context)
  values (p_invited_by, 'EMPLOYEE_INVITED', 'hr_employees', p_employee::text, jsonb_build_object('user_id', p_user));
end $$;
revoke execute on function public.hr_link_invited_user(uuid, uuid, uuid) from anon, authenticated, public;
grant execute on function public.hr_link_invited_user(uuid, uuid, uuid) to service_role;

-- Pre-flight check used by the Edge Function with the CALLER's JWT.
create or replace function public.hr_can_invite(p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp public.hr_employees;
begin
  if not hr_private.has_permission('employees.invite') then perform hr_private.fail('You are not allowed to invite employees.', 'forbidden'); end if;
  select * into v_emp from public.hr_employees where id = p_employee;
  if v_emp.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if v_emp.company_email is null then perform hr_private.fail('Add a company email before inviting.', 'missing_email'); end if;
  if v_emp.status in ('exited','archived') then perform hr_private.fail('Exited or archived employees cannot be invited.', 'invalid_state'); end if;
  return jsonb_build_object('employee_id', v_emp.id, 'email', v_emp.company_email::text, 'user_id', v_emp.user_id,
                            'name', btrim(v_emp.first_name || ' ' || v_emp.last_name));
end $$;

-- Bulk import (validated, all-or-nothing). p_rows: JSON array of objects with
-- keys first_name*, last_name, display_name, company_email*, department_code,
-- designation, manager_code (employee_code), manager_email, employment_type,
-- joining_date (YYYY-MM-DD), work_location, shift, contract_start_date,
-- contract_end_date, date_of_birth, gender, personal_email, phone.
-- Returns { ok, created, errors: [{row, field, message}] }. With p_dry_run
-- (or any error) nothing is written.
create or replace function public.hr_import_employees(p_rows jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; i int := 0; errs jsonb := '[]'::jsonb; created int := 0;
  v_dep uuid; v_des uuid; v_mgr uuid; v_loc uuid; v_shift uuid; v_type text; v_emp uuid;
  v_join date; v_cs date; v_ce date; v_dob date; v_emails text[] := '{}'; v_email text;
  can_pii boolean := hr_private.has_permission('employees.view_sensitive');
  function_err text;
begin
  if not (hr_private.has_permission('employees.import') and hr_private.has_permission('employees.create')) then
    perform hr_private.fail('You are not allowed to import employees.', 'forbidden');
  end if;
  if jsonb_typeof(p_rows) <> 'array' then perform hr_private.fail('Import data must be a list of rows.', 'invalid'); end if;
  if jsonb_array_length(p_rows) > 1000 then perform hr_private.fail('Import at most 1000 rows at a time.', 'too_many_rows'); end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_dep := null; v_des := null; v_mgr := null; v_loc := null; v_shift := null;
    v_join := null; v_cs := null; v_ce := null; v_dob := null;
    v_email := lower(nullif(btrim(r ->> 'company_email'), ''));
    v_type := coalesce(nullif(btrim(r ->> 'employment_type'), ''), 'full_time');

    if nullif(btrim(r ->> 'first_name'), '') is null then
      errs := errs || jsonb_build_object('row', i, 'field', 'first_name', 'message', 'First name is required.');
    end if;
    if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      errs := errs || jsonb_build_object('row', i, 'field', 'company_email', 'message', 'A valid company email is required.');
    elsif v_email = any(v_emails) then
      errs := errs || jsonb_build_object('row', i, 'field', 'company_email', 'message', 'Duplicate email in this file.');
    elsif exists (select 1 from public.hr_employees where lower(company_email::text) = v_email) then
      errs := errs || jsonb_build_object('row', i, 'field', 'company_email', 'message', 'An employee with this email already exists.');
    end if;
    v_emails := v_emails || coalesce(v_email, '');
    if not exists (select 1 from public.hr_employment_types where code = v_type and active) then
      errs := errs || jsonb_build_object('row', i, 'field', 'employment_type', 'message', 'Unknown employment type ' || v_type || '.');
    end if;
    if nullif(btrim(r ->> 'department_code'), '') is not null then
      select id into v_dep from public.hr_departments where code = upper(btrim(r ->> 'department_code')) and active;
      if v_dep is null then errs := errs || jsonb_build_object('row', i, 'field', 'department_code', 'message', 'Unknown department code.'); end if;
    end if;
    if nullif(btrim(r ->> 'designation'), '') is not null then
      select id into v_des from public.hr_designations where lower(name) = lower(btrim(r ->> 'designation')) and active;
      if v_des is null then errs := errs || jsonb_build_object('row', i, 'field', 'designation', 'message', 'Unknown designation.'); end if;
    end if;
    if nullif(btrim(r ->> 'manager_code'), '') is not null or nullif(btrim(r ->> 'manager_email'), '') is not null then
      select id into v_mgr from public.hr_employees
       where (employee_code = btrim(r ->> 'manager_code') or lower(company_email::text) = lower(nullif(btrim(r ->> 'manager_email'), '')))
         and status not in ('exited','archived') limit 1;
      if v_mgr is null then errs := errs || jsonb_build_object('row', i, 'field', 'manager', 'message', 'Manager not found (use an existing employee code or email).'); end if;
    end if;
    if nullif(btrim(r ->> 'work_location'), '') is not null then
      select id into v_loc from public.hr_locations where lower(name) = lower(btrim(r ->> 'work_location')) and active;
      if v_loc is null then errs := errs || jsonb_build_object('row', i, 'field', 'work_location', 'message', 'Unknown work location.'); end if;
    end if;
    if nullif(btrim(r ->> 'shift'), '') is not null then
      select id into v_shift from public.hr_shifts where lower(name) = lower(btrim(r ->> 'shift')) and active;
      if v_shift is null then errs := errs || jsonb_build_object('row', i, 'field', 'shift', 'message', 'Unknown shift.'); end if;
    end if;
    -- Strict ISO dates only: Postgres would otherwise read "02/11/2026" using the
    -- server DateStyle and silently swap day and month.
    if exists (select 1 from unnest(array['joining_date','contract_start_date','contract_end_date','date_of_birth']) k
               where nullif(btrim(r ->> k), '') is not null and btrim(r ->> k) !~ '^\d{4}-\d{2}-\d{2}$') then
      errs := errs || jsonb_build_object('row', i, 'field', 'dates', 'message', 'Dates must be YYYY-MM-DD.');
    else
      begin
        v_join := nullif(btrim(r ->> 'joining_date'), '')::date;
        v_cs := nullif(btrim(r ->> 'contract_start_date'), '')::date;
        v_ce := nullif(btrim(r ->> 'contract_end_date'), '')::date;
        v_dob := nullif(btrim(r ->> 'date_of_birth'), '')::date;
      exception when others then
        errs := errs || jsonb_build_object('row', i, 'field', 'dates', 'message', 'Dates must be valid YYYY-MM-DD dates.');
      end;
    end if;
    if v_ce is not null and v_cs is not null and v_ce < v_cs then
      errs := errs || jsonb_build_object('row', i, 'field', 'contract_end_date', 'message', 'Contract end is before contract start.');
    end if;
    if not can_pii and (r ? 'date_of_birth' or r ? 'gender' or r ? 'personal_email' or r ? 'phone')
       and coalesce(nullif(r ->> 'date_of_birth',''), nullif(r ->> 'gender',''), nullif(r ->> 'personal_email',''), nullif(r ->> 'phone','')) is not null then
      errs := errs || jsonb_build_object('row', i, 'field', 'personal', 'message', 'You are not allowed to import personal details.');
    end if;

    if jsonb_array_length(errs) = 0 and not p_dry_run then
      begin
        insert into public.hr_employees (first_name, last_name, display_name, company_email, department_id, designation_id, manager_id,
                                         employment_type, joining_date, work_location_id, shift_id, contract_start_date, contract_end_date, source)
        values (btrim(r ->> 'first_name'), coalesce(btrim(r ->> 'last_name'), ''), nullif(btrim(r ->> 'display_name'), ''), v_email,
                v_dep, v_des, v_mgr, v_type, v_join, v_loc, v_shift, v_cs, v_ce, 'import')
        returning id into v_emp;
        if can_pii and coalesce(nullif(r ->> 'date_of_birth',''), nullif(r ->> 'gender',''), nullif(r ->> 'personal_email',''), nullif(r ->> 'phone','')) is not null then
          insert into public.hr_employee_private (employee_id, date_of_birth, gender, personal_email, phone)
          values (v_emp, v_dob, nullif(lower(btrim(r ->> 'gender')), ''), nullif(btrim(r ->> 'personal_email'), ''), nullif(btrim(r ->> 'phone'), ''));
        end if;
        created := created + 1;
      exception when others then
        get stacked diagnostics function_err = message_text;
        errs := errs || jsonb_build_object('row', i, 'field', 'row', 'message', function_err);
      end;
    end if;
  end loop;

  if jsonb_array_length(errs) > 0 and not p_dry_run then
    -- All-or-nothing: undo every row of this import.
    raise exception using errcode = 'P0001', message = 'Import failed; no employees were created.',
      hint = 'import_failed', detail = errs::text;
  end if;
  if not p_dry_run then
    perform hr_private.audit_event('EMPLOYEES_IMPORTED', 'hr_employees', null, jsonb_build_object('created', created));
  end if;
  return jsonb_build_object('ok', jsonb_array_length(errs) = 0, 'dry_run', p_dry_run, 'rows', i,
                            'created', case when p_dry_run then 0 else created end, 'errors', errs);
end $$;
revoke execute on function public.hr_import_employees(jsonb, boolean) from anon, public;
grant execute on function public.hr_import_employees(jsonb, boolean) to authenticated;

-- Lock down defaults: every hr_ function is authenticated-only.
revoke execute on function public.hr_me(), public.hr_activate_my_account(),
  public.hr_update_my_contact(text,text,text,text,text,text,text,text,text,text,text),
  public.hr_assign_role(uuid,text), public.hr_revoke_role(uuid,text),
  public.hr_set_portal_access(uuid,boolean), public.hr_can_invite(uuid) from anon, public;
grant execute on function public.hr_me(), public.hr_activate_my_account(),
  public.hr_update_my_contact(text,text,text,text,text,text,text,text,text,text,text),
  public.hr_assign_role(uuid,text), public.hr_revoke_role(uuid,text),
  public.hr_set_portal_access(uuid,boolean), public.hr_can_invite(uuid) to authenticated;
revoke all on sequence public.hr_employee_code_seq from anon, authenticated, public;

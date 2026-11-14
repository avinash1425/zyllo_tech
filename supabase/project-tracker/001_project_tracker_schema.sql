-- =====================================================================
-- Zyllo Tech — Project Tracker module: schema, RLS, functions, views.
--
-- NOT APPLIED. Apply only after explicit approval, in the Supabase SQL
-- editor of the live (Lovable-managed) project, after running
-- 000_preflight_check.sql. See supabase/project-tracker/README.md.
--
-- Purely additive:
--   * every object is new and prefixed pt_ (tables, views, functions);
--   * no existing table, function, policy, bucket or auth setting is
--     altered; public.is_admin() is only CALLED, never redefined;
--   * the storage bucket and its policies are in a separate file (002).
--
-- Security model
--   * Access = website admin (public.is_admin()) AND a Project Tracker role.
--     Admins get "editor" by default. A row in pt_members can raise an admin
--     to "manager", lower them to "viewer", or block them ("no_access").
--     Non-admins never get access, whatever pt_members says.
--   * viewer  : read everything except credential references
--     editor  : + create / edit / archive records, start handovers
--     manager : + reveal credential references, approve / complete
--               handovers, restore archived records, manage roles
--   * RLS on every table; anon gets nothing; no role gets DELETE or
--     TRUNCATE (records are archived, never hard-deleted).
--   * No password / secret column exists anywhere. Credential records keep
--     only a reference to an external password manager, in a table no API
--     role can read; it is reachable only through audited functions.
--   * A trigger rejects values that look like keys, tokens or passwords in
--     any text column.
--   * Activity logs are written only by triggers / definer functions and
--     cannot be updated or deleted.
-- =====================================================================

begin;

-- ------------------------------------------------------------ preconditions
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Project Tracker needs the existing public.is_admin() function (website admin check). Aborting.';
  end if;
  if to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null then
    raise exception 'auth.uid()/auth.jwt() not found: this is not a Supabase database. Aborting.';
  end if;
  if to_regclass('public.pt_projects') is not null then
    raise exception 'public.pt_projects already exists: the Project Tracker schema is already installed. Aborting (nothing changed).';
  end if;
end $$;

-- =====================================================================
-- 1. Roles and authorization helpers
-- =====================================================================

create table public.pt_members (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role in ('no_access', 'viewer', 'editor', 'manager')),
  note        text check (char_length(note) <= 500),
  granted_by  uuid,
  granted_at  timestamptz not null default now()
);
comment on table public.pt_members is
  'Project Tracker role overrides for website admins. Admins without a row are editors. Read/written only through pt_* functions.';

-- The caller's Project Tracker role, or NULL when they have no access.
create or replace function public.pt_role()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    return null;
  end if;
  if not coalesce(public.is_admin(), false) then
    return null;
  end if;
  select m.role into v_role from public.pt_members m where m.user_id = v_uid;
  v_role := coalesce(v_role, 'editor');
  if v_role = 'no_access' then
    return null;
  end if;
  return v_role;
end $$;

create or replace function public.pt_can_read() returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select public.pt_role() is not null $$;

create or replace function public.pt_can_edit() returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.pt_role() in ('editor', 'manager'), false) $$;

create or replace function public.pt_is_manager() returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.pt_role() = 'manager', false) $$;

-- True when the statement comes from the browser API (PostgREST roles), as
-- opposed to the SQL editor / migrations run by the database owner.
create or replace function public.pt_is_api_call() returns boolean
language sql stable
as $$ select current_user in ('anon', 'authenticated') $$;

-- "Today" for date rules and windows: the calendar date in India (Zyllo Tech
-- operates in IST). Using the server's UTC current_date would reject a
-- same-day date entered between 00:00 and 05:30 IST.
create or replace function public.pt_today() returns date
language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- =====================================================================
-- 2. Validation helpers
-- =====================================================================

-- Heuristic: does a value look like a credential rather than a reference?
-- Used to stop secrets being typed into ordinary fields.
create or replace function public.pt_looks_like_secret(p text) returns boolean
language sql immutable
as $$
  select p is not null and (
       p ~* '-----BEGIN [A-Z ]*PRIVATE KEY'                       -- PEM private keys
    or p ~* 'ssh-(rsa|ed25519|dss) AAAA[0-9A-Za-z+/]{40,}'          -- SSH keys
    or p ~  'eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.'         -- JWTs (API / service keys)
    or p ~  '(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}'              -- Stripe-style keys
    or p ~  '(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}'               -- GitHub tokens
    or p ~  'github_pat_[A-Za-z0-9_]{20,}'
    or p ~  'AKIA[0-9A-Z]{16}'                                     -- AWS access key id
    or p ~  'AIza[0-9A-Za-z_-]{35}'                                -- Google API key
    or p ~  'xox[abprs]-[A-Za-z0-9-]{10,}'                         -- Slack tokens
    or p ~  'sb_secret_[A-Za-z0-9_-]{10,}'                         -- Supabase secret key
    or p ~  'sbp_[A-Za-z0-9]{20,}'                                 -- Supabase access token
    -- "password: Xy7…" style assignments (a value with letters AND digits);
    -- prose such as "Password: stored in the vault" is allowed.
    or p ~* '(password|passwd|pwd|passcode|secret|token|api[ _-]?key|access[ _-]?token|private[ _-]?key|recovery[ _-]?codes?)\s*[:=]\s*(?!1password)(?=\S*[0-9])(?=\S*[a-z])\S{6,}'
  )
$$;

create or replace function public.pt_valid_url(p text) returns boolean
language sql immutable
as $$ select p is null or (p ~* '^(https?|sftp|ftps?|ssh)://[^\s/$.?#][^\s]*$' and char_length(p) <= 1000) $$;

create or replace function public.pt_valid_email(p text) returns boolean
language sql immutable
as $$ select p is null or (p ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(p) <= 254) $$;

-- Masks an account identifier for display: "admin@acme.com" -> "ad•••@acme.com".
create or replace function public.pt_mask_identifier(p text) returns text
language sql immutable
as $$
  select case
    when p is null or btrim(p) = '' then null
    when position('@' in p) > 1 then left(split_part(p, '@', 1), least(2, char_length(split_part(p, '@', 1)) - 1)) || '•••@' || split_part(p, '@', 2)
    when char_length(p) <= 2 then '•••'
    else left(p, 1) || '•••' || right(p, 1)
  end
$$;

-- =====================================================================
-- 3. Tables
--    Common audit / archive columns are added to every table by the loop in
--    section 4: created_at, created_by, created_by_email, updated_at,
--    updated_by, updated_by_email, archived_at, archived_by, archive_reason.
-- =====================================================================

create table public.pt_projects (
  id                        uuid primary key default gen_random_uuid(),
  serial_no                 bigint generated always as identity unique,
  project_code              text not null,
  name                      text not null check (char_length(btrim(name)) between 2 and 200),
  client_name               text not null check (char_length(btrim(client_name)) between 1 and 200),
  category                  text not null default 'website'
                            check (category in ('website', 'erp', 'web_application', 'mobile_application', 'amc_application', 'other')),
  category_other            text check (char_length(category_other) <= 100),
  description               text check (char_length(description) <= 10000),
  scope                     text check (char_length(scope) <= 10000),
  developed_by_zyllo        boolean not null default true,
  original_developer        text check (char_length(original_developer) <= 200),
  responsible_person        text check (char_length(responsible_person) <= 200),
  start_date                date,
  expected_completion_date  date,
  actual_completion_date    date,
  status                    text not null default 'planned'
                            check (status in ('planned', 'in_progress', 'under_testing', 'under_client_review', 'live',
                                              'under_maintenance', 'completed', 'on_hold', 'archived', 'cancelled')),
  status_before_archive     text,
  priority                  text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  progress                  smallint not null default 0 check (progress between 0 and 100),
  live_url                  text check (public.pt_valid_url(live_url)),
  staging_url               text check (public.pt_valid_url(staging_url)),
  remarks                   text check (char_length(remarks) <= 5000),
  amc_applicable            boolean not null default false,
  seo_applicable            boolean not null default false,
  not_applicable_sections   text[] not null default '{}'
                            check (not_applicable_sections <@ array['hosting', 'domain', 'admin_access', 'backups', 'source', 'maintenance', 'handover']::text[]),
  constraint pt_projects_code_format check (project_code ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
  constraint pt_projects_category_other check (category <> 'other' or nullif(btrim(category_other), '') is not null),
  constraint pt_projects_vendor check (developed_by_zyllo or nullif(btrim(original_developer), '') is not null),
  constraint pt_projects_expected_after_start check (expected_completion_date is null or start_date is null or expected_completion_date >= start_date),
  constraint pt_projects_actual_after_start check (actual_completion_date is null or start_date is null or actual_completion_date >= start_date)
);
create unique index pt_projects_code_uidx on public.pt_projects (upper(project_code));

create table public.pt_hosting (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.pt_projects(id),
  provider            text not null check (char_length(btrim(provider)) between 1 and 100),
  purpose             text not null default 'frontend' check (purpose in ('frontend', 'backend', 'database', 'email', 'storage', 'other')),
  environment         text not null default 'production' check (environment in ('production', 'staging', 'development')),
  hosting_type        text check (char_length(hosting_type) <= 100),
  account_email       text check (public.pt_valid_email(account_email)),
  account_owner       text check (char_length(account_owner) <= 200),
  control_panel_url   text check (public.pt_valid_url(control_panel_url)),
  server_identifier   text check (char_length(server_identifier) <= 200),
  server_host         text check (char_length(server_host) <= 255),
  server_region       text check (char_length(server_region) <= 100),
  operating_system    text check (char_length(operating_system) <= 100),
  deployment_ref      text check (char_length(deployment_ref) <= 500),
  purchase_date       date,
  renewal_date        date,
  expiry_date         date,
  auto_renew          boolean not null default false,
  status              text not null default 'active' check (status in ('active', 'inactive', 'migrated', 'expired', 'cancelled')),
  migrated_to_id      uuid,
  migration_note      text check (char_length(migration_note) <= 2000),
  responsible_person  text check (char_length(responsible_person) <= 200),
  remarks             text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  constraint pt_hosting_migrated_to_fk foreign key (project_id, migrated_to_id) references public.pt_hosting (project_id, id),
  constraint pt_hosting_not_self check (migrated_to_id is null or migrated_to_id <> id),
  constraint pt_hosting_migration_documented check (status <> 'migrated' or migrated_to_id is not null or nullif(btrim(migration_note), '') is not null),
  constraint pt_hosting_dates check (expiry_date is null or purchase_date is null or expiry_date >= purchase_date)
);
create index pt_hosting_project_idx on public.pt_hosting (project_id);

create table public.pt_domains (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references public.pt_projects(id),
  domain_name              text not null check (domain_name = lower(domain_name)
                             and domain_name ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
                             and char_length(domain_name) <= 253),
  domain_role              text not null default 'primary' check (domain_role in ('primary', 'secondary', 'subdomain')),
  registrar                text check (char_length(registrar) <= 100),
  registrar_account_email  text check (public.pt_valid_email(registrar_account_email)),
  dns_provider             text check (char_length(dns_provider) <= 100),
  nameservers              text check (char_length(nameservers) <= 1000),
  registered_on            date,
  expires_on               date,
  auto_renew               boolean not null default false,
  ssl_provider             text check (char_length(ssl_provider) <= 100),
  ssl_type                 text check (ssl_type in ('none', 'dv', 'ov', 'ev', 'wildcard', 'managed_auto', 'other')),
  ssl_expires_on           date,
  ssl_auto_renew           boolean not null default false,
  status                   text not null default 'active' check (status in ('active', 'pending', 'expired', 'transferred', 'parked', 'cancelled')),
  ownership                text not null default 'client' check (ownership in ('client', 'zyllo_tech', 'third_party', 'unknown')),
  handover_status          text not null default 'not_started' check (handover_status in ('not_started', 'in_progress', 'handed_over', 'not_applicable')),
  remarks                  text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  constraint pt_domains_dates check (expires_on is null or registered_on is null or expires_on >= registered_on)
);
create index pt_domains_project_idx on public.pt_domains (project_id);

create table public.pt_access_records (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.pt_projects(id),
  service_name          text not null check (char_length(btrim(service_name)) between 1 and 150),
  category              text not null default 'website_admin'
                        check (category in ('website_admin', 'hosting_panel', 'vps_ssh', 'database', 'domain_registrar', 'github',
                                            'email_account', 'third_party', 'api_service', 'other')),
  login_url             text check (public.pt_valid_url(login_url)),
  account_owner         text check (char_length(account_owner) <= 200),
  access_level          text check (char_length(access_level) <= 100),
  responsible_person    text check (char_length(responsible_person) <= 200),
  two_factor            text not null default 'unknown' check (two_factor in ('enabled', 'disabled', 'not_supported', 'unknown')),
  last_rotated_on       date,
  rotation_due_on       date,
  last_verified_on      date,
  status                text not null default 'active' check (status in ('active', 'pending', 'disabled', 'revoked', 'handed_over')),
  remarks               text check (char_length(remarks) <= 5000),
  -- maintained only by pt_set_access_reference(); never writable directly
  has_reference         boolean not null default false,
  identifier_hint       text,
  reference_updated_at  timestamptz,
  unique (project_id, id)
);
create index pt_access_records_project_idx on public.pt_access_records (project_id);

-- The only place an account identifier and vault reference live. No API
-- role has any privilege on it; see pt_set_access_reference /
-- pt_reveal_access_reference.
create table public.pt_access_refs (
  access_record_id    uuid primary key references public.pt_access_records(id),
  project_id          uuid not null references public.pt_projects(id),
  account_identifier  text check (char_length(account_identifier) <= 200),
  vault_reference     text not null check (char_length(btrim(vault_reference)) between 3 and 300),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_by_email    text
);

create table public.pt_email_accounts (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.pt_projects(id),
  email_address         text not null check (email_address = lower(email_address) and public.pt_valid_email(email_address)),
  purpose               text not null default 'admin'
                        check (purpose in ('admin', 'support', 'billing', 'info', 'sales', 'noreply', 'hr', 'personal', 'other')),
  purpose_detail        text check (char_length(purpose_detail) <= 200),
  provider              text check (char_length(provider) <= 100),
  login_url             text check (public.pt_valid_url(login_url)),
  account_owner         text check (char_length(account_owner) <= 200),
  responsible_person    text check (char_length(responsible_person) <= 200),
  linked_hosting_id     uuid,
  linked_domain_id      uuid,
  linked_access_id      uuid,
  status                text not null default 'active' check (status in ('active', 'pending', 'inactive', 'suspended', 'deleted_at_provider')),
  created_on            date,
  last_verified_on      date,
  two_factor            text not null default 'unknown' check (two_factor in ('enabled', 'disabled', 'not_supported', 'unknown')),
  recovery_contact_ref  text check (char_length(recovery_contact_ref) <= 300),
  reuse_justification   text check (char_length(reuse_justification) <= 1000),
  remarks               text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  foreign key (project_id, linked_hosting_id) references public.pt_hosting (project_id, id),
  foreign key (project_id, linked_domain_id) references public.pt_domains (project_id, id),
  foreign key (project_id, linked_access_id) references public.pt_access_records (project_id, id)
);
create index pt_email_accounts_project_idx on public.pt_email_accounts (project_id);

create table public.pt_backups (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.pt_projects(id),
  seq_no                 bigint generated always as identity unique,
  backup_code            text not null default '',
  name                   text not null check (char_length(btrim(name)) between 1 and 200),
  backup_type            text not null default 'database' check (backup_type in ('database', 'files', 'full_server', 'source_code', 'other')),
  hosting_id             uuid,
  backup_at              timestamptz,
  method                 text not null default 'automatic' check (method in ('automatic', 'manual')),
  frequency              text check (frequency in ('hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'on_demand', 'other')),
  storage_provider       text check (char_length(storage_provider) <= 100),
  storage_location_ref   text check (char_length(storage_location_ref) <= 500),
  retention_period       text check (char_length(retention_period) <= 100),
  encryption_status      text not null default 'unknown' check (encryption_status in ('encrypted', 'not_encrypted', 'unknown')),
  status                 text not null default 'scheduled' check (status in ('scheduled', 'completed', 'verified', 'failed')),
  file_size_bytes        bigint check (file_size_bytes >= 0),
  checksum               text check (char_length(checksum) <= 200),
  verified_by            text check (char_length(verified_by) <= 200),
  verified_on            date,
  verification_evidence  text check (char_length(verification_evidence) <= 2000),
  restore_tested         boolean not null default false,
  restore_tested_on      date,
  restore_test_evidence  text check (char_length(restore_test_evidence) <= 2000),
  restore_instructions   text check (char_length(restore_instructions) <= 10000),
  responsible_person     text check (char_length(responsible_person) <= 200),
  remarks                text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  foreign key (project_id, hosting_id) references public.pt_hosting (project_id, id),
  -- Evidence rules: a backup is never "completed" / "verified" / "restore
  -- tested" just because a status was picked.
  constraint pt_backups_completed_evidence check (
    status not in ('completed', 'verified')
    or (backup_at is not null and nullif(btrim(storage_location_ref), '') is not null)),
  constraint pt_backups_verified_evidence check (
    status <> 'verified'
    or (nullif(btrim(verified_by), '') is not null and verified_on is not null
        and char_length(btrim(coalesce(verification_evidence, ''))) >= 10)),
  constraint pt_backups_restore_evidence check (
    not restore_tested
    or (status in ('completed', 'verified') and restore_tested_on is not null
        and char_length(btrim(coalesce(restore_test_evidence, ''))) >= 10))
);
create index pt_backups_project_idx on public.pt_backups (project_id, backup_at desc);

create table public.pt_repositories (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.pt_projects(id),
  git_provider          text not null default 'github' check (git_provider in ('github', 'gitlab', 'bitbucket', 'azure_devops', 'lovable', 'other')),
  repo_url              text not null check (public.pt_valid_url(repo_url)),
  visibility            text not null default 'private' check (visibility in ('private', 'internal', 'public')),
  main_branch           text check (char_length(main_branch) <= 200),
  development_branch    text check (char_length(development_branch) <= 200),
  deployment_branch     text check (char_length(deployment_branch) <= 200),
  frontend_hosting_id   uuid,
  backend_hosting_id    uuid,
  database_hosting_id   uuid,
  production_url        text check (public.pt_valid_url(production_url)),
  staging_url           text check (public.pt_valid_url(staging_url)),
  status                text not null default 'active' check (status in ('active', 'read_only', 'transferred', 'archived_at_provider')),
  responsible_person    text check (char_length(responsible_person) <= 200),
  remarks               text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  foreign key (project_id, frontend_hosting_id) references public.pt_hosting (project_id, id),
  foreign key (project_id, backend_hosting_id) references public.pt_hosting (project_id, id),
  foreign key (project_id, database_hosting_id) references public.pt_hosting (project_id, id)
);
create index pt_repositories_project_idx on public.pt_repositories (project_id);

create table public.pt_deployments (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.pt_projects(id),
  repository_id       uuid,
  environment         text not null default 'production' check (environment in ('production', 'staging', 'development')),
  deployed_at         timestamptz,
  release_version     text check (char_length(release_version) <= 100),
  commit_ref          text check (char_length(commit_ref) <= 100),
  status              text not null default 'succeeded' check (status in ('planned', 'in_progress', 'succeeded', 'failed', 'rolled_back')),
  rollback_ref        text check (char_length(rollback_ref) <= 200),
  deployed_url        text check (public.pt_valid_url(deployed_url)),
  responsible_person  text check (char_length(responsible_person) <= 200),
  remarks             text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  foreign key (project_id, repository_id) references public.pt_repositories (project_id, id),
  constraint pt_deployments_done_has_date check (status in ('planned', 'in_progress') or deployed_at is not null)
);
create index pt_deployments_project_idx on public.pt_deployments (project_id, deployed_at desc);

create table public.pt_milestones (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.pt_projects(id),
  name          text not null check (char_length(btrim(name)) between 1 and 200),
  description   text check (char_length(description) <= 5000),
  target_date   date,
  completed_on  date,
  status        text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'missed', 'cancelled')),
  remarks       text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  constraint pt_milestones_completed check (status <> 'completed' or completed_on is not null)
);
create index pt_milestones_project_idx on public.pt_milestones (project_id);

create table public.pt_tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.pt_projects(id),
  seq_no         bigint generated always as identity unique,
  task_code      text not null default '',
  title          text not null check (char_length(btrim(title)) between 1 and 300),
  description    text check (char_length(description) <= 10000),
  assigned_to    text check (char_length(assigned_to) <= 200),
  priority       text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status         text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  start_date     date,
  due_date       date,
  completed_on   date,
  notes          text check (char_length(notes) <= 5000),
  milestone_id   uuid,
  unique (project_id, id),
  foreign key (project_id, milestone_id) references public.pt_milestones (project_id, id),
  constraint pt_tasks_done check (status <> 'done' or completed_on is not null),
  constraint pt_tasks_dates check (due_date is null or start_date is null or due_date >= start_date)
);
create index pt_tasks_project_idx on public.pt_tasks (project_id);

create table public.pt_documents (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.pt_projects(id),
  name             text not null check (char_length(btrim(name)) between 1 and 200),
  category         text not null default 'other'
                   check (category in ('requirements', 'scope_of_work', 'agreement', 'technical_documentation', 'design_documents',
                                       'hosting_documentation', 'domain_documentation', 'admin_access_handover', 'backup_restore_instructions',
                                       'testing_reports', 'user_guide', 'training_material', 'training_recording', 'client_approval',
                                       'completion_certificate', 'amc_agreement', 'seo_audit', 'other')),
  storage_path     text unique,
  external_url     text check (public.pt_valid_url(external_url)),
  file_name        text check (char_length(file_name) <= 200),
  mime_type        text check (char_length(mime_type) <= 150),
  size_bytes       bigint check (size_bytes between 0 and 52428800),
  version          text check (char_length(version) <= 50),
  classification   text not null default 'internal' check (classification in ('internal', 'confidential', 'restricted', 'client_shareable')),
  task_id          uuid,
  remarks          text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  foreign key (project_id, task_id) references public.pt_tasks (project_id, id),
  -- exactly one of: an uploaded private file, or an external link
  constraint pt_documents_one_source check ((storage_path is null) <> (external_url is null)),
  -- uploaded files must live under this project's own folder
  constraint pt_documents_path_in_project check (
    storage_path is null
    or storage_path ~ ('^' || project_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,150}$'))
);
create index pt_documents_project_idx on public.pt_documents (project_id);

create table public.pt_updates (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.pt_projects(id),
  seq_no                bigint generated always as identity unique,
  update_code           text not null default '',
  update_date           date not null default public.pt_today(),
  updated_by_name       text not null check (char_length(btrim(updated_by_name)) between 1 and 200),
  update_type           text not null default 'maintenance'
                        check (update_type in ('maintenance', 'bug_fix', 'security_update', 'content_change', 'feature',
                                               'production_release', 'performance', 'configuration', 'other')),
  description           text not null check (char_length(btrim(description)) between 3 and 10000),
  version               text check (char_length(version) <= 100),
  environment           text check (environment in ('production', 'staging', 'development')),
  testing_status        text not null default 'not_tested' check (testing_status in ('not_tested', 'in_testing', 'passed', 'failed', 'not_required')),
  approval_status       text not null default 'not_required' check (approval_status in ('not_required', 'pending', 'approved', 'rejected')),
  deployment_date       date,
  evidence_ref          text check (char_length(evidence_ref) <= 1000),
  evidence_document_id  uuid,
  next_action           text check (char_length(next_action) <= 2000),
  remarks               text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  foreign key (project_id, evidence_document_id) references public.pt_documents (project_id, id)
);
create index pt_updates_project_idx on public.pt_updates (project_id, update_date desc);

create table public.pt_amc_contracts (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.pt_projects(id),
  contract_number        text check (char_length(contract_number) <= 100),
  service_scope          text check (char_length(service_scope) <= 10000),
  start_date             date not null,
  end_date               date not null,
  renewal_date           date,
  status                 text not null default 'active' check (status in ('draft', 'active', 'expired', 'renewed', 'cancelled')),
  maintenance_frequency  text check (maintenance_frequency in ('weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'on_call', 'other')),
  support_terms          text check (char_length(support_terms) <= 10000),
  responsible_person     text check (char_length(responsible_person) <= 200),
  client_contact         text check (char_length(client_contact) <= 300),
  contract_value         numeric(14, 2) check (contract_value >= 0),
  currency               text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  contract_document_id   uuid,
  renewed_from_id        uuid,
  remarks                text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  foreign key (project_id, contract_document_id) references public.pt_documents (project_id, id),
  foreign key (project_id, renewed_from_id) references public.pt_amc_contracts (project_id, id),
  constraint pt_amc_dates check (end_date >= start_date)
);
create index pt_amc_contracts_project_idx on public.pt_amc_contracts (project_id);

create table public.pt_renewals (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.pt_projects(id),
  item_type            text not null check (item_type in ('hosting', 'domain', 'ssl', 'email_service', 'amc', 'subscription', 'other')),
  item_label           text not null check (char_length(btrim(item_label)) between 1 and 200),
  hosting_id           uuid,
  domain_id            uuid,
  email_account_id     uuid,
  amc_contract_id      uuid,
  vendor               text check (char_length(vendor) <= 150),
  due_date             date not null,
  amount               numeric(14, 2) check (amount >= 0),
  currency             text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  status               text not null default 'upcoming' check (status in ('upcoming', 'completed', 'cancelled', 'lapsed')),
  completed_on         date,
  completed_by_name    text check (char_length(completed_by_name) <= 200),
  new_expiry_date      date,
  completion_evidence  text check (char_length(completion_evidence) <= 2000),
  remarks              text check (char_length(remarks) <= 5000),
  unique (project_id, id),
  foreign key (project_id, hosting_id) references public.pt_hosting (project_id, id),
  foreign key (project_id, domain_id) references public.pt_domains (project_id, id),
  foreign key (project_id, email_account_id) references public.pt_email_accounts (project_id, id),
  foreign key (project_id, amc_contract_id) references public.pt_amc_contracts (project_id, id),
  constraint pt_renewals_completed_evidence check (
    status <> 'completed'
    or (completed_on is not null and char_length(btrim(coalesce(completion_evidence, ''))) >= 5))
);
create index pt_renewals_project_idx on public.pt_renewals (project_id, due_date);

create table public.pt_seo_records (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.pt_projects(id),
  seo_status             text not null default 'not_started' check (seo_status in ('not_started', 'in_progress', 'active', 'paused', 'completed')),
  responsible_person     text check (char_length(responsible_person) <= 200),
  ga_property_ref        text check (char_length(ga_property_ref) <= 200),
  ga4_measurement_id     text check (ga4_measurement_id ~ '^G-[A-Z0-9]{4,15}$'),
  gsc_property           text check (char_length(gsc_property) <= 300 and (gsc_property ~* '^https?://' or gsc_property ~* '^sc-domain:[a-z0-9.-]+$')),
  verification_method    text check (verification_method in ('html_tag', 'html_file', 'dns_txt', 'google_analytics', 'tag_manager', 'domain_provider', 'other')),
  verification_status    text not null default 'not_started' check (verification_status in ('not_started', 'pending', 'verified', 'failed', 'lost')),
  sitemap_url            text check (public.pt_valid_url(sitemap_url)),
  robots_url             text check (public.pt_valid_url(robots_url)),
  audit_date             date,
  last_review_date       date,
  next_review_date       date,
  aeo_status             text not null default 'not_started' check (aeo_status in ('not_started', 'in_progress', 'active', 'not_applicable')),
  geo_status             text not null default 'not_started' check (geo_status in ('not_started', 'in_progress', 'active', 'not_applicable')),
  remarks                text check (char_length(remarks) <= 5000),
  unique (project_id, id)
);

create table public.pt_handovers (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.pt_projects(id),
  status                  text not null default 'draft' check (status in ('draft', 'ready_for_review', 'approved', 'handed_over')),
  recipient_name          text check (char_length(recipient_name) <= 200),
  recipient_organisation  text check (char_length(recipient_organisation) <= 200),
  recipient_email         text check (public.pt_valid_email(recipient_email)),
  handover_date           date,
  approval_document_id    uuid,
  notes                   text check (char_length(notes) <= 5000),
  submitted_at            timestamptz,
  submitted_by_email      text,
  approved_at             timestamptz,
  approved_by             uuid,
  approved_by_email       text,
  handed_over_at          timestamptz,
  handed_over_by          uuid,
  handed_over_by_email    text,
  unique (project_id, id),
  foreign key (project_id, approval_document_id) references public.pt_documents (project_id, id)
);

create table public.pt_handover_items (
  id                    uuid primary key default gen_random_uuid(),
  handover_id           uuid not null,
  project_id            uuid not null,
  item_key              text not null check (item_key in (
                          'client_approval', 'production_verified', 'domain_documented', 'hosting_documented',
                          'admin_access_handed_over', 'email_documented', 'repository_documented', 'latest_backup_verified',
                          'restore_instructions', 'user_guide', 'training_completed', 'amc_terms_documented',
                          'recipient_confirmed', 'handover_date_recorded', 'signed_approval_attached')),
  sort_order            smallint not null,
  state                 text not null default 'pending' check (state in ('pending', 'done', 'not_applicable')),
  evidence_note         text check (char_length(evidence_note) <= 2000),
  evidence_document_id  uuid,
  completed_at          timestamptz,
  completed_by_email    text,
  unique (handover_id, item_key),
  foreign key (project_id, handover_id) references public.pt_handovers (project_id, id),
  foreign key (project_id, evidence_document_id) references public.pt_documents (project_id, id),
  constraint pt_handover_items_done_evidence check (
    state <> 'done' or char_length(btrim(coalesce(evidence_note, ''))) >= 5 or evidence_document_id is not null),
  constraint pt_handover_items_na_reason check (
    state <> 'not_applicable' or char_length(btrim(coalesce(evidence_note, ''))) >= 5)
);

create table public.pt_handover_events (
  id           bigint generated always as identity primary key,
  handover_id  uuid not null references public.pt_handovers(id),
  project_id   uuid not null references public.pt_projects(id),
  from_status  text,
  to_status    text not null,
  comment      text check (char_length(comment) <= 2000),
  actor_id     uuid,
  actor_email  text,
  created_at   timestamptz not null default now()
);
create index pt_handover_events_idx on public.pt_handover_events (handover_id, created_at);

create table public.pt_remarks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.pt_projects(id),
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  unique (project_id, id)
);
create index pt_remarks_project_idx on public.pt_remarks (project_id);

create table public.pt_activity_logs (
  id            bigint generated always as identity primary key,
  project_id    uuid references public.pt_projects(id),
  entity_type   text not null,
  entity_id     uuid,
  entity_label  text,
  action        text not null,
  details       jsonb not null default '{}'::jsonb,
  actor_id      uuid,
  actor_email   text,
  created_at    timestamptz not null default now()
);
create index pt_activity_logs_project_idx on public.pt_activity_logs (project_id, created_at desc);
create index pt_activity_logs_created_idx on public.pt_activity_logs (created_at desc);

-- =====================================================================
-- 4. Common columns on every record table
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'pt_projects', 'pt_hosting', 'pt_domains', 'pt_access_records', 'pt_email_accounts', 'pt_backups',
    'pt_repositories', 'pt_deployments', 'pt_milestones', 'pt_tasks', 'pt_documents', 'pt_updates',
    'pt_amc_contracts', 'pt_renewals', 'pt_seo_records', 'pt_handovers', 'pt_handover_items', 'pt_remarks']
  loop
    execute format($f$
      alter table public.%I
        add column created_at        timestamptz not null default now(),
        add column created_by        uuid,
        add column created_by_email  text,
        add column updated_at        timestamptz not null default now(),
        add column updated_by        uuid,
        add column updated_by_email  text,
        add column archived_at       timestamptz,
        add column archived_by       uuid,
        add column archive_reason    text check (char_length(archive_reason) <= 1000)
    $f$, t);
  end loop;
end $$;

-- Archive consistency for projects: status 'archived' <=> archived_at set.
alter table public.pt_projects
  add constraint pt_projects_archived_consistent check ((status = 'archived') = (archived_at is not null));

-- Uniqueness among ACTIVE (non-archived) records.
create unique index pt_domains_name_uidx on public.pt_domains (project_id, domain_name) where archived_at is null;
create unique index pt_domains_one_primary_uidx on public.pt_domains (project_id) where domain_role = 'primary' and archived_at is null;
create unique index pt_email_unique_purpose_uidx on public.pt_email_accounts (project_id, email_address, purpose) where archived_at is null;
create unique index pt_repositories_url_uidx on public.pt_repositories (project_id, lower(repo_url)) where archived_at is null;
create unique index pt_amc_number_uidx on public.pt_amc_contracts (project_id, upper(contract_number)) where archived_at is null and contract_number is not null;
create unique index pt_seo_one_per_project_uidx on public.pt_seo_records (project_id) where archived_at is null;
create unique index pt_handovers_one_active_uidx on public.pt_handovers (project_id) where archived_at is null;
create index pt_projects_status_idx on public.pt_projects (status);
create index pt_projects_updated_idx on public.pt_projects (updated_at desc);

-- =====================================================================
-- 5. Activity log writer (definer; not executable by API roles)
-- =====================================================================
create or replace function public.pt_log(
  p_project uuid, p_entity text, p_entity_id uuid, p_label text, p_action text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.pt_activity_logs (project_id, entity_type, entity_id, entity_label, action, details, actor_id, actor_email)
  values (p_project, p_entity, p_entity_id, left(p_label, 200), p_action, coalesce(p_details, '{}'::jsonb),
          auth.uid(), nullif(auth.jwt() ->> 'email', ''));
end $$;

-- =====================================================================
-- 6. Triggers
-- =====================================================================

-- 6a. BEFORE INSERT/UPDATE on every record table: stamps, immutability,
--     archive rules, secret detection.
create or replace function public.pt_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new        jsonb := to_jsonb(new);
  v_old        jsonb;
  v_project    uuid;
  v_archived   timestamptz;
  v_key        text;
  v_val        text;
begin
  -- Secret detection on every text value of the row.
  for v_key, v_val in select key, value from jsonb_each_text(v_new) loop
    if v_val is not null and jsonb_typeof(v_new -> v_key) = 'string' and public.pt_looks_like_secret(v_val) then
      raise exception using
        errcode = '22023',
        message = format('The field "%s" looks like it contains a password, key or token.', v_key),
        hint = 'Keep secrets in your password manager and record only a reference to them here.';
    end if;
  end loop;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    new.created_by_email := nullif(auth.jwt() ->> 'email', '');
    new.archived_at := null;
    new.archived_by := null;
  else
    v_old := to_jsonb(old);
    -- immutable columns
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.created_by_email := old.created_by_email;
    if (v_new ? 'project_id') and (v_new ->> 'project_id') is distinct from (v_old ->> 'project_id') then
      raise exception using errcode = '42501', message = 'Records cannot be moved to another project.';
    end if;

    -- archive / restore rules
    if old.archived_at is not null and new.archived_at is not null then
      raise exception using errcode = 'P0001', message = 'This record is archived and read-only. Restore it first.';
    elsif old.archived_at is null and new.archived_at is not null then
      new.archived_at := now();
      new.archived_by := auth.uid();
    elsif old.archived_at is not null and new.archived_at is null then
      if public.pt_is_api_call() and not public.pt_is_manager() then
        raise exception using errcode = '42501', message = 'Only Project Tracker managers can restore archived records.';
      end if;
      new.archived_by := null;
      new.archive_reason := null;
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_email := nullif(auth.jwt() ->> 'email', '');

  -- Child records of an archived project are read-only.
  if tg_table_name <> 'pt_projects' then
    v_project := (v_new ->> 'project_id')::uuid;
    select p.archived_at into v_archived from public.pt_projects p where p.id = v_project;
    if v_archived is not null then
      raise exception using errcode = 'P0001', message = 'This project is archived and read-only. Restore the project first.';
    end if;
  end if;
  return new;
end $$;

-- 6b. Project-specific rules (runs after 6a because of trigger name order).
create or replace function public.pt_projects_rules()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.project_code := upper(nullif(btrim(coalesce(new.project_code, '')), ''));
    if new.project_code is null then
      new.project_code := 'ZT-PRJ-' || lpad(new.serial_no::text, 4, '0');
    end if;
    if new.status = 'archived' then
      raise exception using errcode = '22023', message = 'A new project cannot start as Archived.';
    end if;
  else
    new.serial_no := old.serial_no;
    new.project_code := upper(btrim(new.project_code));
  end if;
  if new.project_code ~ '^ZT-PRJ-' and new.project_code <> 'ZT-PRJ-' || lpad(new.serial_no::text, 4, '0') then
    raise exception using errcode = '22023',
      message = 'Project IDs starting with ZT-PRJ- are reserved for automatic numbering. Leave the ID blank or use another prefix.';
  end if;
  if tg_op = 'UPDATE' then
    if old.archived_at is null and new.archived_at is not null then
      new.status_before_archive := old.status;
      new.status := 'archived';
    elsif old.archived_at is not null and new.archived_at is null then
      new.status := coalesce(old.status_before_archive, 'planned');
      new.status_before_archive := null;
    elsif new.status = 'archived' and old.status <> 'archived' then
      raise exception using errcode = '22023', message = 'Use Archive to archive a project (status alone cannot be set to Archived).';
    end if;
  end if;
  return new;
end $$;

-- 6c. Code generators for backups / tasks / updates.
create or replace function public.pt_set_codes()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.seq_no := old.seq_no;
  end if;
  if tg_table_name = 'pt_backups' then
    new.backup_code := 'BK-' || lpad(new.seq_no::text, 5, '0');
  elsif tg_table_name = 'pt_tasks' then
    new.task_code := 'TSK-' || lpad(new.seq_no::text, 5, '0');
  elsif tg_table_name = 'pt_updates' then
    new.update_code := 'UPD-' || lpad(new.seq_no::text, 5, '0');
  end if;
  return new;
end $$;

-- 6d. Table-specific business rules.
create or replace function public.pt_backups_rules()
returns trigger
language plpgsql
as $$
begin
  if new.backup_at is not null and new.backup_at > now() + interval '10 minutes' and new.status in ('completed', 'verified') then
    raise exception using errcode = '22023', message = 'A completed backup cannot have a date in the future.';
  end if;
  if new.status = 'verified' and new.verified_on is not null and new.backup_at is not null and new.verified_on < new.backup_at::date then
    raise exception using errcode = '22023', message = 'Verification date cannot be before the backup date.';
  end if;
  if new.verified_on is not null and new.verified_on > public.pt_today() then
    raise exception using errcode = '22023', message = 'Verification date cannot be in the future.';
  end if;
  if new.restore_tested and new.restore_tested_on > public.pt_today() then
    raise exception using errcode = '22023', message = 'Restore test date cannot be in the future.';
  end if;
  return new;
end $$;

create or replace function public.pt_email_rules()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.email_address := lower(btrim(new.email_address));
  if new.archived_at is null and exists (
       select 1 from public.pt_email_accounts e
        where e.project_id = new.project_id and e.email_address = new.email_address and e.purpose = new.purpose
          and e.archived_at is null and e.id <> new.id) then
    raise exception using errcode = '23505',
      message = format('%s is already recorded for this project with the same purpose (duplicate).', new.email_address);
  end if;
  if new.archived_at is null and exists (
       select 1 from public.pt_email_accounts e
        where e.project_id = new.project_id and e.email_address = new.email_address
          and e.archived_at is null and e.id <> new.id)
     and char_length(btrim(coalesce(new.reuse_justification, ''))) < 5 then
    raise exception using errcode = '23505',
      message = format('%s is already recorded for this project. Add a reuse justification to record it again for another purpose.', new.email_address);
  end if;
  return new;
end $$;

create or replace function public.pt_domains_rules()
returns trigger
language plpgsql
as $$
begin
  new.domain_name := lower(btrim(new.domain_name));
  if new.ssl_expires_on is not null and coalesce(new.ssl_type, '') = 'none' then
    raise exception using errcode = '22023', message = 'SSL expiry is set but SSL type is "None".';
  end if;
  return new;
end $$;

-- Handover guard: content may only change while the handover is a draft,
-- and status / approval columns change only through pt_handover_transition.
create or replace function public.pt_handovers_rules()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('pt.handover_rpc', true), '') <> 'on' then
    if old.status <> 'draft'
       and (new.recipient_name, new.recipient_organisation, new.recipient_email, new.handover_date, new.approval_document_id, new.notes)
           is distinct from
           (old.recipient_name, old.recipient_organisation, old.recipient_email, old.handover_date, old.approval_document_id, old.notes) then
      raise exception using errcode = 'P0001',
        message = 'This handover is under review or approved. Send it back to Draft before changing it.';
    end if;
    if old.archived_at is null and new.archived_at is not null and old.status <> 'draft' and public.pt_is_api_call() and not public.pt_is_manager() then
      raise exception using errcode = '42501', message = 'Only managers can archive a handover that has left Draft.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.pt_handover_items_rules()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status   text;
  v_ho       public.pt_handovers%rowtype;
  v_amc      boolean;
begin
  if coalesce(current_setting('pt.handover_rpc', true), '') = 'on' then
    return new;
  end if;
  select * into v_ho from public.pt_handovers h where h.id = new.handover_id;
  v_status := v_ho.status;
  if v_status <> 'draft' then
    raise exception using errcode = 'P0001',
      message = 'Checklist items can only change while the handover is a Draft.';
  end if;
  if tg_op = 'UPDATE' then
    new.item_key := old.item_key;
    new.handover_id := old.handover_id;
    new.sort_order := old.sort_order;
  end if;
  if new.state = 'done' then
    if new.item_key = 'signed_approval_attached' and new.evidence_document_id is null then
      raise exception using errcode = '22023', message = 'Attach the signed approval document as evidence for this item.';
    end if;
    if new.item_key = 'latest_backup_verified' and not exists (
         select 1 from public.pt_backups b where b.project_id = new.project_id and b.archived_at is null and b.status = 'verified') then
      raise exception using errcode = '22023', message = 'No verified backup is recorded for this project. Record a backup verification first.';
    end if;
    if new.item_key = 'handover_date_recorded' and v_ho.handover_date is null then
      raise exception using errcode = '22023', message = 'Enter the handover date on the handover record first.';
    end if;
    if new.item_key = 'recipient_confirmed' and nullif(btrim(coalesce(v_ho.recipient_name, '')), '') is null then
      raise exception using errcode = '22023', message = 'Enter the handover recipient first.';
    end if;
  end if;
  if new.state = 'not_applicable' and new.item_key in ('client_approval', 'signed_approval_attached', 'recipient_confirmed', 'handover_date_recorded') then
    raise exception using errcode = '22023', message = 'This checklist item is mandatory and cannot be marked Not applicable.';
  end if;
  if new.state = 'not_applicable' and new.item_key = 'amc_terms_documented' then
    select p.amc_applicable into v_amc from public.pt_projects p where p.id = new.project_id;
    if v_amc then
      raise exception using errcode = '22023', message = 'AMC is marked applicable for this project, so AMC terms must be documented.';
    end if;
  end if;
  if new.state = 'done' and (tg_op = 'INSERT' or old.state <> 'done') then
    new.completed_at := now();
    new.completed_by_email := nullif(auth.jwt() ->> 'email', '');
  elsif new.state <> 'done' then
    new.completed_at := null;
    new.completed_by_email := null;
  end if;
  return new;
end $$;

-- 6e. AFTER INSERT/UPDATE: activity log with safe metadata only (field
--     names and status transitions — never field values).
create or replace function public.pt_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity   text := tg_argv[0];
  v_label_c  text := tg_argv[1];
  v_new      jsonb := to_jsonb(new);
  v_old      jsonb;
  v_project  uuid;
  v_label    text;
  v_changed  text[];
  v_action   text;
  v_details  jsonb := '{}'::jsonb;
  v_status_c text;
begin
  v_project := case when tg_table_name = 'pt_projects' then new.id else (v_new ->> 'project_id')::uuid end;
  v_label := v_new ->> v_label_c;
  v_status_c := case when tg_table_name = 'pt_seo_records' then 'seo_status'
                     when tg_table_name = 'pt_handover_items' then 'state'
                     else 'status' end;

  if tg_op = 'INSERT' and tg_table_name = 'pt_handover_items' then
    return null;   -- the 15 checklist rows are created with the handover
  end if;
  if tg_op = 'INSERT' then
    v_action := v_entity || '.created';
  else
    v_old := to_jsonb(old);
    select coalesce(array_agg(k order by k), '{}') into v_changed
      from jsonb_object_keys(v_new) k
     where k not in ('updated_at', 'updated_by', 'updated_by_email', 'created_at', 'created_by', 'created_by_email',
                     'archived_by', 'has_reference', 'identifier_hint', 'reference_updated_at',
                     'completed_at', 'completed_by_email', 'status_before_archive')
       and (v_new -> k) is distinct from (v_old -> k);
    if cardinality(v_changed) = 0 then
      return null;
    end if;
    if (v_old ->> 'archived_at') is null and (v_new ->> 'archived_at') is not null then
      v_action := v_entity || '.archived';
      v_details := jsonb_build_object('reason', v_new ->> 'archive_reason');
    elsif (v_old ->> 'archived_at') is not null and (v_new ->> 'archived_at') is null then
      v_action := v_entity || '.restored';
    elsif (v_new ? v_status_c) and (v_new ->> v_status_c) is distinct from (v_old ->> v_status_c) then
      v_action := case
        when v_entity = 'backup' and v_new ->> 'status' = 'verified' then 'backup.verified'
        when v_entity = 'amc' and v_new ->> 'status' = 'renewed' then 'amc.renewed'
        when v_entity = 'renewal' and v_new ->> 'status' = 'completed' then 'renewal.completed'
        when v_entity = 'handover' and v_new ->> 'status' = 'approved' then 'handover.approved'
        when v_entity = 'handover' and v_new ->> 'status' = 'handed_over' then 'handover.completed'
        else v_entity || '.status_changed' end;
      v_details := jsonb_build_object('from', v_old ->> v_status_c, 'to', v_new ->> v_status_c, 'fields', to_jsonb(v_changed));
    else
      v_action := v_entity || '.updated';
      v_details := jsonb_build_object('fields', to_jsonb(v_changed));
    end if;
  end if;

  perform public.pt_log(v_project, v_entity, (v_new ->> 'id')::uuid, v_label, v_action, v_details);
  return null;
end $$;

-- Activity logs and handover events are append-only.
create or replace function public.pt_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = '42501', message = format('%s is append-only.', tg_table_name);
end $$;

-- Attach triggers.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('pt_projects', 'project', 'name'),
      ('pt_hosting', 'hosting', 'provider'),
      ('pt_domains', 'domain', 'domain_name'),
      ('pt_access_records', 'access', 'service_name'),
      ('pt_email_accounts', 'email', 'email_address'),
      ('pt_backups', 'backup', 'name'),
      ('pt_repositories', 'repository', 'repo_url'),
      ('pt_deployments', 'deployment', 'release_version'),
      ('pt_milestones', 'milestone', 'name'),
      ('pt_tasks', 'task', 'title'),
      ('pt_documents', 'document', 'name'),
      ('pt_updates', 'update', 'update_type'),
      ('pt_amc_contracts', 'amc', 'contract_number'),
      ('pt_renewals', 'renewal', 'item_label'),
      ('pt_seo_records', 'seo', 'seo_status'),
      ('pt_handovers', 'handover', 'status'),
      ('pt_handover_items', 'handover_item', 'item_key'),
      ('pt_remarks', 'remark', 'id')
    ) v(tbl, entity, label_col)
  loop
    execute format('create trigger pt_10_before_write before insert or update on public.%I for each row execute function public.pt_before_write()', r.tbl);
    execute format('create trigger pt_90_after_write after insert or update on public.%I for each row execute function public.pt_after_write(%L, %L)', r.tbl, r.entity, r.label_col);
  end loop;
end $$;

create trigger pt_20_rules before insert or update on public.pt_projects for each row execute function public.pt_projects_rules();
create trigger pt_15_codes before insert or update on public.pt_backups for each row execute function public.pt_set_codes();
create trigger pt_15_codes before insert or update on public.pt_tasks for each row execute function public.pt_set_codes();
create trigger pt_15_codes before insert or update on public.pt_updates for each row execute function public.pt_set_codes();
create trigger pt_20_rules before insert or update on public.pt_backups for each row execute function public.pt_backups_rules();
create trigger pt_20_rules before insert or update on public.pt_email_accounts for each row execute function public.pt_email_rules();
create trigger pt_20_rules before insert or update on public.pt_domains for each row execute function public.pt_domains_rules();
create trigger pt_20_rules before update on public.pt_handovers for each row execute function public.pt_handovers_rules();
create trigger pt_20_rules before insert or update on public.pt_handover_items for each row execute function public.pt_handover_items_rules();
create trigger pt_append_only before update or delete on public.pt_activity_logs for each row execute function public.pt_append_only();
create trigger pt_append_only before update or delete on public.pt_handover_events for each row execute function public.pt_append_only();

-- =====================================================================
-- 7. RPCs
-- =====================================================================

-- 7a. The caller's role (for the UI). NULL = no access.
create or replace function public.pt_my_role() returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select public.pt_role() $$;

-- 7b. Credential references.
create or replace function public.pt_set_access_reference(p_record uuid, p_account_identifier text, p_vault_reference text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec public.pt_access_records%rowtype;
  v_project_archived timestamptz;
  v_ident text := nullif(btrim(coalesce(p_account_identifier, '')), '');
  v_ref   text := nullif(btrim(coalesce(p_vault_reference, '')), '');
begin
  if not public.pt_can_edit() then
    raise exception using errcode = '42501', message = 'You do not have permission to change credential references.';
  end if;
  select * into v_rec from public.pt_access_records where id = p_record;
  if not found then
    raise exception using errcode = 'P0002', message = 'Access record not found.';
  end if;
  select archived_at into v_project_archived from public.pt_projects where id = v_rec.project_id;
  if v_rec.archived_at is not null or v_project_archived is not null then
    raise exception using errcode = 'P0001', message = 'This record is archived and read-only.';
  end if;
  if v_ref is null or char_length(v_ref) < 3 or char_length(v_ref) > 300 then
    raise exception using errcode = '22023', message = 'Enter a password-manager reference (3 to 300 characters).';
  end if;
  if v_ident is not null and char_length(v_ident) > 200 then
    raise exception using errcode = '22023', message = 'The account identifier is too long (200 characters max).';
  end if;
  if public.pt_looks_like_secret(v_ref) or public.pt_looks_like_secret(v_ident) then
    raise exception using errcode = '22023',
      message = 'That looks like a password, key or token. Store the secret in your password manager and enter only its reference here.';
  end if;

  insert into public.pt_access_refs (access_record_id, project_id, account_identifier, vault_reference, updated_at, updated_by, updated_by_email)
  values (v_rec.id, v_rec.project_id, v_ident, v_ref, now(), auth.uid(), nullif(auth.jwt() ->> 'email', ''))
  on conflict (access_record_id) do update
    set account_identifier = excluded.account_identifier,
        vault_reference = excluded.vault_reference,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by,
        updated_by_email = excluded.updated_by_email;

  update public.pt_access_records
     set has_reference = true,
         identifier_hint = public.pt_mask_identifier(v_ident),
         reference_updated_at = now()
   where id = v_rec.id;

  perform public.pt_log(v_rec.project_id, 'access', v_rec.id, v_rec.service_name, 'access.reference_changed', '{}'::jsonb);
end $$;

create or replace function public.pt_reveal_access_reference(p_record uuid)
returns table (account_identifier text, vault_reference text, updated_at timestamptz, updated_by_email text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec public.pt_access_records%rowtype;
begin
  if not public.pt_is_manager() then
    raise exception using errcode = '42501', message = 'Only Project Tracker managers can view credential references.';
  end if;
  select * into v_rec from public.pt_access_records where id = p_record;
  if not found then
    raise exception using errcode = 'P0002', message = 'Access record not found.';
  end if;
  perform public.pt_log(v_rec.project_id, 'access', v_rec.id, v_rec.service_name, 'access.reference_viewed', '{}'::jsonb);
  return query
    select r.account_identifier, r.vault_reference, r.updated_at, r.updated_by_email
      from public.pt_access_refs r where r.access_record_id = p_record;
end $$;

-- 7c. Handover workflow.
create or replace function public.pt_start_handover(p_project uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_archived timestamptz;
  v_keys text[] := array[
    'client_approval', 'production_verified', 'domain_documented', 'hosting_documented',
    'admin_access_handed_over', 'email_documented', 'repository_documented', 'latest_backup_verified',
    'restore_instructions', 'user_guide', 'training_completed', 'amc_terms_documented',
    'recipient_confirmed', 'handover_date_recorded', 'signed_approval_attached'];
  i int;
begin
  if not public.pt_can_edit() then
    raise exception using errcode = '42501', message = 'You do not have permission to start a handover.';
  end if;
  select archived_at into v_archived from public.pt_projects where id = p_project;
  if not found then
    raise exception using errcode = 'P0002', message = 'Project not found.';
  end if;
  if v_archived is not null then
    raise exception using errcode = 'P0001', message = 'This project is archived and read-only.';
  end if;
  if exists (select 1 from public.pt_handovers where project_id = p_project and archived_at is null) then
    raise exception using errcode = '23505', message = 'This project already has an active handover record.';
  end if;

  perform set_config('pt.handover_rpc', 'on', true);
  insert into public.pt_handovers (project_id, status) values (p_project, 'draft') returning id into v_id;
  for i in 1 .. array_length(v_keys, 1) loop
    insert into public.pt_handover_items (handover_id, project_id, item_key, sort_order) values (v_id, p_project, v_keys[i], i);
  end loop;
  insert into public.pt_handover_events (handover_id, project_id, from_status, to_status, comment, actor_id, actor_email)
  values (v_id, p_project, null, 'draft', 'Handover started', auth.uid(), nullif(auth.jwt() ->> 'email', ''));
  perform set_config('pt.handover_rpc', '', true);
  return v_id;
end $$;

create or replace function public.pt_handover_transition(p_handover uuid, p_to text, p_comment text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ho        public.pt_handovers%rowtype;
  v_from      text;
  v_comment   text := nullif(btrim(coalesce(p_comment, '')), '');
  v_pending   int;
  v_doc_cat   text;
  v_archived  timestamptz;
begin
  if not public.pt_can_edit() then
    raise exception using errcode = '42501', message = 'You do not have permission to change this handover.';
  end if;
  select * into v_ho from public.pt_handovers where id = p_handover for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Handover not found.';
  end if;
  select archived_at into v_archived from public.pt_projects where id = v_ho.project_id;
  if v_ho.archived_at is not null or v_archived is not null then
    raise exception using errcode = 'P0001', message = 'This handover or its project is archived.';
  end if;
  v_from := v_ho.status;
  if public.pt_looks_like_secret(v_comment) then
    raise exception using errcode = '22023', message = 'The comment looks like it contains a secret.';
  end if;

  if v_from = 'draft' and p_to = 'ready_for_review' then
    select count(*) into v_pending from public.pt_handover_items where handover_id = p_handover and state = 'pending';
    if v_pending > 0 then
      raise exception using errcode = '22023', message = format('%s checklist item(s) are still pending.', v_pending);
    end if;
    if nullif(btrim(coalesce(v_ho.recipient_name, '')), '') is null or v_ho.handover_date is null then
      raise exception using errcode = '22023', message = 'Enter the recipient and the handover date before submitting for review.';
    end if;
    if v_ho.approval_document_id is null then
      raise exception using errcode = '22023', message = 'Attach the signed approval document before submitting for review.';
    end if;
    perform set_config('pt.handover_rpc', 'on', true);
    update public.pt_handovers
       set status = 'ready_for_review', submitted_at = now(), submitted_by_email = nullif(auth.jwt() ->> 'email', '')
     where id = p_handover;

  elsif v_from = 'ready_for_review' and p_to = 'approved' then
    if not public.pt_is_manager() then
      raise exception using errcode = '42501', message = 'Only Project Tracker managers can approve a handover.';
    end if;
    select d.category into v_doc_cat from public.pt_documents d where d.id = v_ho.approval_document_id and d.archived_at is null;
    if v_doc_cat is null or v_doc_cat not in ('client_approval', 'completion_certificate', 'admin_access_handover', 'agreement') then
      raise exception using errcode = '22023',
        message = 'The approval document must be an active Client Approval, Completion Certificate, Admin Access Handover or Agreement document.';
    end if;
    perform set_config('pt.handover_rpc', 'on', true);
    update public.pt_handovers
       set status = 'approved', approved_at = now(), approved_by = auth.uid(), approved_by_email = nullif(auth.jwt() ->> 'email', '')
     where id = p_handover;

  elsif v_from = 'approved' and p_to = 'handed_over' then
    if not public.pt_is_manager() then
      raise exception using errcode = '42501', message = 'Only Project Tracker managers can record a completed handover.';
    end if;
    if v_ho.handover_date > public.pt_today() then
      raise exception using errcode = '22023', message = 'The handover date is in the future. Record completion on or after the handover date.';
    end if;
    if v_comment is null or char_length(v_comment) < 10 then
      raise exception using errcode = '22023', message = 'Describe how the handover was confirmed (at least 10 characters).';
    end if;
    perform set_config('pt.handover_rpc', 'on', true);
    update public.pt_handovers
       set status = 'handed_over', handed_over_at = now(), handed_over_by = auth.uid(), handed_over_by_email = nullif(auth.jwt() ->> 'email', '')
     where id = p_handover;

  elsif p_to = 'draft' and v_from in ('ready_for_review', 'approved', 'handed_over') then
    if v_from in ('approved', 'handed_over') and not public.pt_is_manager() then
      raise exception using errcode = '42501', message = 'Only Project Tracker managers can reopen an approved handover.';
    end if;
    if v_comment is null or char_length(v_comment) < 5 then
      raise exception using errcode = '22023', message = 'Give a reason for sending the handover back to Draft.';
    end if;
    perform set_config('pt.handover_rpc', 'on', true);
    update public.pt_handovers
       set status = 'draft', approved_at = null, approved_by = null, approved_by_email = null,
           handed_over_at = null, handed_over_by = null, handed_over_by_email = null
     where id = p_handover;

  else
    raise exception using errcode = '22023', message = format('A handover cannot move from %s to %s.', v_from, p_to);
  end if;

  insert into public.pt_handover_events (handover_id, project_id, from_status, to_status, comment, actor_id, actor_email)
  values (p_handover, v_ho.project_id, v_from, p_to, v_comment, auth.uid(), nullif(auth.jwt() ->> 'email', ''));
  perform set_config('pt.handover_rpc', '', true);
  return p_to;
end $$;

-- 7d. Renewals (SECURITY INVOKER: RLS and triggers apply as usual).
create or replace function public.pt_complete_renewal(
  p_renewal uuid, p_completed_on date, p_new_expiry date, p_evidence text, p_completed_by text default null)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_r public.pt_renewals%rowtype;
begin
  if not public.pt_can_edit() then
    raise exception using errcode = '42501', message = 'You do not have permission to complete renewals.';
  end if;
  select * into v_r from public.pt_renewals where id = p_renewal;
  if not found then
    raise exception using errcode = 'P0002', message = 'Renewal not found.';
  end if;
  if v_r.status <> 'upcoming' then
    raise exception using errcode = '22023', message = 'Only upcoming renewals can be completed.';
  end if;
  if p_completed_on is null or p_completed_on > public.pt_today() then
    raise exception using errcode = '22023', message = 'Enter the date the renewal was completed (not in the future).';
  end if;
  if p_new_expiry is not null and p_new_expiry <= p_completed_on then
    raise exception using errcode = '22023', message = 'The new expiry date must be after the completion date.';
  end if;
  update public.pt_renewals
     set status = 'completed', completed_on = p_completed_on, new_expiry_date = p_new_expiry,
         completion_evidence = p_evidence, completed_by_name = coalesce(nullif(btrim(p_completed_by), ''), auth.jwt() ->> 'email')
   where id = p_renewal;
  if p_new_expiry is not null then
    if v_r.item_type = 'domain' and v_r.domain_id is not null then
      update public.pt_domains set expires_on = p_new_expiry where id = v_r.domain_id;
    elsif v_r.item_type = 'ssl' and v_r.domain_id is not null then
      update public.pt_domains set ssl_expires_on = p_new_expiry where id = v_r.domain_id;
    elsif v_r.item_type = 'hosting' and v_r.hosting_id is not null then
      update public.pt_hosting set renewal_date = p_new_expiry, expiry_date = p_new_expiry where id = v_r.hosting_id;
    end if;
  end if;
end $$;

create or replace function public.pt_renew_amc(
  p_contract uuid, p_start date, p_end date, p_renewal_date date default null, p_contract_number text default null)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_c public.pt_amc_contracts%rowtype;
  v_new uuid;
begin
  if not public.pt_can_edit() then
    raise exception using errcode = '42501', message = 'You do not have permission to renew AMC contracts.';
  end if;
  select * into v_c from public.pt_amc_contracts where id = p_contract;
  if not found then
    raise exception using errcode = 'P0002', message = 'AMC contract not found.';
  end if;
  if v_c.status not in ('active', 'expired') then
    raise exception using errcode = '22023', message = 'Only active or expired contracts can be renewed.';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception using errcode = '22023', message = 'Enter a valid new contract period.';
  end if;
  update public.pt_amc_contracts set status = 'renewed' where id = p_contract;
  insert into public.pt_amc_contracts (
    project_id, contract_number, service_scope, start_date, end_date, renewal_date, status, maintenance_frequency,
    support_terms, responsible_person, client_contact, contract_value, currency, renewed_from_id, remarks)
  values (
    v_c.project_id, coalesce(nullif(btrim(p_contract_number), ''), null), v_c.service_scope, p_start, p_end, p_renewal_date, 'active',
    v_c.maintenance_frequency, v_c.support_terms, v_c.responsible_person, v_c.client_contact, v_c.contract_value, v_c.currency,
    v_c.id, null)
  returning id into v_new;
  return v_new;
end $$;

-- 7e. Role management (managers only).
create or replace function public.pt_list_members()
returns table (user_id uuid, email text, role text, note text, granted_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.pt_is_manager() then
    raise exception using errcode = '42501', message = 'Only Project Tracker managers can view role assignments.';
  end if;
  return query
    select m.user_id, u.email::text, m.role, m.note, m.granted_at
      from public.pt_members m join auth.users u on u.id = m.user_id
     order by u.email;
end $$;

create or replace function public.pt_set_member_role(p_email text, p_role text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_managers int;
begin
  if not public.pt_is_manager() then
    raise exception using errcode = '42501', message = 'Only Project Tracker managers can change roles.';
  end if;
  if p_role not in ('no_access', 'viewer', 'editor', 'manager', 'default') then
    raise exception using errcode = '22023', message = 'Unknown role.';
  end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception using errcode = 'P0002', message = 'No user account exists with that email.';
  end if;
  if v_user = auth.uid() and p_role <> 'manager' then
    select count(*) into v_managers from public.pt_members where role = 'manager' and user_id <> v_user;
    if v_managers = 0 then
      raise exception using errcode = '22023', message = 'You are the only manager. Make someone else a manager first.';
    end if;
  end if;
  if p_role = 'default' then
    delete from public.pt_members where user_id = v_user;
  else
    insert into public.pt_members (user_id, role, note, granted_by, granted_at)
    values (v_user, p_role, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
    on conflict (user_id) do update set role = excluded.role, note = excluded.note, granted_by = excluded.granted_by, granted_at = now();
  end if;
  perform public.pt_log(null, 'member', v_user, null, 'member.role_changed', jsonb_build_object('role', p_role));
end $$;

-- 7f. Used by storage policies: does a document row reference this path?
--     (Bypasses RLS on purpose so restricted files are never mistaken for orphans.)
create or replace function public.pt_document_path_exists(p_path text) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select public.pt_can_read() and exists (select 1 from public.pt_documents where storage_path = p_path) $$;

-- Project folder in storage must belong to an active project.
create or replace function public.pt_project_is_active(p_project text) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.pt_can_edit()
     and p_project ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from public.pt_projects where id = p_project::uuid and archived_at is null)
$$;

-- =====================================================================
-- 8. Views (security_invoker: the caller's RLS applies)
-- =====================================================================

create view public.pt_project_health with (security_invoker = true) as
with base as (
  select
    p.id as project_id,
    p.status,
    (p.status in ('live', 'under_maintenance', 'completed')) as is_live,
    -- overview
    case
      when nullif(btrim(coalesce(p.description, '')), '') is not null
       and nullif(btrim(coalesce(p.scope, '')), '') is not null
       and nullif(btrim(coalesce(p.responsible_person, '')), '') is not null
       and p.start_date is not null then 'complete'
      when nullif(btrim(coalesce(p.responsible_person, '')), '') is not null
        or nullif(btrim(coalesce(p.description, '')), '') is not null then 'partial'
      else 'missing' end as overview_state,
    -- hosting
    case
      when 'hosting' = any (p.not_applicable_sections) then 'na'
      when exists (select 1 from public.pt_hosting h where h.project_id = p.id and h.archived_at is null and h.status = 'active'
                     and h.environment = 'production' and coalesce(h.renewal_date, h.expiry_date) is not null
                     and nullif(btrim(coalesce(h.responsible_person, '')), '') is not null) then 'complete'
      when exists (select 1 from public.pt_hosting h where h.project_id = p.id and h.archived_at is null and h.status = 'active') then 'partial'
      else 'missing' end as hosting_state,
    -- domain
    case
      when 'domain' = any (p.not_applicable_sections) then 'na'
      when exists (select 1 from public.pt_domains d where d.project_id = p.id and d.archived_at is null and d.status = 'active'
                     and d.expires_on is not null and nullif(btrim(coalesce(d.registrar, '')), '') is not null
                     and (d.ssl_expires_on is not null or d.ssl_type in ('managed_auto', 'none'))) then 'complete'
      when exists (select 1 from public.pt_domains d where d.project_id = p.id and d.archived_at is null) then 'partial'
      else 'missing' end as domain_state,
    -- admin access
    case
      when 'admin_access' = any (p.not_applicable_sections) then 'na'
      when exists (select 1 from public.pt_access_records a where a.project_id = p.id and a.archived_at is null and a.status = 'active'
                     and a.category in ('website_admin', 'hosting_panel') and a.has_reference) then 'complete'
      when exists (select 1 from public.pt_access_records a where a.project_id = p.id and a.archived_at is null) then 'partial'
      else 'missing' end as admin_access_state,
    -- backups
    case
      when 'backups' = any (p.not_applicable_sections) then 'na'
      when exists (select 1 from public.pt_backups b where b.project_id = p.id and b.archived_at is null and b.status = 'verified'
                     and b.verified_on >= public.pt_today() - 90)
       and exists (select 1 from public.pt_backups b where b.project_id = p.id and b.archived_at is null
                     and nullif(btrim(coalesce(b.restore_instructions, '')), '') is not null) then 'complete'
      when exists (select 1 from public.pt_backups b where b.project_id = p.id and b.archived_at is null) then 'partial'
      else 'missing' end as backups_state,
    -- source code
    case
      when 'source' = any (p.not_applicable_sections) then 'na'
      when exists (select 1 from public.pt_repositories r where r.project_id = p.id and r.archived_at is null
                     and nullif(btrim(coalesce(r.deployment_branch, r.main_branch, '')), '') is not null) then 'complete'
      when exists (select 1 from public.pt_repositories r where r.project_id = p.id and r.archived_at is null) then 'partial'
      else 'missing' end as source_state,
    -- maintenance (applies once a project is live)
    case
      when 'maintenance' = any (p.not_applicable_sections) or p.status not in ('live', 'under_maintenance', 'completed') then 'na'
      when exists (select 1 from public.pt_updates u where u.project_id = p.id and u.archived_at is null and u.update_date >= public.pt_today() - 180) then 'complete'
      when exists (select 1 from public.pt_updates u where u.project_id = p.id and u.archived_at is null) then 'partial'
      else 'missing' end as maintenance_state,
    -- AMC (only when applicable)
    case
      when not p.amc_applicable then 'na'
      when exists (select 1 from public.pt_amc_contracts c where c.project_id = p.id and c.archived_at is null and c.status = 'active'
                     and c.end_date >= public.pt_today()) then 'complete'
      when exists (select 1 from public.pt_amc_contracts c where c.project_id = p.id and c.archived_at is null) then 'partial'
      else 'missing' end as amc_state,
    -- SEO (only when applicable)
    case
      when not p.seo_applicable then 'na'
      when exists (select 1 from public.pt_seo_records s where s.project_id = p.id and s.archived_at is null
                     and s.verification_status = 'verified' and nullif(btrim(coalesce(s.gsc_property, '')), '') is not null
                     and coalesce(s.ga4_measurement_id, s.ga_property_ref) is not null and s.sitemap_url is not null) then 'complete'
      when exists (select 1 from public.pt_seo_records s where s.project_id = p.id and s.archived_at is null) then 'partial'
      else 'missing' end as seo_state,
    -- handover (due once live/completed, or once one has been started)
    case
      when 'handover' = any (p.not_applicable_sections) then 'na'
      when exists (select 1 from public.pt_handovers ho where ho.project_id = p.id and ho.archived_at is null and ho.status = 'handed_over') then 'complete'
      when exists (select 1 from public.pt_handovers ho where ho.project_id = p.id and ho.archived_at is null) then 'partial'
      when p.status in ('live', 'under_maintenance', 'completed') then 'missing'
      else 'na' end as handover_state,
    (select max(b.backup_at) from public.pt_backups b where b.project_id = p.id and b.archived_at is null and b.status in ('completed', 'verified')) as last_backup_at,
    (select max(b.verified_on) from public.pt_backups b where b.project_id = p.id and b.archived_at is null and b.status = 'verified') as last_backup_verified_on,
    (select max(u.update_date) from public.pt_updates u where u.project_id = p.id and u.archived_at is null) as latest_update_date,
    (select count(*) from public.pt_tasks t where t.project_id = p.id and t.archived_at is null
        and t.status not in ('done', 'cancelled') and t.due_date < public.pt_today()) as overdue_tasks,
    (select ho.status from public.pt_handovers ho where ho.project_id = p.id and ho.archived_at is null limit 1) as handover_status,
    p.not_applicable_sections
  from public.pt_projects p
),
scored as (
  select b.*,
    (select count(*) from unnest(array[b.overview_state, b.hosting_state, b.domain_state, b.admin_access_state, b.backups_state,
                                       b.source_state, b.maintenance_state, b.amc_state, b.seo_state, b.handover_state]) s where s <> 'na') as applicable_sections,
    (select coalesce(sum(case s when 'complete' then 1.0 when 'partial' then 0.5 else 0 end), 0)
       from unnest(array[b.overview_state, b.hosting_state, b.domain_state, b.admin_access_state, b.backups_state,
                         b.source_state, b.maintenance_state, b.amc_state, b.seo_state, b.handover_state]) s where s <> 'na') as points
  from base b
)
select
  s.project_id,
  s.overview_state, s.hosting_state, s.domain_state, s.admin_access_state, s.backups_state,
  s.source_state, s.maintenance_state, s.amc_state, s.seo_state, s.handover_state,
  s.applicable_sections,
  case when s.applicable_sections = 0 then 100 else round(100 * s.points / s.applicable_sections)::int end as completeness_score,
  case
    when s.overview_state = 'missing'
      or (s.is_live and 'missing' in (s.hosting_state, s.domain_state, s.admin_access_state, s.backups_state)) then 'missing_critical'
    when s.points = s.applicable_sections then 'complete'
    else 'partial' end as completeness_label,
  s.last_backup_at,
  s.last_backup_verified_on,
  (s.backups_state <> 'na' and s.is_live and (s.last_backup_at is null or s.last_backup_at < now() - interval '35 days')) as backup_missing,
  (s.backups_state <> 'na' and s.is_live and s.last_backup_at is not null
     and (s.last_backup_verified_on is null or s.last_backup_verified_on < public.pt_today() - 90)) as backup_verification_overdue,
  (s.admin_access_state in ('missing', 'partial')) as admin_details_missing,
  (s.handover_state in ('missing', 'partial')) as handover_pending,
  s.handover_status,
  s.latest_update_date,
  s.overdue_tasks,
  (select l.created_at from public.pt_activity_logs l where l.project_id = s.project_id order by l.created_at desc, l.id desc limit 1) as last_activity_at,
  (select l.actor_email from public.pt_activity_logs l where l.project_id = s.project_id order by l.created_at desc, l.id desc limit 1) as last_activity_by
from scored s;

create view public.pt_project_list with (security_invoker = true) as
select p.*, h.overview_state, h.hosting_state, h.domain_state, h.admin_access_state, h.backups_state, h.source_state,
       h.maintenance_state, h.amc_state, h.seo_state, h.handover_state, h.applicable_sections, h.completeness_score,
       h.completeness_label, h.last_backup_at, h.last_backup_verified_on, h.backup_missing, h.backup_verification_overdue,
       h.admin_details_missing, h.handover_pending, h.handover_status, h.latest_update_date, h.overdue_tasks,
       h.last_activity_at, h.last_activity_by
  from public.pt_projects p
  join public.pt_project_health h on h.project_id = p.id;

-- Every dated obligation (renewals, expiries) of active records of active projects.
create view public.pt_due_items with (security_invoker = true) as
select x.*, p.name as project_name, p.project_code, p.client_name, (x.due_date - public.pt_today()) as days_left
from (
  select h.project_id, 'hosting'::text as kind, 'pt_hosting'::text as source_table, h.id as record_id,
         h.provider || ' · ' || h.environment || ' · ' || h.purpose as label, h.renewal_date as due_date, h.auto_renew, h.responsible_person
    from public.pt_hosting h where h.archived_at is null and h.status = 'active' and h.renewal_date is not null
  union all
  select h.project_id, 'hosting', 'pt_hosting', h.id, h.provider || ' · ' || h.environment || ' (expiry)', h.expiry_date, h.auto_renew, h.responsible_person
    from public.pt_hosting h where h.archived_at is null and h.status = 'active' and h.expiry_date is not null
     and h.expiry_date is distinct from h.renewal_date
  union all
  select d.project_id, 'domain', 'pt_domains', d.id, d.domain_name, d.expires_on, d.auto_renew, null
    from public.pt_domains d where d.archived_at is null and d.status in ('active', 'pending', 'parked') and d.expires_on is not null
  union all
  select d.project_id, 'ssl', 'pt_domains', d.id, d.domain_name || ' (SSL)', d.ssl_expires_on, d.ssl_auto_renew, null
    from public.pt_domains d where d.archived_at is null and d.status in ('active', 'pending', 'parked') and d.ssl_expires_on is not null
  union all
  select c.project_id, 'amc', 'pt_amc_contracts', c.id, 'AMC ' || coalesce(c.contract_number, ''), coalesce(c.renewal_date, c.end_date), false, c.responsible_person
    from public.pt_amc_contracts c where c.archived_at is null and c.status = 'active'
  union all
  select r.project_id, case r.item_type when 'email_service' then 'email' when 'subscription' then 'subscription' else r.item_type end,
         'pt_renewals', r.id, r.item_label, r.due_date, false, null
    from public.pt_renewals r where r.archived_at is null and r.status = 'upcoming'
) x
join public.pt_projects p on p.id = x.project_id and p.archived_at is null;

-- =====================================================================
-- 9. Row Level Security and privileges
-- =====================================================================
do $$
declare
  t text;
begin
  -- Record tables: read = any PT role; insert/update = editor+. No delete.
  foreach t in array array[
    'pt_projects', 'pt_hosting', 'pt_domains', 'pt_access_records', 'pt_email_accounts', 'pt_backups',
    'pt_repositories', 'pt_deployments', 'pt_milestones', 'pt_tasks', 'pt_updates',
    'pt_amc_contracts', 'pt_renewals', 'pt_seo_records', 'pt_handovers', 'pt_handover_items', 'pt_remarks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy pt_select on public.%I for select to authenticated using ((select public.pt_can_read()))', t);
    execute format('create policy pt_insert on public.%I for insert to authenticated with check ((select public.pt_can_edit()))', t);
    execute format('create policy pt_update on public.%I for update to authenticated using ((select public.pt_can_edit())) with check ((select public.pt_can_edit()))', t);
  end loop;

  -- Tables only functions touch.
  foreach t in array array['pt_members', 'pt_access_refs', 'pt_activity_logs', 'pt_handover_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Documents: restricted files are visible to managers only.
alter table public.pt_documents enable row level security;
revoke all on public.pt_documents from public, anon, authenticated;
grant select, insert, update on public.pt_documents to authenticated;
grant all on public.pt_documents to service_role;
create policy pt_select on public.pt_documents for select to authenticated
  using ((select public.pt_can_read()) and (classification <> 'restricted' or (select public.pt_is_manager())));
create policy pt_insert on public.pt_documents for insert to authenticated
  with check ((select public.pt_can_edit()) and (classification <> 'restricted' or (select public.pt_is_manager())));
create policy pt_update on public.pt_documents for update to authenticated
  using ((select public.pt_can_edit()) and (classification <> 'restricted' or (select public.pt_is_manager())))
  with check ((select public.pt_can_edit()) and (classification <> 'restricted' or (select public.pt_is_manager())));

-- Logs / handover events: readable by any PT role; never writable by API roles.
grant select on public.pt_activity_logs, public.pt_handover_events to authenticated;
create policy pt_select on public.pt_activity_logs for select to authenticated using ((select public.pt_can_read()));
create policy pt_select on public.pt_handover_events for select to authenticated using ((select public.pt_can_read()));

-- Column-level write limits.
--   access records: reference metadata is maintained by pt_set_access_reference only.
revoke insert, update on public.pt_access_records from authenticated;
grant insert (project_id, service_name, category, login_url, account_owner, access_level, responsible_person, two_factor,
              last_rotated_on, rotation_due_on, last_verified_on, status, remarks)
  on public.pt_access_records to authenticated;
grant update (service_name, category, login_url, account_owner, access_level, responsible_person, two_factor,
              last_rotated_on, rotation_due_on, last_verified_on, status, remarks, archived_at, archive_reason)
  on public.pt_access_records to authenticated;
--   handovers: created by pt_start_handover; status/approval only via pt_handover_transition.
revoke insert, update on public.pt_handovers from authenticated;
grant update (recipient_name, recipient_organisation, recipient_email, handover_date, approval_document_id, notes, archived_at, archive_reason)
  on public.pt_handovers to authenticated;
--   handover items: created by pt_start_handover; only state/evidence editable.
revoke insert, update on public.pt_handover_items from authenticated;
grant update (state, evidence_note, evidence_document_id) on public.pt_handover_items to authenticated;
--   documents: the storage location of a file cannot be repointed after upload.
revoke update on public.pt_documents from authenticated;
grant update (name, category, version, classification, task_id, remarks, external_url, archived_at, archive_reason)
  on public.pt_documents to authenticated;
--   projects: serial number / code generation is server-side.
revoke insert on public.pt_projects from authenticated;
grant insert (project_code, name, client_name, category, category_other, description, scope, developed_by_zyllo, original_developer,
              responsible_person, start_date, expected_completion_date, actual_completion_date, status, priority, progress,
              live_url, staging_url, remarks, amc_applicable, seo_applicable, not_applicable_sections)
  on public.pt_projects to authenticated;

-- Views.
revoke all on public.pt_project_health, public.pt_project_list, public.pt_due_items from public, anon, authenticated;
grant select on public.pt_project_health, public.pt_project_list, public.pt_due_items to authenticated;

-- Functions: nothing is executable by anon; internal helpers by nobody.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.pt_today()', 'public.pt_role()', 'public.pt_can_read()', 'public.pt_can_edit()', 'public.pt_is_manager()', 'public.pt_is_api_call()',
    'public.pt_looks_like_secret(text)', 'public.pt_valid_url(text)', 'public.pt_valid_email(text)', 'public.pt_mask_identifier(text)',
    'public.pt_log(uuid, text, uuid, text, text, jsonb)', 'public.pt_before_write()', 'public.pt_projects_rules()',
    'public.pt_set_codes()', 'public.pt_backups_rules()', 'public.pt_email_rules()', 'public.pt_domains_rules()',
    'public.pt_handovers_rules()', 'public.pt_handover_items_rules()', 'public.pt_after_write()', 'public.pt_append_only()',
    'public.pt_my_role()', 'public.pt_set_access_reference(uuid, text, text)', 'public.pt_reveal_access_reference(uuid)',
    'public.pt_start_handover(uuid)', 'public.pt_handover_transition(uuid, text, text)',
    'public.pt_complete_renewal(uuid, date, date, text, text)', 'public.pt_renew_amc(uuid, date, date, date, text)',
    'public.pt_list_members()', 'public.pt_set_member_role(text, text, text)',
    'public.pt_document_path_exists(text)', 'public.pt_project_is_active(text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Helpers used inside RLS / check constraints / triggers run as the caller.
grant execute on function
  public.pt_today(), public.pt_role(), public.pt_can_read(), public.pt_can_edit(), public.pt_is_manager(), public.pt_is_api_call(),
  public.pt_looks_like_secret(text), public.pt_valid_url(text), public.pt_valid_email(text), public.pt_mask_identifier(text),
  public.pt_before_write(), public.pt_projects_rules(), public.pt_set_codes(), public.pt_backups_rules(),
  public.pt_email_rules(), public.pt_domains_rules(), public.pt_handovers_rules(), public.pt_handover_items_rules(),
  public.pt_after_write(), public.pt_append_only(), public.pt_document_path_exists(text), public.pt_project_is_active(text)
  to authenticated;
-- RPCs callable from the browser (each checks the caller's role itself).
grant execute on function
  public.pt_my_role(), public.pt_set_access_reference(uuid, text, text), public.pt_reveal_access_reference(uuid),
  public.pt_start_handover(uuid), public.pt_handover_transition(uuid, text, text),
  public.pt_complete_renewal(uuid, date, date, text, text), public.pt_renew_amc(uuid, date, date, date, text),
  public.pt_list_members(), public.pt_set_member_role(text, text, text)
  to authenticated;
-- pt_log stays owner-only: API roles can never write activity entries directly.

commit;

-- ---------------------------------------------------------------------
-- After applying (one-time): make at least one website admin a Project
-- Tracker manager (managers can then manage roles from the UI):
--
--   insert into public.pt_members (user_id, role, note)
--   select id, 'manager', 'initial manager' from auth.users where email = '<ADMIN EMAIL>'
--   on conflict (user_id) do update set role = 'manager';
-- ---------------------------------------------------------------------

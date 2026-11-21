-- =====================================================================================
-- Project Tracker — database STRUCTURE for the live website project (no data).
-- = migrations 220 … 228 from supabase/migrations, in order, as ONE transaction:
--   either everything is created, or nothing is.
--
-- Creates: tables pt_companies, pt_projects, pt_credentials, pt_credential_events,
--   pt_documents, pt_backups (+ schema pt_private), row-level security (website admins
--   only, via public.is_admin()), the encrypted-password functions (Supabase Vault) and
--   two PRIVATE storage buckets: pt-company-logos, pt-project-documents.
-- Copies NO rows: no companies, projects, logins, passwords or documents.
-- Changes NO existing website table.
-- Safe to stop: if anything fails, the whole script is undone.
-- =====================================================================================

begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing on this database. Stop: the Project Tracker needs it.';
  end if;
  if to_regclass('public.pt_projects') is not null then
    raise exception 'Project Tracker tables already exist on this database. Nothing was changed.';
  end if;
end $$;


-- ===================== 220_project_tracker_companies.sql =====================

-- =====================================================================
-- 220_project_tracker_companies.sql — Project Tracker: client companies
-- =====================================================================
-- First table of the Project Tracker admin module (/admin/project-tracker).
-- Holds the client companies Zyllo Tech works for. Projects will hang off
-- this table later.
--
-- Access: website admins only, through the same public.is_admin() check the
-- admin area already uses for its login gate. Anonymous visitors, employees
-- and any other signed-in user can neither read nor write.
--
-- Touches nothing else: one new table, its trigger and its policies.
-- Idempotent (safe to re-run). Rollback: supabase/rollbacks/220_rollback_project_tracker_companies.sql
-- =====================================================================

create table if not exists public.pt_companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 200),
  industry       text check (industry is null or length(industry) <= 120),
  contact_person text check (contact_person is null or length(contact_person) <= 120),
  email          text check (email is null or (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone          text check (phone is null or length(phone) <= 40),
  website        text check (website is null or length(website) <= 300),
  gstin          text check (gstin is null or gstin ~ '^[0-9A-Z]{15}$'),
  address        text check (address is null or length(address) <= 500),
  city           text check (city is null or length(city) <= 120),
  state          text check (state is null or length(state) <= 120),
  country        text not null default 'India' check (length(country) <= 120),
  status         text not null default 'active' check (status in ('active', 'inactive')),
  notes          text check (notes is null or length(notes) <= 2000),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One company per name (case- and space-insensitive).
create unique index if not exists pt_companies_name_key
  on public.pt_companies (lower(btrim(name)));

create or replace function public.pt_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pt_companies_set_updated_at on public.pt_companies;
create trigger pt_companies_set_updated_at
  before update on public.pt_companies
  for each row
  execute function public.pt_set_updated_at();

alter table public.pt_companies enable row level security;

revoke all on public.pt_companies from anon;
grant select, insert, update, delete on public.pt_companies to authenticated;

drop policy if exists "pt_companies admin select" on public.pt_companies;
create policy "pt_companies admin select" on public.pt_companies
  for select to authenticated using (public.is_admin());

drop policy if exists "pt_companies admin insert" on public.pt_companies;
create policy "pt_companies admin insert" on public.pt_companies
  for insert to authenticated with check (public.is_admin());

drop policy if exists "pt_companies admin update" on public.pt_companies;
create policy "pt_companies admin update" on public.pt_companies
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "pt_companies admin delete" on public.pt_companies;
create policy "pt_companies admin delete" on public.pt_companies
  for delete to authenticated using (public.is_admin());


-- ===================== 221_project_tracker_logos_projects.sql =====================

-- =====================================================================
-- 221_project_tracker_logos_projects.sql — Project Tracker round 2
-- =====================================================================
-- 1. pt_companies: drop website, gstin, city, state, notes (not wanted);
--    add logo_path (object path in the private bucket below).
-- 2. Private storage bucket "pt-company-logos" (PNG / JPEG / WEBP, 2 MB),
--    readable and writable by website admins only.
-- 3. pt_projects: projects that belong to one client company.
--
-- Access everywhere: public.is_admin() (the admin area's own gate).
-- Depends on 220. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/221_rollback_project_tracker_logos_projects.sql
-- =====================================================================

-- 1. Company columns ---------------------------------------------------
alter table public.pt_companies drop column if exists website;
alter table public.pt_companies drop column if exists gstin;
alter table public.pt_companies drop column if exists city;
alter table public.pt_companies drop column if exists state;
alter table public.pt_companies drop column if exists notes;

alter table public.pt_companies add column if not exists logo_path text;
alter table public.pt_companies drop constraint if exists pt_companies_logo_path_check;
alter table public.pt_companies add constraint pt_companies_logo_path_check
  check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$');

-- 2. Logo bucket ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('pt-company-logos', 'pt-company-logos', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pt-company-logos: admin read" on storage.objects;
create policy "pt-company-logos: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'pt-company-logos' and public.is_admin());

drop policy if exists "pt-company-logos: admin upload" on storage.objects;
create policy "pt-company-logos: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'pt-company-logos' and public.is_admin());

drop policy if exists "pt-company-logos: admin delete" on storage.objects;
create policy "pt-company-logos: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'pt-company-logos' and public.is_admin());
-- No UPDATE policy: a new logo is a new object; the old one is deleted.

-- 3. Projects --------------------------------------------------------------
create table if not exists public.pt_projects (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.pt_companies(id) on delete restrict,
  name        text not null check (length(btrim(name)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  status      text not null default 'planning'
              check (status in ('planning', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  start_date  date,
  end_date    date,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint pt_projects_dates_check check (start_date is null or end_date is null or end_date >= start_date)
);

-- One project per name within a company (case- and space-insensitive).
create unique index if not exists pt_projects_company_name_key
  on public.pt_projects (company_id, lower(btrim(name)));
create index if not exists pt_projects_company_idx on public.pt_projects (company_id);

drop trigger if exists pt_projects_set_updated_at on public.pt_projects;
create trigger pt_projects_set_updated_at
  before update on public.pt_projects
  for each row
  execute function public.pt_set_updated_at();

alter table public.pt_projects enable row level security;

revoke all on public.pt_projects from anon;
grant select, insert, update, delete on public.pt_projects to authenticated;

drop policy if exists "pt_projects admin select" on public.pt_projects;
create policy "pt_projects admin select" on public.pt_projects
  for select to authenticated using (public.is_admin());

drop policy if exists "pt_projects admin insert" on public.pt_projects;
create policy "pt_projects admin insert" on public.pt_projects
  for insert to authenticated with check (public.is_admin());

drop policy if exists "pt_projects admin update" on public.pt_projects;
create policy "pt_projects admin update" on public.pt_projects
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "pt_projects admin delete" on public.pt_projects;
create policy "pt_projects admin delete" on public.pt_projects
  for delete to authenticated using (public.is_admin());


-- ===================== 222_project_tracker_project_fields.sql =====================

-- =====================================================================
-- 222_project_tracker_project_fields.sql — Project Tracker round 3
-- =====================================================================
-- Brings pt_projects in line with the Zyllo Tech project sheet columns:
--   Project ID (auto ZT-001, ZT-002 …), Type, Status (+ "live"),
--   Progress %, Project Manager, Priority, Health, Live URL,
--   Repo / Source, Next Action, Notes.  (Start Date / Target Date =
--   existing start_date / end_date.)
--
-- Access unchanged: public.is_admin() only (policies from 221).
-- Depends on 221. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/222_rollback_project_tracker_project_fields.sql
-- =====================================================================

create sequence if not exists public.pt_project_code_seq;
grant usage on sequence public.pt_project_code_seq to authenticated;

alter table public.pt_projects
  add column if not exists project_code text
    default ('ZT-' || lpad(nextval('public.pt_project_code_seq')::text, 3, '0'));
-- Existing rows (if any) receive a code through the default above.
alter table public.pt_projects alter column project_code set not null;
create unique index if not exists pt_projects_code_key on public.pt_projects (project_code);

alter table public.pt_projects add column if not exists project_type    text;
alter table public.pt_projects add column if not exists progress        integer not null default 0;
alter table public.pt_projects add column if not exists project_manager text;
alter table public.pt_projects add column if not exists priority        text not null default 'medium';
alter table public.pt_projects add column if not exists health          text;
alter table public.pt_projects add column if not exists live_url        text;
alter table public.pt_projects add column if not exists repo_source     text;
alter table public.pt_projects add column if not exists next_action     text;
alter table public.pt_projects add column if not exists notes           text;

-- Constraints (drop + add so a re-run picks up changes).
alter table public.pt_projects drop constraint if exists pt_projects_status_check;
alter table public.pt_projects add constraint pt_projects_status_check
  check (status in ('planning', 'in_progress', 'live', 'on_hold', 'completed', 'cancelled'));

alter table public.pt_projects drop constraint if exists pt_projects_fields_check;
alter table public.pt_projects add constraint pt_projects_fields_check check (
      progress between 0 and 100
  and priority in ('low', 'medium', 'high')
  and (health is null or health in ('on_track', 'at_risk', 'off_track'))
  and (project_type is null or length(project_type) <= 80)
  and (project_manager is null or length(project_manager) <= 120)
  and (live_url is null or (length(live_url) <= 500 and live_url ~* '^https?://[^\s]+$'))
  and (repo_source is null or length(repo_source) <= 500)
  and (next_action is null or length(next_action) <= 500)
  and (notes is null or length(notes) <= 2000)
);

create index if not exists pt_projects_status_idx on public.pt_projects (status);


-- ===================== 223_project_tracker_access_documents_backups.sql =====================

-- =====================================================================
-- 223_project_tracker_access_documents_backups.sql — Project Tracker round 4
-- =====================================================================
-- Per project:
--   A. Access & Logins (pt_credentials) — GitHub, database, hosting, domain,
--      email, admin logins, backup storage … Passwords are stored ENCRYPTED in
--      Supabase Vault (vault.secrets). No table the API can reach ever holds a
--      password; pt_credentials only says whether one is saved.
--        * save / change / remove: website admin
--        * view / copy: website admin who signed in with their password within
--          the last 10 minutes (JWT "amr" sign-in time), max 30 per 10 minutes
--        * every save, change, removal, view and copy is logged (never the value)
--   B. Documents (pt_documents) — handover (user manual, training PPT …),
--      MOMs (auto-numbered MOM-1, MOM-2 … per project), revisions (Rev-1 …),
--      contracts, other. A document is an uploaded file in the private bucket
--      "pt-project-documents" (25 MB) OR an external link (Google Drive …).
--   C. Backups (pt_backups) — what, where, link, date, and which login it is
--      stored under.
--
-- Access everywhere: public.is_admin() (the admin area's own gate).
-- Requires the supabase_vault extension (installed on Supabase projects).
-- Depends on 222. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/223_rollback_project_tracker_access_documents_backups.sql
-- =====================================================================

create extension if not exists supabase_vault with schema vault;

create schema if not exists pt_private;
revoke all on schema pt_private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- True when the caller signed in WITH A PASSWORD (or other primary method)
-- within the last p_seconds. Token refreshes keep the original sign-in time.
create or replace function pt_private.signed_in_within(p_seconds integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select max((e ->> 'timestamp')::bigint)
    from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
    ) as e
    where jsonb_typeof(e) = 'object' and (e ->> 'timestamp') ~ '^[0-9]+$'
  ), 0) >= extract(epoch from now())::bigint - p_seconds;
$$;

create or replace function pt_private.require_admin()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'PT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
end;
$$;

-- =====================================================================
-- A. Access & Logins
-- =====================================================================
create table if not exists public.pt_credentials (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.pt_projects(id) on delete restrict,
  category            text not null default 'other'
                      check (category in ('code_repo', 'database', 'hosting', 'domain', 'email',
                                          'admin_login', 'backup_storage', 'other')),
  service             text not null check (length(btrim(service)) between 1 and 120),
  account             text check (account is null or length(account) <= 254),
  login_url           text check (login_url is null or (length(login_url) <= 500 and login_url ~* '^https?://[^\s]+$')),
  purpose             text check (purpose is null or length(purpose) <= 500),
  two_factor          boolean not null default false,
  notes               text check (notes is null or length(notes) <= 2000),
  has_password        boolean not null default false,
  password_updated_at timestamptz,
  password_updated_by uuid,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint pt_credentials_id_project_key unique (id, project_id)
);
create index if not exists pt_credentials_project_idx on public.pt_credentials (project_id);

-- Only the password functions below may change the password status columns,
-- and a login can never be moved to another project.
create or replace function pt_private.credentials_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('pt.password_write', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.has_password := false;
      new.password_updated_at := null;
      new.password_updated_by := null;
    else
      new.has_password := old.has_password;
      new.password_updated_at := old.password_updated_at;
      new.password_updated_by := old.password_updated_by;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists pt_credentials_guard on public.pt_credentials;
create trigger pt_credentials_guard
  before insert or update on public.pt_credentials
  for each row execute function pt_private.credentials_guard();

-- credential -> vault secret mapping. Not reachable through the API.
create table if not exists pt_private.credential_secrets (
  credential_id uuid primary key references public.pt_credentials(id) on delete cascade,
  secret_id     uuid not null unique
);
alter table pt_private.credential_secrets enable row level security;
revoke all on pt_private.credential_secrets from public, anon, authenticated;

-- Removing a mapping (password removed, or login deleted) deletes the vault secret.
create or replace function pt_private.credential_secret_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;
revoke all on function pt_private.credential_secret_cleanup() from public, anon, authenticated;
drop trigger if exists pt_credential_secrets_cleanup on pt_private.credential_secrets;
create trigger pt_credential_secrets_cleanup
  after delete on pt_private.credential_secrets
  for each row execute function pt_private.credential_secret_cleanup();

-- Audit log: who saved / changed / removed / viewed / copied which password, and when.
create table if not exists public.pt_credential_events (
  id               bigint generated always as identity primary key,
  credential_id    uuid,
  project_id       uuid,
  credential_label text,
  action           text not null check (action in ('password_set', 'password_changed', 'password_removed',
                                                   'password_viewed', 'password_copied', 'login_deleted')),
  actor            uuid default auth.uid(),
  actor_email      text,
  created_at       timestamptz not null default now()
);
create index if not exists pt_credential_events_project_idx on public.pt_credential_events (project_id, created_at desc);
create index if not exists pt_credential_events_actor_idx on public.pt_credential_events (actor, created_at desc);

create or replace function pt_private.log_credential_event(p_cred public.pt_credentials, p_action text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pt_credential_events (credential_id, project_id, credential_label, action, actor, actor_email)
  values (p_cred.id, p_cred.project_id,
          left(p_cred.service || coalesce(' — ' || p_cred.account, ''), 300),
          p_action, auth.uid(), auth.jwt() ->> 'email');
$$;
revoke all on function pt_private.log_credential_event(public.pt_credentials, text) from public, anon, authenticated;

-- Deleting a login is logged too (its secret is removed by the cascade above).
create or replace function pt_private.credentials_log_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pt_private.log_credential_event(old, 'login_deleted');
  return old;
end;
$$;
revoke all on function pt_private.credentials_log_delete() from public, anon, authenticated;
drop trigger if exists pt_credentials_log_delete on public.pt_credentials;
create trigger pt_credentials_log_delete
  before delete on public.pt_credentials
  for each row execute function pt_private.credentials_log_delete();

-- Save or change a password.
create or replace function public.pt_credential_set_password(p_credential_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cred   public.pt_credentials;
  v_secret uuid;
begin
  perform pt_private.require_admin();
  if p_password is null or length(p_password) = 0 or length(p_password) > 1000 then
    raise exception 'PT_PASSWORD_INVALID' using errcode = 'P0001';
  end if;
  select * into v_cred from public.pt_credentials where id = p_credential_id for update;
  if not found then
    raise exception 'PT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select secret_id into v_secret from pt_private.credential_secrets where credential_id = p_credential_id;
  if v_secret is null then
    v_secret := vault.create_secret(p_password, 'pt_credential_' || p_credential_id::text, 'Project Tracker login password');
    insert into pt_private.credential_secrets (credential_id, secret_id) values (p_credential_id, v_secret);
  else
    perform vault.update_secret(v_secret, p_password);
  end if;

  perform set_config('pt.password_write', 'on', true);
  update public.pt_credentials
     set has_password = true, password_updated_at = now(), password_updated_by = auth.uid()
   where id = p_credential_id;
  perform set_config('pt.password_write', 'off', true);

  perform pt_private.log_credential_event(v_cred, case when v_cred.has_password then 'password_changed' else 'password_set' end);
end;
$$;

-- Remove a saved password.
create or replace function public.pt_credential_remove_password(p_credential_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cred public.pt_credentials;
begin
  perform pt_private.require_admin();
  select * into v_cred from public.pt_credentials where id = p_credential_id for update;
  if not found then
    raise exception 'PT_NOT_FOUND' using errcode = 'P0001';
  end if;
  delete from pt_private.credential_secrets where credential_id = p_credential_id; -- trigger deletes the vault secret

  perform set_config('pt.password_write', 'on', true);
  update public.pt_credentials
     set has_password = false, password_updated_at = now(), password_updated_by = auth.uid()
   where id = p_credential_id;
  perform set_config('pt.password_write', 'off', true);

  if v_cred.has_password then
    perform pt_private.log_credential_event(v_cred, 'password_removed');
  end if;
end;
$$;

-- View or copy a password: recent sign-in required, rate limited, always logged.
create or replace function public.pt_credential_reveal_password(p_credential_id uuid, p_purpose text default 'view')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cred   public.pt_credentials;
  v_secret uuid;
  v_value  text;
  v_recent integer;
begin
  perform pt_private.require_admin();
  if not pt_private.signed_in_within(600) then
    raise exception 'PT_REAUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
    from public.pt_credential_events
   where actor = auth.uid()
     and action in ('password_viewed', 'password_copied')
     and created_at > now() - interval '10 minutes';
  if v_recent >= 30 then
    raise exception 'PT_RATE_LIMITED' using errcode = 'P0001';
  end if;

  select * into v_cred from public.pt_credentials where id = p_credential_id;
  if not found then
    raise exception 'PT_NOT_FOUND' using errcode = 'P0001';
  end if;
  select secret_id into v_secret from pt_private.credential_secrets where credential_id = p_credential_id;
  if v_secret is null then
    raise exception 'PT_NO_PASSWORD' using errcode = 'P0001';
  end if;
  select decrypted_secret into v_value from vault.decrypted_secrets where id = v_secret;
  if v_value is null then
    raise exception 'PT_NO_PASSWORD' using errcode = 'P0001';
  end if;

  perform pt_private.log_credential_event(v_cred, case when p_purpose = 'copy' then 'password_copied' else 'password_viewed' end);
  return v_value;
end;
$$;

revoke all on function public.pt_credential_set_password(uuid, text) from public, anon;
revoke all on function public.pt_credential_remove_password(uuid) from public, anon;
revoke all on function public.pt_credential_reveal_password(uuid, text) from public, anon;
grant execute on function public.pt_credential_set_password(uuid, text) to authenticated;
grant execute on function public.pt_credential_remove_password(uuid) to authenticated;
grant execute on function public.pt_credential_reveal_password(uuid, text) to authenticated;
revoke all on function pt_private.signed_in_within(integer) from public, anon, authenticated;
revoke all on function pt_private.require_admin() from public, anon, authenticated;
revoke all on function pt_private.credentials_guard() from public, anon, authenticated;

alter table public.pt_credentials enable row level security;
revoke all on public.pt_credentials from anon;
grant select, insert, update, delete on public.pt_credentials to authenticated;
drop policy if exists "pt_credentials admin all" on public.pt_credentials;
create policy "pt_credentials admin all" on public.pt_credentials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.pt_credential_events enable row level security;
revoke all on public.pt_credential_events from anon, authenticated;
grant select on public.pt_credential_events to authenticated;
drop policy if exists "pt_credential_events admin read" on public.pt_credential_events;
create policy "pt_credential_events admin read" on public.pt_credential_events
  for select to authenticated using (public.is_admin());

-- =====================================================================
-- B. Documents
-- =====================================================================
create table if not exists public.pt_documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.pt_projects(id) on delete restrict,
  category     text not null check (category in ('handover', 'mom', 'revision', 'contract', 'other')),
  doc_type     text check (doc_type is null or length(doc_type) <= 80),
  ref_no       integer check (ref_no is null or ref_no > 0),
  title        text not null check (length(btrim(title)) between 1 and 200),
  doc_date     date,
  description  text check (description is null or length(description) <= 2000),
  storage_path text unique,
  file_name    text check (file_name is null or length(file_name) <= 255),
  file_size    bigint check (file_size is null or (file_size > 0 and file_size <= 26214400)),
  mime_type    text check (mime_type is null or length(mime_type) <= 150),
  external_url text check (external_url is null or (length(external_url) <= 1000 and external_url ~* '^https?://[^\s]+$')),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint pt_documents_file_or_link check ((storage_path is null) <> (external_url is null)),
  constraint pt_documents_path_in_project check (storage_path is null or storage_path like project_id::text || '/%')
);
create index if not exists pt_documents_project_idx on public.pt_documents (project_id, category);
create unique index if not exists pt_documents_ref_key on public.pt_documents (project_id, category, ref_no) where ref_no is not null;

-- MOMs and revisions are numbered per project automatically (MOM-1, MOM-2 …).
create or replace function pt_private.documents_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;
    new.storage_path := old.storage_path;
    new.updated_at := now();
    if new.category is distinct from old.category then
      new.ref_no := null;
    end if;
  end if;
  if new.category in ('mom', 'revision') and new.ref_no is null then
    perform pg_advisory_xact_lock(hashtext('pt_documents:' || new.project_id::text || ':' || new.category));
    select coalesce(max(ref_no), 0) + 1 into new.ref_no
      from public.pt_documents
     where project_id = new.project_id and category = new.category;
  elsif new.category not in ('mom', 'revision') then
    new.ref_no := null;
  end if;
  return new;
end;
$$;
revoke all on function pt_private.documents_before_write() from public, anon, authenticated;
drop trigger if exists pt_documents_before_write on public.pt_documents;
create trigger pt_documents_before_write
  before insert or update on public.pt_documents
  for each row execute function pt_private.documents_before_write();

alter table public.pt_documents enable row level security;
revoke all on public.pt_documents from anon;
grant select, insert, update, delete on public.pt_documents to authenticated;
drop policy if exists "pt_documents admin all" on public.pt_documents;
create policy "pt_documents admin all" on public.pt_documents
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('pt-project-documents', 'pt-project-documents', false, 26214400, array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp'
  ])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pt-project-documents: admin read" on storage.objects;
create policy "pt-project-documents: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'pt-project-documents' and public.is_admin());
drop policy if exists "pt-project-documents: admin upload" on storage.objects;
create policy "pt-project-documents: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'pt-project-documents' and public.is_admin());
drop policy if exists "pt-project-documents: admin delete" on storage.objects;
create policy "pt-project-documents: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'pt-project-documents' and public.is_admin());

-- =====================================================================
-- C. Backups
-- =====================================================================
create table if not exists public.pt_backups (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.pt_projects(id) on delete restrict,
  backup_type   text not null default 'code'
                check (backup_type in ('code', 'database', 'files', 'full_site', 'other')),
  location      text not null check (length(btrim(location)) between 1 and 120),
  link          text check (link is null or (length(link) <= 1000 and link ~* '^https?://[^\s]+$')),
  backup_date   date,
  credential_id uuid,
  notes         text check (notes is null or length(notes) <= 2000),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- the linked login must belong to the same project; deleting it just unlinks
  constraint pt_backups_credential_fkey foreign key (credential_id, project_id)
    references public.pt_credentials (id, project_id) on delete set null (credential_id)
);
create index if not exists pt_backups_project_idx on public.pt_backups (project_id, backup_date desc);

drop trigger if exists pt_backups_set_updated_at on public.pt_backups;
create trigger pt_backups_set_updated_at
  before update on public.pt_backups
  for each row execute function public.pt_set_updated_at();

alter table public.pt_backups enable row level security;
revoke all on public.pt_backups from anon;
grant select, insert, update, delete on public.pt_backups to authenticated;
drop policy if exists "pt_backups admin all" on public.pt_backups;
create policy "pt_backups admin all" on public.pt_backups
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- ===================== 224_project_tracker_credential_email_repo.sql =====================

-- =====================================================================
-- 224_project_tracker_credential_email_repo.sql — Project Tracker round 5
-- =====================================================================
-- Logins get two optional fields for code repositories (GitHub …):
--   email      — the email of the account (account = the GitHub username)
--   repository — owner/repo or the repository URL
-- Additive only. Access unchanged (public.is_admin(), policies from 223).
-- Depends on 223. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/224_rollback_project_tracker_credential_email_repo.sql
-- =====================================================================

alter table public.pt_credentials add column if not exists email text;
alter table public.pt_credentials add column if not exists repository text;

alter table public.pt_credentials drop constraint if exists pt_credentials_email_repo_check;
alter table public.pt_credentials add constraint pt_credentials_email_repo_check check (
      (email is null or (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
  and (repository is null or (length(repository) <= 300 and repository !~ '\s'))
);


-- ===================== 225_project_tracker_password_export.sql =====================

-- =====================================================================
-- 225_project_tracker_password_export.sql — Project Tracker round 6
-- =====================================================================
-- Excel export of logins WITH passwords (the owner chose "always include").
--   public.pt_credentials_export_passwords(uuid[]) returns (credential_id, password)
--     * website admin only, signed in with a password within the last 10 minutes
--     * up to 500 logins per call, at most 1000 exported passwords per admin per 10 minutes
--     * every exported password is logged as 'password_exported' (never the value)
-- Depends on 223. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/225_rollback_project_tracker_password_export.sql
-- =====================================================================

alter table public.pt_credential_events drop constraint if exists pt_credential_events_action_check;
alter table public.pt_credential_events add constraint pt_credential_events_action_check
  check (action in ('password_set', 'password_changed', 'password_removed', 'password_viewed',
                    'password_copied', 'password_exported', 'login_deleted'));

create or replace function public.pt_credentials_export_passwords(p_credential_ids uuid[])
returns table (credential_id uuid, password text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids    uuid[] := array(select distinct x from unnest(coalesce(p_credential_ids, array[]::uuid[])) as x where x is not null);
  v_count  integer := cardinality(v_ids);
  v_recent integer;
  v_cred   public.pt_credentials;
begin
  perform pt_private.require_admin();
  if not pt_private.signed_in_within(600) then
    raise exception 'PT_REAUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if v_count = 0 then
    return;
  end if;
  if v_count > 500 then
    raise exception 'PT_TOO_MANY' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
    from public.pt_credential_events
   where actor = auth.uid()
     and action = 'password_exported'
     and created_at > now() - interval '10 minutes';
  if v_recent + v_count > 1000 then
    raise exception 'PT_RATE_LIMITED' using errcode = 'P0001';
  end if;

  for v_cred in
    select c.* from public.pt_credentials c
     where c.id = any (v_ids) and c.has_password
  loop
    credential_id := v_cred.id;
    select d.decrypted_secret into password
      from pt_private.credential_secrets s
      join vault.decrypted_secrets d on d.id = s.secret_id
     where s.credential_id = v_cred.id;
    if password is not null then
      perform pt_private.log_credential_event(v_cred, 'password_exported');
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.pt_credentials_export_passwords(uuid[]) from public, anon;
grant execute on function public.pt_credentials_export_passwords(uuid[]) to authenticated;


-- ===================== 226_project_tracker_commercial_documents.sql =====================

-- =====================================================================
-- 226_project_tracker_commercial_documents.sql — Project Tracker round 7
-- =====================================================================
-- Quotations, invoices, sales orders and purchase orders (from the client)
-- as project documents with their own number:
--   * pt_documents.category gains 'quotation', 'invoice', 'sales_order', 'purchase_order'
--   * pt_documents.doc_number — the document's number (required for those four)
--   * one number per project and type (case-insensitive), e.g. one "INV-001" per project
-- Files use the existing private bucket "pt-project-documents" (or a link).
-- Access unchanged (public.is_admin(), policies from 223).
-- Depends on 223. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/226_rollback_project_tracker_commercial_documents.sql
-- =====================================================================

alter table public.pt_documents add column if not exists doc_number text;

alter table public.pt_documents drop constraint if exists pt_documents_category_check;
alter table public.pt_documents add constraint pt_documents_category_check check (
  category in ('handover', 'mom', 'revision', 'contract', 'other',
               'quotation', 'invoice', 'sales_order', 'purchase_order')
);

alter table public.pt_documents drop constraint if exists pt_documents_doc_number_check;
alter table public.pt_documents add constraint pt_documents_doc_number_check check (
      (doc_number is null or (length(btrim(doc_number)) between 1 and 60))
  and (category not in ('quotation', 'invoice', 'sales_order', 'purchase_order') or doc_number is not null)
);

create unique index if not exists pt_documents_number_key
  on public.pt_documents (project_id, category, lower(btrim(doc_number)))
  where doc_number is not null;


-- ===================== 227_project_tracker_backup_plan.sql =====================

-- =====================================================================
-- 227_project_tracker_backup_plan.sql — Project Tracker round 8
-- =====================================================================
-- Backups become a fixed sheet per project:
--   Complete code backup · Daily backup · Weekly backup · Monthly backup
-- Each has: kept? (yes / no), where it is kept, link, last backup date, notes,
-- and the login (username / email + ENCRYPTED password) via credential_id
-- (a pt_credentials row of category 'backup_storage', password in Supabase Vault).
--   * pt_backups.frequency  'complete' | 'daily' | 'weekly' | 'monthly' (one row each per project)
--   * pt_backups.kept       false = "No, not kept" (then no location needed)
--   * pt_backups.location   now optional when kept = false
-- Access unchanged (public.is_admin(), policies from 223).
-- Depends on 223. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/227_rollback_project_tracker_backup_plan.sql
-- =====================================================================

alter table public.pt_backups add column if not exists frequency text;
alter table public.pt_backups add column if not exists kept boolean not null default true;

alter table public.pt_backups alter column location drop not null;
alter table public.pt_backups drop constraint if exists pt_backups_location_check;
alter table public.pt_backups add constraint pt_backups_location_check
  check (location is null or length(btrim(location)) between 1 and 120);

alter table public.pt_backups drop constraint if exists pt_backups_frequency_check;
alter table public.pt_backups add constraint pt_backups_frequency_check
  check (frequency is null or frequency in ('complete', 'daily', 'weekly', 'monthly'));

alter table public.pt_backups drop constraint if exists pt_backups_kept_location_check;
alter table public.pt_backups add constraint pt_backups_kept_location_check
  check (not kept or location is not null);

create unique index if not exists pt_backups_project_frequency_key
  on public.pt_backups (project_id, frequency) where frequency is not null;


-- ===================== 228_project_tracker_completed_date.sql =====================

-- 228: Project Tracker — actual completion date.
--   start_date     = when the project started            (existing)
--   end_date       = end date promised to the client     (existing)
--   completed_date = the day it was actually completed   (new) — later than end_date means it was delayed.
-- Additive only: no existing data changes. Rollback: supabase/rollbacks/228_rollback_project_tracker_completed_date.sql

alter table public.pt_projects add column if not exists completed_date date;

alter table public.pt_projects drop constraint if exists pt_projects_completed_date_check;
alter table public.pt_projects add constraint pt_projects_completed_date_check
  check (completed_date is null or start_date is null or completed_date >= start_date);

comment on column public.pt_projects.end_date is 'End date promised to the client.';
comment on column public.pt_projects.completed_date is 'Date the project was actually completed (after end_date = delayed).';

notify pgrst, 'reload schema';


commit;

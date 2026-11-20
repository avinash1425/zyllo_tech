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

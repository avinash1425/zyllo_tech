-- =====================================================================
-- Zyllo Tech — Project Tracker: credentials (vault-backed passwords) and
-- document versioning / server-side validation.
--
-- NOT APPLIED. Apply after 001–003, with explicit approval. Additive:
--   * new tables pt_settings, pt_access_secrets
--   * new nullable columns on pt_access_records, pt_hosting, pt_documents
--   * the pt_access_records category CHECK is widened (old values kept)
--   * pt_after_write is re-created with three extra audit labels
--
-- PASSWORDS ARE DISABLED AFTER THIS MIGRATION (pt_settings.passwords_enabled
-- = false). They can only be switched on by 005_enable_password_vault.sql,
-- which requires Supabase Vault (extension supabase_vault) and passes a
-- self-test first. Without it every password function refuses to work.
--
-- Password design
--   * The secret itself is stored ONLY in Supabase Vault (vault.secrets:
--     encrypted at rest; the encryption key is managed by Supabase outside the
--     database). Project Tracker keeps the opaque vault secret id in
--     pt_access_secrets, a table no API role can read.
--   * Writes: pt_set_access_password (editors+). Reads: pt_reveal_access_password
--     (managers only, sign-in within pt_settings.reauth_minutes — checked
--     from the signed JWT `amr` timestamp — and rate-limited). Every reveal,
--     copy, change, clearing and refused attempt is logged WITHOUT the value.
--   * Revocation: pt_clear_access_password deletes the vault secret.
--   * Values that look like API keys / tokens / private keys are refused:
--     service-role keys and similar infrastructure keys must not be stored.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.pt_companies') is null then
    raise exception 'Apply 001–003 first.';
  end if;
  if to_regclass('public.pt_settings') is not null then
    raise exception 'public.pt_settings already exists: 004 is already installed. Aborting (nothing changed).';
  end if;
end $$;

-- ------------------------------------------------------------ settings
create table public.pt_settings (
  id                      boolean primary key default true check (id),
  passwords_enabled       boolean not null default false,
  passwords_enabled_at    timestamptz,
  passwords_enabled_note  text,
  max_document_mb         int not null default 50 check (max_document_mb between 1 and 50),
  reveal_seconds          int not null default 30 check (reveal_seconds between 10 and 120),
  reauth_minutes          int not null default 10 check (reauth_minutes between 1 and 60),
  max_reveals_per_10min   int not null default 30 check (max_reveals_per_10min between 1 and 200),
  updated_at              timestamptz not null default now()
);
insert into public.pt_settings default values;
alter table public.pt_settings enable row level security;
revoke all on public.pt_settings from public, anon, authenticated;
grant all on public.pt_settings to service_role;

-- 'supabase_vault' | 'test_double' (local tests only) | 'disabled'
create or replace function public.pt_password_backend() returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when not coalesce((select passwords_enabled from public.pt_settings), false) then 'disabled'
    when exists (select 1 from pg_extension where extname = 'supabase_vault')
         and to_regclass('vault.decrypted_secrets') is not null then 'supabase_vault'
    when to_regprocedure('vault.pt_test_double()') is not null then 'test_double'
    else 'disabled' end
$$;

create or replace function public.pt_settings_public() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare s public.pt_settings%rowtype;
begin
  if not public.pt_can_read() then
    return null;
  end if;
  select * into s from public.pt_settings;
  return jsonb_build_object('password_backend', public.pt_password_backend(), 'max_document_mb', s.max_document_mb,
                            'reveal_seconds', s.reveal_seconds, 'reauth_minutes', s.reauth_minutes);
end $$;

-- ------------------------------------------------------------ access records
alter table public.pt_access_records drop constraint pt_access_records_category_check;
alter table public.pt_access_records add constraint pt_access_records_category_check check (category in (
  'website_admin', 'hosting_panel', 'vps_ssh', 'database', 'domain_registrar', 'github', 'email_account',
  'third_party', 'api_service', 'other', 'supabase', 'cpanel', 'cloudflare', 'vercel', 'render'));
alter table public.pt_access_records
  add column login_identifier          text check (char_length(login_identifier) <= 254),
  add column provider                  text check (char_length(provider) <= 100),
  add column hosting_type              text check (char_length(hosting_type) <= 100),
  add column environment               text check (environment in ('production', 'staging', 'development')),
  add column resource_ref              text check (char_length(resource_ref) <= 300),
  add column organization              text check (char_length(organization) <= 200),
  add column project_name              text check (char_length(project_name) <= 200),
  add column renewal_date              date,
  add column purpose                   text check (char_length(purpose) <= 200),
  -- maintained only by the password functions
  add column has_password              boolean not null default false,
  add column password_updated_at       timestamptz,
  add column password_updated_by_email text;

grant insert (login_identifier, provider, hosting_type, environment, resource_ref, organization, project_name, renewal_date, purpose)
  on public.pt_access_records to authenticated;
grant update (login_identifier, provider, hosting_type, environment, resource_ref, organization, project_name, renewal_date, purpose)
  on public.pt_access_records to authenticated;

-- Opaque vault ids only — never a password or ciphertext. No API role may read it.
create table public.pt_access_secrets (
  access_record_id  uuid primary key references public.pt_access_records(id),
  project_id        uuid not null references public.pt_projects(id),
  vault_secret_id   uuid not null,
  backend           text not null check (backend in ('supabase_vault', 'test_double')),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  updated_by_email  text
);
alter table public.pt_access_secrets enable row level security;
revoke all on public.pt_access_secrets from public, anon, authenticated;
grant all on public.pt_access_secrets to service_role;

-- Hosting record → its login credential (same project).
alter table public.pt_hosting add column access_record_id uuid;
alter table public.pt_hosting add constraint pt_hosting_access_fk
  foreign key (project_id, access_record_id) references public.pt_access_records (project_id, id);

-- ------------------------------------------------------------ documents
alter table public.pt_documents
  add column description     text check (char_length(description) <= 2000),
  add column version_group_id uuid,
  add column supersedes_id   uuid,
  add column is_current      boolean not null default true;
alter table public.pt_documents add constraint pt_documents_supersedes_fk
  foreign key (project_id, supersedes_id) references public.pt_documents (project_id, id);
-- Backfill without touching audit columns or logs (owner, inside this migration only).
alter table public.pt_documents disable trigger user;
update public.pt_documents set version_group_id = id where version_group_id is null;
alter table public.pt_documents enable trigger user;
create index pt_documents_version_idx on public.pt_documents (version_group_id, created_at);
grant update (description) on public.pt_documents to authenticated;

-- Server-side file checks: type from the stored object (not the browser's
-- claim), size from the stored object, allow-list, configurable size limit,
-- and versioning bookkeeping.
create or replace function public.pt_documents_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old   public.pt_documents%rowtype;
  v_meta  jsonb;
  v_ext   text;
  v_max   bigint := (select max_document_mb from public.pt_settings) * 1024 * 1024;
  v_types text[] := array[
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp',
    'application/zip', 'application/x-zip-compressed', 'video/mp4', 'video/webm', 'audio/mpeg'];
begin
  if tg_op = 'INSERT' then
    new.is_current := true;
    if new.supersedes_id is not null then
      select * into v_old from public.pt_documents where id = new.supersedes_id;
      if not found or v_old.project_id <> new.project_id then
        raise exception using errcode = 'P0001', message = 'The document being replaced was not found in this project.';
      end if;
      if v_old.archived_at is not null or not v_old.is_current then
        raise exception using errcode = 'P0001', message = 'Only the current, active version of a document can be replaced.';
      end if;
      new.version_group_id := coalesce(v_old.version_group_id, v_old.id);
    else
      new.version_group_id := new.id;
    end if;
  else
    new.version_group_id := old.version_group_id;
    new.supersedes_id := old.supersedes_id;
  end if;

  if new.storage_path is not null and (tg_op = 'INSERT' or new.storage_path is distinct from old.storage_path)
     and new.storage_path like new.project_id::text || '/%' then   -- other paths are rejected by pt_documents_path_in_project
    v_ext := lower(substring(new.storage_path from '\.([A-Za-z0-9]+)$'));
    if v_ext is null or v_ext <> all (array['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'png', 'jpg', 'jpeg', 'webp', 'zip', 'mp4', 'webm', 'mp3']) then
      raise exception using errcode = 'P0001', message = format('Files of type .%s are not allowed.', coalesce(v_ext, '?'));
    end if;
    select o.metadata into v_meta from storage.objects o where o.bucket_id = 'project-tracker-documents' and o.name = new.storage_path;
    if not found then
      raise exception using errcode = 'P0001', message = 'The uploaded file was not found in private storage.';
    end if;
    -- trust the stored object, not the browser
    if v_meta ? 'size' then new.size_bytes := (v_meta ->> 'size')::bigint; end if;
    if v_meta ? 'mimetype' then new.mime_type := v_meta ->> 'mimetype'; end if;
    if new.mime_type is not null and new.mime_type <> all (v_types) then
      raise exception using errcode = 'P0001', message = format('Files of type %s are not allowed.', new.mime_type);
    end if;
    if new.size_bytes is not null and new.size_bytes > v_max then
      raise exception using errcode = 'P0001',
        message = format('The file is larger than the %s MB limit.', (select max_document_mb from public.pt_settings));
    end if;
  end if;
  return new;
end $$;

create or replace function public.pt_documents_after_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.supersedes_id is not null then
    update public.pt_documents set is_current = false where id = new.supersedes_id and is_current;
  end if;
  return null;
end $$;

create trigger pt_20_rules before insert or update on public.pt_documents
  for each row execute function public.pt_documents_rules();
create trigger pt_80_versions after insert on public.pt_documents
  for each row execute function public.pt_documents_after_version();

-- Activity labels for document versions; password bookkeeping columns are not logged as edits
-- (the password functions log their own explicit events).
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
    v_action := case when v_entity = 'document' and (v_new ->> 'supersedes_id') is not null then 'document.new_version'
                     else v_entity || '.created' end;
  else
    v_old := to_jsonb(old);
    select coalesce(array_agg(k order by k), '{}') into v_changed
      from jsonb_object_keys(v_new) k
     where k not in ('updated_at', 'updated_by', 'updated_by_email', 'created_at', 'created_by', 'created_by_email',
                     'archived_by', 'has_reference', 'identifier_hint', 'reference_updated_at', 'has_password', 'password_updated_at', 'password_updated_by_email',
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
    elsif v_entity = 'document' and v_changed = array['is_current'] and (v_new ->> 'is_current') = 'false' then
      v_action := 'document.superseded';
    else
      v_action := v_entity || '.updated';
      v_details := jsonb_build_object('fields', to_jsonb(v_changed));
    end if;
  end if;

  perform public.pt_log(v_project, v_entity, (v_new ->> 'id')::uuid, v_label, v_action, v_details);
  return null;
end $$;

-- ------------------------------------------------------------ password functions
-- Recent sign-in from the signed JWT: Supabase puts the sign-in method and
-- time in the `amr` claim and keeps it unchanged on token refresh.
create or replace function public.pt_recent_auth(p_minutes int) returns boolean
language sql stable
as $$
  select exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
     where a ->> 'method' in ('password', 'otp', 'magiclink', 'totp', 'mfa/totp', 'sso/saml', 'oauth')
       and (a ->> 'timestamp') ~ '^[0-9]+$'
       and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - p_minutes * 60)
$$;

create or replace function public.pt_set_access_password(p_record uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_backend text := public.pt_password_backend();
  v_rec public.pt_access_records%rowtype;
  v_map public.pt_access_secrets%rowtype;
  v_id uuid;
  v_archived timestamptz;
begin
  if v_backend = 'disabled' then
    raise exception using errcode = 'P0001',
      message = 'Password storage is disabled until a secure vault (Supabase Vault) is configured and approved. Use a password-manager reference meanwhile.';
  end if;
  if not public.pt_can_edit() then
    raise exception using errcode = '42501', message = 'You do not have permission to change passwords.';
  end if;
  select * into v_rec from public.pt_access_records where id = p_record;
  if not found then
    raise exception using errcode = 'P0002', message = 'Access record not found.';
  end if;
  select archived_at into v_archived from public.pt_projects where id = v_rec.project_id;
  if v_rec.archived_at is not null or v_archived is not null then
    raise exception using errcode = 'P0001', message = 'This record is archived and read-only.';
  end if;
  if p_password is null or char_length(p_password) < 1 or char_length(p_password) > 500 then
    raise exception using errcode = 'P0001', message = 'Enter a password of 1 to 500 characters.';
  end if;
  if public.pt_looks_like_secret(p_password) then
    raise exception using errcode = 'P0001',
      message = 'This looks like an API key, token or private key. Service-role keys and similar infrastructure keys must not be stored here.';
  end if;

  select * into v_map from public.pt_access_secrets where access_record_id = p_record;
  if found then
    execute 'select vault.update_secret($1, $2)' using v_map.vault_secret_id, p_password;
    update public.pt_access_secrets
       set updated_at = now(), updated_by = auth.uid(), updated_by_email = nullif(auth.jwt() ->> 'email', ''), backend = v_backend
     where access_record_id = p_record;
  else
    execute 'select vault.create_secret($1, $2, $3)' into v_id
      using p_password, 'pt_access_' || p_record::text, 'Project Tracker credential for project ' || v_rec.project_id::text;
    insert into public.pt_access_secrets (access_record_id, project_id, vault_secret_id, backend, updated_by, updated_by_email)
    values (p_record, v_rec.project_id, v_id, v_backend, auth.uid(), nullif(auth.jwt() ->> 'email', ''));
  end if;
  update public.pt_access_records
     set has_password = true, password_updated_at = now(), password_updated_by_email = nullif(auth.jwt() ->> 'email', '')
   where id = p_record;
  perform public.pt_log(v_rec.project_id, 'access', v_rec.id, v_rec.service_name,
                        case when v_map.access_record_id is null then 'access.password_set' else 'access.password_changed' end, '{}'::jsonb);
end $$;

-- Returns {ok, password?, reason?, expires_in?}. Refusals are returned (not
-- raised) so that the refused attempt itself stays in the audit log.
create or replace function public.pt_reveal_access_password(p_record uuid, p_purpose text default 'reveal')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_backend text := public.pt_password_backend();
  v_set public.pt_settings%rowtype;
  v_rec public.pt_access_records%rowtype;
  v_map public.pt_access_secrets%rowtype;
  v_pw text;
  v_recent int;
  v_purpose text := case when p_purpose = 'copy' then 'copy' else 'reveal' end;
begin
  if not public.pt_can_read() then
    raise exception using errcode = '42501', message = 'You do not have access to Project Tracker.';
  end if;
  select * into v_rec from public.pt_access_records where id = p_record;
  if not found then
    raise exception using errcode = 'P0002', message = 'Access record not found.';
  end if;
  if v_backend = 'disabled' then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  select * into v_set from public.pt_settings;
  if not public.pt_is_manager() then
    perform public.pt_log(v_rec.project_id, 'access', v_rec.id, v_rec.service_name, 'access.password_denied', jsonb_build_object('reason', 'not_manager'));
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not public.pt_recent_auth(v_set.reauth_minutes) then
    perform public.pt_log(v_rec.project_id, 'access', v_rec.id, v_rec.service_name, 'access.password_denied', jsonb_build_object('reason', 'reauth_required'));
    return jsonb_build_object('ok', false, 'reason', 'reauth_required', 'minutes', v_set.reauth_minutes);
  end if;
  select count(*) into v_recent from public.pt_activity_logs
   where actor_id = auth.uid() and action in ('access.password_revealed', 'access.password_copied') and created_at > now() - interval '10 minutes';
  if v_recent >= v_set.max_reveals_per_10min then
    perform public.pt_log(v_rec.project_id, 'access', v_rec.id, v_rec.service_name, 'access.password_denied', jsonb_build_object('reason', 'rate_limited'));
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  select * into v_map from public.pt_access_secrets where access_record_id = p_record;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_password');
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where id = $1' into v_pw using v_map.vault_secret_id;
  if v_pw is null then
    return jsonb_build_object('ok', false, 'reason', 'no_password');
  end if;
  perform public.pt_log(v_rec.project_id, 'access', v_rec.id, v_rec.service_name,
                        case when v_purpose = 'copy' then 'access.password_copied' else 'access.password_revealed' end, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'password', v_pw, 'expires_in', v_set.reveal_seconds);
end $$;

create or replace function public.pt_clear_access_password(p_record uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec public.pt_access_records%rowtype;
  v_map public.pt_access_secrets%rowtype;
begin
  if not public.pt_is_manager() then
    raise exception using errcode = '42501', message = 'Only Project Tracker managers can remove a stored password.';
  end if;
  select * into v_rec from public.pt_access_records where id = p_record;
  if not found then
    raise exception using errcode = 'P0002', message = 'Access record not found.';
  end if;
  select * into v_map from public.pt_access_secrets where access_record_id = p_record;
  if found then
    if to_regclass('vault.secrets') is not null then
      execute 'delete from vault.secrets where id = $1' using v_map.vault_secret_id;
    end if;
    delete from public.pt_access_secrets where access_record_id = p_record;
  end if;
  update public.pt_access_records set has_password = false, password_updated_at = now(),
         password_updated_by_email = nullif(auth.jwt() ->> 'email', '') where id = p_record;
  perform public.pt_log(v_rec.project_id, 'access', v_rec.id, v_rec.service_name, 'access.password_cleared', '{}'::jsonb);
end $$;

-- Email account / hosting record → its credential record (created on demand, same project).
create or replace function public.pt_ensure_email_credential(p_email uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.pt_email_accounts%rowtype;
  v_id uuid;
begin
  if not public.pt_can_edit() then
    raise exception using errcode = '42501', message = 'You do not have permission to add credentials.';
  end if;
  select * into e from public.pt_email_accounts where id = p_email;
  if not found then
    raise exception using errcode = 'P0002', message = 'Email account not found.';
  end if;
  if e.linked_access_id is not null then
    return e.linked_access_id;
  end if;
  insert into public.pt_access_records (project_id, service_name, category, login_url, login_identifier, provider, purpose,
                                        account_owner, responsible_person, two_factor, last_verified_on, status)
  values (e.project_id, left(e.email_address, 150), 'email_account', e.login_url, e.email_address, e.provider, e.purpose,
          e.account_owner, e.responsible_person, e.two_factor, e.last_verified_on, 'active')
  returning id into v_id;
  update public.pt_email_accounts set linked_access_id = v_id where id = p_email;
  return v_id;
end $$;

create or replace function public.pt_ensure_hosting_credential(p_hosting uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  h public.pt_hosting%rowtype;
  v_id uuid;
begin
  if not public.pt_can_edit() then
    raise exception using errcode = '42501', message = 'You do not have permission to add credentials.';
  end if;
  select * into h from public.pt_hosting where id = p_hosting;
  if not found then
    raise exception using errcode = 'P0002', message = 'Hosting record not found.';
  end if;
  if h.access_record_id is not null then
    return h.access_record_id;
  end if;
  insert into public.pt_access_records (project_id, service_name, category, login_url, login_identifier, provider, hosting_type,
                                        environment, resource_ref, renewal_date, account_owner, responsible_person, status)
  values (h.project_id, left(h.provider || ' (' || h.environment || ')', 150), 'hosting_panel', h.control_panel_url, h.account_email, h.provider,
          h.hosting_type, h.environment, h.server_identifier, coalesce(h.renewal_date, h.expiry_date), h.account_owner, h.responsible_person, 'active')
  returning id into v_id;
  update public.pt_hosting set access_record_id = v_id where id = p_hosting;
  return v_id;
end $$;

-- Document access audit (open / download / preview). Visibility follows the
-- pt_documents RLS rules (restricted documents: managers only).
create or replace function public.pt_log_document_access(p_document uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare d public.pt_documents%rowtype;
begin
  if not public.pt_can_read() then
    raise exception using errcode = '42501', message = 'You do not have access to Project Tracker.';
  end if;
  if p_action not in ('opened', 'downloaded', 'previewed') then
    raise exception using errcode = 'P0001', message = 'Unknown document action.';
  end if;
  select * into d from public.pt_documents where id = p_document;
  if not found or (d.classification = 'restricted' and not public.pt_is_manager()) then
    raise exception using errcode = 'P0002', message = 'Document not found.';
  end if;
  perform public.pt_log(d.project_id, 'document', d.id, d.name, 'document.' || p_action, '{}'::jsonb);
end $$;

-- ------------------------------------------------------------ privileges
do $$
declare f text;
begin
  foreach f in array array[
    'public.pt_password_backend()', 'public.pt_settings_public()', 'public.pt_documents_rules()', 'public.pt_documents_after_version()',
    'public.pt_recent_auth(integer)', 'public.pt_set_access_password(uuid, text)', 'public.pt_reveal_access_password(uuid, text)',
    'public.pt_clear_access_password(uuid)', 'public.pt_ensure_email_credential(uuid)', 'public.pt_ensure_hosting_credential(uuid)',
    'public.pt_log_document_access(uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

-- =====================================================================
-- Zyllo Tech — Project Tracker: ROLLBACK OF 004 ONLY (credentials + document versioning).
-- Keeps every project, credential record and document. Removes: stored
-- passwords (vault secrets of this module), pt_settings, the new columns
-- (credential metadata, hosting→credential links, document description and
-- version links — every version stays as its own document), and restores
-- the 001 audit function. Credential records using the new categories
-- (supabase, cpanel, cloudflare, vercel, render) become category 'other'.
-- Needs explicit approval.
-- =====================================================================
begin;

-- Delete this module's secrets from the vault first (only ours: named pt_access_<record id>).
do $$
begin
  if to_regclass('vault.secrets') is not null and to_regclass('public.pt_access_secrets') is not null then
    execute 'delete from vault.secrets where id in (select vault_secret_id from public.pt_access_secrets)';
  end if;
end $$;

drop trigger if exists pt_20_rules on public.pt_documents;
drop trigger if exists pt_80_versions on public.pt_documents;
drop function if exists public.pt_documents_after_version();
drop function if exists public.pt_documents_rules();
drop function if exists public.pt_log_document_access(uuid, text);
drop function if exists public.pt_ensure_hosting_credential(uuid);
drop function if exists public.pt_ensure_email_credential(uuid);
drop function if exists public.pt_clear_access_password(uuid);
drop function if exists public.pt_reveal_access_password(uuid, text);
drop function if exists public.pt_set_access_password(uuid, text);
drop function if exists public.pt_recent_auth(integer);
drop function if exists public.pt_settings_public();
drop function if exists public.pt_password_backend();

drop table if exists public.pt_access_secrets;
drop table if exists public.pt_settings;

alter table public.pt_documents drop constraint if exists pt_documents_supersedes_fk;
alter table public.pt_documents drop column if exists description, drop column if exists version_group_id,
  drop column if exists supersedes_id, drop column if exists is_current;
alter table public.pt_hosting drop constraint if exists pt_hosting_access_fk;
alter table public.pt_hosting drop column if exists access_record_id;

alter table public.pt_access_records disable trigger user;
update public.pt_access_records set category = 'other' where category in ('supabase', 'cpanel', 'cloudflare', 'vercel', 'render');
alter table public.pt_access_records enable trigger user;
alter table public.pt_access_records drop constraint pt_access_records_category_check;
alter table public.pt_access_records add constraint pt_access_records_category_check check (category in (
  'website_admin', 'hosting_panel', 'vps_ssh', 'database', 'domain_registrar', 'github', 'email_account', 'third_party', 'api_service', 'other'));
alter table public.pt_access_records drop column if exists login_identifier, drop column if exists provider, drop column if exists hosting_type,
  drop column if exists environment, drop column if exists resource_ref, drop column if exists organization, drop column if exists project_name,
  drop column if exists renewal_date, drop column if exists purpose, drop column if exists has_password,
  drop column if exists password_updated_at, drop column if exists password_updated_by_email;

-- Audit function exactly as created by 001:
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

commit;

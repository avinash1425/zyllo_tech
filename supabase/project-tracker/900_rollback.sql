-- =====================================================================
-- Zyllo Tech — Project Tracker: ROLLBACK (removes the module completely).
--
-- DESTRUCTIVE: deletes every Project Tracker record, log and uploaded
-- document. Needs explicit approval. Export what you need first (Reports >
-- export, and download documents). Nothing outside pt_* / the
-- project-tracker-documents bucket is touched.
--
-- Softer alternative: leave the data in place and only hide the UI
-- (revert the frontend commit). The tables are unreachable without the UI
-- except to Project Tracker users through the API, which RLS still guards.
-- =====================================================================

begin;

-- Delete this module's secrets from the vault first (only ours: named pt_access_<record id>).
do $$
begin
  if to_regclass('vault.secrets') is not null and to_regclass('public.pt_access_secrets') is not null then
    execute 'delete from vault.secrets where id in (select vault_secret_id from public.pt_access_secrets)';
  end if;
end $$;

-- 1. Storage policies (002)
drop policy if exists "pt documents: editors upload into active projects" on storage.objects;
drop policy if exists "pt documents: read files of visible documents" on storage.objects;
drop policy if exists "pt documents: editors remove orphaned uploads" on storage.objects;

-- 2. Uploaded files and bucket. Supabase blocks direct SQL deletes from
--    storage.objects (storage.protect_delete). Empty the bucket first in the
--    dashboard (Storage > project-tracker-documents > select all > Delete) or
--    with the Storage API, then this succeeds:
delete from storage.buckets where id = 'project-tracker-documents';

-- 3. Views (pt_company_summary exists only if 003 was applied)
drop view if exists public.pt_company_summary;
drop view if exists public.pt_project_list;
drop view if exists public.pt_due_items;
drop view if exists public.pt_project_health;

-- 4. Tables (children first)
alter table if exists public.pt_hosting drop constraint if exists pt_hosting_access_fk;
drop table if exists public.pt_access_secrets;
drop table if exists public.pt_settings;
drop table if exists public.pt_activity_logs;
drop table if exists public.pt_handover_events;
drop table if exists public.pt_handover_items;
drop table if exists public.pt_handovers;
drop table if exists public.pt_remarks;
drop table if exists public.pt_seo_records;
drop table if exists public.pt_renewals;
drop table if exists public.pt_amc_contracts;
drop table if exists public.pt_updates;
drop table if exists public.pt_documents;
drop table if exists public.pt_tasks;
drop table if exists public.pt_milestones;
drop table if exists public.pt_deployments;
drop table if exists public.pt_repositories;
drop table if exists public.pt_backups;
drop table if exists public.pt_email_accounts;
drop table if exists public.pt_access_refs;
drop table if exists public.pt_access_records;
drop table if exists public.pt_domains;
drop table if exists public.pt_hosting;
drop table if exists public.pt_projects;
drop table if exists public.pt_companies;
drop table if exists public.pt_members;

-- 5. Functions
drop function if exists public.pt_log_document_access(uuid, text);
drop function if exists public.pt_ensure_hosting_credential(uuid);
drop function if exists public.pt_ensure_email_credential(uuid);
drop function if exists public.pt_clear_access_password(uuid);
drop function if exists public.pt_reveal_access_password(uuid, text);
drop function if exists public.pt_set_access_password(uuid, text);
drop function if exists public.pt_recent_auth(integer);
drop function if exists public.pt_settings_public();
drop function if exists public.pt_password_backend();
drop function if exists public.pt_documents_after_version();
drop function if exists public.pt_documents_rules();
drop function if exists public.pt_projects_company_rules();
drop function if exists public.pt_companies_rules();
drop function if exists public.pt_set_member_role(text, text, text);
drop function if exists public.pt_list_members();
drop function if exists public.pt_renew_amc(uuid, date, date, date, text);
drop function if exists public.pt_complete_renewal(uuid, date, date, text, text);
drop function if exists public.pt_handover_transition(uuid, text, text);
drop function if exists public.pt_start_handover(uuid);
drop function if exists public.pt_reveal_access_reference(uuid);
drop function if exists public.pt_set_access_reference(uuid, text, text);
drop function if exists public.pt_my_role();
drop function if exists public.pt_project_is_active(text);
drop function if exists public.pt_document_path_exists(text);
drop function if exists public.pt_append_only();
drop function if exists public.pt_after_write();
drop function if exists public.pt_handover_items_rules();
drop function if exists public.pt_handovers_rules();
drop function if exists public.pt_domains_rules();
drop function if exists public.pt_email_rules();
drop function if exists public.pt_backups_rules();
drop function if exists public.pt_set_codes();
drop function if exists public.pt_projects_rules();
drop function if exists public.pt_before_write();
drop function if exists public.pt_log(uuid, text, uuid, text, text, jsonb);
drop function if exists public.pt_mask_identifier(text);
drop function if exists public.pt_valid_email(text);
drop function if exists public.pt_valid_url(text);
drop function if exists public.pt_looks_like_secret(text);
drop function if exists public.pt_is_api_call();
drop function if exists public.pt_is_manager();
drop function if exists public.pt_can_edit();
drop function if exists public.pt_can_read();
drop function if exists public.pt_role();
drop function if exists public.pt_today();

commit;

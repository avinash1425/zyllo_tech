-- Rollback of 223_project_tracker_access_documents_backups.sql.
-- WARNING: permanently deletes every Project Tracker login (and its encrypted password),
-- every document record and every backup record, plus the password access log.
-- Uploaded files must be emptied from the "pt-project-documents" bucket first
-- (Dashboard > Storage); the bucket row is only removed when it is empty.
-- The supabase_vault extension itself is NOT removed (Supabase installs it by default).

drop table if exists public.pt_backups;
drop table if exists public.pt_documents;

-- Deleting the mappings fires the cleanup trigger, which deletes the vault secrets.
delete from pt_private.credential_secrets;
drop table if exists pt_private.credential_secrets;
-- Belt and braces: any Project Tracker secret left in the vault.
delete from vault.secrets where name like 'pt_credential_%';

drop table if exists public.pt_credential_events;
drop table if exists public.pt_credentials;

drop function if exists public.pt_credential_set_password(uuid, text);
drop function if exists public.pt_credential_remove_password(uuid);
drop function if exists public.pt_credential_reveal_password(uuid, text);

drop policy if exists "pt-project-documents: admin read" on storage.objects;
drop policy if exists "pt-project-documents: admin upload" on storage.objects;
drop policy if exists "pt-project-documents: admin delete" on storage.objects;
delete from storage.buckets where id = 'pt-project-documents'
  and not exists (select 1 from storage.objects where bucket_id = 'pt-project-documents');

drop schema if exists pt_private cascade;

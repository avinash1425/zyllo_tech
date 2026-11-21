-- Rollback of 224_project_tracker_credential_email_repo.sql.
-- WARNING: permanently deletes the email and repository stored on every Project Tracker login.
alter table public.pt_credentials drop constraint if exists pt_credentials_email_repo_check;
alter table public.pt_credentials drop column if exists email;
alter table public.pt_credentials drop column if exists repository;

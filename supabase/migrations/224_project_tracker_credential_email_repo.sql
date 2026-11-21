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

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

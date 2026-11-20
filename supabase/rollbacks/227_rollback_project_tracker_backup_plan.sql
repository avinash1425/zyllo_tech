-- Rollback of 227_project_tracker_backup_plan.sql.
-- WARNING: "not kept" answers (kept = false) are deleted; kept backups stay as plain backup rows.
-- Linked logins (and their encrypted passwords) are not touched.
delete from public.pt_backups where kept = false;
drop index if exists public.pt_backups_project_frequency_key;
alter table public.pt_backups drop constraint if exists pt_backups_kept_location_check;
alter table public.pt_backups drop constraint if exists pt_backups_frequency_check;
alter table public.pt_backups drop column if exists kept;
alter table public.pt_backups drop column if exists frequency;
update public.pt_backups set location = 'Unknown' where location is null;
alter table public.pt_backups alter column location set not null;
alter table public.pt_backups drop constraint if exists pt_backups_location_check;
alter table public.pt_backups add constraint pt_backups_location_check
  check (length(btrim(location)) between 1 and 120);

-- Rollback of 228_project_tracker_completed_date.sql.
-- WARNING: every saved completed date is deleted.
alter table public.pt_projects drop constraint if exists pt_projects_completed_date_check;
alter table public.pt_projects drop column if exists completed_date;
notify pgrst, 'reload schema';

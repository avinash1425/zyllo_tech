-- 228: Project Tracker — actual completion date.
--   start_date     = when the project started            (existing)
--   end_date       = end date promised to the client     (existing)
--   completed_date = the day it was actually completed   (new) — later than end_date means it was delayed.
-- Additive only: no existing data changes. Rollback: supabase/rollbacks/228_rollback_project_tracker_completed_date.sql

alter table public.pt_projects add column if not exists completed_date date;

alter table public.pt_projects drop constraint if exists pt_projects_completed_date_check;
alter table public.pt_projects add constraint pt_projects_completed_date_check
  check (completed_date is null or start_date is null or completed_date >= start_date);

comment on column public.pt_projects.end_date is 'End date promised to the client.';
comment on column public.pt_projects.completed_date is 'Date the project was actually completed (after end_date = delayed).';

notify pgrst, 'reload schema';

-- Rollback of 220_project_tracker_companies.sql.
-- WARNING: permanently deletes every client company stored in the Project Tracker.
-- Touches nothing outside the Project Tracker.
drop table if exists public.pt_companies;
drop function if exists public.pt_set_updated_at();

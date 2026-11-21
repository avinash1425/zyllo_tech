-- Rollback of 222_project_tracker_project_fields.sql.
-- WARNING: permanently deletes the Project ID, type, progress, manager, priority, health,
-- live URL, repo/source, next action and notes of every project. Projects with status
-- 'live' are moved to 'completed' so the old status rule can be restored.
update public.pt_projects set status = 'completed' where status = 'live';
alter table public.pt_projects drop constraint if exists pt_projects_status_check;
alter table public.pt_projects add constraint pt_projects_status_check
  check (status in ('planning', 'in_progress', 'on_hold', 'completed', 'cancelled'));
alter table public.pt_projects drop constraint if exists pt_projects_fields_check;
drop index if exists public.pt_projects_status_idx;
drop index if exists public.pt_projects_code_key;
alter table public.pt_projects
  drop column if exists project_code,
  drop column if exists project_type,
  drop column if exists progress,
  drop column if exists project_manager,
  drop column if exists priority,
  drop column if exists health,
  drop column if exists live_url,
  drop column if exists repo_source,
  drop column if exists next_action,
  drop column if exists notes;
drop sequence if exists public.pt_project_code_seq;

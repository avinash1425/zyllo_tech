-- Rollback of 232_employee_projects.sql. Deletes ALL project teams, tasks and updates
-- (Project Tracker projects themselves are not touched).
begin;
drop function if exists public.ep_post_update(uuid, text);
drop function if exists public.ep_set_task_status(uuid, text);
drop function if exists public.ep_add_task(uuid, text, text, uuid, date, text);
drop function if exists public.ep_project_detail(uuid);
drop function if exists public.ep_my_projects();
drop table if exists public.ep_project_updates;
drop table if exists public.ep_project_tasks;
drop table if exists public.ep_project_members;
drop function if exists public.ep_is_project_member(uuid);
notify pgrst, 'reload schema';
commit;

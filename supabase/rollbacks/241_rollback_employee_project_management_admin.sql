-- Rollback of 241_employee_project_management_admin.sql (functions only).
-- Teams, tasks and deadlines changed through them stay.
begin;
drop function if exists public.ep_admin_pm_set_deadline(uuid, date);
drop function if exists public.ep_admin_pm_delete_task(uuid);
drop function if exists public.ep_admin_pm_save_task(uuid, uuid, jsonb);
drop function if exists public.ep_admin_pm_remove_member(uuid, uuid);
drop function if exists public.ep_admin_pm_save_member(uuid, uuid, text, boolean);
drop function if exists public.ep_admin_pm_project(uuid);
drop function if exists public.ep_admin_pm_projects();
notify pgrst, 'reload schema';
commit;

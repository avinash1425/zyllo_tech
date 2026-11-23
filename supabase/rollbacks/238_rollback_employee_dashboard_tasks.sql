-- Rollback of 238_employee_dashboard_tasks.sql (function only; no data).
begin;
drop function if exists public.ep_my_open_tasks(int);
notify pgrst, 'reload schema';
commit;

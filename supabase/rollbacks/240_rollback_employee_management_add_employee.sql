-- Rollback of 240_employee_management_add_employee.sql (function only).
-- Employees / sign-in accounts already created with it are kept.
begin;
drop function if exists public.ep_admin_create_employee(jsonb);
notify pgrst, 'reload schema';
commit;

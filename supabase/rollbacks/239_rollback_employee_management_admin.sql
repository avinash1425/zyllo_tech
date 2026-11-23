-- Rollback of 239_employee_management_admin.sql (functions only; no tables or data).
-- Note: work details / access changes made through these functions stay in ep_employees.
begin;
drop function if exists public.ep_my_access();
drop function if exists public.ep_admin_set_employee_access(uuid, boolean);
drop function if exists public.ep_admin_update_employee(uuid, jsonb);
drop function if exists public.ep_admin_employee(uuid);
drop function if exists public.ep_admin_employees();
drop function if exists public.ep_admin_employee_json(uuid);
drop function if exists public.ep_require_admin();
notify pgrst, 'reload schema';
commit;

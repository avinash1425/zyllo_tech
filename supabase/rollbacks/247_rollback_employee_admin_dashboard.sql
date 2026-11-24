-- Rollback of 247_employee_admin_dashboard.sql (function only; no data).
begin;
drop function if exists public.ep_admin_portal_dashboard();
notify pgrst, 'reload schema';
commit;

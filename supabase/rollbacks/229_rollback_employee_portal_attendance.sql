-- Rollback of 229_employee_portal_attendance.sql. Deletes ALL attendance data.
begin;
drop function if exists public.ep_punch_out();
drop function if exists public.ep_punch_in();
drop function if exists public.ep_me();
drop table if exists public.ep_attendance;
drop table if exists public.ep_employees;
notify pgrst, 'reload schema';
commit;

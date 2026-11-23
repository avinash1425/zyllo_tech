-- Rollback of 230_employee_attendance_rules.sql (functions only; no data).
begin;
drop function if exists public.ep_my_attendance(date, date);
drop function if exists public.ep_attendance_rules();
notify pgrst, 'reload schema';
commit;

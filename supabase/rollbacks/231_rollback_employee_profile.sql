-- Rollback of 231_employee_profile.sql. Deletes ALL profile and emergency-contact data
-- and the work-detail columns.
begin;
drop function if exists public.ep_save_my_emergency_contacts(jsonb);
drop function if exists public.ep_update_my_profile(jsonb);
drop function if exists public.ep_my_profile();
drop function if exists public.ep_current_employee_id();
drop table if exists public.ep_emergency_contacts;
drop table if exists public.ep_employee_profiles;
alter table public.ep_employees
  drop constraint if exists ep_employees_not_own_manager,
  drop column if exists work_location,
  drop column if exists employment_type,
  drop column if exists date_of_joining,
  drop column if exists reporting_manager_id,
  drop column if exists designation,
  drop column if exists department;
notify pgrst, 'reload schema';
commit;

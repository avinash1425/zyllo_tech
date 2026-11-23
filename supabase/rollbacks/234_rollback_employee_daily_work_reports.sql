-- Rollback of 234_employee_daily_work_reports.sql.
-- WARNING: drops the daily work report tables, so all reports are deleted.
-- Take a backup first if any real reports exist.
begin;
drop function if exists public.ep_review_report(uuid, text, text);
drop function if exists public.ep_team_report(uuid);
drop function if exists public.ep_team_reports();
drop function if exists public.ep_save_my_report(date, text, jsonb, boolean);
drop function if exists public.ep_my_reports(date, date);
drop function if exists public.ep_my_report(date);
drop function if exists public.ep_report_json(uuid);
drop table if exists public.ep_work_report_items;
drop table if exists public.ep_work_reports;
notify pgrst, 'reload schema';
commit;

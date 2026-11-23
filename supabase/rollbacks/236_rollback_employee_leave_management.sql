-- Rollback of 236_employee_leave_management.sql.
-- WARNING: drops the leave tables, so all leave requests, allocations and holidays are deleted.
begin;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job
     where jobname in ('ep-remind-punch-in', 'ep-remind-report', 'ep-remind-punch-out');
  end if;
end $$;
drop function if exists public.ep_send_reminders(text);
drop function if exists public.ep_my_days_off(date, date);
drop function if exists public.ep_decide_leave(uuid, text, text);
drop function if exists public.ep_team_leave();
drop function if exists public.ep_cancel_leave(uuid);
drop function if exists public.ep_apply_leave(text, date, date, text, text);
drop function if exists public.ep_leave_preview(date, date, text);
drop function if exists public.ep_leave_overview(int);
drop function if exists public.ep_leave_json(public.ep_leave_requests);
drop function if exists public.ep_is_day_off(uuid, date);
drop function if exists public.ep_leave_taken(uuid, int, text, uuid);
drop function if exists public.ep_leave_allowance(uuid, int, text);
drop function if exists public.ep_leave_day_count(date, date, text);
drop table if exists public.ep_leave_requests;
drop table if exists public.ep_holidays;
drop table if exists public.ep_leave_allocations;
drop table if exists public.ep_leave_types;
notify pgrst, 'reload schema';
commit;

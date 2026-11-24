-- Turns on the Employee Portal's scheduled jobs. Run this in the SQL editor AFTER pg_cron has been enabled
-- (and after employee_portal_253-268_updates.sql). Safe to run again: it replaces the jobs with the same names.
--   ep-reminders        every 5 min       punch-in / daily report / punch-out reminders
--   ep-auto-punch-out   20:00 + 00:00 IST closes sessions left open
--   rbac-welcome-check  every 5 min       delivery / bounce check of welcome emails -> "Mailbox does not exist"
begin;
select cron.unschedule(jobname) from cron.job
 where jobname in ('ep-reminders', 'ep-auto-punch-out', 'rbac-welcome-check',
                   'ep-remind-punch-in', 'ep-remind-report', 'ep-remind-punch-out');
select cron.schedule('ep-reminders',       '*/5 * * * *',    'select public.ep_run_due_reminders()');
select cron.schedule('ep-auto-punch-out',  '30 14,18 * * *', 'select public.ep_close_overdue_sessions()');
select cron.schedule('rbac-welcome-check', '*/5 * * * *',    'select public.rbac_check_welcome_emails()');
commit;
select jobname, schedule, active from cron.job
 where jobname in ('ep-reminders', 'ep-auto-punch-out', 'rbac-welcome-check') order by jobname;

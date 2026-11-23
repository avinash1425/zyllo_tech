-- Rollback of 235_employee_notifications.sql.
-- WARNING: drops ep_notifications, so all notifications and messages are deleted.
-- Roll back 236 first (its functions call ep_notify).
begin;
drop trigger if exists ep_project_member_added on public.ep_project_members;
drop trigger if exists ep_task_assigned on public.ep_project_tasks;
drop trigger if exists ep_report_status on public.ep_work_reports;
drop function if exists public.ep_trg_project_member_added();
drop function if exists public.ep_trg_task_assigned();
drop function if exists public.ep_trg_report_status();
drop function if exists public.ep_sent_messages();
drop function if exists public.ep_send_message(text, uuid[], text, text, text);
drop function if exists public.ep_message_options();
drop function if exists public.ep_mark_notifications_read(uuid[]);
drop function if exists public.ep_notification_summary();
drop function if exists public.ep_my_notifications(text);
drop function if exists public.ep_notify(uuid, text, text, text, text, text, text);
drop table if exists public.ep_notifications;
notify pgrst, 'reload schema';
commit;

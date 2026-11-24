-- Rollback of 243_employee_admin_reports_notifications.sql.
-- Restores ep_report_json (234) and ep_trg_report_status (235), the 3 fixed reminder jobs (236),
-- and drops the admin functions, ep_reminder_settings and ep_work_reports.reviewed_by_admin.
begin;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'ep-reminders';
    perform cron.schedule('ep-remind-punch-in',  '15 4 * * 1-6', $c$select public.ep_send_reminders('punch_in')$c$);
    perform cron.schedule('ep-remind-report',    '0 13 * * 1-6', $c$select public.ep_send_reminders('report')$c$);
    perform cron.schedule('ep-remind-punch-out', '0 16 * * 1-6', $c$select public.ep_send_reminders('punch_out')$c$);
  end if;
end $$;

drop function if exists public.ep_admin_notification_log(text, int);
drop function if exists public.ep_admin_send_reminder_now(text);
drop function if exists public.ep_admin_save_reminder(text, boolean, time, smallint[]);
drop function if exists public.ep_admin_reminder_settings();
drop function if exists public.ep_run_due_reminders();
drop table if exists public.ep_reminder_settings;
drop function if exists public.ep_admin_send_notification(text, uuid[], text[], uuid, text, text, text);
drop function if exists public.ep_admin_notify_options();
drop function if exists public.ep_admin_review_report(uuid, text, text);
drop function if exists public.ep_admin_reports(date, date);

create or replace function public.ep_report_json(p_report uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'report_date', r.report_date, 'status', r.status, 'notes', r.notes,
    'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at, 'review_comment', r.review_comment,
    'updated_at', r.updated_at,
    'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                   'designation', e.designation),
    'submitted_to', case when st.id is null then null
                         else jsonb_build_object('id', st.id, 'full_name', st.full_name, 'employee_code', st.employee_code) end,
    'reviewed_by', case when rb.id is null then null
                        else jsonb_build_object('id', rb.id, 'full_name', rb.full_name) end,
    'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0),
    'worked_minutes', (
      select floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int
      from public.ep_attendance a where a.employee_id = r.employee_id and a.work_date = r.report_date),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', i.project_id, 'project_code', p.project_code, 'project_name', p.name,
               'task_updates', i.task_updates, 'completed_work', i.completed_work,
               'pending_work', i.pending_work, 'hours', i.hours)
             order by i.position, p.name)
      from public.ep_work_report_items i join public.pt_projects p on p.id = i.project_id
      where i.report_id = r.id), '[]'::jsonb)
  )
  from public.ep_work_reports r
  join public.ep_employees e on e.id = r.employee_id
  left join public.ep_employees st on st.id = r.submitted_to
  left join public.ep_employees rb on rb.id = r.reviewed_by
  where r.id = p_report;
$$;
revoke all on function public.ep_report_json(uuid) from public, anon, authenticated;

create or replace function public.ep_trg_report_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp_name text;
  v_mgr_name text;
  v_day      text := to_char(new.report_date, 'DD Mon YYYY');
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  select full_name into v_emp_name from public.ep_employees where id = new.employee_id;
  select full_name into v_mgr_name from public.ep_employees where id = new.reviewed_by;
  if new.status = 'submitted' then
    perform public.ep_notify(new.submitted_to, 'report',
      v_emp_name || ' submitted a daily report', 'Report for ' || v_day || ' is waiting for your review.',
      '/employee/reports/team/' || new.id);
  elsif new.status = 'reviewed' then
    perform public.ep_notify(new.employee_id, 'report',
      'Your daily report was reviewed', 'Report for ' || v_day || coalesce(' · ' || v_mgr_name, '')
        || coalesce(': ' || new.review_comment, ''),
      '/employee/reports?date=' || new.report_date);
  elsif new.status = 'returned' then
    perform public.ep_notify(new.employee_id, 'report',
      'Your daily report was sent back', 'Report for ' || v_day || coalesce(': ' || new.review_comment, ''),
      '/employee/reports?date=' || new.report_date, 'urgent');
  end if;
  return new;
end $$;
alter table public.ep_work_reports drop column if exists reviewed_by_admin;

notify pgrst, 'reload schema';
commit;

-- 243: Employee Portal — admin Daily Work Reports + admin Notifications Management.
--
-- DAILY WORK REPORTS (admin only)
--   ep_admin_reports(from, to)                 -> every report in the range (with items, hours, manager feedback)
--                                                 + "missing": days an employee worked (punched in) but has no
--                                                 submitted report yet
--   ep_admin_review_report(id, action, comment)-> admin marks a submitted report Reviewed or Sends it back
--   ep_work_reports.reviewed_by_admin          -> who reviewed, when it was an admin ("Admin" in the JSON)
--
-- NOTIFICATIONS MANAGEMENT (admin only)
--   ep_admin_notify_options()                  -> people, departments and project teams to send to
--   ep_admin_send_notification(audience, ...)  -> 'all' | 'people' | 'department' | 'project'
--                                                 (shows in "Sent" like ep_send_message, sender "Admin")
--   ep_reminder_settings                       -> the 3 scheduled reminders (punch in, daily report, punch out):
--                                                 on/off, time (India) and week days, editable by the admin.
--                                                 ONE pg_cron job ('ep-reminders', every 5 minutes) runs
--                                                 ep_run_due_reminders(); the 3 fixed jobs from 236 are removed.
--   ep_admin_reminder_settings() / ep_admin_save_reminder(kind, enabled, time, days)
--   ep_admin_send_reminder_now(kind)           -> send now (each person at most once per day per reminder)
--   ep_admin_notification_log(kind, limit)     -> recent notifications to everyone, + 30-day counts per kind
-- Rollback: supabase/rollbacks/243_rollback_employee_admin_reports_notifications.sql

begin;

-- ================================================================ REPORTS
alter table public.ep_work_reports
  add column if not exists reviewed_by_admin uuid references auth.users (id) on delete set null;

-- reviewed_by = the manager, or { full_name: 'Admin' } when an admin reviewed.
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
    'reviewed_by', case when rb.id is not null then jsonb_build_object('id', rb.id, 'full_name', rb.full_name)
                        when r.reviewed_by_admin is not null then jsonb_build_object('id', null, 'full_name', 'Admin')
                        else null end,
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

-- Report status notifications: name "Admin" when an admin reviewed.
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
  if v_mgr_name is null and new.reviewed_by_admin is not null then
    v_mgr_name := 'Admin';
  end if;
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
      'Your daily report was sent back', 'Report for ' || v_day || coalesce(' · ' || v_mgr_name, '')
        || coalesce(': ' || new.review_comment, ''),
      '/employee/reports?date=' || new.report_date, 'urgent');
  end if;
  return new;
end $$;
revoke all on function public.ep_trg_report_status() from public, anon, authenticated;

create or replace function public.ep_admin_reports(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.ep_require_admin();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose a date range of at most 93 days.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(public.ep_report_json(r.id) order by r.report_date desc, r.updated_at desc)
      from public.ep_work_reports r where r.report_date between p_from and p_to), '[]'::jsonb),
    -- Worked that day (punched in, on a project) but no submitted / reviewed report.
    'missing', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code),
               'date', d.work_date,
               'status', coalesce(w.status, 'not_started')) order by d.work_date desc, e.full_name)
      from (select distinct employee_id, work_date from public.ep_attendance
             where work_date between p_from and least(p_to, v_today)) d
      join public.ep_employees e on e.id = d.employee_id
      left join public.ep_work_reports w on w.employee_id = d.employee_id and w.report_date = d.work_date
      where exists (select 1 from public.ep_project_members m where m.employee_id = e.id)
        and (w.id is null or w.status in ('draft', 'returned'))), '[]'::jsonb));
end $$;

create or replace function public.ep_admin_review_report(p_report uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_status  text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.ep_require_admin();
  select status into v_status from public.ep_work_reports where id = p_report for update;
  if v_status is null then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed (this one is %).', v_status using errcode = 'P0001';
  end if;
  if p_action not in ('reviewed', 'returned') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'returned' and v_comment is null then
    raise exception 'Write a comment saying what needs to change.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  update public.ep_work_reports
     set status = p_action, reviewed_by = null, reviewed_by_admin = auth.uid(), reviewed_at = now(),
         review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $$;

-- ================================================================ NOTIFICATIONS
create or replace function public.ep_admin_notify_options()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation, 'department', e.department) order by e.full_name)
      from public.ep_employees e where e.is_active), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('name', d.department, 'count', d.n) order by d.department)
      from (select department, count(*) as n from public.ep_employees
             where is_active and department is not null group by department) d), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'project_code', p.project_code, 'count', x.n)
                       order by p.name)
      from public.pt_projects p
      join (select m.project_id, count(*) as n from public.ep_project_members m
              join public.ep_employees e on e.id = m.employee_id and e.is_active
             group by m.project_id) x on x.project_id = p.id), '[]'::jsonb));
end $$;

-- p_audience: 'all' | 'people' (p_to) | 'department' (p_departments) | 'project' (p_project).
create or replace function public.ep_admin_send_notification(
  p_audience text, p_to uuid[], p_departments text[], p_project uuid,
  p_title text, p_body text, p_priority text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_msg   uuid := gen_random_uuid();
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
  v_n     integer;
begin
  perform public.ep_require_admin();
  if length(v_title) not between 1 and 150 then
    raise exception 'Subject must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('normal', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if p_audience not in ('all', 'people', 'department', 'project') then
    raise exception 'Invalid audience.' using errcode = '22023';
  end if;
  if p_audience = 'people' and coalesce(cardinality(p_to), 0) = 0 then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_audience = 'department' and coalesce(cardinality(p_departments), 0) = 0 then
    raise exception 'Choose at least one department.' using errcode = '22023';
  end if;
  if p_audience = 'project' and p_project is null then
    raise exception 'Choose a project team.' using errcode = '22023';
  end if;

  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_employee_id, sender_user_id, sender_label, message_id)
  select e.id, 'message', p_priority, v_title, v_body, null, auth.uid(), 'Admin', v_msg
    from public.ep_employees e
   where e.is_active
     and case p_audience
           when 'all'        then true
           when 'people'     then e.id = any (p_to)
           when 'department' then e.department = any (p_departments)
           else exists (select 1 from public.ep_project_members m where m.project_id = p_project and m.employee_id = e.id)
         end;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nobody active matches this audience.' using errcode = '22023';
  end if;
  return jsonb_build_object('message_id', v_msg, 'recipients', v_n);
end $$;

-- ---------------------------------------------------------------- scheduled reminders
create table if not exists public.ep_reminder_settings (
  kind       text primary key check (kind in ('punch_in', 'report', 'punch_out')),
  enabled    boolean not null default true,
  send_at    time not null,
  days       smallint[] not null default '{1,2,3,4,5,6}'
             check (days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(days) between 1 and 7),
  last_run   date,
  updated_at timestamptz not null default now()
);
comment on table public.ep_reminder_settings is
  'Employee Portal: scheduled reminders (India time; days = ISO weekdays 1 Mon .. 7 Sun). Run by ep_run_due_reminders().';
insert into public.ep_reminder_settings (kind, send_at) values
  ('punch_in', '09:45'), ('report', '18:30'), ('punch_out', '21:30')
on conflict (kind) do nothing;
alter table public.ep_reminder_settings enable row level security;
revoke all on public.ep_reminder_settings from anon, authenticated;

-- Sends every reminder that is due now (at most once a day each). Called every 5 minutes by pg_cron.
-- A reminder more than 2 hours late (e.g. the job was paused) is skipped for that day.
create or replace function public.ep_run_due_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_now   timestamp := timezone('Asia/Kolkata', now());
  v_today date := v_now::date;
  v_n     integer := 0;
  s       public.ep_reminder_settings;
begin
  for s in select * from public.ep_reminder_settings
            where enabled and extract(isodow from v_today)::smallint = any (days)
              and v_now::time >= send_at and v_now::time < send_at + interval '2 hours'
              and (last_run is null or last_run < v_today)
            for update skip locked loop
    v_n := v_n + public.ep_send_reminders(s.kind);
    update public.ep_reminder_settings set last_run = v_today where kind = s.kind;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_run_due_reminders() from public, anon, authenticated;

create or replace function public.ep_admin_reminder_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return (select jsonb_agg(jsonb_build_object(
                   'kind', kind, 'enabled', enabled, 'send_at', to_char(send_at, 'HH24:MI'),
                   'days', to_jsonb(days), 'last_run', last_run,
                   'sent_today', (select count(*) from public.ep_notifications
                                   where dedupe_key = s.kind || ':' || (timezone('Asia/Kolkata', now()))::date))
                 order by send_at)
          from public.ep_reminder_settings s);
end $$;

create or replace function public.ep_admin_save_reminder(p_kind text, p_enabled boolean, p_send_at time, p_days smallint[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if p_send_at is null or p_send_at < time '06:00' or p_send_at > time '21:55' then
    raise exception 'Choose a time between 6:00 AM and 9:55 PM.' using errcode = '22023';
  end if;
  if p_days is null or cardinality(p_days) = 0 or not (p_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
    raise exception 'Choose at least one day.' using errcode = '22023';
  end if;
  update public.ep_reminder_settings
     set enabled = coalesce(p_enabled, false), send_at = p_send_at,
         days = (select array_agg(distinct d order by d) from unnest(p_days) d), updated_at = now()
   where kind = p_kind;
  if not found then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_reminder_settings();
end $$;

-- Send one reminder now. Returns how many people got it (people already reminded today are skipped).
create or replace function public.ep_admin_send_reminder_now(p_kind text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_key    text;
  v_before integer;
  v_after  integer;
begin
  perform public.ep_require_admin();
  if p_kind not in ('punch_in', 'report', 'punch_out') then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  v_key := p_kind || ':' || (timezone('Asia/Kolkata', now()))::date;
  select count(*) into v_before from public.ep_notifications where dedupe_key = v_key;
  perform public.ep_send_reminders(p_kind);
  select count(*) into v_after from public.ep_notifications where dedupe_key = v_key;
  return v_after - v_before;
end $$;

-- ---------------------------------------------------------------- log
-- p_kind: 'all' | a kind | 'automatic' (no sender) | 'messages'.
create or replace function public.ep_admin_notification_log(p_kind text default 'all', p_limit int default 100)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return jsonb_build_object(
    'counts', (
      select jsonb_object_agg(k.kind, coalesce(c.n, 0))
      from unnest(array['project', 'leave', 'attendance', 'report', 'message']) k(kind)
      left join (select kind, count(*) as n from public.ep_notifications
                  where created_at > now() - interval '30 days' group by kind) c on c.kind = k.kind),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
               'created_at', n.created_at, 'read_at', n.read_at, 'sender', n.sender_label,
               'automatic', n.sender_user_id is null,
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code))
             order by n.created_at desc)
      from (select * from public.ep_notifications
             where case coalesce(p_kind, 'all')
                     when 'all' then true
                     when 'automatic' then sender_user_id is null
                     when 'messages' then message_id is not null
                     else kind = p_kind
                   end
             order by created_at desc
             limit least(greatest(coalesce(p_limit, 100), 1), 300)) n
      join public.ep_employees e on e.id = n.employee_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- cron: one job instead of three
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning 'ep reminders: pg_cron not installed; scheduled reminders will not run.';
    return;
  end if;
  perform cron.unschedule(jobname) from cron.job
   where jobname in ('ep-remind-punch-in', 'ep-remind-report', 'ep-remind-punch-out');
  perform cron.schedule('ep-reminders', '*/5 * * * *', $c$select public.ep_run_due_reminders()$c$);
end $$;

-- ================================================================ grants
revoke all on function
  public.ep_admin_reports(date, date), public.ep_admin_review_report(uuid, text, text),
  public.ep_admin_notify_options(), public.ep_admin_send_notification(text, uuid[], text[], uuid, text, text, text),
  public.ep_admin_reminder_settings(), public.ep_admin_save_reminder(text, boolean, time, smallint[]),
  public.ep_admin_send_reminder_now(text), public.ep_admin_notification_log(text, int)
  from public, anon;
grant execute on function
  public.ep_admin_reports(date, date), public.ep_admin_review_report(uuid, text, text),
  public.ep_admin_notify_options(), public.ep_admin_send_notification(text, uuid[], text[], uuid, text, text, text),
  public.ep_admin_reminder_settings(), public.ep_admin_save_reminder(text, boolean, time, smallint[]),
  public.ep_admin_send_reminder_now(text), public.ep_admin_notification_log(text, int)
  to authenticated;

notify pgrst, 'reload schema';

commit;

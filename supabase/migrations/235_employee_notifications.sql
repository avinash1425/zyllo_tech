-- 235: Employee Portal — Notifications.
--
-- ep_notifications: one row per recipient (an employee). Kinds:
--   project    : added to a project, new task assigned to you
--   leave      : leave requests / decisions (migration 236)
--   attendance : punch in / punch out reminders (migration 236)
--   report     : daily work report submitted / reviewed / sent back, reminders
--   message    : messages sent by an admin or by another employee
-- priority 'urgent' is shown as a banner in the portal until it is read.
--
-- Automatic notifications come from triggers (below) and from the scheduled
-- reminders in 236. Messages are sent with ep_send_message():
--   admin    -> everyone, or chosen employees
--   manager  -> their team (people who report to them), or chosen employees
--   employee -> chosen employees
-- Employees read and mark their own notifications through RPCs only.
-- Rollback: supabase/rollbacks/235_rollback_employee_notifications.sql

begin;

create table if not exists public.ep_notifications (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.ep_employees (id) on delete cascade,
  kind               text not null check (kind in ('project', 'leave', 'attendance', 'report', 'message')),
  priority           text not null default 'normal' check (priority in ('normal', 'urgent')),
  title              text not null check (length(btrim(title)) between 1 and 150),
  body               text check (body is null or length(body) <= 2000),
  link               text check (link is null or link ~ '^/employee(/|$)'),
  sender_employee_id uuid references public.ep_employees (id) on delete set null,
  sender_user_id     uuid,                -- auth user of the sender (admin or employee), for "Sent" lists
  sender_label       text,                -- "Admin" / sender's name; null for system notifications
  message_id         uuid,                -- same id for every recipient of one message
  dedupe_key         text,                -- stops the same reminder being sent twice
  created_at         timestamptz not null default now(),
  read_at            timestamptz,
  unique (employee_id, dedupe_key)
);
create index if not exists ep_notifications_inbox on public.ep_notifications (employee_id, created_at desc);
create index if not exists ep_notifications_unread on public.ep_notifications (employee_id) where read_at is null;
create index if not exists ep_notifications_message on public.ep_notifications (message_id) where message_id is not null;

comment on table public.ep_notifications is 'Employee Portal: in-app notifications (one row per recipient). Written by triggers / ep_send_message / reminders.';

alter table public.ep_notifications enable row level security;
revoke all on public.ep_notifications from anon, authenticated;
grant select on public.ep_notifications to authenticated;
drop policy if exists ep_notifications_read on public.ep_notifications;
create policy ep_notifications_read on public.ep_notifications for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid())));

-- ---------------------------------------------------------------- internal: create one notification
create or replace function public.ep_notify(
  p_employee uuid, p_kind text, p_title text, p_body text, p_link text,
  p_priority text default 'normal', p_dedupe text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_employee is null then
    return;
  end if;
  insert into public.ep_notifications (employee_id, kind, priority, title, body, link, dedupe_key)
  select p_employee, p_kind, coalesce(p_priority, 'normal'), left(p_title, 150), left(p_body, 2000), p_link, p_dedupe
  where exists (select 1 from public.ep_employees where id = p_employee and is_active)
  on conflict (employee_id, dedupe_key) do nothing;
end $$;
revoke all on function public.ep_notify(uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- inbox
-- p_filter: 'all' | 'unread' | a kind. Newest first, at most 200.
create or replace function public.ep_my_notifications(p_filter text default 'all')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_notifications where employee_id = v_emp and read_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
               'link', n.link, 'sender_label', n.sender_label, 'created_at', n.created_at, 'read_at', n.read_at)
             order by n.created_at desc)
      from (select * from public.ep_notifications
             where employee_id = v_emp
               and (coalesce(p_filter, 'all') = 'all'
                    or (p_filter = 'unread' and read_at is null)
                    or kind = p_filter)
             order by created_at desc limit 200) n), '[]'::jsonb));
end $$;

-- Small and cheap: for the bell (polled) and the urgent banner.
create or replace function public.ep_notification_summary()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    return null;
  end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_notifications where employee_id = v_emp and read_at is null),
    'urgent', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'link', n.link,
                                          'sender_label', n.sender_label, 'created_at', n.created_at)
             order by n.created_at desc)
      from (select * from public.ep_notifications
             where employee_id = v_emp and read_at is null and priority = 'urgent'
             order by created_at desc limit 5) n), '[]'::jsonb));
end $$;

-- p_ids null = mark everything read.
create or replace function public.ep_mark_notifications_read(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_n   integer;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  update public.ep_notifications
     set read_at = now()
   where employee_id = v_emp and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------- messages
-- Who the caller may message, and how.
create or replace function public.ep_message_options()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_admin boolean := coalesce(public.is_admin(), false);
  v_emp   uuid    := public.ep_current_employee_id();
begin
  if not v_admin and v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_all',  v_admin,
    'can_team', v_emp is not null and exists (select 1 from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation, 'department', e.department,
                                          'is_my_team', e.reporting_manager_id is not distinct from v_emp and v_emp is not null)
             order by e.full_name)
      from public.ep_employees e where e.is_active and e.id is distinct from v_emp), '[]'::jsonb));
end $$;

-- p_audience: 'people' (p_to required) | 'team' (managers) | 'all' (admins).
create or replace function public.ep_send_message(
  p_audience text, p_to uuid[], p_title text, p_body text, p_priority text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin  boolean := coalesce(public.is_admin(), false);
  v_emp    uuid    := public.ep_current_employee_id();
  v_label  text;
  v_msg    uuid    := gen_random_uuid();
  v_title  text    := btrim(coalesce(p_title, ''));
  v_body   text    := nullif(btrim(coalesce(p_body, '')), '');
  v_n      integer;
begin
  if not v_admin and v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if length(v_title) not between 1 and 150 then
    raise exception 'Subject must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('normal', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if p_audience = 'all' and not v_admin then
    raise exception 'Only an admin can message everyone.' using errcode = '42501';
  end if;
  if p_audience = 'team' and (v_emp is null
       or not exists (select 1 from public.ep_employees where reporting_manager_id = v_emp and is_active)) then
    raise exception 'You do not have a team to message.' using errcode = '42501';
  end if;
  if p_audience = 'people' and (p_to is null or cardinality(p_to) = 0) then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_audience = 'people' and cardinality(p_to) > 100 then
    raise exception 'Choose at most 100 people.' using errcode = '22023';
  end if;
  if p_audience not in ('people', 'team', 'all') then
    raise exception 'Invalid audience.' using errcode = '22023';
  end if;

  -- The sender's own employee name when they are an employee, else "Admin".
  select coalesce((select full_name from public.ep_employees where id = v_emp), 'Admin') into v_label;
  if v_admin and v_emp is null then
    v_label := 'Admin';
  end if;

  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_employee_id, sender_user_id, sender_label, message_id)
  select e.id, 'message', p_priority, v_title, v_body, v_emp, auth.uid(), v_label, v_msg
    from public.ep_employees e
   where e.is_active
     and e.id is distinct from v_emp
     and case p_audience
           when 'all'    then true
           when 'team'   then e.reporting_manager_id = v_emp
           else e.id = any (p_to)
         end;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'None of the chosen people can receive messages.' using errcode = '22023';
  end if;
  return jsonb_build_object('message_id', v_msg, 'recipients', v_n);
end $$;

-- Messages the caller sent (grouped), newest first, last 90 days.
create or replace function public.ep_sent_messages()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or (not coalesce(public.is_admin(), false) and public.ep_current_employee_id() is null) then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(m.j order by m.created_at desc)
    from (
      select min(n.created_at) as created_at,
             jsonb_build_object(
               'message_id', n.message_id, 'title', min(n.title), 'body', min(n.body), 'priority', min(n.priority),
               'created_at', min(n.created_at), 'recipients', count(*), 'read', count(n.read_at),
               'to', (array_agg(e.full_name order by e.full_name))[1:5]) as j
      from public.ep_notifications n join public.ep_employees e on e.id = n.employee_id
      where n.sender_user_id = auth.uid() and n.message_id is not null
        and n.created_at > now() - interval '90 days'
      group by n.message_id
      order by min(n.created_at) desc
      limit 100) m), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- automatic: projects
create or replace function public.ep_trg_project_member_added()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.pt_projects;
begin
  select * into v_p from public.pt_projects where id = new.project_id;
  perform public.ep_notify(new.employee_id, 'project',
    'You were added to project ' || coalesce(v_p.name, ''),
    coalesce(v_p.project_code || ' · ', '') || coalesce('Your role: ' || new.project_role, 'Open the project to see the team and tasks.'),
    '/employee/projects/' || new.project_id);
  return new;
end $$;
drop trigger if exists ep_project_member_added on public.ep_project_members;
create trigger ep_project_member_added after insert on public.ep_project_members
  for each row execute function public.ep_trg_project_member_added();

create or replace function public.ep_trg_task_assigned()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  if new.assignee_id is null or new.assignee_id is not distinct from new.created_by and tg_op = 'INSERT' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;
  select name into v_name from public.pt_projects where id = new.project_id;
  perform public.ep_notify(new.assignee_id, 'project',
    'New task assigned: ' || new.title,
    coalesce(v_name, '') || coalesce(' · Due ' || to_char(new.due_date, 'DD Mon YYYY'), ''),
    '/employee/projects/' || new.project_id);
  return new;
end $$;
drop trigger if exists ep_task_assigned on public.ep_project_tasks;
create trigger ep_task_assigned after insert or update of assignee_id on public.ep_project_tasks
  for each row execute function public.ep_trg_task_assigned();

-- ---------------------------------------------------------------- automatic: daily work reports
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
drop trigger if exists ep_report_status on public.ep_work_reports;
create trigger ep_report_status after update of status on public.ep_work_reports
  for each row execute function public.ep_trg_report_status();

revoke all on function public.ep_trg_project_member_added(), public.ep_trg_task_assigned(), public.ep_trg_report_status()
  from public, anon, authenticated;

revoke all on function public.ep_my_notifications(text), public.ep_notification_summary(),
  public.ep_mark_notifications_read(uuid[]), public.ep_message_options(),
  public.ep_send_message(text, uuid[], text, text, text), public.ep_sent_messages() from public, anon;
grant execute on function public.ep_my_notifications(text), public.ep_notification_summary(),
  public.ep_mark_notifications_read(uuid[]), public.ep_message_options(),
  public.ep_send_message(text, uuid[], text, text, text), public.ep_sent_messages() to authenticated;

notify pgrst, 'reload schema';

commit;

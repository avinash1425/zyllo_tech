-- Rollback of 244_employee_deadlines_delay_reasons.sql.
-- Restores ep_set_task_status(uuid, text) and ep_project_detail (232), ep_admin_pm_project (241),
-- ep_run_due_reminders / ep_admin_reminder_settings / ep_admin_send_reminder_now (243);
-- removes the 'deadlines' reminder, the delay reason columns / table and the new functions.
-- Written delay reasons are lost (take a backup first).
begin;

drop function if exists public.ep_set_project_delay_reason(uuid, text);
drop function if exists public.ep_set_task_delay_reason(uuid, text);
drop function if exists public.ep_set_task_status(uuid, text, text);
create or replace function public.ep_set_task_status(p_task uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_project uuid;
begin
  select project_id into v_project from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_project is null
     or not exists (select 1 from public.ep_project_members where project_id = v_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  update public.ep_project_tasks
     set status = p_status,
         updated_at = now(),
         completed_at = case when p_status = 'done' then coalesce(completed_at, now()) else null end
   where id = p_task;
end $$;
revoke all on function public.ep_set_task_status(uuid, text) from public, anon;
grant execute on function public.ep_set_task_status(uuid, text) to authenticated;

create or replace function public.ep_project_detail(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'project', jsonb_build_object(
        'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
        'project_type', p.project_type, 'description', p.description, 'status', p.status,
        'progress', p.progress, 'priority', p.priority, 'health', p.health,
        'project_manager', p.project_manager, 'next_action', p.next_action, 'live_url', p.live_url,
        'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date),
      'me', v_emp,
      'team', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'employee_id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                 'designation', e.designation, 'department', e.department,
                 'project_role', m.project_role, 'is_lead', m.is_lead)
               order by m.is_lead desc, e.full_name)
        from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
        where m.project_id = p.id), '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status,
                 'priority', t.priority, 'due_date', t.due_date, 'completed_at', t.completed_at,
                 'assignee_id', t.assignee_id, 'assignee_name', a.full_name, 'created_at', t.created_at)
               order by (t.status = 'done'), t.due_date nulls last, t.created_at)
        from public.ep_project_tasks t left join public.ep_employees a on a.id = t.assignee_id
        where t.project_id = p.id), '[]'::jsonb),
      'updates', coalesce((
        select jsonb_agg(u.j order by u.created_at desc) from (
          select pu.created_at, jsonb_build_object(
                   'id', pu.id, 'body', pu.body, 'created_at', pu.created_at,
                   'author_name', au.full_name, 'author_code', au.employee_code) as j
          from public.ep_project_updates pu left join public.ep_employees au on au.id = pu.author_id
          where pu.project_id = p.id
          order by pu.created_at desc limit 50) u), '[]'::jsonb)
    )
    from public.pt_projects p left join public.pt_companies c on c.id = p.company_id
    where p.id = p_project
  );
end $$;

create or replace function public.ep_admin_pm_project(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v jsonb;
begin
  perform public.ep_require_admin();
  select jsonb_build_object(
           'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
           'description', p.description, 'project_type', p.project_type,
           'status', p.status, 'priority', p.priority, 'health', p.health, 'progress', p.progress,
           'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
           'project_manager', p.project_manager)
    into v
  from public.pt_projects p
  left join public.pt_companies c on c.id = p.company_id
  where p.id = p_project;
  if v is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  return v || jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'project_role', m.project_role, 'is_lead', m.is_lead, 'added_at', m.added_at,
               'tasks_total',       (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id),
               'tasks_done',        (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'done'),
               'tasks_in_progress', (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'in_progress'),
               'tasks_overdue',     (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id
                                       and t.status <> 'done' and t.due_date < v_today),
               'hours_logged', coalesce((
                 select sum(i.hours) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed')), 0),
               'last_report_date', (
                 select max(r.report_date) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed'))
             ) order by m.is_lead desc, e.full_name)
      from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
      where m.project_id = p_project), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status,
               'priority', t.priority, 'due_date', t.due_date, 'completed_at', t.completed_at,
               'created_at', t.created_at,
               'overdue', t.status <> 'done' and t.due_date < v_today,
               'assignee', case when a.id is null then null else jsonb_build_object('id', a.id, 'full_name', a.full_name) end,
               'created_by', coalesce(cb.full_name, 'Admin'))
             order by (t.status = 'done'), t.due_date nulls last, t.created_at desc)
      from public.ep_project_tasks t
      left join public.ep_employees a on a.id = t.assignee_id
      left join public.ep_employees cb on cb.id = t.created_by
      where t.project_id = p_project), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'body', u.body, 'created_at', u.created_at,
                                          'author', coalesce(au.full_name, 'Admin')) order by u.created_at desc)
      from (select * from public.ep_project_updates where project_id = p_project order by created_at desc limit 20) u
      left join public.ep_employees au on au.id = u.author_id), '[]'::jsonb)
  );
end $$;

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

drop function if exists public.ep_send_deadline_reminders();
delete from public.ep_reminder_settings where kind = 'deadlines';
alter table public.ep_reminder_settings drop constraint if exists ep_reminder_settings_kind_check;
alter table public.ep_reminder_settings
  add constraint ep_reminder_settings_kind_check check (kind in ('punch_in', 'report', 'punch_out'));
drop function if exists public.ep_project_delay_json(uuid);
drop table if exists public.ep_project_delay_reasons;
alter table public.ep_project_tasks
  drop column if exists delay_reason, drop column if exists delay_reason_by, drop column if exists delay_reason_at;
drop function if exists public.ep_project_is_running(text);

notify pgrst, 'reload schema';
commit;

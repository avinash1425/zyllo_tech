-- 244: Employee Portal — deadline reminders + reasons for missed deadlines.
--
-- DEADLINE REMINDERS (new scheduled reminder kind 'deadlines', default 10:00 Mon–Sat, editable by
-- the admin in Notifications Management; run by ep_run_due_reminders every 5 minutes):
--   Task (not done, project not completed/cancelled) -> the assignee:
--       due in 2 days / due tomorrow / due today
--       overdue and no reason written -> URGENT "write why it is late", every day until written
--   Project deadline (pt_projects.end_date, status planning / in progress / on hold) -> the team:
--       in 3 days / tomorrow / today
--       passed and nobody wrote a reason yet -> URGENT to the project leads (all members if no lead),
--       every day until a reason is written
--   One notification per person per item per day (dedupe key 'deadlines:<date>:...').
--
-- REASONS
--   ep_project_tasks.delay_reason (+ _by, _at): required when a task is marked Done after its
--     deadline (ep_set_task_status now takes p_delay_reason); can also be written while overdue
--     (ep_set_task_delay_reason).
--   ep_project_delay_reasons: a team member explains a missed PROJECT deadline
--     (ep_set_project_delay_reason; one per member per deadline date, editable).
--   Shown to the team (ep_project_detail) and to the admin (ep_admin_pm_project).
-- Rollback: supabase/rollbacks/244_rollback_employee_deadlines_delay_reasons.sql

begin;

-- ================================================================ data
alter table public.ep_project_tasks
  add column if not exists delay_reason    text check (delay_reason is null or length(btrim(delay_reason)) between 1 and 1000),
  add column if not exists delay_reason_by uuid references public.ep_employees (id) on delete set null,
  add column if not exists delay_reason_at timestamptz;

create table if not exists public.ep_project_delay_reasons (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.pt_projects (id) on delete cascade,
  employee_id uuid not null references public.ep_employees (id) on delete cascade,
  deadline    date not null,
  reason      text not null check (length(btrim(reason)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, employee_id, deadline)
);
comment on table public.ep_project_delay_reasons is
  'Employee Portal: why a project missed its deadline (written by team members via ep_set_project_delay_reason).';
alter table public.ep_project_delay_reasons enable row level security;
revoke all on public.ep_project_delay_reasons from anon, authenticated;
grant select on public.ep_project_delay_reasons to authenticated;
drop policy if exists ep_project_delay_reasons_read on public.ep_project_delay_reasons;
create policy ep_project_delay_reasons_read on public.ep_project_delay_reasons for select to authenticated
  using ((select public.is_admin()) or public.ep_is_project_member(project_id));

-- Projects whose deadline still matters (not delivered / closed).
create or replace function public.ep_project_is_running(p_status text)
returns boolean
language sql immutable set search_path = ''
as $$ select p_status in ('planning', 'in_progress', 'on_hold'); $$;

-- ================================================================ employee: tasks
drop function if exists public.ep_set_task_status(uuid, text);
create function public.ep_set_task_status(p_task uuid, p_status text, p_delay_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_task   public.ep_project_tasks;
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_reason text := nullif(btrim(coalesce(p_delay_reason, '')), '');
begin
  select * into v_task from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_task.id is null
     or not exists (select 1 from public.ep_project_members where project_id = v_task.project_id and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if coalesce(length(v_reason), 0) > 1000 then
    raise exception 'The reason must be at most 1000 characters.' using errcode = '22023';
  end if;
  if p_status = 'done' and v_task.status <> 'done' and v_task.due_date < v_today
     and v_task.delay_reason is null and v_reason is null then
    raise exception 'This task is past its deadline (%). Write why it is late to mark it done.',
      to_char(v_task.due_date, 'DD Mon YYYY') using errcode = 'P0001', hint = 'delay_reason_required';
  end if;
  update public.ep_project_tasks
     set status = p_status,
         updated_at = now(),
         completed_at = case when p_status = 'done' then coalesce(completed_at, now()) else null end,
         delay_reason    = coalesce(v_reason, delay_reason),
         delay_reason_by = case when v_reason is not null then v_emp else delay_reason_by end,
         delay_reason_at = case when v_reason is not null then now() else delay_reason_at end
   where id = p_task;
end $$;

-- Write / change why a task is late (only once it is past its deadline).
create or replace function public.ep_set_task_delay_reason(p_task uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_task   public.ep_project_tasks;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_task from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_task.id is null
     or not exists (select 1 from public.ep_project_members where project_id = v_task.project_id and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write the reason (up to 1000 characters).' using errcode = '22023';
  end if;
  if v_task.due_date is null
     or v_task.due_date >= coalesce((timezone('Asia/Kolkata', v_task.completed_at))::date,
                                    (timezone('Asia/Kolkata', now()))::date) then
    raise exception 'This task is not late.' using errcode = 'P0001';
  end if;
  update public.ep_project_tasks
     set delay_reason = v_reason, delay_reason_by = v_emp, delay_reason_at = now(), updated_at = now()
   where id = p_task;
end $$;

-- ================================================================ employee: project
create or replace function public.ep_set_project_delay_reason(p_project uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_proj   public.pt_projects;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
begin
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write the reason (up to 1000 characters).' using errcode = '22023';
  end if;
  select * into v_proj from public.pt_projects where id = p_project;
  if v_proj.end_date is null
     or not coalesce((v_proj.end_date < v_today and public.ep_project_is_running(v_proj.status))
                     or v_proj.completed_date > v_proj.end_date, false) then
    raise exception 'This project has not missed its deadline.' using errcode = 'P0001';
  end if;
  insert into public.ep_project_delay_reasons (project_id, employee_id, deadline, reason)
  values (p_project, v_emp, v_proj.end_date, v_reason)
  on conflict (project_id, employee_id, deadline) do update set reason = excluded.reason, updated_at = now();
end $$;

-- Reasons for one project (newest first), as JSON.
create or replace function public.ep_project_delay_json(p_project uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'deadline', d.deadline, 'reason', d.reason, 'updated_at', d.updated_at,
           'employee_id', e.id, 'full_name', e.full_name) order by d.deadline desc, d.updated_at desc), '[]'::jsonb)
  from public.ep_project_delay_reasons d join public.ep_employees e on e.id = d.employee_id
  where d.project_id = p_project;
$$;
revoke all on function public.ep_project_delay_json(uuid) from public, anon, authenticated;

-- Employee project page: + delay reasons (project and tasks) and overdue flags.
create or replace function public.ep_project_detail(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
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
        'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
        'overdue', p.end_date < v_today and public.ep_project_is_running(p.status),
        'completed_late', p.completed_date > p.end_date),
      'delay_reasons', public.ep_project_delay_json(p.id),
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
                 'assignee_id', t.assignee_id, 'assignee_name', a.full_name, 'created_at', t.created_at,
                 'overdue', t.status <> 'done' and t.due_date < v_today,
                 'late', t.due_date < coalesce((timezone('Asia/Kolkata', t.completed_at))::date, v_today),
                 'delay_reason', t.delay_reason, 'delay_reason_at', t.delay_reason_at,
                 'delay_reason_by', (select full_name from public.ep_employees where id = t.delay_reason_by))
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

-- ================================================================ admin: project page
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
           'project_manager', p.project_manager,
           'overdue', p.end_date < v_today and public.ep_project_is_running(p.status),
           'completed_late', p.completed_date > p.end_date,
           'delay_reasons', public.ep_project_delay_json(p.id))
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
               'late', t.due_date < coalesce((timezone('Asia/Kolkata', t.completed_at))::date, v_today),
               'delay_reason', t.delay_reason, 'delay_reason_at', t.delay_reason_at,
               'delay_reason_by', (select full_name from public.ep_employees where id = t.delay_reason_by),
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

-- ================================================================ deadline reminders
alter table public.ep_reminder_settings drop constraint if exists ep_reminder_settings_kind_check;
alter table public.ep_reminder_settings
  add constraint ep_reminder_settings_kind_check check (kind in ('punch_in', 'report', 'punch_out', 'deadlines'));
insert into public.ep_reminder_settings (kind, send_at) values ('deadlines', '10:00') on conflict (kind) do nothing;

create or replace function public.ep_send_deadline_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_key   text;
  v_n     integer := 0;
  r       record;
begin
  if exists (select 1 from public.ep_holidays where holiday_date = v_today) then
    return 0;
  end if;
  v_key := 'deadlines:' || v_today || ':';

  -- Tasks -> assignee.
  for r in
    select t.id, t.title, t.due_date, t.assignee_id, t.project_id, p.name as project_name, t.delay_reason
      from public.ep_project_tasks t
      join public.pt_projects p on p.id = t.project_id
      join public.ep_employees e on e.id = t.assignee_id and e.is_active
     where t.status <> 'done' and t.due_date is not null and t.due_date <= v_today + 2
       and p.status not in ('completed', 'cancelled')
  loop
    if r.due_date < v_today then
      if r.delay_reason is null then
        perform public.ep_notify(r.assignee_id, 'project',
          'Task overdue — write why it is late',
          '"' || r.title || '" (' || r.project_name || ') was due on ' || to_char(r.due_date, 'DD Mon YYYY')
            || '. Open the task and write the reason for the delay.',
          '/employee/projects/' || r.project_id || '?tab=tasks', 'urgent', v_key || 'task-late:' || r.id);
        v_n := v_n + 1;
      end if;
    else
      perform public.ep_notify(r.assignee_id, 'project',
        case r.due_date - v_today when 0 then 'Task due today' when 1 then 'Task due tomorrow' else 'Task due in 2 days' end,
        '"' || r.title || '" (' || r.project_name || ') · deadline ' || to_char(r.due_date, 'DD Mon YYYY') || '.',
        '/employee/projects/' || r.project_id || '?tab=tasks', 'normal', v_key || 'task:' || r.id);
      v_n := v_n + 1;
    end if;
  end loop;

  -- Projects -> team (overdue: leads, or everyone when there is no lead; until someone writes a reason).
  for r in
    select p.id, p.name, p.end_date, m.employee_id,
           exists (select 1 from public.ep_project_members l where l.project_id = p.id and l.is_lead) as has_lead,
           m.is_lead
      from public.pt_projects p
      join public.ep_project_members m on m.project_id = p.id
      join public.ep_employees e on e.id = m.employee_id and e.is_active
     where public.ep_project_is_running(p.status) and p.end_date is not null and p.end_date <= v_today + 3
  loop
    if r.end_date < v_today then
      if (r.is_lead or not r.has_lead)
         and not exists (select 1 from public.ep_project_delay_reasons d where d.project_id = r.id and d.deadline = r.end_date) then
        perform public.ep_notify(r.employee_id, 'project',
          'Project deadline passed — write the reason',
          r.name || ' was due on ' || to_char(r.end_date, 'DD Mon YYYY') || '. Open the project and write why it is delayed.',
          '/employee/projects/' || r.id, 'urgent', v_key || 'project-late:' || r.id);
        v_n := v_n + 1;
      end if;
    elsif r.end_date - v_today in (0, 1, 3) then
      perform public.ep_notify(r.employee_id, 'project',
        case r.end_date - v_today when 0 then 'Project deadline is today' when 1 then 'Project deadline is tomorrow'
             else 'Project deadline in 3 days' end,
        r.name || ' · deadline ' || to_char(r.end_date, 'DD Mon YYYY') || '.',
        '/employee/projects/' || r.id, 'normal', v_key || 'project:' || r.id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_send_deadline_reminders() from public, anon, authenticated;

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
    v_n := v_n + case when s.kind = 'deadlines' then public.ep_send_deadline_reminders()
                      else public.ep_send_reminders(s.kind) end;
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
                                   where dedupe_key like s.kind || ':' || (timezone('Asia/Kolkata', now()))::date || '%'))
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
  if p_kind not in ('punch_in', 'report', 'punch_out', 'deadlines') then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  v_key := p_kind || ':' || (timezone('Asia/Kolkata', now()))::date || '%';
  select count(*) into v_before from public.ep_notifications where dedupe_key like v_key;
  if p_kind = 'deadlines' then
    perform public.ep_send_deadline_reminders();
  else
    perform public.ep_send_reminders(p_kind);
  end if;
  select count(*) into v_after from public.ep_notifications where dedupe_key like v_key;
  return v_after - v_before;
end $$;

-- ================================================================ grants
revoke all on function public.ep_set_task_status(uuid, text, text), public.ep_set_task_delay_reason(uuid, text),
  public.ep_set_project_delay_reason(uuid, text) from public, anon;
grant execute on function public.ep_set_task_status(uuid, text, text), public.ep_set_task_delay_reason(uuid, text),
  public.ep_set_project_delay_reason(uuid, text) to authenticated;
grant execute on function public.ep_project_is_running(text) to authenticated;

notify pgrst, 'reload schema';

commit;

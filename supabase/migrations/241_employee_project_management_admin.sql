-- 241: Employee Portal — admin Project Management.
--
-- Projects are the Project Tracker's projects (public.pt_projects); teams and
-- tasks are ep_project_members / ep_project_tasks (migration 232). Admins only
-- (public.is_admin()):
--   ep_admin_pm_projects()                           -> all projects: client, status, deadline, team, task counts
--   ep_admin_pm_project(project)                     -> one project: details, team with per-employee progress
--                                                       (tasks done / open / overdue, hours from daily work
--                                                       reports), tasks, recent updates
--   ep_admin_pm_save_member(project, employee, role, is_lead) -> add to team, or change role / lead
--   ep_admin_pm_remove_member(project, employee)     -> remove; their open tasks on it become unassigned
--   ep_admin_pm_save_task(project, task|null, jsonb) -> create / edit a task (assignee must be on the team)
--   ep_admin_pm_delete_task(task)
--   ep_admin_pm_set_deadline(project, date|null)     -> pt_projects.end_date
-- Notifications for "added to project" / "task assigned" come from the
-- existing triggers (migration 235).
-- Rollback: supabase/rollbacks/241_rollback_employee_project_management_admin.sql

begin;

-- ---------------------------------------------------------------- list
create or replace function public.ep_admin_pm_projects()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(x.j order by x.sort_status, x.end_date nulls last, x.name)
    from (
      select p.name, p.end_date,
             case p.status when 'in_progress' then 0 when 'planning' then 1 when 'live' then 2 when 'on_hold' then 3
                           when 'completed' then 4 else 5 end as sort_status,
             jsonb_build_object(
               'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
               'status', p.status, 'priority', p.priority, 'health', p.health,
               'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
               'team', coalesce((
                 select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'is_lead', m.is_lead)
                                  order by m.is_lead desc, e.full_name)
                 from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
                 where m.project_id = p.id), '[]'::jsonb),
               'tasks_total',   (select count(*) from public.ep_project_tasks t where t.project_id = p.id),
               'tasks_done',    (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.status = 'done'),
               'tasks_overdue', (select count(*) from public.ep_project_tasks t where t.project_id = p.id
                                   and t.status <> 'done' and t.due_date < v_today)
             ) as j
      from public.pt_projects p
      left join public.pt_companies c on c.id = p.company_id
    ) x
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- one project
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

-- ---------------------------------------------------------------- team
create or replace function public.ep_admin_pm_save_member(
  p_project uuid, p_employee uuid, p_role text default null, p_is_lead boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if not exists (select 1 from public.pt_projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_employee and is_active) then
    raise exception 'Choose an active employee.' using errcode = '22023';
  end if;
  insert into public.ep_project_members (project_id, employee_id, project_role, is_lead)
  values (p_project, p_employee, nullif(btrim(coalesce(p_role, '')), ''), coalesce(p_is_lead, false))
  on conflict (project_id, employee_id) do update
    set project_role = excluded.project_role, is_lead = excluded.is_lead;
  return public.ep_admin_pm_project(p_project);
end $$;

create or replace function public.ep_admin_pm_remove_member(p_project uuid, p_employee uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  delete from public.ep_project_members where project_id = p_project and employee_id = p_employee;
  if not found then
    raise exception 'This employee is not on the project.' using errcode = 'P0002';
  end if;
  update public.ep_project_tasks set assignee_id = null, updated_at = now()
   where project_id = p_project and assignee_id = p_employee and status <> 'done';
  return public.ep_admin_pm_project(p_project);
end $$;

-- ---------------------------------------------------------------- tasks
-- p: { title, description, assignee_id, priority, status, due_date }
-- A new assignee must be an active member of the project.
create or replace function public.ep_admin_pm_save_task(p_project uuid, p_task uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f text;
  v_assignee uuid;
  v_status text;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid task data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('title', 'description', 'assignee_id', 'priority', 'status', 'due_date') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;
  if not exists (select 1 from public.pt_projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if nullif(btrim(coalesce(p ->> 'title', '')), '') is null then
    raise exception 'Task title is required.' using errcode = '22023';
  end if;
  v_assignee := nullif(btrim(coalesce(p ->> 'assignee_id', '')), '')::uuid;
  -- Checked for new tasks and when the assignee changes (an existing assignee may have left the team).
  if v_assignee is not null
     and (p_task is null or v_assignee is distinct from (select assignee_id from public.ep_project_tasks where id = p_task))
     and not exists (
       select 1 from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
       where m.project_id = p_project and m.employee_id = v_assignee and e.is_active) then
    raise exception 'Assign the task to an active member of this project.' using errcode = '22023';
  end if;
  v_status := coalesce(nullif(btrim(coalesce(p ->> 'status', '')), ''), 'todo');

  if p_task is null then
    insert into public.ep_project_tasks (project_id, title, description, assignee_id, status, priority, due_date, completed_at)
    values (p_project, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), v_assignee, v_status,
            coalesce(nullif(btrim(coalesce(p ->> 'priority', '')), ''), 'medium'),
            nullif(btrim(coalesce(p ->> 'due_date', '')), '')::date,
            case when v_status = 'done' then now() end);
  else
    update public.ep_project_tasks set
      title        = btrim(p ->> 'title'),
      description  = nullif(btrim(coalesce(p ->> 'description', '')), ''),
      assignee_id  = v_assignee,
      status       = v_status,
      priority     = coalesce(nullif(btrim(coalesce(p ->> 'priority', '')), ''), 'medium'),
      due_date     = nullif(btrim(coalesce(p ->> 'due_date', '')), '')::date,
      completed_at = case when v_status = 'done' then coalesce(completed_at, now()) end,
      updated_at   = now()
    where id = p_task and project_id = p_project;
    if not found then
      raise exception 'Task not found.' using errcode = 'P0002';
    end if;
  end if;
  return public.ep_admin_pm_project(p_project);
end $$;

create or replace function public.ep_admin_pm_delete_task(p_task uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_project uuid;
begin
  perform public.ep_require_admin();
  delete from public.ep_project_tasks where id = p_task returning project_id into v_project;
  if v_project is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_pm_project(v_project);
end $$;

-- ---------------------------------------------------------------- deadline
create or replace function public.ep_admin_pm_set_deadline(p_project uuid, p_date date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_start date;
begin
  perform public.ep_require_admin();
  select start_date into v_start from public.pt_projects where id = p_project;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_date is not null and v_start is not null and p_date < v_start then
    raise exception 'The deadline cannot be before the start date (%).', to_char(v_start, 'DD Mon YYYY') using errcode = '22023';
  end if;
  update public.pt_projects set end_date = p_date, updated_at = now() where id = p_project;
  return public.ep_admin_pm_project(p_project);
end $$;

revoke all on function
  public.ep_admin_pm_projects(), public.ep_admin_pm_project(uuid),
  public.ep_admin_pm_save_member(uuid, uuid, text, boolean), public.ep_admin_pm_remove_member(uuid, uuid),
  public.ep_admin_pm_save_task(uuid, uuid, jsonb), public.ep_admin_pm_delete_task(uuid),
  public.ep_admin_pm_set_deadline(uuid, date)
  from public, anon;
grant execute on function
  public.ep_admin_pm_projects(), public.ep_admin_pm_project(uuid),
  public.ep_admin_pm_save_member(uuid, uuid, text, boolean), public.ep_admin_pm_remove_member(uuid, uuid),
  public.ep_admin_pm_save_task(uuid, uuid, jsonb), public.ep_admin_pm_delete_task(uuid),
  public.ep_admin_pm_set_deadline(uuid, date)
  to authenticated;

notify pgrst, 'reload schema';

commit;

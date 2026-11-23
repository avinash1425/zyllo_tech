-- 232: Employee Portal — My Projects.
--
-- Projects are the Project Tracker's projects (public.pt_projects). Employees
-- never read pt_projects directly (it is admin-only and next to logins,
-- documents and invoices). They see ONLY projects they are a team member of,
-- and ONLY safe fields, through security-definer RPCs.
--
--   ep_project_members : who is on which project (managed by admins).
--   ep_project_tasks   : tasks with assignee, deadline, priority, status.
--   ep_project_updates : progress updates posted by team members.
--
-- Team members can add tasks, change task status and post updates (RPCs below).
-- Admins (public.is_admin()) can read and manage everything directly.
-- Rollback: supabase/rollbacks/232_rollback_employee_projects.sql

begin;

create table if not exists public.ep_project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.pt_projects (id) on delete cascade,
  employee_id uuid not null references public.ep_employees (id) on delete cascade,
  project_role text check (project_role is null or length(btrim(project_role)) between 1 and 60),
  is_lead     boolean not null default false,
  added_at    timestamptz not null default now(),
  unique (project_id, employee_id)
);
create index if not exists ep_project_members_employee on public.ep_project_members (employee_id);

create table if not exists public.ep_project_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.pt_projects (id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text check (description is null or length(description) <= 2000),
  assignee_id  uuid references public.ep_employees (id) on delete set null,
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date     date check (due_date is null or due_date between date '2020-01-01' and date '2100-12-31'),
  created_by   uuid references public.ep_employees (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists ep_project_tasks_project on public.ep_project_tasks (project_id, status);
create index if not exists ep_project_tasks_assignee on public.ep_project_tasks (assignee_id) where status <> 'done';

create table if not exists public.ep_project_updates (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pt_projects (id) on delete cascade,
  author_id  uuid references public.ep_employees (id) on delete set null,
  body       text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists ep_project_updates_project on public.ep_project_updates (project_id, created_at desc);

comment on table public.ep_project_members is 'Employee Portal: project team (admins manage). Links ep_employees to pt_projects.';
comment on table public.ep_project_tasks is 'Employee Portal: project tasks. Team members write via ep_add_task / ep_set_task_status.';
comment on table public.ep_project_updates is 'Employee Portal: project updates. Team members write via ep_post_update.';

-- ---------------------------------------------------------------- helpers
create or replace function public.ep_is_project_member(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.ep_project_members m
    join public.ep_employees e on e.id = m.employee_id
    where m.project_id = p_project and e.user_id = auth.uid() and e.is_active
  );
$$;
revoke all on function public.ep_is_project_member(uuid) from public, anon;
grant execute on function public.ep_is_project_member(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.ep_project_members enable row level security;
alter table public.ep_project_tasks   enable row level security;
alter table public.ep_project_updates enable row level security;
revoke all on public.ep_project_members, public.ep_project_tasks, public.ep_project_updates from anon, authenticated;
grant select, insert, update, delete on public.ep_project_members, public.ep_project_tasks, public.ep_project_updates to authenticated;

do $$
declare t text;
begin
  foreach t in array array['ep_project_members', 'ep_project_tasks', 'ep_project_updates'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_admin()) or public.ep_is_project_member(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t || '_admin_write', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- read: list
create or replace function public.ep_my_projects()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.sort_status, x.end_date nulls last, x.name)
    from (
      select p.name, p.end_date,
             case p.status when 'in_progress' then 0 when 'planning' then 1 when 'on_hold' then 2 when 'live' then 3 else 4 end as sort_status,
             jsonb_build_object(
               'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
               'project_type', p.project_type, 'status', p.status, 'progress', p.progress,
               'priority', p.priority, 'health', p.health,
               'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
               'my_role', m.project_role, 'i_am_lead', m.is_lead,
               'team_size', (select count(*) from public.ep_project_members x where x.project_id = p.id),
               'tasks_total', (select count(*) from public.ep_project_tasks t where t.project_id = p.id),
               'tasks_done', (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.status = 'done'),
               'my_open_tasks', (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.assignee_id = v_emp and t.status <> 'done'),
               'my_overdue_tasks', (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.assignee_id = v_emp and t.status <> 'done'
                                     and t.due_date < (timezone('Asia/Kolkata', now()))::date)
             ) as j
      from public.ep_project_members m
      join public.pt_projects p on p.id = m.project_id
      left join public.pt_companies c on c.id = p.company_id
      where m.employee_id = v_emp
    ) x
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- read: one project
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

-- ---------------------------------------------------------------- write: tasks / updates
create or replace function public.ep_add_task(
  p_project uuid, p_title text, p_description text, p_assignee uuid, p_due_date date, p_priority text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if p_assignee is not null and not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = p_assignee) then
    raise exception 'The assignee must be on the project team.' using errcode = '22023';
  end if;
  insert into public.ep_project_tasks (project_id, title, description, assignee_id, due_date, priority, created_by)
  values (p_project, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_assignee, p_due_date,
          coalesce(nullif(p_priority, ''), 'medium'), v_emp)
  returning id into v_id;
  return v_id;
end $$;

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

create or replace function public.ep_post_update(p_project uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  insert into public.ep_project_updates (project_id, author_id, body)
  values (p_project, v_emp, btrim(p_body))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.ep_my_projects(), public.ep_project_detail(uuid),
  public.ep_add_task(uuid, text, text, uuid, date, text), public.ep_set_task_status(uuid, text),
  public.ep_post_update(uuid, text) from public, anon;
grant execute on function public.ep_my_projects(), public.ep_project_detail(uuid),
  public.ep_add_task(uuid, text, text, uuid, date, text), public.ep_set_task_status(uuid, text),
  public.ep_post_update(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;

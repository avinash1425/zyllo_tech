-- =====================================================================
-- 131_hr_task_progress_updates.sql — My Tasks & Projects: progress + updates
-- =====================================================================
-- Extends the task master of 102 (hr_tasks). Nothing here replaces it.
--
-- Adds:
--   1. hr_tasks.progress_pct (0-100), start_date, last_update_at.
--      Rule: status 'done' <=> progress 100. A task moved out of 'done'
--      without a new progress value is set to 99 % (reopened, not complete).
--   2. hr_task_updates: append-only history of every status / progress change
--      (from the employee RPC, the legacy status RPC, or HR edits) and of
--      progress notes. Readable by whoever can read the task; written only by
--      triggers / SECURITY DEFINER RPCs.
--   3. public.hr_post_my_task_update(task, status, progress, note): the
--      assignee posts an update. A note is required when marking a task
--      blocked; the project manager (or, if none, the employee's reporting
--      manager) is notified. Updates are refused on completed / archived
--      projects.
--   4. In-app notification to the assignee when a task is assigned to them.
--   5. public.hr_my_task_activity(limit): recent updates on my tasks.
--
-- hr_update_my_task_status (102) is unchanged and keeps working; its status
-- changes are now also recorded in hr_task_updates.
-- No permission keys are added.
-- Depends on: 100, 102, 128 (hr_projects.manager_employee_id).
-- =====================================================================

do $$
begin
  if to_regclass('public.hr_work_blockers') is null then
    raise exception '131_hr_task_progress_updates requires migration 128 (daily work reports)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Task columns
-- ---------------------------------------------------------------------
alter table public.hr_tasks
  add column if not exists progress_pct   smallint not null default 0,
  add column if not exists start_date     date,
  add column if not exists last_update_at timestamptz;
alter table public.hr_tasks drop constraint if exists hr_tasks_progress_valid;
alter table public.hr_tasks add constraint hr_tasks_progress_valid check (progress_pct between 0 and 100);
alter table public.hr_tasks drop constraint if exists hr_tasks_dates_valid;
alter table public.hr_tasks add constraint hr_tasks_dates_valid
  check (start_date is null or due_date is null or due_date >= start_date);
create index if not exists hr_tasks_due on public.hr_tasks(due_date) where status <> 'done';

update public.hr_tasks set progress_pct = 100 where status = 'done' and progress_pct <> 100;

-- Replaces the 102 version: completed_at + the done <=> 100 % rule.
create or replace function hr_private.tasks_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  if new.status = 'done' then
    new.progress_pct := 100;
  elsif new.progress_pct = 100 then
    new.progress_pct := 99;   -- reopened (or 100 % without marking done)
  end if;
  if tg_op = 'UPDATE' and (new.status, new.progress_pct) is distinct from (old.status, old.progress_pct) then
    new.last_update_at := now();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Update history
-- ---------------------------------------------------------------------
create table if not exists public.hr_task_updates (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references public.hr_tasks(id) on delete cascade,
  author_employee_id uuid references public.hr_employees(id) on delete set null,
  author_user_id     uuid default auth.uid(),
  old_status         text,
  new_status         text,
  old_progress       smallint,
  new_progress       smallint,
  note               text check (note is null or length(btrim(note)) between 1 and 2000),
  created_at         timestamptz not null default clock_timestamp(),   -- ordered within one transaction
  check (note is not null or old_status is distinct from new_status or old_progress is distinct from new_progress)
);
create index if not exists hr_task_updates_task on public.hr_task_updates(task_id, created_at desc);
select hr_private.secure_table('public.hr_task_updates');
drop policy if exists hr_task_updates_read on public.hr_task_updates;
-- Visible exactly when the task is visible (hr_tasks RLS applies to the subquery).
create policy hr_task_updates_read on public.hr_task_updates for select to authenticated
  using (exists (select 1 from public.hr_tasks t where t.id = task_id));
revoke insert, update, delete, truncate on public.hr_task_updates from authenticated;

-- Every status / progress change is recorded. The employee RPC passes its
-- note through the transaction-local setting hr.task_note.
create or replace function hr_private.tasks_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_note text := nullif(btrim(coalesce(current_setting('hr.task_note', true), '')), '');
begin
  if tg_op = 'UPDATE' and (new.status, new.progress_pct) is distinct from (old.status, old.progress_pct) then
    insert into public.hr_task_updates (task_id, author_employee_id, old_status, new_status, old_progress, new_progress, note)
    values (new.id, hr_private.current_employee_id(), old.status, new.status, old.progress_pct, new.progress_pct, v_note);
  end if;
  -- 4. Assignment notification (not when you assign yourself).
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.notify_employee(new.assignee_id, 'tasks.assigned', 'New task assigned to you',
      left(new.title, 200) || coalesce(' · due ' || to_char(new.due_date, 'DD Mon YYYY'), ''),
      '/employee/tasks', 'hr_tasks', new.id::text);
  end if;
  return null;
end $$;
drop trigger if exists hr_tasks_after_write on public.hr_tasks;
create trigger hr_tasks_after_write after insert or update on public.hr_tasks
  for each row execute function hr_private.tasks_after_write();

-- ---------------------------------------------------------------------
-- 3. Employee posts an update on their own task
-- ---------------------------------------------------------------------
create or replace function public.hr_post_my_task_update(p_task uuid, p_status text default null,
                                                         p_progress integer default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.hr_tasks; p public.hr_projects;
        v_me uuid := hr_private.current_employee_id();
        v_status text; v_progress integer; v_note text := nullif(btrim(coalesce(p_note, '')), '');
        v_notify uuid;
begin
  select * into t from public.hr_tasks where id = p_task for update;
  if v_me is null or t.id is null or t.assignee_id is distinct from v_me then
    perform hr_private.fail('Task not found.', 'not_found');
  end if;
  select * into p from public.hr_projects where id = t.project_id;
  if p.status in ('completed', 'archived') then
    perform hr_private.fail('This project is ' || p.status || '; task updates are closed.', 'project_closed');
  end if;
  if p_status is not null and p_status not in ('todo','in_progress','blocked','done') then
    perform hr_private.fail('Unknown task status.', 'invalid');
  end if;
  if p_progress is not null and (p_progress < 0 or p_progress > 100) then
    perform hr_private.fail('Progress must be between 0 and 100.', 'invalid_progress');
  end if;
  if v_note is not null and length(v_note) > 2000 then
    perform hr_private.fail('The note can be at most 2000 characters.', 'invalid');
  end if;

  v_status := coalesce(p_status, t.status);
  v_progress := coalesce(p_progress, t.progress_pct);
  if p_status is null and p_progress is not null then
    -- Progress alone moves the status along.
    if v_progress = 100 then v_status := 'done';
    elsif v_progress > 0 and t.status = 'todo' then v_status := 'in_progress';
    end if;
  end if;
  if v_status = 'done' then
    v_progress := 100;
  elsif v_progress = 100 then
    if p_progress is null then v_progress := 99;   -- reopening a done task
    else perform hr_private.fail('100% means the task is done. Mark it Done, or set progress below 100%.', 'invalid_progress');
    end if;
  end if;
  if v_status = 'blocked' and t.status <> 'blocked' and v_note is null then
    perform hr_private.fail('Add a note saying what is blocking this task.', 'note_required');
  end if;
  if v_status = t.status and v_progress = t.progress_pct and v_note is null then
    perform hr_private.fail('Nothing to update: change the status or progress, or add a note.', 'invalid');
  end if;

  if v_status <> t.status or v_progress <> t.progress_pct then
    perform set_config('hr.task_note', coalesce(v_note, ''), true);
    update public.hr_tasks set status = v_status, progress_pct = v_progress where id = p_task returning * into t;
    perform set_config('hr.task_note', '', true);
  else
    insert into public.hr_task_updates (task_id, author_employee_id, old_status, new_status, old_progress, new_progress, note)
    values (t.id, v_me, t.status, t.status, t.progress_pct, t.progress_pct, v_note);
    update public.hr_tasks set last_update_at = now() where id = p_task returning * into t;
  end if;

  if v_status = 'blocked' and v_note is not null then
    v_notify := coalesce(nullif(p.manager_employee_id, v_me), hr_private.my_manager_id());
    if v_notify is not null and v_notify <> v_me then
      perform hr_private.notify_employee(v_notify, 'tasks.blocked', 'Task blocked: ' || left(t.title, 150),
        left(v_note, 300), '/hr/daily-reports?tab=projects', 'hr_tasks', t.id::text);
    end if;
  end if;
  return to_jsonb(t);
end $$;

-- ---------------------------------------------------------------------
-- 5. Recent activity on my tasks
-- ---------------------------------------------------------------------
create or replace function public.hr_my_task_activity(p_limit integer default 50)
returns table (id uuid, task_id uuid, task_title text, project_code text, author_employee_id uuid, author_name text,
               old_status text, new_status text, old_progress smallint, new_progress smallint, note text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, u.task_id, t.title, p.code, u.author_employee_id,
         case when u.author_employee_id = hr_private.current_employee_id() then 'You'
              else coalesce(nullif(btrim(e.display_name), ''), nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''), 'HR') end,
         u.old_status, u.new_status, u.old_progress, u.new_progress, u.note, u.created_at
    from public.hr_task_updates u
    join public.hr_tasks t on t.id = u.task_id
    join public.hr_projects p on p.id = t.project_id
    left join public.hr_employees e on e.id = u.author_employee_id
   where hr_private.current_employee_id() is not null
     and t.assignee_id = hr_private.current_employee_id()
   order by u.created_at desc, u.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;
revoke execute on function public.hr_post_my_task_update(uuid, text, integer, text), public.hr_my_task_activity(integer) from anon, public;
grant execute on function public.hr_post_my_task_update(uuid, text, integer, text), public.hr_my_task_activity(integer) to authenticated;

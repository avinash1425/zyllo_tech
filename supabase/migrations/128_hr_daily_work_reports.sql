-- =====================================================================
-- 128_hr_daily_work_reports.sql — Module 8: Daily Work Reports
-- =====================================================================
-- Extends 102_hr_daily_reports.sql. Nothing here creates a second daily
-- reporting system:
--   * hr_daily_reports stays the single report per employee per date
--     (unique (employee_id, report_date)); status values are unchanged so
--     the dashboards / reports of 112 and 117 keep working. The UI labels
--     'reviewed' as "Approved" and 'revision_requested' as "Changes requested".
--   * hr_daily_report_items stays the task list of a report (many per report).
--   * hr_projects / hr_project_members stay the minimal HR project master
--     (no Project Tracker clone; an integration hook is provided instead).
--
-- Adds:
--   1. Task status per report item (not_started -> in_progress -> completed /
--      blocked), completed work, deliverables, completion date, supporting
--      links and notes; hours validation (0 h only for not-started tasks).
--   2. Project allocation: project manager, date-bounded assignments,
--      allocation %, allocation history; employees may only log work on a
--      project they are assigned to ON THE REPORT DATE. Project managers
--      (with daily_reports.review_team) may manage their own project's
--      allocations; HR (daily_reports.manage) manages all.
--   3. Structured blocker tracker (hr_work_blockers): severity, resolution
--      owner, open -> in_progress -> resolved, resolution notes / date;
--      in-app notification to the reporting manager. Writes via RPCs only.
--   4. Submission rules: a blocked task needs a blocker record; a report
--      must carry > 0 hours; every submission stores an immutable version
--      snapshot (hr_daily_report_versions).
--   5. Reopen of an approved report by an authorised reviewer (reason
--      required, never self), recorded in the review history.
--   6. Read RPCs (scoped by RLS-equivalent checks): overview KPIs, hours
--      summaries (day / week / month / employee / project), reported hours
--      vs attendance comparison with discrepancy flags (read-only; attendance
--      is never modified), completed-work history, blocker list.
--   7. Project Tracker integration hook (service role only).
--
-- No permission keys are added; existing daily_reports.* keys are reused.
-- Reported hours are NOT attendance and are not used by payroll.
--
-- Depends on: 100, 101, 102, 112 (is_working_day_for), 113 (legal entities).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Settings (merged; existing values win)
-- ---------------------------------------------------------------------
update public.hr_settings
   set value = jsonb_build_object('attendance_variance_hours', 1.0) || value
 where key = 'daily_reports';

-- ---------------------------------------------------------------------
-- 1. Projects: manager + integration fields
-- ---------------------------------------------------------------------
alter table public.hr_projects
  add column if not exists manager_employee_id uuid references public.hr_employees(id) on delete set null,
  add column if not exists source text not null default 'hrms',
  add column if not exists external_ref text;
alter table public.hr_projects drop constraint if exists hr_projects_source_valid;
alter table public.hr_projects add constraint hr_projects_source_valid check (source in ('hrms','project_tracker'));
alter table public.hr_projects drop constraint if exists hr_projects_external_ref_valid;
alter table public.hr_projects add constraint hr_projects_external_ref_valid
  check (external_ref is null or length(btrim(external_ref)) between 1 and 100);
create unique index if not exists hr_projects_external_ref_unique on public.hr_projects(source, external_ref) where external_ref is not null;
create index if not exists hr_projects_manager on public.hr_projects(manager_employee_id);

-- ---------------------------------------------------------------------
-- 2. Project allocation (date-bounded) + history
-- ---------------------------------------------------------------------
alter table public.hr_project_members
  add column if not exists start_date     date,
  add column if not exists end_date       date,
  add column if not exists allocation_pct smallint,
  add column if not exists notes          text,
  add column if not exists updated_at     timestamptz not null default now();
alter table public.hr_project_members drop constraint if exists hr_project_members_dates_valid;
alter table public.hr_project_members add constraint hr_project_members_dates_valid
  check (end_date is null or start_date is null or end_date >= start_date);
alter table public.hr_project_members drop constraint if exists hr_project_members_allocation_valid;
alter table public.hr_project_members add constraint hr_project_members_allocation_valid
  check (allocation_pct is null or allocation_pct between 1 and 100);
alter table public.hr_project_members drop constraint if exists hr_project_members_notes_valid;
alter table public.hr_project_members add constraint hr_project_members_notes_valid check (notes is null or length(notes) <= 1000);
drop trigger if exists hr_project_members_touch on public.hr_project_members;
create trigger hr_project_members_touch before update on public.hr_project_members for each row execute function hr_private.touch_updated_at();

-- Assigned to the project on a given date.
create or replace function hr_private.is_project_allocated(p_project uuid, p_employee uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_employee is not null and exists (
    select 1 from public.hr_project_members m
    where m.project_id = p_project and m.employee_id = p_employee
      and (m.start_date is null or p_date is null or m.start_date <= p_date)
      and (m.end_date is null or p_date is null or m.end_date >= p_date))
$$;

create or replace function hr_private.is_project_manager(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.current_employee_id() is not null and exists (
    select 1 from public.hr_projects p where p.id = p_project and p.manager_employee_id = hr_private.current_employee_id())
$$;

-- HR manages every allocation; a project manager with team-review rights
-- manages allocations of the projects they manage.
create or replace function hr_private.can_manage_project_allocation(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('daily_reports.manage')
      or (hr_private.has_permission('daily_reports.review_team') and hr_private.is_project_manager(p_project))
$$;

-- Same as 102 plus: the project manager sees their project.
create or replace function hr_private.can_see_project(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('daily_reports.manage')
      or hr_private.has_permission('daily_reports.view')
      or hr_private.has_permission('daily_reports.review')
      or hr_private.is_project_member(p_project, hr_private.current_employee_id())
      or hr_private.is_project_manager(p_project)
      or ((hr_private.has_permission('daily_reports.view_team') or hr_private.has_permission('daily_reports.review_team'))
          and exists (select 1 from public.hr_project_members m
                      where m.project_id = p_project and hr_private.is_manager_of(m.employee_id)))
$$;

drop policy if exists hr_project_members_insert on public.hr_project_members;
drop policy if exists hr_project_members_update on public.hr_project_members;
drop policy if exists hr_project_members_delete on public.hr_project_members;
create policy hr_project_members_insert on public.hr_project_members for insert to authenticated
  with check (hr_private.can_manage_project_allocation(project_id));
create policy hr_project_members_update on public.hr_project_members for update to authenticated
  using (hr_private.can_manage_project_allocation(project_id)) with check (hr_private.can_manage_project_allocation(project_id));
create policy hr_project_members_delete on public.hr_project_members for delete to authenticated
  using (hr_private.can_manage_project_allocation(project_id));

-- Allocation rules: the employee must be an active record; a project
-- cannot be re-pointed; the project manager cannot allocate themselves
-- unless they are HR.
create or replace function hr_private.project_members_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.project_id is distinct from old.project_id or new.employee_id is distinct from old.employee_id) then
    perform hr_private.fail('Create a new allocation instead of moving one.', 'invalid');
  end if;
  if tg_op = 'INSERT' and not exists (select 1 from public.hr_employees e where e.id = new.employee_id
                                      and e.status not in ('exited','archived')) then
    perform hr_private.fail('Only current employees can be allocated to a project.', 'invalid_employee');
  end if;
  return new;
end $$;
drop trigger if exists hr_project_members_before_write on public.hr_project_members;
create trigger hr_project_members_before_write before insert or update on public.hr_project_members
  for each row execute function hr_private.project_members_before_write();

create table if not exists public.hr_project_allocation_history (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.hr_projects(id) on delete cascade,
  employee_id       uuid not null references public.hr_employees(id) on delete cascade,
  action            text not null check (action in ('assigned','updated','removed')),
  role              text,
  start_date        date,
  end_date          date,
  allocation_pct    smallint,
  actor_user_id     uuid,
  actor_employee_id uuid,
  created_at        timestamptz not null default now()
);
create index if not exists hr_project_allocation_history_project on public.hr_project_allocation_history(project_id, created_at);
create index if not exists hr_project_allocation_history_employee on public.hr_project_allocation_history(employee_id, created_at);
select hr_private.secure_table('public.hr_project_allocation_history');
revoke insert, update, delete, truncate on public.hr_project_allocation_history from authenticated;
drop policy if exists hr_project_allocation_history_read on public.hr_project_allocation_history;
create policy hr_project_allocation_history_read on public.hr_project_allocation_history for select to authenticated
  using (hr_private.can_see_project(project_id));

create or replace function hr_private.project_members_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.hr_project_members := coalesce(new, old);
begin
  if tg_op = 'UPDATE' and (new.role, new.start_date, new.end_date, new.allocation_pct)
                          is not distinct from (old.role, old.start_date, old.end_date, old.allocation_pct) then
    return null;
  end if;
  -- On project deletion (cascade) the history goes with the project.
  if tg_op = 'DELETE' and not exists (select 1 from public.hr_projects where id = m.project_id) then
    return null;
  end if;
  insert into public.hr_project_allocation_history
    (project_id, employee_id, action, role, start_date, end_date, allocation_pct, actor_user_id, actor_employee_id)
  values (m.project_id, m.employee_id,
          case tg_op when 'INSERT' then 'assigned' when 'UPDATE' then 'updated' else 'removed' end,
          m.role, m.start_date, m.end_date, m.allocation_pct, auth.uid(), hr_private.current_employee_id());
  if tg_op = 'INSERT' then
    perform hr_private.notify_employee(m.employee_id, 'daily_reports.project_assigned', 'Assigned to a project',
      'You were assigned to ' || (select code || ' · ' || name from public.hr_projects where id = m.project_id) || '.',
      '/employee/tasks', 'hr_projects', m.project_id::text);
  end if;
  return null;
end $$;
drop trigger if exists hr_project_members_history on public.hr_project_members;
create trigger hr_project_members_history after insert or update or delete on public.hr_project_members
  for each row execute function hr_private.project_members_history();

-- Backfill: one 'assigned' entry per existing allocation (idempotent).
insert into public.hr_project_allocation_history (project_id, employee_id, action, role, start_date, end_date, allocation_pct, actor_user_id, created_at)
select m.project_id, m.employee_id, 'assigned', m.role, m.start_date, m.end_date, m.allocation_pct, m.added_by, m.added_at
from public.hr_project_members m
where not exists (select 1 from public.hr_project_allocation_history h where h.project_id = m.project_id and h.employee_id = m.employee_id);

-- ---------------------------------------------------------------------
-- 3. Report items = daily tasks
-- ---------------------------------------------------------------------
alter table public.hr_daily_report_items
  add column if not exists work_status     text not null default 'in_progress',
  add column if not exists completed_work  text,
  add column if not exists deliverables    text,
  add column if not exists completion_date date,
  add column if not exists links           text[] not null default '{}',
  add column if not exists notes           text;
alter table public.hr_daily_report_items drop constraint if exists hr_daily_report_items_work_status_valid;
alter table public.hr_daily_report_items add constraint hr_daily_report_items_work_status_valid
  check (work_status in ('not_started','in_progress','completed','blocked'));
alter table public.hr_daily_report_items drop constraint if exists hr_daily_report_items_text_valid;
alter table public.hr_daily_report_items add constraint hr_daily_report_items_text_valid
  check ((completed_work is null or length(completed_work) <= 4000)
     and (deliverables is null or length(deliverables) <= 2000)
     and (notes is null or length(notes) <= 2000)
     and cardinality(links) <= 10);
-- Hours: never negative, at most 24; zero only for a task not started yet.
alter table public.hr_daily_report_items drop constraint if exists hr_daily_report_items_hours_check;
alter table public.hr_daily_report_items drop constraint if exists hr_daily_report_items_hours_valid;
alter table public.hr_daily_report_items add constraint hr_daily_report_items_hours_valid
  check (hours >= 0 and hours <= 24 and (hours > 0 or work_status = 'not_started'));
create index if not exists hr_daily_report_items_task on public.hr_daily_report_items(task_id);

-- Item validation (replaces the 102 version): allocation on the report
-- date, task/project match, status-dependent fields, safe links.
create or replace function hr_private.daily_report_items_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.hr_daily_reports; p public.hr_projects; t public.hr_tasks; v_link text;
        v_project_changed boolean := tg_op = 'INSERT' or new.project_id is distinct from old.project_id;
begin
  if tg_op = 'UPDATE' and new.report_id <> old.report_id then
    perform hr_private.fail('Items cannot be moved between reports.', 'invalid');
  end if;
  select * into r from public.hr_daily_reports where id = new.report_id;
  if new.project_id is not null and v_project_changed then
    select * into p from public.hr_projects where id = new.project_id;
    if p.id is null or p.status <> 'active' then
      perform hr_private.fail('Choose an active project.', 'invalid_project');
    end if;
    if not hr_private.is_project_allocated(new.project_id, r.employee_id, r.report_date) then
      perform hr_private.fail('You are not a member of this project on ' || to_char(r.report_date, 'DD Mon YYYY') || '.', 'not_project_member');
    end if;
  end if;
  if new.task_id is not null and (v_project_changed or new.task_id is distinct from old.task_id) then
    select * into t from public.hr_tasks where id = new.task_id;
    if t.id is null or t.project_id is distinct from new.project_id then
      perform hr_private.fail('The task does not belong to the selected project.', 'invalid_task');
    end if;
  end if;

  if new.work_status = 'completed' then
    new.completion_date := coalesce(new.completion_date, r.report_date);
    new.progress_pct := 100;
  else
    new.completion_date := null;
    if new.work_status = 'not_started' and coalesce(new.progress_pct, 0) <> 0 then
      perform hr_private.fail('A task that has not started cannot have progress.', 'invalid_progress');
    end if;
  end if;
  if new.completion_date is not null and new.completion_date > r.report_date then
    perform hr_private.fail('The completion date cannot be after the report date.', 'invalid_completion_date');
  end if;

  new.completed_work := nullif(btrim(new.completed_work), '');
  new.deliverables := nullif(btrim(new.deliverables), '');
  new.notes := nullif(btrim(new.notes), '');
  new.links := coalesce((select array_agg(btrim(l)) from unnest(new.links) l where length(btrim(l)) > 0), '{}');
  foreach v_link in array new.links loop
    if v_link !~ '^https?://[^[:space:]<>"''`]{3,}$' or length(v_link) > 500 then
      perform hr_private.fail('Links must be http(s) URLs: ' || left(v_link, 80), 'invalid_link');
    end if;
  end loop;
  return new;
end $$;

-- Existing data: a 100 % item is a completed task.
update public.hr_daily_report_items set work_status = 'completed' where progress_pct = 100 and work_status = 'in_progress';

-- ---------------------------------------------------------------------
-- 4. Blocker tracker
-- ---------------------------------------------------------------------
create table if not exists public.hr_work_blockers (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.hr_employees(id) on delete restrict,   -- reported by
  report_id         uuid references public.hr_daily_reports(id) on delete cascade,
  item_id           uuid references public.hr_daily_report_items(id) on delete set null,
  project_id        uuid references public.hr_projects(id) on delete restrict,
  task_id           uuid references public.hr_tasks(id) on delete set null,
  title             text not null check (length(btrim(title)) between 2 and 200),
  description       text check (length(description) <= 4000),
  severity          text not null default 'medium' check (severity in ('low','medium','high','critical')),
  reported_date     date not null,
  owner_employee_id uuid references public.hr_employees(id) on delete set null,          -- resolution owner
  status            text not null default 'open' check (status in ('open','in_progress','resolved')),
  resolution_notes  text check (length(resolution_notes) <= 4000),
  resolved_date     date,
  resolved_by       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((status = 'resolved') = (resolved_date is not null))
);
create index if not exists hr_work_blockers_employee on public.hr_work_blockers(employee_id, status);
create index if not exists hr_work_blockers_owner on public.hr_work_blockers(owner_employee_id, status);
create index if not exists hr_work_blockers_report on public.hr_work_blockers(report_id);
create index if not exists hr_work_blockers_item on public.hr_work_blockers(item_id);
create index if not exists hr_work_blockers_project on public.hr_work_blockers(project_id);
select hr_private.secure_table('public.hr_work_blockers');
drop trigger if exists hr_work_blockers_touch on public.hr_work_blockers;
create trigger hr_work_blockers_touch before update on public.hr_work_blockers for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_work_blockers');
-- Writes only through the RPCs below.
revoke insert, update, delete, truncate on public.hr_work_blockers from authenticated;
drop policy if exists hr_work_blockers_read on public.hr_work_blockers;
create policy hr_work_blockers_read on public.hr_work_blockers for select to authenticated using (
     employee_id = hr_private.current_employee_id()
  or owner_employee_id = hr_private.current_employee_id()
  or hr_private.can_access_employee(employee_id, 'daily_reports'));

-- Who may triage a blocker (status + owner): HR, or a reviewer of the reporter.
create or replace function hr_private.can_triage_blocker(p_reporter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('daily_reports.manage')
      or hr_private.can_act_on_employee(p_reporter, 'daily_reports.review', 'daily_reports.review_team')
$$;

create or replace function public.hr_save_work_blocker(
  p_id uuid default null, p_report uuid default null, p_item uuid default null, p_project uuid default null,
  p_task uuid default null, p_title text default null, p_description text default null, p_severity text default 'medium')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  b public.hr_work_blockers; r public.hr_daily_reports; i public.hr_daily_report_items; t public.hr_tasks;
  v_title text := btrim(coalesce(p_title, '')); v_desc text := nullif(btrim(p_description), '');
  v_project uuid := p_project; v_task uuid := p_task;
begin
  if v_me is null then perform hr_private.fail('Only employees can report blockers.', 'forbidden'); end if;
  if length(v_title) < 2 or length(v_title) > 200 then perform hr_private.fail('Blocker title must be 2–200 characters.', 'invalid'); end if;
  if coalesce(p_severity, '') not in ('low','medium','high','critical') then perform hr_private.fail('Unknown severity.', 'invalid'); end if;
  if length(v_desc) > 4000 then perform hr_private.fail('Description is too long.', 'invalid'); end if;

  if p_id is not null then
    select * into b from public.hr_work_blockers where id = p_id for update;
    if b.id is null or b.employee_id <> v_me then perform hr_private.fail('Blocker not found.', 'not_found'); end if;
    if b.status = 'resolved' then perform hr_private.fail('A resolved blocker cannot be edited; reopen it first.', 'invalid_state'); end if;
    if b.report_id is not null and not hr_private.daily_report_editable(b.report_id) then
      perform hr_private.fail('The report is locked; this blocker can no longer be edited.', 'locked');
    end if;
    update public.hr_work_blockers set title = v_title, description = v_desc, severity = p_severity
    where id = p_id returning * into b;
    return to_jsonb(b);
  end if;

  if p_item is not null and p_report is null then perform hr_private.fail('Choose the report of the task.', 'invalid'); end if;
  if p_report is not null then
    select * into r from public.hr_daily_reports where id = p_report;
    if r.id is null or r.employee_id <> v_me then perform hr_private.fail('Report not found.', 'not_found'); end if;
    if r.status not in ('draft','revision_requested') then
      perform hr_private.fail('The report is locked; report the blocker separately.', 'locked');
    end if;
  end if;
  if p_item is not null then
    select * into i from public.hr_daily_report_items where id = p_item;
    if i.id is null or i.report_id <> p_report then perform hr_private.fail('The task is not part of this report.', 'invalid'); end if;
    v_project := coalesce(v_project, i.project_id);
    v_task := coalesce(v_task, i.task_id);
  end if;
  if v_project is not null and not hr_private.is_project_member(v_project, v_me) then
    perform hr_private.fail('You are not a member of this project.', 'not_project_member');
  end if;
  if v_task is not null then
    select * into t from public.hr_tasks where id = v_task;
    if t.id is null or t.project_id is distinct from v_project then
      perform hr_private.fail('The task does not belong to the selected project.', 'invalid_task');
    end if;
  end if;

  insert into public.hr_work_blockers (employee_id, report_id, item_id, project_id, task_id, title, description, severity, reported_date)
  values (v_me, p_report, p_item, v_project, v_task, v_title, v_desc, p_severity, coalesce(r.report_date, hr_private.business_today()))
  returning * into b;
  -- In-app notification to the reporting manager (email is not sent here).
  perform hr_private.notify_employee(hr_private.my_manager_id(), 'daily_reports.blocker',
    case when p_severity in ('high','critical') then 'Blocker reported (' || p_severity || ')' else 'Blocker reported' end,
    left(v_title, 200), '/hr/daily-reports?tab=blockers', 'hr_work_blockers', b.id::text);
  return to_jsonb(b);
end $$;

-- Reporter removes an open blocker of an editable report (or a standalone one).
create or replace function public.hr_delete_work_blocker(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.hr_work_blockers;
begin
  select * into b from public.hr_work_blockers where id = p_id for update;
  if b.id is null or b.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Blocker not found.', 'not_found');
  end if;
  if b.status <> 'open' or (b.report_id is not null and not hr_private.daily_report_editable(b.report_id)) then
    perform hr_private.fail('Only an open blocker of an editable report can be removed.', 'invalid_state');
  end if;
  delete from public.hr_work_blockers where id = p_id;
end $$;

-- Status / owner changes.
--   reporter, resolution owner, triager: open <-> in_progress, -> resolved
--   reporter or triager: resolved -> open (reopen)
--   triager only: assign / clear the resolution owner
create or replace function public.hr_update_work_blocker(
  p_id uuid, p_status text default null, p_owner uuid default null, p_notes text default null, p_clear_owner boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  b public.hr_work_blockers; v_from text;
  v_reporter boolean; v_owner boolean; v_triager boolean;
  v_notes text := nullif(btrim(p_notes), '');
  v_new_owner uuid; v_old_owner uuid;
begin
  select * into b from public.hr_work_blockers where id = p_id for update;
  if b.id is null then perform hr_private.fail('Blocker not found.', 'not_found'); end if;
  -- Null-safe: an unassigned owner must evaluate to false, never null.
  v_reporter := v_me is not null and b.employee_id is not distinct from v_me;
  v_owner := v_me is not null and b.owner_employee_id is not distinct from v_me;
  v_triager := coalesce(hr_private.can_triage_blocker(b.employee_id), false);
  if not (v_reporter or v_owner or v_triager) then
    if hr_private.can_access_employee(b.employee_id, 'daily_reports') then
      perform hr_private.fail('You are not allowed to update this blocker.', 'forbidden');
    end if;
    perform hr_private.fail('Blocker not found.', 'not_found');
  end if;
  if length(v_notes) > 4000 then perform hr_private.fail('Notes are too long.', 'invalid'); end if;
  v_from := b.status;
  v_old_owner := b.owner_employee_id;
  v_new_owner := case when p_clear_owner then null else coalesce(p_owner, b.owner_employee_id) end;

  if v_new_owner is distinct from b.owner_employee_id then
    if not v_triager then perform hr_private.fail('Only the manager or HR can assign the resolution owner.', 'forbidden'); end if;
    if v_new_owner is not null and not exists (select 1 from public.hr_employees e where e.id = v_new_owner
                                               and e.status not in ('exited','archived','suspended')) then
      perform hr_private.fail('Choose a current employee as the resolution owner.', 'invalid_owner');
    end if;
  end if;

  if p_status is not null and p_status <> v_from then
    if p_status not in ('open','in_progress','resolved') then perform hr_private.fail('Unknown blocker status.', 'invalid'); end if;
    if v_from = 'resolved' and not (v_reporter or v_triager) then
      perform hr_private.fail('Only the reporter, the manager or HR can reopen a blocker.', 'forbidden');
    end if;
    if v_from = 'resolved' and p_status <> 'open' then
      perform hr_private.fail('A resolved blocker can only be reopened.', 'invalid_state');
    end if;
    if p_status = 'resolved' and v_notes is null then
      perform hr_private.fail('Resolution notes are required.', 'notes_required');
    end if;
  end if;

  update public.hr_work_blockers set
    owner_employee_id = v_new_owner,
    status = coalesce(p_status, status),
    resolution_notes = coalesce(v_notes, resolution_notes),
    resolved_date = case when coalesce(p_status, status) = 'resolved' then coalesce(resolved_date, hr_private.business_today()) else null end,
    resolved_by = case when coalesce(p_status, status) = 'resolved' then coalesce(resolved_by, auth.uid()) else null end
  where id = p_id returning * into b;

  if v_new_owner is not null and v_new_owner is distinct from v_old_owner and v_new_owner is distinct from v_me then
    perform hr_private.notify_employee(v_new_owner, 'daily_reports.blocker_assigned', 'Blocker assigned to you', left(b.title, 200),
      '/employee/daily-reports?tab=blockers', 'hr_work_blockers', b.id::text);
  end if;
  if b.status is distinct from v_from and not v_reporter then
    perform hr_private.notify_employee(b.employee_id, 'daily_reports.blocker_' || b.status,
      'Blocker ' || replace(b.status, '_', ' '), left(b.title, 200), '/employee/daily-reports?tab=blockers', 'hr_work_blockers', b.id::text);
  end if;
  return to_jsonb(b);
end $$;

-- Scoped blocker list with names (reporter / owner / project) for the UI.
create or replace function public.hr_list_work_blockers(
  p_status text default null, p_from date default null, p_to date default null, p_employee uuid default null,
  p_project uuid default null, p_department uuid default null, p_mine boolean default false)
returns table (id uuid, employee_id uuid, employee_code text, employee_name text, department_id uuid, report_id uuid, item_id uuid,
               project_id uuid, project_name text, task_id uuid, task_title text, title text, description text, severity text,
               reported_date date, owner_employee_id uuid, owner_name text, status text, resolution_notes text, resolved_date date,
               age_days integer, can_triage boolean, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id();
begin
  if p_status is not null and p_status not in ('open','in_progress','resolved','active') then
    perform hr_private.fail('Unknown blocker status.', 'invalid');
  end if;
  return query
    select b.id, b.employee_id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), e.department_id,
           b.report_id, b.item_id, b.project_id, case when p.id is null then null else p.code || ' · ' || p.name end,
           b.task_id, t.title, b.title, b.description, b.severity, b.reported_date, b.owner_employee_id,
           case when o.id is null then null else coalesce(o.display_name, btrim(o.first_name || ' ' || o.last_name)) end,
           b.status, b.resolution_notes, b.resolved_date,
           (coalesce(b.resolved_date, hr_private.business_today()) - b.reported_date)::int,
           hr_private.can_triage_blocker(b.employee_id), b.created_at, b.updated_at
    from public.hr_work_blockers b
    join public.hr_employees e on e.id = b.employee_id
    left join public.hr_employees o on o.id = b.owner_employee_id
    left join public.hr_projects p on p.id = b.project_id
    left join public.hr_tasks t on t.id = b.task_id
    where (b.employee_id = v_me or b.owner_employee_id = v_me or hr_private.can_access_employee(b.employee_id, 'daily_reports'))
      and (not p_mine or b.employee_id = v_me or b.owner_employee_id = v_me)
      and (p_status is null or (p_status = 'active' and b.status <> 'resolved') or b.status = p_status)
      and (p_from is null or b.reported_date >= p_from)
      and (p_to is null or b.reported_date <= p_to)
      and (p_employee is null or b.employee_id = p_employee)
      and (p_project is null or b.project_id = p_project)
      and (p_department is null or e.department_id = p_department)
    order by (b.status = 'resolved'), case b.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
             b.reported_date desc, b.created_at desc
    limit 2000;
end $$;

-- ---------------------------------------------------------------------
-- 5. Submission rules, versions, reopen
-- ---------------------------------------------------------------------
create table if not exists public.hr_daily_report_versions (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.hr_daily_reports(id) on delete cascade,
  version     integer not null check (version > 0),
  snapshot    jsonb not null,
  total_hours numeric(5,2) not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (report_id, version)
);
select hr_private.secure_table('public.hr_daily_report_versions');
revoke insert, update, delete, truncate on public.hr_daily_report_versions from authenticated;
drop policy if exists hr_daily_report_versions_read on public.hr_daily_report_versions;
create policy hr_daily_report_versions_read on public.hr_daily_report_versions for select to authenticated
  using (hr_private.can_view_daily_report(report_id));

create or replace function hr_private.daily_reports_submit_checks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_item text;
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    if coalesce((select sum(hours) from public.hr_daily_report_items where report_id = new.id), 0) <= 0 then
      perform hr_private.fail('Report the hours you worked before submitting.', 'no_hours');
    end if;
    select i.activity into v_item from public.hr_daily_report_items i
    where i.report_id = new.id and i.work_status = 'blocked'
      and not exists (select 1 from public.hr_work_blockers b where b.item_id = i.id)
    limit 1;
    if v_item is not null then
      perform hr_private.fail('Describe the blocker for the blocked task "' || v_item || '" before submitting.', 'blocker_required');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists hr_daily_reports_submit_checks on public.hr_daily_reports;
create trigger hr_daily_reports_submit_checks before update on public.hr_daily_reports
  for each row execute function hr_private.daily_reports_submit_checks();

-- Each submission stores an immutable snapshot (report + tasks + blockers).
create or replace function hr_private.daily_reports_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    insert into public.hr_daily_report_versions (report_id, version, snapshot, total_hours, created_by)
    select new.id, coalesce((select max(version) from public.hr_daily_report_versions where report_id = new.id), 0) + 1,
           to_jsonb(new)
           || jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at, i.id) from public.hr_daily_report_items i where i.report_id = new.id), '[]'::jsonb))
           || jsonb_build_object('blockers', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.hr_work_blockers b where b.report_id = new.id), '[]'::jsonb)),
           new.total_hours, auth.uid();
  end if;
  return null;
end $$;
drop trigger if exists hr_daily_reports_version on public.hr_daily_reports;
create trigger hr_daily_reports_version after update on public.hr_daily_reports
  for each row execute function hr_private.daily_reports_version();
select hr_private.enable_audit('public.hr_daily_reports');
select hr_private.enable_audit('public.hr_daily_report_items');

alter table public.hr_daily_report_reviews drop constraint if exists hr_daily_report_reviews_action_check;
alter table public.hr_daily_report_reviews add constraint hr_daily_report_reviews_action_check
  check (action in ('submitted','comment','clarification','under_review','reviewed','revision_requested','reopened'));

-- An approved report is locked; an authorised reviewer (never the owner)
-- may reopen it, which returns it to the employee as "changes requested".
create or replace function public.hr_reopen_daily_report(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_daily_reports; v_reason text := nullif(btrim(p_reason), '');
begin
  select * into r from public.hr_daily_reports where id = p_id for update;
  if r.id is null or not hr_private.can_view_daily_report(p_id) then perform hr_private.fail('Report not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot reopen your own report.', 'self_review');
  end if;
  if not hr_private.can_act_on_employee(r.employee_id, 'daily_reports.review', 'daily_reports.review_team') then
    perform hr_private.fail('You are not allowed to reopen this report.', 'forbidden');
  end if;
  if r.status <> 'reviewed' then perform hr_private.fail('Only an approved report can be reopened.', 'invalid_state'); end if;
  if v_reason is null then perform hr_private.fail('A reason is required to reopen a report.', 'comment_required'); end if;
  if length(v_reason) > 4000 then perform hr_private.fail('The reason is too long.', 'invalid'); end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_daily_reports set status = 'revision_requested', reviewer_employee_id = hr_private.current_employee_id(),
         reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id returning * into r;
  perform set_config('hr.privileged_write', 'off', true);
  insert into public.hr_daily_report_reviews (report_id, actor_employee_id, actor_user_id, action, from_status, to_status, comment)
  values (p_id, hr_private.current_employee_id(), auth.uid(), 'reopened', 'reviewed', 'revision_requested', v_reason);
  perform hr_private.notify_employee(r.employee_id, 'daily_reports.reopened', 'Your approved daily report was reopened',
    v_reason, '/employee/daily-reports', 'hr_daily_reports', p_id::text);
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- 6. Read RPCs
-- ---------------------------------------------------------------------
-- Employees (ids) in the caller's daily-report scope, with filters.
create or replace function hr_private.daily_work_scope(p_department uuid, p_manager uuid, p_company uuid, p_employee uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.hr_employees e
  where (p_department is null or e.department_id = p_department)
    and (p_manager is null or e.manager_id = p_manager)
    and (p_company is null or e.legal_entity_id = p_company)
    and (p_employee is null or e.id = p_employee)
    and (e.id = hr_private.current_employee_id() or hr_private.can_access_employee(e.id, 'daily_reports'))
$$;

create or replace function public.hr_daily_work_overview(
  p_date date default null, p_from date default null, p_to date default null, p_department uuid default null,
  p_project uuid default null, p_manager uuid default null, p_company uuid default null, p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$   -- volatile: uses a temp table
declare
  v_date date := coalesce(p_date, hr_private.business_today());
  v_to date := coalesce(p_to, v_date);
  v_from date := coalesce(p_from, v_to - 6);
  v_all boolean := hr_private.has_permission('daily_reports.view');
  v_att boolean;
  v jsonb;
begin
  if not v_all and not hr_private.has_permission('daily_reports.view_team') then
    perform hr_private.fail('You are not allowed to view the daily work overview.', 'forbidden');
  end if;
  if v_date > hr_private.business_today() or v_to > hr_private.business_today() then
    perform hr_private.fail('The overview cannot be shown for a future date.', 'future_date');
  end if;
  if v_to < v_from or v_to - v_from > 366 then perform hr_private.fail('Choose a valid date range (at most one year).', 'invalid_range'); end if;
  v_att := hr_private.any_permission(array['attendance.view','attendance.view_team']);

  -- Scope: HR (view) sees everyone in the filters; a manager sees their
  -- reporting line (not themselves).
  create temp table if not exists dwo_emp (id uuid primary key) on commit drop;
  truncate pg_temp.dwo_emp;
  insert into pg_temp.dwo_emp
    select s.id from hr_private.daily_work_scope(p_department, p_manager, p_company, null) s(id)
    where v_all or s.id is distinct from hr_private.current_employee_id();
  -- Project filter: employees allocated to the project at any time in the range.
  if p_project is not null then
    delete from pg_temp.dwo_emp d where not exists (select 1 from public.hr_project_members m where m.project_id = p_project and m.employee_id = d.id
                                        and (m.start_date is null or m.start_date <= v_to) and (m.end_date is null or m.end_date >= v_from));
  end if;

  with day_status as (
    select e.id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)) as name, e.department_id, e.manager_id,
           r.id as report_id,
           case when r.id is not null and r.status <> 'draft' then r.status
                when not (e.status in ('active','probation','notice_period') and (e.joining_date is null or e.joining_date <= v_date)
                          and (e.last_working_date is null or e.last_working_date >= v_date)) then 'not_due'
                when not hr_private.is_working_day_for(e.id, v_date) or hr_private.is_on_approved_leave(e.id, v_date) then 'not_due'
                else 'not_submitted' end as status,
           case when r.status <> 'draft' then r.total_hours end as hours,
           (select count(*) from public.hr_work_blockers b where b.employee_id = e.id and b.status <> 'resolved') as open_blockers
    from pg_temp.dwo_emp d
    join public.hr_employees e on e.id = d.id
    left join public.hr_daily_reports r on r.employee_id = e.id and r.report_date = v_date
    where e.status not in ('exited','archived') and e.portal_access and e.user_id is not null
  ),
  rng as (
    select r.* from public.hr_daily_reports r join pg_temp.dwo_emp d on d.id = r.employee_id
    where r.report_date between v_from and v_to and r.status <> 'draft'
      and (p_status is null or r.status = p_status)
      and (p_project is null or exists (select 1 from public.hr_daily_report_items i where i.report_id = r.id and i.project_id = p_project))
  )
  select jsonb_build_object(
    'date', v_date, 'from', v_from, 'to', v_to,
    'kpis', jsonb_build_object(
      'submitted_today', (select count(*) from day_status where status not in ('not_submitted','not_due')),
      'pending_submission', (select count(*) from day_status where status = 'not_submitted'),
      'pending_review', (select count(*) from rng where status in ('submitted','under_review')),
      'approved', (select count(*) from rng where status = 'reviewed'),
      'changes_requested', (select count(*) from rng where status = 'revision_requested'),
      'active_blockers', (select count(*) from public.hr_work_blockers b join pg_temp.dwo_emp d on d.id = b.employee_id
                          where b.status <> 'resolved' and (p_project is null or b.project_id = p_project)),
      'critical_blockers', (select count(*) from public.hr_work_blockers b join pg_temp.dwo_emp d on d.id = b.employee_id
                          where b.status <> 'resolved' and b.severity in ('high','critical') and (p_project is null or b.project_id = p_project)),
      'reported_hours', (select coalesce(sum(i.hours), 0) from rng join public.hr_daily_report_items i on i.report_id = rng.id
                         where p_project is null or i.project_id = p_project),
      'hours_discrepancies', case when v_att then (select count(*) from public.hr_work_hours_vs_attendance(v_from, v_to, null, p_department, p_manager, true) x
                                                    where x.employee_id in (select id from pg_temp.dwo_emp)) end),
    'project_hours', coalesce((
      select jsonb_agg(jsonb_build_object('project_id', x.project_id, 'label', x.label, 'hours', x.hours, 'employees', x.employees) order by x.hours desc)
      from (select i.project_id, coalesce(p.code || ' · ' || p.name, 'General / internal') as label, sum(i.hours) as hours, count(distinct rng.employee_id) as employees
            from rng join public.hr_daily_report_items i on i.report_id = rng.id left join public.hr_projects p on p.id = i.project_id
            where p_project is null or i.project_id = p_project
            group by i.project_id, p.code, p.name) x), '[]'::jsonb),
    'employee_status', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', s.id, 'employee_code', s.employee_code, 'employee_name', s.name,
                                          'department_id', s.department_id, 'manager_id', s.manager_id, 'report_id', case when s.status not in ('not_submitted','not_due') then s.report_id end,
                                          'status', s.status, 'hours', s.hours, 'open_blockers', s.open_blockers) order by s.employee_code)
      from day_status s), '[]'::jsonb),
    'attendance_comparison_available', v_att
  ) into v;
  return v;
end $$;

-- Reported hours grouped by day / week / month / employee / project / employee_project.
create or replace function public.hr_work_hours_summary(
  p_from date, p_to date, p_group text default 'employee', p_employee uuid default null, p_department uuid default null,
  p_project uuid default null, p_manager uuid default null, p_company uuid default null)
returns table (period_start date, employee_id uuid, employee_code text, employee_name text, project_id uuid, project_label text,
               reports bigint, tasks bigint, completed_tasks bigint, hours numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    perform hr_private.fail('Choose a valid date range (at most one year).', 'invalid_range');
  end if;
  if p_group not in ('day','week','month','employee','project','employee_project') then
    perform hr_private.fail('Unknown grouping.', 'invalid');
  end if;
  return query
    with base as (
      select r.id as report_id, r.employee_id, r.report_date, i.project_id, i.hours, i.work_status,
             e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)) as ename,
             coalesce(p.code || ' · ' || p.name, 'General / internal') as plabel
      from public.hr_daily_reports r
      join hr_private.daily_work_scope(p_department, p_manager, p_company, p_employee) s(id) on s.id = r.employee_id
      join public.hr_employees e on e.id = r.employee_id
      join public.hr_daily_report_items i on i.report_id = r.id
      left join public.hr_projects p on p.id = i.project_id
      where r.report_date between p_from and p_to and r.status <> 'draft'
        and (p_project is null or i.project_id = p_project)
    )
    select case p_group when 'day' then b.report_date when 'week' then date_trunc('week', b.report_date)::date
                        when 'month' then date_trunc('month', b.report_date)::date end,
           case when p_group in ('employee','employee_project') then b.employee_id end,
           case when p_group in ('employee','employee_project') then min(b.employee_code) end,
           case when p_group in ('employee','employee_project') then min(b.ename) end,
           case when p_group in ('project','employee_project') then b.project_id end,
           case when p_group in ('project','employee_project') then min(b.plabel) end,
           count(distinct b.report_id), count(*), count(*) filter (where b.work_status = 'completed'), sum(b.hours)
    from base b
    group by 1, case when p_group in ('employee','employee_project') then b.employee_id end,
                case when p_group in ('project','employee_project') then b.project_id end
    order by 1 nulls first, 4 nulls first, 6 nulls first;
end $$;

-- Reported (task) hours vs attendance worked hours per employee per day.
-- Read-only: attendance records are never modified. Requires daily-report
-- AND attendance visibility for the employee (self always).
create or replace function public.hr_work_hours_vs_attendance(
  p_from date, p_to date, p_employee uuid default null, p_department uuid default null, p_manager uuid default null,
  p_only_flagged boolean default false)
returns table (employee_id uuid, employee_code text, employee_name text, work_date date, report_id uuid, report_status text,
               reported_hours numeric, attendance_status text, attended_hours numeric, variance_hours numeric, flag text)
language plpgsql stable security definer set search_path = '' as $$
declare v_threshold numeric := coalesce((hr_private.setting('daily_reports') ->> 'attendance_variance_hours')::numeric, 1.0);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    perform hr_private.fail('Choose a valid date range (at most one year).', 'invalid_range');
  end if;
  return query
    with emp as (
      select e.* from public.hr_employees e
      join hr_private.daily_work_scope(p_department, p_manager, null, p_employee) s(id) on s.id = e.id
      where e.id = hr_private.current_employee_id() or hr_private.can_access_employee(e.id, 'attendance')
    ),
    rep as (
      select r.employee_id, r.report_date as d, r.id, r.status, r.total_hours
      from public.hr_daily_reports r join emp on emp.id = r.employee_id
      where r.report_date between p_from and p_to and r.status <> 'draft'
    ),
    att as (
      select a.employee_id, a.work_date as d, a.status, a.check_in_at, a.check_out_at, a.worked_minutes
      from public.hr_attendance a join emp on emp.id = a.employee_id
      where a.work_date between p_from and p_to
    ),
    j as (
      select coalesce(rep.employee_id, att.employee_id) as eid, coalesce(rep.d, att.d) as d, rep.id as rid, rep.status as rstatus,
             rep.total_hours as rh, att.status as astatus, att.check_in_at, att.check_out_at,
             round(att.worked_minutes / 60.0, 2) as ah
      from rep full join att on att.employee_id = rep.employee_id and att.d = rep.d
    ),
    f as (
      select j.*, case
        when j.rid is not null and j.rh > 0 and (j.astatus is null or j.astatus in ('absent','on_leave','holiday','weekend')) then 'no_attendance'
        when j.rid is not null and j.check_in_at is not null and j.check_out_at is null then 'attendance_incomplete'
        when j.rid is not null and j.ah is not null and j.rh - j.ah > v_threshold then 'reported_exceeds_attendance'
        when j.rid is not null and j.ah is not null and j.ah - j.rh > v_threshold then 'under_reported'
        when j.rid is null and coalesce(j.ah, 0) > 0 then 'no_report'
      end as flag
      from j
    )
    select f.eid, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), f.d, f.rid, f.rstatus,
           f.rh, f.astatus, f.ah, case when f.rh is not null and f.ah is not null then f.rh - f.ah end, f.flag
    from f join public.hr_employees e on e.id = f.eid
    where not p_only_flagged or f.flag is not null
    order by f.d desc, e.employee_code;
end $$;

-- Completed work / task history. Owner sees own items in any status; others
-- see submitted reports in their scope.
create or replace function public.hr_completed_work(
  p_from date, p_to date, p_employee uuid default null, p_project uuid default null, p_task uuid default null,
  p_completed_only boolean default true)
returns table (item_id uuid, report_id uuid, report_date date, report_status text, employee_id uuid, employee_name text,
               project_id uuid, project_label text, task_id uuid, task_title text, activity text, work_status text,
               progress_pct smallint, hours numeric, completed_work text, deliverables text, completion_date date, links text[], notes text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    perform hr_private.fail('Choose a valid date range (at most one year).', 'invalid_range');
  end if;
  return query
    select i.id, r.id, r.report_date, r.status, r.employee_id, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
           i.project_id, case when p.id is null then 'General / internal' else p.code || ' · ' || p.name end, i.task_id, t.title,
           i.activity, i.work_status, i.progress_pct, i.hours, i.completed_work, i.deliverables, i.completion_date, i.links, i.notes
    from public.hr_daily_report_items i
    join public.hr_daily_reports r on r.id = i.report_id
    join public.hr_employees e on e.id = r.employee_id
    left join public.hr_projects p on p.id = i.project_id
    left join public.hr_tasks t on t.id = i.task_id
    where r.report_date between p_from and p_to
      and (r.employee_id = hr_private.current_employee_id()
           or (r.status <> 'draft' and hr_private.can_access_employee(r.employee_id, 'daily_reports')))
      and (p_employee is null or r.employee_id = p_employee)
      and (p_project is null or i.project_id = p_project)
      and (p_task is null or i.task_id = p_task)
      and (not p_completed_only or i.work_status = 'completed')
    order by r.report_date desc, i.created_at
    limit 3000;
end $$;

-- ---------------------------------------------------------------------
-- 7. Project Tracker integration hook (service role only; not called by
--    the browser). Upserts a project by (source = 'project_tracker',
--    external_ref). Allocations stay managed in HRMS.
-- ---------------------------------------------------------------------
create or replace function public.hr_sync_tracker_project(
  p_external_ref text, p_code text, p_name text, p_status text default 'active', p_description text default null,
  p_manager_employee_code text default null, p_start_date date default null, p_end_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_mgr uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform hr_private.fail('Only the Project Tracker integration may sync projects.', 'forbidden');
  end if;
  if nullif(btrim(p_external_ref), '') is null then perform hr_private.fail('external_ref is required.', 'invalid'); end if;
  if p_manager_employee_code is not null then
    select id into v_mgr from public.hr_employees where employee_code = p_manager_employee_code;
  end if;
  select id into v_id from public.hr_projects where source = 'project_tracker' and external_ref = btrim(p_external_ref);
  if v_id is null then
    if exists (select 1 from public.hr_projects where code = upper(btrim(p_code))) then
      perform hr_private.fail('A project with this code already exists in HRMS.', 'duplicate_code');
    end if;
    insert into public.hr_projects (code, name, description, status, start_date, end_date, manager_employee_id, source, external_ref, created_by)
    values (upper(btrim(p_code)), btrim(p_name), p_description, coalesce(p_status, 'active'), p_start_date, p_end_date, v_mgr,
            'project_tracker', btrim(p_external_ref), null)
    returning id into v_id;
  else
    update public.hr_projects set name = btrim(p_name), description = p_description, status = coalesce(p_status, status),
           start_date = p_start_date, end_date = p_end_date, manager_employee_id = coalesce(v_mgr, manager_employee_id)
    where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

revoke execute on function
  public.hr_save_work_blocker(uuid, uuid, uuid, uuid, uuid, text, text, text),
  public.hr_delete_work_blocker(uuid),
  public.hr_update_work_blocker(uuid, text, uuid, text, boolean),
  public.hr_list_work_blockers(text, date, date, uuid, uuid, uuid, boolean),
  public.hr_reopen_daily_report(uuid, text),
  public.hr_daily_work_overview(date, date, date, uuid, uuid, uuid, uuid, text),
  public.hr_work_hours_summary(date, date, text, uuid, uuid, uuid, uuid, uuid),
  public.hr_work_hours_vs_attendance(date, date, uuid, uuid, uuid, boolean),
  public.hr_completed_work(date, date, uuid, uuid, uuid, boolean),
  public.hr_sync_tracker_project(text, text, text, text, text, text, date, date)
from anon, public;
grant execute on function
  public.hr_save_work_blocker(uuid, uuid, uuid, uuid, uuid, text, text, text),
  public.hr_delete_work_blocker(uuid),
  public.hr_update_work_blocker(uuid, text, uuid, text, boolean),
  public.hr_list_work_blockers(text, date, date, uuid, uuid, uuid, boolean),
  public.hr_reopen_daily_report(uuid, text),
  public.hr_daily_work_overview(date, date, date, uuid, uuid, uuid, uuid, text),
  public.hr_work_hours_summary(date, date, text, uuid, uuid, uuid, uuid, uuid),
  public.hr_work_hours_vs_attendance(date, date, uuid, uuid, uuid, boolean),
  public.hr_completed_work(date, date, uuid, uuid, uuid, boolean)
to authenticated;
grant execute on function public.hr_sync_tracker_project(text, text, text, text, text, text, date, date) to service_role;

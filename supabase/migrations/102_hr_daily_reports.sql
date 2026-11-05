-- =====================================================================
-- 102_hr_daily_reports.sql — Projects, tasks and daily work reports
-- =====================================================================
-- Employees write their own DRAFT reports and items directly (RLS + guard
-- triggers). Status changes (submit / review) only happen through the
-- SECURITY DEFINER RPCs below; finalized reports cannot be edited by the
-- employee.
--
-- Depends on: 100_hr_foundation.sql (uses the calendar hooks of 101/103 when
-- present; safe stubs are created otherwise).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

insert into public.hr_settings (key, value, description) values
  ('daily_reports', jsonb_build_object(
      'reminder_enabled', true,
      'reminder_time', '19:00',          -- business timezone; used by the scheduler that calls hr_generate_daily_report_reminders
      'working_days', null                -- null = each employee's shift / company working days; or an ISO-dow array override
   ),
   'Daily work reports: reminder schedule and working-day override')
on conflict (key) do nothing;

-- Shared calendar helpers (identical bodies to 101; see note there).
create or replace function hr_private.employee_working_days(p_employee uuid)
returns smallint[] language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.working_days from public.hr_employees e join public.hr_shifts s on s.id = e.shift_id where e.id = p_employee),
    (select s.working_days from public.hr_shifts s where s.is_default and s.active limit 1),
    (select array_agg(x::smallint) from jsonb_array_elements_text(hr_private.setting('company') -> 'working_days') x),
    '{1,2,3,4,5}'::smallint[])
$$;
do $$
begin
  if to_regprocedure('hr_private.is_holiday(date,uuid)') is null then
    execute $f$create function hr_private.is_holiday(p_date date, p_employee uuid default null)
      returns boolean language sql stable set search_path = '' as 'select false'$f$;
  end if;
  if to_regprocedure('hr_private.is_on_approved_leave(uuid,date)') is null then
    execute $f$create function hr_private.is_on_approved_leave(p_employee uuid, p_date date)
      returns boolean language sql stable set search_path = '' as 'select false'$f$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Projects, members, tasks (managed by daily_reports.manage)
-- ---------------------------------------------------------------------
create table public.hr_projects (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name        text not null check (length(btrim(name)) between 2 and 150),
  client      text check (length(client) <= 150),
  description text check (length(description) <= 4000),
  status      text not null default 'active' check (status in ('active','on_hold','completed','archived')),
  start_date  date,
  end_date    date,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
select hr_private.secure_table('public.hr_projects');
create trigger hr_projects_touch before update on public.hr_projects for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_projects');

create table public.hr_project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.hr_projects(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  role        text not null default 'member' check (length(btrim(role)) between 2 and 60),
  added_by    uuid default auth.uid(),
  added_at    timestamptz not null default now(),
  unique (project_id, employee_id)
);
create index hr_project_members_employee on public.hr_project_members(employee_id);
select hr_private.secure_table('public.hr_project_members');
select hr_private.enable_audit('public.hr_project_members');

create table public.hr_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.hr_projects(id) on delete restrict,
  assignee_id  uuid references public.hr_employees(id) on delete set null,
  title        text not null check (length(btrim(title)) between 2 and 200),
  description  text check (length(description) <= 4000),
  status       text not null default 'todo' check (status in ('todo','in_progress','blocked','done')),
  priority     text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  due_date     date,
  created_by   uuid default auth.uid(),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index hr_tasks_assignee on public.hr_tasks(assignee_id, status);
create index hr_tasks_project on public.hr_tasks(project_id);
select hr_private.secure_table('public.hr_tasks');
create trigger hr_tasks_touch before update on public.hr_tasks for each row execute function hr_private.touch_updated_at();

create or replace function hr_private.is_project_member(p_project uuid, p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_employee is not null and exists (
    select 1 from public.hr_project_members m where m.project_id = p_project and m.employee_id = p_employee)
$$;

create or replace function hr_private.can_see_project(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('daily_reports.manage')
      or hr_private.has_permission('daily_reports.view')
      or hr_private.has_permission('daily_reports.review')
      or hr_private.is_project_member(p_project, hr_private.current_employee_id())
      or ((hr_private.has_permission('daily_reports.view_team') or hr_private.has_permission('daily_reports.review_team'))
          and exists (select 1 from public.hr_project_members m
                      where m.project_id = p_project and hr_private.is_manager_of(m.employee_id)))
$$;

create policy hr_projects_read on public.hr_projects for select to authenticated using (hr_private.can_see_project(id));
create policy hr_projects_insert on public.hr_projects for insert to authenticated with check (hr_private.has_permission('daily_reports.manage'));
create policy hr_projects_update on public.hr_projects for update to authenticated
  using (hr_private.has_permission('daily_reports.manage')) with check (hr_private.has_permission('daily_reports.manage'));
-- No delete: projects are archived (status = 'archived').

create policy hr_project_members_read on public.hr_project_members for select to authenticated using (hr_private.can_see_project(project_id));
create policy hr_project_members_insert on public.hr_project_members for insert to authenticated with check (hr_private.has_permission('daily_reports.manage'));
create policy hr_project_members_update on public.hr_project_members for update to authenticated
  using (hr_private.has_permission('daily_reports.manage')) with check (hr_private.has_permission('daily_reports.manage'));
create policy hr_project_members_delete on public.hr_project_members for delete to authenticated using (hr_private.has_permission('daily_reports.manage'));

create policy hr_tasks_read on public.hr_tasks for select to authenticated using (
     hr_private.has_permission('daily_reports.manage')
  or (assignee_id is not null and hr_private.can_access_employee(assignee_id, 'daily_reports')));
create policy hr_tasks_insert on public.hr_tasks for insert to authenticated with check (hr_private.has_permission('daily_reports.manage'));
create policy hr_tasks_update on public.hr_tasks for update to authenticated
  using (hr_private.has_permission('daily_reports.manage')) with check (hr_private.has_permission('daily_reports.manage'));
-- No delete: tasks are closed (status = 'done').

create or replace function hr_private.tasks_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger hr_tasks_before_write before insert or update on public.hr_tasks for each row execute function hr_private.tasks_before_write();

-- Assignee updates their own task status.
create or replace function public.hr_update_my_task_status(p_task uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.hr_tasks;
begin
  select * into t from public.hr_tasks where id = p_task for update;
  if t.id is null or t.assignee_id is distinct from hr_private.current_employee_id() or hr_private.current_employee_id() is null then
    perform hr_private.fail('Task not found.', 'not_found');
  end if;
  if p_status not in ('todo','in_progress','blocked','done') then
    perform hr_private.fail('Unknown task status.', 'invalid');
  end if;
  update public.hr_tasks set status = p_status where id = p_task returning * into t;
  return to_jsonb(t);
end $$;

-- ---------------------------------------------------------------------
-- Daily reports
-- ---------------------------------------------------------------------
create table public.hr_daily_reports (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.hr_employees(id) on delete restrict,
  report_date          date not null,
  status               text not null default 'draft'
                       check (status in ('draft','submitted','under_review','reviewed','revision_requested')),
  summary              text check (length(summary) <= 4000),
  pending_work         text check (length(pending_work) <= 4000),
  blockers             text check (length(blockers) <= 4000),
  support_required     text check (length(support_required) <= 4000),
  tomorrow_plan        text check (length(tomorrow_plan) <= 4000),
  total_hours          numeric(5,2) not null default 0 check (total_hours between 0 and 24),
  submitted_at         timestamptz,
  reviewer_employee_id uuid references public.hr_employees(id) on delete set null,
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (employee_id, report_date)
);
create index hr_daily_reports_date on public.hr_daily_reports(report_date, status);
select hr_private.secure_table('public.hr_daily_reports');

create table public.hr_daily_report_items (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.hr_daily_reports(id) on delete cascade,
  project_id   uuid references public.hr_projects(id) on delete restrict,   -- null = internal / general work
  task_id      uuid references public.hr_tasks(id) on delete set null,
  activity     text not null check (length(btrim(activity)) between 2 and 200),
  description  text check (length(description) <= 4000),
  hours        numeric(4,2) not null check (hours > 0 and hours <= 24),
  progress_pct smallint check (progress_pct between 0 and 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index hr_daily_report_items_report on public.hr_daily_report_items(report_id);
create index hr_daily_report_items_project on public.hr_daily_report_items(project_id);
select hr_private.secure_table('public.hr_daily_report_items');
create trigger hr_daily_report_items_touch before update on public.hr_daily_report_items for each row execute function hr_private.touch_updated_at();

create table public.hr_daily_report_reviews (
  id                   uuid primary key default gen_random_uuid(),
  report_id            uuid not null references public.hr_daily_reports(id) on delete cascade,
  actor_employee_id    uuid references public.hr_employees(id) on delete set null,
  actor_user_id        uuid,
  action               text not null check (action in ('submitted','comment','clarification','under_review','reviewed','revision_requested')),
  from_status          text,
  to_status            text,
  comment              text check (length(comment) <= 4000),
  created_at           timestamptz not null default now()
);
create index hr_daily_report_reviews_report on public.hr_daily_report_reviews(report_id, created_at);
select hr_private.secure_table('public.hr_daily_report_reviews');
revoke insert, update, delete, truncate on public.hr_daily_report_reviews from authenticated;

-- Visibility: owner always; others (team / all) only once submitted.
create or replace function hr_private.can_view_daily_report(p_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hr_daily_reports r
    where r.id = p_report
      and (r.employee_id = hr_private.current_employee_id()
           or (r.status <> 'draft' and hr_private.can_access_employee(r.employee_id, 'daily_reports'))))
$$;

-- Editable by the caller: own report in draft / revision_requested.
create or replace function hr_private.daily_report_editable(p_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hr_daily_reports r
    where r.id = p_report
      and r.employee_id = hr_private.current_employee_id()
      and r.status in ('draft','revision_requested'))
$$;

create policy hr_daily_reports_read on public.hr_daily_reports for select to authenticated using (
     employee_id = hr_private.current_employee_id()
  or (status <> 'draft' and hr_private.can_access_employee(employee_id, 'daily_reports')));
create policy hr_daily_reports_insert on public.hr_daily_reports for insert to authenticated
  with check (employee_id = hr_private.current_employee_id() and status = 'draft');
create policy hr_daily_reports_update on public.hr_daily_reports for update to authenticated
  using (employee_id = hr_private.current_employee_id() and status in ('draft','revision_requested'))
  with check (employee_id = hr_private.current_employee_id() and status in ('draft','revision_requested'));
create policy hr_daily_reports_delete on public.hr_daily_reports for delete to authenticated
  using (employee_id = hr_private.current_employee_id() and status = 'draft');

create policy hr_daily_report_items_read on public.hr_daily_report_items for select to authenticated
  using (hr_private.can_view_daily_report(report_id));
create policy hr_daily_report_items_insert on public.hr_daily_report_items for insert to authenticated
  with check (hr_private.daily_report_editable(report_id));
create policy hr_daily_report_items_update on public.hr_daily_report_items for update to authenticated
  using (hr_private.daily_report_editable(report_id)) with check (hr_private.daily_report_editable(report_id));
create policy hr_daily_report_items_delete on public.hr_daily_report_items for delete to authenticated
  using (hr_private.daily_report_editable(report_id));

create policy hr_daily_report_reviews_read on public.hr_daily_report_reviews for select to authenticated
  using (hr_private.can_view_daily_report(report_id));

-- Guard: clients create drafts and edit content; workflow fields only via RPCs.
create or replace function hr_private.daily_reports_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_priv boolean := coalesce(current_setting('hr.privileged_write', true), '') = 'on' or auth.uid() is null;
begin
  if tg_op = 'INSERT' then
    if not v_priv then
      new.status := 'draft';
      new.submitted_at := null; new.reviewer_employee_id := null; new.reviewed_by := null; new.reviewed_at := null;
    end if;
    new.total_hours := 0;
  else
    if not v_priv and (new.status is distinct from old.status
                       or new.employee_id is distinct from old.employee_id
                       or new.submitted_at is distinct from old.submitted_at
                       or new.reviewer_employee_id is distinct from old.reviewer_employee_id
                       or new.reviewed_by is distinct from old.reviewed_by
                       or new.reviewed_at is distinct from old.reviewed_at) then
      perform hr_private.fail('Report status changes go through submit / review.', 'use_workflow');
    end if;
    new.total_hours := coalesce((select sum(i.hours) from public.hr_daily_report_items i where i.report_id = new.id), 0);
    if new.total_hours > 24 then
      perform hr_private.fail('Total hours for a day cannot exceed 24.', 'too_many_hours');
    end if;
  end if;
  if new.report_date > hr_private.business_today() then
    perform hr_private.fail('A daily report cannot be dated in the future.', 'future_date');
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger hr_daily_reports_before_write before insert or update on public.hr_daily_reports
  for each row execute function hr_private.daily_reports_before_write();

-- Item validation: project must be active and the employee a member; task must belong to it.
create or replace function hr_private.daily_report_items_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; p public.hr_projects; t public.hr_tasks;
begin
  select employee_id into v_emp from public.hr_daily_reports where id = new.report_id;
  if new.project_id is not null then
    select * into p from public.hr_projects where id = new.project_id;
    if p.id is null or p.status <> 'active' then
      perform hr_private.fail('Choose an active project.', 'invalid_project');
    end if;
    if not hr_private.is_project_member(new.project_id, v_emp) then
      perform hr_private.fail('You are not a member of this project.', 'not_project_member');
    end if;
  end if;
  if new.task_id is not null then
    select * into t from public.hr_tasks where id = new.task_id;
    if t.id is null or t.project_id is distinct from new.project_id then
      perform hr_private.fail('The task does not belong to the selected project.', 'invalid_task');
    end if;
  end if;
  if tg_op = 'UPDATE' and new.report_id <> old.report_id then
    perform hr_private.fail('Items cannot be moved between reports.', 'invalid');
  end if;
  return new;
end $$;
create trigger hr_daily_report_items_before_write before insert or update on public.hr_daily_report_items
  for each row execute function hr_private.daily_report_items_before_write();

-- Keep the parent's total_hours in sync (the parent trigger recomputes it).
create or replace function hr_private.daily_report_items_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.hr_daily_reports set updated_at = now() where id = coalesce(new.report_id, old.report_id);
  return null;
end $$;
create trigger hr_daily_report_items_after_write after insert or update or delete on public.hr_daily_report_items
  for each row execute function hr_private.daily_report_items_after_write();

-- ---------------------------------------------------------------------
-- Workflow RPCs
-- ---------------------------------------------------------------------
create or replace function public.hr_submit_daily_report(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_daily_reports; v_items int; v_total numeric; v_from text;
begin
  select * into r from public.hr_daily_reports where id = p_id for update;
  if r.id is null or r.employee_id is distinct from hr_private.current_employee_id() or hr_private.current_employee_id() is null then
    perform hr_private.fail('Report not found.', 'not_found');
  end if;
  if r.status not in ('draft','revision_requested') then
    perform hr_private.fail('This report has already been submitted.', 'already_submitted');
  end if;
  if r.report_date > hr_private.business_today() then
    perform hr_private.fail('A daily report cannot be dated in the future.', 'future_date');
  end if;
  select count(*), coalesce(sum(hours), 0) into v_items, v_total from public.hr_daily_report_items where report_id = p_id;
  if v_items = 0 then perform hr_private.fail('Add at least one work item before submitting.', 'no_items'); end if;
  if v_total > 24 then perform hr_private.fail('Total hours for a day cannot exceed 24.', 'too_many_hours'); end if;
  v_from := r.status;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_daily_reports set status = 'submitted', submitted_at = now(),
         reviewed_by = null, reviewed_at = null
  where id = p_id returning * into r;
  perform set_config('hr.privileged_write', 'off', true);
  insert into public.hr_daily_report_reviews (report_id, actor_employee_id, actor_user_id, action, from_status, to_status)
  values (p_id, r.employee_id, auth.uid(), 'submitted', v_from, 'submitted');
  perform hr_private.notify_employee(hr_private.my_manager_id(), 'daily_reports.submitted', 'Daily report submitted',
    'A team member submitted their report for ' || to_char(r.report_date, 'DD Mon YYYY') || '.',
    '/hr/daily-reports', 'hr_daily_reports', p_id::text);
  return to_jsonb(r);
end $$;

-- Reviewer actions: comment | clarification | under_review | reviewed | revision_requested.
create or replace function public.hr_review_daily_report(p_id uuid, p_action text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_daily_reports; v_from text; v_to text; v_comment text := nullif(btrim(p_comment), '');
begin
  select * into r from public.hr_daily_reports where id = p_id for update;
  if r.id is null then perform hr_private.fail('Report not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot review your own report.', 'self_review');
  end if;
  if not hr_private.can_act_on_employee(r.employee_id, 'daily_reports.review', 'daily_reports.review_team') then
    perform hr_private.fail('You are not allowed to review this report.', 'forbidden');
  end if;
  if p_action not in ('comment','clarification','under_review','reviewed','revision_requested') then
    perform hr_private.fail('Unknown review action.', 'invalid');
  end if;
  if p_action in ('comment','clarification','revision_requested') and v_comment is null then
    perform hr_private.fail('A comment is required for this action.', 'comment_required');
  end if;
  v_from := r.status;
  if v_from = 'reviewed' and p_action = 'comment' then
    v_to := 'reviewed';
  elsif v_from not in ('submitted','under_review') then
    perform hr_private.fail('This report is not awaiting review (status: ' || v_from || ').', 'invalid_state');
  else
    v_to := case p_action when 'reviewed' then 'reviewed' when 'revision_requested' then 'revision_requested' else 'under_review' end;
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_daily_reports set status = v_to,
         reviewer_employee_id = hr_private.current_employee_id(),
         reviewed_by = case when v_to in ('reviewed','revision_requested') then auth.uid() else reviewed_by end,
         reviewed_at = case when v_to in ('reviewed','revision_requested') then now() else reviewed_at end
  where id = p_id returning * into r;
  perform set_config('hr.privileged_write', 'off', true);
  insert into public.hr_daily_report_reviews (report_id, actor_employee_id, actor_user_id, action, from_status, to_status, comment)
  values (p_id, hr_private.current_employee_id(), auth.uid(), p_action, v_from, v_to, v_comment);
  perform hr_private.notify_employee(r.employee_id, 'daily_reports.' || p_action,
    case p_action when 'reviewed' then 'Daily report reviewed'
                  when 'revision_requested' then 'Revision requested on your daily report'
                  when 'clarification' then 'Clarification requested on your daily report'
                  else 'New comment on your daily report' end,
    coalesce(v_comment, 'Report for ' || to_char(r.report_date, 'DD Mon YYYY') || ' is now ' || replace(v_to, '_', ' ') || '.'),
    '/employee/daily-reports', 'hr_daily_reports', p_id::text);
  return to_jsonb(r);
end $$;

-- Owner replies to a clarification / comment thread (no status change).
create or replace function public.hr_reply_daily_report(p_id uuid, p_comment text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_daily_reports;
begin
  select * into r from public.hr_daily_reports where id = p_id;
  if r.id is null or r.employee_id is distinct from hr_private.current_employee_id() or hr_private.current_employee_id() is null then
    perform hr_private.fail('Report not found.', 'not_found');
  end if;
  if r.status = 'draft' then perform hr_private.fail('Submit the report before commenting.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_comment, ''))) = 0 then perform hr_private.fail('Comment cannot be empty.', 'comment_required'); end if;
  insert into public.hr_daily_report_reviews (report_id, actor_employee_id, actor_user_id, action, from_status, to_status, comment)
  values (p_id, r.employee_id, auth.uid(), 'comment', r.status, r.status, btrim(p_comment));
  perform hr_private.notify_employee(coalesce((select reviewer_employee_id from public.hr_daily_reports where id = p_id), hr_private.my_manager_id()),
    'daily_reports.reply', 'Reply on a daily report', left(btrim(p_comment), 300), '/hr/daily-reports', 'hr_daily_reports', p_id::text);
end $$;

-- ---------------------------------------------------------------------
-- Compliance: missing reports + reminders + blockers
-- ---------------------------------------------------------------------
create or replace function hr_private.daily_report_working_days(p_employee uuid)
returns smallint[] language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select array_agg(x::smallint) from jsonb_array_elements_text(
        case when jsonb_typeof(hr_private.setting('daily_reports') -> 'working_days') = 'array'
             then hr_private.setting('daily_reports') -> 'working_days' end) x),
    hr_private.employee_working_days(p_employee))
$$;

-- All active employees (portal enabled) with no submitted report on a working day.
-- "Submitted" = submitted, under_review, reviewed or revision_requested.
create or replace function hr_private.daily_report_missing(p_date date)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.hr_employees e
  where e.status in ('active','probation','notice_period')
    and e.portal_access and e.user_id is not null
    and (e.joining_date is null or e.joining_date <= p_date)
    and (e.last_working_date is null or e.last_working_date >= p_date)
    and extract(isodow from p_date)::smallint = any(hr_private.daily_report_working_days(e.id))
    and not hr_private.is_holiday(p_date, e.id)
    and not hr_private.is_on_approved_leave(e.id, p_date)
    and not exists (select 1 from public.hr_daily_reports r
                    where r.employee_id = e.id and r.report_date = p_date
                      and r.status in ('submitted','under_review','reviewed','revision_requested'))
$$;

create or replace function public.hr_missing_daily_reports(p_date date default null)
returns table (employee_id uuid, employee_code text, employee_name text, department_id uuid, manager_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, hr_private.business_today());
  v_all boolean := hr_private.has_permission('daily_reports.view') or coalesce(auth.role(), '') = 'service_role';
begin
  if not v_all and not hr_private.has_permission('daily_reports.view_team') then
    perform hr_private.fail('You are not allowed to view report compliance.', 'forbidden');
  end if;
  if v_date > hr_private.business_today() then
    perform hr_private.fail('Compliance cannot be checked for a future date.', 'future_date');
  end if;
  return query
    select e.id, e.employee_code, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), e.department_id, e.manager_id
    from hr_private.daily_report_missing(v_date) m(id)
    join public.hr_employees e on e.id = m.id
    where v_all or hr_private.is_manager_of(e.id)
    order by e.employee_code;
end $$;

create table public.hr_daily_report_reminders (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  report_date date not null,
  notified_at timestamptz not null default now(),
  unique (employee_id, report_date)
);
select hr_private.secure_table('public.hr_daily_report_reminders');
create policy hr_daily_report_reminders_read on public.hr_daily_report_reminders for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'daily_reports'));
revoke insert, update, delete, truncate on public.hr_daily_report_reminders from authenticated;

-- One reminder per missing employee per date (idempotent). Called by HR or
-- by a scheduler with the service role at settings.daily_reports.reminder_time.
create or replace function public.hr_generate_daily_report_reminders(p_date date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, hr_private.business_today());
  v_count int := 0;
  r record;
begin
  if not (hr_private.has_permission('daily_reports.manage') or coalesce(auth.role(), '') = 'service_role') then
    perform hr_private.fail('You are not allowed to send report reminders.', 'forbidden');
  end if;
  if v_date > hr_private.business_today() then
    perform hr_private.fail('Reminders cannot be generated for a future date.', 'future_date');
  end if;
  if coalesce((hr_private.setting('daily_reports') ->> 'reminder_enabled')::boolean, true) = false then
    return 0;
  end if;
  for r in
    insert into public.hr_daily_report_reminders (employee_id, report_date)
    select m.id, v_date from hr_private.daily_report_missing(v_date) m(id)
    on conflict (employee_id, report_date) do nothing
    returning id, employee_id
  loop
    v_count := v_count + 1;
    perform hr_private.notify_employee(r.employee_id, 'daily_reports.reminder', 'Daily report pending',
      'Please submit your daily work report for ' || to_char(v_date, 'DD Mon YYYY') || '.',
      '/employee/daily-reports', 'hr_daily_report_reminders', r.id::text);
  end loop;
  return v_count;
end $$;

-- Reports with blockers in a date range, scoped to the caller. occurrences =
-- how many reports with blockers that employee had in the range (recurrence).
create or replace function public.hr_daily_report_blockers(p_from date, p_to date, p_employee uuid default null, p_project uuid default null)
returns table (report_id uuid, report_date date, employee_id uuid, employee_name text, status text,
               blockers text, support_required text, project_ids uuid[], project_names text, occurrences bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from then
    perform hr_private.fail('Choose a valid date range.', 'invalid_range');
  end if;
  if p_to - p_from > 366 then
    perform hr_private.fail('The date range cannot exceed one year.', 'invalid_range');
  end if;
  return query
    select r.id, r.report_date, r.employee_id,
           coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
           r.status, r.blockers, r.support_required,
           coalesce((select array_agg(distinct i.project_id) from public.hr_daily_report_items i where i.report_id = r.id and i.project_id is not null), '{}'),
           (select string_agg(distinct p.name, ', ') from public.hr_daily_report_items i join public.hr_projects p on p.id = i.project_id where i.report_id = r.id),
           count(*) over (partition by r.employee_id)
    from public.hr_daily_reports r
    join public.hr_employees e on e.id = r.employee_id
    where r.report_date between p_from and p_to
      and r.status <> 'draft'
      and length(btrim(coalesce(r.blockers, ''))) > 0
      and (p_employee is null or r.employee_id = p_employee)
      and (p_project is null or exists (select 1 from public.hr_daily_report_items i where i.report_id = r.id and i.project_id = p_project))
      and (r.employee_id = hr_private.current_employee_id() or hr_private.can_access_employee(r.employee_id, 'daily_reports'))
    order by r.employee_id, r.report_date;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

revoke execute on function public.hr_update_my_task_status(uuid, text), public.hr_submit_daily_report(uuid),
  public.hr_review_daily_report(uuid, text, text), public.hr_reply_daily_report(uuid, text),
  public.hr_missing_daily_reports(date), public.hr_generate_daily_report_reminders(date),
  public.hr_daily_report_blockers(date, date, uuid, uuid) from anon, public;
grant execute on function public.hr_update_my_task_status(uuid, text), public.hr_submit_daily_report(uuid),
  public.hr_review_daily_report(uuid, text, text), public.hr_reply_daily_report(uuid, text),
  public.hr_missing_daily_reports(date), public.hr_generate_daily_report_reminders(date),
  public.hr_daily_report_blockers(date, date, uuid, uuid) to authenticated;
grant execute on function public.hr_missing_daily_reports(date), public.hr_generate_daily_report_reminders(date) to service_role;

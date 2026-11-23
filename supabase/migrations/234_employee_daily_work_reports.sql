-- 234: Employee Portal — Daily Work Report.
--
-- One report per employee per day (India date). A report has one entry per
-- project the employee is on: task updates, completed work, pending work,
-- hours spent. Plus optional notes / blockers for the manager.
--
-- Flow:  draft  --submit-->  submitted  --manager-->  reviewed
--                                         \--manager-->  returned (comment) --edit + resubmit--> submitted
-- Draft and returned reports are editable by the employee; submitted and
-- reviewed reports are locked.
-- Reports go to the employee's reporting manager (ep_employees.reporting_manager_id,
-- migration 231). Submitting without a reporting manager is refused.
-- Dates allowed: today and the 7 days before it (India time); never the future.
--
-- Employees and managers use only the security-definer RPCs below.
-- Admins (public.is_admin()) can read and manage the tables directly.
-- Rollback: supabase/rollbacks/234_rollback_employee_daily_work_reports.sql

begin;

create table if not exists public.ep_work_reports (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.ep_employees (id) on delete cascade,
  report_date    date not null,
  status         text not null default 'draft' check (status in ('draft', 'submitted', 'reviewed', 'returned')),
  notes          text check (notes is null or length(notes) <= 2000),
  submitted_to   uuid references public.ep_employees (id) on delete set null,
  submitted_at   timestamptz,
  reviewed_by    uuid references public.ep_employees (id) on delete set null,
  reviewed_at    timestamptz,
  review_comment text check (review_comment is null or length(review_comment) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (employee_id, report_date)
);
create index if not exists ep_work_reports_submitted_to on public.ep_work_reports (submitted_to, status, report_date desc);

create table if not exists public.ep_work_report_items (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.ep_work_reports (id) on delete cascade,
  project_id     uuid not null references public.pt_projects (id) on delete cascade,
  task_updates   text check (task_updates is null or length(task_updates) <= 2000),
  completed_work text check (completed_work is null or length(completed_work) <= 2000),
  pending_work   text check (pending_work is null or length(pending_work) <= 2000),
  hours          numeric(4, 2) not null check (hours > 0 and hours <= 24),
  position       smallint not null default 0,
  unique (report_id, project_id)
);

comment on table public.ep_work_reports is 'Employee Portal: daily work report (one per employee per day). Written via ep_save_my_report / ep_review_report.';
comment on table public.ep_work_report_items is 'Employee Portal: one project entry of a daily work report.';

-- ---------------------------------------------------------------- RLS
alter table public.ep_work_reports      enable row level security;
alter table public.ep_work_report_items enable row level security;
revoke all on public.ep_work_reports, public.ep_work_report_items from anon, authenticated;
grant select, insert, update, delete on public.ep_work_reports, public.ep_work_report_items to authenticated;

drop policy if exists ep_work_reports_read on public.ep_work_reports;
create policy ep_work_reports_read on public.ep_work_reports for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()))
         or (status <> 'draft'
             and submitted_to in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()))));
drop policy if exists ep_work_reports_admin_write on public.ep_work_reports;
create policy ep_work_reports_admin_write on public.ep_work_reports for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists ep_work_report_items_read on public.ep_work_report_items;
create policy ep_work_report_items_read on public.ep_work_report_items for select to authenticated
  using (exists (select 1 from public.ep_work_reports r where r.id = report_id));  -- inherits the report policy
drop policy if exists ep_work_report_items_admin_write on public.ep_work_report_items;
create policy ep_work_report_items_admin_write on public.ep_work_report_items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------- helpers (internal)
-- Full report as JSON (report + entries + people), or null.
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

-- ---------------------------------------------------------------- employee: read
-- The report of one day (null when not started) + what the page needs around it.
create or replace function public.ep_my_report(p_date date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr   public.ep_employees;
  v_rep   uuid;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select m.* into v_mgr from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
   where e.id = v_emp;
  select id into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  return jsonb_build_object(
    'date', p_date,
    'date_allowed', p_date between v_today - 7 and v_today,
    'manager', case when v_mgr.id is null then null
                    else jsonb_build_object('id', v_mgr.id, 'full_name', v_mgr.full_name, 'employee_code', v_mgr.employee_code,
                                            'designation', v_mgr.designation) end,
    'worked_minutes', (
      select floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int
      from public.ep_attendance a where a.employee_id = v_emp and a.work_date = p_date),
    'report', case when v_rep is null then null else public.ep_report_json(v_rep) end
  );
end $$;

-- Summary list (newest first) between two dates, at most 62 days.
create or replace function public.ep_my_reports(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'report_date', r.report_date, 'status', r.status,
             'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at,
             'projects', (select count(*) from public.ep_work_report_items i where i.report_id = r.id),
             'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0))
           order by r.report_date desc)
    from public.ep_work_reports r
    where r.employee_id = v_emp and r.report_date between p_from and p_to), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- employee: save / submit
-- p_items: [{project_id, task_updates, completed_work, pending_work, hours}, ...]
-- Replaces all entries of the day's report. p_submit = true also submits it.
create or replace function public.ep_save_my_report(p_date date, p_notes text, p_items jsonb, p_submit boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr    uuid;
  v_rep    public.ep_work_reports;
  v_item   jsonb;
  v_pid    uuid;
  v_hours  numeric;
  v_total  numeric := 0;
  v_seen   uuid[] := '{}';
  v_pos    int := 0;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'You cannot write a report for a future date.' using errcode = '22023';
  end if;
  if p_date < v_today - 7 then
    raise exception 'Reports can only be written for today and the last 7 days.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid report entries.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'A report can have at most 20 project entries.' using errcode = '22023';
  end if;
  if coalesce(length(v_notes), 0) > 2000 then
    raise exception 'Notes must be at most 2000 characters.' using errcode = '22023';
  end if;
  if p_submit and jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one project entry before submitting.' using errcode = '22023';
  end if;

  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  if p_submit and v_mgr is null then
    raise exception 'No reporting manager is set for you yet. Ask the admin to set one, then submit.' using errcode = '22023';
  end if;

  -- Serialise saves of the same report.
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text || p_date::text, 0));
  select * into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  if v_rep.id is not null and v_rep.status in ('submitted', 'reviewed') then
    raise exception 'This report is already submitted and cannot be changed.' using errcode = 'P0001';
  end if;

  -- Validate every entry before writing anything.
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid   := (v_item ->> 'project_id')::uuid;
      v_hours := (v_item ->> 'hours')::numeric;
    exception when others then
      raise exception 'Invalid report entries.' using errcode = '22023';
    end;
    if v_pid is null or not exists (select 1 from public.ep_project_members where project_id = v_pid and employee_id = v_emp) then
      raise exception 'You can only report on projects you are assigned to.' using errcode = '42501';
    end if;
    if v_pid = any (v_seen) then
      raise exception 'Each project can be added only once per report.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_pid;
    if v_hours is null or v_hours <= 0 or v_hours > 24 or v_hours <> round(v_hours, 2) then
      raise exception 'Hours spent must be more than 0 and at most 24 for each project.' using errcode = '22023';
    end if;
    v_total := v_total + v_hours;
    if coalesce(btrim(v_item ->> 'task_updates'), '') = '' and coalesce(btrim(v_item ->> 'completed_work'), '') = ''
       and coalesce(btrim(v_item ->> 'pending_work'), '') = '' then
      raise exception 'Write what you worked on for every project you added.' using errcode = '22023';
    end if;
    if greatest(length(v_item ->> 'task_updates'), length(v_item ->> 'completed_work'), length(v_item ->> 'pending_work')) > 2000 then
      raise exception 'Each text box can have at most 2000 characters.' using errcode = '22023';
    end if;
  end loop;
  if v_total > 24 then
    raise exception 'Total hours for the day cannot be more than 24.' using errcode = '22023';
  end if;

  if v_rep.id is null then
    insert into public.ep_work_reports (employee_id, report_date, notes)
    values (v_emp, p_date, v_notes) returning * into v_rep;
  else
    update public.ep_work_reports set notes = v_notes, updated_at = now() where id = v_rep.id;
  end if;

  delete from public.ep_work_report_items where report_id = v_rep.id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.ep_work_report_items (report_id, project_id, task_updates, completed_work, pending_work, hours, position)
    values (v_rep.id, (v_item ->> 'project_id')::uuid,
            nullif(btrim(coalesce(v_item ->> 'task_updates', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'completed_work', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'pending_work', '')), ''),
            (v_item ->> 'hours')::numeric, v_pos);
    v_pos := v_pos + 1;
  end loop;

  if p_submit then
    update public.ep_work_reports
       set status = 'submitted', submitted_to = v_mgr, submitted_at = now(), updated_at = now(),
           reviewed_by = null, reviewed_at = null, review_comment = null
     where id = v_rep.id;
  end if;

  return public.ep_my_report(p_date);
end $$;

-- ---------------------------------------------------------------- manager
-- Reports submitted to me, or by people who report to me (newest first, 60 days).
create or replace function public.ep_team_reports()
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
  return jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation) order by e.full_name)
      from public.ep_employees e where e.reporting_manager_id = v_emp and e.is_active), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'report_date', r.report_date, 'status', r.status,
               'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at,
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code),
               'projects', (select count(*) from public.ep_work_report_items i where i.report_id = r.id),
               'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0))
             order by (r.status = 'submitted') desc, r.report_date desc, e.full_name)
      from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
      where r.status <> 'draft'
        and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)
        and r.report_date >= v_today - 60), '[]'::jsonb)
  );
end $$;

create or replace function public.ep_team_report(p_report uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null or not exists (
       select 1 from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
        where r.id = p_report and r.status <> 'draft'
          and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)) then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  return public.ep_report_json(p_report);
end $$;

-- p_action: 'reviewed' or 'returned' (returned needs a comment).
create or replace function public.ep_review_report(p_report uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_status  text;
begin
  select r.status into v_status
    from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_report and r.status <> 'draft'
     and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)
   for update of r;
  if v_emp is null or v_status is null then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed.' using errcode = 'P0001';
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
     set status = p_action, reviewed_by = v_emp, reviewed_at = now(), review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $$;

revoke all on function public.ep_my_report(date), public.ep_my_reports(date, date),
  public.ep_save_my_report(date, text, jsonb, boolean), public.ep_team_reports(), public.ep_team_report(uuid),
  public.ep_review_report(uuid, text, text) from public, anon;
grant execute on function public.ep_my_report(date), public.ep_my_reports(date, date),
  public.ep_save_my_report(date, text, jsonb, boolean), public.ep_team_reports(), public.ep_team_report(uuid),
  public.ep_review_report(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;

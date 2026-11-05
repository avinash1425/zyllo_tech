-- =====================================================================
-- 118_hr_employee_management.sql — Employee Management (HRMS module 2)
-- (consolidates the existing Employee Master; additive only)
-- =====================================================================
-- Depends on 100–117. Nothing here drops or rewrites existing data, and no
-- existing employee ID, record, route or RPC changes. Adds:
--   * hr_employee_change_events: one row per authorised employment change
--     (promotion, transfer, manager change, confirmation, status change…)
--     with effective date, reason and actor. The existing field-level
--     hr_employee_history rows written by the triggers in 100/113 are
--     linked to their event (event_id) — history is never overwritten.
--   * history immutability: field-level history rows cannot be edited,
--     except that hr_change_employee_assignment() may attach its own
--     just-written rows to their event (event, effective date, reason).
--   * assignment validation on hr_employees: a designation that belongs to
--     a department must match the employee's department; newly assigned
--     departments / designations must be active; a newly assigned manager
--     must be a current employee. (Self-reporting and reporting cycles were
--     already rejected in 100.) Only CHANGED values are checked, so
--     existing rows are untouched.
--   * hr_employees.confirmation_date (probation → confirmed).
--   * RPCs:
--       hr_change_employee_assignment()  audited, reasoned, effective-dated
--                                        change (employees.edit)
--       hr_employee_timeline()           employment timeline incl. actor
--                                        (self / employees.view / team)
--       hr_employee_summary()            directory summary counts
--                                        (security invoker = caller's RLS)
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Confirmation date (probation → confirmed); nullable, additive.
-- ---------------------------------------------------------------------
alter table public.hr_employees add column if not exists confirmation_date date;
alter table public.hr_employees drop constraint if exists hr_employees_confirmation_after_joining;
alter table public.hr_employees add constraint hr_employees_confirmation_after_joining
  check (confirmation_date is null or joining_date is null or confirmation_date >= joining_date);

-- ---------------------------------------------------------------------
-- Change events (append-only)
-- ---------------------------------------------------------------------
create table public.hr_employee_change_events (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.hr_employees(id) on delete cascade,
  category        text not null check (category in (
                    'promotion','demotion','transfer','designation_change','manager_change',
                    'probation_start','confirmation','status_change','reactivation','correction')),
  effective_date  date not null,
  reason          text not null check (length(btrim(reason)) between 3 and 1000),
  changes         jsonb not null default '{}'::jsonb,   -- {field: {from, to}} with readable names
  changed_by      uuid,
  changed_by_employee uuid,
  changed_at      timestamptz not null default now()
);
create index hr_employee_change_events_emp on public.hr_employee_change_events(employee_id, effective_date desc, changed_at desc);
select hr_private.secure_table('public.hr_employee_change_events');
create policy hr_employee_change_events_read on public.hr_employee_change_events for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'employees'));
-- Written only by hr_change_employee_assignment(); no insert/update/delete policies.
select hr_private.enable_audit('public.hr_employee_change_events');

alter table public.hr_employee_history add column if not exists event_id uuid references public.hr_employee_change_events(id) on delete set null;
create index if not exists hr_employee_history_event on public.hr_employee_history(event_id) where event_id is not null;

-- History rows are facts: they may not be rewritten. The only permitted
-- update attaches a freshly written row to its change event.
create or replace function hr_private.employee_history_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('hr.history_annotate', true) = 'on'
     and old.event_id is null
     and (new.id, new.employee_id, new.change_type, new.old_value, new.new_value, new.changed_by, new.changed_at)
         is not distinct from (old.id, old.employee_id, old.change_type, old.old_value, old.new_value, old.changed_by, old.changed_at) then
    return new;
  end if;
  perform hr_private.fail('Employment history cannot be edited. Record a new change instead.', 'history_immutable');
  return null;
end $$;
drop trigger if exists hr_employee_history_immutable on public.hr_employee_history;
create trigger hr_employee_history_immutable before update on public.hr_employee_history
  for each row execute function hr_private.employee_history_immutable();

-- ---------------------------------------------------------------------
-- Assignment validation (only changed values are checked)
-- ---------------------------------------------------------------------
create or replace function hr_private.employees_validate_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_dep_changed boolean := tg_op = 'INSERT' or new.department_id is distinct from old.department_id;
  v_des_changed boolean := tg_op = 'INSERT' or new.designation_id is distinct from old.designation_id;
  v_des record;
begin
  if v_dep_changed and new.department_id is not null
     and not exists (select 1 from public.hr_departments d where d.id = new.department_id and d.active) then
    perform hr_private.fail('The selected department is inactive. Choose an active department.', 'inactive_department');
  end if;
  if new.designation_id is not null and (v_dep_changed or v_des_changed) then
    select d.active, d.department_id, d.name into v_des from public.hr_designations d where d.id = new.designation_id;
    if v_des_changed and not coalesce(v_des.active, false) then
      perform hr_private.fail('The selected designation is inactive. Choose an active designation.', 'inactive_designation');
    end if;
    if v_des.department_id is not null and v_des.department_id is distinct from new.department_id then
      perform hr_private.fail(format('Designation "%s" belongs to a different department. Choose a designation of the employee''s department.', v_des.name), 'designation_department_mismatch');
    end if;
  end if;
  if new.manager_id is not null and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id)
     and exists (select 1 from public.hr_employees m where m.id = new.manager_id and m.status in ('exited','archived')) then
    perform hr_private.fail('The selected reporting manager is no longer a current employee.', 'manager_not_current');
  end if;
  return new;
end $$;
drop trigger if exists hr_employees_validate_assignment on public.hr_employees;
create trigger hr_employees_validate_assignment before insert or update of department_id, designation_id, manager_id on public.hr_employees
  for each row execute function hr_private.employees_validate_assignment();

-- ---------------------------------------------------------------------
-- Reasoned, effective-dated employment change
-- ---------------------------------------------------------------------
-- Every argument except the employee, category, effective date and reason
-- is optional; null = keep. p_clear_manager = true removes the manager.
-- Status may be onboarding / probation / active / suspended / archived
-- (archive also needs employees.archive). Notice period and exit go through
-- Exit Management. The UPDATE runs with the caller's identity, so the RLS
-- policy and every guard trigger on hr_employees still apply.
create or replace function public.hr_change_employee_assignment(
  p_employee uuid, p_category text, p_effective_date date, p_reason text,
  p_department uuid default null, p_designation uuid default null, p_grade uuid default null,
  p_legal_entity uuid default null, p_manager uuid default null, p_clear_manager boolean default false,
  p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.hr_employees;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_dep uuid; v_des uuid; v_grade uuid; v_le uuid; v_mgr uuid; v_status text;
  v_changes jsonb := '{}'::jsonb;
  v_event uuid;
  v_max_hist bigint;
  v_today date := hr_private.business_today();
  v_actor uuid := hr_private.current_employee_id();
  v_rows int;
begin
  if not hr_private.has_permission('employees.edit') then
    perform hr_private.fail('You are not allowed to change employee assignments.', 'forbidden');
  end if;
  select * into e from public.hr_employees where id = p_employee for update;
  if not found then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if v_actor is not null and v_actor = p_employee and not hr_private.has_role('super_admin') then
    perform hr_private.fail('You cannot change your own employment record. Ask another HR administrator.', 'self_change');
  end if;
  if e.status in ('exited','archived') and coalesce(p_category, '') <> 'reactivation' then
    perform hr_private.fail('This employee is no longer current. Reactivate the record first.', 'employee_not_current');
  end if;
  if p_category is null or p_category not in ('promotion','demotion','transfer','designation_change','manager_change',
                                              'probation_start','confirmation','status_change','reactivation','correction') then
    perform hr_private.fail('Choose a valid change type.', 'invalid_category');
  end if;
  if length(v_reason) < 3 or length(v_reason) > 1000 then
    perform hr_private.fail('A reason (3–1000 characters) is required for every employment change.', 'reason_required');
  end if;
  if p_effective_date is null then perform hr_private.fail('An effective date is required.', 'effective_date_required'); end if;
  if p_effective_date > v_today then
    perform hr_private.fail('Future-dated changes are not supported yet. Record the change on or after its effective date.', 'future_effective_date');
  end if;
  if e.joining_date is not null and p_effective_date < e.joining_date then
    perform hr_private.fail('The effective date cannot be before the joining date.', 'effective_before_joining');
  end if;

  v_dep    := coalesce(p_department, e.department_id);
  v_des    := coalesce(p_designation, e.designation_id);
  v_grade  := coalesce(p_grade, e.grade_id);
  v_le     := coalesce(p_legal_entity, e.legal_entity_id);
  v_mgr    := case when p_clear_manager then null else coalesce(p_manager, e.manager_id) end;
  v_status := coalesce(p_status, e.status);

  if p_status is not null and p_status not in ('onboarding','probation','active','suspended','archived') then
    perform hr_private.fail('Notice period and exit are recorded through Exit Management.', 'use_exit_workflow');
  end if;
  if v_mgr is not null and v_mgr = p_employee then
    perform hr_private.fail('An employee cannot report to themselves.', 'self_manager');
  end if;
  if p_category = 'reactivation' and not (e.status in ('suspended','archived') and v_status in ('onboarding','probation','active')) then
    perform hr_private.fail('Reactivation applies to suspended or archived employees and must set a current status.', 'invalid_change');
  end if;

  -- Readable before/after values for the event.
  if v_dep is distinct from e.department_id then
    v_changes := v_changes || jsonb_build_object('department', jsonb_build_object(
      'from', (select name from public.hr_departments where id = e.department_id), 'to', (select name from public.hr_departments where id = v_dep)));
  end if;
  if v_des is distinct from e.designation_id then
    v_changes := v_changes || jsonb_build_object('designation', jsonb_build_object(
      'from', (select name from public.hr_designations where id = e.designation_id), 'to', (select name from public.hr_designations where id = v_des)));
  end if;
  if v_grade is distinct from e.grade_id then
    v_changes := v_changes || jsonb_build_object('grade', jsonb_build_object(
      'from', (select name from public.hr_grades where id = e.grade_id), 'to', (select name from public.hr_grades where id = v_grade)));
  end if;
  if v_le is distinct from e.legal_entity_id then
    v_changes := v_changes || jsonb_build_object('legal_entity', jsonb_build_object(
      'from', (select name from public.hr_legal_entities where id = e.legal_entity_id), 'to', (select name from public.hr_legal_entities where id = v_le)));
  end if;
  if v_mgr is distinct from e.manager_id then
    v_changes := v_changes || jsonb_build_object('manager', jsonb_build_object(
      'from', (select nullif(btrim(coalesce(display_name, first_name || ' ' || last_name)), '') || ' (' || employee_code || ')' from public.hr_employees where id = e.manager_id),
      'to',   (select nullif(btrim(coalesce(display_name, first_name || ' ' || last_name)), '') || ' (' || employee_code || ')' from public.hr_employees where id = v_mgr)));
  end if;
  if v_status is distinct from e.status then
    v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('from', e.status, 'to', v_status));
  end if;

  if v_changes = '{}'::jsonb then
    perform hr_private.fail('Nothing to change: the new values match the current record.', 'no_change');
  end if;

  -- The change type must describe what actually changes.
  if (p_category in ('promotion','demotion') and not (v_changes ? 'designation' or v_changes ? 'grade'))
  or (p_category = 'transfer' and not (v_changes ? 'department' or v_changes ? 'legal_entity'))
  or (p_category = 'designation_change' and not (v_changes ? 'designation'))
  or (p_category = 'manager_change' and not (v_changes ? 'manager'))
  or (p_category = 'probation_start' and not (e.status = 'onboarding' and v_status = 'probation'))
  or (p_category = 'confirmation' and not (e.status in ('onboarding','probation') and v_status = 'active'))
  or (p_category = 'status_change' and not (v_changes ? 'status')) then
    perform hr_private.fail('The change type does not match the values being changed.', 'category_mismatch');
  end if;

  insert into public.hr_employee_change_events (employee_id, category, effective_date, reason, changes, changed_by, changed_by_employee)
  values (p_employee, p_category, p_effective_date, v_reason, v_changes, auth.uid(), v_actor)
  returning id into v_event;

  select coalesce(max(id), 0) into v_max_hist from public.hr_employee_history;

  -- Caller identity (auth.uid) is kept, so the access/exit/archive guards apply.
  update public.hr_employees set
    department_id = v_dep, designation_id = v_des, grade_id = v_grade, legal_entity_id = v_le,
    manager_id = v_mgr, status = v_status,
    confirmation_date = case when p_category = 'confirmation' then p_effective_date else confirmation_date end,
    archived_at = case when v_status = 'archived' and e.status <> 'archived' then now()
                       when v_status <> 'archived' then null else archived_at end
  where id = p_employee;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then perform hr_private.fail('The employee record could not be updated.', 'update_failed'); end if;

  -- Attach the field-level rows the triggers just wrote to this event.
  perform set_config('hr.history_annotate', 'on', true);
  update public.hr_employee_history
     set event_id = v_event, effective_date = p_effective_date, note = v_reason
   where employee_id = p_employee and id > v_max_hist and event_id is null;
  perform set_config('hr.history_annotate', 'off', true);

  perform hr_private.notify_employee(p_employee, 'employment_change',
    'Your employment record was updated',
    initcap(replace(p_category, '_', ' ')) || ' effective ' || to_char(p_effective_date, 'DD Mon YYYY') || '.',
    '/employee/profile', 'hr_employee_change_events', v_event::text);

  return jsonb_build_object('event_id', v_event, 'changes', v_changes);
end $$;

-- ---------------------------------------------------------------------
-- Employment timeline (events + field-level history, with actor names)
-- ---------------------------------------------------------------------
create or replace function public.hr_employee_timeline(p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not hr_private.can_access_employee(p_employee, 'employees') then
    perform hr_private.fail('You are not allowed to view this employee''s history.', 'forbidden');
  end if;
  with actors as (
    select h.changed_by as uid from public.hr_employee_history h where h.employee_id = p_employee and h.changed_by is not null
    union select ev.changed_by from public.hr_employee_change_events ev where ev.employee_id = p_employee and ev.changed_by is not null
  ), names as (
    select a.uid, (select nullif(btrim(coalesce(x.display_name, x.first_name || ' ' || x.last_name)), '') || ' (' || x.employee_code || ')'
                     from public.hr_employees x where x.user_id = a.uid limit 1) as name
    from actors a
  ), items as (
    select 'event'::text as kind, ev.id::text as id, ev.category as type, ev.effective_date, ev.changed_at as recorded_at,
           ev.reason, ev.changes, null::text as old_value, null::text as new_value,
           coalesce(n.name, case when ev.changed_by is null then 'System' else 'HR administrator' end) as actor
      from public.hr_employee_change_events ev left join names n on n.uid = ev.changed_by
     where ev.employee_id = p_employee
    union all
    select 'history', h.id::text, h.change_type, h.effective_date, h.changed_at, h.note, null::jsonb, h.old_value, h.new_value,
           coalesce(n.name, case when h.changed_by is null then 'System' else 'HR administrator' end)
      from public.hr_employee_history h left join names n on n.uid = h.changed_by
     where h.employee_id = p_employee and h.event_id is null
  )
  select coalesce(jsonb_agg(to_jsonb(i) order by i.effective_date desc, i.recorded_at desc), '[]'::jsonb) into v
    from (select * from items order by effective_date desc, recorded_at desc limit 500) i;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Directory summary (caller's RLS decides which employees are counted)
-- ---------------------------------------------------------------------
create or replace function public.hr_employee_summary(p_department uuid default null, p_designation uuid default null, p_manager uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total',         count(*),
    'current',       count(*) filter (where status not in ('exited','archived')),
    'active',        count(*) filter (where status = 'active'),
    'onboarding',    count(*) filter (where status = 'onboarding'),
    'probation',     count(*) filter (where status = 'probation'),
    'notice_period', count(*) filter (where status = 'notice_period'),
    'suspended',     count(*) filter (where status = 'suspended'),
    'inactive',      count(*) filter (where status in ('exited','archived','suspended')),
    'exited',        count(*) filter (where status = 'exited'),
    'archived',      count(*) filter (where status = 'archived'),
    'joined_30d',    count(*) filter (where joining_date >= current_date - 30))
  from public.hr_employees
  where (p_department is null or department_id = p_department)
    and (p_designation is null or designation_id = p_designation)
    and (p_manager is null or manager_id = p_manager)
$$;

revoke execute on function public.hr_change_employee_assignment(uuid, text, date, text, uuid, uuid, uuid, uuid, uuid, boolean, text) from anon, public;
revoke execute on function public.hr_employee_timeline(uuid) from anon, public;
revoke execute on function public.hr_employee_summary(uuid, uuid, uuid) from anon, public;
grant execute on function public.hr_change_employee_assignment(uuid, text, date, text, uuid, uuid, uuid, uuid, uuid, boolean, text) to authenticated;
grant execute on function public.hr_employee_timeline(uuid) to authenticated;
grant execute on function public.hr_employee_summary(uuid, uuid, uuid) to authenticated;
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

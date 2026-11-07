-- =====================================================================
-- 206_hr_performance_module.sql — Performance & KPI module (HR page
-- /hr/performance, Employee Portal /employee/performance).
-- =====================================================================
-- Builds on 106_hr_performance.sql (cycles, KPI definitions, goals, reviews,
-- feedback, improvement plans). Adds only what the module needs:
--
--   * KPI templates: category, default target, measurement notes.
--   * Cycles: 'half_yearly' cycle type; hr_close_review_cycle().
--   * Goals: due date, agreement stamp, last progress; progress updates
--     (hr_goal_progress_updates, hr_record_goal_progress) and goal-sheet
--     approval (hr_agree_goal_sheet) that requires the employee's weights in
--     the cycle to total exactly 100.
--   * Reviews: new 'calibration' stage between the manager assessment and HR
--     finalization; calibration notes; HR can return a review to the manager.
--       not_started -> self_review -> manager_review -> calibration -> finalized
--                                       ^------- returned by HR ------|
--   * Review meetings (hr_performance_meetings) with attendees and notes.
--   * Improvement plans (PIP): title / success criteria, check-ins
--     (hr_improvement_plan_checkins), outcome via hr_close_improvement_plan,
--     employee acknowledgement.
--   * Read RPCs for the Employee Portal that resolve names the employee may not
--     read directly (meeting attendees, feedback authors).
--
-- Access (unchanged model from 106):
--   employee            -> own records only (reviews via hr_my_performance_reviews)
--   performance.view_team / review_team (Manager) -> reporting line only
--   performance.view / manage (HR Admin)          -> everyone
--   Separation of duties: nobody assesses, calibrates or finalizes their own
--   review (hr_private.can_act_on_employee excludes the caller).
-- Writes to every new table are RPC-only. Every new table is audited.
--
-- Idempotent / re-runnable: no table data is dropped or rewritten.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns and constraints on 106 tables
-- ---------------------------------------------------------------------
alter table public.hr_kpi_definitions
  add column if not exists category       text check (category is null or length(category) <= 80),
  add column if not exists default_target numeric,
  add column if not exists measurement    text check (measurement is null or length(measurement) <= 2000);

alter table public.hr_goals
  add column if not exists due_date         date,
  add column if not exists agreed_at        timestamptz,
  add column if not exists agreed_by        uuid references public.hr_employees(id) on delete set null,
  add column if not exists last_progress_at timestamptz;

alter table public.hr_performance_reviews
  add column if not exists calibration_notes text check (calibration_notes is null or length(calibration_notes) <= 5000),
  add column if not exists returned_at       timestamptz,
  add column if not exists return_reason     text check (return_reason is null or length(return_reason) <= 2000);

alter table public.hr_improvement_plans
  add column if not exists title                    text check (title is null or length(btrim(title)) between 2 and 200),
  add column if not exists success_criteria         text check (success_criteria is null or length(success_criteria) <= 5000),
  add column if not exists closed_at                timestamptz,
  add column if not exists closed_by                uuid references public.hr_employees(id) on delete set null,
  add column if not exists employee_acknowledged_at timestamptz,
  add column if not exists employee_comment         text check (employee_comment is null or length(employee_comment) <= 4000);

alter table public.hr_review_cycles drop constraint if exists hr_review_cycles_cycle_type_check;
alter table public.hr_review_cycles add constraint hr_review_cycles_cycle_type_check
  check (cycle_type in ('monthly','quarterly','half_yearly','annual','intern'));

alter table public.hr_performance_reviews drop constraint if exists hr_performance_reviews_status_check;
alter table public.hr_performance_reviews add constraint hr_performance_reviews_status_check
  check (status in ('not_started','self_review','manager_review','calibration','finalized'));

alter table public.hr_improvement_plans drop constraint if exists hr_improvement_plans_status_check;
alter table public.hr_improvement_plans add constraint hr_improvement_plans_status_check
  check (status in ('active','extended','completed','failed','cancelled'));

create index if not exists hr_improvement_plans_status on public.hr_improvement_plans(status, end_date);

-- ---------------------------------------------------------------------
-- 2. New tables
-- ---------------------------------------------------------------------
create table if not exists public.hr_goal_progress_updates (
  id             uuid primary key default gen_random_uuid(),
  goal_id        uuid not null references public.hr_goals(id) on delete cascade,
  employee_id    uuid not null references public.hr_employees(id) on delete restrict,
  previous_value numeric,
  actual_value   numeric not null,
  score          numeric(6,2),
  note           text check (note is null or length(note) <= 2000),
  recorded_by    uuid references public.hr_employees(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists hr_goal_progress_updates_goal on public.hr_goal_progress_updates(goal_id, created_at desc);
create index if not exists hr_goal_progress_updates_emp on public.hr_goal_progress_updates(employee_id, created_at desc);

create table if not exists public.hr_performance_meetings (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.hr_employees(id) on delete restrict,
  review_id        uuid references public.hr_performance_reviews(id) on delete set null,
  cycle_id         uuid references public.hr_review_cycles(id) on delete set null,
  meeting_type     text not null default 'review' check (meeting_type in ('review','check_in','calibration','pip','other')),
  scheduled_at     timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 480),
  mode             text not null default 'in_person' check (mode in ('in_person','video','phone')),
  location         text check (location is null or length(location) <= 300),
  attendee_ids     uuid[] not null default '{}',
  agenda           text check (agenda is null or length(agenda) <= 4000),
  notes            text check (notes is null or length(notes) <= 10000),
  action_items     text check (action_items is null or length(action_items) <= 4000),
  status           text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  cancel_reason    text check (cancel_reason is null or length(cancel_reason) <= 1000),
  completed_at     timestamptz,
  organizer_id     uuid references public.hr_employees(id) on delete set null,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists hr_performance_meetings_emp on public.hr_performance_meetings(employee_id, scheduled_at desc);
create index if not exists hr_performance_meetings_when on public.hr_performance_meetings(status, scheduled_at);

create table if not exists public.hr_improvement_plan_checkins (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.hr_improvement_plans(id) on delete cascade,
  employee_id  uuid not null references public.hr_employees(id) on delete restrict,
  checkin_date date not null,
  progress     text not null check (progress in ('on_track','at_risk','off_track')),
  notes        text not null check (length(btrim(notes)) between 1 and 4000),
  recorded_by  uuid references public.hr_employees(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists hr_improvement_plan_checkins_plan on public.hr_improvement_plan_checkins(plan_id, checkin_date desc);

drop trigger if exists hr_performance_meetings_touch on public.hr_performance_meetings;
create trigger hr_performance_meetings_touch before update on public.hr_performance_meetings
  for each row execute function hr_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. Read helper (used by RLS policies; executable by authenticated)
-- ---------------------------------------------------------------------
-- Self, performance.view, performance.manage, or view_team for the reporting line.
create or replace function hr_private.perf_can_see_employee(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_employee is not null
     and (hr_private.can_access_employee(p_employee, 'performance') or hr_private.has_permission('performance.manage'))
$$;
revoke execute on function hr_private.perf_can_see_employee(uuid) from anon, public;
grant execute on function hr_private.perf_can_see_employee(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Guard triggers
-- ---------------------------------------------------------------------
-- Goals: agreement / progress stamps are maintained by the server; an agreed
-- goal's due date is changed only by a manager / HR.
create or replace function hr_private.perf_goals_guard_tracking()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or current_setting('hr.perf_rpc', true) is not distinct from 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.last_progress_at := case when new.actual_value is not null then now() end;
    if new.status <> 'draft' then
      new.agreed_at := now(); new.agreed_by := hr_private.current_employee_id();
    else
      new.agreed_at := null; new.agreed_by := null;
    end if;
    return new;
  end if;
  new.agreed_at := old.agreed_at;
  new.agreed_by := old.agreed_by;
  new.last_progress_at := old.last_progress_at;
  if old.status = 'draft' and new.status <> 'draft' then
    new.agreed_at := now(); new.agreed_by := hr_private.current_employee_id();
  end if;
  if new.actual_value is distinct from old.actual_value then new.last_progress_at := now(); end if;
  if new.due_date is distinct from old.due_date and old.status <> 'draft'
     and not hr_private.can_manage_performance_of(new.employee_id) then
    perform hr_private.fail('Only your manager or HR can change the due date of an agreed goal.', 'forbidden');
  end if;
  return new;
end $$;
drop trigger if exists hr_goals_guard_tracking on public.hr_goals;
-- Name sorts after hr_goals_before_write (106), so it runs second.
create trigger hr_goals_guard_tracking before insert or update on public.hr_goals
  for each row execute function hr_private.perf_goals_guard_tracking();

-- Improvement plans: status / outcome / acknowledgement change only through
-- the RPCs below; new plans start active.
create or replace function hr_private.perf_improvement_plans_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or current_setting('hr.perf_rpc', true) is not distinct from 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      perform hr_private.fail('A new improvement plan starts as active.', 'invalid_state');
    end if;
    new.owner_id := coalesce(new.owner_id, hr_private.current_employee_id());
    if new.owner_id = new.employee_id then new.owner_id := null; end if;
    new.closed_at := null; new.closed_by := null;
    new.employee_acknowledged_at := null; new.employee_comment := null;
    return new;
  end if;
  if new.employee_id is distinct from old.employee_id then
    perform hr_private.fail('An improvement plan cannot be moved to another employee.', 'immutable');
  end if;
  if new.status is distinct from old.status or new.outcome_notes is distinct from old.outcome_notes then
    perform hr_private.fail('Use Record outcome to extend or close an improvement plan.', 'use_rpc');
  end if;
  if old.status in ('completed','failed','cancelled') then
    perform hr_private.fail('This improvement plan is closed.', 'invalid_state');
  end if;
  new.closed_at := old.closed_at; new.closed_by := old.closed_by;
  new.employee_acknowledged_at := old.employee_acknowledged_at; new.employee_comment := old.employee_comment;
  return new;
end $$;
drop trigger if exists hr_improvement_plans_guard on public.hr_improvement_plans;
create trigger hr_improvement_plans_guard before insert or update on public.hr_improvement_plans
  for each row execute function hr_private.perf_improvement_plans_guard();

-- ---------------------------------------------------------------------
-- 5. RLS on new tables (read policies only; writes are RPC-only)
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_goal_progress_updates');
select hr_private.secure_table('public.hr_performance_meetings');
select hr_private.secure_table('public.hr_improvement_plan_checkins');

grant select on public.hr_goal_progress_updates, public.hr_performance_meetings, public.hr_improvement_plan_checkins to authenticated;
revoke insert, update, delete, truncate on public.hr_goal_progress_updates, public.hr_performance_meetings,
  public.hr_improvement_plan_checkins from authenticated;

drop policy if exists hr_goal_progress_updates_read on public.hr_goal_progress_updates;
create policy hr_goal_progress_updates_read on public.hr_goal_progress_updates for select to authenticated
  using (hr_private.perf_can_see_employee(employee_id));

drop policy if exists hr_performance_meetings_read on public.hr_performance_meetings;
create policy hr_performance_meetings_read on public.hr_performance_meetings for select to authenticated
  using (hr_private.perf_can_see_employee(employee_id)
         or (hr_private.current_employee_id() is not null and hr_private.current_employee_id() = any (attendee_ids)));

drop policy if exists hr_improvement_plan_checkins_read on public.hr_improvement_plan_checkins;
create policy hr_improvement_plan_checkins_read on public.hr_improvement_plan_checkins for select to authenticated
  using (hr_private.perf_can_see_employee(employee_id)
         or exists (select 1 from public.hr_improvement_plans p
                    where p.id = plan_id and p.owner_id = hr_private.current_employee_id()));

select hr_private.enable_audit('public.hr_goal_progress_updates');
select hr_private.enable_audit('public.hr_performance_meetings');
select hr_private.enable_audit('public.hr_improvement_plan_checkins');

-- ---------------------------------------------------------------------
-- 6. Review cycles
-- ---------------------------------------------------------------------
create or replace function public.hr_close_review_cycle(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.hr_review_cycles; v_open int;
begin
  if not hr_private.has_permission('performance.manage') then
    perform hr_private.fail('You are not allowed to manage review cycles.', 'forbidden');
  end if;
  select * into c from public.hr_review_cycles where id = p_cycle for update;
  if c.id is null then perform hr_private.fail('Review cycle not found.', 'not_found'); end if;
  if c.status = 'closed' then perform hr_private.fail('This review cycle is already closed.', 'invalid_state'); end if;
  if c.status = 'draft' then perform hr_private.fail('A draft cycle has not started; edit or start it instead.', 'invalid_state'); end if;
  select count(*) into v_open from public.hr_performance_reviews where cycle_id = p_cycle and status <> 'finalized';
  update public.hr_review_cycles set status = 'closed' where id = p_cycle;
  return jsonb_build_object('cycle_id', p_cycle, 'unfinalized_reviews', v_open);
end $$;

-- ---------------------------------------------------------------------
-- 7. Goals: goal-sheet approval and progress updates
-- ---------------------------------------------------------------------
-- Manager / HR approves an employee's goal sheet for a cycle: the weights must
-- total exactly 100; draft goals become agreed.
create or replace function public.hr_agree_goal_sheet(p_employee uuid, p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_status text; v_total numeric; v_n int; v_agreed int;
begin
  if not hr_private.can_manage_performance_of(p_employee) then
    perform hr_private.fail('You are not allowed to approve goals for this employee.', 'forbidden');
  end if;
  select status into v_status from public.hr_review_cycles where id = p_cycle;
  if v_status is null then perform hr_private.fail('Review cycle not found.', 'not_found'); end if;
  if v_status = 'closed' then perform hr_private.fail('This review cycle is closed; goals can no longer change.', 'cycle_closed'); end if;
  perform pg_advisory_xact_lock(hashtext('hr_goals:' || p_employee || ':' || p_cycle));
  select coalesce(sum(weight), 0), count(*) into v_total, v_n
    from public.hr_goals where employee_id = p_employee and cycle_id = p_cycle;
  if v_n = 0 then perform hr_private.fail('Add at least one goal before approving the goal sheet.', 'no_goals'); end if;
  if v_total <> 100 then
    perform hr_private.fail(format('Goal weights total %s%%; they must total exactly 100%% before the goal sheet can be approved.', v_total), 'weight_not_100');
  end if;
  perform set_config('hr.perf_rpc', 'on', true);
  update public.hr_goals set status = 'agreed', agreed_at = now(), agreed_by = hr_private.current_employee_id()
   where employee_id = p_employee and cycle_id = p_cycle and status = 'draft';
  get diagnostics v_agreed = row_count;
  perform set_config('hr.perf_rpc', 'off', true);
  if v_agreed > 0 then
    perform hr_private.notify_employee(p_employee, 'goal_sheet_agreed', 'Your goals have been agreed',
      v_n || ' goal(s), weights total 100%.', '/employee/performance', 'hr_review_cycles', p_cycle::text);
  end if;
  return jsonb_build_object('goals', v_n, 'agreed', v_agreed, 'total_weight', v_total);
end $$;

-- Record progress (actual value) on an agreed goal. Employee: own goals while
-- the cycle is active. Manager / HR: reporting line / everyone.
create or replace function public.hr_record_goal_progress(p_goal uuid, p_actual numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.hr_goals; v_me uuid := hr_private.current_employee_id(); v_manage boolean; v_cycle text;
        v_score numeric; v_mgr uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into g from public.hr_goals where id = p_goal for update;
  if g.id is null then perform hr_private.fail('Goal not found.', 'not_found'); end if;
  v_manage := hr_private.can_manage_performance_of(g.employee_id);
  if not (g.employee_id = v_me or v_manage) then perform hr_private.fail('Goal not found.', 'not_found'); end if;
  select status into v_cycle from public.hr_review_cycles where id = g.cycle_id;
  if v_cycle <> 'active' then perform hr_private.fail('Progress can be recorded only while the review cycle is active.', 'cycle_not_active'); end if;
  if g.status = 'draft' then perform hr_private.fail('Progress can be recorded once the goal is agreed.', 'invalid_state'); end if;
  if g.status in ('achieved','missed') then perform hr_private.fail('This goal has been closed.', 'invalid_state'); end if;
  if p_actual is null then perform hr_private.fail('Enter the current actual value.', 'invalid'); end if;
  if v_note is not null and length(v_note) > 2000 then perform hr_private.fail('The note is too long (2000 characters max).', 'invalid'); end if;

  perform set_config('hr.perf_rpc', 'on', true);
  update public.hr_goals
     set actual_value = p_actual, last_progress_at = now(),
         status = case when status = 'agreed' then 'in_progress' else status end
   where id = p_goal
  returning score into v_score;
  perform set_config('hr.perf_rpc', 'off', true);

  insert into public.hr_goal_progress_updates (goal_id, employee_id, previous_value, actual_value, score, note, recorded_by)
  values (g.id, g.employee_id, g.actual_value, p_actual, v_score, v_note, v_me);

  if v_me = g.employee_id then
    select manager_id into v_mgr from public.hr_employees where id = g.employee_id;
    perform hr_private.notify_employee(v_mgr, 'goal_progress', 'Goal progress updated', left(g.title, 200),
      '/hr/performance?tab=goals', 'hr_goals', g.id::text);
  else
    perform hr_private.notify_employee(g.employee_id, 'goal_progress', 'Progress recorded on your goal', left(g.title, 200),
      '/employee/performance', 'hr_goals', g.id::text);
  end if;
  return jsonb_build_object('goal_id', g.id, 'actual_value', p_actual, 'score', v_score);
end $$;

-- ---------------------------------------------------------------------
-- 8. Reviews: manager assessment -> calibration -> finalize / return
-- ---------------------------------------------------------------------
-- Same rules as 106; the review now moves to 'calibration' for HR.
create or replace function public.hr_submit_manager_assessment(p_review uuid, p_assessment text, p_rating integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_performance_reviews; c public.hr_review_cycles; v_me uuid := hr_private.current_employee_id(); v_name text;
begin
  select * into v from public.hr_performance_reviews where id = p_review for update;
  if v.id is null then perform hr_private.fail('Review not found.', 'not_found'); end if;
  if v.employee_id = v_me then perform hr_private.fail('You cannot write the manager assessment for your own review.', 'forbidden'); end if;
  if not hr_private.can_manage_performance_of(v.employee_id) then
    perform hr_private.fail('You are not allowed to review this employee.', 'forbidden');
  end if;
  select * into c from public.hr_review_cycles where id = v.cycle_id;
  if c.status <> 'active' then perform hr_private.fail('This review cycle is not open.', 'cycle_not_active'); end if;
  if v.status = 'finalized' then perform hr_private.fail('This review has already been finalized.', 'invalid_state'); end if;
  if v.self_submitted_at is null and (c.self_assessment_due is null or c.self_assessment_due >= hr_private.business_today()) then
    perform hr_private.fail('The employee has not submitted their self-assessment yet.', 'awaiting_self_assessment');
  end if;
  if p_rating is null or p_rating not between 1 and 5 then perform hr_private.fail('Choose a rating from 1 to 5.', 'invalid'); end if;
  if nullif(btrim(p_assessment), '') is null then perform hr_private.fail('Write the manager assessment.', 'invalid'); end if;
  if length(p_assessment) > 10000 then perform hr_private.fail('The assessment is too long (10000 characters max).', 'invalid'); end if;
  update public.hr_performance_reviews
     set manager_assessment = btrim(p_assessment), manager_rating = p_rating, manager_submitted_at = now(),
         manager_id = coalesce(v_me, manager_id), status = 'calibration'
   where id = p_review;
  select coalesce(display_name, first_name || ' ' || last_name) into v_name from public.hr_employees where id = v.employee_id;
  perform hr_private.notify_permission_holders('performance.manage', 'review_ready_for_calibration', 'Review ready for calibration',
    coalesce(v_name, 'An employee') || ' — ' || c.name, '/hr/performance?tab=reviews', 'hr_performance_reviews', p_review::text, v.employee_id);
end $$;

-- Replaces the 2-argument 106 version (callers passing p_review / p_final_rating keep working).
drop function if exists public.hr_finalize_performance_review(uuid, numeric);
create or replace function public.hr_finalize_performance_review(p_review uuid, p_final_rating numeric, p_calibration_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_performance_reviews; v_goal numeric;
begin
  if not hr_private.has_permission('performance.manage') then
    perform hr_private.fail('You are not allowed to finalize reviews.', 'forbidden');
  end if;
  select * into v from public.hr_performance_reviews where id = p_review for update;
  if v.id is null then perform hr_private.fail('Review not found.', 'not_found'); end if;
  if v.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot finalize your own review.', 'forbidden'); end if;
  if v.status = 'finalized' then perform hr_private.fail('This review has already been finalized.', 'invalid_state'); end if;
  if v.manager_submitted_at is null and v.manager_id is not null then
    perform hr_private.fail('The manager assessment is still pending.', 'awaiting_manager');
  end if;
  if p_final_rating is null or p_final_rating not between 1 and 5 then perform hr_private.fail('Final rating must be between 1 and 5.', 'invalid'); end if;
  if p_calibration_notes is not null and length(p_calibration_notes) > 5000 then
    perform hr_private.fail('Calibration notes are too long (5000 characters max).', 'invalid');
  end if;
  select round(sum(score * weight) / nullif(sum(weight), 0), 2) into v_goal
    from public.hr_goals where employee_id = v.employee_id and cycle_id = v.cycle_id and score is not null and weight > 0;
  update public.hr_performance_reviews
     set final_rating = round(p_final_rating, 2), calibrated_by = hr_private.current_employee_id(), finalized_at = now(),
         status = 'finalized', goal_score = coalesce(v_goal, goal_score),
         calibration_notes = coalesce(nullif(btrim(p_calibration_notes), ''), calibration_notes)
   where id = p_review;
  perform hr_private.notify_employee(v.employee_id, 'review_finalized', 'Your performance review is available',
    null, '/employee/performance', 'hr_performance_reviews', p_review::text);
end $$;

-- HR sends a review in calibration back to the manager.
create or replace function public.hr_return_performance_review(p_review uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_performance_reviews; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not hr_private.has_permission('performance.manage') then
    perform hr_private.fail('You are not allowed to calibrate reviews.', 'forbidden');
  end if;
  select * into v from public.hr_performance_reviews where id = p_review for update;
  if v.id is null then perform hr_private.fail('Review not found.', 'not_found'); end if;
  if v.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot calibrate your own review.', 'forbidden'); end if;
  if v.status <> 'calibration' then perform hr_private.fail('Only a review in calibration can be returned to the manager.', 'invalid_state'); end if;
  if v_reason is null then perform hr_private.fail('Give a reason for returning the review.', 'invalid'); end if;
  update public.hr_performance_reviews
     set status = 'manager_review', manager_submitted_at = null, returned_at = now(), return_reason = left(v_reason, 2000)
   where id = p_review;
  perform hr_private.notify_employee(v.manager_id, 'review_returned', 'A review was returned for changes', left(v_reason, 200),
    '/hr/performance?tab=reviews', 'hr_performance_reviews', p_review::text);
end $$;

-- ---------------------------------------------------------------------
-- 9. Review meetings
-- ---------------------------------------------------------------------
create or replace function public.hr_save_review_meeting(
  p_meeting uuid, p_employee uuid, p_scheduled_at timestamptz,
  p_review uuid default null, p_meeting_type text default 'review', p_duration_minutes integer default 30,
  p_mode text default 'in_person', p_location text default null, p_attendees uuid[] default '{}', p_agenda text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.hr_performance_meetings; v_emp uuid := p_employee; v_cycle uuid; v_att uuid[]; v_id uuid; a uuid;
begin
  if p_meeting is not null then
    select * into m from public.hr_performance_meetings where id = p_meeting for update;
    if m.id is null then perform hr_private.fail('Meeting not found.', 'not_found'); end if;
    v_emp := m.employee_id;
    if m.status <> 'scheduled' then perform hr_private.fail('Only a scheduled meeting can be edited.', 'invalid_state'); end if;
  end if;
  if not hr_private.can_manage_performance_of(v_emp) then
    perform hr_private.fail('You are not allowed to schedule meetings for this employee.', 'forbidden');
  end if;
  if p_scheduled_at is null then perform hr_private.fail('Choose the meeting date and time.', 'invalid'); end if;
  if p_meeting_type not in ('review','check_in','calibration','pip','other') then perform hr_private.fail('Unknown meeting type.', 'invalid'); end if;
  if p_mode not in ('in_person','video','phone') then perform hr_private.fail('Unknown meeting mode.', 'invalid'); end if;
  if p_duration_minutes is null or p_duration_minutes not between 5 and 480 then perform hr_private.fail('Duration must be 5 to 480 minutes.', 'invalid'); end if;
  if p_review is not null then
    select cycle_id into v_cycle from public.hr_performance_reviews where id = p_review and employee_id = v_emp;
    if v_cycle is null then perform hr_private.fail('That review belongs to a different employee.', 'invalid'); end if;
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_att from unnest(coalesce(p_attendees, '{}')) x where x is not null and x <> v_emp;
  if cardinality(v_att) > 20 then perform hr_private.fail('A meeting can have at most 20 attendees.', 'invalid'); end if;
  if exists (select 1 from unnest(v_att) x where not exists (
               select 1 from public.hr_employees e where e.id = x and e.status not in ('exited','archived'))) then
    perform hr_private.fail('An attendee is not an active employee.', 'invalid');
  end if;

  if p_meeting is null then
    insert into public.hr_performance_meetings (employee_id, review_id, cycle_id, meeting_type, scheduled_at, duration_minutes, mode,
                                                location, attendee_ids, agenda, organizer_id, created_by)
    values (v_emp, p_review, v_cycle, p_meeting_type, p_scheduled_at, p_duration_minutes, p_mode,
            nullif(btrim(coalesce(p_location, '')), ''), v_att, nullif(btrim(coalesce(p_agenda, '')), ''), hr_private.current_employee_id(), auth.uid())
    returning id into v_id;
  else
    update public.hr_performance_meetings
       set review_id = p_review, cycle_id = v_cycle, meeting_type = p_meeting_type, scheduled_at = p_scheduled_at,
           duration_minutes = p_duration_minutes, mode = p_mode, location = nullif(btrim(coalesce(p_location, '')), ''),
           attendee_ids = v_att, agenda = nullif(btrim(coalesce(p_agenda, '')), '')
     where id = p_meeting;
    v_id := p_meeting;
  end if;
  perform hr_private.notify_employee(v_emp, 'performance_meeting', 'Performance meeting ' || case when p_meeting is null then 'scheduled' else 'updated' end,
    to_char(p_scheduled_at at time zone hr_private.business_timezone(), 'DD Mon YYYY HH24:MI'), '/employee/performance?tab=meetings',
    'hr_performance_meetings', v_id::text);
  foreach a in array v_att loop
    perform hr_private.notify_employee(a, 'performance_meeting', 'You were added to a performance meeting',
      to_char(p_scheduled_at at time zone hr_private.business_timezone(), 'DD Mon YYYY HH24:MI'), '/hr/performance?tab=meetings',
      'hr_performance_meetings', v_id::text);
  end loop;
  return v_id;
end $$;

create or replace function public.hr_complete_review_meeting(p_meeting uuid, p_notes text, p_action_items text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.hr_performance_meetings;
begin
  select * into m from public.hr_performance_meetings where id = p_meeting for update;
  if m.id is null or not hr_private.can_manage_performance_of(m.employee_id) then
    perform hr_private.fail('Meeting not found.', 'not_found');
  end if;
  if m.status = 'cancelled' then perform hr_private.fail('This meeting was cancelled.', 'invalid_state'); end if;
  if nullif(btrim(coalesce(p_notes, '')), '') is null then perform hr_private.fail('Write the meeting notes.', 'invalid'); end if;
  if length(p_notes) > 10000 or length(coalesce(p_action_items, '')) > 4000 then perform hr_private.fail('The notes are too long.', 'invalid'); end if;
  update public.hr_performance_meetings
     set status = 'completed', notes = btrim(p_notes), action_items = nullif(btrim(coalesce(p_action_items, '')), ''),
         completed_at = coalesce(completed_at, now())
   where id = p_meeting;
  if m.status = 'scheduled' then
    perform hr_private.notify_employee(m.employee_id, 'performance_meeting', 'Meeting notes are available', null,
      '/employee/performance?tab=meetings', 'hr_performance_meetings', m.id::text);
  end if;
end $$;

create or replace function public.hr_cancel_review_meeting(p_meeting uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.hr_performance_meetings;
begin
  select * into m from public.hr_performance_meetings where id = p_meeting for update;
  if m.id is null or not hr_private.can_manage_performance_of(m.employee_id) then
    perform hr_private.fail('Meeting not found.', 'not_found');
  end if;
  if m.status <> 'scheduled' then perform hr_private.fail('Only a scheduled meeting can be cancelled.', 'invalid_state'); end if;
  update public.hr_performance_meetings set status = 'cancelled', cancel_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 1000)
   where id = p_meeting;
  perform hr_private.notify_employee(m.employee_id, 'performance_meeting', 'Performance meeting cancelled', left(p_reason, 200),
    '/employee/performance?tab=meetings', 'hr_performance_meetings', m.id::text);
end $$;

-- Meetings the caller may see, with names resolved (the employee portal cannot
-- read attendee records directly).
create or replace function public.hr_list_review_meetings(p_employee uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'employee_id', m.employee_id, 'employee_name', coalesce(e.display_name, e.first_name || ' ' || e.last_name),
      'employee_code', e.employee_code, 'review_id', m.review_id, 'cycle_id', m.cycle_id, 'cycle_name', c.name,
      'meeting_type', m.meeting_type, 'scheduled_at', m.scheduled_at, 'duration_minutes', m.duration_minutes, 'mode', m.mode,
      'location', m.location, 'agenda', m.agenda, 'notes', m.notes, 'action_items', m.action_items, 'status', m.status,
      'cancel_reason', m.cancel_reason, 'completed_at', m.completed_at, 'attendee_ids', to_jsonb(m.attendee_ids),
      'organizer_name', (select coalesce(o.display_name, o.first_name || ' ' || o.last_name) from public.hr_employees o where o.id = m.organizer_id),
      'attendees', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', coalesce(a.display_name, a.first_name || ' ' || a.last_name)) order by a.first_name)
                             from public.hr_employees a where a.id = any (m.attendee_ids)), '[]'::jsonb),
      'can_manage', hr_private.can_manage_performance_of(m.employee_id))
    order by m.scheduled_at desc), '[]'::jsonb)
  from public.hr_performance_meetings m
  join public.hr_employees e on e.id = m.employee_id
  left join public.hr_review_cycles c on c.id = m.cycle_id
  where (p_employee is null or m.employee_id = p_employee)
    and (hr_private.perf_can_see_employee(m.employee_id)
         or (hr_private.current_employee_id() is not null and hr_private.current_employee_id() = any (m.attendee_ids)))
$$;

-- ---------------------------------------------------------------------
-- 10. Improvement plans (PIP)
-- ---------------------------------------------------------------------
create or replace function public.hr_add_improvement_checkin(p_plan uuid, p_checkin_date date, p_progress text, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.hr_improvement_plans; v_id uuid; v_me uuid := hr_private.current_employee_id();
begin
  select * into p from public.hr_improvement_plans where id = p_plan for update;
  if p.id is null or not (hr_private.can_manage_performance_of(p.employee_id) or (v_me is not null and p.owner_id = v_me and p.employee_id <> v_me)) then
    perform hr_private.fail('Improvement plan not found.', 'not_found');
  end if;
  if p.status not in ('active','extended') then perform hr_private.fail('This improvement plan is closed.', 'invalid_state'); end if;
  if p_checkin_date is null or p_checkin_date < p.start_date then perform hr_private.fail('The check-in date must be on or after the plan start.', 'invalid'); end if;
  if p_checkin_date > hr_private.business_today() then perform hr_private.fail('A check-in cannot be dated in the future.', 'invalid'); end if;
  if p_progress not in ('on_track','at_risk','off_track') then perform hr_private.fail('Choose the progress status.', 'invalid'); end if;
  if nullif(btrim(coalesce(p_notes, '')), '') is null then perform hr_private.fail('Write the check-in notes.', 'invalid'); end if;
  if length(p_notes) > 4000 then perform hr_private.fail('The notes are too long (4000 characters max).', 'invalid'); end if;
  insert into public.hr_improvement_plan_checkins (plan_id, employee_id, checkin_date, progress, notes, recorded_by)
  values (p.id, p.employee_id, p_checkin_date, p_progress, btrim(p_notes), v_me)
  returning id into v_id;
  perform hr_private.notify_employee(p.employee_id, 'improvement_plan', 'Improvement plan check-in recorded',
    replace(p_progress, '_', ' '), '/employee/performance?tab=plans', 'hr_improvement_plans', p.id::text);
  return v_id;
end $$;

-- Outcome: 'extended' (needs a later end date) keeps the plan open;
-- 'completed' / 'failed' / 'cancelled' close it.
create or replace function public.hr_close_improvement_plan(p_plan uuid, p_outcome text, p_notes text, p_new_end_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.hr_improvement_plans; v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select * into p from public.hr_improvement_plans where id = p_plan for update;
  if p.id is null or not hr_private.can_manage_performance_of(p.employee_id) then
    perform hr_private.fail('Improvement plan not found.', 'not_found');
  end if;
  if p.status not in ('active','extended') then perform hr_private.fail('This improvement plan is already closed.', 'invalid_state'); end if;
  if p_outcome not in ('extended','completed','failed','cancelled') then perform hr_private.fail('Choose an outcome.', 'invalid'); end if;
  if v_notes is null then perform hr_private.fail('Write the outcome notes.', 'invalid'); end if;
  if length(v_notes) > 5000 then perform hr_private.fail('The notes are too long (5000 characters max).', 'invalid'); end if;
  perform set_config('hr.perf_rpc', 'on', true);
  if p_outcome = 'extended' then
    if p_new_end_date is null or p_new_end_date <= p.end_date then
      perform hr_private.fail('An extension needs a new end date after the current one.', 'invalid');
    end if;
    update public.hr_improvement_plans set status = 'extended', end_date = p_new_end_date,
           outcome_notes = concat_ws(E'\n', outcome_notes, 'Extended to ' || to_char(p_new_end_date, 'DD Mon YYYY') || ': ' || v_notes)
     where id = p_plan;
  else
    update public.hr_improvement_plans set status = p_outcome, outcome_notes = concat_ws(E'\n', outcome_notes, v_notes),
           closed_at = now(), closed_by = hr_private.current_employee_id()
     where id = p_plan;
  end if;
  perform set_config('hr.perf_rpc', 'off', true);
  perform hr_private.notify_employee(p.employee_id, 'improvement_plan', 'Improvement plan ' || case p_outcome when 'extended' then 'extended' else 'closed' end,
    left(v_notes, 200), '/employee/performance?tab=plans', 'hr_improvement_plans', p.id::text);
end $$;

-- The employee acknowledges their plan (once) with an optional comment.
create or replace function public.hr_acknowledge_improvement_plan(p_plan uuid, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.hr_improvement_plans; v_me uuid := hr_private.current_employee_id();
begin
  select * into p from public.hr_improvement_plans where id = p_plan for update;
  if p.id is null or v_me is null or p.employee_id <> v_me then perform hr_private.fail('Improvement plan not found.', 'not_found'); end if;
  if p.employee_acknowledged_at is not null then perform hr_private.fail('You have already acknowledged this plan.', 'already_acknowledged'); end if;
  if length(coalesce(p_comment, '')) > 4000 then perform hr_private.fail('The comment is too long (4000 characters max).', 'invalid'); end if;
  perform set_config('hr.perf_rpc', 'on', true);
  update public.hr_improvement_plans set employee_acknowledged_at = now(), employee_comment = nullif(btrim(coalesce(p_comment, '')), '')
   where id = p_plan;
  perform set_config('hr.perf_rpc', 'off', true);
  perform hr_private.notify_employee(p.owner_id, 'improvement_plan', 'Improvement plan acknowledged', null,
    '/hr/performance?tab=plans', 'hr_improvement_plans', p.id::text);
end $$;

-- ---------------------------------------------------------------------
-- 11. Employee portal: feedback shared with me (author names resolved)
-- ---------------------------------------------------------------------
create or replace function public.hr_my_performance_feedback()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'feedback_type', f.feedback_type, 'body', f.body, 'created_at', f.created_at, 'review_id', f.review_id,
      'from_name', coalesce(a.display_name, a.first_name || ' ' || a.last_name),
      'from_manager', f.from_employee_id = me.manager_id) order by f.created_at desc), '[]'::jsonb)
  from public.hr_performance_feedback f
  join public.hr_employees me on me.id = f.employee_id
  join public.hr_employees a on a.id = f.from_employee_id
  where f.employee_id = hr_private.current_employee_id() and f.visibility = 'manager_and_employee'
$$;

-- ---------------------------------------------------------------------
-- 12. Grants
-- ---------------------------------------------------------------------
-- Trigger functions: never callable by API roles (197 convention).
revoke execute on function hr_private.perf_goals_guard_tracking() from anon, public, authenticated;
revoke execute on function hr_private.perf_improvement_plans_guard() from anon, public, authenticated;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
             'hr_close_review_cycle','hr_agree_goal_sheet','hr_record_goal_progress','hr_submit_manager_assessment',
             'hr_finalize_performance_review','hr_return_performance_review','hr_save_review_meeting','hr_complete_review_meeting',
             'hr_cancel_review_meeting','hr_list_review_meetings','hr_add_improvement_checkin','hr_close_improvement_plan',
             'hr_acknowledge_improvement_plan','hr_my_performance_feedback'])
  loop
    execute format('revoke execute on function %s from anon, public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Guard: fail if a 206 trigger function is executable by an API role.
do $$
declare v text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'hr_private' and p.proname in ('perf_goals_guard_tracking','perf_improvement_plans_guard')
    and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'));
  if v is not null then raise exception '206: trigger functions executable by API roles: %', v; end if;
end $$;

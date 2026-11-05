-- =====================================================================
-- 106_hr_performance.sql — Review cycles, KPI definitions, goals with
-- configurable scoring, performance reviews, feedback, improvement plans.
-- =====================================================================
-- Builds on 100_hr_foundation.sql.
--
-- Scoring is driven ONLY by explicit KPI definitions and the targets/actuals
-- recorded on goals. Nothing here derives productivity from hours logged or
-- attendance.
--
-- Confidentiality: an employee sees their own goals, and their own review
-- only once finalized (hr_my_performance_reviews() shows their own
-- self-assessment earlier, with manager fields hidden until finalization).
-- Managers see their reporting line; performance.view / performance.manage
-- see everyone except their own unfinalized review.
-- =====================================================================

insert into public.hr_settings (key, value, description) values
  ('performance', jsonb_build_object('score_cap', 100),
   'Performance scoring: goal scores are clamped to 0..score_cap (percent achievement)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.hr_review_cycles (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique check (length(btrim(name)) between 2 and 120),
  cycle_type          text not null check (cycle_type in ('monthly','quarterly','annual','intern')),
  period_start        date not null,
  period_end          date not null,
  self_assessment_due date,
  manager_review_due  date,
  status              text not null default 'draft' check (status in ('draft','active','closed')),
  started_at          timestamptz,
  closed_at           timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (period_end >= period_start),
  check (manager_review_due is null or self_assessment_due is null or manager_review_due >= self_assessment_due)
);

create table public.hr_kpi_definitions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique check (length(btrim(name)) between 2 and 120),
  description    text,
  unit           text,                                   -- e.g. 'tickets', '%', 'hours to respond'
  direction      text not null default 'higher_is_better' check (direction in ('higher_is_better','lower_is_better','target_exact')),
  formula_type   text not null default 'ratio' check (formula_type in ('ratio','inverse_ratio','binary','manual')),
  default_weight numeric(5,2) not null default 0 check (default_weight between 0 and 100),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.hr_goals (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.hr_employees(id) on delete restrict,
  cycle_id     uuid not null references public.hr_review_cycles(id) on delete restrict,
  kpi_id       uuid references public.hr_kpi_definitions(id) on delete restrict,
  title        text not null check (length(btrim(title)) between 2 and 200),
  description  text,
  weight       numeric(5,2) not null default 0 check (weight between 0 and 100),
  target_value numeric,
  actual_value numeric,
  score        numeric(6,2),                             -- computed (0..score_cap), never client-set
  status       text not null default 'draft' check (status in ('draft','agreed','in_progress','achieved','missed')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index hr_goals_emp_cycle on public.hr_goals(employee_id, cycle_id);

create table public.hr_performance_reviews (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.hr_employees(id) on delete restrict,
  cycle_id             uuid not null references public.hr_review_cycles(id) on delete restrict,
  self_assessment      text,
  self_rating          smallint check (self_rating between 1 and 5),
  self_submitted_at    timestamptz,
  manager_id           uuid references public.hr_employees(id) on delete set null,
  manager_assessment   text,
  manager_rating       smallint check (manager_rating between 1 and 5),
  manager_submitted_at timestamptz,
  goal_score           numeric(6,2),
  final_rating         numeric(3,2) check (final_rating between 1 and 5),
  calibrated_by        uuid references public.hr_employees(id) on delete set null,
  finalized_at         timestamptz,
  status               text not null default 'not_started' check (status in ('not_started','self_review','manager_review','finalized')),
  is_confidential      boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (employee_id, cycle_id),
  check (status <> 'finalized' or (final_rating is not null and finalized_at is not null))
);
create index hr_performance_reviews_cycle on public.hr_performance_reviews(cycle_id, status);

create table public.hr_performance_feedback (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.hr_employees(id) on delete restrict,   -- subject
  review_id        uuid references public.hr_performance_reviews(id) on delete set null,
  from_employee_id uuid not null references public.hr_employees(id) on delete restrict,
  feedback_type    text not null check (feedback_type in ('praise','constructive','note')),
  body             text not null check (length(btrim(body)) between 1 and 5000),
  visibility       text not null default 'private_to_hr' check (visibility in ('private_to_hr','manager_and_employee')),
  created_at       timestamptz not null default now(),
  check (employee_id <> from_employee_id)
);
create index hr_performance_feedback_emp on public.hr_performance_feedback(employee_id, created_at desc);

create table public.hr_improvement_plans (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.hr_employees(id) on delete restrict,
  review_id     uuid references public.hr_performance_reviews(id) on delete set null,
  start_date    date not null,
  end_date      date not null,
  objectives    text not null check (length(btrim(objectives)) > 0),
  support       text,
  status        text not null default 'active' check (status in ('active','completed','extended','failed')),
  owner_id      uuid references public.hr_employees(id) on delete set null,
  outcome_notes text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date),
  check (owner_id is null or owner_id <> employee_id)
);
create index hr_improvement_plans_emp on public.hr_improvement_plans(employee_id);

-- ---------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------
-- Percent achievement for one goal, clamped to 0..score_cap. NULL when it
-- cannot be computed (no actual, or no usable target).
--   ratio          : actual / target            (higher is better)
--   inverse_ratio  : target / actual            (lower is better; actual <= 0 scores the cap)
--   binary         : 100 if met else 0          (>=, <= or = by direction)
--   manual         : actual_value IS the score  (e.g. a rated 0-100 assessment)
--   target_exact   : 100 - |actual-target|/|target| * 100 (ratio formulas)
create or replace function hr_private.kpi_score(p_formula text, p_direction text, p_target numeric, p_actual numeric)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  v_cap numeric := coalesce((hr_private.setting('performance') ->> 'score_cap')::numeric, 100);
  s numeric;
begin
  if p_actual is null then return null; end if;
  if p_formula = 'manual' then
    s := p_actual;
  elsif p_target is null then
    return null;
  elsif p_formula = 'binary' then
    s := case coalesce(p_direction, 'higher_is_better')
           when 'lower_is_better' then case when p_actual <= p_target then 100 else 0 end
           when 'target_exact'    then case when p_actual = p_target then 100 else 0 end
           else case when p_actual >= p_target then 100 else 0 end end;
  elsif p_direction = 'target_exact' then
    s := case when p_target = 0 then case when p_actual = 0 then 100 else 0 end
              else 100 - abs(p_actual - p_target) / abs(p_target) * 100 end;
  elsif p_formula = 'inverse_ratio' or p_direction = 'lower_is_better' then
    s := case when p_actual <= 0 then v_cap else p_target / p_actual * 100 end;
  else
    if p_target <= 0 then return null; end if;
    s := p_actual / p_target * 100;
  end if;
  if s is null then return null; end if;
  return round(greatest(0, least(v_cap, s)), 2);
end $$;

create or replace function hr_private.goal_score(p_kpi uuid, p_target numeric, p_actual numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  select case
    when p_kpi is null then hr_private.kpi_score(case when p_target is null then 'manual' else 'ratio' end, 'higher_is_better', p_target, p_actual)
    else (select hr_private.kpi_score(k.formula_type, k.direction, p_target, p_actual) from public.hr_kpi_definitions k where k.id = p_kpi)
  end
$$;

-- Can the caller manage (set targets / review) this employee's performance?
create or replace function hr_private.can_manage_performance_of(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.can_act_on_employee(p_employee, 'performance.manage', 'performance.review_team')
$$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function hr_private.perf_set_created_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger hr_review_cycles_created_by before insert on public.hr_review_cycles for each row execute function hr_private.perf_set_created_by();
create trigger hr_improvement_plans_created_by before insert on public.hr_improvement_plans for each row execute function hr_private.perf_set_created_by();

create trigger hr_review_cycles_touch before update on public.hr_review_cycles for each row execute function hr_private.touch_updated_at();
create trigger hr_kpi_definitions_touch before update on public.hr_kpi_definitions for each row execute function hr_private.touch_updated_at();
create trigger hr_goals_touch before update on public.hr_goals for each row execute function hr_private.touch_updated_at();
create trigger hr_performance_reviews_touch before update on public.hr_performance_reviews for each row execute function hr_private.touch_updated_at();
create trigger hr_improvement_plans_touch before update on public.hr_improvement_plans for each row execute function hr_private.touch_updated_at();

-- Cycles: activation only via hr_start_review_cycle(); closed is final.
create or replace function hr_private.review_cycles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then perform hr_private.fail('New review cycles start as draft; use Start cycle to activate.', 'invalid_state'); end if;
    return new;
  end if;
  if old.status = 'closed' and new.status <> 'closed' then
    perform hr_private.fail('A closed review cycle cannot be reopened.', 'invalid_state');
  end if;
  if new.status = 'active' and old.status <> 'active' and current_setting('hr.perf_rpc', true) is distinct from 'on' then
    perform hr_private.fail('Use Start cycle to activate a review cycle.', 'use_start_cycle');
  end if;
  if new.status = 'closed' and old.status <> 'closed' then new.closed_at := now(); end if;
  return new;
end $$;
create trigger hr_review_cycles_guard before insert or update on public.hr_review_cycles
  for each row execute function hr_private.review_cycles_guard();

-- Goals: field-level rules, weight budget, computed score.
create or replace function hr_private.goals_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cycle_status text;
  v_privileged boolean;
  v_other numeric;
begin
  if tg_op = 'UPDATE' and (new.employee_id is distinct from old.employee_id or new.cycle_id is distinct from old.cycle_id) then
    perform hr_private.fail('A goal cannot be moved to another employee or cycle.', 'immutable');
  end if;
  select status into v_cycle_status from public.hr_review_cycles where id = new.cycle_id;
  v_privileged := coalesce(auth.uid() is null
               or current_setting('hr.perf_rpc', true) is not distinct from 'on'
               or hr_private.can_manage_performance_of(new.employee_id), false);

  if v_cycle_status = 'closed' and current_setting('hr.perf_rpc', true) is distinct from 'on' then
    perform hr_private.fail('This review cycle is closed; goals can no longer change.', 'cycle_closed');
  end if;

  if not v_privileged then
    -- Employee self-service: propose goals and record actuals while the cycle is active.
    if new.employee_id is distinct from hr_private.current_employee_id() then
      perform hr_private.fail('You can only manage your own goals.', 'forbidden');
    end if;
    if v_cycle_status <> 'active' then
      perform hr_private.fail('Goals can be proposed and updated only while the review cycle is active.', 'cycle_not_active');
    end if;
    if tg_op = 'INSERT' then
      if new.status <> 'draft' then perform hr_private.fail('Proposed goals start as draft until agreed with your manager.', 'invalid_state'); end if;
    else
      if old.status in ('achieved','missed') then
        perform hr_private.fail('This goal has been closed by your manager.', 'invalid_state');
      end if;
      if new.status is distinct from old.status then
        perform hr_private.fail('Your manager or HR sets the goal status.', 'forbidden');
      end if;
      if old.status <> 'draft' and (new.title, new.description, new.weight, new.target_value, new.kpi_id)
                                  is distinct from (old.title, old.description, old.weight, old.target_value, old.kpi_id) then
        perform hr_private.fail('Only the actual value of an agreed goal can be updated by you.', 'forbidden');
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.weight = 0 and new.kpi_id is not null then
      select default_weight into new.weight from public.hr_kpi_definitions where id = new.kpi_id;
    end if;
  end if;

  -- Weight budget: at most 100 per employee per cycle (serialised per pair).
  perform pg_advisory_xact_lock(hashtext('hr_goals:' || new.employee_id || ':' || new.cycle_id));
  select coalesce(sum(weight), 0) into v_other from public.hr_goals
   where employee_id = new.employee_id and cycle_id = new.cycle_id and id <> new.id;
  if v_other + new.weight > 100 then
    perform hr_private.fail(format('Goal weights for this cycle would total %s%%; the maximum is 100%%.', v_other + new.weight), 'weight_exceeded');
  end if;

  new.score := hr_private.goal_score(new.kpi_id, new.target_value, new.actual_value);
  return new;
end $$;
create trigger hr_goals_before_write before insert or update on public.hr_goals
  for each row execute function hr_private.goals_before_write();

-- Feedback: author is always the caller; review must belong to the subject.
create or replace function hr_private.performance_feedback_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.from_employee_id := hr_private.current_employee_id();
    if new.from_employee_id is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  end if;
  if new.employee_id = new.from_employee_id then
    perform hr_private.fail('You cannot give feedback to yourself.', 'forbidden');
  end if;
  if new.review_id is not null and not exists (
       select 1 from public.hr_performance_reviews r where r.id = new.review_id and r.employee_id = new.employee_id) then
    perform hr_private.fail('That review belongs to a different employee.', 'invalid');
  end if;
  new.created_at := now();
  return new;
end $$;
create trigger hr_performance_feedback_before_insert before insert on public.hr_performance_feedback
  for each row execute function hr_private.performance_feedback_before_insert();

create or replace function hr_private.performance_feedback_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'manager_and_employee' then
    perform hr_private.notify_employee(new.employee_id, 'performance_feedback',
      case new.feedback_type when 'praise' then 'You received praise' else 'You received feedback' end,
      left(new.body, 200), '/employee/performance', 'hr_performance_feedback', new.id::text);
  end if;
  return new;
end $$;
create trigger hr_performance_feedback_after_insert after insert on public.hr_performance_feedback
  for each row execute function hr_private.performance_feedback_after_insert();

create or replace function hr_private.improvement_plans_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform hr_private.notify_employee(new.employee_id, 'improvement_plan', 'A performance improvement plan has been created',
    'From ' || to_char(new.start_date, 'DD Mon YYYY') || ' to ' || to_char(new.end_date, 'DD Mon YYYY') || '.',
    '/employee/performance', 'hr_improvement_plans', new.id::text);
  return new;
end $$;
create trigger hr_improvement_plans_after_insert after insert on public.hr_improvement_plans
  for each row execute function hr_private.improvement_plans_after_insert();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_review_cycles');
create policy hr_review_cycles_read on public.hr_review_cycles for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('performance.view') or hr_private.has_permission('performance.manage'));
create policy hr_review_cycles_insert on public.hr_review_cycles for insert to authenticated with check (hr_private.has_permission('performance.manage'));
create policy hr_review_cycles_update on public.hr_review_cycles for update to authenticated
  using (hr_private.has_permission('performance.manage')) with check (hr_private.has_permission('performance.manage'));

select hr_private.secure_table('public.hr_kpi_definitions');
create policy hr_kpi_definitions_read on public.hr_kpi_definitions for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('performance.view') or hr_private.has_permission('performance.manage'));
create policy hr_kpi_definitions_insert on public.hr_kpi_definitions for insert to authenticated with check (hr_private.has_permission('performance.manage'));
create policy hr_kpi_definitions_update on public.hr_kpi_definitions for update to authenticated
  using (hr_private.has_permission('performance.manage')) with check (hr_private.has_permission('performance.manage'));
-- No delete: deactivate KPIs (active = false).

select hr_private.secure_table('public.hr_goals');
create policy hr_goals_read on public.hr_goals for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'performance') or hr_private.has_permission('performance.manage'));
create policy hr_goals_insert on public.hr_goals for insert to authenticated
  with check (employee_id = hr_private.current_employee_id() or hr_private.can_manage_performance_of(employee_id));
create policy hr_goals_update on public.hr_goals for update to authenticated
  using (employee_id = hr_private.current_employee_id() or hr_private.can_manage_performance_of(employee_id))
  with check (employee_id = hr_private.current_employee_id() or hr_private.can_manage_performance_of(employee_id));
create policy hr_goals_delete on public.hr_goals for delete to authenticated
  using (status = 'draft' and (employee_id = hr_private.current_employee_id() or hr_private.can_manage_performance_of(employee_id)));

-- Reviews: RPC-only writes. Own review visible only once finalized.
select hr_private.secure_table('public.hr_performance_reviews');
create policy hr_performance_reviews_read on public.hr_performance_reviews for select to authenticated using (
     (employee_id = hr_private.current_employee_id() and status = 'finalized')
  or (employee_id is distinct from hr_private.current_employee_id() and (
          hr_private.has_permission('performance.view') or hr_private.has_permission('performance.manage')
       or (hr_private.has_permission('performance.view_team') and hr_private.is_manager_of(employee_id)))));
revoke insert, update, delete on public.hr_performance_reviews from authenticated;

-- Feedback: author sees own; subject sees manager_and_employee; managers see
-- manager_and_employee for their team; HR sees all (except private feedback about themselves).
select hr_private.secure_table('public.hr_performance_feedback');
create policy hr_performance_feedback_read on public.hr_performance_feedback for select to authenticated using (
     from_employee_id = hr_private.current_employee_id()
  or (employee_id = hr_private.current_employee_id() and visibility = 'manager_and_employee')
  or (employee_id is distinct from hr_private.current_employee_id()
      and (hr_private.has_permission('performance.view') or hr_private.has_permission('performance.manage')))
  or (visibility = 'manager_and_employee' and hr_private.has_permission('performance.view_team') and hr_private.is_manager_of(employee_id)));
create policy hr_performance_feedback_insert on public.hr_performance_feedback for insert to authenticated
  with check (from_employee_id = hr_private.current_employee_id() and employee_id <> from_employee_id);
revoke update, delete on public.hr_performance_feedback from authenticated;

select hr_private.secure_table('public.hr_improvement_plans');
create policy hr_improvement_plans_read on public.hr_improvement_plans for select to authenticated using (
     hr_private.can_access_employee(employee_id, 'performance')
  or owner_id = hr_private.current_employee_id()
  or hr_private.has_permission('performance.manage'));
create policy hr_improvement_plans_insert on public.hr_improvement_plans for insert to authenticated
  with check (hr_private.can_manage_performance_of(employee_id));
create policy hr_improvement_plans_update on public.hr_improvement_plans for update to authenticated
  using (hr_private.can_manage_performance_of(employee_id)) with check (hr_private.can_manage_performance_of(employee_id));

select hr_private.enable_audit('public.hr_review_cycles');
select hr_private.enable_audit('public.hr_kpi_definitions');
select hr_private.enable_audit('public.hr_goals');
select hr_private.enable_audit('public.hr_performance_reviews');
select hr_private.enable_audit('public.hr_improvement_plans');

-- ---------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------
-- Activate a cycle and create review rows for in-scope employees
-- (active/probation, joined by period end; intern cycles = interns only,
-- other cycles = non-interns). Safe to re-run to pick up new joiners.
create or replace function public.hr_start_review_cycle(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.hr_review_cycles; r record; v_n int := 0;
begin
  if not hr_private.has_permission('performance.manage') then
    perform hr_private.fail('You are not allowed to manage review cycles.', 'forbidden');
  end if;
  select * into c from public.hr_review_cycles where id = p_cycle for update;
  if c.id is null then perform hr_private.fail('Review cycle not found.', 'not_found'); end if;
  if c.status = 'closed' then perform hr_private.fail('A closed review cycle cannot be started.', 'invalid_state'); end if;
  if c.status = 'draft' then
    perform set_config('hr.perf_rpc', 'on', true);
    update public.hr_review_cycles set status = 'active', started_at = now() where id = p_cycle;
    perform set_config('hr.perf_rpc', 'off', true);
  end if;
  for r in
    insert into public.hr_performance_reviews (employee_id, cycle_id, manager_id, status)
    select e.id, c.id, e.manager_id, 'self_review'
    from public.hr_employees e join public.hr_employment_types t on t.code = e.employment_type
    where e.status in ('active','probation')
      and (e.joining_date is null or e.joining_date <= c.period_end)
      and t.is_intern = (c.cycle_type = 'intern')
    on conflict (employee_id, cycle_id) do nothing
    returning employee_id, id
  loop
    v_n := v_n + 1;
    perform hr_private.notify_employee(r.employee_id, 'review_cycle_started', 'Performance review: ' || c.name,
      case when c.self_assessment_due is not null then 'Self-assessment due ' || to_char(c.self_assessment_due, 'DD Mon YYYY') || '.' end,
      '/employee/performance', 'hr_performance_reviews', r.id::text);
  end loop;
  return jsonb_build_object('cycle_id', p_cycle, 'reviews_created', v_n);
end $$;

create or replace function public.hr_submit_self_assessment(p_review uuid, p_assessment text, p_rating integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_performance_reviews; v_me uuid := hr_private.current_employee_id(); v_cycle text;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into v from public.hr_performance_reviews where id = p_review for update;
  if v.id is null or v.employee_id <> v_me then
    perform hr_private.fail('You can only submit your own self-assessment.', 'forbidden');
  end if;
  select status into v_cycle from public.hr_review_cycles where id = v.cycle_id;
  if v_cycle <> 'active' then perform hr_private.fail('This review cycle is not open.', 'cycle_not_active'); end if;
  if v.self_submitted_at is not null or v.status not in ('not_started','self_review') then
    perform hr_private.fail('Your self-assessment has already been submitted.', 'already_submitted');
  end if;
  if p_rating is null or p_rating not between 1 and 5 then perform hr_private.fail('Choose a rating from 1 to 5.', 'invalid'); end if;
  if nullif(btrim(p_assessment), '') is null then perform hr_private.fail('Write your self-assessment.', 'invalid'); end if;
  update public.hr_performance_reviews
     set self_assessment = btrim(p_assessment), self_rating = p_rating, self_submitted_at = now(), status = 'manager_review'
   where id = p_review;
  perform hr_private.notify_employee(v.manager_id, 'self_assessment_submitted', 'A self-assessment is ready for your review',
    null, '/hr/performance', 'hr_performance_reviews', p_review::text);
end $$;

create or replace function public.hr_submit_manager_assessment(p_review uuid, p_assessment text, p_rating integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_performance_reviews; c public.hr_review_cycles; v_me uuid := hr_private.current_employee_id();
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
  update public.hr_performance_reviews
     set manager_assessment = btrim(p_assessment), manager_rating = p_rating, manager_submitted_at = now(),
         manager_id = coalesce(v_me, manager_id), status = 'manager_review'
   where id = p_review;
end $$;

create or replace function public.hr_finalize_performance_review(p_review uuid, p_final_rating numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_performance_reviews;
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
  update public.hr_performance_reviews
     set final_rating = round(p_final_rating, 2), calibrated_by = hr_private.current_employee_id(), finalized_at = now(), status = 'finalized'
   where id = p_review;
  perform hr_private.notify_employee(v.employee_id, 'review_finalized', 'Your performance review is available',
    null, '/employee/performance', 'hr_performance_reviews', p_review::text);
end $$;

-- Recompute every goal score in a cycle and roll weighted scores up to reviews.
create or replace function public.hr_compute_goal_scores(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_goals int; v_reviews int;
begin
  if not hr_private.has_permission('performance.manage') then
    perform hr_private.fail('You are not allowed to compute scores.', 'forbidden');
  end if;
  if not exists (select 1 from public.hr_review_cycles where id = p_cycle) then
    perform hr_private.fail('Review cycle not found.', 'not_found');
  end if;
  perform set_config('hr.perf_rpc', 'on', true);
  update public.hr_goals set score = hr_private.goal_score(kpi_id, target_value, actual_value) where cycle_id = p_cycle;
  get diagnostics v_goals = row_count;
  perform set_config('hr.perf_rpc', 'off', true);
  update public.hr_performance_reviews r set goal_score = s.weighted
  from (select employee_id, round(sum(score * weight) / nullif(sum(weight), 0), 2) as weighted
        from public.hr_goals where cycle_id = p_cycle and score is not null and weight > 0
        group by employee_id) s
  where r.cycle_id = p_cycle and r.employee_id = s.employee_id and r.status <> 'finalized';
  get diagnostics v_reviews = row_count;
  return jsonb_build_object('goals_scored', v_goals, 'reviews_updated', v_reviews);
end $$;

-- The caller's own reviews. Manager assessment, ratings and final result are
-- hidden until the review is finalized.
create or replace function public.hr_my_performance_reviews()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'cycle_id', r.cycle_id, 'cycle_name', c.name, 'cycle_type', c.cycle_type,
      'period_start', c.period_start, 'period_end', c.period_end, 'self_assessment_due', c.self_assessment_due,
      'status', r.status, 'self_assessment', r.self_assessment, 'self_rating', r.self_rating, 'self_submitted_at', r.self_submitted_at,
      'manager_assessment',   case when r.status = 'finalized' then r.manager_assessment end,
      'manager_rating',       case when r.status = 'finalized' then r.manager_rating end,
      'manager_submitted_at', case when r.status = 'finalized' then r.manager_submitted_at end,
      'goal_score',           case when r.status = 'finalized' then r.goal_score end,
      'final_rating',         case when r.status = 'finalized' then r.final_rating end,
      'finalized_at', r.finalized_at) order by c.period_start desc), '[]'::jsonb)
  from public.hr_performance_reviews r join public.hr_review_cycles c on c.id = r.cycle_id
  where r.employee_id = hr_private.current_employee_id()
$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on all functions in schema hr_private from anon, public;
grant execute on all functions in schema hr_private to authenticated, service_role;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
             'hr_start_review_cycle','hr_submit_self_assessment','hr_submit_manager_assessment',
             'hr_finalize_performance_review','hr_compute_goal_scores','hr_my_performance_reviews'])
  loop
    execute format('revoke execute on function %s from anon, public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

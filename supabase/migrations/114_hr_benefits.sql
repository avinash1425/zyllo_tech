-- =====================================================================
-- 114_hr_benefits.sql — Benefits: plans, eligibility, enrollments
-- =====================================================================
-- Depends on 100_hr_foundation.sql.
--   * hr_benefit_types: catalogue (direct writes with benefits.manage)
--   * hr_benefit_enrollments: RPC-only writes; visible to the employee,
--     benefits.view and benefits.manage. Managers do NOT see benefits.
--   * eligibility = employment type list + minimum tenure + current employee;
--     HR may override with a recorded reason.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

insert into public.hr_permissions (key, module, action, description) values
  ('benefits.view',   'benefits', 'view',   'View benefit plans and every enrollment'),
  ('benefits.manage', 'benefits', 'manage', 'Manage benefit plans, enroll employees and end enrollments')
on conflict (key) do nothing;
insert into public.hr_role_permissions (role_key, permission_key) values
  ('super_admin', 'benefits.view'), ('super_admin', 'benefits.manage'),
  ('hr_admin', 'benefits.view'), ('hr_admin', 'benefits.manage'),
  ('payroll_admin', 'benefits.view')
on conflict do nothing;

create table public.hr_benefit_types (
  id                        uuid primary key default gen_random_uuid(),
  code                      text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name                      text not null unique check (length(btrim(name)) between 2 and 120),
  category                  text not null default 'other' check (category in ('insurance','health','retirement','allowance','wellness','leave','other')),
  description               text check (description is null or length(description) <= 2000),
  provider                  text check (provider is null or length(provider) <= 120),
  eligible_employment_types text[],                       -- null = every employment type
  min_tenure_months         smallint not null default 0 check (min_tenure_months between 0 and 120),
  employer_contribution     numeric(12,2) not null default 0 check (employer_contribution >= 0),
  employee_contribution     numeric(12,2) not null default 0 check (employee_contribution >= 0),
  contribution_frequency    text not null default 'monthly' check (contribution_frequency in ('monthly','annual','one_time','none')),
  allows_dependants         boolean not null default false,
  active                    boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table public.hr_benefit_enrollments (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references public.hr_employees(id) on delete restrict,
  benefit_type_id       uuid not null references public.hr_benefit_types(id) on delete restrict,
  status                text not null default 'active' check (status in ('active','suspended','ended','cancelled')),
  start_date            date not null,
  end_date              date,
  coverage_level        text not null default 'employee' check (coverage_level in ('employee','employee_spouse','employee_children','family')),
  dependants            smallint not null default 0 check (dependants between 0 and 20),
  employer_contribution numeric(12,2) not null default 0 check (employer_contribution >= 0),
  employee_contribution numeric(12,2) not null default 0 check (employee_contribution >= 0),
  policy_number         text check (policy_number is null or policy_number ~ '^[A-Za-z0-9/_. -]{1,60}$'),
  notes                 text check (notes is null or length(notes) <= 2000),
  eligibility_override  text check (eligibility_override is null or length(btrim(eligibility_override)) between 5 and 1000),
  end_reason            text check (end_reason is null or length(end_reason) <= 1000),
  enrolled_by           uuid,
  ended_by              uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
-- One live enrollment per employee and plan.
create unique index hr_benefit_enrollments_live on public.hr_benefit_enrollments (employee_id, benefit_type_id) where status in ('active','suspended');
create index hr_benefit_enrollments_employee on public.hr_benefit_enrollments (employee_id, status);

create trigger hr_benefit_types_touch before update on public.hr_benefit_types for each row execute function hr_private.touch_updated_at();
create trigger hr_benefit_enrollments_touch before update on public.hr_benefit_enrollments for each row execute function hr_private.touch_updated_at();
select hr_private.secure_table('public.hr_benefit_types');
select hr_private.secure_table('public.hr_benefit_enrollments');
select hr_private.enable_audit('public.hr_benefit_types');
select hr_private.enable_audit('public.hr_benefit_enrollments');

create policy hr_benefit_types_read on public.hr_benefit_types for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('benefits.view') or hr_private.has_permission('settings.view'));
create policy hr_benefit_types_insert on public.hr_benefit_types for insert to authenticated with check (hr_private.has_permission('benefits.manage'));
create policy hr_benefit_types_update on public.hr_benefit_types for update to authenticated
  using (hr_private.has_permission('benefits.manage')) with check (hr_private.has_permission('benefits.manage'));
create policy hr_benefit_enrollments_read on public.hr_benefit_enrollments for select to authenticated
  using (employee_id = hr_private.current_employee_id() or hr_private.has_permission('benefits.view') or hr_private.has_permission('benefits.manage'));
-- No insert/update/delete policies: enrollments change through the RPCs below.

-- ---------------------------------------------------------------------
-- Eligibility
-- ---------------------------------------------------------------------
create or replace function hr_private.benefit_ineligibility(p_employee uuid, p_type uuid, p_on date)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when e.id is null then 'Employee not found.'
    when t.id is null then 'Benefit plan not found.'
    when not t.active then 'This benefit plan is inactive.'
    when e.status in ('exited','archived','suspended') then 'The employee is not active.'
    when t.eligible_employment_types is not null and not (e.employment_type = any (t.eligible_employment_types))
      then 'Employment type ' || replace(e.employment_type, '_', ' ') || ' is not eligible for this plan.'
    when t.min_tenure_months > 0 and (e.joining_date is null or e.joining_date + make_interval(months => t.min_tenure_months) > p_on)
      then 'Requires ' || t.min_tenure_months || ' months of service by the start date.'
  end
  from (select 1) one
  left join public.hr_employees e on e.id = p_employee
  left join public.hr_benefit_types t on t.id = p_type
$$;

-- Plans with eligibility for one employee (self, benefits.view or benefits.manage).
create or replace function public.hr_benefit_eligibility(p_employee uuid, p_on date default null)
returns table (benefit_type_id uuid, code text, name text, category text, eligible boolean, reason text, enrolled boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_on date := coalesce(p_on, hr_private.business_today());
begin
  if not (p_employee = hr_private.current_employee_id() or hr_private.has_permission('benefits.view') or hr_private.has_permission('benefits.manage')) then
    perform hr_private.fail('You are not allowed to view this employee''s benefits.', 'forbidden');
  end if;
  return query
    select t.id, t.code, t.name, t.category, hr_private.benefit_ineligibility(p_employee, t.id, v_on) is null,
           hr_private.benefit_ineligibility(p_employee, t.id, v_on),
           exists (select 1 from public.hr_benefit_enrollments x where x.employee_id = p_employee and x.benefit_type_id = t.id and x.status in ('active','suspended'))
    from public.hr_benefit_types t where t.active order by t.category, t.name;
end $$;

-- ---------------------------------------------------------------------
-- Workflow RPCs
-- ---------------------------------------------------------------------
create or replace function public.hr_enroll_benefit(
  p_employee uuid, p_benefit_type uuid, p_start_date date, p_coverage_level text default 'employee', p_dependants int default 0,
  p_policy_number text default null, p_notes text default null, p_override_reason text default null,
  p_employer_contribution numeric default null, p_employee_contribution numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_t public.hr_benefit_types; v_reason text; v_id uuid;
begin
  if not hr_private.has_permission('benefits.manage') then perform hr_private.fail('You are not allowed to manage benefit enrollments.', 'forbidden'); end if;
  if p_employee = hr_private.current_employee_id() then perform hr_private.fail('You cannot enroll yourself; another HR user must do it.', 'self_action'); end if;
  if p_start_date is null then perform hr_private.fail('Choose the start date.', 'start_required'); end if;
  select * into v_t from public.hr_benefit_types where id = p_benefit_type;
  v_reason := hr_private.benefit_ineligibility(p_employee, p_benefit_type, p_start_date);
  if v_reason is not null then
    -- Inactive plans / non-existent records can never be overridden.
    if v_t.id is null or not v_t.active or not exists (select 1 from public.hr_employees where id = p_employee and status not in ('exited','archived','suspended')) then
      perform hr_private.fail(v_reason, 'not_eligible');
    end if;
    if nullif(btrim(p_override_reason), '') is null then
      perform hr_private.fail(v_reason || ' Record an override reason to enroll anyway.', 'not_eligible');
    end if;
  end if;
  if coalesce(p_dependants, 0) > 0 and not v_t.allows_dependants then
    perform hr_private.fail('This plan does not cover dependants.', 'no_dependants');
  end if;
  if exists (select 1 from public.hr_benefit_enrollments where employee_id = p_employee and benefit_type_id = p_benefit_type and status in ('active','suspended')) then
    perform hr_private.fail('The employee is already enrolled in this plan.', 'already_enrolled');
  end if;
  insert into public.hr_benefit_enrollments (employee_id, benefit_type_id, start_date, coverage_level, dependants,
      employer_contribution, employee_contribution, policy_number, notes, eligibility_override, enrolled_by)
  values (p_employee, p_benefit_type, p_start_date, coalesce(p_coverage_level, 'employee'), coalesce(p_dependants, 0),
      coalesce(p_employer_contribution, v_t.employer_contribution), coalesce(p_employee_contribution, v_t.employee_contribution),
      nullif(btrim(p_policy_number), ''), nullif(btrim(p_notes), ''), case when v_reason is not null then btrim(p_override_reason) end, auth.uid())
  returning id into v_id;
  perform hr_private.notify_employee(p_employee, 'benefit_enrolled', 'Benefit enrollment: ' || v_t.name,
    'You have been enrolled in ' || v_t.name || ' from ' || to_char(p_start_date, 'DD Mon YYYY') || '.', '/employee/benefits', 'hr_benefit_enrollment', v_id::text);
  return v_id;
end $$;

create or replace function public.hr_set_benefit_enrollment_status(p_enrollment uuid, p_status text, p_end_date date default null, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_benefit_enrollments;
begin
  if not hr_private.has_permission('benefits.manage') then perform hr_private.fail('You are not allowed to manage benefit enrollments.', 'forbidden'); end if;
  select * into v from public.hr_benefit_enrollments where id = p_enrollment for update;
  if v.id is null then perform hr_private.fail('Enrollment not found.', 'not_found'); end if;
  if v.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot change your own enrollment.', 'self_action'); end if;
  if v.status in ('ended','cancelled') then perform hr_private.fail('This enrollment is already closed.', 'closed'); end if;
  if p_status not in ('active','suspended','ended','cancelled') then perform hr_private.fail('Unknown status.', 'invalid_status'); end if;
  if p_status = v.status then perform hr_private.fail('The enrollment already has that status.', 'no_change'); end if;
  if p_status in ('ended','cancelled','suspended') and nullif(btrim(p_reason), '') is null then
    perform hr_private.fail('Give a reason.', 'reason_required');
  end if;
  if p_status = 'ended' and (p_end_date is null or p_end_date < v.start_date) then
    perform hr_private.fail('Choose an end date on or after the start date.', 'invalid_end_date');
  end if;
  update public.hr_benefit_enrollments set status = p_status,
    end_date = case when p_status = 'ended' then p_end_date when p_status = 'cancelled' then coalesce(p_end_date, v.start_date) else end_date end,
    end_reason = case when p_status in ('ended','cancelled','suspended') then btrim(p_reason) else end_reason end,
    ended_by = case when p_status in ('ended','cancelled') then auth.uid() else ended_by end
  where id = p_enrollment;
  perform hr_private.notify_employee(v.employee_id, 'benefit_updated', 'Benefit enrollment ' || p_status,
    'Your benefit enrollment is now ' || p_status || '.', '/employee/benefits', 'hr_benefit_enrollment', v.id::text);
end $$;

-- Enrollments end automatically when an exit closes (keeps Exit Management authoritative).
create or replace function hr_private.end_benefits_on_exit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'exited' and old.status is distinct from 'exited' then
    update public.hr_benefit_enrollments set status = 'ended',
      end_date = greatest(start_date, coalesce(new.last_working_date, hr_private.business_today())),
      end_reason = 'Employee exited'
    where employee_id = new.id and status in ('active','suspended');
  end if;
  return new;
end $$;
create trigger hr_employees_end_benefits after update of status on public.hr_employees
  for each row execute function hr_private.end_benefits_on_exit();

revoke execute on function public.hr_benefit_eligibility(uuid, date), public.hr_enroll_benefit(uuid, uuid, date, text, int, text, text, text, numeric, numeric),
  public.hr_set_benefit_enrollment_status(uuid, text, date, text) from anon, public;
grant execute on function public.hr_benefit_eligibility(uuid, date), public.hr_enroll_benefit(uuid, uuid, date, text, int, text, text, text, numeric, numeric),
  public.hr_set_benefit_enrollment_status(uuid, text, date, text) to authenticated;
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

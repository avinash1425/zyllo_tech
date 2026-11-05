-- =====================================================================
-- 103_hr_leave.sql — Leave management
-- =====================================================================
-- Holidays, configurable leave types, yearly balances (with audit trail of
-- adjustments), requests with a level-aware approval flow and full event
-- history. All writes to balances/requests go through SECURITY DEFINER RPCs
-- that serialise per employee (advisory lock) and lock the balance row.
--
-- Leave year = calendar year. A request may not cross a year boundary
-- (apply two requests instead).
--
-- Depends on: 100_hr_foundation.sql. Replaces the hr_private.is_holiday /
-- is_on_approved_leave stubs created by 101/102.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

insert into public.hr_settings (key, value, description) values
  ('leave', jsonb_build_object(
      'approval_flow', 'manager_then_hr',     -- manager_then_hr | manager | hr
      'max_backdate_days', 30,                -- how far in the past leave may be applied for
      'max_advance_days', 365                 -- how far ahead leave may be applied for
   ),
   'Leave: approval flow and application window')
on conflict (key) do nothing;

-- Shared calendar helper (identical body to 101/102).
create or replace function hr_private.employee_working_days(p_employee uuid)
returns smallint[] language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.working_days from public.hr_employees e join public.hr_shifts s on s.id = e.shift_id where e.id = p_employee),
    (select s.working_days from public.hr_shifts s where s.is_default and s.active limit 1),
    (select array_agg(x::smallint) from jsonb_array_elements_text(hr_private.setting('company') -> 'working_days') x),
    '{1,2,3,4,5}'::smallint[])
$$;

-- ---------------------------------------------------------------------
-- Holidays
-- ---------------------------------------------------------------------
create table public.hr_holidays (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name         text not null check (length(btrim(name)) between 2 and 120),
  type         text not null default 'company' check (type in ('national','regional','optional','company')),
  location_id  uuid references public.hr_locations(id) on delete cascade,   -- null = all locations
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique nulls not distinct (holiday_date, location_id)
);
select hr_private.secure_table('public.hr_holidays');
create trigger hr_holidays_touch before update on public.hr_holidays for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_holidays');
create policy hr_holidays_read on public.hr_holidays for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('leave.view') or hr_private.has_permission('leave.manage'));
create policy hr_holidays_insert on public.hr_holidays for insert to authenticated with check (hr_private.has_permission('leave.manage'));
create policy hr_holidays_update on public.hr_holidays for update to authenticated
  using (hr_private.has_permission('leave.manage')) with check (hr_private.has_permission('leave.manage'));
create policy hr_holidays_delete on public.hr_holidays for delete to authenticated using (hr_private.has_permission('leave.manage'));

-- Optional holidays do not block a working day (they are taken as leave).
create or replace function hr_private.is_holiday(p_date date, p_employee uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hr_holidays h
    where h.holiday_date = p_date and h.type <> 'optional'
      and (h.location_id is null
           or h.location_id = (select e.work_location_id from public.hr_employees e where e.id = p_employee)))
$$;

-- ---------------------------------------------------------------------
-- Leave types (configurable policy)
-- ---------------------------------------------------------------------
create table public.hr_leave_types (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  name                text not null unique check (length(btrim(name)) between 2 and 80),
  description         text check (length(description) <= 2000),
  paid                boolean not null default true,
  annual_entitlement  numeric(5,1) not null default 0 check (annual_entitlement >= 0),
  accrual             text not null default 'annual' check (accrual in ('monthly','annual','none')),
  carry_forward_max   numeric(5,1) not null default 0 check (carry_forward_max >= 0),
  allow_half_day      boolean not null default true,
  requires_document_after_days numeric(4,1) check (requires_document_after_days > 0),
  allow_during_probation boolean not null default true,
  allow_negative      boolean not null default false,
  max_negative        numeric(5,1) check (max_negative >= 0),     -- null with allow_negative = unlimited
  counts_weekends     boolean not null default false,
  counts_holidays     boolean not null default false,
  active              boolean not null default true,
  sort_order          smallint not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
select hr_private.secure_table('public.hr_leave_types');
create trigger hr_leave_types_touch before update on public.hr_leave_types for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_leave_types');
create policy hr_leave_types_read on public.hr_leave_types for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('leave.view') or hr_private.has_permission('leave.manage'));
create policy hr_leave_types_insert on public.hr_leave_types for insert to authenticated with check (hr_private.has_permission('leave.manage'));
create policy hr_leave_types_update on public.hr_leave_types for update to authenticated
  using (hr_private.has_permission('leave.manage')) with check (hr_private.has_permission('leave.manage'));
-- No delete: deactivate (active = false).

-- Sensible, fully configurable defaults. Edit via the Leave settings UI.
insert into public.hr_leave_types (code, name, paid, annual_entitlement, accrual, carry_forward_max, allow_half_day,
                                   requires_document_after_days, allow_during_probation, allow_negative, max_negative, sort_order) values
  ('CL',  'Casual Leave',  true,  12, 'annual',  0,  true,  null, true,  false, null, 1),
  ('SL',  'Sick Leave',    true,  12, 'annual',  0,  true,  2,    true,  false, null, 2),
  ('EL',  'Earned Leave',  true,  15, 'monthly', 30, true,  null, false, false, null, 3),
  ('LOP', 'Loss of Pay',   false, 0,  'none',    0,  true,  null, true,  true,  null, 4)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Balances + adjustment trail
-- ---------------------------------------------------------------------
create table public.hr_leave_balances (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.hr_employees(id) on delete restrict,
  leave_type_id   uuid not null references public.hr_leave_types(id) on delete restrict,
  year            int not null check (year between 2000 and 2100),
  entitled        numeric(6,2) not null default 0,
  accrued         numeric(6,2) not null default 0,
  carried_forward numeric(6,2) not null default 0 check (carried_forward >= 0),
  adjusted        numeric(6,2) not null default 0,
  used            numeric(6,2) not null default 0 check (used >= 0),
  pending         numeric(6,2) not null default 0 check (pending >= 0),
  available       numeric(7,2) generated always as (accrued + carried_forward + adjusted - used - pending) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (employee_id, leave_type_id, year)
);
select hr_private.secure_table('public.hr_leave_balances');
create trigger hr_leave_balances_touch before update on public.hr_leave_balances for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_leave_balances');
create policy hr_leave_balances_read on public.hr_leave_balances for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'leave'));
revoke insert, update, delete, truncate on public.hr_leave_balances from authenticated;

create table public.hr_leave_balance_adjustments (
  id            uuid primary key default gen_random_uuid(),
  balance_id    uuid not null references public.hr_leave_balances(id) on delete restrict,
  employee_id   uuid not null references public.hr_employees(id) on delete restrict,
  leave_type_id uuid not null references public.hr_leave_types(id) on delete restrict,
  year          int not null,
  kind          text not null check (kind in ('manual','carry_forward')),
  delta         numeric(6,2) not null check (delta <> 0),
  reason        text not null check (length(btrim(reason)) between 3 and 1000),
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index hr_leave_balance_adjustments_emp on public.hr_leave_balance_adjustments(employee_id, year);
select hr_private.secure_table('public.hr_leave_balance_adjustments');
select hr_private.enable_audit('public.hr_leave_balance_adjustments');
create policy hr_leave_balance_adjustments_read on public.hr_leave_balance_adjustments for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'leave'));
revoke insert, update, delete, truncate on public.hr_leave_balance_adjustments from authenticated;

-- Entitlement for a year, prorated by full months from the joining month.
create or replace function hr_private.leave_entitlement(p_type uuid, p_employee uuid, p_year int)
returns numeric language sql stable security definer set search_path = '' as $$
  select case
    when e.joining_date is not null and extract(year from e.joining_date)::int > p_year then 0
    when e.joining_date is not null and extract(year from e.joining_date)::int = p_year
      then round(t.annual_entitlement * (13 - extract(month from e.joining_date)::int) / 12.0 * 2) / 2
    else t.annual_entitlement end
  from public.hr_leave_types t, public.hr_employees e
  where t.id = p_type and e.id = p_employee
$$;

-- Amount accrued (available to use) as of p_as_of.
create or replace function hr_private.leave_accrued(p_type uuid, p_employee uuid, p_year int, p_as_of date)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  t public.hr_leave_types;
  v_ent numeric := hr_private.leave_entitlement(p_type, p_employee, p_year);
  v_join date;
  v_first int;
  v_last int;
begin
  select * into t from public.hr_leave_types where id = p_type;
  if t.accrual = 'none' then return 0; end if;
  if t.accrual = 'annual' then return v_ent; end if;
  select joining_date into v_join from public.hr_employees where id = p_employee;
  v_first := case when v_join is not null and extract(year from v_join)::int = p_year then extract(month from v_join)::int else 1 end;
  v_last := case when extract(year from p_as_of)::int > p_year then 12
                 when extract(year from p_as_of)::int < p_year then 0
                 else extract(month from p_as_of)::int end;
  return least(v_ent, round(t.annual_entitlement / 12.0 * greatest(v_last - v_first + 1, 0), 2));
end $$;

-- Create (once) and refresh the accrual of a balance row; returns its id.
-- Carry-forward is computed from the previous year's full-year balance at creation.
create or replace function hr_private.ensure_leave_balance(p_employee uuid, p_type uuid, p_year int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.hr_leave_types;
  prev public.hr_leave_balances;
  v_id uuid;
  v_cf numeric := 0;
  v_prev_avail numeric;
begin
  select * into t from public.hr_leave_types where id = p_type;
  if t.id is null then perform hr_private.fail('Leave type not found.', 'not_found'); end if;
  select id into v_id from public.hr_leave_balances where employee_id = p_employee and leave_type_id = p_type and year = p_year;
  if v_id is null then
    select * into prev from public.hr_leave_balances where employee_id = p_employee and leave_type_id = p_type and year = p_year - 1;
    if prev.id is not null and t.carry_forward_max > 0 then
      v_prev_avail := hr_private.leave_accrued(p_type, p_employee, p_year - 1, make_date(p_year - 1, 12, 31))
                      + prev.carried_forward + prev.adjusted - prev.used - prev.pending;
      v_cf := least(t.carry_forward_max, greatest(v_prev_avail, 0));
    end if;
    insert into public.hr_leave_balances (employee_id, leave_type_id, year, entitled, accrued, carried_forward)
    values (p_employee, p_type, p_year, hr_private.leave_entitlement(p_type, p_employee, p_year),
            hr_private.leave_accrued(p_type, p_employee, p_year, hr_private.business_today()), v_cf)
    on conflict (employee_id, leave_type_id, year) do nothing
    returning id into v_id;
    if v_id is not null and v_cf > 0 then
      insert into public.hr_leave_balance_adjustments (balance_id, employee_id, leave_type_id, year, kind, delta, reason, created_by)
      values (v_id, p_employee, p_type, p_year, 'carry_forward', v_cf, 'Carried forward from ' || (p_year - 1), auth.uid());
    end if;
    if v_id is null then
      select id into v_id from public.hr_leave_balances where employee_id = p_employee and leave_type_id = p_type and year = p_year;
    end if;
  end if;
  -- refresh monthly accrual (never decreases)
  update public.hr_leave_balances b
     set accrued = greatest(b.accrued, hr_private.leave_accrued(p_type, p_employee, p_year, hr_private.business_today()))
   where b.id = v_id
     and b.accrued < hr_private.leave_accrued(p_type, p_employee, p_year, hr_private.business_today());
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Requests + history
-- ---------------------------------------------------------------------
create table public.hr_leave_requests (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.hr_employees(id) on delete restrict,
  leave_type_id       uuid not null references public.hr_leave_types(id) on delete restrict,
  start_date          date not null,
  end_date            date not null,
  start_half          boolean not null default false,   -- start day: second half only
  end_half            boolean not null default false,   -- end day: first half only
  days                numeric(5,1) not null check (days > 0),
  year                int not null,
  reason              text not null check (length(btrim(reason)) between 3 and 2000),
  document_path       text check (document_path is null or (length(document_path) <= 500 and document_path !~ '\.\.')),
  status              text not null default 'pending_approval'
                      check (status in ('draft','pending_approval','approved','rejected','cancelled')),
  current_level       text check (current_level in ('manager','hr')),
  manager_approved_by uuid,
  manager_approved_at timestamptz,
  decided_by          uuid,
  decided_at          timestamptz,
  decision_note       text check (length(decision_note) <= 2000),
  cancelled_by        uuid,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (end_date >= start_date),
  check (extract(year from start_date)::int = year and extract(year from end_date)::int = year)
);
create index hr_leave_requests_emp on public.hr_leave_requests(employee_id, start_date);
create index hr_leave_requests_status on public.hr_leave_requests(status, current_level);
select hr_private.secure_table('public.hr_leave_requests');
create trigger hr_leave_requests_touch before update on public.hr_leave_requests for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_leave_requests');
create policy hr_leave_requests_read on public.hr_leave_requests for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'leave'));
revoke insert, update, delete, truncate on public.hr_leave_requests from authenticated;

create table public.hr_leave_request_events (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references public.hr_leave_requests(id) on delete cascade,
  action            text not null check (action in ('applied','manager_approved','approved','rejected','clarification_requested',
                                                    'clarification_response','cancelled')),
  from_status       text,
  to_status         text,
  level             text,
  note              text check (length(note) <= 2000),
  actor_user_id     uuid,
  actor_employee_id uuid,
  created_at        timestamptz not null default now()
);
create index hr_leave_request_events_req on public.hr_leave_request_events(request_id, created_at);
select hr_private.secure_table('public.hr_leave_request_events');
create policy hr_leave_request_events_read on public.hr_leave_request_events for select to authenticated
  using (exists (select 1 from public.hr_leave_requests r where r.id = request_id
                 and hr_private.can_access_employee(r.employee_id, 'leave')));
revoke insert, update, delete, truncate on public.hr_leave_request_events from authenticated;

create or replace function hr_private.is_on_approved_leave(p_employee uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_leave_requests r
                 where r.employee_id = p_employee and r.status = 'approved'
                   and p_date between r.start_date and r.end_date)
$$;

create or replace function hr_private.leave_event(p_request uuid, p_action text, p_from text, p_to text, p_level text, p_note text)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_leave_request_events (request_id, action, from_status, to_status, level, note, actor_user_id, actor_employee_id)
  values (p_request, p_action, p_from, p_to, p_level, nullif(btrim(p_note), ''), auth.uid(), hr_private.current_employee_id())
$$;

-- Notify every active user holding a permission (e.g. HR approvers).
create or replace function hr_private.notify_permission_holders(p_permission text, p_type text, p_title text, p_body text,
                                                                p_link text, p_entity_type text, p_entity_id text, p_exclude_employee uuid default null)
returns void language sql security definer set search_path = '' as $$
  select hr_private.notify_user(u.user_id, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id)
  from (select distinct ur.user_id from public.hr_user_roles ur
        where ur.role_key = 'super_admin'
           or exists (select 1 from public.hr_role_permissions rp where rp.role_key = ur.role_key and rp.permission_key = p_permission)) u
  where not exists (select 1 from public.hr_employees e where e.user_id = u.user_id
                    and (not e.portal_access or e.status in ('exited','archived','suspended') or e.id = p_exclude_employee))
$$;

-- Leave days between two dates for an employee under a type's policy.
create or replace function hr_private.leave_days(p_employee uuid, p_type uuid, p_start date, p_end date,
                                                 p_start_half boolean default false, p_end_half boolean default false)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  t public.hr_leave_types;
  wd smallint[] := hr_private.employee_working_days(p_employee);
  d date;
  v numeric := 0;
  v_counts boolean;
begin
  select * into t from public.hr_leave_types where id = p_type;
  if t.id is null then perform hr_private.fail('Leave type not found.', 'not_found'); end if;
  if p_start is null or p_end is null or p_end < p_start then return 0; end if;
  d := p_start;
  while d <= p_end loop
    v_counts := (t.counts_weekends or extract(isodow from d)::smallint = any(wd))
                and (t.counts_holidays or not hr_private.is_holiday(d, p_employee));
    if v_counts then
      if d = p_start and d = p_end and (coalesce(p_start_half, false) or coalesce(p_end_half, false)) then
        v := v + 0.5;
      elsif (d = p_start and coalesce(p_start_half, false)) or (d = p_end and coalesce(p_end_half, false)) then
        v := v + 0.5;
      else
        v := v + 1;
      end if;
    end if;
    d := d + 1;
  end loop;
  return v;
end $$;

create or replace function public.hr_leave_calculate_days(p_leave_type uuid, p_start date, p_end date,
                                                          p_start_half boolean default false, p_end_half boolean default false,
                                                          p_employee uuid default null)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := coalesce(p_employee, hr_private.current_employee_id()); t public.hr_leave_types;
begin
  if v_emp is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  if not hr_private.can_access_employee(v_emp, 'leave') then perform hr_private.fail('You are not allowed to view this employee''s leave.', 'forbidden'); end if;
  select * into t from public.hr_leave_types where id = p_leave_type;
  if t.id is null then perform hr_private.fail('Leave type not found.', 'not_found'); end if;
  if p_start is null or p_end is null or p_end < p_start then
    perform hr_private.fail('End date must be on or after the start date.', 'invalid_dates');
  end if;
  if (p_start_half or p_end_half) and not t.allow_half_day then
    perform hr_private.fail(t.name || ' cannot be taken as a half day.', 'half_day_not_allowed');
  end if;
  return hr_private.leave_days(v_emp, p_leave_type, p_start, p_end, p_start_half, p_end_half);
end $$;

-- ---------------------------------------------------------------------
-- Apply
-- ---------------------------------------------------------------------
create or replace function public.hr_apply_leave(
  p_leave_type uuid, p_start date, p_end date, p_reason text,
  p_start_half boolean default false, p_end_half boolean default false, p_document_path text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_today date := hr_private.business_today();
  cfg jsonb := coalesce(hr_private.setting('leave'), '{}'::jsonb);
  e public.hr_employees;
  t public.hr_leave_types;
  b public.hr_leave_balances;
  r public.hr_leave_requests;
  v_days numeric;
  v_level text;
  v_flow text := coalesce(cfg ->> 'approval_flow', 'manager_then_hr');
  v_bal uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into e from public.hr_employees where id = v_me;
  select * into t from public.hr_leave_types where id = p_leave_type;
  if t.id is null or not t.active then perform hr_private.fail('This leave type is not available.', 'invalid_type'); end if;
  if p_start is null or p_end is null or p_end < p_start then
    perform hr_private.fail('End date must be on or after the start date.', 'invalid_dates');
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    perform hr_private.fail('A leave request cannot span two calendar years; apply separately for each year.', 'crosses_year');
  end if;
  if p_start < v_today - coalesce((cfg ->> 'max_backdate_days')::int, 30) then
    perform hr_private.fail('This date is too far in the past to apply for leave.', 'too_far_back');
  end if;
  if p_end > v_today + coalesce((cfg ->> 'max_advance_days')::int, 365) then
    perform hr_private.fail('This date is too far in the future to apply for leave.', 'too_far_ahead');
  end if;
  if (coalesce(p_start_half, false) or coalesce(p_end_half, false)) and not t.allow_half_day then
    perform hr_private.fail(t.name || ' cannot be taken as a half day.', 'half_day_not_allowed');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform hr_private.fail('Please give a reason for the leave.', 'reason_required');
  end if;
  if not t.allow_during_probation
     and (e.status = 'probation' or (e.probation_end_date is not null and e.probation_end_date >= p_start)) then
    perform hr_private.fail(t.name || ' is not available during probation.', 'probation_restricted');
  end if;

  -- Serialise all leave writes for this employee (concurrent double-submits).
  perform pg_advisory_xact_lock(hashtext('hr_leave:' || v_me::text));

  if exists (select 1 from public.hr_leave_requests x
             where x.employee_id = v_me and x.status in ('pending_approval','approved')
               and daterange(x.start_date, x.end_date, '[]') && daterange(p_start, p_end, '[]')) then
    perform hr_private.fail('These dates overlap with another pending or approved leave request.', 'overlap');
  end if;

  v_days := hr_private.leave_days(v_me, p_leave_type, p_start, p_end, p_start_half, p_end_half);
  if v_days <= 0 then
    perform hr_private.fail('The selected dates contain no working days.', 'no_working_days');
  end if;
  if t.requires_document_after_days is not null and v_days > t.requires_document_after_days
     and length(btrim(coalesce(p_document_path, ''))) = 0 then
    perform hr_private.fail('A supporting document is required for ' || t.name || ' longer than '
                            || t.requires_document_after_days || ' days.', 'document_required');
  end if;

  v_bal := hr_private.ensure_leave_balance(v_me, p_leave_type, extract(year from p_start)::int);
  select * into b from public.hr_leave_balances where id = v_bal for update;
  if v_days > b.available then
    if not t.allow_negative or (t.max_negative is not null and b.available - v_days < -t.max_negative) then
      perform hr_private.fail('Insufficient ' || t.name || ' balance (available ' || b.available || ', requested ' || v_days || ').',
                              'insufficient_balance');
    end if;
  end if;
  update public.hr_leave_balances set pending = pending + v_days where id = b.id;

  v_level := case
    when v_flow in ('manager_then_hr','manager') and exists (
      select 1 from public.hr_employees m where m.id = e.manager_id and m.portal_access
        and m.status not in ('exited','archived','suspended')) then 'manager'
    else 'hr' end;

  insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, start_half, end_half, days, year,
                                        reason, document_path, status, current_level)
  values (v_me, p_leave_type, p_start, p_end, coalesce(p_start_half, false), coalesce(p_end_half, false), v_days,
          extract(year from p_start)::int, btrim(p_reason), nullif(btrim(p_document_path), ''), 'pending_approval', v_level)
  returning * into r;
  perform hr_private.leave_event(r.id, 'applied', null, 'pending_approval', v_level, p_reason);

  if v_level = 'manager' then
    perform hr_private.notify_employee(e.manager_id, 'leave.requested', 'Leave request to review',
      coalesce(e.display_name, e.first_name) || ' applied for ' || v_days || ' day(s) of ' || t.name || '.',
      '/hr/leave', 'hr_leave_requests', r.id::text);
  else
    perform hr_private.notify_permission_holders('leave.approve', 'leave.requested', 'Leave request to review',
      coalesce(e.display_name, e.first_name) || ' applied for ' || v_days || ' day(s) of ' || t.name || '.',
      '/hr/leave', 'hr_leave_requests', r.id::text, v_me);
  end if;
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- Decide (level-aware)
-- ---------------------------------------------------------------------
-- Who may act on a pending request at its current level?
create or replace function hr_private.leave_can_act(r public.hr_leave_requests)
returns boolean language sql stable security definer set search_path = '' as $$
  select r.employee_id is distinct from hr_private.current_employee_id()
     and (hr_private.has_permission('leave.approve')
          or (r.current_level = 'manager' and hr_private.has_permission('leave.approve_team') and hr_private.is_manager_of(r.employee_id)))
$$;

create or replace function public.hr_decide_leave(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_leave_requests;
  t public.hr_leave_types;
  v_flow text := coalesce(hr_private.setting('leave') ->> 'approval_flow', 'manager_then_hr');
  v_final boolean;
  v_from_level text;
begin
  select * into r from public.hr_leave_requests where id = p_id;
  if r.id is null then perform hr_private.fail('Leave request not found.', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtext('hr_leave:' || r.employee_id::text));
  select * into r from public.hr_leave_requests where id = p_id for update;
  if r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot decide your own leave request.', 'self_approval');
  end if;
  if r.status <> 'pending_approval' then
    perform hr_private.fail('This leave request has already been ' || replace(r.status, '_', ' ') || '.', 'already_decided');
  end if;
  if not hr_private.leave_can_act(r) then
    perform hr_private.fail('You are not allowed to decide this leave request.', 'forbidden');
  end if;
  if p_approve is null then perform hr_private.fail('Choose approve or reject.', 'invalid'); end if;
  select * into t from public.hr_leave_types where id = r.leave_type_id;
  v_from_level := r.current_level;

  if not p_approve then
    if length(btrim(coalesce(p_note, ''))) = 0 then
      perform hr_private.fail('Please give a reason for rejecting.', 'note_required');
    end if;
    update public.hr_leave_balances set pending = pending - r.days
     where employee_id = r.employee_id and leave_type_id = r.leave_type_id and year = r.year;
    update public.hr_leave_requests set status = 'rejected', current_level = null, decided_by = auth.uid(), decided_at = now(),
           decision_note = btrim(p_note)
     where id = p_id returning * into r;
    perform hr_private.leave_event(p_id, 'rejected', 'pending_approval', 'rejected', v_from_level, p_note);
    perform hr_private.notify_employee(r.employee_id, 'leave.rejected', 'Leave request rejected',
      t.name || ' from ' || to_char(r.start_date, 'DD Mon') || ' was rejected: ' || btrim(p_note),
      '/employee/leave', 'hr_leave_requests', p_id::text);
    return to_jsonb(r);
  end if;

  -- Final when: HR level, or the approver holds HR approval, or the flow is manager-only.
  v_final := r.current_level = 'hr' or hr_private.has_permission('leave.approve') or v_flow = 'manager';
  if not v_final then
    update public.hr_leave_requests set current_level = 'hr', manager_approved_by = auth.uid(), manager_approved_at = now()
     where id = p_id returning * into r;
    perform hr_private.leave_event(p_id, 'manager_approved', 'pending_approval', 'pending_approval', 'manager', p_note);
    perform hr_private.notify_permission_holders('leave.approve', 'leave.requested', 'Leave request awaiting HR approval',
      'A manager approved a ' || t.name || ' request; HR approval is required.', '/hr/leave', 'hr_leave_requests', p_id::text, r.employee_id);
    perform hr_private.notify_employee(r.employee_id, 'leave.manager_approved', 'Leave approved by manager',
      'Your ' || t.name || ' request is now awaiting HR approval.', '/employee/leave', 'hr_leave_requests', p_id::text);
    return to_jsonb(r);
  end if;

  update public.hr_leave_balances set pending = pending - r.days, used = used + r.days
   where employee_id = r.employee_id and leave_type_id = r.leave_type_id and year = r.year;
  update public.hr_leave_requests set status = 'approved', current_level = null, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(p_note), '')
   where id = p_id returning * into r;
  perform hr_private.leave_event(p_id, 'approved', 'pending_approval', 'approved', v_from_level, p_note);
  perform hr_private.notify_employee(r.employee_id, 'leave.approved', 'Leave approved',
    t.name || ' from ' || to_char(r.start_date, 'DD Mon YYYY') || ' to ' || to_char(r.end_date, 'DD Mon YYYY') || ' was approved.',
    '/employee/leave', 'hr_leave_requests', p_id::text);
  return to_jsonb(r);
end $$;

create or replace function public.hr_request_leave_clarification(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_leave_requests;
begin
  select * into r from public.hr_leave_requests where id = p_id for update;
  if r.id is null then perform hr_private.fail('Leave request not found.', 'not_found'); end if;
  if r.status <> 'pending_approval' then perform hr_private.fail('Only pending requests can be queried.', 'invalid_state'); end if;
  if not hr_private.leave_can_act(r) then perform hr_private.fail('You are not allowed to act on this leave request.', 'forbidden'); end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then perform hr_private.fail('Please write your question.', 'note_required'); end if;
  perform hr_private.leave_event(p_id, 'clarification_requested', r.status, r.status, r.current_level, p_note);
  perform hr_private.notify_employee(r.employee_id, 'leave.clarification', 'Clarification requested on your leave',
    btrim(p_note), '/employee/leave', 'hr_leave_requests', p_id::text);
end $$;

create or replace function public.hr_respond_leave_clarification(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_leave_requests;
begin
  select * into r from public.hr_leave_requests where id = p_id;
  if r.id is null or r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Leave request not found.', 'not_found');
  end if;
  if r.status <> 'pending_approval' then perform hr_private.fail('This request is no longer pending.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_note, ''))) < 1 then perform hr_private.fail('Response cannot be empty.', 'note_required'); end if;
  perform hr_private.leave_event(p_id, 'clarification_response', r.status, r.status, r.current_level, p_note);
  if r.current_level = 'manager' then
    perform hr_private.notify_employee(hr_private.my_manager_id(), 'leave.clarification_response', 'Clarification received',
      btrim(p_note), '/hr/leave', 'hr_leave_requests', p_id::text);
  else
    perform hr_private.notify_permission_holders('leave.approve', 'leave.clarification_response', 'Clarification received',
      btrim(p_note), '/hr/leave', 'hr_leave_requests', p_id::text, r.employee_id);
  end if;
end $$;

-- Cancellation rule:
--   * employee: own pending request (releases pending), or own APPROVED leave
--     that has not started yet (restores used). Started/past approved leave
--     can only be cancelled by HR.
--   * HR (leave.approve or leave.manage): any pending/approved request of
--     another employee.
create or replace function public.hr_cancel_leave(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_leave_requests;
  v_me uuid := hr_private.current_employee_id();
  v_own boolean;
  v_from text;
begin
  select * into r from public.hr_leave_requests where id = p_id;
  if r.id is null then perform hr_private.fail('Leave request not found.', 'not_found'); end if;
  v_own := r.employee_id = v_me;
  if not v_own and not (hr_private.has_permission('leave.approve') or hr_private.has_permission('leave.manage')) then
    perform hr_private.fail('Leave request not found.', 'not_found');
  end if;
  perform pg_advisory_xact_lock(hashtext('hr_leave:' || r.employee_id::text));
  select * into r from public.hr_leave_requests where id = p_id for update;
  if r.status not in ('pending_approval','approved') then
    perform hr_private.fail('This leave request is already ' || replace(r.status, '_', ' ') || '.', 'invalid_state');
  end if;
  if v_own and r.status = 'approved' and r.start_date <= hr_private.business_today() then
    perform hr_private.fail('Leave that has already started can only be cancelled by HR.', 'already_started');
  end if;
  v_from := r.status;
  if r.status = 'pending_approval' then
    update public.hr_leave_balances set pending = pending - r.days
     where employee_id = r.employee_id and leave_type_id = r.leave_type_id and year = r.year;
  else
    update public.hr_leave_balances set used = used - r.days
     where employee_id = r.employee_id and leave_type_id = r.leave_type_id and year = r.year;
  end if;
  update public.hr_leave_requests set status = 'cancelled', current_level = null, cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_id returning * into r;
  perform hr_private.leave_event(p_id, 'cancelled', v_from, 'cancelled', null, p_note);
  if not v_own then
    perform hr_private.notify_employee(r.employee_id, 'leave.cancelled', 'Leave cancelled by HR',
      coalesce(nullif(btrim(p_note), ''), 'Your leave from ' || to_char(r.start_date, 'DD Mon YYYY') || ' was cancelled.'),
      '/employee/leave', 'hr_leave_requests', p_id::text);
  elsif v_from = 'approved' then
    perform hr_private.notify_employee(hr_private.my_manager_id(), 'leave.cancelled', 'Approved leave cancelled',
      'A team member cancelled approved leave starting ' || to_char(r.start_date, 'DD Mon YYYY') || '.',
      '/hr/leave', 'hr_leave_requests', p_id::text);
  end if;
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- Balance administration
-- ---------------------------------------------------------------------
create or replace function public.hr_adjust_leave_balance(p_employee uuid, p_leave_type uuid, p_year int, p_delta numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.hr_leave_balances; t public.hr_leave_types; v_bal uuid;
begin
  if not hr_private.has_permission('leave.adjust') then
    perform hr_private.fail('You are not allowed to adjust leave balances.', 'forbidden');
  end if;
  if p_employee is not distinct from hr_private.current_employee_id() then
    perform hr_private.fail('You cannot adjust your own leave balance.', 'self_adjust');
  end if;
  if not exists (select 1 from public.hr_employees where id = p_employee) then
    perform hr_private.fail('Employee not found.', 'not_found');
  end if;
  if p_delta is null or p_delta = 0 then perform hr_private.fail('Adjustment cannot be zero.', 'invalid'); end if;
  if p_year is null or p_year not between 2000 and 2100 then perform hr_private.fail('Invalid year.', 'invalid'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('A reason is required for every adjustment.', 'reason_required'); end if;
  select * into t from public.hr_leave_types where id = p_leave_type;
  if t.id is null then perform hr_private.fail('Leave type not found.', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtext('hr_leave:' || p_employee::text));
  v_bal := hr_private.ensure_leave_balance(p_employee, p_leave_type, p_year);
  select * into b from public.hr_leave_balances where id = v_bal for update;
  if b.available + p_delta < 0 and not t.allow_negative then
    perform hr_private.fail('This adjustment would make the balance negative.', 'negative_balance');
  end if;
  update public.hr_leave_balances set adjusted = adjusted + p_delta where id = b.id returning * into b;
  insert into public.hr_leave_balance_adjustments (balance_id, employee_id, leave_type_id, year, kind, delta, reason, created_by)
  values (b.id, p_employee, p_leave_type, p_year, 'manual', p_delta, btrim(p_reason), auth.uid());
  perform hr_private.notify_employee(p_employee, 'leave.balance_adjusted', 'Leave balance adjusted',
    t.name || ' ' || p_year || ': ' || case when p_delta > 0 then '+' else '' end || p_delta || ' day(s). ' || btrim(p_reason),
    '/employee/leave', 'hr_leave_balances', b.id::text);
  return to_jsonb(b);
end $$;

-- Create balance rows for every current employee x active type for a year
-- (carry-forward applied once, at creation). Idempotent; returns rows created.
create or replace function public.hr_initialize_leave_year(p_year int)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count int := 0; r record; v_cur int := extract(year from hr_private.business_today())::int;
begin
  if not hr_private.has_permission('leave.manage') then
    perform hr_private.fail('You are not allowed to manage leave.', 'forbidden');
  end if;
  if p_year is null or p_year not between v_cur - 1 and v_cur + 1 then
    perform hr_private.fail('Leave years can be initialised for the previous, current or next year only.', 'invalid_year');
  end if;
  for r in
    select e.id as employee_id, t.id as leave_type_id
    from public.hr_employees e cross join public.hr_leave_types t
    where t.active
      and e.status in ('onboarding','probation','active','notice_period')
      and (e.joining_date is null or e.joining_date <= make_date(p_year, 12, 31))
      and not exists (select 1 from public.hr_leave_balances b
                      where b.employee_id = e.id and b.leave_type_id = t.id and b.year = p_year)
  loop
    perform hr_private.ensure_leave_balance(r.employee_id, r.leave_type_id, p_year);
    v_count := v_count + 1;
  end loop;
  perform hr_private.audit_event('LEAVE_YEAR_INITIALIZED', 'hr_leave_balances', p_year::text, jsonb_build_object('created', v_count));
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Read helpers
-- ---------------------------------------------------------------------
create or replace function public.hr_my_leave_balances(p_year int default null)
returns table (balance_id uuid, leave_type_id uuid, code text, name text, paid boolean, year int, entitled numeric, accrued numeric,
               carried_forward numeric, adjusted numeric, used numeric, pending numeric, available numeric)
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_year int := coalesce(p_year, extract(year from hr_private.business_today())::int);
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  perform hr_private.ensure_leave_balance(v_me, t.id, v_year) from public.hr_leave_types t where t.active;
  return query
    select b.id, t.id, t.code, t.name, t.paid, b.year, b.entitled, b.accrued, b.carried_forward, b.adjusted, b.used, b.pending, b.available
    from public.hr_leave_balances b join public.hr_leave_types t on t.id = b.leave_type_id
    where b.employee_id = v_me and b.year = v_year
    order by t.sort_order, t.code;
end $$;

-- Team leave calendar: pending + approved leave in a range, scoped to the
-- caller (self / team / all by leave.* permission). Peers who share the
-- caller's manager are included for APPROVED leave (no reason shown).
create or replace function public.hr_leave_calendar(p_from date, p_to date)
returns table (request_id uuid, employee_id uuid, employee_name text, department_id uuid, leave_type_code text,
               leave_type_name text, start_date date, end_date date, start_half boolean, end_half boolean, days numeric, status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if hr_private.current_employee_id() is null and not hr_private.has_permission('leave.view') then
    perform hr_private.fail('Sign in with an active employee account.', 'not_employee');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    perform hr_private.fail('Choose a valid date range of at most one year.', 'invalid_range');
  end if;
  return query
    select r.id, r.employee_id, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), e.department_id,
           t.code, t.name, r.start_date, r.end_date, r.start_half, r.end_half, r.days, r.status
    from public.hr_leave_requests r
    join public.hr_employees e on e.id = r.employee_id
    join public.hr_leave_types t on t.id = r.leave_type_id
    where r.status in ('pending_approval','approved')
      and r.start_date <= p_to and r.end_date >= p_from
      and (hr_private.can_access_employee(r.employee_id, 'leave')
           or (r.status = 'approved' and e.manager_id is not null and e.manager_id = hr_private.my_manager_id()))
    order by r.start_date, e.first_name;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

revoke execute on function public.hr_leave_calculate_days(uuid, date, date, boolean, boolean, uuid),
  public.hr_apply_leave(uuid, date, date, text, boolean, boolean, text),
  public.hr_decide_leave(uuid, boolean, text), public.hr_request_leave_clarification(uuid, text),
  public.hr_respond_leave_clarification(uuid, text), public.hr_cancel_leave(uuid, text),
  public.hr_adjust_leave_balance(uuid, uuid, int, numeric, text), public.hr_initialize_leave_year(int),
  public.hr_my_leave_balances(int), public.hr_leave_calendar(date, date) from anon, public;
grant execute on function public.hr_leave_calculate_days(uuid, date, date, boolean, boolean, uuid),
  public.hr_apply_leave(uuid, date, date, text, boolean, boolean, text),
  public.hr_decide_leave(uuid, boolean, text), public.hr_request_leave_clarification(uuid, text),
  public.hr_respond_leave_clarification(uuid, text), public.hr_cancel_leave(uuid, text),
  public.hr_adjust_leave_balance(uuid, uuid, int, numeric, text), public.hr_initialize_leave_year(int),
  public.hr_my_leave_balances(int), public.hr_leave_calendar(date, date) to authenticated;

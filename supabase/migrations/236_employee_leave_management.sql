-- 236: Employee Portal — Leave Management + scheduled reminders.
--
-- ep_leave_types       : kinds of leave and the default days per calendar year
--                        (null = no limit, e.g. Loss of Pay). Change via SQL.
-- ep_leave_allocations : optional per-employee, per-year days that replace the default.
-- ep_holidays          : company holidays (not counted as leave days).
-- ep_leave_requests    : applications. pending -> approved / rejected (by the
--                        reporting manager) ; pending or not-yet-started approved
--                        leave can be cancelled by the employee.
--
-- Leave days = dates from start to end, minus Sundays and company holidays.
-- A single-day request can be a half day (0.5). A request stays in one calendar
-- year. Paid leave cannot go over the balance (pending requests count too).
-- Requests may start up to 30 days in the past and up to 365 days ahead.
--
-- Reminders (pg_cron, India time, Monday–Saturday, skipping holidays and leave):
--   09:45  not punched in yet                -> attendance reminder
--   18:30  punched in today, report not sent -> daily report reminder
--   21:30  still punched in                  -> "auto punch out at 10:00 PM"
-- Notifications use public.ep_notify() from migration 235.
-- Rollback: supabase/rollbacks/236_rollback_employee_leave_management.sql

begin;

-- ---------------------------------------------------------------- tables
create table if not exists public.ep_leave_types (
  code        text primary key check (code ~ '^[A-Z]{2,5}$'),
  name        text not null check (length(btrim(name)) between 1 and 60),
  yearly_days numeric(5, 1) check (yearly_days is null or yearly_days between 0 and 366),
  is_paid     boolean not null default true,
  sort_order  smallint not null default 0,
  is_active   boolean not null default true
);

insert into public.ep_leave_types (code, name, yearly_days, is_paid, sort_order) values
  ('CL',  'Casual Leave',  12,   true,  1),
  ('SL',  'Sick Leave',    12,   true,  2),
  ('EL',  'Earned Leave',  15,   true,  3),
  ('LOP', 'Loss of Pay',   null, false, 4)
on conflict (code) do nothing;

create table if not exists public.ep_leave_allocations (
  employee_id uuid not null references public.ep_employees (id) on delete cascade,
  year        smallint not null check (year between 2020 and 2100),
  leave_type  text not null references public.ep_leave_types (code),
  days        numeric(5, 1) not null check (days between 0 and 366),
  primary key (employee_id, year, leave_type)
);

create table if not exists public.ep_holidays (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name         text not null check (length(btrim(name)) between 1 and 80),
  created_at   timestamptz not null default now()
);

create table if not exists public.ep_leave_requests (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.ep_employees (id) on delete cascade,
  leave_type       text not null references public.ep_leave_types (code),
  start_date       date not null,
  end_date         date not null,
  half_day         text check (half_day in ('first_half', 'second_half')),
  days             numeric(5, 1) not null check (days > 0),
  reason           text not null check (length(btrim(reason)) between 1 and 1000),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id      uuid references public.ep_employees (id) on delete set null,
  decided_by       uuid references public.ep_employees (id) on delete set null,
  decided_at       timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ep_leave_dates check (end_date >= start_date and extract(year from start_date) = extract(year from end_date)),
  constraint ep_leave_half_one_day check (half_day is null or start_date = end_date)
);
create index if not exists ep_leave_requests_employee on public.ep_leave_requests (employee_id, start_date desc);
create index if not exists ep_leave_requests_approver on public.ep_leave_requests (approver_id, status);

comment on table public.ep_leave_types is 'Employee Portal: leave types and default days per year (null = unlimited).';
comment on table public.ep_leave_allocations is 'Employee Portal: per-employee yearly leave days (overrides ep_leave_types.yearly_days).';
comment on table public.ep_holidays is 'Employee Portal: company holidays.';
comment on table public.ep_leave_requests is 'Employee Portal: leave applications. Written via ep_apply_leave / ep_cancel_leave / ep_decide_leave.';

-- ---------------------------------------------------------------- RLS
alter table public.ep_leave_types       enable row level security;
alter table public.ep_leave_allocations enable row level security;
alter table public.ep_holidays          enable row level security;
alter table public.ep_leave_requests    enable row level security;
revoke all on public.ep_leave_types, public.ep_leave_allocations, public.ep_holidays, public.ep_leave_requests from anon, authenticated;
grant select, insert, update, delete on public.ep_leave_types, public.ep_leave_allocations, public.ep_holidays, public.ep_leave_requests to authenticated;

drop policy if exists ep_leave_types_read on public.ep_leave_types;
create policy ep_leave_types_read on public.ep_leave_types for select to authenticated using (true);
drop policy if exists ep_holidays_read on public.ep_holidays;
create policy ep_holidays_read on public.ep_holidays for select to authenticated using (true);
drop policy if exists ep_leave_allocations_read on public.ep_leave_allocations;
create policy ep_leave_allocations_read on public.ep_leave_allocations for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid())));
drop policy if exists ep_leave_requests_read on public.ep_leave_requests;
create policy ep_leave_requests_read on public.ep_leave_requests for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()))
         or approver_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid())));

do $$
declare t text;
begin
  foreach t in array array['ep_leave_types', 'ep_leave_allocations', 'ep_holidays', 'ep_leave_requests'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t || '_admin_write', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- helpers
-- Leave days between two dates (Sundays and holidays not counted); half day = 0.5.
create or replace function public.ep_leave_day_count(p_start date, p_end date, p_half text)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select case when p_half is not null and p_start = p_end then 0.5 else 1 end
         * count(*)
  from generate_series(p_start, p_end, interval '1 day') g(d)
  where extract(isodow from g.d) <> 7
    and not exists (select 1 from public.ep_holidays h where h.holiday_date = g.d::date);
$$;

-- Days allowed for one employee / year / type (null = unlimited).
create or replace function public.ep_leave_allowance(p_emp uuid, p_year int, p_type text)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select a.days from public.ep_leave_allocations a
      where a.employee_id = p_emp and a.year = p_year and a.leave_type = p_type),
    (select t.yearly_days from public.ep_leave_types t where t.code = p_type));
$$;

-- Days already used or requested (approved + pending), optionally ignoring one request.
create or replace function public.ep_leave_taken(p_emp uuid, p_year int, p_type text, p_skip uuid default null)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(days), 0) from public.ep_leave_requests
   where employee_id = p_emp and leave_type = p_type and extract(year from start_date) = p_year
     and status in ('approved', 'pending') and id is distinct from p_skip;
$$;

-- Is this employee on approved leave (full day) or is it a holiday / Sunday on this date?
create or replace function public.ep_is_day_off(p_emp uuid, p_date date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select extract(isodow from p_date) = 7
      or exists (select 1 from public.ep_holidays where holiday_date = p_date)
      or exists (select 1 from public.ep_leave_requests r
                  where r.employee_id = p_emp and r.status = 'approved' and r.half_day is null
                    and p_date between r.start_date and r.end_date);
$$;

revoke all on function public.ep_leave_allowance(uuid, int, text), public.ep_leave_taken(uuid, int, text, uuid),
  public.ep_is_day_off(uuid, date) from public, anon, authenticated;

-- JSON of one request (for lists).
create or replace function public.ep_leave_json(r public.ep_leave_requests)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'leave_type', r.leave_type, 'leave_name', (select name from public.ep_leave_types where code = r.leave_type),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_day', r.half_day, 'days', r.days,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'decided_by', (select full_name from public.ep_employees where id = r.decided_by),
    'approver', (select full_name from public.ep_employees where id = r.approver_id),
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                           'designation', e.designation)
                   from public.ep_employees e where e.id = r.employee_id));
$$;
revoke all on function public.ep_leave_json(public.ep_leave_requests) from public, anon, authenticated;

-- ---------------------------------------------------------------- employee
-- Balances, requests and holidays of one calendar year.
create or replace function public.ep_leave_overview(p_year int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_mgr uuid;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  return jsonb_build_object(
    'year', p_year,
    'manager', (select jsonb_build_object('id', m.id, 'full_name', m.full_name) from public.ep_employees m where m.id = v_mgr),
    'balances', (
      select jsonb_agg(jsonb_build_object(
               'code', t.code, 'name', t.name, 'is_paid', t.is_paid,
               'allowed', public.ep_leave_allowance(v_emp, p_year, t.code),
               'approved', (select coalesce(sum(days), 0) from public.ep_leave_requests
                             where employee_id = v_emp and leave_type = t.code and status = 'approved'
                               and extract(year from start_date) = p_year),
               'pending', (select coalesce(sum(days), 0) from public.ep_leave_requests
                            where employee_id = v_emp and leave_type = t.code and status = 'pending'
                              and extract(year from start_date) = p_year))
             order by t.sort_order)
      from public.ep_leave_types t where t.is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r) order by r.start_date desc, r.created_at desc)
      from public.ep_leave_requests r
      where r.employee_id = v_emp and extract(year from r.start_date) = p_year), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.holiday_date, 'name', h.name) order by h.holiday_date)
      from public.ep_holidays h where extract(year from h.holiday_date) = p_year), '[]'::jsonb));
end $$;

-- Preview: how many leave days a range is.
create or replace function public.ep_leave_preview(p_start date, p_end date, p_half text)
returns numeric
language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.ep_current_employee_id() is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    return 0;
  end if;
  return public.ep_leave_day_count(p_start, p_end, case when p_start = p_end then p_half end);
end $$;

create or replace function public.ep_apply_leave(p_type text, p_start date, p_end date, p_half text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr     uuid;
  v_name    text;
  v_type    public.ep_leave_types;
  v_days    numeric;
  v_allowed numeric;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_half    text := nullif(p_half, '');
  v_row     public.ep_leave_requests;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select * into v_type from public.ep_leave_types where code = p_type and is_active;
  if v_type.code is null then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose a valid start and end date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave request cannot cross into the next year. Apply for each year separately.' using errcode = '22023';
  end if;
  if p_start < v_today - 30 or p_end > v_today + 365 then
    raise exception 'Leave can start at most 30 days ago and end at most one year ahead.' using errcode = '22023';
  end if;
  if v_half is not null and (v_half not in ('first_half', 'second_half') or p_start <> p_end) then
    raise exception 'A half day must be a single date.' using errcode = '22023';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write a reason (up to 1000 characters).' using errcode = '22023';
  end if;
  select reporting_manager_id, full_name into v_mgr, v_name from public.ep_employees where id = v_emp;
  if v_mgr is null then
    raise exception 'No reporting manager is set for you yet. Ask the admin to set one, then apply.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave' || v_emp::text, 0));

  v_days := public.ep_leave_day_count(p_start, p_end, v_half);
  if v_days = 0 then
    raise exception 'These dates are only Sundays or company holidays, so no leave is needed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_leave_requests r
              where r.employee_id = v_emp and r.status in ('pending', 'approved')
                and r.start_date <= p_end and r.end_date >= p_start
                and not (r.start_date = r.end_date and p_start = p_end and r.half_day is not null and v_half is not null
                         and r.half_day <> v_half)) then
    raise exception 'You already have leave on some of these dates.' using errcode = '22023';
  end if;
  v_allowed := public.ep_leave_allowance(v_emp, extract(year from p_start)::int, p_type);
  if v_type.is_paid and v_allowed is not null
     and public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type) + v_days > v_allowed then
    raise exception 'Not enough % balance: % day(s) left, % requested.', v_type.name,
      greatest(v_allowed - public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type), 0), v_days
      using errcode = '22023';
  end if;

  insert into public.ep_leave_requests (employee_id, leave_type, start_date, end_date, half_day, days, reason, approver_id)
  values (v_emp, p_type, p_start, p_end, v_half, v_days, v_reason, v_mgr)
  returning * into v_row;

  perform public.ep_notify(v_mgr, 'leave',
    v_name || ' applied for ' || v_type.name,
    to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else to_char(p_start, ' YYYY') end
      || ' · ' || v_days || ' day(s) · ' || left(v_reason, 200),
    '/employee/leave/team');
  return public.ep_leave_json(v_row);
end $$;

create or replace function public.ep_cancel_leave(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_row   public.ep_leave_requests;
  v_name  text;
begin
  select * into v_row from public.ep_leave_requests where id = p_id and employee_id = v_emp for update;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  if not (v_row.status = 'pending' or (v_row.status = 'approved' and v_row.start_date > v_today)) then
    raise exception 'Only pending leave, or approved leave that has not started, can be cancelled.' using errcode = 'P0001';
  end if;
  update public.ep_leave_requests set status = 'cancelled', updated_at = now() where id = p_id returning * into v_row;
  select full_name into v_name from public.ep_employees where id = v_emp;
  perform public.ep_notify(v_row.approver_id, 'leave',
    v_name || ' cancelled a leave request',
    to_char(v_row.start_date, 'DD Mon YYYY') || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end,
    '/employee/leave/team');
  return public.ep_leave_json(v_row);
end $$;

-- ---------------------------------------------------------------- manager
create or replace function public.ep_team_leave()
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
    'team_size', (select count(*) from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r) order by (r.status = 'pending') desc, r.start_date desc)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where (r.approver_id = v_emp or e.reporting_manager_id = v_emp)
        and (r.status = 'pending' or r.end_date >= v_today - 90)), '[]'::jsonb));
end $$;

-- p_action: 'approved' | 'rejected' (rejected needs a comment).
create or replace function public.ep_decide_leave(p_id uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_row     public.ep_leave_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed numeric;
  v_type    public.ep_leave_types;
begin
  select r.* into v_row from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_id and (r.approver_id = v_emp or e.reporting_manager_id = v_emp)
   for update of r;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  if p_action = 'approved' then
    -- Balance may have changed (e.g. admin lowered it); check again without this request.
    select * into v_type from public.ep_leave_types where code = v_row.leave_type;
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this.', v_type.name using errcode = '22023';
    end if;
  end if;
  update public.ep_leave_requests
     set status = p_action, decided_by = v_emp, decided_at = now(), decision_comment = v_comment, updated_at = now()
   where id = p_id returning * into v_row;
  perform public.ep_notify(v_row.employee_id, 'leave',
    'Your leave was ' || case when p_action = 'approved' then 'approved' else 'rejected' end,
    (select name from public.ep_leave_types where code = v_row.leave_type) || ' · '
      || to_char(v_row.start_date, 'DD Mon YYYY')
      || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end
      || coalesce(' · ' || v_comment, ''),
    '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_leave_json(v_row);
end $$;

-- ---------------------------------------------------------------- attendance calendar
-- Holidays + my approved leave days between two dates (max 62 days).
create or replace function public.ep_my_days_off(p_from date, p_to date)
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
  return jsonb_build_object(
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('date', holiday_date, 'name', name) order by holiday_date)
                            from public.ep_holidays where holiday_date between p_from and p_to), '[]'::jsonb),
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('date', g.d::date, 'type', r.leave_type, 'half_day', r.half_day) order by g.d)
      from public.ep_leave_requests r,
           generate_series(greatest(r.start_date, p_from), least(r.end_date, p_to), interval '1 day') g(d)
      where r.employee_id = v_emp and r.status = 'approved'
        and r.start_date <= p_to and r.end_date >= p_from), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- reminders
-- p_kind: 'punch_in' | 'report' | 'punch_out'. Run by pg_cron; safe to run twice (dedupe key).
create or replace function public.ep_send_reminders(p_kind text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_n     integer := 0;
  r       record;
begin
  if extract(isodow from v_today) = 7 or exists (select 1 from public.ep_holidays where holiday_date = v_today) then
    return 0;
  end if;
  for r in
    select e.id from public.ep_employees e
     where e.is_active
       and case p_kind
             when 'punch_in' then
               not public.ep_is_day_off(e.id, v_today)
               and not exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.work_date = v_today)
             when 'report' then
               exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.work_date = v_today)
               and exists (select 1 from public.ep_project_members m where m.employee_id = e.id)
               and not exists (select 1 from public.ep_work_reports w where w.employee_id = e.id and w.report_date = v_today
                                and w.status in ('submitted', 'reviewed'))
             when 'punch_out' then
               exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
             else false
           end
  loop
    perform public.ep_notify(r.id,
      case when p_kind = 'report' then 'report' else 'attendance' end,
      case p_kind
        when 'punch_in'  then 'You have not punched in today'
        when 'report'    then 'Submit your daily work report'
        else                  'You are still punched in'
      end,
      case p_kind
        when 'punch_in'  then 'Office starts at 9:30 AM. Punch in when you start work, or apply for leave if you are off.'
        when 'report'    then 'Your report for today is not submitted yet.'
        else                  'You will be punched out automatically at 10:00 PM. Punch out now if you are done.'
      end,
      case p_kind when 'report' then '/employee/reports' when 'punch_in' then '/employee' else '/employee/attendance' end,
      'normal',
      p_kind || ':' || v_today);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_send_reminders(text) from public, anon, authenticated;

revoke all on function public.ep_leave_day_count(date, date, text), public.ep_leave_overview(int),
  public.ep_leave_preview(date, date, text), public.ep_apply_leave(text, date, date, text, text),
  public.ep_cancel_leave(uuid), public.ep_team_leave(), public.ep_decide_leave(uuid, text, text),
  public.ep_my_days_off(date, date) from public, anon;
grant execute on function public.ep_leave_overview(int), public.ep_leave_preview(date, date, text),
  public.ep_apply_leave(text, date, date, text, text), public.ep_cancel_leave(uuid), public.ep_team_leave(),
  public.ep_decide_leave(uuid, text, text), public.ep_my_days_off(date, date) to authenticated;

-- 09:45 IST = 04:15 UTC, 18:30 IST = 13:00 UTC, 21:30 IST = 16:00 UTC; Monday–Saturday.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
    exception when others then
      raise warning 'ep reminders: pg_cron not available (%). Reminders will not be sent.', sqlerrm;
      return;
    end;
  end if;
  perform cron.schedule('ep-remind-punch-in',  '15 4 * * 1-6', $c$select public.ep_send_reminders('punch_in')$c$);
  perform cron.schedule('ep-remind-report',    '0 13 * * 1-6', $c$select public.ep_send_reminders('report')$c$);
  perform cron.schedule('ep-remind-punch-out', '0 16 * * 1-6', $c$select public.ep_send_reminders('punch_out')$c$);
end $$;

notify pgrst, 'reload schema';

commit;

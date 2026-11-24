-- 242: Employee Portal — admin Attendance Management + admin Leave Management,
--      and attendance correction requests (employee asks, admin decides).
--
-- ATTENDANCE
--   ep_attendance_rows(from, to, employee|null)  internal: per employee per day, same rules as
--                                                ep_my_attendance (which now uses it too)
--   ep_attendance.corrected_at                   set when an approved correction changed a session
--   ep_attendance_corrections                    correction requests:
--       attendance_id set  -> fix that session's punch in and/or punch out
--       attendance_id null -> add a missing session (punch in + punch out)
--     Employee: ep_request_correction / ep_my_corrections / ep_cancel_correction
--     Admin:    ep_admin_attendance(from, to, employee|null) / ep_admin_corrections(status)
--               / ep_admin_decide_correction(id, 'approved'|'rejected', comment)
--     Rules: the day is today or up to 30 days back; times are on that day (India time) and not in
--     the future; punch out after punch in; no overlap with the employee's other sessions; one
--     pending request per day. Checked again when the admin approves.
--
-- LEAVE (balances stay computed from requests, so a decision updates them at once;
--        approved leave shows on both attendance calendars through the leave rows)
--   ep_leave_requests.decided_by_admin           who decided, when it was an admin
--   ep_admin_leave_requests(status, year) / ep_admin_decide_leave(id, action, comment)
--   ep_admin_leave_balances(year) / ep_admin_set_leave_allowance(employee, year, type, days|null)
--   ep_admin_holidays(year) / ep_admin_save_holiday(id|null, date, name) / ep_admin_delete_holiday(id)
--     A holiday change re-counts the days of pending / approved leave covering that date; a
--     request left with 0 days is cancelled automatically and the employee is notified.
-- Rollback: supabase/rollbacks/242_rollback_employee_admin_attendance_leave.sql

begin;

-- ================================================================ ATTENDANCE
alter table public.ep_attendance add column if not exists corrected_at timestamptz;

-- Per employee per day (rules from ep_attendance_rules()).
create or replace function public.ep_attendance_rows(p_from date, p_to date, p_emp uuid default null)
returns table (
  employee_id    uuid,
  work_date      date,
  first_in       timestamptz,
  last_out       timestamptz,
  worked_minutes integer,
  sessions       integer,
  is_open        boolean,
  is_late        boolean,
  status         text,
  auto_out       boolean,
  corrected      boolean
)
language sql stable security definer set search_path = ''
as $$
  with r as (select public.ep_attendance_rules() as j),
  days as (
    select a.employee_id, a.work_date,
           min(a.punch_in_at)  as first_in,
           max(a.punch_out_at) as last_out,
           floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int as worked,
           count(*)::int as n,
           bool_or(a.punch_out_at is null) as open,
           bool_or(a.auto_punched_out) as auto,
           bool_or(a.corrected_at is not null) as corr
    from public.ep_attendance a
    where a.work_date between p_from and p_to and (p_emp is null or a.employee_id = p_emp)
    group by a.employee_id, a.work_date
  )
  select d.employee_id, d.work_date, d.first_in, d.last_out, d.worked, d.n, d.open,
         (d.first_in at time zone (r.j ->> 'timezone'))::time > (r.j ->> 'late_after')::time,
         case
           when d.open then 'working'
           when d.worked < (r.j ->> 'half_day_min_hours')::int * 60 then 'leave'
           when (d.last_out at time zone (r.j ->> 'timezone'))::time >= (r.j ->> 'office_end')::time then 'present'
           else 'half_day'
         end,
         d.auto, d.corr
  from days d cross join r;
$$;
revoke all on function public.ep_attendance_rows(date, date, uuid) from public, anon, authenticated;

-- Employee view now uses the shared rows (same columns as before).
create or replace function public.ep_my_attendance(p_from date, p_to date)
returns table (
  work_date      date,
  first_in       timestamptz,
  last_out       timestamptz,
  worked_minutes integer,
  sessions       integer,
  is_open        boolean,
  is_late        boolean,
  status         text,
  auto_out       boolean
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_emp uuid;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  perform public.ep_close_overdue_sessions(v_emp);
  return query
  select x.work_date, x.first_in, x.last_out, x.worked_minutes, x.sessions, x.is_open, x.is_late, x.status, x.auto_out
  from public.ep_attendance_rows(p_from, p_to, v_emp) x
  order by x.work_date desc;
end $$;

-- ---------------------------------------------------------------- corrections
create table if not exists public.ep_attendance_corrections (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.ep_employees (id) on delete cascade,
  work_date        date not null,
  attendance_id    uuid references public.ep_attendance (id) on delete set null,
  requested_in     timestamptz,
  requested_out    timestamptz,
  old_in           timestamptz,
  old_out          timestamptz,
  reason           text not null check (length(btrim(reason)) between 1 and 500),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by_admin uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 500),
  created_at       timestamptz not null default now(),
  constraint ep_corr_has_time check (requested_in is not null or requested_out is not null)
);
create unique index if not exists ep_corr_one_pending_per_day
  on public.ep_attendance_corrections (employee_id, work_date) where status = 'pending';
create index if not exists ep_corr_status on public.ep_attendance_corrections (status, created_at desc);
comment on table public.ep_attendance_corrections is
  'Employee Portal: attendance correction requests. Written via ep_request_correction / ep_admin_decide_correction.';

alter table public.ep_attendance_corrections enable row level security;
revoke all on public.ep_attendance_corrections from anon, authenticated;
grant select on public.ep_attendance_corrections to authenticated;
drop policy if exists ep_corr_read on public.ep_attendance_corrections;
create policy ep_corr_read on public.ep_attendance_corrections for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid())));

-- Validates a correction and returns the resulting session times.
create or replace function public.ep_correction_check(
  p_emp uuid, p_date date, p_att uuid, p_in timestamptz, p_out timestamptz,
  out new_in timestamptz, out new_out timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tz    text := public.ep_attendance_rules() ->> 'timezone';
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_att   public.ep_attendance;
begin
  if p_date is null or p_date > v_today or p_date < v_today - 30 then
    raise exception 'Corrections are possible for today and the last 30 days only.' using errcode = '22023';
  end if;
  if p_in is null and p_out is null then
    raise exception 'Enter the correct punch in and/or punch out time.' using errcode = '22023';
  end if;
  if p_att is not null then
    select * into v_att from public.ep_attendance where id = p_att and employee_id = p_emp;
    if v_att.id is null or v_att.work_date <> p_date then
      raise exception 'That punch session was not found on this day.' using errcode = 'P0002';
    end if;
    if v_att.punch_out_at is null and p_out is null then
      raise exception 'This session is still open. Punch out first, or enter the punch out time.' using errcode = '22023';
    end if;
    new_in  := coalesce(p_in, v_att.punch_in_at);
    new_out := coalesce(p_out, v_att.punch_out_at);
  else
    if p_in is null or p_out is null then
      raise exception 'To add a missing session, enter both punch in and punch out.' using errcode = '22023';
    end if;
    new_in := p_in;
    new_out := p_out;
  end if;
  if (new_in at time zone v_tz)::date <> p_date then
    raise exception 'Punch in must be on %.', to_char(p_date, 'DD Mon YYYY') using errcode = '22023';
  end if;
  if new_out <= new_in then
    raise exception 'Punch out must be after punch in.' using errcode = '22023';
  end if;
  if new_out > ((p_date + 1)::timestamp at time zone v_tz) then
    raise exception 'Punch out must be on the same day (before midnight).' using errcode = '22023';
  end if;
  if new_out > now() then
    raise exception 'Times cannot be in the future.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ep_attendance a
    where a.employee_id = p_emp and a.id is distinct from p_att
      and tstzrange(a.punch_in_at, coalesce(a.punch_out_at, now())) && tstzrange(new_in, new_out)) then
    raise exception 'These times overlap another punch session of the same day.' using errcode = '22023';
  end if;
end $$;
revoke all on function public.ep_correction_check(uuid, date, uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.ep_correction_json(c public.ep_attendance_corrections)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'work_date', c.work_date, 'attendance_id', c.attendance_id,
    'requested_in', c.requested_in, 'requested_out', c.requested_out,
    'old_in', c.old_in, 'old_out', c.old_out,
    'kind', case when c.old_in is null then 'add' else 'fix' end,
    'reason', c.reason, 'status', c.status, 'created_at', c.created_at,
    'decided_at', c.decided_at, 'decision_comment', c.decision_comment,
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                   from public.ep_employees e where e.id = c.employee_id));
$$;
revoke all on function public.ep_correction_json(public.ep_attendance_corrections) from public, anon, authenticated;

-- Employee: ask for a correction.
create or replace function public.ep_request_correction(
  p_date date, p_attendance uuid, p_in timestamptz, p_out timestamptz, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_chk record;
  v_att public.ep_attendance;
  v_row public.ep_attendance_corrections;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 500 then
    raise exception 'Write a reason (up to 500 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_attendance_corrections
              where employee_id = v_emp and work_date = p_date and status = 'pending') then
    raise exception 'You already have a pending correction for this day.' using errcode = '23505';
  end if;
  select * into v_chk from public.ep_correction_check(v_emp, p_date, p_attendance, p_in, p_out);
  if p_attendance is not null then
    select * into v_att from public.ep_attendance where id = p_attendance;
  end if;
  insert into public.ep_attendance_corrections
    (employee_id, work_date, attendance_id, requested_in, requested_out, old_in, old_out, reason)
  values (v_emp, p_date, p_attendance,
          case when p_attendance is null or p_in is distinct from v_att.punch_in_at then p_in end,
          case when p_attendance is null or p_out is distinct from v_att.punch_out_at then p_out end,
          v_att.punch_in_at, v_att.punch_out_at, v_reason)
  returning * into v_row;
  if v_row.requested_in is null and v_row.requested_out is null then
    raise exception 'The times are the same as now — nothing to correct.' using errcode = '22023';
  end if;
  return public.ep_correction_json(v_row);
end $$;

create or replace function public.ep_my_corrections()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(public.ep_correction_json(c) order by c.created_at desc)
    from (select * from public.ep_attendance_corrections where employee_id = v_emp
          order by created_at desc limit 50) c), '[]'::jsonb);
end $$;

create or replace function public.ep_cancel_correction(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_row public.ep_attendance_corrections;
begin
  update public.ep_attendance_corrections set status = 'cancelled'
   where id = p_id and employee_id = v_emp and status = 'pending'
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Only your pending requests can be cancelled.' using errcode = 'P0001';
  end if;
  return public.ep_correction_json(v_row);
end $$;

-- Admin: attendance of everyone (or one employee) for a date range (max 62 days).
create or replace function public.ep_admin_attendance(p_from date, p_to date, p_emp uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  perform public.ep_close_overdue_sessions(p_emp);
  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'department', e.department, 'is_active', e.is_active,
               'start_date', (timezone('Asia/Kolkata', e.created_at))::date) order by e.full_name)
      from public.ep_employees e where p_emp is null or e.id = p_emp), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.work_date desc, x.employee_id)
      from public.ep_attendance_rows(p_from, p_to, p_emp) x), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'employee_id', a.employee_id, 'work_date', a.work_date,
               'punch_in_at', a.punch_in_at, 'punch_out_at', a.punch_out_at,
               'auto_punched_out', a.auto_punched_out, 'corrected_at', a.corrected_at) order by a.punch_in_at)
      from public.ep_attendance a
      where a.work_date between p_from and p_to and (p_emp is null or a.employee_id = p_emp)), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', holiday_date, 'name', name) order by holiday_date)
      from public.ep_holidays where holiday_date between p_from and p_to), '[]'::jsonb),
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'date', g.d::date,
                                          'type', r.leave_type, 'half_day', r.half_day) order by g.d)
      from public.ep_leave_requests r,
           generate_series(greatest(r.start_date, p_from), least(r.end_date, p_to), interval '1 day') g(d)
      where r.status = 'approved' and r.start_date <= p_to and r.end_date >= p_from
        and (p_emp is null or r.employee_id = p_emp)), '[]'::jsonb),
    'pending_corrections', (select count(*) from public.ep_attendance_corrections where status = 'pending'));
end $$;

create or replace function public.ep_admin_corrections(p_status text default 'pending')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(public.ep_correction_json(c) order by c.created_at desc)
    from (select * from public.ep_attendance_corrections
           where coalesce(p_status, 'all') = 'all' or status = p_status
           order by created_at desc limit 200) c), '[]'::jsonb);
end $$;

create or replace function public.ep_admin_decide_correction(p_id uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.ep_attendance_corrections;
  v_chk record;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.ep_require_admin();
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 500 then
    raise exception 'Comment must be at most 500 characters.' using errcode = '22023';
  end if;
  select * into v_row from public.ep_attendance_corrections where id = p_id for update;
  if v_row.id is null then
    raise exception 'Correction request not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;

  if p_action = 'approved' then
    if v_row.old_in is not null and v_row.attendance_id is null then
      raise exception 'The punch session of this request no longer exists.' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_row.employee_id::text, 0));
    -- Check again: other sessions may have changed since the request.
    select * into v_chk from public.ep_correction_check(
      v_row.employee_id, v_row.work_date, v_row.attendance_id, v_row.requested_in, v_row.requested_out);
    if v_row.attendance_id is not null then
      update public.ep_attendance
         set punch_in_at = v_chk.new_in, punch_out_at = v_chk.new_out,
             auto_punched_out = false, corrected_at = now()
       where id = v_row.attendance_id;
    else
      insert into public.ep_attendance (employee_id, work_date, punch_in_at, punch_out_at, corrected_at)
      values (v_row.employee_id, v_row.work_date, v_chk.new_in, v_chk.new_out, now());
    end if;
  end if;

  update public.ep_attendance_corrections
     set status = p_action, decided_by_admin = auth.uid(), decided_at = now(), decision_comment = v_comment
   where id = p_id returning * into v_row;

  perform public.ep_notify(v_row.employee_id, 'attendance',
    'Attendance correction ' || p_action,
    to_char(v_row.work_date, 'DD Mon YYYY') || coalesce(' · ' || v_comment, ''),
    '/employee/attendance', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_correction_json(v_row);
end $$;

-- ================================================================ LEAVE
alter table public.ep_leave_requests
  add column if not exists decided_by_admin uuid references auth.users (id) on delete set null;

-- decided_by: the manager's name, or "Admin" when an admin decided.
create or replace function public.ep_leave_json(r public.ep_leave_requests)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'leave_type', r.leave_type, 'leave_name', (select name from public.ep_leave_types where code = r.leave_type),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_day', r.half_day, 'days', r.days,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'decided_by', coalesce((select full_name from public.ep_employees where id = r.decided_by),
                           case when r.decided_by_admin is not null then 'Admin' end),
    'approver', coalesce((select full_name from public.ep_employees where id = r.approver_id), r.approver_name),
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                           'designation', e.designation)
                   from public.ep_employees e where e.id = r.employee_id));
$$;
revoke all on function public.ep_leave_json(public.ep_leave_requests) from public, anon, authenticated;

-- One employee's balance of one type in one year.
create or replace function public.ep_leave_balance_json(p_emp uuid, p_year int, p_type text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'code', t.code, 'name', t.name, 'is_paid', t.is_paid,
    'default', t.yearly_days,
    'allowed', public.ep_leave_allowance(p_emp, p_year, t.code),
    'is_custom', exists (select 1 from public.ep_leave_allocations a
                          where a.employee_id = p_emp and a.year = p_year and a.leave_type = t.code),
    'approved', (select coalesce(sum(days), 0) from public.ep_leave_requests
                  where employee_id = p_emp and leave_type = t.code and status = 'approved'
                    and extract(year from start_date) = p_year),
    'pending', (select coalesce(sum(days), 0) from public.ep_leave_requests
                 where employee_id = p_emp and leave_type = t.code and status = 'pending'
                   and extract(year from start_date) = p_year))
  from public.ep_leave_types t where t.code = p_type;
$$;
revoke all on function public.ep_leave_balance_json(uuid, int, text) from public, anon, authenticated;

create or replace function public.ep_admin_leave_requests(p_status text default 'pending', p_year int default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(public.ep_leave_json(r)
             || jsonb_build_object('balance',
                  public.ep_leave_balance_json(r.employee_id, extract(year from r.start_date)::int, r.leave_type))
             order by case when r.status = 'pending' then 0 else 1 end, r.start_date desc, r.created_at desc)
    from (select * from public.ep_leave_requests
           where (coalesce(p_status, 'all') = 'all' or status = p_status)
             and (p_year is null or extract(year from start_date) = p_year)
           order by start_date desc limit 300) r), '[]'::jsonb);
end $$;

create or replace function public.ep_admin_decide_leave(p_id uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row     public.ep_leave_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed numeric;
  v_type    public.ep_leave_types;
begin
  perform public.ep_require_admin();
  select * into v_row from public.ep_leave_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'Leave request not found.' using errcode = 'P0002';
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
    select * into v_type from public.ep_leave_types where code = v_row.leave_type;
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this. Increase the balance or ask for Loss of Pay.', v_type.name
        using errcode = '22023';
    end if;
  end if;
  update public.ep_leave_requests
     set status = p_action, decided_by = null, decided_by_admin = auth.uid(), decided_at = now(),
         decision_comment = v_comment, updated_at = now()
   where id = p_id returning * into v_row;
  perform public.ep_notify(v_row.employee_id, 'leave',
    'Your leave was ' || p_action,
    (select name from public.ep_leave_types where code = v_row.leave_type) || ' · '
      || to_char(v_row.start_date, 'DD Mon YYYY')
      || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end
      || ' · by Admin' || coalesce(' · ' || v_comment, ''),
    '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_leave_json(v_row)
    || jsonb_build_object('balance',
         public.ep_leave_balance_json(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type));
end $$;

create or replace function public.ep_admin_leave_balances(p_year int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'year', p_year,
    'types', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'is_paid', is_paid, 'default', yearly_days)
                               order by sort_order)
              from public.ep_leave_types where is_active),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'balances', (select jsonb_agg(public.ep_leave_balance_json(e.id, p_year, t.code) order by t.sort_order)
                              from public.ep_leave_types t where t.is_active))
             order by e.is_active desc, e.full_name)
      from public.ep_employees e), '[]'::jsonb));
end $$;

-- p_days null = back to the default for that leave type.
create or replace function public.ep_admin_set_leave_allowance(p_emp uuid, p_year int, p_type text, p_days numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_type public.ep_leave_types;
  v_approved numeric;
begin
  perform public.ep_require_admin();
  select * into v_type from public.ep_leave_types where code = p_type;
  if v_type.code is null or not v_type.is_paid then
    raise exception 'Only paid leave types have a balance.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_emp) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  if p_days is null then
    delete from public.ep_leave_allocations where employee_id = p_emp and year = p_year and leave_type = p_type;
  else
    if p_days < 0 or p_days > 366 or p_days * 2 <> round(p_days * 2) then
      raise exception 'Days must be between 0 and 366, in steps of 0.5.' using errcode = '22023';
    end if;
    select coalesce(sum(days), 0) into v_approved from public.ep_leave_requests
     where employee_id = p_emp and leave_type = p_type and status = 'approved' and extract(year from start_date) = p_year;
    if p_days < v_approved then
      raise exception '% days of % are already approved this year; the balance cannot be lower.', v_approved, v_type.name
        using errcode = '22023';
    end if;
    insert into public.ep_leave_allocations (employee_id, year, leave_type, days)
    values (p_emp, p_year, p_type, p_days)
    on conflict (employee_id, year, leave_type) do update set days = excluded.days;
  end if;
  return public.ep_leave_balance_json(p_emp, p_year, p_type);
end $$;

-- ---------------------------------------------------------------- holidays
-- Re-count pending / approved leave that covers a date (after a holiday change).
create or replace function public.ep_recount_leave_on(p_date date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.ep_leave_requests;
  v_days numeric;
begin
  for r in select * from public.ep_leave_requests
            where status in ('pending', 'approved') and p_date between start_date and end_date for update loop
    v_days := public.ep_leave_day_count(r.start_date, r.end_date, r.half_day);
    if v_days = 0 then
      update public.ep_leave_requests
         set status = 'cancelled', updated_at = now(),
             decision_comment = 'Cancelled automatically: the day is now a company holiday.'
       where id = r.id;
      perform public.ep_notify(r.employee_id, 'leave', 'Leave not needed — company holiday',
        to_char(r.start_date, 'DD Mon YYYY') || ' is now a company holiday, so your leave request was cancelled.',
        '/employee/leave');
    elsif v_days <> r.days then
      update public.ep_leave_requests set days = v_days, updated_at = now() where id = r.id;
    end if;
  end loop;
end $$;
revoke all on function public.ep_recount_leave_on(date) from public, anon, authenticated;

create or replace function public.ep_admin_holidays(p_year int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'date', holiday_date, 'name', name) order by holiday_date)
    from public.ep_holidays where extract(year from holiday_date) = p_year), '[]'::jsonb);
end $$;

create or replace function public.ep_admin_save_holiday(p_id uuid, p_date date, p_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old date;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform public.ep_require_admin();
  if p_date is null or p_date not between date '2020-01-01' and date '2100-12-31' then
    raise exception 'Choose a valid date.' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Holiday name is required (up to 80 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_holidays where holiday_date = p_date and id is distinct from p_id) then
    raise exception '% is already a holiday.', to_char(p_date, 'DD Mon YYYY') using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.ep_holidays (holiday_date, name) values (p_date, v_name);
  else
    select holiday_date into v_old from public.ep_holidays where id = p_id for update;
    if not found then
      raise exception 'Holiday not found.' using errcode = 'P0002';
    end if;
    update public.ep_holidays set holiday_date = p_date, name = v_name where id = p_id;
    if v_old <> p_date then
      perform public.ep_recount_leave_on(v_old);
    end if;
  end if;
  perform public.ep_recount_leave_on(p_date);
  return public.ep_admin_holidays(extract(year from p_date)::int);
end $$;

create or replace function public.ep_admin_delete_holiday(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_date date;
begin
  perform public.ep_require_admin();
  delete from public.ep_holidays where id = p_id returning holiday_date into v_date;
  if v_date is null then
    raise exception 'Holiday not found.' using errcode = 'P0002';
  end if;
  perform public.ep_recount_leave_on(v_date);
  return public.ep_admin_holidays(extract(year from v_date)::int);
end $$;

-- ================================================================ grants
revoke all on function
  public.ep_request_correction(date, uuid, timestamptz, timestamptz, text), public.ep_my_corrections(),
  public.ep_cancel_correction(uuid),
  public.ep_admin_attendance(date, date, uuid), public.ep_admin_corrections(text),
  public.ep_admin_decide_correction(uuid, text, text),
  public.ep_admin_leave_requests(text, int), public.ep_admin_decide_leave(uuid, text, text),
  public.ep_admin_leave_balances(int), public.ep_admin_set_leave_allowance(uuid, int, text, numeric),
  public.ep_admin_holidays(int), public.ep_admin_save_holiday(uuid, date, text), public.ep_admin_delete_holiday(uuid)
  from public, anon;
grant execute on function
  public.ep_request_correction(date, uuid, timestamptz, timestamptz, text), public.ep_my_corrections(),
  public.ep_cancel_correction(uuid),
  public.ep_admin_attendance(date, date, uuid), public.ep_admin_corrections(text),
  public.ep_admin_decide_correction(uuid, text, text),
  public.ep_admin_leave_requests(text, int), public.ep_admin_decide_leave(uuid, text, text),
  public.ep_admin_leave_balances(int), public.ep_admin_set_leave_allowance(uuid, int, text, numeric),
  public.ep_admin_holidays(int), public.ep_admin_save_holiday(uuid, date, text), public.ep_admin_delete_holiday(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;

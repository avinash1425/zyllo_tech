-- =====================================================================
-- 195: Half-day leave in attendance (Module 5 x Module 6 agreed change)
-- =====================================================================
-- Spec: docs/hrms/integration/MODULE5_ATTENDANCE_TIME.md §3 "Half-day leave"
-- and MODULE6_INTEGRATION_READINESS.md §2.
--
-- Until now any approved leave date, including a 0.5 day, was classified as
-- 'leave' by hr_private.attendance_day_type. This migration redefines (same
-- signatures, latest definitions are from 125) the three functions below:
--
--   * attendance_day_type : 'leave' only when hr_private.leave_portion_on >= 1;
--                           a 0.5 day stays 'working'.
--   * attendance_compute  : expected minutes = (1 - portion) x shift minutes
--     attendance_day        (also used for short hours, overtime and the
--                           half-day threshold); half = 'first' (morning off)
--                           skips the late-arrival calculation, 'second'
--                           (afternoon off) skips the early-leave calculation;
--                           no punch on a 0.5 leave day -> 'half_day', not 'absent'.
--
-- hr_private.is_on_approved_leave is unchanged (117, 128, 190 call it).
-- Stored hr_attendance rows are not recalculated; a correction or manual
-- entry recalculates a day, as before.
--
-- Requires 125 (hr_private.employee_shift_on) and 160 (hr_private.leave_portion_on).

do $$
begin
  if to_regprocedure('hr_private.employee_shift_on(uuid,date)') is null
     or to_regprocedure('hr_private.leave_portion_on(uuid,date)') is null then
    raise exception '195_hr_attendance_half_day_leave requires migrations 125 (attendance & time) and 160 (leave management)';
  end if;
end $$;

-- Which half of the day an approved half-day leave covers: 'first' (morning
-- off), 'second' (afternoon off) or null (no half-day leave on that date).
create or replace function hr_private.leave_half_on(p_employee uuid, p_date date)
returns text language sql stable security definer set search_path = '' as $$
  select d.half
  from public.hr_leave_request_days d join public.hr_leave_requests r on r.id = d.request_id
  where d.employee_id = p_employee and d.leave_date = p_date and r.status = 'approved' and d.half is not null
  order by d.half
  limit 1
$$;
grant execute on function hr_private.leave_half_on(uuid, date) to authenticated, service_role;   -- same grants as the other hr_private helpers (125)
revoke execute on function hr_private.leave_half_on(uuid, date) from public, anon;

-- 'holiday' | 'weekly_off' | 'leave' | 'working'
create or replace function hr_private.attendance_day_type(p_employee uuid, p_date date)
returns text language plpgsql stable security definer set search_path = '' as $$
declare s record;
begin
  if hr_private.is_holiday(p_date, p_employee) then return 'holiday'; end if;
  select * into s from hr_private.employee_shift_on(p_employee, p_date);
  if not (extract(isodow from p_date)::smallint = any(s.working_days)) or hr_private.is_weekly_off_rule(s.weekly_off_rules, p_date) then
    return 'weekly_off';
  end if;
  if hr_private.leave_portion_on(p_employee, p_date) >= 1 then return 'leave'; end if;   -- a 0.5 day stays 'working'
  return 'working';
end $$;

-- Pure calculation from the date's effective shift + punches (no writes).
create or replace function hr_private.attendance_compute(p_employee uuid, p_work_date date, p_in timestamptz, p_out timestamptz)
returns table (o_shift_id uuid, o_expected_start timestamptz, o_expected_end timestamptz, o_break int, o_worked int,
               o_late int, o_early int, o_overtime int, o_status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s record;
  tz text := hr_private.employee_timezone(p_employee);
  v_day text := hr_private.attendance_day_type(p_employee, p_work_date);
  v_net int;
  v_half numeric;
  v_span int;
  v_diff int;
  v_working boolean := v_day = 'working';
  v_scheduled boolean := v_day in ('working', 'leave');
  v_portion numeric := 0;          -- approved leave portion on a working day (0 or 0.5)
  v_leave_half text;               -- 'first' = morning off, 'second' = afternoon off
begin
  if v_working then
    v_portion := hr_private.leave_portion_on(p_employee, p_work_date);
    if v_portion > 0 then v_leave_half := hr_private.leave_half_on(p_employee, p_work_date); end if;
  end if;
  select * into s from hr_private.employee_shift_on(p_employee, p_work_date);
  o_shift_id := s.shift_id;
  o_expected_start := (p_work_date + s.start_time) at time zone tz;
  o_expected_end := (p_work_date + s.end_time) at time zone tz;
  if s.end_time <= s.start_time then                -- overnight shift
    o_expected_end := ((p_work_date + 1) + s.end_time) at time zone tz;
  end if;
  v_net := hr_private.shift_expected_minutes(s.start_time, s.end_time, s.break_minutes, s.break_paid, s.expected_minutes);
  v_half := coalesce(s.half_day_minutes, v_net / 2.0) * (1 - v_portion);
  v_net := round(v_net * (1 - v_portion))::int;
  o_break := 0; o_worked := null; o_late := 0; o_early := 0; o_overtime := 0;

  if p_in is null then
    o_status := case v_day when 'holiday' then 'holiday' when 'weekly_off' then 'weekend' when 'leave' then 'on_leave'
                  else case when v_portion > 0 then 'half_day' else 'absent' end end;
    return next; return;
  end if;

  if v_working and v_leave_half is distinct from 'first' then
    v_diff := floor(extract(epoch from p_in - o_expected_start) / 60)::int;
    if v_diff > s.grace_minutes then o_late := v_diff; end if;
  end if;

  if p_out is not null then
    v_span := floor(extract(epoch from p_out - p_in) / 60)::int;
    o_break := case when s.break_paid then 0 else least(s.break_minutes, v_span) end;
    o_worked := greatest(v_span - case when s.break_paid then 0 else s.break_minutes end, 0);
    if v_working and v_leave_half is distinct from 'second' then
      v_diff := floor(extract(epoch from o_expected_end - p_out) / 60)::int;
      if v_diff > s.early_leave_grace_minutes then o_early := v_diff; end if;
    end if;
    if v_scheduled then
      o_overtime := greatest(o_worked - v_net - coalesce(s.overtime_after_minutes, 0), 0);
    else
      o_overtime := o_worked;                       -- all work on a holiday / weekly off is overtime
    end if;
    o_status := case when v_working and o_worked < v_half then 'half_day'
                     when o_late > 0 then 'late' else 'present' end;
  else
    o_status := case when o_late > 0 then 'late' else 'present' end;
  end if;
  return next;
end $$;

-- One computed day (record + schedule). Callers check access first.
create or replace function hr_private.attendance_day(p_employee uuid, p_date date)
returns table (work_date date, day_type text, status text, attendance_id uuid, shift_id uuid, shift_name text,
               expected_start_at timestamptz, expected_end_at timestamptz, expected_minutes int,
               check_in_at timestamptz, check_out_at timestamptz, worked_minutes int, late_minutes int,
               early_leave_minutes int, overtime_minutes int, short_minutes int, source text,
               missing_punch_out boolean, holiday_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := hr_private.employee_timezone(p_employee);
  v_today date := hr_private.employee_today(p_employee);
  v_after int := coalesce((hr_private.setting('attendance') ->> 'missing_punch_after_hours')::int, 4);
  s record;
  a public.hr_attendance;
  v_portion numeric := 0;          -- approved leave portion on a working day (0 or 0.5)
begin
  work_date := p_date;
  day_type := hr_private.attendance_day_type(p_employee, p_date);
  if day_type = 'working' then v_portion := hr_private.leave_portion_on(p_employee, p_date); end if;
  select * into s from hr_private.employee_shift_on(p_employee, p_date);
  select * into a from public.hr_attendance x where x.employee_id = p_employee and x.work_date = p_date;
  shift_id := coalesce(a.shift_id, s.shift_id);
  shift_name := coalesce((select sh.name from public.hr_shifts sh where sh.id = a.shift_id), s.shift_name);
  expected_start_at := coalesce(a.expected_start_at, (p_date + s.start_time) at time zone tz);
  expected_end_at := coalesce(a.expected_end_at,
    case when s.end_time <= s.start_time then ((p_date + 1) + s.end_time) at time zone tz else (p_date + s.end_time) at time zone tz end);
  expected_minutes := case when day_type = 'working'
    then round(hr_private.shift_expected_minutes(s.start_time, s.end_time, s.break_minutes, s.break_paid, s.expected_minutes) * (1 - v_portion))::int
    else 0 end;
  attendance_id := a.id;
  check_in_at := a.check_in_at; check_out_at := a.check_out_at;
  worked_minutes := a.worked_minutes;
  late_minutes := coalesce(a.late_minutes, 0); early_leave_minutes := coalesce(a.early_leave_minutes, 0);
  overtime_minutes := coalesce(a.overtime_minutes, 0);
  source := a.source;
  short_minutes := case when day_type = 'working' and a.worked_minutes is not null then greatest(expected_minutes - a.worked_minutes, 0) else 0 end;
  missing_punch_out := a.check_in_at is not null and a.check_out_at is null
                       and now() > coalesce(a.expected_end_at, a.check_in_at + interval '12 hours') + make_interval(hours => v_after);
  holiday_name := (select h.name from hr_private.holiday_on(p_date, p_employee, false) h);

  status := case
    when a.check_in_at is not null then a.status
    when day_type = 'leave' then 'on_leave'                         -- approved leave wins over a recorded absence
    when a.id is not null then a.status
    when day_type = 'holiday' then 'holiday'
    when day_type = 'weekly_off' then 'weekend'
    when p_date > v_today then 'upcoming'
    when now() < expected_start_at + make_interval(mins => s.grace_minutes) then 'not_started'
    when v_portion > 0 then 'half_day'                              -- half-day leave, no punch for the other half
    else 'absent' end;
  return next;
end $$;

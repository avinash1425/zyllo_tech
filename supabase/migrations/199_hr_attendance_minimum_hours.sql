-- =====================================================================
-- 199: Minimum hours for a half day (Module 5 attendance policy change)
-- =====================================================================
-- Company rule for a normal working day (no approved leave on that date).
-- Once the employee has punched in and out:
--
--   worked <  4 hours                       -> 'absent'   (whole day is leave / LOP)
--   worked >= 4 hours, below a full day     -> 'half_day'
--   worked >= full day                      -> 'present'  (or 'late' if late beyond grace)
--
-- Shift settings (both optional, per shift):
--   * absent_below_minutes (new) : below this many worked minutes the day is
--                                  'absent'. Blank = 240 (4 hours).
--   * half_day_minutes (existing): below this many worked minutes the day is a
--                                  'half_day'. Blank used to mean half of the
--                                  expected hours. It now means the full
--                                  expected hours less the late-arrival and
--                                  early-leave grace (an employee who uses
--                                  only their grace still gets a full day).
--
-- Unchanged:
--   * days with an approved half-day leave keep the 195 rules (the leave covers
--     half the day, so a short day there stays 'half_day', never 'absent');
--   * full-day leave, holidays and weekly offs;
--   * a punch-in with no punch-out yet ('present' / 'late' until punch-out);
--   * explicit HR statuses (manual entry / correction with a status).
-- Stored hr_attendance rows are not recalculated; the next punch, correction
-- or manual entry recalculates a day, as before.
--
-- Redefines hr_private.attendance_compute (same signature; latest was 195).

do $$
begin
  if to_regprocedure('hr_private.leave_half_on(uuid,date)') is null then
    raise exception '199_hr_attendance_minimum_hours requires migration 195 (half-day leave in attendance)';
  end if;
end $$;

alter table public.hr_shifts
  add column if not exists absent_below_minutes smallint check (absent_below_minutes between 0 and 1440);

comment on column public.hr_shifts.absent_below_minutes is
  'Worked minutes below which a punched working day is absent (leave). Null = 240 (4 hours).';
comment on column public.hr_shifts.half_day_minutes is
  'Worked minutes below which a punched working day is a half day. Null = expected minutes less late and early-leave grace.';

-- employee_shift_on (125) does not return the new column; read it by shift id.
create or replace function hr_private.shift_absent_below_minutes(p_shift uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((select s.absent_below_minutes::int from public.hr_shifts s where s.id = p_shift), 240)
$$;
grant execute on function hr_private.shift_absent_below_minutes(uuid) to authenticated, service_role;
revoke execute on function hr_private.shift_absent_below_minutes(uuid) from public, anon;

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
  v_half numeric;                  -- worked minutes below this -> half_day
  v_absent numeric;                -- worked minutes below this -> absent (normal working day only)
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
  if v_portion > 0 then
    v_half := coalesce(s.half_day_minutes, v_net / 2.0) * (1 - v_portion);   -- 195 rule, unchanged
    v_absent := 0;                                                            -- leave covers the other half
  else
    v_half := coalesce(s.half_day_minutes, greatest(v_net - s.grace_minutes - s.early_leave_grace_minutes, 0));
    v_absent := hr_private.shift_absent_below_minutes(s.shift_id);
  end if;
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
    o_status := case when v_working and o_worked < v_absent then 'absent'
                     when v_working and o_worked < v_half then 'half_day'
                     when o_late > 0 then 'late' else 'present' end;
  else
    o_status := case when o_late > 0 then 'late' else 'present' end;
  end if;
  return next;
end $$;

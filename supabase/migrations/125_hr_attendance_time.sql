-- =====================================================================
-- 125_hr_attendance_time.sql — Module 5: Attendance & Time enhancements
-- =====================================================================
-- Extends 101_hr_attendance.sql. Nothing here creates a second attendance
-- or approval system:
--   * hr_attendance stays the single daily record (one row per employee
--     per work date), still written ONLY by SECURITY DEFINER functions.
--   * hr_attendance_corrections stays the single correction /
--     regularization workflow (now typed, staged, with event history).
--
-- Adds:
--   1. Date-effective shift assignments (hr_shift_assignments) with
--      overlap prevention, plus shift fields: expected hours, paid break,
--      half-day threshold, weekly-off rules (e.g. 2nd/4th Saturday off).
--   2. Employee timezone (work location timezone, else business timezone)
--      for the attendance day, expected shift times and validation.
--   3. One day-classification helper (working / weekly_off / holiday /
--      leave) so holidays, weekly offs and approved leave are never
--      reported as absences.
--   4. Punch log (hr_attendance_punches) and original self-punch times
--      preserved on hr_attendance.
--   5. Holiday calendar: annual recurring holidays, company (legal entity)
--      applicability, description; attendance.manage may maintain it.
--   6. Regularization on the existing corrections table: request types,
--      status corrections, evidence reference, snapshot of the original
--      values, applied values, manager -> HR approval sequence
--      (HR stage optional, configurable) and an event history.
--   7. Read RPCs computed from database records: daily overview with
--      KPIs (includes employees with no record), per-employee working
--      hours summary (daily / weekly / monthly), employee calendar,
--      holiday calendar.
--   8. Payroll period lock: approved corrections and HR manual entries
--      cannot change attendance inside a finalized or paid payroll run.
--
-- No salary deductions, payments or overtime payouts are created here.
-- No GPS / biometric data is collected.
--
-- Depends on: 100, 101, 103 (holidays / leave), 105 (payroll runs),
--             112 (is_working_day_for), 113 (legal entities).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Settings (merged; existing values win)
-- ---------------------------------------------------------------------
insert into public.hr_settings (key, value, description) values
  ('attendance', '{}'::jsonb, 'Attendance: correction window and overnight check-out tolerance')
on conflict (key) do nothing;

update public.hr_settings set value = jsonb_build_object(
    'correction_window_days', 30,             -- how far back an employee may request a correction
    'overnight_checkout_hours', 8,            -- how long after an overnight shift ends check-out is still accepted
    'min_punch_gap_minutes', 0,               -- minimum minutes between check-in and check-out (0 = off)
    'missing_punch_after_hours', 4,           -- an open punch counts as a missing punch-out this long after shift end
    'regularization_hr_review', false,        -- true: manager-approved requests also need HR approval
    'regularization_evidence_required', false -- true: requests must include an evidence reference
  ) || value
where key = 'attendance';

-- ---------------------------------------------------------------------
-- Shifts: extra configuration
-- ---------------------------------------------------------------------
-- weekly_off_rules: {"<ISO weekday>": [<week-of-month numbers 1..5>]}
-- e.g. {"6": [2, 4]} = 2nd and 4th Saturday are weekly offs even though
-- Saturday is a working day of the shift.
create or replace function hr_private.valid_weekly_off_rules(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) kv
       where kv.key !~ '^[1-7]$'
          or jsonb_typeof(kv.value) <> 'array'
          or exists (select 1 from jsonb_array_elements(kv.value) w
                     where jsonb_typeof(w) <> 'number' or w::text !~ '^[1-5]$'))
$$;

alter table public.hr_shifts
  add column if not exists code text check (code is null or code ~ '^[A-Z0-9_-]{1,20}$'),
  add column if not exists description text check (length(description) <= 500),
  add column if not exists expected_minutes smallint check (expected_minutes between 1 and 1440),
  add column if not exists break_paid boolean not null default false,
  add column if not exists half_day_minutes smallint check (half_day_minutes between 0 and 1440),
  add column if not exists weekly_off_rules jsonb not null default '{}'::jsonb;
alter table public.hr_shifts drop constraint if exists hr_shifts_weekly_off_rules_valid;
alter table public.hr_shifts add constraint hr_shifts_weekly_off_rules_valid check (hr_private.valid_weekly_off_rules(weekly_off_rules));
create unique index if not exists hr_shifts_code_unique on public.hr_shifts (code) where code is not null;

-- HR attendance managers may maintain shifts (settings.manage already can).
drop policy if exists hr_shifts_insert_attendance on public.hr_shifts;
create policy hr_shifts_insert_attendance on public.hr_shifts for insert to authenticated
  with check (hr_private.has_permission('attendance.manage'));
drop policy if exists hr_shifts_update_attendance on public.hr_shifts;
create policy hr_shifts_update_attendance on public.hr_shifts for update to authenticated
  using (hr_private.has_permission('attendance.manage')) with check (hr_private.has_permission('attendance.manage'));

-- ---------------------------------------------------------------------
-- Shift assignments (date-effective; history is never deleted)
-- ---------------------------------------------------------------------
create table if not exists public.hr_shift_assignments (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.hr_employees(id) on delete restrict,
  shift_id        uuid not null references public.hr_shifts(id) on delete restrict,
  effective_from  date not null,
  effective_to    date,                                   -- null = open-ended
  reason          text check (length(reason) <= 500),
  status          text not null default 'active' check (status in ('active','cancelled')),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists hr_shift_assignments_emp on public.hr_shift_assignments (employee_id, effective_from);
select hr_private.secure_table('public.hr_shift_assignments');
drop trigger if exists hr_shift_assignments_touch on public.hr_shift_assignments;
create trigger hr_shift_assignments_touch before update on public.hr_shift_assignments for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_shift_assignments');
drop policy if exists hr_shift_assignments_read on public.hr_shift_assignments;
create policy hr_shift_assignments_read on public.hr_shift_assignments for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'attendance'));
revoke insert, update, delete, truncate on public.hr_shift_assignments from authenticated;

-- Overlap guard (also enforced for direct owner writes).
create or replace function hr_private.shift_assignment_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and exists (
       select 1 from public.hr_shift_assignments x
       where x.employee_id = new.employee_id and x.id <> new.id and x.status = 'active'
         and daterange(x.effective_from, x.effective_to, '[]') && daterange(new.effective_from, new.effective_to, '[]')) then
    perform hr_private.fail('This employee already has a shift assignment that overlaps these dates.', 'overlap');
  end if;
  return new;
end $$;
drop trigger if exists hr_shift_assignments_guard on public.hr_shift_assignments;
create trigger hr_shift_assignments_guard before insert or update on public.hr_shift_assignments
  for each row execute function hr_private.shift_assignment_guard();

-- Shifts cannot be deactivated while assigned now or in the future, and the
-- default shift must stay active.
create or replace function hr_private.shift_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_default and not new.active then
    perform hr_private.fail('The default shift must be active.', 'invalid');
  end if;
  if tg_op = 'UPDATE' and old.active and not new.active and exists (
       select 1 from public.hr_shift_assignments a
       where a.shift_id = new.id and a.status = 'active'
         and (a.effective_to is null or a.effective_to >= hr_private.business_today())) then
    perform hr_private.fail('This shift is assigned to employees now or in the future. End those assignments first.', 'in_use');
  end if;
  return new;
end $$;
drop trigger if exists hr_shifts_guard on public.hr_shifts;
create trigger hr_shifts_guard before insert or update on public.hr_shifts for each row execute function hr_private.shift_guard();

-- ---------------------------------------------------------------------
-- Timezone and effective shift
-- ---------------------------------------------------------------------
create or replace function hr_private.employee_timezone(p_employee uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(btrim(l.timezone), '') from public.hr_employees e join public.hr_locations l on l.id = e.work_location_id where e.id = p_employee),
    hr_private.business_timezone())
$$;

create or replace function hr_private.employee_today(p_employee uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone hr_private.employee_timezone(p_employee))::date
$$;

-- Effective shift on a date: dated assignment > employee shift > default
-- shift > built-in 09:00-18:00 (10 min grace, 60 min break).
create or replace function hr_private.employee_shift_on(p_employee uuid, p_date date)
returns table (shift_id uuid, shift_name text, start_time time, end_time time, grace_minutes int, break_minutes int,
               early_leave_grace_minutes int, overtime_after_minutes int, working_days smallint[],
               expected_minutes int, break_paid boolean, half_day_minutes int, weekly_off_rules jsonb, source text)
language sql stable security definer set search_path = '' as $$
  select x.shift_id, x.shift_name, x.start_time, x.end_time, x.grace_minutes, x.break_minutes, x.early_leave_grace_minutes,
         x.overtime_after_minutes, x.working_days, x.expected_minutes, x.break_paid, x.half_day_minutes, x.weekly_off_rules, x.source
  from (
    select s.id as shift_id, s.name as shift_name, s.start_time, s.end_time, s.grace_minutes::int as grace_minutes,
           s.break_minutes::int as break_minutes, s.early_leave_grace_minutes::int as early_leave_grace_minutes,
           s.overtime_after_minutes::int as overtime_after_minutes, s.working_days, s.expected_minutes::int as expected_minutes,
           s.break_paid, s.half_day_minutes::int as half_day_minutes, s.weekly_off_rules, 'assignment'::text as source, 1 as pri
    from public.hr_shift_assignments a join public.hr_shifts s on s.id = a.shift_id
    where a.employee_id = p_employee and a.status = 'active'
      and p_date >= a.effective_from and (a.effective_to is null or p_date <= a.effective_to)
    union all
    select s.id, s.name, s.start_time, s.end_time, s.grace_minutes::int, s.break_minutes::int, s.early_leave_grace_minutes::int,
           s.overtime_after_minutes::int, s.working_days, s.expected_minutes::int, s.break_paid, s.half_day_minutes::int, s.weekly_off_rules,
           'employee', 2
    from public.hr_employees e join public.hr_shifts s on s.id = e.shift_id
    where e.id = p_employee
    union all
    select s.id, s.name, s.start_time, s.end_time, s.grace_minutes::int, s.break_minutes::int, s.early_leave_grace_minutes::int,
           s.overtime_after_minutes::int, s.working_days, s.expected_minutes::int, s.break_paid, s.half_day_minutes::int, s.weekly_off_rules,
           'default', 3
    from public.hr_shifts s where s.is_default and s.active
    union all
    select null::uuid, 'Standard (09:00-18:00)', time '09:00', time '18:00', 10, 60, 10, null::int,
           coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(hr_private.setting('company') -> 'working_days') x),
                    '{1,2,3,4,5}'::smallint[]),
           null::int, false, null::int, '{}'::jsonb, 'fallback', 4
  ) x
  order by x.pri, x.shift_id
  limit 1
$$;

-- 101's helper (same signature), now date-aware for "today".
create or replace function hr_private.employee_shift(p_employee uuid)
returns table (shift_id uuid, start_time time, end_time time, grace_minutes int, break_minutes int,
               early_leave_grace_minutes int, overtime_after_minutes int, working_days smallint[])
language sql stable security definer set search_path = '' as $$
  select s.shift_id, s.start_time, s.end_time, s.grace_minutes, s.break_minutes, s.early_leave_grace_minutes,
         s.overtime_after_minutes, s.working_days
  from hr_private.employee_shift_on(p_employee, hr_private.employee_today(p_employee)) s
$$;

-- Shared helper (101/102/103/105, same signature): today's effective shift's days.
create or replace function hr_private.employee_working_days(p_employee uuid)
returns smallint[] language sql stable security definer set search_path = '' as $$
  select s.working_days from hr_private.employee_shift_on(p_employee, hr_private.employee_today(p_employee)) s
$$;

-- Expected net working minutes of a shift.
create or replace function hr_private.shift_expected_minutes(p_start time, p_end time, p_break int, p_break_paid boolean, p_expected int)
returns int language sql immutable set search_path = '' as $$
  select coalesce(p_expected,
    greatest((extract(epoch from (p_end - p_start + case when p_end <= p_start then interval '1 day' else interval '0' end)) / 60)::int
             - case when p_break_paid then 0 else coalesce(p_break, 0) end, 0))
$$;

-- ---------------------------------------------------------------------
-- Holidays: recurring + company applicability
-- ---------------------------------------------------------------------
alter table public.hr_holidays
  add column if not exists is_recurring boolean not null default false,
  add column if not exists legal_entity_id uuid references public.hr_legal_entities(id) on delete cascade,
  add column if not exists description text check (length(description) <= 500);
alter table public.hr_holidays drop constraint if exists hr_holidays_holiday_date_location_id_key;
create unique index if not exists hr_holidays_scope_unique on public.hr_holidays
  (holiday_date, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid));

create or replace function hr_private.holiday_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  if new.is_recurring and extract(month from new.holiday_date) = 2 and extract(day from new.holiday_date) = 29 then
    perform hr_private.fail('A recurring holiday cannot be on 29 February.', 'invalid_date');
  end if;
  return new;
end $$;
drop trigger if exists hr_holidays_guard on public.hr_holidays;
create trigger hr_holidays_guard before insert or update on public.hr_holidays for each row execute function hr_private.holiday_guard();

drop policy if exists hr_holidays_insert_attendance on public.hr_holidays;
create policy hr_holidays_insert_attendance on public.hr_holidays for insert to authenticated
  with check (hr_private.has_permission('attendance.manage'));
drop policy if exists hr_holidays_update_attendance on public.hr_holidays;
create policy hr_holidays_update_attendance on public.hr_holidays for update to authenticated
  using (hr_private.has_permission('attendance.manage')) with check (hr_private.has_permission('attendance.manage'));
drop policy if exists hr_holidays_delete_attendance on public.hr_holidays;
create policy hr_holidays_delete_attendance on public.hr_holidays for delete to authenticated
  using (hr_private.has_permission('attendance.manage'));
drop policy if exists hr_holidays_read_attendance on public.hr_holidays;
create policy hr_holidays_read_attendance on public.hr_holidays for select to authenticated
  using (hr_private.has_permission('attendance.view') or hr_private.has_permission('attendance.manage'));

-- The holiday (non-optional unless asked) that applies to an employee on a date.
create or replace function hr_private.holiday_on(p_date date, p_employee uuid default null, p_include_optional boolean default false)
returns table (id uuid, name text, type text)
language sql stable security definer set search_path = '' as $$
  select h.id, h.name, h.type
  from public.hr_holidays h
  left join public.hr_employees e on e.id = p_employee
  where (p_include_optional or h.type <> 'optional')
    and (h.holiday_date = p_date
         or (h.is_recurring and h.holiday_date <= p_date
             and extract(month from h.holiday_date) = extract(month from p_date)
             and extract(day from h.holiday_date) = extract(day from p_date)))
    and (h.location_id is null or h.location_id = e.work_location_id)
    and (h.legal_entity_id is null or h.legal_entity_id = e.legal_entity_id)
  order by (h.holiday_date = p_date) desc, h.location_id nulls last, h.legal_entity_id nulls last
  limit 1
$$;

-- Shared helper (103, same signature). Optional holidays do not block a working day.
create or replace function hr_private.is_holiday(p_date date, p_employee uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from hr_private.holiday_on(p_date, p_employee, false))
$$;

-- ---------------------------------------------------------------------
-- Day classification (single source of truth)
-- ---------------------------------------------------------------------
create or replace function hr_private.is_weekly_off_rule(p_rules jsonb, p_date date)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce((p_rules -> (extract(isodow from p_date)::int)::text) @> to_jsonb(((extract(day from p_date)::int - 1) / 7) + 1), false)
$$;

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
  if hr_private.is_on_approved_leave(p_employee, p_date) then return 'leave'; end if;
  return 'working';
end $$;

-- Shared helper (112, same signature): scheduled working day (holidays and
-- weekly offs excluded; leave is checked separately by callers).
create or replace function hr_private.is_working_day_for(p_employee uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.attendance_day_type(p_employee, p_date) in ('working', 'leave')
$$;

-- ---------------------------------------------------------------------
-- Payroll period lock
-- ---------------------------------------------------------------------
-- A date is locked for an employee when a finalized / paid payroll run covers
-- it for all companies or for the employee's company. legal_entity_id on
-- hr_payroll_runs is added by 170; it is read through to_jsonb so this works
-- with or without that migration (without it every run is company-wide).
drop function if exists hr_private.assert_attendance_unlocked(date);
drop function if exists hr_private.attendance_period_locked(date);
create or replace function hr_private.attendance_period_locked(p_date date, p_employee uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_entity uuid;
begin
  if to_regclass('public.hr_payroll_runs') is null then return false; end if;
  select e.legal_entity_id into v_entity from public.hr_employees e where e.id = p_employee;
  return exists (
    select 1 from public.hr_payroll_runs r
    where r.status in ('finalized','paid') and p_date between r.period_start and r.period_end
      and ((to_jsonb(r) ->> 'legal_entity_id') is null
           or p_employee is null
           or (to_jsonb(r) ->> 'legal_entity_id')::uuid is not distinct from v_entity));
end $$;

create or replace function hr_private.assert_attendance_unlocked(p_date date, p_employee uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if hr_private.attendance_period_locked(p_date, p_employee) then
    perform hr_private.fail('Attendance for ' || to_char(p_date, 'DD Mon YYYY') || ' is locked by a finalized payroll run.', 'period_locked');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Attendance record: originals + punch log
-- ---------------------------------------------------------------------
alter table public.hr_attendance
  add column if not exists original_check_in_at timestamptz,     -- first self punch-in (never overwritten)
  add column if not exists original_check_out_at timestamptz,    -- first self punch-out (never overwritten)
  add column if not exists timezone text;                        -- timezone used for this work date

create table if not exists public.hr_attendance_punches (
  id             bigint generated always as identity primary key,
  employee_id    uuid not null references public.hr_employees(id) on delete restrict,
  attendance_id  uuid references public.hr_attendance(id) on delete set null,
  work_date      date not null,
  kind           text not null check (kind in ('in','out')),
  punched_at     timestamptz not null,
  source         text not null check (source in ('self','manual','correction')),
  note           text check (length(note) <= 1000),
  recorded_by    uuid default auth.uid(),
  recorded_at    timestamptz not null default now()
);
create index if not exists hr_attendance_punches_emp on public.hr_attendance_punches (employee_id, work_date desc, recorded_at);
select hr_private.secure_table('public.hr_attendance_punches');
drop policy if exists hr_attendance_punches_read on public.hr_attendance_punches;
create policy hr_attendance_punches_read on public.hr_attendance_punches for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'attendance'));
revoke insert, update, delete, truncate on public.hr_attendance_punches from authenticated;

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
begin
  select * into s from hr_private.employee_shift_on(p_employee, p_work_date);
  o_shift_id := s.shift_id;
  o_expected_start := (p_work_date + s.start_time) at time zone tz;
  o_expected_end := (p_work_date + s.end_time) at time zone tz;
  if s.end_time <= s.start_time then                -- overnight shift
    o_expected_end := ((p_work_date + 1) + s.end_time) at time zone tz;
  end if;
  v_net := hr_private.shift_expected_minutes(s.start_time, s.end_time, s.break_minutes, s.break_paid, s.expected_minutes);
  v_half := coalesce(s.half_day_minutes, v_net / 2.0);
  o_break := 0; o_worked := null; o_late := 0; o_early := 0; o_overtime := 0;

  if p_in is null then
    o_status := case v_day when 'holiday' then 'holiday' when 'weekly_off' then 'weekend' when 'leave' then 'on_leave' else 'absent' end;
    return next; return;
  end if;

  if v_working then
    v_diff := floor(extract(epoch from p_in - o_expected_start) / 60)::int;
    if v_diff > s.grace_minutes then o_late := v_diff; end if;
  end if;

  if p_out is not null then
    v_span := floor(extract(epoch from p_out - p_in) / 60)::int;
    o_break := case when s.break_paid then 0 else least(s.break_minutes, v_span) end;
    o_worked := greatest(v_span - case when s.break_paid then 0 else s.break_minutes end, 0);
    if v_working then
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

-- Upsert one attendance row with freshly calculated fields and log changed
-- punch times. p_punch = 'in' / 'out' marks an ordinary self punch, whose
-- time is also kept as the original (never overwritten afterwards).
drop function if exists hr_private.attendance_write(uuid, date, timestamptz, timestamptz, text, text, text, text, text);
create or replace function hr_private.attendance_write(
  p_employee uuid, p_date date, p_in timestamptz, p_out timestamptz, p_source text,
  p_status text default null, p_in_note text default null, p_out_note text default null, p_notes text default null,
  p_punch text default null)
returns public.hr_attendance
language plpgsql security definer set search_path = '' as $$
declare c record; prev public.hr_attendance; r public.hr_attendance;
begin
  select * into prev from public.hr_attendance where employee_id = p_employee and work_date = p_date;
  select * into c from hr_private.attendance_compute(p_employee, p_date, p_in, p_out);
  insert into public.hr_attendance as a (employee_id, work_date, shift_id, expected_start_at, expected_end_at,
      check_in_at, check_out_at, break_minutes, worked_minutes, late_minutes, early_leave_minutes, overtime_minutes,
      status, source, check_in_note, check_out_note, notes, updated_by, original_check_in_at, original_check_out_at, timezone)
  values (p_employee, p_date, c.o_shift_id, c.o_expected_start, c.o_expected_end,
      p_in, p_out, c.o_break, c.o_worked, c.o_late, c.o_early, c.o_overtime,
      coalesce(p_status, c.o_status), p_source, nullif(btrim(p_in_note), ''), nullif(btrim(p_out_note), ''), nullif(btrim(p_notes), ''), auth.uid(),
      case when p_punch = 'in' then p_in end, case when p_punch = 'out' then p_out end, hr_private.employee_timezone(p_employee))
  on conflict (employee_id, work_date) do update set
      shift_id = excluded.shift_id, expected_start_at = excluded.expected_start_at, expected_end_at = excluded.expected_end_at,
      check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, break_minutes = excluded.break_minutes,
      worked_minutes = excluded.worked_minutes, late_minutes = excluded.late_minutes,
      early_leave_minutes = excluded.early_leave_minutes, overtime_minutes = excluded.overtime_minutes,
      status = excluded.status, source = excluded.source,
      check_in_note = coalesce(excluded.check_in_note, a.check_in_note),
      check_out_note = coalesce(excluded.check_out_note, a.check_out_note),
      notes = coalesce(excluded.notes, a.notes),
      original_check_in_at = coalesce(a.original_check_in_at, excluded.original_check_in_at),
      original_check_out_at = coalesce(a.original_check_out_at, excluded.original_check_out_at),
      timezone = excluded.timezone,
      updated_by = excluded.updated_by
  returning * into r;

  if p_in is not null and p_in is distinct from prev.check_in_at then
    insert into public.hr_attendance_punches (employee_id, attendance_id, work_date, kind, punched_at, source, note)
    values (p_employee, r.id, p_date, 'in', p_in, p_source, coalesce(nullif(btrim(p_in_note), ''), nullif(btrim(p_notes), '')));
  end if;
  if p_out is not null and p_out is distinct from prev.check_out_at then
    insert into public.hr_attendance_punches (employee_id, attendance_id, work_date, kind, punched_at, source, note)
    values (p_employee, r.id, p_date, 'out', p_out, p_source, coalesce(nullif(btrim(p_out_note), ''), nullif(btrim(p_notes), '')));
  end if;
  return r;
end $$;

-- Validates a punch pair against its work date in the employee's timezone.
-- A check-in may fall on the next calendar day only for an overnight shift
-- and only before that shift's end.
create or replace function hr_private.attendance_validate_times_for(p_employee uuid, p_date date, p_in timestamptz, p_out timestamptz)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := hr_private.employee_timezone(p_employee);
  s record;
  v_local date;
begin
  if p_in is null and p_out is not null then
    perform hr_private.fail('A check-out time needs a check-in time.', 'invalid_times');
  end if;
  if p_in is not null then
    v_local := (p_in at time zone tz)::date;
    if v_local <> p_date then
      select * into s from hr_private.employee_shift_on(p_employee, p_date);
      if not (v_local = p_date + 1 and s.end_time <= s.start_time and p_in < ((p_date + 1) + s.end_time) at time zone tz) then
        perform hr_private.fail('Check-in time must fall on the attendance date.', 'invalid_times');
      end if;
    end if;
  end if;
  if p_out is not null and p_out <= p_in then
    perform hr_private.fail('Check-out must be after check-in.', 'invalid_times');
  end if;
  if p_out is not null and p_out - p_in > interval '24 hours' then
    perform hr_private.fail('A single attendance record cannot exceed 24 hours.', 'invalid_times');
  end if;
  if coalesce(p_out, p_in) > now() then
    perform hr_private.fail('Attendance times cannot be in the future.', 'invalid_times');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Self check-in / check-out (caller only, server time, employee timezone)
-- ---------------------------------------------------------------------
-- The record an open punch belongs to: today's, or yesterday's overnight
-- shift that is still inside its check-out tolerance.
create or replace function hr_private.open_attendance(p_employee uuid)
returns public.hr_attendance language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := hr_private.employee_today(p_employee);
  v_tz text := hr_private.employee_timezone(p_employee);
  v_tol int := coalesce((hr_private.setting('attendance') ->> 'overnight_checkout_hours')::int, 8);
  r public.hr_attendance;
begin
  select * into r from public.hr_attendance a
  where a.employee_id = p_employee and a.check_in_at is not null and a.check_out_at is null
    and (a.work_date = v_today
         or (a.work_date = v_today - 1
             and (a.expected_end_at at time zone v_tz)::date > a.work_date
             and now() <= a.expected_end_at + make_interval(hours => v_tol)))
  order by a.work_date desc
  limit 1;
  return r;
end $$;

create or replace function public.hr_check_in(p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_today date;
  v_tz text;
  v_date date;
  v_now timestamptz := clock_timestamp();
  y record;
  r public.hr_attendance;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  if length(p_note) > 500 then perform hr_private.fail('The note can be at most 500 characters.', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtext('hr_attendance:' || v_me::text));
  v_today := hr_private.employee_today(v_me);
  v_tz := hr_private.employee_timezone(v_me);
  v_date := v_today;

  -- Late arrival for yesterday's overnight shift (e.g. 22:00-06:00, punching in at 00:30).
  select * into y from hr_private.employee_shift_on(v_me, v_today - 1);
  if y.end_time <= y.start_time
     and hr_private.attendance_day_type(v_me, v_today - 1) = 'working'
     and v_now < (v_today + y.end_time) at time zone v_tz then
    select * into r from public.hr_attendance where employee_id = v_me and work_date = v_today - 1;
    if r.id is not null and r.check_in_at is not null and r.check_out_at is null then
      perform hr_private.fail('You are already checked in for your overnight shift.', 'already_checked_in');
    end if;
    if r.id is null or r.check_in_at is null then
      v_date := v_today - 1;
    end if;
  end if;

  select * into r from public.hr_attendance where employee_id = v_me and work_date = v_date for update;
  if r.id is not null and r.check_in_at is not null then
    perform hr_private.fail('You have already checked in today.', 'already_checked_in');
  end if;
  r := hr_private.attendance_write(v_me, v_date, v_now, null, 'self', null, p_note, null, null, 'in');
  return to_jsonb(r);
end $$;

create or replace function public.hr_check_out(p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_today date;
  v_gap int := coalesce((hr_private.setting('attendance') ->> 'min_punch_gap_minutes')::int, 0);
  v_now timestamptz := clock_timestamp();
  r public.hr_attendance;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  if length(p_note) > 500 then perform hr_private.fail('The note can be at most 500 characters.', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtext('hr_attendance:' || v_me::text));
  v_today := hr_private.employee_today(v_me);
  r := hr_private.open_attendance(v_me);
  if r.id is null then
    if exists (select 1 from public.hr_attendance where employee_id = v_me and work_date = v_today and check_out_at is not null) then
      perform hr_private.fail('You have already checked out today.', 'already_checked_out');
    end if;
    perform hr_private.fail('You have not checked in today.', 'not_checked_in');
  end if;
  if v_gap > 0 and v_now < r.check_in_at + make_interval(mins => v_gap) then
    perform hr_private.fail('You checked in less than ' || v_gap || ' minute(s) ago.', 'too_soon');
  end if;
  perform 1 from public.hr_attendance where id = r.id for update;
  r := hr_private.attendance_write(v_me, r.work_date, r.check_in_at, v_now, r.source, null, null, p_note, null, 'out');
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- One computed day (record + schedule). Callers check access first.
-- ---------------------------------------------------------------------
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
begin
  work_date := p_date;
  day_type := hr_private.attendance_day_type(p_employee, p_date);
  select * into s from hr_private.employee_shift_on(p_employee, p_date);
  select * into a from public.hr_attendance x where x.employee_id = p_employee and x.work_date = p_date;
  shift_id := coalesce(a.shift_id, s.shift_id);
  shift_name := coalesce((select sh.name from public.hr_shifts sh where sh.id = a.shift_id), s.shift_name);
  expected_start_at := coalesce(a.expected_start_at, (p_date + s.start_time) at time zone tz);
  expected_end_at := coalesce(a.expected_end_at,
    case when s.end_time <= s.start_time then ((p_date + 1) + s.end_time) at time zone tz else (p_date + s.end_time) at time zone tz end);
  expected_minutes := case when day_type = 'working'
    then hr_private.shift_expected_minutes(s.start_time, s.end_time, s.break_minutes, s.break_paid, s.expected_minutes) else 0 end;
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
    else 'absent' end;
  return next;
end $$;

-- Totals for one employee over a range (days in the future are skipped).
create or replace function hr_private.attendance_totals(p_employee uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with emp as (select e.joining_date, e.last_working_date from public.hr_employees e where e.id = p_employee),
  days as (
    select d.* from emp, generate_series(greatest(p_from, coalesce(emp.joining_date, p_from)),
                                         least(p_to, coalesce(emp.last_working_date, p_to), hr_private.employee_today(p_employee)),
                                         interval '1 day') g
    cross join lateral hr_private.attendance_day(p_employee, g::date) d
  )
  select jsonb_build_object(
    'scheduled_days',   count(*) filter (where day_type in ('working','leave')),
    'working_days',     count(*) filter (where day_type = 'working'),
    'present_days',     count(*) filter (where check_in_at is not null),
    'absent_days',      count(*) filter (where status = 'absent'),
    'leave_days',       count(*) filter (where status = 'on_leave'),
    'holidays',         count(*) filter (where day_type = 'holiday'),
    'weekly_offs',      count(*) filter (where day_type = 'weekly_off'),
    'late_days',        count(*) filter (where late_minutes > 0),
    'late_minutes',     coalesce(sum(late_minutes), 0),
    'half_days',        count(*) filter (where status = 'half_day'),
    'missing_punch_days', count(*) filter (where missing_punch_out or status = 'missing_punch'),
    'worked_minutes',   coalesce(sum(worked_minutes), 0),
    'expected_minutes', coalesce(sum(expected_minutes) filter (where status <> 'not_started'), 0),
    'short_minutes',    coalesce(sum(short_minutes), 0),
    'overtime_minutes', coalesce(sum(overtime_minutes), 0),
    'early_leave_minutes', coalesce(sum(early_leave_minutes), 0))
  from days
$$;

-- In-scope employees for HR / manager views.
create or replace function hr_private.attendance_scope(p_date date, p_department uuid, p_legal_entity uuid, p_employee uuid, p_search text)
returns table (id uuid, employee_code text, name text, department_id uuid, department_name text, legal_entity_id uuid, manager_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.id, e.employee_code, coalesce(nullif(e.display_name, ''), btrim(e.first_name || ' ' || e.last_name)), e.department_id, d.name,
         e.legal_entity_id, e.manager_id
  from public.hr_employees e
  left join public.hr_departments d on d.id = e.department_id
  where e.status in ('active','probation','notice_period','onboarding','suspended')
    and (e.joining_date is null or e.joining_date <= p_date)
    and (e.last_working_date is null or e.last_working_date >= p_date)
    and (p_department is null or e.department_id = p_department)
    and (p_legal_entity is null or e.legal_entity_id = p_legal_entity)
    and (p_employee is null or e.id = p_employee)
    and (nullif(btrim(p_search), '') is null
         or e.employee_code ilike '%' || btrim(p_search) || '%'
         or coalesce(e.display_name, '') ilike '%' || btrim(p_search) || '%'
         or (e.first_name || ' ' || e.last_name) ilike '%' || btrim(p_search) || '%')
    and (hr_private.has_permission('attendance.view')
         or (hr_private.has_permission('attendance.view_team') and hr_private.is_manager_of(e.id)))
$$;

-- ---------------------------------------------------------------------
-- HR / manager: daily overview
-- ---------------------------------------------------------------------
create or replace function public.hr_attendance_overview(
  p_date date default null, p_department uuid default null, p_status text default null,
  p_search text default null, p_legal_entity uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, hr_private.business_today());
  v_rows jsonb;
  v_kpi jsonb;
  v_pending int;
begin
  if not (hr_private.has_permission('attendance.view') or hr_private.has_permission('attendance.view_team')) then
    perform hr_private.fail('You are not allowed to view attendance.', 'forbidden');
  end if;
  if v_date > hr_private.business_today() + 1 then
    perform hr_private.fail('The overview is available for today and past dates.', 'invalid_date');
  end if;

  with ov as (
    select jsonb_build_object(
             'employee', jsonb_build_object('id', e.id, 'employee_code', e.employee_code, 'name', e.name,
                                            'department_id', e.department_id, 'department_name', e.department_name,
                                            'legal_entity_id', e.legal_entity_id, 'manager_id', e.manager_id),
             'work_date', d.work_date, 'day_type', d.day_type, 'status', d.status, 'attendance_id', d.attendance_id,
             'shift_id', d.shift_id, 'shift_name', d.shift_name, 'expected_start_at', d.expected_start_at, 'expected_end_at', d.expected_end_at,
             'expected_minutes', d.expected_minutes, 'check_in_at', d.check_in_at, 'check_out_at', d.check_out_at,
             'worked_minutes', d.worked_minutes, 'late_minutes', d.late_minutes, 'early_leave_minutes', d.early_leave_minutes,
             'overtime_minutes', d.overtime_minutes, 'short_minutes', d.short_minutes, 'source', d.source,
             'missing_punch_out', d.missing_punch_out, 'holiday_name', d.holiday_name) as row,
           e.name, d.status, d.check_in_at is not null as check_in, d.late_minutes as late, d.worked_minutes as worked,
           d.overtime_minutes as ot, (d.missing_punch_out or d.status = 'missing_punch') as missing
    from hr_private.attendance_scope(v_date, p_department, p_legal_entity, null, p_search) e
    cross join lateral hr_private.attendance_day(e.id, v_date) d
  )
  select jsonb_build_object(
           'employees',        count(*),
           'present',          count(*) filter (where check_in),
           'late',             count(*) filter (where late > 0),
           'absent',           count(*) filter (where status = 'absent'),
           'on_leave',         count(*) filter (where status = 'on_leave'),
           'holiday',          count(*) filter (where status = 'holiday'),
           'weekly_off',       count(*) filter (where status = 'weekend'),
           'not_started',      count(*) filter (where status = 'not_started'),
           'half_day',         count(*) filter (where status = 'half_day'),
           'missing_punch_out', count(*) filter (where missing),
           'worked_minutes',   coalesce(sum(worked), 0),
           'overtime_minutes', coalesce(sum(ot), 0)),
         coalesce(jsonb_agg(row order by name) filter (
           where p_status is null or p_status = '' or status = p_status
              or (p_status = 'late' and late > 0) or (p_status = 'missing_punch_out' and missing)
              or (p_status = 'present_any' and check_in)), '[]'::jsonb)
  into v_kpi, v_rows
  from ov;

  select count(*) into v_pending
  from public.hr_attendance_corrections c
  join hr_private.attendance_scope(v_date, p_department, p_legal_entity, null, null) e on e.id = c.employee_id
  where c.status = 'pending';

  return jsonb_build_object('date', v_date, 'kpis', v_kpi || jsonb_build_object('pending_corrections', v_pending), 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------------
-- HR / manager: working-hours summary per employee
-- ---------------------------------------------------------------------
create or replace function public.hr_attendance_summary(
  p_from date, p_to date, p_department uuid default null, p_employee uuid default null,
  p_legal_entity uuid default null, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (hr_private.has_permission('attendance.view') or hr_private.has_permission('attendance.view_team')) then
    perform hr_private.fail('You are not allowed to view attendance.', 'forbidden');
  end if;
  if p_from is null or p_to is null or p_to < p_from then perform hr_private.fail('Choose a valid date range.', 'invalid_range'); end if;
  if p_to - p_from > 92 then perform hr_private.fail('The range can be at most 93 days.', 'invalid_range'); end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'employee', jsonb_build_object('id', e.id, 'employee_code', e.employee_code, 'name', e.name,
                                            'department_id', e.department_id, 'department_name', e.department_name),
             'totals', hr_private.attendance_totals(e.id, p_from, p_to)) order by e.name), '[]'::jsonb)
    from hr_private.attendance_scope(p_to, p_department, p_legal_entity, p_employee, p_search) e);
end $$;

-- ---------------------------------------------------------------------
-- Employee self-service
-- ---------------------------------------------------------------------
create or replace function public.hr_my_attendance_today()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_today date;
  r public.hr_attendance;
  o public.hr_attendance;
  s record;
  d record;
  v_type text;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  v_today := hr_private.employee_today(v_me);
  o := hr_private.open_attendance(v_me);
  if o.id is not null then r := o;
  else select * into r from public.hr_attendance where employee_id = v_me and work_date = v_today;
  end if;
  select * into s from hr_private.employee_shift_on(v_me, coalesce(r.work_date, v_today));
  select * into d from hr_private.attendance_day(v_me, coalesce(r.work_date, v_today));
  v_type := d.day_type;
  return jsonb_build_object(
    'work_date', coalesce(r.work_date, v_today),
    'timezone', hr_private.employee_timezone(v_me),
    'server_time', now(),
    'checked_in', r.check_in_at is not null,
    'checked_out', r.check_out_at is not null,
    'can_check_in', o.id is null and (r.check_in_at is null),
    'can_check_out', o.id is not null,
    'running_minutes', case when o.id is not null then greatest(floor(extract(epoch from now() - o.check_in_at) / 60)::int, 0) end,
    'record', case when r.id is null then null else to_jsonb(r) end,
    'day', to_jsonb(d),
    'pending_corrections', (select count(*) from public.hr_attendance_corrections c where c.employee_id = v_me and c.status = 'pending'),
    'shift', jsonb_build_object('shift_id', s.shift_id, 'name', s.shift_name, 'source', s.source,
                                'start_time', s.start_time, 'end_time', s.end_time,
                                'overnight', s.end_time <= s.start_time,
                                'grace_minutes', s.grace_minutes, 'break_minutes', s.break_minutes, 'break_paid', s.break_paid,
                                'early_leave_grace_minutes', s.early_leave_grace_minutes,
                                'overtime_after_minutes', s.overtime_after_minutes, 'working_days', to_jsonb(s.working_days),
                                'weekly_off_rules', s.weekly_off_rules,
                                'expected_minutes', hr_private.shift_expected_minutes(s.start_time, s.end_time, s.break_minutes, s.break_paid, s.expected_minutes),
                                'day_type', v_type,
                                'is_working_day', v_type in ('working','leave')));
end $$;

-- Month calendar: one computed row per day, weekly and monthly totals.
create or replace function public.hr_my_attendance_calendar(p_month text default null, p_employee uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_emp uuid := coalesce(p_employee, v_me);
  v_from date;
  v_to date;
begin
  if v_emp is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  if not hr_private.can_access_employee(v_emp, 'attendance') then
    perform hr_private.fail('You are not allowed to view this attendance.', 'forbidden');
  end if;
  if p_month is not null and p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then perform hr_private.fail('Month must be YYYY-MM.', 'invalid'); end if;
  v_from := coalesce(to_date(p_month || '-01', 'YYYY-MM-DD'), date_trunc('month', hr_private.employee_today(v_emp))::date);
  v_to := (v_from + interval '1 month' - interval '1 day')::date;
  return jsonb_build_object(
    'employee_id', v_emp, 'month', to_char(v_from, 'YYYY-MM'), 'from', v_from, 'to', v_to,
    'timezone', hr_private.employee_timezone(v_emp),
    'days', (select coalesce(jsonb_agg(to_jsonb(d) order by d.work_date), '[]'::jsonb)
             from generate_series(v_from, v_to, interval '1 day') g cross join lateral hr_private.attendance_day(v_emp, g::date) d),
    'weeks', (select coalesce(jsonb_agg(jsonb_build_object('week_start', w.ws, 'from', greatest(w.ws, v_from), 'to', least(w.ws + 6, v_to),
                                                           'totals', hr_private.attendance_totals(v_emp, greatest(w.ws, v_from), least(w.ws + 6, v_to)))
                                        order by w.ws), '[]'::jsonb)
              from (select distinct date_trunc('week', g)::date ws from generate_series(v_from, v_to, interval '1 day') g) w),
    'totals', hr_private.attendance_totals(v_emp, v_from, v_to));
end $$;

-- Holiday calendar occurrences (recurring holidays expanded) in a range.
-- Employees see the holidays that apply to them; attendance/leave viewers
-- may ask for every holiday (p_all) or for a specific employee.
create or replace function public.hr_holiday_calendar(p_from date, p_to date, p_employee uuid default null, p_all boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_hr boolean := hr_private.has_permission('attendance.view') or hr_private.has_permission('attendance.manage')
                  or hr_private.has_permission('leave.view') or hr_private.has_permission('leave.manage');
  v_emp uuid := coalesce(p_employee, v_me);
  e record;
begin
  if v_me is null and not v_hr then perform hr_private.fail('You are not allowed to view the holiday calendar.', 'forbidden'); end if;
  if p_all and not v_hr then perform hr_private.fail('You are not allowed to view every holiday.', 'forbidden'); end if;
  if p_employee is not null and p_employee is distinct from v_me and not hr_private.can_access_employee(p_employee, 'attendance') then
    perform hr_private.fail('You are not allowed to view this employee''s holidays.', 'forbidden');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    perform hr_private.fail('Choose a valid date range (at most two years).', 'invalid_range');
  end if;
  select work_location_id, legal_entity_id into e from public.hr_employees where id = v_emp;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', h.id, 'date', o.d, 'name', h.name, 'type', h.type, 'description', h.description,
             'is_recurring', h.is_recurring, 'location_id', h.location_id, 'legal_entity_id', h.legal_entity_id,
             'location_name', l.name, 'legal_entity_name', le.name) order by o.d, h.name), '[]'::jsonb)
    from public.hr_holidays h
    cross join lateral (
      select h.holiday_date d where not h.is_recurring and h.holiday_date between p_from and p_to
      union
      select make_date(y::int, extract(month from h.holiday_date)::int, extract(day from h.holiday_date)::int)
      from generate_series(extract(year from p_from)::int, extract(year from p_to)::int) y
      where h.is_recurring and make_date(y::int, extract(month from h.holiday_date)::int, extract(day from h.holiday_date)::int) between greatest(p_from, h.holiday_date) and p_to
    ) o
    left join public.hr_locations l on l.id = h.location_id
    left join public.hr_legal_entities le on le.id = h.legal_entity_id
    where p_all
       or ((h.location_id is null or h.location_id = e.work_location_id)
           and (h.legal_entity_id is null or h.legal_entity_id = e.legal_entity_id)));
end $$;

-- ---------------------------------------------------------------------
-- Shift assignment RPCs (attendance.manage)
-- ---------------------------------------------------------------------
create or replace function public.hr_assign_shift(p_employee uuid, p_shift uuid, p_from date, p_to date default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_shift_assignments;
  x public.hr_shift_assignments;
begin
  if not hr_private.has_permission('attendance.manage') then
    perform hr_private.fail('You are not allowed to manage shifts.', 'forbidden');
  end if;
  if p_employee is not distinct from hr_private.current_employee_id() then
    perform hr_private.fail('You cannot change your own shift assignment.', 'self_edit');
  end if;
  if not exists (select 1 from public.hr_employees where id = p_employee and status not in ('exited','archived')) then
    perform hr_private.fail('Employee not found or no longer employed.', 'not_found');
  end if;
  if not exists (select 1 from public.hr_shifts where id = p_shift and active) then
    perform hr_private.fail('Choose an active shift.', 'invalid_shift');
  end if;
  if p_from is null then perform hr_private.fail('Choose the date the shift starts.', 'invalid_date'); end if;
  if p_to is not null and p_to < p_from then perform hr_private.fail('The end date must be on or after the start date.', 'invalid_date'); end if;
  if length(p_reason) > 500 then perform hr_private.fail('The reason can be at most 500 characters.', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtext('hr_shift_assignment:' || p_employee::text));

  -- A shift change: an earlier open-ended assignment is ended the day before.
  for x in
    select * from public.hr_shift_assignments a
    where a.employee_id = p_employee and a.status = 'active' and a.effective_from < p_from and a.effective_to is null
    for update
  loop
    update public.hr_shift_assignments set effective_to = p_from - 1, updated_by = auth.uid() where id = x.id;
  end loop;

  insert into public.hr_shift_assignments (employee_id, shift_id, effective_from, effective_to, reason)
  values (p_employee, p_shift, p_from, p_to, nullif(btrim(p_reason), ''))
  returning * into r;

  perform hr_private.notify_employee(p_employee, 'attendance.shift_assigned', 'Shift updated',
    'Your shift is now ' || (select name from public.hr_shifts where id = p_shift) || ' from ' || to_char(p_from, 'DD Mon YYYY') || '.',
    '/employee/attendance', 'hr_shift_assignments', r.id::text);
  return to_jsonb(r);
end $$;

create or replace function public.hr_end_shift_assignment(p_id uuid, p_to date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_shift_assignments;
begin
  if not hr_private.has_permission('attendance.manage') then
    perform hr_private.fail('You are not allowed to manage shifts.', 'forbidden');
  end if;
  select * into r from public.hr_shift_assignments where id = p_id for update;
  if r.id is null or r.status <> 'active' then perform hr_private.fail('Shift assignment not found.', 'not_found'); end if;
  if r.employee_id is not distinct from hr_private.current_employee_id() then
    perform hr_private.fail('You cannot change your own shift assignment.', 'self_edit');
  end if;
  if p_to is null or p_to < r.effective_from then
    perform hr_private.fail('The end date must be on or after the start date.', 'invalid_date');
  end if;
  update public.hr_shift_assignments set effective_to = p_to, updated_by = auth.uid(),
    reason = coalesce(nullif(btrim(p_reason), ''), reason)
  where id = p_id returning * into r;
  return to_jsonb(r);
end $$;

-- Only assignments that have not started can be cancelled; started ones
-- are ended so the history stays accurate.
create or replace function public.hr_cancel_shift_assignment(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_shift_assignments;
begin
  if not hr_private.has_permission('attendance.manage') then
    perform hr_private.fail('You are not allowed to manage shifts.', 'forbidden');
  end if;
  select * into r from public.hr_shift_assignments where id = p_id for update;
  if r.id is null or r.status <> 'active' then perform hr_private.fail('Shift assignment not found.', 'not_found'); end if;
  if r.employee_id is not distinct from hr_private.current_employee_id() then
    perform hr_private.fail('You cannot change your own shift assignment.', 'self_edit');
  end if;
  if r.effective_from <= hr_private.employee_today(r.employee_id) then
    perform hr_private.fail('This assignment has already started. Set an end date instead.', 'already_started');
  end if;
  update public.hr_shift_assignments set status = 'cancelled', updated_by = auth.uid(),
    reason = coalesce(nullif(btrim(p_reason), ''), reason)
  where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Missing punches (101 body + overnight / tolerance awareness)
-- ---------------------------------------------------------------------
create or replace function public.hr_mark_missing_punches(p_date date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, hr_private.business_today() - 1);
  v_tol int := coalesce((hr_private.setting('attendance') ->> 'overnight_checkout_hours')::int, 8);
  v_count int := 0;
  r record;
begin
  if not (hr_private.has_permission('attendance.manage') or coalesce(auth.role(), '') = 'service_role') then
    perform hr_private.fail('You are not allowed to manage attendance.', 'forbidden');
  end if;
  if v_date >= hr_private.business_today() then
    perform hr_private.fail('Missing punches can only be marked for past dates.', 'invalid_date');
  end if;
  for r in
    update public.hr_attendance set status = 'missing_punch', updated_by = auth.uid()
    where work_date = v_date and check_in_at is not null and check_out_at is null and status <> 'missing_punch'
      and now() > coalesce(expected_end_at, check_in_at) + make_interval(hours => v_tol)   -- overnight shift may still be running
    returning id, employee_id
  loop
    v_count := v_count + 1;
    perform hr_private.notify_employee(r.employee_id, 'attendance.missing_punch', 'Missing check-out',
      'You did not check out on ' || to_char(v_date, 'DD Mon YYYY') || '. Please request an attendance correction.',
      '/employee/attendance', 'hr_attendance', r.id::text);
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Corrections / regularization (same table and approval engine)
-- ---------------------------------------------------------------------
alter table public.hr_attendance_corrections
  add column if not exists request_type text not null default 'incorrect_time'
    check (request_type in ('missed_punch_in','missed_punch_out','incorrect_time','status_correction','regularization')),
  add column if not exists requested_status text check (requested_status in ('present','half_day','absent')),
  add column if not exists evidence_note text check (length(evidence_note) <= 1000),
  add column if not exists original_check_in_at timestamptz,
  add column if not exists original_check_out_at timestamptz,
  add column if not exists original_status text,
  add column if not exists applied_check_in_at timestamptz,
  add column if not exists applied_check_out_at timestamptz,
  add column if not exists applied_status text,
  add column if not exists approval_stage text not null default 'manager' check (approval_stage in ('manager','hr','completed')),
  add column if not exists manager_employee_id uuid references public.hr_employees(id) on delete set null,
  add column if not exists manager_decided_by uuid,
  add column if not exists manager_decided_at timestamptz,
  add column if not exists manager_note text check (length(manager_note) <= 1000);

-- Allow status-only corrections.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.hr_attendance_corrections'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%requested_check_in_at IS NOT NULL%requested_check_out_at IS NOT NULL%'
  loop
    execute format('alter table public.hr_attendance_corrections drop constraint %I', c);
  end loop;
end $$;
alter table public.hr_attendance_corrections drop constraint if exists hr_attendance_corrections_has_change;
alter table public.hr_attendance_corrections add constraint hr_attendance_corrections_has_change
  check (requested_check_in_at is not null or requested_check_out_at is not null or requested_status is not null);
update public.hr_attendance_corrections set approval_stage = 'completed' where status <> 'pending' and approval_stage <> 'completed';

create table if not exists public.hr_attendance_correction_events (
  id             bigint generated always as identity primary key,
  correction_id  uuid not null references public.hr_attendance_corrections(id) on delete cascade,
  action         text not null check (action in ('submitted','manager_approved','approved','rejected','cancelled')),
  stage          text,
  actor_employee_id uuid references public.hr_employees(id) on delete set null,
  actor_user_id  uuid default auth.uid(),
  note           text check (length(note) <= 1000),
  created_at     timestamptz not null default now()
);
create index if not exists hr_attendance_correction_events_c on public.hr_attendance_correction_events (correction_id, created_at);
select hr_private.secure_table('public.hr_attendance_correction_events');
drop policy if exists hr_attendance_correction_events_read on public.hr_attendance_correction_events;
create policy hr_attendance_correction_events_read on public.hr_attendance_correction_events for select to authenticated
  using (exists (select 1 from public.hr_attendance_corrections c where c.id = correction_id
                 and hr_private.can_access_employee(c.employee_id, 'attendance')));
revoke insert, update, delete, truncate on public.hr_attendance_correction_events from authenticated;

create or replace function hr_private.correction_event(p_id uuid, p_action text, p_stage text, p_note text)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_attendance_correction_events (correction_id, action, stage, actor_employee_id, note)
  values (p_id, p_action, p_stage, hr_private.current_employee_id(), nullif(btrim(p_note), ''))
$$;

-- Manager who can act on a request: the employee's manager, when that
-- manager has an active portal user.
create or replace function hr_private.correction_manager(p_employee uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.hr_employees e join public.hr_employees m on m.id = e.manager_id
  where e.id = p_employee and m.user_id is not null and m.status not in ('exited','archived','suspended')
$$;

create or replace function public.hr_request_attendance_regularization(
  p_work_date date, p_request_type text, p_check_in timestamptz default null, p_check_out timestamptz default null,
  p_requested_status text default null, p_reason text default null, p_evidence text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_today date;
  cfg jsonb := coalesce(hr_private.setting('attendance'), '{}'::jsonb);
  v_window int := coalesce((cfg ->> 'correction_window_days')::int, 30);
  v_type text := coalesce(nullif(btrim(p_request_type), ''), 'regularization');
  v_mgr uuid;
  a public.hr_attendance;
  v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  v_today := hr_private.employee_today(v_me);
  if v_type not in ('missed_punch_in','missed_punch_out','incorrect_time','status_correction','regularization') then
    perform hr_private.fail('Choose a valid request type.', 'invalid_type');
  end if;
  if p_work_date is null or p_work_date > v_today then
    perform hr_private.fail('Corrections can only be requested for today or past dates.', 'invalid_date');
  end if;
  if p_work_date < v_today - v_window then
    perform hr_private.fail('This date is outside the correction window of ' || v_window || ' days.', 'outside_window');
  end if;
  perform hr_private.assert_attendance_unlocked(p_work_date, v_me);
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform hr_private.fail('Please give a reason for the correction.', 'reason_required');
  end if;
  if length(p_reason) > 1000 or length(p_evidence) > 1000 then
    perform hr_private.fail('Reason and evidence can be at most 1000 characters each.', 'invalid');
  end if;
  if coalesce((cfg ->> 'regularization_evidence_required')::boolean, false) and length(btrim(coalesce(p_evidence, ''))) < 3 then
    perform hr_private.fail('Supporting evidence is required (for example a ticket, email or gate-log reference).', 'evidence_required');
  end if;
  if p_requested_status is not null and p_requested_status not in ('present','half_day','absent') then
    perform hr_private.fail('The requested status must be present, half day or absent.', 'invalid_status');
  end if;

  select * into a from public.hr_attendance where employee_id = v_me and work_date = p_work_date;
  case v_type
    when 'missed_punch_in' then
      if p_check_in is null then perform hr_private.fail('Give the check-in time you missed.', 'invalid_times'); end if;
      if a.check_in_at is not null then perform hr_private.fail('A check-in is already recorded for this date; request an incorrect-time correction instead.', 'invalid_type'); end if;
    when 'missed_punch_out' then
      if p_check_out is null then perform hr_private.fail('Give the check-out time you missed.', 'invalid_times'); end if;
      if a.check_out_at is not null then perform hr_private.fail('A check-out is already recorded for this date; request an incorrect-time correction instead.', 'invalid_type'); end if;
    when 'incorrect_time' then
      if p_check_in is null and p_check_out is null then perform hr_private.fail('Provide a corrected check-in and/or check-out time.', 'invalid_times'); end if;
    when 'status_correction' then
      if p_requested_status is null then perform hr_private.fail('Choose the status you are requesting.', 'invalid_status'); end if;
    else
      if p_check_in is null and p_check_out is null and p_requested_status is null then
        perform hr_private.fail('Provide a corrected check-in and/or check-out time, or a status.', 'invalid_times');
      end if;
  end case;
  if p_check_in is not null or p_check_out is not null then
    perform hr_private.attendance_validate_times_for(v_me, p_work_date, coalesce(p_check_in, a.check_in_at), coalesce(p_check_out, a.check_out_at));
  end if;
  if a.id is not null and p_requested_status is not distinct from null
     and coalesce(p_check_in, a.check_in_at) is not distinct from a.check_in_at
     and coalesce(p_check_out, a.check_out_at) is not distinct from a.check_out_at then
    perform hr_private.fail('The requested times are the same as the recorded ones.', 'no_change');
  end if;
  if exists (select 1 from public.hr_attendance_corrections where employee_id = v_me and work_date = p_work_date and status = 'pending') then
    perform hr_private.fail('You already have a pending correction for this date.', 'duplicate_pending');
  end if;

  v_mgr := hr_private.correction_manager(v_me);
  insert into public.hr_attendance_corrections (employee_id, work_date, request_type, requested_check_in_at, requested_check_out_at,
      requested_status, reason, evidence_note, attendance_id, original_check_in_at, original_check_out_at, original_status,
      approval_stage, manager_employee_id)
  values (v_me, p_work_date, v_type, p_check_in, p_check_out, p_requested_status, btrim(p_reason), nullif(btrim(p_evidence), ''),
      a.id, a.check_in_at, a.check_out_at, a.status, case when v_mgr is null then 'hr' else 'manager' end, v_mgr)
  returning id into v_id;
  perform hr_private.correction_event(v_id, 'submitted', case when v_mgr is null then 'hr' else 'manager' end, null);
  if v_mgr is not null then
    perform hr_private.notify_employee(v_mgr, 'attendance.correction_requested', 'Attendance correction requested',
      'A team member requested an attendance correction for ' || to_char(p_work_date, 'DD Mon YYYY') || '.',
      '/hr/attendance?tab=corrections', 'hr_attendance_corrections', v_id::text);
  end if;
  return v_id;
exception when unique_violation then
  perform hr_private.fail('You already have a pending correction for this date.', 'duplicate_pending');
  return null;
end $$;

-- 101 entry point (same signature) -> typed request.
create or replace function public.hr_request_attendance_correction(
  p_work_date date, p_check_in timestamptz, p_check_out timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.hr_attendance; v_type text;
begin
  select * into a from public.hr_attendance where employee_id = hr_private.current_employee_id() and work_date = p_work_date;
  v_type := case when a.check_in_at is null and p_check_in is not null then 'missed_punch_in'
                 when a.check_in_at is not null and a.check_out_at is null and p_check_in is null and p_check_out is not null then 'missed_punch_out'
                 else 'incorrect_time' end;
  return public.hr_request_attendance_regularization(p_work_date, v_type, p_check_in, p_check_out, null, p_reason, null);
end $$;

-- Approval sequence:
--   stage 'manager': the employee's manager (attendance.approve_team, in the
--     reporting line) or HR (attendance.approve). HR decisions are final.
--     A manager approval is final unless attendance.regularization_hr_review
--     is on, in which case the request moves to stage 'hr'.
--   stage 'hr': attendance.approve only.
-- Nobody decides their own request. Only the final approval changes
-- hr_attendance (via hr_private.attendance_write, which is audited).
create or replace function public.hr_decide_attendance_correction(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_attendance_corrections;
  a public.hr_attendance;
  v_me uuid := hr_private.current_employee_id();
  v_hr boolean := hr_private.has_permission('attendance.approve');
  v_hr_review boolean := coalesce((hr_private.setting('attendance') ->> 'regularization_hr_review')::boolean, false);
  v_in timestamptz;
  v_out timestamptz;
  v_stage text;
begin
  select * into c from public.hr_attendance_corrections where id = p_id for update;
  if c.id is null then perform hr_private.fail('Correction request not found.', 'not_found'); end if;
  if c.employee_id = v_me then
    perform hr_private.fail('You cannot decide your own correction request.', 'self_approval');
  end if;
  if not hr_private.can_act_on_employee(c.employee_id, 'attendance.approve', 'attendance.approve_team') then
    perform hr_private.fail('You are not allowed to decide this correction request.', 'forbidden');
  end if;
  if c.status <> 'pending' then
    perform hr_private.fail('This correction request has already been ' || c.status || '.', 'already_decided');
  end if;
  if c.approval_stage = 'hr' and not v_hr then
    perform hr_private.fail('You are not allowed to decide this correction request at the HR review stage.', 'forbidden');
  end if;
  if c.approval_stage = 'manager' and not v_hr and c.manager_decided_at is not null then
    perform hr_private.fail('This correction request is waiting for HR review.', 'forbidden');
  end if;
  if p_approve is null then perform hr_private.fail('Choose approve or reject.', 'invalid'); end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) = 0 then
    perform hr_private.fail('Please give a reason for rejecting.', 'note_required');
  end if;
  if length(p_note) > 1000 then perform hr_private.fail('The note can be at most 1000 characters.', 'invalid'); end if;
  v_stage := c.approval_stage;

  -- Manager approval that still needs HR review.
  if p_approve and v_stage = 'manager' and not v_hr and v_hr_review then
    update public.hr_attendance_corrections set approval_stage = 'hr', manager_employee_id = v_me,
      manager_decided_by = auth.uid(), manager_decided_at = now(), manager_note = nullif(btrim(p_note), '')
    where id = p_id returning * into c;
    perform hr_private.correction_event(p_id, 'manager_approved', 'manager', p_note);
    perform hr_private.notify_employee(c.employee_id, 'attendance.correction_manager_approved', 'Attendance correction approved by manager',
      'Your correction for ' || to_char(c.work_date, 'DD Mon YYYY') || ' was approved by your manager and is waiting for HR review.',
      '/employee/attendance', 'hr_attendance_corrections', c.id::text);
    return to_jsonb(c);
  end if;

  if p_approve then
    perform hr_private.assert_attendance_unlocked(c.work_date, c.employee_id);
    perform pg_advisory_xact_lock(hashtext('hr_attendance:' || c.employee_id::text));
    select * into a from public.hr_attendance where employee_id = c.employee_id and work_date = c.work_date for update;
    v_in := coalesce(c.requested_check_in_at, a.check_in_at);
    v_out := coalesce(c.requested_check_out_at, a.check_out_at);
    if c.requested_status = 'absent' then v_in := null; v_out := null; end if;
    if v_in is not null or v_out is not null then
      perform hr_private.attendance_validate_times_for(c.employee_id, c.work_date, v_in, v_out);
    end if;
    a := hr_private.attendance_write(c.employee_id, c.work_date, v_in, v_out, 'correction', c.requested_status, null, null,
                                     'Correction approved: ' || c.reason);
    c.attendance_id := a.id;
  end if;

  update public.hr_attendance_corrections set
    status = case when p_approve then 'approved' else 'rejected' end,
    approval_stage = 'completed',
    attendance_id = c.attendance_id,
    applied_check_in_at = case when p_approve then a.check_in_at end,
    applied_check_out_at = case when p_approve then a.check_out_at end,
    applied_status = case when p_approve then a.status end,
    manager_employee_id = case when v_stage = 'manager' and not v_hr then v_me else manager_employee_id end,
    manager_decided_by = case when v_stage = 'manager' and not v_hr then auth.uid() else manager_decided_by end,
    manager_decided_at = case when v_stage = 'manager' and not v_hr then now() else manager_decided_at end,
    manager_note = case when v_stage = 'manager' and not v_hr then nullif(btrim(p_note), '') else manager_note end,
    reviewer_employee_id = v_me,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
  where id = p_id
  returning * into c;
  perform hr_private.correction_event(p_id, c.status, v_stage, p_note);

  perform hr_private.notify_employee(c.employee_id, 'attendance.correction_' || c.status,
    'Attendance correction ' || c.status,
    'Your correction for ' || to_char(c.work_date, 'DD Mon YYYY') || ' was ' || c.status || '.',
    '/employee/attendance', 'hr_attendance_corrections', c.id::text);
  return to_jsonb(c);
end $$;

create or replace function public.hr_cancel_attendance_correction(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.hr_attendance_corrections;
begin
  select * into c from public.hr_attendance_corrections where id = p_id for update;
  if c.id is null or c.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Correction request not found.', 'not_found');
  end if;
  if c.status <> 'pending' then
    perform hr_private.fail('Only pending requests can be cancelled.', 'invalid_state');
  end if;
  update public.hr_attendance_corrections set status = 'cancelled', approval_stage = 'completed' where id = p_id;
  perform hr_private.correction_event(p_id, 'cancelled', c.approval_stage, null);
end $$;

-- ---------------------------------------------------------------------
-- HR manual entry (101 behaviour + employee timezone + payroll lock)
-- ---------------------------------------------------------------------
create or replace function public.hr_upsert_attendance_manual(
  p_employee uuid, p_work_date date, p_check_in timestamptz, p_check_out timestamptz, p_note text,
  p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_attendance;
begin
  if not hr_private.has_permission('attendance.manage') then
    perform hr_private.fail('You are not allowed to manage attendance.', 'forbidden');
  end if;
  if p_employee is not distinct from hr_private.current_employee_id() then
    perform hr_private.fail('You cannot manually edit your own attendance.', 'self_edit');
  end if;
  if not exists (select 1 from public.hr_employees where id = p_employee) then
    perform hr_private.fail('Employee not found.', 'not_found');
  end if;
  if p_work_date is null or p_work_date > hr_private.employee_today(p_employee) then
    perform hr_private.fail('Manual entries can only be made for today or past dates.', 'invalid_date');
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    perform hr_private.fail('A note explaining the manual entry is required.', 'note_required');
  end if;
  perform hr_private.assert_attendance_unlocked(p_work_date, p_employee);
  if p_check_in is null then
    if p_check_out is not null then perform hr_private.fail('A check-out time needs a check-in time.', 'invalid_times'); end if;
    if coalesce(p_status, 'absent') not in ('absent','on_leave','holiday','weekend') then
      perform hr_private.fail('Without punch times the status must be absent, on_leave, holiday or weekend.', 'invalid_status');
    end if;
  elsif p_status is not null then
    perform hr_private.fail('Status is calculated automatically when punch times are given.', 'invalid_status');
  end if;
  perform hr_private.attendance_validate_times_for(p_employee, p_work_date, p_check_in, p_check_out);
  perform pg_advisory_xact_lock(hashtext('hr_attendance:' || p_employee::text));
  r := hr_private.attendance_write(p_employee, p_work_date, p_check_in, p_check_out, 'manual',
                                   case when p_check_in is null then coalesce(p_status, 'absent') end,
                                   null, null, p_note);
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

revoke execute on function
  public.hr_check_in(text), public.hr_check_out(text), public.hr_my_attendance_today(),
  public.hr_my_attendance_calendar(text, uuid), public.hr_holiday_calendar(date, date, uuid, boolean),
  public.hr_attendance_overview(date, uuid, text, text, uuid), public.hr_attendance_summary(date, date, uuid, uuid, uuid, text),
  public.hr_assign_shift(uuid, uuid, date, date, text), public.hr_end_shift_assignment(uuid, date, text), public.hr_cancel_shift_assignment(uuid, text),
  public.hr_mark_missing_punches(date),
  public.hr_request_attendance_regularization(date, text, timestamptz, timestamptz, text, text, text),
  public.hr_request_attendance_correction(date, timestamptz, timestamptz, text),
  public.hr_decide_attendance_correction(uuid, boolean, text), public.hr_cancel_attendance_correction(uuid),
  public.hr_upsert_attendance_manual(uuid, date, timestamptz, timestamptz, text, text)
from anon, public;
grant execute on function
  public.hr_check_in(text), public.hr_check_out(text), public.hr_my_attendance_today(),
  public.hr_my_attendance_calendar(text, uuid), public.hr_holiday_calendar(date, date, uuid, boolean),
  public.hr_attendance_overview(date, uuid, text, text, uuid), public.hr_attendance_summary(date, date, uuid, uuid, uuid, text),
  public.hr_assign_shift(uuid, uuid, date, date, text), public.hr_end_shift_assignment(uuid, date, text), public.hr_cancel_shift_assignment(uuid, text),
  public.hr_mark_missing_punches(date),
  public.hr_request_attendance_regularization(date, text, timestamptz, timestamptz, text, text, text),
  public.hr_request_attendance_correction(date, timestamptz, timestamptz, text),
  public.hr_decide_attendance_correction(uuid, boolean, text), public.hr_cancel_attendance_correction(uuid),
  public.hr_upsert_attendance_manual(uuid, date, timestamptz, timestamptz, text, text)
to authenticated;
grant execute on function public.hr_mark_missing_punches(date) to service_role;

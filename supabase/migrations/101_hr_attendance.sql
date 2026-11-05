-- =====================================================================
-- 101_hr_attendance.sql — Attendance & Time
-- =====================================================================
-- One attendance row per employee per business date, written ONLY through
-- SECURITY DEFINER RPCs (self check-in/out, HR manual entry, approved
-- corrections). Login history is a separate table and never feeds
-- attendance.
--
-- Depends on: 100_hr_foundation.sql
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Module settings
-- ---------------------------------------------------------------------
insert into public.hr_settings (key, value, description) values
  ('attendance', jsonb_build_object(
      'correction_window_days', 30,          -- how far back an employee may request a correction
      'overnight_checkout_hours', 8          -- how long after an overnight shift ends check-out is still accepted
   ),
   'Attendance: correction window and overnight check-out tolerance')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Shared calendar helpers (also (re)defined by 102/103 with identical
-- bodies so modules stay independently applicable).
-- ---------------------------------------------------------------------
-- ISO working days for an employee: their shift, else the default shift,
-- else the company working week.
create or replace function hr_private.employee_working_days(p_employee uuid)
returns smallint[] language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.working_days from public.hr_employees e join public.hr_shifts s on s.id = e.shift_id where e.id = p_employee),
    (select s.working_days from public.hr_shifts s where s.is_default and s.active limit 1),
    (select array_agg(x::smallint) from jsonb_array_elements_text(hr_private.setting('company') -> 'working_days') x),
    '{1,2,3,4,5}'::smallint[])
$$;

-- Holiday / approved-leave hooks. 103_hr_leave.sql replaces these with real
-- implementations; until then nothing is a holiday and nobody is on leave.
do $$
begin
  if to_regprocedure('hr_private.is_holiday(date,uuid)') is null then
    execute $f$create function hr_private.is_holiday(p_date date, p_employee uuid default null)
      returns boolean language sql stable set search_path = '' as 'select false'$f$;
  end if;
  if to_regprocedure('hr_private.is_on_approved_leave(uuid,date)') is null then
    execute $f$create function hr_private.is_on_approved_leave(p_employee uuid, p_date date)
      returns boolean language sql stable set search_path = '' as 'select false'$f$;
  end if;
end $$;

-- The employee's effective shift. Fallback when no shift and no default
-- shift exist: 09:00-18:00, 10 min grace, 60 min break, 10 min early grace.
create or replace function hr_private.employee_shift(p_employee uuid)
returns table (shift_id uuid, start_time time, end_time time, grace_minutes int, break_minutes int,
               early_leave_grace_minutes int, overtime_after_minutes int, working_days smallint[])
language sql stable security definer set search_path = '' as $$
  select x.shift_id, x.start_time, x.end_time, x.grace_minutes, x.break_minutes,
         x.early_leave_grace_minutes, x.overtime_after_minutes, x.working_days
  from (
    select s.id as shift_id, s.start_time, s.end_time, s.grace_minutes::int as grace_minutes, s.break_minutes::int as break_minutes,
           s.early_leave_grace_minutes::int as early_leave_grace_minutes, s.overtime_after_minutes::int as overtime_after_minutes,
           s.working_days, 1 as pri
    from public.hr_employees e join public.hr_shifts s on s.id = e.shift_id
    where e.id = p_employee
    union all
    select s.id, s.start_time, s.end_time, s.grace_minutes::int, s.break_minutes::int,
           s.early_leave_grace_minutes::int, s.overtime_after_minutes::int, s.working_days, 2
    from public.hr_shifts s where s.is_default and s.active
    union all
    select null::uuid, time '09:00', time '18:00', 10, 60, 10, null::int, hr_private.employee_working_days(p_employee), 3
  ) x
  order by x.pri
  limit 1
$$;

-- ---------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------
create table public.hr_attendance (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.hr_employees(id) on delete restrict,
  work_date           date not null,
  shift_id            uuid references public.hr_shifts(id) on delete set null,   -- snapshot of the shift used
  expected_start_at   timestamptz,
  expected_end_at     timestamptz,
  check_in_at         timestamptz,
  check_out_at        timestamptz,
  break_minutes       int not null default 0 check (break_minutes >= 0),
  worked_minutes      int check (worked_minutes >= 0),          -- null until checked out
  late_minutes        int not null default 0 check (late_minutes >= 0),
  early_leave_minutes int not null default 0 check (early_leave_minutes >= 0),
  overtime_minutes    int not null default 0 check (overtime_minutes >= 0),
  status              text not null check (status in ('present','late','half_day','absent','on_leave','holiday','weekend','missing_punch')),
  source              text not null default 'self' check (source in ('self','manual','correction')),
  check_in_note       text check (length(check_in_note) <= 500),
  check_out_note      text check (length(check_out_note) <= 500),
  notes               text check (length(notes) <= 1000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  unique (employee_id, work_date),
  check (check_out_at is null or check_in_at is not null),
  check (check_out_at is null or check_out_at > check_in_at)
);
create index hr_attendance_date on public.hr_attendance(work_date);
create index hr_attendance_open on public.hr_attendance(employee_id, work_date) where check_in_at is not null and check_out_at is null;
select hr_private.secure_table('public.hr_attendance');
create trigger hr_attendance_touch before update on public.hr_attendance for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_attendance');

create policy hr_attendance_read on public.hr_attendance for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'attendance'));
-- No insert/update/delete policies: writes go through the RPCs below.
revoke insert, update, delete, truncate on public.hr_attendance from authenticated;

-- Pure calculation from shift + punches (no writes).
create or replace function hr_private.attendance_compute(p_employee uuid, p_work_date date, p_in timestamptz, p_out timestamptz)
returns table (o_shift_id uuid, o_expected_start timestamptz, o_expected_end timestamptz, o_break int, o_worked int,
               o_late int, o_early int, o_overtime int, o_status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s record;
  tz text := hr_private.business_timezone();
  v_shift_min int;
  v_net int;
  v_span int;
  v_diff int;
  v_working boolean;
begin
  select * into s from hr_private.employee_shift(p_employee);
  o_shift_id := s.shift_id;
  o_expected_start := (p_work_date + s.start_time) at time zone tz;
  o_expected_end := (p_work_date + s.end_time) at time zone tz;
  if s.end_time <= s.start_time then              -- overnight shift
    o_expected_end := o_expected_end + interval '1 day';
  end if;
  v_shift_min := (extract(epoch from o_expected_end - o_expected_start) / 60)::int;
  v_net := greatest(v_shift_min - s.break_minutes, 0);
  v_working := extract(isodow from p_work_date)::smallint = any(s.working_days)
               and not hr_private.is_holiday(p_work_date, p_employee);
  o_break := 0; o_worked := null; o_late := 0; o_early := 0; o_overtime := 0;

  if p_in is null then
    o_status := 'absent';
    return next; return;
  end if;

  if v_working then
    v_diff := floor(extract(epoch from p_in - o_expected_start) / 60)::int;
    if v_diff > s.grace_minutes then o_late := v_diff; end if;
  end if;

  if p_out is not null then
    v_span := floor(extract(epoch from p_out - p_in) / 60)::int;
    o_break := least(s.break_minutes, v_span);
    o_worked := greatest(v_span - s.break_minutes, 0);
    if v_working then
      v_diff := floor(extract(epoch from o_expected_end - p_out) / 60)::int;
      if v_diff > s.early_leave_grace_minutes then o_early := v_diff; end if;
      o_overtime := greatest(o_worked - v_net - coalesce(s.overtime_after_minutes, 0), 0);
    else
      o_overtime := o_worked;                       -- all work on a non-working day is overtime
    end if;
    o_status := case when v_working and o_worked < v_net / 2.0 then 'half_day'
                     when o_late > 0 then 'late' else 'present' end;
  else
    o_status := case when o_late > 0 then 'late' else 'present' end;
  end if;
  return next;
end $$;

-- Upsert one attendance row with freshly calculated fields.
create or replace function hr_private.attendance_write(
  p_employee uuid, p_date date, p_in timestamptz, p_out timestamptz, p_source text,
  p_status text default null, p_in_note text default null, p_out_note text default null, p_notes text default null)
returns public.hr_attendance
language plpgsql security definer set search_path = '' as $$
declare c record; r public.hr_attendance;
begin
  select * into c from hr_private.attendance_compute(p_employee, p_date, p_in, p_out);
  insert into public.hr_attendance as a (employee_id, work_date, shift_id, expected_start_at, expected_end_at,
      check_in_at, check_out_at, break_minutes, worked_minutes, late_minutes, early_leave_minutes, overtime_minutes,
      status, source, check_in_note, check_out_note, notes, updated_by)
  values (p_employee, p_date, c.o_shift_id, c.o_expected_start, c.o_expected_end,
      p_in, p_out, c.o_break, c.o_worked, c.o_late, c.o_early, c.o_overtime,
      coalesce(p_status, c.o_status), p_source, nullif(btrim(p_in_note), ''), nullif(btrim(p_out_note), ''), nullif(btrim(p_notes), ''), auth.uid())
  on conflict (employee_id, work_date) do update set
      shift_id = excluded.shift_id, expected_start_at = excluded.expected_start_at, expected_end_at = excluded.expected_end_at,
      check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, break_minutes = excluded.break_minutes,
      worked_minutes = excluded.worked_minutes, late_minutes = excluded.late_minutes,
      early_leave_minutes = excluded.early_leave_minutes, overtime_minutes = excluded.overtime_minutes,
      status = excluded.status, source = excluded.source,
      check_in_note = coalesce(excluded.check_in_note, a.check_in_note),
      check_out_note = coalesce(excluded.check_out_note, a.check_out_note),
      notes = coalesce(excluded.notes, a.notes),
      updated_by = excluded.updated_by
  returning * into r;
  return r;
end $$;

-- Validates a punch pair against its business date.
create or replace function hr_private.attendance_validate_times(p_date date, p_in timestamptz, p_out timestamptz)
returns void language plpgsql stable security definer set search_path = '' as $$
declare tz text := hr_private.business_timezone();
begin
  if p_in is null and p_out is not null then
    perform hr_private.fail('A check-out time needs a check-in time.', 'invalid_times');
  end if;
  if p_in is not null and (p_in at time zone tz)::date <> p_date then
    perform hr_private.fail('Check-in time must fall on the attendance date.', 'invalid_times');
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
-- Self check-in / check-out (caller only, server time)
-- ---------------------------------------------------------------------
create or replace function public.hr_check_in(p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_today date := hr_private.business_today();
  r public.hr_attendance;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  perform pg_advisory_xact_lock(hashtext('hr_attendance:' || v_me::text));
  select * into r from public.hr_attendance where employee_id = v_me and work_date = v_today for update;
  if r.id is not null and r.check_in_at is not null then
    perform hr_private.fail('You have already checked in today.', 'already_checked_in');
  end if;
  r := hr_private.attendance_write(v_me, v_today, clock_timestamp(), null, 'self', null, p_note);
  return to_jsonb(r);
end $$;

create or replace function public.hr_check_out(p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_today date := hr_private.business_today();
  v_tz text := hr_private.business_timezone();
  v_tol int := coalesce((hr_private.setting('attendance') ->> 'overnight_checkout_hours')::int, 8);
  r public.hr_attendance;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  perform pg_advisory_xact_lock(hashtext('hr_attendance:' || v_me::text));
  select * into r from public.hr_attendance a
  where a.employee_id = v_me and a.check_in_at is not null and a.check_out_at is null
    and (a.work_date = v_today
         or (a.work_date = v_today - 1                         -- overnight shift still running
             and (a.expected_end_at at time zone v_tz)::date > a.work_date
             and now() <= a.expected_end_at + make_interval(hours => v_tol)))
  order by a.work_date desc
  limit 1
  for update;
  if r.id is null then
    if exists (select 1 from public.hr_attendance where employee_id = v_me and work_date = v_today and check_out_at is not null) then
      perform hr_private.fail('You have already checked out today.', 'already_checked_out');
    end if;
    perform hr_private.fail('You have not checked in today.', 'not_checked_in');
  end if;
  r := hr_private.attendance_write(v_me, r.work_date, r.check_in_at, clock_timestamp(), r.source, null, null, p_note);
  return to_jsonb(r);
end $$;

create or replace function public.hr_my_attendance_today()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_today date := hr_private.business_today();
  r public.hr_attendance;
  s record;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into r from public.hr_attendance where employee_id = v_me and work_date = v_today;
  select * into s from hr_private.employee_shift(v_me);
  return jsonb_build_object(
    'work_date', v_today,
    'timezone', hr_private.business_timezone(),
    'server_time', now(),
    'checked_in', r.check_in_at is not null,
    'checked_out', r.check_out_at is not null,
    'can_check_in', r.check_in_at is null,
    'can_check_out', r.check_in_at is not null and r.check_out_at is null,
    'record', case when r.id is null then null else to_jsonb(r) end,
    'shift', jsonb_build_object('shift_id', s.shift_id, 'start_time', s.start_time, 'end_time', s.end_time,
                                'grace_minutes', s.grace_minutes, 'break_minutes', s.break_minutes,
                                'early_leave_grace_minutes', s.early_leave_grace_minutes,
                                'overtime_after_minutes', s.overtime_after_minutes, 'working_days', to_jsonb(s.working_days),
                                'is_working_day', extract(isodow from v_today)::smallint = any(s.working_days)
                                                  and not hr_private.is_holiday(v_today, v_me)));
end $$;

-- ---------------------------------------------------------------------
-- Missing punches: reported by a view; status changed only by HR/scheduler.
-- ---------------------------------------------------------------------
create view public.hr_attendance_missing_punches with (security_invoker = true) as
  select a.id, a.employee_id, a.work_date, a.check_in_at, a.expected_end_at, a.status, a.source
  from public.hr_attendance a
  where a.check_in_at is not null and a.check_out_at is null
    and a.work_date < hr_private.business_today();
revoke all on public.hr_attendance_missing_punches from anon, public;
grant select on public.hr_attendance_missing_punches to authenticated;

create or replace function public.hr_mark_missing_punches(p_date date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, hr_private.business_today() - 1);
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
-- Corrections
-- ---------------------------------------------------------------------
create table public.hr_attendance_corrections (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references public.hr_employees(id) on delete restrict,
  work_date              date not null,
  requested_check_in_at  timestamptz,
  requested_check_out_at timestamptz,
  reason                 text not null check (length(btrim(reason)) between 3 and 1000),
  status                 text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  attendance_id          uuid references public.hr_attendance(id) on delete set null,
  reviewer_employee_id   uuid references public.hr_employees(id) on delete set null,
  reviewed_by            uuid,
  reviewed_at            timestamptz,
  review_note            text check (length(review_note) <= 1000),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (requested_check_in_at is not null or requested_check_out_at is not null)
);
create unique index hr_attendance_corrections_one_pending on public.hr_attendance_corrections(employee_id, work_date) where status = 'pending';
create index hr_attendance_corrections_status on public.hr_attendance_corrections(status, created_at);
select hr_private.secure_table('public.hr_attendance_corrections');
create trigger hr_attendance_corrections_touch before update on public.hr_attendance_corrections for each row execute function hr_private.touch_updated_at();
select hr_private.enable_audit('public.hr_attendance_corrections');
create policy hr_attendance_corrections_read on public.hr_attendance_corrections for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'attendance'));
revoke insert, update, delete, truncate on public.hr_attendance_corrections from authenticated;

create or replace function public.hr_request_attendance_correction(
  p_work_date date, p_check_in timestamptz, p_check_out timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_today date := hr_private.business_today();
  v_window int := coalesce((hr_private.setting('attendance') ->> 'correction_window_days')::int, 30);
  a public.hr_attendance;
  v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  if p_work_date is null or p_work_date > v_today then
    perform hr_private.fail('Corrections can only be requested for today or past dates.', 'invalid_date');
  end if;
  if p_work_date < v_today - v_window then
    perform hr_private.fail('This date is outside the correction window of ' || v_window || ' days.', 'outside_window');
  end if;
  if p_check_in is null and p_check_out is null then
    perform hr_private.fail('Provide a corrected check-in and/or check-out time.', 'invalid_times');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform hr_private.fail('Please give a reason for the correction.', 'reason_required');
  end if;
  select * into a from public.hr_attendance where employee_id = v_me and work_date = p_work_date;
  perform hr_private.attendance_validate_times(p_work_date, coalesce(p_check_in, a.check_in_at), coalesce(p_check_out, a.check_out_at));
  if exists (select 1 from public.hr_attendance_corrections where employee_id = v_me and work_date = p_work_date and status = 'pending') then
    perform hr_private.fail('You already have a pending correction for this date.', 'duplicate_pending');
  end if;
  insert into public.hr_attendance_corrections (employee_id, work_date, requested_check_in_at, requested_check_out_at, reason, attendance_id)
  values (v_me, p_work_date, p_check_in, p_check_out, btrim(p_reason), a.id)
  returning id into v_id;
  perform hr_private.notify_employee(hr_private.my_manager_id(), 'attendance.correction_requested', 'Attendance correction requested',
    'A team member requested an attendance correction for ' || to_char(p_work_date, 'DD Mon YYYY') || '.',
    '/hr/attendance', 'hr_attendance_corrections', v_id::text);
  return v_id;
end $$;

create or replace function public.hr_decide_attendance_correction(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_attendance_corrections;
  a public.hr_attendance;
  v_in timestamptz;
  v_out timestamptz;
begin
  select * into c from public.hr_attendance_corrections where id = p_id for update;
  if c.id is null then perform hr_private.fail('Correction request not found.', 'not_found'); end if;
  if c.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot decide your own correction request.', 'self_approval');
  end if;
  if not hr_private.can_act_on_employee(c.employee_id, 'attendance.approve', 'attendance.approve_team') then
    perform hr_private.fail('You are not allowed to decide this correction request.', 'forbidden');
  end if;
  if c.status <> 'pending' then
    perform hr_private.fail('This correction request has already been ' || c.status || '.', 'already_decided');
  end if;
  if p_approve is null then perform hr_private.fail('Choose approve or reject.', 'invalid'); end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) = 0 then
    perform hr_private.fail('Please give a reason for rejecting.', 'note_required');
  end if;

  if p_approve then
    perform pg_advisory_xact_lock(hashtext('hr_attendance:' || c.employee_id::text));
    select * into a from public.hr_attendance where employee_id = c.employee_id and work_date = c.work_date for update;
    v_in := coalesce(c.requested_check_in_at, a.check_in_at);
    v_out := coalesce(c.requested_check_out_at, a.check_out_at);
    perform hr_private.attendance_validate_times(c.work_date, v_in, v_out);
    a := hr_private.attendance_write(c.employee_id, c.work_date, v_in, v_out, 'correction', null, null, null,
                                     'Correction approved: ' || c.reason);
    c.attendance_id := a.id;
  end if;

  update public.hr_attendance_corrections set
    status = case when p_approve then 'approved' else 'rejected' end,
    attendance_id = c.attendance_id,
    reviewer_employee_id = hr_private.current_employee_id(),
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
  where id = p_id
  returning * into c;

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
  update public.hr_attendance_corrections set status = 'cancelled' where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- HR manual entry / exception (audited via the table trigger)
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
  if p_work_date is null or p_work_date > hr_private.business_today() then
    perform hr_private.fail('Manual entries can only be made for today or past dates.', 'invalid_date');
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    perform hr_private.fail('A note explaining the manual entry is required.', 'note_required');
  end if;
  if p_check_in is null then
    if p_check_out is not null then perform hr_private.fail('A check-out time needs a check-in time.', 'invalid_times'); end if;
    if coalesce(p_status, 'absent') not in ('absent','on_leave','holiday','weekend') then
      perform hr_private.fail('Without punch times the status must be absent, on_leave, holiday or weekend.', 'invalid_status');
    end if;
  elsif p_status is not null then
    perform hr_private.fail('Status is calculated automatically when punch times are given.', 'invalid_status');
  end if;
  perform hr_private.attendance_validate_times(p_work_date, p_check_in, p_check_out);
  perform pg_advisory_xact_lock(hashtext('hr_attendance:' || p_employee::text));
  r := hr_private.attendance_write(p_employee, p_work_date, p_check_in, p_check_out, 'manual',
                                   case when p_check_in is null then coalesce(p_status, 'absent') end,
                                   null, null, p_note);
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- Login history (security log; NEVER used to derive attendance)
-- ---------------------------------------------------------------------
create table public.hr_login_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  event       text not null check (event in ('login','logout')),
  occurred_at timestamptz not null default now(),
  user_agent  text check (length(user_agent) <= 500)
);
create index hr_login_events_user on public.hr_login_events(user_id, occurred_at desc);
select hr_private.secure_table('public.hr_login_events');
create policy hr_login_events_read on public.hr_login_events for select to authenticated
  using (user_id = auth.uid() or hr_private.has_permission('audit.view'));
revoke insert, update, delete, truncate on public.hr_login_events from authenticated;

create or replace function public.hr_record_login_event(p_event text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform hr_private.fail('Not signed in.', 'not_signed_in'); end if;
  if p_event not in ('login','logout') then perform hr_private.fail('Unknown login event.', 'invalid'); end if;
  insert into public.hr_login_events (user_id, event, user_agent) values (auth.uid(), p_event, left(p_user_agent, 500));
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;

revoke execute on function public.hr_check_in(text), public.hr_check_out(text), public.hr_my_attendance_today(),
  public.hr_mark_missing_punches(date),
  public.hr_request_attendance_correction(date, timestamptz, timestamptz, text),
  public.hr_decide_attendance_correction(uuid, boolean, text), public.hr_cancel_attendance_correction(uuid),
  public.hr_upsert_attendance_manual(uuid, date, timestamptz, timestamptz, text, text),
  public.hr_record_login_event(text, text) from anon, public;
grant execute on function public.hr_check_in(text), public.hr_check_out(text), public.hr_my_attendance_today(),
  public.hr_mark_missing_punches(date),
  public.hr_request_attendance_correction(date, timestamptz, timestamptz, text),
  public.hr_decide_attendance_correction(uuid, boolean, text), public.hr_cancel_attendance_correction(uuid),
  public.hr_upsert_attendance_manual(uuid, date, timestamptz, timestamptz, text, text),
  public.hr_record_login_event(text, text) to authenticated;
grant execute on function public.hr_mark_missing_punches(date) to service_role;

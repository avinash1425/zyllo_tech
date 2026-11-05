-- Half-day leave in attendance (migration 195; Module 5 x Module 6).
-- An approved 0.5 leave day stays 'working': expected minutes are halved,
-- 'first' (morning off) skips the late calculation, 'second' (afternoon off)
-- skips the early-leave calculation, and no punch gives 'half_day', not
-- 'absent'. A full-day leave (or two approved halves) is still 'leave'.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_d (k text primary key, d date);
grant all on t_ids, t_d to authenticated, anon, service_role;

do $$
declare mon date; sh uuid; lt uuid; a uuid; b uuid; hr uuid;
begin
  insert into public.hr_shifts (name, code, start_time, end_time, grace_minutes, break_minutes, early_leave_grace_minutes, working_days)
  values ('HD Day', 'HDDAY', '09:00', '18:00', 15, 60, 10, '{1,2,3,4,5}') returning id into sh;   -- expected 480 minutes
  hr := test.make_employee('hd.hr@test.local', 'Hana', null, array['hr_admin']);
  a := test.make_employee('hd.a@test.local', 'Asha');
  b := test.make_employee('hd.b@test.local', 'Bela');
  update public.hr_employees set shift_id = sh where id in (a, b);
  insert into public.hr_leave_types (code, name, paid, annual_entitlement) values ('HDCL', 'HD Casual', true, 12) returning id into lt;
  insert into t_ids values ('shift', sh), ('lt', lt), ('hr', hr), ('a', a), ('b', b);
  -- Monday two weeks ago (past working days, no holidays expected)
  mon := hr_private.business_today() - (extract(isodow from hr_private.business_today())::int - 1) - 14;
  insert into t_d values ('mon', mon), ('tue', mon + 1), ('wed', mon + 2), ('thu', mon + 3), ('fri', mon + 4);
end $$;

create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.d(p_k text) returns date language sql as $$ select d from t_d where k = p_k $$;
create or replace function pg_temp.ts(p_emp text, p_k text, p_t time) returns timestamptz language sql as $$
  select ((select d from t_d where k = p_k) + p_t) at time zone hr_private.employee_timezone((select v from t_ids where k = p_emp))
$$;
-- Single-day leave request. p_half: 'first' (morning off), 'second' (afternoon off) or null (full day).
create or replace function pg_temp.leave(p_emp text, p_k text, p_half text, p_status text default 'approved') returns uuid language plpgsql as $$
declare r uuid;
begin
  insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, start_half, end_half, days, year, reason, status)
  values (pg_temp.id(p_emp), pg_temp.id('lt'), pg_temp.d(p_k), pg_temp.d(p_k),
          coalesce(p_half = 'second', false), coalesce(p_half = 'first', false), case when p_half is null then 1 else 0.5 end,
          extract(year from pg_temp.d(p_k))::int, 'Synthetic half day', p_status)
  returning id into r;
  return r;
end $$;
create or replace function pg_temp.att(p_emp text, p_k text) returns public.hr_attendance language sql as $$
  select * from public.hr_attendance where employee_id = pg_temp.id(p_emp) and work_date = pg_temp.d(p_k)
$$;
select test.ok(pg_temp.d('mon') < hr_private.business_today()
  and (select bool_and(hr_private.attendance_day_type(pg_temp.id('a'), d) = 'working') from t_d), 'fixture week: five past working days');

-- leave fixtures
select pg_temp.leave('a', 'mon', 'first');      -- morning off
select pg_temp.leave('a', 'tue', 'second');     -- afternoon off
select pg_temp.leave('a', 'wed', 'second');     -- afternoon off, late arrival
select pg_temp.leave('a', 'thu', 'first');      -- morning off, no punch
select pg_temp.leave('a', 'fri', 'first');      -- morning off, leaves early / works too little
select pg_temp.leave('b', 'mon', null);         -- full day
select pg_temp.leave('b', 'tue', 'first');      -- two approved halves = full day
select pg_temp.leave('b', 'tue', 'second');
select pg_temp.leave('b', 'wed', 'first', 'pending_approval');   -- not approved: no effect
select test.eq((select half from public.hr_leave_request_days where employee_id = pg_temp.id('a') and leave_date = pg_temp.d('mon')), 'first',
  'fixture: end-half single day stored as first (morning off)');
select test.eq((select half from public.hr_leave_request_days where employee_id = pg_temp.id('a') and leave_date = pg_temp.d('tue')), 'second',
  'fixture: start-half single day stored as second (afternoon off)');

-- =====================================================================
-- Day classification
-- =====================================================================
select test.eq(hr_private.leave_portion_on(pg_temp.id('a'), pg_temp.d('mon')), 0.5::numeric, 'half day: leave portion 0.5');
select test.eq(hr_private.attendance_day_type(pg_temp.id('a'), pg_temp.d('mon')), 'working', 'half-day leave date stays working');
select test.ok(hr_private.is_working_day_for(pg_temp.id('a'), pg_temp.d('mon')), 'half-day leave date is a scheduled working day');
select test.ok(hr_private.is_on_approved_leave(pg_temp.id('a'), pg_temp.d('mon')), 'is_on_approved_leave unchanged (still true for a half day)');
select test.eq(hr_private.leave_half_on(pg_temp.id('a'), pg_temp.d('mon')), 'first', 'leave_half_on reads first');
select test.eq(hr_private.leave_half_on(pg_temp.id('a'), pg_temp.d('tue')), 'second', 'leave_half_on reads second');
select test.eq(hr_private.attendance_day_type(pg_temp.id('b'), pg_temp.d('mon')), 'leave', 'full-day leave is still leave');
select test.eq(hr_private.attendance_day_type(pg_temp.id('b'), pg_temp.d('tue')), 'leave', 'two approved halves on one date = leave');
select test.eq(hr_private.attendance_day_type(pg_temp.id('b'), pg_temp.d('wed')), 'working', 'pending half-day leave does not change the day');

-- =====================================================================
-- No punch
-- =====================================================================
select test.eq((select status from hr_private.attendance_day(pg_temp.id('a'), pg_temp.d('thu'))), 'half_day',
  'no punch on a half-day leave date -> half_day, not absent');
select test.eq((select expected_minutes from hr_private.attendance_day(pg_temp.id('a'), pg_temp.d('thu'))), 240,
  'no punch on a half-day leave date: expected minutes halved (240 of 480)');
select test.eq((select o_status from hr_private.attendance_compute(pg_temp.id('a'), pg_temp.d('thu'), null, null)), 'half_day',
  'attendance_compute without punches on a half-day leave date -> half_day');
select test.eq((select status from hr_private.attendance_day(pg_temp.id('b'), pg_temp.d('mon'))), 'on_leave', 'full-day leave, no punch -> on_leave');
select test.eq((select expected_minutes from hr_private.attendance_day(pg_temp.id('b'), pg_temp.d('mon'))), 0, 'full-day leave: expected minutes 0');
select test.eq((select status from hr_private.attendance_day(pg_temp.id('b'), pg_temp.d('wed'))), 'absent', 'pending half day, no punch -> absent');
select test.eq((select expected_minutes from hr_private.attendance_day(pg_temp.id('b'), pg_temp.d('wed'))), 480, 'pending half day: full expected minutes');

-- HR manual entry without punches is an explicit HR status (default 'absent'),
-- not recalculated: the explicit choice is kept and reported.
select test.as_user(test.user_of(pg_temp.id('hr')));
select public.hr_upsert_attendance_manual(pg_temp.id('a'), pg_temp.d('thu'), null, null, 'Marked absent by HR');
select test.as_owner();
select test.eq((pg_temp.att('a', 'thu')).status, 'absent', 'explicit HR no-punch status on a half-day leave date is kept');
select test.eq((select status from hr_private.attendance_day(pg_temp.id('a'), pg_temp.d('thu'))), 'absent', 'stored explicit status is reported');
-- a row written through the calculation (no explicit status) stores half_day
select hr_private.attendance_write(pg_temp.id('a'), pg_temp.d('thu'), null, null, 'manual', null, null, null, 'Recalculated');
select test.eq((pg_temp.att('a', 'thu')).status, 'half_day', 'calculated no-punch row on a half-day leave date stores half_day');
select test.eq((select status from hr_private.attendance_day(pg_temp.id('a'), pg_temp.d('thu'))), 'half_day', 'stored half_day row is reported as half_day');

-- =====================================================================
-- Punches (HR manual entries recalculate through attendance_compute)
-- =====================================================================
select test.as_user(test.user_of(pg_temp.id('hr')));
select public.hr_upsert_attendance_manual(pg_temp.id('a'), pg_temp.d('mon'), pg_temp.ts('a', 'mon', '13:30'), pg_temp.ts('a', 'mon', '18:00'), 'Afternoon after morning leave');
select public.hr_upsert_attendance_manual(pg_temp.id('a'), pg_temp.d('tue'), pg_temp.ts('a', 'tue', '09:00'), pg_temp.ts('a', 'tue', '13:30'), 'Morning before afternoon leave');
select public.hr_upsert_attendance_manual(pg_temp.id('a'), pg_temp.d('wed'), pg_temp.ts('a', 'wed', '10:00'), pg_temp.ts('a', 'wed', '13:30'), 'Late morning before afternoon leave');
select public.hr_upsert_attendance_manual(pg_temp.id('a'), pg_temp.d('fri'), pg_temp.ts('a', 'fri', '13:30'), pg_temp.ts('a', 'fri', '15:00'), 'Short afternoon');
select public.hr_upsert_attendance_manual(pg_temp.id('b'), pg_temp.d('wed'), pg_temp.ts('b', 'wed', '13:30'), pg_temp.ts('b', 'wed', '18:00'), 'Pending leave, afternoon only');
select test.as_owner();

-- first half off + 13:30 punch-in
select test.eq((pg_temp.att('a', 'mon')).late_minutes, 0, 'first-half leave: 13:30 punch-in is not late');
select test.eq((pg_temp.att('a', 'mon')).early_leave_minutes, 0, 'first-half leave: leaving at shift end is not early');
select test.eq((pg_temp.att('a', 'mon')).worked_minutes, 210, 'first-half leave: worked 13:30-18:00 less unpaid break = 210');
select test.eq((pg_temp.att('a', 'mon')).status, 'present', 'first-half leave: 210 worked >= 120 threshold -> present');
select test.eq((select expected_minutes from hr_private.attendance_day(pg_temp.id('a'), pg_temp.d('mon'))), 240, 'first-half leave: expected minutes halved (240)');
select test.eq((select short_minutes from hr_private.attendance_day(pg_temp.id('a'), pg_temp.d('mon'))), 30, 'first-half leave: short hours vs halved expectation (240 - 210)');
select test.eq((select day_type from hr_private.attendance_day(pg_temp.id('a'), pg_temp.d('mon'))), 'working', 'first-half leave: day type working');

-- second half off + 13:30 punch-out
select test.eq((pg_temp.att('a', 'tue')).early_leave_minutes, 0, 'second-half leave: 13:30 punch-out is not early leave');
select test.eq((pg_temp.att('a', 'tue')).late_minutes, 0, 'second-half leave: on-time arrival not late');
select test.eq((pg_temp.att('a', 'tue')).status, 'present', 'second-half leave: present');
select test.eq((pg_temp.att('a', 'tue')).overtime_minutes, 0, 'second-half leave: no overtime');
select test.eq((select expected_minutes from hr_private.attendance_day(pg_temp.id('a'), pg_temp.d('tue'))), 240, 'second-half leave: expected minutes halved (240)');

-- second half off: late arrival is still late
select test.eq((pg_temp.att('a', 'wed')).late_minutes, 60, 'second-half leave: late arrival still counted (60)');
select test.eq((pg_temp.att('a', 'wed')).early_leave_minutes, 0, 'second-half leave: no early leave');
select test.eq((pg_temp.att('a', 'wed')).status, 'late', 'second-half leave + late arrival -> late');

-- first half off: early leave still counted; half-day threshold on halved expectation
select test.eq((pg_temp.att('a', 'fri')).late_minutes, 0, 'first-half leave: not late');
select test.eq((pg_temp.att('a', 'fri')).early_leave_minutes, 180, 'first-half leave: leaving at 15:00 is early by 180');
select test.eq((pg_temp.att('a', 'fri')).status, 'half_day', 'first-half leave: worked 30 < threshold 120 -> half_day');

-- pending half day: normal rules
select test.eq((pg_temp.att('b', 'wed')).late_minutes, 270, 'pending half-day leave: 13:30 punch-in is late (270)');

-- full-day leave with punches: unchanged behaviour (no late, not half day)
select test.as_user(test.user_of(pg_temp.id('hr')));
select public.hr_upsert_attendance_manual(pg_temp.id('b'), pg_temp.d('mon'), pg_temp.ts('b', 'mon', '14:00'), pg_temp.ts('b', 'mon', '15:00'), 'Came in on leave day');
select test.as_owner();
select test.ok(((pg_temp.att('b', 'mon')).late_minutes = 0 and (pg_temp.att('b', 'mon')).status = 'present'),
  'full-day leave punches: no late penalty, not half_day');

-- half_day_minutes configured on the shift scales with the leave portion
update public.hr_shifts set half_day_minutes = 300 where id = pg_temp.id('shift');
select test.eq((select o_status from hr_private.attendance_compute(pg_temp.id('a'), pg_temp.d('mon'), pg_temp.ts('a', 'mon', '13:30'), pg_temp.ts('a', 'mon', '17:00'))), 'present',
  'configured threshold 300 is halved to 150 on a half-day leave: worked 150 -> present');
select test.eq((select o_status from hr_private.attendance_compute(pg_temp.id('a'), pg_temp.d('mon'), pg_temp.ts('a', 'mon', '13:30'), pg_temp.ts('a', 'mon', '16:50'))), 'half_day',
  'configured threshold 300 halved to 150: worked 140 -> half_day');
update public.hr_shifts set half_day_minutes = null where id = pg_temp.id('shift');

-- totals over the week
select test.eq((hr_private.attendance_totals(pg_temp.id('a'), pg_temp.d('mon'), pg_temp.d('fri')) ->> 'leave_days')::int, 0,
  'totals: half days are not counted as leave days');
select test.eq((hr_private.attendance_totals(pg_temp.id('a'), pg_temp.d('mon'), pg_temp.d('fri')) ->> 'working_days')::int, 5,
  'totals: half-day leave dates count as working days');
select test.eq((hr_private.attendance_totals(pg_temp.id('a'), pg_temp.d('mon'), pg_temp.d('fri')) ->> 'expected_minutes')::int, 1200,
  'totals: expected minutes = 5 x 240');
select test.eq((hr_private.attendance_totals(pg_temp.id('b'), pg_temp.d('mon'), pg_temp.d('tue')) ->> 'leave_days')::int, 1,
  'totals: full-day leave without punches (two approved halves) counted as a leave day');

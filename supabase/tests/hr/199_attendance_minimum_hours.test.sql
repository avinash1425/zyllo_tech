-- Minimum hours for a half day (migration 199).
-- Normal working day, punched in and out:
--   worked < 4h -> absent (leave); 4h up to a full day -> half_day; full day -> present / late.
-- Full day (blank half_day_minutes) = expected minutes less late + early-leave grace.
-- Half-day leave days keep the 195 rules (never absent).
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_d (k text primary key, d date);
grant all on t_ids, t_d to authenticated, anon, service_role;

do $$
declare mon date; sh uuid; lt uuid; a uuid; hr uuid;
begin
  insert into public.hr_shifts (name, code, start_time, end_time, grace_minutes, break_minutes, early_leave_grace_minutes, working_days)
  values ('MH Day', 'MHDAY', '09:00', '18:00', 15, 60, 10, '{1,2,3,4,5}') returning id into sh;   -- expected 480, full day from 455
  hr := test.make_employee('mh.hr@test.local', 'Hari', null, array['hr_admin']);
  a := test.make_employee('mh.a@test.local', 'Anil');
  update public.hr_employees set shift_id = sh where id = a;
  insert into public.hr_leave_types (code, name, paid, annual_entitlement) values ('MHCL', 'MH Casual', true, 12) returning id into lt;
  insert into t_ids values ('shift', sh), ('lt', lt), ('hr', hr), ('a', a);
  mon := hr_private.business_today() - (extract(isodow from hr_private.business_today())::int - 1) - 14;
  insert into t_d values ('mon', mon), ('tue', mon + 1), ('wed', mon + 2), ('thu', mon + 3), ('fri', mon + 4);
end $$;

create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.d(p_k text) returns date language sql as $$ select d from t_d where k = p_k $$;
create or replace function pg_temp.ts(p_k text, p_t time) returns timestamptz language sql as $$
  select ((select d from t_d where k = p_k) + p_t) at time zone hr_private.employee_timezone((select v from t_ids where k = 'a'))
$$;
-- status computed for employee 'a' on Monday from in/out times
create or replace function pg_temp.st(p_in time, p_out time) returns text language sql as $$
  select o_status from hr_private.attendance_compute(pg_temp.id('a'), pg_temp.d('mon'), pg_temp.ts('mon', p_in),
                                                     case when p_out is null then null else pg_temp.ts('mon', p_out) end)
$$;

-- =====================================================================
-- Default thresholds: absent below 240, full day from 455
-- =====================================================================
select test.eq(pg_temp.st('09:00', '12:00'), 'absent',   'worked 120 (< 4h) -> absent');
select test.eq(pg_temp.st('09:00', '13:59'), 'absent',   'worked 239 (1 minute under 4h) -> absent');
select test.eq(pg_temp.st('09:00', '14:00'), 'half_day', 'worked 240 (exactly 4h) -> half_day');
select test.eq(pg_temp.st('09:00', '17:00'), 'half_day', 'worked 420 (short of full day) -> half_day');
select test.eq(pg_temp.st('09:00', '17:50'), 'present',  'worked 470, left within early-leave grace -> present');
select test.eq(pg_temp.st('09:15', '17:50'), 'present',  'worked 455 using both graces -> present');
select test.eq(pg_temp.st('09:30', '18:00'), 'half_day', 'late 30 and worked 450 (< 455) -> half_day');
select test.eq(pg_temp.st('09:30', '18:30'), 'late',     'late 30 but made up the hours -> late');
select test.eq(pg_temp.st('09:00', null),    'present',  'punched in, not yet out -> present (rule applies at punch-out)');
select test.eq(pg_temp.st('10:00', null),    'late',     'punched in late, not yet out -> late');

-- Stored through HR manual entry (same path as punch-out recalculation)
select test.as_user(test.user_of(pg_temp.id('hr')));
select public.hr_upsert_attendance_manual(pg_temp.id('a'), pg_temp.d('tue'), pg_temp.ts('tue', '09:00'), pg_temp.ts('tue', '11:00'), 'Left after 2 hours');
select public.hr_upsert_attendance_manual(pg_temp.id('a'), pg_temp.d('wed'), pg_temp.ts('wed', '09:00'), pg_temp.ts('wed', '15:00'), 'Left after 5 hours');
select test.as_owner();
select test.eq((select status from public.hr_attendance where employee_id = pg_temp.id('a') and work_date = pg_temp.d('tue')), 'absent', 'stored: 1h worked -> absent');
select test.eq((select worked_minutes from public.hr_attendance where employee_id = pg_temp.id('a') and work_date = pg_temp.d('tue')), 60, 'stored: worked minutes kept on an absent day');
select test.eq((select status from hr_private.attendance_day(pg_temp.id('a'), pg_temp.d('tue'))), 'absent', 'attendance_day reports the punched absent day');
select test.eq((select status from public.hr_attendance where employee_id = pg_temp.id('a') and work_date = pg_temp.d('wed')), 'half_day', 'stored: 5h worked (4h net) -> half_day');
select test.eq((hr_private.attendance_totals(pg_temp.id('a'), pg_temp.d('tue'), pg_temp.d('wed')) ->> 'absent_days')::int, 1, 'totals count the short day as absent');

-- =====================================================================
-- Configured thresholds on the shift
-- =====================================================================
update public.hr_shifts set absent_below_minutes = 180, half_day_minutes = 300 where id = pg_temp.id('shift');
select test.eq(pg_temp.st('09:00', '12:59'), 'absent',   'configured absent 180: worked 179 -> absent');
select test.eq(pg_temp.st('09:00', '13:00'), 'half_day', 'configured absent 180: worked 180 -> half_day');
select test.eq(pg_temp.st('09:00', '15:00'), 'present',  'configured full day 300: worked 300 -> present');
update public.hr_shifts set absent_below_minutes = null, half_day_minutes = null where id = pg_temp.id('shift');
select test.throws($q$update public.hr_shifts set absent_below_minutes = 2000 where code = 'MHDAY'$q$, 'absent_below_minutes range checked', 'check');

-- =====================================================================
-- Half-day leave day: short afternoon stays half_day, never absent
-- =====================================================================
insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, start_half, end_half, days, year, reason, status)
values (pg_temp.id('a'), pg_temp.id('lt'), pg_temp.d('thu'), pg_temp.d('thu'), false, true, 0.5,
        extract(year from pg_temp.d('thu'))::int, 'Synthetic morning off', 'approved');
select test.eq((select o_status from hr_private.attendance_compute(pg_temp.id('a'), pg_temp.d('thu'), pg_temp.ts('thu', '13:30'), pg_temp.ts('thu', '15:00'))),
  'half_day', 'first-half leave + 30 min worked -> half_day (not absent)');

-- Holiday-style non-working day: short work is still present (overtime), not absent
select test.eq((select o_status from hr_private.attendance_compute(pg_temp.id('a'), pg_temp.d('mon') + 5, pg_temp.ts('mon', '10:00') + interval '5 days', pg_temp.ts('mon', '11:00') + interval '5 days')),
  'present', 'weekly off: 1h worked -> present, not absent');

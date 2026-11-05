-- Module 5 Attendance & Time (migration 125): shift assignments, weekly
-- offs, holidays (recurring / company), leave interaction, employee
-- timezone + DST, overnight shifts, punch log, overview / summary /
-- calendar RPCs, regularization approval sequence, payroll lock.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_d (k text primary key, d date);
grant all on t_ids, t_d to authenticated, anon, service_role;

do $$
declare dep uuid; dep2 uuid; mon date; m date; sat1 date; lt uuid;
begin
  insert into public.hr_departments (code, name) values ('M5A', 'M5 Ops') returning id into dep;
  insert into public.hr_departments (code, name) values ('M5B', 'M5 Sales') returning id into dep2;
  insert into t_ids values ('dep', dep), ('dep2', dep2);
  with x as (insert into public.hr_shifts (name, code, start_time, end_time, grace_minutes, break_minutes, early_leave_grace_minutes, working_days)
    values ('M5 Day', 'M5DAY', '09:00', '18:00', 15, 60, 10, '{1,2,3,4,5}') returning id) insert into t_ids select 'day', id from x;
  with x as (insert into public.hr_shifts (name, code, start_time, end_time, grace_minutes, break_minutes, early_leave_grace_minutes, working_days, weekly_off_rules)
    values ('M5 Six Day', 'M5SIX', '10:00', '19:00', 5, 60, 10, '{1,2,3,4,5,6}', '{"6": [2, 4]}') returning id) insert into t_ids select 'six', id from x;
  with x as (insert into public.hr_shifts (name, code, start_time, end_time, grace_minutes, break_minutes, early_leave_grace_minutes, working_days)
    values ('M5 Night', 'M5NIGHT', '22:00', '06:00', 10, 60, 10, '{1,2,3,4,5,6,7}') returning id) insert into t_ids select 'night', id from x;
  insert into t_ids values ('hr',   test.make_employee('m5.hr@test.local', 'Hira', null, array['hr_admin']));
  insert into t_ids values ('mgr',  test.make_employee('m5.mgr@test.local', 'Manu', null, array['manager','employee'], 'full_time', dep));
  insert into t_ids values ('mgr2', test.make_employee('m5.mgr2@test.local', 'Mira', null, array['manager','employee'], 'full_time', dep2));
  insert into t_ids values ('emp1', test.make_employee('m5.emp1@test.local', 'Esha', (select v from t_ids where k='mgr'), array['employee'], 'full_time', dep));
  insert into t_ids values ('emp2', test.make_employee('m5.emp2@test.local', 'Eli', (select v from t_ids where k='mgr2'), array['employee'], 'full_time', dep2));
  insert into t_ids values ('emp3', test.make_employee('m5.emp3@test.local', 'Ezra', (select v from t_ids where k='mgr'), array['employee'], 'full_time', dep));
  update public.hr_employees set shift_id = (select v from t_ids where k='day') where id in ((select v from t_ids where k='emp1'), (select v from t_ids where k='emp2'), (select v from t_ids where k='emp3'));
  -- Monday two weeks ago (inside the 30-day correction window)
  mon := hr_private.business_today() - (extract(isodow from hr_private.business_today())::int - 1) - 14;
  insert into t_d values ('mon', mon), ('tue', mon + 1), ('wed', mon + 2), ('thu', mon + 3), ('fri', mon + 4), ('sat', mon + 5), ('sun', mon + 6);
  -- 1st and 2nd Saturday of the month ~2 months ago
  m := date_trunc('month', hr_private.business_today() - 60)::date;
  sat1 := m + ((6 - extract(isodow from m)::int + 7) % 7);
  insert into t_d values ('sat1', sat1), ('sat2', sat1 + 7);
  insert into public.hr_leave_types (code, name, paid, annual_entitlement) values ('M5CL', 'M5 Casual', true, 12) returning id into lt;
  insert into t_ids values ('lt', lt);
end $$;

create or replace function pg_temp.ts(p_k text, p_t time, p_tz text default 'Asia/Kolkata') returns timestamptz language sql as $$
  select ((select d from t_d where k = p_k) + p_t) at time zone p_tz
$$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.d(p_k text) returns date language sql as $$ select d from t_d where k = p_k $$;
create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;

-- =====================================================================
-- Shifts and assignments
-- =====================================================================
select test.throws($q$insert into public.hr_shifts (name, start_time, end_time, weekly_off_rules) values ('Bad rules', '09:00', '17:00', '{"8": [1]}')$q$,
  'invalid weekly-off rules rejected', 'weekly_off_rules');

select pg_temp.su('emp1');
select test.throws(format('select public.hr_assign_shift(%L, %L, current_date)', pg_temp.id('emp1'), pg_temp.id('six')),
  'employee cannot assign shifts', 'not allowed');
select test.throws($q$insert into public.hr_shift_assignments (employee_id, shift_id, effective_from) values (hr_private.current_employee_id(), (select v from t_ids where k='six'), current_date)$q$,
  'employee cannot insert assignments directly', 'permission denied');
select pg_temp.su('hr');
select test.throws(format('select public.hr_assign_shift(%L, %L, current_date)', pg_temp.id('hr'), pg_temp.id('six')),
  'HR cannot assign own shift', 'own shift');
-- emp2: six-day shift for the past ~3 months, open-ended
insert into t_ids select 'a1', (public.hr_assign_shift(pg_temp.id('emp2'), pg_temp.id('six'), hr_private.business_today() - 90, null, 'Sales rota') ->> 'id')::uuid;
select test.eq((select shift_name from hr_private.employee_shift_on(pg_temp.id('emp2'), pg_temp.d('mon'))), 'M5 Six Day', 'assignment overrides employee shift');
select test.eq((select shift_name from hr_private.employee_shift_on(pg_temp.id('emp2'), hr_private.business_today() - 120)), 'M5 Day', 'before assignment the employee shift applies');
-- a bounded assignment inside the open-ended one overlaps -> rejected
select test.throws(format('select public.hr_assign_shift(%L, %L, %L, %L)', pg_temp.id('emp2'), pg_temp.id('day'), hr_private.business_today() - 100, hr_private.business_today() - 80),
  'overlapping assignment rejected', 'overlaps');
-- shift change from the future: earlier open-ended assignment is ended the day before
insert into t_ids select 'a2', (public.hr_assign_shift(pg_temp.id('emp2'), pg_temp.id('day'), hr_private.business_today() + 10, null, 'Back to day shift') ->> 'id')::uuid;
select test.eq((select effective_to from public.hr_shift_assignments where id = pg_temp.id('a1')), hr_private.business_today() + 9, 'shift change ends previous assignment the day before');
select test.throws(format('select public.hr_assign_shift(%L, %L, %L)', pg_temp.id('emp2'), pg_temp.id('night'), hr_private.business_today() + 10),
  'second assignment on the same start date rejected', 'overlaps');
select public.hr_cancel_shift_assignment(pg_temp.id('a2'), 'Plan changed');
select test.eq((select status from public.hr_shift_assignments where id = pg_temp.id('a2')), 'cancelled', 'future assignment cancelled');
select test.throws(format('select public.hr_cancel_shift_assignment(%L)', pg_temp.id('a1')), 'started assignment cannot be cancelled', 'already started');
select test.throws(format('select public.hr_end_shift_assignment(%L, %L)', pg_temp.id('a1'), hr_private.business_today() - 200),
  'end date before start rejected', 'on or after');
select test.ok((public.hr_end_shift_assignment(pg_temp.id('a1'), hr_private.business_today() + 30) ->> 'effective_to')::date = hr_private.business_today() + 30, 'assignment end date updated');
select test.throws(format($q$update public.hr_shifts set active = false where id = %L$q$, pg_temp.id('six')),
  'shift with current assignments cannot be deactivated', 'assigned');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_shift_assignments'), 'shift assignments are audited');
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp2')) and type = 'attendance.shift_assigned'),
  'employee notified of shift assignment');
select pg_temp.su('emp2');
select test.eq(test.count_rows('select 1 from public.hr_shift_assignments'), 2::bigint, 'employee sees own shift history');
select pg_temp.su('mgr');
select test.eq(test.count_rows('select 1 from public.hr_shift_assignments'), 0::bigint, 'other team manager sees no assignments');
select pg_temp.su('mgr2');
select test.eq(test.count_rows('select 1 from public.hr_shift_assignments'), 2::bigint, 'manager sees team shift history');
select test.as_owner();

-- =====================================================================
-- Day classification: weekly offs, holidays, leave
-- =====================================================================
select test.eq(hr_private.attendance_day_type(pg_temp.id('emp2'), pg_temp.d('sat1')), 'working', 'six-day shift: 1st Saturday is a working day');
select test.eq(hr_private.attendance_day_type(pg_temp.id('emp2'), pg_temp.d('sat2')), 'weekly_off', 'weekly-off rule: 2nd Saturday off');
select test.eq(hr_private.attendance_day_type(pg_temp.id('emp1'), pg_temp.d('sat')), 'weekly_off', 'five-day shift: Saturday off');
select test.ok(not hr_private.is_working_day_for(pg_temp.id('emp2'), pg_temp.d('sat2')), 'shared is_working_day_for honours weekly-off rules');

-- recurring holiday defined in an earlier year; a company-specific one
insert into public.hr_holidays (holiday_date, name, type, is_recurring)
values ((pg_temp.d('wed') - interval '2 years')::date, 'M5 Founders Day', 'company', true);
select test.eq(hr_private.attendance_day_type(pg_temp.id('emp1'), pg_temp.d('wed')), 'holiday', 'recurring annual holiday applies this year');
select test.ok(not hr_private.is_holiday(pg_temp.d('wed') - 1, pg_temp.id('emp1')), 'recurring holiday only on its month/day');
do $$
declare le uuid;
begin
  insert into public.hr_legal_entities (name, code) values ('M5 Subsidiary', 'M5SUB') returning id into le;
  insert into t_ids values ('le', le);
  update public.hr_employees set legal_entity_id = le where id = (select v from t_ids where k = 'emp3');
  insert into public.hr_holidays (holiday_date, name, type, legal_entity_id) values ((select d from t_d where k = 'thu'), 'M5 Subsidiary Day', 'company', le);
end $$;
select test.eq(hr_private.attendance_day_type(pg_temp.id('emp3'), pg_temp.d('thu')), 'holiday', 'company holiday applies to that company''s employee');
select test.eq(hr_private.attendance_day_type(pg_temp.id('emp1'), pg_temp.d('thu')), 'working', 'company holiday does not apply to other companies');
select test.throws($q$insert into public.hr_holidays (holiday_date, name, is_recurring) values ('2024-02-29', 'Leap', true)$q$, 'recurring 29 Feb rejected', '29 February');

-- approved leave for emp1 on Friday
insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status)
values (pg_temp.id('emp1'), pg_temp.id('lt'), pg_temp.d('fri'), pg_temp.d('fri'), 1, extract(year from pg_temp.d('fri'))::int, 'Family event', 'approved');
select test.eq(hr_private.attendance_day_type(pg_temp.id('emp1'), pg_temp.d('fri')), 'leave', 'approved leave day classified as leave');

-- statuses for days with no record
select test.eq((select status from hr_private.attendance_day(pg_temp.id('emp1'), pg_temp.d('wed'))), 'holiday', 'no record on holiday -> holiday, not absent');
select test.eq((select status from hr_private.attendance_day(pg_temp.id('emp1'), pg_temp.d('sat'))), 'weekend', 'no record on weekly off -> weekend, not absent');
select test.eq((select status from hr_private.attendance_day(pg_temp.id('emp1'), pg_temp.d('fri'))), 'on_leave', 'no record on approved leave -> on_leave');
select test.eq((select status from hr_private.attendance_day(pg_temp.id('emp1'), pg_temp.d('tue'))), 'absent', 'no record on a working day -> absent');
select test.eq((select status from hr_private.attendance_day(pg_temp.id('emp1'), pg_temp.d('mon') + 21)), 'upcoming', 'future day -> upcoming');

-- =====================================================================
-- Calculations: grace, late, half day, holiday work, leave, paid break
-- =====================================================================
select pg_temp.su('hr');
select public.hr_upsert_attendance_manual(pg_temp.id('emp1'), pg_temp.d('mon'), pg_temp.ts('mon', '09:15'), pg_temp.ts('mon', '18:00'), 'Gate log');
select test.ok((select status = 'present' and late_minutes = 0 and worked_minutes = 465 from public.hr_attendance where employee_id = pg_temp.id('emp1') and work_date = pg_temp.d('mon')),
  'exactly at configured grace (15) is not late');
select public.hr_upsert_attendance_manual(pg_temp.id('emp1'), pg_temp.d('tue'), pg_temp.ts('tue', '09:16'), pg_temp.ts('tue', '18:00'), 'Gate log');
select test.ok((select status = 'late' and late_minutes = 16 from public.hr_attendance where employee_id = pg_temp.id('emp1') and work_date = pg_temp.d('tue')),
  'one minute past grace: late by 16 minutes (from shift start)');
select public.hr_upsert_attendance_manual(pg_temp.id('emp1'), pg_temp.d('wed'), pg_temp.ts('wed', '11:00'), pg_temp.ts('wed', '15:00'), 'Holiday release');
select test.ok((select late_minutes = 0 and overtime_minutes = 180 and status = 'present' from public.hr_attendance where employee_id = pg_temp.id('emp1') and work_date = pg_temp.d('wed')),
  'holiday work: never late, all worked time is overtime');
select public.hr_upsert_attendance_manual(pg_temp.id('emp1'), pg_temp.d('fri'), pg_temp.ts('fri', '14:00'), pg_temp.ts('fri', '18:00'), 'Came in after half-day leave');
select test.ok((select late_minutes = 0 and status = 'present' from public.hr_attendance where employee_id = pg_temp.id('emp1') and work_date = pg_temp.d('fri')),
  'leave day punches: no late penalty, not half_day');
-- half-day threshold configured on the shift
update public.hr_shifts set half_day_minutes = 300 where id = pg_temp.id('day');
select public.hr_upsert_attendance_manual(pg_temp.id('emp3'), pg_temp.d('mon'), pg_temp.ts('mon', '09:00'), pg_temp.ts('mon', '15:00'), 'Left early');
select test.eq((select early_leave_minutes from public.hr_attendance where employee_id = pg_temp.id('emp3') and work_date = pg_temp.d('mon')), 180,
  'early leave 180 minutes');
select test.eq((select status from public.hr_attendance where employee_id = pg_temp.id('emp3') and work_date = pg_temp.d('mon')), 'present',
  'worked 300 = threshold 300 -> not half day');
update public.hr_shifts set half_day_minutes = null where id = pg_temp.id('day');
-- paid break: no deduction
update public.hr_shifts set break_paid = true where id = pg_temp.id('six');
select public.hr_upsert_attendance_manual(pg_temp.id('emp2'), pg_temp.d('mon'), pg_temp.ts('mon', '10:00'), pg_temp.ts('mon', '19:00'), 'Gate log');
select test.ok((select worked_minutes = 540 and break_minutes = 0 and overtime_minutes = 0 from public.hr_attendance where employee_id = pg_temp.id('emp2') and work_date = pg_temp.d('mon')),
  'paid break not deducted; expected 540 so no overtime');
update public.hr_shifts set break_paid = false where id = pg_temp.id('six');
select test.as_owner();

-- =====================================================================
-- Overnight shift + employee timezone + DST
-- =====================================================================
select pg_temp.su('hr');
select public.hr_assign_shift(pg_temp.id('emp3'), pg_temp.id('night'), pg_temp.d('tue'), pg_temp.d('tue'), 'Night cover');
select public.hr_upsert_attendance_manual(pg_temp.id('emp3'), pg_temp.d('tue'), pg_temp.ts('tue', '22:30'), pg_temp.ts('wed', '06:00'), 'Night cover');
select test.ok((select late_minutes = 30 and worked_minutes = 390 and status = 'late'
                       and expected_end_at = pg_temp.ts('wed', '06:00') from public.hr_attendance where employee_id = pg_temp.id('emp3') and work_date = pg_temp.d('tue')),
  'overnight: expected end next morning, worked across midnight');
-- late check-in after midnight still belongs to the night shift's date
select public.hr_upsert_attendance_manual(pg_temp.id('emp3'), pg_temp.d('tue'), pg_temp.ts('wed', '00:30'), pg_temp.ts('wed', '06:00'), 'Arrived after midnight');
select test.eq((select late_minutes from public.hr_attendance where employee_id = pg_temp.id('emp3') and work_date = pg_temp.d('tue')), 150,
  'overnight: check-in after midnight accepted for previous work date');
select test.throws(format('select public.hr_upsert_attendance_manual(%L, %L, %L, null, %L)', pg_temp.id('emp1'), pg_temp.d('tue'), pg_temp.ts('wed', '00:30'), 'wrong day'),
  'day shift: next-day check-in rejected', 'attendance date');
select test.as_owner();

-- New York location: DST ends 2026-11-01 02:00 -> the night of 31 Oct is 9 hours long.
insert into t_d values ('dst', date '2026-10-31'), ('dst2', date '2026-11-01');
do $$
declare loc uuid;
begin
  insert into public.hr_locations (name, city, timezone) values ('M5 New York', 'New York', 'America/New_York') returning id into loc;
  insert into t_ids values ('ny', loc);
  insert into t_ids values ('nyemp', test.make_employee('m5.ny@test.local', 'Nia', null, array['employee']));
  update public.hr_employees set work_location_id = loc, shift_id = (select v from t_ids where k = 'night') where id = (select v from t_ids where k = 'nyemp');
end $$;
select test.eq(hr_private.employee_timezone(pg_temp.id('nyemp')), 'America/New_York', 'employee timezone comes from work location');
select test.eq(hr_private.employee_timezone(pg_temp.id('emp1')), 'Asia/Kolkata', 'no location -> business timezone');
select pg_temp.su('hr');
select public.hr_upsert_attendance_manual(pg_temp.id('nyemp'), pg_temp.d('dst'), pg_temp.ts('dst', '22:00', 'America/New_York'), pg_temp.ts('dst2', '06:00', 'America/New_York'), 'DST night');
select test.ok((select worked_minutes = 480 and overtime_minutes = 60 and late_minutes = 0 and timezone = 'America/New_York'
                from public.hr_attendance where employee_id = pg_temp.id('nyemp') and work_date = pg_temp.d('dst')),
  'DST fall-back: 9 real hours, 8 worked after break, 1 hour overtime');
select test.as_owner();

-- =====================================================================
-- Self punches: server time, punch log, originals, overnight carry-over
-- =====================================================================
select pg_temp.su('emp1');
select public.hr_check_in('M5 start');
select test.throws('select public.hr_check_in()', 'duplicate punch-in rejected', 'already checked in');
select test.ok((public.hr_my_attendance_today() ->> 'running_minutes') is not null, 'today shows running minutes while checked in');
select test.eq((public.hr_my_attendance_today() #>> '{shift,name}'), 'M5 Day', 'today shows effective shift name');
select public.hr_check_out('M5 end');
select test.throws('select public.hr_check_out()', 'duplicate punch-out rejected', 'already checked out');
select test.eq(test.count_rows(format('select 1 from public.hr_attendance_punches where employee_id = %L and work_date = %L', pg_temp.id('emp1'), hr_private.employee_today(pg_temp.id('emp1')))),
  2::bigint, 'punch log has in + out');
select test.ok((select original_check_in_at = check_in_at and original_check_out_at = check_out_at from public.hr_attendance
                where employee_id = pg_temp.id('emp1') and work_date = hr_private.employee_today(pg_temp.id('emp1'))), 'original self punch times stored');
select test.throws($q$insert into public.hr_attendance_punches (employee_id, work_date, kind, punched_at, source) values (hr_private.current_employee_id(), current_date, 'in', now(), 'self')$q$,
  'employee cannot write punch log', 'permission denied');
select test.as_owner();

-- min punch gap
update public.hr_settings set value = value || '{"min_punch_gap_minutes": 5}' where key = 'attendance';
select pg_temp.su('emp2');
select public.hr_check_in();
select test.throws('select public.hr_check_out()', 'check-out within minimum gap rejected', 'less than 5');
select test.as_owner();
update public.hr_settings set value = value || '{"min_punch_gap_minutes": 0}' where key = 'attendance';

-- overnight carry-over: yesterday's overnight shift still running -> check-in goes to yesterday
do $$
declare tz text := hr_private.business_timezone(); v_end time;
begin
  v_end := least(((now() at time zone tz) + interval '1 hour')::time, time '23:58');
  with x as (insert into public.hr_shifts (name, start_time, end_time, grace_minutes, break_minutes, working_days)
    values ('M5 Carry', '23:59', v_end, 10, 0, '{1,2,3,4,5,6,7}') returning id) insert into t_ids select 'carry', id from x;
  insert into t_ids values ('nemp', test.make_employee('m5.night@test.local', 'Nox', null, array['employee']));
  update public.hr_employees set shift_id = (select v from t_ids where k = 'carry') where id = (select v from t_ids where k = 'nemp');
end $$;
select pg_temp.su('nemp');
select test.eq((public.hr_check_in() ->> 'work_date')::date, hr_private.business_today() - 1, 'late overnight check-in recorded on the shift''s start date');
select test.throws('select public.hr_check_in()', 'second check-in during overnight shift rejected', 'already checked in');
select test.ok((public.hr_my_attendance_today() ->> 'can_check_out')::boolean, 'overnight record can be checked out today');
select test.eq((public.hr_check_out() ->> 'work_date')::date, hr_private.business_today() - 1, 'overnight check-out closes the previous day''s record');
select test.as_owner();

-- missing punch-out detection (computed; does not mutate)
select pg_temp.su('hr');
select public.hr_upsert_attendance_manual(pg_temp.id('emp2'), pg_temp.d('tue'), pg_temp.ts('tue', '10:00'), null, 'Forgot to punch out');
select test.ok((select missing_punch_out and status = 'present' from hr_private.attendance_day(pg_temp.id('emp2'), pg_temp.d('tue'))), 'missing punch-out detected on past open record');
select test.eq(public.hr_mark_missing_punches(pg_temp.d('tue')), 1, 'missing punch marked');
select test.as_owner();

-- =====================================================================
-- Overview / summary / calendar visibility
-- =====================================================================
select pg_temp.su('emp1');
select test.throws('select public.hr_attendance_overview()', 'employee cannot open the HR overview', 'not allowed');
select test.throws('select public.hr_attendance_summary(current_date - 7, current_date)', 'employee cannot open the HR summary', 'not allowed');
select test.ok((public.hr_my_attendance_calendar(to_char(pg_temp.d('mon'), 'YYYY-MM')) ->> 'employee_id')::uuid = pg_temp.id('emp1'), 'employee opens own calendar');
select test.throws(format('select public.hr_my_attendance_calendar(null, %L)', pg_temp.id('emp2')), 'employee cannot open another employee''s calendar', 'not allowed');
select test.as_owner();

select pg_temp.su('mgr');
select test.eq(jsonb_array_length(public.hr_attendance_overview(pg_temp.d('tue')) -> 'rows'), 2, 'manager overview: only own team (emp1, emp3)');
select test.ok(not exists (select 1 from jsonb_array_elements(public.hr_attendance_overview(pg_temp.d('tue')) -> 'rows') r where (r #>> '{employee,id}')::uuid = pg_temp.id('emp2')),
  'manager overview excludes other teams');
select test.ok((public.hr_my_attendance_calendar(null, pg_temp.id('emp1')) ->> 'employee_id') is not null, 'manager opens team member calendar');
select test.throws(format('select public.hr_my_attendance_calendar(null, %L)', pg_temp.id('emp2')), 'manager cannot open non-team calendar', 'not allowed');
select test.as_owner();

select pg_temp.su('hr');
select test.ok((select (o #>> '{kpis,employees}')::int >= 6 from (select public.hr_attendance_overview(pg_temp.d('tue')) o) x), 'HR overview includes all employees');
select test.eq((select (o #>> '{kpis,late}')::int from (select public.hr_attendance_overview(pg_temp.d('tue'), pg_temp.id('dep')) o) x), 2,
  'department filter: emp1 + emp3 late on Tuesday');
select test.eq((select (o #>> '{kpis,present}')::int from (select public.hr_attendance_overview(pg_temp.d('wed'), pg_temp.id('dep')) o) x), 1,
  'Wednesday: emp1 worked the holiday');
select test.eq((select (o #>> '{kpis,holiday}')::int from (select public.hr_attendance_overview(pg_temp.d('wed'), pg_temp.id('dep'), null, null) o) x), 2,
  'Wednesday: mgr and emp3 on holiday, not absent');
select test.eq((select (o #>> '{kpis,absent}')::int from (select public.hr_attendance_overview(pg_temp.d('wed'), pg_temp.id('dep')) o) x), 0,
  'holiday produces no absences');
select test.eq((select (o #>> '{kpis,missing_punch_out}')::int from (select public.hr_attendance_overview(pg_temp.d('tue'), pg_temp.id('dep2')) o) x), 1,
  'missing punch-out counted');
select test.eq(jsonb_array_length(public.hr_attendance_overview(pg_temp.d('tue'), null, 'late', 'Esha') -> 'rows'), 1, 'status + search filters');
select test.eq((select (s #>> '{0,totals,late_days}')::int from (select public.hr_attendance_summary(pg_temp.d('mon'), pg_temp.d('sun'), null, pg_temp.id('emp1')) s) x), 1,
  'summary: one late day for emp1 in the week');
select test.ok((select (s #>> '{0,totals,worked_minutes}')::int = 465 + 464 + 180 + 180
                   and (s #>> '{0,totals,holidays}')::int = 1 and (s #>> '{0,totals,leave_days}')::int = 0
                   and (s #>> '{0,totals,absent_days}')::int = 1 and (s #>> '{0,totals,weekly_offs}')::int = 2
                from (select public.hr_attendance_summary(pg_temp.d('mon'), pg_temp.d('sun'), null, pg_temp.id('emp1')) s) x),
  'summary: worked minutes, holiday, weekly offs and Thursday absence computed from records');
select test.throws(format('select public.hr_attendance_summary(%L, %L)', pg_temp.d('mon'), pg_temp.d('mon') + 200), 'summary range limited', 'at most');
select test.as_owner();

-- holiday calendar
select pg_temp.su('emp3');
select test.ok((select bool_or(h ->> 'name' = 'M5 Subsidiary Day') from jsonb_array_elements(public.hr_holiday_calendar(pg_temp.d('mon'), pg_temp.d('sun'))) h),
  'employee calendar shows own company holiday');
select test.throws(format('select public.hr_holiday_calendar(%L, %L, null, true)', pg_temp.d('mon'), pg_temp.d('sun')), 'employee cannot list every holiday', 'not allowed');
select pg_temp.su('emp1');
select test.ok(not coalesce((select bool_or(h ->> 'name' = 'M5 Subsidiary Day') from jsonb_array_elements(public.hr_holiday_calendar(pg_temp.d('mon'), pg_temp.d('sun'))) h), false),
  'other company''s holiday hidden from employee');
select test.ok((select bool_or(h ->> 'name' = 'M5 Founders Day' and (h ->> 'date')::date = pg_temp.d('wed')) from jsonb_array_elements(public.hr_holiday_calendar(pg_temp.d('mon'), pg_temp.d('sun'))) h),
  'recurring holiday expanded into this year');
select test.throws($q$insert into public.hr_holidays (holiday_date, name) values (current_date + 40, 'Self holiday')$q$, 'employee cannot create holidays', 'row-level security');
select test.as_owner();

-- attendance.manage without leave.manage can maintain holidays
do $$
begin
  insert into public.hr_roles (key, name) values ('mfive_att_admin', 'M5 attendance admin') on conflict do nothing;
  insert into public.hr_role_permissions (role_key, permission_key) values ('mfive_att_admin', 'attendance.manage'), ('mfive_att_admin', 'attendance.view') on conflict do nothing;
  insert into t_ids values ('attadm', test.make_employee('m5.attadm@test.local', 'Ari', null, array['mfive_att_admin']));
end $$;
select pg_temp.su('attadm');
insert into public.hr_holidays (holiday_date, name, type) values (current_date + 41, 'M5 Attendance-managed', 'company');
select test.eq(test.count_rows($q$select 1 from public.hr_holidays where name = 'M5 Attendance-managed'$q$), 1::bigint, 'attendance.manage can create holidays');
select test.as_owner();

-- =====================================================================
-- Regularization (corrections workflow)
-- =====================================================================
-- status correction approved by manager (single stage, default)
select pg_temp.su('emp1');
insert into t_ids select 'r1', public.hr_request_attendance_regularization(pg_temp.d('thu'), 'status_correction', null, null, 'present', 'Client site visit all day', 'Visit report #M5-1');
select test.throws(format($q$select public.hr_request_attendance_regularization(%L, 'incorrect_time', %L, null, null, 'again')$q$, pg_temp.d('thu'), pg_temp.ts('thu', '09:00')),
  'duplicate active request for the same date rejected', 'pending correction');
select test.throws(format($q$select public.hr_request_attendance_regularization(%L, 'missed_punch_in', null, null, null, 'nothing')$q$, pg_temp.d('mon')),
  'missed punch-in needs a time', 'check-in time');
select test.throws(format($q$select public.hr_request_attendance_regularization(%L, 'missed_punch_in', %L, null, null, 'already there')$q$, pg_temp.d('mon'), pg_temp.ts('mon', '09:00')),
  'missed punch-in rejected when a check-in exists', 'already recorded');
select test.throws(format($q$select public.hr_request_attendance_regularization(%L, 'incorrect_time', %L, %L, null, 'same values')$q$, pg_temp.d('mon'), pg_temp.ts('mon', '09:15'), pg_temp.ts('mon', '18:00')),
  'request identical to the record rejected', 'same as the recorded');
select test.throws(format($q$select public.hr_request_attendance_regularization(%L, 'bogus', null, null, 'present', 'x x x')$q$, pg_temp.d('mon')),
  'unknown request type rejected', 'valid request type');
select test.throws(format($q$select public.hr_decide_attendance_correction(%L, true)$q$, pg_temp.id('r1')), 'no self-approval', 'own');
select test.throws($q$update public.hr_attendance_corrections set status = 'approved'$q$, 'employee cannot update corrections directly', 'permission denied');
select test.as_owner();
select test.ok((select approval_stage = 'manager' and original_status is null and request_type = 'status_correction' and evidence_note = 'Visit report #M5-1'
                from public.hr_attendance_corrections where id = pg_temp.id('r1')), 'request stored with stage, type, evidence');
select pg_temp.su('mgr2');
select test.throws(format($q$select public.hr_decide_attendance_correction(%L, true)$q$, pg_temp.id('r1')), 'other manager cannot decide', 'not allowed');
select pg_temp.su('mgr');
select test.eq(public.hr_decide_attendance_correction(pg_temp.id('r1'), true, 'Confirmed with client') ->> 'status', 'approved', 'manager approves (no HR stage configured)');
select test.as_owner();
select test.ok((select status = 'present' and source = 'correction' and check_in_at is null from public.hr_attendance
                where employee_id = pg_temp.id('emp1') and work_date = pg_temp.d('thu')), 'status correction applied to attendance');
select test.ok((select applied_status = 'present' and approval_stage = 'completed' and manager_employee_id = pg_temp.id('mgr')
                from public.hr_attendance_corrections where id = pg_temp.id('r1')), 'applied values and manager recorded');
select test.eq(test.count_rows(format('select 1 from public.hr_attendance_correction_events where correction_id = %L', pg_temp.id('r1'))), 2::bigint,
  'history: submitted + approved');

-- incorrect time with HR review stage enabled; originals preserved
update public.hr_settings set value = value || '{"regularization_hr_review": true}' where key = 'attendance';
select pg_temp.su('emp1');
insert into t_ids select 'r2', public.hr_request_attendance_correction(pg_temp.d('tue'), pg_temp.ts('tue', '09:05'), null, 'Badge reader was down');
select pg_temp.su('mgr');
select test.eq(public.hr_decide_attendance_correction(pg_temp.id('r2'), true, 'Looks right') ->> 'approval_stage', 'hr', 'manager approval moves request to HR stage');
select test.throws(format($q$select public.hr_decide_attendance_correction(%L, true)$q$, pg_temp.id('r2')), 'manager cannot decide the HR stage', 'HR review');
select test.as_owner();
select test.eq((select late_minutes from public.hr_attendance where employee_id = pg_temp.id('emp1') and work_date = pg_temp.d('tue')), 16,
  'attendance unchanged until final approval');
select pg_temp.su('hr');
select test.eq(public.hr_decide_attendance_correction(pg_temp.id('r2'), true, 'HR verified') ->> 'status', 'approved', 'HR final approval');
select test.as_owner();
select test.ok((select late_minutes = 0 and status = 'present' and source = 'correction' from public.hr_attendance where employee_id = pg_temp.id('emp1') and work_date = pg_temp.d('tue')),
  'approved correction recalculates late status');
select test.ok((select original_check_in_at = pg_temp.ts('tue', '09:16') and applied_check_in_at = pg_temp.ts('tue', '09:05') and request_type = 'incorrect_time'
                from public.hr_attendance_corrections where id = pg_temp.id('r2')), 'original and corrected values both kept on the request');
select test.ok(exists (select 1 from public.hr_attendance_punches where employee_id = pg_temp.id('emp1') and work_date = pg_temp.d('tue') and source = 'correction'),
  'punch log records the corrected time');
select test.eq(test.count_rows(format('select 1 from public.hr_attendance_correction_events where correction_id = %L', pg_temp.id('r2'))), 3::bigint,
  'history: submitted, manager_approved, approved');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_attendance' and new_data ->> 'source' = 'correction'), 'correction write audited');

-- rejection needs a reason; employee without manager goes straight to HR
select pg_temp.su('emp1');
select test.throws(format($q$select public.hr_request_attendance_regularization(%L, 'missed_punch_out', null, %L, null, 'x')$q$, pg_temp.d('mon'), pg_temp.ts('mon', '19:00')),
  'reason too short rejected', 'reason');
select test.as_owner();
select pg_temp.su('nyemp');
select test.throws(format($q$select public.hr_request_attendance_regularization(%L, 'missed_punch_out', null, null, null, 'went home')$q$, pg_temp.d('dst')),
  'missed punch-out needs a time', 'check-out time');
select test.as_owner();
select pg_temp.su('emp2');
insert into t_ids select 'r4', public.hr_request_attendance_regularization(pg_temp.d('tue'), 'missed_punch_out', null, pg_temp.ts('tue', '19:00'), null, 'Forgot to punch out', null);
select pg_temp.su('mgr2');
select test.throws(format($q$select public.hr_decide_attendance_correction(%L, false)$q$, pg_temp.id('r4')), 'rejection requires a reason', 'reason');
select test.eq(public.hr_decide_attendance_correction(pg_temp.id('r4'), false, 'No evidence of presence') ->> 'status', 'rejected', 'manager rejects');
select test.as_owner();
select test.eq((select status from public.hr_attendance where employee_id = pg_temp.id('emp2') and work_date = pg_temp.d('tue')), 'missing_punch',
  'rejected request does not change attendance');
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp2')) and type = 'attendance.correction_rejected'),
  'employee notified of rejection');


-- evidence requirement
update public.hr_settings set value = value || '{"regularization_evidence_required": true, "regularization_hr_review": false}' where key = 'attendance';
select pg_temp.su('emp3');
select test.throws(format($q$select public.hr_request_attendance_regularization(%L, 'incorrect_time', %L, null, null, 'Came on time')$q$, pg_temp.d('mon'), pg_temp.ts('mon', '08:55')),
  'evidence required when configured', 'evidence is required');
select test.as_owner();
update public.hr_settings set value = value || '{"regularization_evidence_required": false}' where key = 'attendance';

-- =====================================================================
-- Payroll period lock
-- =====================================================================
insert into public.hr_payroll_runs (period_start, period_end, status) values (pg_temp.d('mon') - 40, pg_temp.d('mon') - 20, 'finalized');
select pg_temp.su('hr');
select test.throws(format('select public.hr_upsert_attendance_manual(%L, %L, null, null, %L, %L)', pg_temp.id('emp1'), pg_temp.d('mon') - 30, 'Late absence entry', 'absent'),
  'manual entry blocked inside finalized payroll period', 'locked');
select test.as_owner();
select test.ok(not hr_private.attendance_period_locked(pg_temp.d('mon')), 'dates outside finalized runs are not locked');

-- Company-scoped payroll runs (column added by migration 170): a run for one
-- company must not lock attendance for employees of another company.
do $$
declare d date := (select d from t_d where k = 'mon') - 75;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'hr_payroll_runs' and column_name = 'legal_entity_id') then
    execute format('insert into public.hr_payroll_runs (period_start, period_end, status, legal_entity_id) values (%L, %L, %L, %L)',
                   d, d + 10, 'finalized', (select v from t_ids where k = 'le'));
    perform test.ok(hr_private.attendance_period_locked(d + 5, (select v from t_ids where k = 'emp3')), 'company payroll run locks its own employees');
    perform test.ok(not hr_private.attendance_period_locked(d + 5, (select v from t_ids where k = 'emp1')), 'company payroll run does not lock other companies');
  else
    perform test.ok(hr_private.attendance_period_locked(pg_temp.d('mon') - 30, pg_temp.id('emp1')), 'without company-scoped runs every finalized run is company-wide');
  end if;
end $$;

-- 101 entry points still work for the existing UI
select pg_temp.su('emp3');
select test.ok(public.hr_request_attendance_correction(pg_temp.d('fri'), pg_temp.ts('fri', '09:00'), pg_temp.ts('fri', '18:00'), 'Missed both punches') is not null,
  'legacy correction RPC creates a typed request');
select test.as_owner();
select test.eq((select request_type from public.hr_attendance_corrections where employee_id = pg_temp.id('emp3') and work_date = pg_temp.d('fri')), 'missed_punch_in',
  'legacy request typed as missed punch-in');

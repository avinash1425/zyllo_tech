-- Attendance & Time: self check-in/out, calculations, RLS, corrections,
-- manual entries, missing punches, login history.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_d (k text primary key, d date);
grant all on t_ids, t_d to authenticated, anon, service_role;

do $$
declare dep uuid; sh uuid; mon date;
begin
  insert into public.hr_departments (code, name) values ('ATT', 'Attendance Test Dept') returning id into dep;
  insert into public.hr_shifts (name, start_time, end_time, grace_minutes, break_minutes, early_leave_grace_minutes, overtime_after_minutes)
  values ('Test Day Shift', '09:00', '18:00', 10, 60, 10, 30) returning id into sh;
  insert into t_ids values ('shift', sh);
  insert into t_ids values ('hr',   test.make_employee('att.hr@test.local', 'Hana', null, array['hr_admin']));
  insert into t_ids values ('mgr',  test.make_employee('att.mgr@test.local', 'Milo', null, array['manager','employee'], 'full_time', dep));
  insert into t_ids values ('mgr2', test.make_employee('att.mgr2@test.local', 'Maya', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('att.emp1@test.local', 'Eshan', (select v from t_ids where k='mgr'), array['employee'], 'full_time', dep));
  insert into t_ids values ('emp2', test.make_employee('att.emp2@test.local', 'Edda', null, array['employee']));
  update public.hr_employees set shift_id = sh where id = (select v from t_ids where k='emp1');
  -- Monday of last week (a working day in the business timezone)
  mon := hr_private.business_today() - (extract(isodow from hr_private.business_today())::int - 1) - 7;
  insert into t_d values ('mon', mon), ('tue', mon + 1), ('wed', mon + 2), ('thu', mon + 3), ('fri', mon + 4), ('sat', mon + 5);
end $$;

create or replace function pg_temp.ts(p_k text, p_t time) returns timestamptz language sql as $$
  select ((select d from t_d where k = p_k) + p_t) at time zone 'Asia/Kolkata'
$$;

create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;

-- ---- anon cannot call attendance RPCs
select test.as_anon();
select test.throws('select public.hr_check_in()', 'anon cannot check in', 'permission denied');
select test.as_owner();

-- ---- self check-in / check-out
select pg_temp.su('emp1');
select test.ok((public.hr_my_attendance_today() ->> 'can_check_in')::boolean, 'today status says can check in');
select test.ok((select x between now() and clock_timestamp() from (select (public.hr_check_in('Starting work') ->> 'check_in_at')::timestamptz as x offset 0) s),
  'check-in uses server time');
select test.eq((select work_date from public.hr_attendance), hr_private.business_today(), 'check-in recorded on business date');
select test.eq((select source from public.hr_attendance), 'self', 'check-in source is self');
select test.throws('select public.hr_check_in()', 'second check-in same day rejected', 'already checked in');
select test.ok((public.hr_my_attendance_today() ->> 'can_check_out')::boolean, 'today status says can check out');
select test.ok((public.hr_check_out('Done') ->> 'check_out_at') is not null, 'check-out recorded');
select test.throws('select public.hr_check_out()', 'second check-out rejected', 'already checked out');
-- direct writes are blocked
select test.throws($q$insert into public.hr_attendance (employee_id, work_date, status) values (hr_private.current_employee_id(), current_date - 3, 'present')$q$,
  'employee cannot insert attendance directly', 'permission denied');
select test.throws($q$update public.hr_attendance set worked_minutes = 999$q$, 'employee cannot update attendance directly', 'permission denied');
select test.throws($q$select public.hr_upsert_attendance_manual(hr_private.current_employee_id(), current_date, null, null, 'note', 'absent')$q$,
  'employee cannot make manual entries', 'not allowed');
select test.as_owner();

select pg_temp.su('emp2');
select test.throws('select public.hr_check_out()', 'check-out without check-in rejected', 'not checked in');
select test.as_owner();

-- ---- HR manual entries + calculations (emp1 shift 09:00-18:00, grace 10, break 60, OT after 30)
select pg_temp.su('hr');
select public.hr_upsert_attendance_manual((select v from t_ids where k='emp1'), (select d from t_d where k='mon'),
  pg_temp.ts('mon', '09:05'), pg_temp.ts('mon', '18:00'), 'Biometric outage');
select test.ok((select status = 'present' and late_minutes = 0 and worked_minutes = 475 and overtime_minutes = 0 and early_leave_minutes = 0
                  and source = 'manual' and break_minutes = 60
                from public.hr_attendance where work_date = (select d from t_d where k='mon')),
  'within grace: present, worked 475, no OT');
select public.hr_upsert_attendance_manual((select v from t_ids where k='emp1'), (select d from t_d where k='tue'),
  pg_temp.ts('tue', '09:25'), pg_temp.ts('tue', '18:20'), 'Biometric outage');   -- stays late to make up the hours (199: full day needed)
select test.ok((select status = 'late' and late_minutes = 25 from public.hr_attendance where work_date = (select d from t_d where k='tue')),
  'beyond grace: late by 25 minutes');
select public.hr_upsert_attendance_manual((select v from t_ids where k='emp1'), (select d from t_d where k='wed'),
  pg_temp.ts('wed', '09:00'), pg_temp.ts('wed', '13:00'), 'Left early - approved');
select test.ok((select status = 'absent' and worked_minutes = 180 and early_leave_minutes = 300 from public.hr_attendance where work_date = (select d from t_d where k='wed')),
  'worked < 4 hours: absent (199) with early leave 300');
select public.hr_upsert_attendance_manual((select v from t_ids where k='emp1'), (select d from t_d where k='thu'),
  pg_temp.ts('thu', '09:00'), pg_temp.ts('thu', '20:00'), 'Release night');
select test.eq((select overtime_minutes from public.hr_attendance where work_date = (select d from t_d where k='thu')), 90,
  'overtime only beyond shift length + overtime_after (600 - 480 - 30)');
select public.hr_upsert_attendance_manual((select v from t_ids where k='emp1'), (select d from t_d where k='sat'),
  pg_temp.ts('sat', '10:00'), pg_temp.ts('sat', '14:00'), 'Weekend deployment');
select test.ok((select overtime_minutes = 180 and late_minutes = 0 from public.hr_attendance where work_date = (select d from t_d where k='sat')),
  'work on a non-working day counts entirely as overtime');
-- fallback shift for an employee without a shift (no default shift exists)
select public.hr_upsert_attendance_manual((select v from t_ids where k='emp2'), (select d from t_d where k='mon'),
  pg_temp.ts('mon', '09:15'), pg_temp.ts('mon', '18:00'), 'Card reader failure');
select test.ok((select late_minutes = 15 and worked_minutes = 465 and shift_id is null
                from public.hr_attendance where employee_id = (select v from t_ids where k='emp2') and work_date = (select d from t_d where k='mon')),
  'fallback 09:00-18:00 shift with 10 min grace applied');
select public.hr_upsert_attendance_manual((select v from t_ids where k='emp2'), (select d from t_d where k='tue'), null, null, 'No show', 'absent');
select test.eq((select status from public.hr_attendance where employee_id = (select v from t_ids where k='emp2') and work_date = (select d from t_d where k='tue')),
  'absent', 'manual absent recorded');
select test.throws(format('select public.hr_upsert_attendance_manual(%L, %L, null, null, %L)', (select v from t_ids where k='hr'), (select d from t_d where k='mon'), 'self edit'),
  'HR cannot manually edit own attendance', 'own attendance');
select test.throws(format('select public.hr_upsert_attendance_manual(%L, %L, %L, %L, %L)', (select v from t_ids where k='emp2'), (select d from t_d where k='fri'),
  pg_temp.ts('fri', '18:00'), pg_temp.ts('fri', '09:00'), 'bad times'), 'check-out before check-in rejected', 'after check-in');
select test.throws(format('select public.hr_upsert_attendance_manual(%L, %L, %L, null, %L)', (select v from t_ids where k='emp2'), current_date + 5,
  now() + interval '5 days', 'future'), 'future manual entry rejected', 'today or past');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_attendance' and new_data ->> 'source' = 'manual'), 'manual entries are audited');

-- ---- RLS scoping
select pg_temp.su('emp1');
select test.eq(test.count_rows('select 1 from public.hr_attendance'), 6::bigint, 'employee sees only own attendance');
select pg_temp.su('mgr');
select test.eq(test.count_rows('select 1 from public.hr_attendance'), 6::bigint, 'manager sees team attendance only');
select pg_temp.su('mgr2');
select test.eq(test.count_rows('select 1 from public.hr_attendance'), 0::bigint, 'unrelated manager sees nothing');
select pg_temp.su('hr');
select test.eq(test.count_rows('select 1 from public.hr_attendance'), 8::bigint, 'HR sees all attendance');
select test.as_owner();

-- ---- corrections
select pg_temp.su('emp1');
insert into t_ids select 'corr1', public.hr_request_attendance_correction((select d from t_d where k='tue'), pg_temp.ts('tue', '09:00'), pg_temp.ts('tue', '18:30'), 'Forgot badge, was on time');
select test.throws(format('select public.hr_request_attendance_correction(%L, %L, null, %L)', (select d from t_d where k='tue'), pg_temp.ts('tue', '09:01'), 'again'),
  'duplicate pending correction rejected', 'pending correction');
select test.throws(format('select public.hr_decide_attendance_correction(%L, true)', (select v from t_ids where k='corr1')),
  'employee cannot decide own correction', 'own');
select test.throws(format('select public.hr_request_attendance_correction(%L, %L, null, %L)', current_date + 3, now() + interval '3 days', 'future'),
  'future correction rejected', 'today or past');
insert into t_ids select 'corr2', public.hr_request_attendance_correction((select d from t_d where k='wed'), null, pg_temp.ts('wed', '18:00'), 'Stayed till end of day');
select public.hr_cancel_attendance_correction((select v from t_ids where k='corr2'));
select test.eq((select status from public.hr_attendance_corrections where id = (select v from t_ids where k='corr2')), 'cancelled', 'own pending correction cancelled');
select test.throws(format('select public.hr_cancel_attendance_correction(%L)', (select v from t_ids where k='corr2')), 'cannot cancel twice', 'pending');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of((select v from t_ids where k='mgr'))
                       and type = 'attendance.correction_requested'), 'manager notified of correction request');

select pg_temp.su('mgr2');
select test.throws(format('select public.hr_decide_attendance_correction(%L, true)', (select v from t_ids where k='corr1')),
  'manager cannot decide non-team correction', 'not allowed');
select pg_temp.su('mgr');
select test.eq(test.count_rows('select 1 from public.hr_attendance_corrections where status = ''pending'''), 1::bigint, 'manager sees team pending correction');
select test.eq(public.hr_decide_attendance_correction((select v from t_ids where k='corr1'), true, 'Verified with security log') ->> 'status', 'approved', 'manager approves team correction');
select test.throws(format('select public.hr_decide_attendance_correction(%L, false, %L)', (select v from t_ids where k='corr1'), 'no'),
  'double decision rejected', 'already');
select test.as_owner();
select test.ok((select source = 'correction' and status = 'present' and late_minutes = 0 and worked_minutes = 510 and overtime_minutes = 0
                from public.hr_attendance where employee_id = (select v from t_ids where k='emp1') and work_date = (select d from t_d where k='tue')),
  'approved correction recalculates attendance (510 worked, OT within allowance)');
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of((select v from t_ids where k='emp1'))
                       and type = 'attendance.correction_approved'), 'employee notified of decision');

-- ---- missing punches
select pg_temp.su('hr');
select public.hr_upsert_attendance_manual((select v from t_ids where k='emp2'), (select d from t_d where k='wed'),
  pg_temp.ts('wed', '09:00'), null, 'Check-in from gate log');
select test.eq(test.count_rows('select 1 from public.hr_attendance_missing_punches'), 1::bigint, 'missing punch reported by view');
select test.eq((select status from public.hr_attendance where employee_id = (select v from t_ids where k='emp2') and work_date = (select d from t_d where k='wed')),
  'present', 'view does not mutate status');
select pg_temp.su('emp1');
select test.throws(format('select public.hr_mark_missing_punches(%L)', (select d from t_d where k='wed')), 'employee cannot mark missing punches', 'not allowed');
select pg_temp.su('hr');
select test.eq(public.hr_mark_missing_punches((select d from t_d where k='wed')), 1, 'HR marks one missing punch');
select test.eq(public.hr_mark_missing_punches((select d from t_d where k='wed')), 0, 'marking missing punches is idempotent');
select test.throws('select public.hr_mark_missing_punches(hr_private.business_today())', 'cannot mark today', 'past dates');
select test.as_owner();
select test.eq((select status from public.hr_attendance where employee_id = (select v from t_ids where k='emp2') and work_date = (select d from t_d where k='wed')),
  'missing_punch', 'status set to missing_punch');
select test.as_service();
select test.eq(public.hr_mark_missing_punches((select d from t_d where k='thu')), 0, 'service role (scheduler) can run missing-punch job');
select test.as_owner();

-- ---- login history is separate from attendance
select pg_temp.su('emp2');
select public.hr_record_login_event('login', 'Mozilla/5.0 (test)');
select public.hr_record_login_event('logout', null);
select test.eq(test.count_rows('select 1 from public.hr_login_events'), 2::bigint, 'user sees own login events');
select test.eq(test.count_rows('select 1 from public.hr_attendance where work_date = hr_private.business_today()'), 0::bigint, 'login does not create attendance');
select test.throws($q$select public.hr_record_login_event('hack', null)$q$, 'unknown event rejected', 'Unknown');
select test.throws($q$insert into public.hr_login_events (user_id, event) values (auth.uid(), 'login')$q$, 'direct login-event insert blocked', 'permission denied');
select pg_temp.su('mgr');
select test.eq(test.count_rows('select 1 from public.hr_login_events'), 0::bigint, 'others cannot see login events');
select test.as_owner();

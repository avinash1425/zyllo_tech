-- Leave cancellation requests (migration 161): employee asks HR to cancel
-- approved leave that has already started; HR approves (days restored,
-- ledgered) or rejects with a reason; withdraw; guards for pending / future
-- leave, duplicates, self-decision and non-HR deciders.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;

create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.lt(p_code text) returns uuid language sql as $$ select id from public.hr_leave_types where code = p_code $$;
create or replace function pg_temp.y() returns int language sql as $$ select extract(year from hr_private.business_today() - 1)::int $$;
create or replace function pg_temp.used(p_emp text) returns numeric language sql as $$
  select used from public.hr_leave_balances where employee_id = pg_temp.id(p_emp) and leave_type_id = pg_temp.lt('SL') and year = pg_temp.y() $$;

do $$
begin
  insert into t_ids values ('hr',   test.make_employee('lc.hr@test.local', 'Hana', null, array['hr_admin']));
  insert into t_ids values ('mgr',  test.make_employee('lc.mgr@test.local', 'Mona', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('lc.emp1@test.local', 'Eli', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('lc.emp2@test.local', 'Esme', (select v from t_ids where k='mgr')));
end $$;

-- Approved leave that started yesterday (2 days), with the days counted as used.
select test.as_owner();
select hr_private.ensure_leave_balance(pg_temp.id('emp1'), pg_temp.lt('SL'), pg_temp.y());
update public.hr_leave_balances set used = used + 2
 where employee_id = pg_temp.id('emp1') and leave_type_id = pg_temp.lt('SL') and year = pg_temp.y();
insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status)
values (pg_temp.id('emp1'), pg_temp.lt('SL'), hr_private.business_today() - 1, hr_private.business_today() - 1, 2, pg_temp.y(), 'LC started', 'approved'),
       (pg_temp.id('emp1'), pg_temp.lt('SL'), hr_private.business_today() + 30, hr_private.business_today() + 30, 1,
        extract(year from hr_private.business_today() + 30)::int, 'LC future', 'approved'),
       (pg_temp.id('emp1'), pg_temp.lt('SL'), hr_private.business_today() + 30, hr_private.business_today() + 30, 1,
        extract(year from hr_private.business_today() + 30)::int, 'LC pending', 'pending_approval');
insert into t_ids select 'started', id from public.hr_leave_requests where reason = 'LC started';
insert into t_ids select 'future',  id from public.hr_leave_requests where reason = 'LC future';
insert into t_ids select 'pending', id from public.hr_leave_requests where reason = 'LC pending';
select test.eq(pg_temp.used('emp1'), 2.00::numeric, 'setup: 2 days used');

-- ---- employee: guards
select pg_temp.su('emp1');
select test.throws(format('select public.hr_request_leave_cancellation(%L, %L)', pg_temp.id('future'), 'No longer needed'),
  'future approved leave is cancelled directly', 'cancel it directly');
select test.throws(format('select public.hr_request_leave_cancellation(%L, %L)', pg_temp.id('pending'), 'No longer needed'),
  'pending leave is cancelled directly', 'cancel it directly');
select test.throws(format('select public.hr_request_leave_cancellation(%L, %L)', pg_temp.id('started'), 'x'),
  'reason required', 'reason');
select pg_temp.su('emp2');
select test.throws(format('select public.hr_request_leave_cancellation(%L, %L)', pg_temp.id('started'), 'Not mine'),
  'cannot request cancellation of someone else''s leave', 'not found');

-- ---- request, duplicate, withdraw, request again
select pg_temp.su('emp1');
select test.eq(public.hr_request_leave_cancellation(pg_temp.id('started'), 'Came back to work early') ->> 'cancellation_status', 'pending',
  'cancellation requested');
select test.throws(format('select public.hr_request_leave_cancellation(%L, %L)', pg_temp.id('started'), 'Again'),
  'duplicate cancellation request rejected', 'already waiting');
select test.ok((public.hr_withdraw_leave_cancellation(pg_temp.id('started')) ->> 'cancellation_status') is null, 'cancellation withdrawn');
select test.throws(format('select public.hr_withdraw_leave_cancellation(%L)', pg_temp.id('started')), 'nothing left to withdraw', 'no pending');
select public.hr_request_leave_cancellation(pg_temp.id('started'), 'Came back to work early');
select test.eq(test.count_rows(format('select 1 from public.hr_leave_request_events where request_id = %L and action like %L', pg_temp.id('started'), 'cancellation_%')),
  3::bigint, 'requested / withdrawn / requested events recorded');

-- ---- deciders
select test.throws(format('select public.hr_decide_leave_cancellation(%L, true)', pg_temp.id('started')), 'employee cannot decide own cancellation', 'not found');
select pg_temp.su('mgr');
select test.throws(format('select public.hr_decide_leave_cancellation(%L, true)', pg_temp.id('started')), 'line manager cannot decide (HR only)', 'not found');
select pg_temp.su('hr');
select test.throws(format('select public.hr_decide_leave_cancellation(%L, false)', pg_temp.id('started')), 'rejection needs a reason', 'reason');
select test.eq(public.hr_decide_leave_cancellation(pg_temp.id('started'), false, 'Payroll already processed') ->> 'cancellation_status', 'rejected',
  'HR rejects cancellation');
select test.eq((select status from public.hr_leave_requests where id = pg_temp.id('started')), 'approved', 'leave stays approved after rejection');
select test.eq(pg_temp.used('emp1'), 2.00::numeric, 'balance unchanged after rejection');

-- ---- ask again, HR approves: cancelled, days restored, request closed
select pg_temp.su('emp1');
select public.hr_request_leave_cancellation(pg_temp.id('started'), 'Please reconsider, I worked both days');
select pg_temp.su('hr');
select test.ok((select x.status = 'cancelled' and x.cancellation_status is null
                from jsonb_populate_record(null::public.hr_leave_requests, public.hr_decide_leave_cancellation(pg_temp.id('started'), true, 'Confirmed with manager')) x),
  'HR approves: leave cancelled, request closed');
select test.as_owner();
select test.eq(pg_temp.used('emp1'), 0.00::numeric, 'used days restored');
select test.ok(exists (select 1 from public.hr_leave_ledger where request_id = pg_temp.id('started') and entry_type = 'restore'), 'restore ledgered against the request');
select test.ok(exists (select 1 from public.hr_notifications n join public.hr_employees e on e.user_id = n.recipient_user_id
                       where e.id = pg_temp.id('emp1') and n.type = 'leave.cancelled'), 'employee notified of cancellation');
select pg_temp.su('hr');
select test.throws(format('select public.hr_decide_leave_cancellation(%L, true)', pg_temp.id('started')), 'cannot decide twice', 'no pending');

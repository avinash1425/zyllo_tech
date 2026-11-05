-- Leave management: day calculation (weekends/holidays/half days), balances,
-- level-aware approvals, self/non-team approval rejection, duplicate decisions,
-- cancellation, adjustments, year initialisation with carry-forward, RLS.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_d (k text primary key, d date);
grant all on t_ids, t_d to authenticated, anon, service_role;

create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.d(p_k text) returns date language sql as $$ select d from t_d where k = p_k $$;
create or replace function pg_temp.lt(p_code text) returns uuid language sql as $$ select id from public.hr_leave_types where code = p_code $$;
create or replace function pg_temp.bal(p_emp text, p_code text, p_col text) returns numeric language plpgsql as $$
declare v numeric;
begin
  execute format('select %I from public.hr_leave_balances where employee_id = $1 and leave_type_id = $2 and year = $3', p_col)
    into v using pg_temp.id(p_emp), pg_temp.lt(p_code), extract(year from pg_temp.d('mon'))::int;
  return v;
end $$;

do $$
declare y int := extract(year from hr_private.business_today())::int + 1; mon date;
begin
  -- Allow applying for next year's dates so the test is independent of today's date.
  update public.hr_settings set value = value || '{"max_advance_days": 800}' where key = 'leave';
  -- 160 makes policy edits maker-checker by default; this test edits leave types directly (single approver).
  update public.hr_settings set value = value || '{"policy_approval": "not_required"}' where key = 'leave';
  insert into t_ids values ('hr',   test.make_employee('lv.hr@test.local', 'Hema', null, array['hr_admin']));
  insert into t_ids values ('mgr',  test.make_employee('lv.mgr@test.local', 'Manav', null, array['manager','employee']));
  insert into t_ids values ('mgr2', test.make_employee('lv.mgr2@test.local', 'Mira', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('lv.emp1@test.local', 'Ekta', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp3', test.make_employee('lv.emp3@test.local', 'Eden', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('lv.emp2@test.local', 'Ezio'));
  update public.hr_employees set status = 'probation' where id = (select v from t_ids where k='emp3');
  mon := make_date(y, 3, 2);
  mon := mon + ((8 - extract(isodow from mon)::int) % 7);       -- first Monday on/after 2 March next year
  insert into t_d values ('mon', mon), ('tue', mon + 1), ('wed', mon + 2), ('fri', mon + 4), ('sat', mon + 5), ('sun', mon + 6),
                         ('mon2', mon + 7), ('fri2', mon + 11), ('mon3', mon + 14), ('tue3', mon + 15), ('wed3', mon + 16),
                         ('mon4', mon + 21), ('wed4', mon + 23);
end $$;

-- ---- holidays: HR manages, employees read
select pg_temp.su('hr');
insert into public.hr_holidays (holiday_date, name, type) values (pg_temp.d('wed'), 'Founders Day', 'company');
insert into public.hr_holidays (holiday_date, name, type) values (pg_temp.d('wed3'), 'Optional Festival', 'optional');
insert into public.hr_leave_types (code, name, annual_entitlement, allow_half_day) values ('WFH', 'Remote Day Off', 5, false);
select pg_temp.su('emp1');
select test.eq(test.count_rows('select 1 from public.hr_holidays'), 2::bigint, 'employees can read holidays');
select test.throws($q$insert into public.hr_holidays (holiday_date, name) values (current_date, 'Self-declared')$q$, 'employee cannot add holidays', 'row-level security');
select test.throws($q$insert into public.hr_leave_types (code, name) values ('FREE', 'Free leave')$q$, 'employee cannot create leave types', 'row-level security');

-- ---- day calculation
select test.eq(public.hr_leave_calculate_days(pg_temp.lt('CL'), pg_temp.d('mon'), pg_temp.d('fri')), 4.0::numeric, 'Mon-Fri with a holiday = 4 days');
select test.eq(public.hr_leave_calculate_days(pg_temp.lt('CL'), pg_temp.d('mon'), pg_temp.d('fri'), true, false), 3.5::numeric, 'starting with a half day = 3.5');
select test.eq(public.hr_leave_calculate_days(pg_temp.lt('CL'), pg_temp.d('fri'), pg_temp.d('mon2')), 2.0::numeric, 'weekend excluded across Fri-Mon');
select test.eq(public.hr_leave_calculate_days(pg_temp.lt('CL'), pg_temp.d('sat'), pg_temp.d('sun')), 0.0::numeric, 'weekend only = 0 days');
select test.eq(public.hr_leave_calculate_days(pg_temp.lt('CL'), pg_temp.d('wed3'), pg_temp.d('wed3')), 1.0::numeric, 'optional holiday still counts as a leave day');
select test.eq(public.hr_leave_calculate_days(pg_temp.lt('CL'), pg_temp.d('tue'), pg_temp.d('tue'), false, true), 0.5::numeric, 'single half day = 0.5');
select test.throws(format('select public.hr_leave_calculate_days(%L, %L, %L, true, false)', pg_temp.lt('WFH'), pg_temp.d('mon'), pg_temp.d('mon')),
  'half day rejected when type disallows it', 'half day');

-- ---- apply
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L)', pg_temp.lt('CL'), pg_temp.d('fri'), pg_temp.d('mon'), 'Family trip'),
  'end before start rejected', 'on or after');
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L)', pg_temp.lt('CL'), pg_temp.d('sat'), pg_temp.d('sun'), 'Weekend'),
  'weekend-only request rejected', 'no working days');
insert into t_ids select 'l1', (public.hr_apply_leave(pg_temp.lt('CL'), pg_temp.d('mon'), pg_temp.d('fri'), 'Family trip') ->> 'id')::uuid;
select test.ok((select status = 'pending_approval' and current_level = 'manager' and days = 4 from public.hr_leave_requests where id = pg_temp.id('l1')),
  'request pending at manager level with 4 days');
select test.eq(pg_temp.bal('emp1', 'CL', 'pending'), 4.00::numeric, 'pending reserved on balance');
select test.eq(pg_temp.bal('emp1', 'CL', 'available'), 8.00::numeric, 'available reduced by pending');
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L)', pg_temp.lt('SL'), pg_temp.d('tue'), pg_temp.d('tue'), 'Fever'),
  'overlapping request rejected', 'overlap');
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L)', pg_temp.lt('CL'), pg_temp.d('mon2'), pg_temp.d('mon2') + 10, 'Long trip'),
  'request beyond available balance rejected', 'Insufficient');
select test.eq(pg_temp.bal('emp1', 'CL', 'pending'), 4.00::numeric, 'failed request reserved nothing');
select test.throws(format('select public.hr_decide_leave(%L, true)', pg_temp.id('l1')), 'self-approval rejected', 'own leave');
select test.throws($q$insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason)
                      values (hr_private.current_employee_id(), (select id from public.hr_leave_types where code='CL'), current_date, current_date, 1, extract(year from current_date), 'direct')$q$,
  'direct request insert blocked', 'permission denied');
select test.throws($q$update public.hr_leave_balances set used = 0$q$, 'direct balance update blocked', 'permission denied');

-- ---- RLS
select test.eq(test.count_rows('select 1 from public.hr_leave_requests'), 1::bigint, 'employee sees own requests');
select pg_temp.su('mgr2');
select test.eq(test.count_rows('select 1 from public.hr_leave_requests'), 0::bigint, 'unrelated manager sees no requests');
select test.throws(format('select public.hr_decide_leave(%L, true)', pg_temp.id('l1')), 'manager cannot approve non-team leave', 'not allowed');
select pg_temp.su('mgr');
select test.eq(test.count_rows('select 1 from public.hr_leave_requests'), 1::bigint, 'manager sees team request');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('mgr')) and type = 'leave.requested'),
  'manager notified of new request');

-- ---- level-aware approval: manager then HR
select pg_temp.su('mgr');
select public.hr_request_leave_clarification(pg_temp.id('l1'), 'Is the release covered?');
select pg_temp.su('emp1');
select public.hr_respond_leave_clarification(pg_temp.id('l1'), 'Yes, Eden covers it.');
select pg_temp.su('mgr');
select test.ok((select status = 'pending_approval' and current_level = 'hr' from jsonb_populate_record(null::public.hr_leave_requests, public.hr_decide_leave(pg_temp.id('l1'), true, 'OK from me')) x),
  'manager approval moves request to HR level');
select test.throws(format('select public.hr_decide_leave(%L, true)', pg_temp.id('l1')), 'manager cannot approve twice / at HR level', 'not allowed');
select test.eq(pg_temp.bal('emp1', 'CL', 'used'), 0.00::numeric, 'nothing used before final approval');
select pg_temp.su('hr');
select test.eq(public.hr_decide_leave(pg_temp.id('l1'), true, 'Approved') ->> 'status', 'approved', 'HR final approval');
select test.throws(format('select public.hr_decide_leave(%L, true)', pg_temp.id('l1')), 'duplicate approval rejected', 'already been approved');
select test.ok(pg_temp.bal('emp1', 'CL', 'used') = 4 and pg_temp.bal('emp1', 'CL', 'pending') = 0, 'final approval moves pending to used');
select test.eq(test.count_rows(format('select 1 from public.hr_leave_request_events where request_id = %L', pg_temp.id('l1'))), 5::bigint,
  'every transition recorded (applied, clarification x2, manager_approved, approved)');
select test.ok(hr_private.is_on_approved_leave(pg_temp.id('emp1'), pg_temp.d('tue')), 'approved leave visible to other modules');

-- ---- team calendar
select pg_temp.su('emp3');
select test.eq(test.count_rows(format('select 1 from public.hr_leave_calendar(%L, %L)', pg_temp.d('mon'), pg_temp.d('mon4'))), 1::bigint,
  'peer sees teammate''s approved leave on calendar');
select pg_temp.su('emp2');
select test.eq(test.count_rows(format('select 1 from public.hr_leave_calendar(%L, %L)', pg_temp.d('mon'), pg_temp.d('mon4'))), 0::bigint,
  'unrelated employee does not see it');

-- ---- reject releases pending
select pg_temp.su('emp1');
insert into t_ids select 'l2', (public.hr_apply_leave(pg_temp.lt('CL'), pg_temp.d('mon3'), pg_temp.d('tue3'), 'Personal work') ->> 'id')::uuid;
select test.eq(pg_temp.bal('emp1', 'CL', 'pending'), 2.00::numeric, 'second request reserves 2 days');
select pg_temp.su('mgr');
select test.throws(format('select public.hr_decide_leave(%L, false)', pg_temp.id('l2')), 'rejection needs a reason', 'reason');
select test.eq(public.hr_decide_leave(pg_temp.id('l2'), false, 'Release week') ->> 'status', 'rejected', 'manager rejects');
select test.eq(pg_temp.bal('emp1', 'CL', 'pending'), 0.00::numeric, 'rejection releases pending');

-- ---- HR-level flow for employee without manager; document rule; cancel pending
select pg_temp.su('emp2');
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L)', pg_temp.lt('SL'), pg_temp.d('mon'), pg_temp.d('fri'), 'Surgery'),
  'long sick leave without document rejected', 'document is required');
insert into t_ids select 'l3', (public.hr_apply_leave(pg_temp.lt('SL'), pg_temp.d('mon'), pg_temp.d('fri'), 'Surgery', false, false,
  'employee-docs/medical-note.pdf') ->> 'id')::uuid;
select test.eq((select current_level from public.hr_leave_requests where id = pg_temp.id('l3')), 'hr', 'no manager: request goes straight to HR');
select public.hr_cancel_leave(pg_temp.id('l3'));
select test.ok(pg_temp.bal('emp2', 'SL', 'pending') = 0 and (select status = 'cancelled' from public.hr_leave_requests where id = pg_temp.id('l3')),
  'own pending cancelled and pending released');
select test.throws(format('select public.hr_cancel_leave(%L)', pg_temp.id('l3')), 'cannot cancel twice', 'already cancelled');

-- ---- negative balance only where the type allows it
insert into t_ids select 'l4', (public.hr_apply_leave(pg_temp.lt('LOP'), pg_temp.d('mon2'), pg_temp.d('fri2'), 'Extended personal leave') ->> 'id')::uuid;
select test.eq(pg_temp.bal('emp2', 'LOP', 'available'), -5.00::numeric, 'LOP (allow_negative) may go below zero');
select test.ok((select bool_and(available >= 0) from public.hr_leave_balances b join public.hr_leave_types t on t.id = b.leave_type_id where not t.allow_negative),
  'balances of non-negative types never below zero');

-- ---- probation restriction
select pg_temp.su('emp3');
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L)', pg_temp.lt('EL'), pg_temp.d('mon4'), pg_temp.d('mon4'), 'Trip'),
  'EL not allowed during probation', 'probation');

-- ---- cancel approved future leave restores used; started leave needs HR
select pg_temp.su('emp1');
select public.hr_cancel_leave(pg_temp.id('l1'), 'Plans changed');
select test.ok(pg_temp.bal('emp1', 'CL', 'used') = 0 and pg_temp.bal('emp1', 'CL', 'available') = 12, 'cancelling approved future leave restores balance');
select test.as_owner();
insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status)
values (pg_temp.id('emp1'), pg_temp.lt('SL'), hr_private.business_today() - 1, hr_private.business_today() - 1, 1,
        extract(year from hr_private.business_today() - 1)::int, 'Was unwell', 'approved');
insert into t_ids select 'l5', id from public.hr_leave_requests where reason = 'Was unwell';
select pg_temp.su('emp1');
select test.throws(format('select public.hr_cancel_leave(%L)', pg_temp.id('l5')), 'employee cannot cancel started leave', 'only be cancelled by HR');

-- ---- adjustments
select test.throws(format('select public.hr_adjust_leave_balance(%L, %L, 2030, 5, %L)', pg_temp.id('emp1'), pg_temp.lt('CL'), 'gift'),
  'employee cannot adjust balances', 'not allowed');
select pg_temp.su('hr');
select test.throws(format('select public.hr_adjust_leave_balance(%L, %L, 2030, 5, %L)', pg_temp.id('hr'), pg_temp.lt('CL'), 'self'),
  'HR cannot adjust own balance', 'own leave balance');
select public.hr_adjust_leave_balance(pg_temp.id('emp1'), pg_temp.lt('CL'), extract(year from pg_temp.d('mon'))::int, 1.5, 'Compensatory off for release');
select test.eq(pg_temp.bal('emp1', 'CL', 'available'), 13.50::numeric, 'adjustment credited');
select test.throws(format('select public.hr_adjust_leave_balance(%L, %L, %s, -100, %L)', pg_temp.id('emp1'), pg_temp.lt('CL'), extract(year from pg_temp.d('mon'))::int, 'oops'),
  'adjustment cannot make balance negative', 'negative');
select test.eq((select count(*) from public.hr_leave_balance_adjustments where employee_id = pg_temp.id('emp1') and kind = 'manual'), 1::bigint,
  'adjustment trail recorded');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_leave_balances' and action = 'UPDATE'), 'balance changes audited');

-- ---- year initialisation + carry forward (current year -> next year)
select pg_temp.su('mgr');
select test.throws(format('select public.hr_initialize_leave_year(%s)', extract(year from hr_private.business_today())::int), 'manager cannot initialise leave year', 'not allowed');
select pg_temp.su('hr');
select test.ok(public.hr_initialize_leave_year(extract(year from hr_private.business_today())::int) > 0, 'current year initialised');
select public.hr_adjust_leave_balance(pg_temp.id('emp2'), pg_temp.lt('EL'), extract(year from hr_private.business_today())::int, 40, 'Migrated balance from legacy system');
select test.ok(public.hr_initialize_leave_year(extract(year from pg_temp.d('mon'))::int) > 0, 'next year initialised');
select test.eq(public.hr_initialize_leave_year(extract(year from pg_temp.d('mon'))::int), 0, 'initialisation is idempotent');
select test.eq(pg_temp.bal('emp2', 'EL', 'carried_forward'), 30.00::numeric, 'carry-forward capped at carry_forward_max');
select test.eq(pg_temp.bal('emp2', 'CL', 'carried_forward'), 0.00::numeric, 'no carry-forward for CL');
select test.throws('select public.hr_initialize_leave_year(1999)', 'out-of-range year rejected', 'previous, current or next');

-- ---- my balances
select pg_temp.su('emp1');
select test.eq((select available from public.hr_my_leave_balances(extract(year from pg_temp.d('mon'))::int) where code = 'CL'), 13.50::numeric,
  'employee balance summary');
select test.as_owner();

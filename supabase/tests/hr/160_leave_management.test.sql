-- Module 6 Leave Management (migration 160): maker-checker leave policies with
-- versions, eligibility / notice / min-max rules, quarterly accrual, balance
-- ledger with idempotent request entries, per-day breakdown, holiday-change
-- review + recalculation, LOP stability, opening balance, carry-forward
-- expiry, year-end close, company-scoped holidays, masked team calendar,
-- overview / attendance / payroll read RPCs, supporting documents, RLS.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

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
create or replace function pg_temp.bal(p_emp text, p_code text, p_col text, p_year int default null) returns numeric language plpgsql as $$
declare v numeric;
begin
  execute format('select %I from public.hr_leave_balances where employee_id = $1 and leave_type_id = $2 and year = $3', p_col)
    into v using pg_temp.id(p_emp), pg_temp.lt(p_code), coalesce(p_year, extract(year from pg_temp.d('mon'))::int);
  return v;
end $$;

do $$
declare y int := extract(year from hr_private.business_today())::int + 1; mon date; le uuid;
begin
  update public.hr_settings set value = value || '{"max_advance_days": 800}' where key = 'leave';
  insert into public.hr_legal_entities (code, name) values ('M6CO', 'M6 Synthetic Co') returning id into le;
  insert into t_ids values ('le', le);
  insert into t_ids values ('hr',   test.make_employee('m6.hr@test.local', 'Hana', null, array['hr_admin']));
  insert into t_ids values ('hr2',  test.make_employee('m6.hr2@test.local', 'Hugo', null, array['hr_admin']));
  insert into t_ids values ('mgr',  test.make_employee('m6.mgr@test.local', 'Mona', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('m6.emp1@test.local', 'Eli', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('m6.emp2@test.local', 'Esme', (select v from t_ids where k='mgr')));
  insert into t_ids values ('out',  test.make_employee('m6.out@test.local', 'Otto'));
  insert into t_ids values ('intern', test.make_employee('m6.intern@test.local', 'Ines', (select v from t_ids where k='mgr'), array['employee'], 'intern'));
  update public.hr_employees set legal_entity_id = le where id = (select v from t_ids where k='emp2');
  mon := make_date(y, 3, 2);
  mon := mon + ((8 - extract(isodow from mon)::int) % 7);       -- first Monday on/after 2 March next year
  insert into t_d values ('mon', mon), ('tue', mon + 1), ('wed', mon + 2), ('thu', mon + 3), ('fri', mon + 4),
                         ('mon2', mon + 7), ('tue2', mon + 8), ('wed2', mon + 9), ('fri2', mon + 11),
                         ('mon3', mon + 14), ('wed3', mon + 16), ('mon5', mon + 28), ('fri5', mon + 32);
end $$;

-- =====================================================================
-- 1. Policies: maker-checker, validation, versions
-- =====================================================================
select test.as_owner();
select test.eq((select value ->> 'policy_approval' from public.hr_settings where key = 'leave'), 'required', 'policy approval required by default');
select test.ok((select count(*) = 3 and bool_and(not active and annual_entitlement = 0) from public.hr_leave_types where code in ('ML','PL','CO')),
  'maternity / paternity / comp-off seeded inactive with no hardcoded entitlement');
select test.ok(not exists (select 1 from public.hr_leave_types t where not exists (select 1 from public.hr_leave_policy_versions v where v.leave_type_id = t.id)),
  'every leave type has a policy version');

select pg_temp.su('hr');
select test.throws($q$insert into public.hr_leave_types (code, name) values ('DIRECT', 'Direct insert')$q$,
  'direct leave type insert refused under maker-checker', 'second HR approver');
select test.throws(format('update public.hr_leave_types set annual_entitlement = 99 where id = %L', pg_temp.lt('CL')),
  'direct policy update refused under maker-checker', 'second HR approver');
select test.throws(format('select public.hr_propose_leave_policy(%L, %L::jsonb, %L)', pg_temp.lt('CL'), '{"bogus": 1}', 'Typo'),
  'unknown policy field rejected', 'Unknown or read-only');
select test.throws(format('select public.hr_propose_leave_policy(%L, %L::jsonb, %L)', pg_temp.lt('CL'), '{"min_days_per_request": 3, "max_days_per_request": 1}', 'Bad range'),
  'invalid policy (min > max) rejected by dry run', 'Invalid policy value');
select test.throws(format('select public.hr_propose_leave_policy(%L, %L::jsonb, %L)', pg_temp.lt('CL'), '{"eligible_employment_types": ["astronaut"]}', 'Bad type'),
  'unknown employment type rejected', 'Unknown employment type');
select test.throws(format('select public.hr_propose_leave_policy(%L, %L::jsonb, %L)', pg_temp.lt('CL'), '{"annual_entitlement": 12}', 'Same'),
  'no-op change rejected', 'Nothing would change');
select test.throws(format('select public.hr_propose_leave_policy(%L, %L::jsonb, %L, %L)', pg_temp.lt('CL'), '{"annual_entitlement": 13}', 'From next month',
  hr_private.business_today() + 30), 'future-dated policy change refused (changes apply immediately)', 'Future-dated');
insert into t_ids select 'chg_new', (public.hr_propose_leave_policy(null,
  '{"code": "fl", "name": "Focus Leave", "annual_entitlement": 8, "accrual": "quarterly", "eligible_employment_types": ["full_time"], "min_notice_days": 3, "min_days_per_request": 1, "max_days_per_request": 3, "allow_half_day": false}'::jsonb,
  'New synthetic policy') ->> 'id')::uuid;
select test.ok((select status = 'pending' and proposed ->> 'code' = 'FL' from public.hr_leave_policy_changes where id = pg_temp.id('chg_new')),
  'proposal stored as pending with normalised code');
select test.eq(pg_temp.lt('FL'), null::uuid, 'pending proposal does not change policy yet');
select test.throws(format('select public.hr_decide_leave_policy(%L, true)', pg_temp.id('chg_new')), 'proposer cannot approve own policy change', 'own policy change');
select pg_temp.su('emp1');
select test.throws(format('select public.hr_decide_leave_policy(%L, true)', pg_temp.id('chg_new')), 'employee cannot approve policy changes', 'not allowed');
select test.throws(format('select public.hr_propose_leave_policy(%L, %L::jsonb, %L)', pg_temp.lt('CL'), '{"annual_entitlement": 50}', 'Gift'),
  'employee cannot propose policy changes', 'not allowed');
select test.eq(test.count_rows('select 1 from public.hr_leave_policy_changes'), 0::bigint, 'employees cannot read policy proposals');
select test.throws(format('select hr_leave_internal.leave_policy_write(%L, %L::jsonb)', pg_temp.lt('CL'), '{"annual_entitlement": 99}'),
  'internal policy writer not callable by signed-in users', 'permission denied');
select test.throws(format('select hr_leave_internal.decide_leave_core(%L, true, null)', gen_random_uuid()),
  'moved 103 core (bypasses wrapper checks) not callable by signed-in users', 'permission denied');
select test.throws($q$select hr_leave_internal.leave_ctx_set('{"entry":"recalculation"}'::jsonb)$q$,
  'ledger context cannot be set by signed-in users', 'permission denied');
select pg_temp.su('hr2');
select test.eq(public.hr_decide_leave_policy(pg_temp.id('chg_new'), true, 'Agreed') ->> 'status', 'approved', 'second HR approver applies the change');
select test.ok((select accrual = 'quarterly' and policy_version = 1 and eligible_employment_types = array['full_time'] from public.hr_leave_types where code = 'FL'),
  'new leave type created from the approved proposal');
select test.ok(exists (select 1 from public.hr_leave_policy_versions v where v.leave_type_id = pg_temp.lt('FL') and v.change_id = pg_temp.id('chg_new')),
  'policy version linked to the approved change');
select test.throws(format('select public.hr_decide_leave_policy(%L, true)', pg_temp.id('chg_new')), 'cannot approve twice', 'already approved');

-- update + stale detection + rejection
insert into t_ids select 'chg_upd', (public.hr_propose_leave_policy(pg_temp.lt('FL'), '{"annual_entitlement": 10}'::jsonb, 'Raise focus leave', current_date) ->> 'id')::uuid;
select test.throws(format('select public.hr_propose_leave_policy(%L, %L::jsonb, %L)', pg_temp.lt('FL'), '{"annual_entitlement": 11}', 'Again'),
  'only one pending change per leave type', 'already a pending change');
select pg_temp.su('hr');
select test.throws(format('select public.hr_decide_leave_policy(%L, false)', pg_temp.id('chg_upd')), 'rejection needs a reason', 'reason');
select test.eq(public.hr_decide_leave_policy(pg_temp.id('chg_upd'), false, 'Budget not approved') ->> 'status', 'rejected', 'policy change rejected');
select test.eq((select annual_entitlement from public.hr_leave_types where code = 'FL'), 8.0::numeric, 'rejected change not applied');
insert into t_ids select 'chg_upd2', (public.hr_propose_leave_policy(pg_temp.lt('FL'), '{"annual_entitlement": 10}'::jsonb, 'Second try') ->> 'id')::uuid;
select test.as_owner();
update public.hr_leave_types set sort_order = 42 where code = 'FL';   -- concurrent (system) change bumps the version
select pg_temp.su('hr2');
select test.throws(format('select public.hr_decide_leave_policy(%L, true)', pg_temp.id('chg_upd2')), 'stale proposal refused', 'changed since');
select test.as_owner();
update public.hr_leave_policy_changes set status = 'withdrawn' where id = pg_temp.id('chg_upd2');
select test.ok((select max(version) = 2 from public.hr_leave_policy_versions where leave_type_id = pg_temp.lt('FL')), 'every applied change adds a version');

-- =====================================================================
-- 2. Request rules: eligibility, notice, min/max, half-day, closed types
-- =====================================================================
select pg_temp.su('intern');
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L)', pg_temp.lt('FL'), pg_temp.d('mon'), pg_temp.d('mon'), 'Focus'),
  'employment type not eligible', 'employment type');
select test.ok((select (x ->> 'eligibility_issue') is not null from jsonb_array_elements(public.hr_my_leave_types()) x where x ->> 'code' = 'FL'),
  'my leave types explains the eligibility issue');
select test.ok(not exists (select 1 from public.hr_my_leave_balances(extract(year from pg_temp.d('mon'))::int) where code = 'FL'),
  'no balance created for an ineligible type');
select pg_temp.su('emp1');
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L)', pg_temp.lt('FL'), hr_private.business_today() + 1, hr_private.business_today() + 1, 'Soon'),
  'advance notice enforced', 'in advance');
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L)', pg_temp.lt('FL'), pg_temp.d('mon'), pg_temp.d('thu'), 'Long focus'),
  'maximum days per request enforced', 'at most 3');
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L, true, false)', pg_temp.lt('FL'), pg_temp.d('mon'), pg_temp.d('mon'), 'Half'),
  'half day refused when policy disallows it', 'half day');
select test.eq(hr_private.leave_accrued(pg_temp.lt('FL'), pg_temp.id('emp1'), extract(year from pg_temp.d('mon'))::int, pg_temp.d('mon')), 2.00::numeric,
  'quarterly accrual: one quarter credited by March');
select test.eq(hr_private.leave_accrued(pg_temp.lt('FL'), pg_temp.id('emp1'), extract(year from pg_temp.d('mon'))::int, make_date(extract(year from pg_temp.d('mon'))::int, 12, 31)),
  8.00::numeric, 'quarterly accrual: full entitlement by December');

-- =====================================================================
-- 3. Ledger + per-day breakdown through apply / approve / reject / cancel
-- =====================================================================
insert into t_ids select 'r1', (public.hr_apply_leave(pg_temp.lt('CL'), pg_temp.d('mon'), pg_temp.d('wed'), 'Family visit', false, true) ->> 'id')::uuid;
select test.eq((select days from public.hr_leave_requests where id = pg_temp.id('r1')), 2.5::numeric, 'Mon-Wed ending first half = 2.5 days');
select test.ok((select policy_version is not null from public.hr_leave_requests where id = pg_temp.id('r1')), 'request records the policy version');
select test.eq((select sum(portion) from public.hr_leave_request_days where request_id = pg_temp.id('r1')), 2.5::numeric, 'per-day breakdown sums to the request days');
select test.eq((select half from public.hr_leave_request_days where request_id = pg_temp.id('r1') and leave_date = pg_temp.d('wed')), 'first', 'last day stored as first half');
select test.ok(exists (select 1 from public.hr_leave_ledger where request_id = pg_temp.id('r1') and entry_type = 'reserve' and bucket = 'pending' and amount = 2.5),
  'reservation ledgered and linked to the request');
select test.throws($q$insert into public.hr_leave_ledger (balance_id, employee_id, leave_type_id, year, bucket, entry_type, amount, effect)
                      select id, employee_id, leave_type_id, year, 'used', 'consume', 1, -1 from public.hr_leave_balances limit 1$q$,
  'ledger cannot be written directly', 'permission denied');
select test.throws(format('select public.hr_decide_leave(%L, true)', pg_temp.id('r1')), 'self-approval still refused', 'own leave');
select pg_temp.su('mgr');
select public.hr_decide_leave(pg_temp.id('r1'), true, 'Fine');                 -- manager level -> HR
select pg_temp.su('hr');
select test.eq(public.hr_decide_leave(pg_temp.id('r1'), true) ->> 'status', 'approved', 'HR final approval');
select test.throws(format('select public.hr_decide_leave(%L, true)', pg_temp.id('r1')), 'repeated approval refused', 'already been approved');
select test.ok(pg_temp.bal('emp1', 'CL', 'used') = 2.5 and pg_temp.bal('emp1', 'CL', 'pending') = 0, 'balance consumed exactly once');
select test.eq((select count(*) from public.hr_leave_ledger where request_id = pg_temp.id('r1') and entry_type = 'consume'), 2::bigint,
  'consume ledgered once (pending -> used)');
select test.as_owner();
select test.throws(format($q$insert into public.hr_leave_ledger (balance_id, employee_id, leave_type_id, year, bucket, entry_type, amount, effect, request_id)
                             select balance_id, employee_id, leave_type_id, year, bucket, entry_type, amount, effect, request_id
                             from public.hr_leave_ledger where request_id = %L and entry_type = 'consume' limit 1$q$, pg_temp.id('r1')),
  'a second consume for the same request is impossible (no double deduction)', 'duplicate key');
select test.throws(format('update public.hr_leave_requests set status = %L where id = %L', 'pending_approval', pg_temp.id('r1')),
  'approved request cannot move back to pending', 'already approved');
select test.throws(format('update public.hr_leave_requests set end_date = end_date + 1 where id = %L', pg_temp.id('r1')),
  'leave dates are immutable', 'cannot be changed');
select test.eq(hr_private.leave_portion_on(pg_temp.id('emp1'), pg_temp.d('tue')), 1.0::numeric, 'attendance sees a full leave day');
select test.eq(hr_private.leave_portion_on(pg_temp.id('emp1'), pg_temp.d('wed')), 0.5::numeric, 'attendance sees a half leave day');
select test.eq(hr_private.leave_portion_on(pg_temp.id('emp1'), pg_temp.d('thu')), 0::numeric, 'no leave the next day');

-- reject releases; cancel approved restores
select pg_temp.su('emp1');
insert into t_ids select 'r2', (public.hr_apply_leave(pg_temp.lt('CL'), pg_temp.d('mon3'), pg_temp.d('mon3'), 'Errand') ->> 'id')::uuid;
select pg_temp.su('mgr');
select public.hr_decide_leave(pg_temp.id('r2'), false, 'Release day');
select test.ok(exists (select 1 from public.hr_leave_ledger where request_id = pg_temp.id('r2') and entry_type = 'release' and amount = -1),
  'rejection releases the reservation in the ledger');
select pg_temp.su('emp1');
select public.hr_cancel_leave(pg_temp.id('r1'), 'Trip moved');
select test.ok(pg_temp.bal('emp1', 'CL', 'used') = 0 and exists (select 1 from public.hr_leave_ledger where request_id = pg_temp.id('r1') and entry_type = 'restore'),
  'cancelling approved leave restores the balance (ledgered)');
select test.as_owner();   -- hr_private helpers are internal (attendance calls them from SECURITY DEFINER code)
select test.eq(hr_private.leave_portion_on(pg_temp.id('emp1'), pg_temp.d('tue')), 0::numeric, 'cancelled leave no longer counts for attendance');
select pg_temp.su('emp1');
select test.eq((select sum(effect) from public.hr_leave_ledger l join public.hr_leave_balances b on b.id = l.balance_id
                where b.employee_id = pg_temp.id('emp1') and b.leave_type_id = pg_temp.lt('CL') and b.year = extract(year from pg_temp.d('mon'))::int),
  pg_temp.bal('emp1', 'CL', 'available'), 'ledger effects reconcile to the available balance');
select test.eq(test.count_rows(format('select 1 from public.hr_leave_ledger where employee_id = %L', pg_temp.id('emp2'))), 0::bigint,
  'employee cannot read another employee''s ledger');

-- =====================================================================
-- 4. Holiday changes: flag, block approval, recalculate; LOP stable
-- =====================================================================
select pg_temp.su('emp2');
insert into t_ids select 'r3', (public.hr_apply_leave(pg_temp.lt('CL'), pg_temp.d('mon2'), pg_temp.d('fri2'), 'Vacation') ->> 'id')::uuid;
insert into t_ids select 'r4', (public.hr_apply_leave(pg_temp.lt('LOP'), pg_temp.d('mon5'), pg_temp.d('fri5'), 'Unpaid break') ->> 'id')::uuid;
select pg_temp.su('hr');
select public.hr_decide_leave(pg_temp.id('r4'), true, 'ok');
select test.eq(hr_private.payroll_lop_days(pg_temp.id('emp2'), pg_temp.d('mon5'), pg_temp.d('fri5'), false), 5::numeric, 'LOP = 5 unpaid days');
insert into public.hr_holidays (holiday_date, name, type) values (pg_temp.d('wed2'), 'Synthetic Mid-week Holiday', 'company');
insert into public.hr_holidays (holiday_date, name, type, legal_entity_id) values (pg_temp.d('wed'), 'M6 Co Day', 'company', pg_temp.id('le'));
insert into public.hr_holidays (holiday_date, name, type) values (pg_temp.d('mon5') + 2, 'Late Holiday', 'company');
select test.ok((select holiday_review_required and days = 5 from public.hr_leave_requests where id = pg_temp.id('r3')),
  'pending request flagged for review, days unchanged');
select test.ok((select holiday_review_required and days = 5 from public.hr_leave_requests where id = pg_temp.id('r4')),
  'approved request flagged for review, days unchanged');
select test.eq(hr_private.payroll_lop_days(pg_temp.id('emp2'), pg_temp.d('mon5'), pg_temp.d('fri5'), false), 5::numeric,
  'LOP of approved leave not silently changed by a later holiday');
select test.ok(exists (select 1 from public.hr_leave_request_events where request_id = pg_temp.id('r3') and action = 'holiday_changed'),
  'holiday change recorded in request history');
select test.ok(hr_private.is_holiday(pg_temp.d('wed'), pg_temp.id('emp2')) and not hr_private.is_holiday(pg_temp.d('wed'), pg_temp.id('emp1')),
  'company-specific holiday applies only to that company');
select pg_temp.su('mgr');
select test.throws(format('select public.hr_decide_leave(%L, true)', pg_temp.id('r3')), 'flagged request cannot be approved before recalculation', 'Recalculate');
select test.eq(public.hr_recalculate_leave_request(pg_temp.id('r3'), 'Holiday added') ->> 'days', '4.0', 'manager (approver) recalculates pending request');
select test.ok(pg_temp.bal('emp2', 'CL', 'pending') = 4 and exists (select 1 from public.hr_leave_ledger where request_id = pg_temp.id('r3') and entry_type = 'recalculation'),
  'recalculation adjusts the reservation through the ledger');
select test.throws(format('select public.hr_recalculate_leave_request(%L)', pg_temp.id('r4')), 'manager cannot recalculate approved leave', 'not allowed');
select pg_temp.su('hr');
select public.hr_recalculate_leave_request(pg_temp.id('r4'), 'Holiday added');
select test.ok(hr_private.payroll_lop_days(pg_temp.id('emp2'), pg_temp.d('mon5'), pg_temp.d('fri5'), false) = 4
               and pg_temp.bal('emp2', 'LOP', 'used') = 4, 'explicit recalculation updates LOP and used together');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp2')) and type = 'leave.recalculated'),
  'employee notified of recalculation');

-- =====================================================================
-- 5. Calendar privacy, overview, attendance / payroll summaries
-- =====================================================================
select pg_temp.su('emp1');
select test.ok((select bool_and(visibility = 'limited' and leave_type_name = 'On leave') from public.hr_leave_calendar(pg_temp.d('mon'), pg_temp.d('fri5'))
                where employee_id = pg_temp.id('emp2')), 'teammate sees colleague''s approved leave without the leave type');
select test.eq(test.count_rows(format('select 1 from public.hr_leave_calendar(%L, %L) where employee_id = %L and status = %L',
  pg_temp.d('mon'), pg_temp.d('fri5'), pg_temp.id('emp2'), 'pending_approval')), 0::bigint, 'teammates do not see pending leave');
select test.throws('select public.hr_leave_overview()', 'employee without leave permissions cannot open the overview', 'do not have access');
select test.throws(format('select * from public.hr_leave_payroll_summary(%L, %L)', pg_temp.d('mon'), pg_temp.d('fri5')), 'employee cannot read payroll leave summary', 'not allowed');
select test.eq(test.count_rows(format('select 1 from public.hr_leave_attendance_days(%L, %L, %L)', pg_temp.d('mon5'), pg_temp.d('fri5'), pg_temp.id('emp2'))), 0::bigint,
  'employee cannot read another employee''s attendance leave days');
select pg_temp.su('out');
select test.eq(test.count_rows(format('select 1 from public.hr_leave_calendar(%L, %L)', pg_temp.d('mon'), pg_temp.d('fri5'))), 0::bigint,
  'unrelated employee sees nothing on the calendar');
select pg_temp.su('mgr');
select test.ok((select bool_and(visibility = 'full') from public.hr_leave_calendar(pg_temp.d('mon'), pg_temp.d('fri5'))), 'manager sees team leave in full');
select test.eq((public.hr_leave_overview(pg_temp.d('mon'), pg_temp.d('fri5')) ->> 'awaiting_my_approval')::int, 1, 'manager overview: one request awaiting me');
select test.eq(test.count_rows(format('select 1 from public.hr_leave_calendar(%L, %L, null, null, %L)', pg_temp.d('mon'), pg_temp.d('fri5'), pg_temp.id('le'))), 2::bigint,
  'calendar company filter');
select pg_temp.su('hr');
select test.ok((public.hr_leave_overview(pg_temp.d('mon5'), pg_temp.d('fri5')) -> 'approved_in_period' ->> 'days')::numeric = 4, 'HR overview: approved days in period');
select test.eq((select unpaid_leave_days from public.hr_leave_payroll_summary(pg_temp.d('mon5'), pg_temp.d('fri5')) where employee_id = pg_temp.id('emp2')),
  4::numeric, 'payroll summary reports unpaid days');
select test.eq(test.count_rows(format('select 1 from public.hr_leave_attendance_days(%L, %L, %L)', pg_temp.d('mon5'), pg_temp.d('fri5'), pg_temp.id('emp2'))), 4::bigint,
  'HR reads per-day leave for attendance');
select test.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_leave_calendar'),
  'calendar is an RPC (no table exposing reasons)');
select pg_temp.su('emp2');
select test.eq((select count(*) from public.hr_my_holidays(pg_temp.d('mon'), pg_temp.d('fri5')) where name = 'M6 Co Day'), 1::bigint, 'company holiday listed for its company');
select pg_temp.su('emp1');
select test.eq((select count(*) from public.hr_my_holidays(pg_temp.d('mon'), pg_temp.d('fri5')) where name = 'M6 Co Day'), 0::bigint, 'company holiday hidden for other companies');

-- =====================================================================
-- 6. Supporting documents
-- =====================================================================
select test.as_owner();
insert into public.hr_documents (employee_id, category_id, title)
values (pg_temp.id('emp2'), (select id from public.hr_document_categories where code = 'leave_supporting'), 'Synthetic medical note'),
       (pg_temp.id('emp2'), (select id from public.hr_document_categories where code = 'other'), 'Synthetic other doc');
insert into t_ids select 'doc2', id from public.hr_documents where title = 'Synthetic medical note';
select pg_temp.su('mgr');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where title = 'Synthetic other doc'$q$), 1::bigint, 'manager sees ordinary team documents');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where title = 'Synthetic medical note'$q$), 0::bigint,
  'manager cannot open a team member''s leave supporting document');
select pg_temp.su('hr');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where title = 'Synthetic medical note'$q$), 1::bigint, 'HR can open the leave supporting document');
select pg_temp.su('emp1');
select test.throws(format('select public.hr_apply_leave(%L, %L, %L, %L, false, false, null, %L)', pg_temp.lt('SL'), pg_temp.d('mon3'), pg_temp.d('wed3'), 'Unwell', pg_temp.id('doc2')),
  'cannot attach another employee''s document', 'document not found');
select pg_temp.su('emp2');
insert into t_ids select 'r5', (public.hr_apply_leave(pg_temp.lt('SL'), pg_temp.d('mon3'), pg_temp.d('wed3'), 'Unwell', false, false, null, pg_temp.id('doc2')) ->> 'id')::uuid;
select test.ok((select document_id = pg_temp.id('doc2') and document_path is not null from public.hr_leave_requests where id = pg_temp.id('r5')),
  'own document satisfies the document requirement and is linked');

-- =====================================================================
-- 7. Opening balance, expiry, year-end close
-- =====================================================================
select pg_temp.su('emp1');
select test.throws(format('select public.hr_set_opening_leave_balance(%L, %L, %s, 5, %L)', pg_temp.id('emp2'), pg_temp.lt('EL'), extract(year from pg_temp.d('mon'))::int, 'x'),
  'employee cannot set opening balances', 'not allowed');
select pg_temp.su('hr');
select public.hr_set_opening_leave_balance(pg_temp.id('emp1'), pg_temp.lt('EL'), extract(year from pg_temp.d('mon'))::int, 6, 'Migrated from legacy HR system');
select test.ok(pg_temp.bal('emp1', 'EL', 'opening') = 6 and pg_temp.bal('emp1', 'EL', 'adjusted') = 6, 'opening balance recorded and credited');
select public.hr_set_opening_leave_balance(pg_temp.id('emp1'), pg_temp.lt('EL'), extract(year from pg_temp.d('mon'))::int, 4, 'Corrected legacy figure');
select test.eq(pg_temp.bal('emp1', 'EL', 'adjusted'), 4.00::numeric, 'opening correction applies only the difference');
select test.eq((select count(*) from public.hr_leave_balance_adjustments where employee_id = pg_temp.id('emp1') and kind = 'opening'), 2::bigint,
  'both opening entries kept in history');

-- expiry: a current-year balance with carried-forward days that expired yesterday
select test.as_owner();
update public.hr_leave_types set carry_forward_expiry_months = 3 where code = 'EL';
insert into public.hr_leave_balances (employee_id, leave_type_id, year, entitled, accrued, carried_forward, cf_expires_on)
values (pg_temp.id('emp2'), pg_temp.lt('EL'), extract(year from hr_private.business_today())::int, 15, 5, 7, hr_private.business_today() - 1);
select pg_temp.su('hr');
select test.eq((public.hr_process_leave_expiry() ->> 'days')::numeric, 7::numeric, 'unused carried-forward days expire');
select test.ok(pg_temp.bal('emp2', 'EL', 'cf_expired', extract(year from hr_private.business_today())::int) = 7
               and pg_temp.bal('emp2', 'EL', 'available', extract(year from hr_private.business_today())::int) = 5, 'expiry deducted from available');
select test.eq((public.hr_process_leave_expiry() ->> 'days')::numeric, 0::numeric, 'expiry runs only once');

-- year-end close of last year
select test.as_owner();
insert into public.hr_leave_balances (employee_id, leave_type_id, year, entitled, accrued, used)
values (pg_temp.id('emp1'), pg_temp.lt('EL'), extract(year from hr_private.business_today())::int - 1, 15, 10, 2);
delete from public.hr_leave_balances where employee_id = pg_temp.id('emp1') and leave_type_id = pg_temp.lt('EL') and year = extract(year from hr_private.business_today())::int;
-- 'out' already has this year's balance, created before last year was final (carried_forward 0): year-end must true it up.
insert into public.hr_leave_balances (employee_id, leave_type_id, year, entitled, accrued, used)
values (pg_temp.id('out'), pg_temp.lt('EL'), extract(year from hr_private.business_today())::int - 1, 15, 6, 0),
       (pg_temp.id('out'), pg_temp.lt('EL'), extract(year from hr_private.business_today())::int, 15, 1, 0);
select pg_temp.su('mgr');
select test.throws(format('select public.hr_close_leave_year(%s)', extract(year from hr_private.business_today())::int - 1), 'manager cannot close a leave year', 'not allowed');
select pg_temp.su('hr');
select test.throws(format('select public.hr_close_leave_year(%s)', extract(year from hr_private.business_today())::int + 1), 'future year cannot be closed', 'finished leave year');
select test.ok((public.hr_close_leave_year(extract(year from hr_private.business_today())::int - 1) ->> 'balances')::int >= 1, 'last year closed');
select test.eq(pg_temp.bal('emp1', 'EL', 'carried_forward', extract(year from hr_private.business_today())::int), 8.00::numeric,
  'year-end carries the final balance forward (10 accrued, never reduced, - 2 used)');
select test.ok(pg_temp.bal('out', 'EL', 'carried_forward', extract(year from hr_private.business_today())::int) = 6
               and exists (select 1 from public.hr_leave_balance_adjustments where employee_id = pg_temp.id('out') and reason like 'Year-end true-up%'),
  'existing next-year balance trued up to the final carry-forward, with an adjustment record');
select test.throws(format('select public.hr_adjust_leave_balance(%L, %L, %s, 1, %L)', pg_temp.id('emp1'), pg_temp.lt('EL'), extract(year from hr_private.business_today())::int - 1, 'late fix'),
  'closed year balances are frozen', 'closed');
select test.throws(format('select public.hr_close_leave_year(%s)', extract(year from hr_private.business_today())::int - 1), 'year cannot be closed twice', 'already closed');
select test.ok(exists (select 1 from public.hr_leave_ledger where employee_id = pg_temp.id('emp1') and entry_type = 'year_end'), 'year-end changes ledgered');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where action = 'LEAVE_YEAR_CLOSED'), 'year close audited');

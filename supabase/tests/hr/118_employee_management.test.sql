-- Employee Management (118): reasoned/effective-dated changes, history
-- immutability, assignment validation, reporting rules, timeline access,
-- summary scoping, employee ID guarantees.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;

do $$
declare d_eng uuid; d_des uuid; d_old uuid;
begin
  insert into public.hr_departments (code, name) values ('EMT-ENG', 'EM Engineering') returning id into d_eng;
  insert into public.hr_departments (code, name) values ('EMT-DES', 'EM Design') returning id into d_des;
  insert into public.hr_departments (code, name, active) values ('EMT-OLD', 'EM Retired Unit', false) returning id into d_old;
  insert into t_ids values ('d_eng', d_eng), ('d_des', d_des), ('d_old', d_old);
  with x as (insert into public.hr_designations (name, department_id) values ('EM Software Engineer', d_eng) returning id) insert into t_ids select 'g_se', id from x;
  with x as (insert into public.hr_designations (name, department_id) values ('EM Senior Software Engineer', d_eng) returning id) insert into t_ids select 'g_sse', id from x;
  with x as (insert into public.hr_designations (name, department_id) values ('EM UI Designer', d_des) returning id) insert into t_ids select 'g_ui', id from x;
  with x as (insert into public.hr_designations (name) values ('EM Consultant') returning id) insert into t_ids select 'g_any', id from x;
  with x as (insert into public.hr_designations (name, active) values ('EM Legacy Title', false) returning id) insert into t_ids select 'g_off', id from x;

  insert into t_ids values ('hr',   test.make_employee('em7.hr@test.local',   'Hari',  null, array['hr_admin','employee']));
  insert into t_ids values ('hr2',  test.make_employee('em7.hr2@test.local',  'Hamsa', null, array['hr_admin','employee']));
  insert into t_ids values ('mgr',  test.make_employee('em7.mgr@test.local',  'Mira',  null, array['manager','employee'], 'full_time', d_eng));
  insert into t_ids values ('mgr2', test.make_employee('em7.mgr2@test.local', 'Mohan', null, array['manager','employee'], 'full_time', d_des));
  insert into t_ids values ('emp',  test.make_employee('em7.emp@test.local',  'Esha',  (select v from t_ids where k='mgr'), array['employee'], 'full_time', d_eng));
  insert into t_ids values ('rep2', test.make_employee('em7.rep2@test.local', 'Ravi',  (select v from t_ids where k='emp'), array['employee'], 'full_time', d_eng));
  insert into t_ids values ('oth',  test.make_employee('em7.oth@test.local',  'Omar',  (select v from t_ids where k='mgr2'), array['employee'], 'full_time', d_des));
  insert into t_ids values ('pay',  test.make_employee('em7.pay@test.local',  'Pia',   null, array['payroll_admin','employee']));
  update public.hr_employees set designation_id = (select v from t_ids where k='g_se') where id = (select v from t_ids where k='emp');
  update public.hr_employees set status = 'probation' where id = (select v from t_ids where k='rep2');
end $$;

-- ---- schema
select test.ok(exists (select 1 from information_schema.columns where table_name = 'hr_employees' and column_name = 'confirmation_date'), 'confirmation_date column added');
select test.ok(exists (select 1 from information_schema.columns where table_name = 'hr_employee_history' and column_name = 'event_id'), 'history.event_id column added');
select test.ok((select relrowsecurity from pg_class where oid = 'public.hr_employee_change_events'::regclass), 'change events table has RLS');

-- ---- employee ID: system generated, unique, immutable
select pg_temp.as_k('hr');
do $$ begin
  with x as (insert into public.hr_employees (first_name, last_name, employee_code, department_id) values ('Nila', 'New', 'HACK-1', (select v from t_ids where k='d_eng')) returning id) insert into t_ids select 'new1', id from x;
  with x as (insert into public.hr_employees (first_name, last_name, department_id) values ('Neel', 'New', (select v from t_ids where k='d_eng')) returning id) insert into t_ids select 'new2', id from x;
end $$;
select test.ok((select employee_code from public.hr_employees where id = pg_temp.id('new1')) <> 'HACK-1', 'client-supplied employee ID is ignored (generated instead)');
select test.ok((select employee_code from public.hr_employees where id = pg_temp.id('new1')) <> (select employee_code from public.hr_employees where id = pg_temp.id('new2')), 'generated employee IDs are unique');
select test.throws($q$update public.hr_employees set employee_code = 'ZT-9999' where id = pg_temp.id('new1')$q$, 'employee ID cannot be changed', 'cannot be changed');
select test.ok((select employee_code from public.hr_employees where id = pg_temp.id('new1')) ~ '^[A-Z]+-[0-9]{3,}$', 'employee ID follows the configured format');

-- ---- assignment validation (direct writes and RPC)
select test.throws($q$update public.hr_employees set designation_id = pg_temp.id('g_ui') where id = pg_temp.id('emp')$q$, 'designation of another department rejected', 'different department');
select test.throws($q$update public.hr_employees set department_id = pg_temp.id('d_old') where id = pg_temp.id('emp')$q$, 'inactive department rejected', 'inactive');
select test.throws($q$update public.hr_employees set designation_id = pg_temp.id('g_off') where id = pg_temp.id('emp')$q$, 'inactive designation rejected', 'inactive');
select test.throws($q$update public.hr_employees set department_id = pg_temp.id('d_des') where id = pg_temp.id('emp')$q$, 'department change leaving a mismatched designation rejected', 'different department');
select test.throws($q$insert into public.hr_employees (first_name, department_id, designation_id) values ('Bad', pg_temp.id('d_eng'), pg_temp.id('g_ui'))$q$, 'mismatched designation rejected on create', 'different department');
update public.hr_employees set designation_id = pg_temp.id('g_any') where id = pg_temp.id('new2');
select test.eq((select designation_id from public.hr_employees where id = pg_temp.id('new2')), pg_temp.id('g_any'), 'company-wide designation accepted for any department');

-- ---- reporting manager rules
select test.throws($q$update public.hr_employees set manager_id = id where id = pg_temp.id('emp')$q$, 'self-reporting rejected (direct write)', null);
select test.throws($q$update public.hr_employees set manager_id = pg_temp.id('rep2') where id = pg_temp.id('emp')$q$, 'circular reporting rejected (direct write)', 'cycle');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'manager_change', current_date, 'Loop test', p_manager => pg_temp.id('emp'))$q$, 'self-reporting rejected (RPC)', 'themselves');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('mgr'), 'manager_change', current_date, 'Loop test', p_manager => pg_temp.id('rep2'))$q$, 'indirect circular reporting rejected (RPC)', 'cycle');

-- ---- reasoned change: validation
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'promotion', current_date, '', p_designation => pg_temp.id('g_sse'))$q$, 'reason is required', 'reason');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'promotion', current_date + 5, 'Annual review', p_designation => pg_temp.id('g_sse'))$q$, 'future effective date rejected', 'Future-dated');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'promotion', current_date - 5000, 'Annual review', p_designation => pg_temp.id('g_sse'))$q$, 'effective date before joining rejected', 'joining date');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'promotion', current_date, 'Annual review', p_designation => pg_temp.id('g_se'))$q$, 'no-op change rejected', 'Nothing to change');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'transfer', current_date, 'Wrong type', p_designation => pg_temp.id('g_sse'))$q$, 'category must match the change', 'does not match');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'status_change', current_date, 'Resigning', p_status => 'notice_period')$q$, 'notice period must go through Exit Management', 'Exit Management');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'status_change', current_date, 'Leaving', p_status => 'exited')$q$, 'exit must go through Exit Management', 'Exit Management');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('hr'), 'status_change', current_date, 'Self edit', p_status => 'suspended')$q$, 'HR cannot change their own employment record', 'own employment');

-- ---- promotion: recorded with effective date, reason, actor; history preserved
do $$ begin perform public.hr_change_employee_assignment(pg_temp.id('emp'), 'promotion', current_date - 3, 'Promoted after annual review', p_designation => pg_temp.id('g_sse')); end $$;
select test.eq((select designation_id from public.hr_employees where id = pg_temp.id('emp')), pg_temp.id('g_sse'), 'promotion applied the new designation');
select test.eq((select count(*)::int from public.hr_employee_change_events where employee_id = pg_temp.id('emp') and category = 'promotion'), 1, 'promotion event recorded');
select test.eq((select effective_date from public.hr_employee_change_events where employee_id = pg_temp.id('emp') and category = 'promotion'), current_date - 3, 'event effective date stored');
select test.eq((select changed_by from public.hr_employee_change_events where employee_id = pg_temp.id('emp') and category = 'promotion'), test.user_of(pg_temp.id('hr')), 'event actor recorded');
select test.eq((select changes -> 'designation' ->> 'to' from public.hr_employee_change_events where employee_id = pg_temp.id('emp') and category = 'promotion'), 'EM Senior Software Engineer', 'event stores readable before/after values');
select test.ok(exists (select 1 from public.hr_employee_history h join public.hr_employee_change_events ev on ev.id = h.event_id
  where h.employee_id = pg_temp.id('emp') and h.change_type = 'designation' and h.old_value = 'EM Software Engineer' and h.new_value = 'EM Senior Software Engineer'
    and h.effective_date = current_date - 3 and h.note = 'Promoted after annual review'), 'field-level history row linked with effective date and reason');

-- ---- transfer (department + designation together), manager change
do $$ begin perform public.hr_change_employee_assignment(pg_temp.id('emp'), 'transfer', current_date, 'Moved to design practice', p_department => pg_temp.id('d_des'), p_designation => pg_temp.id('g_ui')); end $$;
select test.eq((select department_id from public.hr_employees where id = pg_temp.id('emp')), pg_temp.id('d_des'), 'transfer applied the new department');
do $$ begin perform public.hr_change_employee_assignment(pg_temp.id('emp'), 'manager_change', current_date, 'Design practice lead', p_manager => pg_temp.id('mgr2')); end $$;
select test.eq((select manager_id from public.hr_employees where id = pg_temp.id('emp')), pg_temp.id('mgr2'), 'manager change applied');
select test.ok(exists (select 1 from public.hr_employee_history where employee_id = pg_temp.id('emp') and change_type = 'manager' and event_id is not null and note = 'Design practice lead'), 'manager change history linked to its event');
select test.eq((select count(*)::int from public.hr_employee_history where employee_id = pg_temp.id('emp') and change_type = 'designation'), 3, 'earlier designation history rows are kept (not overwritten)');

-- ---- lifecycle: probation confirmation
do $$ begin perform public.hr_change_employee_assignment(pg_temp.id('rep2'), 'confirmation', current_date, 'Probation completed successfully', p_status => 'active'); end $$;
select test.eq((select status from public.hr_employees where id = pg_temp.id('rep2')), 'active', 'confirmation sets status active');
select test.eq((select confirmation_date from public.hr_employees where id = pg_temp.id('rep2')), current_date, 'confirmation date recorded');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('rep2'), 'confirmation', current_date, 'Again', p_status => 'active')$q$, 'cannot confirm an already-active employee', 'Nothing to change');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of((select v from t_ids where k='rep2')) and type = 'employment_change'), 'employee notified of the change');
select pg_temp.as_k('hr');

-- ---- history is immutable
do $$ begin update public.hr_employee_history set new_value = 'Tampered' where employee_id = pg_temp.id('emp'); end $$;
select test.ok(not exists (select 1 from public.hr_employee_history where new_value = 'Tampered'), 'HR cannot rewrite history (no RLS write path)');
select test.as_owner();
select test.throws($q$update public.hr_employee_history set new_value = 'Tampered' where employee_id = (select v from t_ids where k='emp')$q$, 'history rows immutable even for the table owner', 'cannot be edited');
select test.throws($q$update public.hr_employee_history set note = 'Rewritten' where event_id is not null and employee_id = (select v from t_ids where k='emp')$q$, 'linked history notes cannot be rewritten', 'cannot be edited');

-- ---- permissions on the change RPC
select pg_temp.as_k('mgr2');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'manager_change', current_date, 'Manager attempt', p_clear_manager => true)$q$, 'manager cannot change assignments', 'not allowed');
select pg_temp.as_k('emp');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'promotion', current_date, 'Self promotion', p_designation => pg_temp.id('g_any'))$q$, 'employee cannot change assignments', 'not allowed');
select pg_temp.as_k('pay');
select test.throws($q$select public.hr_change_employee_assignment(pg_temp.id('emp'), 'promotion', current_date, 'Payroll attempt', p_designation => pg_temp.id('g_any'))$q$, 'payroll admin cannot change assignments', 'not allowed');
select test.eq((select count(*)::int from public.hr_employee_change_events where employee_id = pg_temp.id('emp')), 3, 'payroll admin can read events (employees.view)');
select test.as_anon();
select test.throws($q$select public.hr_employee_timeline(pg_temp.id('emp'))$q$, 'anonymous cannot read the timeline', null);

-- ---- change events: no direct writes
select pg_temp.as_k('hr');
select test.throws($q$insert into public.hr_employee_change_events (employee_id, category, effective_date, reason) values (pg_temp.id('emp'), 'promotion', current_date, 'Forged')$q$, 'events cannot be inserted directly', null);
select test.eq((select count(*)::int from (select 1 from public.hr_employee_change_events where employee_id = pg_temp.id('emp')) x), 3, 'HR sees all events of the employee');

-- ---- timeline access: self, manager scope, isolation
select test.ok(jsonb_array_length(public.hr_employee_timeline(pg_temp.id('emp'))) >= 4, 'HR reads the full timeline');
select test.ok(exists (select 1 from jsonb_array_elements(public.hr_employee_timeline(pg_temp.id('emp'))) x where x ->> 'type' = 'promotion' and x ->> 'actor' like 'Hari%'), 'timeline shows the event actor by name');
select pg_temp.as_k('emp');
select test.ok(jsonb_array_length(public.hr_employee_timeline(pg_temp.id('emp'))) >= 4, 'employee reads own timeline');
select test.eq((select count(*)::int from public.hr_employee_change_events where employee_id = pg_temp.id('emp')), 3, 'employee reads own change events');
select test.throws($q$select public.hr_employee_timeline(pg_temp.id('oth'))$q$, 'employee cannot read a colleague timeline', 'not allowed');
select test.eq((select count(*)::int from public.hr_employee_change_events where employee_id = pg_temp.id('rep2')), 0, 'employee cannot read a colleague change events');
select pg_temp.as_k('mgr2');
select test.ok(jsonb_array_length(public.hr_employee_timeline(pg_temp.id('emp'))) >= 1, 'manager reads a direct report timeline');
select test.throws($q$select public.hr_employee_timeline(pg_temp.id('hr'))$q$, 'manager cannot read outside the reporting line', 'not allowed');
select pg_temp.as_k('mgr');
select test.throws($q$select public.hr_employee_timeline(pg_temp.id('emp'))$q$, 'previous manager loses access after the manager change', 'not allowed');

-- ---- summary is scoped by RLS
select pg_temp.as_k('mgr2');
select test.eq((public.hr_employee_summary() ->> 'total')::int, 4, 'manager summary counts only self + reporting line (self, emp, rep2 indirect, oth)');
select pg_temp.as_k('hr');
select test.ok((public.hr_employee_summary() ->> 'total')::int >= 10, 'HR summary counts every employee');
select test.ok((public.hr_employee_summary(p_department => pg_temp.id('d_des')) ->> 'total')::int >= 2, 'summary respects the department filter');
select test.as_anon();
select test.throws($q$select public.hr_employee_summary()$q$, 'anonymous cannot read the summary', null);

-- ---- private data stays restricted (regression)
select pg_temp.as_k('mgr2');
select test.eq((select count(*)::int from public.hr_employee_private where employee_id = pg_temp.id('emp')), 0, 'manager cannot read report PII');
select test.eq((select count(*)::int from public.hr_employee_bank_accounts where employee_id = pg_temp.id('emp')), 0, 'manager cannot read report bank accounts');
select pg_temp.as_k('hr');
select test.eq((select count(*)::int from public.hr_payroll_employee_identifiers where employee_id = pg_temp.id('emp')), 0, 'HR admin cannot read payroll identifiers');

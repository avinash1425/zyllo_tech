-- 197: hr_private write helpers revoked from API roles (blanket grants of
-- 170/171/190 undone), report export still audited, HR Dashboard request
-- counts for Module 10 statuses / approval stages, default roles for
-- exit.clearance_it and the Module 10 request permissions.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.appr(p_key text) returns int language sql as $$
  select (x ->> 'count')::int from jsonb_array_elements(public.hr_dashboard() -> 'my_approvals') x where x ->> 'key' = p_key
$$;
create function pg_temp.sla() returns int language sql as $$
  select (x ->> 'count')::int from jsonb_array_elements(public.hr_dashboard() -> 'alerts') x where x ->> 'type' = 'hr_request_sla'
$$;
create function pg_temp.stage(p_req text) returns uuid language plpgsql security definer as $$
declare v_out uuid;
begin
  execute 'select id from public.hr_request_approvals where request_id = $1 and status = ''pending''' into v_out using (select t.v from t_ids t where t.k = p_req);
  return v_out;
end $$;

do $$
begin
  insert into t_ids values ('super', test.make_employee('f197.super@test.local', 'Sia', null, array['super_admin']));
  insert into t_ids values ('hr',    test.make_employee('f197.hr@test.local', 'Hema', null, array['hr_admin','employee']));
  insert into t_ids values ('pay',   test.make_employee('f197.pay@test.local', 'Pavan', null, array['payroll_admin','employee']));
  insert into t_ids values ('mgr',   test.make_employee('f197.mgr@test.local', 'Meru', null, array['manager','employee']));
  insert into t_ids values ('it',    test.make_employee('f197.it@test.local', 'Ivan', null, array['it_admin','employee']));
  insert into t_ids values ('e1',    test.make_employee('f197.e1@test.local', 'Asha', (select v from t_ids where k = 'mgr')));
  insert into t_ids values ('e2',    test.make_employee('f197.e2@test.local', 'Bodhi', null));
end $$;

-- =====================================================================
-- A. hr_private write helpers are not callable by API roles
-- =====================================================================
select test.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'hr_private'
    and (p.prorettype = 'trigger'::regtype or p.proname = any (array[
      'audit_event','notify_user','notify_employee','notify_permission_holders','queue_email','announcement_publish_now',
      'next_employee_code','attendance_write','correction_event','ensure_leave_balance','leave_event','leave_scope',
      'leave_day_rows','generate_offer_letter','issue_offer','hold_application','reject_application','set_candidate_stage',
      'publish_opening_posting','payroll_post_correction','payroll_refresh_payment_status','doc_apply_details','doc_supersede',
      'exit_log','exit_notify','asset_assign','asset_assign_full','asset_set_state','asset_event','asset_close_handover',
      'asset_damage_create','asset_open_return','asset_require_manage']))
    and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'no hr_private write helper or trigger function is executable by authenticated / anon');
select test.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'hr_private' and p.prosecdef and p.provolatile = 'v' and p.prorettype <> 'trigger'::regtype
    and p.proname <> 'audit_report_export' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'every volatile SECURITY DEFINER hr_private helper is revoked (audit_report_export is the only, permission-checked, exception)');
select test.ok(has_function_privilege('authenticated', 'hr_private.has_permission(text)', 'EXECUTE')
           and has_function_privilege('authenticated', 'hr_private.current_employee_id()', 'EXECUTE')
           and has_function_privilege('authenticated', 'hr_private.request_row_visible(uuid)', 'EXECUTE')
           and has_function_privilege('authenticated', 'hr_private.asset_is_mine(uuid)', 'EXECUTE'),
  'RLS helpers stay executable');
select test.ok(has_function_privilege('service_role', 'hr_private.notify_user(uuid,text,text,text,text,text,text)', 'EXECUTE'),
  'service_role keeps its grants');

select pg_temp.as_k('e2');
select test.throws($q$select hr_private.audit_event('LOGIN', 'hr_employees', 'forged', '{}'::jsonb)$q$, 'employee cannot forge audit rows', 'permission denied');
select test.throws($q$select hr_private.notify_user(auth.uid(), 'x', 'spam')$q$, 'employee cannot call notify_user', 'permission denied');
select test.throws($q$select hr_private.notify_employee(pg_temp.id('e1'), 'x', 'spam')$q$, 'employee cannot call notify_employee', 'permission denied');
select test.throws($q$select hr_private.notify_permission_holders('hr_requests.manage', 'x', 'spam', null, null, null, null)$q$, 'employee cannot call notify_permission_holders', 'permission denied');
select test.throws($q$select hr_private.queue_email('a@b.c', 'x', 'spam', 'spam', null, null)$q$, 'employee cannot queue emails', 'permission denied');
select test.throws($q$select hr_private.next_employee_code()$q$, 'employee cannot consume employee codes', 'permission denied');
select test.throws($q$select hr_private.ensure_leave_balance(pg_temp.id('e2'), (select id from public.hr_leave_types limit 1), 2030)$q$,
  'employee cannot create leave balances', 'permission denied');
select test.throws($q$select hr_private.audit_report_export('headcount', false, '{}'::jsonb)$q$, 'export audit helper refuses callers without reports.export', 'permission');
select test.eq(test.count_rows($q$select 1 from public.hr_me() m$q$), 1::bigint, 'ordinary self-service still works');

-- hr_report_export (SECURITY INVOKER) no longer needs audit_event.
select pg_temp.as_k('hr');
select test.eq((public.hr_report_export('analytics', 'headcount', 'csv') -> 'export' ->> 'format'), 'csv', 'HR admin export still works (invoker -> audit helper)');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where action = 'report_export' and table_name = 'hr_report' and record_id = 'headcount'
                       and actor_user_id = test.user_of(pg_temp.id('hr')) and context ->> 'format' = 'csv'), 'export is audited with the actor');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_report_export('report', 'payroll_summary', 'csv')$q$, 'payroll export still refused for HR admin', 'payroll');
select test.throws($q$select hr_private.audit_report_export('payroll_summary', true, '{}'::jsonb)$q$, 'audit helper re-checks payroll.export', 'permission');

-- =====================================================================
-- B. HR Dashboard — Module 10 statuses and approval stages
-- =====================================================================
select test.as_owner();
-- Letters go manager -> HR so both approval stages are exercised.
update public.hr_request_categories set approval_stages = array['manager','hr'] where code = 'document_request';
select pg_temp.as_k('e1');
do $$ begin
  insert into t_ids values ('let', public.hr_create_workflow_request('document_request',
    '{"letter_type":"experience_letter","purpose":"Visa application","addressed_to":"Consulate"}'::jsonb));
end $$;
select test.as_owner();
select test.ok((select status = 'pending_approval' from public.hr_requests where id = pg_temp.id('let')), 'fixture: letter pending approval');
select test.ok((select stage_role = 'manager' from public.hr_request_approvals where id = pg_temp.stage('let')), 'fixture: manager stage first');

select pg_temp.as_k('hr');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'pending_hr_requests')::int, 1, 'KPI counts pending_approval requests');
select test.eq(pg_temp.appr('hr_requests'), 1, 'HR (hr_requests.manage) may override the pending manager stage, so it is counted');

select pg_temp.as_k('mgr');
select test.eq(pg_temp.appr('team_requests'), 1, 'manager sees the team request awaiting his stage');
select test.ok(not exists (select 1 from jsonb_array_elements(public.hr_dashboard() -> 'my_approvals') x where x ->> 'key' = 'hr_requests'),
  'manager still gets no HR-desk card');
select test.ok(public.hr_dashboard() -> 'kpis' -> 'pending_hr_requests' = 'null'::jsonb, 'manager has no company-wide request KPI');
select test.as_owner();
update public.hr_requests set sla_due_at = now() - interval '1 hour' where id = pg_temp.id('let');
select pg_temp.as_k('mgr');
select test.eq(pg_temp.sla(), 1, 'overdue item awaiting the manager raises the SLA alert');
select test.ok((select x ->> 'path' from jsonb_array_elements(public.hr_dashboard() -> 'alerts') x where x ->> 'type' = 'hr_request_sla')
               = '/hr/requests?tab=inbox&box=overdue', 'SLA alert links to the overdue inbox');
select public.hr_decide_request_stage(pg_temp.stage('let'), 'approve', 'OK');
select test.eq(pg_temp.appr('team_requests'), 0, 'decided stage leaves the manager card');
select test.ok(pg_temp.sla() is null, 'no SLA alert once nothing awaits the manager');

select pg_temp.as_k('hr');
select test.eq(pg_temp.appr('hr_requests'), 1, 'HR stage now awaits HR');
select test.eq(pg_temp.sla(), 1, 'HR sees the overdue pending_approval request');
select public.hr_decide_request_stage(pg_temp.stage('let'), 'approve', 'Approved.');
select test.as_owner();
select test.ok((select status = 'approved' from public.hr_requests where id = pg_temp.id('let')), 'fixture: approved, awaiting issue');
select pg_temp.as_k('hr');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'pending_hr_requests')::int, 1, 'approved-awaiting-fulfilment still counts as pending');
select test.eq(pg_temp.appr('hr_requests'), 1, 'letter to issue awaits HR');
select test.eq(pg_temp.sla(), 1, 'approved request past SLA still alerts');

-- Helpdesk ticket keeps counting (assigned-or-unassigned rule of the inbox)
select pg_temp.as_k('e2');
do $$ begin
  insert into t_ids values ('tick', public.hr_create_hr_request('general', 'Laptop bag', 'Need a new bag'));
end $$;
select pg_temp.as_k('hr');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'pending_hr_requests')::int, 2, 'open helpdesk ticket counted with the workflow request');
select test.eq(pg_temp.appr('hr_requests'), 2, 'ticket to respond to plus letter to issue');

-- Attendance corrections are not double counted in the request card
select test.as_owner();
insert into public.hr_attendance_corrections (employee_id, work_date, reason, requested_check_out_at)
  values (pg_temp.id('e1'), current_date - 1, 'Forgot to check out', (current_date - 1)::timestamp + time '18:00');
select pg_temp.as_k('hr');
select test.eq(pg_temp.appr('hr_requests'), 2, 'attendance correction not counted in the request card');
select test.eq(pg_temp.appr('attendance_corrections'), 1, 'attendance correction keeps its own card');

-- Super admin (all desks) sees the same request card
select pg_temp.as_k('super');
select test.eq(pg_temp.appr('hr_requests'), 2, 'super admin request card');

-- Payroll Admin: no dashboard (owner decision unchanged)
select pg_temp.as_k('pay');
select test.throws($q$select public.hr_dashboard()$q$, 'payroll admin still has no dashboard', 'access to the HR dashboard');

-- =====================================================================
-- C. Roles
-- =====================================================================
select test.as_owner();
select test.ok(exists (select 1 from public.hr_roles where key = 'it_admin' and is_system), 'IT Admin system role exists');
select test.eq((select array_agg(permission_key order by permission_key) from public.hr_role_permissions where role_key = 'it_admin'),
               array['exit.clearance_it','helpdesk.it']::text[], 'IT Admin holds exactly exit.clearance_it and (181) helpdesk.it');
select test.ok(exists (select 1 from public.hr_role_permissions where role_key = 'payroll_admin' and permission_key = 'hr_requests.payroll'),
  'hr_requests.payroll -> Payroll Admin');
select test.ok(exists (select 1 from public.hr_role_permissions where role_key = 'payroll_admin' and permission_key = 'hr_requests.finance'),
  'hr_requests.finance -> Payroll Admin (no finance role)');
select test.ok(exists (select 1 from public.hr_role_permissions where role_key = 'manager' and permission_key = 'hr_requests.approve_team'),
  'hr_requests.approve_team -> Manager');
select test.eq((select array_agg(role_key) from public.hr_role_permissions where permission_key = 'exit.override'),
               array['super_admin']::text[], 'exit.override stays super-admin only');
select test.ok(not exists (select 1 from public.hr_role_permissions where role_key = 'payroll_admin' and permission_key like 'dashboard.%'),
  'Payroll Admin has no dashboard permission');

-- IT clearance: exit in clearance visible with the employee's name; other employees are not.
insert into public.hr_exits (employee_id, initiated_by, exit_type, status, approved_last_working_day)
  values (pg_temp.id('e2'), 'hr', 'resignation', 'clearance', current_date + 3);
select pg_temp.as_k('it');
select test.ok(hr_private.has_permission('exit.clearance_it') and not hr_private.has_permission('exit.manage')
               and not hr_private.has_permission('employees.view'), 'IT admin: clearance permission only');
select test.eq(test.count_rows($q$select 1 from public.hr_exits where employee_id = pg_temp.id('e2')$q$), 1::bigint, 'IT admin sees the exit in clearance');
select test.eq(test.count_rows($q$select 1 from public.hr_employees where id = pg_temp.id('e2')$q$), 1::bigint, 'IT admin can read the leaver''s employee row');
select test.eq(test.count_rows($q$select 1 from public.hr_employees where id = pg_temp.id('e1')$q$), 0::bigint, 'IT admin cannot read other employees');
select test.throws($q$select public.hr_dashboard()$q$, 'IT admin has no dashboard', 'access to the HR dashboard');
select test.as_owner();
update public.hr_exits set status = 'notice_period' where employee_id = pg_temp.id('e2');
select pg_temp.as_k('it');
select test.eq(test.count_rows($q$select 1 from public.hr_employees where id = pg_temp.id('e2')$q$), 0::bigint, 'employee row hidden before the clearance stage');
select test.as_owner();

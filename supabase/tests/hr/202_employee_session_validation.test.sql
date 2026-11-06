-- 202: every employee-linked account (email, Manager, HR Admin, Payroll,
-- Employee ID) needs a live auth.sessions row; Website Admin and standalone
-- HR / Super Admin accounts are unaffected; direct user-id policies and the
-- policy-change withdraw RPC are covered; rollback switch; multi-session
-- sign-out; security revocations end all sessions; migration is re-runnable.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.u(p_k text) returns uuid language sql as $$ select test.user_of((select v from t_ids where k = p_k)) $$;
-- live session (normal sign-in)
create function pg_temp.live(p_k text) returns void language plpgsql as $$
begin perform test.as_owner(); perform test.as_user(pg_temp.u(p_k)); end $$;
-- unexpired token whose session no longer exists (signed out / revoked elsewhere)
create function pg_temp.ended(p_k text) returns void language plpgsql as $$
begin perform test.as_owner(); perform test.as_claims(pg_temp.u(p_k), gen_random_uuid()); end $$;
create function pg_temp.sessions(p_user uuid) returns int language sql security definer as $$
  select count(*)::int from auth.sessions where user_id = p_user $$;
create function pg_temp.set_flag(p_on boolean) returns void language sql security definer as $$
  update hr_private.security_flags set enabled = p_on where key = 'employee_session_validation' $$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

do $$
declare v_emp uuid; u uuid;
begin
  -- employee-linked accounts (email sign-in)
  insert into t_ids values ('mgr',   test.make_employee('f202.mgr@test.local', 'Manoj', null, array['manager','employee']));
  insert into t_ids values ('emp',   test.make_employee('f202.emp@test.local', 'Esha', (select v from t_ids where k = 'mgr')));
  insert into t_ids values ('hremp', test.make_employee('f202.hr@test.local', 'Hema', null, array['hr_admin','employee']));
  insert into t_ids values ('pay',   test.make_employee('f202.pay@test.local', 'Pavan', null, array['payroll_admin','employee']));
  insert into t_ids values ('other', test.make_employee('f202.other@test.local', 'Omkar'));
  -- Employee ID account (migration 200), password already chosen
  insert into public.hr_employees (first_name, status, joining_date) values ('Idris', 'active', current_date - 50) returning id into v_emp;
  u := test.create_user(lower((select employee_code from public.hr_employees where id = v_emp)) || '@staff.zyllotech.com');
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employees set user_id = u, login_id = employee_code, portal_access = true, password_changed_at = now() where id = v_emp;
  perform set_config('hr.privileged_write', 'off', true);
  insert into public.hr_user_roles (user_id, role_key) values (u, 'employee');
  insert into t_ids values ('idacc', v_emp);
  -- accounts WITHOUT an employee record (must be unaffected)
  insert into t_ids values ('super_u', test.create_user('f202.super@test.local'));
  insert into public.hr_user_roles (user_id, role_key) values ((select v from t_ids where k = 'super_u'), 'super_admin');
  insert into t_ids values ('hradm_u', test.create_user('f202.hradmin@test.local'));
  insert into public.hr_user_roles (user_id, role_key) values ((select v from t_ids where k = 'hradm_u'), 'hr_admin');
  insert into t_ids values ('site_u', test.create_user('f202.siteadmin@test.local'));
  insert into public.admin_users (user_id, email) values ((select v from t_ids where k = 'site_u'), 'f202.siteadmin@test.local');
  -- own notification for every employee account
  insert into public.hr_notifications (recipient_user_id, type, title)
  select test.user_of(t.v), 'test', 'hello ' || t.k from t_ids t where t.k in ('mgr','emp','hremp','pay','idacc');
end $$;

-- =====================================================================
-- A. Live sessions: unchanged access for every account type
-- =====================================================================
select pg_temp.live('emp');
select test.eq(hr_private.current_employee_id(), pg_temp.id('emp'), 'email employee: identity with a live session');
select test.eq(test.count_rows('select 1 from public.hr_notifications'), 1::bigint, 'email employee: own notification visible');
select pg_temp.live('mgr');
select test.ok(hr_private.has_permission('employees.view_team') and hr_private.is_manager_of(pg_temp.id('emp')), 'manager: team permission with a live session');
select test.eq(test.count_rows('select 1 from public.hr_employees where id = ' || quote_literal(pg_temp.id('emp'))), 1::bigint, 'manager: sees report');
select pg_temp.live('hremp');
select test.ok(hr_private.has_permission('employees.view'), 'HR Admin employee: HR permission with a live session');
select pg_temp.live('pay');
select test.ok(hr_private.has_permission('payroll.view'), 'Payroll employee: payroll permission with a live session');
select pg_temp.live('idacc');
select test.eq(hr_private.current_employee_id(), pg_temp.id('idacc'), 'Employee ID account: identity with a live session');
select test.ok(not (public.hr_me() ->> 'session_ended')::boolean, 'hr_me: session_ended false while live');

-- =====================================================================
-- B. Ended session: no identity, roles, permissions or own rows
-- =====================================================================
select pg_temp.ended('emp');
select test.ok(hr_private.current_employee_id() is null, 'email employee: no identity after the session ended');
select test.ok((public.hr_me() ->> 'session_ended')::boolean and (public.hr_me() ->> 'revoked')::boolean, 'hr_me: session_ended + revoked');
select test.eq(public.hr_me() ->> 'roles', '[]', 'email employee: no roles');
select test.eq(test.count_rows('select 1 from public.hr_employees'), 0::bigint, 'email employee: no employee rows (own included)');
select test.eq(test.count_rows('select 1 from public.hr_notifications'), 0::bigint, 'email employee: own notifications hidden (direct policy)');
select test.eq(test.count_rows('select 1 from public.hr_user_roles'), 0::bigint, 'email employee: own role list hidden (direct policy)');
select test.eq(test.count_rows('select 1 from public.hr_roles'), 0::bigint, 'email employee: role catalogue hidden');
select test.eq(test.count_rows('select 1 from public.hr_login_events'), 0::bigint, 'email employee: own sign-in history hidden');
select test.eq(test.count_rows('select 1 from public.hr_email_outbox'), 0::bigint, 'email employee: own outbox rows hidden');
update public.hr_notifications set read_at = now();
select test.as_owner();
select test.ok(not exists (select 1 from public.hr_notifications where recipient_user_id = pg_temp.u('emp') and read_at is not null),
               'email employee: cannot mark own notifications read');

select pg_temp.ended('mgr');
select test.ok(not hr_private.has_permission('employees.view_team') and not hr_private.has_role('manager'), 'manager: team permission + role gone');
select test.eq(test.count_rows('select 1 from public.hr_employees'), 0::bigint, 'manager: report no longer visible');
select pg_temp.ended('hremp');
select test.ok(not hr_private.has_permission('employees.view') and not hr_private.has_permission('employees.manage_login'), 'HR Admin employee: HR permissions gone');
select test.eq(public.hr_me() ->> 'permissions', '[]', 'HR Admin employee: hr_me has no permissions');
select pg_temp.ended('pay');
select test.ok(not hr_private.has_permission('payroll.view') and not hr_private.has_permission('payroll.manage'), 'Payroll employee: payroll permissions gone');
select pg_temp.ended('idacc');
select test.ok(hr_private.current_employee_id() is null and (public.hr_me() ->> 'session_ended')::boolean, 'Employee ID account: still strict');

-- =====================================================================
-- C. Accounts without an employee record are unaffected
-- =====================================================================
select test.as_owner(); select test.as_claims(pg_temp.id('super_u'), gen_random_uuid());
select test.ok(hr_private.has_permission('employees.view') and not (public.hr_me() ->> 'session_ended')::boolean, 'standalone Super Admin: unchanged even without a session row');
select test.as_owner(); select test.as_claims(pg_temp.id('hradm_u'), gen_random_uuid());
select test.ok(hr_private.has_permission('employees.view') and not (public.hr_me() ->> 'revoked')::boolean, 'standalone HR Admin: unchanged');
select test.as_owner(); select test.as_claims(pg_temp.id('site_u'), gen_random_uuid());
select test.ok(public.is_admin(), 'Website Admin: is_admin() unchanged');
select test.ok(hr_private.caller_session_ok(), 'Website Admin: session check not applied');
select test.as_service();
select test.ok(hr_private.caller_session_ok(), 'service role: not affected');
select test.as_owner();
select set_config('request.jwt.claims', '{"role":"anon"}', true);   -- anon claims (anon has no hr_private access at all)
select test.ok(hr_private.caller_session_ok(), 'anon: not affected (no user)');
select test.as_owner();

-- =====================================================================
-- D. Direct RPC path: withdrawing a policy change needs a live session
-- =====================================================================
select test.as_owner();
insert into public.hr_leave_policy_changes (action, proposed, reason, proposed_by)
values ('create', '{"code":"T202"}'::jsonb, 'test change', pg_temp.u('hremp')) returning id \gset chg_
insert into t_ids values ('chg', :'chg_id');
select pg_temp.ended('hremp');
select test.throws($q$select public.hr_withdraw_leave_policy_change(pg_temp.id('chg'))$q$, 'ended session cannot withdraw own policy change', 'not found');
select pg_temp.live('hremp');
select test.eq(public.hr_withdraw_leave_policy_change(pg_temp.id('chg')) ->> 'status', 'withdrawn', 'live session can withdraw it');

-- =====================================================================
-- E. Multiple sessions: device sign-out (local) vs all devices (global)
-- =====================================================================
select test.as_owner();
delete from auth.sessions where user_id = pg_temp.u('emp');
insert into auth.sessions (user_id) values (pg_temp.u('emp')) returning id \gset dev_a_
insert into auth.sessions (user_id) values (pg_temp.u('emp')) returning id \gset dev_b_
insert into t_ids values ('dev_a', :'dev_a_id'), ('dev_b', :'dev_b_id');
delete from auth.sessions where id = pg_temp.id('dev_a');                  -- sign out on device A only (scope=local)
select test.as_claims(pg_temp.u('emp'), pg_temp.id('dev_a'));
select test.ok(hr_private.current_employee_id() is null, 'device A signed out: A has no access');
select test.as_owner(); select test.as_claims(pg_temp.u('emp'), pg_temp.id('dev_b'));
select test.eq(hr_private.current_employee_id(), pg_temp.id('emp'), 'device A signed out: device B keeps access');
select test.as_owner();
select hr_private.revoke_user_sessions(pg_temp.u('emp'));               -- security revocation (all devices)
select test.as_claims(pg_temp.u('emp'), pg_temp.id('dev_b'));
select test.ok(hr_private.current_employee_id() is null, 'all-device revocation: device B loses access');

-- =====================================================================
-- F. Security revocations end ALL sessions (trigger)
-- =====================================================================
select test.as_owner();
insert into auth.sessions (user_id) select pg_temp.u(k) from (values ('emp'),('emp'),('pay'),('other'),('mgr')) s(k);
select pg_temp.live('hremp');
select public.hr_set_portal_access(pg_temp.id('emp'), false);             -- portal access off (email account toggle)
select test.as_owner();
select test.eq(pg_temp.sessions(pg_temp.u('emp')), 0, 'portal access off -> all sessions ended');
select test.ok(pg_temp.sessions(pg_temp.u('pay')) > 0, 'other employees keep their sessions');
select pg_temp.live('hremp');
update public.hr_employees set status = 'suspended' where id = pg_temp.id('pay');
select test.as_owner();
select test.eq(pg_temp.sessions(pg_temp.u('pay')), 0, 'suspension -> all sessions ended');
select pg_temp.live('hremp');
update public.hr_employees set first_name = 'Omkar R' where id = pg_temp.id('other');
select test.as_owner();
select test.ok(pg_temp.sessions(pg_temp.u('other')) > 0, 'unrelated profile edit keeps sessions');
insert into t_ids values ('mgr_user', pg_temp.u('mgr'));
select test.ok(pg_temp.sessions(pg_temp.id('mgr_user')) > 0, 'manager has sessions before unlinking');
select set_config('hr.privileged_write', 'on', true);
update public.hr_employees set user_id = null where id = pg_temp.id('mgr');   -- account unlinked (portal flag untouched)
select set_config('hr.privileged_write', 'off', true);
select test.eq(pg_temp.sessions(pg_temp.id('mgr_user')), 0, 'account unlinked -> its sessions ended');

-- ---- per-request cache: a revocation later in the SAME request is seen at once
create function pg_temp.revoke_now(p_user uuid) returns int language sql security definer as $$
  select hr_private.revoke_user_sessions(p_user) $$;
grant execute on function pg_temp.revoke_now(uuid) to authenticated;
select pg_temp.live('other');
select test.eq(hr_private.current_employee_id(), pg_temp.id('other'), 'cache: live session cached as valid');
select test.ok(hr_private.current_employee_id() = pg_temp.id('other'), 'cache: second read in the same request (cached)');
select pg_temp.revoke_now(pg_temp.u('other'));                             -- same request, same claims
select test.ok(hr_private.current_employee_id() is null and hr_private.caller_is_revoked(), 'cache: revocation in the same request invalidates it');

-- =====================================================================
-- G. Rollback switch (email accounts only) + re-runnable migration
-- =====================================================================
select pg_temp.set_flag(false);
select pg_temp.ended('hremp');
select test.ok(hr_private.has_permission('employees.view'), 'switch OFF: email HR Admin employee back to pre-202 behaviour');
select pg_temp.ended('idacc');
select test.ok(hr_private.current_employee_id() is null, 'switch OFF: Employee ID accounts stay strict');
select test.as_owner();
\ir ../../migrations/202_hr_employee_session_validation.sql
select test.ok(not hr_private.employee_session_validation_enabled(), 're-running 202 keeps the switch setting');
select pg_temp.set_flag(true);
select pg_temp.ended('hremp');
select test.ok(not hr_private.has_permission('employees.view'), 'switch ON again: enforced after re-run');
select test.as_owner();
select test.ok(not has_table_privilege('authenticated', 'hr_private.security_flags', 'SELECT')
           and not has_table_privilege('service_role', 'hr_private.security_flags', 'UPDATE'), 'switch not readable/changeable by API roles');
select test.ok(not has_function_privilege('authenticated', 'hr_private.employees_revoke_sessions_on_access_loss()', 'EXECUTE'), 'trigger function not executable by API roles');

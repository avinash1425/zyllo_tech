-- 200: Employee ID sign-in. Permission + pre-flight checks, service-role-only
-- steps, forced password change (temporary / expired), session liveness,
-- reset / deactivate / activate, column guards, legacy email accounts
-- unchanged, and the password-verification lockout hook.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role, supabase_auth_admin;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
-- Signed in with a specific Supabase session (JWT session_id claim).
create function pg_temp.as_sess(p_user uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.emp(p_k text) returns public.hr_employees language plpgsql security definer as $$
declare r public.hr_employees;
begin
  select * into r from public.hr_employees where id = (select v from t_ids where k = p_k);
  return r;
end $$;
create function pg_temp.sessions(p_user uuid) returns int language sql security definer as $$
  select count(*)::int from auth.sessions where user_id = p_user
$$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role, supabase_auth_admin;

do $$
declare v uuid;
begin
  insert into t_ids values ('super', test.make_employee('f200.super@test.local', 'Sia', null, array['super_admin']));
  insert into t_ids values ('hr',    test.make_employee('f200.hr@test.local', 'Hema', null, array['hr_admin','employee']));
  insert into t_ids values ('pay',   test.make_employee('f200.pay@test.local', 'Pavan', null, array['payroll_admin','employee']));
  insert into t_ids values ('legacy', test.make_employee('f200.legacy@test.local', 'Lata'));
  -- Employees without any account (created by HR, no email needed for login).
  insert into public.hr_employees (first_name, status, joining_date) values ('Nina', 'active', current_date - 30) returning id into v;
  insert into t_ids values ('new', v);
  insert into public.hr_employees (first_name, status, joining_date) values ('Pari', 'active', current_date - 30) returning id into v;
  insert into t_ids values ('newpriv', v);
  insert into public.hr_employees (first_name, status, joining_date) values ('Ravi', 'exited', current_date - 300) returning id into v;
  insert into t_ids values ('gone', v);
end $$;

-- =====================================================================
-- A. Permission catalogue
-- =====================================================================
select test.ok(exists (select 1 from public.hr_permissions where key = 'employees.manage_login'), 'employees.manage_login exists');
select test.ok(exists (select 1 from public.hr_role_permissions where role_key = 'hr_admin' and permission_key = 'employees.manage_login'), 'HR Admin has manage_login');
select test.ok(exists (select 1 from public.hr_role_permissions where role_key = 'super_admin' and permission_key = 'employees.manage_login'), 'Super Admin has manage_login');
select test.ok(not exists (select 1 from public.hr_role_permissions where permission_key = 'employees.manage_login'
                           and role_key not in ('hr_admin','super_admin')), 'no other role has manage_login');

-- =====================================================================
-- B. Pre-flight (caller JWT)
-- =====================================================================
select pg_temp.as_k('legacy');
select test.throws($$ select public.hr_can_manage_login(pg_temp.id('new'), 'create') $$, 'employee cannot manage logins', 'not allowed');
select pg_temp.as_k('pay');
select test.throws($$ select public.hr_can_manage_login(pg_temp.id('new'), 'create') $$, 'payroll admin cannot manage logins', 'not allowed');

select pg_temp.as_k('hr');
select test.eq(public.hr_can_manage_login(pg_temp.id('new'), 'create') ->> 'login_email',
               lower((pg_temp.emp('new')).employee_code) || '@staff.zyllotech.com', 'login email derived from Employee ID');
select test.throws($$ select public.hr_can_manage_login(pg_temp.id('new'), 'drop') $$, 'unknown action rejected', 'unknown');
select test.throws($$ select public.hr_can_manage_login(pg_temp.id('hr'), 'create') $$, 'cannot manage own sign-in', 'your own');
select test.throws($$ select public.hr_can_manage_login(pg_temp.id('legacy'), 'create') $$, 'existing email account is not replaced', 'already has a sign-in');
select test.throws($$ select public.hr_can_manage_login(pg_temp.id('legacy'), 'reset') $$, 'reset refused for email accounts', 'signs in with email');
select test.throws($$ select public.hr_can_manage_login(pg_temp.id('new'), 'reset') $$, 'reset refused before a login exists', 'no login yet');
select test.throws($$ select public.hr_can_manage_login(pg_temp.id('gone'), 'create') $$, 'exited employee cannot get a login', 'Exited');

-- =====================================================================
-- C. Service-role steps are not callable from the browser
-- =====================================================================
select test.throws($$ select public.hr_link_employee_login(pg_temp.id('new'), gen_random_uuid(), auth.uid()) $$, 'link: not callable by authenticated', 'permission denied');
select test.throws($$ select public.hr_begin_password_reset(pg_temp.id('new'), auth.uid()) $$, 'reset: not callable by authenticated', 'permission denied');
select test.throws($$ select public.hr_set_employee_login_active(pg_temp.id('new'), true, auth.uid()) $$, 'activate: not callable by authenticated', 'permission denied');
select test.throws($$ select public.hr_complete_own_password_change(auth.uid()) $$, 'complete change: not callable by authenticated', 'permission denied');
select test.throws($$ select public.hr_own_login_for_password_change(auth.uid(), null) $$, 'own login lookup: not callable by authenticated', 'permission denied');
select test.throws($$ select public.hr_password_verification_hook('{}'::jsonb) $$, 'hook: not callable by authenticated', 'permission denied');
select test.throws($$ select * from public.hr_login_attempts $$, 'lockout table hidden from authenticated', 'permission denied');
select test.as_anon();
select test.throws($$ select public.hr_can_manage_login(gen_random_uuid(), 'create') $$, 'anon cannot pre-flight', 'permission denied');
select test.as_owner();
select test.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'hr_private'
    and p.proname = any (array['employee_login_email','login_password_max_age_days','login_change_required','session_is_live',
                               'revoke_user_sessions','audit_login_event','require_service_role','check_own_password_change',
                               'employees_guard_login_insert'])
    and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'new hr_private helpers are not executable by authenticated / anon');
select test.ok(not has_function_privilege('anon', 'public.hr_link_employee_login(uuid,uuid,uuid)', 'EXECUTE')
           and not has_function_privilege('authenticated', 'public.hr_begin_password_reset(uuid,uuid)', 'EXECUTE')
           and has_function_privilege('service_role', 'public.hr_begin_password_reset(uuid,uuid)', 'EXECUTE'), 'service steps: service_role only');

-- =====================================================================
-- D. Create + link (what hr-employee-login does after auth.admin.createUser)
-- =====================================================================
select test.as_owner();
insert into t_ids values ('new_user', test.create_user(lower((pg_temp.emp('new')).employee_code) || '@staff.zyllotech.com'));
insert into t_ids values ('wrong_user', test.create_user('someone@example.com'));
select test.as_service();
select test.throws($$ select public.hr_link_employee_login(pg_temp.id('new'), pg_temp.id('wrong_user'), test.user_of(pg_temp.id('hr'))) $$,
                   'link refuses an account whose address does not match the Employee ID', 'does not match');
select public.hr_link_employee_login(pg_temp.id('new'), pg_temp.id('new_user'), test.user_of(pg_temp.id('hr')));
select test.eq((pg_temp.emp('new')).user_id, pg_temp.id('new_user'), 'account linked to exactly this employee');
select test.eq((pg_temp.emp('new')).login_id::text, (pg_temp.emp('new')).employee_code, 'login_id = Employee ID');
select test.ok((pg_temp.emp('new')).portal_access and (pg_temp.emp('new')).password_change_required
               and (pg_temp.emp('new')).credentials_issued_at is not null, 'portal on, temporary password flagged');
select test.throws($$ select public.hr_link_employee_login(pg_temp.id('new'), pg_temp.id('new_user'), null) $$, 'cannot link twice', 'already linked');
select test.throws($$ select public.hr_link_employee_login(pg_temp.id('newpriv'), pg_temp.id('new_user'), null) $$, 'one account cannot serve two employees', 'already linked');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_user_roles where user_id = pg_temp.id('new_user') and role_key = 'employee'), 'default employee role granted');
select test.ok(exists (select 1 from public.hr_audit_log where action = 'EMPLOYEE_LOGIN_CREATED' and record_id = pg_temp.id('new')::text
                       and actor_user_id = test.user_of(pg_temp.id('hr'))), 'creation audited with the HR actor');
select test.ok(not exists (select 1 from public.hr_audit_log where action like 'EMPLOYEE_LOGIN%'
                           and (context::text ilike '%password"%' or context::text ilike '%temporary%')), 'no password material in audit context');

-- =====================================================================
-- E. Temporary password: no data until changed
-- =====================================================================
select test.as_owner();
insert into auth.sessions (user_id) values (pg_temp.id('new_user')) returning id \gset s1_
insert into t_ids values ('s1', :'s1_id');
insert into auth.sessions (user_id) values (pg_temp.id('new_user')) returning id \gset s2_
insert into t_ids values ('s2', :'s2_id');

select pg_temp.as_sess(pg_temp.id('new_user'), pg_temp.id('s1'));
select test.ok(hr_private.current_employee_id() is null, 'temporary password: no employee identity');
select test.ok((public.hr_me() -> 'employee') = 'null'::jsonb, 'temporary password: hr_me has no employee');
select test.ok((public.hr_me() #>> '{login,password_change_required}')::boolean, 'hr_me reports password_change_required');
select test.eq(public.hr_me() #>> '{login,reason}', 'temporary', 'reason = temporary');
select test.eq(public.hr_me() ->> 'roles', '[]', 'no roles while a change is required');
select test.eq(test.count_rows('select 1 from public.hr_employees'), 0::bigint, 'cannot read any employee row (own included)');

-- =====================================================================
-- F. Password changed (service step) -> access; other sessions revoked
-- =====================================================================
select test.as_service();
select test.throws($$ select public.hr_own_login_for_password_change(pg_temp.id('new_user'), gen_random_uuid()) $$, 'password change refused from an ended session', 'session has ended');
select test.eq(public.hr_own_login_for_password_change(pg_temp.id('new_user'), pg_temp.id('s1')) ->> 'login_email',
               lower((pg_temp.emp('new')).employee_code) || '@staff.zyllotech.com', 'service resolves own login address');
select public.hr_complete_own_password_change(pg_temp.id('new_user'));
select test.as_owner();
select test.eq(pg_temp.sessions(pg_temp.id('new_user')), 0, 'every session revoked after a password change');
select test.ok(not (pg_temp.emp('new')).password_change_required and (pg_temp.emp('new')).password_changed_at is not null
               and (pg_temp.emp('new')).activated_at is not null, 'flag cleared, changed_at and activated_at set');
select test.ok(exists (select 1 from public.hr_audit_log where action = 'EMPLOYEE_LOGIN_PASSWORD_CHANGED' and record_id = pg_temp.id('new')::text), 'password change audited');
-- The app signs in again with the new password (new session; s2 stays ended).
insert into auth.sessions (id, user_id) values (pg_temp.id('s1'), pg_temp.id('new_user'));

select pg_temp.as_sess(pg_temp.id('new_user'), pg_temp.id('s1'));
select test.eq(hr_private.current_employee_id(), pg_temp.id('new'), 'live session after change: own employee identity');
select test.eq(public.hr_me() #>> '{employee,id}', pg_temp.id('new')::text, 'hr_me returns own employee');
select test.ok(not (public.hr_me() #>> '{login,password_change_required}')::boolean, 'no change required');
select test.eq(test.count_rows('select 1 from public.hr_employees where id = ' || quote_literal(pg_temp.id('new'))), 1::bigint, 'reads own row');
select test.eq(test.count_rows('select 1 from public.hr_employees where id = ' || quote_literal(pg_temp.id('legacy'))), 0::bigint, 'cannot read other employees');

select pg_temp.as_sess(pg_temp.id('new_user'), pg_temp.id('s2'));
select test.ok(hr_private.current_employee_id() is null and (public.hr_me() ->> 'revoked')::boolean, 'revoked session (signed out elsewhere): no access');
select pg_temp.as_k('new');   -- claims without session_id
select test.ok(hr_private.current_employee_id() is null, 'JWT without session_id: no access for Employee-ID accounts');

-- =====================================================================
-- G. Password expiry
-- =====================================================================
select test.as_owner();
select set_config('hr.privileged_write', 'on', true);
update public.hr_employees set password_changed_at = now() - interval '91 days' where id = pg_temp.id('new');
select set_config('hr.privileged_write', 'off', true);
select pg_temp.as_sess(pg_temp.id('new_user'), pg_temp.id('s1'));
select test.ok(hr_private.current_employee_id() is null, 'expired password (91 > 90 days): no access');
select test.eq(public.hr_me() #>> '{login,reason}', 'expired', 'reason = expired');
select test.as_owner();
update public.hr_settings set value = jsonb_build_object('password_max_age_days', 0) where key = 'employee_login';
select pg_temp.as_sess(pg_temp.id('new_user'), pg_temp.id('s1'));
select test.eq(hr_private.current_employee_id(), pg_temp.id('new'), 'max age 0 disables expiry');
select test.as_owner();
update public.hr_settings set value = jsonb_build_object('password_max_age_days', 90) where key = 'employee_login';
select set_config('hr.privileged_write', 'on', true);
update public.hr_employees set password_changed_at = now() where id = pg_temp.id('new');
select set_config('hr.privileged_write', 'off', true);

-- =====================================================================
-- H. Lockout hook (Supabase Auth runs it as supabase_auth_admin)
-- =====================================================================
create function pg_temp.hook(p_user uuid, p_valid boolean) returns text language plpgsql as $$
declare r jsonb;
begin
  perform test.as_owner();
  perform set_config('role', 'supabase_auth_admin', true);
  r := public.hr_password_verification_hook(jsonb_build_object('user_id', p_user, 'valid', p_valid));
  perform set_config('role', 'none', true);
  return r ->> 'decision';
end $$;
select test.eq(pg_temp.hook(pg_temp.id('new_user'), false), 'continue', 'failure 1 continues');
select test.eq(pg_temp.hook(pg_temp.id('new_user'), false), 'continue', 'failure 2 continues');
select test.eq(pg_temp.hook(pg_temp.id('new_user'), false), 'continue', 'failure 3 continues');
select test.eq(pg_temp.hook(pg_temp.id('new_user'), false), 'continue', 'failure 4 continues');
select test.eq(pg_temp.hook(pg_temp.id('new_user'), false), 'reject', 'failure 5 locks the account');
select test.eq(pg_temp.hook(pg_temp.id('new_user'), true), 'reject', 'correct password rejected while locked');
select test.eq(pg_temp.hook(test.user_of(pg_temp.id('legacy')), false), 'continue', 'email accounts never locked by this hook');
select test.eq(pg_temp.hook(test.user_of(pg_temp.id('legacy')), false), 'continue', 'email accounts: still continue');
update public.hr_login_attempts set locked_until = now() - interval '1 second' where user_id = pg_temp.id('new_user');
select test.eq(pg_temp.hook(pg_temp.id('new_user'), true), 'continue', 'after the lock expires a correct password works');
select test.ok(not exists (select 1 from public.hr_login_attempts where user_id = pg_temp.id('new_user')), 'success clears the counter');
select test.ok(not exists (select 1 from public.hr_login_attempts where user_id = test.user_of(pg_temp.id('legacy'))), 'no rows for email accounts');

-- =====================================================================
-- I. Reset: flag again, every session ended, lock cleared, audited
-- =====================================================================
select pg_temp.hook(pg_temp.id('new_user'), false);
select test.as_service();
select public.hr_begin_password_reset(pg_temp.id('new'), test.user_of(pg_temp.id('hr')));
select test.as_owner();
select test.ok((pg_temp.emp('new')).password_change_required, 'reset requires a new password');
select test.eq(pg_temp.sessions(pg_temp.id('new_user')), 0, 'reset ends every session');
select test.ok(not exists (select 1 from public.hr_login_attempts where user_id = pg_temp.id('new_user')), 'reset clears lockout');
select test.ok(exists (select 1 from public.hr_audit_log where action = 'EMPLOYEE_LOGIN_PASSWORD_RESET' and record_id = pg_temp.id('new')::text), 'reset audited');

-- =====================================================================
-- J. Deactivate / activate
-- =====================================================================
insert into auth.sessions (user_id) values (pg_temp.id('new_user')) returning id \gset s3_
insert into t_ids values ('s3', :'s3_id');
select test.as_service();
select public.hr_complete_own_password_change(pg_temp.id('new_user'));
select test.as_owner();
insert into auth.sessions (id, user_id) values (pg_temp.id('s3'), pg_temp.id('new_user'));   -- signed in again
select test.as_service();
select public.hr_set_employee_login_active(pg_temp.id('new'), false, test.user_of(pg_temp.id('hr')));
select test.as_owner();
select test.ok(not (pg_temp.emp('new')).portal_access, 'deactivated');
select test.eq(pg_temp.sessions(pg_temp.id('new_user')), 0, 'deactivation ends every session');
select pg_temp.as_sess(pg_temp.id('new_user'), :'s3_id');
select test.ok((public.hr_me() ->> 'revoked')::boolean and (public.hr_me() -> 'employee') = 'null'::jsonb, 'deactivated: revoked');
select test.as_service();
select test.throws($$ select public.hr_own_login_for_password_change(pg_temp.id('new_user'), pg_temp.id('s3')) $$, 'deactivated user cannot change password', 'disabled');
select public.hr_set_employee_login_active(pg_temp.id('new'), true, test.user_of(pg_temp.id('hr')));
select test.as_owner();
select test.ok((pg_temp.emp('new')).portal_access, 'reactivated');
select test.ok(exists (select 1 from public.hr_audit_log where action = 'EMPLOYEE_LOGIN_DEACTIVATED' and record_id = pg_temp.id('new')::text)
           and exists (select 1 from public.hr_audit_log where action = 'EMPLOYEE_LOGIN_ACTIVATED' and record_id = pg_temp.id('new')::text), 'activation changes audited');

-- Old portal toggle refuses Employee-ID accounts (would skip ban + session revocation) but still works for email accounts.
select pg_temp.as_k('hr');
select test.throws($$ select public.hr_set_portal_access(pg_temp.id('new'), false) $$, 'legacy toggle refuses Employee-ID accounts', 'login controls');
select public.hr_set_portal_access(pg_temp.id('legacy'), false);
select test.as_owner();
select test.ok(not (pg_temp.emp('legacy')).portal_access, 'legacy toggle still works for email accounts');
select pg_temp.as_k('hr');
select public.hr_set_portal_access(pg_temp.id('legacy'), true);

-- =====================================================================
-- K. Column guards: sign-in state only through the workflow
-- =====================================================================
select pg_temp.as_k('hr');
select test.throws($$ update public.hr_employees set password_change_required = not password_change_required where id = pg_temp.id('new') $$, 'HR cannot change the change flag directly', 'access workflow');
select test.throws($$ update public.hr_employees set login_id = 'X-1' where id = pg_temp.id('newpriv') $$, 'HR cannot set login_id directly', 'access workflow');
select test.throws($$ update public.hr_employees set password_changed_at = now() + interval '1 day' where id = pg_temp.id('new') $$, 'HR cannot fake a password change', 'access workflow');
select test.throws($$ insert into public.hr_employees (first_name, login_id) values ('Zed', 'ZT-9999') $$, 'cannot insert with a login_id', 'login workflow');

-- =====================================================================
-- L. Privileged targets: Super Admin only
-- =====================================================================
select test.as_owner();
insert into t_ids values ('priv_user', test.create_user(lower((pg_temp.emp('newpriv')).employee_code) || '@staff.zyllotech.com'));
select test.as_service();
select public.hr_link_employee_login(pg_temp.id('newpriv'), pg_temp.id('priv_user'), null);
select test.as_owner();
insert into public.hr_user_roles (user_id, role_key) values (pg_temp.id('priv_user'), 'payroll_admin');
select pg_temp.as_k('hr');
select test.throws($$ select public.hr_can_manage_login(pg_temp.id('newpriv'), 'reset') $$, 'HR Admin cannot reset a payroll admin''s password', 'Super Admin');
select pg_temp.as_k('super');
select test.eq(public.hr_can_manage_login(pg_temp.id('newpriv'), 'reset') ->> 'employee_id', pg_temp.id('newpriv')::text, 'Super Admin can');

-- =====================================================================
-- M. Email accounts unchanged
-- =====================================================================
select pg_temp.as_k('legacy');
select test.eq(hr_private.current_employee_id(), pg_temp.id('legacy'), 'email account: identity without session_id claim (unchanged)');
select test.ok((public.hr_me() -> 'login') = 'null'::jsonb, 'email account: hr_me.login is null');
select pg_temp.as_k('hr');
select test.ok((public.hr_me() -> 'permissions') ? 'employees.manage_login', 'HR Admin (email) sees the new permission');
select test.as_service();
select test.throws($$ select public.hr_own_login_for_password_change(test.user_of(pg_temp.id('legacy')), null) $$, 'email accounts cannot use the Employee ID password change', 'Employee ID accounts only');
select test.as_owner();

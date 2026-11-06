-- =====================================================================
-- 200 — Employee Portal sign-in with Employee ID + password (no email)
-- =====================================================================
-- HR creates the sign-in account from Employee Management. Supabase Auth
-- still holds the credential (bcrypt), keyed by an internal, never-mailed
-- login address derived from the immutable Employee ID:
--     ZT-0007  ->  zt-0007@staff.zyllotech.com
-- The Edge Function hr-employee-login creates the account with
-- email_confirm = true (no invitation / verification email) and a random
-- one-time temporary password shown once to HR. Passwords are never
-- written to any table here.
--
-- Rules enforced in the database (RLS helpers), for Employee-ID accounts
-- only (hr_employees.login_id is not null). Existing email-invited accounts
-- (login_id null) behave exactly as before:
--   * temporary password (first login / after reset) or expired password
--     -> no employee identity, no roles, no permissions until changed
--   * the JWT's session must still exist in auth.sessions, so a reset,
--     deactivation or password change cuts off old sessions immediately
--     (not only when the 1-hour access token expires)
-- Website Admin (admin_users / is_admin) and email sign-in are untouched.
-- =====================================================================

-- ---------------------------------------------------------------- permission
insert into public.hr_permissions (key, module, action, description) values
  ('employees.manage_login', 'employees', 'manage_login',
   'Create Employee ID sign-in, issue temporary passwords, activate / deactivate sign-in')
on conflict (key) do nothing;
-- super_admin passes every has_permission() check; listed for clarity in Settings > Roles.
insert into public.hr_role_permissions (role_key, permission_key) values
  ('super_admin', 'employees.manage_login'),
  ('hr_admin',    'employees.manage_login')
on conflict do nothing;

-- ---------------------------------------------------------------- settings
insert into public.hr_settings (key, value, description) values
  ('employee_login', jsonb_build_object('password_max_age_days', 90),
   'Employee ID sign-in: days before an employee must choose a new password (0 = never).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- columns
-- (Re-runnable: "if not exists" so a corrected file can be re-applied to a dev project.)
alter table public.hr_employees
  add column if not exists login_id                 citext unique
    check (login_id is null or login_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  add column if not exists password_change_required boolean not null default false,
  add column if not exists password_changed_at      timestamptz,
  add column if not exists credentials_issued_at    timestamptz;

comment on column public.hr_employees.login_id is
  'Employee ID used to sign in (Employee-ID accounts only). Null for email-invited accounts.';

-- ---------------------------------------------------------------- helpers
-- The internal Supabase Auth login address for an Employee ID. Never mailed.
create or replace function hr_private.employee_login_email(p_login_id text)
returns text language sql immutable set search_path = '' as $$
  select lower(btrim(p_login_id)) || '@staff.zyllotech.com'
$$;

create or replace function hr_private.login_password_max_age_days()
returns int language sql stable security definer set search_path = '' as $$
  select greatest(coalesce((select (value ->> 'password_max_age_days')::int
                            from public.hr_settings where key = 'employee_login'), 90), 0)
$$;

-- Must this Employee-ID account choose a new password before using the portal?
create or replace function hr_private.login_change_required(p_login_id text, p_required boolean, p_changed_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_login_id is not null and (
           p_required
        or p_changed_at is null
        or (hr_private.login_password_max_age_days() > 0
            and p_changed_at < now() - make_interval(days => hr_private.login_password_max_age_days())))
$$;

-- Does the caller's JWT belong to a session that still exists (not signed
-- out / revoked)? Supabase documents correlating the session_id claim with
-- auth.sessions for exactly this purpose.
create or replace function hr_private.session_is_live()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'session_id', '') ~ '^[0-9a-fA-F-]{36}$'
     and exists (select 1 from auth.sessions s
                 where s.id = (auth.jwt() ->> 'session_id')::uuid
                   and s.user_id = auth.uid()
                   and (s.not_after is null or s.not_after > now()))
$$;

-- Deletes a user's sessions (their refresh tokens cascade). p_keep spares one.
create or replace function hr_private.revoke_user_sessions(p_user uuid, p_keep uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from auth.sessions where user_id = p_user and (p_keep is null or id <> p_keep);
  get diagnostics n = row_count;
  return n;
end $$;

-- Audit row written on behalf of an actor (Edge Functions run as service_role,
-- so auth.uid() is null there; the function passes the verified caller).
create or replace function hr_private.audit_login_event(p_actor uuid, p_action text, p_employee uuid, p_context jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_audit_log (actor_user_id, actor_employee_id, action, table_name, record_id, context)
  values (p_actor, (select id from public.hr_employees where user_id = p_actor limit 1),
          p_action, 'hr_employees', p_employee::text, p_context)
$$;

-- ---------------------------------------------------------------- identity (redefined)
-- Same as migration 100, plus the Employee-ID account rules above.
create or replace function hr_private.current_employee_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.hr_employees e
  where e.user_id = auth.uid()
    and e.portal_access
    and e.status not in ('exited','archived','suspended')
    and (e.login_id is null
         or (not hr_private.login_change_required(e.login_id::text, e.password_change_required, e.password_changed_at)
             and hr_private.session_is_live()))
  limit 1
$$;

create or replace function hr_private.caller_is_revoked()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hr_employees e
    where e.user_id = auth.uid()
      and (not e.portal_access
           or e.status in ('exited','archived','suspended')
           or (e.login_id is not null
               and (hr_private.login_change_required(e.login_id::text, e.password_change_required, e.password_changed_at)
                    or not hr_private.session_is_live())))
  )
$$;

-- hr_me(): unchanged payload plus `login` (Employee-ID accounts only) so the
-- app can route to the password change page.
create or replace function public.hr_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'employee', (select jsonb_build_object(
        'id', e.id, 'employee_code', e.employee_code, 'first_name', e.first_name, 'last_name', e.last_name,
        'display_name', coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
        'employment_type', e.employment_type, 'status', e.status, 'department_id', e.department_id,
        'manager_id', e.manager_id, 'photo_path', e.photo_path, 'activated_at', e.activated_at)
      from public.hr_employees e where e.id = hr_private.current_employee_id()),
    'revoked', hr_private.caller_is_revoked(),
    'roles', coalesce((select jsonb_agg(role_key order by role_key) from public.hr_user_roles
                       where user_id = auth.uid() and not hr_private.caller_is_revoked()), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(distinct p.key order by p.key) from public.hr_permissions p
                             where hr_private.has_permission(p.key)), '[]'::jsonb),
    'is_manager', exists (select 1 from public.hr_employees x where x.manager_id = hr_private.current_employee_id()
                          and x.status not in ('exited','archived')),
    'login', (select jsonb_build_object(
        'login_id', e.login_id,
        'active', e.portal_access and e.status not in ('exited','archived','suspended'),
        'password_change_required', hr_private.login_change_required(e.login_id::text, e.password_change_required, e.password_changed_at),
        'reason', case when e.password_change_required or e.password_changed_at is null then 'temporary'
                       when hr_private.login_change_required(e.login_id::text, false, e.password_changed_at) then 'expired' end,
        'password_changed_at', e.password_changed_at)
      from public.hr_employees e where e.user_id = auth.uid() and e.login_id is not null limit 1)
  )
  where auth.uid() is not null
$$;

-- ---------------------------------------------------------------- column guard (redefined)
create or replace function hr_private.employees_guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Direct table writes by API users cannot link accounts, grant access or exit people;
  -- those go through hr_set_portal_access / invite / login / exit workflows (which set a flag).
  if current_setting('hr.privileged_write', true) = 'on' or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
       or new.portal_access is distinct from old.portal_access
       or new.invited_at is distinct from old.invited_at
       or new.activated_at is distinct from old.activated_at
       or new.login_id is distinct from old.login_id
       or new.password_change_required is distinct from old.password_change_required
       or new.password_changed_at is distinct from old.password_changed_at
       or new.credentials_issued_at is distinct from old.credentials_issued_at then
      perform hr_private.fail('Portal access is changed through the invitation / access workflow.', 'use_access_workflow');
    end if;
    if new.status in ('exited') and old.status is distinct from 'exited' then
      perform hr_private.fail('Employees are exited through the Exit Management workflow.', 'use_exit_workflow');
    end if;
    if new.status = 'archived' and old.status is distinct from 'archived' and not hr_private.has_permission('employees.archive') then
      perform hr_private.fail('You are not allowed to archive employees.', 'forbidden');
    end if;
  end if;
  return new;
end $$;

-- New rows cannot be created with sign-in state either (insert policy already
-- forces user_id null / portal_access false).
create or replace function hr_private.employees_guard_login_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('hr.privileged_write', true) = 'on' or auth.uid() is null then return new; end if;
  if new.login_id is not null or new.password_change_required or new.password_changed_at is not null
     or new.credentials_issued_at is not null then
    perform hr_private.fail('Sign-in is created through the Employee login workflow.', 'use_access_workflow');
  end if;
  return new;
end $$;
drop trigger if exists hr_employees_guard_login_insert on public.hr_employees;
create trigger hr_employees_guard_login_insert before insert on public.hr_employees
  for each row execute function hr_private.employees_guard_login_insert();

-- Employee-ID accounts are activated / deactivated through hr-employee-login
-- (which also bans the Auth user and ends sessions), not this toggle.
create or replace function public.hr_set_portal_access(p_employee uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees;
begin
  if not hr_private.has_permission('employees.invite') then perform hr_private.fail('You are not allowed to change portal access.', 'forbidden'); end if;
  select * into v_emp from public.hr_employees where id = p_employee for update;
  if v_emp.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if v_emp.login_id is not null then
    perform hr_private.fail('This employee signs in with an Employee ID. Use the login controls to activate or deactivate it.', 'use_login_controls');
  end if;
  if p_enabled and v_emp.status in ('exited','archived') then
    perform hr_private.fail('Access cannot be enabled for an exited or archived employee.', 'invalid_state');
  end if;
  if p_enabled and v_emp.user_id is null then
    perform hr_private.fail('Create a login first; this employee has no linked account.', 'not_linked');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employees set portal_access = p_enabled where id = p_employee;
  perform set_config('hr.privileged_write', 'off', true);
end $$;

-- ---------------------------------------------------------------- HR pre-flight (caller's JWT)
-- Called by hr-employee-login with the CALLER's token before any service-role
-- action. p_action: create | reset | activate | deactivate.
create or replace function public.hr_can_manage_login(p_employee uuid, p_action text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp public.hr_employees; v_privileged boolean;
begin
  if not hr_private.has_permission('employees.manage_login') then
    perform hr_private.fail('You are not allowed to manage employee sign-in.', 'forbidden');
  end if;
  if p_action not in ('create','reset','activate','deactivate') then
    perform hr_private.fail('Unknown login action.', 'invalid');
  end if;
  select * into v_emp from public.hr_employees where id = p_employee;
  if v_emp.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if v_emp.user_id is not null and v_emp.user_id = auth.uid() then
    perform hr_private.fail('You cannot manage your own sign-in here.', 'forbidden');
  end if;
  -- Issuing a password for an account that holds HR / payroll / admin roles
  -- would let the issuer act with those roles: Super Admin only.
  v_privileged := v_emp.user_id is not null and exists (
    select 1 from public.hr_user_roles ur where ur.user_id = v_emp.user_id and ur.role_key not in ('employee','intern','manager'));
  if v_privileged and not hr_private.has_role('super_admin') then
    perform hr_private.fail('This account holds administrative roles; only a Super Admin can manage its sign-in.', 'forbidden');
  end if;

  if p_action = 'create' then
    if v_emp.user_id is not null then
      perform hr_private.fail('This employee already has a sign-in account. Existing accounts are not changed.', 'already_linked');
    end if;
    if v_emp.status in ('exited','archived') then
      perform hr_private.fail('Exited or archived employees cannot be given a login.', 'invalid_state');
    end if;
    if v_emp.employee_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
      perform hr_private.fail('This Employee ID contains characters that cannot be used to sign in.', 'invalid');
    end if;
    if exists (select 1 from auth.users u where lower(u.email) = hr_private.employee_login_email(v_emp.employee_code)) then
      perform hr_private.fail('A sign-in account for this Employee ID already exists. Contact a Super Admin.', 'already_exists');
    end if;
  else
    if v_emp.login_id is null then
      perform hr_private.fail(case when v_emp.user_id is null then 'This employee has no login yet.'
                                   else 'This employee signs in with email; Employee ID controls do not apply.' end,
                              'not_employee_login');
    end if;
    if p_action in ('reset','activate') and v_emp.status in ('exited','archived') then
      perform hr_private.fail('Exited or archived employees cannot sign in.', 'invalid_state');
    end if;
    if p_action = 'reset' and not v_emp.portal_access then
      perform hr_private.fail('Activate the login before issuing a new temporary password.', 'invalid_state');
    end if;
  end if;

  return jsonb_build_object(
    'employee_id', v_emp.id,
    'employee_code', v_emp.employee_code,
    'login_id', coalesce(v_emp.login_id::text, v_emp.employee_code),
    'login_email', hr_private.employee_login_email(coalesce(v_emp.login_id::text, v_emp.employee_code)),
    'user_id', v_emp.user_id,
    'portal_access', v_emp.portal_access,
    'caller', auth.uid());
end $$;

-- ---------------------------------------------------------------- service-role steps
create or replace function hr_private.require_service_role()
returns void language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform hr_private.fail('This operation is reserved for the employee login service.', 'forbidden');
  end if;
end $$;

-- After auth.admin.createUser: link the account and require a password change.
create or replace function public.hr_link_employee_login(p_employee uuid, p_user uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees; v_email text;
begin
  perform hr_private.require_service_role();
  select * into v_emp from public.hr_employees where id = p_employee for update;
  if v_emp.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if v_emp.user_id is not null then perform hr_private.fail('Employee is already linked to an account.', 'user_already_linked'); end if;
  if exists (select 1 from public.hr_employees where user_id = p_user) then
    perform hr_private.fail('That account is already linked to another employee.', 'user_already_linked');
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  if v_email is distinct from hr_private.employee_login_email(v_emp.employee_code) then
    perform hr_private.fail('The account does not match this Employee ID.', 'mismatch');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employees
     set user_id = p_user, login_id = v_emp.employee_code, portal_access = true,
         password_change_required = true, password_changed_at = null, credentials_issued_at = now()
   where id = p_employee;
  perform set_config('hr.privileged_write', 'off', true);
  insert into public.hr_user_roles (user_id, role_key, granted_by)
  values (p_user, case when v_emp.employment_type = 'intern' then 'intern' else 'employee' end, p_actor)
  on conflict do nothing;
  perform hr_private.audit_login_event(p_actor, 'EMPLOYEE_LOGIN_CREATED', p_employee,
    jsonb_build_object('user_id', p_user, 'login_id', v_emp.employee_code));
  return jsonb_build_object('employee_id', p_employee, 'login_id', v_emp.employee_code);
end $$;

-- BEFORE the Auth password is replaced: require a change, end all sessions,
-- clear any sign-in lockout. Done first so a failure afterwards can never
-- leave an HR-known password usable without a forced change.
create or replace function public.hr_begin_password_reset(p_employee uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees; n int;
begin
  perform hr_private.require_service_role();
  select * into v_emp from public.hr_employees where id = p_employee for update;
  if v_emp.id is null or v_emp.login_id is null or v_emp.user_id is null then
    perform hr_private.fail('This employee has no Employee ID login.', 'not_employee_login');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employees set password_change_required = true, credentials_issued_at = now() where id = p_employee;
  perform set_config('hr.privileged_write', 'off', true);
  n := hr_private.revoke_user_sessions(v_emp.user_id);
  delete from public.hr_login_attempts where user_id = v_emp.user_id;
  perform hr_private.audit_login_event(p_actor, 'EMPLOYEE_LOGIN_PASSWORD_RESET', p_employee,
    jsonb_build_object('user_id', v_emp.user_id, 'sessions_revoked', n));
  return jsonb_build_object('user_id', v_emp.user_id, 'login_id', v_emp.login_id, 'sessions_revoked', n);
end $$;

-- Activate / deactivate. Deactivation ends every session immediately; the
-- function also bans the Auth user so no new session can be created.
create or replace function public.hr_set_employee_login_active(p_employee uuid, p_enabled boolean, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees; n int := 0;
begin
  perform hr_private.require_service_role();
  select * into v_emp from public.hr_employees where id = p_employee for update;
  if v_emp.id is null or v_emp.login_id is null or v_emp.user_id is null then
    perform hr_private.fail('This employee has no Employee ID login.', 'not_employee_login');
  end if;
  if p_enabled and v_emp.status in ('exited','archived') then
    perform hr_private.fail('Exited or archived employees cannot sign in.', 'invalid_state');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employees set portal_access = p_enabled where id = p_employee;
  perform set_config('hr.privileged_write', 'off', true);
  if not p_enabled then n := hr_private.revoke_user_sessions(v_emp.user_id); end if;
  delete from public.hr_login_attempts where user_id = v_emp.user_id;
  perform hr_private.audit_login_event(p_actor,
    case when p_enabled then 'EMPLOYEE_LOGIN_ACTIVATED' else 'EMPLOYEE_LOGIN_DEACTIVATED' end, p_employee,
    jsonb_build_object('user_id', v_emp.user_id, 'sessions_revoked', n));
  return jsonb_build_object('user_id', v_emp.user_id, 'portal_access', p_enabled, 'sessions_revoked', n);
end $$;

-- The caller's Employee-ID login may change its own password only while the
-- account is active and the request comes from a session that still exists
-- (not one ended by a reset / deactivation / sign-out).
create or replace function hr_private.check_own_password_change(v_emp public.hr_employees, p_user uuid, p_session uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if v_emp.id is null or v_emp.login_id is null then
    perform hr_private.fail('Password changes here are for Employee ID accounts only.', 'not_employee_login');
  end if;
  if not v_emp.portal_access or v_emp.status in ('exited','archived','suspended') then
    perform hr_private.fail('Portal access for this account is disabled.', 'access_disabled');
  end if;
  if p_session is null or not exists (select 1 from auth.sessions s where s.id = p_session and s.user_id = p_user) then
    perform hr_private.fail('Your session has ended. Sign in again.', 'session_ended');
  end if;
end $$;

-- Which Employee-ID login a user may change their own password for.
create or replace function public.hr_own_login_for_password_change(p_user uuid, p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp public.hr_employees;
begin
  perform hr_private.require_service_role();
  select * into v_emp from public.hr_employees where user_id = p_user;
  perform hr_private.check_own_password_change(v_emp, p_user, p_session);
  return jsonb_build_object('employee_id', v_emp.id, 'login_id', v_emp.login_id,
                            'login_email', hr_private.employee_login_email(v_emp.login_id::text));
end $$;

-- AFTER the employee's new password was stored by Supabase Auth. Supabase
-- Auth's admin password update ends every session of the user (verified on
-- the dev project), so the session check happens in
-- hr_own_login_for_password_change() BEFORE the update, and here every
-- remaining session is revoked defensively; the app signs in again with the
-- new password.
drop function if exists public.hr_complete_own_password_change(uuid, uuid);
create or replace function public.hr_complete_own_password_change(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees; n int;
begin
  perform hr_private.require_service_role();
  select * into v_emp from public.hr_employees where user_id = p_user for update;
  if v_emp.id is null or v_emp.login_id is null then
    perform hr_private.fail('Password changes here are for Employee ID accounts only.', 'not_employee_login');
  end if;
  if not v_emp.portal_access or v_emp.status in ('exited','archived','suspended') then
    perform hr_private.fail('Portal access for this account is disabled.', 'access_disabled');
  end if;
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employees
     set password_change_required = false, password_changed_at = now(), activated_at = coalesce(activated_at, now())
   where id = v_emp.id;
  perform set_config('hr.privileged_write', 'off', true);
  n := hr_private.revoke_user_sessions(p_user);
  delete from public.hr_login_attempts where user_id = p_user;
  perform hr_private.audit_login_event(p_user, 'EMPLOYEE_LOGIN_PASSWORD_CHANGED', v_emp.id,
    jsonb_build_object('sessions_revoked', n, 'first_activation', v_emp.activated_at is null));
  return jsonb_build_object('employee_id', v_emp.id, 'sessions_revoked', n);
end $$;

-- ---------------------------------------------------------------- brute-force lockout
-- Supabase Auth "Password Verification Attempt" hook (Teams / Enterprise
-- plans). Inert until enabled in Dashboard > Authentication > Hooks.
-- Applies to Employee-ID accounts only; every other account gets the default
-- behaviour ('continue'). 5 failures within 15 minutes lock the account for
-- 15 minutes; HR "Reset password" / "Activate" clears the lock.
create table if not exists public.hr_login_attempts (
  user_id           uuid primary key,
  failed_count      int not null default 0,
  window_started_at timestamptz not null default now(),
  last_failed_at    timestamptz,
  locked_until      timestamptz
);
alter table public.hr_login_attempts enable row level security;
revoke all on table public.hr_login_attempts from anon, authenticated, public;

create or replace function public.hr_password_verification_hook(event jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_user uuid; v_valid boolean; v_row public.hr_login_attempts; v_is_staff boolean;
  c_max int := 5; c_window interval := interval '15 minutes'; c_lock interval := interval '15 minutes';
  c_msg text := 'Too many sign-in attempts. Try again in 15 minutes or contact HR.';
begin
  v_user := (event ->> 'user_id')::uuid;
  v_valid := coalesce((event ->> 'valid')::boolean, false);
  select lower(u.email) like '%@staff.zyllotech.com' into v_is_staff from auth.users u where u.id = v_user;
  if not coalesce(v_is_staff, false) then
    return jsonb_build_object('decision', 'continue');
  end if;
  select * into v_row from public.hr_login_attempts where user_id = v_user for update;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('decision', 'reject', 'message', c_msg, 'should_logout_user', false);
  end if;
  if v_valid then
    delete from public.hr_login_attempts where user_id = v_user;
    return jsonb_build_object('decision', 'continue');
  end if;
  insert into public.hr_login_attempts as a (user_id, failed_count, window_started_at, last_failed_at)
  values (v_user, 1, now(), now())
  on conflict (user_id) do update set
    failed_count      = case when a.window_started_at < now() - c_window then 1 else a.failed_count + 1 end,
    window_started_at = case when a.window_started_at < now() - c_window then now() else a.window_started_at end,
    last_failed_at    = now(),
    locked_until      = null
  returning * into v_row;
  if v_row.failed_count >= c_max then
    update public.hr_login_attempts set locked_until = now() + c_lock where user_id = v_user;
    return jsonb_build_object('decision', 'reject', 'message', c_msg, 'should_logout_user', false);
  end if;
  return jsonb_build_object('decision', 'continue');
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema public to supabase_auth_admin';
    execute 'grant select, insert, update, delete on table public.hr_login_attempts to supabase_auth_admin';
    execute 'grant execute on function public.hr_password_verification_hook(jsonb) to supabase_auth_admin';
    execute 'drop policy if exists hr_login_attempts_auth_admin on public.hr_login_attempts';
    execute 'create policy hr_login_attempts_auth_admin on public.hr_login_attempts for all to supabase_auth_admin using (true) with check (true)';
  end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.hr_password_verification_hook(jsonb) from anon, authenticated, public;

revoke execute on function
  hr_private.employee_login_email(text), hr_private.login_password_max_age_days(),
  hr_private.login_change_required(text, boolean, timestamptz), hr_private.session_is_live(),
  hr_private.revoke_user_sessions(uuid, uuid), hr_private.audit_login_event(uuid, text, uuid, jsonb),
  hr_private.require_service_role(), hr_private.check_own_password_change(public.hr_employees, uuid, uuid),
  hr_private.employees_guard_login_insert()
from anon, authenticated, public;

revoke execute on function public.hr_can_manage_login(uuid, text) from anon, public;
grant execute on function public.hr_can_manage_login(uuid, text) to authenticated;

revoke execute on function
  public.hr_link_employee_login(uuid, uuid, uuid), public.hr_begin_password_reset(uuid, uuid),
  public.hr_set_employee_login_active(uuid, boolean, uuid), public.hr_own_login_for_password_change(uuid, uuid),
  public.hr_complete_own_password_change(uuid)
from anon, authenticated, public;
grant execute on function
  public.hr_link_employee_login(uuid, uuid, uuid), public.hr_begin_password_reset(uuid, uuid),
  public.hr_set_employee_login_active(uuid, boolean, uuid), public.hr_own_login_for_password_change(uuid, uuid),
  public.hr_complete_own_password_change(uuid)
to service_role;

-- =====================================================================
-- 202 — Session validation for every employee-linked account
-- =====================================================================
-- Before: only Employee ID accounts (migration 200) lost access the moment
-- their Supabase session ended. Email-based employees, including those with
-- Manager / HR Admin / Payroll roles, kept HR data access and permissions
-- with an unexpired access token (up to 1 hour) after a sign-out, reset,
-- deactivation or exit revocation.
--
-- Now: for EVERY account linked to an employee record, the JWT's session_id
-- must still exist in auth.sessions, otherwise the account has no employee
-- identity, no roles and no permissions, and cannot read its own
-- notifications / role list / sign-in history / outbox rows.
--
-- Unchanged (by design):
--   * Website Admin (public.is_admin / admin_users) and every website policy
--     (none of them use hr_private helpers)
--   * HR / Super Admin accounts with NO employee record
--   * service role and anon (auth.uid() is null)
--   * Employee ID login + mandatory password change (migration 200)
--
-- Rollback switch (SQL editor only; no app role, not even service_role, can
-- change it):
--   update hr_private.security_flags set enabled = false
--    where key = 'employee_session_validation';
-- Turning it off restores the pre-202 behaviour for EMAIL-based employees
-- only; Employee ID accounts always keep the strict session check.
--
-- Also: security revocations end ALL sessions of the account (trigger):
-- portal access switched off, status -> suspended / exited / archived, or the
-- sign-in account unlinked. (Reset / deactivate / exit revocation already do.)
-- Depends on 200 (session_is_live, revoke_user_sessions). Re-runnable.
-- =====================================================================

-- ---------------------------------------------------------------- rollback switch
create table if not exists hr_private.security_flags (
  key        text primary key,
  enabled    boolean not null,
  note       text,
  updated_at timestamptz not null default now()
);
alter table hr_private.security_flags enable row level security;
revoke all on table hr_private.security_flags from public, anon, authenticated, service_role;
insert into hr_private.security_flags (key, enabled, note) values
  ('employee_session_validation', true,
   'Migration 202: employee-linked accounts need a live auth.sessions row. false = pre-202 behaviour for email-based employees (Employee ID accounts stay strict).')
on conflict (key) do nothing;

create or replace function hr_private.employee_session_validation_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.enabled from hr_private.security_flags f where f.key = 'employee_session_validation'), true)
$$;

-- ---------------------------------------------------------------- the check
-- These helpers run once per row inside RLS policies, so each does ONE
-- employee lookup and ONE session lookup, with no nested helper calls on the
-- normal path (performance-checked; see the 202 report).

-- session_id claim of the caller's JWT. Plain (non-definer, no SET) SQL so
-- Postgres can inline it into the queries below.
create or replace function hr_private.jwt_session_id()
returns uuid language sql stable as $$
  select case when c.sid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then c.sid::uuid end
  from (select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id' as sid) c
$$;

-- The session rule, computed for the caller:
--   * no signed-in user (service role / anon): true (not this check's concern)
--   * not linked to any employee (Website Admin, standalone HR/Super Admin): true (unchanged)
--   * JWT session_id exists in auth.sessions (and not past not_after): true
--   * rollback switch off and NOT an Employee ID account: true (pre-202 behaviour)
--   * otherwise false
-- Computed once per request (transaction) and cached in transaction-local
-- settings, keyed by the request's full JWT claims plus a revocation counter
-- that hr_private.revoke_user_sessions bumps. RLS evaluates these helpers once
-- per row, so without the cache every row would repeat the lookups. (Same
-- trust model as the existing hr.privileged_write setting: API clients cannot
-- set custom settings.)
create or replace function hr_private.caller_session_compute()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v boolean;
begin
  if auth.uid() is null then
    v := true;
  else
    select case when exists (select 1 from auth.sessions s where s.id = hr_private.jwt_session_id()
                               and s.user_id = e.user_id and (s.not_after is null or s.not_after > now())) then true
                when e.login_id is null then not hr_private.employee_session_validation_enabled()
                else false end
      into v
      from public.hr_employees e where e.user_id = auth.uid();
    v := coalesce(v, true);   -- no employee record
  end if;
  perform set_config('hr.session_key', coalesce(current_setting('request.jwt.claims', true), ''), true);
  perform set_config('hr.session_key_gen', coalesce(current_setting('hr.session_gen', true), ''), true);
  perform set_config('hr.session_ok', case when v then 't' else 'f' end, true);
  return v;
end $$;

-- Cached read (plain SQL, inlined into the helpers below; computes on a miss).
-- Two plain setting comparisons on a hit: same claims + same revocation counter.
create or replace function hr_private.caller_session_live()
returns boolean language sql stable as $$
  select case when current_setting('hr.session_key', true) = coalesce(current_setting('request.jwt.claims', true), '')
               and current_setting('hr.session_key_gen', true) = coalesce(current_setting('hr.session_gen', true), '')
              then current_setting('hr.session_ok', true) = 't'
              else hr_private.caller_session_compute() end
$$;

-- Public-facing name used by RLS policies and hr_me().
create or replace function hr_private.caller_session_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.caller_session_live()
$$;

-- Revocations bump the counter so a check later in the same request sees it.
create or replace function hr_private.revoke_user_sessions(p_user uuid, p_keep uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from auth.sessions where user_id = p_user and (p_keep is null or id <> p_keep);
  get diagnostics n = row_count;
  perform set_config('hr.session_gen', (coalesce(nullif(current_setting('hr.session_gen', true), ''), '0')::int + 1)::text, true);
  return n;
end $$;

-- ---------------------------------------------------------------- identity (redefined)
create or replace function hr_private.current_employee_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.hr_employees e
  where e.user_id = auth.uid()
    and e.portal_access
    and e.status not in ('exited','archived','suspended')
    and case when e.login_id is null then true
             else not hr_private.login_change_required(e.login_id::text, e.password_change_required, e.password_changed_at) end
    and hr_private.caller_session_live()
$$;

-- Revoked => no roles / permissions (has_permission, has_role, any_permission, hr_me).
-- Accounts without an employee record: never revoked here (unchanged).
create or replace function hr_private.caller_is_revoked()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select not e.portal_access
        or e.status in ('exited','archived','suspended')
        or case when e.login_id is null then false
                else hr_private.login_change_required(e.login_id::text, e.password_change_required, e.password_changed_at) end
        or not hr_private.caller_session_live()
    from public.hr_employees e where e.user_id = auth.uid()), false)
$$;

-- hr_me(): as in 200, plus session_ended so the app signs out cleanly
-- instead of showing "Access disabled".
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
    'session_ended', not hr_private.caller_session_ok(),
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

-- ---------------------------------------------------------------- direct user-id paths (RLS)
-- Policies that compare rows with auth.uid() directly instead of going
-- through the helpers above (found by auditing pg_policies).
drop policy if exists hr_notifications_read on public.hr_notifications;
create policy hr_notifications_read on public.hr_notifications for select to authenticated
  using (recipient_user_id = auth.uid() and hr_private.caller_session_ok());
drop policy if exists hr_notifications_mark_read on public.hr_notifications;
create policy hr_notifications_mark_read on public.hr_notifications for update to authenticated
  using (recipient_user_id = auth.uid() and hr_private.caller_session_ok())
  with check (recipient_user_id = auth.uid() and hr_private.caller_session_ok());

drop policy if exists hr_user_roles_read on public.hr_user_roles;
create policy hr_user_roles_read on public.hr_user_roles for select to authenticated
  using ((user_id = auth.uid() and hr_private.caller_session_ok())
         or hr_private.has_permission('roles.manage') or hr_private.has_permission('employees.view'));

drop policy if exists hr_login_events_read on public.hr_login_events;
create policy hr_login_events_read on public.hr_login_events for select to authenticated
  using ((user_id = auth.uid() and hr_private.caller_session_ok()) or hr_private.has_permission('audit.view'));

drop policy if exists hr_email_outbox_read on public.hr_email_outbox;
create policy hr_email_outbox_read on public.hr_email_outbox for select to authenticated
  using (hr_private.has_permission('settings.view') or (created_by = auth.uid() and hr_private.caller_session_ok()));

drop policy if exists hr_roles_read on public.hr_roles;
create policy hr_roles_read on public.hr_roles for select to authenticated
  using (auth.uid() is not null and hr_private.caller_session_ok());
drop policy if exists hr_permissions_read on public.hr_permissions;
create policy hr_permissions_read on public.hr_permissions for select to authenticated
  using (auth.uid() is not null and hr_private.caller_session_ok());
drop policy if exists hr_role_permissions_read on public.hr_role_permissions;
create policy hr_role_permissions_read on public.hr_role_permissions for select to authenticated
  using (auth.uid() is not null and hr_private.caller_session_ok());

-- ---------------------------------------------------------------- direct user-id paths (RPC)
-- The only public RPC that authorised by "proposer = auth.uid()" alone.
create or replace function public.hr_withdraw_leave_policy_change(p_change uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.hr_leave_policy_changes;
begin
  select * into c from public.hr_leave_policy_changes where id = p_change for update;
  if c.id is null or c.proposed_by is distinct from auth.uid() or hr_private.caller_is_revoked() then
    perform hr_private.fail('Policy change not found.', 'not_found');
  end if;
  if c.status <> 'pending' then perform hr_private.fail('Only pending changes can be withdrawn.', 'invalid_state'); end if;
  update public.hr_leave_policy_changes set status = 'withdrawn', decided_by = auth.uid(), decided_at = now() where id = c.id returning * into c;
  return to_jsonb(c);
end $$;

-- ---------------------------------------------------------------- security revocations end all sessions
create or replace function hr_private.employees_revoke_sessions_on_access_loss()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- account unlinked or replaced: end the old account's sessions
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    perform hr_private.revoke_user_sessions(old.user_id);
  end if;
  if new.user_id is not null and (
       (old.portal_access and not new.portal_access)
    or (new.status in ('suspended','exited','archived') and new.status is distinct from old.status)) then
    perform hr_private.revoke_user_sessions(new.user_id);
  end if;
  return null;
end $$;
drop trigger if exists hr_employees_revoke_sessions on public.hr_employees;
create trigger hr_employees_revoke_sessions after update of user_id, portal_access, status on public.hr_employees
  for each row execute function hr_private.employees_revoke_sessions_on_access_loss();

-- ---------------------------------------------------------------- grants
-- caller_session_ok() is used inside RLS policies, which run with the querying
-- user's privileges, so authenticated keeps EXECUTE (like has_permission). It
-- only answers a yes/no question about the caller's own session.
revoke execute on function hr_private.caller_session_ok() from anon, public;
grant execute on function hr_private.caller_session_ok() to authenticated;
revoke execute on function hr_private.employee_session_validation_enabled(),
  hr_private.employees_revoke_sessions_on_access_loss()
from anon, authenticated, public;
-- jwt_session_id() / caller_session_compute() / caller_session_live() are only
-- used inside the definer helpers (run as owner).
revoke execute on function hr_private.jwt_session_id(), hr_private.caller_session_compute(),
  hr_private.caller_session_live()
from anon, authenticated, public;

-- =====================================================================
-- 201 — Exit access revocation also ends the leaver's sessions
-- =====================================================================
-- hr-revoke-exit-access called auth.admin.signOut(user_id), but that Auth
-- API takes the USER'S ACCESS TOKEN, not a user id, so it silently did
-- nothing: the leaver's existing sessions (refresh tokens) survived the ban.
--
-- Least-privilege fix: the existing service-role-only step
-- hr_record_auth_access_revoked(p_exit) now deletes the leaver's rows in
-- auth.sessions (refresh tokens cascade) using hr_private.revoke_user_sessions
-- from migration 200. No new function, grant or permission; the user is
-- derived server-side from the exit case (never from request input), and the
-- caller has already passed hr_can_revoke_exit_access() with its own JWT.
--
-- Effect: refresh tokens stop working immediately. Employee ID accounts also
-- lose data access immediately (session_id check, migration 200). For email
-- accounts an already-issued access token can stay valid until it expires
-- (max 1 hour); portal data access for them ends at exit closure
-- (portal_access = false), unchanged.
-- Depends on: 200_hr_employee_login.sql. Re-runnable.
-- =====================================================================

create or replace function public.hr_record_auth_access_revoked(p_exit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits; v_user uuid; n int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform hr_private.fail('This operation is reserved for the access revocation service.', 'forbidden');
  end if;
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.status not in ('clearance','final_settlement','closed') then
    perform hr_private.fail('Access is revoked from the clearance stage onwards.', 'invalid_state');
  end if;
  -- End every session of the leaver's sign-in account (new in 201).
  v_user := hr_private.employee_user_id(v_x.employee_id);
  if v_user is not null then
    n := hr_private.revoke_user_sessions(v_user);
  end if;
  update public.hr_exits set auth_access_revoked_at = coalesce(auth_access_revoked_at, now()),
         access_revocation_status = case when access_revocation_status = 'exception' then 'exception' else 'revoked' end,
         access_revocation_error = null
   where id = v_x.id;
  update public.hr_exit_clearance_items
     set note = 'Sign-in access revoked by the access service at ' || to_char(now() at time zone hr_private.business_timezone(), 'YYYY-MM-DD HH24:MI')
   where exit_id = v_x.id and item_key = 'access_revocation' and status = 'pending';
  insert into public.hr_exit_access_revocations (exit_id, outcome, detail, actor_user_id)
  values (v_x.id, 'revoked', case when v_user is null then 'No sign-in account' else 'Sessions ended: ' || n end, auth.uid());
  perform hr_private.exit_log(v_x.id, 'auth_access_revoked', v_x.status, v_x.status, null);
end $$;

-- Unchanged privileges (re-asserted): service role only.
revoke execute on function public.hr_record_auth_access_revoked(uuid) from anon, public, authenticated;
grant execute on function public.hr_record_auth_access_revoked(uuid) to service_role;

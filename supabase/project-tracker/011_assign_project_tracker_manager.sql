-- =====================================================================
-- Zyllo Tech — Project Tracker: make a VERIFIED existing admin a Manager.
--
-- NOT APPLIED. Production role assignment: needs explicit approval.
-- Run in the live website project's SQL editor after 010 showed the account
-- is a confirmed, active website admin. It never creates a user, never
-- touches auth.users, passwords or user_roles, and never trusts the email
-- alone: it takes the authenticated user ID from 010, checks the ID and
-- email belong together, and asks the project's own is_admin() about that
-- ID server-side. Anything unexpected aborts with nothing changed.
--
-- EDIT the two values in the DO block (user ID from 010, expected email).
-- Undo: Project Tracker → Access → set the role back to Default, or
--   delete from public.pt_members where user_id = '<user id>';
-- =====================================================================

create or replace function pg_temp.pt_check_as(p_user uuid, p_email text) returns jsonb
language plpgsql as $$
declare v_admin boolean; v_role text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  v_admin := coalesce(public.is_admin(), false);
  v_role  := public.pt_role();
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return jsonb_build_object('is_admin', v_admin, 'pt_role', v_role);
end $$;

do $$
declare
  -- >>> EDIT: values from 010 (user_id column) and the account's email <<<
  c_user_id        constant uuid := 'PASTE-USER-ID-FROM-010';
  c_expected_email constant text := 'info@zyllotech.com';
  u      auth.users%rowtype;
  v_chk  jsonb;
begin
  if to_regclass('public.pt_members') is null then
    raise exception 'Project Tracker (001) is not installed on this project. Nothing was changed.';
  end if;
  select * into u from auth.users where id = c_user_id;
  if not found then
    raise exception 'No user with ID % exists. Nothing was changed.', c_user_id;
  end if;
  if lower(btrim(u.email)) is distinct from lower(btrim(c_expected_email)) then
    raise exception 'User ID % belongs to a different email than %. Nothing was changed.', c_user_id, c_expected_email;
  end if;
  if u.email_confirmed_at is null then
    raise exception 'The account email is not confirmed. Nothing was changed.';
  end if;
  if coalesce(u.banned_until > now(), false) or u.deleted_at is not null then
    raise exception 'The account is banned or deleted. Nothing was changed.';
  end if;

  v_chk := pg_temp.pt_check_as(u.id, u.email);
  if not (v_chk ->> 'is_admin')::boolean then
    raise exception 'This account is not a website admin according to public.is_admin(). Manager access was NOT granted.';
  end if;

  insert into public.pt_members (user_id, role, note, granted_by, granted_at)
  values (u.id, 'manager', 'Initial Project Tracker manager: verified website admin (011, SQL editor)', null, now())
  on conflict (user_id) do update set role = 'manager', note = excluded.note, granted_at = now();
  perform public.pt_log(null, 'member', u.id, null, 'member.role_changed',
                        jsonb_build_object('role', 'manager', 'via', '011_assign_project_tracker_manager.sql', 'admin_verified', true));

  v_chk := pg_temp.pt_check_as(u.id, u.email);
  if v_chk ->> 'pt_role' is distinct from 'manager' then
    raise exception 'Verification failed: Project Tracker role is % after the assignment. Rolled back.', v_chk ->> 'pt_role';
  end if;
  raise notice 'ok: % (%) is now a Project Tracker manager.', u.email, u.id;
end $$;

-- Result (re-checks server-side after the change).
select m.user_id, u.email, m.role as pt_members_role, m.granted_at,
       (pg_temp.pt_check_as(m.user_id, u.email) ->> 'is_admin')::boolean as is_admin_as_user,
       pg_temp.pt_check_as(m.user_id, u.email) ->> 'pt_role' as effective_pt_role
from public.pt_members m join auth.users u on u.id = m.user_id
where m.role = 'manager' order by m.granted_at desc;

-- =====================================================================
-- Zyllo Tech — Project Tracker: verify an EXISTING admin account (READ-ONLY).
--
-- NOT APPLIED. Run in the SQL editor of the live website project
-- (zfjeflpvwizlteflypsx — never the HRMS project) after 001–004.
-- It changes no table, user, password or role. It creates two temporary
-- helper functions (pg_temp, removed when the session ends) so it can ask
-- the project's OWN is_admin() — the exact check the admin area uses —
-- about that user ID, server-side.
--
-- Edit the email below if needed, run, and read the single result row:
--   matching_accounts  must be 1 (0 = no such login; >1 = investigate)
--   user_id            the authenticated user ID to use in 011
--   email_confirmed    must be true;  banned / deleted must be false
--   is_admin_as_user   must be true (the live is_admin() for this user ID)
--   current_pt_role    what Project Tracker grants today (editor by default)
-- =====================================================================

create or replace function pg_temp.pt_as_user(p_user uuid, p_email text) returns void
language plpgsql as $$
begin
  -- Same claims a signed-in browser session carries; local to this transaction.
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
end $$;

create or replace function pg_temp.pt_check_as(p_user uuid, p_email text) returns jsonb
language plpgsql as $$
declare v_admin boolean; v_role text;
begin
  if p_user is null then return null; end if;
  perform pg_temp.pt_as_user(p_user, p_email);
  v_admin := coalesce(public.is_admin(), false);
  v_role  := public.pt_role();
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return jsonb_build_object('is_admin', v_admin, 'pt_role', v_role);
end $$;

with params as (select lower(btrim('info@zyllotech.com')) as email),
matches as (select u.* from auth.users u, params p where lower(u.email) = p.email),
one as (select * from matches where (select count(*) from matches) = 1),
chk as (select o.id, pg_temp.pt_check_as(o.id, o.email) as r from one o)
select
  (select email from params)                                        as email_checked,
  (select count(*) from matches)                                    as matching_accounts,
  o.id                                                              as user_id,
  o.email_confirmed_at is not null                                  as email_confirmed,
  coalesce(o.banned_until > now(), false)                           as banned,
  o.deleted_at is not null                                          as deleted,
  o.last_sign_in_at,
  o.raw_app_meta_data -> 'providers'                                as sign_in_providers,
  (select string_agg(r.role::text, ', ') from public.user_roles r where r.user_id = o.id) as user_roles,
  (c.r ->> 'is_admin')::boolean                                     as is_admin_as_user,
  coalesce((select m.role from public.pt_members m where m.user_id = o.id), 'editor (default)') as current_pt_role_row,
  c.r ->> 'pt_role'                                                 as current_pt_role
from (select 1) x
left join one o on true
left join chk c on c.id = o.id;

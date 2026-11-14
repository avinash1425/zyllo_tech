-- =====================================================================
-- LOCAL TEST HARNESS ONLY. NEVER APPLY TO A REAL SUPABASE PROJECT.
-- Adapted from supabase/tests/hrms-local/local_harness.sql (HRMS branch).
-- Infrastructure for scripts/pt-local/api-server.mjs (a local stand-in for
-- PostgREST / GoTrue / Storage). Applied by scripts/pt-local/start.mjs on a
-- throwaway cluster after the shim, schema, policies, HR migrations and the
-- synthetic dev seed, and before local_fixtures.sql.
--
--   * role `authenticator` (LOGIN NOINHERIT, member of anon / authenticated /
--     service_role) — the API server connects as this role for every
--     user-scoped request, exactly like PostgREST, so it never holds owner
--     rights while serving the browser.
--   * pt_harness.exec(role, claims, sql) — switches to the request role, sets
--     request.jwt.claims (auth.uid() reads it), runs one generated statement
--     that returns a single jsonb value, and converts errors into
--     {code,message,details,hint} instead of aborting the psql session.
--   * pt_harness.passwords — scrypt hashes for synthetic test accounts only.
--   * pt_harness.fixture_files — storage objects whose bytes start.mjs writes.
-- =====================================================================

do $$ begin
  create role authenticator login noinherit;
exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists pt_harness;

-- ---------------------------------------------------------------- external sign-in ("--auth-upstream")
-- Accounts that sign in through an external Supabase Auth project. A reference row only (ID, email):
-- no password, no hash — such an account cannot sign in locally. is_admin = the external project's own
-- rpc/is_admin answer for that user's token, re-checked at every sign-in and token refresh.
create table if not exists pt_harness.upstream_identities (
  user_id      uuid primary key,
  email        text not null,
  upstream     text not null,
  is_admin     boolean not null,
  http_status  int,
  verified_at  timestamptz not null default now()
);
create or replace function pt_harness.record_upstream_identity(p_user uuid, p_email text, p_upstream text, p_admin boolean, p_status int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from pt_harness.passwords where user_id = p_user) then
    raise exception 'refusing: % is a local synthetic account', p_user;
  end if;
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
  values (p_user, p_email, now(), jsonb_build_object('provider', 'external', 'providers', jsonb_build_array('external'), 'upstream', p_upstream))
  on conflict (id) do update set email = excluded.email;
  insert into pt_harness.upstream_identities (user_id, email, upstream, is_admin, http_status, verified_at)
  values (p_user, p_email, p_upstream, p_admin, p_status, now())
  on conflict (user_id) do update set email = excluded.email, is_admin = excluded.is_admin, http_status = excluded.http_status, verified_at = now();
end $$;
revoke all on function pt_harness.record_upstream_identity(uuid, text, text, boolean, int) from public;
revoke all on schema pt_harness from public;
grant usage on schema pt_harness to authenticator;

-- Synthetic test passwords (scrypt, hashed in Node). Never exposed to API roles.
create table if not exists pt_harness.passwords (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  password_hash text not null,
  updated_at    timestamptz not null default now()
);
revoke all on pt_harness.passwords from public, anon, authenticated, service_role, authenticator;

-- Files referenced by fixture storage.objects rows; start.mjs writes their bytes.
create table if not exists pt_harness.fixture_files (
  bucket_id text not null,
  name      text not null,
  content   text not null,           -- 'pdf' | 'png' | free text
  primary key (bucket_id, name)
);
revoke all on pt_harness.fixture_files from public, anon, authenticated, service_role, authenticator;

create or replace function pt_harness.exec(p_role text, p_claims text, p_sql text)
returns jsonb
language plpgsql
as $fn$
declare
  v_result jsonb;
  v_state text; v_msg text; v_detail text; v_hint text;
begin
  if p_role not in ('anon', 'authenticated', 'service_role') then
    raise exception 'pt_harness.exec: role % is not allowed', p_role;
  end if;
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims, ''), true);
    perform set_config('role', p_role, true);
    perform set_config('statement_timeout', '30s', true);
    execute p_sql into v_result;
    return jsonb_build_object('data', v_result);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text,
                            v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    return jsonb_build_object('error', jsonb_build_object(
      'code', v_state, 'message', v_msg, 'details', nullif(v_detail, ''), 'hint', nullif(v_hint, '')));
  end;
end
$fn$;
revoke all on function pt_harness.exec(text, text, text) from public;
grant execute on function pt_harness.exec(text, text, text) to authenticator;

-- Used by generated mutation SQL when the client asked for a single object
-- (Accept: application/vnd.pgrst.object+json): raising rolls the write back,
-- like PostgREST does.
create or replace function pt_harness.require_single(p_count bigint) returns bigint
language plpgsql immutable as $$
begin
  if p_count is distinct from 1 then
    raise exception using errcode = 'P0001',
      message = 'JSON object requested, multiple (or no) rows returned',
      detail = format('The result contains %s rows', p_count), hint = 'PGRST116';
  end if;
  return p_count;
end $$;
grant execute on function pt_harness.require_single(bigint) to anon, authenticated, service_role;

-- Fixture helpers (owner only): act as a user inside a DO block, then return.
create or replace function pt_harness.act_as(p_email text) returns uuid
language plpgsql as $$
declare v uuid; v_sess uuid;
begin
  select id into v from auth.users where email = p_email;
  if v is null then raise exception 'pt_harness.act_as: no auth user %', p_email; end if;
  -- A live session, like a real sign-in (migration 202 requires it).
  select id into v_sess from auth.sessions where user_id = v order by created_at desc, id limit 1;
  if v_sess is null then insert into auth.sessions (user_id) values (v) returning id into v_sess; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', 'authenticated', 'aud', 'authenticated', 'email', p_email, 'session_id', v_sess)::text, true);
    perform set_config('role', 'authenticated', true);
  return v;
end $$;

create or replace function pt_harness.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    perform set_config('role', 'service_role', true);
end $$;

create or replace function pt_harness.act_as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'none', true);
end $$;
-- Switching back to the owner is called while impersonating, so API roles may
-- execute act_as_owner (RESET-style, harmless); the other two stay owner-only.
grant usage on schema pt_harness to anon, authenticated, service_role;
revoke all on function pt_harness.act_as(text), pt_harness.act_as_service() from public;
grant execute on function pt_harness.act_as_owner() to anon, authenticated, service_role;

-- Website-admin check for the local harness: the synthetic admin role (as before), or an external account
-- whose own Supabase project answered is_admin = true at its last sign-in / token refresh (--auth-upstream).
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin'::public.app_role)
      or exists (select 1 from pt_harness.upstream_identities i
                  where i.user_id = auth.uid() and i.is_admin and i.verified_at > now() - interval '75 minutes')
$$;

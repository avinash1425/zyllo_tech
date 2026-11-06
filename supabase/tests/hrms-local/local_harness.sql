-- =====================================================================
-- LOCAL TEST HARNESS ONLY. NEVER APPLY TO A REAL SUPABASE PROJECT.
-- Infrastructure for scripts/hrms-local/api-server.mjs (a local stand-in for
-- PostgREST / GoTrue / Storage). Applied by scripts/hrms-local/start.mjs on a
-- throwaway cluster after the shim, schema, policies, HR migrations and the
-- synthetic dev seed, and before local_fixtures.sql.
--
--   * role `authenticator` (LOGIN NOINHERIT, member of anon / authenticated /
--     service_role) — the API server connects as this role for every
--     user-scoped request, exactly like PostgREST, so it never holds owner
--     rights while serving the browser.
--   * hrms_local.exec(role, claims, sql) — switches to the request role, sets
--     request.jwt.claims (auth.uid() reads it), runs one generated statement
--     that returns a single jsonb value, and converts errors into
--     {code,message,details,hint} instead of aborting the psql session.
--   * hrms_local.passwords — bcrypt hashes for synthetic test accounts only.
--   * hrms_local.fixture_files — storage objects whose bytes start.mjs writes.
-- =====================================================================

do $$ begin
  create role authenticator login noinherit;
exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists hrms_local;
revoke all on schema hrms_local from public;
grant usage on schema hrms_local to authenticator;

-- Synthetic test passwords (bcrypt via pgcrypto). Never exposed to API roles.
create table if not exists hrms_local.passwords (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  password_hash text not null,
  updated_at    timestamptz not null default now()
);
revoke all on hrms_local.passwords from public, anon, authenticated, service_role, authenticator;

-- Files referenced by fixture storage.objects rows; start.mjs writes their bytes.
create table if not exists hrms_local.fixture_files (
  bucket_id text not null,
  name      text not null,
  content   text not null,           -- 'pdf' | 'png' | free text
  primary key (bucket_id, name)
);
revoke all on hrms_local.fixture_files from public, anon, authenticated, service_role, authenticator;

create or replace function hrms_local.exec(p_role text, p_claims text, p_sql text)
returns jsonb
language plpgsql
as $fn$
declare
  v_result jsonb;
  v_state text; v_msg text; v_detail text; v_hint text;
begin
  if p_role not in ('anon', 'authenticated', 'service_role') then
    raise exception 'hrms_local.exec: role % is not allowed', p_role;
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
revoke all on function hrms_local.exec(text, text, text) from public;
grant execute on function hrms_local.exec(text, text, text) to authenticator;

-- Used by generated mutation SQL when the client asked for a single object
-- (Accept: application/vnd.pgrst.object+json): raising rolls the write back,
-- like PostgREST does.
create or replace function hrms_local.require_single(p_count bigint) returns bigint
language plpgsql immutable as $$
begin
  if p_count is distinct from 1 then
    raise exception using errcode = 'P0001',
      message = 'JSON object requested, multiple (or no) rows returned',
      detail = format('The result contains %s rows', p_count), hint = 'PGRST116';
  end if;
  return p_count;
end $$;
grant execute on function hrms_local.require_single(bigint) to anon, authenticated, service_role;

-- Fixture helpers (owner only): act as a user inside a DO block, then return.
create or replace function hrms_local.act_as(p_email text) returns uuid
language plpgsql as $$
declare v uuid; v_sess uuid;
begin
  select id into v from auth.users where email = p_email;
  if v is null then raise exception 'hrms_local.act_as: no auth user %', p_email; end if;
  -- A live session, like a real sign-in (migration 202 requires it).
  select id into v_sess from auth.sessions where user_id = v order by created_at desc, id limit 1;
  if v_sess is null then insert into auth.sessions (user_id) values (v) returning id into v_sess; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', 'authenticated', 'aud', 'authenticated', 'email', p_email, 'session_id', v_sess)::text, true);
  perform set_config('hr.session_key', '', true);
  perform set_config('role', 'authenticated', true);
  return v;
end $$;

create or replace function hrms_local.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('hr.session_key', '', true);
  perform set_config('role', 'service_role', true);
end $$;

create or replace function hrms_local.act_as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('hr.session_key', '', true);
  perform set_config('role', 'none', true);
end $$;
-- Switching back to the owner is called while impersonating, so API roles may
-- execute act_as_owner (RESET-style, harmless); the other two stay owner-only.
grant usage on schema hrms_local to anon, authenticated, service_role;
revoke all on function hrms_local.act_as(text), hrms_local.act_as_service() from public;
grant execute on function hrms_local.act_as_owner() to anon, authenticated, service_role;

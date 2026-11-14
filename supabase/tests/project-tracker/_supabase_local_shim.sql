-- =====================================================================
-- LOCAL TEST ONLY. NEVER APPLY TO A REAL SUPABASE PROJECT.
-- Adapted from supabase/tests/hr/_supabase_local_shim.sql (HRMS branch) for
-- the Project Tracker tests (scripts/pt-local/db-test.mjs). No contrib
-- extensions (pgcrypto/citext are blocked on the dev PC); gen_random_uuid()
-- is core PostgreSQL. Emulates:
--   * roles anon / authenticated / service_role (service_role bypasses RLS)
--   * auth.users, auth.uid(), auth.role(), auth.jwt()
--   * storage.buckets, storage.objects, storage.foldername()
--   * Supabase's default privileges on schema public
-- Plus a `test` schema with impersonation and assertion helpers.
-- =====================================================================


do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants table privileges in public to the API roles by default;
-- RLS is what actually protects rows. Reproduce that so tests are honest.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------- auth
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until       timestamptz,
  created_at         timestamptz not null default now()
);
grant select on auth.users to service_role;
-- Columns real Supabase Auth has, used by the admin-verification scripts (010/011).
-- Local users count as confirmed unless a test says otherwise.
alter table auth.users add column if not exists email_confirmed_at timestamptz default now();
alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists last_sign_in_at timestamptz;
alter table auth.users add column if not exists raw_app_meta_data jsonb not null default '{"provider": "email", "providers": ["email"]}'::jsonb;

-- Sessions (subset of Supabase's auth.sessions) for the session_id checks in
-- migration 200, and the role Supabase Auth runs hooks as.
create table if not exists auth.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  not_after  timestamptz
);
do $$ begin create role supabase_auth_admin nologin noinherit; exception when duplicate_object then null; end $$;
grant usage on schema auth to supabase_auth_admin;
grant select on auth.users to supabase_auth_admin;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
$$;
create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', 'anon')
$$;
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- ------------------------------------------------------------- storage
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
create or replace function storage.filename(name text) returns text
language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
grant execute on function storage.foldername(text), storage.filename(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- test
create schema if not exists test;
grant usage on schema test to anon, authenticated, service_role;

-- Create an auth user (as the superuser running the tests).
create or replace function test.create_user(p_email text) returns uuid
language sql as $$
  insert into auth.users (email) values (p_email) returning id
$$;

-- A live session for the user, like a real Supabase sign-in: reuse the newest
-- existing row, or create one ("signs in again" after a revocation).
-- SECURITY DEFINER so it works while a test is impersonating someone.
create or replace function test.session_for(p_user uuid) returns uuid
language plpgsql security definer as $$
declare v uuid;
begin
  select id into v from auth.sessions where user_id = p_user order by created_at desc, id limit 1;
  if v is null then
    insert into auth.sessions (user_id) values (p_user) returning id into v;
  end if;
  return v;
end $$;

-- Impersonate a signed-in user for the rest of the transaction. Like every
-- Supabase access token, the claims carry the session_id (migration 202).
create or replace function test.as_user(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', test.session_for(p_user))::text, true);
  perform set_config('hr.session_key', '', true);   -- drop migration 202's per-request session cache
  perform set_config('role','authenticated', true);
end $$;

-- Impersonate with explicit claims (e.g. a token whose session has ended).
create or replace function test.as_claims(p_user uuid, p_session uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
  perform set_config('hr.session_key', '', true);   -- drop migration 202's per-request session cache
  perform set_config('role','authenticated', true);
end $$;

create or replace function test.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('hr.session_key', '', true);   -- drop migration 202's per-request session cache
  perform set_config('role','anon', true);
end $$;

create or replace function test.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('hr.session_key', '', true);   -- drop migration 202's per-request session cache
  perform set_config('role','service_role', true);
end $$;

-- Back to the superuser.
create or replace function test.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('hr.session_key', '', true);   -- drop migration 202's per-request session cache
  perform set_config('role','none', true);
end $$;

create or replace function test.ok(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'TEST FAILED: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

create or replace function test.eq(p_actual anyelement, p_expected anyelement, p_msg text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED: % (expected %, got %)', p_msg, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Expect a statement to fail. Optionally require the error message to contain p_like.
create or replace function test.throws(p_sql text, p_msg text, p_like text default null) returns void
language plpgsql as $$
declare
  v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'TEST FAILED: % (statement succeeded but should have failed)', p_msg;
  end if;
  if p_like is not null and position(lower(p_like) in lower(v_err)) = 0 then
    raise exception 'TEST FAILED: % (error "%" does not contain "%")', p_msg, v_err, p_like;
  end if;
  raise notice 'ok - % (rejected: %)', p_msg, v_err;
end $$;

-- Count rows a statement returns (used to prove RLS hides rows).
create or replace function test.count_rows(p_sql text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') s' into v;
  return v;
end $$;

-- ------------------------------------------------ live website admin model
-- Mirrors what the live (Lovable-managed) project exposes, per
-- src/integrations/supabase/types.ts: enum app_role, table user_roles,
-- has_role(_user_id, _role) and is_admin(). The live is_admin() body is not
-- in the repository; this emulation (admin role in user_roles) is the
-- documented Lovable pattern. Project Tracker only CALLS is_admin().
do $$ begin create type public.app_role as enum ('admin', 'moderator', 'user'); exception when duplicate_object then null; end $$;
create table if not exists public.user_roles (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role    public.app_role not null,
  unique (user_id, role)
);
alter table public.user_roles enable row level security;
create or replace function public.has_role(_user_id uuid, _role public.app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin'::public.app_role)
$$;

-- Fixture: auth user with optional website-admin role (+ email in the JWT).
create or replace function test.make_user(p_email text, p_admin boolean default false) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into auth.users (email) values (p_email) returning id into v;
  if p_admin then insert into public.user_roles (user_id, role) values (v, 'admin'); end if;
  return v;
end $$;

-- Impersonate with the email claim too (Supabase access tokens carry it).
create or replace function test.email_of(p_user uuid) returns text
language sql stable security definer as $$ select email from auth.users where id = p_user $$;

create or replace function test.as_user_email(p_user uuid) returns void
language plpgsql as $$
declare v_email text;
begin
  v_email := test.email_of(p_user);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'email', v_email, 'session_id', test.session_for(p_user))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Rows affected by an UPDATE/DELETE ... RETURNING statement.
create or replace function test.count_dml(p_sql text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  execute 'with t as (' || p_sql || ') select count(*) from t' into v;
  return v;
end $$;

grant execute on all functions in schema test to anon, authenticated, service_role;

-- =====================================================================
-- LOCAL TEST ONLY. NEVER APPLY TO A REAL SUPABASE PROJECT.
-- Emulates the parts of Supabase that the schema, policies and HR
-- migrations rely on, so they can be exercised on a throwaway Postgres
-- cluster (scripts/hr-db-test.mjs):
--   * roles anon / authenticated / service_role (service_role bypasses RLS)
--   * auth.users, auth.uid(), auth.role(), auth.jwt()
--   * storage.buckets, storage.objects, storage.foldername()
--   * Supabase's default privileges on schema public
-- Plus a `test` schema with impersonation and assertion helpers.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

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

-- Impersonate a signed-in user for the rest of the transaction.
create or replace function test.as_user(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function test.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

create or replace function test.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

-- Back to the superuser.
create or replace function test.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
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

-- Fixture: auth user + active, portal-enabled employee + roles. Runs as the
-- owner (call before test.as_user). Created lazily because hr_employees only
-- exists after migration 100.
create or replace function test.make_employee(
  p_email text, p_first text, p_manager uuid default null,
  p_roles text[] default array['employee'], p_type text default 'full_time',
  p_department uuid default null)
returns uuid language plpgsql as $$
declare v_user uuid; v_emp uuid; r text;
begin
  v_user := test.create_user(p_email);
  execute 'insert into public.hr_employees (first_name, last_name, company_email, manager_id, employment_type, department_id,
             user_id, portal_access, status, joining_date)
           values ($1, ''Test'', $2, $3, $4, $5, $6, true, ''active'', current_date - 400) returning id'
    into v_emp using p_first, p_email, p_manager, p_type, p_department, v_user;
  foreach r in array p_roles loop
    execute 'insert into public.hr_user_roles (user_id, role_key) values ($1, $2)' using v_user, r;
  end loop;
  return v_emp;
end $$;

-- SECURITY DEFINER so it resolves as the owner even while a test is
-- impersonating a user (otherwise RLS could make it silently return null and
-- turn "sees 0 rows" assertions into false passes).
create or replace function test.user_of(p_employee uuid) returns uuid
language plpgsql security definer as $$
declare v uuid;
begin
  execute 'select user_id from public.hr_employees where id = $1' into v using p_employee;
  return v;
end $$;

grant execute on all functions in schema test to anon, authenticated, service_role;

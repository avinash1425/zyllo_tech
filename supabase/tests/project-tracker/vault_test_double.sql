-- =====================================================================
-- LOCAL TEST ONLY — NOT ENCRYPTED — NEVER APPLY TO ANY REAL PROJECT.
--
-- A plaintext stand-in for the Supabase Vault API (vault.create_secret,
-- vault.update_secret, vault.secrets, vault.decrypted_secrets) so the
-- Project Tracker password functions' AUTHORIZATION, RE-AUTHENTICATION,
-- AUDIT, RATE-LIMIT and ISOLATION logic can be exercised locally. It
-- provides NO confidentiality and proves nothing about encryption.
-- pt_password_backend() reports 'test_double' while it is installed and the
-- UI shows a red "TEST DOUBLE — NOT ENCRYPTED" banner.
--
-- Refuses to install where the real Supabase Vault exists.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'Real Supabase Vault present: refusing to install the test double.';
  end if;
end $$;

create schema if not exists vault;
revoke all on schema vault from public, anon, authenticated;

create table if not exists vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text,
  secret      text not null,           -- PLAINTEXT (test double)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
revoke all on vault.secrets from public, anon, authenticated;

create or replace view vault.decrypted_secrets as
  select id, name, description, secret as decrypted_secret, created_at, updated_at from vault.secrets;
revoke all on vault.decrypted_secrets from public, anon, authenticated;

create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id
$$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
         description = coalesce(new_description, description), updated_at = now() where id = secret_id
$$;
-- Marker read by public.pt_password_backend().
create or replace function vault.pt_test_double() returns boolean language sql as $$ select true $$;
revoke all on all functions in schema vault from public, anon, authenticated;

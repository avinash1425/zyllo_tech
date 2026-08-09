-- Fixes the "Database error saving new user" bug.
--
-- Diagnosis: pg_trigger confirmed on_auth_user_created exists and is
-- attached to auth.users, but is DISABLED (tgenabled = 'D'). Because
-- Supabase reserves ownership of auth.users for its own internal role
-- (supabase_auth_admin), the SQL Editor's connection role cannot run
--   alter table auth.users enable trigger on_auth_user_created;
-- (fails with 42501: must be owner of table users) even though it CAN
-- run CREATE TRIGGER / DROP TRIGGER statements against that same table
-- (proven by 008_user_profiles.sql, which created this trigger
-- successfully the first time).
--
-- Fix: drop the trigger and recreate it from scratch. CREATE TRIGGER
-- always creates a trigger in the ENABLED state — there is no separate
-- "enable" step needed, so this sidesteps the permission error entirely.
--
-- Run in Supabase Dashboard > SQL Editor > New query.

begin;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

commit;

-- ---------------------------------------------------------------------
-- Verify it took — run this separately after the block above commits:
--
--   select tgname, tgrelid::regclass, tgenabled
--   from pg_trigger
--   where tgname = 'on_auth_user_created';
--
-- tgenabled should now read 'O' (origin — meaning enabled), not 'D'.
-- ---------------------------------------------------------------------

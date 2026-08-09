-- Removes the on_auth_user_created trigger for good.
--
-- Full diagnosis, across three attempts:
--   1. Trigger existed but was disabled (tgenabled = 0) — cause unknown,
--      Supabase's auth service appears to disable custom triggers on
--      auth.users on its own.
--   2. Recreated it fresh (009_fix_disabled_trigger.sql) — came back
--      disabled again immediately.
--   3. Auth logs during a real signup attempt showed error 42P01
--      ("undefined table") immediately followed by 25P02 (transaction
--      aborted) — the trigger function's `insert into profiles` (no
--      schema prefix) fails because the role executing it
--      (supabase_auth_admin) doesn't have `public` on its search_path,
--      so it can't resolve the unqualified table name. This makes EVERY
--      signup fail at the database level with "Database error saving
--      new user", regardless of the trigger's enabled/disabled state.
--
-- Rather than keep fighting Supabase's auth-service internals, the app
-- no longer depends on this trigger at all: src/app/signup/actions.js
-- now inserts the profiles row directly, in application code, using the
-- secret-key server client, right after auth.signUp() succeeds. That
-- code runs under our own role, not supabase_auth_admin, so it isn't
-- subject to the same search_path problem.
--
-- This migration just removes the now-redundant (and actively harmful)
-- trigger and function so nothing on auth.users can interfere with
-- signups going forward.
--
-- Run in Supabase Dashboard > SQL Editor > New query.

begin;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

commit;

-- Reverts the customer sign-up / role system added in
-- 008_user_profiles.sql. The feature is being rolled back — login goes
-- back to admin-only, exactly as it worked before that migration.
--
-- The on_auth_user_created trigger and handle_new_user() function were
-- already dropped in 010_remove_broken_trigger.sql (they were the root
-- cause of "Database error saving new user" — Supabase's auth service
-- couldn't resolve the unqualified `profiles` table name from inside
-- the trigger). This migration finishes the cleanup by dropping the
-- profiles table itself.
--
-- Safe to run even though 010 already ran — this only touches the
-- profiles table, which 010 didn't touch.
--
-- Run in Supabase Dashboard > SQL Editor > New query.

begin;

drop table if exists profiles cascade;

commit;

-- Adds a role concept that doesn't exist anywhere in the schema today —
-- every successful login is currently treated identically (see
-- src/app/login/actions.js's signIn, which always redirects to /admin
-- regardless of who logged in). This migration introduces two account
-- types: 'admin' (existing staff behavior, unchanged) and 'customer'
-- (new — public sign-up, public pages only, blocked from /admin).
--
-- auth.users itself is a Supabase-managed table and isn't meant to be
-- altered with arbitrary app columns. The standard pattern is a sibling
-- `profiles` table keyed 1:1 to auth.users.id, kept in sync via a
-- trigger so application code never has to remember to create a profile
-- row after signup.
--
-- Run in Supabase Dashboard > SQL Editor > New query.

begin;

-- 1. profiles table — one row per auth.users row, same id.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('admin', 'customer')),
  created_at timestamptz not null default now()
);

-- 2. Auto-create a profile row whenever a new auth.users row appears.
--    Defaults to 'customer' — nothing in the public sign-up form (or
--    this trigger) can create an 'admin' row. Promoting an account to
--    admin is a manual step: run
--      update profiles set role = 'admin' where id = '<user-id>';
--    directly in the SQL editor.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, role) values (new.id, 'customer');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 3. Backfill profile rows for any accounts that already exist (e.g. the
--    admin account(s) created before this migration ran). Existing rows
--    default to 'customer' here — the one exception is handled in step 4
--    below by name, since this migration can't know which existing
--    email(s) are meant to be staff.
insert into profiles (id, role)
select id, 'customer' from auth.users
where id not in (select id from profiles);

-- 4. RLS: a logged-in user can read only their own profile row (needed
--    for the app to look up "am I admin or customer" using the visitor's
--    own session — not the secret-key server client). No insert/update/
--    delete policy is granted here on purpose; role changes go through
--    the SQL editor directly, not through the app.
alter table profiles enable row level security;

drop policy if exists "Users can read own profile" on profiles;
create policy "Users can read own profile"
  on profiles for select
  using (auth.uid() = id);

commit;

-- ---------------------------------------------------------------------
-- MANUAL STEP (not run automatically by this migration):
-- After running the above, promote your existing admin account(s) by
-- email. Replace the address below with the real admin login email(s)
-- and run this separately:
--
--   update profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'admin@example.com');
-- ---------------------------------------------------------------------

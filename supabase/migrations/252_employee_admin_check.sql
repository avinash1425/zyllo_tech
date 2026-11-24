-- 252: Employee Portal — "is this account an admin?" works with either admin model.
--
-- The dev database keeps admins in public.admin_users; the live (Lovable) website database may use
-- public.user_roles (role 'admin') instead. ep_admin_create_employee refused to link an admin account
-- by reading admin_users directly, which fails where that table does not exist.
--   ep_user_is_admin(user) -> true when the user is in admin_users (if that table exists) or has the
--     'admin' role in user_roles (if that table exists). Internal: not callable by app users.
--   ep_admin_create_employee: same as migration 250, only that check now uses ep_user_is_admin.
-- Rollback: supabase/rollbacks/252_rollback_employee_admin_check.sql

begin;

create or replace function public.ep_user_is_admin(p_user uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_found boolean := false;
begin
  if p_user is null then
    return false;
  end if;
  if to_regclass('public.admin_users') is not null then
    execute 'select exists (select 1 from public.admin_users where user_id = $1)' into v_found using p_user;
    if v_found then
      return true;
    end if;
  end if;
  if to_regclass('public.user_roles') is not null then
    execute 'select exists (select 1 from public.user_roles where user_id = $1 and role::text = ''admin'')' into v_found using p_user;
  end if;
  return coalesce(v_found, false);
end $$;
revoke all on function public.ep_user_is_admin(uuid) from public, anon, authenticated;

create or replace function public.ep_admin_create_employee(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'reporting_manager_name', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if public.ep_user_is_admin(v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if public.ep_password_problem(v_password) is not null then
      raise exception 'Temporary password: %', public.ep_password_problem(v_password) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  -- A new login with a temporary password must be changed at the first sign-in.
  insert into public.ep_employees (user_id, employee_code, full_name, must_change_password)
  values (v_user, v_code, v_name, not v_linked)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked);
end $$;

notify pgrst, 'reload schema';

commit;

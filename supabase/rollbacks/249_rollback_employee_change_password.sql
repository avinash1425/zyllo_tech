-- Rollback of 249_employee_change_password.sql: restores ep_me (233) and ep_admin_create_employee (240),
-- drops the password functions and the must_change_password column. Passwords already changed stay changed.
begin;
create or replace function public.ep_me()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_emp uuid;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    return null;
  end if;
  perform public.ep_close_overdue_sessions(v_emp);
  return (
    select jsonb_build_object(
      'employee_id',   e.id,
      'employee_code', e.employee_code,
      'full_name',     e.full_name,
      'open_session',  (
        select jsonb_build_object('id', a.id, 'punch_in_at', a.punch_in_at, 'work_date', a.work_date,
                                  'auto_punch_out_at', public.ep_auto_punch_out_at(a.work_date, a.punch_in_at))
        from public.ep_attendance a
        where a.employee_id = e.id and a.punch_out_at is null
      ),
      'last_session',  (
        select jsonb_build_object('id', a.id, 'punch_in_at', a.punch_in_at, 'punch_out_at', a.punch_out_at,
                                  'auto_punched_out', a.auto_punched_out)
        from public.ep_attendance a
        where a.employee_id = e.id and a.punch_out_at is not null
        order by a.punch_out_at desc limit 1
      )
    )
    from public.ep_employees e
    where e.id = v_emp
  );
end $$;

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
                 'reporting_manager_id', 'date_of_joining', 'employment_type', 'work_location') then
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
    if exists (select 1 from public.admin_users where user_id = v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if length(v_password) < 8 or length(v_password) > 72 then
      raise exception 'Temporary password must be 8-72 characters.' using errcode = '22023';
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

  insert into public.ep_employees (user_id, employee_code, full_name)
  values (v_user, v_code, v_name)
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

drop function if exists public.ep_change_my_password(text);
drop function if exists public.ep_password_problem(text);
alter table public.ep_employees drop column if exists must_change_password;
notify pgrst, 'reload schema';
commit;

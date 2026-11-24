-- Rollback of 268_welcome_email.sql: no welcome emails / bounce checks; admin-area users no longer must change
-- the one-time password.
begin;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'rbac-welcome-check';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.ep_admin_create_employee(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform public.rbac_require('portal.employees.create'); -- rbac
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
  -- Employees sign in with their own real email (migration 267).
  if not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
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
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_create_user(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name  text := nullif(btrim(coalesce(p ->> 'full_name', '')), '');
  v_pw    text := coalesce(p ->> 'password', '');
  v_roles text[] := coalesce((select array_agg(distinct r) from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r), '{}');
  v_user  uuid;
  v_bad   text;
begin
  perform public.rbac_require('settings.users.create');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  -- Only Super Admin / Admin may use an email that is not a real mailbox (migration 267).
  if exists (select 1 from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r where r not in ('super_admin', 'admin'))
     and not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if cardinality(v_roles) <> 1 then
    raise exception 'Choose one role (a person has one role at a time).' using errcode = '22023';
  end if;
  select r into v_bad from unnest(v_roles) r
   where r not in (select key from public.rbac_roles where area = 'admin') limit 1;
  if v_bad is not null then
    raise exception 'Only admin-area roles can be given here (Super Admin, Admin, HR).' using errcode = '22023';
  end if;
  if 'super_admin' = any (v_roles)
     and not exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin') then
    raise exception 'Only a Super Admin can give the Super Admin role.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rbac_create_user:' || v_email, 0));
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.rbac_user_roles where user_id = v_user)
       or exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already has an account. Change its roles in the list instead.' using errcode = '23505';
    end if;
  else
    if public.ep_password_problem(v_pw) is not null then
      raise exception 'Password: %', public.ep_password_problem(v_pw) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_user::text, v_user,
            jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
  end if;
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select v_user, r, auth.uid() from unnest(v_roles) r on conflict do nothing;
  return v_user;
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_my_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_roles text[] := public.rbac_roles_of(auth.uid());
  v_super boolean := 'super_admin' = any (public.rbac_roles_of(auth.uid()));
begin
  if v_uid is null then
    return jsonb_build_object('roles', '[]'::jsonb, 'permissions', '[]'::jsonb, 'is_admin', false, 'is_super_admin', false);
  end if;
  return jsonb_build_object(
    'is_super_admin', v_super,
    'is_admin', public.rbac_user_has_admin_pages(v_uid),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'area', r.area) order by r.sort_order)
                         from public.rbac_roles r where r.key = any (v_roles)), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(p.key order by p.sort_order) from public.rbac_permissions p
                              where v_super or exists (select 1 from public.rbac_role_permissions rp
                                                        where rp.permission_key = p.key and rp.role_key = any (v_roles))),
                            '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_my_change_password(p_current text, p_new text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_hash text;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;
  select encrypted_password into v_hash from auth.users where id = v_uid;
  if v_hash is null or v_hash = '' or extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    perform pg_sleep(1); -- slows down guessing
    raise exception 'Your current password is not correct.' using errcode = '22023';
  end if;
  if public.ep_password_problem(p_new) is not null then
    raise exception 'New password: %', public.ep_password_problem(p_new) using errcode = '22023';
  end if;
  if p_new = p_current then
    raise exception 'The new password must be different from the current one.' using errcode = '22023';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = now()
   where id = v_uid;
  update public.ep_employees set must_change_password = false where user_id = v_uid and must_change_password;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_employee_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id',              e.id,
    'employee_code',   e.employee_code,
    'full_name',       e.full_name,
    'work_email',      u.email,
    'department',      e.department,
    'designation',     e.designation,
    'date_of_joining', e.date_of_joining,
    'employment_type', e.employment_type,
    'work_location',   e.work_location,
    'is_active',       e.is_active,
    'created_at',      e.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'manager', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'full_name', m.full_name, 'employee_code', m.employee_code,
      'designation', m.designation, 'is_active', m.is_active) end,
    'manager_name', case when m.id is null then e.reporting_manager_name end,
    'admin_approver', case when e.admin_approver_id is not null then jsonb_build_object('user_id', e.admin_approver_id,
                         'name', public.ep_user_display_name(e.admin_approver_id)) end,
    'reports_count', (select count(*) from public.ep_employees r where r.reporting_manager_id = e.id),
    'punched_in', exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
  )
  from public.ep_employees e
  left join auth.users u on u.id = e.user_id
  left join public.ep_employees m on m.id = e.reporting_manager_id
  where e.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_users()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('settings.users.view');
  return coalesce((
    select jsonb_agg(x.j order by x.ord, x.nm) from (
      select (case when exists (select 1 from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                 where ur.user_id = u.id and r.area = 'admin') then 0 else 1 end) as ord,
             lower(coalesce(e.full_name, u.raw_user_meta_data ->> 'full_name', u.email)) as nm,
             jsonb_build_object(
               'user_id', u.id,
               'sign_in', u.email,
               'full_name', coalesce(e.full_name, nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
               'employee_id', e.id, 'employee_code', e.employee_code, 'employee_active', e.is_active,
               'roles', coalesce((select jsonb_agg(ur.role_key order by r.sort_order)
                                    from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                   where ur.user_id = u.id), '[]'::jsonb),
               'last_sign_in_at', u.last_sign_in_at, 'created_at', u.created_at,
               'is_self', u.id = auth.uid()) as j
        from auth.users u
        left join public.ep_employees e on e.user_id = u.id
       where e.id is not null or exists (select 1 from public.rbac_user_roles ur where ur.user_id = u.id)) x),
    '[]'::jsonb);
end $function$;

drop function if exists public.rbac_admin_change_email(uuid, text);
drop function if exists public.rbac_check_welcome_emails();
drop function if exists public.rbac_welcome_json(uuid);
drop function if exists public.rbac_queue_welcome(uuid, text, text, text, text);
drop function if exists public.rbac_one_time_password();
drop function if exists public.rbac_email_ready();
drop table if exists public.rbac_user_flags;
drop table if exists public.rbac_welcome_emails;
notify pgrst, 'reload schema';
commit;

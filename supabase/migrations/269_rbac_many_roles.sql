-- 269: Several roles per person + a role switcher.
--   * A person may have more than one role (e.g. HR and Manager). The unique "one role per person" index of
--     migration 263 is dropped. What a person may do = everything their roles allow together (the database
--     keeps checking every action).
--   * Every active Employee Portal account also has the Employee role, whatever other roles it has, so an
--     HR / Admin who is an employee can still punch in, apply for leave and send daily reports.
--   * rbac_my_access() returns each role with its own permissions: the top-bar switcher shows the pages of
--     one role at a time without signing out (punch-in is not touched).
--   * Add user / Users & Roles accept several roles; change-email works with several roles.
-- Safe to run again. Rollback: supabase/rollbacks/269_rollback_rbac_many_roles.sql

begin;

insert into public.rbac_backup (kind, name, definition)
select 'function269', f, pg_get_functiondef(f::regprocedure)
  from (values ('public.rbac_roles_of(uuid)'), ('public.rbac_my_access()'), ('public.rbac_admin_set_user_roles(uuid,text[])'),
               ('public.rbac_admin_create_user(jsonb)'), ('public.rbac_admin_change_email(uuid,text)')) v(f)
on conflict do nothing;

drop index if exists public.rbac_user_roles_one_per_user;

-- The roles of a user: the ones given on Users & Roles, plus Employee for an active portal account.
create or replace function public.rbac_roles_of(p_user uuid)
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array(select ur.role_key from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                         where ur.user_id = p_user order by r.sort_order), '{}'::text[])
      || case when exists (select 1 from public.ep_employees e where e.user_id = p_user and e.is_active)
                   and not exists (select 1 from public.rbac_user_roles ur where ur.user_id = p_user and ur.role_key = 'employee')
              then array['employee'] else '{}'::text[] end;
$$;
revoke all on function public.rbac_roles_of(uuid) from public, anon, authenticated;

update public.rbac_roles set description = 'Everyone with an Employee Portal account (also when they have other roles).' where key = 'employee';

CREATE OR REPLACE FUNCTION public.rbac_admin_set_user_roles(p_user uuid, p_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_new   text[] := coalesce((select array_agg(distinct r) from unnest(coalesce(p_roles, '{}')) r), '{}');
  v_old   text[];
  v_super boolean := public.rbac_user_can(auth.uid(), 'settings.users.edit')
                     and exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
  v_bad   text;
begin
  perform public.rbac_require('settings.users.edit');
  if p_user = auth.uid() then
    raise exception 'You cannot change your own roles. Ask another Super Admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  select r into v_bad from unnest(v_new) r where r not in (select key from public.rbac_roles) limit 1;
  if v_bad is not null then
    raise exception 'Unknown role %.', v_bad using errcode = '22023';
  end if;
  -- Several roles per person (migration 269). "Employee" is implicit for every active Employee Portal account.
  if 'employee' = any (v_new) then
    if not exists (select 1 from public.ep_employees where user_id = p_user) then
      raise exception 'Employee is only for Employee Portal accounts.' using errcode = '22023';
    end if;
    v_new := array_remove(v_new, 'employee');
  end if;
  if cardinality(v_new) = 0 and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Choose a role.' using errcode = '22023';
  end if;
  -- HR, Manager, Team Lead and Employee need a real email (migration 267); Super Admin / Admin do not.
  if (exists (select 1 from unnest(v_new) r where r not in ('super_admin', 'admin'))
      or exists (select 1 from public.ep_employees where user_id = p_user))
     and not public.ep_email_is_real((select email from auth.users where id = p_user)) then
    raise exception 'Use the person''s real email address: % cannot receive email.', (select email from auth.users where id = p_user) using errcode = '22023';
  end if;
  if (('manager' = any (v_new)) or ('team_lead' = any (v_new)))
     and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Manager and Team Lead are for Employee Portal accounts.' using errcode = '22023';
  end if;
  select coalesce(array_agg(role_key), '{}') into v_old from public.rbac_user_roles where user_id = p_user;
  if (('super_admin' = any (v_new)) <> ('super_admin' = any (v_old))) and not v_super then
    raise exception 'Only a Super Admin can give or remove the Super Admin role.' using errcode = '42501';
  end if;
  delete from public.rbac_user_roles where user_id = p_user and role_key <> all (v_new);
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select p_user, r, auth.uid() from unnest(v_new) r on conflict do nothing;
  if not exists (select 1 from public.rbac_user_roles where role_key = 'super_admin') then
    raise exception 'There must always be at least one Super Admin.' using errcode = '22023';
  end if;
  return to_jsonb(coalesce((select array_agg(role_key order by role_key) from public.rbac_user_roles where user_id = p_user), '{}'));
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
  if cardinality(v_roles) < 1 then
    raise exception 'Choose at least one role.' using errcode = '22023';
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
    -- One-time password: emailed (migration 268) and changed at the first sign-in.
    insert into public.rbac_user_flags (user_id, must_change_password) values (v_user, true)
    on conflict (user_id) do update set must_change_password = true;
    perform public.rbac_queue_welcome(v_user, v_email, v_name, v_pw, 'welcome');
  end if;
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select v_user, r, auth.uid() from unnest(v_roles) r on conflict do nothing;
  return v_user;
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_change_email(p_user uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_emp   public.ep_employees;
  v_role  text;
  v_name  text;
  v_pw    text := public.rbac_one_time_password();
  v_state text;
begin
  select * into v_emp from public.ep_employees where user_id = p_user;
  if v_emp.id is not null then
    perform public.rbac_require_any(array['portal.employees.edit', 'settings.users.edit']);
  else
    perform public.rbac_require('settings.users.edit');
  end if;
  if p_user = auth.uid() then
    raise exception 'Change your own email is not possible here.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  -- Several roles (migration 269): the highest one decides.
  select ur.role_key into v_role from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
   where ur.user_id = p_user order by r.sort_order limit 1;
  if v_role = 'super_admin' and not public.ep_is_super_admin() then
    raise exception 'Only a Super Admin can change a Super Admin''s email.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  if (coalesce(v_role, 'employee') not in ('super_admin', 'admin')
      or exists (select 1 from public.rbac_user_roles where user_id = p_user and role_key not in ('super_admin', 'admin'))
      or v_emp.id is not null)
     and not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id <> p_user) then
    raise exception 'This email already belongs to another account.' using errcode = '23505';
  end if;
  update auth.users
     set email = v_email, encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
   where id = p_user;
  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_email), updated_at = now()
   where user_id = p_user and provider = 'email';
  if v_emp.id is not null then
    update public.ep_employees set must_change_password = true, updated_at = now() where id = v_emp.id;
  else
    insert into public.rbac_user_flags (user_id, must_change_password) values (p_user, true)
    on conflict (user_id) do update set must_change_password = true;
  end if;
  v_name := public.ep_user_display_name(p_user);
  v_state := public.rbac_queue_welcome(p_user, v_email, v_name, v_pw, 'resend');
  return jsonb_build_object('email', v_email, 'welcome', v_state,
                            'password', case when v_state = 'not_configured' then v_pw end);
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
    'must_change_password', coalesce((select f.must_change_password from public.rbac_user_flags f where f.user_id = v_uid), false),
    'is_admin', public.rbac_user_has_admin_pages(v_uid),
    -- Each role with its own permissions: the top-bar role switcher shows one role at a time (migration 269).
    'roles', coalesce((select jsonb_agg(jsonb_build_object(
                         'key', r.key, 'name', r.name, 'area', r.area,
                         'permissions', case when r.key = 'super_admin'
                           then (select coalesce(jsonb_agg(p.key order by p.sort_order), '[]'::jsonb) from public.rbac_permissions p)
                           else (select coalesce(jsonb_agg(p.key order by p.sort_order), '[]'::jsonb) from public.rbac_permissions p
                                  join public.rbac_role_permissions rp on rp.permission_key = p.key and rp.role_key = r.key) end,
                         'admin_pages', r.key = 'super_admin' or exists (select 1 from public.rbac_role_permissions rp join public.rbac_permissions p on p.key = rp.permission_key
                                                                         where rp.role_key = r.key and p.area = 'admin'),
                         'portal_features', exists (select 1 from public.rbac_role_permissions rp join public.rbac_permissions p on p.key = rp.permission_key
                                                     where rp.role_key = r.key and p.area <> 'admin'))
                       order by r.sort_order)
                         from public.rbac_roles r where r.key = any (v_roles)), '[]'::jsonb),
    'is_employee', exists (select 1 from public.ep_employees e where e.user_id = v_uid and e.is_active),
    'permissions', coalesce((select jsonb_agg(p.key order by p.sort_order) from public.rbac_permissions p
                              where v_super or exists (select 1 from public.rbac_role_permissions rp
                                                        where rp.permission_key = p.key and rp.role_key = any (v_roles))),
                            '[]'::jsonb));
end $function$;

revoke all on function public.rbac_my_access() from public, anon;
grant execute on function public.rbac_my_access() to authenticated;

select '269: several roles per person' as step,
       not exists (select 1 from pg_indexes where indexname = 'rbac_user_roles_one_per_user') as ok;

commit;

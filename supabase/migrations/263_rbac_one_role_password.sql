-- 263: One role per person + "change my password" from My profile.
--   * Each person has exactly ONE role. An Employee Portal account without another role is "Employee".
--     People who had several roles keep the highest one (Super Admin > Admin > HR > Manager > Team Lead);
--     the removed ones are saved in rbac_backup for the rollback. A unique index keeps it that way.
--   * Manager and Team Lead are still employees: they get the Employee Portal features the Employee role
--     has (first run only; editable in Roles & Permissions).
--   * rbac_my_change_password(current, new): anyone signed in (admin area or Employee Portal) changes their
--     own password after confirming the current one; same rules as the employee passwords.
-- Safe to run again. Rollback: supabase/rollbacks/263_rollback_rbac_one_role_password.sql

begin;

-- ================================================================ one role per person
insert into public.rbac_backup (kind, name, definition)
select 'roles263', 'removed extra roles', coalesce(jsonb_agg(to_jsonb(ur)), '[]'::jsonb)::text
  from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
 where exists (select 1 from public.rbac_user_roles ur2 join public.rbac_roles r2 on r2.key = ur2.role_key
                where ur2.user_id = ur.user_id and r2.sort_order < r.sort_order)
on conflict do nothing;
delete from public.rbac_user_roles ur using public.rbac_roles r
 where r.key = ur.role_key
   and exists (select 1 from public.rbac_user_roles ur2 join public.rbac_roles r2 on r2.key = ur2.role_key
                where ur2.user_id = ur.user_id and r2.sort_order < r.sort_order);
create unique index if not exists rbac_user_roles_one_per_user on public.rbac_user_roles (user_id);

-- The role of a user: the one given on Users & Roles, else Employee for an active portal account.
create or replace function public.rbac_roles_of(p_user uuid)
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select array[ur.role_key] from public.rbac_user_roles ur where ur.user_id = p_user limit 1),
    case when exists (select 1 from public.ep_employees e where e.user_id = p_user and e.is_active)
         then array['employee'] else '{}'::text[] end);
$$;
revoke all on function public.rbac_roles_of(uuid) from public, anon, authenticated;

-- Managers / Team Leads keep the employee features (first run only).
insert into public.rbac_backup (kind, name, definition)
select 'perms263', 'employee features copied', coalesce(jsonb_agg(jsonb_build_object('role_key', r, 'permission_key', rp.permission_key)), '[]'::jsonb)::text
  from (values ('manager'), ('team_lead')) v(r)
  join public.rbac_role_permissions rp on rp.role_key = 'employee' and rp.permission_key like 'emp.%'
 where not exists (select 1 from public.rbac_role_permissions x where x.role_key = v.r and x.permission_key like 'emp.%')
on conflict do nothing;
insert into public.rbac_role_permissions (role_key, permission_key)
select v.r, rp.permission_key
  from (values ('manager'), ('team_lead')) v(r)
  join public.rbac_role_permissions rp on rp.role_key = 'employee' and rp.permission_key like 'emp.%'
 where not exists (select 1 from public.rbac_role_permissions x where x.role_key = v.r and x.permission_key like 'emp.%')
on conflict do nothing;

update public.rbac_roles set description = 'Everyone with an Employee Portal account who has no other role.' where key = 'employee';
update public.rbac_roles set description = 'Employee Portal: an employee who also reviews and approves their team''s leave and reports.' where key = 'manager';
update public.rbac_roles set description = 'Employee Portal: an employee who leads a team, reviews its daily reports and messages it.' where key = 'team_lead';

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
  -- One role per person (migration 263). "Employee" = no other role (Employee Portal accounts only).
  if 'employee' = any (v_new) then
    if not exists (select 1 from public.ep_employees where user_id = p_user) then
      raise exception 'Employee is only for Employee Portal accounts.' using errcode = '22023';
    end if;
    v_new := array_remove(v_new, 'employee');
  end if;
  if cardinality(v_new) > 1 then
    raise exception 'A person can have only one role at a time. Choose one.' using errcode = '22023';
  end if;
  if cardinality(v_new) = 0 and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Choose a role.' using errcode = '22023';
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

-- ================================================================ change my password (My profile)
create or replace function public.rbac_my_change_password(p_current text, p_new text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
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
end $$;
revoke all on function public.rbac_my_change_password(text, text) from public, anon;
grant execute on function public.rbac_my_change_password(text, text) to authenticated;

notify pgrst, 'reload schema';

commit;

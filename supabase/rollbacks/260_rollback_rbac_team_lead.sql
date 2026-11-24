-- Rollback of 260_rbac_team_lead.sql: removes the Team Lead role (people lose it) and renames Manager back.
begin;
delete from public.rbac_roles where key = 'team_lead';
update public.rbac_roles set name = 'Manager / Team Lead',
       description = 'Employee Portal: reviews and approves their team''s leave and reports.' where key = 'manager';
update public.rbac_roles set sort_order = 50 where key = 'employee';

create or replace function public.rbac_admin_set_user_roles(p_user uuid, p_roles text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_new   text[] := coalesce((select array_agg(distinct r) from unnest(coalesce(p_roles, '{}')) r), '{}');
  v_old   text[];
  v_super boolean := public.rbac_user_can(auth.uid(), 'settings.users')
                     and exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
  v_bad   text;
begin
  perform public.rbac_require('settings.users');
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
  if 'employee' = any (v_new) then
    raise exception 'Employee is given automatically to everyone with an Employee Portal account.' using errcode = '22023';
  end if;
  if 'manager' = any (v_new) and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Manager / Team Lead is for Employee Portal accounts.' using errcode = '22023';
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
end $$;

notify pgrst, 'reload schema';
commit;

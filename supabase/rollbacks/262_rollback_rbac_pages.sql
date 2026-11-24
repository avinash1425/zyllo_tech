-- Rollback of 262_rbac_pages.sql: back to 261 (Clients and Search Console inside Project Tracker / SEO;
-- roles limited to their own area; is_admin() = has an admin-area role).
begin;

do $$
declare
  b record;
  d jsonb;
  v text;
begin
  for b in select * from public.rbac_backup where kind = 'policy262' loop
    d := b.definition::jsonb;
    execute format('alter policy %I on %I.%I%s%s', d ->> 'policy', d ->> 'schema', d ->> 'table',
                   case when d ->> 'qual' is not null then ' using (' || (d ->> 'qual') || ')' else '' end,
                   case when d ->> 'with_check' is not null then ' with check (' || (d ->> 'with_check') || ')' else '' end);
  end loop;
  select definition into v from public.rbac_backup where kind = 'function262' and name = 'public.is_admin()';
  if v is not null then
    execute v;
  end if;
end $$;

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
    'is_admin', exists (select 1 from public.rbac_roles r where r.key = any (v_roles) and r.area = 'admin'),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'area', r.area) order by r.sort_order)
                         from public.rbac_roles r where r.key = any (v_roles)), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(p.key order by p.sort_order) from public.rbac_permissions p
                              where v_super or exists (select 1 from public.rbac_role_permissions rp
                                                        where rp.permission_key = p.key and rp.role_key = any (v_roles))),
                            '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_set_permission(p_role text, p_permission text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.rbac_roles;
  v_perm public.rbac_permissions;
begin
  perform public.rbac_require('settings.roles.edit');
  select * into v_role from public.rbac_roles where key = p_role;
  select * into v_perm from public.rbac_permissions where key = p_permission;
  if v_role.key is null or v_perm.key is null then
    raise exception 'Unknown role or permission.' using errcode = 'P0002';
  end if;
  if v_role.key = 'super_admin' then
    raise exception 'Super Admin always has every permission.' using errcode = '42501';
  end if;
  if v_role.area <> v_perm.area then
    raise exception '% is an % role; this permission belongs to the %.', v_role.name,
      case v_role.area when 'admin' then 'admin-area' else 'Employee Portal' end,
      case v_perm.area when 'admin' then 'admin area' else 'Employee Portal' end using errcode = '22023';
  end if;
  if p_enabled then
    insert into public.rbac_role_permissions (role_key, permission_key) values (p_role, p_permission) on conflict do nothing;
  else
    delete from public.rbac_role_permissions where role_key = p_role and permission_key = p_permission;
  end if;
end $function$;

drop function if exists public.rbac_user_has_admin_pages(uuid);
delete from public.rbac_permissions where module in ('projects.clients', 'website.search_console');
update public.rbac_permissions set label = 'SEO & Search Console', description = 'SEO audit and Google Search Console.' where module = 'website.seo';
update public.rbac_permissions set label = 'Project Tracker & Clients', description = 'Clients, projects, documents and backups.' where module = 'projects.tracker';
delete from public.rbac_backup where kind in ('policy262', 'function262');
notify pgrst, 'reload schema';
commit;

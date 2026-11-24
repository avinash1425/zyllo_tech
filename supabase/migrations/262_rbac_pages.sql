-- 262: Roles & permissions per PAGE, and any role may get any page.
--   * New page permissions: "Clients" (projects.clients: view / create / edit / delete), separate from
--     "Project Tracker" (projects.tracker), and "Search Console" (website.search_console: view), separate
--     from "SEO". Roles that had the Project Tracker / SEO actions get the same Clients / Search Console ones.
--   * Client and project names are readable on the Project Tracker, Clients and Access & Logins pages;
--     adding, editing or deleting clients (and their logos) needs the Clients permissions.
--   * Any role may get any permission: e.g. the Employee role can be given "Contact submissions — View".
--     is_admin() now means "may open at least one admin page"; such employees still sign in to the
--     Employee Portal and open the admin pages from there.
-- Safe to run again. Rollback: supabase/rollbacks/262_rollback_rbac_pages.sql

begin;

-- ================================================================ catalog
insert into public.rbac_permissions (key, area, grp, label, description, sort_order, module, action, action_label) values
  ('projects.clients.view', 'admin', 'Projects', 'Clients', 'Client companies and their logos.', 86, 'projects.clients', 'view', 'View'),
  ('projects.clients.create', 'admin', 'Projects', 'Clients', 'Client companies and their logos.', 87, 'projects.clients', 'create', 'Add clients'),
  ('projects.clients.edit', 'admin', 'Projects', 'Clients', 'Client companies and their logos.', 88, 'projects.clients', 'edit', 'Edit'),
  ('projects.clients.delete', 'admin', 'Projects', 'Clients', 'Client companies and their logos.', 89, 'projects.clients', 'delete', 'Delete'),
  ('website.search_console.view', 'admin', 'Growth', 'Search Console', 'Google Search Console data.', 85, 'website.search_console', 'view', 'View')
on conflict (key) do update
  set area = excluded.area, grp = excluded.grp, label = excluded.label, description = excluded.description,
      sort_order = excluded.sort_order, module = excluded.module, action = excluded.action, action_label = excluded.action_label;
update public.rbac_permissions set label = 'SEO', description = 'SEO audit of the website pages.' where module = 'website.seo';
update public.rbac_permissions set label = 'Project Tracker', description = 'Projects, documents and backups.' where module = 'projects.tracker';

-- Same access as before: Project Tracker actions -> Clients actions, SEO -> Search Console (first run only).
insert into public.rbac_role_permissions (role_key, permission_key)
select rp.role_key, replace(rp.permission_key, 'projects.tracker.', 'projects.clients.')
  from public.rbac_role_permissions rp
 where rp.permission_key in ('projects.tracker.view', 'projects.tracker.create', 'projects.tracker.edit', 'projects.tracker.delete')
   and not exists (select 1 from public.rbac_role_permissions where permission_key like 'projects.clients.%')
on conflict do nothing;
insert into public.rbac_role_permissions (role_key, permission_key)
select rp.role_key, 'website.search_console.view' from public.rbac_role_permissions rp
 where rp.permission_key = 'website.seo.view'
   and not exists (select 1 from public.rbac_role_permissions where permission_key = 'website.search_console.view')
on conflict do nothing;

-- ================================================================ "may open the admin area"
create or replace function public.rbac_user_has_admin_pages(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user is not null and (
    exists (select 1 from public.rbac_user_roles where user_id = p_user and role_key = 'super_admin')
    or exists (select 1 from public.rbac_role_permissions rp join public.rbac_permissions p on p.key = rp.permission_key
                where p.area = 'admin' and rp.role_key = any (public.rbac_roles_of(p_user))));
$$;
revoke all on function public.rbac_user_has_admin_pages(uuid) from public, anon, authenticated;

insert into public.rbac_backup (kind, name, definition)
values ('function262', 'public.is_admin()', pg_get_functiondef('public.is_admin()'::regprocedure))
on conflict do nothing;
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.rbac_user_has_admin_pages(auth.uid());
$$;

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
  -- Any role may get any page (e.g. Employee -> Contact submissions); see migration 262.
  if p_enabled then
    insert into public.rbac_role_permissions (role_key, permission_key) values (p_role, p_permission) on conflict do nothing;
  else
    delete from public.rbac_role_permissions where role_key = p_role and permission_key = p_permission;
  end if;
end $function$;

-- ================================================================ client / project data per page
do $$
declare
  p record;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where (tablename in ('pt_companies', 'pt_projects') and policyname like 'pt\_% admin %')
               or policyname like 'pt-company-logos: admin %' loop
    insert into public.rbac_backup (kind, name, definition)
    values ('policy262', p.schemaname || '.' || p.tablename || '.' || p.policyname,
            jsonb_build_object('schema', p.schemaname, 'table', p.tablename, 'policy', p.policyname,
                               'qual', p.qual, 'with_check', p.with_check)::text)
    on conflict do nothing;
  end loop;
end $$;

alter policy "pt_companies admin select" on public.pt_companies using (public.rbac_can('projects.clients.view') or public.rbac_can('projects.tracker.view') or public.rbac_can('projects.logins.view'));
alter policy "pt_companies admin insert" on public.pt_companies with check (public.rbac_can('projects.clients.create'));
alter policy "pt_companies admin update" on public.pt_companies
  using (public.rbac_can('projects.clients.edit')) with check (public.rbac_can('projects.clients.edit'));
alter policy "pt_companies admin delete" on public.pt_companies using (public.rbac_can('projects.clients.delete'));
alter policy "pt_projects admin select" on public.pt_projects using (public.rbac_can('projects.clients.view') or public.rbac_can('projects.tracker.view') or public.rbac_can('projects.logins.view'));
alter policy "pt-company-logos: admin read" on storage.objects
  using (bucket_id = 'pt-company-logos' and (public.rbac_can('projects.clients.view') or public.rbac_can('projects.tracker.view') or public.rbac_can('projects.logins.view')));
alter policy "pt-company-logos: admin upload" on storage.objects
  with check (bucket_id = 'pt-company-logos'
              and (public.rbac_can('projects.clients.create') or public.rbac_can('projects.clients.edit')));
alter policy "pt-company-logos: admin delete" on storage.objects
  using (bucket_id = 'pt-company-logos'
         and (public.rbac_can('projects.clients.edit') or public.rbac_can('projects.clients.delete')));

notify pgrst, 'reload schema';

commit;

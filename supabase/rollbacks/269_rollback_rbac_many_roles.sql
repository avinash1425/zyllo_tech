-- Rollback of 269: back to one role per person (keeps the highest role of everyone; removed ones saved in rbac_backup).
begin;
do $rb$
declare d text;
begin
  for d in select definition from public.rbac_backup where kind = 'function269' loop
    execute d;
  end loop;
end $rb$;
insert into public.rbac_backup (kind, name, definition)
select 'roles269rb', 'removed extra roles', coalesce(jsonb_agg(to_jsonb(ur)), '[]'::jsonb)::text
  from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
 where exists (select 1 from public.rbac_user_roles ur2 join public.rbac_roles r2 on r2.key = ur2.role_key
                where ur2.user_id = ur.user_id and r2.sort_order < r.sort_order)
on conflict do nothing;
delete from public.rbac_user_roles ur using public.rbac_roles r
 where r.key = ur.role_key
   and exists (select 1 from public.rbac_user_roles ur2 join public.rbac_roles r2 on r2.key = ur2.role_key
                where ur2.user_id = ur.user_id and r2.sort_order < r.sort_order);
create unique index if not exists rbac_user_roles_one_per_user on public.rbac_user_roles (user_id);
update public.rbac_roles set description = 'Everyone with an Employee Portal account who has no other role.' where key = 'employee';
delete from public.rbac_backup where kind = 'function269';
commit;

-- Rollback of 270: late after 09:40 again, notifications newest first.
begin;
do $rb$
declare d text;
begin
  for d in select definition from public.rbac_backup where kind = 'function270' loop
    execute d;
  end loop;
end $rb$;
delete from public.rbac_backup where kind = 'function270';
commit;

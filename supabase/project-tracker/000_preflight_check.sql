-- =====================================================================
-- Zyllo Tech — Project Tracker: READ-ONLY preflight check.
-- Run in the SQL editor of the target project BEFORE 001/002. It changes
-- nothing (only SELECTs). Every row should show ok = true; anything else is
-- a conflict to resolve (or report) before applying.
-- =====================================================================
select 'public.is_admin() exists (website admin check)' as check, to_regprocedure('public.is_admin()') is not null as ok, null::text as detail
union all
select 'auth.uid() / auth.jwt() exist', to_regprocedure('auth.uid()') is not null and to_regprocedure('auth.jwt()') is not null, null
union all
select 'gen_random_uuid() available', to_regprocedure('gen_random_uuid()') is not null, null
union all
select 'server is PostgreSQL 15+ (security_invoker views)', current_setting('server_version_num')::int >= 150000, current_setting('server_version')
union all
select 'no existing pt_* tables / views (name collision)',
       not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'pt\_%'),
       (select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'pt\_%')
union all
select 'no existing pt_* functions (name collision)',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'pt\_%'),
       (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'pt\_%')
union all
select 'storage bucket project-tracker-documents not present yet',
       not exists (select 1 from storage.buckets where id = 'project-tracker-documents'), null
union all
select 'you (SQL editor) are a website admin? (informational; false is normal in the SQL editor)',
       true, coalesce((select public.is_admin())::text, 'null')
union all
select 'number of website admins via user_roles (informational)', true,
       case when to_regclass('public.user_roles') is null then 'user_roles table not present'
            else (select count(*)::text from public.user_roles where role::text = 'admin') end;

-- Show how the live is_admin() is defined (informational): Project Tracker
-- grants access to exactly the users this function returns true for.
select pg_get_functiondef('public.is_admin()'::regprocedure) as is_admin_definition;

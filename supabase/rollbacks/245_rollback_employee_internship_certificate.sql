-- Rollback of 245_employee_internship_certificate.sql.
-- Drops the functions, the table and the storage policies. The bucket "ep-certificates" and any
-- uploaded files are LEFT in place (Supabase does not allow deleting storage objects with SQL);
-- empty it in Dashboard > Storage first, then delete the bucket there if wanted.
begin;
drop function if exists public.ep_admin_remove_certificate(uuid);
drop function if exists public.ep_admin_set_certificate(uuid, text, text, bigint, text);
drop table if exists public.ep_internship_certificates;
drop policy if exists "ep-certificates: employee read own" on storage.objects;
drop policy if exists "ep-certificates: admin delete" on storage.objects;
drop policy if exists "ep-certificates: admin upload" on storage.objects;
drop policy if exists "ep-certificates: admin read" on storage.objects;
notify pgrst, 'reload schema';
commit;

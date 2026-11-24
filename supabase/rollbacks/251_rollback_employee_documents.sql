-- Rollback of 251_employee_documents.sql.
-- Drops the functions, the table and the storage policies. The bucket "ep-documents" and any
-- uploaded files are LEFT in place (Supabase does not allow deleting storage objects with SQL);
-- empty it in Dashboard > Storage first, then delete the bucket there if wanted.
begin;
drop function if exists public.ep_delete_my_document(uuid);
drop function if exists public.ep_add_my_document(text, text, text, text, bigint, text);
drop table if exists public.ep_employee_documents;
drop policy if exists "ep-documents: employee delete own" on storage.objects;
drop policy if exists "ep-documents: employee upload own" on storage.objects;
drop policy if exists "ep-documents: employee read own" on storage.objects;
drop policy if exists "ep-documents: admin read" on storage.objects;
notify pgrst, 'reload schema';
commit;

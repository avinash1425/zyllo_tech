-- 251: Employee Portal — employee documents (My Profile -> My documents).
--
-- The employee uploads their own documents (offer letter, certificates, ID proofs, …) in My Profile;
-- the admin sees them on the employee's page (Admin -> Employee Management), read-only.
--   storage bucket "ep-documents" (private, 10 MB, PDF / PNG / JPG / WEBP), path "<employee_id>/<uuid>-<file name>"
--     employee (active): upload / read / delete files in their OWN folder only;  admin: read
--   ep_employee_documents: one row per uploaded document
--     read: admin, and the employee themself (RLS); written only through the RPCs below
--   ep_add_my_document(category, title, path, name, size, mime) -> the file must already be uploaded in
--     the caller's own folder; max 50 documents per employee
--   ep_delete_my_document(id) -> deletes the row, returns the path so the page can delete the file
-- Rollback: supabase/rollbacks/251_rollback_employee_documents.sql

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('ep-documents', 'ep-documents', false, 10485760,
   array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ep-documents: admin read" on storage.objects;
create policy "ep-documents: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'ep-documents' and public.is_admin());

drop policy if exists "ep-documents: employee read own" on storage.objects;
create policy "ep-documents: employee read own" on storage.objects for select to authenticated
  using (bucket_id = 'ep-documents'
         and (storage.foldername(name))[1] in (
           select e.id::text from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

drop policy if exists "ep-documents: employee upload own" on storage.objects;
create policy "ep-documents: employee upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'ep-documents'
              and (storage.foldername(name))[1] in (
                select e.id::text from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

drop policy if exists "ep-documents: employee delete own" on storage.objects;
create policy "ep-documents: employee delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'ep-documents'
         and (storage.foldername(name))[1] in (
           select e.id::text from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

create table if not exists public.ep_employee_documents (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.ep_employees (id) on delete cascade,
  category     text not null check (category in
                 ('offer_letter', 'appointment_letter', 'education', 'experience', 'id_proof',
                  'address_proof', 'photo', 'other')),
  title        text not null check (length(btrim(title)) between 1 and 120),
  storage_path text not null unique,
  file_name    text not null check (length(btrim(file_name)) between 1 and 255),
  file_size    bigint not null check (file_size > 0 and file_size <= 10485760),
  mime_type    text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  uploaded_at  timestamptz not null default now(),
  constraint ep_doc_path_in_folder check (storage_path like employee_id::text || '/%')
);
create index if not exists ep_employee_documents_emp_idx on public.ep_employee_documents (employee_id, uploaded_at desc);
comment on table public.ep_employee_documents is
  'Employee Portal: documents the employee uploaded (bucket ep-documents). Written via ep_add_my_document / ep_delete_my_document.';

alter table public.ep_employee_documents enable row level security;
revoke all on public.ep_employee_documents from anon, authenticated;
grant select on public.ep_employee_documents to authenticated;
drop policy if exists ep_doc_read on public.ep_employee_documents;
create policy ep_doc_read on public.ep_employee_documents for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

create or replace function public.ep_add_my_document(
  p_category text, p_title text, p_path text, p_name text, p_size bigint, p_mime text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_path is null or p_path not like v_emp::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ep-documents' and name = p_path) then
    raise exception 'The file was not uploaded.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.ep_employee_documents where employee_id = v_emp) >= 50 then
    raise exception 'You can keep up to 50 documents. Delete one first.' using errcode = '22023';
  end if;
  insert into public.ep_employee_documents (employee_id, category, title, storage_path, file_name, file_size, mime_type)
  values (v_emp, p_category, left(btrim(coalesce(nullif(btrim(p_title), ''), p_name)), 120),
          p_path, left(btrim(p_name), 255), p_size, p_mime)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ep_delete_my_document(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp  uuid := public.ep_current_employee_id();
  v_path text;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  delete from public.ep_employee_documents where id = p_id and employee_id = v_emp returning storage_path into v_path;
  if v_path is null then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('old_path', v_path);
end $$;

revoke all on function public.ep_add_my_document(text, text, text, text, bigint, text),
  public.ep_delete_my_document(uuid) from public, anon;
grant execute on function public.ep_add_my_document(text, text, text, text, bigint, text),
  public.ep_delete_my_document(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

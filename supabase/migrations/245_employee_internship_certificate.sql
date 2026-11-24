-- 245: Employee Portal — internship certificate.
--
-- The admin uploads an intern's certificate (PDF or image, max 10 MB) on the employee's page
-- (Admin -> Employee Management); the intern downloads it from My Profile.
--   storage bucket "ep-certificates" (private), path "<employee_id>/<uuid>-<file name>"
--     admin: read / upload / delete;  employee: read files in their OWN folder only
--   ep_internship_certificates: one row per employee (the current certificate)
--     read: admin, and the employee themself (RLS); written only through the RPCs below
--   ep_admin_set_certificate(employee, path, name, size, mime) -> only for employment type "intern";
--     the file must already be uploaded in the employee's folder; replaces the previous one and
--     returns its path so the page can delete the old file; notifies the intern
--   ep_admin_remove_certificate(employee) -> returns the path so the page can delete the file
-- Rollback: supabase/rollbacks/245_rollback_employee_internship_certificate.sql

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('ep-certificates', 'ep-certificates', false, 10485760,
   array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ep-certificates: admin read" on storage.objects;
create policy "ep-certificates: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'ep-certificates' and public.is_admin());
drop policy if exists "ep-certificates: admin upload" on storage.objects;
create policy "ep-certificates: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'ep-certificates' and public.is_admin());
drop policy if exists "ep-certificates: admin delete" on storage.objects;
create policy "ep-certificates: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'ep-certificates' and public.is_admin());
drop policy if exists "ep-certificates: employee read own" on storage.objects;
create policy "ep-certificates: employee read own" on storage.objects for select to authenticated
  using (bucket_id = 'ep-certificates'
         and (storage.foldername(name))[1] in (
           select e.id::text from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

create table if not exists public.ep_internship_certificates (
  employee_id  uuid primary key references public.ep_employees (id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null check (length(btrim(file_name)) between 1 and 255),
  file_size    bigint not null check (file_size > 0 and file_size <= 10485760),
  mime_type    text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  uploaded_by  uuid references auth.users (id) on delete set null,
  uploaded_at  timestamptz not null default now(),
  constraint ep_cert_path_in_folder check (storage_path like employee_id::text || '/%')
);
comment on table public.ep_internship_certificates is
  'Employee Portal: internship certificate file (bucket ep-certificates). Written via ep_admin_set_certificate.';

alter table public.ep_internship_certificates enable row level security;
revoke all on public.ep_internship_certificates from anon, authenticated;
grant select on public.ep_internship_certificates to authenticated;
drop policy if exists ep_cert_read on public.ep_internship_certificates;
create policy ep_cert_read on public.ep_internship_certificates for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

create or replace function public.ep_admin_set_certificate(
  p_emp uuid, p_path text, p_name text, p_size bigint, p_mime text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_type text;
  v_old  text;
begin
  perform public.ep_require_admin();
  select employment_type into v_type from public.ep_employees where id = p_emp;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if v_type is distinct from 'intern' then
    raise exception 'Set the employment type to Intern first.' using errcode = '22023';
  end if;
  if p_path is null or p_path not like p_emp::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ep-certificates' and name = p_path) then
    raise exception 'The file was not uploaded.' using errcode = 'P0002';
  end if;
  select storage_path into v_old from public.ep_internship_certificates where employee_id = p_emp for update;
  insert into public.ep_internship_certificates (employee_id, storage_path, file_name, file_size, mime_type, uploaded_by, uploaded_at)
  values (p_emp, p_path, left(btrim(p_name), 255), p_size, p_mime, auth.uid(), now())
  on conflict (employee_id) do update
    set storage_path = excluded.storage_path, file_name = excluded.file_name, file_size = excluded.file_size,
        mime_type = excluded.mime_type, uploaded_by = excluded.uploaded_by, uploaded_at = now();
  perform public.ep_notify(p_emp, 'message',
    case when v_old is null then 'Your internship certificate is ready' else 'Your internship certificate was updated' end,
    'Download it from My Profile.', '/employee/profile');
  return jsonb_build_object('old_path', case when v_old is distinct from p_path then v_old end);
end $$;

create or replace function public.ep_admin_remove_certificate(p_emp uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old text;
begin
  perform public.ep_require_admin();
  delete from public.ep_internship_certificates where employee_id = p_emp returning storage_path into v_old;
  if v_old is null then
    raise exception 'There is no certificate to remove.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('old_path', v_old);
end $$;

revoke all on function public.ep_admin_set_certificate(uuid, text, text, bigint, text),
  public.ep_admin_remove_certificate(uuid) from public, anon;
grant execute on function public.ep_admin_set_certificate(uuid, text, text, bigint, text),
  public.ep_admin_remove_certificate(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

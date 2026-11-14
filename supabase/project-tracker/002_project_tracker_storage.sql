-- =====================================================================
-- Zyllo Tech — Project Tracker: private document storage.
--
-- NOT APPLIED. Separate approval gate (creates a production storage bucket
-- and storage policies). Apply after 001_project_tracker_schema.sql.
--
-- * New PRIVATE bucket "project-tracker-documents" (no public URLs).
-- * Object names: <project_id>/<random uuid>/<sanitised file name>.
-- * Upload: Project Tracker editors, into the folder of an active project,
--   allowed extensions only, size and MIME type limited by the bucket.
-- * Download (signed URLs, created for 60 seconds by the app): only when a
--   pt_documents row for that exact path is visible to the caller under its
--   RLS — so restricted files stay manager-only and nothing leaks across
--   projects or to non-admins.
-- * Delete: only orphans (an upload whose document row was never saved).
--   Files of saved documents are archived, never deleted.
-- Existing buckets (resumes, portfolio-images) and their policies are not
-- touched.
-- =====================================================================

begin;

do $$
begin
  if to_regprocedure('public.pt_can_edit()') is null then
    raise exception 'Apply 001_project_tracker_schema.sql first.';
  end if;
  if exists (select 1 from storage.buckets where id = 'project-tracker-documents' and public) then
    raise exception 'Bucket project-tracker-documents exists and is PUBLIC. Aborting; fix it manually.';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-tracker-documents', 'project-tracker-documents', false, 52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'text/markdown',
    'image/png', 'image/jpeg', 'image/webp',
    'application/zip', 'application/x-zip-compressed',
    'video/mp4', 'video/webm', 'audio/mpeg'
  ])
on conflict (id) do nothing;

create policy "pt documents: editors upload into active projects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-tracker-documents'
  and public.pt_can_edit()
  and public.pt_project_is_active((storage.foldername(name))[1])
  and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and array_length(storage.foldername(name), 1) = 2
  and lower(storage.filename(name)) ~ '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|md|png|jpg|jpeg|webp|zip|mp4|webm|mp3)$'
);

create policy "pt documents: read files of visible documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'project-tracker-documents'
  and (
    -- a saved document the caller may see (pt_documents RLS applies here)
    exists (select 1 from public.pt_documents d where d.storage_path = storage.objects.name and d.archived_at is null)
    -- or an orphaned upload, so an editor can clean it up
    or (public.pt_can_edit() and not public.pt_document_path_exists(storage.objects.name))
  )
);

create policy "pt documents: editors remove orphaned uploads"
on storage.objects for delete to authenticated
using (
  bucket_id = 'project-tracker-documents'
  and public.pt_can_edit()
  and not public.pt_document_path_exists(storage.objects.name)
);

commit;

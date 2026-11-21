-- Rollback of 221_project_tracker_logos_projects.sql.
-- WARNING: permanently deletes every Project Tracker project and the logo bucket policies.
-- Logo files must be emptied from the "pt-company-logos" bucket first (Dashboard > Storage),
-- otherwise the bucket row cannot be deleted. Dropped company columns are re-added empty.
drop table if exists public.pt_projects;

drop policy if exists "pt-company-logos: admin read" on storage.objects;
drop policy if exists "pt-company-logos: admin upload" on storage.objects;
drop policy if exists "pt-company-logos: admin delete" on storage.objects;
delete from storage.buckets where id = 'pt-company-logos'
  and not exists (select 1 from storage.objects where bucket_id = 'pt-company-logos');

alter table public.pt_companies drop constraint if exists pt_companies_logo_path_check;
alter table public.pt_companies drop column if exists logo_path;
alter table public.pt_companies add column if not exists website text;
alter table public.pt_companies add column if not exists gstin text;
alter table public.pt_companies add column if not exists city text;
alter table public.pt_companies add column if not exists state text;
alter table public.pt_companies add column if not exists notes text;

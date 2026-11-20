-- =====================================================================
-- 221_project_tracker_logos_projects.sql — Project Tracker round 2
-- =====================================================================
-- 1. pt_companies: drop website, gstin, city, state, notes (not wanted);
--    add logo_path (object path in the private bucket below).
-- 2. Private storage bucket "pt-company-logos" (PNG / JPEG / WEBP, 2 MB),
--    readable and writable by website admins only.
-- 3. pt_projects: projects that belong to one client company.
--
-- Access everywhere: public.is_admin() (the admin area's own gate).
-- Depends on 220. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/221_rollback_project_tracker_logos_projects.sql
-- =====================================================================

-- 1. Company columns ---------------------------------------------------
alter table public.pt_companies drop column if exists website;
alter table public.pt_companies drop column if exists gstin;
alter table public.pt_companies drop column if exists city;
alter table public.pt_companies drop column if exists state;
alter table public.pt_companies drop column if exists notes;

alter table public.pt_companies add column if not exists logo_path text;
alter table public.pt_companies drop constraint if exists pt_companies_logo_path_check;
alter table public.pt_companies add constraint pt_companies_logo_path_check
  check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$');

-- 2. Logo bucket ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('pt-company-logos', 'pt-company-logos', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pt-company-logos: admin read" on storage.objects;
create policy "pt-company-logos: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'pt-company-logos' and public.is_admin());

drop policy if exists "pt-company-logos: admin upload" on storage.objects;
create policy "pt-company-logos: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'pt-company-logos' and public.is_admin());

drop policy if exists "pt-company-logos: admin delete" on storage.objects;
create policy "pt-company-logos: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'pt-company-logos' and public.is_admin());
-- No UPDATE policy: a new logo is a new object; the old one is deleted.

-- 3. Projects --------------------------------------------------------------
create table if not exists public.pt_projects (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.pt_companies(id) on delete restrict,
  name        text not null check (length(btrim(name)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  status      text not null default 'planning'
              check (status in ('planning', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  start_date  date,
  end_date    date,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint pt_projects_dates_check check (start_date is null or end_date is null or end_date >= start_date)
);

-- One project per name within a company (case- and space-insensitive).
create unique index if not exists pt_projects_company_name_key
  on public.pt_projects (company_id, lower(btrim(name)));
create index if not exists pt_projects_company_idx on public.pt_projects (company_id);

drop trigger if exists pt_projects_set_updated_at on public.pt_projects;
create trigger pt_projects_set_updated_at
  before update on public.pt_projects
  for each row
  execute function public.pt_set_updated_at();

alter table public.pt_projects enable row level security;

revoke all on public.pt_projects from anon;
grant select, insert, update, delete on public.pt_projects to authenticated;

drop policy if exists "pt_projects admin select" on public.pt_projects;
create policy "pt_projects admin select" on public.pt_projects
  for select to authenticated using (public.is_admin());

drop policy if exists "pt_projects admin insert" on public.pt_projects;
create policy "pt_projects admin insert" on public.pt_projects
  for insert to authenticated with check (public.is_admin());

drop policy if exists "pt_projects admin update" on public.pt_projects;
create policy "pt_projects admin update" on public.pt_projects
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "pt_projects admin delete" on public.pt_projects;
create policy "pt_projects admin delete" on public.pt_projects
  for delete to authenticated using (public.is_admin());

-- =====================================================================
-- Zyllo Tech website — FULL DATABASE SCHEMA (final state)
-- =====================================================================
-- Consolidates migrations 001-011 + the blog migrations into one
-- idempotent script, so a brand-new Supabase project (or a new Lovable
-- Cloud/Supabase project) can be created in one run.
--
-- ORDER OF USE
--   1. supabase/schema/000_full_schema.sql         (this file: tables, functions, triggers, buckets)
--   2. supabase/policies/001_rls_for_browser_app.sql (RLS, is_admin(), admin_users, storage policies)
--   3. insert yourself into public.admin_users (see the end of file 001)
--
-- On the EXISTING live database the tables already exist, so every
-- statement here is "if not exists" / "create or replace" and safe to
-- re-run. It changes nothing that is already there except re-creating
-- functions/triggers with identical logic.
--
-- NOTE: the old public.profiles table + handle_new_user trigger were
-- removed (migrations 008-011) and are intentionally NOT recreated.
-- Admin access is now public.admin_users + is_admin() in file 001.
-- =====================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- Shared updated_at trigger function
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- job_postings  (Careers)
-- ---------------------------------------------------------------------
create table if not exists public.job_postings (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  department       text not null,
  location         text not null default 'Remote / India',
  employment_type  text not null default 'Full-time',
  description      text not null default '',
  total_openings   integer not null default 1,
  status           text not null default 'open' check (status in ('open', 'closed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists job_postings_set_updated_at on public.job_postings;
create trigger job_postings_set_updated_at
  before update on public.job_postings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- job_applications  (pipeline: new -> hired/rejected)
-- ---------------------------------------------------------------------
create table if not exists public.job_applications (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.job_postings(id) on delete cascade,
  full_name         text not null,
  email             text not null,
  phone             text,
  resume_url        text,            -- storage object path in bucket 'resumes' (legacy rows may hold a full public URL)
  cover_note        text,
  experience_years  integer,
  prospect_rating   integer check (prospect_rating between 1 and 5),
  status            text not null default 'new',
  created_at        timestamptz not null default now()
);

alter table public.job_applications drop constraint if exists job_applications_status_check;
alter table public.job_applications
  add constraint job_applications_status_check
  check (status in ('new', 'reviewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'));

create index if not exists job_applications_job_id_idx on public.job_applications(job_id);

-- ---------------------------------------------------------------------
-- job_application_views  (analytics: who opened an apply page)
-- ---------------------------------------------------------------------
create table if not exists public.job_application_views (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.job_postings(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists job_application_views_job_id_idx
  on public.job_application_views(job_id);

-- ---------------------------------------------------------------------
-- Auto open/close a job when hired count reaches total_openings
-- ---------------------------------------------------------------------
create or replace function public.recompute_job_status(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_openings integer;
  v_hired_count    integer;
begin
  select total_openings into v_total_openings
    from public.job_postings where id = p_job_id;

  select count(*) into v_hired_count
    from public.job_applications
   where job_id = p_job_id and status = 'hired';

  update public.job_postings
     set status = case when v_hired_count >= v_total_openings then 'closed' else 'open' end
   where id = p_job_id;
end;
$$;

create or replace function public.job_applications_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    perform public.recompute_job_status(old.job_id);
    return old;
  else
    perform public.recompute_job_status(new.job_id);
    return new;
  end if;
end;
$$;

drop trigger if exists job_applications_status_change on public.job_applications;
create trigger job_applications_status_change
  after insert or update of status or delete on public.job_applications
  for each row execute function public.job_applications_status_trigger();

create or replace function public.job_postings_openings_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_job_status(new.id);
  return new;
end;
$$;

drop trigger if exists job_postings_openings_change on public.job_postings;
create trigger job_postings_openings_change
  after update of total_openings on public.job_postings
  for each row execute function public.job_postings_openings_trigger();

-- ---------------------------------------------------------------------
-- contact_submissions  (Contact form inbox)
-- ---------------------------------------------------------------------
create table if not exists public.contact_submissions (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text not null,
  phone       text,
  company     text,
  service     text,
  message     text not null,
  status      text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- portfolio_projects  (Portfolio / case studies)
-- ---------------------------------------------------------------------
create table if not exists public.portfolio_projects (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  tag            text not null,
  description    text not null,
  challenge      text,
  solution       text,
  result         text,
  image_url      text,
  status         text not null default 'draft' check (status in ('draft', 'published')),
  display_order  integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists portfolio_projects_set_updated_at on public.portfolio_projects;
create trigger portfolio_projects_set_updated_at
  before update on public.portfolio_projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- blog_posts
-- ---------------------------------------------------------------------
create table if not exists public.blog_posts (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  slug                text not null unique,
  category            text not null default 'Engineering',
  author              text not null default 'Zyllo Engineering Team',
  excerpt             text not null default '',
  content             text not null default '',
  featured_image_url  text,
  status              text not null default 'draft' check (status in ('draft', 'published')),
  views               integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create or replace function public.set_blog_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_blog_posts_updated_at on public.blog_posts;
create trigger trg_blog_posts_updated_at
  before update on public.blog_posts
  for each row execute function public.set_blog_posts_updated_at();

create index if not exists idx_blog_posts_status_created_at
  on public.blog_posts (status, created_at desc);

-- Anonymous page-view counter (only published posts; cannot edit anything else).
create or replace function public.increment_blog_post_views(post_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.blog_posts
     set views = views + 1
   where slug = post_slug
     and status = 'published';
end;
$$;

-- ---------------------------------------------------------------------
-- Storage buckets
--   resumes          PRIVATE  (applicant PDFs; admin reads via signed URLs)
--   portfolio-images PUBLIC   (shown on the public Portfolio page)
-- Storage RLS policies are in supabase/policies/001_rls_for_browser_app.sql
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('portfolio-images', 'portfolio-images', true)
on conflict (id) do nothing;

-- (An existing 'resumes' bucket that was created public is switched to
-- private by file 001, together with the policies that make that safe.)

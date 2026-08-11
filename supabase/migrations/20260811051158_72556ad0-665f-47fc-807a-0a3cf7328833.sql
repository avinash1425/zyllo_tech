create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  category text not null default 'Engineering',
  author text not null default 'Zyllo Engineering Team',
  excerpt text not null default '',
  content text not null default '',
  featured_image_url text,
  status text not null default 'draft' check (status in ('draft','published')),
  views integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.blog_posts to anon;
grant select, insert, update, delete on public.blog_posts to authenticated;
grant all on public.blog_posts to service_role;
alter table public.blog_posts enable row level security;
drop policy if exists "Anyone can read published posts" on public.blog_posts;
create policy "Anyone can read published posts" on public.blog_posts
  for select to anon, authenticated using (status = 'published');
drop policy if exists "Signed-in staff manage posts" on public.blog_posts;
create policy "Signed-in staff manage posts" on public.blog_posts
  for all to authenticated using (true) with check (true);
create index if not exists idx_blog_posts_status_created_at on public.blog_posts (status, created_at desc);
drop trigger if exists trg_blog_posts_updated_at on public.blog_posts;
create trigger trg_blog_posts_updated_at before update on public.blog_posts
  for each row execute function public.set_updated_at();

create or replace function public.increment_blog_post_views(post_slug text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.blog_posts set views = views + 1
  where slug = post_slug and status = 'published';
end; $$;
grant execute on function public.increment_blog_post_views(text) to anon, authenticated;

create table if not exists public.portfolio_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  tag text not null default 'Web',
  description text not null default '',
  image_url text,
  challenge text,
  solution text,
  result text,
  status text not null default 'draft' check (status in ('draft','published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.portfolio_projects to anon;
grant select, insert, update, delete on public.portfolio_projects to authenticated;
grant all on public.portfolio_projects to service_role;
alter table public.portfolio_projects enable row level security;
drop policy if exists "Anyone can read published projects" on public.portfolio_projects;
create policy "Anyone can read published projects" on public.portfolio_projects
  for select to anon, authenticated using (status = 'published');
drop policy if exists "Signed-in staff manage projects" on public.portfolio_projects;
create policy "Signed-in staff manage projects" on public.portfolio_projects
  for all to authenticated using (true) with check (true);
drop trigger if exists trg_portfolio_projects_updated_at on public.portfolio_projects;
create trigger trg_portfolio_projects_updated_at before update on public.portfolio_projects
  for each row execute function public.set_updated_at();

create table if not exists public.job_postings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text not null,
  location text not null default 'Remote / India',
  employment_type text not null default 'Full-time',
  description text not null default '',
  total_openings integer not null default 1 check (total_openings >= 1),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.job_postings to anon;
grant select, insert, update, delete on public.job_postings to authenticated;
grant all on public.job_postings to service_role;
alter table public.job_postings enable row level security;
drop policy if exists "Anyone can read job postings" on public.job_postings;
create policy "Anyone can read job postings" on public.job_postings
  for select to anon, authenticated using (true);
drop policy if exists "Signed-in staff manage job postings" on public.job_postings;
create policy "Signed-in staff manage job postings" on public.job_postings
  for all to authenticated using (true) with check (true);
drop trigger if exists trg_job_postings_updated_at on public.job_postings;
create trigger trg_job_postings_updated_at before update on public.job_postings
  for each row execute function public.set_updated_at();

create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.job_postings(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  experience_years integer,
  prospect_rating integer check (prospect_rating between 1 and 5),
  resume_url text,
  cover_note text,
  status text not null default 'new'
    check (status in ('new','reviewed','shortlisted','interview','offer','hired','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant insert on public.job_applications to anon;
grant select, insert, update, delete on public.job_applications to authenticated;
grant all on public.job_applications to service_role;
alter table public.job_applications enable row level security;
drop policy if exists "Anyone can apply" on public.job_applications;
create policy "Anyone can apply" on public.job_applications
  for insert to anon, authenticated with check (true);
drop policy if exists "Signed-in staff manage applications" on public.job_applications;
create policy "Signed-in staff manage applications" on public.job_applications
  for all to authenticated using (true) with check (true);
create index if not exists idx_job_applications_job_id on public.job_applications (job_id);
drop trigger if exists trg_job_applications_updated_at on public.job_applications;
create trigger trg_job_applications_updated_at before update on public.job_applications
  for each row execute function public.set_updated_at();

create or replace function public.sync_job_posting_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_job uuid; hired_count integer; openings integer;
begin
  target_job := coalesce(new.job_id, old.job_id);
  select total_openings into openings from public.job_postings where id = target_job;
  if openings is null then return coalesce(new, old); end if;
  select count(*) into hired_count from public.job_applications
    where job_id = target_job and status = 'hired';
  update public.job_postings
    set status = case when hired_count >= openings then 'closed' else 'open' end
    where id = target_job;
  return coalesce(new, old);
end; $$;
drop trigger if exists trg_sync_job_posting_status on public.job_applications;
create trigger trg_sync_job_posting_status
  after insert or update or delete on public.job_applications
  for each row execute function public.sync_job_posting_status();

create table if not exists public.job_application_views (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.job_postings(id) on delete cascade,
  created_at timestamptz not null default now()
);
grant insert on public.job_application_views to anon;
grant select, insert on public.job_application_views to authenticated;
grant all on public.job_application_views to service_role;
alter table public.job_application_views enable row level security;
drop policy if exists "Anyone can log a view" on public.job_application_views;
create policy "Anyone can log a view" on public.job_application_views
  for insert to anon, authenticated with check (true);
drop policy if exists "Signed-in staff read views" on public.job_application_views;
create policy "Signed-in staff read views" on public.job_application_views
  for select to authenticated using (true);

alter table public.contact_submissions add column if not exists full_name text;
alter table public.contact_submissions add column if not exists company text;
alter table public.contact_submissions add column if not exists status text not null default 'new';
update public.contact_submissions set full_name = coalesce(full_name, name) where full_name is null;
alter table public.contact_submissions alter column name drop not null;
grant insert on public.contact_submissions to anon;
grant select, insert, update, delete on public.contact_submissions to authenticated;
grant all on public.contact_submissions to service_role;
alter table public.contact_submissions enable row level security;
drop policy if exists "Anyone can submit the contact form" on public.contact_submissions;
create policy "Anyone can submit the contact form" on public.contact_submissions
  for insert to anon, authenticated with check (true);
drop policy if exists "Signed-in staff manage contact submissions" on public.contact_submissions;
create policy "Signed-in staff manage contact submissions" on public.contact_submissions
  for all to authenticated using (true) with check (true);

drop policy if exists "Site media is readable" on storage.objects;
create policy "Site media is readable" on storage.objects
  for select to anon, authenticated using (bucket_id in ('resumes','portfolio-images'));
drop policy if exists "Anyone can upload a resume" on storage.objects;
create policy "Anyone can upload a resume" on storage.objects
  for insert to anon, authenticated with check (bucket_id in ('resumes','portfolio-images'));
drop policy if exists "Staff manage site media" on storage.objects;
create policy "Staff manage site media" on storage.objects
  for all to authenticated using (bucket_id in ('resumes','portfolio-images'))
  with check (bucket_id in ('resumes','portfolio-images'));
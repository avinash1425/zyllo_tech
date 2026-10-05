-- =====================================================================
-- 001_rls_for_browser_app.sql
-- Row Level Security + storage policies for the Vite/Lovable browser app.
--
-- WHY: the old Next.js app used a server-only secret (service) key that
-- bypassed RLS for every admin read/write and for the public contact /
-- apply / view-count writes. The browser app only has the publishable
-- (anon) key, so RLS is now the ONLY access control. Everything here is
-- deny-by-default; each policy below opens exactly one door.
--
-- PRE-REQUISITE: migrations/001..011 already applied (tables exist) and
-- supabase-blog-posts-migration.sql + supabase-blog-views-migration.sql.
-- This file only ADDS policies/functions; it is idempotent (safe to
-- re-run). It creates NO data except an empty public.admin_users table.
--
-- RUN IN: Supabase Dashboard > SQL Editor (as postgres). Run the whole
-- file at once. Do NOT run until you have read the verification list at
-- the bottom.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Admin allow-list + is_admin()
-- ---------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email   text,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- A signed-in user may read ONLY their own row (lets the UI ask "am I an
-- admin?"). Nobody can insert/update/delete through the API - admins are
-- added from the SQL editor (see commented INSERT below).
drop policy if exists "admin_users: read own row" on public.admin_users;
create policy "admin_users: read own row"
  on public.admin_users for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.admin_users from anon;
revoke insert, update, delete on public.admin_users from authenticated;

-- SECURITY DEFINER so it can read admin_users regardless of the caller's
-- RLS; STABLE so Postgres can cache it per statement; search_path is
-- locked so it can't be hijacked by a malicious schema/object.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- >>> ADD YOUR EXISTING ADMIN(S) - run separately, one per admin. <<<
-- Uncomment and replace the email with the real admin login email:
--
-- insert into public.admin_users (user_id, email)
-- select id, email from auth.users where email = 'admin@example.com'
-- on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- 1. Enable RLS on every table (no-op if already enabled)
-- ---------------------------------------------------------------------
alter table public.job_postings          enable row level security;
alter table public.job_applications      enable row level security;
alter table public.job_application_views enable row level security;
alter table public.contact_submissions   enable row level security;
alter table public.portfolio_projects    enable row level security;
alter table public.blog_posts            enable row level security;

-- ---------------------------------------------------------------------
-- 2. Drop the old permissive policies from migrations 001-006 and the
--    blog migration, then recreate tightened versions below.
-- ---------------------------------------------------------------------
drop policy if exists "Public can read open job postings" on public.job_postings;
drop policy if exists "Public can submit applications" on public.job_applications;
drop policy if exists "Public can submit contact form" on public.contact_submissions;
drop policy if exists "Public can read published portfolio projects" on public.portfolio_projects;
drop policy if exists "Public can log an application page view" on public.job_application_views;
drop policy if exists "Public can read published posts" on public.blog_posts;

-- ---------------------------------------------------------------------
-- 3. job_postings
-- ---------------------------------------------------------------------
-- Public: only OPEN postings are visible (closed/draft stay hidden).
drop policy if exists "job_postings: public read open" on public.job_postings;
create policy "job_postings: public read open"
  on public.job_postings for select
  to anon, authenticated
  using (status = 'open');

-- Admin: everything (including closed postings).
drop policy if exists "job_postings: admin all" on public.job_postings;
create policy "job_postings: admin all"
  on public.job_postings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 4. job_applications
-- ---------------------------------------------------------------------
-- Anon/authenticated visitors may INSERT only: pipeline status must be
-- 'new', admin-only fields must be empty, the job must be open, and text
-- fields are length-bounded. No public SELECT/UPDATE/DELETE, so
-- applicants' PII cannot be read back through the API.
drop policy if exists "job_applications: public insert" on public.job_applications;
create policy "job_applications: public insert"
  on public.job_applications for insert
  to anon, authenticated
  with check (
    status = 'new'
    and prospect_rating is null
    and char_length(btrim(full_name)) between 1 and 200
    and char_length(email) between 5 and 254
    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and (phone is null or char_length(phone) <= 50)
    and (cover_note is null or char_length(cover_note) <= 5000)
    and (resume_url is null or char_length(resume_url) <= 1000)
    and (experience_years is null or experience_years between 0 and 60)
    and exists (
      select 1 from public.job_postings j
      where j.id = job_id and j.status = 'open'
    )
  );

drop policy if exists "job_applications: admin all" on public.job_applications;
create policy "job_applications: admin all"
  on public.job_applications for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 5. job_application_views (apply-page view log; admin reads only)
-- ---------------------------------------------------------------------
drop policy if exists "job_application_views: public insert" on public.job_application_views;
create policy "job_application_views: public insert"
  on public.job_application_views for insert
  to anon, authenticated
  with check (
    exists (select 1 from public.job_postings j where j.id = job_id and j.status = 'open')
  );

drop policy if exists "job_application_views: admin all" on public.job_application_views;
create policy "job_application_views: admin all"
  on public.job_application_views for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 6. contact_submissions
-- ---------------------------------------------------------------------
-- Insert-only for visitors, with required fields, bounded lengths and
-- status forced to 'new'. No public read: customer contact details stay
-- private.
drop policy if exists "contact_submissions: public insert" on public.contact_submissions;
create policy "contact_submissions: public insert"
  on public.contact_submissions for insert
  to anon, authenticated
  with check (
    status = 'new'
    and char_length(btrim(full_name)) between 1 and 200
    and char_length(email) between 5 and 254
    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and char_length(btrim(message)) between 1 and 5000
    and (phone is null or char_length(phone) <= 50)
    and (company is null or char_length(company) <= 200)
    and (service is null or char_length(service) <= 200)
  );

drop policy if exists "contact_submissions: admin all" on public.contact_submissions;
create policy "contact_submissions: admin all"
  on public.contact_submissions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 7. portfolio_projects
-- ---------------------------------------------------------------------
drop policy if exists "portfolio_projects: public read published" on public.portfolio_projects;
create policy "portfolio_projects: public read published"
  on public.portfolio_projects for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "portfolio_projects: admin all" on public.portfolio_projects;
create policy "portfolio_projects: admin all"
  on public.portfolio_projects for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 8. blog_posts
-- ---------------------------------------------------------------------
-- Visitors cannot change `views` directly (no update policy); the view
-- counter goes through increment_blog_post_views() below.
drop policy if exists "blog_posts: public read published" on public.blog_posts;
create policy "blog_posts: public read published"
  on public.blog_posts for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "blog_posts: admin all" on public.blog_posts;
create policy "blog_posts: admin all"
  on public.blog_posts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 9. Functions
-- ---------------------------------------------------------------------
-- 9a. Blog view counter. Same name/signature the app already calls
--     (supabase.rpc("increment_blog_post_views", { post_slug })), now with
--     a locked search_path. Only bumps PUBLISHED posts, +1 per call.
create or replace function public.increment_blog_post_views(post_slug text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.blog_posts
     set views = views + 1
   where slug = post_slug
     and status = 'published';
end;
$$;

revoke all on function public.increment_blog_post_views(text) from public;
grant execute on function public.increment_blog_post_views(text) to anon, authenticated;

-- 9b. The old careers page computed "remaining openings" by reading all
--     'hired' job_applications with the service key. Anon can no longer
--     read applications, so expose ONLY the aggregate for OPEN jobs.
create or replace function public.job_openings_remaining()
returns table (job_id uuid, remaining integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select j.id,
         greatest(j.total_openings - coalesce(h.hired, 0), 0)::integer
    from public.job_postings j
    left join (
      select a.job_id, count(*)::integer as hired
        from public.job_applications a
       where a.status = 'hired'
       group by a.job_id
    ) h on h.job_id = j.id
   where j.status = 'open';
$$;

revoke all on function public.job_openings_remaining() from public;
grant execute on function public.job_openings_remaining() to anon, authenticated;

-- 9c. The auto-open/close trigger function updates job_postings. It used
--     to run as whoever inserted the application (service key). A public
--     applicant is anon and has no UPDATE rights on job_postings, so the
--     recompute would silently do nothing. Make it SECURITY DEFINER with
--     a locked search_path (body unchanged from migration 007).
create or replace function public.recompute_job_status(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total_openings integer;
  v_selected_count integer;
begin
  select total_openings into v_total_openings
    from public.job_postings where id = p_job_id;

  select count(*) into v_selected_count
    from public.job_applications
   where job_id = p_job_id and status = 'hired';

  update public.job_postings
     set status = case
       when v_selected_count >= v_total_openings then 'closed'
       else 'open'
     end
   where id = p_job_id;
end;
$$;

-- Not callable via the API (it is only invoked by triggers).
revoke all on function public.recompute_job_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. Storage
-- ---------------------------------------------------------------------
-- Make 'resumes' PRIVATE (it was public in migration 002 and the old code
-- stored the public URL in job_applications.resume_url). Resumes contain
-- PII; admins will read them via signed URLs. Also enforce PDF and 5MB at
-- the bucket level.
update storage.buckets
   set public = false,
       file_size_limit = 5242880,
       allowed_mime_types = array['application/pdf']
 where id = 'resumes';

-- Old policies from migrations 002/005:
drop policy if exists "Public can upload resumes" on storage.objects;
drop policy if exists "Public can view resumes" on storage.objects;
drop policy if exists "Public can view portfolio images" on storage.objects;

-- resumes: visitors can UPLOAD only, only a .pdf under "<job_uuid>/".
-- (No select/update/delete for anon, so uploads cannot be listed,
-- overwritten or removed.)
drop policy if exists "resumes: anon upload pdf" on storage.objects;
create policy "resumes: anon upload pdf"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'resumes'
    and lower(name) like '%.pdf'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

drop policy if exists "resumes: admin read" on storage.objects;
create policy "resumes: admin read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'resumes' and public.is_admin());

drop policy if exists "resumes: admin delete" on storage.objects;
create policy "resumes: admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'resumes' and public.is_admin());

-- portfolio-images: public bucket (public URLs work without policies, but
-- an explicit SELECT policy is kept so list()/download() also work).
drop policy if exists "portfolio-images: public read" on storage.objects;
create policy "portfolio-images: public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'portfolio-images');

drop policy if exists "portfolio-images: admin insert" on storage.objects;
create policy "portfolio-images: admin insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'portfolio-images' and public.is_admin());

drop policy if exists "portfolio-images: admin update" on storage.objects;
create policy "portfolio-images: admin update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'portfolio-images' and public.is_admin())
  with check (bucket_id = 'portfolio-images' and public.is_admin());

drop policy if exists "portfolio-images: admin delete" on storage.objects;
create policy "portfolio-images: admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'portfolio-images' and public.is_admin());

commit;

-- =====================================================================
-- VERIFICATION CHECKLIST (run after applying; use the SQL editor and the
-- browser app / curl with the anon key)
-- =====================================================================
-- [ ] 1. RLS on everywhere (expect rowsecurity = true for all 7 rows):
--        select tablename, rowsecurity from pg_tables
--         where schemaname='public' and tablename in
--         ('job_postings','job_applications','job_application_views',
--          'contact_submissions','portfolio_projects','blog_posts','admin_users');
-- [ ] 2. Policy list looks right:
--        select tablename, policyname, cmd, roles from pg_policies
--         where schemaname in ('public','storage') order by 1,2;
-- [ ] 3. Admin added: select * from public.admin_users;  (>= 1 row)
-- [ ] 4. As ANON (no login): GET blog_posts returns only published;
--        job_postings only open; portfolio_projects only published.
-- [ ] 5. As ANON: SELECT on contact_submissions / job_applications /
--        job_application_views returns [] (RLS filters, no error).
-- [ ] 6. As ANON: INSERT into contact_submissions with valid data works;
--        with empty message, bad email or status='contacted' is rejected.
-- [ ] 7. As ANON: INSERT job_applications for an open job works; for a
--        closed job, or status='hired', is rejected.
-- [ ] 8. As ANON: rpc increment_blog_post_views('<slug>') bumps views by 1;
--        UPDATE blog_posts directly affects 0 rows.
-- [ ] 9. As ANON: storage upload of "<job-uuid>/x.pdf" to 'resumes' works;
--        list/download/delete from 'resumes' is denied; non-pdf rejected.
-- [ ] 10. Logged in as the admin: all tables fully readable/writable,
--        resumes createSignedUrl works, portfolio-images upload works.
-- [ ] 11. Logged in as a NON-admin auth user (if any exist): behaves like
--        anon (no admin access). Consider disabling public sign-ups in
--        Auth settings.
-- [ ] 12. rpc job_openings_remaining() returns one row per open job.
-- [ ] 13. Existing rows: job_applications.resume_url holds old PUBLIC URLs
--        of the form .../storage/v1/object/public/resumes/<path>; these 404
--        now that the bucket is private. The admin UI must derive the
--        object path (everything after "/resumes/") and call
--        createSignedUrl. Check any such rows:
--        select count(*) from job_applications where resume_url like '%/object/public/resumes/%';
-- =====================================================================

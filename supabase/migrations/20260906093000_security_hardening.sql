-- Security hardening pass (2026-09-06).
--
-- Four independent fixes, each in its own section below:
--   1. Make the 'resumes' storage bucket private (PII).
--   2. Stop anonymous applicants from setting admin-only columns on
--      public.job_applications.
--   3. Restore least-privilege public reads on public.job_postings
--      (open postings only, as the original 001 migration intended).
--   4. Create public.newsletter_subscribers to back the site's
--      newsletter signup form.
--
-- Everything here is idempotent-safe: policies are dropped before being
-- recreated, table creation uses IF NOT EXISTS, and the bucket update is
-- a no-op when already applied.

-- ---------------------------------------------------------------------
-- 1. resumes bucket: private.
--
-- 002_resume_storage.sql created the bucket with public = true, which
-- serves every uploaded resume (names, phone numbers, work history) via
-- unauthenticated public-object URLs regardless of RLS — and the object
-- path is guessable ({jobId}/{timestamp}-{name}.pdf). The app already
-- assumes a private bucket (src/lib/actions/apply.js stores the storage
-- path, and admins open resumes through signed URLs backed by the
-- "Admins manage site media" policy), so this only closes the hole and
-- prevents the 002 state from ever being re-applied to a fresh project.
-- ---------------------------------------------------------------------

update storage.buckets set public = false where id = 'resumes';

-- ---------------------------------------------------------------------
-- 2. job_applications: applicants can only insert applicant data.
--
-- The current "Anyone can apply" policy is WITH CHECK (true), so anyone
-- holding the browser-bundled anon key can insert rows with arbitrary
-- values for the admin-only pipeline columns — including
-- status = 'hired', which the trg_sync_job_posting_status trigger
-- counts against total_openings and would auto-CLOSE a live job posting
-- (an unauthenticated denial-of-service on hiring).
--
-- New check, matched to what the public apply form actually submits
-- (src/lib/actions/apply.js):
--   * status must be 'new' — the column default; the form never sends it.
--   * prospect_rating must be NULL — admin-only star rating, never set
--     anywhere in the public app.
--   * experience_years IS collected on the public form (a required
--     field), so it stays insertable — but bounded to the same 0..60
--     range the form enforces client-side.
-- Admin inserts are unaffected: the separate "Admins manage
-- applications" FOR ALL policy is OR'd with this one.
-- ---------------------------------------------------------------------

drop policy if exists "Anyone can apply" on public.job_applications;
create policy "Anyone can apply" on public.job_applications
  for insert to anon, authenticated
  with check (
    status = 'new'
    and prospect_rating is null
    and (experience_years is null or experience_years between 0 and 60)
  );

-- ---------------------------------------------------------------------
-- 3. job_postings: public can read open postings only.
--
-- 001_careers.sql scoped public reads to status = 'open'; the Lovable
-- rebuild (20260811051158) widened it to USING (true), leaking closed
-- postings. Every public consumer already filters on status = 'open'
-- explicitly (src/sections/OpenPositions.jsx, src/pages/JobApplyPage.jsx,
-- scripts/generate-sitemap.mjs), and the admin join in
-- SubmissionsPanel.jsx runs as an authenticated admin — so nothing
-- public needs closed rows and 'open'-only is the right scope. The
-- "Admins manage job postings" FOR ALL policy is untouched and keeps
-- full admin visibility.
-- ---------------------------------------------------------------------

drop policy if exists "Anyone can read job postings" on public.job_postings;
create policy "Anyone can read job postings" on public.job_postings
  for select to anon, authenticated
  using (status = 'open');

-- ---------------------------------------------------------------------
-- 4. newsletter_subscribers: table + RLS.
--
-- Shape matches src/integrations/supabase/types.ts exactly:
-- id uuid, email text, is_active boolean, subscribed_at timestamptz —
-- with email unique so duplicate signups fail cleanly (the form treats
-- the 23505 error as "already subscribed").
--
-- Access model: anonymous visitors may only INSERT (and cannot insert a
-- pre-deactivated row); admins may read and delete via the existing
-- public.has_role(auth.uid(), 'admin') pattern. No public SELECT — the
-- subscriber list is PII and must not be readable with the anon key.
-- ---------------------------------------------------------------------

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  is_active boolean not null default true,
  subscribed_at timestamptz not null default now()
);

grant insert on public.newsletter_subscribers to anon;
grant select, insert, delete on public.newsletter_subscribers to authenticated;
grant all on public.newsletter_subscribers to service_role;

alter table public.newsletter_subscribers enable row level security;

drop policy if exists "Anyone can subscribe" on public.newsletter_subscribers;
create policy "Anyone can subscribe" on public.newsletter_subscribers
  for insert to anon, authenticated
  with check (is_active = true);

drop policy if exists "Admins read newsletter subscribers" on public.newsletter_subscribers;
create policy "Admins read newsletter subscribers" on public.newsletter_subscribers
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Admins delete newsletter subscribers" on public.newsletter_subscribers;
create policy "Admins delete newsletter subscribers" on public.newsletter_subscribers
  for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

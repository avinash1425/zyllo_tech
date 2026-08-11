-- Stops applicant resumes from being world-readable.
--
-- Migration 20260811051158 created this policy:
--
--   create policy "Site media is readable" on storage.objects
--     for select to anon, authenticated using (bucket_id in ('resumes','portfolio-images'));
--
-- which grants the `anon` role SELECT on the 'resumes' bucket. Resume PDFs
-- carry applicants' names, phone numbers, addresses and work history, and
-- the object path is guessable ({jobId}/{timestamp}-{safe-name}.pdf). Since
-- the publishable key ships in the browser bundle, anyone could read those
-- objects straight from storage — the /api/media allow-list is not a barrier.
--
-- Fix: public read is narrowed to 'portfolio-images' (the only bucket whose
-- contents are genuinely public — they're rendered on /portfolio). Resumes
-- stay readable to signed-in staff through the existing "Staff manage site
-- media" policy (`for all to authenticated`), which is what the admin
-- applicant viewer and /api/media/resumes/* rely on. Anonymous requests for
-- a resume now fail the policy, so the media route returns 404.
--
-- Run in Supabase Dashboard > SQL Editor > New query.

drop policy if exists "Site media is readable" on storage.objects;

create policy "Site media is readable" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'portfolio-images');

-- Applicants must still be able to submit a resume without an account, but
-- they should not be able to write into the portfolio image bucket. The old
-- policy allowed anon INSERT into both (Lovable flags this as "Resume
-- uploads lack ownership scoping"). Anonymous writes are now resumes-only;
-- staff keep full write access via "Staff manage site media".
drop policy if exists "Anyone can upload a resume" on storage.objects;

create policy "Anyone can upload a resume" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'resumes');

-- Closes the "Public uploads allowed into portfolio-images bucket" finding
-- from Lovable's security scan.
--
-- The anonymous-insert policy created in 20260811051158 covers BOTH storage
-- buckets:
--
--   create policy "Anyone can upload a resume" on storage.objects
--     for insert to anon, authenticated
--     with check (bucket_id in ('resumes','portfolio-images'));
--
-- Only 'resumes' needs anonymous inserts (job applicants upload a PDF from
-- the public careers form without an account — src/lib/actions/apply.js).
-- Portfolio images are uploaded exclusively from the admin dashboard, which
-- already passes through the separate "Admins manage site media" policy
-- (FOR ALL to authenticated + has_role admin). Policies are OR'd, so
-- narrowing this one cannot affect admin uploads.
--
-- Run in Supabase Dashboard > SQL Editor > New query.

begin;

drop policy if exists "Anyone can upload a resume" on storage.objects;
create policy "Anyone can upload a resume" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'resumes');

commit;

-- Verify afterwards:
--   select policyname, roles, with_check from pg_policies
--   where tablename = 'objects' and policyname = 'Anyone can upload a resume';
-- with_check should read (bucket_id = 'resumes'::text).

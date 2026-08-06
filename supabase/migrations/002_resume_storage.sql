-- Storage bucket for resume PDF uploads on job applications.
-- Run this in Supabase Dashboard > SQL Editor > New query, then Run.

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', true)
on conflict (id) do nothing;

-- Allow anyone (anon key) to upload a resume — needed since the public
-- apply form submits without a logged-in user. Uploads only, no listing
-- or deleting from the client.
create policy "Public can upload resumes"
  on storage.objects for insert
  with check (bucket_id = 'resumes');

-- Allow public read access so resume links work when opened by admins.
create policy "Public can view resumes"
  on storage.objects for select
  using (bucket_id = 'resumes');

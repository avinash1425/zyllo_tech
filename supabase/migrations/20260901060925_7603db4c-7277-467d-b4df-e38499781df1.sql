drop policy if exists "Anyone can upload a resume" on storage.objects;
create policy "Anyone can upload a resume" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'resumes');
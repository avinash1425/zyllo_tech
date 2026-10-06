
DROP POLICY IF EXISTS "Anyone can submit career application" ON public.career_applications;
CREATE POLICY "Anyone can submit career application" ON public.career_applications FOR INSERT TO anon, authenticated
WITH CHECK (
  consent = true
  AND char_length(btrim(full_name)) BETWEEN 1 AND 200
  AND char_length(email) BETWEEN 5 AND 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  AND char_length(phone) <= 50 AND char_length(role) <= 200 AND char_length(location) <= 200
  AND char_length(experience) <= 200 AND char_length(cover_letter) <= 10000
  AND (linkedin_url IS NULL OR char_length(linkedin_url) <= 500)
  AND (resume_path IS NULL OR char_length(resume_path) <= 1000)
);

DROP POLICY IF EXISTS "Anyone can read job postings" ON public.job_postings;
CREATE POLICY "Anyone can read job postings" ON public.job_postings FOR SELECT TO anon, authenticated
USING (status IN ('open', 'closed'));

DROP POLICY IF EXISTS "Anyone can log a view" ON public.job_application_views;
CREATE POLICY "Anyone can log a view" ON public.job_application_views FOR INSERT TO anon, authenticated
WITH CHECK (job_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.job_postings j WHERE j.id = job_id));

DROP POLICY IF EXISTS "Anyone can subscribe to newsletter" ON public.newsletter_subscribers;
CREATE POLICY "Anyone can subscribe to newsletter" ON public.newsletter_subscribers FOR INSERT TO anon, authenticated
WITH CHECK (is_active = true AND char_length(email) BETWEEN 5 AND 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

DROP POLICY IF EXISTS "Anyone can apply" ON public.job_applications;
CREATE POLICY "Anyone can apply" ON public.job_applications FOR INSERT TO anon, authenticated
WITH CHECK (
  status = 'new' AND prospect_rating IS NULL
  AND char_length(btrim(full_name)) BETWEEN 1 AND 200
  AND char_length(email) BETWEEN 5 AND 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  AND (phone IS NULL OR char_length(phone) <= 50)
  AND (cover_note IS NULL OR char_length(cover_note) <= 5000)
  AND (resume_url IS NULL OR char_length(resume_url) <= 1000)
  AND (experience_years IS NULL OR experience_years BETWEEN 0 AND 60)
);

DROP POLICY IF EXISTS "Anyone can submit contact form" ON public.contact_submissions;
DROP POLICY IF EXISTS "Anyone can submit the contact form" ON public.contact_submissions;
CREATE POLICY "Anyone can submit the contact form" ON public.contact_submissions FOR INSERT TO anon, authenticated
WITH CHECK (
  status = 'new'
  AND char_length(email) BETWEEN 5 AND 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  AND char_length(btrim(message)) BETWEEN 1 AND 5000
  AND (full_name IS NULL OR char_length(full_name) <= 200)
  AND (name IS NULL OR char_length(name) <= 200)
  AND (phone IS NULL OR char_length(phone) <= 50)
  AND (company IS NULL OR char_length(company) <= 200)
  AND (service IS NULL OR char_length(service) <= 200)
  AND (subject IS NULL OR char_length(subject) <= 300)
);

DROP POLICY IF EXISTS "Anyone can upload resumes" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload a resume" ON storage.objects;
CREATE POLICY "Anyone can upload a resume" ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'resumes'
  AND lower(name) LIKE '%.pdf'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (SELECT 1 FROM public.job_postings j WHERE j.id::text = (storage.foldername(name))[1])
);

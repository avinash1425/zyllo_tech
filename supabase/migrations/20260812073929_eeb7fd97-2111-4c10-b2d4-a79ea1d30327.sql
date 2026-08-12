DROP POLICY IF EXISTS "Site media is readable" ON storage.objects;
DROP POLICY IF EXISTS "Staff manage site media" ON storage.objects;
CREATE POLICY "Public can read portfolio images"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'portfolio-images');
CREATE POLICY "Admins manage site media"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id IN ('resumes', 'portfolio-images')
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
)
WITH CHECK (
  bucket_id IN ('resumes', 'portfolio-images')
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Signed-in staff manage applications" ON public.job_applications;
CREATE POLICY "Admins manage applications"
ON public.job_applications FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Signed-in staff read views" ON public.job_application_views;
CREATE POLICY "Admins read application views"
ON public.job_application_views FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Signed-in staff manage contact submissions" ON public.contact_submissions;
CREATE POLICY "Admins manage contact submissions"
ON public.contact_submissions FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Signed-in staff manage posts" ON public.blog_posts;
CREATE POLICY "Admins manage blog posts"
ON public.blog_posts FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Signed-in staff manage projects" ON public.portfolio_projects;
CREATE POLICY "Admins manage portfolio projects"
ON public.portfolio_projects FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Signed-in staff manage job postings" ON public.job_postings;
CREATE POLICY "Admins manage job postings"
ON public.job_postings FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
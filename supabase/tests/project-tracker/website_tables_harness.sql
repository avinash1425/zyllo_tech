-- LOCAL TEST HARNESS ONLY. NEVER APPLY TO A REAL SUPABASE PROJECT.
-- After supabase/schema/000_full_schema.sql (with its pgcrypto line removed by
-- start.mjs), give website admins (the emulated live is_admin()) full access
-- and the public read access the site needs, so existing admin pages and
-- public pages can be smoke-tested next to Project Tracker. Approximates live;
-- the real live policies are managed in the Lovable project.
do $$
declare t text;
begin
  foreach t in array array['job_postings', 'job_applications', 'job_application_views', 'contact_submissions', 'portfolio_projects', 'blog_posts'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('create policy harness_admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    end if;
  end loop;
end $$;
create policy harness_public_jobs on public.job_postings for select to anon, authenticated using (true);
create policy harness_public_portfolio on public.portfolio_projects for select to anon, authenticated using (true);
create policy harness_public_blog on public.blog_posts for select to anon, authenticated using (true);
insert into public.blog_posts (slug, title, excerpt, content, status)
select 'synthetic-post', 'Synthetic test post', 'Test excerpt', 'Synthetic body text.', 'published'
where to_regclass('public.blog_posts') is not null and not exists (select 1 from public.blog_posts);

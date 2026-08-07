-- Adds an atomic view-counter function for blog posts.
-- Run this in the Supabase SQL editor AFTER supabase-blog-posts-migration.sql
-- has already been run (Project → SQL Editor → New query → paste → Run).

create or replace function increment_blog_post_views(post_slug text)
returns void as $$
begin
  update blog_posts
  set views = views + 1
  where slug = post_slug
    and status = 'published';
end;
$$ language plpgsql security definer;

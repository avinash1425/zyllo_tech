-- Blog posts table for the admin blog manager (/admin/blog).
-- Run this in the Supabase SQL editor (Project → SQL Editor → New query).

create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  category text not null default 'Engineering',
  author text not null default 'Zyllo Engineering Team',
  excerpt text not null default '',
  content text not null default '',
  featured_image_url text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  views integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at current on every edit.
create or replace function set_blog_posts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_blog_posts_updated_at on blog_posts;
create trigger trg_blog_posts_updated_at
  before update on blog_posts
  for each row
  execute function set_blog_posts_updated_at();

-- Fast lookups for the public blog page (published posts, newest first)
-- and the slug-based detail route.
create index if not exists idx_blog_posts_status_created_at
  on blog_posts (status, created_at desc);

create unique index if not exists idx_blog_posts_slug
  on blog_posts (slug);

-- Row Level Security: the admin panel uses the server-side secret key
-- (bypasses RLS entirely, same as job_postings), so this just blocks
-- anonymous/public API access to writes. Public reads of published posts
-- go through the server client too (see src/app/blog/page.js), so a
-- permissive anon read policy isn't required, but is included in case
-- you ever query this table from the browser client.
alter table blog_posts enable row level security;

drop policy if exists "Public can read published posts" on blog_posts;
create policy "Public can read published posts"
  on blog_posts for select
  using (status = 'published');

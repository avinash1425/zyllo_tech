-- Portfolio / case study projects shown on the public /portfolio page.
-- One table drives both the simple "Featured Projects" cards (title, tag,
-- description, image) and the richer "Case Studies" section (adds
-- challenge/solution/result). A project appears as a Case Study once all
-- three of those fields are filled in — otherwise it's just a Featured card.
create table if not exists public.portfolio_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  tag text not null,
  description text not null,
  challenge text,
  solution text,
  result text,
  image_url text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.portfolio_projects enable row level security;

-- Public can read only published projects.
create policy "Public can read published portfolio projects"
  on public.portfolio_projects
  for select
  using (status = 'published');

-- No public insert/update/delete — only the server (secret-key client)
-- manages projects, via the admin panel.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portfolio_projects_set_updated_at on public.portfolio_projects;
create trigger portfolio_projects_set_updated_at
  before update on public.portfolio_projects
  for each row
  execute function public.set_updated_at();

-- Storage bucket for project images.
insert into storage.buckets (id, name, public)
values ('portfolio-images', 'portfolio-images', true)
on conflict (id) do nothing;

create policy "Public can view portfolio images"
  on storage.objects
  for select
  using (bucket_id = 'portfolio-images');

-- Uploads happen only via the admin panel's server-side (secret-key)
-- client, which bypasses storage RLS — no public insert policy needed.

-- Tracks every page load of a job's apply page (/careers/[id]), so the
-- admin dashboard can show a completion rate: submitted applications ÷
-- page views. "Started" = loaded the apply page at all (no de-dup, no
-- interaction tracking) — the simplest signal, chosen deliberately over
-- more precise but more complex alternatives (per-field interaction,
-- session de-dup). Run in Supabase Dashboard > SQL Editor > New query.

create table if not exists job_application_views (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job_postings(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists job_application_views_job_id_idx
  on job_application_views(job_id);

alter table job_application_views enable row level security;

-- Anyone loading a public apply page can log a view (this is exactly
-- what recordApplicationView() does, fire-and-forget, from the public
-- careers/[id]/page.js Server Component).
create policy "Public can log an application page view"
  on job_application_views
  for insert
  with check (true);

-- No public select/update/delete — only the server (secret-key client,
-- which bypasses RLS) reads this data, for the admin dashboard's
-- completion-rate metric.

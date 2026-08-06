-- Careers backend: job postings + job applications.
-- Run this in Supabase Dashboard > SQL Editor > New query, then Run.

create table if not exists job_postings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text not null,
  location text not null default 'Remote / India',
  employment_type text not null default 'Full-time',
  description text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job_postings(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  resume_url text,
  cover_note text,
  created_at timestamptz not null default now()
);

create index if not exists job_applications_job_id_idx on job_applications(job_id);

-- Row Level Security: public visitors can read open job postings and
-- submit applications, but cannot read applications back, edit postings,
-- or see closed postings. Admin writes go through the server-only secret
-- key client, which bypasses RLS entirely.
alter table job_postings enable row level security;
alter table job_applications enable row level security;

create policy "Public can read open job postings"
  on job_postings for select
  using (status = 'open');

create policy "Public can submit applications"
  on job_applications for insert
  with check (true);

-- Keep updated_at fresh on job_postings edits.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists job_postings_set_updated_at on job_postings;
create trigger job_postings_set_updated_at
  before update on job_postings
  for each row
  execute function set_updated_at();

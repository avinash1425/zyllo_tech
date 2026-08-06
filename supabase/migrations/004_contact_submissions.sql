-- Contact form submissions from the public /contact page.
create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  company text,
  service text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.contact_submissions enable row level security;

-- Anyone can submit the public contact form.
create policy "Public can submit contact form"
  on public.contact_submissions
  for insert
  with check (true);

-- No public select/update/delete policy — only the server (secret-key
-- client, which bypasses RLS) can read or manage submissions. This keeps
-- customer contact details private from anonymous visitors.

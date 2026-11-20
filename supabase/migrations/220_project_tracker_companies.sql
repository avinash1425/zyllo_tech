-- =====================================================================
-- 220_project_tracker_companies.sql — Project Tracker: client companies
-- =====================================================================
-- First table of the Project Tracker admin module (/admin/project-tracker).
-- Holds the client companies Zyllo Tech works for. Projects will hang off
-- this table later.
--
-- Access: website admins only, through the same public.is_admin() check the
-- admin area already uses for its login gate. Anonymous visitors, employees
-- and any other signed-in user can neither read nor write.
--
-- Touches nothing else: one new table, its trigger and its policies.
-- Idempotent (safe to re-run). Rollback: supabase/rollbacks/220_rollback_project_tracker_companies.sql
-- =====================================================================

create table if not exists public.pt_companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 200),
  industry       text check (industry is null or length(industry) <= 120),
  contact_person text check (contact_person is null or length(contact_person) <= 120),
  email          text check (email is null or (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone          text check (phone is null or length(phone) <= 40),
  website        text check (website is null or length(website) <= 300),
  gstin          text check (gstin is null or gstin ~ '^[0-9A-Z]{15}$'),
  address        text check (address is null or length(address) <= 500),
  city           text check (city is null or length(city) <= 120),
  state          text check (state is null or length(state) <= 120),
  country        text not null default 'India' check (length(country) <= 120),
  status         text not null default 'active' check (status in ('active', 'inactive')),
  notes          text check (notes is null or length(notes) <= 2000),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One company per name (case- and space-insensitive).
create unique index if not exists pt_companies_name_key
  on public.pt_companies (lower(btrim(name)));

create or replace function public.pt_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pt_companies_set_updated_at on public.pt_companies;
create trigger pt_companies_set_updated_at
  before update on public.pt_companies
  for each row
  execute function public.pt_set_updated_at();

alter table public.pt_companies enable row level security;

revoke all on public.pt_companies from anon;
grant select, insert, update, delete on public.pt_companies to authenticated;

drop policy if exists "pt_companies admin select" on public.pt_companies;
create policy "pt_companies admin select" on public.pt_companies
  for select to authenticated using (public.is_admin());

drop policy if exists "pt_companies admin insert" on public.pt_companies;
create policy "pt_companies admin insert" on public.pt_companies
  for insert to authenticated with check (public.is_admin());

drop policy if exists "pt_companies admin update" on public.pt_companies;
create policy "pt_companies admin update" on public.pt_companies
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "pt_companies admin delete" on public.pt_companies;
create policy "pt_companies admin delete" on public.pt_companies
  for delete to authenticated using (public.is_admin());

-- 231: Employee Portal — My Profile.
--
-- Work details (set by the company, read-only for the employee) on ep_employees:
--   department, designation, reporting_manager_id, date_of_joining,
--   employment_type, work_location.
-- Personal details (editable by the employee) in ep_employee_profiles.
-- Emergency contacts (editable by the employee, 1–3) in ep_emergency_contacts.
--
-- Employees read through ep_my_profile() and write only through
-- ep_update_my_profile() / ep_save_my_emergency_contacts(). Admins
-- (public.is_admin()) can read everything.
-- Rollback: supabase/rollbacks/231_rollback_employee_profile.sql

begin;

-- ---------------------------------------------------------------- work details
alter table public.ep_employees
  add column if not exists department           text check (department is null or length(btrim(department)) between 1 and 80),
  add column if not exists designation          text check (designation is null or length(btrim(designation)) between 1 and 80),
  add column if not exists reporting_manager_id uuid references public.ep_employees (id) on delete set null,
  add column if not exists date_of_joining      date,
  add column if not exists employment_type      text check (employment_type is null or employment_type in ('full_time', 'part_time', 'intern', 'contract')),
  add column if not exists work_location        text check (work_location is null or length(btrim(work_location)) between 1 and 120);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ep_employees_not_own_manager') then
    alter table public.ep_employees add constraint ep_employees_not_own_manager check (reporting_manager_id is distinct from id);
  end if;
end $$;

-- ---------------------------------------------------------------- personal details
create table if not exists public.ep_employee_profiles (
  employee_id       uuid primary key references public.ep_employees (id) on delete cascade,
  date_of_birth     date,
  gender            text check (gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  blood_group       text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  marital_status    text check (marital_status in ('single', 'married', 'divorced', 'widowed', 'prefer_not_to_say')),
  nationality       text check (length(btrim(nationality)) between 1 and 60),
  personal_email    text check (personal_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(personal_email) <= 254),
  phone             text check (phone ~ '^\+?[0-9 ()-]{7,20}$'),
  alternate_phone   text check (alternate_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  current_address   text check (length(btrim(current_address)) between 1 and 500),
  permanent_address text check (length(btrim(permanent_address)) between 1 and 500),
  updated_at        timestamptz not null default now(),
  constraint ep_profiles_dob_range check (
    date_of_birth is null or date_of_birth between date '1920-01-01' and current_date - interval '14 years'
  )
);

-- ---------------------------------------------------------------- emergency contacts
create table if not exists public.ep_emergency_contacts (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.ep_employees (id) on delete cascade,
  sort_order      smallint not null check (sort_order between 1 and 3),
  name            text not null check (length(btrim(name)) between 1 and 120),
  relationship    text not null check (length(btrim(relationship)) between 1 and 40),
  phone           text not null check (phone ~ '^\+?[0-9 ()-]{7,20}$'),
  alternate_phone text check (alternate_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  created_at      timestamptz not null default now(),
  unique (employee_id, sort_order)
);

comment on table public.ep_employee_profiles is 'Employee Portal: personal details, edited by the employee via ep_update_my_profile().';
comment on table public.ep_emergency_contacts is 'Employee Portal: 1-3 emergency contacts per employee (sort_order 1 = primary).';

-- ---------------------------------------------------------------- RLS (read only; writes via RPC)
alter table public.ep_employee_profiles  enable row level security;
alter table public.ep_emergency_contacts enable row level security;
revoke all on public.ep_employee_profiles, public.ep_emergency_contacts from anon, authenticated;
grant select on public.ep_employee_profiles, public.ep_emergency_contacts to authenticated;

drop policy if exists ep_profiles_read on public.ep_employee_profiles;
create policy ep_profiles_read on public.ep_employee_profiles for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid())));

drop policy if exists ep_contacts_read on public.ep_emergency_contacts;
create policy ep_contacts_read on public.ep_emergency_contacts for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid())));

-- ---------------------------------------------------------------- helpers
create or replace function public.ep_current_employee_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.ep_employees where user_id = auth.uid() and is_active;
$$;
revoke all on function public.ep_current_employee_id() from public, anon, authenticated;

-- ---------------------------------------------------------------- read
create or replace function public.ep_my_profile()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'work', jsonb_build_object(
        'employee_code',   e.employee_code,
        'full_name',       e.full_name,
        'work_email',      u.email,
        'department',      e.department,
        'designation',     e.designation,
        'date_of_joining', e.date_of_joining,
        'employment_type', e.employment_type,
        'work_location',   e.work_location,
        'manager', case when m.id is null then null else jsonb_build_object(
          'full_name', m.full_name, 'employee_code', m.employee_code, 'designation', m.designation) end
      ),
      'personal', coalesce((
        select to_jsonb(p) - 'employee_id' from public.ep_employee_profiles p where p.employee_id = e.id
      ), '{}'::jsonb),
      'emergency_contacts', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name', c.name, 'relationship', c.relationship,
                 'phone', c.phone, 'alternate_phone', c.alternate_phone) order by c.sort_order)
        from public.ep_emergency_contacts c where c.employee_id = e.id
      ), '[]'::jsonb)
    )
    from public.ep_employees e
    left join auth.users u on u.id = e.user_id
    left join public.ep_employees m on m.id = e.reporting_manager_id
    where e.id = v_emp
  );
end $$;

-- ---------------------------------------------------------------- write: personal details
-- p: { date_of_birth, gender, blood_group, marital_status, nationality,
--      personal_email, phone, alternate_phone, current_address, permanent_address }
-- Empty strings are saved as null. Table CHECKs do the validation.
create or replace function public.ep_update_my_profile(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  f text;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid profile data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('date_of_birth', 'gender', 'blood_group', 'marital_status', 'nationality', 'personal_email',
                 'phone', 'alternate_phone', 'current_address', 'permanent_address') then
      raise exception 'Field % cannot be changed here.', f using errcode = '42501';
    end if;
  end loop;

  insert into public.ep_employee_profiles as t (
    employee_id, date_of_birth, gender, blood_group, marital_status, nationality,
    personal_email, phone, alternate_phone, current_address, permanent_address, updated_at)
  values (
    v_emp,
    nullif(btrim(p ->> 'date_of_birth'), '')::date,
    nullif(btrim(p ->> 'gender'), ''),
    nullif(btrim(p ->> 'blood_group'), ''),
    nullif(btrim(p ->> 'marital_status'), ''),
    nullif(btrim(p ->> 'nationality'), ''),
    lower(nullif(btrim(p ->> 'personal_email'), '')),
    nullif(btrim(p ->> 'phone'), ''),
    nullif(btrim(p ->> 'alternate_phone'), ''),
    nullif(btrim(p ->> 'current_address'), ''),
    nullif(btrim(p ->> 'permanent_address'), ''),
    now())
  on conflict (employee_id) do update set
    date_of_birth     = excluded.date_of_birth,
    gender            = excluded.gender,
    blood_group       = excluded.blood_group,
    marital_status    = excluded.marital_status,
    nationality       = excluded.nationality,
    personal_email    = excluded.personal_email,
    phone             = excluded.phone,
    alternate_phone   = excluded.alternate_phone,
    current_address   = excluded.current_address,
    permanent_address = excluded.permanent_address,
    updated_at        = now();

  return public.ep_my_profile();
end $$;

-- ---------------------------------------------------------------- write: emergency contacts
-- p: [ { name, relationship, phone, alternate_phone }, ... ] (1–3, first = primary).
-- Replaces the whole list.
create or replace function public.ep_save_my_emergency_contacts(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  n int;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'Invalid emergency contacts.' using errcode = '22023';
  end if;
  n := jsonb_array_length(p);
  if n < 1 or n > 3 then
    raise exception 'Add 1 to 3 emergency contacts.' using errcode = '22023';
  end if;

  delete from public.ep_emergency_contacts where employee_id = v_emp;
  insert into public.ep_emergency_contacts (employee_id, sort_order, name, relationship, phone, alternate_phone)
  select v_emp, x.ord::smallint,
         btrim(x.c ->> 'name'), btrim(x.c ->> 'relationship'), btrim(x.c ->> 'phone'),
         nullif(btrim(x.c ->> 'alternate_phone'), '')
  from jsonb_array_elements(p) with ordinality as x(c, ord);

  return public.ep_my_profile();
end $$;

revoke all on function public.ep_my_profile(), public.ep_update_my_profile(jsonb), public.ep_save_my_emergency_contacts(jsonb)
  from public, anon;
grant execute on function public.ep_my_profile(), public.ep_update_my_profile(jsonb), public.ep_save_my_emergency_contacts(jsonb)
  to authenticated;

notify pgrst, 'reload schema';

commit;

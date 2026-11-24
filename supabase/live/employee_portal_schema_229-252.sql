-- =====================================================================================
-- Employee Portal — database STRUCTURE for the live website project (no data).
-- = migrations 229 … 252 from supabase/migrations, in order, as ONE transaction:
--   either everything is created, or nothing is.
--
-- Creates: the ep_* tables (employees, attendance, profiles, emergency contacts, project
--   members / tasks / updates, daily work reports, notifications, leave, holidays, attendance
--   corrections, reminders, delay reasons, internship certificates, employee documents), row-level
--   security, the ep_* functions the portal calls, and two PRIVATE storage buckets:
--   ep-certificates, ep-documents.
-- Built-in settings only: the leave types (CL 12 / SL 12 / EL 15 / LOP) and the default reminder
--   times. Copies NO rows from the dev database: no employees, attendance, reports, leave,
--   holidays, notifications, documents or logins.
-- Changes NO existing website table. Needs the Project Tracker structure (220-228) already here.
-- Scheduled jobs (auto punch out 8 PM IST, reminders) are set up only if pg_cron is already
--   enabled; otherwise a WARNING is shown and everything else is still created (open sessions are
--   then closed whenever someone uses the portal; reminders are not sent until pg_cron is enabled).
-- Safe to stop: if anything fails, the whole script is undone.
-- Enables no database extension (Lovable's SQL editor does not allow that); pg_cron and pgcrypto must already be there.
-- =====================================================================================

begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing on this database. Stop: the Employee Portal needs it.';
  end if;
  if to_regclass('public.pt_projects') is null then
    raise exception 'The Project Tracker tables (220-228) are missing. Run project_tracker_schema_220-228.sql first.';
  end if;
  if to_regprocedure('extensions.crypt(text, text)') is null or to_regprocedure('extensions.gen_salt(text)') is null then
    raise exception 'pgcrypto (extensions.crypt / gen_salt) is missing. Stop: creating employee logins needs it.';
  end if;
  if to_regclass('public.ep_employees') is not null then
    raise exception 'Employee Portal tables already exist on this database. Nothing was changed.';
  end if;
end $$;

-- ===================== 229_employee_portal_attendance.sql =====================

-- 229: Employee Portal, step 1 — who is an employee, and punch in / punch out.
--
-- ep_employees  : one row per sign-in account that may use /employee.
-- ep_attendance : one row per work session (punch in -> punch out).
--                 At most ONE open session (no punch out yet) per employee.
--
-- Employees never write these tables directly. They call:
--   ep_me()        -> who am I + my open session (null when not employee)
--   ep_punch_in()  -> starts a session; refused when one is already open
--   ep_punch_out() -> ends the open session; refused when none is open
-- Times come from the database clock (now()), never from the browser.
-- Admins (public.is_admin()) can read everything.
-- Rollback: supabase/rollbacks/229_rollback_employee_portal_attendance.sql


create table if not exists public.ep_employees (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references auth.users (id) on delete cascade,
  employee_code text not null unique check (employee_code ~ '^[A-Z0-9][A-Z0-9-]{1,29}$'),
  full_name     text not null check (length(btrim(full_name)) between 1 and 120),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.ep_attendance (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.ep_employees (id) on delete cascade,
  work_date    date not null default (timezone('Asia/Kolkata', now()))::date,
  punch_in_at  timestamptz not null default now(),
  punch_out_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint ep_attendance_out_after_in check (punch_out_at is null or punch_out_at >= punch_in_at)
);

-- One open session per employee.
create unique index if not exists ep_attendance_one_open
  on public.ep_attendance (employee_id) where punch_out_at is null;
create index if not exists ep_attendance_employee_date
  on public.ep_attendance (employee_id, work_date desc);

comment on table public.ep_employees is 'Employee Portal: accounts allowed to use /employee.';
comment on table public.ep_attendance is 'Employee Portal: punch in / punch out sessions. Written only via ep_punch_in / ep_punch_out.';

-- ---------------------------------------------------------------- RLS
alter table public.ep_employees  enable row level security;
alter table public.ep_attendance enable row level security;

revoke all on public.ep_employees, public.ep_attendance from anon, authenticated;
grant select on public.ep_employees, public.ep_attendance to authenticated;

drop policy if exists ep_employees_read on public.ep_employees;
create policy ep_employees_read on public.ep_employees for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists ep_attendance_read on public.ep_attendance;
create policy ep_attendance_read on public.ep_attendance for select to authenticated
  using (
    (select public.is_admin())
    or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------- RPCs
create or replace function public.ep_me()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'employee_id',   e.id,
    'employee_code', e.employee_code,
    'full_name',     e.full_name,
    'open_session',  (
      select jsonb_build_object('id', a.id, 'punch_in_at', a.punch_in_at, 'work_date', a.work_date)
      from public.ep_attendance a
      where a.employee_id = e.id and a.punch_out_at is null
    ),
    'last_session',  (
      select jsonb_build_object('id', a.id, 'punch_in_at', a.punch_in_at, 'punch_out_at', a.punch_out_at)
      from public.ep_attendance a
      where a.employee_id = e.id and a.punch_out_at is not null
      order by a.punch_out_at desc limit 1
    )
  )
  from public.ep_employees e
  where e.user_id = auth.uid() and e.is_active;
$$;

create or replace function public.ep_punch_in()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid;
  v_row public.ep_attendance;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  -- Serialise punches of the same employee.
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 0));
  if exists (select 1 from public.ep_attendance where employee_id = v_emp and punch_out_at is null) then
    raise exception 'You are already punched in.' using errcode = 'P0001';
  end if;
  insert into public.ep_attendance (employee_id) values (v_emp) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'work_date', v_row.work_date);
end $$;

create or replace function public.ep_punch_out()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid;
  v_row public.ep_attendance;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 0));
  update public.ep_attendance
     set punch_out_at = now()
   where employee_id = v_emp and punch_out_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'You are not punched in.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'punch_out_at', v_row.punch_out_at);
end $$;

revoke all on function public.ep_me(), public.ep_punch_in(), public.ep_punch_out() from public, anon;
grant execute on function public.ep_me(), public.ep_punch_in(), public.ep_punch_out() to authenticated;

notify pgrst, 'reload schema';

-- ===================== 230_employee_attendance_rules.sql =====================

-- 230: Employee Portal — attendance rules + per-day attendance for the
-- Attendance Management page. Times are India time (Asia/Kolkata).
--
-- Office hours: 09:30 – 19:00.
--   Late      : first punch in of the day after 09:40.
--   Leave     : total worked that day < 4 hours.
--   Half day  : worked >= 4 hours but last punch out before 19:00.
--   Present   : worked >= 4 hours and last punch out at/after 19:00.
--   Working   : still punched in (day not finished yet).
-- "Late" is a separate flag, so a day can be e.g. Present + Late.
-- The rules live in ONE place: public.ep_attendance_rules().
-- Rollback: supabase/rollbacks/230_rollback_employee_attendance_rules.sql


create or replace function public.ep_attendance_rules()
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'timezone',           'Asia/Kolkata',
    'office_start',       '09:30',
    'office_end',         '19:00',
    'late_after',         '09:40',
    'half_day_min_hours', 4
  );
$$;

-- One row per day that has at least one punch, for the signed-in employee.
create or replace function public.ep_my_attendance(p_from date, p_to date)
returns table (
  work_date      date,
  first_in       timestamptz,
  last_out       timestamptz,
  worked_minutes integer,
  sessions       integer,
  is_open        boolean,
  is_late        boolean,
  status         text
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid;
  v_rules jsonb := public.ep_attendance_rules();
  v_tz    text  := v_rules ->> 'timezone';
  v_late  time  := (v_rules ->> 'late_after')::time;
  v_end   time  := (v_rules ->> 'office_end')::time;
  v_min   int   := (v_rules ->> 'half_day_min_hours')::int * 60;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;

  return query
  with days as (
    select a.work_date,
           min(a.punch_in_at)                                                        as first_in,
           max(a.punch_out_at)                                                       as last_out,
           floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int as worked,
           count(*)::int                                                             as n,
           bool_or(a.punch_out_at is null)                                           as open
    from public.ep_attendance a
    where a.employee_id = v_emp and a.work_date between p_from and p_to
    group by a.work_date
  )
  select d.work_date, d.first_in, d.last_out, d.worked, d.n, d.open,
         (d.first_in at time zone v_tz)::time > v_late,
         case
           when d.open                                       then 'working'
           when d.worked < v_min                             then 'leave'
           when (d.last_out at time zone v_tz)::time >= v_end then 'present'
           else 'half_day'
         end
  from days d
  order by d.work_date desc;
end $$;

revoke all on function public.ep_my_attendance(date, date) from public, anon;
grant execute on function public.ep_my_attendance(date, date) to authenticated;
grant execute on function public.ep_attendance_rules() to authenticated;

notify pgrst, 'reload schema';

-- ===================== 231_employee_profile.sql =====================

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

-- ===================== 232_employee_projects.sql =====================

-- 232: Employee Portal — My Projects.
--
-- Projects are the Project Tracker's projects (public.pt_projects). Employees
-- never read pt_projects directly (it is admin-only and next to logins,
-- documents and invoices). They see ONLY projects they are a team member of,
-- and ONLY safe fields, through security-definer RPCs.
--
--   ep_project_members : who is on which project (managed by admins).
--   ep_project_tasks   : tasks with assignee, deadline, priority, status.
--   ep_project_updates : progress updates posted by team members.
--
-- Team members can add tasks, change task status and post updates (RPCs below).
-- Admins (public.is_admin()) can read and manage everything directly.
-- Rollback: supabase/rollbacks/232_rollback_employee_projects.sql


create table if not exists public.ep_project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.pt_projects (id) on delete cascade,
  employee_id uuid not null references public.ep_employees (id) on delete cascade,
  project_role text check (project_role is null or length(btrim(project_role)) between 1 and 60),
  is_lead     boolean not null default false,
  added_at    timestamptz not null default now(),
  unique (project_id, employee_id)
);
create index if not exists ep_project_members_employee on public.ep_project_members (employee_id);

create table if not exists public.ep_project_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.pt_projects (id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text check (description is null or length(description) <= 2000),
  assignee_id  uuid references public.ep_employees (id) on delete set null,
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date     date check (due_date is null or due_date between date '2020-01-01' and date '2100-12-31'),
  created_by   uuid references public.ep_employees (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists ep_project_tasks_project on public.ep_project_tasks (project_id, status);
create index if not exists ep_project_tasks_assignee on public.ep_project_tasks (assignee_id) where status <> 'done';

create table if not exists public.ep_project_updates (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pt_projects (id) on delete cascade,
  author_id  uuid references public.ep_employees (id) on delete set null,
  body       text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists ep_project_updates_project on public.ep_project_updates (project_id, created_at desc);

comment on table public.ep_project_members is 'Employee Portal: project team (admins manage). Links ep_employees to pt_projects.';
comment on table public.ep_project_tasks is 'Employee Portal: project tasks. Team members write via ep_add_task / ep_set_task_status.';
comment on table public.ep_project_updates is 'Employee Portal: project updates. Team members write via ep_post_update.';

-- ---------------------------------------------------------------- helpers
create or replace function public.ep_is_project_member(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.ep_project_members m
    join public.ep_employees e on e.id = m.employee_id
    where m.project_id = p_project and e.user_id = auth.uid() and e.is_active
  );
$$;
revoke all on function public.ep_is_project_member(uuid) from public, anon;
grant execute on function public.ep_is_project_member(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.ep_project_members enable row level security;
alter table public.ep_project_tasks   enable row level security;
alter table public.ep_project_updates enable row level security;
revoke all on public.ep_project_members, public.ep_project_tasks, public.ep_project_updates from anon, authenticated;
grant select, insert, update, delete on public.ep_project_members, public.ep_project_tasks, public.ep_project_updates to authenticated;

do $$
declare t text;
begin
  foreach t in array array['ep_project_members', 'ep_project_tasks', 'ep_project_updates'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_admin()) or public.ep_is_project_member(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t || '_admin_write', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- read: list
create or replace function public.ep_my_projects()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.sort_status, x.end_date nulls last, x.name)
    from (
      select p.name, p.end_date,
             case p.status when 'in_progress' then 0 when 'planning' then 1 when 'on_hold' then 2 when 'live' then 3 else 4 end as sort_status,
             jsonb_build_object(
               'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
               'project_type', p.project_type, 'status', p.status, 'progress', p.progress,
               'priority', p.priority, 'health', p.health,
               'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
               'my_role', m.project_role, 'i_am_lead', m.is_lead,
               'team_size', (select count(*) from public.ep_project_members x where x.project_id = p.id),
               'tasks_total', (select count(*) from public.ep_project_tasks t where t.project_id = p.id),
               'tasks_done', (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.status = 'done'),
               'my_open_tasks', (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.assignee_id = v_emp and t.status <> 'done'),
               'my_overdue_tasks', (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.assignee_id = v_emp and t.status <> 'done'
                                     and t.due_date < (timezone('Asia/Kolkata', now()))::date)
             ) as j
      from public.ep_project_members m
      join public.pt_projects p on p.id = m.project_id
      left join public.pt_companies c on c.id = p.company_id
      where m.employee_id = v_emp
    ) x
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- read: one project
create or replace function public.ep_project_detail(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'project', jsonb_build_object(
        'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
        'project_type', p.project_type, 'description', p.description, 'status', p.status,
        'progress', p.progress, 'priority', p.priority, 'health', p.health,
        'project_manager', p.project_manager, 'next_action', p.next_action, 'live_url', p.live_url,
        'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date),
      'me', v_emp,
      'team', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'employee_id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                 'designation', e.designation, 'department', e.department,
                 'project_role', m.project_role, 'is_lead', m.is_lead)
               order by m.is_lead desc, e.full_name)
        from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
        where m.project_id = p.id), '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status,
                 'priority', t.priority, 'due_date', t.due_date, 'completed_at', t.completed_at,
                 'assignee_id', t.assignee_id, 'assignee_name', a.full_name, 'created_at', t.created_at)
               order by (t.status = 'done'), t.due_date nulls last, t.created_at)
        from public.ep_project_tasks t left join public.ep_employees a on a.id = t.assignee_id
        where t.project_id = p.id), '[]'::jsonb),
      'updates', coalesce((
        select jsonb_agg(u.j order by u.created_at desc) from (
          select pu.created_at, jsonb_build_object(
                   'id', pu.id, 'body', pu.body, 'created_at', pu.created_at,
                   'author_name', au.full_name, 'author_code', au.employee_code) as j
          from public.ep_project_updates pu left join public.ep_employees au on au.id = pu.author_id
          where pu.project_id = p.id
          order by pu.created_at desc limit 50) u), '[]'::jsonb)
    )
    from public.pt_projects p left join public.pt_companies c on c.id = p.company_id
    where p.id = p_project
  );
end $$;

-- ---------------------------------------------------------------- write: tasks / updates
create or replace function public.ep_add_task(
  p_project uuid, p_title text, p_description text, p_assignee uuid, p_due_date date, p_priority text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if p_assignee is not null and not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = p_assignee) then
    raise exception 'The assignee must be on the project team.' using errcode = '22023';
  end if;
  insert into public.ep_project_tasks (project_id, title, description, assignee_id, due_date, priority, created_by)
  values (p_project, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_assignee, p_due_date,
          coalesce(nullif(p_priority, ''), 'medium'), v_emp)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ep_set_task_status(p_task uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_project uuid;
begin
  select project_id into v_project from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_project is null
     or not exists (select 1 from public.ep_project_members where project_id = v_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  update public.ep_project_tasks
     set status = p_status,
         updated_at = now(),
         completed_at = case when p_status = 'done' then coalesce(completed_at, now()) else null end
   where id = p_task;
end $$;

create or replace function public.ep_post_update(p_project uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  insert into public.ep_project_updates (project_id, author_id, body)
  values (p_project, v_emp, btrim(p_body))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.ep_my_projects(), public.ep_project_detail(uuid),
  public.ep_add_task(uuid, text, text, uuid, date, text), public.ep_set_task_status(uuid, text),
  public.ep_post_update(uuid, text) from public, anon;
grant execute on function public.ep_my_projects(), public.ep_project_detail(uuid),
  public.ep_add_task(uuid, text, text, uuid, date, text), public.ep_set_task_status(uuid, text),
  public.ep_post_update(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================== 233_employee_auto_punch_out.sql =====================

-- 233: Employee Portal — automatic punch out at 10:00 PM (India time).
--
-- A session that is still open at 22:00 IST on its work date is closed with
-- punch_out_at = 22:00 IST of that date and auto_punched_out = true.
-- A session that was started at/after 22:00 is closed at midnight (00:00 IST
-- of the next day), so a session never runs into the next work date.
--
-- Two ways it happens (the result is the same either way):
--   1. A pg_cron job at 22:00 and 00:00 IST closes every overdue session,
--      even when nobody has the portal open.
--   2. ep_me / ep_punch_in / ep_punch_out / ep_my_attendance close the
--      employee's overdue session first, so the portal is always correct
--      even if the job did not run.
-- The punch out time is always the cut-off time, never the time of the check.
-- Rollback: supabase/rollbacks/233_rollback_employee_auto_punch_out.sql


alter table public.ep_attendance
  add column if not exists auto_punched_out boolean not null default false;

comment on column public.ep_attendance.auto_punched_out is
  'true = closed automatically at the 10:00 PM cut-off (employee did not punch out).';

-- ---------------------------------------------------------------- rules
create or replace function public.ep_attendance_rules()
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'timezone',           'Asia/Kolkata',
    'office_start',       '09:30',
    'office_end',         '19:00',
    'late_after',         '09:40',
    'half_day_min_hours', 4,
    'auto_punch_out',     '22:00'
  );
$$;

-- When an open session is closed automatically.
create or replace function public.ep_auto_punch_out_at(p_work_date date, p_punch_in_at timestamptz)
returns timestamptz
language sql immutable set search_path = ''
as $$
  select case
           when p_punch_in_at < cut then cut
           else ((p_work_date + 1)::timestamp at time zone (r ->> 'timezone'))
         end
  from (select public.ep_attendance_rules() as r) rules,
       lateral (select ((p_work_date + (r ->> 'auto_punch_out')::time) at time zone (r ->> 'timezone')) as cut) c;
$$;

-- Closes overdue open sessions: of one employee, or of everyone when p_emp is null.
-- Internal: called by the RPCs below and by the pg_cron job. Returns rows closed.
create or replace function public.ep_close_overdue_sessions(p_emp uuid default null)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.ep_attendance a
     set punch_out_at     = public.ep_auto_punch_out_at(a.work_date, a.punch_in_at),
         auto_punched_out = true
   where a.punch_out_at is null
     and (p_emp is null or a.employee_id = p_emp)
     and now() >= public.ep_auto_punch_out_at(a.work_date, a.punch_in_at);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.ep_close_overdue_sessions(uuid) from public, anon, authenticated;
revoke all on function public.ep_auto_punch_out_at(date, timestamptz) from public, anon;
grant execute on function public.ep_auto_punch_out_at(date, timestamptz) to authenticated;

-- ---------------------------------------------------------------- ep_me (now volatile: it may close a session)
create or replace function public.ep_me()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_emp uuid;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    return null;
  end if;
  perform public.ep_close_overdue_sessions(v_emp);
  return (
    select jsonb_build_object(
      'employee_id',   e.id,
      'employee_code', e.employee_code,
      'full_name',     e.full_name,
      'open_session',  (
        select jsonb_build_object('id', a.id, 'punch_in_at', a.punch_in_at, 'work_date', a.work_date,
                                  'auto_punch_out_at', public.ep_auto_punch_out_at(a.work_date, a.punch_in_at))
        from public.ep_attendance a
        where a.employee_id = e.id and a.punch_out_at is null
      ),
      'last_session',  (
        select jsonb_build_object('id', a.id, 'punch_in_at', a.punch_in_at, 'punch_out_at', a.punch_out_at,
                                  'auto_punched_out', a.auto_punched_out)
        from public.ep_attendance a
        where a.employee_id = e.id and a.punch_out_at is not null
        order by a.punch_out_at desc limit 1
      )
    )
    from public.ep_employees e
    where e.id = v_emp
  );
end $$;

-- ---------------------------------------------------------------- punch in / out
create or replace function public.ep_punch_in()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid;
  v_row public.ep_attendance;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 0));
  perform public.ep_close_overdue_sessions(v_emp);
  if exists (select 1 from public.ep_attendance where employee_id = v_emp and punch_out_at is null) then
    raise exception 'You are already punched in.' using errcode = 'P0001';
  end if;
  insert into public.ep_attendance (employee_id) values (v_emp) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'work_date', v_row.work_date);
end $$;

create or replace function public.ep_punch_out()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid;
  v_row public.ep_attendance;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 0));
  -- Already past the cut-off: keep the automatic punch out time (not now()).
  -- No exception here, it would roll the automatic punch out back.
  if public.ep_close_overdue_sessions(v_emp) > 0 then
    select * into v_row from public.ep_attendance
     where employee_id = v_emp and auto_punched_out order by punch_out_at desc limit 1;
    return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'punch_out_at', v_row.punch_out_at,
                              'auto_punched_out', true);
  end if;
  update public.ep_attendance
     set punch_out_at = now()
   where employee_id = v_emp and punch_out_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'You are not punched in.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'punch_out_at', v_row.punch_out_at);
end $$;

-- ---------------------------------------------------------------- per-day attendance (+ auto_out flag)
drop function if exists public.ep_my_attendance(date, date);
create function public.ep_my_attendance(p_from date, p_to date)
returns table (
  work_date      date,
  first_in       timestamptz,
  last_out       timestamptz,
  worked_minutes integer,
  sessions       integer,
  is_open        boolean,
  is_late        boolean,
  status         text,
  auto_out       boolean
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_emp   uuid;
  v_rules jsonb := public.ep_attendance_rules();
  v_tz    text  := v_rules ->> 'timezone';
  v_late  time  := (v_rules ->> 'late_after')::time;
  v_end   time  := (v_rules ->> 'office_end')::time;
  v_min   int   := (v_rules ->> 'half_day_min_hours')::int * 60;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  perform public.ep_close_overdue_sessions(v_emp);

  return query
  with days as (
    select a.work_date,
           min(a.punch_in_at)                                                        as first_in,
           max(a.punch_out_at)                                                       as last_out,
           floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int as worked,
           count(*)::int                                                             as n,
           bool_or(a.punch_out_at is null)                                           as open,
           bool_or(a.auto_punched_out)                                               as auto
    from public.ep_attendance a
    where a.employee_id = v_emp and a.work_date between p_from and p_to
    group by a.work_date
  )
  select d.work_date, d.first_in, d.last_out, d.worked, d.n, d.open,
         (d.first_in at time zone v_tz)::time > v_late,
         case
           when d.open                                       then 'working'
           when d.worked < v_min                             then 'leave'
           when (d.last_out at time zone v_tz)::time >= v_end then 'present'
           else 'half_day'
         end,
         d.auto
  from days d
  order by d.work_date desc;
end $$;

revoke all on function public.ep_me(), public.ep_punch_in(), public.ep_punch_out(), public.ep_my_attendance(date, date)
  from public, anon;
grant execute on function public.ep_me(), public.ep_punch_in(), public.ep_punch_out(), public.ep_my_attendance(date, date)
  to authenticated;

-- ---------------------------------------------------------------- nightly job
-- 22:00 IST = 16:30 UTC; 00:00 IST = 18:30 UTC (pg_cron runs in UTC).
-- If pg_cron cannot be enabled here, the RPC checks above still apply.
do $$
begin
  begin
    if not exists (select 1 from pg_extension where extname = 'pg_cron') then raise exception 'pg_cron is not enabled on this database'; end if;  -- live script: never creates an extension
  exception when others then
    raise warning 'ep auto punch out: pg_cron not available (%). Sessions are still closed when the portal is used.', sqlerrm;
    return;
  end;
  perform cron.schedule('ep-auto-punch-out', '30 16,18 * * *', 'select public.ep_close_overdue_sessions()');
end $$;

notify pgrst, 'reload schema';

-- ===================== 234_employee_daily_work_reports.sql =====================

-- 234: Employee Portal — Daily Work Report.
--
-- One report per employee per day (India date). A report has one entry per
-- project the employee is on: task updates, completed work, pending work,
-- hours spent. Plus optional notes / blockers for the manager.
--
-- Flow:  draft  --submit-->  submitted  --manager-->  reviewed
--                                         \--manager-->  returned (comment) --edit + resubmit--> submitted
-- Draft and returned reports are editable by the employee; submitted and
-- reviewed reports are locked.
-- Reports go to the employee's reporting manager (ep_employees.reporting_manager_id,
-- migration 231). Submitting without a reporting manager is refused.
-- Dates allowed: today and the 7 days before it (India time); never the future.
--
-- Employees and managers use only the security-definer RPCs below.
-- Admins (public.is_admin()) can read and manage the tables directly.
-- Rollback: supabase/rollbacks/234_rollback_employee_daily_work_reports.sql


create table if not exists public.ep_work_reports (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.ep_employees (id) on delete cascade,
  report_date    date not null,
  status         text not null default 'draft' check (status in ('draft', 'submitted', 'reviewed', 'returned')),
  notes          text check (notes is null or length(notes) <= 2000),
  submitted_to   uuid references public.ep_employees (id) on delete set null,
  submitted_at   timestamptz,
  reviewed_by    uuid references public.ep_employees (id) on delete set null,
  reviewed_at    timestamptz,
  review_comment text check (review_comment is null or length(review_comment) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (employee_id, report_date)
);
create index if not exists ep_work_reports_submitted_to on public.ep_work_reports (submitted_to, status, report_date desc);

create table if not exists public.ep_work_report_items (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.ep_work_reports (id) on delete cascade,
  project_id     uuid not null references public.pt_projects (id) on delete cascade,
  task_updates   text check (task_updates is null or length(task_updates) <= 2000),
  completed_work text check (completed_work is null or length(completed_work) <= 2000),
  pending_work   text check (pending_work is null or length(pending_work) <= 2000),
  hours          numeric(4, 2) not null check (hours > 0 and hours <= 24),
  position       smallint not null default 0,
  unique (report_id, project_id)
);

comment on table public.ep_work_reports is 'Employee Portal: daily work report (one per employee per day). Written via ep_save_my_report / ep_review_report.';
comment on table public.ep_work_report_items is 'Employee Portal: one project entry of a daily work report.';

-- ---------------------------------------------------------------- RLS
alter table public.ep_work_reports      enable row level security;
alter table public.ep_work_report_items enable row level security;
revoke all on public.ep_work_reports, public.ep_work_report_items from anon, authenticated;
grant select, insert, update, delete on public.ep_work_reports, public.ep_work_report_items to authenticated;

drop policy if exists ep_work_reports_read on public.ep_work_reports;
create policy ep_work_reports_read on public.ep_work_reports for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()))
         or (status <> 'draft'
             and submitted_to in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()))));
drop policy if exists ep_work_reports_admin_write on public.ep_work_reports;
create policy ep_work_reports_admin_write on public.ep_work_reports for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists ep_work_report_items_read on public.ep_work_report_items;
create policy ep_work_report_items_read on public.ep_work_report_items for select to authenticated
  using (exists (select 1 from public.ep_work_reports r where r.id = report_id));  -- inherits the report policy
drop policy if exists ep_work_report_items_admin_write on public.ep_work_report_items;
create policy ep_work_report_items_admin_write on public.ep_work_report_items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------- helpers (internal)
-- Full report as JSON (report + entries + people), or null.
create or replace function public.ep_report_json(p_report uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'report_date', r.report_date, 'status', r.status, 'notes', r.notes,
    'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at, 'review_comment', r.review_comment,
    'updated_at', r.updated_at,
    'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                   'designation', e.designation),
    'submitted_to', case when st.id is null then null
                         else jsonb_build_object('id', st.id, 'full_name', st.full_name, 'employee_code', st.employee_code) end,
    'reviewed_by', case when rb.id is null then null
                        else jsonb_build_object('id', rb.id, 'full_name', rb.full_name) end,
    'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0),
    'worked_minutes', (
      select floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int
      from public.ep_attendance a where a.employee_id = r.employee_id and a.work_date = r.report_date),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', i.project_id, 'project_code', p.project_code, 'project_name', p.name,
               'task_updates', i.task_updates, 'completed_work', i.completed_work,
               'pending_work', i.pending_work, 'hours', i.hours)
             order by i.position, p.name)
      from public.ep_work_report_items i join public.pt_projects p on p.id = i.project_id
      where i.report_id = r.id), '[]'::jsonb)
  )
  from public.ep_work_reports r
  join public.ep_employees e on e.id = r.employee_id
  left join public.ep_employees st on st.id = r.submitted_to
  left join public.ep_employees rb on rb.id = r.reviewed_by
  where r.id = p_report;
$$;
revoke all on function public.ep_report_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- employee: read
-- The report of one day (null when not started) + what the page needs around it.
create or replace function public.ep_my_report(p_date date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr   public.ep_employees;
  v_rep   uuid;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select m.* into v_mgr from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
   where e.id = v_emp;
  select id into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  return jsonb_build_object(
    'date', p_date,
    'date_allowed', p_date between v_today - 7 and v_today,
    'manager', case when v_mgr.id is null then null
                    else jsonb_build_object('id', v_mgr.id, 'full_name', v_mgr.full_name, 'employee_code', v_mgr.employee_code,
                                            'designation', v_mgr.designation) end,
    'worked_minutes', (
      select floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int
      from public.ep_attendance a where a.employee_id = v_emp and a.work_date = p_date),
    'report', case when v_rep is null then null else public.ep_report_json(v_rep) end
  );
end $$;

-- Summary list (newest first) between two dates, at most 62 days.
create or replace function public.ep_my_reports(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'report_date', r.report_date, 'status', r.status,
             'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at,
             'projects', (select count(*) from public.ep_work_report_items i where i.report_id = r.id),
             'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0))
           order by r.report_date desc)
    from public.ep_work_reports r
    where r.employee_id = v_emp and r.report_date between p_from and p_to), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- employee: save / submit
-- p_items: [{project_id, task_updates, completed_work, pending_work, hours}, ...]
-- Replaces all entries of the day's report. p_submit = true also submits it.
create or replace function public.ep_save_my_report(p_date date, p_notes text, p_items jsonb, p_submit boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr    uuid;
  v_rep    public.ep_work_reports;
  v_item   jsonb;
  v_pid    uuid;
  v_hours  numeric;
  v_total  numeric := 0;
  v_seen   uuid[] := '{}';
  v_pos    int := 0;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'You cannot write a report for a future date.' using errcode = '22023';
  end if;
  if p_date < v_today - 7 then
    raise exception 'Reports can only be written for today and the last 7 days.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid report entries.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'A report can have at most 20 project entries.' using errcode = '22023';
  end if;
  if coalesce(length(v_notes), 0) > 2000 then
    raise exception 'Notes must be at most 2000 characters.' using errcode = '22023';
  end if;
  if p_submit and jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one project entry before submitting.' using errcode = '22023';
  end if;

  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  if p_submit and v_mgr is null then
    raise exception 'No reporting manager is set for you yet. Ask the admin to set one, then submit.' using errcode = '22023';
  end if;

  -- Serialise saves of the same report.
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text || p_date::text, 0));
  select * into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  if v_rep.id is not null and v_rep.status in ('submitted', 'reviewed') then
    raise exception 'This report is already submitted and cannot be changed.' using errcode = 'P0001';
  end if;

  -- Validate every entry before writing anything.
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid   := (v_item ->> 'project_id')::uuid;
      v_hours := (v_item ->> 'hours')::numeric;
    exception when others then
      raise exception 'Invalid report entries.' using errcode = '22023';
    end;
    if v_pid is null or not exists (select 1 from public.ep_project_members where project_id = v_pid and employee_id = v_emp) then
      raise exception 'You can only report on projects you are assigned to.' using errcode = '42501';
    end if;
    if v_pid = any (v_seen) then
      raise exception 'Each project can be added only once per report.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_pid;
    if v_hours is null or v_hours <= 0 or v_hours > 24 or v_hours <> round(v_hours, 2) then
      raise exception 'Hours spent must be more than 0 and at most 24 for each project.' using errcode = '22023';
    end if;
    v_total := v_total + v_hours;
    if coalesce(btrim(v_item ->> 'task_updates'), '') = '' and coalesce(btrim(v_item ->> 'completed_work'), '') = ''
       and coalesce(btrim(v_item ->> 'pending_work'), '') = '' then
      raise exception 'Write what you worked on for every project you added.' using errcode = '22023';
    end if;
    if greatest(length(v_item ->> 'task_updates'), length(v_item ->> 'completed_work'), length(v_item ->> 'pending_work')) > 2000 then
      raise exception 'Each text box can have at most 2000 characters.' using errcode = '22023';
    end if;
  end loop;
  if v_total > 24 then
    raise exception 'Total hours for the day cannot be more than 24.' using errcode = '22023';
  end if;

  if v_rep.id is null then
    insert into public.ep_work_reports (employee_id, report_date, notes)
    values (v_emp, p_date, v_notes) returning * into v_rep;
  else
    update public.ep_work_reports set notes = v_notes, updated_at = now() where id = v_rep.id;
  end if;

  delete from public.ep_work_report_items where report_id = v_rep.id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.ep_work_report_items (report_id, project_id, task_updates, completed_work, pending_work, hours, position)
    values (v_rep.id, (v_item ->> 'project_id')::uuid,
            nullif(btrim(coalesce(v_item ->> 'task_updates', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'completed_work', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'pending_work', '')), ''),
            (v_item ->> 'hours')::numeric, v_pos);
    v_pos := v_pos + 1;
  end loop;

  if p_submit then
    update public.ep_work_reports
       set status = 'submitted', submitted_to = v_mgr, submitted_at = now(), updated_at = now(),
           reviewed_by = null, reviewed_at = null, review_comment = null
     where id = v_rep.id;
  end if;

  return public.ep_my_report(p_date);
end $$;

-- ---------------------------------------------------------------- manager
-- Reports submitted to me, or by people who report to me (newest first, 60 days).
create or replace function public.ep_team_reports()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation) order by e.full_name)
      from public.ep_employees e where e.reporting_manager_id = v_emp and e.is_active), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'report_date', r.report_date, 'status', r.status,
               'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at,
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code),
               'projects', (select count(*) from public.ep_work_report_items i where i.report_id = r.id),
               'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0))
             order by (r.status = 'submitted') desc, r.report_date desc, e.full_name)
      from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
      where r.status <> 'draft'
        and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)
        and r.report_date >= v_today - 60), '[]'::jsonb)
  );
end $$;

create or replace function public.ep_team_report(p_report uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null or not exists (
       select 1 from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
        where r.id = p_report and r.status <> 'draft'
          and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)) then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  return public.ep_report_json(p_report);
end $$;

-- p_action: 'reviewed' or 'returned' (returned needs a comment).
create or replace function public.ep_review_report(p_report uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_status  text;
begin
  select r.status into v_status
    from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_report and r.status <> 'draft'
     and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)
   for update of r;
  if v_emp is null or v_status is null then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed.' using errcode = 'P0001';
  end if;
  if p_action not in ('reviewed', 'returned') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'returned' and v_comment is null then
    raise exception 'Write a comment saying what needs to change.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  update public.ep_work_reports
     set status = p_action, reviewed_by = v_emp, reviewed_at = now(), review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $$;

revoke all on function public.ep_my_report(date), public.ep_my_reports(date, date),
  public.ep_save_my_report(date, text, jsonb, boolean), public.ep_team_reports(), public.ep_team_report(uuid),
  public.ep_review_report(uuid, text, text) from public, anon;
grant execute on function public.ep_my_report(date), public.ep_my_reports(date, date),
  public.ep_save_my_report(date, text, jsonb, boolean), public.ep_team_reports(), public.ep_team_report(uuid),
  public.ep_review_report(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================== 235_employee_notifications.sql =====================

-- 235: Employee Portal — Notifications.
--
-- ep_notifications: one row per recipient (an employee). Kinds:
--   project    : added to a project, new task assigned to you
--   leave      : leave requests / decisions (migration 236)
--   attendance : punch in / punch out reminders (migration 236)
--   report     : daily work report submitted / reviewed / sent back, reminders
--   message    : messages sent by an admin or by another employee
-- priority 'urgent' is shown as a banner in the portal until it is read.
--
-- Automatic notifications come from triggers (below) and from the scheduled
-- reminders in 236. Messages are sent with ep_send_message():
--   admin    -> everyone, or chosen employees
--   manager  -> their team (people who report to them), or chosen employees
--   employee -> chosen employees
-- Employees read and mark their own notifications through RPCs only.
-- Rollback: supabase/rollbacks/235_rollback_employee_notifications.sql


create table if not exists public.ep_notifications (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.ep_employees (id) on delete cascade,
  kind               text not null check (kind in ('project', 'leave', 'attendance', 'report', 'message')),
  priority           text not null default 'normal' check (priority in ('normal', 'urgent')),
  title              text not null check (length(btrim(title)) between 1 and 150),
  body               text check (body is null or length(body) <= 2000),
  link               text check (link is null or link ~ '^/employee(/|$)'),
  sender_employee_id uuid references public.ep_employees (id) on delete set null,
  sender_user_id     uuid,                -- auth user of the sender (admin or employee), for "Sent" lists
  sender_label       text,                -- "Admin" / sender's name; null for system notifications
  message_id         uuid,                -- same id for every recipient of one message
  dedupe_key         text,                -- stops the same reminder being sent twice
  created_at         timestamptz not null default now(),
  read_at            timestamptz,
  unique (employee_id, dedupe_key)
);
create index if not exists ep_notifications_inbox on public.ep_notifications (employee_id, created_at desc);
create index if not exists ep_notifications_unread on public.ep_notifications (employee_id) where read_at is null;
create index if not exists ep_notifications_message on public.ep_notifications (message_id) where message_id is not null;

comment on table public.ep_notifications is 'Employee Portal: in-app notifications (one row per recipient). Written by triggers / ep_send_message / reminders.';

alter table public.ep_notifications enable row level security;
revoke all on public.ep_notifications from anon, authenticated;
grant select on public.ep_notifications to authenticated;
drop policy if exists ep_notifications_read on public.ep_notifications;
create policy ep_notifications_read on public.ep_notifications for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid())));

-- ---------------------------------------------------------------- internal: create one notification
create or replace function public.ep_notify(
  p_employee uuid, p_kind text, p_title text, p_body text, p_link text,
  p_priority text default 'normal', p_dedupe text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_employee is null then
    return;
  end if;
  insert into public.ep_notifications (employee_id, kind, priority, title, body, link, dedupe_key)
  select p_employee, p_kind, coalesce(p_priority, 'normal'), left(p_title, 150), left(p_body, 2000), p_link, p_dedupe
  where exists (select 1 from public.ep_employees where id = p_employee and is_active)
  on conflict (employee_id, dedupe_key) do nothing;
end $$;
revoke all on function public.ep_notify(uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- inbox
-- p_filter: 'all' | 'unread' | a kind. Newest first, at most 200.
create or replace function public.ep_my_notifications(p_filter text default 'all')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_notifications where employee_id = v_emp and read_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
               'link', n.link, 'sender_label', n.sender_label, 'created_at', n.created_at, 'read_at', n.read_at)
             order by n.created_at desc)
      from (select * from public.ep_notifications
             where employee_id = v_emp
               and (coalesce(p_filter, 'all') = 'all'
                    or (p_filter = 'unread' and read_at is null)
                    or kind = p_filter)
             order by created_at desc limit 200) n), '[]'::jsonb));
end $$;

-- Small and cheap: for the bell (polled) and the urgent banner.
create or replace function public.ep_notification_summary()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    return null;
  end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_notifications where employee_id = v_emp and read_at is null),
    'urgent', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'link', n.link,
                                          'sender_label', n.sender_label, 'created_at', n.created_at)
             order by n.created_at desc)
      from (select * from public.ep_notifications
             where employee_id = v_emp and read_at is null and priority = 'urgent'
             order by created_at desc limit 5) n), '[]'::jsonb));
end $$;

-- p_ids null = mark everything read.
create or replace function public.ep_mark_notifications_read(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_n   integer;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  update public.ep_notifications
     set read_at = now()
   where employee_id = v_emp and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------- messages
-- Who the caller may message, and how.
create or replace function public.ep_message_options()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_admin boolean := coalesce(public.is_admin(), false);
  v_emp   uuid    := public.ep_current_employee_id();
begin
  if not v_admin and v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_all',  v_admin,
    'can_team', v_emp is not null and exists (select 1 from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation, 'department', e.department,
                                          'is_my_team', e.reporting_manager_id is not distinct from v_emp and v_emp is not null)
             order by e.full_name)
      from public.ep_employees e where e.is_active and e.id is distinct from v_emp), '[]'::jsonb));
end $$;

-- p_audience: 'people' (p_to required) | 'team' (managers) | 'all' (admins).
create or replace function public.ep_send_message(
  p_audience text, p_to uuid[], p_title text, p_body text, p_priority text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin  boolean := coalesce(public.is_admin(), false);
  v_emp    uuid    := public.ep_current_employee_id();
  v_label  text;
  v_msg    uuid    := gen_random_uuid();
  v_title  text    := btrim(coalesce(p_title, ''));
  v_body   text    := nullif(btrim(coalesce(p_body, '')), '');
  v_n      integer;
begin
  if not v_admin and v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if length(v_title) not between 1 and 150 then
    raise exception 'Subject must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('normal', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if p_audience = 'all' and not v_admin then
    raise exception 'Only an admin can message everyone.' using errcode = '42501';
  end if;
  if p_audience = 'team' and (v_emp is null
       or not exists (select 1 from public.ep_employees where reporting_manager_id = v_emp and is_active)) then
    raise exception 'You do not have a team to message.' using errcode = '42501';
  end if;
  if p_audience = 'people' and (p_to is null or cardinality(p_to) = 0) then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_audience = 'people' and cardinality(p_to) > 100 then
    raise exception 'Choose at most 100 people.' using errcode = '22023';
  end if;
  if p_audience not in ('people', 'team', 'all') then
    raise exception 'Invalid audience.' using errcode = '22023';
  end if;

  -- The sender's own employee name when they are an employee, else "Admin".
  select coalesce((select full_name from public.ep_employees where id = v_emp), 'Admin') into v_label;
  if v_admin and v_emp is null then
    v_label := 'Admin';
  end if;

  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_employee_id, sender_user_id, sender_label, message_id)
  select e.id, 'message', p_priority, v_title, v_body, v_emp, auth.uid(), v_label, v_msg
    from public.ep_employees e
   where e.is_active
     and e.id is distinct from v_emp
     and case p_audience
           when 'all'    then true
           when 'team'   then e.reporting_manager_id = v_emp
           else e.id = any (p_to)
         end;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'None of the chosen people can receive messages.' using errcode = '22023';
  end if;
  return jsonb_build_object('message_id', v_msg, 'recipients', v_n);
end $$;

-- Messages the caller sent (grouped), newest first, last 90 days.
create or replace function public.ep_sent_messages()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or (not coalesce(public.is_admin(), false) and public.ep_current_employee_id() is null) then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(m.j order by m.created_at desc)
    from (
      select min(n.created_at) as created_at,
             jsonb_build_object(
               'message_id', n.message_id, 'title', min(n.title), 'body', min(n.body), 'priority', min(n.priority),
               'created_at', min(n.created_at), 'recipients', count(*), 'read', count(n.read_at),
               'to', (array_agg(e.full_name order by e.full_name))[1:5]) as j
      from public.ep_notifications n join public.ep_employees e on e.id = n.employee_id
      where n.sender_user_id = auth.uid() and n.message_id is not null
        and n.created_at > now() - interval '90 days'
      group by n.message_id
      order by min(n.created_at) desc
      limit 100) m), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- automatic: projects
create or replace function public.ep_trg_project_member_added()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.pt_projects;
begin
  select * into v_p from public.pt_projects where id = new.project_id;
  perform public.ep_notify(new.employee_id, 'project',
    'You were added to project ' || coalesce(v_p.name, ''),
    coalesce(v_p.project_code || ' · ', '') || coalesce('Your role: ' || new.project_role, 'Open the project to see the team and tasks.'),
    '/employee/projects/' || new.project_id);
  return new;
end $$;
drop trigger if exists ep_project_member_added on public.ep_project_members;
create trigger ep_project_member_added after insert on public.ep_project_members
  for each row execute function public.ep_trg_project_member_added();

create or replace function public.ep_trg_task_assigned()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  if new.assignee_id is null or new.assignee_id is not distinct from new.created_by and tg_op = 'INSERT' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;
  select name into v_name from public.pt_projects where id = new.project_id;
  perform public.ep_notify(new.assignee_id, 'project',
    'New task assigned: ' || new.title,
    coalesce(v_name, '') || coalesce(' · Due ' || to_char(new.due_date, 'DD Mon YYYY'), ''),
    '/employee/projects/' || new.project_id);
  return new;
end $$;
drop trigger if exists ep_task_assigned on public.ep_project_tasks;
create trigger ep_task_assigned after insert or update of assignee_id on public.ep_project_tasks
  for each row execute function public.ep_trg_task_assigned();

-- ---------------------------------------------------------------- automatic: daily work reports
create or replace function public.ep_trg_report_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp_name text;
  v_mgr_name text;
  v_day      text := to_char(new.report_date, 'DD Mon YYYY');
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  select full_name into v_emp_name from public.ep_employees where id = new.employee_id;
  select full_name into v_mgr_name from public.ep_employees where id = new.reviewed_by;
  if new.status = 'submitted' then
    perform public.ep_notify(new.submitted_to, 'report',
      v_emp_name || ' submitted a daily report', 'Report for ' || v_day || ' is waiting for your review.',
      '/employee/reports/team/' || new.id);
  elsif new.status = 'reviewed' then
    perform public.ep_notify(new.employee_id, 'report',
      'Your daily report was reviewed', 'Report for ' || v_day || coalesce(' · ' || v_mgr_name, '')
        || coalesce(': ' || new.review_comment, ''),
      '/employee/reports?date=' || new.report_date);
  elsif new.status = 'returned' then
    perform public.ep_notify(new.employee_id, 'report',
      'Your daily report was sent back', 'Report for ' || v_day || coalesce(': ' || new.review_comment, ''),
      '/employee/reports?date=' || new.report_date, 'urgent');
  end if;
  return new;
end $$;
drop trigger if exists ep_report_status on public.ep_work_reports;
create trigger ep_report_status after update of status on public.ep_work_reports
  for each row execute function public.ep_trg_report_status();

revoke all on function public.ep_trg_project_member_added(), public.ep_trg_task_assigned(), public.ep_trg_report_status()
  from public, anon, authenticated;

revoke all on function public.ep_my_notifications(text), public.ep_notification_summary(),
  public.ep_mark_notifications_read(uuid[]), public.ep_message_options(),
  public.ep_send_message(text, uuid[], text, text, text), public.ep_sent_messages() from public, anon;
grant execute on function public.ep_my_notifications(text), public.ep_notification_summary(),
  public.ep_mark_notifications_read(uuid[]), public.ep_message_options(),
  public.ep_send_message(text, uuid[], text, text, text), public.ep_sent_messages() to authenticated;

notify pgrst, 'reload schema';

-- ===================== 236_employee_leave_management.sql =====================

-- 236: Employee Portal — Leave Management + scheduled reminders.
--
-- ep_leave_types       : kinds of leave and the default days per calendar year
--                        (null = no limit, e.g. Loss of Pay). Change via SQL.
-- ep_leave_allocations : optional per-employee, per-year days that replace the default.
-- ep_holidays          : company holidays (not counted as leave days).
-- ep_leave_requests    : applications. pending -> approved / rejected (by the
--                        reporting manager) ; pending or not-yet-started approved
--                        leave can be cancelled by the employee.
--
-- Leave days = dates from start to end, minus Sundays and company holidays.
-- A single-day request can be a half day (0.5). A request stays in one calendar
-- year. Paid leave cannot go over the balance (pending requests count too).
-- Requests may start up to 30 days in the past and up to 365 days ahead.
--
-- Reminders (pg_cron, India time, Monday–Saturday, skipping holidays and leave):
--   09:45  not punched in yet                -> attendance reminder
--   18:30  punched in today, report not sent -> daily report reminder
--   21:30  still punched in                  -> "auto punch out at 10:00 PM"
-- Notifications use public.ep_notify() from migration 235.
-- Rollback: supabase/rollbacks/236_rollback_employee_leave_management.sql


-- ---------------------------------------------------------------- tables
create table if not exists public.ep_leave_types (
  code        text primary key check (code ~ '^[A-Z]{2,5}$'),
  name        text not null check (length(btrim(name)) between 1 and 60),
  yearly_days numeric(5, 1) check (yearly_days is null or yearly_days between 0 and 366),
  is_paid     boolean not null default true,
  sort_order  smallint not null default 0,
  is_active   boolean not null default true
);

insert into public.ep_leave_types (code, name, yearly_days, is_paid, sort_order) values
  ('CL',  'Casual Leave',  12,   true,  1),
  ('SL',  'Sick Leave',    12,   true,  2),
  ('EL',  'Earned Leave',  15,   true,  3),
  ('LOP', 'Loss of Pay',   null, false, 4)
on conflict (code) do nothing;

create table if not exists public.ep_leave_allocations (
  employee_id uuid not null references public.ep_employees (id) on delete cascade,
  year        smallint not null check (year between 2020 and 2100),
  leave_type  text not null references public.ep_leave_types (code),
  days        numeric(5, 1) not null check (days between 0 and 366),
  primary key (employee_id, year, leave_type)
);

create table if not exists public.ep_holidays (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name         text not null check (length(btrim(name)) between 1 and 80),
  created_at   timestamptz not null default now()
);

create table if not exists public.ep_leave_requests (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.ep_employees (id) on delete cascade,
  leave_type       text not null references public.ep_leave_types (code),
  start_date       date not null,
  end_date         date not null,
  half_day         text check (half_day in ('first_half', 'second_half')),
  days             numeric(5, 1) not null check (days > 0),
  reason           text not null check (length(btrim(reason)) between 1 and 1000),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id      uuid references public.ep_employees (id) on delete set null,
  decided_by       uuid references public.ep_employees (id) on delete set null,
  decided_at       timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ep_leave_dates check (end_date >= start_date and extract(year from start_date) = extract(year from end_date)),
  constraint ep_leave_half_one_day check (half_day is null or start_date = end_date)
);
create index if not exists ep_leave_requests_employee on public.ep_leave_requests (employee_id, start_date desc);
create index if not exists ep_leave_requests_approver on public.ep_leave_requests (approver_id, status);

comment on table public.ep_leave_types is 'Employee Portal: leave types and default days per year (null = unlimited).';
comment on table public.ep_leave_allocations is 'Employee Portal: per-employee yearly leave days (overrides ep_leave_types.yearly_days).';
comment on table public.ep_holidays is 'Employee Portal: company holidays.';
comment on table public.ep_leave_requests is 'Employee Portal: leave applications. Written via ep_apply_leave / ep_cancel_leave / ep_decide_leave.';

-- ---------------------------------------------------------------- RLS
alter table public.ep_leave_types       enable row level security;
alter table public.ep_leave_allocations enable row level security;
alter table public.ep_holidays          enable row level security;
alter table public.ep_leave_requests    enable row level security;
revoke all on public.ep_leave_types, public.ep_leave_allocations, public.ep_holidays, public.ep_leave_requests from anon, authenticated;
grant select, insert, update, delete on public.ep_leave_types, public.ep_leave_allocations, public.ep_holidays, public.ep_leave_requests to authenticated;

drop policy if exists ep_leave_types_read on public.ep_leave_types;
create policy ep_leave_types_read on public.ep_leave_types for select to authenticated using (true);
drop policy if exists ep_holidays_read on public.ep_holidays;
create policy ep_holidays_read on public.ep_holidays for select to authenticated using (true);
drop policy if exists ep_leave_allocations_read on public.ep_leave_allocations;
create policy ep_leave_allocations_read on public.ep_leave_allocations for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid())));
drop policy if exists ep_leave_requests_read on public.ep_leave_requests;
create policy ep_leave_requests_read on public.ep_leave_requests for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()))
         or approver_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid())));

do $$
declare t text;
begin
  foreach t in array array['ep_leave_types', 'ep_leave_allocations', 'ep_holidays', 'ep_leave_requests'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t || '_admin_write', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- helpers
-- Leave days between two dates (Sundays and holidays not counted); half day = 0.5.
create or replace function public.ep_leave_day_count(p_start date, p_end date, p_half text)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select case when p_half is not null and p_start = p_end then 0.5 else 1 end
         * count(*)
  from generate_series(p_start, p_end, interval '1 day') g(d)
  where extract(isodow from g.d) <> 7
    and not exists (select 1 from public.ep_holidays h where h.holiday_date = g.d::date);
$$;

-- Days allowed for one employee / year / type (null = unlimited).
create or replace function public.ep_leave_allowance(p_emp uuid, p_year int, p_type text)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select a.days from public.ep_leave_allocations a
      where a.employee_id = p_emp and a.year = p_year and a.leave_type = p_type),
    (select t.yearly_days from public.ep_leave_types t where t.code = p_type));
$$;

-- Days already used or requested (approved + pending), optionally ignoring one request.
create or replace function public.ep_leave_taken(p_emp uuid, p_year int, p_type text, p_skip uuid default null)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(days), 0) from public.ep_leave_requests
   where employee_id = p_emp and leave_type = p_type and extract(year from start_date) = p_year
     and status in ('approved', 'pending') and id is distinct from p_skip;
$$;

-- Is this employee on approved leave (full day) or is it a holiday / Sunday on this date?
create or replace function public.ep_is_day_off(p_emp uuid, p_date date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select extract(isodow from p_date) = 7
      or exists (select 1 from public.ep_holidays where holiday_date = p_date)
      or exists (select 1 from public.ep_leave_requests r
                  where r.employee_id = p_emp and r.status = 'approved' and r.half_day is null
                    and p_date between r.start_date and r.end_date);
$$;

revoke all on function public.ep_leave_allowance(uuid, int, text), public.ep_leave_taken(uuid, int, text, uuid),
  public.ep_is_day_off(uuid, date) from public, anon, authenticated;

-- JSON of one request (for lists).
create or replace function public.ep_leave_json(r public.ep_leave_requests)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'leave_type', r.leave_type, 'leave_name', (select name from public.ep_leave_types where code = r.leave_type),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_day', r.half_day, 'days', r.days,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'decided_by', (select full_name from public.ep_employees where id = r.decided_by),
    'approver', (select full_name from public.ep_employees where id = r.approver_id),
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                           'designation', e.designation)
                   from public.ep_employees e where e.id = r.employee_id));
$$;
revoke all on function public.ep_leave_json(public.ep_leave_requests) from public, anon, authenticated;

-- ---------------------------------------------------------------- employee
-- Balances, requests and holidays of one calendar year.
create or replace function public.ep_leave_overview(p_year int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_mgr uuid;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  return jsonb_build_object(
    'year', p_year,
    'manager', (select jsonb_build_object('id', m.id, 'full_name', m.full_name) from public.ep_employees m where m.id = v_mgr),
    'balances', (
      select jsonb_agg(jsonb_build_object(
               'code', t.code, 'name', t.name, 'is_paid', t.is_paid,
               'allowed', public.ep_leave_allowance(v_emp, p_year, t.code),
               'approved', (select coalesce(sum(days), 0) from public.ep_leave_requests
                             where employee_id = v_emp and leave_type = t.code and status = 'approved'
                               and extract(year from start_date) = p_year),
               'pending', (select coalesce(sum(days), 0) from public.ep_leave_requests
                            where employee_id = v_emp and leave_type = t.code and status = 'pending'
                              and extract(year from start_date) = p_year))
             order by t.sort_order)
      from public.ep_leave_types t where t.is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r) order by r.start_date desc, r.created_at desc)
      from public.ep_leave_requests r
      where r.employee_id = v_emp and extract(year from r.start_date) = p_year), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.holiday_date, 'name', h.name) order by h.holiday_date)
      from public.ep_holidays h where extract(year from h.holiday_date) = p_year), '[]'::jsonb));
end $$;

-- Preview: how many leave days a range is.
create or replace function public.ep_leave_preview(p_start date, p_end date, p_half text)
returns numeric
language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.ep_current_employee_id() is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    return 0;
  end if;
  return public.ep_leave_day_count(p_start, p_end, case when p_start = p_end then p_half end);
end $$;

create or replace function public.ep_apply_leave(p_type text, p_start date, p_end date, p_half text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr     uuid;
  v_name    text;
  v_type    public.ep_leave_types;
  v_days    numeric;
  v_allowed numeric;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_half    text := nullif(p_half, '');
  v_row     public.ep_leave_requests;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select * into v_type from public.ep_leave_types where code = p_type and is_active;
  if v_type.code is null then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose a valid start and end date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave request cannot cross into the next year. Apply for each year separately.' using errcode = '22023';
  end if;
  if p_start < v_today - 30 or p_end > v_today + 365 then
    raise exception 'Leave can start at most 30 days ago and end at most one year ahead.' using errcode = '22023';
  end if;
  if v_half is not null and (v_half not in ('first_half', 'second_half') or p_start <> p_end) then
    raise exception 'A half day must be a single date.' using errcode = '22023';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write a reason (up to 1000 characters).' using errcode = '22023';
  end if;
  select reporting_manager_id, full_name into v_mgr, v_name from public.ep_employees where id = v_emp;
  if v_mgr is null then
    raise exception 'No reporting manager is set for you yet. Ask the admin to set one, then apply.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave' || v_emp::text, 0));

  v_days := public.ep_leave_day_count(p_start, p_end, v_half);
  if v_days = 0 then
    raise exception 'These dates are only Sundays or company holidays, so no leave is needed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_leave_requests r
              where r.employee_id = v_emp and r.status in ('pending', 'approved')
                and r.start_date <= p_end and r.end_date >= p_start
                and not (r.start_date = r.end_date and p_start = p_end and r.half_day is not null and v_half is not null
                         and r.half_day <> v_half)) then
    raise exception 'You already have leave on some of these dates.' using errcode = '22023';
  end if;
  v_allowed := public.ep_leave_allowance(v_emp, extract(year from p_start)::int, p_type);
  if v_type.is_paid and v_allowed is not null
     and public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type) + v_days > v_allowed then
    raise exception 'Not enough % balance: % day(s) left, % requested.', v_type.name,
      greatest(v_allowed - public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type), 0), v_days
      using errcode = '22023';
  end if;

  insert into public.ep_leave_requests (employee_id, leave_type, start_date, end_date, half_day, days, reason, approver_id)
  values (v_emp, p_type, p_start, p_end, v_half, v_days, v_reason, v_mgr)
  returning * into v_row;

  perform public.ep_notify(v_mgr, 'leave',
    v_name || ' applied for ' || v_type.name,
    to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else to_char(p_start, ' YYYY') end
      || ' · ' || v_days || ' day(s) · ' || left(v_reason, 200),
    '/employee/leave/team');
  return public.ep_leave_json(v_row);
end $$;

create or replace function public.ep_cancel_leave(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_row   public.ep_leave_requests;
  v_name  text;
begin
  select * into v_row from public.ep_leave_requests where id = p_id and employee_id = v_emp for update;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  if not (v_row.status = 'pending' or (v_row.status = 'approved' and v_row.start_date > v_today)) then
    raise exception 'Only pending leave, or approved leave that has not started, can be cancelled.' using errcode = 'P0001';
  end if;
  update public.ep_leave_requests set status = 'cancelled', updated_at = now() where id = p_id returning * into v_row;
  select full_name into v_name from public.ep_employees where id = v_emp;
  perform public.ep_notify(v_row.approver_id, 'leave',
    v_name || ' cancelled a leave request',
    to_char(v_row.start_date, 'DD Mon YYYY') || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end,
    '/employee/leave/team');
  return public.ep_leave_json(v_row);
end $$;

-- ---------------------------------------------------------------- manager
create or replace function public.ep_team_leave()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team_size', (select count(*) from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r) order by (r.status = 'pending') desc, r.start_date desc)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where (r.approver_id = v_emp or e.reporting_manager_id = v_emp)
        and (r.status = 'pending' or r.end_date >= v_today - 90)), '[]'::jsonb));
end $$;

-- p_action: 'approved' | 'rejected' (rejected needs a comment).
create or replace function public.ep_decide_leave(p_id uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_row     public.ep_leave_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed numeric;
  v_type    public.ep_leave_types;
begin
  select r.* into v_row from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_id and (r.approver_id = v_emp or e.reporting_manager_id = v_emp)
   for update of r;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  if p_action = 'approved' then
    -- Balance may have changed (e.g. admin lowered it); check again without this request.
    select * into v_type from public.ep_leave_types where code = v_row.leave_type;
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this.', v_type.name using errcode = '22023';
    end if;
  end if;
  update public.ep_leave_requests
     set status = p_action, decided_by = v_emp, decided_at = now(), decision_comment = v_comment, updated_at = now()
   where id = p_id returning * into v_row;
  perform public.ep_notify(v_row.employee_id, 'leave',
    'Your leave was ' || case when p_action = 'approved' then 'approved' else 'rejected' end,
    (select name from public.ep_leave_types where code = v_row.leave_type) || ' · '
      || to_char(v_row.start_date, 'DD Mon YYYY')
      || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end
      || coalesce(' · ' || v_comment, ''),
    '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_leave_json(v_row);
end $$;

-- ---------------------------------------------------------------- attendance calendar
-- Holidays + my approved leave days between two dates (max 62 days).
create or replace function public.ep_my_days_off(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('date', holiday_date, 'name', name) order by holiday_date)
                            from public.ep_holidays where holiday_date between p_from and p_to), '[]'::jsonb),
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('date', g.d::date, 'type', r.leave_type, 'half_day', r.half_day) order by g.d)
      from public.ep_leave_requests r,
           generate_series(greatest(r.start_date, p_from), least(r.end_date, p_to), interval '1 day') g(d)
      where r.employee_id = v_emp and r.status = 'approved'
        and r.start_date <= p_to and r.end_date >= p_from), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- reminders
-- p_kind: 'punch_in' | 'report' | 'punch_out'. Run by pg_cron; safe to run twice (dedupe key).
create or replace function public.ep_send_reminders(p_kind text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_n     integer := 0;
  r       record;
begin
  if extract(isodow from v_today) = 7 or exists (select 1 from public.ep_holidays where holiday_date = v_today) then
    return 0;
  end if;
  for r in
    select e.id from public.ep_employees e
     where e.is_active
       and case p_kind
             when 'punch_in' then
               not public.ep_is_day_off(e.id, v_today)
               and not exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.work_date = v_today)
             when 'report' then
               exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.work_date = v_today)
               and exists (select 1 from public.ep_project_members m where m.employee_id = e.id)
               and not exists (select 1 from public.ep_work_reports w where w.employee_id = e.id and w.report_date = v_today
                                and w.status in ('submitted', 'reviewed'))
             when 'punch_out' then
               exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
             else false
           end
  loop
    perform public.ep_notify(r.id,
      case when p_kind = 'report' then 'report' else 'attendance' end,
      case p_kind
        when 'punch_in'  then 'You have not punched in today'
        when 'report'    then 'Submit your daily work report'
        else                  'You are still punched in'
      end,
      case p_kind
        when 'punch_in'  then 'Office starts at 9:30 AM. Punch in when you start work, or apply for leave if you are off.'
        when 'report'    then 'Your report for today is not submitted yet.'
        else                  'You will be punched out automatically at 10:00 PM. Punch out now if you are done.'
      end,
      case p_kind when 'report' then '/employee/reports' when 'punch_in' then '/employee' else '/employee/attendance' end,
      'normal',
      p_kind || ':' || v_today);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_send_reminders(text) from public, anon, authenticated;

revoke all on function public.ep_leave_day_count(date, date, text), public.ep_leave_overview(int),
  public.ep_leave_preview(date, date, text), public.ep_apply_leave(text, date, date, text, text),
  public.ep_cancel_leave(uuid), public.ep_team_leave(), public.ep_decide_leave(uuid, text, text),
  public.ep_my_days_off(date, date) from public, anon;
grant execute on function public.ep_leave_overview(int), public.ep_leave_preview(date, date, text),
  public.ep_apply_leave(text, date, date, text, text), public.ep_cancel_leave(uuid), public.ep_team_leave(),
  public.ep_decide_leave(uuid, text, text), public.ep_my_days_off(date, date) to authenticated;

-- 09:45 IST = 04:15 UTC, 18:30 IST = 13:00 UTC, 21:30 IST = 16:00 UTC; Monday–Saturday.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      if not exists (select 1 from pg_extension where extname = 'pg_cron') then raise exception 'pg_cron is not enabled on this database'; end if;  -- live script: never creates an extension
    exception when others then
      raise warning 'ep reminders: pg_cron not available (%). Reminders will not be sent.', sqlerrm;
      return;
    end;
  end if;
  perform cron.schedule('ep-remind-punch-in',  '15 4 * * 1-6', $c$select public.ep_send_reminders('punch_in')$c$);
  perform cron.schedule('ep-remind-report',    '0 13 * * 1-6', $c$select public.ep_send_reminders('report')$c$);
  perform cron.schedule('ep-remind-punch-out', '0 16 * * 1-6', $c$select public.ep_send_reminders('punch_out')$c$);
end $$;

notify pgrst, 'reload schema';

-- ===================== 237_leave_manager_entered_by_employee.sql =====================

-- 237: Leave — the employee enters their reporting manager on the leave form.
--
-- Before: ep_apply_leave refused when ep_employees.reporting_manager_id was not set.
-- Now:    the form sends the manager the employee chose or typed:
--           p_manager_id   : a colleague picked from the list (gets a notification), or null
--           p_manager_name : the name as typed (always stored; used when not a colleague)
--         One of the two is required. The profile's reporting manager is only a default.
-- New column ep_leave_requests.approver_name keeps the typed name.
-- The old 5-argument ep_apply_leave is replaced by the 7-argument one.
-- Rollback: supabase/rollbacks/237_rollback_leave_manager_entered_by_employee.sql


alter table public.ep_leave_requests
  add column if not exists approver_name text
    check (approver_name is null or length(btrim(approver_name)) between 1 and 120);

comment on column public.ep_leave_requests.approver_name is
  'Reporting manager as entered by the employee on the leave form (may not be a portal user).';

-- JSON of one request: approver = colleague name, else the typed name.
create or replace function public.ep_leave_json(r public.ep_leave_requests)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'leave_type', r.leave_type, 'leave_name', (select name from public.ep_leave_types where code = r.leave_type),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_day', r.half_day, 'days', r.days,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'decided_by', (select full_name from public.ep_employees where id = r.decided_by),
    'approver', coalesce((select full_name from public.ep_employees where id = r.approver_id), r.approver_name),
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                           'designation', e.designation)
                   from public.ep_employees e where e.id = r.employee_id));
$$;
revoke all on function public.ep_leave_json(public.ep_leave_requests) from public, anon, authenticated;

drop function if exists public.ep_apply_leave(text, date, date, text, text);

create or replace function public.ep_apply_leave(
  p_type text, p_start date, p_end date, p_half text, p_reason text, p_manager_id uuid, p_manager_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_name    text;
  v_type    public.ep_leave_types;
  v_days    numeric;
  v_allowed numeric;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_half    text := nullif(p_half, '');
  v_mgr     uuid := p_manager_id;
  v_mgrname text := nullif(btrim(coalesce(p_manager_name, '')), '');
  v_row     public.ep_leave_requests;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select * into v_type from public.ep_leave_types where code = p_type and is_active;
  if v_type.code is null then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose a valid start and end date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave request cannot cross into the next year. Apply for each year separately.' using errcode = '22023';
  end if;
  if p_start < v_today - 30 or p_end > v_today + 365 then
    raise exception 'Leave can start at most 30 days ago and end at most one year ahead.' using errcode = '22023';
  end if;
  if v_half is not null and (v_half not in ('first_half', 'second_half') or p_start <> p_end) then
    raise exception 'A half day must be a single date.' using errcode = '22023';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write a reason (up to 1000 characters).' using errcode = '22023';
  end if;

  -- Reporting manager: a picked colleague (must be active, not yourself) and/or a typed name.
  if v_mgr is not null then
    select full_name into v_mgrname from public.ep_employees where id = v_mgr and is_active and id <> v_emp;
    if v_mgrname is null then
      raise exception 'Choose a valid reporting manager.' using errcode = '22023';
    end if;
  end if;
  if v_mgrname is null then
    raise exception 'Enter your reporting manager.' using errcode = '22023';
  end if;
  if length(v_mgrname) > 120 then
    raise exception 'Reporting manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  select full_name into v_name from public.ep_employees where id = v_emp;

  perform pg_advisory_xact_lock(hashtextextended('leave' || v_emp::text, 0));

  v_days := public.ep_leave_day_count(p_start, p_end, v_half);
  if v_days = 0 then
    raise exception 'These dates are only Sundays or company holidays, so no leave is needed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_leave_requests r
              where r.employee_id = v_emp and r.status in ('pending', 'approved')
                and r.start_date <= p_end and r.end_date >= p_start
                and not (r.start_date = r.end_date and p_start = p_end and r.half_day is not null and v_half is not null
                         and r.half_day <> v_half)) then
    raise exception 'You already have leave on some of these dates.' using errcode = '22023';
  end if;
  v_allowed := public.ep_leave_allowance(v_emp, extract(year from p_start)::int, p_type);
  if v_type.is_paid and v_allowed is not null
     and public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type) + v_days > v_allowed then
    raise exception 'Not enough % balance: % day(s) left, % requested.', v_type.name,
      greatest(v_allowed - public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type), 0), v_days
      using errcode = '22023';
  end if;

  insert into public.ep_leave_requests
    (employee_id, leave_type, start_date, end_date, half_day, days, reason, approver_id, approver_name)
  values (v_emp, p_type, p_start, p_end, v_half, v_days, v_reason, v_mgr, v_mgrname)
  returning * into v_row;

  -- Only a colleague in the portal can be notified.
  perform public.ep_notify(v_mgr, 'leave',
    v_name || ' applied for ' || v_type.name,
    to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else to_char(p_start, ' YYYY') end
      || ' · ' || v_days || ' day(s) · ' || left(v_reason, 200),
    '/employee/leave');
  return public.ep_leave_json(v_row);
end $$;

revoke all on function public.ep_apply_leave(text, date, date, text, text, uuid, text) from public, anon;
grant execute on function public.ep_apply_leave(text, date, date, text, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- ===================== 238_employee_dashboard_tasks.sql =====================

-- 238: Employee Portal — Dashboard: my open tasks across all my projects.
--
-- Read-only. Returns the signed-in employee's tasks that are not done, on
-- projects they are still a member of: overdue first, then by deadline
-- (no deadline last), then newest. p_limit 1–50.
-- Rollback: supabase/rollbacks/238_rollback_employee_dashboard_tasks.sql


create or replace function public.ep_my_open_tasks(p_limit int default 5)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.ep_project_tasks t
               join public.ep_project_members m on m.project_id = t.project_id and m.employee_id = v_emp
              where t.assignee_id = v_emp and t.status <> 'done'),
    'items', coalesce((
      select jsonb_agg(x.j order by x.ord)
      from (
        select row_number() over (order by (t.due_date < v_today) desc, t.due_date nulls last, t.created_at desc) as ord,
               jsonb_build_object(
                 'id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority, 'due_date', t.due_date,
                 'project_id', p.id, 'project_name', p.name, 'project_code', p.project_code) as j
        from public.ep_project_tasks t
        join public.ep_project_members m on m.project_id = t.project_id and m.employee_id = v_emp
        join public.pt_projects p on p.id = t.project_id
        where t.assignee_id = v_emp and t.status <> 'done'
        order by 1
        limit least(greatest(coalesce(p_limit, 5), 1), 50)
      ) x), '[]'::jsonb));
end $$;

revoke all on function public.ep_my_open_tasks(int) from public, anon;
grant execute on function public.ep_my_open_tasks(int) to authenticated;

notify pgrst, 'reload schema';

-- ===================== 239_employee_management_admin.sql =====================

-- 239: Employee Portal — admin Employee Management.
--
-- Admins (public.is_admin()) can:
--   ep_admin_employees()                    -> list of all employees (work details + status)
--   ep_admin_employee(id)                   -> one employee: work + personal + emergency contacts + team
--   ep_admin_update_employee(id, jsonb)     -> set the work details the employee sees read-only in
--                                              My Profile (department, designation, reporting manager,
--                                              date of joining, employment type, work location, name)
--   ep_admin_set_employee_access(id, bool)  -> turn Employee Portal access on / off
--                                              (off = ep_employees.is_active false; an open punch-in
--                                              session is closed at that moment)
-- And for the employee side:
--   ep_my_access()                          -> 'active' | 'disabled' | null (not an employee), so a
--                                              turned-off account sees a clear message.
-- No new tables. Personal details stay editable only by the employee (admin reads them).
-- Rollback: supabase/rollbacks/239_rollback_employee_management_admin.sql


-- ---------------------------------------------------------------- helpers
create or replace function public.ep_require_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only admins can manage employees.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.ep_require_admin() from public, anon, authenticated;

-- One employee as the admin sees it in the list / header.
create or replace function public.ep_admin_employee_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id',              e.id,
    'employee_code',   e.employee_code,
    'full_name',       e.full_name,
    'work_email',      u.email,
    'department',      e.department,
    'designation',     e.designation,
    'date_of_joining', e.date_of_joining,
    'employment_type', e.employment_type,
    'work_location',   e.work_location,
    'is_active',       e.is_active,
    'created_at',      e.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'manager', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'full_name', m.full_name, 'employee_code', m.employee_code,
      'designation', m.designation, 'is_active', m.is_active) end,
    'reports_count', (select count(*) from public.ep_employees r where r.reporting_manager_id = e.id),
    'punched_in', exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
  )
  from public.ep_employees e
  left join auth.users u on u.id = e.user_id
  left join public.ep_employees m on m.id = e.reporting_manager_id
  where e.id = p_id;
$$;
revoke all on function public.ep_admin_employee_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- list
create or replace function public.ep_admin_employees()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(public.ep_admin_employee_json(e.id) order by e.is_active desc, e.employee_code)
    from public.ep_employees e
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- one employee
create or replace function public.ep_admin_employee(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb := public.ep_admin_employee_json(p_id);
begin
  perform public.ep_require_admin();
  if v is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  return v || jsonb_build_object(
    'personal', coalesce((
      select to_jsonb(p) - 'employee_id' from public.ep_employee_profiles p where p.employee_id = p_id
    ), '{}'::jsonb),
    'emergency_contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', c.name, 'relationship', c.relationship,
               'phone', c.phone, 'alternate_phone', c.alternate_phone) order by c.sort_order)
      from public.ep_emergency_contacts c where c.employee_id = p_id
    ), '[]'::jsonb),
    'direct_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'full_name', r.full_name, 'employee_code', r.employee_code,
               'designation', r.designation, 'is_active', r.is_active) order by r.full_name)
      from public.ep_employees r where r.reporting_manager_id = p_id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- work details
-- p: { full_name, department, designation, reporting_manager_id, date_of_joining,
--      employment_type, work_location } — only the keys given are changed.
-- Empty strings are saved as null (full_name cannot be empty). Table CHECKs validate.
create or replace function public.ep_admin_update_employee(p_id uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f text;
  v_old public.ep_employees;
  v_new public.ep_employees;
  v_mgr uuid;
  v_walk uuid;
  v_depth int := 0;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('full_name', 'department', 'designation', 'reporting_manager_id',
                 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be changed here.', f using errcode = '42501';
    end if;
  end loop;

  select * into v_old from public.ep_employees where id = p_id for update;
  if v_old.id is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;

  if p ? 'full_name' and nullif(btrim(p ->> 'full_name'), '') is null then
    raise exception 'Name cannot be empty.' using errcode = '22023';
  end if;

  -- Reporting manager: must exist, be active, not the employee, and not create a loop.
  v_mgr := case when p ? 'reporting_manager_id'
                then nullif(btrim(p ->> 'reporting_manager_id'), '')::uuid
                else v_old.reporting_manager_id end;
  if p ? 'reporting_manager_id' and v_mgr is not null
     and v_mgr is distinct from v_old.reporting_manager_id then
    if v_mgr = p_id then
      raise exception 'An employee cannot report to themselves.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ep_employees where id = v_mgr and is_active) then
      raise exception 'Choose an active employee as reporting manager.' using errcode = '22023';
    end if;
    v_walk := v_mgr;
    while v_walk is not null and v_depth < 100 loop
      if v_walk = p_id then
        raise exception 'That would make a loop: this employee is above the chosen manager.' using errcode = '22023';
      end if;
      select reporting_manager_id into v_walk from public.ep_employees where id = v_walk;
      v_depth := v_depth + 1;
    end loop;
  end if;

  update public.ep_employees set
    full_name            = case when p ? 'full_name' then btrim(p ->> 'full_name') else full_name end,
    department           = case when p ? 'department' then nullif(btrim(p ->> 'department'), '') else department end,
    designation          = case when p ? 'designation' then nullif(btrim(p ->> 'designation'), '') else designation end,
    reporting_manager_id = v_mgr,
    date_of_joining      = case when p ? 'date_of_joining' then nullif(btrim(p ->> 'date_of_joining'), '')::date else date_of_joining end,
    employment_type      = case when p ? 'employment_type' then nullif(btrim(p ->> 'employment_type'), '') else employment_type end,
    work_location        = case when p ? 'work_location' then nullif(btrim(p ->> 'work_location'), '') else work_location end,
    updated_at           = now()
  where id = p_id
  returning * into v_new;

  -- Tell the people concerned when the reporting line changes.
  if v_new.reporting_manager_id is distinct from v_old.reporting_manager_id then
    if v_new.reporting_manager_id is not null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was updated',
        'You now report to ' || (select full_name from public.ep_employees where id = v_new.reporting_manager_id) || '.',
        '/employee/profile');
      perform public.ep_notify(
        v_new.reporting_manager_id, 'message', v_new.full_name || ' now reports to you',
        v_new.full_name || ' (' || v_new.employee_code || ') was added to your team by the admin.',
        null);
    else
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was removed',
        'No reporting manager is set for you right now.', '/employee/profile');
    end if;
  end if;

  return public.ep_admin_employee(p_id);
end $$;

-- ---------------------------------------------------------------- portal access
create or replace function public.ep_admin_set_employee_access(p_id uuid, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if p_active is null then
    raise exception 'Choose on or off.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_id) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  -- Same lock as punch in / out, so a punch cannot slip in while access is turned off.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  update public.ep_employees set is_active = p_active, updated_at = now()
   where id = p_id and is_active is distinct from p_active;
  if not p_active then
    update public.ep_attendance set punch_out_at = now()
     where employee_id = p_id and punch_out_at is null;
  end if;
  return public.ep_admin_employee(p_id);
end $$;

-- ---------------------------------------------------------------- employee: my access
create or replace function public.ep_my_access()
returns text
language sql stable security definer set search_path = ''
as $$
  select case when is_active then 'active' else 'disabled' end
  from public.ep_employees where user_id = auth.uid();
$$;

revoke all on function
  public.ep_admin_employees(), public.ep_admin_employee(uuid),
  public.ep_admin_update_employee(uuid, jsonb), public.ep_admin_set_employee_access(uuid, boolean),
  public.ep_my_access()
  from public, anon;
grant execute on function
  public.ep_admin_employees(), public.ep_admin_employee(uuid),
  public.ep_admin_update_employee(uuid, jsonb), public.ep_admin_set_employee_access(uuid, boolean),
  public.ep_my_access()
  to authenticated;

notify pgrst, 'reload schema';

-- ===================== 240_employee_management_add_employee.sql =====================

-- 240: Employee Portal — admin adds a new employee.
--
-- ep_admin_create_employee(p jsonb) — admins only (public.is_admin()).
--   p: { employee_code, full_name, email, password,
--        department, designation, reporting_manager_id, date_of_joining,
--        employment_type, work_location }
--   * No sign-in account with that email yet -> one is created (email confirmed,
--     password = the temporary password the admin typed, min 8 characters).
--   * A sign-in account with that email already exists (and is not an admin and
--     not already an employee) -> it is linked; its password is NOT changed.
--   Then the ep_employees row is created and the work details are set through
--   ep_admin_update_employee (same checks: manager active, no loop, notifications).
-- The password is hashed with bcrypt here (pgcrypto, as Supabase Auth does) and
-- never stored or returned in plain text.
-- Rollback: supabase/rollbacks/240_rollback_employee_management_add_employee.sql
-- (drops the function only; employees created with it stay).


create or replace function public.ep_admin_create_employee(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if exists (select 1 from public.admin_users where user_id = v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if length(v_password) < 8 or length(v_password) > 72 then
      raise exception 'Temporary password must be 8-72 characters.' using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  insert into public.ep_employees (user_id, employee_code, full_name)
  values (v_user, v_code, v_name)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked);
end $$;

revoke all on function public.ep_admin_create_employee(jsonb) from public, anon;
grant execute on function public.ep_admin_create_employee(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ===================== 241_employee_project_management_admin.sql =====================

-- 241: Employee Portal — admin Project Management.
--
-- Projects are the Project Tracker's projects (public.pt_projects); teams and
-- tasks are ep_project_members / ep_project_tasks (migration 232). Admins only
-- (public.is_admin()):
--   ep_admin_pm_projects()                           -> all projects: client, status, deadline, team, task counts
--   ep_admin_pm_project(project)                     -> one project: details, team with per-employee progress
--                                                       (tasks done / open / overdue, hours from daily work
--                                                       reports), tasks, recent updates
--   ep_admin_pm_save_member(project, employee, role, is_lead) -> add to team, or change role / lead
--   ep_admin_pm_remove_member(project, employee)     -> remove; their open tasks on it become unassigned
--   ep_admin_pm_save_task(project, task|null, jsonb) -> create / edit a task (assignee must be on the team)
--   ep_admin_pm_delete_task(task)
--   ep_admin_pm_set_deadline(project, date|null)     -> pt_projects.end_date
-- Notifications for "added to project" / "task assigned" come from the
-- existing triggers (migration 235).
-- Rollback: supabase/rollbacks/241_rollback_employee_project_management_admin.sql


-- ---------------------------------------------------------------- list
create or replace function public.ep_admin_pm_projects()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(x.j order by x.sort_status, x.end_date nulls last, x.name)
    from (
      select p.name, p.end_date,
             case p.status when 'in_progress' then 0 when 'planning' then 1 when 'live' then 2 when 'on_hold' then 3
                           when 'completed' then 4 else 5 end as sort_status,
             jsonb_build_object(
               'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
               'status', p.status, 'priority', p.priority, 'health', p.health,
               'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
               'team', coalesce((
                 select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'is_lead', m.is_lead)
                                  order by m.is_lead desc, e.full_name)
                 from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
                 where m.project_id = p.id), '[]'::jsonb),
               'tasks_total',   (select count(*) from public.ep_project_tasks t where t.project_id = p.id),
               'tasks_done',    (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.status = 'done'),
               'tasks_overdue', (select count(*) from public.ep_project_tasks t where t.project_id = p.id
                                   and t.status <> 'done' and t.due_date < v_today)
             ) as j
      from public.pt_projects p
      left join public.pt_companies c on c.id = p.company_id
    ) x
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- one project
create or replace function public.ep_admin_pm_project(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v jsonb;
begin
  perform public.ep_require_admin();
  select jsonb_build_object(
           'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
           'description', p.description, 'project_type', p.project_type,
           'status', p.status, 'priority', p.priority, 'health', p.health, 'progress', p.progress,
           'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
           'project_manager', p.project_manager)
    into v
  from public.pt_projects p
  left join public.pt_companies c on c.id = p.company_id
  where p.id = p_project;
  if v is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  return v || jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'project_role', m.project_role, 'is_lead', m.is_lead, 'added_at', m.added_at,
               'tasks_total',       (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id),
               'tasks_done',        (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'done'),
               'tasks_in_progress', (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'in_progress'),
               'tasks_overdue',     (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id
                                       and t.status <> 'done' and t.due_date < v_today),
               'hours_logged', coalesce((
                 select sum(i.hours) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed')), 0),
               'last_report_date', (
                 select max(r.report_date) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed'))
             ) order by m.is_lead desc, e.full_name)
      from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
      where m.project_id = p_project), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status,
               'priority', t.priority, 'due_date', t.due_date, 'completed_at', t.completed_at,
               'created_at', t.created_at,
               'overdue', t.status <> 'done' and t.due_date < v_today,
               'assignee', case when a.id is null then null else jsonb_build_object('id', a.id, 'full_name', a.full_name) end,
               'created_by', coalesce(cb.full_name, 'Admin'))
             order by (t.status = 'done'), t.due_date nulls last, t.created_at desc)
      from public.ep_project_tasks t
      left join public.ep_employees a on a.id = t.assignee_id
      left join public.ep_employees cb on cb.id = t.created_by
      where t.project_id = p_project), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'body', u.body, 'created_at', u.created_at,
                                          'author', coalesce(au.full_name, 'Admin')) order by u.created_at desc)
      from (select * from public.ep_project_updates where project_id = p_project order by created_at desc limit 20) u
      left join public.ep_employees au on au.id = u.author_id), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- team
create or replace function public.ep_admin_pm_save_member(
  p_project uuid, p_employee uuid, p_role text default null, p_is_lead boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if not exists (select 1 from public.pt_projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_employee and is_active) then
    raise exception 'Choose an active employee.' using errcode = '22023';
  end if;
  insert into public.ep_project_members (project_id, employee_id, project_role, is_lead)
  values (p_project, p_employee, nullif(btrim(coalesce(p_role, '')), ''), coalesce(p_is_lead, false))
  on conflict (project_id, employee_id) do update
    set project_role = excluded.project_role, is_lead = excluded.is_lead;
  return public.ep_admin_pm_project(p_project);
end $$;

create or replace function public.ep_admin_pm_remove_member(p_project uuid, p_employee uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  delete from public.ep_project_members where project_id = p_project and employee_id = p_employee;
  if not found then
    raise exception 'This employee is not on the project.' using errcode = 'P0002';
  end if;
  update public.ep_project_tasks set assignee_id = null, updated_at = now()
   where project_id = p_project and assignee_id = p_employee and status <> 'done';
  return public.ep_admin_pm_project(p_project);
end $$;

-- ---------------------------------------------------------------- tasks
-- p: { title, description, assignee_id, priority, status, due_date }
-- A new assignee must be an active member of the project.
create or replace function public.ep_admin_pm_save_task(p_project uuid, p_task uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f text;
  v_assignee uuid;
  v_status text;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid task data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('title', 'description', 'assignee_id', 'priority', 'status', 'due_date') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;
  if not exists (select 1 from public.pt_projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if nullif(btrim(coalesce(p ->> 'title', '')), '') is null then
    raise exception 'Task title is required.' using errcode = '22023';
  end if;
  v_assignee := nullif(btrim(coalesce(p ->> 'assignee_id', '')), '')::uuid;
  -- Checked for new tasks and when the assignee changes (an existing assignee may have left the team).
  if v_assignee is not null
     and (p_task is null or v_assignee is distinct from (select assignee_id from public.ep_project_tasks where id = p_task))
     and not exists (
       select 1 from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
       where m.project_id = p_project and m.employee_id = v_assignee and e.is_active) then
    raise exception 'Assign the task to an active member of this project.' using errcode = '22023';
  end if;
  v_status := coalesce(nullif(btrim(coalesce(p ->> 'status', '')), ''), 'todo');

  if p_task is null then
    insert into public.ep_project_tasks (project_id, title, description, assignee_id, status, priority, due_date, completed_at)
    values (p_project, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), v_assignee, v_status,
            coalesce(nullif(btrim(coalesce(p ->> 'priority', '')), ''), 'medium'),
            nullif(btrim(coalesce(p ->> 'due_date', '')), '')::date,
            case when v_status = 'done' then now() end);
  else
    update public.ep_project_tasks set
      title        = btrim(p ->> 'title'),
      description  = nullif(btrim(coalesce(p ->> 'description', '')), ''),
      assignee_id  = v_assignee,
      status       = v_status,
      priority     = coalesce(nullif(btrim(coalesce(p ->> 'priority', '')), ''), 'medium'),
      due_date     = nullif(btrim(coalesce(p ->> 'due_date', '')), '')::date,
      completed_at = case when v_status = 'done' then coalesce(completed_at, now()) end,
      updated_at   = now()
    where id = p_task and project_id = p_project;
    if not found then
      raise exception 'Task not found.' using errcode = 'P0002';
    end if;
  end if;
  return public.ep_admin_pm_project(p_project);
end $$;

create or replace function public.ep_admin_pm_delete_task(p_task uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_project uuid;
begin
  perform public.ep_require_admin();
  delete from public.ep_project_tasks where id = p_task returning project_id into v_project;
  if v_project is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_pm_project(v_project);
end $$;

-- ---------------------------------------------------------------- deadline
create or replace function public.ep_admin_pm_set_deadline(p_project uuid, p_date date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_start date;
begin
  perform public.ep_require_admin();
  select start_date into v_start from public.pt_projects where id = p_project;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_date is not null and v_start is not null and p_date < v_start then
    raise exception 'The deadline cannot be before the start date (%).', to_char(v_start, 'DD Mon YYYY') using errcode = '22023';
  end if;
  update public.pt_projects set end_date = p_date, updated_at = now() where id = p_project;
  return public.ep_admin_pm_project(p_project);
end $$;

revoke all on function
  public.ep_admin_pm_projects(), public.ep_admin_pm_project(uuid),
  public.ep_admin_pm_save_member(uuid, uuid, text, boolean), public.ep_admin_pm_remove_member(uuid, uuid),
  public.ep_admin_pm_save_task(uuid, uuid, jsonb), public.ep_admin_pm_delete_task(uuid),
  public.ep_admin_pm_set_deadline(uuid, date)
  from public, anon;
grant execute on function
  public.ep_admin_pm_projects(), public.ep_admin_pm_project(uuid),
  public.ep_admin_pm_save_member(uuid, uuid, text, boolean), public.ep_admin_pm_remove_member(uuid, uuid),
  public.ep_admin_pm_save_task(uuid, uuid, jsonb), public.ep_admin_pm_delete_task(uuid),
  public.ep_admin_pm_set_deadline(uuid, date)
  to authenticated;

notify pgrst, 'reload schema';

-- ===================== 242_employee_admin_attendance_leave.sql =====================

-- 242: Employee Portal — admin Attendance Management + admin Leave Management,
--      and attendance correction requests (employee asks, admin decides).
--
-- ATTENDANCE
--   ep_attendance_rows(from, to, employee|null)  internal: per employee per day, same rules as
--                                                ep_my_attendance (which now uses it too)
--   ep_attendance.corrected_at                   set when an approved correction changed a session
--   ep_attendance_corrections                    correction requests:
--       attendance_id set  -> fix that session's punch in and/or punch out
--       attendance_id null -> add a missing session (punch in + punch out)
--     Employee: ep_request_correction / ep_my_corrections / ep_cancel_correction
--     Admin:    ep_admin_attendance(from, to, employee|null) / ep_admin_corrections(status)
--               / ep_admin_decide_correction(id, 'approved'|'rejected', comment)
--     Rules: the day is today or up to 30 days back; times are on that day (India time) and not in
--     the future; punch out after punch in; no overlap with the employee's other sessions; one
--     pending request per day. Checked again when the admin approves.
--
-- LEAVE (balances stay computed from requests, so a decision updates them at once;
--        approved leave shows on both attendance calendars through the leave rows)
--   ep_leave_requests.decided_by_admin           who decided, when it was an admin
--   ep_admin_leave_requests(status, year) / ep_admin_decide_leave(id, action, comment)
--   ep_admin_leave_balances(year) / ep_admin_set_leave_allowance(employee, year, type, days|null)
--   ep_admin_holidays(year) / ep_admin_save_holiday(id|null, date, name) / ep_admin_delete_holiday(id)
--     A holiday change re-counts the days of pending / approved leave covering that date; a
--     request left with 0 days is cancelled automatically and the employee is notified.
-- Rollback: supabase/rollbacks/242_rollback_employee_admin_attendance_leave.sql


-- ================================================================ ATTENDANCE
alter table public.ep_attendance add column if not exists corrected_at timestamptz;

-- Per employee per day (rules from ep_attendance_rules()).
create or replace function public.ep_attendance_rows(p_from date, p_to date, p_emp uuid default null)
returns table (
  employee_id    uuid,
  work_date      date,
  first_in       timestamptz,
  last_out       timestamptz,
  worked_minutes integer,
  sessions       integer,
  is_open        boolean,
  is_late        boolean,
  status         text,
  auto_out       boolean,
  corrected      boolean
)
language sql stable security definer set search_path = ''
as $$
  with r as (select public.ep_attendance_rules() as j),
  days as (
    select a.employee_id, a.work_date,
           min(a.punch_in_at)  as first_in,
           max(a.punch_out_at) as last_out,
           floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int as worked,
           count(*)::int as n,
           bool_or(a.punch_out_at is null) as open,
           bool_or(a.auto_punched_out) as auto,
           bool_or(a.corrected_at is not null) as corr
    from public.ep_attendance a
    where a.work_date between p_from and p_to and (p_emp is null or a.employee_id = p_emp)
    group by a.employee_id, a.work_date
  )
  select d.employee_id, d.work_date, d.first_in, d.last_out, d.worked, d.n, d.open,
         (d.first_in at time zone (r.j ->> 'timezone'))::time > (r.j ->> 'late_after')::time,
         case
           when d.open then 'working'
           when d.worked < (r.j ->> 'half_day_min_hours')::int * 60 then 'leave'
           when (d.last_out at time zone (r.j ->> 'timezone'))::time >= (r.j ->> 'office_end')::time then 'present'
           else 'half_day'
         end,
         d.auto, d.corr
  from days d cross join r;
$$;
revoke all on function public.ep_attendance_rows(date, date, uuid) from public, anon, authenticated;

-- Employee view now uses the shared rows (same columns as before).
create or replace function public.ep_my_attendance(p_from date, p_to date)
returns table (
  work_date      date,
  first_in       timestamptz,
  last_out       timestamptz,
  worked_minutes integer,
  sessions       integer,
  is_open        boolean,
  is_late        boolean,
  status         text,
  auto_out       boolean
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_emp uuid;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  perform public.ep_close_overdue_sessions(v_emp);
  return query
  select x.work_date, x.first_in, x.last_out, x.worked_minutes, x.sessions, x.is_open, x.is_late, x.status, x.auto_out
  from public.ep_attendance_rows(p_from, p_to, v_emp) x
  order by x.work_date desc;
end $$;

-- ---------------------------------------------------------------- corrections
create table if not exists public.ep_attendance_corrections (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.ep_employees (id) on delete cascade,
  work_date        date not null,
  attendance_id    uuid references public.ep_attendance (id) on delete set null,
  requested_in     timestamptz,
  requested_out    timestamptz,
  old_in           timestamptz,
  old_out          timestamptz,
  reason           text not null check (length(btrim(reason)) between 1 and 500),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by_admin uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 500),
  created_at       timestamptz not null default now(),
  constraint ep_corr_has_time check (requested_in is not null or requested_out is not null)
);
create unique index if not exists ep_corr_one_pending_per_day
  on public.ep_attendance_corrections (employee_id, work_date) where status = 'pending';
create index if not exists ep_corr_status on public.ep_attendance_corrections (status, created_at desc);
comment on table public.ep_attendance_corrections is
  'Employee Portal: attendance correction requests. Written via ep_request_correction / ep_admin_decide_correction.';

alter table public.ep_attendance_corrections enable row level security;
revoke all on public.ep_attendance_corrections from anon, authenticated;
grant select on public.ep_attendance_corrections to authenticated;
drop policy if exists ep_corr_read on public.ep_attendance_corrections;
create policy ep_corr_read on public.ep_attendance_corrections for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid())));

-- Validates a correction and returns the resulting session times.
create or replace function public.ep_correction_check(
  p_emp uuid, p_date date, p_att uuid, p_in timestamptz, p_out timestamptz,
  out new_in timestamptz, out new_out timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tz    text := public.ep_attendance_rules() ->> 'timezone';
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_att   public.ep_attendance;
begin
  if p_date is null or p_date > v_today or p_date < v_today - 30 then
    raise exception 'Corrections are possible for today and the last 30 days only.' using errcode = '22023';
  end if;
  if p_in is null and p_out is null then
    raise exception 'Enter the correct punch in and/or punch out time.' using errcode = '22023';
  end if;
  if p_att is not null then
    select * into v_att from public.ep_attendance where id = p_att and employee_id = p_emp;
    if v_att.id is null or v_att.work_date <> p_date then
      raise exception 'That punch session was not found on this day.' using errcode = 'P0002';
    end if;
    if v_att.punch_out_at is null and p_out is null then
      raise exception 'This session is still open. Punch out first, or enter the punch out time.' using errcode = '22023';
    end if;
    new_in  := coalesce(p_in, v_att.punch_in_at);
    new_out := coalesce(p_out, v_att.punch_out_at);
  else
    if p_in is null or p_out is null then
      raise exception 'To add a missing session, enter both punch in and punch out.' using errcode = '22023';
    end if;
    new_in := p_in;
    new_out := p_out;
  end if;
  if (new_in at time zone v_tz)::date <> p_date then
    raise exception 'Punch in must be on %.', to_char(p_date, 'DD Mon YYYY') using errcode = '22023';
  end if;
  if new_out <= new_in then
    raise exception 'Punch out must be after punch in.' using errcode = '22023';
  end if;
  if new_out > ((p_date + 1)::timestamp at time zone v_tz) then
    raise exception 'Punch out must be on the same day (before midnight).' using errcode = '22023';
  end if;
  if new_out > now() then
    raise exception 'Times cannot be in the future.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ep_attendance a
    where a.employee_id = p_emp and a.id is distinct from p_att
      and tstzrange(a.punch_in_at, coalesce(a.punch_out_at, now())) && tstzrange(new_in, new_out)) then
    raise exception 'These times overlap another punch session of the same day.' using errcode = '22023';
  end if;
end $$;
revoke all on function public.ep_correction_check(uuid, date, uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.ep_correction_json(c public.ep_attendance_corrections)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'work_date', c.work_date, 'attendance_id', c.attendance_id,
    'requested_in', c.requested_in, 'requested_out', c.requested_out,
    'old_in', c.old_in, 'old_out', c.old_out,
    'kind', case when c.old_in is null then 'add' else 'fix' end,
    'reason', c.reason, 'status', c.status, 'created_at', c.created_at,
    'decided_at', c.decided_at, 'decision_comment', c.decision_comment,
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                   from public.ep_employees e where e.id = c.employee_id));
$$;
revoke all on function public.ep_correction_json(public.ep_attendance_corrections) from public, anon, authenticated;

-- Employee: ask for a correction.
create or replace function public.ep_request_correction(
  p_date date, p_attendance uuid, p_in timestamptz, p_out timestamptz, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_chk record;
  v_att public.ep_attendance;
  v_row public.ep_attendance_corrections;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 500 then
    raise exception 'Write a reason (up to 500 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_attendance_corrections
              where employee_id = v_emp and work_date = p_date and status = 'pending') then
    raise exception 'You already have a pending correction for this day.' using errcode = '23505';
  end if;
  select * into v_chk from public.ep_correction_check(v_emp, p_date, p_attendance, p_in, p_out);
  if p_attendance is not null then
    select * into v_att from public.ep_attendance where id = p_attendance;
  end if;
  insert into public.ep_attendance_corrections
    (employee_id, work_date, attendance_id, requested_in, requested_out, old_in, old_out, reason)
  values (v_emp, p_date, p_attendance,
          case when p_attendance is null or p_in is distinct from v_att.punch_in_at then p_in end,
          case when p_attendance is null or p_out is distinct from v_att.punch_out_at then p_out end,
          v_att.punch_in_at, v_att.punch_out_at, v_reason)
  returning * into v_row;
  if v_row.requested_in is null and v_row.requested_out is null then
    raise exception 'The times are the same as now — nothing to correct.' using errcode = '22023';
  end if;
  return public.ep_correction_json(v_row);
end $$;

create or replace function public.ep_my_corrections()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(public.ep_correction_json(c) order by c.created_at desc)
    from (select * from public.ep_attendance_corrections where employee_id = v_emp
          order by created_at desc limit 50) c), '[]'::jsonb);
end $$;

create or replace function public.ep_cancel_correction(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_row public.ep_attendance_corrections;
begin
  update public.ep_attendance_corrections set status = 'cancelled'
   where id = p_id and employee_id = v_emp and status = 'pending'
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Only your pending requests can be cancelled.' using errcode = 'P0001';
  end if;
  return public.ep_correction_json(v_row);
end $$;

-- Admin: attendance of everyone (or one employee) for a date range (max 62 days).
create or replace function public.ep_admin_attendance(p_from date, p_to date, p_emp uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  perform public.ep_close_overdue_sessions(p_emp);
  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'department', e.department, 'is_active', e.is_active,
               'start_date', (timezone('Asia/Kolkata', e.created_at))::date) order by e.full_name)
      from public.ep_employees e where p_emp is null or e.id = p_emp), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.work_date desc, x.employee_id)
      from public.ep_attendance_rows(p_from, p_to, p_emp) x), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'employee_id', a.employee_id, 'work_date', a.work_date,
               'punch_in_at', a.punch_in_at, 'punch_out_at', a.punch_out_at,
               'auto_punched_out', a.auto_punched_out, 'corrected_at', a.corrected_at) order by a.punch_in_at)
      from public.ep_attendance a
      where a.work_date between p_from and p_to and (p_emp is null or a.employee_id = p_emp)), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', holiday_date, 'name', name) order by holiday_date)
      from public.ep_holidays where holiday_date between p_from and p_to), '[]'::jsonb),
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'date', g.d::date,
                                          'type', r.leave_type, 'half_day', r.half_day) order by g.d)
      from public.ep_leave_requests r,
           generate_series(greatest(r.start_date, p_from), least(r.end_date, p_to), interval '1 day') g(d)
      where r.status = 'approved' and r.start_date <= p_to and r.end_date >= p_from
        and (p_emp is null or r.employee_id = p_emp)), '[]'::jsonb),
    'pending_corrections', (select count(*) from public.ep_attendance_corrections where status = 'pending'));
end $$;

create or replace function public.ep_admin_corrections(p_status text default 'pending')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(public.ep_correction_json(c) order by c.created_at desc)
    from (select * from public.ep_attendance_corrections
           where coalesce(p_status, 'all') = 'all' or status = p_status
           order by created_at desc limit 200) c), '[]'::jsonb);
end $$;

create or replace function public.ep_admin_decide_correction(p_id uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.ep_attendance_corrections;
  v_chk record;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.ep_require_admin();
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 500 then
    raise exception 'Comment must be at most 500 characters.' using errcode = '22023';
  end if;
  select * into v_row from public.ep_attendance_corrections where id = p_id for update;
  if v_row.id is null then
    raise exception 'Correction request not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;

  if p_action = 'approved' then
    if v_row.old_in is not null and v_row.attendance_id is null then
      raise exception 'The punch session of this request no longer exists.' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_row.employee_id::text, 0));
    -- Check again: other sessions may have changed since the request.
    select * into v_chk from public.ep_correction_check(
      v_row.employee_id, v_row.work_date, v_row.attendance_id, v_row.requested_in, v_row.requested_out);
    if v_row.attendance_id is not null then
      update public.ep_attendance
         set punch_in_at = v_chk.new_in, punch_out_at = v_chk.new_out,
             auto_punched_out = false, corrected_at = now()
       where id = v_row.attendance_id;
    else
      insert into public.ep_attendance (employee_id, work_date, punch_in_at, punch_out_at, corrected_at)
      values (v_row.employee_id, v_row.work_date, v_chk.new_in, v_chk.new_out, now());
    end if;
  end if;

  update public.ep_attendance_corrections
     set status = p_action, decided_by_admin = auth.uid(), decided_at = now(), decision_comment = v_comment
   where id = p_id returning * into v_row;

  perform public.ep_notify(v_row.employee_id, 'attendance',
    'Attendance correction ' || p_action,
    to_char(v_row.work_date, 'DD Mon YYYY') || coalesce(' · ' || v_comment, ''),
    '/employee/attendance', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_correction_json(v_row);
end $$;

-- ================================================================ LEAVE
alter table public.ep_leave_requests
  add column if not exists decided_by_admin uuid references auth.users (id) on delete set null;

-- decided_by: the manager's name, or "Admin" when an admin decided.
create or replace function public.ep_leave_json(r public.ep_leave_requests)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'leave_type', r.leave_type, 'leave_name', (select name from public.ep_leave_types where code = r.leave_type),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_day', r.half_day, 'days', r.days,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'decided_by', coalesce((select full_name from public.ep_employees where id = r.decided_by),
                           case when r.decided_by_admin is not null then 'Admin' end),
    'approver', coalesce((select full_name from public.ep_employees where id = r.approver_id), r.approver_name),
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                           'designation', e.designation)
                   from public.ep_employees e where e.id = r.employee_id));
$$;
revoke all on function public.ep_leave_json(public.ep_leave_requests) from public, anon, authenticated;

-- One employee's balance of one type in one year.
create or replace function public.ep_leave_balance_json(p_emp uuid, p_year int, p_type text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'code', t.code, 'name', t.name, 'is_paid', t.is_paid,
    'default', t.yearly_days,
    'allowed', public.ep_leave_allowance(p_emp, p_year, t.code),
    'is_custom', exists (select 1 from public.ep_leave_allocations a
                          where a.employee_id = p_emp and a.year = p_year and a.leave_type = t.code),
    'approved', (select coalesce(sum(days), 0) from public.ep_leave_requests
                  where employee_id = p_emp and leave_type = t.code and status = 'approved'
                    and extract(year from start_date) = p_year),
    'pending', (select coalesce(sum(days), 0) from public.ep_leave_requests
                 where employee_id = p_emp and leave_type = t.code and status = 'pending'
                   and extract(year from start_date) = p_year))
  from public.ep_leave_types t where t.code = p_type;
$$;
revoke all on function public.ep_leave_balance_json(uuid, int, text) from public, anon, authenticated;

create or replace function public.ep_admin_leave_requests(p_status text default 'pending', p_year int default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(public.ep_leave_json(r)
             || jsonb_build_object('balance',
                  public.ep_leave_balance_json(r.employee_id, extract(year from r.start_date)::int, r.leave_type))
             order by case when r.status = 'pending' then 0 else 1 end, r.start_date desc, r.created_at desc)
    from (select * from public.ep_leave_requests
           where (coalesce(p_status, 'all') = 'all' or status = p_status)
             and (p_year is null or extract(year from start_date) = p_year)
           order by start_date desc limit 300) r), '[]'::jsonb);
end $$;

create or replace function public.ep_admin_decide_leave(p_id uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row     public.ep_leave_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed numeric;
  v_type    public.ep_leave_types;
begin
  perform public.ep_require_admin();
  select * into v_row from public.ep_leave_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  if p_action = 'approved' then
    select * into v_type from public.ep_leave_types where code = v_row.leave_type;
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this. Increase the balance or ask for Loss of Pay.', v_type.name
        using errcode = '22023';
    end if;
  end if;
  update public.ep_leave_requests
     set status = p_action, decided_by = null, decided_by_admin = auth.uid(), decided_at = now(),
         decision_comment = v_comment, updated_at = now()
   where id = p_id returning * into v_row;
  perform public.ep_notify(v_row.employee_id, 'leave',
    'Your leave was ' || p_action,
    (select name from public.ep_leave_types where code = v_row.leave_type) || ' · '
      || to_char(v_row.start_date, 'DD Mon YYYY')
      || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end
      || ' · by Admin' || coalesce(' · ' || v_comment, ''),
    '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_leave_json(v_row)
    || jsonb_build_object('balance',
         public.ep_leave_balance_json(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type));
end $$;

create or replace function public.ep_admin_leave_balances(p_year int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'year', p_year,
    'types', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'is_paid', is_paid, 'default', yearly_days)
                               order by sort_order)
              from public.ep_leave_types where is_active),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'balances', (select jsonb_agg(public.ep_leave_balance_json(e.id, p_year, t.code) order by t.sort_order)
                              from public.ep_leave_types t where t.is_active))
             order by e.is_active desc, e.full_name)
      from public.ep_employees e), '[]'::jsonb));
end $$;

-- p_days null = back to the default for that leave type.
create or replace function public.ep_admin_set_leave_allowance(p_emp uuid, p_year int, p_type text, p_days numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_type public.ep_leave_types;
  v_approved numeric;
begin
  perform public.ep_require_admin();
  select * into v_type from public.ep_leave_types where code = p_type;
  if v_type.code is null or not v_type.is_paid then
    raise exception 'Only paid leave types have a balance.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_emp) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  if p_days is null then
    delete from public.ep_leave_allocations where employee_id = p_emp and year = p_year and leave_type = p_type;
  else
    if p_days < 0 or p_days > 366 or p_days * 2 <> round(p_days * 2) then
      raise exception 'Days must be between 0 and 366, in steps of 0.5.' using errcode = '22023';
    end if;
    select coalesce(sum(days), 0) into v_approved from public.ep_leave_requests
     where employee_id = p_emp and leave_type = p_type and status = 'approved' and extract(year from start_date) = p_year;
    if p_days < v_approved then
      raise exception '% days of % are already approved this year; the balance cannot be lower.', v_approved, v_type.name
        using errcode = '22023';
    end if;
    insert into public.ep_leave_allocations (employee_id, year, leave_type, days)
    values (p_emp, p_year, p_type, p_days)
    on conflict (employee_id, year, leave_type) do update set days = excluded.days;
  end if;
  return public.ep_leave_balance_json(p_emp, p_year, p_type);
end $$;

-- ---------------------------------------------------------------- holidays
-- Re-count pending / approved leave that covers a date (after a holiday change).
create or replace function public.ep_recount_leave_on(p_date date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.ep_leave_requests;
  v_days numeric;
begin
  for r in select * from public.ep_leave_requests
            where status in ('pending', 'approved') and p_date between start_date and end_date for update loop
    v_days := public.ep_leave_day_count(r.start_date, r.end_date, r.half_day);
    if v_days = 0 then
      update public.ep_leave_requests
         set status = 'cancelled', updated_at = now(),
             decision_comment = 'Cancelled automatically: the day is now a company holiday.'
       where id = r.id;
      perform public.ep_notify(r.employee_id, 'leave', 'Leave not needed — company holiday',
        to_char(r.start_date, 'DD Mon YYYY') || ' is now a company holiday, so your leave request was cancelled.',
        '/employee/leave');
    elsif v_days <> r.days then
      update public.ep_leave_requests set days = v_days, updated_at = now() where id = r.id;
    end if;
  end loop;
end $$;
revoke all on function public.ep_recount_leave_on(date) from public, anon, authenticated;

create or replace function public.ep_admin_holidays(p_year int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'date', holiday_date, 'name', name) order by holiday_date)
    from public.ep_holidays where extract(year from holiday_date) = p_year), '[]'::jsonb);
end $$;

create or replace function public.ep_admin_save_holiday(p_id uuid, p_date date, p_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old date;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform public.ep_require_admin();
  if p_date is null or p_date not between date '2020-01-01' and date '2100-12-31' then
    raise exception 'Choose a valid date.' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Holiday name is required (up to 80 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_holidays where holiday_date = p_date and id is distinct from p_id) then
    raise exception '% is already a holiday.', to_char(p_date, 'DD Mon YYYY') using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.ep_holidays (holiday_date, name) values (p_date, v_name);
  else
    select holiday_date into v_old from public.ep_holidays where id = p_id for update;
    if not found then
      raise exception 'Holiday not found.' using errcode = 'P0002';
    end if;
    update public.ep_holidays set holiday_date = p_date, name = v_name where id = p_id;
    if v_old <> p_date then
      perform public.ep_recount_leave_on(v_old);
    end if;
  end if;
  perform public.ep_recount_leave_on(p_date);
  return public.ep_admin_holidays(extract(year from p_date)::int);
end $$;

create or replace function public.ep_admin_delete_holiday(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_date date;
begin
  perform public.ep_require_admin();
  delete from public.ep_holidays where id = p_id returning holiday_date into v_date;
  if v_date is null then
    raise exception 'Holiday not found.' using errcode = 'P0002';
  end if;
  perform public.ep_recount_leave_on(v_date);
  return public.ep_admin_holidays(extract(year from v_date)::int);
end $$;

-- ================================================================ grants
revoke all on function
  public.ep_request_correction(date, uuid, timestamptz, timestamptz, text), public.ep_my_corrections(),
  public.ep_cancel_correction(uuid),
  public.ep_admin_attendance(date, date, uuid), public.ep_admin_corrections(text),
  public.ep_admin_decide_correction(uuid, text, text),
  public.ep_admin_leave_requests(text, int), public.ep_admin_decide_leave(uuid, text, text),
  public.ep_admin_leave_balances(int), public.ep_admin_set_leave_allowance(uuid, int, text, numeric),
  public.ep_admin_holidays(int), public.ep_admin_save_holiday(uuid, date, text), public.ep_admin_delete_holiday(uuid)
  from public, anon;
grant execute on function
  public.ep_request_correction(date, uuid, timestamptz, timestamptz, text), public.ep_my_corrections(),
  public.ep_cancel_correction(uuid),
  public.ep_admin_attendance(date, date, uuid), public.ep_admin_corrections(text),
  public.ep_admin_decide_correction(uuid, text, text),
  public.ep_admin_leave_requests(text, int), public.ep_admin_decide_leave(uuid, text, text),
  public.ep_admin_leave_balances(int), public.ep_admin_set_leave_allowance(uuid, int, text, numeric),
  public.ep_admin_holidays(int), public.ep_admin_save_holiday(uuid, date, text), public.ep_admin_delete_holiday(uuid)
  to authenticated;

notify pgrst, 'reload schema';

-- ===================== 243_employee_admin_reports_notifications.sql =====================

-- 243: Employee Portal — admin Daily Work Reports + admin Notifications Management.
--
-- DAILY WORK REPORTS (admin only)
--   ep_admin_reports(from, to)                 -> every report in the range (with items, hours, manager feedback)
--                                                 + "missing": days an employee worked (punched in) but has no
--                                                 submitted report yet
--   ep_admin_review_report(id, action, comment)-> admin marks a submitted report Reviewed or Sends it back
--   ep_work_reports.reviewed_by_admin          -> who reviewed, when it was an admin ("Admin" in the JSON)
--
-- NOTIFICATIONS MANAGEMENT (admin only)
--   ep_admin_notify_options()                  -> people, departments and project teams to send to
--   ep_admin_send_notification(audience, ...)  -> 'all' | 'people' | 'department' | 'project'
--                                                 (shows in "Sent" like ep_send_message, sender "Admin")
--   ep_reminder_settings                       -> the 3 scheduled reminders (punch in, daily report, punch out):
--                                                 on/off, time (India) and week days, editable by the admin.
--                                                 ONE pg_cron job ('ep-reminders', every 5 minutes) runs
--                                                 ep_run_due_reminders(); the 3 fixed jobs from 236 are removed.
--   ep_admin_reminder_settings() / ep_admin_save_reminder(kind, enabled, time, days)
--   ep_admin_send_reminder_now(kind)           -> send now (each person at most once per day per reminder)
--   ep_admin_notification_log(kind, limit)     -> recent notifications to everyone, + 30-day counts per kind
-- Rollback: supabase/rollbacks/243_rollback_employee_admin_reports_notifications.sql


-- ================================================================ REPORTS
alter table public.ep_work_reports
  add column if not exists reviewed_by_admin uuid references auth.users (id) on delete set null;

-- reviewed_by = the manager, or { full_name: 'Admin' } when an admin reviewed.
create or replace function public.ep_report_json(p_report uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'report_date', r.report_date, 'status', r.status, 'notes', r.notes,
    'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at, 'review_comment', r.review_comment,
    'updated_at', r.updated_at,
    'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                   'designation', e.designation),
    'submitted_to', case when st.id is null then null
                         else jsonb_build_object('id', st.id, 'full_name', st.full_name, 'employee_code', st.employee_code) end,
    'reviewed_by', case when rb.id is not null then jsonb_build_object('id', rb.id, 'full_name', rb.full_name)
                        when r.reviewed_by_admin is not null then jsonb_build_object('id', null, 'full_name', 'Admin')
                        else null end,
    'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0),
    'worked_minutes', (
      select floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int
      from public.ep_attendance a where a.employee_id = r.employee_id and a.work_date = r.report_date),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', i.project_id, 'project_code', p.project_code, 'project_name', p.name,
               'task_updates', i.task_updates, 'completed_work', i.completed_work,
               'pending_work', i.pending_work, 'hours', i.hours)
             order by i.position, p.name)
      from public.ep_work_report_items i join public.pt_projects p on p.id = i.project_id
      where i.report_id = r.id), '[]'::jsonb)
  )
  from public.ep_work_reports r
  join public.ep_employees e on e.id = r.employee_id
  left join public.ep_employees st on st.id = r.submitted_to
  left join public.ep_employees rb on rb.id = r.reviewed_by
  where r.id = p_report;
$$;
revoke all on function public.ep_report_json(uuid) from public, anon, authenticated;

-- Report status notifications: name "Admin" when an admin reviewed.
create or replace function public.ep_trg_report_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp_name text;
  v_mgr_name text;
  v_day      text := to_char(new.report_date, 'DD Mon YYYY');
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  select full_name into v_emp_name from public.ep_employees where id = new.employee_id;
  select full_name into v_mgr_name from public.ep_employees where id = new.reviewed_by;
  if v_mgr_name is null and new.reviewed_by_admin is not null then
    v_mgr_name := 'Admin';
  end if;
  if new.status = 'submitted' then
    perform public.ep_notify(new.submitted_to, 'report',
      v_emp_name || ' submitted a daily report', 'Report for ' || v_day || ' is waiting for your review.',
      '/employee/reports/team/' || new.id);
  elsif new.status = 'reviewed' then
    perform public.ep_notify(new.employee_id, 'report',
      'Your daily report was reviewed', 'Report for ' || v_day || coalesce(' · ' || v_mgr_name, '')
        || coalesce(': ' || new.review_comment, ''),
      '/employee/reports?date=' || new.report_date);
  elsif new.status = 'returned' then
    perform public.ep_notify(new.employee_id, 'report',
      'Your daily report was sent back', 'Report for ' || v_day || coalesce(' · ' || v_mgr_name, '')
        || coalesce(': ' || new.review_comment, ''),
      '/employee/reports?date=' || new.report_date, 'urgent');
  end if;
  return new;
end $$;
revoke all on function public.ep_trg_report_status() from public, anon, authenticated;

create or replace function public.ep_admin_reports(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.ep_require_admin();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose a date range of at most 93 days.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(public.ep_report_json(r.id) order by r.report_date desc, r.updated_at desc)
      from public.ep_work_reports r where r.report_date between p_from and p_to), '[]'::jsonb),
    -- Worked that day (punched in, on a project) but no submitted / reviewed report.
    'missing', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code),
               'date', d.work_date,
               'status', coalesce(w.status, 'not_started')) order by d.work_date desc, e.full_name)
      from (select distinct employee_id, work_date from public.ep_attendance
             where work_date between p_from and least(p_to, v_today)) d
      join public.ep_employees e on e.id = d.employee_id
      left join public.ep_work_reports w on w.employee_id = d.employee_id and w.report_date = d.work_date
      where exists (select 1 from public.ep_project_members m where m.employee_id = e.id)
        and (w.id is null or w.status in ('draft', 'returned'))), '[]'::jsonb));
end $$;

create or replace function public.ep_admin_review_report(p_report uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_status  text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.ep_require_admin();
  select status into v_status from public.ep_work_reports where id = p_report for update;
  if v_status is null then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed (this one is %).', v_status using errcode = 'P0001';
  end if;
  if p_action not in ('reviewed', 'returned') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'returned' and v_comment is null then
    raise exception 'Write a comment saying what needs to change.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  update public.ep_work_reports
     set status = p_action, reviewed_by = null, reviewed_by_admin = auth.uid(), reviewed_at = now(),
         review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $$;

-- ================================================================ NOTIFICATIONS
create or replace function public.ep_admin_notify_options()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation, 'department', e.department) order by e.full_name)
      from public.ep_employees e where e.is_active), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('name', d.department, 'count', d.n) order by d.department)
      from (select department, count(*) as n from public.ep_employees
             where is_active and department is not null group by department) d), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'project_code', p.project_code, 'count', x.n)
                       order by p.name)
      from public.pt_projects p
      join (select m.project_id, count(*) as n from public.ep_project_members m
              join public.ep_employees e on e.id = m.employee_id and e.is_active
             group by m.project_id) x on x.project_id = p.id), '[]'::jsonb));
end $$;

-- p_audience: 'all' | 'people' (p_to) | 'department' (p_departments) | 'project' (p_project).
create or replace function public.ep_admin_send_notification(
  p_audience text, p_to uuid[], p_departments text[], p_project uuid,
  p_title text, p_body text, p_priority text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_msg   uuid := gen_random_uuid();
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
  v_n     integer;
begin
  perform public.ep_require_admin();
  if length(v_title) not between 1 and 150 then
    raise exception 'Subject must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('normal', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if p_audience not in ('all', 'people', 'department', 'project') then
    raise exception 'Invalid audience.' using errcode = '22023';
  end if;
  if p_audience = 'people' and coalesce(cardinality(p_to), 0) = 0 then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_audience = 'department' and coalesce(cardinality(p_departments), 0) = 0 then
    raise exception 'Choose at least one department.' using errcode = '22023';
  end if;
  if p_audience = 'project' and p_project is null then
    raise exception 'Choose a project team.' using errcode = '22023';
  end if;

  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_employee_id, sender_user_id, sender_label, message_id)
  select e.id, 'message', p_priority, v_title, v_body, null, auth.uid(), 'Admin', v_msg
    from public.ep_employees e
   where e.is_active
     and case p_audience
           when 'all'        then true
           when 'people'     then e.id = any (p_to)
           when 'department' then e.department = any (p_departments)
           else exists (select 1 from public.ep_project_members m where m.project_id = p_project and m.employee_id = e.id)
         end;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nobody active matches this audience.' using errcode = '22023';
  end if;
  return jsonb_build_object('message_id', v_msg, 'recipients', v_n);
end $$;

-- ---------------------------------------------------------------- scheduled reminders
create table if not exists public.ep_reminder_settings (
  kind       text primary key check (kind in ('punch_in', 'report', 'punch_out')),
  enabled    boolean not null default true,
  send_at    time not null,
  days       smallint[] not null default '{1,2,3,4,5,6}'
             check (days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(days) between 1 and 7),
  last_run   date,
  updated_at timestamptz not null default now()
);
comment on table public.ep_reminder_settings is
  'Employee Portal: scheduled reminders (India time; days = ISO weekdays 1 Mon .. 7 Sun). Run by ep_run_due_reminders().';
insert into public.ep_reminder_settings (kind, send_at) values
  ('punch_in', '09:45'), ('report', '18:30'), ('punch_out', '21:30')
on conflict (kind) do nothing;
alter table public.ep_reminder_settings enable row level security;
revoke all on public.ep_reminder_settings from anon, authenticated;

-- Sends every reminder that is due now (at most once a day each). Called every 5 minutes by pg_cron.
-- A reminder more than 2 hours late (e.g. the job was paused) is skipped for that day.
create or replace function public.ep_run_due_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_now   timestamp := timezone('Asia/Kolkata', now());
  v_today date := v_now::date;
  v_n     integer := 0;
  s       public.ep_reminder_settings;
begin
  for s in select * from public.ep_reminder_settings
            where enabled and extract(isodow from v_today)::smallint = any (days)
              and v_now::time >= send_at and v_now::time < send_at + interval '2 hours'
              and (last_run is null or last_run < v_today)
            for update skip locked loop
    v_n := v_n + public.ep_send_reminders(s.kind);
    update public.ep_reminder_settings set last_run = v_today where kind = s.kind;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_run_due_reminders() from public, anon, authenticated;

create or replace function public.ep_admin_reminder_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return (select jsonb_agg(jsonb_build_object(
                   'kind', kind, 'enabled', enabled, 'send_at', to_char(send_at, 'HH24:MI'),
                   'days', to_jsonb(days), 'last_run', last_run,
                   'sent_today', (select count(*) from public.ep_notifications
                                   where dedupe_key = s.kind || ':' || (timezone('Asia/Kolkata', now()))::date))
                 order by send_at)
          from public.ep_reminder_settings s);
end $$;

create or replace function public.ep_admin_save_reminder(p_kind text, p_enabled boolean, p_send_at time, p_days smallint[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if p_send_at is null or p_send_at < time '06:00' or p_send_at > time '21:55' then
    raise exception 'Choose a time between 6:00 AM and 9:55 PM.' using errcode = '22023';
  end if;
  if p_days is null or cardinality(p_days) = 0 or not (p_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
    raise exception 'Choose at least one day.' using errcode = '22023';
  end if;
  update public.ep_reminder_settings
     set enabled = coalesce(p_enabled, false), send_at = p_send_at,
         days = (select array_agg(distinct d order by d) from unnest(p_days) d), updated_at = now()
   where kind = p_kind;
  if not found then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_reminder_settings();
end $$;

-- Send one reminder now. Returns how many people got it (people already reminded today are skipped).
create or replace function public.ep_admin_send_reminder_now(p_kind text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_key    text;
  v_before integer;
  v_after  integer;
begin
  perform public.ep_require_admin();
  if p_kind not in ('punch_in', 'report', 'punch_out') then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  v_key := p_kind || ':' || (timezone('Asia/Kolkata', now()))::date;
  select count(*) into v_before from public.ep_notifications where dedupe_key = v_key;
  perform public.ep_send_reminders(p_kind);
  select count(*) into v_after from public.ep_notifications where dedupe_key = v_key;
  return v_after - v_before;
end $$;

-- ---------------------------------------------------------------- log
-- p_kind: 'all' | a kind | 'automatic' (no sender) | 'messages'.
create or replace function public.ep_admin_notification_log(p_kind text default 'all', p_limit int default 100)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return jsonb_build_object(
    'counts', (
      select jsonb_object_agg(k.kind, coalesce(c.n, 0))
      from unnest(array['project', 'leave', 'attendance', 'report', 'message']) k(kind)
      left join (select kind, count(*) as n from public.ep_notifications
                  where created_at > now() - interval '30 days' group by kind) c on c.kind = k.kind),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
               'created_at', n.created_at, 'read_at', n.read_at, 'sender', n.sender_label,
               'automatic', n.sender_user_id is null,
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code))
             order by n.created_at desc)
      from (select * from public.ep_notifications
             where case coalesce(p_kind, 'all')
                     when 'all' then true
                     when 'automatic' then sender_user_id is null
                     when 'messages' then message_id is not null
                     else kind = p_kind
                   end
             order by created_at desc
             limit least(greatest(coalesce(p_limit, 100), 1), 300)) n
      join public.ep_employees e on e.id = n.employee_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- cron: one job instead of three
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning 'ep reminders: pg_cron not installed; scheduled reminders will not run.';
    return;
  end if;
  perform cron.unschedule(jobname) from cron.job
   where jobname in ('ep-remind-punch-in', 'ep-remind-report', 'ep-remind-punch-out');
  perform cron.schedule('ep-reminders', '*/5 * * * *', $c$select public.ep_run_due_reminders()$c$);
end $$;

-- ================================================================ grants
revoke all on function
  public.ep_admin_reports(date, date), public.ep_admin_review_report(uuid, text, text),
  public.ep_admin_notify_options(), public.ep_admin_send_notification(text, uuid[], text[], uuid, text, text, text),
  public.ep_admin_reminder_settings(), public.ep_admin_save_reminder(text, boolean, time, smallint[]),
  public.ep_admin_send_reminder_now(text), public.ep_admin_notification_log(text, int)
  from public, anon;
grant execute on function
  public.ep_admin_reports(date, date), public.ep_admin_review_report(uuid, text, text),
  public.ep_admin_notify_options(), public.ep_admin_send_notification(text, uuid[], text[], uuid, text, text, text),
  public.ep_admin_reminder_settings(), public.ep_admin_save_reminder(text, boolean, time, smallint[]),
  public.ep_admin_send_reminder_now(text), public.ep_admin_notification_log(text, int)
  to authenticated;

notify pgrst, 'reload schema';

-- ===================== 244_employee_deadlines_delay_reasons.sql =====================

-- 244: Employee Portal — deadline reminders + reasons for missed deadlines.
--
-- DEADLINE REMINDERS (new scheduled reminder kind 'deadlines', default 10:00 Mon–Sat, editable by
-- the admin in Notifications Management; run by ep_run_due_reminders every 5 minutes):
--   Task (not done, project not completed/cancelled) -> the assignee:
--       due in 2 days / due tomorrow / due today
--       overdue and no reason written -> URGENT "write why it is late", every day until written
--   Project deadline (pt_projects.end_date, status planning / in progress / on hold) -> the team:
--       in 3 days / tomorrow / today
--       passed and nobody wrote a reason yet -> URGENT to the project leads (all members if no lead),
--       every day until a reason is written
--   One notification per person per item per day (dedupe key 'deadlines:<date>:...').
--
-- REASONS
--   ep_project_tasks.delay_reason (+ _by, _at): required when a task is marked Done after its
--     deadline (ep_set_task_status now takes p_delay_reason); can also be written while overdue
--     (ep_set_task_delay_reason).
--   ep_project_delay_reasons: a team member explains a missed PROJECT deadline
--     (ep_set_project_delay_reason; one per member per deadline date, editable).
--   Shown to the team (ep_project_detail) and to the admin (ep_admin_pm_project).
-- Rollback: supabase/rollbacks/244_rollback_employee_deadlines_delay_reasons.sql


-- ================================================================ data
alter table public.ep_project_tasks
  add column if not exists delay_reason    text check (delay_reason is null or length(btrim(delay_reason)) between 1 and 1000),
  add column if not exists delay_reason_by uuid references public.ep_employees (id) on delete set null,
  add column if not exists delay_reason_at timestamptz;

create table if not exists public.ep_project_delay_reasons (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.pt_projects (id) on delete cascade,
  employee_id uuid not null references public.ep_employees (id) on delete cascade,
  deadline    date not null,
  reason      text not null check (length(btrim(reason)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, employee_id, deadline)
);
comment on table public.ep_project_delay_reasons is
  'Employee Portal: why a project missed its deadline (written by team members via ep_set_project_delay_reason).';
alter table public.ep_project_delay_reasons enable row level security;
revoke all on public.ep_project_delay_reasons from anon, authenticated;
grant select on public.ep_project_delay_reasons to authenticated;
drop policy if exists ep_project_delay_reasons_read on public.ep_project_delay_reasons;
create policy ep_project_delay_reasons_read on public.ep_project_delay_reasons for select to authenticated
  using ((select public.is_admin()) or public.ep_is_project_member(project_id));

-- Projects whose deadline still matters (not delivered / closed).
create or replace function public.ep_project_is_running(p_status text)
returns boolean
language sql immutable set search_path = ''
as $$ select p_status in ('planning', 'in_progress', 'on_hold'); $$;

-- ================================================================ employee: tasks
drop function if exists public.ep_set_task_status(uuid, text);
create function public.ep_set_task_status(p_task uuid, p_status text, p_delay_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_task   public.ep_project_tasks;
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_reason text := nullif(btrim(coalesce(p_delay_reason, '')), '');
begin
  select * into v_task from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_task.id is null
     or not exists (select 1 from public.ep_project_members where project_id = v_task.project_id and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if coalesce(length(v_reason), 0) > 1000 then
    raise exception 'The reason must be at most 1000 characters.' using errcode = '22023';
  end if;
  if p_status = 'done' and v_task.status <> 'done' and v_task.due_date < v_today
     and v_task.delay_reason is null and v_reason is null then
    raise exception 'This task is past its deadline (%). Write why it is late to mark it done.',
      to_char(v_task.due_date, 'DD Mon YYYY') using errcode = 'P0001', hint = 'delay_reason_required';
  end if;
  update public.ep_project_tasks
     set status = p_status,
         updated_at = now(),
         completed_at = case when p_status = 'done' then coalesce(completed_at, now()) else null end,
         delay_reason    = coalesce(v_reason, delay_reason),
         delay_reason_by = case when v_reason is not null then v_emp else delay_reason_by end,
         delay_reason_at = case when v_reason is not null then now() else delay_reason_at end
   where id = p_task;
end $$;

-- Write / change why a task is late (only once it is past its deadline).
create or replace function public.ep_set_task_delay_reason(p_task uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_task   public.ep_project_tasks;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_task from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_task.id is null
     or not exists (select 1 from public.ep_project_members where project_id = v_task.project_id and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write the reason (up to 1000 characters).' using errcode = '22023';
  end if;
  if v_task.due_date is null
     or v_task.due_date >= coalesce((timezone('Asia/Kolkata', v_task.completed_at))::date,
                                    (timezone('Asia/Kolkata', now()))::date) then
    raise exception 'This task is not late.' using errcode = 'P0001';
  end if;
  update public.ep_project_tasks
     set delay_reason = v_reason, delay_reason_by = v_emp, delay_reason_at = now(), updated_at = now()
   where id = p_task;
end $$;

-- ================================================================ employee: project
create or replace function public.ep_set_project_delay_reason(p_project uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_proj   public.pt_projects;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
begin
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write the reason (up to 1000 characters).' using errcode = '22023';
  end if;
  select * into v_proj from public.pt_projects where id = p_project;
  if v_proj.end_date is null
     or not coalesce((v_proj.end_date < v_today and public.ep_project_is_running(v_proj.status))
                     or v_proj.completed_date > v_proj.end_date, false) then
    raise exception 'This project has not missed its deadline.' using errcode = 'P0001';
  end if;
  insert into public.ep_project_delay_reasons (project_id, employee_id, deadline, reason)
  values (p_project, v_emp, v_proj.end_date, v_reason)
  on conflict (project_id, employee_id, deadline) do update set reason = excluded.reason, updated_at = now();
end $$;

-- Reasons for one project (newest first), as JSON.
create or replace function public.ep_project_delay_json(p_project uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'deadline', d.deadline, 'reason', d.reason, 'updated_at', d.updated_at,
           'employee_id', e.id, 'full_name', e.full_name) order by d.deadline desc, d.updated_at desc), '[]'::jsonb)
  from public.ep_project_delay_reasons d join public.ep_employees e on e.id = d.employee_id
  where d.project_id = p_project;
$$;
revoke all on function public.ep_project_delay_json(uuid) from public, anon, authenticated;

-- Employee project page: + delay reasons (project and tasks) and overdue flags.
create or replace function public.ep_project_detail(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'project', jsonb_build_object(
        'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
        'project_type', p.project_type, 'description', p.description, 'status', p.status,
        'progress', p.progress, 'priority', p.priority, 'health', p.health,
        'project_manager', p.project_manager, 'next_action', p.next_action, 'live_url', p.live_url,
        'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
        'overdue', p.end_date < v_today and public.ep_project_is_running(p.status),
        'completed_late', p.completed_date > p.end_date),
      'delay_reasons', public.ep_project_delay_json(p.id),
      'me', v_emp,
      'team', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'employee_id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                 'designation', e.designation, 'department', e.department,
                 'project_role', m.project_role, 'is_lead', m.is_lead)
               order by m.is_lead desc, e.full_name)
        from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
        where m.project_id = p.id), '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status,
                 'priority', t.priority, 'due_date', t.due_date, 'completed_at', t.completed_at,
                 'assignee_id', t.assignee_id, 'assignee_name', a.full_name, 'created_at', t.created_at,
                 'overdue', t.status <> 'done' and t.due_date < v_today,
                 'late', t.due_date < coalesce((timezone('Asia/Kolkata', t.completed_at))::date, v_today),
                 'delay_reason', t.delay_reason, 'delay_reason_at', t.delay_reason_at,
                 'delay_reason_by', (select full_name from public.ep_employees where id = t.delay_reason_by))
               order by (t.status = 'done'), t.due_date nulls last, t.created_at)
        from public.ep_project_tasks t left join public.ep_employees a on a.id = t.assignee_id
        where t.project_id = p.id), '[]'::jsonb),
      'updates', coalesce((
        select jsonb_agg(u.j order by u.created_at desc) from (
          select pu.created_at, jsonb_build_object(
                   'id', pu.id, 'body', pu.body, 'created_at', pu.created_at,
                   'author_name', au.full_name, 'author_code', au.employee_code) as j
          from public.ep_project_updates pu left join public.ep_employees au on au.id = pu.author_id
          where pu.project_id = p.id
          order by pu.created_at desc limit 50) u), '[]'::jsonb)
    )
    from public.pt_projects p left join public.pt_companies c on c.id = p.company_id
    where p.id = p_project
  );
end $$;

-- ================================================================ admin: project page
create or replace function public.ep_admin_pm_project(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v jsonb;
begin
  perform public.ep_require_admin();
  select jsonb_build_object(
           'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
           'description', p.description, 'project_type', p.project_type,
           'status', p.status, 'priority', p.priority, 'health', p.health, 'progress', p.progress,
           'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
           'project_manager', p.project_manager,
           'overdue', p.end_date < v_today and public.ep_project_is_running(p.status),
           'completed_late', p.completed_date > p.end_date,
           'delay_reasons', public.ep_project_delay_json(p.id))
    into v
  from public.pt_projects p
  left join public.pt_companies c on c.id = p.company_id
  where p.id = p_project;
  if v is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  return v || jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'project_role', m.project_role, 'is_lead', m.is_lead, 'added_at', m.added_at,
               'tasks_total',       (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id),
               'tasks_done',        (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'done'),
               'tasks_in_progress', (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'in_progress'),
               'tasks_overdue',     (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id
                                       and t.status <> 'done' and t.due_date < v_today),
               'hours_logged', coalesce((
                 select sum(i.hours) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed')), 0),
               'last_report_date', (
                 select max(r.report_date) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed'))
             ) order by m.is_lead desc, e.full_name)
      from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
      where m.project_id = p_project), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status,
               'priority', t.priority, 'due_date', t.due_date, 'completed_at', t.completed_at,
               'created_at', t.created_at,
               'overdue', t.status <> 'done' and t.due_date < v_today,
               'late', t.due_date < coalesce((timezone('Asia/Kolkata', t.completed_at))::date, v_today),
               'delay_reason', t.delay_reason, 'delay_reason_at', t.delay_reason_at,
               'delay_reason_by', (select full_name from public.ep_employees where id = t.delay_reason_by),
               'assignee', case when a.id is null then null else jsonb_build_object('id', a.id, 'full_name', a.full_name) end,
               'created_by', coalesce(cb.full_name, 'Admin'))
             order by (t.status = 'done'), t.due_date nulls last, t.created_at desc)
      from public.ep_project_tasks t
      left join public.ep_employees a on a.id = t.assignee_id
      left join public.ep_employees cb on cb.id = t.created_by
      where t.project_id = p_project), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'body', u.body, 'created_at', u.created_at,
                                          'author', coalesce(au.full_name, 'Admin')) order by u.created_at desc)
      from (select * from public.ep_project_updates where project_id = p_project order by created_at desc limit 20) u
      left join public.ep_employees au on au.id = u.author_id), '[]'::jsonb)
  );
end $$;

-- ================================================================ deadline reminders
alter table public.ep_reminder_settings drop constraint if exists ep_reminder_settings_kind_check;
alter table public.ep_reminder_settings
  add constraint ep_reminder_settings_kind_check check (kind in ('punch_in', 'report', 'punch_out', 'deadlines'));
insert into public.ep_reminder_settings (kind, send_at) values ('deadlines', '10:00') on conflict (kind) do nothing;

create or replace function public.ep_send_deadline_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_key   text;
  v_n     integer := 0;
  r       record;
begin
  if exists (select 1 from public.ep_holidays where holiday_date = v_today) then
    return 0;
  end if;
  v_key := 'deadlines:' || v_today || ':';

  -- Tasks -> assignee.
  for r in
    select t.id, t.title, t.due_date, t.assignee_id, t.project_id, p.name as project_name, t.delay_reason
      from public.ep_project_tasks t
      join public.pt_projects p on p.id = t.project_id
      join public.ep_employees e on e.id = t.assignee_id and e.is_active
     where t.status <> 'done' and t.due_date is not null and t.due_date <= v_today + 2
       and p.status not in ('completed', 'cancelled')
  loop
    if r.due_date < v_today then
      if r.delay_reason is null then
        perform public.ep_notify(r.assignee_id, 'project',
          'Task overdue — write why it is late',
          '"' || r.title || '" (' || r.project_name || ') was due on ' || to_char(r.due_date, 'DD Mon YYYY')
            || '. Open the task and write the reason for the delay.',
          '/employee/projects/' || r.project_id || '?tab=tasks', 'urgent', v_key || 'task-late:' || r.id);
        v_n := v_n + 1;
      end if;
    else
      perform public.ep_notify(r.assignee_id, 'project',
        case r.due_date - v_today when 0 then 'Task due today' when 1 then 'Task due tomorrow' else 'Task due in 2 days' end,
        '"' || r.title || '" (' || r.project_name || ') · deadline ' || to_char(r.due_date, 'DD Mon YYYY') || '.',
        '/employee/projects/' || r.project_id || '?tab=tasks', 'normal', v_key || 'task:' || r.id);
      v_n := v_n + 1;
    end if;
  end loop;

  -- Projects -> team (overdue: leads, or everyone when there is no lead; until someone writes a reason).
  for r in
    select p.id, p.name, p.end_date, m.employee_id,
           exists (select 1 from public.ep_project_members l where l.project_id = p.id and l.is_lead) as has_lead,
           m.is_lead
      from public.pt_projects p
      join public.ep_project_members m on m.project_id = p.id
      join public.ep_employees e on e.id = m.employee_id and e.is_active
     where public.ep_project_is_running(p.status) and p.end_date is not null and p.end_date <= v_today + 3
  loop
    if r.end_date < v_today then
      if (r.is_lead or not r.has_lead)
         and not exists (select 1 from public.ep_project_delay_reasons d where d.project_id = r.id and d.deadline = r.end_date) then
        perform public.ep_notify(r.employee_id, 'project',
          'Project deadline passed — write the reason',
          r.name || ' was due on ' || to_char(r.end_date, 'DD Mon YYYY') || '. Open the project and write why it is delayed.',
          '/employee/projects/' || r.id, 'urgent', v_key || 'project-late:' || r.id);
        v_n := v_n + 1;
      end if;
    elsif r.end_date - v_today in (0, 1, 3) then
      perform public.ep_notify(r.employee_id, 'project',
        case r.end_date - v_today when 0 then 'Project deadline is today' when 1 then 'Project deadline is tomorrow'
             else 'Project deadline in 3 days' end,
        r.name || ' · deadline ' || to_char(r.end_date, 'DD Mon YYYY') || '.',
        '/employee/projects/' || r.id, 'normal', v_key || 'project:' || r.id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_send_deadline_reminders() from public, anon, authenticated;

create or replace function public.ep_run_due_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_now   timestamp := timezone('Asia/Kolkata', now());
  v_today date := v_now::date;
  v_n     integer := 0;
  s       public.ep_reminder_settings;
begin
  for s in select * from public.ep_reminder_settings
            where enabled and extract(isodow from v_today)::smallint = any (days)
              and v_now::time >= send_at and v_now::time < send_at + interval '2 hours'
              and (last_run is null or last_run < v_today)
            for update skip locked loop
    v_n := v_n + case when s.kind = 'deadlines' then public.ep_send_deadline_reminders()
                      else public.ep_send_reminders(s.kind) end;
    update public.ep_reminder_settings set last_run = v_today where kind = s.kind;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_run_due_reminders() from public, anon, authenticated;

create or replace function public.ep_admin_reminder_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return (select jsonb_agg(jsonb_build_object(
                   'kind', kind, 'enabled', enabled, 'send_at', to_char(send_at, 'HH24:MI'),
                   'days', to_jsonb(days), 'last_run', last_run,
                   'sent_today', (select count(*) from public.ep_notifications
                                   where dedupe_key like s.kind || ':' || (timezone('Asia/Kolkata', now()))::date || '%'))
                 order by send_at)
          from public.ep_reminder_settings s);
end $$;

create or replace function public.ep_admin_send_reminder_now(p_kind text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_key    text;
  v_before integer;
  v_after  integer;
begin
  perform public.ep_require_admin();
  if p_kind not in ('punch_in', 'report', 'punch_out', 'deadlines') then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  v_key := p_kind || ':' || (timezone('Asia/Kolkata', now()))::date || '%';
  select count(*) into v_before from public.ep_notifications where dedupe_key like v_key;
  if p_kind = 'deadlines' then
    perform public.ep_send_deadline_reminders();
  else
    perform public.ep_send_reminders(p_kind);
  end if;
  select count(*) into v_after from public.ep_notifications where dedupe_key like v_key;
  return v_after - v_before;
end $$;

-- ================================================================ grants
revoke all on function public.ep_set_task_status(uuid, text, text), public.ep_set_task_delay_reason(uuid, text),
  public.ep_set_project_delay_reason(uuid, text) from public, anon;
grant execute on function public.ep_set_task_status(uuid, text, text), public.ep_set_task_delay_reason(uuid, text),
  public.ep_set_project_delay_reason(uuid, text) to authenticated;
grant execute on function public.ep_project_is_running(text) to authenticated;

notify pgrst, 'reload schema';

-- ===================== 245_employee_internship_certificate.sql =====================

-- 245: Employee Portal — internship certificate.
--
-- The admin uploads an intern's certificate (PDF or image, max 10 MB) on the employee's page
-- (Admin -> Employee Management); the intern downloads it from My Profile.
--   storage bucket "ep-certificates" (private), path "<employee_id>/<uuid>-<file name>"
--     admin: read / upload / delete;  employee: read files in their OWN folder only
--   ep_internship_certificates: one row per employee (the current certificate)
--     read: admin, and the employee themself (RLS); written only through the RPCs below
--   ep_admin_set_certificate(employee, path, name, size, mime) -> only for employment type "intern";
--     the file must already be uploaded in the employee's folder; replaces the previous one and
--     returns its path so the page can delete the old file; notifies the intern
--   ep_admin_remove_certificate(employee) -> returns the path so the page can delete the file
-- Rollback: supabase/rollbacks/245_rollback_employee_internship_certificate.sql


insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('ep-certificates', 'ep-certificates', false, 10485760,
   array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ep-certificates: admin read" on storage.objects;
create policy "ep-certificates: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'ep-certificates' and public.is_admin());
drop policy if exists "ep-certificates: admin upload" on storage.objects;
create policy "ep-certificates: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'ep-certificates' and public.is_admin());
drop policy if exists "ep-certificates: admin delete" on storage.objects;
create policy "ep-certificates: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'ep-certificates' and public.is_admin());
drop policy if exists "ep-certificates: employee read own" on storage.objects;
create policy "ep-certificates: employee read own" on storage.objects for select to authenticated
  using (bucket_id = 'ep-certificates'
         and (storage.foldername(name))[1] in (
           select e.id::text from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

create table if not exists public.ep_internship_certificates (
  employee_id  uuid primary key references public.ep_employees (id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null check (length(btrim(file_name)) between 1 and 255),
  file_size    bigint not null check (file_size > 0 and file_size <= 10485760),
  mime_type    text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  uploaded_by  uuid references auth.users (id) on delete set null,
  uploaded_at  timestamptz not null default now(),
  constraint ep_cert_path_in_folder check (storage_path like employee_id::text || '/%')
);
comment on table public.ep_internship_certificates is
  'Employee Portal: internship certificate file (bucket ep-certificates). Written via ep_admin_set_certificate.';

alter table public.ep_internship_certificates enable row level security;
revoke all on public.ep_internship_certificates from anon, authenticated;
grant select on public.ep_internship_certificates to authenticated;
drop policy if exists ep_cert_read on public.ep_internship_certificates;
create policy ep_cert_read on public.ep_internship_certificates for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

create or replace function public.ep_admin_set_certificate(
  p_emp uuid, p_path text, p_name text, p_size bigint, p_mime text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_type text;
  v_old  text;
begin
  perform public.ep_require_admin();
  select employment_type into v_type from public.ep_employees where id = p_emp;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if v_type is distinct from 'intern' then
    raise exception 'Set the employment type to Intern first.' using errcode = '22023';
  end if;
  if p_path is null or p_path not like p_emp::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ep-certificates' and name = p_path) then
    raise exception 'The file was not uploaded.' using errcode = 'P0002';
  end if;
  select storage_path into v_old from public.ep_internship_certificates where employee_id = p_emp for update;
  insert into public.ep_internship_certificates (employee_id, storage_path, file_name, file_size, mime_type, uploaded_by, uploaded_at)
  values (p_emp, p_path, left(btrim(p_name), 255), p_size, p_mime, auth.uid(), now())
  on conflict (employee_id) do update
    set storage_path = excluded.storage_path, file_name = excluded.file_name, file_size = excluded.file_size,
        mime_type = excluded.mime_type, uploaded_by = excluded.uploaded_by, uploaded_at = now();
  perform public.ep_notify(p_emp, 'message',
    case when v_old is null then 'Your internship certificate is ready' else 'Your internship certificate was updated' end,
    'Download it from My Profile.', '/employee/profile');
  return jsonb_build_object('old_path', case when v_old is distinct from p_path then v_old end);
end $$;

create or replace function public.ep_admin_remove_certificate(p_emp uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old text;
begin
  perform public.ep_require_admin();
  delete from public.ep_internship_certificates where employee_id = p_emp returning storage_path into v_old;
  if v_old is null then
    raise exception 'There is no certificate to remove.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('old_path', v_old);
end $$;

revoke all on function public.ep_admin_set_certificate(uuid, text, text, bigint, text),
  public.ep_admin_remove_certificate(uuid) from public, anon;
grant execute on function public.ep_admin_set_certificate(uuid, text, text, bigint, text),
  public.ep_admin_remove_certificate(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================== 246_employee_auto_punch_out_8pm.sql =====================

-- 246: Employee Portal — automatic punch out at 8:00 PM (was 10:00 PM).
--
-- * ep_attendance_rules().auto_punch_out = '20:00' (India time). A session still open at 8:00 PM is
--   closed at 8:00 PM of its work day and tagged "auto punch out"; a session started after 8:00 PM
--   is closed at midnight (same rule as before, new time). Sessions closed earlier keep their times.
-- * pg_cron job 'ep-auto-punch-out' now runs at 20:00 and 00:00 IST (14:30 and 18:30 UTC).
-- * Punch-out reminder moved from 9:30 PM to 7:30 PM (only if the admin had not changed it), and its
--   text now takes the time from ep_attendance_rules().
-- Rollback: supabase/rollbacks/246_rollback_employee_auto_punch_out_8pm.sql


create or replace function public.ep_attendance_rules()
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'timezone',           'Asia/Kolkata',
    'office_start',       '09:30',
    'office_end',         '19:00',
    'late_after',         '09:40',
    'half_day_min_hours', 4,
    'auto_punch_out',     '20:00'
  );
$$;

comment on column public.ep_attendance.auto_punched_out is
  'true = closed automatically at the 8:00 PM cut-off (employee did not punch out).';

update public.ep_reminder_settings set send_at = '19:30', updated_at = now()
 where kind = 'punch_out' and send_at = '21:30';

create or replace function public.ep_send_reminders(p_kind text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_n     integer := 0;
  r       record;
begin
  if extract(isodow from v_today) = 7 or exists (select 1 from public.ep_holidays where holiday_date = v_today) then
    return 0;
  end if;
  for r in
    select e.id from public.ep_employees e
     where e.is_active
       and case p_kind
             when 'punch_in' then
               not public.ep_is_day_off(e.id, v_today)
               and not exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.work_date = v_today)
             when 'report' then
               exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.work_date = v_today)
               and exists (select 1 from public.ep_project_members m where m.employee_id = e.id)
               and not exists (select 1 from public.ep_work_reports w where w.employee_id = e.id and w.report_date = v_today
                                and w.status in ('submitted', 'reviewed'))
             when 'punch_out' then
               exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
             else false
           end
  loop
    perform public.ep_notify(r.id,
      case when p_kind = 'report' then 'report' else 'attendance' end,
      case p_kind
        when 'punch_in'  then 'You have not punched in today'
        when 'report'    then 'Submit your daily work report'
        else                  'You are still punched in'
      end,
      case p_kind
        when 'punch_in'  then 'Office starts at 9:30 AM. Punch in when you start work, or apply for leave if you are off.'
        when 'report'    then 'Your report for today is not submitted yet.'
        else                  'You will be punched out automatically at '
                              || ltrim(to_char((public.ep_attendance_rules() ->> 'auto_punch_out')::time, 'HH12:MI AM'), '0')
                              || '. Punch out now if you are done.'
      end,
      case p_kind when 'report' then '/employee/reports' when 'punch_in' then '/employee' else '/employee/attendance' end,
      'normal',
      p_kind || ':' || v_today);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_send_reminders(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'ep-auto-punch-out';
    perform cron.schedule('ep-auto-punch-out', '30 14,18 * * *', 'select public.ep_close_overdue_sessions()');
  end if;
end $$;

notify pgrst, 'reload schema';

-- ===================== 247_employee_admin_dashboard.sql =====================

-- 247: Employee Portal — admin dashboard (Admin -> Employee Portal).
--
-- ep_admin_portal_dashboard() — admins only, read-only. One call for the whole page (India time):
--   employees : active / interns / access off
--   today     : working day?, holiday name, each active employee's status today
--               (in now / checked out / on leave / not in yet / day off), first punch in, late flag
--   pending   : leave requests, attendance corrections, reports awaiting review,
--               reports not submitted yesterday, overdue tasks without a reason, overdue projects
--   upcoming  : task + project deadlines in the next 7 days, approved leave in the next 7 days,
--               next company holiday
-- Rollback: supabase/rollbacks/247_rollback_employee_admin_dashboard.sql


create or replace function public.ep_admin_portal_dashboard()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_holiday text;
  v_prev    date;
begin
  perform public.ep_require_admin();
  perform public.ep_close_overdue_sessions(null);
  select name into v_holiday from public.ep_holidays where holiday_date = v_today;
  -- Previous working day (skips Sundays and holidays), for "reports not submitted".
  select max(d)::date into v_prev
    from generate_series(v_today - 10, v_today - 1, interval '1 day') d
   where extract(isodow from d) <> 7 and not exists (select 1 from public.ep_holidays h where h.holiday_date = d::date);

  return jsonb_build_object(
    'today', v_today,
    'working_day', extract(isodow from v_today) <> 7 and v_holiday is null,
    'holiday', v_holiday,
    'previous_working_day', v_prev,
    'employees', (select jsonb_build_object(
                    'active', count(*) filter (where is_active),
                    'interns', count(*) filter (where is_active and employment_type = 'intern'),
                    'access_off', count(*) filter (where not is_active))
                  from public.ep_employees),
    'people', coalesce((
      select jsonb_agg(x.j order by x.ord, x.name)
      from (
        select e.full_name as name,
               case when a.open then 0 when a.first_in is not null then 1 when lv.id is not null then 2 else 3 end as ord,
               jsonb_build_object(
                 'id', e.id, 'full_name', e.full_name, 'designation', e.designation,
                 'status', case when a.open then 'in'
                                when a.first_in is not null then 'out'
                                when lv.id is not null then 'leave'
                                when extract(isodow from v_today) = 7 or v_holiday is not null then 'off'
                                else 'not_in' end,
                 'first_in', a.first_in,
                 'late', a.first_in is not null
                         and (a.first_in at time zone 'Asia/Kolkata')::time > (public.ep_attendance_rules() ->> 'late_after')::time,
                 'leave_type', lv.leave_type, 'half_day', lv.half_day) as j
        from public.ep_employees e
        left join lateral (
          select min(punch_in_at) as first_in, bool_or(punch_out_at is null) as open
          from public.ep_attendance where employee_id = e.id and work_date = v_today) a on true
        left join lateral (
          select r.id, r.leave_type, r.half_day from public.ep_leave_requests r
          where r.employee_id = e.id and r.status = 'approved' and v_today between r.start_date and r.end_date
          limit 1) lv on true
        where e.is_active) x), '[]'::jsonb),
    'pending', jsonb_build_object(
      'leave', (select count(*) from public.ep_leave_requests where status = 'pending'),
      'corrections', (select count(*) from public.ep_attendance_corrections where status = 'pending'),
      'reports_to_review', (select count(*) from public.ep_work_reports where status = 'submitted'),
      'reports_missing', (
        select count(*) from (select distinct employee_id from public.ep_attendance where work_date = v_prev) d
        where exists (select 1 from public.ep_project_members m where m.employee_id = d.employee_id)
          and not exists (select 1 from public.ep_work_reports w where w.employee_id = d.employee_id
                           and w.report_date = v_prev and w.status in ('submitted', 'reviewed'))),
      'tasks_overdue_no_reason', (
        select count(*) from public.ep_project_tasks t join public.pt_projects p on p.id = t.project_id
        where t.status <> 'done' and t.due_date < v_today and t.delay_reason is null
          and p.status not in ('completed', 'cancelled')),
      'projects_overdue', (
        select count(*) from public.pt_projects p
        where public.ep_project_is_running(p.status) and p.end_date < v_today
          and exists (select 1 from public.ep_project_members m where m.project_id = p.id))),
    'deadlines', coalesce((
      select jsonb_agg(d.j order by d.due, d.kind desc)
      from (
        select t.due_date as due, 'task' as kind, jsonb_build_object(
                 'kind', 'task', 'title', t.title, 'due_date', t.due_date, 'project_id', p.id, 'project_name', p.name,
                 'who', (select full_name from public.ep_employees where id = t.assignee_id)) as j
        from public.ep_project_tasks t join public.pt_projects p on p.id = t.project_id
        where t.status <> 'done' and t.due_date between v_today and v_today + 7
          and p.status not in ('completed', 'cancelled')
        union all
        select p.end_date, 'project', jsonb_build_object(
                 'kind', 'project', 'title', p.name, 'due_date', p.end_date, 'project_id', p.id, 'project_name', p.name,
                 'who', null)
        from public.pt_projects p
        where public.ep_project_is_running(p.status) and p.end_date between v_today and v_today + 7
        order by 1 limit 8) d), '[]'::jsonb),
    'leave_upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'full_name', e.full_name, 'leave_type', r.leave_type, 'start_date', r.start_date,
               'end_date', r.end_date, 'days', r.days, 'half_day', r.half_day) order by r.start_date)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where r.status = 'approved' and r.start_date between v_today + 1 and v_today + 7), '[]'::jsonb),
    'next_holiday', (
      select jsonb_build_object('date', holiday_date, 'name', name)
      from public.ep_holidays where holiday_date > v_today order by holiday_date limit 1)
  );
end $$;

revoke all on function public.ep_admin_portal_dashboard() from public, anon;
grant execute on function public.ep_admin_portal_dashboard() to authenticated;

notify pgrst, 'reload schema';

-- ===================== 248_employee_custom_reminders.sql =====================

-- 248: Employee Portal — custom scheduled reminders (admin).
--
-- Besides the 4 built-in reminders (punch in, report, punch out, deadlines; table ep_reminder_settings),
-- the admin can create their own reminders in Notifications Management:
--   title + message + normal/urgent, sent to: everyone | chosen departments | one project team | chosen people,
--   repeat: weekly on chosen days at a time (skipped on company holidays) | once on a date at a time.
-- ep_run_due_reminders() (pg_cron, every 5 minutes) now also sends custom reminders that are due:
-- at most once per day each, only within 2 hours after their time; a one-time reminder switches itself
-- off after it is sent. Each person gets it at most once per reminder per day (dedupe key).
-- Sent reminders appear in "Sent" for the admin who created them (same message_id per send).
--   ep_admin_custom_reminders() / ep_admin_save_custom_reminder(id|null, jsonb)
--   ep_admin_delete_custom_reminder(id) / ep_admin_send_custom_reminder_now(id)
-- Rollback: supabase/rollbacks/248_rollback_employee_custom_reminders.sql


create table if not exists public.ep_custom_reminders (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 150),
  body        text check (body is null or length(body) <= 2000),
  priority    text not null default 'normal' check (priority in ('normal', 'urgent')),
  audience    text not null check (audience in ('all', 'department', 'project', 'people')),
  departments text[],
  project_id  uuid references public.pt_projects (id) on delete cascade,
  people      uuid[],
  repeat      text not null check (repeat in ('weekly', 'once')),
  days        smallint[] check (days is null or (days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(days) between 1 and 7)),
  send_date   date,
  send_at     time not null check (send_at between time '06:00' and time '21:55'),
  enabled     boolean not null default true,
  last_run    date,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ep_custom_rem_schedule check (
    (repeat = 'weekly' and days is not null) or (repeat = 'once' and send_date is not null)),
  constraint ep_custom_rem_audience check (
    audience = 'all'
    or (audience = 'department' and coalesce(cardinality(departments), 0) > 0)
    or (audience = 'project' and project_id is not null)
    or (audience = 'people' and coalesce(cardinality(people), 0) > 0))
);
comment on table public.ep_custom_reminders is
  'Employee Portal: admin-made scheduled reminders. Sent by ep_run_due_reminders() via ep_send_custom_reminder().';
alter table public.ep_custom_reminders enable row level security;
revoke all on public.ep_custom_reminders from anon, authenticated;

-- Active employees a reminder goes to.
create or replace function public.ep_custom_reminder_targets(p_id uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select e.id
  from public.ep_custom_reminders r
  join public.ep_employees e on e.is_active
  where r.id = p_id
    and case r.audience
          when 'all' then true
          when 'department' then e.department = any (r.departments)
          when 'project' then exists (select 1 from public.ep_project_members m
                                       where m.project_id = r.project_id and m.employee_id = e.id)
          else e.id = any (r.people)
        end;
$$;
revoke all on function public.ep_custom_reminder_targets(uuid) from public, anon, authenticated;

-- Sends one custom reminder now (internal). Returns how many people got it (repeat sends on the
-- same day are skipped per person).
create or replace function public.ep_send_custom_reminder(p_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r     public.ep_custom_reminders;
  v_msg uuid := gen_random_uuid();
  v_n   integer;
begin
  select * into r from public.ep_custom_reminders where id = p_id;
  if r.id is null then
    return 0;
  end if;
  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_user_id, sender_label, message_id, dedupe_key)
  select t, 'message', r.priority, r.title, r.body, r.created_by, 'Admin', v_msg,
         'custom:' || r.id || ':' || (timezone('Asia/Kolkata', now()))::date
  from public.ep_custom_reminder_targets(r.id) t
  on conflict (employee_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.ep_send_custom_reminder(uuid) from public, anon, authenticated;

-- Scheduler: built-in reminders (as before) + custom reminders.
create or replace function public.ep_run_due_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_now     timestamp := timezone('Asia/Kolkata', now());
  v_today   date := v_now::date;
  v_holiday boolean := exists (select 1 from public.ep_holidays where holiday_date = v_today);
  v_n       integer := 0;
  s         public.ep_reminder_settings;
  c         public.ep_custom_reminders;
begin
  for s in select * from public.ep_reminder_settings
            where enabled and extract(isodow from v_today)::smallint = any (days)
              and v_now::time >= send_at and v_now::time < send_at + interval '2 hours'
              and (last_run is null or last_run < v_today)
            for update skip locked loop
    v_n := v_n + case when s.kind = 'deadlines' then public.ep_send_deadline_reminders()
                      else public.ep_send_reminders(s.kind) end;
    update public.ep_reminder_settings set last_run = v_today where kind = s.kind;
  end loop;

  for c in select * from public.ep_custom_reminders
            where enabled
              and v_now::time >= send_at and v_now::time < send_at + interval '2 hours'
              and (last_run is null or last_run < v_today)
              and ((repeat = 'weekly' and extract(isodow from v_today)::smallint = any (days) and not v_holiday)
                   or (repeat = 'once' and send_date = v_today))
            for update skip locked loop
    v_n := v_n + public.ep_send_custom_reminder(c.id);
    update public.ep_custom_reminders
       set last_run = v_today, enabled = case when repeat = 'once' then false else enabled end
     where id = c.id;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_run_due_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------- admin
create or replace function public.ep_admin_custom_reminders()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'title', r.title, 'body', r.body, 'priority', r.priority,
             'audience', r.audience, 'departments', to_jsonb(r.departments), 'project_id', r.project_id,
             'project_name', (select name from public.pt_projects where id = r.project_id),
             'people', to_jsonb(r.people),
             'people_names', (select jsonb_agg(full_name order by full_name) from public.ep_employees where id = any (r.people)),
             'repeat', r.repeat, 'days', to_jsonb(r.days), 'send_date', r.send_date,
             'send_at', to_char(r.send_at, 'HH24:MI'), 'enabled', r.enabled, 'last_run', r.last_run,
             'recipients', (select count(*) from public.ep_custom_reminder_targets(r.id)))
           order by r.enabled desc, r.send_at, r.created_at)
    from public.ep_custom_reminders r), '[]'::jsonb);
end $$;

-- p: { title, body, priority, audience, departments[], project_id, people[], repeat, days[], send_date, send_at, enabled }
create or replace function public.ep_admin_save_custom_reminder(p_id uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_title    text := btrim(coalesce(p ->> 'title', ''));
  v_body     text := nullif(btrim(coalesce(p ->> 'body', '')), '');
  v_aud      text := p ->> 'audience';
  v_repeat   text := p ->> 'repeat';
  v_at       time;
  v_date     date := nullif(p ->> 'send_date', '')::date;
  v_days     smallint[];
  v_deps     text[];
  v_people   uuid[];
  v_project  uuid := nullif(p ->> 'project_id', '')::uuid;
  v_today    date := (timezone('Asia/Kolkata', now()))::date;
  v_id       uuid;
begin
  perform public.ep_require_admin();
  if length(v_title) not between 1 and 150 then
    raise exception 'Title must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  begin
    v_at := (p ->> 'send_at')::time;
  exception when others then
    v_at := null;
  end;
  if v_at is null or v_at < time '06:00' or v_at > time '21:55' then
    raise exception 'Choose a time between 6:00 AM and 9:55 PM.' using errcode = '22023';
  end if;
  if v_aud not in ('all', 'department', 'project', 'people') then
    raise exception 'Choose who should get it.' using errcode = '22023';
  end if;
  select array_agg(distinct btrim(x)) into v_deps
    from jsonb_array_elements_text(coalesce(p -> 'departments', '[]'::jsonb)) x where btrim(x) <> '';
  select array_agg(distinct x::uuid) into v_people
    from jsonb_array_elements_text(coalesce(p -> 'people', '[]'::jsonb)) x;
  select array_agg(distinct x::smallint order by x::smallint) into v_days
    from jsonb_array_elements_text(coalesce(p -> 'days', '[]'::jsonb)) x;
  if v_aud = 'department' and v_deps is null then
    raise exception 'Choose at least one department.' using errcode = '22023';
  end if;
  if v_aud = 'project' and (v_project is null or not exists (select 1 from public.pt_projects where id = v_project)) then
    raise exception 'Choose a project team.' using errcode = '22023';
  end if;
  if v_aud = 'people' and v_people is null then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if v_repeat = 'weekly' then
    if v_days is null or not (v_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
      raise exception 'Choose at least one day.' using errcode = '22023';
    end if;
    v_date := null;
  elsif v_repeat = 'once' then
    if v_date is null or v_date < v_today then
      raise exception 'Choose today or a later date.' using errcode = '22023';
    end if;
    v_days := null;
  else
    raise exception 'Choose weekly or one time.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.ep_custom_reminders
      (title, body, priority, audience, departments, project_id, people, repeat, days, send_date, send_at, enabled, created_by)
    values (v_title, v_body, coalesce(nullif(p ->> 'priority', ''), 'normal'), v_aud,
            case when v_aud = 'department' then v_deps end, case when v_aud = 'project' then v_project end,
            case when v_aud = 'people' then v_people end, v_repeat, v_days, v_date, v_at,
            coalesce((p ->> 'enabled')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.ep_custom_reminders set
      title = v_title, body = v_body, priority = coalesce(nullif(p ->> 'priority', ''), 'normal'), audience = v_aud,
      departments = case when v_aud = 'department' then v_deps end,
      project_id  = case when v_aud = 'project' then v_project end,
      people      = case when v_aud = 'people' then v_people end,
      repeat = v_repeat, days = v_days, send_date = v_date, send_at = v_at,
      enabled = coalesce((p ->> 'enabled')::boolean, enabled),
      -- a changed one-time reminder may run again
      last_run = case when v_repeat = 'once' then null else last_run end,
      updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Reminder not found.' using errcode = 'P0002';
    end if;
  end if;
  return public.ep_admin_custom_reminders();
end $$;

create or replace function public.ep_admin_delete_custom_reminder(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  delete from public.ep_custom_reminders where id = p_id;
  if not found then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_custom_reminders();
end $$;

create or replace function public.ep_admin_send_custom_reminder_now(p_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if not exists (select 1 from public.ep_custom_reminders where id = p_id) then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_send_custom_reminder(p_id);
end $$;

revoke all on function public.ep_admin_custom_reminders(), public.ep_admin_save_custom_reminder(uuid, jsonb),
  public.ep_admin_delete_custom_reminder(uuid), public.ep_admin_send_custom_reminder_now(uuid) from public, anon;
grant execute on function public.ep_admin_custom_reminders(), public.ep_admin_save_custom_reminder(uuid, jsonb),
  public.ep_admin_delete_custom_reminder(uuid), public.ep_admin_send_custom_reminder_now(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================== 249_employee_change_password.sql =====================

-- 249: Employee Portal — change the temporary password at the first sign-in.
--
-- * ep_employees.must_change_password: true for a login the admin created with a temporary password
--   (ep_admin_create_employee); a linked existing account keeps its own password (false).
-- * ep_me() also returns must_change_password; the portal then shows only "Change your password".
-- * ep_change_my_password(new): the signed-in employee sets a new password (rules below, different
--   from the current one); clears the flag. The portal then signs out and goes to the login page.
-- * Password rules (ep_password_problem, also for the admin's temporary passwords):
--   at least 6 characters, 1 uppercase letter, 1 number, 1 special character (max 72).
-- Rollback: supabase/rollbacks/249_rollback_employee_change_password.sql


alter table public.ep_employees add column if not exists must_change_password boolean not null default false;

-- null = OK, else what is missing (shown to the user).
create or replace function public.ep_password_problem(p text)
returns text
language sql immutable set search_path = ''
as $$
  select case
           when p is null or length(p) < 6 then 'use at least 6 characters'
           when length(p) > 72 then 'use at most 72 characters'
           when p !~ '[A-Z]' then 'add at least 1 uppercase letter (A-Z)'
           when p !~ '[0-9]' then 'add at least 1 number (0-9)'
           when p !~ '[^A-Za-z0-9]' then 'add at least 1 special character (e.g. @ # $ % !)'
           when p ~ '[[:space:]]' then 'do not use spaces'
         end;
$$;
grant execute on function public.ep_password_problem(text) to authenticated;

create or replace function public.ep_me()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_emp uuid;
begin
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    return null;
  end if;
  perform public.ep_close_overdue_sessions(v_emp);
  return (
    select jsonb_build_object(
      'employee_id',   e.id,
      'employee_code', e.employee_code,
      'full_name',     e.full_name,
      'must_change_password', e.must_change_password,
      'open_session',  (
        select jsonb_build_object('id', a.id, 'punch_in_at', a.punch_in_at, 'work_date', a.work_date,
                                  'auto_punch_out_at', public.ep_auto_punch_out_at(a.work_date, a.punch_in_at))
        from public.ep_attendance a
        where a.employee_id = e.id and a.punch_out_at is null
      ),
      'last_session',  (
        select jsonb_build_object('id', a.id, 'punch_in_at', a.punch_in_at, 'punch_out_at', a.punch_out_at,
                                  'auto_punched_out', a.auto_punched_out)
        from public.ep_attendance a
        where a.employee_id = e.id and a.punch_out_at is not null
        order by a.punch_out_at desc limit 1
      )
    )
    from public.ep_employees e
    where e.id = v_emp
  );
end $$;

create or replace function public.ep_admin_create_employee(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if exists (select 1 from public.admin_users where user_id = v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if public.ep_password_problem(v_password) is not null then
      raise exception 'Temporary password: %', public.ep_password_problem(v_password) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  -- A new login with a temporary password must be changed at the first sign-in.
  insert into public.ep_employees (user_id, employee_code, full_name, must_change_password)
  values (v_user, v_code, v_name, not v_linked)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked);
end $$;

create or replace function public.ep_change_my_password(p_new text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_hash text;
  v_problem text := public.ep_password_problem(p_new);
begin
  if v_uid is null or not exists (select 1 from public.ep_employees where user_id = v_uid and is_active) then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if v_problem is not null then
    raise exception 'New password: %.', v_problem using errcode = '22023';
  end if;
  select encrypted_password into v_hash from auth.users where id = v_uid;
  if v_hash is not null and v_hash <> '' and extensions.crypt(p_new, v_hash) = v_hash then
    raise exception 'The new password must be different from the temporary password.' using errcode = '22023';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = now()
   where id = v_uid;
  update public.ep_employees set must_change_password = false, updated_at = now() where user_id = v_uid;
  return true;
end $$;

revoke all on function public.ep_change_my_password(text) from public, anon;
grant execute on function public.ep_change_my_password(text) to authenticated;

notify pgrst, 'reload schema';

-- ===================== 250_employee_external_manager.sql =====================

-- 250: Employee Portal — reporting manager who is NOT in the portal.
--
-- The admin can set an employee's reporting manager by picking an employee (as before) OR by typing
-- a name (ep_employees.reporting_manager_name) when the manager has no portal account. A picked
-- portal manager replaces a typed name.
-- * Admin: ep_admin_update_employee / ep_admin_create_employee accept 'reporting_manager_name';
--   ep_admin_employee_json returns manager_name.
-- * Employee: My Profile, the leave form (pre-filled) and the daily report show the typed name.
-- * Daily work report: submitting no longer needs a portal manager — without one the report goes to
--   the admin (Admin > Daily Work Reports), who reviews it as before.
-- Rollback: supabase/rollbacks/250_rollback_employee_external_manager.sql


alter table public.ep_employees
  add column if not exists reporting_manager_name text
    check (reporting_manager_name is null or length(btrim(reporting_manager_name)) between 1 and 120);
comment on column public.ep_employees.reporting_manager_name is
  'Reporting manager typed by the admin when that person has no portal account (null when reporting_manager_id is set).';

create or replace function public.ep_admin_employee_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id',              e.id,
    'employee_code',   e.employee_code,
    'full_name',       e.full_name,
    'work_email',      u.email,
    'department',      e.department,
    'designation',     e.designation,
    'date_of_joining', e.date_of_joining,
    'employment_type', e.employment_type,
    'work_location',   e.work_location,
    'is_active',       e.is_active,
    'created_at',      e.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'manager', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'full_name', m.full_name, 'employee_code', m.employee_code,
      'designation', m.designation, 'is_active', m.is_active) end,
    'manager_name', case when m.id is null then e.reporting_manager_name end,
    'reports_count', (select count(*) from public.ep_employees r where r.reporting_manager_id = e.id),
    'punched_in', exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
  )
  from public.ep_employees e
  left join auth.users u on u.id = e.user_id
  left join public.ep_employees m on m.id = e.reporting_manager_id
  where e.id = p_id;
$$;

create or replace function public.ep_admin_update_employee(p_id uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f text;
  v_old public.ep_employees;
  v_new public.ep_employees;
  v_mgr uuid;
  v_walk uuid;
  v_depth int := 0;
  v_mgr_name text;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('full_name', 'department', 'designation', 'reporting_manager_id', 'reporting_manager_name',
                 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be changed here.', f using errcode = '42501';
    end if;
  end loop;

  select * into v_old from public.ep_employees where id = p_id for update;
  if v_old.id is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;

  if p ? 'full_name' and nullif(btrim(p ->> 'full_name'), '') is null then
    raise exception 'Name cannot be empty.' using errcode = '22023';
  end if;

  -- Reporting manager: must exist, be active, not the employee, and not create a loop.
  v_mgr := case when p ? 'reporting_manager_id'
                then nullif(btrim(p ->> 'reporting_manager_id'), '')::uuid
                else v_old.reporting_manager_id end;
  if p ? 'reporting_manager_id' and v_mgr is not null
     and v_mgr is distinct from v_old.reporting_manager_id then
    if v_mgr = p_id then
      raise exception 'An employee cannot report to themselves.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ep_employees where id = v_mgr and is_active) then
      raise exception 'Choose an active employee as reporting manager.' using errcode = '22023';
    end if;
    v_walk := v_mgr;
    while v_walk is not null and v_depth < 100 loop
      if v_walk = p_id then
        raise exception 'That would make a loop: this employee is above the chosen manager.' using errcode = '22023';
      end if;
      select reporting_manager_id into v_walk from public.ep_employees where id = v_walk;
      v_depth := v_depth + 1;
    end loop;
  end if;

  -- Typed manager name (someone who is not in the portal). A portal manager replaces it.
  v_mgr_name := case when p ? 'reporting_manager_name' then nullif(btrim(coalesce(p ->> 'reporting_manager_name', '')), '')
                     else v_old.reporting_manager_name end;
  if v_mgr is not null then
    v_mgr_name := null;
  end if;
  if length(v_mgr_name) > 120 then
    raise exception 'Manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  update public.ep_employees set
    full_name            = case when p ? 'full_name' then btrim(p ->> 'full_name') else full_name end,
    department           = case when p ? 'department' then nullif(btrim(p ->> 'department'), '') else department end,
    designation          = case when p ? 'designation' then nullif(btrim(p ->> 'designation'), '') else designation end,
    reporting_manager_id = v_mgr,
    reporting_manager_name = v_mgr_name,
    date_of_joining      = case when p ? 'date_of_joining' then nullif(btrim(p ->> 'date_of_joining'), '')::date else date_of_joining end,
    employment_type      = case when p ? 'employment_type' then nullif(btrim(p ->> 'employment_type'), '') else employment_type end,
    work_location        = case when p ? 'work_location' then nullif(btrim(p ->> 'work_location'), '') else work_location end,
    updated_at           = now()
  where id = p_id
  returning * into v_new;

  -- Tell the people concerned when the reporting line changes.
  if v_new.reporting_manager_id is distinct from v_old.reporting_manager_id then
    if v_new.reporting_manager_id is not null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was updated',
        'You now report to ' || (select full_name from public.ep_employees where id = v_new.reporting_manager_id) || '.',
        '/employee/profile');
      perform public.ep_notify(
        v_new.reporting_manager_id, 'message', v_new.full_name || ' now reports to you',
        v_new.full_name || ' (' || v_new.employee_code || ') was added to your team by the admin.',
        null);
    elsif v_new.reporting_manager_name is null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was removed',
        'No reporting manager is set for you right now.', '/employee/profile');
    end if;
  end if;

  -- A typed (non-portal) manager set or changed: tell the employee.
  if v_new.reporting_manager_id is null and v_new.reporting_manager_name is not null
     and v_new.reporting_manager_name is distinct from v_old.reporting_manager_name then
    perform public.ep_notify(
      p_id, 'message', 'Your reporting manager was updated',
      'You now report to ' || v_new.reporting_manager_name || '.', '/employee/profile');
  end if;

  return public.ep_admin_employee(p_id);
end $$;

create or replace function public.ep_admin_create_employee(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'reporting_manager_name', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if exists (select 1 from public.admin_users where user_id = v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if public.ep_password_problem(v_password) is not null then
      raise exception 'Temporary password: %', public.ep_password_problem(v_password) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  -- A new login with a temporary password must be changed at the first sign-in.
  insert into public.ep_employees (user_id, employee_code, full_name, must_change_password)
  values (v_user, v_code, v_name, not v_linked)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked);
end $$;

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
        'manager', case when m.id is not null then jsonb_build_object(
          'full_name', m.full_name, 'employee_code', m.employee_code, 'designation', m.designation)
          when e.reporting_manager_name is not null then jsonb_build_object(
          'full_name', e.reporting_manager_name, 'employee_code', null, 'designation', null, 'external', true) end
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

create or replace function public.ep_my_report(p_date date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr   public.ep_employees;
  v_rep   uuid;
  v_name  text;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select m.* into v_mgr from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
   where e.id = v_emp;
  select reporting_manager_name into v_name from public.ep_employees where id = v_emp;
  select id into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  return jsonb_build_object(
    'date', p_date,
    'date_allowed', p_date between v_today - 7 and v_today,
    'manager', case when v_mgr.id is not null
                    then jsonb_build_object('id', v_mgr.id, 'full_name', v_mgr.full_name, 'employee_code', v_mgr.employee_code,
                                            'designation', v_mgr.designation)
                    when v_name is not null then jsonb_build_object('id', null, 'full_name', v_name, 'external', true)
                    end,
    -- Without a manager in the portal the report goes to the admin for review.
    'reviewer', case when v_mgr.id is not null then 'manager' else 'admin' end,
    'worked_minutes', (
      select floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int
      from public.ep_attendance a where a.employee_id = v_emp and a.work_date = p_date),
    'report', case when v_rep is null then null else public.ep_report_json(v_rep) end
  );
end $$;

create or replace function public.ep_save_my_report(p_date date, p_notes text, p_items jsonb, p_submit boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr    uuid;
  v_rep    public.ep_work_reports;
  v_item   jsonb;
  v_pid    uuid;
  v_hours  numeric;
  v_total  numeric := 0;
  v_seen   uuid[] := '{}';
  v_pos    int := 0;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'You cannot write a report for a future date.' using errcode = '22023';
  end if;
  if p_date < v_today - 7 then
    raise exception 'Reports can only be written for today and the last 7 days.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid report entries.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'A report can have at most 20 project entries.' using errcode = '22023';
  end if;
  if coalesce(length(v_notes), 0) > 2000 then
    raise exception 'Notes must be at most 2000 characters.' using errcode = '22023';
  end if;
  if p_submit and jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one project entry before submitting.' using errcode = '22023';
  end if;

  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  -- No reporting manager in the portal: the report is submitted to the admin (submitted_to stays null).

  -- Serialise saves of the same report.
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text || p_date::text, 0));
  select * into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  if v_rep.id is not null and v_rep.status in ('submitted', 'reviewed') then
    raise exception 'This report is already submitted and cannot be changed.' using errcode = 'P0001';
  end if;

  -- Validate every entry before writing anything.
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid   := (v_item ->> 'project_id')::uuid;
      v_hours := (v_item ->> 'hours')::numeric;
    exception when others then
      raise exception 'Invalid report entries.' using errcode = '22023';
    end;
    if v_pid is null or not exists (select 1 from public.ep_project_members where project_id = v_pid and employee_id = v_emp) then
      raise exception 'You can only report on projects you are assigned to.' using errcode = '42501';
    end if;
    if v_pid = any (v_seen) then
      raise exception 'Each project can be added only once per report.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_pid;
    if v_hours is null or v_hours <= 0 or v_hours > 24 or v_hours <> round(v_hours, 2) then
      raise exception 'Hours spent must be more than 0 and at most 24 for each project.' using errcode = '22023';
    end if;
    v_total := v_total + v_hours;
    if coalesce(btrim(v_item ->> 'task_updates'), '') = '' and coalesce(btrim(v_item ->> 'completed_work'), '') = ''
       and coalesce(btrim(v_item ->> 'pending_work'), '') = '' then
      raise exception 'Write what you worked on for every project you added.' using errcode = '22023';
    end if;
    if greatest(length(v_item ->> 'task_updates'), length(v_item ->> 'completed_work'), length(v_item ->> 'pending_work')) > 2000 then
      raise exception 'Each text box can have at most 2000 characters.' using errcode = '22023';
    end if;
  end loop;
  if v_total > 24 then
    raise exception 'Total hours for the day cannot be more than 24.' using errcode = '22023';
  end if;

  if v_rep.id is null then
    insert into public.ep_work_reports (employee_id, report_date, notes)
    values (v_emp, p_date, v_notes) returning * into v_rep;
  else
    update public.ep_work_reports set notes = v_notes, updated_at = now() where id = v_rep.id;
  end if;

  delete from public.ep_work_report_items where report_id = v_rep.id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.ep_work_report_items (report_id, project_id, task_updates, completed_work, pending_work, hours, position)
    values (v_rep.id, (v_item ->> 'project_id')::uuid,
            nullif(btrim(coalesce(v_item ->> 'task_updates', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'completed_work', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'pending_work', '')), ''),
            (v_item ->> 'hours')::numeric, v_pos);
    v_pos := v_pos + 1;
  end loop;

  if p_submit then
    update public.ep_work_reports
       set status = 'submitted', submitted_to = v_mgr, submitted_at = now(), updated_at = now(),
           reviewed_by = null, reviewed_at = null, review_comment = null
     where id = v_rep.id;
  end if;

  return public.ep_my_report(p_date);
end $$;

create or replace function public.ep_leave_overview(p_year int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_mgr uuid;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  return jsonb_build_object(
    'year', p_year,
    'manager', coalesce(
      (select jsonb_build_object('id', m.id, 'full_name', m.full_name) from public.ep_employees m where m.id = v_mgr),
      (select jsonb_build_object('id', null, 'full_name', reporting_manager_name)
         from public.ep_employees where id = v_emp and reporting_manager_name is not null)),
    'balances', (
      select jsonb_agg(jsonb_build_object(
               'code', t.code, 'name', t.name, 'is_paid', t.is_paid,
               'allowed', public.ep_leave_allowance(v_emp, p_year, t.code),
               'approved', (select coalesce(sum(days), 0) from public.ep_leave_requests
                             where employee_id = v_emp and leave_type = t.code and status = 'approved'
                               and extract(year from start_date) = p_year),
               'pending', (select coalesce(sum(days), 0) from public.ep_leave_requests
                            where employee_id = v_emp and leave_type = t.code and status = 'pending'
                              and extract(year from start_date) = p_year))
             order by t.sort_order)
      from public.ep_leave_types t where t.is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r) order by r.start_date desc, r.created_at desc)
      from public.ep_leave_requests r
      where r.employee_id = v_emp and extract(year from r.start_date) = p_year), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.holiday_date, 'name', h.name) order by h.holiday_date)
      from public.ep_holidays h where extract(year from h.holiday_date) = p_year), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';

-- ===================== 251_employee_documents.sql =====================

-- 251: Employee Portal — employee documents (My Profile -> My documents).
--
-- The employee uploads their own documents (offer letter, certificates, ID proofs, …) in My Profile;
-- the admin sees them on the employee's page (Admin -> Employee Management), read-only.
--   storage bucket "ep-documents" (private, 10 MB, PDF / PNG / JPG / WEBP), path "<employee_id>/<uuid>-<file name>"
--     employee (active): upload / read / delete files in their OWN folder only;  admin: read
--   ep_employee_documents: one row per uploaded document
--     read: admin, and the employee themself (RLS); written only through the RPCs below
--   ep_add_my_document(category, title, path, name, size, mime) -> the file must already be uploaded in
--     the caller's own folder; max 50 documents per employee
--   ep_delete_my_document(id) -> deletes the row, returns the path so the page can delete the file
-- Rollback: supabase/rollbacks/251_rollback_employee_documents.sql


insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('ep-documents', 'ep-documents', false, 10485760,
   array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ep-documents: admin read" on storage.objects;
create policy "ep-documents: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'ep-documents' and public.is_admin());

drop policy if exists "ep-documents: employee read own" on storage.objects;
create policy "ep-documents: employee read own" on storage.objects for select to authenticated
  using (bucket_id = 'ep-documents'
         and (storage.foldername(name))[1] in (
           select e.id::text from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

drop policy if exists "ep-documents: employee upload own" on storage.objects;
create policy "ep-documents: employee upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'ep-documents'
              and (storage.foldername(name))[1] in (
                select e.id::text from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

drop policy if exists "ep-documents: employee delete own" on storage.objects;
create policy "ep-documents: employee delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'ep-documents'
         and (storage.foldername(name))[1] in (
           select e.id::text from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

create table if not exists public.ep_employee_documents (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.ep_employees (id) on delete cascade,
  category     text not null check (category in
                 ('offer_letter', 'appointment_letter', 'education', 'experience', 'id_proof',
                  'address_proof', 'photo', 'other')),
  title        text not null check (length(btrim(title)) between 1 and 120),
  storage_path text not null unique,
  file_name    text not null check (length(btrim(file_name)) between 1 and 255),
  file_size    bigint not null check (file_size > 0 and file_size <= 10485760),
  mime_type    text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  uploaded_at  timestamptz not null default now(),
  constraint ep_doc_path_in_folder check (storage_path like employee_id::text || '/%')
);
create index if not exists ep_employee_documents_emp_idx on public.ep_employee_documents (employee_id, uploaded_at desc);
comment on table public.ep_employee_documents is
  'Employee Portal: documents the employee uploaded (bucket ep-documents). Written via ep_add_my_document / ep_delete_my_document.';

alter table public.ep_employee_documents enable row level security;
revoke all on public.ep_employee_documents from anon, authenticated;
grant select on public.ep_employee_documents to authenticated;
drop policy if exists ep_doc_read on public.ep_employee_documents;
create policy ep_doc_read on public.ep_employee_documents for select to authenticated
  using ((select public.is_admin())
         or employee_id in (select e.id from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));

create or replace function public.ep_add_my_document(
  p_category text, p_title text, p_path text, p_name text, p_size bigint, p_mime text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_path is null or p_path not like v_emp::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ep-documents' and name = p_path) then
    raise exception 'The file was not uploaded.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.ep_employee_documents where employee_id = v_emp) >= 50 then
    raise exception 'You can keep up to 50 documents. Delete one first.' using errcode = '22023';
  end if;
  insert into public.ep_employee_documents (employee_id, category, title, storage_path, file_name, file_size, mime_type)
  values (v_emp, p_category, left(btrim(coalesce(nullif(btrim(p_title), ''), p_name)), 120),
          p_path, left(btrim(p_name), 255), p_size, p_mime)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ep_delete_my_document(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp  uuid := public.ep_current_employee_id();
  v_path text;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  delete from public.ep_employee_documents where id = p_id and employee_id = v_emp returning storage_path into v_path;
  if v_path is null then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('old_path', v_path);
end $$;

revoke all on function public.ep_add_my_document(text, text, text, text, bigint, text),
  public.ep_delete_my_document(uuid) from public, anon;
grant execute on function public.ep_add_my_document(text, text, text, text, bigint, text),
  public.ep_delete_my_document(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================== 252_employee_admin_check.sql =====================

-- 252: Employee Portal — "is this account an admin?" works with either admin model.
--
-- The dev database keeps admins in public.admin_users; the live (Lovable) website database may use
-- public.user_roles (role 'admin') instead. ep_admin_create_employee refused to link an admin account
-- by reading admin_users directly, which fails where that table does not exist.
--   ep_user_is_admin(user) -> true when the user is in admin_users (if that table exists) or has the
--     'admin' role in user_roles (if that table exists). Internal: not callable by app users.
--   ep_admin_create_employee: same as migration 250, only that check now uses ep_user_is_admin.
-- Rollback: supabase/rollbacks/252_rollback_employee_admin_check.sql


create or replace function public.ep_user_is_admin(p_user uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_found boolean := false;
begin
  if p_user is null then
    return false;
  end if;
  if to_regclass('public.admin_users') is not null then
    execute 'select exists (select 1 from public.admin_users where user_id = $1)' into v_found using p_user;
    if v_found then
      return true;
    end if;
  end if;
  if to_regclass('public.user_roles') is not null then
    execute 'select exists (select 1 from public.user_roles where user_id = $1 and role::text = ''admin'')' into v_found using p_user;
  end if;
  return coalesce(v_found, false);
end $$;
revoke all on function public.ep_user_is_admin(uuid) from public, anon, authenticated;

create or replace function public.ep_admin_create_employee(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'reporting_manager_name', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if public.ep_user_is_admin(v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if public.ep_password_problem(v_password) is not null then
      raise exception 'Temporary password: %', public.ep_password_problem(v_password) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  -- A new login with a temporary password must be changed at the first sign-in.
  insert into public.ep_employees (user_id, employee_code, full_name, must_change_password)
  values (v_user, v_code, v_name, not v_linked)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked);
end $$;

notify pgrst, 'reload schema';

-- ===================== summary =====================
select 'ep tables' as item, count(*)::text as value from pg_tables where schemaname = 'public' and tablename like 'ep_%'
union all select 'ep functions', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ep_%'
union all select 'private buckets', string_agg(id, ', ' order by id) from storage.buckets where id in ('ep-certificates', 'ep-documents') and not public
union all select 'leave types', count(*)::text from public.ep_leave_types
union all select 'employees (must be 0)', count(*)::text from public.ep_employees
union all select 'pg_cron', case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'enabled' else 'NOT enabled: scheduled jobs skipped' end;

commit;

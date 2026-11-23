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

begin;

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

commit;

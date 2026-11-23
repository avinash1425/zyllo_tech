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

begin;

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
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise warning 'ep auto punch out: pg_cron not available (%). Sessions are still closed when the portal is used.', sqlerrm;
    return;
  end;
  perform cron.schedule('ep-auto-punch-out', '30 16,18 * * *', 'select public.ep_close_overdue_sessions()');
end $$;

notify pgrst, 'reload schema';

commit;

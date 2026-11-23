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

begin;

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

commit;

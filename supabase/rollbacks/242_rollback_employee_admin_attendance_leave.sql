-- Rollback of 242_employee_admin_attendance_leave.sql.
-- Drops the admin / correction functions, the corrections table and the two new columns,
-- and restores ep_my_attendance (233 version) and ep_leave_json (237 version).
-- Sessions already changed by approved corrections keep their corrected times.
begin;

drop function if exists public.ep_admin_delete_holiday(uuid);
drop function if exists public.ep_admin_save_holiday(uuid, date, text);
drop function if exists public.ep_admin_holidays(int);
drop function if exists public.ep_recount_leave_on(date);
drop function if exists public.ep_admin_set_leave_allowance(uuid, int, text, numeric);
drop function if exists public.ep_admin_leave_balances(int);
drop function if exists public.ep_admin_decide_leave(uuid, text, text);
drop function if exists public.ep_admin_leave_requests(text, int);
drop function if exists public.ep_leave_balance_json(uuid, int, text);
drop function if exists public.ep_admin_decide_correction(uuid, text, text);
drop function if exists public.ep_admin_corrections(text);
drop function if exists public.ep_admin_attendance(date, date, uuid);
drop function if exists public.ep_cancel_correction(uuid);
drop function if exists public.ep_my_corrections();
drop function if exists public.ep_request_correction(date, uuid, timestamptz, timestamptz, text);
drop function if exists public.ep_correction_json(public.ep_attendance_corrections);
drop function if exists public.ep_correction_check(uuid, date, uuid, timestamptz, timestamptz);
drop table if exists public.ep_attendance_corrections;

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
alter table public.ep_leave_requests drop column if exists decided_by_admin;

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
revoke all on function public.ep_my_attendance(date, date) from public, anon;
grant execute on function public.ep_my_attendance(date, date) to authenticated;
drop function if exists public.ep_attendance_rows(date, date, uuid);
alter table public.ep_attendance drop column if exists corrected_at;

notify pgrst, 'reload schema';
commit;

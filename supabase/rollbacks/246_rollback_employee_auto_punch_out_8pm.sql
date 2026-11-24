-- Rollback of 246_employee_auto_punch_out_8pm.sql: back to 10:00 PM.
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
    'half_day_min_hours', 4,
    'auto_punch_out',     '22:00'
  );
$$;
comment on column public.ep_attendance.auto_punched_out is
  'true = closed automatically at the 10:00 PM cut-off (employee did not punch out).';
update public.ep_reminder_settings set send_at = '21:30', updated_at = now()
 where kind = 'punch_out' and send_at = '19:30';
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
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'ep-auto-punch-out';
    perform cron.schedule('ep-auto-punch-out', '30 16,18 * * *', 'select public.ep_close_overdue_sessions()');
  end if;
end $$;
notify pgrst, 'reload schema';
commit;

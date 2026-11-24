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

begin;

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

commit;

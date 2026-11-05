-- =====================================================================
-- 117_hr_dashboard_essentials.sql — sections for the simplified HR
-- Dashboard (employee count, attendance, leave, payroll, approvals
-- assigned to the caller, prioritised alerts).
-- =====================================================================
-- Depends on 100–116. Same pattern as 116: the tested hr_dashboard() from
-- 116 moves to hr_private (renamed hr_dashboard_v116) unchanged and the
-- public function — same signature, same arguments — becomes a thin
-- wrapper that adds keys. Nothing existing is removed or recomputed
-- differently, so HR Reports and earlier tests are unaffected.
--
-- Every count is read under the caller's RLS (SECURITY INVOKER) from the
-- same employee scope as the rest of the dashboard (pg_temp.x_emp, built by
-- hr_private.load_x_emp with the company / department / manager / type
-- filters). Sections the caller has no permission for are null, never 0.
-- "Assigned to me" counts reuse the decision rules of the RPCs that act on
-- the records (hr_private.leave_can_act, hr_private.can_act_on_employee,
-- payroll separation of duties) so a count never includes an item the
-- caller would be refused on.
-- Payroll figures require payroll.view (HR Admin does not hold it).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

alter function public.hr_dashboard(date, date, uuid, text, uuid, text, uuid) set schema hr_private;
alter function hr_private.hr_dashboard(date, date, uuid, text, uuid, text, uuid) rename to hr_dashboard_v116;

create or replace function public.hr_dashboard(
  p_from date default null, p_to date default null, p_department uuid default null,
  p_employment_type text default null, p_manager uuid default null, p_status text default null,
  p_legal_entity uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  r jsonb; k jsonb; x jsonb := '{}'::jsonb;
  v_from date; v_to date; v_today date;
  v_me uuid := hr_private.current_employee_id();
  v_att boolean := hr_private.any_permission(array['attendance.view','attendance.view_team']);
  v_leave boolean := hr_private.any_permission(array['leave.view','leave.view_team','leave.approve','leave.approve_team']);
  v_docs boolean := hr_private.any_permission(array['documents.view','documents.view_team','documents.manage']);
  v_pv boolean := hr_private.has_permission('payroll.view');
  v_pm boolean := hr_private.has_permission('payroll.manage');
  v_pa boolean := hr_private.has_permission('payroll.approve');
  v_sep boolean := coalesce((hr_private.setting('payroll') ->> 'require_separate_approver')::boolean, true);
  v_run public.hr_payroll_runs;
  v_appr jsonb := '[]'::jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_n bigint;
begin
  -- Existing dashboard (permission check, range validation, every KPI).
  r := hr_private.hr_dashboard_v116(p_from, p_to, p_department, p_employment_type, p_manager, p_status, p_legal_entity);
  v_from := (r ->> 'from')::date; v_to := (r ->> 'to')::date; v_today := (r ->> 'today')::date;
  k := r -> 'kpis';

  -- Same employee scope and company filter as the wrapped dashboard.
  perform set_config('hr.filter_legal_entity', coalesce(p_legal_entity::text, ''), true);
  perform hr_private.load_x_emp('dashboard.view', p_department, p_manager, p_employment_type, p_status, false);
  perform set_config('hr.filter_legal_entity', '', true);

  -- ---- 1. Employee count: "inactive" = current records that are not active
  -- (onboarding / suspended), so total = active + inactive.
  k := k || jsonb_build_object('inactive_employees',
    (select count(*) from pg_temp.x_emp where status not in ('active','probation','notice_period')));

  -- ---- 2. Attendance
  if v_att then
    -- Same predicate as the hr_attendance_missing_punches view / Exceptions tab.
    k := k || jsonb_build_object('missing_punch_outs', (
      select count(*) from public.hr_attendance a join pg_temp.x_emp e on e.id = a.employee_id
      where a.check_in_at is not null and a.check_out_at is null and a.work_date < v_today));
    -- Names behind the existing absent_today KPI (same predicate as 112).
    x := x || jsonb_build_object('absent_today_list', (
      select coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id, 'employee', e.name, 'employee_code', e.employee_code,
                                                   'department', d.name) order by e.name), '[]'::jsonb)
      from pg_temp.x_emp e left join public.hr_departments d on d.id = e.department_id
      where e.status in ('active','probation','notice_period') and (e.joining_date is null or e.joining_date <= v_today)
        and hr_private.is_working_day_for(e.id, v_today) and not hr_private.is_on_approved_leave(e.id, v_today)
        and not exists (select 1 from public.hr_attendance a where a.employee_id = e.id and a.work_date = v_today and a.check_in_at is not null)));
  else
    k := k || jsonb_build_object('missing_punch_outs', null);
    x := x || jsonb_build_object('absent_today_list', null);
  end if;

  -- ---- 3. Leave: approved requests overlapping the period (same overlap rule
  -- as leave_overview and the Leave Management request list).
  if v_leave then
    k := k || jsonb_build_object('approved_leave_requests', (
      select count(*) from public.hr_leave_requests l join pg_temp.x_emp e on e.id = l.employee_id
      where l.status = 'approved' and l.start_date <= v_to and l.end_date >= v_from));
  else
    k := k || jsonb_build_object('approved_leave_requests', null);
  end if;

  -- ---- 4. Payroll (payroll.view only; RLS on payroll tables enforces the same)
  if v_pv then
    select * into v_run from public.hr_payroll_runs where v_today between period_start and period_end limit 1;
    if v_run.id is null then
      select * into v_run from public.hr_payroll_runs order by period_start desc limit 1;
    end if;
    x := x || jsonb_build_object('payroll', jsonb_build_object(
      'current_run', case when v_run.id is null then null else (
        select jsonb_build_object('id', v_run.id, 'period_start', v_run.period_start, 'period_end', v_run.period_end, 'status', v_run.status,
                                  'is_current_period', v_today between v_run.period_start and v_run.period_end,
                                  'employees', count(i.*), 'gross', coalesce(sum(i.gross), 0), 'net', coalesce(sum(i.net), 0),
                                  'paid_at', v_run.paid_at)
        from public.hr_payroll_items i where i.run_id = v_run.id and i.employee_id in (select id from pg_temp.x_emp)) end,
      'today', v_today,
      'status_counts', (select jsonb_build_object(
          'draft', count(*) filter (where status in ('draft','calculated')),
          'reviewed', count(*) filter (where status = 'reviewed'),
          'approved', count(*) filter (where status in ('approved','finalized')),
          'paid', count(*) filter (where status = 'paid'))
        from public.hr_payroll_runs),
      -- Runs waiting for a step the caller is allowed to take (rules of 105).
      'pending_actions', (select jsonb_build_object(
          'review', count(*) filter (where status = 'calculated' and (v_pm or v_pa)),
          'approve', count(*) filter (where status = 'reviewed' and v_pa
                                       and not (v_sep and (coalesce(auth.uid() = created_by, false) or coalesce(auth.uid() = calculated_by, false)))),
          'finalize', count(*) filter (where status = 'approved' and v_pa),
          'mark_paid', count(*) filter (where status = 'finalized' and v_pa))
        from public.hr_payroll_runs),
      'pending_reimbursements', case when v_pm then (
          select count(*) from public.hr_reimbursements c where c.status = 'submitted' and c.employee_id is distinct from v_me) end));
  else
    x := x || jsonb_build_object('payroll', null);
  end if;

  -- ---- 5. Approvals assigned to the caller (only modules the caller can act in)
  if hr_private.any_permission(array['leave.approve','leave.approve_team']) then
    v_appr := v_appr || jsonb_build_object('key', 'leave', 'label', 'Leave approvals', 'path', '/hr/leave?tab=approvals', 'count', (
      select count(*) from public.hr_leave_requests l join pg_temp.x_emp e on e.id = l.employee_id
      where l.status = 'pending_approval' and hr_private.leave_can_act(l)));
  end if;
  if hr_private.any_permission(array['attendance.approve','attendance.approve_team']) then
    v_appr := v_appr || jsonb_build_object('key', 'attendance_corrections', 'label', 'Attendance corrections', 'path', '/hr/attendance?tab=corrections', 'count', (
      select count(*) from public.hr_attendance_corrections c join pg_temp.x_emp e on e.id = c.employee_id
      where c.status = 'pending' and hr_private.can_act_on_employee(c.employee_id, 'attendance.approve', 'attendance.approve_team')));
  end if;
  if hr_private.has_permission('hr_requests.manage') then
    v_appr := v_appr || jsonb_build_object('key', 'hr_requests', 'label', 'HR requests (assigned to you or unassigned)', 'path', '/hr/requests', 'count', (
      select count(*) from public.hr_requests q
      where q.status in ('open','in_progress') and (q.assigned_to = v_me or q.assigned_to is null) and q.employee_id is distinct from v_me));
  end if;
  if hr_private.any_permission(array['daily_reports.review','daily_reports.review_team']) then
    v_appr := v_appr || jsonb_build_object('key', 'daily_reports', 'label', 'Daily reports to review', 'path', '/hr/daily-reports', 'count', (
      select count(*) from public.hr_daily_reports d join pg_temp.x_emp e on e.id = d.employee_id
      where d.status in ('submitted','under_review') and hr_private.can_act_on_employee(d.employee_id, 'daily_reports.review', 'daily_reports.review_team')));
  end if;
  if hr_private.any_permission(array['exit.manage','exit.approve_team']) then
    v_appr := v_appr || jsonb_build_object('key', 'exits', 'label', 'Resignations to review', 'path', '/hr/exits', 'count', (
      select count(*) from public.hr_exits q join pg_temp.x_emp e on e.id = q.employee_id
      where q.employee_id is distinct from v_me
        and ((q.status = 'hr_review' and hr_private.has_permission('exit.manage'))
          or (q.status = 'manager_review' and hr_private.has_permission('exit.approve_team') and hr_private.is_manager_of(q.employee_id)))));
  end if;
  if hr_private.has_permission('assets.manage') then
    v_appr := v_appr || jsonb_build_object('key', 'asset_requests', 'label', 'Asset requests', 'path', '/hr/assets?tab=requests', 'count', (
      select count(*) from public.hr_asset_requests q where q.status = 'pending' and q.employee_id is distinct from v_me));
  end if;
  if v_pm then
    v_appr := v_appr || jsonb_build_object('key', 'reimbursements', 'label', 'Reimbursement claims', 'path', '/hr/payroll?tab=reimbursements',
      'count', (x -> 'payroll' ->> 'pending_reimbursements')::int);
  end if;
  if v_pv and (v_pm or v_pa) then
    v_appr := v_appr || jsonb_build_object('key', 'payroll_runs', 'label', 'Payroll runs awaiting your step', 'path', '/hr/payroll?tab=runs',
      'count', (select sum(value::int) from jsonb_each_text(x -> 'payroll' -> 'pending_actions')));
  end if;
  if v_me is not null then
    -- Interviews already held where the caller sits on the panel and has not submitted feedback.
    -- A saved draft evaluation (status column added by 120) is not a submission; before 120
    -- every feedback row is a submission, hence the to_jsonb read with a 'submitted' default.
    select count(*) into v_n from public.hr_interview_panel p join public.hr_interviews i on i.id = p.interview_id
      where p.employee_id = v_me and i.status in ('scheduled','completed') and i.scheduled_at < now()
        and not exists (select 1 from public.hr_interview_feedback f where f.interview_id = i.id and f.interviewer_id = v_me
                          and coalesce(to_jsonb(f) ->> 'status', 'submitted') = 'submitted');
    if v_n > 0 or hr_private.any_permission(array['recruitment.view','recruitment.manage']) then
      v_appr := v_appr || jsonb_build_object('key', 'interview_feedback', 'label', 'Interview feedback due', 'path', '/hr/recruitment/interviews', 'count', v_n);
    end if;
  end if;
  x := x || jsonb_build_object('my_approvals', v_appr);

  -- ---- 6. Alerts (priority high | medium | low, each linked to its record)
  if v_docs then
    v_alerts := v_alerts || (
      select coalesce(jsonb_agg(jsonb_build_object(
               'type', 'document_expiry',
               'priority', case when d.expiry_date <= v_today + 7 then 'high' else 'medium' end,
               'title', case when d.expiry_date < v_today then 'Document expired' else 'Document expiring' end,
               'detail', e.name || ' · ' || d.title, 'date', d.expiry_date, 'employee_id', e.id,
               'path', '/hr/employees/' || e.id)), '[]'::jsonb)
      from public.hr_documents d join pg_temp.x_emp e on e.id = d.employee_id
      where d.archived_at is null and d.expiry_date is not null and d.expiry_date <= v_today + 30);
  end if;

  v_alerts := v_alerts || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'type', 'probation_end', 'priority', case when e.probation_end_date <= v_today + 7 then 'high' else 'medium' end,
             'title', 'Probation ending', 'detail', e.name, 'date', e.probation_end_date, 'employee_id', e.id,
             'path', '/hr/employees/' || e.id)), '[]'::jsonb)
    from pg_temp.x_emp e where e.probation_end_date between v_today and v_today + 30)
  || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'type', 'contract_end', 'priority', case when e.contract_end_date <= v_today + 7 then 'high' else 'medium' end,
             'title', 'Contract ending', 'detail', e.name, 'date', e.contract_end_date, 'employee_id', e.id,
             'path', '/hr/employees/' || e.id)), '[]'::jsonb)
    from pg_temp.x_emp e where e.contract_end_date between v_today and v_today + 30);

  if v_att then
    -- Past working days (last 7) where an active employee has no attendance record at all and was not on leave.
    v_alerts := v_alerts || (
      select coalesce(jsonb_agg(jsonb_build_object(
               'type', 'missing_attendance', 'priority', 'medium', 'title', 'Missing attendance records',
               'detail', n || case when n = 1 then ' employee has' else ' employees have' end || ' no attendance record',
               'date', dd, 'count', n, 'path', '/hr/attendance?tab=daily&date=' || dd)), '[]'::jsonb)
      from (select gs::date dd, count(*) n
            from generate_series(v_today - 7, v_today - 1, interval '1 day') gs
            join pg_temp.x_emp e on e.status in ('active','probation','notice_period') and (e.joining_date is null or e.joining_date <= gs::date)
            where hr_private.is_working_day_for(e.id, gs::date) and not hr_private.is_on_approved_leave(e.id, gs::date)
              and not exists (select 1 from public.hr_attendance a where a.employee_id = e.id and a.work_date = gs::date)
            group by 1) m);
    if (k ->> 'missing_punch_outs')::int > 0 then
      v_alerts := v_alerts || jsonb_build_object('type', 'missing_punch', 'priority', 'medium', 'title', 'Missing punch-outs',
        'detail', (k ->> 'missing_punch_outs') || ' past check-in(s) without a check-out', 'count', (k ->> 'missing_punch_outs')::int,
        'path', '/hr/attendance?tab=exceptions');
    end if;
  end if;

  -- Pending important HR actions
  if hr_private.any_permission(array['leave.approve','leave.approve_team']) then
    select count(*) into v_n from public.hr_leave_requests l join pg_temp.x_emp e on e.id = l.employee_id
      where l.status = 'pending_approval' and hr_private.leave_can_act(l)
        and (l.created_at::date <= v_today - 3 or l.start_date <= v_today + 1);
    if v_n > 0 then
      v_alerts := v_alerts || jsonb_build_object('type', 'leave_waiting', 'priority', 'high', 'title', 'Leave approvals overdue',
        'detail', v_n || ' request(s) waiting 3+ days or starting by tomorrow', 'count', v_n, 'path', '/hr/leave?tab=approvals');
    end if;
  end if;
  if hr_private.any_permission(array['hr_requests.view','hr_requests.manage']) then
    select count(*) into v_n from public.hr_requests q
      where q.status in ('open','in_progress','waiting_on_employee') and (q.sla_due_at < now() or q.priority = 'urgent');
    if v_n > 0 then
      v_alerts := v_alerts || jsonb_build_object('type', 'hr_request_sla', 'priority', 'high', 'title', 'HR requests overdue or urgent',
        'detail', v_n || ' open request(s) past their SLA or marked urgent', 'count', v_n, 'path', '/hr/requests');
    end if;
  end if;
  if hr_private.any_permission(array['exit.view','exit.view_team','exit.manage']) then
    v_alerts := v_alerts || (
      select coalesce(jsonb_agg(jsonb_build_object(
               'type', 'exit_lwd', 'priority', 'high', 'title', 'Last working day approaching',
               'detail', e.name || ' · exit ' || replace(q.status, '_', ' '),
               'date', coalesce(q.approved_last_working_day, q.proposed_last_working_day), 'employee_id', e.id, 'path', '/hr/exits/' || q.id)), '[]'::jsonb)
      from public.hr_exits q join pg_temp.x_emp e on e.id = q.employee_id
      where q.status in ('submitted','manager_review','hr_review','notice_period','clearance')
        and coalesce(q.approved_last_working_day, q.proposed_last_working_day) between v_today and v_today + 14);
  end if;
  if v_pv and v_run.id is not null and v_run.status not in ('finalized','paid') and v_run.period_end <= v_today + 3 then
    v_alerts := v_alerts || jsonb_build_object('type', 'payroll_due', 'priority', 'high', 'title', 'Payroll not finalized',
      'detail', 'Run ' || to_char(v_run.period_start, 'DD Mon') || ' – ' || to_char(v_run.period_end, 'DD Mon YYYY') || ' is ' || v_run.status,
      'date', v_run.period_end, 'path', '/hr/payroll/runs/' || v_run.id);
  end if;

  x := x || jsonb_build_object('alerts', (
    select coalesce(jsonb_agg(a order by case a ->> 'priority' when 'high' then 0 when 'medium' then 1 else 2 end,
                                         a ->> 'date' nulls last, a ->> 'title'), '[]'::jsonb)
    from jsonb_array_elements(v_alerts) a));

  return r || x || jsonb_build_object('kpis', k);
end $$;

revoke execute on function public.hr_dashboard(date, date, uuid, text, uuid, text, uuid) from anon, public;
grant execute on function public.hr_dashboard(date, date, uuid, text, uuid, text, uuid) to authenticated;
revoke execute on function hr_private.hr_dashboard_v116(date, date, uuid, text, uuid, text, uuid) from anon, public;
grant execute on function hr_private.hr_dashboard_v116(date, date, uuid, text, uuid, text, uuid) to authenticated;

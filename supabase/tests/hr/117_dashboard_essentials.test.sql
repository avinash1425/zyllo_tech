-- Simplified HR dashboard sections (117): inactive count, missing punch-outs,
-- absent-today names, approved leave, payroll gated by payroll.view,
-- approvals assigned to the caller (decision rules reused), alerts.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.appr(p_key text) returns int language sql as $$
  select (x ->> 'count')::int from jsonb_array_elements(public.hr_dashboard() -> 'my_approvals') x where x ->> 'key' = p_key
$$;

do $$
declare cl uuid; cat uuid; t date := hr_private.business_today();
begin
  insert into t_ids values ('super', test.make_employee('de.super@test.local', 'Sia', null, array['super_admin']));
  insert into t_ids values ('hr',    test.make_employee('de.hr@test.local', 'Hema', null, array['hr_admin']));
  insert into t_ids values ('pay',   test.make_employee('de.pay@test.local', 'Pavan', null, array['payroll_admin']));
  insert into t_ids values ('mgr',   test.make_employee('de.mgr@test.local', 'Meru', null, array['manager','employee']));
  insert into t_ids values ('e1',    test.make_employee('de.e1@test.local', 'Asha', (select v from t_ids where k='mgr')));
  insert into t_ids values ('e2',    test.make_employee('de.e2@test.local', 'Bodhi', (select v from t_ids where k='mgr')));
  insert into t_ids values ('e3',    test.make_employee('de.e3@test.local', 'Chitra', null));
  update public.hr_employees set status = 'suspended' where id = (select v from t_ids where k='e3');
  update public.hr_employees set probation_end_date = t + 20 where id = (select v from t_ids where k='e2');

  select id into cl from public.hr_leave_types where code = 'CL';
  -- approved leave covering today (e1), pending at manager level (e2), pending for the manager himself
  insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status)
    values ((select v from t_ids where k='e1'), cl, t, t, 1, extract(year from t)::int, 'Family event', 'approved');
  insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status, current_level)
    values ((select v from t_ids where k='e2'), cl, t + 10, t + 10, 1, extract(year from t)::int, 'Personal work', 'pending_approval', 'manager');
  insert into public.hr_leave_requests (employee_id, leave_type_id, start_date, end_date, days, year, reason, status, current_level)
    values ((select v from t_ids where k='mgr'), cl, t + 12, t + 12, 1, extract(year from t)::int, 'Personal work', 'pending_approval', 'hr');

  -- open punch yesterday (e2) and a pending correction (e2)
  insert into public.hr_attendance (employee_id, work_date, check_in_at, status, source)
    values ((select v from t_ids where k='e2'), t - 1, (t - 1)::timestamp + time '09:00', 'present', 'manual');
  insert into public.hr_attendance_corrections (employee_id, work_date, reason, requested_check_out_at)
    values ((select v from t_ids where k='e2'), t - 1, 'Forgot to check out', (t - 1)::timestamp + time '18:00');

  -- document expiring in 5 days (e1)
  select id into cat from public.hr_document_categories order by sort_order nulls last limit 1;
  insert into public.hr_documents (employee_id, category_id, title, expiry_date) values ((select v from t_ids where k='e1'), cat, 'Work permit', t + 5);

  -- current payroll run awaiting approval, prepared by nobody in this test
  insert into public.hr_payroll_runs (period_start, period_end, status)
    values (date_trunc('month', t)::date, (date_trunc('month', t) + interval '1 month - 1 day')::date, 'reviewed');
end $$;

-- ---- HR Admin: company scope, no payroll
select pg_temp.as_k('hr');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'inactive_employees')::int, 1, 'inactive = onboarding / suspended');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'total_employees')::int,
               (public.hr_dashboard() -> 'kpis' ->> 'active_employees')::int + (public.hr_dashboard() -> 'kpis' ->> 'inactive_employees')::int,
               'total = active + inactive');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'missing_punch_outs')::int,
               (select count(*)::int from public.hr_attendance_missing_punches), 'missing punch-outs match the missing-punch view');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'missing_punch_outs')::int, 1, 'one open punch');
select test.eq(jsonb_array_length(public.hr_dashboard() -> 'absent_today_list'), (public.hr_dashboard() -> 'kpis' ->> 'absent_today')::int,
               'absent-today names match the absent_today KPI');
select test.ok(not exists (select 1 from jsonb_array_elements(public.hr_dashboard() -> 'absent_today_list') x where (x ->> 'employee_id')::uuid = pg_temp.id('e1')),
               'employee on approved leave is not listed absent');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'approved_leave_requests')::int, 1, 'approved leave overlapping the period');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'on_leave_today')::int, 1, 'on leave today (existing KPI)');
select test.ok(public.hr_dashboard() -> 'payroll' = 'null'::jsonb, 'HR Admin gets no payroll section');
select test.ok(not exists (select 1 from jsonb_array_elements(public.hr_dashboard() -> 'my_approvals') x where x ->> 'key' in ('payroll_runs','reimbursements')),
               'HR Admin has no payroll approvals');
select test.ok(not exists (select 1 from jsonb_array_elements(public.hr_dashboard() -> 'alerts') x where x ->> 'type' = 'payroll_due'),
               'HR Admin gets no payroll alert');
select test.eq(pg_temp.appr('leave'), 2, 'HR approver can act on both pending leave requests');
select test.eq(pg_temp.appr('attendance_corrections'), 1, 'pending attendance correction');
select test.ok((select x ->> 'priority' = 'high' from jsonb_array_elements(public.hr_dashboard() -> 'alerts') x where x ->> 'type' = 'document_expiry'),
               'document expiring within 7 days is high priority');
select test.ok((select x ->> 'priority' = 'medium' and x ->> 'path' = '/hr/employees/' || pg_temp.id('e2')
                from jsonb_array_elements(public.hr_dashboard() -> 'alerts') x where x ->> 'type' = 'probation_end'),
               'probation alert links to the employee record');
select test.ok(exists (select 1 from jsonb_array_elements(public.hr_dashboard() -> 'alerts') x where x ->> 'type' = 'missing_punch'), 'missing punch alert');
select test.eq(public.hr_dashboard() -> 'alerts' -> 0 ->> 'priority', 'high', 'alerts are sorted high priority first');
select test.ok(public.hr_dashboard() -> 'by_company' is not null and public.hr_dashboard() -> 'kpis' ? 'present_today', 'existing sections still returned');

-- ---- Manager: team scope, decisions limited to the reporting line
select pg_temp.as_k('mgr');
select test.eq((public.hr_dashboard() -> 'kpis' ->> 'total_employees')::int, 2, 'manager sees the team only');
select test.eq(pg_temp.appr('leave'), 1, 'manager can act on the team request, not on his own');
select test.eq(pg_temp.appr('attendance_corrections'), 1, 'team correction');
select test.ok(not exists (select 1 from jsonb_array_elements(public.hr_dashboard() -> 'my_approvals') x where x ->> 'key' in ('hr_requests','asset_requests','payroll_runs')),
               'manager gets no HR-desk or payroll approvals');
select test.ok(public.hr_dashboard() -> 'payroll' = 'null'::jsonb, 'manager gets no payroll section');

-- ---- Super Admin: payroll visible, separation of duties respected
select pg_temp.as_k('super');
select test.eq(public.hr_dashboard() -> 'payroll' -> 'current_run' ->> 'status', 'reviewed', 'current period run');
select test.eq((public.hr_dashboard() -> 'payroll' -> 'status_counts' ->> 'reviewed')::int, 1, 'status counts');
select test.eq((public.hr_dashboard() -> 'payroll' -> 'pending_actions' ->> 'approve')::int, 1, 'run awaiting approval');
select test.eq(pg_temp.appr('payroll_runs'), 1, 'payroll approval listed for the approver');
select test.ok(public.hr_dashboard() -> 'payroll' -> 'current_run' ? 'gross', 'financial totals for payroll.view holders');
select test.ok(exists (select 1 from jsonb_array_elements(public.hr_dashboard() -> 'alerts') x where x ->> 'type' = 'payroll_due')
               or (select period_end from public.hr_payroll_runs limit 1) > hr_private.business_today() + 3, 'payroll-not-finalized alert near period end');
select test.as_owner();
update public.hr_payroll_runs set calculated_by = test.user_of(pg_temp.id('super'));
select pg_temp.as_k('super');
select test.eq((public.hr_dashboard() -> 'payroll' -> 'pending_actions' ->> 'approve')::int, 0, 'preparer is not offered the approval (separation of duties)');

-- ---- Payroll Admin / employee: no dashboard (existing permission model)
select pg_temp.as_k('pay');
select test.throws($q$select public.hr_dashboard()$q$, 'payroll admin has no dashboard permission', 'dashboard');
select pg_temp.as_k('e1');
select test.throws($q$select public.hr_dashboard()$q$, 'employee cannot open the HR dashboard', 'dashboard');

-- ---- Interview feedback due: a saved draft evaluation (120) is not a submission
select test.as_owner();
do $$
declare op uuid; ca uuid; ap uuid; iv uuid;
begin
  insert into public.hr_job_openings (title) values ('Dashboard test role') returning id into op;
  insert into public.hr_candidates (full_name, email) values ('Dee Candidate', 'de.cand@test.local') returning id into ca;
  insert into public.hr_candidate_applications (candidate_id, opening_id) values (ca, op) returning id into ap;
  insert into public.hr_interviews (application_id, scheduled_at, status) values (ap, now() - interval '2 hours', 'completed') returning id into iv;
  insert into public.hr_interview_panel (interview_id, employee_id) values (iv, (select v from t_ids where k='mgr'));
  insert into t_ids values ('iv', iv);
end $$;
select pg_temp.as_k('mgr');
select test.eq(pg_temp.appr('interview_feedback'), 1, 'held interview without feedback is due');
select test.as_owner();
insert into public.hr_interview_feedback (interview_id, interviewer_id, status, rating, recommendation, submitted_at)
  values (pg_temp.id('iv'), pg_temp.id('mgr'), 'draft', null, null, null);
select pg_temp.as_k('mgr');
select test.eq(pg_temp.appr('interview_feedback'), 1, 'a draft evaluation still counts as feedback due');
select test.as_owner();
update public.hr_interview_feedback set status = 'submitted', rating = 4, recommendation = 'hire', submitted_at = now()
  where interview_id = pg_temp.id('iv');
select pg_temp.as_k('mgr');
select test.eq(coalesce(pg_temp.appr('interview_feedback'), 0), 0, 'submitted evaluation clears the item (hidden for non-recruiters at zero)');

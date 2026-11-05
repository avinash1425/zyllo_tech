-- =====================================================================
-- LOCAL TEST HARNESS ONLY. NEVER APPLY TO A REAL SUPABASE PROJECT.
-- Synthetic sign-in accounts + module data for scripts/hrms-local/start.mjs.
-- Runs after supabase/seed/hr_dev_seed.sql and local_harness.sql on a fresh
-- throwaway cluster.
--
-- * Every person is fictional ("Demo …", @example.com).
-- * Accounts: password Local-Test-Only-2026! (bcrypt in hrms_local.passwords).
-- * The first Super Admin is bootstrapped by a direct insert (as documented
--   for real deployments); every other role is granted with hr_assign_role
--   AS that Super Admin, and accounts are linked with the real service-role
--   RPC hr_link_invited_user + hr_activate_my_account.
-- * Module data is created by calling the REAL RPCs as the relevant users
--   (role + request.jwt.claims switched inside DO blocks), so business rules,
--   RLS, notifications, emails-to-outbox and audit rows are produced exactly
--   as in the app. Plain table writes are used only where the app itself
--   writes tables directly (review cycles, goals, daily report drafts,
--   announcements, holidays, employees), and they also run AS the user.
-- * Dates are relative to hr_private.business_today() and skip weekends and
--   holidays, so the script succeeds on any day it is run.
-- =====================================================================
\set ON_ERROR_STOP 1

-- ------------------------------------------------ lookup helpers (dropped at the end)
-- SECURITY DEFINER so they resolve while a DO block is impersonating a user.
create or replace function hrms_local.uid(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$ select id from auth.users where email = p_email $$;
create or replace function hrms_local.emp(p_company_email text) returns uuid
language sql stable security definer set search_path = '' as $$ select id from public.hr_employees where company_email = p_company_email $$;
-- n-th working day (Mon–Fri, not a holiday) before today (1 = previous working day)
create or replace function hrms_local.past_workday(p_n int) returns date
language sql stable security definer set search_path = '' as $$
  select d from (
    select g::date as d, row_number() over (order by g desc) as rn
    from generate_series(hr_private.business_today() - 60, hr_private.business_today() - 1, interval '1 day') g
    where extract(isodow from g) between 1 and 5
      and not exists (select 1 from public.hr_holidays h where h.holiday_date = g::date)) x
  where rn = p_n $$;
-- first working day on/after today + p_offset
create or replace function hrms_local.future_workday(p_offset int) returns date
language sql stable security definer set search_path = '' as $$
  select min(g::date) from generate_series(hr_private.business_today() + p_offset, hr_private.business_today() + p_offset + 14, interval '1 day') g
  where extract(isodow from g) between 1 and 5
    and not exists (select 1 from public.hr_holidays h where h.holiday_date = g::date) $$;
-- local wall-clock time on a business date -> timestamptz
create or replace function hrms_local.at(p_date date, p_time time) returns timestamptz
language sql stable security definer set search_path = '' as $$ select (p_date + p_time) at time zone hr_private.business_timezone() $$;
grant execute on function hrms_local.uid(text), hrms_local.emp(text), hrms_local.past_workday(int),
  hrms_local.future_workday(int), hrms_local.at(date, time) to authenticated, service_role;

-- ----------------------------------------------------------------- accounts
do $$
declare
  r record;
begin
  for r in select * from (values
      ('superadmin@example.com',       'Demo Super Admin'),
      ('hr.admin@example.com',         'Demo HR Admin'),
      ('payroll.admin@example.com',    'Demo Payroll Admin'),
      ('payroll.approver@example.com', 'Demo Payroll Approver'),
      ('manager@example.com',          'Demo Manager'),
      ('employee@example.com',         'Demo Employee'),
      ('employee2@example.com',        'Demo Employee Two'),
      ('intern@example.com',           'Demo Intern'),
      ('noaccess@example.com',         'Demo No Access')) t(email, name)
  loop
    insert into auth.users (email, raw_user_meta_data)
    values (r.email, jsonb_build_object('full_name', r.name, 'synthetic', true));
    insert into hrms_local.passwords (user_id, password_hash)
    values (hrms_local.uid(r.email), public.crypt('Local-Test-Only-2026!', public.gen_salt('bf', 6)));
  end loop;

  -- Bootstrap the first Super Admin (the documented manual step).
  insert into public.hr_user_roles (user_id, role_key) values (hrms_local.uid('superadmin@example.com'), 'super_admin');
end $$;

-- Employee record for the second payroll person, created by the Super Admin
-- through the same table insert the HR "Add employee" form uses (RLS applies).
do $$
begin
  perform hrms_local.act_as('superadmin@example.com');
  insert into public.hr_employees (first_name, last_name, company_email, department_id, designation_id, manager_id,
                                   employment_type, joining_date, work_location_id, shift_id, status)
  values ('Demo', 'Payroll Approver', 'demo.payroll.approver@example.com',
          (select id from public.hr_departments where code = 'FIN'),
          (select id from public.hr_designations where name = 'Finance Executive'),
          hrms_local.emp('demo.founder@example.com'), 'full_time', date '2025-02-03',
          (select id from public.hr_locations limit 1), (select id from public.hr_shifts where is_default limit 1), 'active');
  perform hrms_local.act_as_owner();
end $$;

-- Link accounts through the invitation service RPC (service role), then activate as the user.
do $$
declare
  r record;
  v_super uuid := hrms_local.uid('superadmin@example.com');
begin
  for r in select * from (values
      ('hr.admin@example.com',         'demo.hr@example.com'),
      ('payroll.admin@example.com',    'demo.finance@example.com'),
      ('payroll.approver@example.com', 'demo.payroll.approver@example.com'),
      ('manager@example.com',          'demo.englead@example.com'),
      ('employee@example.com',         'demo.engineer3@example.com'),
      ('employee2@example.com',        'demo.designer@example.com'),
      ('intern@example.com',           'demo.intern1@example.com')) t(login, company)
  loop
    perform hrms_local.act_as_service();
    perform public.hr_link_invited_user(hrms_local.emp(r.company), hrms_local.uid(r.login), v_super);
    perform hrms_local.act_as_owner();
    perform hrms_local.act_as(r.login);
    perform public.hr_activate_my_account();
    perform hrms_local.act_as_owner();
  end loop;

  -- Extra roles, granted by the Super Admin through the real RPC.
  perform hrms_local.act_as('superadmin@example.com');
  perform public.hr_assign_role(hrms_local.uid('hr.admin@example.com'), 'hr_admin');
  perform public.hr_assign_role(hrms_local.uid('payroll.admin@example.com'), 'payroll_admin');
  perform public.hr_assign_role(hrms_local.uid('payroll.approver@example.com'), 'payroll_admin');
  perform public.hr_assign_role(hrms_local.uid('manager@example.com'), 'manager');
  perform hrms_local.act_as_owner();
end $$;

-- --------------------------------------------------------------- attendance
do $$
declare
  i int; d date;
  v_emps uuid[] := array[hrms_local.emp('demo.engineer3@example.com'), hrms_local.emp('demo.designer@example.com'),
                         hrms_local.emp('demo.intern1@example.com'), hrms_local.emp('demo.englead@example.com'),
                         hrms_local.emp('demo.engineer1@example.com'), hrms_local.emp('demo.engineer2@example.com')];
  e uuid; k int := 0;
begin
  perform hrms_local.act_as('hr.admin@example.com');
  for i in 1..6 loop
    d := hrms_local.past_workday(i);
    foreach e in array v_emps loop
      k := k + 1;
      if i = 4 and e = v_emps[3] then
        perform public.hr_upsert_attendance_manual(e, d, null, null, 'Synthetic: absent (local harness)', 'absent');
      else
        perform public.hr_upsert_attendance_manual(e, d,
          hrms_local.at(d, case when i = 2 and e = v_emps[1] then time '09:58' else time '09:20' + make_interval(mins => (k * 7) % 12) end),
          hrms_local.at(d, time '18:35' + make_interval(mins => (k * 11) % 20)),
          'Synthetic attendance entry (local harness)');
      end if;
    end loop;
  end loop;
  perform hrms_local.act_as_owner();

  -- Today: the employee checks in through self-service.
  perform hrms_local.act_as('employee@example.com');
  perform public.hr_check_in('Synthetic check-in (local harness)');
  -- A pending correction for an earlier day.
  d := hrms_local.past_workday(2);
  perform public.hr_request_attendance_correction(d, hrms_local.at(d, time '09:25'), hrms_local.at(d, time '18:45'),
                                                  'Synthetic: forgot to punch on time (local harness)');
  perform hrms_local.act_as_owner();

  perform hrms_local.act_as('manager@example.com');
  perform public.hr_check_in('Synthetic check-in (local harness)');
  perform hrms_local.act_as_owner();
end $$;

-- ------------------------------------------------------------ daily reports
do $$
declare
  v_emp uuid := hrms_local.emp('demo.engineer3@example.com');
  v_proj uuid; v_task uuid; v_id uuid; i int; d date;
  v_status text[] := array['draft', 'submitted', 'reviewed', 'revision_requested'];
begin
  select id into v_proj from public.hr_projects where code = 'DEMO-WEB';
  select id into v_task from public.hr_tasks where assignee_id = v_emp and project_id = v_proj limit 1;
  perform hrms_local.act_as('employee@example.com');
  for i in 1..4 loop
    d := hrms_local.past_workday(i);
    insert into public.hr_daily_reports (employee_id, report_date, summary, pending_work, blockers, tomorrow_plan)
    values (v_emp, d, 'Synthetic summary for ' || to_char(d, 'DD Mon') || ': worked on the demo website revamp.',
            'Polish the synthetic landing page.', case when i = 3 then 'Waiting on synthetic API credentials.' end,
            'Continue the synthetic tasks.')
    returning id into v_id;
    insert into public.hr_daily_report_items (report_id, project_id, task_id, activity, description, hours, progress_pct)
    values (v_id, v_proj, v_task, 'Frontend development', 'Synthetic work item', 6, 40 + i * 10),
           (v_id, null, null, 'Team meeting', 'Synthetic stand-up and planning', 1.5, null);
    if v_status[i] <> 'draft' then
      perform public.hr_submit_daily_report(v_id);
    end if;
    if v_status[i] in ('reviewed', 'revision_requested') then
      perform hrms_local.act_as_owner();
      perform hrms_local.act_as('manager@example.com');
      if v_status[i] = 'reviewed' then
        perform public.hr_review_daily_report(v_id, 'reviewed', 'Good progress (synthetic review).');
      else
        perform public.hr_review_daily_report(v_id, 'revision_requested', 'Please add more detail on the blockers (synthetic).');
      end if;
      perform hrms_local.act_as_owner();
      perform hrms_local.act_as('employee@example.com');
    end if;
  end loop;
  perform hrms_local.act_as_owner();
end $$;

-- ----------------------------------------------------------- leave + holidays
do $$
declare
  v_year int := extract(year from hr_private.business_today())::int;
  v_cl uuid; v_sl uuid; v_req jsonb; d date;
begin
  select id into v_cl from public.hr_leave_types where code = 'CL';
  select id into v_sl from public.hr_leave_types where code = 'SL';

  perform hrms_local.act_as('hr.admin@example.com');
  insert into public.hr_holidays (holiday_date, name, type)
  values (make_date(v_year, 12, 25), 'Christmas (synthetic calendar entry)', 'company')
  on conflict do nothing;
  perform public.hr_initialize_leave_year(v_year);
  perform hrms_local.act_as_owner();

  -- employee@: approved (past, manager -> HR), pending at manager level, rejected.
  perform hrms_local.act_as('employee@example.com');
  d := hrms_local.past_workday(8);
  v_req := public.hr_apply_leave(v_sl, d, d, 'Synthetic: unwell (local harness)');
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('manager@example.com');
  perform public.hr_decide_leave((v_req ->> 'id')::uuid, true, 'Get well soon (synthetic).');
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('hr.admin@example.com');
  perform public.hr_decide_leave((v_req ->> 'id')::uuid, true, null);
  perform hrms_local.act_as_owner();

  perform hrms_local.act_as('employee@example.com');
  d := hrms_local.future_workday(7);
  perform public.hr_apply_leave(v_cl, d, d, 'Synthetic: family function (local harness)');
  d := hrms_local.future_workday(14);
  v_req := public.hr_apply_leave(v_cl, d, d, 'Synthetic: personal errand (local harness)');
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('manager@example.com');
  perform public.hr_decide_leave((v_req ->> 'id')::uuid, false, 'Release week — please pick another day (synthetic).');
  perform hrms_local.act_as_owner();

  -- employee2@ (manager not linked -> goes straight to HR level), intern@ pending.
  perform hrms_local.act_as('employee2@example.com');
  d := hrms_local.future_workday(10);
  perform public.hr_apply_leave(v_cl, d, d, 'Synthetic: travel (local harness)');
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('intern@example.com');
  d := hrms_local.future_workday(9);
  perform public.hr_apply_leave(v_cl, d, d, 'Synthetic: university exam (local harness)');
  perform hrms_local.act_as_owner();
end $$;

-- ------------------------------------------------------------------ payroll
do $$
declare
  v_start date := (date_trunc('month', hr_private.business_today()) - interval '1 month')::date;
  v_end date := (date_trunc('month', hr_private.business_today()) - interval '1 day')::date;
  v_run jsonb; v_id uuid; v_claim uuid;
begin
  perform hrms_local.act_as('payroll.admin@example.com');
  v_run := public.hr_create_payroll_run(v_start, v_end, 'Synthetic payroll run (local harness)');
  v_id := (v_run ->> 'id')::uuid;
  perform public.hr_calculate_payroll_run(v_id);
  perform hrms_local.act_as_owner();
  -- Separation of duties: a different payroll person reviews, approves and finalizes.
  perform hrms_local.act_as('payroll.approver@example.com');
  perform public.hr_review_payroll_run(v_id, 'Checked totals (synthetic).');
  perform public.hr_approve_payroll_run(v_id);
  perform public.hr_finalize_payroll_run(v_id);
  perform hrms_local.act_as_owner();

  -- Reimbursements: one approved (for the next run), one legacy claim awaiting a decision.
  -- Employees can no longer self-submit through hr_submit_reimbursement (196: claims go through
  -- HR Requests, Module 10), so these synthetic payroll-side rows are inserted as owner.
  perform hrms_local.act_as_owner();
  insert into public.hr_reimbursements (employee_id, claim_date, category, amount, description)
  values (hrms_local.emp('employee@example.com'), hrms_local.past_workday(3), 'travel', 1250, 'Synthetic client visit cab fare (local harness)')
  returning id into v_claim;
  insert into public.hr_reimbursements (employee_id, claim_date, category, amount, description)
  values (hrms_local.emp('employee@example.com'), hrms_local.past_workday(2), 'internet', 799, 'Synthetic home internet (local harness)');
  perform hrms_local.act_as('payroll.admin@example.com');
  perform public.hr_decide_reimbursement(v_claim, true, 'Approved (synthetic).');
  perform hrms_local.act_as_owner();
end $$;

-- -------------------------------------------------------------- recruitment
do $$
declare
  v_opening uuid; v_app uuid; v_iv uuid; v_offer uuid;
  v_mgr uuid := hrms_local.emp('demo.englead@example.com');
  v_apps uuid[] := '{}';
  i int;
  v_names text[] := array['Demo Candidate Asha', 'Demo Candidate Bala', 'Demo Candidate Chitra', 'Demo Candidate Dev', 'Demo Candidate Esha'];
begin
  perform hrms_local.act_as('hr.admin@example.com');
  v_opening := public.hr_create_job_opening('Demo Backend Engineer (synthetic)',
    (select id from public.hr_departments where code = 'ENG'), 'full_time', 2, array['Node.js', 'PostgreSQL'], 2, 5, 'Guntur',
    'Synthetic opening created by the local test harness.', null, v_mgr, true);
  for i in 1..5 loop
    v_apps := v_apps || public.hr_add_candidate(v_opening, v_names[i],
      'candidate.' || lower(split_part(v_names[i], ' ', 3)) || '@example.com', null,
      (array['linkedin', 'referral', 'careers_site', 'agency', 'other'])[i], null, 'Synthetic Corp', 2 + i, 'Synthetic candidate');
  end loop;
  -- Bala: screening
  perform public.hr_move_candidate_stage(v_apps[2], 'screening', 'Synthetic screening');
  -- Chitra: interview in the past with the manager on the panel, awaiting feedback
  perform public.hr_move_candidate_stage(v_apps[3], 'screening', null);
  perform public.hr_move_candidate_stage(v_apps[3], 'shortlisted', null);
  perform public.hr_schedule_interview(v_apps[3], now() - interval '2 days', array[v_mgr], 1, 'technical', 60, 'video', 'https://meet.example.com/demo');
  -- Dev: interviewed, feedback given, selected, offer sent
  perform public.hr_move_candidate_stage(v_apps[4], 'screening', null);
  perform public.hr_move_candidate_stage(v_apps[4], 'shortlisted', null);
  v_iv := public.hr_schedule_interview(v_apps[4], now() - interval '5 days', array[v_mgr], 1, 'technical', 45, 'video', 'https://meet.example.com/demo2');
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('manager@example.com');
  perform public.hr_submit_interview_feedback(v_iv, 4, 'hire', 'Solid SQL (synthetic).', 'Limited cloud exposure (synthetic).');
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('hr.admin@example.com');
  perform public.hr_move_candidate_stage(v_apps[4], 'selected', 'Synthetic selection');
  v_offer := public.hr_create_offer(v_apps[4], (select id from public.hr_designations where name = 'Software Engineer'),
    (select id from public.hr_departments where code = 'ENG'), 'full_time', hrms_local.future_workday(30), 650000,
    hr_private.business_today() + 14, 'Synthetic offer');
  perform public.hr_send_offer(v_offer);
  -- Esha: rejected
  perform public.hr_move_candidate_stage(v_apps[5], 'rejected', 'Synthetic: not a fit for this role');
  perform hrms_local.act_as_owner();
end $$;

-- -------------------------------------------------------------- performance
do $$
declare
  v_today date := hr_private.business_today();
  v_cycle uuid; v_review uuid;
  v_emp uuid := hrms_local.emp('demo.engineer3@example.com');
begin
  perform hrms_local.act_as('hr.admin@example.com');
  insert into public.hr_review_cycles (name, cycle_type, period_start, period_end, self_assessment_due, manager_review_due)
  values ('Demo Q4 ' || extract(year from v_today) || ' review (synthetic)', 'quarterly',
          date_trunc('quarter', v_today)::date, (date_trunc('quarter', v_today) + interval '3 months - 1 day')::date,
          v_today + 14, v_today + 28)
  returning id into v_cycle;
  perform public.hr_start_review_cycle(v_cycle);
  perform hrms_local.act_as_owner();

  perform hrms_local.act_as('manager@example.com');
  insert into public.hr_goals (employee_id, cycle_id, title, description, weight, target_value, actual_value, status)
  values (v_emp, v_cycle, 'Ship the synthetic landing page', 'Synthetic goal', 40, 100, 60, 'agreed'),
         (v_emp, v_cycle, 'Close synthetic bug backlog', 'Synthetic goal', 30, 20, 12, 'in_progress');
  perform hrms_local.act_as_owner();

  perform hrms_local.act_as('employee@example.com');
  insert into public.hr_goals (employee_id, cycle_id, title, description, weight, target_value)
  values (v_emp, v_cycle, 'Learn synthetic testing tools', 'Proposed by the employee (synthetic)', 20, 1);
  perform hrms_local.act_as_owner();
  -- (the employee cannot read their own review row until it is finalized)
  select id into v_review from public.hr_performance_reviews where employee_id = v_emp and cycle_id = v_cycle;
  perform hrms_local.act_as('employee@example.com');
  perform public.hr_submit_self_assessment(v_review, 'Synthetic self-assessment: delivered the landing page on time.', 4);
  perform hrms_local.act_as_owner();
end $$;

-- ---------------------------------------------------------------- documents
-- Registered through the real RPC; the storage object row is inserted AS the
-- uploader so the storage RLS policy is enforced; start.mjs writes the bytes.
do $$
declare
  v_reg jsonb;
  v_emp uuid := hrms_local.emp('demo.engineer3@example.com');
  v_emp2 uuid := hrms_local.emp('demo.designer@example.com');
  v_doc uuid;
begin
  -- HR adds the employee's offer letter and verifies it.
  perform hrms_local.act_as('hr.admin@example.com');
  v_reg := public.hr_register_document_upload(v_emp, 'offer_letter', 'Offer letter (synthetic)', 'offer-letter.pdf', 'application/pdf', 1024);
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('hr-documents', v_reg ->> 'storage_path', auth.uid(), jsonb_build_object('mimetype', 'application/pdf', 'size', 1024));
  v_doc := (v_reg ->> 'document_id')::uuid;
  perform hrms_local.act_as_owner();
  insert into hrms_local.fixture_files values ('hr-documents', v_reg ->> 'storage_path', 'pdf');
  perform hrms_local.act_as('hr.admin@example.com');
  perform public.hr_verify_document(v_doc, true, null);
  -- A confidential HR record (never visible to the employee).
  v_reg := public.hr_register_document_upload(v_emp, 'hr_confidential', 'Confidential note (synthetic)', 'confidential-note.pdf', 'application/pdf', 900);
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('hr-documents', v_reg ->> 'storage_path', auth.uid(), jsonb_build_object('mimetype', 'application/pdf', 'size', 900));
  perform hrms_local.act_as_owner();
  insert into hrms_local.fixture_files values ('hr-documents', v_reg ->> 'storage_path', 'pdf');

  -- The employee uploads their own ID proof (pending verification).
  perform hrms_local.act_as('employee@example.com');
  v_reg := public.hr_register_document_upload(v_emp, 'id_proof', 'ID proof (synthetic)', 'id-proof.pdf', 'application/pdf', 2048);
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('hr-documents', v_reg ->> 'storage_path', auth.uid(), jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
  perform hrms_local.act_as_owner();
  insert into hrms_local.fixture_files values ('hr-documents', v_reg ->> 'storage_path', 'pdf');

  -- employee2@ uploads one too (isolation checks).
  perform hrms_local.act_as('employee2@example.com');
  v_reg := public.hr_register_document_upload(v_emp2, 'education_certificate', 'Degree certificate (synthetic)', 'degree.pdf', 'application/pdf', 3000);
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('hr-documents', v_reg ->> 'storage_path', auth.uid(), jsonb_build_object('mimetype', 'application/pdf', 'size', 3000));
  perform hrms_local.act_as_owner();
  insert into hrms_local.fixture_files values ('hr-documents', v_reg ->> 'storage_path', 'pdf');
end $$;

-- ------------------------------------------------------------------- assets
do $$
declare
  v_asg uuid;
begin
  perform hrms_local.act_as('hr.admin@example.com');
  perform public.hr_assign_asset((select id from public.hr_assets where asset_tag = 'DEMO-LT-001'), hrms_local.emp('demo.engineer3@example.com'),
                                 null, 'Synthetic assignment — not yet acknowledged');
  v_asg := public.hr_assign_asset((select id from public.hr_assets where asset_tag = 'DEMO-LT-002'), hrms_local.emp('demo.designer@example.com'),
                                  null, 'Synthetic assignment');
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('employee2@example.com');
  perform public.hr_acknowledge_asset(v_asg);
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('hr.admin@example.com');
  v_asg := public.hr_assign_asset((select id from public.hr_assets where asset_tag = 'DEMO-LT-003'), hrms_local.emp('demo.englead@example.com'),
                                  null, 'Synthetic assignment');
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('manager@example.com');
  perform public.hr_acknowledge_asset(v_asg);
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('intern@example.com');
  perform public.hr_request_asset('Monitor', 'Synthetic: a second screen for testing layouts');
  perform hrms_local.act_as_owner();
end $$;

-- ------------------------------------------------------------ announcements
do $$
declare v_id uuid;
begin
  perform hrms_local.act_as('hr.admin@example.com');
  insert into public.hr_announcements (title, body, category, audience_type, requires_acknowledgement)
  values ('Synthetic policy update: hybrid work days',
          'This is synthetic announcement content created by the local test harness. Please acknowledge.',
          'policy', 'all', true)
  returning id into v_id;
  perform public.hr_publish_announcement(v_id);
  insert into public.hr_announcements (title, body, category, audience_type)
  values ('Synthetic draft: year-end celebration', 'Draft content (synthetic).', 'event', 'all');
  perform hrms_local.act_as_owner();
end $$;

-- -------------------------------------------------------------- HR requests
do $$
declare v_req uuid;
begin
  perform hrms_local.act_as('employee@example.com');
  perform public.hr_create_hr_request('general', 'Synthetic: question about the dress code', 'Is there a dress code for client visits? (synthetic)', 'low');
  v_req := public.hr_create_hr_request('leave_query', 'Synthetic: leave balance looks wrong', 'My casual leave balance seems off by one day (synthetic).', 'medium');
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('hr.admin@example.com');
  perform public.hr_comment_hr_request(v_req, 'Checking the balance history now (synthetic).', false);
  perform public.hr_comment_hr_request(v_req, 'Internal: adjustment from last year was not carried (synthetic internal note).', true);
  perform public.hr_update_hr_request_status(v_req, 'resolved', 'Balance corrected (synthetic).');
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as('employee2@example.com');
  perform public.hr_create_hr_request('payroll_query', 'Synthetic: payslip deduction', 'What is the other deduction on my payslip? (synthetic)', 'medium');
  perform hrms_local.act_as_owner();
end $$;

-- --------------------------------------------------------------------- exit
do $$
declare v_exit uuid;
begin
  perform hrms_local.act_as('hr.admin@example.com');
  v_exit := public.hr_initiate_exit(hrms_local.emp('demo.engineer5@example.com'), 'resignation',
                                    'Synthetic: relocating (local harness)', hr_private.business_today() + 30);
  perform public.hr_start_exit_clearance(v_exit);
  perform hrms_local.act_as_owner();
end $$;

-- ------------------------------------------------------------------ cleanup
drop function hrms_local.uid(text);
drop function hrms_local.emp(text);
drop function hrms_local.past_workday(int);
drop function hrms_local.future_workday(int);
drop function hrms_local.at(date, time);

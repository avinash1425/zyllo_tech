-- Module 4 — Onboarding & Employee Exit (130):
-- accepted offer -> onboarding case (no duplicates), checklist rules
-- (documents, evidence, acknowledgement, assets, training sync), document
-- upload notification, joining + completion -> employee status; probation
-- reminders, manager feedback, HR decisions (extend / confirm / terminate)
-- with Employee Management sync; resignation withdrawal policy; owner-aware
-- clearance, audited exceptions, access-revocation timing and failure;
-- full & final settlement separation of duties; employee portal visibility.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
-- SECURITY DEFINER so lookups resolve while impersonating a user (RLS would hide the row).
create function pg_temp.task(p_case text, p_title text) returns uuid language sql security definer as $$
  select id from public.hr_onboarding_tasks where case_id = (select v from t_ids where k = p_case) and title = p_title
$$;
create function pg_temp.item(p_exit text, p_key text) returns uuid language sql security definer as $$
  select id from public.hr_exit_clearance_items where exit_id = (select v from t_ids where k = p_exit) and item_key = p_key
$$;

do $$
begin
  insert into public.hr_roles (key, name, description) values ('it_admin', 'IT Admin (test)', 'IT clearance owner') on conflict do nothing;  -- 197 seeds it_admin
  insert into public.hr_role_permissions values ('it_admin', 'exit.clearance_it') on conflict do nothing;
  insert into t_ids values ('super',  test.make_employee('m4.super@test.local', 'Sam', null, array['super_admin']));
  insert into t_ids values ('hr',     test.make_employee('m4.hr@test.local', 'Hana', null, array['hr_admin','employee']));
  insert into t_ids values ('mgr',    test.make_employee('m4.mgr@test.local', 'Milo', null, array['manager','employee']));
  insert into t_ids values ('it',     test.make_employee('m4.it@test.local', 'Ivan', null, array['it_admin','employee']));
  insert into t_ids values ('pay1',   test.make_employee('m4.pay1@test.local', 'Pam', null, array['payroll_admin','employee']));
  insert into t_ids values ('pay2',   test.make_employee('m4.pay2@test.local', 'Pat', null, array['payroll_admin','employee']));
  insert into t_ids values ('out',    test.make_employee('m4.out@test.local', 'Olga', null));
  insert into t_ids values ('prob',   test.make_employee('m4.prob@test.local', 'Pria', (select v from t_ids where k='mgr')));
  insert into t_ids values ('prob2',  test.make_employee('m4.prob2@test.local', 'Pete', (select v from t_ids where k='mgr')));
  insert into t_ids values ('leaver', test.make_employee('m4.leaver@test.local', 'Lena', (select v from t_ids where k='mgr')));
  insert into t_ids values ('wd',     test.make_employee('m4.wd@test.local', 'Wade', null));
end $$;

-- =====================================================================
-- 1. Accepted offer -> onboarding case
-- =====================================================================
do $$
declare v_open uuid; v_cand uuid; v_app uuid; v_offer uuid;
begin
  insert into public.hr_job_openings (title, status) values ('Synthetic Engineer', 'open') returning id into v_open;
  insert into public.hr_candidates (full_name, email) values ('Jo Joiner', 'jo.joiner@example.com') returning id into v_cand;
  insert into public.hr_candidate_applications (candidate_id, opening_id, stage) values (v_cand, v_open, 'offered') returning id into v_app;
  insert into public.hr_offers (application_id, employment_type, proposed_joining_date, status)
  values (v_app, 'full_time', current_date, 'accepted') returning id into v_offer;
  insert into t_ids values ('app', v_app), ('offer', v_offer);
end $$;
select pg_temp.as_k('hr');
do $$ begin
  insert into t_ids values ('join', public.hr_convert_candidate_to_employee(pg_temp.id('app'), 'jo.joiner@zyllo.test', current_date, null, null, pg_temp.id('mgr')));
end $$;
insert into t_ids select 'case', id from public.hr_onboarding_cases where employee_id = pg_temp.id('join');
select test.ok(pg_temp.id('case') is not null, 'converting a candidate with an accepted offer opens an onboarding case');
select test.ok((select offer_id = pg_temp.id('offer') and application_id = pg_temp.id('app') and status = 'open'
                       and hr_coordinator_id = pg_temp.id('hr') and reporting_manager_id = pg_temp.id('mgr') and joining_date = current_date
                from public.hr_onboarding_cases where id = pg_temp.id('case')), 'case linked to offer, employee record, coordinator and manager');
select test.eq((select count(*) from public.hr_onboarding_tasks where case_id = pg_temp.id('case')), 10::bigint, 'standard checklist tasks created');
select test.ok((select due_date = current_date + 7 from public.hr_onboarding_tasks where id = pg_temp.task('case', 'Required joining documents verified')),
  'task due dates follow the joining date');
select test.throws($q$select public.hr_create_onboarding_case(pg_temp.id('join'))$q$, 'no duplicate onboarding case', 'already has an onboarding case');
select test.throws($q$insert into public.hr_onboarding_cases (employee_id) values (pg_temp.id('out'))$q$, 'no direct inserts', 'permission denied');
select test.ok(exists (select 1 from public.hr_onboarding_events where case_id = pg_temp.id('case') and event_type = 'created'), 'creation recorded in history');

-- give the joiner a portal account (as the invite flow would)
select test.as_owner();
update public.hr_employees set user_id = test.create_user('jo.joiner@zyllo.test'), portal_access = true where id = pg_temp.id('join');

-- visibility
select pg_temp.as_k('out');
select test.eq(test.count_rows('select 1 from public.hr_onboarding_cases'), 0::bigint, 'unrelated employee sees no onboarding');
select test.throws($q$select public.hr_create_onboarding_case(pg_temp.id('wd'))$q$, 'employee cannot open onboarding', 'not allowed');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_onboarding_cases'), 1::bigint, 'manager sees the team joiner''s case');
select test.throws($q$select public.hr_complete_onboarding(pg_temp.id('case'))$q$, 'manager cannot complete onboarding', 'not allowed');
select pg_temp.as_k('join');
select test.eq(test.count_rows('select 1 from public.hr_onboarding_cases'), 0::bigint, 'joiner cannot read case rows (notes stay internal)');
select test.eq(jsonb_array_length(public.hr_my_lifecycle() -> 'onboarding' -> 'tasks'), 8, 'joiner sees only employee-visible tasks');
select test.ok(not ((public.hr_my_lifecycle() -> 'onboarding') ? 'notes'), 'portal payload has no HR notes');
select test.ok(not (public.hr_my_lifecycle() -> 'onboarding' -> 'tasks' -> 0 ? 'evidence_note'), 'portal payload has no evidence notes');
select test.throws($q$select public.hr_complete_onboarding_task(pg_temp.task('case', 'Company orientation'))$q$, 'joiner cannot tick HR tasks', 'Employee Portal');

-- =====================================================================
-- 2. Checklist rules
-- =====================================================================
select pg_temp.as_k('hr');
select public.hr_update_onboarding_case(pg_temp.id('case'), null, null, null, null, null, 'Prefers morning induction');
select test.throws($q$select public.hr_complete_onboarding(pg_temp.id('case'))$q$, 'completion needs joining recorded', 'joining');
select test.throws($q$select public.hr_set_joining_status(pg_temp.id('case'), 'joined', current_date + 3)$q$, 'joined date cannot be in the future', 'future');
select public.hr_set_joining_status(pg_temp.id('case'), 'joined', current_date);
select test.throws($q$select public.hr_complete_onboarding(pg_temp.id('case'))$q$, 'mandatory tasks block completion', 'mandatory tasks');
select test.throws($q$select public.hr_complete_onboarding_task(pg_temp.task('case', 'Required joining documents verified'))$q$,
  'documents task needs verified documents', 'not verified yet');
select test.throws($q$select public.hr_complete_onboarding_task(pg_temp.task('case', 'Security and confidentiality acknowledgement'))$q$,
  'HR cannot tick an acknowledgement for the employee', 'acknowledge');
select test.throws($q$select public.hr_complete_onboarding_task(pg_temp.task('case', 'IT account setup'))$q$, 'evidence required', 'evidence');
select public.hr_complete_onboarding_task(pg_temp.task('case', 'IT account setup'), 'Email jo.joiner@zyllo.test and SSO created');
select test.throws($q$select public.hr_complete_onboarding_task(pg_temp.task('case', 'Equipment allocation'))$q$, 'equipment needs a link or a note', 'Link the assigned equipment');
insert into public.hr_assets (asset_tag, asset_type) values ('M4-LAP-1', 'Laptop');
do $$ begin
  insert into t_ids values ('lap', public.hr_assign_asset((select id from public.hr_assets where asset_tag = 'M4-LAP-1'), pg_temp.id('join')));
end $$;
select public.hr_link_onboarding_task(pg_temp.task('case', 'Equipment allocation'), pg_temp.id('lap'));
-- [142] the linked equipment counts only after the joiner acknowledged the handover
select test.throws($q$select public.hr_complete_onboarding_task(pg_temp.task('case', 'Equipment allocation'))$q$,
  'equipment task waits for the handover acknowledgement (142)', 'not acknowledged the equipment handover');
select pg_temp.as_k('join');
select public.hr_acknowledge_asset(pg_temp.id('lap'));
select pg_temp.as_k('hr');
select test.eq((select status from public.hr_asset_handovers where assignment_id = pg_temp.id('lap')), 'acknowledged', 'joiner acknowledged the handover (141)');
select public.hr_complete_onboarding_task(pg_temp.task('case', 'Equipment allocation'));
select test.eq((select status from public.hr_onboarding_tasks where id = pg_temp.task('case', 'Equipment allocation')), 'completed', 'equipment task completed via Assets link');

-- training link + sync
select test.as_owner();
insert into public.hr_training_courses (code, title) values ('M4-IND', 'Synthetic induction');
select pg_temp.as_k('hr');
select public.hr_link_onboarding_task(pg_temp.task('case', 'Induction sessions completed'), null, (select id from public.hr_training_courses where code = 'M4-IND'));
insert into t_ids select 'trn', training_assignment_id from public.hr_onboarding_tasks where id = pg_temp.task('case', 'Induction sessions completed');
select test.ok(pg_temp.id('trn') is not null, 'training link creates a Training assignment');
select test.throws($q$select public.hr_complete_onboarding_task(pg_temp.task('case', 'Induction sessions completed'))$q$, 'training task waits for the training', 'not completed');
select public.hr_complete_training(pg_temp.id('trn'), current_date, 'attended');
select test.eq((select status from public.hr_onboarding_tasks where id = pg_temp.task('case', 'Induction sessions completed')), 'completed',
  'completing the training completes the onboarding task');

-- employee acknowledgement
select pg_temp.as_k('out');
select test.throws($q$select public.hr_acknowledge_onboarding_task(pg_temp.task('case', 'Security and confidentiality acknowledgement'))$q$, 'others cannot acknowledge', 'not found');
select test.throws($q$select public.hr_complete_onboarding_task(pg_temp.task('case', 'Company orientation'))$q$, 'outsider cannot complete tasks', 'not found');
select pg_temp.as_k('join');
select public.hr_acknowledge_onboarding_task(pg_temp.task('case', 'Security and confidentiality acknowledgement'));
select test.ok((select status = 'completed' and acknowledged_at is not null from public.hr_onboarding_tasks
                where id = pg_temp.task('case', 'Security and confidentiality acknowledgement')), 'acknowledgement recorded');
select test.throws($q$select public.hr_acknowledge_onboarding_task(pg_temp.task('case', 'Company orientation'))$q$, 'only acknowledgement items', 'does not need');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where action = 'ONBOARDING_ACKNOWLEDGED' and record_id = pg_temp.task('case', 'Security and confidentiality acknowledgement')::text),
  'acknowledgement audited');

-- employee document upload notifies HR; verification by HR
select pg_temp.as_k('join');
do $$ begin
  insert into t_ids values ('doc', (public.hr_register_document_upload(pg_temp.id('join'), 'id_proof', 'Passport', 'passport.pdf', 'application/pdf', 1024) ->> 'document_id')::uuid);
end $$;
select test.as_owner();
select test.ok(not exists (select 1 from public.hr_notifications where type = 'document_uploaded' and entity_id = pg_temp.id('doc')::text),
  'no HR notification before the file is stored (same point as module 9)');
insert into storage.objects (bucket_id, name)
select 'hr-documents', v.storage_path from public.hr_document_versions v where v.document_id = pg_temp.id('doc');
select test.eq((select count(*) from public.hr_notifications where type = 'document_uploaded' and entity_id = pg_temp.id('doc')::text
                and recipient_user_id = test.user_of(pg_temp.id('hr'))), 1::bigint, 'HR notified exactly once when the joiner''s file lands');
select test.ok(not exists (select 1 from public.hr_notifications where type = 'document_uploaded' and entity_id = pg_temp.id('doc')::text
                           and recipient_user_id = test.user_of(pg_temp.id('join'))), 'uploader not notified of own upload');
select pg_temp.as_k('hr');
select test.ok(exists (select 1 from jsonb_array_elements(public.hr_onboarding_document_queue()) q where (q ->> 'employee_id')::uuid = pg_temp.id('join') and (q ->> 'pending')::int = 1),
  'document queue shows the pending upload');
select public.hr_verify_document(pg_temp.id('doc'), true);
select test.as_owner();
select test.ok(hr_lifecycle_internal.onboarding_missing_documents(pg_temp.id('join')) not like '%ID proof%', 'verified document leaves the missing list');
select pg_temp.as_k('hr');
select public.hr_waive_onboarding_task(pg_temp.task('case', 'Required joining documents verified'), 'Remaining originals collected on paper');
select test.ok(exists (select 1 from public.hr_audit_log where action = 'ONBOARDING_MANDATORY_TASK_WAIVED'), 'waiving a mandatory task is audited');

-- manager-owned task by the line manager
select pg_temp.as_k('mgr');
select public.hr_complete_onboarding_task(pg_temp.task('case', 'Meet the reporting manager and team'), 'Team lunch done');
select test.throws($q$select public.hr_complete_onboarding_task(pg_temp.task('case', 'Company orientation'))$q$, 'manager cannot complete HR tasks', 'not allowed');

-- completion -> Employee Management status
select pg_temp.as_k('hr');
select public.hr_complete_onboarding_task(pg_temp.task('case', 'Company orientation'));
select public.hr_complete_onboarding_task(pg_temp.task('case', 'HR policy briefing'));
select public.hr_complete_onboarding(pg_temp.id('case'), 'All set');
select test.ok((select c.status = 'completed' and e.status = 'probation' from public.hr_onboarding_cases c join public.hr_employees e on e.id = c.employee_id
                where c.id = pg_temp.id('case')), 'completed onboarding moves the employee to probation');
select test.throws($q$select public.hr_add_onboarding_task(pg_temp.id('case'), 'Late task')$q$, 'completed case is closed', 'open onboarding');
select test.as_owner();
select test.ok(to_regclass('public.hr_employee_change_events') is null
               or exists (select 1 from public.hr_employee_change_events where employee_id = pg_temp.id('join') and category = 'probation_start'),
  'employment change event recorded (module 2 installed)');
select test.ok(to_regclass('public.hr_employee_change_events') is null
               or exists (select 1 from public.hr_employee_history where employee_id = pg_temp.id('join') and change_type = 'status' and event_id is not null),
  'status history row linked to the change event');

-- =====================================================================
-- 3. Probation
-- =====================================================================
select test.as_owner();
update public.hr_employees set status = 'probation', probation_end_date = current_date + 5 where id in (pg_temp.id('prob'), pg_temp.id('prob2'));
select pg_temp.as_k('mgr');
select test.throws($q$select public.hr_generate_probation_reviews(14)$q$, 'manager cannot generate reviews', 'not allowed');
select pg_temp.as_k('hr');
select test.ok((public.hr_generate_probation_reviews(14) ->> 'opened')::int >= 2, 'reminder run opens reviews for probations ending soon');
select test.eq((public.hr_generate_probation_reviews(14) ->> 'opened')::int, 0, 'reminder run is idempotent');
insert into t_ids select 'rv', id from public.hr_probation_reviews where employee_id = pg_temp.id('prob') and status = 'pending_manager';
insert into t_ids select 'rv2', id from public.hr_probation_reviews where employee_id = pg_temp.id('prob2') and status = 'pending_manager';
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where type = 'probation' and entity_id = pg_temp.id('rv')::text
                       and recipient_user_id = test.user_of(pg_temp.id('mgr'))), 'manager reminded to review');
select pg_temp.as_k('prob');
select test.eq(test.count_rows('select 1 from public.hr_probation_reviews'), 0::bigint, 'employee cannot read their probation review');
select test.throws($q$select public.hr_submit_probation_feedback(pg_temp.id('rv'), 5, 'confirm', 'I am doing great work')$q$, 'no self review', 'not found');
select pg_temp.as_k('out');
select test.eq(test.count_rows('select 1 from public.hr_probation_reviews'), 0::bigint, 'outsider cannot read probation reviews');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_decide_probation(pg_temp.id('rv'), 'confirmed', 'Good')$q$, 'HR decision waits for manager feedback', 'manager');
select pg_temp.as_k('mgr');
select public.hr_submit_probation_feedback(pg_temp.id('rv'), 3, 'extend', 'Needs more time on code reviews');
select test.throws($q$select public.hr_decide_probation(pg_temp.id('rv'), 'confirmed', 'Good')$q$, 'manager cannot decide', 'not allowed');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_decide_probation(pg_temp.id('rv'), 'extended', 'More time')$q$, 'extension needs a later date', 'after the current end');
select public.hr_decide_probation(pg_temp.id('rv'), 'extended', 'Agreed with manager', null, current_date + 60, null, 'Review again in two months');
select test.ok((select probation_end_date = current_date + 60 and status = 'probation' from public.hr_employees where id = pg_temp.id('prob')),
  'extension updates the employee record');
insert into t_ids select 'rv3', id from public.hr_probation_reviews where employee_id = pg_temp.id('prob') and status in ('pending_manager','pending_hr');
select test.ok((select review_type = 'extension' and due_date = current_date + 60 from public.hr_probation_reviews where id = pg_temp.id('rv3')),
  'a follow-up review is opened for the extended date');
select public.hr_submit_probation_feedback(pg_temp.id('rv3'), 4, 'confirm', 'Recorded by HR after the manager meeting');
select test.ok(exists (select 1 from public.hr_probation_events where review_id = pg_temp.id('rv3') and event_type = 'feedback_by_hr'), 'feedback on behalf is labelled');
select public.hr_decide_probation(pg_temp.id('rv3'), 'confirmed', 'Met expectations');
select test.ok((select status = 'active' and confirmation_date = current_date from public.hr_employees where id = pg_temp.id('prob')),
  'confirmation activates the employee and sets the confirmation date');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where action = 'PROBATION_CONFIRMED' and record_id = pg_temp.id('rv3')::text), 'decision audited');
select test.ok(to_regclass('public.hr_employee_change_events') is null
               or exists (select 1 from public.hr_employee_change_events where employee_id = pg_temp.id('prob') and category = 'confirmation'),
  'confirmation recorded as an employment change');
select pg_temp.as_k('prob');
select test.eq(public.hr_my_lifecycle() -> 'probation' -> 'last_decision' ->> 'decision', 'confirmed', 'employee sees the decision');
select test.ok(not ((public.hr_my_lifecycle() -> 'probation') ? 'manager_feedback'), 'employee does not see manager feedback');
-- early termination
select pg_temp.as_k('mgr');
select public.hr_submit_probation_feedback(pg_temp.id('rv2'), 1, 'terminate', 'Repeated attendance problems');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_decide_probation(pg_temp.id('rv2'), 'terminated', 'Not suitable')$q$, 'termination needs a last working day', 'last working day');
select public.hr_decide_probation(pg_temp.id('rv2'), 'terminated', 'Not suitable for the role', null, null, current_date + 7);
select test.ok((select x.exit_type = 'termination' and x.status = 'notice_period' and r.decision = 'terminated'
                from public.hr_probation_reviews r join public.hr_exits x on x.id = r.exit_id where r.id = pg_temp.id('rv2')),
  'early termination opens an Exit case');

-- =====================================================================
-- 4. Resignation withdrawal policy
-- =====================================================================
select test.as_owner();
update public.hr_settings set value = jsonb_set(value, '{resignation_withdrawal}', '"never"') where key = 'lifecycle';
select pg_temp.as_k('wd');
do $$ begin insert into t_ids values ('xw', public.hr_submit_resignation('Moving abroad', current_date + 30)); end $$;
select test.eq(public.hr_my_lifecycle() -> 'exit' ->> 'request_status', 'under_review', 'portal maps hr_review to Under Review');
select test.ok(not (public.hr_my_lifecycle() -> 'exit' ->> 'can_withdraw')::boolean, 'portal knows withdrawal is not allowed');
select test.throws($q$select public.hr_withdraw_resignation(pg_temp.id('xw'))$q$, 'policy never: no withdrawal', 'does not allow');
select test.as_owner();
update public.hr_settings set value = jsonb_set(value, '{resignation_withdrawal}', '"before_clearance"') where key = 'lifecycle';
select pg_temp.as_k('hr');
select public.hr_hr_review_exit(pg_temp.id('xw'), true, current_date + 30, 'Accepted');
select pg_temp.as_k('wd');
select test.eq(public.hr_my_lifecycle() -> 'exit' ->> 'request_status', 'approved', 'portal maps notice period to Approved');
select public.hr_withdraw_resignation(pg_temp.id('xw'), 'Staying after all');
select test.ok((select x.status = 'withdrawn' and e.status = 'active' from public.hr_exits x join public.hr_employees e on e.id = x.employee_id
                where x.id = pg_temp.id('xw')), 'policy before_clearance: withdrawal during notice restores status');
select test.as_owner();
update public.hr_settings set value = jsonb_set(value, '{resignation_withdrawal}', '"before_hr_approval"') where key = 'lifecycle';

-- =====================================================================
-- 5. Clearance, exceptions, access revocation
-- =====================================================================
select pg_temp.as_k('leaver');
do $$ begin insert into t_ids values ('xl', public.hr_submit_resignation('New opportunity', current_date + 3)); end $$;
select test.eq((select status from public.hr_employees where id = pg_temp.id('leaver')), 'active', 'submitting a resignation does not deactivate');
select pg_temp.as_k('mgr');
select public.hr_manager_review_exit(pg_temp.id('xl'), true, 'Handover planned');
select pg_temp.as_k('hr');
select public.hr_hr_review_exit(pg_temp.id('xl'), true, current_date + 3, 'Accepted');
select public.hr_start_exit_clearance(pg_temp.id('xl'));
select test.eq((select count(*) from public.hr_exit_clearance_items where exit_id = pg_temp.id('xl')), 9::bigint, 'nine clearance items incl. IT clearance');
select test.ok((select department = 'IT' and due_date = current_date + 3 from public.hr_exit_clearance_items where id = pg_temp.item('xl','it_clearance')),
  'items carry department owner and due date');
select test.ok((select assignee_employee_id = pg_temp.id('mgr') from public.hr_exit_clearance_items where id = pg_temp.item('xl','project_handover')),
  'handover items assigned to the line manager');

select pg_temp.as_k('leaver');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('xl','project_handover'), 'completed')$q$, 'leaver cannot clear own items', 'your own exit');
select test.ok(not ((public.hr_my_lifecycle() -> 'exit' -> 'clearance' -> 0) ? 'note'), 'portal clearance has no internal notes');
select pg_temp.as_k('out');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('xl','hr_clearance'), 'completed')$q$, 'outsider cannot clear', 'not allowed');
select pg_temp.as_k('it');
select test.eq(test.count_rows('select 1 from public.hr_exits'), 1::bigint, 'IT owner sees exits to clear');
select public.hr_complete_clearance_item(pg_temp.item('xl','it_clearance'), 'completed', 'Accounts disabled, licences reclaimed');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('xl','hr_clearance'), 'completed')$q$, 'IT cannot clear HR items', 'not allowed');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('xl','it_clearance'), 'pending')$q$, 'only HR reopens', 'Only HR');
select pg_temp.as_k('mgr');
select public.hr_complete_clearance_item(pg_temp.item('xl','project_handover'), 'completed', 'Handed to the team');
select public.hr_complete_clearance_item(pg_temp.item('xl','document_handover'), 'completed');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('xl','payroll_clearance'), 'completed')$q$, 'manager cannot clear finance', 'not allowed');
select pg_temp.as_k('pay1');
select public.hr_complete_clearance_item(pg_temp.item('xl','payroll_clearance'), 'completed', 'No advances outstanding');

-- access revocation: timing policy, no silent skip, failure, exception
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_can_revoke_exit_access(pg_temp.id('xl'))$q$, 'revocation waits for the last working day', 'on or after the last working day');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('xl','access_revocation'), 'not_applicable', 'skip')$q$,
  'access revocation cannot be skipped while an account exists', 'not been revoked');
select test.as_owner();
update public.hr_settings set value = jsonb_set(value, '{access_revocation_timing}', '"from_clearance"') where key = 'lifecycle';
select pg_temp.as_k('it');
select test.eq((public.hr_can_revoke_exit_access(pg_temp.id('xl')) ->> 'user_id')::uuid, test.user_of(pg_temp.id('leaver')), 'IT owner may run the revocation pre-flight');
select test.throws($q$select public.hr_record_access_revocation_failure(pg_temp.id('xl'), 'x')$q$, 'failure RPC is service-only', 'permission denied');
select test.as_service();
select public.hr_record_access_revocation_failure(pg_temp.id('xl'), 'Auth admin API unavailable');
select pg_temp.as_k('hr');
select test.ok((select access_revocation_status = 'failed' and access_revocation_error like 'Auth admin%' from public.hr_exits where id = pg_temp.id('xl')),
  'failed revocation is a visible state');
select test.eq(test.count_rows($q$select 1 from public.hr_exit_access_revocations where exit_id = pg_temp.id('xl') and outcome = 'failed'$q$), 1::bigint, 'attempt recorded');
select test.throws($q$select public.hr_grant_clearance_exception(pg_temp.item('xl','access_revocation'), 'Auth outage, revoke manually later')$q$,
  'HR admin cannot grant exceptions by default', 'override');
select pg_temp.as_k('super');
select test.throws($q$select public.hr_grant_clearance_exception(pg_temp.item('xl','access_revocation'), 'short')$q$, 'exception needs a detailed reason', 'detail');
select public.hr_grant_clearance_exception(pg_temp.item('xl','access_revocation'), 'Auth outage; ticket IT-42 to ban manually; data access ends at closure');
select test.ok((select x.access_revocation_status = 'exception' and i.status = 'waived' and i.exception_reason like 'Auth outage%'
                from public.hr_exits x join public.hr_exit_clearance_items i on i.exit_id = x.id and i.item_key = 'access_revocation'
                where x.id = pg_temp.id('xl')), 'exception recorded on the item and the exit');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where action = 'CLEARANCE_EXCEPTION'), 'exception audited');

select pg_temp.as_k('hr');
select test.throws($q$select public.hr_move_exit_to_settlement(pg_temp.id('xl'))$q$, 'pending mandatory items block settlement', 'Complete these clearance items');
select public.hr_complete_clearance_item(pg_temp.item('xl','asset_return'), 'completed', 'Nothing assigned');
select public.hr_complete_clearance_item(pg_temp.item('xl','hr_clearance'), 'completed');
select public.hr_move_exit_to_settlement(pg_temp.id('xl'));

-- =====================================================================
-- 6. Full & final settlement
-- =====================================================================
select test.throws($q$select public.hr_prepare_settlement(pg_temp.id('xl'))$q$, 'HR admin cannot prepare settlements', 'not allowed');
select pg_temp.as_k('pay1');
do $$ begin insert into t_ids values ('fs', public.hr_prepare_settlement(pg_temp.id('xl'))); end $$;
select test.throws($q$select public.hr_prepare_settlement(pg_temp.id('xl'))$q$, 'one settlement per exit', 'already exists');
select test.ok(exists (select 1 from public.hr_payroll_settlement_lines where settlement_id = pg_temp.id('fs') and line_type = 'salary_due'),
  'salary due line prefilled');
select public.hr_save_settlement_line(pg_temp.id('fs'), null, 'other_earning', 'Pending salary (synthetic)', 5000);
select public.hr_save_settlement_line(pg_temp.id('fs'), null, 'asset_recovery', 'Lost charger', 1000);
select test.eq((select net_amount from public.hr_payroll_settlements where id = pg_temp.id('fs')), 4000.00::numeric, 'net = earnings - deductions');
select test.throws($q$select public.hr_save_settlement_line(pg_temp.id('fs'), null, 'other_earning', 'Negative', -5)$q$, 'no negative amounts', 'zero or more');
select test.throws($q$select public.hr_approve_settlement(pg_temp.id('fs'), true)$q$, 'draft cannot be approved', 'Only submitted');
select public.hr_submit_settlement(pg_temp.id('fs'));
select test.throws($q$select public.hr_save_settlement_line(pg_temp.id('fs'), null, 'bonus', 'Late bonus', 10)$q$, 'submitted settlement is locked', 'Only draft');

select pg_temp.as_k('hr');
select test.eq(test.count_rows('select 1 from public.hr_payroll_settlements'), 0::bigint, 'HR without payroll access cannot read settlements');
select test.ok(public.hr_exit_settlement_status(pg_temp.id('xl')) ->> 'status' = 'submitted' and not (public.hr_exit_settlement_status(pg_temp.id('xl')) ? 'net_amount'),
  'HR sees settlement progress without amounts');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('xl','final_settlement'), 'completed')$q$, 'item waits for approval', 'not been approved');
select pg_temp.as_k('leaver');
select test.eq(public.hr_my_lifecycle() -> 'settlement' ->> 'status', 'in_preparation', 'employee sees preparation status');
select test.ok(public.hr_my_lifecycle() -> 'settlement' -> 'net_amount' = 'null'::jsonb, 'no amount before approval');
select test.throws($q$select public.hr_settlement_statement(pg_temp.id('fs'))$q$, 'no statement before approval', 'not found');

select pg_temp.as_k('pay2');
select test.throws($q$select public.hr_approve_settlement(pg_temp.id('fs'), false)$q$, 'return needs a reason', 'Explain');
select public.hr_approve_settlement(pg_temp.id('fs'), false, 'Attach the charger invoice reference');
select pg_temp.as_k('pay1');
select public.hr_save_settlement_line(pg_temp.id('fs'), (select id from public.hr_payroll_settlement_lines where settlement_id = pg_temp.id('fs') and label = 'Lost charger'),
  'asset_recovery', 'Lost charger (invoice INV-7)', 1000);
select public.hr_submit_settlement(pg_temp.id('fs'));
select test.throws($q$select public.hr_approve_settlement(pg_temp.id('fs'), true)$q$, 'preparer cannot approve own settlement', 'different person');
select pg_temp.as_k('pay2');
select public.hr_approve_settlement(pg_temp.id('fs'), true, 'Checked against payroll');
select test.eq((select status from public.hr_exit_clearance_items where id = pg_temp.item('xl','final_settlement')), 'completed',
  'approval completes the final settlement clearance item');
select test.throws($q$select public.hr_mark_settlement_paid(pg_temp.id('fs'), '')$q$, 'payment needs a reference', 'reference');
select public.hr_mark_settlement_paid(pg_temp.id('fs'), 'NEFT-SYN-0001');
select test.eq((select status from public.hr_payroll_settlements where id = pg_temp.id('fs')), 'paid', 'payment recorded (no transfer made)');

select pg_temp.as_k('leaver');
select test.eq((public.hr_my_lifecycle() -> 'settlement' ->> 'net_amount')::numeric, 4000.00::numeric, 'employee sees the approved net amount');
select test.eq((public.hr_settlement_statement(pg_temp.id('fs')) ->> 'net_amount')::numeric, 4000.00::numeric, 'employee can open the statement');
select pg_temp.as_k('out');
select test.throws($q$select public.hr_settlement_statement(pg_temp.id('fs'))$q$, 'others cannot open the statement', 'not found');

-- payroll admin cannot approve their own settlement
select test.as_owner();
do $$
declare v_x uuid; v_s uuid;
begin
  insert into public.hr_exits (employee_id, initiated_by, exit_type, status, approved_last_working_day)
  values (pg_temp.id('pay2'), 'hr', 'resignation', 'final_settlement', current_date) returning id into v_x;
  insert into public.hr_payroll_settlements (exit_id, employee_id, status, prepared_by, submitted_by)
  values (v_x, pg_temp.id('pay2'), 'submitted', test.user_of(pg_temp.id('pay1')), test.user_of(pg_temp.id('pay1'))) returning id into v_s;
  insert into t_ids values ('fs_self', v_s);
end $$;
select pg_temp.as_k('pay2');
select test.throws($q$select public.hr_approve_settlement(pg_temp.id('fs_self'), true)$q$, 'no approving one''s own settlement', 'your own settlement');
select test.eq(test.count_rows('select 1 from public.hr_exits where employee_id = hr_private.current_employee_id()'), 1::bigint,
  'own exit still visible to self only via the self rule');

-- =====================================================================
-- 7. Closure (secure exit completion)
-- =====================================================================
select pg_temp.as_k('hr');
select public.hr_complete_clearance_item(pg_temp.item('xl','relieving_letter'), 'completed');
select test.throws($q$select public.hr_close_exit(pg_temp.id('xl'))$q$, 'cannot close before the last working day', 'last working day');
select test.as_owner();
update public.hr_exits set approved_last_working_day = current_date where id = pg_temp.id('xl');
select pg_temp.as_k('hr');
select public.hr_close_exit(pg_temp.id('xl'), 'F&F paid');
select test.ok((select status = 'exited' and not portal_access from public.hr_employees where id = pg_temp.id('leaver')), 'exit closed: employee exited, portal off');
select pg_temp.as_k('leaver');
select test.ok(hr_private.current_employee_id() is null, 'leaver loses data access at closure');
select test.as_owner();
select test.ok((select count(*) >= 1 from public.hr_payroll_settlements where exit_id = pg_temp.id('xl')), 'settlement history preserved');
select test.ok((select count(*) >= 9 from public.hr_exit_clearance_items where exit_id = pg_temp.id('xl')), 'clearance history preserved');

-- =====================================================================
-- 8. Overview counts are permission-scoped
-- =====================================================================
select pg_temp.as_k('hr');
select test.ok(public.hr_lifecycle_overview() ? 'onboarding_open' and not (public.hr_lifecycle_overview() ? 'settlements_awaiting_approval'),
  'HR overview has onboarding but no payroll counts');
select pg_temp.as_k('pay1');
select test.ok(public.hr_lifecycle_overview() ? 'settlements_awaiting_approval' and not (public.hr_lifecycle_overview() ? 'onboarding_open'),
  'payroll overview has settlement counts only');
select test.as_anon();
select test.throws($q$select public.hr_lifecycle_overview()$q$, 'anon blocked', 'permission denied');

-- =====================================================================
-- 9. Internal helpers are not callable by signed-in users
-- =====================================================================
select pg_temp.as_k('out');
select test.throws($q$select hr_lifecycle_internal.settlement_daily_rate(pg_temp.id('pay1'))$q$, 'salary-derived helper not callable', 'permission denied');
select test.throws($q$select hr_lifecycle_internal.emp_name(pg_temp.id('pay1'))$q$, 'name lookup helper not callable', 'permission denied');
select test.throws($q$select hr_lifecycle_internal.onboarding_missing_documents(pg_temp.id('join'))$q$, 'document gap helper not callable', 'permission denied');
select test.throws($q$select hr_lifecycle_internal.onboarding_log(pg_temp.id('case'), 'forged', 'x')$q$, 'onboarding history cannot be forged', 'permission denied');
select test.throws($q$select hr_lifecycle_internal.onboarding_create_case(pg_temp.id('out'))$q$, 'case creation helper not callable', 'permission denied');
select test.throws($q$select hr_private.exit_log(pg_temp.id('xl'), 'forged', null, null, 'x')$q$, 'exit history cannot be forged (110 helper)', 'permission denied');
select test.throws($q$select hr_private.exit_notify(pg_temp.id('xl'), 'spam')$q$, 'exit notifications cannot be sent directly', 'permission denied');
select test.ok(hr_private.onboarding_can_view(pg_temp.id('join')) = false, 'RLS visibility check still callable (and false for an outsider)');
select pg_temp.as_k('join');
select test.ok(public.hr_my_lifecycle() ? 'missing_documents' and (public.hr_my_lifecycle() -> 'onboarding' ->> 'coordinator') is not null,
  'self-service RPC still uses the internal helpers (missing documents, names)');

-- Training module (207): catalogue RLS, programs, sessions + capacity /
-- waitlist, enrollment scope (HR anyone, manager reporting line, never
-- self), attendance, self-submitted completion -> verification (never by
-- the employee), return, certificates, renewals, onboarding integration,
-- privacy of enrollments.
-- Runs inside a transaction that the runner rolls back. Works on an empty
-- DB and on the seeded local harness (codes are prefixed T207-).

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.asg(p_emp text, p_course text) returns uuid language sql security definer as $$
  select id from public.hr_training_assignments where employee_id = (select v from t_ids where k = p_emp)
     and course_id = (select v from t_ids where k = p_course) order by (status in ('assigned','in_progress')) desc, created_at desc limit 1
$$;
create function pg_temp.enr(p_emp text, p_session text) returns uuid language sql security definer as $$
  select id from public.hr_training_enrollments where employee_id = (select v from t_ids where k = p_emp)
     and session_id = (select v from t_ids where k = p_session) and status <> 'cancelled'
$$;

do $$
begin
  insert into t_ids values ('hr',   test.make_employee('t207.hr@test.local', 'Hira', null, array['hr_admin','employee']));
  insert into t_ids values ('mgr',  test.make_employee('t207.mgr@test.local', 'Mani', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('t207.emp1@test.local', 'Anu', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('t207.emp2@test.local', 'Bala', null));
  insert into t_ids values ('emp3', test.make_employee('t207.emp3@test.local', 'Chitra', (select v from t_ids where k='mgr')));
end $$;

select test.ok((select count(*) >= 4 from public.hr_training_categories where code in ('onboarding','compliance','technical','soft_skills')), 'seeded categories kept');

-- ---- catalogue
select pg_temp.as_k('hr');
with x as (insert into public.hr_training_courses (code, title, category_id, validity_months, pass_score)
           values ('T207-SAFE', 'Fire safety', (select id from public.hr_training_categories where code = 'compliance'), 12, 60) returning id)
insert into t_ids select 'safe', id from x;
with x as (insert into public.hr_training_courses (code, title, delivery_mode) values ('T207-CLS', 'Classroom basics', 'classroom') returning id)
insert into t_ids select 'cls', id from x;
with x as (insert into public.hr_training_courses (code, title, validity_months) values ('T207-IND', 'Induction 207', 24) returning id)
insert into t_ids select 'ind', id from x;
with x as (insert into public.hr_training_trainers (external_name, organisation) values ('Rao Safety Academy', 'Rao Pvt Ltd') returning id)
insert into t_ids select 'trn_ext', id from x;
with x as (insert into public.hr_training_trainers (employee_id) values (pg_temp.id('mgr')) returning id)
insert into t_ids select 'trn_int', id from x;
select test.throws($q$insert into public.hr_training_trainers (employee_id, external_name) values (pg_temp.id('emp1'), 'Both')$q$, 'trainer is internal OR external', 'check constraint');
with x as (insert into public.hr_training_programs (code, title) values ('T207-PRG', 'New joiner program') returning id)
insert into t_ids select 'prg', id from x;
insert into public.hr_training_program_courses (program_id, course_id, sort_order) values (pg_temp.id('prg'), pg_temp.id('safe'), 1), (pg_temp.id('prg'), pg_temp.id('cls'), 2);
select pg_temp.as_k('mgr');
select test.throws($q$insert into public.hr_training_trainers (external_name) values ('Sneaky')$q$, 'manager cannot add trainers', 'row-level security');
select test.throws($q$insert into public.hr_training_programs (code, title) values ('T207-X', 'Manager program')$q$, 'manager cannot add programs', 'row-level security');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_training_programs where code = 'T207-PRG'$q$), 1::bigint, 'employee reads programs');
select test.eq(test.count_rows($q$select 1 from public.hr_training_trainers where id = pg_temp.id('trn_ext')$q$), 1::bigint, 'employee reads trainers');

-- ---- programs
select pg_temp.as_k('mgr');
select test.eq(public.hr_assign_training_program(pg_temp.id('prg'), array[pg_temp.id('emp1')], current_date + 30), 2, 'manager assigns a 2-course program to a team member');
select test.throws($q$select public.hr_assign_training_program(pg_temp.id('prg'), array[pg_temp.id('emp2')])$q$, 'manager cannot assign a program outside the team', 'reporting line');
select test.throws($q$select public.hr_assign_training_program(pg_temp.id('prg'), array[pg_temp.id('mgr')])$q$, 'manager cannot assign a program to self', 'reporting line');
select test.as_owner();
select test.ok((select bool_and(source = 'program' and program_id = pg_temp.id('prg')) from public.hr_training_assignments where employee_id = pg_temp.id('emp1')),
  'program assignments are tagged with the program');

-- ---- sessions
select pg_temp.as_k('mgr');
select test.throws($q$select public.hr_save_training_session(null, jsonb_build_object('course_id', pg_temp.id('cls'), 'session_date', current_date + 5, 'venue', 'Room 1'))$q$, 'manager cannot schedule sessions', 'not allowed');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_save_training_session(null, jsonb_build_object('course_id', pg_temp.id('cls'), 'session_date', current_date - 1, 'venue', 'Room 1'))$q$, 'session in the past rejected', 'past');
select test.throws($q$select public.hr_save_training_session(null, jsonb_build_object('course_id', pg_temp.id('cls'), 'session_date', current_date + 5))$q$, 'venue or link required', 'venue');
select test.throws($q$select public.hr_save_training_session(null, jsonb_build_object('course_id', pg_temp.id('cls'), 'session_date', current_date + 5, 'venue', 'R', 'start_time', '10:00', 'end_time', '09:00'))$q$, 'end after start', 'end time');
insert into t_ids select 'ses', public.hr_save_training_session(null, jsonb_build_object('course_id', pg_temp.id('cls'), 'session_date', current_date + 5,
  'start_time', '10:00', 'end_time', '12:00', 'venue', 'Guntur office, Room 1', 'capacity', 1, 'trainer_id', pg_temp.id('trn_ext')));
select test.throws($q$insert into public.hr_training_sessions (course_id, session_date) values (pg_temp.id('cls'), current_date + 9)$q$, 'no direct session inserts', 'permission denied');

-- ---- enrollment + capacity
select pg_temp.as_k('mgr');
select test.eq(public.hr_enroll_training_session(pg_temp.id('ses'), array[pg_temp.id('emp1')]) ->> 'enrolled', '1', 'manager enrolls a team member');
select test.throws($q$select public.hr_enroll_training_session(pg_temp.id('ses'), array[pg_temp.id('emp2')])$q$, 'manager cannot enroll outside the team', 'reporting line');
select pg_temp.as_k('hr');
select test.eq(public.hr_enroll_training_session(pg_temp.id('ses'), array[pg_temp.id('emp2')]) ->> 'waitlisted', '1', 'full session waitlists');
select test.ok((select source = 'session' and status = 'assigned' from public.hr_training_assignments where id = pg_temp.asg('emp2', 'cls')), 'enrollment creates the course assignment');
select test.eq(public.hr_enroll_training_session(pg_temp.id('ses'), array[pg_temp.id('emp2')]) ->> 'skipped', '1', 'enrolling twice is skipped');
select test.throws($q$select public.hr_save_training_session(pg_temp.id('ses'), jsonb_build_object('course_id', pg_temp.id('cls'), 'session_date', current_date + 5, 'venue', 'Room 1', 'capacity', 0))$q$, 'capacity must be positive', 'Capacity');
select test.throws($q$insert into public.hr_training_enrollments (session_id, employee_id) values (pg_temp.id('ses'), pg_temp.id('emp3'))$q$, 'no direct enrollment inserts', 'permission denied');
select pg_temp.as_k('emp2');
select test.throws($q$select public.hr_self_enroll_training_session(pg_temp.id('ses'))$q$, 'already enrolled (waitlist)', 'already enrolled');
select test.eq((select x ->> 'my_status' from jsonb_array_elements(public.hr_list_training_sessions()) x where (x ->> 'id')::uuid = pg_temp.id('ses')), 'waitlisted', 'session list shows own waitlist status');
select test.eq((select (x ->> 'seats_left')::int from jsonb_array_elements(public.hr_list_training_sessions()) x where (x ->> 'id')::uuid = pg_temp.id('ses')), 0, 'session list shows seats left');
select pg_temp.as_k('emp3');
select test.throws($q$select public.hr_self_enroll_training_session(pg_temp.id('ses'))$q$, 'self-enroll needs an assignment', 'not assigned');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_withdraw_training_enrollment(pg_temp.enr('emp2', 'ses'))$q$, 'cannot withdraw a colleague', 'not found');
select public.hr_withdraw_training_enrollment(pg_temp.enr('emp1', 'ses'), 'Clash');
select test.as_owner();
select test.eq((select status from public.hr_training_enrollments where id = pg_temp.enr('emp2', 'ses')), 'enrolled', 'withdrawal promotes the waitlist');
select pg_temp.as_k('mgr');
select public.hr_enroll_training_session(pg_temp.id('ses'), array[pg_temp.id('emp1')]);
select test.eq((select status from public.hr_training_enrollments where id = pg_temp.enr('emp1', 'ses')), 'waitlisted', 're-enrolment after withdrawal waits for a seat');

-- ---- privacy of enrollments
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_training_enrollments where session_id = pg_temp.id(''ses'')'), 2::bigint, 'employee sees only own enrollments (incl. withdrawn)');
select test.eq(test.count_rows('select 1 from public.hr_training_enrollments where employee_id = pg_temp.id(''emp2'')'), 0::bigint, 'employee cannot see a colleague''s enrollment');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_training_enrollments where employee_id = pg_temp.id(''emp2'')'), 0::bigint, 'manager cannot see enrollments outside the team');
select test.ok(test.count_rows('select 1 from public.hr_training_enrollments where employee_id = pg_temp.id(''emp1'')') >= 1, 'manager sees team enrollments');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_training_assignments where employee_id = pg_temp.id(''emp1'')'), 0::bigint, 'employee cannot see a colleague''s assignments');

-- ---- attendance (session today)
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_mark_training_attendance(pg_temp.id('ses'), jsonb_build_array(jsonb_build_object('enrollment_id', pg_temp.enr('emp2', 'ses'), 'status', 'attended')))$q$, 'attendance not before the session', 'on or after');
insert into t_ids select 'ses_today', public.hr_save_training_session(null, jsonb_build_object('course_id', pg_temp.id('cls'), 'session_date', current_date, 'meeting_url', 'https://meet.example.com/abc'));
select public.hr_enroll_training_session(pg_temp.id('ses_today'), array[pg_temp.id('emp2'), pg_temp.id('emp3')]);
select pg_temp.as_k('mgr');
select public.hr_enroll_training_session(pg_temp.id('ses_today'), array[pg_temp.id('emp1')]);
select test.throws($q$select public.hr_mark_training_attendance(pg_temp.id('ses_today'), jsonb_build_array(jsonb_build_object('enrollment_id', pg_temp.enr('emp2', 'ses_today'), 'status', 'attended')))$q$, 'manager cannot mark outside the team', 'reporting line');
select test.eq(public.hr_mark_training_attendance(pg_temp.id('ses_today'), jsonb_build_array(jsonb_build_object('enrollment_id', pg_temp.enr('emp1', 'ses_today'), 'status', 'attended')), true), 1, 'manager marks team attendance');
select test.as_owner();
select test.ok((select status = 'completed' and result = 'attended' and verified_at is not null and completion_source = 'manager'
                from public.hr_training_assignments where id = pg_temp.asg('emp1', 'cls')), 'attendance records a verified completion');
select pg_temp.as_k('emp3');
select test.throws($q$select public.hr_mark_training_attendance(pg_temp.id('ses_today'), jsonb_build_array(jsonb_build_object('enrollment_id', pg_temp.enr('emp3', 'ses_today'), 'status', 'attended')))$q$, 'employee cannot mark attendance', 'not allowed');
select pg_temp.as_k('hr');
select public.hr_mark_training_attendance(pg_temp.id('ses_today'), jsonb_build_array(jsonb_build_object('enrollment_id', pg_temp.enr('emp3', 'ses_today'), 'status', 'absent')));
select test.eq((select status from public.hr_training_enrollments where id = pg_temp.enr('emp3', 'ses_today')), 'absent', 'HR marks absence');

-- ---- self-submitted completion -> verification
select pg_temp.as_k('emp1');
select public.hr_start_training(pg_temp.asg('emp1', 'safe'));
select test.throws($q$select public.hr_submit_training_completion(pg_temp.asg('emp1', 'safe'), current_date, 'passed', 80)$q$, 'evidence required', 'evidence');
select test.throws($q$select public.hr_submit_training_completion(pg_temp.asg('emp1', 'safe'), current_date, 'passed', 40, 'Quiz done')$q$, 'pass mark enforced on submission', 'pass mark');
select pg_temp.as_k('emp2');
select test.throws($q$select public.hr_submit_training_completion(pg_temp.asg('emp1', 'safe'), current_date, 'passed', 80, 'x')$q$, 'cannot submit for a colleague', 'not found');
select pg_temp.as_k('emp1');
select public.hr_submit_training_completion(pg_temp.asg('emp1', 'safe'), current_date, 'passed', 80, 'Completed the online quiz');
select test.ok((select status = 'completed' and verified_at is null and completion_source = 'self' and submitted_at is not null
                   and certificate_expiry = (current_date + interval '12 months')::date
                from public.hr_training_assignments where id = pg_temp.asg('emp1', 'safe')), 'submission waits for verification');
select test.throws($q$select public.hr_review_training_completion(pg_temp.asg('emp1', 'safe'), true)$q$, 'employee cannot verify own completion', 'not allowed');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('mgr')) and type = 'training_verification'), 'manager notified to verify');
select pg_temp.as_k('emp2');
select test.throws($q$select public.hr_review_training_completion(pg_temp.asg('emp1', 'safe'), true)$q$, 'colleague cannot verify', 'not allowed');
select pg_temp.as_k('mgr');
select test.throws($q$select public.hr_review_training_completion(pg_temp.asg('emp1', 'safe'), false, '')$q$, 'return needs a reason', 'why');
select public.hr_review_training_completion(pg_temp.asg('emp1', 'safe'), false, 'Attach the quiz result screenshot');
select test.ok((select status = 'in_progress' and completion_date is null and result is null and review_note is not null
                from public.hr_training_assignments where id = pg_temp.asg('emp1', 'safe')), 'returned completion reopens the assignment');
select pg_temp.as_k('emp1');
select public.hr_submit_training_completion(pg_temp.asg('emp1', 'safe'), current_date, 'passed', 82, 'Screenshot shared with manager');
select pg_temp.as_k('mgr');
select public.hr_review_training_completion(pg_temp.asg('emp1', 'safe'), true, 'Looks good');
select test.ok((select verified_at is not null and reviewed_by = test.user_of(pg_temp.id('mgr')) from public.hr_training_assignments where id = pg_temp.asg('emp1', 'safe')),
  'manager verifies the team completion');
select test.throws($q$select public.hr_review_training_completion(pg_temp.asg('emp1', 'safe'), true)$q$, 'cannot verify twice', 'waiting for verification');

-- ---- certificates
select test.as_owner();
with x as (insert into public.hr_documents (employee_id, category_id, title)
           values (pg_temp.id('emp1'), (select id from public.hr_document_categories where code = 'training_certificate'), 'Fire safety certificate') returning id)
insert into t_ids select 'cert1', id from x;
with x as (insert into public.hr_documents (employee_id, category_id, title)
           values (pg_temp.id('emp2'), (select id from public.hr_document_categories where code = 'training_certificate'), 'Other') returning id)
insert into t_ids select 'cert2', id from x;
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_record_training_certificate(pg_temp.asg('emp1', 'safe'), pg_temp.id('cert2'))$q$, 'certificate must be the employee''s', 'same employee');
select public.hr_record_training_certificate(pg_temp.asg('emp1', 'safe'), pg_temp.id('cert1'), 'FS-2026-001', current_date - 10);
select test.ok((select certificate_document_id = pg_temp.id('cert1') and certificate_number = 'FS-2026-001'
                   and certificate_expiry = (current_date - 10 + interval '12 months')::date
                from public.hr_training_assignments where id = pg_temp.asg('emp1', 'safe')), 'certificate recorded with expiry from validity');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_record_training_certificate(pg_temp.asg('emp1', 'safe'), pg_temp.id('cert1'))$q$, 'employee cannot record own certificate via HR RPC', 'not allowed');

-- ---- renewals
select test.as_owner();
update public.hr_training_assignments set certificate_expiry = current_date + 10 where id = pg_temp.asg('emp1', 'safe');
insert into t_ids values ('old_safe', pg_temp.asg('emp1', 'safe'));
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_renew_training(pg_temp.id('old_safe'))$q$, 'employee cannot renew own training', 'never your own');
select pg_temp.as_k('hr');
select test.ok(public.hr_generate_training_renewals(30) >= 1, 'renewals generated for expiring certificates');
select test.ok((select source = 'renewal' and renewal_of = pg_temp.id('old_safe') and status = 'assigned'
                from public.hr_training_assignments where id = pg_temp.asg('emp1', 'safe')), 'renewal assignment linked to the old one');
select test.eq(public.hr_renew_training(pg_temp.id('old_safe')), pg_temp.asg('emp1', 'safe'), 'renew is idempotent while a renewal is open');
select test.eq(public.hr_generate_training_renewals(30), 0, 'no duplicate renewals');

-- ---- onboarding integration (115 + 130 tables, no second training system)
select test.as_owner();
with x as (insert into public.hr_onboarding_cases (employee_id, reporting_manager_id) values (pg_temp.id('emp3'), pg_temp.id('mgr')) returning id)
insert into t_ids select 'case', id from x;
with x as (insert into public.hr_onboarding_tasks (case_id, title, category, task_kind, due_date)
           values (pg_temp.id('case'), 'Induction 207', 'induction', 'training', current_date + 7) returning id)
insert into t_ids select 'otask', id from x;
select pg_temp.as_k('hr');
select public.hr_link_onboarding_task(pg_temp.id('otask'), null, pg_temp.id('ind'));
select test.as_owner();
select test.ok((select a.source = 'onboarding' from public.hr_training_assignments a join public.hr_onboarding_tasks t on t.training_assignment_id = a.id
                where t.id = pg_temp.id('otask')), 'onboarding-linked training appears as an onboarding assignment');
select pg_temp.as_k('emp3');
select test.eq(test.count_rows('select 1 from public.hr_training_assignments where course_id = pg_temp.id(''ind'')'), 1::bigint, 'joiner sees the induction assignment');
select public.hr_submit_training_completion(pg_temp.asg('emp3', 'ind'), current_date, 'attended', null, 'Attended induction day');
select test.as_owner();
select test.eq((select status from public.hr_onboarding_tasks where id = pg_temp.id('otask')), 'in_progress', 'unverified self-completion does not close the onboarding task');
select pg_temp.as_k('mgr');
select public.hr_review_training_completion(pg_temp.asg('emp3', 'ind'), true);
select test.as_owner();
select test.eq((select status from public.hr_onboarding_tasks where id = pg_temp.id('otask')), 'completed', 'verified completion closes the onboarding task');

-- ---- session status + audit
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_set_training_session_status(pg_temp.id('ses'), 'cancelled', '')$q$, 'cancel needs a reason', 'reason');
select public.hr_set_training_session_status(pg_temp.id('ses'), 'cancelled', 'Trainer unavailable');
select test.as_owner();
select test.eq((select count(*) from public.hr_training_enrollments where session_id = pg_temp.id('ses') and status in ('enrolled','waitlisted')), 0::bigint, 'cancelling a session releases every seat');
select test.ok(exists (select 1 from public.hr_audit_log where action = 'TRAINING_COMPLETION_VERIFIED'), 'verification audited');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_training_enrollments' and action = 'INSERT'), 'enrollments audited');
select test.as_anon();
select test.throws($q$select 1 from public.hr_training_sessions$q$, 'anon cannot read sessions', 'permission denied');
select test.throws($q$select public.hr_list_training_sessions()$q$, 'anon cannot list sessions', 'permission denied');

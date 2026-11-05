-- Recruitment & interns: openings, careers import, pipeline transitions,
-- candidate data protection, interviews/feedback, offers (CTC protection),
-- candidate -> employee and intern -> employee conversions.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select v from t_ids where k = p $$;
-- auth user of a fixture employee (precomputed: test.user_of runs under the current role's RLS)
create or replace function pg_temp.uid(p text) returns uuid language sql as $$ select v from t_ids where k = 'u:' || p $$;
create or replace function pg_temp.login(p text) returns void language sql as $$ select test.as_user(pg_temp.uid(p)) $$;

do $$
declare dep uuid; des uuid; p1 uuid;
begin
  insert into public.hr_departments (code, name) values ('ENG', 'Engineering') returning id into dep;
  insert into public.hr_designations (name, department_id) values ('Software Engineer', dep) returning id into des;
  insert into t_ids values ('dep', dep), ('des', des);
  insert into public.hr_roles (key, name) values ('recruit_viewer', 'Recruitment viewer');
  insert into public.hr_role_permissions values ('recruit_viewer', 'recruitment.view');
  insert into t_ids values ('hr',     test.make_employee('hr@test.local', 'Hira', null, array['hr_admin']));
  insert into t_ids values ('mgr',    test.make_employee('mgr@test.local', 'Mona', null, array['manager','employee'], 'full_time', dep));
  insert into t_ids values ('emp1',   test.make_employee('emp1@test.local', 'Eli', (select v from t_ids where k='mgr'), array['employee'], 'full_time', dep));
  insert into t_ids values ('emp2',   test.make_employee('emp2@test.local', 'Ezra', null, array['employee']));
  insert into t_ids values ('viewer', test.make_employee('viewer@test.local', 'Vik', null, array['recruit_viewer']));
  insert into t_ids values ('intern', test.make_employee('intern@test.local', 'Ira', (select v from t_ids where k='mgr'), array['intern'], 'intern', dep));

  -- Existing careers posting with two synthetic applications.
  insert into public.job_postings (title, department, employment_type, total_openings, status)
  values ('QA Engineer', 'Engineering', 'Full-time', 2, 'open') returning id into p1;
  insert into t_ids values ('p1', p1);
  insert into public.job_applications (job_id, full_name, email, resume_url, experience_years, status)
  values (p1, 'Alice Tester', 'alice@test.local', p1 || '/alice.pdf', 3, 'new'),
         (p1, 'Bob Sample', 'Bob@Test.Local', 'https://demo.supabase.co/storage/v1/object/public/resumes/' || p1 || '/bob.pdf', 1, 'shortlisted');
  insert into storage.buckets (id, name) values ('resumes', 'resumes') on conflict do nothing;
  insert into storage.objects (bucket_id, name) values ('resumes', p1 || '/alice.pdf'), ('resumes', p1 || '/bob.pdf');
  insert into t_ids select 'u:' || k, test.user_of(v) from t_ids where k in ('hr','mgr','emp1','emp2','viewer','intern');
end $$;

select test.ok(not exists (select 1 from pg_trigger where tgrelid in ('public.job_postings'::regclass, 'public.job_applications'::regclass)
                           and tgname like 'hr%'), 'no HR triggers added to public careers tables');

-- ---- anon and ordinary employees cannot touch recruitment
select test.as_anon();
select test.throws('select * from public.hr_candidates', 'anon cannot read candidates', 'permission denied');
select test.as_owner();
select pg_temp.login('emp2');
select test.throws($q$select public.hr_create_job_opening('Hacker role')$q$, 'employee cannot create openings', 'not allowed');
select test.throws($q$select public.hr_import_careers_applications((select v from t_ids where k='p1'))$q$, 'employee cannot import applications', 'not allowed');
select test.throws($q$insert into public.hr_candidates (full_name, email) values ('X', 'x@test.local')$q$, 'employee cannot insert candidates', 'row-level security');
select test.as_owner();

-- ---- HR: create & publish an opening, import careers applications
select pg_temp.login('hr');
insert into t_ids values ('o2', public.hr_create_job_opening('Backend Developer', pg_temp.id('dep'), 'full_time', 1, array['sql','node'],
  1, 4, 'Guntur', 'Build things', null, pg_temp.id('mgr'), true));
select test.ok((select j.status = 'open' and j.title = 'Backend Developer' and j.department = 'Engineering'
                from public.hr_job_openings o join public.job_postings j on j.id = o.job_id where o.id = pg_temp.id('o2')),
               'publishing an opening creates an open careers posting');
select test.eq((select status from public.hr_job_openings where id = pg_temp.id('o2')), 'open', 'published opening is open');
select test.throws($q$select public.hr_create_job_opening('Bad', null, 'nope')$q$, 'unknown employment type rejected', 'Unknown employment type');

select test.eq((public.hr_import_careers_applications(pg_temp.id('p1')) ->> 'imported')::int, 2, 'careers import creates two applications');
select test.eq((public.hr_import_careers_applications(pg_temp.id('p1')) ->> 'imported')::int, 0, 'careers import is idempotent');
select test.eq(test.count_rows('select 1 from public.hr_candidates'), 2::bigint, 'no duplicate candidates after re-import');
insert into t_ids select 'o1', id from public.hr_job_openings where job_id = pg_temp.id('p1');
select test.ok(pg_temp.id('o1') is not null, 'import created an HR opening linked to the posting');
insert into t_ids select 'a_alice', a.id from public.hr_candidate_applications a join public.hr_candidates c on c.id = a.candidate_id where c.email = 'alice@test.local';
insert into t_ids select 'a_bob',   a.id from public.hr_candidate_applications a join public.hr_candidates c on c.id = a.candidate_id where c.email = 'bob@test.local';
select test.eq((select stage from public.hr_candidate_applications where id = pg_temp.id('a_bob')), 'shortlisted', 'careers status mapped to HR stage');
select test.eq((select resume_path from public.hr_candidates where email = 'bob@test.local'), pg_temp.id('p1') || '/bob.pdf',
               'legacy public resume URL normalised to object path');
select test.eq((select source from public.hr_candidates where email = 'alice@test.local'), 'careers_site', 'imported candidate source is careers_site');

-- referral candidate on the new opening; duplicate per opening blocked
insert into t_ids values ('a_dana', public.hr_add_candidate(pg_temp.id('o2'), 'Dana Demo', 'dana@test.local', null, 'referral'));
select test.throws($q$select public.hr_add_candidate((select v from t_ids where k='o2'), 'Dana Again', 'DANA@test.local')$q$,
  'same candidate cannot be added twice to an opening', 'already in the pipeline');
select test.throws($q$insert into public.hr_candidate_applications (candidate_id, opening_id, stage)
                      select candidate_id, (select v from t_ids where k='o1'), 'selected' from public.hr_candidate_applications where id = (select v from t_ids where k='a_dana')$q$,
  'direct insert cannot skip the pipeline', 'row-level security');

-- ---- stage transitions
select test.throws($q$select public.hr_move_candidate_stage((select v from t_ids where k='a_dana'), 'interview')$q$, 'cannot jump applied -> interview', 'cannot move');
select test.throws($q$select public.hr_move_candidate_stage((select v from t_ids where k='a_dana'), 'joined')$q$, 'joined only via conversion', 'conversion');
select public.hr_move_candidate_stage(pg_temp.id('a_dana'), 'screening', 'Phone screen ok');
select public.hr_move_candidate_stage(pg_temp.id('a_dana'), 'shortlisted');
select test.eq(test.count_rows($q$select 1 from public.hr_candidate_stage_events where application_id = (select v from t_ids where k='a_dana')$q$), 3::bigint,
  'stage history recorded (applied, screening, shortlisted)');
select test.throws($q$update public.hr_candidate_applications set stage = 'selected' where id = (select v from t_ids where k='a_dana')$q$,
  'stage cannot be changed by direct update', 'permission denied');
select test.throws($q$select public.hr_move_candidate_stage((select v from t_ids where k='a_alice'), 'rejected')$q$, 'rejection needs a reason', 'reason');
select public.hr_move_candidate_stage(pg_temp.id('a_alice'), 'rejected', 'Not enough experience');
select test.eq((select rejected_reason from public.hr_candidate_applications where id = pg_temp.id('a_alice')), 'Not enough experience', 'rejection reason stored');

-- ---- interviews
insert into t_ids values ('i_dana', public.hr_schedule_interview(pg_temp.id('a_dana'), now() - interval '2 hours', array[pg_temp.id('emp1')]));
insert into t_ids values ('i_bob',  public.hr_schedule_interview(pg_temp.id('a_bob'),  now() - interval '2 hours', array[pg_temp.id('hr')]));
select test.eq((select stage from public.hr_candidate_applications where id = pg_temp.id('a_dana')), 'interview', 'scheduling moves shortlisted -> interview');
select test.throws($q$select public.hr_schedule_interview((select v from t_ids where k='a_alice'), now(), array[(select v from t_ids where k='emp1')])$q$,
  'rejected candidate cannot be interviewed', 'shortlisted');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = pg_temp.uid('emp1') and type = 'interview_assigned'),
  'interviewer notified');

-- ---- candidate data protection
select pg_temp.login('emp2');
select test.eq(test.count_rows('select 1 from public.hr_candidates'), 0::bigint, 'ordinary employee sees no candidates');
select test.eq(test.count_rows('select 1 from public.hr_candidate_applications'), 0::bigint, 'ordinary employee sees no applications');
select test.eq(test.count_rows('select 1 from public.hr_job_openings'), 0::bigint, 'ordinary employee sees no HR openings');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'resumes'$q$), 0::bigint, 'ordinary employee cannot read resumes');
select test.throws($q$select public.hr_get_application_offers((select v from t_ids where k='a_dana'))$q$, 'ordinary employee cannot list offers', 'not allowed');
select pg_temp.login('emp1');
select test.eq(test.count_rows('select 1 from public.hr_candidates'), 1::bigint, 'interviewer sees only the candidate they interview');
select test.eq(test.count_rows('select 1 from public.hr_candidate_applications'), 1::bigint, 'interviewer sees only that application');
select test.eq(test.count_rows('select 1 from public.hr_job_openings'), 1::bigint, 'interviewer sees that opening');
select pg_temp.login('mgr');
select test.eq(test.count_rows('select 1 from public.hr_candidates'), 1::bigint, 'hiring manager sees candidates of own opening only');
select pg_temp.login('hr');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'resumes'$q$), 2::bigint, 'recruiter can read resumes');
select test.as_owner();

-- ---- interview feedback
select pg_temp.login('emp2');
select test.throws($q$select public.hr_submit_interview_feedback((select v from t_ids where k='i_dana'), 5, 'strong_hire')$q$,
  'non-panel employee cannot submit feedback', 'Only interviewers');
select pg_temp.login('emp1');
select public.hr_submit_interview_feedback(pg_temp.id('i_dana'), 4, 'hire', 'Solid SQL', 'Limited cloud exposure');
select test.throws($q$select public.hr_submit_interview_feedback((select v from t_ids where k='i_dana'), 1, 'no_hire')$q$,
  'feedback can be submitted once', 'already submitted');
select test.throws($q$insert into public.hr_interview_feedback (interview_id, interviewer_id, rating, recommendation)
                      values ((select v from t_ids where k='i_dana'), (select v from t_ids where k='emp1'), 5, 'hire')$q$,
  'feedback cannot be inserted directly', 'permission denied');
select test.eq(test.count_rows('select 1 from public.hr_interview_feedback'), 1::bigint, 'interviewer sees own feedback');
select pg_temp.login('mgr');
select test.eq(test.count_rows('select 1 from public.hr_interview_feedback'), 1::bigint, 'hiring manager sees feedback for own opening');
select test.as_owner();
select test.eq((select status from public.hr_interviews where id = pg_temp.id('i_dana')), 'completed', 'feedback marks interview completed');

-- ---- offers
select pg_temp.login('hr');
select test.throws($q$select public.hr_create_offer((select v from t_ids where k='a_dana'))$q$, 'offer requires selected stage', 'selected');
select public.hr_move_candidate_stage(pg_temp.id('a_dana'), 'selected', 'Panel recommends hire');
insert into t_ids values ('f_dana', public.hr_create_offer(pg_temp.id('a_dana'), pg_temp.id('des'), null, null, current_date + 14, 900000));
select test.throws($q$select public.hr_create_offer((select v from t_ids where k='a_dana'))$q$, 'one active offer per application', 'active offer');
select test.throws($q$select public.hr_move_candidate_stage((select v from t_ids where k='a_dana'), 'offered')$q$, 'offered requires a sent offer', 'Send an offer');
select test.throws($q$select public.hr_convert_candidate_to_employee((select v from t_ids where k='a_dana'), 'dana@zyllo.test.local')$q$,
  'cannot convert before offer stage', 'Offered stage');
select public.hr_send_offer(pg_temp.id('f_dana'));
select test.eq((select stage from public.hr_candidate_applications where id = pg_temp.id('a_dana')), 'offered', 'sending offer moves candidate to offered');
select test.throws($q$select public.hr_convert_candidate_to_employee((select v from t_ids where k='a_dana'), 'dana@zyllo.test.local')$q$,
  'cannot convert without accepted offer', 'not accepted');
select test.eq((select annual_ctc from public.hr_offers where id = pg_temp.id('f_dana')), 900000.00::numeric, 'recruitment.manage reads offer CTC');
select pg_temp.login('viewer');
select test.eq(test.count_rows('select 1 from public.hr_candidates'), 3::bigint, 'recruitment.view sees all candidates');
select test.eq(test.count_rows('select 1 from public.hr_offers'), 0::bigint, 'recruitment.view cannot read offer rows (CTC)');
select test.ok((public.hr_get_application_offers(pg_temp.id('a_dana')) -> 0 ->> 'status') = 'sent'
               and (public.hr_get_application_offers(pg_temp.id('a_dana')) -> 0 -> 'annual_ctc') = 'null'::jsonb,
               'offer summary for viewers omits CTC');
select test.throws($q$select public.hr_send_offer((select v from t_ids where k='f_dana'))$q$, 'viewer cannot manage offers', 'not allowed');
select pg_temp.login('hr');
select public.hr_record_offer_response(pg_temp.id('f_dana'), 'accepted', 'Signed');

-- ---- candidate -> employee conversion
select pg_temp.login('mgr');
select test.throws($q$select public.hr_convert_candidate_to_employee((select v from t_ids where k='a_dana'), 'dana@zyllo.test.local')$q$,
  'manager without recruitment.convert cannot convert', 'not allowed');
select pg_temp.login('hr');
select test.throws($q$select public.hr_convert_candidate_to_employee((select v from t_ids where k='a_dana'), 'emp1@test.local')$q$,
  'duplicate company email rejected clearly', 'already used');
insert into t_ids values ('e_dana', public.hr_convert_candidate_to_employee(pg_temp.id('a_dana'), 'dana@zyllo.test.local', null, null, null, pg_temp.id('mgr')));
select test.ok((select source = 'candidate' and source_ref = pg_temp.id('a_dana') and employee_code ~ '^ZT-\d{4}$'
                       and first_name = 'Dana' and last_name = 'Demo' and designation_id = pg_temp.id('des')
                       and joining_date = current_date + 14 and employment_type = 'full_time'
                from public.hr_employees where id = pg_temp.id('e_dana')), 'employee created from candidate with offer defaults');
select test.eq((select stage from public.hr_candidate_applications where id = pg_temp.id('a_dana')), 'joined', 'candidate moved to joined');
select test.throws($q$select public.hr_convert_candidate_to_employee((select v from t_ids where k='a_dana'), 'dana2@zyllo.test.local')$q$,
  'second conversion fails clearly', 'already been converted');
select test.eq(test.count_rows($q$select 1 from public.hr_employees where source = 'candidate'$q$), 1::bigint, 'no duplicate employee from candidate');
select test.ok(exists (select 1 from public.hr_employee_history where employee_id = pg_temp.id('e_dana') and change_type = 'conversion'),
  'conversion recorded in employee history');

-- intern hire: conversion creates an internship
select public.hr_move_candidate_stage(pg_temp.id('a_bob'), 'selected');
insert into t_ids values ('f_bob', public.hr_create_offer(pg_temp.id('a_bob'), null, pg_temp.id('dep'), 'intern', current_date + 7, 120000));
select public.hr_send_offer(pg_temp.id('f_bob'));
select public.hr_record_offer_response(pg_temp.id('f_bob'), 'accepted');
insert into t_ids values ('e_bob', public.hr_convert_candidate_to_employee(pg_temp.id('a_bob'), 'bob@zyllo.test.local', null, null, null, pg_temp.id('mgr')));
select test.ok((select employment_type = 'intern' from public.hr_employees where id = pg_temp.id('e_bob')), 'intern hire has intern employment type');
select test.ok((select status = 'active' and mentor_id = pg_temp.id('mgr') and end_date > start_date
                from public.hr_internships where employee_id = pg_temp.id('e_bob')), 'intern hire gets an internship record');
select test.throws($q$update public.hr_internships set status = 'converted' where employee_id = (select v from t_ids where k='e_bob')$q$,
  'internship cannot be marked converted directly', 'conversion workflow');

-- closing the HR opening closes the careers posting (data only)
update public.hr_job_openings set status = 'closed' where id = pg_temp.id('o1');
select test.as_owner();
select test.eq((select status from public.job_postings where id = pg_temp.id('p1')), 'closed', 'closing HR opening closes careers posting');

-- ---- internships, mentors and evaluations
select pg_temp.login('emp1');
select test.throws($q$insert into public.hr_internships (employee_id, start_date) values ((select v from t_ids where k='intern'), current_date)$q$,
  'employee cannot create internships', 'row-level security');
select pg_temp.login('hr');
select test.throws($q$insert into public.hr_internships (employee_id, start_date) values ((select v from t_ids where k='emp2'), current_date)$q$,
  'internship requires an intern employee', 'intern employees');
insert into public.hr_internships (employee_id, mentor_id, start_date, end_date, project, certificate_eligible)
values (pg_temp.id('intern'), pg_temp.id('emp1'), current_date - 60, current_date + 120, 'Portal QA', true)
returning id as v \gset
insert into t_ids values ('ship', :'v');
select pg_temp.login('intern');
select test.eq(test.count_rows('select 1 from public.hr_internships'), 1::bigint, 'intern sees own internship');
select pg_temp.login('emp1');
select test.eq(test.count_rows('select 1 from public.hr_internships'), 1::bigint, 'mentor (not manager) sees mentee internship');
select pg_temp.login('emp2');
select test.eq(test.count_rows('select 1 from public.hr_internships'), 0::bigint, 'unrelated employee sees no internships');
select test.throws($q$insert into public.hr_intern_evaluations (internship_id, evaluator_id, period) values ((select v from t_ids where k='ship'), (select v from t_ids where k='emp2'), 'Month 1')$q$,
  'non-mentor cannot evaluate', 'row-level security');
select pg_temp.login('mgr');
select test.eq(test.count_rows('select 1 from public.hr_internships'), 2::bigint, 'manager sees team intern + mentee internship');

select pg_temp.login('emp1');
select test.throws($q$insert into public.hr_intern_evaluations (internship_id, evaluator_id, period, ratings) values ((select v from t_ids where k='ship'), (select v from t_ids where k='emp1'), 'Month 1', '{"technical": 7}')$q$,
  'ratings must be 1-5', 'check constraint');
insert into public.hr_intern_evaluations (internship_id, evaluator_id, period, ratings, comments)
values (pg_temp.id('ship'), pg_temp.id('emp1'), 'Month 1', '{"technical": 4, "communication": 5}', 'Good start');
select pg_temp.login('intern');
select test.eq(test.count_rows('select 1 from public.hr_intern_evaluations'), 0::bigint, 'intern cannot see draft evaluation');
select pg_temp.login('emp1');
update public.hr_intern_evaluations set status = 'finalized', overall_rating = 4.5, recommendation = 'convert' where internship_id = pg_temp.id('ship');
select test.throws($q$update public.hr_intern_evaluations set comments = 'edited' where internship_id = (select v from t_ids where k='ship')$q$,
  'finalized evaluation is immutable', 'cannot be changed');
select pg_temp.login('intern');
select test.eq(test.count_rows('select 1 from public.hr_intern_evaluations'), 1::bigint, 'intern sees finalized evaluation');
select test.throws($q$select public.hr_convert_intern_to_employee((select v from t_ids where k='ship'))$q$, 'intern cannot convert self', 'not allowed');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = pg_temp.uid('intern') and type = 'intern_evaluation'),
  'intern notified of finalized evaluation');

-- ---- intern -> employee conversion (same record)
select count(*) as n_before from public.hr_employees \gset
select pg_temp.login('hr');
select test.throws($q$select public.hr_convert_intern_to_employee((select v from t_ids where k='ship'), 'intern')$q$, 'target type must be non-intern', 'non-intern');
select test.eq(public.hr_convert_intern_to_employee(pg_temp.id('ship'), 'full_time', current_date, pg_temp.id('des')), pg_temp.id('intern'),
  'conversion returns the same employee id');
select test.throws($q$select public.hr_convert_intern_to_employee((select v from t_ids where k='ship'), 'full_time')$q$, 'second intern conversion fails', 'already been converted');
select test.as_owner();
select test.eq((select count(*) from public.hr_employees), :n_before::bigint, 'no duplicate employee created');
select test.ok((select employment_type = 'full_time' and status = 'probation' and probation_end_date = current_date + interval '6 months'
                       and designation_id = pg_temp.id('des')
                from public.hr_employees where id = pg_temp.id('intern')), 'employee type, probation and designation updated');
select test.ok(exists (select 1 from public.hr_employee_history where employee_id = pg_temp.id('intern') and change_type = 'conversion'
                       and old_value = 'intern' and new_value = 'full_time'), 'conversion history row written');
select test.ok(exists (select 1 from public.hr_employee_history where employee_id = pg_temp.id('intern') and change_type = 'employment_type'),
  'employment type change captured automatically');
select test.ok(not exists (select 1 from public.hr_user_roles where user_id = pg_temp.uid('intern') and role_key = 'intern')
               and exists (select 1 from public.hr_user_roles where user_id = pg_temp.uid('intern') and role_key = 'employee'),
  'intern role swapped for employee role');
select test.eq((select status from public.hr_internships where id = pg_temp.id('ship')), 'converted', 'internship marked converted');

-- ---- integration: mentor <-> intern employee visibility (policy hr_employees_read_mentor_links)
do $$
declare v_mentor uuid; v_intern uuid; v_other uuid; u_mentor uuid; u_intern uuid;
begin
  perform test.as_owner();
  v_mentor := test.make_employee('mentor.link@test.local', 'Mentor', null, array['employee']);
  v_intern := test.make_employee('intern.link@test.local', 'Intern', null, array['intern'], 'intern');
  v_other  := test.make_employee('other.link@test.local', 'Other', null, array['employee']);
  u_mentor := test.user_of(v_mentor); u_intern := test.user_of(v_intern);
  insert into public.hr_internships (employee_id, mentor_id, start_date) values (v_intern, v_mentor, current_date);
  perform test.as_user(u_mentor);
  perform test.eq(test.count_rows(format('select 1 from public.hr_employees where id = %L', v_intern)), 1::bigint, 'mentor (not manager) sees mentee employee record');
  perform test.eq(test.count_rows(format('select 1 from public.hr_employees where id = %L', v_other)), 0::bigint, 'mentor does not see unrelated employees');
  perform test.eq(test.count_rows(format('select 1 from public.hr_employee_private where employee_id = %L', v_intern)), 0::bigint, 'mentor cannot read mentee PII');
  perform test.as_owner();
  perform test.as_user(u_intern);
  perform test.eq(test.count_rows(format('select 1 from public.hr_employees where id = %L', v_mentor)), 1::bigint, 'intern sees their mentor');
  perform test.as_owner();
end $$;

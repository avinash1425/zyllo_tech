-- Recruitment & Hiring (120): job opening fields + status machine + reopen
-- permission, confidential salary data, applications (duplicates, assigned
-- recruiter), attachments + storage policies, screening, interview
-- reschedule/cancel history, evaluations (draft/submit/lock/re-open),
-- final decision, offer letter templates/versions/issue/email/expiry,
-- hire -> employee conversion, overview dashboard, role restrictions.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select v from t_ids where k = p $$;
create or replace function pg_temp.uid(p text) returns uuid language sql as $$ select v from t_ids where k = 'u:' || p $$;
create or replace function pg_temp.login(p text) returns void language sql as $$ select test.as_user(pg_temp.uid(p)) $$;

do $$
declare dep uuid; dep2 uuid; des uuid; des2 uuid;
begin
  insert into public.hr_departments (code, name) values ('ENG', 'Engineering') returning id into dep;
  insert into public.hr_departments (code, name) values ('OPS', 'Operations') returning id into dep2;
  insert into public.hr_designations (name, department_id) values ('Software Engineer', dep) returning id into des;
  insert into public.hr_designations (name, department_id) values ('Operations Associate', dep2) returning id into des2;
  insert into t_ids values ('dep', dep), ('dep2', dep2), ('des', des), ('des2', des2);
  insert into t_ids values ('hr',   test.make_employee('hr@test.local', 'Hira', null, array['hr_admin','employee']));
  insert into t_ids values ('rec',  test.make_employee('rec@test.local', 'Ravi', null, array['recruiter','employee']));
  insert into t_ids values ('hm',   test.make_employee('hm@test.local', 'Hema', null, array['manager','employee'], 'full_time', dep));
  insert into t_ids values ('arec', test.make_employee('arec@test.local', 'Asha', null, array['employee']));
  insert into t_ids values ('iv1',  test.make_employee('iv1@test.local', 'Ivan', null, array['employee'], 'full_time', dep));
  insert into t_ids values ('iv2',  test.make_employee('iv2@test.local', 'Isha', null, array['employee'], 'full_time', dep));
  insert into t_ids values ('emp',  test.make_employee('emp@test.local', 'Eli', null, array['employee']));
  insert into t_ids select 'u:' || k, test.user_of(v) from t_ids where k in ('hr','rec','hm','arec','iv1','iv2','emp');
end $$;

-- ---- roles and permissions
select test.ok(exists (select 1 from public.hr_roles where key = 'recruiter'), 'optional recruiter role exists');
select test.eq((select count(*) from public.hr_user_roles where role_key = 'recruiter' and user_id <> pg_temp.uid('rec')), 0::bigint,
  'migration assigns the recruiter role to nobody');
select test.ok(exists (select 1 from public.hr_role_permissions where role_key = 'hr_admin' and permission_key = 'recruitment.reopen'), 'HR admin can reopen openings');
select test.ok(not exists (select 1 from public.hr_role_permissions where role_key = 'recruiter' and permission_key in ('recruitment.reopen','recruitment.convert')),
  'recruiter cannot reopen openings or convert hires');

select test.as_anon();
select test.throws($q$select public.hr_recruitment_overview()$q$, 'anon cannot call recruitment RPCs', 'permission denied');
select test.throws($q$select * from public.hr_job_opening_compensation$q$, 'anon cannot read salary ranges', 'permission denied');
select test.as_owner();

-- ---- job openings: create with all fields
select pg_temp.login('emp');
select test.throws($q$select public.hr_save_job_opening(null, '{"title":"Hacker"}')$q$, 'employee cannot create openings', 'not allowed');
select test.as_owner();

select pg_temp.login('hr');
insert into t_ids values ('o1', public.hr_save_job_opening(null, jsonb_build_object(
  'title', 'Backend Developer', 'department_id', pg_temp.id('dep'), 'designation_id', pg_temp.id('des'), 'employment_type', 'full_time',
  'openings', 2, 'location', 'Guntur / Hybrid', 'description', 'Build APIs', 'qualifications', 'B.Tech or equivalent',
  'required_skills', jsonb_build_array('SQL', 'Node', 'SQL'), 'experience_min', 1, 'experience_max', 4,
  'closing_date', (current_date + 30)::text, 'hiring_manager_id', pg_temp.id('hm'), 'recruiter_id', pg_temp.id('arec'),
  'screening_questions', jsonb_build_array('Notice period?', 'Willing to relocate?'),
  'eligibility_criteria', jsonb_build_array('Degree', '1+ year SQL'),
  'salary_min', 600000, 'salary_max', 900000)));
select test.ok((select status = 'draft' and designation_id = pg_temp.id('des') and recruiter_id = pg_temp.id('arec')
                and required_skills = array['SQL','Node'] and cardinality(screening_questions) = 2 and qualifications is not null
                from public.hr_job_openings where id = pg_temp.id('o1')), 'new opening is a draft with all fields saved (skills deduplicated)');
select test.eq((select salary_max from public.hr_job_opening_compensation where opening_id = pg_temp.id('o1')), 900000::numeric(14,2), 'salary range stored');
select test.throws($q$select public.hr_save_job_opening(null, jsonb_build_object('title','Bad','department_id',pg_temp.id('dep'),'designation_id',pg_temp.id('des2')))$q$,
  'designation from another department rejected', 'another department');
select test.throws($q$select public.hr_save_job_opening(null, '{"title":"Bad","salary_min":5,"salary_max":1}')$q$, 'salary max below min rejected', 'at least the minimum');
select test.throws($q$select public.hr_save_job_opening(null, '{"title":"Bad","openings":0}')$q$, 'zero vacancies rejected', 'Vacancies');
select public.hr_save_job_opening(pg_temp.id('o1'), '{"openings": 3}');
select test.ok((select openings = 3 and title = 'Backend Developer' and recruiter_id = pg_temp.id('arec') from public.hr_job_openings where id = pg_temp.id('o1')),
  'editing changes only the keys sent');
select test.as_owner();

-- salary range is confidential
select pg_temp.login('hm');
select test.eq(test.count_rows('select 1 from public.hr_job_openings'), 1::bigint, 'hiring manager sees the opening');
select test.eq(test.count_rows('select 1 from public.hr_job_opening_compensation'), 0::bigint, 'hiring manager cannot see the salary range');
select test.as_owner();
select pg_temp.login('emp');
select test.eq(test.count_rows('select 1 from public.hr_job_openings'), 0::bigint, 'ordinary employee cannot see openings');
select test.as_owner();

-- ---- status machine, reopen permission, history
select pg_temp.login('hr');
select test.throws($q$select public.hr_set_job_opening_status(pg_temp.id('o1'), 'on_hold', 'x')$q$, 'draft cannot go on hold', 'cannot move');
select public.hr_set_job_opening_status(pg_temp.id('o1'), 'open');
select test.ok((select status = 'open' and posting_date is not null and job_id is null from public.hr_job_openings where id = pg_temp.id('o1')),
  'opening a job does not publish it to the careers site');
select test.throws($q$select public.hr_set_job_opening_status(pg_temp.id('o1'), 'on_hold')$q$, 'hold needs a reason', 'reason');
select public.hr_set_job_opening_status(pg_temp.id('o1'), 'on_hold', 'Budget review');
select public.hr_set_job_opening_status(pg_temp.id('o1'), 'open');
insert into t_ids values ('o2', public.hr_save_job_opening(null, jsonb_build_object('title', 'Operations Associate', 'department_id', pg_temp.id('dep2'),
  'designation_id', pg_temp.id('des2'), 'hiring_manager_id', pg_temp.id('hm'))));
select public.hr_set_job_opening_status(pg_temp.id('o2'), 'open');
select public.hr_set_job_opening_status(pg_temp.id('o2'), 'closed', 'Position cancelled');
select test.throws($q$select public.hr_save_job_opening(pg_temp.id('o2'), '{"title":"Renamed"}')$q$, 'closed opening cannot be edited', 'Reopen it first');
select test.throws($q$update public.hr_job_openings set status = 'open' where id = pg_temp.id('o2')$q$, 'direct reopen without reason refused', 'reason');
select test.as_owner();
select pg_temp.login('rec');
select test.throws($q$select public.hr_set_job_opening_status(pg_temp.id('o2'), 'open', 'Back on')$q$, 'recruiter without reopen permission cannot reopen', 'not allowed to reopen');
select test.as_owner();
select pg_temp.login('hr');
select test.throws($q$select public.hr_set_job_opening_status(pg_temp.id('o2'), 'open')$q$, 'reopen needs a reason', 'reason');
select public.hr_set_job_opening_status(pg_temp.id('o2'), 'open', 'Budget approved again');
select test.ok((select status = 'open' and reopened_at is not null and closed_at is null from public.hr_job_openings where id = pg_temp.id('o2')), 'HR admin reopened the opening');
select test.eq(test.count_rows($q$select 1 from public.hr_job_opening_status_events where opening_id = pg_temp.id('o2')$q$), 4::bigint,
  'status history: draft, open, closed, reopened');
select test.eq((select reason from public.hr_job_opening_status_events where opening_id = pg_temp.id('o2') and from_status = 'closed'),
  'Budget approved again', 'reopen reason recorded');
select test.throws($q$select public.hr_set_job_opening_status(pg_temp.id('o2'), 'draft')$q$, 'cannot go back to draft', 'Unknown job opening status');

-- ---- applications
insert into t_ids values ('a1', public.hr_add_application(pg_temp.id('o1'), jsonb_build_object(
  'full_name', 'Cara Candidate', 'email', 'Cara@Example.com', 'phone', '+91 90000 00001', 'source', 'job_portal',
  'experience_years', 3, 'skills', jsonb_build_array('SQL', 'Go'), 'qualifications', 'B.Sc', 'current_location', 'Vijayawada',
  'notice_period_days', 30, 'expected_salary', 800000, 'current_salary', 600000, 'applied_on', (current_date - 2)::text)));
select test.ok((select a.applied_on = current_date - 2 and a.source = 'job_portal' and c.notice_period_days = 30 and c.current_location = 'Vijayawada'
                and c.email = 'cara@example.com' and c.skills = array['SQL','Go']
                from public.hr_candidate_applications a join public.hr_candidates c on c.id = a.candidate_id where a.id = pg_temp.id('a1')),
  'application stores date, source, skills, location, notice period');
select test.throws($q$select public.hr_add_application(pg_temp.id('o1'), '{"full_name":"Cara again","email":"CARA@example.com"}')$q$,
  'duplicate application for the same job blocked', 'already applied');
insert into t_ids values ('a1b', public.hr_add_application(pg_temp.id('o2'), '{"full_name":"Cara Candidate","email":"cara@example.com"}'));
select test.eq((select count(*) from public.hr_candidates where email = 'cara@example.com'), 1::bigint,
  'same person can apply to another job without a duplicate candidate');
select test.throws($q$select public.hr_add_application(pg_temp.id('o1'), jsonb_build_object('full_name','Future','email','f@example.com','applied_on',(current_date+3)::text))$q$,
  'future application date rejected', 'future');
insert into t_ids values ('a2', public.hr_add_application(pg_temp.id('o1'), '{"full_name":"Dev Demo","email":"dev@example.com"}'));
insert into t_ids values ('a3', public.hr_add_application(pg_temp.id('o1'), '{"full_name":"Esha Example","email":"esha@example.com"}'));
select test.eq((select expected_salary from public.hr_application_compensation where application_id = pg_temp.id('a1')), 800000::numeric(14,2),
  'expected salary stored for HR');
insert into t_ids select 'c1', candidate_id from public.hr_candidate_applications where id = pg_temp.id('a1');
select test.as_owner();

-- confidential candidate data
select pg_temp.login('hm');
select test.eq(test.count_rows('select 1 from public.hr_application_compensation'), 0::bigint, 'hiring manager cannot see expected salary');
select test.eq(test.count_rows($q$select 1 from public.hr_candidate_applications where opening_id = pg_temp.id('o1')$q$), 3::bigint,
  'hiring manager sees applications for their opening');
select test.throws($q$select public.hr_add_application(pg_temp.id('o1'), '{"full_name":"X","email":"x@example.com"}')$q$, 'hiring manager cannot add applications', 'not allowed');
select test.as_owner();
select pg_temp.login('emp');
select test.eq(test.count_rows('select 1 from public.hr_candidates'), 0::bigint, 'ordinary employee cannot see candidates');
select test.throws($q$select public.hr_record_screening(pg_temp.id('a1'), '{"decision":"shortlist"}')$q$, 'ordinary employee cannot screen', 'not allowed');
select test.as_owner();
select pg_temp.login('arec');
select test.eq(test.count_rows($q$select 1 from public.hr_candidate_applications where opening_id = pg_temp.id('o1')$q$), 3::bigint,
  'assigned recruiter (opening recruiter) sees the opening''s applications');
select test.eq(test.count_rows($q$select 1 from public.hr_candidate_applications where opening_id = pg_temp.id('o2')$q$), 0::bigint,
  'assigned recruiter does not see other openings');
select test.as_owner();

-- ---- notes and attachments
select pg_temp.login('arec');
select public.hr_add_candidate_note(pg_temp.id('c1'), 'Strong SQL background (synthetic).', pg_temp.id('a1'));
insert into t_ids select 'att_cv', (public.hr_register_candidate_attachment(pg_temp.id('c1'), 'resume', 'Cara CV.pdf', 'application/pdf', 2048, pg_temp.id('a1')) ->> 'id')::uuid;
insert into t_ids select 'att_id', (public.hr_register_candidate_attachment(pg_temp.id('c1'), 'id_proof', 'id.png', 'image/png', 1024) ->> 'id')::uuid;
select test.ok((select storage_path like pg_temp.id('c1') || '/%-Cara_CV.pdf' from public.hr_candidate_attachments where id = pg_temp.id('att_cv')),
  'attachment path is under the candidate and sanitised');
select test.throws($q$select public.hr_register_candidate_attachment(pg_temp.id('c1'), 'resume', 'x.exe', 'application/x-msdownload', 10)$q$,
  'disallowed file type rejected', 'Only PDF');
select test.throws($q$select public.hr_register_candidate_attachment(pg_temp.id('c1'), 'resume', 'big.pdf', 'application/pdf', 20000000)$q$,
  'oversized file rejected', '10 MB');
select test.throws($q$select public.hr_confirm_candidate_attachment(pg_temp.id('att_cv'))$q$, 'cannot confirm before upload', 'not been uploaded');
insert into storage.objects (bucket_id, name) select 'hr-recruitment', storage_path from public.hr_candidate_attachments where id = pg_temp.id('att_cv');
select test.throws($q$insert into storage.objects (bucket_id, name) values ('hr-recruitment', pg_temp.id('c1') || '/unregistered.pdf')$q$,
  'upload to an unregistered path refused', 'row-level security');
select public.hr_confirm_candidate_attachment(pg_temp.id('att_cv'));
insert into storage.objects (bucket_id, name) select 'hr-recruitment', storage_path from public.hr_candidate_attachments where id = pg_temp.id('att_id');
select test.as_owner();
select pg_temp.login('emp');
select test.throws($q$select public.hr_register_candidate_attachment(pg_temp.id('c1'), 'resume', 'cv.pdf', 'application/pdf', 100)$q$,
  'ordinary employee cannot upload candidate files', 'not allowed');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-recruitment'$q$), 0::bigint, 'ordinary employee cannot read candidate files');
select test.as_owner();
select pg_temp.login('hm');
select test.eq(test.count_rows('select 1 from public.hr_candidate_notes'), 1::bigint, 'hiring manager sees candidate notes');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-recruitment'$q$), 2::bigint, 'hiring manager can read resume and ID files');
select test.throws($q$select public.hr_register_candidate_attachment(pg_temp.id('c1'), 'resume', 'cv.pdf', 'application/pdf', 100)$q$,
  'hiring manager cannot upload candidate files', 'not allowed');
select test.as_owner();

-- ---- screening
select pg_temp.login('arec');
select test.throws($q$select public.hr_record_screening(pg_temp.id('a1'), '{"decision":"reject"}')$q$, 'reject needs a reason', 'reason');
select test.throws($q$select public.hr_record_screening(pg_temp.id('a1'), '{"decision":"shortlist","score":140}')$q$, 'score above 100 rejected', 'between 0 and 100');
select public.hr_record_screening(pg_temp.id('a1'), jsonb_build_object('decision', 'hold', 'reason', 'Waiting for references', 'resume_reviewed', true,
  'checklist', jsonb_build_array(jsonb_build_object('item', 'Degree', 'met', true)), 'score', 65));
select test.ok((select stage = 'screening' and on_hold and hold_reason like '%references%' from public.hr_candidate_applications where id = pg_temp.id('a1')),
  'hold keeps the candidate in screening, on hold with the reason');
select public.hr_record_screening(pg_temp.id('a1'), jsonb_build_object('decision', 'shortlist', 'score', 82, 'notes', 'References fine',
  'answers', jsonb_build_array(jsonb_build_object('question', 'Notice period?', 'answer', '30 days'))));
select test.ok((select stage = 'shortlisted' and not on_hold from public.hr_candidate_applications where id = pg_temp.id('a1')), 'shortlist moves to Shortlisted and clears hold');
select test.eq(test.count_rows($q$select 1 from public.hr_candidate_screenings where application_id = pg_temp.id('a1') and reviewer_employee_id = pg_temp.id('arec')$q$),
  2::bigint, 'every screening decision recorded with the reviewer');
select test.throws($q$select public.hr_record_screening(pg_temp.id('a1'), '{"decision":"shortlist"}')$q$, 'shortlisted candidates are no longer screened', 'Applied or Screening');
select public.hr_record_screening(pg_temp.id('a3'), '{"decision":"reject","reason":"Missing required degree"}');
select test.ok((select stage = 'rejected' and rejected_reason like '%degree%' from public.hr_candidate_applications where id = pg_temp.id('a3')), 'screening rejection with reason');
select public.hr_record_screening(pg_temp.id('a2'), '{"decision":"shortlist"}');
select test.throws($q$update public.hr_candidate_screenings set decision = 'reject'$q$, 'screening history is immutable', 'permission denied');
select test.as_owner();

-- ---- interviews: schedule, reschedule, cancel
select pg_temp.login('hr');
insert into t_ids values ('i1', public.hr_schedule_interview(pg_temp.id('a1'), now() - interval '3 hours', array[pg_temp.id('iv1'), pg_temp.id('iv2')], 1, 'technical', 60, 'video', 'https://meet.example.com/x'));
insert into t_ids values ('i2', public.hr_schedule_interview(pg_temp.id('a2'), now() + interval '2 days', array[pg_temp.id('iv1')]));
select test.throws($q$update public.hr_interviews set scheduled_at = now() where id = pg_temp.id('i1')$q$, 'direct time change refused', 'Reschedule');
select test.throws($q$select public.hr_reschedule_interview(pg_temp.id('i1'), now() - interval '2 hours', null)$q$, 'reschedule needs a reason', 'reason');
select public.hr_reschedule_interview(pg_temp.id('i1'), now() - interval '2 hours', 'Interviewer unavailable', 'in_person', 'Guntur office, room 2');
select test.ok((select reschedule_count = 1 and mode = 'in_person' and location_or_link = 'Guntur office, room 2' from public.hr_interviews where id = pg_temp.id('i1')),
  'reschedule updated time and place');
select test.ok((select old_mode = 'video' and new_mode = 'in_person' and reason = 'Interviewer unavailable' from public.hr_interview_reschedules where interview_id = pg_temp.id('i1')),
  'reschedule history kept');
select test.throws($q$select public.hr_set_interview_status(pg_temp.id('i2'), 'no_show')$q$, 'no-show only after start', 'after it has started');
select test.throws($q$select public.hr_set_interview_status(pg_temp.id('i2'), 'cancelled')$q$, 'cancel needs a reason', 'reason');
select public.hr_set_interview_status(pg_temp.id('i2'), 'cancelled', 'Candidate asked to move');
select test.throws($q$select public.hr_set_interview_status(pg_temp.id('i2'), 'completed')$q$, 'cancelled interview is final', 'already cancelled');
insert into t_ids values ('i3', public.hr_schedule_interview(pg_temp.id('a2'), now() - interval '1 hour', array[pg_temp.id('iv2')], 2));
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications n where n.recipient_user_id = pg_temp.uid('iv1') and n.type = 'interview_rescheduled'),
  'panel notified in-app of the reschedule (no email, no calendar)');
select test.eq((select count(*) from public.hr_email_outbox), 0::bigint, 'interviews never queue email');
select pg_temp.login('emp');
select test.throws($q$select public.hr_reschedule_interview(pg_temp.id('i1'), now(), 'x')$q$, 'employee cannot reschedule', 'not allowed');
select test.as_owner();
select pg_temp.login('iv1');
select test.eq(test.count_rows($q$select 1 from public.hr_candidate_applications where id = pg_temp.id('a1')$q$), 1::bigint, 'interviewer sees the assigned candidate');
select test.eq(test.count_rows($q$select 1 from public.hr_candidate_applications where id = pg_temp.id('a3')$q$), 0::bigint, 'interviewer does not see unassigned candidates');
select test.eq(test.count_rows('select 1 from public.hr_candidate_screenings'), 0::bigint, 'interviewer cannot see screening notes');
select test.eq(test.count_rows('select 1 from public.hr_candidate_notes'), 0::bigint, 'interviewer cannot see internal candidate notes');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-recruitment'$q$), 1::bigint, 'interviewer can read the resume but not the ID proof');
select test.as_owner();

-- ---- evaluations
select pg_temp.login('iv1');
select public.hr_save_interview_evaluation(pg_temp.id('i1'), '{"technical_score":4,"communication_score":3,"comments":"Draft notes"}', false);
select test.as_owner();
select pg_temp.login('hm');
select test.eq(test.count_rows($q$select 1 from public.hr_interview_feedback where interview_id = pg_temp.id('i1')$q$), 0::bigint, 'drafts are hidden from the hiring manager');
select test.as_owner();
select pg_temp.login('iv1');
select test.eq(test.count_rows($q$select 1 from public.hr_interview_feedback where interview_id = pg_temp.id('i1')$q$), 1::bigint, 'interviewer sees own draft');
select test.throws($q$select public.hr_save_interview_evaluation(pg_temp.id('i1'), '{"technical_score":4}', true)$q$, 'submit needs rating and recommendation', 'overall rating');
select test.throws($q$select public.hr_save_interview_evaluation(pg_temp.id('i1'), '{"technical_score":7}', false)$q$, 'scores are 1-5', '1 to 5');
select public.hr_save_interview_evaluation(pg_temp.id('i1'), '{"rating":4,"recommendation":"hire","technical_score":4,"hr_score":4,"communication_score":3,"role_skills_score":4,"experience_score":3,"comments":"Good problem solving"}', true);
select test.ok((select status = 'submitted' and submitted_at is not null and technical_score = 4 from public.hr_interview_feedback
                where interview_id = pg_temp.id('i1') and interviewer_id = pg_temp.id('iv1')), 'structured evaluation submitted');
select test.eq((select status from public.hr_interviews where id = pg_temp.id('i1')), 'completed', 'submission completes the interview');
select test.throws($q$select public.hr_save_interview_evaluation(pg_temp.id('i1'), '{"rating":1,"recommendation":"no_hire","comments":"changed"}', true)$q$,
  'submitted evaluation is locked', 'already submitted');
select test.as_owner();
select pg_temp.login('iv2');
select test.eq(test.count_rows($q$select 1 from public.hr_interview_feedback where interviewer_id = pg_temp.id('iv1')$q$), 0::bigint, 'panelists do not see each other''s evaluations');
select test.throws($q$update public.hr_interview_feedback set rating = 1 where interviewer_id = pg_temp.id('iv1')$q$, 'cannot edit another interviewer''s evaluation', 'permission denied');
select public.hr_submit_interview_feedback(pg_temp.id('i1'), 3, 'hold', 'Clear communicator', 'Needs mentoring');
select test.as_owner();
select test.eq((select rating from public.hr_interview_feedback where interviewer_id = pg_temp.id('iv1') and interview_id = pg_temp.id('i1')), 4::smallint,
  'first evaluation unchanged by the other interviewer');
select pg_temp.login('hm');
select test.eq(test.count_rows($q$select 1 from public.hr_interview_feedback where interview_id = pg_temp.id('i1')$q$), 2::bigint, 'hiring manager sees submitted evaluations');
select test.throws($q$select public.hr_reopen_interview_evaluation((select id from public.hr_interview_feedback where interviewer_id = pg_temp.id('iv1') limit 1), 'x')$q$,
  'hiring manager cannot re-open evaluations', 'not allowed');
select test.as_owner();
select pg_temp.login('hr');
select public.hr_reopen_interview_evaluation((select id from public.hr_interview_feedback where interviewer_id = pg_temp.id('iv1') and interview_id = pg_temp.id('i1')), 'Score typo');
select test.as_owner();
select pg_temp.login('iv1');
select public.hr_save_interview_evaluation(pg_temp.id('i1'), '{"rating":5,"recommendation":"strong_hire","technical_score":5,"comments":"Corrected"}', true);
select test.as_owner();
select test.ok((select rating = 5 and status = 'submitted' and reopen_reason = 'Score typo' from public.hr_interview_feedback
                where interviewer_id = pg_temp.id('iv1') and interview_id = pg_temp.id('i1')), 'author corrected the re-opened evaluation');

-- ---- final decision
select pg_temp.login('emp');
select test.throws($q$select public.hr_record_hiring_decision(pg_temp.id('a1'), 'hire')$q$, 'employee cannot decide', 'Only HR or the hiring manager');
select test.as_owner();
select pg_temp.login('hm');
select test.throws($q$select public.hr_record_hiring_decision(pg_temp.id('a2'), 'hire')$q$, 'hire needs a submitted evaluation', 'evaluation is required');
select test.throws($q$select public.hr_record_hiring_decision(pg_temp.id('a1'), 'hold')$q$, 'hold needs a reason', 'reason');
select public.hr_record_hiring_decision(pg_temp.id('a1'), 'hire', 'Panel consensus');
select test.eq((select stage from public.hr_candidate_applications where id = pg_temp.id('a1')), 'selected', 'hiring manager decision moves candidate to Selected');
select test.eq(test.count_rows($q$select 1 from public.hr_hiring_decisions where application_id = pg_temp.id('a1') and decided_by_employee = pg_temp.id('hm')$q$),
  1::bigint, 'decision recorded with the decider');
select test.as_owner();

-- ---- offer letter templates
select pg_temp.login('rec');
select test.throws($q$select public.hr_save_offer_template(null, 'Bad', 'Hi {{candidate_name}}', 'Dear {{nickname}}, welcome to the team!!')$q$,
  'unknown placeholder rejected', 'nickname');
insert into t_ids values ('tpl', public.hr_save_offer_template(null, 'Intern offer', 'Internship at {{company_name}}', 'Dear {{candidate_name}}, we offer you an internship. {{signatory_name}}'));
select test.throws($q$select public.hr_set_offer_template_status(pg_temp.id('tpl'), 'approved')$q$, 'recruiter cannot approve templates', 'Only HR administrators');
select test.as_owner();
select pg_temp.login('emp');
select test.eq(test.count_rows('select 1 from public.hr_offer_letter_templates'), 0::bigint, 'employees cannot read offer templates');
select test.as_owner();

-- ---- offers: create, generate, issue, email, response
select pg_temp.login('hr');
insert into t_ids values ('f1', public.hr_create_offer(pg_temp.id('a1'), pg_temp.id('des'), pg_temp.id('dep'), 'full_time', null, 840000));
select test.throws($q$select public.hr_generate_offer_letter(pg_temp.id('f1'), pg_temp.id('tpl'))$q$, 'draft template cannot be used', 'approved template');
select test.throws($q$select public.hr_generate_offer_letter(pg_temp.id('f1'))$q$, 'letter needs complete details', 'joining date');
select test.throws($q$select public.hr_issue_offer(pg_temp.id('f1'))$q$, 'cannot issue without a letter', 'Generate the offer letter');
select public.hr_update_offer(pg_temp.id('f1'), jsonb_build_object('joining_date', (current_date + 20)::text, 'work_location', 'Guntur',
  'signatory_employee_id', pg_temp.id('hr'), 'signatory_title', 'HR Manager'));
select test.eq(public.hr_generate_offer_letter(pg_temp.id('f1')), 1, 'letter version 1 generated from the default approved template');
select test.ok((select body like '%Dear Cara Candidate%' and body like '%INR 840,000.00%' and body like '%Software Engineer%' and body not like '%{{%'
                and subject like 'Offer of employment: Software Engineer%'
                from public.hr_offer_letter_versions where offer_id = pg_temp.id('f1') and version = 1), 'letter merged with candidate, role and CTC');
select public.hr_update_offer(pg_temp.id('f1'), '{"annual_ctc": 860000}');
select test.ok((select letter_stale from public.hr_offers where id = pg_temp.id('f1')), 'editing the offer marks the letter stale');
select test.throws($q$select public.hr_issue_offer(pg_temp.id('f1'))$q$, 'stale letter cannot be issued', 'Regenerate');
select test.eq(public.hr_generate_offer_letter(pg_temp.id('f1')), 2, 'letter version 2 generated');
select test.eq((select count(*) from public.hr_offer_letter_versions where offer_id = pg_temp.id('f1')), 2::bigint, 'both letter versions kept');
select public.hr_issue_offer(pg_temp.id('f1'));
select test.ok((select f.status = 'sent' and f.issued_on is not null and a.stage = 'offered' from public.hr_offers f
                join public.hr_candidate_applications a on a.id = f.application_id where f.id = pg_temp.id('f1')), 'offer issued; candidate moves to Offered');
select test.throws($q$select public.hr_update_offer(pg_temp.id('f1'), '{"annual_ctc": 1}')$q$, 'issued offer cannot be edited', 'Only a draft');
select test.throws($q$select public.hr_generate_offer_letter(pg_temp.id('f1'))$q$, 'issued letter cannot be regenerated', 'issued offer');
select test.ok((public.hr_get_application_offers(pg_temp.id('a1')) -> 0 ->> 'email_status') is null, 'not reported as emailed before any email');
select public.hr_queue_offer_email(pg_temp.id('f1'));
select test.eq((public.hr_get_application_offers(pg_temp.id('a1')) -> 0 ->> 'email_status'), 'queued', 'email shows as queued, not sent');
select test.throws($q$select public.hr_queue_offer_email(pg_temp.id('f1'))$q$, 'email cannot be queued twice', 'already queued');
select public.hr_log_offer_letter_download((select id from public.hr_offer_letter_versions where offer_id = pg_temp.id('f1') and version = 2));
select test.as_owner();
select test.ok((select to_email = 'cara@example.com' and status = 'queued' and body_text like '%860,000.00%' from public.hr_email_outbox), 'outbox email holds the issued letter');
select test.ok(exists (select 1 from public.hr_audit_log where action = 'OFFER_LETTER_DOWNLOAD'), 'letter download audited');
select pg_temp.login('hm');
select test.ok((public.hr_get_application_offers(pg_temp.id('a1')) -> 0 ->> 'annual_ctc') is null
               and (public.hr_get_application_offers(pg_temp.id('a1')) -> 0 ->> 'email_status') is null, 'hiring manager sees the offer without compensation');
select test.eq(test.count_rows('select 1 from public.hr_offer_letter_versions'), 0::bigint, 'hiring manager cannot read offer letters');
select test.as_owner();

-- expiry
select pg_temp.login('hr');
insert into t_ids values ('o3', public.hr_save_job_opening(null, '{"title":"Support Engineer"}'));
select public.hr_set_job_opening_status(pg_temp.id('o3'), 'open');
insert into t_ids values ('a4', public.hr_add_application(pg_temp.id('o3'), '{"full_name":"Fay Field","email":"fay@example.com"}'));
select public.hr_move_candidate_stage(pg_temp.id('a4'), 'screening');
select public.hr_move_candidate_stage(pg_temp.id('a4'), 'shortlisted');
select public.hr_move_candidate_stage(pg_temp.id('a4'), 'interview');
select public.hr_move_candidate_stage(pg_temp.id('a4'), 'selected');
insert into t_ids values ('f4', public.hr_create_offer(pg_temp.id('a4'), null, null, 'full_time', current_date + 10));
select public.hr_send_offer(pg_temp.id('f4'));
select test.as_owner();
update public.hr_offers set expires_on = current_date - 1 where id = pg_temp.id('f4');
select pg_temp.login('hr');
select test.ok(public.hr_expire_overdue_offers() >= 1, 'overdue issued offers expire');
select test.eq((select status from public.hr_offers where id = pg_temp.id('f4')), 'expired', 'offer status Expired');
select public.hr_record_offer_response(pg_temp.id('f1'), 'accepted', 'Signed copy received');
select test.eq((select status from public.hr_offers where id = pg_temp.id('f1')), 'accepted', 'acceptance recorded');

-- ---- hire -> employee
select test.as_owner();
select pg_temp.login('rec');
select test.throws($q$select public.hr_convert_candidate_to_employee(pg_temp.id('a1'), 'cara@zyllo.example')$q$, 'recruiter cannot convert hires', 'not allowed');
select test.as_owner();
select pg_temp.login('hr');
insert into t_ids values ('e_cara', public.hr_convert_candidate_to_employee(pg_temp.id('a1'), 'cara@zyllo.example', null, null, null, pg_temp.id('hm')));
select test.ok((select e.source = 'candidate' and e.source_ref = pg_temp.id('a1') and e.status = 'onboarding' and e.designation_id = pg_temp.id('des')
                and e.department_id = pg_temp.id('dep') and e.manager_id = pg_temp.id('hm') and e.joining_date = current_date + 20
                from public.hr_employees e where e.id = pg_temp.id('e_cara')), 'employee created from the accepted offer, linked to the application');
select test.ok((select stage = 'joined' and employee_id = pg_temp.id('e_cara') from public.hr_candidate_applications where id = pg_temp.id('a1')),
  'application marked hired and linked to the employee');
select test.ok((select a.opening_id = pg_temp.id('o1') from public.hr_employees e join public.hr_candidate_applications a on a.id = e.source_ref
                where e.id = pg_temp.id('e_cara')), 'employee traces back to the job opening');
select test.ok(exists (select 1 from public.hr_candidate_screenings where application_id = pg_temp.id('a1'))
               and exists (select 1 from public.hr_candidates where id = pg_temp.id('c1')), 'candidate and recruitment history preserved');
select test.throws($q$select public.hr_convert_candidate_to_employee(pg_temp.id('a1'), 'cara2@zyllo.example')$q$, 'no duplicate employee', 'already been converted');
select test.eq((select count(*) from public.hr_employees where source = 'candidate' and source_ref = pg_temp.id('a1')), 1::bigint, 'exactly one employee for the hire');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = pg_temp.uid('hm') and type = 'candidate_hired'), 'hiring manager notified of the hire');

-- ---- overview dashboard
select pg_temp.login('hr');
select test.ok((select (r ->> 'open_jobs')::int = 3 and (r ->> 'total_applications')::int = 5 and (r ->> 'hired')::int = 1
                and (r ->> 'offers_accepted')::int = 1 and (r ->> 'shortlisted')::int = 0 and r ->> 'scope' = 'all'
                from (select public.hr_recruitment_overview() r) x), 'HR overview counts from the database');
select test.ok((select (r ->> 'total_applications')::int = 3 and (r ->> 'interviews_scheduled')::int = 1
                from (select public.hr_recruitment_overview(pg_temp.id('o1')) r) x), 'overview filtered by job');
select test.ok((select (r ->> 'total_applications')::int = 1 from (select public.hr_recruitment_overview(null, pg_temp.id('dep2')) r) x), 'overview filtered by department');
select test.ok((select (r ->> 'total_applications')::int = 0 from (select public.hr_recruitment_overview(p_from => current_date + 1) r) x), 'overview filtered by date');
select test.throws($q$select public.hr_recruitment_overview(p_from => current_date, p_to => current_date - 1)$q$, 'bad date range rejected', 'before the start');
select test.as_owner();
select pg_temp.login('hm');
select test.ok((select r ->> 'scope' = 'assigned' and r -> 'offers_pending' = 'null'::jsonb and (r ->> 'total_applications')::int = 4
                from (select public.hr_recruitment_overview() r) x), 'hiring manager overview is scoped and hides offer KPIs');
select test.as_owner();
select pg_temp.login('emp');
select test.ok((select (r ->> 'total_applications')::int = 0 and (r ->> 'open_jobs')::int = 0 from (select public.hr_recruitment_overview() r) x),
  'ordinary employee overview shows nothing');
select test.as_owner();

-- Training (115): catalogue permissions, assignment scope (HR anyone,
-- manager team only, never self), idempotent bulk assignment, start,
-- completion rules (pass score, certificate, same-employee certificate),
-- self-reported completion + verification, cancel, privacy.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;

do $$
begin
  insert into t_ids values ('hr',   test.make_employee('tr.hr@test.local', 'Hema', null, array['hr_admin']));
  insert into t_ids values ('mgr',  test.make_employee('tr.mgr@test.local', 'Meru', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('tr.emp1@test.local', 'Asha', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('tr.emp2@test.local', 'Bodhi', null));
end $$;

select test.eq((select count(*) from public.hr_training_categories where code in ('onboarding','compliance','technical','soft_skills')), 4::bigint, 'training categories seeded');

-- ---- catalogue
select pg_temp.as_k('hr');
with x as (insert into public.hr_training_courses (code, title, category_id, delivery_mode, duration_hours, is_mandatory, pass_score)
           values ('SEC-101', 'Security awareness', (select id from public.hr_training_categories where code = 'compliance'), 'online', 2, true, 70) returning id)
insert into t_ids select 'sec', id from x;
with x as (insert into public.hr_training_courses (code, title, certificate_required, validity_months)
           values ('CLOUD-1', 'Cloud fundamentals', true, 24) returning id)
insert into t_ids select 'cloud', id from x;
select test.throws($q$insert into public.hr_training_courses (code, title, duration_hours) values ('BAD-1', 'Bad hours', 0)$q$, 'duration must be positive', 'check constraint');
select pg_temp.as_k('mgr');
select test.throws($q$insert into public.hr_training_courses (code, title) values ('MGR-1', 'Manager course')$q$, 'manager cannot edit the catalogue', 'row-level security');

-- ---- assignment scope
select test.eq(public.hr_assign_training(pg_temp.id('sec'), array[pg_temp.id('emp1')], current_date + 14), 1, 'manager assigns training to a team member');
select test.throws($q$select public.hr_assign_training(pg_temp.id('sec'), array[pg_temp.id('emp2')])$q$, 'manager cannot assign outside the team', 'reporting line');
select test.throws($q$select public.hr_assign_training(pg_temp.id('sec'), array[pg_temp.id('mgr')])$q$, 'manager cannot assign to self', 'reporting line');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_assign_training(pg_temp.id('sec'), array[pg_temp.id('emp2')])$q$, 'employee cannot assign training', 'not allowed');
select pg_temp.as_k('hr');
select test.eq(public.hr_assign_training(pg_temp.id('sec'), array[pg_temp.id('emp1'), pg_temp.id('emp2')], current_date + 7), 1, 'bulk assignment skips existing open assignments');
select test.throws($q$select public.hr_assign_training(pg_temp.id('sec'), array[pg_temp.id('emp2')], current_date - 1)$q$, 'due date in the past rejected', 'past');
select test.throws($q$select public.hr_assign_training(pg_temp.id('sec'), array[]::uuid[])$q$, 'at least one employee required', 'at least one');
select public.hr_assign_training(pg_temp.id('cloud'), array[pg_temp.id('emp1'), pg_temp.id('emp2')]);
select test.throws($q$insert into public.hr_training_assignments (employee_id, course_id) values (pg_temp.id('emp1'), pg_temp.id('cloud'))$q$, 'no direct assignment inserts', 'row-level security');
select test.as_owner();
insert into t_ids select 'a_sec1', id from public.hr_training_assignments where employee_id = pg_temp.id('emp1') and course_id = pg_temp.id('sec');
insert into t_ids select 'a_sec2', id from public.hr_training_assignments where employee_id = pg_temp.id('emp2') and course_id = pg_temp.id('sec');
insert into t_ids select 'a_cl1', id from public.hr_training_assignments where employee_id = pg_temp.id('emp1') and course_id = pg_temp.id('cloud');
insert into t_ids select 'a_cl2', id from public.hr_training_assignments where employee_id = pg_temp.id('emp2') and course_id = pg_temp.id('cloud');
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp1')) and type = 'training_assigned'), 'employee notified of assignment');

-- ---- start / complete
select pg_temp.as_k('emp2');
select test.throws($q$select public.hr_start_training(pg_temp.id('a_sec1'))$q$, 'cannot start a colleague''s training', 'not found');
select pg_temp.as_k('emp1');
select public.hr_start_training(pg_temp.id('a_sec1'));
select test.eq((select status from public.hr_training_assignments where id = pg_temp.id('a_sec1')), 'in_progress', 'employee starts own training');
select test.throws($q$select public.hr_start_training(pg_temp.id('a_sec1'))$q$, 'cannot start twice', 'Only assigned');
select test.throws($q$select public.hr_complete_training(pg_temp.id('a_sec1'), current_date + 1)$q$, 'completion date cannot be in the future', 'future');
select test.throws($q$select public.hr_complete_training(pg_temp.id('a_sec1'), current_date, 'passed', 50)$q$, 'pass score enforced', 'pass mark');
select public.hr_complete_training(pg_temp.id('a_sec1'), current_date, 'passed', 85);
select test.ok((select status = 'completed' and completion_source = 'self' and verified_at is null from public.hr_training_assignments where id = pg_temp.id('a_sec1')),
  'self-reported completion is unverified');
select test.throws($q$select public.hr_verify_training_completion(pg_temp.id('a_sec1'))$q$, 'employee cannot verify own completion', 'not allowed');
select pg_temp.as_k('mgr');
select public.hr_verify_training_completion(pg_temp.id('a_sec1'));
select test.ok((select verified_at is not null from public.hr_training_assignments where id = pg_temp.id('a_sec1')), 'manager verifies team completion');
select test.throws($q$select public.hr_verify_training_completion(pg_temp.id('a_sec1'))$q$, 'cannot verify twice', 'already verified');

-- certificate rules
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_complete_training(pg_temp.id('a_cl1'), current_date, 'passed')$q$, 'certificate required by the course', 'certificate');
select test.as_owner();
with x as (insert into public.hr_documents (employee_id, category_id, title)
           values (pg_temp.id('emp1'), (select id from public.hr_document_categories where code = 'training_certificate'), 'Cloud certificate') returning id)
insert into t_ids select 'cert1', id from x;
with x as (insert into public.hr_documents (employee_id, category_id, title)
           values (pg_temp.id('emp2'), (select id from public.hr_document_categories where code = 'training_certificate'), 'Other certificate') returning id)
insert into t_ids select 'cert2', id from x;
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_complete_training(pg_temp.id('a_cl1'), current_date, 'passed', null, pg_temp.id('cert2'))$q$, 'certificate must belong to the same employee', 'same employee');
select public.hr_complete_training(pg_temp.id('a_cl1'), current_date, 'passed', null, pg_temp.id('cert1'));
select test.ok((select completion_source = 'hr' and verified_at is not null and certificate_expiry = (current_date + interval '24 months')::date
                from public.hr_training_assignments where id = pg_temp.id('a_cl1')), 'HR completion verified with certificate expiry from validity');
select public.hr_complete_training(pg_temp.id('a_cl2'), current_date, 'failed');
select test.ok((select result = 'failed' and certificate_expiry is null from public.hr_training_assignments where id = pg_temp.id('a_cl2')), 'failed result recorded without certificate');
select test.throws($q$select public.hr_complete_training(pg_temp.id('a_cl2'), current_date, 'passed')$q$, 'closed assignment cannot be completed again', 'not open');

-- cancel
select test.throws($q$select public.hr_cancel_training(pg_temp.id('a_sec2'), '')$q$, 'cancel needs a reason', 'reason');
select public.hr_cancel_training(pg_temp.id('a_sec2'), 'Not applicable to role');
select test.eq((select status from public.hr_training_assignments where id = pg_temp.id('a_sec2')), 'cancelled', 'assignment cancelled');
select test.eq(public.hr_assign_training(pg_temp.id('sec'), array[pg_temp.id('emp2')]), 1, 'can re-assign after cancellation');

-- ---- privacy
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_training_assignments'), 2::bigint, 'employee sees own assignments');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_training_assignments where employee_id = pg_temp.id(''emp1'')'), 0::bigint, 'colleague cannot see assignments');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_training_assignments'), 2::bigint, 'manager sees team assignments only');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_training_assignments' and action = 'UPDATE'), 'assignment changes audited');
select test.as_anon();
select test.throws($q$select 1 from public.hr_training_courses$q$, 'anon cannot read courses', 'permission denied');

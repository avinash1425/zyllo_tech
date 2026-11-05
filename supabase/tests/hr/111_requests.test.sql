-- HR requests (helpdesk): creation + SLA, privacy (no manager access,
-- confidential grievances), internal notes, assignment, status flow,
-- close / reopen window / cancel, self-handling guard, audit redaction.
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
  insert into public.hr_roles (key, name, description) values ('helpdesk_viewer', 'Helpdesk viewer', 'Test-only role');
  insert into public.hr_role_permissions values ('helpdesk_viewer', 'hr_requests.view');
  insert into t_ids values ('hr',     test.make_employee('req.hr@test.local', 'Hema', null, array['hr_admin']));
  insert into t_ids values ('hr2',    test.make_employee('req.hr2@test.local', 'Hans', null, array['hr_admin']));
  insert into t_ids values ('viewer', test.make_employee('req.viewer@test.local', 'Vik', null, array['helpdesk_viewer']));
  insert into t_ids values ('mgr',    test.make_employee('req.mgr@test.local', 'Meru', null, array['manager','employee']));
  insert into t_ids values ('emp1',   test.make_employee('req.emp1@test.local', 'Asha', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2',   test.make_employee('req.emp2@test.local', 'Bodhi', null));
end $$;

select test.eq((select count(*) from public.hr_request_categories where code in
  ('general','payroll_query','leave_query','document_request','it_access','grievance','other')), 7::bigint, 'request categories seeded');
select test.ok((select is_confidential from public.hr_request_categories where code = 'grievance'), 'grievance category is confidential');

-- ---- create
select test.as_anon();
select test.throws($q$select public.hr_create_hr_request('general', 'Hello', 'x')$q$, 'anon cannot create requests', 'permission denied');
select pg_temp.as_k('emp1');
do $$ begin
  insert into t_ids values ('r1', public.hr_create_hr_request('general', 'Address change', 'Please update my address on file.', 'high'));
  insert into t_ids values ('g1', public.hr_create_hr_request('grievance', 'Concern about conduct', 'Details of the concern.'));
end $$;
select test.ok((select status = 'open' and priority = 'high' and not is_confidential
                and sla_due_at between now() + interval '47 hours' and now() + interval '49 hours'
                from public.hr_requests where id = pg_temp.id('r1')), 'request open with SLA from category');
select test.ok((select is_confidential from public.hr_requests where id = pg_temp.id('g1')), 'grievance request is confidential');
select test.throws($q$select public.hr_create_hr_request('nope', 'Hello', 'x')$q$, 'unknown category rejected', 'category');
select test.throws($q$select public.hr_create_hr_request('general', 'Hi', 'x', 'critical')$q$, 'short subject rejected', 'subject');
select test.throws($q$insert into public.hr_requests (employee_id, category_id, subject, description)
  select pg_temp.id('emp1'), id, 'Direct', 'x' from public.hr_request_categories where code = 'general'$q$, 'no direct inserts', 'row-level security');
select test.throws($q$select public.hr_comment_hr_request(pg_temp.id('r1'), 'note to self', true)$q$, 'requester cannot add internal notes', 'internal notes');
select test.eq(test.count_rows('select 1 from public.hr_requests'), 2::bigint, 'requester sees own requests');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('r1')::text and recipient_user_id = test.user_of(pg_temp.id('hr'))),
  'HR staff notified of new request');
select test.ok((select body = 'A confidential request was submitted.' from public.hr_notifications where entity_id = pg_temp.id('g1')::text limit 1),
  'confidential request notification hides the subject');

-- ---- privacy
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_requests'), 0::bigint, 'manager cannot see team HR requests');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_requests'), 0::bigint, 'colleague cannot see requests');
select test.throws($q$select public.hr_comment_hr_request(pg_temp.id('r1'), 'hi')$q$, 'colleague cannot comment', 'not found');
select test.throws($q$select public.hr_cancel_hr_request(pg_temp.id('r1'))$q$, 'colleague cannot cancel', 'not found');
select pg_temp.as_k('viewer');
select test.eq(test.count_rows('select 1 from public.hr_requests'), 1::bigint, 'hr_requests.view sees non-confidential only');
select test.throws($q$select public.hr_comment_hr_request(pg_temp.id('r1'), 'hi')$q$, 'viewer cannot respond', 'not allowed');
select test.throws($q$select public.hr_update_hr_request_status(pg_temp.id('r1'), 'in_progress')$q$, 'viewer cannot change status', 'not allowed');
select pg_temp.as_k('hr');
select test.eq(test.count_rows('select 1 from public.hr_requests'), 2::bigint, 'hr_requests.manage sees all including confidential');

-- ---- comments + internal notes
select public.hr_comment_hr_request(pg_temp.id('r1'), 'Checking with the records team.', true);
select public.hr_comment_hr_request(pg_temp.id('r1'), 'Please share the new address proof.', false);
select public.hr_comment_hr_request(pg_temp.id('g1'), 'Escalated to the committee.', true);
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_request_comments'), 1::bigint, 'requester does not see internal notes');
select test.ok(exists (select 1 from public.hr_notifications where type = 'hr_request' and entity_id = pg_temp.id('r1')::text), 'requester notified of HR response');
select pg_temp.as_k('viewer');
select test.eq(test.count_rows('select 1 from public.hr_request_comments'), 2::bigint, 'viewer sees internal notes of non-confidential requests only');
select pg_temp.as_k('hr');
select test.eq(test.count_rows('select 1 from public.hr_request_comments'), 3::bigint, 'HR sees all comments');

-- ---- assignment + status flow
select test.throws($q$select public.hr_assign_hr_request(pg_temp.id('r1'), pg_temp.id('emp2'))$q$, 'cannot assign to non-staff', 'HR staff');
select test.throws($q$select public.hr_assign_hr_request(pg_temp.id('r1'), pg_temp.id('emp1'))$q$, 'cannot assign to requester', 'requester');
select public.hr_assign_hr_request(pg_temp.id('r1'), pg_temp.id('hr2'));
select test.ok((select status = 'in_progress' and assigned_to = pg_temp.id('hr2') from public.hr_requests where id = pg_temp.id('r1')), 'assignment moves request in progress');
select public.hr_update_hr_request_status(pg_temp.id('r1'), 'waiting_on_employee');
select test.throws($q$select public.hr_update_hr_request_status(pg_temp.id('r1'), 'resolved')$q$, 'resolution required to resolve', 'resolution');
select test.throws($q$select public.hr_update_hr_request_status(pg_temp.id('r1'), 'cancelled')$q$, 'HR cannot cancel on behalf of requester', 'Unknown status');
select pg_temp.as_k('emp1');
select public.hr_comment_hr_request(pg_temp.id('r1'), 'Uploaded the proof.');
select test.eq((select status from public.hr_requests where id = pg_temp.id('r1')), 'in_progress', 'requester reply resumes the request');
select test.throws($q$select public.hr_close_hr_request(pg_temp.id('r1'))$q$, 'cannot close an unresolved request', 'resolved');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('r1')::text and recipient_user_id = test.user_of(pg_temp.id('hr2'))
                       and title like 'Requester replied%'), 'assignee notified of requester reply');
select pg_temp.as_k('hr2');
select public.hr_update_hr_request_status(pg_temp.id('r1'), 'resolved', 'Address updated in records.');
select test.ok((select status = 'resolved' and resolved_at is not null from public.hr_requests where id = pg_temp.id('r1')), 'request resolved');
select pg_temp.as_k('emp1');
select public.hr_close_hr_request(pg_temp.id('r1'));
select test.eq((select status from public.hr_requests where id = pg_temp.id('r1')), 'closed', 'requester closed resolved request');
select test.throws($q$select public.hr_comment_hr_request(pg_temp.id('r1'), 'one more thing')$q$, 'no comments on closed request', 'Reopen');
select public.hr_reopen_hr_request(pg_temp.id('r1'), 'Old address still on payslip');
select test.ok((select status = 'open' and resolved_at is null and closed_at is null from public.hr_requests where id = pg_temp.id('r1')), 'requester reopened within window');
select test.as_owner();
update public.hr_requests set status = 'resolved', resolution = 'Done', resolved_at = now() - interval '8 days' where id = pg_temp.id('r1');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_reopen_hr_request(pg_temp.id('r1'))$q$, 'reopen window enforced', 'within 7 days');

-- ---- cancel
do $$ begin insert into t_ids values ('r2', public.hr_create_hr_request('other', 'Parking slot', 'Need a parking slot.')); end $$;
select public.hr_cancel_hr_request(pg_temp.id('r2'));
select test.eq((select status from public.hr_requests where id = pg_temp.id('r2')), 'cancelled', 'requester cancelled open request');
select test.throws($q$select public.hr_cancel_hr_request(pg_temp.id('r2'))$q$, 'cannot cancel twice', 'open requests');
update public.hr_requests set status = 'open' where id = pg_temp.id('r2');
select test.eq((select status from public.hr_requests where id = pg_temp.id('r2')), 'cancelled', 'no direct status updates');

-- ---- HR cannot handle own request
select pg_temp.as_k('hr');
do $$ begin insert into t_ids values ('r3', public.hr_create_hr_request('payroll_query', 'My payslip', 'Question about deductions.')); end $$;
select test.throws($q$select public.hr_update_hr_request_status(pg_temp.id('r3'), 'resolved', 'self')$q$, 'HR cannot resolve own request', 'own request');
select test.throws($q$select public.hr_comment_hr_request(pg_temp.id('r3'), 'note', true)$q$, 'HR cannot add internal notes to own request', 'internal notes');
select pg_temp.as_k('hr2');
select public.hr_comment_hr_request(pg_temp.id('r3'), 'Internal: check with payroll', true);
select pg_temp.as_k('hr');
select test.eq(test.count_rows($q$select 1 from public.hr_request_comments where request_id = pg_temp.id('r3')$q$), 0::bigint, 'HR requester does not see internal notes on own request');
select test.as_owner();

-- ---- audit redaction
select test.ok((select bool_and(new_data ->> 'description' = '[redacted]') from public.hr_audit_log where table_name = 'hr_requests' and new_data is not null),
  'request descriptions redacted in audit log');

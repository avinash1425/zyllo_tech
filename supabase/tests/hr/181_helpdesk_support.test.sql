-- Helpdesk & Support (181): support areas and categories, ticket numbers,
-- IT support desk isolation (helpdesk.it sees / handles only non-confidential
-- IT tickets), requester names via RPC, first response, history events,
-- requester close / reopen / rating, re-prioritise / re-categorise rules,
-- queue + summary RPCs and notification links.
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
  insert into t_ids values ('hr',   test.make_employee('hd.hr@test.local', 'Hema', null, array['hr_admin']));
  insert into t_ids values ('it',   test.make_employee('hd.it@test.local', 'Ivan', null, array['it_admin','employee']));
  insert into t_ids values ('it2',  test.make_employee('hd.it2@test.local', 'Ira', null, array['it_admin','employee']));
  insert into t_ids values ('mgr',  test.make_employee('hd.mgr@test.local', 'Meru', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('hd.emp1@test.local', 'Asha', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('hd.emp2@test.local', 'Bodhi', null));
end $$;

-- ---- master data
select test.eq((select count(*) from public.hr_request_categories where support_area = 'it' and workflow = 'helpdesk' and active), 4::bigint,
  'four IT support categories');
select test.ok((select support_area = 'workplace' and is_confidential from public.hr_request_categories where code = 'workplace_conduct'),
  'harassment / misconduct is a confidential workplace category');
select test.ok((select support_area = 'workplace' from public.hr_request_categories where code = 'grievance'), 'grievance moved to workplace');
select test.ok((select default_assignee_role = 'it_admin' from public.hr_request_categories where code = 'it_access'), 'it_access routed to IT admins');
select test.ok(exists (select 1 from public.hr_role_permissions where role_key = 'it_admin' and permission_key = 'helpdesk.it'), 'it_admin holds helpdesk.it');

-- ---- create + ticket numbers
select pg_temp.as_k('emp1');
do $$ begin
  insert into t_ids values ('it1', public.hr_create_hr_request('it_hardware', 'Laptop will not charge', 'The charger light stays off.', 'high'));
  insert into t_ids values ('hr1', public.hr_create_hr_request('general', 'Dress code question', 'Is there a dress code for client visits?'));
  insert into t_ids values ('wp1', public.hr_create_hr_request('workplace_conduct', 'Report a concern', 'Details of the concern.'));
end $$;
select test.ok((select bool_and(ticket_no ~ '^HD-[0-9]{5,}$') from public.hr_requests where id in (pg_temp.id('it1'), pg_temp.id('hr1'), pg_temp.id('wp1'))),
  'helpdesk tickets get HD- numbers');
select test.eq((select count(distinct ticket_no) from public.hr_requests where id in (pg_temp.id('it1'), pg_temp.id('hr1'), pg_temp.id('wp1'))), 3::bigint,
  'ticket numbers are unique');
select test.ok((select is_confidential from public.hr_requests where id = pg_temp.id('wp1')), 'misconduct ticket is confidential');
select test.ok((select sla_due_at between now() + interval '23 hours' and now() + interval '25 hours' from public.hr_requests where id = pg_temp.id('it1')),
  'IT hardware SLA is 24 hours');
update public.hr_requests set ticket_no = 'HD-99999' where id = pg_temp.id('it1');
select test.eq((select ticket_no from public.hr_requests where id = pg_temp.id('it1')) <> 'HD-99999', true, 'ticket number unchanged by direct update');
select test.throws($q$select public.hr_rate_helpdesk_ticket(pg_temp.id('it1'), 5)$q$, 'cannot rate an unresolved ticket', 'resolved');

select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('it1')::text
                       and recipient_user_id = test.user_of(pg_temp.id('it')) and link = '/hr/helpdesk/' || pg_temp.id('it1')),
  'IT admin notified of IT ticket with helpdesk link');
select test.ok(not exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('hr1')::text and recipient_user_id = test.user_of(pg_temp.id('it'))),
  'IT admin not notified of HR ticket');
select test.ok(not exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('wp1')::text and recipient_user_id = test.user_of(pg_temp.id('it'))),
  'IT admin not notified of confidential workplace ticket');

-- ---- IT desk isolation
select pg_temp.as_k('it');
select test.eq(test.count_rows('select 1 from public.hr_requests'), 1::bigint, 'IT admin sees only the IT ticket');
select test.eq(jsonb_array_length(public.hr_helpdesk_queue('{"status":"all"}'::jsonb)), 1, 'IT queue lists only IT tickets');
select test.eq(public.hr_helpdesk_queue('{}'::jsonb) -> 0 ->> 'employee_name', 'Asha Test', 'IT queue shows the requester name');
select test.eq(test.count_rows($q$select 1 from public.hr_employees where id = pg_temp.id('emp1')$q$), 0::bigint, 'IT admin has no employee-master access');
select test.throws($q$select public.hr_helpdesk_ticket(pg_temp.id('hr1'))$q$, 'IT admin cannot open HR ticket', 'not found');
select test.throws($q$select public.hr_comment_hr_request(pg_temp.id('hr1'), 'hi')$q$, 'IT admin cannot reply on HR ticket', 'not found');
select test.throws($q$select public.hr_update_hr_request_status(pg_temp.id('wp1'), 'in_progress')$q$, 'IT admin cannot touch confidential ticket', 'not found');

select public.hr_comment_hr_request(pg_temp.id('it1'), 'Internal: likely the adapter.', true);
select test.as_owner();
select test.ok((select first_response_at is null from public.hr_requests where id = pg_temp.id('it1')), 'internal note is not a first response');
select pg_temp.as_k('it');
select public.hr_comment_hr_request(pg_temp.id('it1'), 'Please try another socket and tell us the result.', false);
select test.as_owner();
select test.ok((select first_response_at is not null from public.hr_requests where id = pg_temp.id('it1')), 'public reply sets first response');

select pg_temp.as_k('it');
select test.eq(jsonb_array_length(public.hr_helpdesk_assignees(pg_temp.id('it1'))) >= 2, true, 'IT admins are assignable to IT tickets');
select test.ok(not (public.hr_helpdesk_assignees(pg_temp.id('it1')) @> jsonb_build_array(jsonb_build_object('id', pg_temp.id('emp1')))),
  'requester is not assignable');
select public.hr_assign_hr_request(pg_temp.id('it1'), pg_temp.id('it2'));
select test.throws($q$select public.hr_assign_hr_request(pg_temp.id('it1'), pg_temp.id('emp2'))$q$, 'cannot assign to non-staff', 'HR staff');

select pg_temp.as_k('it2');
select public.hr_update_hr_request_status(pg_temp.id('it1'), 'resolved', 'Replaced the charger.');
select test.eq(jsonb_array_length(public.hr_helpdesk_ticket(pg_temp.id('it1')) -> 'comments'), 2, 'handler sees internal note and reply');
select test.eq((public.hr_helpdesk_summary('{}'::jsonb) ->> 'resolved')::int, 1, 'summary counts resolved IT ticket');

-- ---- requester view, rating, close, reopen
select pg_temp.as_k('emp1');
select test.eq(jsonb_array_length(public.hr_helpdesk_ticket(pg_temp.id('it1')) -> 'comments'), 1, 'requester does not see internal notes');
select test.ok((public.hr_helpdesk_ticket(pg_temp.id('it1')) ->> 'can_rate')::boolean, 'requester can rate resolved ticket');
select test.eq(public.hr_helpdesk_ticket(pg_temp.id('it1')) ->> 'assignee_name', 'Ira Test', 'requester sees who handles the ticket');
select test.throws($q$select public.hr_rate_helpdesk_ticket(pg_temp.id('it1'), 6)$q$, 'rating must be 1..5', 'rating');
select public.hr_rate_helpdesk_ticket(pg_temp.id('it1'), 4, 'Quick fix.');
select test.throws($q$select public.hr_rate_helpdesk_ticket(pg_temp.id('it1'), 5)$q$, 'only one rating', 'already rated');
select public.hr_close_hr_request(pg_temp.id('it1'));
select public.hr_reopen_hr_request(pg_temp.id('it1'), 'Stopped charging again');
select test.ok((select status = 'open' and reopen_count = 1 and satisfaction_rating is null and sla_due_at > now() + interval '23 hours'
                from public.hr_requests where id = pg_temp.id('it1')), 'reopen counts, clears rating and resets SLA');
select test.ok((select array_agg(e ->> 'action' order by ord) @> array['submitted','assigned','updated','rated','closed','reopened']
                from jsonb_array_elements(public.hr_helpdesk_ticket(pg_temp.id('it1')) -> 'events') with ordinality x(e, ord)),
  'history records assignment, status, rating, close and reopen');
select pg_temp.as_k('emp2');
select test.throws($q$select public.hr_helpdesk_ticket(pg_temp.id('it1'))$q$, 'colleague cannot open the ticket', 'not found');
select test.throws($q$select public.hr_rate_helpdesk_ticket(pg_temp.id('it1'), 5)$q$, 'colleague cannot rate', 'not found');
select pg_temp.as_k('mgr');
select test.eq(jsonb_array_length(public.hr_helpdesk_queue('{"status":"all"}'::jsonb)), 0, 'manager sees no team tickets');

-- ---- re-prioritise / re-categorise
select pg_temp.as_k('hr');
select public.hr_assign_hr_request(pg_temp.id('hr1'), pg_temp.id('hr'));
select public.hr_update_helpdesk_ticket(pg_temp.id('hr1'), 'urgent', 'it_software', 'This is a software licence problem');
select test.as_owner();
select test.ok((select r.priority = 'urgent' and c.code = 'it_software' and r.assigned_to = pg_temp.id('hr')
                from public.hr_requests r join public.hr_request_categories c on c.id = r.category_id where r.id = pg_temp.id('hr1')),
  'ticket moved to IT and re-prioritised; HR assignee kept (HR can handle IT tickets)');
select pg_temp.as_k('it');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('hr1')$q$), 1::bigint, 'IT desk now sees the moved ticket');
select public.hr_assign_hr_request(pg_temp.id('hr1'), pg_temp.id('it'));
select public.hr_update_helpdesk_ticket(pg_temp.id('hr1'), null, 'general', 'Actually an HR policy question');
select test.as_owner();
select test.ok((select assigned_to is null from public.hr_requests where id = pg_temp.id('hr1')), 'IT assignee cleared when moved back to HR');
select pg_temp.as_k('it');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('hr1')$q$), 0::bigint, 'IT desk loses the ticket after it moves to HR');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_update_helpdesk_ticket(pg_temp.id('wp1'), null, 'general')$q$, 'confidential ticket stays confidential', 'confidential');
select test.throws($q$select public.hr_update_helpdesk_ticket(pg_temp.id('hr1'), null, 'reimbursement')$q$, 'only helpdesk categories', 'helpdesk category');
select test.throws($q$select public.hr_update_helpdesk_ticket(pg_temp.id('hr1'), 'critical')$q$, 'unknown priority rejected', 'priority');
select test.ok((select bool_or(e ->> 'action' = 'category_changed') and bool_or(e ->> 'action' = 'priority_changed')
                from jsonb_array_elements(public.hr_helpdesk_ticket(pg_temp.id('hr1')) -> 'events') e), 're-categorise and re-prioritise are in the history');
select test.eq(jsonb_array_length(public.hr_helpdesk_queue('{"area":"workplace"}'::jsonb)), 1, 'HR queue filters by area');
select test.eq(jsonb_array_length(public.hr_helpdesk_queue('{"search":"HD-"}'::jsonb)), 3, 'HR queue searches ticket numbers');
select test.ok((public.hr_helpdesk_summary('{}'::jsonb) ->> 'active')::int = 3, 'HR summary sees all three active tickets');

select test.as_anon();
select test.throws($q$select public.hr_helpdesk_queue('{}'::jsonb)$q$, 'anon cannot read the queue', 'permission denied');
select test.as_owner();

-- ---- audit redaction
select test.ok((select bool_and(coalesce(new_data ->> 'satisfaction_comment', '[redacted]') = '[redacted]')
                from public.hr_audit_log where table_name = 'hr_requests' and new_data is not null), 'satisfaction comments redacted in audit log');

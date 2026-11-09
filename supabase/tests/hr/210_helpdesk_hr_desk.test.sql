-- 210 — Restricted HR / workplace support desk (helpdesk.hr):
--   A. Catalog: helpdesk.hr exists, held only by super_admin; hr_admin unchanged;
--      hr_requests.manage unchanged.
--   B. A helpdesk.hr user sees, replies to (incl. internal notes), is assignable to,
--      re-prioritises and resolves non-confidential HR / workplace tickets.
--   C. The same user cannot read, modify, be assigned or be notified about:
--      grievance and misconduct tickets (rows, comments, internal notes, events,
--      attachments, storage objects), IT tickets, payroll queries, letters or
--      other employees' request workflows, or the audit log — via RLS and RPCs.
--   D. Backstop: grievance / misconduct stay hidden even if their category's
--      confidential flag is cleared.
-- Synthetic data only; the runner rolls the transaction back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_txt (k text primary key, v text);
grant all on t_ids, t_txt to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin perform test.as_owner(); perform test.as_user(test.user_of((select v from t_ids where k = p_k))); end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.txt(p_k text) returns text language sql as $$ select v from t_txt where k = p_k $$;
create function pg_temp.notes(p_user_k text, p_req_k text) returns bigint language plpgsql security definer as $$
declare v_out bigint;
begin
  execute 'select count(*) from public.hr_notifications where recipient_user_id = $1 and entity_id = $2'
    into v_out using test.user_of((select t.v from t_ids t where t.k = p_user_k)), (select t.v from t_ids t where t.k = p_req_k)::text;
  return v_out;
end $$;

do $$
begin
  insert into public.hr_roles (key, name) values ('hr_desk_test', 'HR desk (test)');
  insert into public.hr_role_permissions (role_key, permission_key) values ('hr_desk_test', 'helpdesk.hr');
  insert into t_ids values ('hr',    test.make_employee('hdk.hr@test.local',    'Hema', null, array['hr_admin','employee']));
  insert into t_ids values ('desk',  test.make_employee('hdk.desk@test.local',  'Dina', null, array['hr_desk_test','employee']));
  insert into t_ids values ('desk2', test.make_employee('hdk.desk2@test.local', 'Dev',  null, array['hr_desk_test','employee']));
  insert into t_ids values ('it',    test.make_employee('hdk.it@test.local',    'Ivan', null, array['it_admin','employee']));
  insert into t_ids values ('emp1',  test.make_employee('hdk.emp1@test.local',  'Asha'));
  insert into t_ids values ('emp2',  test.make_employee('hdk.emp2@test.local',  'Bodhi'));
end $$;

-- =====================================================================
-- A. Catalog
-- =====================================================================
select test.ok(exists (select 1 from public.hr_permissions where key = 'helpdesk.hr'), 'helpdesk.hr permission exists');
select test.eq((select string_agg(role_key, ',' order by role_key) from public.hr_role_permissions where permission_key = 'helpdesk.hr' and role_key <> 'hr_desk_test'),
  'super_admin', 'only super_admin holds helpdesk.hr by default');
select test.ok(not exists (select 1 from public.hr_role_permissions where role_key = 'hr_admin' and permission_key = 'helpdesk.hr'), 'HR Admin not given helpdesk.hr');
select test.ok(not exists (select 1 from public.hr_role_permissions where role_key = 'hr_desk_test' and permission_key like 'hr_requests.%'),
  'test desk role holds no hr_requests.* key');

-- =====================================================================
-- Tickets and other requests (emp1 / emp2)
-- =====================================================================
select pg_temp.as_k('emp1');
do $$ begin
  insert into t_ids values ('gen',  public.hr_create_hr_request('general', 'Dress code question', 'Is there a dress code for client visits?'));
  insert into t_ids values ('fac',  public.hr_create_hr_request('workplace_facilities', 'AC not working', 'Meeting room 2 is too warm.'));
  insert into t_ids values ('grv',  public.hr_create_hr_request('grievance', 'Grievance about workload', 'Confidential details of the grievance.'));
  insert into t_ids values ('mis',  public.hr_create_hr_request('workplace_conduct', 'Report a concern', 'Confidential details of the conduct concern.'));
  insert into t_ids values ('itk',  public.hr_create_hr_request('it_hardware', 'Laptop will not charge', 'The charger light stays off.'));
  insert into t_ids values ('payq', public.hr_create_hr_request('payroll_query', 'Payslip deduction', 'Why was PT deducted twice?'));
end $$;
-- Files on an HR-desk ticket and on the grievance (registered by the requester).
do $$ begin
  perform public.hr_register_request_attachment(pg_temp.id('gen'), 'supporting', 'dress-code.pdf', 'application/pdf', 1000);
  perform public.hr_register_request_attachment(pg_temp.id('grv'), 'supporting', 'grievance-evidence.pdf', 'application/pdf', 1000);
end $$;
select pg_temp.as_k('emp2');
do $$ begin
  insert into t_ids values ('let', public.hr_create_workflow_request('document_request',
    '{"letter_type":"experience_letter","purpose":"Visa application","addressed_to":"Consulate"}'::jsonb));
end $$;

select test.as_owner();
insert into t_txt select 'gen_path', storage_path from public.hr_request_attachments where request_id = pg_temp.id('gen');
insert into t_txt select 'grv_path', storage_path from public.hr_request_attachments where request_id = pg_temp.id('grv');
insert into storage.objects (bucket_id, name) values ('hr-request-files', pg_temp.txt('gen_path')), ('hr-request-files', pg_temp.txt('grv_path'));
-- HR Admin (hr_requests.manage) writes an internal note on the grievance.
select pg_temp.as_k('hr');
select public.hr_comment_hr_request(pg_temp.id('grv'), 'Internal: speak to both parties separately.', true);

-- =====================================================================
-- Notifications on creation
-- =====================================================================
select test.as_owner();
select test.ok(pg_temp.notes('desk', 'gen') >= 1, 'desk notified of a new HR ticket');
select test.ok(pg_temp.notes('desk', 'fac') >= 1, 'desk notified of a new workplace facilities ticket');
select test.eq(pg_temp.notes('desk', 'grv') + pg_temp.notes('desk', 'mis'), 0::bigint, 'desk not notified of grievance / misconduct tickets');
select test.eq(pg_temp.notes('desk', 'itk') + pg_temp.notes('desk', 'payq') + pg_temp.notes('desk', 'let'), 0::bigint,
  'desk not notified of IT tickets, payroll queries or letters');
select test.ok(pg_temp.notes('hr', 'grv') >= 1, 'HR Admin (hr_requests.manage) still notified of grievances');

-- =====================================================================
-- B. What the desk can do
-- =====================================================================
select pg_temp.as_k('desk');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id in (pg_temp.id('gen'), pg_temp.id('fac'))$q$), 2::bigint,
  'desk sees non-confidential HR and workplace tickets');
select test.eq(test.count_rows($q$select 1 from public.hr_request_attachments where request_id = pg_temp.id('gen')$q$), 1::bigint, 'desk sees HR ticket files');
select test.eq(test.count_rows(format('select 1 from storage.objects where bucket_id = %L and name = %L', 'hr-request-files', pg_temp.txt('gen_path'))), 1::bigint,
  'desk can read the HR ticket file from storage');
select test.ok((public.hr_helpdesk_ticket(pg_temp.id('gen')) ->> 'can_handle')::boolean, 'desk can handle the HR ticket');
select public.hr_comment_hr_request(pg_temp.id('gen'), 'Business casual for client visits.', false);
select public.hr_comment_hr_request(pg_temp.id('gen'), 'Internal: confirmed with the policy owner.', true);
select test.ok(public.hr_helpdesk_assignees(pg_temp.id('gen')) @> jsonb_build_array(jsonb_build_object('id', pg_temp.id('desk2'))),
  'desk colleagues are assignable to HR tickets');
select public.hr_assign_hr_request(pg_temp.id('gen'), pg_temp.id('desk2'));
select public.hr_update_helpdesk_ticket(pg_temp.id('fac'), 'high');
select public.hr_update_hr_request_status(pg_temp.id('fac'), 'resolved', 'Facilities fixed the AC.');
select test.as_owner();
select test.ok((select status = 'resolved' and priority = 'high' from public.hr_requests where id = pg_temp.id('fac')), 'desk re-prioritised and resolved a workplace ticket');
select test.ok(pg_temp.notes('desk2', 'gen') >= 1, 'assigned desk colleague notified');

-- =====================================================================
-- C. What the desk cannot see or do
-- =====================================================================
select pg_temp.as_k('desk');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id in (pg_temp.id('grv'), pg_temp.id('mis'))$q$), 0::bigint,
  'desk cannot see grievance or misconduct tickets');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id in (pg_temp.id('itk'), pg_temp.id('payq'), pg_temp.id('let'))$q$), 0::bigint,
  'desk cannot see IT tickets, payroll queries or letter requests');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where workflow <> 'helpdesk'$q$), 0::bigint, 'desk sees no request workflow of any employee');
select test.eq(test.count_rows($q$select 1 from public.hr_request_comments where request_id in (pg_temp.id('grv'), pg_temp.id('mis'))$q$), 0::bigint,
  'desk cannot read grievance comments or internal notes');
select test.eq(test.count_rows($q$select 1 from public.hr_request_events where request_id in (pg_temp.id('grv'), pg_temp.id('mis'))$q$), 0::bigint,
  'desk cannot read grievance history');
select test.eq(test.count_rows($q$select 1 from public.hr_request_attachments where request_id = pg_temp.id('grv')$q$), 0::bigint,
  'desk cannot list grievance attachments');
select test.eq(test.count_rows(format('select 1 from storage.objects where bucket_id = %L and name = %L', 'hr-request-files', pg_temp.txt('grv_path'))), 0::bigint,
  'desk cannot read the grievance file from storage');
select test.eq(test.count_rows($q$select 1 from public.hr_audit_log$q$), 0::bigint, 'desk cannot read the audit log');
select test.throws($q$select public.hr_helpdesk_ticket(pg_temp.id('grv'))$q$, 'desk cannot open a grievance through the RPC', 'not found');
select test.throws($q$select public.hr_comment_hr_request(pg_temp.id('mis'), 'hello', true)$q$, 'desk cannot comment on misconduct', 'not found');
select test.throws($q$select public.hr_update_hr_request_status(pg_temp.id('grv'), 'in_progress')$q$, 'desk cannot change a grievance status', 'not found');
select test.throws($q$select public.hr_assign_hr_request(pg_temp.id('grv'), pg_temp.id('desk'))$q$, 'desk cannot assign a grievance', 'not found');
select test.throws($q$select public.hr_update_helpdesk_ticket(pg_temp.id('itk'), 'low')$q$, 'desk cannot touch an IT ticket', 'not found');
select test.throws($q$select public.hr_comment_hr_request(pg_temp.id('payq'), 'hello')$q$, 'desk cannot reply to a payroll query', 'not found');
select test.ok(not (public.hr_helpdesk_queue('{"status":"all"}'::jsonb)::text ~ (pg_temp.id('grv')::text || '|' || pg_temp.id('mis')::text)),
  'helpdesk queue never lists grievance / misconduct');
select test.eq(coalesce((public.hr_helpdesk_summary('{"area":"workplace"}'::jsonb) ->> 'active')::int, 0), 0, 'workplace summary counts no confidential ticket');

-- HR Admin cannot hand a grievance to the desk.
select pg_temp.as_k('hr');
select test.ok(not (public.hr_helpdesk_assignees(pg_temp.id('grv')) @> jsonb_build_array(jsonb_build_object('id', pg_temp.id('desk')))),
  'desk is not an assignee option for a grievance');
select test.throws($q$select public.hr_assign_hr_request(pg_temp.id('grv'), pg_temp.id('desk'))$q$, 'grievance cannot be assigned to the desk', 'HR staff');

-- Moving an HR ticket into a confidential category takes it away from the desk.
select pg_temp.as_k('desk');
select public.hr_update_helpdesk_ticket(pg_temp.id('gen'), null, 'workplace_conduct', 'Turned out to be a conduct concern');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('gen')$q$), 0::bigint, 'ticket moved to misconduct disappears for the desk');
select test.as_owner();
select test.ok((select is_confidential and assigned_to is null from public.hr_requests where id = pg_temp.id('gen')),
  'moved ticket is confidential and the desk assignee is cleared');
select test.ok(not exists (select 1 from public.hr_requests r where r.id = pg_temp.id('gen') and hr_private.request_hr_desk_ticket(r.id)), 'no longer an HR-desk ticket');

-- =====================================================================
-- D. Backstop: grievance categories stay off the desk even if unflagged
-- =====================================================================
update public.hr_request_categories set is_confidential = false where code in ('grievance','workplace_conduct');
select pg_temp.as_k('emp2');
do $$ begin insert into t_ids values ('grv2', public.hr_create_hr_request('grievance', 'Second grievance', 'Details.')); end $$;
select test.as_owner();
select test.ok((select not is_confidential from public.hr_requests where id = pg_temp.id('grv2')), 'precondition: grievance filed while the category is unflagged');
select test.eq(pg_temp.notes('desk', 'grv2'), 0::bigint, 'desk not notified of an unflagged grievance');
select pg_temp.as_k('desk');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('grv2')$q$), 0::bigint, 'desk still cannot see an unflagged grievance');

-- hr_requests.manage is unchanged: HR Admin still sees every confidential ticket.
select pg_temp.as_k('hr');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id in (pg_temp.id('grv'), pg_temp.id('mis'), pg_temp.id('grv2'))$q$), 3::bigint,
  'HR Admin still sees grievances and misconduct');

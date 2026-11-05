-- Module 10 — HR Requests & Approvals (180): security lockdown (X7),
-- payroll routing (HR11), HR letters, reimbursements (receipts, manager ->
-- finance, payroll payment tracking), multi-stage approvals, return for
-- correction, delegation, self / duplicate approval, salary advances
-- (policy, eligibility, approval, agreement, disbursement with second-user
-- verification, repayments), profile changes incl. bank details, the
-- approval inbox / overview and attendance corrections via Module 5's RPC.
-- Direct table / RPC calls only. Runs inside a transaction that is rolled back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_txt (k text primary key, v text);
grant all on t_ids, t_txt to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.txt(p_k text) returns text language sql as $$ select v from t_txt where k = p_k $$;
-- Current pending stage of a request (read as owner so RLS never hides it).
create function pg_temp.stage(p_req text) returns uuid language plpgsql security definer as $$
declare v_out uuid;
begin
  execute 'select id from public.hr_request_approvals where request_id = $1 and status = ''pending''' into v_out using (select t.v from t_ids t where t.k = p_req);
  return v_out;
end $$;
create function pg_temp.req_status(p_req text) returns text language plpgsql security definer as $$
declare v_out text;
begin
  execute 'select status from public.hr_requests where id = $1' into v_out using (select t.v from t_ids t where t.k = p_req);
  return v_out;
end $$;

do $$
declare v_dept uuid;
begin
  insert into public.hr_departments (name, code) values ('Req Engineering', 'REQENG') returning id into v_dept;
  insert into t_ids values ('dept', v_dept);
  insert into t_ids values ('hr',   test.make_employee('m10.hr@test.local',   'Hema',  null, array['hr_admin','employee']));
  insert into t_ids values ('hr2',  test.make_employee('m10.hr2@test.local',  'Hans',  null, array['hr_admin','employee']));
  insert into t_ids values ('pay',  test.make_employee('m10.pay@test.local',  'Priya', null, array['payroll_admin','employee']));
  insert into t_ids values ('pay2', test.make_employee('m10.pay2@test.local', 'Pavel', null, array['payroll_admin','employee']));
  insert into t_ids values ('sa',   test.make_employee('m10.sa@test.local',   'Sara',  null, array['super_admin']));
  insert into t_ids values ('mgr',  test.make_employee('m10.mgr@test.local',  'Meru',  null, array['manager','employee']));
  insert into t_ids values ('mgr2', test.make_employee('m10.mgr2@test.local', 'Mona',  null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('m10.emp1@test.local', 'Asha',  (select v from t_ids where k = 'mgr'), array['employee'], 'full_time', v_dept));
  insert into t_ids values ('emp2', test.make_employee('m10.emp2@test.local', 'Bodhi', null));
  insert into public.hr_roles (key, name, description) values ('request_viewer', 'Request viewer', 'Test-only role');
  insert into public.hr_role_permissions values ('request_viewer', 'hr_requests.view');
  insert into t_ids values ('viewer', test.make_employee('m10.viewer@test.local', 'Vik', null, array['request_viewer']));
  insert into public.hr_projects (code, name) values ('M10-PRJ', 'Module 10 project') returning id into v_dept;
  insert into t_ids values ('proj', v_dept);
  -- Synthetic salary structures (monthly CTC 100,000 / 80,000).
  insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc, currency, status)
  values ((select v from t_ids where k = 'emp1'), current_date - 300, 1200000, 'INR', 'active'),
         ((select v from t_ids where k = 'pay'),  current_date - 300,  960000, 'INR', 'active');
end $$;

-- =====================================================================
-- A. Lockdown of internal helpers (X7)
-- =====================================================================
select test.ok(not has_schema_privilege('authenticated', 'hr_internal', 'USAGE'), 'authenticated has no usage on hr_internal');
select test.ok(not has_schema_privilege('anon', 'hr_internal', 'USAGE'), 'anon has no usage on hr_internal');
select test.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'hr_internal' and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                                                or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'no hr_internal function is executable by API roles');
select test.ok(to_regprocedure('hr_private.request_notify_staff(uuid,text,text)') is null
           and to_regprocedure('hr_private.request_staff_users(text)') is null,
  're-granted 111 helpers removed from hr_private');
select test.ok(to_regprocedure('hr_internal.request_notify_staff(uuid,text,text)') is not null, 'notify helper lives in hr_internal');
-- A later blanket grant (as 113-130 do) must not re-expose them.
grant execute on all functions in schema hr_private to authenticated, service_role;
grant execute on all functions in schema hr_internal to authenticated;
select pg_temp.as_k('emp1');
select test.throws($q$select hr_internal.request_notify_staff(gen_random_uuid(), 'spam', 'spam')$q$,
  'internal notify helper unusable even after a blanket execute grant', 'permission denied');
select test.throws($q$select * from hr_internal.permission_users('hr_requests.manage')$q$, 'internal user listing unusable', 'permission denied');
select test.as_owner();
revoke execute on all functions in schema hr_internal from authenticated;
select test.as_anon();
select test.throws($q$select public.hr_approval_inbox('all')$q$, 'anon cannot read the inbox', 'permission denied');
select test.throws($q$select public.hr_create_workflow_request('reimbursement', '{}'::jsonb)$q$, 'anon cannot create workflow requests', 'permission denied');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_role_permissions where role_key = 'payroll_admin' and permission_key = 'hr_requests.payroll')
           and not exists (select 1 from public.hr_role_permissions where role_key = 'payroll_admin' and permission_key in ('hr_requests.manage','hr_requests.view')),
  'payroll admins get routed request access without unrestricted HR request access');

-- =====================================================================
-- B. Payroll-routed helpdesk requests are visible to payroll (HR11)
-- =====================================================================
select pg_temp.as_k('emp1');
do $$ begin
  insert into t_ids values ('pq', public.hr_create_hr_request('payroll_query', 'Payslip deduction', 'Why was there a deduction?'));
  insert into t_ids values ('gq', public.hr_create_hr_request('general', 'Parking', 'Need a parking slot.'));
  insert into t_ids values ('gv', public.hr_create_hr_request('grievance', 'Concern', 'Confidential concern.'));
end $$;
select test.throws($q$select public.hr_create_hr_request('reimbursement', 'Taxi', 'Taxi fare')$q$, 'workflow categories refuse the helpdesk form', 'form');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('pq')::text and recipient_user_id = test.user_of(pg_temp.id('pay'))),
  'payroll query notifies payroll admins');
select test.ok(not exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('pq')::text and recipient_user_id = test.user_of(pg_temp.id('hr'))),
  'payroll query routed to payroll, not every HR admin');
select pg_temp.as_k('pay');
select test.eq(test.count_rows('select 1 from public.hr_requests'), 1::bigint, 'payroll admin sees only the payroll-routed request');
select test.ok(exists (select 1 from public.hr_requests where id = pg_temp.id('pq')), 'payroll admin sees the payroll query');
select public.hr_comment_hr_request(pg_temp.id('pq'), 'Checking the deduction.');
select public.hr_comment_hr_request(pg_temp.id('pq'), 'Internal: statutory deduction.', true);
select public.hr_assign_hr_request(pg_temp.id('pq'), pg_temp.id('pay'));
select public.hr_update_hr_request_status(pg_temp.id('pq'), 'resolved', 'It was the configured statutory deduction.');
select test.eq(pg_temp.req_status('pq'), 'resolved', 'payroll admin resolved the routed query');
select test.throws($q$select public.hr_comment_hr_request(pg_temp.id('gq'), 'hi')$q$, 'payroll admin cannot touch general requests', 'not found');
select test.throws($q$select public.hr_assign_hr_request(pg_temp.id('pq'), pg_temp.id('mgr'))$q$, 'cannot assign to non-handler', 'HR staff');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_requests'), 0::bigint, 'managers still cannot see helpdesk requests');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_request_comments where request_id = pg_temp.id('pq')$q$), 1::bigint, 'requester does not see payroll internal note');

-- =====================================================================
-- C. HR letters
-- =====================================================================
select pg_temp.as_k('emp1');
do $$ begin
  insert into t_ids values ('let1', public.hr_create_workflow_request('document_request',
    '{"letter_type":"experience_letter","purpose":"Visa application","addressed_to":"Consulate"}'::jsonb));
  insert into t_ids values ('let2', public.hr_create_workflow_request('document_request',
    '{"letter_type":"salary_certificate","purpose":"Home loan"}'::jsonb));
end $$;
select test.throws($q$select public.hr_create_workflow_request('document_request', '{"letter_type":"other","purpose":"x"}'::jsonb)$q$, 'letter purpose validated', 'Purpose');
select test.throws($q$select public.hr_create_workflow_request('document_request', '{"letter_type":"other","purpose":"Bank"}'::jsonb)$q$, 'other letter needs a name', 'Letter name');
select test.ok((select status = 'pending_approval' and workflow = 'hr_letter' and subject = 'Letter request: Experience letter'
                from public.hr_requests where id = pg_temp.id('let1')), 'letter request submitted for approval');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('let1'), 'approve')$q$, 'requester cannot approve own letter', 'own request');
select pg_temp.as_k('mgr');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('let1'), 'approve')$q$, 'manager cannot decide HR stage', 'not found');
select pg_temp.as_k('hr');
select public.hr_decide_request_stage(pg_temp.stage('let1'), 'approve', 'Approved.');
select test.eq(pg_temp.req_status('let1'), 'approved', 'letter approved, awaiting issue');
select test.throws($q$select public.hr_issue_letter_request(pg_temp.id('let1'))$q$, 'issue needs a document or file', 'document');
do $$ begin
  insert into t_ids values ('doc1', (public.hr_register_document_upload(pg_temp.id('emp1'), 'hr_letter', 'Experience letter', 'experience.pdf', 'application/pdf', 2048) ->> 'document_id')::uuid);
  insert into t_ids values ('docx', (public.hr_register_document_upload(pg_temp.id('emp2'), 'hr_letter', 'Other employee', 'other.pdf', 'application/pdf', 2048) ->> 'document_id')::uuid);
end $$;
select test.throws($q$select public.hr_issue_letter_request(pg_temp.id('let1'), pg_temp.id('docx'))$q$, 'another employee''s document refused', 'this employee');
select public.hr_issue_letter_request(pg_temp.id('let1'), pg_temp.id('doc1'), null, 'Issued.');
select test.ok((select status = 'completed' and issued_document_id = pg_temp.id('doc1') from public.hr_requests where id = pg_temp.id('let1')),
  'letter issued through Employee Documents and request completed');
select test.throws($q$select public.hr_issue_letter_request(pg_temp.id('let1'), pg_temp.id('doc1'))$q$, 'duplicate fulfilment refused', 'already been issued');
-- Salary certificate: approved by HR, issued only by compensation-authorised staff. When Module 9
-- (129) is applied hr_admin holds documents.compensation by default; remove it here so the test
-- asserts the rule for HR staff WITHOUT compensation access in both configurations.
select test.as_owner();
delete from public.hr_role_permissions where role_key = 'hr_admin' and permission_key = 'documents.compensation';
select pg_temp.as_k('hr');
select public.hr_decide_request_stage(pg_temp.stage('let2'), 'approve');
select test.throws($q$select public.hr_register_request_attachment(pg_temp.id('let2'), 'issued_letter', 'salary.pdf', 'application/pdf', 1000)$q$,
  'HR (no payroll access) cannot upload a salary certificate', 'cannot attach');
select test.throws($q$select public.hr_issue_letter_request(pg_temp.id('let2'), pg_temp.id('doc1'))$q$, 'HR cannot issue a salary certificate', 'authorised to see compensation');
select pg_temp.as_k('pay');
select test.throws($q$select public.hr_issue_letter_request(pg_temp.id('let2'), pg_temp.id('doc1'))$q$, 'salary certificate not issued as a broadly visible document', 'compensation-restricted');
do $$ declare j jsonb; begin
  j := public.hr_register_request_attachment(pg_temp.id('let2'), 'issued_letter', 'salary certificate.pdf', 'application/pdf', 1000);
  insert into t_ids values ('salatt', (j ->> 'attachment_id')::uuid);
  insert into t_txt values ('salpath', j ->> 'storage_path');
end $$;
select test.throws($q$select public.hr_issue_letter_request(pg_temp.id('let2'), null, pg_temp.id('salatt'))$q$, 'issue refused until the file is uploaded', 'did not finish');
insert into storage.objects (bucket_id, name, owner) values ('hr-request-files', pg_temp.txt('salpath'), auth.uid());
select public.hr_issue_letter_request(pg_temp.id('let2'), null, pg_temp.id('salatt'));
select test.eq(pg_temp.req_status('let2'), 'completed', 'salary certificate issued by payroll');
select pg_temp.as_k('hr');
select test.eq(test.count_rows($q$select 1 from public.hr_request_attachments where id = pg_temp.id('salatt')$q$), 0::bigint, 'HR cannot see the issued salary certificate');
select test.eq(test.count_rows($q$select 1 from storage.objects where name = pg_temp.txt('salpath')$q$), 0::bigint, 'HR cannot read the salary certificate object');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from storage.objects where name = pg_temp.txt('salpath')$q$), 1::bigint, 'employee can download the issued letter');
select test.ok((public.hr_request_detail(pg_temp.id('let1')) -> 'issued_document' ->> 'id')::uuid = pg_temp.id('doc1'), 'employee detail links the issued document');
select test.as_owner();
-- Module 9 (129) integration: a salary certificate may be issued as a compensation-restricted
-- document, only by compensation-authorised staff. Runs only when 129's columns exist.
do $$
declare v_comp uuid; v_plain uuid; v_req uuid; v_opts jsonb;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_documents' and column_name = 'includes_compensation') then
    raise notice 'ok - Module 9 compensation documents not present: salary certificates use restricted request files only';
    return;
  end if;
  perform test.as_owner();
  insert into public.hr_roles (key, name, description) values ('compensation_hr', 'Compensation HR', 'Test-only role');
  insert into public.hr_role_permissions values ('compensation_hr', 'documents.compensation');
  insert into public.hr_user_roles (user_id, role_key) values (test.user_of(pg_temp.id('hr2')), 'compensation_hr');
  insert into public.hr_documents (employee_id, category_id, title, current_version, verification_status)
  select pg_temp.id('emp1'), c.id, 'Salary certificate (generated)', 1, 'verified' from public.hr_document_categories c where c.code = 'offer_letter'
  returning id into v_comp;
  perform test.ok((select includes_compensation from public.hr_documents where id = v_comp), '129 marks the generated certificate as compensation-restricted');
  insert into public.hr_documents (employee_id, category_id, title, current_version, verification_status)
  select pg_temp.id('emp1'), c.id, 'Plain HR letter', 1, 'verified' from public.hr_document_categories c where c.code = 'hr_letter'
  returning id into v_plain;
  perform pg_temp.as_k('emp1');
  v_req := public.hr_create_workflow_request('document_request', '{"letter_type":"salary_certificate","purpose":"Visa (129 path)"}'::jsonb);
  perform pg_temp.as_k('hr2');
  perform public.hr_decide_request_stage((select id from public.hr_request_approvals where request_id = v_req and status = 'pending'), 'approve');
  -- hr2 holds documents.compensation through a test role; hr (plain hr_admin here) does not.
  perform pg_temp.as_k('hr');
  perform test.ok(public.hr_letter_issue_options(v_req) = '[]'::jsonb, 'HR without compensation access gets no issue options');
  perform pg_temp.as_k('hr2');
  v_opts := public.hr_letter_issue_options(v_req);
  perform test.ok(v_opts @> jsonb_build_array(jsonb_build_object('id', v_comp)) and not v_opts @> jsonb_build_array(jsonb_build_object('id', v_plain)),
    'issue options list only compensation-restricted documents for a salary certificate');
  perform test.throws(format('select public.hr_issue_letter_request(%L, %L)', v_req, v_plain), 'plain document refused for a salary certificate', 'compensation-restricted');
  perform public.hr_issue_letter_request(v_req, v_comp);
  perform test.ok((select status = 'completed' and issued_document_id = v_comp from public.hr_requests where id = v_req),
    'documents.compensation holder issued the certificate through Employee Documents');
  perform test.as_owner();
end $$;
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('let1')::text and title = 'Your HR letter is ready'
                       and recipient_user_id = test.user_of(pg_temp.id('emp1'))), 'employee notified that the letter is ready');

-- =====================================================================
-- D. Reimbursements
-- =====================================================================
select pg_temp.as_k('emp1');
do $$ begin
  insert into t_txt values ('d1', (current_date - 3)::text);
  insert into t_ids values ('rb1', public.hr_create_workflow_request('reimbursement', jsonb_build_object(
    'category','travel','expense_date', pg_temp.txt('d1'),'amount','1250.5','currency','INR','purpose','Client visit taxi',
    'project_id', pg_temp.id('proj')), null, false));
end $$;
select test.ok((select status = 'draft' and details ->> 'amount' = '1250.50' and details ->> 'project_name' = 'Module 10 project'
                from public.hr_requests where id = pg_temp.id('rb1')), 'claim saved as draft with normalised amount and project');
select test.throws($q$select public.hr_create_workflow_request('reimbursement', '{"category":"travel","expense_date":"2999-01-01","amount":"10","purpose":"Taxi"}'::jsonb)$q$,
  'future expense refused', 'future');
select test.throws($q$select public.hr_create_workflow_request('reimbursement', jsonb_build_object('category','travel','expense_date',current_date::text,'amount','10','currency','USD','purpose','Taxi'))$q$,
  'unconfigured currency refused', 'Claims can be made in');
select test.throws($q$select public.hr_submit_workflow_request(pg_temp.id('rb1'))$q$, 'receipt required before submission', 'receipt');
do $$ declare j jsonb; begin
  j := public.hr_register_request_attachment(pg_temp.id('rb1'), 'receipt', 'taxi.pdf', 'application/pdf', 5000, repeat('a', 64));
  insert into t_ids values ('rcpt1', (j ->> 'attachment_id')::uuid);
  insert into t_txt values ('rpath1', j ->> 'storage_path');
end $$;
select test.throws($q$select public.hr_register_request_attachment(pg_temp.id('rb1'), 'receipt', 'run.exe', 'application/x-msdownload', 5000)$q$, 'executable refused', 'allowed');
select test.throws($q$select public.hr_submit_workflow_request(pg_temp.id('rb1'))$q$, 'submission refused before the receipt upload finished', 'did not finish');
select pg_temp.as_k('emp2');
select test.throws($q$insert into storage.objects (bucket_id, name, owner) values ('hr-request-files', pg_temp.txt('rpath1'), auth.uid())$q$,
  'another user cannot upload to the registered path', 'row-level security');
select test.throws($q$select public.hr_register_request_attachment(pg_temp.id('rb1'), 'receipt', 'x.pdf', 'application/pdf', 10)$q$, 'colleague cannot attach to my claim', 'not found');
select pg_temp.as_k('emp1');
insert into storage.objects (bucket_id, name, owner) values ('hr-request-files', pg_temp.txt('rpath1'), auth.uid());
select test.throws($q$insert into storage.objects (bucket_id, name, owner) values ('hr-request-files', pg_temp.txt('rpath1'), auth.uid())$q$,
  'receipt object cannot be overwritten', 'row-level security');
select public.hr_submit_workflow_request(pg_temp.id('rb1'));
select test.ok((select a.stage_role = 'manager' and a.approver_employee_id = pg_temp.id('mgr') from public.hr_request_approvals a
                where a.request_id = pg_temp.id('rb1') and a.status = 'pending'), 'claim routed to the reporting manager first');
select test.eq((select count(*) from public.hr_request_approvals where request_id = pg_temp.id('rb1')), 2::bigint, 'two sequential stages (manager, finance)');
select test.throws($q$select public.hr_remove_request_attachment(pg_temp.id('rcpt1'))$q$, 'receipt locked after submission', 'submitted');
select test.throws($q$select public.hr_create_workflow_request('reimbursement', jsonb_build_object('category','travel','expense_date', pg_temp.txt('d1'),'amount','1250.50','purpose','Same taxi again'))$q$,
  'duplicate claim refused', 'Duplicate');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('rb1'), 'approve')$q$, 'employee cannot approve own claim', 'own request');
update public.hr_requests set status = 'approved' where id = pg_temp.id('rb1');
select test.eq(pg_temp.req_status('rb1'), 'pending_approval', 'no direct status writes (RLS)');
select test.throws($q$insert into public.hr_request_approvals (request_id, round, stage_no, stage_role, status) values (pg_temp.id('rb1'), 9, 1, 'hr', 'approved')$q$,
  'no direct approval inserts', 'permission denied');
select test.throws($q$select * from public.hr_request_sensitive$q$, 'sensitive values not readable through the API', 'permission denied');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('rb1')$q$), 0::bigint, 'colleague cannot see the claim');
select pg_temp.as_k('pay');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('rb1'), 'approve')$q$, 'finance cannot skip the manager stage', 'not allowed');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows($q$select 1 from public.hr_request_attachments where request_id = pg_temp.id('rb1')$q$), 1::bigint, 'manager approver can review the receipt');
select test.eq(test.count_rows($q$select 1 from storage.objects where name = pg_temp.txt('rpath1')$q$), 1::bigint, 'manager approver can open the receipt file');
do $$ begin insert into t_ids values ('rb1s1', pg_temp.stage('rb1')); end $$;
select public.hr_decide_request_stage(pg_temp.id('rb1s1'), 'approve', 'OK');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.id('rb1s1'), 'approve')$q$, 'duplicate approval refused (idempotent)', 'already been decided');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('rb1'), 'approve')$q$, 'manager cannot decide the finance stage', 'not allowed');
select pg_temp.as_k('pay');
do $$ begin insert into t_ids values ('rb1s2', pg_temp.stage('rb1')); end $$;
select public.hr_decide_request_stage(pg_temp.id('rb1s2'), 'approve', 'Finance OK');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.id('rb1s2'), 'approve')$q$, 'second finance approval refused', 'already been decided');
select test.as_owner();
select test.ok((select r.status = 'approved' and z.status = 'approved' and z.amount = 1250.50 and z.category = 'travel' and z.employee_id = pg_temp.id('emp1')
                from public.hr_requests r join public.hr_reimbursements z on z.id = r.linked_entity_id where r.id = pg_temp.id('rb1')),
  'final approval writes one approved claim to Payroll');
select test.eq((select count(*) from public.hr_reimbursements where employee_id = pg_temp.id('emp1')), 1::bigint, 'exactly one payroll claim (no duplicate fulfilment)');
-- Payment follows the payroll run (simulated payroll steps).
do $$ declare v uuid; begin
  insert into public.hr_payroll_runs (period_start, period_end, status, payment_reference, paid_at)
  -- A past period: a finalized run locks attendance in its period (Module 5 / 125), which must not
  -- block the attendance correction tested below.
  values (date_trunc('month', current_date - interval '2 years')::date, (date_trunc('month', current_date - interval '2 years') + interval '1 month - 1 day')::date,
          'finalized', null, null) returning id into v;
  insert into t_ids values ('run', v);
end $$;
update public.hr_reimbursements set payroll_run_id = pg_temp.id('run') where id = (select linked_entity_id from public.hr_requests where id = pg_temp.id('rb1'));
update public.hr_payroll_runs set status = 'paid', payment_reference = 'BANK-REF-77', paid_at = now() where id = pg_temp.id('run');
update public.hr_reimbursements set status = 'paid' where payroll_run_id = pg_temp.id('run');
select test.eq(pg_temp.req_status('rb1'), 'completed', 'claim completed when payroll marks it paid');
select test.ok(exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('rb1')::text and title = 'Reimbursement paid'), 'employee notified of payment');
select pg_temp.as_k('emp1');
select test.ok((select d -> 'payment' ->> 'claim_status' = 'paid' and not (d -> 'payment' ? 'payment_reference')
                from (select public.hr_request_detail(pg_temp.id('rb1')) d) s), 'employee sees paid status without the bank batch reference');
select pg_temp.as_k('pay');
select test.eq(public.hr_request_detail(pg_temp.id('rb1')) -> 'payment' ->> 'payment_reference', 'BANK-REF-77', 'finance sees the payment reference');

-- =====================================================================
-- E. Return for correction, resubmission, rejection
-- =====================================================================
select pg_temp.as_k('emp1');
do $$ declare j jsonb; begin
  insert into t_ids values ('rb2', public.hr_create_workflow_request('reimbursement', jsonb_build_object(
    'category','meals','expense_date',(current_date - 1)::text,'amount','300','purpose','Team lunch'), null, false));
  j := public.hr_register_request_attachment(pg_temp.id('rb2'), 'receipt', 'lunch.jpg', 'image/jpeg', 3000, repeat('a', 64));
  insert into storage.objects (bucket_id, name, owner) values ('hr-request-files', j ->> 'storage_path', auth.uid());
end $$;
select test.throws($q$select public.hr_submit_workflow_request(pg_temp.id('rb2'))$q$, 'a receipt already used on another claim is refused', 'already used');
do $$ declare j jsonb; begin
  perform public.hr_remove_request_attachment((select id from public.hr_request_attachments where request_id = pg_temp.id('rb2')));
  j := public.hr_register_request_attachment(pg_temp.id('rb2'), 'receipt', 'lunch2.jpg', 'image/jpeg', 3000, repeat('b', 64));
  insert into storage.objects (bucket_id, name, owner) values ('hr-request-files', j ->> 'storage_path', auth.uid());
end $$;
select public.hr_submit_workflow_request(pg_temp.id('rb2'));
select pg_temp.as_k('mgr');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('rb2'), 'return')$q$, 'return needs a comment', 'comment');
select public.hr_decide_request_stage(pg_temp.stage('rb2'), 'return', 'Please split the alcohol from the meal.');
select test.eq(pg_temp.req_status('rb2'), 'returned', 'request returned for correction');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('rb2')::text and title = 'More information required'),
  'employee notified that more information is required');
select pg_temp.as_k('emp1');
select public.hr_update_workflow_request(pg_temp.id('rb2'), jsonb_build_object('category','meals','expense_date',(current_date - 1)::text,'amount','250','purpose','Team lunch (food only)'));
select public.hr_submit_workflow_request(pg_temp.id('rb2'), 'Split as requested.');
select test.ok((select approval_round = 2 and status = 'pending_approval' and details ->> 'amount' = '250.00' from public.hr_requests where id = pg_temp.id('rb2')),
  'resubmitted in a new approval round');
select test.ok(exists (select 1 from public.hr_request_events where request_id = pg_temp.id('rb2') and action = 'resubmitted')
           and exists (select 1 from public.hr_request_events where request_id = pg_temp.id('rb2') and action = 'returned'), 'return and resubmission in history');
select pg_temp.as_k('mgr');
select public.hr_decide_request_stage(pg_temp.stage('rb2'), 'reject', 'Team lunches are not reimbursable.');
select test.eq(pg_temp.req_status('rb2'), 'rejected', 'request rejected');
select test.ok((select bool_and(status in ('returned','approved','rejected','cancelled')) from public.hr_request_approvals where request_id = pg_temp.id('rb2')),
  'no stage left open after rejection');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_cancel_hr_request(pg_temp.id('rb2'))$q$, 'rejected request cannot be cancelled', 'not yet approved');

-- =====================================================================
-- F. No manager -> HR stage; distinct approvers per stage
-- =====================================================================
select pg_temp.as_k('emp2');
do $$ declare j jsonb; begin
  insert into t_ids values ('rb3', public.hr_create_workflow_request('reimbursement', jsonb_build_object(
    'category','internet','expense_date',(current_date - 2)::text,'amount','799','purpose','Home internet for on-call'), null, false));
  j := public.hr_register_request_attachment(pg_temp.id('rb3'), 'receipt', 'net.png', 'image/png', 3000);
  insert into storage.objects (bucket_id, name, owner) values ('hr-request-files', j ->> 'storage_path', auth.uid());
  perform public.hr_submit_workflow_request(pg_temp.id('rb3'));
end $$;
select test.eq((select string_agg(stage_role, ',' order by stage_no) from public.hr_request_approvals where request_id = pg_temp.id('rb3')),
  'hr,finance', 'without a manager the manager stage is routed to HR');
select pg_temp.as_k('sa');
select public.hr_decide_request_stage(pg_temp.stage('rb3'), 'approve');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('rb3'), 'approve')$q$, 'same person cannot approve two stages', 'different approver');
select pg_temp.as_k('pay2');
select public.hr_decide_request_stage(pg_temp.stage('rb3'), 'approve');
select test.eq(pg_temp.req_status('rb3'), 'approved', 'second approver completed the finance stage');

-- =====================================================================
-- G. Delegation
-- =====================================================================
select pg_temp.as_k('emp1');
do $$ declare j jsonb; begin
  insert into t_ids values ('rb4', public.hr_create_workflow_request('reimbursement', jsonb_build_object(
    'category','equipment','expense_date',(current_date - 2)::text,'amount','2100','purpose','Keyboard and mouse'), null, false));
  j := public.hr_register_request_attachment(pg_temp.id('rb4'), 'receipt', 'kb.pdf', 'application/pdf', 3000);
  insert into storage.objects (bucket_id, name, owner) values ('hr-request-files', j ->> 'storage_path', auth.uid());
  perform public.hr_submit_workflow_request(pg_temp.id('rb4'));
end $$;
select pg_temp.as_k('mgr2');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('rb4')$q$), 0::bigint, 'other managers cannot see the claim');
select pg_temp.as_k('mgr');
select test.ok(jsonb_array_length(public.hr_approval_inbox('assigned')) >= 1, 'claim is in the manager''s assigned inbox');
select test.throws($q$select public.hr_delegate_request_stage(pg_temp.stage('rb4'), pg_temp.id('emp1'), 'Away')$q$, 'cannot delegate to the requester', 'not the requester');
select test.ok(exists (select 1 from jsonb_array_elements(public.hr_request_delegate_options(pg_temp.stage('rb4'))) x where (x ->> 'id')::uuid = pg_temp.id('mgr2')),
  'delegate options list other managers');
select public.hr_delegate_request_stage(pg_temp.stage('rb4'), pg_temp.id('mgr2'), 'On leave this week');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('rb4'), 'approve')$q$, 'original manager can no longer decide after delegating', 'not allowed');
select pg_temp.as_k('mgr2');
select public.hr_decide_request_stage(pg_temp.stage('rb4'), 'approve', 'Approved as delegate');
select test.ok((select decision_basis = 'delegate' and decided_by_employee_id = pg_temp.id('mgr2') from public.hr_request_approvals
                where request_id = pg_temp.id('rb4') and stage_no = 1), 'delegate decision recorded with its basis');

-- =====================================================================
-- H. Inbox, overview, attendance corrections (Module 5 RPC)
-- =====================================================================
select pg_temp.as_k('emp1');
do $$ declare d date := hr_private.business_today() - 1; begin
  insert into t_ids values ('att', public.hr_request_attendance_correction(d,
    (d::timestamp + time '09:00') at time zone 'Asia/Kolkata', (d::timestamp + time '18:00') at time zone 'Asia/Kolkata', 'Forgot to punch in'));
end $$;
select test.ok(not exists (select 1 from jsonb_array_elements(public.hr_approval_inbox('all')) x), 'requester''s own items never appear in their approval inbox');
select pg_temp.as_k('mgr');
select test.ok(exists (select 1 from jsonb_array_elements(public.hr_approval_inbox('assigned')) x
                       where x ->> 'source' = 'attendance_correction' and (x ->> 'id')::uuid = pg_temp.id('att')),
  'attendance correction appears in the manager''s inbox');
select public.hr_decide_attendance_correction(pg_temp.id('att'), true, 'Confirmed');
select test.ok(exists (select 1 from public.hr_attendance where employee_id = pg_temp.id('emp1') and work_date = hr_private.business_today() - 1),
  'approved correction updated attendance through the Attendance service');
select test.ok(exists (select 1 from jsonb_array_elements(public.hr_approval_inbox('approved')) x where (x ->> 'id')::uuid = pg_temp.id('att')),
  'decided correction moves to the approved box');
select pg_temp.as_k('pay');
select test.ok(exists (select 1 from jsonb_array_elements(public.hr_approval_inbox('completed')) x where (x ->> 'id')::uuid = pg_temp.id('rb1')),
  'payroll admin sees routed claims in the inbox');
select test.ok(not exists (select 1 from jsonb_array_elements(public.hr_approval_inbox('all')) x where (x ->> 'id')::uuid = pg_temp.id('gq')),
  'payroll admin inbox excludes general HR requests');
select pg_temp.as_k('hr');
select test.ok((select (o ->> 'total')::int = jsonb_array_length(public.hr_approval_inbox('all'))
                   and (o ->> 'completed')::int >= 2 and (o ->> 'rejected')::int >= 1
                from (select public.hr_requests_overview() o) s), 'overview counts come from the same records as the inbox');
select test.ok((select (o ->> 'total')::int = 1 from (select public.hr_requests_overview(jsonb_build_object('workflow','hr_letter','employee', pg_temp.id('emp1'), 'search', 'Experience')) o) s),
  'overview filters by type, employee and search');
select test.ok((select (o ->> 'total')::int >= 1 from (select public.hr_requests_overview(jsonb_build_object('department', pg_temp.id('dept'))) o) s)
           and (select (o ->> 'total')::int = 0 from (select public.hr_requests_overview(jsonb_build_object('department', pg_temp.id('dept'), 'from', (current_date + 5)::text)) o) s),
  'overview filters by department and submission date');
select pg_temp.as_k('emp2');
select test.eq(jsonb_array_length(public.hr_approval_inbox('all')), 0, 'employees have an empty approval inbox');

-- =====================================================================
-- I. Salary advances
-- =====================================================================
select pg_temp.as_k('emp1');
select test.ok((select not (e ->> 'enabled')::boolean and not (e ->> 'eligible')::boolean from (select public.hr_salary_advance_eligibility() e) s), 'advances disabled by default');
select test.throws($q$select public.hr_create_workflow_request('loan_advance', '{"amount":"1000","repayment_months":"2","reason":"Medical"}'::jsonb)$q$,
  'advance refused while the policy is disabled', 'not been enabled');
select pg_temp.as_k('pay');
select test.throws($q$select public.hr_save_request_policy('salary_advances', '{"enabled":true}'::jsonb)$q$, 'payroll cannot change company policy', 'not allowed');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_save_request_policy('salary_advances', '{"max_percent_of_monthly_ctc":500}'::jsonb)$q$, 'policy values validated', 'Check');
select public.hr_save_request_policy('salary_advances', '{"enabled":true,"max_percent_of_monthly_ctc":50,"min_service_months":6,"max_repayment_months":6}'::jsonb);
select test.ok((select active from public.hr_request_categories where code = 'loan_advance'), 'enabling the policy activates the request type');
select pg_temp.as_k('emp2');
select test.ok((select not (e ->> 'eligible')::boolean and e -> 'reasons' ->> 0 like '%salary structure%' from (select public.hr_salary_advance_eligibility() e) s),
  'employee without a salary structure is not eligible');
select pg_temp.as_k('emp1');
select test.ok((select (e ->> 'eligible')::boolean and (e ->> 'max_permitted')::numeric = 50000 from (select public.hr_salary_advance_eligibility() e) s),
  'eligibility: 50% of monthly CTC');
select test.throws($q$select public.hr_create_workflow_request('loan_advance', '{"amount":"60000","repayment_months":"3","reason":"Medical bills"}'::jsonb)$q$,
  'amount above the maximum refused', 'maximum advance');
select test.throws($q$select public.hr_create_workflow_request('loan_advance', '{"amount":"30000","repayment_months":"12","reason":"Medical bills"}'::jsonb)$q$,
  'repayment period limited by policy', 'repayment period');
do $$ begin insert into t_ids values ('adv', public.hr_create_workflow_request('loan_advance', '{"amount":"30000","repayment_months":"3","reason":"Medical bills"}'::jsonb)); end $$;
select test.ok((select status = 'pending' and amount = 30000 and installment_amount = 10000 and max_permitted = 50000 from public.hr_salary_advances where request_id = pg_temp.id('adv')),
  'advance recorded with installment and policy snapshot');
select test.eq((select string_agg(stage_role, ',' order by stage_no) from public.hr_request_approvals where request_id = pg_temp.id('adv')), 'manager,payroll', 'advance route: manager then payroll');
select test.throws($q$select public.hr_create_workflow_request('loan_advance', '{"amount":"1000","repayment_months":"1","reason":"Second one"}'::jsonb)$q$,
  'only one open advance at a time', 'open salary advance');
select pg_temp.as_k('viewer');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('adv')$q$), 0::bigint, 'read-only request viewers cannot see salary advances');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('let1')$q$), 1::bigint, 'read-only request viewers still see letter requests');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('rb1')$q$), 0::bigint, 'read-only request viewers cannot see reimbursement claims');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_salary_advances'), 0::bigint, 'manager cannot read advance records (salary-derived limits)');
select test.ok(not (public.hr_request_detail(pg_temp.id('adv')) ? 'advance'), 'manager detail has no salary-derived advance data');
select public.hr_decide_request_stage(pg_temp.stage('adv'), 'approve', 'Supported');
select pg_temp.as_k('pay');
select public.hr_decide_request_stage(pg_temp.stage('adv'), 'approve', 'Within policy');
select test.ok((select r.status = 'approved' and v.status = 'approved' from public.hr_requests r join public.hr_salary_advances v on v.request_id = r.id
                where r.id = pg_temp.id('adv')), 'advance approved by payroll');
select test.throws($q$select public.hr_record_advance_disbursement(pg_temp.id('adv'), 30000, 'NEFT-001', current_date)$q$, 'no disbursement before the agreement', 'agreement');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_accept_advance_agreement(pg_temp.id('adv'), true)$q$, 'payroll deduction cannot be authorised while the integration is off', 'not enabled');
select public.hr_accept_advance_agreement(pg_temp.id('adv'), false);
select test.throws($q$select public.hr_accept_advance_agreement(pg_temp.id('adv'))$q$, 'agreement accepted once', 'only once');
select pg_temp.as_k('pay');
select test.throws($q$select public.hr_record_advance_disbursement(pg_temp.id('adv'), 25000, 'NEFT-001', current_date)$q$, 'disbursed amount must match', 'equal the approved');
select public.hr_record_advance_disbursement(pg_temp.id('adv'), 30000, 'NEFT-001', current_date);
select test.throws($q$select public.hr_record_advance_disbursement(pg_temp.id('adv'), 30000, 'NEFT-002', current_date)$q$, 'duplicate disbursement refused', 'already been recorded');
select test.throws($q$select public.hr_verify_advance_disbursement(pg_temp.id('adv'))$q$, 'recorder cannot verify own disbursement', 'different Finance user');
select test.ok((select status = 'approved' from public.hr_requests where id = pg_temp.id('adv')), 'not paid until verified');
select pg_temp.as_k('pay2');
select public.hr_verify_advance_disbursement(pg_temp.id('adv'));
select test.ok((select r.status = 'completed' and v.status = 'repaying' from public.hr_requests r join public.hr_salary_advances v on v.request_id = r.id
                where r.id = pg_temp.id('adv')), 'verified disbursement completes the request; repayment tracking starts');
select test.throws($q$select public.hr_record_advance_repayment(pg_temp.id('adv'), 10000, 'payroll_deduction', 'PR-1', current_date, pg_temp.id('run'))$q$,
  'payroll deduction refused without policy + agreement', 'not authorised');
select public.hr_record_advance_repayment(pg_temp.id('adv'), 10000, 'direct_payment', 'RP-1', current_date);
select test.throws($q$select public.hr_record_advance_repayment(pg_temp.id('adv'), 10000, 'direct_payment', 'rp-1', current_date)$q$, 'duplicate repayment reference refused', 'already recorded');
select test.throws($q$select public.hr_record_advance_repayment(pg_temp.id('adv'), 25000, 'direct_payment', 'RP-2', current_date)$q$, 'repayment above the balance refused', 'remaining balance');
select test.eq((public.hr_request_detail(pg_temp.id('adv')) -> 'advance' ->> 'remaining_balance')::numeric, 20000::numeric, 'remaining balance tracked');
select public.hr_record_advance_repayment(pg_temp.id('adv'), 20000, 'direct_payment', 'RP-2', current_date);
select test.eq((select status from public.hr_salary_advances where request_id = pg_temp.id('adv')), 'repaid', 'advance fully repaid');
-- Payroll admins cannot approve their own advance.
select pg_temp.as_k('pay');
do $$ begin insert into t_ids values ('advp', public.hr_create_workflow_request('loan_advance', '{"amount":"10000","repayment_months":"2","reason":"Rent deposit"}'::jsonb)); end $$;
select test.eq((select string_agg(stage_role, ',' order by stage_no) from public.hr_request_approvals where request_id = pg_temp.id('advp')), 'hr,payroll',
  'no manager: manager stage routed to HR');
select pg_temp.as_k('hr');
select public.hr_decide_request_stage(pg_temp.stage('advp'), 'approve');
select pg_temp.as_k('pay');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('advp'), 'approve')$q$, 'payroll admin cannot approve own advance', 'own request');
select pg_temp.as_k('pay2');
select public.hr_decide_request_stage(pg_temp.stage('advp'), 'approve');
select pg_temp.as_k('pay');
select public.hr_accept_advance_agreement(pg_temp.id('advp'));
select test.throws($q$select public.hr_record_advance_disbursement(pg_temp.id('advp'), 10000, 'NEFT-SELF', current_date)$q$, 'payroll admin cannot pay out own advance', 'own advance');
select pg_temp.as_k('hr');
select test.eq(test.count_rows($q$select 1 from public.hr_audit_log where table_name like 'hr_salary_advance%'$q$), 0::bigint,
  'advance audit rows hidden from auditors without payroll access');

-- =====================================================================
-- J. Profile changes (contact + bank)
-- =====================================================================
select test.as_owner();
insert into public.hr_employee_private (employee_id, phone, city) values (pg_temp.id('emp1'), '+91 90000 00001', 'Pune')
  on conflict (employee_id) do update set phone = excluded.phone, city = excluded.city;
insert into public.hr_employee_bank_accounts (employee_id, bank_name, account_holder, account_number, ifsc, is_primary, verified, active)
values (pg_temp.id('emp1'), 'Old Bank', 'Asha Test', '111122223333', 'OLDB0001234', true, true, true);
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_create_workflow_request('profile_update', '{"reason":"Moved"}'::jsonb, '{"contact":{"phone":"abc"}}'::jsonb)$q$, 'phone validated', 'digits');
select test.throws($q$select public.hr_create_workflow_request('profile_update', '{"reason":"Moved"}'::jsonb, '{"contact":{"salary":"1"}}'::jsonb)$q$, 'unknown fields refused', 'cannot be changed');
select test.throws($q$select public.hr_create_workflow_request('profile_update', '{"reason":"Moved"}'::jsonb, '{"contact":{"city":"Pune"}}'::jsonb)$q$, 'unchanged values refused', 'at least one');
do $$ begin insert into t_ids values ('pc1', public.hr_create_workflow_request('profile_update', '{"reason":"Moved to a new flat"}'::jsonb,
  '{"contact":{"phone":"+91 98888 77777","city":"Mumbai","address_line1":"12 Sea View Road"}}'::jsonb)); end $$;
select test.eq((select phone from public.hr_employee_private where employee_id = pg_temp.id('emp1')), '+91 90000 00001', 'record not modified before approval');
select test.ok((select details -> 'fields' @> '["phone","city","address_line1"]'::jsonb and details::text not like '%98888%' from public.hr_requests where id = pg_temp.id('pc1')),
  'request row lists changed fields but holds no values');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('pc1')$q$), 0::bigint, 'manager cannot see profile changes');
select pg_temp.as_k('pay');
select test.eq(test.count_rows($q$select 1 from public.hr_requests where id = pg_temp.id('pc1')$q$), 0::bigint, 'payroll cannot see contact-only profile changes');
select pg_temp.as_k('hr');
select test.ok((select bool_and(coalesce(x ->> 'current', '') <> '[restricted]' and x ->> 'proposed' is not null and x ->> 'proposed' <> '[restricted]')
                   and bool_or(x ->> 'field' = 'phone' and x ->> 'current' = '+91 90000 00001' and x ->> 'proposed' = '+91 98888 77777')
                from jsonb_array_elements(public.hr_request_detail(pg_temp.id('pc1')) -> 'profile_changes') x), 'HR reviewer sees current and proposed values');
select public.hr_decide_request_stage(pg_temp.stage('pc1'), 'approve');
select test.ok((select phone = '+91 98888 77777' and city = 'Mumbai' and address_line1 = '12 Sea View Road' from public.hr_employee_private where employee_id = pg_temp.id('emp1')),
  'approved change applied to Employee Management');
select test.eq(pg_temp.req_status('pc1'), 'completed', 'profile change completed');
select test.as_owner();
select test.ok((select previous ->> 'phone' = '+91 90000 00001' from public.hr_request_sensitive where request_id = pg_temp.id('pc1')), 'previous values preserved');
select test.ok(exists (select 1 from public.hr_employee_history where employee_id = pg_temp.id('emp1') and new_value like 'Profile change applied:%'), 'change history recorded');
select test.ok(not exists (select 1 from public.hr_notifications where coalesce(body, '') || title like '%98888%'), 'notifications contain no personal values');
-- Bank details: payroll-only review, values never in audit or notifications.
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_create_workflow_request('profile_update', '{"reason":"New bank"}'::jsonb, '{"bank":{"bank_name":"New Bank","account_holder":"Asha Test","account_number":"12"}}'::jsonb)$q$,
  'account number validated', 'account number');
do $$ begin insert into t_ids values ('pc2', public.hr_create_workflow_request('profile_update', '{"reason":"Salary account moved"}'::jsonb,
  '{"bank":{"bank_name":"New Bank","account_holder":"Asha Test","account_number":"9988 7766 5544","ifsc":"newb0004321"}}'::jsonb)); end $$;
select test.eq((select string_agg(stage_role, ',' order by stage_no) from public.hr_request_approvals where request_id = pg_temp.id('pc2')), 'payroll', 'bank-only change reviewed by payroll');
select test.ok((select x -> 'proposed' ->> 'account_number' = '••••5544' from jsonb_array_elements(public.hr_request_detail(pg_temp.id('pc2')) -> 'profile_changes') x),
  'requester sees the new account masked');
select pg_temp.as_k('hr');
select test.ok((select x ->> 'proposed' = '[restricted]' and x ->> 'current' = '[restricted]'
                from jsonb_array_elements(public.hr_request_detail(pg_temp.id('pc2')) -> 'profile_changes') x), 'HR cannot see bank values');
select test.throws($q$select public.hr_decide_request_stage(pg_temp.stage('pc2'), 'approve')$q$, 'HR cannot approve bank changes', 'not allowed');
select pg_temp.as_k('pay');
select test.ok((select x -> 'proposed' ->> 'account_number' = '998877665544' and x -> 'current' ->> 'account_number' = '111122223333'
                from jsonb_array_elements(public.hr_request_detail(pg_temp.id('pc2')) -> 'profile_changes') x), 'payroll reviewer sees full current and proposed bank details');
select public.hr_decide_request_stage(pg_temp.stage('pc2'), 'approve', 'Verified with cancelled cheque');
select test.as_owner();
select test.ok((select count(*) = 1 and bool_and(account_number = '998877665544' and ifsc = 'NEWB0004321' and not verified)
                from public.hr_employee_bank_accounts where employee_id = pg_temp.id('emp1') and active and is_primary),
  'new primary bank account applied, unverified until a second Payroll user verifies it');
select test.ok((select not active from public.hr_employee_bank_accounts where employee_id = pg_temp.id('emp1') and account_number = '111122223333'), 'old account kept (inactive) as history');
select test.ok((select created_by = test.user_of(pg_temp.id('pay')) from public.hr_employee_bank_accounts
                where employee_id = pg_temp.id('emp1') and active and is_primary), 'approving payroll user recorded as the maker of the new account');
-- Separate-person verification (Module 7 / 170: hr_verify_bank_account). Runs only when that RPC exists.
do $$
declare v_acct uuid;
begin
  if to_regprocedure('public.hr_verify_bank_account(uuid,text)') is null then
    raise notice 'ok - bank verification RPC (Module 7) not present: account stays unverified (asserted above)';
    return;
  end if;
  select id into v_acct from public.hr_employee_bank_accounts where employee_id = pg_temp.id('emp1') and active and is_primary;
  perform pg_temp.as_k('emp1');
  perform test.throws(format('select public.hr_verify_bank_account(%L)', v_acct), 'employee cannot verify own bank account', 'not allowed');
  perform pg_temp.as_k('pay');
  perform test.throws(format('select public.hr_verify_bank_account(%L)', v_acct), 'approver of the change cannot also verify the account', 'different person');
  perform pg_temp.as_k('pay2');
  perform public.hr_verify_bank_account(v_acct, 'Second payroll check');
  perform test.as_owner();
  perform test.ok((select verified and verified_by = test.user_of(pg_temp.id('pay2')) from public.hr_employee_bank_accounts where id = v_acct),
    'a separate payroll user verified the new account');
end $$;
select test.as_owner();
select test.ok(not exists (select 1 from public.hr_audit_log where coalesce(old_data::text, '') || coalesce(new_data::text, '') || coalesce(context::text, '') like '%998877665544%'),
  'bank account number never written to the audit log');
select test.ok(not exists (select 1 from public.hr_notifications where coalesce(body, '') || title like '%5544%'), 'bank details not in notifications');

-- =====================================================================
-- K. Workflow guards on the helpdesk RPCs, cancellation
-- =====================================================================
select pg_temp.as_k('emp1');
do $$ begin insert into t_ids values ('let3', public.hr_create_workflow_request('document_request', '{"letter_type":"address_confirmation","purpose":"Bank KYC"}'::jsonb)); end $$;
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_update_hr_request_status(pg_temp.id('let3'), 'resolved', 'done')$q$, 'helpdesk status change cannot bypass approvals', 'approval workflow');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_close_hr_request(pg_temp.id('let3'))$q$, 'workflow requests are not closed through the helpdesk RPC', 'resolved');
select public.hr_cancel_hr_request(pg_temp.id('let3'));
select test.ok((select r.status = 'cancelled' and not exists (select 1 from public.hr_request_approvals a where a.request_id = r.id and a.status in ('pending','waiting'))
                from public.hr_requests r where r.id = pg_temp.id('let3')), 'cancelled request leaves no open approval step');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_decide_request_stage((select id from public.hr_request_approvals where request_id = pg_temp.id('let3') limit 1), 'approve')$q$,
  'cancelled request cannot be approved', 'already been decided');
select test.as_owner();
select test.throws($q$update public.hr_request_events set note = 'tampered' where request_id = pg_temp.id('rb1')$q$, 'history is append-only', 'append-only');
select test.throws($q$update public.hr_request_approvals set status = 'rejected' where id = pg_temp.id('rb1s1')$q$, 'decided approval steps are immutable', 'cannot be changed');
select test.ok((select bool_and(new_data ->> 'details' = '[redacted]') from public.hr_audit_log where table_name = 'hr_requests' and new_data ? 'details'),
  'request details redacted in the audit log');

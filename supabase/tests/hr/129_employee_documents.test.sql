-- Module 9 — Employee Documents: uploads + HR notification, verification
-- history, compensation restriction, templates + letters, offer filing,
-- contracts (renewal / attachments), certificates, policies (versions,
-- audience, files), acknowledgements + reminders, staged expiry reminders,
-- renewal requests, overview / directory, settings. Synthetic data only.
-- Runs inside a transaction that the runner rolls back.

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
-- Simulate the browser's storage upload as the current user (storage RLS applies).
create function pg_temp.put(p_path text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner) values ('hr-documents', p_path, auth.uid())
$$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

do $$
declare dep uuid; dep2 uuid;
begin
  insert into public.hr_departments (code, name) values ('M9DOC', 'M9 Docs Dept') returning id into dep;
  insert into public.hr_departments (code, name) values ('M9OTH', 'M9 Other Dept') returning id into dep2;
  insert into t_ids values ('dep', dep), ('dep2', dep2);
  insert into public.hr_roles (key, name, description, is_system) values ('doc_clerk', 'Doc clerk (test)', 'documents only', false);
  insert into public.hr_role_permissions (role_key, permission_key) values ('doc_clerk', 'documents.manage'), ('doc_clerk', 'documents.view');
  insert into t_ids values ('hr',    test.make_employee('m9.hr@test.local', 'Hana', null, array['hr_admin','employee']));
  insert into t_ids values ('hr2',   test.make_employee('m9.hr2@test.local', 'Hugo', null, array['hr_admin']));
  insert into t_ids values ('clerk', test.make_employee('m9.clerk@test.local', 'Cleo', null, array['doc_clerk','employee']));
  insert into t_ids values ('mgr',   test.make_employee('m9.mgr@test.local', 'Milo', null, array['manager','employee'], 'full_time', dep));
  insert into t_ids values ('emp1',  test.make_employee('m9.emp1@test.local', 'Edda', (select v from t_ids where k='mgr'), array['employee'], 'full_time', dep));
  insert into t_ids values ('emp2',  test.make_employee('m9.emp2@test.local', 'Omar', null, array['employee'], 'full_time', dep2));
  insert into t_ids values ('intern', test.make_employee('m9.intern@test.local', 'Ines', null, array['intern'], 'intern', dep));
end $$;

-- ---- permission, categories, settings
select test.ok(exists (select 1 from public.hr_role_permissions where role_key = 'hr_admin' and permission_key = 'documents.compensation'), 'HR Admin holds documents.compensation');
select test.ok(not exists (select 1 from public.hr_role_permissions where role_key = 'manager' and permission_key = 'documents.compensation'), 'managers do not hold documents.compensation');
select test.eq((select doc_group from public.hr_document_categories where code = 'employment_agreement'), 'contract', 'employment agreement is a contract');
select test.eq((select count(*) from public.hr_document_categories where code in ('appointment_letter','internship_certificate','employment_confirmation','experience_letter','relieving_letter','contract_attachment')),
  6::bigint, 'new document categories seeded');
select test.ok((select contains_compensation from public.hr_document_categories where code = 'offer_letter'), 'offer letters are compensation documents');
select test.eq((select count(*) from public.hr_document_templates where status = 'approved' and approved_version = 1), 7::bigint, 'seven approved default templates');

select pg_temp.as_k('hr');
select test.eq(public.hr_document_settings() -> 'expiry_reminder_days', '[30, 15, 7, 0]'::jsonb, 'default reminder schedule 30/15/7/0');
select test.throws($q$select public.hr_save_document_settings('{"expiry_reminder_days":[400]}')$q$, 'reminder day over 365 rejected', 'between 0 and 365');
select test.throws($q$select public.hr_save_document_settings('{"expiry_reminder_days":[]}')$q$, 'empty schedule rejected', 'between 1 and 8');
select test.throws($q$select public.hr_save_document_settings('{"email_reminders":"yes"}')$q$, 'non-boolean flag rejected', 'true or false');
select test.eq(public.hr_save_document_settings('{"expiry_reminder_days":[7,30,15,0,15]}') -> 'expiry_reminder_days', '[30, 15, 7, 0]'::jsonb, 'schedule normalised (sorted, unique)');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_save_document_settings('{"notify_manager":true}')$q$, 'employee cannot change document settings', 'not allowed');
select test.throws($q$select public.hr_document_settings()$q$, 'employee cannot read document settings', 'not allowed');
select test.as_owner();

-- ---- employee upload -> HR notified only once the file lands
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('emp1');
  r := public.hr_register_document_upload_ex(pg_temp.id('emp1'), 'internship_certificate', 'Internship cert', 'cert.pdf', 'application/pdf', 4000,
         null, '{"issue_date":"2026-01-15"}');
  insert into t_ids values ('cert', (r ->> 'document_id')::uuid);
  insert into t_txt values ('cert_path', r ->> 'storage_path');
  perform test.throws($q$select public.hr_register_document_upload_ex(pg_temp.id('emp1'), 'other', 'x', 'a.pdf', 'application/pdf', 10, null, '{"renewal_date":"2027-01-01"}')$q$,
    'employee cannot set HR-only details', 'Only HR');
  perform test.as_owner();
end $$;
select test.eq((select issue_date from public.hr_documents where id = pg_temp.id('cert')), '2026-01-15'::date, 'employee set the issue date on their upload');
select test.ok(not exists (select 1 from public.hr_notifications where type = 'document_uploaded' and entity_id = pg_temp.id('cert')::text), 'no HR notification before the file is stored');
select pg_temp.as_k('emp1');
select pg_temp.put(pg_temp.txt('cert_path'));
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where type = 'document_uploaded' and entity_id = pg_temp.id('cert')::text
  and recipient_user_id = test.user_of(pg_temp.id('hr')) and link = '/hr/documents?tab=verification'), 'HR notified when the employee upload lands');
select test.ok(not exists (select 1 from public.hr_notifications where type = 'document_uploaded' and entity_id = pg_temp.id('cert')::text
  and recipient_user_id = test.user_of(pg_temp.id('emp1'))), 'uploader is not notified about their own upload');

-- HR uploading for an employee does not create a verification alert.
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('hr');
  r := public.hr_register_document_upload(pg_temp.id('emp1'), 'id_proof', 'ID by HR', 'id.pdf', 'application/pdf', 900);
  insert into t_ids values ('idhr', (r ->> 'document_id')::uuid);
  perform pg_temp.put(r ->> 'storage_path');
  perform test.as_owner();
end $$;
select test.ok(not exists (select 1 from public.hr_notifications where type = 'document_uploaded' and entity_id = pg_temp.id('idhr')::text), 'HR upload raises no verification alert');

-- ---- verification with notes + history
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_review_document(pg_temp.id('cert'), true)$q$, 'employee cannot review documents', 'not allowed');
select test.as_owner();
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_review_document(pg_temp.id('cert'), false, null, 'blurry')$q$, 'rejection needs a reason', 'reason');
select public.hr_review_document(pg_temp.id('cert'), false, 'Scan is unreadable', 'Checked against original');
select test.eq((select verification_status || '|' || rejection_reason || '|' || verification_notes from public.hr_documents where id = pg_temp.id('cert')),
  'rejected|Scan is unreadable|Checked against original', 'rejected with reason and notes');
select test.as_owner();
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('emp1');
  r := public.hr_new_document_version(pg_temp.id('cert'), 'cert-v2.pdf', 'application/pdf', 5000);
  perform pg_temp.put(r ->> 'storage_path');
  perform pg_temp.as_k('hr');
  perform public.hr_review_document(pg_temp.id('cert'), true, null, 'Matches university record');
  perform test.as_owner();
end $$;
select test.eq((select string_agg(to_status, '>' order by id) from public.hr_document_reviews where document_id = pg_temp.id('cert')),
  'rejected>pending>verified', 'verification history records every change');
select test.eq((select notes from public.hr_document_reviews where document_id = pg_temp.id('cert') and to_status = 'verified'), 'Matches university record', 'history keeps review notes');
select test.eq((select version from public.hr_document_reviews where document_id = pg_temp.id('cert') and to_status = 'verified'), 2, 'history records the version reviewed');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_document_reviews where document_id = pg_temp.id('cert')$q$), 3::bigint, 'employee reads the history of their document');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows($q$select 1 from public.hr_document_reviews where document_id = pg_temp.id('cert')$q$), 0::bigint, 'colleague cannot read the history');
select test.as_owner();
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('hr');
  r := public.hr_register_document_upload(pg_temp.id('hr'), 'other', 'My own', 'own.pdf', 'application/pdf', 100);
  insert into t_ids values ('hrown', (r ->> 'document_id')::uuid);
  perform pg_temp.put(r ->> 'storage_path');
  perform test.throws(format('select public.hr_review_document(%L, true)', r ->> 'document_id'), 'HR cannot verify own document', 'own documents');
  perform test.as_owner();
end $$;

-- ---- templates
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_save_document_template(null, '{"name":"Bad","template_type":"other_letter","category_code":"hr_letter","title":"T {{employee_name}}","body":"Hello {{employee_name}} {{password}} and more text"}')$q$,
  'unknown placeholder rejected', 'Unknown placeholder');
select test.throws($q$select public.hr_save_document_template(null, '{"name":"Bad2","template_type":"other_letter","category_code":"hr_letter","title":"Title","body":"Hello {% if x %} yes {% endif %} long enough"}')$q$,
  'template logic syntax rejected', 'plain text');
select test.throws($q$select public.hr_save_document_template(null, '{"name":"Bad3","template_type":"other_letter","category_code":"hr_letter","title":"Title","body":"Hello {{employee_name} unbalanced body text here"}')$q$,
  'unclosed placeholder rejected', 'not closed');
select test.throws($q$select public.hr_save_document_template(null, '{"name":"Bad4","template_type":"other_letter","category_code":"hr_confidential","title":"Title","body":"Hello {{employee_name}} long enough body"}')$q$,
  'confidential category not allowed for letters', 'non-confidential');
select test.throws($q$select public.hr_save_document_template(null, '{"name":"Bad5","template_type":"other_letter","category_code":"offer_letter","title":"Title","body":"Hello {{employee_name}} long enough body"}')$q$,
  'offer letter templates stay in Recruitment', 'Recruitment');
do $$
declare v uuid;
begin
  perform pg_temp.as_k('hr');
  v := public.hr_save_document_template(null, '{"name":"Address proof letter","template_type":"other_letter","category_code":"hr_letter","title":"Address proof — {{employee_name}}","body":"This is to confirm that {{ employee_name }} ({{employee_id}}) works in {{department}}."}');
  insert into t_ids values ('tpl', v);
  perform test.as_owner();
end $$;
select test.eq((select status || ' v' || current_version || ' ' || coalesce(approved_version::text, 'none') from public.hr_document_templates where id = pg_temp.id('tpl')),
  'draft v1 none', 'new template starts as draft');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_preview_document_letter(pg_temp.id('tpl'), pg_temp.id('emp1'))$q$, 'unapproved template cannot be used', 'no approved version');
select test.ok((public.hr_preview_document_letter(pg_temp.id('tpl'), null, '{}', true) ->> 'body') like 'This is to confirm that Sample Employee (ZT-0000)%', 'draft preview with sample data (spaces inside braces allowed)');
select pg_temp.as_k('clerk');
select test.throws($q$select public.hr_set_document_template_status(pg_temp.id('tpl'), 'approved')$q$, 'only HR administrators approve templates', 'administrators');
select test.throws($q$select public.hr_save_document_template(null, '{"name":"Clerk CTC","template_type":"other_letter","category_code":"hr_letter","title":"Pay","body":"Your CTC is {{currency}} {{annual_ctc}} per year."}')$q$,
  'compensation placeholders need documents.compensation', 'compensation');
select pg_temp.as_k('hr');
select public.hr_set_document_template_status(pg_temp.id('tpl'), 'approved');
select public.hr_save_document_template(pg_temp.id('tpl'), '{"body":"Revised: {{employee_name}} ({{employee_id}}) works in {{department}} at {{company_name}}."}');
select test.eq((select status || ' v' || current_version || ' approved v' || approved_version from public.hr_document_templates where id = pg_temp.id('tpl')),
  'draft v2 approved v1', 'editing an approved template opens draft v2; v1 stays in use');
select test.ok((public.hr_preview_document_letter(pg_temp.id('tpl'), pg_temp.id('emp1')) ->> 'body') like 'This is to confirm%', 'issuing preview uses the approved snapshot');
select public.hr_set_document_template_status(pg_temp.id('tpl'), 'approved');
select test.ok((public.hr_preview_document_letter(pg_temp.id('tpl'), pg_temp.id('emp1')) ->> 'body') like 'Revised: Edda Test%', 'approved v2 is now used');
select test.eq((select count(*) from public.hr_document_template_versions where template_id = pg_temp.id('tpl')), 2::bigint, 'template version history kept');
select test.as_owner();
select test.throws($q$update public.hr_document_template_versions set body = 'x' where template_id = pg_temp.id('tpl')$q$, 'approved template snapshots are immutable', 'permanent');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_document_templates'), 0::bigint, 'employees cannot read templates');
select test.throws($q$select public.hr_preview_document_letter(pg_temp.id('tpl'), pg_temp.id('emp1'))$q$, 'employees cannot generate letters', 'not allowed');
select test.as_owner();

-- ---- appointment letter: preview, issue, PDF registration, acknowledgement
select pg_temp.as_k('hr');
select test.ok((select (public.hr_preview_document_letter(id, pg_temp.id('emp1')) -> 'missing') ?& array['signatory_name','terms_and_conditions']
                from public.hr_document_templates where code = 'appointment_letter'), 'preview lists missing details');
select test.throws($q$select public.hr_issue_document_letter((select id from public.hr_document_templates where code = 'appointment_letter'), pg_temp.id('emp1'))$q$,
  'issuing with missing details fails', 'Fill in');
select test.throws($q$select public.hr_issue_document_letter((select id from public.hr_document_templates where code = 'appointment_letter'), pg_temp.id('emp1'), '{"employee_name":"Someone Else"}')$q$,
  'identity fields cannot be overridden', 'cannot be set');
select test.throws($q$select public.hr_issue_document_letter((select id from public.hr_document_templates where code = 'appointment_letter'), pg_temp.id('hr'), '{"signatory_name":"A","signatory_title":"B","terms_and_conditions":"C","work_location":"W"}')$q$,
  'HR cannot issue a letter to themselves', 'yourself');
select test.as_owner();
insert into public.hr_designations (name) values ('M9 Analyst Engineer') on conflict (name) do nothing;
insert into public.hr_locations (name) values ('M9 Head Office') on conflict (name) do nothing;
update public.hr_employees set designation_id = (select id from public.hr_designations where name = 'M9 Analyst Engineer'),
       work_location_id = (select id from public.hr_locations where name = 'M9 Head Office') where id = pg_temp.id('emp1');
do $$
declare v jsonb; t uuid := (select id from public.hr_document_templates where code = 'appointment_letter'); p jsonb; vals jsonb;
begin
  perform pg_temp.as_k('hr');
  vals := '{"signatory_name":"Demo Signatory","signatory_title":"HR Director","terms_and_conditions":"Standard terms {{annual_ctc}} apply.","issue_date":"2026-11-01"}';
  p := public.hr_preview_document_letter(t, pg_temp.id('emp1'), vals);
  v := public.hr_issue_document_letter(t, pg_temp.id('emp1'), vals);
  insert into t_ids values ('appt', (v ->> 'document_id')::uuid);
  perform test.eq(v ->> 'body', p ->> 'body', 'issued text is exactly the preview');
  perform test.ok((v ->> 'body') like '%Standard terms { {annual_ctc} } apply.%', 'values cannot inject placeholders');
  perform test.ok((v ->> 'body') like '%Edda Test%' and (v ->> 'body') like '%Demo Signatory%', 'letter merged employee and signatory details');
  perform test.ok((v ->> 'reference') like 'APPOINTM/%/1', 'reference is template/employee/sequence');
  perform test.throws(format('select public.hr_issue_document_letter(%L, %L, %L)', t, pg_temp.id('emp1'), vals), 're-issue blocked while the PDF is pending', 'waiting for its PDF');
  v := public.hr_register_letter_file(pg_temp.id('appt'), 2048, repeat('a', 64));
  insert into t_txt values ('appt_path', v ->> 'storage_path');
  perform test.eq((v ->> 'version')::int, 1, 'first PDF is version 1');
  perform test.ok((v ->> 'storage_path') like pg_temp.id('emp1')::text || '/' || pg_temp.id('appt')::text || '/1-Appointment_letter_%.pdf', 'letter stored under the employee folder');
  perform test.throws(format('select public.hr_register_letter_file(%L, 10)', pg_temp.id('appt')), 'one PDF per issued text', 'no issued letter waiting');
  perform pg_temp.put(v ->> 'storage_path');
  perform test.as_owner();
end $$;
select test.eq((select verification_status || '|' || source || '|' || requires_acknowledgement from public.hr_documents where id = pg_temp.id('appt')),
  'verified|generated|true', 'issued letter verified once its PDF is stored');
select test.ok(exists (select 1 from public.hr_notifications where type = 'document_issued' and entity_id = pg_temp.id('appt')::text
  and recipient_user_id = test.user_of(pg_temp.id('emp1'))), 'employee notified of the issued letter');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_document_letter_content where document_id = pg_temp.id('appt')$q$), 1::bigint, 'employee reads their letter text');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-documents' and name = pg_temp.txt('appt_path')$q$), 1::bigint, 'employee can open their letter PDF');
select test.ok(exists (select 1 from public.hr_my_pending_acknowledgements() where item_id = pg_temp.id('appt') and version = 1), 'appointment letter awaits acknowledgement');
select test.ok(public.hr_acknowledge_document(pg_temp.id('appt')) is not null, 'employee acknowledges receipt');
select test.eq(public.hr_acknowledge_document(pg_temp.id('appt')), (select acknowledged_at from public.hr_document_acknowledgements where document_id = pg_temp.id('appt')), 'acknowledging twice is idempotent');
select test.ok((select statement like '%not a digital signature%' from public.hr_document_acknowledgements where document_id = pg_temp.id('appt')), 'acknowledgement states it is not a signature');
select test.ok(not exists (select 1 from public.hr_my_pending_acknowledgements() where item_id = pg_temp.id('appt')), 'no longer pending');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows($q$select 1 from public.hr_document_letter_content where document_id = pg_temp.id('appt')$q$), 0::bigint, 'colleague cannot read the letter text');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-documents' and name = pg_temp.txt('appt_path')$q$), 0::bigint, 'colleague cannot open the letter PDF');
select test.throws($q$select public.hr_acknowledge_document(pg_temp.id('appt'))$q$, 'colleague cannot acknowledge it', 'not found');
select test.as_owner();
select test.throws($q$update public.hr_document_acknowledgements set acknowledged_at = now() where document_id = pg_temp.id('appt')$q$, 'acknowledgements are append-only', 'permanent');
select test.throws($q$update public.hr_document_letter_content set body = 'x' where document_id = pg_temp.id('appt')$q$, 'issued letter text is immutable', 'permanent');

-- Re-issue = version 2 of the same record; acknowledgement needed again.
do $$
declare v jsonb; t uuid := (select id from public.hr_document_templates where code = 'appointment_letter');
begin
  perform pg_temp.as_k('hr');
  v := public.hr_issue_document_letter(t, pg_temp.id('emp1'), '{"signatory_name":"Demo Signatory","signatory_title":"HR Director","terms_and_conditions":"Revised terms."}');
  perform test.eq((v ->> 'document_id')::uuid, pg_temp.id('appt'), 're-issue reuses the document record');
  v := public.hr_register_letter_file(pg_temp.id('appt'), 2100);
  perform test.eq((v ->> 'version')::int, 2, 're-issue is version 2');
  perform pg_temp.put(v ->> 'storage_path');
  perform test.as_owner();
end $$;
select test.eq((select count(*) from public.hr_document_versions where document_id = pg_temp.id('appt')), 2::bigint, 'both letter versions kept');
select pg_temp.as_k('emp1');
select test.ok(exists (select 1 from public.hr_my_pending_acknowledgements() where item_id = pg_temp.id('appt') and version = 2), 'new version needs a new acknowledgement');
select test.eq(test.count_rows($q$select 1 from public.hr_document_acknowledgements where document_id = pg_temp.id('appt') and version = 1$q$), 1::bigint, 'version 1 acknowledgement kept in history');
select test.as_owner();

-- ---- compensation restriction
select pg_temp.as_k('clerk');
select test.throws($q$select public.hr_preview_document_letter((select id from public.hr_document_templates where code = 'appointment_letter_with_ctc'), pg_temp.id('emp1'))$q$,
  'clerk without documents.compensation cannot preview a CTC letter', 'not allowed');
select test.throws($q$select public.hr_issue_document_letter((select id from public.hr_document_templates where code = 'appointment_letter'), pg_temp.id('emp1'), '{"annual_ctc":"100"}')$q$,
  'clerk cannot add compensation values', 'compensation');
select test.as_owner();
do $$
declare v jsonb; t uuid := (select id from public.hr_document_templates where code = 'appointment_letter_with_ctc');
begin
  perform pg_temp.as_k('hr');
  perform test.throws(format('select public.hr_issue_document_letter(%L, %L, %L)', t, pg_temp.id('emp2'), '{"annual_ctc":"12abc"}'), 'compensation must be numeric', 'must be a number');
  v := public.hr_issue_document_letter(t, pg_temp.id('emp1'), '{"signatory_name":"S","signatory_title":"T","terms_and_conditions":"Terms","annual_ctc":"1200000","monthly_gross":"100000","currency":"INR"}');
  insert into t_ids values ('ctc', (v ->> 'document_id')::uuid);
  perform test.ok((v ->> 'body') like '%INR 1,200,000.00%', 'compensation formatted in the letter');
  v := public.hr_register_letter_file(pg_temp.id('ctc'), 3000);
  insert into t_txt values ('ctc_path', v ->> 'storage_path');
  perform pg_temp.put(v ->> 'storage_path');
  perform test.as_owner();
end $$;
select test.ok((select includes_compensation from public.hr_documents where id = pg_temp.id('ctc')), 'CTC letter flagged as compensation');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = pg_temp.id('ctc')$q$), 1::bigint, 'employee reads their own CTC letter');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = pg_temp.id('appt')$q$), 1::bigint, 'manager sees the team appointment letter (no compensation)');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = pg_temp.id('ctc')$q$), 0::bigint, 'manager cannot see the CTC letter');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-documents' and name = pg_temp.txt('ctc_path')$q$), 0::bigint, 'manager cannot open the CTC PDF');
select test.eq(test.count_rows($q$select 1 from public.hr_document_letter_content where document_id = pg_temp.id('ctc')$q$), 0::bigint, 'manager cannot read the CTC text');
select pg_temp.as_k('clerk');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = pg_temp.id('ctc')$q$), 0::bigint, 'HR clerk without documents.compensation cannot see the CTC letter');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-documents' and name = pg_temp.txt('ctc_path')$q$), 0::bigint, 'HR clerk cannot open the CTC PDF');
select test.throws($q$select public.hr_register_document_upload(pg_temp.id('emp1'), 'offer_letter', 'Offer', 'o.pdf', 'application/pdf', 100)$q$,
  'HR clerk cannot add documents to a compensation category', 'compensation');
select test.as_owner();

-- ---- offer letter filing (Recruitment owns the offer and its status)
do $$
declare v_open uuid; v_cand uuid; v_app uuid; v_offer uuid; v_emp uuid;
begin
  insert into public.hr_job_openings (title, department_id) values ('M9 Analyst', pg_temp.id('dep')) returning id into v_open;
  insert into public.hr_candidates (full_name, email) values ('M9 Candidate', 'm9.cand@test.local') returning id into v_cand;
  insert into public.hr_candidate_applications (candidate_id, opening_id, stage) values (v_cand, v_open, 'offered') returning id into v_app;
  insert into public.hr_offers (application_id, employment_type, annual_ctc, status, current_version, issued_on)
  values (v_app, 'full_time', 900000, 'sent', 1, current_date) returning id into v_offer;
  insert into public.hr_offer_letter_versions (offer_id, version, template_name, subject, body, merge_data)
  values (v_offer, 1, 'Standard offer letter', 'Offer of employment: Analyst', 'Dear M9 Candidate, CTC INR 900,000.00 ...', '{"annual_ctc":"900,000.00"}');
  v_emp := test.make_employee('m9.hired@test.local', 'Hira', null, array['employee'], 'full_time', pg_temp.id('dep'));
  update public.hr_employees set source = 'candidate', source_ref = v_app where id = v_emp;
  insert into t_ids values ('offer', v_offer), ('hired', v_emp);
end $$;
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_file_offer_letter(pg_temp.id('offer'))$q$, 'only accepted offers can be filed', 'accepted');
select test.as_owner();
update public.hr_offers set status = 'accepted', responded_at = now() where id = pg_temp.id('offer');
do $$
declare v jsonb;
begin
  perform pg_temp.as_k('hr');
  perform test.ok(exists (select 1 from jsonb_array_elements(public.hr_offer_letters_for_documents() -> 'rows') x
                          where (x ->> 'offer_id')::uuid = pg_temp.id('offer') and (x ->> 'employee_id')::uuid = pg_temp.id('hired')), 'offer listed with the hired employee');
  v := public.hr_file_offer_letter(pg_temp.id('offer'));
  insert into t_ids values ('offerdoc', (v ->> 'document_id')::uuid);
  perform test.throws(format('select public.hr_file_offer_letter(%L)', pg_temp.id('offer')), 'filing the same version twice is blocked (even before its PDF)', 'already filed');
  v := public.hr_register_letter_file(pg_temp.id('offerdoc'), 1500);
  perform pg_temp.put(v ->> 'storage_path');
  perform test.throws(format('select public.hr_file_offer_letter(%L)', pg_temp.id('offer')), 'the same offer letter version is filed once', 'already filed');
  perform test.as_owner();
end $$;
select test.eq((select source || '|' || source_ref || '|' || includes_compensation || '|' || verification_status from public.hr_documents where id = pg_temp.id('offerdoc')),
  'recruitment|' || pg_temp.id('offer')::text || '|true|verified', 'offer letter filed once, as a compensation document');
select test.eq((select status from public.hr_offers where id = pg_temp.id('offer')), 'accepted', 'offer status untouched (owned by Recruitment)');
select pg_temp.as_k('clerk');
select test.throws($q$select public.hr_file_offer_letter(pg_temp.id('offer'))$q$, 'clerk cannot file offer letters', 'not allowed');
select test.as_owner();

-- ---- contracts: upload with details, attachment, renewal
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('hr');
  r := public.hr_register_document_upload_ex(pg_temp.id('emp1'), 'employment_agreement', 'Fixed-term contract 2026', 'contract.pdf', 'application/pdf', 7000,
         hr_private.business_today() + 40,
         jsonb_build_object('contract_type', 'fixed_term', 'effective_date', hr_private.business_today() - 300, 'renewal_date', hr_private.business_today() + 10,
                            'requires_acknowledgement', true));
  insert into t_ids values ('con1', (r ->> 'document_id')::uuid);
  insert into t_txt values ('con1_path', r ->> 'storage_path');
  perform pg_temp.put(r ->> 'storage_path');
  perform test.throws(format('select public.hr_set_document_details(%L, %L)', r ->> 'document_id', '{"renewal_date":"2099-01-01"}'), 'renewal date after expiry rejected', 'on or before');
  perform test.throws(format('select public.hr_set_document_details(%L, %L)', r ->> 'document_id', '{"expiry_date":"2099-01-01"}'), 'expiry changes only through a new version', 'Unknown document field');
  r := public.hr_register_document_attachment(pg_temp.id('con1'), 'Annexure A', 'annex.pdf', 'application/pdf', 800);
  insert into t_ids values ('annex', (r ->> 'document_id')::uuid);
  perform pg_temp.put(r ->> 'storage_path');
  perform test.as_owner();
end $$;
select test.eq((select contract_type || '|' || contract_status from public.hr_documents where id = pg_temp.id('con1')), 'fixed_term|active', 'contract details stored');
select test.eq((select parent_document_id from public.hr_documents where id = pg_temp.id('annex')), pg_temp.id('con1'), 'attachment linked to the contract');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_renew_contract(pg_temp.id('con1'), 'c2.pdf', 'application/pdf', 100)$q$, 'employee cannot renew contracts', 'not allowed');
select test.as_owner();
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('hr');
  perform test.throws(format('select public.hr_renew_contract(%L, %L, %L, 100)', pg_temp.id('cert'), 'x.pdf', 'application/pdf'), 'only contracts are renewed this way', 'Only contracts');
  r := public.hr_renew_contract(pg_temp.id('con1'), 'contract-2027.pdf', 'application/pdf', 7100, hr_private.business_today() + 400,
         jsonb_build_object('effective_date', hr_private.business_today() + 41), 'Fixed-term contract 2027');
  insert into t_ids values ('con2', (r ->> 'document_id')::uuid);
  perform pg_temp.put(r ->> 'storage_path');
  perform test.throws(format('select public.hr_renew_contract(%L, %L, %L, 100)', pg_temp.id('con1'), 'x.pdf', 'application/pdf'), 'a renewed contract cannot be renewed again', 'already been renewed');
  perform test.as_owner();
end $$;
select test.eq((select verification_status || '|' || contract_status from public.hr_documents where id = pg_temp.id('con1')), 'replaced|renewed', 'old contract marked replaced / renewed');
select test.eq((select supersedes_document_id from public.hr_documents where id = pg_temp.id('con2')), pg_temp.id('con1'), 'new contract supersedes the old one');
select test.eq((select count(*) from public.hr_document_versions where document_id = pg_temp.id('con1')), 1::bigint, 'old signed contract version untouched');
select test.eq((select count(*) from storage.objects where bucket_id = 'hr-documents' and name = pg_temp.txt('con1_path')), 1::bigint, 'old signed contract file kept');
select test.eq((select contract_type || '|' || contract_status || '|' || requires_acknowledgement from public.hr_documents where id = pg_temp.id('con2')), 'fixed_term|active|true', 'renewal inherits contract type and acknowledgement');
-- Generated contract renewing the 2027 one.
do $$
declare v jsonb; t uuid := (select id from public.hr_document_templates where code = 'employment_contract');
begin
  perform pg_temp.as_k('hr');
  v := public.hr_issue_document_letter(t, pg_temp.id('emp1'), jsonb_build_object('renews_document_id', pg_temp.id('con2'), 'contract_type', 'fixed_term',
         'contract_start_date', (hr_private.business_today() + 401)::text, 'contract_end_date', (hr_private.business_today() + 800)::text,
         'signatory_name', 'S', 'signatory_title', 'T', 'terms_and_conditions', 'Terms', 'work_location', 'Office'));
  insert into t_ids values ('con3', (v ->> 'document_id')::uuid);
  perform test.ok((v ->> 'body') like '%Contract type: fixed term%', 'contract type rendered');
  perform test.as_owner();
end $$;
select test.eq((select verification_status from public.hr_documents where id = pg_temp.id('con2')), 'replaced', 'generated renewal replaces the previous contract');
select test.eq((select expiry_date from public.hr_documents where id = pg_temp.id('con3')), hr_private.business_today() + 800, 'generated contract expiry = contract end date');

-- ---- certificate generation (intern) + experience letter
do $$
declare v jsonb;
begin
  insert into public.hr_internships (employee_id, department_id, start_date, end_date, status) values (pg_temp.id('intern'), pg_temp.id('dep'), current_date - 90, current_date, 'completed');
  perform pg_temp.as_k('hr');
  v := public.hr_issue_document_letter((select id from public.hr_document_templates where code = 'internship_certificate'), pg_temp.id('intern'),
         '{"signatory_name":"S","signatory_title":"T","additional_notes":"Excellent work."}');
  perform test.ok((v ->> 'body') like '%' || to_char(current_date - 90, 'DD Mon YYYY') || '%', 'internship dates come from the internship record');
  perform test.as_owner();
end $$;

-- ---- policies
do $$
declare v jsonb;
begin
  perform pg_temp.as_k('hr');
  perform test.throws($q$select public.hr_save_policy(null, '{"title":"Policy X","audience_type":"departments"}')$q$, 'audience required', 'Choose who');
  v := public.hr_save_policy(null, jsonb_build_object('title', 'Code of conduct', 'category', 'code_of_conduct', 'content', 'Be kind. Version one text.',
         'audience_type', 'departments', 'audience_ids', jsonb_build_array(pg_temp.id('dep'))));
  insert into t_ids values ('pol', (v ->> 'policy_id')::uuid);
  perform test.eq((v ->> 'draft_version')::int, 1, 'new policy has draft v1');
  perform test.as_owner();
end $$;
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_policies'), 0::bigint, 'employees do not see draft policies');
select pg_temp.as_k('hr');
select test.eq(public.hr_publish_policy(pg_temp.id('pol')), 4, 'publishing notifies the department audience (mgr, emp1, intern, hired)');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_policies'), 1::bigint, 'employee in audience sees the published policy');
select test.eq(test.count_rows($q$select 1 from public.hr_policy_versions where content like 'Be kind%'$q$), 1::bigint, 'employee reads the published text');
select test.ok(exists (select 1 from public.hr_my_pending_acknowledgements() where item_id = pg_temp.id('pol') and version = 1), 'policy awaits acknowledgement');
select test.ok(public.hr_acknowledge_policy(pg_temp.id('pol')) is not null, 'employee acknowledges the policy');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_policies'), 0::bigint, 'employee outside the audience does not see it');
select test.throws($q$select public.hr_acknowledge_policy(pg_temp.id('pol'))$q$, 'employee outside the audience cannot acknowledge', 'not found');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_save_policy(pg_temp.id('pol'), '{"title":"Hacked"}')$q$, 'employees cannot edit policies', 'not allowed');
select test.as_owner();
select test.throws($q$update public.hr_policy_versions set content = 'silently changed' where policy_id = pg_temp.id('pol') and version = 1$q$,
  'published policy text cannot be replaced', 'cannot be changed');
select pg_temp.as_k('hr');
select test.eq((public.hr_save_policy(pg_temp.id('pol'), '{"content":"Be kind. Version two adds respect."}') ->> 'draft_version')::int, 2, 'editing a published policy opens draft v2');
select test.eq((select content from public.hr_policy_versions where policy_id = pg_temp.id('pol') and version = 1), 'Be kind. Version one text.', 'v1 text unchanged');
select test.throws($q$select public.hr_publish_policy(pg_temp.id('pol'))$q$, 'a new version needs a change summary', 'what changed');
-- PDF for v2: registered upload only, unreadable to employees until published
do $$
declare r jsonb;
begin
  perform test.throws($q$select public.hr_register_policy_file(pg_temp.id('pol'), 'p.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 100)$q$, 'policy files must be PDF', 'PDF');
  r := public.hr_register_policy_file(pg_temp.id('pol'), 'Code of Conduct v2.pdf', 'application/pdf', 5000);
  insert into t_txt values ('pol_path', r ->> 'storage_path');
  perform test.ok((r ->> 'storage_path') like 'policies/' || pg_temp.id('pol')::text || '/2-%-Code_of_Conduct_v2.pdf', 'policy file path');
  perform test.throws($q$select public.hr_publish_policy(pg_temp.id('pol'), 'Adds respect')$q$, 'cannot publish before the PDF is stored', 'finished uploading');
  perform pg_temp.put(r ->> 'storage_path');
end $$;
select pg_temp.as_k('emp1');
select test.throws($q$select pg_temp.put('policies/' || pg_temp.id('pol')::text || '/9-x-evil.pdf')$q$, 'employees cannot upload policy files', 'row-level security');
select test.eq(test.count_rows($q$select 1 from storage.objects where name = pg_temp.txt('pol_path')$q$), 0::bigint, 'draft policy file hidden from employees');
select pg_temp.as_k('hr');
select test.eq(public.hr_publish_policy(pg_temp.id('pol'), 'Adds respect'), 4, 'v2 published');
select test.eq((select string_agg(version || ':' || status, ',' order by version) from public.hr_policy_versions where policy_id = pg_temp.id('pol')),
  '1:superseded,2:published', 'v1 superseded, v2 published');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from storage.objects where name = pg_temp.txt('pol_path')$q$), 1::bigint, 'employee opens the published policy PDF');
select test.eq(test.count_rows('select 1 from public.hr_policy_versions'), 1::bigint, 'employee sees only the current published version');
select test.ok(exists (select 1 from public.hr_my_pending_acknowledgements() where item_id = pg_temp.id('pol') and version = 2), 'v2 needs a fresh acknowledgement');
select test.eq(test.count_rows($q$select 1 from public.hr_document_acknowledgements where policy_id = pg_temp.id('pol') and version = 1$q$), 1::bigint, 'v1 acknowledgement kept');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows($q$select 1 from storage.objects where name = pg_temp.txt('pol_path')$q$), 0::bigint, 'employee outside the audience cannot open the PDF');
select test.as_owner();

-- ---- acknowledgement tracking + reminders
select pg_temp.as_k('hr');
select test.eq((select (x ->> 'pending')::int from jsonb_array_elements(public.hr_acknowledgement_tracker('{"subject_type":"policy"}') -> 'by_item') x
                where (x ->> 'item_id')::uuid = pg_temp.id('pol')), 4, 'tracker: 4 pending for policy v2');
select test.eq((public.hr_acknowledgement_tracker(jsonb_build_object('employee', pg_temp.id('emp1'), 'status', 'pending')) -> 'totals' ->> 'pending')::int, 3,
  'tracker: emp1 has 3 pending (policy v2, appointment v2, contract)');
select test.eq(public.hr_send_acknowledgement_reminders(pg_temp.id('pol')), 4, 'reminders sent to pending employees');
select test.eq(public.hr_send_acknowledgement_reminders(pg_temp.id('pol')), 0, 'reminders throttled');
select test.ok(exists (select 1 from jsonb_array_elements(public.hr_acknowledgement_tracker(jsonb_build_object('policy', pg_temp.id('pol'))) -> 'rows') x
                       where (x ->> 'reminder_count')::int = 1 and x ->> 'last_reminded_at' is not null), 'tracker shows reminder status');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_acknowledgement_tracker()$q$, 'employees cannot read the tracker', 'not allowed');
select test.eq(test.count_rows('select 1 from public.hr_acknowledgement_reminders'), 0::bigint, 'employees cannot read the reminder log');
select test.eq(test.count_rows('select 1 from public.hr_document_acknowledgements'), 2::bigint, 'employee reads only their own acknowledgements');
select pg_temp.as_k('hr');
select public.hr_archive_policy(pg_temp.id('pol'));
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_policies'), 0::bigint, 'archived policy hidden from employees');
select test.ok(not exists (select 1 from public.hr_my_pending_acknowledgements() where item_id = pg_temp.id('pol')), 'archived policy no longer pending');
select test.as_owner();

-- ---- staged expiry reminders (service role = scheduler; as_of for the test)
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('hr');
  r := public.hr_register_document_upload(pg_temp.id('emp1'), 'passport', 'Passport', 'pass.pdf', 'application/pdf', 900, hr_private.business_today() + 20);
  insert into t_ids values ('pass', (r ->> 'document_id')::uuid);
  perform pg_temp.put(r ->> 'storage_path');
  perform test.as_owner();
end $$;
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_run_document_reminders()$q$, 'employees cannot run reminders', 'not allowed');
select test.as_service();
create temp table t_run as select public.hr_run_document_reminders(hr_private.business_today(), 'scheduler') as r;
select test.as_owner();
select test.ok((select stage_days = 30 from public.hr_document_reminder_log where document_id = pg_temp.id('pass')), '20 days left -> the 30-day reminder');
select test.ok(not exists (select 1 from public.hr_document_reminder_log where document_id = pg_temp.id('con1')),
  'replaced contract (renewal date in 10 days) gets no reminders');
select test.ok(exists (select 1 from public.hr_notifications where type = 'document_expiry' and entity_id = pg_temp.id('pass')::text
  and recipient_user_id = test.user_of(pg_temp.id('emp1')) and link = '/employee/documents?tab=expiring'), 'employee notified');
select test.ok(exists (select 1 from public.hr_notifications where type = 'document_expiry' and entity_id = pg_temp.id('pass')::text
  and recipient_user_id = test.user_of(pg_temp.id('hr'))), 'HR notified');
select test.ok(not exists (select 1 from public.hr_notifications where type = 'document_expiry' and entity_id = pg_temp.id('pass')::text
  and recipient_user_id = test.user_of(pg_temp.id('mgr'))), 'manager not notified by default');
select test.ok(not exists (select 1 from public.hr_email_outbox where entity_id = pg_temp.id('pass')::text), 'no email while email reminders are off');
select test.eq((select trigger_source || '|' || status from public.hr_document_reminder_runs where id = ((select r from t_run) ->> 'run_id')::uuid), 'scheduler|completed', 'scheduler run logged');
select test.ok(((select r from t_run) ->> 'notifications')::int > 0, 'run counts the notifications it created');
select test.as_service();
select test.eq((public.hr_run_document_reminders(hr_private.business_today(), 'scheduler') ->> 'reminders')::int, 0, 'same day re-run sends nothing');
select test.as_owner();
update public.hr_settings set value = value || '{"email_reminders":true,"notify_manager":true}' where key = 'documents';
select test.as_service();
select test.eq((select count(*) from public.hr_document_reminder_log l where l.document_id = pg_temp.id('pass')), 1::bigint, 'one stage logged so far');
select public.hr_run_document_reminders(hr_private.business_today() + 6, 'scheduler');
select test.as_owner();
select test.eq((select string_agg(stage_days::text, ',' order by stage_days desc) from public.hr_document_reminder_log where document_id = pg_temp.id('pass')), '30,15', '14 days left -> the 15-day reminder');
select test.ok(exists (select 1 from public.hr_email_outbox where entity_id = pg_temp.id('pass')::text and status = 'queued'), 'email queued once enabled (delivery state stays queued until dispatched)');
select test.ok(exists (select 1 from public.hr_notifications where type = 'document_expiry' and entity_id = pg_temp.id('pass')::text
  and recipient_user_id = test.user_of(pg_temp.id('mgr'))), 'manager notified once enabled');
select test.ok(not exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('ctc')::text and recipient_user_id = test.user_of(pg_temp.id('mgr'))),
  'manager never notified about compensation documents');
select test.as_service();
select public.hr_run_document_reminders(hr_private.business_today() + 25, 'scheduler');
select test.as_owner();
select test.eq((select string_agg(stage_days::text, ',' order by stage_days desc) from public.hr_document_reminder_log where document_id = pg_temp.id('pass')), '30,15,0', 'missed 7-day stage skipped; on-expiry reminder sent');
select test.eq((select verification_status from public.hr_documents where id = pg_temp.id('pass')), 'expired', 'past-expiry document marked expired');
select test.eq((select contract_status from public.hr_documents where id = pg_temp.id('con3')), 'active', 'future contract stays active');
-- contract renewal date -> HR-only renewal reminder (60-day stage)
select pg_temp.as_k('hr2');
select public.hr_set_document_details(pg_temp.id('con3'), jsonb_build_object('renewal_date', (hr_private.business_today() + 50)::text));
select test.as_service();
select public.hr_run_document_reminders(hr_private.business_today(), 'scheduler');
select test.as_owner();
select test.eq((select event || ':' || stage_days from public.hr_document_reminder_log where document_id = pg_temp.id('con3')), 'renewal:60', 'renewal date 50 days out -> 60-day renewal reminder');
select test.ok(exists (select 1 from public.hr_notifications where type = 'document_renewal' and entity_id = pg_temp.id('con3')::text
  and recipient_user_id = test.user_of(pg_temp.id('hr'))), 'HR notified of the contract renewal');
select test.ok(not exists (select 1 from public.hr_notifications where type = 'document_renewal' and entity_id = pg_temp.id('con3')::text
  and recipient_user_id = test.user_of(pg_temp.id('emp1'))), 'employee not notified of HR renewal tasks');
-- per-category override
update public.hr_document_categories set reminder_days = '{5}' where code = 'visa';
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('hr');
  r := public.hr_register_document_upload(pg_temp.id('emp2'), 'visa', 'Visa', 'visa.pdf', 'application/pdf', 900, hr_private.business_today() + 20);
  insert into t_ids values ('visa', (r ->> 'document_id')::uuid);
  perform pg_temp.put(r ->> 'storage_path');
  perform test.ok(exists (select 1 from public.hr_document_reminder_schedule(60) s where s.document_id = (r ->> 'document_id')::uuid and s.next_stage = 5), 'schedule shows the next stage');
  perform public.hr_run_document_reminders();
  perform test.as_owner();
end $$;
select test.ok(not exists (select 1 from public.hr_document_reminder_log where document_id = pg_temp.id('visa')), 'category schedule (5 days) overrides the default');
select test.eq((select string_agg(distinct trigger_source, ',') from public.hr_document_reminder_runs where triggered_by = test.user_of(pg_temp.id('hr'))), 'manual', 'HR run logged as manual');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_set_category_reminder_days((select id from public.hr_document_categories where code = 'visa'), '{400}')$q$, 'invalid category schedule rejected', 'between 0 and 365');
select test.as_owner();

-- ---- renewal request -> employee notified -> new version fulfils it
select pg_temp.as_k('hr');
select test.ok(public.hr_request_document_renewal(pg_temp.id('cert'), 'Please upload the final certificate', hr_private.business_today() + 7) is not null, 'renewal requested');
select test.throws($q$select public.hr_request_document_renewal(pg_temp.id('cert'))$q$, 'one open renewal request per document', 'already open');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where type = 'document_renewal_request' and entity_id = pg_temp.id('cert')::text
  and recipient_user_id = test.user_of(pg_temp.id('emp1'))), 'employee asked for a renewed copy');
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('emp1');
  perform test.eq(test.count_rows($q$select 1 from public.hr_document_renewal_requests where status = 'open'$q$), 1::bigint, 'employee sees the open request');
  r := public.hr_new_document_version(pg_temp.id('cert'), 'cert-final.pdf', 'application/pdf', 5100);
  perform pg_temp.put(r ->> 'storage_path');
  perform test.as_owner();
end $$;
select test.eq((select status || '|' || fulfilled_version from public.hr_document_renewal_requests where document_id = pg_temp.id('cert')), 'fulfilled|3', 'replacement upload fulfils the request');

-- ---- overview + directory (real rows, scoped)
select pg_temp.as_k('hr');
select test.eq((public.hr_documents_overview() ->> 'total')::int,
  (select count(*)::int from public.hr_documents where archived_at is null), 'overview total = visible active documents (HR Admin sees all)');
select test.eq((public.hr_documents_overview(jsonb_build_object('employee', pg_temp.id('emp1'))) ->> 'pending_verification')::int,
  (select count(*)::int from public.hr_documents d where d.employee_id = pg_temp.id('emp1') and d.archived_at is null and d.verification_status = 'pending'
     and exists (select 1 from public.hr_document_versions v join storage.objects o on o.name = v.storage_path where v.document_id = d.id and v.version = d.current_version)),
  'pending verification count matches rows');
select test.eq((public.hr_documents_overview(jsonb_build_object('employee', pg_temp.id('emp1'))) ->> 'expired')::int, 1, 'expired count (passport)');
select test.ok((public.hr_documents_overview() ->> 'pending_acknowledgements')::int >= 2, 'pending acknowledgements counted');
select test.ok(jsonb_array_length(public.hr_documents_overview() -> 'recently_uploaded') between 1 and 8, 'recently uploaded list');
select test.eq((public.hr_search_documents(jsonb_build_object('group', 'contract', 'employee', pg_temp.id('emp1'))) ->> 'total')::int, 3, 'directory: contracts filter');
select test.eq((public.hr_search_documents(jsonb_build_object('department', pg_temp.id('dep2'))) ->> 'total')::int, 1, 'directory: department filter');
select test.eq((public.hr_search_documents(jsonb_build_object('expiry_status', 'expired', 'employee', pg_temp.id('emp1'))) -> 'rows' -> 0 ->> 'id')::uuid, pg_temp.id('pass'), 'directory: expiry status filter');
select test.eq((public.hr_search_documents(jsonb_build_object('search', 'annexure')) ->> 'total')::int, 1, 'directory: search');
select test.eq((public.hr_search_documents(jsonb_build_object('uploaded_from', (hr_private.business_today() + 1)::text)) ->> 'total')::int, 0, 'directory: upload date filter');
select test.eq(jsonb_array_length(public.hr_search_documents('{}', 1, 2) -> 'rows'), 2, 'directory pages');
select test.throws($q$select public.hr_search_documents('{"uploaded_from":"not-a-date"}')$q$, 'bad date filter rejected', 'date');
select pg_temp.as_k('clerk');
select test.eq((public.hr_documents_overview() ->> 'total')::int, (select count(*)::int from public.hr_documents where archived_at is null and not includes_compensation),
  'clerk overview excludes compensation documents');
select pg_temp.as_k('mgr');
select test.eq((public.hr_documents_overview() ->> 'total')::int,
  (select count(*)::int from public.hr_documents d join public.hr_document_categories c on c.id = d.category_id
    where d.archived_at is null and not c.is_confidential and not d.includes_compensation and d.employee_id in (pg_temp.id('emp1'))),
  'manager overview counts only visible team documents');
select test.eq((public.hr_documents_overview() -> 'pending_acknowledgements'), 'null'::jsonb, 'manager gets no company acknowledgement count');
select pg_temp.as_k('emp2');
select test.throws($q$select public.hr_documents_overview()$q$, 'employees cannot open the HR overview', 'not allowed');
select test.eq((public.hr_search_documents() ->> 'total')::int, 1, 'employee directory = own visible documents');
select test.as_owner();

-- ---- anon
select test.as_anon();
select test.throws($q$select public.hr_search_documents()$q$, 'anon cannot search documents', 'permission denied');
select test.throws($q$select public.hr_run_document_reminders()$q$, 'anon cannot run reminders', 'permission denied');
select test.as_owner();

-- ---- internal helpers called directly. 197 revokes EXECUTE on the write
-- helpers (doc_apply_details, doc_supersede) from authenticated; the read
-- helpers below stay executable and must enforce access themselves.
select pg_temp.as_k('emp2');
select test.throws($q$select hr_private.doc_apply_details(pg_temp.id('con3'), '{"notes":"tampered"}')$q$, 'employee cannot edit details via the helper (revoked by 197)', 'permission denied');
select test.throws($q$select hr_private.doc_supersede(pg_temp.id('con3'), pg_temp.id('appt'))$q$, 'employee cannot supersede via the helper (revoked by 197)', 'permission denied');
select test.throws($q$select hr_private.doc_merge_data(pg_temp.id('emp1'), '{}', 'x', true)$q$, 'employee cannot build merge data (salary) via the helper', 'not allowed');
select test.eq(test.count_rows($q$select 1 from hr_private.pending_acknowledgements(pg_temp.id('emp1'))$q$), 0::bigint, 'colleague pending acknowledgements hidden');
select test.eq(test.count_rows($q$select 1 from hr_private.pending_acknowledgements() where employee_id <> pg_temp.id('emp2')$q$), 0::bigint, 'helper scoped to self for employees');
select test.ok(hr_private.doc_current_letter((select id from public.hr_document_templates where code = 'appointment_letter'), pg_temp.id('emp1')) is null, 'letter lookup hidden');
select test.ok(hr_private.doc_employee_name(pg_temp.id('emp1')) is null, 'colleague name not resolvable via the helper');
select test.eq(test.count_rows($q$select 1 from hr_private.policy_targets(pg_temp.id('pol'))$q$), 0::bigint, 'policy audience hidden from non-HR (not in audience)');
select pg_temp.as_k('emp1');
select test.throws($q$select hr_private.doc_apply_details(pg_temp.id('appt'), '{"notes":"tampered"}')$q$, 'employee cannot edit their own issued letter details (revoked by 197)', 'permission denied');
select test.as_owner();
select test.ok((select notes is distinct from 'tampered' from public.hr_documents where id = pg_temp.id('con3')), 'contract notes untouched');

-- ---- audit history retained
select test.eq((select count(*) from public.hr_document_versions where document_id = pg_temp.id('appt')), 2::bigint, 'audit: both issued letter versions retained');
select test.eq((select count(*) from public.hr_document_letter_content where document_id = pg_temp.id('appt')), 2::bigint, 'audit: both issued letter texts retained');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_document_versions' and action = 'INSERT'
  and new_data ->> 'document_id' = pg_temp.id('appt')::text and (new_data ->> 'version')::int = 2), 'audit log: letter version 2 registration');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_documents' and action = 'UPDATE' and record_id = pg_temp.id('con1')::text
  and old_data ->> 'verification_status' <> 'replaced' and new_data ->> 'verification_status' = 'replaced' and new_data ->> 'contract_status' = 'renewed'),
  'audit log: contract renewal (old record -> replaced / renewed) with before/after');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_documents' and action = 'INSERT'
  and new_data ->> 'supersedes_document_id' is null and record_id = pg_temp.id('con2')::text), 'audit log: renewed contract creation');
select test.eq((select count(*) from public.hr_audit_log where table_name = 'hr_document_acknowledgements' and action = 'INSERT'
  and new_data ->> 'document_id' = pg_temp.id('appt')::text), 1::bigint, 'audit log: appointment letter acknowledgement');
select test.eq((select count(*) from public.hr_audit_log where table_name = 'hr_document_acknowledgements' and action = 'INSERT'
  and new_data ->> 'policy_id' = pg_temp.id('pol')::text), 1::bigint, 'audit log: policy v1 acknowledgement');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_policy_versions' and action = 'UPDATE'
  and new_data ->> 'policy_id' = pg_temp.id('pol')::text and new_data ->> 'version' = '1' and new_data ->> 'status' = 'superseded'), 'audit log: policy v1 superseded');
select test.eq((select string_agg(version || ':' || status, ',' order by version) from public.hr_policy_versions where policy_id = pg_temp.id('pol')),
  '1:superseded,2:archived', 'policy history retained after archive (v1 superseded, v2 archived)');
select test.eq((select content from public.hr_policy_versions where policy_id = pg_temp.id('pol') and version = 1), 'Be kind. Version one text.', 'policy v1 text retained');

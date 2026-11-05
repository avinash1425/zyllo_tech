-- Documents: categories, versioned uploads, storage policies (registered
-- path only, no overwrite), visibility (self / team / confidential / HR),
-- verification, access log, expiry reminders, checklist, avatars.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_txt (k text primary key, v text);
grant all on t_ids, t_txt to authenticated, anon, service_role;
-- Switch to the user of a fixture employee (resolved as the owner, so the
-- lookup is never filtered by the previous user's RLS).
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;

do $$
declare dep uuid;
begin
  insert into public.hr_departments (code, name) values ('DOCS', 'Docs Dept') returning id into dep;
  insert into t_ids values ('hr',   test.make_employee('doc.hr@test.local', 'Hana', null, array['hr_admin']));
  insert into t_ids values ('mgr',  test.make_employee('doc.mgr@test.local', 'Milo', null, array['manager','employee'], 'full_time', dep));
  insert into t_ids values ('emp1', test.make_employee('doc.emp1@test.local', 'Edda', (select v from t_ids where k='mgr'), array['employee'], 'full_time', dep));
  insert into t_ids values ('emp2', test.make_employee('doc.emp2@test.local', 'Omar', null, array['employee']));
end $$;

-- ---- buckets
select test.ok((select not public and file_size_limit = 10485760 and 'application/pdf' = any (allowed_mime_types)
                from storage.buckets where id = 'hr-documents'), 'hr-documents bucket is private, 10 MB, allows pdf');
select test.ok((select not public and file_size_limit = 2097152 and not ('application/pdf' = any (allowed_mime_types))
                from storage.buckets where id = 'hr-avatars'), 'hr-avatars bucket is private, 2 MB, images only');
select test.eq((select count(*) from public.hr_document_categories where code in
  ('offer_letter','employment_agreement','id_proof','education_certificate','experience_certificate','hr_letter','policy_acknowledgement','other')),
  8::bigint, 'default document categories seeded');
select test.eq(hr_private.document_sanitize_file_name('../../My Passport (scan).PDF'), 'My_Passport_scan.pdf', 'file names are sanitized');

-- ---- anon
select test.as_anon();
select test.throws($q$select public.hr_register_document_upload(gen_random_uuid(), 'other', 'x', 'a.pdf', 'application/pdf', 10)$q$,
  'anon cannot register uploads', 'permission denied');
select test.as_owner();

-- ---- employee registers + uploads own ID proof
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('emp1');
  r := public.hr_register_document_upload((select v from t_ids where k='emp1'), 'id_proof', 'My ID',
         '../../My Passport (scan).PDF', 'application/pdf', 204800);
  insert into t_ids values ('doc1', (r ->> 'document_id')::uuid), ('doc1v1', (r ->> 'version_id')::uuid);
  insert into t_txt values ('path1', r ->> 'storage_path');
  perform test.ok((r ->> 'storage_path') = (select v from t_ids where k='emp1')::text || '/' || (r ->> 'document_id') || '/1-My_Passport_scan.pdf',
    'registration returns <employee>/<document>/<version>-<file> path');
  perform test.eq(r ->> 'bucket', 'hr-documents', 'registration names the bucket');
  perform test.as_owner();
end $$;

select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_register_document_upload((select v from t_ids where k='emp2'), 'id_proof', 'x', 'a.pdf', 'application/pdf', 10)$q$,
  'employee cannot upload to a colleague profile', 'own profile');
select test.throws($q$select public.hr_register_document_upload((select v from t_ids where k='emp1'), 'offer_letter', 'x', 'a.pdf', 'application/pdf', 10)$q$,
  'employee cannot upload HR-only category', 'uploaded by HR');
select test.throws($q$select public.hr_register_document_upload((select v from t_ids where k='emp1'), 'other', 'x', 'evil.exe', 'application/x-msdownload', 10)$q$,
  'executable rejected', 'Only PDF');
select test.throws($q$select public.hr_register_document_upload((select v from t_ids where k='emp1'), 'other', 'x', 'scan.pdf', 'image/png', 10)$q$,
  'extension must match mime type', 'must match');
select test.throws($q$select public.hr_register_document_upload((select v from t_ids where k='emp1'), 'other', 'x', 'scan.pdf', 'application/pdf', 0)$q$,
  'empty file rejected', 'empty');
select test.throws($q$select public.hr_register_document_upload((select v from t_ids where k='emp1'), 'other', 'x', 'scan.pdf', 'application/pdf', 11000000)$q$,
  'file over 10 MB rejected', '10 MB');
select test.throws($q$insert into public.hr_documents (employee_id, category_id, title) select (select v from t_ids where k='emp1'), id, 'x' from public.hr_document_categories where code='other'$q$,
  'direct document insert blocked', 'row-level security');

-- storage upload: only the exact registered path, once
insert into storage.objects (bucket_id, name, owner) values ('hr-documents', (select v from t_txt where k='path1'), auth.uid());
select test.ok(true, 'employee uploaded to the registered path');
select test.throws($q$insert into storage.objects (bucket_id, name, owner) values ('hr-documents', (select v from t_ids where k='emp1')::text || '/x/1-free.pdf', auth.uid())$q$,
  'upload to an unregistered path rejected', 'row-level security');
select test.throws($q$insert into storage.objects (bucket_id, name, owner) values ('hr-documents', (select v from t_txt where k='path1'), auth.uid())$q$,
  'cannot overwrite an uploaded version');
update storage.objects set name = name || '.bak' where bucket_id = 'hr-documents';
delete from storage.objects where bucket_id = 'hr-documents';
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-documents' and name = (select v from t_txt where k='path1')$q$), 1::bigint,
  'employee cannot rename or delete document objects (no update/delete policies)');
select test.eq(test.count_rows('select 1 from public.hr_documents'), 1::bigint, 'employee sees own document');
select test.as_owner();

select pg_temp.as_k('emp2');
select test.throws($q$insert into storage.objects (bucket_id, name, owner) values ('hr-documents', (select v from t_txt where k='path1') || 'x', auth.uid())$q$,
  'another user cannot upload to a path they did not register', 'row-level security');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-documents'$q$), 0::bigint, 'unrelated employee cannot read the object');
select test.eq(test.count_rows('select 1 from public.hr_documents'), 0::bigint, 'unrelated employee cannot see the document');
select test.throws($q$select public.hr_log_document_access((select v from t_ids where k='doc1v1'), 'view')$q$, 'unrelated employee cannot log access', 'not found');
select test.as_owner();

select pg_temp.as_k('mgr');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-documents'$q$), 1::bigint, 'manager can read team member document object');
select test.eq(test.count_rows('select 1 from public.hr_document_versions'), 1::bigint, 'manager sees team document versions');
select test.as_owner();

-- ---- HR: confidential document, verification
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('hr');
  r := public.hr_register_document_upload((select v from t_ids where k='emp1'), 'hr_confidential', 'Investigation notes', 'notes.docx',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 5000);
  insert into t_ids values ('conf', (r ->> 'document_id')::uuid);
  insert into storage.objects (bucket_id, name, owner) values ('hr-documents', r ->> 'storage_path', auth.uid());
  -- HR's own document (for the self-verification rule)
  r := public.hr_register_document_upload((select v from t_ids where k='hr'), 'other', 'My own', 'mine.png', 'image/png', 100);
  insert into t_ids values ('hrdoc', (r ->> 'document_id')::uuid);
  insert into storage.objects (bucket_id, name, owner) values ('hr-documents', r ->> 'storage_path', auth.uid());
  -- registered but never uploaded
  r := public.hr_register_document_upload((select v from t_ids where k='emp1'), 'offer_letter', 'Offer', 'offer.pdf', 'application/pdf', 100);
  insert into t_ids values ('noupload', (r ->> 'document_id')::uuid);
  perform test.as_owner();
end $$;

select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = (select v from t_ids where k='conf')$q$), 0::bigint, 'employee cannot see confidential document about them');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-documents' and name like '%notes.docx'$q$), 0::bigint, 'employee cannot read confidential object');
select test.throws($q$select public.hr_verify_document((select v from t_ids where k='doc1'), true)$q$, 'employee cannot verify documents', 'not allowed');
select test.as_owner();
select pg_temp.as_k('mgr');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = (select v from t_ids where k='conf')$q$), 0::bigint, 'manager cannot see confidential team document');
select test.as_owner();

select pg_temp.as_k('hr');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = (select v from t_ids where k='conf')$q$), 1::bigint, 'HR sees confidential document');
select test.throws($q$select public.hr_verify_document((select v from t_ids where k='hrdoc'), true)$q$, 'HR cannot verify own document', 'own documents');
select test.throws($q$select public.hr_verify_document((select v from t_ids where k='noupload'), true)$q$, 'cannot verify before the file is uploaded', 'not been uploaded');
select test.throws($q$select public.hr_verify_document((select v from t_ids where k='doc1'), false, '  ')$q$, 'rejection needs a reason', 'reason');
select public.hr_verify_document((select v from t_ids where k='doc1'), true);
select test.eq((select verification_status from public.hr_documents where id = (select v from t_ids where k='doc1')), 'verified', 'HR verified document');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where entity_id = (select v from t_ids where k='doc1')::text
  and recipient_user_id = test.user_of((select v from t_ids where k='emp1')) and type = 'document_verification'), 'employee notified of verification');
select test.ok(not exists (select 1 from public.hr_notifications where entity_id = (select v from t_ids where k='conf')::text), 'no notification for confidential document');

-- ---- checklist + access log
select pg_temp.as_k('emp1');
select test.ok((select is_complete from public.hr_document_checklist((select v from t_ids where k='emp1')) where category_code = 'id_proof'), 'checklist: verified ID proof complete');
select test.ok((select not is_complete from public.hr_document_checklist((select v from t_ids where k='emp1')) where category_code = 'offer_letter'), 'checklist: pending offer letter incomplete');
select test.ok(not exists (select 1 from public.hr_document_checklist((select v from t_ids where k='emp1')) where category_code = 'experience_certificate'), 'checklist lists required categories only');
select test.throws($q$select * from public.hr_document_checklist((select v from t_ids where k='emp2'))$q$, 'employee cannot read a colleague checklist', 'not found');
select test.ok(public.hr_log_document_access((select v from t_ids where k='doc1v1'), 'download') = (select v from t_txt where k='path1'), 'access logged, path returned');
select test.eq(test.count_rows('select 1 from public.hr_document_access_log'), 0::bigint, 'employee cannot read the access log');
-- new version resets verification
do $$
declare r jsonb;
begin
  r := public.hr_new_document_version((select v from t_ids where k='doc1'), 'passport-renewed.jpg', 'image/jpeg', 3000);
  perform test.eq((r ->> 'version')::int, 2, 'new version number');
  perform test.ok((r ->> 'storage_path') like '%/2-passport-renewed.jpg', 'new version path');
end $$;
select test.eq((select verification_status from public.hr_documents where id = (select v from t_ids where k='doc1')), 'pending', 'new version resets verification');
select test.ok((select not is_complete from public.hr_document_checklist((select v from t_ids where k='emp1')) where category_code = 'id_proof'), 'checklist incomplete after re-upload');
update public.hr_document_versions set file_name = 'x.pdf';
select test.eq(test.count_rows($q$select 1 from public.hr_document_versions where file_name = 'x.pdf'$q$), 0::bigint, 'versions not directly writable by clients');
select test.as_owner();
select test.throws($q$update public.hr_document_versions set file_name = 'x.pdf' where document_id = (select v from t_ids where k='doc1')$q$, 'versions are immutable even for the owner', 'cannot be changed');

select pg_temp.as_k('hr');
select test.eq(test.count_rows('select 1 from public.hr_document_access_log'), 1::bigint, 'HR reads the access log');
select test.as_owner();

-- ---- expiry
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('hr');
  r := public.hr_register_document_upload((select v from t_ids where k='emp1'), 'other', 'Work permit', 'permit.pdf', 'application/pdf', 500,
         hr_private.business_today() + 10);
  insert into t_ids values ('permit', (r ->> 'document_id')::uuid);
  perform test.throws(format($q$select public.hr_register_document_upload(%L, 'other', 'Old', 'old.pdf', 'application/pdf', 5, current_date - 30)$q$,
    (select v from t_ids where k='emp1')), 'past expiry rejected', 'past');
  perform test.as_owner();
end $$;

select pg_temp.as_k('hr');
select test.eq((select days_left from public.hr_expiring_documents(30) where document_id = (select v from t_ids where k='permit')), 10, 'HR sees expiring document with days left');
select test.eq(public.hr_generate_document_expiry_reminders(30), 1, 'one reminder generated');
select test.eq(public.hr_generate_document_expiry_reminders(30), 0, 'reminders are idempotent');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_email_outbox where entity_id = (select v from t_ids where k='permit')::text and status = 'queued'), 'reminder email queued');

select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_expiring_documents(30)'), 0::bigint, 'expiring list scoped (colleague sees none)');
select test.throws($q$select public.hr_generate_document_expiry_reminders(30)$q$, 'employee cannot run reminders', 'not allowed');
select test.as_owner();

update public.hr_documents set expiry_date = hr_private.business_today() - 1, verification_status = 'verified'
 where id = (select v from t_ids where k='permit');
select test.as_service();
select test.eq(public.hr_generate_document_expiry_reminders(30), 1, 'service role runs reminders; new expiry date reminded again');
select test.as_owner();
select test.eq((select verification_status from public.hr_documents where id = (select v from t_ids where k='permit')), 'expired', 'past-expiry document marked expired');

-- ---- archive
select pg_temp.as_k('hr');
select public.hr_archive_document((select v from t_ids where k='permit'));
select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = (select v from t_ids where k='permit')$q$), 0::bigint, 'archived document hidden from employee');
select test.as_owner();

-- ---- avatars
select pg_temp.as_k('emp1');
insert into storage.objects (bucket_id, name, owner) values ('hr-avatars', (select v from t_ids where k='emp1')::text || '/me.png', auth.uid());
select test.ok(true, 'employee uploads own avatar');
select test.throws($q$insert into storage.objects (bucket_id, name, owner) values ('hr-avatars', (select v from t_ids where k='emp2')::text || '/me.png', auth.uid())$q$,
  'employee cannot upload into a colleague avatar folder', 'row-level security');
select test.throws($q$insert into storage.objects (bucket_id, name, owner) values ('hr-avatars', (select v from t_ids where k='emp1')::text || '/me.gif', auth.uid())$q$,
  'avatar extension restricted', 'row-level security');
update storage.objects set metadata = '{"replaced":true}' where bucket_id = 'hr-avatars';
select test.ok((select metadata ->> 'replaced' = 'true' from storage.objects where bucket_id = 'hr-avatars'), 'employee can replace own avatar');
select public.hr_set_my_photo((select v from t_ids where k='emp1')::text || '/me.png');
select test.eq((select photo_path from public.hr_employees where id = (select v from t_ids where k='emp1')), (select v from t_ids where k='emp1')::text || '/me.png', 'photo path set');
select test.throws($q$select public.hr_set_my_photo((select v from t_ids where k='emp2')::text || '/me.png')$q$, 'cannot point photo at another folder', 'own profile folder');
select test.throws($q$select public.hr_set_my_photo((select v from t_ids where k='emp1')::text || '/missing.png')$q$, 'photo must exist', 'Upload the photo');
select test.as_owner();

select pg_temp.as_k('mgr');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-avatars'$q$), 1::bigint, 'manager can read team avatar');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-avatars'$q$), 0::bigint, 'unrelated employee cannot read avatar');
select test.throws($q$select public.hr_set_employee_photo((select v from t_ids where k='emp1'), null)$q$, 'employee cannot use HR photo RPC', 'not allowed');
select pg_temp.as_k('hr');
insert into storage.objects (bucket_id, name, owner) values ('hr-avatars', (select v from t_ids where k='emp2')::text || '/hr-set.webp', auth.uid());
select public.hr_set_employee_photo((select v from t_ids where k='emp2'), (select v from t_ids where k='emp2')::text || '/hr-set.webp');
select test.eq((select photo_path from public.hr_employees where id = (select v from t_ids where k='emp2')), (select v from t_ids where k='emp2')::text || '/hr-set.webp', 'HR sets an employee photo');
select test.as_owner();

-- ---- audit
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_documents' and action = 'UPDATE'), 'document changes are audited');

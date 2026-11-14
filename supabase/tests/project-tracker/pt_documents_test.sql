-- =====================================================================
-- LOCAL TEST ONLY. Document validation and versioning (migration 004).
-- =====================================================================
\set ON_ERROR_STOP 1

do $$
declare v1 uuid; v2 uuid; p text; p2 text; p3 text;
begin
  perform test.as_user_email(test.id('editor'));
  -- server-side truth: size and type come from the stored object, not the browser
  p := test.id('A1P2')::text || '/' || gen_random_uuid()::text || '/handover.pptx';
  insert into storage.objects (bucket_id, name, metadata)
  values ('project-tracker-documents', p, '{"mimetype":"application/vnd.openxmlformats-officedocument.presentationml.presentation","size":2048}');
  insert into public.pt_documents (project_id, name, category, storage_path, file_name, mime_type, size_bytes, version, description)
  values (test.id('A1P2'), 'Handover deck', 'admin_access_handover', p, 'handover.pptx', 'application/pdf', 1, '1.0', 'Initial deck')
  returning id into v1;
  perform test.eq((select size_bytes from public.pt_documents where id = v1), 2048::bigint, 'size taken from the stored object (browser value ignored)');
  perform test.eq((select mime_type from public.pt_documents where id = v1), 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                  'type taken from the stored object');
  perform test.eq((select version_group_id from public.pt_documents where id = v1), v1, 'new document starts its own version history');

  -- disallowed content behind an allowed name
  p2 := test.id('A1P2')::text || '/' || gen_random_uuid()::text || '/invoice.pdf';
  insert into storage.objects (bucket_id, name, metadata) values ('project-tracker-documents', p2, '{"mimetype":"application/x-msdownload","size":100}');
  perform test.throws(format($q$insert into public.pt_documents (project_id, name, storage_path) values (%L, 'Fake PDF', %L)$q$, test.id('A1P2'), p2),
                      'executable content behind a .pdf name rejected', 'not allowed');
  perform test.throws(format($q$insert into public.pt_documents (project_id, name, storage_path) values (%L, 'Ghost', %L)$q$,
                             test.id('A1P2'), test.id('A1P2')::text || '/' || gen_random_uuid()::text || '/ghost.pdf'),
                      'document row needs an uploaded object', 'not found in private storage');
  perform test.throws(format($q$insert into storage.objects (bucket_id, name) values ('project-tracker-documents', %L)$q$,
                             test.id('A1P2')::text || '/' || gen_random_uuid()::text || '/script.svg'),
                      'unsupported extension rejected by the storage policy', 'row-level security');

  -- configurable size limit (owner sets 1 MB for this check)
  perform test.as_owner();
  update public.pt_settings set max_document_mb = 1;
  perform test.as_user_email(test.id('editor'));
  p3 := test.id('A1P2')::text || '/' || gen_random_uuid()::text || '/big.docx';
  insert into storage.objects (bucket_id, name, metadata)
  values ('project-tracker-documents', p3, '{"mimetype":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":2097152}');
  perform test.throws(format($q$insert into public.pt_documents (project_id, name, storage_path) values (%L, 'Big', %L)$q$, test.id('A1P2'), p3),
                      'file over the configured limit rejected', 'larger than the 1 MB limit');
  perform test.as_owner();
  update public.pt_settings set max_document_mb = 50;

  -- versioning
  perform test.as_user_email(test.id('editor'));
  p := test.id('A1P2')::text || '/' || gen_random_uuid()::text || '/handover-v2.pptx';
  insert into storage.objects (bucket_id, name, metadata)
  values ('project-tracker-documents', p, '{"mimetype":"application/vnd.openxmlformats-officedocument.presentationml.presentation","size":4096}');
  insert into public.pt_documents (project_id, name, category, storage_path, version, supersedes_id, description)
  values (test.id('A1P2'), 'Handover deck', 'admin_access_handover', p, '2.0', v1, 'Updated after client review') returning id into v2;
  perform test.ok(not (select is_current from public.pt_documents where id = v1), 'old version marked not current');
  perform test.ok((select is_current from public.pt_documents where id = v2), 'new version is current');
  perform test.eq((select version_group_id from public.pt_documents where id = v2), v1, 'versions share one history');
  perform test.eq((select count(*) from public.pt_documents where version_group_id = v1), 2::bigint, 'history lists both versions');
  perform test.ok((select storage_path is not null from public.pt_documents where id = v1), 'old version file kept');
  perform test.throws(format($q$insert into public.pt_documents (project_id, name, external_url, supersedes_id) values (%L, 'x', 'https://drive.example/x', %L)$q$, test.id('A1P2'), v1),
                      'only the current version can be replaced', 'Only the current');
  perform test.throws(format($q$insert into public.pt_documents (project_id, name, external_url, supersedes_id) values (%L, 'x', 'https://drive.example/x', %L)$q$, test.id('A2P1'), v2),
                      'cannot version another project''s document', 'not found in this project');
  perform test.throws(format($q$update public.pt_documents set is_current = true where id = %L$q$, v1), 'version flags not editable directly', 'permission denied');
  update public.pt_documents set description = 'Edited description' where id = v2;
  perform test.ok(true, 'description editable');
  perform public.pt_log_document_access(v2, 'downloaded');
  perform public.pt_log_document_access(v2, 'previewed');
  perform test.throws(format($q$select public.pt_log_document_access(%L, 'deleted')$q$, v2), 'unknown access actions refused', 'Unknown');
  perform test.as_user_email(test.id('outsider'));
  perform test.throws(format($q$select public.pt_log_document_access(%L, 'opened')$q$, v2), 'non-admin cannot touch document audit', 'access');
  perform test.as_owner();
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = v2 and action = 'document.new_version'), 'new version logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = v1 and action = 'document.superseded'), 'superseded version logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = v2 and action = 'document.downloaded'), 'download logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = v2 and action = 'document.previewed'), 'preview logged');
end $$;

select 'documents suite finished' as result;

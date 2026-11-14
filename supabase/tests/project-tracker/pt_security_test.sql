-- =====================================================================
-- LOCAL TEST ONLY. Project Tracker security tests (RLS, grants, roles,
-- credential references, secret detection, storage, isolation).
-- Run by scripts/pt-local/db-test.mjs after the shim, 001 and 002.
-- Every "ok - …" NOTICE is one passing assertion; the first failure aborts.
-- Synthetic data only.
-- =====================================================================
\set ON_ERROR_STOP 1

-- Fixture registry readable while impersonating.
create table if not exists test.fx (key text primary key, id uuid not null);
grant select on test.fx to anon, authenticated, service_role;
create or replace function test.id(p_key text) returns uuid
language sql stable security definer as $$ select id from test.fx where key = p_key $$;
grant execute on function test.id(text) to anon, authenticated, service_role;
create or replace function test.put(p_key text, p_id uuid) returns uuid
language sql security definer as $$ insert into test.fx values (p_key, p_id) on conflict (key) do update set id = excluded.id returning id $$;
grant execute on function test.put(text, uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- users
do $$
begin
  perform test.put('manager',  test.make_user('pt.manager@example.test', true));
  perform test.put('editor',   test.make_user('pt.editor@example.test', true));
  perform test.put('viewer',   test.make_user('pt.viewer@example.test', true));
  perform test.put('blocked',  test.make_user('pt.blocked@example.test', true));
  perform test.put('outsider', test.make_user('random.signup@example.test', false));
  -- bootstrap exactly as documented in 001 (owner, SQL editor)
  insert into public.pt_members (user_id, role, note) values (test.id('manager'), 'manager', 'initial manager');
  insert into public.pt_members (user_id, role) values (test.id('viewer'), 'viewer'), (test.id('blocked'), 'no_access');
end $$;

-- Fixture company (migration 003 requires a company for every new project).
do $$
declare v uuid;
begin
  insert into public.pt_companies (company_name, company_type) values ('Synthetic Test Holdings', 'private_limited') returning id into v;
  perform test.put('coT', v);
end $$;

-- ------------------------------------------------------- role resolution
do $$
begin
  perform test.as_user_email(test.id('manager'));  perform test.eq(public.pt_my_role(), 'manager', 'manager resolves to manager');
  perform test.as_user_email(test.id('editor'));   perform test.eq(public.pt_my_role(), 'editor', 'admin without pt_members row defaults to editor');
  perform test.as_user_email(test.id('viewer'));   perform test.eq(public.pt_my_role(), 'viewer', 'viewer override applies');
  perform test.as_user_email(test.id('blocked'));  perform test.ok(public.pt_my_role() is null, 'no_access override blocks an admin');
  perform test.as_user_email(test.id('outsider')); perform test.ok(public.pt_my_role() is null, 'signed-in non-admin has no role');
  perform test.as_owner();
end $$;

-- A non-admin with a pt_members row still gets nothing (admin check first).
do $$
begin
  insert into public.pt_members (user_id, role) values (test.id('outsider'), 'manager');
  perform test.as_user_email(test.id('outsider'));
  perform test.ok(public.pt_my_role() is null, 'pt_members cannot grant access to a non-admin');
  perform test.as_owner();
  delete from public.pt_members where user_id = test.id('outsider');
end $$;

-- ------------------------------------------------------- fixtures (editor)
do $$
declare v uuid;
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_projects (company_id, name, client_name, category, status, responsible_person, start_date)
  values (test.id('coT'), 'Synthetic Alpha Portal', 'Alpha Test Client', 'website', 'live', 'Test Lead A', public.pt_today() - 200) returning id into v;
  perform test.put('pA', v);
  insert into public.pt_projects (company_id, name, client_name, category, status)
  values (test.id('coT'), 'Synthetic Beta ERP', 'Beta Test Client', 'erp', 'in_progress') returning id into v;
  perform test.put('pB', v);
  insert into public.pt_hosting (project_id, provider, purpose, environment) values (test.id('pA'), 'Hostinger VPS', 'backend', 'production') returning id into v;
  perform test.put('hostA', v);
  insert into public.pt_hosting (project_id, provider, purpose, environment) values (test.id('pB'), 'Vercel', 'frontend', 'production') returning id into v;
  perform test.put('hostB', v);
  perform test.as_owner();
end $$;

-- ------------------------------------------------------------------ anon
do $$
begin
  perform test.as_anon();
  perform test.throws('select * from public.pt_projects', 'anon cannot read projects', 'permission denied');
  perform test.throws('select * from public.pt_project_list', 'anon cannot read the project list view', 'permission denied');
  perform test.throws('select * from public.pt_due_items', 'anon cannot read due items', 'permission denied');
  perform test.throws('select * from public.pt_activity_logs', 'anon cannot read activity logs', 'permission denied');
  perform test.throws($q$insert into public.pt_projects (company_id, name, client_name) values (test.id('coT'), 'x1', 'y')$q$, 'anon cannot create projects', 'permission denied');
  perform test.throws('select public.pt_my_role()', 'anon cannot call pt_my_role', 'permission denied');
  perform test.throws($q$select public.pt_reveal_access_reference(gen_random_uuid())$q$, 'anon cannot call credential reveal', 'permission denied');
  perform test.as_owner();
end $$;

-- ------------------------------------------------- signed-in non-admin
do $$
begin
  perform test.as_user_email(test.id('outsider'));
  perform test.eq(test.count_rows('select * from public.pt_projects'), 0::bigint, 'non-admin sees no projects (RLS)');
  perform test.eq(test.count_rows('select * from public.pt_hosting'), 0::bigint, 'non-admin sees no hosting records');
  perform test.eq(test.count_rows('select * from public.pt_project_list'), 0::bigint, 'non-admin sees nothing in the list view');
  perform test.eq(test.count_rows('select * from public.pt_due_items'), 0::bigint, 'non-admin sees no due items');
  perform test.eq(test.count_rows('select * from public.pt_activity_logs'), 0::bigint, 'non-admin sees no activity logs');
  perform test.throws($q$insert into public.pt_projects (company_id, name, client_name) values (test.id('coT'), 'Intruder', 'X')$q$, 'non-admin cannot create a project', 'row-level security');
  perform test.throws(format($q$insert into public.pt_hosting (project_id, provider) values (%L, 'Evil')$q$, test.id('pA')),
                      'non-admin cannot add hosting to a known project id (IDOR)', 'row-level security');
  perform test.eq(test.count_dml(format($q$update public.pt_projects set name = 'pwned' where id = %L returning 1$q$, test.id('pA'))), 0::bigint,
                  'non-admin update by known id affects 0 rows (IDOR)');
  perform test.throws(format('select public.pt_start_handover(%L)', test.id('pA')), 'non-admin cannot start a handover', 'permission');
  perform test.throws('select * from public.pt_list_members()', 'non-admin cannot list members', 'managers');
  perform test.throws($q$select public.pt_set_member_role('random.signup@example.test', 'manager')$q$, 'non-admin cannot grant themselves a role', 'managers');
  perform test.ok(not public.pt_document_path_exists('x'), 'storage helper reveals nothing to non-admins');
  perform test.as_owner();
end $$;

-- ------------------------------------------------- blocked admin, viewer
do $$
begin
  perform test.as_user_email(test.id('blocked'));
  perform test.eq(test.count_rows('select * from public.pt_projects'), 0::bigint, 'no_access admin sees no projects');
  perform test.as_user_email(test.id('viewer'));
  perform test.eq(test.count_rows('select * from public.pt_projects'), 2::bigint, 'viewer can read projects');
  perform test.throws($q$insert into public.pt_projects (company_id, name, client_name) values (test.id('coT'), 'Viewer try', 'X')$q$, 'viewer cannot create projects', 'row-level security');
  perform test.eq(test.count_dml(format($q$update public.pt_projects set remarks = 'v' where id = %L returning 1$q$, test.id('pA'))), 0::bigint,
                  'viewer cannot update projects');
  perform test.as_owner();
end $$;

-- ------------------------------------------- no hard delete / truncate
do $$
begin
  perform test.as_user_email(test.id('manager'));
  perform test.throws(format('delete from public.pt_projects where id = %L', test.id('pB')), 'even managers cannot hard-delete projects', 'permission denied');
  perform test.throws('delete from public.pt_hosting', 'no hard delete on child tables', 'permission denied');
  perform test.throws('truncate public.pt_projects cascade', 'truncate is not allowed', 'permission denied');
  perform test.throws('delete from public.pt_activity_logs', 'activity logs cannot be deleted', 'permission denied');
  perform test.throws($q$update public.pt_activity_logs set action = 'forged'$q$, 'activity logs cannot be updated', 'permission denied');
  perform test.throws($q$insert into public.pt_activity_logs (entity_type, action) values ('x', 'forged')$q$, 'activity logs cannot be forged', 'permission denied');
  perform test.throws($q$select public.pt_log(null, 'x', null, null, 'forged')$q$, 'pt_log is not callable from the API', 'permission denied');
  perform test.as_owner();
  perform test.throws($q$update public.pt_activity_logs set action = 'forged'$q$, 'activity logs are append-only even for the owner', 'append-only');
end $$;

-- ------------------------------------------------------- project isolation
do $$
begin
  perform test.as_user_email(test.id('editor'));
  perform test.throws(format($q$insert into public.pt_email_accounts (project_id, email_address, linked_hosting_id) values (%L, 'admin@alpha.example', %L)$q$,
                             test.id('pA'), test.id('hostB')),
                      'cannot link a record to another project''s hosting', 'foreign key');
  perform test.throws(format($q$update public.pt_hosting set project_id = %L where id = %L$q$, test.id('pB'), test.id('hostA')),
                      'cannot move a record to another project', 'cannot be moved');
  perform test.eq(test.count_rows(format('select * from public.pt_hosting where project_id = %L', test.id('pA'))), 1::bigint,
                  'project A shows only its own hosting');
  perform test.ok(not exists (select 1 from public.pt_hosting where project_id = test.id('pA') and id = test.id('hostB')),
                  'project B hosting never appears under project A');
  perform test.as_owner();
end $$;

-- ------------------------------------------------------- secret detection
do $$
begin
  perform test.as_user_email(test.id('editor'));
  perform test.throws(format($q$update public.pt_hosting set remarks = 'root password: Hunter22x!' where id = %L$q$, test.id('hostA')),
                      'password-like value rejected in remarks', 'looks like it contains');
  perform test.throws(format($q$update public.pt_hosting set deployment_ref = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc' where id = %L$q$, test.id('hostA')),
                      'JWT / API key rejected', 'looks like it contains');
  perform test.throws(format($q$update public.pt_hosting set remarks = '-----BEGIN OPENSSH PRIVATE KEY----- abc' where id = %L$q$, test.id('hostA')),
                      'private key rejected', 'looks like it contains');
  perform test.throws(format($q$update public.pt_hosting set remarks = 'token ghp_abcdefghijklmnopqrstuvwxyz0123' where id = %L$q$, test.id('hostA')),
                      'GitHub token rejected', 'looks like it contains');
  perform test.throws(format($q$update public.pt_hosting set remarks = 'AKIAABCDEFGHIJKLMNOP' where id = %L$q$, test.id('hostA')),
                      'AWS key rejected', 'looks like it contains');
  perform test.eq(test.count_dml(format($q$update public.pt_hosting set remarks = 'Password: stored in the company 1Password vault' where id = %L returning 1$q$, test.id('hostA'))),
                  1::bigint, 'plain prose about where a password is kept is allowed');
  perform test.as_owner();
end $$;

-- ------------------------------------------------- credential references
do $$
declare
  v_rec uuid;
  v_out record;
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_access_records (project_id, service_name, category, login_url, two_factor)
  values (test.id('pA'), 'Alpha WordPress admin', 'website_admin', 'https://alpha.example/wp-admin', 'enabled') returning id into v_rec;
  perform test.put('accA', v_rec);
  perform test.throws(format($q$update public.pt_access_records set has_reference = true where id = %L$q$, v_rec),
                      'editor cannot fake has_reference directly', 'permission denied');
  perform test.throws($q$select * from public.pt_access_refs$q$, 'access refs table is not readable via the API', 'permission denied');
  perform test.as_owner();
end $$;

do $$
declare
  v_rec uuid := test.id('accA');
  v_out record;
  v_logs int;
begin
  perform test.as_user_email(test.id('editor'));
  perform test.throws(format($q$select public.pt_set_access_reference(%L, 'admin', 'password: Xy7abc99')$q$, v_rec),
                      'secret-looking reference rejected', 'looks like a password');
  perform public.pt_set_access_reference(v_rec, 'alpha.admin@alpha.example', '1Password › Clients › Alpha › WP admin');
  perform test.ok((select has_reference from public.pt_access_records where id = v_rec), 'reference stored via RPC');
  perform test.eq((select identifier_hint from public.pt_access_records where id = v_rec), 'al•••@alpha.example', 'identifier shown masked');
  perform test.throws(format('select * from public.pt_reveal_access_reference(%L)', v_rec), 'editor cannot reveal a reference', 'managers');
  perform test.as_user_email(test.id('viewer'));
  perform test.throws(format('select * from public.pt_reveal_access_reference(%L)', v_rec), 'viewer cannot reveal a reference', 'managers');
  perform test.throws(format($q$select public.pt_set_access_reference(%L, 'x', 'vault ref')$q$, v_rec), 'viewer cannot change a reference', 'permission');
  perform test.as_user_email(test.id('manager'));
  select * into v_out from public.pt_reveal_access_reference(v_rec);
  perform test.eq(v_out.vault_reference, '1Password › Clients › Alpha › WP admin', 'manager can reveal the reference');
  perform test.as_owner();
  select count(*) into v_logs from public.pt_activity_logs where entity_id = v_rec and action = 'access.reference_viewed';
  perform test.eq(v_logs, 1, 'reveal is audit-logged');
  select count(*) into v_logs from public.pt_activity_logs where entity_id = v_rec and action = 'access.reference_changed';
  perform test.eq(v_logs, 1, 'reference change is audit-logged');
  perform test.ok(not exists (select 1 from public.pt_activity_logs
                               where details::text ilike '%1Password ›%' or coalesce(entity_label, '') ilike '%1Password ›%'
                                  or details::text ilike '%alpha.admin@%'),
                  'activity logs never contain the reference or identifier');
  perform test.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name like 'pt\_%'
                               and column_name ~* '(password|passwd|secret|token|api_key|private_key)'
                               -- 004 metadata flags only (whether/when a vault password exists; never a value):
                               and column_name not in ('has_password', 'password_updated_at', 'password_updated_by_email', 'vault_secret_id',
                                                       'passwords_enabled', 'passwords_enabled_at', 'passwords_enabled_note')),
                  'no password/secret/token column exists in any pt_ table');
end $$;

-- ------------------------------------------------------- archive / restore
do $$
begin
  perform test.as_user_email(test.id('editor'));
  update public.pt_projects set archived_at = now(), archive_reason = 'Synthetic test archive' where id = test.id('pB');
  perform test.eq((select status from public.pt_projects where id = test.id('pB')), 'archived', 'archiving sets status Archived');
  perform test.throws(format($q$insert into public.pt_domains (project_id, domain_name) values (%L, 'beta.example')$q$, test.id('pB')),
                      'archived project is read-only for new records', 'archived');
  perform test.throws(format($q$update public.pt_hosting set remarks = 'x' where id = %L$q$, test.id('hostB')),
                      'archived project children are read-only', 'archived');
  perform test.throws(format($q$update public.pt_projects set archived_at = null where id = %L$q$, test.id('pB')),
                      'editor cannot restore', 'managers can restore');
  perform test.throws(format($q$update public.pt_projects set status = 'archived' where id = %L$q$, test.id('pA')),
                      'status cannot be set to Archived directly', 'Use Archive');
  perform test.as_user_email(test.id('manager'));
  update public.pt_projects set archived_at = null where id = test.id('pB');
  perform test.eq((select status from public.pt_projects where id = test.id('pB')), 'in_progress', 'manager restore brings back the previous status');
  perform test.as_owner();
  perform test.ok(exists (select 1 from public.pt_activity_logs where project_id = test.id('pB') and action = 'project.archived'), 'archive logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where project_id = test.id('pB') and action = 'project.restored'), 'restore logged');
end $$;

-- ------------------------------------------------------------- documents
do $$
declare v uuid; v_path text;
begin
  perform test.as_user_email(test.id('editor'));
  v_path := test.id('pA')::text || '/' || gen_random_uuid()::text || '/scope.pdf';
  -- storage upload policy
  insert into storage.objects (bucket_id, name) values ('project-tracker-documents', v_path);
  perform test.ok(true, 'editor can upload into an active project folder');
  perform test.throws(format($q$insert into storage.objects (bucket_id, name) values ('project-tracker-documents', %L)$q$,
                             test.id('pA')::text || '/' || gen_random_uuid()::text || '/run.exe'),
                      'executable upload rejected', 'row-level security');
  perform test.throws(format($q$insert into storage.objects (bucket_id, name) values ('project-tracker-documents', %L)$q$,
                             gen_random_uuid()::text || '/' || gen_random_uuid()::text || '/x.pdf'),
                      'upload into a non-existent project folder rejected', 'row-level security');
  perform test.throws(format($q$insert into storage.objects (bucket_id, name) values ('project-tracker-documents', %L)$q$, 'loose.pdf'),
                      'upload outside a project folder rejected', 'row-level security');
  insert into public.pt_documents (project_id, name, category, storage_path, file_name, mime_type, size_bytes)
  values (test.id('pA'), 'Scope of work v1', 'scope_of_work', v_path, 'scope.pdf', 'application/pdf', 1234) returning id into v;
  perform test.put('docA', v);
  perform test.throws(format($q$insert into public.pt_documents (project_id, name, storage_path) values (%L, 'wrong', %L)$q$, test.id('pB'), v_path || 'x'),
                      'document path must be inside its own project folder', 'pt_documents_path_in_project');
  perform test.throws(format($q$update public.pt_documents set storage_path = 'elsewhere' where id = %L$q$, v),
                      'document file location cannot be repointed', 'permission denied');
  perform test.throws(format($q$insert into public.pt_documents (project_id, name, category, external_url, classification) values (%L, 'Secret plan', 'agreement', 'https://drive.example/x', 'restricted')$q$, test.id('pA')),
                      'editor cannot create a restricted document', 'row-level security');
  perform test.eq(test.count_rows(format($q$select * from storage.objects where name = %L$q$, v_path)), 1::bigint, 'editor can read the file of a visible document');
  perform test.as_owner();
end $$;

do $$
declare v uuid; v_path text; v_del bigint;
begin
  -- delete of a saved document's file affects 0 rows (policy hides it from DELETE)
  perform test.as_user_email(test.id('editor'));
  select storage_path into v_path from public.pt_documents where id = test.id('docA');
  v_del := test.count_dml(format($q$delete from storage.objects where name = %L returning 1$q$, v_path));
  perform test.eq(v_del, 0::bigint, 'saved document files cannot be deleted');
  -- manager creates a restricted document
  perform test.as_user_email(test.id('manager'));
  v_path := test.id('pA')::text || '/' || gen_random_uuid()::text || '/contract.pdf';
  insert into storage.objects (bucket_id, name) values ('project-tracker-documents', v_path);
  insert into public.pt_documents (project_id, name, category, storage_path, classification)
  values (test.id('pA'), 'Signed contract', 'agreement', v_path, 'restricted') returning id into v;
  perform test.put('docRestricted', v);
  perform test.eq(test.count_rows(format($q$select * from storage.objects where name = %L$q$, v_path)), 1::bigint, 'manager can read a restricted file');
  perform test.as_user_email(test.id('editor'));
  perform test.eq(test.count_rows(format('select * from public.pt_documents where id = %L', v)), 0::bigint, 'restricted document row hidden from editors');
  perform test.eq(test.count_rows(format($q$select * from storage.objects where name = %L$q$, v_path)), 0::bigint, 'restricted file hidden from editors');
  perform test.eq(test.count_dml(format($q$delete from storage.objects where name = %L returning 1$q$, v_path)), 0::bigint,
                  'editor cannot delete a restricted file by treating it as an orphan');
  perform test.as_user_email(test.id('outsider'));
  perform test.eq(test.count_rows($q$select * from storage.objects where bucket_id = 'project-tracker-documents'$q$), 0::bigint, 'non-admin cannot see any project file');
  perform test.throws(format($q$insert into storage.objects (bucket_id, name) values ('project-tracker-documents', %L)$q$,
                             test.id('pA')::text || '/' || gen_random_uuid()::text || '/y.pdf'),
                      'non-admin cannot upload', 'row-level security');
  -- orphan clean-up
  perform test.as_user_email(test.id('editor'));
  v_path := test.id('pA')::text || '/' || gen_random_uuid()::text || '/orphan.pdf';
  insert into storage.objects (bucket_id, name) values ('project-tracker-documents', v_path);
  perform test.eq(test.count_dml(format($q$delete from storage.objects where name = %L returning 1$q$, v_path)), 1::bigint, 'editor can remove an orphaned upload');
  perform test.as_owner();
end $$;

-- ------------------------------------------------------------- members
do $$
begin
  perform test.as_user_email(test.id('editor'));
  perform test.throws($q$select public.pt_set_member_role('pt.editor@example.test', 'manager')$q$, 'editor cannot promote themselves', 'managers');
  perform test.as_user_email(test.id('manager'));
  perform test.throws($q$select public.pt_set_member_role('pt.manager@example.test', 'editor')$q$, 'the only manager cannot demote themselves', 'only manager');
  perform public.pt_set_member_role('pt.viewer@example.test', 'default');
  perform test.as_user_email(test.id('viewer'));
  perform test.eq(public.pt_my_role(), 'editor', 'manager can reset a role to the default');
  perform test.as_user_email(test.id('manager'));
  perform public.pt_set_member_role('pt.viewer@example.test', 'viewer', 'read-only reviewer');
  perform test.eq(test.count_rows('select * from public.pt_list_members()'), 3::bigint, 'manager can list role assignments');
  perform test.as_owner();
end $$;

select 'security suite finished' as result;

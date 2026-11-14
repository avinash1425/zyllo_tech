-- =====================================================================
-- LOCAL TEST ONLY. Company hierarchy tests (migration 003).
-- Runs after pt_security_test.sql and pt_workflow_test.sql (reuses users).
-- Synthetic data only.
-- =====================================================================
\set ON_ERROR_STOP 1

-- ------------------------------------------------------ access to companies
do $$
begin
  perform test.as_anon();
  perform test.throws('select * from public.pt_companies', 'anon cannot read companies', 'permission denied');
  perform test.throws('select * from public.pt_company_summary', 'anon cannot read the company summary', 'permission denied');
  perform test.as_user_email(test.id('outsider'));
  perform test.eq(test.count_rows('select * from public.pt_companies'), 0::bigint, 'non-admin sees no companies');
  perform test.eq(test.count_rows('select * from public.pt_company_summary'), 0::bigint, 'non-admin sees no company summary rows');
  perform test.throws($q$insert into public.pt_companies (company_name) values ('Intruder Co')$q$, 'non-admin cannot create companies', 'row-level security');
  perform test.as_user_email(test.id('blocked'));
  perform test.eq(test.count_rows('select * from public.pt_companies'), 0::bigint, 'blocked admin sees no companies');
  perform test.as_user_email(test.id('viewer'));
  perform test.ok(test.count_rows('select * from public.pt_companies') >= 1, 'viewer can read companies');
  perform test.throws($q$insert into public.pt_companies (company_name) values ('Viewer Co')$q$, 'viewer cannot create companies', 'row-level security');
  perform test.as_owner();
end $$;

-- ------------------------------------------------------ company CRUD + validation
do $$
declare v uuid; v_num text;
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_companies (company_name, company_code, company_type, website, contact_person, contact_email, contact_phone, country, state, city)
  values ('  Company A1  ', 'ca1', 'private_limited', 'https://a1.example', 'Asha Test', 'asha@a1.example', '+91 90000 00001', 'India', 'Andhra Pradesh', 'Guntur')
  returning id, company_number into v, v_num;
  perform test.put('A1', v);
  perform test.ok(v_num ~ '^ZT-CO-[0-9]{4}$', 'company ID generated (' || v_num || ')');
  perform test.eq((select company_code from public.pt_companies where id = v), 'CA1', 'company code upper-cased');
  perform test.eq((select company_name from public.pt_companies where id = v), 'Company A1', 'company name trimmed');
  perform test.eq((select created_by_email from public.pt_companies where id = v), 'pt.editor@example.test', 'Created By recorded');
  insert into public.pt_companies (company_name) values ('Company A2') returning id into v; perform test.put('A2', v);
  insert into public.pt_companies (company_name) values ('Company A3') returning id into v; perform test.put('A3', v);
  perform test.throws($q$insert into public.pt_companies (company_name) values ('company a1')$q$, 'duplicate active company name rejected (case-insensitive)', 'pt_companies_name_uidx');
  perform test.throws($q$insert into public.pt_companies (company_name, company_code) values ('Other Co', 'CA1')$q$, 'duplicate company code rejected', 'pt_companies_code_uidx');
  perform test.throws($q$insert into public.pt_companies (company_name) values ('X')$q$, 'company name too short rejected', 'check');
  perform test.throws($q$insert into public.pt_companies (company_name, contact_email) values ('Bad Mail Co', 'nope')$q$, 'invalid contact email rejected', 'check');
  perform test.throws($q$insert into public.pt_companies (company_name, website) values ('Bad Web Co', 'javascript:alert(1)')$q$, 'unsafe website rejected', 'check');
  perform test.throws($q$insert into public.pt_companies (company_name, contact_phone) values ('Bad Phone Co', 'call me')$q$, 'invalid phone rejected', 'check');
  perform test.throws($q$insert into public.pt_companies (company_name, remarks) values ('Secret Co', 'admin password: Hunter22x!')$q$, 'secrets rejected in company fields', 'looks like it contains');
  perform test.throws(format($q$update public.pt_companies set company_number = 'ZT-CO-9999' where id = %L$q$, test.id('A1')), 'company ID cannot be changed directly', 'permission denied');
  update public.pt_companies set city = 'Vijayawada', remarks = 'Edited' where id = test.id('A1');
  perform test.eq((select city from public.pt_companies where id = test.id('A1')), 'Vijayawada', 'editor can edit a company');
  perform test.throws(format($q$delete from public.pt_companies where id = %L$q$, test.id('A3')), 'companies cannot be hard-deleted', 'permission denied');
  perform test.as_owner();
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_type = 'company' and entity_id = test.id('A1') and action = 'company.created'), 'company creation logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_type = 'company' and entity_id = test.id('A1') and action = 'company.updated'), 'company edit logged');
end $$;

-- ------------------------------------------------------ projects belong to companies
do $$
declare v uuid;
begin
  perform test.as_user_email(test.id('editor'));
  perform test.throws($q$insert into public.pt_projects (name, client_name) values ('No Company Project', 'x')$q$, 'a new project must have a company', 'Select the company');
  insert into public.pt_projects (company_id, name, client_name, status) values (test.id('A1'), 'P1', 'ignored', 'live') returning id into v; perform test.put('A1P1', v);
  insert into public.pt_projects (company_id, name, client_name, status) values (test.id('A1'), 'P2', 'ignored', 'in_progress') returning id into v; perform test.put('A1P2', v);
  insert into public.pt_projects (company_id, name, client_name, status) values (test.id('A1'), 'P3', 'ignored', 'under_maintenance') returning id into v; perform test.put('A1P3', v);
  insert into public.pt_projects (company_id, name, client_name, status) values (test.id('A2'), 'P1', 'ignored', 'live') returning id into v; perform test.put('A2P1', v);
  insert into public.pt_projects (company_id, name, client_name, status) values (test.id('A2'), 'P2', 'ignored', 'planned') returning id into v; perform test.put('A2P2', v);
  insert into public.pt_projects (company_id, name, client_name) values (test.id('A3'), 'P1', 'ignored') returning id into v; perform test.put('A3P1', v);
  perform test.ok(true, 'same project names allowed under different companies (P1 x3)');
  perform test.eq((select client_name from public.pt_projects where id = test.id('A1P1')), 'Company A1', 'client name follows the company');
  perform test.throws(format($q$update public.pt_projects set company_id = null where id = %L$q$, test.id('A1P1')), 'project cannot be left without a company', 'without a company');
  perform test.throws(format($q$update public.pt_projects set company_id = %L where id = %L$q$, test.id('A2'), test.id('A1P3')), 'editor cannot move a project to another company', 'managers');
  perform test.throws(format($q$insert into public.pt_projects (company_id, name, client_name) values (%L, 'Ghost', 'x')$q$, gen_random_uuid()), 'unknown company rejected', null);

  -- counts
  perform test.eq((select total_projects from public.pt_company_summary where id = test.id('A1')), 3::bigint, 'Company A1 has 3 projects');
  perform test.eq((select live_projects from public.pt_company_summary where id = test.id('A1')), 1::bigint, 'Company A1 live count');
  perform test.eq((select in_progress_projects from public.pt_company_summary where id = test.id('A1')), 1::bigint, 'Company A1 in-progress count');
  perform test.eq((select maintenance_projects from public.pt_company_summary where id = test.id('A1')), 1::bigint, 'Company A1 maintenance count');
  perform test.eq((select total_projects from public.pt_company_summary where id = test.id('A2')), 2::bigint, 'Company A2 has 2 projects');
  perform test.eq((select total_projects from public.pt_company_summary where id = test.id('A3')), 1::bigint, 'Company A3 has 1 project');
  perform test.eq((select company_name from public.pt_project_list where id = test.id('A2P1')), 'Company A2', 'project list carries the company name');

  -- isolation between companies
  perform test.eq(test.count_rows(format('select * from public.pt_project_list where company_id = %L', test.id('A2'))), 2::bigint, 'company A2 lists only its own projects');
  perform test.ok(not exists (select 1 from public.pt_project_list where company_id = test.id('A2') and id in (test.id('A1P1'), test.id('A1P2'), test.id('A1P3'))),
                  'Company A1 projects never appear under Company A2');
  insert into public.pt_hosting (project_id, provider) values (test.id('A1P1'), 'Lovable');
  perform test.throws(format($q$insert into public.pt_email_accounts (project_id, email_address, linked_hosting_id)
                             select %L, 'x@a2.example', id from public.pt_hosting where project_id = %L$q$, test.id('A2P1'), test.id('A1P1')),
                      'a Company A2 record cannot link to Company A1 hosting', 'foreign key');
  perform test.as_owner();
end $$;

-- ------------------------------------------------------ manager moves a project
do $$
begin
  perform test.as_user_email(test.id('manager'));
  update public.pt_projects set company_id = test.id('A2') where id = test.id('A2P2');   -- no-op change
  update public.pt_projects set company_id = test.id('A3') where id = test.id('A2P2');
  perform test.eq((select company_id from public.pt_projects where id = test.id('A2P2')), test.id('A3'), 'manager can move a project to another company');
  perform test.eq((select client_name from public.pt_projects where id = test.id('A2P2')), 'Company A3', 'client name follows the move');
  update public.pt_projects set company_id = test.id('A2') where id = test.id('A2P2');
  perform test.as_owner();
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = test.id('A2P2') and action = 'project.updated'
                          and details -> 'fields' ? 'company_id'), 'company move logged on the project');
end $$;

-- ------------------------------------------------------ archive rules
do $$
begin
  perform test.as_user_email(test.id('editor'));
  perform test.throws(format($q$update public.pt_companies set archived_at = now(), archive_reason = 'test' where id = %L$q$, test.id('A3')),
                      'company with active projects cannot be archived', 'active project');
  update public.pt_projects set archived_at = now(), archive_reason = 'closing A3' where id = test.id('A3P1');
  update public.pt_companies set archived_at = now(), archive_reason = 'test archive' where id = test.id('A3');
  perform test.ok((select archived_at is not null from public.pt_companies where id = test.id('A3')), 'company archived once its projects are archived');
  perform test.throws(format($q$update public.pt_companies set city = 'x' where id = %L$q$, test.id('A3')), 'archived company is read-only', 'archived');
  perform test.throws(format($q$insert into public.pt_projects (company_id, name, client_name) values (%L, 'Late', 'x')$q$, test.id('A3')),
                      'no new projects under an archived company', 'company is archived');
  perform test.throws(format($q$update public.pt_companies set archived_at = null where id = %L$q$, test.id('A3')), 'editor cannot restore a company', 'managers can restore');
  perform test.as_user_email(test.id('manager'));
  perform test.throws(format($q$update public.pt_projects set archived_at = null where id = %L$q$, test.id('A3P1')),
                      'project cannot be restored while its company is archived', 'company is archived');
  update public.pt_companies set archived_at = null where id = test.id('A3');
  update public.pt_projects set archived_at = null where id = test.id('A3P1');
  perform test.ok((select archived_at is null from public.pt_projects where id = test.id('A3P1')), 'manager restores company, then project');
  perform test.eq((select total_projects from public.pt_company_summary where id = test.id('A3')), 1::bigint, 'restored project counted again');
  perform test.as_owner();
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = test.id('A3') and action = 'company.archived'), 'company archive logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = test.id('A3') and action = 'company.restored'), 'company restore logged');
end $$;

-- ------------------------------------------------------ backfill path for pre-003 projects
do $$
declare v uuid;
begin
  -- simulate a project created before 003 (owner bypasses nothing: disable only the company trigger for this insert)
  alter table public.pt_projects disable trigger pt_25_company;
  insert into public.pt_projects (name, client_name) values ('Legacy Project', 'Legacy Client') returning id into v;
  alter table public.pt_projects enable trigger pt_25_company;
  perform test.put('legacy', v);
  perform test.as_user_email(test.id('editor'));
  perform test.ok((select company_id is null and company_name is null from public.pt_project_list where id = v), 'pre-existing project stays unassigned (no invented company)');
  update public.pt_projects set remarks = 'still editable' where id = v;
  perform test.ok(true, 'unassigned project remains editable');
  update public.pt_projects set company_id = test.id('A2') where id = v;
  perform test.eq((select company_name from public.pt_project_list where id = v), 'Company A2', 'editor can assign an unassigned project to a company');
  perform test.as_owner();
end $$;

-- ------------------------------------------------------ due items carry the company
do $$
begin
  perform test.as_user_email(test.id('editor'));
  update public.pt_hosting set renewal_date = public.pt_today() + 5 where project_id = test.id('A1P1');
  perform test.eq((select company_name from public.pt_due_items where project_id = test.id('A1P1') limit 1), 'Company A1', 'renewals list the company');
  perform test.as_owner();
end $$;

select 'company suite finished' as result;

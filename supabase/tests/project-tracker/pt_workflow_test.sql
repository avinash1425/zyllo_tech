-- =====================================================================
-- LOCAL TEST ONLY. Project Tracker workflow / business-rule tests.
-- Runs after pt_security_test.sql (reuses its users via test.id()).
-- Synthetic data only.
-- =====================================================================
\set ON_ERROR_STOP 1

-- ------------------------------------------------------ "today" is the IST date
do $$
begin
  perform test.eq(public.pt_today(), (now() at time zone 'Asia/Kolkata')::date, 'pt_today() is the calendar date in India (not UTC)');
end $$;

-- ------------------------------------------------------ project register
do $$
declare v uuid; v_code text;
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_projects (company_id, name, client_name, category, status, priority, progress, responsible_person, start_date,
                                  expected_completion_date, description, scope, live_url, amc_applicable, seo_applicable)
  values (test.id('coT'), 'Synthetic Gamma Store', 'Gamma Test Retail', 'web_application', 'in_progress', 'high', 40, 'Test Lead G',
          public.pt_today() - 60, public.pt_today() + 30, 'Synthetic e-commerce build', 'Storefront, admin, payments (test data)',
          'https://gamma.example', true, true)
  returning id, project_code into v, v_code;
  perform test.put('pG', v);
  perform test.ok(v_code ~ '^ZT-PRJ-[0-9]{4}$', 'project ID generated automatically (' || v_code || ')');
  perform test.ok((select created_by_email from public.pt_projects where id = v) = 'pt.editor@example.test', 'Created By recorded from the session');

  insert into public.pt_projects (company_id, project_code, name, client_name) values (test.id('coT'), 'acme-web-01', 'Synthetic Acme', 'Acme Test') returning project_code into v_code;
  perform test.eq(v_code, 'ACME-WEB-01', 'custom project ID accepted and upper-cased');
  perform test.throws($q$insert into public.pt_projects (company_id, project_code, name, client_name) values (test.id('coT'), 'ACME-WEB-01', 'Another', 'Acme Test')$q$,
                      'project IDs are unique', 'pt_projects_code_uidx');
  perform test.throws($q$insert into public.pt_projects (company_id, project_code, name, client_name) values (test.id('coT'), 'ZT-PRJ-9999', 'Fake auto', 'X')$q$,
                      'automatic ID prefix is reserved', 'reserved');
  insert into public.pt_projects (company_id, name, client_name) values (test.id('coT'), 'Synthetic Acme', 'Acme Test');
  perform test.ok(true, 'project names need not be unique');
  perform test.throws($q$insert into public.pt_projects (company_id, name, client_name, progress) values (test.id('coT'), 'Bad progress', 'X', 120)$q$, 'progress limited to 0-100', 'check');
  perform test.throws($q$insert into public.pt_projects (company_id, name, client_name, start_date, expected_completion_date) values (test.id('coT'), 'Bad dates', 'X', public.pt_today(), public.pt_today() - 1)$q$,
                      'expected completion cannot precede start', 'pt_projects_expected_after_start');
  perform test.throws($q$insert into public.pt_projects (company_id, name, client_name, developed_by_zyllo) values (test.id('coT'), 'Inherited', 'X', false)$q$,
                      'original developer required when not built by Zyllo Tech', 'pt_projects_vendor');
  perform test.throws($q$insert into public.pt_projects (company_id, name, client_name, category) values (test.id('coT'), 'Other cat', 'X', 'other')$q$,
                      'category "Other" needs a description', 'pt_projects_category_other');
  perform test.throws($q$insert into public.pt_projects (company_id, name, client_name, live_url) values (test.id('coT'), 'Bad url', 'X', 'javascript:alert(1)')$q$,
                      'unsafe URLs rejected', 'check');
  perform test.throws($q$insert into public.pt_projects (company_id, name, client_name, status) values (test.id('coT'), 'Born archived', 'X', 'archived')$q$,
                      'new project cannot start archived', 'cannot start');
  perform test.throws(format($q$update public.pt_projects set serial_no = 999 where id = %L$q$, v), 'serial number cannot be changed', null);
  perform test.as_owner();
end $$;

-- ------------------------------------------------------- hosting / domains
do $$
declare v1 uuid; v2 uuid; d1 uuid;
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_hosting (project_id, provider, purpose, environment, hosting_type, renewal_date, responsible_person, server_host)
  values (test.id('pG'), 'Lovable', 'frontend', 'production', 'Managed', public.pt_today() + 10, 'Test Ops', 'gamma.lovable.app') returning id into v1;
  insert into public.pt_hosting (project_id, provider, purpose, environment, renewal_date)
  values (test.id('pG'), 'Supabase', 'database', 'production', public.pt_today() + 40) returning id into v2;
  insert into public.pt_hosting (project_id, provider, purpose, environment) values (test.id('pG'), 'Render', 'backend', 'staging');
  perform test.put('hostG1', v1); perform test.put('hostG2', v2);
  perform test.eq(test.count_rows(format('select * from public.pt_hosting where project_id = %L', test.id('pG'))), 3::bigint, 'multiple hosting providers per project');
  perform test.throws(format($q$update public.pt_hosting set status = 'migrated' where id = %L$q$, v1), 'migration must be documented', 'pt_hosting_migration_documented');
  update public.pt_hosting set status = 'migrated', migrated_to_id = v2 where id = v1;
  perform test.ok(true, 'hosting migration history recorded (migrated_to)');
  update public.pt_hosting set status = 'active', migrated_to_id = null where id = v1;

  insert into public.pt_domains (project_id, domain_name, domain_role, registrar, expires_on, ssl_type, ssl_expires_on)
  values (test.id('pG'), 'Gamma.Example', 'primary', 'Test Registrar', public.pt_today() + 5, 'dv', public.pt_today() + 20) returning id into d1;
  perform test.put('domG', d1);
  perform test.eq((select domain_name from public.pt_domains where id = d1), 'gamma.example', 'domain stored lower-case');
  insert into public.pt_domains (project_id, domain_name, domain_role) values (test.id('pG'), 'shop.gamma.example', 'subdomain');
  perform test.throws(format($q$insert into public.pt_domains (project_id, domain_name, domain_role) values (%L, 'gamma.example', 'secondary')$q$, test.id('pG')),
                      'duplicate active domain rejected', 'pt_domains_name_uidx');
  perform test.throws(format($q$insert into public.pt_domains (project_id, domain_name, domain_role) values (%L, 'gamma2.example', 'primary')$q$, test.id('pG')),
                      'only one primary domain per project', 'pt_domains_one_primary_uidx');
  perform test.throws(format($q$insert into public.pt_domains (project_id, domain_name) values (%L, 'not a domain')$q$, test.id('pG')),
                      'invalid domain name rejected', 'check');
  insert into public.pt_domains (project_id, domain_name, domain_role) values (test.id('pA'), 'gamma.example', 'secondary');
  perform test.ok(true, 'same domain may be recorded under a different project');
  perform test.as_owner();
end $$;

-- ------------------------------------------------------------ emails
do $$
declare e1 uuid;
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_email_accounts (project_id, email_address, purpose, provider, linked_hosting_id, linked_domain_id, two_factor)
  values (test.id('pG'), 'Admin@Gamma.Example', 'admin', 'Zoho Mail', test.id('hostG1'), test.id('domG'), 'enabled') returning id into e1;
  perform test.put('mailG', e1);
  insert into public.pt_email_accounts (project_id, email_address, purpose) values (test.id('pG'), 'support@gamma.example', 'support');
  insert into public.pt_email_accounts (project_id, email_address, purpose) values (test.id('pG'), 'billing@gamma.example', 'billing');
  perform test.eq(test.count_rows(format('select * from public.pt_email_accounts where project_id = %L', test.id('pG'))), 3::bigint, 'multiple email accounts per project');
  perform test.throws(format($q$insert into public.pt_email_accounts (project_id, email_address, purpose) values (%L, 'admin@gamma.example', 'admin')$q$, test.id('pG')),
                      'exact duplicate email + purpose rejected', 'same purpose (duplicate)');
  perform test.throws(format($q$insert into public.pt_email_accounts (project_id, email_address, purpose) values (%L, 'admin@gamma.example', 'billing')$q$, test.id('pG')),
                      'same mailbox for another purpose needs a justification', 'reuse justification');
  insert into public.pt_email_accounts (project_id, email_address, purpose, reuse_justification)
  values (test.id('pG'), 'admin@gamma.example', 'billing', 'Client uses one mailbox for admin and invoices');
  perform test.ok(true, 'justified reuse accepted');
  perform test.throws(format($q$insert into public.pt_email_accounts (project_id, email_address) values (%L, 'not-an-email')$q$, test.id('pG')),
                      'invalid email rejected', 'check');
  perform test.as_owner();
end $$;

-- ------------------------------------------------------------ backups
do $$
declare b1 uuid; b2 uuid; v_code text;
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_backups (project_id, name, backup_type, hosting_id, frequency) values (test.id('pG'), 'Nightly DB', 'database', test.id('hostG2'), 'daily')
  returning id, backup_code into b1, v_code;
  perform test.ok(v_code ~ '^BK-[0-9]{5}$', 'backup ID generated (' || v_code || ')');
  perform test.throws(format($q$update public.pt_backups set status = 'completed' where id = %L$q$, b1),
                      'cannot mark completed without date and location', 'pt_backups_completed_evidence');
  update public.pt_backups set status = 'completed', backup_at = now() - interval '2 days', storage_location_ref = 'Supabase PITR / project gamma (test)' where id = b1;
  perform test.ok(true, 'completed with date + location');
  perform test.throws(format($q$update public.pt_backups set status = 'verified' where id = %L$q$, b1),
                      'cannot mark verified without evidence', 'pt_backups_verified_evidence');
  perform test.throws(format($q$update public.pt_backups set status = 'verified', verified_by = 'QA', verified_on = public.pt_today(), verification_evidence = 'ok' where id = %L$q$, b1),
                      'verification evidence must be meaningful', 'pt_backups_verified_evidence');
  perform test.throws(format($q$update public.pt_backups set status = 'verified', verified_by = 'QA', verified_on = public.pt_today() + 3, verification_evidence = 'Checksum matched; 1,204 rows sampled' where id = %L$q$, b1),
                      'verification date cannot be in the future', 'future');
  update public.pt_backups set status = 'verified', verified_by = 'Test QA', verified_on = public.pt_today() - 1,
         verification_evidence = 'Downloaded dump, checksum matched, table counts compared' where id = b1;
  perform test.ok(true, 'verified with evidence');
  perform test.throws(format($q$update public.pt_backups set restore_tested = true where id = %L$q$, b1),
                      'restore tested needs date and evidence', 'pt_backups_restore_evidence');
  update public.pt_backups set restore_tested = true, restore_tested_on = public.pt_today(), restore_test_evidence = 'Restored to staging; login and orders page checked',
         restore_instructions = 'Use PITR in dashboard; see runbook doc' where id = b1;
  perform test.ok(true, 'restore test recorded with evidence');
  insert into public.pt_backups (project_id, name, status) values (test.id('pG'), 'Scheduled weekly files', 'scheduled') returning id into b2;
  perform test.throws(format($q$update public.pt_backups set status = 'completed', backup_at = now() + interval '3 days', storage_location_ref = 'x' where id = %L$q$, b2),
                      'completed backup cannot be in the future', 'future');
  perform test.as_owner();
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = b1 and action = 'backup.verified'), 'backup verification logged');
end $$;

-- ------------------------------------------------ source and deployments
do $$
declare r1 uuid;
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_repositories (project_id, git_provider, repo_url, visibility, main_branch, deployment_branch, frontend_hosting_id)
  values (test.id('pG'), 'github', 'https://github.com/example-org/gamma-store', 'private', 'main', 'release', test.id('hostG1')) returning id into r1;
  insert into public.pt_repositories (project_id, git_provider, repo_url) values (test.id('pG'), 'github', 'https://github.com/example-org/gamma-api');
  perform test.throws(format($q$insert into public.pt_repositories (project_id, repo_url) values (%L, 'https://GitHub.com/example-org/gamma-store')$q$, test.id('pG')),
                      'duplicate repository rejected', 'pt_repositories_url_uidx');
  perform test.throws(format($q$insert into public.pt_repositories (project_id, repo_url, frontend_hosting_id) values (%L, 'https://github.com/x/y', %L)$q$, test.id('pG'), test.id('hostA')),
                      'repository cannot reference another project''s hosting', 'foreign key');
  insert into public.pt_deployments (project_id, repository_id, environment, deployed_at, release_version, commit_ref, status)
  values (test.id('pG'), r1, 'production', now() - interval '1 day', 'v1.0.0', 'abc1234', 'succeeded');
  insert into public.pt_deployments (project_id, repository_id, environment, deployed_at, release_version, commit_ref, status, rollback_ref)
  values (test.id('pG'), r1, 'production', now(), 'v1.0.1', 'def5678', 'rolled_back', 'v1.0.0');
  perform test.eq(test.count_rows(format('select * from public.pt_deployments where project_id = %L', test.id('pG'))), 2::bigint, 'deployment history kept');
  perform test.throws(format($q$insert into public.pt_deployments (project_id, status) values (%L, 'succeeded')$q$, test.id('pG')),
                      'finished deployment needs a date', 'pt_deployments_done_has_date');
  perform test.as_owner();
end $$;

-- ------------------------------------------------ updates, tasks, milestones
do $$
declare m1 uuid; t1 uuid; v_code text;
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_updates (project_id, updated_by_name, update_type, description, version, environment, testing_status, approval_status, deployment_date)
  values (test.id('pG'), 'Test Dev', 'security_update', 'Patched dependency (synthetic)', 'v1.0.1', 'production', 'passed', 'approved', public.pt_today())
  returning update_code into v_code;
  perform test.ok(v_code ~ '^UPD-[0-9]{5}$', 'update ID generated (' || v_code || ')');
  insert into public.pt_milestones (project_id, name, target_date) values (test.id('pG'), 'Go-live', public.pt_today() + 30) returning id into m1;
  insert into public.pt_tasks (project_id, title, assigned_to, due_date, milestone_id, status) values (test.id('pG'), 'Configure payment sandbox', 'Test Dev', public.pt_today() - 2, m1, 'in_progress')
  returning id, task_code into t1, v_code;
  perform test.ok(v_code ~ '^TSK-[0-9]{5}$', 'task ID generated (' || v_code || ')');
  perform test.throws(format($q$update public.pt_tasks set status = 'done' where id = %L$q$, t1), 'done task needs a completion date', 'pt_tasks_done');
  perform test.throws(format($q$insert into public.pt_tasks (project_id, title, milestone_id) values (%L, 'x', %L)$q$, test.id('pA'), m1),
                      'task cannot use another project''s milestone', 'foreign key');
  perform test.throws(format($q$update public.pt_milestones set status = 'completed' where id = %L$q$, m1), 'completed milestone needs a date', 'pt_milestones_completed');
  perform test.as_owner();
end $$;

-- ------------------------------------------------------- AMC and renewals
do $$
declare c1 uuid; c2 uuid; r1 uuid; r2 uuid;
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_amc_contracts (project_id, contract_number, service_scope, start_date, end_date, renewal_date, status, maintenance_frequency)
  values (test.id('pG'), 'AMC-T-001', 'Monthly maintenance (synthetic)', public.pt_today() - 330, public.pt_today() + 35, public.pt_today() + 14, 'active', 'monthly') returning id into c1;
  perform test.throws(format($q$insert into public.pt_amc_contracts (project_id, start_date, end_date) values (%L, public.pt_today(), public.pt_today() - 1)$q$, test.id('pG')),
                      'AMC end must not precede start', 'pt_amc_dates');
  c2 := public.pt_renew_amc(c1, public.pt_today() + 36, public.pt_today() + 400, public.pt_today() + 380, 'AMC-T-002');
  perform test.eq((select status from public.pt_amc_contracts where id = c1), 'renewed', 'old AMC marked renewed');
  perform test.eq((select renewed_from_id from public.pt_amc_contracts where id = c2), c1, 'new AMC linked to its predecessor (renewal history)');

  insert into public.pt_renewals (project_id, item_type, item_label, domain_id, due_date, amount, vendor)
  values (test.id('pG'), 'domain', 'gamma.example registration', test.id('domG'), public.pt_today() + 5, 1200, 'Test Registrar') returning id into r1;
  insert into public.pt_renewals (project_id, item_type, item_label, due_date) values (test.id('pG'), 'subscription', 'Email marketing plan', public.pt_today() + 50) returning id into r2;
  perform test.throws(format($q$update public.pt_renewals set status = 'completed' where id = %L$q$, r1), 'renewal completion needs evidence', 'pt_renewals_completed_evidence');
  perform test.throws(format($q$select public.pt_complete_renewal(%L, public.pt_today() + 1, public.pt_today() + 400, 'Invoice #T-1')$q$, r1),
                      'renewal completion date cannot be in the future', 'not in the future');
  perform public.pt_complete_renewal(r1, public.pt_today(), public.pt_today() + 370, 'Registrar invoice T-1 (synthetic)');
  perform test.eq((select expires_on from public.pt_domains where id = test.id('domG')), public.pt_today() + 370, 'completing a domain renewal extends the domain expiry');
  perform test.throws(format($q$select public.pt_complete_renewal(%L, public.pt_today(), null, 'again')$q$, r1), 'a completed renewal cannot be completed twice', 'Only upcoming');
  perform test.as_user_email(test.id('viewer'));
  perform test.throws(format($q$select public.pt_complete_renewal(%L, public.pt_today(), null, 'viewer try')$q$, r2), 'viewer cannot complete renewals', 'permission');
  perform test.throws(format($q$select public.pt_renew_amc(%L, public.pt_today(), public.pt_today() + 10)$q$, c2), 'viewer cannot renew AMC', 'permission');
  perform test.as_owner();
  perform test.ok(exists (select 1 from public.pt_activity_logs where action = 'amc.renewed'), 'AMC renewal logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where action = 'renewal.completed'), 'renewal completion logged');
end $$;

-- ------------------------------------------------------------------ SEO
do $$
begin
  perform test.as_user_email(test.id('editor'));
  perform test.throws(format($q$insert into public.pt_seo_records (project_id, ga4_measurement_id) values (%L, 'UA-1234')$q$, test.id('pG')), 'GA4 ID format validated', 'check');
  insert into public.pt_seo_records (project_id, seo_status, ga4_measurement_id, gsc_property, verification_method, verification_status, sitemap_url, robots_url)
  values (test.id('pG'), 'active', 'G-TEST12345', 'sc-domain:gamma.example', 'dns_txt', 'verified', 'https://gamma.example/sitemap.xml', 'https://gamma.example/robots.txt');
  perform test.throws(format($q$insert into public.pt_seo_records (project_id) values (%L)$q$, test.id('pG')), 'one active SEO record per project', 'pt_seo_one_per_project_uidx');
  perform test.as_owner();
end $$;

-- ---------------------------------------------------- completeness score
do $$
declare h record;
begin
  perform test.as_user_email(test.id('editor'));
  select * into h from public.pt_project_health where project_id = test.id('pG');
  perform test.eq(h.overview_state, 'complete', 'overview complete');
  perform test.eq(h.hosting_state, 'complete', 'hosting complete (production + renewal + responsible)');
  perform test.eq(h.admin_access_state, 'missing', 'admin access missing (no credential reference)');
  perform test.eq(h.backups_state, 'complete', 'backups complete (verified + restore instructions)');
  perform test.eq(h.maintenance_state, 'na', 'maintenance not applicable while in progress');
  perform test.eq(h.handover_state, 'na', 'handover not due while in progress');
  perform test.eq(h.seo_state, 'complete', 'SEO complete');
  perform test.eq(h.completeness_label, 'partial', 'in-progress project with gaps is Partially Complete (not critical yet)');
  perform test.eq(h.overdue_tasks, 1::bigint, 'overdue task counted');

  update public.pt_projects set status = 'live' where id = test.id('pG');
  select * into h from public.pt_project_health where project_id = test.id('pG');
  perform test.eq(h.completeness_label, 'missing_critical', 'live project without admin access is Missing Critical Information');
  perform test.eq(h.handover_state, 'missing', 'handover due once live');
  perform test.ok(h.admin_details_missing and h.handover_pending, 'dashboard flags: missing admin details, pending handover');
  perform test.ok(not h.backup_missing, 'recent completed backup: not flagged as missing');

  insert into public.pt_access_records (project_id, service_name, category) values (test.id('pG'), 'Gamma admin', 'website_admin') returning id into h;
  perform public.pt_set_access_reference(h.id, 'owner@gamma.example', 'Vault: Gamma / admin');
  select * into h from public.pt_project_health where project_id = test.id('pG');
  perform test.eq(h.admin_access_state, 'complete', 'admin access complete once a reference exists');

  update public.pt_projects set not_applicable_sections = array['source'] where id = test.id('pG');
  select * into h from public.pt_project_health where project_id = test.id('pG');
  perform test.eq(h.source_state, 'na', 'section marked not applicable is not counted as missing');
  perform test.ok(h.completeness_score between 1 and 99, 'score is a percentage (' || h.completeness_score || ')');

  -- Project A (live, no backups) is flagged
  select * into h from public.pt_project_health where project_id = test.id('pA');
  perform test.ok(h.backup_missing, 'live project without backups flagged as missing backups');
  perform test.as_owner();
end $$;

-- -------------------------------------------------------------- due items
do $$
begin
  perform test.as_user_email(test.id('editor'));
  perform test.ok(exists (select 1 from public.pt_due_items where project_id = test.id('pG') and kind = 'hosting' and days_left = 10), 'hosting renewal in 10 days listed');
  perform test.ok(exists (select 1 from public.pt_due_items where project_id = test.id('pG') and kind = 'ssl' and days_left = 20), 'SSL expiry listed');
  perform test.ok(exists (select 1 from public.pt_due_items where project_id = test.id('pG') and kind = 'amc'), 'AMC renewal listed');
  perform test.ok(exists (select 1 from public.pt_due_items where project_id = test.id('pG') and kind = 'subscription' and days_left = 50), 'independent subscription renewal listed');
  perform test.ok(not exists (select 1 from public.pt_due_items where record_id in (select id from public.pt_renewals where status = 'completed')), 'completed renewals drop off');
  perform test.eq(test.count_rows(format('select * from public.pt_due_items where project_id = %L and days_left between 0 and 15', test.id('pG'))), 1::bigint,
                  '15-day window: only the hosting renewal (SSL is at 20 days; AMC already renewed)');
  perform test.eq(test.count_rows(format('select * from public.pt_due_items where project_id = %L and days_left between 0 and 30', test.id('pG'))), 2::bigint,
                  '30-day window: hosting renewal + SSL expiry');
  update public.pt_projects set archived_at = now(), archive_reason = 'window test' where id = test.id('pG');
  perform test.eq(test.count_rows(format('select * from public.pt_due_items where project_id = %L', test.id('pG'))), 0::bigint, 'archived projects drop out of due items');
  perform test.as_user_email(test.id('manager'));
  update public.pt_projects set archived_at = null where id = test.id('pG');
  perform test.eq((select status from public.pt_projects where id = test.id('pG')), 'live', 'restored to Live');
  perform test.as_owner();
end $$;

-- --------------------------------------------------------------- handover
do $$
declare
  v_ho uuid;
  v_doc uuid;
  v_guide uuid;
  k text;
begin
  perform test.as_user_email(test.id('editor'));
  v_ho := public.pt_start_handover(test.id('pG'));
  perform test.put('hoG', v_ho);
  perform test.eq(test.count_rows(format('select * from public.pt_handover_items where handover_id = %L', v_ho)), 15::bigint, 'handover checklist has 15 items');
  perform test.throws(format('select public.pt_start_handover(%L)', test.id('pG')), 'only one active handover per project', 'already has');
  perform test.throws(format($q$select public.pt_handover_transition(%L, 'ready_for_review')$q$, v_ho), 'cannot submit with pending items', 'pending');
  perform test.throws(format($q$update public.pt_handovers set status = 'approved' where id = %L$q$, v_ho), 'status cannot be set directly', 'permission denied');
  perform test.throws(format($q$update public.pt_handover_items set state = 'done' where handover_id = %L and item_key = 'client_approval'$q$, v_ho),
                      'a checkbox alone does not complete an item (evidence required)', 'pt_handover_items_done_evidence');
  perform test.throws(format($q$update public.pt_handover_items set state = 'not_applicable', evidence_note = 'n/a for now' where handover_id = %L and item_key = 'client_approval'$q$, v_ho),
                      'mandatory items cannot be Not applicable', 'mandatory');
  perform test.throws(format($q$update public.pt_handover_items set state = 'not_applicable', evidence_note = 'No AMC' where handover_id = %L and item_key = 'amc_terms_documented'$q$, v_ho),
                      'AMC terms required when AMC is applicable', 'AMC is marked applicable');
  perform test.throws(format($q$update public.pt_handover_items set state = 'done', evidence_note = 'Signed by client' where handover_id = %L and item_key = 'signed_approval_attached'$q$, v_ho),
                      'signed approval needs an attached document', 'Attach the signed approval');
  perform test.throws(format($q$update public.pt_handover_items set state = 'done', evidence_note = 'Recipient confirmed by phone' where handover_id = %L and item_key = 'recipient_confirmed'$q$, v_ho),
                      'recipient must be entered first', 'recipient first');

  insert into public.pt_documents (project_id, name, category, external_url) values (test.id('pG'), 'Client sign-off', 'client_approval', 'https://drive.example/signoff') returning id into v_doc;
  insert into public.pt_documents (project_id, name, category, external_url) values (test.id('pG'), 'User guide', 'user_guide', 'https://drive.example/guide') returning id into v_guide;
  update public.pt_handovers set recipient_name = 'Test Client Owner', recipient_email = 'owner@gamma.example', handover_date = public.pt_today(), approval_document_id = v_doc where id = v_ho;
  foreach k in array array['client_approval', 'production_verified', 'domain_documented', 'hosting_documented', 'admin_access_handed_over',
                           'email_documented', 'repository_documented', 'latest_backup_verified', 'restore_instructions', 'training_completed',
                           'amc_terms_documented', 'recipient_confirmed', 'handover_date_recorded'] loop
    execute format($q$update public.pt_handover_items set state = 'done', evidence_note = %L where handover_id = %L and item_key = %L$q$, 'Checked: ' || k, v_ho, k);
  end loop;
  update public.pt_handover_items set state = 'done', evidence_document_id = v_guide where handover_id = v_ho and item_key = 'user_guide';
  update public.pt_handover_items set state = 'done', evidence_document_id = v_doc where handover_id = v_ho and item_key = 'signed_approval_attached';
  perform test.ok((select completed_by_email from public.pt_handover_items where handover_id = v_ho and item_key = 'user_guide') = 'pt.editor@example.test',
                  'item completion records who and when');
  perform public.pt_handover_transition(v_ho, 'ready_for_review', 'All items evidenced');
  perform test.eq((select status from public.pt_handovers where id = v_ho), 'ready_for_review', 'submitted for review');
  perform test.throws(format($q$update public.pt_handover_items set state = 'pending' where handover_id = %L and item_key = 'user_guide'$q$, v_ho),
                      'checklist locked after submission', 'only change while');
  perform test.throws(format($q$update public.pt_handovers set recipient_name = 'Someone else' where id = %L$q$, v_ho), 'handover details locked after submission', 'Send it back');
  perform test.throws(format($q$select public.pt_handover_transition(%L, 'approved')$q$, v_ho), 'editor cannot approve', 'managers');
  perform test.throws(format($q$select public.pt_handover_transition(%L, 'handed_over', 'skip')$q$, v_ho), 'cannot skip approval', 'cannot move');

  perform test.as_user_email(test.id('manager'));
  perform public.pt_handover_transition(v_ho, 'approved', 'Reviewed evidence');
  perform test.eq((select approved_by_email from public.pt_handovers where id = v_ho), 'pt.manager@example.test', 'approver recorded');
  perform test.throws(format($q$select public.pt_handover_transition(%L, 'handed_over', 'ok')$q$, v_ho), 'completion needs a confirmation statement', 'at least 10');
  perform public.pt_handover_transition(v_ho, 'handed_over', 'Credentials handed over in person; client confirmed by email');
  perform test.eq((select status from public.pt_handovers where id = v_ho), 'handed_over', 'handover completed');
  perform test.eq(test.count_rows(format('select * from public.pt_handover_events where handover_id = %L', v_ho)), 4::bigint, 'every transition recorded as an event');
  perform test.throws(format($q$update public.pt_handover_events set comment = 'x' where handover_id = %L$q$, v_ho), 'handover events cannot be edited', 'permission denied');
  perform test.eq((select handover_state from public.pt_project_health where project_id = test.id('pG')), 'complete', 'handover section complete');
  perform test.as_owner();
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = v_ho and action = 'handover.approved'), 'handover approval logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = v_ho and action = 'handover.completed'), 'handover completion logged');
end $$;

-- ----------------------------------------------------------- activity log
do $$
begin
  perform test.as_user_email(test.id('viewer'));
  perform test.ok((select count(*) from public.pt_activity_logs where project_id = test.id('pG')) >= 20, 'viewer can read the project history');
  perform test.ok(exists (select 1 from public.pt_activity_logs where project_id = test.id('pG') and action = 'project.status_changed'
                            and details ->> 'from' = 'in_progress' and details ->> 'to' = 'live'), 'status change logged with from/to');
  perform test.ok(exists (select 1 from public.pt_activity_logs where project_id = test.id('pG') and action = 'hosting.created'), 'hosting added logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where project_id = test.id('pG') and action = 'email.created'), 'email added logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where project_id = test.id('pG') and action = 'document.created'), 'document added logged');
  perform test.ok(not exists (select 1 from public.pt_activity_logs l where l.project_id = test.id('pG') and l.details::text ~* '(Vault: Gamma|owner@gamma\.example)'),
                  'no credential data in project history');
  perform test.ok(not exists (select 1 from public.pt_activity_logs l where l.project_id = test.id('pA') and l.entity_id in
                    (select id from public.pt_hosting where project_id = test.id('pG'))), 'project G events never logged under project A');
  perform test.as_owner();
end $$;

-- ------------------------------------------------------------ remarks
do $$
begin
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_remarks (project_id, body) values (test.id('pG'), 'Client asked for a quarterly review call (synthetic).');
  perform test.ok(exists (select 1 from public.pt_activity_logs where project_id = test.id('pG') and action = 'remark.created'), 'remark recorded in history');
  perform test.as_owner();
end $$;

select 'workflow suite finished' as result;

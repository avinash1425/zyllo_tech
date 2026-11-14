-- =====================================================================
-- LOCAL DEMO DATA ONLY. NEVER APPLY TO A REAL SUPABASE PROJECT.
-- Entirely fictional companies, people, domains and references — no real
-- credentials, no real secrets. Applied by scripts/pt-local/start.mjs after
-- the synthetic users exist. Everything is inserted AS the synthetic
-- manager (pt_harness.act_as), so RLS, triggers and the audit log behave
-- exactly as they do for the app.
--
--   Company A1 — P1 Corporate Website (complete in all 13 sections),
--                P2 Customer Portal, P3 Inventory ERP
--   Company A2 — P1 E-commerce Store, P2 Delivery Mobile App
--   Company A3 — P1 School Website
-- =====================================================================
\set ON_ERROR_STOP 1

do $$
declare
  t date := public.pt_today();
  a1 uuid; a2 uuid; a3 uuid;
  p1 uuid; p2 uuid; p3 uuid; q1 uuid; q2 uuid; r1 uuid;
  h1 uuid; h2 uuid; d1 uuid; acc1 uuid; acc2 uuid; repo uuid; amc uuid; ms1 uuid; ms2 uuid;
  doc_sow uuid; doc_signoff uuid; doc_guide uuid; ho uuid; k text;
  path_sow text; path_signoff text; path_sow2 text; doc_sow2 uuid; acc_mail uuid; acc_host uuid;
begin
  perform pt_harness.act_as('pt.manager@example.test');

  -- ------------------------------------------------------------ companies
  insert into public.pt_companies (company_name, company_code, company_type, website, contact_person, contact_email, contact_phone,
                                   country, state, city, address, status, remarks)
  values ('Company A1', 'A1', 'private_limited', 'https://a1-demo.example', 'Ravi Demo', 'ravi@a1-demo.example', '+91 90000 11111',
          'India', 'Andhra Pradesh', 'Guntur', '12 Demo Road, Brodipet (fictional)', 'active', 'Fictional demo client — retail group.')
  returning id into a1;
  insert into public.pt_companies (company_name, company_code, company_type, website, contact_person, contact_email, contact_phone,
                                   country, state, city, status)
  values ('Company A2', 'A2', 'llp', 'https://a2-demo.example', 'Meera Demo', 'meera@a2-demo.example', '+91 90000 22222',
          'India', 'Telangana', 'Hyderabad', 'active')
  returning id into a2;
  insert into public.pt_companies (company_name, company_code, company_type, contact_person, contact_email, country, state, city, status)
  values ('Company A3', 'A3', 'educational', 'Principal Demo', 'office@a3-demo.example', 'India', 'Andhra Pradesh', 'Vijayawada', 'active')
  returning id into a3;

  -- ------------------------------------------------------------ projects
  insert into public.pt_projects (company_id, name, client_name, category, status, priority, progress, responsible_person, start_date,
                                  expected_completion_date, actual_completion_date, description, scope, live_url, staging_url, remarks,
                                  amc_applicable, seo_applicable, developed_by_zyllo)
  values (a1, 'P1 — Corporate Website', 'x', 'website', 'live', 'high', 100, 'Kiran Demo', t - 160, t - 70, t - 75,
          'Fictional corporate website with product catalogue and enquiry forms.',
          'Design, development, hosting set-up, SEO foundation, training and one-year AMC (demo data).',
          'https://www.a1-demo.example', 'https://review.a1-demo.example', 'Demo project with every section filled in.', true, true, true)
  returning id into p1;
  insert into public.pt_projects (company_id, name, client_name, category, status, priority, progress, responsible_person, start_date, expected_completion_date, description, staging_url)
  values (a1, 'P2 — Customer Portal', 'x', 'web_application', 'in_progress', 'medium', 55, 'Sita Demo', t - 45, t + 40,
          'Customer self-service portal (demo).', 'https://portal-review.a1-demo.example')
  returning id into p2;
  insert into public.pt_projects (company_id, name, client_name, category, status, priority, progress, responsible_person, start_date, description, live_url, developed_by_zyllo, original_developer)
  values (a1, 'P3 — Inventory ERP', 'x', 'erp', 'under_maintenance', 'medium', 100, 'Kiran Demo', t - 400,
          'Inventory ERP taken over for maintenance (demo).', 'https://erp.a1-demo.example', false, 'Fictional Vendor Pvt Ltd')
  returning id into p3;
  insert into public.pt_projects (company_id, name, client_name, category, status, priority, progress, responsible_person, start_date, live_url, description)
  values (a2, 'P1 — E-commerce Store', 'x', 'web_application', 'live', 'high', 100, 'Meera Demo', t - 220, 'https://shop.a2-demo.example', 'Online store (demo).')
  returning id into q1;
  insert into public.pt_projects (company_id, name, client_name, category, status, priority, progress, start_date, description)
  values (a2, 'P2 — Delivery Mobile App', 'x', 'mobile_application', 'planned', 'low', 0, t + 10, 'Delivery partner app (demo).')
  returning id into q2;
  insert into public.pt_projects (company_id, name, client_name, category, status, priority, progress, responsible_person, start_date, actual_completion_date, live_url, description)
  values (a3, 'P1 — School Website', 'x', 'website', 'completed', 'medium', 100, 'Anil Demo', t - 300, t - 200, 'https://www.a3-demo.example', 'School information website (demo).')
  returning id into r1;

  -- a little data on the other projects (so lists and renewals have content)
  insert into public.pt_hosting (project_id, provider, purpose, environment, renewal_date, responsible_person)
  values (q1, 'Hostinger VPS', 'backend', 'production', t + 12, 'Meera Demo'),
         (p3, 'DigitalOcean', 'backend', 'production', t + 45, 'Kiran Demo');
  insert into public.pt_domains (project_id, domain_name, domain_role, registrar, expires_on, ssl_type, ssl_expires_on)
  values (q1, 'shop.a2-demo.example', 'primary', 'Demo Registrar', t + 25, 'dv', t + 8),
         (r1, 'a3-demo.example', 'primary', 'Demo Registrar', t + 55, 'managed_auto', null);
  insert into public.pt_tasks (project_id, title, assigned_to, status, due_date) values (p2, 'Finish payment gateway sandbox (demo)', 'Sita Demo', 'in_progress', t - 3);

  -- ------------------------------------------------------------ P1: hosting
  insert into public.pt_hosting (project_id, provider, purpose, environment, hosting_type, account_email, account_owner, control_panel_url,
                                 server_identifier, server_host, server_region, operating_system, deployment_ref, purchase_date, renewal_date,
                                 expiry_date, auto_renew, status, responsible_person, remarks)
  values (p1, 'Hostinger VPS', 'backend', 'production', 'VPS (KVM 2)', 'hosting@a1-demo.example', 'Company A1', 'https://hpanel.example/a1',
          'vps-a1-demo-01', '203.0.113.10', 'Mumbai', 'Ubuntu 24.04', '/var/www/a1-site', t - 160, t + 20, t + 20, true, 'active', 'Kiran Demo',
          'Fictional server — documentation IP range.')
  returning id into h1;
  insert into public.pt_hosting (project_id, provider, purpose, environment, hosting_type, server_host, renewal_date, status, responsible_person)
  values (p1, 'Cloudflare', 'frontend', 'production', 'CDN / DNS', 'a1-demo.example', t + 200, 'active', 'Kiran Demo')
  returning id into h2;
  insert into public.pt_hosting (project_id, provider, purpose, environment, server_host, status)
  values (p1, 'Render', 'backend', 'staging', 'a1-review.onrender.example', 'active');

  -- ------------------------------------------------------------ P1: domains
  insert into public.pt_domains (project_id, domain_name, domain_role, registrar, registrar_account_email, dns_provider, nameservers, registered_on,
                                 expires_on, auto_renew, ssl_provider, ssl_type, ssl_expires_on, ssl_auto_renew, status, ownership, handover_status)
  values (p1, 'a1-demo.example', 'primary', 'Demo Registrar', 'domains@a1-demo.example', 'Cloudflare', 'ns1.demo-dns.example
ns2.demo-dns.example', t - 900, t + 14, true, 'Cloudflare', 'managed_auto', null, true, 'active', 'client', 'handed_over')
  returning id into d1;
  insert into public.pt_domains (project_id, domain_name, domain_role, registrar, expires_on, ssl_type, ssl_expires_on, status)
  values (p1, 'review.a1-demo.example', 'subdomain', 'Demo Registrar', t + 14, 'dv', t + 30, 'active');

  -- ------------------------------------------------------------ P1: credentials (references only)
  insert into public.pt_access_records (project_id, service_name, category, login_url, account_owner, access_level, responsible_person,
                                        two_factor, last_rotated_on, rotation_due_on, last_verified_on, status)
  values (p1, 'Website admin (CMS)', 'website_admin', 'https://www.a1-demo.example/admin', 'Company A1', 'Administrator', 'Kiran Demo',
          'enabled', t - 30, t + 60, t - 7, 'active')
  returning id into acc1;
  perform public.pt_set_access_reference(acc1, 'admin@a1-demo.example', 'Demo Vault › Clients › Company A1 › CMS admin');
  insert into public.pt_access_records (project_id, service_name, category, login_url, access_level, two_factor, status)
  values (p1, 'Hosting control panel', 'hosting_panel', 'https://hpanel.example/a1', 'Owner', 'enabled', 'active')
  returning id into acc2;
  perform public.pt_set_access_reference(acc2, 'a1-owner', 'Demo Vault › Clients › Company A1 › Hosting panel');
  insert into public.pt_access_records (project_id, service_name, category, login_url, access_level, two_factor, status)
  values (p1, 'GitHub organisation', 'github', 'https://github.example/a1-demo', 'Maintainer', 'enabled', 'active');

  -- 004 metadata on the records above + one or more records per credential type (synthetic; no passwords).
  update public.pt_access_records set login_identifier = 'admin@a1-demo.example', environment = 'production', account_owner = 'Company A1' where id = acc1;
  update public.pt_access_records set login_identifier = 'a1-owner', provider = 'Hostinger', hosting_type = 'VPS (KVM 2)', environment = 'production',
         resource_ref = 'vps-a1-demo-01', renewal_date = t + 20, account_owner = 'Company A1' where id = acc2;
  update public.pt_access_records set login_identifier = 'a1-demo-bot', organization = 'a1-demo', resource_ref = 'a1-demo/corporate-website',
         account_owner = 'Company A1' where project_id = p1 and service_name = 'GitHub organisation';
  insert into public.pt_access_records (project_id, service_name, category, login_url, login_identifier, environment, account_owner, access_level,
                                        responsible_person, two_factor, last_verified_on, status, remarks)
  values (p1, 'Website admin — staging', 'website_admin', 'https://review.a1-demo.example/admin', 'qa-admin@a1-demo.example', 'staging', 'Zyllo Tech',
          'Editor', 'Kiran Demo', 'disabled', t - 3, 'active', 'Second website admin account used for QA (demo).'),
         (p1, 'Supabase — production', 'supabase', 'https://supabase.example/dashboard/project/demo-a1-prod', 'dev@a1-demo.example', 'production',
          'Company A1', 'Owner', 'Kiran Demo', 'enabled', t - 7, 'active', 'Dashboard login only. Never record service-role or API keys here.'),
         (p1, 'Database — production (read-only user)', 'database', null, 'report_reader', 'production', 'Company A1', 'Read-only',
          'Kiran Demo', 'not_supported', t - 14, 'active', 'Reporting user; host is documented in Hosting & Servers.'),
         (p1, 'Domain registrar account', 'domain_registrar', 'https://registrar.example/login', 'domains@a1-demo.example', null, 'Company A1', 'Owner',
          'Ravi Demo', 'enabled', t - 60, 'active', null),
         (p1, 'Cloudflare account', 'cloudflare', 'https://dash.cloudflare.example', 'dns@a1-demo.example', 'production', 'Company A1', 'Administrator',
          'Kiran Demo', 'enabled', t - 20, 'active', null),
         (p1, 'Vercel team (marketing previews)', 'vercel', 'https://vercel.example/a1-demo', 'dev@a1-demo.example', 'staging', 'Zyllo Tech', 'Member',
          'Kiran Demo', 'enabled', t - 20, 'active', null),
         (p1, 'cPanel — legacy site', 'cpanel', 'https://legacy-host.example:2083', 'a1legacy', 'production', 'Company A1', 'Owner',
          'Kiran Demo', 'unknown', null, 'pending', 'Old shared hosting kept until the archive is moved (demo).');
  update public.pt_access_records set provider = 'Demo Registrar', resource_ref = 'a1-demo.example', renewal_date = t + 14
   where project_id = p1 and category = 'domain_registrar';
  update public.pt_access_records set organization = 'Company A1', project_name = 'a1-corporate-prod', resource_ref = 'demo-a1-prod'
   where project_id = p1 and category = 'supabase';
  update public.pt_access_records set provider = 'Demo Postgres host', resource_ref = 'db-a1-demo-01 (private network)' where project_id = p1 and category = 'database';
  update public.pt_access_records set organization = 'Company A1', project_name = 'a1-demo.example', resource_ref = 'zone a1-demo.example' where project_id = p1 and category = 'cloudflare';
  update public.pt_access_records set organization = 'a1-demo', project_name = 'a1-marketing', resource_ref = 'a1-marketing' where project_id = p1 and category = 'vercel';
  update public.pt_access_records set provider = 'Legacy Host', hosting_type = 'Shared', resource_ref = 'legacy-host.example', renewal_date = t + 40
   where project_id = p1 and category = 'cpanel';
  insert into public.pt_access_records (project_id, service_name, category, login_url, login_identifier, provider, environment, two_factor, status)
  values (q1, 'Store admin', 'website_admin', 'https://shop.a2-demo.example/admin', 'owner@a2-demo.example', null, 'production', 'enabled', 'active'),
         (q1, 'Supabase — store', 'supabase', 'https://supabase.example/dashboard/project/demo-a2-store', 'dev@a2-demo.example', null, 'production', 'enabled', 'active'),
         (r1, 'School website admin', 'website_admin', 'https://www.a3-demo.example/wp-admin', 'office@a3-demo.example', null, 'production', 'unknown', 'active');

  -- ------------------------------------------------------------ P1: emails
  insert into public.pt_email_accounts (project_id, email_address, purpose, provider, login_url, account_owner, responsible_person,
                                        linked_hosting_id, linked_domain_id, linked_access_id, status, created_on, last_verified_on, two_factor, recovery_contact_ref)
  values (p1, 'admin@a1-demo.example', 'admin', 'Zoho Mail', 'https://mail.example', 'Company A1', 'Kiran Demo', h1, d1, acc1, 'active', t - 150, t - 7, 'enabled',
          'Recovery phone held by client IT (see Demo Vault)'),
         (p1, 'support@a1-demo.example', 'support', 'Zoho Mail', 'https://mail.example', 'Company A1', 'Kiran Demo', null, d1, null, 'active', t - 150, t - 7, 'enabled', null),
         (p1, 'billing@a1-demo.example', 'billing', 'Zoho Mail', 'https://mail.example', 'Company A1', 'Ravi Demo', null, d1, null, 'active', t - 150, t - 30, 'unknown', null);

  acc_host := public.pt_ensure_hosting_credential(h1);
  acc_mail := public.pt_ensure_email_credential((select id from public.pt_email_accounts where project_id = p1 and email_address = 'support@a1-demo.example'));

  -- ------------------------------------------------------------ P1: backups
  insert into public.pt_backups (project_id, name, backup_type, hosting_id, backup_at, method, frequency, storage_provider, storage_location_ref,
                                 retention_period, encryption_status, status, file_size_bytes, checksum, verified_by, verified_on, verification_evidence,
                                 restore_tested, restore_tested_on, restore_test_evidence, restore_instructions, responsible_person)
  values (p1, 'Nightly database backup', 'database', h1, now() - interval '1 day', 'automatic', 'daily', 'Hostinger backups',
          'Hostinger hPanel › Backups › a1 (private)', '30 days', 'encrypted', 'verified', 52428800, 'sha256:demo1234', 'Kiran Demo', t - 1,
          'Downloaded the dump, checksum matched, table row counts compared with production.', true, t - 5,
          'Restored to the review server; logged in and checked the enquiry list.', 'Restore from hPanel › Backups › choose date › Restore database; see the runbook document.', 'Kiran Demo'),
         (p1, 'Weekly files backup', 'files', h1, now() - interval '3 days', 'automatic', 'weekly', 'Demo object storage',
          'demo-storage://a1/backups/files (private)', '90 days', 'encrypted', 'completed', 209715200, null, null, null, null, false, null, null, null, 'Kiran Demo');

  -- ------------------------------------------------------------ P1: source code + deployments
  insert into public.pt_repositories (project_id, git_provider, repo_url, visibility, main_branch, development_branch, deployment_branch,
                                      frontend_hosting_id, backend_hosting_id, production_url, staging_url, status, responsible_person)
  values (p1, 'github', 'https://github.example/a1-demo/corporate-website', 'private', 'main', 'develop', 'release', h2, h1,
          'https://www.a1-demo.example', 'https://review.a1-demo.example', 'active', 'Kiran Demo')
  returning id into repo;
  insert into public.pt_deployments (project_id, repository_id, environment, deployed_at, release_version, commit_ref, status, rollback_ref, deployed_url, responsible_person)
  values (p1, repo, 'production', now() - interval '20 days', 'v1.4.0', 'a1b2c3d', 'succeeded', 'v1.3.2', 'https://www.a1-demo.example', 'Kiran Demo'),
         (p1, repo, 'production', now() - interval '2 days', 'v1.4.1', 'e4f5a6b', 'succeeded', 'v1.4.0', 'https://www.a1-demo.example', 'Kiran Demo');

  -- ------------------------------------------------------------ P1: updates
  insert into public.pt_updates (project_id, update_date, updated_by_name, update_type, description, version, environment, testing_status,
                                 approval_status, deployment_date, evidence_ref, next_action)
  values (p1, t - 20, 'Kiran Demo', 'feature', 'Added product comparison page (demo).', 'v1.4.0', 'production', 'passed', 'approved', t - 20, 'Ticket DEMO-41', null),
         (p1, t - 2, 'Kiran Demo', 'security_update', 'Updated framework and plugins; patched form spam protection (demo).', 'v1.4.1', 'production', 'passed', 'approved', t - 2,
          'Ticket DEMO-57', 'Review analytics consent banner next month.');

  -- ------------------------------------------------------------ P1: documents (2 private files + 1 link)
  path_sow := p1::text || '/' || gen_random_uuid()::text || '/scope-of-work.pdf';
  path_signoff := p1::text || '/' || gen_random_uuid()::text || '/client-signoff.pdf';
  path_sow2 := p1::text || '/' || gen_random_uuid()::text || '/scope-of-work-v2.pdf';
  insert into storage.objects (bucket_id, name, metadata) values
    ('project-tracker-documents', path_sow, '{"mimetype":"application/pdf","size":420}'),
    ('project-tracker-documents', path_signoff, '{"mimetype":"application/pdf","size":420}'),
    ('project-tracker-documents', path_sow2, '{"mimetype":"application/pdf","size":420}');
  insert into public.pt_documents (project_id, name, category, storage_path, file_name, mime_type, size_bytes, version, classification)
  values (p1, 'Scope of Work', 'scope_of_work', path_sow, 'scope-of-work.pdf', 'application/pdf', 420, '1.0', 'internal')
  returning id into doc_sow;
  insert into public.pt_documents (project_id, name, category, storage_path, file_name, mime_type, size_bytes, version, classification)
  values (p1, 'Client sign-off', 'client_approval', path_signoff, 'client-signoff.pdf', 'application/pdf', 420, '1.0', 'confidential')
  returning id into doc_signoff;
  insert into public.pt_documents (project_id, name, category, external_url, version, classification)
  values (p1, 'User guide & training recording', 'user_guide', 'https://drive.example/a1-demo/user-guide', '2.0', 'client_shareable')
  returning id into doc_guide;
  update public.pt_documents set description = 'Signed scope of work for the corporate website (demo).' where id = doc_sow;
  update public.pt_documents set description = 'Client approval of the go-live (demo).' where id = doc_signoff;
  insert into public.pt_documents (project_id, name, category, storage_path, file_name, mime_type, size_bytes, version, classification, description, supersedes_id)
  values (p1, 'Scope of Work', 'scope_of_work', path_sow2, 'scope-of-work-v2.pdf', 'application/pdf', 420, '1.1', 'internal',
          'Adds the product comparison page (change request DEMO-41).', doc_sow)
  returning id into doc_sow2;

  -- ------------------------------------------------------------ P1: AMC + renewals
  insert into public.pt_amc_contracts (project_id, contract_number, service_scope, start_date, end_date, renewal_date, status, maintenance_frequency,
                                       support_terms, responsible_person, client_contact, contract_value, currency, contract_document_id)
  values (p1, 'AMC-A1-2026', 'Monthly updates, backups check, security patches, 6 content changes per quarter (demo).', t - 75, t + 290, t + 260, 'active',
          'monthly', 'Response within 1 business day; critical issues within 4 hours (demo).', 'Kiran Demo', 'Ravi Demo · ravi@a1-demo.example', 60000, 'INR', doc_sow2)
  returning id into amc;
  insert into public.pt_renewals (project_id, item_type, item_label, domain_id, vendor, due_date, amount, currency)
  values (p1, 'domain', 'a1-demo.example registration', d1, 'Demo Registrar', t + 14, 1200, 'INR');
  insert into public.pt_renewals (project_id, item_type, item_label, hosting_id, vendor, due_date, amount, currency)
  values (p1, 'hosting', 'Hostinger VPS yearly plan', h1, 'Hostinger', t + 20, 9600, 'INR');
  insert into public.pt_renewals (project_id, item_type, item_label, vendor, due_date, amount, currency, status, completed_on, completed_by_name, completion_evidence)
  values (p1, 'subscription', 'Form spam-protection plan', 'Demo SaaS', t - 40, 1800, 'INR', 'completed', t - 42, 'Kiran Demo', 'Invoice DEMO-INV-118 paid');

  -- ------------------------------------------------------------ P1: SEO
  insert into public.pt_seo_records (project_id, seo_status, responsible_person, ga_property_ref, ga4_measurement_id, gsc_property, verification_method,
                                     verification_status, sitemap_url, robots_url, audit_date, last_review_date, next_review_date, aeo_status, geo_status)
  values (p1, 'active', 'Kiran Demo', 'properties/000000001 (demo)', 'G-DEMO12345', 'sc-domain:a1-demo.example', 'dns_txt', 'verified',
          'https://www.a1-demo.example/sitemap.xml', 'https://www.a1-demo.example/robots.txt', t - 60, t - 30, t + 60, 'in_progress', 'not_started');

  -- ------------------------------------------------------------ P1: tasks + milestones
  insert into public.pt_milestones (project_id, name, target_date, completed_on, status) values (p1, 'Go-live', t - 75, t - 75, 'completed') returning id into ms1;
  insert into public.pt_milestones (project_id, name, target_date, status) values (p1, 'First AMC quarterly review', t + 15, 'planned') returning id into ms2;
  insert into public.pt_tasks (project_id, title, assigned_to, priority, status, start_date, due_date, completed_on, milestone_id, notes)
  values (p1, 'Final content upload', 'Kiran Demo', 'high', 'done', t - 90, t - 80, t - 78, ms1, null),
         (p1, 'Prepare quarterly SEO report', 'Kiran Demo', 'medium', 'in_progress', t - 5, t + 10, null, ms2, 'Use Search Console export (demo).'),
         (p1, 'Rotate CMS admin credential', 'Kiran Demo', 'high', 'todo', null, t + 30, null, ms2, 'Update the vault reference afterwards.');

  -- ------------------------------------------------------------ P1: handover (completed)
  ho := public.pt_start_handover(p1);
  update public.pt_handovers set recipient_name = 'Ravi Demo', recipient_organisation = 'Company A1', recipient_email = 'ravi@a1-demo.example',
         handover_date = t - 70, approval_document_id = doc_signoff, notes = 'Handover meeting held at client office (demo).' where id = ho;
  foreach k in array array['client_approval', 'production_verified', 'domain_documented', 'hosting_documented', 'admin_access_handed_over',
                           'email_documented', 'repository_documented', 'latest_backup_verified', 'restore_instructions', 'training_completed',
                           'amc_terms_documented', 'recipient_confirmed', 'handover_date_recorded'] loop
    update public.pt_handover_items set state = 'done', evidence_note = 'Confirmed with client during handover meeting (demo).'
     where handover_id = ho and item_key = k;
  end loop;
  update public.pt_handover_items set state = 'done', evidence_document_id = doc_guide where handover_id = ho and item_key = 'user_guide';
  update public.pt_handover_items set state = 'done', evidence_document_id = doc_signoff where handover_id = ho and item_key = 'signed_approval_attached';
  perform public.pt_handover_transition(ho, 'ready_for_review', 'All items evidenced (demo)');
  perform public.pt_handover_transition(ho, 'approved', 'Evidence reviewed (demo)');
  perform public.pt_handover_transition(ho, 'handed_over', 'Credentials transferred in person; client confirmed by email (demo).');

  -- ------------------------------------------------------------ P1: remarks
  insert into public.pt_remarks (project_id, body) values (p1, 'Client prefers WhatsApp for urgent issues (demo note).');

  perform pt_harness.act_as_owner();
  -- bytes for the two private files are written by start.mjs
  insert into pt_harness.fixture_files (bucket_id, name, content) values
    ('project-tracker-documents', path_sow, 'pdf'), ('project-tracker-documents', path_signoff, 'pdf'), ('project-tracker-documents', path_sow2, 'pdf');
end $$;

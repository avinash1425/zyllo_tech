-- Employee Master + Org Structure (113): master data permissions, org-unit
-- cycles, new work-record fields + history, PII / identity / remarks /
-- payroll-identifier isolation, uniqueness, audit redaction, identity
-- expiry + country compliance + reminders.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
-- Rows affected by an UPDATE ... RETURNING (proves RLS blocks the write).
create function pg_temp.count_dml(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  execute 'with s as (' || p_sql || ') select count(*) from s' into v;
  return v;
end $$;

do $$
begin
  insert into t_ids values ('hr',   test.make_employee('em.hr@test.local', 'Hema', null, array['hr_admin']));
  insert into t_ids values ('pay',  test.make_employee('em.pay@test.local', 'Pavan', null, array['payroll_admin']));
  insert into t_ids values ('mgr',  test.make_employee('em.mgr@test.local', 'Meru', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('em.emp1@test.local', 'Asha', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('em.emp2@test.local', 'Bodhi', null));
end $$;

select test.ok(exists (select 1 from public.hr_permissions where key = 'employees.view_identity'), 'identity permission exists');
select test.ok(exists (select 1 from public.hr_identity_requirements where country = 'AE' and passport_required), 'country identity rules seeded');

-- ---- master data: legal entities, grades
select pg_temp.as_k('hr');
do $$ begin
  with x as (insert into public.hr_legal_entities (code, name, country) values ('ZT-IN', 'Zyllo Tech India', 'IN') returning id) insert into t_ids select 'le_in', id from x;
end $$;
select test.throws($q$insert into public.hr_legal_entities (code, name) values ('bad code', 'X Corp')$q$, 'legal entity code format enforced', 'check constraint');
select test.throws($q$insert into public.hr_legal_entities (code, name, country) values ('ZT-X', 'Bad Country', 'India')$q$, 'country must be ISO-2', 'check constraint');
insert into public.hr_grades (code, name, level) values ('G3', 'Grade 3', 3);
select pg_temp.as_k('emp1');
select test.throws($q$insert into public.hr_legal_entities (code, name) values ('ZT-AE', 'Zyllo Tech UAE')$q$, 'employee cannot create legal entities', 'row-level security');
select test.throws($q$insert into public.hr_grades (code, name) values ('G9', 'Grade 9')$q$, 'employee cannot create grades', 'row-level security');
select test.eq(test.count_rows('select 1 from public.hr_legal_entities'), 1::bigint, 'employees can read legal entities (names in their profile)');
select test.as_owner();
do $$ begin
  with x as (insert into public.hr_legal_entities (code, name, country) values ('ZT-AE', 'Zyllo Tech UAE', 'AE') returning id) insert into t_ids select 'le_ae', id from x;
end $$;

-- ---- org units: hierarchy cycles rejected
do $$ begin
  with x as (insert into public.hr_departments (code, name, unit_type) values ('DIV-A', 'Division A', 'division') returning id) insert into t_ids select 'd_a', id from x;
  with x as (insert into public.hr_departments (code, name, parent_id, legal_entity_id) values ('DEP-B', 'Department B', (select v from t_ids where k='d_a'), (select v from t_ids where k='le_in')) returning id) insert into t_ids select 'd_b', id from x;
  with x as (insert into public.hr_departments (code, name, parent_id, unit_type) values ('TEAM-C', 'Team C', (select v from t_ids where k='d_b'), 'team') returning id) insert into t_ids select 'd_c', id from x;
end $$;
select pg_temp.as_k('hr');
select test.throws($q$update public.hr_departments set parent_id = pg_temp.id('d_c') where id = pg_temp.id('d_a')$q$, 'circular org hierarchy rejected', 'circular');
select test.throws($q$update public.hr_departments set parent_id = id where id = pg_temp.id('d_b')$q$, 'department cannot be its own parent', 'own parent');
select test.throws($q$update public.hr_departments set unit_type = 'squad' where id = pg_temp.id('d_b')$q$, 'unit type validated', 'check constraint');
-- Reporting cycles (existing rule) still enforced.
select test.throws($q$update public.hr_employees set manager_id = pg_temp.id('emp1') where id = pg_temp.id('mgr')$q$, 'circular reporting rejected', 'reporting cycle');

-- ---- work record fields + history
update public.hr_employees set legal_entity_id = pg_temp.id('le_in'), grade_id = (select id from public.hr_grades where code = 'G3'),
  work_arrangement = 'hybrid', contract_type = 'permanent', notice_period_days = 30, name_arabic = 'آشا',
  source_department_id = pg_temp.id('d_b'), department_id = pg_temp.id('d_c')
where id = pg_temp.id('emp1');
select test.ok((select legal_entity_id = pg_temp.id('le_in') and work_arrangement = 'hybrid' and notice_period_days = 30 from public.hr_employees where id = pg_temp.id('emp1')),
  'HR saves company, grade, arrangement, contract and notice fields');
select test.ok(exists (select 1 from public.hr_employee_history where employee_id = pg_temp.id('emp1') and change_type = 'legal_entity' and new_value = 'Zyllo Tech India'), 'company change recorded in history');
select test.ok(exists (select 1 from public.hr_employee_history where employee_id = pg_temp.id('emp1') and change_type = 'grade' and new_value = 'Grade 3'), 'grade change recorded in history');
select test.ok(exists (select 1 from public.hr_employee_history where employee_id = pg_temp.id('emp1') and change_type = 'contract'), 'contract change recorded in history');
select test.throws($q$update public.hr_employees set work_arrangement = 'beach' where id = pg_temp.id('emp1')$q$, 'work arrangement validated', 'check constraint');
select test.throws($q$update public.hr_employees set notice_period_days = 400 where id = pg_temp.id('emp1')$q$, 'notice period bounded', 'check constraint');
select test.throws($q$update public.hr_employees set deployment_status = 'deployed' where id = pg_temp.id('emp1')$q$, 'deployment needs a client', 'deployment_client');
select test.throws($q$update public.hr_employees set deployment_start_date = '2026-05-01', deployment_end_date = '2026-04-01' where id = pg_temp.id('emp1')$q$, 'deployment dates ordered', 'deployment_dates');
update public.hr_employees set deployment_status = 'deployed', deployment_client = 'Synthetic Client', deployment_project_code = 'JOB-001',
  deployment_start_date = current_date - 10 where id = pg_temp.id('emp1');
select test.ok(exists (select 1 from public.hr_employee_history where employee_id = pg_temp.id('emp1') and change_type = 'deployment' and new_value like 'deployed%'), 'deployment recorded in history');
-- Ordinary employees need no deployment data.
select test.ok((select deployment_status is null from public.hr_employees where id = pg_temp.id('emp2')), 'deployment block optional for ordinary staff');
select pg_temp.as_k('emp1');
select test.ok((select work_arrangement = 'hybrid' and grade_id is not null from public.hr_employees where id = pg_temp.id('emp1')), 'employee sees own work record fields');
select test.eq(pg_temp.count_dml($q$update public.hr_employees set grade_id = null where id = pg_temp.id('emp1') returning 1$q$), 0::bigint, 'employee cannot edit own work record');

-- ---- personal: nationality + marital status
select pg_temp.as_k('hr');
insert into public.hr_employee_private (employee_id, nationality, marital_status, gender) values (pg_temp.id('emp1'), 'IN', 'single', 'female');
select test.throws($q$update public.hr_employee_private set nationality = 'India' where employee_id = pg_temp.id('emp1')$q$, 'nationality must be ISO-2', 'check constraint');
select test.throws($q$update public.hr_employee_private set marital_status = 'complicated' where employee_id = pg_temp.id('emp1')$q$, 'marital status validated', 'check constraint');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_employee_private where employee_id = pg_temp.id(''emp1'')'), 0::bigint, 'manager cannot read team PII');

-- ---- identity documents
select pg_temp.as_k('hr');
insert into public.hr_employee_identity (employee_id, national_id_type, national_id_number, passport_number, passport_country, passport_issue_date, passport_expiry, visa_number, visa_expiry)
values (pg_temp.id('emp1'), 'PAN', 'ABCDE 1234F', 'p1234567', 'IN', current_date - 3000, current_date + 20, 'V-77881', current_date + 400);
select test.eq((select passport_number from public.hr_employee_identity where employee_id = pg_temp.id('emp1')), 'P1234567', 'passport number normalised to upper case');
select test.throws($q$insert into public.hr_employee_identity (employee_id, passport_number) values (pg_temp.id('emp2'), 'P1234567')$q$, 'passport number unique', 'duplicate key');
select test.throws($q$insert into public.hr_employee_identity (employee_id, national_id_type, national_id_number) values (pg_temp.id('emp2'), 'pan', 'ABCDE-1234F')$q$, 'national ID unique ignoring case, spaces and dashes', 'duplicate key');
select test.throws($q$insert into public.hr_employee_identity (employee_id, national_id_number) values (pg_temp.id('emp2'), 'XYZ12345')$q$, 'national ID needs a type', 'check constraint');
select test.throws($q$insert into public.hr_employee_identity (employee_id, passport_number, passport_issue_date, passport_expiry) values (pg_temp.id('emp2'), 'Z9988776', '2026-01-01', '2025-01-01')$q$, 'passport expiry after issue', 'check constraint');
select test.eq((select new_data ->> 'passport_number' from public.hr_audit_log where table_name = 'hr_employee_identity' and record_id = pg_temp.id('emp1')::text order by id desc limit 1),
  '[redacted]', 'identity numbers redacted in the audit log');
select test.ok((select count(*) = 1 from public.hr_expiring_identity_documents(60) where employee_id = pg_temp.id('emp1') and document = 'Passport' and number_last4 = '4567'),
  'expiring passport listed with last four digits only');

select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_employee_identity'), 1::bigint, 'employee reads own identity record');
select test.eq(pg_temp.count_dml($q$update public.hr_employee_identity set passport_number = 'Q1111111' returning 1$q$), 0::bigint, 'employee cannot change identity numbers');
select test.ok((select public.hr_employee_identity_status(pg_temp.id('emp1')) ->> 'country') = 'IN', 'employee sees own identity compliance');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_employee_identity'), 0::bigint, 'colleague cannot read identity');
select test.eq(test.count_rows('select 1 from public.hr_expiring_identity_documents(365)'), 0::bigint, 'colleague sees no expiring identity items');
select test.throws($q$select public.hr_employee_identity_status(pg_temp.id('emp1'))$q$, 'colleague cannot read identity compliance', 'not allowed');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_employee_identity'), 0::bigint, 'manager cannot read team identity');
select pg_temp.as_k('pay');
select test.eq(test.count_rows('select 1 from public.hr_employee_identity'), 0::bigint, 'payroll admin cannot read identity');

-- ---- country compliance: UAE entity, foreign national without permit
select pg_temp.as_k('hr');
update public.hr_employees set legal_entity_id = pg_temp.id('le_ae') where id = pg_temp.id('emp2');
insert into public.hr_employee_private (employee_id, nationality) values (pg_temp.id('emp2'), 'IN');
select test.ok((select hr_private.identity_missing(pg_temp.id('emp2')) @> array['National ID','Passport','Work permit','Visa']), 'UAE rules flag missing Emirates ID, passport, permit and visa');
select test.eq(cardinality(hr_private.identity_missing(pg_temp.id('emp1'))), 0, 'Indian national at Indian entity has nothing missing');

-- ---- reminders
select test.as_owner();
select test.as_service();
select test.eq(public.hr_generate_identity_expiry_reminders(), 1, 'one identity reminder generated (passport in 20 days)');
select test.eq(public.hr_generate_identity_expiry_reminders(), 0, 'reminders are not repeated');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp1')) and type = 'identity_expiry'), 'employee notified of expiry');
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('hr')) and type = 'identity_expiry' and body not like '%P1234567%'),
  'HR notified without the document number');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_generate_identity_expiry_reminders()$q$, 'employee cannot run the reminder job', 'not allowed');

-- ---- HR-only remarks
select pg_temp.as_k('hr');
insert into public.hr_employee_confidential (employee_id, remarks) values (pg_temp.id('emp1'), 'Synthetic HR remark');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_employee_confidential'), 0::bigint, 'employee cannot read HR remarks about themselves');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_employee_confidential'), 0::bigint, 'manager cannot read HR remarks');

-- ---- banking & payroll identifiers: payroll only
select pg_temp.as_k('hr');
select test.throws($q$insert into public.hr_payroll_employee_identifiers (employee_id, tax_id) values (pg_temp.id('emp1'), 'ABCDE1234F')$q$, 'HR admin cannot write payroll identifiers', 'row-level security');
select test.throws($q$insert into public.hr_employee_bank_accounts (employee_id, bank_name, account_holder, account_number) values (pg_temp.id('emp1'), 'Demo Bank', 'Asha Test', '000123456789')$q$, 'HR admin cannot write bank accounts', 'row-level security');
select pg_temp.as_k('pay');
insert into public.hr_payroll_employee_identifiers (employee_id, tax_id, social_security_number, payment_mode) values (pg_temp.id('emp1'), 'ABCDE1234F', 'UAN-100200', 'bank_transfer');
insert into public.hr_employee_bank_accounts (employee_id, bank_name, account_holder, account_number, iban, swift_code) values (pg_temp.id('emp1'), 'Demo Bank', 'Asha Test', 'AE070331234567890123456', 'AE070331234567890123456', 'DEMOAEAD');
select test.throws($q$insert into public.hr_payroll_employee_identifiers (employee_id, tax_id) values (pg_temp.id('emp2'), 'abcde1234f')$q$, 'tax ID unique', 'duplicate key');
select test.throws($q$update public.hr_employee_bank_accounts set iban = 'NOT-AN-IBAN' where employee_id = pg_temp.id('emp1')$q$, 'IBAN format validated', 'check constraint');
select test.eq(test.count_rows('select 1 from public.hr_payroll_employee_identifiers'), 1::bigint, 'payroll admin reads payroll identifiers');
select pg_temp.as_k('hr');
select test.eq(test.count_rows('select 1 from public.hr_payroll_employee_identifiers'), 0::bigint, 'HR admin cannot read payroll identifiers');
select test.eq(test.count_rows($q$select 1 from public.hr_audit_log where table_name = 'hr_payroll_employee_identifiers'$q$), 0::bigint, 'payroll identifier audit rows hidden from HR admin');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_payroll_employee_identifiers'), 0::bigint, 'employee cannot read raw payroll identifiers');
select test.as_owner();
select test.ok((select new_data ->> 'tax_id' = '[redacted]' and new_data ->> 'social_security_number' = '[redacted]'
                from public.hr_audit_log where table_name = 'hr_payroll_employee_identifiers' order by id desc limit 1), 'payroll identifiers redacted in audit');
select test.ok((select new_data ->> 'iban' = '[redacted]' and new_data ->> 'account_number' = '[redacted]'
                from public.hr_audit_log where table_name = 'hr_employee_bank_accounts' order by id desc limit 1), 'IBAN and account number redacted in audit');

-- ---- anon
select test.as_anon();
select test.throws($q$select 1 from public.hr_employee_identity$q$, 'anon cannot read identity', 'permission denied');
select test.throws($q$select 1 from public.hr_legal_entities$q$, 'anon cannot read legal entities', 'permission denied');

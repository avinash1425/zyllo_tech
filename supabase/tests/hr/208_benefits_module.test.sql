-- Benefits module (208): categories, plan rules, eligibility (grade / location /
-- probation), self-enrollment requests, enrollment changes + dependants,
-- claims with documents (storage policies), annual limit, privacy (RLS),
-- separation of duties, external payment record, no payroll side effects,
-- append-only history, audit redaction.
-- Runs inside a transaction that the runner rolls back. Self-contained: works
-- with or without the synthetic seed.

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
create function pg_temp.today() returns date language sql as $$ select hr_private.business_today() $$;

do $$
declare g1 uuid; g2 uuid; l1 uuid; l2 uuid;
begin
  insert into t_ids values ('hr',   test.make_employee('b8.hr@test.local', 'Hema', null, array['hr_admin','employee']));
  insert into t_ids values ('hr2',  test.make_employee('b8.hr2@test.local', 'Hans', null, array['hr_admin','employee']));
  insert into t_ids values ('pay',  test.make_employee('b8.pay@test.local', 'Pavan', null, array['payroll_admin','employee']));
  insert into t_ids values ('mgr',  test.make_employee('b8.mgr@test.local', 'Meru', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('b8.emp1@test.local', 'Asha', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('b8.emp2@test.local', 'Bodhi', null));
  insert into t_ids values ('prob', test.make_employee('b8.prob@test.local', 'Priya', null));
  insert into public.hr_grades (code, name, level) values ('B8G1', 'B8 Grade One', 41) returning id into g1;
  insert into public.hr_grades (code, name, level) values ('B8G2', 'B8 Grade Two', 42) returning id into g2;
  insert into public.hr_locations (name) values ('B8 Location One') returning id into l1;
  insert into public.hr_locations (name) values ('B8 Location Two') returning id into l2;
  insert into t_ids values ('g1', g1), ('g2', g2), ('l1', l1), ('l2', l2);
end $$;
update public.hr_employees set grade_id = pg_temp.id('g1'), work_location_id = pg_temp.id('l1') where id in (pg_temp.id('emp1'), pg_temp.id('hr'), pg_temp.id('prob'));
update public.hr_employees set grade_id = pg_temp.id('g2'), work_location_id = pg_temp.id('l2') where id = pg_temp.id('emp2');
update public.hr_employees set status = 'probation', probation_end_date = current_date + 60 where id = pg_temp.id('prob');

-- ------------------------------------------------------------ categories
select test.ok((select count(*) from public.hr_benefit_categories where code in ('health_insurance','wellness','learning','meal')) = 4, 'default categories seeded');
select pg_temp.as_k('hr');
insert into public.hr_benefit_categories (code, name, claimable_default) values ('b8_mobility', 'B8 Mobility', true);
select test.eq(test.count_rows($q$select 1 from public.hr_benefit_categories where code = 'b8_mobility'$q$), 1::bigint, 'HR (benefits.manage) creates a category');
select test.throws($q$delete from public.hr_benefit_categories where code = 'b8_mobility'$q$, 'categories cannot be deleted', 'permission denied');
select pg_temp.as_k('emp1');
select test.throws($q$insert into public.hr_benefit_categories (code, name) values ('b8_x', 'B8 X')$q$, 'employee cannot create categories', 'row-level security');
select test.ok(test.count_rows('select 1 from public.hr_benefit_categories') >= 10, 'employees can read categories');

-- ------------------------------------------------------------ plans
select pg_temp.as_k('hr');
with x as (insert into public.hr_benefit_types (code, name, category, claimable, annual_limit, self_enrollment, claim_requires_document, plan_year_start_month, coverage_amount, employer_contribution_note)
           values ('B8LRN', 'B8 Learning allowance', 'learning', true, 10000, true, true, 4, null, 'Company pays approved claims') returning id)
insert into t_ids select 'learn', id from x;
with x as (insert into public.hr_benefit_types (code, name, category, eligible_grade_ids, eligible_location_ids)
           values ('B8MEAL', 'B8 Meal card', 'meal', array[pg_temp.id('g1')], array[pg_temp.id('l1')]) returning id)
insert into t_ids select 'meal', id from x;
with x as (insert into public.hr_benefit_types (code, name, category, allow_during_probation, allows_dependants, coverage_amount)
           values ('B8MED', 'B8 Health insurance', 'health_insurance', false, true, 500000) returning id)
insert into t_ids select 'med', id from x;
with x as (insert into public.hr_benefit_types (code, name, category, claimable, annual_limit, claim_requires_document)
           values ('B8WELL', 'B8 Wellness', 'wellness', true, 3000, false) returning id)
insert into t_ids select 'well', id from x;
select test.throws($q$insert into public.hr_benefit_types (code, name, category) values ('B8BAD', 'B8 Bad', 'crypto')$q$, 'unknown category rejected', 'check constraint');
update public.hr_benefit_types set eligible_employment_types = '{}' where id = pg_temp.id('meal');
select test.ok((select eligible_employment_types is null from public.hr_benefit_types where id = pg_temp.id('meal')), 'empty eligibility list means everyone');

-- ------------------------------------------------------------ eligibility
select test.ok((select eligible from public.hr_benefit_eligibility(pg_temp.id('emp1')) where code = 'B8MEAL'), 'grade + location match: eligible');
select test.ok((select not eligible and reason like '%grade%' from public.hr_benefit_eligibility(pg_temp.id('emp2')) where code = 'B8MEAL'), 'other grade: not eligible');
update public.hr_benefit_types set eligible_grade_ids = null where id = pg_temp.id('meal');
select test.ok((select not eligible and reason like '%location%' from public.hr_benefit_eligibility(pg_temp.id('emp2')) where code = 'B8MEAL'), 'other location: not eligible');
select test.ok((select not eligible and reason like '%probation%' from public.hr_benefit_eligibility(pg_temp.id('prob')) where code = 'B8MED'), 'probation excluded when the plan disallows it');
select test.ok((select eligible from public.hr_benefit_eligibility(pg_temp.id('prob')) where code = 'B8LRN'), 'probation allowed by default');
select test.throws($q$select public.hr_enroll_benefit(pg_temp.id('prob'), pg_temp.id('med'), pg_temp.today())$q$, 'probationer cannot be enrolled without override', 'override reason');

-- ------------------------------------------------------------ enrollment requests
select pg_temp.as_k('emp1');
do $$ begin insert into t_ids values ('req1', public.hr_request_benefit_enrollment(pg_temp.id('learn'), pg_temp.today(), 'employee', 0, 'For my AWS certification')); end $$;
select test.throws($q$select public.hr_request_benefit_enrollment(pg_temp.id('learn'))$q$, 'duplicate pending request refused', 'pending request');
select test.throws($q$select public.hr_request_benefit_enrollment(pg_temp.id('med'))$q$, 'plan without self-enrollment refused', 'contact HR');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_benefit_enrollment_requests'), 0::bigint, 'colleague cannot see the request');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_benefit_enrollment_requests'), 0::bigint, 'manager cannot see a report''s benefit request');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_decide_benefit_enrollment_request(pg_temp.id('req1'), true)$q$, 'employee cannot decide requests', 'not allowed');
-- HR's own request: HR cannot approve it.
select pg_temp.as_k('hr');
do $$ begin insert into t_ids values ('req_hr', public.hr_request_benefit_enrollment(pg_temp.id('learn'))); end $$;
select test.throws($q$select public.hr_decide_benefit_enrollment_request(pg_temp.id('req_hr'), true)$q$, 'HR cannot approve their own enrollment request', 'your own request');
select test.throws($q$select public.hr_decide_benefit_enrollment_request(pg_temp.id('req1'), false)$q$, 'rejection needs a reason', 'reason');
do $$ begin insert into t_ids values ('enr1', public.hr_decide_benefit_enrollment_request(pg_temp.id('req1'), true, 'Approved')); end $$;
select test.ok((select status = 'approved' and enrollment_id = pg_temp.id('enr1') from public.hr_benefit_enrollment_requests where id = pg_temp.id('req1')), 'approved request linked to the new enrollment');
select pg_temp.as_k('hr2');
do $$ begin insert into t_ids values ('enr_hr', public.hr_decide_benefit_enrollment_request(pg_temp.id('req_hr'), true)); end $$;
select test.ok(pg_temp.id('enr_hr') is not null, 'another HR user approves HR''s request');
select public.hr_enroll_benefit(pg_temp.id('emp1'), pg_temp.id('well'), pg_temp.today());
select public.hr_enroll_benefit(pg_temp.id('emp2'), pg_temp.id('learn'), pg_temp.today());

-- ------------------------------------------------------------ enrollment changes + dependants
do $$ begin insert into t_ids values ('enr_med', public.hr_enroll_benefit(pg_temp.id('emp2'), pg_temp.id('med'), pg_temp.today())); end $$;
select test.throws($q$select public.hr_update_benefit_enrollment(pg_temp.id('enr_med'), 'family')$q$, 'change needs a reason', 'reason');
select public.hr_update_benefit_enrollment(pg_temp.id('enr_med'), 'family', null, 'POL-77', null, 2000, 500, 'Married; family cover');
select test.ok((select coverage_level = 'family' and policy_number = 'POL-77' and employer_contribution = 2000 from public.hr_benefit_enrollments where id = pg_temp.id('enr_med')), 'enrollment changed');
select test.ok(exists (select 1 from public.hr_benefit_events where enrollment_id = pg_temp.id('enr_med') and action = 'enrollment_changed' and note like 'Married%'), 'change recorded in benefit history with the reason');
do $$ begin insert into t_ids values ('dep1', public.hr_add_benefit_dependant(pg_temp.id('enr_med'), 'Spouse Test', 'spouse', '1990-01-01')); end $$;
select test.eq((select dependants::int from public.hr_benefit_enrollments where id = pg_temp.id('enr_med')), 1, 'dependant count follows named dependants');
select test.throws($q$select public.hr_add_benefit_dependant(pg_temp.id('enr1'), 'Kid', 'child')$q$, 'plan without dependants refuses them', 'does not cover dependants');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_update_benefit_enrollment(pg_temp.id('enr_hr'), 'family', null, null, null, null, null, 'x')$q$, 'HR cannot change their own enrollment', 'own enrollment');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_benefit_dependants'), 0::bigint, 'colleague cannot see another employee''s dependants');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_benefit_dependants'), 1::bigint, 'employee sees own dependants');

-- ------------------------------------------------------------ claims: draft, documents, storage
select pg_temp.as_k('emp1');
do $$ begin insert into t_ids values ('c1', public.hr_save_benefit_claim(null, pg_temp.id('enr1'), pg_temp.today(), 6000, 'AWS certification exam fee')); end $$;
select test.throws($q$select public.hr_save_benefit_claim(null, pg_temp.id('enr_med'), pg_temp.today(), 10, 'Not mine')$q$, 'cannot claim against a colleague''s enrollment', 'your benefit enrollments');
select test.throws($q$select public.hr_save_benefit_claim(null, pg_temp.id('enr1'), pg_temp.today() + 3, 10, 'Future')$q$, 'future expense refused', 'future');
select test.throws($q$select public.hr_save_benefit_claim(null, pg_temp.id('enr1'), pg_temp.today(), 0, 'Zero')$q$, 'zero amount refused', 'greater than zero');
select test.throws($q$select public.hr_submit_benefit_claim(pg_temp.id('c1'))$q$, 'document required before submitting', 'supporting document');
do $$ declare r jsonb; begin
  r := public.hr_register_benefit_claim_document(pg_temp.id('c1'), 'exam-receipt.pdf', 'application/pdf', 12345, repeat('a', 64));
  insert into t_txt values ('p1', r ->> 'storage_path'); insert into t_ids values ('d1', (r ->> 'document_id')::uuid);
end $$;
select test.throws($q$select public.hr_register_benefit_claim_document(pg_temp.id('c1'), 'virus.exe', 'application/x-msdownload', 100)$q$, 'only PDF / images accepted', null);
select test.throws($q$select public.hr_submit_benefit_claim(pg_temp.id('c1'))$q$, 'submit refused until the file is uploaded', 'did not finish uploading');
select pg_temp.as_k('emp2');
select test.throws($q$insert into storage.objects (bucket_id, name, owner) values ('hr-benefit-claims', pg_temp.txt('p1'), auth.uid())$q$, 'colleague cannot upload into someone else''s registered path', 'row-level security');
select test.throws($q$select public.hr_register_benefit_claim_document(pg_temp.id('c1'), 'x.pdf', 'application/pdf', 100)$q$, 'colleague cannot attach to the claim', 'not found');
select pg_temp.as_k('emp1');
insert into storage.objects (bucket_id, name, owner) values ('hr-benefit-claims', pg_temp.txt('p1'), auth.uid());
select test.throws($q$insert into storage.objects (bucket_id, name, owner) values ('hr-benefit-claims', 'b8-unregistered/x.pdf', auth.uid())$q$, 'unregistered path refused', 'row-level security');
-- A draft is private to the claimant.
select pg_temp.as_k('hr');
select test.eq(test.count_rows($q$select 1 from public.hr_benefit_claims where id = pg_temp.id('c1')$q$), 0::bigint, 'HR does not see a draft claim');
select pg_temp.as_k('emp1');
select public.hr_submit_benefit_claim(pg_temp.id('c1'));
select test.eq((select status from public.hr_benefit_claims where id = pg_temp.id('c1')), 'submitted', 'claim submitted');
select test.throws($q$select public.hr_remove_benefit_claim_document(pg_temp.id('d1'))$q$, 'documents locked after submit', 'once the claim is submitted');
select test.throws($q$update public.hr_benefit_claims set amount = 1 where id = pg_temp.id('c1')$q$, 'no direct claim updates', 'permission denied');
select test.throws($q$insert into public.hr_benefit_claims (employee_id, enrollment_id, benefit_type_id, expense_date, plan_year_start, amount, description) values (pg_temp.id('emp1'), pg_temp.id('enr1'), pg_temp.id('learn'), current_date, current_date, 1, 'xxx')$q$, 'no direct claim inserts', 'permission denied');

-- ------------------------------------------------------------ annual limit on submission
do $$ begin insert into t_ids values ('c2', public.hr_save_benefit_claim(null, pg_temp.id('enr1'), pg_temp.today(), 5000, 'Udemy courses')); end $$;
do $$ declare r jsonb; begin
  r := public.hr_register_benefit_claim_document(pg_temp.id('c2'), 'udemy.png', 'image/png', 2000, repeat('b', 64));
  insert into t_txt values ('p2', r ->> 'storage_path');
end $$;
insert into storage.objects (bucket_id, name, owner) values ('hr-benefit-claims', pg_temp.txt('p2'), auth.uid());
select test.throws($q$select public.hr_submit_benefit_claim(pg_temp.id('c2'))$q$, '6000 pending + 5000 exceeds the 10000 limit', 'remaining annual limit');
select public.hr_save_benefit_claim(pg_temp.id('c2'), pg_temp.id('enr1'), pg_temp.today(), 4000, 'Udemy courses');
select public.hr_submit_benefit_claim(pg_temp.id('c2'));
select test.ok((select available = 0 and pending = 10000 from public.hr_benefit_balances() where enrollment_id = pg_temp.id('enr1')), 'balance: nothing available while 10000 is pending');
-- Duplicate document (same checksum) on another claim is refused.
do $$ begin insert into t_ids values ('c_dup', public.hr_save_benefit_claim(null, pg_temp.id('enr1'), pg_temp.today(), 1, 'Duplicate')); end $$;
do $$ declare r jsonb; begin
  r := public.hr_register_benefit_claim_document(pg_temp.id('c_dup'), 'same.pdf', 'application/pdf', 12345, repeat('a', 64));
  insert into t_txt values ('pdup', r ->> 'storage_path');
end $$;
insert into storage.objects (bucket_id, name, owner) values ('hr-benefit-claims', pg_temp.txt('pdup'), auth.uid());
select test.throws($q$select public.hr_submit_benefit_claim(pg_temp.id('c_dup'))$q$, 'document reused from another claim refused', 'already used');
select public.hr_cancel_benefit_claim(pg_temp.id('c_dup'), 'Mistake');

-- ------------------------------------------------------------ privacy
select pg_temp.as_k('emp2');
select test.eq(test.count_rows($q$select 1 from public.hr_benefit_claims where employee_id = pg_temp.id('emp1')$q$), 0::bigint, 'colleague cannot see claims');
select test.eq(test.count_rows($q$select 1 from public.hr_benefit_claim_documents where claim_id = pg_temp.id('c1')$q$), 0::bigint, 'colleague cannot see claim documents');
select test.eq(test.count_rows($q$select 1 from storage.objects where name = pg_temp.txt('p1')$q$), 0::bigint, 'colleague cannot download the claim document');
select test.eq(test.count_rows($q$select 1 from public.hr_benefit_events where employee_id = pg_temp.id('emp1')$q$), 0::bigint, 'colleague cannot see benefit history');
select test.throws($q$select * from public.hr_benefit_balances(pg_temp.id('emp1'))$q$, 'colleague cannot read balances', 'not allowed');
select test.throws($q$select public.hr_benefits_overview()$q$, 'employee cannot read the overview', 'benefits access');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows($q$select 1 from public.hr_benefit_claims$q$), 0::bigint, 'manager cannot see a report''s claims');
select test.eq(test.count_rows($q$select 1 from storage.objects where bucket_id = 'hr-benefit-claims'$q$), 0::bigint, 'manager cannot download claim documents');
select pg_temp.as_k('pay');
select test.eq(test.count_rows($q$select 1 from public.hr_benefit_claims where employee_id = pg_temp.id('emp1') and status <> 'draft'$q$), 3::bigint, 'benefits.view sees submitted claims');
select test.eq(test.count_rows($q$select 1 from storage.objects where name = pg_temp.txt('p1')$q$), 1::bigint, 'benefits.view can open the document');
select test.throws($q$select public.hr_decide_benefit_claim(pg_temp.id('c1'), 'approve')$q$, 'benefits.view cannot decide claims', 'not allowed');
select test.ok((public.hr_benefits_overview() -> 'kpis' ->> 'pending_claims')::int >= 2, 'overview counts pending claims');

-- ------------------------------------------------------------ separation of duties
select pg_temp.as_k('hr');
do $$ begin insert into t_ids values ('c_hr', public.hr_save_benefit_claim(null, pg_temp.id('enr_hr'), pg_temp.today(), 100, 'HR''s own book')); end $$;
do $$ declare r jsonb; begin
  r := public.hr_register_benefit_claim_document(pg_temp.id('c_hr'), 'book.pdf', 'application/pdf', 300, repeat('c', 64));
  insert into t_txt values ('phr', r ->> 'storage_path');
end $$;
insert into storage.objects (bucket_id, name, owner) values ('hr-benefit-claims', pg_temp.txt('phr'), auth.uid());
select public.hr_submit_benefit_claim(pg_temp.id('c_hr'));
select test.throws($q$select public.hr_decide_benefit_claim(pg_temp.id('c_hr'), 'approve')$q$, 'claimant cannot approve own claim', 'your own claim');
select test.throws($q$select public.hr_decide_benefit_claim(pg_temp.id('c_hr'), 'reject', 'no')$q$, 'claimant cannot reject own claim', 'your own claim');
select pg_temp.as_k('hr2');
select public.hr_decide_benefit_claim(pg_temp.id('c_hr'), 'approve');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_record_benefit_claim_payment(pg_temp.id('c_hr'), 'NEFT-1', hr_private.business_today())$q$, 'claimant cannot record payment of own claim', 'own claim');

-- ------------------------------------------------------------ decisions + limit on approval
select test.throws($q$select public.hr_decide_benefit_claim(pg_temp.id('c1'), 'approve', null, 5500)$q$, 'partial approval needs a note', 'Explain');
select test.throws($q$select public.hr_decide_benefit_claim(pg_temp.id('c1'), 'approve', null, 7000)$q$, 'cannot approve more than claimed', 'at most the claimed amount');
select public.hr_decide_benefit_claim(pg_temp.id('c1'), 'approve', 'Exam fee capped at policy amount', 5500);
select test.throws($q$select public.hr_decide_benefit_claim(pg_temp.id('c2'), 'return')$q$, 'return needs a note', 'what to change');
select public.hr_decide_benefit_claim(pg_temp.id('c2'), 'return', 'Attach the invoice, not the cart');
select pg_temp.as_k('emp1');
select test.eq((select status from public.hr_benefit_claims where id = pg_temp.id('c2')), 'returned', 'employee sees the returned claim');
select public.hr_submit_benefit_claim(pg_temp.id('c2'), 'Invoice attached');
do $$ begin insert into t_ids values ('c3', public.hr_save_benefit_claim(null, pg_temp.id('enr1'), pg_temp.today(), 600, 'Book')); end $$;
do $$ declare r jsonb; begin
  r := public.hr_register_benefit_claim_document(pg_temp.id('c3'), 'book.pdf', 'application/pdf', 300, repeat('d', 64));
  insert into t_txt values ('p3', r ->> 'storage_path');
end $$;
insert into storage.objects (bucket_id, name, owner) values ('hr-benefit-claims', pg_temp.txt('p3'), auth.uid());
select test.throws($q$select public.hr_submit_benefit_claim(pg_temp.id('c3'))$q$, '5500 used + 4000 pending + 600 exceeds the limit', 'remaining annual limit');
select public.hr_save_benefit_claim(pg_temp.id('c3'), pg_temp.id('enr1'), pg_temp.today(), 500, 'Book');
select public.hr_submit_benefit_claim(pg_temp.id('c3'));
select pg_temp.as_k('hr');
select public.hr_decide_benefit_claim(pg_temp.id('c2'), 'approve');
select public.hr_decide_benefit_claim(pg_temp.id('c3'), 'approve');
select test.ok((select used = 10000 and remaining = 0 and available = 0 from public.hr_benefit_balances(pg_temp.id('emp1')) where enrollment_id = pg_temp.id('enr1')), 'limit fully used: 5500 + 4000 + 500');
select test.throws($q$select public.hr_decide_benefit_claim(pg_temp.id('c1'), 'reject', 'x')$q$, 'decided claim cannot be decided again', 'Only submitted');

-- ------------------------------------------------------------ external payment, no payroll effect
create temp table t_counts as
  select (select count(*) from public.hr_reimbursements) reimb,
         (select count(*) from public.hr_payroll_runs) runs,
         (select coalesce(sum(n_tup_ins + n_tup_upd), 0) from pg_stat_xact_user_tables where relname like 'hr_payroll%') payroll_writes;
grant select on t_counts to authenticated;
select test.throws($q$select public.hr_record_benefit_claim_payment(pg_temp.id('c1'), '', hr_private.business_today())$q$, 'payment needs a reference', 'reference');
select public.hr_record_benefit_claim_payment(pg_temp.id('c1'), 'NEFT-2026-11-001', hr_private.business_today());
select test.ok((select status = 'paid_externally' and payment_reference = 'NEFT-2026-11-001' and paid_on is not null from public.hr_benefit_claims where id = pg_temp.id('c1')), 'claim recorded as paid externally');
select test.throws($q$select public.hr_record_benefit_claim_payment(pg_temp.id('c1'), 'AGAIN', hr_private.business_today())$q$, 'payment recorded once', 'Only approved');
select test.ok((select reimb = (select count(*) from public.hr_reimbursements) and runs = (select count(*) from public.hr_payroll_runs)
                       and payroll_writes = (select coalesce(sum(n_tup_ins + n_tup_upd), 0) from pg_stat_xact_user_tables where relname like 'hr_payroll%')
                from t_counts), 'approval and payment do not touch payroll or reimbursements');
select test.ok(not exists (select 1 from pg_proc p where p.proname like 'hr_%benefit%' and p.prosrc ilike '%hr_payroll_adjustments%'), 'no benefit function writes payroll adjustments');

-- ------------------------------------------------------------ history, notifications, audit
select pg_temp.as_k('emp1');
select test.ok(test.count_rows($q$select 1 from public.hr_benefit_events where claim_id = pg_temp.id('c1')$q$) >= 4, 'claim history visible to the claimant');
select test.throws($q$update public.hr_benefit_events set note = 'x' where claim_id = pg_temp.id('c1')$q$, 'history is read-only for users', 'permission denied');
select test.ok(exists (select 1 from public.hr_notifications where type = 'benefit_claim_decided' and recipient_user_id = auth.uid()), 'claimant notified of the decision');
select test.as_owner();
select test.throws($q$update public.hr_benefit_events set note = 'x' where claim_id = pg_temp.id('c1')$q$, 'history is append-only even for the owner', 'cannot be changed');
select test.ok((select bool_and(new_data ->> 'amount' = '[redacted]') from public.hr_audit_log where table_name = 'hr_benefit_claims' and new_data is not null), 'claim amounts redacted in the audit log');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_benefit_claims'), 'claims are audited');

-- ------------------------------------------------------------ plan year lock, auto-end on exit
select pg_temp.as_k('hr');
select test.throws($q$update public.hr_benefit_types set plan_year_start_month = 1 where id = pg_temp.id('learn')$q$, 'plan year locked once claims exist', 'plan year');
select test.as_owner();
update public.hr_employees set status = 'exited', last_working_date = current_date where id = pg_temp.id('emp2');
select test.ok((select bool_and(status = 'ended') from public.hr_benefit_enrollments where employee_id = pg_temp.id('emp2')), 'enrollments end on exit (114 trigger)');
select test.ok(exists (select 1 from public.hr_benefit_events where employee_id = pg_temp.id('emp2') and action = 'enrollment_ended'), 'exit end recorded in history');

-- 172 — Tax documents for "My Payroll & Payslips":
--   * 'tax' document group and the three tax categories exist;
--   * employees can upload their own tax declaration / proof, but not Form 16;
--   * Form 16 is a compensation category issued by HR:
--     hr_admin adds one, and the employee
--     can then see it while a colleague cannot.
-- Synthetic data only; the runner rolls the transaction back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;

do $$
begin
  insert into t_ids values ('emp1',  test.make_employee('t172.emp1@test.local',  'Tara',  null, array['employee']));
  insert into t_ids values ('emp2',  test.make_employee('t172.emp2@test.local',  'Tomas', null, array['employee']));
  insert into t_ids values ('admin', test.make_employee('t172.admin@test.local', 'Tilda', null, array['hr_admin','employee']));
end $$;

select test.eq((select count(*) from public.hr_document_categories
                where code in ('form_16','tax_statement','tax_investment_proof') and doc_group = 'tax' and employee_can_view and active),
  3::bigint, 'three tax categories in the tax group, visible to employees');
select test.ok((select contains_compensation and not employee_can_upload from public.hr_document_categories where code = 'form_16'),
  'Form 16 is HR-issued and marked as compensation');
select test.ok((select employee_can_upload and not contains_compensation and not is_confidential from public.hr_document_categories where code = 'tax_investment_proof'),
  'tax declaration / proof is employee-uploadable');
select test.throws($q$update public.hr_document_categories set doc_group = 'nonsense' where code = 'form_16'$q$,
  'doc_group is still constrained', 'check');

-- Employee: own declaration yes, Form 16 no.
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('emp1');
  r := public.hr_register_document_upload((select v from t_ids where k = 'emp1'), 'tax_investment_proof', 'Rent receipts FY 2026-27',
         'rent.pdf', 'application/pdf', 2048);
  perform test.ok((r ->> 'document_id') is not null, 'employee uploads own tax declaration / proof');
  perform test.as_owner();
end $$;
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_register_document_upload((select v from t_ids where k = 'emp1'), 'form_16', 'Form 16', 'f16.pdf', 'application/pdf', 2048)$q$,
  'employee cannot upload Form 16', 'uploaded by HR');
select test.as_owner();

-- HR admin issues Form 16 for emp1.
do $$
declare r jsonb;
begin
  perform pg_temp.as_k('admin');
  r := public.hr_register_document_upload((select v from t_ids where k = 'emp1'), 'form_16', 'Form 16 FY 2025-26',
         'form16.pdf', 'application/pdf', 4096);
  insert into t_ids values ('f16', (r ->> 'document_id')::uuid);
  perform test.as_owner();
end $$;
select test.ok((select includes_compensation from public.hr_documents where id = (select v from t_ids where k = 'f16')),
  'Form 16 document is flagged as containing compensation');

select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = (select v from t_ids where k = 'f16')$q$), 1::bigint,
  'employee sees their own Form 16');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = (select v from t_ids where k = 'f16')$q$), 0::bigint,
  'a colleague cannot see it');
select test.as_owner();

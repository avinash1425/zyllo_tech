-- Bulk employee import: permission, validation, dry run, all-or-nothing.
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
do $$
begin
  insert into public.hr_departments (code, name) values ('ENG', 'Engineering');
  insert into public.hr_designations (name) values ('Software Engineer');
  insert into t_ids values ('hr', test.make_employee('hr@test.local', 'Hira', null, array['hr_admin']));
  insert into t_ids values ('mgr', test.make_employee('lead@test.local', 'Lead', null, array['manager']));
  insert into t_ids values ('emp', test.make_employee('emp@test.local', 'Eli', null, array['employee']));
end $$;

select test.as_user(test.user_of((select v from t_ids where k='emp')));
select test.throws($q$select public.hr_import_employees('[]'::jsonb, true)$q$, 'employees cannot import', 'not allowed');
select test.as_owner();

select test.as_user(test.user_of((select v from t_ids where k='hr')));
-- dry run with mixed errors reports per-row problems and writes nothing
select test.ok((public.hr_import_employees($j$[
  {"first_name":"Ana","company_email":"ana@test.local","department_code":"eng","designation":"Software Engineer","manager_email":"lead@test.local","joining_date":"2026-11-02"},
  {"first_name":"","company_email":"bad-email"},
  {"first_name":"Dup","company_email":"emp@test.local"},
  {"first_name":"Bo","company_email":"bo@test.local","department_code":"NOPE","employment_type":"wizard","joining_date":"02/11/2026"}
]$j$::jsonb, true) -> 'errors') @> '[{"row":2,"field":"first_name"},{"row":2,"field":"company_email"},{"row":3,"field":"company_email"},{"row":4,"field":"department_code"},{"row":4,"field":"employment_type"},{"row":4,"field":"dates"}]'::jsonb,
  'dry run reports each invalid field');
select test.eq((select count(*) from public.hr_employees where company_email = 'ana@test.local'), 0::bigint, 'dry run writes nothing');

-- a commit with ANY invalid row fails as a whole
select test.throws($q$select public.hr_import_employees('[{"first_name":"Ana","company_email":"ana@test.local"},{"first_name":"","company_email":"x@test.local"}]'::jsonb, false)$q$,
  'import with an invalid row is rejected', 'no employees were created');
select test.eq((select count(*) from public.hr_employees where company_email = 'ana@test.local'), 0::bigint, 'nothing created when any row is invalid');

-- valid import creates employees with generated codes, resolved references and history
select test.eq((public.hr_import_employees($j$[
  {"first_name":"Ana","last_name":"Rao","company_email":"ana@test.local","department_code":"ENG","designation":"software engineer","manager_code":"","manager_email":"lead@test.local","joining_date":"2026-11-02"},
  {"first_name":"Bo","company_email":"bo@test.local","employment_type":"intern"}
]$j$::jsonb, false) ->> 'created')::int, 2, 'valid import creates 2 employees');
select test.ok((select employee_code ~ '^ZT-\d{4}$' and manager_id = (select v from t_ids where k='mgr') and source = 'import'
                from public.hr_employees where company_email = 'ana@test.local'), 'imported employee has code, manager and source');
select test.ok(exists (select 1 from public.hr_employee_history h join public.hr_employees e on e.id = h.employee_id
                       where e.company_email = 'bo@test.local' and h.change_type = 'created'), 'import recorded in history');
select test.ok(exists (select 1 from public.hr_audit_log where action = 'EMPLOYEES_IMPORTED'), 'import audited');
select test.as_owner();

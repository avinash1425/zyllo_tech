-- =====================================================================
-- hr_dev_seed.sql — SYNTHETIC DEMO DATA for the LOCAL test cluster and the
-- ISOLATED DEV Supabase project ONLY.  NEVER APPLY TO PRODUCTION.
-- =====================================================================
-- * Every person here is fictional ("Demo …" names, @example.com, a domain
--   reserved for documentation by RFC 2606). No real employee, candidate or
--   salary data.
-- * No auth accounts are created: link people by sending invitations from
--   HR Operations (Edge Function hr-invite-employee), or bootstrap a Super
--   Admin as described in docs/hrms/DEPLOYMENT.md §4.
-- * Salary figures are round placeholders for exercising the payroll engine.
-- * Holidays listed are fixed-date national observances; HR must review the
--   full calendar for the year in HR Settings before relying on it.
-- * Idempotent: re-running does not duplicate rows.
-- =====================================================================
do $seed$
declare
  d_eng uuid; d_des uuid; d_qa uuid; d_ops uuid; d_hr uuid; d_fin uuid;
  loc uuid; sh uuid;
  ceo uuid; lead_eng uuid; lead_des uuid; hr_lead uuid;
  e uuid; p1 uuid; p2 uuid;
  basic uuid; hra uuid; special uuid;
  i int;
begin
  if exists (select 1 from public.hr_settings where key = 'seed_marker') then
    raise notice 'Synthetic HR seed already applied; skipping.';
    return;
  end if;
  insert into public.hr_settings (key, value, description)
  values ('seed_marker', jsonb_build_object('synthetic', true, 'applied_at', now()), 'SYNTHETIC DEMO DATA present — this database must not be production.');

  -- ---- organisation
  insert into public.hr_departments (code, name) values ('ENG', 'Engineering') returning id into d_eng;
  insert into public.hr_departments (code, name) values ('DES', 'Design') returning id into d_des;
  insert into public.hr_departments (code, name) values ('QA', 'Quality Assurance') returning id into d_qa;
  insert into public.hr_departments (code, name) values ('OPS', 'Operations') returning id into d_ops;
  insert into public.hr_departments (code, name) values ('HR', 'People & HR') returning id into d_hr;
  insert into public.hr_departments (code, name) values ('FIN', 'Finance') returning id into d_fin;

  insert into public.hr_designations (name, department_id, level) values
    ('Chief Executive Officer', d_ops, 10), ('Engineering Lead', d_eng, 7), ('Software Engineer', d_eng, 3),
    ('Senior Software Engineer', d_eng, 5), ('Design Lead', d_des, 7), ('UI/UX Designer', d_des, 3),
    ('QA Engineer', d_qa, 3), ('HR Manager', d_hr, 6), ('Finance Executive', d_fin, 3), ('Intern', null, 1);

  -- Zyllo Tech operates from a single office in Guntur.
  insert into public.hr_locations (name, city, address, timezone)
  values ('Guntur Office', 'Guntur', 'Guntur, Andhra Pradesh, India', 'Asia/Kolkata') returning id into loc;
  insert into public.hr_shifts (name, start_time, end_time, grace_minutes, break_minutes, working_days, is_default)
  values ('General shift', '09:30', '18:30', 10, 60, '{1,2,3,4,5}', true) returning id into sh;

  -- ---- people (fictional)
  insert into public.hr_employees (first_name, last_name, company_email, department_id, designation_id, employment_type, joining_date, work_location_id, shift_id, status)
  values ('Demo', 'Founder', 'demo.founder@example.com', d_ops, (select id from public.hr_designations where name = 'Chief Executive Officer'), 'full_time', date '2023-04-03', loc, sh, 'active') returning id into ceo;
  insert into public.hr_employees (first_name, last_name, company_email, department_id, designation_id, manager_id, employment_type, joining_date, work_location_id, shift_id, status)
  values ('Demo', 'Eng Lead', 'demo.englead@example.com', d_eng, (select id from public.hr_designations where name = 'Engineering Lead'), ceo, 'full_time', date '2023-06-01', loc, sh, 'active') returning id into lead_eng;
  insert into public.hr_employees (first_name, last_name, company_email, department_id, designation_id, manager_id, employment_type, joining_date, work_location_id, shift_id, status)
  values ('Demo', 'Design Lead', 'demo.designlead@example.com', d_des, (select id from public.hr_designations where name = 'Design Lead'), ceo, 'full_time', date '2024-01-08', loc, sh, 'active') returning id into lead_des;
  insert into public.hr_employees (first_name, last_name, company_email, department_id, designation_id, manager_id, employment_type, joining_date, work_location_id, shift_id, status)
  values ('Demo', 'HR Manager', 'demo.hr@example.com', d_hr, (select id from public.hr_designations where name = 'HR Manager'), ceo, 'full_time', date '2024-02-12', loc, sh, 'active') returning id into hr_lead;

  for i in 1..6 loop
    insert into public.hr_employees (first_name, last_name, company_email, department_id, designation_id, manager_id, employment_type, joining_date, work_location_id, shift_id, status)
    values ('Demo', 'Engineer ' || lpad(i::text, 2, '0'), 'demo.engineer' || i || '@example.com', d_eng,
            (select id from public.hr_designations where name = case when i <= 2 then 'Senior Software Engineer' else 'Software Engineer' end),
            lead_eng, 'full_time', date '2024-07-01' + (i * 37), loc, sh, case when i = 6 then 'probation' else 'active' end);
  end loop;
  insert into public.hr_employees (first_name, last_name, company_email, department_id, designation_id, manager_id, employment_type, joining_date, work_location_id, shift_id, status)
  values ('Demo', 'Designer', 'demo.designer@example.com', d_des, (select id from public.hr_designations where name = 'UI/UX Designer'), lead_des, 'full_time', date '2025-03-03', loc, sh, 'active'),
         ('Demo', 'QA Engineer', 'demo.qa@example.com', d_qa, (select id from public.hr_designations where name = 'QA Engineer'), lead_eng, 'contract', date '2025-05-05', loc, sh, 'active'),
         ('Demo', 'Finance', 'demo.finance@example.com', d_fin, (select id from public.hr_designations where name = 'Finance Executive'), ceo, 'full_time', date '2025-01-20', loc, sh, 'active');
  update public.hr_employees set contract_start_date = joining_date, contract_end_date = joining_date + 365 where company_email = 'demo.qa@example.com';
  for i in 1..2 loop
    insert into public.hr_employees (first_name, last_name, company_email, department_id, designation_id, manager_id, employment_type, joining_date, work_location_id, shift_id, status)
    values ('Demo', 'Intern ' || i, 'demo.intern' || i || '@example.com', d_eng, (select id from public.hr_designations where name = 'Intern'),
            lead_eng, 'intern', current_date - 45, loc, sh, 'active') returning id into e;
    insert into public.hr_internships (employee_id, mentor_id, department_id, start_date, end_date, project, learning_goals)
    values (e, (select id from public.hr_employees where company_email = 'demo.engineer1@example.com'), d_eng, current_date - 45, current_date + 135,
            'Internal tooling (synthetic)', 'React, SQL, code review practice');
  end loop;
  update public.hr_departments set head_employee_id = lead_eng where id = d_eng;
  update public.hr_departments set head_employee_id = lead_des where id = d_des;
  update public.hr_departments set head_employee_id = hr_lead where id = d_hr;

  -- ---- holidays (fixed-date national observances; review in HR Settings)
  insert into public.hr_holidays (holiday_date, name, type)
  select make_date(y, m, d), n, 'national'
  from generate_series(extract(year from current_date)::int, extract(year from current_date)::int + 1) y,
       (values (1, 26, 'Republic Day'), (8, 15, 'Independence Day'), (10, 2, 'Gandhi Jayanti')) h(m, d, n)
  on conflict do nothing;

  -- ---- projects & tasks
  insert into public.hr_projects (code, name, client, status, start_date) values ('DEMO-WEB', 'Demo Website Revamp', 'Synthetic Client A', 'active', current_date - 90) returning id into p1;
  insert into public.hr_projects (code, name, client, status, start_date) values ('DEMO-APP', 'Demo Mobile App', 'Synthetic Client B', 'active', current_date - 30) returning id into p2;
  insert into public.hr_project_members (project_id, employee_id, role)
  select p1, id, 'member' from public.hr_employees where department_id in (d_eng, d_des, d_qa) and status not in ('exited','archived');
  insert into public.hr_project_members (project_id, employee_id, role)
  select p2, id, 'member' from public.hr_employees where company_email like 'demo.engineer%@example.com' or company_email like 'demo.intern%@example.com';
  insert into public.hr_tasks (project_id, assignee_id, title, status, priority, due_date)
  select p1, id, 'Synthetic task for ' || last_name, 'in_progress', 'medium', current_date + 7
  from public.hr_employees where company_email like 'demo.engineer%@example.com';

  -- ---- assets
  insert into public.hr_assets (asset_tag, asset_type, category, brand, model, serial_number, purchase_date, warranty_expiry, status, condition)
  select 'DEMO-LT-' || lpad(g::text, 3, '0'), 'Laptop', 'IT', 'DemoBrand', 'Model X', 'DEMO-SN-' || lpad(g::text, 5, '0'),
         current_date - 300, current_date + 430, 'available', 'good'
  from generate_series(1, 8) g;

  -- ---- payroll placeholders (synthetic round numbers; statutory components NOT configured)
  select id into basic from public.hr_salary_components where code = 'BASIC';
  select id into hra from public.hr_salary_components where code = 'HRA';
  select id into special from public.hr_salary_components where code = 'SPECIAL';
  if basic is not null then
    for e in select id from public.hr_employees where company_email like 'demo.engineer%@example.com' or company_email = 'demo.designer@example.com' loop
      insert into public.hr_salary_structures (employee_id, effective_from, annual_ctc, notes)
      values (e, date_trunc('year', current_date)::date, 600000, 'SYNTHETIC placeholder') returning id into p1;
      insert into public.hr_salary_structure_items (structure_id, component_id, amount) values (p1, basic, 25000);
      if hra is not null then insert into public.hr_salary_structure_items (structure_id, component_id, percent) values (p1, hra, 40); end if;
      if special is not null then insert into public.hr_salary_structure_items (structure_id, component_id, amount) values (p1, special, 15000); end if;
    end loop;
  end if;

  -- ---- recruitment & communications (drafts only)
  insert into public.hr_job_openings (title, department_id, employment_type, openings, required_skills, experience_min, experience_max, location, description, status)
  values ('Demo Frontend Engineer (synthetic)', d_eng, 'full_time', 2, array['React','TypeScript'], 1, 4, 'Guntur', 'Synthetic opening for testing the pipeline.', 'draft');
  insert into public.hr_announcements (title, body, category, audience_type, status)
  values ('Welcome to the HRMS dev environment', 'This is synthetic content for testing announcements.', 'general', 'all', 'draft');

  raise notice 'Synthetic HR seed applied.';
end
$seed$;

-- =====================================================================
-- AIMS reference alignment (migrations 113–116): SYNTHETIC company, grade,
-- benefit and training master data. Separate idempotent block so the seed
-- above is unchanged. No identity numbers, bank or payroll identifiers.
-- =====================================================================
do $seed2$
declare le uuid; g1 uuid; g2 uuid; g3 uuid;
begin
  if exists (select 1 from public.hr_settings where key = 'seed_marker_aims') then
    raise notice 'Synthetic AIMS-alignment seed already applied; skipping.';
    return;
  end if;
  if not exists (select 1 from public.hr_settings where key = 'seed_marker') then
    raise notice 'Base synthetic seed missing; skipping AIMS-alignment seed.';
    return;
  end if;
  insert into public.hr_settings (key, value, description)
  values ('seed_marker_aims', jsonb_build_object('synthetic', true, 'applied_at', now()), 'SYNTHETIC company/grade/benefit/training demo data.');

  insert into public.hr_legal_entities (code, name, legal_name, country)
  values ('ZT-DEMO', 'Zyllo Tech (Demo entity)', 'Zyllo Tech Demo Entity (synthetic)', 'IN') returning id into le;
  insert into public.hr_grades (code, name, level) values ('G1', 'Grade 1 - Associate', 1) returning id into g1;
  insert into public.hr_grades (code, name, level) values ('G2', 'Grade 2 - Professional', 2) returning id into g2;
  insert into public.hr_grades (code, name, level) values ('G3', 'Grade 3 - Lead', 3) returning id into g3;

  update public.hr_departments set legal_entity_id = le where legal_entity_id is null;
  -- Company + grade for most demo employees; interns / finance left blank so completeness shows real gaps.
  update public.hr_employees set legal_entity_id = le where company_email like 'demo.%@example.com' and company_email not like 'demo.intern%';
  update public.hr_employees set grade_id = case when company_email in ('demo.englead@example.com','demo.designlead@example.com','demo.hr@example.com','demo.founder@example.com') then g3
                                                 when company_email like 'demo.engineer%' then g2 else g1 end,
                                 work_arrangement = case when company_email like 'demo.engineer%' then 'hybrid' else 'office' end,
                                 contract_type = case employment_type when 'contract' then 'fixed_term' when 'intern' then 'internship' else 'permanent' end,
                                 notice_period_days = case employment_type when 'intern' then 7 when 'contract' then 15 else 30 end
   where company_email like 'demo.%@example.com' and company_email <> 'demo.finance@example.com';
  update public.hr_employees set deployment_status = 'deployed', deployment_client = 'Synthetic Client A', deployment_project_code = 'DEMO-WEB',
                                 deployment_start_date = current_date - 60
   where company_email in ('demo.engineer1@example.com','demo.engineer2@example.com');

  insert into public.hr_benefit_types (code, name, category, description, provider, eligible_employment_types, min_tenure_months, employer_contribution, allows_dependants)
  values ('MEDICAL', 'Group medical insurance (synthetic)', 'health', 'Synthetic plan for testing enrollments.', 'Demo Insurer', array['full_time','part_time'], 0, 1200, true),
         ('WELLNESS', 'Wellness allowance (synthetic)', 'wellness', 'Synthetic monthly wellness allowance.', null, null, 3, 500, false);
  insert into public.hr_benefit_enrollments (employee_id, benefit_type_id, start_date, coverage_level, employer_contribution)
  select e.id, t.id, greatest(e.joining_date, date_trunc('year', current_date)::date), 'employee', t.employer_contribution
  from public.hr_employees e cross join public.hr_benefit_types t
  where t.code = 'MEDICAL' and e.employment_type = 'full_time' and e.status in ('active','probation') and e.company_email like 'demo.engineer%';

  insert into public.hr_training_courses (code, title, category_id, delivery_mode, duration_hours, is_mandatory, pass_score)
  values ('SEC-101', 'Security awareness (synthetic)', (select id from public.hr_training_categories where code = 'compliance'), 'online', 2, true, 70),
         ('ONB-101', 'Company induction (synthetic)', (select id from public.hr_training_categories where code = 'onboarding'), 'classroom', 4, true, null),
         ('REACT-201', 'Advanced React (synthetic)', (select id from public.hr_training_categories where code = 'technical'), 'self_paced', 12, false, null);
  insert into public.hr_training_assignments (employee_id, course_id, due_date, status)
  select e.id, c.id, current_date + 14, 'assigned'
  from public.hr_employees e cross join public.hr_training_courses c
  where c.code = 'SEC-101' and e.status in ('active','probation') and e.company_email like 'demo.%@example.com';
  insert into public.hr_training_assignments (employee_id, course_id, due_date, status, completion_date, result, completion_source, verified_at, started_at)
  select e.id, c.id, current_date - 20, 'completed', current_date - 25, 'attended', 'hr', now(), now()
  from public.hr_employees e cross join public.hr_training_courses c
  where c.code = 'ONB-101' and e.company_email like 'demo.engineer%';
  insert into public.hr_training_assignments (employee_id, course_id, due_date, status)
  select e.id, c.id, current_date - 3, 'assigned'
  from public.hr_employees e cross join public.hr_training_courses c
  where c.code = 'REACT-201' and e.company_email in ('demo.engineer5@example.com','demo.engineer6@example.com');

  raise notice 'Synthetic AIMS-alignment seed applied.';
end
$seed2$;

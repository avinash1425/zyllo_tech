-- Seed smoke test (runs only with --seed): the synthetic dev seed is coherent
-- and the dashboard + every report work on realistic data.
select test.ok((select value ->> 'synthetic' = 'true' from public.hr_settings where key = 'seed_marker'), 'seed marker present');
select test.ok((select count(*) >= 15 from public.hr_employees), 'seeded employees');
select test.ok((select bool_and(company_email::text like '%@example.com') from public.hr_employees), 'all seeded emails use the reserved example.com domain');
select test.ok((select count(distinct employee_code) = count(*) from public.hr_employees), 'seeded employee codes unique');
select test.ok((select count(*) = 1 from public.hr_locations), 'single office location (Guntur)');
select test.ok((select count(*) = 2 from public.hr_internships), 'internships seeded');
select test.ok(not exists (select 1 from public.hr_employees where user_id is not null), 'seed creates no linked accounts');
do $$
declare v_super uuid; r text; res jsonb;
begin
  v_super := test.make_employee('seed.super@test.local', 'SeedSuper', null, array['super_admin']);
  perform test.as_user(test.user_of(v_super));
  res := public.hr_dashboard();
  perform test.ok((res -> 'kpis' ->> 'total_employees')::int >= 16, 'dashboard counts seeded employees');
  perform test.ok(jsonb_array_length(res -> 'department_headcount') >= 5, 'dashboard department breakdown');
  foreach r in array array['headcount','department_distribution','employee_status','attendance_summary','late_arrivals','absence',
    'leave_balances','leave_history','daily_report_compliance','project_activity','recruitment_pipeline','intern_progress',
    'payroll_summary','performance_summary','document_expiry','asset_assignment','exit_summary'] loop
    res := public.hr_report(r, hr_private.business_today() - 30, hr_private.business_today());
    perform test.ok(jsonb_typeof(res -> 'rows') = 'array', 'report on seed: ' || r);
  end loop;
  -- payroll engine runs on the synthetic structures
  res := public.hr_create_payroll_run(date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'seed smoke');
  res := public.hr_calculate_payroll_run((res ->> 'id')::uuid);
  perform test.ok((res ->> 'employees')::int >= 7, 'payroll calculates for seeded salary structures');
  perform test.as_owner();
end $$;

-- AIMS-alignment seed block (113-116)
select test.ok((select count(*) = 1 from public.hr_legal_entities), 'synthetic legal entity seeded');
select test.ok((select count(*) >= 3 from public.hr_grades), 'grades seeded');
select test.ok((select count(*) >= 1 from public.hr_benefit_enrollments) and (select count(*) >= 1 from public.hr_training_assignments), 'benefit and training data seeded');
select test.ok(not exists (select 1 from public.hr_employee_identity) and not exists (select 1 from public.hr_payroll_employee_identifiers), 'seed stores no identity or payroll identifiers');
do $$
declare v_super uuid; r text; res jsonb;
begin
  v_super := test.make_employee('seed.super2@test.local', 'SeedSuper2', null, array['super_admin']);
  perform test.as_user(test.user_of(v_super));
  res := public.hr_dashboard();
  perform test.ok(jsonb_array_length(res -> 'by_company') >= 1 and jsonb_array_length(res -> 'data_completeness') >= 10, 'dashboard analytics on seed');
  perform test.ok((res -> 'training_summary' ->> 'overdue')::int >= 2, 'overdue training visible on seed');
  foreach r in array array['workforce_by_company','workforce_by_location','workforce_by_grade','employment_type_breakdown','new_joiners',
    'tenure_bands','nationality_mix','gender_mix','age_bands','org_units','reporting_lines','deployment_summary','deployment_roster',
    'data_completeness','identity_expiry','identity_compliance','contract_expiry','probation_due','benefits_enrollment','benefits_roster',
    'training_completion','training_overdue'] loop
    res := public.hr_report(r, hr_private.business_today() - 30, hr_private.business_today());
    perform test.ok(jsonb_typeof(res -> 'rows') = 'array', 'report on seed: ' || r);
  end loop;
  perform test.as_owner();
end $$;

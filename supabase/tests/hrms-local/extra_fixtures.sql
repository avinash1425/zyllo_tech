-- =====================================================================
-- LOCAL TEST HARNESS ONLY. NEVER APPLY TO A REAL SUPABASE PROJECT.
-- Extra synthetic fixtures for scripts/hrms-local/browser-flows-2.mjs.
-- Applied by that script (psql, as the cluster owner) to the RUNNING
-- throwaway cluster before the workflow tests. Re-runnable: every row is
-- keyed by a per-run suffix passed as  -v run=<suffix>.
--
-- Creates, through the same paths the real app uses:
--   * a synthetic employee "Demo Leaver <run>" (inserted by the Super Admin
--     through the table insert the HR "Add employee" form uses, RLS applies),
--   * a sign-in account leaver.<run>@example.com linked through the real
--     service-role RPC hr_link_invited_user + hr_activate_my_account,
--   * a synthetic laptop asset WF2-LVR-<run> assigned to that employee by
--     hr.admin through hr_assign_asset (so the exit clearance "asset return"
--     item is blocked until the asset is returned).
-- Every person is fictional (@example.com).
-- =====================================================================
\set ON_ERROR_STOP 1
select set_config('wf2.run', :'run', false);

do $$
declare
  v_run text := current_setting('wf2.run');
  v_email text := 'leaver.' || v_run || '@example.com';
  v_user uuid; v_emp uuid; v_super uuid; v_asset uuid;
  src public.hr_employees;
begin
  if exists (select 1 from auth.users where email = v_email) then
    raise notice 'extra fixtures for run % already applied', v_run;
    return;
  end if;
  select * into src from public.hr_employees where company_email = 'demo.engineer4@example.com';
  select id into v_super from auth.users where email = 'superadmin@example.com';

  -- 1. sign-in account (local GoTrue stand-in reads auth.users + hrms_local.passwords)
  insert into auth.users (email, raw_user_meta_data)
  values (v_email, jsonb_build_object('full_name', 'Demo Leaver ' || v_run, 'synthetic', true))
  returning id into v_user;
  insert into hrms_local.passwords (user_id, password_hash)
  values (v_user, public.crypt('Local-Test-Only-2026!', public.gen_salt('bf', 6)));

  -- 2. employee record, created by the Super Admin (RLS applies)
  perform hrms_local.act_as('superadmin@example.com');
  insert into public.hr_employees (first_name, last_name, company_email, department_id, designation_id, manager_id,
                                   employment_type, joining_date, work_location_id, shift_id, status)
  values ('Demo', 'Leaver ' || v_run, v_email, src.department_id, src.designation_id, src.manager_id,
          'full_time', date '2025-01-06', src.work_location_id, src.shift_id, 'active')
  returning id into v_emp;
  perform hrms_local.act_as_owner();

  -- 3. link + activate through the real RPCs
  perform hrms_local.act_as_service();
  perform public.hr_link_invited_user(v_emp, v_user, v_super);
  perform hrms_local.act_as_owner();
  perform hrms_local.act_as(v_email);
  perform public.hr_activate_my_account();
  perform hrms_local.act_as_owner();

  -- 4. an asset held by the leaver (assigned by HR through the real RPC)
  perform hrms_local.act_as('hr.admin@example.com');
  insert into public.hr_assets (asset_tag, asset_type, category, brand, model, condition, notes)
  values ('WF2-LVR-' || v_run, 'Laptop', 'IT', 'Synthetic', 'Leaver test laptop', 'good', 'Synthetic asset for exit-clearance tests')
  returning id into v_asset;
  perform public.hr_assign_asset(v_asset, v_emp, null, 'Synthetic: held by the leaver (browser-flows-2)');
  perform hrms_local.act_as_owner();
end $$;

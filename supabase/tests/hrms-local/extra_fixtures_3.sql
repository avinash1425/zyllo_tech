-- =====================================================================
-- LOCAL TEST HARNESS ONLY. NEVER APPLY TO A REAL SUPABASE PROJECT.
-- Extra synthetic fixtures for scripts/hrms-local/browser-flows-3.mjs.
-- Applied by that script (psql, as the cluster owner) to the RUNNING
-- throwaway cluster before the workflow tests. Idempotent (safe to re-run).
--
-- Creates, through the same paths the real app uses (writes run AS the user,
-- so RLS and the guard triggers apply):
--   * leave type WF3_FULL "WF3 Full-day Leave (synthetic)" with half days NOT
--     allowed (inserted by hr.admin, leave.manage) — used to check that a
--     half-day request on such a type is refused;
--   * a custom role wfthree_request_viewer holding ONLY hr_requests.view
--     (created and granted by the Super Admin, roles.manage), assigned to
--     payroll.approver@example.com through the real hr_assign_role RPC — a
--     view-only helpdesk user for the confidential-request check.
-- Every person is fictional (@example.com).
-- =====================================================================
\set ON_ERROR_STOP 1

do $$
declare v_viewer uuid := (select id from auth.users where email = 'payroll.approver@example.com');
begin
  if not exists (select 1 from public.hr_leave_types where code = 'WF3_FULL') then
    -- Owner context: since 160, leave policy edits by signed-in users go through the maker-checker RPCs.
    insert into public.hr_leave_types (code, name, description, paid, annual_entitlement, accrual, carry_forward_max,
                                       allow_half_day, allow_during_probation, allow_negative, sort_order)
    values ('WF3_FULL', 'WF3 Full-day Leave (synthetic)', 'Synthetic leave type: full days only (browser-flows-3).',
            true, 3, 'annual', 0, false, true, false, 90);
  end if;

  if not exists (select 1 from public.hr_roles where key = 'wfthree_request_viewer') then
    perform hrms_local.act_as('superadmin@example.com');
    insert into public.hr_roles (key, name, description)
    values ('wfthree_request_viewer', 'WF3 Request Viewer (synthetic)', 'Synthetic view-only helpdesk role (browser-flows-3).');
    insert into public.hr_role_permissions (role_key, permission_key) values ('wfthree_request_viewer', 'hr_requests.view');
    perform public.hr_assign_role(v_viewer, 'wfthree_request_viewer');
    perform hrms_local.act_as_owner();
  end if;
end $$;

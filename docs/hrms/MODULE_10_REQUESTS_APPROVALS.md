# Module 10 — HR Requests & Approvals (integration notes)

Branch `hrms/module-10-requests` (worktree `zyllo-tech-website-intern-m10`). Not committed, not deployed.
Migration: `supabase/migrations/180_hr_requests_approvals.sql` (renumbered from 190; Module 12 uses 190). Tests: `supabase/tests/hr/180_requests_approvals.test.sql`,
`scripts/hrms-local/browser-flows-m10.mjs`.

## Design

One request system: `hr_requests` (111) gains `workflow` (helpdesk | hr_letter | profile_change | reimbursement |
salary_advance), validated `details`, sequential approval stages `hr_request_approvals`, append-only history
`hr_request_events`, private files `hr_request_attachments` (bucket `hr-request-files`) and `hr_request_sensitive`
(proposed / previous profile and bank values; no API read access).

| Type | Route (default, configurable) | Fulfilment (owning module stays authoritative) |
|---|---|---|
| Attendance correction | Module 5 (manager, optional HR) | `hr_attendance_corrections` + `hr_decide_attendance_correction` (Module 5). Not copied; listed in the inbox. |
| HR letter | HR | Link an `hr_documents` record (Module 9) or a restricted request file. Salary certificates: compensation-authorised staff only, compensation-restricted document (129) or restricted file. |
| Reimbursement | Manager → Finance | On final approval one `approved` row in `hr_reimbursements` (Module 7); paid only by the payroll run (status synced by trigger). |
| Salary advance | Manager (or HR) → Payroll | `hr_salary_advances`: employee agreement → Finance records disbursement → second Finance user verifies → repayments recorded with reference. Disabled by default. |
| Profile change | HR (+ Payroll for bank) | Applied to `hr_employee_private` / `hr_employees.display_name`; bank → new unverified primary account in `hr_employee_bank_accounts` (Module 7 maker-checker verifies). |

Rules: no self-approval; a different approver per stage (setting); stage id is the idempotency key (repeat → `already_decided`);
a manager stage without an eligible manager becomes HR; HR may decide a manager stage (recorded `hr_override`); delegation of
manager stages to another `hr_requests.approve_team` holder.

## Security fixes

- **X7** — blanket `grant execute on all functions in schema hr_private` (113–120, and 125/128/130/160/170/190 in sibling
  sessions) re-granted the write helpers 111 revoked. They now live in schema `hr_internal` (no USAGE for anon /
  authenticated); the hr_private copies are dropped. Independent of migration order.
- **HR11** — new permissions `hr_requests.payroll`, `hr_requests.finance` (payroll_admin) and `hr_requests.approve_team`
  (manager). Payroll admins see and handle payroll-routed requests without `hr_requests.manage`; confidential helpdesk
  requests are never routed.

## New RPCs

`hr_create_workflow_request`, `hr_update_workflow_request`, `hr_submit_workflow_request`, `hr_decide_request_stage`,
`hr_delegate_request_stage`, `hr_request_delegate_options`, `hr_register_request_attachment`, `hr_remove_request_attachment`,
`hr_issue_letter_request`, `hr_letter_issue_options`, `hr_salary_advance_eligibility`, `hr_accept_advance_agreement`,
`hr_record_advance_disbursement`, `hr_verify_advance_disbursement`, `hr_record_advance_repayment`, `hr_request_detail`,
`hr_approval_inbox`, `hr_requests_overview`, `hr_set_request_category_routing`, `hr_save_request_policy`, `hr_request_policies`.
111's helpdesk RPCs keep their signatures (handling now scoped; they refuse workflow requests).

## Shared files touched

- `src/hr/HrApp.jsx` — Requests nav entry: label + new permissions (one line).
- `scripts/hrms-local/lib.mjs` — `HRMS_LOCAL_INSTANCE` (identical to Module 9's change).

## Decisions needed at integration

1. **Module 7** — `hr_submit_reimbursement` (105) and the claim form in `MyPayslipsPage` still create claims without manager
   approval. Retire or redirect them to the Module 10 claim flow.
2. **Module 7** — advance repayment by payroll deduction: `ADVANCE_RECOVERY` (170) is the hook. Policy flag
   `allow_payroll_deduction` + employee authorisation are required; record each deduction with
   `hr_record_advance_repayment(..., 'payroll_deduction', ..., run_id)`. Nothing is automated.
3. **HR Dashboard (112/117)** — request KPIs count only helpdesk statuses; add `pending_approval` and `approved`.
4. **Employee Management** — `hr_update_my_contact` still lets employees change contact details without approval.
5. **Module 9** — 129 test `no HR notification before the file is stored` fails in the combined run with or without 180.
6. **Module 4 worktree** carries a stray `117_hr_employee_management.sql` (duplicate of 118) that breaks a combined apply.
7. Write-capable `hr_private` helpers of other modules (notify_*, audit_event, queue_email, …) remain executable by
   `authenticated`; safe only while `hr_private` is not an exposed API schema. Consider moving them to `hr_internal`.

## Tests (local only, synthetic data)

- Worktree DB suite: 22/22 files; 180 has 166 assertions (some run only when 129 / 170 are present); seed smoke 55/55;
  `npm test` 45/45; `vite build` OK.
- Combined rehearsal with sibling migrations: 29/30 files; 180 passes (172 assertions); only 129 fails (Module 4 / 130
  conflict). Details and all open integration items: `MODULE_10_INTEGRATION_READINESS.md`.
- Browser (isolated harness, instance m10): 47/47.

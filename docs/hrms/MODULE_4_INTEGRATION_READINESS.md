# Module 4 (Onboarding & Employee Exit): integration readiness

- **Prepared:** 2026-11-05.
- **State:** nothing merged, committed, pushed or deployed. No database was reset, and nothing connected to Supabase. No other session's worktree was modified; they were only read.
- **Worktree:** `D:\Projects\zyllo-tech-website-intern-m4`, branch `hrms/module-4-onboarding-exit`. The baseline snapshot (copied from the shared Intern tree at 10:33:53) is staged, not committed.

## 1. Preserved artefacts (in the worktree)

| File | Purpose |
|---|---|
| `docs/hrms/module4-integration-rebased.patch` | **Use this one.** All Module 4 changes, rebased onto the **current** Intern files. Verified with `git apply --check` against a fresh copy of the current Intern versions of every shared file. |
| `docs/hrms/module4-integration.patch` | The same changes against the 10:33 snapshot, kept for reference. Its `HrApp.jsx` hunk no longer applies to Intern. |
| `docs/hrms/module4-files.tar` | Every Module 4 file, both patches and the 7 `m4-*.jpg` screenshots (binary files that are not in the patches). |
| `docs/hrms/MODULE_4_ONBOARDING_EXIT.md` | The module description. |

**Patch coverage:** I compared the worktree change list with the files in each patch. All 24 text files are included. The only exclusions are the screenshots (in the tar) and the patches themselves.

## 2. Files ready for integration

**New files (no conflict possible; nothing exists at these paths in Intern or any module worktree):**
- `supabase/migrations/130_hr_onboarding_exit.sql`
- `supabase/tests/hr/130_onboarding_exit.test.sql`
- `src/lib/hr/lifecycle.js`, `src/lib/hr/settlementStatement.js`
- `src/hr/pages/lifecycle/` (10 files)
- `src/employee/pages/MyOnboardingPage.jsx`, `src/employee/pages/MyResignationPage.jsx`
- `scripts/hrms-local/browser-flows-m4.mjs` (test only)
- `docs/hrms/MODULE_4_*.md`

**Modified shared files (the rebased patch applies cleanly to current Intern):**

| File | Intern changed since snapshot? | Module 4 change | Status |
|---|---|---|---|
| `src/hr/HrApp.jsx` | **Yes.** Session 3 moved Recruitment to 3rd place and relabelled it "Recruitment & Hiring". Session 2 relabelled "Employee Management" and added an `employee-management` alias. | Icon import, `LIFECYCLE_PERMISSIONS` import, new entry **right after Recruitment & Hiring**, `exit.clearance_it` on the Exits entry, aliases `onboarding`, `probation`, `final-settlement`. | **Conflict in the original patch. Resolved** in the rebased patch, keeping every Session 2/3 change. |
| `src/employee/EmployeeApp.jsx` | Line endings only (now CRLF) | 2 icons, 2 pages, `/employee/exit` redirect | Applies; line endings stay consistent (no mixed CRLF/LF) |
| `src/hr/pages/ExitsPage.jsx` | No | Owner-aware clearance, exception, revocation-failed banner, settlement status card | Clean |
| `src/lib/hr/exits.js` | No | `it_clearance` label, "Finance clearance" label, `canActOnClearance()` | Clean |
| `supabase/functions/hr-revoke-exit-access/index.ts` | No | Records failures via `hr_record_access_revocation_failure` | Clean |
| `supabase/tests/hr/110_exit.test.sql` | No | Expects 9 clearance items; final settlement completed through a payroll-approved settlement | Clean |

## 3. Shared-file conflicts with modules not yet integrated (from read-only comparison)

| File | Other module | Overlap | Resolution |
|---|---|---|---|
| `src/hr/HrApp.jsx` | M5, M6, M7, M8, M9, M11, M12 | Their copies predate Session 3's move, so their diffs show the old "Recruitment" label. This is a stale base, not real edits. | Integrators must keep Intern's version of the recruitment line. Module 4's entry stays directly after it. |
| `src/hr/HrApp.jsx` | M10 (Requests) | Relabels and extends the `requests` entry | Different line; no overlap with Module 4 |
| `src/employee/EmployeeApp.jsx` | M12 (Reports) | Edits the **same lucide import line** (adds `BarChart3`) and adds a "My Reports" page in Records | Trivial textual conflict: merge both icon lists. Each module's page line stands on its own. |
| `src/employee/pages/MyHrRequestsPage.jsx` | M10 | M10 rewrites the file but keeps `ResignationSection` unchanged | Module 4 does not modify this file (see §8) |

**Shared database objects:**

| Object | Module 4 action | Other modules | Result |
|---|---|---|---|
| `hr_start_exit_clearance`, `hr_complete_clearance_item`, `hr_withdraw_resignation`, `hr_can_revoke_exit_access`, `hr_record_auth_access_revoked` (from 110) | Replaced in place | No other migration (Intern 118/120, M5–M12) redefines them | No conflict |
| `hr_exit_clearance_items` key/status checks; new columns on `hr_exits` | Altered | Not touched by others | No conflict |
| `hr_convert_candidate_to_employee` | Not modified. Trigger `hr_employees_onboarding_case` relies on its contract. | Redefined by Session 3 (120) | **Compatible.** Still inserts `status 'onboarding'`, `source 'candidate'`, `source_ref = application`, with the `accepted` offer. Verified by tests 104, 120 and 130 together. |
| `hr_employee_change_events`, `hr_employee_history.event_id` | Writes change events and links history rows (max-id watermark) | Session 2 (118) | **Compatible.** Confirmed by Session 2. 118 and 130 pass together. |
| Notification when an employee uploads a document | Trigger on `storage.objects` (after the file lands) | M9 (129) `hr_documents_object_uploaded` | **Conflict found and fixed.** 130 notified when the version row was registered, breaking 129's test ("no HR notification before the file is stored"). 130 now notifies at the same point as 129, and when 129's trigger exists it sends **no** `documents.manage` notification (only the onboarding-coordinator notice). |
| `hr_employee_open_assets` | Called | Redefined by M11 (141) with the **same signature** | Compatible |
| `hr_documents.verification_status` | Reads `verified` / `pending` / `rejected` | M9 adds `replaced` | Compatible (`replaced` is correctly not counted as verified) |
| `hr_payroll_runs` status, double payment | Prefill adds `unpaid_salary` lines for items of `finalized` runs (`source_ref = 'payroll_item:<uuid>'`) and a `salary_due` line | M7 (170) adds partial payments; **M7's new `171_hr_payroll_exit_integration.sql`** (written for 130, reviewed by me) caps `unpaid_salary` lines at the unpaid balance, skips items already paid through payroll, and marks payroll payments paid when the settlement is paid. 170 excludes days covered by an approved settlement's `salary_due` line from later runs. | **Resolved by M7's 171** (its test passes with 130). Contracts M4 must keep stable: line types `unpaid_salary` / `salary_due`, `source_ref` format, settlement statuses. One review note for M7: 171 marks the whole payroll item paid even if the preparer lowered the settlement line; it should cap `amount_paid` at the line amount. |
| `hr_reimbursements` paid update | `hr_mark_settlement_paid` marks reimbursement lines paid | M10 (180) sync trigger | Works. The requester message reads "Paid through payroll", which is slightly inaccurate for an F&F payment. |
| `hr_leave_balances.available` / `hr_leave_types.paid` | Read for the prefill | M6 (160) | Compatible (confirmed by the Leave session) |

## 3a. Security hardening done during integration review
Raised by Session 93 (Module 9): most HRMS migrations end with `grant execute on all functions in schema hr_private to authenticated`. Any function that a migration had restricted becomes callable again by every signed-in user, including those defined in earlier migrations.
- **Module 4 helpers moved out of reach.** 130's 16 internal helpers (history logging, notifications, name lookup, missing-documents, payroll-derived daily rate, settlement maths, case/review creation, trigger functions) now live in a new schema `hr_lifecycle_internal`. Signed-in users have **no usage** on it, so no later blanket grant on `hr_private` can expose them. Only the boolean RLS visibility checks stay in `hr_private`. 130 itself no longer runs a blanket grant.
- **110's exit helpers protected for good.** `hr_private.exit_log` / `exit_notify` (exit history and notifications) keep their names and signatures but are now SECURITY INVOKER wrappers around copies in `hr_lifecycle_internal`. Every exit RPC (SECURITY DEFINER) still works. A direct call by a signed-in user is refused, even after later blanket grants (verified with all modules' migrations applied).
- **New test assertions** (130): an outsider cannot call the salary-derived daily rate, the name lookup, the missing-documents helper, onboarding history or case creation, or the 110 exit helpers. The RLS visibility checks still work.
- **Severity.** `hr_private` is **not exposed** through the Supabase Data API: `supabase/config.toml` has no `[api]` override, so the defaults (`public`, `graphql_public`) apply, and `ARCHITECTURE.md` defines `hr_private` as non-exposed. Browsers therefore **cannot** call these helpers through REST. The exposure is at the SQL level only: any code running as the `authenticated` role. These changes are defence in depth, which still matters, because a future SECURITY INVOKER function or a config change would otherwise make it reachable.
- **Not Module 4's to fix (foundation, migration 100):** at the SQL level a plain `authenticated` session can call `hr_private.audit_event` (forged audit-log rows) and `notify_user` / `notify_employee` / `notify_permission_holders`. This was confirmed with a throwaway probe on the all-modules scratch copy; it is not reachable through the REST API. Recommended HRMS-wide fix: targeted grants instead of blanket ones, or moving writers to an unexposed, no-usage schema (Module 10's `hr_internal` approach). Recorded as a foundation item by Module 9 as well (its readiness doc §4.3). Progress: Module 6 (160) has switched to targeted grants with its own no-usage schema `hr_leave_internal`. Blanket `hr_private` grants that run after 130 remain in 170, 171 (Module 7) and 190 (Module 12). Earlier ones (100–128) are pre-existing. The decision belongs to whoever owns the foundation / final integration.

## 4. Migration dependencies and order
- 130 creates schema `hr_lifecycle_internal`; no other migration uses that name.
- `130_hr_onboarding_exit.sql` requires 100–117 (foundation, recruitment offers 104, payroll 105, documents 107, assets 109, exit 110, training 115).
- **Optional runtime integrations, detected at runtime:**
  - **118 (Employee Management):** change events and the history link; skipped if 118 is absent.
  - **129 (Documents):** the HR upload notification defers to 129's trigger.
  - Neither is a hard dependency, so the migration runs in any order relative to them.
- **Intern numbering:** 117 is Dashboard, 118 is Employee Management (renamed from 117 by Session 2; **do not restore any `117_*employee_management*` file**), 120 is Recruitment, 130 is Module 4. No duplicate numbers.
- **Verified runs on throwaway local clusters:**
  - Current Intern migrations (100–120) + 130, all Intern tests + updated 110 + 130: **22/22 files, 1,299 assertions.** Seed smoke: 55/55.
  - Every module's latest migrations (Intern 100–120 + 125, 128, 129, 130, 141, 160, 170, **171**, 180, 190), every module's tests, with M6's updated 103 and M7's updated 105: **31/31 files, 2,455 assertions** (latest run, including the hardened 160 and updated 190).

## 5. Remaining test failures
- **No remaining failures in the combined runs above.**
- **Employee Management line-38 error:** it was in the obsolete `117_employee_management.test.sql` from my early snapshot. Intern now has `118_employee_management.test.sql`, which passes (65 assertions). Session 2 confirmed.
- **Integrator note:** with 160/170 applied, Intern's **original** `103_leave` and `105_payroll` tests fail (leave policy approvals and salary-structure overlap rules changed). Use the updated tests from the M6 and M7 worktrees. This is unrelated to Module 4.
- **Not run:**
  - ESLint with the project config: `eslint-config-next` is not installed. A minimal lint (no-undef) and the Vite production build pass.
  - Real Supabase Auth/Storage end to end, because no Supabase connection was allowed.
  - A browser rerun after the notification fix: the change is SQL-only and covered by the DB tests. The last browser run was 49/49 checks across two runs.

## 6. Required permissions

| Permission | Default grant | Who needs it |
|---|---|---|
| `onboarding.view`, `onboarding.manage` | hr_admin, super_admin | HR coordinators |
| `onboarding.view_team` | manager | Line managers (see team joiners, complete manager tasks) |
| `probation.view`, `probation.decide` | hr_admin, super_admin | HR decision makers |
| `probation.view_team`, `probation.review_team` | manager | Line managers (feedback) |
| **`exit.clearance_it`** | **super_admin only** | **Assign to the IT team**. Create an "IT Admin" role in HR Settings → Roles with `exit.clearance_it` (optionally `assets.manage`). Grants: completing `it_clearance` and `access_revocation`, running the revocation pre-flight and Edge Function, seeing exits from the clearance stage on, and the `/hr/exits` and Clearance pages. |
| **`exit.override`** | **super_admin only** | **Assign sparingly** (e.g. Head of HR). Grants audited exceptions for pending mandatory clearance and failed access revocation. Never usable on one's own exit. Exceptions log `CLEARANCE_EXCEPTION` and notify `exit.manage` holders. Recommended: do not give it to the same people who complete clearance items. |
| `payroll.manage` / `payroll.approve` | payroll_admin | **At least two people** are needed for any settlement to be approved. The approver must differ from the preparer, the submitter and every editor. |
| `documents.manage` + `onboarding.view` | hr_admin | The Document Verification section |

Until `exit.clearance_it` is assigned, HR (`exit.manage`) can still complete IT items, which matches the previous behaviour.

## 7. Pending scheduler requirements (not implemented; no cron exists in the project)
1. **Probation reminders.** Run `hr_generate_probation_reviews(p_days)` daily. It is idempotent: it opens reviews for probations ending within `lifecycle.probation_reminder_days` and sends at most one overdue reminder per review per day.
   - **Blocker for a scheduled job:** the RPC requires `probation.decide`, so a service-role cron is refused.
   - **Needed:** either a service-role variant (`if auth.role() = 'service_role'` bypass), or a scheduled Edge Function that calls it with a dedicated technical HR account.
   - Until then, HR uses **Probation → Run review reminders**.
2. **Access revocation at the approved effective time.** With `lifecycle.access_revocation_timing = on_last_working_day`, revocation is allowed from the last working day, but **someone must trigger it** (IT/HR on the exit case).
   - **Needed:** a daily scheduled Edge Function that lists exits in `clearance` / `final_settlement` with `approved_last_working_day <= today`, `auth_access_revoked_at is null` and a linked account.
   - It must then ban the account (admin API), call `hr_record_auth_access_revoked`, and on error call `hr_record_access_revocation_failure`. Failures stay visible as a blocking state and notify HR.
   - **Needs new code:** a service-role-only listing RPC (e.g. `hr_exits_due_for_revocation()`), and a service-role path in the function. The current function requires a caller with `exit.manage` / `exit.clearance_it`.
   - **Business-time note:** "today" uses `hr_settings.company.timezone` via `business_today()`.
3. **Optional:** expiring-document reminders already exist (`hr_generate_document_expiry_reminders`) and could share the same scheduler.

## 8. Employee Portal resignation entry points

| Entry point | Today | After Module 4 |
|---|---|---|
| `/employee/requests` → `ResignationSection` (Intern and M10) | Submit / track / withdraw | Unchanged and still works. Its withdraw button follows the old rule (before HR approval); the server enforces the configured policy either way. |
| `/employee/resignation` (new) | — | Full page: submit, policy-aware withdraw, clearance, settlement |
| `/employee/exit` (link stored in exit notifications from 110) | Redirect to `/employee/requests` | Redirect to `/employee/resignation`. Existing notification rows keep working. |
| `/employee/team/exits` | Redirect to `/hr/exits` | Unchanged |

**Consolidation is safe and route-neutral.** Both UIs call the same RPCs (`hr_submit_resignation`, `hr_withdraw_resignation`, `hr_my_lifecycle`/`hr_exits`), so no data or permission changes are involved. Recommended step **after M10 is integrated** (M10 owns its rewrite of `MyHrRequestsPage.jsx`): replace `<ResignationSection employeeId={me} />` with a small card linking to `/employee/resignation`. Keep `/employee/requests` and both redirects. I haven't made this edit, to avoid touching a file another module is changing.

## 9. Deployment prerequisites (dev project first; live only with owner approval)
1. Integrate in this order: M2 (118) and M3 (120) are already on Intern. Then apply `module4-integration-rebased.patch`, re-reading `HrApp.jsx` / `EmployeeApp.jsx` first in case other modules landed in between.
2. In the Intern tree run `node scripts/hr-db-test.mjs` (expect 22/22) and `--seed`.
3. On the **dev** project: apply migration 130 with `scripts/hr-db-apply.mjs`, which refuses the live project ref.
   - The migration creates a trigger on `storage.objects` (as M9 does), which needs a role that owns or can alter `storage.objects` (the Supabase `postgres` role in the SQL editor / migration runner).
4. Redeploy the `hr-revoke-exit-access` Edge Function. The service role key stays server-side.
5. Assign `exit.clearance_it` and `exit.override` (§6) and make sure at least two payroll approvers exist.
   - **Keep `hr_private` and `hr_lifecycle_internal` out of the Data API's exposed schemas** (Dashboard → API settings / `[api] schemas` in config). Exposing either would make internal helpers callable from browsers. Also confirm pg_graphql does not reflect them (default search_path only).
6. Review the `hr_settings.lifecycle` values: `resignation_withdrawal`, `access_revocation_timing`, `probation_reminder_days`, `default_onboarding_template`.
7. Deploy the frontend.
8. Run signed-in end-to-end checks per role on dev: HR, manager, IT, payroll preparer, payroll approver, employee.
9. Decide on the scheduler (§7) and on M7 settlement coverage (§3) before go-live.

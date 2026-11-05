# Module 11 Asset Allocation — integration report (for review)

* **Integration worktree:** `D:\Projects\zyllo-tech-website-intern-int11`, branch `hrms/integration-m11` (new), based on
  `99fa9b5`. **No commit, push, merge or deploy.** No shared database reset, no Supabase connection.
* **Untouched:** `Intern` checkout (still 45 status entries), the original Module 11 worktree and every other
  session's worktree (read only).
* **Contents:** current `Intern` (Modules 2/3) + Module 4 (rebased patch snapshot) + Module 9 + Module 11 + the
  integration changes below.

## 1. How the tree was assembled

| Source | Method | Notes |
|---|---|---|
| `Intern` | exact copy of every modified/untracked file | verified identical before any change |
| Module 4 | `module4-integration-rebased.patch`, snapshot **15:53, sha256 `c12f3083a8327854…`** (`git apply --check` clean) | M4 changed 130 again at 15:43 (helpers moved to `hr_lifecycle_internal`); the tree was **re-synced** to that version. All 25 patched files equal M4's worktree except the 5 intended ones (§3). **Re-sync again if M4 changes after 15:53** (see §8). |
| Module 9 | 3-way merge (base = shared import snapshot, ours = Intern+M4, theirs = M9) of 6 modified files; 26 new files copied | 0 conflicts. One hunk **rejected**: `EmployeeDetail.jsx` "Personal" → "Personal & emergency" was a stale Intern state (M8 has it too), not M9 work; keeping it would undo Module 2. |
| Module 11 | 4 modified files copied (verified untouched by Intern/M4/M9 since the shared baseline) + all new files | `141`, `141` test and `141b` test are **byte-identical** to the M11 worktree. |

Migration order in the tree: 100–118, 120, **129 (M9), 130 (M4), 141, 142, 143**. 141 runs after 129 and 130.

## 2. New migrations (integration)

### 142_hr_asset_lifecycle_gates.sql — Module 4 × Module 11
Row triggers on Module 4's tables, so **130 is not modified and no 130 function is re-created** (the first draft
copied 130's function bodies; that broke as soon as M4 moved its helpers, so it was replaced).
* `hr_onboarding_tasks` (BEFORE UPDATE OF status): an `asset` task linked to an assignment can only become
  `completed` after the joiner acknowledged the handover (or HR/IT confirmed it); pre-141 assignments count if
  `acknowledged_at` is set. Unlinked tasks keep 130's evidence-note rule. `waived` not affected.
* `hr_exit_clearance_items` (BEFORE UPDATE OF status): `asset_return` can only become `completed` **or
  `not_applicable`** when nothing is held or awaiting inspection and — if the leaver ever held equipment — after
  `hr_record_asset_clearance` dated after the latest assignment. `waived` (130's audited `exit.override` exception,
  itself refused while assets are open) not affected. Other items not affected.
* Checked every 130 write path: training auto-sync, revocation note and settlement auto-complete never touch
  asset tasks / `asset_return`.

### 143_hr_asset_cost_clearing.sql — purchase-cost clearing
* Verified first (assertions): omitting the cost keeps it; an explicit `NULL` column write is **ignored**
  (indistinguishable from "not sent" because `hr_assets.purchase_cost` always reads NULL); `0` is stored.
* Added `hr_set_asset_cost(asset, cost)` — `assets.view_cost` only, cost ≥ 0 or NULL to clear, audited through
  `hr_asset_financials`. Legacy column writes unchanged (109/141/141b still pass).
* UI: the edit form sends cost only via this RPC and only when it changed; master-data update never carries cost.

## 3. Cross-module file changes

| File | Owner | Change |
|---|---|---|
| `src/hr/pages/EmployeeDetail.jsx` | M2 | Assets tab gated on `assets.view`/`assets.manage` → `<EmployeeAssetsPanel employeeId={e.id} />` |
| `src/hr/pages/ExitsPage.jsx` | M4 | `<EmployeeAssetsPanel … mode="exit" />` under the clearance checklist (notice period → closed; `assets.*`/`exit.view|manage`); open-assets hint now says "awaiting return inspection" and mentions the sign-off |
| `src/hr/pages/lifecycle/OnboardingPages.jsx` | M4 | linked-equipment hint: completes after the joiner acknowledges |
| `supabase/tests/hr/110_exit.test.sql` | M4 | asset return refused without sign-off; **not applicable refused**; sign-off recorded; then completes |
| `supabase/tests/hr/130_onboarding_exit.test.sql` | M4 | equipment task refused before acknowledgement; joiner acknowledges; then completes |
| `src/lib/hr/assets.js`, `src/hr/pages/AssetsPage.jsx` | M11 | cost via `hr_set_asset_cost` (§2) |
| `scripts/hrms-local/browser-flows-assets.mjs` | M11 | +12 hookup checks (profile tab, manager without tab, exit panel → checklist → refused → sign-off → item completes → refresh) |
| `docs/hrms/module11-integration/apply_m11_hookups.py` | — | idempotent replay of the five M2/M4 edits (anchored, exact-once) |

## 4. Module 9 test failure (129_employee_documents.test.sql:75)
* **Cause:** an earlier 130 sent the `document_uploaded` notification to `documents.manage` holders when the
  document **version row was registered**, before the file existed; 129 notifies when the object lands in storage.
* **Resolution (in M4's current 130, not changed here):** 130's trigger now fires `AFTER INSERT ON storage.objects`
  (`hr-documents`) and, when 129's trigger `hr_documents_object_uploaded` exists, sends no `documents.manage`
  notification (only the onboarding-coordinator notice). Intended behaviour verified by 129's own assertions
  (none before storage, HR notified on landing, no duplicate): **129 passes, 218 assertions**, with 130/141–143.
* **Coupling to keep:** 130 detects M9 by the trigger **name** — renaming it in M9 would re-introduce duplicates.

## 5. Security checks
* **Purchase cost (requirement 8):** no migration from any module (all 32 HR migrations) reads
  `purchase_cost`/`hr_asset_financials` other than 109/141/143; reports (112/116/190), overview, requests (180),
  payroll exit integration (171) expose none. History events carry no cost; audit log needs `audit.view`; REST read of
  `hr_asset_financials` needs `assets.view_cost`; CSV export / detail / form load cost only with the permission.
  Covered by 141b + 143 on the full stack. Caveat: `audit.view` holders see historic cost values in audit rows —
  by default only roles that also hold `assets.view_cost`.
* **Isolation after 160 (requirement 9):** 141b (47 assertions) passes in the all-module rehearsal with 160 applied.
  160 only changes `documents.view_team` for its new leave category; asset categories unaffected.
* **No broad document access added (requirement 11):** 142/143 grant nothing; no role or permission was changed.
  Other worktrees still contain the **pre-141** `AssetsPage.jsx`/`assets.js` (`select *`, cost in the form) — those
  copies must never overwrite the integrated versions in later merges.

## 6. Test results (integration tree unless noted)

| Suite | Result |
|---|---|
| Full SQL regression (27 files) | **27/27 pass, 1,728 assertions** |
| — 141 workflow / 141b security / 142 gates / 143 cost | 129 / 47 / **16** / **15** — all pass |
| — Module 4: 110 exit / 130 onboarding-exit | 64 / 132 — pass with the updated tests |
| — Module 9: 107 / 129 | 71 / 218 — pass |
| — Module 2: 118 | 65 — pass |
| All-module rehearsal (scratch copy; 32 HR migrations incl. 125, 128, 160, 170, 171, 180, 190) | **35/35 pass, 2,550 assertions** (uses M6's 103 and M7's 105 test updates, which belong to those modules) |
| Production build (`vite build`, output outside repo) | pass |
| Node tests (6 files, run individually) | 55/55 pass |
| Browser, isolated harness (`HRMS_LOCAL_INSTANCE=int11`, private TEMP, ports 54395/8195) | legacy assets **16/16**; Module 11 + hookups **55/55**; 0 external requests; 0 page errors |

## 7. Preserved workflows (requirement 10)
Inventory, assignment, transfer, handover, damage, return and employee self-service are exercised by 109 (legacy RPCs),
141, the legacy browser flow and the M11 browser flow — all green on the integrated stack.

## 8. Open items for the reviewer
1. **Module 4 is still changing 130.** Before merging: re-apply M4's latest rebased patch to the M4 files (reset them
   to Intern first), run `python docs/hrms/module11-integration/apply_m11_hookups.py .`, rerun §6. 142 needs no
   change unless M4 renames `hr_onboarding_tasks.status/task_kind/asset_assignment_id` or
   `hr_exit_clearance_items.status/item_key/exit_id`.
2. M4 and M9 should be told about 142 (new rule on their tables) and the updated M4 tests — not done (no messages sent).
3. Remaining limitations unchanged: warranty documents need asset-level documents in M9; an IT role still needs
   `documents.*` to handle employee files until M9 adds asset-scoped access; `browser-flows-2.mjs` needs a timeout.

## 9. Rerun after approval / before merge
```
node scripts/hr-db-test.mjs                       # expect 27/27
node scripts/hr-db-test.mjs --only 14             # 141, 141b, 142, 143
node scripts/hr-db-test.mjs --only 110 ; node scripts/hr-db-test.mjs --only 130 ; node scripts/hr-db-test.mjs --only 129
for t in tests/*.test.mjs; do node --test "$t"; done
npx vite build --outDir <tmp>
HRMS_LOCAL_INSTANCE=<name> TEMP=<private> TMP=<private> node scripts/hrms-local/start.mjs --port-api <free> --port-web <free>
node scripts/hrms-local/browser-flows-assets.mjs --state <private>/zyllo-hrms-local-<name>.json     # expect 55/55
timeout 300 node scripts/hrms-local/browser-flows-2.mjs --state <…> --only assets                   # expect 16/16
```

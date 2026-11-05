#!/usr/bin/env python3
"""Module 11 integration hookups in files owned by Modules 2 and 4.

Re-run after re-applying an updated Module 2 / Module 4 change set:

    python docs/hrms/module11-integration/apply_m11_hookups.py [repo_root]

Every edit must match its anchor exactly once (otherwise the script stops
without writing that file). Already-applied edits are detected and skipped,
so the script is idempotent. Line endings of each file are preserved.
"""
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")

EDITS = {
    # ---- Module 2: Assets tab in the employee profile -------------------------
    "src/hr/pages/EmployeeDetail.jsx": [
        ('import { ChangeAssignmentModal, EmployeeDocumentsSection, EmploymentTimeline, LifecycleCard, ReportingSection } from "@/hr/components/EmployeeProfileSections";',
         'import { ChangeAssignmentModal, EmployeeDocumentsSection, EmploymentTimeline, LifecycleCard, ReportingSection } from "@/hr/components/EmployeeProfileSections";\n'
         'import EmployeeAssetsPanel from "@/hr/components/EmployeeAssetsPanel";'),
        ('  const canDocs = ["documents.view", "documents.view_team", "documents.manage"].some((p) => hasPermission(p));',
         '  const canDocs = ["documents.view", "documents.view_team", "documents.manage"].some((p) => hasPermission(p));\n'
         '  const canAssets = ["assets.view", "assets.manage"].some((p) => hasPermission(p));   // Module 11'),
        ('        ...(canExit ? [{ value: "exit", label: "Exit" }] : []),',
         '        ...(canAssets ? [{ value: "assets", label: "Assets" }] : []),\n        ...(canExit ? [{ value: "exit", label: "Exit" }] : []),'),
        ('      {tab === "exit" && <ExitTab employee={e} />}',
         '      {tab === "assets" && canAssets && <EmployeeAssetsPanel employeeId={e.id} />}\n      {tab === "exit" && <ExitTab employee={e} />}'),
    ],
    # ---- Module 4: asset clearance panel on the exit case ----------------------
    "src/hr/pages/ExitsPage.jsx": [
        ('import { useEmployeeOptions } from "@/lib/hr/org";',
         'import { useEmployeeOptions } from "@/lib/hr/org";\nimport EmployeeAssetsPanel from "@/hr/components/EmployeeAssetsPanel";   // Module 11'),
        ('  if (!q.data?.length) return <p className="text-xs font-semibold text-emerald-700">No assets are assigned to this employee.</p>;',
         '  if (!q.data?.length) return <p className="text-xs font-semibold text-emerald-700">No assets are held or awaiting return inspection. If the employee ever held equipment, record the asset clearance in the Asset clearance panel before completing this item.</p>;'),
        ('      <p className="font-semibold">{q.data.length} asset(s) still assigned — record their return in Assets first:</p>',
         '      <p className="font-semibold">{q.data.length} asset(s) still assigned or awaiting return inspection — receive, inspect and complete their returns first:</p>'),
        ('          </Card>\n        </div>\n        <div className="flex flex-col gap-4">\n        <Card title="Full & final settlement">',
         '          </Card>\n'
         '          {["notice_period", "clearance", "final_settlement", "closed"].includes(x.status)\n'
         '            && ["assets.view", "assets.manage", "exit.view", "exit.manage"].some((p) => hasPermission(p)) && (\n'
         '            <EmployeeAssetsPanel employeeId={x.employee_id} exitId={x.id} mode="exit" />   /* Module 11: returns, inspection, clearance sign-off */\n'
         '          )}\n'
         '        </div>\n        <div className="flex flex-col gap-4">\n        <Card title="Full & final settlement">'),
    ],
    # ---- Module 4: onboarding equipment task hint ------------------------------
    "src/hr/pages/lifecycle/OnboardingPages.jsx": [
        ('{task.asset_assignment_id ? "Equipment linked from Assets." : "Training linked; completes with the training."}',
         '{task.asset_assignment_id ? "Equipment linked from Assets. Can be completed once the joiner acknowledges the handover in My Assets." : "Training linked; completes with the training."}'),
    ],
    # ---- Module 4 tests: new requirements from migration 142 -------------------
    "supabase/tests/hr/110_exit.test.sql": [
        ("select public.hr_return_asset(pg_temp.id('asg'), 'good');\n"
         "select public.hr_complete_clearance_item(pg_temp.item('x1','asset_return'), 'completed', 'Laptop returned');\n",
         "select public.hr_return_asset(pg_temp.id('asg'), 'good');\n"
         "-- [142] returns inspected and completed, but the Module 11 asset-clearance sign-off is still required\n"
         "select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('x1','asset_return'), 'completed', 'Laptop returned')$q$,\n"
         "  'asset return needs the asset-clearance sign-off (142)', 'Record the asset clearance');\n"
         "select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('x1','asset_return'), 'not_applicable', 'n/a')$q$,\n"
         "  'not applicable cannot bypass the asset-clearance sign-off (142)', 'Record the asset clearance');\n"
         "select public.hr_record_asset_clearance(pg_temp.id('emp1'), pg_temp.id('x1'), 'Laptop returned and inspected');\n"
         "select public.hr_complete_clearance_item(pg_temp.item('x1','asset_return'), 'completed', 'Laptop returned');\n"),
    ],
    "supabase/tests/hr/130_onboarding_exit.test.sql": [
        ("select public.hr_link_onboarding_task(pg_temp.task('case', 'Equipment allocation'), pg_temp.id('lap'));\n"
         "select public.hr_complete_onboarding_task(pg_temp.task('case', 'Equipment allocation'));\n",
         "select public.hr_link_onboarding_task(pg_temp.task('case', 'Equipment allocation'), pg_temp.id('lap'));\n"
         "-- [142] the linked equipment counts only after the joiner acknowledged the handover\n"
         "select test.throws($q$select public.hr_complete_onboarding_task(pg_temp.task('case', 'Equipment allocation'))$q$,\n"
         "  'equipment task waits for the handover acknowledgement (142)', 'not acknowledged the equipment handover');\n"
         "select pg_temp.as_k('join');\n"
         "select public.hr_acknowledge_asset(pg_temp.id('lap'));\n"
         "select pg_temp.as_k('hr');\n"
         "select test.eq((select status from public.hr_asset_handovers where assignment_id = pg_temp.id('lap')), 'acknowledged', 'joiner acknowledged the handover (141)');\n"
         "select public.hr_complete_onboarding_task(pg_temp.task('case', 'Equipment allocation'));\n"),
    ],
}

failed = False
for rel, edits in EDITS.items():
    p = ROOT / rel
    raw = p.read_bytes().decode("utf-8")
    nl = "\r\n" if "\r\n" in raw else "\n"
    text = raw.replace("\r\n", "\n")
    changed = 0
    for old, new in edits:
        if text.count(new) == 1 and (old not in new or text.count(old) == text.count(new)):
            continue                                   # already applied
        n = text.count(old)
        if n != 1:
            print(f"FAIL  {rel}: anchor found {n}x: {old[:70]!r}")
            failed = True
            break
        text = text.replace(old, new); changed += 1
    else:
        if changed:
            p.write_bytes(text.replace("\n", nl).encode("utf-8"))
        print(f"ok    {rel}: {changed} edit(s) applied, {len(edits) - changed} already present")
sys.exit(1 if failed else 0)

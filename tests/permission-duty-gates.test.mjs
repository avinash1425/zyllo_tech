// Run with: npm test
// Source checks: UI gates match the server-side permission split of
// migrations 209 (payroll duties) and 210 (helpdesk.hr). The server is the
// real control; these keep the buttons and routes from drifting.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const line = (src, needle) => src.split(/\r?\n/).find((l) => l.includes(needle)) ?? "";

test("finalize and whole-run paid buttons use their own payroll duties", () => {
  const src = read("src/hr/pages/PayrollPage.jsx");
  assert.match(src, /const canFinalize = hasPermission\("payroll\.finalize"\)/);
  assert.match(src, /const canRecordPay = hasPermission\("payroll\.payments_record"\)/);
  assert.match(line(src, 'setAction("finalize")'), /canFinalize && run\.status === "approved"/);
  assert.match(line(src, 'setAction("paid")'), /canRecordPay && run\.status === "finalized"/);
  assert.doesNotMatch(line(src, 'setAction("finalize")'), /canApprove/);
});

test("payment recording and reconciliation are separate UI duties", () => {
  const src = read("src/hr/pages/payroll/PaymentsTab.jsx");
  assert.match(src, /const canRecord = hasPermission\("payroll\.payments_record"\)/);
  assert.match(src, /const canReconcile = hasPermission\("payroll\.payments_reconcile"\)/);
  assert.match(line(src, 'mode: "record"'), /\{canRecord && /);
  assert.match(line(src, 'mode: "reconcile"'), /\{canReconcile && /);
  assert.doesNotMatch(src, /payroll\.approve/);
});

test("settlement payment and coverage use payroll.settlement_pay", () => {
  assert.match(line(read("src/hr/pages/lifecycle/SettlementPages.jsx"), 'setDialog("paid")'), /payroll\.settlement_pay/);
  assert.match(read("src/hr/pages/payroll/CorrectionsTab.jsx"), /const canRecord = hasPermission\("payroll\.settlement_pay"\)/);
});

test("payroll route admits every payroll duty", () => {
  const route = line(read("src/hr/HrApp.jsx"), 'path: "payroll"');
  for (const k of ["payroll.view", "payroll.approve", "payroll.finalize", "payroll.payments_record", "payroll.payments_reconcile", "payroll.settlement_pay"]) {
    assert.ok(route.includes(`"${k}"`), `payroll route includes ${k}`);
  }
});

test("helpdesk.hr reaches the helpdesk only, never the requests module or category settings", () => {
  const app = read("src/hr/HrApp.jsx");
  assert.ok(line(app, 'path: "helpdesk"').includes('"helpdesk.hr"'), "helpdesk route admits helpdesk.hr");
  assert.ok(!line(app, 'path: "requests"').includes("helpdesk.hr"), "requests route does not admit helpdesk.hr");
  assert.ok(!read("src/hr/settingsExtensions.jsx").includes("helpdesk.hr"), "no settings page for helpdesk.hr");
  const page = read("src/hr/pages/HelpdeskPage.jsx");
  assert.match(page, /const DESK_PERMS = \[[^\]]*"helpdesk\.hr"/);
  assert.match(line(page, "const itOnly"), /"helpdesk\.hr"/);
  assert.ok(read("src/employee/EmployeeApp.jsx").includes('"helpdesk.hr"'), "portal shows the HR Operations switch to desk staff");
});

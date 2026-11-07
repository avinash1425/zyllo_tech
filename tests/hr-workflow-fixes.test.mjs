// Run with: npm test
// HR workflow consistency fixes: display helpers, optional (migration-gated)
// settings columns, and source checks for the UI wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { offerResponseBadge, personLabel } from "../src/lib/hr/displayLabels.js";
import { optionalColumnKeys, withOptionalColumns } from "../src/lib/hr/optionalColumns.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("personLabel never prints 'undefined' or 'null'", () => {
  assert.equal(personLabel({ first_name: "Asha", last_name: "Rao", employee_code: "ZT-0002" }), "Asha Rao (ZT-0002)");
  assert.equal(personLabel({ first_name: "Asha", last_name: "Rao" }), "Asha Rao");
  assert.equal(personLabel({ display_name: "Asha R", employee_code: null }), "Asha R");
  assert.equal(personLabel({ display_name: "Asha R", employee_code: "  " }), "Asha R");
  assert.equal(personLabel(null), null);
});

test("offer response is shown next to the Offered stage", () => {
  const sent = { status: "sent", sent_at: "2026-11-01T10:00:00Z", created_at: "2026-11-01T09:00:00Z" };
  assert.equal(offerResponseBadge("offered", [sent]).label, "Awaiting candidate response");
  assert.equal(offerResponseBadge("offered", [{ ...sent, status: "accepted", responded_at: "2026-11-02T00:00:00Z" }]).label, "Offer accepted");
  assert.equal(offerResponseBadge("offered", [{ ...sent, status: "declined", responded_at: "2026-11-02T00:00:00Z" }]).label, "Offer declined");
  // an older accepted offer still wins (it is the one Hire uses)
  assert.equal(offerResponseBadge("offered", [{ status: "accepted", responded_at: "2026-10-01" }, { status: "expired", responded_at: "2026-11-01" }]).label, "Offer accepted");
  // latest of declined / newer sent
  assert.equal(offerResponseBadge("offered", [{ status: "declined", responded_at: "2026-10-01" }, { status: "sent", sent_at: "2026-11-01" }]).label, "Awaiting candidate response");
  assert.equal(offerResponseBadge("offered", [{ status: "draft" }, { status: "withdrawn" }]), null);
  assert.equal(offerResponseBadge("joined", [{ status: "accepted" }]), null);
  assert.equal(offerResponseBadge("offered", []), null);
});

test("optional state_code fields are hidden until the column exists", () => {
  const cfg = { table: "hr_locations", columns: [{ key: "name" }, { key: "state_code", optionalColumn: true }],
    fields: [{ key: "name" }, { key: "state_code", optionalColumn: true }] };
  assert.deepEqual(optionalColumnKeys(cfg), ["state_code"]);
  assert.deepEqual(withOptionalColumns(cfg, false).fields.map((f) => f.key), ["name"]);
  assert.deepEqual(withOptionalColumns(cfg, false).columns.map((f) => f.key), ["name"]);
  assert.equal(withOptionalColumns(cfg, true), cfg);
  const plain = { fields: [{ key: "name" }] };
  assert.equal(withOptionalColumns(plain, false), plain);
});

test("UI wiring: candidates dialog, probation refetch, letter issue, settings refresh", () => {
  const rec = read("src/hr/pages/RecruitmentPage.jsx");
  assert.match(rec, /<CandidatesTab employees=\{employees\.data\} \/>/);
  assert.equal((rec.match(/<AddCandidateModal openings=\{openings\.data\} employees=\{employees\}/g) ?? []).length, 2);
  const prob = read("src/hr/pages/lifecycle/ProbationPage.jsx");
  assert.match(prob, /getProbationReview\(listed\.id\)/);
  const req = read("src/hr/requests/HrWorkflowDetail.jsx");
  assert.match(req, /setModal\(\{ issue: d\.attachment_id \}\)/);
  const settings = read("src/hr/pages/SettingsPage.jsx");
  assert.match(settings, /onChanged=\{org\.reload\}/);
  assert.match(settings, /legal_name: val\.legal_name\.trim\(\)/);
  assert.equal((settings.match(/key: "state_code", label: "State code \(e\.g\. AP\)", optionalColumn: true/g) ?? []).length, 2);
  assert.doesNotMatch(read("src/hr/pages/EmployeeDetail.jsx"), /e\.manager\.employee_code\}\)/);
});

test("migration 205 links policy acknowledgements to the checklist", () => {
  const sql = read("supabase/migrations/205_hr_workflow_consistency_fixes.sql");
  assert.match(sql, /create or replace function hr_lifecycle_internal\.policy_acknowledgements_complete/);
  assert.match(sql, /revoke all on function hr_lifecycle_internal\.policy_acknowledgements_complete\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /create or replace function public\.hr_document_checklist\(p_employee uuid\)/);
  assert.match(sql, /create or replace function hr_lifecycle_internal\.onboarding_missing_documents\(p_employee uuid\)/);
});

// P1b root cause: on the self-referencing hr_employees table, PostgREST reads
// `hr_employees!manager_id(...)` as the REVERSE relationship (direct reports,
// an array). The manager must be embedded through the FK column: `manager:manager_id(...)`.
test("employee queries embed the manager via manager_id (many-to-one), not hr_employees!manager_id", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/lib/hr/employees.js", import.meta.url), "utf8");
  assert.ok(!/hr_employees!manager_id/.test(src), "reverse-relationship hint is back");
  assert.ok(/manager:manager_id\(/.test(src));
});

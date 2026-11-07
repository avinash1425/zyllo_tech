// Run with: npm test
// Benefits Management pure rules (src/hr/benefits/rules.js): eligibility,
// plan years, remaining annual limit, claim transitions / separation of
// duties, claim validation — plus static checks on migration 208.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLAIM_STATUSES, CLAIM_TRANSITIONS, canTransition, claimActions, eligibilitySummary, ineligibilityReason, isEligible, limitError, limitUsage,
  planYearEnd, planYearLabel, planYearStart, validateClaim,
} from "../src/hr/benefits/rules.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const EMP = { status: "active", employment_type: "full_time", joining_date: "2025-01-15", probation_end_date: null, grade_id: "g1", work_location_id: "l1" };
const PLAN = { active: true, eligible_employment_types: null, min_tenure_months: 0, eligible_grade_ids: null, eligible_location_ids: null, allow_during_probation: true };

test("eligibility: open plan, inactive plan, inactive employee", () => {
  assert.equal(ineligibilityReason(PLAN, EMP, "2026-11-07"), null);
  assert.equal(isEligible(PLAN, EMP, "2026-11-07"), true);
  assert.match(ineligibilityReason({ ...PLAN, active: false }, EMP, "2026-11-07"), /inactive/);
  for (const status of ["exited", "archived", "suspended"]) assert.match(ineligibilityReason(PLAN, { ...EMP, status }, "2026-11-07"), /not active/);
  assert.match(ineligibilityReason(null, EMP, "2026-11-07"), /plan not found/);
  assert.match(ineligibilityReason(PLAN, null, "2026-11-07"), /Employee not found/);
});

test("eligibility: employment types (empty list = everyone)", () => {
  assert.match(ineligibilityReason({ ...PLAN, eligible_employment_types: ["part_time"] }, EMP, "2026-11-07"), /full time is not eligible/);
  assert.equal(ineligibilityReason({ ...PLAN, eligible_employment_types: ["full_time", "contract"] }, EMP, "2026-11-07"), null);
  assert.equal(ineligibilityReason({ ...PLAN, eligible_employment_types: [] }, EMP, "2026-11-07"), null);
});

test("eligibility: minimum service measured at the start date (month-end clamp like Postgres)", () => {
  const plan = { ...PLAN, min_tenure_months: 3 };
  const e = { ...EMP, joining_date: "2026-01-31" };
  assert.match(ineligibilityReason(plan, e, "2026-04-29"), /3 months of service/);
  assert.equal(ineligibilityReason(plan, e, "2026-04-30"), null);   // 2026-01-31 + 3 months = 2026-04-30
  assert.match(ineligibilityReason(plan, { ...EMP, joining_date: null }, "2026-11-07"), /months of service/);
});

test("eligibility: grades, locations, probation", () => {
  assert.match(ineligibilityReason({ ...PLAN, eligible_grade_ids: ["g2"] }, EMP, "2026-11-07"), /grade/);
  assert.match(ineligibilityReason({ ...PLAN, eligible_grade_ids: ["g1"] }, { ...EMP, grade_id: null }, "2026-11-07"), /grade/);
  assert.equal(ineligibilityReason({ ...PLAN, eligible_grade_ids: ["g1", "g2"] }, EMP, "2026-11-07"), null);
  assert.match(ineligibilityReason({ ...PLAN, eligible_location_ids: ["l2"] }, EMP, "2026-11-07"), /location/);
  const noProb = { ...PLAN, allow_during_probation: false };
  assert.match(ineligibilityReason(noProb, { ...EMP, status: "probation" }, "2026-11-07"), /probation/);
  assert.match(ineligibilityReason(noProb, { ...EMP, probation_end_date: "2026-12-31" }, "2026-11-07"), /probation/);
  assert.match(ineligibilityReason(noProb, { ...EMP, probation_end_date: "2026-11-07" }, "2026-11-07"), /probation/);   // last probation day
  assert.equal(ineligibilityReason(noProb, { ...EMP, probation_end_date: "2026-11-06" }, "2026-11-07"), null);
  assert.equal(ineligibilityReason(PLAN, { ...EMP, status: "probation" }, "2026-11-07"), null);
});

test("eligibility summary text", () => {
  const s = eligibilitySummary({ ...PLAN, eligible_employment_types: ["full_time"], min_tenure_months: 6, eligible_grade_ids: ["g1"], allow_during_probation: false },
    { grades: [{ id: "g1", name: "G1" }], employmentTypes: [{ code: "full_time", name: "Full-time" }] });
  assert.equal(s, "Full-time · 6+ months of service · Grades: G1 · Not during probation");
  assert.equal(eligibilitySummary(PLAN), "All employment types · Probation allowed");
});

test("plan years", () => {
  assert.equal(planYearStart(4, "2026-11-07"), "2026-04-01");
  assert.equal(planYearStart(4, "2026-03-31"), "2025-04-01");
  assert.equal(planYearStart(4, "2026-04-01"), "2026-04-01");
  assert.equal(planYearStart(1, "2026-01-01"), "2026-01-01");
  assert.equal(planYearStart(1, "2026-12-31"), "2026-01-01");
  assert.equal(planYearStart(4, "bad"), null);
  assert.equal(planYearEnd("2026-04-01"), "2027-03-31");
  assert.equal(planYearEnd("2024-01-01"), "2024-12-31");
  assert.equal(planYearEnd("2023-03-01"), "2024-02-29");
  assert.equal(planYearLabel("2026-04-01"), "2026–27");
  assert.equal(planYearLabel("2026-01-01"), "2026");
  assert.equal(planYearLabel(null), "—");
});

const C = (id, status, amount, approved = null, year = "2026-04-01") => ({ id, status, amount, approved_amount: approved, plan_year_start: year });

test("remaining limit: used = approved + paid, pending = submitted; drafts / returned / rejected / cancelled ignored", () => {
  const claims = [C("a", "approved", 6000, 5500), C("b", "paid_externally", 1000, 1000), C("c", "submitted", 2000), C("d", "draft", 9999),
    C("e", "returned", 9999), C("f", "rejected", 9999), C("g", "cancelled", 9999), C("h", "approved", 700, 700, "2025-04-01")];
  const u = limitUsage(10000, claims, { planYearStart: "2026-04-01" });
  assert.deepEqual(u, { limit: 10000, used: 6500, pending: 2000, remaining: 3500, available: 1500, utilisationPct: 65 });
  assert.equal(limitUsage(10000, claims, { planYearStart: "2026-04-01", excludeId: "c" }).available, 3500);
  assert.equal(limitUsage(5000, [C("a", "approved", 6000, 6000)]).available, 0);   // never negative
  const none = limitUsage(null, claims, { planYearStart: "2026-04-01" });
  assert.equal(none.remaining, null); assert.equal(none.available, null); assert.equal(none.used, 6500);
  assert.equal(limitUsage(100, [C("a", "approved", 0.1, 0.1), C("b", "approved", 0.2, 0.2)]).used, 0.3);   // no float drift
});

test("limit check for a new amount", () => {
  assert.equal(limitError(1500, 1500), null);
  assert.match(limitError(1500.01, 1500), /remaining annual limit/);
  assert.equal(limitError(1e6, null), null);
  assert.match(limitError(0, 100), /greater than zero/);
});

test("claim transitions", () => {
  assert.deepEqual(Object.keys(CLAIM_TRANSITIONS).sort(), [...CLAIM_STATUSES].sort());
  assert.ok(canTransition("draft", "submitted"));
  assert.ok(canTransition("returned", "submitted"));
  assert.ok(canTransition("submitted", "approved"));
  assert.ok(canTransition("approved", "paid_externally"));
  assert.ok(!canTransition("draft", "approved"));
  assert.ok(!canTransition("approved", "rejected"));
  assert.ok(!canTransition("rejected", "submitted"));
  assert.ok(!canTransition("paid_externally", "approved"));
  for (const s of ["rejected", "cancelled", "paid_externally"]) assert.deepEqual(CLAIM_TRANSITIONS[s], []);
});

test("claim actions: claimant vs HR, separation of duties", () => {
  assert.deepEqual(claimActions({ status: "draft" }, { isClaimant: true }), ["edit", "submit", "cancel"]);
  assert.deepEqual(claimActions({ status: "returned" }, { isClaimant: true, canManage: true }), ["edit", "submit", "cancel"]);
  assert.deepEqual(claimActions({ status: "submitted" }, { isClaimant: true }), ["cancel"]);
  // HR holding benefits.manage still cannot decide their own claim.
  assert.deepEqual(claimActions({ status: "submitted" }, { isClaimant: true, canManage: true }), ["cancel"]);
  assert.deepEqual(claimActions({ status: "approved" }, { isClaimant: true, canManage: true }), []);
  assert.deepEqual(claimActions({ status: "submitted" }, { canManage: true }), ["approve", "reject", "return"]);
  assert.deepEqual(claimActions({ status: "approved" }, { canManage: true }), ["record_payment"]);
  assert.deepEqual(claimActions({ status: "submitted" }, { canManage: false }), []);   // benefits.view is read-only
  assert.deepEqual(claimActions({ status: "draft" }, { canManage: true }), []);
  assert.deepEqual(claimActions(null, { canManage: true }), []);
});

test("claim validation", () => {
  const enrollment = { status: "active", start_date: "2026-04-01", end_date: null };
  const ok = { amount: "1500.50", expenseDate: "2026-11-01", description: "Course fee", enrollment, today: "2026-11-07", available: 2000 };
  assert.deepEqual(validateClaim(ok), {});
  assert.ok(validateClaim({ ...ok, amount: "1.234" }).amount);
  assert.ok(validateClaim({ ...ok, amount: "0" }).amount);
  assert.match(validateClaim({ ...ok, amount: "2500" }).amount, /remaining annual limit/);
  assert.deepEqual(validateClaim({ ...ok, amount: "2500", available: null }), {});
  assert.match(validateClaim({ ...ok, expenseDate: "2026-11-08" }).expense_date, /future/);
  assert.match(validateClaim({ ...ok, expenseDate: "2026-03-31" }).expense_date, /before the enrollment/);
  assert.match(validateClaim({ ...ok, enrollment: { ...enrollment, status: "ended", end_date: "2026-10-31" } }).expense_date, /after the enrollment ended/);
  assert.deepEqual(validateClaim({ ...ok, expenseDate: "2026-10-30", enrollment: { ...enrollment, status: "ended", end_date: "2026-10-31" } }), {});
  assert.ok(validateClaim({ ...ok, enrollment: { ...enrollment, status: "cancelled" } }).enrollment);
  assert.ok(validateClaim({ ...ok, enrollment: null }).enrollment);
  assert.ok(validateClaim({ ...ok, description: " a " }).description);
});

test("migration 208: idempotent DDL, no payroll writes, privacy + separation of duties", () => {
  const sql = read("supabase/migrations/208_hr_benefits_module.sql");
  const code = sql.replace(/--[^\n]*/g, "");
  assert.ok(!/^\s*create table (?!if not exists)/im.test(code), "every create table uses if not exists");
  assert.ok(!/^\s*create (unique )?index (?!if not exists)/im.test(code), "every index uses if not exists");
  assert.ok(!/^\s*create policy/im.test(code.replace(/drop policy if exists[^;]+;\s*create policy/gi, "")), "every policy is dropped first");
  assert.ok(!/\bdrop table\b|^\s*truncate\b|\bdelete from\b|\bdrop column\b/im.test(code), "no data is dropped or deleted");
  assert.ok(!/hr_payroll_adjustments|hr_payroll_runs|hr_reimbursements/i.test(code), "no payroll / reimbursement objects are touched");
  assert.ok(!/grant execute on all functions in schema hr_private/i.test(code), "no blanket hr_private grant (197 convention)");
  assert.ok(!/20[67]_/.test(code), "does not depend on 206 / 207");
  assert.match(code, /You cannot decide your own claim/);
  assert.match(code, /You cannot record payment of your own claim/);
  assert.match(code, /You cannot decide your own request/);
  assert.match(code, /remaining annual limit/);
  assert.match(code, /'hr-benefit-claims', 'hr-benefit-claims', false/);
  assert.match(code, /enable_audit\('public\.hr_benefit_claims', array\['amount'/);
  for (const t of ["hr_benefit_categories", "hr_benefit_enrollment_requests", "hr_benefit_dependants", "hr_benefit_claims", "hr_benefit_claim_documents", "hr_benefit_events"]) {
    assert.match(code, new RegExp(`secure_table\\('public\\.${t}'\\)`), `${t} has RLS`);
  }
  assert.match(code, /security definer set search_path = ''/);
});

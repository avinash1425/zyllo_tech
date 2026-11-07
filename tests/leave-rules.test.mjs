// Run with: npm test
// Leave helpers: dashboard "Leave available" total and gender eligibility labels
// (src/lib/hr/leaveRules.js), plus static checks on migration 203.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GENDER_ELIGIBILITY_OPTIONS, genderEligibilityLabel, generalLeaveAvailable, isSpecialLeave } from "../src/lib/hr/leaveRules.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// The ZT-0029 case: 227.75 days shown, 182 of them maternity.
const ZT0029 = [
  { code: "CL", name: "Casual Leave", paid: true, available: 5.5 },
  { code: "SL", name: "Sick Leave", paid: true, available: 6 },
  { code: "EL", name: "Earned Leave", paid: true, available: 15.25 },
  { code: "ML", name: "Maternity Leave", paid: true, available: 182 },
  { code: "PL", name: "Paternity Leave", paid: true, available: 15 },
  { code: "LOP", name: "Loss of Pay", paid: false, available: 4 },
];

test("dashboard total: regular paid leave only", () => {
  assert.equal(generalLeaveAvailable(ZT0029), 26.75);
  assert.equal(generalLeaveAvailable([]), 0);
  assert.equal(generalLeaveAvailable(null), 0);
  assert.equal(generalLeaveAvailable(undefined), 0);
});

test("dashboard total: negative or invalid balances count as 0", () => {
  assert.equal(generalLeaveAvailable([{ code: "CL", paid: true, available: -2 }, { code: "SL", paid: true, available: "3.5" }]), 3.5);
  assert.equal(generalLeaveAvailable([{ code: "CL", paid: true, available: "x" }, { code: "SL", paid: true, available: null }]), 0);
});

test("dashboard total: rounding to 2 decimals", () => {
  assert.equal(generalLeaveAvailable([{ code: "A", paid: true, available: 0.1 }, { code: "B", paid: true, available: 0.2 }]), 0.3);
});

test("special (event-based) leave detection", () => {
  assert.equal(isSpecialLeave({ code: "ML", name: "Anything" }), true);
  assert.equal(isSpecialLeave({ code: "pl", name: "Anything" }), true);
  assert.equal(isSpecialLeave({ code: "MAT", name: "Maternity leave (2026)" }), true);
  assert.equal(isSpecialLeave({ code: "X", name: "Paternity" }), true);
  assert.equal(isSpecialLeave({ code: "BL", name: "Bereavement", eligible_gender: "female" }), true);
  assert.equal(isSpecialLeave({ code: "CL", name: "Casual Leave" }), false);
  assert.equal(isSpecialLeave({ code: "CO", name: "Compensatory Off" }), false);
  assert.equal(isSpecialLeave(null), false);
});

test("gender eligibility labels and options", () => {
  assert.equal(genderEligibilityLabel("female"), "female only");
  assert.equal(genderEligibilityLabel("male"), "male only");
  assert.equal(genderEligibilityLabel(null), "all genders");
  assert.equal(genderEligibilityLabel(""), "all genders");
  assert.deepEqual(GENDER_ELIGIBILITY_OPTIONS.map((o) => o.value), ["", "female", "male"]);
});

test("migration 203: leave decisions recalculate attendance; gender is a maker-checker policy field", () => {
  const sql = read("supabase/migrations/203_hr_leave_attendance_fixes.sql");
  assert.match(sql, /create trigger hr_leave_requests_zz_attendance after insert or update of status, days on public\.hr_leave_requests/);
  // fires after 160's days triggers (name order)
  assert.ok("hr_leave_requests_zz_attendance" > "hr_leave_requests_days_upd");
  assert.match(sql, /'effective_from','effective_to','eligible_gender'\]/);
  assert.match(sql, /eligible_gender = v\.eligible_gender/);
  assert.match(sql, /add column if not exists eligible_gender text check \(eligible_gender in \('female','male'\)\)/);
  // write helpers are not callable through the API
  assert.match(sql, /hr_private\.leave_request_attendance_sync\(\)\s*from public, anon, authenticated/);
  // no data deletes and no direct changes to leave types
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql, /update\s+public\.hr_leave_types\s+set/i);   // only the policy-write path (alias x) updates types
});

test("frontend sends eligible_gender through the policy proposal and uses the business date", () => {
  assert.match(read("src/lib/hr/leave.js"), /"eligible_gender"\]/);
  const page = read("src/hr/leave/LeavePolicies.jsx");
  assert.doesNotMatch(page, /toISOString\(\)\.slice\(0, 10\)/);
  assert.match(page, /businessToday\(useBusinessTimezone\(\)\)/);
});

// Run with: npm test  (Node's built-in test runner, no extra dependencies)
// Payroll pure helpers: employee identity fill for payroll users without
// employees.view (bug 3), add-form prefill, statutory rule form checks (bug 6),
// and static checks on migration 204 / the statutory dialog.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  identityOptions, mergeEmployeeIdentities, mergeOptions, missingEmployeeIds, prefillEmployee, validateStatutoryRule,
} from "../src/lib/hr/payrollHelpers.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const ME = { id: "e-me", employee_code: "ZT-0001", first_name: "Asha", last_name: "Rao", display_name: null, department_id: "d1" };
const IDS = [
  { id: "e2", employee_code: "ZT-0002", first_name: "Ravi", last_name: "K", display_name: null, department_id: "d1", department_name: "Eng", status: "active" },
  { id: "e3", employee_code: "ZT-0003", first_name: "Old", last_name: "Hand", display_name: "Old Hand", department_id: null, department_name: null, status: "exited" },
];

test("rows hidden by hr_employees RLS get the payroll identity; visible ones are kept", () => {
  const rows = [
    { id: "b1", employee_id: "e-me", employee: ME },
    { id: "b2", employee_id: "e2", employee: null },
    { id: "b3", employee_id: "e2", employee: null },
    { id: "b4", employee_id: "e9", employee: null },
  ];
  assert.deepEqual(missingEmployeeIds(rows), ["e2", "e9"]);
  const out = mergeEmployeeIdentities(rows, IDS);
  assert.equal(out[0].employee, ME, "own row unchanged");
  assert.equal(out[1].employee.employee_code, "ZT-0002");
  assert.equal(out[2].employee.first_name, "Ravi");
  assert.equal(out[3].employee, null, "unknown employee stays empty (shown as —)");
  assert.equal("department_name" in out[1].employee, false, "only the embedded shape is exposed");
  assert.equal(rows[1].employee, null, "input not mutated");
  assert.equal(mergeEmployeeIdentities(rows, []), rows);
  assert.deepEqual(missingEmployeeIds(null), []);
});

test("picker options from identities: inactive filtered unless asked, merged without duplicates", () => {
  assert.deepEqual(identityOptions(IDS).map((o) => o.value), ["e2"]);
  assert.deepEqual(identityOptions(IDS, { includeInactive: true }).map((o) => o.label), ["Ravi K (ZT-0002)", "Old Hand (ZT-0003)"]);
  const own = [{ value: "e-me", label: "Asha Rao (ZT-0001)" }, { value: "e2", label: "Ravi K (ZT-0002)", row: { mine: true } }];
  const merged = mergeOptions(own, identityOptions(IDS, { includeInactive: true }));
  assert.deepEqual(merged.map((o) => o.value), ["e-me", "e3", "e2"]);
  assert.deepEqual(merged.find((o) => o.value === "e2").row, { mine: true }, "first list wins");
});

test("add forms never pre-fill the signed-in user from the list filter", () => {
  assert.equal(prefillEmployee("e2", "e-me"), "e2");
  assert.equal(prefillEmployee("e-me", "e-me"), "");
  assert.equal(prefillEmployee("", "e-me"), "");
  assert.equal(prefillEmployee("e2", undefined), "e2");
});

const ESI = { code: "ESI", name: "Employees' State Insurance", effective_from: "2026-04-01", calc_method: "percent_of_wage", eligibility_basis: "gross",
  wage_base_components: ["BASIC", "HRA"], slabs: [], employee_rate: "0.75", employer_rate: "3.25", wage_ceiling: "" };
const PT = { code: "PT", name: "Professional Tax", state_code: "AP", effective_from: "2026-04-01", calc_method: "slab", eligibility_basis: "gross",
  wage_base_components: [], slabs: [{ from: 0, to: 15000, employee_amount: 0 }, { from: 15000.01, to: 20000, employee_amount: 150 }, { from: 20000.01, to: null, employee_amount: 200 }] };

test("statutory rule form: valid rules pass", () => {
  assert.equal(validateStatutoryRule(ESI), null);
  assert.equal(validateStatutoryRule(PT), null);
  assert.equal(validateStatutoryRule({ ...PT, slabs: [{ from: 0, to: 100 }, { from: 100, to: null }] }), null, "touching boundaries allowed");
});

test("statutory rule form: rejects what the server would reject at submit, before saving", () => {
  assert.match(validateStatutoryRule({ ...ESI, wage_base_components: [] }), /earning components that make up the wage base/);
  assert.match(validateStatutoryRule({ ...PT, eligibility_basis: "wage_base" }), /wage base/);
  assert.match(validateStatutoryRule({ ...PT, slabs: [{ from: null }] }), /'from' amount/);
});

test("statutory rule form: rates, amounts and slabs are range-checked", () => {
  assert.match(validateStatutoryRule({ ...ESI, employee_rate: "120" }), /between 0 and 100/);
  assert.match(validateStatutoryRule({ ...ESI, employer_rate: "-1" }), /between 0 and 100/);
  assert.match(validateStatutoryRule({ ...ESI, employee_rate: "abc" }), /between 0 and 100/);
  assert.match(validateStatutoryRule({ ...ESI, wage_ceiling: "-5" }), /ceiling/);
  assert.match(validateStatutoryRule({ ...ESI, calc_method: "fixed", employee_amount: "-1" }), /Fixed amounts/);
  assert.match(validateStatutoryRule({ ...ESI, eligibility_wage_max: "-1" }), /eligibility/);
  assert.match(validateStatutoryRule({ ...PT, slabs: [{ from: 10, to: 5 }] }), /below its 'from'/);
  assert.match(validateStatutoryRule({ ...PT, slabs: [{ from: 0, to: null }, { from: 100, to: 200 }] }), /open-ended/);
  assert.match(validateStatutoryRule({ ...PT, slabs: [{ from: 0, to: 200 }, { from: 100, to: 300 }] }), /overlap/);
  assert.match(validateStatutoryRule({ ...PT, slabs: [{ from: 0, to: 100, employee_amount: -1 }] }), /0 or more/);
  assert.match(validateStatutoryRule({ ...PT, state_code: "Andhra" }), /State/);
  assert.match(validateStatutoryRule({ ...ESI, effective_to: "2026-01-01" }), /Effective-to/);
  assert.match(validateStatutoryRule({ ...ESI, code: "1X" }), /Code/);
});

test("statutory dialog waits for components and companies before showing the form", () => {
  const src = read("src/hr/pages/payroll/StatutoryTab.jsx");
  assert.match(src, /const ready = Boolean\(comps\.data && org\.data\)/);
  assert.match(src, /!ready \? <Loading \/>/);
  assert.match(src, /disabled=\{!ready\}/);
  assert.match(src, /validateStatutoryRule\(v\)/);
});

test("optional-note dialogs actually show their note field", () => {
  const page = read("src/hr/pages/PayrollPage.jsx");
  assert.match(page, /requireReason=\{false\} reasonLabel="Evidence checked \(optional\)"/);
  const s = read("src/hr/pages/payroll/StructuresTab.jsx");
  assert.match(s, /submit: \{[^}]*requireReason: false/);
  assert.match(s, /approve: \{[^}]*requireReason: false/);
});

test("migration 204: identity RPC is narrow; jurisdiction fallback is enrolment -> location -> company", () => {
  const sql = read("supabase/migrations/204_hr_payroll_display_and_pt_fixes.sql");
  assert.match(sql, /function public\.hr_payroll_employee_identities\(p_ids uuid\[\] default null\)/);
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /where hr_private\.has_permission\('payroll\.view'\)/);
  assert.match(sql, /revoke execute on function public\.hr_payroll_employee_identities\(uuid\[\]\) from anon, public;/);
  assert.doesNotMatch(sql, /policy[^;]*on public\.hr_employees/i, "hr_employees RLS untouched");
  assert.doesNotMatch(sql, /grant[^;]*employees\.view/i);
  assert.match(sql, /v_state := coalesce\(v_enr\.state_code, v_loc_state, v_le_state\);/);
  assert.match(sql, /r\.state_code is not null and v_state is distinct from r\.state_code/);
  assert.match(sql, /add column if not exists state_code text/);
  assert.doesNotMatch(sql, /(insert into|update) public\.hr_payroll_statutory_rules/i, "no statutory data changed");
});

// Run with: npm test  (Node's built-in test runner, no extra dependencies)
// One login page (/login) for Website Admin, HR Admin and Employee:
// identifier mapping, post-sign-in routing, ?next= safety, old URLs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { destinationFor, loginEmailFor, safeNext, signInDestination, usableNext } from "../src/hr/platform/account.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// hr_me() payloads as returned by the database
const HR_ADMIN = { permissions: ["employees.view", "dashboard.view"], employee: null, login: null };
const HR_ADMIN_EMPLOYEE = { permissions: ["employees.view"], employee: { id: "e1" }, login: null };
const EMPLOYEE = { permissions: [], employee: { id: "e2" }, login: null };
const MANAGER = { permissions: ["employees.view_team", "dashboard.view_team"], employee: { id: "e3" }, login: null };
const ID_EMPLOYEE = { permissions: [], employee: { id: "e4" }, login: { login_id: "ZT-0007", password_change_required: false } };
const ID_TEMP = { permissions: [], employee: null, login: { login_id: "ZT-0008", password_change_required: true } };
const NOTHING = { permissions: [], employee: null, login: null };

test("email or Employee ID on the same field", () => {
  assert.equal(loginEmailFor("hradmin@zyllotech.com"), "hradmin@zyllotech.com");
  assert.equal(loginEmailFor("ZT-0007"), "zt-0007@staff.zyllotech.com");
  assert.equal(loginEmailFor(" zt-0007 "), "zt-0007@staff.zyllotech.com");
  assert.equal(loginEmailFor("not valid!"), null);
});

test("role-based destination after sign-in", () => {
  assert.equal(signInDestination({ hr: null, isSiteAdmin: true }), "/admin", "Website Admin");
  assert.equal(signInDestination({ hr: NOTHING, isSiteAdmin: true }), "/admin", "Website Admin (HRMS present, no HR role)");
  assert.equal(signInDestination({ hr: HR_ADMIN, isSiteAdmin: false }), "/hr", "HR Admin");
  assert.equal(signInDestination({ hr: HR_ADMIN, isSiteAdmin: true }), "/hr", "HR Admin who is also Website Admin -> /hr (unchanged precedence)");
  assert.equal(signInDestination({ hr: EMPLOYEE, isSiteAdmin: false }), "/employee", "Employee (email)");
  assert.equal(signInDestination({ hr: ID_EMPLOYEE, isSiteAdmin: false }), "/employee", "Employee (Employee ID)");
  assert.equal(signInDestination({ hr: ID_TEMP, isSiteAdmin: false }), "/employee/set-password", "temporary password");
  assert.equal(signInDestination({ hr: MANAGER, isSiteAdmin: false }), "/hr", "manager keeps team access in HR Operations");
  assert.equal(signInDestination({ hr: NOTHING, isSiteAdmin: false }), "/account-pending", "no access");
  assert.equal(destinationFor({ user: null }), "/login");
});

test("?next= honoured only when the account can open it", () => {
  assert.equal(signInDestination({ hr: EMPLOYEE, next: "/employee/leave" }), "/employee/leave");
  assert.equal(signInDestination({ hr: EMPLOYEE, next: "/hr/employees" }), "/employee", "employee cannot open /hr -> own home");
  assert.equal(signInDestination({ hr: HR_ADMIN, next: "/employee" }), "/hr", "HR Admin without employee record -> /hr");
  assert.equal(signInDestination({ hr: HR_ADMIN_EMPLOYEE, next: "/employee" }), "/employee", "HR Admin who is an employee can open /employee");
  assert.equal(signInDestination({ hr: HR_ADMIN, isSiteAdmin: false, next: "/admin/blog" }), "/hr", "/admin only for Website Admins");
  assert.equal(signInDestination({ hr: null, isSiteAdmin: true, next: "/admin/blog" }), "/admin/blog");
  assert.equal(signInDestination({ hr: ID_TEMP, isSiteAdmin: true, next: "/admin" }), "/employee/set-password", "password change first");
  assert.equal(signInDestination({ hr: EMPLOYEE, next: "/contact" }), "/contact", "public pages allowed");
  assert.equal(usableNext("/hr", MANAGER), "/hr");
});

test("no open redirects or login loops", () => {
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/login", "/hr/login?next=/hr", "/employee/login", "", null, undefined]) {
    assert.equal(safeNext(bad), null, String(bad));
  }
  assert.equal(signInDestination({ hr: EMPLOYEE, next: "//evil.example" }), "/employee");
});

test("old login URLs forward to /login", () => {
  const app = read("src/App.jsx");
  assert.match(app, /path="\/hr\/login" element=\{<LegacyLoginRedirect \/>\}/);
  assert.match(app, /path="\/employee\/login" element=\{<Navigate to="\/login\?next=\/employee" replace \/>\}/);
  assert.match(app, /to=\{`\/login\$\{search\}`\}/, "query (?next=, ?reason=) preserved");
  assert.doesNotMatch(app, /HrLoginPage/);
  const guards = read("src/lib/hr/guards.jsx");
  assert.match(guards, /`\/login\?next=/);
  assert.doesNotMatch(guards, /\/hr\/login/);
});

test("the /login page accepts Employee IDs and routes by role", () => {
  const page = read("src/pages/Login.jsx");
  assert.match(page, /Email or Employee ID/);
  assert.match(page, /type="text"/);
  assert.match(page, /id="email"/);
  assert.match(page, /loginEmailFor\(identifier\)/);
  assert.match(page, /resolveSignIn/);
});

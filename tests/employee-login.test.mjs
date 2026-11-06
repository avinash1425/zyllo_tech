// Run with: npm test  (Node's built-in test runner, no extra dependencies)
// Employee ID sign-in: Edge Function core logic with recording fakes (no
// network), account-menu visibility rules, and the exit revocation fix.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  changeOwnPassword, generateTemporaryPassword, manageEmployeeLogin, passwordProblems, sessionIdFromAuthHeader,
} from "../supabase/functions/_shared/employee_login.ts";
import { accountLabelFor, canChangeOwnPassword, employeeLoginIdOf, loginEmailFor } from "../src/hr/platform/account.js";

const EMP = "11111111-1111-4111-8111-111111111111";
const HR_USER = "22222222-2222-4222-8222-222222222222";
const EMP_USER = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

// Recording fake of the supabase-js surface used by the core module.
function fakes({ rpc = {}, auth = {} } = {}) {
  const calls = [];
  const rpcFn = (who) => async (name, args) => {
    calls.push(`${who}.rpc:${name}`);
    const r = rpc[name];
    return typeof r === "function" ? r(args) : (r ?? { data: {}, error: null });
  };
  const authFn = (name, dflt) => async (...args) => {
    calls.push(`admin.auth.${name}`);
    const r = auth[name];
    return typeof r === "function" ? r(...args) : (r ?? dflt);
  };
  const caller = { rpc: rpcFn("caller") };
  const admin = {
    rpc: rpcFn("admin"),
    auth: { admin: {
      createUser: authFn("createUser", { data: { user: { id: EMP_USER } }, error: null }),
      updateUserById: authFn("updateUserById", { data: { user: { id: EMP_USER } }, error: null }),
      deleteUser: authFn("deleteUser", { data: null, error: null }),
    } },
  };
  const verifier = { auth: {
    signInWithPassword: async (creds) => { calls.push("verifier.signIn"); return auth.verify ? auth.verify(creds) : { data: { user: { id: EMP_USER } }, error: null }; },
    signOut: async () => { calls.push("verifier.signOut"); return { error: null }; },
  } };
  return { calls, caller, admin, verifier };
}
const target = (extra = {}) => ({ data: { employee_id: EMP, login_id: "ZT-0007", login_email: "zt-0007@staff.zyllotech.com", user_id: EMP_USER, caller: HR_USER, ...extra }, error: null });

// ------------------------------------------------------------- passwords
test("temporary passwords: 16 chars, all classes, unique, unambiguous", () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const pw = generateTemporaryPassword();
    assert.equal(pw.length, 16);
    assert.match(pw, /[A-Z]/); assert.match(pw, /[a-z]/); assert.match(pw, /\d/); assert.match(pw, /[^A-Za-z0-9]/);
    assert.doesNotMatch(pw, /[0O1lI]/);
    seen.add(pw);
  }
  assert.equal(seen.size, 300);
});

test("password policy", () => {
  assert.deepEqual(passwordProblems("Abcdefghijk1"), []);
  assert.ok(passwordProblems("Short1A").includes("at least 12 characters"));
  assert.ok(passwordProblems("alllowercase12").includes("upper- and lower-case letters"));
  assert.ok(passwordProblems("NoDigitsHereAtAll").includes("a number"));
  assert.ok(passwordProblems("zt-0007Abcdefg1", "ZT-0007").includes("not your Employee ID"));
  assert.ok(passwordProblems("A1a".padEnd(80, "x")).includes("at most 72 characters"));
});

test("session_id is read from a verified access token", () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  assert.equal(sessionIdFromAuthHeader(`Bearer ${b64({ alg: "HS256" })}.${b64({ session_id: SESSION })}.sig`), SESSION);
  assert.equal(sessionIdFromAuthHeader(`Bearer ${b64({})}.${b64({ session_id: "not-a-uuid" })}.sig`), null);
  assert.equal(sessionIdFromAuthHeader("Bearer garbage"), null);
  assert.equal(sessionIdFromAuthHeader(null), null);
});

// ------------------------------------------------------------- HR actions
test("HR actions: input validation and caller authorisation come first", async () => {
  const f = fakes({ rpc: { hr_can_manage_login: { data: null, error: { message: "You are not allowed to manage employee sign-in." } } } });
  assert.equal((await manageEmployeeLogin({ ...f, callerUserId: HR_USER, employeeId: "x", action: "create" })).status, 400);
  assert.equal((await manageEmployeeLogin({ ...f, callerUserId: HR_USER, employeeId: EMP, action: "drop" })).status, 400);
  const r = await manageEmployeeLogin({ ...f, callerUserId: HR_USER, employeeId: EMP, action: "create" });
  assert.equal(r.status, 403);
  assert.deepEqual(f.calls, ["caller.rpc:hr_can_manage_login"], "no service-role call after a refused pre-check");
});

test("HR actions: caller mismatch is refused", async () => {
  const f = fakes({ rpc: { hr_can_manage_login: target({ caller: "99999999-9999-4999-8999-999999999999" }) } });
  const r = await manageEmployeeLogin({ ...f, callerUserId: HR_USER, employeeId: EMP, action: "create" });
  assert.equal(r.status, 403);
  assert.ok(!f.calls.some((c) => c.startsWith("admin.")));
});

test("create: confirmed account, no email, one-time password, linked", async () => {
  let created;
  const f = fakes({ rpc: { hr_can_manage_login: target({ user_id: null }) },
    auth: { createUser: (attrs) => { created = attrs; return { data: { user: { id: EMP_USER } }, error: null }; } } });
  const r = await manageEmployeeLogin({ ...f, callerUserId: HR_USER, employeeId: EMP, action: "create" });
  assert.equal(r.status, 200);
  assert.equal(created.email, "zt-0007@staff.zyllotech.com");
  assert.equal(created.email_confirm, true, "no verification email");
  assert.equal(created.app_metadata.employee_id, EMP);
  assert.equal(r.body.temporary_password, created.password);
  assert.deepEqual(f.calls, ["caller.rpc:hr_can_manage_login", "admin.auth.createUser", "admin.rpc:hr_link_employee_login"]);
});

test("create: link failure removes the new Auth user again", async () => {
  const f = fakes({ rpc: { hr_can_manage_login: target({ user_id: null }), hr_link_employee_login: { data: null, error: { message: "boom" } } } });
  const r = await manageEmployeeLogin({ ...f, callerUserId: HR_USER, employeeId: EMP, action: "create" });
  assert.equal(r.status, 500);
  assert.equal(f.calls.at(-1), "admin.auth.deleteUser");
  assert.equal(r.body.temporary_password, undefined);
});

test("reset: sessions end + change flagged BEFORE the password is replaced", async () => {
  let attrs;
  const f = fakes({ rpc: { hr_can_manage_login: target() }, auth: { updateUserById: (_id, a) => { attrs = a; return { data: {}, error: null }; } } });
  const r = await manageEmployeeLogin({ ...f, callerUserId: HR_USER, employeeId: EMP, action: "reset" });
  assert.equal(r.status, 200);
  assert.deepEqual(f.calls, ["caller.rpc:hr_can_manage_login", "admin.rpc:hr_begin_password_reset", "admin.auth.updateUserById"]);
  assert.equal(attrs.password, r.body.temporary_password);
});

test("reset: if the flag step fails the password is NOT changed", async () => {
  const f = fakes({ rpc: { hr_can_manage_login: target(), hr_begin_password_reset: { data: null, error: { message: "x" } } } });
  const r = await manageEmployeeLogin({ ...f, callerUserId: HR_USER, employeeId: EMP, action: "reset" });
  assert.equal(r.status, 500);
  assert.ok(!f.calls.includes("admin.auth.updateUserById"));
});

test("deactivate: data access + sessions first, then ban", async () => {
  let attrs;
  const f = fakes({ rpc: { hr_can_manage_login: target() }, auth: { updateUserById: (_id, a) => { attrs = a; return { data: {}, error: null }; } } });
  const r = await manageEmployeeLogin({ ...f, callerUserId: HR_USER, employeeId: EMP, action: "deactivate" });
  assert.equal(r.status, 200);
  assert.deepEqual(f.calls, ["caller.rpc:hr_can_manage_login", "admin.rpc:hr_set_employee_login_active", "admin.auth.updateUserById"]);
  assert.equal(attrs.ban_duration, "876000h");
});

test("activate: unban, then enable; re-ban if enabling fails", async () => {
  const bans = [];
  const f = fakes({ rpc: { hr_can_manage_login: target(), hr_set_employee_login_active: { data: null, error: { message: "x" } } },
    auth: { updateUserById: (_id, a) => { bans.push(a.ban_duration); return { data: {}, error: null }; } } });
  const r = await manageEmployeeLogin({ ...f, callerUserId: HR_USER, employeeId: EMP, action: "activate" });
  assert.equal(r.status, 500);
  assert.deepEqual(bans, ["none", "876000h"]);
});

// ------------------------------------------------------------- own password change
const ownLogin = { data: { employee_id: EMP, login_id: "ZT-0007", login_email: "zt-0007@staff.zyllotech.com" }, error: null };
const NEW_PW = "Brand-New-Passw0rd";

test("password change: needs a live session", async () => {
  const f = fakes();
  const r = await changeOwnPassword({ ...f, userId: EMP_USER, sessionId: null, currentPassword: "x", newPassword: NEW_PW });
  assert.equal(r.status, 401);
  assert.deepEqual(f.calls, []);
});

test("password change: weak password refused before anything is verified", async () => {
  const f = fakes({ rpc: { hr_own_login_for_password_change: ownLogin } });
  const r = await changeOwnPassword({ ...f, userId: EMP_USER, sessionId: SESSION, currentPassword: "Temp-1", newPassword: "short" });
  assert.equal(r.status, 400);
  assert.ok(!f.calls.includes("verifier.signIn") && !f.calls.includes("admin.auth.updateUserById"));
});

test("password change: wrong current password changes nothing", async () => {
  const f = fakes({ rpc: { hr_own_login_for_password_change: ownLogin }, auth: { verify: () => ({ data: null, error: { message: "Invalid login credentials" } }) } });
  const r = await changeOwnPassword({ ...f, userId: EMP_USER, sessionId: SESSION, currentPassword: "wrong", newPassword: NEW_PW });
  assert.equal(r.status, 400);
  assert.ok(!f.calls.includes("admin.auth.updateUserById"));
  assert.ok(!f.calls.includes("admin.rpc:hr_complete_own_password_change"));
});

test("password change: verify -> update -> complete, then sign in again", async () => {
  let creds;
  const f = fakes({ rpc: { hr_own_login_for_password_change: ownLogin }, auth: { verify: (c) => { creds = c; return { data: { user: { id: EMP_USER } }, error: null }; } } });
  const r = await changeOwnPassword({ ...f, userId: EMP_USER, sessionId: SESSION, currentPassword: "Temp-Pass-1!", newPassword: NEW_PW });
  assert.equal(r.status, 200);
  assert.equal(r.body.sign_in_again, true);
  assert.equal(creds.email, "zt-0007@staff.zyllotech.com");
  assert.deepEqual(f.calls, ["admin.rpc:hr_own_login_for_password_change", "verifier.signIn", "admin.auth.updateUserById",
    "admin.rpc:hr_complete_own_password_change", "verifier.signOut"]);
});

test("password change: same password and Employee ID in password refused", async () => {
  const f = fakes({ rpc: { hr_own_login_for_password_change: ownLogin } });
  assert.equal((await changeOwnPassword({ ...f, userId: EMP_USER, sessionId: SESSION, currentPassword: NEW_PW, newPassword: NEW_PW })).status, 400);
  assert.equal((await changeOwnPassword({ ...f, userId: EMP_USER, sessionId: SESSION, currentPassword: "x", newPassword: "zt-0007Abcdef1" })).status, 400);
});

// ------------------------------------------------------------- account menu / mapping
test("sign-in mapping: Employee ID -> internal address; email unchanged", () => {
  assert.equal(loginEmailFor("ZT-0007"), "zt-0007@staff.zyllotech.com");
  assert.equal(loginEmailFor("  zt-0007 "), "zt-0007@staff.zyllotech.com");
  assert.equal(loginEmailFor("admin@zyllotech.com"), "admin@zyllotech.com");
  assert.equal(loginEmailFor("bad id!"), null);
  assert.equal(loginEmailFor(""), null);
});

test("account menu: Employee ID accounts see their ID and Change password", () => {
  const hr = { login: { login_id: "ZT-0007" } };
  const user = { email: "zt-0007@staff.zyllotech.com" };
  assert.equal(accountLabelFor({ user, hr }), "Employee ID ZT-0007");
  assert.equal(canChangeOwnPassword(hr), true);
  assert.equal(employeeLoginIdOf(hr), "ZT-0007");
});

test("account menu: email accounts unchanged, no Change password", () => {
  for (const hr of [null, {}, { login: null }, { employee: { id: EMP } }]) {
    assert.equal(accountLabelFor({ user: { email: "hr.admin@zyllotech.com" }, hr }), "hr.admin@zyllotech.com");
    assert.equal(canChangeOwnPassword(hr), false);
  }
});

test("account menu: internal address never shown even without hr_me", () => {
  assert.equal(accountLabelFor({ user: { email: "zt-0007@staff.zyllotech.com" }, hr: null }), "");
});

// ------------------------------------------------------------- exit revocation fix (201)
test("exit revocation: no-op signOut(user_id) removed; sessions ended in SQL", () => {
  const fn = readFileSync(new URL("../supabase/functions/hr-revoke-exit-access/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(fn, /auth\.admin\.signOut\s*\(/);
  assert.match(fn, /hr_record_auth_access_revoked/);
  const sql = readFileSync(new URL("../supabase/migrations/201_hr_exit_session_revocation.sql", import.meta.url), "utf8");
  assert.match(sql, /hr_private\.revoke_user_sessions\(v_user\)/);
  assert.match(sql, /grant execute on function public\.hr_record_auth_access_revoked\(uuid\) to service_role/);
});

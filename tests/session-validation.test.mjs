// Run with: npm test  (Node's built-in test runner, no extra dependencies)
// Migration 202 / sign-out behaviour: static checks of the pieces that the
// database tests (supabase/tests/hr/202_*.test.sql) and the browser tests
// cannot see from their side.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("HRMS sign-out ends this device's session only", () => {
  const auth = read("src/hr/platform/auth.jsx");
  assert.match(auth, /signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(auth, /auth\.signOut\(\)/, "no default (global) sign-out in the HRMS");
});

test("an ended session is cleared locally and explained on the login page", () => {
  const auth = read("src/hr/platform/auth.jsx");
  assert.match(auth, /me\?\.session_ended/);
  assert.match(auth, /setSessionEnded\(true\)/);
  const login = read("src/hr/platform/HrLoginPage.jsx");
  assert.match(login, /data-testid="session-ended"/);
  assert.match(login, /id="hr-email"/); assert.match(login, /id="hr-password"/);
});

test("Website Admin sign-in code is untouched by 202", () => {
  const site = read("src/lib/auth.jsx");
  assert.doesNotMatch(site, /session_ended|caller_session_ok/);
});

test("migration 202: rollback switch, trigger, scoped helpers, re-runnable", () => {
  const sql = read("supabase/migrations/202_hr_employee_session_validation.sql");
  assert.match(sql, /create table if not exists hr_private\.security_flags/);
  assert.match(sql, /revoke all on table hr_private\.security_flags from public, anon, authenticated, service_role/);
  assert.match(sql, /on conflict \(key\) do nothing/, "re-running keeps the switch setting");
  assert.match(sql, /drop trigger if exists hr_employees_revoke_sessions/);
  assert.match(sql, /drop policy if exists hr_notifications_read/);
  // is_admin / admin_users are not redefined
  assert.doesNotMatch(sql, /create or replace function public\.is_admin|on public\.admin_users/i);
});

test("local harness: sessions are real rows and sign-out honours scope", () => {
  const api = read("scripts/hrms-local/api-server.mjs");
  assert.match(api, /insert into auth\.sessions \(id, user_id\)/);
  assert.match(api, /scope === "local" \? `id = /);
  assert.match(api, /session_not_found/);
});

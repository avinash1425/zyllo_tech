// Run with: npm test
// Sign-in failure messages and the one-Supabase-client rule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIGN_IN_MESSAGES as M, isHrBackendMissing, signInFailureMessage } from "../src/hr/platform/account.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const invalid = { status: 400, code: "invalid_credentials", name: "AuthApiError", message: "Invalid login credentials" };

test("wrong password, unknown account and banned account look the same", () => {
  assert.equal(signInFailureMessage({ authError: invalid, identifier: "hradmin@zyllotech.com" }), M.generic);
  assert.equal(signInFailureMessage({ authError: invalid, identifier: "ZT-9999" }), M.generic);
  assert.equal(signInFailureMessage({ authError: { status: 400, code: "user_banned", message: "User is banned" }, identifier: "ZT-0001" }), M.generic);
});

test("rate limit and network errors get their own message", () => {
  assert.equal(signInFailureMessage({ authError: { status: 429 } }), M.rateLimited);
  assert.equal(signInFailureMessage({ authError: { status: 400, message: "Too many sign-in attempts" } }), M.rateLimited);
  assert.equal(signInFailureMessage({ authError: { status: 0, name: "AuthRetryableFetchError" } }), M.network);
  assert.equal(signInFailureMessage({ authError: { status: 503 } }), M.network);
});

test("HRMS missing on the project: config message for Employee IDs only", () => {
  assert.equal(signInFailureMessage({ authError: invalid, hrBackendMissing: true, identifier: "ZT-0001" }), M.hrUnavailable);
  // Website Admins sign in by email on the live project, which has no HRMS.
  assert.equal(signInFailureMessage({ authError: invalid, hrBackendMissing: true, identifier: "a@b.com" }), M.generic);
  assert.ok(signInFailureMessage({ authError: invalid, hrBackendMissing: true, identifier: "a@b.com", dev: true }).includes("dev:hr"));
  assert.ok(!signInFailureMessage({ authError: invalid, hrBackendMissing: false, identifier: "a@b.com", dev: true }).includes("dev:hr"));
});

test("detects PostgREST function-not-found", () => {
  assert.equal(isHrBackendMissing({ code: "PGRST202" }), true);
  assert.equal(isHrBackendMissing({ code: "42501", message: "permission denied for function hr_me" }), false);
  assert.equal(isHrBackendMissing(null), false);
});

test("exactly one createClient call in src (no duplicate GoTrueClient)", () => {
  const hits = [];
  const walk = (d) => readdirSync(d).forEach((f) => {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) return walk(p);
    if (/\.(jsx?|tsx?)$/.test(f) && /\bcreateClient(<[^>]*>)?\(/.test(readFileSync(p, "utf8"))) hits.push(path.relative(root, p));
  });
  walk(path.join(root, "src"));
  const real = hits.filter((h) => !h.endsWith("types.ts"));
  assert.deepEqual(real.map((h) => h.replaceAll("\\", "/")), ["src/integrations/supabase/client.ts"]);
});

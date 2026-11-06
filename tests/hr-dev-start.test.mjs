// Run with: npm test
// scripts/hr-dev/start.mjs must only ever start against the HR development
// project, never production, and never ship a secret key to the browser.
// Uses fake keys only.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HR_DEV_REF, PRODUCTION_REF, mask, parseEnv, validateConfig } from "../scripts/hr-dev/start.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/hr-dev/start.mjs", import.meta.url));
const FAKE_PUB = "sb_publishable_FAKEfakeFAKEfake0123456789";
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const good = () => ({ HR_DEV_PROJECT_REF: HR_DEV_REF, VITE_SUPABASE_URL: `https://${HR_DEV_REF}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_PUB });
const refuses = (cfg, re, opts) => assert.throws(() => validateConfig(cfg, opts), re);

test("a correct HR development configuration is accepted and only browser-safe values are returned", () => {
  const env = validateConfig(good());
  assert.equal(env.VITE_SUPABASE_URL, `https://${HR_DEV_REF}.supabase.co`);
  assert.equal(env.VITE_SUPABASE_PROJECT_ID, HR_DEV_REF);
  assert.equal(env.VITE_SUPABASE_PUBLISHABLE_KEY, FAKE_PUB);
  assert.equal(env.VITE_GA_MEASUREMENT_ID, "");
  assert.deepEqual(Object.keys(env).filter((k) => !k.startsWith("VITE_")), [], "only VITE_ values go to Vite");
});

test("missing variables are named in the error", () => {
  refuses({}, /Missing in the env file: HR_DEV_PROJECT_REF, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY/);
  refuses({ ...good(), VITE_SUPABASE_PUBLISHABLE_KEY: "" }, /Missing in the env file: VITE_SUPABASE_PUBLISHABLE_KEY/);
});

test("the production project is refused wherever it appears", () => {
  refuses({ ...good(), VITE_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }, /PRODUCTION/);
  refuses({ ...good(), HR_DEV_PROJECT_REF: PRODUCTION_REF }, /PRODUCTION/);
  refuses({ ...good(), VITE_SUPABASE_PROJECT_ID: PRODUCTION_REF }, /PRODUCTION/);
  refuses({ ...good(), VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: PRODUCTION_REF }) }, /PRODUCTION|belongs to project/);
});

test("any project other than HR development is refused", () => {
  refuses({ ...good(), HR_DEV_PROJECT_REF: "abcdefghijklmnopqrst" }, /HR_DEV_PROJECT_REF must be/);
  refuses({ ...good(), VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }, /VITE_SUPABASE_URL must be/);
  refuses({ ...good(), VITE_SUPABASE_URL: `http://${HR_DEV_REF}.supabase.co` }, /VITE_SUPABASE_URL must be/);
  refuses({ ...good(), VITE_SUPABASE_URL: "not a url" }, /not a URL/);
  refuses({ ...good(), VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: "abcdefghijklmnopqrst" }) }, /belongs to project/);
});

test("secret / service-role keys never reach the browser", () => {
  refuses({ ...good(), VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_FAKEfakeFAKEfake0123" }, /SECRET key/);
  refuses({ ...good(), VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "service_role", ref: HR_DEV_REF }) }, /"service_role" key/);
  refuses({ ...good(), VITE_EXTRA: "sb_secret_FAKEfakeFAKEfake0123" }, /VITE_EXTRA holds a secret/);
  refuses({ ...good(), VITE_DB: "postgresql://postgres:pw@db.example:5432/postgres" }, /VITE_DB holds a secret/);
  // A database URL outside VITE_ (maintainers' migration tool) is allowed; it is never passed to Vite.
  assert.ok(validateConfig({ ...good(), HR_DEV_DATABASE_URL: "postgresql://x:y@db.example:5432/postgres" }));
});

test("the placeholder and malformed keys are explained", () => {
  refuses({ ...good(), VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_REPLACE_ME" }, /placeholder/);
  refuses({ ...good(), VITE_SUPABASE_PUBLISHABLE_KEY: "hello" }, /must be the project's publishable key/);
  refuses(good(), /--port must be/, { port: 80 });
});

test("parseEnv and mask", () => {
  assert.deepEqual(parseEnv('A=1\n# c\nB="two words"\nexport C=3 # note\n bad line\n'), { A: "1", B: "two words", C: "3" });
  assert.ok(!mask(FAKE_PUB).includes(FAKE_PUB.slice(10)), "mask never prints the whole key");
});

test("CLI: missing file, unsafe file and --check give clear exit codes and messages", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hr-dev-start-"));
  const run = (file, extra = []) => spawnSync(process.execPath, [SCRIPT, "--check", "--config", file, ...extra], { encoding: "utf8" });
  try {
    let r = run(path.join(dir, "absent.env"));
    assert.equal(r.status, 2); assert.match(r.stderr, /Configuration file not found/);

    writeFileSync(path.join(dir, "prod.env"), `HR_DEV_PROJECT_REF=${HR_DEV_REF}\nVITE_SUPABASE_URL=https://${PRODUCTION_REF}.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=${FAKE_PUB}\n`);
    r = run(path.join(dir, "prod.env"));
    assert.equal(r.status, 2); assert.match(r.stderr, /REFUSING TO START: .*PRODUCTION/);

    writeFileSync(path.join(dir, "ok.env"), `HR_DEV_PROJECT_REF=${HR_DEV_REF}\nVITE_SUPABASE_URL=https://${HR_DEV_REF}.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=${FAKE_PUB}\n`);
    r = run(path.join(dir, "ok.env"));
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Configuration OK/);
    assert.ok(!r.stdout.includes(FAKE_PUB), "the key is masked in output");

    r = run(path.join(dir, "ok.env"), ["--port", "8097"]);
    assert.equal(r.status, 0); assert.match(r.stdout, /WARNING: Edge Functions/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

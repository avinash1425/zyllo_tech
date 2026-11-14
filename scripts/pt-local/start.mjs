#!/usr/bin/env node
// LOCAL TEST HARNESS ONLY — runs the website admin (with Project Tracker)
// against a throwaway local PostgreSQL cluster through a local Supabase
// stand-in. Never contacts any Supabase project.
//
//   node scripts/pt-local/start.mjs [--port-api 54331] [--port-web 8093] [--no-seed] [--vault-test-double] [--new-jwt-secret]
//
// --auth-upstream hr-dev  : sign-in (only) for non-synthetic emails is forwarded to the HRMS dev Supabase project
//                           whiclllqgxxqhufkduuo (public URL + publishable key read from .env.hr.local). Its tokens
//                           are verified with the project's public key; admin rights come from that project's own
//                           is_admin(). Project Tracker data stays in the local database. Never the live project.
// --auth-upstream mock    : the same, against scripts/pt-local/mock-upstream-auth.mjs (synthetic users) for tests.
//
// Sessions survive restarts, as on real Supabase: the local token-signing secret is kept in the OS temp
// folder (zyllo-pt-local-jwt-secret.txt, local test use only; --new-jwt-secret replaces it) and every
// synthetic user has a fixed ID derived from its email. A browser session from an earlier run therefore
// still verifies; when its refresh token is unknown the client signs out cleanly and shows /login.
//
// --vault-test-double installs a PLAINTEXT stand-in for Supabase Vault (NOT ENCRYPTED) so the
// password Show/Hide/Copy/re-authentication UI can be exercised with synthetic passwords.
// It proves authorization/audit/UI logic only — never encryption. The default (and the
// review instance) keeps password storage disabled, exactly as on a project without a vault.
//
// 1. initdb a temp cluster (OS temp folder) on a free port; apply the shim
//    (Supabase roles/auth/storage + the live admin model), the Project Tracker
//    schema (001) and storage (002), and the harness SQL.
// 2. create synthetic users (passwords hashed in Node; no real accounts).
// 3. start scripts/pt-local/api-server.mjs on 127.0.0.1:<port-api>.
// 4. start a second Vite dev server on 127.0.0.1:<port-web> whose VITE_*
//    variables point at the local API (process env overrides .env), and
//    verify that before reporting ready.
// Ctrl+C (or `node scripts/pt-local/stop.mjs`) stops everything and deletes the cluster.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticPdf } from "./fixture-pdf.mjs";
import { API_LOG_FILE, PG_USER, STATE_FILE, findPgBin, freePort, hashPassword, killTree, lit, makePsql, parseArgs, pidAlive, portIsFree, psqlFileSync, signJwt, sleep } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const opts = parseArgs(process.argv.slice(2), { portApi: "54331", portWeb: "8093", seed: true });
const API_PORT = Number(opts.portApi);
const WEB_PORT = Number(opts.portWeb);
const VAULT_DOUBLE = opts.vaultTestDouble === true;
export const TEST_PASSWORD = "Local-Test-Only-2026!";
const USERS = [
  { email: "pt.manager@example.test", admin: true, ptRole: "manager" },
  { email: "pt.editor@example.test", admin: true, ptRole: null },
  { email: "pt.viewer@example.test", admin: true, ptRole: "viewer" },
  { email: "pt.blocked@example.test", admin: true, ptRole: "no_access" },
  { email: "not.admin@example.test", admin: false, ptRole: null },
  // SIMULATED stand-in for the existing website admin info@zyllotech.com: a website admin with no
  // Project Tracker row, made Manager below through the same 010/011 scripts prepared for live.
  // It is NOT the real account and proves nothing about the real login.
  { email: "zyllo.admin.sim@example.test", admin: true, ptRole: null, simulates: "info@zyllotech.com" },
];
const SIM_ADMIN = USERS.find((u) => u.simulates);
/** Fixed synthetic user ID per email (same on every run), formatted as a UUID. */
function userIdFor(email) {
  const h = createHash("sha256").update("zyllo-pt-local-user:" + email.toLowerCase()).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Local token-signing secret, kept across runs (test harness only; never a real project's secret). */
function localJwtSecret() {
  const file = path.join(tmpdir(), "zyllo-pt-local-jwt-secret.txt");
  if (!opts.newJwtSecret) {
    try { const v = readFileSync(file, "utf8").trim(); if (/^[0-9a-f]{64}$/.test(v)) return v; } catch { /* create below */ }
  }
  const v = randomBytes(32).toString("hex");
  writeFileSync(file, v, { mode: 0o600 });
  return v;
}

function fail(msg) { console.error(`\n[pt-local] ${msg}`); process.exitCode = 1; }
if ([API_PORT, WEB_PORT].includes(8080)) { fail("Port 8080 is reserved for the live-site dev server."); process.exit(1); }
if (existsSync(STATE_FILE)) {
  let prev = null;
  try { prev = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { /* ignore */ }
  if (prev && [prev.supervisorPid, prev.apiPid, prev.pgPid].some(pidAlive)) { fail(`A harness is already running (state: ${STATE_FILE}).`); process.exit(1); }
  try { unlinkSync(STATE_FILE); } catch { /* ignore */ }
}
if (!(await portIsFree(API_PORT))) { fail(`Port ${API_PORT} is in use.`); process.exit(1); }
if (!(await portIsFree(WEB_PORT))) { fail(`Port ${WEB_PORT} is in use.`); process.exit(1); }

const bin = findPgBin();
const root = mkdtempSync(path.join(tmpdir(), "zyllo-pt-local-"));
const dataDir = path.join(root, "pgdata");
const storageDir = path.join(root, "storage");
mkdirSync(storageDir, { recursive: true });
const pgPort = await freePort();
const pg = { bin, port: pgPort, user: PG_USER };
const children = { pg: null, api: null, web: null, mock: null };
const LIVE_REF = "zfjeflpvwizlteflypsx";
const HR_DEV_REF = "whiclllqgxxqhufkduuo";
/** Resolve the optional external sign-in target. Only public values (URL + publishable key) are used. */
function upstreamConfig() {
  if (!opts.authUpstream) return null;
  if (opts.authUpstream === "mock") return { name: "mock-upstream (TEST)", mock: true };
  if (opts.authUpstream !== "hr-dev") throw new Error("--auth-upstream must be hr-dev or mock");
  const candidates = [opts.upstreamEnv, path.join(ROOT, ".env.hr.local"), path.resolve(ROOT, "..", "..", "..", ".env.hr.local")].filter(Boolean);
  const file = candidates.find((f) => existsSync(f));
  if (!file) throw new Error(".env.hr.local not found (pass --upstream-env <path>)");
  const vars = Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).map((l) => /^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
  const ref = vars.VITE_SUPABASE_PROJECT_ID, url = vars.VITE_SUPABASE_URL, key = vars.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (ref === LIVE_REF || String(url).includes(LIVE_REF)) throw new Error("refusing: the upstream must not be the live website project");
  if (ref !== HR_DEV_REF || url !== `https://${HR_DEV_REF}.supabase.co`) throw new Error(`refusing: expected project ${HR_DEV_REF}, found ${ref} / ${url}`);
  if (!/^sb_publishable_/.test(String(key))) throw new Error("refusing: only a publishable (public) key may be used for the upstream");
  return { name: `hr-dev Supabase ${HR_DEV_REF}`, url, key, ref };
}
const UPSTREAM = upstreamConfig();
let shuttingDown = false;

function writeState(extra = {}) {
  const state = {
    harness: "zyllo-pt-local (TEST ONLY)", supervisorPid: process.pid, pgPid: children.pg?.pid ?? null, apiPid: children.api?.pid ?? null,
    webPid: children.web?.pid ?? null, pgPort, apiPort: API_PORT, webPort: WEB_PORT, root, dataDir, storageDir, pgBin: path.dirname(bin("psql")),
    apiLog: API_LOG_FILE, startedAt: new Date().toISOString(), password: TEST_PASSWORD, users: USERS.map((u) => u.email),
    passwordBackend: VAULT_DOUBLE ? "test_double (NOT ENCRYPTED)" : "disabled", vaultTestDouble: VAULT_DOUBLE,
    simulatedAdmin: { email: SIM_ADMIN.email, simulates: SIM_ADMIN.simulates, userId: SIM_ADMIN.userId ?? null },
    authUpstream: UPSTREAM ? { name: UPSTREAM.name, url: UPSTREAM.url, mock: Boolean(UPSTREAM.mock) } : null, mockPid: children.mock?.pid ?? null, ...extra,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[pt-local] stopping…");
  if (children.web) killTree(children.web.pid);
  if (children.api) killTree(children.api.pid);
  if (children.mock) killTree(children.mock.pid);
  spawnSync(bin("pg_ctl"), ["-D", dataDir, "-m", "fast", "-w", "-t", "20", "stop"], { stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 40; i++) {
    try { rmSync(root, { recursive: true, force: true }); break; } catch { spawnSync(process.execPath, ["-e", "setTimeout(()=>{},250)"]); }
  }
  try { const s = JSON.parse(readFileSync(STATE_FILE, "utf8")); if (s.supervisorPid === process.pid) unlinkSync(STATE_FILE); } catch { /* ignore */ }
  console.log(`[pt-local] stopped; cluster directory ${existsSync(root) ? "STILL PRESENT: " + root : "deleted"}.`);
  process.exit(code);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(sig, () => shutdown(0));

async function waitFor(fn, { tries = 120, delay = 250, what = "service" } = {}) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return; } catch { /* retry */ }
    await sleep(delay);
  }
  throw new Error(`${what} did not become ready`);
}

try {
  const init = spawnSync(bin("initdb"), ["-D", dataDir, "-U", PG_USER, "-A", "trust", "-E", "UTF8", "--no-locale"], { encoding: "utf8", windowsHide: true });
  if (init.status !== 0) throw new Error("initdb failed:\n" + init.stderr);
  children.pg = spawn(bin("postgres"), ["-D", dataDir, "-p", String(pgPort), "-c", "listen_addresses=127.0.0.1", "-c", "fsync=off", "-c", "timezone=UTC",
    "-c", "max_connections=60"], { stdio: "ignore", windowsHide: true });
  writeState();
  await waitFor(() => spawnSync(bin("pg_isready"), ["-h", "127.0.0.1", "-p", String(pgPort)], { windowsHide: true }).status === 0, { what: "postgres" });

  // Existing website tables (so existing admin/public pages can be smoke-tested);
  // the schema's only extension use is gen_random_uuid(), which is core.
  const websiteSchema = path.join(root, "website_schema.sql");
  writeFileSync(websiteSchema, readFileSync(path.join(ROOT, "supabase/schema/000_full_schema.sql"), "utf8").replace(/^create extension if not exists pgcrypto;.*$/m, ""));
  for (const rel of [
    "supabase/tests/project-tracker/_supabase_local_shim.sql",
    websiteSchema,
    "supabase/tests/project-tracker/website_tables_harness.sql",
    "supabase/project-tracker/001_project_tracker_schema.sql",
    "supabase/project-tracker/002_project_tracker_storage.sql",
    "supabase/project-tracker/003_project_tracker_companies.sql",
    "supabase/project-tracker/004_project_tracker_credentials_documents.sql",
    "supabase/tests/project-tracker/local_harness.sql",
  ]) {
    const r = psqlFileSync(pg, path.isAbsolute(rel) ? rel : path.join(ROOT, rel));
    if (!r.ok) {
      console.log(r.out.split(/\r?\n/).filter((l) => /ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 20).join("\n"));
      throw new Error(`applying ${rel} failed`);
    }
    console.log(`applied  ${path.isAbsolute(rel) ? "supabase/schema/000_full_schema.sql (pgcrypto line removed)" : rel}`);
  }

  // Synthetic users (owner, before the API starts).
  const psql = makePsql(pg);
  for (const u of USERS) {
    const sql = `do $$ declare v uuid; begin
      insert into auth.users (id, email) values (${lit(userIdFor(u.email))}::uuid, ${lit(u.email)}) returning id into v;
      insert into pt_harness.passwords (user_id, password_hash) values (v, ${lit(hashPassword(TEST_PASSWORD))});
      ${u.admin ? "insert into public.user_roles (user_id, role) values (v, 'admin');" : ""}
      ${u.ptRole ? `insert into public.pt_members (user_id, role, note) values (v, ${lit(u.ptRole)}, 'local harness');` : ""}
    end $$;`;
    const r = await psql(sql);
    if (!r.ok) throw new Error(`creating ${u.email} failed: ${r.stderr}`);
  }
  console.log(`[pt-local] created ${USERS.length} synthetic users`);

  // Existing-admin manager bootstrap, exactly as prepared for live: 010 (read-only verify) then 011 (assign by user ID).
  {
    const sql10 = readFileSync(path.join(ROOT, "supabase/project-tracker/010_verify_admin_account.sql"), "utf8")
      .replace("lower(btrim('info@zyllotech.com'))", `lower(btrim('${SIM_ADMIN.email}'))`);
    const f10 = path.join(root, "sim_010.sql");
    writeFileSync(f10, sql10);
    const v = spawnSync(bin("psql"), ["-h", "127.0.0.1", "-p", String(pgPort), "-U", PG_USER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A", "-F", "|", "-f", f10],
      { encoding: "utf8", windowsHide: true });
    const c = (v.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop()?.split("|") || [];
    if (v.status !== 0 || c[1] !== "1" || c[9] !== "t") throw new Error(`010 did not verify the simulated admin: ${v.stderr || c.join("|")}`);
    const f11 = path.join(root, "sim_011.sql");
    writeFileSync(f11, readFileSync(path.join(ROOT, "supabase/project-tracker/011_assign_project_tracker_manager.sql"), "utf8")
      .replace("'PASTE-USER-ID-FROM-010'", `'${c[2]}'`)
      .replace("c_expected_email constant text := 'info@zyllotech.com'", `c_expected_email constant text := '${SIM_ADMIN.email}'`));
    const r11 = psqlFileSync(pg, f11);
    if (!r11.ok) throw new Error(`011 failed for the simulated admin: ${r11.out.slice(0, 500)}`);
    SIM_ADMIN.userId = c[2];
    console.log(`[pt-local] SIMULATED existing admin ${SIM_ADMIN.email} (stands in for ${SIM_ADMIN.simulates}): 010 verified is_admin()=true for user ${c[2]}; 011 made it Project Tracker Manager`);
  }

  // Synthetic demo companies/projects (fictional; local only). --no-seed skips it.
  if (opts.seed !== false) {
    const seed = psqlFileSync(pg, path.join(ROOT, "supabase/tests/project-tracker/demo_seed.sql"));
    if (!seed.ok) {
      console.log(seed.out.split(/\r?\n/).filter((l) => /ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 20).join("\n"));
      throw new Error("applying the demo seed failed");
    }
    const files = await psql("select coalesce(json_agg(json_build_object('bucket', bucket_id, 'name', name)), '[]') from pt_harness.fixture_files;");
    for (const f of JSON.parse(files.stdout.trim() || "[]")) {
      const target = path.join(storageDir, f.bucket, ...f.name.split("/"));
      if (!target.startsWith(storageDir + path.sep)) throw new Error("bad fixture path " + f.name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, syntheticPdf(`Synthetic demo document - ${f.name.split("/").pop()} - fictional data only`));
    }
    console.log("applied  supabase/tests/project-tracker/demo_seed.sql (Company A1/A2/A3 demo data)");
  }

  if (VAULT_DOUBLE) {
    const r = psqlFileSync(pg, path.join(ROOT, "supabase/tests/project-tracker/vault_test_double.sql"));
    if (!r.ok) { console.log(r.out.slice(0, 2000)); throw new Error("installing the vault test double failed"); }
    // Short timers so the browser test can observe auto-hide and re-authentication.
    const e = await psql("update public.pt_settings set passwords_enabled = true, reveal_seconds = 10, reauth_minutes = 1, passwords_enabled_note = 'LOCAL TEST DOUBLE - NOT ENCRYPTED';");
    if (!e.ok) throw new Error(`enabling the test double failed: ${e.stderr}`);
    const b = await psql("select public.pt_password_backend();");
    if (b.stdout.trim() !== "test_double") throw new Error(`expected backend test_double, got ${b.stdout.trim()}`);
    console.log("!!! VAULT TEST DOUBLE INSTALLED — passwords are stored in PLAINTEXT in this throwaway local database. NOT ENCRYPTED. Synthetic passwords only. !!!");
  } else {
    const b = await psql("select public.pt_password_backend();");
    console.log(`[pt-local] password backend: ${b.stdout.trim()} (no vault available locally; password saving/viewing/copying stays disabled)`);
  }

  const secret = localJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const anonKey = signJwt({ iss: "pt-local", role: "anon", iat: now, exp: now + 60 * 60 * 24 * 30 }, secret);
  const webOrigins = [`http://127.0.0.1:${WEB_PORT}`, `http://localhost:${WEB_PORT}`];
  if (UPSTREAM?.mock) {
    const mockPort = await freePort();
    children.mock = spawn(process.execPath, [path.join(HERE, "mock-upstream-auth.mjs")], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], windowsHide: true, env: { ...process.env, PT_MOCK_UPSTREAM_PORT: String(mockPort) } });
    Object.assign(UPSTREAM, { url: `http://127.0.0.1:${mockPort}`, key: "sb_publishable_mock_upstream_local_only" });
    await waitFor(async () => (await fetch(`${UPSTREAM.url}/__calls`)).ok, { what: "mock upstream" });
  }
  if (UPSTREAM) {
    const j = await (await fetch(`${UPSTREAM.url}/auth/v1/.well-known/jwks.json`, { headers: { apikey: UPSTREAM.key } })).json();
    if (!(j.keys || []).some((k) => k.kty === "EC" && k.alg === "ES256")) console.log("[pt-local] note: upstream publishes no ES256 key; tokens will be verified online via its /auth/v1/user");
    console.log(`[pt-local] external sign-in: ${UPSTREAM.name} (authentication only; all Project Tracker data stays local)`);
  }
  children.api = spawn(process.execPath, [path.join(HERE, "api-server.mjs")], {
    cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], windowsHide: true,
    env: {
      ...process.env, PT_LOCAL_JWT_SECRET: secret, PT_LOCAL_PG_PORT: String(pgPort), PT_LOCAL_PG_BIN: path.dirname(bin("psql")),
      PT_LOCAL_API_PORT: String(API_PORT), PT_LOCAL_STORAGE_DIR: storageDir, PT_LOCAL_ORIGINS: webOrigins.join(","),
      PT_LOCAL_SITE_URL: `http://127.0.0.1:${WEB_PORT}`,
      ...(UPSTREAM ? { PT_LOCAL_UPSTREAM_URL: UPSTREAM.url, PT_LOCAL_UPSTREAM_KEY: UPSTREAM.key, PT_LOCAL_UPSTREAM_NAME: UPSTREAM.name } : {}),
    },
  });
  children.api.on("exit", (code) => { if (!shuttingDown) { console.error(`[pt-local] API server exited (code ${code})`); shutdown(1); } });
  writeState({ anonKey });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${API_PORT}/health`)).ok, { what: "API server" });

  const viteBin = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const viteLog = createWriteStream(path.join(root, "vite.log"));
  children.web = spawn(process.execPath, [viteBin, "--port", String(WEB_PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: {
      ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`, VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
      VITE_SUPABASE_PROJECT_ID: "pt-local", VITE_SITE_URL: `http://127.0.0.1:${WEB_PORT}`, VITE_GA_MEASUREMENT_ID: "",
    },
  });
  children.web.stdout.pipe(viteLog);
  children.web.stderr.pipe(viteLog);
  children.web.on("exit", (code) => { if (!shuttingDown) { console.error(`[pt-local] Vite exited (code ${code})`); shutdown(1); } });
  writeState({ anonKey });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${WEB_PORT}/`)).ok, { what: "Vite", tries: 240 });
  const envModule = await (await fetch(`http://127.0.0.1:${WEB_PORT}/src/lib/env.js`)).text();
  if (!envModule.includes(`http://127.0.0.1:${API_PORT}`) || /supabase\.co/i.test(envModule)) {
    throw new Error("Vite on the test port is not wired to the local API — refusing to continue.");
  }
  writeState({ anonKey, ready: true });
  console.log("\n============== Zyllo Project Tracker LOCAL TEST HARNESS (synthetic data only) ==============");
  console.log(`  Web (test):  http://127.0.0.1:${WEB_PORT}/login  →  /admin/project-tracker`);
  if (UPSTREAM) console.log(`  External sign-in: ${UPSTREAM.name} — other emails sign in there (password never stored); data stays local`);
  console.log(`  API:         http://127.0.0.1:${API_PORT}   (verified: Vite points here, not to Supabase)`);
  console.log(`  Users (password ${TEST_PASSWORD}): ${USERS.map((u) => `${u.email}${u.admin ? ` [admin${u.ptRole ? `, ${u.ptRole}` : u.simulates ? `, manager via 010/011 — SIMULATED stand-in for ${u.simulates}` : ", editor"}]` : " [not admin]"}`).join("; ")}`);
  console.log(`  State: ${STATE_FILE}   Stop: Ctrl+C or node scripts/pt-local/stop.mjs`);
  console.log("=============================================================================================\n");
} catch (e) {
  fail(e.message);
  shutdown(1);
}

#!/usr/bin/env node
// LOCAL TEST HARNESS ONLY — runs the unchanged HRMS frontend against a
// throwaway local PostgreSQL 17 cluster through a local Supabase stand-in.
//
//   node scripts/hrms-local/start.mjs [--port-api 54321] [--port-web 8090] [--no-web] [--db-only]
//
// 1. initdb a temp cluster (os.tmpdir()) on a free port; apply the Supabase
//    shim, public-site schema + policies, every 1NN_hr_*.sql migration, the
//    synthetic dev seed, supabase/tests/hrms-local/local_harness.sql and
//    supabase/tests/hrms-local/local_fixtures.sql.
// 2. start scripts/hrms-local/api-server.mjs on 127.0.0.1:<port-api>
//    (random per-run JWT secret, passed via the child's environment only).
// 3. start a second Vite dev server on 127.0.0.1:<port-web> whose VITE_*
//    variables point at the local API (process env overrides .env).
// Ctrl+C here, or `node scripts/hrms-local/stop.mjs`, stops everything and
// deletes the cluster directory. Never contacts anything but 127.0.0.1.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  API_LOG_FILE, HARNESS_DIR, PG_USER, ROOT, STATE_FILE, TEST_PASSWORD, INVITE_PASSWORD,
  findPgBin, freePort, killTree, makePsql, parseArgs, pidAlive, portIsFree, psqlFileSync, signJwt, sleep,
} from "./lib.mjs";
import { syntheticPdf, syntheticPng } from "./fixture-files.mjs";

const opts = parseArgs(process.argv.slice(2), { portApi: "54321", portWeb: "8090", web: true, dbOnly: false });
const API_PORT = Number(opts.portApi);
const WEB_PORT = Number(opts.portWeb);
const WITH_WEB = opts.web !== false && !opts.dbOnly;
const RESERVED = new Set([8080]); // the live-site dev server — never touched

function fail(msg) { console.error(`\n[hrms-local] ${msg}`); process.exitCode = 1; }

if (RESERVED.has(API_PORT) || RESERVED.has(WEB_PORT)) { fail("Port 8080 is reserved for the live-site dev server."); process.exit(1); }
if (existsSync(STATE_FILE)) {
  let prev = null;
  try { prev = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {}
  if (prev && [prev.supervisorPid, prev.apiPid, prev.pgPid].some(pidAlive)) {
    fail(`A harness is already running (state: ${STATE_FILE}). Stop it with: node scripts/hrms-local/stop.mjs`);
    process.exit(1);
  }
  try { unlinkSync(STATE_FILE); } catch {}
}
if (!opts.dbOnly && !(await portIsFree(API_PORT))) { fail(`Port ${API_PORT} is in use.`); process.exit(1); }
if (WITH_WEB && !(await portIsFree(WEB_PORT))) { fail(`Port ${WEB_PORT} is in use.`); process.exit(1); }

const bin = findPgBin();
const root = mkdtempSync(path.join(tmpdir(), "zyllo-hrms-local-"));
const dataDir = path.join(root, "pgdata");
const storageDir = path.join(root, "storage");
mkdirSync(storageDir, { recursive: true });
const pgPort = await freePort();
const pg = { bin, port: pgPort, user: PG_USER };

const children = { pg: null, api: null, web: null };
let shuttingDown = false;

function writeState(extra = {}) {
  const state = {
    harness: "zyllo-hrms-local (TEST ONLY)",
    supervisorPid: process.pid,
    pgPid: children.pg?.pid ?? null,
    apiPid: children.api?.pid ?? null,
    webPid: children.web?.pid ?? null,
    pgPort, apiPort: opts.dbOnly ? null : API_PORT, webPort: WITH_WEB ? WEB_PORT : null,
    root, dataDir, storageDir, pgBin: path.dirname(bin("psql")),
    apiLog: API_LOG_FILE,
    startedAt: new Date().toISOString(),
    ...extra,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return state;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[hrms-local] stopping…");
  if (children.web) killTree(children.web.pid);
  if (children.api) killTree(children.api.pid);
  spawnSync(bin("pg_ctl"), ["-D", dataDir, "-m", "fast", "-w", "-t", "20", "stop"], { stdio: "ignore", windowsHide: true });
  if (children.pg) { try { children.pg.kill(); } catch {} }
  for (let i = 0; i < 40; i++) {
    try { rmSync(root, { recursive: true, force: true }); break; } catch { spawnSync(process.execPath, ["-e", "setTimeout(()=>{},250)"]); }
  }
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (s.supervisorPid === process.pid) unlinkSync(STATE_FILE);
  } catch {}
  console.log(`[hrms-local] stopped; cluster directory ${existsSync(root) ? "STILL PRESENT: " + root : "deleted"}.`);
  process.exit(code);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(sig, () => shutdown(0));

async function waitFor(fn, { tries = 120, delay = 250, what = "service" } = {}) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return; } catch {}
    await sleep(delay);
  }
  throw new Error(`${what} did not become ready`);
}

try {
  // ---------------------------------------------------------------- cluster
  const init = spawnSync(bin("initdb"), ["-D", dataDir, "-U", PG_USER, "-A", "trust", "-E", "UTF8", "--no-locale"], { encoding: "utf8", windowsHide: true });
  if (init.status !== 0) throw new Error("initdb failed:\n" + init.stderr);
  children.pg = spawn(bin("postgres"), ["-D", dataDir, "-p", String(pgPort), "-c", "listen_addresses=127.0.0.1", "-c", "fsync=off",
    "-c", "timezone=UTC", "-c", "max_connections=120"], { stdio: "ignore", windowsHide: true });
  writeState();
  await waitFor(() => spawnSync(bin("pg_isready"), ["-h", "127.0.0.1", "-p", String(pgPort)], { windowsHide: true }).status === 0, { what: "postgres" });
  console.log(`[hrms-local] postgres ready on 127.0.0.1:${pgPort} (data ${dataDir})`);

  const steps = [
    "supabase/tests/hr/_supabase_local_shim.sql",
    // Base schema: the consolidated dump when the repo has one, otherwise the
    // repo's own (non-HRMS) migrations in filename order.
    ...(existsSync(path.join(ROOT, "supabase/schema/000_full_schema.sql"))
      ? ["supabase/schema/000_full_schema.sql", "supabase/policies/001_rls_for_browser_app.sql"]
      : readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql") && !/^1\d\d_hr_/.test(f)).sort().map((f) => `supabase/migrations/${f}`)),
    ...readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => /^1\d\d_hr_.*\.sql$/.test(f)).sort().map((f) => `supabase/migrations/${f}`),
    "supabase/seed/hr_dev_seed.sql",
    "supabase/tests/hrms-local/local_harness.sql",
    "supabase/tests/hrms-local/local_fixtures.sql",
  ];
  for (const rel of steps) {
    const t0 = Date.now();
    const r = psqlFileSync(pg, path.join(ROOT, rel));
    // Site (non-HRMS) migrations may not all replay on an empty database
    // (some assume columns that exist only on the live project): warn, continue.
    if (!r.ok && /^supabase\/migrations\//.test(rel) && !/^supabase\/migrations\/1\d\d_hr_/.test(rel)) {
      console.log(`WARN     ${rel}  (site migration did not replay on an empty database; HRMS does not need it)`);
      continue;
    }
    if (!r.ok) {
      console.log(`FAILED   ${rel}`);
      console.log(r.out.split(/\r?\n/).filter((l) => /ERROR|FATAL|LINE|CONTEXT|DETAIL|HINT|\^/.test(l)).slice(0, 25).join("\n"));
      throw new Error(`applying ${rel} failed`);
    }
    console.log(`applied  ${rel}  (${Date.now() - t0} ms)`);
  }

  // ------------------------------------------------ fixture storage objects
  const psql = makePsql(pg);
  const files = await psql("select coalesce(json_agg(json_build_object('bucket', bucket_id, 'name', name, 'content', content)), '[]') from hrms_local.fixture_files;");
  if (!files.ok) throw new Error("reading fixture files failed: " + files.stderr);
  const list = JSON.parse(files.stdout.trim() || "[]");
  for (const f of list) {
    const target = path.join(storageDir, f.bucket, ...f.name.split("/"));
    if (!target.startsWith(storageDir + path.sep)) throw new Error("bad fixture path " + f.name);
    mkdirSync(path.dirname(target), { recursive: true });
    const bytes = f.content === "pdf" ? syntheticPdf(`Synthetic test document: ${f.name}`) : f.content === "png" ? syntheticPng() : Buffer.from(f.content, "utf8");
    writeFileSync(target, bytes);
  }
  console.log(`[hrms-local] wrote ${list.length} synthetic storage object(s)`);

  const users = await psql(`select coalesce(json_agg(x order by x.sort, x.email), '[]') from (
      select u.email::text as email,
             coalesce((select string_agg(role_key, '+' order by role_key) from public.hr_user_roles r where r.user_id = u.id), '(none)') as roles,
             (select coalesce(e.display_name, e.first_name || ' ' || e.last_name) from public.hr_employees e where e.user_id = u.id) as employee,
             case when u.email like 'superadmin%' then 0 when u.email like 'hr.%' then 1 when u.email like 'payroll%' then 2 when u.email like 'manager%' then 3
                  when u.email like 'employee%' then 4 when u.email like 'intern%' then 5 else 6 end as sort
      from auth.users u join hrms_local.passwords p on p.user_id = u.id) x;`);
  const userTable = users.ok ? JSON.parse(users.stdout.trim() || "[]") : [];

  if (opts.dbOnly) {
    const state = writeState({ mode: "db-only" });
    console.log(`\n[hrms-local] DB-only mode. psql -h 127.0.0.1 -p ${pgPort} -U ${PG_USER} -d postgres\nState: ${STATE_FILE}`);
    void state;
  } else {
    // ------------------------------------------------------------ API server
    const secret = randomBytes(32).toString("hex");
    const now = Math.floor(Date.now() / 1000);
    const anonKey = signJwt({ iss: "hrms-local", role: "anon", iat: now, exp: now + 60 * 60 * 24 * 365 }, secret);
    const webOrigins = [`http://127.0.0.1:${WEB_PORT}`, `http://localhost:${WEB_PORT}`];
    children.api = spawn(process.execPath, [path.join(HARNESS_DIR, "api-server.mjs")], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
      env: {
        ...process.env,
        HRMS_LOCAL_JWT_SECRET: secret,
        HRMS_LOCAL_PG_PORT: String(pgPort),
        HRMS_LOCAL_PG_BIN: path.dirname(bin("psql")),
        HRMS_LOCAL_API_PORT: String(API_PORT),
        HRMS_LOCAL_STORAGE_DIR: storageDir,
        HRMS_LOCAL_ORIGINS: webOrigins.join(","),
        HRMS_LOCAL_SITE_URL: `http://127.0.0.1:${WEB_PORT}`,
      },
    });
    children.api.on("exit", (code) => { if (!shuttingDown) { console.error(`[hrms-local] API server exited (code ${code})`); shutdown(1); } });
    writeState({ anonKey });
    await waitFor(async () => (await fetch(`http://127.0.0.1:${API_PORT}/health`)).ok, { what: "API server" });
    console.log(`[hrms-local] API ready on http://127.0.0.1:${API_PORT}`);

    // ------------------------------------------------------------ Vite (2nd)
    if (WITH_WEB) {
      const viteBin = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
      if (!existsSync(viteBin)) throw new Error("node_modules/vite is missing (dependencies are not installed).");
      const viteLog = createWriteStream(path.join(root, "vite.log"));
      // Equivalent to `npx vite --port 8090 --strictPort --host 127.0.0.1`, run
      // through node directly (no shell). Process env VITE_* override .env.
      children.web = spawn(process.execPath, [viteBin, "--port", String(WEB_PORT), "--strictPort", "--host", "127.0.0.1"], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          VITE_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`,
          VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
          VITE_SUPABASE_PROJECT_ID: "hrms-local",
          VITE_SITE_URL: `http://127.0.0.1:${WEB_PORT}`,
        },
      });
      children.web.stdout.pipe(viteLog);
      children.web.stderr.pipe(viteLog);
      children.web.on("exit", (code) => { if (!shuttingDown) { console.error(`[hrms-local] Vite exited (code ${code}); see ${path.join(root, "vite.log")}`); shutdown(1); } });
      writeState({ anonKey });
      await waitFor(async () => (await fetch(`http://127.0.0.1:${WEB_PORT}/`)).ok, { what: "Vite", tries: 240 });
      // Prove the second dev server is wired to the local API, not live Supabase.
      // The module that reads VITE_SUPABASE_URL differs per repo.
      const envPath = existsSync(path.join(ROOT, "src/lib/env.js")) ? "/src/lib/env.js" : "/src/integrations/supabase/client.ts";
      const envModule = await (await fetch(`http://127.0.0.1:${WEB_PORT}${envPath}`)).text();
      // src/lib/env.js must not mention supabase.co at all. A client module
      // with a hard-coded fallback URL (src/integrations/supabase/client.ts) is
      // accepted only when Vite injected VITE_SUPABASE_URL=<local API>, which
      // takes precedence over that fallback.
      const injected = new RegExp(`"VITE_SUPABASE_URL"\\s*:\\s*"http://127\\.0\\.0\\.1:${API_PORT}"`).test(envModule);
      const wired = envPath === "/src/lib/env.js"
        ? envModule.includes(`http://127.0.0.1:${API_PORT}`) && !/supabase\.co/i.test(envModule)
        : injected;
      if (!wired) throw new Error("Vite on the test port did not pick up VITE_SUPABASE_URL=http://127.0.0.1:" + API_PORT + " — refusing to continue.");
      console.log(`[hrms-local] Vite ready on http://127.0.0.1:${WEB_PORT} (verified ${envPath} → local API)`);
    }
    writeState({ anonKey });
  }

  // ---------------------------------------------------------------- summary
  console.log("\n================ Zyllo HRMS LOCAL TEST HARNESS (synthetic data only) ================");
  const loginPath = existsSync(path.join(ROOT, "src/hr/platform/HrLoginPage.jsx")) ? "/hr/login" : "/login";
  if (WITH_WEB) console.log(`  Web (test):  http://127.0.0.1:${WEB_PORT}${loginPath}   →  /hr  /employee`);
  if (!opts.dbOnly) console.log(`  API:         http://127.0.0.1:${API_PORT}   (rest/v1, auth/v1, storage/v1, functions/v1)`);
  console.log(`  Postgres:    psql -h 127.0.0.1 -p ${pgPort} -U ${PG_USER} -d postgres`);
  console.log(`  State file:  ${STATE_FILE}`);
  if (!opts.dbOnly) console.log(`  API log:     ${API_LOG_FILE}`);
  console.log("\n  Sign-in accounts (password for all: " + TEST_PASSWORD + ")");
  console.log("  " + "email".padEnd(34) + "roles".padEnd(32) + "employee");
  for (const u of userTable) console.log("  " + u.email.padEnd(34) + u.roles.padEnd(32) + (u.employee ?? "(not linked)"));
  console.log(`\n  Invited accounts (Edge Function stand-in) get the password ${INVITE_PASSWORD}`);
  console.log("  Stop: Ctrl+C here, or  node scripts/hrms-local/stop.mjs");
  console.log("======================================================================================\n");
} catch (e) {
  fail(e.message);
  shutdown(1);
}

#!/usr/bin/env node
// HRMS database test runner (LOCAL ONLY).
//
// Creates a throwaway PostgreSQL cluster in the OS temp directory on a free
// localhost port, applies the Supabase emulation shim, the existing public-site
// schema + policies, every supabase/migrations/1NN_hr_*.sql migration, the
// synthetic dev seed, then runs every supabase/tests/hr/*.test.sql file inside
// its own transaction (rolled back). The cluster is destroyed afterwards.
//
// Never connects to any remote database.
//
// Usage:  node scripts/hr-db-test.mjs [--keep] [--only <substring>] [--seed] [--migrations 100,101]
//   --keep     leave the cluster running and print its connection string
//   --only     run only test files whose name contains the substring

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const keep = args.includes("--keep");
// Default: no seed (module tests build their own fixtures and assume an empty DB).
// --seed: apply supabase/seed/hr_dev_seed.sql and run only the 9xx seed smoke tests.
const withSeed = args.includes("--seed");
const noSeed = !withSeed;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
// --migrations 100,101,103  -> apply only HR migrations whose number is listed
const migrationFilter = args.includes("--migrations") ? new Set(args[args.indexOf("--migrations") + 1].split(",").map((s) => s.trim())) : null;

function findPgBin() {
  const candidates = [process.env.PG_BIN, "C:\\Program Files\\PostgreSQL\\17\\bin", "C:\\Program Files\\PostgreSQL\\16\\bin", "/usr/lib/postgresql/17/bin", "/usr/local/bin", "/usr/bin"].filter(Boolean);
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of candidates) if (existsSync(path.join(dir, `initdb${exe}`))) return (name) => path.join(dir, `${name}${exe}`);
  throw new Error("PostgreSQL binaries not found. Set PG_BIN to the directory containing initdb/postgres/psql.");
}
const bin = findPgBin();

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = mkdtempSync(path.join(tmpdir(), "zyllo-hrms-pg-"));
const port = await freePort();
const USER = "hrms_test";

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", maxBuffer: 1 << 26, ...opts });
  if (r.error) throw r.error;
  return r;
}

let server;
async function start() {
  const init = run(bin("initdb"), ["-D", dataDir, "-U", USER, "-A", "trust", "-E", "UTF8", "--no-locale"]);
  if (init.status !== 0) throw new Error("initdb failed:\n" + init.stderr);
  // Started directly (not via pg_ctl) with stdio ignored so no handles are inherited.
  server = spawn(bin("postgres"), ["-D", dataDir, "-p", String(port), "-c", "listen_addresses=127.0.0.1", "-c", "fsync=off", "-c", "timezone=UTC"], { stdio: "ignore", detached: false });
  for (let i = 0; i < 60; i++) {
    const r = run(bin("pg_isready"), ["-h", "127.0.0.1", "-p", String(port)]);
    if (r.status === 0) return;
    await sleep(250);
  }
  throw new Error("postgres did not become ready");
}

function stop() {
  if (keep) return;
  run(bin("pg_ctl"), ["-D", dataDir, "-m", "immediate", "stop"], { stdio: "ignore" });
  try { server?.kill(); } catch {}
  for (let i = 0; i < 20; i++) { try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { spawnSync(process.execPath, ["-e", "setTimeout(()=>{},250)"]); } }
}

function psqlFile(file, label = path.relative(root, file)) {
  const r = run(bin("psql"), ["-h", "127.0.0.1", "-p", String(port), "-U", USER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", file], { env: { ...process.env, PGOPTIONS: "--client-min-messages=notice" } });
  return { ok: r.status === 0, label, out: (r.stdout || "") + (r.stderr || "") };
}

const results = [];
let failed = false;
try {
  await start();
  const steps = [
    path.join(root, "supabase/tests/hr/_supabase_local_shim.sql"),
    // Base schema: the consolidated dump when present, otherwise the project's
    // own (non-HRMS) migrations in filename order.
    ...(existsSync(path.join(root, "supabase/schema/000_full_schema.sql"))
      ? [path.join(root, "supabase/schema/000_full_schema.sql"), path.join(root, "supabase/policies/001_rls_for_browser_app.sql")]
      : readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql") && !/^[12]\d\d_hr_/.test(f)).sort().map((f) => path.join(root, "supabase/migrations", f))),
    ...readdirSync(path.join(root, "supabase/migrations")).filter((f) => /^[12]\d\d_hr_.*\.sql$/.test(f) && (!migrationFilter || migrationFilter.has(f.slice(0, 3)))).sort().map((f) => path.join(root, "supabase/migrations", f)),
    ...(!noSeed && existsSync(path.join(root, "supabase/seed/hr_dev_seed.sql")) ? [path.join(root, "supabase/seed/hr_dev_seed.sql")] : []),
  ];
  for (const s of steps) {
    const r = psqlFile(s);
    const errLine = r.out.split(/\r?\n/).find((l) => /ERROR|FATAL/.test(l));
    // Site (non-HRMS) migrations may not all replay on an empty database (some
    // assume live-only columns): report them and continue. The shim, HRMS
    // migrations and the seed must apply cleanly.
    const isSiteMigration = /[\\/]supabase[\\/]migrations[\\/]/.test(s) && !/[\\/][12]\d\d_hr_[^\\/]*$/.test(s);
    if (!r.ok && isSiteMigration) { console.log(`WARN     ${r.label} (site migration did not replay: ${errLine?.trim()})`); continue; }
    console.log(`${r.ok ? "applied" : "FAILED "}  ${r.label}`);
    if (!r.ok) { console.log(r.out.split(/\r?\n/).filter((l) => /ERROR|FATAL|LINE|CONTEXT|DETAIL|HINT|\^/.test(l)).slice(0, 15).join("\n") || errLine); failed = true; break; }
  }

  if (!failed) {
    const testDir = path.join(root, "supabase/tests/hr");
    // With --migrations, skip test files whose 3-digit prefix was not applied.
    const files = readdirSync(testDir).filter((f) => f.endsWith(".test.sql") && (!only || f.includes(only))
      && (withSeed ? f.startsWith("9") : !f.startsWith("9"))
      && (!migrationFilter || migrationFilter.has(f.slice(0, 3)))).sort();
    for (const f of files) {
      // Each test file runs in a transaction that is rolled back, so files are independent.
      const wrapped = path.join(dataDir, `wrapped-${f}`);
      writeFileSync(wrapped, `begin;\n\\i '${path.join(testDir, f).replace(/\\/g, "/")}'\nrollback;\n`);
      const r = psqlFile(wrapped, `tests/hr/${f}`);
      const oks = (r.out.match(/NOTICE:\s+ok - /g) || []).length;
      const failLine = r.out.split(/\r?\n/).find((l) => /TEST FAILED|ERROR/.test(l));
      results.push({ file: f, ok: r.ok, assertions: oks, error: r.ok ? null : failLine });
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${f}  (${oks} assertions)${r.ok ? "" : "\n      " + failLine}`);
      if (!r.ok) failed = true;
    }
    const total = results.reduce((n, r) => n + r.assertions, 0);
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} test files passed, ${total} assertions.`);
  }
  if (keep) console.log(`\nCluster kept: postgresql://${USER}@127.0.0.1:${port}/postgres  (data: ${dataDir})`);
} catch (e) {
  console.error(e.message);
  failed = true;
} finally {
  stop();
}
process.exit(failed ? 1 : 0);

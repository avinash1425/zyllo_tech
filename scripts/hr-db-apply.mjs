#!/usr/bin/env node
// Apply HRMS migrations to the ISOLATED DEV Supabase project.
//
// Reads credentials from the untracked file `.env.hr-dev.local`:
//   HR_DEV_DATABASE_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
//   HR_DEV_PROJECT_REF=<dev project ref>
//
// Safety:
//   * refuses to run if the target is the LIVE project (ref in LIVE_REFS, or the
//     ref configured in .env VITE_SUPABASE_URL, which is the production site)
//   * refuses if the URL does not contain HR_DEV_PROJECT_REF
//   * records applied files in hr_meta.applied_migrations and never re-applies
//   * the synthetic seed is applied only with --seed
//
// Usage: node scripts/hr-db-apply.mjs [--with-base] [--seed] [--dry-run]
//   --with-base  also apply supabase/schema/000_full_schema.sql + policies/001
//                (needed once on a brand-new dev project; recruitment depends on it)

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const LIVE_REFS = new Set(["zfjeflpvwizlteflypsx"]);

function readEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const devEnv = readEnv(path.join(root, ".env.hr-dev.local"));
const siteEnv = readEnv(path.join(root, ".env"));
const url = devEnv.HR_DEV_DATABASE_URL;
const ref = devEnv.HR_DEV_PROJECT_REF;
const liveFromEnv = (siteEnv.VITE_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (liveFromEnv) LIVE_REFS.add(liveFromEnv);

function die(msg) { console.error("REFUSING: " + msg); process.exit(2); }
if (!url || !ref) die("create .env.hr-dev.local with HR_DEV_DATABASE_URL and HR_DEV_PROJECT_REF (see docs/hrms/DEPLOYMENT.md).");
if (LIVE_REFS.has(ref)) die(`HR_DEV_PROJECT_REF ${ref} is the LIVE production project.`);
for (const live of LIVE_REFS) if (url.includes(live)) die("HR_DEV_DATABASE_URL points at the LIVE production project.");
if (!url.includes(ref)) die("HR_DEV_DATABASE_URL does not contain HR_DEV_PROJECT_REF; check you are targeting the dev project.");

const pgBin = process.env.PG_BIN || "C:\\Program Files\\PostgreSQL\\17\\bin";
const psql = existsSync(path.join(pgBin, "psql.exe")) ? path.join(pgBin, "psql.exe") : "psql";

function runSql(sqlOrFile, { file = false, quiet = true, tuplesOnly = false } = {}) {
  const a = [url, "-v", "ON_ERROR_STOP=1", "-X", ...(quiet ? ["-q"] : []), ...(tuplesOnly ? ["-t", "-A"] : []), file ? "-f" : "-c", sqlOrFile];
  const r = spawnSync(psql, a, { encoding: "utf8", maxBuffer: 1 << 26 });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const files = [];
if (args.includes("--with-base")) files.push("supabase/schema/000_full_schema.sql", "supabase/policies/001_rls_for_browser_app.sql");
files.push(...readdirSync(path.join(root, "supabase/migrations")).filter((f) => /^1\d\d_hr_.*\.sql$/.test(f)).sort().map((f) => `supabase/migrations/${f}`));
if (args.includes("--seed")) files.push("supabase/seed/hr_dev_seed.sql");

if (args.includes("--dry-run")) { console.log("Would apply (if not yet applied):\n" + files.join("\n")); process.exit(0); }

const boot = runSql("create schema if not exists hr_meta; create table if not exists hr_meta.applied_migrations (file text primary key, applied_at timestamptz not null default now()); revoke all on schema hr_meta from public;");
if (!boot.ok) die("cannot connect / bootstrap:\n" + boot.out.split("\n").slice(0, 5).join("\n"));
const done = new Set(runSql("select file from hr_meta.applied_migrations", { tuplesOnly: true }).out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));

const tmp = mkdtempSync(path.join(tmpdir(), "hr-apply-"));
try {
  for (const f of files) {
    if (done.has(f)) { console.log(`skip     ${f}`); continue; }
    // Each file + its bookkeeping row in ONE transaction.
    const wrapped = path.join(tmp, "apply.sql");
    writeFileSync(wrapped, `begin;\n\\i '${path.join(root, f).replace(/\\/g, "/")}'\ninsert into hr_meta.applied_migrations(file) values ('${f}');\ncommit;\n`);
    const r = runSql(wrapped, { file: true });
    if (!r.ok) { console.error(`FAILED   ${f}\n` + r.out.split(/\r?\n/).filter((l) => /ERROR|LINE|DETAIL|HINT/.test(l)).slice(0, 10).join("\n")); process.exit(1); }
    console.log(`applied  ${f}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

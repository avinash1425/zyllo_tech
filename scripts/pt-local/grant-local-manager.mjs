#!/usr/bin/env node
// LOCAL TEST HARNESS ONLY — make an account a Project Tracker Manager in the LOCAL test database,
// using the same scripts prepared for live: 010 (read-only verification by email → user ID, the
// project's is_admin() evaluated for that ID) then 011 (assignment by user ID, re-verified).
// Nothing is sent to any Supabase project.
//
//   node scripts/pt-local/grant-local-manager.mjs --email someone@example.com
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PG_USER, STATE_FILE, parseArgs } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const opts = parseArgs(process.argv.slice(2), {});
const email = String(opts.email || "").trim();
if (!/^[^@\s'"]+@[^@\s'"]+$/.test(email)) { console.error("usage: grant-local-manager.mjs --email <address>"); process.exit(2); }
const S = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const exe = process.platform === "win32" ? ".exe" : "";
const psql = (file, extra = []) => spawnSync(path.join(S.pgBin, `psql${exe}`), ["-h", "127.0.0.1", "-p", String(S.pgPort), "-U", PG_USER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-q", ...extra, "-f", file],
  { encoding: "utf8", windowsHide: true });

const f10 = path.join(S.root, "grant_010.sql");
writeFileSync(f10, readFileSync(path.join(ROOT, "supabase/project-tracker/010_verify_admin_account.sql"), "utf8")
  .replace("lower(btrim('info@zyllotech.com'))", `lower(btrim('${email}'))`));
const v = psql(f10, ["-t", "-A", "-F", "|"]);
const c = (v.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop()?.split("|") || [];
console.log(`010 (local, read-only): matching_accounts=${c[1]} user_id=${c[2] || "-"} confirmed=${c[3]} is_admin_as_user=${c[9]} current_pt_role=${c[11] || "-"}`);
if (v.status !== 0) { console.error(v.stderr); process.exit(1); }
if (c[1] !== "1") { console.error("Not granted: the account does not exist in the local database (an external account must sign in once first)."); process.exit(1); }
if (c[9] !== "t") { console.error("Not granted: the account is not a website admin (is_admin() = false). Nothing was changed."); process.exit(1); }

const f11 = path.join(S.root, "grant_011.sql");
writeFileSync(f11, readFileSync(path.join(ROOT, "supabase/project-tracker/011_assign_project_tracker_manager.sql"), "utf8")
  .replace("'PASTE-USER-ID-FROM-010'", `'${c[2]}'`)
  .replace("c_expected_email constant text := 'info@zyllotech.com'", `c_expected_email constant text := '${email}'`));
const r = psql(f11);
if (r.status !== 0) { console.error((r.stdout + r.stderr).match(/ERROR:[^\r\n]*/)?.[0] || r.stderr); process.exit(1); }
console.log(`011 (local): ${email} (${c[2]}) is now a Project Tracker Manager in the LOCAL test database only.`);

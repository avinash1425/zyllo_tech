#!/usr/bin/env node
// LOCAL TEST ONLY — Project Tracker database tests.
//
//   node scripts/pt-local/db-test.mjs [--keep]
//
// Creates a throwaway PostgreSQL cluster in the OS temp folder on a free
// port (127.0.0.1 only), applies the Supabase shim, the Project Tracker
// schema (001) and storage (002) files, runs the SQL test suites, then checks
// that re-applying 001 aborts safely and that the rollback (900) removes every
// pt_* object and that 001 + 002 apply cleanly again afterwards.
// Never contacts any Supabase project. Needs PostgreSQL 17 binaries
// (PG_BIN or C:\Program Files\PostgreSQL\17\bin); no contrib extensions.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEEP = process.argv.includes("--keep");
const exe = process.platform === "win32" ? ".exe" : "";
const BIN_DIR = [process.env.PG_BIN, "C:\\Program Files\\PostgreSQL\\17\\bin", "/usr/lib/postgresql/17/bin", "/usr/bin"]
  .filter(Boolean).find((d) => existsSync(path.join(d, `initdb${exe}`)));
if (!BIN_DIR) { console.error("PostgreSQL binaries not found; set PG_BIN."); process.exit(2); }
const bin = (n) => path.join(BIN_DIR, `${n}${exe}`);
const USER = "pt_local";

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const root = mkdtempSync(path.join(tmpdir(), "zyllo-pt-dbtest-"));
const dataDir = path.join(root, "pgdata");
const port = await freePort();

function psqlFile(file) {
  const r = spawnSync(bin("psql"), ["-h", "127.0.0.1", "-p", String(port), "-U", USER, "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", file], {
    encoding: "utf8", maxBuffer: 1 << 26, windowsHide: true,
    env: { ...process.env, PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c client_min_messages=notice" },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}
function psqlSql(sql) {
  const r = spawnSync(bin("psql"), ["-h", "127.0.0.1", "-p", String(port), "-U", USER, "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A", "-c", sql], { encoding: "utf8", windowsHide: true });
  return { ok: r.status === 0, out: ((r.stdout || "") + (r.stderr || "")).trim() };
}

let failures = 0;
let passes = 0;
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) passes++; else failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function stop() {
  spawnSync(bin("pg_ctl"), ["-D", dataDir, "-m", "fast", "-w", "-t", "20", "stop"], { stdio: "ignore", windowsHide: true });
  if (!KEEP) { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } }
}

try {
  const init = spawnSync(bin("initdb"), ["-D", dataDir, "-U", USER, "-A", "trust", "-E", "UTF8", "--no-locale"], { encoding: "utf8", windowsHide: true });
  if (init.status !== 0) throw new Error("initdb failed: " + init.stderr);
  spawn(bin("postgres"), ["-D", dataDir, "-p", String(port), "-c", "listen_addresses=127.0.0.1", "-c", "fsync=off", "-c", "timezone=UTC"],
    { stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 120; i++) {
    if (spawnSync(bin("pg_isready"), ["-h", "127.0.0.1", "-p", String(port)], { windowsHide: true }).status === 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const apply = (rel) => {
    const r = psqlFile(path.join(ROOT, rel));
    record(`apply ${rel}`, r.ok, r.ok ? "" : r.out.split(/\r?\n/).filter((l) => /ERROR|LINE|CONTEXT|DETAIL|\^/.test(l)).slice(0, 12).join(" | "));
    return r;
  };
  apply("supabase/tests/project-tracker/_supabase_local_shim.sql");
  apply("supabase/project-tracker/000_preflight_check.sql");
  apply("supabase/project-tracker/001_project_tracker_schema.sql");
  apply("supabase/project-tracker/002_project_tracker_storage.sql");
  apply("supabase/project-tracker/003_project_tracker_companies.sql");
  apply("supabase/project-tracker/004_project_tracker_credentials_documents.sql");

  // SQL suites: each NOTICE "ok - …" is one assertion; any error stops the suite.
  for (const suite of ["supabase/tests/project-tracker/pt_security_test.sql", "supabase/tests/project-tracker/pt_workflow_test.sql",
    "supabase/tests/project-tracker/pt_company_test.sql", "supabase/tests/project-tracker/pt_credentials_disabled_test.sql",
    "supabase/tests/project-tracker/pt_documents_test.sql", "VAULT_DOUBLE", "supabase/tests/project-tracker/pt_credentials_vault_logic_test.sql"]) {
    if (suite === "VAULT_DOUBLE") {
      // 005 cannot run locally (no real Supabase Vault). Install the labelled plaintext TEST DOUBLE
      // and switch passwords on directly, to exercise the authorization/audit logic only.
      const r005 = psqlFile(path.join(ROOT, "supabase/project-tracker/005_enable_password_vault.sql"));
      record("005 refuses to enable passwords without the real Supabase Vault", !r005.ok && /not installed/.test(r005.out));
      apply("supabase/tests/project-tracker/vault_test_double.sql");
      psqlSql("update public.pt_settings set passwords_enabled = true");
      const on = psqlSql("select public.pt_password_backend()");
      record("passwords switched on against the TEST DOUBLE (logic tests only; not encryption)", on.ok && on.out.includes("test_double"), on.out);
      continue;
    }
    const r = psqlFile(path.join(ROOT, suite));
    const oks = r.out.split(/\r?\n/).filter((l) => /NOTICE:\s+ok - /.test(l));
    for (const l of oks) record(`${path.basename(suite)}: ${l.replace(/.*NOTICE:\s+ok - /, "")}`, true);
    if (!r.ok) {
      const err = r.out.split(/\r?\n/).filter((l) => /ERROR|CONTEXT|LINE|DETAIL/.test(l)).slice(0, 10).join(" | ");
      record(`${path.basename(suite)}: suite completed`, false, err);
    } else {
      record(`${path.basename(suite)}: suite completed (${oks.length} assertions)`, true);
    }
  }

  // ---------------------------------------------------------------- existing-admin verification (010) + manager assignment (011)
  // Runs the real script files; only the email / user-ID placeholders are substituted.
  {
    const SQL10 = readFileSync(path.join(ROOT, "supabase/project-tracker/010_verify_admin_account.sql"), "utf8");
    const SQL11 = readFileSync(path.join(ROOT, "supabase/project-tracker/011_assign_project_tracker_manager.sql"), "utf8");
    const runText = (name, text) => { const f = path.join(root, name); writeFileSync(f, text); return psqlFile(f); };
    const run10 = (email) => {
      const f = path.join(root, "v10.sql");
      writeFileSync(f, SQL10.replace("lower(btrim('info@zyllotech.com'))", "lower(btrim('" + email + "'))"));
      const r = spawnSync(bin("psql"), ["-h", "127.0.0.1", "-p", String(port), "-U", USER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A", "-F", "|", "-f", f],
        { encoding: "utf8", windowsHide: true });
      const line = (r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";
      const c = line.split("|");
      return { ok: r.status === 0, err: r.stderr, count: c[1], id: c[2], confirmed: c[3], banned: c[4], deleted: c[5], isAdmin: c[9], ptRole: c[11] };
    };
    const run11 = (id, email) => runText("v11.sql", SQL11.replace("'PASTE-USER-ID-FROM-010'", "'" + id + "'").replace("c_expected_email constant text := 'info@zyllotech.com'", "c_expected_email constant text := '" + email + "'"));
    const one = (sql) => psqlSql(sql).out;
    const mk = (email, admin) => one("select test.make_user('" + email + "', " + admin + ")");
    const adminId = mk("sim.existing.admin@example.test", true);
    const plainId = mk("sim.not.admin@example.test", false);
    const unconfId = mk("sim.unconfirmed.admin@example.test", true);
    const bannedId = mk("sim.banned.admin@example.test", true);
    one("update auth.users set email_confirmed_at = null where id = '" + unconfId + "'");
    one("update auth.users set banned_until = now() + interval '1 day' where id = '" + bannedId + "'");
    const authBefore = one("select md5(string_agg(to_jsonb(u)::text, '' order by id)) || ':' || count(*) from auth.users u");
    const rolesBefore = one("select md5(coalesce(string_agg(user_id::text || role::text, ',' order by user_id, role), '')) from public.user_roles");
    const membersBefore = one("select md5(coalesce(string_agg(user_id::text || role, ',' order by user_id), '')) from public.pt_members");

    const v = run10("Sim.Existing.Admin@example.test");
    record("010 (read-only) finds exactly one account and its authenticated user ID", v.ok && v.count === "1" && v.id === adminId, v.ok ? v.count + " " + v.id : v.err);
    record("010 reports confirmed, not banned, not deleted", v.confirmed === "t" && v.banned === "f" && v.deleted === "f");
    record("010 evaluates the project's own is_admin() for that user ID = true", v.isAdmin === "t");
    record("010 shows the current Project Tracker role (editor by default)", v.ptRole === "editor", v.ptRole);
    const vn = run10("sim.not.admin@example.test");
    record("010: a confirmed non-admin account is reported is_admin = false", vn.ok && vn.count === "1" && vn.isAdmin === "f", vn.isAdmin);
    const vm = run10("nobody@example.test");
    record("010: an unknown email reports 0 matching accounts (no user created)", vm.ok && vm.count === "0" && !vm.id, vm.count);
    record("010 changed nothing (members unchanged)", one("select md5(coalesce(string_agg(user_id::text || role, ',' order by user_id), '')) from public.pt_members") === membersBefore);

    const refuse = (name, id, email, re) => {
      const r = run11(id, email);
      const unchanged = one("select md5(coalesce(string_agg(user_id::text || role, ',' order by user_id), '')) from public.pt_members") === membersBefore;
      record(name, !r.ok && re.test(r.out) && unchanged, r.ok ? "unexpectedly succeeded" : (r.out.match(/ERROR:[^\r\n]*/) || [""])[0]);
    };
    {
      const r = runText("v11raw.sql", SQL11);
      record("011 unedited (placeholder user ID) aborts with nothing changed", !r.ok && /invalid input syntax for type uuid/.test(r.out));
    }
    refuse("011 refuses a non-admin account (no Manager by email alone)", plainId, "sim.not.admin@example.test", /not a website admin/);
    refuse("011 refuses when the user ID and email do not belong together", adminId, "sim.not.admin@example.test", /different email/);
    refuse("011 refuses an unknown user ID", "00000000-0000-4000-8000-000000000000", "sim.existing.admin@example.test", /No user with ID/);
    refuse("011 refuses an unconfirmed admin account", unconfId, "sim.unconfirmed.admin@example.test", /not confirmed/);
    refuse("011 refuses a banned admin account", bannedId, "sim.banned.admin@example.test", /banned or deleted/);

    const ok = run11(adminId, "Sim.Existing.Admin@example.test");
    record("011 assigns Manager to the verified existing admin (by user ID)", ok.ok && /ok: sim\.existing\.admin@example\.test/.test(ok.out), ok.ok ? "" : (ok.out.match(/ERROR:[^\r\n]*/) || [""])[0]);
    record("pt_members holds exactly that user ID as manager", one("select role from public.pt_members where user_id = '" + adminId + "'") === "manager");
    const after = run10("sim.existing.admin@example.test");
    record("server-side pt_role() for that user is now manager", after.ptRole === "manager", after.ptRole);
    record("the assignment is in the activity log (member.role_changed, admin_verified)",
      one("select count(*) from public.pt_activity_logs where entity_id = '" + adminId + "' and action = 'member.role_changed' and details ->> 'admin_verified' = 'true'") === "1");
    record("011 never touched auth.users (no user created, no password or field changed)",
      one("select md5(string_agg(to_jsonb(u)::text, '' order by id)) || ':' || count(*) from auth.users u") === authBefore);
    record("011 never touched user_roles (no website-admin role granted)",
      one("select md5(coalesce(string_agg(user_id::text || role::text, ',' order by user_id, role), '')) from public.user_roles") === rolesBefore);
    const again = run11(adminId, "sim.existing.admin@example.test");
    record("011 is safe to re-run (still one manager row)", again.ok && one("select count(*) from public.pt_members where user_id = '" + adminId + "'") === "1");
    one("delete from public.user_roles where user_id = '" + adminId + "'");
    const lost = run10("sim.existing.admin@example.test");
    record("a manager row grants nothing once the account stops being a website admin", lost.isAdmin === "f" && lost.ptRole === "", JSON.stringify(lost.ptRole));
    one("insert into public.user_roles (user_id, role) values ('" + adminId + "', 'admin')");
  }

  // Re-applying 001 must abort without changing anything.
  const again = psqlFile(path.join(ROOT, "supabase/project-tracker/001_project_tracker_schema.sql"));
  record("re-applying 001 aborts safely", !again.ok && /already installed/i.test(again.out));
  const still = psqlSql("select count(*) from public.pt_projects");
  record("data intact after aborted re-apply", still.ok && Number(still.out) > 0, `projects=${still.out}`);

  // Re-applying 003 aborts safely; rolling back 003 alone keeps every project.
  const again3 = psqlFile(path.join(ROOT, "supabase/project-tracker/003_project_tracker_companies.sql"));
  record("re-applying 003 aborts safely", !again3.ok && /already installed/i.test(again3.out));
  const before = psqlSql("select count(*) || '/' || (select count(*) from public.pt_hosting) from public.pt_projects");
  apply("supabase/project-tracker/901_rollback_companies.sql");
  const after = psqlSql("select count(*) || '/' || (select count(*) from public.pt_hosting) from public.pt_projects");
  record("rollback of 003 keeps every project and record", before.out === after.out && before.ok, `${before.out} → ${after.out}`);
  const gone = psqlSql("select to_regclass('public.pt_companies') is null and not exists (select 1 from information_schema.columns where table_name = 'pt_projects' and column_name = 'company_id')");
  record("rollback of 003 removes companies and company_id", gone.out === "t");
  const viewsOk = psqlSql("select count(*) from public.pt_project_list");
  record("001 views work after rolling back 003", viewsOk.ok, viewsOk.out);
  apply("supabase/project-tracker/003_project_tracker_companies.sql");
  const again4 = psqlFile(path.join(ROOT, "supabase/project-tracker/004_project_tracker_credentials_documents.sql"));
  record("re-applying 004 aborts safely", !again4.ok && /already installed/i.test(again4.out));

  // Rolling back 004 alone keeps every project, credential record and document.
  const b4 = psqlSql("select (select count(*) from public.pt_projects) || '/' || (select count(*) from public.pt_access_records) || '/' || (select count(*) from public.pt_documents)");
  apply("supabase/project-tracker/902_rollback_credentials_documents.sql");
  const a4 = psqlSql("select (select count(*) from public.pt_projects) || '/' || (select count(*) from public.pt_access_records) || '/' || (select count(*) from public.pt_documents)");
  record("rollback of 004 keeps projects, credential records and documents", b4.ok && b4.out === a4.out, `${b4.out} → ${a4.out}`);
  const vaultLeft = psqlSql("select count(*) from vault.secrets where name like 'pt_access_%'");
  record("rollback of 004 deletes this module's vault secrets", vaultLeft.out === "0", vaultLeft.out);
  apply("supabase/project-tracker/004_project_tracker_credentials_documents.sql");

  // Rollback removes everything; then a clean re-install works.
  // (The shim has no storage.protect_delete, so emptying the bucket is simulated here.)
  psqlSql("delete from storage.objects where bucket_id = 'project-tracker-documents'");
  apply("supabase/project-tracker/900_rollback.sql");
  const left = psqlSql(`select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'pt\\_%')
    + (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pt\\_%')
    + (select count(*) from pg_policies where schemaname='storage' and policyname like 'pt documents%')
    + (select count(*) from storage.buckets where id='project-tracker-documents')`);
  record("rollback leaves no pt_* objects, policies or bucket", left.ok && left.out === "0", `remaining=${left.out}`);
  const untouched = psqlSql("select to_regprocedure('public.is_admin()') is not null and to_regclass('public.user_roles') is not null");
  record("rollback leaves is_admin()/user_roles untouched", untouched.out === "t");
  apply("supabase/project-tracker/001_project_tracker_schema.sql");
  apply("supabase/project-tracker/002_project_tracker_storage.sql");
  apply("supabase/project-tracker/003_project_tracker_companies.sql");
  apply("supabase/project-tracker/004_project_tracker_credentials_documents.sql");
} catch (e) {
  record("harness", false, e.message);
} finally {
  stop();
}

console.log(`\n${passes} passed, ${failures} failed${KEEP ? ` (cluster kept at ${root})` : ""}`);
process.exitCode = failures ? 1 : 0;

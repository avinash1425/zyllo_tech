// Unit tests for the pure Project Tracker modules (node --test).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as O from "../src/admin/project-tracker/lib/options.js";
import { SECTIONS, PROJECT_FIELDS, PROJECT_RULES, COMPANY_FIELDS } from "../src/admin/project-tracker/lib/sections.js";
import {
  looksLikeSecret, validateValues, sanitizeFileName, checkUpload, sanitizeSearch, isUrl, isEmail, isDomain, dateOrder,
} from "../src/admin/project-tracker/lib/validation.js";
import { addDaysISO, daysUntil, formatDate, formatBytes, todayISO, toDateTimeLocal, fromDateTimeLocal } from "../src/admin/project-tracker/lib/format.js";
import { safeCell, toCSV, slug } from "../src/admin/project-tracker/lib/csv.js";
import { actionLabel, detailText } from "../src/admin/project-tracker/lib/activity.js";

const SQL = readFileSync(new URL("../supabase/project-tracker/001_project_tracker_schema.sql", import.meta.url), "utf8");
const SQL3 = readFileSync(new URL("../supabase/project-tracker/003_project_tracker_companies.sql", import.meta.url), "utf8");
const SQL4 = readFileSync(new URL("../supabase/project-tracker/004_project_tracker_credentials_documents.sql", import.meta.url), "utf8");

/** Values allowed by `check (<col> in ('a', 'b'))` inside `create table public.<table>` (001 or 003). */
function checkValues(table, column) {
  // 004 replaced the access-category constraint; read the current definition.
  if (table === "pt_access_records" && column === "category") {
    const i = SQL4.indexOf("add constraint pt_access_records_category_check check (category in (");
    assert.ok(i >= 0, "004 access category constraint");
    return [...SQL4.slice(i, SQL4.indexOf("));", i)).matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  }
  const src = SQL.includes(`create table public.${table} (`) ? SQL : SQL3;
  const start = src.indexOf(`create table public.${table} (`);
  assert.ok(start >= 0, `table ${table} not found`);
  const body = src.slice(start, src.indexOf("\n);", start));
  const re = new RegExp(`check \\(${column} in \\(([^)]*)\\)`, "s");
  const m = re.exec(body);
  assert.ok(m, `check constraint for ${table}.${column} not found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}
const vals = (list) => list.map((o) => o.value).sort();

test("every UI option list matches the database CHECK constraint", () => {
  const pairs = [
    ["pt_projects", "status", O.PROJECT_STATUS], ["pt_projects", "category", O.PROJECT_CATEGORY], ["pt_projects", "priority", O.PRIORITY],
    ["pt_hosting", "purpose", O.HOSTING_PURPOSE], ["pt_hosting", "environment", O.ENVIRONMENT], ["pt_hosting", "status", O.HOSTING_STATUS],
    ["pt_domains", "domain_role", O.DOMAIN_ROLE], ["pt_domains", "ssl_type", O.SSL_TYPE], ["pt_domains", "status", O.DOMAIN_STATUS],
    ["pt_domains", "ownership", O.OWNERSHIP], ["pt_domains", "handover_status", O.DOMAIN_HANDOVER],
    ["pt_access_records", "category", O.ACCESS_CATEGORY], ["pt_access_records", "two_factor", O.TWO_FACTOR], ["pt_access_records", "status", O.ACCESS_STATUS],
    ["pt_email_accounts", "purpose", O.EMAIL_PURPOSE], ["pt_email_accounts", "status", O.EMAIL_STATUS],
    ["pt_backups", "backup_type", O.BACKUP_TYPE], ["pt_backups", "method", O.BACKUP_METHOD], ["pt_backups", "frequency", O.BACKUP_FREQUENCY],
    ["pt_backups", "encryption_status", O.ENCRYPTION], ["pt_backups", "status", O.BACKUP_STATUS],
    ["pt_repositories", "git_provider", O.GIT_PROVIDER], ["pt_repositories", "visibility", O.VISIBILITY], ["pt_repositories", "status", O.REPO_STATUS],
    ["pt_deployments", "status", O.DEPLOY_STATUS], ["pt_deployments", "environment", O.ENVIRONMENT],
    ["pt_updates", "update_type", O.UPDATE_TYPE], ["pt_updates", "testing_status", O.TESTING_STATUS], ["pt_updates", "approval_status", O.APPROVAL_STATUS],
    ["pt_amc_contracts", "status", O.AMC_STATUS], ["pt_amc_contracts", "maintenance_frequency", O.MAINT_FREQUENCY],
    ["pt_renewals", "item_type", O.RENEWAL_ITEM], ["pt_renewals", "status", O.RENEWAL_STATUS],
    ["pt_seo_records", "seo_status", O.SEO_STATUS], ["pt_seo_records", "verification_method", O.VERIFICATION_METHOD],
    ["pt_seo_records", "verification_status", O.VERIFICATION_STATUS], ["pt_seo_records", "aeo_status", O.AEO_GEO_STATUS],
    ["pt_tasks", "status", O.TASK_STATUS], ["pt_tasks", "priority", O.PRIORITY], ["pt_milestones", "status", O.MILESTONE_STATUS],
    ["pt_documents", "category", O.DOCUMENT_CATEGORY], ["pt_documents", "classification", O.CLASSIFICATION],
    ["pt_handovers", "status", O.HANDOVER_STATUS], ["pt_handover_items", "item_key", O.HANDOVER_ITEMS], ["pt_handover_items", "state", O.HANDOVER_ITEM_STATE],
    ["pt_companies", "company_type", O.COMPANY_TYPE], ["pt_companies", "status", O.COMPANY_STATUS],
  ];
  for (const [table, column, list] of pairs) {
    assert.deepEqual(vals(list), checkValues(table, column), `${table}.${column}`);
  }
});

test("section field names exist as columns in their table", () => {
  for (const [key, s] of Object.entries(SECTIONS)) {
    const start = SQL.indexOf(`create table public.${s.table} (`);
    assert.ok(start >= 0, `${key}: table ${s.table}`);
    const body = SQL.slice(start, SQL.indexOf("\n);", start));
    for (const f of s.fields) {
      if (f.secret) continue; // never a column: sent only to the vault RPC
      const inBase = new RegExp(`\\n\\s+${f.name}\\s`).test(body);
      assert.ok(inBase || new RegExp(`add column ${f.name}\\s`).test(SQL4), `${s.table}.${f.name}`);
    }
  }
  const pbody = SQL.slice(SQL.indexOf("create table public.pt_projects ("), SQL.indexOf("\n);", SQL.indexOf("create table public.pt_projects (")));
  for (const f of PROJECT_FIELDS) {
    if (f.name === "company_id") assert.match(SQL3, /alter table public\.pt_projects add column company_id uuid references public\.pt_companies\(id\)/);
    else assert.match(pbody, new RegExp(`\\n\\s+${f.name}\\s`), `pt_projects.${f.name}`);
  }
  const cstart = SQL3.indexOf("create table public.pt_companies (");
  const cbody = SQL3.slice(cstart, SQL3.indexOf("\n);", cstart));
  for (const f of COMPANY_FIELDS) assert.match(cbody, new RegExp(`\\n\\s+${f.name}\\s`), `pt_companies.${f.name}`);
});

test("no password / secret / token column is defined anywhere", () => {
  const cols = [...(SQL + SQL3).matchAll(/^\s{2,}([a-z_]+)\s+(text|uuid|date|timestamptz|boolean|bigint|smallint|numeric|jsonb|text\[\])\b/gm)].map((m) => m[1]);
  assert.ok(cols.length > 100);
  for (const c of cols) assert.doesNotMatch(c, /password|passwd|secret|token|api_key|private_key/, c);
});

test("the password field is secret-only and 004 adds no password value column", () => {
  const pw = SECTIONS.access.fields.find((f) => f.name === "password");
  assert.equal(pw.type, "password");
  assert.equal(pw.secret, true);
  const exempt = new Set(["has_password", "password_updated_at", "password_updated_by_email", "vault_secret_id", "passwords_enabled", "passwords_enabled_at", "passwords_enabled_note"]);
  const cols = [...SQL4.matchAll(/^\s+(?:add column\s+)?([a-z_]+)\s+(text|uuid|date|timestamptz|boolean|bigint|smallint|integer|int|numeric|jsonb)\b/gm)].map((m) => m[1]);
  assert.ok(cols.length > 10);
  for (const c of cols) if (!exempt.has(c)) assert.doesNotMatch(c, /password|passwd|secret|token|api_key|private_key/, c);
  for (const c of SECTIONS.access.columns) assert.notEqual(c.key, "password");
});

test("secret detection flags credentials but allows prose (mirrors the SQL heuristic)", () => {
  for (const bad of [
    "root password: Hunter22x!", "api_key=sk_live_ABCDEFGHIJKLMN", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
    "-----BEGIN OPENSSH PRIVATE KEY----- abc", "ghp_abcdefghijklmnopqrstuvwxyz0123", "AKIAABCDEFGHIJKLMNOP",
    "token: 9f8e7d6c5b4a", "sb_secret_abcdefghijklmn", "AIzaSyA1234567890abcdefghijklmnopqrstuv",
  ]) assert.equal(looksLikeSecret(bad), true, bad);
  for (const ok of [
    "Password: stored in the company 1Password vault", "password: 1Password item Acme", "Rotate the API key every 90 days",
    "1Password › Clients › Acme › cPanel", "admin@acme.example", "https://acme.example/wp-admin",
  ]) assert.equal(looksLikeSecret(ok), false, ok);
  // Every SQL-side test value used in pt_security_test.sql must agree with the client.
  assert.equal(looksLikeSecret("password: Xy7abc99"), true);
});

test("validateValues: required, formats, conditional fields and rules", () => {
  const fields = SECTIONS.backups.fields;
  let e = validateValues(fields, { name: "", backup_type: "database", status: "completed", method: "automatic", encryption_status: "unknown" }, SECTIONS.backups.rules);
  assert.ok(e.name && e.backup_at && e.storage_location_ref, "completed needs date + location");
  e = validateValues(fields, { name: "x", backup_type: "database", status: "verified", method: "automatic", encryption_status: "unknown",
    backup_at: "2026-01-01T10:00", storage_location_ref: "vault", verified_by: "QA", verified_on: "2026-01-02", verification_evidence: "ok" }, SECTIONS.backups.rules);
  assert.ok(e.verification_evidence, "evidence must be at least 10 characters");
  e = validateValues(PROJECT_FIELDS, { name: "A project", company_id: "", category: "website", status: "planned", priority: "medium", progress: "150",
    developed_by_zyllo: false, start_date: "2026-05-01", expected_completion_date: "2026-04-01", project_code: "ZT-PRJ-0099", live_url: "javascript:x" }, PROJECT_RULES);
  assert.ok(e.progress && e.original_developer && e.expected_completion_date && e.project_code && e.live_url && e.company_id, "company is required");
  e = validateValues(COMPANY_FIELDS, { company_name: "X", company_type: "llp", status: "active", country: "India", contact_email: "bad",
    contact_phone: "call me", website: "javascript:x", company_code: "a b" });
  assert.ok(e.company_name && e.contact_email && e.contact_phone && e.website && e.company_code, "company fields validated");
  e = validateValues(COMPANY_FIELDS, { company_name: "Company A1", company_type: "llp", status: "active", country: "India", company_code: "a1", contact_phone: "+91 90000 11111" });
  assert.deepEqual(e, {}, "valid company accepted");
  e = validateValues(SECTIONS.domains.fields, { domain_name: "https://x.com", domain_role: "primary", status: "active", ownership: "client", handover_status: "not_started" });
  assert.ok(e.domain_name);
  assert.equal(dateOrder("a", "b", "m")({ a: "2026-01-02", b: "2026-01-01" }).field, "b");
});

test("format helpers handle calendar dates without timezone drift", () => {
  assert.equal(formatDate("2026-11-14"), "14 Nov 2026");
  assert.equal(formatDate(null), "—");
  assert.equal(addDaysISO("2026-12-30", 3), "2027-01-02");
  assert.equal(daysUntil("2026-11-20", "2026-11-14"), 6);
  assert.equal(daysUntil("2026-11-10", "2026-11-14"), -4);
  assert.equal(daysUntil("2027-03-01", "2027-02-28"), 1);
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(formatBytes(1536), "1.5 KB");
  const local = toDateTimeLocal("2026-11-14T03:30:00Z");
  assert.equal(new Date(fromDateTimeLocal(local)).toISOString(), "2026-11-14T03:30:00.000Z");
});

test("CSV export neutralises spreadsheet formulas and quotes correctly", () => {
  assert.equal(safeCell("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
  assert.equal(safeCell("+1"), "'+1");
  assert.equal(safeCell("@SUM"), "'@SUM");
  const csv = toCSV([{ key: "a", label: "A" }, { key: "b", label: "B" }], [{ a: "x,y", b: "say \"hi\"" }, { a: "-2", b: null }]);
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes("\"x,y\",\"say \"\"hi\"\"\""));
  assert.ok(csv.includes("'-2,"));
  assert.equal(slug("Domain Expiry Report!"), "domain-expiry-report");
});

test("file handling: names are sanitised, types and sizes enforced", () => {
  assert.equal(sanitizeFileName("../../etc/pass wd.PDF"), "etc-pass-wd.pdf");
  assert.equal(sanitizeFileName("Résumé (final).docx"), "Resume-final.docx");
  assert.ok(sanitizeFileName("a".repeat(300) + ".pdf").length <= 150);
  assert.match(sanitizeFileName("a.pdf"), /^[A-Za-z0-9._-]+$/);
  assert.equal(checkUpload({ name: "x.exe", size: 10 }) !== null, true);
  assert.equal(checkUpload({ name: "x.pdf", size: 60 * 1024 * 1024 }) !== null, true);
  assert.equal(checkUpload({ name: "x.pdf", size: 1000 }), null);
  assert.equal(checkUpload({ name: "x.pdf", size: 0 }) !== null, true);
  // configurable limit (pt_settings.max_document_mb)
  assert.equal(checkUpload({ name: "x.pptx", size: 6 * 1024 * 1024 }, 5) !== null, true);
  assert.equal(checkUpload({ name: "x.pptx", size: 4 * 1024 * 1024 }, 5), null);
  for (const n of ["a.ppt", "a.doc", "a.docx", "a.xls", "a.xlsx", "a.png", "a.jpg", "a.jpeg", "a.txt"]) assert.equal(checkUpload({ name: n, size: 10 }), null, n);
  for (const n of ["a.svg", "a.html", "a.js", "a.pdf.exe"]) assert.notEqual(checkUpload({ name: n, size: 10 }), null, n);
});

test("search input is made safe for PostgREST filters", () => {
  assert.equal(sanitizeSearch("acme,status.eq.live)"), "acme status.eq.live");
  assert.equal(sanitizeSearch("50% *off*"), "50 off");
  assert.equal(sanitizeSearch("x".repeat(500)).length, 100);
});

test("URL / email / domain validators", () => {
  assert.ok(isUrl("https://acme.example/path?q=1"));
  assert.ok(isUrl("ssh://server.example"));
  assert.ok(!isUrl("javascript:alert(1)"));
  assert.ok(!isUrl("acme.example"));
  assert.ok(isEmail("a@b.co"));
  assert.ok(!isEmail("a@b"));
  assert.ok(isDomain("shop.acme.example"));
  assert.ok(!isDomain("https://acme.example"));
});

test("activity labels are human readable and never need values", () => {
  assert.equal(actionLabel("access.reference_viewed"), "Credential reference viewed");
  assert.equal(actionLabel("hosting.created"), "Hosting added");
  assert.equal(actionLabel("project.status_changed"), "Project status changed");
  assert.equal(detailText({ from: "in_progress", to: "live", fields: ["status"] }), "in progress → live");
  assert.equal(detailText({ fields: ["renewal_date", "linked_hosting_id"] }), "fields: renewal date, linked hosting");
});

test("document links are short-lived and exports/reports have no secret columns", () => {
  const api = readFileSync(new URL("../src/lib/api/admin/projectTracker.js", import.meta.url), "utf8");
  assert.match(api, /const SIGNED_URL_SECONDS = 60;/);
  assert.match(api, /createSignedUrl\(doc\.storage_path, SIGNED_URL_SECONDS/);
  const reports = readFileSync(new URL("../src/admin/project-tracker/reports.js", import.meta.url), "utf8");
  assert.doesNotMatch(reports, /vault_reference|account_identifier|storage_path|external_url|pt_access_refs/);
});

test("activity entity labels are readable", async () => {
  const { entityText } = await import("../src/admin/project-tracker/lib/activity.js");
  assert.equal(entityText({ entity_type: "handover_item", entity_label: "signed_approval_attached" }), "Signed approval document attached");
  assert.equal(entityText({ entity_type: "handover", entity_label: "ready_for_review" }), "");
  assert.equal(entityText({ entity_type: "hosting", entity_label: "Lovable" }), "Lovable");
});

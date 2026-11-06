#!/usr/bin/env node
// TEST-ONLY end-to-end workflow checks (round 4, AIMS ERP reference alignment)
// against the LOCAL HRMS harness: structured Employee Master (PII / identity /
// remarks / payroll separation), Org Structure, Benefits, Training, dashboard
// analytics, grouped reports, navigation aliases, pagination, settings, mobile.
// Every workflow is verified on five aspects: UI action, database result,
// permission enforcement, error handling and refresh behaviour.
//
//   node scripts/hrms-local/browser-flows-4.mjs --out <results.json> [--state <harness state json>] [--only employee_master,org,benefits,training,insights]
//
// * Talks ONLY to 127.0.0.1 (the harness API + test web server read from the
//   harness state file) and to the throwaway PostgreSQL cluster (read-only
//   SELECTs as the cluster owner).
// * Browser NETWORK GUARD: every request whose host is not 127.0.0.1/localhost
//   is failed with BlockedByClient and counted.
// * Synthetic data only (@example.com). Screenshots: docs/hrms/local-test-screenshots/wf4-*.jpg
// * Re-runnable on the same harness: names carry a per-run suffix and open
//   benefit / training rows of the test employees are closed first.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT, findPgBin, makePsql, resolveStateFile, outputDir } from "./lib.mjs";

// ------------------------------------------------------------------ config
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STATE_FILE = resolveStateFile();
if (!existsSync(STATE_FILE)) { console.error(`No harness state at ${STATE_FILE}. Start it with node scripts/hrms-local/start.mjs`); process.exit(2); }
const STATE = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const API = `http://127.0.0.1:${STATE.apiPort}`;
const BASE = arg("--base", `http://127.0.0.1:${STATE.webPort}`);
const ANON = STATE.anonKey;
const OUT = arg("--out", path.join(outputDir("hrms-flows4"), "results.json"));
const ONLY = arg("--only", "").split(",").filter(Boolean);
const SHOTS = path.join(ROOT, "docs", "hrms", "local-test-screenshots");
const PASSWORD = "Local-Test-Only-2026!";
const RUN = Date.now().toString(36);
const RUNL = RUN.replace(/\d/g, (d) => "abcdefghij"[d]);          // letters only (role keys)
for (const u of [API, BASE]) {
  const x = new URL(u);
  if (!["127.0.0.1", "localhost"].includes(x.hostname) || x.port === "8080") { console.error(`Refusing non-harness target ${u}`); process.exit(2); }
}
mkdirSync(SHOTS, { recursive: true });
mkdirSync(path.dirname(OUT), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const blocked = [];
const pageErrors = [];
const shots = [];
const check = (wf, aspect, name, ok, detail = "") => {
  checks.push({ workflow: wf, aspect, name, ok: Boolean(ok), detail: String(detail ?? "") });
  console.log(`${ok ? "PASS" : "FAIL"}  [${wf}/${aspect}] ${name}${detail ? `  (${String(detail).slice(0, 300)})` : ""}`);
};

// ------------------------------------------------------------------ database (owner, read-only queries)
const psql = makePsql({ bin: findPgBin(), port: STATE.pgPort });
async function q(sql) {
  const r = await psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`);
  if (!r.ok) throw new Error(`SQL failed: ${r.stderr.trim()} :: ${sql.slice(0, 200)}`);
  return JSON.parse(r.stdout.trim() || "[]");
}
const q1 = async (sql) => (await q(sql))[0];
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const cnt = async (sql) => (await q1(`select count(*)::int n from (${sql}) x`)).n;

// ------------------------------------------------------------------ local API (direct attempts)
function assertLocal(url) { const h = new URL(url).hostname; if (h !== "127.0.0.1" && h !== "localhost") throw new Error(`blocked non-local ${url}`); }
async function api(method, p, { token, body, headers = {} } = {}) {
  const url = p.startsWith("http") ? p : API + p;
  assertLocal(url);
  const r = await fetch(url, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json; try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; }
  return { status: r.status, body: json };
}
const tokens = new Map();
async function tok(email) {
  if (!tokens.has(email)) {
    const r = await api("POST", "/auth/v1/token?grant_type=password", { body: { email, password: PASSWORD } });
    if (!r.body?.access_token) throw new Error(`sign-in failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    tokens.set(email, r.body.access_token);
  }
  return tokens.get(email);
}
const rpc = async (email, fn, args = {}) => api("POST", `/rest/v1/rpc/${fn}`, { token: await tok(email), body: args });
const sel = async (email, p) => api("GET", `/rest/v1/${p}`, { token: await tok(email) });
const patch = async (email, p, body) => api("PATCH", `/rest/v1/${p}`, { token: await tok(email), body, headers: { Prefer: "return=representation" } });
const post = async (email, p, body) => api("POST", `/rest/v1/${p}`, { token: await tok(email), body, headers: { Prefer: "return=representation" } });
const del = async (email, p) => api("DELETE", `/rest/v1/${p}`, { token: await tok(email), headers: { Prefer: "return=representation" } });
const emsg = (r) => (r.body && (r.body.message || r.body.error_description || r.body.msg || r.body.error)) || `HTTP ${r.status}`;
const refused = (r) => r.status >= 400;
/** A write that RLS filtered away (0 rows) or the server refused. */
const blockedWrite = (r) => r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0);
const wdesc = (r) => `HTTP ${r.status}${Array.isArray(r.body) ? `, ${r.body.length} row(s)` : ` "${emsg(r)}"`}`;

// ------------------------------------------------------------------ browser (CDP, headless Chrome, network guard)
const OPEN_STUB = `(() => { window.__opened = []; window.open = function () { const w = { closed: false, opener: null, close() { this.closed = true; },
  location: { set href(v) { window.__opened.push(String(v)); }, get href() { return ''; } } }; return w; }; })();`;
const chromes = new Set();

async function session(viewport = { w: 1440, h: 900, m: false }) {
  const port = 9300 + Math.floor(Math.random() * 280);
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-flow4-"));
  const proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  chromes.add(proc);
  let target;
  for (let i = 0; i < 80 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
  if (!target) { proc.kill(); throw new Error("Chrome did not start"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    const p = m.params;
    if (m.method === "Fetch.requestPaused") {
      const host = new URL(p.request.url).hostname;
      if (host === "127.0.0.1" || host === "localhost") send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
      else { blocked.push(p.request.url.slice(0, 160)); send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {}); }
    }
    if (m.method === "Runtime.exceptionThrown") pageErrors.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text).split("\n")[0]);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("DOM.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: OPEN_STUB });
  await send("Emulation.setDeviceMetricsOverride", { width: viewport.w, height: viewport.h, deviceScaleFactor: 1, mobile: viewport.m });
  const js = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.value; };
  const go = async (p, wait = 3500) => { await send("Page.navigate", { url: BASE + p }); await sleep(wait); };
  const reload = async (wait = 4000) => { await send("Page.reload", { ignoreCache: true }); await sleep(wait); };
  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 });
    const file = `wf4-${name}.jpg`;
    writeFileSync(path.join(SHOTS, file), Buffer.from(s.data, "base64")); shots.push(file);
  };
  const close = async () => { try { ws.close(); } catch {} proc.kill(); chromes.delete(proc); await sleep(600); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { send, js, go, reload, shot, close };
}

// In-page helpers (injected per call).
const H = `
window.__h = {
  setVal(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
  scope() { const d = [...document.querySelectorAll('[role=dialog]')]; return d[d.length - 1] || document; },
  lab(l) { return l.textContent.replace('*', '').trim(); },
  inputOf(l) { return l && (document.getElementById(l.htmlFor) || l.querySelector('input,select,textarea')); },
  field(label, root) { const s = root || this.scope(); const l = [...s.querySelectorAll('label')].find((x) => this.lab(x).startsWith(label)); return this.inputOf(l); },
  fieldX(label, n) { const s = this.scope(); const ls = [...s.querySelectorAll('label')].filter((x) => this.lab(x) === label); return this.inputOf(ls[n || 0]); },
  fill(label, v) { const el = this.field(label); if (!el) return false; this.setVal(el, v); return true; },
  fillX(label, n, v) { const el = this.fieldX(label, n); if (!el) return false; this.setVal(el, v); return true; },
  pickText(label, sub, n) { const el = n === undefined ? this.field(label) : this.fieldX(label, n); if (!el || el.tagName !== 'SELECT') return false; const o = [...el.options].find((o) => o.value && o.textContent.includes(sub)); if (!o) return false; this.setVal(el, o.value); return o.textContent; },
  pickVal(label, v) { const el = this.field(label); if (!el || el.tagName !== 'SELECT') return false; if (![...el.options].some((o) => o.value === v)) return false; this.setVal(el, v); return true; },
  ariaPick(label, sub) { const el = document.querySelector('select[aria-label="' + label + '"]'); if (!el) return false; const o = [...el.options].find((o) => o.value && o.textContent.includes(sub)); if (!o) return false; this.setVal(el, o.value); return o.textContent; },
  value(label) { const el = this.field(label); return el ? el.value : null; },
  btn(text, inDialog) { const s = inDialog ? this.scope() : document; return [...s.querySelectorAll('button,a')].find((x) => x.textContent.trim().startsWith(text)); },
  click(text, inDialog) { const b = this.btn(text, inDialog); if (!b || b.disabled) return false; b.click(); return true; },
  disabled(text) { const b = this.btn(text, false); return b ? b.disabled : null; },
  clickAria(label) { const b = document.querySelector('[aria-label="' + label + '"]'); if (!b || b.disabled) return false; b.click(); return true; },
  checked(label) { const b = document.querySelector('[aria-label="' + label + '"]'); return b ? b.checked : null; },
  rowClick(rowText, btnText) { const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(rowText)); if (!tr) return 'no-row'; if (!btnText) { tr.click(); return true; }
    const b = [...tr.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(btnText) || x.getAttribute('aria-label') === btnText); if (!b || b.disabled) return 'no-button'; b.click(); return true; },
  rowText(rowText) { const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(rowText)); return tr ? tr.innerText.replace(/\\s+/g, ' ') : null; },
  liClick(liText, btnText) { const li = [...document.querySelectorAll('li')].find((l) => l.querySelector('p') && l.querySelector('p').textContent.includes(liText)); if (!li) return 'no-li';
    const b = [...li.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(btnText)); if (!b) return 'no-button'; if (b.disabled) return 'disabled'; b.click(); return true; },
  liText(liText) { const li = [...document.querySelectorAll('li')].find((l) => l.innerText.includes(liText)); return li ? li.innerText.replace(/\\s+/g, ' ') : null; },
  sec(title) { return [...document.querySelectorAll('section')].find((s) => { const h = s.querySelector('h3'); return h && h.textContent.trim().startsWith(title); }); },
  secText(title) { const s = this.sec(title); return s ? s.innerText : null; },
  secClick(title, text) { const s = this.sec(title); if (!s) return 'no-section'; const b = [...s.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(text)); if (!b) return 'no-button'; if (b.disabled) return 'disabled'; b.click(); return true; },
  secFill(title, label, v) { const s = this.sec(title); if (!s) return false; const el = this.field(label, s); if (!el) return false; this.setVal(el, v); return true; },
  secPick(title, label, v) { const s = this.sec(title); if (!s) return false; const el = this.field(label, s); if (!el) return false; this.setVal(el, v); return true; },
  tick(labelText, on) { const s = this.scope(); const l = [...s.querySelectorAll('label')].find((x) => x.textContent.trim() === labelText) || [...s.querySelectorAll('label')].find((x) => x.textContent.trim().includes(labelText));
    const i = l && (document.getElementById(l.htmlFor) || l.querySelector('input')); if (!i) return false; if (i.checked !== (on !== false)) i.click(); return true; },
  tab(text) { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim().startsWith(text)); if (!t) return false; t.click(); return true; },
  tabs() { return [...document.querySelectorAll('[role=tab]')].map((x) => x.textContent.trim()); },
  confirm() { const d = this.scope(); if (d === document) return false; const bs = [...d.querySelectorAll('button')].filter((b) => !/^(Cancel|Close|Back)$/.test(b.textContent.trim()) && !b.getAttribute('aria-label')); const b = bs[bs.length - 1]; if (!b) return false; b.click(); return b.textContent.trim(); },
  cancel() { const d = this.scope(); if (d === document) return false; const b = [...d.querySelectorAll('button')].find((x) => /^(Cancel|Close)$/.test(x.textContent.trim())) || d.querySelector('[aria-label="Close dialog"]'); if (!b) return false; b.click(); return true; },
  dialogOpen() { return document.querySelectorAll('[role=dialog]').length; },
  dialogText() { const d = this.scope(); return d === document ? '' : d.innerText; },
  alerts() { return [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent.trim()).filter(Boolean); },
  text() { return document.body.innerText; },
  main() { return (document.querySelector('main') || document.body).innerText; },
};`;
const MARK_TOASTS = "document.querySelectorAll('[aria-live=polite] [role=status]').forEach((x) => x.setAttribute('data-wf3-seen', '1'));";
const h = (s, expr) => s.js(`(() => { ${H}; ${/^(click|confirm|rowClick|liClick|clickAria|secClick)\(/.test(expr) ? MARK_TOASTS : ""} return window.__h.${expr}; })()`);
const J = JSON.stringify;
async function waitFor(s, expr, timeout = 10000, every = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await h(s, expr)) return true; await sleep(every); }
  return false;
}
const waitText = (s, re, timeout = 10000) => waitFor(s, `text().match(${re})`, timeout);
const waitDialog = (s, timeout = 6000) => waitFor(s, "dialogOpen() > 0", timeout);
const waitNoDialog = (s, timeout = 8000) => waitFor(s, "dialogOpen() === 0", timeout);
async function toastText(s, timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const t = await s.js("(() => { const n = [...document.querySelectorAll('[aria-live=polite] [role=status]:not([data-wf3-seen])')]; n.forEach((x) => x.setAttribute('data-wf3-seen', '1')); return n.map((x) => x.textContent.trim()); })()") ?? [];
    if (t.length) return t.join(" | ");
    await sleep(200);
  }
  return "";
}
async function login(s, email, password = PASSWORD) {
  await s.go("/login", 2500);
  await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${J(email)}); set('password', ${J(password)}); document.querySelector('form').requestSubmit(); })()`);
  for (let i = 0; i < 30; i++) { await sleep(400); const p = await s.js("location.pathname"); if (p && p !== "/login") { await sleep(1500); return p; } }
  return s.js("location.pathname");
}
const itemIdx = async (s, activity) => s.js(`(() => { ${H}; const ls = [...document.querySelectorAll('label')].filter((x) => __h.lab(x) === 'Activity'); return ls.findIndex((l) => __h.inputOf(l).value === ${JSON.stringify(activity)}); })()`);
async function as(email, fn) {
  const s = await session();
  try { await login(s, email); return await fn(s); } finally { await s.close(); }
}

// ------------------------------------------------------------------ shared lookups / dates
const empId = async (companyEmail) => (await q1(`select id from hr_employees where company_email = ${lit(companyEmail)}`))?.id;
const userId = async (email) => (await q1(`select id from auth.users where email = ${lit(email)}`))?.id;
const TODAY = async () => (await q1("select hr_private.business_today()::text d")).d;
const addD = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isoDow = (d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };
const fmtD = (d) => { const x = new Date(`${d}T00:00:00Z`); return `${String(x.getUTCDate()).padStart(2, "0")} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
const num = (v) => (v == null ? null : Number(v));
const notifs = async (email, type, entity) => q(`select type, title, body, created_at from hr_notifications where recipient_user_id = ${lit(await userId(email))} and type = ${lit(type)}${entity ? ` and entity_id = ${lit(entity)}` : ""} order by created_at desc`);

const EMP = "employee@example.com", EMP2 = "employee2@example.com", MGR = "manager@example.com", HR = "hr.admin@example.com", SA = "superadmin@example.com";


// ==================================================================== AIMS alignment (round 4)
const PAY = "payroll.admin@example.com";
const mainText = (s) => h(s, "main()");
const noOverflow = (s) => s.js("document.documentElement.scrollWidth <= window.innerWidth + 1");
/** Navigate and wait until `ready` (a __h expression) is truthy — dev-server cold loads vary from 2 to 8 s. */
async function goReady(s, p, ready, timeout = 15000) { await s.go(p, 1500); return waitFor(s, ready, timeout); }

// ---------------------------------------------------------------- 1. EMPLOYEE MASTER
async function wfEmployeeMaster() {
  const WF = "employee_master";
  const EMAIL = `demo.aims.${RUN}@example.com`;
  const PASSPORT = `Z${RUN.toUpperCase().replace(/[^A-Z0-9]/g, "")}9`.slice(0, 12);
  const s = await session();
  await login(s, HR);
  await s.go("/hr/employees", 4500);
  await h(s, "click('Add employee')"); await waitDialog(s); await sleep(800);
  const sections = await s.js("[...document.querySelectorAll('[role=dialog] nav[aria-label=\"Form sections\"] button')].map((b) => b.textContent.trim())");
  check(WF, "ui", "Add Employee shows the structured sections (Personal, Contact, Employment, Deployment, Contract, Identification)",
    J(sections) === J(["Personal", "Contact", "Employment", "Deployment", "Contract", "Identification"]), J(sections));
  // invalid inputs first
  await h(s, "fill('First name', 'Aims')"); await h(s, `fill('Company email', ${J(EMAIL)})`);
  await h(s, "fill('Nationality', 'IND')"); await h(s, "pickVal('Deployment status', 'deployed')");
  await h(s, "fill('Notice period (days)', '400')");
  await h(s, "click('Create employee', true)"); await sleep(900);
  const errs = await h(s, "dialogText()");
  check(WF, "error", "Client validation: nationality code, deployed-without-client and notice period > 365 rejected; nothing written",
    /two-letter country code/.test(errs) && /Client is required for a deployed employee/.test(errs) && /between 0 and 365/.test(errs) && (await cnt(`select 1 from hr_employees where company_email = ${lit(EMAIL)}`)) === 0, errs.slice(0, 200));
  await h(s, "fill('Nationality', 'IN')"); await h(s, "pickVal('Deployment status', '')"); await h(s, "fill('Notice period (days)', '45')");
  await h(s, "fill('Last name', 'Alignment')"); await h(s, "fill('Name in Arabic', 'تجربة')"); await h(s, "pickText('Marital status', 'Single')");
  await h(s, "pickText('Company / legal entity', 'Demo entity')"); await h(s, "pickText('Department', 'Engineering')"); await h(s, "pickText('Grade / band', 'Grade 2')");
  await h(s, "pickVal('Work arrangement', 'hybrid')"); await h(s, "pickVal('Contract type', 'fixed_term')");
  await h(s, "fill('HR remarks', 'Synthetic remark from flow 4')");
  await h(s, `fill('Passport number', ${J(PASSPORT)})`); await h(s, "fill('Passport issuing country', 'IN')"); await h(s, `fill('Passport expiry', ${J(addD(await TODAY(), 30))})`);
  await h(s, "fill('Mobile number', '+91 90000 00000')");
  await h(s, "click('Create employee', true)");
  await waitFor(s, "location.pathname.match(/^\\/hr\\/employees\\/[0-9a-f-]{36}$/) !== null", 12000); await sleep(2500);
  const row = await q1(`select e.id, e.employee_code, e.name_arabic, e.work_arrangement, e.contract_type, e.notice_period_days, le.name le, g.name grade,
      p.nationality, p.marital_status, p.phone, i.passport_number, c.remarks
    from hr_employees e left join hr_legal_entities le on le.id = e.legal_entity_id left join hr_grades g on g.id = e.grade_id
    left join hr_employee_private p on p.employee_id = e.id left join hr_employee_identity i on i.employee_id = e.id
    left join hr_employee_confidential c on c.employee_id = e.id where e.company_email = ${lit(EMAIL)}`);
  check(WF, "db", "Create persists work record, PII, identity and HR remarks in their separate tables",
    row && /^ZT-\d{4}$/.test(row.employee_code) && row.le?.includes("Demo entity") && row.grade?.startsWith("Grade 2") && row.work_arrangement === "hybrid"
    && row.contract_type === "fixed_term" && row.notice_period_days === 45 && row.nationality === "IN" && row.marital_status === "single"
    && row.passport_number === PASSPORT && row.remarks === "Synthetic remark from flow 4" && row.name_arabic === "تجربة", J(row));
  const auditPass = await q1(`select new_data->>'passport_number' v from hr_audit_log where table_name = 'hr_employee_identity' and record_id = ${lit(row?.id)} order by id desc limit 1`);
  check(WF, "db", "Passport number redacted in the audit log", auditPass?.v === "[redacted]", J(auditPass));
  const tabs = await h(s, "tabs()");
  check(WF, "ui", "Profile tabs for HR admin: Personal, Identification, Exit — no Banking & payroll", tabs.includes("Identification") && tabs.includes("Personal") && tabs.includes("Exit") && !tabs.includes("Banking & payroll"), tabs.join(", "));
  const ov = await mainText(s);
  check(WF, "ui", "Overview shows company, grade, arrangement, notice period and a completeness score", /Demo entity/.test(ov) && /Grade 2/.test(ov) && /Hybrid/.test(ov) && /45 days/.test(ov) && /\d+%/.test(ov));
  await h(s, "tab('Identification')"); await sleep(2500);
  const idt = await mainText(s);
  check(WF, "ui", "Identification tab shows the passport masked (last 4 only) with an expiry badge", idt.includes(`•••• ${PASSPORT.slice(-4)}`) && !idt.includes(PASSPORT) && /days left/.test(idt), idt.slice(0, 160));
  await s.shot("employee-identification");
  // edit: arrangement + duplicate passport
  await h(s, "click('Edit')"); await waitDialog(s); await sleep(1000);
  await h(s, "pickVal('Work arrangement', 'remote')"); await h(s, "click('Save', true)");
  await waitNoDialog(s, 10000); await sleep(1500);
  const hist = await q1(`select old_value, new_value from hr_employee_history where employee_id = ${lit(row.id)} and change_type = 'work_arrangement' order by id desc limit 1`);
  check(WF, "db", "Edit saves and records history (work arrangement hybrid → remote)", hist?.old_value === "hybrid" && hist?.new_value === "remote", J(hist));
  await s.reload(5000);
  check(WF, "refresh", "After reload the profile shows the saved value (Remote (WFH))", /Remote \(WFH\)/.test(await mainText(s)));
  // duplicate passport on another employee
  const other = await empId("demo.engineer4@example.com");
  await s.go(`/hr/employees/${other}`, 4500);
  await h(s, "click('Edit')"); await waitDialog(s); await sleep(1200);
  await h(s, `fill('Passport number', ${J(PASSPORT)})`); await h(s, "click('Save', true)"); await sleep(2500);
  check(WF, "error", "Duplicate passport refused with a message; other employee unchanged", /already exists/.test(await h(s, "dialogText()"))
    && (await cnt(`select 1 from hr_employee_identity where employee_id = ${lit(other)} and passport_number = ${lit(PASSPORT)}`)) === 0);
  await h(s, "cancel()"); await sleep(500);
  await s.close();

  // permissions
  const mgrId = await sel(MGR, `hr_employee_identity?select=employee_id`);
  const payId = await sel(PAY, `hr_employee_identity?select=employee_id`);
  const empRem = await sel(EMP, `hr_employee_confidential?select=employee_id`);
  check(WF, "permission", "Identity numbers hidden from manager and payroll admin; HR remarks hidden from employees (RLS)",
    mgrId.status === 200 && mgrId.body.length === 0 && payId.body?.length === 0 && empRem.body?.length === 0, `${mgrId.body?.length}/${payId.body?.length}/${empRem.body?.length}`);
  const hrPay = await post(HR, "hr_payroll_employee_identifiers", { employee_id: row.id, tax_id: "ABCDE1234F" });
  check(WF, "permission", "HR admin cannot write payroll identifiers (payroll separation)", refused(hrPay), wdesc(hrPay));
  await as(PAY, async (sx) => {
    await sx.go(`/hr/employees/${row.id}`, 5000);
    const t = await h(sx, "tabs()");
    check(WF, "permission", "Payroll admin sees Banking & payroll but not Identification / Personal", t.includes("Banking & payroll") && !t.includes("Identification") && !t.includes("Personal"), t.join(", "));
    await h(sx, "tab('Banking & payroll')"); await sleep(2000);
    await h(sx, "click('Add account')"); await waitDialog(sx); await sleep(500);
    await h(sx, "fill('Bank name', 'Demo Bank')"); await h(sx, "fill('Account holder', 'Aims Alignment')"); await h(sx, "fill('Account number', '000123456789')"); await h(sx, "fill('IBAN', 'BAD')");
    await h(sx, "click('Save', true)"); await sleep(800);
    const e1 = await h(sx, "dialogText()");
    await h(sx, "fill('IBAN', '')"); await h(sx, "fill('IFSC', 'DEMO0001234')"); await h(sx, "click('Save', true)"); await waitNoDialog(sx); await sleep(1500);
    const b = await q1(`select account_number, ifsc from hr_employee_bank_accounts where employee_id = ${lit(row.id)}`);
    check(WF, "db", "Payroll admin: invalid IBAN rejected client-side, then bank account saved; list shows masked number",
      /valid IBAN/.test(e1) && b?.account_number === "000123456789" && b?.ifsc === "DEMO0001234" && (await mainText(sx)).includes("•••• 6789") && !(await mainText(sx)).includes("000123456789"), J(b));
  });
  await as(EMP, async (sx) => {
    await sx.go("/employee/profile", 4500);
    const t = await mainText(sx);
    check(WF, "ui", "Employee Portal My Profile shows the new work-record fields (company, grade, work arrangement)", /\bcompany\n/i.test(t) && /grade \/ band/i.test(t) && /work arrangement/i.test(t));
  });
}

// ---------------------------------------------------------------- 2. ORG STRUCTURE
async function wfOrg() {
  const WF = "org_structure";
  await as(HR, async (s) => {
    await s.go("/hr/org-structure", 5000);
    const t = await mainText(s);
    check(WF, "ui", "Units tree groups units under the company with headcounts", /Zyllo Tech \(Demo entity\)/.test(t) && /Engineering/.test(t) && /employees/.test(t));
    await h(s, "tab('Units (table)')"); await sleep(1200);
    const eng = await h(s, "rowText('Engineering')");
    const dbEng = await cnt("select 1 from hr_employees e join hr_departments d on d.id = e.department_id where d.code = 'ENG' and e.status not in ('exited','archived')");
    check(WF, "db", "Table view: Engineering direct headcount equals the database", eng && eng.includes(String(dbEng)), `${eng} / db ${dbEng}`);
    await h(s, "rowClick('Engineering')"); await waitDialog(s); await sleep(800);
    check(WF, "ui", "Drill-down lists the unit's employees", /Demo Engineer 0/.test(await h(s, "dialogText()")));
    await h(s, "cancel()"); await sleep(400);
    await h(s, "tab('Reporting hierarchy')"); await sleep(1200);
    await s.js(`(() => { ${H}; __h.setVal(document.querySelector('input[aria-label="Find a person in the hierarchy"]'), 'Engineer 03'); })()`); await sleep(800);
    const rh = await mainText(s);
    check(WF, "ui", "Reporting hierarchy search shows the chain Founder → Eng Lead → Engineer 03", /Demo Founder/.test(rh) && /Demo Eng Lead/.test(rh) && /Demo Engineer 03/.test(rh) && !/Demo Designer\b/.test(rh));
    await h(s, "tab('Hierarchy checks')"); await sleep(800);
    check(WF, "ui", "Hierarchy checks flag employees without a company (interns in the seed)", /no company \/ legal entity/.test(await mainText(s)));
    await s.shot("org-structure");
    await s.close();
  }).catch((e) => check(WF, "crash", "org UI", false, e.message));
  const eng = (await q1("select id from hr_departments where code = 'ENG'")).id, ops = (await q1("select id from hr_departments where code = 'OPS'")).id;
  await patch(SA, `hr_departments?id=eq.${eng}`, { parent_id: ops });
  const cyc = await patch(HR, `hr_departments?id=eq.${ops}`, { parent_id: eng });
  check(WF, "error", "Circular unit hierarchy refused by the server with a message", refused(cyc) && /circular/i.test(emsg(cyc)), emsg(cyc));
  await patch(SA, `hr_departments?id=eq.${eng}`, { parent_id: null });
  const e3 = await empId("demo.engineer3@example.com"), lead = await empId("demo.englead@example.com");
  const rc = await patch(HR, `hr_employees?id=eq.${lead}`, { manager_id: e3 });
  check(WF, "error", "Circular reporting line refused", refused(rc) && /cycle/i.test(emsg(rc)), emsg(rc));
  await as(MGR, async (s) => {
    await s.go("/hr/org-structure", 5000);
    const units = await mainText(s);
    await h(s, "tab('Reporting hierarchy')"); await sleep(1200);
    await s.js(`(() => { ${H}; __h.setVal(document.querySelector('input[aria-label="Find a person in the hierarchy"]'), 'Engineer 03'); })()`); await sleep(800);
    const rh = await mainText(s);
    await s.js(`(() => { ${H}; __h.setVal(document.querySelector('input[aria-label="Find a person in the hierarchy"]'), 'Design'); })()`); await sleep(800);
    const other = await mainText(s);
    check(WF, "permission", "Manager sees only their reporting line (no Design team members)", /Demo Engineer 03/.test(rh) && !/Demo Designer\b/.test(units) && !/Demo Designer\b/.test(other), rh.slice(0, 80));
  });
  await as(EMP, async (s) => {
    await s.go("/hr/org-structure", 3500);
    check(WF, "permission", "Employee is refused /hr/org-structure", /Not authorised/.test(await h(s, "text()")));
  });
}

// ---------------------------------------------------------------- 3. BENEFITS
async function wfBenefits() {
  const WF = "benefits";
  const e3 = await empId("demo.engineer3@example.com"), intern = await empId("demo.intern1@example.com");
  const well = (await q1("select id from hr_benefit_types where code = 'WELLNESS'")).id;
  // re-runnable: close earlier live enrollments of the test pair
  for (const r of await q(`select id from hr_benefit_enrollments where status in ('active','suspended') and ((employee_id = ${lit(e3)} and benefit_type_id = ${lit(well)}) or employee_id = ${lit(intern)})`))
    await rpc(HR, "hr_set_benefit_enrollment_status", { p_enrollment: r.id, p_status: "cancelled", p_reason: "flow 4 reset" });
  await as(HR, async (s) => {
    await s.go("/hr/benefits", 4500);
    await h(s, "click('Enroll employee')"); await waitDialog(s); await sleep(600);
    await h(s, "pickText('Employee', 'Demo Intern 1')"); await h(s, "pickText('Plan', 'Group medical')"); await sleep(2000);
    const d1 = await h(s, "dialogText()");
    await h(s, "click('Enroll', true)"); await sleep(800);
    const d2 = await h(s, "dialogText()");
    check(WF, "error", "Intern shown as not eligible (employment type) and enrollment needs an override reason; nothing written",
      /Not eligible/.test(d1) && /override/.test(d2) && (await cnt(`select 1 from hr_benefit_enrollments where employee_id = ${lit(intern)} and status = 'active'`)) === 0, d2.slice(0, 160));
    await h(s, "cancel()"); await sleep(500);
    await h(s, "click('Enroll employee')"); await waitDialog(s); await sleep(600);
    await h(s, "pickText('Employee', 'Demo Engineer 03')"); await h(s, "pickText('Plan', 'Wellness')"); await sleep(2000);
    await h(s, "fill('Policy / membership number', 'WELL-FLOW4')");
    await h(s, "click('Enroll', true)");
    const t = await toastText(s); await waitNoDialog(s); await sleep(1500);
    const r = await q1(`select id, status, employer_contribution, policy_number from hr_benefit_enrollments where employee_id = ${lit(e3)} and benefit_type_id = ${lit(well)} and status = 'active'`);
    check(WF, "db", "HR enrolls an eligible employee; contribution defaults from the plan", /enrolled/i.test(t) && r && Number(r.employer_contribution) === 500 && r.policy_number === "WELL-FLOW4", `${t} ${J(r)}`);
    await h(s, "rowClick('Wellness', 'Change')"); await waitDialog(s); await sleep(500);
    await h(s, "click('Save', true)"); await sleep(700);
    const e2 = await h(s, "dialogText()");
    await h(s, "fill('Reason', 'Unpaid leave (flow 4)')"); await h(s, "click('Save', true)"); await waitNoDialog(s); await sleep(1500);
    check(WF, "db", "Suspend requires a reason, then saves (status suspended + reason)", /Give a reason/.test(e2)
      && (await q1(`select status, end_reason from hr_benefit_enrollments where id = ${lit(r?.id)}`))?.end_reason === "Unpaid leave (flow 4)");
    await s.reload(5000);
    check(WF, "refresh", "After reload the enrollment shows as suspended", /suspended/.test((await h(s, "rowText('Wellness')")) ?? ""));
    await s.shot("benefits");
  });
  const empIns = await post(EMP, "hr_benefit_enrollments", { employee_id: e3, benefit_type_id: well, start_date: await TODAY() });
  const mgrSee = await sel(MGR, "hr_benefit_enrollments?select=id");
  check(WF, "permission", "Employee cannot insert enrollments; manager sees no team benefits", refused(empIns) && mgrSee.body?.length === 0, `${wdesc(empIns)} / mgr ${mgrSee.body?.length}`);
  await as(EMP, async (s) => {
    await s.go("/employee/benefits", 4500);
    const t = await mainText(s);
    check(WF, "ui", "Employee Portal My Benefits shows own enrollment and plan eligibility", /Wellness allowance/.test(t) && /Group medical/.test(t) && /Available plans/.test(t));
  });
  await as(MGR, async (s) => {
    await s.go("/hr/benefits", 4000);
    check(WF, "permission", "Manager has no Benefits module (redirected)", (await s.js("location.pathname")) !== "/hr/benefits");
  });
}

// ---------------------------------------------------------------- 4. TRAINING
async function wfTraining() {
  const WF = "training";
  const e3 = await empId("demo.engineer3@example.com"), e2 = await empId("demo.designer@example.com");
  const react = (await q1("select id from hr_training_courses where code = 'REACT-201'")).id;
  for (const r of await q(`select id from hr_training_assignments where employee_id = ${lit(e3)} and course_id = ${lit(react)} and status in ('assigned','in_progress')`))
    await rpc(HR, "hr_cancel_training", { p_assignment: r.id, p_reason: "flow 4 reset" });
  await as(HR, async (s) => {
    await goReady(s, "/hr/training", "btn('Assign training') !== undefined");
    await h(s, "click('Assign training')"); await waitDialog(s); await sleep(600);
    await h(s, "click('Assign to', true)"); await sleep(600);
    const e = await h(s, "dialogText()");
    await h(s, "pickText('Course', 'Advanced React')"); await h(s, "tick('Demo Engineer 03')"); await h(s, `fill('Due date', ${J(addD(await TODAY(), 10))})`);
    await h(s, "click('Assign to', true)");
    const t = await toastText(s); await waitNoDialog(s); await sleep(1500);
    const a = await q1(`select id, status, due_date::text from hr_training_assignments where employee_id = ${lit(e3)} and course_id = ${lit(react)} and status = 'assigned'`);
    check(WF, "db", "Empty assignment rejected, then HR assigns the course with a due date", /Choose a course/.test(e) && /at least one employee/.test(e) && /assigned to 1 employee/.test(t) && a, `${t} ${J(a)}`);
  });
  await as(EMP, async (s) => {
    await goReady(s, "/employee/training", "btn('Start') !== undefined");
    await h(s, "click('Start')");
    await waitFor(s, "btn('Mark complete') !== undefined && window.__h.btn('Start') === undefined", 10000);
    await h(s, "click('Mark complete')"); await waitDialog(s); await sleep(800);
    await h(s, "fill('Score', '120')"); await h(s, "click('Save', true)"); await sleep(600);
    const e = await h(s, "dialogText()");
    await h(s, "fill('Score', '88')"); await h(s, "click('Save', true)"); await waitNoDialog(s); await sleep(1500);
    const a = await q1(`select status, completion_source, verified_at, score from hr_training_assignments where employee_id = ${lit(e3)} and course_id = ${lit(react)} order by assigned_at desc limit 1`);
    check(WF, "db", "Employee starts and self-reports completion (score 120 rejected first); stays unverified", /0–100/.test(e) && a?.status === "completed" && a.completion_source === "self" && a.verified_at === null && Number(a.score) === 88, J(a));
    await h(s, "tab('Completed')"); await sleep(600);
    check(WF, "ui", "My Training shows 'awaiting verification'", /awaiting verification/.test(await mainText(s)));
  });
  await as(MGR, async (s) => {
    await goReady(s, "/hr/training", "text().match(/Export CSV|No training assignments/) !== null");
    await h(s, "ariaPick('Assignment status', 'Awaiting verification')");
    await waitFor(s, "rowText('Advanced React') !== null", 10000);
    await h(s, "rowClick('Advanced React', 'Verify')"); await waitDialog(s); await sleep(500);
    await h(s, "confirm()"); await waitNoDialog(s); await sleep(1500);
    const a = await q1(`select verified_at, verified_by from hr_training_assignments where employee_id = ${lit(e3)} and course_id = ${lit(react)} order by assigned_at desc limit 1`);
    check(WF, "db", "Manager verifies the team member's completion", a?.verified_at !== null, J(a));
    const t = await mainText(s);
    check(WF, "permission", "Manager's training list contains no other team's employees", !/Demo Designer\b/.test(t));
  });
  const out = await rpc(MGR, "hr_assign_training", { p_course: react, p_employees: [e2] });
  const self = await rpc(EMP, "hr_verify_training_completion", { p_assignment: (await q1(`select id from hr_training_assignments where employee_id = ${lit(e3)} order by assigned_at desc limit 1`)).id });
  check(WF, "permission", "Manager cannot assign outside the team; employee cannot verify", refused(out) && /reporting line/.test(emsg(out)) && refused(self), `${emsg(out)} / ${emsg(self)}`);
}

// ---------------------------------------------------------------- 5. DASHBOARD, REPORTS, NAV, PAGINATION, SETTINGS
async function wfInsights() {
  const WF = "insights";
  await as(HR, async (s) => {
    await s.go("/hr", 6000);
    const t = await mainText(s);
    check(WF, "ui", "Dashboard shows company, location, tenure, nationality and data-completeness sections",
      /Headcount by company/.test(t) && /Headcount by work location/.test(t) && /Employee tenure/.test(t) && /Nationality/.test(t) && /Employee data completeness/.test(t));
    const dbTotal = await cnt("select 1 from hr_employees where status not in ('exited','archived')");
    check(WF, "db", "Dashboard 'Total employees' equals the database", new RegExp(`Total employees\\s*${dbTotal}\\b`, "i").test(t), `db ${dbTotal}`);
    await s.shot("dashboard");
    await s.go("/hr/reports", 4500);
    const opts = await s.js("[...document.querySelectorAll('main optgroup')].map((g) => g.label)");
    check(WF, "ui", "Report picker grouped by reference categories", ["Workforce & headcount", "Diversity & demographics", "Organisation structure", "Deployment", "Compliance & documents", "Training", "Benefits", "Exit management"].every((g) => opts.includes(g)), J(opts));
    await s.js(`(() => { ${H}; __h.setVal(__h.field('Report'), 'workforce_by_company'); })()`);
    await h(s, "click('Run report')"); await sleep(3500);
    const r = await mainText(s);
    check(WF, "db", "Headcount-by-company report runs and matches the database", /Headcount by company/.test(r) && r.includes(String(await cnt("select 1 from hr_employees where legal_entity_id is not null and status not in ('exited','archived')"))));
    // empty pagination
    await s.go("/hr/employees", 4500);
    await s.js(`(() => { ${H}; __h.setVal(document.querySelector('input[aria-label="Search employees"]'), 'zzzz-no-such-person'); })()`); await sleep(3000);
    const e = await mainText(s);
    check(WF, "ui", "Empty list shows '0 records' and an empty state — never NaN", /0 records/.test(e) && /No employees match/.test(e) && !/NaN/.test(e));
    await s.go("/hr/settings", 4500);
    await s.js(`(() => { ${H}; __h.setVal(document.querySelector('input[type=date]'), ''); })()`);
    await h(s, "tab('Audit log')"); await sleep(2500);
    check(WF, "ui", "Audit log pager shows 'Showing 1–50' and a valid page count", /Showing 1–50 · Page 1 of \d+ · \d+ records/.test(await mainText(s)));
    await s.go("/hr/visa-documents", 4500);
    check(WF, "ui", "Alias /hr/visa-documents redirects to /hr/documents ('Visa & Documents')", (await s.js("location.pathname")) === "/hr/documents" && /Visa & Documents/.test(await h(s, "text()")));
    await s.go("/hr/interns", 4500);
    const active = await s.js("[...document.querySelectorAll('aside nav a[aria-current=page]')].map((a) => a.textContent.trim())");
    check(WF, "ui", "Intern Management opens recruitment/interns and is the only active nav item", (await s.js("location.pathname")) === "/hr/recruitment/interns" && J(active) === J(["Intern Management"]), J(active));
    const nav = await s.js("[...document.querySelectorAll('aside nav p')].map((p) => p.textContent.trim())");
    check(WF, "ui", "Sidebar groups: HR Workspace, Requests, Lifecycle & Operations, Administration", J(nav) === J(["HR WORKSPACE", "REQUESTS", "LIFECYCLE & OPERATIONS", "ADMINISTRATION"]) || J(nav.map((x) => x.toUpperCase())) === J(["HR WORKSPACE", "REQUESTS", "LIFECYCLE & OPERATIONS", "ADMINISTRATION"]), J(nav));
    // settings: add a grade
    await s.go("/hr/settings", 4500);
    const tabs = await h(s, "tabs()");
    check(WF, "ui", "HR Settings has Legal entities, Grades & bands, Identity document rules, Benefit plans, Training categories", ["Legal entities", "Grades & bands", "Identity document rules", "Benefit plans", "Training categories"].every((x) => tabs.includes(x)), tabs.join(", "));
    const GC = `F${RUN.toUpperCase().replace(/[^A-Z0-9]/g, "")}`.slice(0, 10);
    await h(s, "tab('Grades & bands')"); await sleep(1500);
    await h(s, "click('Add')"); await waitDialog(s); await sleep(400);
    await h(s, `fill('Code', ${J(GC)})`); await h(s, `fill('Name', ${J(`Flow grade ${RUN}`)})`); await h(s, "fill('Level', '9')"); await h(s, "click('Save', true)");
    const tg = await toastText(s); await waitNoDialog(s);
    check(WF, "db", "Grade created from HR Settings", /created/.test(tg) && (await cnt(`select 1 from hr_grades where code = ${lit(GC)} and level = 9`)) === 1, tg);
  });
  const g = await post(EMP, "hr_grades", { code: "HACK", name: "Hack grade" });
  check(WF, "permission", "Employee cannot create grades via the API", refused(g), wdesc(g));
  await as(MGR, async (s) => {
    await s.go("/hr/reports", 4500);
    const opts = await s.js("[...document.querySelectorAll('main option')].map((o) => o.textContent)");
    check(WF, "permission", "Manager's report list hides demographic, identity and benefit templates", !opts.includes("Nationality mix") && !opts.includes("Identity compliance (country rules)") && !opts.includes("Benefit enrollments") && opts.includes("Training completion"), `${opts.length} options`);
  });
  // mobile
  const m = await session({ w: 390, h: 844, m: true });
  try {
    await login(m, HR);
    for (const p of ["/hr/org-structure", "/hr/benefits", "/hr/training", "/hr"]) {
      await m.go(p, 5000);
      check(WF, "mobile", `No horizontal overflow at 390 px: ${p}`, await noOverflow(m));
    }
    await m.go("/hr/employees", 4500); await h(m, "click('Add employee')"); await waitDialog(m); await sleep(800);
    check(WF, "mobile", "Add Employee dialog fits 390 px", await noOverflow(m));
    await m.shot("mobile-employee-form");
  } finally { await m.close(); }
}

// ------------------------------------------------------------------ main
const WORKFLOWS = { employee_master: wfEmployeeMaster, org: wfOrg, benefits: wfBenefits, training: wfTraining, insights: wfInsights };
const started = new Date().toISOString();
try {
  for (const [k, fn] of Object.entries(WORKFLOWS)) {
    if (ONLY.length && !ONLY.includes(k)) continue;
    console.log(`\n=== ${k} ===`);
    try { await fn(); } catch (e) { check(k, "crash", `workflow ${k} threw`, false, e.stack?.split("\n").slice(0, 3).join(" | ")); }
  }
} finally {
  for (const p of chromes) { try { p.kill(); } catch {} }
  const summary = {};
  for (const c of checks) { const w = (summary[c.workflow] ??= {}); const a = (w[c.aspect] ??= { pass: 0, fail: 0 }); c.ok ? a.pass++ : a.fail++; }
  writeFileSync(OUT, JSON.stringify({ harness: { api: API, web: BASE, state: STATE_FILE }, run: RUN, started, finished: new Date().toISOString(), summary, checks,
    screenshots: shots, blockedRequests: { count: blocked.length, urls: blocked }, pageExceptions: pageErrors }, null, 2));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed; external requests blocked: ${blocked.length}; page exceptions: ${pageErrors.length}; results: ${OUT}`);
  process.exitCode = failed ? 1 : 0;
}

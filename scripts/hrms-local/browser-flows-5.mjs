#!/usr/bin/env node
// TEST-ONLY end-to-end workflow checks (round 5, HRMS module 2: Employee
// Management) against the LOCAL HRMS harness: directory + summary cards +
// filters, add/edit employee, department/designation assignment, reporting
// manager rules, reasoned & effective-dated changes (promotion, transfer,
// manager change, probation, confirmation), employment timeline, documents
// (upload / verify / signed view / access history), Employee Portal profile,
// and role restrictions (HR admin, manager, employee, payroll admin).
// Each workflow is verified on UI, database, permission, error and refresh.
//
//   node scripts/hrms-local/browser-flows-5.mjs --out <results.json> [--state <harness state json>] [--only em_directory,em_lifecycle,em_documents,em_roles]
//
// Same guarantees as browser-flows-4.mjs (helpers copied from it): talks only to
// 127.0.0.1, browser network guard blocks every non-local request, synthetic data
// only (@example.com), re-runnable (per-run suffixes). Screenshots: wf5-*.jpg
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT, findPgBin, makePsql, portIsFree } from "./lib.mjs";

// ------------------------------------------------------------------ config
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STATE_FILE = arg("--state", path.join(tmpdir(), "zyllo-hrms-local.json"));
if (!existsSync(STATE_FILE)) { console.error(`No harness state at ${STATE_FILE}. Start it with node scripts/hrms-local/start.mjs`); process.exit(2); }
const STATE = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const API = `http://127.0.0.1:${STATE.apiPort}`;
const BASE = arg("--base", `http://127.0.0.1:${STATE.webPort}`);
const ANON = STATE.anonKey;
const OUT = arg("--out", path.join(tmpdir(), "hrms-flows5", "results.json"));
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
  // Own CDP port range (10000-10279), checked free first, so concurrent flow runs
  // from other sessions can never attach to each other's Chrome.
  let port = null;
  for (let i = 0; i < 40 && port === null; i++) { const p = 10000 + Math.floor(Math.random() * 280); if (await portIsFree(p)) port = p; }
  if (port === null) throw new Error("no free CDP port in 10000-10279");
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-flow5-"));
  const proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  chromes.add(proc);
  let target;
  for (let i = 0; i < 200 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page" && t.url === "about:blank"); } catch {} }
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
    const file = `wf5-${name}.jpg`;
    writeFileSync(path.join(SHOTS, file), Buffer.from(s.data, "base64")); shots.push(file);
  };
  const setFile = async (selector, file) => {
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`file input not found: ${selector}`);
    await send("DOM.setFileInputFiles", { files: [file], nodeId });
  };
  const close = async () => { try { ws.close(); } catch {} proc.kill(); chromes.delete(proc); await sleep(600); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { send, js, go, reload, shot, setFile, close };
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
  // Waits for the sign-in form to render before submitting and retries once:
  // under load a fixed delay could submit before React mounted the form.
  for (let attempt = 0; attempt < 2; attempt++) {
    await s.go("/login", 1500);
    for (let i = 0; i < 50; i++) { if (await s.js("Boolean(document.querySelector('input[name=\"email\"]') && document.querySelector('form'))")) break; await sleep(300); }
    await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${J(email)}); set('password', ${J(password)}); document.querySelector('form').requestSubmit(); })()`);
    for (let i = 0; i < 50; i++) { await sleep(400); const p = await s.js("location.pathname"); if (p && p !== "/login") { await sleep(1500); return p; } }
  }
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
// ================================================================ EMPLOYEE MANAGEMENT (module 2, migration 118)
import { syntheticPdf } from "./fixture-files.mjs";
const WORK = mkdtempSync(path.join(tmpdir(), "hrms-flow5-files-"));
const LEAD = "demo.englead@example.com", DLEAD = "demo.designlead@example.com";
const statusCounts = async () => q1(`select count(*) filter (where status in ('active','probation','notice_period'))::int working,
  count(*) filter (where status in ('onboarding','suspended'))::int inactive, count(*) filter (where status = 'probation')::int probation,
  count(*) filter (where status = 'notice_period')::int notice, count(*) filter (where status in ('exited','archived'))::int separated, count(*)::int total from hr_employees`);
const kpi = (s, label) => s.js(`(() => { const sec = document.querySelector('section[aria-label="Employee summary"]'); if (!sec) return null;
  const c = [...sec.querySelectorAll('button,div')].find((x) => x.querySelector('span span') && x.innerText.split('\\n')[0].trim().toUpperCase() === ${J(label)}.toUpperCase());
  return c ? c.innerText.split('\\n')[1] : null; })()`);
const hasBtn = (s, text) => s.js(`(() => { ${H}; return Boolean(window.__h.btn(${J(text)})); })()`);
const ariaVal = (s, label, v) => s.js(`(() => { ${H}; const el = document.querySelector('select[aria-label="' + ${J(label)} + '"]'); if (!el) return false; window.__h.setVal(el, ${J(v)}); return true; })()`);
const disabledInput = (s, label) => s.js(`(() => { ${H}; const el = window.__h.field(${J(label)}); return el ? el.disabled : null; })()`);
const selectOptions = (s, label) => s.js(`(() => { ${H}; const el = window.__h.field(${J(label)}); return el && el.tagName === 'SELECT' ? [...el.options].filter((o) => o.value).map((o) => o.textContent) : null; })()`);

async function wfDirectory() {
  const WF = "em_directory";
  const s = await session();
  await login(s, HR);
  await goReady(s, "/hr/employees", "text().includes('Employee Management') && document.querySelectorAll('tbody tr').length > 0");
  const nav = await s.js("[...document.querySelectorAll('nav a')].map((a) => a.textContent.trim())");
  const iDash = nav.indexOf("HR Dashboard"), iEm = nav.indexOf("Employee Management");
  check(WF, "ui", "Sidebar shows 'Employee Management' (no 'Employee Master') as the module after HR Dashboard",
    iEm === iDash + 1 && !nav.includes("Employee Master"), nav.slice(0, 4).join(" | "));
  check(WF, "ui", "Page heading is Employee Management", /Employee Management/.test(await s.js("document.querySelector('main h2, main h1')?.textContent || document.querySelector('h1').textContent")));
  await sleep(1500);
  const c = await statusCounts();
  const ui = { working: await kpi(s, "Active"), inactive: await kpi(s, "Inactive"), probation: await kpi(s, "On probation"), notice: await kpi(s, "Notice period"), separated: await kpi(s, "Exited / archived") };
  check(WF, "db", "Summary cards (active / inactive / probation / notice / exited) equal the database counts for HR",
    Number(ui.working) === c.working && Number(ui.inactive) === c.inactive && Number(ui.probation) === c.probation && Number(ui.notice) === c.notice && Number(ui.separated) === c.separated, `${J(ui)} vs ${J(c)}`);
  // card click filters
  await s.js(`(() => { const sec = document.querySelector('section[aria-label="Employee summary"]'); [...sec.querySelectorAll('button')].find((b) => b.innerText.startsWith('ON PROBATION') || b.innerText.toUpperCase().startsWith('ON PROBATION')).click(); })()`);
  await sleep(2500);
  const probRows = await s.js("[...document.querySelectorAll('tbody tr')].map((r) => r.innerText)");
  check(WF, "ui", "Clicking 'On probation' filters the directory to probation employees", probRows.length === c.probation && probRows.every((r) => /probation/i.test(r)), `${probRows.length} rows`);
  // designation filter (dependent on department)
  await h(s, "ariaPick('Status', 'Current employees')"); await sleep(800);
  await h(s, "ariaPick('Department', 'Engineering')"); await sleep(1200);
  const desOpts = await s.js("[...document.querySelector('select[aria-label=\"Designation\"]').options].filter((o) => o.value).map((o) => o.textContent)");
  check(WF, "ui", "Designation filter lists only the selected department's (and company-wide) designations",
    desOpts.includes("Software Engineer") && !desOpts.includes("UI/UX Designer") && !desOpts.includes("Finance Executive"), desOpts.join(", "));
  await h(s, "ariaPick('Designation', 'Senior Software Engineer')"); await sleep(2500);
  const rows = await s.js("[...document.querySelectorAll('tbody tr')].map((r) => r.innerText)");
  const dbSse = await cnt(`select 1 from hr_employees e join hr_designations g on g.id = e.designation_id where g.name = 'Senior Software Engineer' and e.status not in ('exited','archived')`);
  check(WF, "db", "Designation filter returns exactly the matching current employees", rows.length === dbSse && rows.every((r) => r.includes("Senior Software Engineer")), `${rows.length} vs ${dbSse}`);
  const sumAfter = await kpi(s, "Active");
  const dbSseWorking = await cnt(`select 1 from hr_employees e join hr_designations g on g.id = e.designation_id where g.name = 'Senior Software Engineer' and e.status in ('active','probation','notice_period')`);
  check(WF, "db", "Summary cards follow the department/designation filter", Number(sumAfter) === dbSseWorking, `${sumAfter} vs ${dbSseWorking}`);
  // reporting manager filter
  await ariaVal(s, "Designation", ""); await ariaVal(s, "Department", ""); await sleep(800);
  await h(s, "ariaPick('Reporting manager', 'Demo Design Lead')"); await sleep(2500);
  const mRows = await s.js("[...document.querySelectorAll('tbody tr')].map((r) => r.innerText)");
  const dbM = await cnt(`select 1 from hr_employees e join hr_employees m on m.id = e.manager_id where m.company_email = ${lit(DLEAD)} and e.status not in ('exited','archived')`);
  check(WF, "db", "Reporting manager filter returns the manager's direct reports", mRows.length === dbM && mRows.length > 0, `${mRows.length} vs ${dbM}`);
  // search + pagination text
  await ariaVal(s, "Reporting manager", ""); await sleep(600);
  await s.js(`(() => { const i = document.querySelector('input[type=search], input[aria-label="Search employees"]'); if (i) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'ZT-0007'); i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await sleep(2500);
  const sRows = await s.js("[...document.querySelectorAll('tbody tr')].map((r) => r.innerText)");
  check(WF, "ui", "Search by employee ID finds the single employee", sRows.length === 1 && sRows[0].includes("ZT-0007"), sRows.join(" / ").slice(0, 120));
  await s.shot("em-directory");
  // aliases
  await s.go("/hr/employee-management", 1500);
  check(WF, "ui", "Alias /hr/employee-management redirects to /hr/employees", await waitFor(s, "text() && location.pathname === '/hr/employees'", 15000), await s.js("location.pathname"));
  await s.go("/hr/employee-master", 1500);
  check(WF, "ui", "Legacy alias /hr/employee-master still works", await waitFor(s, "text() && location.pathname === '/hr/employees'", 15000), await s.js("location.pathname"));
  await s.reload(5000);
  const okRefresh = await waitFor(s, "text() && document.querySelectorAll('tbody tr').length > 0", 20000);
  if (!okRefresh) await s.shot("em-directory-refresh-fail");
  check(WF, "refresh", "Directory renders after a hard refresh", okRefresh, okRefresh ? "" : (await mainText(s)).slice(0, 160));
  await s.close();
}

let NEW_ID = null; let NEW_CODE = null;
async function wfLifecycle() {
  const WF = "em_lifecycle";
  const EMAIL = `demo.em.${RUN}@example.com`;
  const s = await session();
  await login(s, HR);
  await goReady(s, "/hr/employees", "text() && document.querySelectorAll('tbody tr').length > 0");
  await h(s, "click('Add employee')"); await waitDialog(s); await sleep(800);
  await h(s, "fill('First name', 'Mira')"); await h(s, `fill('Last name', ${J(`Module ${RUN}`)})`); await h(s, `fill('Company email', ${J(EMAIL)})`);
  await h(s, "fill('Emergency contact name', 'Demo Contact')"); await h(s, "fill('Emergency contact number', '+91 90000 11111')");
  await h(s, "click('Employment', true)"); await sleep(300);
  await h(s, "pickText('Department', 'Design')"); await sleep(400);
  const des = await selectOptions(s, "Position / designation");
  check(WF, "ui", "Add Employee: designation list is limited to the chosen department (Design) + company-wide", des.includes("UI/UX Designer") && des.includes("Intern") && !des.includes("Software Engineer"), des.join(", "));
  await h(s, "pickText('Position / designation', 'UI/UX Designer')");
  await h(s, "pickText('Reporting manager', 'Demo Design Lead')");
  await h(s, `fill('Joining date', ${J(addD(await TODAY(), -20))})`);
  await h(s, "click('Create employee', true)");
  await waitFor(s, "text() && location.pathname.match(/^\\/hr\\/employees\\/[0-9a-f-]{36}$/) !== null", 12000); await sleep(2500);
  const row = await q1(`select e.id, e.employee_code, e.status, d.name dep, g.name des, m.company_email mgr, p.emergency_contact_phone from hr_employees e
    left join hr_departments d on d.id = e.department_id left join hr_designations g on g.id = e.designation_id left join hr_employees m on m.id = e.manager_id
    left join hr_employee_private p on p.employee_id = e.id where e.company_email = ${lit(EMAIL)}`);
  NEW_ID = row?.id; NEW_CODE = row?.employee_code;
  check(WF, "db", "Add employee: record created with generated unique ID, department, designation, manager, emergency contact; status onboarding",
    /^ZT-\d{4}$/.test(row?.employee_code ?? "") && row.dep === "Design" && row.des === "UI/UX Designer" && row.mgr === DLEAD && row.status === "onboarding" && row.emergency_contact_phone === "+91 90000 11111"
    && (await cnt(`select 1 from hr_employees where employee_code = ${lit(row.employee_code)}`)) === 1, J(row));
  const tabs = await h(s, "tabs()");
  check(WF, "ui", "Profile tabs include Overview, Job & reporting, Personal, Documents, Employment history",
    ["Overview", "Job & reporting", "Personal", "Documents", "Employment history"].every((t) => tabs.includes(t)), tabs.join(", "));
  check(WF, "ui", "Overview shows the lifecycle stepper at Onboarding with a Start probation action", /Employee lifecycle/.test(await mainText(s)) && await hasBtn(s, "Start probation"));
  // Edit: assignment fields locked
  await h(s, "click('Edit')"); await waitDialog(s); await sleep(900);
  await h(s, "click('Employment', true)"); await sleep(300);
  const locks = [await disabledInput(s, "Department"), await disabledInput(s, "Position / designation"), await disabledInput(s, "Reporting manager"), await disabledInput(s, "Employment status")];
  check(WF, "ui", "Edit Employee: department, designation, manager and status are read-only (changed via Change assignment)", locks.every((x) => x === true), J(locks));
  await h(s, "pickVal('Work arrangement', 'hybrid')");
  await h(s, "click('Save', true)"); await waitNoDialog(s, 10000); await sleep(1500);
  check(WF, "db", "Edit employee saves non-assignment fields", (await q1(`select work_arrangement from hr_employees where id = ${lit(NEW_ID)}`)).work_arrangement === "hybrid");
  // Start probation — reason required
  await h(s, "click('Start probation')"); await waitDialog(s); await sleep(600);
  await h(s, "click('Record change', true)"); await sleep(700);
  const err1 = await h(s, "dialogText()");
  check(WF, "error", "Change without a reason is refused in the form; nothing written", /Give a reason/.test(err1) && (await q1(`select status from hr_employees where id = ${lit(NEW_ID)}`)).status === "onboarding");
  await h(s, "fill('Reason', 'Onboarding completed, induction done')");
  await h(s, "click('Record change', true)"); await waitNoDialog(s); await sleep(1500);
  const t1 = await toastText(s, 3000);
  const ev1 = await q1(`select category, reason, effective_date::text, changed_by from hr_employee_change_events where employee_id = ${lit(NEW_ID)} order by changed_at desc limit 1`);
  check(WF, "db", "Start probation: status probation + event with reason, effective date and actor", ev1?.category === "probation_start" && ev1.reason === "Onboarding completed, induction done"
    && ev1.effective_date === (await TODAY()) && ev1.changed_by === (await userId(HR)) && (await q1(`select status from hr_employees where id = ${lit(NEW_ID)}`)).status === "probation", `${J(ev1)} ${t1}`);
  // Confirmation
  await sleep(800);
  await h(s, "click('Confirm employment')"); await waitDialog(s); await sleep(500);
  await h(s, "fill('Reason', 'Probation review passed')"); await h(s, "click('Record change', true)"); await waitNoDialog(s); await sleep(1500);
  const cf = await q1(`select status, confirmation_date::text cd from hr_employees where id = ${lit(NEW_ID)}`);
  check(WF, "db", "Confirmation: status active and confirmation date recorded", cf.status === "active" && cf.cd === (await TODAY()), J(cf));
  // Promotion (designation) with back-dated effective date
  await h(s, "click('Promote')"); await waitDialog(s); await sleep(600);
  await h(s, "pickText('Designation', 'Design Lead')"); await h(s, `fill('Effective date', ${J(addD(await TODAY(), -2))})`);
  await h(s, "fill('Reason', 'Promoted to lead the design practice')"); await h(s, "click('Record change', true)"); await waitNoDialog(s); await sleep(1500);
  const pr = await q1(`select h.old_value, h.new_value, h.effective_date::text ed, h.note, ev.category from hr_employee_history h join hr_employee_change_events ev on ev.id = h.event_id
    where h.employee_id = ${lit(NEW_ID)} and h.change_type = 'designation' order by h.id desc limit 1`);
  check(WF, "db", "Promotion: history row UI/UX Designer → Design Lead linked to a promotion event, effective date and reason kept",
    pr?.old_value === "UI/UX Designer" && pr.new_value === "Design Lead" && pr.ed === addD(await TODAY(), -2) && pr.note === "Promoted to lead the design practice" && pr.category === "promotion", J(pr));
  // Future date refused (server message)
  await h(s, "click('Change assignment')"); await waitDialog(s); await sleep(600);
  await h(s, "pickVal('Type of change', 'manager_change')"); await sleep(300);
  const mgrOpts = await selectOptions(s, "Reporting manager");
  check(WF, "ui", "Manager picker never offers the employee themselves", !mgrOpts.some((o) => o.includes(NEW_CODE)), `${mgrOpts.length} options`);
  await h(s, "pickText('Reporting manager', 'Demo Founder')"); await h(s, "fill('Reason', 'Reports directly to the founder now')");
  await h(s, "click('Record change', true)"); await waitNoDialog(s); await sleep(1500);
  check(WF, "db", "Manager change applied and recorded", (await q1(`select m.company_email e from hr_employees x join hr_employees m on m.id = x.manager_id where x.id = ${lit(NEW_ID)}`))?.e === "demo.founder@example.com"
    && (await cnt(`select 1 from hr_employee_change_events where employee_id = ${lit(NEW_ID)} and category = 'manager_change'`)) === 1);
  // Transfer: department change clears a mismatched designation, server validates
  await h(s, "click('Transfer')"); await waitDialog(s); await sleep(600);
  await h(s, "pickText('Department', 'Engineering')"); await sleep(300);
  const desAfter = await h(s, "value('Designation')");
  check(WF, "ui", "Transfer: choosing another department clears the now-mismatched designation", desAfter === "", J(desAfter));
  await h(s, "pickText('Designation', 'Engineering Lead')"); await h(s, "fill('Reason', 'Moves to engineering to lead the design system team')");
  await h(s, "click('Record change', true)"); await waitNoDialog(s); await sleep(1500);
  const tr = await q1(`select d.name dep, g.name des from hr_employees e join hr_departments d on d.id = e.department_id join hr_designations g on g.id = e.designation_id where e.id = ${lit(NEW_ID)}`);
  check(WF, "db", "Transfer applied: Engineering / Engineering Lead", tr?.dep === "Engineering" && tr.des === "Engineering Lead", J(tr));
  // Timeline
  await h(s, "tab('Employment history')"); await sleep(2500);
  const tl = await mainText(s);
  check(WF, "ui", "Employment timeline lists promotion, transfer, manager change, confirmation with reasons and the HR actor",
    /Promotion/.test(tl) && /Department \/ company transfer/.test(tl) && /Reporting manager change/.test(tl) && /Confirmation/.test(tl) && /Promoted to lead the design practice/.test(tl) && /by Demo HR Manager/.test(tl), tl.slice(0, 200));
  await s.shot("em-timeline");
  await s.reload(5000);
  await h(s, "tab('Employment history')"); await sleep(2500);
  check(WF, "refresh", "Timeline persists after a hard refresh", /Promoted to lead the design practice/.test(await mainText(s)));
  // Reporting tab
  await h(s, "tab('Job & reporting')"); await sleep(2500);
  const rp = await mainText(s);
  check(WF, "ui", "Job & reporting shows the manager's details (name, ID, designation)", /Demo Founder/.test(rp) && /ZT-0001/.test(rp) && /Chief Executive Officer/.test(rp), rp.slice(0, 160));
  const lead = await empId(LEAD);
  await s.go(`/hr/employees/${lead}`, 4000); await h(s, "tab('Job & reporting')"); await sleep(2500);
  const dr = await mainText(s);
  const nDr = await cnt(`select 1 from hr_employees where manager_id = ${lit(lead)} and status not in ('exited','archived')`);
  check(WF, "ui", "Manager profile lists direct reports with the correct count", dr.includes(`Direct reports (${nDr})`) && /Demo Engineer 03/.test(dr), `expected ${nDr}`);
  await s.close();

  // server-side rules through the API (same calls the UI makes)
  const self = await patch(HR, `hr_employees?id=eq.${NEW_ID}`, { manager_id: NEW_ID });
  check(WF, "permission", "Self-reporting refused by the server", refused(self), wdesc(self));
  const cyc = await rpc(HR, "hr_change_employee_assignment", { p_employee: await empId("demo.founder@example.com"), p_category: "manager_change", p_effective_date: await TODAY(), p_reason: "cycle test", p_manager: NEW_ID });
  check(WF, "permission", "Circular reporting (founder → new employee → founder) refused by the server", refused(cyc) && /cycle/i.test(emsg(cyc)), emsg(cyc));
  const mism = await patch(HR, `hr_employees?id=eq.${NEW_ID}`, { designation_id: (await q1("select id from hr_designations where name = 'UI/UX Designer'")).id });
  check(WF, "error", "Designation from another department refused by the server with a clear message", refused(mism) && /different department/.test(emsg(mism)), emsg(mism));
  const exitTry = await rpc(HR, "hr_change_employee_assignment", { p_employee: NEW_ID, p_category: "status_change", p_effective_date: await TODAY(), p_reason: "bypass", p_status: "exited" });
  check(WF, "permission", "Exit cannot bypass Exit Management", refused(exitTry) && /Exit Management/.test(emsg(exitTry)), emsg(exitTry));
  const tamper = await patch(HR, `hr_employee_history?employee_id=eq.${NEW_ID}`, { new_value: "Tampered" });
  check(WF, "permission", "History cannot be rewritten through the API", blockedWrite(tamper) && (await cnt(`select 1 from hr_employee_history where new_value = 'Tampered'`)) === 0, wdesc(tamper));
  const codeChg = await patch(HR, `hr_employees?id=eq.${NEW_ID}`, { employee_code: "ZT-9999" });
  check(WF, "permission", "Employee ID cannot be changed", refused(codeChg) && (await q1(`select employee_code from hr_employees where id = ${lit(NEW_ID)}`)).employee_code === NEW_CODE, emsg(codeChg));
  const audit = await cnt(`select 1 from hr_audit_log where table_name = 'hr_employee_change_events' and new_data->>'employee_id' = ${lit(NEW_ID)}`);
  check(WF, "db", "Every recorded change is in the HR audit log", audit >= 5, `${audit} audit rows`);
  const n = await notifs(`${EMAIL}`, "employment_change").catch(() => []);
  check(WF, "db", "No notification is sent to an employee without a portal account (no user)", Array.isArray(n) && n.length === 0);
}

async function wfDocuments() {
  const WF = "em_documents";
  const target = NEW_ID ?? (await empId("demo.engineer4@example.com"));
  const pdf = path.join(WORK, `em-id-${RUN}.pdf`); writeFileSync(pdf, syntheticPdf(`Synthetic ID proof ${RUN}`));
  const s = await session();
  await login(s, HR);
  await s.go(`/hr/employees/${target}`, 4500);
  await h(s, "tab('Documents')"); await sleep(3000);
  const t0 = await mainText(s);
  check(WF, "ui", "Documents tab shows the document list, required checklist and access history", /Required documents checklist/.test(t0) && /Document access history/.test(t0), t0.slice(0, 120));
  await h(s, "click('Upload document')"); await waitDialog(s); await sleep(700);
  await h(s, "pickVal('Category', 'id_proof')"); await h(s, `fill('Title', ${J(`ID proof ${RUN}`)})`);
  await s.setFile('[role=dialog] input[type=file]', pdf);
  await sleep(400);
  await h(s, "click('Upload', true)"); await waitNoDialog(s, 15000); await sleep(2500);
  const doc = await q1(`select d.id, d.verification_status, v.storage_path from hr_documents d join hr_document_versions v on v.document_id = d.id where d.employee_id = ${lit(target)} and d.title = ${lit(`ID proof ${RUN}`)}`);
  check(WF, "db", "Upload: document registered (pending) with a private storage path under the employee", doc?.verification_status === "pending" && doc.storage_path.includes(target), J(doc));
  // verify
  await h(s, `rowClick(${J(`ID proof ${RUN}`)}, 'Verify / manage')`); await waitDialog(s); await sleep(800);
  await h(s, "click('Verify', true)"); await sleep(700); await h(s, "confirm()"); await sleep(2500);
  check(WF, "db", "Verify: document marked verified with verifier and time", (await q1(`select verification_status v, verified_by is not null b from hr_documents where id = ${lit(doc?.id)}`))?.v === "verified");
  if (await h(s, "dialogOpen()")) { await h(s, "cancel()"); await sleep(500); }
  // view -> signed URL + access log
  await s.js("window.__opened = []");
  await h(s, `rowClick(${J(`ID proof ${RUN}`)}, ${J(`View ID proof ${RUN}`)})`); await sleep(2500);
  const opened = await s.js("window.__opened");
  const logged = await cnt(`select 1 from hr_document_access_log where document_id = ${lit(doc?.id)} and action = 'view' and accessed_by = ${lit(await userId(HR))}`);
  check(WF, "permission", "View uses a short-lived signed URL and is logged", opened?.length === 1 && /token=/.test(opened[0]) && logged >= 1, `${opened?.length} opened, ${logged} logged`);
  await s.reload(5000); await h(s, "tab('Documents')"); await sleep(3000);
  const t1 = await mainText(s);
  check(WF, "refresh", "After refresh the document shows as verified and the access history lists the view", /verified/.test(t1) && /Demo HR Manager \(ZT-0004\)/.test(t1));
  await s.shot("em-documents");
  await s.close();
  // isolation: another employee cannot read it; the file needs a signed URL
  const other = await sel(EMP2, `hr_documents?select=id&id=eq.${doc?.id}`);
  check(WF, "permission", "A colleague cannot see the document (RLS)", other.status === 200 && other.body.length === 0, wdesc(other));
  const sign = await api("POST", `/storage/v1/object/sign/hr-documents/${doc?.storage_path}`, { token: await tok(EMP2), body: { expiresIn: 60 } });
  check(WF, "permission", "A colleague cannot obtain a signed URL for the file", refused(sign), wdesc(sign));
  const logRead = await sel(MGR, `hr_document_access_log?select=id&document_id=eq.${doc?.id}`);
  check(WF, "permission", "Document access history is hidden from managers", logRead.status === 200 && logRead.body.length === 0, wdesc(logRead));
}

async function wfRoles() {
  const WF = "em_roles";
  // manager: team scope only, no change actions
  await as(MGR, async (s) => {
    await goReady(s, "/hr/employees", "text() && document.querySelectorAll('tbody tr').length > 0");
    await sleep(1500);
    const rows = await s.js("[...document.querySelectorAll('tbody tr')].length");
    const total = await s.js(`(() => { const t = document.body.innerText.match(/of (\\d+)/); return t ? Number(t[1]) : null; })()`);
    const res = await sel(MGR, "hr_employees?select=id");
    check(WF, "permission", "Manager directory shows only their reporting line (+ self / own manager)", res.body.length < 16 && rows <= res.body.length, `${rows} rows, RLS ${res.body.length}, total ${total}`);
    const sum = await rpc(MGR, "hr_employee_summary", {});
    check(WF, "permission", "Manager summary counts match their RLS scope", sum.body?.total === res.body.length, `${sum.body?.total} vs ${res.body.length}`);
    const eng3 = await empId(EMP_EMAIL_ENG3);
    await s.go(`/hr/employees/${eng3}`, 4500);
    await waitText(s, /Employee lifecycle/, 10000);
    const acts = { promote: await hasBtn(s, "Promote"), transfer: await hasBtn(s, "Transfer"), change: await hasBtn(s, "Change assignment"), edit: await hasBtn(s, "Edit"), confirm: await hasBtn(s, "Confirm employment") };
    check(WF, "permission", "Manager sees no Promote / Transfer / Change assignment / Edit actions (profile loaded)", /Demo Engineer 03/.test(await mainText(s)) && Object.values(acts).every((x) => x === false), J(acts));
    await h(s, "tab('Employment history')"); await sleep(2500);
    check(WF, "permission", "Manager can view a direct report's employment timeline", /Employment timeline/.test(await mainText(s)));
    const tabs = await h(s, "tabs()");
    check(WF, "permission", "Manager sees no Personal, Identification or Banking tabs for a report", !tabs.includes("Personal") && !tabs.includes("Identification") && !tabs.includes("Banking & payroll"), tabs.join(", "));
  });
  const mgrChange = await rpc(MGR, "hr_change_employee_assignment", { p_employee: await empId(EMP_EMAIL_ENG3), p_category: "manager_change", p_effective_date: await TODAY(), p_reason: "manager attempt", p_clear_manager: true });
  check(WF, "permission", "Manager cannot change assignments through the API", refused(mgrChange), emsg(mgrChange));
  const outScope = await rpc(MGR, "hr_employee_timeline", { p_employee: await empId("demo.designer@example.com") });
  check(WF, "permission", "Manager cannot read the timeline of someone outside their reporting line", refused(outScope), emsg(outScope));
  // employee: portal profile with own timeline, no HR directory
  await as(EMP, async (s) => {
    await s.go("/employee/profile", 5000);
    const t = await mainText(s);
    check(WF, "ui", "Employee Portal My Profile shows the employee's own employment timeline", /Employment timeline/.test(t) && /Record created|Status|Designation/.test(t), t.slice(0, 120));
    await s.go("/hr/employees", 4000);
    const blockedTxt = await h(s, "text()");
    check(WF, "permission", "Employee cannot open the HR Employee Management directory (Not authorised, no rows)", /Not authorised/.test(blockedTxt) && (await s.js("document.querySelectorAll('tbody tr').length")) === 0, blockedTxt.slice(0, 80));
  });
  const empOther = await rpc(EMP, "hr_employee_timeline", { p_employee: await empId("demo.designer@example.com") });
  check(WF, "permission", "Employee cannot read a colleague's timeline", refused(empOther), emsg(empOther));
  const empPriv = await sel(EMP, `hr_employee_private?select=employee_id&employee_id=neq.${await empId(EMP_EMAIL_ENG3)}`);
  check(WF, "permission", "Employee reads no other employee's personal data", empPriv.status === 200 && empPriv.body.length === 0, wdesc(empPriv));
  // payroll admin: views, cannot change; banking still payroll-only
  const payChange = await rpc(PAY, "hr_change_employee_assignment", { p_employee: await empId(EMP_EMAIL_ENG3), p_category: "manager_change", p_effective_date: await TODAY(), p_reason: "payroll attempt", p_clear_manager: true });
  check(WF, "permission", "Payroll admin cannot change assignments", refused(payChange), emsg(payChange));
  const hrBank = await sel(HR, "hr_employee_bank_accounts?select=id");
  check(WF, "permission", "HR admin still cannot read bank accounts (payroll restriction preserved)", hrBank.status === 200 && hrBank.body.length === 0, wdesc(hrBank));
}
const EMP_EMAIL_ENG3 = "demo.engineer3@example.com";

const WORKFLOWS = { em_directory: wfDirectory, em_lifecycle: wfLifecycle, em_documents: wfDocuments, em_roles: wfRoles };

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

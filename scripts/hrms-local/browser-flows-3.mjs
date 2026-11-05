#!/usr/bin/env node
// TEST-ONLY end-to-end workflow checks (round 3) against the LOCAL HRMS harness:
// daily reports, leave, performance & KPI, HR requests, HR settings editors.
// Every workflow is verified on five aspects: UI action, database result,
// permission enforcement, error handling and refresh behaviour.
//
//   node scripts/hrms-local/browser-flows-3.mjs --out <results.json> [--state <harness state json>] [--only reports,leave,performance,requests,settings]
//
// * Talks ONLY to 127.0.0.1 (the harness API + test web server read from the
//   harness state file) and to the throwaway PostgreSQL cluster (read-only
//   SELECTs as the cluster owner, plus supabase/tests/hrms-local/extra_fixtures_3.sql).
// * Browser NETWORK GUARD: every request whose host is not 127.0.0.1/localhost
//   is failed with BlockedByClient and counted.
// * Synthetic data only (@example.com). Screenshots: docs/hrms/local-test-screenshots/wf3-*.jpg
// * Re-runnable on the same harness: names carry a per-run suffix, the daily
//   report date is the first working day without a report, the approved test
//   leave is cancelled again at the end, and changed settings are restored.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT, findPgBin, makePsql } from "./lib.mjs";

// ------------------------------------------------------------------ config
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STATE_FILE = arg("--state", path.join(tmpdir(), "zyllo-hrms-local.json"));
if (!existsSync(STATE_FILE)) { console.error(`No harness state at ${STATE_FILE}. Start it with node scripts/hrms-local/start.mjs`); process.exit(2); }
const STATE = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const API = `http://127.0.0.1:${STATE.apiPort}`;
const BASE = arg("--base", `http://127.0.0.1:${STATE.webPort}`);
const ANON = STATE.anonKey;
const OUT = arg("--out", path.join(tmpdir(), "hrms-flows3", "results.json"));
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
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-flow3-"));
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
    const file = `wf3-${name}.jpg`;
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

// ==================================================================== 1. DAILY REPORTS
async function wfReports() {
  const WF = "reports";
  const today = await TODAY();
  const e3 = await empId("demo.engineer3@example.com"), e2 = await empId("demo.designer@example.com");
  // first working day (today or earlier) with no report for employee@ / employee2@
  const freeDay = async (emp, exclude = null) => (await q1(`select d::date::text as d from generate_series(hr_private.business_today(), hr_private.business_today() - 60, interval '-1 day') g(d)
      where extract(isodow from d) between 1 and 5 and not hr_private.is_holiday(d::date, ${lit(emp)})
        and not exists (select 1 from hr_daily_reports r where r.employee_id = ${lit(emp)} and r.report_date = d::date)
        ${exclude ? `and d::date <> ${lit(exclude)}` : ""} order by d desc limit 1`))?.d;
  const D = await freeDay(e3);
  const D2 = await freeDay(e2, D);
  const web = await q1("select p.id, p.code from hr_projects p where code = 'DEMO-WEB'");
  const task = await q1(`select id, title from hr_tasks where assignee_id = ${lit(e3)} and project_id = ${lit(web.id)} limit 1`);
  const A1 = `WF3 frontend work ${RUN}`, A2 = `WF3 app code review ${RUN}`;
  console.log(`  [reports] employee@ date ${D} (today ${today}); employee2@ date ${D2}`);
  const report = async () => q1(`select * from hr_daily_reports where employee_id = ${lit(e3)} and report_date = ${lit(D)}`);

  // Compliance before: employee@ is listed as missing for D (HR API)
  const missBefore = await rpc(HR, "hr_missing_daily_reports", { p_date: D });
  check(WF, "db", "Before submission HR compliance (hr_missing_daily_reports) lists Demo Engineer 03 for the date", missBefore.status === 200 && missBefore.body.some((r) => r.employee_id === e3), `${missBefore.body?.length} missing`);

  let s = await session();
  await login(s, EMP);
  await s.go("/employee/daily-reports", 4500);
  await h(s, `fillX('Date', 0, ${J(D)})`); await sleep(2500);
  check(WF, "error", "Date picker blocks future dates (max = business today)", (await s.js("document.querySelector('input[type=date]').max")) === today, await s.js("document.querySelector('input[type=date]').max"));
  // Validation: no items -> submit refused, nothing written
  await h(s, "clickAria('Remove item 1')"); await sleep(400);
  await h(s, "click('Submit')"); await waitDialog(s); await h(s, "confirm()"); await sleep(1200);
  const noItems = await h(s, "dialogText()");
  check(WF, "error", "Submit with no work items refused with a message; no report row written", /Add at least one work item/.test(noItems) && !(await report()), noItems.replace(/\s+/g, " ").slice(0, 160));
  await h(s, "cancel()"); await waitNoDialog(s);
  // Validation: > 24 h
  await h(s, "click('Add item')"); await sleep(300); await h(s, "click('Add item')"); await sleep(400);
  await h(s, "fillX('Hours', 0, '20')"); await h(s, `fillX('Activity', 0, ${J(A1)})`);
  await h(s, "fillX('Hours', 1, '6')"); await h(s, `fillX('Activity', 1, ${J(A2)})`);
  await h(s, "click('Save draft')"); await sleep(1200);
  const over = (await h(s, "alerts()")).join(" | ");
  check(WF, "error", "More than 24 h in a day refused client-side (Total hours (26) cannot exceed 24); nothing written", /Total hours \(26\) cannot exceed 24/.test(over) && !(await report()), over.slice(0, 200));
  // Valid draft: 2 items (project + task, second project)
  await h(s, `pickText('Project', 'DEMO-WEB', 0)`); await sleep(500);
  const pickedTask = await h(s, `pickText('Task', ${J(task.title)}, 0)`);
  await h(s, "fillX('Hours', 0, '5')"); await h(s, "fillX('Progress %', 0, '50')");
  await h(s, `pickText('Project', 'DEMO-APP', 1)`); await sleep(400);
  await h(s, "fillX('Hours', 1, '2.5')");
  await h(s, `fill('Summary of the day', ${J(`WF3 synthetic summary ${RUN}`)})`);
  await h(s, "click('Save draft')");
  const tSave = await toastText(s); await sleep(1200);
  let r = await report();
  let items = r ? await q(`select i.hours, i.activity, p.code, i.task_id from hr_daily_report_items i left join hr_projects p on p.id = i.project_id where report_id = ${lit(r.id)} order by i.created_at, i.id`) : [];
  check(WF, "ui", "Employee fills 2 work items (project + task) and clicks 'Save draft' (toast)", /Draft saved/.test(tSave) && pickedTask, `toast "${tSave}"; task "${pickedTask}"`);
  check(WF, "db", "Draft saved: status draft, 2 items (DEMO-WEB with task, DEMO-APP), total_hours recomputed 7.50", r?.status === "draft" && items.length === 2 && Number(r.total_hours) === 7.5 && items.some((i) => i.code === "DEMO-WEB" && i.task_id === task.id) && items.some((i) => i.code === "DEMO-APP"),
    r ? `status ${r.status}, total ${r.total_hours}, items ${items.map((i) => `${i.code}:${i.hours}`).join(", ")}` : "no row");
  // Server re-validation of the 24 h cap and of future dates (direct API, as the employee)
  const it2 = r && (await q1(`select id from hr_daily_report_items where report_id = ${lit(r.id)} and hours = 2.5`));
  const big = it2 ? await patch(EMP, `hr_daily_report_items?id=eq.${it2.id}`, { hours: 23 }) : { status: 0 };
  const after24 = await report();
  check(WF, "error", "Server refuses an item edit that pushes the day over 24 h; total unchanged", refused(big) && /cannot exceed 24/i.test(emsg(big)) && Number(after24.total_hours) === 7.5, `${wdesc(big)}; total ${after24.total_hours}`);
  const fut = await post(EMP, "hr_daily_reports", { employee_id: e3, report_date: addD(today, 1), summary: "future attempt" });
  check(WF, "error", "Server refuses a report dated in the future", refused(fut) && /future/i.test(emsg(fut)) && !(await q1(`select 1 from hr_daily_reports where employee_id = ${lit(e3)} and report_date > hr_private.business_today()`)), wdesc(fut));
  // Edit the draft (hours 2.5 -> 3) and save
  await h(s, `fillX('Hours', ${await itemIdx(s, A2)}, '3')`); await h(s, `fill('Summary of the day', ${J(`WF3 synthetic summary ${RUN} (edited)`)})`);
  await h(s, "click('Save draft')"); await toastText(s); await sleep(1200);
  r = await report();
  check(WF, "db", "Edited draft: total_hours recomputed to 8.00, summary updated", r.status === "draft" && Number(r.total_hours) === 8 && /edited/.test(r.summary), `total ${r.total_hours}`);
  // Submit
  await h(s, "click('Submit')"); await waitDialog(s); await h(s, "confirm()");
  const tSub = await toastText(s, 8000); await sleep(1500);
  r = await report();
  const subRev = await q(`select action, from_status, to_status from hr_daily_report_reviews where report_id = ${lit(r.id)} order by created_at`);
  const nSub = await notifs(MGR, "daily_reports.submitted", r.id);
  check(WF, "ui", "Submit + confirm shows 'Report … submitted' toast", /submitted/.test(tSub), tSub);
  check(WF, "db", "Submitted: status submitted, submitted_at set, review row 'submitted', manager@ notified", r.status === "submitted" && r.submitted_at && subRev.length === 1 && subRev[0].action === "submitted" && nSub.length === 1,
    `status ${r.status}; reviews ${subRev.map((x) => x.action)}; manager notifications ${nSub.length}`);
  const roUi = await h(s, "text()");
  check(WF, "permission", "Employee UI: submitted report is read-only (no Save draft, 'can no longer be edited')", /can no longer be edited/.test(roUi) && !(await h(s, "btn('Save draft')")));
  const upd = await patch(EMP, `hr_daily_reports?id=eq.${r.id}`, { summary: "edited after submit" });
  const updItem = await patch(EMP, `hr_daily_report_items?report_id=eq.${r.id}`, { hours: 1 });
  r = await report();
  check(WF, "permission", "Employee API update of the submitted report and its items changes nothing (RLS)", blockedWrite(upd) && blockedWrite(updItem) && /edited\)$/.test(r.summary) && Number(r.total_hours) === 8, `report ${wdesc(upd)}; items ${wdesc(updItem)}`);
  await s.shot("reports-employee-submitted");
  // Refresh persistence
  await s.reload(4500); await h(s, `fillX('Date', 0, ${J(D)})`); await sleep(2500);
  const refTxt = await h(s, "main()");
  check(WF, "refresh", "After reload the report for the date shows status submitted, 8.00 h and both activities", /submitted/.test(refTxt) && /Total: 8\.00 h/.test(refTxt) && (await s.js(`[...document.querySelectorAll('input')].some((i) => i.value === ${J(A1)})`)), refTxt.match(/Total: [\d.]+ h/)?.[0]);
  await s.close();

  // employee2 creates + submits their own report (API, as employee2) for the "cannot review" check
  const e2ins = await post(EMP2, "hr_daily_reports", { employee_id: e2, report_date: D2, summary: `WF3 employee2 report ${RUN}` });
  const e2id = e2ins.body?.[0]?.id;
  if (e2id) {
    await post(EMP2, "hr_daily_report_items", { report_id: e2id, project_id: web.id, activity: "WF3 design review", hours: 4 });
    await rpc(EMP2, "hr_submit_daily_report", { p_id: e2id });
  }
  // isolation
  const e2sees = await sel(EMP2, `hr_daily_reports?select=id&id=eq.${r.id}`);
  const e2items = await sel(EMP2, `hr_daily_report_items?select=id&report_id=eq.${r.id}`);
  check(WF, "permission", "employee2 API select of employee@'s report and items returns nothing", e2sees.status === 200 && e2sees.body.length === 0 && e2items.body?.length === 0, `report ${e2sees.body?.length}, items ${e2items.body?.length}`);
  await as(EMP2, async (s2) => {
    await s2.go("/hr/daily-reports", 3000);
    const t = await h(s2, "text()");
    await s2.go("/employee/daily-reports", 4000);
    await h(s2, `fillX('Date', 0, ${J(D)})`); await sleep(2500);
    const own = await s2.js(`[...document.querySelectorAll('input')].some((i) => i.value === ${J(A1)})`);
    check(WF, "permission", "employee2 UI: /hr/daily-reports blocked; own editor for that date does not show employee@'s items", /Not authorised/.test(t) && !own);
  });
  const selfRev = await rpc(EMP, "hr_review_daily_report", { p_id: r.id, p_action: "reviewed", p_comment: null });
  check(WF, "permission", "Employee cannot review their own report (RPC refused)", refused(selfRev) && /own report/i.test(emsg(selfRev)), `HTTP ${selfRev.status} "${emsg(selfRev)}"`);
  if (e2id) {
    const mgrOther = await rpc(MGR, "hr_review_daily_report", { p_id: e2id, p_action: "reviewed", p_comment: null });
    const e2st = (await q1(`select status from hr_daily_reports where id = ${lit(e2id)}`)).status;
    check(WF, "permission", "manager@ cannot review employee2's report (other manager's team): RPC refused, status unchanged", refused(mgrOther) && e2st === "submitted", `HTTP ${mgrOther.status} "${emsg(mgrOther)}"; status ${e2st}`);
  } else check(WF, "permission", "employee2 report setup for cross-team review check", false, wdesc(e2ins));

  // ---------- Manager reviews: clarification -> reply -> revision -> resubmit -> reviewed
  s = await session();
  await login(s, MGR);
  await s.go("/hr/daily-reports", 5000);
  await h(s, `fill('From', ${J(D)})`); await h(s, `fill('To', ${J(D)})`); await sleep(2500);
  const mgrList = await h(s, "main()");
  check(WF, "permission", "Manager UI list for the date shows Demo Engineer 03, not Demo Designer", mgrList.includes("Demo Engineer 03") && !mgrList.includes("Demo Designer"));
  await h(s, "rowClick('Demo Engineer 03')"); await waitDialog(s); await sleep(1800);
  await h(s, "pickVal('Action', 'revision_requested')"); await h(s, "click('Apply', true)"); await sleep(800);
  const needC = await h(s, "dialogText()");
  check(WF, "error", "Request revision without a comment refused in the review modal; status unchanged", /A comment is required/.test(needC) && (await report()).status === "submitted");
  const badAct = await rpc(MGR, "hr_review_daily_report", { p_id: r.id, p_action: "approve_everything", p_comment: "x" });
  check(WF, "error", "Unknown review action refused by the server", refused(badAct) && /Unknown review action/.test(emsg(badAct)), emsg(badAct));
  await h(s, "pickVal('Action', 'clarification')"); await h(s, `fill('Comment', ${J(`WF3 which ticket was the code review for? ${RUN}`)})`);
  await h(s, "click('Apply', true)");
  const tCl = await toastText(s); await sleep(1500);
  r = await report();
  check(WF, "ui", "Manager asks for clarification in the review modal (toast)", /Clarification requested/.test(tCl), tCl);
  check(WF, "db", "Clarification: status under_review, reviewer recorded, employee notified", r.status === "under_review" && r.reviewer_employee_id === (await empId("demo.englead@example.com")) && (await notifs(EMP, "daily_reports.clarification", r.id)).length === 1, `status ${r.status}`);
  await h(s, "cancel()"); await waitNoDialog(s);
  await s.close();
  // employee replies to the clarification (UI)
  s = await session();
  await login(s, EMP);
  await s.go("/employee/daily-reports", 4500); await h(s, `fillX('Date', 0, ${J(D)})`); await sleep(2500);
  const clTxt = await h(s, "main()");
  await h(s, `fill('Reply to reviewer', ${J(`WF3 it was ticket DEMO-42 ${RUN}`)})`); await h(s, "click('Send reply')");
  const tRep = await toastText(s); await sleep(1000);
  const reply = await q1(`select action, comment from hr_daily_report_reviews where report_id = ${lit(r.id)} and comment like ${lit(`WF3 it was ticket%${RUN}`)}`);
  check(WF, "ui", "Employee sees the clarification question and replies in the review thread", /Your reviewer asked for clarification/.test(clTxt) && /Reply sent/.test(tRep) && reply?.action === "comment", `toast "${tRep}"`);
  await s.close();
  // manager requests a revision
  s = await session();
  await login(s, MGR);
  await s.go("/hr/daily-reports", 5000);
  await h(s, `fill('From', ${J(D)})`); await h(s, `fill('To', ${J(D)})`); await sleep(2500);
  await h(s, "rowClick('Demo Engineer 03')"); await waitDialog(s); await sleep(1800);
  const thread = await h(s, "dialogText()");
  await h(s, "pickVal('Action', 'revision_requested')"); await h(s, `fill('Comment', ${J(`WF3 please split the review hours ${RUN}`)})`);
  await h(s, "click('Apply', true)");
  const tRv = await toastText(s); await sleep(1500);
  r = await report();
  const rvRow = await q1(`select from_status, to_status, comment from hr_daily_report_reviews where report_id = ${lit(r.id)} and action = 'revision_requested'`);
  check(WF, "ui", "Manager sees the employee's reply in the thread and requests a revision (toast)", thread.includes("ticket DEMO-42") && /Revision requested/.test(tRv), tRv);
  check(WF, "db", "Revision: status revision_requested, review row (under_review → revision_requested), reviewed_at set, employee notified",
    r.status === "revision_requested" && rvRow?.to_status === "revision_requested" && r.reviewed_at && (await notifs(EMP, "daily_reports.revision_requested", r.id)).length === 1, `status ${r.status}; row ${J(rvRow)}`);
  await h(s, "cancel()"); await waitNoDialog(s);
  await s.close();
  // employee edits and resubmits
  s = await session();
  await login(s, EMP);
  await s.go("/employee/daily-reports", 4500); await h(s, `fillX('Date', 0, ${J(D)})`); await sleep(2500);
  const rvTxt = await h(s, "main()");
  const ix2 = await itemIdx(s, A2); await h(s, `fillX('Hours', ${ix2}, '2')`); await h(s, `fillX('Description', ${ix2}, 'Split: 2 h review, rest moved to tomorrow (synthetic)')`);
  await h(s, "click('Submit')"); await waitDialog(s); await h(s, "confirm()");
  const tRe = await toastText(s, 8000); await sleep(1500);
  r = await report();
  const nRe = await notifs(MGR, "daily_reports.submitted", r.id);
  check(WF, "ui", "Employee sees the revision banner, edits an item and resubmits (toast)", /asked for a revision/.test(rvTxt) && /submitted/.test(tRe), tRe);
  check(WF, "db", "Resubmitted: status submitted, total_hours 7.00, 2nd 'submitted' review row (from revision_requested), manager notified again",
    r.status === "submitted" && Number(r.total_hours) === 7 && (await cnt(`select 1 from hr_daily_report_reviews where report_id = ${lit(r.id)} and action = 'submitted' and from_status = 'revision_requested'`)) === 1 && nRe.length === 2,
    `status ${r.status}, total ${r.total_hours}, manager notifications ${nRe.length}`);
  await s.close();
  // manager marks reviewed
  s = await session();
  await login(s, MGR);
  await s.go("/hr/daily-reports", 5000);
  await h(s, `fill('From', ${J(D)})`); await h(s, `fill('To', ${J(D)})`); await sleep(2500);
  await h(s, "rowClick('Demo Engineer 03')"); await waitDialog(s); await sleep(1800);
  await h(s, "pickVal('Action', 'reviewed')"); await h(s, "click('Apply', true)");
  const tOk = await toastText(s); await sleep(1500);
  r = await report();
  check(WF, "ui", "Manager marks the report reviewed (toast)", /marked reviewed/.test(tOk), tOk);
  check(WF, "db", "Reviewed: status reviewed, reviewed_by = manager@, employee notified (daily_reports.reviewed)", r.status === "reviewed" && r.reviewed_by === (await userId(MGR)) && (await notifs(EMP, "daily_reports.reviewed", r.id)).length === 1, `status ${r.status}`);
  await s.shot("reports-manager-reviewed");
  await h(s, "cancel()"); await waitNoDialog(s);
  await s.reload(4500); await h(s, `fill('From', ${J(D)})`); await h(s, `fill('To', ${J(D)})`); await sleep(2500);
  // Module 8 labels DB status 'reviewed' as "Approved" (and 'revision_requested' as "Changes requested").
  check(WF, "refresh", "After reload the manager's list shows the report as reviewed", /reviewed|Approved/.test(await h(s, "rowText('Demo Engineer 03')") ?? ""), await h(s, "rowText('Demo Engineer 03')"));
  await s.close();
  const upd2 = await patch(EMP, `hr_daily_reports?id=eq.${r.id}`, { summary: "edited after review" });
  const delR = await del(EMP, `hr_daily_reports?id=eq.${r.id}`);
  check(WF, "permission", "Employee API update/delete of the reviewed report is refused or matches 0 rows; row intact", blockedWrite(upd2) && blockedWrite(delR) && (await report())?.status === "reviewed", `update ${wdesc(upd2)}; delete ${wdesc(delR)}`);
  await as(EMP, async (s3) => {
    await s3.go("/employee/daily-reports", 4500); await h(s3, `fillX('Date', 0, ${J(D)})`); await sleep(2500);
    const t = await h(s3, "main()");
    check(WF, "permission", "Employee UI: reviewed report is read-only (fieldset disabled, no Submit/Save buttons)", /can no longer be edited/.test(t) && !(await h(s3, "btn('Save draft')")) && (await s3.js("document.querySelector('fieldset').disabled")) === true);
    check(WF, "refresh", "Employee view after reload shows status reviewed with the full review history", /reviewed|Approved/.test(t) && /Clarification requested/.test(t) && /Revision requested|Changes requested/.test(t));
  });

  // ---------- HR compliance tab
  await as(HR, async (s4) => {
    await s4.go("/hr/daily-reports?tab=compliance", 5000);
    await h(s4, `fill('Date', ${J(D)})`); await sleep(3000);
    let t = await h(s4, "main()");
    const missing = (await rpc(HR, "hr_missing_daily_reports", { p_date: D })).body ?? [];
    const lists = missing.length > 0 && missing.every((m) => t.includes(m.employee_code));
    check(WF, "ui", "HR Compliance tab for the date lists every missing employee (matches hr_missing_daily_reports) and not Demo Engineer 03", lists && !t.includes("Demo Engineer 03"), `${missing.length} missing: ${missing.map((m) => m.employee_name).join(", ").slice(0, 200)}`);
    await s4.shot("reports-hr-compliance");
    await h(s4, "click('Send reminders')"); await waitDialog(s4); await h(s4, "confirm()");
    const tRem = await toastText(s4, 8000); await sleep(1000);
    const rem = await cnt(`select 1 from hr_daily_report_reminders where report_date = ${lit(D)}`);
    check(WF, "db", "Send reminders: one hr_daily_report_reminders row per missing employee", rem === missing.length && /reminder|No new reminders/.test(tRem), `toast "${tRem}"; ${rem} reminder rows`);
    await s4.reload(4500); await h(s4, "tab('Compliance')"); await sleep(800); await h(s4, `fill('Date', ${J(D)})`); await sleep(3000);
    t = await h(s4, "main()");
    check(WF, "refresh", "After reload the compliance list for the date is unchanged", missing.every((m) => t.includes(m.employee_code)) && !t.includes("Demo Engineer 03"));
  });
  const mgrComp = await rpc(MGR, "hr_missing_daily_reports", { p_date: D });
  const lead = await empId("demo.englead@example.com");
  check(WF, "permission", "Manager compliance (view_team) is limited to direct reports (no employee2)", mgrComp.status === 200 && mgrComp.body.every((m) => m.manager_id === lead) && !mgrComp.body.some((m) => m.employee_id === e2), `${mgrComp.body?.length} rows, includes employee2: ${mgrComp.body?.some((m) => m.employee_id === e2)}`);
  const empComp = await rpc(EMP, "hr_missing_daily_reports", { p_date: D });
  check(WF, "permission", "Employee cannot read compliance (RPC refused)", refused(empComp) && /not allowed/i.test(emsg(empComp)), emsg(empComp));
}

// ==================================================================== 2. LEAVE
async function wfLeave() {
  const WF = "leave";
  const today = await TODAY();
  const year = today.slice(0, 4);
  const e3 = await empId("demo.engineer3@example.com"), e2 = await empId("demo.designer@example.com");
  const types = Object.fromEntries((await q("select code, id, name from hr_leave_types")).map((t) => [t.code, t]));
  const hol = new Set((await q(`select holiday_date::text d from hr_holidays where type <> 'optional' and location_id is null`)).map((x) => x.d));
  const workdays = (a, b) => { let n = 0; for (let d = a; d <= b; d = addD(d, 1)) if (isoDow(d) <= 5 && !hol.has(d)) n++; return n; };
  const occupied = async () => q(`select start_date::text s, end_date::text e from hr_leave_requests where employee_id = ${lit(e3)} and status in ('pending_approval','approved')`);
  const free = (occ, a, b) => !occ.some((o) => !(b < o.s || a > o.e));
  const bal = async (code) => q1(`select used, pending, adjusted, available from hr_leave_balances where employee_id = ${lit(e3)} and leave_type_id = ${lit(types[code].id)} and year = ${year}`);
  const reqCount = async () => cnt(`select 1 from hr_leave_requests where employee_id = ${lit(e3)}`);
  let occ = await occupied();
  // main window: around a weekday holiday if one is ahead this year, else Thu..Tue (weekend inside)
  let S = null, E = null;
  for (const hd of [...hol].sort()) {
    if (hd.slice(0, 4) !== year || hd <= addD(today, 10) || isoDow(hd) > 5) continue;
    const a = addD(hd, -2), b = addD(hd, 4);
    if (b.slice(0, 4) === year && a > today && free(occ, a, b)) { S = a; E = b; break; }
  }
  if (!S) for (let d = addD(today, 21); d.slice(0, 4) === year; d = addD(d, 1)) if (isoDow(d) === 4 && addD(d, 5).slice(0, 4) === year && free(occ, d, addD(d, 5))) { S = d; E = addD(d, 5); break; }
  if (!S) { check(WF, "ui", "A free leave window exists in the current year", false, "no free window left this year"); return; }
  const expDays = workdays(S, E);
  const clBefore = await bal("CL");
  console.log(`  [leave] window ${S}..${E} (${expDays} working days); CL before ${J(clBefore)}`);

  let s = await session();
  await login(s, EMP);
  await s.go("/employee/leave", 4500);
  const nReq0 = await reqCount();
  // ----- client-side validation
  await h(s, "click('Apply for leave')"); await waitDialog(s); await sleep(1200);
  await h(s, "pickText('Leave type', 'Casual Leave')");
  await h(s, `fill('From', ${J(S)})`); await h(s, `fill('To', ${J(addD(S, -2))})`); await h(s, "fill('Reason', 'Synthetic: end before start')");
  await h(s, "click('Submit request', true)"); await sleep(700);
  const e1 = await h(s, "dialogText()");
  check(WF, "error", "End date before start date refused in the apply form", /End date must be on or after the start date/.test(e1) && (await reqCount()) === nReq0);
  await h(s, `fill('To', ${J(E)})`); await h(s, "fill('Reason', '')");
  await h(s, "click('Submit request', true)"); await sleep(700);
  check(WF, "error", "Missing reason refused in the apply form; nothing written", /Give a reason/.test(await h(s, "dialogText()")) && (await reqCount()) === nReq0);
  // ----- live preview (server day count)
  await waitFor(s, "dialogText().match(/counts as/)", 6000);
  const prev = await h(s, "dialogText()");
  const prevDays = Number(prev.match(/counts as\s+([\d.]+)/)?.[1]);
  check(WF, "ui", `Live day-count preview from the server: ${S}..${E} counts ${expDays} day(s) (weekends${[...hol].some((d) => d >= S && d <= E) ? " and the holiday" : ""} excluded)`, prevDays === expDays, `preview ${prevDays}, expected ${expDays}`);
  await h(s, "pickText('Leave type', 'WF3 Full-day')"); await sleep(600);
  const fullOnly = await h(s, "dialogText()");
  check(WF, "error", "Full-day-only type: the form offers no half-day option ('must be taken in full days')", /must be taken in full days/.test(fullOnly) && !/First half|Half days/.test(fullOnly));
  // ----- overlap (server)
  const ov = occ[0];
  await h(s, "pickText('Leave type', 'Casual Leave')");
  await h(s, `fill('From', ${J(ov.s)})`); await h(s, `fill('To', ${J(ov.e)})`); await h(s, "fill('Reason', 'Synthetic: overlapping request')");
  await h(s, "click('Submit request', true)"); await sleep(1500);
  check(WF, "error", "Overlapping dates refused by the server with a message in the form", /overlap with another pending or approved/.test(await h(s, "dialogText()")) && (await reqCount()) === nReq0, ov ? `${ov.s}..${ov.e}` : "");
  // ----- exceeding balance (server)
  occ = await occupied();
  let XS = null, XE = null;
  const avail = Number(clBefore.available);
  for (let d = addD(today, 15); d < S; d = addD(d, 1)) {
    let e = d; while (e < S && workdays(d, e) <= avail + 1) e = addD(e, 1);
    if (e < S && e.slice(0, 4) === year && workdays(d, e) > avail && free(occ, d, e)) { XS = d; XE = e; break; }
  }
  if (XS) {
    await h(s, `fill('From', ${J(XS)})`); await h(s, `fill('To', ${J(XE)})`); await h(s, "fill('Reason', 'Synthetic: too many days')");
    await h(s, "click('Submit request', true)"); await sleep(1500);
    const ex = await h(s, "dialogText()");
    check(WF, "error", "Exceeding the Casual Leave balance refused (non-negative type), balance untouched", /Insufficient Casual Leave balance/.test(ex) && (await reqCount()) === nReq0 && Number((await bal("CL")).pending) === Number(clBefore.pending), `${XS}..${XE} (${workdays(XS, XE)} days, available ${avail}): ${ex.match(/Insufficient[^\n]*/)?.[0]}`);
  } else check(WF, "error", "Exceeding-balance window available", false, "no free window before the main request");
  await s.shot("leave-apply-errors");
  // ----- valid application
  await h(s, `fill('From', ${J(S)})`); await h(s, `fill('To', ${J(E)})`); await h(s, `fill('Reason', ${J(`WF3 synthetic family trip ${RUN}`)})`); await sleep(900);
  await h(s, "click('Submit request', true)");
  const tAp = await toastText(s, 8000); await waitNoDialog(s); await sleep(1200);
  const L = await q1(`select * from hr_leave_requests where employee_id = ${lit(e3)} and reason = ${lit(`WF3 synthetic family trip ${RUN}`)}`);
  let clNow = await bal("CL");
  check(WF, "ui", "Employee applies (Casual Leave) and sees 'Leave applied … awaiting manager'", new RegExp(`Leave applied: ${expDays} day`).test(tAp) && /awaiting manager/.test(tAp), tAp);
  check(WF, "db", `Request pending_approval at manager level, days ${expDays}; CL pending ${clBefore.pending} → ${Number(clBefore.pending) + expDays}`,
    L?.status === "pending_approval" && L.current_level === "manager" && Number(L.days) === expDays && Number(clNow.pending) === Number(clBefore.pending) + expDays && Number(clNow.available) === Number(clBefore.available) - expDays,
    `request ${L?.status}/${L?.current_level} days ${L?.days}; balance ${J(clNow)}`);
  check(WF, "db", "Applied event + manager@ notified (leave.requested)", (await cnt(`select 1 from hr_leave_request_events where request_id = ${lit(L.id)} and action = 'applied'`)) === 1 && (await notifs(MGR, "leave.requested", L.id)).length === 1);
  // half-day on the full-day-only type (server)
  const half = await rpc(EMP, "hr_apply_leave", { p_leave_type: types.WF3_FULL.id, p_start: XS ?? addD(today, 30), p_end: XS ?? addD(today, 30), p_reason: "Synthetic half day", p_start_half: true, p_end_half: false });
  check(WF, "error", "Half-day on a full-day-only type refused by the server", refused(half) && /cannot be taken as a half day/.test(emsg(half)) && (await reqCount()) === nReq0 + 1, emsg(half));
  const selfOk = await rpc(EMP, "hr_decide_leave", { p_id: L.id, p_approve: true, p_note: null });
  check(WF, "permission", "Employee cannot approve their own request (RPC refused)", refused(selfOk) && /own leave request/.test(emsg(selfOk)), emsg(selfOk));
  const e2Req = await sel(EMP2, `hr_leave_requests?select=id&employee_id=eq.${e3}`);
  const e2Bal = await sel(EMP2, `hr_leave_balances?select=id&employee_id=eq.${e3}`);
  const e2Ev = await sel(EMP2, `hr_leave_request_events?select=id&request_id=eq.${L.id}`);
  check(WF, "permission", "employee2 API cannot read employee@'s requests, balances or request history (0 rows)", e2Req.body?.length === 0 && e2Bal.body?.length === 0 && e2Ev.body?.length === 0, `${e2Req.body?.length}/${e2Bal.body?.length}/${e2Ev.body?.length}`);
  const adjSelf = await rpc(EMP, "hr_adjust_leave_balance", { p_employee: e2, p_leave_type: types.CL.id, p_year: Number(year), p_delta: 5, p_reason: "Synthetic attempt" });
  check(WF, "permission", "Employee cannot adjust balances (RPC refused)", refused(adjSelf) && /not allowed to adjust/.test(emsg(adjSelf)), emsg(adjSelf));
  await s.reload(4500);
  const rowE = await h(s, `rowText(${J(fmtD(S))})`);
  check(WF, "refresh", "After reload My Leave lists the request as pending approval (awaiting manager)", /pending approval/.test(rowE ?? "") && /awaiting manager/.test(rowE ?? ""), rowE);
  await s.close();

  // ----- manager approves (manager level)
  s = await session();
  await login(s, MGR);
  await s.go("/hr/leave", 5000);
  const apList = await h(s, "main()");
  check(WF, "permission", "Manager approvals list shows Demo Engineer 03, not employee2 (Demo Designer, other manager)", apList.includes("Demo Engineer 03") && !apList.includes("Demo Designer"));
  const mgrE2 = await sel(MGR, `hr_leave_requests?select=id&employee_id=eq.${e2}`);
  check(WF, "permission", "Manager API select of employee2's leave requests returns 0 rows", mgrE2.status === 200 && mgrE2.body.length === 0, `${mgrE2.body?.length} rows`);
  await h(s, `rowClick(${J(fmtD(S))}, 'Approve')`); await waitDialog(s); await h(s, "confirm()");
  const tM = await toastText(s); await waitNoDialog(s); await sleep(1000);
  let Lr = await q1(`select * from hr_leave_requests where id = ${lit(L.id)}`);
  clNow = await bal("CL");
  check(WF, "ui", "Manager approves at manager level ('now awaiting HR')", /awaiting HR/.test(tM), tM);
  check(WF, "db", "manager_then_hr: still pending_approval, current_level hr, manager_approved_at set; balance still pending; HR + employee notified",
    Lr.status === "pending_approval" && Lr.current_level === "hr" && Lr.manager_approved_at && Number(clNow.pending) === Number(clBefore.pending) + expDays
    && (await notifs(HR, "leave.requested", L.id)).length >= 1 && (await notifs(EMP, "leave.manager_approved", L.id)).length === 1, `level ${Lr.current_level}; pending ${clNow.pending}`);
  const mgrAgain = await rpc(MGR, "hr_decide_leave", { p_id: L.id, p_approve: true, p_note: null });
  check(WF, "permission", "Manager cannot also give the HR-level approval (RPC refused)", refused(mgrAgain) && /not allowed/.test(emsg(mgrAgain)), emsg(mgrAgain));
  // rejection path: a 1-day request (API apply as employee) rejected by the manager in the UI
  occ = await occupied();
  let RD = null; for (let d = addD(today, 3); d < S; d = addD(d, 1)) if (isoDow(d) <= 5 && !hol.has(d) && free(occ, d, d)) { RD = d; break; }
  const pBefore = Number((await bal("CL")).pending);
  const rj = await rpc(EMP, "hr_apply_leave", { p_leave_type: types.CL.id, p_start: RD, p_end: RD, p_reason: `WF3 to be rejected ${RUN}` });
  const pMid = Number((await bal("CL")).pending);
  await s.reload(4500);
  await h(s, `rowClick(${J(fmtD(RD))}, 'Reject')`); await waitDialog(s); await h(s, "confirm()"); await sleep(800);
  const rjErr = await h(s, "dialogText()");
  check(WF, "error", "Reject without a reason refused in the dialog ('Reason for rejection is required')", /Reason for rejection is required/.test(rjErr) && (await q1(`select status from hr_leave_requests where id = ${lit(rj.body?.id)}`))?.status === "pending_approval");
  await h(s, `fill('Reason for rejection', ${J(`WF3 sprint demo that day ${RUN}`)})`); await h(s, "confirm()");
  const tR = await toastText(s); await waitNoDialog(s); await sleep(1000);
  const rjRow = await q1(`select status, decision_note from hr_leave_requests where id = ${lit(rj.body?.id)}`);
  check(WF, "ui", "Manager rejects with a note (toast 'Leave rejected.')", /Leave rejected/.test(tR), tR);
  check(WF, "db", "Rejected: status rejected with decision_note; CL pending released (back to before)", rjRow?.status === "rejected" && /sprint demo/.test(rjRow.decision_note) && pMid === pBefore + 1 && Number((await bal("CL")).pending) === pBefore && (await notifs(EMP, "leave.rejected", rj.body?.id)).length === 1,
    `pending ${pBefore} → ${pMid} → ${(await bal("CL")).pending}`);
  await s.close();

  // ----- HR final approval
  s = await session();
  await login(s, HR);
  await s.go("/hr/leave", 5000);
  await h(s, `rowClick(${J(fmtD(S))}, 'Approve')`); await waitDialog(s); await h(s, "confirm()");
  const tH = await toastText(s); await waitNoDialog(s); await sleep(1000);
  Lr = await q1(`select * from hr_leave_requests where id = ${lit(L.id)}`);
  clNow = await bal("CL");
  check(WF, "ui", "HR approves the HR-level request (toast 'Leave approved.')", /Leave approved/.test(tH), tH);
  check(WF, "db", `Approved: status approved; CL pending ${Number(clBefore.pending) + expDays} → ${clBefore.pending}, used ${clBefore.used} → ${Number(clBefore.used) + expDays}; employee notified`,
    Lr.status === "approved" && Lr.current_level === null && Lr.decided_at && Number(clNow.pending) === Number(clBefore.pending) && Number(clNow.used) === Number(clBefore.used) + expDays
    && Number(clNow.available) === Number(clBefore.available) - expDays && (await notifs(EMP, "leave.approved", L.id)).length === 1, `balance ${J(clNow)}`);
  const evs = (await q(`select action, level from hr_leave_request_events where request_id = ${lit(L.id)} order by created_at`)).map((e) => `${e.action}@${e.level}`);
  check(WF, "db", "History rows: applied@manager → manager_approved@manager → approved@hr", evs.join(",") === "applied@manager,manager_approved@manager,approved@hr", evs.join(", "));
  // ----- balance adjustment (leave.adjust)
  await h(s, "tab('Balances')"); await sleep(2500);
  const elBefore = await bal("EL");
  const nAdj0 = await cnt(`select 1 from hr_leave_balance_adjustments where employee_id = ${lit(e3)}`);
  await h(s, "click('Adjust balance')"); await waitDialog(s); await sleep(1000);
  await h(s, "pickText('Employee', 'Demo Engineer 03')"); await h(s, "pickText('Leave type', 'Earned Leave')"); await h(s, "fill('Days', '1.5')");
  await h(s, "click('Review', true)"); await sleep(600);
  const adjErr = await h(s, "dialogText()");
  check(WF, "error", "Adjustment without a reason refused in the form; nothing written", /A reason is required/.test(adjErr) && (await cnt(`select 1 from hr_leave_balance_adjustments where employee_id = ${lit(e3)}`)) === nAdj0);
  await h(s, `fill('Reason', ${J(`WF3 comp-off for weekend release ${RUN}`)})`); await h(s, "click('Review', true)"); await sleep(600);
  const adjConf = await h(s, "dialogText()");
  await h(s, "click('Confirm adjustment', true)");
  const tAdj = await toastText(s); await waitNoDialog(s); await sleep(1000);
  const adjRow = await q1(`select kind, delta, reason, created_by from hr_leave_balance_adjustments where employee_id = ${lit(e3)} and reason like ${lit(`%${RUN}`)}`);
  const elAfter = await bal("EL");
  check(WF, "ui", "HR adjusts Earned Leave +1.5 via Review → Confirm adjustment (toast)", /\+1\.5/.test(adjConf) && /Balance adjusted/.test(tAdj), tAdj);
  check(WF, "db", "Adjustment row (manual, +1.5, reason, by hr.admin); EL adjusted +1.5 and available +1.5; employee notified",
    adjRow?.kind === "manual" && Number(adjRow.delta) === 1.5 && adjRow.created_by === (await userId(HR)) && Number(elAfter.adjusted) === Number(elBefore.adjusted) + 1.5
    && Number(elAfter.available) === Number(elBefore.available) + 1.5 && (await notifs(EMP, "leave.balance_adjusted")).length >= 1, `EL ${J(elBefore)} → ${J(elAfter)}`);
  const neg = await rpc(HR, "hr_adjust_leave_balance", { p_employee: e3, p_leave_type: types.CL.id, p_year: Number(year), p_delta: -999, p_reason: "Synthetic: too much" });
  check(WF, "error", "Adjustment that would make a non-negative balance negative refused by the server", refused(neg) && /negative/.test(emsg(neg)), emsg(neg));
  await h(s, "pickText('Employee', 'Demo Engineer 03')"); await sleep(2500);
  const hist = await h(s, "main()");
  check(WF, "refresh", "Balances tab (employee filter) shows the adjustment history row with the reason", hist.includes(`comp-off for weekend release ${RUN}`) && /\+1\.5/.test(hist));
  await s.shot("leave-hr-balances");
  await s.close();

  // ----- employee: refresh + cancel a pending request + cancel the approved future leave (restores used)
  s = await session();
  await login(s, EMP);
  await s.go("/employee/leave", 4500);
  const card = await s.js("[...document.querySelectorAll('div')].find((d) => d.querySelector('p') && d.querySelector('p').textContent === 'Casual Leave' && d.querySelector('dl'))?.innerText.replace(/\\s+/g, ' ')");
  const row2 = await h(s, `rowText(${J(fmtD(S))})`);
  check(WF, "refresh", `After reload My Leave shows the request approved and Casual Leave Used ${clNow.used}`, /approved/.test(row2 ?? "") && new RegExp(`Used ${Number(clNow.used)}`).test(card ?? ""), `${row2} || ${card}`);
  occ = await occupied();
  let CD = null; for (let d = addD(today, 4); d < S; d = addD(d, 1)) if (isoDow(d) <= 5 && !hol.has(d) && free(occ, d, d)) { CD = d; break; }
  const pc0 = Number((await bal("CL")).pending);
  const cx = await rpc(EMP, "hr_apply_leave", { p_leave_type: types.CL.id, p_start: CD, p_end: CD, p_reason: `WF3 to be cancelled ${RUN}` });
  await s.reload(4500);
  await h(s, `rowClick(${J(fmtD(CD))}, 'Cancel')`); await waitDialog(s); await h(s, "confirm()");
  const tC = await toastText(s); await waitNoDialog(s); await sleep(1000);
  check(WF, "db", "Employee cancels a pending request in the UI: status cancelled, CL pending released", /Leave cancelled/.test(tC) && (await q1(`select status from hr_leave_requests where id = ${lit(cx.body?.id)}`))?.status === "cancelled" && Number((await bal("CL")).pending) === pc0, `toast "${tC}"`);
  const cancelAgain = await rpc(EMP, "hr_cancel_leave", { p_id: cx.body?.id, p_note: null });
  check(WF, "error", "Cancelling an already cancelled request refused", refused(cancelAgain) && /already cancelled/.test(emsg(cancelAgain)), emsg(cancelAgain));
  const usedB = Number((await bal("CL")).used);
  await h(s, `rowClick(${J(fmtD(S))}, 'Cancel')`); await waitDialog(s); await h(s, "confirm()");
  await toastText(s); await waitNoDialog(s); await sleep(1000);
  check(WF, "db", `Employee cancels the approved future leave (cleanup): CL used ${usedB} → ${usedB - expDays}, manager notified`, (await q1(`select status from hr_leave_requests where id = ${lit(L.id)}`)).status === "cancelled" && Number((await bal("CL")).used) === usedB - expDays && (await notifs(MGR, "leave.cancelled", L.id)).length === 1);
  await s.close();
}

// ==================================================================== 3. PERFORMANCE & KPI
async function wfPerformance() {
  const WF = "performance";
  const today = await TODAY();
  const e3 = await empId("demo.engineer3@example.com"), e2 = await empId("demo.designer@example.com");
  const lead3 = await empId("demo.englead@example.com");
  const CY = `WF3 Monthly review ${RUN}`;
  const ps = `${today.slice(0, 7)}-01`;
  const pe = addD(`${addD(ps, 32).slice(0, 7)}-01`, -1);
  const GA = `WF3 Ship feature ${RUN}`, GB = `WF3 Learn testing ${RUN}`, GC = `WF3 Fix bugs ${RUN}`, GX = `WF3 Overweight ${RUN}`;
  let s = await session();
  await login(s, HR);
  await s.go("/hr/performance/cycles", 5000);
  await h(s, "click('New cycle')"); await waitDialog(s); await sleep(600);
  await h(s, `fill('Name', ${J(CY)})`); await h(s, "pickVal('Type', 'monthly')");
  await h(s, `fill('Period start', ${J(ps)})`); await h(s, `fill('Period end', ${J(addD(ps, -1))})`);
  await h(s, `fill('Self-assessment due', ${J(addD(today, 3))})`); await h(s, `fill('Manager review due', ${J(addD(today, 10))})`);
  await h(s, "click('Create draft', true)"); await sleep(700);
  check(WF, "error", "Cycle with period end before start rejected in the form; nothing written", /Must be on or after the start/.test(await h(s, "dialogText()")) && (await cnt(`select 1 from hr_review_cycles where name = ${lit(CY)}`)) === 0);
  await h(s, `fill('Period end', ${J(pe)})`); await h(s, "click('Create draft', true)");
  const tCy = await toastText(s); await waitNoDialog(s); await sleep(1500);
  let cyc = await q1(`select * from hr_review_cycles where name = ${lit(CY)}`);
  check(WF, "ui", "HR creates a draft review cycle (toast 'Draft cycle created.')", /Draft cycle created/.test(tCy), tCy);
  check(WF, "db", "Cycle row: status draft, monthly, period and due dates as entered, created_by hr.admin", cyc?.status === "draft" && cyc.cycle_type === "monthly" && cyc.period_start === ps && cyc.period_end === pe && cyc.created_by === (await userId(HR)), cyc ? `${cyc.period_start}..${cyc.period_end}` : "none");
  const actDirect = await patch(HR, `hr_review_cycles?id=eq.${cyc.id}`, { status: "active" });
  check(WF, "error", "Activating a cycle by a direct update is refused ('Use Start cycle')", refused(actDirect) && /Start cycle/.test(emsg(actDirect)), emsg(actDirect));
  const expReviews = await cnt(`select 1 from hr_employees e join hr_employment_types t on t.code = e.employment_type where e.status in ('active','probation') and (e.joining_date is null or e.joining_date <= ${lit(pe)}) and not t.is_intern`);
  await h(s, `rowClick(${J(CY)}, 'Start')`); await waitDialog(s); await h(s, "confirm()");
  const tSt = await toastText(s); await waitNoDialog(s); await sleep(1500);
  cyc = await q1(`select * from hr_review_cycles where name = ${lit(CY)}`);
  const nRev = await cnt(`select 1 from hr_performance_reviews where cycle_id = ${lit(cyc.id)}`);
  check(WF, "ui", "Start cycle + confirm shows the number of reviews created", new RegExp(`${expReviews} review`).test(tSt), tSt);
  check(WF, "db", `Cycle active; ${expReviews} reviews created (active/probation non-intern employees) with status self_review; employee@ notified`,
    cyc.status === "active" && cyc.started_at && nRev === expReviews && (await cnt(`select 1 from hr_performance_reviews where cycle_id = ${lit(cyc.id)} and status = 'self_review'`)) === nRev && (await cnt(`select 1 from hr_performance_reviews where cycle_id = ${lit(cyc.id)} and employee_id = ${lit(await empId("demo.intern1@example.com"))}`)) === 0
    && (await q(`select 1 from hr_notifications where recipient_user_id = ${lit(await userId(EMP))} and type = 'review_cycle_started' and title like ${lit(`%${CY}`)}`)).length === 1, `${nRev} reviews`);
  const rv3 = await q1(`select id from hr_performance_reviews where cycle_id = ${lit(cyc.id)} and employee_id = ${lit(e3)}`);
  const rv2 = await q1(`select id from hr_performance_reviews where cycle_id = ${lit(cyc.id)} and employee_id = ${lit(e2)}`);
  // HR sets goal A (agreed, weight 60, target 10) for employee@
  await s.go("/hr/performance/goals", 5000);
  await h(s, `ariaPick('Cycle', ${J(CY)})`); await sleep(1200); await h(s, "ariaPick('Employee', 'Demo Engineer 03')"); await sleep(2000);
  await h(s, "click('Add goal')"); await waitDialog(s); await sleep(500);
  await h(s, `fill('Title', ${J(GA)})`); await h(s, "fill('Weight', '60')"); await h(s, "fill('Target', '10')"); await h(s, "pickVal('Status', 'agreed')");
  await h(s, "click('Save', true)");
  const tGa = await toastText(s); await waitNoDialog(s); await sleep(1500);
  const gA = await q1(`select * from hr_goals where title = ${lit(GA)}`);
  check(WF, "ui", "HR adds an agreed goal (weight 60, target 10) for employee@ (toast 'Goal added.')", /Goal added/.test(tGa), tGa);
  check(WF, "db", "Goal A row: employee@, this cycle, weight 60, target 10, status agreed, score null (no actual)", gA && gA.employee_id === e3 && gA.cycle_id === cyc.id && Number(gA.weight) === 60 && Number(gA.target_value) === 10 && gA.status === "agreed" && gA.score === null);
  await s.close();

  // employee proposes a draft goal (20) and records the actual on the agreed goal
  s = await session();
  await login(s, EMP);
  await s.go("/employee/performance", 5000);
  await h(s, `secClick(${J(CY)}, 'Propose goal')`); await waitDialog(s); await sleep(500);
  await h(s, `fill('Title', ${J(GB)})`); await h(s, "fill('Weight', '50')"); await h(s, "click('Save', true)"); await sleep(600);
  const wErr = await h(s, "dialogText()");
  check(WF, "error", "Employee proposing a goal that takes the total over 100% (60 + 50) is rejected in the form", /Total weight would be 110%/.test(wErr) && (await cnt(`select 1 from hr_goals where title = ${lit(GB)}`)) === 0);
  await h(s, "fill('Weight', '20')"); await h(s, "fill('Target', '1')"); await h(s, "click('Save', true)");
  const tGb = await toastText(s); await waitNoDialog(s); await sleep(1200);
  const gB = await q1(`select * from hr_goals where title = ${lit(GB)}`);
  check(WF, "db", "Employee-proposed goal stored as draft (weight 20, created_by employee@)", /proposed as a draft/.test(tGb) && gB?.status === "draft" && Number(gB.weight) === 20 && gB.created_by === (await userId(EMP)), tGb);
  await h(s, `liClick(${J(GA)}, 'Update actual')`); await waitDialog(s); await sleep(400);
  await h(s, "fill('Actual value', '8')"); await h(s, "click('Save', true)");
  const tAct = await toastText(s); await waitNoDialog(s); await sleep(1200);
  const gA2 = await q1(`select actual_value, score, weight, status from hr_goals where id = ${lit(gA.id)}`);
  check(WF, "ui", "Employee 'Update actual' on the agreed goal (toast 'Actual value saved.')", /Actual value saved/.test(tAct), tAct);
  check(WF, "db", "Agreed goal: actual 8 stored, score computed by the DB = 8/10 = 80.00, weight/status unchanged", Number(gA2.actual_value) === 8 && Number(gA2.score) === 80 && Number(gA2.weight) === 60 && gA2.status === "agreed", J(gA2));
  const wEdit = await patch(EMP, `hr_goals?id=eq.${gA.id}`, { weight: 90 });
  check(WF, "permission", "Employee cannot change the weight of an agreed goal (API refused by trigger)", refused(wEdit) && /Only the actual value/.test(emsg(wEdit)) && Number((await q1(`select weight from hr_goals where id = ${lit(gA.id)}`)).weight) === 60, emsg(wEdit));
  // self-assessment
  await h(s, "tab('Self-assessment')"); await sleep(1500);
  const selfCard = await h(s, `secText(${J(CY)})`);
  await h(s, `secClick(${J(CY)}, 'Submit self-assessment')`); await sleep(500);
  const sErr = await h(s, `secText(${J(CY)})`);
  check(WF, "error", "Self-assessment without rating/text refused in the form", /Choose a rating/.test(sErr ?? "") && /Write your self-assessment/.test(sErr ?? "") && !(await q1(`select self_submitted_at from hr_performance_reviews where id = ${lit(rv3.id)}`)).self_submitted_at);
  await s.js(`(() => { ${H}; const sc = __h.sec(${J(CY)}); __h.setVal(__h.field('Overall self-rating', sc), '4'); __h.setVal(__h.field('Self-assessment', sc), ${J(`WF3 self-assessment: shipped feature, 8 of 10 ${RUN}`)}); })()`);
  await h(s, `secClick(${J(CY)}, 'Submit self-assessment')`); await waitDialog(s); await h(s, "confirm()");
  const tSelf = await toastText(s); await waitNoDialog(s); await sleep(1500);
  let rv = await q1(`select * from hr_performance_reviews where id = ${lit(rv3.id)}`);
  check(WF, "ui", "Employee submits the self-assessment (confirm 'Submit'; toast)", Boolean(selfCard) && /Self-assessment submitted/.test(tSelf), tSelf);
  check(WF, "db", "Review: self_rating 4, self_submitted_at set, status manager_review; manager@ notified", rv.self_rating === 4 && rv.self_submitted_at && rv.status === "manager_review" && (await notifs(MGR, "self_assessment_submitted", rv3.id)).length === 1);
  const again = await rpc(EMP, "hr_submit_self_assessment", { p_review: rv3.id, p_assessment: "second attempt", p_rating: 1 });
  check(WF, "error", "Second self-assessment submit refused ('already been submitted'); first kept", refused(again) && /already been submitted/.test(emsg(again)) && (await q1(`select self_rating from hr_performance_reviews where id = ${lit(rv3.id)}`)).self_rating === 4, emsg(again));
  await s.close();

  // manager: goal C over budget (UI + API), then a valid goal C; manager assessment
  s = await session();
  await login(s, MGR);
  await s.go("/hr/performance/goals", 5000);
  await h(s, `ariaPick('Cycle', ${J(CY)})`); await sleep(1200); await h(s, "ariaPick('Employee', 'Demo Engineer 03')"); await sleep(2000);
  await h(s, "click('Add goal')"); await waitDialog(s); await sleep(500);
  await h(s, `fill('Title', ${J(GX)})`); await h(s, "fill('Weight', '30')"); await h(s, "click('Save', true)"); await sleep(600);
  const mErr = await h(s, "dialogText()");
  const apiOver = await post(MGR, "hr_goals", { employee_id: e3, cycle_id: cyc.id, title: GX, weight: 30 });
  check(WF, "error", "Goal weights > 100% (60 + 20 + 30) rejected: form message and server trigger; nothing written", /Total weight would be 110%/.test(mErr) && refused(apiOver) && /would total 110/.test(emsg(apiOver)) && (await cnt(`select 1 from hr_goals where title = ${lit(GX)}`)) === 0, emsg(apiOver));
  await h(s, `fill('Title', ${J(GC)})`); await h(s, "fill('Weight', '20')"); await h(s, "fill('Target', '5')"); await h(s, "fill('Actual', '5')"); await h(s, "pickVal('Status', 'in_progress')");
  await h(s, "click('Save', true)");
  const tGc = await toastText(s); await waitNoDialog(s); await sleep(1500);
  const gC = await q1(`select * from hr_goals where title = ${lit(GC)}`);
  const wt = (await q1(`select sum(weight)::numeric w from hr_goals where cycle_id = ${lit(cyc.id)} and employee_id = ${lit(e3)}`)).w;
  check(WF, "db", "Manager-set goal C (weight 20, target 5, actual 5 → score 100.00); total weight 100", /Goal added/.test(tGc) && Number(gC?.score) === 100 && Number(wt) === 100, `score ${gC?.score}; total ${wt}`);
  check(WF, "ui", "Goals tab shows the 100% / 100% weight bar for employee@", /100% \/ 100%/.test(await h(s, "main()")));
  const mgrE2Goal = await post(MGR, "hr_goals", { employee_id: e2, cycle_id: cyc.id, title: `WF3 not my team ${RUN}`, weight: 10 });
  check(WF, "permission", "Manager cannot set goals for employee2 (other team) — API insert refused", refused(mgrE2Goal), wdesc(mgrE2Goal));
  // manager assessment
  await s.go("/hr/performance/reviews", 5000);
  await h(s, `ariaPick('Cycle', ${J(CY)})`); await sleep(2500);
  const mgrRevList = await h(s, "main()");
  check(WF, "permission", "Manager reviews list (team scope) includes Demo Engineer 03, not Demo Designer", mgrRevList.includes("Demo Engineer 03") && !mgrRevList.includes("Demo Designer"));
  await h(s, "rowClick('Demo Engineer 03')"); await waitDialog(s); await sleep(2000);
  await h(s, "click('Submit assessment', true)"); await sleep(500);
  check(WF, "error", "Manager assessment without text refused in the modal", /Write the manager assessment/.test(await h(s, "dialogText()")) && !(await q1(`select manager_submitted_at from hr_performance_reviews where id = ${lit(rv3.id)}`)).manager_submitted_at);
  await h(s, "pickVal('Rating', '4')"); await h(s, `fill('Assessment', ${J(`WF3 manager assessment: strong delivery ${RUN}`)})`);
  await h(s, "click('Submit assessment', true)");
  const tMa = await toastText(s); await sleep(1500);
  rv = await q1(`select * from hr_performance_reviews where id = ${lit(rv3.id)}`);
  check(WF, "ui", "Manager submits the assessment in the review modal (toast)", /Manager assessment saved/.test(tMa), tMa);
  check(WF, "db", "Review: manager_rating 4, manager_assessment stored, manager_submitted_at set, status manager_review", rv.manager_rating === 4 && /strong delivery/.test(rv.manager_assessment) && rv.manager_submitted_at && rv.status === "manager_review");
  await h(s, "cancel()"); await waitNoDialog(s);
  const mE2 = await rpc(MGR, "hr_submit_manager_assessment", { p_review: rv2.id, p_assessment: "not my team", p_rating: 3 });
  check(WF, "permission", "Manager assessment for employee2 (other team) refused by the server", refused(mE2) && /not allowed to review/.test(emsg(mE2)), emsg(mE2));
  // feedback: shared + private
  await s.go("/hr/performance/feedback", 5000);
  await h(s, "click('Give feedback')"); await waitDialog(s); await sleep(800);
  await h(s, "pickText('About', 'Demo Engineer 03')"); await h(s, "click('Submit', true)"); await sleep(500);
  check(WF, "error", "Feedback without text refused ('Write the feedback.')", /Write the feedback/.test(await h(s, "dialogText()")));
  await h(s, "pickVal('Type', 'praise')"); await h(s, "pickVal('Visibility', 'manager_and_employee')"); await h(s, `fill('Feedback', ${J(`WF3 shared praise ${RUN}`)})`);
  await h(s, "click('Submit', true)");
  const tF1 = await toastText(s); await waitNoDialog(s); await sleep(1000);
  await h(s, "click('Give feedback')"); await waitDialog(s); await sleep(800);
  await h(s, "pickText('About', 'Demo Engineer 03')"); await h(s, "pickVal('Type', 'note')"); await h(s, "pickVal('Visibility', 'private_to_hr')"); await h(s, `fill('Feedback', ${J(`WF3 private HR note ${RUN}`)})`);
  await h(s, "click('Submit', true)");
  const tF2 = await toastText(s); await waitNoDialog(s); await sleep(1000);
  const fb = await q(`select visibility, from_employee_id, body from hr_performance_feedback where body like ${lit(`WF3 % ${RUN}`)} order by created_at`);
  check(WF, "ui", "Manager gives shared praise and a private-to-HR note (toasts)", /Feedback shared/.test(tF1) && /private to HR/.test(tF2), `${tF1} | ${tF2}`);
  check(WF, "db", "Two feedback rows with the chosen visibility, author = manager (Eng Lead); only the shared one notifies the employee",
    fb.length === 2 && fb[0].visibility === "manager_and_employee" && fb[1].visibility === "private_to_hr" && fb.every((f) => f.from_employee_id === lead3) && (await q(`select 1 from hr_notifications where recipient_user_id = ${lit(await userId(EMP))} and type = 'performance_feedback' and body like ${lit(`%${RUN}`)}`)).length === 1);
  await s.close();

  // before finalization: employee does not see manager fields
  const before = (await rpc(EMP, "hr_my_performance_reviews")).body?.find((x) => x.cycle_id === cyc.id);
  const ownSel = await sel(EMP, `hr_performance_reviews?select=id,manager_rating&id=eq.${rv3.id}`);
  check(WF, "permission", "Before finalization: hr_my_performance_reviews hides manager rating/assessment/score; direct select of own review returns 0 rows",
    before && before.self_rating === 4 && before.manager_rating == null && before.manager_assessment == null && before.final_rating == null && ownSel.body?.length === 0, J(before)?.slice(0, 200));
  const empFin = await rpc(EMP, "hr_finalize_performance_review", { p_review: rv3.id, p_final_rating: 5 });
  check(WF, "permission", "Employee cannot finalize a review (RPC refused)", refused(empFin) && /not allowed to finalize/.test(emsg(empFin)), emsg(empFin));
  const hrE2Goal = await post(HR, "hr_goals", { employee_id: e2, cycle_id: cyc.id, title: `WF3 employee2 goal ${RUN}`, weight: 10, status: "agreed" });
  const g2 = await q1(`select id from hr_goals where title = ${lit(`WF3 employee2 goal ${RUN}`)}`);
  const empEdit2 = g2 ? await patch(EMP, `hr_goals?id=eq.${g2.id}`, { actual_value: 99 }) : { status: 0 };
  const empDelA = await del(EMP, `hr_goals?id=eq.${gA.id}`);
  check(WF, "permission", "Employee cannot edit employee2's goal or delete an agreed goal (0 rows / refused)", g2 && blockedWrite(empEdit2) && blockedWrite(empDelA) && (await q1(`select actual_value from hr_goals where id = ${lit(g2.id)}`)).actual_value === null && (await cnt(`select 1 from hr_goals where id = ${lit(gA.id)}`)) === 1,
    `edit ${wdesc(empEdit2)}; delete ${wdesc(empDelA)}; HR goal insert ${hrE2Goal.status}`);
  await as(EMP, async (sx) => {
    await sx.go("/employee/performance", 5000); await h(sx, "tab('My reviews')"); await sleep(1200);
    const t = await h(sx, `secText(${J(CY)})`);
    check(WF, "permission", "Employee 'My reviews' before finalization: no manager assessment / ratings shown", /shown here once the review is finalized/.test(t ?? "") && !(t ?? "").includes("strong delivery"), (t ?? "").slice(0, 160));
    await sx.go("/hr/performance", 3000);
    check(WF, "permission", "Employee UI: /hr/performance blocked", /Not authorised/.test(await h(sx, "text()")));
  });

  // HR: compute scores, finalize
  s = await session();
  await login(s, HR);
  await s.go("/hr/performance/cycles", 5000);
  await h(s, `rowClick(${J(CY)}, 'Compute scores')`); await waitDialog(s); await h(s, "confirm()");
  const tCo = await toastText(s); await waitNoDialog(s); await sleep(1500);
  rv = await q1(`select * from hr_performance_reviews where id = ${lit(rv3.id)}`);
  check(WF, "ui", "HR 'Compute scores' + confirm (toast with goals scored / reviews updated)", /Scored \d+ goal/.test(tCo), tCo);
  check(WF, "db", "Weighted goal score = (80×60 + 100×20) / 80 = 85.00 (draft goal without actual excluded)", Number(rv.goal_score) === 85, `goal_score ${rv.goal_score}`);
  await s.go("/hr/performance/reviews", 5000);
  await h(s, `ariaPick('Cycle', ${J(CY)})`); await sleep(2500);
  await h(s, "rowClick('Demo Engineer 03')"); await waitDialog(s); await sleep(2000);
  await h(s, "fill('Final rating', '6')"); await h(s, "click('Finalize', true)"); await sleep(500);
  check(WF, "error", "Final rating outside 1–5 refused in the modal", /Final rating must be between 1 and 5/.test(await h(s, "dialogText()")) && (await q1(`select status from hr_performance_reviews where id = ${lit(rv3.id)}`)).status !== "finalized");
  await h(s, "fill('Final rating', '3.75')"); await h(s, "click('Finalize', true)"); await sleep(800); await h(s, "confirm()");
  const tFi = await toastText(s); await sleep(1500);
  rv = await q1(`select * from hr_performance_reviews where id = ${lit(rv3.id)}`);
  check(WF, "ui", "HR finalizes with 3.75 (confirm dialog; toast 'Review finalized.')", /Review finalized/.test(tFi), tFi);
  check(WF, "db", "Review finalized: final_rating 3.75, finalized_at, calibrated_by HR; employee notified (review_finalized)", rv.status === "finalized" && Number(rv.final_rating) === 3.75 && rv.finalized_at && rv.calibrated_by === (await empId("demo.hr@example.com")) && (await notifs(EMP, "review_finalized", rv3.id)).length === 1);
  const fin2 = await rpc(HR, "hr_finalize_performance_review", { p_review: rv3.id, p_final_rating: 2 });
  check(WF, "error", "Finalizing twice refused; rating unchanged", refused(fin2) && /already been finalized/.test(emsg(fin2)) && Number((await q1(`select final_rating from hr_performance_reviews where id = ${lit(rv3.id)}`)).final_rating) === 3.75, emsg(fin2));
  await h(s, "cancel()"); await waitNoDialog(s);
  await s.reload(5000); await h(s, `ariaPick('Cycle', ${J(CY)})`); await sleep(2500);
  check(WF, "refresh", "After reload HR reviews list shows employee@ finalized with final 3.75 and goal score 85%", /finalized/.test(await h(s, "rowText('Demo Engineer 03')") ?? "") && /3\.75/.test(await h(s, "rowText('Demo Engineer 03')") ?? "") && /85%/.test(await h(s, "rowText('Demo Engineer 03')") ?? ""), await h(s, "rowText('Demo Engineer 03')"));
  await s.shot("performance-hr-finalized");
  await s.close();

  // employee after finalization
  const after = (await rpc(EMP, "hr_my_performance_reviews")).body?.find((x) => x.cycle_id === cyc.id);
  check(WF, "db", "After finalization hr_my_performance_reviews returns manager rating 4, goal score 85, final 3.75", after?.manager_rating === 4 && Number(after.goal_score) === 85 && Number(after.final_rating) === 3.75 && /strong delivery/.test(after.manager_assessment ?? ""), J(after)?.slice(0, 200));
  await as(EMP, async (sx) => {
    await sx.go("/employee/performance", 5000); await h(sx, "tab('My reviews')"); await sleep(1500);
    const t = await h(sx, `secText(${J(CY)})`);
    check(WF, "refresh", "Employee 'My reviews' (fresh load) shows Final 3.75 / 5, Manager 4 / 5 and the manager assessment", /3\.75 \/ 5/.test(t ?? "") && /4 \/ 5/.test(t ?? "") && (t ?? "").includes("strong delivery"), (t ?? "").replace(/\s+/g, " ").slice(0, 200));
    await sx.shot("performance-employee-finalized");
    await h(sx, "tab('Feedback')"); await sleep(1200);
    const f = await h(sx, "main()");
    check(WF, "permission", "Employee Feedback tab shows the shared praise only, not the private-to-HR note", f.includes(`WF3 shared praise ${RUN}`) && !f.includes(`WF3 private HR note ${RUN}`));
  });
  const fbApi = await sel(EMP, `hr_performance_feedback?select=body,visibility&employee_id=eq.${e3}`);
  check(WF, "permission", "Employee API select of feedback about them excludes private-to-HR rows", fbApi.status === 200 && fbApi.body.some((f) => f.body === `WF3 shared praise ${RUN}`) && !fbApi.body.some((f) => f.visibility === "private_to_hr"), `${fbApi.body?.length} rows`);
  const hrFb = await sel(HR, `hr_performance_feedback?select=body&body=like.*${RUN}*`);
  check(WF, "permission", "HR (performance.view) can read both feedback rows", hrFb.body?.length === 2, `${hrFb.body?.length} rows`);
}

// ==================================================================== 4. HR REQUESTS
async function wfRequests() {
  const WF = "requests";
  const e3 = await empId("demo.engineer3@example.com");
  const SUBJ = `WF3 laptop policy question ${RUN}`, PUB = `WF3 public reply from HR ${RUN}`, INT = `WF3 internal note ${RUN}`, EREPLY = `WF3 employee follow-up ${RUN}`;
  const nReq = async () => cnt(`select 1 from hr_requests where employee_id = ${lit(e3)}`);
  let s = await session();
  await login(s, EMP);
  await s.go("/employee/requests", 4500);
  const n0 = await nReq();
  await h(s, "click('New request')"); await waitDialog(s); await sleep(1200);
  await h(s, "click('Submit', true)"); await sleep(600);
  const vErr = await h(s, "dialogText()");
  check(WF, "error", "Empty request refused: category, subject (3–200) and description messages; nothing written", /Choose a category/.test(vErr) && /Enter a subject/.test(vErr) && /Describe your request/.test(vErr) && (await nReq()) === n0);
  await h(s, "pickText('Category', 'General query')"); await h(s, "fill('Subject', 'ab')"); await h(s, "fill('Description', 'x')");
  await h(s, "click('Submit', true)"); await sleep(600);
  check(WF, "error", "Two-character subject refused in the form", /Enter a subject \(3 to 200/.test(await h(s, "dialogText()")) && (await nReq()) === n0);
  const apiBad = await rpc(EMP, "hr_create_hr_request", { p_category: "general", p_subject: "WF3 no description", p_description: "  ", p_priority: "medium" });
  check(WF, "error", "Server refuses a request without a description", refused(apiBad) && /Describe your request/.test(emsg(apiBad)) && (await nReq()) === n0, emsg(apiBad));
  await h(s, `fill('Subject', ${J(SUBJ)})`); await h(s, "pickVal('Priority', 'high')"); await h(s, "fill('Description', 'Can I take the company laptop home on weekends? (synthetic)')");
  await h(s, "click('Submit', true)");
  const tNew = await toastText(s); await sleep(2500);
  const R = await q1(`select * from hr_requests where subject = ${lit(SUBJ)}`);
  check(WF, "ui", "Employee submits a request; toast and redirect to the request page", /Request submitted/.test(tNew) && (await s.js("location.pathname")) === `/employee/requests/${R?.id}`, `${tNew}; ${await s.js("location.pathname")}`);
  check(WF, "db", "Request row: open, high, general, not confidential, SLA due = created + 48 h; HR admin notified (New HR request)",
    R?.status === "open" && R.priority === "high" && !R.is_confidential && Math.round((new Date(R.sla_due_at) - new Date(R.created_at)) / 3600000) === 48
    && (await notifs(HR, "hr_request", R.id)).some((n) => /New HR request: General query/.test(n.title)), R ? `sla ${R.sla_due_at}` : "none");
  await s.close();

  // HR: assign to me, public reply, internal note, waiting_on_employee
  s = await session();
  await login(s, HR);
  await s.go(`/hr/requests/${R.id}`, 5000);
  await h(s, "click('Assign to me')");
  const tAs = await toastText(s); await sleep(1500);
  let r = await q1(`select * from hr_requests where id = ${lit(R.id)}`);
  check(WF, "db", "Assign to me: assigned_to = HR employee, status open → in_progress", /assigned to you/.test(tAs) && r.assigned_to === (await empId("demo.hr@example.com")) && r.status === "in_progress", `${tAs}; ${r.status}`);
  await h(s, "click('Send reply')"); await sleep(500);
  check(WF, "error", "Empty reply refused ('Write a message first.')", /Write a message first/.test((await h(s, "alerts()")).join(" ")));
  await h(s, `fill('Message', ${J(PUB)})`); await h(s, "click('Send reply')");
  const tPub = await toastText(s); await sleep(1500);
  await h(s, `fill('Message', ${J(INT)})`); await h(s, "click('Add internal note')");
  const tInt = await toastText(s); await sleep(1500);
  const cm = await q(`select body, is_internal, author_employee_id from hr_request_comments where request_id = ${lit(R.id)} order by created_at`);
  check(WF, "ui", "HR sends a public reply and adds an internal note (toasts)", /Reply sent/.test(tPub) && /Internal note added/.test(tInt), `${tPub} | ${tInt}`);
  check(WF, "db", "Comments: public reply (is_internal false) + internal note (true); employee notified once ('HR responded')",
    cm.length === 2 && cm[0].body === PUB && !cm[0].is_internal && cm[1].body === INT && cm[1].is_internal && (await q(`select 1 from hr_notifications where recipient_user_id = ${lit(await userId(EMP))} and entity_id = ${lit(R.id)} and title = 'HR responded to your request'`)).length === 1);
  await h(s, "click('Change status')"); await waitDialog(s); await h(s, "pickVal('Status', 'waiting_on_employee')"); await h(s, "click('Update', true)");
  const tW = await toastText(s); await waitNoDialog(s); await sleep(1200);
  r = await q1(`select status from hr_requests where id = ${lit(R.id)}`);
  check(WF, "db", "Status → waiting_on_employee; employee notified", r.status === "waiting_on_employee" && /waiting on employee/.test(tW) && (await q(`select 1 from hr_notifications where recipient_user_id = ${lit(await userId(EMP))} and entity_id = ${lit(R.id)} and title like '%waiting on employee'`)).length === 1, tW);
  await s.shot("requests-hr-detail");
  await s.close();

  // employee sees public reply but not the internal note; replies -> in_progress
  s = await session();
  await login(s, EMP);
  await s.go(`/employee/requests/${R.id}`, 5000);
  const eTxt = await h(s, "main()");
  check(WF, "permission", "Employee UI shows HR's public reply but NOT the internal note", eTxt.includes(PUB) && !eTxt.includes(INT));
  const eCm = await sel(EMP, `hr_request_comments?select=body,is_internal&request_id=eq.${R.id}`);
  check(WF, "permission", "Employee API select of comments returns only non-internal rows", eCm.status === 200 && eCm.body.length === 1 && !eCm.body.some((c) => c.is_internal), `${eCm.body?.length} rows`);
  const intTry = await rpc(EMP, "hr_comment_hr_request", { p_request: R.id, p_body: "sneaky internal", p_internal: true });
  check(WF, "permission", "Employee cannot add an internal note (RPC refused)", refused(intTry) && /Only HR staff/.test(emsg(intTry)), emsg(intTry));
  await h(s, `fill('Reply to HR', ${J(EREPLY)})`); await h(s, "click('Send')");
  const tE = await toastText(s); await sleep(1500);
  r = await q1(`select status from hr_requests where id = ${lit(R.id)}`);
  check(WF, "db", "Employee reply moves waiting_on_employee → in_progress; assignee (HR) notified", /Message sent/.test(tE) && r.status === "in_progress" && (await q(`select 1 from hr_notifications where recipient_user_id = ${lit(await userId(HR))} and entity_id = ${lit(R.id)} and title like 'Requester replied%'`)).length === 1, `${tE}; ${r.status}`);
  const cancelBad = await rpc(EMP, "hr_cancel_hr_request", { p_request: R.id });
  check(WF, "error", "Employee cannot cancel a request that is already in progress", refused(cancelBad) && /Only open requests/.test(emsg(cancelBad)), emsg(cancelBad));
  await s.close();

  // HR resolves (resolution required)
  s = await session();
  await login(s, HR);
  await s.go(`/hr/requests/${R.id}`, 5000);
  check(WF, "ui", "HR sees the employee follow-up in the conversation", (await h(s, "main()")).includes(EREPLY));
  await h(s, "click('Change status')"); await waitDialog(s); await h(s, "pickVal('Status', 'resolved')"); await h(s, "click('Update', true)"); await sleep(600);
  check(WF, "error", "Resolving without a resolution refused ('Describe the resolution.'); status unchanged", /Describe the resolution/.test(await h(s, "dialogText()")) && (await q1(`select status from hr_requests where id = ${lit(R.id)}`)).status === "in_progress");
  const apiRes = await rpc(HR, "hr_update_hr_request_status", { p_request: R.id, p_status: "resolved", p_resolution: null });
  check(WF, "error", "Server also refuses 'resolved' without a resolution", refused(apiRes) && /resolution/.test(emsg(apiRes)), emsg(apiRes));
  await h(s, `fill('Resolution', ${J(`WF3 yes, with manager approval ${RUN}`)})`); await h(s, "click('Update', true)");
  const tRes = await toastText(s); await waitNoDialog(s); await sleep(1200);
  r = await q1(`select * from hr_requests where id = ${lit(R.id)}`);
  check(WF, "db", "Resolved: status resolved, resolution text, resolved_at set; employee notified", /now resolved/.test(tRes) && r.status === "resolved" && /manager approval/.test(r.resolution) && r.resolved_at && (await q(`select 1 from hr_notifications where recipient_user_id = ${lit(await userId(EMP))} and entity_id = ${lit(R.id)} and title like '%now resolved'`)).length === 1, tRes);
  await s.reload(5000);
  const hrRef = await h(s, "main()");
  check(WF, "refresh", "After reload HR detail shows resolved, the resolution and the internal note (marked)", /resolved/.test(hrRef) && hrRef.includes("manager approval") && hrRef.includes(INT) && /internal note — not visible to the requester/.test(hrRef));
  await s.close();

  // employee closes, then reopens within the window
  s = await session();
  await login(s, EMP);
  await s.go(`/employee/requests/${R.id}`, 5000);
  await h(s, "click('Confirm & close')"); await waitDialog(s); await h(s, "confirm()");
  const tCl = await toastText(s); await waitNoDialog(s); await sleep(1200);
  r = await q1(`select status, closed_at from hr_requests where id = ${lit(R.id)}`);
  check(WF, "db", "Employee 'Confirm & close': status closed, closed_at set", /Request closed/.test(tCl) && r.status === "closed" && r.closed_at, tCl);
  const closedReply = await rpc(EMP, "hr_comment_hr_request", { p_request: R.id, p_body: "after close", p_internal: false });
  check(WF, "error", "Replying to a closed request refused ('Reopen it to continue')", refused(closedReply) && /closed/.test(emsg(closedReply)), emsg(closedReply));
  await h(s, "click('Reopen')"); await waitDialog(s); await h(s, `fill('Reason', ${J(`WF3 need it in writing ${RUN}`)})`); await h(s, "confirm()");
  const tRo = await toastText(s); await waitNoDialog(s); await sleep(1200);
  r = await q1(`select status, resolved_at, closed_at from hr_requests where id = ${lit(R.id)}`);
  const roCm = await q1(`select body from hr_request_comments where request_id = ${lit(R.id)} and body like 'Request reopened%'`);
  check(WF, "ui", "Employee reopens within the 7-day window (toast 'Request reopened.')", /Request reopened/.test(tRo), tRo);
  check(WF, "db", "Reopened: status open, resolved_at/closed_at cleared, 'Request reopened: …' comment, assignee notified", r.status === "open" && !r.resolved_at && !r.closed_at && /need it in writing/.test(roCm?.body ?? "") && (await q(`select 1 from hr_notifications where recipient_user_id = ${lit(await userId(HR))} and entity_id = ${lit(R.id)} and title like 'HR request reopened%'`)).length === 1);
  await s.reload(4500);
  const eRef = await h(s, "main()");
  check(WF, "refresh", "After reload the employee page shows status open, the public reply and the reopen comment (no internal note)", /\bopen\b/.test(eRef) && eRef.includes(PUB) && /Request reopened/.test(eRef) && !eRef.includes(INT));
  await s.shot("requests-employee-reopened");
  await s.close();

  // isolation: employee2 + manager + view-only + confidential grievance
  const e2Sel = await sel(EMP2, `hr_requests?select=id&id=eq.${R.id}`);
  const e2Cm = await sel(EMP2, `hr_request_comments?select=id&request_id=eq.${R.id}`);
  check(WF, "permission", "employee2 API cannot read employee@'s request or its comments (0 rows)", e2Sel.body?.length === 0 && e2Cm.body?.length === 0);
  await as(EMP2, async (sx) => {
    await sx.go(`/employee/requests/${R.id}`, 4500);
    const t = await h(sx, "main()");
    check(WF, "permission", "employee2 UI: opening employee@'s request URL shows 'Request not found'", /Request not found/.test(t) && !t.includes(SUBJ));
  });
  const G = (await rpc(EMP, "hr_create_hr_request", { p_category: "grievance", p_subject: `WF3 confidential grievance ${RUN}`, p_description: "Synthetic confidential concern (browser-flows-3).", p_priority: "medium" })).body;
  const gRow = await q1(`select is_confidential from hr_requests where id = ${lit(G)}`);
  const mgrG = await sel(MGR, `hr_requests?select=id&id=in.(${G},${R.id})`);
  const pa = "payroll.approver@example.com";
  const hasViewer = (await cnt(`select 1 from hr_user_roles ur join hr_role_permissions rp on rp.role_key = ur.role_key where ur.user_id = ${lit(await userId(pa))} and rp.permission_key = 'hr_requests.view'`)) > 0;
  const voG = await sel(pa, `hr_requests?select=id,is_confidential&id=in.(${G},${R.id})`);
  check(WF, "permission", "Grievance stored confidential; manager@ sees neither the grievance nor the general request (API 0 rows)", gRow?.is_confidential === true && mgrG.body?.length === 0, `manager rows ${mgrG.body?.length}`);
  check(WF, "permission", "View-only user (custom role with hr_requests.view): sees the general request but not the confidential grievance", hasViewer && voG.body?.length === 1 && voG.body[0].id === R.id, `viewer role ${hasViewer}; rows ${J(voG.body)}`);
  const voReply = await rpc(pa, "hr_comment_hr_request", { p_request: R.id, p_body: "view-only reply", p_internal: false });
  check(WF, "permission", "View-only user cannot reply (RPC refused)", refused(voReply) && /not allowed/.test(emsg(voReply)), emsg(voReply));
  await as(pa, async (sx) => {
    await sx.go("/hr/requests", 5000); await h(sx, "ariaPick('Status', 'All statuses')"); await sleep(2500);
    const t = await h(sx, "main()");
    check(WF, "permission", "View-only user's queue lists the general request but not the grievance", t.includes(SUBJ) && !t.includes(`WF3 confidential grievance ${RUN}`));
    await sx.go(`/hr/requests/${R.id}`, 4500);
    check(WF, "permission", "View-only user's request page is read-only (no Assign/Change status, 'Read-only' note)", /Read-only: replying needs hr_requests.manage/.test(await h(sx, "main()")) && !(await h(sx, "btn('Change status')")));
  });
  await as(HR, async (sx) => {
    await sx.go("/hr/requests", 5000);
    const t = await h(sx, "main()");
    check(WF, "permission", "HR (hr_requests.manage) queue shows the grievance with the confidential badge", t.includes(`WF3 confidential grievance ${RUN}`) && /confidential/.test(await h(sx, `rowText(${J(`WF3 confidential grievance ${RUN}`)})`) ?? ""));
  });
  const assignBad = await rpc(HR, "hr_assign_hr_request", { p_request: R.id, p_assignee: e3 });
  check(WF, "error", "Assigning a request to its requester refused", refused(assignBad) && /requester/.test(emsg(assignBad)), emsg(assignBad));
  // tidy: cancel the grievance (open) as the requester
  await rpc(EMP, "hr_cancel_hr_request", { p_request: G });
}

// ==================================================================== 5. HR SETTINGS
async function wfSettings() {
  const WF = "settings";
  const today = await TODAY();
  const hrUser = await userId(HR);
  const UP = RUN.toUpperCase();
  const DEP = `WF3 Department ${RUN}`, DCODE = `W3${UP}`.slice(0, 20), DES = `WF3 Designation ${RUN}`, LOC = `WF3 Office ${RUN}`, SH = `WF3 Shift ${RUN}`;
  const HOL = `WF3 Holiday ${RUN}`, LTC = `W3${UP}`.replace(/[^A-Z0-9_]/g, "").slice(0, 16), LTN = `WF3 Leave ${RUN}`, TK = `wf3.test_${RUN}`;
  const settingVal = async (k) => (await q1(`select value from hr_settings where key = ${lit(k)}`)).value;
  const origAtt = await settingVal("attendance"), origDr = await settingVal("daily_reports"), origLeave = await settingVal("leave"), origEid = await settingVal("employee_id");
  async function addRow(s, tab, fill, okToast) {
    await h(s, `tab(${J(tab)})`); await sleep(1800);
    await h(s, "click('Add')"); await waitDialog(s); await sleep(500);
    for (const step of fill) await h(s, step);
    await h(s, "click('Save', true)");
    const t = await toastText(s); await waitNoDialog(s); await sleep(1200);
    return t;
  }
  async function editRow(s, rowName, steps) {
    await h(s, `rowClick(${J(rowName)}, 'Edit')`); await waitDialog(s); await sleep(500);
    for (const step of steps) await h(s, step);
    await h(s, "click('Save', true)");
    const t = await toastText(s); await waitNoDialog(s); await sleep(1200);
    return t;
  }

  let s = await session();
  await login(s, HR);
  await s.go("/hr/settings", 5000);
  const hrTabs = await h(s, "tabs()");
  check(WF, "permission", "hr.admin (no roles.manage) sees settings tabs but NOT 'Roles & permissions'", hrTabs.includes("Departments") && hrTabs.includes("Audit log") && !hrTabs.includes("Roles & permissions"), hrTabs.join(", "));
  // ---------- departments
  await h(s, "tab('Departments')"); await sleep(1800);
  await h(s, "click('Add')"); await waitDialog(s); await sleep(500);
  await h(s, "fill('Code', 'x')"); await h(s, `fill('Name', ${J(DEP)})`); await h(s, "click('Save', true)"); await sleep(600);
  check(WF, "error", "Department code 'x' rejected ('2–20 letters, digits, _ or -.'); nothing written", /2–20 letters, digits, _ or -/.test(await h(s, "dialogText()")) && (await cnt(`select 1 from hr_departments where name = ${lit(DEP)}`)) === 0);
  await h(s, "fill('Code', 'ENG')"); await h(s, "click('Save', true)"); await sleep(1500);
  check(WF, "error", "Duplicate department code ENG refused by the server ('already exists'); nothing written", /already exists/.test(await h(s, "dialogText()")) && (await cnt(`select 1 from hr_departments where name = ${lit(DEP)}`)) === 0, (await h(s, "alerts()")).join(" | "));
  await h(s, `fill('Code', ${J(DCODE.toLowerCase())})`); await h(s, "pickText('Parent department', 'Engineering')"); await h(s, "click('Save', true)");
  const tD = await toastText(s); await waitNoDialog(s); await sleep(1200);
  let dep = await q1(`select * from hr_departments where name = ${lit(DEP)}`);
  check(WF, "ui", "Department created via Add → Save (toast)", /department created/.test(tD), tD);
  check(WF, "db", "Department row: code upper-cased, parent Engineering, active", dep?.code === DCODE && dep.active && dep.parent_id === (await q1("select id from hr_departments where code = 'ENG'")).id, J(dep && { code: dep.code, active: dep.active }));
  const tDe = await editRow(s, DEP, [`fill('Name', ${J(`${DEP} (edited)`)})`]);
  const tDx = await editRow(s, `${DEP} (edited)`, ["tick('Active', false)"]);
  dep = await q1(`select * from hr_departments where id = ${lit(dep.id)}`);
  check(WF, "db", "Department edited (name) then deactivated (active false)", /updated/.test(tDe) && /updated/.test(tDx) && dep.name === `${DEP} (edited)` && dep.active === false, `${dep.name} active=${dep.active}`);
  // ---------- designations
  const tDs = await addRow(s, "Designations", [`fill('Name', ${J(DES)})`, "pickText('Department', 'Engineering')", "fill('Level', '25')"], "");
  const desErr = await h(s, "dialogText()");
  if (/must be between 1 and 20/.test(desErr)) {
    check(WF, "error", "Designation level 25 rejected ('Level (1–20) must be between 1 and 20.')", (await cnt(`select 1 from hr_designations where name = ${lit(DES)}`)) === 0);
    await h(s, "fill('Level', '3')"); await h(s, "click('Save', true)"); await toastText(s); await waitNoDialog(s); await sleep(1200);
  } else check(WF, "error", "Designation level 25 rejected", false, `${tDs} ${desErr}`);
  await editRow(s, DES, ["fill('Level', '4')"]);
  await editRow(s, DES, ["tick('Active', false)"]);
  const des = await q1(`select * from hr_designations where name = ${lit(DES)}`);
  check(WF, "db", "Designation created (Engineering, level 3), edited to level 4, deactivated", des?.level === 4 && des.active === false && des.department_id === (await q1("select id from hr_departments where code = 'ENG'")).id, J(des && { level: des.level, active: des.active }));
  // ---------- locations
  await addRow(s, "Locations", ["fill('Name', '')", "fill('City', 'Guntur')"], "");
  check(WF, "error", "Location without a name rejected ('Name is required.')", /Name is required/.test(await h(s, "dialogText()")));
  await h(s, `fill('Name', ${J(LOC)})`); await h(s, "click('Save', true)"); await toastText(s); await waitNoDialog(s); await sleep(1200);
  await editRow(s, LOC, ["fill('City', 'Vijayawada')"]);
  await editRow(s, LOC, ["tick('Active', false)"]);
  const loc = await q1(`select * from hr_locations where name = ${lit(LOC)}`);
  check(WF, "db", "Location created (timezone Asia/Kolkata), city edited, deactivated", loc?.city === "Vijayawada" && loc.timezone === "Asia/Kolkata" && loc.active === false, J(loc && { city: loc.city, tz: loc.timezone, active: loc.active }));
  // ---------- shifts
  await addRow(s, "Shifts & working days", [`fill('Name', ${J(SH)})`, "fill('Start', '10:00')", "fill('End', '19:00')", "fill('Late grace', '300')", "tick('Sat', true)"], "");
  check(WF, "error", "Shift grace 300 rejected ('Late grace (minutes) must be between 0 and 240.')", /must be between 0 and 240/.test(await h(s, "dialogText()")) && (await cnt(`select 1 from hr_shifts where name = ${lit(SH)}`)) === 0);
  await h(s, "fill('Late grace', '15')"); await h(s, "fill('End', '10:00')"); await h(s, "click('Save', true)"); await sleep(1500);
  check(WF, "error", "Shift with start = end refused by the server (check constraint → 'One of the values is not valid.')", /not valid/.test(await h(s, "dialogText()")) && (await cnt(`select 1 from hr_shifts where name = ${lit(SH)}`)) === 0, (await h(s, "alerts()")).join(" | "));
  await h(s, "fill('End', '19:00')"); await h(s, "click('Save', true)"); const tSh = await toastText(s); await waitNoDialog(s); await sleep(1200);
  let sh = await q1(`select * from hr_shifts where name = ${lit(SH)}`);
  check(WF, "db", "Shift saved: 10:00–19:00, grace 15, working days Mon–Sat {1..6}, not default", /shift created/.test(tSh) && sh?.start_time === "10:00:00" && sh.grace_minutes === 15 && J(sh.working_days) === "[1,2,3,4,5,6]" && !sh.is_default, J(sh && { wd: sh.working_days, grace: sh.grace_minutes }));
  await editRow(s, SH, ["fill('Late grace', '20')", "tick('Sat', false)"]);
  await editRow(s, SH, ["tick('Active', false)"]);
  sh = await q1(`select * from hr_shifts where name = ${lit(SH)}`);
  check(WF, "db", "Shift edited (grace 20, Saturday removed → {1..5}) and deactivated", sh.grace_minutes === 20 && J(sh.working_days) === "[1,2,3,4,5]" && sh.active === false, J({ wd: sh.working_days, grace: sh.grace_minutes, active: sh.active }));
  // ---------- holidays (+ effect on the leave day count)
  const year = today.slice(0, 4);
  const taken = new Set((await q("select holiday_date::text d from hr_holidays")).map((x) => x.d));
  const lvOcc = await q(`select start_date::text s, end_date::text e from hr_leave_requests where status in ('pending_approval','approved')`);
  let HD = null; for (let d = addD(today, 20); d.slice(0, 4) === year; d = addD(d, 1)) if (isoDow(d) === 3 && !taken.has(d)) { HD = d; break; }
  const mon = HD && addD(HD, -2), fri = HD && addD(HD, 2);
  const cl = (await q1("select id from hr_leave_types where code = 'CL'")).id;
  const daysBefore = HD ? (await rpc(EMP, "hr_leave_calculate_days", { p_leave_type: cl, p_start: mon, p_end: fri })).body : null;
  await addRow(s, "Holidays", [`fill('Date', ${J(HD)})`, "fill('Name', 'X')"], "");
  check(WF, "error", "Holiday name 'X' rejected ('2–120 characters.')", /2–120 characters/.test(await h(s, "dialogText()")) && (await cnt(`select 1 from hr_holidays where holiday_date = ${lit(HD)}`)) === 0);
  await h(s, `fill('Name', ${J(HOL)})`); await h(s, "pickVal('Type', 'company')"); await h(s, "click('Save', true)");
  const tHo = await toastText(s); await waitNoDialog(s); await sleep(1200);
  const hol = await q1(`select * from hr_holidays where name = ${lit(HOL)}`);
  const daysAfter = (await rpc(EMP, "hr_leave_calculate_days", { p_leave_type: cl, p_start: mon, p_end: fri })).body;
  check(WF, "db", `Holiday saved (${HD}, company, all locations); leave preview for ${mon}..${fri} drops ${daysBefore} → ${daysAfter}`, /holiday created/.test(tHo) && hol?.holiday_date === HD && hol.location_id === null && Number(daysBefore) === 5 && Number(daysAfter) === 4, tHo);
  await as(EMP, async (sx) => {
    await sx.go("/employee/leave", 4500);
    await h(sx, "click('Apply for leave')"); await waitDialog(sx); await sleep(1200);
    await h(sx, "pickText('Leave type', 'Casual Leave')"); await h(sx, `fill('From', ${J(mon)})`); await h(sx, `fill('To', ${J(fri)})`);
    await waitFor(sx, "dialogText().match(/counts as/)", 6000);
    const t = await h(sx, "dialogText()");
    check(WF, "ui", "Employee apply form preview for that Mon–Fri week counts 4 days (new holiday excluded)", /counts as\s+4\s/.test(t), t.match(/This request counts as[^\n]*/)?.[0]);
  });
  // ---------- leave types
  await addRow(s, "Leave types", ["fill('Code', '1BAD')", `fill('Name', ${J(LTN)})`, "fill('Annual entitlement', '3')"], "");
  check(WF, "error", "Leave type code '1BAD' rejected ('…starts with a letter.')", /starts with a letter/.test(await h(s, "dialogText()")) && (await cnt(`select 1 from hr_leave_types where name = ${lit(LTN)}`)) === 0);
  await h(s, `fill('Code', ${J(LTC.toLowerCase())})`); await h(s, "fill('Sort order', '60')");
  await h(s, "tick('Half days allowed', false)"); await h(s, "tick('Allow negative balance', true)"); await h(s, "fill('Max negative', '2')");
  await h(s, "click('Save', true)"); const tLt = await toastText(s); await waitNoDialog(s); await sleep(1200);
  let lt = await q1(`select * from hr_leave_types where name = ${lit(LTN)}`);
  check(WF, "db", "Leave type saved: code upper-cased, entitlement 3, half days off, negative allowed (max 2)", /leave type created/.test(tLt) && lt?.code === LTC && Number(lt.annual_entitlement) === 3 && lt.allow_half_day === false && lt.allow_negative === true && Number(lt.max_negative) === 2, J(lt && { code: lt.code, half: lt.allow_half_day, neg: lt.allow_negative }));
  await editRow(s, LTN, ["fill('Annual entitlement', '4')", "tick('Half days allowed', true)", "tick('Allow negative balance', false)"]);
  lt = await q1(`select * from hr_leave_types where name = ${lit(LTN)}`);
  check(WF, "db", "Leave type edited: entitlement 4, half days on, negative off (max_negative cleared)", Number(lt.annual_entitlement) === 4 && lt.allow_half_day && !lt.allow_negative && lt.max_negative === null);
  await editRow(s, LTN, ["tick('Active', false)"]);
  check(WF, "db", "Leave type deactivated (no delete)", (await q1(`select active from hr_leave_types where id = ${lit(lt.id)}`)).active === false);
  // ---------- module rules
  await h(s, "tab('Attendance, report, leave & payroll rules')"); await sleep(2000);
  await h(s, "secFill('Attendance', 'Correction window', '500')"); await h(s, "secClick('Attendance', 'Save')"); await sleep(600);
  check(WF, "error", "Attendance correction window 500 rejected ('…0 to 365 days.'); setting unchanged", /0 to 365 days/.test(await h(s, "secText('Attendance')")) && J(await settingVal("attendance")) === J(origAtt));
  await h(s, "secFill('Attendance', 'Correction window', '45')"); await h(s, "secClick('Attendance', 'Save')");
  const tAt = await toastText(s); await sleep(1200);
  await h(s, "secFill('Daily work reports', 'Reminder time', '18:30')"); await h(s, "secClick('Daily work reports', 'Save')");
  const tDr = await toastText(s); await sleep(1200);
  await h(s, "secFill('Leave', 'Apply up to (days ahead)', '0')"); await h(s, "secClick('Leave', 'Save')"); await sleep(600);
  const lvErr = await h(s, "secText('Leave')");
  await h(s, "secFill('Leave', 'Apply up to (days ahead)', '300')"); await h(s, "secClick('Leave', 'Save')");
  const tLv = await toastText(s); await sleep(1200);
  const att = await settingVal("attendance"), dr = await settingVal("daily_reports"), lv = await settingVal("leave");
  check(WF, "error", "Leave advance limit 0 rejected ('…1 to 730 days.')", /1 to 730 days/.test(lvErr ?? ""));
  check(WF, "ui", "Attendance / daily-report / leave rule sections saved (toasts)", /Attendance rules saved/.test(tAt) && /Daily report rules saved/.test(tDr) && /Leave rules saved/.test(tLv), `${tAt} | ${tDr} | ${tLv}`);
  check(WF, "db", "hr_settings updated: correction_window_days 45, reminder_time 18:30, max_advance_days 300; other keys preserved",
    att.correction_window_days === 45 && att.overnight_checkout_hours === origAtt.overnight_checkout_hours && dr.reminder_time === "18:30" && dr.reminder_enabled === origDr.reminder_enabled && lv.max_advance_days === 300 && lv.approval_flow === origLeave.approval_flow, J({ att, dr: dr.reminder_time, lv: lv.max_advance_days }));
  await s.reload(4500); await h(s, "tab('Attendance, report, leave & payroll rules')"); await sleep(2000);
  check(WF, "refresh", "After reload the rule fields show 45 / 18:30 / 300", (await s.js(`(() => { ${H}; return [__h.field('Correction window', __h.sec('Attendance')).value, __h.field('Reminder time', __h.sec('Daily work reports')).value, __h.field('Apply up to (days ahead)', __h.sec('Leave')).value].join('|'); })()`)) === "45|18:30|300");
  // restore (UI)
  await h(s, `secFill('Attendance', 'Correction window', ${J(String(origAtt.correction_window_days))})`); await h(s, "secClick('Attendance', 'Save')"); await toastText(s); await sleep(800);
  await h(s, `secFill('Daily work reports', 'Reminder time', ${J(origDr.reminder_time)})`); await h(s, "secClick('Daily work reports', 'Save')"); await toastText(s); await sleep(800);
  await h(s, `secFill('Leave', 'Apply up to (days ahead)', ${J(String(origLeave.max_advance_days))})`); await h(s, "secClick('Leave', 'Save')"); await toastText(s); await sleep(1000);
  check(WF, "db", "Rules restored to the original values through the UI", (await settingVal("attendance")).correction_window_days === origAtt.correction_window_days && (await settingVal("daily_reports")).reminder_time === origDr.reminder_time && (await settingVal("leave")).max_advance_days === origLeave.max_advance_days);
  // ---------- employee ID format
  await h(s, "tab('Employee ID')"); await sleep(1500);
  await h(s, "fill('Prefix', 'z-1')"); await h(s, "click('Save')"); await sleep(600);
  check(WF, "error", "Invalid employee-ID prefix rejected ('Prefix must be 1–8 uppercase letters or digits.'); setting unchanged", /Prefix must be 1–8 uppercase/.test(await h(s, "main()")) && J(await settingVal("employee_id")) === J(origEid));
  await h(s, "fill('Prefix', 'ztx')"); await h(s, "fill('Digits', '5')"); await sleep(300);
  const pv = (await h(s, "main()")).match(/Preview:\s*(\S+)/)?.[1];
  await h(s, "click('Save')"); const tEid = await toastText(s); await sleep(1200);
  const eid = await settingVal("employee_id");
  check(WF, "ui", "Employee ID preview shows ZTX-00001 and Save confirms", pv === "ZTX-00001" && /Employee ID format saved/.test(tEid), `${pv}; ${tEid}`);
  check(WF, "db", "hr_settings.employee_id = {prefix ZTX, separator -, padding 5}", eid.prefix === "ZTX" && eid.separator === "-" && eid.padding === 5, J(eid));
  await s.reload(4500); await h(s, "tab('Employee ID')"); await sleep(1500);
  check(WF, "refresh", "After reload the Employee ID tab shows prefix ZTX and preview ZTX-00001", (await h(s, "value('Prefix')")) === "ZTX" && /ZTX-00001/.test(await h(s, "main()")));
  await h(s, `fill('Prefix', ${J(origEid.prefix)})`); await h(s, `fill('Digits', ${J(String(origEid.padding))})`); await h(s, "click('Save')"); await toastText(s); await sleep(1000);
  check(WF, "db", "Employee ID format restored through the UI", ((e) => e.prefix === origEid.prefix && e.separator === origEid.separator && e.padding === origEid.padding)(await settingVal("employee_id")), J(await settingVal("employee_id")));
  // ---------- notification templates
  await addRow(s, "Notification templates", ["fill('Key', 'Bad Key')", "fill('Subject', 'x')", "fill('Body', 'y')"], "");
  check(WF, "error", "Template key 'Bad Key' rejected ('lowercase, digits, . and _ only.')", /lowercase, digits, \. and _ only/.test(await h(s, "dialogText()")));
  await h(s, `fill('Key', ${J(TK)})`); await h(s, `fill('Subject', ${J(`WF3 subject ${RUN}`)})`); await h(s, "fill('Body', 'Hello {{employee_name}} (synthetic)')"); await h(s, "click('Save', true)");
  const tTp = await toastText(s); await waitNoDialog(s); await sleep(1200);
  await editRow(s, TK, [`fill('Subject', ${J(`WF3 subject ${RUN} (edited)`)})`, "pickVal('Channel', 'both')"]);
  await editRow(s, TK, ["tick('Active', false)"]);
  const tpl = await q1(`select * from hr_notification_templates where key = ${lit(TK)}`);
  check(WF, "db", "Notification template created, edited (subject, channel both) and deactivated", /template created/.test(tTp) && /edited/.test(tpl?.subject ?? "") && tpl.channel === "both" && tpl.active === false, J(tpl && { ch: tpl.channel, active: tpl.active }));
  // ---------- refresh: departments list after reload
  await s.reload(4500); await h(s, "tab('Departments')"); await sleep(2000);
  const depRow = await h(s, `rowText(${J(`${DEP} (edited)`)})`);
  check(WF, "refresh", "After reload the Departments tab lists the edited department as inactive", /inactive/.test(depRow ?? "") && (depRow ?? "").includes(DCODE), depRow);
  await s.shot("settings-departments");
  // ---------- audit log
  await h(s, "tab('Audit log')"); await sleep(2000);
  await h(s, "fill('Table', 'hr_departments')"); await sleep(2500);
  const au = await h(s, "main()");
  const auDb = await q(`select action, actor_user_id from hr_audit_log where table_name = 'hr_departments' and record_id = ${lit(dep.id)} order by id`);
  const auSet = await cnt(`select 1 from hr_audit_log where table_name = 'hr_settings' and actor_user_id = ${lit(hrUser)} and occurred_at > now() - interval '30 minutes'`);
  const auOthers = await q(`select table_name, count(*)::int n from hr_audit_log where actor_user_id = ${lit(hrUser)} and table_name in ('hr_designations','hr_locations','hr_shifts','hr_holidays','hr_leave_types','hr_notification_templates') and occurred_at > now() - interval '30 minutes' group by 1`);
  check(WF, "db", "Audit rows: department INSERT + 2 UPDATEs by hr.admin; hr_settings and every other edited table audited", auDb.map((a) => a.action).join(",") === "INSERT,UPDATE,UPDATE" && auDb.every((a) => a.actor_user_id === hrUser) && auSet >= 8 && auOthers.length === 6, `${auDb.map((a) => a.action)}; settings ${auSet}; ${auOthers.map((x) => `${x.table_name}:${x.n}`).join(" ")}`);
  check(WF, "ui", "Audit log tab (filtered to hr_departments) shows the change rows with changed fields", /hr_departments/.test(au) && au.includes(dep.id.slice(0, 8)) && /active/.test(au));
  await s.shot("settings-audit");
  // holiday delete (cleanup through the UI)
  await h(s, "tab('Holidays')"); await sleep(2000);
  await h(s, `rowClick(${J(HOL)}, 'Delete')`); await waitDialog(s); await h(s, "confirm()");
  const tHd = await toastText(s); await waitNoDialog(s); await sleep(800);
  check(WF, "db", "Holiday deleted through the UI (cleanup); leave preview back to 5 days", /Holiday deleted/.test(tHd) && (await cnt(`select 1 from hr_holidays where name = ${lit(HOL)}`)) === 0 && Number((await rpc(EMP, "hr_leave_calculate_days", { p_leave_type: cl, p_start: mon, p_end: fri })).body) === 5, tHd);
  await s.close();

  // ---------- roles & permissions (super admin)
  const RK = `wfthree_role_${RUNL}`, RN = `WF3 Role ${RUN}`;
  s = await session();
  await login(s, SA);
  await s.go("/hr/settings", 5000);
  await h(s, "tab('Roles & permissions')"); await sleep(3000);
  await h(s, "click('New custom role')"); await waitDialog(s);
  await h(s, "fill('Key', 'Bad Key')"); await h(s, `fill('Name', ${J(RN)})`); await h(s, "click('Create', true)"); await sleep(500);
  check(WF, "error", "Role key 'Bad Key' rejected in the form; no role written", /Key: lowercase letters and underscores/.test(await h(s, "dialogText()")) && (await cnt(`select 1 from hr_roles where name = ${lit(RN)}`)) === 0);
  await h(s, `fill('Key', ${J(RK)})`); await h(s, "click('Create', true)");
  const tRo = await toastText(s); await waitNoDialog(s); await sleep(2500);
  const role = await q1(`select * from hr_roles where key = ${lit(RK)}`);
  check(WF, "db", "Custom role created (is_system false)", /Role created/.test(tRo) && role && role.is_system === false, tRo);
  const box = `${RN}: leave.view`;
  await h(s, `clickAria(${J(box)})`); await sleep(2000);
  const gOn = await cnt(`select 1 from hr_role_permissions where role_key = ${lit(RK)} and permission_key = 'leave.view'`);
  check(WF, "ui", "Super admin ticks 'leave.view' for the custom role in the matrix", (await h(s, `checked(${J(box)})`)) === true && gOn === 1);
  await s.reload(4500); await h(s, "tab('Roles & permissions')"); await sleep(3000);
  check(WF, "refresh", "After reload the matrix checkbox is still ticked", (await h(s, `checked(${J(box)})`)) === true);
  await s.shot("settings-roles-matrix");
  await h(s, `clickAria(${J(box)})`); await sleep(2000);
  const gOff = await cnt(`select 1 from hr_role_permissions where role_key = ${lit(RK)} and permission_key = 'leave.view'`);
  const auRp = await q(`select action from hr_audit_log where table_name = 'hr_role_permissions' and new_data->>'role_key' = ${lit(RK)} or (table_name = 'hr_role_permissions' and old_data->>'role_key' = ${lit(RK)}) order by id`);
  check(WF, "db", "Untick removes the grant; both changes are in the audit log (INSERT, DELETE)", gOff === 0 && auRp.map((a) => a.action).join(",") === "INSERT,DELETE", auRp.map((a) => a.action).join(","));
  await s.close();
  const hrGrant = await post(HR, "hr_role_permissions", { role_key: RK, permission_key: "leave.view" });
  check(WF, "permission", "hr.admin (no roles.manage) cannot grant permissions via the API", refused(hrGrant) && (await cnt(`select 1 from hr_role_permissions where role_key = ${lit(RK)}`)) === 0, wdesc(hrGrant));
  const sysRole = await patch(SA, "hr_roles?key=eq.hr_admin", { name: "Hacked HR" });
  check(WF, "permission", "Even the super admin cannot rename a system role via the API (RLS: not is_system)", blockedWrite(sysRole) && (await q1("select name from hr_roles where key = 'hr_admin'")).name === "HR Admin", wdesc(sysRole));

  // ---------- permissions: employee / manager
  await as(EMP, async (sx) => {
    await sx.go("/hr/settings", 3500);
    check(WF, "permission", "Employee UI: /hr/settings blocked ('Not authorised')", /Not authorised/.test(await h(sx, "text()")));
  });
  await as(MGR, async (sx) => {
    await sx.go("/hr/settings", 4500);
    const p = await sx.js("location.pathname");
    const t = await h(sx, "main()");
    check(WF, "permission", "Manager UI: /hr/settings not available (redirected away, no 'HR Settings' page or nav item)", p !== "/hr/settings" && !/HR Settings/.test(await h(sx, "text()")) && !t.includes("Departments"), p);
  });
  const empSet = await patch(EMP, "hr_settings?key=eq.company", { value: { name: "Hacked" } });
  const mgrSet = await patch(MGR, "hr_settings?key=eq.leave", { value: { approval_flow: "hr" } });
  const mgrDep = await post(MGR, "hr_departments", { code: "HACK", name: "Hacked dept" });
  const empDep = await patch(EMP, `hr_departments?id=eq.${dep.id}`, { name: "Hacked" });
  const empHol = await post(EMP, "hr_holidays", { holiday_date: addD(today, 40), name: "Hacked holiday", type: "company" });
  check(WF, "permission", "API writes refused for employee/manager: hr_settings update (0 rows), hr_departments insert/update, hr_holidays insert",
    blockedWrite(empSet) && blockedWrite(mgrSet) && refused(mgrDep) && blockedWrite(empDep) && refused(empHol)
    && (await settingVal("company")).name === "Zyllo Tech" && (await settingVal("leave")).approval_flow === origLeave.approval_flow && (await cnt("select 1 from hr_departments where code = 'HACK'")) === 0,
    `settings ${wdesc(empSet)} / ${wdesc(mgrSet)}; dept insert ${wdesc(mgrDep)}; dept update ${wdesc(empDep)}; holiday ${wdesc(empHol)}`);
}

// ------------------------------------------------------------------ main
async function applyExtraFixtures() {
  const r = await new Promise((resolve) => {
    const child = spawn(findPgBin()("psql"), ["-h", "127.0.0.1", "-p", String(STATE.pgPort), "-U", "hrms_local", "-d", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-f", path.join(ROOT, "supabase", "tests", "hrms-local", "extra_fixtures_3.sql")], { windowsHide: true });
    let err = ""; child.stderr.on("data", (d) => (err += d)); child.on("close", (code) => resolve({ ok: code === 0, err }));
  });
  if (!r.ok) throw new Error(`extra_fixtures_3.sql failed: ${r.err}`);
}
const WORKFLOWS = { reports: wfReports, leave: wfLeave, performance: wfPerformance, requests: wfRequests, settings: wfSettings };
const started = new Date().toISOString();
try {
  await applyExtraFixtures();
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

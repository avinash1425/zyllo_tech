#!/usr/bin/env node
// TEST-ONLY end-to-end Leave Management checks (Module 6, migration 160)
// against the LOCAL HRMS harness: apply (full / half day / supporting
// document), overlap and balance errors, cancel, two-level approval with the
// balance ledger, shared holiday change -> review -> recalculation, policy
// maker-checker, calendar privacy, permissions, refresh and mobile layout.
// Helpers are copied from browser-flows-4.mjs (same network guard: every
// non-127.0.0.1 request is blocked; DB access is read-only SELECTs).
//
//   node scripts/hrms-local/browser-flows-leave.mjs [--state <harness state json>] [--out results.json] [--shots dir]
//
// Synthetic data only (@example.com). Re-runnable: names carry a per-run suffix.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findPgBin, makePsql } from "./lib.mjs";

// ------------------------------------------------------------------ config
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STATE_FILE = arg("--state", path.join(tmpdir(), "zyllo-hrms-local.json"));
if (!existsSync(STATE_FILE)) { console.error(`No harness state at ${STATE_FILE}. Start it with node scripts/hrms-local/start.mjs`); process.exit(2); }
const STATE = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const API = `http://127.0.0.1:${STATE.apiPort}`;
const BASE = arg("--base", `http://127.0.0.1:${STATE.webPort}`);
const ANON = STATE.anonKey;
const OUT = arg("--out", path.join(tmpdir(), "hrms-flows6", "results.json"));
const ONLY = arg("--only", "").split(",").filter(Boolean);
const SHOTS = arg("--shots", path.join(tmpdir(), "hrms-flows6", "shots"));
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
  // --remote-debugging-port=0: Chrome picks a free port and writes it to DevToolsActivePort in
  // its own fresh profile, so this script can only ever attach to the browser it launched.
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-flow6-"));
  const proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  chromes.add(proc);
  let port;
  for (let i = 0; i < 80 && !port; i++) {
    await sleep(250);
    try { port = Number(readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]) || undefined; } catch {}
  }
  if (!port) { proc.kill(); throw new Error("Chrome did not report its debugging port"); }
  let target;
  for (let i = 0; i < 80 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
  if (!target) { proc.kill(); throw new Error("Chrome did not start"); }
  if (target.url !== "about:blank") { proc.kill(); throw new Error(`refusing to attach to a browser this script did not start (${target.url})`); }
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
    const file = `wf6-${name}.jpg`;
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
async function login(s, email, password = PASSWORD, attempt = 1) {
  await s.go("/login", 1500);
  // Cold Vite loads can take several seconds: wait for the form before filling it.
  for (let i = 0; i < 60 && !(await s.js("!!document.querySelector('input[name=\"email\"]')")); i++) await sleep(250);
  await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${J(email)}); set('password', ${J(password)}); document.querySelector('form').requestSubmit(); })()`);
  for (let i = 0; i < 30; i++) { await sleep(400); const p = await s.js("location.pathname"); if (p && p !== "/login") { await sleep(1500); return p; } }
  if (attempt < 3) return login(s, email, password, attempt + 1);
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

// ==================================================================== Module 6: Leave Management
const mondayOnOrAfter = (d) => addD(d, (8 - isoDow(d)) % 7);
/** SQL for the employee id of a sign-in email (login email can differ from company_email). */
const EMPQ = (email) => `(select e.id from hr_employees e join auth.users u on u.id = e.user_id where u.email = ${lit(email)})`;
const leaveBal = async (email, code, year) => q1(`select b.* from hr_leave_balances b join hr_leave_types t on t.id = b.leave_type_id
  where b.employee_id = ${EMPQ(email)} and t.code = ${lit(code)} and b.year = ${year ? Number(year) : "extract(year from hr_private.business_today())::int"}`);

/** A Monday >= today+21 whose test dates (Mon .. Mon+18) stay in one year, with no leave or holidays that week. */
async function freeWeek(email, after = 21) {
  const today = await TODAY();
  let m = mondayOnOrAfter(addD(today, after));
  for (let i = 0; i < 20; i++, m = addD(m, 7)) {
    const fri = addD(m, 4);
    if (fri.slice(0, 4) !== m.slice(0, 4) || addD(m, 18).slice(0, 4) !== m.slice(0, 4)) continue;   // keep every test date inside one leave year
    const busy = await cnt(`select 1 from hr_leave_requests r where r.employee_id = ${EMPQ(email)}
      and r.status in ('pending_approval','approved') and r.start_date <= ${lit(fri)} and r.end_date >= ${lit(m)}`);
    const hol = await cnt(`select 1 from hr_holidays where holiday_date between ${lit(m)} and ${lit(fri)}`);
    if (!busy && !hol) return m;
  }
  // next year (max_advance_days permits up to 365)
  return null;
}

async function applyViaUi(s, { type, start, end, part, reason, file }) {
  const ready = await goReady(s, "/employee/leave", "!!btn('Apply for leave')", 25000);
  await h(s, "click('Apply for leave')");
  if (!(await waitDialog(s, 8000))) {
    return { ok: false, toast: "", alerts: [`apply dialog did not open (page ready: ${ready}, path ${await s.js("location.pathname")})`], preview: "" };
  }
  await waitFor(s, `pickText('Leave type', ${J(type)})`, 8000);
  await h(s, `fill('From', ${J(start)})`); await sleep(150);
  await h(s, `fill('To', ${J(end)})`);
  if (part) await h(s, `tick(${J(part)})`);
  await h(s, `fill('Reason', ${J(reason)})`);
  if (file) {
    const doc = await s.send("DOM.getDocument", { depth: -1 });
    const n = await s.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "[role=dialog] input[type=file]" });
    if (n?.nodeId) await s.send("DOM.setFileInputFiles", { nodeId: n.nodeId, files: [file] });
  }
  await waitFor(s, "dialogText().includes('counts as') || dialogText().includes('Insufficient') || alerts().length > 0", 8000);
  const preview = await h(s, "dialogText()");
  await h(s, "click('Submit request', true)");
  const ok = await waitNoDialog(s, file ? 20000 : 10000);   // uploads take longer
  const toast = ok ? await toastText(s, 8000) : "";
  const alerts = ok ? [] : await h(s, "alerts()");
  if (!ok) await h(s, "cancel()");
  return { ok, toast, alerts: alerts ?? [], preview };
}

async function wfLeave() {
  const WF = "leave";
  const today = await TODAY();
  const mon = await freeWeek(EMP);
  check(WF, "setup", "found a free week for the synthetic employee", Boolean(mon), mon);
  if (!mon) return;
  const tue = addD(mon, 1), thu = addD(mon, 3), fri = addD(mon, 4);
  const Y = mon.slice(0, 4);
  const empName = "Demo Engineer 03";
  const before = await leaveBal(EMP, "CL", Y);
  const pdf = path.join(tmpdir(), `wf6-medical-${RUN}.pdf`);
  writeFileSync(pdf, Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"));

  // ---------------------------------------------------------------- employee applies (desktop)
  let reqId;
  await as(EMP, async (s) => {
    const r = await applyViaUi(s, { type: "Casual", start: mon, end: tue, reason: `WF6 synthetic family visit ${RUN}` });
    check(WF, "ui", "employee applies for 2 days of casual leave", r.ok && /Leave applied: 2 day/.test(r.toast), r.toast || r.alerts.join(" | "));
    check(WF, "ui", "apply form shows available balance and server day count", /available/.test(r.preview) && /counts as/.test(r.preview), r.preview.slice(0, 200));
    const row = await q1(`select r.id, r.status, r.current_level, r.days from hr_leave_requests r join hr_employees e on e.id = r.employee_id
      where r.employee_id = ${EMPQ(EMP)} and r.reason = ${lit(`WF6 synthetic family visit ${RUN}`)}`);
    reqId = row?.id;
    check(WF, "db", "request pending at manager level with 2 days", row?.status === "pending_approval" && row?.current_level === "manager" && Number(row?.days) === 2, J(row));
    check(WF, "db", "reservation in the balance ledger, linked to the request",
      (await cnt(`select 1 from hr_leave_ledger where request_id = ${lit(reqId)} and entry_type = 'reserve' and amount = 2`)) === 1);
    const after = await leaveBal(EMP, "CL", Y);
    check(WF, "db", "pending balance increased by exactly 2", Number(after.pending) - Number(before.pending) === 2, `${before.pending} -> ${after.pending}`);

    // overlap + insufficient balance + half day
    const o = await applyViaUi(s, { type: "Sick", start: tue, end: tue, reason: "WF6 overlap check" });
    check(WF, "error", "overlapping request refused with a clear message", !o.ok && o.alerts.some((a) => /overlap/i.test(a)), o.alerts.join(" | "));
    // 1 Jun - 30 Jul of next year (~43 working days) is far beyond a 12-day casual balance; make sure nothing else overlaps it.
    const bigFrom = `${Number(today.slice(0, 4)) + 1}-06-01`, bigTo = `${Number(today.slice(0, 4)) + 1}-07-30`;
    const bigBusy = await cnt(`select 1 from hr_leave_requests where employee_id = ${EMPQ(EMP)} and status in ('pending_approval','approved') and start_date <= ${lit(bigTo)} and end_date >= ${lit(bigFrom)}`);
    const big = bigBusy ? { ok: false, alerts: ["skipped: range already used"] } : await applyViaUi(s, { type: "Casual", start: bigFrom, end: bigTo, reason: "WF6 too long" });
    check(WF, "error", "request beyond the available balance refused", !big.ok && big.alerts.some((x) => /Insufficient Casual Leave balance/.test(x)), big.alerts.join(" | "));
    const half = await applyViaUi(s, { type: "Casual", start: thu, end: thu, part: "First half", reason: `WF6 half day ${RUN}` });
    check(WF, "ui", "half-day request counts 0.5", half.ok && /0\.5 day/.test(half.toast), half.toast || half.alerts.join(" | "));

    // supporting document upload (sick leave > 2 days needs a document)
    const sick = await applyViaUi(s, { type: "Sick", start: addD(mon, 14), end: addD(mon, 16), reason: `WF6 sick with note ${RUN}`, file: pdf });
    const sr = await q1(`select r.id, r.document_id, d.category_id, c.code from hr_leave_requests r left join hr_documents d on d.id = r.document_id
      left join hr_document_categories c on c.id = d.category_id where r.reason = ${lit(`WF6 sick with note ${RUN}`)}`);
    check(WF, "ui", "sick leave with an uploaded supporting document submitted", sick.ok, sick.toast || sick.alerts.join(" | "));
    check(WF, "db", "document stored as a leave supporting document and linked", sr?.document_id && sr?.code === "leave_supporting", J(sr));
    if (sr?.document_id) {
      const mgrView = await sel(MGR, `hr_documents?id=eq.${sr.document_id}&select=id`);
      check(WF, "permission", "line manager cannot read the medical document", Array.isArray(mgrView.body) && mgrView.body.length === 0, wdesc(mgrView));
    }

    // persistence after refresh
    await s.reload();
    await waitFor(s, `rowText(${J(fmtD(mon).slice(0, 6))})`, 20000);
    const persisted = await h(s, `rowText(${J(fmtD(mon).slice(0, 6))})`);
    check(WF, "refresh", "applied request still listed after a browser refresh", Boolean(persisted), persisted);
    await s.shot("employee-leave-desktop");

    // cancel the half day
    const c = await h(s, `rowClick(${J(fmtD(thu).slice(0, 6))}, 'Cancel')`);
    if (c === true) { await waitDialog(s); await h(s, "confirm()"); }
    const ct = await toastText(s);
    check(WF, "ui", "employee cancels a pending half day", /Leave cancelled/.test(ct), ct || c);
    check(WF, "db", "cancelled half day released through the ledger",
      (await cnt(`select 1 from hr_leave_ledger l join hr_leave_requests r on r.id = l.request_id where r.reason = ${lit(`WF6 half day ${RUN}`)} and l.entry_type = 'release'`)) === 1);

    // balance history tab
    await h(s, "tab('Balance history')");
    check(WF, "ui", "balance history shows the reservation", await waitText(s, /Reserved \(pending\)/), "");
  });

  // ---------------------------------------------------------------- permissions (direct API)
  const own = await rpc(EMP, "hr_decide_leave", { p_id: reqId, p_approve: true });
  check(WF, "permission", "employee cannot approve own leave", refused(own) && /own/i.test(emsg(own)), emsg(own));
  const ov = await rpc(EMP, "hr_leave_overview", {});
  check(WF, "permission", "employee cannot open the HR overview", refused(ov), emsg(ov));
  const ledgerWrite = await post(EMP, "hr_leave_ledger", { balance_id: before.id, employee_id: before.employee_id, leave_type_id: before.leave_type_id, year: before.year, bucket: "adjusted", entry_type: "adjustment", amount: 5, effect: 5 });
  check(WF, "permission", "ledger cannot be written through the API", blockedWrite(ledgerWrite), wdesc(ledgerWrite));
  const typeWrite = await patch(HR, `hr_leave_types?code=eq.CL`, { annual_entitlement: 99 });
  check(WF, "permission", "HR cannot bypass policy approval with a direct update", blockedWrite(typeWrite), wdesc(typeWrite));
  const other = await rpc(EMP2, "hr_cancel_leave", { p_id: reqId });
  check(WF, "permission", "another employee cannot cancel this leave", refused(other), emsg(other));

  // ---------------------------------------------------------------- manager approves (level 1)
  await as(MGR, async (s) => {
    const ready = await goReady(s, "/hr/leave", "tabs().length > 0", 30000);
    if (!ready) { await s.shot("debug-manager-not-ready"); console.log("manager page not ready:", await s.js("location.pathname"), (await mainText(s))?.slice(0, 300)); }
    check(WF, "ui", "overview is the default tab", await waitText(s, /Awaiting my approval/i), (await h(s, "tabs()"))?.join(","));
    await s.shot("hr-leave-overview-manager");
    await h(s, "tab('Approvals')");
    // wait for the Approvals row (the Overview's "Upcoming leave" table can show the same dates)
    await waitFor(s, `rowText(${J(fmtD(mon))})?.includes('Approve')`, 15000);
    const r = await h(s, `rowClick(${J(fmtD(mon))}, 'Approve')`);
    if (r === true) { await waitDialog(s); await h(s, "confirm()"); }
    const t = await toastText(s);
    check(WF, "ui", "manager approval moves the request to HR", /awaiting HR/.test(t), t || r);
  });
  check(WF, "db", "request now at HR level", (await q1(`select current_level from hr_leave_requests where id = ${lit(reqId)}`))?.current_level === "hr");

  // ---------------------------------------------------------------- HR approves (final) + holiday change + recalculation
  await as(HR, async (s) => {
    await goReady(s, "/hr/leave?tab=approvals", `rowText(${J(fmtD(mon))})`, 20000);
    const r = await h(s, `rowClick(${J(fmtD(mon))}, 'Approve')`);
    if (r === true) { await waitDialog(s); await h(s, "confirm()"); }
    const t = await toastText(s);
    check(WF, "ui", "HR final approval", /Leave approved/.test(t), t || r);
    const b = await leaveBal(EMP, "CL", Y);
    check(WF, "db", "approval consumed exactly once (pending -> used)",
      (await cnt(`select 1 from hr_leave_ledger where request_id = ${lit(reqId)} and entry_type = 'consume'`)) === 2 && Number(b.used) - Number(before.used) === 2, `used ${before.used} -> ${b.used}`);
    const again = await rpc(HR, "hr_decide_leave", { p_id: reqId, p_approve: true });
    check(WF, "error", "repeated approval refused without changing the balance", refused(again) && Number((await leaveBal(EMP, "CL", Y)).used) === Number(b.used), emsg(again));
    check(WF, "db", "attendance sees the approved leave days", Number((await q1(`select hr_private.leave_portion_on(${EMPQ(EMP)}, ${lit(tue)}) p`)).p) === 1);

    // add a holiday on Tuesday through the Holidays tab
    await h(s, "tab('Holidays')");
    await waitFor(s, "!!btn('Add')", 8000);
    await h(s, "click('Add')"); await waitDialog(s);
    await h(s, `fill('Date', ${J(tue)})`);
    await h(s, `fill('Name', ${J(`WF6 Synthetic Holiday ${RUN}`)})`);
    await h(s, "click('Save', true)");
    const saved = await waitNoDialog(s, 8000);
    check(WF, "ui", "HR adds a holiday in the shared holiday calendar", saved, saved ? "" : (await h(s, "alerts()"))?.join(" | "));
    const flagged = await q1(`select days, holiday_review_required from hr_leave_requests where id = ${lit(reqId)}`);
    check(WF, "db", "approved leave flagged for review, days not silently changed", flagged?.holiday_review_required === true && Number(flagged.days) === 2, J(flagged));

    await goReady(s, "/hr/leave?tab=requests&review=1", `rowText(${J(fmtD(mon))})`, 20000);
    await s.shot("hr-leave-holiday-review");
    const rc = await h(s, `rowClick(${J(fmtD(mon))}, 'Recalculate')`);
    if (rc === true) { await waitDialog(s); await h(s, "confirm()"); }
    const rt = await toastText(s);
    check(WF, "ui", "HR recalculates the flagged request", /Recalculated: 1 day/.test(rt), rt || rc);
    const b2 = await leaveBal(EMP, "CL", Y);
    check(WF, "db", "recalculation returns 1 day through the ledger", Number(b.used) - Number(b2.used) === 1
      && (await cnt(`select 1 from hr_leave_ledger where request_id = ${lit(reqId)} and entry_type = 'recalculation'`)) >= 1, `used ${b.used} -> ${b2.used}`);
    const notified = await notifs(EMP, "leave.recalculated", reqId);
    check(WF, "db", "employee notified of the recalculation", notified.length >= 1);

    // overview after decisions
    await goReady(s, "/hr/leave?tab=overview", "/balances summary/i.test(text())", 20000);
    check(WF, "ui", "HR overview renders KPIs, lists and balance summary", /On leave today/i.test(await mainText(s)) && /Upcoming leave/i.test(await mainText(s)));
    await s.shot("hr-leave-overview");

    // balances ledger for the employee
    await goReady(s, "/hr/leave?tab=balances", "!!field('Employee')");
    await h(s, `pickVal('Year', ${J(Y)})`);
    await waitFor(s, `pickText('Employee', ${J(empName)})`, 15000);
    check(WF, "ui", "HR sees the employee's balance ledger", await waitText(s, /Balance ledger/i, 15000) && await waitText(s, /Approved \(used\)|Recalculated/i, 15000));
  });

  // ---------------------------------------------------------------- policy maker-checker
  const CODE = `W${RUNL.slice(-6).toUpperCase()}`;
  await as(HR, async (s) => {
    await goReady(s, "/hr/leave?tab=policies", "!!btn('New leave type')");
    await h(s, "click('New leave type')"); await waitDialog(s);
    await h(s, `fill('Code', ${J(CODE)})`);
    await h(s, `fill('Name', ${J(`WF6 Wellness ${RUN}`)})`);
    await h(s, "fill('Annual entitlement (days)', '4')");
    await h(s, "fill('Advance notice (days)', '2')");
    await h(s, "fill('Reason for the change', 'WF6 synthetic wellness policy')");
    await h(s, "click('Submit for approval', true)");
    const ok = await waitNoDialog(s, 8000);
    const t = ok ? await toastText(s) : (await h(s, "alerts()"))?.join(" | ");
    check(WF, "ui", "HR proposes a new leave policy", ok && /submitted for approval/.test(t), t);
    check(WF, "db", "type not created before approval", (await cnt(`select 1 from hr_leave_types where code = ${lit(CODE)}`)) === 0);
    check(WF, "ui", "proposer is told another approver is needed", await waitText(s, /Awaiting another HR approver/));
  });
  const ch = await q1(`select id from hr_leave_policy_changes where proposed ->> 'code' = ${lit(CODE)} and status = 'pending'`);
  const selfOk = await rpc(HR, "hr_decide_leave_policy", { p_change: ch?.id, p_approve: true });
  check(WF, "permission", "proposer cannot approve own policy change", refused(selfOk) && /own policy/i.test(emsg(selfOk)), emsg(selfOk));
  await as(SA, async (s) => {
    await goReady(s, "/hr/leave?tab=policies", `rowText(${J(`WF6 Wellness ${RUN}`)})`);
    const r = await h(s, `rowClick(${J(`WF6 Wellness ${RUN}`)}, 'Approve')`);
    if (r === true) { await waitDialog(s); await h(s, "confirm()"); }
    const t = await toastText(s);
    check(WF, "ui", "second approver approves the policy", /approved and applied/.test(t), t || r);
    await s.reload();
    const listed = await waitFor(s, `rowText(${J(CODE)})?.includes(' v1 ')`, 20000);
    check(WF, "refresh", "new policy listed after refresh with version 1", listed, listed ? "" : await h(s, `rowText(${J(CODE)})`));
  });
  check(WF, "db", "policy version linked to the approved change",
    (await cnt(`select 1 from hr_leave_policy_versions v join hr_leave_types t on t.id = v.leave_type_id where t.code = ${lit(CODE)} and v.change_id = ${lit(ch?.id)}`)) === 1);
  const notice = await rpc(EMP, "hr_apply_leave", { p_leave_type: (await q1(`select id from hr_leave_types where code = ${lit(CODE)}`)).id,
    p_start: addD(today, 1), p_end: addD(today, 1), p_reason: "WF6 notice check" });
  check(WF, "error", "new policy's advance-notice rule enforced", refused(notice) && /in advance/.test(emsg(notice)), emsg(notice));

  const future = await rpc(HR, "hr_propose_leave_policy", { p_leave_type: (await q1(`select id from hr_leave_types where code = 'CL'`)).id,
    p_changes: { annual_entitlement: 13 }, p_reason: "WF6 future-dated", p_effective_from: addD(today, 30) });
  check(WF, "error", "future-dated policy change refused (approved changes apply immediately)", refused(future) && /Future-dated/.test(emsg(future)), emsg(future));
  const allHol = await rpc(HR, "hr_my_holidays", { p_from: today, p_to: addD(today, 120), p_all: true });
  const empHol = await rpc(EMP, "hr_my_holidays", { p_from: today, p_to: addD(today, 120), p_all: true });
  check(WF, "permission", "only HR can list every holiday (all mode); employees get their own", Array.isArray(allHol.body) && Array.isArray(empHol.body)
    && allHol.body.length >= empHol.body.length, `HR ${allHol.body?.length}, employee ${empHol.body?.length}`);

  // ---------------------------------------------------------------- calendars + privacy
  const cal = await rpc(EMP2, "hr_leave_calendar", { p_from: mon, p_to: fri });
  check(WF, "permission", "unrelated employee does not see the leave on the calendar",
    Array.isArray(cal.body) && !cal.body.some((r) => r.request_id === reqId), wdesc(cal));
  const mcal = await rpc(MGR, "hr_leave_calendar", { p_from: mon, p_to: fri });
  const mine = Array.isArray(mcal.body) ? mcal.body.find((r) => r.request_id === reqId) : null;
  check(WF, "permission", "manager sees team leave type; no reason field is exposed", mine?.visibility === "full" && !("reason" in (mine ?? {})), J(mine));

  // ---------------------------------------------------------------- mobile
  for (const [email, p, name] of [[EMP, "/employee/leave", "employee-leave-mobile"], [HR, "/hr/leave?tab=overview", "hr-leave-overview-mobile"], [MGR, "/hr/leave?tab=calendar", "hr-leave-calendar-mobile"]]) {
    const s = await session({ w: 390, h: 844, m: true });
    try {
      await login(s, email);
      await goReady(s, p, "tabs().length > 0", 15000);
      await sleep(1500);
      check(WF, "mobile", `${p} has no horizontal overflow at 390px`, await noOverflow(s));
      await s.shot(name);
    } finally { await s.close(); }
  }
  // desktop calendar screenshot
  await as(EMP, async (s) => {
    await goReady(s, "/employee/leave", "tab('Team calendar')");
    await h(s, "tab('Team calendar')");
    await waitText(s, /Leave calendar/);
    await s.shot("employee-team-calendar");
    check(WF, "ui", "employee team calendar renders", /Leave calendar/.test(await mainText(s)));
  });
}

// ------------------------------------------------------------------ main
const WORKFLOWS = { leave: wfLeave };
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

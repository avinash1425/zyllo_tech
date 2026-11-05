#!/usr/bin/env node
// TEST-ONLY end-to-end checks for HRMS Module 4 (Onboarding & Employee Exit)
// against the LOCAL HRMS harness. Same safety model as browser-flows-4.mjs
// (helpers copied verbatim): talks only to 127.0.0.1, blocks every external
// request in the browser, synthetic data only, headless Chrome with a
// throwaway profile. Screenshots: docs/hrms/local-test-screenshots/m4-*.jpg
//
//   node scripts/hrms-local/browser-flows-m4.mjs --state <harness state json> [--out <results.json>] [--only onboarding,exit,probation]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT, findPgBin, makePsql } from "./lib.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STATE_FILE = arg("--state", path.join(tmpdir(), "zyllo-hrms-local.json"));
if (!existsSync(STATE_FILE)) { console.error(`No harness state at ${STATE_FILE}.`); process.exit(2); }
const STATE = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const API = `http://127.0.0.1:${STATE.apiPort}`;
const BASE = arg("--base", `http://127.0.0.1:${STATE.webPort}`);
const ANON = STATE.anonKey;
const OUT = arg("--out", path.join(tmpdir(), "hrms-flows-m4", "results.json"));
const ONLY = arg("--only", "").split(",").filter(Boolean);
const SHOTS = path.join(ROOT, "docs", "hrms", "local-test-screenshots");
const PASSWORD = "Local-Test-Only-2026!";
const RUN = Date.now().toString(36);
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
  // Port 0 + DevToolsActivePort: Chrome picks a free port and writes it into
  // THIS throwaway profile, so the script only ever attaches to the browser it
  // launched (never to another session's headless Chrome).
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-flow-m4-"));
  const proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  chromes.add(proc);
  let port;
  for (let i = 0; i < 80 && !port; i++) { await sleep(250); try { port = Number(readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]) || undefined; } catch {} }
  let target;
  for (let i = 0; i < 80 && port && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} if (!target) await sleep(250); }
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
    const file = `m4-${name}.jpg`;
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
async function waitFor(s, expr, timeout = 20000, every = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await h(s, expr)) return true; await sleep(every); }
  return false;
}
const waitText = (s, re, timeout = 30000) => waitFor(s, `text().match(${re})`, timeout);
const waitDialog = (s, timeout = 6000) => waitFor(s, "dialogOpen() > 0", timeout);
const waitNoDialog = (s, timeout = 8000) => waitFor(s, "dialogOpen() === 0", timeout);

async function login(s, email, password = PASSWORD) {
  // Wait for the (lazy) login form to mount, then submit; retry if the first
  // submit raced the app's hydration.
  await s.go("/login", 2500);
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let i = 0; i < 40 && !(await s.js(`Boolean(document.querySelector('input[name="email"]') && document.querySelector('form'))`)); i++) await sleep(250);
    await sleep(500);
    await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); if (!el) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${J(email)}); set('password', ${J(password)}); const f = document.querySelector('form'); if (f) f.requestSubmit(); })()`);
    for (let i = 0; i < 30; i++) { await sleep(400); const p = await s.js("location.pathname"); if (p && p !== "/login") { await sleep(1500); return p; } }
  }
  return s.js("location.pathname");
}
async function as(email, fn) {
  const s = await session();
  try { await login(s, email); return await fn(s); } finally { await s.close(); }
}

// ================================================================== Module 4 workflows
const HR = "hr.admin@example.com", EMP = "employee@example.com", EMP2 = "employee2@example.com";
const PAY1 = "payroll.admin@example.com", PAY2 = "payroll.approver@example.com", MGR = "manager@example.com";
const empId = async (userEmail) => (await q1(`select e.id from hr_employees e join auth.users u on u.id = e.user_id where u.email = ${lit(userEmail)}`))?.id;
const noOverflow = (s) => s.js("document.documentElement.scrollWidth <= window.innerWidth + 1");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

async function wfOnboarding() {
  const WF = "onboarding";
  const emp = await empId(EMP);
  // Fresh case for the synthetic employee (cancel any earlier run's case first, through the RPC).
  const prev = await q1(`select id from hr_onboarding_cases where employee_id = ${lit(emp)} and status = 'open'`);
  if (prev) await rpc(HR, "hr_cancel_onboarding", { p_case: prev.id, p_reason: `flow rerun ${RUN}` });
  const done = await q1(`select id from hr_onboarding_cases where employee_id = ${lit(emp)} and status = 'completed'`);
  if (done) { check(WF, "setup", "employee already has a completed case (re-run): skipping create", true); }
  const created = done ? { status: 200, body: done.id } : await rpc(HR, "hr_create_onboarding_case", { p_employee: emp });
  check(WF, "setup", "HR opens an onboarding case through the RPC", created.status === 200, wdesc(created));
  const caseId = created.body;
  const dup = await rpc(HR, "hr_create_onboarding_case", { p_employee: emp });
  check(WF, "permission", "duplicate onboarding case refused", refused(dup) && /already has an onboarding case/.test(emsg(dup)), emsg(dup));
  const direct = await post(EMP, "hr_onboarding_cases", { employee_id: emp });
  check(WF, "permission", "employee cannot insert cases directly", blockedWrite(direct), wdesc(direct));
  const peek = await sel(EMP2, `hr_onboarding_cases?select=id&employee_id=eq.${emp}`);
  check(WF, "permission", "other employee sees no case rows", Array.isArray(peek.body) && peek.body.length === 0, wdesc(peek));
  if (done) return;

  await as(HR, async (s) => {
    await s.go("/hr", 4000);
    check(WF, "ui", "HR navigation shows Onboarding & Exit", await h(s, "text().includes('Onboarding & Exit')"));
    await s.go("/hr/onboarding-exit", 5000);
    check(WF, "ui", "overview renders summary cards", await waitText(s, /Open onboarding/i));
    await s.shot("overview");
    await s.go("/hr/onboarding-exit/onboarding", 5000);
    check(WF, "ui", "case listed", await waitText(s, /Demo Engineer 03/));
    await h(s, "rowClick('Demo Engineer 03')");
    check(WF, "ui", "case detail with checklist", await waitText(s, /Joining checklist/) && await waitText(s, /Company orientation/));
    // Complete a manual task through the UI.
    const r = await h(s, `liClick('Company orientation', 'Complete')`);
    check(WF, "ui", "Complete button on 'Company orientation'", r === true, r);
    await waitDialog(s); await h(s, "fill('Completion evidence', 'Orientation held by flow " + RUN + "')"); await sleep(200);
    await h(s, "confirm()"); await waitNoDialog(s); await sleep(1200);
    const t = await q1(`select status, evidence_note from hr_onboarding_tasks where case_id = ${lit(caseId)} and title = 'Company orientation'`);
    check(WF, "db", "task completed with evidence", t?.status === "completed" && /Orientation held/.test(t?.evidence_note ?? ""), JSON.stringify(t));
    // Acknowledgement cannot be ticked by HR (no Complete button shown).
    const ack = await h(s, `liClick('Security and confidentiality acknowledgement', 'Complete')`);
    check(WF, "permission", "no HR 'Complete' for an employee acknowledgement", ack === "no-button", ack);
    // Completing onboarding is blocked until joining is recorded.
    check(WF, "error", "Complete onboarding disabled before joining", await h(s, "disabled('Complete onboarding')") === true);
    await s.reload(4500);
    await waitText(s, /Company orientation/);
    check(WF, "refresh", "completed task survives a reload", await h(s, "liText('Company orientation')").then((x) => /completed/i.test(x ?? "")));
    await s.shot("case-detail");
  });

  await as(EMP, async (s) => {
    await s.go("/employee/onboarding", 5000);
    check(WF, "ui", "employee sees My Onboarding", await waitText(s, /My Onboarding/) && await waitText(s, /Joining checklist/));
    check(WF, "permission", "no internal tasks in the portal", !(await h(s, "text().includes('Payroll and bank details captured')")));
    await h(s, "tab('Induction')"); await sleep(600);
    const r = await h(s, `liClick('Security and confidentiality acknowledgement', 'Acknowledge')`);
    check(WF, "ui", "Acknowledge button available", r === true, r);
    await waitDialog(s); await h(s, "confirm()"); await waitNoDialog(s); await sleep(1500);
    const t = await q1(`select status, acknowledged_at from hr_onboarding_tasks where case_id = ${lit(caseId)} and task_kind = 'acknowledgement'`);
    check(WF, "db", "acknowledgement stored", t?.status === "completed" && t?.acknowledged_at, JSON.stringify(t));
    await s.shot("employee-onboarding");
  });
}

async function wfResignation() {
  const WF = "resignation";
  const emp2 = await empId(EMP2);
  const open = await q1(`select id, status from hr_exits where employee_id = ${lit(emp2)} and status not in ('closed','withdrawn','rejected')`);
  if (open) await rpc(HR, "hr_withdraw_resignation", { p_exit: open.id, p_note: `flow rerun ${RUN}` });
  let exitId;
  await as(EMP2, async (s) => {
    await s.go("/employee/resignation", 5000);
    check(WF, "ui", "My Resignation page", await waitText(s, /My Resignation/));
    await waitFor(s, "disabled('Submit resignation') === false", 30000);
    const c = await h(s, "click('Submit resignation')");
    check(WF, "ui", "Submit resignation opens the form", c === true, c);
    await waitDialog(s);
    await h(s, "click('Continue', true)"); await sleep(400);
    check(WF, "error", "reason required", /reason/i.test(await h(s, "dialogText()")));
    await h(s, "fill('Reason', 'Relocating (synthetic flow " + RUN + ")')"); await h(s, "click('Continue', true)"); await sleep(500);
    await h(s, "confirm()"); await waitNoDialog(s); await sleep(1500);
    const x = await q1(`select id, status from hr_exits where employee_id = ${lit(emp2)} and status not in ('closed','withdrawn','rejected')`);
    exitId = x?.id;
    check(WF, "db", "resignation stored for review", ["manager_review", "hr_review"].includes(x?.status), JSON.stringify(x));
    check(WF, "db", "employee not deactivated on submission", (await q1(`select status from hr_employees where id = ${lit(emp2)}`))?.status === "active");
    await s.reload(4500);
    check(WF, "refresh", "status shows Under review after reload", await waitFor(s, "text().includes('Withdraw resignation') || text().includes('Under review')", 30000) && !(await h(s, "text().includes('You have no resignation')")));
    await s.shot("employee-resignation");
  });
  if (!exitId) return;
  await as(HR, async (s) => {
    await s.go("/hr/onboarding-exit/resignations", 5000);
    check(WF, "ui", "HR resignation list shows the request", await waitText(s, /Demo Designer/));
  });
  return exitId;
}

async function wfClearanceSettlement(exitId) {
  const WF = "clearance_settlement";
  if (!exitId) { check(WF, "setup", "needs the resignation from the previous workflow", false); return; }
  const st = await q1(`select status from hr_exits where id = ${lit(exitId)}`);
  if (st.status === "manager_review") await rpc("manager@example.com", "hr_manager_review_exit", { p_exit: exitId, p_approve: true, p_note: "ok" });
  const ap = await rpc(HR, "hr_hr_review_exit", { p_exit: exitId, p_approve: true, p_approved_lwd: today(), p_note: "Accepted (flow)" });
  check(WF, "setup", "HR approves resignation", ap.status < 300, wdesc(ap));
  const sc = await rpc(HR, "hr_start_exit_clearance", { p_exit: exitId });
  check(WF, "setup", "clearance started", sc.status < 300, wdesc(sc));
  check(WF, "db", "IT clearance item created", (await cnt(`select 1 from hr_exit_clearance_items where exit_id = ${lit(exitId)} and item_key = 'it_clearance'`)) === 1);
  const self = await rpc(EMP2, "hr_complete_clearance_item", { p_item: (await q1(`select id from hr_exit_clearance_items where exit_id = ${lit(exitId)} and item_key = 'project_handover'`)).id, p_status: "completed" });
  check(WF, "permission", "leaver cannot clear own item", refused(self), emsg(self));

  let sid;
  await as(PAY1, async (s) => {
    await s.go("/hr/onboarding-exit/settlement", 5000);
    check(WF, "ui", "payroll sees exits to prepare", await waitText(s, /Demo Designer/));
    const r = await h(s, "rowClick('Demo Designer', 'Prepare settlement')");
    check(WF, "ui", "Prepare settlement button", r === true, r);
    await waitDialog(s); await h(s, "confirm()"); await sleep(3500);
    sid = (await q1(`select id from hr_payroll_settlements where exit_id = ${lit(exitId)} and status = 'draft'`))?.id;
    check(WF, "db", "draft settlement prepared", Boolean(sid));
    check(WF, "ui", "settlement detail opened", await waitText(s, /Settlement lines/));
    await h(s, "click('Line')"); await waitDialog(s);
    await h(s, "fill('Label', 'Synthetic pending salary')"); await h(s, `fill('Amount', '2500')`); await h(s, "confirm()"); await waitNoDialog(s); await sleep(1500);
    check(WF, "db", "line saved", (await cnt(`select 1 from hr_payroll_settlement_lines where settlement_id = ${lit(sid)} and label = 'Synthetic pending salary'`)) === 1);
    await h(s, "click('Submit for approval')"); await waitDialog(s); await h(s, "confirm()"); await waitNoDialog(s); await sleep(1500);
    check(WF, "db", "submitted", (await q1(`select status from hr_payroll_settlements where id = ${lit(sid)}`))?.status === "submitted");
    await s.reload(4500);
    check(WF, "permission", "preparer cannot approve (button disabled)", await h(s, "disabled('Approve')") === true);
  });
  const sod = await rpc(PAY1, "hr_approve_settlement", { p_settlement: sid, p_approve: true });
  check(WF, "permission", "server refuses preparer approval", refused(sod) && /different person/.test(emsg(sod)), emsg(sod));
  await as(PAY2, async (s) => {
    await s.go(`/hr/onboarding-exit/settlement/${sid}`, 5000);
    await h(s, "click('Approve')"); await waitDialog(s); await h(s, "confirm()"); await waitNoDialog(s); await sleep(1500);
    check(WF, "db", "approved by a second approver", (await q1(`select status from hr_payroll_settlements where id = ${lit(sid)}`))?.status === "approved");
    check(WF, "db", "final settlement clearance item completed", (await q1(`select status from hr_exit_clearance_items where exit_id = ${lit(exitId)} and item_key = 'final_settlement'`))?.status === "completed");
    await h(s, "click('Statement / PDF')"); await sleep(1200);
    check(WF, "ui", "statement window requested", await s.js("Array.isArray(window.__opened)"));
    await s.shot("settlement-approved");
  });
  const hrSel = await sel(HR, `hr_payroll_settlements?select=id,net_amount&id=eq.${sid}`);
  check(WF, "permission", "HR admin cannot read settlement amounts", Array.isArray(hrSel.body) && hrSel.body.length === 0, wdesc(hrSel));
  await as(HR, async (s) => {
    await s.go(`/hr/exits/${exitId}`, 5000);
    check(WF, "ui", "exit case shows IT clearance", await waitText(s, /IT clearance/));
    check(WF, "ui", "exit case shows settlement status", await waitText(s, /Full & final settlement/));
    await s.shot("exit-case");
  });
  await as(EMP2, async (s) => {
    await s.go("/employee/resignation", 5000);
    check(WF, "ui", "employee sees clearance status", await waitText(s, /My clearance status/));
    const net = Number((await q1(`select net_amount from hr_payroll_settlements where id = ${lit(sid)}`))?.net_amount ?? 0);
    const shown = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Math.abs(net)); // same as formatMoney()
    check(WF, "ui", "employee sees approved settlement net", await waitFor(s, `text().includes(${J(shown)})`, 30000), `expected ${shown}`);
  });
}

async function wfProbationMobile() {
  const WF = "probation_mobile";
  await as(HR, async (s) => {
    await s.go("/hr/onboarding-exit/probation", 5000);
    check(WF, "ui", "probation page renders", await waitText(s, /Open reviews/));
    check(WF, "ui", "reminders action available to HR", await h(s, "disabled('Run review reminders')") === false);
  });
  await as(MGR, async (s) => {
    await s.go("/hr/onboarding-exit", 5000);
    check(WF, "permission", "manager has no Final Settlement section", !(await h(s, "text().includes('Final Settlement')")));
  });
  const m = await session({ w: 390, h: 844, m: true });
  try {
    await login(m, EMP);
    for (const p of ["/employee/onboarding", "/employee/resignation"]) { await m.go(p, 5000); check(WF, "mobile", `no horizontal overflow at 390 px: ${p}`, await noOverflow(m)); }
    await m.shot("mobile-employee-onboarding");
  } finally { await m.close(); }
}

const started = new Date().toISOString();
if (ONLY.includes("debug")) {
  for (const [who, paths] of [[HR, ["/hr/onboarding-exit", "/hr/onboarding-exit/onboarding"]], [PAY1, ["/hr/onboarding-exit/settlement"]]]) {
    await as(who, async (s) => { for (const p of paths) { await s.go(p, 6000); console.log(`--- ${who} ${p} -> ${await s.js("location.pathname")}\n${String(await h(s, "text()")).slice(0, 700)}`); } });
  }
  for (const p of chromes) { try { p.kill(); } catch {} }
  console.log("page exceptions:", pageErrors);
  process.exit(0);
}
try {
  if (!ONLY.length || ONLY.includes("onboarding")) { console.log("\n=== onboarding ==="); try { await wfOnboarding(); } catch (e) { check("onboarding", "crash", "threw", false, e.stack); } }
  let exitId;
  if (!ONLY.length || ONLY.includes("exit")) {
    console.log("\n=== resignation ==="); try { exitId = await wfResignation(); } catch (e) { check("resignation", "crash", "threw", false, e.stack); }
    console.log("\n=== clearance & settlement ==="); try { await wfClearanceSettlement(exitId); } catch (e) { check("clearance_settlement", "crash", "threw", false, e.stack); }
  }
  if (!ONLY.length || ONLY.includes("probation")) { console.log("\n=== probation & mobile ==="); try { await wfProbationMobile(); } catch (e) { check("probation_mobile", "crash", "threw", false, e.stack); } }
} finally {
  for (const p of chromes) { try { p.kill(); } catch {} }
  writeFileSync(OUT, JSON.stringify({ harness: { api: API, web: BASE }, run: RUN, started, finished: new Date().toISOString(), checks, screenshots: shots,
    blockedRequests: { count: blocked.length, urls: blocked }, pageExceptions: pageErrors }, null, 2));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed; external requests blocked: ${blocked.length}; page exceptions: ${pageErrors.length}; results: ${OUT}`);
  if (pageErrors.length) console.log("page exceptions:", pageErrors.slice(0, 10));
  process.exitCode = failed ? 1 : 0;
}

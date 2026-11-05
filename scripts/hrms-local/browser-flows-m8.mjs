#!/usr/bin/env node
// Module 8 — Daily Work Reports end-to-end browser flow (TEST ONLY, LOCAL ONLY).
// Drives the real UI in headless Chrome against a running hrms-local harness:
// project allocation (project manager), employee multi-task report with
// completed work / links / inline blocker, draft + submit, manager "request
// changes", employee revision, approval lock, reopen, blocker triage and
// resolution, overview / hours tabs, role restrictions, refresh persistence,
// duplicate prevention and mobile layout. Synthetic data only; every
// non-localhost request is blocked. DB access is read-only (owner psql).
//
// Usage: node scripts/hrms-local/browser-flows-m8.mjs [--state <file>] [--out <results.json>] [--shots <dir>]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findPgBin, makePsql } from "./lib.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STATE_FILE = arg("--state", path.join(tmpdir(), "zyllo-hrms-local.json"));
if (!existsSync(STATE_FILE)) { console.error(`No harness state at ${STATE_FILE}.`); process.exit(2); }
const STATE = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const API = `http://127.0.0.1:${STATE.apiPort}`;
const BASE = `http://127.0.0.1:${STATE.webPort}`;
const ANON = STATE.anonKey;
const OUT = arg("--out", path.join(tmpdir(), "hrms-flows-m8", "results.json"));
const SHOTS = arg("--shots", path.join(path.dirname(OUT), "shots"));
const PASSWORD = "Local-Test-Only-2026!";
const RUN = Date.now().toString(36).toUpperCase();
for (const u of [API, BASE]) { const x = new URL(u); if (!["127.0.0.1", "localhost"].includes(x.hostname) || x.port === "8080") { console.error(`Refusing ${u}`); process.exit(2); } }
mkdirSync(SHOTS, { recursive: true }); mkdirSync(path.dirname(OUT), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], blocked = [], pageErrors = [];
const check = (aspect, name, ok, detail = "") => {
  checks.push({ aspect, name, ok: Boolean(ok), detail: String(detail ?? "") });
  console.log(`${ok ? "PASS" : "FAIL"}  [m8/${aspect}] ${name}${detail ? `  (${String(detail).slice(0, 240)})` : ""}`);
};

// ---------------------------------------------------------------- DB (read-only)
const psql = makePsql({ bin: findPgBin(), port: STATE.pgPort });
async function q(sql) {
  const r = await psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`);
  if (!r.ok) throw new Error(`SQL failed: ${r.stderr.trim()} :: ${sql.slice(0, 200)}`);
  return JSON.parse(r.stdout.trim() || "[]");
}
const q1 = async (sql) => (await q(sql))[0];
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------- API
async function api(method, p, { token, body, headers = {} } = {}) {
  const r = await fetch(API + p, { method, headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json; try { json = await r.json(); } catch { json = null; }
  return { status: r.status, body: json };
}
const tokens = new Map();
async function tok(email) {
  if (!tokens.has(email)) {
    const r = await api("POST", "/auth/v1/token?grant_type=password", { body: { email, password: PASSWORD } });
    if (!r.body?.access_token) throw new Error(`sign-in failed for ${email}`);
    tokens.set(email, r.body.access_token);
  }
  return tokens.get(email);
}
const rpc = async (email, fn, args = {}) => api("POST", `/rest/v1/rpc/${fn}`, { token: await tok(email), body: args });
const post = async (email, p, body) => api("POST", `/rest/v1/${p}`, { token: await tok(email), body, headers: { Prefer: "return=representation" } });
const emsg = (r) => (r.body && (r.body.message || r.body.error)) || `HTTP ${r.status}`;

// ---------------------------------------------------------------- browser
const chromes = new Set();
async function session(viewport = { w: 1440, h: 900, m: false }) {
  const port = 9600 + Math.floor(Math.random() * 300);
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-flow-m8-"));
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
  await send("Page.enable"); await send("Runtime.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: viewport.w, height: viewport.h, deviceScaleFactor: 1, mobile: viewport.m });
  const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  const go = async (p) => { await send("Page.navigate", { url: BASE + p }); await sleep(800); };
  const reload = async () => { await send("Page.reload", { ignoreCache: true }); await sleep(800); };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 }); writeFileSync(path.join(SHOTS, `m8-${name}.jpg`), Buffer.from(s.data, "base64")); };
  const close = async () => { try { ws.close(); } catch {} proc.kill(); chromes.delete(proc); await sleep(500); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { js, go, reload, shot, close };
}

const H = `window.__h = {
  setVal(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
  scope() { const d = [...document.querySelectorAll('[role=dialog]')]; return d[d.length - 1] || document; },
  lab(l) { return l.textContent.replace('*', '').trim(); },
  inputOf(l) { return l && (document.getElementById(l.htmlFor) || l.querySelector('input,select,textarea')); },
  field(label) { const l = [...this.scope().querySelectorAll('label')].find((x) => this.lab(x).startsWith(label)); return this.inputOf(l); },
  fieldX(label, n) { const ls = [...this.scope().querySelectorAll('label')].filter((x) => this.lab(x) === label); return this.inputOf(ls[n || 0]); },
  count(label) { return [...this.scope().querySelectorAll('label')].filter((x) => this.lab(x) === label).length; },
  fill(label, v) { const el = this.field(label); if (!el) return false; this.setVal(el, v); return true; },
  fillX(label, n, v) { const el = this.fieldX(label, n); if (!el) return false; this.setVal(el, v); return true; },
  pickText(label, sub, n) { const el = n === undefined ? this.field(label) : this.fieldX(label, n); if (!el || el.tagName !== 'SELECT') return false; const o = [...el.options].find((o) => o.value && o.textContent.includes(sub)); if (!o) return false; this.setVal(el, o.value); return o.textContent; },
  pickVal(label, v, n) { const el = n === undefined ? this.field(label) : this.fieldX(label, n); if (!el || el.tagName !== 'SELECT') return false; if (![...el.options].some((o) => o.value === v)) return false; this.setVal(el, v); return true; },
  btn(text, inDialog) { const s = inDialog ? this.scope() : document; return [...s.querySelectorAll('button,a')].find((x) => x.textContent.trim().startsWith(text)); },
  click(text, inDialog) { const b = this.btn(text, inDialog); if (!b || b.disabled) return false; b.click(); return true; },
  rowClick(rowText, btnText) { const tr = [...this.scope().querySelectorAll('tbody tr')].find((r) => r.innerText.includes(rowText)); if (!tr) return false; if (!btnText) { tr.click(); return true; }
    const b = [...tr.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(btnText)); if (!b) return false; b.click(); return true; },
  rowWith(parts, click) { const tr = [...document.querySelectorAll('tbody tr')].find((r) => parts.every((p) => r.innerText.includes(p))); if (!tr) return false; if (click) tr.click(); return true; },
  hasOption(label, sub) { const el = this.field(label); return !!el && el.tagName === 'SELECT' && [...el.options].some((o) => o.textContent.includes(sub)); },
  rowText(rowText) { const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(rowText)); return tr ? tr.innerText.replace(/\\s+/g, ' ') : null; },
  tab(text) { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim().startsWith(text)); if (!t) return false; t.click(); return true; },
  confirm() { const d = this.scope(); if (d === document) return false; const bs = [...d.querySelectorAll('button')].filter((b) => !/^(Cancel|Close|Back)$/.test(b.textContent.trim()) && !b.getAttribute('aria-label')); const b = bs[bs.length - 1]; if (!b) return false; b.click(); return b.textContent.trim(); },
  cancel() { const d = this.scope(); if (d === document) return false; const b = [...d.querySelectorAll('button')].find((x) => /^(Cancel|Close)$/.test(x.textContent.trim())); if (!b) return false; b.click(); return true; },
  dialogs() { return document.querySelectorAll('[role=dialog]').length; },
  dialogText() { const d = this.scope(); return d === document ? '' : d.innerText; },
  alerts() { return [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent.trim()).filter(Boolean).join(' | '); },
  text() { return document.body.innerText; },
  overflowX() { return document.documentElement.scrollWidth - window.innerWidth; },
};`;
const MARK = "document.querySelectorAll('[aria-live=polite] [role=status]').forEach((x) => x.setAttribute('data-m8-seen', '1'));";
const h = (s, expr) => s.js(`(() => { ${H}; ${/^(click|confirm|rowClick)\(/.test(expr) ? MARK : ""} return window.__h.${expr}; })()`);
const J = JSON.stringify;
async function waitFor(s, expr, timeout = 15000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await h(s, expr)) return true; await sleep(250); } return false; }
const waitText = (s, re, timeout) => waitFor(s, `text().match(${re})`, timeout);
async function toast(s, timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const t = await s.js("(() => { const n = [...document.querySelectorAll('[aria-live=polite] [role=status]:not([data-m8-seen])')]; n.forEach((x) => x.setAttribute('data-m8-seen', '1')); return n.map((x) => x.textContent.trim()); })()") ?? [];
    if (t.length) return t.join(" | ");
    await sleep(200);
  }
  return "";
}
async function waitDb(sql, pred, timeout = 15000) { const t0 = Date.now(); let v; while (Date.now() - t0 < timeout) { v = await q1(sql); if (pred(v)) return v; await sleep(400); } return v; }
async function login(s, email) {
  await s.go("/login");
  await waitFor(s, "!!document.querySelector('input[name=email]')");
  await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${J(email)}); set('password', ${J(PASSWORD)}); document.querySelector('form').requestSubmit(); })()`);
  for (let i = 0; i < 60; i++) { await sleep(400); const p = await s.js("location.pathname"); if (p && p !== "/login") return p; }
  return s.js("location.pathname");
}
async function as(email, fn, viewport) { const s = await session(viewport); try { await login(s, email); return await fn(s); } finally { await s.close(); } }
/** Employee report editor for a date, waiting until the editor for that date has rendered. */
async function openReport(s, date) {
  await s.go("/employee/daily-reports");
  await waitFor(s, "!!document.querySelector('input[type=date]')");
  await s.js(`(() => { ${H}; const el = document.querySelector('input[type=date]'); __h.setVal(el, ${J(date)}); })()`);
  await waitFor(s, `count('Activity') > 0 || text().includes('can no longer be edited')`);
  await sleep(600);
}

/**
 * Review queue: filter to one date and open THAT date's row for Demo Engineer 03.
 * Waits for the refetched list (the default 7-day list may already show other
 * rows for the same employee) and for the modal to show the expected task.
 */
async function openReviewRow(s, date, activity) {
  await s.go("/hr/daily-reports");
  await waitFor(s, "!!field('From')");
  const label = await s.js(`new Date(${J(date + "T00:00:00")}).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })`);
  for (let i = 0; i < 3; i++) {
    await h(s, `fill('From', ${J(date)})`); await h(s, `fill('To', ${J(date)})`);
    if (await waitFor(s, `rowWith(${J(["Demo Engineer 03", label])})`, 8000)) break;
  }
  await h(s, `rowWith(${J(["Demo Engineer 03", label])}, true)`);
  return waitFor(s, `dialogText().includes(${J(activity)})`);
}

const EMP = "employee@example.com", EMP2 = "employee2@example.com", MGR = "manager@example.com", HR = "hr.admin@example.com";

async function main() {
  const today = (await q1("select hr_private.business_today()::text d")).d;
  const e3 = (await q1(`select e.id from hr_employees e join auth.users u on u.id = e.user_id where u.email = ${lit(EMP)}`)).id;
  const mgrId = (await q1(`select e.id from hr_employees e join auth.users u on u.id = e.user_id where u.email = ${lit(MGR)}`)).id;
  // Latest working weekday (<= today) with no report for employee@.
  const D = (await q1(`select d::date::text d from generate_series(${lit(today)}::date - 60, ${lit(today)}::date, interval '1 day') d
     where extract(isodow from d) < 6 and hr_private.is_working_day_for(${lit(e3)}, d::date)
       and not exists (select 1 from hr_daily_reports r where r.employee_id = ${lit(e3)} and r.report_date = d::date) order by d desc limit 1`)).d;
  const CODE = `M8${RUN}`.slice(0, 20);
  const A1 = `M8 build endpoint ${RUN}`, A2 = `M8 waiting on access ${RUN}`, A3 = `M8 later task ${RUN}`, BT = `M8 sandbox access ${RUN}`;
  console.log(`  [m8] employee@ date ${D}; project ${CODE}`);

  // ---- setup by HR (API, real RLS): a project managed by manager@
  const pr = await post(HR, "hr_projects", { code: CODE, name: `Synthetic M8 ${RUN}`, manager_employee_id: mgrId });
  check("setup", "HR creates a project with a project manager", pr.status === 201, `HTTP ${pr.status} ${emsg(pr)}`);
  const projectId = pr.body?.[0]?.id;

  // ---- 1. project manager allocates through the UI
  await as(MGR, async (s) => {
    await s.go("/hr/daily-reports?tab=projects");
    await waitText(s, `/${CODE}/`);
    await h(s, `rowClick(${J(CODE)}, 'Allocation')`);
    await waitFor(s, "count('Assignment start') > 0");
    // Wait until the employee picker's options have loaded before choosing one.
    await waitFor(s, "hasOption('Employee', 'Demo Engineer 03')");
    await h(s, `pickText('Employee', 'Demo Engineer 03')`);
    await h(s, `fill('Role', 'developer')`); await h(s, `fill('Assignment start', ${J(D)})`); await h(s, `fill('Allocation %', '50')`);
    await h(s, "click('Allocate', true)");
    const t = await toast(s);
    const m = await waitDb(`select start_date::text, allocation_pct from hr_project_members where project_id = ${lit(projectId)} and employee_id = ${lit(e3)}`, (v) => v);
    check("ui", "Project manager allocates employee@ (start date, 50 %) from 'My projects'", /allocated/i.test(t) && m?.start_date === D && m?.allocation_pct === 50, `toast "${t}"; ${J(m)}`);
    await h(s, "tab('History')"); await waitText(s, "/assigned/");
    check("ui", "Allocation history tab shows the assignment", /assigned/.test(await h(s, "dialogText()")));
    await s.shot("pm-allocation");
  });
  const hist = await q1(`select count(*)::int n from hr_project_allocation_history where project_id = ${lit(projectId)} and action = 'assigned'`);
  const nAssign = await q1(`select count(*)::int n from hr_notifications n join auth.users u on u.id = n.recipient_user_id where u.email = ${lit(EMP)} and n.type = 'daily_reports.project_assigned' and n.entity_id = ${lit(projectId)}`);
  check("db", "Allocation history row + in-app notification to the employee", hist.n === 1 && nAssign.n === 1, `history ${hist.n}, notifications ${nAssign.n}`);
  const pm2 = await post(MGR, "hr_project_members", { project_id: (await q1("select id from hr_projects where code = 'DEMO-APP'")).id, employee_id: e3 });
  check("permission", "Project manager cannot allocate on a project they do not manage", pm2.status >= 400, `HTTP ${pm2.status} ${emsg(pm2)}`);

  // ---- 2. employee: assigned projects + multi-task report
  await as(EMP, async (s) => {
    await s.go("/employee/tasks"); await waitFor(s, "tab('My projects')"); await h(s, "tab('My projects')");
    check("ui", "Employee sees the assigned project with allocation % under My projects", await waitText(s, `/${CODE}[\\s\\S]*50%/`));

    await openReport(s, D);
    // Task 1: completed with completed work + link
    await h(s, `pickText('Project', ${J(CODE)}, 0)`);
    await h(s, `pickVal('Status', 'completed', 0)`); await sleep(300);
    await h(s, "fillX('Hours', 0, '3')"); await h(s, `fillX('Activity', 0, ${J(A1)})`);
    await h(s, "fillX('Completed work', 0, 'Synthetic endpoint merged')"); await h(s, "fillX('Supporting links', 0, 'https://example.com/m8/pr-1')");
    // Task 2: blocked with inline blocker
    await h(s, "click('Add item')"); await waitFor(s, "count('Activity') === 2");
    await h(s, `pickVal('Status', 'blocked', 1)`); await sleep(300);
    await h(s, "fillX('Hours', 1, '1')"); await h(s, `fillX('Activity', 1, ${J(A2)})`);
    // Task 3: not started, 0 h
    await h(s, "click('Add item')"); await waitFor(s, "count('Activity') === 3");
    await h(s, `pickVal('Status', 'not_started', 2)`); await sleep(300);
    await h(s, "fillX('Hours', 2, '0')"); await h(s, `fillX('Activity', 2, ${J(A3)})`);
    // Client-side validation: blocked task without blocker, then negative hours
    await h(s, "click('Save draft')"); await sleep(600);
    const v1 = await h(s, "alerts()");
    check("error", "Blocked task without a blocker description refused client-side", /blocking this task/.test(v1), v1);
    await h(s, `fillX('Blocker title', 0, ${J(BT)})`); await h(s, "pickVal('Severity', 'high')");
    await h(s, "fillX('Hours', 0, '-2')"); await h(s, "click('Save draft')"); await sleep(600);
    const v2 = await h(s, "alerts()");
    const none = await q1(`select count(*)::int n from hr_daily_reports where employee_id = ${lit(e3)} and report_date = ${lit(D)}`);
    check("error", "Negative hours refused client-side; nothing written", /Between 0 and 24/.test(v2) && none.n === 0, v2);
    await h(s, "fillX('Hours', 0, '3')");
    await h(s, "click('Save draft')");
    const t1 = await toast(s);
    const rep = await waitDb(`select r.id, r.status, r.total_hours::float th, (select count(*)::int from hr_daily_report_items i where i.report_id = r.id) items,
        (select count(*)::int from hr_work_blockers b where b.report_id = r.id and b.item_id is not null and b.severity = 'high') bl
      from hr_daily_reports r where r.employee_id = ${lit(e3)} and r.report_date = ${lit(D)}`, (v) => v?.items === 3 && v?.bl === 1);
    check("ui", "Employee saves a draft with 3 tasks (completed / blocked / not started) (toast)", /Draft saved/.test(t1), t1);
    check("db", "Draft: 3 tasks, total 4.00 h, blocker linked to the blocked task", rep?.status === "draft" && rep?.items === 3 && rep?.th === 4 && rep?.bl === 1, J(rep));
    const it1 = await q1(`select work_status, progress_pct, completion_date::text cd, links from hr_daily_report_items where report_id = ${lit(rep?.id)} and activity = ${lit(A1)}`);
    check("db", "Completed task: progress 100, completion date = report date, link stored", it1?.work_status === "completed" && it1?.progress_pct === 100 && it1?.cd === D && it1?.links?.[0] === "https://example.com/m8/pr-1", J(it1));
    const nb = await q1(`select count(*)::int n from hr_notifications n join auth.users u on u.id = n.recipient_user_id where u.email = ${lit(MGR)} and n.type = 'daily_reports.blocker'
      and n.entity_id in (select id::text from hr_work_blockers where report_id = ${lit(rep?.id)})`);
    check("db", "Reporting manager notified in-app about the blocker", nb.n === 1, `notifications ${nb.n}`);

    // Refresh persistence of the draft
    await openReport(s, D);
    const txt = await h(s, "text()");
    check("refresh", "After reload the draft shows 3 tasks, Total 4.00 h and the blocker", /Total: 4\.00 h/.test(txt) && txt.includes(BT) && (await h(s, "count('Activity')")) === 3, txt.match(/Total: [\d.]+ h/)?.[0]);

    await h(s, "click('Submit')"); await waitFor(s, "dialogs() > 0"); await h(s, "confirm()");
    const t2 = await toast(s);
    const sub = await waitDb(`select status, (select count(*)::int from hr_daily_report_versions v where v.report_id = r.id) versions from hr_daily_reports r where id = ${lit(rep?.id)}`, (v) => v?.status === "submitted");
    check("ui", "Employee submits (toast) → status submitted, version 1 stored", /submitted/.test(t2) && sub?.status === "submitted" && sub?.versions === 1, `${t2}; ${J(sub)}`);
    await s.shot("employee-submitted");
  });
  const dup = await post(EMP, "hr_daily_reports", { employee_id: e3, report_date: D });
  check("error", "Duplicate report for the same employee/date refused by the server", dup.status === 409, `HTTP ${dup.status} ${emsg(dup)}`);
  const repId = (await q1(`select id from hr_daily_reports where employee_id = ${lit(e3)} and report_date = ${lit(D)}`)).id;

  // ---- 3. manager: request changes
  await as(MGR, async (s) => {
    await openReviewRow(s, D, A1);
    const dt = await h(s, "dialogText()");
    check("ui", "Review modal shows task breakdown, completed work, link, blocker and attendance comparison",
      dt.includes(A1) && dt.includes("Synthetic endpoint merged") && dt.includes("example.com/m8/pr-1") && dt.includes(BT) && /Reported hours vs attendance/.test(dt));
    await h(s, "pickVal('Action', 'revision_requested')"); await h(s, "fill('Comment', 'Synthetic: split the endpoint hours')");
    await h(s, "click('Apply', true)");
    const t = await toast(s);
    const st = await waitDb(`select status from hr_daily_reports where id = ${lit(repId)}`, (v) => v?.status === "revision_requested");
    check("ui", "Manager requests changes (toast) → status revision_requested", /Revision requested/.test(t) && st?.status === "revision_requested", t);
  });

  // ---- 4. employee revises and resubmits
  await as(EMP, async (s) => {
    await openReport(s, D);
    check("ui", "Employee sees the changes-requested banner and manager feedback", await waitText(s, "/changes requested[\\s\\S]*split the endpoint hours/"));
    await h(s, "fillX('Hours', 0, '2.5')");
    await h(s, "click('Submit')"); await waitFor(s, "dialogs() > 0"); await h(s, "confirm()");
    const t = await toast(s);
    const st = await waitDb(`select status, total_hours::float th, (select max(version) from hr_daily_report_versions v where v.report_id = r.id) v from hr_daily_reports r where id = ${lit(repId)}`, (v) => v?.status === "submitted");
    check("ui", "Employee revises (3 → 2.5 h) and resubmits → version 2, total 3.50 h", /submitted/.test(t) && st?.th === 3.5 && st?.v === 2, `${t}; ${J(st)}`);
  });

  // ---- 5. manager approves; employee locked; manager reopens
  await as(MGR, async (s) => {
    await openReviewRow(s, D, A1);
    await h(s, "pickVal('Action', 'reviewed')"); await h(s, "click('Apply', true)");
    const t = await toast(s);
    const st = await waitDb(`select status from hr_daily_reports where id = ${lit(repId)}`, (v) => v?.status === "reviewed");
    check("ui", "Manager approves (toast) → status reviewed (shown as Approved)", /approved/i.test(t) && st?.status === "reviewed", t);
    await waitFor(s, "dialogText().includes('Reopen')");
    await h(s, "click('Reopen', true)"); await waitFor(s, "dialogs() > 1");
    await h(s, "fill('Reason', 'Synthetic: wrong project on one task')"); await h(s, "confirm()");
    const t2 = await toast(s);
    const st2 = await waitDb(`select status, (select action from hr_daily_report_reviews x where x.report_id = r.id order by created_at desc limit 1) a from hr_daily_reports r where id = ${lit(repId)}`, (v) => v?.status === "revision_requested");
    check("ui", "Manager reopens the approved report with a reason → changes requested, 'reopened' in history", /reopened/i.test(t2) && st2?.a === "reopened", `${t2}; ${J(st2)}`);
  });
  // Re-approve through the API to continue (UI paths already covered).
  await rpc(EMP, "hr_submit_daily_report", { p_id: repId });
  const ap = await rpc(MGR, "hr_review_daily_report", { p_id: repId, p_action: "reviewed" });
  check("db", "Resubmitted and approved again", ap.body?.status === "reviewed", emsg(ap));
  await as(EMP, async (s) => {
    await openReport(s, D);
    const t = await h(s, "text()");
    const disabled = await s.js("document.querySelector('fieldset').disabled");
    check("permission", "Approved report is locked in the employee UI (Approved, fieldset disabled, no Save draft)", /Approved/.test(t) && disabled === true && !(await h(s, "btn('Save draft')")));
  });
  const self = await rpc(EMP, "hr_reopen_daily_report", { p_id: repId, p_reason: "x" });
  check("permission", "Employee cannot reopen their own report", self.status >= 400 && /own report/.test(emsg(self)), emsg(self));

  // ---- 6. blocker triage: manager assigns owner; owner resolves
  await as(MGR, async (s) => {
    await s.go("/hr/daily-reports?tab=blockers"); await waitText(s, `/${BT}/`);
    await h(s, `rowClick(${J(BT)}, 'Update')`); await waitFor(s, "!!field('Resolution owner')");
    await h(s, "pickText('Resolution owner', 'Demo Engineer 03')"); await h(s, "pickVal('Status', 'in_progress')");
    await h(s, "click('Save', true)");
    const t = await toast(s);
    const b = await waitDb(`select status, owner_employee_id from hr_work_blockers where title = ${lit(BT)}`, (v) => v?.status === "in_progress");
    check("ui", "Manager sets blocker in progress and assigns a resolution owner", /updated/i.test(t) && b?.owner_employee_id === e3, `${t}; ${J(b)}`);
    await s.shot("manager-blockers");
    await h(s, "tab('Overview')"); await waitText(s, "/Active blockers/i");
    await waitFor(s, "text().includes('Demo Engineer 03')");
    const ot = await h(s, "text()");
    check("ui", "Overview shows KPIs, project-wise hours and employee-wise status", /Pending submission/i.test(ot) && /Approved/i.test(ot) && /Project-wise hours/i.test(ot) && ot.includes("Demo Engineer 03"));
    await s.shot("manager-overview");
    await h(s, "tab('Hours')"); await waitText(s, "/Total reported/i");
    await h(s, `fill('From', ${J(D)})`); await h(s, `fill('To', ${J(D)})`);
    await h(s, "pickVal('Group', 'project')");
    check("ui", "Hours tab: project-wise reported hours include the allocated project", await waitText(s, `/Synthetic M8 ${RUN}[\\s\\S]*2\\.50/`));
  });
  await as(EMP, async (s) => {
    await s.go("/employee/daily-reports?tab=blockers"); await waitText(s, `/${BT}/`);
    await h(s, `rowClick(${J(BT)}, 'Update')`); await waitFor(s, "!!field('Status')");
    await h(s, "pickVal('Status', 'resolved')"); await sleep(200); await h(s, "fill('Resolution notes', 'Synthetic access granted')");
    await h(s, "click('Save', true)");
    const t = await toast(s);
    const b = await waitDb(`select status, resolved_date::text rd from hr_work_blockers where title = ${lit(BT)}`, (v) => v?.status === "resolved");
    check("ui", "Employee (reporter / owner) resolves the blocker with notes from My blockers", /resolved/i.test(t) && b?.rd === today, `${t}; ${J(b)}`);
  });

  // ---- 7. role restrictions
  const ov = await rpc(EMP, "hr_daily_work_overview", {});
  check("permission", "Employee cannot open the HR overview (RPC refused)", ov.status >= 400, emsg(ov));
  const lb = await rpc(EMP2, "hr_list_work_blockers", {});
  check("permission", "employee2 cannot see employee@'s blockers", Array.isArray(lb.body) && !lb.body.some((b) => b.title === BT), `rows ${lb.body?.length}`);
  const hs = await rpc(EMP2, "hr_work_hours_summary", { p_from: D, p_to: D, p_group: "employee" });
  check("permission", "employee2 hours summary does not include employee@", Array.isArray(hs.body) && !hs.body.some((r) => r.employee_id === e3), `rows ${hs.body?.length}`);
  await as(EMP2, async (s) => {
    await s.go("/hr/daily-reports"); await sleep(2500);
    check("permission", "employee2 UI: /hr/daily-reports is not accessible", !/Review queue/.test(await h(s, "text()")));
  });

  // ---- 8. mobile layout
  for (const [email, p, name] of [[EMP, "/employee/daily-reports", "employee-mobile"], [MGR, "/hr/daily-reports?tab=overview", "manager-mobile-overview"]]) {
    await as(email, async (s) => {
      await s.go(p); await sleep(3500);
      if (email === EMP) await openReport(s, D);
      const ox = await h(s, "overflowX()");
      check("responsive", `${name}: no horizontal page overflow at 390 px`, ox <= 1, `overflow ${ox}px`);
      await s.shot(name);
    }, { w: 390, h: 844, m: true });
  }

  check("safety", "No external requests; no page exceptions", !blocked.length && !pageErrors.length, `${blocked.length} blocked; errors: ${pageErrors.slice(0, 3).join(" | ")}`);
}

try { await main(); } catch (e) { check("runner", "flow crashed", false, e.stack?.split("\n").slice(0, 3).join(" ")); }
finally {
  for (const p of chromes) { try { p.kill(); } catch {} }
  writeFileSync(OUT, JSON.stringify({ run: RUN, checks, blocked, pageErrors }, null, 2));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed; external requests blocked: ${blocked.length}; page exceptions: ${pageErrors.length}; results: ${OUT}`);
  process.exit(failed ? 1 : 0);
}

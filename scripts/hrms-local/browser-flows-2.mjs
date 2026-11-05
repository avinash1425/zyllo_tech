#!/usr/bin/env node
// TEST-ONLY end-to-end workflow checks (round 2) against the LOCAL HRMS harness.
// Every workflow is verified on five aspects: UI action, database result,
// permission enforcement, error handling and refresh behaviour.
//
//   node scripts/hrms-local/browser-flows-2.mjs --out <results.json> [--state <harness state json>] [--only attendance,payroll,...]
//
// * Talks ONLY to 127.0.0.1 (the harness API + test web server read from the
//   harness state file) and to the throwaway PostgreSQL cluster (read-only
//   SELECTs as the cluster owner, plus supabase/tests/hrms-local/extra_fixtures.sql).
// * Browser NETWORK GUARD: every request whose host is not 127.0.0.1/localhost
//   is failed with BlockedByClient and counted.
// * Synthetic data only (@example.com). Screenshots: docs/hrms/local-test-screenshots/wf2-*.jpg
// * Re-runnable on the same harness: names are suffixed per run; the self
//   check-in subject falls back to intern@ when employee2@ already punched today.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT, findPgBin, makePsql } from "./lib.mjs";
import { syntheticPdf } from "./fixture-files.mjs";

// ------------------------------------------------------------------ config
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STATE_FILE = arg("--state", path.join(tmpdir(), "zyllo-hrms-local.json"));
if (!existsSync(STATE_FILE)) { console.error(`No harness state at ${STATE_FILE}. Start it with node scripts/hrms-local/start.mjs`); process.exit(2); }
const STATE = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const API = `http://127.0.0.1:${STATE.apiPort}`;
const BASE = arg("--base", `http://127.0.0.1:${STATE.webPort}`);
const ANON = STATE.anonKey;
const OUT = arg("--out", path.join(tmpdir(), "hrms-flows2", "results.json"));
const ONLY = arg("--only", "").split(",").filter(Boolean);
const SHOTS = path.join(ROOT, "docs", "hrms", "local-test-screenshots");
const PASSWORD = "Local-Test-Only-2026!";
const RUN = Date.now().toString(36);
const WORK = mkdtempSync(path.join(tmpdir(), "hrms-flows2-"));
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

// ------------------------------------------------------------------ local API (direct attempts)
function assertLocal(url) { const h = new URL(url).hostname; if (h !== "127.0.0.1" && h !== "localhost") throw new Error(`blocked non-local ${url}`); }
async function api(method, p, { token, body, headers = {} } = {}) {
  const url = p.startsWith("http") ? p : API + p;
  assertLocal(url);
  const r = await fetch(url, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, ...(body !== undefined && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json; try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; }
  return { status: r.status, body: json, raw: buf, type: r.headers.get("content-type") };
}
const tokens = new Map();
async function signIn(email, password = PASSWORD) {
  return api("POST", "/auth/v1/token?grant_type=password", { body: { email, password } });
}
async function tok(email) {
  if (!tokens.has(email)) {
    const r = await signIn(email);
    if (!r.body?.access_token) throw new Error(`sign-in failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    tokens.set(email, r.body.access_token);
  }
  return tokens.get(email);
}
const rpc = async (email, fn, args = {}) => api("POST", `/rest/v1/rpc/${fn}`, { token: await tok(email), body: args });
const sel = async (email, p) => api("GET", `/rest/v1/${p}`, { token: await tok(email) });
const emsg = (r) => (r.body && (r.body.message || r.body.error_description || r.body.msg || r.body.error)) || `HTTP ${r.status}`;
const refused = (r) => r.status >= 400;

// ------------------------------------------------------------------ browser (CDP, headless Chrome, network guard)
const OPEN_STUB = `(() => { window.__opened = []; window.open = function () { const w = { closed: false, opener: null, close() { this.closed = true; },
  location: { set href(v) { window.__opened.push(String(v)); }, get href() { return ''; } } }; return w; }; })();`;

async function session(viewport = { w: 1440, h: 900, m: false }) {
  const port = 9600 + Math.floor(Math.random() * 300);
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-flow2-"));
  const proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 80 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
  if (!target) throw new Error("Chrome did not start");
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
    const file = `wf2-${name}.jpg`;
    writeFileSync(path.join(SHOTS, file), Buffer.from(s.data, "base64")); shots.push(file);
  };
  const setFile = async (selector, file) => {
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`file input not found: ${selector}`);
    await send("DOM.setFileInputFiles", { files: [file], nodeId });
  };
  const close = async () => { try { ws.close(); } catch {} proc.kill(); await sleep(600); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { send, js, go, reload, shot, setFile, close };
}

// In-page helpers (injected per call).
const H = `
window.__h = {
  setVal(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
  scope() { const d = [...document.querySelectorAll('[role=dialog]')]; return d[d.length - 1] || document; },
  field(label) { const s = this.scope(); const l = [...s.querySelectorAll('label')].find((x) => x.textContent.replace('*','').trim().startsWith(label)); return l && (document.getElementById(l.htmlFor) || l.querySelector('input,select,textarea')); },
  fill(label, v) { const el = this.field(label); if (!el) return false; this.setVal(el, v); return true; },
  pickText(label, sub) { const el = this.field(label); if (!el || el.tagName !== 'SELECT') return false; const o = [...el.options].find((o) => o.value && o.textContent.includes(sub)); if (!o) return false; this.setVal(el, o.value); return o.textContent; },
  pickVal(label, v) { const el = this.field(label); if (!el || el.tagName !== 'SELECT') return false; if (![...el.options].some((o) => o.value === v)) return false; this.setVal(el, v); return true; },
  options(label) { const el = this.field(label); return el && el.tagName === 'SELECT' ? [...el.options].map((o) => o.value).filter(Boolean) : null; },
  btn(text, inDialog) { const s = inDialog ? this.scope() : document; return [...s.querySelectorAll('button,a')].find((x) => x.textContent.trim().startsWith(text)); },
  click(text, inDialog) { const b = this.btn(text, inDialog); if (!b || b.disabled) return false; b.click(); return true; },
  disabled(text) { const b = this.btn(text, false); return b ? b.disabled : null; },
  clickAria(label) { const b = document.querySelector('[aria-label="' + label + '"]'); if (!b || b.disabled) return false; b.click(); return true; },
  rowClick(rowText, btnText) { const tr = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes(rowText)); if (!tr) return 'no-row'; if (!btnText) { tr.click(); return true; }
    const b = [...tr.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(btnText) || x.getAttribute('aria-label') === btnText); if (!b || b.disabled) return 'no-button'; b.click(); return true; },
  rowText(rowText) { const tr = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes(rowText)); return tr ? tr.innerText.replace(/\\s+/g, ' ') : null; },
  liClick(liText, btnText) { const li = [...document.querySelectorAll('li')].find((l) => l.querySelector('p') && l.querySelector('p').textContent.includes(liText)); if (!li) return 'no-li';
    const b = [...li.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(btnText)); if (!b) return 'no-button'; if (b.disabled) return 'disabled'; b.click(); return true; },
  liText(liText) { const li = [...document.querySelectorAll('li')].find((l) => l.querySelector('p') && l.querySelector('p').textContent.includes(liText)); return li ? li.innerText.replace(/\\s+/g, ' ') : null; },
  tick(labelText) { const s = this.scope(); const l = [...s.querySelectorAll('label')].find((x) => x.textContent.trim().includes(labelText)); const i = l && (document.getElementById(l.htmlFor) || l.querySelector('input')); if (!i) return false; if (!i.checked) i.click(); return true; },
  tab(text) { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim().startsWith(text)); if (!t) return false; t.click(); return true; },
  confirm() { const d = this.scope(); if (d === document) return false; const bs = [...d.querySelectorAll('button')].filter((b) => !/^(Cancel|Close)$/.test(b.textContent.trim()) && !b.getAttribute('aria-label')); const b = bs[bs.length - 1]; if (!b) return false; b.click(); return b.textContent.trim(); },
  cancel() { const d = this.scope(); if (d === document) return false; const b = [...d.querySelectorAll('button')].find((x) => /^(Cancel|Close)$/.test(x.textContent.trim())); if (!b) return false; b.click(); return true; },
  dialogOpen() { return document.querySelectorAll('[role=dialog]').length; },
  dialogText() { const d = this.scope(); return d === document ? '' : d.innerText; },
  alerts() { return [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent.trim()).filter(Boolean); },
  toasts() { return [...document.querySelectorAll('[aria-live=polite] [role=status]')].map((t) => t.textContent.trim()); },
  text() { return document.body.innerText; },
  main() { return (document.querySelector('main') || document.body).innerText; },
};`;
// Before any click, toasts already on screen are marked as seen, so toastText()
// only reports toasts produced by that action.
const MARK_TOASTS = "document.querySelectorAll('[aria-live=polite] [role=status]').forEach((x) => x.setAttribute('data-wf2-seen', '1'));";
const h = (s, expr) => s.js(`(() => { ${H}; ${/^(click|confirm|rowClick|liClick|clickAria)\(/.test(expr) ? MARK_TOASTS : ""} return window.__h.${expr}; })()`);
const J = JSON.stringify;
async function waitFor(s, expr, timeout = 10000, every = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await h(s, expr)) return true; await sleep(every); }
  return false;
}
const waitText = (s, re, timeout = 10000) => waitFor(s, `text().match(${re})`, timeout);
const waitDialog = (s, timeout = 6000) => waitFor(s, "dialogOpen() > 0", timeout);
const waitNoDialog = (s, timeout = 8000) => waitFor(s, "dialogOpen() === 0", timeout);
let lastToast = "";
async function toastText(s, timeout = 6000) {
  // returns the text of toasts that appeared since the last call (nodes are marked as seen)
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const t = await s.js("(() => { const n = [...document.querySelectorAll('[aria-live=polite] [role=status]:not([data-wf2-seen])')]; n.forEach((x) => x.setAttribute('data-wf2-seen', '1')); return n.map((x) => x.textContent.trim()); })()") ?? [];
    if (t.length) { lastToast = t.join(' | '); return lastToast; }
    await sleep(200);
  }
  return '';
}

async function login(s, email, password = PASSWORD) {
  await s.go("/login", 2500);
  await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${J(email)}); set('password', ${J(password)}); document.querySelector('form').requestSubmit(); })()`);
  for (let i = 0; i < 30; i++) { await sleep(400); const p = await s.js("location.pathname"); if (p && p !== "/login") { await sleep(1500); return p; } }
  return s.js("location.pathname");
}

// ------------------------------------------------------------------ shared lookups
const empId = async (companyEmail) => (await q1(`select id from hr_employees where company_email = ${lit(companyEmail)}`))?.id;
const userId = async (email) => (await q1(`select id from auth.users where email = ${lit(email)}`))?.id;
const pastWorkday = async (n) => (await q1(`select d::text from (select g::date d, row_number() over (order by g desc) rn
  from generate_series(hr_private.business_today() - 60, hr_private.business_today() - 1, interval '1 day') g
  where extract(isodow from g) between 1 and 5 and not exists (select 1 from hr_holidays h where h.holiday_date = g::date)) x where rn = ${n}`)).d;
const TODAY = async () => (await q1("select hr_private.business_today()::text d")).d;

/** Expected attendance figures from 101_hr_attendance.sql::attendance_compute, computed independently in JS. */
function expectedAttendance(row, shift) {
  const min = (a, b) => Math.floor((new Date(a) - new Date(b)) / 60000);
  const lateDiff = min(row.check_in_at, row.expected_start_at);
  const late = lateDiff > shift.grace_minutes ? lateDiff : 0;
  const net = Math.max(min(row.expected_end_at, row.expected_start_at) - shift.break_minutes, 0);
  if (!row.check_out_at) return { late, worked: null, status: late > 0 ? "late" : "present", early: 0, overtime: 0, net };
  const span = min(row.check_out_at, row.check_in_at);
  const worked = Math.max(span - shift.break_minutes, 0);
  const earlyDiff = min(row.expected_end_at, row.check_out_at);
  const early = earlyDiff > shift.early_leave_grace_minutes ? earlyDiff : 0;
  const overtime = Math.max(worked - net - (shift.overtime_after_minutes ?? 0), 0);
  const status = worked < net / 2 ? "half_day" : late > 0 ? "late" : "present";
  return { late, worked, early, overtime, status, net, span, breakTaken: Math.min(shift.break_minutes, span) };
}
const cmp = (row, exp) => ["late:late_minutes", "worked:worked_minutes", "early:early_leave_minutes", "overtime:overtime_minutes", "status:status"]
  .map((p) => p.split(":")).filter(([e, r]) => String(exp[e]) !== String(row[r])).map(([e, r]) => `${r}=${row[r]} expected ${exp[e]}`);

// ==================================================================== 1. ATTENDANCE
async function wfAttendance() {
  const WF = "attendance";
  const today = await TODAY();
  const emp3 = await empId("demo.engineer3@example.com");
  const emp2 = await empId("demo.designer@example.com");
  let subj = null;
  for (const [login, company, name] of [["employee2@example.com", "demo.designer@example.com", "Demo Designer"], ["intern@example.com", "demo.intern1@example.com", "Demo Intern 1"]]) {
    const r = await q1(`select e.id from hr_employees e where e.company_email = ${lit(company)} and not exists (select 1 from hr_attendance a where a.employee_id = e.id and a.work_date = hr_private.business_today())`);
    if (r) { subj = { login, id: r.id, name }; break; }
  }
  if (!subj) { check(WF, "ui", "A self check-in subject without a record today exists", false, "employee2@ and intern@ already punched today — run on a fresh harness"); return; }
  const shift = await q1(`select * from hr_private.employee_shift(${lit(subj.id)})`);
  const tz = (await q1("select hr_private.business_timezone() tz")).tz;
  console.log(`  [attendance] subject ${subj.login}; shift ${shift.start_time}-${shift.end_time} grace ${shift.grace_minutes} break ${shift.break_minutes}; today ${today}`);

  // ---------- Punch in
  let s = await session();
  await login(s, subj.login);
  await s.go("/employee/attendance", 4500);
  check(WF, "ui", "Check in button enabled before punching", (await h(s, "disabled('Check in')")) === false);
  await h(s, "click('Check in')"); await waitDialog(s);
  const dlg = await h(s, "dialogText()");
  await h(s, "confirm()");
  const t1 = await toastText(s);
  check(WF, "ui", "Punch In via 'Check in' + confirm shows a server-time toast", /Checked in at \d{2}:\d{2} \(server time/.test(t1), `dialog="${dlg.split("\n")[0]}"; toast="${t1}"`);
  await sleep(1500);
  let rows = await q(`select a.*, extract(epoch from (now() - a.check_in_at))::int as age_s from hr_attendance a where employee_id = ${lit(subj.id)} and work_date = ${lit(today)}`);
  const inRow = rows[0];
  let exp = inRow ? expectedAttendance(inRow, shift) : null;
  check(WF, "db", "Punch In: one hr_attendance row with server check_in_at, source=self", rows.length === 1 && inRow.check_in_at && inRow.age_s >= 0 && inRow.age_s < 120 && inRow.source === "self" && !inRow.check_out_at,
    inRow ? `check_in_at=${inRow.check_in_at} (age ${inRow.age_s}s) source=${inRow.source}` : "no row");
  check(WF, "db", "Punch In: late_minutes/status follow the shift rules", inRow && cmp(inRow, exp).filter((x) => /late|status/.test(x)).length === 0,
    inRow ? `late_minutes=${inRow.late_minutes} status=${inRow.status}; expected late ${exp.late} (grace ${shift.grace_minutes}, shift start ${inRow.expected_start_at}) status ${exp.status}` : "");
  check(WF, "error", "Duplicate punch: Check in button disabled after checking in", (await h(s, "disabled('Check in')")) === true);
  await s.shot("attendance-checked-in");
  const dup = await rpc(subj.login, "hr_check_in", { p_note: "duplicate attempt" });
  const cnt = (await q1(`select count(*)::int n from hr_attendance where employee_id = ${lit(subj.id)} and work_date = ${lit(today)}`)).n;
  const same = (await q1(`select check_in_at from hr_attendance where employee_id = ${lit(subj.id)} and work_date = ${lit(today)}`)).check_in_at;
  check(WF, "error", "Duplicate punch: direct RPC hr_check_in refused with a message; no second row, time unchanged", refused(dup) && /already checked in/i.test(emsg(dup)) && cnt === 1 && same === inRow.check_in_at,
    `HTTP ${dup.status} "${emsg(dup)}"; rows=${cnt}`);

  // ---------- Refresh after punch in
  await s.reload(4500);
  check(WF, "refresh", "After reload: still checked in (Check in disabled, Check out enabled)", (await h(s, "disabled('Check in')")) === true && (await h(s, "disabled('Check out')")) === false && /You are checked in/.test(await h(s, "text()")));

  // ---------- Punch out
  await sleep(2000);
  await h(s, "click('Check out')"); await waitDialog(s); await h(s, "confirm()");
  const t2 = await toastText(s);
  check(WF, "ui", "Punch Out via 'Check out' + confirm shows a server-time toast", /Checked out at \d{2}:\d{2}/.test(t2), t2);
  await sleep(1500);
  const outRow = await q1(`select * from hr_attendance where employee_id = ${lit(subj.id)} and work_date = ${lit(today)}`);
  exp = expectedAttendance(outRow, shift);
  const diffs = cmp(outRow, exp);
  check(WF, "db", "Punch Out: check_out_at set; worked = (out-in) - break; early/OT/status per 101_hr_attendance.sql", outRow.check_out_at && diffs.length === 0,
    `in=${outRow.check_in_at} out=${outRow.check_out_at} span=${exp.span}min break=${shift.break_minutes} -> worked=${outRow.worked_minutes} (exp ${exp.worked}); net shift ${exp.net}min so worked < net/2 -> status=${outRow.status} (exp ${exp.status}); early=${outRow.early_leave_minutes} (exp ${exp.early}); OT=${outRow.overtime_minutes} (exp ${exp.overtime}); break_minutes stored=${outRow.break_minutes} (exp ${exp.breakTaken})${diffs.length ? "; DIFF " + diffs.join(", ") : ""}`);
  const dupOut = await rpc(subj.login, "hr_check_out", {});
  check(WF, "error", "Second check-out refused with a message", refused(dupOut) && /already checked out/i.test(emsg(dupOut)), `HTTP ${dupOut.status} "${emsg(dupOut)}"`);
  await s.reload(4500);
  const txt = await h(s, "text()");
  const inHm = (await q1(`select to_char(check_in_at at time zone ${lit(tz)}, 'HH24:MI') hm from hr_attendance where id = ${lit(outRow.id)}`)).hm;
  check(WF, "refresh", "After reload: checked out state persists (both buttons disabled)", /You have checked out for today/.test(txt) && (await h(s, "disabled('Check in')")) === true && (await h(s, "disabled('Check out')")) === true);
  await waitFor(s, `rowText(${J(inHm)})`, 6000);
  const histRow = await h(s, `rowText(${J(inHm)})`);
  check(WF, "ui", "Monthly history table shows today's row (check-in time, status)", histRow?.includes(outRow.status.replace(/_/g, " ")), histRow ?? (await s.js("[...document.querySelectorAll('table')].map((t) => t.innerText).join(' || ').replace(/\\s+/g, ' ').slice(0, 300)")));
  await s.shot("attendance-checked-out");
  await s.close();

  // ---------- HR + manager visibility
  s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/attendance", 5000);
  let reg = await h(s, "main()");
  check(WF, "ui", "HR (attendance.view) daily register shows the punch subject's row today", reg.includes(subj.name) && reg.includes("Demo Engineer 03"), `${subj.name}: ${reg.includes(subj.name)}`);
  await s.shot("attendance-hr-register");
  await s.close();
  s = await session();
  await login(s, "manager@example.com");
  await s.go("/hr/attendance", 5000);
  reg = await h(s, "main()");
  check(WF, "permission", "Manager register: sees own team member (Engineer 03), not employee2 (Designer)", reg.includes("Demo Engineer 03") && !reg.includes("Demo Designer"));
  const mgrApi = await sel("manager@example.com", `hr_attendance?select=employee_id&work_date=eq.${today}`);
  check(WF, "permission", "Manager API select today: no Designer row (RLS team scope)", mgrApi.status === 200 && !mgrApi.body.some((r) => r.employee_id === emp2) && mgrApi.body.some((r) => r.employee_id === emp3), `${mgrApi.body?.length} rows`);
  await s.close();

  // ---------- isolation / permission
  const e2sees = await sel("employee2@example.com", `hr_attendance?select=id&employee_id=eq.${emp3}`);
  const e1sees = await sel("employee@example.com", `hr_attendance?select=id&employee_id=eq.${emp2}`);
  check(WF, "permission", "employee2 API select of employee@'s attendance returns nothing (RLS)", e2sees.status === 200 && e2sees.body.length === 0, `status ${e2sees.status}, ${e2sees.body?.length} rows`);
  check(WF, "permission", "employee@ API select of employee2's attendance returns nothing (RLS)", e1sees.status === 200 && e1sees.body.length === 0, `status ${e1sees.status}, ${e1sees.body?.length} rows`);
  const man = await rpc("employee@example.com", "hr_upsert_attendance_manual", { p_employee: emp2, p_work_date: today, p_check_in: new Date().toISOString(), p_check_out: null, p_note: "attempt by employee" });
  check(WF, "permission", "Employee cannot call hr_upsert_attendance_manual", refused(man) && /not allowed/i.test(emsg(man)), `HTTP ${man.status} "${emsg(man)}"`);
  const pend = await q1(`select id from hr_attendance_corrections where employee_id = ${lit(emp3)} and status = 'pending' limit 1`);
  if (pend) {
    const dec = await rpc("employee2@example.com", "hr_decide_attendance_correction", { p_id: pend.id, p_approve: true, p_note: null });
    const still = (await q1(`select status from hr_attendance_corrections where id = ${lit(pend.id)}`)).status;
    check(WF, "permission", "Employee (employee2) cannot decide employee@'s correction", refused(dec) && /not allowed/i.test(emsg(dec)) && still === "pending", `HTTP ${dec.status} "${emsg(dec)}"; status still ${still}`);
  }
  const mm = await rpc("employee@example.com", "hr_mark_missing_punches", { p_date: await pastWorkday(1) });
  check(WF, "permission", "Employee cannot mark missing punches", refused(mm) && /not allowed/i.test(emsg(mm)), `HTTP ${mm.status} "${emsg(mm)}"`);
  s = await session();
  await login(s, "employee@example.com");
  await s.go("/hr/attendance", 3500);
  check(WF, "permission", "Employee UI: /hr/attendance is blocked", /Not authorised/.test(await h(s, "text()")));
  await s.close();

  // ---------- HR manual entry (realistic duration) 09:40 -> 18:45 on a past working day
  const D1 = await pastWorkday(8);
  const D2 = await pastWorkday(7);
  s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/attendance", 4500);
  const d1Before = await q1(`select updated_at from hr_attendance where employee_id = ${lit(emp2)} and work_date = ${lit(D1)}`);
  await h(s, "click('Manual entry')"); await waitDialog(s); await sleep(1500);
  await h(s, "pickText('Employee', 'Demo Designer')");
  await h(s, `fill('Date', ${J(D1)})`);
  await h(s, "fill('Check-out', '18:45')");
  await h(s, "fill('Note', 'Synthetic manual entry (browser-flows-2)')");
  await h(s, "click('Save entry', true)"); await sleep(800);
  check(WF, "error", "Manual entry: check-out without check-in rejected client-side (nothing written)", /A check-out needs a check-in/.test(await h(s, "dialogText()")) && (await q1(`select updated_at from hr_attendance where employee_id = ${lit(emp2)} and work_date = ${lit(D1)}`))?.updated_at === d1Before?.updated_at);
  await h(s, "fill('Check-in', '09:40')");
  await h(s, "click('Save entry', true)");
  const tm = await toastText(s);
  await waitNoDialog(s);
  const mRow = await q1(`select * from hr_attendance where employee_id = ${lit(emp2)} and work_date = ${lit(D1)}`);
  const mExp = expectedAttendance(mRow, shift);
  const mDiff = cmp(mRow, mExp);
  check(WF, "ui", "HR manual entry modal saves (toast)", /Attendance saved/.test(tm), tm);
  check(WF, "db", "Manual 09:40→18:45: worked/late/early/OT/status match the shift rules", mRow.source === "manual" && mDiff.length === 0 && mRow.worked_minutes === 485 && mRow.late_minutes === 0 && mRow.overtime_minutes === 5 && mRow.status === "present",
    `shift ${shift.start_time}-${shift.end_time}, grace ${shift.grace_minutes}, break ${shift.break_minutes}: span 545 - 60 = worked ${mRow.worked_minutes}; late ${mRow.late_minutes} (10 min after start, not > grace 10); early ${mRow.early_leave_minutes}; OT ${mRow.overtime_minutes} (485 - 480 net); status ${mRow.status}; source ${mRow.source}${mDiff.length ? "; DIFF " + mDiff.join(", ") : ""}`);
  const badTimes = await rpc("hr.admin@example.com", "hr_upsert_attendance_manual", { p_employee: emp2, p_work_date: D1, p_check_in: `${D1}T13:00:00Z`, p_check_out: `${D1}T05:00:00Z`, p_note: "bad times" });
  const mRow2 = await q1(`select worked_minutes, updated_at from hr_attendance where id = ${lit(mRow.id)}`);
  check(WF, "error", "Server refuses a manual entry with check-out before check-in; row unchanged", refused(badTimes) && /after check-in/i.test(emsg(badTimes)) && mRow2.updated_at === mRow.updated_at, `HTTP ${badTimes.status} "${emsg(badTimes)}"`);
  await s.reload(4500);
  await h(s, `fill('Date', ${J(D1)})`); await sleep(2500);
  const rt = await h(s, "rowText('Demo Designer')");
  check(WF, "refresh", "After reload (register filtered to that date): 09:40 / 18:45 / 8h 05m shown", rt && rt.includes("09:40") && rt.includes("18:45") && rt.includes("8h 05m"), rt);

  // ---------- Missing punch: past day with check-in only
  await h(s, "click('Manual entry')"); await waitDialog(s); await sleep(1500);
  await h(s, "pickText('Employee', 'Demo Designer')");
  await h(s, `fill('Date', ${J(D2)})`); await h(s, "fill('Check-in', '09:35')"); await h(s, "fill('Note', 'Synthetic: forgot to check out (browser-flows-2)')");
  await h(s, "click('Save entry', true)"); await toastText(s); await waitNoDialog(s);
  let open = await q1(`select * from hr_attendance where employee_id = ${lit(emp2)} and work_date = ${lit(D2)}`);
  check(WF, "db", "Missing-punch setup: past day with check-in and no check-out (manual entry)", open && open.check_in_at && !open.check_out_at, `${D2}: in ${open?.check_in_at} out ${open?.check_out_at} status ${open?.status}`);
  await s.go("/hr/attendance?tab=exceptions", 5000);
  check(WF, "ui", "HR Exceptions tab lists the open punch", Boolean(await h(s, "rowText('Demo Designer')")), await h(s, "rowText('Demo Designer')"));
  await h(s, "click('Mark missing punches')"); await waitDialog(s);
  await h(s, `fill('Date', ${J(today)})`); await h(s, "click('Mark and notify', true)"); await sleep(800);
  check(WF, "error", "Mark missing punches for today/future refused client-side", /Choose a past date/.test(await h(s, "dialogText()")));
  await h(s, `fill('Date', ${J(D2)})`); await h(s, "click('Mark and notify', true)");
  const tmm = await toastText(s); await waitNoDialog(s); await sleep(1500);
  open = await q1(`select * from hr_attendance where employee_id = ${lit(emp2)} and work_date = ${lit(D2)}`);
  const notif = await q1(`select n.type, n.title, n.created_at from hr_notifications n where n.recipient_user_id = ${lit(await userId("employee2@example.com"))} and n.type = 'attendance.missing_punch' and n.entity_id = ${lit(open.id)} order by created_at desc limit 1`);
  check(WF, "ui", "'Mark missing punches' for that date confirms with a count", /marked as missing punch/.test(tmm), tmm);
  check(WF, "db", "Status set to missing_punch and employee notified (hr_notifications)", open.status === "missing_punch" && notif, `status=${open.status}; notification=${notif ? notif.title : "none"}`);
  const ex = await h(s, "main()");
  check(WF, "ui", "HR Exceptions 'Recorded absences and missing punches' shows the row", /missing punch/.test(ex) && ex.includes("Demo Designer"));
  await s.shot("attendance-hr-exceptions");
  await s.close();

  // ---------- Employee sees it, requests a correction
  s = await session();
  await login(s, "employee2@example.com");
  await s.go("/employee/attendance", 4500);
  await s.js(`(() => { ${H}; const m = document.querySelector('input[type=month]'); __h.setVal(m, ${J(D2.slice(0, 7))}); })()`); await sleep(2500);
  const hist = await h(s, "rowText('09:35')");
  check(WF, "ui", "Employee history shows the missing-punch day", hist && /missing punch/.test(hist), hist);
  await h(s, "click('Request correction')"); await waitDialog(s);
  await h(s, `fill('Attendance date', ${J(D2)})`); await sleep(400);
  await h(s, "fill('Check-out time', '18:40')");
  await h(s, "fill('Reason', 'Synthetic: forgot to punch out (browser-flows-2)')");
  await h(s, "click('Submit request', true)");
  const tc = await toastText(s); await waitNoDialog(s);
  const corr = await q1(`select * from hr_attendance_corrections where employee_id = ${lit(emp2)} and work_date = ${lit(D2)} order by created_at desc limit 1`);
  check(WF, "ui", "Employee submits a correction request (toast)", /submitted for approval/.test(tc), tc);
  check(WF, "db", "Correction row pending with the requested check-out", corr && corr.status === "pending" && corr.requested_check_out_at, `status=${corr?.status} requested_out=${corr?.requested_check_out_at}`);
  await h(s, "click('Request correction')"); await waitDialog(s);
  await h(s, `fill('Attendance date', ${J(D2)})`); await sleep(300);
  await h(s, "fill('Check-out time', '18:30')"); await h(s, "fill('Reason', 'Duplicate attempt (browser-flows-2)')");
  await h(s, "click('Submit request', true)"); await sleep(2500);
  const dupc = (await h(s, "alerts()")).join(" | ");
  const nPend = (await q1(`select count(*)::int n from hr_attendance_corrections where employee_id = ${lit(emp2)} and work_date = ${lit(D2)} and status = 'pending'`)).n;
  check(WF, "error", "Second pending correction for the same date refused with a message; nothing written", /already have a pending correction/.test(dupc) && nPend === 1, `${dupc}; pending=${nPend}`);
  await h(s, "cancel()"); await sleep(500);
  await s.close();

  // ---------- HR approves
  s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/attendance?tab=corrections", 5000);
  const r = await h(s, "rowClick('Demo Designer', 'Approve')");
  await waitDialog(s); await h(s, "confirm()");
  const ta = await toastText(s); await waitNoDialog(s); await sleep(1000);
  const fixed = await q1(`select * from hr_attendance where employee_id = ${lit(emp2)} and work_date = ${lit(D2)}`);
  const cExp = expectedAttendance(fixed, shift);
  const corr2 = await q1(`select status, reviewed_at from hr_attendance_corrections where id = ${lit(corr.id)}`);
  const n2 = await q1(`select title from hr_notifications where recipient_user_id = ${lit(await userId("employee2@example.com"))} and entity_id = ${lit(corr.id)} and type = 'attendance.correction_approved'`);
  check(WF, "ui", "HR approves the correction from the Corrections tab", r === true && /approved/.test(ta), ta);
  check(WF, "db", "Approved: attendance recalculated, source=correction, correction approved, employee notified", fixed.source === "correction" && fixed.check_out_at && cmp(fixed, cExp).length === 0 && corr2.status === "approved" && n2,
    `status=${fixed.status} worked=${fixed.worked_minutes} (exp ${cExp.worked}) source=${fixed.source}; correction=${corr2.status}; notified=${Boolean(n2)}`);
  await s.close();
  s = await session();
  await login(s, "employee2@example.com");
  await s.go("/employee/attendance", 4500);
  await s.js(`(() => { ${H}; __h.setVal(document.querySelector('input[type=month]'), ${J(D2.slice(0, 7))}); })()`); await sleep(2500);
  const h2 = await h(s, "rowText('09:35')");
  check(WF, "refresh", "Employee history after reload shows the corrected day (18:40, source correction)", h2 && h2.includes("18:40") && h2.includes("correction"), h2);
  await s.shot("attendance-employee-corrected");
  await s.close();
}

// ==================================================================== 2. PAYROLL
async function wfPayroll() {
  const WF = "payroll";
  const runs = await q("select period_start::text s, period_end::text e from hr_payroll_runs");
  const t = new Date(`${await TODAY()}T00:00:00Z`);
  let start, end;
  for (let k = 0; k < 24; k++) {
    const a = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + k, 1)); const b = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + k + 1, 0));
    const sIso = a.toISOString().slice(0, 10), eIso = b.toISOString().slice(0, 10);
    if (!runs.some((r) => r.s <= eIso && r.e >= sIso)) { start = sIso; end = eIso; break; }
  }
  console.log(`  [payroll] period ${start}..${end}`);
  const emp3 = await empId("demo.engineer3@example.com");
  const emp2 = await empId("demo.designer@example.com");
  const slipsBefore = (await q1(`select count(*)::int n from hr_payslips where employee_id = ${lit(emp3)}`)).n;

  let s = await session();
  await login(s, "payroll.admin@example.com");
  await s.go("/hr/payroll", 4500);
  await h(s, "click('New payroll run')"); await waitDialog(s);
  await h(s, `fill('Period start', ${J(runs[0]?.s ?? start)})`); await h(s, `fill('Period end', ${J(runs[0]?.e ?? end)})`);
  await h(s, "click('Create draft', true)"); await sleep(2500);
  const ovl = (await h(s, "alerts()")).join(" | ");
  check(WF, "error", "Creating a run overlapping the finalized fixture period is refused with a message", /overlapping period/i.test(ovl), ovl);
  await h(s, `fill('Period start', ${J(start)})`); await h(s, `fill('Period end', ${J(end)})`); await h(s, "fill('Notes', 'Synthetic run (browser-flows-2)')");
  await h(s, "click('Create draft', true)"); await sleep(3500);
  const runPath = await s.js("location.pathname");
  const run = await q1(`select * from hr_payroll_runs where period_start = ${lit(start)}`);
  check(WF, "ui", "payroll.admin creates a draft run from the UI (navigates to run detail)", run && runPath === `/hr/payroll/runs/${run.id}`, runPath);
  check(WF, "db", "Run row status=draft, created_by=payroll.admin", run?.status === "draft" && run.created_by === await userId("payroll.admin@example.com"), run?.status);
  await h(s, "click('Calculate')"); await waitDialog(s); await h(s, "confirm()");
  const tcalc = await toastText(s, 10000); await waitNoDialog(s); await sleep(1500);
  const items = await q1(`select count(*)::int n, sum(net)::numeric net, bool_or(employee_id = ${lit(emp3)}) has3 from hr_payroll_items where run_id = ${lit(run.id)}`);
  check(WF, "ui", "Calculate → toast with employee count and net", /Calculated \d+ employee/.test(tcalc), tcalc);
  check(WF, "db", "Run calculated with payroll items (incl. employee@)", (await q1(`select status from hr_payroll_runs where id = ${lit(run.id)}`)).status === "calculated" && items.n > 0 && items.has3, `${items.n} items, net ${items.net}`);
  await h(s, "click('Mark reviewed')"); await waitDialog(s); await h(s, "confirm()"); await toastText(s); await waitNoDialog(s); await sleep(1500);
  check(WF, "db", "Run reviewed by payroll.admin", (await q1(`select status from hr_payroll_runs where id = ${lit(run.id)}`)).status === "reviewed");
  // separation of duties: the preparer tries to approve
  check(WF, "ui", "Preparer sees the separation-of-duties warning", /Separation of duties/i.test(await h(s, "main()")));
  await h(s, "click('Approve')"); await waitDialog(s); await h(s, "confirm()"); await sleep(2500);
  const sod = (await h(s, "alerts()")).join(" | ");
  check(WF, "permission", "payroll.admin approving own calculated run is refused (separation of duties) with message", /different person/i.test(sod) && (await q1(`select status from hr_payroll_runs where id = ${lit(run.id)}`)).status === "reviewed", sod);
  await s.shot("payroll-separation-of-duties");
  await h(s, "cancel()"); await sleep(400);
  await s.close();

  // finalize without approval (API, approver)
  const fin0 = await rpc("payroll.approver@example.com", "hr_finalize_payroll_run", { p_id: run.id });
  check(WF, "error", "Finalize before approval refused with message; no payslips", refused(fin0) && /Only approved runs can be finalized/i.test(emsg(fin0)) && (await q1(`select count(*)::int n from hr_payslips where run_id = ${lit(run.id)}`)).n === 0, `HTTP ${fin0.status} "${emsg(fin0)}"`);

  s = await session();
  await login(s, "payroll.approver@example.com");
  await s.go(`/hr/payroll/runs/${run.id}`, 5000);
  await h(s, "click('Approve')"); await waitDialog(s); await h(s, "confirm()"); await toastText(s); await waitNoDialog(s); await sleep(1500);
  let rr = await q1(`select * from hr_payroll_runs where id = ${lit(run.id)}`);
  check(WF, "db", "payroll.approver approves (approved_by = approver)", rr.status === "approved" && rr.approved_by === await userId("payroll.approver@example.com"), rr.status);
  await h(s, "click('Finalize')"); await waitDialog(s);
  await h(s, "click('Finalize', true)"); await sleep(800);
  check(WF, "error", "Finalize modal requires the irreversible-acknowledgement tick", /Tick the confirmation/.test(await h(s, "dialogText()")) && (await q1(`select status from hr_payroll_runs where id = ${lit(run.id)}`)).status === "approved");
  await h(s, "tick('I understand')"); await h(s, "click('Finalize', true)");
  const tfin = await toastText(s, 10000); await waitNoDialog(s); await sleep(1500);
  rr = await q1(`select * from hr_payroll_runs where id = ${lit(run.id)}`);
  const slips = await q1(`select count(*)::int n, bool_or(employee_id = ${lit(emp3)}) has3, min(published_at)::text pub from hr_payslips where run_id = ${lit(run.id)}`);
  const withUser = (await q1(`select count(*)::int n from hr_payslips p join hr_employees e on e.id = p.employee_id where p.run_id = ${lit(run.id)} and e.user_id is not null`)).n;
  const pn = await q1(`select count(*)::int n from hr_notifications where type = 'payroll.payslip_published' and entity_id in (select id::text from hr_payslips where run_id = ${lit(run.id)})`);
  check(WF, "ui", "Finalize & publish payslips → toast", /payslip\(s\) published/.test(tfin), tfin);
  check(WF, "db", "Run finalized; one published payslip per item; employees notified", rr.status === "finalized" && slips.n === items.n && slips.has3 && slips.pub && pn.n === withUser, `payslips=${slips.n} items=${items.n}; notifications=${pn.n} (= payslip employees with a linked portal account: ${withUser})`);
  await h(s, "click('Record as paid')"); await waitDialog(s);
  await h(s, "fill('Bank / payment reference', 'ab')"); await h(s, "click('Record as paid', true)"); await sleep(800);
  check(WF, "error", "Paid reference shorter than 3 chars rejected; run stays finalized", /at least 3 characters/.test(await h(s, "dialogText()")) && (await q1(`select status from hr_payroll_runs where id = ${lit(run.id)}`)).status === "finalized");
  const ref = `SAMPLE-BATCH-${RUN}`;
  await h(s, `fill('Bank / payment reference', ${J(ref)})`); await h(s, "click('Record as paid', true)");
  const tpaid = await toastText(s); await waitNoDialog(s); await sleep(1500);
  rr = await q1(`select * from hr_payroll_runs where id = ${lit(run.id)}`);
  check(WF, "ui", "Record as paid → toast (no money moved)", /Payment recorded/.test(tpaid), tpaid);
  check(WF, "db", "Run status paid with payment_reference, paid_by approver", rr.status === "paid" && rr.payment_reference === ref && rr.paid_by === await userId("payroll.approver@example.com"), `${rr.status} ${rr.payment_reference}`);
  await s.reload(5000);
  check(WF, "refresh", "After reload: run page shows Paid with the reference", (await h(s, "main()")).includes(ref) && /Paid · reference/.test(await h(s, "main()")));
  await s.shot("payroll-run-paid");
  await s.close();

  // employee sees new payslip
  s = await session();
  await login(s, "employee@example.com");
  await s.go("/employee/payslips", 4500);
  await s.reload(4500);
  const slipsNow = (await q1(`select count(*)::int n from hr_payslips where employee_id = ${lit(emp3)}`)).n;
  const rowsCount = await s.js("(() => { const t = document.querySelector('main table tbody'); return t ? [...t.querySelectorAll('tr')].filter((r) => r.querySelectorAll('td').length > 1).length : -1; })()");
  check(WF, "refresh", "Employee /employee/payslips after reload lists the new payslip", slipsNow === slipsBefore + 1 && rowsCount === slipsNow, `db ${slipsBefore}→${slipsNow}, table rows ${rowsCount}`);
  await s.shot("payroll-employee-payslips");
  await s.go("/hr/payroll", 3000);
  check(WF, "permission", "Employee UI: /hr/payroll blocked", /Not authorised/.test(await h(s, "text()")));
  await s.close();
  const other = await sel("employee@example.com", `hr_payslips?select=id,net&employee_id=eq.${emp2}`);
  const own = await sel("employee@example.com", `hr_payslips?select=id&employee_id=eq.${emp3}`);
  check(WF, "permission", "Employee API cannot read another employee's payslips (RLS)", other.status === 200 && other.body.length === 0 && own.body?.length === slipsNow, `other=${other.body?.length} own=${own.body?.length}`);
  s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/payroll", 3500);
  const hrTxt = await h(s, "main()");
  const hrPath = await s.js("location.pathname");
  check(WF, "permission", "hr.admin cannot open Payroll (no payroll.view): redirected/blocked, no run data shown", !/Payroll runs|New payroll run/.test(hrTxt) && !hrTxt.includes(ref), `landed on ${hrPath}: ${hrTxt.slice(0, 60).replace(/\s+/g, " ")}`);
  await s.close();
  const hrCreate = await rpc("hr.admin@example.com", "hr_create_payroll_run", { p_period_start: "2030-01-01", p_period_end: "2030-01-31", p_notes: null });
  const hrRead = await sel("hr.admin@example.com", `hr_payroll_runs?select=id&id=eq.${run.id}`);
  check(WF, "permission", "hr.admin API: create run refused, run not readable", refused(hrCreate) && /not allowed/i.test(emsg(hrCreate)) && hrRead.body?.length === 0, `HTTP ${hrCreate.status} "${emsg(hrCreate)}"; read ${hrRead.body?.length}`);
}

// ==================================================================== 3. DOCUMENTS
async function wfDocuments() {
  const WF = "documents";
  const emp3 = await empId("demo.engineer3@example.com");
  const title = `WF2 HR letter ${RUN}`;
  const pdf = path.join(WORK, `hr-letter-${RUN}.pdf`); writeFileSync(pdf, syntheticPdf(`Synthetic HR letter ${RUN}`));
  const txtFile = path.join(WORK, "notes.txt"); writeFileSync(txtFile, "synthetic text file - not an allowed type");
  const big = path.join(WORK, "oversize.pdf"); writeFileSync(big, Buffer.concat([syntheticPdf("oversize"), Buffer.alloc(11 * 1024 * 1024, 32)]));
  const docsBefore = (await q1(`select count(*)::int n from hr_documents where employee_id = ${lit(emp3)}`)).n;

  let s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/documents", 5000);
  await waitFor(s, "btn('Upload document') && !btn('Upload document').disabled", 10000);
  await h(s, "click('Upload document')"); await waitDialog(s); await sleep(800);
  await waitFor(s, "Boolean(document.querySelector('[role=dialog] input[type=file]'))", 6000);
  await h(s, "pickText('Employee', 'Demo Engineer 03')"); await h(s, "pickVal('Category', 'hr_letter')"); await h(s, `fill('Title', ${J(title)})`);
  await s.setFile("[role=dialog] input[type=file]", txtFile); await sleep(400);
  await h(s, "click('Upload', true)"); await sleep(800);
  const e1 = await h(s, "dialogText()");
  await s.setFile("[role=dialog] input[type=file]", big); await sleep(400);
  await h(s, "click('Upload', true)"); await sleep(800);
  const e2 = await h(s, "dialogText()");
  check(WF, "error", "Wrong file type (.txt) rejected with a message", /Only PDF, PNG, JPEG, WEBP, DOC, DOCX and XLSX files are allowed/.test(e1));
  check(WF, "error", "Oversize file (11 MB) rejected with a message", /the limit is 10 MB/.test(e2), (e2.match(/The file is[^\n]*/) || [""])[0]);
  check(WF, "error", "Nothing written for rejected files", (await q1(`select count(*)::int n from hr_documents where employee_id = ${lit(emp3)}`)).n === docsBefore);
  await s.setFile("[role=dialog] input[type=file]", pdf); await sleep(400);
  await h(s, "click('Upload', true)");
  const tu = await toastText(s, 10000); await waitNoDialog(s); await sleep(1500);
  const doc = await q1(`select d.*, v.id vid, v.storage_path, v.mime_type, v.size_bytes, v.file_name from hr_documents d join hr_document_versions v on v.document_id = d.id where d.title = ${lit(title)}`);
  const obj = doc && await q1(`select name, owner::text, metadata from storage.objects where bucket_id = 'hr-documents' and name = ${lit(doc.storage_path)}`);
  const onDisk = doc && existsSync(path.join(STATE.storageDir, "hr-documents", ...doc.storage_path.split("/")));
  check(WF, "ui", "HR uploads a PDF for employee@ through the file chooser (toast)", /Document uploaded/.test(tu), tu);
  check(WF, "db", "hr_documents + hr_document_versions + storage.objects rows (and bytes stored)", doc && doc.verification_status === "pending" && doc.mime_type === "application/pdf" && doc.size_bytes === readFileSync(pdf).length && obj && obj.owner === await userId("hr.admin@example.com") && onDisk,
    doc ? `doc ${doc.id} v${doc.current_version} ${doc.file_name} ${doc.size_bytes}B path=${doc.storage_path}; object owner=hr.admin; on disk=${onDisk}` : "no document");
  await s.shot("documents-hr-uploaded");
  // server-side validation (bypassing the browser)
  const badMime = await rpc("hr.admin@example.com", "hr_register_document_upload", { p_employee: emp3, p_category: "hr_letter", p_title: "bad", p_file_name: "x.exe", p_mime_type: "application/x-msdownload", p_size_bytes: 100 });
  const badSize = await rpc("hr.admin@example.com", "hr_register_document_upload", { p_employee: emp3, p_category: "hr_letter", p_title: "bad", p_file_name: "x.pdf", p_mime_type: "application/pdf", p_size_bytes: 11 * 1024 * 1024 });
  check(WF, "error", "Server also refuses a disallowed MIME type and an oversize registration", refused(badMime) && refused(badSize), `mime: "${emsg(badMime)}"; size: "${emsg(badSize)}"`);
  await s.close();

  // employee sees + views + downloads
  s = await session();
  await login(s, "employee@example.com");
  await s.go("/employee/documents", 5000);
  check(WF, "ui", "Employee sees the HR-uploaded document in My Documents", (await h(s, "main()")).includes(title));
  const logBefore = (await q1(`select count(*)::int n from hr_document_access_log where document_id = ${lit(doc.id)}`)).n;
  await h(s, `clickAria(${J(`View ${title}`)})`); await sleep(3000);
  await h(s, `clickAria(${J(`Download ${title}`)})`); await sleep(3000);
  const opened = (await s.js("window.__opened")) ?? [];
  const fetched = [];
  for (const u of opened) { const r = await api("GET", u, { headers: {} }); fetched.push({ status: r.status, pdf: r.raw.subarray(0, 5).toString() === "%PDF-", len: r.raw.length }); }
  const logs = await q(`select action, accessed_by::text from hr_document_access_log where document_id = ${lit(doc.id)} order by accessed_at`);
  check(WF, "ui", "View + Download produce signed URLs that return the PDF bytes", opened.length === 2 && fetched.every((f) => f.status === 200 && f.pdf && f.len === readFileSync(pdf).length) && /[?&]token=/.test(opened[0]),
    `${opened.length} URLs; ${J(fetched)}`);
  const empUser = await userId("employee@example.com");
  check(WF, "db", "Access log rows written (view + download by employee@)", logs.length === logBefore + 2 && logs.slice(-2).map((l) => l.action).join(",") === "view,download" && logs.slice(-2).every((l) => l.accessed_by === empUser), logs.map((l) => l.action).join(","));
  await s.close();

  // employee2 isolation
  s = await session();
  await login(s, "employee2@example.com");
  await s.go("/employee/documents", 5000);
  check(WF, "permission", "employee2 does not see employee@'s document", !(await h(s, "main()")).includes(title));
  await s.close();
  const signOwn = await api("POST", `/storage/v1/object/sign/hr-documents/${doc.storage_path}`, { token: await tok("employee@example.com"), body: { expiresIn: 60 } });
  check(WF, "permission", "Control: employee@ (owner) can get a signed URL via the same API call", signOwn.status === 200 && Boolean(signOwn.body?.signedURL), `HTTP ${signOwn.status}`);
  const sign = await api("POST", `/storage/v1/object/sign/hr-documents/${doc.storage_path}`, { token: await tok("employee2@example.com"), body: { expiresIn: 60 } });
  const dsel = await sel("employee2@example.com", `hr_documents?select=id&id=eq.${doc.id}`);
  const dl = await api("GET", `/storage/v1/object/authenticated/hr-documents/${doc.storage_path}`, { token: await tok("employee2@example.com") });
  check(WF, "permission", "employee2 cannot get a signed URL / download / select the document (API)", refused(sign) && !sign.body?.signedURL && dsel.body?.length === 0 && refused(dl),
    `sign HTTP ${sign.status} "${emsg(sign)}"; select ${dsel.body?.length}; download HTTP ${dl.status}`);
  const up2 = await api("POST", `/storage/v1/object/hr-documents/${doc.storage_path.replace(/[^/]+$/, `intruder-${RUN}.pdf`)}`, { token: await tok("employee2@example.com"), body: readFileSync(pdf), headers: { "content-type": "application/pdf" } });
  check(WF, "permission", "employee2 cannot upload into employee@'s document folder (storage RLS)", refused(up2), `HTTP ${up2.status} "${emsg(up2)}"`);

  // HR verifies
  s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/documents", 5000);
  await s.js(`(() => { ${H}; __h.setVal(document.querySelector('input[aria-label="Search documents"]'), ${J(title)}); })()`); await sleep(2500);
  const mg = await h(s, `rowClick(${J(title)}, 'Manage')`); await waitDialog(s); await sleep(500);
  await h(s, "click('Verify', true)"); await sleep(800); await h(s, "confirm()");
  const tv = await toastText(s); await sleep(1500);
  const ver = await q1(`select verification_status, verified_by::text, verified_at from hr_documents where id = ${lit(doc.id)}`);
  const vn = await q1(`select title from hr_notifications where recipient_user_id = ${lit(await userId("employee@example.com"))} and entity_id = ${lit(doc.id)} order by created_at desc limit 1`);
  check(WF, "ui", "HR verifies the document (Manage → Verify → confirm)", mg === true && /verified/i.test(tv), tv);
  check(WF, "db", "verification_status=verified by hr.admin; employee notified", ver.verification_status === "verified" && ver.verified_by === await userId("hr.admin@example.com"), `${ver.verification_status}; notification=${vn?.title ?? "none"}`);
  await s.close();
  const empVerify = await rpc("employee@example.com", "hr_verify_document", { p_document: doc.id, p_approve: false, p_reason: "attempt" });
  check(WF, "permission", "Employee cannot verify/reject documents (API)", refused(empVerify), `HTTP ${empVerify.status} "${emsg(empVerify)}"`);
  s = await session();
  await login(s, "employee@example.com");
  await s.go("/employee/documents", 5000);
  await s.reload(5000);
  check(WF, "refresh", "Employee page after reload shows the document as verified", /verified/.test(await h(s, `rowText(${J(title)})`) ?? ""), await h(s, `rowText(${J(title)})`));
  await s.shot("documents-employee-verified");
  await s.close();
}

// ==================================================================== 4. RECRUITMENT
async function wfRecruitment() {
  const WF = "recruitment";
  const name = `Demo Candidate WF2 ${RUN}`;
  const email = `candidate.wf2.${RUN}@example.com`;
  const opening = await q1("select id, title from hr_job_openings where status = 'open' order by created_at limit 1");
  let s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/recruitment/pipeline", 5000);
  await h(s, "click('Add candidate')"); await waitDialog(s); await sleep(500);
  await h(s, `pickText('Opening', ${J(opening.title)})`); await h(s, `fill('Full name', ${J(name)})`); await h(s, `fill('Email', ${J(email)})`);
  await h(s, "click('Add to pipeline', true)"); await sleep(4000);
  const app = await q1(`select a.* from hr_candidate_applications a join hr_candidates c on c.id = a.candidate_id where c.email = ${lit(email)}`);
  check(WF, "ui", "Add candidate from the pipeline opens the application", app && (await s.js("location.pathname")) === `/hr/recruitment/applications/${app.id}`, await s.js("location.pathname"));
  check(WF, "db", "Application created at stage applied", app?.stage === "applied");
  const move = async (to) => {
    await h(s, "click('Move stage')"); await waitDialog(s);
    const opts = await h(s, "options('New stage')");
    await h(s, `pickVal('New stage', ${J(to)})`); await h(s, `click(${J("Move to ")}, true)`);
    await sleep(2500);
    return opts;
  };
  const optsApplied = await move("screening"); await waitNoDialog(s);
  check(WF, "error", "Illegal jump not offered in the UI (applied → only screening/rejected/withdrawn)", J(optsApplied) === J(["screening", "rejected", "withdrawn"]), J(optsApplied));
  const illegal = await rpc("hr.admin@example.com", "hr_move_candidate_stage", { p_application: app.id, p_to_stage: "selected", p_note: null });
  check(WF, "error", "Illegal jump screening→selected via API refused with a message; stage unchanged", refused(illegal) && /cannot move from screening to selected/i.test(emsg(illegal)) && (await q1(`select stage from hr_candidate_applications where id = ${lit(app.id)}`)).stage === "screening", `HTTP ${illegal.status} "${emsg(illegal)}"`);
  await move("shortlisted"); await waitNoDialog(s);
  // schedule interview with a panel member
  await h(s, "click('Schedule')"); await waitDialog(s); await sleep(1500);
  const when = new Date(Date.now() + 2 * 86400000); const pad = (n) => String(n).padStart(2, "0");
  const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T11:00`;
  await h(s, `fill('Date and time', ${J(local)})`); await h(s, "fill('Meeting link', 'https://meet.example.com/wf2')");
  await h(s, "tick('Demo Eng Lead')");
  await h(s, "click('Schedule', true)");
  const tsch = await toastText(s); await waitNoDialog(s); await sleep(1500);
  const iv = await q1(`select i.id, i.status, (select array_agg(e.company_email) from hr_interview_panel p join hr_employees e on e.id = p.employee_id where p.interview_id = i.id) panel from hr_interviews i where application_id = ${lit(app.id)}`);
  const ivn = iv && await q1(`select 1 x from hr_notifications where entity_id = ${lit(iv.id)} and recipient_user_id = ${lit(await userId("manager@example.com"))}`);
  check(WF, "ui", "Schedule interview with a panel member (toast)", /Interview scheduled/.test(tsch), tsch);
  check(WF, "db", "Interview + panel row (manager), panel notified, stage → interview", iv && iv.panel?.includes("demo.englead@example.com") && ivn && (await q1(`select stage from hr_candidate_applications where id = ${lit(app.id)}`)).stage === "interview", J(iv));
  await move("selected"); await waitNoDialog(s);
  // try offered without a sent offer (UI shows the choice, server refuses)
  await h(s, "click('Move stage')"); await waitDialog(s); await h(s, "pickVal('New stage', 'offered')"); await h(s, "click('Move to ', true)"); await sleep(2500);
  const offErr = (await h(s, "alerts()")).join(" | ");
  check(WF, "error", "Moving to Offered without a sent offer refused with message (stage stays selected)", /Send an offer before moving/i.test(offErr) && (await q1(`select stage from hr_candidate_applications where id = ${lit(app.id)}`)).stage === "selected", offErr);
  await s.shot("recruitment-offer-required-error");
  await h(s, "cancel()"); await sleep(500);
  // offer
  await h(s, "click('Create offer')"); await waitDialog(s); await sleep(800);
  const join = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await h(s, `fill('Proposed joining date', ${J(join)})`); await h(s, "fill('Annual CTC', '600000')");
  await h(s, "click('Create draft', true)"); await toastText(s); await waitNoDialog(s); await sleep(1200);
  await h(s, "click('Mark as sent')"); await waitDialog(s); await h(s, "confirm()"); await toastText(s); await waitNoDialog(s); await sleep(1500);
  await h(s, "click('Record response')"); await waitDialog(s); await h(s, "pickVal('Response', 'accepted')"); await h(s, "click('Save response', true)"); await toastText(s); await waitNoDialog(s); await sleep(1500);
  const offer = await q1(`select status, sent_at, responded_at, annual_ctc from hr_offers where application_id = ${lit(app.id)}`);
  check(WF, "db", "Offer created → sent (stage offered) → accepted", offer?.status === "accepted" && offer.sent_at && (await q1(`select stage from hr_candidate_applications where id = ${lit(app.id)}`)).stage === "offered", J(offer));
  // convert
  const cemail = `demo.hire.${RUN}@example.com`;
  await h(s, "click('Convert to employee')"); await waitDialog(s); await sleep(800);
  await h(s, `fill('Company email', ${J(cemail)})`); await h(s, "click('Review conversion', true)"); await sleep(800); await h(s, "confirm()");
  const tconv = await toastText(s); await sleep(2500);
  const emp = await q1(`select id, employee_code, status, source, source_ref::text, first_name, last_name from hr_employees where company_email = ${lit(cemail)}`);
  const ev = await q(`select from_stage, to_stage from hr_candidate_stage_events where application_id = ${lit(app.id)} order by changed_at, id`);
  check(WF, "ui", "Convert to employee (review + confirm) → toast", /Employee record created/.test(tconv), tconv);
  check(WF, "db", "New employee source=candidate linked to the application; stage joined; full stage event trail", emp && emp.source === "candidate" && emp.source_ref === app.id && emp.status === "onboarding"
    && (await q1(`select stage from hr_candidate_applications where id = ${lit(app.id)}`)).stage === "joined",
    `${emp?.employee_code} ${emp?.first_name} ${emp?.last_name} (${emp?.status}); events: ${ev.map((e) => `${e.from_stage ?? "∅"}→${e.to_stage}`).join(", ")}`);
  await s.reload(5000);
  const page = await h(s, "main()");
  check(WF, "refresh", "After reload: application shows Joined + 'Converted to employee' with the employee code", /Converted to employee/.test(page) && page.includes(emp?.employee_code ?? "??") && /Joined/i.test(page));
  await s.shot("recruitment-converted");
  await s.close();
  // permissions
  s = await session();
  await login(s, "employee@example.com");
  await s.go("/hr/recruitment/pipeline", 3500);
  check(WF, "permission", "Employee UI: recruitment blocked", /Not authorised/.test(await h(s, "text()")));
  await s.close();
  const em = await rpc("employee@example.com", "hr_move_candidate_stage", { p_application: app.id, p_to_stage: "rejected", p_note: "x" });
  const es = await sel("employee@example.com", `hr_candidate_applications?select=id&id=eq.${app.id}`);
  check(WF, "permission", "Employee API: cannot move candidates or read applications", refused(em) && /not allowed/i.test(emsg(em)) && es.body?.length === 0, `HTTP ${em.status} "${emsg(em)}"; select ${es.body?.length}`);
}

// ==================================================================== 5. ASSETS
async function wfAssets() {
  const WF = "assets";
  const emp3 = await empId("demo.engineer3@example.com");
  const emp2 = await empId("demo.designer@example.com");
  const asset = await q1("select id, asset_tag from hr_assets where status = 'available' and not is_bulk and asset_tag like 'DEMO-LT-%' order by asset_tag limit 1");
  console.log(`  [assets] asset ${asset.asset_tag}`);
  let s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/assets?tab=inventory", 5000);
  await s.js(`(() => { ${H}; __h.setVal(document.querySelector('input[aria-label="Search assets"]'), ${J(asset.asset_tag)}); })()`); await sleep(2500);
  await h(s, `rowClick(${J(asset.asset_tag)})`); await waitDialog(s); await waitFor(s, "btn('Assign', true) != null", 12000);
  await h(s, "click('Assign', true)"); await waitFor(s, "dialogOpen() > 1", 8000); await sleep(500);
  await h(s, "click('Assign', true)"); await sleep(600);
  const noEmp = await h(s, "dialogText()");
  check(WF, "error", "Assign without choosing an employee shows a message", /Choose an employee/.test(noEmp));
  await h(s, "pickText('Employee', 'Demo Engineer 03')"); await h(s, "fill('Assignment notes', 'Synthetic assignment (browser-flows-2)')");
  await h(s, "click('Assign', true)");
  const ta = await toastText(s); await sleep(2500);
  const asg = await q1(`select * from hr_asset_assignments where asset_id = ${lit(asset.id)} and status = 'active'`);
  check(WF, "ui", "HR assigns the asset to employee@ from the asset detail", /assigned/.test(ta), ta);
  check(WF, "db", "Assignment active for employee@; asset status assigned; employee notified", asg?.employee_id === emp3 && (await q1(`select status from hr_assets where id = ${lit(asset.id)}`)).status === "assigned"
    && await q1(`select 1 x from hr_notifications where entity_id = ${lit(asg?.id)} and type = 'asset_assigned'`), `assignment ${asg?.id}`);
  check(WF, "error", "UI no longer offers 'Assign' for this individually-tracked asset", !(await h(s, "dialogText()")).match(/\bAssign\b(?!ment)/) || (await s.js(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); return ![...d.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Assign'); })()`)));
  const again = await rpc("hr.admin@example.com", "hr_assign_asset", { p_asset: asset.id, p_employee: emp2, p_expected_return: null, p_notes: "double assign" });
  const nAct = (await q1(`select count(*)::int n from hr_asset_assignments where asset_id = ${lit(asset.id)} and status = 'active'`)).n;
  check(WF, "error", "Assigning the same (non-bulk) asset to employee2 refused with a message", refused(again) && /already assigned/i.test(emsg(again)) && nAct === 1, `HTTP ${again.status} "${emsg(again)}"; active=${nAct}`);
  await s.shot("assets-assigned");
  await s.close();

  s = await session();
  await login(s, "employee@example.com");
  await s.go("/employee/assets", 4500);
  check(WF, "ui", "Employee sees the asset in My Assets", (await h(s, "main()")).includes(asset.asset_tag));
  const clicked = await s.js(`(() => { const card = [...document.querySelectorAll('main li, main tr, main article, main section')].filter((c) => c.innerText.includes(${J(asset.asset_tag)})).pop();
    const b = card && [...card.querySelectorAll('button')].find((x) => x.textContent.includes('Acknowledge handover')); if (!b) return false; b.click(); return true; })()`);
  await waitDialog(s); await h(s, "tick('I confirm I have received')"); await h(s, "confirm()"); const tack = await toastText(s); await sleep(1500);
  const ack = await q1(`select acknowledged_at from hr_asset_assignments where id = ${lit(asg.id)}`);
  check(WF, "ui", "Employee acknowledges receipt", clicked && Boolean(tack), tack);
  check(WF, "db", "acknowledged_at set", Boolean(ack.acknowledged_at), ack.acknowledged_at);
  await s.reload(4500);
  const ackGone = await s.js(`(() => { const card = [...document.querySelectorAll('main li, main tr, main article, main section')].filter((c) => c.innerText.includes(${J(asset.asset_tag)})).pop(); return card && !card.innerText.includes('Acknowledge handover'); })()`);
  check(WF, "refresh", "After reload: acknowledged state persists (no Acknowledge button)", ackGone);
  await s.shot("assets-employee-acknowledged");
  await s.close();
  const ackOther = await rpc("employee2@example.com", "hr_acknowledge_asset", { p_assignment: asg.id });
  const e2sel = await sel("employee2@example.com", `hr_asset_assignments?select=id&id=eq.${asg.id}`);
  check(WF, "permission", "employee2 cannot see or acknowledge employee@'s assignment", e2sel.body?.length === 0 && refused(ackOther), `select ${e2sel.body?.length}; ack HTTP ${ackOther.status} "${emsg(ackOther)}"`);
  const empRet = await rpc("employee@example.com", "hr_return_asset", { p_assignment: asg.id, p_condition: "good", p_notes: null });
  check(WF, "permission", "Employee cannot record returns (assets.manage required)", refused(empRet), `HTTP ${empRet.status} "${emsg(empRet)}"`);
  s = await session();
  await login(s, "employee2@example.com");
  await s.go("/employee/assets", 4500);
  check(WF, "permission", "employee2 My Assets does not list employee@'s asset", !(await h(s, "main()")).includes(asset.asset_tag));
  await s.close();

  s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/assets", 5000);
  await h(s, "tab('Assignments')"); await sleep(3000);
  await h(s, `rowClick(${J(asset.asset_tag)}, 'Quick return')`); await waitDialog(s);
  await h(s, "click('Receive and inspect', true)"); await sleep(600);
  check(WF, "error", "Return without a condition shows a message", /Record the condition/.test(await h(s, "dialogText()")));
  await h(s, "pickVal('Condition found on inspection', 'good')"); await h(s, "fill('Inspection notes', 'Returned in good shape (synthetic)')");
  await h(s, "click('Receive and inspect', true)"); const tr = await toastText(s); await sleep(2000);
  const ret = await q1(`select status, return_condition, returned_at from hr_asset_assignments where id = ${lit(asg.id)}`);
  const ast = await q1(`select status, condition from hr_assets where id = ${lit(asset.id)}`);
  check(WF, "ui", "HR records the return with condition", /Return received/.test(tr), tr);
  check(WF, "db", "Assignment returned (condition good), asset available again", ret.status === "returned" && ret.return_condition === "good" && ast.status === "available", `${J(ret)} asset ${J(ast)}`);
  await s.reload(5000);
  await h(s, "tab('Assignments')"); await sleep(2000);
  await s.js(`(() => { ${H}; __h.setVal(document.querySelector('select[aria-label="Assignment status"]'), 'returned'); })()`); await sleep(2500);
  check(WF, "refresh", "After reload: assignment listed under Returned with condition", /good/.test(await h(s, `rowText(${J(asset.asset_tag)})`) ?? ""), await h(s, `rowText(${J(asset.asset_tag)})`));
  await s.shot("assets-returned");
  await s.close();
}

// ==================================================================== 6. ANNOUNCEMENTS
async function wfAnnouncements() {
  const WF = "announcements";
  const title = `WF2 Engineering notice ${RUN}`;
  const eng = await q1("select id from hr_departments where code = 'ENG'");
  let s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/announcements", 5000);
  await h(s, "click('New announcement')"); await waitDialog(s); await sleep(800);
  await h(s, "pickVal('Audience', 'departments')"); await sleep(500);
  await h(s, "click('Save draft', true)"); await sleep(700);
  const verr = await h(s, "dialogText()");
  check(WF, "error", "Empty title / no department selected rejected with messages", /Enter a title of 2–200 characters/.test(verr) && /Choose at least one recipient group/.test(verr));
  await h(s, `fill('Title', ${J(title)})`); await h(s, "fill('Message', 'Synthetic announcement for the Engineering department (browser-flows-2). Please acknowledge.')");
  await h(s, "pickVal('Category', 'policy')");
  await h(s, "tick('Engineering')"); await h(s, "tick('Employees must acknowledge')");
  await h(s, "click('Save draft', true)"); await sleep(3000);
  const a = await q1(`select * from hr_announcements where title = ${lit(title)}`);
  check(WF, "db", "Draft saved (status draft, audience departments=[ENG], ack required)", a?.status === "draft" && a.audience_type === "departments" && a.audience_ids?.includes(eng.id) && a.requires_acknowledgement, a?.status);
  await h(s, "click('Publish', true)"); await sleep(800); await h(s, "confirm()");
  const tp = await toastText(s, 8000); await sleep(2000);
  const pub = await q1(`select status, published_at, notified_count from hr_announcements where id = ${lit(a.id)}`);
  const notes = await q(`select u.email from hr_notifications n join auth.users u on u.id = n.recipient_user_id where n.entity_type = 'hr_announcements' and n.entity_id = ${lit(a.id)}`);
  const expectedRecipients = await q(`select u.email from hr_employees e join auth.users u on u.id = e.user_id where e.department_id = ${lit(eng.id)} and e.portal_access and e.status not in ('exited','archived','suspended')`);
  check(WF, "ui", "Publish now → toast with notification count", /Published: \d+ portal notification/.test(tp), tp);
  check(WF, "db", "Status published; notifications only for ENG employees with portal access", pub.status === "published" && pub.published_at && notes.length === pub.notified_count && notes.length === expectedRecipients.length
    && notes.some((n) => n.email === "employee@example.com") && !notes.some((n) => n.email === "employee2@example.com"), `notified=${pub.notified_count}: ${notes.map((n) => n.email).join(", ")}`);
  await s.shot("announcements-published");
  // published cannot be edited
  check(WF, "error", "Published announcement detail offers no Edit button", !(await s.js(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); return d ? [...d.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Edit') : true; })()`)));
  const edit = await api("PATCH", `/rest/v1/hr_announcements?id=eq.${a.id}`, { token: await tok("hr.admin@example.com"), body: { title: "Edited after publish" }, headers: { Prefer: "return=representation" } });
  check(WF, "error", "Editing a published announcement via API refused with message; title unchanged", refused(edit) && /cannot be edited/i.test(emsg(edit)) && (await q1(`select title from hr_announcements where id = ${lit(a.id)}`)).title === title, `HTTP ${edit.status} "${emsg(edit)}"`);
  await s.close();

  s = await session();
  await login(s, "employee@example.com");
  await s.go("/employee/announcements", 5000);
  const listed = (await h(s, "main()")).includes(title);
  await s.js(`(() => { const b = [...document.querySelectorAll('main ul li button')].find((x) => x.innerText.includes(${J(title)})); b && b.click(); })()`);
  await waitDialog(s); await sleep(2000);
  const readRow = await q1(`select read_at, acknowledged_at from hr_announcement_receipts where announcement_id = ${lit(a.id)} and employee_id = ${lit(await empId("demo.engineer3@example.com"))}`);
  await h(s, "click('I have read and acknowledge this', true)"); const tk = await toastText(s); await sleep(1500);
  const ackRow = await q1(`select read_at, acknowledged_at from hr_announcement_receipts where announcement_id = ${lit(a.id)} and employee_id = ${lit(await empId("demo.engineer3@example.com"))}`);
  check(WF, "ui", "Employee sees it, opens it and acknowledges", listed && /acknowledged/i.test(tk), tk);
  check(WF, "db", "Receipt row: read_at on open, acknowledged_at on acknowledge", readRow?.read_at && ackRow?.acknowledged_at, J(ackRow));
  await s.shot("announcements-employee-ack");
  await s.reload(5000);
  const card = await s.js(`(() => { const b = [...document.querySelectorAll('main ul li button')].find((x) => x.innerText.includes(${J(title)})); return b ? b.innerText : null; })()`);
  check(WF, "refresh", "After reload: card shows 'acknowledged' and is no longer 'New'", card && /acknowledged/.test(card) && !/^New/.test(card), card?.replace(/\s+/g, " "));
  await s.go("/hr/announcements", 3000);
  check(WF, "permission", "Employee UI: HR announcements management blocked", /Not authorised/.test(await h(s, "text()")));
  await s.close();
  const ins = await api("POST", "/rest/v1/hr_announcements", { token: await tok("employee@example.com"), body: { title: `Employee attempt ${RUN}`, body: "x", audience_type: "all" } });
  const pubTry = await rpc("employee@example.com", "hr_publish_announcement", { p_announcement: a.id });
  check(WF, "permission", "Employee API: insert refused (RLS) and publish RPC refused", refused(ins) && refused(pubTry) && /not allowed/i.test(emsg(pubTry)) && !(await q1(`select 1 x from hr_announcements where title = ${lit(`Employee attempt ${RUN}`)}`)), `insert HTTP ${ins.status} "${emsg(ins)}"; publish "${emsg(pubTry)}"`);
  const e2 = await sel("employee2@example.com", `hr_announcements?select=id&id=eq.${a.id}`);
  const e2ack = await rpc("employee2@example.com", "hr_acknowledge_announcement", { p_announcement: a.id });
  s = await session();
  await login(s, "employee2@example.com");
  await s.go("/employee/announcements", 5000);
  check(WF, "permission", "employee2 (Design dept) does not see the Engineering announcement (UI + API)", !(await h(s, "main()")).includes(title) && e2.body?.length === 0 && refused(e2ack), `select ${e2.body?.length}; ack "${emsg(e2ack)}"`);
  await s.close();
}

// ==================================================================== 7. EXIT CLEARANCE
async function wfExit() {
  const WF = "exit";
  // Apply the extra synthetic fixtures (per-run leaver + asset) as the cluster owner.
  const ap = await new Promise((resolve) => {
    const child = spawn(findPgBin()("psql"), ["-h", "127.0.0.1", "-p", String(STATE.pgPort), "-U", "hrms_local", "-d", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-v", `run=${RUN}`, "-f", path.join(ROOT, "supabase", "tests", "hrms-local", "extra_fixtures.sql")], { windowsHide: true });
    let err = ""; child.stderr.on("data", (d) => (err += d)); child.on("close", (code) => resolve({ ok: code === 0, err }));
  });
  if (!ap.ok) { check(WF, "db", "extra_fixtures.sql applied", false, ap.err); return; }
  const leaver = `leaver.${RUN}@example.com`;
  const lemp = await q1(`select id, employee_code, user_id::text from hr_employees where company_email = ${lit(leaver)}`);
  const assetTag = `WF2-LVR-${RUN}`;
  const today = await TODAY();
  const pre = await signIn(leaver);
  check(WF, "db", `Leaver fixture ready (${lemp.employee_code}, linked account can sign in, asset ${assetTag} assigned)`, pre.status === 200 && lemp.user_id, `sign-in HTTP ${pre.status}`);

  let s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/exits", 4500);
  await h(s, "click('Initiate exit')"); await waitDialog(s); await sleep(1500);
  await h(s, `pickText('Employee', ${J(lemp.employee_code)})`); await h(s, "pickVal('Exit type', 'resignation')");
  await h(s, `fill('Last working day', ${J(today)})`); await h(s, "fill('Reason', 'Synthetic: relocating (browser-flows-2)')");
  await h(s, "click('Initiate exit', true)"); await sleep(4000);
  const x = await q1(`select * from hr_exits where employee_id = ${lit(lemp.id)} order by created_at desc limit 1`);
  check(WF, "ui", "HR initiates the exit (navigates to the case)", x && (await s.js("location.pathname")) === `/hr/exits/${x.id}`, await s.js("location.pathname"));
  await h(s, "click('Start clearance')"); await waitDialog(s); await h(s, "confirm()"); await toastText(s); await waitNoDialog(s); await sleep(2000);
  const items0 = await q(`select item_key, status from hr_exit_clearance_items where exit_id = ${lit(x.id)} order by sort_order`);
  check(WF, "db", "Clearance started: status clearance, 8 checklist items", (await q1(`select status from hr_exits where id = ${lit(x.id)}`)).status === "clearance" && items0.length === 8, items0.map((i) => `${i.item_key}:${i.status}`).join(" "));
  check(WF, "ui", "Asset-return item warns that an asset is still assigned", (await h(s, "liText('Asset return')"))?.includes(assetTag), await h(s, "liText('Asset return')"));
  await h(s, "liClick('Asset return', 'Complete')"); await waitDialog(s); await h(s, "confirm()"); await sleep(2500);
  const aErr = (await h(s, "alerts()")).join(" | ");
  check(WF, "error", "Completing asset return while an asset is open is refused with a message", /Assets are still assigned/.test(aErr) && (await q1(`select status from hr_exit_clearance_items where exit_id = ${lit(x.id)} and item_key = 'asset_return'`)).status === "pending", aErr);
  await s.shot("exit-asset-return-blocked");
  await h(s, "cancel()"); await sleep(500);
  check(WF, "ui", "'Move to final settlement' disabled while items are pending", (await h(s, "disabled('Move to final settlement')")) === true);
  // return the asset through the Assets page
  await s.go("/hr/assets", 4500); await h(s, "tab('Assignments')"); await sleep(3000);
  await h(s, `rowClick(${J(assetTag)}, 'Return')`); await waitDialog(s);
  await h(s, "pickVal('Condition on return', 'good')"); await h(s, "click('Record return', true)"); await toastText(s); await sleep(1500);
  await s.go(`/hr/exits/${x.id}`, 5000);
  const done = async (label) => { const c = await h(s, `liClick(${J(label)}, 'Complete')`); await waitDialog(s); await h(s, "confirm()"); const t = await toastText(s); await waitNoDialog(s); await sleep(1500); return `${c}/${t}`; };
  const ar = await done("Asset return");
  check(WF, "ui", "Asset return completes after the asset was returned", /completed/.test(ar), ar);
  // access revocation via the Edge Function stand-in
  check(WF, "ui", "Access item: Complete is disabled until access is revoked", (await h(s, "liClick('Sign-in access revocation', 'Complete')")) === "disabled");
  await h(s, "liClick('Sign-in access revocation', 'Revoke sign-in access')"); await waitDialog(s); await h(s, "confirm()");
  const trv = await toastText(s, 8000); await waitNoDialog(s); await sleep(2000);
  const ban = await q1(`select banned_until::text from auth.users where id = ${lit(lemp.user_id)}`);
  const xr = await q1(`select auth_access_revoked_at from hr_exits where id = ${lit(x.id)}`);
  check(WF, "ui", "'Revoke sign-in access' (hr-revoke-exit-access stand-in) succeeds", /Sign-in access revoked/.test(trv), trv);
  check(WF, "db", "auth.users.banned_until set and exit.auth_access_revoked_at recorded", ban.banned_until && new Date(ban.banned_until) > new Date() && xr.auth_access_revoked_at, `banned_until=${ban.banned_until}`);
  const post = await signIn(leaver);
  check(WF, "permission", "Leaver can no longer sign in after revocation (API)", post.status >= 400 && !post.body?.access_token, `HTTP ${post.status} ${emsg(post)}`);
  const results = [];
  for (const l of ["Sign-in access revocation", "Document handover", "Project handover", "HR clearance", "Payroll clearance"]) results.push(`${l}: ${await done(l)}`);
  check(WF, "ui", "Remaining clearance items completed from the checklist", results.every((t) => /completed/.test(t)), results.join("; "));
  await h(s, "click('Move to final settlement')"); await waitDialog(s); await h(s, "confirm()"); await toastText(s); await waitNoDialog(s); await sleep(2000);
  check(WF, "db", "Exit moved to final_settlement", (await q1(`select status from hr_exits where id = ${lit(x.id)}`)).status === "final_settlement");
  for (const l of ["Record relieving letter issued", "Record experience letter issued"]) { await h(s, `click(${J(l)})`); await waitDialog(s); await h(s, "confirm()"); await toastText(s); await waitNoDialog(s); await sleep(1500); }
  const lt = await q1(`select relieving_letter_issued_at, experience_letter_issued_at from hr_exits where id = ${lit(x.id)}`);
  check(WF, "db", "Relieving + experience letters recorded", lt.relieving_letter_issued_at && lt.experience_letter_issued_at);
  // close with pending settlement items -> refused
  await h(s, "click('Close exit')"); await waitDialog(s); await h(s, "confirm()"); await sleep(2500);
  const cErr = (await h(s, "alerts()")).join(" | ");
  check(WF, "error", "Closing with pending clearance (final settlement, relieving letter) refused with message; nothing changed", /Complete these clearance items first: final settlement, relieving letter/.test(cErr)
    && (await q1(`select status from hr_exits where id = ${lit(x.id)}`)).status === "final_settlement" && (await q1(`select status from hr_employees where id = ${lit(lemp.id)}`)).status === "notice_period", cErr);
  await s.shot("exit-close-blocked");
  await h(s, "cancel()"); await sleep(500);
  for (const l of ["Final settlement", "Relieving letter"]) await done(l);
  await h(s, "click('Close exit')"); await waitDialog(s); await h(s, "fill('Settlement notes', 'Synthetic settlement complete (browser-flows-2)')"); await h(s, "confirm()");
  const tclose = await toastText(s, 8000); await waitNoDialog(s); await sleep(2000);
  const fx = await q1(`select status, closed_at, closed_by::text from hr_exits where id = ${lit(x.id)}`);
  const fe = await q1(`select status, portal_access, last_working_date::text, user_id::text from hr_employees where id = ${lit(lemp.id)}`);
  const roles = (await q1(`select count(*)::int n from hr_user_roles where user_id = ${lit(lemp.user_id)}`)).n;
  const hist = await q1(`select (select count(*)::int from hr_exit_events where exit_id = ${lit(x.id)}) events, (select count(*)::int from hr_exit_clearance_items where exit_id = ${lit(x.id)}) items,
    (select count(*)::int from hr_employee_history where employee_id = ${lit(lemp.id)} and change_type = 'role') role_hist, (select count(*)::int from hr_asset_assignments where employee_id = ${lit(lemp.id)}) assignments`);
  check(WF, "ui", "Close exit (confirm) → toast", /Exit closed/.test(tclose), tclose);
  check(WF, "db", "Employee exited, portal_access=false, roles removed, banned; history retained", fx.status === "closed" && fe.status === "exited" && fe.portal_access === false && fe.last_working_date === today && roles === 0 && hist.events >= 10 && hist.items === 8 && hist.role_hist >= 1 && hist.assignments === 1,
    `exit=${fx.status}; employee=${fe.status} portal_access=${fe.portal_access} lwd=${fe.last_working_date}; roles=${roles}; events=${hist.events} items=${hist.items} role-history=${hist.role_hist} asset-history=${hist.assignments}`);
  await s.reload(5000);
  const pg = await h(s, "main()");
  check(WF, "refresh", "After reload: case shows closed, letters issued, every clearance item done", /closed/i.test(pg) && /Issued/.test(pg) && !(await s.js("[...document.querySelectorAll('li')].some((l) => /Owner:.*pending/.test(l.innerText))")));
  await s.shot("exit-closed");
  await s.close();
  // leaver UI sign-in fails
  s = await session();
  const lp = await login(s, leaver);
  await waitFor(s, "Boolean(document.querySelector('form p.text-red-400'))", 6000);
  const lmsg = await s.js("document.querySelector('form p.text-red-400')?.textContent ?? null");
  await s.shot("exit-leaver-login-refused");
  check(WF, "permission", "Leaver sign-in through the login page fails (stays on /login with a message)", lp === "/login" && Boolean(lmsg), `${lp}: ${lmsg}`);
  await s.close();
  // employees cannot run exits
  const ei = await rpc("employee@example.com", "hr_initiate_exit", { p_employee: await empId("demo.designer@example.com"), p_exit_type: "termination", p_reason: "attempt", p_lwd: today });
  const ec = await rpc("employee@example.com", "hr_close_exit", { p_exit: x.id, p_settlement_notes: null });
  check(WF, "permission", "Employee API: initiate/close exit refused", refused(ei) && refused(ec) && /not allowed/i.test(emsg(ei)), `"${emsg(ei)}" / "${emsg(ec)}"`);
  s = await session();
  await login(s, "employee@example.com");
  await s.go("/hr/exits", 3000);
  check(WF, "permission", "Employee UI: /hr/exits blocked", /Not authorised/.test(await h(s, "text()")));
  await s.close();
}

// ------------------------------------------------------------------ main
const WORKFLOWS = { attendance: wfAttendance, payroll: wfPayroll, documents: wfDocuments, recruitment: wfRecruitment, assets: wfAssets, announcements: wfAnnouncements, exit: wfExit };
const started = new Date().toISOString();
try {
  for (const [k, fn] of Object.entries(WORKFLOWS)) {
    if (ONLY.length && !ONLY.includes(k)) continue;
    console.log(`\n=== ${k} ===`);
    try { await fn(); } catch (e) { check(k, "crash", `workflow ${k} threw`, false, e.stack?.split("\n").slice(0, 3).join(" | ")); }
  }
} finally {
  const summary = {};
  for (const c of checks) { const w = (summary[c.workflow] ??= {}); const a = (w[c.aspect] ??= { pass: 0, fail: 0 }); c.ok ? a.pass++ : a.fail++; }
  writeFileSync(OUT, JSON.stringify({ harness: { api: API, web: BASE, state: STATE_FILE }, run: RUN, started, finished: new Date().toISOString(), summary, checks,
    screenshots: shots, blockedRequests: { count: blocked.length, urls: blocked }, pageExceptions: pageErrors }, null, 2));
  try { rmSync(WORK, { recursive: true, force: true }); } catch {}
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed; external requests blocked: ${blocked.length}; page exceptions: ${pageErrors.length}; results: ${OUT}`);
  process.exitCode = failed ? 1 : 0;
}

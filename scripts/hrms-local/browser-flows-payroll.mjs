#!/usr/bin/env node
// TEST-ONLY Module 7 (Payroll & Salary) browser flows against the LOCAL harness.
//
//   node scripts/hrms-local/browser-flows-payroll.mjs [--state <harness state json>] [--out <results.json>]
//
// Drives the real UI as payroll.admin (preparer), payroll.approver (approver)
// and employee@ (self-service), verifies every result in the database, checks
// server-side refusals directly against the API, refresh persistence and the
// mobile layout. Only 127.0.0.1 is contacted (browser network guard blocks
// anything else). Synthetic data only. Screenshots: docs/hrms/local-test-screenshots/m7-*.jpg
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT, findPgBin, makePsql, resolveStateFile, outputDir } from "./lib.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STATE_FILE = resolveStateFile();
if (!existsSync(STATE_FILE)) { console.error(`No harness state at ${STATE_FILE}`); process.exit(2); }
const STATE = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const API = `http://127.0.0.1:${STATE.apiPort}`;
const BASE = `http://127.0.0.1:${STATE.webPort}`;
const ANON = STATE.anonKey;
const OUT = arg("--out", path.join(outputDir("hrms-flows-m7"), "results.json"));
const SHOTS = path.join(ROOT, "docs", "hrms", "local-test-screenshots");
const PASSWORD = "Local-Test-Only-2026!";
for (const u of [API, BASE]) { const x = new URL(u); if (!["127.0.0.1", "localhost"].includes(x.hostname) || x.port === "8080") { console.error(`Refusing ${u}`); process.exit(2); } }
mkdirSync(SHOTS, { recursive: true }); mkdirSync(path.dirname(OUT), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = []; const blocked = []; const pageErrors = []; const shots = [];
const check = (area, name, ok, detail = "") => { checks.push({ area, name, ok: Boolean(ok), detail: String(detail ?? "") }); console.log(`${ok ? "PASS" : "FAIL"}  [${area}] ${name}${detail ? `  (${String(detail).slice(0, 240)})` : ""}`); };

// ---------------------------------------------------------------- DB (owner, read-only)
const psql = makePsql({ bin: findPgBin(), port: STATE.pgPort });
async function q(sql) {
  // Retries: other sessions run their own clusters on this machine, so connections can time out under load.
  let r;
  for (let i = 0; i < 4; i++) { r = await psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`); if (r.ok) return JSON.parse(r.stdout.trim() || "[]"); await sleep(1500 * (i + 1)); }
  throw new Error(`SQL failed: ${r.stderr.trim()} :: ${sql.slice(0, 160)}`);
}
const q1 = async (sql) => (await q(sql))[0];
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------- API
async function api(method, p, { token, body } = {}) {
  const r = await fetch(API + p, { method, headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let json; try { json = JSON.parse(t); } catch { json = null; } return { status: r.status, body: json };
}
const tokens = new Map();
async function tok(email) { if (!tokens.has(email)) { const r = await api("POST", "/auth/v1/token?grant_type=password", { body: { email, password: PASSWORD } }); if (!r.body?.access_token) throw new Error(`sign-in ${email}`); tokens.set(email, r.body.access_token); } return tokens.get(email); }
const rpc = async (email, fn, args = {}) => api("POST", `/rest/v1/rpc/${fn}`, { token: await tok(email), body: args });
const sel = async (email, p) => api("GET", `/rest/v1/${p}`, { token: await tok(email) });
const ins = async (email, table, body) => api("POST", `/rest/v1/${table}`, { token: await tok(email), body });
const emsg = (r) => (r.body && (r.body.message || r.body.error)) || `HTTP ${r.status}`;

// ---------------------------------------------------------------- browser
async function session(viewport = { w: 1440, h: 900, m: false }) {
  const port = 9300 + Math.floor(Math.random() * 250);
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-m7-"));
  const proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let target; for (let i = 0; i < 80 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    const p = m.params;
    if (m.method === "Fetch.requestPaused") { const host = new URL(p.request.url).hostname; if (host === "127.0.0.1" || host === "localhost") send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {}); else { blocked.push(p.request.url.slice(0, 160)); send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {}); } }
    if (m.method === "Runtime.exceptionThrown") pageErrors.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text).split("\n")[0]);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: viewport.w, height: viewport.h, deviceScaleFactor: 1, mobile: viewport.m });
  const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  const go = async (p, wait = 3500) => { await send("Page.navigate", { url: BASE + p }); await sleep(wait); };
  const reload = async (wait = 4500) => { await send("Page.reload", { ignoreCache: true }); await sleep(wait); };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 }); const f = `m7-${name}.jpg`; writeFileSync(path.join(SHOTS, f), Buffer.from(s.data, "base64")); shots.push(f); };
  const close = async () => { try { ws.close(); } catch {} proc.kill(); await sleep(600); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { js, go, reload, shot, close };
}
const H = `window.__h = {
  setVal(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
  scope() { const d = [...document.querySelectorAll('[role=dialog]')]; return d[d.length - 1] || document; },
  field(label) { const s = this.scope(); const l = [...s.querySelectorAll('label')].find((x) => x.textContent.replace('*','').trim().startsWith(label)); return l && (document.getElementById(l.htmlFor) || l.querySelector('input,select,textarea')); },
  fill(label, v) { const el = this.field(label); if (!el) return false; this.setVal(el, v); return true; },
  options(label) { const el = this.field(label); return el && el.tagName === 'SELECT' ? [...el.options].map((o) => o.textContent) : null; },
  btn(text, inDialog) { const s = inDialog ? this.scope() : document; return [...s.querySelectorAll('button,a')].find((x) => x.textContent.trim().startsWith(text)); },
  click(text, inDialog) { const b = this.btn(text, inDialog); if (!b || b.disabled) return false; b.click(); return true; },
  disabled(text) { const b = this.btn(text, false); return b ? b.disabled : null; },
  ready(text) { const b = this.btn(text, false); return !!b && !b.disabled; },
  rowClick(rowText, btnText) { const tr = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes(rowText)); if (!tr) return 'no-row'; const b = [...tr.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(btnText)); if (!b || b.disabled) return 'no-button'; b.click(); return true; },
  rowCheck(rowText) { const tr = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes(rowText) && r.querySelector('input[type=checkbox]')); const c = tr && tr.querySelector('input[type=checkbox]'); if (!c) return false; if (!c.checked) c.click(); return true; },
  rowText(rowText) { const tr = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes(rowText)); return tr ? tr.innerText.replace(/\\s+/g, ' ') : null; },
  tick(t) { const s = this.scope(); const l = [...s.querySelectorAll('label')].find((x) => x.textContent.trim().includes(t)); const i = l && (document.getElementById(l.htmlFor) || l.querySelector('input')); if (!i) return false; if (!i.checked) i.click(); return true; },
  tab(text) { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim().startsWith(text)); if (!t) return false; t.click(); return true; },
  confirm(label) { const d = this.scope(); if (d === document) return false; const bs = [...d.querySelectorAll('button')].filter((b) => !/^(Cancel|Close)$/.test(b.textContent.trim()) && !b.getAttribute('aria-label')); const b = label ? bs.find((x) => x.textContent.trim().startsWith(label)) : bs[bs.length - 1]; if (!b) return false; b.click(); return b.textContent.trim(); },
  dialogOpen() { return document.querySelectorAll('[role=dialog]').length; },
  dialogText() { const d = this.scope(); return d === document ? '' : d.innerText; },
  toasts() { return [...document.querySelectorAll('[aria-live=polite] [role=status]')].map((t) => t.textContent.trim()).join(' | '); },
  text() { return document.body.innerText.replace(/\\s+/g, ' '); },
  overflow() { return document.documentElement.scrollWidth - window.innerWidth; },
};`;
const h = (s, expr) => s.js(`(() => { ${H}; return window.__h.${expr}; })()`);
const J = JSON.stringify;
async function waitFor(s, expr, timeout = 30000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await h(s, expr)) return true; await sleep(300); } return false; }
async function clickW(s, text, timeout = 45000) { const ok = await waitFor(s, `ready(${J(text)})`, timeout); return ok && h(s, `click(${J(text)})`); }
const confirmW = async (s, label) => { await waitFor(s, "dialogOpen() > 0", 20000); return h(s, `confirm(${J(label)})`); };
const waitIncl = (s, str, timeout) => waitFor(s, `text().includes(${J(str)})`, timeout);
const waitText = (s, re, timeout) => waitFor(s, `text().match(${re}i)`, timeout);
async function login(s, email) {
  await s.go("/login", 1500);
  // First load after a Vite restart compiles the app; wait for the form instead of a fixed delay.
  await waitFor(s, "!!document.querySelector('input[name=email]')", 120000);
  await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${J(email)}); set('password', ${J(PASSWORD)}); document.querySelector('form').requestSubmit(); })()`);
  for (let i = 0; i < 100; i++) { await sleep(400); const p = await s.js("location.pathname"); if (p && p !== "/login") { await sleep(2500); return p; } }
  return s.js("location.pathname");
}
const money = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(n)).replace(/\s+/g, " ");

// ================================================================= run
const eng = await q1(`select e.id, coalesce(e.display_name, e.first_name || ' ' || e.last_name) as name, e.employee_code from hr_employees e join auth.users u on u.id = e.user_id where u.email = 'employee@example.com'`);
const fin = await q1(`select e.id, coalesce(e.display_name, e.first_name || ' ' || e.last_name) as name from hr_employees e join auth.users u on u.id = e.user_id where u.email = 'payroll.admin@example.com'`);
const apr = await q1(`select e.id, coalesce(e.display_name, e.first_name || ' ' || e.last_name) as name from hr_employees e join auth.users u on u.id = e.user_id where u.email = 'payroll.approver@example.com'`);
const today = (await q1("select hr_private.business_today()::text d")).d;
const monthStart = `${today.slice(0, 7)}-01`;

// ---------------------------------------------------------------- A. server-side refusals (API, no UI)
{
  const r1 = await ins("payroll.admin@example.com", "hr_salary_structures", { employee_id: fin.id, effective_from: monthStart, annual_ctc: 9999999 });
  check("security", "payroll admin cannot create own salary structure (direct table write)", r1.status >= 400, emsg(r1));
  const r2 = await ins("payroll.admin@example.com", "hr_employee_bank_accounts", { employee_id: fin.id, bank_name: "Example Bank", account_holder: "Self", account_number: "111122223333" });
  check("security", "payroll admin cannot add own bank account (redirect pay)", r2.status >= 400, emsg(r2));
  const r3 = await sel("hr.admin@example.com", "hr_payroll_runs?select=id");
  check("security", "HR admin sees no payroll runs", r3.status === 200 && r3.body.length === 0, `${r3.body?.length} rows`);
  const r4 = await rpc("hr.admin@example.com", "hr_payroll_overview", {});
  check("security", "HR admin cannot open payroll overview", r4.status >= 400, emsg(r4));
  const r5 = await sel("employee@example.com", "hr_payroll_payments?select=id");
  check("security", "employee cannot read the payments table", r5.status === 200 && r5.body.length === 0, `${r5.body?.length} rows`);
  const r6 = await sel("employee2@example.com", `hr_payslips?select=id&employee_id=eq.${eng.id}`);
  check("security", "employee cannot read a colleague's payslips", r6.status === 200 && r6.body.length === 0, `${r6.body?.length} rows`);
}

const admin = await session();
const approver = await session();
const emp = await session();
try {
  // ---------------------------------------------------------------- B. preparer: overview, structure revision
  check("login", "payroll admin signs in", (await login(admin, "payroll.admin@example.com")) !== "/login");
  await admin.go("/hr/payroll", 5000);
  const ov = await q1(`select coalesce(sum(i.net),0)::numeric n, count(*) c from hr_payroll_items i join hr_payroll_runs r on r.id = i.run_id where r.period_start = (select max(period_start) from hr_payroll_runs)`);
  await waitIncl(admin, money(ov.n), 45000);
  const ovText = await h(admin, "text()");
  check("overview", "overview net equals payroll records", ovText.includes(money(ov.n)), `DB net ${money(ov.n)}, ${ov.c} employees`);
  check("overview", "overview shows payments completed / pending tiles", /Payments completed/i.test(ovText) && /Payments pending/i.test(ovText));
  await admin.shot("overview-desktop");

  await h(admin, 'tab("Salary structures")'); await waitIncl(admin, eng.name, 45000); await sleep(1000);
  const revDate = monthStart;
  const rv = await h(admin, `rowClick(${J(eng.name)}, "Revise")`);
  check("structures", "Revise action available on an approved structure", rv === true, rv);
  await waitFor(admin, "dialogOpen() > 0");
  await h(admin, `fill("Effective from", ${J(revDate)})`); await h(admin, `fill("Reason", "Synthetic annual increment (UI flow)")`);
  await h(admin, 'confirm("Create revision draft")'); await sleep(2500);
  const draft = await q1(`select id, status, revision_of from hr_salary_structures where employee_id = ${lit(eng.id)} and effective_from = ${lit(revDate)} and status = 'draft'`);
  check("structures", "revision draft created with copied components", draft && draft.revision_of && (await q1(`select count(*)::int c from hr_salary_structure_items where structure_id = ${lit(draft?.id)}`)).c > 0);
  await h(admin, 'click("Close", true)'); await sleep(1500);
  const own = await h(admin, `rowText(${J(fin.name)})`);
  check("structures", "own structure shows no edit/approve actions for the payroll admin", !own || /handled by another payroll user/.test(own), own?.slice(0, 120));
  const sb = await h(admin, `rowClick(${J(eng.name)}, "Submit")`); await waitFor(admin, "dialogOpen() > 0"); await h(admin, 'confirm("Submit")'); await sleep(2500);
  check("structures", "revision submitted for approval", sb === true && (await q1(`select status from hr_salary_structures where id = ${lit(draft?.id)}`))?.status === "pending_approval");
  check("structures", "preparer sees no Approve button for own submission", !(await h(admin, `rowText(${J(eng.name)})`))?.includes("Approve"));

  // ---------------------------------------------------------------- C. approver approves the structure
  check("login", "payroll approver signs in", (await login(approver, "payroll.approver@example.com")) !== "/login");
  await approver.go("/hr/payroll?tab=approvals", 5000);
  await waitIncl(approver, eng.name, 45000); await sleep(1000);
  const ap = await h(approver, `rowClick(${J(eng.name)}, "Approve")`); await waitFor(approver, "dialogOpen() > 0"); await h(approver, 'confirm("Approve")'); await sleep(3000);
  const st = await q1(`select status, approved_by from hr_salary_structures where id = ${lit(draft?.id)}`);
  check("structures", "approver activates revision from the Approvals queue", ap === true && st?.status === "active", JSON.stringify(st));
  const prev = await q1(`select effective_to::text as ended from hr_salary_structures where employee_id = ${lit(eng.id)} and status = 'active' and effective_from < ${lit(revDate)} order by effective_from desc limit 1`);
  check("structures", "previous structure end-dated the day before (history preserved)", prev?.ended && prev.ended < revDate, prev?.ended);
  await approver.shot("approvals-desktop");

  // ---------------------------------------------------------------- D. preparer creates + calculates + submits this month's run
  await admin.go("/hr/payroll?tab=runs", 4000);
  await clickW(admin, "New payroll run"); await waitFor(admin, "dialogOpen() > 0");
  await h(admin, 'confirm("Create draft")');
  await waitFor(admin, "location.pathname.includes('/runs/') || false", 8000).catch(() => {});
  await sleep(3000);
  const runId = (await admin.js("location.pathname")).split("/runs/")[1];
  const run0 = await q1(`select status, period_start::text ps from hr_payroll_runs where id = ${lit(runId)}`);
  check("run", "run created as draft from the UI", run0?.status === "draft", JSON.stringify(run0));
  const sa = await rpc("payroll.admin@example.com", "hr_add_payroll_adjustment", { p_run_id: runId, p_employee: fin.id, p_amount: 5000, p_reason: "Self bonus attempt (test)" });
  check("security", "P4: payroll admin self-adjustment refused by the server", sa.status >= 400 && /yourself/i.test(emsg(sa)), emsg(sa));
  await clickW(admin, "Add adjustment"); await waitFor(admin, "dialogOpen() > 0");
  const opts = await h(admin, 'options("Employee")');
  check("security", "own name not offered in the adjustment form", Array.isArray(opts) && !opts.some((o) => o.includes(fin.name)), `${opts?.length} options`);
  await h(admin, 'click("Cancel", true)'); await sleep(800);
  await clickW(admin, "Calculate"); await waitFor(admin, "dialogOpen() > 0"); await h(admin, 'confirm("Calculate")');
  await waitFor(admin, "text().includes('Calculated') && !document.querySelector('[role=dialog]')", 20000); await sleep(2500);
  const calc = await q1(`select r.status, (select count(*) from hr_payroll_items where run_id = r.id)::int n, (select sum(net) from hr_payroll_items where run_id = r.id)::numeric net from hr_payroll_runs r where r.id = ${lit(runId)}`);
  check("run", "calculation preview built items", calc?.status === "calculated" && calc.n > 0, JSON.stringify(calc));
  const kpi = await h(admin, "text()");
  check("run", "run KPI net equals DB", kpi.includes(money(calc.net)), money(calc.net));
  const engItem = await q1(`select gross, structure_id from hr_payroll_items where run_id = ${lit(runId)} and employee_id = ${lit(eng.id)}`);
  check("run", "calculation uses the newly approved revision", engItem?.structure_id === draft?.id, engItem?.structure_id);
  await admin.shot("run-calculated");
  await clickW(admin, "Submit for approval"); await waitFor(admin, "dialogOpen() > 0"); await h(admin, 'confirm("Submit")'); await sleep(3000);
  check("run", "run submitted", (await q1(`select status from hr_payroll_runs where id = ${lit(runId)}`))?.status === "reviewed");
  check("run", "preparer has no enabled Approve button", (await h(admin, 'disabled("Approve")')) !== false);
  const selfApprove = await rpc("payroll.admin@example.com", "hr_approve_payroll_run", { p_id: runId });
  check("security", "preparer cannot approve own run (server)", selfApprove.status >= 400, emsg(selfApprove));
  await admin.reload();
  check("refresh", "submitted status persists after browser refresh", await waitText(admin, "/Submitted/", 45000));

  // ---------------------------------------------------------------- E. approver: return, then approve + finalize
  await approver.go(`/hr/payroll/runs/${runId}`, 5000);
  await clickW(approver, "Return for correction"); await waitFor(approver, "dialogOpen() > 0");
  await h(approver, 'fill("What needs correcting", "Synthetic: please re-check (UI flow)")'); await h(approver, 'confirm("Return")'); await sleep(3000);
  const ret = await q1(`select status, return_reason from hr_payroll_runs where id = ${lit(runId)}`);
  check("run", "approver returns the run for correction", ret?.status === "calculated" && ret.return_reason, JSON.stringify(ret));
  await admin.go(`/hr/payroll/runs/${runId}`, 4500);
  check("run", "preparer sees the return reason", /re-check \(UI flow\)/.test(await h(admin, "text()")));
  await clickW(admin, "Submit for approval"); await waitFor(admin, "dialogOpen() > 0"); await h(admin, 'confirm("Submit")'); await sleep(3000);
  await approver.reload();
  await clickW(approver, "Approve"); await waitFor(approver, "dialogOpen() > 0"); await h(approver, 'confirm("Approve")'); await sleep(3000);
  check("run", "independent approver approves", (await q1(`select status from hr_payroll_runs where id = ${lit(runId)}`))?.status === "approved");
  await clickW(approver, "Finalize"); await waitFor(approver, "dialogOpen() > 0"); await h(approver, 'tick("I understand")'); await h(approver, 'confirm("Finalize")'); await sleep(4500);
  const fz = await q1(`select r.status, r.payment_status, (select count(*) from hr_payslips where run_id = r.id)::int slips, (select count(*) from hr_payroll_payments where run_id = r.id)::int pays from hr_payroll_runs r where r.id = ${lit(runId)}`);
  check("run", "finalized: payslips published and payments pending", fz?.status === "finalized" && fz.slips > 0 && fz.pays > 0 && fz.payment_status === "pending", JSON.stringify(fz));
  const tamper = await rpc("payroll.admin@example.com", "hr_calculate_payroll_run", { p_id: runId });
  check("security", "finalized run cannot be recalculated", tamper.status >= 400, emsg(tamper));

  // ---------------------------------------------------------------- F. payments
  await approver.reload(5000);
  await waitIncl(approver, "UTR", 1).catch(() => {}); await waitFor(approver, `rowText(${J(eng.name)}) && rowText(${J(apr.name)})`, 45000);
  const ownRow = await h(approver, `rowText(${J(apr.name)})`);
  check("payments", "approver's own payment is not selectable", !ownRow || / own /.test(` ${ownRow} `), ownRow?.slice(0, 120));
  check("payments", "employee payment selectable", await h(approver, `rowCheck(${J(eng.name)})`));
  await clickW(approver, "Record status"); await waitFor(approver, "dialogOpen() > 0");
  await h(approver, 'fill("Bank / payment reference", "UTR-SYN-M7-0001")'); await h(approver, 'confirm("Record")'); await sleep(3500);
  const pay = await q1(`select status, reference, method, payment_date::text d from hr_payroll_payments where run_id = ${lit(runId)} and employee_id = ${lit(eng.id)}`);
  check("payments", "payment recorded as paid with evidence", pay?.status === "paid" && pay.reference === "UTR-SYN-M7-0001" && pay.method === "bank_transfer", JSON.stringify(pay));
  const rs = await q1(`select status, payment_status from hr_payroll_runs where id = ${lit(runId)}`);
  check("payments", "run not marked paid while other payments are pending", rs.status === "finalized" && rs.payment_status === "partially_paid", JSON.stringify(rs));
  check("payments", "recorder cannot reconcile own entry (button disabled)", await h(approver, `rowCheck(${J(eng.name)})`) && (await h(approver, 'disabled("Reconcile")')) === true);
  await approver.shot("payments");
  await admin.go(`/hr/payroll/runs/${runId}`, 5000);
  await waitFor(admin, `rowText("UTR-SYN-M7-0001")`, 45000);
  await h(admin, `rowCheck(${J(eng.name)})`); await clickW(admin, "Reconcile"); await waitFor(admin, "dialogOpen() > 0");
  await h(admin, 'fill("Bank statement reference", "Synthetic statement line 42")'); await h(admin, 'confirm("Reconcile")'); await sleep(3000);
  check("payments", "second person reconciles", (await q1(`select status from hr_payroll_payments where run_id = ${lit(runId)} and employee_id = ${lit(eng.id)}`))?.status === "reconciled");

  // ---------------------------------------------------------------- G. employee self-service
  check("login", "employee signs in", (await login(emp, "employee@example.com")) !== "/login");
  await emp.go("/employee/payslips?tab=payslips", 5000);
  const slip0 = await q1(`select net from hr_payslips where run_id = ${lit(runId)} and employee_id = ${lit(eng.id)}`);
  await waitIncl(emp, money(slip0.net), 45000);
  const slip = await q1(`select id, net from hr_payslips where run_id = ${lit(runId)} and employee_id = ${lit(eng.id)}`);
  const et = await h(emp, "text()");
  check("employee", "employee sees the new payslip with net from the record", et.includes(money(slip.net)), money(slip.net));
  check("employee", "payment status shown on the payslip", /\bpaid\b/i.test(await h(emp, `rowText(${J(money(slip.net))})`) ?? ""));
  const pdfBtn = await h(emp, `rowClick(${J(money(slip.net))}, "PDF")`); await sleep(1200);
  check("employee", "PDF download runs without page errors", pdfBtn === true && pageErrors.length === 0, pageErrors.join("; "));
  await h(emp, `rowClick(${J(money(slip.net))}, "Query")`); await waitFor(emp, "dialogOpen() > 0");
  await emp.js(`(() => { ${H}; const el = window.__h.field("About"); window.__h.setVal(el, "missing_earning"); })()`);
  await h(emp, 'fill("What looks wrong?", "Synthetic: shift allowance missing (UI flow)")'); await h(emp, 'confirm("Send query")'); await sleep(3000);
  check("employee", "payroll query raised from the payslip", Boolean(await q1(`select id from hr_payroll_correction_requests where payslip_id = ${lit(slip.id)} and status = 'submitted'`)));
  await h(emp, 'tab("Salary details")'); await sleep(2500);
  const mine = (await rpc("employee@example.com", "hr_my_salary_structure")).body;
  check("employee", "Salary details shows the current approved structure", (await h(emp, "text()")).includes(money(mine?.current?.gross ?? -1)), money(mine?.current?.gross));
  await emp.shot("employee-salary");
  await emp.reload();
  check("refresh", "employee page reloads on the same tab (Salary details) with its data after refresh", await waitIncl(emp, money(mine?.current?.gross ?? -1), 45000));
  await emp.go("/employee/payslips?tab=payslips", 5000);
  check("refresh", "payslips tab loads the payslip again", await waitIncl(emp, money(slip.net), 45000));

  // ---------------------------------------------------------------- H. mobile layout
  const mob = await session({ w: 390, h: 844, m: true });
  try {
    await login(mob, "payroll.approver@example.com");
    await mob.go("/hr/payroll", 5000);
    check("responsive", "payroll overview fits a 390px screen (no horizontal page scroll)", (await h(mob, "overflow()")) <= 1, `overflow ${await h(mob, "overflow()")}px`);
    await mob.shot("overview-mobile");
    await login(mob, "employee@example.com");
    await mob.go("/employee/payslips", 5000);
    check("responsive", "My Payroll & Payslips (overview) fits a 390px screen", (await h(mob, "overflow()")) <= 1, `overflow ${await h(mob, "overflow()")}px`);
    await mob.shot("employee-payslips-mobile");
  } finally { await mob.close(); }
} catch (e) {
  check("runner", "flow crashed", false, e.stack?.split("\n").slice(0, 3).join(" | "));
} finally {
  await admin.close(); await approver.close(); await emp.close();
}

check("guard", "no non-local network requests", blocked.length === 0, blocked.slice(0, 3).join(", "));
check("guard", "no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join("; "));
const passed = checks.filter((c) => c.ok).length;
writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), passed, total: checks.length, checks, shots, blocked, pageErrors }, null, 2));
console.log(`\n${passed}/${checks.length} checks passed. Results: ${OUT}`);
process.exit(passed === checks.length ? 0 : 1);

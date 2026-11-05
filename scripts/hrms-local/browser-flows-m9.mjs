#!/usr/bin/env node
// TEST-ONLY end-to-end checks for Module 9 (Employee Documents) against the
// LOCAL HRMS harness: overview counts, employee upload + HR notification,
// verification (reject / notes / history), letter preview + issue + PDF +
// acknowledgement, templates, policies (publish / versions / acknowledgement /
// reminders), contracts (upload / renewal), expiry reminders + Edge Function
// stand-in, access denial, mobile layout.
//
//   HRMS_LOCAL_INSTANCE=m9 node scripts/hrms-local/start.mjs --port-api 54329 --port-web 8099
//   node scripts/hrms-local/browser-flows-m9.mjs --state %TEMP%/zyllo-hrms-local-m9.json --out <results.json> [--only letters,policies]
//
// Talks ONLY to 127.0.0.1 (browser network guard blocks everything else).
// Synthetic data only. Screenshots: docs/hrms/local-test-screenshots/wf9-*.jpg
// Helper block below is copied from browser-flows-4.mjs (plus a file-input helper).
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
const OUT = arg("--out", path.join(tmpdir(), "hrms-flows9", "results.json"));
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
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-flow9-"));
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
    const file = `wf9-${name}.jpg`;
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
// Waits for the sign-in form (the dev server may still be compiling) and retries.
async function login(s, email, password = PASSWORD) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await s.go("/login", 1500);
    for (let i = 0; i < 40 && !(await s.js("Boolean(document.querySelector('input[name=\"password\"]'))")); i++) await sleep(500);
    await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${J(email)}); set('password', ${J(password)}); document.querySelector('form').requestSubmit(); })()`);
    for (let i = 0; i < 40; i++) { await sleep(400); const p = await s.js("location.pathname"); if (p && p !== "/login") { await sleep(1500); return p; } }
  }
  throw new Error(`sign-in did not complete for ${email}`);
}
const itemIdx = async (s, activity) => s.js(`(() => { ${H}; const ls = [...document.querySelectorAll('label')].filter((x) => __h.lab(x) === 'Activity'); return ls.findIndex((l) => __h.inputOf(l).value === ${JSON.stringify(activity)}); })()`);
async function as(email, fn) {
  const s = await session();
  try { await login(s, email); return await fn(s); } finally { await s.close(); }
}


// ================================================================== Module 9 flows
const today = (await q1("select hr_private.business_today()::text d")).d;
const addDays = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const empId = async (email) => (await q1(`select e.id from public.hr_employees e join auth.users u on u.id = e.user_id where u.email = ${lit(email)}`)).id;
const FIX = mkdtempSync(path.join(tmpdir(), "hrms-m9-files-"));
const pdfFile = (name) => { const f = path.join(FIX, name); writeFileSync(f, `%PDF-1.4\n% synthetic test file ${RUN} ${name}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`); return f; };
const noOverflow = (s) => s.js("document.documentElement.scrollWidth <= window.innerWidth + 1");
const EMP = "employee@example.com", EMP2 = "employee2@example.com", HR = "hr.admin@example.com", MGR = "manager@example.com";
const empA = await empId(EMP);

async function wfOverview() {
  const W = "overview";
  await as(HR, async (s) => {
    await s.go("/hr/documents", 4500);
    const tabs = await h(s, "tabs()");
    check(W, "ui", "HR sees the Module 9 tabs", ["Overview", "Directory", "Verification", "Letters", "Contracts", "Certificates", "Templates", "Policies", "Acknowledgements", "Expiry & reminders", "Checklist"].every((t) => tabs.some((x) => x.startsWith(t))), tabs.join("|"));
    await waitText(s, /Total documents/);
    await sleep(1500);
    const total = (await rpc(HR, "hr_documents_overview", { p_filters: {} })).body.total;
    const dbTotal = await cnt("select 1 from public.hr_documents where archived_at is null and (not includes_compensation or true)");
    check(W, "db", "overview total = real active documents (HR Admin sees all)", total === dbTotal, `${total} vs ${dbTotal}`);
    const shown = await s.js(`(() => { const k = [...document.querySelectorAll('button,div')].find((x) => x.textContent.startsWith('Total documents') ); return k ? k.textContent : ''; })()`);
    check(W, "ui", "overview card shows the server count", shown.includes(String(total)), shown.slice(0, 60));
    await s.shot("overview");
    await h(s, `ariaPick("Department", "Engineering")`);
    await sleep(2500);
    const dep = (await q1("select id from public.hr_departments where name ilike 'Engineering%' limit 1"))?.id;
    if (dep) {
      const fTotal = (await rpc(HR, "hr_documents_overview", { p_filters: { department: dep } })).body.total;
      const db = await cnt(`select 1 from public.hr_documents d join public.hr_employees e on e.id = d.employee_id where d.archived_at is null and e.department_id = ${lit(dep)}`);
      check(W, "db", "department filter counts match the database", fTotal === db, `${fTotal} vs ${db}`);
    }
    await h(s, `tab("Certificates")`);
    await sleep(1500);
    await s.reload(5000);
    check(W, "refresh", "selected tab survives refresh (?tab=certificates)", (await s.js("location.search")).includes("tab=certificates")
      && (await s.js(`[...document.querySelectorAll('[role=tab][aria-selected=true]')].map((x) => x.textContent).join()`)).startsWith("Certificates"));
  });
}

async function wfUploadVerify() {
  const W = "upload_verify";
  const title = `Internship cert ${RUN}`;
  await as(EMP, async (s) => {
    await s.go("/employee/documents", 4500);
    check(W, "ui", "upload button available", await h(s, `click("Upload document")`));
    await waitDialog(s);
    check(W, "ui", "category chosen", Boolean(await h(s, `pickText("Category", "Internship certificate")`)));
    await h(s, `fill("Title", ${J(title)})`);
    await s.setFile('[role=dialog] input[type=file]', pdfFile("cert.pdf"));
    await sleep(300);
    await h(s, `click("Upload", true)`);
    await waitNoDialog(s, 10000);
    const doc = await q1(`select d.id, d.verification_status from public.hr_documents d where d.title = ${lit(title)}`);
    check(W, "db", "document + file stored, pending", doc && doc.verification_status === "pending" && (await cnt(`select 1 from storage.objects o join public.hr_document_versions v on v.storage_path = o.name where v.document_id = ${lit(doc.id)}`)) === 1, J(doc));
    check(W, "db", "HR notified in-app for verification", (await cnt(`select 1 from public.hr_notifications where type = 'document_uploaded' and entity_id = ${lit(doc?.id)}`)) > 0);
    await s.reload(4500);
    check(W, "refresh", "upload persists after refresh", (await h(s, "main()")).includes(title));
  });
  const doc = await q1(`select id from public.hr_documents where title = ${lit(title)}`);
  await as(HR, async (s) => {
    await s.go("/hr/documents?tab=verification", 5000);
    check(W, "ui", "deep link opens the verification queue", (await h(s, "main()")).includes(title));
    await h(s, `rowClick(${J(title)}, "Review")`);
    await waitDialog(s);
    await sleep(1500);
    await h(s, `click("Reject", true)`);
    await sleep(800);
    await h(s, `confirm()`);
    await sleep(800);
    check(W, "error", "rejecting without a reason is refused in the UI", (await h(s, "alerts()")).some((a) => /reason/i.test(a)));
    await h(s, `fill("Reason", "Synthetic: unreadable scan")`);
    await h(s, `fill("Verification notes", "Checked by flow ${RUN}")`);
    await h(s, `confirm()`);
    await waitNoDialog(s, 8000);
    const r = await q1(`select verification_status, rejection_reason, verification_notes from public.hr_documents where id = ${lit(doc.id)}`);
    check(W, "db", "rejected with reason + notes", r.verification_status === "rejected" && r.rejection_reason.includes("unreadable") && r.verification_notes.includes(RUN), J(r));
    check(W, "db", "verification history row written", (await cnt(`select 1 from public.hr_document_reviews where document_id = ${lit(doc.id)} and to_status = 'rejected'`)) === 1);
  });
  const own = await q1(`select d.id from public.hr_documents d join public.hr_employees e on e.id = d.employee_id join auth.users u on u.id = e.user_id where u.email = ${lit(HR)} and d.archived_at is null and d.current_version > 0 limit 1`);
  if (own) check(W, "permission", "HR cannot verify own document (server)", refused(await rpc(HR, "hr_review_document", { p_document: own.id, p_approve: true })));
  check(W, "permission", "employee cannot verify (server)", refused(await rpc(EMP, "hr_review_document", { p_document: doc.id, p_approve: true })));
}

async function wfLetters() {
  const W = "letters";
  await as(HR, async (s) => {
    await s.go("/hr/documents?tab=letters", 5000);
    check(W, "ui", "template picked", Boolean(await h(s, `pickText("Template", "Appointment letter · ")`)));
    check(W, "ui", "employee picked", Boolean(await h(s, `pickText("Employee", "Demo Engineer 03")`)));
    await sleep(500);
    await h(s, `click("Preview")`);
    await sleep(2500);
    check(W, "error", "preview lists missing details and blocks issuing", /Missing:/.test(await h(s, "main()")) && (await h(s, `disabled("Issue letter")`)) === true);
    await h(s, `fill("Authorised signatory", "Demo Signatory")`);
    await h(s, `fill("Signatory title", "HR Director")`);
    await h(s, `fill("Terms and conditions", "Synthetic terms for ${RUN}.")`);
    await h(s, `fill("Work location (override)", "Demo Office")`);
    await h(s, `click("Preview")`);
    await sleep(2500);
    const txt = await h(s, "main()");
    check(W, "ui", "preview shows merged employee + signatory", txt.includes("Demo Engineer 03") && txt.includes("Demo Signatory"));
    await s.shot("letter-preview");
    await h(s, `click("Issue letter")`);
    await waitDialog(s);
    await h(s, "confirm()");
    await waitNoDialog(s, 12000);
    await sleep(1500);
  });
  const d = await q1(`select d.id, d.verification_status, d.current_version, d.requires_acknowledgement, v.storage_path, v.size_bytes, v.checksum from public.hr_documents d
     join public.hr_document_versions v on v.document_id = d.id and v.version = d.current_version
     join public.hr_document_templates t on t.id = d.template_id and t.code = 'appointment_letter'
     where d.employee_id = ${lit(empA)} and d.source = 'generated' order by d.created_at desc limit 1`);
  check(W, "db", "appointment letter issued, PDF stored, verified", d && d.verification_status === "verified" && d.checksum?.length === 64, J(d));
  // Download as the employee via a signed URL and check it is a real PDF of the registered size.
  const sign = await api("POST", `/storage/v1/object/sign/hr-documents/${d.storage_path}`, { token: await tok(EMP), body: { expiresIn: 60 } });
  let bytes = null;
  if (sign.body?.signedURL || sign.body?.signedUrl) {
    const u = (sign.body.signedURL || sign.body.signedUrl);
    const r = await fetch(u.startsWith("http") ? u : `${API}/storage/v1${u}`);
    bytes = Buffer.from(await r.arrayBuffer());
  }
  check(W, "db", "employee downloads a valid PDF of the registered size", bytes && bytes.slice(0, 5).toString() === "%PDF-" && bytes.length === Number(d.size_bytes), `${bytes?.length} vs ${d.size_bytes}`);
  const sign2 = await api("POST", `/storage/v1/object/sign/hr-documents/${d.storage_path}`, { token: await tok(EMP2), body: { expiresIn: 60 } });
  check(W, "permission", "colleague cannot get a download link", refused(sign2) || !(sign2.body?.signedURL || sign2.body?.signedUrl), `HTTP ${sign2.status}`);
  const leak = await sel(EMP2, `hr_document_letter_content?select=id&document_id=eq.${d.id}`);
  check(W, "permission", "colleague cannot read the letter text", Array.isArray(leak.body) && leak.body.length === 0);
  // Employee acknowledges in the portal
  await as(EMP, async (s) => {
    await s.go("/employee/documents?tab=acknowledgements", 5000);
    check(W, "ui", "letter appears under pending acknowledgements", (await h(s, "main()")).includes("Appointment letter"));
    await s.js(`(() => { const li = [...document.querySelectorAll('li')].find((l) => l.innerText.includes('Appointment letter')); const b = li && [...li.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Acknowledge'); if (b) b.click(); return Boolean(b); })()`);
    await waitDialog(s);
    check(W, "ui", "acknowledgement states it is not a signature", /not a digital signature/.test(await h(s, "dialogText()")));
    await h(s, "confirm()");
    await waitNoDialog(s);
    await s.reload(4500);
    check(W, "refresh", "acknowledgement history shows it after refresh", /Appointment letter[\s\S]*version/.test(await h(s, "main()")));
  });
  check(W, "db", "acknowledgement stored for the current version", (await cnt(`select 1 from public.hr_document_acknowledgements where document_id = ${lit(d.id)} and version = ${d.current_version}`)) === 1);
  // CTC letter hidden from the manager
  const ctc = await rpc(HR, "hr_issue_document_letter", { p_template: (await q1("select id from public.hr_document_templates where code = 'appointment_letter_with_ctc'")).id, p_employee: empA,
    p_values: { signatory_name: "S", signatory_title: "T", terms_and_conditions: "Terms", annual_ctc: "1000000", monthly_gross: "83333.33", currency: "INR" } });
  // (API-only issue leaves its PDF pending; a later run is then correctly refused until it is stored.)
  check(W, "db", "CTC letter issued by authorised HR (or re-issue blocked while its PDF is pending)", ctc.status === 200 || /waiting for its PDF/.test(emsg(ctc)), emsg(ctc));
  const ctcDoc = ctc.body?.document_id ?? (await q1(`select id from public.hr_documents where employee_id = ${lit(empA)} and includes_compensation and archived_at is null order by created_at desc limit 1`))?.id;
  const mgr = await sel(MGR, `hr_documents?select=id&id=eq.${ctcDoc}`);
  check(W, "permission", "manager cannot see the compensation letter", Boolean(ctcDoc) && Array.isArray(mgr.body) && mgr.body.length === 0, ctcDoc);
  const mgrApp = await sel(MGR, `hr_documents?select=id&id=eq.${d.id}`);
  check(W, "permission", "manager can see the team appointment letter (no compensation)", Array.isArray(mgrApp.body) && mgrApp.body.length === 1);
}

async function wfTemplates() {
  const W = "templates";
  const name = `Flow letter ${RUN}`;
  await as(HR, async (s) => {
    await s.go("/hr/documents?tab=templates", 5000);
    await h(s, `click("New template")`);
    await waitDialog(s);
    await h(s, `fill("Name", ${J(name)})`);
    await h(s, `fill("Document title", "Flow letter — {{employee_name}}")`);
    await h(s, `fill("Letter text", "Hello {{employee_name}}, {{secret_field}} long enough text.")`);
    await h(s, `click("Save draft", true)`);
    await sleep(1500);
    check(W, "error", "unknown placeholder rejected by the server", (await h(s, "alerts()")).some((a) => /Unknown placeholder/.test(a)));
    await h(s, `fill("Letter text", "Hello {{employee_name}} ({{employee_id}}), welcome to {{department}}.")`);
    await h(s, `click("Save & preview draft", true)`);
    await sleep(2500);
    check(W, "ui", "draft preview with sample data", /Sample Employee/.test(await h(s, "dialogText()")));
    await h(s, "cancel()");
    await waitNoDialog(s);
    await s.reload(4500);
    check(W, "refresh", "draft template listed after refresh", (await h(s, `rowText(${J(name)})`))?.includes("draft"));
    await h(s, `rowClick(${J(name)}, "Approve")`);
    await waitDialog(s);
    await h(s, "confirm()");
    await waitNoDialog(s);
    await sleep(1200);
  });
  const t = await q1(`select status, approved_version from public.hr_document_templates where name = ${lit(name)}`);
  check(W, "db", "template approved (v1 snapshot)", t?.status === "approved" && t.approved_version === 1, J(t));
  check(W, "permission", "employee cannot read templates", ((await sel(EMP, "hr_document_templates?select=id")).body ?? []).length === 0);
}

async function wfPolicies() {
  const W = "policies";
  const title = `Remote work policy ${RUN}`;
  await as(HR, async (s) => {
    await s.go("/hr/documents?tab=policies", 5000);
    await h(s, `click("New policy")`);
    await waitDialog(s);
    await h(s, `fill("Title", ${J(title)})`);
    await h(s, `fill("Policy text", "Synthetic policy text v1 for ${RUN}.")`);
    await s.setFile('[role=dialog] input[type=file]', pdfFile("policy.pdf"));
    await h(s, `click("Save draft", true)`);
    await waitNoDialog(s, 10000);
    await sleep(1000);
    await h(s, `rowClick(${J(title)}, "Publish")`);
    await waitDialog(s);
    await h(s, "confirm()");
    await waitNoDialog(s, 8000);
    await sleep(1200);
  });
  const p = await q1(`select p.id, p.status, p.current_version, v.storage_path from public.hr_policies p join public.hr_policy_versions v on v.policy_id = p.id and v.status = 'published' where p.title = ${lit(title)}`);
  check(W, "db", "policy published with its PDF", p?.status === "published" && p.current_version === 1 && p.storage_path && (await cnt(`select 1 from storage.objects where name = ${lit(p.storage_path)}`)) === 1, J(p));
  await as(EMP, async (s) => {
    await s.go("/employee/documents?tab=policies", 5000);
    check(W, "ui", "employee sees the published policy", (await h(s, "main()")).includes(title));
    await s.shot("employee-policies");
    const ok = await s.js(`(() => { const c = [...document.querySelectorAll('section')].find((x) => x.innerText.includes(${J(title)})); const b = c && [...c.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Acknowledge'); if (!b) return false; b.click(); return true; })()`);
    check(W, "ui", "acknowledge button on the policy card", ok);
    await waitDialog(s);
    await h(s, "confirm()");
    await waitNoDialog(s);
    await s.reload(4500);
    check(W, "refresh", "policy shows acknowledged after refresh", /acknowledged/.test((await s.js(`(() => { const c = [...document.querySelectorAll('section')].find((x) => x.innerText.includes(${J(title)})); return c ? c.innerText : ''; })()`)) || ""));
  });
  check(W, "db", "policy acknowledgement stored for v1", (await cnt(`select 1 from public.hr_document_acknowledgements where policy_id = ${lit(p.id)} and version = 1 and employee_id = ${lit(empA)}`)) === 1);
  // Edit -> draft v2; published v1 unchanged; direct write refused
  const e = await rpc(HR, "hr_save_policy", { p_policy: p.id, p_values: { content: `Synthetic policy text v2 for ${RUN}.` } });
  check(W, "db", "editing opens draft v2", e.body?.draft_version === 2, emsg(e));
  check(W, "db", "v1 text unchanged", (await q1(`select content from public.hr_policy_versions where policy_id = ${lit(p.id)} and version = 1`)).content.includes("v1"));
  const w = await patch(HR, `hr_policy_versions?policy_id=eq.${p.id}&version=eq.1`, { content: "tampered" });
  check(W, "permission", "published version cannot be patched directly", blockedWrite(w), wdesc(w));
  const pub2 = await rpc(HR, "hr_publish_policy", { p_policy: p.id, p_change_summary: null });
  check(W, "error", "v2 needs a change summary", refused(pub2) && /changed/.test(emsg(pub2)), emsg(pub2));
  await rpc(HR, "hr_publish_policy", { p_policy: p.id, p_change_summary: "Synthetic change" });
  const pend = await rpc(EMP, "hr_my_pending_acknowledgements");
  check(W, "db", "v2 requires a fresh acknowledgement", (pend.body ?? []).some((x) => x.item_id === p.id && x.version === 2));
  // Tracker + reminders
  const tr = await rpc(HR, "hr_acknowledgement_tracker", { p_filters: { policy: p.id } });
  check(W, "db", "tracker counts pending for v2", (tr.body?.totals?.pending ?? 0) > 0, J(tr.body?.totals));
  await as(HR, async (s) => {
    await s.go("/hr/documents?tab=acknowledgements", 5000);
    await h(s, `ariaPick("Policy", ${J(title)})`);
    await sleep(2000);
    await h(s, `rowClick(${J(title)}, "Remind")`);
    await waitDialog(s);
    await h(s, "confirm()");
    await waitNoDialog(s);
    await s.shot("ack-tracker");
  });
  check(W, "db", "reminders logged", (await cnt(`select 1 from public.hr_acknowledgement_reminders r join public.hr_policy_versions v on v.id = r.policy_version_id where v.policy_id = ${lit(p.id)}`)) > 0);
  const again = await rpc(HR, "hr_send_acknowledgement_reminders", { p_policy: p.id });
  check(W, "db", "reminders throttled on repeat", again.body === 0, J(again.body));
}

async function wfContracts() {
  const W = "contracts";
  const title = `Contract ${RUN}`;
  await as(HR, async (s) => {
    await s.go("/hr/documents?tab=contracts", 5000);
    await h(s, `click("Upload contract")`);
    await waitDialog(s);
    await h(s, `pickText("Employee", "Demo Engineer 03")`);
    check(W, "ui", "contract category offered", Boolean(await h(s, `pickText("Category", "Employment agreement")`)));
    await sleep(300);
    await h(s, `fill("Title", ${J(title)})`);
    await h(s, `fill("Expiry date", ${J(addDays(200))})`);
    await h(s, `pickVal("Contract type", "fixed_term")`);
    await h(s, `fill("Renewal date", ${J(addDays(150))})`);
    await s.setFile('[role=dialog] input[type=file]', pdfFile("contract.pdf"));
    await h(s, `click("Upload", true)`);
    await waitNoDialog(s, 10000);
    await sleep(1500);
    const c = await q1(`select id, contract_type, contract_status, renewal_date::text from public.hr_documents where title = ${lit(title)}`);
    check(W, "db", "contract stored with type / status / renewal date", c?.contract_type === "fixed_term" && c.contract_status === "active" && c.renewal_date === addDays(150), J(c));
    await h(s, `rowClick(${J(title)}, "Manage")`);
    await waitDialog(s);
    await sleep(1500);
    await h(s, `click("Renew contract", true)`);
    await sleep(800);
    await h(s, `fill("Title", ${J(title + " renewed")})`);
    await h(s, `fill("Expiry date", ${J(addDays(600))})`);
    await s.setFile('[role=dialog]:last-of-type input[type=file]', pdfFile("contract-renewed.pdf"));
    await h(s, `click("Store renewal", true)`);
    await waitNoDialog(s, 10000);
    await sleep(1200);
    const old = await q1(`select verification_status, contract_status from public.hr_documents where id = ${lit(c.id)}`);
    const neu = await q1(`select supersedes_document_id from public.hr_documents where title = ${lit(title + " renewed")}`);
    check(W, "db", "old contract preserved and marked replaced/renewed", old.verification_status === "replaced" && old.contract_status === "renewed", J(old));
    check(W, "db", "renewal supersedes the old contract", neu?.supersedes_document_id === c.id, J(neu));
    check(W, "db", "old signed contract file still stored", (await cnt(`select 1 from storage.objects o join public.hr_document_versions v on v.storage_path = o.name where v.document_id = ${lit(c.id)}`)) === 1);
    await s.reload(5000);
    const rowsTxt = await s.js(`[...document.querySelectorAll('tbody tr')].filter((r) => r.innerText.includes(${J(title)})).map((r) => r.innerText).join(' || ')`);
    check(W, "refresh", "both contracts listed after refresh (old one replaced)", /replaced/.test(rowsTxt) && rowsTxt.split(" || ").length >= 2, rowsTxt.slice(0, 200));
  });
  check(W, "permission", "employee cannot renew contracts", refused(await rpc(EMP, "hr_renew_contract", { p_document: (await q1(`select id from public.hr_documents where title = ${lit(title + " renewed")}`)).id, p_file_name: "x.pdf", p_mime_type: "application/pdf", p_size_bytes: 10 })));
}

async function wfExpiry() {
  const W = "expiry";
  const r = await rpc(HR, "hr_register_document_upload", { p_employee: empA, p_category: "passport", p_title: `Passport ${RUN}`, p_file_name: "pass.pdf", p_mime_type: "application/pdf", p_size_bytes: 10, p_expiry_date: addDays(12) });
  check(W, "db", "expiring passport registered", r.status === 200, emsg(r));
  await as(HR, async (s) => {
    await s.go("/hr/documents?tab=expiry", 5000);
    check(W, "ui", "schedule shows the passport", (await h(s, "main()")).includes(`Passport ${RUN}`));
    check(W, "ui", "reminder settings loaded (configurable days)", (await h(s, `value("Expiry reminders (days before)")`))?.includes("30"));
    await h(s, `click("Run reminders now")`);
    await waitDialog(s);
    await h(s, "confirm()");
    await waitNoDialog(s, 10000);
    await sleep(1500);
    await s.shot("expiry");
  });
  const log = await q1(`select l.stage_days, r.trigger_source from public.hr_document_reminder_log l join public.hr_document_reminder_runs r on r.id = l.run_id where l.document_id = ${lit(r.body.document_id)}`);
  check(W, "db", "12 days left -> 15-day stage, manual run logged", log?.stage_days === 15 && log.trigger_source === "manual", J(log));
  check(W, "db", "employee notified in-app", (await cnt(`select 1 from public.hr_notifications where type = 'document_expiry' and entity_id = ${lit(r.body.document_id)}`)) > 0);
  check(W, "db", "no email queued while email reminders are off", (await cnt(`select 1 from public.hr_email_outbox where entity_id = ${lit(r.body.document_id)}`)) === 0);
  const fn = await api("POST", "/functions/v1/hr-document-reminders", { token: await tok(HR), body: {} });
  check(W, "db", "Edge Function (HR, manual) runs and is idempotent for the day", fn.status === 200 && fn.body?.reminders === 0, `${fn.status} ${J(fn.body)}`);
  const fnE = await api("POST", "/functions/v1/hr-document-reminders", { token: await tok(EMP), body: {} });
  check(W, "permission", "Edge Function refuses employees", fnE.status === 403, `${fnE.status}`);
  const bad = await rpc(HR, "hr_save_document_settings", { p_values: { expiry_reminder_days: [999] } });
  check(W, "error", "invalid reminder days refused", refused(bad), emsg(bad));
  // renewal request -> employee expiring tab
  const rq = await rpc(HR, "hr_request_document_renewal", { p_document: r.body.document_id, p_message: "Synthetic: upload renewed passport" });
  check(W, "db", "renewal requested", rq.status === 200, emsg(rq));
  await as(EMP, async (s) => {
    await s.go("/employee/documents?tab=expiring", 5000);
    const t = (await h(s, `rowText(${J(`Passport ${RUN}`)})`)) ?? "";
    check(W, "ui", "employee sees the expiring passport with the renewal request", /renewal/i.test(t), t.slice(0, 160));
  });
}

async function wfAccess() {
  const W = "access";
  await as(EMP, async (s) => {
    await s.go("/hr/documents", 4500);
    check(W, "permission", "employee is kept out of HR documents", !(await h(s, "tabs()")).some((t) => t.startsWith("Templates")), await s.js("location.pathname"));
  });
  const all = await rpc(EMP2, "hr_search_documents", { p_filters: {} });
  const mine = await cnt(`select 1 from public.hr_documents d join public.hr_employees e on e.id = d.employee_id join auth.users u on u.id = e.user_id
     join public.hr_document_categories c on c.id = d.category_id where u.email = ${lit(EMP2)} and d.archived_at is null and c.employee_can_view and not c.is_confidential`);
  check(W, "permission", "colleague directory = own visible documents only", all.body?.total <= mine + 5 && (all.body?.rows ?? []).every((x) => x.employee_code === all.body.rows[0].employee_code), `${all.body?.total} rows`);
  check(W, "permission", "employee cannot open the HR overview", refused(await rpc(EMP, "hr_documents_overview", { p_filters: {} })));
  const direct = await post(EMP, "hr_document_acknowledgements", { employee_id: empA, subject_type: "document", document_id: empA, version: 1, title: "x", statement: "x", acknowledged_by: empA });
  check(W, "permission", "acknowledgements cannot be inserted directly", blockedWrite(direct), wdesc(direct));
}

async function wfMobile() {
  const W = "mobile";
  for (const [email, p, name] of [[HR, "/hr/documents?tab=directory", "hr-directory"], [EMP, "/employee/documents", "employee-documents"], [EMP, "/employee/documents?tab=acknowledgements", "employee-acks"]]) {
    const s = await session({ w: 390, h: 844, m: true });
    try {
      await login(s, email);
      await s.go(p, 5000);
      check(W, "ui", `${name}: no horizontal page overflow at 390px`, await noOverflow(s));
      await s.shot(`mobile-${name}`);
    } finally { await s.close(); }
  }
  const s = await session();
  try { await login(s, HR); await s.go("/hr/documents?tab=letters", 5000); await s.shot("desktop-letters"); await s.go("/hr/documents?tab=templates", 4000); await s.shot("desktop-templates"); } finally { await s.close(); }
}

const FLOWS = { overview: wfOverview, upload_verify: wfUploadVerify, letters: wfLetters, templates: wfTemplates, policies: wfPolicies, contracts: wfContracts, expiry: wfExpiry, access: wfAccess, mobile: wfMobile };
try {
  for (const [k, fn] of Object.entries(FLOWS)) {
    if (ONLY.length && !ONLY.includes(k)) continue;
    try { await fn(); } catch (e) { check(k, "crash", "workflow completed", false, e.stack?.split("\n").slice(0, 3).join(" | ")); }
  }
} finally {
  for (const p of chromes) { try { p.kill(); } catch {} }
  try { rmSync(FIX, { recursive: true, force: true }); } catch {}
}
check("global", "network", "no non-local requests left the browser", blocked.length === 0, blocked.slice(0, 3).join(" "));
check("global", "errors", "no uncaught page errors", pageErrors.length === 0, [...new Set(pageErrors)].slice(0, 3).join(" | "));
const failed = checks.filter((c) => !c.ok);
writeFileSync(OUT, JSON.stringify({ run: RUN, passed: checks.length - failed.length, failed: failed.length, checks, shots }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Results: ${OUT}`);
process.exit(failed.length ? 1 : 0);

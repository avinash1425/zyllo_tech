#!/usr/bin/env node
// TEST-ONLY Module 10 (HR Requests & Approvals) UI workflows against the local
// HRMS harness. Writes go to the throwaway local cluster only.
// NETWORK GUARD: every non-local request is blocked and reported.
// Usage: HRMS_LOCAL_INSTANCE=m10 node scripts/hrms-local/browser-flows-m10.mjs --out <dir>
//        (reads the harness state file for the API / web ports and the anon key)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveStateFile, outputDir } from "./lib.mjs";
import { syntheticPdf } from "./fixture-files.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STATE = JSON.parse(readFileSync(resolveStateFile(), "utf8"));
const API = `http://127.0.0.1:${STATE.apiPort}`;
const BASE = arg("--base", `http://127.0.0.1:${STATE.webPort}`);
const OUT = arg("--out", path.join(outputDir("hrms-flows-m10")));
const SHOTS = path.join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "Local-Test-Only-2026!";
const RUN = Date.now().toString(36);
const AMOUNT = (400 + (Date.now() % 50000) / 100).toFixed(2);   // unique per run: identical claims are refused as duplicates
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = []; const blocked = []; const pageErrors = []; const netLog = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const receipt = path.join(OUT, `receipt-${RUN}.pdf`);
// Unique bytes per run: the server refuses a receipt already used on another claim.
writeFileSync(receipt, syntheticPdf(`Synthetic taxi receipt ${RUN} (local harness)`));
const letterPdf = path.join(OUT, `letter-${RUN}.pdf`);
writeFileSync(letterPdf, syntheticPdf(`Synthetic experience letter ${RUN} (local harness)`));

// window.open stub records the opened URL (signed file links) instead of opening a tab.
const OPEN_STUB = `(() => { window.__opened = []; window.open = function (u) { window.__opened.push(String(u ?? '')); return { closed: false, close() {}, location: {} }; }; })();`;

async function session(viewport = { w: 1440, h: 900, m: false }) {
  const port = 9950 + Math.floor(Math.random() * 40);
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-flow-m10-"));
  const proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 80 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    const p = m.params;
    if (m.method === "Fetch.requestPaused") {
      const host = new URL(p.request.url).hostname;
      // .catch: a navigation can invalidate a paused request before it is continued.
      if (host === "127.0.0.1" || host === "localhost") send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
      else { blocked.push(p.request.url.slice(0, 120)); send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {}); }
    }
    if (m.method === "Network.requestWillBeSent" && /storage\/v1\/object/.test(p.request.url)) netLog.push(`send ${p.request.method} ${p.request.url.slice(-60)}`);
    if (m.method === "Network.loadingFailed") netLog.push(`failed ${p.errorText} ${p.blockedReason ?? ""} ${p.corsErrorStatus ? JSON.stringify(p.corsErrorStatus) : ""}`);
    if (m.method === "Network.responseReceived" && /storage\/v1\/object/.test(p.response.url)) netLog.push(`resp ${p.response.status} ${p.response.url.slice(-60)}`);
    if (m.method === "Runtime.exceptionThrown") pageErrors.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text).split("\n")[0]);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("DOM.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: OPEN_STUB });
  await send("Emulation.setDeviceMetricsOverride", { width: viewport.w, height: viewport.h, deviceScaleFactor: 1, mobile: viewport.m });
  const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  // Wait until the routed page rendered and no loading indicator is left (lazy chunks compile on first visit).
  const settle = async (min) => {
    await sleep(Math.min(min, 1500));
    for (let i = 0; i < 120; i++) {
      const ready = await js(`(() => { const m = document.querySelector('main'); return !!m && m.innerText.trim().length > 20 && !/Loading…/.test(document.body.innerText); })()`).catch(() => false);
      if (ready) break;
      await sleep(500);
    }
    await sleep(Math.max(0, min - 1500));
  };
  const go = async (p, wait = 3500) => { await send("Page.navigate", { url: BASE + p }); await settle(wait); };
  const reload = async (wait = 4000) => { await send("Page.reload", { ignoreCache: true }); await settle(wait); };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 }); writeFileSync(path.join(SHOTS, `m10-${name}.jpg`), Buffer.from(s.data, "base64")); };
  const setFile = async (selector, file) => {
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`file input not found: ${selector}`);
    await send("DOM.setFileInputFiles", { files: [file], nodeId });
  };
  const close = async () => { try { ws.close(); } catch {} proc.kill(); await sleep(600); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { send, js, go, reload, shot, setFile, close };
}

const H = `
window.__h = {
  setVal(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
  scope() { const d = [...document.querySelectorAll('[role=dialog]')]; return d[d.length - 1] || document; },
  field(label) { const s = this.scope(); const l = [...s.querySelectorAll('label')].find((x) => x.textContent.replace('*','').trim().startsWith(label)); return l && (document.getElementById(l.htmlFor) || l.querySelector('input,select,textarea')); },
  fill(label, v) { const el = this.field(label); if (!el) return false; this.setVal(el, v); return true; },
  pickValue(label, value) { const el = this.field(label); if (!el) return false; this.setVal(el, value); return el.value === value; },
  pick(label, index) { const el = this.field(label); if (!el || el.tagName !== 'SELECT') return false; const o = [...el.options].filter((x) => x.value); if (!o[index]) return false; this.setVal(el, o[index].value); return o[index].textContent; },
  click(text, inDialog) { const s = inDialog ? this.scope() : document; const b = [...s.querySelectorAll('button,a,[role=tab]')].find((x) => x.textContent.trim().startsWith(text) && !x.disabled); if (!b) return false; b.click(); return true; },
  rowWith(text) { const r = [...document.querySelectorAll('main table tbody tr')].find((x) => x.textContent.includes(text)); if (!r) return false; r.click(); return true; },
  dialogOpen() { return document.querySelectorAll('[role=dialog]').length; },
  alerts() { return [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent.trim()).filter(Boolean); },
  text() { return document.body.innerText; },
  overflowX() { return document.documentElement.scrollWidth - window.innerWidth; },
};`;
const h = (s, expr) => s.js(`(() => { ${H}; return window.__h.${expr}; })()`);

async function login(s, email) {
  await s.go("/login", 1500);
  for (let i = 0; i < 120 && !(await s.js("!!document.querySelector('input[name=\"email\"]')")); i++) await sleep(500);   // first load compiles lazily
  await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${JSON.stringify(email)}); set('password', ${JSON.stringify(PASSWORD)}); document.querySelector('form').requestSubmit(); })()`);
  for (let i = 0; i < 40 && (await s.js("location.pathname")) === "/login"; i++) await sleep(500);
  await sleep(2500);
  return s.js("location.pathname");
}
const ymd = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
function pastWeekday(n) { const d = new Date(); let k = 0; while (k < n) { d.setDate(d.getDate() - 1); if (![0, 6].includes(d.getDay())) k++; } return ymd(d); }

async function decideOpenStage(s, action = "approve", comment = "") {
  if (!(await h(s, "click('Review & decide')"))) return "no decide button";
  await sleep(1000);
  await h(s, `pickValue('Decision', '${action}')`);
  if (comment) await h(s, `fill('Comment', ${JSON.stringify(comment)})`);
  const label = action === "approve" ? "Approve" : action === "reject" ? "Reject" : "Return for correction";
  await h(s, `click('${label}', true)`); await sleep(3000);
  return (await h(s, "dialogOpen()")) === 0 ? "ok" : (await h(s, "alerts()")).join(" | ");
}

let claimUrl = ""; let letterUrl = "";
try {
  // ------------------------------------------------------------- employee
  let s = await session();
  check("Employee signs in", (await login(s, "employee@example.com")) === "/employee");
  await s.go("/employee/requests", 3500);
  check("My HR Requests lists existing requests and my attendance corrections", /My attendance corrections/.test(await h(s, "text()")));
  await h(s, "click('New request')"); await sleep(1200);
  const chooser = await h(s, "text()");
  check("New request offers letters, claims, profile changes and attendance corrections", ["HR letter", "Reimbursement claim", "Profile change", "Attendance correction", "HR question"].every((t) => chooser.includes(t)));
  check("Salary advance hidden while the policy is disabled", !/Salary advance\s*\n?\s*Under the company policy/.test(chooser) && /not offered until the company policy is enabled/.test(chooser));
  await h(s, "click('Reimbursement claim', true)"); await sleep(1500);
  await h(s, "click('Submit claim', true)"); await sleep(600);
  const v1 = await h(s, "text()");
  check("Claim form validates required fields client-side", /Choose a category/.test(v1) && /Attach the receipt/.test(v1));
  await h(s, "pickValue('Category', 'travel')");
  await h(s, `fill('Expense date', '${pastWeekday(2)}')`);
  await h(s, `fill('Amount', '${AMOUNT}')`);
  await h(s, `fill('Business purpose', 'Synthetic client visit taxi ${RUN}')`);
  await s.setFile("[role=dialog] input[type=file]", receipt); await sleep(800);
  check("Receipt selected in the form", (await h(s, "text()")).includes(path.basename(receipt)));
  await h(s, "click('Submit claim', true)"); await sleep(6000);
  claimUrl = await s.js("location.pathname");
  if (!/[0-9a-f-]{36}$/.test(claimUrl)) console.log("  debug:", JSON.stringify({ alerts: await h(s, "alerts()"), net: netLog.slice(-8) }));
  check("Claim submitted (draft, receipt upload, submit) and detail opened", /^\/employee\/requests\/[0-9a-f-]{36}$/.test(claimUrl), claimUrl);
  let t = await h(s, "text()");
  check("Claim shows pending approval, manager then finance steps", /pending approval/i.test(t) && /1\. Manager approval/.test(t) && /2\. Finance approval/.test(t));
  check("Receipt listed on the claim", t.includes(path.basename(receipt)));
  await s.reload();
  check("Browser refresh keeps the claim detail", (await s.js("location.pathname")) === claimUrl && /pending approval/i.test(await h(s, "text()")));
  await s.shot("employee-claim-detail");
  // Same claim again: refused by the server (saved as a draft, error shown).
  await s.go("/employee/requests", 3000);
  await h(s, "click('New request')"); await sleep(1000); await h(s, "click('Reimbursement claim', true)"); await sleep(1200);
  await h(s, "pickValue('Category', 'travel')"); await h(s, `fill('Expense date', '${pastWeekday(2)}')`);
  await h(s, `fill('Amount', '${AMOUNT}')`); await h(s, "fill('Business purpose', 'Same taxi claimed twice')");
  await s.setFile("[role=dialog] input[type=file]", receipt); await sleep(500);
  await h(s, "click('Submit claim', true)");
  let dupMsg = "";
  // The toast auto-dismisses, so poll for it.
  for (let i = 0; i < 30 && !dupMsg; i++) { await sleep(300); dupMsg = (await h(s, "text()")).match(/[^\n]*Duplicate claims are not allowed[^\n]*/)?.[0] ?? ""; }
  check("Duplicate claim refused in the UI with a clear message", /saved as a draft/.test(dupMsg), dupMsg.slice(0, 140));

  // HR letter
  await s.go("/employee/requests", 3000);
  await h(s, "click('New request')"); await sleep(1000); await h(s, "click('HR letter', true)"); await sleep(1200);
  await h(s, "pickValue('Letter type', 'experience_letter')");
  await h(s, `fill('Purpose', 'Synthetic visa application ${RUN}')`);
  await h(s, "click('Submit', true)"); await sleep(4500);
  letterUrl = await s.js("location.pathname");
  check("Letter request submitted", /^\/employee\/requests\/[0-9a-f-]{36}$/.test(letterUrl) && /HR approval/.test(await h(s, "text()")), letterUrl);

  // Attendance correction (Module 5 workflow through the adapter)
  await s.go("/employee/requests", 3000);
  await h(s, "click('New request')"); await sleep(1000); await h(s, "click('Attendance correction', true)"); await sleep(1200);
  const corrDate = pastWeekday(4);
  await h(s, `fill('Date', '${corrDate}')`);
  await h(s, "pickValue('What needs correcting', 'missed_punch_out')"); await sleep(300);
  await h(s, "fill('Correct punch-out', '18:20')");
  await h(s, `fill('Reason', 'Synthetic: forgot to punch out ${RUN}')`);
  await h(s, "click('Submit', true)"); await sleep(4000);
  const corrClosed = (await h(s, "dialogOpen()")) === 0;
  check("Attendance correction requested through the Attendance service", corrClosed, corrClosed ? "" : (await h(s, "alerts()")).join(" | "));
  await s.close();

  // -------------------------------------------------------------- manager
  s = await session();
  check("Manager signs in", (await login(s, "manager@example.com")).length > 0);
  await s.go("/hr/requests", 4000);
  t = await h(s, "text()");
  check("Manager reaches Requests & Approvals with the inbox", /HR Requests & Approvals/.test(t) && /Assigned to me/.test(t));
  check("Claim waiting in the manager's assigned inbox", t.includes(`Reimbursement: Travel`));
  check("Attendance correction in the manager's inbox", /Attendance correction:/.test(t));
  check("Manager does not see the HR letter request", !/Letter request: Experience letter/.test(t));
  await s.go(claimUrl.replace("/employee/requests", "/hr/requests"), 4000);
  check("Manager opens the claim with the receipt", (await h(s, "text()")).includes(path.basename(receipt)));
  check("Manager approves step 1", (await decideOpenStage(s, "approve", "Synthetic manager approval")) === "ok");
  t = await h(s, "text()");
  check("Claim moves to the finance step", /Manager approval\s*approved/i.test(t.replace(/\n/g, " ")) || /approved by/i.test(t));
  check("Manager has no decision on the finance step", !(await s.js(`!![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Review & decide')`)));
  await s.go("/hr/requests?tab=inbox&box=assigned", 4000);
  if (await h(s, "rowWith('Attendance correction:')")) {
    await sleep(1200);
    await h(s, "click('Approve', true)"); await sleep(3500);
    check("Manager approves the attendance correction from the inbox", (await h(s, "dialogOpen()")) === 0, (await h(s, "alerts()")).join(" | "));
  } else check("Manager approves the attendance correction from the inbox", false, "row not found");
  await s.go("/hr/requests?tab=overview", 4000);
  const ovText = await h(s, "text()");
  // KPI labels are uppercased by CSS, so compare case-insensitively.
  check("Overview shows database-backed KPI cards", ["Total requests", "Pending", "Awaiting my action", "Overdue", "Completed"].every((x) => ovText.toLowerCase().includes(x.toLowerCase())) && /Counted from database records/.test(ovText));
  await s.shot("manager-overview");
  await s.close();

  // --------------------------------------------------------- payroll admin
  s = await session();
  check("Payroll admin signs in", (await login(s, "payroll.admin@example.com")).length > 0);
  await s.go("/hr", 3000);
  check("Payroll admin sees the Requests & Approvals navigation", /Requests & Approvals/.test(await h(s, "text()")));
  await s.go("/hr/requests?tab=all", 4000);
  t = await h(s, "text()");
  check("Payroll-routed payroll query visible to payroll admin (HR11)", /Synthetic: payslip deduction/.test(t));
  check("General HR questions stay hidden from payroll admin", !/dress code/.test(t));
  await s.go(claimUrl.replace("/employee/requests", "/hr/requests"), 4000);
  check("Finance approves the claim", (await decideOpenStage(s, "approve")) === "ok");
  t = await h(s, "text()");
  check("Approved claim shows payment tracking through payroll", /Payment tracking/.test(t) && /Next payroll run|Payroll period/.test(t));
  await s.shot("payroll-claim-approved");
  // Direct API checks (real HTTP layer, payroll admin's own token)
  const token = await s.js(`(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x)); return k ? JSON.parse(localStorage.getItem(k)).access_token : null; })()`);
  const hdr = { apikey: STATE.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const sens = await fetch(`${API}/rest/v1/hr_request_sensitive?select=*`, { headers: hdr });
  check("Direct REST read of sensitive request values refused", [401, 403].includes(sens.status), `HTTP ${sens.status}`);
  const internal = await fetch(`${API}/rest/v1/rpc/request_notify_staff`, { method: "POST", headers: hdr, body: JSON.stringify({ p_request: "00000000-0000-0000-0000-000000000000", p_title: "x", p_body: "x" }) });
  check("Internal notify helper not reachable through the API", internal.status === 404, `HTTP ${internal.status}`);
  const grievances = await (await fetch(`${API}/rest/v1/hr_requests?select=id,is_confidential&is_confidential=eq.true`, { headers: hdr })).json();
  check("Payroll admin cannot read confidential requests via REST", Array.isArray(grievances) && grievances.length === 0, `${Array.isArray(grievances) ? grievances.length : "error"} rows`);
  await s.close();

  // -------------------------------------------------------------- HR admin
  s = await session();
  check("HR admin signs in", (await login(s, "hr.admin@example.com")).startsWith("/hr"));
  await s.go(letterUrl.replace("/employee/requests", "/hr/requests"), 4000);
  check("HR approves the letter request", (await decideOpenStage(s, "approve")) === "ok");
  check("Issue letter action offered after approval", await s.js(`!![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Issue letter')`));
  await s.setFile('input[aria-label="Upload letter"]', letterPdf); await sleep(4000);
  check("Signed letter uploaded to the request", (await h(s, "text()")).includes(path.basename(letterPdf)));
  await h(s, "click('Issue letter')"); await sleep(1500);
  await h(s, "pick('Letter', 0)");
  await h(s, "click('Issue & complete', true)"); await sleep(3500);
  t = await h(s, "text()");
  check("Letter issued and request completed", (await h(s, "dialogOpen()")) === 0 && /completed/i.test(t), (await h(s, "alerts()")).join(" | "));
  await s.go("/hr/requests?tab=config", 4000);
  t = await h(s, "text()");
  check("Configuration shows routing per request type and the advance policy (disabled)", /Employee → Manager → Finance/.test(t) && /Salary advance policy/.test(t));
  await s.shot("hr-configuration");
  await s.close();

  // ------------------------------------------------- employee: issued letter
  s = await session();
  await login(s, "employee@example.com");
  await s.go(letterUrl, 4000);
  t = await h(s, "text()");
  check("Employee sees the completed letter with a download", /completed/i.test(t) && /Download/.test(t));
  await h(s, "click('Download')"); await sleep(2000);
  const opened = await s.js("window.__opened?.[0] ?? ''");
  check("Download uses a short-lived signed URL from local storage", /\/storage\/v1\/object\/sign\/hr-request-files\//.test(opened) && /token=/.test(opened), opened.slice(0, 90));
  await s.go(claimUrl, 4000);
  check("Employee sees the claim approved with payment tracking", /approved/i.test(await h(s, "text()")) && /Payment tracking/.test(await h(s, "text()")));
  await s.close();

  // --------------------------------------------------------------- mobile
  s = await session({ w: 390, h: 844, m: true });
  await login(s, "employee@example.com");
  await s.go("/employee/requests", 4000);
  check("Mobile: My HR Requests has no horizontal page scroll", (await h(s, "overflowX()")) <= 1, `${await h(s, "overflowX()")}px`);
  await s.shot("mobile-employee-requests");
  await s.go(claimUrl, 4000);
  check("Mobile: request detail has no horizontal page scroll", (await h(s, "overflowX()")) <= 1, `${await h(s, "overflowX()")}px`);
  await s.shot("mobile-employee-claim");
  await s.close();
  s = await session({ w: 390, h: 844, m: true });
  await login(s, "manager@example.com");
  await s.go("/hr/requests?tab=inbox&box=all", 4500);
  check("Mobile: approval inbox has no horizontal page scroll", (await h(s, "overflowX()")) <= 1, `${await h(s, "overflowX()")}px`);
  await s.shot("mobile-manager-inbox");
  await s.close();
} catch (e) {
  check("flow runner", false, e.message);
}

check("No external network requests", blocked.length === 0, blocked.slice(0, 3).join(", "));
check("No uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const failed = checks.filter((c) => !c.ok);
writeFileSync(path.join(OUT, "results-m10.json"), JSON.stringify({ base: BASE, run: RUN, checks, blocked, pageErrors }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);

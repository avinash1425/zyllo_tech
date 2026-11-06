#!/usr/bin/env node
// TEST-ONLY scripted UI workflows against the local HRMS harness. Writes go to
// the throwaway local cluster only. NETWORK GUARD: non-local hosts are blocked.
// Usage: node scripts/hrms-local/browser-flows.mjs --out <dir> [--base http://127.0.0.1:8090]
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readHarnessState, outputDir } from "./lib.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const HARNESS = readHarnessState(); // honours --state / HRMS_LOCAL_INSTANCE
const BASE = arg("--base", `http://127.0.0.1:${HARNESS?.webPort ?? 8090}`);
const OUT = arg("--out", path.join(outputDir("hrms-flows")));
mkdirSync(path.join(OUT, "shots"), { recursive: true });
const PASSWORD = "Local-Test-Only-2026!";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const blocked = [];
const errors = [];
const RUN = Date.now().toString(36);  // makes the flows re-runnable on the same harness
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

async function session(viewport = { w: 1440, h: 900, m: false }) {
  const port = 9800 + Math.floor(Math.random() * 150);
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-flow-"));
  const proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    const p = m.params;
    if (m.method === "Fetch.requestPaused") {
      const host = new URL(p.request.url).hostname;
      if (host === "127.0.0.1" || host === "localhost") send("Fetch.continueRequest", { requestId: p.requestId });
      else { blocked.push(p.request.url.slice(0, 120)); send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }); }
    }
    if (m.method === "Runtime.exceptionThrown") errors.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text).split("\n")[0]);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: viewport.w, height: viewport.h, deviceScaleFactor: 1, mobile: viewport.m });
  const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const go = async (p, wait = 3000) => { await send("Page.navigate", { url: BASE + p }); await sleep(wait); };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 }); writeFileSync(path.join(OUT, "shots", name), Buffer.from(s.data, "base64")); };
  const close = async () => { ws.close(); proc.kill(); await sleep(500); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { send, js, go, shot, close };
}

// In-page helpers (string injected into the page).
const H = `
window.__h = {
  setVal(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
  scope() { const d = [...document.querySelectorAll('[role=dialog]')]; return d[d.length - 1] || document; },
  field(label) { const s = this.scope(); const l = [...s.querySelectorAll('label')].find((x) => x.textContent.replace('*','').trim().startsWith(label)); return l && (document.getElementById(l.htmlFor) || l.querySelector('input,select,textarea')); },
  fill(label, v) { const el = this.field(label); if (!el) return false; this.setVal(el, v); return true; },
  pick(label, index) { const el = this.field(label); if (!el || el.tagName !== 'SELECT') return false; const opts = [...el.options].filter((o) => o.value && !o.disabled); if (!opts[index]) return false; this.setVal(el, opts[index].value); return opts[index].textContent; },
  click(text, inDialog) { const s = inDialog ? this.scope() : document; const b = [...s.querySelectorAll('button,a')].find((x) => x.textContent.trim().startsWith(text) && !x.disabled); if (!b) return false; b.click(); return true; },
  confirm() { const d = this.scope(); if (d === document) return false; const bs = [...d.querySelectorAll('button')].filter((b) => !/^(Cancel|Close)$/.test(b.textContent.trim()) && !b.getAttribute('aria-label')); const b = bs[bs.length - 1]; if (!b) return false; b.click(); return b.textContent.trim(); },
  dialogOpen() { return document.querySelectorAll('[role=dialog]').length; },
  alerts() { return [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent.trim()).filter(Boolean); },
  toasts() { return [...document.querySelectorAll('[aria-live=polite] [role=status]')].map((t) => t.textContent.trim()); },
  rows() { const t = document.querySelector('main table tbody'); return t ? [...t.querySelectorAll('tr')].filter((r) => r.querySelectorAll('td').length > 1).length : -1; },
  text() { return document.body.innerText; },
};`;

async function login(s, email) {
  await s.go("/login", 2500);
  await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${JSON.stringify(email)}); set('password', ${JSON.stringify(PASSWORD)}); document.querySelector('form').requestSubmit(); })()`);
  await sleep(4000);
  return s.js("location.pathname");
}
const h = (s, expr) => s.js(`(() => { ${H}; return window.__h.${expr}; })()`);

async function nextWeekday(offset = 7) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
}

try {
  // ------------------------------------------------ HR admin: Employee Master
  let s = await session();
  check("HR admin signs in and lands in HR Operations", (await login(s, "hr.admin@example.com")).startsWith("/hr"));
  await s.go("/hr/employees", 3500);
  const all = await h(s, "rows()");
  check("Employee list shows synthetic employees", all > 10, `${all} rows`);
  await s.js(`(() => { ${H}; const i = document.querySelector('input[aria-label="Search employees"]'); __h.setVal(i, 'Engineer 0'); })()`); await sleep(2500);
  const filtered = await h(s, "rows()");
  check("Search filters the list server-side", filtered > 0 && filtered < all, `${all} → ${filtered}`);
  await s.js(`(() => { ${H}; __h.setVal(document.querySelector('input[aria-label="Search employees"]'), ''); __h.setVal(document.querySelector('select[aria-label="Employment type"]'), 'intern'); })()`); await sleep(2500);
  const interns = await h(s, "rows()");
  check("Employment-type filter (intern)", interns >= 1 && interns < all, `${interns} rows`);
  await s.js(`(() => { ${H}; __h.setVal(document.querySelector('select[aria-label="Employment type"]'), ''); })()`); await sleep(2000);
  await h(s, "click('Add employee')"); await sleep(1500);
  check("Add employee opens a modal dialog", (await h(s, "dialogOpen()")) === 1);
  await h(s, "click('Create employee', true)"); await sleep(800);
  const v = await h(s, "text()");
  check("Empty form shows field validation messages", /First name is required/.test(v) && /Company email is required/.test(v));
  await h(s, "fill('Company email', 'not-an-email')"); await h(s, "click('Create employee', true)"); await sleep(600);
  check("Invalid email rejected client-side", /Enter a valid email address/.test(await h(s, "text()")));
  await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" }); await sleep(600);
  check("Escape closes the dialog", (await h(s, "dialogOpen()")) === 0);
  await h(s, "click('Add employee')"); await sleep(1200);
  await h(s, "fill('First name', 'Demo')"); await h(s, "fill('Last name', 'Flowtest')"); await h(s, `fill('Company email', 'demo.flowtest.${RUN}@example.com')`);
  await h(s, "pick('Department', 0)");
  await h(s, "click('Create employee', true)"); await sleep(3500);
  const url = await s.js("location.pathname");
  check("Create employee succeeds and opens the profile", /^\/hr\/employees\/[0-9a-f-]{36}$/.test(url), url);
  check("Generated employee ID shown (ZT-NNNN)", /ZT-\d{4}/.test(await h(s, "text()")));
  await s.shot("flow-hr-employee-created.jpg");
  await h(s, "click('Access & roles')"); await sleep(1200);
  check("Invite button available for a new employee", await h(s, "click('Send secure invitation')")); await sleep(1000);
  const conf = await h(s, "confirm()"); await sleep(3500);
  check("Invitation via Edge Function stand-in succeeds", /Invitation sent/.test((await h(s, "toasts()")).join(" ")) || /linked/.test(await h(s, "text()")), `confirm=${conf}`);
  await s.go("/hr/employees", 3000);
  await h(s, "click('Add employee')"); await sleep(1200);
  await h(s, "fill('First name', 'Dup')"); await h(s, `fill('Company email', 'demo.flowtest.${RUN}@example.com')`); await h(s, "click('Create employee', true)"); await sleep(2500);
  check("Duplicate company email rejected by the server with a message", (await h(s, "alerts()")).some((a) => /exists|duplicate/i.test(a)), (await h(s, "alerts()")).join(" | ").slice(0, 120));
  await s.go("/hr/settings", 3000);
  check("HR Settings renders tabs for HR admin", (await s.js("document.querySelectorAll('main [role=tab]').length")) >= 8);
  await s.go("/hr/payroll", 3000);
  check("HR admin cannot open Payroll (no payroll permission)", !/Payroll runs|New run|Create run/i.test(await h(s, "text()")), await s.js("location.pathname"));
  await s.close();

  // ------------------------------------------------ Employee: attendance, leave, requests, isolation
  s = await session();
  check("Employee signs in and lands in the Employee Portal", (await login(s, "employee@example.com")) === "/employee");
  await s.go("/employee/attendance", 3500);
  const canIn = await s.js(`![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Check in')?.disabled`);
  if (canIn) {
    await h(s, "click('Check in')"); await sleep(1000);
    await h(s, "confirm()"); await sleep(3000);
    check("Check in records attendance with server time", /checked in|Checked in/i.test((await h(s, "toasts()")).join(" ") + (await h(s, "text()"))));
    check("Check in disabled after checking in (no duplicate session)", await s.js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Check in')?.disabled === true`));
  } else {
    check("Check in already recorded today (button disabled)", true, "fixture already checked in");
  }
  await s.shot("flow-employee-attendance.jpg");
  await s.go("/employee/leave", 3500);
  await h(s, "click('Apply for leave')"); await sleep(1200);
  await h(s, "click('Submit request', true)"); await sleep(700);
  check("Leave form validates required fields", (await h(s, "text()")).match(/required|Choose|Enter/i) !== null);
  const day = await nextWeekday(10 + (Date.now() % 40));
  const typ = await h(s, "pick('Leave type', 0)");
  await h(s, `fill('From', '${day}')`); await h(s, `fill('To', '${day}')`); await h(s, "fill('Reason', 'Synthetic leave request from browser flow test')");
  await sleep(1500);
  await h(s, "click('Submit request', true)"); await sleep(3500);
  const leaveOk = (await h(s, "dialogOpen()")) === 0;
  check("Leave application submitted (pending approval)", leaveOk, `${typ} on ${day}; alerts=${(await h(s, "alerts()")).join(" | ").slice(0, 120)}`);
  await s.shot("flow-employee-leave.jpg");
  await s.go("/employee/requests", 3000);
  await h(s, "click('New request')"); await sleep(1200);
  await h(s, "pick('Category', 0)"); await h(s, "fill('Subject', 'Synthetic request from flow test')"); await h(s, "fill('Description', 'Please confirm the synthetic test request was received.')");
  await h(s, "confirm()"); await sleep(3500);
  check("HR request created by employee", /Synthetic request from flow test/.test(await h(s, "text()")) || (await s.js("location.pathname")).match(/\/employee\/requests\/[0-9a-f-]{36}/) !== null);
  await s.go("/hr/employees", 3000);
  check("Employee is refused HR Operations", /Not authorised/.test(await h(s, "text()")));
  await s.go("/employee/payslips?tab=payslips", 3500);
  const myPayslips = await h(s, "rows()");
  check("Employee sees own payslips", myPayslips >= 1, `${myPayslips} rows`);
  const txt = await h(s, "text()");
  check("Employee payslip page shows no other employee's name", !/Demo Designer|Demo Engineer 0[1245]/.test(txt));
  await s.close();

  // ------------------------------------------------ Manager: approve the employee's leave
  s = await session();
  check("Manager signs in (routed to HR area for team scope)", (await login(s, "manager@example.com")).startsWith("/hr"));
  await s.go("/hr/leave", 3500);
  const mt = await h(s, "text()");
  check("Manager approvals queue shows the team member's request", /Demo Engineer 03|Engineer 03/.test(mt));
  check("Manager does not see other teams' requests", !/Demo Designer/.test(mt));
  await s.shot("flow-manager-leave.jpg");
  await s.go("/hr/employees", 3000);
  const teamRows = await h(s, "rows()");
  check("Manager employee list limited to reporting line", teamRows > 0 && teamRows < all, `${teamRows} of ${all}`);
  await s.close();

  // ------------------------------------------------ Super admin: pagination on the audit log
  s = await session();
  await login(s, "superadmin@example.com");
  await s.go("/hr/settings", 3500);
  await s.js(`[...document.querySelectorAll('main [role=tab]')].find((t) => t.textContent.includes('Audit log'))?.click()`); await sleep(3000);
  const p1 = await s.js(`document.querySelector('main')?.innerText.match(/Page (\\d+) of (\\d+) · (\\d+) records/)?.slice(1).join('/')`);
  check("Audit log paginates (50 per page, server-side count)", Boolean(p1) && Number(p1.split("/")[1]) > 1, p1 ?? "no pager");
  await s.js(`document.querySelector('button[aria-label="Next page"]')?.click()`); await sleep(2500);
  const p2 = await s.js(`document.querySelector('main')?.innerText.match(/Page (\\d+) of/)?.[1]`);
  check("Next page loads page 2", p2 === "2", `page ${p2}`);
  await s.js(`document.querySelector('main table tbody tr')?.click()`); await sleep(1000);
  check("Audit entry detail opens in a dialog", (await h(s, "dialogOpen()")) === 1);
  await s.shot("flow-audit-log-page2.jpg");
  await s.close();

  // ------------------------------------------------ Employee: interviews page (lazy chunk) renders
  s = await session();
  await login(s, "employee@example.com");
  await s.go("/employee/interviews", 9000);
  const iv = await h(s, "text()");
  check("Employee 'My interviews' page renders (not stuck loading)", /My interviews/.test(iv) && !/^\s*Loading/.test(iv), iv.slice(0, 80).replace(/\s+/g, " "));
  await s.close();

  // ------------------------------------------------ Mobile navigation
  s = await session({ w: 390, h: 844, m: true });
  await login(s, "employee@example.com");
  await s.go("/employee", 3000);
  await s.js(`document.querySelector('button[aria-label="Open navigation"]')?.click()`); await sleep(800);
  const navVisible = await s.js(`(() => { const a = document.querySelector('aside'); return a && a.getBoundingClientRect().left >= 0; })()`);
  check("Mobile: navigation drawer opens", navVisible);
  await s.js(`[...document.querySelectorAll('aside nav a')].find((a) => a.textContent.includes('My Leave'))?.click()`); await sleep(2500);
  check("Mobile: drawer link navigates and closes drawer", (await s.js("location.pathname")) === "/employee/leave" && await s.js(`document.querySelector('aside').getBoundingClientRect().left < 0`));
  check("Mobile: no horizontal page overflow", (await s.js("document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 0);
  await s.shot("flow-mobile-leave.jpg");
  await s.close();
} finally {
  writeFileSync(path.join(OUT, "flows.json"), JSON.stringify({ checks, blocked, exceptions: errors }, null, 2));
  console.log(`\n${checks.filter((c) => c.ok).length} passed, ${checks.filter((c) => !c.ok).length} failed; external requests blocked: ${blocked.length}; page exceptions: ${errors.length}`);
}

#!/usr/bin/env node
// TEST-ONLY Module 5 (Attendance & Time) UI workflows against a local HRMS
// harness. Writes go to the throwaway local cluster only. NETWORK GUARD:
// non-local hosts are blocked. Synthetic accounts only.
// Usage: node scripts/hrms-local/browser-flows-m5-attendance.mjs --base http://127.0.0.1:8097 --out <dir>
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const BASE = arg("--base", "http://127.0.0.1:8090");
const OUT = arg("--out", path.join(tmpdir(), "hrms-m5-flows"));
mkdirSync(path.join(OUT, "shots"), { recursive: true });
const PASSWORD = "Local-Test-Only-2026!";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const blocked = [];
const errors = [];
const RUN = Date.now().toString(36);
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

async function session(viewport = { w: 1440, h: 900, m: false }) {
  // Port 0: Chrome picks a free port and writes it to <profile>/DevToolsActivePort.
  // Reading it from our own fresh profile guarantees we attach only to the Chrome
  // we launched (never another session's headless browser).
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-m5-flow-"));
  const proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let port, target;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try {
      port ??= Number(readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]) || undefined;
      if (port) target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page" && t.url === "about:blank");
    } catch {}
  }
  if (!target) { proc.kill(); throw new Error("Could not attach to the headless Chrome launched by this script."); }
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
  // Navigate, then wait until the routed page has rendered (not the lazy-load spinner), up to ~40s.
  const go = async (p, wait = 3000) => {
    await send("Page.navigate", { url: BASE + p }); await sleep(Math.min(wait, 1500));
    for (let i = 0; i < 80; i++) {
      const ready = await js("Boolean(document.querySelector('main h1, form input[name=\"email\"]')) && !/^\s*Loading/.test(document.querySelector('main')?.innerText || '')").catch(() => false);
      if (ready) break; await sleep(500);
    }
    await sleep(Math.max(wait - 1500, 1000));
  };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 }); writeFileSync(path.join(OUT, "shots", name), Buffer.from(s.data, "base64")); };
  const close = async () => { ws.close(); proc.kill(); await sleep(500); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { send, js, go, shot, close };
}

const H = `
window.__h = {
  setVal(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
  scope() { const d = [...document.querySelectorAll('[role=dialog]')]; return d[d.length - 1] || document; },
  field(label) { const s = this.scope(); const l = [...s.querySelectorAll('label')].find((x) => x.textContent.replace('*','').trim().startsWith(label)); return l && (document.getElementById(l.htmlFor) || l.querySelector('input,select,textarea')); },
  fill(label, v) { const el = this.field(label); if (!el) return false; this.setVal(el, v); return true; },
  pickText(label, re) { const el = this.field(label); if (!el) return false; const o = [...el.options].find((x) => new RegExp(re).test(x.textContent)); if (!o) return false; this.setVal(el, o.value); return o.textContent; },
  pick(label, index) { const el = this.field(label); if (!el || el.tagName !== 'SELECT') return false; const opts = [...el.options].filter((o) => o.value && !o.disabled); if (!opts[index]) return false; this.setVal(el, opts[index].value); return opts[index].textContent; },
  click(text, inDialog) { const s = inDialog ? this.scope() : document; const b = [...s.querySelectorAll('button,a,[role=tab]')].find((x) => x.textContent.trim().startsWith(text) && !x.disabled); if (!b) return false; b.click(); return true; },
  confirm() { const d = this.scope(); if (d === document) return false; const bs = [...d.querySelectorAll('button')].filter((b) => !/^(Cancel|Close)$/.test(b.textContent.trim()) && !b.getAttribute('aria-label')); const b = bs[bs.length - 1]; if (!b) return false; b.click(); return b.textContent.trim(); },
  dialogOpen() { return document.querySelectorAll('[role=dialog]').length; },
  alerts() { return [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent.trim()).filter(Boolean); },
  toasts() { return [...document.querySelectorAll('[aria-live=polite] [role=status]')].map((t) => t.textContent.trim()); },
  rows() { const t = document.querySelector('main table tbody'); return t ? [...t.querySelectorAll('tr')].filter((r) => r.querySelectorAll('td').length > 1).length : -1; },
  rowAction(match, label) { const tr = [...document.querySelectorAll('main table tbody tr')].find((r) => r.textContent.includes(match)); if (!tr) return false; const b = [...tr.querySelectorAll('button')].find((x) => x.textContent.trim() === label); if (!b) return false; b.click(); return true; },
  hscroll() { return document.documentElement.scrollWidth - window.innerWidth; },
  text() { return document.body.innerText; },
};`;
const h = (s, expr) => s.js(`(() => { ${H}; return window.__h.${expr}; })()`);

async function login(s, email) {
  // Wait for the form (cold Vite / busy machine), submit, then wait for the redirect.
  await s.go("/login", 1500);
  for (let i = 0; i < 60; i++) { if (await s.js("Boolean(document.querySelector('input[name=\"email\"]'))")) break; await sleep(500); }
  await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${JSON.stringify(email)}); set('password', ${JSON.stringify(PASSWORD)}); document.querySelector('form').requestSubmit(); })()`);
  for (let i = 0; i < 60; i++) { await sleep(500); if (!/\/login/.test(await s.js("location.pathname"))) break; }
  await sleep(1500);
  return s.js("location.pathname");
}

// First weekday of the current month: inside the correction window and not in
// the fixtures' finalized (locked) payroll month; the fixture's own pending
// correction is on a later day.
function regDate() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
}
const REG_DATE = regDate();
const TAG = `M5 flow ${RUN}`;
const futureDate = (min, span) => { const d = new Date(); d.setDate(d.getDate() + min + Math.floor(Math.random() * span)); return d.toLocaleDateString("en-CA"); };
// Strictly increasing across runs (minutes since 2026-11-01): a later open-ended assignment ends the earlier one.
const ASSIGN_FROM = (() => { const d = new Date(); d.setDate(d.getDate() + 1 + Math.floor((Date.now() - Date.UTC(2026, 10, 1)) / 60000) % 20000); return d.toLocaleDateString("en-CA"); })();
const HOLIDAY_DATE = futureDate(30, 300); // this year or next (both selectable)

try {
  // ------------------------------------------------ Employee portal
  let s = await session();
  check("Employee signs in", (await login(s, "employee@example.com")) === "/employee");
  await s.go("/employee/attendance", 4500);
  let t = await h(s, "text()");
  check("My Attendance shows shift card", /My shift/.test(t));
  check("My Attendance shows upcoming holidays", /Upcoming holidays/.test(t));
  check("Monthly totals strip rendered (server summary)", /Expected/i.test(t) && /Weekly offs/i.test(t));
  check("Attendance calendar rendered", (await s.js("document.querySelectorAll('ol[aria-label=\"Attendance calendar\"] li').length")) >= 28);
  const canIn = await s.js(`![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Check in')?.disabled`);
  if (canIn) {
    await h(s, "click('Check in')"); await sleep(1000); await h(s, "confirm()"); await sleep(3500);
    check("Punch in recorded (server time)", /Checked in at/.test((await h(s, "toasts()")).join(" ")) || /You are checked in/.test(await h(s, "text()")));
  } else {
    check("Punch in already recorded today by fixtures", /checked in|checked out/i.test(await h(s, "text()")));
  }
  check("Check in disabled after punching in (duplicate prevention)", await s.js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Check in')?.disabled === true`));
  check("Today's working hours shown", /Today's working hours/i.test(await h(s, "text()")));
  await s.send("Page.reload"); await sleep(4500);
  check("Browser refresh: punch state persists", await s.js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Check in')?.disabled === true`));
  await s.shot("m5-employee-attendance-desktop.jpg");
  await h(s, "click('Weekly hours')"); await sleep(800);
  check("Weekly hours view lists weeks", (await h(s, "rows()")) >= 4);
  await h(s, "click('Punch history')"); await sleep(2000);
  check("Punch history lists today's punch", (await h(s, "rows()")) >= 1);
  await h(s, "click('Calendar')"); await sleep(500);

  await h(s, "click('Request regularization')"); await sleep(1200);
  check("Regularization modal opens", (await h(s, "dialogOpen()")) === 1);
  await h(s, `fill('Attendance date', '${REG_DATE}')`); await sleep(300);
  await h(s, "fill('Request type', 'status_correction')"); await sleep(300);
  await h(s, "fill('Requested status', 'present')");
  await h(s, "click('Submit request', true)"); await sleep(800);
  check("Reason is required client-side", /Explain the request/.test(await h(s, "text()")));
  await h(s, `fill('Reason', 'Client site visit (${TAG})')`);
  await h(s, "fill('Supporting evidence', 'Visit report VR-001')");
  await h(s, "click('Submit request', true)"); await sleep(3000);
  check("Regularization submitted", /submitted for approval/.test((await h(s, "toasts()")).join(" ")), (await h(s, "alerts()")).join(" | "));
  check("Request listed with manager review stage", /Manager review/i.test(await s.js(`[...document.querySelectorAll('main table tbody tr')].find((r) => r.textContent.includes(${JSON.stringify(TAG)}))?.textContent || ''`)));
  await h(s, "click('Request regularization')"); await sleep(1000);
  await h(s, `fill('Attendance date', '${REG_DATE}')`); await sleep(300);
  await h(s, "fill('Request type', 'status_correction')");
  await h(s, `fill('Reason', 'Duplicate (${TAG})')`);
  await h(s, "click('Submit request', true)"); await sleep(2500);
  check("Duplicate active request rejected by the server", (await h(s, "alerts()")).some((a) => /pending correction/i.test(a)), (await h(s, "alerts()")).join(" | ").slice(0, 120));
  await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" }); await sleep(500);
  await s.go("/hr/attendance", 3500);
  check("Employee cannot open HR attendance", !/Pending corrections|Working hours/i.test(await h(s, "text()")), await s.js("location.pathname"));
  await s.close();

  // mobile
  s = await session({ w: 390, h: 844, m: true });
  check("Mobile: employee signs in", (await login(s, "employee@example.com")).startsWith("/employee"), await s.js("location.pathname"));
  await s.go("/employee/attendance", 4500);
  check("Mobile: no horizontal page scroll on My Attendance", (await h(s, "hscroll()")) <= 1, `${await h(s, "hscroll()")}px`);
  await s.shot("m5-employee-attendance-mobile.jpg");
  await s.close();

  // ------------------------------------------------ Manager
  s = await session();
  check("Manager signs in", (await login(s, "manager@example.com")).startsWith("/hr"));
  await s.go("/hr/attendance", 5000);
  t = await h(s, "text()");
  check("Manager overview renders KPIs", /Pending corrections/i.test(t) && /Missing punch-out/i.test(t));
  const mgrRows = await h(s, "rows()");
  check("Manager overview lists team only", mgrRows > 0 && mgrRows < 15, `${mgrRows} rows`);
  await s.shot("m5-manager-overview.jpg");
  await s.go("/hr/attendance?tab=corrections", 4000);
  check("Manager sees the employee's request", /Client site visit/.test(await h(s, "text()")));
  check("Approve button shown", await h(s, `rowAction(${JSON.stringify(TAG)}, 'Approve')`)); await sleep(1000);
  await h(s, "confirm()"); await sleep(3500);
  check("Manager approval applied", /approved/i.test((await h(s, "toasts()")).join(" ")), (await h(s, "alerts()")).join(" | "));
  await s.close();

  s = await session();
  await login(s, "employee2@example.com");
  await s.go("/employee/attendance", 4000);
  check("Other employee does not see the request", !(await h(s, "text()")).includes(TAG));
  await s.close();

  // ------------------------------------------------ HR admin
  s = await session();
  check("HR admin signs in", (await login(s, "hr.admin@example.com")).startsWith("/hr"));
  await s.go(`/hr/attendance?tab=daily&date=${REG_DATE}`, 5000);
  const hrRows = await h(s, "rows()");
  check("HR overview lists all employees (more than manager)", hrRows > mgrRows, `${hrRows} vs ${mgrRows}`);
  check("Overview honours ?date= deep link", await s.js(`[...document.querySelectorAll('input[type=date]')].some((i) => i.value === '${REG_DATE}')`));
  await s.shot("m5-hr-overview.jpg");
  await h(s, "click('Working hours')"); await sleep(4500);
  check("Working hours summary renders", (await h(s, "rows()")) > 5 && /Expected/i.test(await h(s, "text()")));
  await s.shot("m5-hr-working-hours.jpg");

  await h(s, "click('Shifts')"); await sleep(3000);
  await h(s, "click('New shift')"); await sleep(1000);
  await h(s, `fill('Name', 'M5 Flow Night ${RUN}')`); await h(s, "fill('Start', '22:00')"); await h(s, "fill('End', '06:00')"); await sleep(300);
  check("Overnight hint shown in shift form", /overnight shift/.test(await h(s, "text()")));
  await h(s, "click('Save shift', true)"); await sleep(3000);
  check("Shift created", /Shift created/.test((await h(s, "toasts()")).join(" ")), (await h(s, "alerts()")).join(" | "));
  await h(s, "click('Assign shift')"); await sleep(1500);
  await h(s, "pickText('Employee', 'Engineer 0[4-9]')"); await h(s, `pickText('Shift', 'M5 Flow Night ${RUN}')`);
  await h(s, `fill('Effective from', '${ASSIGN_FROM}')`);
  await h(s, `fill('Reason', '${TAG}')`);
  await h(s, "click('Assign', true)"); await sleep(3000);
  check("Shift assigned", /Shift assigned/.test((await h(s, "toasts()")).join(" ")), (await h(s, "alerts()")).join(" | "));
  check("Assignment listed", (await h(s, "text()")).includes(`M5 Flow Night ${RUN}`));
  await h(s, "click('Assign shift')"); await sleep(1500);
  await h(s, "pickText('Employee', 'Engineer 0[4-9]')"); await h(s, `pickText('Shift', 'M5 Flow Night ${RUN}')`);
  await h(s, `fill('Effective from', '${ASSIGN_FROM}')`);
  await h(s, "click('Assign', true)"); await sleep(3000);
  check("Overlapping assignment rejected", (await h(s, "alerts()")).some((a) => /overlap/i.test(a)), (await h(s, "alerts()")).join(" | ").slice(0, 120));
  await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" }); await sleep(500);
  await s.shot("m5-hr-shifts.jpg");

  await h(s, "click('Holidays')"); await sleep(3500);
  check("Holiday calendar renders", /Holiday calendar/.test(await h(s, "text()")));
  await h(s, "click('Add')"); await sleep(1000);
  await h(s, `fill('Date', '${HOLIDAY_DATE}')`); await h(s, `fill('Name', 'M5 Flow Day ${RUN}')`);
  await h(s, "click('Save', true)"); await sleep(3000);
  check("Holiday created", /created/i.test((await h(s, "toasts()")).join(" ")), (await h(s, "alerts()")).join(" | "));
  await h(s, "click('Refresh')"); await sleep(2500);
  await s.js(`(() => { ${H}; __h.setVal(document.querySelector('select[aria-label="Year"]'), '${HOLIDAY_DATE.slice(0, 4)}'); })()`); await sleep(2500);
  check("New holiday appears in calendar", (await h(s, "text()")).includes(`M5 Flow Day ${RUN}`));
  await s.shot("m5-hr-holidays.jpg");
  await s.close();

  s = await session({ w: 390, h: 844, m: true });
  check("Mobile: HR admin signs in", (await login(s, "hr.admin@example.com")).startsWith("/hr"), await s.js("location.pathname"));
  await s.go("/hr/attendance", 5000);
  check("Mobile: no horizontal page scroll on HR attendance", (await h(s, "hscroll()")) <= 1, `${await h(s, "hscroll()")}px`);
  await s.shot("m5-hr-overview-mobile.jpg");
  await s.close();

  // ------------------------------------------------ Employee sees decision
  s = await session();
  await login(s, "employee@example.com");
  await s.go("/employee/attendance", 4500);
  const rowTxt = await s.js(`[...document.querySelectorAll('main table tbody tr')].find((r) => r.textContent.includes('Client site visit'))?.textContent || ''`);
  check("Employee sees request approved", /approved/i.test(rowTxt), rowTxt.slice(0, 120));
  await s.close();
} catch (e) {
  check("flow script crashed", false, e.message);
}

check("No requests left the machine", blocked.length === 0, blocked.slice(0, 3).join(", "));
check("No uncaught page exceptions", errors.length === 0, errors.slice(0, 3).join(" | "));
writeFileSync(path.join(OUT, "m5-results.json"), JSON.stringify({ checks, blocked, errors }, null, 2));
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed. Screenshots: ${path.join(OUT, "shots")}`);
process.exit(failed ? 1 : 0);

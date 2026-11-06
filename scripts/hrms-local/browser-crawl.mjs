#!/usr/bin/env node
// TEST-ONLY browser crawler for the local HRMS harness (scripts/hrms-local).
// Signs in as each synthetic role through the real /login form, visits every
// HR / Employee route and every in-page tab, and records console errors,
// exceptions, failed API calls, visible error states, horizontal overflow and
// screenshots. NETWORK GUARD: every request to a host other than 127.0.0.1 /
// localhost is BLOCKED and logged, so live Supabase can never be reached.
//
// Usage: node scripts/hrms-local/browser-crawl.mjs --out <dir> [--base http://127.0.0.1:8090] [--roles super,employee] [--mobile]
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readHarnessState, outputDir } from "./lib.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const HARNESS = readHarnessState(); // honours --state / HRMS_LOCAL_INSTANCE
const BASE = arg("--base", `http://127.0.0.1:${HARNESS?.webPort ?? 8090}`);
const API_PORT = arg("--api-port", String(HARNESS?.apiPort ?? 54321));
const OUT = arg("--out", path.join(outputDir("hrms-crawl")));
const ONLY = arg("--roles", null)?.split(",");
const MOBILE = argv.includes("--mobile");
const PASSWORD = "Local-Test-Only-2026!";
mkdirSync(path.join(OUT, "shots"), { recursive: true });

const HR = ["/hr", "/hr/employees", "/hr/attendance", "/hr/daily-reports", "/hr/leave", "/hr/recruitment", "/hr/performance", "/hr/payroll",
  "/hr/documents", "/hr/assets", "/hr/announcements", "/hr/requests", "/hr/exits", "/hr/reports", "/hr/settings",
  "/hr/org-structure", "/hr/benefits", "/hr/training", "/hr/recruitment/interns"];
const EMP = ["/employee", "/employee/profile", "/employee/attendance", "/employee/daily-reports", "/employee/tasks", "/employee/leave",
  "/employee/payslips", "/employee/documents", "/employee/assets", "/employee/performance", "/employee/internship", "/employee/interviews",
  "/employee/announcements", "/employee/requests", "/employee/notifications", "/employee/benefits", "/employee/training"];
const ROLES = [
  { key: "super", email: "superadmin@example.com", routes: HR },
  { key: "hr", email: "hr.admin@example.com", routes: [...HR, ...EMP] },
  { key: "payroll", email: "payroll.admin@example.com", routes: [...HR, "/employee", "/employee/payslips"] },
  { key: "manager", email: "manager@example.com", routes: [...HR, ...EMP] },
  { key: "employee", email: "employee@example.com", routes: [...EMP, "/hr", "/hr/payroll"] },
  { key: "intern", email: "intern@example.com", routes: [...EMP, "/hr"] },
  { key: "noaccess", email: "noaccess@example.com", routes: ["/hr", "/employee"] },
].filter((r) => !ONLY || ONLY.includes(r.key));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_") || "root";

async function browser() {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-crawl-"));
  const proc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } else listeners.forEach((l) => l(m)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const close = async () => { ws.close(); proc.kill(); await sleep(600); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { send, on: (f) => listeners.push(f), close };
}

const results = [];
const blocked = [];
let cur = null;

async function run() {
  for (const role of ROLES) {
    for (const vp of MOBILE ? [{ n: "mobile", w: 390, h: 844, m: true }] : [{ n: "desktop", w: 1440, h: 900, m: false }]) {
      const b = await browser();
      b.on((m) => {
        const p = m.params;
        if (m.method === "Fetch.requestPaused") {
          const host = new URL(p.request.url).hostname;
          if (host === "127.0.0.1" || host === "localhost") b.send("Fetch.continueRequest", { requestId: p.requestId });
          else { blocked.push({ role: role.key, url: p.request.url.slice(0, 120) }); b.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }); }
          return;
        }
        if (!cur) return;
        if (m.method === "Runtime.exceptionThrown") cur.exceptions.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text).split("\n")[0].slice(0, 200));
        if (m.method === "Runtime.consoleAPICalled" && p.type === "error") cur.consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0].slice(0, 200));
        if (m.method === "Network.responseReceived" && p.response.url.includes(`:${API_PORT}`) && p.response.status >= 400) cur.apiErrors.push(`${p.response.status} ${p.response.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]}`);
      });
      await b.send("Page.enable"); await b.send("Runtime.enable"); await b.send("Network.enable");
      await b.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      await b.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.m });

      // ---- sign in through the real form
      cur = { role: role.key, vp: vp.n, route: "/login", exceptions: [], consoleErrors: [], apiErrors: [] };
      await b.send("Page.navigate", { url: `${BASE}/login` }); await sleep(2500);
      await b.send("Runtime.evaluate", { expression: `(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${JSON.stringify(role.email)}); set('password', ${JSON.stringify(PASSWORD)}); document.querySelector('form').requestSubmit(); })()` });
      await sleep(4000);
      const landed = (await b.send("Runtime.evaluate", { expression: "location.pathname", returnByValue: true })).result.value;
      results.push({ ...cur, kind: "login", landed });

      for (const route of role.routes) {
        cur = { role: role.key, vp: vp.n, route, exceptions: [], consoleErrors: [], apiErrors: [] };
        await b.send("Page.navigate", { url: BASE + route }); await sleep(3200);
        const info = await probe(b);
        const shot = `${role.key}-${vp.n}-${slug(route)}.jpg`;
        await screenshot(b, shot, vp);
        const entry = { ...cur, kind: "page", ...info, shot };
        entry.tabs = [];
        // click every in-page tab (role=tab) and record per-tab state
        const tabs = (await b.send("Runtime.evaluate", { returnByValue: true, expression: `[...document.querySelectorAll('main [role=tab]')].map((t) => t.textContent.trim().slice(0, 40))` })).result.value ?? [];
        for (const [i, label] of tabs.entries()) {
          if (i === 0) continue;
          const before = { e: cur.exceptions.length, c: cur.consoleErrors.length, a: cur.apiErrors.length };
          await b.send("Runtime.evaluate", { expression: `document.querySelectorAll('main [role=tab]')[${i}]?.click()` });
          await sleep(1800);
          const ti = await probe(b);
          const tshot = `${role.key}-${vp.n}-${slug(route)}-tab-${slug(label)}.jpg`;
          await screenshot(b, tshot, vp);
          entry.tabs.push({ label, alerts: ti.alerts, overflow: ti.overflow, newExceptions: cur.exceptions.slice(before.e), newConsole: cur.consoleErrors.slice(before.c), newApiErrors: cur.apiErrors.slice(before.a), shot: tshot });
        }
        results.push(entry);
      }
      cur = null;
      await b.close();
    }
  }
}

async function probe(b) {
  const r = await b.send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
    const main = document.querySelector('main') || document.body;
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      landed: location.pathname + location.search,
      title: document.title,
      heading: [...document.querySelectorAll('h1, main h2')].filter(vis).map((h) => h.textContent.trim().slice(0, 60)).slice(0, 3),
      nav: [...document.querySelectorAll('aside nav a')].map((a) => a.textContent.trim()).slice(0, 30),
      alerts: [...document.querySelectorAll('[role=alert]')].filter(vis).map((a) => a.textContent.trim().slice(0, 140)),
      loading: [...document.querySelectorAll('[role=status]')].filter(vis).map((a) => a.textContent.trim()).filter((t) => /Loading|Checking/i.test(t)),
      empty: [...main.querySelectorAll('p.text-sm.font-bold')].map((p) => p.textContent.trim()).filter((t) => /No |Nothing|caught up/i.test(t)).slice(0, 5),
      tables: [...main.querySelectorAll('table')].filter(vis).map((t) => t.querySelectorAll('tbody tr').length),
      buttons: [...main.querySelectorAll('button')].filter(vis).length,
      pagination: !!main.querySelector('[aria-label="Next page"]'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      blocked: /Not authorised|No employee profile|Access disabled|No portal access/.test(document.body.innerText),
    };
  })()` });
  return r.result.value;
}

async function screenshot(b, name, vp) {
  const m = await b.send("Page.getLayoutMetrics");
  const h = Math.min(Math.ceil(m.cssContentSize.height), 3200);
  const s = await b.send("Page.captureScreenshot", { format: "jpeg", quality: 60, captureBeyondViewport: true, clip: { x: 0, y: 0, width: vp.w, height: h, scale: vp.m ? 0.7 : 0.6 } });
  writeFileSync(path.join(OUT, "shots", name), Buffer.from(s.data, "base64"));
}

try { await run(); }
finally {
  writeFileSync(path.join(OUT, `results${MOBILE ? "-mobile" : ""}.json`), JSON.stringify({ base: BASE, blocked, results }, null, 2));
  const pages = results.filter((r) => r.kind === "page");
  const bad = pages.filter((r) => r.exceptions.length || r.apiErrors.length || r.alerts?.length || r.overflow > 0 || r.tabs?.some((t) => t.newExceptions.length || t.newApiErrors.length || t.alerts.length || t.overflow > 0));
  console.log(`pages: ${pages.length}, tabs: ${pages.reduce((n, r) => n + (r.tabs?.length ?? 0), 0)}, with issues: ${bad.length}, blocked external requests: ${blocked.length}`);
  for (const l of results.filter((r) => r.kind === "login")) console.log(`login ${l.role} → ${l.landed}`);
  for (const r of bad) console.log(JSON.stringify({ role: r.role, vp: r.vp, route: r.route, landed: r.landed, alerts: r.alerts, exc: r.exceptions, api: r.apiErrors, overflow: r.overflow, tabIssues: (r.tabs ?? []).filter((t) => t.newExceptions.length || t.newApiErrors.length || t.alerts.length || t.overflow > 0).map((t) => ({ tab: t.label, alerts: t.alerts, exc: t.newExceptions, api: t.newApiErrors, overflow: t.overflow })) }));
}

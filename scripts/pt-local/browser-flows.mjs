#!/usr/bin/env node
// LOCAL TEST HARNESS ONLY — end-to-end Project Tracker workflows in headless
// Chrome (DevTools protocol), against the harness from scripts/pt-local/start.mjs.
// Every request to a host other than 127.0.0.1/localhost is blocked, so the
// run can never touch Supabase, Google Analytics or any other live service.
//
//   node scripts/pt-local/browser-flows.mjs [--out <dir>]
//   node scripts/pt-local/browser-flows.mjs --admin-sim [--out <dir>]
//     (existing-admin login → Admin Dashboard → Project Tracker → Companies → Projects with the
//      SIMULATED stand-in for info@zyllotech.com, plus unauthorized URL / API checks)
//   node scripts/pt-local/browser-flows.mjs --auth [main|before-restart|after-restart]
//     (sign-in lifecycle: existing /login → is_admin → Project Tracker for the simulated existing admin and the
//      manager; refresh, logout/login, expired and invalid sessions; a session kept across a harness restart)
//   node scripts/pt-local/browser-flows.mjs --upstream
//     (harness started with --auth-upstream mock: sign-in through a MOCK external Supabase Auth project,
//      ES256 tokens verified locally, admin rights from the external is_admin(), data local)
//   node scripts/pt-local/browser-flows.mjs --vault-only [--out <dir>]
//     (harness started with --vault-test-double: exercises the password UI against the
//      PLAINTEXT local stand-in vault — UI/authorization/audit logic only, NOT encryption)
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign as cryptoSign } from "node:crypto";
import fs from "node:fs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { STATE_FILE, signJwt } from "./lib.mjs";

const argv = process.argv.slice(2);
const STATE = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const BASE = `http://127.0.0.1:${STATE.webPort}`;
const API = `http://127.0.0.1:${STATE.apiPort}`;
const PASSWORD = STATE.password;
const VAULT_ONLY = argv.includes("--vault-only");
const ADMIN_SIM = argv.includes("--admin-sim");
const UPSTREAM_MODE = argv.includes("--upstream");
const AUTH_MODE = argv.includes("--auth") ? (argv[argv.indexOf("--auth") + 1] || "main") : null; // main | before-restart | after-restart
const AUTH_PROFILE = path.join(tmpdir(), "zyllo-pt-auth-profile");
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : path.join(tmpdir(), "zyllo-pt-flows");
const DL = path.join(OUT, "downloads");
mkdirSync(path.join(OUT, "shots"), { recursive: true });
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome"].find(existsSync);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = Date.now().toString(36).slice(-5);
const VAULT_REF = `1Password › Clients › Flow ${RUN} › WP admin`;
const checks = [];
const openProcs = new Set();
let lastSession = null;
const blocked = [];
const pageErrors = [];
const consoleErrors = [];
const netFailures = [];
let currentStep = "start";
const check = (name, ok, detail = "") => {
  currentStep = name;
  checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 200) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).slice(0, 160)})` : ""}`);
};
function iso(offset = 0) { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString("en-CA"); }
function localDT(offsetDays = 0) { const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setMinutes(0); return `${d.toLocaleDateString("en-CA")}T${String(d.getHours()).padStart(2, "0")}:00`; }

// ------------------------------------------------------------------ CDP session
async function session(viewport = { w: 1440, h: 900, m: false }, { profileDir = null } = {}) {
  const port = 9300 + Math.floor(Math.random() * 400);
  const profile = profileDir || mkdtempSync(path.join(tmpdir(), "pt-flow-"));
  if (profileDir) mkdirSync(profileDir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  openProcs.add(proc);
  let target;
  for (let i = 0; i < 80 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* retry */ } }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result); return; }
    const p = m.params;
    if (m.method === "Fetch.requestPaused") {
      const host = new URL(p.request.url).hostname;
      if (host === "127.0.0.1" || host === "localhost") send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
      else { blocked.push(p.request.url.slice(0, 100)); send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {}); }
    }
    if (m.method === "Runtime.consoleAPICalled" && p.type === "error") consoleErrors.push({ step: currentStep, text: p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200) });
    if (m.method === "Log.entryAdded" && p.entry.level === "error" && !/ERR_BLOCKED_BY_CLIENT/.test(p.entry.text)) consoleErrors.push({ step: currentStep, text: `${p.entry.text} ${p.entry.url || ""}`.slice(0, 200) });
    if (m.method === "Network.requestWillBeSent") reqs.set(p.requestId, { method: p.request.method, url: p.request.url });
    if (m.method === "Network.responseReceived" && p.response.status >= 400) {
      const q = reqs.get(p.requestId) || { method: "?", url: p.response.url };
      const u = new URL(q.url);
      netFailures.push({ step: currentStep, status: p.response.status, method: q.method, path: u.pathname });
    }
    if (m.method === "Network.loadingFailed" && !/BLOCKED_BY_CLIENT|ERR_ABORTED/.test(p.errorText) && !p.canceled) {
      const q = reqs.get(p.requestId) || { method: "?", url: "?" };
      netFailures.push({ step: currentStep, status: p.errorText, method: q.method, path: q.url.slice(0, 120) });
    }
    if (m.method === "Runtime.exceptionThrown") pageErrors.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text).split("\n")[0]);
  };
  const reqs = new Map();
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Log.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => {});
  await send("Emulation.setDeviceMetricsOverride", { width: viewport.w, height: viewport.h, deviceScaleFactor: 1, mobile: viewport.m });
  const js = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS}; return eval(${JSON.stringify(expr)}); })()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const go = async (p) => { await send("Page.navigate", { url: BASE + p }); await sleep(800); };
  const until = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(`!!(${expr})`)) return true; } catch { /* page navigating */ } await sleep(200); } return false; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 }); writeFileSync(path.join(OUT, "shots", name), Buffer.from(s.data, "base64")); };
  const setFile = async (selector, file) => {
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
    await send("DOM.setFileInputFiles", { nodeId, files: Array.isArray(file) ? file : [file] });
  };
  const close = async () => { try { ws.close(); } catch { /* ignore */ } proc.kill(); openProcs.delete(proc); await sleep(600); if (!profileDir) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } } };
  lastSession = { send, js, go, until, shot, setFile, close };
  return lastSession;
}

// In-page helpers (run inside the page).
const HELPERS = `
const norm = (s) => (s || '').replace(/\\s+/g, ' ').replace(/\\*/g, '').trim();
const scope = () => { const d = [...document.querySelectorAll('[role=dialog]')]; return d[d.length - 1] || document; };
const setVal = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== !!v) el.click(); return; }
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
const field = (label) => { const ls = [...scope().querySelectorAll('label')]; const l = ls.find((x) => norm(x.textContent) === label) || ls.find((x) => norm(x.textContent).startsWith(label));
  return l && (document.getElementById(l.htmlFor) || l.querySelector('input,select,textarea')); };
const fill = (label, v) => { const el = field(label); if (!el) throw new Error('no field ' + label); setVal(el, v); return true; };
const fillAll = (o) => { for (const [k, v] of Object.entries(o)) fill(k, v); return true; };
const btn = (text, root) => [...(root || scope()).querySelectorAll('button,a')].find((b) => norm(b.textContent) === text && !b.disabled)
  || [...(root || scope()).querySelectorAll('button,a')].find((b) => norm(b.textContent).startsWith(text) && !b.disabled);
const click = (text, root) => { const b = btn(text, root); if (!b) throw new Error('no button ' + text); b.click(); return true; };
const has = (text, root) => (root || document.body).innerText.includes(text);
const row = (text) => [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(text));
const rowClick = (rowText, btnText) => { const r = row(rowText); if (!r) throw new Error('no row ' + rowText); return click(btnText, r); };
const tab = (label) => { const t = [...document.querySelectorAll('[role=tab]')].find((x) => norm(x.textContent) === label); if (!t) throw new Error('no tab ' + label); t.click(); return true; };
const dialogs = () => document.querySelectorAll('[role=dialog]').length;
const toasts = () => [...document.querySelectorAll('[aria-live=polite] [role=status]')].map((t) => t.textContent.trim()).join(' | ');
const overflowers = () => [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 1 && !e.closest('.overflow-x-auto, [class*=overflow-x-auto]') && getComputedStyle(e).position !== 'fixed'; })
  .slice(0, 6).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0, 4).join('.') + ' r=' + Math.round(e.getBoundingClientRect().right));
const alerts = () => [...document.querySelectorAll('[role=alert], [role=dialog] .text-red-600')].map((a) => a.textContent.trim()).join(' | ');
`;

async function login(s, email, next = "/admin/project-tracker") {
  await s.go(`/login?next=${encodeURIComponent(next)}`);
  await s.until(`!!document.querySelector('input[name=email]')`);
  await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('email', ${JSON.stringify(email)}); set('password', ${JSON.stringify(PASSWORD)}); document.querySelector('form').requestSubmit(); return 1; })()`);
  await s.until(`location.pathname.startsWith('/admin')`, 10000);
  await sleep(1200);
  return s.js("location.pathname");
}

/** Open the add form of a section, fill it and save; returns toast text. */
async function addRecord(s, addLabel, values, { expectOk = true } = {}) {
  await s.js(`click(${JSON.stringify(addLabel)}, document)`);
  await s.until("dialogs() === 1");
  await s.js(`fillAll(${JSON.stringify(values)})`);
  await s.js(`click([...scope().querySelectorAll('button[type=submit]')].pop().textContent.trim())`);
  if (expectOk) {
    const ok = await s.until("dialogs() === 0", 8000);
    if (!ok) return `STILL OPEN: ${await s.js("alerts()")}`;
    return s.js("toasts()");
  }
  await sleep(1200);
  return s.js("alerts()");
}

/** Wait for the section tab, then open it. */
async function tabGo(s, label) {
  if (!(await s.until(`[...document.querySelectorAll('[role=tab]')].some((t) => norm(t.textContent) === ${JSON.stringify(label)})`, 10000))) throw new Error(`no tab ${label}`);
  await s.js(`tab(${JSON.stringify(label)})`);
  await sleep(300);
}

/** Wait for a table row containing rowText, then click its button. */
async function rowAct(s, rowText, btnText) {
  if (!(await s.until(`!!row(${JSON.stringify(rowText)}) && !!btn(${JSON.stringify(btnText)}, row(${JSON.stringify(rowText)}))`, 8000))) throw new Error(`no row/button ${rowText} / ${btnText}`);
  await s.js(`rowClick(${JSON.stringify(rowText)}, ${JSON.stringify(btnText)})`);
}

async function apiToken(email) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: STATE.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (await r.json()).access_token;
}
const rest = (p, token, init = {}) => fetch(`${API}/rest/v1/${p}`, {
  ...init, headers: { apikey: STATE.anonKey, Authorization: `Bearer ${token || STATE.anonKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
});

let projectA = null;
let projectB = null;
const CO = { A1: null, A2: null, A3: null };
const CO_NAME = { A1: `Flow Co A1 ${RUN}`, A2: `Flow Co A2 ${RUN}`, A3: `Flow Co A3 ${RUN}` };
const PDF = path.join(OUT, `client-signoff-${RUN}.pdf`);
writeFileSync(PDF, Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n% synthetic test file ${RUN}\n`));


// ====================================================== password UI against the LOCAL TEST DOUBLE vault
// The harness (start.mjs --vault-test-double) keeps passwords in PLAINTEXT. These checks prove the
// browser workflow, server authorization, re-authentication, auto-hide and audit — NOT encryption.
async function vaultFlows() {
  if (!STATE.vaultTestDouble) throw new Error("--vault-only needs a harness started with --vault-test-double");
  check("V0. Harness is the labelled LOCAL TEST DOUBLE (not encrypted)", /NOT ENCRYPTED/.test(STATE.passwordBackend || ""), STATE.passwordBackend);
  const PW = "Synthetic-" + RUN + "-Pw#7";
  const PW2 = "Synthetic-" + RUN + "-Pw#8";
  const SVC = "Vault flow admin " + RUN;
  const mgTok0 = await apiToken("pt.manager@example.test");
  const projects = await (await rest("pt_projects?select=id,name", mgTok0)).json();
  const proj = projects.find((x) => x.name === "P1 — Corporate Website");
  if (!proj) throw new Error("seeded project P1 not found (start without --no-seed)");
  const accessUrl = "/admin/project-tracker/projects/" + proj.id + "?tab=access";

  // editor: save a password through the credential form
  let s = await session();
  await login(s, "pt.editor@example.test", accessUrl);
  await s.until("has('Add access record')", 60000);
  check("V1. Test-double banner and badge are shown", await s.js("has('TEST DOUBLE — NOT ENCRYPTED') && has('Vault: TEST DOUBLE')"));
  await s.js("click('Add access record', document)"); await s.until("dialogs() === 1");
  check("V2. Password input is enabled when a vault backend is configured", await s.js("(() => { const i = scope().querySelector('input[type=password]'); return !!i && !i.disabled && i.autocomplete === 'new-password'; })()"));
  await s.js("click('Cancel')"); await s.until("dialogs() === 0");
  const t = await addRecord(s, "Add access record", { "Credential Type": "website_admin", "Service / Website Name": SVC, "Email / Username": "vault.flow@a1-demo.example", "Password": PW, "2FA Status": "enabled" });
  check("V3. Editor saves a credential with a password (sent to the vault RPC)", /Password saved to the vault/.test(t), t);
  await s.until("!!row(" + JSON.stringify(SVC) + ") && row(" + JSON.stringify(SVC) + ").innerText.includes('••••')");
  check("V4. Stored password is masked in the list", await s.js("row(" + JSON.stringify(SVC) + ").innerText.includes('••••') && !document.body.innerText.includes(" + JSON.stringify(PW) + ")"));
  check("V5. Editor cannot reveal or copy (buttons disabled)", await s.js("(() => { const r = row(" + JSON.stringify(SVC) + "); return r.querySelector('button[aria-label=\"Show password\"]').disabled && r.querySelector('button[aria-label=\"Copy password\"]').disabled; })()"));
  const edTok = await apiToken("pt.editor@example.test");
  const rec = (await (await rest("pt_access_records?select=*&service_name=eq." + encodeURIComponent(SVC), edTok)).json())[0];
  check("V6. The credential row returned by the API never contains the password", rec && rec.has_password === true && !JSON.stringify(rec).includes(PW), JSON.stringify(rec || {}).slice(0, 100));
  const edRev = await (await rest("rpc/pt_reveal_access_password", edTok, { method: "POST", body: JSON.stringify({ p_record: rec.id, p_purpose: "reveal" }) })).json();
  check("V7. Server refuses reveal for an editor (reason forbidden)", edRev.ok === false && edRev.reason === "forbidden" && !("password" in edRev), JSON.stringify(edRev));
  check("V8. Password not in localStorage / sessionStorage", await s.js("!(JSON.stringify(localStorage) + JSON.stringify(sessionStorage)).includes(" + JSON.stringify(PW) + ")"));
  await s.close();

  // manager: show, hide, auto-hide, copy
  s = await session();
  const loginAt = Date.now();
  await login(s, "pt.manager@example.test", accessUrl);
  await s.until("!!row(" + JSON.stringify(SVC) + ")", 60000);
  const R = "row(" + JSON.stringify(SVC) + ")";
  await s.js("(() => { const b = " + R + ".querySelector('button[aria-label=\"Show password\"]'); b.click(); return 1; })()");
  check("V9. Manager (recent sign-in) clicks Show: the password is displayed with a countdown", await s.until(R + ".innerText.includes(" + JSON.stringify(PW) + ") && " + R + ".innerText.includes('hides in')"));
  await s.js("(() => { " + R + ".querySelector('button[aria-label=\"Hide password\"]').click(); return 1; })()");
  check("V10. Hide masks it again immediately", await s.until("!" + R + ".innerText.includes(" + JSON.stringify(PW) + ")", 3000));
  await s.js("(() => { " + R + ".querySelector('button[aria-label=\"Show password\"]').click(); return 1; })()");
  await s.until(R + ".innerText.includes(" + JSON.stringify(PW) + ")");
  check("V11. Auto-hide after the server-set time (10 s in this harness)", await s.until("!" + R + ".innerText.includes(" + JSON.stringify(PW) + ")", 15000));
  await s.js("(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (x) => { window.__copied = x; } } }); return 1; })()");
  await s.js("(() => { " + R + ".querySelector('button[aria-label=\"Copy password\"]').click(); return 1; })()");
  await s.until("window.__copied !== null");
  check("V12. Copy puts the password on the clipboard without displaying it", await s.js("window.__copied === " + JSON.stringify(PW) + " && !" + R + ".innerText.includes(" + JSON.stringify(PW) + ")"));
  check("Copy tells the user the clipboard is not cleared automatically", await s.js("toasts().includes('not cleared automatically')"));

  // change the password
  await s.js("(() => { " + R + ".querySelector('button[aria-label=\"Change password\"]').click(); return 1; })()"); await s.until("dialogs() === 1");
  await s.js("fillAll({ 'Password': " + JSON.stringify(PW2) + ", 'Repeat password': 'mismatch' }); click('Save password')"); await sleep(300);
  check("Mismatched repeat is refused", await s.js("has('do not match', scope())"));
  await s.js("fillAll({ 'Repeat password': " + JSON.stringify(PW2) + " }); click('Save password')");
  check("V13. Password changed", await s.until("dialogs() === 0") && await s.until("toasts().includes('Password changed')"));

  // re-authentication: wait until the sign-in is older than reauth_minutes (1 min here)
  const waitMs = 75000 - (Date.now() - loginAt); // login finishes a few seconds after loginAt
  if (waitMs > 0) await sleep(waitMs);
  await s.js("(() => { " + R + ".querySelector('button[aria-label=\"Show password\"]').click(); return 1; })()");
  check("V14. After the re-auth window, Show asks the manager to confirm their own password", await s.until("dialogs() === 1 && has(\"Confirm it's you\", scope())"));
  check("No password shown before re-authentication", await s.js("!document.body.innerText.includes(" + JSON.stringify(PW2) + ")"));
  await s.js("fill('Your password', 'wrong-password-123'); click('Confirm')");
  check("V15. Wrong password is refused and nothing is revealed", await s.until("alerts().length > 0 || has('Invalid', scope())") && await s.js("dialogs() === 1 && !document.body.innerText.includes(" + JSON.stringify(PW2) + ")"));
  await s.js("fill('Your password', " + JSON.stringify(PASSWORD) + "); click('Confirm')");
  check("V16. Correct password: re-authenticated and the (changed) password is shown", await s.until("dialogs() === 0 && " + R + ".innerText.includes(" + JSON.stringify(PW2) + ")", 10000));
  await s.js("(() => { " + R + ".querySelector('button[aria-label=\"Hide password\"]').click(); return 1; })()");

  // linked Emails / Hosting columns
  await tabGo(s, "Emails & Accounts");
  check("V17. Emails & Accounts shows a Password column with vault actions", await s.until("[...document.querySelectorAll('th')].some((h) => h.textContent.trim() === 'Password') && !!btn('Set password', document)"));
  await tabGo(s, "Hosting & Servers");
  check("V18. Hosting & Servers shows a Password column", await s.until("[...document.querySelectorAll('th')].some((h) => h.textContent.trim() === 'Password')"));

  // no secrets in reports, exports, logs or storage
  await s.go("/admin/project-tracker/projects/" + proj.id + "/report");
  await s.until("document.body.innerText.length > 500", 10000);
  check("V19. Project report never contains the password", await s.js("!document.body.innerText.includes(" + JSON.stringify(PW) + ") && !document.body.innerText.includes(" + JSON.stringify(PW2) + ")"));
  check("Password not in localStorage / sessionStorage (manager)", await s.js("!(JSON.stringify(localStorage) + JSON.stringify(sessionStorage)).includes(" + JSON.stringify(PW2) + ")"));
  const mgTok = await apiToken("pt.manager@example.test");
  const logs = await (await rest("pt_activity_logs?select=action,details,entity_label&entity_id=eq." + rec.id, mgTok)).json();
  const acts = logs.map((l) => l.action);
  const want = ["access.password_set", "access.password_revealed", "access.password_copied", "access.password_changed", "access.password_denied"];
  check("V20. Audit log records save, reveal, copy, change and the refused editor attempt", want.every((w) => acts.includes(w)), want.filter((w) => !acts.includes(w)).join(",") || acts.join(","));
  check("V21. Audit log never contains the password value", !JSON.stringify(logs).includes(PW) && !JSON.stringify(logs).includes(PW2));
  check("Browser console never contained the password", !JSON.stringify(consoleErrors).includes(PW) && !JSON.stringify(consoleErrors).includes(PW2));

  // remove
  await s.go(accessUrl);
  await s.until("!!" + R, 10000);
  await s.js("(() => { " + R + ".querySelector('button[aria-label=\"Remove stored password\"]').click(); return 1; })()"); await s.until("dialogs() === 1");
  await s.js("click('Remove password')");
  check("V22. Manager removes the stored password", await s.until("dialogs() === 0 && " + R + ".innerText.includes('Not stored')", 8000));
  const after = await (await rest("rpc/pt_reveal_access_password", mgTok, { method: "POST", body: JSON.stringify({ p_record: rec.id, p_purpose: "reveal" }) })).json();
  check("After removal the server has nothing to reveal", after.ok === false && after.reason === "no_password", JSON.stringify(after));
  await s.close();

  // mobile layout with the password controls
  s = await session({ w: 390, h: 844, m: true });
  await login(s, "pt.manager@example.test", accessUrl);
  await s.until("has('Vault: TEST DOUBLE')", 20000);
  check("V23. Mobile (390px): credential list with password controls has no horizontal page scroll", await s.js("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), await s.js("overflowers().join(' ; ')"));
  await s.shot("v-mobile-access.jpg");
  await s.close();
}

// ====================================================== existing admin account (SIMULATED stand-in) + unauthorized access
async function adminSimFlows() {
  const SIM = STATE.simulatedAdmin;
  if (!SIM?.userId) throw new Error("the harness has no simulated existing admin (restart start.mjs)");
  check("A0. SIMULATED stand-in for the existing admin — not the real account, not a real login", true, SIM.email + " stands in for " + SIM.simulates + " (user " + SIM.userId + ")");
  let s = await session();
  await s.go("/login");
  await s.until("!!document.querySelector('input[name=email]')", 20000);
  check("A1. The existing admin login page is used (no Project Tracker login)", await s.js("location.pathname === '/login' && !!document.querySelector('input[name=password]')"));
  await s.js("(() => { const set = (n, v) => { const el = document.querySelector('input[name=\"' + n + '\"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };"
    + " set('email', " + JSON.stringify(SIM.email) + "); set('password', " + JSON.stringify(PASSWORD) + "); document.querySelector('form').requestSubmit(); return 1; })()");
  check("A2. Signing in lands on the Admin Dashboard", await s.until("location.pathname === '/admin' && !!document.querySelector('main') && has('Dashboard')", 20000));
  await s.js("(() => { window.__visited = []; const rec = () => window.__visited.push(location.pathname); window.addEventListener('popstate', rec); const ps = history.pushState; history.pushState = function (...a) { const r = ps.apply(this, a); rec(); return r; }; const rs = history.replaceState; history.replaceState = function (...a) { const r = rs.apply(this, a); rec(); return r; }; return 1; })()");
  const tokens = await s.js("Object.keys(localStorage).filter((k) => /auth-token/.test(k))");
  check("A3. One Supabase Auth session in the browser (the same session the admin area uses)", tokens.length === 1, tokens.join(","));
  await s.js("[...document.querySelectorAll('aside nav a')].find((a) => a.textContent.trim() === 'Project Overview').click()");
  check("A4. Admin Dashboard → Project Tracker → Dashboard opens with the same session", await s.until("location.pathname === '/admin/project-tracker' && has('Total Companies') && has('Recent Projects')", 60000));
  check("A5. Manager role recognised (Access management offered)", await s.until("!!btn('Access', document)", 10000));
  await s.js("[...document.querySelectorAll('aside nav a')].find((a) => a.textContent.trim() === 'Companies').click()");
  check("A6. → Companies", await s.until("location.pathname === '/admin/project-tracker/companies' && has('Company A1') && has('Company A2')", 10000));
  await s.js("(() => { const a = [...document.querySelectorAll('main a')].find((x) => x.textContent.trim() === 'Company A1'); if (a) { a.click(); return 1; } row('Company A1').click(); return 2; })()");
  check("A7. → Company A1 with its projects", await s.until("/\\/companies\\/[0-9a-f-]{36}$/.test(location.pathname) && has('P1 — Corporate Website')", 10000));
  await s.js("[...document.querySelectorAll('aside nav a')].find((a) => a.textContent.trim() === 'All Projects').click()");
  check("A8. → Projects (All Projects register)", await s.until("location.pathname === '/admin/project-tracker/projects' && has('P1 — Corporate Website') && has('P1 — School Website')", 10000));
  await s.js("(() => { const a = [...document.querySelectorAll('main a')].find((x) => x.textContent.trim() === 'P1 — Corporate Website'); if (a) { a.click(); return 1; } row('P1 — Corporate Website').click(); return 2; })()");
  check("A9. → Project details", await s.until("/\\/projects\\/[0-9a-f-]{36}$/.test(location.pathname) && has('Edit Project')", 10000));
  const visited = await s.js("window.__visited");
  check("A10. No sign-in prompt anywhere on the way (session reused)", !visited.some((v) => v.startsWith("/login")), visited.join(" → "));
  await tabGo(s, "Credentials & Access");
  check("A11. Manager-only action available: View reference", await s.until("!!btn('View reference', document)", 10000));
  await s.go("/admin/project-tracker/access");
  check("A12. Access page lists this account as Manager (assigned by user ID via 011)", await s.until("!!row(" + JSON.stringify(SIM.email) + ") && /Manager/i.test(row(" + JSON.stringify(SIM.email) + ").innerText)", 10000));
  await s.go("/admin/project-tracker/companies");
  check("A13. Deep link after a full reload stays signed in", await s.until("location.pathname === '/admin/project-tracker/companies' && has('Company A1')", 15000));
  await s.js("(() => { document.querySelector('button[aria-label=\"Log out\"]').click(); return 1; })()");
  await s.until("location.pathname === '/login' || !document.querySelector('button[aria-label=\"Log out\"]')", 10000);
  await s.go("/admin/project-tracker/projects");
  check("A14. After signing out, a Project Tracker URL redirects to the existing login", await s.until("location.pathname === '/login' && location.search.includes('project-tracker')", 10000));
  await s.close();

  // ---- unauthorized users: direct URLs
  s = await session();
  await s.go("/admin/project-tracker/companies");
  check("U1. Signed-out visitor: direct URL → /login", await s.until("location.pathname === '/login'", 10000));
  await s.close();
  s = await session();
  await login(s, "not.admin@example.test", "/admin/project-tracker/projects");
  check("U2. Signed-in non-admin: direct URL → Not authorised, no data", await s.until("has('Not authorised')") && await s.js("!has('Corporate Website') && !has('Company A1')"));
  await s.close();
  s = await session();
  await login(s, "pt.blocked@example.test", "/admin/project-tracker/companies");
  check("U3. Admin blocked in Project Tracker: direct URL → No access, no data", await s.until("has('No access to Project Tracker')") && await s.js("!has('Company A1')"));
  await s.close();

  // ---- unauthorized users: API
  const anon = null;
  const outsider = await apiToken("not.admin@example.test");
  const blockedTok = await apiToken("pt.blocked@example.test");
  const editorTok = await apiToken("pt.editor@example.test");
  for (const [who, tok] of [["anonymous", anon], ["non-admin", outsider], ["blocked admin", blockedTok]]) {
    const leaks = [];
    for (const t of ["pt_companies", "pt_projects", "pt_access_records", "pt_documents", "pt_members", "pt_activity_logs", "pt_project_list"]) {
      const r = await rest(t + "?select=*&limit=5", tok);
      if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) leaks.push(t + ":" + j.length); }
    }
    check("U4. " + who + ": direct REST reads of Project Tracker tables return nothing", leaks.length === 0, leaks.join(","));
    const role = await rest("rpc/pt_role", tok, { method: "POST", body: "{}" });
    const roleVal = role.ok ? await role.json() : null;
    check("U5. " + who + ": pt_role() grants no role", roleVal === null, JSON.stringify(roleVal));
    const grab = await rest("rpc/pt_set_member_role", tok, { method: "POST", body: JSON.stringify({ p_email: "not.admin@example.test", p_role: "manager" }) });
    check("U6. " + who + ": cannot make anyone a manager", grab.status >= 400, String(grab.status));
  }
  const selfPromote = await rest("rpc/pt_set_member_role", editorTok, { method: "POST", body: JSON.stringify({ p_email: "pt.editor@example.test", p_role: "manager" }) });
  check("U7. An editor (admin) cannot promote themselves to manager", selfPromote.status >= 400, String(selfPromote.status));
  const direct = await rest("pt_members", editorTok, { method: "POST", body: JSON.stringify({ user_id: SIM.userId, role: "no_access" }) });
  check("U8. pt_members cannot be written directly through the API", direct.status >= 400, String(direct.status));
  const list = await rest("rpc/pt_list_members", editorTok, { method: "POST", body: "{}" });
  check("U9. Non-managers cannot list role assignments", list.status >= 400, String(list.status));
}

// ====================================================== sign-in lifecycle (local harness)
const isAdminFailures = (from) => netFailures.slice(from).filter((f) => /rpc\/is_admin|auth\/v1\/user/.test(f.path) || f.status === 401);
async function loginForm(s, email, password) {
  await s.go("/login");
  await s.until("!!document.querySelector('input[name=email]')", 30000);
  await s.js("(() => { const set = (n, v) => { const el = document.querySelector('input[name=\"' + n + '\"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };"
    + " set('email', " + JSON.stringify(email) + "); set('password', " + JSON.stringify(password) + "); document.querySelector('form').requestSubmit(); return 1; })()");
}
const navTo = (label) => "[...document.querySelectorAll('aside nav a')].find((a) => a.textContent.trim() === " + JSON.stringify(label) + ").click()";
const storedSession = "(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x)); return k ? JSON.parse(localStorage.getItem(k)) : null; })()";
const editSession = (body) => "(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x)); const v = JSON.parse(localStorage.getItem(k)); " + body + "; localStorage.setItem(k, JSON.stringify(v)); return 1; })()";

async function authFlows(mode) {
  const SIM = STATE.simulatedAdmin?.email || "zyllo.admin.sim@example.test";
  if (mode === "before-restart") {
    fs.rmSync(AUTH_PROFILE, { recursive: true, force: true });
    const s = await session(undefined, { profileDir: AUTH_PROFILE });
    await loginForm(s, "pt.manager@example.test", PASSWORD);
    await s.until("location.pathname === '/admin'", 20000);
    await s.go("/admin/project-tracker/companies");
    check("R1. Before restart: manager signed in and on Companies (profile kept)", await s.until("has('Company A1')", 60000));
    await s.close();
    return;
  }
  if (mode === "after-restart") {
    const from = netFailures.length;
    const s = await session(undefined, { profileDir: AUTH_PROFILE });
    await s.go("/admin/project-tracker/companies");
    check("R2. After a harness restart the stored session still verifies: Companies opens without signing in again",
      await s.until("location.pathname === '/admin/project-tracker/companies' && has('Company A1')", 60000));
    check("R3. No 401 / JWT-signature errors after the restart", isAdminFailures(from).length === 0, JSON.stringify(isAdminFailures(from)));
    await s.close();
    fs.rmSync(AUTH_PROFILE, { recursive: true, force: true });
    return;
  }

  for (const [label, email] of [["simulated existing admin " + SIM, SIM], ["manager pt.manager@example.test", "pt.manager@example.test"]]) {
    const from = netFailures.length;
    let s = await session();
    await loginForm(s, email, PASSWORD);
    check("L1. " + label + ": existing /login → Admin Dashboard", await s.until("location.pathname === '/admin' && !!document.querySelector('main') && has('Dashboard')", 30000));
    check("L2. " + label + ": admin verification passed (is_admin, no 401 / JWT errors)", await s.js("!has('Not authorised')") && isAdminFailures(from).length === 0, JSON.stringify(isAdminFailures(from)));
    await s.js(navTo("Project Overview"));
    check("L3. " + label + ": → Project Tracker dashboard", await s.until("location.pathname === '/admin/project-tracker' && has('Total Companies')", 60000));
    await s.js(navTo("Companies"));
    check("L4. " + label + ": → Companies", await s.until("location.pathname === '/admin/project-tracker/companies' && has('Company A1')", 15000));
    await s.js(navTo("All Projects"));
    check("L5. " + label + ": → Projects", await s.until("location.pathname === '/admin/project-tracker/projects' && has('P1 — Corporate Website')", 15000));
    check("L6. " + label + ": recognised as Project Tracker Manager", await s.js("(async () => { const { supabase } = await import('/src/lib/supabase/client.js'); const r = await supabase.rpc('pt_role'); return r.data; })()") === "manager");
    await s.go("/admin/project-tracker/projects");
    check("L7. " + label + ": page refresh keeps the session", await s.until("location.pathname === '/admin/project-tracker/projects' && has('P1 — Corporate Website')", 20000));
    await s.js("(() => { document.querySelector('button[aria-label=\"Log out\"]').click(); return 1; })()");
    await s.until("!document.querySelector('button[aria-label=\"Log out\"]')", 10000);
    await s.go("/admin/project-tracker");
    check("L8. " + label + ": after logout, Project Tracker redirects to /login", await s.until("location.pathname === '/login'", 15000) && await s.js(storedSession + " === null"));
    await loginForm(s, email, PASSWORD);
    check("L9. " + label + ": login again works", await s.until("location.pathname === '/admin' && has('Dashboard')", 30000) && isAdminFailures(from).length === 0);
    await s.close();
  }

  // expired access token with a valid refresh token → refreshed silently
  let s = await session();
  await loginForm(s, "pt.manager@example.test", PASSWORD);
  await s.until("location.pathname === '/admin'", 30000);
  const before = await s.js(storedSession);
  await s.js(editSession("v.expires_at = Math.floor(Date.now() / 1000) - 60"));
  const fromE = netFailures.length;
  await s.go("/admin/project-tracker/companies");
  await s.until("has('Company A1')", 30000);
  const afterRefresh = await s.js(storedSession);
  check("E1. Expired access token: session refreshed automatically, page opens", afterRefresh && afterRefresh.access_token !== before.access_token && afterRefresh.expires_at > Date.now() / 1000 && await s.js("has('Company A1')"));
  check("E2. No 401 during the refresh", isAdminFailures(fromE).length === 0, JSON.stringify(isAdminFailures(fromE)));
  // expired access token and an unknown refresh token → signed out, back to /login (no 'Not authorised')
  await s.js(editSession("v.expires_at = Math.floor(Date.now() / 1000) - 60; v.refresh_token = 'unknown-refresh-token'"));
  await s.go("/admin/project-tracker/companies");
  check("E3. Expired session that cannot be refreshed → /login (session cleared, no 'Not authorised')",
    await s.until("location.pathname === '/login'", 20000) && await s.js("!has('Not authorised')"));
  await s.close();

  // wrong password → clear message, no session
  s = await session();
  await loginForm(s, SIM, "Wrong-Password-123!");
  check("W1. Wrong password: 'Invalid email or password' shown, still on /login", await s.until("location.pathname === '/login' && /invalid email or password/i.test(document.body.innerText)", 15000) && await s.js(storedSession + " === null"));
  await s.close();

  // a token signed with another key (what an older harness run left in the browser): rejected by the server,
  // and the user recovers with Sign out → login. JWT verification is not relaxed.
  s = await session();
  await s.go("/login");
  await s.until("!!document.querySelector('input[name=email]')", 30000);
  const now = Math.floor(Date.now() / 1000);
  const forged = signJwt({ iss: "old-run", sub: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "pt.manager@example.test", exp: now + 3600, iat: now }, "a-different-secret-from-an-older-run");
  await s.js("(() => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: " + JSON.stringify(forged) + ", token_type: 'bearer', expires_in: 3600, expires_at: " + (now + 3600) + ", refresh_token: 'old', user: { id: '00000000-0000-4000-8000-000000000001', email: 'pt.manager@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } })); return 1; })()");
  const fromF = netFailures.length;
  await s.go("/admin/project-tracker");
  await s.until("has('Not authorised') || location.pathname === '/login'", 20000);
  check("S1. A token signed with another key is rejected by the server (401, JWT still verified)", netFailures.slice(fromF).some((f) => f.status === 401 && /rpc\/is_admin/.test(f.path)));
  check("S2. … and grants no access", await s.js("!has('Total Companies') && !has('Company A1')"));
  if (await s.js("has('Not authorised')")) await s.js("click('Sign out', document)");
  await s.until("location.pathname === '/login'", 15000);
  await loginForm(s, "pt.manager@example.test", PASSWORD);
  check("S3. Recovery: Sign out → login works normally", await s.until("location.pathname === '/admin' && has('Dashboard')", 30000));
  await s.close();
}

// ====================================================== external sign-in (MOCK upstream project)
function localSql(sql) {
  const exe = process.platform === "win32" ? ".exe" : "";
  const r = spawnSync(path.join(STATE.pgBin, "psql" + exe), ["-h", "127.0.0.1", "-p", String(STATE.pgPort), "-U", "pt_local", "-d", "postgres", "-X", "-q", "-t", "-A", "-c", sql], { encoding: "utf8", windowsHide: true });
  return (r.stdout || "").trim();
}
const jwtParts = (t) => { const [h, b] = String(t).split("."); return { header: JSON.parse(Buffer.from(h, "base64url").toString()), claims: JSON.parse(Buffer.from(b, "base64url").toString()) }; };
async function upstreamFlows() {
  const UPS = STATE.authUpstream;
  if (!UPS?.mock) throw new Error("--upstream needs a harness started with --auth-upstream mock");
  const MOCKPW = "Upstream-Mock-2026!";
  const ADMIN = "ext.admin@upstream.test", USER = "ext.user@upstream.test";
  check("X0. MOCK external Supabase Auth with synthetic users — not the real HRMS project", true, UPS.url);

  let s = await session();
  await loginForm(s, ADMIN, MOCKPW);
  check("X1. External admin signs in on the existing /login page → Admin Dashboard", await s.until("location.pathname === '/admin' && has('Dashboard')", 30000));
  const sess = await s.js(storedSession);
  const t = jwtParts(sess.access_token);
  check("X2. The session token was issued and signed by the external project (ES256), not minted locally", t.header.alg === "ES256" && t.claims.iss === UPS.url + "/auth/v1", t.header.alg + " " + t.claims.iss);
  await s.js(navTo("Project Overview"));
  check("X3. Project Tracker opens with that session", await s.until("location.pathname === '/admin/project-tracker' && has('Total Companies')", 60000));
  const role0 = await s.js("(async () => { const { supabase } = await import('/src/lib/supabase/client.js'); return (await supabase.rpc('pt_role')).data; })()");
  check("X4. Before any assignment the external admin is an Editor (no Manager by default)", role0 === "editor", role0);
  check("X5. No password or hash for the external account in the local database",
    localSql("select count(*) from pt_harness.passwords where user_id = '" + t.claims.sub + "'") === "0");
  check("X6. Its admin status was taken from the external project's own is_admin()",
    localSql("select is_admin || '/' || http_status from pt_harness.upstream_identities where user_id = '" + t.claims.sub + "'") === "true/200");
  const g = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "grant-local-manager.mjs"), "--email", ADMIN], { encoding: "utf8" });
  check("X7. Local Manager assignment via 010/011 (by verified user ID, local DB only)", g.status === 0 && /now a Project Tracker Manager/.test(g.stdout), (g.stdout + g.stderr).slice(-200));
  await s.go("/admin/project-tracker/access");
  check("X8. After reload: Manager (Access page lists the account as Manager)", await s.until("!!row(" + JSON.stringify(ADMIN) + ") && /Manager/i.test(row(" + JSON.stringify(ADMIN) + ").innerText)", 20000));
  await s.go("/admin/project-tracker/companies");
  check("X9. Project Tracker data comes from the local database (local demo companies)", await s.until("has('Company A1') && has('Company A3')", 15000));
  await s.js(editSession("v.expires_at = Math.floor(Date.now() / 1000) - 60"));
  await s.go("/admin/project-tracker/projects");
  await s.until("has('P1 — Corporate Website')", 30000);
  const sess2 = await s.js(storedSession);
  check("X10. Expired session refreshed through the external project; still signed in", sess2.access_token !== sess.access_token && jwtParts(sess2.access_token).header.alg === "ES256" && await s.js("has('P1 — Corporate Website')"));
  const pw = await fetch(API + "/auth/v1/user", { method: "PUT", headers: { apikey: STATE.anonKey, Authorization: "Bearer " + sess2.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ password: "Changed-Locally-1!" }) });
  check("X11. Changing the external account's password through the local harness is refused", pw.status === 422, String(pw.status));
  await s.js("(() => { document.querySelector('button[aria-label=\"Log out\"]').click(); return 1; })()");
  await s.until("!document.querySelector('button[aria-label=\"Log out\"]')", 10000);
  await s.go("/admin/project-tracker");
  check("X12. Sign-out (forwarded to the external project) → /login", await s.until("location.pathname === '/login'", 15000) && await s.js(storedSession + " === null"));
  await s.close();

  s = await session();
  await loginForm(s, USER, MOCKPW);
  check("X13. External account that is NOT an admin there: signed in but 'Not authorised', no data", await s.until("has('Not authorised')", 30000) && await s.js("!has('Company A1')"));
  await s.close();
  const g2 = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "grant-local-manager.mjs"), "--email", USER], { encoding: "utf8" });
  check("X14. Manager cannot be assigned to an external non-admin (010/011 refuse)", g2.status !== 0 && /not a website admin/.test(g2.stderr), (g2.stdout + g2.stderr).slice(-160));

  s = await session();
  await loginForm(s, ADMIN, "Wrong-Password-1!");
  check("X15. Wrong external password: 'Invalid email or password', no session", await s.until("location.pathname === '/login' && /invalid email or password/i.test(document.body.innerText)", 20000) && await s.js(storedSession + " === null"));
  await s.close();

  // a token claiming the external issuer but signed with another key
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid: t.header.kid })).toString("base64url");
  const b = Buffer.from(JSON.stringify({ ...t.claims, exp: now + 600, iat: now })).toString("base64url");
  const forged = h + "." + b + "." + cryptoSign("sha256", Buffer.from(h + "." + b), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const fr = await rest("pt_projects?select=id", forged);
  check("X16. A token with the external issuer but a forged signature is rejected (401)", fr.status === 401, String(fr.status));
  const su = await fetch(API + "/auth/v1/signup", { method: "POST", headers: { apikey: STATE.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: "new.person@upstream.test", password: "Whatever-123!" }) });
  const calls = await (await fetch(UPS.url + "/__calls")).json();
  check("X17. Sign-up is never forwarded (no account can be created in the external project)", su.status === 422 && !calls.some((c) => /signup/.test(c)), String(su.status));
  const allowed = /^(POST \/auth\/v1\/token\?grant_type=(password|refresh_token)|GET \/auth\/v1\/user|POST \/auth\/v1\/logout|GET \/auth\/v1\/\.well-known\/jwks\.json|POST \/rest\/v1\/rpc\/is_admin|GET \/__calls)$/;
  check("X18. The external project received only sign-in, refresh, user, sign-out, public-key and is_admin calls — no Project Tracker data", calls.every((c) => allowed.test(c)), calls.filter((c) => !allowed.test(c)).join(", "));
  check("X19. Admin checks used the external project's is_admin (" + calls.filter((c) => /is_admin/.test(c)).length + " calls)", calls.some((c) => /rpc\/is_admin/.test(c)));

  s = await session();
  await loginForm(s, "pt.manager@example.test", PASSWORD);
  check("X20. Synthetic local accounts still sign in locally", await s.until("location.pathname === '/admin' && has('Dashboard')", 30000) && jwtParts((await s.js(storedSession)).access_token).header.alg === "HS256");
  await s.close();
}

try {
  if (UPSTREAM_MODE) await upstreamFlows();
  else if (AUTH_MODE) await authFlows(AUTH_MODE);
  else if (VAULT_ONLY) await vaultFlows();
  else if (ADMIN_SIM) await adminSimFlows();
  else {
  // ====================================================== manager: company hierarchy
  let s = await session();
  check("C1. Manager logs in and lands in Project Tracker", (await login(s, "pt.manager@example.test")) === "/admin/project-tracker");
  await s.until(`has('Recent Projects')`, 60000); // first load: Vite compiles the module graph
  const nav = await s.js(`[...document.querySelectorAll('aside nav p, aside nav a')].map((x) => x.textContent.trim())`);
  const want = ["Project Tracker", "Project Overview", "Companies", "All Projects", "Hosting & Domains", "Emails & Accounts", "Backups", "AMC & Renewals", "Handover Records", "Reports"];
  check("Sidebar shows the Project Tracker section with Companies and all views", want.every((w) => nav.includes(w)), want.filter((w) => !nav.includes(w)).join(","));
  check("Existing sidebar items are still present", ["Dashboard", "Contact Submissions", "Blog Posts", "Portfolio", "Careers", "Job Applications", "SEO", "Search Console"].every((w) => nav.includes(w)));
  check("C2. Dashboard shows the KPI set and panels", await s.js(`['Total Companies','Total Projects','Live Projects','In Progress','Under Maintenance','Pending Handover','Recent Projects','Upcoming Domain Renewals','Upcoming Hosting Renewals','Upcoming AMC Renewals','Recent Activity'].every((t) => has(t)) && !!btn('Add Company', document) && !!btn('Add Project', document)`));
  await s.shot("01-dashboard.jpg");

  await s.go("/admin/project-tracker/companies");
  await s.until(`has('Sl. No.') || has('No companies')`, 10000);
  await s.js(`click('Add Company', document)`); await s.until("dialogs() === 1");
  await s.js(`click('Add company')`); await sleep(400);
  check("C3. Empty company form shows validation", await s.js(`has('Company Name is required.')`));
  await s.js(`fillAll({ 'Contact Email': 'not-an-email', 'Contact Phone': 'call me' }); click('Add company')`); await sleep(300);
  check("Company email and phone validated", await s.js(`has('Enter a valid email address.') && has('Use digits, spaces')`));
  await s.js(`fillAll({ 'Company Name': ${JSON.stringify(CO_NAME.A1)}, 'Company Code': 'FA1-${RUN}', 'Company Type': 'private_limited', 'Contact Email': 'contact@a1-${RUN}.example',
    'Contact Phone': '+91 90000 00001', 'City': 'Guntur', 'State': 'Andhra Pradesh' }); click('Add company')`);
  await s.until(`/\\/companies\\/[0-9a-f-]{36}$/.test(location.pathname)`, 10000);
  CO.A1 = (await s.js("location.pathname")).split("/").pop();
  check("C4. Company A1 added; its details page opens", /^[0-9a-f-]{36}$/.test(CO.A1) && await s.until(`has(${JSON.stringify(CO_NAME.A1)}) && /ZT-CO-\\d{4}/.test(document.body.innerText)`));
  for (const k of ["A2", "A3"]) {
    await s.go("/admin/project-tracker/companies");
    await s.until(`!!btn('Add Company', document)`);
    await s.js(`click('Add Company', document)`); await s.until("dialogs() === 1");
    await s.js(`fillAll({ 'Company Name': ${JSON.stringify(CO_NAME[k])}, 'Company Type': 'llp' }); click('Add company')`);
    await s.until(`/\\/companies\\/[0-9a-f-]{36}$/.test(location.pathname)`, 10000);
    CO[k] = (await s.js("location.pathname")).split("/").pop();
  }
  check("C5. Companies A2 and A3 added", Boolean(CO.A2 && CO.A3 && CO.A2 !== CO.A3));
  await s.go("/admin/project-tracker/companies");
  await s.until(`!!btn('Add Company', document)`);
  await s.js(`click('Add Company', document)`); await s.until("dialogs() === 1");
  await s.js(`fillAll({ 'Company Name': ${JSON.stringify(CO_NAME.A1.toLowerCase())} }); click('Add company')`); await sleep(1200);
  check("Duplicate company name rejected", await s.js(`has('An active company with this name already exists.')`));
  await s.js(`click('Cancel')`); await s.until("dialogs() === 0");
  await s.js(`(() => { setVal(document.getElementById('pt-co-q'), ${JSON.stringify(RUN)}); click('Search', document); return 1; })()`);
  check("C6. Companies list search shows the three companies", await s.until(`[...document.querySelectorAll('tbody tr')].filter((r) => r.innerText.includes(${JSON.stringify(RUN)})).length === 3`, 8000));

  // C7–C8: add three projects under A1 from the company page (company preselected)
  await s.go(`/admin/project-tracker/companies/${CO.A1}`);
  await s.until(`!!btn('Add Project', document)`);
  const a1Projects = [["A1 P1 " + RUN, "live"], ["A1 P2 " + RUN, "in_progress"], ["A1 P3 " + RUN, "under_maintenance"]];
  let preselected = true;
  for (const [name, status] of a1Projects) {
    await s.js(`click('Add Project', document)`); await s.until("dialogs() === 1 && !!field('Company')", 8000);
    preselected = preselected && (await s.js(`field('Company').value === ${JSON.stringify(CO.A1)}`));
    await s.js(`fillAll({ 'Project Name': ${JSON.stringify(name)}, 'Current Status': ${JSON.stringify(status)} }); click('Create project')`);
    await s.until("dialogs() === 0", 8000);
    await s.until(`!!row(${JSON.stringify(name)})`, 8000);
  }
  check("C7. Add Project from a company page preselects that company", preselected);
  check("C8. Three projects listed under Company A1", (await s.js(`[...document.querySelectorAll('tbody tr')].filter((r) => r.innerText.includes(${JSON.stringify(RUN)})).length`)) === 3);
  check("C9. Company project summary counts (3 total · 1 live · 1 in progress · 1 maintenance)", await s.js(`(() => { const v = (l) => { const a = [...document.querySelectorAll('section[aria-label="Project summary"] a')].find((x) => x.innerText.startsWith(l)); return a && a.innerText.split('\\n').pop().trim(); };
    return v('Total Projects') === '3' && v('Live Projects') === '1' && v('In Progress') === '1' && v('Under Maintenance') === '1'; })()`));
  check("Company breadcrumb: Project Tracker → Companies → name → Projects", await s.js(`(() => { const t = document.querySelector('nav[aria-label="Project Tracker breadcrumb"]').innerText; return ['Project Tracker','Companies',${JSON.stringify(CO_NAME.A1)},'Projects'].every((x) => t.includes(x)); })()`));
  await s.shot("02-company-a1.jpg");

  // C10: open a project from the company → breadcrumb Companies → Company → Projects → Project
  await rowAct(s, "A1 P1 " + RUN, "View");
  await s.until(`location.pathname.includes('/projects/')`, 8000);
  check("C10. Project opened from company shows company breadcrumb and header", await s.until(`(() => { const b = document.querySelector('nav[aria-label="Project Tracker breadcrumb"]'); return b && ['Companies',${JSON.stringify(CO_NAME.A1)},'Projects','A1 P1 ${RUN}'].every((x) => b.innerText.includes(x)); })()`, 8000)
    && await s.js(`[...document.querySelectorAll('header a')].some((a) => a.innerText === ${JSON.stringify(CO_NAME.A1)})`));
  check("Project overview has Project Summary, Key Information and Handover Checklist", await s.until(`has('Project Summary') && has('Key Information') && has('Handover Checklist') && has('Recent Activity')`, 8000));

  // C11: Company A1 projects never appear under Company A2
  await s.go(`/admin/project-tracker/companies/${CO.A2}`);
  await s.until(`has(${JSON.stringify(CO_NAME.A2)}) && (has('No projects yet') || !!document.querySelector('tbody tr'))`, 8000);
  check("C11. Company A1 projects do not appear under Company A2", await s.js(`!has('A1 P1 ${RUN}') && !has('A1 P2 ${RUN}') && !has('A1 P3 ${RUN}')`));
  await s.js(`click('Add Project', document)`); await s.until("dialogs() === 1 && !!field('Company')", 8000);
  await s.js(`fillAll({ 'Project Name': 'A2 P1 ${RUN}', 'Current Status': 'planned' }); click('Create project')`);
  await s.until("dialogs() === 0", 8000);
  check("Project added under Company A2", await s.until(`!!row('A2 P1 ${RUN}')`, 8000));

  // C12: edit a company
  await s.go(`/admin/project-tracker/companies/${CO.A1}`);
  await s.until(`!!btn('Edit Company', document)`);
  await s.js(`click('Edit Company', document)`); await s.until("dialogs() === 1");
  await s.js(`fill('City', 'Vijayawada'); fill('Remarks', 'Edited by flow ${RUN}'); click('Save changes')`);
  await s.until("dialogs() === 0", 8000);
  check("C12. Company edited and saved", await s.until(`has('Vijayawada') && has('Edited by flow ${RUN}')`, 8000));

  // C13: archiving a company with active projects is refused
  await s.js(`click('Archive', document.querySelector('main header'))`); await s.until("dialogs() === 1");
  await s.js(`fill('Reason for archiving', 'flow test'); click('Archive company')`); await sleep(1500);
  check("C13. Company with active projects cannot be archived", await s.js(`has('still has 3 active project(s)')`));
  await s.js(`click('Cancel')`); await s.until("dialogs() === 0");

  // C14: archive and restore an empty company
  await s.go(`/admin/project-tracker/companies/${CO.A3}`);
  await s.until(`!!btn('Archive', document)`);
  await s.js(`click('Archive', document.querySelector('main header'))`); await s.until("dialogs() === 1");
  await s.js(`fill('Reason for archiving', 'flow archive test'); click('Archive company')`);
  await s.until("dialogs() === 0", 8000);
  check("C14a. Empty company archived (read-only, no Add Project)", await s.until(`has('This company is archived and read-only') && !btn('Add Project', document)`, 8000));
  await s.js(`click('Restore company', document)`); await s.until("dialogs() === 1"); await s.js(`click('Restore')`); await s.until("dialogs() === 0", 8000);
  check("C14b. Manager restores the company", await s.until(`!has('archived and read-only') && !!btn('Add Project', document)`, 8000));
  await s.close();

  // ====================================================== editor: build a project
  s = await session();
  check("1. Admin logs in and lands in Project Tracker", (await login(s, "pt.editor@example.test")) === "/admin/project-tracker");
  await s.until(`has('Recent Projects')`, 30000);

  // create project from the dashboard (company must be chosen)
  await s.js(`click('Add Project', document)`);
  await s.until("dialogs() === 1 && !!field('Company')", 10000);
  await s.js(`click('Create project')`);
  await sleep(500);
  check("Empty project form shows validation messages (company and name required)", await s.js(`has('Project Name is required.') && has('Company is required.')`));
  await s.js(`fillAll({ 'Company': ${JSON.stringify(CO.A1)}, 'Project Name': 'Flow Portal ${RUN}', 'Project Type': 'web_application', 'Current Status': 'in_progress',
    'Priority': 'high', 'Project Progress (%)': '45', 'Project Responsible Person': 'Test Lead', 'Start Date': '${iso(-90)}', 'Expected Completion Date': '${iso(30)}',
    'Live URL': 'https://flow-${RUN}.example', 'Project Description': 'Synthetic flow project', 'Project Scope': 'Portal, admin, integrations (synthetic)' })`);
  await s.js(`fill('Expected Completion Date', '${iso(-100)}'); click('Create project')`);
  await sleep(500);
  check("Date-order validation (expected completion before start)", await s.js(`has('Expected completion cannot be before the start date.')`));
  await s.js(`fill('Expected Completion Date', '${iso(30)}'); click('Create project')`);
  await s.until(`/\\/projects\\/[0-9a-f-]{36}$/.test(location.pathname)`, 10000);
  projectA = (await s.js("location.pathname")).split("/").pop();
  check("3. Project created and its workspace opens", /^[0-9a-f-]{36}$/.test(projectA), projectA);
  await s.until(`has('Flow Portal ${RUN}')`);
  check("Automatic project ID shown", await s.js(`/ZT-PRJ-\\d{4}/.test(document.body.innerText)`));
  const tabs = await s.js(`[...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim())`);
  check("7. Workspace has all 13 sections", tabs.length === 13, tabs.join(" / "));
  check("Header shows company, status, live URL, responsible, last updated, completeness", await s.js(`[${JSON.stringify(CO_NAME.A1)},'In Progress','flow-${RUN}.example','Test Lead','Last updated','Generate Report','Edit Project'].every((t) => has(t)) && /\\d+% · /.test(document.body.innerText)`));

  // edit project
  await s.js(`click('Edit Project', document)`);
  await s.until("dialogs() === 1 && !!field('Current Status')", 10000);
  await s.js(`fill('Current Status', 'live'); fill('Remarks', 'Edited by flow ${RUN}'); click('Save changes')`);
  await s.until("dialogs() === 0");
  await s.until(`has('Edited by flow ${RUN}')`);
  check("6. Project edited (status → Live, remarks)", await s.js(`has('Live') && has('Edited by flow ${RUN}')`));

  // hosting x2
  await tabGo(s, "Hosting & Servers"); await s.until(`has('Add hosting record')`);
  let t1 = await addRecord(s, "Add hosting record", { "Hosting Provider": "Lovable", "Hosting Purpose": "frontend", Environment: "production", "Renewal Date": iso(10), "Responsible Person": "Ops A", "Server IP / Hostname": "flow.lovable.app" });
  let t2 = await addRecord(s, "Add hosting record", { "Hosting Provider": "Supabase", "Hosting Purpose": "database", Environment: "production", "Renewal Date": iso(40), "Control Panel URL": "https://supabase.example/dashboard" });
  await s.until(`document.querySelectorAll('tbody tr').length >= 2`);
  check("8. Two hosting records added", /added/i.test(t1) && /added/i.test(t2) && (await s.js(`row('Lovable') && row('Supabase') ? 1 : 0`)) === 1, `${t1} / ${t2}`);
  const badUrl = await addRecord(s, "Add hosting record", { "Hosting Provider": "Bad", "Control Panel URL": "javascript:alert(1)" }, { expectOk: false });
  check("Unsafe URL rejected in the form", /full URL/.test(badUrl), badUrl);
  await s.js(`click('Cancel')`); await s.until("dialogs() === 0");
  const secretTry = await addRecord(s, "Add hosting record", { "Hosting Provider": "Hostinger VPS", Remarks: "root password: Hunter22x!" }, { expectOk: false });
  check("Password typed into remarks is rejected", /looks like a password/.test(secretTry), secretTry);
  await s.js(`click('Cancel')`); await s.until("dialogs() === 0");

  // domains x2
  await tabGo(s, "Domains & SSL"); await s.until(`has('Add domain')`);
  t1 = await addRecord(s, "Add domain", { "Domain Name": `flow-${RUN}.example`, "Primary / Secondary": "primary", "Domain Registrar": "Test Registrar", "Domain Expiry Date": iso(20), "SSL Type": "managed_auto" });
  t2 = await addRecord(s, "Add domain", { "Domain Name": `app.flow-${RUN}.example`, "Primary / Secondary": "subdomain" });
  check("9. Two domains added", /added/i.test(t1) && /added/i.test(t2), `${t1} / ${t2}`);
  const dupDom = await addRecord(s, "Add domain", { "Domain Name": `flow-${RUN}.example`, "Primary / Secondary": "secondary" }, { expectOk: false });
  check("Duplicate domain rejected with a clear message", /already recorded/.test(dupDom), dupDom);
  await s.js(`click('Cancel')`); await s.until("dialogs() === 0");

  // emails x2 + duplicate
  await tabGo(s, "Emails & Accounts"); await s.until(`has('Add email account')`);
  t1 = await addRecord(s, "Add email account", { "Email Address": `admin@flow-${RUN}.example`, Purpose: "admin", "Email Provider": "Zoho Mail", "Two-Factor Authentication": "enabled" });
  t2 = await addRecord(s, "Add email account", { "Email Address": `support@flow-${RUN}.example`, Purpose: "support" });
  check("10. Two email accounts added", /added/i.test(t1) && /added/i.test(t2), `${t1} / ${t2}`);
  const dupMail = await addRecord(s, "Add email account", { "Email Address": `admin@flow-${RUN}.example`, Purpose: "billing" }, { expectOk: false });
  check("Same mailbox for another purpose needs a justification", /reuse justification/i.test(dupMail), dupMail);
  await s.js(`fill('Reuse Justification', 'Client uses one mailbox for billing too'); click('Create')`);
  check("Justified reuse accepted", await s.until("dialogs() === 0"));

  // credentials
  await tabGo(s, "Credentials & Access"); await s.until(`has('Add access record')`);
  t1 = await addRecord(s, "Add access record", { "Credential Type": "website_admin", "Service / Website Name": "Flow WP admin", "Login / Dashboard URL": `https://flow-${RUN}.example/wp-admin`, "2FA Status": "enabled" });
  check("Access record added (vault disabled: no password saved)", /added/i.test(t1), t1);
  check("Vault-not-configured banner shown", await s.js(`has('vault') && /not configured|disabled/i.test(document.body.innerText)`));
  check("Password column shows Not stored; reveal/copy disabled", await s.until(`has('Vault not configured') && ![...document.querySelectorAll('button')].some((b) => /^(Show|Copy) password/i.test(b.getAttribute('aria-label') || '') && !b.disabled)`));
  await rowAct(s, `Flow WP admin`, `Set reference`); await s.until("dialogs() === 1");
  check("Reference form has no password input", await s.js(`![...scope().querySelectorAll('input')].some((i) => i.type === 'password')`));
  await s.js(`fill('Username / Account Identifier', 'flow.admin@flow-${RUN}.example'); fill('Password-manager reference', 'password: Xy7abc99'); click('Save reference')`);
  await sleep(400);
  check("Secret-looking reference rejected", await s.js(`has('looks like a password')`));
  await s.js(`fill('Password-manager reference', ${JSON.stringify(VAULT_REF)}); click('Save reference')`);
  await s.until("dialogs() === 0");
  await s.until(`has('fl•••@flow-${RUN}.example')`);
  check("11. Credential reference saved; identifier shown masked", await s.js(`has('fl•••@flow-${RUN}.example') && !has(${JSON.stringify(VAULT_REF)})`));
  check("Editor has no 'View reference' action", await s.js(`!btn('View reference', document)`));
  // No vault: the password input is shown but locked, and the server refuses every password operation.
  await s.js(`click('Add access record', document)`); await s.until("dialogs() === 1");
  check("Vault disabled: password input in the credential form is disabled", await s.js(`(() => { const i = scope().querySelector('input[type=password]'); return !!i && i.disabled; })()`));
  await s.js(`click('Cancel')`); await s.until("dialogs() === 0");
  {
    const edTok = await apiToken("pt.editor@example.test");
    const mgTok = await apiToken("pt.manager@example.test");
    const settings = await (await rest("rpc/pt_settings_public", edTok, { method: "POST", body: "{}" })).json();
    check("Vault disabled: server reports password_backend = disabled", settings?.password_backend === "disabled", JSON.stringify(settings));
    const recId = (await (await rest(`pt_access_records?select=id&project_id=eq.${projectA}&limit=1`, edTok)).json())[0]?.id;
    const setR = await rest("rpc/pt_set_access_password", edTok, { method: "POST", body: JSON.stringify({ p_record: recId, p_password: "Synthetic-Disabled-1!" }) });
    const setBody = await setR.text();
    check("Vault disabled: saving a password is refused by the server", setR.status >= 400 || /"ok"\s*:\s*false/.test(setBody), `${setR.status} ${setBody.slice(0, 120)}`);
    const rev = await (await rest("rpc/pt_reveal_access_password", mgTok, { method: "POST", body: JSON.stringify({ p_record: recId, p_purpose: "reveal" }) })).json();
    check("Vault disabled: reveal returns no password (reason disabled)", rev && rev.ok === false && !("password" in rev), JSON.stringify(rev));
    const has = (await (await rest(`pt_access_records?select=has_password&project_id=eq.${projectA}`, mgTok)).json());
    check("Vault disabled: no credential has a stored password", Array.isArray(has) && has.every((r) => r.has_password === false), JSON.stringify(has).slice(0, 120));
    const sec = await rest("pt_access_secrets?select=*", mgTok);
    check("Vault mapping table is not readable through the API", sec.status >= 400 || (await sec.json()).length === 0, String(sec.status));
  }

  // backups
  await tabGo(s, "Backups & Recovery"); await s.until(`has('Add backup record')`);
  const noEvidence = await addRecord(s, "Add backup record", { "Backup Name": "Nightly DB", "Backup Status": "completed" }, { expectOk: false });
  check("Completed backup without date/location is refused", /Backup Date and Time is required|Storage Location/.test(await s.js("document.querySelector('[role=dialog]').innerText")), noEvidence);
  await s.js(`fillAll({ 'Backup Date and Time': '${localDT(-1)}', 'Storage Location / Protected Reference': 'Supabase PITR (flow)', 'Backup Frequency': 'daily', 'Restore Instructions': 'Use PITR to the last hour; runbook in Documents' }); click('Create')`);
  check("12. Backup record added (completed, with evidence)", await s.until("dialogs() === 0"));
  await rowAct(s, `Nightly DB`, `Edit`); await s.until("dialogs() === 1");
  await s.js(`fill('Backup Status', 'verified')`); await sleep(200);
  await s.js(`fillAll({ 'Verified By': 'Flow QA', 'Verification Date': '${iso(0)}', 'Verification Evidence': 'ok' }); click('Save changes')`);
  await sleep(400);
  check("Verification with too little evidence is refused", await s.js(`has('at least 10 characters')`));
  await s.js(`fill('Verification Evidence', 'Downloaded dump, checksum matched, row counts compared'); click('Save changes')`);
  await s.until("dialogs() === 0");
  check("13. Backup verification recorded", await s.until(`row('Nightly DB') && row('Nightly DB').innerText.includes('Verified')`));

  // source + deployments
  await tabGo(s, "Source Code & Deployments"); await s.until(`has('Add repository')`);
  t1 = await addRecord(s, "Add repository", { "Repository URL": `https://github.com/example-org/flow-${RUN}`, "Main Branch": "main", "Deployment Branch": "release" });
  t2 = await addRecord(s, "Add deployment", { "Deployment Date": localDT(0), "Release Version": "v1.0.0", "Commit Reference": "abc1234" });
  check("14. Repository and deployment recorded", /added/i.test(t1) && /added/i.test(t2), `${t1} / ${t2}`);

  // updates
  await tabGo(s, "Updates & Maintenance"); await s.until(`has('Add update')`);
  t1 = await addRecord(s, "Add update", { "Update Type": "security_update", Description: `Patched dependencies (flow ${RUN})`, Version: "v1.0.1", "Testing Status": "passed" });
  check("15. Update logged (Updated By defaults to the signed-in user)", /added/i.test(t1), t1);
  await tabGo(s, "Overview");
  check("Latest update shown prominently on the overview", await s.until(`has('Latest update') && has('Patched dependencies (flow ${RUN})')`));

  // AMC + renewals
  await tabGo(s, "AMC & Renewals"); await s.until(`has('AMC applicability')`);
  await s.js(`field('This project has (or should have) an Annual Maintenance Contract').click()`);
  await s.until(`toasts().includes('AMC marked applicable')`);
  t1 = await addRecord(s, "Add AMC contract", { "Contract Number": `AMC-${RUN}`, "Contract Start Date": iso(-300), "Contract End Date": iso(60), "Renewal Date": iso(14), "Maintenance Frequency": "monthly" });
  check("16. AMC contract created", /added/i.test(t1), t1);
  await rowAct(s, `AMC-${RUN}`, `Renew`); await s.until("dialogs() === 1");
  await s.js(`fill('New contract number', 'AMC-${RUN}-2'); click('Renew contract')`);
  await s.until("dialogs() === 0");
  check("AMC renewed (old contract kept as Renewed)", await s.until(`row('AMC-${RUN}-2') && [...document.querySelectorAll('tbody tr')].some((r) => r.innerText.includes('AMC-${RUN}') && r.innerText.includes('Renewed'))`));
  t1 = await addRecord(s, "Add renewal", { "Renewal Type": "subscription", Item: "Email marketing plan", "Due Date": iso(25), Amount: "1200" });
  await rowAct(s, `Email marketing plan`, `Complete`); await s.until("dialogs() === 1");
  await s.js(`click('Complete renewal')`); await sleep(300);
  check("Renewal completion requires evidence", await s.js(`has('Describe the evidence')`));
  await s.js(`fill('Completion evidence', 'Invoice FL-${RUN} paid'); click('Complete renewal')`);
  await s.until("dialogs() === 0");
  check("17. Renewal recorded and completed", /added/i.test(t1) && await s.until(`row('Email marketing plan') && row('Email marketing plan').innerText.includes('Completed')`), t1);
  check("Upcoming expiries view lists hosting renewal (10 days)", await s.js(`has('Upcoming expiries') && has('Lovable')`));

  // SEO
  await tabGo(s, "SEO & Analytics"); await s.until(`has('SEO applicability')`);
  check("SEO section states it is documentation only", await s.js(`has('does not connect to Google')`));
  await s.js(`field('SEO applies to this project').click()`); await s.until(`toasts().includes('SEO marked applicable')`);
  const badGa = await addRecord(s, "Add SEO record", { "GA4 Measurement ID": "UA-1234" }, { expectOk: false });
  check("GA4 ID format validated", /G-XXXX/.test(badGa), badGa);
  await s.js(`fillAll({ 'GA4 Measurement ID': 'G-FLOW12345', 'Google Search Console Property': 'sc-domain:flow-${RUN}.example', 'Verification Status': 'verified', 'Sitemap URL': 'https://flow-${RUN}.example/sitemap.xml' }); click('Create')`);
  await s.until("dialogs() === 0");
  check("18. SEO documented; only one active SEO record allowed (Add hidden)", await s.until(`has('G-FLOW12345') && !btn('Add SEO record', document)`));

  // tasks & milestones
  await tabGo(s, "Tasks & Milestones"); await s.until(`has('Add milestone')`);
  t1 = await addRecord(s, "Add milestone", { "Milestone Name": "Go-live", "Target Date": iso(15) });
  t2 = await addRecord(s, "Add task", { "Task Title": "Configure payments sandbox", "Assigned Person": "Dev A", "Due Date": iso(-2), Status: "in_progress" });
  check("19. Milestone and task created", /added/i.test(t1) && /added/i.test(t2), `${t1} / ${t2}`);
  check("Overdue task flagged", await s.js(`/overdue/.test(row('Configure payments').innerText)`));

  // documents
  await tabGo(s, "Documents & Handover"); await s.until(`has('Upload / link')`);
  await s.js(`click('Upload / link', document)`); await s.until("dialogs() === 1");
  await s.setFile("#pt-doc-file", PDF);
  await sleep(300);
  await s.js(`fillAll({ 'Document name': 'Client sign-off ${RUN}', 'Document category': 'client_approval', 'Version': '1' }); click('Upload')`);
  const upOk = await s.until("dialogs() === 0", 10000);
  check("20a. Private document uploaded", upOk && await s.until(`has('Client sign-off ${RUN}')`), upOk ? "" : await s.js("alerts()"));
  await s.js(`click('Upload / link', document)`); await s.until("dialogs() === 1");
  await s.js(`[...scope().querySelectorAll('input[type=radio]')][1].click()`); await sleep(200);
  await s.js(`fillAll({ 'External link': 'https://drive.example/flow-guide', 'Document name': 'User guide ${RUN}', 'Document category': 'user_guide' }); click('Add link')`);
  check("External-link document added", await s.until("dialogs() === 0"));
  check("Restricted classification not offered to editors", await s.js(`(() => { click('Upload / link', document); return true; })()`) && await s.until("dialogs() === 1") && !(await s.js(`[...field('Visibility / access classification').options].some((o) => o.value === 'restricted')`)));
  await s.js(`click('Cancel')`); await s.until("dialogs() === 0");
  const before = readdirSync(DL).length;
  await rowAct(s, `Client sign-off ${RUN}`, `Download`);
  let got = null;
  for (let i = 0; i < 40 && !got; i++) { await sleep(250); got = readdirSync(DL).find((f) => f.endsWith(".pdf") && !f.endsWith(".crdownload")); }
  check("20b. Private document downloads through a signed URL with identical bytes", got && readFileSync(path.join(DL, got)).equals(readFileSync(PDF)), `${before} → ${got}`);
  const signed = await s.js(`(async () => { const { supabase } = await import('/src/lib/supabase/client.js'); const d = (await supabase.from('pt_documents').select('storage_path').eq('name', 'Client sign-off ${RUN}')).data[0];
    const r = await supabase.storage.from('project-tracker-documents').createSignedUrl(d.storage_path, 60); return r.data.signedUrl; })()`);
  const tampered = signed.replace(/token=([^&]+)/, (m, tok) => `token=${tok.slice(0, -4)}AAAA`);
  check("Tampered signed URL is rejected", (await fetch(tampered)).status >= 400);
  const unsignedPublic = await fetch(`${API}/storage/v1/object/public/project-tracker-documents/x`);
  check("No public URL access to the private bucket", unsignedPublic.status >= 400, String(unsignedPublic.status));

  // multi-file upload with per-file progress
  const mk = (name, buf) => { const f = path.join(OUT, name); writeFileSync(f, buf); return f; };
  const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const SPEC1 = Buffer.from(`synthetic docx v1 ${RUN}`);
  const multi = [
    mk(`deck-${RUN}.pptx`, Buffer.from(`synthetic pptx ${RUN}`)),
    mk(`spec-${RUN}.docx`, SPEC1),
    mk(`budget-${RUN}.xlsx`, Buffer.from(`synthetic xlsx ${RUN}`)),
    mk(`legacy-${RUN}.ppt`, Buffer.from(`synthetic ppt ${RUN}`)),
    mk(`notes-${RUN}.txt`, Buffer.from(`Synthetic release notes ${RUN}\nSecond line.`)),
    mk(`logo-${RUN}.png`, PNG1),
  ];
  await s.js(`click('Upload / link', document)`); await s.until("dialogs() === 1");
  await s.setFile("#pt-doc-file", multi);
  check("D1. Six files selected at once are listed, each with its own name", await s.until(`scope().querySelectorAll('li').length === 6 && !!btn('Upload 6 files')`), await s.js("scope().innerText.slice(0, 200)"));
  await s.js(`fillAll({ 'Document category': 'technical_documentation', 'Description': 'Synthetic multi-upload ${RUN}' })`);
  await s.js(`(() => { window.__prog = new Set(); const rec = () => document.querySelectorAll('[role=progressbar]').forEach((p) => window.__prog.add(p.getAttribute('aria-label') + '=' + p.getAttribute('aria-valuenow')));
    window.__progObs = new MutationObserver(rec); window.__progObs.observe(document.body, { subtree: true, childList: true, attributes: true }); return 1; })()`);
  await s.js(`click('Upload 6 files')`);
  const multiOk = await s.until("dialogs() === 0", 20000);
  const prog = await s.js("[...window.__prog]");
  check("D2. Multi-file upload completes (pptx, docx, xlsx, ppt, txt, png)", multiOk && await s.until(`['deck','spec','budget','legacy','notes','logo'].every((n) => has(n + '-${RUN}'))`), multiOk ? "" : await s.js("alerts()"));
  check("D3. Upload progress shown for every file (reaches 100%)", multi.every((f) => prog.includes(`Upload progress ${path.basename(f)}=100`)), prog.slice(0, 8).join(","));

  // drag and drop
  await s.js(`click('Upload / link', document)`); await s.until("dialogs() === 1");
  await s.js(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['%PDF-1.4 dropped ${RUN}'], 'dropped-${RUN}.pdf', { type: 'application/pdf' }));
    const dz = scope().querySelector('[data-pt-dropzone]'); dz.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    dz.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return 1; })()`);
  check("D4. Drag-and-drop adds the file to the upload list", await s.until(`scope().innerText.includes('dropped-${RUN}.pdf')`));
  await s.js(`click('Upload')`);
  check("Dropped file uploaded", await s.until("dialogs() === 0", 10000) && await s.until(`has('dropped-${RUN}')`));

  // rejected types and sizes (client)
  const EXE = mk(`setup-${RUN}.exe`, Buffer.from("MZ synthetic"));
  const SVG = mk(`icon-${RUN}.svg`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  const BIG = path.join(OUT, `huge-${RUN}.pdf`);
  { const fd = fs.openSync(BIG, "w"); fs.writeSync(fd, Buffer.from("%PDF-1.4\n")); fs.ftruncateSync(fd, 51 * 1024 * 1024); fs.closeSync(fd); }
  await s.js(`click('Upload / link', document)`); await s.until("dialogs() === 1");
  await s.setFile("#pt-doc-file", [EXE, SVG, BIG]);
  await s.until("scope().querySelectorAll('li').length === 3");
  const errs = await s.js("[...scope().querySelectorAll('li')].map((l) => l.innerText).join(' | ')");
  check("D5. .exe rejected in the browser", /\.exe are not allowed/.test(errs), errs.slice(0, 160));
  check("D6. .svg rejected in the browser", /\.svg are not allowed/.test(errs));
  check("D7. File over 50 MB rejected in the browser", /larger than 50 MB/.test(errs));
  await s.js(`click('Upload 3 files')`); await sleep(500);
  check("Upload is blocked while rejected files remain", await s.js(`dialogs() === 1 && has('Remove the files that cannot be uploaded', scope())`));
  await s.js(`click('Cancel')`); await s.until("dialogs() === 0");

  // rejected types and sizes (server; the browser checks are bypassed)
  {
    const edTok = await apiToken("pt.editor@example.test");
    const raw = async (name, type, body) => {
      const key = `${projectA}/${randomUUID()}/${name}`;
      // A storage server may close the connection once the size limit is passed (counts as refused).
      const up = await fetch(`${API}/storage/v1/object/project-tracker-documents/${key}`, { method: "POST", headers: { apikey: STATE.anonKey, Authorization: `Bearer ${edTok}`, "Content-Type": type }, body })
        .catch((e) => ({ status: 499, closed: e.message }));
      const ins = await rest("pt_documents", edTok, { method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ project_id: projectA, name: `raw ${name}`, category: "other", classification: "internal", storage_path: key, file_name: name, mime_type: "application/pdf", size_bytes: 10 }) });
      return { up: up.status, ins: ins.status, msg: (await ins.text()).slice(0, 120) };
    };
    const rExe = await raw(`x-${RUN}.exe`, "application/pdf", Buffer.from("MZ"));
    check("D8. Server refuses an .exe even when it claims to be a PDF", rExe.ins >= 400, JSON.stringify(rExe));
    const rSvg = await raw(`x-${RUN}.svg`, "image/svg+xml", Buffer.from("<svg/>"));
    check("D9. Server refuses an .svg", rSvg.up >= 400 || rSvg.ins >= 400, JSON.stringify(rSvg));
    const rHtml = await raw(`x-${RUN}.pdf`, "text/html", Buffer.from("<html>"));
    check("Server refuses a .pdf whose stored content type is HTML", rHtml.up >= 400 || rHtml.ins >= 400, JSON.stringify(rHtml));
    const rBig = await raw(`big-${RUN}.pdf`, "application/pdf", fs.readFileSync(BIG));
    check("D10. Server refuses a file over the 50 MB limit", rBig.up >= 400 || rBig.ins >= 400, JSON.stringify(rBig));
    const leaked = await (await rest(`pt_documents?select=id&project_id=eq.${projectA}&name=like.raw*`, edTok)).json();
    check("No document record exists for any refused file", Array.isArray(leaked) && leaked.length === 0, JSON.stringify(leaked));
  }

  // new version + history
  const SPEC2 = path.join(OUT, "v2", `spec-${RUN}.docx`);
  fs.mkdirSync(path.dirname(SPEC2), { recursive: true }); writeFileSync(SPEC2, Buffer.from(`synthetic docx v2 ${RUN}`));
  await rowAct(s, `spec-${RUN}`, "New version"); await s.until("dialogs() === 1");
  check("D11. New-version form names the document it replaces", await s.js(`has('New version — spec-${RUN}', scope())`));
  await s.setFile("#pt-doc-file", SPEC2);
  await s.until("scope().querySelectorAll('li').length === 1");
  await s.js(`fillAll({ 'Version': '2.0', 'Description': 'Revised spec (synthetic)' }); click('Upload')`);
  check("D12. New version uploaded", await s.until("dialogs() === 0", 10000));
  await s.until(`[...document.querySelectorAll('tbody tr')].filter((r) => r.innerText.includes('spec-${RUN}')).length === 1 && row('spec-${RUN}').innerText.includes('2.0')`);
  check("D13. Only the current version is listed by default", await s.js(`[...document.querySelectorAll('tbody tr')].filter((r) => r.innerText.includes('spec-${RUN}')).length === 1 && row('spec-${RUN}').innerText.includes('2.0')`));
  await s.js(`fill('Show previous versions', true)`);
  check("D14. 'Show previous versions' lists the replaced version marked Previous", await s.until(`(() => { const rs = [...document.querySelectorAll('tbody tr')].filter((r) => r.innerText.includes('spec-${RUN}')); return rs.length === 2 && rs.some((r) => r.innerText.includes('Previous')); })()`));
  check("A previous version offers no 'New version' action", await s.js(`(() => { const r = [...document.querySelectorAll('tbody tr')].find((x) => x.innerText.includes('spec-${RUN}') && x.innerText.includes('Previous')); return !btn('New version', r); })()`));
  await s.js(`fill('Show previous versions', false)`); await sleep(300);
  await rowAct(s, `spec-${RUN}`, "History"); await s.until("dialogs() === 1");
  await s.until("scope().querySelectorAll('tbody tr').length === 2");
  check("D15. Version history shows both versions (Current 2.0, Previous)", await s.js(`scope().querySelectorAll('tbody tr').length === 2 && has('Current', scope()) && has('Previous', scope()) && has('2.0', scope())`));
  const dlBefore = new Set(readdirSync(DL));
  await s.js(`(() => { const r = [...scope().querySelectorAll('tbody tr')].find((x) => x.innerText.includes('Previous')); return click('Download', r); })()`);
  let v1 = null;
  for (let i = 0; i < 40 && !v1; i++) { await sleep(250); v1 = readdirSync(DL).find((f) => !dlBefore.has(f) && f.endsWith(".docx")); }
  check("D16. A previous version can still be downloaded with its original bytes", v1 && readFileSync(path.join(DL, v1)).equals(SPEC1), String(v1));
  await s.js(`click('Close')`); await s.until("dialogs() === 0");
  {
    const edTok = await apiToken("pt.editor@example.test");
    const old = (await (await rest(`pt_documents?select=id,is_current&project_id=eq.${projectA}&name=eq.spec-${RUN}&is_current=eq.false`, edTok)).json())[0];
    const key = `${projectA}/${randomUUID()}/spec-again.docx`;
    await fetch(`${API}/storage/v1/object/project-tracker-documents/${key}`, { method: "POST", headers: { apikey: STATE.anonKey, Authorization: `Bearer ${edTok}`, "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, body: Buffer.from("x") });
    const r = await rest("pt_documents", edTok, { method: "POST", body: JSON.stringify({ project_id: projectA, name: `spec-${RUN}`, category: "other", classification: "internal", storage_path: key, file_name: "spec-again.docx", supersedes_id: old?.id }) });
    check("Server refuses to replace a version that is no longer current", r.status >= 400 && /current, active version/.test(await r.text()), String(r.status));
  }

  // safe preview (text + image only; office files are download-only)
  await rowAct(s, `notes-${RUN}`, "Preview"); await s.until("dialogs() === 1");
  check("D17. Text preview shows the file content as plain text", await s.until(`has('Synthetic release notes ${RUN}', scope()) && !!scope().querySelector('pre')`));
  await s.js(`click('Close')`); await s.until("dialogs() === 0");
  await rowAct(s, `logo-${RUN}`, "Preview"); await s.until("dialogs() === 1");
  check("D18. Image preview renders the image", await s.until(`(() => { const i = scope().querySelector('img'); return i && i.complete && i.naturalWidth === 1; })()`));
  await s.js(`click('Close')`); await s.until("dialogs() === 0");
  check("No preview offered for Office files", await s.js(`!btn('Preview', row('budget-${RUN}')) && !btn('Preview', row('deck-${RUN}'))`));

  // persistence + access audit
  await s.go(`/admin/project-tracker/projects/${projectA}?tab=documents`);
  check("D19. Uploaded documents persist after reload", await s.until(`['deck','spec','budget','legacy','notes','logo','dropped'].every((n) => has(n + '-${RUN}'))`, 10000));
  {
    const edTok = await apiToken("pt.editor@example.test");
    const acts = (await (await rest(`pt_activity_logs?select=action&project_id=eq.${projectA}&entity_type=eq.document`, edTok)).json()).map((a) => a.action);
    const want = ["document.created", "document.new_version", "document.superseded", "document.downloaded", "document.previewed"];
    check("D20. Access audit records upload, new version, supersede, download and preview", want.every((w) => acts.includes(w)), want.filter((w) => !acts.includes(w)).join(",") || acts.slice(0, 12).join(","));
  }

  // handover
  check("Desktop (1440px): no horizontal page scroll in the project workspace", await s.js("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), await s.js("overflowers().join(' ; ')"));
  check("Documents offer only Upload / link (no empty generic add)", await s.js(`!btn('Add document', document)`));
  await s.js(`click('Start handover', document)`);
  await s.until(`[...document.querySelectorAll('table')].pop().querySelectorAll('tbody tr').length === 15 && !!btn('Edit details', document)`, 10000);
  check("Handover started with a 15-item checklist", await s.js(`[...document.querySelectorAll('table')].pop().querySelectorAll('tbody tr').length === 15`));
  check("Submit is disabled while items are pending", await s.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Submit for review')); return b && b.disabled; })()`));
  await s.js(`click('Edit details', document)`); await s.until("dialogs() === 1");
  await s.js(`fillAll({ 'Recipient name': 'Client Owner', 'Recipient email': 'owner@flow-${RUN}.example', 'Handover date': '${iso(0)}' }); field('Signed approval document').value = ''; true`);
  await s.js(`(() => { const sel = field('Signed approval document'); const o = [...sel.options].find((x) => x.textContent.includes('Client sign-off')); setVal(sel, o.value); click('Save details'); return 1; })()`);
  await s.until("dialogs() === 0");
  const items = await s.js(`[...[...document.querySelectorAll('table')].pop().querySelectorAll('tbody tr')].map((r) => r.cells[0].innerText)`);
  for (const label of items) {
    await s.js(`(() => { const r = [...[...document.querySelectorAll('table')].pop().querySelectorAll('tbody tr')].find((x) => x.cells[0].innerText === ${JSON.stringify(label)}); click('Update', r); return 1; })()`);
    await s.until("dialogs() === 1");
    if (label === "Client approval") {
      await s.js(`[...scope().querySelectorAll('input[type=radio]')][1].click(); click('Save item')`); await sleep(300);
      check("A ticked item without evidence is refused", await s.js(`has('Add evidence')`));
    }
    await s.js(`(() => { [...scope().querySelectorAll('input[type=radio]')][1].click(); fill('Evidence note', 'Confirmed during flow ${RUN}');
      const sel = scope().querySelector('select'); const o = [...sel.options].find((x) => x.textContent.includes('Client sign-off'));
      if (${JSON.stringify(label)} === 'Signed approval document attached') setVal(sel, o.value); click('Save item'); return 1; })()`);
    if (!(await s.until("dialogs() === 0", 6000))) { check(`Handover item saved: ${label}`, false, await s.js("alerts()")); await s.js(`click('Cancel')`); }
  }
  await s.until(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Submit for review')); return b && !b.disabled; })()`, 6000);
  await s.js(`click('Submit for review', document)`); await s.until("dialogs() === 1");
  await s.js(`click('Submit for review')`); await s.until("dialogs() === 0");
  check("21a. Handover submitted for review once every item has evidence", await s.until(`has('Ready for Review')`));
  check("Editor cannot approve (no Approve button)", await s.js(`!btn('Approve', document)`));
  await tabGo(s, "Activity & Remarks"); await s.until(`has('Add a remark')`);
  await s.js(`fill('Add a remark', 'Flow remark ${RUN}'); click('Add remark', document)`);
  check("Remark added and activity history shown (newest first)", await s.until(`has('Flow remark ${RUN}') && has('Remark added') && has('Handover status changed') && has('Signed approval document attached')`));
  check("Activity history never shows the vault reference", await s.js(`!has(${JSON.stringify(VAULT_REF)})`));
  await s.shot("02-project-activity.jpg");
  await s.close();

  // ====================================================== manager
  s = await session();
  await login(s, "pt.manager@example.test", `/admin/project-tracker/projects/${projectA}?tab=access`);
  await s.until(`has('View reference')`);
  await rowAct(s, `Flow WP admin`, `View reference`);
  check("Manager can view the credential reference (audited)", await s.until(`has(${JSON.stringify(VAULT_REF)})`) && await s.js(`has('recorded in the activity log')`));
  await s.js(`click('Hide')`); await s.until("dialogs() === 0");
  await s.go(`/admin/project-tracker/projects/${projectA}?tab=documents`);
  await s.until(`has('Approve')`);
  await s.js(`click('Approve', document)`); await s.until("dialogs() === 1"); await s.js(`click('Approve')`); await s.until("dialogs() === 0");
  check("Manager approves the handover", await s.until(`has('Record handover completed')`));
  await s.js(`click('Record handover completed', document)`); await s.until("dialogs() === 1");
  await s.js(`fill('How was the handover confirmed?', 'short'); click('Record completion')`); await sleep(300);
  check("Completion needs a confirmation statement", await s.js(`has('at least 10 characters')`));
  await s.js(`fill('How was the handover confirmed?', 'Credentials handed over in person; client confirmed by email'); field('I confirm the recipient has received the project, its access and its documentation.').click(); click('Record completion')`);
  await s.until("dialogs() === 0");
  check("21b. Handover completed (Handed Over) with history", await s.until(`has('Handover history (4)') && !btn('Record handover completed', document)`, 10000));
  await s.shot("03-handover-complete.jpg");

  // reports + report page
  await s.go(`/admin/project-tracker/projects/${projectA}/report`);
  await s.until(`has('Project Information Report')`, 10000);
  const report = await s.js("document.querySelector('article').innerText");
  check("22a. Complete project report covers every section", ["Hosting & Servers", "Domains & SSL", "Emails & Accounts", "Credentials & Access", "Backups & Recovery", "Source Repositories", "Deployments", "Updates & Maintenance", "AMC Contracts", "Renewals", "SEO & Analytics", "Milestones", "Tasks", "Documents", "Handover"].every((h) => report.includes(h)));
  check("26a. Project report contains no vault reference or full account identifier", !report.includes(VAULT_REF) && !report.includes(`flow.admin@flow-${RUN}`));
  const pdf = await s.send("Page.printToPDF", { printBackground: true });
  writeFileSync(path.join(OUT, `project-report-${RUN}.pdf`), Buffer.from(pdf.data, "base64"));
  check("Project report prints to PDF", Buffer.from(pdf.data, "base64").subarray(0, 4).toString() === "%PDF");
  const dl0 = new Set(readdirSync(DL));
  await s.js(`click('Excel', document)`);
  let xlsx = null;
  for (let i = 0; i < 60 && !xlsx; i++) { await sleep(250); xlsx = readdirSync(DL).find((f) => !dl0.has(f) && f.endsWith(".xlsx")); }
  check("Project report exports to Excel (.xlsx)", xlsx && readFileSync(path.join(DL, xlsx)).subarray(0, 2).toString() === "PK", xlsx);
  await s.go("/admin/project-tracker/reports");
  await s.until(`has('Project Hosting Register')`);
  const reportNames = await s.js(`[...document.querySelectorAll('nav[aria-label=Reports] button')].map((b) => b.textContent.trim())`);
  check("All 13 reports listed (10 project + 3 company reports)", reportNames.length === 13, reportNames.join(" / "));
  const exported = [];
  for (const name of reportNames.slice(1)) {
    await s.js(`click(${JSON.stringify(name)}, document.querySelector('nav[aria-label=Reports]'))`);
    await s.until(`[...document.querySelectorAll('section h2')].some((h) => h.textContent.trim() === ${JSON.stringify(name)}) && !!btn('CSV', document)`, 10000);
    await sleep(300);
    await s.until(`!!btn('CSV', document)`, 10000);
    const seen = new Set(readdirSync(DL));
    await s.js(`click('CSV', document)`);
    let f = null;
    for (let i = 0; i < 40 && !f; i++) { await sleep(150); f = readdirSync(DL).find((x) => !seen.has(x) && x.endsWith(".csv")); }
    exported.push(f ? readFileSync(path.join(DL, f), "utf8") : "");
  }
  check("22b. Every report exports CSV", exported.every((c) => c.length > 20), `${exported.filter(Boolean).length}/${exported.length}`);
  check("26b. No export contains the vault reference or account identifier", exported.every((c) => !c.includes(VAULT_REF) && !c.includes(`flow.admin@flow-${RUN}`)));
  check("Hosting register export contains this project's hosting and company", exported.some((c) => c.includes("Lovable") && c.includes(`Flow Portal ${RUN}`) && c.includes(CO_NAME.A1)));
  check("Company reports export the flow companies", exported.some((c) => c.includes(CO_NAME.A1) && c.includes(CO_NAME.A2) && c.includes("Live")));

  // archive / restore
  await s.go(`/admin/project-tracker/projects/${projectA}`);
  await s.until(`has('Edit Project')`);
  await s.js(`click('Archive', [...document.querySelectorAll('header')].pop())`); await s.until("dialogs() === 1");
  await s.js(`fill('Reason for archiving', 'Flow archive test'); click('Archive project')`); await s.until("dialogs() === 0");
  check("23a. Project archived and read-only", await s.until(`has('This project is archived and read-only')`) && await s.js(`!btn('Edit Project', document)`));
  await tabGo(s, "Hosting & Servers"); await sleep(800);
  check("Archived project offers no add/edit actions", await s.js(`!btn('Add hosting record', document) && !btn('Edit', document)`));
  await s.go("/admin/project-tracker/projects");
  await s.until(`document.querySelector('tbody')`);
  await sleep(800);
  check("Archived project hidden from the default list", await s.js(`!has('Flow Portal ${RUN}')`));
  await s.go(`/admin/project-tracker/projects/${projectA}`);
  await s.until(`has('Restore project')`);
  await s.js(`click('Restore project', document)`); await s.until("dialogs() === 1"); await s.js(`click('Restore')`); await s.until("dialogs() === 0");
  check("23b. Manager restores the project to its previous status", await s.until(`has('Edit Project')`) && await s.js(`!has('archived and read-only')`));

  // second project for isolation
  await s.go("/admin/project-tracker/projects");
  await s.until(`!!btn('New project', document)`);
  await s.js(`click('New project', document)`); await s.until("dialogs() === 1 && !!field('Company')", 10000);
  await s.js(`fillAll({ 'Company': ${JSON.stringify(CO.A2)}, 'Project Name': 'Flow Beta ${RUN}' }); click('Create project')`);
  await s.until(`/\\/projects\\/[0-9a-f-]{36}$/.test(location.pathname) && !location.pathname.endsWith(${JSON.stringify(projectA)})`, 10000);
  projectB = (await s.js("location.pathname")).split("/").pop();
  await tabGo(s, "Hosting & Servers"); await sleep(1200);
  const isoHost = await s.js(`!has('Lovable') && has('No hosting records')`);
  await tabGo(s, "Emails & Accounts"); await sleep(1000);
  const isoMail = await s.js(`!has('flow-${RUN}.example')`);
  await tabGo(s, "Documents & Handover"); await sleep(1200);
  const isoDoc = await s.js(`!has('Client sign-off ${RUN}') && has('No handover has been started')`);
  check("24. Project A data never appears under Project B (hosting, email, documents, handover)", isoHost && isoMail && isoDoc, `${isoHost}/${isoMail}/${isoDoc}`);

  // dashboard + KPI click-through + registers
  await s.go("/admin/project-tracker");
  await s.until(`has('Needs attention')`);
  await s.js(`[...document.querySelectorAll('a')].find((a) => a.textContent.includes('Live Projects')).click()`);
  check("5. KPI opens the filtered project list (Live)", await s.until(`location.search.includes('status=live') && has('Flow Portal ${RUN}') && !has('Flow Beta ${RUN}')`));
  await s.send("Page.navigate", { url: `${BASE}/admin/project-tracker/projects?q=${encodeURIComponent(`Flow Portal ${RUN}`)}` });
  check("4. Search finds the project in All Projects", await s.until(`has('Flow Portal ${RUN}') && !has('Flow Beta ${RUN}')`));
  for (const [p, txt] of [["hosting", "Hosting environments"], ["emails", "Email accounts"], ["backups", "Backup records"], ["renewals", "Upcoming expiries"], ["handover", "Handover status by project"]]) {
    await s.go(`/admin/project-tracker/${p}`);
    check(`Register view loads: ${p}`, await s.until(`has(${JSON.stringify(txt)}) && !document.querySelector('[role=status] svg.animate-spin')`, 8000));
  }
  await s.go("/admin/project-tracker/emails"); await s.until(`has('Access records')`);
  check("Emails & Accounts register shows masked identifiers, never the vault reference", await s.until(`has('fl•••@')`, 10000) && await s.js(`!has(${JSON.stringify(VAULT_REF)})`));

  // browser back / forward and refresh on deep links
  await s.go(`/admin/project-tracker/projects/${projectA}`);
  await s.until(`has('Edit Project')`);
  await tabGo(s, "Domains & SSL"); await sleep(500);
  await tabGo(s, "Backups & Recovery"); await sleep(500);
  await s.js("history.back()"); await sleep(800);
  check("Browser back returns to the previous section", await s.js(`location.search.includes('tab=domains') && has('Add domain')`));
  await s.js("history.forward()"); await sleep(800);
  check("Browser forward works", await s.js(`location.search.includes('tab=backups')`));
  await s.send("Page.reload"); await sleep(1500);
  check("Refresh on a deep link keeps the section and data", await s.until(`location.search.includes('tab=backups') && has('Nightly DB')`));
  await s.go(`/admin/project-tracker/projects/00000000-0000-0000-0000-000000000000`);
  check("Unknown project id shows a not-found state", await s.until(`has('Project not found')`));
  await s.go(`/admin/project-tracker/access`);
  await s.until(`has('Set a role')`);
  await s.js(`fillAll({ 'Admin email': 'pt.viewer@example.test', 'Role': 'viewer', 'Note': 'flow' }); click('Save role', document)`);
  check("Manager manages roles", await s.until(`toasts().includes('Role updated')`));
  await s.close();

  // ====================================================== viewer, blocked admin, non-admin
  s = await session();
  await login(s, "pt.viewer@example.test", `/admin/project-tracker/projects/${projectA}?tab=hosting`);
  await s.until(`has('Hosting & Servers') && row('Lovable')`);
  await s.go("/admin/project-tracker/companies");
  await s.until(`!!document.querySelector('tbody tr')`, 8000);
  check("Viewer sees companies but cannot add, edit or archive them", await s.js(`!btn('Add Company', document) && !btn('Edit', document) && !btn('Archive', document) && has(${JSON.stringify(CO_NAME.A1)})`));
  await s.go(`/admin/project-tracker/companies/${CO.A1}`);
  await s.until(`has(${JSON.stringify(CO_NAME.A1)})`, 8000);
  check("Viewer cannot add projects to a company", await s.js(`!btn('Add Project', document) && !btn('Edit Company', document)`));
  await s.go(`/admin/project-tracker/projects/${projectA}?tab=hosting`);
  await s.until(`has('Hosting & Servers') && row('Lovable')`, 8000);
  check("Viewer can read but has no add/edit/archive actions", await s.js(`!btn('Add hosting record', document) && !btn('Edit', document) && !btn('Archive', document) && !btn('Edit Project', document)`));
  await s.close();

  s = await session();
  await login(s, "pt.blocked@example.test", "/admin/project-tracker");
  check("Admin blocked in Project Tracker sees 'No access'", await s.until(`has('No access to Project Tracker')`));
  await s.close();

  s = await session();
  await login(s, "not.admin@example.test", "/admin/project-tracker");
  check("2. Non-admin cannot open Project Tracker (Not authorised)", await s.until(`has('Not authorised')`) && await s.js(`!has('Project Overview')`));
  await s.close();

  // ====================================================== persistence after re-login
  s = await session();
  await login(s, "pt.editor@example.test", "/admin/project-tracker");
  await s.go(`/admin/project-tracker/projects/${projectA}?tab=hosting`);
  check("27. Records survive re-login", await s.until(`!!(row('Lovable') && row('Supabase'))`, 12000), await s.js("location.href + ' :: ' + (document.querySelector('[role=tabpanel]')?.innerText || 'NO PANEL').slice(0, 400)"));
  await s.close();

  // ====================================================== counts: UI vs independent API queries
  {
    const mgr = await apiToken("pt.manager@example.test");
    const proj = await (await rest("pt_project_list?select=id,status,company_id,handover_pending&archived_at=is.null", mgr)).json();
    const cos = await (await rest("pt_companies?select=id&archived_at=is.null", mgr)).json();
    const want = { "Total Companies": cos.length, "Total Projects": proj.length, "Live Projects": proj.filter((p) => p.status === "live").length,
      "In Progress": proj.filter((p) => p.status === "in_progress").length, "Under Maintenance": proj.filter((p) => p.status === "under_maintenance").length,
      "Pending Handover": proj.filter((p) => p.handover_pending).length };
    s = await session();
    await login(s, "pt.manager@example.test", "/admin/project-tracker");
    await s.until(`has('Recent Projects')`, 15000);
    const shown = await s.js(`Object.fromEntries([...document.querySelectorAll('section[aria-label="Key figures"] a')].map((a) => { const t = a.innerText.split(/\\n/).map((x) => x.trim()).filter(Boolean); return [t[0], Number(t[t.length - 1])]; }))`);
    check("32. Dashboard KPI counts match the database", Object.entries(want).every(([k, v]) => shown[k] === v), JSON.stringify({ shown, want }));
    const a1 = proj.filter((p) => p.company_id === CO.A1).length;
    await s.go("/admin/project-tracker/companies?q=" + encodeURIComponent(CO_NAME.A1));
    await s.until(`!!row(${JSON.stringify(CO_NAME.A1)})`, 8000);
    const a1Shown = await s.js(`Number(row(${JSON.stringify(CO_NAME.A1)}).cells[2].innerText.trim())`);
    check("33. Company project count matches the database", a1Shown === a1 && a1 === 4, `shown ${a1Shown}, db ${a1}`);
    await s.close();
  }

  // ====================================================== direct API (no UI)
  const outsider = await apiToken("not.admin@example.test");
  const editor = await apiToken("pt.editor@example.test");
  let r = await rest("pt_projects?select=id,name", outsider);
  check("25a. Non-admin token: direct REST read returns nothing", r.ok && (await r.json()).length === 0);
  r = await rest(`pt_projects?id=eq.${projectA}`, outsider, { method: "PATCH", body: JSON.stringify({ name: "pwned" }), headers: { Prefer: "return=representation" } });
  check("25b. Non-admin token: update by known id changes nothing", r.ok ? (await r.json()).length === 0 : true, String(r.status));
  r = await rest("pt_hosting", outsider, { method: "POST", body: JSON.stringify({ project_id: projectA, provider: "Evil" }) });
  check("25c. Non-admin token: insert rejected", r.status === 401 || r.status === 403, String(r.status));
  r = await rest("pt_projects?select=id", null);
  check("25d. Anonymous REST read rejected", r.status === 401 || r.status === 403, String(r.status));
  r = await rest(`pt_projects?id=eq.${projectB}`, editor, { method: "DELETE" });
  check("25e. Editor cannot hard-delete via the API", r.status === 401 || r.status === 403, String(r.status));
  r = await rest("rpc/pt_reveal_access_reference", editor, { method: "POST", body: JSON.stringify({ p_record: "00000000-0000-0000-0000-000000000000" }) });
  check("25f. Editor cannot call the credential reveal RPC", r.status >= 400, String(r.status));
  r = await rest("pt_companies?select=id,company_name", outsider);
  check("25j. Non-admin token: direct REST read of companies returns nothing", r.ok && (await r.json()).length === 0);
  r = await rest("pt_companies", outsider, { method: "POST", body: JSON.stringify({ company_name: "Intruder Co" }) });
  check("25k. Non-admin token: company insert rejected", r.status === 401 || r.status === 403, String(r.status));
  r = await rest(`pt_companies?id=eq.${CO.A3}`, editor, { method: "DELETE" });
  check("25l. Editor cannot hard-delete a company via the API", r.status === 401 || r.status === 403, String(r.status));
  r = await rest(`pt_projects?id=eq.${projectA}`, editor, { method: "PATCH", body: JSON.stringify({ company_id: CO.A2 }), headers: { Prefer: "return=representation" } });
  check("25m. Editor cannot move a project to another company via the API", r.status >= 400, String(r.status));
  r = await rest("pt_access_refs?select=*", editor);
  check("25g. Credential reference table is not readable via the API", r.status >= 400, String(r.status));
  r = await rest("pt_activity_logs", editor, { method: "POST", body: JSON.stringify({ entity_type: "x", action: "forged" }) });
  check("25h. Activity logs cannot be written via the API", r.status >= 400, String(r.status));
  r = await rest(`pt_activity_logs?select=details,entity_label&project_id=eq.${projectA}`, editor);
  const logs = JSON.stringify(await r.json());
  check("26c. Activity log rows contain no credential data", !logs.includes(VAULT_REF) && !logs.includes(`flow.admin@flow-${RUN}`) && logs.includes("access.reference") === false);
  r = await fetch(`${API}/storage/v1/object/list/project-tracker-documents`, { method: "POST", headers: { apikey: STATE.anonKey, Authorization: `Bearer ${outsider}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: projectA }) });
  const listed = r.ok ? await r.json() : [];
  check("25i. Non-admin cannot list project documents in storage", Array.isArray(listed) ? listed.length === 0 : true, String(r.status));

  // ====================================================== responsive
  s = await session({ w: 390, h: 844, m: true });
  await login(s, "pt.manager@example.test", "/admin/project-tracker");
  await s.until(`has('Projects by status')`);
  const overflow1 = await s.js("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");
  await s.shot("04-mobile-dashboard.jpg");
  await s.go(`/admin/project-tracker/projects/${projectA}?tab=documents`);
  await s.until(`has('Handed Over')`);
  const overflow2 = await s.js("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");
  await s.shot("05-mobile-project.jpg");
  check("28a. Mobile (390px): no horizontal page scroll on dashboard and project workspace", overflow1 && overflow2, `${overflow1}/${overflow2}`);
  await s.js(`click('Upload / link', document)`); await s.until("dialogs() === 1");
  check("Mobile (390px): upload dialog fits without horizontal scroll", await s.js("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && scope().getBoundingClientRect().right <= document.documentElement.clientWidth + 1"));
  await s.shot("05b-mobile-upload.jpg");
  await s.js(`click('Cancel')`); await s.until("dialogs() === 0");
  await s.go(`/admin/project-tracker/projects/${projectA}?tab=access`);
  await s.until(`has('Vault not configured')`, 10000);
  check("Mobile (390px): Credentials & Access fits without horizontal page scroll", await s.js("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), await s.js("overflowers().join(' ; ')"));
  await s.shot("05c-mobile-access.jpg");
  await s.close();
  s = await session({ w: 820, h: 1180, m: true });
  await login(s, "pt.manager@example.test", "/admin/project-tracker/projects");
  await s.until(`has('All Projects')`);
  check("28b. Tablet (820px): no horizontal page scroll on All Projects", await s.js("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), await s.js("overflowers().join(' ; ')"));
  await s.shot("06-tablet-projects.jpg");
  await s.close();

  // ====================================================== existing admin + public pages
  s = await session();
  await login(s, "pt.manager@example.test", "/admin");
  const errBefore = pageErrors.length;
  for (const [p, txt] of [["/admin", "Dashboard"], ["/admin/blog", "Blog"], ["/admin/careers", "Careers"], ["/admin/contacts", "Contact"], ["/admin/job-applications", "Applications"], ["/admin/portfolio", "Portfolio"], ["/admin/seo", "SEO"], ["/admin/search-console", "Search Console"]]) {
    await s.go(p);
    check(`29. Existing admin page still works: ${p}`, await s.until(`document.querySelector('main') && has(${JSON.stringify(txt)})`, 10000));
  }
  await s.close();
  s = await session();
  for (const p of ["/", "/about", "/services", "/blog", "/careers", "/contact", "/portfolio", "/privacy"]) {
    await s.go(p);
    check(`30. Public page renders: ${p}`, await s.until(`document.querySelector('main') && document.body.innerText.length > 200`, 10000));
  }
  const verifyTag = await s.js(`!!document.querySelector('meta[name="google-site-verification"]')`);
  check("Google Search Console verification meta tag still present", verifyTag);
  check("No uncaught page exceptions on existing pages", pageErrors.length === errBefore, pageErrors.slice(errBefore).join(" | "));
  await s.close();
  }
} catch (e) {
  check("flow script completed", false, e.stack || e.message);
  try { await lastSession?.shot("zz-failure.jpg"); console.log("page at failure:", (await lastSession.js("location.href + ' :: ' + document.body.innerText.slice(0, 600)"))); } catch { /* ignore */ }
}

// Deliberate negative tests produce these responses; anything else is unexpected.
const EXPECTED = [
  ...(AUTH_MODE || UPSTREAM_MODE ? [
    { status: 400, path: /\/auth\/v1\/token$/, why: "wrong-password and unknown-refresh-token tests (auth mode)" },
    { status: 401, path: /\/rest\/v1\/rpc\/is_admin$/, why: "token signed with another key (auth mode S1)" },
    { status: 401, path: /\/auth\/v1\/logout$/, why: "signing out a token signed with another key (auth mode S3)" },
  ] : []),
  { status: 400, path: /\/auth\/v1\/token$/, why: "wrong password in the re-authentication test (vault-only run)" },
  { status: 409, path: /\/rest\/v1\/pt_domains$/, why: "duplicate domain test" },
  { status: 409, path: /\/rest\/v1\/pt_email_accounts$/, why: "same mailbox without justification test" },
  { status: 400, path: /\/rest\/v1\/rpc\/pt_set_access_reference$/, why: "secret-looking vault reference test" },
  { status: 409, path: /\/rest\/v1\/pt_companies$/, why: "duplicate company name test" },
  { status: 400, path: /\/rest\/v1\/pt_companies$/, why: "archive refused: company still has active projects" },
];
const isExpected = (f) => EXPECTED.some((e) => e.status === f.status && e.path.test(f.path));
// Existing admin pages (Dashboard, SEO) call the search-console Edge Function, which the
// local stand-in does not provide. Reported separately: needs real Supabase, not a Project Tracker issue.
const needsEdgeFn = (x) => /functions\/v1\/search-console|no Edge Function stand-ins/.test(x.path || x.text || "");
const unexpectedNet = netFailures.filter((f) => !isExpected(f) && !needsEdgeFn(f));
// Auth mode provokes these on purpose (E3 unknown refresh token, W1 wrong password, S1/S3 token signed with another key).
const authExpected = (c) => (AUTH_MODE || UPSTREAM_MODE) && (/status of 400 \(Bad Request\) http:\/\/127\.0\.0\.1:\d+\/auth\/v1\/token\?grant_type=(refresh_token|password)/.test(c.text)
  || /status of 401 \(Unauthorized\) http:\/\/127\.0\.0\.1:\d+\/(rest\/v1\/rpc\/is_admin|auth\/v1\/logout)/.test(c.text) || /^is_admin check failed: JWT signature is invalid/.test(c.text));
const unexpectedConsole = consoleErrors.filter((c) => !authExpected(c) && !/status of (409|400)/.test(c.text) && !needsEdgeFn(c) && !/empty string for a boolean attribute/.test(c.text) && !/status of 404 \(Not Found\) http:\/\/127\.0\.0\.1:\d+\/functions/.test(c.text));
// Pre-existing in the public site (src/components/Header.jsx passes inert: ""), not Project Tracker.
const preExistingHeader = (c) => /empty string for a boolean attribute/.test(c.text);
check("Pre-existing public-header React warning (inert=\"\") reported separately", true, `${consoleErrors.filter(preExistingHeader).length} occurrence(s)`);
check("Existing admin pages: search-console Edge Function unavailable locally (needs real Supabase)", true,
  `${netFailures.filter(needsEdgeFn).length} request(s) returned 404 from the stand-in`);
check("No unexpected failed network requests in the browser", unexpectedNet.length === 0, JSON.stringify(unexpectedNet.slice(0, 6)));
check("No unexpected browser console errors", unexpectedConsole.length === 0, JSON.stringify(unexpectedConsole.slice(0, 6)));
check("No request ever left 127.0.0.1 (live services untouched)", true, `${blocked.length} external request(s) blocked: ${[...new Set(blocked.map((u) => new URL(u).hostname))].join(", ")}`);
check("No uncaught exceptions in Project Tracker pages", pageErrors.length === 0, pageErrors.join(" | "));
const failed = checks.filter((c) => !c.ok);
writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ run: RUN, base: BASE, projectA, projectB, checks, blocked: [...new Set(blocked)], pageErrors, consoleErrors, netFailures, expectedNet: netFailures.filter(isExpected) }, null, 2));
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed. Results + screenshots: ${OUT}`);
for (const p of openProcs) { try { p.kill(); } catch { /* ignore */ } }
process.exitCode = failed.length ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 1500).unref();

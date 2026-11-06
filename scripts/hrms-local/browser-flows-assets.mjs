#!/usr/bin/env node
// TEST-ONLY end-to-end checks for Module 11 (Asset Allocation) against the
// LOCAL HRMS harness: overview counts, register (duplicate ID, restricted
// cost), assignment + handover acknowledgement / confirmation, damage report
// with evidence upload and repair workflow, the full return lifecycle,
// reassignment after return, asset history, permissions, refresh persistence
// and a phone-width layout check.
//
//   node scripts/hrms-local/browser-flows-assets.mjs [--state <harness state json>] [--out <results.json>] [--shots <dir>]
//
// Talks ONLY to 127.0.0.1 (every other browser request is blocked) and runs
// read-only SELECTs as the throwaway cluster owner. Synthetic data only.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findPgBin, makePsql, resolveStateFile, outputDir } from "./lib.mjs";
import { syntheticPdf } from "./fixture-files.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const STATE_FILE = resolveStateFile();
if (!existsSync(STATE_FILE)) { console.error(`No harness state at ${STATE_FILE}`); process.exit(2); }
const STATE = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const API = `http://127.0.0.1:${STATE.apiPort}`;
const BASE = `http://127.0.0.1:${STATE.webPort}`;
const ANON = STATE.anonKey;
const OUT = arg("--out", path.join(outputDir("hrms-flows-assets"), "results.json"));
const SHOTS = arg("--shots", path.join(outputDir("hrms-flows-assets"), "shots"));
const PASSWORD = "Local-Test-Only-2026!";
const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const WORK = mkdtempSync(path.join(tmpdir(), "hrms-flows-assets-"));
if (String(STATE.webPort) === "8080") { console.error("Refusing to run against port 8080"); process.exit(2); }
mkdirSync(SHOTS, { recursive: true }); mkdirSync(path.dirname(OUT), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = []; const blocked = []; const pageErrors = [];
const check = (aspect, name, ok, detail = "") => {
  checks.push({ aspect, name, ok: Boolean(ok), detail: String(detail ?? "") });
  console.log(`${ok ? "PASS" : "FAIL"}  [${aspect}] ${name}${detail ? `  (${String(detail).slice(0, 240)})` : ""}`);
};
const psql = makePsql({ bin: findPgBin(), port: STATE.pgPort });
async function q(sql) {
  const r = await psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`);
  if (!r.ok) throw new Error(`SQL failed: ${r.stderr.trim()} :: ${sql.slice(0, 200)}`);
  return JSON.parse(r.stdout.trim() || "[]");
}
const q1 = async (sql) => (await q(sql))[0];
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const J = JSON.stringify;

async function api(method, p, { token, body } = {}) {
  const r = await fetch(API + p, { method, headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
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
const sel = async (email, p) => api("GET", `/rest/v1/${p}`, { token: await tok(email) });
const emsg = (r) => (r.body && (r.body.message || r.body.error)) || `HTTP ${r.status}`;

// ------------------------------------------------------------------ browser (CDP)
async function session(viewport = { w: 1440, h: 900, m: false }) {
  const port = 9300 + Math.floor(Math.random() * 250);
  const profile = mkdtempSync(path.join(tmpdir(), "hrms-fa-"));
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
  await send("Page.enable"); await send("Runtime.enable"); await send("DOM.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.open = function (u) { (window.__opened = window.__opened || []).push(String(u)); return null; };" });
  await send("Emulation.setDeviceMetricsOverride", { width: viewport.w, height: viewport.h, deviceScaleFactor: 1, mobile: viewport.m });
  const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  const go = async (p, wait = 4000) => { await send("Page.navigate", { url: BASE + p }); await sleep(wait); };
  const reload = async (wait = 4500) => { await send("Page.reload", { ignoreCache: true }); await sleep(wait); };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 }); writeFileSync(path.join(SHOTS, `m11-${name}.jpg`), Buffer.from(s.data, "base64")); };
  const setFile = async (selector, file) => {
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`file input not found: ${selector}`);
    await send("DOM.setFileInputFiles", { files: [file], nodeId });
  };
  const close = async () => { try { ws.close(); } catch {} proc.kill(); await sleep(600); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { js, go, reload, shot, setFile, close };
}

const H = `
window.__h = {
  setVal(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
  scope() { const d = [...document.querySelectorAll('[role=dialog]')]; return d[d.length - 1] || document; },
  field(label) { const s = this.scope(); const l = [...s.querySelectorAll('label')].find((x) => x.textContent.replace('*','').trim().startsWith(label)); return l && (document.getElementById(l.htmlFor) || l.querySelector('input,select,textarea')); },
  fill(label, v) { const el = this.field(label); if (!el) return false; this.setVal(el, v); return true; },
  pickVal(label, v) { const el = this.field(label); if (!el || el.tagName !== 'SELECT') return false; if (![...el.options].some((o) => o.value === v)) return false; this.setVal(el, v); return true; },
  pickText(label, sub) { const el = this.field(label); if (!el || el.tagName !== 'SELECT') return false; const o = [...el.options].find((o) => o.value && o.textContent.includes(sub)); if (!o) return false; this.setVal(el, o.value); return o.textContent; },
  btn(text, inDialog) { const s = inDialog ? this.scope() : document; return [...s.querySelectorAll('button,a')].find((x) => x.textContent.trim().startsWith(text)); },
  click(text, inDialog) { const b = this.btn(text, inDialog); if (!b || b.disabled) return false; b.click(); return true; },
  rowClick(rowText, btnText) { const tr = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes(rowText)); if (!tr) return 'no-row'; if (!btnText) { tr.click(); return true; }
    const b = [...tr.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(btnText)); if (!b || b.disabled) return 'no-button'; b.click(); return true; },
  rowText(rowText) { const tr = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes(rowText)); return tr ? tr.innerText.replace(/\\s+/g, ' ') : null; },
  cardClick(cardText, btnText) { const c = [...document.querySelectorAll('main section')].filter((x) => x.innerText.includes(cardText)).pop(); if (!c) return 'no-card';
    const b = [...c.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(btnText)); if (!b) return 'no-button'; b.click(); return true; },
  cardText(cardText) { const c = [...document.querySelectorAll('main section')].filter((x) => x.innerText.includes(cardText)).pop(); return c ? c.innerText : null; },
  tick(labelText) { const s = this.scope(); const l = [...s.querySelectorAll('label')].find((x) => x.textContent.trim().includes(labelText)); const i = l && (document.getElementById(l.htmlFor) || l.querySelector('input')); if (!i) return false; if (!i.checked) i.click(); return true; },
  tab(text) { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim().startsWith(text)); if (!t) return false; t.click(); return true; },
  dialogOpen() { return document.querySelectorAll('[role=dialog]').length; },
  dialogText() { const d = this.scope(); return d === document ? '' : d.innerText; },
  main() { return (document.querySelector('main') || document.body).innerText; },
  overflowX() { return document.documentElement.scrollWidth - window.innerWidth; },
};`;
const MARK = "document.querySelectorAll('[aria-live=polite] [role=status]').forEach((x) => x.setAttribute('data-seen', '1'));";
const h = (s, expr) => s.js(`(() => { ${H}; ${/^(click|rowClick|cardClick)\(/.test(expr) ? MARK : ""} return window.__h.${expr}; })()`);
async function waitFor(s, expr, timeout = 10000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await h(s, expr)) return true; await sleep(300); } return false; }
const waitDialog = (s) => waitFor(s, "dialogOpen() > 0", 6000);
async function toast(s, timeout = 7000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const t = await s.js("(() => { const n = [...document.querySelectorAll('[aria-live=polite] [role=status]:not([data-seen])')]; n.forEach((x) => x.setAttribute('data-seen', '1')); return n.map((x) => x.textContent.trim()); })()") ?? [];
    if (t.length) return t.join(" | ");
    await sleep(200);
  }
  return "";
}
async function login(s, email) {
  await s.go("/login", 2500);
  await s.js(`(() => { const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('email', ${J(email)}); set('password', ${J(PASSWORD)}); document.querySelector('form').requestSubmit(); })()`);
  for (let i = 0; i < 30; i++) { await sleep(400); const p = await s.js("location.pathname"); if (p && p !== "/login") { await sleep(1500); return p; } }
}
const searchRegister = async (s, text) => { await s.js(`(() => { ${H}; __h.setVal(document.querySelector('input[aria-label="Search assets"]'), ${J(text)}); })()`); await sleep(2500); };

// ==================================================================== flow
const TAG = `M11-UI-${RUN}`;
const empId = async (email) => (await q1(`select id from hr_employees where company_email = ${lit(email)}`))?.id;

async function main() {
  const emp3 = await empId("demo.engineer3@example.com");
  let s = await session();

  // ---- overview
  await login(s, "hr.admin@example.com");
  await s.go("/hr/assets", 5000);
  const total = (await q1("select count(*)::int n from hr_assets")).n;
  const ovText = await h(s, "main()");
  check("ui", "Overview shows live KPI cards", /Total assets/i.test(ovText) && /Pending handovers/i.test(ovText) && /Overdue returns/i.test(ovText));
  check("db", "Overview total equals hr_assets row count", new RegExp(`Total assets\\s*${total}\\b`, "i").test(ovText), `db=${total}`);
  await s.shot("overview-desktop");

  // ---- register: add asset with cost; duplicate ID refused
  await h(s, "tab('Register')"); await sleep(2500);
  await h(s, "click('Add asset')"); await waitDialog(s);
  await h(s, `fill('Asset ID', ${J(TAG)})`); await h(s, "fill('Asset category', 'Laptop')"); await h(s, "fill('Brand', 'Synthbook')");
  await h(s, `fill('Serial number', ${J(`SN-${TAG}`)})`); await h(s, "fill('Purchase cost', '65000')"); await h(s, "fill('Storage location', 'IT cabinet Z')");
  await h(s, "click('Add asset', true)"); const tAdd = await toast(s); await sleep(2000);
  const asset = await q1(`select a.id, f.purchase_cost, a.purchase_cost as legacy_cost, a.storage_location, a.status from hr_assets a left join hr_asset_financials f on f.asset_id = a.id where a.asset_tag = ${lit(TAG)}`);
  check("ui", "HR adds an asset from the register", /Asset added/.test(tAdd), tAdd);
  check("db", "Asset stored with restricted cost and storage location", Number(asset?.purchase_cost) === 65000 && asset?.legacy_cost === null && asset?.storage_location === "IT cabinet Z" && asset?.status === "available", J(asset));
  await h(s, "click('Add asset')"); await waitDialog(s);
  await h(s, `fill('Asset ID', ${J(TAG)})`); await h(s, "fill('Asset category', 'Laptop')");
  await h(s, "click('Add asset', true)"); await sleep(2000);
  check("error", "Duplicate asset ID shows a clear message", /already uses this asset ID/.test(await h(s, "dialogText()")), (await h(s, "dialogText()")).slice(-140));
  await h(s, "click('Cancel', true)"); await sleep(800);

  // ---- assign with accessories (asset detail)
  await searchRegister(s, TAG);
  await h(s, `rowClick(${J(TAG)})`); await waitDialog(s); await sleep(2500);
  check("ui", "Asset detail shows purchase cost to cost-authorised HR", /65,000/.test(await h(s, "dialogText()")));
  await h(s, "click('Assign', true)"); await sleep(1200);
  await h(s, "pickText('Employee', 'Demo Engineer 03')"); await h(s, "fill('Assignment reason', 'Onboarding')"); await h(s, "fill('Accessories issued', 'Charger, Laptop bag')");
  await h(s, "click('Assign', true)"); const tAsg = await toast(s); await sleep(2500);
  const asg = await q1(`select id, accessories, assignment_reason from hr_asset_assignments where asset_id = ${lit(asset.id)} and status = 'active'`);
  const ho = await q1(`select id, status, terms_version from hr_asset_handovers where assignment_id = ${lit(asg?.id)}`);
  check("ui", "HR assigns the asset with reason and accessories", /assigned/.test(tAsg), tAsg);
  check("db", "Assignment + pending handover created", asg?.accessories?.join(",") === "Charger,Laptop bag" && ho?.status === "pending_acknowledgement", `${J(asg)} ${J(ho)}`);
  const dbl = await rpc("hr.admin@example.com", "hr_assign_asset_v2", { p_asset: asset.id, p_employee: await empId("demo.designer@example.com") });
  check("permission", "Duplicate active assignment refused by the server", dbl.status >= 400 && /already assigned/.test(emsg(dbl)), emsg(dbl));
  await s.close();

  // ---- employee: acknowledge handover, report damage with evidence
  s = await session();
  await login(s, "employee@example.com");
  await s.go("/employee/assets", 4500);
  check("ui", "Employee sees the asset and an acknowledgement prompt", (await h(s, `cardText(${J(TAG)})`))?.includes("please acknowledge"));
  await h(s, `cardClick(${J(TAG)}, 'Acknowledge handover')`); await waitDialog(s); await sleep(800);
  const ackDlg = await h(s, "dialogText()");
  check("ui", "Acknowledgement shows terms, version and the not-a-digital-signature notice", /Terms version/.test(ackDlg) && /not a legally binding digital signature/.test(ackDlg));
  await h(s, "click('Acknowledge receipt', true)"); await sleep(600);
  check("error", "Acknowledging without the confirmation tick is refused", /Tick the confirmation/.test(await h(s, "dialogText()")));
  await h(s, "tick('I confirm I have received')"); await h(s, "click('Acknowledge receipt', true)"); const tAck = await toast(s); await sleep(2000);
  const ho2 = await q1(`select status, acknowledged_at, acknowledged_terms_version from hr_asset_handovers where id = ${lit(ho.id)}`);
  check("ui", "Employee acknowledges the handover", /acknowledged/i.test(tAck), tAck);
  check("db", "Acknowledgement timestamp and terms version stored", ho2.status === "acknowledged" && ho2.acknowledged_at && ho2.acknowledged_terms_version === ho.terms_version, J(ho2));
  await s.reload();
  check("refresh", "After reload the acknowledgement persists", !(await h(s, `cardText(${J(TAG)})`))?.includes("please acknowledge"));

  await h(s, `cardClick(${J(TAG)}, 'Report damage')`); await waitDialog(s);
  await h(s, "pickVal('Damage category', 'screen')"); await h(s, "pickVal('Severity', 'high')"); await h(s, "fill('What happened', 'Screen cracked in transit (synthetic)')");
  await h(s, "click('Submit report', true)"); const tDmg = await toast(s); await sleep(2500);
  const dmg = await q1(`select id, status, severity from hr_asset_damage_reports where asset_id = ${lit(asset.id)} order by created_at desc limit 1`);
  check("ui", "Employee reports damage", /Damage reported/.test(tDmg), tDmg);
  check("db", "Damage report Reported / high", dmg?.status === "reported" && dmg?.severity === "high", J(dmg));
  // evidence upload through Module 9
  await h(s, `rowClick(${J(TAG)})`); await waitDialog(s); await sleep(1500);
  const pdf = path.join(WORK, "damage-evidence.pdf"); writeFileSync(pdf, syntheticPdf("Damage evidence (synthetic)"));
  await s.setFile('[role=dialog] input[type=file]', pdf); await sleep(300);
  await h(s, "click('Attach', true)"); const tEv = await toast(s, 9000); await sleep(1500);
  const link = await q1(`select l.id, d.employee_id, c.code from hr_asset_document_links l join hr_documents d on d.id = l.document_id join hr_document_categories c on c.id = d.category_id where l.damage_report_id = ${lit(dmg.id)}`);
  check("ui", "Employee attaches damage evidence", /attached/i.test(tEv), tEv);
  check("db", "Evidence stored as a Module 9 document linked to the report", link?.code === "asset_damage_evidence" && link?.employee_id === emp3, J(link));
  await s.shot("employee-damage-evidence");
  await h(s, "click('Close', true)"); await sleep(600);

  // employee requests the return
  await h(s, "tab('Assigned to me')"); await sleep(800);
  await h(s, `cardClick(${J(TAG)}, 'Request return')`); await waitDialog(s);
  await h(s, "fill('Reason', 'Moving to a desktop (synthetic)')"); await h(s, "click('Request return', true)"); const tRr = await toast(s); await sleep(2000);
  const ret = await q1(`select id, status from hr_asset_returns where assignment_id = ${lit(asg.id)} and status not in ('completed','cancelled')`);
  check("ui", "Employee requests a return", /Return requested/.test(tRr), tRr);
  check("db", "Return Requested", ret?.status === "requested", J(ret));
  await s.close();

  // permissions (API)
  const e2 = await sel("employee2@example.com", `hr_asset_damage_reports?select=id&id=eq.${dmg.id}`);
  check("permission", "employee2 cannot see employee@'s damage report", Array.isArray(e2.body) && e2.body.length === 0);
  const costE = await rpc("employee@example.com", "hr_asset_costs", { p_assets: [asset.id] });
  check("permission", "Employee cannot read purchase cost (RPC)", costE.status >= 400, emsg(costE));
  const costTbl = await sel("employee@example.com", `hr_asset_financials?select=purchase_cost&asset_id=eq.${asset.id}`);
  check("permission", "Employee reads no rows from hr_asset_financials", Array.isArray(costTbl.body) && costTbl.body.length === 0, J(costTbl.body));
  const empAdv = await rpc("employee@example.com", "hr_advance_asset_damage_report", { p_report: dmg.id, p_status: "under_review" });
  check("permission", "Employee cannot move a damage report", empAdv.status >= 400, emsg(empAdv));

  // ---- HR: damage workflow, handover confirmation, return lifecycle
  s = await session();
  await login(s, "hr.admin@example.com");
  await s.go("/hr/assets?tab=damage", 5000);
  await h(s, `rowClick(${J(TAG)})`); await waitDialog(s); await sleep(1000);
  for (const [step, extra] of [["Under Review", null], ["Under Repair", null], ["Resolved", "Screen replaced under warranty (synthetic)"]]) {
    await h(s, `click('Move to ${step.toLowerCase()}', true)`); await sleep(800);
    if (extra) await h(s, `fill('Resolution notes', ${J(extra)})`);
    await h(s, `click('Mark ${step.toLowerCase()}', true)`); await toast(s); await sleep(2000);
    if (step !== "Resolved") { await h(s, `rowClick(${J(TAG)})`); await waitDialog(s); await sleep(800); }
  }
  const dmg2 = await q1(`select status, resolution_notes from hr_asset_damage_reports where id = ${lit(dmg.id)}`);
  check("db", "Damage report moved Reported → Under Review → Under Repair → Resolved", dmg2.status === "resolved", J(dmg2));
  await s.reload(); await h(s, "tab('Damage')"); await sleep(1500);
  await s.js(`(() => { ${H}; __h.setVal(document.querySelector('select[aria-label="Report status"]'), 'resolved'); })()`); await sleep(2000);
  check("refresh", "After reload the report is listed as resolved", /resolved/.test(await h(s, `rowText(${J(TAG)})`) ?? ""));

  await h(s, "tab('Handovers')"); await sleep(2500);
  await h(s, `rowClick(${J(TAG)})`); await waitDialog(s); await sleep(800);
  await h(s, "click('Confirm handover', true)"); await sleep(800); await h(s, "click('Confirm handover', true)"); const tConf = await toast(s); await sleep(1500);
  check("db", "HR/IT confirms the handover", /confirmed/i.test(tConf) && (await q1(`select status from hr_asset_handovers where id = ${lit(ho.id)}`)).status === "confirmed", tConf);

  await h(s, "tab('Returns')"); await sleep(2500);
  const steps = [
    ["Accept & schedule", "Accept and schedule return", null, "pending_handover"],
    ["Record receipt", "Record receipt", "receive", "received"],
    ["Inspect", "Record inspection", "inspect", "inspected"],
    ["Complete", "Complete return", null, "completed"],
  ];
  for (const [btn, submit, kind, expect] of steps) {
    await h(s, `rowClick(${J(TAG)})`); await waitDialog(s); await sleep(800);
    await h(s, `click(${J(btn)}, true)`); await sleep(800);
    if (kind === "receive") await h(s, "fill('Accessories returned', 'Charger')");
    if (kind === "inspect") { await h(s, "pickVal('Return condition', 'good')"); await h(s, "pickVal('Outcome', 'available')"); await h(s, "fill('Inspection notes', 'Clean (synthetic)')"); }
    await h(s, `click(${J(submit)}, true)`); const t = await toast(s); await sleep(2000);
    const r = await q1(`select status, missing_accessories from hr_asset_returns where id = ${lit(ret.id)}`);
    const a = await q1(`select status from hr_assets where id = ${lit(asset.id)}`);
    check("db", `Return step "${btn}" → ${expect} (asset ${a.status})`, r.status === expect, `${t} ${J(r)}`);
    if (expect === "received") {
      check("db", "Missing accessory detected on receipt", r.missing_accessories?.join(",") === "Laptop bag", J(r.missing_accessories));
      check("db", "Received asset is in inspection, not available", a.status === "in_inspection");
    }
    if (expect === "completed") check("db", "Completion makes the asset available", a.status === "available");
  }
  await s.shot("returns-completed");

  // ---- reassignment after return + history
  await h(s, "tab('Register')"); await sleep(2000); await searchRegister(s, TAG);
  await h(s, `rowClick(${J(TAG)})`); await waitDialog(s); await sleep(2500);
  const hist = await h(s, "dialogText()");
  check("ui", "Asset history shows registration → handover → damage → return steps", ["purchase", "handover acknowledged", "damage resolved", "return received", "return completed"].every((t) => hist.toLowerCase().includes(t)));
  await h(s, "click('Assign', true)"); await sleep(1200);
  await h(s, "pickText('Employee', 'Demo Designer')"); await h(s, "click('Assign', true)"); const tRe = await toast(s); await sleep(2000);
  const nAsg = (await q1(`select count(*)::int n from hr_asset_assignments where asset_id = ${lit(asset.id)}`)).n;
  check("db", "Reassignment after return keeps the previous assignment", /assigned/.test(tRe) && nAsg === 2, `${tRe} n=${nAsg}`);
  await s.shot("asset-detail-history");
  await s.close();

  // employee confirms return; history visible
  s = await session();
  await login(s, "employee@example.com");
  await s.go("/employee/assets", 4500);
  await h(s, "tab('Returns')"); await sleep(1500);
  await h(s, `rowClick(${J(TAG)}, 'Confirm return')`); await waitDialog(s); await h(s, "click('I handed it over', true)"); const tCr = await toast(s); await sleep(1500);
  check("db", "Employee confirms the return", (await q1(`select employee_acknowledged_at from hr_asset_returns where id = ${lit(ret.id)}`)).employee_acknowledged_at != null, tCr);
  await h(s, "tab('History')"); await sleep(2500);
  check("ui", "My asset history lists the asset timeline", (await h(s, "main()")).includes(TAG));
  await s.close();

  // ---- integration hookups: Module 2 profile tab, Module 4 exit panel + 142 gates
  {
    s = await session();
    await login(s, "hr.admin@example.com");
    await s.go(`/hr/employees/${emp3}`, 5000);
    const tabOk = await h(s, "tab('Assets')"); await sleep(3000);
    const prof = await h(s, "main()");
    check("ui", "Employee profile has an Assets tab showing holdings and history (M2 hookup)", tabOk && /Assigned assets/i.test(prof) && prof.includes(TAG), tabOk ? "" : "no Assets tab");
    await s.shot("hookup-profile-assets");
    await s.close();
    s = await session();
    await login(s, "manager@example.com");
    await s.go(`/hr/employees/${emp3}`, 5000);
    const mgrTabs = await s.js("[...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim())");
    check("permission", "Manager without assets.view gets no Assets tab on a report's profile", Array.isArray(mgrTabs) && mgrTabs.length > 0 && !mgrTabs.some((t) => t.startsWith("Assets")), J(mgrTabs));
    await s.close();

    const eng5 = await empId("demo.engineer5@example.com");
    const xc = await q1(`select id from hr_exits where employee_id = ${lit(eng5)} and status = 'clearance'`);
    const free = await q1(`select id, asset_tag from hr_assets where status = 'available' and not is_bulk order by asset_tag limit 1`);
    const a5 = await rpc("hr.admin@example.com", "hr_assign_asset_v2", { p_asset: free.id, p_employee: eng5, p_accessories: ["Charger"] });
    check("db", "Setup: leaver holds an asset with a charger", a5.status < 400, emsg(a5));
    s = await session();
    await login(s, "hr.admin@example.com");
    await s.go(`/hr/exits/${xc.id}`, 6000);
    const ex1 = await h(s, "main()");
    check("ui", "Exit case shows the Asset clearance panel with the outstanding item (M4 hookup)", /Asset clearance/.test(ex1) && ex1.includes(free.asset_tag) && /outstanding/i.test(ex1));
    await h(s, "click('Generate return checklist')"); await waitDialog(s);
    await h(s, "click('Start returns', true)"); const tGen = await toast(s); await sleep(2000);
    const r5 = await q1(`select id, status, source, exit_id from hr_asset_returns where assignment_id = ${lit(a5.body)} and status <> 'cancelled'`);
    check("db", "Generate return checklist creates an exit return (Pending Handover)", r5?.status === "pending_handover" && r5?.source === "exit" && r5?.exit_id === xc.id, `${tGen} ${J(r5)}`);
    for (const [fn, args] of [["hr_receive_asset_return", { p_return: r5.id, p_accessories_returned: [] }],
                              ["hr_inspect_asset_return", { p_return: r5.id, p_condition: "good", p_outcome: "available" }],
                              ["hr_complete_asset_return", { p_return: r5.id }]]) {
      const r = await rpc("hr.admin@example.com", fn, args); if (r.status >= 400) check("db", `setup ${fn}`, false, emsg(r));
    }
    await s.reload(6000);
    const clickComplete = async () => s.js(`(() => { const li = [...document.querySelectorAll('li')].find((l) => l.innerText.trim().startsWith('Asset return'));
      const b = li && [...li.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Complete'); if (!b) return false; b.click(); return true; })()`);
    check("ui", "Asset return item offers Complete once returns are done", await clickComplete());
    await waitDialog(s); await h(s, "click('Complete', true)"); await sleep(2000);
    const blocked = await h(s, "dialogText()");
    check("error", "Completing asset return without the asset-clearance sign-off is refused (142)", /Record the asset clearance/.test(blocked), blocked.slice(-160));
    await h(s, "click('Cancel', true)"); await sleep(800);
    const ex2 = await h(s, "main()");
    check("ui", "Panel shows all returned and lists the missing charger for review", /all equipment returned/i.test(ex2) && /issue/i.test(ex2));
    await h(s, "click('Record asset clearance')"); await waitDialog(s);
    await h(s, "click('Record clearance', true)"); await sleep(700);
    check("error", "Sign-off refuses unacknowledged missing items", /Acknowledge the open issues/.test(await h(s, "dialogText()")));
    await h(s, "tick('I have reviewed')"); await h(s, "fill('Note', 'Charger not returned; handled per policy (synthetic)')");
    await h(s, "click('Record clearance', true)"); const tClr = await toast(s); await sleep(2500);
    const clr = await q1(`select exit_id, issues_acknowledged from hr_asset_clearances where employee_id = ${lit(eng5)} order by cleared_at desc limit 1`);
    check("db", "Asset clearance recorded for this exit with issues acknowledged", clr?.exit_id === xc.id && clr?.issues_acknowledged === true, `${tClr} ${J(clr)}`);
    await s.reload(6000);
    await clickComplete(); await waitDialog(s); await h(s, "fill('Note', 'All company equipment cleared')"); await h(s, "click('Complete', true)"); const tItem = await toast(s); await sleep(2000);
    const item = await q1(`select status from hr_exit_clearance_items where exit_id = ${lit(xc.id)} and item_key = 'asset_return'`);
    check("db", "Asset return clearance item completes after the sign-off", item?.status === "completed", `${tItem} ${J(item)}`);
    await s.reload(6000);
    check("refresh", "After reload the exit shows asset clearance complete", /Asset clearance complete/.test(await h(s, "main()")));
    await s.shot("hookup-exit-asset-clearance");
    await s.close();
  }

  // ---- phone width
  for (const [who, p, name] of [["employee@example.com", "/employee/assets", "employee-mobile"], ["hr.admin@example.com", "/hr/assets", "hr-overview-mobile"]]) {
    s = await session({ w: 390, h: 844, m: true });
    await login(s, who); await s.go(p, 5000);
    const ox = await h(s, "overflowX()");
    check("ui", `${name}: no horizontal page scroll at 390px`, ox <= 1, `overflow ${ox}px`);
    await s.shot(name);
    await s.close();
  }
}

try { await main(); } catch (e) { check("fatal", "flow crashed", false, e.stack); }
check("guard", "No non-local browser requests", blocked.length === 0, blocked.slice(0, 3).join(" "));
check("ui", "No uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
writeFileSync(OUT, JSON.stringify({ run: RUN, checks, blocked, pageErrors }, null, 2));
try { rmSync(WORK, { recursive: true, force: true }); } catch {}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed. Results: ${OUT}  Screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);

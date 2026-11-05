#!/usr/bin/env node
// LOCAL TEST HARNESS ONLY — exercises a RUNNING harness (start.mjs) over HTTP
// the way supabase-js does (same URLs, headers and bodies), proving that
// claims plumbing, RLS isolation, payroll separation, embeds, counts, single
// objects, RPC errors, Storage RLS and the Edge Function stand-ins work.
// Starts nothing. Exit code 1 when any check fails.
//   node scripts/hrms-local/selftest.mjs
import { existsSync, readFileSync } from "node:fs";
import { STATE_FILE, TEST_PASSWORD, INVITE_PASSWORD } from "./lib.mjs";
import { syntheticPdf, syntheticPng } from "./fixture-files.mjs";

if (!existsSync(STATE_FILE)) { console.error(`No running harness (${STATE_FILE} missing). Start it with node scripts/hrms-local/start.mjs`); process.exit(2); }
const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
if (!state.apiPort || !state.anonKey) { console.error("The running harness has no API (db-only mode?)."); process.exit(2); }
const BASE = `http://127.0.0.1:${state.apiPort}`;
const ANON = state.anonKey;

let pass = 0, fail = 0;
const results = [];
function check(name, ok, info = "") {
  if (ok) pass++; else fail++;
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && info ? `  -> ${typeof info === "string" ? info : JSON.stringify(info).slice(0, 400)}` : ""}`);
}

async function api(method, path, { token = ANON, body, headers = {}, raw = false } = {}) {
  const h = { apikey: ANON, Authorization: `Bearer ${token}`, "X-Client-Info": "hrms-local-selftest", ...headers };
  let payload = body;
  if (body !== undefined && !(body instanceof FormData) && !Buffer.isBuffer(body)) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = method === "HEAD" ? "" : await res.text();
  let json = null;
  if (!raw && text) try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, headers: res.headers, json, text };
}
const rest = (method, path, opts) => api(method, `/rest/v1/${path}`, opts);
const rpc = (fn, args, token) => api("POST", `/rest/v1/rpc/${fn}`, { token, body: args ?? {} });

const tokens = {};
async function signIn(email, password = TEST_PASSWORD) {
  return api("POST", "/auth/v1/token?grant_type=password", { body: { email, password, gotrue_meta_security: {} } });
}

try {
  // ---------------------------------------------------------------- auth
  const health = await api("GET", "/health");
  check("API /health", health.status === 200);
  const users = ["superadmin", "hr.admin", "payroll.admin", "payroll.approver", "manager", "employee", "employee2", "intern", "noaccess"];
  for (const u of users) {
    const r = await signIn(`${u}@example.com`);
    tokens[u] = r.json?.access_token;
    check(`sign in ${u}@example.com`, r.status === 200 && r.json?.token_type === "bearer" && r.json?.user?.email === `${u}@example.com` && r.json?.refresh_token && r.json?.expires_at, r.json);
  }
  const badPw = await signIn("employee@example.com", "wrong-password");
  check("bad password -> 400 invalid_grant 'Invalid login credentials'", badPw.status === 400 && badPw.json?.error === "invalid_grant" && badPw.json?.error_description === "Invalid login credentials", badPw.json);
  const unknown = await signIn("nobody@example.com");
  check("unknown user -> 400 invalid_grant", unknown.status === 400 && unknown.json?.error === "invalid_grant", unknown.json);
  const me = await api("GET", "/auth/v1/user", { token: tokens.employee });
  check("GET /auth/v1/user returns the signed-in user", me.status === 200 && me.json?.email === "employee@example.com", me.json);
  const noTok = await api("GET", "/auth/v1/user");
  check("GET /auth/v1/user with anon key -> 403", noTok.status === 403 || noTok.status === 401, noTok.json);
  const login2 = await signIn("intern@example.com");
  const refreshed = await api("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: login2.json.refresh_token } });
  check("refresh_token grant issues a new session", refreshed.status === 200 && refreshed.json?.access_token && refreshed.json.refresh_token !== login2.json.refresh_token, refreshed.json);
  const reuse = await api("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: login2.json.refresh_token } });
  check("used refresh token is rejected", reuse.status === 400, reuse.json);
  const out = await api("POST", "/auth/v1/logout?scope=global", { token: refreshed.json.access_token });
  const afterLogout = await api("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: refreshed.json.refresh_token } });
  check("logout revokes refresh tokens", out.status === 204 && afterLogout.status === 400, { out: out.status, after: afterLogout.status });
  // password change (PUT /user), then restore
  const tmpLogin = await signIn("employee2@example.com");
  const chg = await api("PUT", "/auth/v1/user", { token: tmpLogin.json.access_token, body: { password: "Changed-Local-Only-2026!" } });
  const withNew = await signIn("employee2@example.com", "Changed-Local-Only-2026!");
  const withOld = await signIn("employee2@example.com");
  await api("PUT", "/auth/v1/user", { token: withNew.json?.access_token, body: { password: TEST_PASSWORD } });
  const restored = await signIn("employee2@example.com");
  check("PUT /auth/v1/user changes the password (old rejected, new accepted, restored)", chg.status === 200 && withNew.status === 200 && withOld.status === 400 && restored.status === 200);
  const forged = await rest("GET", "hr_employees?select=id", { token: tokens.employee.slice(0, -4) + "AAAA" });
  check("tampered JWT -> 401", forged.status === 401, forged.json);

  // ---------------------------------------------------------------- hr_me
  const meOf = async (u) => (await rpc("hr_me", {}, tokens[u])).json;
  const sa = await meOf("superadmin");
  check("hr_me superadmin: super_admin, all permissions incl. payroll + roles, no employee", sa?.roles?.includes("super_admin") && sa.permissions.includes("payroll.approve") && sa.permissions.includes("roles.manage") && sa.employee === null, sa);
  const hrm = await meOf("hr.admin");
  check("hr_me hr.admin: employees/settings but NO payroll permissions, linked employee", hrm?.roles?.includes("hr_admin") && hrm.permissions.includes("employees.view") && hrm.permissions.includes("settings.manage") && !hrm.permissions.some((p) => p.startsWith("payroll.")) && hrm.employee?.last_name === "HR Manager", hrm);
  const pa = await meOf("payroll.admin");
  check("hr_me payroll.admin: payroll.manage/approve, no settings.manage", pa?.permissions.includes("payroll.manage") && pa.permissions.includes("payroll.approve") && !pa.permissions.includes("settings.manage"), pa);
  const mg = await meOf("manager");
  check("hr_me manager: team permissions only, is_manager", mg?.permissions.includes("leave.approve_team") && !mg.permissions.includes("leave.approve") && !mg.permissions.includes("employees.view") && mg.is_manager === true && mg.employee?.last_name === "Eng Lead", mg);
  const em = await meOf("employee");
  check("hr_me employee: no catalogue permissions, linked to Demo Engineer 03", Array.isArray(em?.permissions) && em.permissions.length === 0 && em.roles.join() === "employee" && em.employee?.last_name === "Engineer 03" && em.employee?.activated_at, em);
  const it = await meOf("intern");
  check("hr_me intern: role intern, linked to Demo Intern 1", it?.roles?.join() === "intern" && it.employee?.last_name === "Intern 1", it);
  const na = await meOf("noaccess");
  check("hr_me noaccess: no employee, no roles, no permissions", na && na.employee === null && na.roles.length === 0 && na.permissions.length === 0 && na.revoked === false, na);
  const anonMe = await rpc("hr_me", {}, ANON);
  check("hr_me is not executable by anon (401 42501, as on Supabase)", anonMe.status === 401 && anonMe.json?.code === "42501", anonMe.json);

  // ---------------------------------------------------------------- RLS isolation
  const all = await rest("GET", "hr_employees?select=id,company_email,manager_id&order=employee_code", { token: tokens.superadmin });
  const byEmail = Object.fromEntries((all.json || []).map((e) => [e.company_email, e]));
  const emp = byEmail["demo.engineer3@example.com"], emp2 = byEmail["demo.designer@example.com"], lead = byEmail["demo.englead@example.com"];
  check("superadmin reads all employees", all.status === 200 && all.json.length >= 16 && emp && emp2, all.json?.length);
  const mine = await rest("GET", "hr_employees?select=id,first_name,last_name", { token: tokens.employee });
  const ids = (mine.json || []).map((r) => r.id).sort();
  check("employee@ sees only own hr_employees row + manager row", mine.status === 200 && ids.length === 2 && ids.includes(emp.id) && ids.includes(lead.id), mine.json);
  const att2 = await rest("GET", `hr_attendance?select=id&employee_id=eq.${emp2.id}`, { token: tokens.employee });
  const attOwn = await rest("GET", `hr_attendance?select=id&employee_id=eq.${emp.id}`, { token: tokens.employee });
  check("employee@ cannot read employee2's attendance (own visible)", att2.status === 200 && att2.json.length === 0 && attOwn.json.length >= 6, { other: att2.json?.length, own: attOwn.json?.length });
  const lv2 = await rest("GET", `hr_leave_requests?select=id&employee_id=eq.${emp2.id}`, { token: tokens.employee });
  const lvOwn = await rest("GET", "hr_leave_requests?select=id,status", { token: tokens.employee });
  check("employee@ cannot read employee2's leave (sees own 3)", lv2.json?.length === 0 && lvOwn.json?.length === 3, { other: lv2.json, own: lvOwn.json });
  const ps2 = await rest("GET", `hr_payslips?select=id&employee_id=eq.${emp2.id}`, { token: tokens.employee });
  const psOwn = await rest("GET", "hr_payslips?select=id,employee_id,net", { token: tokens.employee });
  check("employee@ cannot read employee2's payslips (own payslip visible)", ps2.json?.length === 0 && psOwn.json?.length === 1 && psOwn.json[0].employee_id === emp.id, { other: ps2.json, own: psOwn.json });
  const doc2 = await rest("GET", `hr_documents?select=id&employee_id=eq.${emp2.id}`, { token: tokens.employee });
  const docOwn = await rest("GET", "hr_documents?select=id,title", { token: tokens.employee });
  check("employee@ cannot read employee2's documents; confidential HR record hidden", doc2.json?.length === 0 && docOwn.json?.length >= 2 && !docOwn.json.some((d) => /Confidential/.test(d.title)), { other: doc2.json, own: docOwn.json });
  const mgrTeam = await rest("GET", "hr_attendance?select=employee_id", { token: tokens.manager });
  const mgrIds = new Set((mgrTeam.json || []).map((r) => r.employee_id));
  check("manager@ sees team attendance but not employee2 (other manager)", mgrIds.has(emp.id) && !mgrIds.has(emp2.id), [...mgrIds].length);
  const hrPay = await rest("GET", "hr_payslips?select=id", { token: tokens["hr.admin"] });
  const hrSal = await rest("GET", "hr_salary_structures?select=id", { token: tokens["hr.admin"] });
  const paPay = await rest("GET", "hr_payslips?select=id", { token: tokens["payroll.admin"] });
  check("payroll separation: hr.admin reads 0 payslips / salary structures; payroll.admin reads them", hrPay.status === 200 && hrPay.json.length === 0 && hrSal.json?.length === 0 && paPay.json?.length >= 2, { hrPay: hrPay.json?.length, hrSal: hrSal.json?.length, paPay: paPay.json?.length });
  const anonHr = await rest("GET", "hr_employees?select=id", { token: ANON });
  check("anon cannot read hr tables (permission denied -> 401)", anonHr.status === 401 && anonHr.json?.code === "42501", anonHr.json);
  const anonPay = await rest("GET", "hr_payslips?select=id", { token: ANON });
  check("anon cannot read hr_payslips", anonPay.status === 401 || (anonPay.status === 200 && anonPay.json.length === 0), anonPay.json);

  // ---------------------------------------------------------------- PostgREST grammar
  const docs = await rest("GET", `hr_documents?select=id,title,employee:hr_employees!hr_documents_employee_id_fkey(id,first_name,last_name),category:hr_document_categories!hr_documents_category_id_fkey(code,name),versions:hr_document_versions!hr_document_versions_document_id_fkey(id,version,storage_path)&employee_id=eq.${emp.id}&archived_at=is.null&order=created_at.desc`, { token: tokens["hr.admin"] });
  const d0 = docs.json?.[0];
  check("embeds with !fk hints: many-to-one -> object, one-to-many -> array", docs.status === 200 && docs.json.length >= 3 && d0 && !Array.isArray(d0.employee) && d0.employee.id === emp.id && typeof d0.category?.code === "string" && Array.isArray(d0.versions) && d0.versions.length === 1, docs.json);
  const assets = await rest("GET", "hr_asset_assignments?select=*,asset:hr_assets!hr_asset_assignments_asset_id_fkey(asset_tag,location:hr_locations!hr_assets_location_id_fkey(id,name)),employee:hr_employees!hr_asset_assignments_employee_id_fkey(id,first_name)&returned_at=is.null&order=assigned_at.desc", { token: tokens["hr.admin"] });
  check("nested embeds (assignment -> asset -> location) + star", assets.status === 200 && assets.json.length >= 3 && assets.json[0].asset?.asset_tag && "location" in assets.json[0].asset && assets.json[0].employee?.first_name === "Demo" && "assigned_at" in assets.json[0], assets.json?.[0] ?? assets.json);
  const ambiguous = await rest("GET", "hr_internships?select=id,hr_employees(id)", { token: tokens["hr.admin"] });
  check("ambiguous embed without hint -> 300 PGRST201", ambiguous.status === 300 && ambiguous.json?.code === "PGRST201", ambiguous.json);
  const total = all.json.length;
  const counted = await rest("GET", "hr_employees?select=id&order=employee_code&limit=5", { token: tokens.superadmin, headers: { Prefer: "count=exact" } });
  check(`count=exact -> Content-Range 0-4/${total}`, counted.status === 200 && counted.headers.get("content-range") === `0-4/${total}` && counted.json.length === 5, counted.headers.get("content-range"));
  const headCount = await rest("HEAD", "hr_employees?select=*", { token: tokens.superadmin, headers: { Prefer: "count=exact" } });
  check("HEAD + count=exact (head:true) -> Content-Range */N or 0-(N-1)/N", headCount.status === 200 && new RegExp(`/${total}$`).test(headCount.headers.get("content-range") || ""), headCount.headers.get("content-range"));
  const ranged = await rest("GET", "hr_employees?select=id&order=employee_code&offset=5&limit=5", { token: tokens.superadmin, headers: { Prefer: "count=exact" } });
  check("range(5, 9) -> Content-Range 5-9/N", ranged.headers.get("content-range") === `5-9/${total}`, ranged.headers.get("content-range"));
  const obj = { Accept: "application/vnd.pgrst.object+json" };
  const singleOk = await rest("GET", `hr_employees?select=id,first_name&id=eq.${emp.id}`, { token: tokens.employee, headers: obj });
  check("single(): exactly one row -> object", singleOk.status === 200 && singleOk.json?.id === emp.id && !Array.isArray(singleOk.json), singleOk.json);
  const singleNone = await rest("GET", `hr_employees?select=id&id=eq.${emp2.id}`, { token: tokens.employee, headers: obj });
  check("single(): zero visible rows -> 406 PGRST116", singleNone.status === 406 && singleNone.json?.code === "PGRST116", singleNone.json);
  const orq = await rest("GET", "hr_employees?select=id,last_name&or=(last_name.ilike.*designer*,last_name.eq.Founder)&status=in.(active,probation)&order=last_name.asc.nullslast", { token: tokens.superadmin });
  check("or=(…ilike *x*…) + in.() + order", orq.status === 200 && orq.json.map((r) => r.last_name).join("|") === "Designer|Founder", orq.json);
  const notq = await rest("GET", "hr_employees?select=id&manager_id=not.is.null&status=neq.exited&first_name=like.Dem*", { token: tokens.superadmin });
  check("not.is.null / neq / like", notq.status === 200 && notq.json.length === total - 1, notq.json?.length);
  const badCol = await rest("GET", "hr_employees?select=id,no_such_column", { token: tokens.superadmin });
  check("unknown column -> 400 42703", badCol.status === 400 && badCol.json?.code === "42703", badCol.json);
  const badTable = await rest("GET", "pg_shadow?select=*", { token: tokens.superadmin });
  check("non-public / unknown relation -> 404", badTable.status === 404, badTable.json);
  const inj = await rest("GET", `hr_employees?select=id&last_name=eq.${encodeURIComponent("x' or '1'='1")}`, { token: tokens.superadmin });
  check("quote in filter value is a literal (no injection)", inj.status === 200 && inj.json.length === 0, inj.json);

  // ---------------------------------------------------------------- writes
  const notes = await rest("GET", "hr_notifications?select=id,read_at&read_at=is.null&order=created_at.desc&limit=1", { token: tokens.employee });
  const nid = notes.json?.[0]?.id;
  const marked = await rest("PATCH", `hr_notifications?id=eq.${nid}&select=id,read_at`, { token: tokens.employee, body: { read_at: new Date().toISOString() }, headers: { Prefer: "return=representation" } });
  check("PATCH with return=representation (mark own notification read)", marked.status === 200 && marked.json?.[0]?.id === nid && marked.json[0].read_at, marked.json);
  const otherNotes = await rest("GET", "hr_notifications?select=id&limit=1", { token: tokens.manager });
  const crossPatch = await rest("PATCH", `hr_notifications?id=eq.${otherNotes.json?.[0]?.id}&select=id`, { token: tokens.employee, body: { read_at: new Date().toISOString() }, headers: { Prefer: "return=representation" } });
  check("PATCH someone else's notification affects 0 rows (RLS)", crossPatch.status === 200 && crossPatch.json.length === 0, crossPatch.json);
  const ins = await rest("POST", "hr_holidays?select=id,name", { token: tokens["hr.admin"], body: { holiday_date: "2027-03-01", name: "Synthetic selftest holiday", type: "optional" }, headers: { Prefer: "return=representation", ...obj } });
  check("POST insert + select().single() -> 201 object", ins.status === 201 && ins.json?.name === "Synthetic selftest holiday", ins.json);
  const dup = await rest("POST", "hr_holidays", { token: tokens["hr.admin"], body: { holiday_date: "2027-03-01", name: "Duplicate", type: "optional" } });
  check("unique violation -> 409 23505", dup.status === 409 && dup.json?.code === "23505", dup.json);
  const ups = await rest("POST", "hr_holidays?on_conflict=holiday_date,location_id&select=name", { token: tokens["hr.admin"], body: [{ holiday_date: "2027-03-01", location_id: null, name: "Synthetic selftest holiday (renamed)", type: "optional" }], headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
  check("upsert (merge-duplicates + on_conflict)", ups.status === 201 && ups.json?.[0]?.name === "Synthetic selftest holiday (renamed)", ups.json);
  const empIns = await rest("POST", "hr_holidays", { token: tokens.employee, body: { holiday_date: "2027-03-02", name: "Employee holiday" } });
  check("employee cannot insert holidays (RLS -> 403 42501)", empIns.status === 403 && empIns.json?.code === "42501", empIns.json);
  const del = await rest("DELETE", `hr_holidays?id=eq.${ins.json?.id}`, { token: tokens["hr.admin"] });
  check("DELETE with filter -> 204", del.status === 204, del.json);

  // ---------------------------------------------------------------- RPC errors
  const pend = await rest("GET", "hr_leave_requests?select=id&status=eq.pending_approval&limit=1", { token: tokens.employee });
  const selfApp = await rpc("hr_decide_leave", { p_id: pend.json?.[0]?.id, p_approve: true, p_note: null }, tokens.employee);
  check("RPC error keeps message + hint (self-approval refused, 400 P0001)", selfApp.status === 400 && selfApp.json?.code === "P0001" && selfApp.json?.message === "You cannot decide your own leave request." && selfApp.json?.hint === "self_approval", selfApp.json);
  const ownAtt = await rpc("hr_upsert_attendance_manual", { p_employee: hrm.employee.id, p_work_date: "2026-01-05", p_check_in: null, p_check_out: null, p_note: "self edit try", p_status: "absent" }, tokens["hr.admin"]);
  check("RPC business rule: HR cannot edit own attendance", ownAtt.status === 400 && ownAtt.json?.message === "You cannot manually edit your own attendance.", ownAtt.json);
  const missing = await rpc("hr_no_such_function", {}, tokens.employee);
  check("unknown RPC -> 404 PGRST202", missing.status === 404 && missing.json?.code === "PGRST202", missing.json);
  const svcOnly = await rpc("hr_link_invited_user", { p_employee: emp.id, p_user: emp.id, p_invited_by: emp.id }, tokens.superadmin);
  check("service-role-only RPC refused for a user (permission denied)", svcOnly.status === 403 && svcOnly.json?.code === "42501", svcOnly.json);
  const setRpc = await rpc("hr_my_leave_balances", { p_year: new Date().getFullYear() }, tokens.employee);
  check("set-returning RPC -> array of objects", setRpc.status === 200 && Array.isArray(setRpc.json) && setRpc.json.some((b) => b.code === "CL"), setRpc.json);
  const voidRpc = await rpc("hr_mark_announcement_read", { p_announcement: (await rest("GET", "hr_announcements?select=id&status=eq.published&limit=1", { token: tokens.employee })).json?.[0]?.id }, tokens.employee);
  check("void RPC -> 204", voidRpc.status === 204, voidRpc.json);
  const dash = await rpc("hr_dashboard", {}, tokens.superadmin);
  check("hr_dashboard RPC returns JSON for superadmin", dash.status === 200 && dash.json && typeof dash.json === "object", dash.json);

  // ---------------------------------------------------------------- storage
  const reg = await rpc("hr_register_document_upload", { p_employee: emp.id, p_category: "other", p_title: "Selftest upload", p_file_name: "selftest.pdf", p_mime_type: "application/pdf", p_size_bytes: 1500, p_expiry_date: null }, tokens.employee);
  check("register own document upload (RPC)", reg.status === 200 && reg.json?.storage_path?.startsWith(emp.id + "/"), reg.json);
  const pdf = syntheticPdf("selftest upload");
  const upload = async (bucket, objPath, token, bytes = pdf, type = "application/pdf", upsert = false) => {
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", new Blob([bytes], { type }), "file");
    return api("POST", `/storage/v1/object/${bucket}/${objPath}`, { token, body: fd, headers: { "x-upsert": String(upsert) } });
  };
  const upOwn = await upload("hr-documents", reg.json.storage_path, tokens.employee);
  check("storage upload to own registered path allowed", upOwn.status === 200 && upOwn.json?.Key === `hr-documents/${reg.json.storage_path}`, upOwn.json);
  const upAgain = await upload("hr-documents", reg.json.storage_path, tokens.employee);
  // hr-documents' INSERT policy itself requires that the object does not exist yet, so RLS rejects first.
  check("second upload to the same hr-documents path refused (RLS 403)", upAgain.status === 403, upAgain.json);
  const upOther = await upload("hr-documents", `${emp2.id}/00000000-0000-4000-8000-000000000000/1-evil.pdf`, tokens.employee);
  check("storage upload into another employee's folder refused (RLS 403)", upOther.status === 403 && /row-level security/.test(upOther.json?.message), upOther.json);
  const upAnon = await upload("hr-documents", reg.json.storage_path.replace(/\.pdf$/, "-2.pdf"), ANON);
  check("anon storage upload refused", upAnon.status === 403 || upAnon.status === 401, upAnon.json);
  const upBig = await upload("hr-avatars", `${emp.id}/photo.png`, tokens.employee, Buffer.alloc(2 * 1024 * 1024 + 10), "image/png");
  check("bucket file_size_limit enforced (2 MB avatars -> 413)", upBig.status === 413, upBig.json);
  const upMime = await upload("hr-avatars", `${emp.id}/photo.png`, tokens.employee, pdf, "application/pdf");
  check("bucket allowed_mime_types enforced (pdf to avatars -> 415)", upMime.status === 400 && upMime.json?.statusCode === "415", upMime.json);
  const upAvatar = await upload("hr-avatars", `${emp.id}/photo.png`, tokens.employee, syntheticPng(), "image/png", true);
  const setPhoto = await rpc("hr_set_my_photo", { p_path: `${emp.id}/photo.png` }, tokens.employee);
  check("own avatar upload (upsert) + hr_set_my_photo", upAvatar.status === 200 && setPhoto.status === 204, { upAvatar: upAvatar.json, setPhoto: setPhoto.json });
  const avDup = await upload("hr-avatars", `${emp.id}/photo.png`, tokens.employee, syntheticPng(), "image/png", false);
  check("upload without x-upsert to an existing object -> 409 Duplicate", avDup.status === 409 && /already exists/i.test(avDup.json?.message), avDup.json);
  const sign = await api("POST", `/storage/v1/object/sign/hr-documents/${reg.json.storage_path}`, { token: tokens.employee, body: { expiresIn: 60 } });
  check("signed URL for own document", sign.status === 200 && sign.json?.signedURL?.startsWith("/object/sign/hr-documents/"), sign.json);
  const dl = await fetch(`${BASE}/storage/v1${sign.json.signedURL}&download=selftest.pdf`);
  const dlBytes = Buffer.from(await dl.arrayBuffer());
  check("signed URL serves the file (download param -> attachment)", dl.status === 200 && dlBytes.subarray(0, 5).toString() === "%PDF-" && /attachment/.test(dl.headers.get("content-disposition") || ""), dl.status);
  const tampered = await fetch(`${BASE}/storage/v1${sign.json.signedURL.replace("selftest", "selftesx")}`);
  check("signed URL token bound to path (tampered path rejected)", tampered.status === 400, tampered.status);
  const signOther = await api("POST", `/storage/v1/object/sign/hr-documents/${reg.json.storage_path}`, { token: tokens.employee2, body: { expiresIn: 60 } });
  check("signed URL denied for unauthorised user (employee2)", signOther.status === 400 && /not found/i.test(signOther.json?.message), signOther.json);
  const fixtureDoc = docs.json.find((d) => /Offer letter/.test(d.title));
  const signHr = await api("POST", `/storage/v1/object/sign/hr-documents/${fixtureDoc?.versions?.[0]?.storage_path}`, { token: tokens["hr.admin"], body: { expiresIn: 60 } });
  const fixFile = signHr.json?.signedURL ? await fetch(`${BASE}/storage/v1${signHr.json.signedURL}`) : null;
  check("fixture document object exists in storage and is served to HR", fixFile?.status === 200, signHr.json);
  const rmOther = await api("DELETE", "/storage/v1/object/hr-documents", { token: tokens.employee, body: { prefixes: [reg.json.storage_path] } });
  check("storage delete without a DELETE policy removes nothing", rmOther.status === 200 && Array.isArray(rmOther.json) && rmOther.json.length === 0, rmOther.json);

  // ---------------------------------------------------------------- functions
  const fnEmp = await api("POST", "/functions/v1/hr-email-dispatch", { token: tokens.employee, body: {} });
  check("hr-email-dispatch refused for employee (403)", fnEmp.status === 403 && fnEmp.json?.error === "Not allowed.", fnEmp.json);
  const unknownFn = await api("POST", "/functions/v1/does-not-exist", { token: tokens.superadmin, body: {} });
  check("unknown function -> 404", unknownFn.status === 404, unknownFn.json);
  const e5 = byEmail["demo.engineer5@example.com"];
  const e5link = await rest("GET", `hr_employees?select=user_id&id=eq.${e5.id}`, { token: tokens.superadmin });
  if (e5link.json?.[0]?.user_id) {
    console.log("SKIP  invite / revoke / banned-login checks: already exercised on this harness (restart it for a fresh run)");
  } else {
  const inv = await api("POST", "/functions/v1/hr-invite-employee", { token: tokens["hr.admin"], body: { employee_id: e5.id } });
  check("hr-invite-employee (HR) links a new account", inv.status === 200 && inv.json?.invited === true && inv.json.email === "demo.engineer5@example.com", inv.json);
  const invAgain = await api("POST", "/functions/v1/hr-invite-employee", { token: tokens["hr.admin"], body: { employee_id: e5.id } });
  check("re-invite of a linked employee -> 409", invAgain.status === 409, invAgain.json);
  const invEmp = await api("POST", "/functions/v1/hr-invite-employee", { token: tokens.employee, body: { employee_id: e5.id } });
  check("hr-invite-employee refused for employee (403 + RPC message)", invEmp.status === 403 && invEmp.json?.error === "You are not allowed to invite employees.", invEmp.json);
  const invited = await signIn("demo.engineer5@example.com", INVITE_PASSWORD);
  const invMe = invited.json?.access_token ? (await rpc("hr_me", {}, invited.json.access_token)).json : null;
  check("invited account can sign in and is linked", invited.status === 200 && invMe?.employee?.id === e5.id, invMe);
  const exits = await rest("GET", `hr_exits?select=id,status&employee_id=eq.${e5.id}`, { token: tokens["hr.admin"] });
  const rev = await api("POST", "/functions/v1/hr-revoke-exit-access", { token: tokens["hr.admin"], body: { exit_id: exits.json?.[0]?.id } });
  check("hr-revoke-exit-access bans the account and records it", rev.status === 200 && rev.json?.revoked === true && rev.json.had_account === true, rev.json);
  const banned = await signIn("demo.engineer5@example.com", INVITE_PASSWORD);
  check("banned account cannot sign in", banned.status === 400 && banned.json?.error_code === "user_banned", banned.json);
  }
  const disp = await api("POST", "/functions/v1/hr-email-dispatch", { token: tokens["hr.admin"], body: {} });
  const outbox = await rest("GET", "hr_email_outbox?select=status,last_error&status=eq.sent", { token: tokens["hr.admin"] });
  check("hr-email-dispatch never reports 'sent' (rows marked failed)", disp.status === 200 && disp.json?.sent === 0 && disp.json.failed === disp.json.processed && outbox.json?.length === 0, disp.json);

  // ---------------------------------------------------------------- public site
  const jobs = await rest("GET", "job_postings?select=*&order=created_at.desc", { token: ANON });
  check("public: anon reads job_postings", jobs.status === 200 && Array.isArray(jobs.json), jobs.json);
  const rem = await rpc("job_openings_remaining", {}, ANON);
  check("public: job_openings_remaining RPC (setof) for anon", rem.status === 200 && Array.isArray(rem.json), rem.json);
  const isAdm = await rpc("is_admin", {}, ANON);
  check("public: is_admin() for anon is false", isAdm.status === 200 && isAdm.json === false, isAdm.json);
  const blogs = await rest("GET", "blog_posts?select=*&limit=5", { token: ANON });
  const port = await rest("GET", "portfolio_projects?select=*&limit=5", { token: ANON });
  check("public: blog_posts and portfolio_projects readable by anon", blogs.status === 200 && port.status === 200, { blogs: blogs.json, port: port.json });
  const views = await rpc("increment_blog_post_views", { post_slug: "no-such-post" }, ANON);
  check("public: increment_blog_post_views RPC callable", views.status === 204 || views.status === 200, views.json);

  // ---------------------------------------------------------------- CORS
  const pre = await fetch(`${BASE}/rest/v1/hr_employees`, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:8090", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,apikey,x-client-info" } });
  const preBad = await fetch(`${BASE}/rest/v1/hr_employees`, { method: "OPTIONS", headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "GET" } });
  check("CORS: test origin allowed, other origins not", pre.status === 204 && pre.headers.get("access-control-allow-origin") === "http://127.0.0.1:8090" && /content-range/.test(pre.headers.get("access-control-expose-headers") || "") && !preBad.headers.get("access-control-allow-origin"));
} catch (e) {
  check("selftest crashed", false, e.stack || e.message);
}

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} checks)`);
process.exit(fail ? 1 : 0);

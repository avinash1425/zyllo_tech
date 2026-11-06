#!/usr/bin/env node
// LOCAL TEST HARNESS ONLY — a stand-in for the subset of Supabase that the
// Zyllo HRMS frontend uses, backed by a throwaway local PostgreSQL cluster:
//   /rest/v1      PostgREST-compatible tables, views and RPCs (subset)
//   /auth/v1      GoTrue-compatible password sign-in, refresh, user, logout
//   /storage/v1   Storage-compatible upload / signed URLs / delete (RLS enforced)
//   /functions/v1 local stand-ins for hr-invite-employee, hr-revoke-exit-access,
//                 hr-email-dispatch (same contracts; no email is ever sent)
// Every user-scoped statement runs through hrms_local.exec() as the API role
// (anon / authenticated / service_role) with request.jwt.claims set, over a
// connection made as `authenticator` — so RLS and auth.uid() behave as on
// Supabase. Listens on 127.0.0.1 only. Started by start.mjs, which passes the
// per-run JWT secret through this process's environment.
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { API_LOG_FILE, INVITE_PASSWORD, PG_USER, lit, makePsql, signJwt, verifyJwt } from "./lib.mjs";
import { ApiError, CATALOG_SQL, QueryBuilder, buildCatalog, pgStatus } from "./postgrest.mjs";

// ------------------------------------------------------------------ config
const env = process.env;
const SECRET = env.HRMS_LOCAL_JWT_SECRET;
const PG_PORT = Number(env.HRMS_LOCAL_PG_PORT);
const PG_BIN_DIR = env.HRMS_LOCAL_PG_BIN || "C:\\Program Files\\PostgreSQL\\17\\bin";
const API_PORT = Number(env.HRMS_LOCAL_API_PORT || 54321);
const STORAGE_DIR = env.HRMS_LOCAL_STORAGE_DIR;
const ORIGINS = new Set((env.HRMS_LOCAL_ORIGINS || "http://127.0.0.1:8090,http://localhost:8090").split(",").map((s) => s.trim()).filter(Boolean));
const SITE_URL = env.HRMS_LOCAL_SITE_URL || "http://127.0.0.1:8090";
if (!SECRET || SECRET.length < 32 || !PG_PORT || !STORAGE_DIR) {
  console.error("api-server: HRMS_LOCAL_JWT_SECRET, HRMS_LOCAL_PG_PORT and HRMS_LOCAL_STORAGE_DIR are required (use start.mjs).");
  process.exit(2);
}
const ACCESS_TTL = 3600;
const exe = process.platform === "win32" ? ".exe" : "";
const bin = (name) => path.join(PG_BIN_DIR, `${name}${exe}`);
const STORAGE_KEY = createHmac("sha256", SECRET).update("storage-signing").digest();

// ------------------------------------------------------------------ logging
function log(line) {
  const s = `${new Date().toISOString()} ${line}`;
  console.log(s);
  try { appendFileSync(API_LOG_FILE, s + "\n"); } catch { /* ignore */ }
}

// ------------------------------------------------------------------ psql pool
// Persistent psql processes connected as `authenticator`. Each request is one
// line: `select hrms_local.exec(...);` followed by a marker query; output is
// read up to the marker. SQL text is passed base64-encoded so the psql lexer
// never sees request data.
class PsqlWorker {
  constructor(user) {
    this.user = user;
    this.busy = false;
    this.start();
  }
  start() {
    this.buf = "";
    this.err = "";
    this.dead = false;
    this.proc = spawn(bin("psql"), ["-h", "127.0.0.1", "-p", String(PG_PORT), "-U", this.user, "-d", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], {
      env: { ...process.env, PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c client_min_messages=warning", PGCONNECT_TIMEOUT: "10" },
      windowsHide: true,
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (d) => { this.buf += d; this.check(); });
    this.proc.stderr.on("data", (d) => { this.err += d; });
    this.proc.stdin.on("error", () => {});
    this.proc.on("exit", () => {
      this.dead = true;
      if (this.pending) { const p = this.pending; this.pending = null; clearTimeout(p.timer); p.reject(new Error("psql exited: " + (this.err.trim() || "unknown error"))); }
    });
  }
  check() {
    if (!this.pending) return;
    const idx = this.buf.indexOf(this.pending.marker);
    if (idx < 0) return;
    const out = this.buf.slice(0, idx);
    this.buf = this.buf.slice(idx + this.pending.marker.length).replace(/^\r?\n/, "");
    const p = this.pending; this.pending = null; clearTimeout(p.timer);
    p.resolve(out);
  }
  run(sqlLine, timeoutMs = 40000) {
    if (this.dead) this.start();
    return new Promise((resolve, reject) => {
      const marker = `__HRMS_LOCAL_${randomBytes(6).toString("hex")}__`;
      const timer = setTimeout(() => { this.pending = null; try { this.proc.kill(); } catch {} reject(new Error("database statement timed out")); }, timeoutMs);
      this.pending = { marker, resolve, reject, timer };
      this.err = "";
      this.proc.stdin.write(`${sqlLine}\nselect '${marker}';\n`);
    });
  }
}

class Pool {
  constructor(user, size) { this.workers = Array.from({ length: size }, () => new PsqlWorker(user)); this.queue = []; }
  run(sqlLine) {
    return new Promise((resolve, reject) => { this.queue.push({ sqlLine, resolve, reject }); this.pump(); });
  }
  pump() {
    for (const w of this.workers) {
      if (!this.queue.length) return;
      if (w.busy) continue;
      const job = this.queue.shift();
      w.busy = true;
      w.run(job.sqlLine).then(job.resolve, job.reject).finally(() => { w.busy = false; this.pump(); });
    }
  }
  close() { for (const w of this.workers) try { w.proc.kill(); } catch {} }
}

const pool = new Pool("authenticator", 8);
const adminPsql = makePsql({ bin, port: PG_PORT, user: PG_USER });
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

/** Run one generated statement as an API role. Resolves { data } or { error }. */
async function execAs(role, claims, sql) {
  const line = `select hrms_local.exec(${lit(role)}, convert_from(decode('${b64(claims ? JSON.stringify(claims) : "")}', 'base64'), 'UTF8'), convert_from(decode('${b64(sql)}', 'base64'), 'UTF8'));`;
  const out = (await pool.run(line)).trim();
  if (!out) throw new Error("empty database response");
  return JSON.parse(out);
}

/** Owner-level SQL for GoTrue / harness bookkeeping. Returns parsed JSON (or null). */
async function adminJson(sql) {
  const r = await adminPsql(sql);
  if (!r.ok) {
    const msg = (r.stderr.match(/ERROR:\s+(.*)/) || [])[1] || r.stderr.trim();
    throw Object.assign(new Error(msg), { pgError: true });
  }
  const out = r.stdout.trim();
  return out ? JSON.parse(out) : null;
}

// ------------------------------------------------------------------ catalog
const catalogRaw = await adminJson(CATALOG_SQL);
const catalog = buildCatalog(catalogRaw);
log(`catalog: ${catalog.relations.size} relations, ${catalog.fks.length} foreign keys, ${catalog.functions.size} functions (schema public)`);

// ------------------------------------------------------------------ HTTP utils
const ALLOW_HEADERS = "authorization, apikey, content-type, prefer, range, x-client-info, accept-profile, content-profile, x-upsert, cache-control, x-supabase-api-version, x-retry-count, x-metadata, x-region";

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Expose-Headers": "content-range, content-profile, x-supabase-api-version, content-location, location",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function send(ctx, status, body, headers = {}) {
  const { req, res } = ctx;
  ctx.status = status;
  const h = { ...corsHeaders(req), ...headers };
  if (body === undefined || body === null || status === 204 || req.method === "HEAD") {
    if (body !== undefined && body !== null && req.method === "HEAD" && !h["Content-Type"]) h["Content-Type"] = "application/json; charset=utf-8";
    res.writeHead(status, h);
    return res.end();
  }
  if (Buffer.isBuffer(body)) { res.writeHead(status, h); return res.end(body); }
  const text = typeof body === "string" && h["Content-Type"] ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...h });
  res.end(text);
}

const pgrstError = (ctx, status, code, message, details = null, hint = null) => send(ctx, status, { code, message, details, hint });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("Payload too large"), { tooLarge: true })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parsePrefer(h) {
  const out = {};
  for (const part of String(h || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (k === "return") out.return = v;
    else if (k === "count") out.count = v;
    else if (k === "resolution") out.resolution = v;
    else if (k === "missing") out.missing = v;
  }
  return out;
}

// ------------------------------------------------------------------ auth (JWT)
/** Resolves the request's role/claims from Authorization (or apikey). */
function authenticate(req) {
  const authz = req.headers.authorization || "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : null;
  const token = bearer || (req.headers.apikey ? String(req.headers.apikey) : null);
  if (!token) return { error: { status: 401, body: { message: "No API key found in request", hint: "No `apikey` request header or url param was found." } } };
  try {
    const claims = verifyJwt(token, SECRET);
    if (!["anon", "authenticated", "service_role"].includes(claims.role)) {
      return { error: { status: 401, body: { code: "PGRST301", message: "JWT role is not allowed", details: null, hint: null } } };
    }
    return { role: claims.role, claims, token };
  } catch (e) {
    return { error: { status: 401, body: { code: e.code === "expired" ? "PGRST303" : "PGRST301", message: e.code === "expired" ? "JWT expired" : e.message, details: null, hint: null } } };
  }
}

// ------------------------------------------------------------------ GoTrue
const refreshTokens = new Map();   // token -> { userId, sessionId, createdAt, revoked }

function gotrueUser(u) {
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    email_confirmed_at: u.created_at, phone: "", confirmed_at: u.created_at, last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data || {},
    identities: [], created_at: u.created_at, updated_at: u.created_at, is_anonymous: false,
  };
}

// Like GoTrue: a sign-in creates an auth.sessions row; a refresh keeps the
// same session_id. (Migration 202 requires the session row to exist.)
async function issueSession(u, existingSessionId = null) {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = existingSessionId || randomUUID();
  if (!existingSessionId) {
    await adminJson(`insert into auth.sessions (id, user_id) values (${lit(sessionId)}::uuid, ${lit(u.id)}::uuid) returning null;`);
  }
  const access = signJwt({
    iss: `http://127.0.0.1:${API_PORT}/auth/v1`, sub: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    exp: now + ACCESS_TTL, iat: now, session_id: sessionId, aal: "aal1", amr: [{ method: "password", timestamp: now }],
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data || {}, is_anonymous: false,
  }, SECRET);
  const refresh = randomBytes(24).toString("base64url");
  refreshTokens.set(refresh, { userId: u.id, sessionId, createdAt: Date.now(), revoked: false });
  return { access_token: access, token_type: "bearer", expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token: refresh, user: gotrueUser(u) };
}

const authError = (ctx, status, errorCode, msg, legacy = null) =>
  send(ctx, status, { code: status, error_code: errorCode, msg, ...(legacy ? { error: legacy, error_description: msg } : {}) });

async function userById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  return adminJson(`select to_jsonb(u) from auth.users u where u.id = ${lit(id)}::uuid;`);
}

async function handleAuth(ctx, sub) {
  const { req, url } = ctx;
  if (sub === "/settings" && req.method === "GET") {
    return send(ctx, 200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: false, phone_autoconfirm: false, sms_provider: "", saml_enabled: false });
  }
  if (sub === "/health") return send(ctx, 200, { name: "GoTrue (hrms-local stand-in)", description: "LOCAL TEST HARNESS" });
  if (sub === "/token" && req.method === "POST") {
    const body = await jsonBody(ctx);
    if (body === undefined) return;
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      ctx.role = "anon";
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      if (!email || !password) return authError(ctx, 400, "validation_failed", "missing email or phone", "invalid_request");
      const row = await adminJson(`select jsonb_build_object('ok', coalesce(p.password_hash = public.crypt(${lit(password)}, p.password_hash), false),
          'banned', coalesce(u.banned_until > now(), false), 'user', to_jsonb(u))
        from auth.users u left join hrms_local.passwords p on p.user_id = u.id where lower(u.email) = lower(${lit(email)});`);
      if (!row || !row.ok) return authError(ctx, 400, "invalid_credentials", "Invalid login credentials", "invalid_grant");
      if (row.banned) return authError(ctx, 400, "user_banned", "User is banned", "invalid_grant");
      ctx.role = "authenticated";
      return send(ctx, 200, await issueSession(row.user));
    }
    if (grant === "refresh_token") {
      const rt = refreshTokens.get(String(body.refresh_token || ""));
      if (!rt || rt.revoked) return authError(ctx, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found", "invalid_grant");
      const u = await adminJson(`select jsonb_build_object('banned', coalesce(u.banned_until > now(), false), 'user', to_jsonb(u)) from auth.users u where u.id = ${lit(rt.userId)}::uuid;`);
      if (!u) return authError(ctx, 400, "user_not_found", "User not found", "invalid_grant");
      if (u.banned) return authError(ctx, 400, "user_banned", "User is banned", "invalid_grant");
      // A deleted session (sign-out, revocation) invalidates its refresh tokens, as in GoTrue.
      const live = await adminJson(`select to_jsonb(exists (select 1 from auth.sessions where id = ${lit(rt.sessionId)}::uuid));`);
      if (!live) { rt.revoked = true; return authError(ctx, 400, "session_not_found", "Session from session_id claim in JWT does not exist", "invalid_grant"); }
      rt.revoked = true;
      ctx.role = "authenticated";
      return send(ctx, 200, await issueSession(u.user, rt.sessionId));
    }
    return authError(ctx, 400, "validation_failed", "unsupported_grant_type", "unsupported_grant_type");
  }
  if (sub === "/signup" && req.method === "POST") return authError(ctx, 422, "signup_disabled", "Signups not allowed for this instance");
  if ((sub === "/recover" || sub === "/otp" || sub === "/magiclink") && req.method === "POST") {
    log("[auth] password recovery / OTP requested — the local harness sends no email");
    return send(ctx, 200, {});
  }

  // Endpoints that need a user token
  const a = authenticate(req);
  if (a.error) return send(ctx, 401, { code: 401, error_code: "no_authorization", msg: "This endpoint requires a valid Bearer token" });
  ctx.role = a.role;
  if (a.role !== "authenticated" || !a.claims.sub) return send(ctx, 403, { code: 403, error_code: "bad_jwt", msg: "invalid claim: missing sub claim" });
  if (sub === "/user" && req.method === "GET") {
    const u = await userById(a.claims.sub);
    if (!u) return send(ctx, 403, { code: 403, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" });
    return send(ctx, 200, gotrueUser(u));
  }
  if (sub === "/user" && req.method === "PUT") {
    const body = await jsonBody(ctx);
    if (body === undefined) return;
    const u = await userById(a.claims.sub);
    if (!u) return send(ctx, 403, { code: 403, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" });
    if (body.email && body.email !== u.email) return send(ctx, 422, { code: 422, error_code: "email_change_disabled", msg: "Email changes are not supported by the local harness" });
    if (typeof body.password === "string") {
      if (body.password.length < 6) return send(ctx, 422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters.", weak_password: { reasons: ["length"] } });
      await adminJson(`insert into hrms_local.passwords (user_id, password_hash) values (${lit(u.id)}::uuid, public.crypt(${lit(body.password)}, public.gen_salt('bf', 6)))
        on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now() returning null;`);
      log(`[auth] password changed for ${u.email}`);
    }
    if (body.data && typeof body.data === "object") {
      await adminJson(`update auth.users set raw_user_meta_data = raw_user_meta_data || ${lit(JSON.stringify(body.data))}::jsonb where id = ${lit(u.id)}::uuid returning null;`);
    }
    return send(ctx, 200, gotrueUser(await userById(u.id)));
  }
  if (sub === "/logout" && req.method === "POST") {
    // GoTrue semantics: local = this session, global = all of the user's
    // sessions, others = all but this one. Deleting the auth.sessions row also
    // ends access for still-unexpired access tokens (migration 202).
    const scope = url.searchParams.get("scope") || "global";
    const me = String(a.claims.session_id || "");
    const ends = (v) => v.userId === a.claims.sub && (scope === "global" || (scope === "local" ? v.sessionId === me : v.sessionId !== me));
    for (const [, v] of refreshTokens) if (ends(v)) v.revoked = true;
    const where = scope === "local" ? `id = ${lit(me)}::uuid`
      : scope === "others" ? `user_id = ${lit(a.claims.sub)}::uuid and id <> ${lit(me)}::uuid`
      : `user_id = ${lit(a.claims.sub)}::uuid`;
    if (/^[0-9a-f-]{36}$/i.test(me) || scope === "global") await adminJson(`delete from auth.sessions where ${where} returning null;`);
    return send(ctx, 204, null);
  }
  return send(ctx, 404, { code: 404, error_code: "not_found", msg: `Endpoint ${sub} is not implemented by the local harness` });
}

async function jsonBody(ctx, limit = 5 * 1024 * 1024) {
  let buf;
  try { buf = await readBody(ctx.req, limit); } catch (e) {
    pgrstError(ctx, 413, "PGRST413", e.tooLarge ? "Payload too large" : "Could not read request body");
    return undefined;
  }
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString("utf8")); } catch {
    pgrstError(ctx, 400, "PGRST102", "Empty or invalid json");
    return undefined;
  }
}

// ------------------------------------------------------------------ REST
function profileOk(ctx) {
  const p = ctx.req.headers["accept-profile"] || ctx.req.headers["content-profile"];
  if (p && p !== "public") { pgrstError(ctx, 406, "PGRST106", "The schema must be one of the following: public", null, null); return false; }
  return true;
}

function wantsSingle(req) {
  return /application\/vnd\.pgrst\.object\+json/i.test(String(req.headers.accept || ""));
}

function sendDbError(ctx, err) {
  let { code, message, details, hint } = err;
  if (hint === "PGRST116") { code = "PGRST116"; hint = null; }
  return send(ctx, pgStatus(code, ctx.role), { code, message, details: details ?? null, hint: hint ?? null });
}

function contentRange(offset, n, total) {
  const tot = total == null ? "*" : String(total);
  return n > 0 ? `${offset}-${offset + n - 1}/${tot}` : `*/${tot}`;
}

async function handleRest(ctx, sub) {
  const { req, url } = ctx;
  const a = authenticate(req);
  if (a.error) return send(ctx, a.error.status, a.error.body);
  ctx.role = a.role;
  const claims = { ...a.claims };
  if (!profileOk(ctx)) return;
  if (sub === "/" || sub === "") return send(ctx, 200, { info: "hrms-local PostgREST stand-in", tables: [...catalog.relations.keys()].length });
  const qb = new QueryBuilder(catalog);
  const prefer = parsePrefer(req.headers.prefer);
  const single = wantsSingle(req);
  const m = sub.match(/^\/rpc\/([A-Za-z_][A-Za-z0-9_]*)$/);
  try {
    if (m) {
      const fn = m[1];
      let args = {};
      const params = new URLSearchParams(url.search);
      if (req.method === "POST") {
        const body = await jsonBody(ctx);
        if (body === undefined) return;
        if (body === null || typeof body !== "object" || Array.isArray(body)) return pgrstError(ctx, 400, "PGRST102", "Empty or invalid json");
        args = body;
      } else if (req.method === "GET" || req.method === "HEAD") {
        const names = qb.functionArgNames(fn);
        for (const [k, v] of params.entries()) if (names.has(k)) args[k] = v;
      } else return pgrstError(ctx, 405, "PGRST101", "Only GET, HEAD and POST are allowed for RPC");
      const q = qb.rpc({ fn, args, params, count: prefer.count === "exact", rangeHeader: req.headers.range });
      const r = await execAs(a.role, claims, q.sql);
      if (r.error) return sendDbError(ctx, r.error);
      const { rows, count } = r.data;
      if (q.kind === "void") return send(ctx, 204, null);
      if (q.kind === "set") {
        const headers = { "Content-Range": contentRange(q.offset ?? 0, rows.length, count) };
        if (single) {
          if (rows.length !== 1) return send(ctx, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null }, headers);
          return send(ctx, 200, rows[0], headers);
        }
        return send(ctx, 200, rows, headers);
      }
      return send(ctx, 200, JSON.stringify(rows === undefined ? null : rows), { "Content-Type": "application/json; charset=utf-8" });
    }

    const tm = sub.match(/^\/([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!tm) return pgrstError(ctx, 404, "PGRST125", `Invalid path specified in request URL`);
    const table = tm[1];
    const params = new URLSearchParams(url.search);
    if (req.method === "GET" || req.method === "HEAD") {
      const q = qb.read({ table, params, count: prefer.count === "exact" || prefer.count === "planned" || prefer.count === "estimated", rangeHeader: req.headers.range });
      const r = await execAs(a.role, claims, q.sql);
      if (r.error) return sendDbError(ctx, r.error);
      const { rows, count } = r.data;
      const headers = { "Content-Range": contentRange(q.offset, rows.length, count) };
      if (single) {
        if (rows.length !== 1) return send(ctx, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null }, headers);
        return send(ctx, 200, rows[0], headers);
      }
      if (/text\/csv/i.test(String(req.headers.accept || ""))) return pgrstError(ctx, 406, "PGRST107", "CSV output is not supported by the local harness");
      return send(ctx, 200, rows, headers);
    }
    if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
      let body = null;
      if (req.method !== "DELETE") {
        body = await jsonBody(ctx);
        if (body === undefined) return;
      }
      const opts = { table, params, body, prefer: { ...prefer, single } };
      const q = req.method === "POST" ? qb.insert(opts) : req.method === "PATCH" ? qb.update(opts) : qb.remove(opts);
      const r = await execAs(a.role, claims, q.sql);
      if (r.error) return sendDbError(ctx, r.error);
      const { rows, count } = r.data;
      const headers = {};
      if (count != null) headers["Content-Range"] = `*/${count}`;
      if (prefer.return !== "representation") return send(ctx, req.method === "POST" ? 201 : 204, null, headers);
      const out = single ? rows[0] ?? null : rows;
      return send(ctx, req.method === "POST" ? 201 : 200, out, headers);
    }
    return pgrstError(ctx, 405, "PGRST117", `Unsupported HTTP method: ${req.method}`);
  } catch (e) {
    if (e instanceof ApiError) return send(ctx, e.status, e.body);
    throw e;
  }
}

// ------------------------------------------------------------------ Storage
const storageErr = (ctx, httpStatus, statusCode, error, message) => send(ctx, httpStatus, { statusCode: String(statusCode), error, message });

function objectPath(rest) {
  // rest: "bucket/a/b.pdf" (URL-encoded segments)
  const segs = rest.split("/").map((s) => { try { return decodeURIComponent(s); } catch { return null; } });
  if (segs.some((s) => s === null)) return null;
  const [bucket, ...nameSegs] = segs;
  if (!bucket || !/^[A-Za-z0-9_.-]{1,63}$/.test(bucket)) return null;
  if (!nameSegs.length || nameSegs.some((s) => !s || s === "." || s === ".." || /[\\:\0]/.test(s) || s.length > 255)) return null;
  const name = nameSegs.join("/");
  if (name.length > 1024) return null;
  return { bucket, name, file: path.join(STORAGE_DIR, bucket, ...nameSegs) };
}

function parseMultipart(buf, contentType) {
  const bm = String(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!bm) return null;
  const boundary = Buffer.from("--" + (bm[1] || bm[2]).trim());
  const parts = [];
  let pos = buf.indexOf(boundary);
  while (pos >= 0) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === "--") break;
    const next = buf.indexOf(boundary, start);
    if (next < 0) break;
    const part = buf.slice(start + 2, next - 2); // strip CRLF after boundary and before next
    const sep = part.indexOf("\r\n\r\n");
    if (sep >= 0) {
      const headers = part.slice(0, sep).toString("utf8");
      const body = part.slice(sep + 4);
      const name = (headers.match(/name="([^"]*)"/i) || [])[1] ?? null;
      const filename = (headers.match(/filename="([^"]*)"/i) || [])[1] ?? null;
      const ctype = (headers.match(/content-type:\s*([^\r\n]+)/i) || [])[1] ?? null;
      parts.push({ name, filename, contentType: ctype ? ctype.trim() : null, body });
    }
    pos = next;
  }
  return parts;
}

function mimeAllowed(mime, allowed) {
  if (!allowed || !allowed.length) return true;
  const base = String(mime || "").split(";")[0].trim().toLowerCase();
  return allowed.some((a) => {
    const x = a.toLowerCase();
    return x === base || (x.endsWith("/*") && base.startsWith(x.slice(0, -1)));
  });
}

function signToken(bucket, name, expiresIn) {
  const payload = Buffer.from(JSON.stringify({ b: bucket, p: name, e: Math.floor(Date.now() / 1000) + expiresIn })).toString("base64url");
  const sig = createHmac("sha256", STORAGE_KEY).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function checkToken(token, bucket, name) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return "InvalidJWT";
  const expect = createHmac("sha256", STORAGE_KEY).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return "InvalidSignature";
  let p;
  try { p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return "InvalidJWT"; }
  if (p.b !== bucket || p.p !== name) return "InvalidSignature";
  if (p.e < Math.floor(Date.now() / 1000)) return "TokenExpired";
  return null;
}
const encodePath = (name) => name.split("/").map(encodeURIComponent).join("/");

async function handleStorage(ctx, sub) {
  const { req, url } = ctx;

  // Signed download — authorised by the HMAC token only (no API key), like Supabase.
  let m = sub.match(/^\/object\/sign\/(.+)$/);
  if (m && (req.method === "GET" || req.method === "HEAD")) {
    ctx.role = "signed-url";
    const op = objectPath(m[1]);
    if (!op) return storageErr(ctx, 400, 400, "InvalidKey", "Invalid key");
    const bad_ = checkToken(url.searchParams.get("token"), op.bucket, op.name);
    if (bad_) return storageErr(ctx, 400, 400, bad_, bad_ === "TokenExpired" ? "jwt expired" : "invalid signature");
    if (!existsSync(op.file)) return storageErr(ctx, 400, 404, "not_found", "Object not found");
    const meta = await adminJson(`select metadata from storage.objects where bucket_id = ${lit(op.bucket)} and name = ${lit(op.name)};`);
    const mime = meta?.mimetype || "application/octet-stream";
    const headers = { "Content-Type": mime, "Cache-Control": "no-store", "Content-Length": String(statSync(op.file).size), "X-Content-Type-Options": "nosniff" };
    if (url.searchParams.has("download")) {
      const fname = url.searchParams.get("download") || op.name.split("/").pop();
      headers["Content-Disposition"] = `attachment; filename="${fname.replace(/["\\\r\n]/g, "_")}"`;
    }
    return send(ctx, 200, req.method === "HEAD" ? null : readFileSync(op.file), headers);
  }

  const a = authenticate(req);
  if (a.error) return storageErr(ctx, a.error.status, a.error.status, "Unauthorized", a.error.body.message);
  ctx.role = a.role;
  const claims = a.claims;

  if (sub === "/bucket" && req.method === "GET") {
    const r = await execAs(a.role, claims, `select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from storage.buckets b`);
    if (r.error) return storageErr(ctx, 400, 400, "DatabaseError", r.error.message);
    return send(ctx, 200, r.data);
  }

  // Create signed URL(s)
  m = sub.match(/^\/object\/sign\/(.+)$/);
  if (m && req.method === "POST") {
    const body = await jsonBody(ctx);
    if (body === undefined) return;
    const expiresIn = Math.max(1, Math.min(Number(body.expiresIn) || 60, 60 * 60 * 24 * 7));
    if (Array.isArray(body.paths)) {
      const bucket = decodeURIComponent(m[1]);
      const out = [];
      for (const p of body.paths) {
        const op = objectPath(`${encodeURIComponent(bucket)}/${String(p).split("/").map(encodeURIComponent).join("/")}`);
        if (!op) { out.push({ path: p, error: "Invalid key", signedURL: null }); continue; }
        const r = await execAs(a.role, claims, `select count(*)::int from storage.objects where bucket_id = ${lit(op.bucket)} and name = ${lit(op.name)}`);
        out.push(r.error || !r.data ? { path: p, error: "Either the object does not exist or you do not have access to it", signedURL: null }
          : { path: p, error: null, signedURL: `/object/sign/${encodeURIComponent(op.bucket)}/${encodePath(op.name)}?token=${signToken(op.bucket, op.name, expiresIn)}` });
      }
      return send(ctx, 200, out);
    }
    const op = objectPath(m[1]);
    if (!op) return storageErr(ctx, 400, 400, "InvalidKey", "Invalid key");
    // Authorisation = the caller's RLS-filtered view of storage.objects.
    const r = await execAs(a.role, claims, `select count(*)::int from storage.objects where bucket_id = ${lit(op.bucket)} and name = ${lit(op.name)}`);
    if (r.error) return storageErr(ctx, 400, 400, "DatabaseError", r.error.message);
    if (!r.data) return storageErr(ctx, 400, 404, "not_found", "Object not found");
    return send(ctx, 200, { signedURL: `/object/sign/${encodeURIComponent(op.bucket)}/${encodePath(op.name)}?token=${signToken(op.bucket, op.name, expiresIn)}` });
  }

  // Authenticated download (storage.from(b).download(path))
  m = sub.match(/^\/object\/(?:authenticated\/)?(.+)$/);
  if (m && (req.method === "GET" || req.method === "HEAD") && !sub.startsWith("/object/public/") && !sub.startsWith("/object/info/")) {
    const op = objectPath(m[1]);
    if (!op) return storageErr(ctx, 400, 400, "InvalidKey", "Invalid key");
    const r = await execAs(a.role, claims, `select (select metadata from storage.objects where bucket_id = ${lit(op.bucket)} and name = ${lit(op.name)})`);
    if (r.error) return storageErr(ctx, 400, 400, "DatabaseError", r.error.message);
    if (!r.data || !existsSync(op.file)) return storageErr(ctx, 400, 404, "not_found", "Object not found");
    return send(ctx, 200, req.method === "HEAD" ? null : readFileSync(op.file), { "Content-Type": r.data.mimetype || "application/octet-stream" });
  }

  // Upload (POST create, PUT update)
  m = sub.match(/^\/object\/(.+)$/);
  if (m && (req.method === "POST" || req.method === "PUT") && !/^\/object\/(list|move|copy|info|upload)\//.test(sub)) {
    const op = objectPath(m[1]);
    if (!op) return storageErr(ctx, 400, 400, "InvalidKey", `Invalid key: ${m[1]}`);
    const bucket = await adminJson(`select to_jsonb(b) from storage.buckets b where b.id = ${lit(op.bucket)};`);
    if (!bucket) return storageErr(ctx, 400, 404, "Bucket not found", "Bucket not found");
    const limit = Number(bucket.file_size_limit) || 50 * 1024 * 1024;
    let raw;
    try { raw = await readBody(req, limit + 64 * 1024); } catch (e) {
      return storageErr(ctx, 413, 413, "Payload too large", "The object exceeded the maximum allowed size");
    }
    let bytes = raw, mime = req.headers["content-type"] || "application/octet-stream";
    if (/^multipart\/form-data/i.test(mime)) {
      const parts = parseMultipart(raw, mime) || [];
      const filePart = parts.find((p) => p.filename !== null) || parts.find((p) => p.name === "");
      if (!filePart) return storageErr(ctx, 400, 400, "InvalidRequest", "No file found in the multipart body");
      bytes = filePart.body;
      mime = filePart.contentType || "application/octet-stream";
    }
    if (bytes.length > limit) return storageErr(ctx, 413, 413, "Payload too large", "The object exceeded the maximum allowed size");
    if (!mimeAllowed(mime, bucket.allowed_mime_types)) return storageErr(ctx, 400, 415, "invalid_mime_type", `mime type ${mime} is not supported`);
    const upsert = req.method === "PUT" || String(req.headers["x-upsert"] || "").toLowerCase() === "true";
    const id = randomUUID();
    const meta = JSON.stringify({ mimetype: mime.split(";")[0].trim(), size: bytes.length, cacheControl: req.headers["cache-control"] || "max-age=3600", lastModified: new Date().toISOString() });
    const owner = a.role === "authenticated" && claims.sub ? `${lit(claims.sub)}::uuid` : "NULL";
    // Write the bytes to a temp file first; move into place only if the row (RLS) succeeds.
    mkdirSync(path.dirname(op.file), { recursive: true });
    const tmp = `${op.file}.upload-${id}`;
    writeFileSync(tmp, bytes);
    let sql;
    if (req.method === "PUT") {
      sql = `with m as (update storage.objects set owner = ${owner}, metadata = ${lit(meta)}::jsonb where bucket_id = ${lit(op.bucket)} and name = ${lit(op.name)} returning 1) select (select count(*) from m)::int`;
    } else if (upsert) {
      sql = `with m as (insert into storage.objects (id, bucket_id, name, owner, metadata) values (${lit(id)}::uuid, ${lit(op.bucket)}, ${lit(op.name)}, ${owner}, ${lit(meta)}::jsonb)
             on conflict (bucket_id, name) do update set owner = excluded.owner, metadata = excluded.metadata returning 1) select (select count(*) from m)::int`;
    } else {
      sql = `with m as (insert into storage.objects (id, bucket_id, name, owner, metadata) values (${lit(id)}::uuid, ${lit(op.bucket)}, ${lit(op.name)}, ${owner}, ${lit(meta)}::jsonb) returning 1) select (select count(*) from m)::int`;
    }
    const r = await execAs(a.role, claims, sql);
    if (r.error || !r.data) {
      try { unlinkSync(tmp); } catch {}
      if (r.error?.code === "23505") return storageErr(ctx, 409, 409, "Duplicate", "The resource already exists");
      if (r.error?.code === "42501") return storageErr(ctx, 403, 403, "Unauthorized", "new row violates row-level security policy");
      if (!r.error) return storageErr(ctx, 400, 404, "not_found", "Object not found");
      return storageErr(ctx, 400, 400, "DatabaseError", r.error.message);
    }
    try { renameSync(tmp, op.file); } catch (e) {
      try { unlinkSync(op.file); renameSync(tmp, op.file); } catch { return storageErr(ctx, 500, 500, "InternalError", "Could not store the file"); }
    }
    return send(ctx, 200, { Id: id, Key: `${op.bucket}/${op.name}` });
  }

  // Delete objects: DELETE /object/:bucket  { prefixes: [...] }
  m = sub.match(/^\/object\/([^/]+)$/);
  if (m && req.method === "DELETE") {
    const body = await jsonBody(ctx);
    if (body === undefined) return;
    const bucket = decodeURIComponent(m[1]);
    const names = Array.isArray(body.prefixes) ? body.prefixes.map(String) : [];
    if (!names.length) return send(ctx, 200, []);
    const r = await execAs(a.role, claims, `with d as (delete from storage.objects where bucket_id = ${lit(bucket)} and name = any (${lit("{" + names.map((n) => `"${n.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",") + "}")}::text[]) returning *)
      select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from d`);
    if (r.error) return storageErr(ctx, 400, 400, "DatabaseError", r.error.message);
    for (const o of r.data) {
      const op = objectPath(`${encodeURIComponent(o.bucket_id)}/${encodePath(o.name)}`);
      if (op) try { unlinkSync(op.file); } catch {}
    }
    return send(ctx, 200, r.data);
  }

  // List: POST /object/list/:bucket { prefix, limit, offset }
  m = sub.match(/^\/object\/list\/([^/]+)$/);
  if (m && req.method === "POST") {
    const body = await jsonBody(ctx);
    if (body === undefined) return;
    const bucket = decodeURIComponent(m[1]);
    const prefix = String(body.prefix || "").replace(/^\/+|\/+$/g, "");
    const lim = Math.min(Number(body.limit) || 100, 1000), off = Math.max(Number(body.offset) || 0, 0);
    const like = (prefix ? prefix + "/" : "").replace(/[\\%_]/g, "\\$&") + "%";
    const r = await execAs(a.role, claims, `select coalesce(jsonb_agg(jsonb_build_object('name', substr(o.name, ${prefix ? prefix.length + 2 : 1}), 'id', o.id, 'created_at', o.created_at, 'updated_at', o.created_at, 'metadata', o.metadata) order by o.name), '[]'::jsonb)
      from (select * from storage.objects where bucket_id = ${lit(bucket)} and name like ${lit(like)} order by name limit ${lim} offset ${off}) o`);
    if (r.error) return storageErr(ctx, 400, 400, "DatabaseError", r.error.message);
    return send(ctx, 200, r.data);
  }

  return storageErr(ctx, 404, 404, "not_found", `Storage endpoint ${req.method} ${sub} is not implemented by the local harness`);
}

// ------------------------------------------------------------------ Edge Functions
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rpcAs(role, claims, fn, args) {
  const q = new QueryBuilder(catalog).rpc({ fn, args, params: new URLSearchParams(), count: false });
  const r = await execAs(role, claims, q.sql);
  if (r.error) return { data: null, error: r.error };
  return { data: r.data.rows ?? null, error: null };
}
const SERVICE = { role: "service_role" };

async function handleFunctions(ctx, name) {
  const { req } = ctx;
  const known = ["hr-invite-employee", "hr-revoke-exit-access", "hr-email-dispatch", "hr-document-reminders"];
  if (!known.includes(name)) return send(ctx, 404, { code: "NOT_FOUND", message: "Requested function was not found" });
  if (req.method !== "POST") return send(ctx, 405, { error: "Method not allowed" });
  const a = authenticate(req);
  if (a.error) return send(ctx, 401, { error: "Sign in required." });
  ctx.role = a.role;
  const body = await jsonBody(ctx);
  if (body === undefined) return;

  if (name === "hr-invite-employee") {
    if (a.role !== "authenticated" || !a.claims.sub || !(await userById(a.claims.sub))) return send(ctx, 401, { error: "Sign in required." });
    const employeeId = String(body.employee_id ?? "");
    if (!UUID_RE.test(employeeId)) return send(ctx, 400, { error: "employee_id must be a UUID." });
    const chk = await rpcAs("authenticated", a.claims, "hr_can_invite", { p_employee: employeeId });
    if (chk.error) return send(ctx, 403, { error: chk.error.message?.trim() || "Not allowed to invite this employee." });
    const target = chk.data;
    if (target.user_id) return send(ctx, 409, { error: "This employee already has a linked account. Use portal access controls or a password reset instead." });
    let invited;
    try {
      invited = await adminJson(`with u as (insert into auth.users (email, raw_user_meta_data) values (${lit(target.email)}, ${lit(JSON.stringify({ employee_id: employeeId, invited_locally: true }))}::jsonb) returning *)
        select to_jsonb(u) from u;`);
      await adminJson(`insert into hrms_local.passwords (user_id, password_hash) values (${lit(invited.id)}::uuid, public.crypt(${lit(INVITE_PASSWORD)}, public.gen_salt('bf', 6))) returning null;`);
    } catch (e) {
      const msg = /duplicate key|already exists/i.test(e.message) ? "An account with this email already exists. Ask a Super Admin to link it manually." : `Invitation could not be sent: ${e.message}`;
      return send(ctx, 502, { error: msg });
    }
    const link = await rpcAs("service_role", SERVICE, "hr_link_invited_user", { p_employee: employeeId, p_user: invited.id, p_invited_by: a.claims.sub });
    if (link.error) {
      await adminJson(`delete from auth.users where id = ${lit(invited.id)}::uuid returning null;`).catch(() => {});
      return send(ctx, 500, { error: link.error.message?.trim() || "The invitation was created but linking failed; nothing was saved." });
    }
    log(`[functions] hr-invite-employee: NO EMAIL SENT (local harness). Activation: sign in at ${SITE_URL}/login as ${target.email} with password ${INVITE_PASSWORD}, then open ${SITE_URL}/employee/activate`);
    return send(ctx, 200, { invited: true, email: target.email, employee_id: employeeId });
  }

  if (name === "hr-revoke-exit-access") {
    const exitId = String(body.exit_id ?? "");
    if (!UUID_RE.test(exitId)) return send(ctx, 400, { error: "exit_id must be a UUID." });
    const chk = await rpcAs(a.role, a.claims, "hr_can_revoke_exit_access", { p_exit: exitId });
    if (chk.error) return send(ctx, 403, { error: chk.error.message?.trim() || "Not allowed to revoke access for this exit." });
    const target = chk.data || {};
    if (target.user_id) {
      await adminJson(`update auth.users set banned_until = now() + interval '876000 hours' where id = ${lit(target.user_id)}::uuid returning null;`);
      for (const [, v] of refreshTokens) if (v.userId === target.user_id) v.revoked = true;
    }
    const rec = await rpcAs("service_role", SERVICE, "hr_record_auth_access_revoked", { p_exit: exitId });
    if (rec.error) return send(ctx, 500, { error: rec.error.message?.trim() || "Account disabled, but recording it failed. Retry." });
    return send(ctx, 200, { revoked: true, exit_id: exitId, had_account: Boolean(target.user_id) });
  }

  if (name === "hr-email-dispatch") {
    if (a.role !== "service_role") {
      const me = await rpcAs(a.role, a.claims, "hr_me", {});
      if (me.error || !me.data || !(me.data.permissions || []).includes("settings.manage")) return send(ctx, 403, { error: "Not allowed." });
    }
    const q = await execAs("service_role", SERVICE, `select coalesce(jsonb_agg(jsonb_build_object('id', id, 'attempts', attempts) order by created_at), '[]'::jsonb)
      from (select id, attempts, created_at from public.hr_email_outbox where status = 'queued' order by created_at limit 25) x`);
    if (q.error) return send(ctx, 500, { error: q.error.message });
    let failed = 0;
    for (const row of q.data) {
      const claimed = await execAs("service_role", SERVICE, `with c as (update public.hr_email_outbox set status = 'sending', attempts = ${Number(row.attempts) + 1}
        where id = ${lit(row.id)}::uuid and status = 'queued' returning id) select count(*)::int from c`);
      if (claimed.error || !claimed.data) continue;
      const upd = await execAs("service_role", SERVICE, `with c as (update public.hr_email_outbox set status = 'failed', last_error = 'Local test harness: no email provider'
        where id = ${lit(row.id)}::uuid returning id) select count(*)::int from c`);
      if (!upd.error) failed++;
    }
    log(`[functions] hr-email-dispatch: ${q.data.length} queued row(s) marked failed (local harness never sends email)`);
    return send(ctx, 200, { processed: q.data.length, sent: 0, failed });
  }

  // Same contract as supabase/functions/hr-document-reminders (Module 9):
  // service role = scheduler (optional as_of), otherwise documents.manage = manual run.
  if (name === "hr-document-reminders") {
    const asOf = typeof body.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.as_of) ? body.as_of : null;
    if (a.role === "service_role") {
      const r = await rpcAs("service_role", SERVICE, "hr_run_document_reminders", { p_as_of: asOf, p_trigger: "scheduler" });
      if (r.error) return send(ctx, 500, { error: r.error.message?.trim() || "The reminder job failed." });
      log(`[functions] hr-document-reminders (scheduler): ${JSON.stringify(r.data)}`);
      return send(ctx, 200, r.data);
    }
    const me = await rpcAs(a.role, a.claims, "hr_me", {});
    if (me.error || !me.data || !(me.data.permissions || []).includes("documents.manage")) return send(ctx, 403, { error: "Not allowed." });
    const r = await rpcAs(a.role, a.claims, "hr_run_document_reminders", { p_as_of: null, p_trigger: "manual" });
    if (r.error) return send(ctx, 400, { error: r.error.message?.trim() || "The reminder job failed." });
    return send(ctx, 200, r.data);
  }
}

// ------------------------------------------------------------------ server
const server = http.createServer(async (req, res) => {
  const t0 = process.hrtime.bigint();
  let url;
  try { url = new URL(req.url, `http://127.0.0.1:${API_PORT}`); } catch { res.writeHead(400); return res.end(); }
  const ctx = { req, res, url, role: "-", status: 0 };
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    log(`${req.method} ${url.pathname}${url.search ? "?…" : ""} role=${ctx.role} ${ctx.status || res.statusCode} ${ms.toFixed(0)}ms`);
  });
  try {
    if (req.method === "OPTIONS") {
      ctx.role = "preflight";
      return send(ctx, ORIGINS.has(req.headers.origin) ? 204 : 403, null);
    }
    const p = url.pathname;
    if (p === "/health") return send(ctx, 200, { ok: true, harness: "zyllo-hrms-local (TEST ONLY)" });
    if (p.startsWith("/rest/v1")) return await handleRest(ctx, p.slice("/rest/v1".length) || "/");
    if (p.startsWith("/auth/v1")) return await handleAuth(ctx, p.slice("/auth/v1".length) || "/");
    if (p.startsWith("/storage/v1")) return await handleStorage(ctx, p.slice("/storage/v1".length) || "/");
    if (p.startsWith("/functions/v1/")) return await handleFunctions(ctx, p.slice("/functions/v1/".length));
    return send(ctx, 404, { message: "Not found (hrms-local)" });
  } catch (e) {
    log(`ERROR ${req.method} ${url.pathname}: ${e.stack || e.message}`);
    if (!res.headersSent) send(ctx, 500, { code: "HRMSLOCAL500", message: `Local harness error: ${e.message}`, details: null, hint: null });
    else try { res.end(); } catch {}
  }
});

server.listen(API_PORT, "127.0.0.1", () => log(`hrms-local API listening on http://127.0.0.1:${API_PORT} (allowed origins: ${[...ORIGINS].join(", ")})`));
const shutdown = () => { pool.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

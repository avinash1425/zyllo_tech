#!/usr/bin/env node
// LOCAL TEST HARNESS ONLY — a stand-in for the subset of Supabase that the
// Zyllo website admin (Project Tracker) uses, backed by a throwaway local
// PostgreSQL cluster. Adapted from scripts/hrms-local/api-server.mjs (HRMS
// branch): passwords are verified in Node (scrypt) instead of pgcrypto, and
// there are no Edge Function stand-ins (Project Tracker uses none).
//   /rest/v1      PostgREST-compatible tables, views and RPCs (subset)
//   /auth/v1      GoTrue-compatible password sign-in, refresh, user, logout
//   /storage/v1   Storage-compatible upload / signed URLs / delete (RLS enforced)
//   /functions/v1 local stand-ins for hr-invite-employee, hr-revoke-exit-access,
//                 hr-email-dispatch (same contracts; no email is ever sent)
// Every user-scoped statement runs through pt_harness.exec() as the API role
// (anon / authenticated / service_role) with request.jwt.claims set, over a
// connection made as `authenticator` — so RLS and auth.uid() behave as on
// Supabase. Listens on 127.0.0.1 only. Started by start.mjs, which passes the
// per-run JWT secret through this process's environment.
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { API_LOG_FILE, PG_USER, hashPassword, lit, makePsql, signJwt, verifyJwt, verifyPassword } from "./lib.mjs";
import { ApiError, CATALOG_SQL, QueryBuilder, buildCatalog, pgStatus } from "./postgrest.mjs";

// ------------------------------------------------------------------ config
const env = process.env;
const SECRET = env.PT_LOCAL_JWT_SECRET;
const PG_PORT = Number(env.PT_LOCAL_PG_PORT);
const PG_BIN_DIR = env.PT_LOCAL_PG_BIN || "C:\\Program Files\\PostgreSQL\\17\\bin";
const API_PORT = Number(env.PT_LOCAL_API_PORT || 54321);
const STORAGE_DIR = env.PT_LOCAL_STORAGE_DIR;
const ORIGINS = new Set((env.PT_LOCAL_ORIGINS || "http://127.0.0.1:8090,http://localhost:8090").split(",").map((s) => s.trim()).filter(Boolean));
if (!SECRET || SECRET.length < 32 || !PG_PORT || !STORAGE_DIR) {
  console.error("api-server: PT_LOCAL_JWT_SECRET, PT_LOCAL_PG_PORT and PT_LOCAL_STORAGE_DIR are required (use start.mjs).");
  process.exit(2);
}
const ACCESS_TTL = 3600;

// ------------------------------------------------------------------ optional external sign-in ("--auth-upstream")
// Authentication only: password sign-in, refresh, /user and sign-out for accounts WITHOUT a local
// synthetic password are forwarded to an external Supabase Auth project. Its tokens are verified
// here with the project's PUBLIC ES256 key (JWKS) — or, for legacy HS256 tokens, online by that
// project's /auth/v1/user — never with a shared secret. Admin rights come from that project's own
// rpc/is_admin, called with the user's token at every sign-in and refresh. Sign-up, password reset
// and password change are never forwarded. Passwords are passed through in memory only (never
// stored or logged). All Project Tracker data stays in this local database.
const UP = env.PT_LOCAL_UPSTREAM_URL ? {
  url: env.PT_LOCAL_UPSTREAM_URL.replace(/\/+$/, ""), key: env.PT_LOCAL_UPSTREAM_KEY, name: env.PT_LOCAL_UPSTREAM_NAME || "upstream",
} : null;
if (UP) UP.iss = UP.url + "/auth/v1";
let upstreamKeys = new Map();
async function loadUpstreamKeys() {
  const r = await fetch(UP.url + "/auth/v1/.well-known/jwks.json", { headers: { apikey: UP.key } });
  const j = await r.json();
  upstreamKeys = new Map((j.keys || []).filter((k) => k.kty === "EC" && (k.alg || "ES256") === "ES256" && k.kid)
    .map((k) => [k.kid, createPublicKey({ key: { kty: k.kty, crv: k.crv, x: k.x, y: k.y }, format: "jwk" })]));
  return upstreamKeys;
}
const onlineVerified = new Map(); // sha256(token) -> { claims, until }
async function verifyUpstreamToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw Object.assign(new Error("JWT is malformed"), { code: "invalid" });
  let header, claims;
  try { header = JSON.parse(Buffer.from(parts[0], "base64url").toString()); claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()); }
  catch { throw Object.assign(new Error("JWT is malformed"), { code: "invalid" }); }
  if (claims.iss !== UP.iss) throw Object.assign(new Error("JWT issuer is not trusted"), { code: "invalid" });
  if (header.alg === "ES256") {
    let key = upstreamKeys.get(header.kid);
    if (!key) key = (await loadUpstreamKeys()).get(header.kid);
    if (!key || !cryptoVerify("sha256", Buffer.from(parts[0] + "." + parts[1]), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"))) {
      throw Object.assign(new Error("JWT signature is invalid"), { code: "invalid" });
    }
  } else if (header.alg === "HS256") {
    const h = createHash("sha256").update(token).digest("hex");
    const c = onlineVerified.get(h);
    if (!c || c.until < Date.now()) {
      const r = await fetch(UP.url + "/auth/v1/user", { headers: { apikey: UP.key, Authorization: "Bearer " + token } });
      if (r.status !== 200) throw Object.assign(new Error("JWT rejected by the issuing project"), { code: "invalid" });
      onlineVerified.set(h, { until: Date.now() + 60000 });
    }
  } else {
    throw Object.assign(new Error("JWT algorithm not allowed"), { code: "invalid" });
  }
  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) throw Object.assign(new Error("JWT expired"), { code: "expired" });
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.role !== "authenticated" || !aud.includes("authenticated") || !claims.sub) throw Object.assign(new Error("JWT claims not allowed"), { code: "invalid" });
  return claims;
}
/** After an upstream sign-in/refresh: verify the token, ask the upstream project's own is_admin(), record the result locally. */
async function syncUpstreamIdentity(sessionBody) {
  const claims = await verifyUpstreamToken(sessionBody.access_token);
  let isAdmin = false, status = 0;
  try {
    const r = await fetch(UP.url + "/rest/v1/rpc/is_admin", {
      method: "POST", headers: { apikey: UP.key, Authorization: "Bearer " + sessionBody.access_token, "Content-Type": "application/json" }, body: "{}",
    });
    status = r.status;
    isAdmin = r.status === 200 && (await r.json()) === true;
  } catch { status = -1; }
  await adminJson("select pt_harness.record_upstream_identity(" + lit(claims.sub) + "::uuid, " + lit(String(claims.email || "")) + ", " + lit(UP.name) + ", " + (isAdmin ? "true" : "false") + ", " + status + ");");
  log("[auth] " + UP.name + " sign-in verified (" + (sessionBody.access_token.split(".")[0] && JSON.parse(Buffer.from(sessionBody.access_token.split(".")[0], "base64url").toString()).alg) + ") for user " + claims.sub + ": upstream is_admin=" + isAdmin + " (HTTP " + status + ")");
  return claims;
}
async function forwardUpstream(ctx, method, pathWithQuery, { body = null, bearer = null } = {}) {
  const headers = { apikey: UP.key };
  if (body !== null) headers["Content-Type"] = "application/json";
  if (bearer) headers.Authorization = "Bearer " + bearer;
  const r = await fetch(UP.url + pathWithQuery, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { msg: "Unexpected response from the external sign-in service" }; }
  return { status: r.status, json };
}
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
// line: `select pt_harness.exec(...);` followed by a marker query; output is
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
      const marker = `__PT_LOCAL_${randomBytes(6).toString("hex")}__`;
      const timer = setTimeout(() => { this.pending = null; try { this.proc.kill(); } catch { /* ignore: best-effort */ } reject(new Error("database statement timed out")); }, timeoutMs);
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
  close() { for (const w of this.workers) try { w.proc.kill(); } catch { /* ignore: best-effort */ } }
}

const pool = new Pool("authenticator", 8);
const adminPsql = makePsql({ bin, port: PG_PORT, user: PG_USER });
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

/** Run one generated statement as an API role. Resolves { data } or { error }. */
async function execAs(role, claims, sql) {
  const line = `select pt_harness.exec(${lit(role)}, convert_from(decode('${b64(claims ? JSON.stringify(claims) : "")}', 'base64'), 'UTF8'), convert_from(decode('${b64(sql)}', 'base64'), 'UTF8'));`;
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
async function authenticate(req) {
  const authz = req.headers.authorization || "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : null;
  const token = bearer || (req.headers.apikey ? String(req.headers.apikey) : null);
  if (!token) return { error: { status: 401, body: { message: "No API key found in request", hint: "No `apikey` request header or url param was found." } } };
  try {
    let claims;
    try {
      claims = verifyJwt(token, SECRET);
    } catch (e) {
      if (!UP) throw e;
      let iss = null;
      try { iss = JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString()).iss; } catch { /* not a JWT */ }
      if (iss !== UP.iss) throw e;
      claims = { ...(await verifyUpstreamToken(token)), pt_upstream: UP.name };
    }
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
async function issueSession(u, existingSessionId = null, authTime = null) {
  const now = Math.floor(Date.now() / 1000);
  const authAt = authTime || now; // GoTrue keeps the original sign-in time in amr across refreshes
  const sessionId = existingSessionId || randomUUID();
  if (!existingSessionId) {
    await adminJson(`insert into auth.sessions (id, user_id) values (${lit(sessionId)}::uuid, ${lit(u.id)}::uuid) returning null;`);
  }
  const access = signJwt({
    iss: `http://127.0.0.1:${API_PORT}/auth/v1`, sub: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    exp: now + ACCESS_TTL, iat: now, session_id: sessionId, aal: "aal1", amr: [{ method: "password", timestamp: authAt }],
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data || {}, is_anonymous: false,
  }, SECRET);
  const refresh = randomBytes(24).toString("base64url");
  refreshTokens.set(refresh, { userId: u.id, sessionId, authAt, createdAt: Date.now(), revoked: false });
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
  if (sub === "/health") return send(ctx, 200, { name: "GoTrue (pt-local stand-in)", description: "LOCAL TEST HARNESS" });
  if (sub === "/token" && req.method === "POST") {
    const body = await jsonBody(ctx);
    if (body === undefined) return;
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      ctx.role = "anon";
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      if (!email || !password) return authError(ctx, 400, "validation_failed", "missing email or phone", "invalid_request");
      const row = await adminJson(`select jsonb_build_object('hash', p.password_hash,
          'banned', coalesce(u.banned_until > now(), false), 'user', to_jsonb(u))
        from auth.users u left join pt_harness.passwords p on p.user_id = u.id where lower(u.email) = lower(${lit(email)});`);
      if (UP && !row?.hash) {
        // No local synthetic password for this email → external sign-in (password forwarded in memory, never stored or logged).
        const r = await forwardUpstream(ctx, "POST", "/auth/v1/token?grant_type=password", { body: { email, password } });
        if (r.status === 200 && r.json?.access_token) {
          try { await syncUpstreamIdentity(r.json); } catch (e) {
            log("[auth] upstream token failed local verification: " + e.message);
            return authError(ctx, 502, "upstream_token_invalid", "The external sign-in returned a token that could not be verified.");
          }
          ctx.role = "authenticated";
        }
        return send(ctx, r.status, r.json);
      }
      if (!row || !verifyPassword(password, row.hash)) return authError(ctx, 400, "invalid_credentials", "Invalid login credentials", "invalid_grant");
      if (row.banned) return authError(ctx, 400, "user_banned", "User is banned", "invalid_grant");
      ctx.role = "authenticated";
      return send(ctx, 200, await issueSession(row.user));
    }
    if (grant === "refresh_token") {
      const rt = refreshTokens.get(String(body.refresh_token || ""));
      if (!rt && UP) {
        const r = await forwardUpstream(ctx, "POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: String(body.refresh_token || "") } });
        if (r.status === 200 && r.json?.access_token) {
          try { await syncUpstreamIdentity(r.json); } catch { return authError(ctx, 502, "upstream_token_invalid", "The external sign-in returned a token that could not be verified."); }
          ctx.role = "authenticated";
        }
        return send(ctx, r.status, r.json);
      }
      if (!rt || rt.revoked) return authError(ctx, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found", "invalid_grant");
      const u = await adminJson(`select jsonb_build_object('banned', coalesce(u.banned_until > now(), false), 'user', to_jsonb(u)) from auth.users u where u.id = ${lit(rt.userId)}::uuid;`);
      if (!u) return authError(ctx, 400, "user_not_found", "User not found", "invalid_grant");
      if (u.banned) return authError(ctx, 400, "user_banned", "User is banned", "invalid_grant");
      // A deleted session (sign-out, revocation) invalidates its refresh tokens, as in GoTrue.
      const live = await adminJson(`select to_jsonb(exists (select 1 from auth.sessions where id = ${lit(rt.sessionId)}::uuid));`);
      if (!live) { rt.revoked = true; return authError(ctx, 400, "session_not_found", "Session from session_id claim in JWT does not exist", "invalid_grant"); }
      rt.revoked = true;
      ctx.role = "authenticated";
      return send(ctx, 200, await issueSession(u.user, rt.sessionId, rt.authAt));
    }
    return authError(ctx, 400, "validation_failed", "unsupported_grant_type", "unsupported_grant_type");
  }
  if (sub === "/signup" && req.method === "POST") return authError(ctx, 422, "signup_disabled", "Signups not allowed for this instance");
  if ((sub === "/recover" || sub === "/otp" || sub === "/magiclink") && req.method === "POST") {
    log("[auth] password recovery / OTP requested — the local harness sends no email");
    return send(ctx, 200, {});
  }

  // Endpoints that need a user token
  const a = await authenticate(req);
  if (a.error) return send(ctx, 401, { code: 401, error_code: "no_authorization", msg: "This endpoint requires a valid Bearer token" });
  ctx.role = a.role;
  if (a.role !== "authenticated" || !a.claims.sub) return send(ctx, 403, { code: 403, error_code: "bad_jwt", msg: "invalid claim: missing sub claim" });
  if (a.claims.pt_upstream) {
    // External account: only read the user and sign out; never change its password or email here.
    if (sub === "/user" && req.method === "GET") { const r = await forwardUpstream(ctx, "GET", "/auth/v1/user", { bearer: a.token }); return send(ctx, r.status, r.json); }
    if (sub === "/logout" && req.method === "POST") {
      const r = await forwardUpstream(ctx, "POST", "/auth/v1/logout?scope=" + encodeURIComponent(url.searchParams.get("scope") || "local"), { bearer: a.token });
      return send(ctx, r.status === 204 ? 204 : r.status, r.status === 204 ? null : r.json);
    }
    if (sub === "/user" && req.method === "PUT") return send(ctx, 422, { code: 422, error_code: "external_account", msg: "This account belongs to the " + UP.name + " Supabase project. Change its password or email there, not in the local harness." });
    return send(ctx, 404, { code: 404, error_code: "not_found", msg: "Not available for external accounts in the local harness" });
  }
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
      await adminJson(`insert into pt_harness.passwords (user_id, password_hash) values (${lit(u.id)}::uuid, ${lit(hashPassword(body.password))})
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
  const a = await authenticate(req);
  if (a.error) return send(ctx, a.error.status, a.error.body);
  ctx.role = a.role;
  const claims = { ...a.claims };
  if (!profileOk(ctx)) return;
  if (sub === "/" || sub === "") return send(ctx, 200, { info: "pt-local PostgREST stand-in", tables: [...catalog.relations.keys()].length });
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

  const a = await authenticate(req);
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
    try { raw = await readBody(req, limit + 64 * 1024); } catch {
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
      try { unlinkSync(tmp); } catch { /* ignore: best-effort */ }
      if (r.error?.code === "23505") return storageErr(ctx, 409, 409, "Duplicate", "The resource already exists");
      if (r.error?.code === "42501") return storageErr(ctx, 403, 403, "Unauthorized", "new row violates row-level security policy");
      if (!r.error) return storageErr(ctx, 400, 404, "not_found", "Object not found");
      return storageErr(ctx, 400, 400, "DatabaseError", r.error.message);
    }
    try { renameSync(tmp, op.file); } catch {
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
      if (op) try { unlinkSync(op.file); } catch { /* ignore: best-effort */ }
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


async function handleFunctions(ctx) {
  // Project Tracker calls no Edge Functions.
  return send(ctx, 404, { code: "NOT_FOUND", message: "Requested function was not found (pt-local has no Edge Function stand-ins)" });
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
    if (p === "/health") return send(ctx, 200, { ok: true, harness: "zyllo-pt-local (TEST ONLY)" });
    if (p.startsWith("/rest/v1")) return await handleRest(ctx, p.slice("/rest/v1".length) || "/");
    if (p.startsWith("/auth/v1")) return await handleAuth(ctx, p.slice("/auth/v1".length) || "/");
    if (p.startsWith("/storage/v1")) return await handleStorage(ctx, p.slice("/storage/v1".length) || "/");
    if (p.startsWith("/functions/v1/")) return await handleFunctions(ctx, p.slice("/functions/v1/".length));
    return send(ctx, 404, { message: "Not found (pt-local)" });
  } catch (e) {
    log(`ERROR ${req.method} ${url.pathname}: ${e.stack || e.message}`);
    if (!res.headersSent) send(ctx, 500, { code: "PTLOCAL500", message: `Local harness error: ${e.message}`, details: null, hint: null });
    else try { res.end(); } catch { /* ignore: best-effort */ }
  }
});

server.listen(API_PORT, "127.0.0.1", () => log(`pt-local API listening on http://127.0.0.1:${API_PORT} (allowed origins: ${[...ORIGINS].join(", ")})`));
const shutdown = () => { pool.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

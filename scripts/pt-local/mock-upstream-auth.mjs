#!/usr/bin/env node
// LOCAL TEST ONLY — a MOCK of an external Supabase Auth project, used to test the
// "--auth-upstream" mode of the harness without touching any real project.
// Issues ES256 tokens (like Supabase's asymmetric JWT signing keys), publishes the
// public key at /auth/v1/.well-known/jwks.json, and answers rpc/is_admin with the
// mock's own admin list. Synthetic users only:
//   ext.admin@upstream.test  (admin)      ext.user@upstream.test  (not an admin)
// password for both: Upstream-Mock-2026!
//
//   PT_MOCK_UPSTREAM_PORT=54340 node scripts/pt-local/mock-upstream-auth.mjs
import http from "node:http";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from "node:crypto";

const PORT = Number(process.env.PT_MOCK_UPSTREAM_PORT || 54340);
const BASE = `http://127.0.0.1:${PORT}`;
const ISS = `${BASE}/auth/v1`;
const KEY = "sb_publishable_mock_upstream_local_only";
const PASSWORD = "Upstream-Mock-2026!";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KID = randomBytes(8).toString("hex");
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "ES256", use: "sig", key_ops: ["verify"] };
const idFor = (email) => { const h = createHash("sha256").update("mock-upstream:" + email).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const USERS = new Map([["ext.admin@upstream.test", { admin: true }], ["ext.user@upstream.test", { admin: false }]]
  .map(([email, u]) => [email, { ...u, email, id: idFor(email) }]));
const refresh = new Map();
const calls = [];

const b64u = (b) => Buffer.from(b).toString("base64url");
function token(u, authAt) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }));
  const p = b64u(JSON.stringify({ iss: ISS, sub: u.id, aud: "authenticated", role: "authenticated", email: u.email, exp: now + 3600, iat: now,
    session_id: randomUUID(), aal: "aal1", amr: [{ method: "password", timestamp: authAt }], app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, is_anonymous: false }));
  const sig = sign("sha256", Buffer.from(`${h}.${p}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${b64u(sig)}`;
}
function session(u, authAt = Math.floor(Date.now() / 1000)) {
  const rt = randomBytes(24).toString("base64url");
  refresh.set(rt, { email: u.email, authAt });
  const now = Math.floor(Date.now() / 1000);
  return { access_token: token(u, authAt), token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: rt,
    user: { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {} } };
}
function userFromBearer(req) {
  const t = String(req.headers.authorization || "").replace(/^Bearer /i, "");
  const [h, p, s] = t.split(".");
  if (!s) return null;
  if (!verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))) return null;
  const c = JSON.parse(Buffer.from(p, "base64url").toString());
  if (c.exp < Date.now() / 1000) return null;
  return [...USERS.values()].find((u) => u.id === c.sub) || null;
}
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); });
const send = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(obj === null ? "" : JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  calls.push(`${req.method} ${url.pathname}${url.searchParams.get("grant_type") ? "?grant_type=" + url.searchParams.get("grant_type") : ""}`);
  if (url.pathname === "/__calls") return send(res, 200, calls);
  if (req.headers.apikey !== KEY) return send(res, 401, { message: "Invalid API key" });
  if (url.pathname === "/auth/v1/.well-known/jwks.json") return send(res, 200, { keys: [jwk] });
  if (url.pathname === "/auth/v1/token" && req.method === "POST") {
    const b = await body(req);
    const g = url.searchParams.get("grant_type");
    if (g === "password") {
      const u = USERS.get(String(b.email || "").toLowerCase());
      if (!u || b.password !== PASSWORD) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(res, 200, session(u));
    }
    if (g === "refresh_token") {
      const r = refresh.get(String(b.refresh_token || ""));
      if (!r) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
      refresh.delete(String(b.refresh_token));
      return send(res, 200, session(USERS.get(r.email), r.authAt));
    }
    return send(res, 400, { msg: "unsupported_grant_type" });
  }
  if (url.pathname === "/auth/v1/user" && req.method === "GET") {
    const u = userFromBearer(req);
    return u ? send(res, 200, { id: u.id, email: u.email, aud: "authenticated", role: "authenticated" }) : send(res, 401, { msg: "invalid JWT" });
  }
  if (url.pathname === "/auth/v1/logout" && req.method === "POST") return userFromBearer(req) ? send(res, 204, null) : send(res, 401, { msg: "invalid JWT" });
  if (url.pathname === "/rest/v1/rpc/is_admin" && req.method === "POST") {
    const u = userFromBearer(req);
    return u ? send(res, 200, u.admin) : send(res, 401, { code: "PGRST301", message: "JWT invalid" });
  }
  return send(res, 404, { msg: "not part of the mock" });
}).listen(PORT, "127.0.0.1", () => console.log(`[mock-upstream] MOCK external Supabase Auth on ${BASE} (synthetic users only)`));

// LOCAL TEST HARNESS ONLY — shared helpers for scripts/pt-local/*.
// Adapted from scripts/hrms-local/lib.mjs (HRMS branch).
// Never imported by anything under src/, never part of a Vite build.
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HARNESS_DIR, "..", "..");
// PT_LOCAL_INSTANCE lets several harnesses run side by side (parallel
// sessions): each gets its own state + log file. Default is unchanged.
const INSTANCE = /^[a-z0-9-]{1,20}$/i.test(process.env.PT_LOCAL_INSTANCE ?? "") ? `-${process.env.PT_LOCAL_INSTANCE}` : "";
export const STATE_FILE = path.join(tmpdir(), `zyllo-pt-local${INSTANCE}.json`);
export const INSTANCE_NAME = INSTANCE ? INSTANCE.slice(1) : "default";

let RESOLVED_STATE_FILE = null;

// Default output folder for a script's results/screenshots, kept separate per
// harness instance: "<tmp>/<name>-<instance>" (instance taken from the state
// file resolved below, else PT_LOCAL_INSTANCE). The default instance keeps
// the original "<tmp>/<name>". An explicit --out/--shots still wins.
export function outputDir(name) {
  const fromState = RESOLVED_STATE_FILE && /zyllo-pt-local-([a-z0-9-]{1,20})\.json$/i.exec(path.basename(RESOLVED_STATE_FILE));
  const instance = fromState ? fromState[1] : INSTANCE ? INSTANCE_NAME : null;
  return path.join(tmpdir(), instance ? `${name}-${instance}` : name);
}

// Which harness a test script drives. An explicit `--state <file>` wins;
// otherwise this process's PT_LOCAL_INSTANCE (STATE_FILE above). When both
// are given and disagree the script refuses to run, so it can never silently
// drive another session's harness and database. Prints the target once.
export function resolveStateFile(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--state");
  const explicit = i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : null;
  if (explicit && INSTANCE && explicit !== path.resolve(STATE_FILE)) {
    console.error(`REFUSING: PT_LOCAL_INSTANCE=${INSTANCE_NAME} selects ${STATE_FILE}, but --state is ${explicit}. Drop one or make them match.`);
    process.exit(2);
  }
  const file = explicit ?? STATE_FILE;
  RESOLVED_STATE_FILE = file;
  let ports = "no state file";
  try { const s = JSON.parse(readFileSync(file, "utf8")); ports = `web ${s.webPort}, api ${s.apiPort}, pg ${s.pgPort}`; } catch { /* reported by caller */ }
  console.log(`[pt-local] target harness: ${explicit ? "--state" : `instance "${INSTANCE_NAME}"`} ${file} (${ports})`);
  return file;
}

// The resolved harness state, or null when there is none (scripts that also
// accept an explicit --base use it only for their defaults).
export function readHarnessState(file = resolveStateFile()) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}
export const API_LOG_FILE = path.join(tmpdir(), `zyllo-pt-local${INSTANCE}-api.log`);
export const PG_USER = "pt_local";
export const TEST_PASSWORD = "Local-Test-Only-2026!";
export const INVITE_PASSWORD = "Local-Invite-Only-2026!";

export function findPgBin() {
  const candidates = [process.env.PG_BIN, "C:\\Program Files\\PostgreSQL\\17\\bin", "/usr/lib/postgresql/17/bin", "/usr/local/bin", "/usr/bin"].filter(Boolean);
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of candidates) if (existsSync(path.join(dir, `initdb${exe}`))) return (name) => path.join(dir, `${name}${exe}`);
  throw new Error("PostgreSQL binaries not found. Set PG_BIN to the directory containing initdb/postgres/psql.");
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** Resolves true when nothing is listening on 127.0.0.1:port. */
export function portIsFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.unref();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ JWT (HS256)
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function signJwt(payload, secret) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

/** Returns the payload, or throws Error with .code ("invalid" | "expired"). */
export function verifyJwt(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw Object.assign(new Error("JWT is malformed"), { code: "invalid" });
  let header;
  try { header = JSON.parse(fromB64url(parts[0]).toString("utf8")); } catch { throw Object.assign(new Error("JWT is malformed"), { code: "invalid" }); }
  if (header.alg !== "HS256") throw Object.assign(new Error("JWT algorithm not allowed"), { code: "invalid" });
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = fromB64url(parts[2]);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw Object.assign(new Error("JWT signature is invalid"), { code: "invalid" });
  let payload;
  try { payload = JSON.parse(fromB64url(parts[1]).toString("utf8")); } catch { throw Object.assign(new Error("JWT is malformed"), { code: "invalid" }); }
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) throw Object.assign(new Error("JWT expired"), { code: "expired" });
  return payload;
}

// ------------------------------------------------------------------ SQL quoting
export function lit(value) {
  if (value === null || value === undefined) return "NULL";
  const s = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (s.includes("\u0000")) throw Object.assign(new Error("NUL bytes are not allowed in values"), { status: 400, pg: { code: "22021", message: "invalid byte sequence: NUL bytes are not allowed" } });
  // standard_conforming_strings is on (PostgreSQL default): only ' needs doubling.
  return `'${s.replace(/'/g, "''")}'`;
}
export const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

// ------------------------------------------------------------------ psql runner
/**
 * Runs SQL through a fresh `psql` process (stdin, -X -q -t -A, ON_ERROR_STOP=1).
 * Resolves { ok, stdout, stderr, status }.
 */
export function makePsql({ bin, port, user = PG_USER, db = "postgres" }) {
  return function psql(sql, { timeoutMs = 60000 } = {}) {
    return new Promise((resolve) => {
      const child = spawn(bin("psql"), ["-h", "127.0.0.1", "-p", String(port), "-U", user, "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
        env: { ...process.env, PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c client_min_messages=warning", PGCONNECT_TIMEOUT: "10" },
        windowsHide: true,
      });
      const out = [], err = [];
      const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore: best-effort */ } }, timeoutMs);
      child.stdout.on("data", (d) => out.push(d));
      child.stderr.on("data", (d) => err.push(d));
      child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, stdout: "", stderr: String(e.message), status: -1 }); });
      child.on("close", (status) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(out).toString("utf8");
        const stderr = Buffer.concat(err).toString("utf8");
        resolve({ ok: status === 0, stdout, stderr, status });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(sql, "utf8");
    });
  };
}

/** Synchronous psql -f <file> (used while building the cluster). */
export function psqlFileSync({ bin, port, user = PG_USER, db = "postgres" }, file) {
  const r = spawnSync(bin("psql"), ["-h", "127.0.0.1", "-p", String(port), "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", file], {
    encoding: "utf8", maxBuffer: 1 << 26, windowsHide: true,
    env: { ...process.env, PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c client_min_messages=warning" },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

/** Kill a process tree (Windows: taskkill /T /F). */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(pid, "SIGTERM");
  } catch { /* already gone */ }
}

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

export function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key.startsWith("no") && key.length > 2 && !(key in defaults)) { out[key[2].toLowerCase() + key.slice(3)] = false; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

// ------------------------------------------------------------------ passwords
// Synthetic test passwords are hashed in Node (scrypt) — pgcrypto is not
// available on the dev PC (Smart App Control blocks contrib DLLs).
export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(String(password), salt, 32).toString("hex")}`;
}
export function verifyPassword(password, stored) {
  const m = /^scrypt\$([0-9a-f]+)\$([0-9a-f]+)$/.exec(String(stored || ""));
  if (!m) return false;
  const want = Buffer.from(m[2], "hex");
  const got = scryptSync(String(password), Buffer.from(m[1], "hex"), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

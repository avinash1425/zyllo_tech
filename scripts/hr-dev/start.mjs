#!/usr/bin/env node
// DEVELOPMENT ONLY — start the website + HRMS locally against the shared
// HR development Supabase project (whiclllqgxxqhufkduuo). Never production.
//
//   node scripts/hr-dev/start.mjs            start on http://127.0.0.1:8080
//   node scripts/hr-dev/start.mjs --check    validate the configuration only
//   options: --port <n>  --config <path>     (default: .env.hr-dev.local)
//
// Why this exists: the committed .env points at PRODUCTION (it is what
// Lovable publishes), so a plain `npm run dev` would sign in against the live
// site. This launcher reads .env.hr-dev.local, refuses anything that is not
// the HR development project, and passes ONLY browser-safe values to Vite as
// process environment (which overrides every .env file). After Vite starts it
// fetches the browser's env module back and stops if it is not HR dev.
//
// Never put a secret / service-role key or a database URL in a VITE_ variable:
// everything prefixed VITE_ is shipped to the browser. Secrets stay in
// Supabase (Edge Function runtime), never on this computer's frontend.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HR_DEV_REF = "whiclllqgxxqhufkduuo";
export const PRODUCTION_REF = "zfjeflpvwizlteflypsx";
const HR_DEV_URL = `https://${HR_DEV_REF}.supabase.co`;
// Origins the Edge Functions' default CORS list allows (supabase/functions/_shared/cors.ts).
const CORS_OK_PORTS = [8080, 3000];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

class ConfigError extends Error {}
const fail = (msg) => { throw new ConfigError(msg); };

/** Minimal dotenv parser (KEY=value, optional quotes, # comments). */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

function decodeJwtPayload(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); }
  catch { return null; }
}

/** "sb_publishable_ab…(46 chars)" — never prints a whole key. */
export const mask = (v) => (v ? `${v.slice(0, Math.min(16, Math.floor(v.length / 3)))}…(${v.length} chars)` : "(empty)");

/**
 * Validates the HR dev configuration. Returns the browser env to hand to Vite.
 * Throws ConfigError with a human message on anything unsafe or missing.
 */
export function validateConfig(cfg, { port = 8080 } = {}) {
  const missing = ["HR_DEV_PROJECT_REF", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"].filter((k) => !cfg[k]);
  if (missing.length) fail(`Missing in the env file: ${missing.join(", ")}.\n  Copy .env.hr-dev.example to .env.hr-dev.local and fill in the values you were given privately.`);

  const all = Object.entries(cfg).map(([k, v]) => `${k}=${v}`).join("\n");
  if (all.includes(PRODUCTION_REF)) fail(`The env file mentions the PRODUCTION project (${PRODUCTION_REF}). This launcher only runs against HR development (${HR_DEV_REF}).`);

  if (cfg.HR_DEV_PROJECT_REF !== HR_DEV_REF) fail(`HR_DEV_PROJECT_REF must be ${HR_DEV_REF} (got "${cfg.HR_DEV_PROJECT_REF}").`);

  let url;
  try { url = new URL(cfg.VITE_SUPABASE_URL); } catch { fail(`VITE_SUPABASE_URL is not a URL: "${cfg.VITE_SUPABASE_URL}".`); }
  if (url.protocol !== "https:" || url.hostname !== `${HR_DEV_REF}.supabase.co` || (url.pathname !== "/" && url.pathname !== "")) {
    fail(`VITE_SUPABASE_URL must be ${HR_DEV_URL} (got "${cfg.VITE_SUPABASE_URL}").`);
  }

  const key = cfg.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (/REPLACE|your[-_]|<|>|\.\.\./i.test(key)) fail("VITE_SUPABASE_PUBLISHABLE_KEY still holds the placeholder. Paste the publishable key you were given.");
  if (/^sb_secret_/i.test(key)) fail("VITE_SUPABASE_PUBLISHABLE_KEY is a SECRET key (sb_secret_…). Never put a secret key in the browser. Use the publishable key (sb_publishable_…) and delete the secret key from this file.");
  if (key.startsWith("eyJ")) {
    const p = decodeJwtPayload(key);
    if (!p) fail("VITE_SUPABASE_PUBLISHABLE_KEY looks like a JWT but cannot be read.");
    if (p.role !== "anon") fail(`VITE_SUPABASE_PUBLISHABLE_KEY is a "${p.role}" key. Only the anon/publishable key may be used in the browser.`);
    if (p.ref && p.ref !== HR_DEV_REF) fail(`VITE_SUPABASE_PUBLISHABLE_KEY belongs to project "${p.ref}", not HR development (${HR_DEV_REF}).`);
  } else if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)) {
    fail("VITE_SUPABASE_PUBLISHABLE_KEY must be the project's publishable key (starts with sb_publishable_).");
  }

  // Any other VITE_ value in this file reaches the browser: refuse secrets there.
  for (const [k, v] of Object.entries(cfg)) {
    if (!k.startsWith("VITE_") || k === "VITE_SUPABASE_PUBLISHABLE_KEY") continue;
    if (/^sb_secret_/i.test(v) || /postgres(ql)?:\/\//i.test(v) || decodeJwtPayload(v)?.role === "service_role") fail(`${k} holds a secret or database URL. VITE_ variables are shipped to the browser — remove it.`);
  }

  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail(`--port must be a number between 1024 and 65535 (got "${port}").`);

  return {
    VITE_SUPABASE_URL: HR_DEV_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: key,
    VITE_SUPABASE_PROJECT_ID: HR_DEV_REF,
    VITE_SITE_URL: `http://127.0.0.1:${port}`,
    VITE_GA_MEASUREMENT_ID: "",   // no analytics from development
    VITE_GA_LOCAL_TEST: "",
  };
}

function args(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  return { check: argv.includes("--check"), port: get("--port") ? Number(get("--port")) : 8080, envFile: get("--config") };
}

async function verifyServedEnv(port, child) {
  // Vite serves each module with import.meta.env inlined; read it back.
  const target = `http://127.0.0.1:${port}/src/lib/env.js`;
  for (let i = 0; i < 120 && child.exitCode === null; i++) {
    try {
      const r = await fetch(target);
      if (r.ok) {
        const code = await r.text();
        if (code.includes(PRODUCTION_REF) || !code.includes(HR_DEV_URL)) return "the browser configuration is NOT the HR development project";
        if (/sb_secret_|service_role/i.test(code)) return "a secret key reached the browser configuration";
        return null;
      }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return child.exitCode === null ? "Vite did not answer within 60 seconds" : `Vite exited (code ${child.exitCode})`;
}

async function main() {
  const opt = args(process.argv.slice(2));
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 19)) fail(`Node.js ${process.versions.node} is too old. Install Node.js 20.19+ (22 or 24 LTS recommended).`);

  const envFile = path.resolve(ROOT, opt.envFile ?? ".env.hr-dev.local");
  if (!existsSync(envFile)) fail(`Configuration file not found: ${envFile}\n  Copy .env.hr-dev.example to .env.hr-dev.local and fill in the values you were given privately.`);
  const browserEnv = validateConfig(parseEnv(readFileSync(envFile, "utf8")), { port: opt.port });

  console.log("[hr-dev] Supabase project : HR development", HR_DEV_REF);
  console.log("[hr-dev] Supabase URL     :", browserEnv.VITE_SUPABASE_URL);
  console.log("[hr-dev] Publishable key  :", mask(browserEnv.VITE_SUPABASE_PUBLISHABLE_KEY));
  console.log("[hr-dev] App URL          :", `http://127.0.0.1:${opt.port}/login`);
  if (!CORS_OK_PORTS.includes(opt.port)) console.log(`[hr-dev] WARNING: Edge Functions (Employee ID login management, Change password) only accept\n         http://127.0.0.1:8080 or :3000 by default. Port ${opt.port} works for everything else.`);
  if (opt.check) { console.log("[hr-dev] Configuration OK (--check: not starting)."); return; }

  const viteBin = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(viteBin)) fail("Dependencies are not installed. Run `npm ci` in the project folder first.");

  // Process environment beats every .env* file, so the committed production
  // .env cannot win. Inherit the rest of the environment, minus any VITE_*.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VITE_")));
  Object.assign(env, browserEnv);
  const child = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(opt.port), "--strictPort"], { cwd: ROOT, env, stdio: "inherit" });
  const stop = () => { if (child.exitCode === null) child.kill(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const problem = await verifyServedEnv(opt.port, child);
  if (problem) {
    console.error(`\n[hr-dev] STOPPED: ${problem}.`);
    stop();
    process.exitCode = 1;
    return;
  }
  console.log(`\n[hr-dev] Verified: the browser talks to HR development only. Open http://127.0.0.1:${opt.port}/login  (Ctrl+C to stop)`);
  child.on("exit", (code) => { process.exitCode = code ?? 0; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    if (e instanceof ConfigError) { console.error(`[hr-dev] REFUSING TO START: ${e.message}`); process.exit(2); }
    console.error("[hr-dev] Unexpected error:", e?.message ?? e);
    process.exit(1);
  });
}

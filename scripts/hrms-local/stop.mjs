#!/usr/bin/env node
// LOCAL TEST HARNESS ONLY — stops what start.mjs started (Vite on the test
// port, the API server, the throwaway PostgreSQL cluster) and deletes the
// cluster directory. Reads %TEMP%/zyllo-hrms-local.json. Never touches
// anything it did not start (e.g. the live-site dev server on :8080).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { STATE_FILE, killTree, pidAlive, portIsFree, sleep } from "./lib.mjs";

if (!existsSync(STATE_FILE)) {
  console.log(`[hrms-local] nothing to stop (no ${STATE_FILE}).`);
  process.exit(0);
}
let s;
try { s = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch (e) {
  console.error(`[hrms-local] unreadable state file ${STATE_FILE}: ${e.message}`);
  process.exit(1);
}
const root = path.resolve(String(s.root || ""));
const safeRoot = root.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(root).startsWith("zyllo-hrms-local-");
if (!safeRoot) { console.error(`[hrms-local] refusing to act on unexpected directory ${root}`); process.exit(1); }

// 1. web + API (children of the supervisor)
if (s.webPid) killTree(s.webPid);
if (s.apiPid) killTree(s.apiPid);
// 2. PostgreSQL: clean shutdown first
const pgCtl = path.join(s.pgBin || "C:\\Program Files\\PostgreSQL\\17\\bin", process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
if (s.dataDir && existsSync(s.dataDir)) spawnSync(pgCtl, ["-D", s.dataDir, "-m", "fast", "-w", "-t", "20", "stop"], { stdio: "ignore", windowsHide: true });
if (s.pgPid && pidAlive(s.pgPid)) killTree(s.pgPid);
// 3. the supervisor itself (start.mjs) if it is still alive
if (s.supervisorPid && s.supervisorPid !== process.pid && pidAlive(s.supervisorPid)) killTree(s.supervisorPid);

// 4. delete the cluster directory (retry while Windows releases handles)
for (let i = 0; i < 40 && existsSync(root); i++) {
  try { rmSync(root, { recursive: true, force: true }); } catch { await sleep(250); }
}
try { unlinkSync(STATE_FILE); } catch {}

const ports = [s.apiPort, s.webPort, s.pgPort].filter(Boolean);
const busy = [];
for (const p of ports) if (!(await portIsFree(p))) busy.push(p);
console.log(`[hrms-local] stopped. cluster dir ${existsSync(root) ? "STILL PRESENT: " + root : "deleted"}; ` +
  (busy.length ? `ports still busy: ${busy.join(", ")}` : `ports free: ${ports.join(", ")}`));
process.exit(existsSync(root) || busy.length ? 1 : 0);

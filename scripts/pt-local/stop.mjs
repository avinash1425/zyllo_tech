#!/usr/bin/env node
// LOCAL TEST HARNESS ONLY — stops a harness started by scripts/pt-local/start.mjs.
import { readFileSync, rmSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { STATE_FILE, killTree } from "./lib.mjs";

let s;
try { s = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { console.log(`[pt-local] no harness state at ${STATE_FILE}`); process.exit(0); }
for (const pid of [s.webPid, s.apiPid, s.mockPid]) if (pid) killTree(pid);
const exe = process.platform === "win32" ? ".exe" : "";
spawnSync(path.join(s.pgBin, `pg_ctl${exe}`), ["-D", s.dataDir, "-m", "fast", "-w", "-t", "20", "stop"], { stdio: "ignore", windowsHide: true });
killTree(s.supervisorPid);
try { rmSync(s.root, { recursive: true, force: true }); } catch { /* best effort */ }
try { unlinkSync(STATE_FILE); } catch { /* best effort */ }
console.log("[pt-local] stopped and cleaned up.");

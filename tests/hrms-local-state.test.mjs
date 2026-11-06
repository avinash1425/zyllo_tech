// Run with: npm test  (Node's built-in test runner, no extra dependencies)
// The local HRMS harness scripts must drive the harness the caller means:
// --state wins, otherwise HRMS_LOCAL_INSTANCE; a mismatch is refused. Uses
// its own uniquely named state files in the OS temp dir; never touches a real
// harness.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LIB = new URL("../scripts/hrms-local/lib.mjs", import.meta.url).href;
const DIR = new URL("../scripts/hrms-local/", import.meta.url);
const TAG = `unit${process.pid}`;
const fileFor = (instance) => path.join(tmpdir(), `zyllo-hrms-local${instance ? `-${instance}` : ""}.json`);

// Runs resolveStateFile()/readHarnessState() in a fresh process with the given env/args.
function resolve({ instance, args = [] } = {}) {
  const env = { ...process.env };
  delete env.HRMS_LOCAL_INSTANCE;
  if (instance) env.HRMS_LOCAL_INSTANCE = instance;
  // A real script file, so process.argv matches how the harness scripts are invoked.
  const probe = path.join(tmpdir(), `zyllo-hrms-state-probe-${TAG}.mjs`);
  writeFileSync(probe, `import(${JSON.stringify(LIB)}).then((m) => { const f = m.resolveStateFile(); const s = m.readHarnessState(f); console.log("RESULT " + JSON.stringify({ f, web: s?.webPort ?? null, outDir: m.outputDir("hrms-x") })); });\n`);
  try {
    const r = spawnSync(process.execPath, [probe, ...args], { env, encoding: "utf8" });
    const line = (r.stdout.match(/^RESULT (.*)$/m) || [])[1];
    return { status: r.status, out: r.stdout + r.stderr, ...(line ? JSON.parse(line) : {}) };
  } finally { rmSync(probe, { force: true }); }
}

test("HRMS_LOCAL_INSTANCE selects that instance's state file (and its ports)", () => {
  const f = fileFor(`${TAG}a`);
  writeFileSync(f, JSON.stringify({ webPort: 8601, apiPort: 54901, pgPort: 60001 }));
  try {
    const r = resolve({ instance: `${TAG}a` });
    assert.equal(r.status, 0, r.out);
    assert.equal(path.resolve(r.f), path.resolve(f));
    assert.equal(r.web, 8601);
    assert.match(r.out, new RegExp(`instance "${TAG}a"`));
    assert.match(r.out, /web 8601, api 54901, pg 60001/);
  } finally { rmSync(f, { force: true }); }
});

test("--state wins when no instance is set", () => {
  const f = fileFor(`${TAG}b`);
  writeFileSync(f, JSON.stringify({ webPort: 8602, apiPort: 54902, pgPort: 60002 }));
  try {
    const r = resolve({ args: ["--state", f] });
    assert.equal(r.status, 0, r.out);
    assert.equal(path.resolve(r.f), path.resolve(f));
    assert.equal(r.web, 8602);
  } finally { rmSync(f, { force: true }); }
});

test("instance + matching --state is accepted", () => {
  const f = fileFor(`${TAG}c`);
  writeFileSync(f, JSON.stringify({ webPort: 8603, apiPort: 54903, pgPort: 60003 }));
  try {
    const r = resolve({ instance: `${TAG}c`, args: ["--state", f] });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.web, 8603);
  } finally { rmSync(f, { force: true }); }
});

test("instance + a DIFFERENT --state is refused (never drives another harness)", () => {
  const r = resolve({ instance: `${TAG}d`, args: ["--state", fileFor("")] });
  assert.equal(r.status, 2);
  assert.match(r.out, /REFUSING/);
  assert.equal(r.f, undefined, "nothing resolved");
});

test("no instance and no --state keeps the default instance (unchanged behaviour)", () => {
  const r = resolve();
  assert.equal(r.status, 0, r.out);
  assert.equal(path.resolve(r.f), path.resolve(fileFor("")));
  assert.match(r.out, /instance "default"/);
});

test("no harness script hard-codes the default state file, 8090 or :54321 any more", () => {
  for (const name of readdirSync(DIR).filter((n) => n.endsWith(".mjs") && n !== "api-server.mjs")) {
    const src = readFileSync(new URL(name, DIR), "utf8");
    assert.doesNotMatch(src, /zyllo-hrms-local\.json"/, `${name}: hard-coded default state file`);
    assert.doesNotMatch(src, /"http:\/\/127\.0\.0\.1:8090"/, `${name}: hard-coded 8090`);
    assert.doesNotMatch(src, /includes\(":54321"\)/, `${name}: hard-coded API port`);
  }
});

test("results/screenshots default to a separate folder per harness instance", () => {
  const a = resolve({ instance: `${TAG}e` });
  const b = resolve({ instance: `${TAG}f` });
  assert.equal(a.outDir, path.join(tmpdir(), `hrms-x-${TAG}e`));
  assert.equal(b.outDir, path.join(tmpdir(), `hrms-x-${TAG}f`));
  assert.notEqual(a.outDir, b.outDir, "two instances never share an output folder");
  const f = fileFor(`${TAG}g`);
  writeFileSync(f, JSON.stringify({ webPort: 8607, apiPort: 54907, pgPort: 60007 }));
  try {
    assert.equal(resolve({ args: ["--state", f] }).outDir, path.join(tmpdir(), `hrms-x-${TAG}g`), "--state instance names the folder");
  } finally { rmSync(f, { force: true }); }
  assert.equal(resolve().outDir, path.join(tmpdir(), "hrms-x"), "default instance keeps the original folder");
});

test("no script writes its default results into a shared tmp folder", () => {
  for (const name of readdirSync(DIR).filter((n) => /^browser-.*\.mjs$/.test(n))) {
    const src = readFileSync(new URL(name, DIR), "utf8");
    assert.doesNotMatch(src, /arg\("--(out|shots)",\s*path\.join\(tmpdir\(\)/, `${name}: shared default output folder`);
  }
});

test("every flow script and the crawl resolve their harness through lib.mjs", () => {
  for (const name of readdirSync(DIR).filter((n) => /^browser-(flows|crawl).*\.mjs$/.test(n))) {
    const src = readFileSync(new URL(name, DIR), "utf8");
    assert.match(src, /resolveStateFile\(\)|readHarnessState\(\)/, name);
  }
});

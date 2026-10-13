// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  cooldownRemainingMs,
  INDEX_CHECK_COOLDOWN_MS,
  isSuccessfulCheck,
  loadLastRunAt,
  loadSavedCheck,
  recordRun,
  saveCheck,
} from "../src/lib/api/admin/indexCoverageCache.js";

function fakeStorage() {
  const items = new Map();
  return {
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => items.set(k, String(v)),
    items,
  };
}

const brokenStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("quota exceeded"); },
};

const result = (overrides = {}) => ({
  status: "ok",
  siteUrl: "https://zyllotech.com/",
  checkedAt: "2026-10-14T06:00:00.000Z",
  totals: { tracked: 3, indexed: 2, notIndexed: 1, errors: 0 },
  stoppedEarly: null,
  pages: [
    { url: "https://zyllotech.com/", verdict: "PASS", coverageState: "Submitted and indexed" },
    { url: "https://zyllotech.com/about", verdict: "PASS", coverageState: "Submitted and indexed" },
    { url: "https://zyllotech.com/blog", verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" },
  ],
  ...overrides,
});

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-10-14T06:00:00Z");

test("the cooldown is one hour", () => {
  assert.equal(INDEX_CHECK_COOLDOWN_MS, HOUR);
});

test("a complete result is successful, also with a few failed URLs", () => {
  assert.equal(isSuccessfulCheck(result()), true);
  assert.equal(isSuccessfulCheck(result({ totals: { tracked: 3, indexed: 1, notIndexed: 1, errors: 1 } })), true);
});

test("results that should not replace the saved one", () => {
  assert.equal(isSuccessfulCheck(result({ stoppedEarly: "quota" })), false);
  assert.equal(isSuccessfulCheck(result({ stoppedEarly: "auth" })), false);
  assert.equal(isSuccessfulCheck(result({ totals: { tracked: 3, indexed: 0, notIndexed: 0, errors: 3 } })), false);
  assert.equal(isSuccessfulCheck(result({ totals: { tracked: 0, indexed: 0, notIndexed: 0, errors: 0 }, pages: [] })), false);
  assert.equal(isSuccessfulCheck({ status: "not_connected", message: "x" }), false);
  // An older function answers with search performance data: no pages.
  assert.equal(isSuccessfulCheck({ status: "ok", totals: { clicks: 9 }, timeSeries: [] }), false);
  assert.equal(isSuccessfulCheck(null), false);
});

test("a saved result is returned on the next visit", () => {
  const storage = fakeStorage();
  assert.equal(loadSavedCheck(storage), null);
  assert.equal(saveCheck(result(), storage), true);
  assert.deepEqual(loadSavedCheck(storage), result());
});

test("a failed run does not overwrite the saved result", () => {
  const storage = fakeStorage();
  saveCheck(result(), storage);
  assert.equal(saveCheck(result({ stoppedEarly: "quota", checkedAt: "2026-10-15T06:00:00.000Z" }), storage), false);
  assert.equal(loadSavedCheck(storage).checkedAt, "2026-10-14T06:00:00.000Z");
});

test("corrupt or foreign stored data is ignored", () => {
  const storage = fakeStorage();
  storage.setItem("zyllo.gsc.indexCoverage.v1", "{not json");
  assert.equal(loadSavedCheck(storage), null);
  storage.setItem("zyllo.gsc.indexCoverage.v1", JSON.stringify({ status: "ok" }));
  assert.equal(loadSavedCheck(storage), null);
  storage.setItem("zyllo.gsc.indexCoverage.lastRunAt", "yesterday");
  assert.equal(loadLastRunAt(storage), null);
});

test("unavailable storage never throws", () => {
  assert.equal(loadSavedCheck(brokenStorage), null);
  assert.equal(saveCheck(result(), brokenStorage), false);
  assert.equal(loadLastRunAt(brokenStorage), null);
  assert.doesNotThrow(() => recordRun(T0, brokenStorage));
  assert.equal(loadSavedCheck(undefined), null);
  assert.equal(loadLastRunAt(null), null);
});

test("the last run time is remembered", () => {
  const storage = fakeStorage();
  assert.equal(loadLastRunAt(storage), null);
  recordRun(T0, storage);
  assert.equal(loadLastRunAt(storage), T0);
});

test("no run yet means no cooldown", () => {
  assert.equal(cooldownRemainingMs(null, T0), 0);
  assert.equal(cooldownRemainingMs(undefined, T0), 0);
});

test("cooldown counts down over one hour and then clears", () => {
  assert.equal(cooldownRemainingMs(T0, T0), HOUR);
  assert.equal(cooldownRemainingMs(T0, T0 + 20 * 60 * 1000), 40 * 60 * 1000);
  assert.equal(cooldownRemainingMs(T0, T0 + HOUR - 1), 1);
  assert.equal(cooldownRemainingMs(T0, T0 + HOUR), 0);
  assert.equal(cooldownRemainingMs(T0, T0 + 5 * HOUR), 0);
});

test("a run time in the future never locks for more than an hour", () => {
  assert.equal(cooldownRemainingMs(T0 + 10 * HOUR, T0), HOUR);
});

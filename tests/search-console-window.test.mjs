// Run with: npm test  (Node's built-in test runner, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  fillDays,
  latestCompleteDay,
  pacificDay,
  reportingWindow,
} from "../supabase/functions/search-console/window.ts";

const at = (isoTime) => new Date(isoTime);
const days = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

test("addDays crosses month, year and leap-day boundaries", () => {
  assert.equal(addDays("2026-10-01", -1), "2026-09-30");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09"); // US DST change
});

test("pacificDay follows Pacific time, not UTC", () => {
  assert.equal(pacificDay(at("2026-10-13T05:00:00Z")), "2026-10-12"); // 22:00 PDT
  assert.equal(pacificDay(at("2026-10-13T08:00:00Z")), "2026-10-13"); // 01:00 PDT
  assert.equal(pacificDay(at("2026-01-01T07:59:00Z")), "2025-12-31"); // 23:59 PST
});

test("the reported mismatch: window ends on 11 Oct, not on the day still being collected", () => {
  const now = at("2026-10-13T06:00:00Z");
  const published = days("2026-10-03", "2026-10-12");
  const latest = latestCompleteDay(published, "2026-10-12", now);
  assert.equal(latest, "2026-10-11");
  assert.deepEqual(reportingWindow(7, latest, now), { start: "2026-10-05", end: "2026-10-11" });
});

test("without metadata the current Pacific day is still excluded", () => {
  const now = at("2026-10-13T06:00:00Z"); // 12 Oct in Pacific time
  assert.equal(latestCompleteDay(days("2026-10-03", "2026-10-12"), undefined, now), "2026-10-11");
});

test("several incomplete days are all excluded", () => {
  const now = at("2026-10-13T20:00:00Z");
  assert.equal(latestCompleteDay(days("2026-10-03", "2026-10-13"), "2026-10-11", now), "2026-10-10");
});

test("metadata later than today, or malformed, falls back to the Pacific-day guard", () => {
  const now = at("2026-10-13T06:00:00Z");
  const published = days("2026-10-03", "2026-10-12");
  assert.equal(latestCompleteDay(published, "2026-10-20", now), "2026-10-11");
  assert.equal(latestCompleteDay(published, "not-a-date", now), "2026-10-11");
});

test("a missing day at the end does not become the window end", () => {
  const now = at("2026-10-13T20:00:00Z");
  const published = ["2026-10-07", "2026-10-08", "2026-10-10"]; // no rows for 9, 11, 12 Oct
  assert.equal(latestCompleteDay(published, undefined, now), "2026-10-10");
});

test("unsorted and blank date keys are handled", () => {
  const now = at("2026-10-13T20:00:00Z");
  assert.equal(latestCompleteDay(["2026-10-09", "", "2026-10-11", "2026-10-10"], undefined, now), "2026-10-11");
});

test("no usable published day falls back to a 3-day lag", () => {
  const now = at("2026-10-13T20:00:00Z");
  assert.equal(latestCompleteDay([], undefined, now), undefined);
  assert.equal(latestCompleteDay(["2026-10-13"], "2026-10-13", now), undefined);
  assert.deepEqual(reportingWindow(7, undefined, now), { start: "2026-10-04", end: "2026-10-10" });
});

test("every range is inclusive of both ends", () => {
  const now = at("2026-10-13T20:00:00Z");
  for (const n of [7, 28, 90, 365]) {
    const { start, end } = reportingWindow(n, "2026-10-11", now);
    assert.equal(end, "2026-10-11");
    assert.equal(days(start, end).length, n);
  }
  assert.equal(reportingWindow(28, "2026-10-11", now).start, "2026-09-14");
  assert.equal(reportingWindow(7, "2026-01-03", now).start, "2025-12-28");
});

test("fillDays gives days without impressions a zero row", () => {
  const rows = [
    { date: "2026-10-06", clicks: 1, impressions: 22 },
    { date: "2026-10-05", clicks: 0, impressions: 10 },
    { date: "2026-10-08", clicks: 2, impressions: 28 },
  ];
  assert.deepEqual(fillDays("2026-10-05", "2026-10-09", rows), [
    { date: "2026-10-05", clicks: 0, impressions: 10 },
    { date: "2026-10-06", clicks: 1, impressions: 22 },
    { date: "2026-10-07", clicks: 0, impressions: 0 },
    { date: "2026-10-08", clicks: 2, impressions: 28 },
    { date: "2026-10-09", clicks: 0, impressions: 0 },
  ]);
});

test("fillDays keeps totals unchanged and drops rows outside the window", () => {
  const rows = [
    { date: "2026-10-04", clicks: 5, impressions: 50 },
    { date: "2026-10-05", clicks: 1, impressions: 12 },
    { date: undefined, clicks: 9, impressions: 9 },
  ];
  const filled = fillDays("2026-10-05", "2026-10-11", rows);
  assert.equal(filled.length, 7);
  assert.equal(filled.reduce((n, r) => n + r.clicks, 0), 1);
  assert.equal(filled.reduce((n, r) => n + r.impressions, 0), 12);
});

test("fillDays on an empty window day range", () => {
  assert.deepEqual(fillDays("2026-10-05", "2026-10-05", []), [{ date: "2026-10-05", clicks: 0, impressions: 0 }]);
});

// Run with: npm test
// Training helpers (src/lib/hr/trainingRules.js): certificate expiry,
// status derivation / allowed transitions, seat capacity, dashboard counts,
// plus static checks on migration 207.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addMonths, allowedActions, assignedDate, certificateExpiry, certificateState, daysUntil, displayStatus, dueBeforeAssigned, dueInfo, effectiveDueDate, enrollmentOutcome,
  isOverdueOn, latestCompletions, seatInfo, sessionWhen, summarize,
} from "../src/lib/hr/trainingRules.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const T = "2026-11-07";

test("addMonths clamps to the month end like PostgreSQL", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-11-07", 12), "2027-11-07");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("bad", 1), null);
});

test("certificate expiry = completion + validity for passed / attended only", () => {
  assert.equal(certificateExpiry("2026-11-07", 24, "passed"), "2028-11-07");
  assert.equal(certificateExpiry("2026-11-07", 12, "attended"), "2027-11-07");
  assert.equal(certificateExpiry("2026-11-07", 12, "failed"), null);
  assert.equal(certificateExpiry("2026-11-07", null, "passed"), null);
  assert.equal(certificateExpiry("2026-11-07", "", "passed"), null);
  assert.equal(certificateExpiry(null, 12, "passed"), null);
});

test("daysUntil", () => {
  assert.equal(daysUntil("2026-11-17", T), 10);
  assert.equal(daysUntil("2026-11-01", T), -6);
  assert.equal(daysUntil("2027-11-07", T), 365);
  assert.equal(daysUntil(null, T), null);
});

test("display status: overdue and pending verification are derived", () => {
  assert.equal(displayStatus({ status: "assigned", due_date: "2026-11-06" }, T), "overdue");
  assert.equal(displayStatus({ status: "in_progress", due_date: "2026-11-07" }, T), "in_progress");
  assert.equal(displayStatus({ status: "completed", verified_at: null }, T), "pending_verification");
  assert.equal(displayStatus({ status: "completed", verified_at: "2026-11-07T10:00:00Z", due_date: "2020-01-01" }, T), "completed");
  assert.equal(displayStatus({ status: "cancelled", due_date: "2020-01-01" }, T), "cancelled");
});

test("certificate state: expired / expiring (60 days) / valid", () => {
  const done = (exp) => ({ status: "completed", certificate_expiry: exp });
  assert.equal(certificateState(done("2026-11-06"), T), "expired");
  assert.equal(certificateState(done("2026-11-07"), T), "expiring");
  assert.equal(certificateState(done("2027-01-06"), T), "expiring");
  assert.equal(certificateState(done("2027-01-07"), T), "valid");
  assert.equal(certificateState({ status: "in_progress", certificate_expiry: "2026-01-01" }, T), null);
  assert.equal(certificateState({ status: "completed" }, T), null);
});

test("allowed actions follow the workflow and separation of duties", () => {
  const assigned = { status: "assigned" };
  const progress = { status: "in_progress" };
  const pending = { status: "completed", result: "passed", verified_at: null };
  const verified = { status: "completed", result: "passed", verified_at: "x" };
  const failed = { status: "completed", result: "failed", verified_at: "x" };
  assert.deepEqual(allowedActions(assigned, { isSelf: true }), ["start", "submit"]);
  assert.deepEqual(allowedActions(progress, { isSelf: true }), ["submit"]);
  // The employee never verifies, completes for HR, renews or records certificates of their own training.
  assert.deepEqual(allowedActions(pending, { isSelf: true, canManage: true }), []);
  assert.deepEqual(allowedActions(verified, { isSelf: true, canManage: true }), []);
  assert.deepEqual(allowedActions(assigned, { canManage: true }), ["complete", "cancel"]);
  assert.deepEqual(allowedActions(pending, { canManage: true }), ["verify", "return", "certificate"]);
  assert.deepEqual(allowedActions(verified, { canManage: true }), ["certificate", "renew"]);
  assert.deepEqual(allowedActions(failed, { canManage: true }), ["renew"]);
  assert.deepEqual(allowedActions({ status: "cancelled" }, { canManage: true }), []);
  assert.deepEqual(allowedActions(pending, {}), []);
});

test("capacity: seats, full sessions waitlist, unlimited never fills", () => {
  assert.deepEqual(seatInfo(10, 3), { left: 7, full: false, label: "3 / 10 booked" });
  assert.equal(seatInfo(2, 2).full, true);
  assert.equal(seatInfo(2, 5).left, 0);
  assert.equal(seatInfo(null, 400).full, false);
  assert.equal(seatInfo("", 1).left, null);
  assert.equal(enrollmentOutcome(1, 0), "enrolled");
  assert.equal(enrollmentOutcome(1, 1), "waitlisted");
  assert.equal(enrollmentOutcome(null, 999), "enrolled");
});

test("dashboard summary and latest completion per employee + course", () => {
  const rows = [
    { employee_id: "e1", course_id: "c1", status: "assigned", due_date: "2026-11-01", course: { is_mandatory: true } },
    { employee_id: "e1", course_id: "c2", status: "in_progress", due_date: "2026-12-01" },
    { employee_id: "e2", course_id: "c1", status: "completed", verified_at: null, completion_date: "2026-11-05" },
    // e3/c1: an older expired certificate superseded by a newer valid one -> not counted as expired
    { employee_id: "e3", course_id: "c1", status: "completed", verified_at: "x", completion_date: "2024-01-01", certificate_expiry: "2025-01-01" },
    { employee_id: "e3", course_id: "c1", status: "completed", verified_at: "x", completion_date: "2026-01-01", certificate_expiry: "2026-12-01" },
    { employee_id: "e4", course_id: "c1", status: "completed", verified_at: "x", completion_date: "2025-01-01", certificate_expiry: "2026-10-01" },
    { employee_id: "e5", course_id: "c1", status: "cancelled" },
  ];
  const s = summarize(rows, T);
  assert.equal(s.total, 7);
  assert.equal(s.assigned, 1);
  assert.equal(s.in_progress, 1);
  assert.equal(s.completed, 3);
  assert.equal(s.overdue, 1);
  assert.equal(s.pending_verification, 1);
  assert.equal(s.mandatory_open, 1);
  assert.equal(s.expiring, 1);
  assert.equal(s.expired, 1);
  assert.equal(s.cancelled, 1);
  const latest = latestCompletions(rows);
  assert.equal(latest.find((a) => a.employee_id === "e3").completion_date, "2026-01-01");
  assert.equal(latest.length, 3);
});

test("session label", () => {
  assert.equal(sessionWhen({ session_date: "2026-11-10", start_time: "10:00:00", end_time: "12:30:00" }), "2026-11-10 10:00–12:30");
  assert.equal(sessionWhen({ session_date: "2026-11-10" }), "2026-11-10");
});

test("migration 207: idempotent, keeps 115 data, no blanket hr_private grant", () => {
  const sql = read("supabase/migrations/207_hr_training_module.sql");
  assert.ok(!/grant\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+hr_private\s+to/i.test(sql), "no blanket hr_private grant (197)");
  assert.ok(!/\bdrop\s+table\b/i.test(sql), "no table is dropped");
  assert.ok(!/\bdelete\s+from\s+public\.hr_training/i.test(sql), "no training data is deleted");
  for (const m of sql.matchAll(/create table (?!if not exists)/gi)) assert.fail(`non-idempotent create table at ${m.index}`);
  for (const m of sql.matchAll(/create (unique )?index (?!if not exists)/gi)) assert.fail(`non-idempotent create index at ${m.index}`);
  for (const m of sql.matchAll(/create policy (\w+)/gi)) assert.match(sql, new RegExp(`drop policy if exists ${m[1]}|drop policy if exists %I`), `policy ${m[1]} is dropped first`);
  for (const m of sql.matchAll(/create trigger (\w+)/gi)) assert.match(sql, new RegExp(`drop trigger if exists ${m[1]}`), `trigger ${m[1]} is dropped first`);
  for (const m of sql.matchAll(/create or replace function (public\.\w+|hr_private\.\w+)[\s\S]*?\$\$;/gi)) {
    assert.match(m[0], /security definer set search_path = ''/, `${m[1]} is SECURITY DEFINER with an empty search_path`);
  }
  assert.ok(!/206_|208_/.test(sql), "does not depend on 206 / 208");
});

test("due date earlier than the assignment: overdue counts from the assigned date", () => {
  // Onboarding-linked induction: inherited the task due date (29 Sep 2025), assigned 07 Nov 2026.
  const inherited = { status: "assigned", due_date: "2025-09-29", assigned_at: "2026-11-07T09:30:00+00:00" };
  assert.equal(assignedDate(inherited), "2026-11-07");
  assert.equal(dueBeforeAssigned(inherited), true);
  assert.equal(effectiveDueDate(inherited), "2026-11-07");
  assert.equal(isOverdueOn(inherited, T), false);
  assert.equal(displayStatus(inherited, T), "assigned");
  assert.deepEqual(dueInfo(inherited, T), { due: "2025-09-29", beforeAssigned: true, effectiveDue: "2026-11-07", days: 0 });
  assert.equal(dueInfo(inherited, "2026-11-10").days, -3);
  assert.equal(isOverdueOn(inherited, "2026-11-10"), true);
  assert.equal(summarize([inherited], T).overdue, 0);
});

test("normal due dates are unchanged by the assigned-date rule", () => {
  const late = { status: "in_progress", due_date: "2026-11-01", assigned_at: "2026-10-01T00:00:00Z" };
  assert.equal(dueBeforeAssigned(late), false);
  assert.equal(effectiveDueDate(late), "2026-11-01");
  assert.equal(isOverdueOn(late, T), true);
  assert.equal(dueInfo(late, T).days, -6);
  // created_at is the fallback when assigned_at is missing; neither -> stored due date.
  assert.equal(effectiveDueDate({ due_date: "2026-01-01", created_at: "2026-02-01T00:00:00Z" }), "2026-02-01");
  assert.equal(effectiveDueDate({ due_date: "2026-01-01" }), "2026-01-01");
  assert.equal(dueBeforeAssigned({ due_date: "2026-01-01" }), false);
  assert.deepEqual(dueInfo({ status: "assigned" }, T), { due: null, beforeAssigned: false, effectiveDue: null, days: null });
  // Same-day due date is not "before" the assignment.
  assert.equal(dueBeforeAssigned({ due_date: "2026-11-07", assigned_at: "2026-11-07T23:00:00Z" }), false);
  assert.equal(isOverdueOn({ status: "completed", due_date: "2025-01-01", assigned_at: "2026-01-01" }, T), false);
});

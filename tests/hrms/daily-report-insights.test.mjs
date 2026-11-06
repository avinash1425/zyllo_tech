// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { derivePendingTasks, feedbackAttention } from "../../src/lib/hr/dailyReportInsights.js";

const P = { id: "p1", code: "WEB", name: "Website" };
let n = 0;
const item = (date, over = {}) => ({
  id: `i${++n}`, task_id: null, project_id: "p1", project: P, task: null, activity: "Build login page", hours: 2, progress_pct: 40,
  work_status: "in_progress", notes: null, created_at: `${date}T10:00:00Z`, report: { id: `r-${date}`, report_date: date, status: "submitted" }, ...over,
});

test("groups the same activity across days and keeps the latest state", () => {
  const out = derivePendingTasks([
    item("2026-11-02", { progress_pct: 20 }),
    item("2026-11-04", { progress_pct: 60, activity: "  build LOGIN page " }),
  ], [], "2026-11-06");
  assert.equal(out.length, 1);
  assert.equal(out[0].progress_pct, 60);
  assert.equal(out[0].hours, 4);
  assert.equal(out[0].days, 2);
  assert.equal(out[0].first_date, "2026-11-02");
  assert.equal(out[0].last_date, "2026-11-04");
  assert.equal(out[0].age_days, 4);
});

test("a task whose latest entry is completed is not pending", () => {
  const out = derivePendingTasks([
    item("2026-11-02"),
    item("2026-11-03", { work_status: "completed", progress_pct: 100 }),
  ], [], "2026-11-06");
  assert.deepEqual(out, []);
});

test("an earlier completion followed by more work is pending again", () => {
  const out = derivePendingTasks([
    item("2026-11-02", { work_status: "completed" }),
    item("2026-11-05", { work_status: "blocked" }),
  ], [], "2026-11-06");
  assert.equal(out.length, 1);
  assert.equal(out[0].work_status, "blocked");
});

test("linked tasks group by task id, honour Done on the task board, and carry due date/overdue", () => {
  const assigned = [
    { id: "t1", title: "API", status: "in_progress", due_date: "2026-11-05", priority: "high", project: P },
    { id: "t2", title: "Docs", status: "done", due_date: null, priority: "low", project: P },
  ];
  const out = derivePendingTasks([
    item("2026-11-03", { task_id: "t1", activity: "API part 1" }),
    item("2026-11-04", { task_id: "t1", activity: "API part 2" }),
    item("2026-11-04", { task_id: "t2", activity: "Docs" }),
  ], assigned, "2026-11-06");
  assert.equal(out.length, 1);
  assert.equal(out[0].task_id, "t1");
  assert.equal(out[0].activity, "API part 2");
  assert.equal(out[0].overdue, true);
  assert.equal(out[0].priority, "high");
});

test("assigned open tasks never reported are listed; done ones are not", () => {
  const out = derivePendingTasks([], [
    { id: "t3", title: "Set up CI", status: "todo", due_date: null, priority: "medium", project: P },
    { id: "t4", title: "Old", status: "done", due_date: null, priority: "low", project: P },
  ], "2026-11-06");
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "assigned");
  assert.equal(out[0].work_status, "not_started");
  assert.equal(out[0].last_date, null);
});

test("overdue and blocked tasks sort first", () => {
  const out = derivePendingTasks([
    item("2026-11-05", { activity: "Recent work" }),
    item("2026-11-01", { activity: "Stuck work", work_status: "blocked" }),
  ], [{ id: "t5", title: "Late", status: "todo", due_date: "2026-11-01", priority: "urgent", project: P }], "2026-11-06");
  assert.deepEqual(out.map((p) => p.activity), ["Late", "Stuck work", "Recent work"]);
});

const review = (report, action, actor, at, status = "submitted") => ({
  id: `${report}-${at}`, report_id: report, action, actor_employee_id: actor, created_at: at, report: { id: report, report_date: "2026-11-01", status },
});

test("feedbackAttention flags changes requested and unanswered clarifications", () => {
  const { changes, awaiting } = feedbackAttention([
    review("a", "revision_requested", "mgr", "1", "revision_requested"),
    review("b", "clarification", "mgr", "1"),
    review("c", "clarification", "mgr", "1"),
    review("c", "comment", "me", "2"),
    review("d", "reviewed", "mgr", "1", "reviewed"),
  ], "me");
  assert.deepEqual([...changes], ["a"]);
  assert.deepEqual([...awaiting], ["b"]);
});

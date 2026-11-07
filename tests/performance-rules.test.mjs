// Run with: npm test
// Performance & KPI pure helpers (src/lib/hr/performanceRules.js) plus static
// checks on migration 206.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canFitWeight, cycleProgress, goalProgressPct, kpiScore, nextReviewStatus, overdueItems, ratingDistribution, ratingLabel, reviewActions,
  scoreToRating, suggestedFinalRating, weightStatus, weightSummary, weightTotal, weightedGoalScore,
} from "../src/lib/hr/performanceRules.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("weight totals and goal-sheet status", () => {
  assert.equal(weightTotal([{ weight: 40 }, { weight: "35.5" }, { weight: 24.5 }]), 100);
  assert.equal(weightTotal([]), 0);
  assert.equal(weightTotal(null), 0);
  assert.equal(weightTotal([{ weight: 0.1 }, { weight: 0.2 }]), 0.3);
  assert.equal(weightStatus(100, 3), "complete");
  assert.equal(weightStatus(90, 2), "under");
  assert.equal(weightStatus(110, 2), "over");
  assert.equal(weightStatus(0, 0), "empty");
});

test("weight summary groups by employee, incomplete sheets first", () => {
  const s = weightSummary([
    { id: "a", employee_id: "e1", weight: 60, status: "agreed" }, { id: "b", employee_id: "e1", weight: 40, status: "agreed" },
    { id: "c", employee_id: "e2", weight: 70, status: "draft" },
    { id: "d", employee_id: "e3", weight: 80, status: "draft" }, { id: "e", employee_id: "e3", weight: 30, status: "draft" },
  ]);
  assert.deepEqual(s.map((x) => [x.employee_id, x.status, x.total, x.remaining, x.drafts]), [
    ["e3", "over", 110, -10, 2], ["e2", "under", 70, 30, 1], ["e1", "complete", 100, 0, 0],
  ]);
});

test("canFitWeight mirrors the server's 100% budget", () => {
  const goals = [{ id: "a", weight: 60 }, { id: "b", weight: 30 }];
  assert.equal(canFitWeight(goals, 10), true);
  assert.equal(canFitWeight(goals, 10.5), false);
  assert.equal(canFitWeight(goals, 40, "b"), true);   // editing b from 30 to 40
  assert.equal(canFitWeight(goals, 41, "b"), false);
});

test("KPI scoring mirrors hr_private.kpi_score", () => {
  assert.equal(kpiScore("ratio", "higher_is_better", 100, 50), 50);
  assert.equal(kpiScore("ratio", "higher_is_better", 100, 150), 100);
  assert.equal(kpiScore("inverse_ratio", "lower_is_better", 2, 4), 50);
  assert.equal(kpiScore("inverse_ratio", "lower_is_better", 2, 0), 100);
  assert.equal(kpiScore("binary", "higher_is_better", 1, 1), 100);
  assert.equal(kpiScore("binary", "lower_is_better", 5, 6), 0);
  assert.equal(kpiScore("ratio", "target_exact", 10, 8), 80);
  assert.equal(kpiScore("manual", "higher_is_better", null, 73), 73);
  assert.equal(kpiScore("ratio", "higher_is_better", 100, null), null);
  assert.equal(kpiScore("ratio", "higher_is_better", null, 5), null);
  assert.equal(kpiScore("ratio", "higher_is_better", 0, 5), null);
});

test("weighted goal score: scored goals with weight only (matches DB tests)", () => {
  assert.equal(weightedGoalScore([{ score: 100, weight: 40 }, { score: 50, weight: 50 }]), 72.22);
  assert.equal(weightedGoalScore([{ score: 75, weight: 60 }, { score: null, weight: 30 }, { score: 90, weight: 0 }]), 75);
  assert.equal(weightedGoalScore([]), null);
  assert.equal(goalProgressPct({ score: 120 }), 100);
  assert.equal(goalProgressPct({ score: null }), null);
});

test("rating helpers", () => {
  assert.equal(scoreToRating(95), 5);
  assert.equal(scoreToRating(75), 4);
  assert.equal(scoreToRating(60), 3);
  assert.equal(scoreToRating(40), 2);
  assert.equal(scoreToRating(10), 1);
  assert.equal(scoreToRating(null), null);
  assert.equal(ratingLabel(3.75), "Exceeds expectations");
  assert.equal(ratingLabel(1.2), "Needs improvement");
  assert.equal(ratingLabel(null), "—");
  // 0.6 * 4 + 0.4 * (80 / 20)
  assert.equal(suggestedFinalRating({ managerRating: 4, goalScore: 80 }), 4);
  assert.equal(suggestedFinalRating({ managerRating: 3, goalScore: 100 }), 3.8);
  assert.equal(suggestedFinalRating({ managerRating: 5, goalScore: 0 }), 3.4);   // goal score floored at rating 1
  assert.equal(suggestedFinalRating({ managerRating: null, goalScore: 50 }), 2.5);
  assert.equal(suggestedFinalRating({ managerRating: 4 }), 4);
  assert.equal(suggestedFinalRating({}), null);
  assert.equal(suggestedFinalRating({ managerRating: 2, goalScore: 100, managerWeight: 1 }), 2);
});

test("review workflow transitions", () => {
  assert.equal(nextReviewStatus("self_review", "submit_self"), "manager_review");
  assert.equal(nextReviewStatus("manager_review", "submit_self"), null);
  assert.equal(nextReviewStatus("manager_review", "submit_manager"), "calibration");
  assert.equal(nextReviewStatus("calibration", "submit_manager"), "calibration");
  assert.equal(nextReviewStatus("calibration", "return_to_manager"), "manager_review");
  assert.equal(nextReviewStatus("manager_review", "return_to_manager"), null);
  assert.equal(nextReviewStatus("calibration", "finalize"), "finalized");
  assert.equal(nextReviewStatus("finalized", "finalize"), null);
  assert.equal(nextReviewStatus("finalized", "submit_manager"), null);
  assert.equal(nextReviewStatus("self_review", "unknown"), null);
});

test("review actions: separation of duties and reporting line", () => {
  const review = { id: "r", employee_id: "emp", manager_id: "mgr", status: "manager_review", self_submitted_at: "2026-11-01" };
  const line = (id) => id === "emp";
  const mgr = reviewActions(review, { myEmployeeId: "mgr", canReviewTeam: true, isInMyLine: line });
  assert.deepEqual(mgr, { selfAssess: false, managerAssess: true, returnToManager: false, finalize: false });
  // Manager outside the reporting line
  assert.equal(reviewActions(review, { myEmployeeId: "other", canReviewTeam: true, isInMyLine: () => false }).managerAssess, false);
  // Nobody assesses / finalizes their own review, not even HR
  const own = reviewActions({ ...review, status: "calibration", manager_submitted_at: "x" }, { myEmployeeId: "emp", canManage: true });
  assert.deepEqual(own, { selfAssess: false, managerAssess: false, returnToManager: false, finalize: false });
  // HR in calibration
  const hr = reviewActions({ ...review, status: "calibration", manager_submitted_at: "x" }, { myEmployeeId: "hr", canManage: true });
  assert.equal(hr.finalize, true);
  assert.equal(hr.returnToManager, true);
  // Finalize waits for the manager unless there is no manager
  assert.equal(reviewActions(review, { myEmployeeId: "hr", canManage: true }).finalize, false);
  assert.equal(reviewActions({ ...review, manager_id: null }, { myEmployeeId: "hr", canManage: true }).finalize, true);
  // Manager may assess without self-assessment only after the due date
  const noSelf = { ...review, status: "self_review", self_submitted_at: null };
  assert.equal(reviewActions(noSelf, { myEmployeeId: "mgr", canReviewTeam: true, isInMyLine: line, today: "2026-11-07", selfDue: "2026-11-10" }).managerAssess, false);
  assert.equal(reviewActions(noSelf, { myEmployeeId: "mgr", canReviewTeam: true, isInMyLine: line, today: "2026-11-07", selfDue: "2026-11-01" }).managerAssess, true);
  // Employee self-assessment, and nothing once the cycle is closed
  assert.equal(reviewActions(noSelf, { myEmployeeId: "emp" }).selfAssess, true);
  assert.equal(reviewActions(noSelf, { myEmployeeId: "emp", cycleActive: false }).selfAssess, false);
  assert.equal(reviewActions({ ...review, status: "finalized" }, { myEmployeeId: "hr", canManage: true }).finalize, false);
});

test("dashboard: cycle progress and rating distribution", () => {
  const reviews = [
    { status: "finalized", final_rating: 3.75 }, { status: "finalized", final_rating: 4.6 }, { status: "finalized", final_rating: 2.2 },
    { status: "calibration" }, { status: "self_review" }, { status: "bogus" },
  ];
  const p = cycleProgress(reviews);
  assert.equal(p.total, 6);
  assert.equal(p.finalized, 3);
  assert.equal(p.completionPct, 50);
  assert.equal(p.counts.calibration, 1);
  const d = ratingDistribution(reviews);
  assert.deepEqual(d.rows.map((r) => r.count), [0, 1, 0, 1, 1]);
  assert.equal(d.total, 3);
  assert.equal(d.average, 3.52);
  assert.equal(cycleProgress([]).completionPct, 0);
  assert.equal(ratingDistribution(null).average, null);
});

test("overdue items", () => {
  const cycles = [{ id: "c1", name: "H2", status: "active", self_assessment_due: "2026-11-01", manager_review_due: "2026-11-05" },
                  { id: "c0", name: "Old", status: "closed", self_assessment_due: "2026-01-01" }];
  const items = overdueItems({
    today: "2026-11-07", cycles,
    reviews: [
      { id: "r1", cycle_id: "c1", status: "self_review", self_submitted_at: null },
      { id: "r2", cycle_id: "c1", status: "manager_review", self_submitted_at: "x", manager_submitted_at: null },
      { id: "r3", cycle_id: "c1", status: "calibration", self_submitted_at: "x", manager_submitted_at: "y" },
      { id: "r4", cycle_id: "c0", status: "self_review", self_submitted_at: null },
    ],
    plans: [{ id: "p1", status: "active", end_date: "2026-11-06" }, { id: "p2", status: "completed", end_date: "2026-10-01" }, { id: "p3", status: "extended", end_date: "2026-12-01" }],
    meetings: [{ id: "m1", status: "scheduled", scheduled_at: "2026-11-02T10:00:00Z" }, { id: "m2", status: "completed", scheduled_at: "2026-11-02T10:00:00Z" }],
  });
  assert.deepEqual(items.map((i) => [i.kind, i.id]), [
    ["self_assessment", "r1"], ["meeting", "m1"], ["manager_assessment", "r2"], ["improvement_plan", "p1"],
  ]);
});

test("migration 206: single idempotent file with RPC-only writes and SoD guards", () => {
  const sql = read("supabase/migrations/206_hr_performance_module.sql");
  for (const t of ["hr_goal_progress_updates", "hr_performance_meetings", "hr_improvement_plan_checkins"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t}`));
    assert.match(sql, new RegExp(`select hr_private\\.secure_table\\('public\\.${t}'\\)`));
    assert.match(sql, new RegExp(`select hr_private\\.enable_audit\\('public\\.${t}'\\)`));
    assert.match(sql, new RegExp(`drop policy if exists ${t}_read`));
  }
  assert.match(sql, /revoke insert, update, delete, truncate on public\.hr_goal_progress_updates/);
  assert.match(sql, /must total exactly 100/);
  assert.match(sql, /You cannot finalize your own review/);
  assert.match(sql, /You cannot calibrate your own review/);
  assert.match(sql, /'not_started','self_review','manager_review','calibration','finalized'/);
  assert.doesNotMatch(sql, /grant execute on all functions in schema hr_private/i);
  assert.doesNotMatch(sql, /\bdrop table\b/i);
  assert.doesNotMatch(sql, /\b(delete from|truncate)\s+public\./i);
  // every create trigger is preceded by a drop trigger if exists (re-runnable)
  const creates = [...sql.matchAll(/create trigger (\w+)/g)].map((m) => m[1]);
  for (const t of creates) assert.match(sql, new RegExp(`drop trigger if exists ${t} `));
});

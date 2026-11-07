// Pure Performance & KPI helpers (no Supabase import; unit-tested in
// tests/performance-rules.test.mjs). The server (migrations 106 + 206) is the
// authority: these mirror its rules so the UI can explain them up front.

export const CYCLE_TYPES = ["monthly", "quarterly", "half_yearly", "annual", "intern"];
export const CYCLE_STATUSES = ["draft", "active", "closed"];
export const GOAL_STATUSES = ["draft", "agreed", "in_progress", "achieved", "missed"];
export const KPI_DIRECTIONS = ["higher_is_better", "lower_is_better", "target_exact"];
export const KPI_FORMULAS = ["ratio", "inverse_ratio", "binary", "manual"];
export const MEETING_TYPES = ["review", "check_in", "calibration", "pip", "other"];
export const MEETING_MODES = ["in_person", "video", "phone"];
export const PIP_STATUSES = ["active", "extended", "completed", "failed", "cancelled"];
export const PIP_OUTCOMES = ["extended", "completed", "failed", "cancelled"];
export const PIP_PROGRESS = ["on_track", "at_risk", "off_track"];
export const FEEDBACK_TYPES = ["praise", "constructive", "note"];

// Review workflow (206):
//   not_started -> self_review -> manager_review -> calibration -> finalized
//   calibration --return--> manager_review
export const REVIEW_STATUSES = ["not_started", "self_review", "manager_review", "calibration", "finalized"];
export const REVIEW_STATUS_LABELS = {
  not_started: "Not started", self_review: "Self-assessment", manager_review: "Manager assessment",
  calibration: "HR calibration", finalized: "Finalized",
};
const TRANSITIONS = {
  submit_self: { from: ["not_started", "self_review"], to: "manager_review" },
  submit_manager: { from: ["not_started", "self_review", "manager_review", "calibration"], to: "calibration" },
  return_to_manager: { from: ["calibration"], to: "manager_review" },
  finalize: { from: ["manager_review", "calibration"], to: "finalized" },
};

/** Next status after `action`, or null when the transition is not allowed. */
export function nextReviewStatus(status, action) {
  const t = TRANSITIONS[action];
  return t && t.from.includes(status) ? t.to : null;
}

/**
 * Which review actions the caller may take (mirrors the RPC checks).
 * ctx: { myEmployeeId, canManage (performance.manage), canReviewTeam (performance.review_team),
 *        isInMyLine(employeeId) => boolean, today 'YYYY-MM-DD', selfDue 'YYYY-MM-DD' | null, cycleActive }
 */
export function reviewActions(review, ctx = {}) {
  const none = { selfAssess: false, managerAssess: false, returnToManager: false, finalize: false };
  if (!review) return none;
  const own = Boolean(ctx.myEmployeeId) && review.employee_id === ctx.myEmployeeId;
  const active = ctx.cycleActive !== false;
  const reviewer = !own && (ctx.canManage || (ctx.canReviewTeam && Boolean(ctx.isInMyLine?.(review.employee_id))));
  const selfLate = !review.self_submitted_at && ctx.selfDue && ctx.today && ctx.selfDue < ctx.today;
  return {
    selfAssess: own && active && !review.self_submitted_at && nextReviewStatus(review.status, "submit_self") !== null,
    managerAssess: reviewer && active && nextReviewStatus(review.status, "submit_manager") !== null
      && (Boolean(review.self_submitted_at) || Boolean(selfLate)),
    returnToManager: !own && Boolean(ctx.canManage) && review.status === "calibration",
    finalize: !own && Boolean(ctx.canManage) && review.status !== "finalized"
      && (Boolean(review.manager_submitted_at) || !review.manager_id),
  };
}

// ---------------------------------------------------------------- ratings
export const RATING_LABELS = { 1: "Needs improvement", 2: "Below expectations", 3: "Meets expectations", 4: "Exceeds expectations", 5: "Outstanding" };

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round2 = (v) => Math.round(v * 100) / 100;

export function ratingLabel(rating) {
  const r = num(rating);
  if (r === null) return "—";
  return RATING_LABELS[Math.min(5, Math.max(1, Math.round(r)))];
}

/** Achievement % (0..100+) to a 1–5 rating band. */
export function scoreToRating(score) {
  const s = num(score);
  if (s === null) return null;
  if (s >= 90) return 5;
  if (s >= 75) return 4;
  if (s >= 60) return 3;
  if (s >= 40) return 2;
  return 1;
}

/**
 * Suggested final rating for calibration: blend of the manager rating and the
 * weighted goal score (score/20, clamped 1..5). managerWeight 0..1 (default 0.6).
 * Falls back to whichever input exists; null when neither does.
 */
export function suggestedFinalRating({ managerRating, goalScore, managerWeight = 0.6 } = {}) {
  const m = num(managerRating);
  const g = num(goalScore);
  const gr = g === null ? null : Math.min(5, Math.max(1, g / 20));
  if (m === null && gr === null) return null;
  if (m === null) return round2(gr);
  if (gr === null) return round2(m);
  const w = Math.min(1, Math.max(0, num(managerWeight) ?? 0.6));
  return round2(m * w + gr * (1 - w));
}

// ---------------------------------------------------------------- KPI scoring
/** Mirror of hr_private.kpi_score (106). Percent achievement clamped to 0..cap, or null. */
export function kpiScore(formula, direction, target, actual, cap = 100) {
  const a = num(actual), t = num(target);
  if (a === null) return null;
  let s;
  if (formula === "manual") s = a;
  else if (t === null) return null;
  else if (formula === "binary") {
    if (direction === "lower_is_better") s = a <= t ? 100 : 0;
    else if (direction === "target_exact") s = a === t ? 100 : 0;
    else s = a >= t ? 100 : 0;
  } else if (direction === "target_exact") {
    s = t === 0 ? (a === 0 ? 100 : 0) : 100 - (Math.abs(a - t) / Math.abs(t)) * 100;
  } else if (formula === "inverse_ratio" || direction === "lower_is_better") {
    s = a <= 0 ? cap : (t / a) * 100;
  } else {
    if (t <= 0) return null;
    s = (a / t) * 100;
  }
  return round2(Math.max(0, Math.min(cap, s)));
}

/** Weighted goal score like hr_compute_goal_scores: scored goals with weight > 0 only. */
export function weightedGoalScore(goals) {
  let sw = 0, ss = 0;
  for (const g of goals ?? []) {
    const s = num(g?.score), w = num(g?.weight);
    if (s === null || w === null || w <= 0) continue;
    sw += w; ss += s * w;
  }
  return sw > 0 ? round2(ss / sw) : null;
}

// ---------------------------------------------------------------- weights
export function weightTotal(goals) {
  return round2((goals ?? []).reduce((t, g) => t + (num(g?.weight) ?? 0), 0));
}

/** Status of one employee's goal sheet: empty | under | complete | over. */
export function weightStatus(total, count = 1) {
  if (!count) return "empty";
  if (Math.abs(total - 100) < 0.005) return "complete";
  return total > 100 ? "over" : "under";
}

/**
 * Group goals by employee (one cycle) → [{ employee_id, employee, goals, count, total, remaining, status, drafts }].
 * Sorted with incomplete sheets first.
 */
export function weightSummary(goals) {
  const by = new Map();
  for (const g of goals ?? []) {
    if (!g?.employee_id) continue;
    if (!by.has(g.employee_id)) by.set(g.employee_id, { employee_id: g.employee_id, employee: g.employee ?? null, goals: [] });
    by.get(g.employee_id).goals.push(g);
  }
  const order = { over: 0, under: 1, empty: 2, complete: 3 };
  return [...by.values()].map((s) => {
    const total = weightTotal(s.goals);
    return { ...s, count: s.goals.length, total, remaining: round2(100 - total), status: weightStatus(total, s.goals.length),
      drafts: s.goals.filter((g) => g.status === "draft").length };
  }).sort((a, b) => order[a.status] - order[b.status]);
}

/** Can a goal of `weight` be added (or an existing one changed to it) without exceeding 100? */
export function canFitWeight(goals, weight, excludeId) {
  const others = (goals ?? []).filter((g) => g.id !== excludeId);
  return weightTotal(others) + (num(weight) ?? 0) <= 100.0001;
}

// ---------------------------------------------------------------- dashboard
/** Counts by review status, completion %. */
export function cycleProgress(reviews) {
  const counts = Object.fromEntries(REVIEW_STATUSES.map((s) => [s, 0]));
  for (const r of reviews ?? []) if (r?.status in counts) counts[r.status] += 1;
  const total = (reviews ?? []).length;
  return { total, counts, finalized: counts.finalized, completionPct: total ? round2((counts.finalized / total) * 100) : 0 };
}

/** Finalized reviews per rounded final rating 1..5. */
export function ratingDistribution(reviews) {
  const rows = [1, 2, 3, 4, 5].map((r) => ({ rating: r, label: RATING_LABELS[r], count: 0 }));
  let n = 0, sum = 0;
  for (const r of reviews ?? []) {
    const f = num(r?.final_rating);
    if (r?.status !== "finalized" || f === null) continue;
    rows[Math.min(5, Math.max(1, Math.round(f))) - 1].count += 1;
    n += 1; sum += f;
  }
  return { rows, total: n, average: n ? round2(sum / n) : null };
}

/**
 * Overdue items: self-assessments past due, manager assessments past due,
 * improvement plans past their end date, meetings in the past still scheduled.
 * Dates are 'YYYY-MM-DD' strings (business-local); `today` likewise.
 */
export function overdueItems({ cycles = [], reviews = [], plans = [], meetings = [], today }) {
  const cyc = new Map((cycles ?? []).map((c) => [c.id, c]));
  const out = [];
  for (const r of reviews ?? []) {
    const c = cyc.get(r.cycle_id);
    if (!c || c.status !== "active") continue;
    if (["not_started", "self_review"].includes(r.status) && !r.self_submitted_at && c.self_assessment_due && c.self_assessment_due < today) {
      out.push({ kind: "self_assessment", id: r.id, employee_id: r.employee_id, employee: r.employee, due: c.self_assessment_due, cycle: c.name });
    } else if (r.status === "manager_review" && !r.manager_submitted_at && c.manager_review_due && c.manager_review_due < today) {
      out.push({ kind: "manager_assessment", id: r.id, employee_id: r.employee_id, employee: r.employee, due: c.manager_review_due, cycle: c.name });
    }
  }
  for (const p of plans ?? []) {
    if (["active", "extended"].includes(p.status) && p.end_date && p.end_date < today) {
      out.push({ kind: "improvement_plan", id: p.id, employee_id: p.employee_id, employee: p.employee, due: p.end_date, cycle: null });
    }
  }
  for (const m of meetings ?? []) {
    const d = typeof m.scheduled_at === "string" ? m.scheduled_at.slice(0, 10) : null;
    if (m.status === "scheduled" && d && d < today) {
      out.push({ kind: "meeting", id: m.id, employee_id: m.employee_id, employee: m.employee_name ? { display_name: m.employee_name } : null, due: d, cycle: m.cycle_name ?? null });
    }
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

export const OVERDUE_LABELS = {
  self_assessment: "Self-assessment overdue", manager_assessment: "Manager assessment overdue",
  improvement_plan: "Improvement plan past end date", meeting: "Meeting not closed",
};

/** Goal progress for display: achievement % (score) clamped 0..100, or null. */
export function goalProgressPct(goal) {
  const s = num(goal?.score);
  return s === null ? null : Math.max(0, Math.min(100, s));
}

export const label = (v) => (v ? String(v).replace(/_/g, " ") : "—");

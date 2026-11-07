// Benefits Management — pure rules shared by the HR page, the Employee Portal
// and the unit tests (tests/benefits-rules.test.mjs). No imports: this file
// must load in plain Node. The server (migration 208) enforces every rule
// again; these mirrors only drive the UI (labels, disabled buttons, hints).

export const CLAIM_STATUSES = ["draft", "submitted", "returned", "approved", "rejected", "cancelled", "paid_externally"];
export const OPEN_CLAIM_STATUSES = ["draft", "submitted", "returned"];
export const ENROLLMENT_STATUSES = ["active", "suspended", "ended", "cancelled"];
export const REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"];
export const COVERAGE_LEVELS = [
  { value: "employee", label: "Employee only" },
  { value: "employee_spouse", label: "Employee + spouse" },
  { value: "employee_children", label: "Employee + children" },
  { value: "family", label: "Family" },
];
export const RELATIONSHIPS = [
  { value: "spouse", label: "Spouse" }, { value: "child", label: "Child" }, { value: "parent", label: "Parent" },
  { value: "parent_in_law", label: "Parent-in-law" }, { value: "sibling", label: "Sibling" }, { value: "other", label: "Other" },
];
export const CONTRIBUTION_FREQUENCIES = ["monthly", "annual", "one_time", "none"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const CLAIM_STATUS_LABEL = {
  draft: "Draft", submitted: "Submitted", returned: "Returned for changes", approved: "Approved", rejected: "Rejected",
  cancelled: "Withdrawn", paid_externally: "Paid (outside payroll)",
};
export const CLAIM_STATUS_TONE = {
  draft: "slate", submitted: "amber", returned: "orange", approved: "green", rejected: "red", cancelled: "slate", paid_externally: "blue",
};

// Allowed claim transitions (who performs them is checked separately).
export const CLAIM_TRANSITIONS = {
  draft: ["submitted", "cancelled"],
  returned: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "returned", "cancelled"],
  approved: ["paid_externally"],
  rejected: [],
  cancelled: [],
  paid_externally: [],
};
const CLAIMANT_TARGETS = new Set(["submitted", "cancelled"]);
const HR_TARGETS = new Set(["approved", "rejected", "returned", "paid_externally"]);

export const canTransition = (from, to) => (CLAIM_TRANSITIONS[from] ?? []).includes(to);

/**
 * Actions the current user may take on a claim.
 *   isClaimant — the claim belongs to the signed-in employee
 *   canManage  — holds benefits.manage
 * Separation of duties: a claimant never approves / rejects / returns / pays
 * their own claim, even with benefits.manage.
 */
export function claimActions(claim, { isClaimant = false, canManage = false } = {}) {
  if (!claim) return [];
  const targets = CLAIM_TRANSITIONS[claim.status] ?? [];
  const out = [];
  if (isClaimant) {
    if (["draft", "returned"].includes(claim.status)) out.push("edit");
    for (const t of targets) if (CLAIMANT_TARGETS.has(t)) out.push(t === "submitted" ? "submit" : "cancel");
  } else if (canManage) {
    for (const t of targets) {
      if (!HR_TARGETS.has(t)) continue;
      out.push({ approved: "approve", rejected: "reject", returned: "return", paid_externally: "record_payment" }[t]);
    }
  }
  return out;
}

// ------------------------------------------------------------- dates
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, "0");

/** First day of the plan year that contains `isoDate` (plan year starts in `startMonth`, 1–12). */
export function planYearStart(startMonth, isoDate) {
  if (!ISO.test(isoDate ?? "")) return null;
  const m = Math.min(12, Math.max(1, Number(startMonth) || 1));
  const [y, mo] = isoDate.split("-").map(Number);
  return `${mo >= m ? y : y - 1}-${pad(m)}-01`;
}

/** Last day of the plan year starting on `startIso`. */
export function planYearEnd(startIso) {
  if (!ISO.test(startIso ?? "")) return null;
  const [y, m] = startIso.split("-").map(Number);
  const end = new Date(Date.UTC(y + 1, m - 1, 1) - 86400000);
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
}

/** "2026" for calendar plan years, otherwise "2026–27". */
export function planYearLabel(startIso) {
  if (!ISO.test(startIso ?? "")) return "—";
  const [y, m] = startIso.split("-").map(Number);
  return m === 1 ? String(y) : `${y}–${String(y + 1).slice(-2)}`;
}

function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

// ------------------------------------------------------- eligibility
const nonEmpty = (a) => (Array.isArray(a) && a.length ? a : null);

/**
 * Why `employee` is not eligible for `plan` on `onDate` (ISO), or null when eligible.
 * Mirrors hr_private.benefit_ineligibility (migration 208).
 * employee: { status, employment_type, joining_date, probation_end_date, grade_id, work_location_id }
 */
export function ineligibilityReason(plan, employee, onDate) {
  if (!employee) return "Employee not found.";
  if (!plan) return "Benefit plan not found.";
  if (!plan.active) return "This benefit plan is inactive.";
  if (["exited", "archived", "suspended"].includes(employee.status)) return "The employee is not active.";
  const types = nonEmpty(plan.eligible_employment_types);
  if (types && !types.includes(employee.employment_type)) {
    return `Employment type ${String(employee.employment_type ?? "").replace(/_/g, " ")} is not eligible for this plan.`;
  }
  const months = Number(plan.min_tenure_months) || 0;
  if (months > 0 && (!employee.joining_date || addMonths(employee.joining_date, months) > onDate)) {
    return `Requires ${months} months of service by the start date.`;
  }
  const grades = nonEmpty(plan.eligible_grade_ids);
  if (grades && (!employee.grade_id || !grades.includes(employee.grade_id))) return "The employee's grade is not eligible for this plan.";
  const locations = nonEmpty(plan.eligible_location_ids);
  if (locations && (!employee.work_location_id || !locations.includes(employee.work_location_id))) return "The employee's work location is not eligible for this plan.";
  if (plan.allow_during_probation === false
      && (employee.status === "probation" || (employee.probation_end_date && employee.probation_end_date >= onDate))) {
    return "Not available during probation.";
  }
  return null;
}

export const isEligible = (plan, employee, onDate) => ineligibilityReason(plan, employee, onDate) === null;

/** Plain-language summary of a plan's eligibility rules. */
export function eligibilitySummary(plan, { grades = [], locations = [], employmentTypes = [] } = {}) {
  if (!plan) return "";
  const name = (list, id, key = "id") => list.find((x) => x[key] === id)?.name ?? null;
  const parts = [];
  const types = nonEmpty(plan.eligible_employment_types);
  parts.push(types ? types.map((t) => name(employmentTypes, t, "code") ?? t.replace(/_/g, " ")).join(", ") : "All employment types");
  if (Number(plan.min_tenure_months) > 0) parts.push(`${plan.min_tenure_months}+ months of service`);
  const g = nonEmpty(plan.eligible_grade_ids);
  if (g) parts.push(`Grades: ${g.map((id) => name(grades, id) ?? "unknown").join(", ")}`);
  const l = nonEmpty(plan.eligible_location_ids);
  if (l) parts.push(`Locations: ${l.map((id) => name(locations, id) ?? "unknown").join(", ")}`);
  parts.push(plan.allow_during_probation === false ? "Not during probation" : "Probation allowed");
  return parts.join(" · ");
}

// ------------------------------------------------------ annual limit
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Usage of an annual limit by the claims of ONE enrollment and plan year.
 * Mirrors hr_benefits_internal.claim_usage + the submit / approve checks:
 *   used      = approved amounts of approved / paid_externally claims
 *   pending   = claimed amounts of submitted claims
 *   remaining = limit − used          (what an approval may still use)
 *   available = limit − used − pending (what a new submission may claim)
 * limit null/undefined = no annual limit (remaining / available null).
 */
export function limitUsage(limit, claims = [], { planYearStart: year = null, excludeId = null } = {}) {
  let used = 0, pending = 0;
  for (const c of claims ?? []) {
    if (!c || c.id === excludeId) continue;
    if (year && c.plan_year_start !== year) continue;
    if (c.status === "approved" || c.status === "paid_externally") used += Number(c.approved_amount ?? c.amount) || 0;
    else if (c.status === "submitted") pending += Number(c.amount) || 0;
  }
  used = round2(used); pending = round2(pending);
  const hasLimit = limit !== null && limit !== undefined && limit !== "" && Number.isFinite(Number(limit));
  const lim = hasLimit ? round2(limit) : null;
  return {
    limit: lim, used, pending,
    remaining: hasLimit ? Math.max(0, round2(lim - used)) : null,
    available: hasLimit ? Math.max(0, round2(lim - used - pending)) : null,
    utilisationPct: hasLimit && lim > 0 ? Math.round((used / lim) * 1000) / 10 : null,
  };
}

/** Error text when `amount` does not fit `available` (null = unlimited), else null. */
export function limitError(amount, available) {
  const a = Number(amount);
  if (!(a > 0)) return "Enter an amount greater than zero.";
  if (available === null || available === undefined) return null;
  return a > Number(available) + 1e-9 ? `The amount exceeds the remaining annual limit (${Number(available).toFixed(2)} available).` : null;
}

/**
 * Client-side claim checks (the server re-checks everything).
 * enrollment: { status, start_date, end_date }  today: ISO date
 */
export function validateClaim({ amount, expenseDate, description, enrollment, today, available = null }) {
  const errors = {};
  if (!enrollment) errors.enrollment = "Choose the benefit you are claiming against.";
  if (!ISO.test(expenseDate ?? "")) errors.expense_date = "Enter the expense date.";
  else if (today && expenseDate > today) errors.expense_date = "The expense date cannot be in the future.";
  else if (enrollment && expenseDate < enrollment.start_date) errors.expense_date = "The expense date is before the enrollment started.";
  else if (enrollment?.end_date && expenseDate > enrollment.end_date) errors.expense_date = "The expense date is after the enrollment ended.";
  const amt = String(amount ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amt) || !(Number(amt) > 0)) errors.amount = "Enter an amount greater than zero (at most two decimals).";
  else {
    const e = limitError(Number(amt), available);
    if (e) errors.amount = e;
  }
  if (String(description ?? "").trim().length < 3) errors.description = "Describe the expense (at least 3 characters).";
  if (enrollment && !["active", "ended"].includes(enrollment.status)) errors.enrollment = "Claims need an active enrollment.";
  return errors;
}

export const label = (s) => String(s ?? "").replace(/_/g, " ");

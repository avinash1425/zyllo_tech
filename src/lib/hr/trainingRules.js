// Pure Training helpers (no Supabase import; unit-tested in
// tests/training-rules.test.mjs). They mirror the rules of migrations 115
// and 207 so the UI shows the same states the server enforces.

export const EXPIRING_DAYS = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const parse = (s) => {
  if (!s || !DATE_RE.test(String(s).slice(0, 10))) return null;
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return { y, m, d };
};
const pad = (n) => String(n).padStart(2, "0");
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** YYYY-MM-DD + n months, clamped to the month end like PostgreSQL `date + interval 'n months'`. */
export function addMonths(dateStr, months) {
  const p = parse(dateStr);
  if (!p || !Number.isInteger(Number(months))) return null;
  const total = p.y * 12 + (p.m - 1) + Number(months);
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(p.d, daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** hr_private.training_expiry: completion date + validity for passed / attended results. */
export function certificateExpiry(completionDate, validityMonths, result) {
  if (!completionDate || validityMonths == null || validityMonths === "" || !["passed", "attended"].includes(result)) return null;
  return addMonths(completionDate, Number(validityMonths));
}

/** Whole days from `today` to `date` (negative when in the past). */
export function daysUntil(date, today) {
  const a = parse(date), b = parse(today);
  if (!a || !b) return null;
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
}

export const isOpen = (a) => ["assigned", "in_progress"].includes(a?.status);
export const isPendingVerification = (a) => a?.status === "completed" && !a?.verified_at;
export const isOverdueOn = (a, today) => Boolean(isOpen(a) && a?.due_date && a.due_date < today);

/**
 * Display state of an assignment: overdue / pending_verification / the
 * stored status. Completed + unverified is "pending verification".
 */
export function displayStatus(a, today) {
  if (!a) return null;
  if (isOverdueOn(a, today)) return "overdue";
  if (isPendingVerification(a)) return "pending_verification";
  return a.status;
}

/** Certificate state: expired / expiring (within `days`) / valid / null (no expiry). */
export function certificateState(a, today, days = EXPIRING_DAYS) {
  if (a?.status !== "completed" || !a?.certificate_expiry) return null;
  const left = daysUntil(a.certificate_expiry, today);
  if (left == null) return null;
  if (left < 0) return "expired";
  if (left <= days) return "expiring";
  return "valid";
}

/**
 * Actions the UI may offer. The server re-checks every one of them.
 *   isSelf: the viewer is the assignee; canManage: HR for anyone or the
 *   reporting-line manager (never self).
 */
export function allowedActions(a, { isSelf = false, canManage = false } = {}) {
  const out = [];
  if (!a) return out;
  if (isSelf) {
    if (a.status === "assigned") out.push("start");
    if (isOpen(a)) out.push("submit");
    return out;
  }
  if (!canManage) return out;
  if (isOpen(a)) out.push("complete", "cancel");
  if (isPendingVerification(a)) out.push("verify", "return");
  if (a.status === "completed" && ["passed", "attended"].includes(a.result)) out.push("certificate");
  if (a.status === "completed" && a.verified_at) out.push("renew");
  return out;
}

/** Seats: capacity null = unlimited. */
export function seatInfo(capacity, taken) {
  const t = Math.max(0, Number(taken) || 0);
  if (capacity == null || capacity === "") return { left: null, full: false, label: `${t} booked · unlimited` };
  const cap = Number(capacity);
  const left = Math.max(0, cap - t);
  return { left, full: left === 0, label: `${t} / ${cap} booked` };
}

/** What an enrollment request results in (hr_private.training_enroll_one). */
export const enrollmentOutcome = (capacity, taken) => (seatInfo(capacity, taken).full ? "waitlisted" : "enrolled");

/** Dashboard counts over a list of (RLS-scoped) assignments. */
export function summarize(rows, today, days = EXPIRING_DAYS) {
  const s = { total: 0, assigned: 0, in_progress: 0, completed: 0, overdue: 0, pending_verification: 0, expiring: 0, expired: 0, cancelled: 0, mandatory_open: 0 };
  for (const a of rows ?? []) {
    s.total += 1;
    if (a.status === "assigned") s.assigned += 1;
    if (a.status === "in_progress") s.in_progress += 1;
    if (a.status === "completed" && a.verified_at) s.completed += 1;
    if (a.status === "cancelled") s.cancelled += 1;
    if (isOverdueOn(a, today)) s.overdue += 1;
    if (isPendingVerification(a)) s.pending_verification += 1;
    if (isOpen(a) && a.course?.is_mandatory) s.mandatory_open += 1;
  }
  // Certificates: only the latest completion per employee + course counts.
  for (const a of latestCompletions(rows)) {
    const c = certificateState(a, today, days);
    if (c === "expiring") s.expiring += 1;
    if (c === "expired") s.expired += 1;
  }
  return s;
}

/** Latest completed assignment per employee + course (older completions are history). */
export function latestCompletions(rows) {
  const best = new Map();
  for (const a of rows ?? []) {
    if (a.status !== "completed") continue;
    const k = `${a.employee_id}|${a.course_id}`;
    const cur = best.get(k);
    if (!cur || (a.completion_date ?? "") > (cur.completion_date ?? "")) best.set(k, a);
  }
  return [...best.values()];
}

/** Session date/time label. */
export function sessionWhen(s) {
  if (!s) return "";
  const t = (v) => (v ? String(v).slice(0, 5) : "");
  const time = s.start_time ? ` ${t(s.start_time)}${s.end_time ? `–${t(s.end_time)}` : ""}` : "";
  return `${s.session_date ?? ""}${time}`;
}

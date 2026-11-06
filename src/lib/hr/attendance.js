// Attendance & Time data layer (migration 101). Every write is a SECURITY
// DEFINER RPC that uses SERVER time and computes late / early / overtime /
// status itself; the browser never calculates attendance results.
// Website login/logout (hr_login_events) is a security log and is NOT attendance.
import { from, rpc, run, useHrQuery } from "./client";

export const ATTENDANCE_STATUSES = ["present", "late", "half_day", "absent", "on_leave", "holiday", "weekend", "missing_punch"];
export const MANUAL_NO_PUNCH_STATUSES = ["absent", "on_leave", "holiday", "weekend"];
export const CORRECTION_STATUSES = ["pending", "approved", "rejected", "cancelled"];
export const DEFAULT_TZ = "Asia/Kolkata";
// Migration 125: regularization request types (same corrections workflow).
export const REQUEST_TYPES = [
  { value: "missed_punch_in", label: "Missed punch-in" },
  { value: "missed_punch_out", label: "Missed punch-out" },
  { value: "incorrect_time", label: "Incorrect punch time" },
  { value: "status_correction", label: "Attendance status correction" },
  { value: "regularization", label: "Other regularization" },
];
export const REQUESTABLE_STATUSES = ["present", "half_day", "absent"];
export const requestTypeLabel = (v) => REQUEST_TYPES.find((t) => t.value === v)?.label ?? String(v ?? "").replace(/_/g, " ");
// Computed day statuses (hr_private.attendance_day) in addition to stored ones.
export const OVERVIEW_STATUSES = ["present", "late", "half_day", "absent", "on_leave", "holiday", "weekend", "missing_punch", "not_started"];

const EMP = "id, employee_code, first_name, last_name, display_name, department_id, manager_id";
const ATT_COLS = `id, employee_id, work_date, shift_id, expected_start_at, expected_end_at, check_in_at, check_out_at, break_minutes,
  worked_minutes, late_minutes, early_leave_minutes, overtime_minutes, status, source, check_in_note, check_out_note, notes, updated_at`;
const CORR_COLS = `id, employee_id, work_date, requested_check_in_at, requested_check_out_at, reason, status, attendance_id,
  reviewer_employee_id, reviewed_at, review_note, created_at, request_type, requested_status, evidence_note,
  original_check_in_at, original_check_out_at, original_status, applied_check_in_at, applied_check_out_at, applied_status,
  approval_stage, manager_employee_id, manager_decided_at, manager_note`;

// ------------------------------------------------------------ time helpers
/** The business timezone from hr_settings.company (readable by every signed-in user). */
export function useBusinessTimezone() {
  const q = useHrQuery(() => run(from("hr_settings").select("value").eq("key", "company").maybeSingle()), []);
  return q.data?.value?.timezone || DEFAULT_TZ;
}

/** YYYY-MM-DD for "now" (or a Date) in a timezone. */
export function dateInTz(tz = DEFAULT_TZ, d = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
export const businessToday = (tz = DEFAULT_TZ) => dateInTz(tz);

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "HH:MM" of a timestamp in a timezone (24h), for display and form prefill. */
export function timeInTz(ts, tz = DEFAULT_TZ) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
export const formatTime = (ts, tz) => timeInTz(ts, tz) || "—";

export function formatDateTimeTz(ts, tz = DEFAULT_TZ) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function tzOffsetMinutes(utcMs, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60000);
}

/** Wall-clock date + "HH:MM" in the business timezone -> ISO timestamp (UTC). */
export function zonedIso(date, time, tz = DEFAULT_TZ) {
  if (!date || !time) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if ([y, m, d, hh, mm].some((x) => Number.isNaN(x))) return null;
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMinutes(guess, tz);
  off = tzOffsetMinutes(guess - off * 60000, tz);   // second pass handles DST edges
  return new Date(guess - off * 60000).toISOString();
}

export function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

// ------------------------------------------------------------ self service
export const getMyToday = () => rpc("hr_my_attendance_today");
export const checkIn = (note) => rpc("hr_check_in", { p_note: note?.trim() || null });
export const checkOut = (note) => rpc("hr_check_out", { p_note: note?.trim() || null });

export async function listMyAttendance(employeeId, fromDate, toDate) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_attendance").select(ATT_COLS).eq("employee_id", employeeId)
    .gte("work_date", fromDate).lte("work_date", toDate).order("work_date", { ascending: false }));
}

export async function listMyCorrections(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_attendance_corrections").select(CORR_COLS).eq("employee_id", employeeId)
    .order("created_at", { ascending: false }).limit(200));
}

export const requestCorrection = ({ workDate, checkIn: inAt, checkOut: outAt, reason }) =>
  rpc("hr_request_attendance_correction", { p_work_date: workDate, p_check_in: inAt || null, p_check_out: outAt || null, p_reason: reason?.trim() });
export const cancelCorrection = (id) => rpc("hr_cancel_attendance_correction", { p_id: id });

export async function getAttendanceSettings() {
  return run(from("hr_settings").select("value").eq("key", "attendance").maybeSingle());
}

// ------------------------------------------------------------ HR
/** Attendance rows in a date range (RLS: all / team / self). */
export async function listAttendance({ from: f, to, status = "" } = {}) {
  let q = from("hr_attendance").select(`${ATT_COLS}, employee:hr_employees!hr_attendance_employee_id_fkey(${EMP})`)
    .gte("work_date", f).lte("work_date", to);
  if (status) q = q.eq("status", status);
  return run(q.order("work_date", { ascending: false }).order("check_in_at", { ascending: true }).limit(5000));
}

/** Same rows as the hr_attendance_missing_punches view (checked in, never checked out, past date), with names. */
export async function listOpenPunches(today) {
  return run(from("hr_attendance").select(`${ATT_COLS}, employee:hr_employees!hr_attendance_employee_id_fkey(${EMP})`)
    .not("check_in_at", "is", null).is("check_out_at", null).lt("work_date", today)
    .order("work_date", { ascending: false }).limit(2000));
}

export const markMissingPunches = (date) => rpc("hr_mark_missing_punches", { p_date: date || null });

export async function listCorrections({ status = "pending" } = {}) {
  let q = from("hr_attendance_corrections").select(`${CORR_COLS}, employee:hr_employees!hr_attendance_corrections_employee_id_fkey(${EMP})`);
  if (status) q = q.eq("status", status);
  return run(q.order("created_at", { ascending: status === "pending" }).limit(1000));
}

export const decideCorrection = (id, approve, note) =>
  rpc("hr_decide_attendance_correction", { p_id: id, p_approve: approve, p_note: note?.trim() || null });

export const upsertManualAttendance = ({ employee, workDate, checkIn: inAt, checkOut: outAt, note, status }) =>
  rpc("hr_upsert_attendance_manual", {
    p_employee: employee, p_work_date: workDate, p_check_in: inAt || null, p_check_out: outAt || null,
    p_note: note?.trim(), p_status: inAt ? null : status || "absent",
  });

// ------------------------------------------------------------ migration 125
// All of these are computed on the server from database records.

/** Daily overview for HR / managers: { date, kpis, rows } (rows include employees with no record). */
export const getOverview = ({ date, department, status, search, legalEntity } = {}) =>
  rpc("hr_attendance_overview", {
    p_date: date || null, p_department: department || null, p_status: status || null,
    p_search: search?.trim() || null, p_legal_entity: legalEntity || null,
  });

/** Working-hours summary per employee: [{ employee, totals }]. Range up to 93 days. */
export const getSummary = ({ from: f, to, department, employee, legalEntity, search } = {}) =>
  rpc("hr_attendance_summary", {
    p_from: f, p_to: to, p_department: department || null, p_employee: employee || null,
    p_legal_entity: legalEntity || null, p_search: search?.trim() || null,
  });

/** One month of computed days + weekly and monthly totals (self, or a team member / any employee for HR). */
export const getCalendar = (month, employee) => rpc("hr_my_attendance_calendar", { p_month: month || null, p_employee: employee || null });

/** Holiday occurrences in a range (recurring holidays expanded). */
export const getHolidayCalendar = ({ from: f, to, employee, all = false }) =>
  rpc("hr_holiday_calendar", { p_from: f, p_to: to, p_employee: employee || null, p_all: all });

export const requestRegularization = ({ workDate, type, checkIn: inAt, checkOut: outAt, status, reason, evidence }) =>
  rpc("hr_request_attendance_regularization", {
    p_work_date: workDate, p_request_type: type, p_check_in: inAt || null, p_check_out: outAt || null,
    p_requested_status: status || null, p_reason: reason?.trim(), p_evidence: evidence?.trim() || null,
  });

export async function listCorrectionEvents(correctionId) {
  return run(from("hr_attendance_correction_events").select("id, action, stage, actor_employee_id, note, created_at")
    .eq("correction_id", correctionId).order("created_at", { ascending: true }));
}

export async function listPunches(employeeId, fromDate, toDate) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_attendance_punches").select("id, work_date, kind, punched_at, source, note, recorded_at")
    .eq("employee_id", employeeId).gte("work_date", fromDate).lte("work_date", toDate)
    .order("work_date", { ascending: false }).order("recorded_at", { ascending: true }).limit(500));
}

// ------------------------------------------------------------ shifts
const SHIFT_COLS = `id, name, code, description, start_time, end_time, grace_minutes, break_minutes, break_paid, early_leave_grace_minutes,
  overtime_after_minutes, expected_minutes, half_day_minutes, absent_below_minutes, working_days, weekly_off_rules, is_default, active, updated_at`;

export async function listShifts() {
  return run(from("hr_shifts").select(SHIFT_COLS).order("name"));
}

/** Insert or update a shift (RLS: settings.manage or attendance.manage). */
export async function saveShift(values) {
  const { id, ...rest } = values;
  const q = id ? from("hr_shifts").update(rest).eq("id", id) : from("hr_shifts").insert(rest);
  return run(q.select(SHIFT_COLS).single());
}

export async function listShiftAssignments({ employee, activeOnly = false } = {}) {
  let q = from("hr_shift_assignments")
    .select("id, employee_id, shift_id, effective_from, effective_to, reason, status, created_at, employee:hr_employees!hr_shift_assignments_employee_id_fkey(" + EMP + "), shift:hr_shifts(id, name, start_time, end_time)");
  if (employee) q = q.eq("employee_id", employee);
  if (activeOnly) q = q.eq("status", "active");
  return run(q.order("effective_from", { ascending: false }).limit(1000));
}

export const assignShift = ({ employee, shift, from: f, to, reason }) =>
  rpc("hr_assign_shift", { p_employee: employee, p_shift: shift, p_from: f, p_to: to || null, p_reason: reason?.trim() || null });
export const endShiftAssignment = (id, to, reason) => rpc("hr_end_shift_assignment", { p_id: id, p_to: to, p_reason: reason?.trim() || null });
export const cancelShiftAssignment = (id, reason) => rpc("hr_cancel_shift_assignment", { p_id: id, p_reason: reason?.trim() || null });

export const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEK_ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th"];

/** Human summary of weekly-off rules, e.g. "Sat off on 2nd, 4th week". */
export function describeWeeklyOffRules(rules) {
  const entries = Object.entries(rules ?? {}).filter(([, w]) => Array.isArray(w) && w.length);
  if (!entries.length) return "";
  return entries.map(([d, w]) => `${DAY_NAMES[d]} off on ${w.map((n) => WEEK_ORDINALS[n]).join(", ")}`).join("; ");
}

export function shiftHours(s) {
  if (!s?.start_time || !s?.end_time) return "—";
  const a = String(s.start_time).slice(0, 5), b = String(s.end_time).slice(0, 5);
  return `${a}–${b}${b <= a ? " (overnight)" : ""}`;
}

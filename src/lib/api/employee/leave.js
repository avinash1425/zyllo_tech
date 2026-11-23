// Employee Portal: Leave Management (migration 236).
// Balances, day counts and approval rules are all enforced in the database;
// the checks here only give the user a clear message first.
import { supabase } from "@/lib/supabase/client";

export const LEAVE_STATUS = {
  pending: { label: "Pending approval", chip: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", chip: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", chip: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", chip: "bg-slate-100 text-slate-600" },
};

export const HALF_DAY = { first_half: "First half", second_half: "Second half" };

const DB_MESSAGES =
  /Choose a leave type|reporting manager|valid start and end|cross into the next year|at most 30 days ago|half day must|Write a reason|No reporting manager|only Sundays or company holidays|already have leave|Not enough|not found|Only pending leave|already (approved|rejected|cancelled)|Comment must|Not an active employee/i;

function friendly(error, fallback) {
  const msg = error?.message ?? "";
  return DB_MESSAGES.test(msg) ? msg : fallback;
}

/** { year, manager, balances: [...], requests: [...], holidays: [...] } */
export async function getLeaveOverview(year) {
  const { data, error } = await supabase.rpc("ep_leave_overview", { p_year: year });
  if (error) throw error;
  return data;
}

/** Leave days for a range (Sundays + holidays not counted). */
export async function previewLeaveDays(start, end, halfDay) {
  const { data, error } = await supabase.rpc("ep_leave_preview", { p_start: start, p_end: end, p_half: halfDay || null });
  if (error) throw error;
  return Number(data ?? 0);
}

export function validateLeave(f) {
  const e = {};
  if (!f.leave_type) e.leave_type = "Choose a leave type.";
  if (!f.start_date) e.start_date = "Choose the start date.";
  if (!f.end_date) e.end_date = "Choose the end date.";
  if (f.start_date && f.end_date && f.end_date < f.start_date) e.end_date = "End date must be on or after the start date.";
  if (f.start_date && f.end_date && f.start_date.slice(0, 4) !== f.end_date.slice(0, 4)) {
    e.end_date = "Leave cannot cross into the next year. Apply for each year separately.";
  }
  if (f.half_day && f.start_date !== f.end_date) e.half_day = "A half day must be a single date.";
  const mgr = String(f.manager_name ?? "").trim();
  if (!f.manager_id && !mgr) e.manager = "Enter your reporting manager.";
  else if (mgr.length > 120) e.manager = "Keep it under 120 characters.";
  const reason = String(f.reason ?? "").trim();
  if (!reason) e.reason = "Write a reason.";
  else if (reason.length > 1000) e.reason = "Keep it under 1000 characters.";
  return Object.keys(e).length ? e : null;
}

export async function applyLeave(f) {
  const { data, error } = await supabase.rpc("ep_apply_leave", {
    p_type: f.leave_type,
    p_start: f.start_date,
    p_end: f.end_date,
    p_half: f.half_day || null,
    p_reason: String(f.reason ?? "").trim(),
    // A colleague picked from the list (gets notified), or just the typed name.
    p_manager_id: f.manager_id || null,
    p_manager_name: String(f.manager_name ?? "").trim(),
  });
  if (error) return { ok: false, message: friendly(error, "Could not apply for leave. Please try again.") };
  return { ok: true, request: data };
}

export async function cancelLeave(id) {
  const { error } = await supabase.rpc("ep_cancel_leave", { p_id: id });
  if (error) return { ok: false, message: friendly(error, "Could not cancel. Please try again.") };
  return { ok: true };
}

// ---------------------------------------------------------------- manager
/** { team_size, requests: [...] } */
export async function getTeamLeave() {
  const { data, error } = await supabase.rpc("ep_team_leave");
  if (error) throw error;
  return data ?? { team_size: 0, requests: [] };
}

/** action: "approved" | "rejected" (rejected needs a comment). */
export async function decideLeave(id, action, comment) {
  const { data, error } = await supabase.rpc("ep_decide_leave", {
    p_id: id,
    p_action: action,
    p_comment: String(comment ?? "").trim(),
  });
  if (error) return { ok: false, message: friendly(error, "Could not save the decision. Please try again.") };
  return { ok: true, request: data };
}

// ---------------------------------------------------------------- attendance calendar
/** { holidays: Map(iso -> name), leave: Map(iso -> { type, half_day }) } */
export async function getMyDaysOff(fromIso, toIso) {
  const { data, error } = await supabase.rpc("ep_my_days_off", { p_from: fromIso, p_to: toIso });
  if (error) throw error;
  return {
    holidays: new Map((data?.holidays ?? []).map((h) => [h.date, h.name])),
    leave: new Map((data?.leave ?? []).map((l) => [l.date, { type: l.type, half_day: l.half_day }])),
  };
}

// Attendance correction requests (migration 242): the employee asks, the admin decides.
import { supabase } from "@/lib/supabase/client";

export const CORRECTION_STATUS = {
  pending: { label: "Pending", chip: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", chip: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", chip: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", chip: "bg-slate-100 text-slate-600" },
};

/** "HH:MM" (24h) of a timestamp in India time, or "". */
export function toHm(ts) {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(ts),
  );
}

/** "YYYY-MM-DD" + "HH:MM" (India time) -> ISO timestamp with +05:30, or null. */
export const istTimestamp = (dateIso, hm) => (dateIso && hm ? `${dateIso}T${hm}:00+05:30` : null);

const KNOWN =
  /30 days|punch in|punch out|overlap|future|same day|pending correction|nothing to correct|reason|not found|still open|already|cancelled|Not an active employee|Only admins|Invalid action|Comment must/i;

function friendly(error, fallback) {
  const msg = error?.message ?? "";
  return KNOWN.test(msg) ? msg : fallback;
}

export async function requestCorrection({ date, attendanceId, inHm, outHm, reason }) {
  const { data, error } = await supabase.rpc("ep_request_correction", {
    p_date: date,
    p_attendance: attendanceId || null,
    p_in: istTimestamp(date, inHm),
    p_out: istTimestamp(date, outHm),
    p_reason: String(reason ?? "").trim(),
  });
  if (error) return { ok: false, message: friendly(error, "Could not send the request. Please try again.") };
  return { ok: true, request: data };
}

export async function getMyCorrections() {
  const { data, error } = await supabase.rpc("ep_my_corrections");
  if (error) throw error;
  return data ?? [];
}

export async function cancelCorrection(id) {
  const { error } = await supabase.rpc("ep_cancel_correction", { p_id: id });
  if (error) return { ok: false, message: friendly(error, "Could not cancel. Please try again.") };
  return { ok: true };
}

// ---------------------------------------------------------------- admin
export async function getAllCorrections(status = "pending") {
  const { data, error } = await supabase.rpc("ep_admin_corrections", { p_status: status });
  if (error) throw error;
  return data ?? [];
}

export async function decideCorrection(id, action, comment) {
  const { data, error } = await supabase.rpc("ep_admin_decide_correction", {
    p_id: id,
    p_action: action,
    p_comment: String(comment ?? "").trim(),
  });
  if (error) return { ok: false, message: friendly(error, "Could not save the decision. Please try again.") };
  return { ok: true, request: data };
}

// Admin: Attendance Management + Leave Management for the Employee Portal (migration 242).
// All calls are admin-only RPCs (public.is_admin()).
import { supabase } from "@/lib/supabase/client";

const KNOWN =
  /Only admins|not found|already|Write a reason|Comment must|Not enough|balance cannot be lower|Only paid leave|Days must be|Invalid year|valid date|Holiday name|is already a holiday|date range/i;
const friendly = (error, fallback) => (KNOWN.test(error?.message ?? "") ? error.message : fallback);

// ---------------------------------------------------------------- attendance
/**
 * Attendance between two dates (max 62 days) for everyone, or one employee:
 * { employees, rows, sessions, holidays, leave, pending_corrections }.
 */
export async function getAttendance(fromIso, toIso, employeeId = null) {
  const { data, error } = await supabase.rpc("ep_admin_attendance", { p_from: fromIso, p_to: toIso, p_emp: employeeId });
  if (error) throw error;
  return data;
}

/** { holidays: Map(iso -> name), leave: Map(iso -> {type, half_day}) } for one employee, as monthDays() expects. */
export function daysOffFor(data, employeeId) {
  return {
    holidays: new Map((data?.holidays ?? []).map((h) => [h.date, h.name])),
    leave: new Map((data?.leave ?? []).filter((l) => l.employee_id === employeeId).map((l) => [l.date, l])),
  };
}

// ---------------------------------------------------------------- leave requests
export async function getLeaveRequests(status = "pending", year = null) {
  const { data, error } = await supabase.rpc("ep_admin_leave_requests", { p_status: status, p_year: year });
  if (error) throw error;
  return data ?? [];
}

export async function decideLeave(id, action, comment) {
  const { data, error } = await supabase.rpc("ep_admin_decide_leave", {
    p_id: id,
    p_action: action,
    p_comment: String(comment ?? "").trim(),
  });
  if (error) return { ok: false, message: friendly(error, "Could not save the decision. Please try again.") };
  return { ok: true, request: data };
}

// ---------------------------------------------------------------- balances
export async function getLeaveBalances(year) {
  const { data, error } = await supabase.rpc("ep_admin_leave_balances", { p_year: year });
  if (error) throw error;
  return data;
}

/** days = number, or null to go back to the leave type's default. */
export async function setLeaveAllowance(employeeId, year, type, days) {
  const { data, error } = await supabase.rpc("ep_admin_set_leave_allowance", {
    p_emp: employeeId,
    p_year: year,
    p_type: type,
    p_days: days,
  });
  if (error) return { ok: false, message: friendly(error, "Could not save the balance. Please try again.") };
  return { ok: true, balance: data };
}

// ---------------------------------------------------------------- holidays
export async function getHolidays(year) {
  const { data, error } = await supabase.rpc("ep_admin_holidays", { p_year: year });
  if (error) throw error;
  return data ?? [];
}

export async function saveHoliday(id, dateIso, name) {
  const { data, error } = await supabase.rpc("ep_admin_save_holiday", {
    p_id: id ?? null,
    p_date: dateIso,
    p_name: String(name ?? "").trim(),
  });
  if (error) return { ok: false, message: friendly(error, "Could not save the holiday. Please try again.") };
  return { ok: true, holidays: data };
}

export async function deleteHoliday(id) {
  const { data, error } = await supabase.rpc("ep_admin_delete_holiday", { p_id: id });
  if (error) return { ok: false, message: friendly(error, "Could not delete the holiday. Please try again.") };
  return { ok: true, holidays: data };
}

/** Days as text: 1 -> "1", 1.5 -> "1.5". */
export const num = (n) => (n == null ? "—" : String(Number(n)));

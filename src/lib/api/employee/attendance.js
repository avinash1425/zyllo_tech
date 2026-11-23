// Employee Portal: who am I, punch in, punch out, attendance by day.
// All writes go through security-definer RPCs (migration 229); the database
// sets the times and refuses a second punch in / a punch out without punch in.
// Late / half day / leave / present are worked out in the database (migration 230).
import { supabase } from "@/lib/supabase/client";

function friendly(error, fallback) {
  const msg = error?.message ?? "";
  if (/already punched in|not punched in|not an active employee/i.test(msg)) return msg;
  return fallback;
}

/** null when the signed-in account is not an active employee. */
export async function getMe() {
  const { data, error } = await supabase.rpc("ep_me");
  if (error) throw error;
  return data ?? null;
}

export async function punchIn() {
  const { data, error } = await supabase.rpc("ep_punch_in");
  if (error) return { ok: false, message: friendly(error, "Could not punch in. Please try again.") };
  return { ok: true, session: data };
}

export async function punchOut() {
  const { data, error } = await supabase.rpc("ep_punch_out");
  if (error) return { ok: false, message: friendly(error, "Could not punch out. Please try again.") };
  return { ok: true, session: data };
}

/** Per-day attendance between two "YYYY-MM-DD" dates (max 62 days), newest first. */
export async function getMyAttendance(fromIso, toIso) {
  const { data, error } = await supabase.rpc("ep_my_attendance", { p_from: fromIso, p_to: toIso });
  if (error) throw error;
  return data ?? [];
}

/** The day the employee record was created ("YYYY-MM-DD", India time) — days before it are not "absent". */
export async function getMyStartDate(employeeId) {
  const { data, error } = await supabase.from("ep_employees").select("created_at").eq("id", employeeId).maybeSingle();
  if (error || !data) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(data.created_at));
}

/** Every punch in / punch out of one day (oldest first). Own rows only (RLS, migration 229). */
export async function getMySessions(employeeId, dateIso) {
  const { data, error } = await supabase
    .from("ep_attendance")
    .select("id, punch_in_at, punch_out_at, auto_punched_out")
    .eq("employee_id", employeeId)
    .eq("work_date", dateIso)
    .order("punch_in_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Every punch in / punch out between two dates, grouped: Map("YYYY-MM-DD" -> sessions oldest first). */
export async function getMySessionsByDay(employeeId, fromIso, toIso) {
  const { data, error } = await supabase
    .from("ep_attendance")
    .select("id, work_date, punch_in_at, punch_out_at, auto_punched_out")
    .eq("employee_id", employeeId)
    .gte("work_date", fromIso)
    .lte("work_date", toIso)
    .order("punch_in_at", { ascending: true });
  if (error) throw error;
  const byDay = new Map();
  for (const s of data ?? []) {
    if (!byDay.has(s.work_date)) byDay.set(s.work_date, []);
    byDay.get(s.work_date).push(s);
  }
  return byDay;
}

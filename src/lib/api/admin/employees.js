// Admin: Employee Management for the Employee Portal (migration 239).
// All reads and writes go through admin-only RPCs that check public.is_admin().
import { supabase } from "@/lib/supabase/client";
import { passwordProblem } from "@/lib/api/employee/password";

export const WORK_FIELDS = [
  "full_name",
  "department",
  "designation",
  "reporting_manager_id",
  "reporting_manager_name",
  "date_of_joining",
  "employment_type",
  "work_location",
];

function friendly(error, fallback) {
  const msg = error?.message ?? "";
  if (
    /Only admins|not found|cannot report to themselves|make a loop|active employee as reporting|Name cannot be empty/i.test(msg)
  ) {
    return msg;
  }
  if (/department/.test(msg)) return "Department must be 1–80 characters.";
  if (/designation/.test(msg)) return "Designation must be 1–80 characters.";
  if (/work_location/.test(msg)) return "Work location must be 1–120 characters.";
  if (/full_name/.test(msg)) return "Name must be 1–120 characters.";
  if (/employment_type/.test(msg)) return "Choose an employment type.";
  return fallback;
}

export async function listEmployees() {
  const { data, error } = await supabase.rpc("ep_admin_employees");
  if (error) throw error;
  return data ?? [];
}

export async function getEmployee(id) {
  const { data, error } = await supabase.rpc("ep_admin_employee", { p_id: id });
  if (error) throw error;
  return data;
}

/** Same limits as the database, so the admin sees a clear message first. */
export function validateWork(form) {
  const errors = {};
  const v = (k) => String(form[k] ?? "").trim();
  if (!v("full_name")) errors.full_name = "Name is required.";
  else if (v("full_name").length > 120) errors.full_name = "Keep it under 120 characters.";
  if (v("department").length > 80) errors.department = "Keep it under 80 characters.";
  if (v("designation").length > 80) errors.designation = "Keep it under 80 characters.";
  if (v("work_location").length > 120) errors.work_location = "Keep it under 120 characters.";
  if (v("date_of_joining") && Number.isNaN(new Date(`${v("date_of_joining")}T00:00:00`).getTime())) {
    errors.date_of_joining = "Enter a valid date.";
  }
  return errors;
}

export async function updateEmployeeWork(id, form) {
  const p = Object.fromEntries(WORK_FIELDS.map((k) => [k, String(form[k] ?? "").trim()]));
  const { data, error } = await supabase.rpc("ep_admin_update_employee", { p_id: id, p });
  if (error) return { ok: false, message: friendly(error, "Could not save the work details. Please try again.") };
  return { ok: true, employee: data };
}

const CODE = /^[A-Z0-9][A-Z0-9-]{1,29}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Next Employee ID after the most recently added one (e.g. ZT-007 -> ZT-008). */
export function suggestEmployeeCode(employees) {
  const latest = [...(employees ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const m = latest?.employee_code?.match(/^(.*?)(\d+)$/);
  if (!m) return "";
  const taken = new Set(employees.map((e) => e.employee_code));
  let n = Number(m[2]);
  let code;
  do {
    n += 1;
    code = m[1] + String(n).padStart(m[2].length, "0");
  } while (taken.has(code));
  return code;
}

/**
 * 10-character temporary password with at least 1 uppercase, 1 lowercase, 1 number and
 * 1 special character (the portal password rules), no look-alike characters.
 */
export function generatePassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "@#$%!*"];
  const all = sets.join("");
  const rnd = (n) => {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    return b[0] % n;
  };
  const chars = sets.map((s) => s[rnd(s.length)]);
  while (chars.length < 10) chars.push(all[rnd(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = rnd(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function validateNewEmployee(form) {
  const errors = validateWork(form);
  const v = (k) => String(form[k] ?? "").trim();
  if (!CODE.test(v("employee_code").toUpperCase())) errors.employee_code = "Use 2–30 letters, numbers or dashes (e.g. ZT-001).";
  if (!EMAIL.test(v("email")) || v("email").length > 254) errors.email = "Enter a valid email address.";
  const problem = passwordProblem(form.password);
  if (problem) errors.password = problem;
  return errors;
}

export async function createEmployee(form) {
  const p = Object.fromEntries(
    ["employee_code", "full_name", "email", ...WORK_FIELDS.filter((k) => k !== "full_name")]
      .map((k) => [k, String(form[k] ?? "").trim()])
      .filter(([, val]) => val !== ""),
  );
  p.employee_code = p.employee_code?.toUpperCase();
  p.password = String(form.password ?? "");
  const { data, error } = await supabase.rpc("ep_admin_create_employee", { p });
  if (error) {
    const msg = error.message ?? "";
    if (/Employee ID|already|admin account|Temporary password|valid work email|Name is required/i.test(msg)) {
      return { ok: false, message: msg };
    }
    return { ok: false, message: friendly(error, "Could not add the employee. Please try again.") };
  }
  return { ok: true, employee: data };
}

export async function setEmployeeAccess(id, active) {
  const { data, error } = await supabase.rpc("ep_admin_set_employee_access", { p_id: id, p_active: active });
  if (error) return { ok: false, message: friendly(error, "Could not change portal access. Please try again.") };
  return { ok: true, employee: data };
}

/** Admin → Employee Portal dashboard: today, pending actions, upcoming (migration 247). */
export async function getPortalDashboard() {
  const { data, error } = await supabase.rpc("ep_admin_portal_dashboard");
  if (error) throw error;
  return data;
}

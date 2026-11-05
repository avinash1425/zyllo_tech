// Benefits: plan catalogue (direct writes with benefits.manage) and
// enrollments (RPC-only writes; readable by the employee, benefits.view and
// benefits.manage — managers never see team benefits).
import { from, rpc, run } from "./client";

export const BENEFIT_CATEGORIES = ["insurance", "health", "retirement", "allowance", "wellness", "leave", "other"];
export const ENROLLMENT_STATUSES = ["active", "suspended", "ended", "cancelled"];
export const COVERAGE_LEVELS = [
  { value: "employee", label: "Employee only" }, { value: "employee_spouse", label: "Employee + spouse" },
  { value: "employee_children", label: "Employee + children" }, { value: "family", label: "Family" },
];
export const FREQUENCIES = ["monthly", "annual", "one_time", "none"];

const EMP = "id, employee_code, first_name, last_name, display_name, employment_type, status";

export async function listBenefitTypes({ activeOnly = false } = {}) {
  let q = from("hr_benefit_types").select("*").order("category").order("name");
  if (activeOnly) q = q.eq("active", true);
  return run(q);
}

export async function listEnrollments({ status = "live", benefitType = "", employee = "" } = {}) {
  let q = from("hr_benefit_enrollments").select(`*, benefit:hr_benefit_types(id, code, name, category),
    employee:hr_employees!hr_benefit_enrollments_employee_id_fkey(${EMP})`).limit(2000);
  if (status === "live") q = q.in("status", ["active", "suspended"]);
  else if (status) q = q.eq("status", status);
  if (benefitType) q = q.eq("benefit_type_id", benefitType);
  if (employee) q = q.eq("employee_id", employee);
  return run(q.order("start_date", { ascending: false }));
}

export async function listMyEnrollments(employeeId) {
  return run(from("hr_benefit_enrollments").select("*, benefit:hr_benefit_types(id, code, name, category, description, provider)")
    .eq("employee_id", employeeId).order("start_date", { ascending: false }));
}

export const benefitEligibility = (employeeId, on) => rpc("hr_benefit_eligibility", { p_employee: employeeId, p_on: on || null });

export const enrollBenefit = (v) => rpc("hr_enroll_benefit", {
  p_employee: v.employee_id, p_benefit_type: v.benefit_type_id, p_start_date: v.start_date || null,
  p_coverage_level: v.coverage_level || "employee", p_dependants: Number(v.dependants || 0),
  p_policy_number: v.policy_number || null, p_notes: v.notes || null, p_override_reason: v.override_reason || null,
  p_employer_contribution: v.employer_contribution === "" || v.employer_contribution == null ? null : Number(v.employer_contribution),
  p_employee_contribution: v.employee_contribution === "" || v.employee_contribution == null ? null : Number(v.employee_contribution),
});

export const setEnrollmentStatus = (id, status, endDate, reason) =>
  rpc("hr_set_benefit_enrollment_status", { p_enrollment: id, p_status: status, p_end_date: endDate || null, p_reason: reason || null });

// Organisation reference data (departments, designations, locations, shifts,
// employment types) + employee pickers. RLS decides what each user can read.
import { from, run, useHrQuery, fullName } from "./client";

export async function loadOrg() {
  const [dep, des, loc, sh, et, le, gr] = await Promise.all([
    run(from("hr_departments").select("id, code, name, parent_id, head_employee_id, legal_entity_id, unit_type, active").order("name")),
    run(from("hr_designations").select("id, name, department_id, level, active").order("name")),
    run(from("hr_locations").select("id, name, city, address, timezone, active").order("name")),
    run(from("hr_shifts").select("id, name, start_time, end_time, grace_minutes, break_minutes, early_leave_grace_minutes, overtime_after_minutes, working_days, is_default, active").order("name")),
    run(from("hr_employment_types").select("code, name, probation_months, is_intern, active, sort_order").order("sort_order")),
    run(from("hr_legal_entities").select("id, code, name, legal_name, country, active").order("name")),
    run(from("hr_grades").select("id, code, name, level, active").order("level", { nullsFirst: false }).order("name")),
  ]);
  const error = dep.error || des.error || loc.error || sh.error || et.error || le.error || gr.error;
  return {
    error,
    data: error ? null : { departments: dep.data, designations: des.data, locations: loc.data, shifts: sh.data, employmentTypes: et.data, legalEntities: le.data, grades: gr.data },
  };
}

export function useOrg() {
  return useHrQuery(loadOrg, []);
}

export const toOptions = (rows, label = "name", value = "id", { activeOnly = true } = {}) =>
  (rows ?? []).filter((r) => !activeOnly || r.active !== false).map((r) => ({ value: r[value], label: typeof label === "function" ? label(r) : r[label] }));

/** Employees the caller may see, for pickers (manager, assignee…). */
export async function loadEmployeeOptions({ includeInactive = false } = {}) {
  let q = from("hr_employees").select("id, employee_code, first_name, last_name, display_name, status").order("first_name").limit(1000);
  if (!includeInactive) q = q.not("status", "in", "(exited,archived)");
  const res = await run(q);
  return { ...res, data: res.data?.map((e) => ({ value: e.id, label: `${fullName(e)} (${e.employee_code})`, row: e })) ?? null };
}

export function useEmployeeOptions(opts) {
  return useHrQuery(() => loadEmployeeOptions(opts), [opts?.includeInactive]);
}

// Pure Payroll helpers (no imports, so they can be unit tested with node --test).
// - Employee identity: payroll users without employees.view cannot read other
//   employees through hr_employees RLS, so embedded `employee` objects come back
//   null. hr_payroll_employee_identities (migration 204) returns name + code for
//   employees in payroll data; these helpers merge that into rows and pickers.
// - Statutory rule form validation (mirrors the server checks in migration 170).

const name = (e) => (e ? (e.display_name || `${e.first_name ?? ""} ${e.last_name ?? ""}`).trim() : "");
const INACTIVE = new Set(["exited", "archived"]);

/** Unique employee ids of rows whose embedded employee is missing. */
export function missingEmployeeIds(rows) {
  const ids = new Set();
  for (const r of rows ?? []) if (r && r.employee_id && !r.employee) ids.add(r.employee_id);
  return [...ids];
}

/** Rows with a missing `employee` filled from identities ({ id, employee_code, first_name, … }). Existing values win. */
export function mergeEmployeeIdentities(rows, identities) {
  const byId = new Map((identities ?? []).filter((i) => i && i.id).map((i) => [i.id, i]));
  if (!byId.size) return rows;
  return (rows ?? []).map((r) => {
    if (!r || r.employee || !r.employee_id || !byId.has(r.employee_id)) return r;
    const i = byId.get(r.employee_id);
    return { ...r, employee: { id: i.id, employee_code: i.employee_code, first_name: i.first_name, last_name: i.last_name, display_name: i.display_name, department_id: i.department_id ?? null } };
  });
}

/** Picker options ({ value, label, row }) from identities, same shape as loadEmployeeOptions. */
export function identityOptions(identities, { includeInactive = false } = {}) {
  return (identities ?? [])
    .filter((i) => i && i.id && (includeInactive || !INACTIVE.has(i.status)))
    .map((i) => ({ value: i.id, label: `${name(i)} (${i.employee_code})`, row: i }));
}

/** Union of option lists by value (first list wins), sorted by label. */
export function mergeOptions(...lists) {
  const seen = new Map();
  for (const list of lists) for (const o of list ?? []) if (o && o.value && !seen.has(o.value)) seen.set(o.value, o);
  return [...seen.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

/** Pre-fill an "add" form's employee from a list filter, but never with the signed-in user. */
export const prefillEmployee = (filter, me) => (filter && filter !== me ? filter : "");

// ------------------------------------------------------------ statutory rule form
const blank = (v) => v === "" || v === null || v === undefined;
const num = (v) => (blank(v) ? null : Number(v));
const bad = (v, { min = 0, max = Infinity } = {}) => { const n = num(v); return n !== null && (!Number.isFinite(n) || n < min || n > max); };

/**
 * Client-side checks for a statutory rule draft. Returns an error message or null.
 * Only validates what was entered (ranges, slab order) plus the wage base the
 * server needs before the rule can be submitted. No rate or slab is suggested.
 */
export function validateStatutoryRule(v) {
  if (!/^[A-Za-z][A-Za-z0-9_]{1,29}$/.test(v.code ?? "")) return "Code: 2–30 letters, digits or _.";
  if ((v.name ?? "").trim().length < 2) return "Enter a name.";
  if (!blank(v.state_code) && !/^[A-Z0-9]{2,3}$/.test(String(v.state_code).trim().toUpperCase())) return "State / jurisdiction code: 2–3 letters or digits (e.g. AP).";
  if (!v.effective_from) return "Choose the effective-from date.";
  if (v.effective_to && v.effective_to < v.effective_from) return "Effective-to must be after effective-from.";
  const base = v.wage_base_components ?? [];
  if (v.calc_method === "percent_of_wage") {
    if (bad(v.employee_rate, { max: 100 }) || bad(v.employer_rate, { max: 100 })) return "Rates must be between 0 and 100 %.";
    if (bad(v.wage_ceiling)) return "The wage ceiling must be a number of 0 or more.";
    if (!base.length) return "Choose the earning components that make up the wage base.";
  }
  if (v.calc_method === "fixed" && (bad(v.employee_amount) || bad(v.employer_amount))) return "Fixed amounts must be numbers of 0 or more.";
  if (bad(v.eligibility_wage_max)) return "The eligibility wage limit must be a number of 0 or more.";
  if (v.calc_method === "slab") {
    const slabs = v.slabs ?? [];
    if (slabs.some((s) => s.from == null)) return "Every slab needs a 'from' amount.";
    if (slabs.some((s) => bad(s.from) || bad(s.to) || bad(s.employee_amount) || bad(s.employer_amount))) return "Slab amounts must be numbers of 0 or more.";
    if (slabs.some((s) => s.to != null && Number(s.to) < Number(s.from))) return "A slab's 'to' amount cannot be below its 'from' amount.";
    const sorted = [...slabs].sort((a, b) => Number(a.from) - Number(b.from));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      if (prev.to == null) return "Only the highest slab can be open-ended ('to' blank).";
      if (Number(sorted[i].from) < Number(prev.to)) return "Slabs overlap; each slab must start at or after the previous slab's 'to' amount.";
    }
    if (v.eligibility_basis !== "gross" && !base.length) return "Slabs are looked up on the wage base; choose its components (or set the basis to monthly gross).";
  }
  return null;
}

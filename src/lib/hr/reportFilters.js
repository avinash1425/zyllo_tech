// Module 12 — report filter helpers (pure; shared by the HR and employee pages
// and the Node tests). The server validates every filter again.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPE = /^[a-z0-9_]{1,40}$/;
const FILTER_KEYS = ["from", "to", "company", "department", "manager", "employee", "type", "location", "status"];

export function todayIso() { return new Date().toLocaleDateString("en-CA"); }
export function monthStartIso() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("en-CA"); }
export function defaultFilters() {
  return { from: monthStartIso(), to: todayIso(), company: "", department: "", manager: "", employee: "", type: "", location: "", status: "" };
}

function validDate(s) {
  if (!DATE.test(s ?? "")) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Parse URLSearchParams into filters; invalid values fall back to defaults (never trusted further). */
export function filtersFromParams(params) {
  const f = defaultFilters();
  const get = (k) => params.get(k) ?? "";
  if (validDate(get("from"))) f.from = get("from");
  if (validDate(get("to"))) f.to = get("to");
  for (const k of ["company", "department", "manager", "employee", "location"]) if (UUID.test(get(k))) f[k] = get(k);
  if (TYPE.test(get("type"))) f.type = get("type");
  if (/^[a-z_]{1,40}$/.test(get("status"))) f.status = get("status");
  return f;
}

/** Serialise filters (+ category / report) into search params; defaults are omitted. */
export function filtersToParams(f, extra = {}) {
  const d = defaultFilters();
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  for (const k of FILTER_KEYS) if (f[k] && f[k] !== d[k]) p.set(k, f[k]);
  return p;
}

/** Client-side validation mirror of hr_private.ra_validate(). Returns a message or null. */
export function validateFilters(f) {
  if (!validDate(f.from) || !validDate(f.to)) return "Choose a valid start and end date.";
  if (f.to < f.from) return "The end date is before the start date.";
  const days = (new Date(`${f.to}T00:00:00Z`) - new Date(`${f.from}T00:00:00Z`)) / 86400000;
  if (days > 366) return "Choose a range of at most one year.";
  for (const k of ["company", "department", "manager", "employee", "location"]) if (f[k] && !UUID.test(f[k])) return "One of the filters is not valid.";
  if (f.type && !TYPE.test(f.type)) return "Unknown employment type.";
  return null;
}

/** Human-readable filter list for export headers and on-screen labels. */
export function describeFilters(f, { org, employees } = {}) {
  const name = (rows, id, key = "id", label = "name") => rows?.find((r) => r[key] === id)?.[label] ?? id;
  const empName = (id) => employees?.find((e) => e.value === id)?.label ?? id;
  const out = [];
  if (f.company) out.push({ label: "Company", value: name(org?.legalEntities, f.company) });
  if (f.department) out.push({ label: "Department", value: name(org?.departments, f.department) });
  if (f.location) out.push({ label: "Location", value: name(org?.locations, f.location) });
  if (f.type) out.push({ label: "Employment type", value: name(org?.employmentTypes, f.type, "code") });
  if (f.manager) out.push({ label: "Manager", value: empName(f.manager) });
  if (f.employee) out.push({ label: "Employee", value: empName(f.employee) });
  if (f.status) out.push({ label: "Status", value: f.status.replace(/_/g, " ") });
  return out;
}

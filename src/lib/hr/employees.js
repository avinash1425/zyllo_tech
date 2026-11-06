// Employee Management data access (formerly "Employee Master"; same tables,
// RPCs and routes). Direct table writes are limited by RLS to users holding
// employees.create / employees.edit; account linking, portal access, roles and
// exits go through dedicated RPCs / Edge Functions. Assignment changes
// (promotion, transfer, manager, lifecycle status) go through
// hr_change_employee_assignment so each one carries a reason, an effective
// date and the acting user (migration 118).
import { from, rpc, run, invokeFunction } from "./client";

export const EMPLOYEE_STATUSES = ["onboarding", "probation", "active", "notice_period", "suspended", "exited", "archived"];
// Statuses HR may set directly (exit happens via Exit Management; archive needs employees.archive).
export const EDITABLE_STATUSES = ["onboarding", "probation", "active", "suspended", "archived"];

const LIST_COLUMNS = `id, employee_code, first_name, last_name, display_name, company_email, status, employment_type,
  joining_date, probation_end_date, portal_access, user_id, activated_at, login_id, password_change_required, manager_id, legal_entity_id, grade_id, work_location_id,
  work_arrangement, deployment_status, deployment_client, deployment_project_code, contract_type, notice_period_days,
  legal_entity:hr_legal_entities(id, name, code), grade:hr_grades(id, name), location:hr_locations(id, name),
  department:hr_departments!hr_employees_department_id_fkey(id, name, code),
  designation:hr_designations(id, name),
  manager:hr_employees!manager_id(id, employee_code, first_name, last_name, display_name)`;

/** Server-side filtered + paginated list. */
// Status groups used by the HR Dashboard cards (same definitions as hr_dashboard()).
export const ACTIVE_STATUSES = ["active", "probation", "notice_period"];
export const INACTIVE_CURRENT_STATUSES = ["onboarding", "suspended"];

export async function listEmployees({ search = "", department = "", designation = "", status = "", type = "", manager = "", legalEntity = "", location = "", grade = "", joinedFrom = "", joinedTo = "", page = 1, pageSize = 25, all = false } = {}) {
  let q = from("hr_employees").select(LIST_COLUMNS, { count: "exact" });
  const s = search.trim().replace(/[%,()]/g, " ");
  if (s) q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,display_name.ilike.%${s}%,employee_code.ilike.%${s}%,company_email.ilike.%${s}%`);
  if (department) q = q.eq("department_id", department);
  if (designation) q = q.eq("designation_id", designation);
  if (status === "current") q = q.not("status", "in", "(exited,archived)");
  else if (status === "working") q = q.in("status", ACTIVE_STATUSES);
  else if (status === "inactive") q = q.in("status", INACTIVE_CURRENT_STATUSES);
  else if (status) q = q.eq("status", status);
  if (joinedFrom) q = q.gte("joining_date", joinedFrom);
  if (joinedTo) q = q.lte("joining_date", joinedTo);
  if (type) q = q.eq("employment_type", type);
  if (manager) q = q.eq("manager_id", manager);
  if (legalEntity === "none") q = q.is("legal_entity_id", null);
  else if (legalEntity) q = q.eq("legal_entity_id", legalEntity);
  if (location) q = q.eq("work_location_id", location);
  if (grade) q = q.eq("grade_id", grade);
  q = q.order("first_name").order("last_name");
  if (!all) q = q.range((page - 1) * pageSize, page * pageSize - 1);
  else q = q.limit(5000);
  return run(q);
}

export async function getEmployee(id) {
  return run(from("hr_employees").select(`*, department:hr_departments!hr_employees_department_id_fkey(id, name, code),
    designation:hr_designations(id, name), location:hr_locations(id, name), shift:hr_shifts(id, name, start_time, end_time),
    legal_entity:hr_legal_entities(id, name, code, country), grade:hr_grades(id, name, code),
    source_department:hr_departments!hr_employees_source_department_id_fkey(id, name),
    manager:hr_employees!manager_id(id, employee_code, first_name, last_name, display_name)`).eq("id", id).maybeSingle());
}

/** PII row; RLS returns nothing unless self or employees.view_sensitive. */
export async function getEmployeePrivate(id) {
  return run(from("hr_employee_private").select("*").eq("employee_id", id).maybeSingle());
}

export async function getEmployeeHistory(id) {
  return run(from("hr_employee_history").select("id, change_type, old_value, new_value, effective_date, note, changed_at").eq("employee_id", id).order("changed_at", { ascending: false }).limit(200));
}

// ---------------------------------------------------------------- Employee Management (118)
export const CHANGE_CATEGORIES = [
  { value: "promotion", label: "Promotion", fields: ["designation_id", "grade_id"] },
  { value: "demotion", label: "Demotion", fields: ["designation_id", "grade_id"] },
  { value: "designation_change", label: "Designation change", fields: ["designation_id", "grade_id"] },
  { value: "transfer", label: "Department / company transfer", fields: ["legal_entity_id", "department_id", "designation_id", "manager_id"] },
  { value: "manager_change", label: "Reporting manager change", fields: ["manager_id"] },
  { value: "probation_start", label: "Start probation", fields: ["status"] },
  { value: "confirmation", label: "Confirmation (end of probation)", fields: ["status"] },
  { value: "status_change", label: "Status change (suspend / archive)", fields: ["status"] },
  { value: "reactivation", label: "Reactivation", fields: ["status"] },
  { value: "correction", label: "Correction of a recording error", fields: ["legal_entity_id", "department_id", "designation_id", "grade_id", "manager_id"] },
];
export const changeCategoryLabel = (v) => CHANGE_CATEGORIES.find((c) => c.value === v)?.label ?? title(String(v ?? ""));

/** Reasoned, effective-dated assignment change. Only changed values are sent. */
export function changeAssignment(employeeId, { category, effectiveDate, reason, department_id, designation_id, grade_id, legal_entity_id, manager_id, clearManager, status }) {
  return rpc("hr_change_employee_assignment", {
    p_employee: employeeId, p_category: category, p_effective_date: effectiveDate, p_reason: reason?.trim() ?? "",
    p_department: department_id || null, p_designation: designation_id || null, p_grade: grade_id || null,
    p_legal_entity: legal_entity_id || null, p_manager: manager_id || null, p_clear_manager: Boolean(clearManager), p_status: status || null,
  });
}
export const getEmployeeTimeline = (id) => rpc("hr_employee_timeline", { p_employee: id });
export const getEmployeeSummary = ({ department = "", designation = "", manager = "" } = {}) =>
  rpc("hr_employee_summary", { p_department: department || null, p_designation: designation || null, p_manager: manager || null });
export async function listDirectReports(managerId) {
  return run(from("hr_employees").select("id, employee_code, first_name, last_name, display_name, status, company_email, designation:hr_designations(id, name), department:hr_departments!hr_employees_department_id_fkey(id, name)")
    .eq("manager_id", managerId).not("status", "in", "(exited,archived)").order("first_name").limit(500));
}
export async function getManagerCard(managerId) {
  if (!managerId) return { data: null, error: null };
  return run(from("hr_employees").select("id, employee_code, first_name, last_name, display_name, company_email, status, photo_path, manager_id, designation:hr_designations(id, name), department:hr_departments!hr_employees_department_id_fkey(id, name)")
    .eq("id", managerId).maybeSingle());
}

export async function getEmployeeRoles(userId) {
  if (!userId) return { data: [], error: null };
  return run(from("hr_user_roles").select("role_key, granted_at").eq("user_id", userId));
}

export async function listRoles() {
  return run(from("hr_roles").select("key, name, description, is_system").order("name"));
}

export const EMP_FIELDS = ["first_name", "last_name", "display_name", "name_arabic", "company_email", "legal_entity_id", "department_id", "source_department_id",
  "designation_id", "grade_id", "manager_id", "employment_type", "joining_date", "probation_end_date", "work_location_id", "work_arrangement", "shift_id",
  "contract_type", "contract_start_date", "contract_end_date", "notice_period_days",
  "deployment_status", "deployment_client", "deployment_project_code", "deployment_start_date", "deployment_end_date", "status"];
export const PRIVATE_FIELDS = ["date_of_birth", "gender", "nationality", "marital_status", "personal_email", "phone", "address_line1", "address_line2", "city", "state",
  "postal_code", "country", "emergency_contact_name", "emergency_contact_relation", "emergency_contact_phone"];
export const IDENTITY_FIELDS = ["national_id_type", "national_id_number", "national_id_expiry", "passport_number", "passport_country", "passport_issue_date",
  "passport_expiry", "work_permit_type", "work_permit_number", "work_permit_expiry", "visa_type", "visa_number", "visa_expiry"];
export const PAYROLL_ID_FIELDS = ["payment_mode", "tax_id", "social_security_number", "pension_number", "health_insurance_number", "wps_person_id", "payroll_code"];

const clean = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, typeof obj[k] === "string" ? (obj[k].trim() || null) : obj[k]]));

export async function createEmployee(values, { withPrivate = false } = {}) {
  const body = clean(values, EMP_FIELDS.filter((k) => k !== "status"));
  if (body.notice_period_days != null) body.notice_period_days = Number(body.notice_period_days);
  const res = await run(from("hr_employees").insert(body).select("id, employee_code").single());
  if (res.error || !withPrivate) return res;
  const priv = clean(values, PRIVATE_FIELDS);
  if (Object.values(priv).some((v) => v !== null && v !== undefined)) {
    const p = await run(from("hr_employee_private").insert({ employee_id: res.data.id, ...priv }));
    if (p.error) return { data: res.data, error: `Employee ${res.data.employee_code} was created, but personal details could not be saved: ${p.error}` };
  }
  return res;
}

export async function updateEmployee(id, values) {
  const body = clean(values, EMP_FIELDS);
  if (body.notice_period_days != null) body.notice_period_days = Number(body.notice_period_days);
  return run(from("hr_employees").update(body).eq("id", id).select("id").single());
}

export async function upsertEmployeePrivate(id, values) {
  return run(from("hr_employee_private").upsert({ employee_id: id, ...clean(values, PRIVATE_FIELDS) }).select("employee_id").single());
}

export const inviteEmployee = (employeeId) => invokeFunction("hr-invite-employee", { employee_id: employeeId });
export const setPortalAccess = (employeeId, enabled) => rpc("hr_set_portal_access", { p_employee: employeeId, p_enabled: enabled });
// Employee ID sign-in (Edge Function hr-employee-login; needs employees.manage_login).
// create / reset return { login_id, temporary_password } — show it once, never store it.
export const manageEmployeeLogin = (employeeId, action) => invokeFunction("hr-employee-login", { employee_id: employeeId, action });
export const createEmployeeLogin = (employeeId) => manageEmployeeLogin(employeeId, "create");
export const resetEmployeePassword = (employeeId) => manageEmployeeLogin(employeeId, "reset");
export const setEmployeeLoginActive = (employeeId, enabled) => manageEmployeeLogin(employeeId, enabled ? "activate" : "deactivate");

/** Portal / sign-in state label for lists and the profile. */
export function loginState(e) {
  if (!e?.user_id) return { label: "no login", tone: "slate" };
  if (!e.portal_access) return { label: "disabled", tone: "red" };
  if (e.login_id && e.password_change_required) return { label: "temporary password", tone: "amber" };
  if (e.login_id) return { label: "active", tone: "green" };
  return { label: e.activated_at ? "active (email)" : "invited (email)", tone: "green" };
}
export const assignRole = (userId, role) => rpc("hr_assign_role", { p_user: userId, p_role: role });
export const revokeRole = (userId, role) => rpc("hr_revoke_role", { p_user: userId, p_role: role });
export const importEmployees = (rows, dryRun) => rpc("hr_import_employees", { p_rows: rows, p_dry_run: dryRun });

// ---------------------------------------------------------------- identity (employees.view_identity)
export async function getEmployeeIdentity(id) {
  return run(from("hr_employee_identity").select("*").eq("employee_id", id).maybeSingle());
}
export async function saveEmployeeIdentity(id, values) {
  return run(from("hr_employee_identity").upsert({ employee_id: id, ...clean(values, IDENTITY_FIELDS) }).select("employee_id").single());
}
export const getIdentityStatus = (id) => rpc("hr_employee_identity_status", { p_employee: id });
export const listExpiringIdentity = (days = 60) => rpc("hr_expiring_identity_documents", { p_days: days });
export async function listIdentityRequirements() {
  return run(from("hr_identity_requirements").select("*").order("country"));
}

// ---------------------------------------------------------------- HR-only remarks (employees.view_sensitive)
export async function getEmployeeRemarks(id) {
  return run(from("hr_employee_confidential").select("remarks, updated_at").eq("employee_id", id).maybeSingle());
}
export async function saveEmployeeRemarks(id, remarks) {
  return run(from("hr_employee_confidential").upsert({ employee_id: id, remarks: remarks?.trim() || null }).select("employee_id").single());
}

// ---------------------------------------------------------------- banking & payroll identifiers (payroll only)
export async function getPayrollIdentifiers(id) {
  return run(from("hr_payroll_employee_identifiers").select("*").eq("employee_id", id).maybeSingle());
}
export async function savePayrollIdentifiers(id, values) {
  const body = clean(values, PAYROLL_ID_FIELDS);
  if (!body.payment_mode) body.payment_mode = "bank_transfer";
  return run(from("hr_payroll_employee_identifiers").upsert({ employee_id: id, ...body }).select("employee_id").single());
}
export async function listBankAccounts(id) {
  return run(from("hr_employee_bank_accounts").select("id, bank_name, account_holder, account_number, ifsc, iban, swift_code, branch, is_primary, verified, active, updated_at")
    .eq("employee_id", id).order("is_primary", { ascending: false }).order("created_at"));
}
const BANK_FIELDS = ["bank_name", "account_holder", "account_number", "ifsc", "iban", "swift_code", "branch", "is_primary", "active"];
export async function saveBankAccount(employeeId, values) {
  const body = clean(values, BANK_FIELDS);
  if (body.ifsc) body.ifsc = body.ifsc.toUpperCase();
  if (body.iban) body.iban = body.iban.replace(/\s+/g, "").toUpperCase();
  if (body.swift_code) body.swift_code = body.swift_code.toUpperCase();
  if (body.account_number) body.account_number = body.account_number.replace(/\s+/g, "");
  if (values.id) return run(from("hr_employee_bank_accounts").update(body).eq("id", values.id).select("id").single());
  return run(from("hr_employee_bank_accounts").insert({ employee_id: employeeId, ...body }).select("id").single());
}

// ---------------------------------------------------------------- exit (read from Exit Management)
export async function getLatestExit(id) {
  return run(from("hr_exits").select("id, exit_type, status, reason, resignation_date, proposed_last_working_day, approved_last_working_day, closed_at, created_at")
    .eq("employee_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle());
}
export async function getExitClearance(exitId) {
  if (!exitId) return { data: [], error: null };
  return run(from("hr_exit_clearance_items").select("id, status").eq("exit_id", exitId));
}

// ---------------------------------------------------------------- completeness
// Same field list as hr_private.completeness_rows() on the server.
export function completeness(e, priv, identity, { sensitive = false, identityAccess = false } = {}) {
  const checks = [
    ["Contact", "Work email", e?.company_email], ["Employment", "Company / legal entity", e?.legal_entity_id], ["Employment", "Department", e?.department_id],
    ["Employment", "Position / designation", e?.designation_id], ["Employment", "Grade / band", e?.grade_id], ["Employment", "Reporting manager", e?.manager_id],
    ["Employment", "Work location", e?.work_location_id], ["Employment", "Employment type", e?.employment_type], ["Employment", "WFO / WFH / hybrid", e?.work_arrangement],
    ["Employment", "Joining date", e?.joining_date], ["Contract", "Contract type", e?.contract_type], ["Contract", "Notice period", e?.notice_period_days],
    ...(sensitive ? [["Personal", "Date of birth", priv?.date_of_birth], ["Personal", "Gender", priv?.gender], ["Personal", "Nationality", priv?.nationality],
      ["Contact", "Mobile number", priv?.phone], ["Contact", "Emergency contact", priv?.emergency_contact_phone]] : []),
    ...(identityAccess ? [["Identification", "National ID or passport", identity?.national_id_number || identity?.passport_number]] : []),
  ];
  const missing = checks.filter(([, , v]) => v === null || v === undefined || v === "").map(([g, l]) => ({ group: g, label: l }));
  const total = checks.length;
  return { total, filled: total - missing.length, pct: total ? Math.round(((total - missing.length) / total) * 100) : 0, missing };
}

const title = (v) => v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const WORK_ARRANGEMENTS = [{ value: "office", label: "Office (WFO)" }, { value: "remote", label: "Remote (WFH)" }, { value: "hybrid", label: "Hybrid" }];
export const CONTRACT_TYPES = ["permanent", "fixed_term", "probationary", "internship", "consultancy", "other"].map((v) => ({ value: v, label: title(v) }));
export const DEPLOYMENT_STATUSES = [{ value: "not_deployed", label: "Not deployed" }, { value: "deployed", label: "Deployed" }, { value: "bench", label: "On bench" }];
export const MARITAL_STATUSES = ["single", "married", "divorced", "widowed", "separated", "prefer_not_to_say"].map((v) => ({ value: v, label: title(v) }));
export const GENDERS = [{ value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "non_binary", label: "Non-binary" }, { value: "other", label: "Other" }, { value: "prefer_not_to_say", label: "Prefer not to say" }];
export const PAYMENT_MODES = [{ value: "bank_transfer", label: "Bank transfer" }, { value: "wps", label: "WPS" }, { value: "cheque", label: "Cheque" }, { value: "cash", label: "Cash" }];
export const arrangementLabel = (v) => WORK_ARRANGEMENTS.find((x) => x.value === v)?.label ?? null;
export const labelOf = (list, v) => list.find((x) => x.value === v)?.label ?? (v ? title(String(v)) : null);

// ---------------------------------------------------------------- document audit (documents.view / documents.manage via RLS)
/** Recent view/download events for the given documents, with the accessor's name where visible. */
export async function listDocumentAccess(documentIds) {
  if (!documentIds?.length) return { data: [], error: null };
  const log = await run(from("hr_document_access_log").select("id, document_id, version_id, accessed_by, action, accessed_at")
    .in("document_id", documentIds).order("accessed_at", { ascending: false }).limit(100));
  if (log.error || !log.data?.length) return log;
  const users = [...new Set(log.data.map((r) => r.accessed_by).filter(Boolean))];
  const people = users.length ? await run(from("hr_employees").select("user_id, employee_code, first_name, last_name, display_name").in("user_id", users)) : { data: [] };
  const byUser = new Map((people.data ?? []).map((p) => [p.user_id, p]));
  return { ...log, data: log.data.map((r) => ({ ...r, accessor: byUser.get(r.accessed_by) ?? null })) };
}

/** The employee's reporting manager as the employee may see them (RLS: own manager's work record). */
export async function getReportingManager(managerId) {
  if (!managerId) return { data: null, error: null };
  return run(from("hr_employees").select(`id, employee_code, first_name, last_name, display_name, company_email,
    designation:hr_designations(id, name), department:hr_departments!hr_employees_department_id_fkey(id, name)`).eq("id", managerId).maybeSingle());
}

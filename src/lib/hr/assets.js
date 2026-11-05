// Asset allocation (Modules 109 + 141): register, assignments + handovers,
// damage reports, returns, history, overview, exit clearance and employee
// asset requests. Master fields of hr_assets are written directly
// (assets.manage, RLS); status changes and every workflow step go through
// SECURITY DEFINER RPCs. Purchase cost is stored in hr_asset_financials
// (assets.view_cost) — read it with getAssetCosts(); hr_assets.purchase_cost
// is write-only (a trigger moves the value) and always reads as null.
import { from, rpc, run } from "./client";

export const ASSET_STATUSES = ["available", "assigned", "in_repair", "in_inspection", "retired", "lost", "disposed"];
export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "damaged"];
export const SETTABLE_STATUSES = ["available", "retired", "lost", "disposed"];
export const REQUEST_STATUSES = ["pending", "approved", "rejected", "fulfilled", "cancelled"];
export const ASSET_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_./-]{1,39}$/;
export const ASSET_CATEGORIES = ["Laptop", "Desktop", "Monitor", "Keyboard", "Mouse", "Charger", "Headset", "Mobile Phone", "Docking Station", "Other Accessory"];
export const DAMAGE_CATEGORIES = ["physical", "screen", "liquid", "battery", "keyboard_input", "malfunction", "missing_part", "other"];
export const DAMAGE_SEVERITIES = ["low", "medium", "high", "critical"];
export const DAMAGE_STATUSES = ["reported", "under_review", "under_repair", "resolved"];
export const RETURN_STATUSES = ["requested", "pending_handover", "received", "inspected", "completed", "cancelled"];
export const RETURN_OUTCOMES = ["available", "in_repair", "retired"];
export const HANDOVER_STATUSES = ["pending_acknowledgement", "acknowledged", "confirmed", "cancelled"];
export const ACCESSORY_SUGGESTIONS = ["Charger", "Laptop bag", "Mouse", "Keyboard", "Headset", "HDMI cable", "USB-C dock", "Power cable", "SIM card"];

const EMP = "id, employee_code, first_name, last_name, display_name, department_id";
/** hr_assets columns used by the UI (purchase_cost always reads null; see getAssetCosts). */
export const ASSET_COLUMNS = "id, asset_tag, asset_type, category, brand, model, serial_number, purchase_date, warranty_expiry, status, condition, location_id, notes, is_bulk, quantity, created_by, created_at, updated_at, storage_location";
const ASSET_SHORT = "id, asset_tag, asset_type, brand, model, serial_number, status, condition, is_bulk, quantity";
const LOC = "location:hr_locations!hr_assets_location_id_fkey(id, name)";

export const assetLabel = (a) => (a ? [a.asset_tag, [a.brand, a.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "—");
export const assetName = (a) => (a ? [a.brand, a.model].filter(Boolean).join(" ") || a.asset_type : "Asset");
const clean = (s) => (typeof s === "string" ? s.trim() || null : s ?? null);
const list = (arr) => (Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : null);

// ----------------------------------------------------------------- register
export async function listAssets({ status = "", type = "", search = "", location = "" } = {}) {
  let q = from("hr_assets").select(`${ASSET_COLUMNS}, ${LOC}`).order("asset_tag").limit(2000);
  if (status) q = q.eq("status", status);
  if (type) q = q.eq("asset_type", type);
  if (location) q = q.eq("location_id", location);
  const s = search.trim().replace(/[%,()]/g, " ");
  if (s) q = q.or(`asset_tag.ilike.%${s}%,brand.ilike.%${s}%,model.ilike.%${s}%,serial_number.ilike.%${s}%,category.ilike.%${s}%,storage_location.ilike.%${s}%`);
  return run(q);
}

export async function listAssetTypes() {
  const res = await run(from("hr_assets").select("asset_type").limit(5000));
  return { ...res, data: res.data ? [...new Set(res.data.map((r) => r.asset_type))].sort() : null };
}

export async function getAsset(id) {
  return run(from("hr_assets").select(`${ASSET_COLUMNS}, ${LOC}`).eq("id", id).maybeSingle());
}

/** { [assetId]: cost } — requires assets.view_cost. */
export async function getAssetCosts(ids) {
  if (!ids?.length) return { data: {}, error: null };
  const res = await rpc("hr_asset_costs", { p_assets: ids });
  if (res.error) return res;
  return { data: Object.fromEntries((res.data ?? []).map((r) => [r.asset_id, r.purchase_cost])), error: null };
}

export async function getAssetAssignments(assetId) {
  return run(from("hr_asset_assignments")
    .select(`*, employee:hr_employees!hr_asset_assignments_employee_id_fkey(${EMP})`)
    .eq("asset_id", assetId).order("assigned_at", { ascending: false }).limit(500));
}

export async function getAssetEvents(assetId) {
  return run(from("hr_asset_events")
    .select(`id, event_type, details, cost, occurred_at, recorded_by, assignment_id, handover_id, damage_report_id, return_id, employee:hr_employees!hr_asset_events_employee_id_fkey(${EMP})`)
    .eq("asset_id", assetId).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(1000));
}

/** Employee: history events of their own assignments (RLS-limited). */
export async function listMyAssetEvents() {
  return run(from("hr_asset_events")
    .select(`id, event_type, details, occurred_at, assignment_id, asset:hr_assets!hr_asset_events_asset_id_fkey(${ASSET_SHORT})`)
    .order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(500));
}

const MASTER_FIELDS = ["asset_tag", "asset_type", "category", "brand", "model", "serial_number", "purchase_date", "purchase_cost",
  "warranty_expiry", "condition", "location_id", "notes", "is_bulk", "quantity", "storage_location"];

function cleanAsset(values, { canCost }) {
  const out = {};
  for (const k of MASTER_FIELDS) {
    if (!(k in values)) continue;
    if (k === "purchase_cost" && !canCost) continue;     // never send (or wipe) a cost the user cannot see
    let v = values[k];
    if (typeof v === "string") v = v.trim();
    if (v === "") v = null;
    if ((k === "purchase_cost") && v !== null) v = Number(v);
    if (k === "quantity") v = v === null ? 1 : Number(v);
    if (k === "is_bulk") v = Boolean(v);
    out[k] = v;
  }
  if (!out.is_bulk) out.quantity = 1;
  return out;
}

const costValue = (v) => (v === "" || v == null ? null : Number(v));

/** Set or clear (null) the purchase cost — assets.view_cost (migration 143). */
export const setAssetCost = (asset, cost) => rpc("hr_set_asset_cost", { p_asset: asset, p_cost: costValue(cost) });

/**
 * Insert (status available | in_repair) or update master fields (never status).
 * New asset: the cost travels with the insert (hr_assets_cost_split moves it).
 * Existing asset: the cost is never part of the update; when the user may see
 * costs and the value differs from `originalCost`, it is set or cleared via
 * hr_set_asset_cost (a NULL column write cannot clear it).
 */
export async function saveAsset(values, id, { canCost = false, originalCost } = {}) {
  if (!id) {
    const body = cleanAsset(values, { canCost });
    body.status = values.status === "in_repair" ? "in_repair" : "available";
    return run(from("hr_assets").insert(body).select("id").single());
  }
  const res = await run(from("hr_assets").update(cleanAsset(values, { canCost: false })).eq("id", id).select("id").single());
  if (res.error || !canCost) return res;
  if (costValue(values.purchase_cost) === costValue(originalCost)) return res;
  const cost = await setAssetCost(id, values.purchase_cost);
  return cost.error ? { data: res.data, error: `Saved, but the purchase cost was not updated: ${cost.error}` } : res;
}

// -------------------------------------------------------------- assignments
export async function listAssignments({ employee = "", status = "active" } = {}) {
  let q = from("hr_asset_assignments")
    .select(`*, asset:hr_assets!hr_asset_assignments_asset_id_fkey(${ASSET_SHORT}), employee:hr_employees!hr_asset_assignments_employee_id_fkey(${EMP})`)
    .order("assigned_at", { ascending: false }).limit(2000);
  if (employee) q = q.eq("employee_id", employee);
  if (status) q = q.eq("status", status);
  return run(q);
}

export async function listMyAssignments(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_asset_assignments")
    .select(`*, asset:hr_assets!hr_asset_assignments_asset_id_fkey(${ASSET_SHORT}), handover:hr_asset_handovers!hr_asset_handovers_assignment_id_fkey(*)`)
    .eq("employee_id", employeeId).order("assigned_at", { ascending: false }).limit(500));
}

export const assignAsset = ({ asset, employee, expectedReturn, notes, quantity, reason, accessories, checklist, issuedCondition }) =>
  rpc("hr_assign_asset_v2", {
    p_asset: asset, p_employee: employee, p_expected_return: expectedReturn || null, p_notes: clean(notes), p_quantity: Number(quantity) || 1,
    p_reason: clean(reason), p_accessories: list(accessories), p_checklist: checklist ?? null, p_issued_condition: issuedCondition || null,
  });
export const transferAsset = (assignment, toEmployee, notes) => rpc("hr_transfer_asset", { p_assignment: assignment, p_to_employee: toEmployee, p_notes: clean(notes) });
/** One-step return by HR (receipt + inspection + completion recorded together). */
export const returnAsset = (assignment, condition, notes) => rpc("hr_return_asset", { p_assignment: assignment, p_condition: condition, p_notes: clean(notes) });
export const logAssetMaintenance = ({ asset, details, cost, complete, condition }) =>
  rpc("hr_log_asset_maintenance", { p_asset: asset, p_details: clean(details), p_cost: cost === "" || cost == null ? null : Number(cost), p_complete: Boolean(complete), p_condition: condition || null });
export const setAssetStatus = (asset, status, details) => rpc("hr_set_asset_status", { p_asset: asset, p_status: status, p_details: clean(details) });

// ---------------------------------------------------------------- handovers
const HANDOVER_SELECT = `*, asset:hr_assets!hr_asset_handovers_asset_id_fkey(${ASSET_SHORT}), employee:hr_employees!hr_asset_handovers_employee_id_fkey(${EMP}), assignment:hr_asset_assignments!hr_asset_handovers_assignment_id_fkey(id, status, assigned_at, assignment_reason)`;
export async function listHandovers({ status = "", employee = "" } = {}) {
  let q = from("hr_asset_handovers").select(HANDOVER_SELECT).order("created_at", { ascending: false }).limit(1000);
  if (status === "open") q = q.in("status", ["pending_acknowledgement", "acknowledged"]);
  else if (status) q = q.eq("status", status);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}
export async function getHandoverForAssignment(assignmentId) {
  return run(from("hr_asset_handovers").select(HANDOVER_SELECT).eq("assignment_id", assignmentId).maybeSingle());
}
export const updateHandover = (id, { issuedCondition, accessories, checklist, notes } = {}) =>
  rpc("hr_update_asset_handover", { p_handover: id, p_issued_condition: issuedCondition || null, p_accessories: list(accessories), p_checklist: checklist ?? null, p_notes: notes ?? null });
export const acknowledgeHandover = (id, termsVersion) => rpc("hr_acknowledge_asset_handover", { p_handover: id, p_terms_version: termsVersion });
export const confirmHandover = (id, note) => rpc("hr_confirm_asset_handover", { p_handover: id, p_note: clean(note) });
/** Legacy: acknowledge by assignment id (uses the handover's own terms version). */
export const acknowledgeAsset = (assignment) => rpc("hr_acknowledge_asset", { p_assignment: assignment });

// ----------------------------------------------------------- damage reports
const DAMAGE_SELECT = `*, asset:hr_assets!hr_asset_damage_reports_asset_id_fkey(${ASSET_SHORT}), employee:hr_employees!hr_asset_damage_reports_employee_id_fkey(${EMP}), reporter:hr_employees!hr_asset_damage_reports_reporter_employee_id_fkey(${EMP})`;
export async function listDamageReports({ status = "", asset = "", employee = "" } = {}) {
  let q = from("hr_asset_damage_reports").select(DAMAGE_SELECT).order("created_at", { ascending: false }).limit(1000);
  if (status === "open") q = q.neq("status", "resolved");
  else if (status) q = q.eq("status", status);
  if (asset) q = q.eq("asset_id", asset);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}
export const submitDamageReport = ({ assignment = null, asset = null, incidentDate, category, severity, description }) =>
  rpc("hr_submit_asset_damage_report", { p_assignment: assignment, p_asset: assignment ? null : asset, p_incident_date: incidentDate, p_category: category, p_severity: severity, p_description: clean(description) });
export const updateDamageReport = (id, { incidentDate, category, severity, description }) =>
  rpc("hr_update_asset_damage_report", { p_report: id, p_incident_date: incidentDate, p_category: category, p_severity: severity, p_description: clean(description) });
export const advanceDamageReport = (id, { status, notes, repairDetails, repairCost, conditionAfter }) =>
  rpc("hr_advance_asset_damage_report", {
    p_report: id, p_status: status, p_notes: clean(notes), p_repair_details: clean(repairDetails),
    p_repair_cost: repairCost === "" || repairCost == null ? null : Number(repairCost), p_condition_after: conditionAfter || null,
  });
/** Legacy quick damage report (category other / severity medium). */
export const reportAssetDamage = ({ assignment = null, asset = null, details }) => rpc("hr_report_asset_damage", { p_assignment: assignment, p_asset: asset, p_details: clean(details) });

// ------------------------------------------------------------------ returns
const RETURN_SELECT = `*, asset:hr_assets!hr_asset_returns_asset_id_fkey(${ASSET_SHORT}), employee:hr_employees!hr_asset_returns_employee_id_fkey(${EMP})`;
export async function listReturns({ status = "", employee = "" } = {}) {
  let q = from("hr_asset_returns").select(RETURN_SELECT).order("requested_at", { ascending: false }).limit(1000);
  if (status === "open") q = q.in("status", ["requested", "pending_handover", "received", "inspected"]);
  else if (status) q = q.eq("status", status);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}
export async function listMyReturns(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_asset_returns").select(RETURN_SELECT).eq("employee_id", employeeId).order("requested_at", { ascending: false }).limit(500));
}
export const requestReturn = (assignment, reason, requestedDate) => rpc("hr_request_asset_return", { p_assignment: assignment, p_reason: clean(reason), p_requested_date: requestedDate || null });
export const scheduleReturn = (id, date, note) => rpc("hr_schedule_asset_return", { p_return: id, p_return_date: date || null, p_note: clean(note) });
export const receiveReturn = (id, accessoriesReturned, note) => rpc("hr_receive_asset_return", { p_return: id, p_accessories_returned: list(accessoriesReturned), p_note: clean(note) });
export const inspectReturn = (id, { condition, outcome, notes, missingAccessories, damageCategory, damageSeverity }) =>
  rpc("hr_inspect_asset_return", {
    p_return: id, p_condition: condition, p_outcome: outcome, p_notes: clean(notes), p_missing_accessories: list(missingAccessories),
    p_damage_category: damageCategory || null, p_damage_severity: damageSeverity || null,
  });
export const completeReturn = (id, note) => rpc("hr_complete_asset_return", { p_return: id, p_note: clean(note) });
export const cancelReturn = (id, reason) => rpc("hr_cancel_asset_return", { p_return: id, p_reason: clean(reason) });
export const acknowledgeReturn = (id) => rpc("hr_acknowledge_asset_return", { p_return: id });

// ---------------------------------------------------------------- documents
/** Module 9 documents linked to asset records. */
export async function listAssetDocumentLinks({ asset = "", handover = "", damage = "", ret = "" } = {}) {
  let q = from("hr_asset_document_links")
    .select("id, kind, linked_at, document_id, handover_id, damage_report_id, return_id, document:hr_documents!hr_asset_document_links_document_id_fkey(id, title, current_version, versions:hr_document_versions(id, version, storage_path, file_name, mime_type, size_bytes))")
    .order("linked_at", { ascending: false }).limit(500);
  if (asset) q = q.eq("asset_id", asset);
  if (handover) q = q.eq("handover_id", handover);
  if (damage) q = q.eq("damage_report_id", damage);
  if (ret) q = q.eq("return_id", ret);
  return run(q);
}
export const ASSET_DOC_CATEGORY = { handover: "asset_handover", damage_evidence: "asset_damage_evidence", return_confirmation: "asset_return" };
export const linkAssetDocument = (documentId, kind, recordId) => rpc("hr_link_asset_document", { p_document: documentId, p_kind: kind, p_record: recordId });

// ------------------------------------------------------ overview / clearance
export const assetOverview = ({ category = "", employee = "", department = "", status = "", location = "", from: f = "", to = "" } = {}) =>
  rpc("hr_asset_overview", {
    p_category: category || null, p_employee: employee || null, p_department: department || null, p_status: status || null,
    p_location: location || null, p_from: f || null, p_to: to || null,
  });
export const employeeOpenAssets = (employeeId) => rpc("hr_employee_open_assets", { p_employee: employeeId });
export const employeeAssetClearance = (employeeId) => rpc("hr_employee_asset_clearance", { p_employee: employeeId });
export const employeeAssetHandovers = (employeeId) => rpc("hr_employee_asset_handovers", { p_employee: employeeId });
export const startExitAssetReturns = (employeeId, exitId, returnDate) => rpc("hr_start_exit_asset_returns", { p_employee: employeeId, p_exit: exitId || null, p_return_date: returnDate || null });
export const recordAssetClearance = (employeeId, { exitId, note, acknowledgeIssues } = {}) =>
  rpc("hr_record_asset_clearance", { p_employee: employeeId, p_exit: exitId || null, p_note: clean(note), p_acknowledge_issues: Boolean(acknowledgeIssues) });

// ----------------------------------------------------------------- requests
export async function listAssetRequests({ status = "", employee = "" } = {}) {
  let q = from("hr_asset_requests")
    .select(`*, employee:hr_employees!hr_asset_requests_employee_id_fkey(${EMP}), replaces:hr_asset_assignments!hr_asset_requests_replaces_assignment_fkey(id, asset:hr_assets!hr_asset_assignments_asset_id_fkey(${ASSET_SHORT}))`)
    .order("created_at", { ascending: false }).limit(1000);
  if (status) q = q.eq("status", status);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}
export async function listMyAssetRequests(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_asset_requests").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(500));
}
export const requestAsset = (type, reason, kind = "new", replacesAssignment = null) =>
  rpc("hr_request_asset", { p_asset_type: type?.trim(), p_reason: reason?.trim(), p_kind: kind, p_replaces_assignment: kind === "replacement" ? replacesAssignment : null });
export const cancelAssetRequest = (id) => rpc("hr_cancel_asset_request", { p_request: id });
export const decideAssetRequest = (id, approve, note) => rpc("hr_decide_asset_request", { p_request: id, p_approve: approve, p_note: clean(note) });
export const fulfillAssetRequest = (id, asset, expectedReturn) => rpc("hr_fulfill_asset_request", { p_request: id, p_asset: asset, p_expected_return: expectedReturn || null });

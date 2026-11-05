// Exit management. Tables are read-only for clients (RLS); every state
// change is a SECURITY DEFINER RPC. Sign-in revocation runs in the
// hr-revoke-exit-access Edge Function (service role stays on the server).
import { from, invokeFunction, rpc, run } from "./client";

export const EXIT_TYPES = ["resignation", "termination", "retirement", "contract_end", "other"];
export const OPEN_EXIT_STATUSES = ["submitted", "manager_review", "hr_review", "notice_period", "clearance", "final_settlement"];
export const ENDED_EXIT_STATUSES = ["closed", "withdrawn", "rejected"];

// Visual workflow (submitted and manager_review collapse into their steps).
export const EXIT_STEPS = [
  { key: "submitted", label: "Resignation submitted" },
  { key: "manager_review", label: "Manager review" },
  { key: "hr_review", label: "HR review" },
  { key: "notice_period", label: "Notice period" },
  { key: "clearance", label: "Clearance" },
  { key: "final_settlement", label: "Final settlement" },
  { key: "closed", label: "Closed" },
];

export const CLEARANCE_LABELS = {
  asset_return: "Asset return",
  access_revocation: "Sign-in access revocation",
  it_clearance: "IT clearance",
  document_handover: "Document handover",
  project_handover: "Project handover",
  hr_clearance: "HR clearance",
  payroll_clearance: "Finance clearance",
  final_settlement: "Final settlement",
  relieving_letter: "Relieving letter",
};

// Who may act on a clearance item — mirrors hr_private.clearance_can_act (130).
// UX only; the server enforces it. `onlyOwner` drops the HR catch-all so a
// "my items" filter shows each owner their own items.
const HR_ITEMS = ["asset_return", "hr_clearance", "relieving_letter"];
export function canActOnClearance(key, hasPermission, { isLeaver = false, isLineManager = false, onlyOwner = false } = {}) {
  if (isLeaver) return false;
  if (hasPermission("exit.manage") && (!onlyOwner || HR_ITEMS.includes(key))) return true;
  if (key === "asset_return" && hasPermission("assets.manage")) return true;
  if (["it_clearance", "access_revocation"].includes(key) && hasPermission("exit.clearance_it")) return true;
  if (["payroll_clearance", "final_settlement"].includes(key) && (hasPermission("payroll.manage") || hasPermission("payroll.approve"))) return true;
  if (["document_handover", "project_handover"].includes(key) && hasPermission("exit.approve_team") && isLineManager) return true;
  return false;
}

const EMP = "id, employee_code, first_name, last_name, display_name, status, manager_id, user_id, employment_type";

export async function listExits({ scope = "active", type = "" } = {}) {
  let q = from("hr_exits").select(`*, employee:hr_employees!hr_exits_employee_id_fkey(${EMP})`).order("created_at", { ascending: false }).limit(1000);
  if (scope === "active") q = q.in("status", OPEN_EXIT_STATUSES);
  else if (scope === "closed") q = q.in("status", ENDED_EXIT_STATUSES);
  if (type) q = q.eq("exit_type", type);
  return run(q);
}

export async function getExit(id) {
  return run(from("hr_exits").select(`*, employee:hr_employees!hr_exits_employee_id_fkey(${EMP})`).eq("id", id).maybeSingle());
}

export async function getExitEvents(id) {
  return run(from("hr_exit_events").select("id, event_type, from_status, to_status, note, actor_user_id, created_at").eq("exit_id", id).order("created_at"));
}

export async function getClearanceItems(id) {
  return run(from("hr_exit_clearance_items").select("*").eq("exit_id", id).order("sort_order"));
}

export async function listMyExits(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_exits").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(50));
}

export const submitResignation = (reason, proposedLwd) => rpc("hr_submit_resignation", { p_reason: reason?.trim(), p_proposed_lwd: proposedLwd || null });
export const initiateExit = ({ employee, type, reason, lwd }) => rpc("hr_initiate_exit", { p_employee: employee, p_exit_type: type, p_reason: reason?.trim(), p_lwd: lwd || null });
export const managerReviewExit = (id, approve, note) => rpc("hr_manager_review_exit", { p_exit: id, p_approve: approve, p_note: note?.trim() || null });
export const hrReviewExit = (id, approve, lwd, note) => rpc("hr_hr_review_exit", { p_exit: id, p_approve: approve, p_approved_lwd: lwd || null, p_note: note?.trim() || null });
export const startExitClearance = (id) => rpc("hr_start_exit_clearance", { p_exit: id });
export const completeClearanceItem = (itemId, status, note) => rpc("hr_complete_clearance_item", { p_item: itemId, p_status: status, p_note: note?.trim() || null });
export const moveExitToSettlement = (id) => rpc("hr_move_exit_to_settlement", { p_exit: id });
export const recordExitLetter = (id, letter) => rpc("hr_record_exit_letter", { p_exit: id, p_letter: letter });
export const closeExit = (id, notes) => rpc("hr_close_exit", { p_exit: id, p_settlement_notes: notes?.trim() || null });
export const withdrawExit = (id, note) => rpc("hr_withdraw_resignation", { p_exit: id, p_note: note?.trim() || null });
export const revokeExitAccess = (id) => invokeFunction("hr-revoke-exit-access", { exit_id: id });
export const exitOpenAssets = (employeeId) => rpc("hr_employee_open_assets", { p_employee: employeeId });

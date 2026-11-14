// Project Tracker data access. Browser-only: every call goes through the
// shared supabase client with the signed-in user's session, so Row Level
// Security (supabase/project-tracker/001_project_tracker_schema.sql) decides
// what is visible and writable. Nothing here bypasses it.
import { supabase } from "@/lib/supabase/client";
import { sanitizeSearch, sanitizeFileName, checkUpload, uploadContentType } from "@/admin/project-tracker/lib/validation";
import { addDaysISO, todayISO } from "@/admin/project-tracker/lib/format";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/env";

export const DOCS_BUCKET = "project-tracker-documents";
const SIGNED_URL_SECONDS = 60;

// ------------------------------------------------------------------ errors
const CONSTRAINT_MESSAGES = {
  pt_projects_code_uidx: "That Project ID is already used by another project.",
  pt_projects_code_format: "Project ID must be 3–30 letters, digits or dashes.",
  pt_projects_category_other: "Describe the category when choosing “Other”.",
  pt_projects_vendor: "Enter the original developer / vendor when the project was not built by Zyllo Tech.",
  pt_projects_expected_after_start: "Expected completion cannot be before the start date.",
  pt_projects_actual_after_start: "Actual completion cannot be before the start date.",
  pt_hosting_migration_documented: "Say where the hosting was migrated to.",
  pt_hosting_dates: "Expiry date cannot be before the purchase date.",
  pt_domains_name_uidx: "This domain is already recorded for this project.",
  pt_domains_one_primary_uidx: "This project already has a primary domain. Mark the other one Secondary first.",
  pt_domains_dates: "Expiry date cannot be before the registration date.",
  pt_email_unique_purpose_uidx: "This email address is already recorded with the same purpose.",
  pt_repositories_url_uidx: "This repository is already recorded for this project.",
  pt_amc_number_uidx: "Another AMC contract of this project already uses that number.",
  pt_amc_dates: "Contract end date cannot be before the start date.",
  pt_seo_one_per_project_uidx: "This project already has an SEO record.",
  pt_handovers_one_active_uidx: "This project already has an active handover record.",
  pt_backups_completed_evidence: "A completed backup needs its date/time and storage location.",
  pt_backups_verified_evidence: "A verified backup needs who verified it, when, and the evidence (at least 10 characters).",
  pt_backups_restore_evidence: "A restore test needs a completed backup, the test date and evidence (at least 10 characters).",
  pt_deployments_done_has_date: "Enter the deployment date for a finished deployment.",
  pt_tasks_done: "Enter the completion date for a done task.",
  pt_tasks_dates: "Due date cannot be before the start date.",
  pt_milestones_completed: "Enter the completion date for a completed milestone.",
  pt_renewals_completed_evidence: "A completed renewal needs its completion date and evidence.",
  pt_documents_one_source: "A document needs either an uploaded file or an external link (not both).",
  pt_documents_path_in_project: "The file location does not belong to this project.",
  pt_handover_items_done_evidence: "Add evidence (a note of at least 5 characters or a document) to complete this item.",
  pt_handover_items_na_reason: "Give a reason (at least 5 characters) when marking an item Not applicable.",
  pt_companies_name_uidx: "An active company with this name already exists.",
  pt_companies_code_uidx: "That Company Code is already used by another company.",
  pt_companies_code_format: "Company Code must be 2–20 letters, digits or dashes.",
};

export class TrackerError extends Error {
  constructor(message, { code = null, kind = "error", cause = null } = {}) {
    super(message);
    this.code = code;
    this.kind = kind; // "not_installed" | "forbidden" | "conflict" | "validation" | "error"
    this.cause = cause;
  }
}

export function toTrackerError(error, fallback = "Something went wrong. Please try again.") {
  if (!error) return new TrackerError(fallback);
  if (error instanceof TrackerError) return error;
  const code = error.code || null;
  const msg = String(error.message || "");
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || /does not exist|Could not find the (table|function)/i.test(msg)) {
    return new TrackerError("The Project Tracker database has not been installed on this backend yet.", { code, kind: "not_installed", cause: error });
  }
  const constraint = Object.keys(CONSTRAINT_MESSAGES).find((k) => msg.includes(k) || String(error.details || "").includes(k));
  if (constraint) return new TrackerError(CONSTRAINT_MESSAGES[constraint], { code, kind: code === "23505" ? "conflict" : "validation", cause: error });
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) {
    const friendly = /permission denied|row-level security/i.test(msg) ? "You do not have permission to do that in Project Tracker." : msg;
    return new TrackerError(friendly, { code, kind: "forbidden", cause: error });
  }
  if (code === "23502") return new TrackerError(msg || "A required value is missing.", { code, kind: "validation", cause: error });
  if (code === "23503") return new TrackerError("A linked record does not belong to this project (or no longer exists).", { code, kind: "validation", cause: error });
  if (code === "23505") return new TrackerError(msg || "This record already exists.", { code, kind: "conflict", cause: error });
  if (code === "23514") return new TrackerError("Some values are not allowed. Please check the form.", { code, kind: "validation", cause: error });
  if (code === "22001") return new TrackerError("One of the values is too long.", { code, kind: "validation", cause: error });
  if (["22023", "55000", "P0002", "P0001", "22P02", "22007", "22008"].includes(code)) {
    return new TrackerError(msg + (error.hint ? ` ${error.hint}` : ""), { code, kind: "validation", cause: error });
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return new TrackerError("Network error — check your connection and try again.", { code, cause: error });
  return new TrackerError(fallback, { code, cause: error });
}

function unwrap({ data, error }, fallback) {
  if (error) throw toTrackerError(error, fallback);
  return data;
}

// Empty strings become NULL; strings are trimmed; undefined keys dropped.
export function cleanValues(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    if (typeof v === "string") {
      const t = v.trim();
      out[k] = t === "" ? null : t;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ------------------------------------------------------------------ role
export async function getMyRole() {
  const { data, error } = await supabase.rpc("pt_my_role");
  if (error) throw toTrackerError(error, "Could not check your Project Tracker access.");
  return data || null;
}

// ------------------------------------------------------------------ projects
export const PROJECT_FLAGS = {
  pending_handover: (q) => q.eq("handover_pending", true),
  missing_backups: (q) => q.eq("backup_missing", true),
  backup_verification_overdue: (q) => q.eq("backup_verification_overdue", true),
  missing_admin: (q) => q.eq("admin_details_missing", true),
  missing_critical: (q) => q.eq("completeness_label", "missing_critical"),
  partial: (q) => q.eq("completeness_label", "partial"),
  complete_docs: (q) => q.eq("completeness_label", "complete"),
  overdue_tasks: (q) => q.gt("overdue_tasks", 0),
};

const SORTABLE = new Set(["serial_no", "project_code", "name", "client_name", "company_name", "category", "status", "priority", "progress",
  "start_date", "expected_completion_date", "updated_at", "completeness_score", "last_activity_at"]);

/**
 * opts: { q, status, category, priority, flag, dueKind, within, dateField, from, to,
 *         includeArchived, sort, dir, page, pageSize }
 */
export async function listProjects(opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(opts.pageSize) || 20));
  let q = supabase.from("pt_project_list").select("*", { count: "exact" });

  const search = sanitizeSearch(opts.q);
  if (search) q = q.or(`name.ilike.*${search}*,company_name.ilike.*${search}*,client_name.ilike.*${search}*,project_code.ilike.*${search}*,responsible_person.ilike.*${search}*`);
  if (opts.companyId === "unassigned") q = q.is("company_id", null);
  else if (opts.companyId) q = q.eq("company_id", opts.companyId);
  if (opts.status) q = q.eq("status", opts.status);
  else if (!opts.includeArchived) q = q.is("archived_at", null);
  if (opts.category) q = q.eq("category", opts.category);
  if (opts.priority) q = q.eq("priority", opts.priority);
  if (opts.flag && PROJECT_FLAGS[opts.flag]) q = PROJECT_FLAGS[opts.flag](q);
  const dateField = ["start_date", "expected_completion_date", "actual_completion_date", "updated_at", "created_at"].includes(opts.dateField)
    ? opts.dateField : null;
  if (dateField && opts.from) q = q.gte(dateField, opts.from);
  if (dateField && opts.to) q = q.lte(dateField, dateField.endsWith("_at") ? `${opts.to}T23:59:59.999` : opts.to);

  if (opts.dueKind) {
    const ids = await projectIdsWithDue(opts.dueKind, Number(opts.within) || 30);
    if (ids.length === 0) return { rows: [], count: 0, page, pageSize };
    q = q.in("id", ids);
  }

  const sort = SORTABLE.has(opts.sort) ? opts.sort : "updated_at";
  const ascending = opts.dir ? opts.dir === "asc" : sort !== "updated_at";
  q = q.order(sort, { ascending, nullsFirst: false }).order("serial_no", { ascending: true });
  q = q.range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw toTrackerError(error, "Could not load projects.");
  return { rows: data || [], count: count ?? 0, page, pageSize };
}

async function projectIdsWithDue(kind, within) {
  const until = addDaysISO(todayISO(), within);
  let q = supabase.from("pt_due_items").select("project_id").lte("due_date", until);
  if (kind !== "any") q = q.eq("kind", kind);
  const rows = unwrap(await q, "Could not load renewals.");
  return [...new Set(rows.map((r) => r.project_id))];
}

export async function getProject(id) {
  const rows = unwrap(await supabase.from("pt_project_list").select("*").eq("id", id).limit(1), "Could not load the project.");
  return rows[0] || null;
}

export async function findSimilarProjects(name, companyId, excludeId) {
  const n = sanitizeSearch(name);
  if (!n) return [];
  let q = supabase.from("pt_project_list").select("id, project_code, name, company_id, company_name, status").ilike("name", n);
  if (excludeId) q = q.neq("id", excludeId);
  const rows = unwrap(await q.limit(20), "Could not check for duplicates.");
  // Same name under the SAME company is the likely duplicate; other companies may reuse names (P1, P2…).
  return rows.filter((r) => r.company_id === companyId);
}

export async function createProject(values) {
  const rows = unwrap(await supabase.from("pt_projects").insert(cleanValues(values)).select("id, project_code"), "Could not create the project.");
  return rows[0];
}

// ------------------------------------------------------------------ records (generic)
/**
 * Update with optimistic concurrency: when `expectedUpdatedAt` is given the
 * row must still have that updated_at, otherwise someone else changed it.
 */
export async function updateRecord(table, id, patch, expectedUpdatedAt) {
  let q = supabase.from(table).update(cleanValues(patch)).eq("id", id);
  if (expectedUpdatedAt) q = q.eq("updated_at", expectedUpdatedAt);
  const rows = unwrap(await q.select("id, updated_at"), "Could not save the changes.");
  if (!rows || rows.length === 0) {
    throw new TrackerError(
      expectedUpdatedAt
        ? "This record was changed by someone else (or you no longer have access). Reload and try again."
        : "The record was not saved — you may not have permission.",
      { kind: "conflict" },
    );
  }
  return rows[0];
}

export async function listRecords(table, projectId, { includeArchived = false, orderBy = "created_at", ascending = true } = {}) {
  let q = supabase.from(table).select("*").eq("project_id", projectId);
  if (!includeArchived) q = q.is("archived_at", null);
  q = q.order(orderBy, { ascending, nullsFirst: false }).order("created_at", { ascending: true }).limit(500);
  return unwrap(await q, "Could not load records.");
}

export async function createRecord(table, projectId, values) {
  const rows = unwrap(
    await supabase.from(table).insert({ ...cleanValues(values), project_id: projectId }).select("*"),
    "Could not create the record.",
  );
  return rows[0];
}

export async function archiveRecord(table, id, reason) {
  return updateRecord(table, id, { archived_at: new Date().toISOString(), archive_reason: reason || null });
}

export async function restoreRecord(table, id) {
  return updateRecord(table, id, { archived_at: null });
}

// ------------------------------------------------------------------ credentials
export async function setAccessReference(recordId, accountIdentifier, vaultReference) {
  unwrap(
    await supabase.rpc("pt_set_access_reference", {
      p_record: recordId, p_account_identifier: accountIdentifier || null, p_vault_reference: vaultReference,
    }),
    "Could not save the credential reference.",
  );
}

export async function revealAccessReference(recordId) {
  const rows = unwrap(await supabase.rpc("pt_reveal_access_reference", { p_record: recordId }), "Could not load the reference.");
  return Array.isArray(rows) ? rows[0] || null : rows;
}

// ------------------------------------------------------------------ documents
export async function uploadDocument(projectId, file, meta) {
  const problem = checkUpload(file);
  if (problem) throw new TrackerError(problem, { kind: "validation" });
  const safeName = sanitizeFileName(file.name);
  const path = `${projectId}/${crypto.randomUUID()}/${safeName}`;
  const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file, {
    upsert: false, contentType: file.type || "application/octet-stream", cacheControl: "0",
  });
  if (up.error) {
    const m = String(up.error.message || "");
    if (/bucket not found/i.test(m)) throw new TrackerError("Document storage has not been set up on this backend yet.", { kind: "not_installed" });
    if (/mime|type/i.test(m)) throw new TrackerError("This file type is not allowed.", { kind: "validation" });
    if (/size|large/i.test(m)) throw new TrackerError("The file is too large.", { kind: "validation" });
    throw toTrackerError(up.error, "The upload failed.");
  }
  try {
    const rows = unwrap(
      await supabase.from("pt_documents").insert({
        ...cleanValues(meta), project_id: projectId, storage_path: path, file_name: safeName,
        mime_type: file.type || null, size_bytes: file.size,
      }).select("*"),
      "Could not save the document.",
    );
    return rows[0];
  } catch (e) {
    // Remove the orphaned file (storage policy allows deleting orphans only).
    await supabase.storage.from(DOCS_BUCKET).remove([path]).catch(() => {});
    throw e;
  }
}

export async function createLinkDocument(projectId, meta) {
  return createRecord("pt_documents", projectId, meta);
}

/**
 * Short-lived signed URL (60 s) for a private document. The access is
 * recorded in the activity log first (open / download / preview); if that
 * fails, no link is created.
 */
export async function getDocumentUrl(doc, { download = false, action } = {}) {
  await logDocumentAccess(doc.id, action || (download ? "downloaded" : "opened"));
  if (doc.external_url) return doc.external_url;
  const { data, error } = await supabase.storage.from(DOCS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS, download ? { download: doc.file_name || true } : undefined);
  if (error || !data?.signedUrl) throw toTrackerError(error, "Could not open the document (you may not have access).");
  return data.signedUrl;
}

// ------------------------------------------------------------------ handover
export async function getHandover(projectId) {
  const hos = unwrap(
    await supabase.from("pt_handovers").select("*").eq("project_id", projectId).is("archived_at", null).limit(1),
    "Could not load the handover.",
  );
  const handover = hos[0] || null;
  if (!handover) return { handover: null, items: [], events: [] };
  const [items, events] = await Promise.all([
    supabase.from("pt_handover_items").select("*").eq("handover_id", handover.id).order("sort_order", { ascending: true }),
    supabase.from("pt_handover_events").select("*").eq("handover_id", handover.id).order("created_at", { ascending: true }),
  ]);
  return { handover, items: unwrap(items, "Could not load the checklist."), events: unwrap(events, "Could not load handover history.") };
}

export async function startHandover(projectId) {
  return unwrap(await supabase.rpc("pt_start_handover", { p_project: projectId }), "Could not start the handover.");
}

export async function transitionHandover(handoverId, to, comment) {
  return unwrap(
    await supabase.rpc("pt_handover_transition", { p_handover: handoverId, p_to: to, p_comment: comment || null }),
    "Could not change the handover status.",
  );
}

// ------------------------------------------------------------------ renewals / AMC
export async function completeRenewal(id, { completedOn, newExpiry, evidence, completedBy }) {
  unwrap(
    await supabase.rpc("pt_complete_renewal", {
      p_renewal: id, p_completed_on: completedOn, p_new_expiry: newExpiry || null, p_evidence: evidence, p_completed_by: completedBy || null,
    }),
    "Could not complete the renewal.",
  );
}

export async function renewAmc(id, { start, end, renewalDate, contractNumber }) {
  return unwrap(
    await supabase.rpc("pt_renew_amc", {
      p_contract: id, p_start: start, p_end: end, p_renewal_date: renewalDate || null, p_contract_number: contractNumber || null,
    }),
    "Could not renew the AMC contract.",
  );
}

// ------------------------------------------------------------------ dashboard
export async function getDashboard(windowDays = 30) {
  const until = addDaysISO(todayISO(), windowDays);
  const [projects, due, recent, companies] = await Promise.all([
    supabase.from("pt_project_list").select(
      "id, project_code, name, client_name, company_id, company_name, status, archived_at, completeness_label, completeness_score, backup_missing, " +
      "backup_verification_overdue, admin_details_missing, handover_pending, overdue_tasks, updated_at, last_activity_at",
    ).limit(5000),
    supabase.from("pt_due_items").select("*").lte("due_date", until).order("due_date", { ascending: true }).limit(500),
    supabase.from("pt_activity_logs").select("*").order("created_at", { ascending: false }).limit(12),
    supabase.from("pt_companies").select("id, company_name, archived_at").limit(5000),
  ]);
  return {
    companies: unwrap(companies, "Could not load companies."),
    projects: unwrap(projects, "Could not load projects."),
    due: unwrap(due, "Could not load renewals."),
    recent: unwrap(recent, "Could not load recent activity."),
  };
}

export async function listDueItems({ within = 30, kind } = {}) {
  let q = supabase.from("pt_due_items").select("*").lte("due_date", addDaysISO(todayISO(), within)).order("due_date", { ascending: true });
  if (kind) q = q.eq("kind", kind);
  return unwrap(await q.limit(1000), "Could not load renewals.");
}

// ------------------------------------------------------------------ activity / remarks
export async function listActivity(projectId, { page = 1, pageSize = 25 } = {}) {
  let q = supabase.from("pt_activity_logs").select("*", { count: "exact" });
  if (projectId) q = q.eq("project_id", projectId);
  q = q.order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw toTrackerError(error, "Could not load activity.");
  return { rows: data || [], count: count ?? 0 };
}

// ------------------------------------------------------------------ cross-project registers
/** Rows of `table` across active projects, each with { project: {id, name, project_code, client_name} }. */
export async function listAcrossProjects(table, { q, orderBy = "created_at", ascending = false, filter, includeArchived = false, limit = 1000, companyId } = {}) {
  let query = supabase.from(table).select("*");
  if (!includeArchived) query = query.is("archived_at", null);
  if (filter) query = filter(query);
  query = query.order(orderBy, { ascending, nullsFirst: false }).limit(limit);
  const rows = unwrap(await query, "Could not load records.");
  const ids = [...new Set(rows.map((r) => r.project_id).filter(Boolean))];
  const projects = ids.length
    ? unwrap(await supabase.from("pt_project_list").select("id, name, project_code, client_name, company_id, company_name, archived_at").in("id", ids), "Could not load projects.")
    : [];
  const byId = new Map(projects.map((p) => [p.id, p]));
  let out = rows.map((r) => ({ ...r, project: byId.get(r.project_id) || null })).filter((r) => r.project && (includeArchived || !r.project.archived_at));
  if (companyId) out = out.filter((r) => r.project.company_id === companyId);
  const s = sanitizeSearch(q).toLowerCase();
  if (s) {
    out = out.filter((r) => JSON.stringify([r, r.project]).toLowerCase().includes(s));
  }
  return out;
}

// ------------------------------------------------------------------ complete report
const REPORT_TABLES = [
  ["hosting", "pt_hosting"], ["domains", "pt_domains"], ["emails", "pt_email_accounts"], ["access", "pt_access_records"],
  ["backups", "pt_backups"], ["repositories", "pt_repositories"], ["deployments", "pt_deployments"], ["updates", "pt_updates"],
  ["amc", "pt_amc_contracts"], ["renewals", "pt_renewals"], ["seo", "pt_seo_records"], ["milestones", "pt_milestones"],
  ["tasks", "pt_tasks"], ["documents", "pt_documents"],
];
export async function getProjectBundle(projectId) {
  const project = await getProject(projectId);
  if (!project) return null;
  const results = await Promise.all(REPORT_TABLES.map(([, t]) => listRecords(t, projectId)));
  const bundle = { project };
  REPORT_TABLES.forEach(([key], i) => { bundle[key] = results[i]; });
  const ho = await getHandover(projectId);
  bundle.handover = ho.handover;
  bundle.handoverItems = ho.items;
  bundle.handoverEvents = ho.events;
  return bundle;
}

// ------------------------------------------------------------------ members
export async function listMembers() {
  return unwrap(await supabase.rpc("pt_list_members"), "Could not load role assignments.");
}

export async function setMemberRole(email, role, note) {
  unwrap(await supabase.rpc("pt_set_member_role", { p_email: email, p_role: role, p_note: note || null }), "Could not change the role.");
}

// ------------------------------------------------------------------ companies
const COMPANY_SORTABLE = new Set(["serial_no", "company_number", "company_name", "company_code", "city", "status",
  "total_projects", "live_projects", "in_progress_projects", "updated_at"]);

/** opts: { q, state: "active" | "archived" | "all", status, sort, dir, page, pageSize } */
export async function listCompanies(opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(opts.pageSize) || 20));
  let q = supabase.from("pt_company_summary").select("*", { count: "exact" });
  const search = sanitizeSearch(opts.q);
  if (search) q = q.or(`company_name.ilike.*${search}*,company_code.ilike.*${search}*,company_number.ilike.*${search}*,city.ilike.*${search}*,contact_person.ilike.*${search}*`);
  if (opts.state === "archived") q = q.not("archived_at", "is", null);
  else if (opts.state !== "all") q = q.is("archived_at", null);
  if (opts.status) q = q.eq("status", opts.status);
  const sort = COMPANY_SORTABLE.has(opts.sort) ? opts.sort : "company_name";
  q = q.order(sort, { ascending: opts.dir ? opts.dir === "asc" : sort === "company_name", nullsFirst: false }).order("serial_no", { ascending: true });
  q = q.range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw toTrackerError(error, "Could not load companies.");
  return { rows: data || [], count: count ?? 0, page, pageSize };
}

export async function getCompany(id) {
  const rows = unwrap(await supabase.from("pt_company_summary").select("*").eq("id", id).limit(1), "Could not load the company.");
  return rows[0] || null;
}

/** Active companies for selects (id, name, number). */
export async function listCompanyOptions({ includeId } = {}) {
  const rows = unwrap(
    await supabase.from("pt_companies").select("id, company_name, company_number, archived_at").order("company_name", { ascending: true }).limit(5000),
    "Could not load companies.",
  );
  return rows.filter((c) => !c.archived_at || c.id === includeId);
}

export async function createCompany(values) {
  const rows = unwrap(await supabase.from("pt_companies").insert(cleanValues(values)).select("id, company_number"), "Could not create the company.");
  return rows[0];
}

/** Activity of a company: company events + events of its projects. */
export async function listCompanyActivity(companyId, projectIds, { limit = 10 } = {}) {
  let q = supabase.from("pt_activity_logs").select("*").order("created_at", { ascending: false }).limit(limit);
  const ids = (projectIds || []).filter(Boolean);
  q = ids.length ? q.or(`entity_id.eq.${companyId},project_id.in.(${ids.join(",")})`) : q.eq("entity_id", companyId);
  return unwrap(await q, "Could not load activity.");
}

// ------------------------------------------------------------------ settings
/** { password_backend, max_document_mb, reveal_seconds, reauth_minutes } or null before migration 004. */
export async function getSettings() {
  const { data, error } = await supabase.rpc("pt_settings_public");
  if (error) {
    const e = toTrackerError(error);
    if (e.kind === "not_installed") return null;
    throw e;
  }
  return data || null;
}

// ------------------------------------------------------------------ passwords (vault-backed; server-authorized)
// The browser never receives a password except from an explicit, logged
// reveal/copy call made by a manager with a recent sign-in. Nothing here
// stores, caches or logs a password.
export async function setAccessPassword(recordId, password) {
  unwrap(await supabase.rpc("pt_set_access_password", { p_record: recordId, p_password: password }), "Could not save the password.");
}

/** Returns { ok, password?, reason?, expires_in? }. reason: disabled | forbidden | reauth_required | rate_limited | no_password */
export async function revealAccessPassword(recordId, purpose = "reveal") {
  return unwrap(await supabase.rpc("pt_reveal_access_password", { p_record: recordId, p_purpose: purpose }), "Could not load the password.");
}

export async function clearAccessPassword(recordId) {
  unwrap(await supabase.rpc("pt_clear_access_password", { p_record: recordId }), "Could not remove the password.");
}

/** Confirms the signed-in user's own password; the new session carries a fresh sign-in time. */
export async function reauthenticate(password) {
  const { data } = await supabase.auth.getUser();
  const email = data?.user?.email;
  if (!email) throw new TrackerError("You are not signed in.", { kind: "forbidden" });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new TrackerError("That password is not correct.", { kind: "forbidden" });
}

export async function ensureEmailCredential(emailAccountId) {
  return unwrap(await supabase.rpc("pt_ensure_email_credential", { p_email: emailAccountId }), "Could not create the credential.");
}

export async function ensureHostingCredential(hostingId) {
  return unwrap(await supabase.rpc("pt_ensure_hosting_credential", { p_hosting: hostingId }), "Could not create the credential.");
}

// ------------------------------------------------------------------ documents: versions, audit, upload with progress
export async function logDocumentAccess(documentId, action) {
  unwrap(await supabase.rpc("pt_log_document_access", { p_document: documentId, p_action: action }), "Could not record the document access.");
}

export async function listDocumentVersions(versionGroupId) {
  return unwrap(
    await supabase.from("pt_documents").select("*").eq("version_group_id", versionGroupId).order("created_at", { ascending: false }),
    "Could not load the version history.",
  );
}

/** Upload to private storage with progress (0–100), then save the document row. */
export async function uploadDocumentWithProgress(projectId, file, meta, onProgress, { maxMb = 50 } = {}) {
  const problem = checkUpload(file, maxMb);
  if (problem) throw new TrackerError(problem, { kind: "validation" });
  const safeName = sanitizeFileName(file.name);
  const path = `${projectId}/${crypto.randomUUID()}/${safeName}`;
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new TrackerError("Your session has expired. Sign in again.", { kind: "forbidden" });
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${DOCS_BUCKET}/${encoded}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=0");
    xhr.setRequestHeader("Content-Type", uploadContentType(file));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((100 * e.loaded) / e.total)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(100); resolve(); return; }
      let msg = "The upload was refused.";
      try { const j = JSON.parse(xhr.responseText); msg = j.message || j.error || msg; } catch { /* keep default */ }
      if (/mime|type/i.test(msg)) msg = "This file type is not allowed.";
      else if (/size|large|exceed/i.test(msg)) msg = "The file is too large.";
      else if (/bucket not found/i.test(msg)) msg = "Document storage has not been set up on this backend yet.";
      else if (/row-level security|policy|unauthor/i.test(msg)) msg = "You do not have permission to upload to this project.";
      reject(new TrackerError(msg, { kind: "validation" }));
    };
    xhr.onerror = () => reject(new TrackerError("Network error during upload.", { kind: "error" }));
    xhr.send(file);
  });
  try {
    const rows = unwrap(
      await supabase.from("pt_documents").insert({
        ...cleanValues(meta), project_id: projectId, storage_path: path, file_name: safeName, mime_type: uploadContentType(file), size_bytes: file.size,
      }).select("*"),
      "Could not save the document.",
    );
    return rows[0];
  } catch (e) {
    await supabase.storage.from(DOCS_BUCKET).remove([path]).catch(() => {});
    throw e;
  }
}

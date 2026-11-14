// The ten Project Tracker reports. Each loads rows (under RLS, as the signed-in
// user) and lists exactly which columns are shown and exported. No report has
// a column for credential references, storage paths or document links.
import { supabase } from "@/lib/supabase/client";
import { listAcrossProjects, listDueItems, toTrackerError } from "@/lib/api/admin/projectTracker";
import * as O from "./lib/options";
import { daysUntil } from "./lib/format";

const proj = [
  { key: "company", label: "Company", text: (r) => r.project?.company_name ?? r.company_name ?? "Unassigned" },
  { key: "project_code", label: "Project ID", text: (r) => r.project?.project_code ?? r.project_code },
  { key: "project_name", label: "Project", text: (r) => r.project?.name ?? r.name },
];
const company = { key: "company_name", label: "Company", text: (r) => r.company_name || "Unassigned" };
const days = (key) => ({ key: `${key}_days`, label: "Days left", text: (r) => (r[key] ? String(daysUntil(r[key])) : "") });
const t = (key, label, extra = {}) => ({ key, label, ...extra });

async function projectList(companyId) {
  let q = supabase.from("pt_project_list").select("*").is("archived_at", null);
  if (companyId) q = q.eq("company_id", companyId);
  const { data, error } = await q.order("company_name", { ascending: true, nullsFirst: false }).order("serial_no", { ascending: true }).limit(5000);
  if (error) throw toTrackerError(error, "Could not load projects.");
  return data || [];
}

async function companySummaries(companyId) {
  let q = supabase.from("pt_company_summary").select("*").is("archived_at", null);
  if (companyId) q = q.eq("id", companyId);
  const { data, error } = await q.order("company_name", { ascending: true }).limit(5000);
  if (error) throw toTrackerError(error, "Could not load companies.");
  return data || [];
}

export const REPORTS = [
  {
    key: "project",
    title: "Complete Project Information Report",
    description: "Everything recorded for one project, section by section (opens the project report).",
    perProject: true,
  },
  {
    key: "companies",
    title: "All Companies Report",
    description: "Every active company with its contact details and project counts.",
    load: ({ companyId }) => companySummaries(companyId),
    columns: [t("company_number", "Company ID"), t("company_name", "Company"), t("company_code", "Code"), t("company_type", "Type", { options: O.COMPANY_TYPE }),
      t("status", "Status", { options: O.COMPANY_STATUS }), t("contact_person", "Contact person"), t("contact_email", "Contact email"),
      t("contact_phone", "Contact phone"), t("city", "City"), t("state", "State"), t("country", "Country"), t("website", "Website"),
      t("total_projects", "Projects"), t("live_projects", "Live"), t("in_progress_projects", "In progress")],
  },
  {
    key: "company_summary",
    title: "Company Project Summary",
    description: "Project counts per company by status, with pending handovers.",
    load: ({ companyId }) => companySummaries(companyId),
    columns: [t("company_number", "Company ID"), t("company_name", "Company"), t("total_projects", "Total projects"), t("live_projects", "Live"),
      t("in_progress_projects", "In progress"), t("maintenance_projects", "Under maintenance"), t("completed_projects", "Completed"),
      t("other_projects", "Planned / testing / review / on hold"), t("pending_handover_projects", "Pending handover"), t("archived_projects", "Archived"),
      t("last_project_activity_at", "Last project activity", { format: "datetime" })],
  },
  {
    key: "company_register",
    title: "Complete Company Project Register",
    description: "Every active project grouped by company, with status, URLs and documentation completeness.",
    load: ({ companyId }) => projectList(companyId),
    columns: [company, t("project_code", "Project ID"), t("name", "Project"), t("category", "Type", { options: O.PROJECT_CATEGORY }),
      t("status", "Status", { options: O.PROJECT_STATUS }), t("priority", "Priority", { options: O.PRIORITY }), t("progress", "Progress %"),
      t("responsible_person", "Responsible"), t("start_date", "Start", { format: "date" }), t("actual_completion_date", "Completed", { format: "date" }),
      t("live_url", "Live URL"), t("staging_url", "Review URL"), t("completeness_score", "Documentation %"),
      t("completeness_label", "Documentation", { options: O.COMPLETENESS }), t("handover_status", "Handover", { options: O.HANDOVER_STATUS })],
  },
  {
    key: "hosting",
    title: "Project Hosting Register",
    description: "All active hosting records across projects.",
    load: ({ companyId }) => listAcrossProjects("pt_hosting", { companyId,  orderBy: "provider", ascending: true }),
    columns: [...proj, t("provider", "Provider"), t("purpose", "Purpose", { options: O.HOSTING_PURPOSE }), t("environment", "Environment", { options: O.ENVIRONMENT }),
      t("hosting_type", "Type"), t("account_email", "Account email"), t("account_owner", "Account owner"), t("server_host", "Server / IP"), t("server_region", "Region"),
      t("renewal_date", "Renewal", { format: "date" }), t("expiry_date", "Expiry", { format: "date" }), t("auto_renew", "Auto renew", { format: "yesno" }),
      t("status", "Status", { options: O.HOSTING_STATUS }), t("responsible_person", "Responsible")],
  },
  {
    key: "domains",
    title: "Domain Expiry Report",
    description: "Domains and SSL certificates ordered by domain expiry.",
    load: ({ companyId }) => listAcrossProjects("pt_domains", { companyId,  orderBy: "expires_on", ascending: true }),
    columns: [...proj, t("domain_name", "Domain"), t("domain_role", "Role", { options: O.DOMAIN_ROLE }), t("registrar", "Registrar"),
      t("expires_on", "Domain expiry", { format: "date" }), days("expires_on"), t("auto_renew", "Auto renew", { format: "yesno" }),
      t("ssl_type", "SSL type", { options: O.SSL_TYPE }), t("ssl_expires_on", "SSL expiry", { format: "date" }), days("ssl_expires_on"),
      t("ownership", "Ownership", { options: O.OWNERSHIP }), t("status", "Status", { options: O.DOMAIN_STATUS })],
  },
  {
    key: "hosting_renewals",
    title: "Hosting Renewal Report",
    description: "Hosting renewals and expiries due within the selected window (plus anything overdue).",
    windowed: true,
    load: async ({ within, companyId }) => (await listDueItems({ within, kind: "hosting" })).filter((d) => !companyId || d.company_id === companyId),
    columns: [company, t("project_code", "Project ID"), t("project_name", "Project"), t("label", "Hosting"),
      t("due_date", "Due", { format: "date" }), { key: "days", label: "Days left", text: (r) => String(daysUntil(r.due_date)) },
      t("auto_renew", "Auto renew", { format: "yesno" }), t("responsible_person", "Responsible")],
  },
  {
    key: "emails",
    title: "Email Account Inventory",
    description: "Every recorded mailbox (no passwords — those live in the password manager).",
    load: ({ companyId }) => listAcrossProjects("pt_email_accounts", { companyId,  orderBy: "email_address", ascending: true }),
    columns: [...proj, t("email_address", "Email"), t("purpose", "Purpose", { options: O.EMAIL_PURPOSE }), t("provider", "Provider"),
      t("account_owner", "Owner"), t("responsible_person", "Responsible"), t("two_factor", "2FA", { options: O.TWO_FACTOR }),
      t("last_verified_on", "Last verified", { format: "date" }), t("status", "Status", { options: O.EMAIL_STATUS })],
  },
  {
    key: "backups",
    title: "Backup Status Report",
    description: "Per project: latest completed and verified backup, and alerts.",
    load: ({ companyId }) => projectList(companyId),
    columns: [company, t("project_code", "Project ID"), t("name", "Project"), t("status", "Project status", { options: O.PROJECT_STATUS }),
      t("backups_state", "Backups section", { options: O.SECTION_STATE }), t("last_backup_at", "Last completed backup", { format: "datetime" }),
      t("last_backup_verified_on", "Last verified", { format: "date" }), t("backup_missing", "Missing backups", { format: "yesno" }),
      t("backup_verification_overdue", "Verification overdue", { format: "yesno" })],
  },
  {
    key: "amc",
    title: "AMC Renewal Report",
    description: "AMC contracts with end and renewal dates.",
    load: ({ companyId }) => listAcrossProjects("pt_amc_contracts", { companyId,  orderBy: "end_date", ascending: true }),
    columns: [...proj, t("contract_number", "Contract"), t("status", "Status", { options: O.AMC_STATUS }), t("start_date", "Start", { format: "date" }),
      t("end_date", "End", { format: "date" }), days("end_date"), t("renewal_date", "Renewal", { format: "date" }),
      t("maintenance_frequency", "Frequency", { options: O.MAINT_FREQUENCY }), t("contract_value", "Value"), t("currency", "Currency"),
      t("client_contact", "Client contact"), t("responsible_person", "Responsible")],
  },
  {
    key: "missing",
    title: "Missing Information Report",
    description: "Documentation completeness of every active project, section by section.",
    load: async ({ companyId }) => (await projectList(companyId)).sort((a, b) => a.completeness_score - b.completeness_score),
    columns: [company, t("project_code", "Project ID"), t("name", "Project"), t("status", "Status", { options: O.PROJECT_STATUS }),
      t("completeness_score", "Score %"), t("completeness_label", "Completeness", { options: O.COMPLETENESS }),
      t("overview_state", "Overview", { options: O.SECTION_STATE }), t("hosting_state", "Hosting", { options: O.SECTION_STATE }),
      t("domain_state", "Domain", { options: O.SECTION_STATE }), t("admin_access_state", "Admin access", { options: O.SECTION_STATE }),
      t("backups_state", "Backups", { options: O.SECTION_STATE }), t("source_state", "Source", { options: O.SECTION_STATE }),
      t("maintenance_state", "Maintenance", { options: O.SECTION_STATE }), t("amc_state", "AMC", { options: O.SECTION_STATE }),
      t("seo_state", "SEO", { options: O.SECTION_STATE }), t("handover_state", "Handover", { options: O.SECTION_STATE })],
  },
  {
    key: "updates",
    title: "Project Update History",
    description: "All logged updates and maintenance, newest first.",
    load: ({ companyId }) => listAcrossProjects("pt_updates", { companyId,  orderBy: "update_date", ascending: false }),
    columns: [...proj, t("update_code", "Update ID"), t("update_date", "Date", { format: "date" }), t("update_type", "Type", { options: O.UPDATE_TYPE }),
      t("description", "Description"), t("version", "Version"), t("environment", "Environment", { options: O.ENVIRONMENT }),
      t("testing_status", "Testing", { options: O.TESTING_STATUS }), t("approval_status", "Approval", { options: O.APPROVAL_STATUS }),
      t("updated_by_name", "Updated by"), t("next_action", "Next action")],
  },
  {
    key: "handover",
    title: "Handover Readiness Report",
    description: "Handover status and checklist progress for every active project.",
    load: async ({ companyId }) => {
      const [projects, hos, items] = await Promise.all([
        projectList(companyId),
        supabase.from("pt_handovers").select("id, project_id, status, recipient_name, handover_date, approved_at, handed_over_at").is("archived_at", null),
        supabase.from("pt_handover_items").select("handover_id, state"),
      ]);
      if (hos.error) throw toTrackerError(hos.error);
      if (items.error) throw toTrackerError(items.error);
      const byProject = new Map((hos.data || []).map((h) => [h.project_id, h]));
      const counts = new Map();
      for (const it of items.data || []) {
        const c = counts.get(it.handover_id) || { done: 0, total: 0 };
        c.total += 1;
        if (it.state !== "pending") c.done += 1;
        counts.set(it.handover_id, c);
      }
      return projects.map((p) => {
        const h = byProject.get(p.id);
        const c = h ? counts.get(h.id) : null;
        return { ...p, ho: h, ho_items: c ? `${c.done} / ${c.total}` : "" };
      });
    },
    columns: [company, t("project_code", "Project ID"), t("name", "Project"), t("status", "Project status", { options: O.PROJECT_STATUS }),
      t("handover_state", "Handover section", { options: O.SECTION_STATE }),
      { key: "ho_status", label: "Handover status", text: (r) => (r.ho ? O.labelOf(O.HANDOVER_STATUS, r.ho.status) : "Not started") },
      t("ho_items", "Checklist done"),
      { key: "ho_recipient", label: "Recipient", text: (r) => r.ho?.recipient_name || "" },
      { key: "ho_date", label: "Handover date", text: (r) => r.ho?.handover_date || "" },
      { key: "ho_done", label: "Handed over", text: (r) => (r.ho?.handed_over_at ? r.ho.handed_over_at.slice(0, 10) : "") }],
  },
];

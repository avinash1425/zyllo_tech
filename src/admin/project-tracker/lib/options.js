// Project Tracker option lists. Values MUST match the CHECK constraints in
// supabase/project-tracker/001_project_tracker_schema.sql (tests/pt-options
// test verifies this). Pure module: no imports, usable from node tests.

const o = (pairs) => pairs.map(([value, label]) => ({ value, label }));

export const PROJECT_STATUS = o([
  ["planned", "Planned"],
  ["in_progress", "In Progress"],
  ["under_testing", "Under Testing"],
  ["under_client_review", "Under Client Review"],
  ["live", "Live"],
  ["under_maintenance", "Under Maintenance"],
  ["completed", "Completed"],
  ["on_hold", "On Hold"],
  ["archived", "Archived"],
  ["cancelled", "Cancelled"],
]);
// "Archived" is set only through Archive, never chosen in a form.
export const PROJECT_STATUS_EDITABLE = PROJECT_STATUS.filter((s) => s.value !== "archived");

export const COMPANY_TYPE = o([
  ["private_limited", "Private Limited"], ["public_limited", "Public Limited"], ["llp", "LLP"], ["partnership", "Partnership"],
  ["proprietorship", "Proprietorship"], ["government", "Government"], ["non_profit", "Non-profit / Trust"], ["educational", "Educational"],
  ["individual", "Individual"], ["other", "Other"],
]);
export const COMPANY_STATUS = o([
  ["active", "Active"], ["prospect", "Prospect"], ["inactive", "Inactive"], ["former_client", "Former client"],
]);

export const PROJECT_CATEGORY = o([
  ["website", "Website"],
  ["erp", "ERP"],
  ["web_application", "Web Application"],
  ["mobile_application", "Mobile Application"],
  ["amc_application", "AMC Application"],
  ["other", "Other"],
]);

export const PRIORITY = o([
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["critical", "Critical"],
]);

export const NA_SECTIONS = o([
  ["hosting", "Hosting"],
  ["domain", "Domain"],
  ["admin_access", "Admin access"],
  ["backups", "Backups"],
  ["source", "Source code"],
  ["maintenance", "Maintenance"],
  ["handover", "Handover"],
]);

export const HOSTING_PROVIDERS = [
  "Lovable", "Hostinger Shared Hosting", "Hostinger VPS", "cPanel", "Vercel", "Cloudflare", "Render", "Neon",
  "Supabase", "AWS", "DigitalOcean", "Other",
];
export const HOSTING_PURPOSE = o([
  ["frontend", "Frontend"], ["backend", "Backend"], ["database", "Database"], ["email", "Email"], ["storage", "Storage"], ["other", "Other"],
]);
export const ENVIRONMENT = o([["production", "Production"], ["staging", "Staging"], ["development", "Development"]]);
export const HOSTING_STATUS = o([
  ["active", "Active"], ["inactive", "Inactive"], ["migrated", "Migrated"], ["expired", "Expired"], ["cancelled", "Cancelled"],
]);

export const DOMAIN_ROLE = o([["primary", "Primary"], ["secondary", "Secondary"], ["subdomain", "Subdomain"]]);
export const SSL_TYPE = o([
  ["none", "None"], ["dv", "Domain Validated (DV)"], ["ov", "Organisation Validated (OV)"], ["ev", "Extended Validation (EV)"],
  ["wildcard", "Wildcard"], ["managed_auto", "Managed / auto-issued"], ["other", "Other"],
]);
export const DOMAIN_STATUS = o([
  ["active", "Active"], ["pending", "Pending"], ["expired", "Expired"], ["transferred", "Transferred"], ["parked", "Parked"], ["cancelled", "Cancelled"],
]);
export const OWNERSHIP = o([["client", "Client"], ["zyllo_tech", "Zyllo Tech"], ["third_party", "Third party"], ["unknown", "Unknown"]]);
export const DOMAIN_HANDOVER = o([
  ["not_started", "Not started"], ["in_progress", "In progress"], ["handed_over", "Handed over"], ["not_applicable", "Not applicable"],
]);

export const ACCESS_CATEGORY = o([
  ["email_account", "Email Account"], ["hosting_panel", "Hosting Account / Control Panel"], ["website_admin", "Website Admin"],
  ["supabase", "Supabase"], ["database", "Database"], ["domain_registrar", "Domain Registrar"], ["github", "GitHub"],
  ["cpanel", "cPanel"], ["vps_ssh", "VPS / SSH"], ["cloudflare", "Cloudflare"], ["vercel", "Vercel"], ["render", "Render"],
  ["third_party", "Third-Party Service"], ["api_service", "API Service"], ["other", "Other Project Service"],
]);
// Credential groups used for the category filter in Credentials & Access.
export const CREDENTIAL_GROUPS = [
  { value: "email_account", label: "Email" }, { value: "hosting_panel", label: "Hosting" }, { value: "website_admin", label: "Website admin" },
  { value: "supabase", label: "Supabase" }, { value: "database", label: "Database" }, { value: "domain_registrar", label: "Registrar" },
  { value: "github", label: "GitHub" },
  { value: "other_services", label: "Other services", includes: ["cpanel", "vps_ssh", "cloudflare", "vercel", "render", "third_party", "api_service", "other"] },
];
export const PASSWORD_BACKEND = o([
  ["disabled", "Disabled — no secure vault configured"], ["supabase_vault", "Supabase Vault (encrypted)"], ["test_double", "TEST DOUBLE — not encrypted"],
]);
export const TWO_FACTOR = o([["enabled", "Enabled"], ["disabled", "Disabled"], ["not_supported", "Not supported"], ["unknown", "Unknown"]]);
export const ACCESS_STATUS = o([
  ["active", "Active"], ["pending", "Pending"], ["disabled", "Disabled"], ["revoked", "Revoked"], ["handed_over", "Handed over"],
]);

export const EMAIL_PURPOSE = o([
  ["admin", "Admin"], ["support", "Support"], ["billing", "Billing"], ["info", "Info"], ["sales", "Sales"], ["noreply", "No-reply"],
  ["hr", "HR"], ["personal", "Personal"], ["other", "Other"],
]);
export const EMAIL_STATUS = o([
  ["active", "Active"], ["pending", "Pending"], ["inactive", "Inactive"], ["suspended", "Suspended"], ["deleted_at_provider", "Deleted at provider"],
]);

export const BACKUP_TYPE = o([
  ["database", "Database"], ["files", "Files"], ["full_server", "Full Server"], ["source_code", "Source Code"], ["other", "Other"],
]);
export const BACKUP_METHOD = o([["automatic", "Automatic"], ["manual", "Manual"]]);
export const BACKUP_FREQUENCY = o([
  ["hourly", "Hourly"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"],
  ["on_demand", "On demand"], ["other", "Other"],
]);
export const ENCRYPTION = o([["encrypted", "Encrypted"], ["not_encrypted", "Not encrypted"], ["unknown", "Unknown"]]);
export const BACKUP_STATUS = o([
  ["scheduled", "Scheduled"], ["completed", "Completed"], ["verified", "Verified"], ["failed", "Failed"],
]);

export const GIT_PROVIDER = o([
  ["github", "GitHub"], ["gitlab", "GitLab"], ["bitbucket", "Bitbucket"], ["azure_devops", "Azure DevOps"], ["lovable", "Lovable"], ["other", "Other"],
]);
export const VISIBILITY = o([["private", "Private"], ["internal", "Internal"], ["public", "Public"]]);
export const REPO_STATUS = o([
  ["active", "Active"], ["read_only", "Read-only"], ["transferred", "Transferred"], ["archived_at_provider", "Archived at provider"],
]);
export const DEPLOY_STATUS = o([
  ["planned", "Planned"], ["in_progress", "In progress"], ["succeeded", "Succeeded"], ["failed", "Failed"], ["rolled_back", "Rolled back"],
]);

export const UPDATE_TYPE = o([
  ["maintenance", "Maintenance"], ["bug_fix", "Bug fix"], ["security_update", "Security update"], ["content_change", "Content change"],
  ["feature", "Feature"], ["production_release", "Production release"], ["performance", "Performance"], ["configuration", "Configuration"],
  ["other", "Other"],
]);
export const TESTING_STATUS = o([
  ["not_tested", "Not tested"], ["in_testing", "In testing"], ["passed", "Passed"], ["failed", "Failed"], ["not_required", "Not required"],
]);
export const APPROVAL_STATUS = o([
  ["not_required", "Not required"], ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"],
]);

export const AMC_STATUS = o([
  ["draft", "Draft"], ["active", "Active"], ["expired", "Expired"], ["renewed", "Renewed"], ["cancelled", "Cancelled"],
]);
export const MAINT_FREQUENCY = o([
  ["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["half_yearly", "Half-yearly"], ["yearly", "Yearly"],
  ["on_call", "On call"], ["other", "Other"],
]);
export const RENEWAL_ITEM = o([
  ["hosting", "Hosting"], ["domain", "Domain"], ["ssl", "SSL"], ["email_service", "Email service"], ["amc", "AMC"],
  ["subscription", "Subscription"], ["other", "Other"],
]);
export const RENEWAL_STATUS = o([
  ["upcoming", "Upcoming"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["lapsed", "Lapsed"],
]);

export const SEO_STATUS = o([
  ["not_started", "Not started"], ["in_progress", "In progress"], ["active", "Active"], ["paused", "Paused"], ["completed", "Completed"],
]);
export const VERIFICATION_METHOD = o([
  ["html_tag", "HTML meta tag"], ["html_file", "HTML file"], ["dns_txt", "DNS TXT record"], ["google_analytics", "Google Analytics"],
  ["tag_manager", "Tag Manager"], ["domain_provider", "Domain provider"], ["other", "Other"],
]);
export const VERIFICATION_STATUS = o([
  ["not_started", "Not started"], ["pending", "Pending"], ["verified", "Verified"], ["failed", "Failed"], ["lost", "Verification lost"],
]);
export const AEO_GEO_STATUS = o([
  ["not_started", "Not started"], ["in_progress", "In progress"], ["active", "Active"], ["not_applicable", "Not applicable"],
]);

export const TASK_STATUS = o([
  ["todo", "To do"], ["in_progress", "In progress"], ["blocked", "Blocked"], ["done", "Done"], ["cancelled", "Cancelled"],
]);
export const MILESTONE_STATUS = o([
  ["planned", "Planned"], ["in_progress", "In progress"], ["completed", "Completed"], ["missed", "Missed"], ["cancelled", "Cancelled"],
]);

export const DOCUMENT_CATEGORY = o([
  ["requirements", "Requirements"], ["scope_of_work", "Scope of Work"], ["agreement", "Agreement"],
  ["technical_documentation", "Technical Documentation"], ["design_documents", "Design Documents"],
  ["hosting_documentation", "Hosting Documentation"], ["domain_documentation", "Domain Documentation"],
  ["admin_access_handover", "Admin Access Handover"], ["backup_restore_instructions", "Backup / Restore Instructions"],
  ["testing_reports", "Testing Reports"], ["user_guide", "User Guide"], ["training_material", "Training Material"],
  ["training_recording", "Training Recording"], ["client_approval", "Client Approval"], ["completion_certificate", "Completion Certificate"],
  ["amc_agreement", "AMC Agreement"], ["seo_audit", "SEO Audit"], ["other", "Other"],
]);
export const CLASSIFICATION = o([
  ["internal", "Internal"], ["confidential", "Confidential"], ["restricted", "Restricted (managers only)"], ["client_shareable", "Client-shareable"],
]);

export const HANDOVER_STATUS = o([
  ["draft", "Draft"], ["ready_for_review", "Ready for Review"], ["approved", "Approved"], ["handed_over", "Handed Over"],
]);
export const HANDOVER_ITEMS = o([
  ["client_approval", "Client approval"],
  ["production_verified", "Production website verified"],
  ["domain_documented", "Domain details documented"],
  ["hosting_documented", "Hosting details documented"],
  ["admin_access_handed_over", "Admin access securely handed over"],
  ["email_documented", "Email account details documented"],
  ["repository_documented", "Repository details documented"],
  ["latest_backup_verified", "Latest backup verified"],
  ["restore_instructions", "Restore instructions provided"],
  ["user_guide", "User guide provided"],
  ["training_completed", "Training completed"],
  ["amc_terms_documented", "AMC terms documented"],
  ["recipient_confirmed", "Handover recipient confirmed"],
  ["handover_date_recorded", "Handover date recorded"],
  ["signed_approval_attached", "Signed approval document attached"],
]);
export const HANDOVER_ITEM_STATE = o([["pending", "Pending"], ["done", "Done"], ["not_applicable", "Not applicable"]]);
// Items the database will not let you mark "Not applicable".
export const HANDOVER_MANDATORY = ["client_approval", "signed_approval_attached", "recipient_confirmed", "handover_date_recorded"];

export const COMPLETENESS = o([
  ["complete", "Complete"], ["partial", "Partially Complete"], ["missing_critical", "Missing Critical Information"],
]);
export const SECTION_STATE = o([["complete", "Complete"], ["partial", "Partial"], ["missing", "Missing"], ["na", "Not applicable"]]);

export const DUE_KINDS = o([
  ["hosting", "Hosting renewal"], ["domain", "Domain renewal"], ["ssl", "SSL expiry"], ["amc", "AMC renewal"],
  ["email", "Email service"], ["subscription", "Subscription"], ["other", "Other renewal"],
]);
export const DUE_WINDOWS = [7, 15, 30, 45, 60];

export const PT_ROLES = o([
  ["viewer", "Viewer (read-only)"], ["editor", "Editor"], ["manager", "Manager"], ["no_access", "No access"], ["default", "Default (editor)"],
]);

/** Label for a value from one of the lists above (falls back to a humanised value). */
export function labelOf(list, value) {
  if (value === null || value === undefined || value === "") return "—";
  const hit = list.find((x) => x.value === value);
  if (hit) return hit.label;
  return String(value).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

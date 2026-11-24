import { supabase } from "@/lib/supabase/client";
import { fetchCompanies, fetchCompany } from "./projectTracker";
import { randomId } from "@/lib/randomId";

const LOGO_BUCKET = "pt-company-logos";
const LOGO_TTL = 60 * 60;

// One project's page: Access & Logins, Documents, Backups.
// Row Level Security limits every table to website admins (public.is_admin()).
// Passwords never travel through these tables: they are saved, revealed and
// removed only through the pt_credential_* database functions (Supabase Vault).

const DOC_BUCKET = "pt-project-documents";
export const MAX_DOC_BYTES = 25 * 1024 * 1024;

// ------------------------------------------------------------------ lists

export const CREDENTIAL_CATEGORIES = [
  { value: "code_repo", label: "Code repository", hint: "GitHub, GitLab, Bitbucket" },
  { value: "database", label: "Database", hint: "Supabase, Firebase, MySQL" },
  { value: "hosting", label: "Hosting / platform", hint: "Hostinger, Lovable, Vercel, Netlify" },
  { value: "domain", label: "Domain / DNS", hint: "GoDaddy, Cloudflare, Namecheap" },
  { value: "email", label: "Email account", hint: "Gmail, Zoho Mail, Outlook" },
  { value: "admin_login", label: "Admin login", hint: "Website / app admin panel" },
  { value: "backup_storage", label: "Backup storage", hint: "Google Drive, OneDrive, Dropbox" },
  { value: "other", label: "Other", hint: "Anything else" },
];

export const SERVICE_SUGGESTIONS = [
  "GitHub", "GitLab", "Bitbucket", "Supabase", "Firebase", "MySQL", "PostgreSQL", "Hostinger", "Lovable",
  "Vercel", "Netlify", "AWS", "Google Cloud", "Cloudflare", "GoDaddy", "Namecheap", "Gmail", "Google Workspace",
  "Zoho Mail", "Zoho Creator", "Outlook", "Google Drive", "OneDrive", "Dropbox", "WordPress", "Admin panel",
];

/**
 * Document sections. `commercial` ones carry a number (Quotation No., Invoice No. …),
 * are shown as columns on the dashboard, and can hold several documents per project.
 */
export const DOCUMENT_CATEGORIES = [
  { value: "quotation", label: "Quotations", single: "Quotation", commercial: true, numberLabel: "Quotation number", dateLabel: "Quotation date", types: ["Quotation", "Revised quotation", "Estimate"] },
  { value: "invoice", label: "Invoices", single: "Invoice", commercial: true, numberLabel: "Invoice number", dateLabel: "Invoice date", types: ["Tax invoice", "Proforma invoice", "Advance invoice", "Final invoice"] },
  { value: "sales_order", label: "Sales orders", single: "Sales order", commercial: true, numberLabel: "Sales order number", dateLabel: "Sales order date", types: ["Sales order", "Work order"] },
  { value: "purchase_order", label: "Purchase orders (from client)", single: "Purchase order", commercial: true, numberLabel: "PO number", dateLabel: "PO date", types: ["Purchase order", "Revised PO"] },
  { value: "handover", label: "Handover documents", types: ["User manual", "Training PPT", "Technical document", "Admin guide", "Deployment guide", "Handover checklist"] },
  { value: "mom", label: "MOMs (minutes of meeting)", prefix: "MOM", dateLabel: "Meeting date", types: ["Client meeting", "Kick-off meeting", "Review meeting", "Internal meeting"] },
  { value: "revision", label: "Revisions", prefix: "Rev", dateLabel: "Revision date", types: ["Change request", "Scope change", "Design revision", "Feature revision"] },
  { value: "other", label: "Other documents", types: ["Requirement document", "Design file", "Report", "Other"] },
];

export const COMMERCIAL_CATEGORIES = DOCUMENT_CATEGORIES.filter((c) => c.commercial);
export const documentCategory = (value) => DOCUMENT_CATEGORIES.find((c) => c.value === value);

/** Upload types: extension -> MIME type (the bucket enforces the same list). */
export const DOC_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
export const DOC_ACCEPT = Object.keys(DOC_TYPES).map((e) => `.${e}`).join(",");

// ---------------------------------------------------------------- helpers

function clean(input, fields) {
  const values = {};
  for (const field of fields) {
    const raw = input?.[field];
    const text = typeof raw === "string" ? raw.trim() : raw ?? "";
    values[field] = text === "" ? null : text;
  }
  return values;
}

const isHttp = (v) => /^https?:\/\/\S+$/i.test(v ?? "");
const dateOk = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);

function maxLen(values, limits, errors) {
  for (const [field, [max, label]] of Object.entries(limits)) {
    if (values[field] && values[field].length > max) errors[field] = `${label} must be at most ${max} characters.`;
  }
}

const SERVER_MESSAGES = {
  PT_NOT_ALLOWED: "You do not have permission to do this.",
  PT_NOT_FOUND: "This login no longer exists.",
  PT_PASSWORD_INVALID: "Enter a password (up to 1000 characters).",
  PT_REAUTH_REQUIRED: "Please confirm your login password to see saved passwords.",
  PT_RATE_LIMITED: "Too many passwords viewed in a short time. Please wait a few minutes.",
  PT_NO_PASSWORD: "No password is saved for this login.",
};

function friendly(error, fallback) {
  if (!error) return fallback;
  const code = Object.keys(SERVER_MESSAGES).find((k) => (error.message ?? "").includes(k));
  if (code) return SERVER_MESSAGES[code];
  if (error.code === "42501") return "You do not have permission to do this.";
  if (error.code === "23505" && /pt_documents_number_key/.test(error.message ?? "")) {
    return "This number is already used for this project.";
  }
  if (error.code === "23503") return "This item is still linked to other records.";
  if (["42P01", "PGRST205", "PGRST202", "42703", "42883"].includes(error.code)) {
    return "The Project Tracker database is not up to date yet.";
  }
  return fallback;
}

function fail(error, fallback, log) {
  if (error) console.error(log, error.message);
  return { status: "error", message: friendly(error, fallback) };
}

// ---------------------------------------------------------------- project

export async function fetchProjectPage(projectId) {
  const { data, error } = await supabase
    .from("pt_projects")
    .select("*, company:pt_companies(id, name, logo_path)")
    .eq("id", projectId)
    .maybeSingle();
  if (error) {
    console.error("Failed to load project:", error.message);
    throw new Error(friendly(error, "Could not load the project."));
  }
  if (!data) return data;
  // Resolve company logo path → signed URL (non-fatal if storage call fails)
  if (data.company?.logo_path) {
    const { data: signed } = await supabase.storage
      .from(LOGO_BUCKET)
      .createSignedUrls([data.company.logo_path], LOGO_TTL);
    const url = signed?.[0]?.signedUrl ?? null;
    data.company = { ...data.company, logo_url: url };
  } else if (data.company) {
    data.company = { ...data.company, logo_url: null };
  }
  return data;
}

// -------------------------------------------------------- access & logins

const CRED_COLUMNS =
  "id, project_id, category, service, account, email, repository, login_url, purpose, two_factor, notes, has_password, password_updated_at, created_at, updated_at";

/** Platform choices for the dropdowns in the "Add logins" form ("Other" lets you type one). */
export const PLATFORMS = {
  email: ["Gmail", "Google Workspace", "Zoho Mail", "Outlook / Microsoft 365", "Hostinger Mail", "GoDaddy Email"],
  hosting: [
    "Hostinger", "Lovable", "Vercel", "Netlify", "GoDaddy", "Bluehost", "Cloudflare Pages", "Firebase Hosting",
    "AWS", "Google Cloud", "Microsoft Azure", "DigitalOcean", "Render", "Railway",
  ],
  code_repo: ["GitHub", "GitLab", "Bitbucket", "Azure DevOps"],
  database: [
    "Supabase", "Firebase", "MySQL", "PostgreSQL", "MongoDB Atlas", "Neon", "PlanetScale",
    "Microsoft SQL Server", "phpMyAdmin (hosting)",
  ],
};

/** Web link for a repository: a URL as-is, or owner/repo on GitHub, GitLab or Bitbucket. */
export function repositoryUrl(service, repository) {
  if (!repository) return null;
  if (/^https?:\/\/\S+$/i.test(repository)) return repository;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) return null;
  const host = { GitHub: "github.com", GitLab: "gitlab.com", Bitbucket: "bitbucket.org" }[service];
  return host ? `https://${host}/${repository}` : null;
}

/** Saves the project's live site / domain URL (empty clears it). */
export async function updateProjectLiveUrl(projectId, url) {
  const value = (url ?? "").trim() || null;
  if (value && !isHttp(value)) return { status: "error", message: "The live site URL must start with http:// or https://" };
  if (value && value.length > 500) return { status: "error", message: "The live site URL is too long." };
  const { data, error } = await supabase.from("pt_projects").update({ live_url: value }).eq("id", projectId).select("id");
  if (error) return fail(error, "Could not save the live site URL.", "Failed to save live URL:");
  if (!data?.length) return { status: "error", message: "Project not found." };
  return { status: "success" };
}

export async function fetchCredentials(projectId) {
  const { data, error } = await supabase
    .from("pt_credentials")
    .select(CRED_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to load logins:", error.message);
    throw new Error(friendly(error, "Could not load logins."));
  }
  return data ?? [];
}

export function validateCredential(input) {
  const values = clean(input, ["category", "service", "account", "email", "repository", "login_url", "purpose", "notes"]);
  const errors = {};
  if (!CREDENTIAL_CATEGORIES.some((c) => c.value === values.category)) values.category = "other";
  if (!values.service) errors.service = "Service is required (e.g. GitHub).";
  maxLen(values, {
    service: [120, "Service"],
    account: [254, "Username / email"],
    email: [254, "Email"],
    repository: [300, "Repository"],
    login_url: [500, "Login URL"],
    purpose: [500, "Used for"],
    notes: [2000, "Notes"],
  }, errors);
  if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) errors.email = "Enter a valid email address.";
  if (values.repository && /\s/.test(values.repository)) errors.repository = "Use owner/repo or the repository link (no spaces).";
  if (values.login_url && !isHttp(values.login_url)) errors.login_url = "Login URL must start with http:// or https://";
  values.two_factor = Boolean(input?.two_factor);
  const password = typeof input?.password === "string" ? input.password : "";
  if (password.length > 1000) errors.password = "Password must be at most 1000 characters.";
  return { values, password, errors, ok: Object.keys(errors).length === 0 };
}

/** Creates a login; if a password was typed, it goes straight into the encrypted vault. */
export async function createCredential(projectId, input) {
  const { values, password, errors, ok } = validateCredential(input);
  if (!ok) return { status: "error", errors, message: "Please fix the highlighted fields." };
  const { data, error } = await supabase
    .from("pt_credentials")
    .insert({ ...values, project_id: projectId })
    .select("id")
    .single();
  if (error) return fail(error, "Could not save the login.", "Failed to create login:");
  if (password) {
    const saved = await setCredentialPassword(data.id, password);
    if (saved.status !== "success") {
      return { status: "partial", message: `Login saved, but the password was not: ${saved.message}` };
    }
  }
  return { status: "success" };
}

export async function updateCredential(id, input) {
  const { values, errors, ok } = validateCredential(input);
  if (!ok) return { status: "error", errors, message: "Please fix the highlighted fields." };
  const { data, error } = await supabase.from("pt_credentials").update(values).eq("id", id).select("id");
  if (error) return fail(error, "Could not update the login.", "Failed to update login:");
  if (!data?.length) return { status: "error", message: "This login no longer exists." };
  return { status: "success" };
}

export async function deleteCredential(id) {
  const { data, error } = await supabase.from("pt_credentials").delete().eq("id", id).select("id");
  if (error) return fail(error, "Could not delete the login.", "Failed to delete login:");
  if (!data?.length) return { status: "error", message: "This login no longer exists." };
  return { status: "success" };
}

export async function setCredentialPassword(id, password) {
  if (!password || password.length > 1000) return { status: "error", message: SERVER_MESSAGES.PT_PASSWORD_INVALID };
  const { error } = await supabase.rpc("pt_credential_set_password", { p_credential_id: id, p_password: password });
  if (error) return fail(error, "Could not save the password.", "Failed to save password:");
  return { status: "success" };
}

export async function removeCredentialPassword(id) {
  const { error } = await supabase.rpc("pt_credential_remove_password", { p_credential_id: id });
  if (error) return fail(error, "Could not remove the password.", "Failed to remove password:");
  return { status: "success" };
}

/**
 * Returns { status: "success", password } or { status: "reauth" } when the
 * database wants a fresh sign-in, or an error.
 */
export async function revealCredentialPassword(id, purpose = "view") {
  const { data, error } = await supabase.rpc("pt_credential_reveal_password", {
    p_credential_id: id,
    p_purpose: purpose === "copy" ? "copy" : "view",
  });
  if (error) {
    if ((error.message ?? "").includes("PT_REAUTH_REQUIRED")) return { status: "reauth" };
    return fail(error, "Could not get the password.", "Failed to reveal password:");
  }
  return { status: "success", password: data };
}

export async function fetchCredentialEvents(projectId, limit = 50) {
  const { data, error } = await supabase
    .from("pt_credential_events")
    .select("id, credential_label, action, actor_email, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("Failed to load the access log:", error.message);
    throw new Error(friendly(error, "Could not load the access log."));
  }
  return data ?? [];
}

// --------------------------------------------------------------- documents

const DOC_COLUMNS =
  "id, project_id, category, doc_type, ref_no, doc_number, title, doc_date, description, storage_path, file_name, file_size, mime_type, external_url, created_at, updated_at";

/** Quotations, invoices, sales orders and purchase orders of every project (for the dashboard). */
export async function fetchCommercialDocuments() {
  const { data, error } = await supabase
    .from("pt_documents")
    .select(DOC_COLUMNS)
    .in("category", COMMERCIAL_CATEGORIES.map((c) => c.value))
    .order("doc_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to load commercial documents:", error.message);
    throw new Error(friendly(error, "Could not load quotations, invoices and orders."));
  }
  return data ?? [];
}

export async function fetchDocuments(projectId) {
  const { data, error } = await supabase
    .from("pt_documents")
    .select(DOC_COLUMNS)
    .eq("project_id", projectId)
    .order("ref_no", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to load documents:", error.message);
    throw new Error(friendly(error, "Could not load documents."));
  }
  return data ?? [];
}

function fileExtension(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name ?? "");
  return m ? m[1].toLowerCase() : "";
}

/** Checks a chosen file: allowed type (by extension) and size. Returns an error message or null. */
export function checkDocumentFile(file) {
  if (!(file instanceof File) || file.size === 0) return "Choose a file.";
  const ext = fileExtension(file.name);
  if (!DOC_TYPES[ext]) return "Allowed: PDF, Word, Excel, PowerPoint, text, CSV, PNG, JPG, WEBP.";
  if (file.size > MAX_DOC_BYTES) return "Files can be up to 25 MB. For bigger files, save a link instead.";
  return null;
}

function safeFileName(name) {
  const ext = fileExtension(name);
  const base = name.replace(/\.[^.]+$/, "").normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 80) || "file";
  return ext ? `${base}.${ext}` : base;
}

export function validateDocument(input, { mode }) {
  const values = clean(input, ["category", "doc_type", "doc_number", "title", "doc_date", "description", "external_url"]);
  const errors = {};
  const section = documentCategory(values.category);
  if (!section) errors.category = "Choose a section.";
  if (section?.commercial) {
    if (!values.doc_number) errors.doc_number = `${section.numberLabel} is required.`;
    else if (values.doc_number.length > 60) errors.doc_number = "The number can be up to 60 characters.";
    // The title is optional for these: default to e.g. "Invoice INV-001".
    if (!values.title && values.doc_number) values.title = `${section.single} ${values.doc_number}`;
  } else {
    values.doc_number = null;
  }
  // Quotations / invoices / orders get a default title from their number.
  if (!values.title && !section?.commercial) errors.title = "Title is required.";
  maxLen(values, { doc_type: [80, "Type"], title: [200, "Title"], description: [2000, "Description"], external_url: [1000, "Link"] }, errors);
  if (!dateOk(values.doc_date)) errors.doc_date = "Enter a valid date.";
  if (mode === "link") {
    if (!values.external_url) errors.external_url = "Paste the link (e.g. a Google Drive share link).";
    else if (!isHttp(values.external_url)) errors.external_url = "The link must start with http:// or https://";
  } else {
    values.external_url = null;
  }
  return { values, errors, ok: Object.keys(errors).length === 0 };
}

/** Saves a document as an uploaded file (mode "file") or a link (mode "link"). */
export async function createDocument(projectId, input, { mode, file }) {
  const { values, errors, ok } = validateDocument(input, { mode });
  if (mode === "file") {
    const problem = checkDocumentFile(file);
    if (problem) errors.file = problem;
  }
  if (!ok || errors.file) return { status: "error", errors, message: "Please fix the highlighted fields." };

  let storage = {};
  if (mode === "file") {
    const ext = fileExtension(file.name);
    const path = `${projectId}/${randomId()}-${safeFileName(file.name)}`;
    const { error: upError } = await supabase.storage
      .from(DOC_BUCKET)
      .upload(path, file, { contentType: DOC_TYPES[ext], upsert: false, cacheControl: "3600" });
    if (upError) {
      console.error("Failed to upload document:", upError.message);
      return { status: "error", message: "Could not upload the file. Please try again." };
    }
    storage = { storage_path: path, file_name: file.name.slice(0, 255), file_size: file.size, mime_type: DOC_TYPES[ext] };
  }

  const { error } = await supabase.from("pt_documents").insert({ ...values, ...storage, project_id: projectId });
  if (error) {
    if (storage.storage_path) await supabase.storage.from(DOC_BUCKET).remove([storage.storage_path]);
    return fail(error, "Could not save the document.", "Failed to save document:");
  }
  return { status: "success" };
}

/** Edits the details (not the file). A link document may change its link. */
export async function updateDocument(doc, input) {
  const mode = doc.external_url ? "link" : "file";
  const { values, errors, ok } = validateDocument(input, { mode });
  if (!ok) return { status: "error", errors, message: "Please fix the highlighted fields." };
  if (mode === "file") delete values.external_url;
  const { data, error } = await supabase.from("pt_documents").update(values).eq("id", doc.id).select("id");
  if (error) return fail(error, "Could not update the document.", "Failed to update document:");
  if (!data?.length) return { status: "error", message: "This document no longer exists." };
  return { status: "success" };
}

export async function deleteDocument(doc) {
  const { data, error } = await supabase.from("pt_documents").delete().eq("id", doc.id).select("id");
  if (error) return fail(error, "Could not delete the document.", "Failed to delete document:");
  if (!data?.length) return { status: "error", message: "This document no longer exists." };
  if (doc.storage_path) {
    const { error: rmError } = await supabase.storage.from(DOC_BUCKET).remove([doc.storage_path]);
    if (rmError) console.error("Document record deleted but the file was not:", rmError.message);
  }
  return { status: "success" };
}

/** Short-lived private link to open or download an uploaded file. */
export async function documentFileUrl(doc, { download = false } = {}) {
  const { data, error } = await supabase.storage
    .from(DOC_BUCKET)
    .createSignedUrl(doc.storage_path, 60, download ? { download: doc.file_name || true } : undefined);
  if (error) {
    console.error("Failed to sign document link:", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

// ----------------------------------------------------------------- backups
//
// A fixed backup sheet per project: Complete code backup, Daily, Weekly, Monthly.
// Each row: kept (yes/no), where it is kept, link, last backup date, notes, and its
// login (username / email + encrypted password) as a 'backup_storage' login.

export const BACKUP_PLAN = [
  { key: "complete", title: "Complete code backup", hint: "Where the full code is backed up", askKept: false },
  { key: "daily", title: "Daily backup", hint: "Is a daily backup kept?", askKept: true },
  { key: "weekly", title: "Weekly backup", hint: "Is a weekly backup kept?", askKept: true },
  { key: "monthly", title: "Monthly backup", hint: "Is a monthly backup kept?", askKept: true },
];

const BACKUP_COLUMNS =
  "id, project_id, frequency, kept, location, link, backup_date, credential_id, notes, created_at, updated_at";

/** The backup rows of a project plus the logins they are linked to. */
export async function fetchBackupPlan(projectId) {
  const { data, error } = await supabase
    .from("pt_backups")
    .select(`${BACKUP_COLUMNS}, credential:pt_credentials(id, service, account, has_password, password_updated_at)`)
    .eq("project_id", projectId)
    .not("frequency", "is", null);
  if (error) {
    console.error("Failed to load backups:", error.message);
    throw new Error(friendly(error, "Could not load backups."));
  }
  return Object.fromEntries((data ?? []).map((row) => [row.frequency, row]));
}

/**
 * Validates one section of the backup form.
 * kept: "yes" | "no" | "" (not answered). The complete code backup is "yes" once anything is filled in.
 */
function checkBackupSection(plan, v) {
  const errors = {};
  const filled = ["location", "link", "account", "password", "backup_date", "notes"].some((k) => String(v[k] ?? "").trim());
  const kept = plan.askKept ? v.kept : filled ? "yes" : "";
  if (kept === "yes") {
    if (!String(v.location ?? "").trim()) errors.location = "Where is it kept? (e.g. Google Drive, GitHub, local drive)";
    if (String(v.location ?? "").trim().length > 120) errors.location = "At most 120 characters.";
    if (v.link?.trim() && !isHttp(v.link.trim())) errors.link = "The link must start with http:// or https://";
    if ((v.account ?? "").trim().length > 254) errors.account = "At most 254 characters.";
    if ((v.password ?? "").length > 1000) errors.password = "At most 1000 characters.";
    if (!dateOk(v.backup_date)) errors.backup_date = "Enter a valid date.";
    if ((v.notes ?? "").length > 2000) errors.notes = "At most 2000 characters.";
  }
  return { kept, errors };
}

export function validateBackupPlan(values) {
  const errors = {};
  for (const plan of BACKUP_PLAN) {
    const { errors: e } = checkBackupSection(plan, values[plan.key]);
    for (const [field, msg] of Object.entries(e)) errors[`${plan.key}.${field}`] = msg;
  }
  return errors;
}

/**
 * Saves every answered section. For a kept backup with a username or password, the login is
 * created (or updated) as a 'backup_storage' login and the password goes into the encrypted vault.
 * Returns { status: "success" | "partial" | "error", message, errors }.
 */
export async function saveBackupPlan(projectId, values, existing) {
  const errors = validateBackupPlan(values);
  if (Object.keys(errors).length) return { status: "error", errors, message: "Please fix the highlighted fields." };

  const problems = [];
  let saved = 0;
  for (const plan of BACKUP_PLAN) {
    const v = values[plan.key];
    const row = existing[plan.key];
    const { kept } = checkBackupSection(plan, v);
    if (!kept) continue; // not answered — leave as it is

    const record = {
      kept: kept === "yes",
      location: kept === "yes" ? v.location.trim() : null,
      link: kept === "yes" ? v.link?.trim() || null : null,
      backup_date: kept === "yes" ? v.backup_date || null : null,
      notes: kept === "yes" ? v.notes?.trim() || null : null,
    };

    // The login (username / email + encrypted password) for this backup.
    let credentialId = row?.credential_id ?? null;
    const account = (v.account ?? "").trim();
    const password = v.password ?? "";
    if (kept === "yes" && (account || password || credentialId)) {
      const login = {
        category: "backup_storage",
        service: record.location,
        account: account || null,
        purpose: `${plan.title} — ${record.location}`,
      };
      if (credentialId) {
        const { error } = await supabase.from("pt_credentials").update(login).eq("id", credentialId);
        if (error) problems.push(`${plan.title}: ${friendly(error, "could not update the login")}`);
      } else {
        const { data, error } = await supabase
          .from("pt_credentials")
          .insert({ ...login, project_id: projectId })
          .select("id")
          .single();
        if (error) problems.push(`${plan.title}: ${friendly(error, "could not save the login")}`);
        else credentialId = data.id;
      }
      if (credentialId && password) {
        const result = await setCredentialPassword(credentialId, password);
        if (result.status !== "success") problems.push(`${plan.title}: password not saved — ${result.message}`);
      }
    }

    const payload = { ...record, credential_id: kept === "yes" ? credentialId : row?.credential_id ?? null };
    const query = row
      ? supabase.from("pt_backups").update(payload).eq("id", row.id).select("id")
      : supabase.from("pt_backups").insert({ ...payload, project_id: projectId, frequency: plan.key, backup_type: "code" }).select("id");
    const { data, error } = await query;
    if (error || !data?.length) problems.push(`${plan.title}: ${friendly(error, "could not be saved")}`);
    else saved += 1;
  }

  if (!problems.length) return { status: "success", message: saved ? "Backup details saved." : "Nothing to save." };
  return { status: saved ? "partial" : "error", message: problems.join(" · ") };
}

/** Removes one backup row (its login stays in Access & Logins). */
export async function deleteBackup(id) {
  const { data, error } = await supabase.from("pt_backups").delete().eq("id", id).select("id");
  if (error) return fail(error, "Could not delete the backup.", "Failed to delete backup:");
  if (!data?.length) return { status: "error", message: "This backup no longer exists." };
  return { status: "success" };
}

// ------------------------------------------------- Access & Logins section

/** Companies with their logo, number of projects and number of logins. */
export async function fetchAccessCompanies() {
  const logins = await supabase.from("pt_credentials").select("id, project:pt_projects(company_id)");
  if (logins.error) {
    console.error("Failed to load logins:", logins.error.message);
    throw new Error(friendly(logins.error, "Could not load logins."));
  }
  const companies = await fetchCompanies();
  const perCompany = new Map();
  for (const l of logins.data ?? []) {
    const id = l.project?.company_id;
    if (id) perCompany.set(id, (perCompany.get(id) ?? 0) + 1);
  }
  return companies.map((c) => ({ ...c, login_count: perCompany.get(c.id) ?? 0 }));
}

/** One company and its projects, each with its number of logins. */
export async function fetchAccessProjects(companyId) {
  const company = await fetchCompany(companyId);
  if (!company) return { company: null, projects: [] };
  const { data, error } = await supabase
    .from("pt_projects")
    .select("id, project_code, name, project_type, status, live_url, created_at, pt_credentials(count)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to load projects:", error.message);
    throw new Error(friendly(error, "Could not load projects."));
  }
  const projects = (data ?? []).map(({ pt_credentials: creds, ...p }) => ({ ...p, login_count: creds?.[0]?.count ?? 0 }));
  return { company, projects };
}

/** Every login of every project of a company (for the company-wide Excel download). */
export async function fetchCompanyCredentials(companyId) {
  const { data, error } = await supabase
    .from("pt_credentials")
    .select(`${CRED_COLUMNS}, project:pt_projects!inner(id, project_code, name, live_url, company_id)`)
    .eq("project.company_id", companyId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to load company logins:", error.message);
    throw new Error(friendly(error, "Could not load logins."));
  }
  return data ?? [];
}

/**
 * Decrypted passwords for an Excel export. Returns { status: "success", passwords: Map(id -> password) },
 * { status: "reauth" } when a fresh sign-in is needed, or an error. Every exported password is logged.
 */
export async function exportCredentialPasswords(ids) {
  if (!ids.length) return { status: "success", passwords: new Map() };
  const { data, error } = await supabase.rpc("pt_credentials_export_passwords", { p_credential_ids: ids });
  if (error) {
    if ((error.message ?? "").includes("PT_REAUTH_REQUIRED")) return { status: "reauth" };
    if ((error.message ?? "").includes("PT_TOO_MANY")) return { status: "error", message: "Too many logins in one download (max 500)." };
    return fail(error, "Could not get the passwords for the download.", "Failed to export passwords:");
  }
  return { status: "success", passwords: new Map((data ?? []).map((r) => [r.credential_id, r.password])) };
}

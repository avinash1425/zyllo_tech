import { supabase } from "@/lib/supabase/client";
import { isKnownCountry } from "@/lib/countries";

// Project Tracker data access. Row Level Security on pt_companies, pt_projects
// and the private "pt-company-logos" bucket limits every call to website
// admins (public.is_admin()).

const LOGO_BUCKET = "pt-company-logos";
const LOGO_URL_TTL_SECONDS = 60 * 60;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const COMPANY_COLUMNS =
  "id, name, industry, contact_person, email, phone, address, country, status, logo_path, created_at, updated_at";
const PROJECT_COLUMNS =
  "id, project_code, company_id, name, description, project_type, status, progress, project_manager, priority, health, start_date, end_date, live_url, repo_source, next_action, notes, created_at, updated_at";

export const PROJECT_STATUSES = [
  { value: "planning", label: "Planning" },
  { value: "in_progress", label: "In progress" },
  { value: "live", label: "Live" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export const PROJECT_PRIORITIES = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const PROJECT_HEALTH = [
  { value: "on_track", label: "On track" },
  { value: "at_risk", label: "At risk" },
  { value: "off_track", label: "Off track" },
];

/** Suggestions for the free-text Type field. */
export const PROJECT_TYPES = ["Website", "ERP / Web App", "Web App", "Mobile App", "Zoho App", "AI / Automation", "E-commerce", "Other"];

export const labelOf = (list, value) => list.find((o) => o.value === value)?.label ?? value ?? "";

function clean(input, fields) {
  const values = {};
  for (const field of fields) {
    const raw = input?.[field];
    const text = typeof raw === "string" ? raw.trim() : raw ?? "";
    values[field] = text === "" ? null : text;
  }
  return values;
}

function tooLong(values, limits, labels, errors) {
  for (const [field, max] of Object.entries(limits)) {
    if (values[field] && values[field].length > max) {
      errors[field] = `${labels[field]} must be at most ${max} characters.`;
    }
  }
}

// ---------------------------------------------------------------- companies

const COMPANY_FIELDS = ["name", "industry", "contact_person", "email", "phone", "address", "country", "status"];
const COMPANY_LIMITS = { name: 200, industry: 120, contact_person: 120, email: 254, phone: 40, address: 500 };
const COMPANY_LABELS = {
  name: "Company name",
  industry: "Industry",
  contact_person: "Contact person",
  email: "Email",
  phone: "Phone",
  address: "Address",
};

/** Trims every field, turns blanks into null and checks the same rules as the database. */
export function validateCompany(input) {
  const values = clean(input, COMPANY_FIELDS);
  const errors = {};
  if (!values.name) errors.name = "Company name is required.";
  values.country = values.country || "India";
  if (!isKnownCountry(values.country)) errors.country = "Pick a country from the list.";
  values.status = values.status === "inactive" ? "inactive" : "active";
  tooLong(values, COMPANY_LIMITS, COMPANY_LABELS, errors);
  if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) {
    errors.email = "Enter a valid email address.";
  }
  if (values.phone && !/^[0-9+()\-\s.]{5,40}$/.test(values.phone)) {
    errors.phone = "Enter a valid phone number.";
  }
  return { values, errors, ok: Object.keys(errors).length === 0 };
}

/** Checks a chosen logo file: type, size, and that its bytes really are that image type. */
export async function validateLogo(file) {
  if (!(file instanceof File) || file.size === 0) return "Choose an image file.";
  if (!LOGO_TYPES[file.type]) return "Logo must be a PNG, JPG or WEBP image.";
  if (file.size > MAX_LOGO_BYTES) return "Logo must be 2 MB or smaller.";
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isWebp =
    String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP";
  const matches =
    (file.type === "image/png" && isPng) || (file.type === "image/jpeg" && isJpg) || (file.type === "image/webp" && isWebp);
  return matches ? null : "This file is not a valid image.";
}

function friendlyError(error, fallback) {
  if (!error) return fallback;
  if (error.code === "23505") return "That name is already used.";
  if (error.code === "23503") return "This company still has projects. Delete its projects first.";
  if (error.code === "42501") return "You do not have permission to do this.";
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703") {
    return "The Project Tracker database is not up to date yet.";
  }
  return fallback;
}

async function withLogoUrls(companies) {
  const paths = companies.map((c) => c.logo_path).filter(Boolean);
  if (!paths.length) return companies.map((c) => ({ ...c, logo_url: null }));
  const { data, error } = await supabase.storage.from(LOGO_BUCKET).createSignedUrls(paths, LOGO_URL_TTL_SECONDS);
  if (error) console.error("Failed to sign logo URLs:", error.message);
  const byPath = new Map((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  return companies.map((c) => ({ ...c, logo_url: c.logo_path ? byPath.get(c.logo_path) ?? null : null }));
}

async function uploadLogo(companyId, file) {
  const problem = await validateLogo(file);
  if (problem) return { error: problem };
  const random = Math.random().toString(36).slice(2, 10);
  const path = `${companyId}/logo-${Date.now()}-${random}.${LOGO_TYPES[file.type]}`;
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
  if (error) {
    console.error("Failed to upload logo:", error.message);
    return { error: "Could not upload the logo." };
  }
  return { path };
}

async function removeLogo(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(LOGO_BUCKET).remove([path]);
  if (error) console.error("Failed to remove old logo:", error.message);
}

export async function fetchCompanies() {
  const { data, error } = await supabase
    .from("pt_companies")
    .select(`${COMPANY_COLUMNS}, pt_projects(count)`)
    .order("name", { ascending: true });
  if (error) {
    console.error("Failed to load companies:", error.message);
    throw new Error(friendlyError(error, "Could not load companies."));
  }
  const rows = (data ?? []).map(({ pt_projects: projects, ...c }) => ({
    ...c,
    project_count: projects?.[0]?.count ?? 0,
  }));
  return withLogoUrls(rows);
}

export async function fetchCompany(id) {
  const { data, error } = await supabase.from("pt_companies").select(COMPANY_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("Failed to load company:", error.message);
    throw new Error(friendlyError(error, "Could not load the company."));
  }
  if (!data) return null;
  const [withUrl] = await withLogoUrls([data]);
  return withUrl;
}

/**
 * Creates a company, then uploads its logo (if any). If the logo upload
 * fails, the company is kept and the error is reported.
 */
export async function createCompany(input, logoFile) {
  const { values, errors, ok } = validateCompany(input);
  if (logoFile) {
    const problem = await validateLogo(logoFile);
    if (problem) errors.logo = problem;
  }
  if (!ok || errors.logo) return { status: "error", errors, message: "Please fix the highlighted fields." };

  const { data, error } = await supabase.from("pt_companies").insert(values).select(COMPANY_COLUMNS).single();
  if (error) {
    console.error("Failed to create company:", error.message);
    const message = error.code === "23505" ? "A company with this name already exists." : friendlyError(error, "Could not save the company.");
    return { status: "error", message };
  }
  if (!logoFile) return { status: "success", company: data };

  const upload = await uploadLogo(data.id, logoFile);
  if (upload.error) return { status: "partial", company: data, message: `Company saved, but ${upload.error.toLowerCase()}` };
  const { error: linkError } = await supabase.from("pt_companies").update({ logo_path: upload.path }).eq("id", data.id);
  if (linkError) {
    await removeLogo(upload.path);
    return { status: "partial", company: data, message: "Company saved, but the logo could not be attached." };
  }
  return { status: "success", company: { ...data, logo_path: upload.path } };
}

/** logo: undefined = keep, a File = replace, null = remove. */
export async function updateCompany(id, input, logo, currentLogoPath) {
  if (!id) return { status: "error", message: "Missing company." };
  const { values, errors, ok } = validateCompany(input);
  if (logo instanceof File) {
    const problem = await validateLogo(logo);
    if (problem) errors.logo = problem;
  }
  if (!ok || errors.logo) return { status: "error", errors, message: "Please fix the highlighted fields." };

  let newPath;
  if (logo instanceof File) {
    const upload = await uploadLogo(id, logo);
    if (upload.error) return { status: "error", errors: { logo: upload.error }, message: upload.error };
    newPath = upload.path;
    values.logo_path = newPath;
  } else if (logo === null) {
    values.logo_path = null;
  }

  const { data, error } = await supabase
    .from("pt_companies")
    .update(values)
    .eq("id", id)
    .select(COMPANY_COLUMNS)
    .maybeSingle();
  if (error || !data) {
    if (newPath) await removeLogo(newPath);
    if (error) console.error("Failed to update company:", error.message);
    const message = !error
      ? "Company not found."
      : error.code === "23505"
        ? "A company with this name already exists."
        : friendlyError(error, "Could not update the company.");
    return { status: "error", message };
  }
  if (logo !== undefined && currentLogoPath && currentLogoPath !== data.logo_path) await removeLogo(currentLogoPath);
  return { status: "success", company: data };
}

export async function deleteCompany(id, logoPath) {
  if (!id) return { status: "error", message: "Missing company." };
  const { data, error } = await supabase.from("pt_companies").delete().eq("id", id).select("id");
  if (error) {
    console.error("Failed to delete company:", error.message);
    return { status: "error", message: friendlyError(error, "Could not delete the company.") };
  }
  if (!data?.length) return { status: "error", message: "Company not found." };
  await removeLogo(logoPath);
  return { status: "success" };
}

// ----------------------------------------------------------------- projects

const PROJECT_FIELDS = [
  "name",
  "description",
  "project_type",
  "status",
  "progress",
  "project_manager",
  "priority",
  "health",
  "start_date",
  "end_date",
  "live_url",
  "repo_source",
  "next_action",
  "notes",
];
const PROJECT_LIMITS = {
  name: 200,
  description: 2000,
  project_type: 80,
  project_manager: 120,
  live_url: 500,
  repo_source: 500,
  next_action: 500,
  notes: 2000,
};
const PROJECT_LABELS = {
  name: "Project name",
  description: "Description",
  project_type: "Type",
  project_manager: "Project manager",
  live_url: "Live URL",
  repo_source: "Repo / Source",
  next_action: "Next action",
  notes: "Notes",
};

/**
 * Validates a project form. `project_code` is only checked (and sent) when the
 * form includes it, i.e. when editing; new projects get one automatically.
 */
export function validateProject(input) {
  const values = clean(input, PROJECT_FIELDS);
  const errors = {};
  if (input && Object.hasOwn(input, "project_code")) {
    const code = String(input.project_code ?? "").trim().toUpperCase();
    if (!code) errors.project_code = "Project ID is required.";
    else if (!/^[A-Z0-9][A-Z0-9._/-]{0,29}$/.test(code)) {
      errors.project_code = "Use up to 30 letters, numbers, or - _ . / (e.g. ZT-010).";
    }
    values.project_code = code;
  }
  if (!values.name) errors.name = "Project name is required.";
  tooLong(values, PROJECT_LIMITS, PROJECT_LABELS, errors);

  if (!PROJECT_STATUSES.some((s) => s.value === values.status)) values.status = "planning";
  if (!PROJECT_PRIORITIES.some((p) => p.value === values.priority)) values.priority = "medium";
  if (values.health && !PROJECT_HEALTH.some((h) => h.value === values.health)) values.health = null;

  const progress = values.progress == null ? 0 : Number(values.progress);
  if (![0, 25, 50, 75, 100].includes(progress)) {
    errors.progress = "Progress must be 0%, 25%, 50%, 75% or 100%.";
  } else {
    values.progress = progress;
  }

  if (values.live_url && !/^https?:\/\/\S+$/i.test(values.live_url)) {
    errors.live_url = "Live URL must start with http:// or https://";
  }

  const dateOk = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!dateOk(values.start_date)) errors.start_date = "Enter a valid date.";
  if (!dateOk(values.end_date)) errors.end_date = "Enter a valid date.";
  if (values.start_date && values.end_date && values.end_date < values.start_date) {
    errors.end_date = "Target date cannot be before the start date.";
  }
  return { values, errors, ok: Object.keys(errors).length === 0 };
}

/** Every project with its client company, for the dashboard. */
export async function fetchAllProjects() {
  const { data, error } = await supabase
    .from("pt_projects")
    .select(`${PROJECT_COLUMNS}, company:pt_companies(id, name)`)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to load projects:", error.message);
    throw new Error(friendlyError(error, "Could not load projects."));
  }
  return data ?? [];
}

export async function fetchProjects(companyId) {
  const { data, error } = await supabase
    .from("pt_projects")
    .select(PROJECT_COLUMNS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to load projects:", error.message);
    throw new Error(friendlyError(error, "Could not load projects."));
  }
  return data ?? [];
}

const isCodeClash = (error) => error?.code === "23505" && /pt_projects_code_key/.test(error.message ?? "");

function projectError(error, fallback) {
  if (isCodeClash(error)) return "This Project ID is already used by another project.";
  if (error?.code === "23505") return "This company already has a project with this name.";
  return friendlyError(error, fallback);
}

export async function createProject(companyId, input) {
  const { project_code: _ignored, ...rest } = input ?? {};
  const { values, errors, ok } = validateProject(rest);
  if (!ok) return { status: "error", errors, message: "Please fix the highlighted fields." };
  // The database assigns the next ZT-### code. If someone has already taken that
  // code by editing another project, the insert clashes; each retry draws the
  // next number, so it simply skips codes that are in use.
  let data;
  let error;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    ({ data, error } = await supabase
      .from("pt_projects")
      .insert({ ...values, company_id: companyId })
      .select(PROJECT_COLUMNS)
      .single());
    if (!isCodeClash(error)) break;
  }
  if (error) {
    console.error("Failed to create project:", error.message);
    return { status: "error", message: projectError(error, "Could not save the project.") };
  }
  return { status: "success", project: data };
}

export async function updateProject(id, input) {
  const { values, errors, ok } = validateProject(input);
  if (!ok) return { status: "error", errors, message: "Please fix the highlighted fields." };
  const { data, error } = await supabase
    .from("pt_projects")
    .update(values)
    .eq("id", id)
    .select(PROJECT_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error("Failed to update project:", error.message);
    const message = projectError(error, "Could not update the project.");
    return { status: "error", message, errors: isCodeClash(error) ? { project_code: message } : undefined };
  }
  if (!data) return { status: "error", message: "Project not found." };
  return { status: "success", project: data };
}

export async function deleteProject(id) {
  const { data, error } = await supabase.from("pt_projects").delete().eq("id", id).select("id");
  if (error) {
    console.error("Failed to delete project:", error.message);
    const message =
      error.code === "23503"
        ? "This project still has logins, documents or backups. Delete those first (open the project)."
        : friendlyError(error, "Could not delete the project.");
    return { status: "error", message };
  }
  if (!data?.length) return { status: "error", message: "Project not found." };
  return { status: "success" };
}

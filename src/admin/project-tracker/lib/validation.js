// Client-side validation for Project Tracker forms. The database enforces the
// same rules (and more); this only gives earlier, friendlier messages.
// Pure module (node-testable).

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", "png", "jpg", "jpeg", "webp", "zip", "mp4", "webm", "mp3",
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /^(https?|sftp|ftps?|ssh):\/\/[^\s/$.?#][^\s]*$/i;
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const isEmail = (v) => EMAIL_RE.test(String(v || "")) && String(v).length <= 254;
export const isUrl = (v) => URL_RE.test(String(v || "")) && String(v).length <= 1000;
export const isDomain = (v) => DOMAIN_RE.test(String(v || "").trim().toLowerCase()) && String(v).length <= 253;

// Mirror of public.pt_looks_like_secret() in the schema.
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY/i,
  /ssh-(rsa|ed25519|dss) AAAA[0-9A-Za-z+/]{40,}/i,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./,
  /(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}/,
  /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
  /sb_secret_[A-Za-z0-9_-]{10,}/,
  /sbp_[A-Za-z0-9]{20,}/,
  /(password|passwd|pwd|passcode|secret|token|api[ _-]?key|access[ _-]?token|private[ _-]?key|recovery[ _-]?codes?)\s*[:=]\s*(?!1password)(?=\S*[0-9])(?=\S*[a-z])\S{6,}/i,
];
export function looksLikeSecret(value) {
  if (typeof value !== "string" || !value) return false;
  return SECRET_PATTERNS.some((re) => re.test(value));
}

const SECRET_MESSAGE = "This looks like a password, key or token. Keep secrets in your password manager and enter only a reference here.";

/**
 * Validate a values object against field definitions:
 *   { name, label, type, required, maxLength, min, max, pattern, patternMessage }
 * plus optional `rules`: [(values) => ({ field, message } | null)].
 * Returns { fieldName: message }.
 */
export function validateValues(fields, values, rules = []) {
  const errors = {};
  for (const f of fields) {
    if (f.hidden && f.hidden(values)) continue;
    const v = values[f.name];
    const empty = v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
    const required = typeof f.required === "function" ? f.required(values) : f.required;
    if (required && empty && f.type !== "checkbox") {
      errors[f.name] = `${f.label} is required.`;
      continue;
    }
    if (empty) continue;
    if (typeof v === "string") {
      const max = f.maxLength ?? (f.type === "textarea" ? 5000 : 300);
      if (v.length > max) errors[f.name] = `${f.label} must be ${max} characters or fewer.`;
      else if (f.type !== "password" && looksLikeSecret(v)) errors[f.name] = SECRET_MESSAGE;
      else if (f.type === "email" && !isEmail(v.trim())) errors[f.name] = "Enter a valid email address.";
      else if (f.type === "url" && !isUrl(v.trim())) errors[f.name] = "Enter a full URL starting with https:// (or sftp://, ssh://).";
      else if (f.type === "domain" && !isDomain(v)) errors[f.name] = "Enter a domain such as example.com (no https://).";
      else if (f.pattern && !f.pattern.test(v.trim())) errors[f.name] = f.patternMessage || `${f.label} has an invalid format.`;
    }
    if (f.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) errors[f.name] = `${f.label} must be a number.`;
      else if (f.min !== undefined && n < f.min) errors[f.name] = `${f.label} must be at least ${f.min}.`;
      else if (f.max !== undefined && n > f.max) errors[f.name] = `${f.label} must be at most ${f.max}.`;
    }
  }
  for (const rule of rules) {
    const r = rule(values);
    if (r && !errors[r.field]) errors[r.field] = r.message;
  }
  return errors;
}

/** Rule helper: `later` must be on/after `earlier` when both are set. */
export function dateOrder(earlier, later, message) {
  return (v) => (v[earlier] && v[later] && String(v[later]) < String(v[earlier]) ? { field: later, message } : null);
}

/** Storage-safe file name: ASCII letters, digits, dot, dash, underscore; ≤150 chars; keeps the extension. */
export function sanitizeFileName(name) {
  const raw = String(name || "file").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const dot = raw.lastIndexOf(".");
  const ext = dot > 0 ? raw.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  let base = (dot > 0 ? raw.slice(0, dot) : raw).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  if (!base) base = "file";
  const maxBase = 150 - (ext ? ext.length + 1 : 0);
  base = base.slice(0, maxBase);
  return ext ? `${base}.${ext}` : base;
}

export function fileExtension(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

/** Content type by extension, for browsers that report none (common for Office files). The server re-checks it. */
const MIME_BY_EXT = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", md: "text/markdown", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  zip: "application/zip", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg",
};
export function uploadContentType(file) {
  return MIME_BY_EXT[fileExtension(file?.name)] || file?.type || "application/octet-stream";
}

/** Returns an error message, or null when the file may be uploaded. `maxMb` comes from the server settings. */
export function checkUpload(file, maxMb = MAX_UPLOAD_BYTES / 1024 / 1024) {
  if (!file) return "Choose a file.";
  const ext = fileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) return `Files of type .${ext || "?"} are not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`;
  if (file.size > maxMb * 1024 * 1024) return `The file is larger than ${maxMb} MB. Use an access-controlled external link for larger files.`;
  if (file.size === 0) return "The file is empty.";
  return null;
}

/** Make free text safe to embed in a PostgREST or=(...) ilike filter. */
export function sanitizeSearch(q) {
  return String(q || "").replace(/[%*,()\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

// Human-readable labels for activity-log actions. Pure module.
import { HANDOVER_ITEMS, labelOf } from "./options.js";
const ENTITY = {
  project: "Project", hosting: "Hosting", domain: "Domain", access: "Credential reference record", email: "Email account",
  backup: "Backup record", repository: "Repository", deployment: "Deployment", milestone: "Milestone", task: "Task",
  document: "Document", update: "Update", amc: "AMC contract", renewal: "Renewal", seo: "SEO record", handover: "Handover",
  handover_item: "Handover checklist item", remark: "Remark", member: "Project Tracker role",
};
const SPECIAL = {
  "access.reference_changed": "Credential reference changed",
  "access.reference_viewed": "Credential reference viewed",
  "access.password_set": "Password saved (vault)",
  "access.password_changed": "Password changed (vault)",
  "access.password_revealed": "Password revealed",
  "access.password_copied": "Password copied",
  "access.password_denied": "Password access refused",
  "access.password_cleared": "Stored password removed",
  "document.new_version": "New document version",
  "document.superseded": "Document version replaced",
  "document.opened": "Document opened",
  "document.downloaded": "Document downloaded",
  "document.previewed": "Document previewed",
  "backup.verified": "Backup verified",
  "amc.renewed": "AMC renewed",
  "renewal.completed": "Renewal completed",
  "handover.approved": "Handover approved",
  "handover.completed": "Handover completed",
  "member.role_changed": "Role changed",
  "project.created": "Project created",
  "remark.created": "Remark added",
};
const VERB = { created: "added", updated: "updated", archived: "archived", restored: "restored", status_changed: "status changed" };

/** The record name to show next to an action (status-labelled entities show none; checklist keys become labels). */
export function entityText(row) {
  if (!row?.entity_label) return "";
  if (["handover", "seo", "remark", "member"].includes(row.entity_type)) return "";
  if (row.entity_type === "handover_item") return labelOf(HANDOVER_ITEMS, row.entity_label);
  return row.entity_label;
}

export function actionLabel(action) {
  if (!action) return "";
  if (SPECIAL[action]) return SPECIAL[action];
  const [entity, verb] = String(action).split(".");
  const e = ENTITY[entity] || entity;
  return `${e} ${VERB[verb] || verb}`;
}

/** One-line description of safe log details (field names / status changes only). */
export function detailText(details) {
  if (!details || typeof details !== "object") return "";
  const parts = [];
  if (details.from || details.to) parts.push(`${humanize(details.from) || "—"} → ${humanize(details.to) || "—"}`);
  if (Array.isArray(details.fields) && details.fields.length) {
    parts.push(`fields: ${details.fields.filter((f) => f !== "status" && f !== "seo_status" && f !== "state").map(humanize).join(", ")}`.replace(/fields: $/, ""));
  }
  if (details.reason) parts.push(`reason: ${details.reason}`);
  if (details.role) parts.push(`role: ${details.role}`);
  return parts.filter(Boolean).join(" · ");
}

function humanize(s) {
  if (!s) return "";
  return String(s).replace(/_id$/, "").replace(/_/g, " ");
}

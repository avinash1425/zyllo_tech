// Shared building blocks for Training (HR + Employee Portal). HRMS UI kit
// only; no new design tokens. ActionModal / label / opts / today / empText
// are the same helpers Asset Allocation uses.
import { useState } from "react";
import { FileText, Upload } from "lucide-react";
import { formatDate } from "@/lib/hr/client";
import { DOC_ACCEPT, getDocumentUrl, latestVersion, uploadDocument } from "@/lib/hr/documents";
import { CERT_CATEGORY } from "@/lib/hr/training";
import { certificateState, daysUntil, displayStatus, sessionWhen } from "@/lib/hr/trainingRules";
import { Badge, Button, Field, useToast } from "@/hr/ui";
import { ActionModal, empText, label, opts, today } from "@/hr/components/assets/shared";

export { ActionModal, empText, label, opts, today };

const STATUS_TONES = {
  assigned: "amber", in_progress: "blue", pending_verification: "violet", completed: "green", cancelled: "slate", overdue: "red",
  scheduled: "violet", enrolled: "blue", waitlisted: "amber", attended: "green", absent: "red",
  passed: "green", failed: "red",
  manual: "slate", program: "blue", session: "violet", onboarding: "orange", renewal: "amber",
};
export const TBadge = ({ value }) => (value ? <Badge tone={STATUS_TONES[value] ?? "slate"}>{label(value)}</Badge> : <span className="text-slate-400">—</span>);

/** Assignment status as shown to people (overdue / pending verification derived). */
export const AssignmentStatus = ({ row }) => <TBadge value={displayStatus(row, today())} />;

export function CertificateBadge({ row }) {
  const st = certificateState(row, today());
  if (!st) return row?.certificate_expiry ? <span>{formatDate(row.certificate_expiry)}</span> : <span className="text-slate-400">No expiry</span>;
  const left = daysUntil(row.certificate_expiry, today());
  const tone = st === "expired" ? "red" : st === "expiring" ? "amber" : "green";
  return (
    <span className="flex flex-col gap-0.5">
      <span>{formatDate(row.certificate_expiry)}</span>
      <Badge tone={tone}>{st === "expired" ? `expired ${-left}d ago` : st === "expiring" ? `expires in ${left}d` : "valid"}</Badge>
    </span>
  );
}

export const courseText = (c) => (c ? `${c.code} · ${c.title}` : "—");
export const sessionText = (s) => (s ? `${s.course_title ?? ""} — ${sessionWhen(s)}` : "—");

export function dueText(due, open = true) {
  if (!due) return "—";
  if (!open) return formatDate(due);
  const d = daysUntil(due, today());
  return (
    <span className="flex flex-col">
      <span>{formatDate(due)}</span>
      {d != null && <span className={d < 0 ? "text-xs font-semibold text-rose-700" : d <= 7 ? "text-xs text-amber-700" : "text-xs text-slate-500"}>{d < 0 ? `${-d}d overdue` : d === 0 ? "due today" : `in ${d}d`}</span>}
    </span>
  );
}

/** Opens a document (certificate / evidence) through a short-lived signed URL. */
export function DocButton({ doc, children }) {
  const { notify } = useToast();
  if (!doc) return null;
  async function open() {
    const res = await getDocumentUrl(latestVersion(doc), "view");
    if (res.error) { notify(res.error, "error"); return; }
    window.open(res.data, "_blank", "noopener,noreferrer");
  }
  return (
    <Button size="sm" variant="ghost" onClick={open} className="!h-auto !px-1 !py-0.5">
      <FileText className="h-4 w-4" aria-hidden="true" />{children ?? doc.title ?? "View"}
    </Button>
  );
}

/** File chooser; the caller uploads with uploadTrainingFile on submit. */
export function FileField({ label: lbl = "File", hint = "PDF, image or Office file, up to 10 MB", onChange, required }) {
  return (
    <Field label={lbl} hint={hint} required={required}>
      {(id) => <input id={id} type="file" accept={DOC_ACCEPT} onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-semibold" />}
    </Field>
  );
}

/**
 * Upload a file as a "Training certificate" document of the employee
 * (Module 9 documents, private hr-documents bucket). Returns { id, error }.
 */
export async function uploadTrainingFile(employeeId, file, title) {
  if (!file) return { id: null, error: null };
  const up = await uploadDocument({ employeeId, categoryCode: CERT_CATEGORY, title: (title || file.name).slice(0, 200), file });
  if (up.error && !up.data) return { id: null, error: up.error };
  return { id: up.data.document_id, error: up.error ?? null };
}

export const UploadIcon = Upload;

/** Multi-select employee picker (checkbox list with search). options: [{ value, label }]. */
export function EmployeePicker({ options, value, onChange, exclude = [] }) {
  const [q, setQ] = useState("");
  const list = (options ?? []).filter((o) => !exclude.includes(o.value) && o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const set = new Set(value);
  const toggle = (id) => onChange(set.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employees…" aria-label="Search employees"
          className="h-9 min-w-[10rem] flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f96706] focus:ring-4 focus:ring-[#f96706]/15" />
        <Button size="sm" variant="secondary" onClick={() => onChange([...new Set([...value, ...list.map((o) => o.value)])])} disabled={!list.length}>Select shown</Button>
        <Button size="sm" variant="ghost" onClick={() => onChange([])} disabled={!value.length}>Clear</Button>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 p-2">
        {!list.length ? <p className="px-1 py-2 text-sm text-slate-500">No employees match.</p> : list.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-[#173a52] hover:bg-slate-50">
            <input type="checkbox" checked={set.has(o.value)} onChange={() => toggle(o.value)} className="h-4 w-4 rounded border-slate-300 text-[#f96706] focus:ring-[#f96706]" />
            {o.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-slate-500">{value.length} selected</p>
    </div>
  );
}


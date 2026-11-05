// Shared building blocks for Asset Allocation (HR + Employee Portal).
// Uses the HRMS UI kit only; no new design tokens.
import { useState } from "react";
import { FileText, Paperclip, Upload } from "lucide-react";
import { formatDate, formatDateTime, formatMoney, fullName, useHrQuery } from "@/lib/hr/client";
import { DOC_ACCEPT, formatBytes, getDocumentUrl, latestVersion, uploadDocument } from "@/lib/hr/documents";
import { ACCESSORY_SUGGESTIONS, ASSET_DOC_CATEGORY, linkAssetDocument, listAssetDocumentLinks } from "@/lib/hr/assets";
import { Badge, Button, ErrorState, Field, InlineError, Input, Loading, Modal, useToast } from "@/hr/ui";

export const label = (s) => String(s ?? "").replace(/_/g, " ");
export const opts = (list) => list.map((s) => ({ value: s, label: label(s) }));
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const empText = (e) => (e ? `${fullName(e)} (${e.employee_code})` : "—");
export const one = (v) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

const TONES = {
  asset: { available: "green", assigned: "blue", in_repair: "orange", in_inspection: "amber", retired: "slate", lost: "red", disposed: "slate" },
  handover: { pending_acknowledgement: "amber", acknowledged: "blue", confirmed: "green", cancelled: "slate" },
  damage: { reported: "red", under_review: "amber", under_repair: "orange", resolved: "green" },
  return: { requested: "amber", pending_handover: "blue", received: "orange", inspected: "orange", completed: "green", cancelled: "slate" },
  severity: { low: "slate", medium: "amber", high: "orange", critical: "red" },
};
export const Pill = ({ kind, value }) => <Badge tone={TONES[kind]?.[value] ?? "slate"}>{label(value) || "—"}</Badge>;
export const AssetStatus = ({ status }) => <Pill kind="asset" value={status} />;

/** Modal with busy/error handling. onSubmit returns { error } (validation or server). */
export function ActionModal({ title, onClose, submitLabel = "Save", tone = "primary", onSubmit, children, size = "sm", hideSubmit = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function go() {
    setBusy(true); setError(null);
    const res = (await onSubmit()) ?? {};
    setBusy(false);
    if (res.error) setError(res.error);
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title={title} size={size}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{hideSubmit ? "Close" : "Cancel"}</Button>{!hideSubmit && <Button variant={tone} loading={busy} onClick={go}>{submitLabel}</Button>}</>}>
      <div className="flex flex-col gap-3">{children}<InlineError message={error} /></div>
    </Modal>
  );
}

/** Comma-separated accessory list with one-click suggestions. value: string[] */
export function AccessoriesInput({ value, onChange, label: lbl = "Accessories", hint = "Comma separated, e.g. Charger, Laptop bag" }) {
  const [text, setText] = useState((value ?? []).join(", "));
  const push = (t) => { setText(t); onChange(t.split(",").map((s) => s.trim()).filter(Boolean)); };
  const current = (value ?? []).map((s) => s.toLowerCase());
  return (
    <Field label={lbl} hint={hint}>
      <Input value={text} maxLength={600} onChange={(e) => push(e.target.value)} />
      <div className="mt-1 flex flex-wrap gap-1">
        {ACCESSORY_SUGGESTIONS.filter((s) => !current.includes(s.toLowerCase())).map((s) => (
          <button key={s} type="button" onClick={() => push([...(value ?? []), s].join(", "))}
            className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-[#f96706] hover:text-[#f96706]">+ {s}</button>
        ))}
      </div>
    </Field>
  );
}

export const AccessoryList = ({ items, empty = "None" }) => (items?.length ? <span>{items.join(", ")}</span> : <span className="text-slate-500">{empty}</span>);

/**
 * Module 9 documents linked to an asset record (handover / damage evidence /
 * return confirmation). Files live in the private hr-documents bucket and are
 * opened via short-lived signed URLs (access is logged by Module 9).
 * `employeeId` is the employee the document belongs to.
 */
export function AssetDocuments({ kind, recordId, employeeId, canAttach }) {
  const { notify } = useToast();
  const filter = kind === "handover" ? { handover: recordId } : kind === "damage_evidence" ? { damage: recordId } : { ret: recordId };
  const docs = useHrQuery(() => listAssetDocumentLinks(filter), [kind, recordId]);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);

  async function open(link) {
    const v = latestVersion(link.document);
    const res = await getDocumentUrl(v, "view");
    if (res.error) { notify(res.error, "error"); return; }
    window.open(res.data, "_blank", "noopener,noreferrer");
  }
  async function attach() {
    if (!file) { setError("Choose a file."); return; }
    setUploading(true); setError(null);
    const up = await uploadDocument({ employeeId, categoryCode: ASSET_DOC_CATEGORY[kind], title: file.name.slice(0, 200), file });
    if (up.error && !up.data) { setUploading(false); setError(up.error); return; }
    const link = await linkAssetDocument(up.data.document_id, kind, recordId);
    setUploading(false);
    if (link.error) { setError(link.error); return; }
    if (up.error) setError(up.error);       // registered + linked but the object upload failed: retry from Documents
    else { setFile(null); notify("File attached."); }
    docs.reload();
  }

  return (
    <section className="flex flex-col gap-2">
      <h4 className="flex items-center gap-1.5 text-sm font-bold text-[#101a3a]"><Paperclip className="h-4 w-4" aria-hidden="true" />Attachments</h4>
      {docs.loading && !docs.data ? <Loading /> : docs.error ? <ErrorState message={docs.error} onRetry={docs.reload} /> : !docs.data?.length ? (
        <p className="text-sm text-slate-500">No files attached.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {docs.data.map((l) => {
            const v = latestVersion(l.document);
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-2 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-1.5"><FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /><span className="truncate">{l.document?.title ?? "Document"}</span>
                  {v && <span className="text-xs text-slate-500">· v{v.version} · {formatBytes(v.size_bytes)}</span>}</span>
                <Button size="sm" variant="ghost" onClick={() => open(l)} disabled={!v}>View</Button>
              </li>
            );
          })}
        </ul>
      )}
      {canAttach && (
        <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2 sm:flex-row sm:items-center">
          <input type="file" accept={DOC_ACCEPT} aria-label="File to attach" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="min-w-0 flex-1 text-sm" />
          <Button size="sm" variant="secondary" loading={uploading} onClick={attach}><Upload className="h-4 w-4" aria-hidden="true" />Attach</Button>
        </div>
      )}
      <InlineError message={error} />
    </section>
  );
}

/** Chronological asset history (newest first). */
export function AssetHistory({ events, showCost = true, showAsset = false }) {
  if (!events?.length) return <p className="text-sm text-slate-600">No history yet.</p>;
  return (
    <ol className="relative flex flex-col gap-3 border-l-2 border-slate-100 pl-4">
      {events.map((ev) => (
        <li key={ev.id} className="relative text-sm">
          <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[#f96706]" aria-hidden="true" />
          <span className="font-semibold capitalize text-[#101a3a]">{label(ev.event_type)}</span>
          {showAsset && ev.asset && <span className="ml-2 font-mono text-xs text-[#1f4693]">{ev.asset.asset_tag}</span>}
          <span className="ml-2 text-xs text-slate-500">{formatDateTime(ev.occurred_at)}</span>
          {ev.employee && <span className="ml-2 text-xs text-slate-500">· {empText(ev.employee)}</span>}
          {ev.details && <p className="break-words text-slate-700">{ev.details}</p>}
          {showCost && ev.cost != null && <p className="text-xs text-slate-500">Cost: {formatMoney(ev.cost)}</p>}
        </li>
      ))}
    </ol>
  );
}

export const ChecklistView = ({ items }) => (
  !items?.length ? <p className="text-sm text-slate-500">No checklist.</p> : (
    <ul className="flex flex-col gap-1 text-sm">
      {items.map((c, i) => <li key={i} className="flex items-center gap-2"><span aria-hidden="true" className={c.done ? "text-emerald-600" : "text-slate-400"}>{c.done ? "✓" : "○"}</span><span>{c.item}</span>{!c.done && <span className="sr-only">(not checked)</span>}</li>)}
    </ul>
  )
);

export const dueText = (date) => {
  if (!date) return "—";
  const overdue = date < today();
  return <span className={overdue ? "font-semibold text-rose-700" : undefined}>{formatDate(date)}{overdue ? " (overdue)" : ""}</span>;
};

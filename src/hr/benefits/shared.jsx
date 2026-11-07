// Benefits Management — shared UI pieces (HR page + Employee Portal).
// Uses the HRMS UI kit only; no new design tokens.
import { useRef, useState } from "react";
import { FileText, Paperclip } from "lucide-react";
import { formatDate, formatDateTime, formatMoney, fullName } from "@/lib/hr/client";
import { CLAIM_FILE_ACCEPT, CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, checkClaimFile, getClaimDocumentUrl, label } from "@/lib/hr/benefits";
import { Badge, Button, EmptyState, Field, useToast } from "@/hr/ui";

export { ActionModal } from "@/hr/components/assets/shared";
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const opts = (list) => list.map((s) => ({ value: s, label: label(s) }));
export const empText = (e) => (e ? `${fullName(e)} (${e.employee_code})` : "—");
export const money = (v) => (v === null || v === undefined || v === "" ? "—" : formatMoney(v));
export const limitText = (v) => (v === null || v === undefined || v === "" ? "No annual limit" : formatMoney(v));

const ENROLLMENT_TONE = { active: "green", suspended: "orange", ended: "slate", cancelled: "slate" };
const REQUEST_TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "slate" };

export const ClaimStatus = ({ status }) => <Badge tone={CLAIM_STATUS_TONE[status] ?? "slate"}>{CLAIM_STATUS_LABEL[status] ?? label(status)}</Badge>;
export const EnrollmentStatus = ({ status }) => <Badge tone={ENROLLMENT_TONE[status] ?? "slate"}>{label(status)}</Badge>;
export const RequestStatus = ({ status }) => <Badge tone={REQUEST_TONE[status] ?? "slate"}>{label(status)}</Badge>;

const EVENT_LABEL = {
  enrolled: "Enrolled", enrollment_changed: "Enrollment changed", enrollment_ended: "Enrollment ended", enrollment_cancelled: "Enrollment cancelled",
  enrollment_suspended: "Enrollment suspended", enrollment_reactivated: "Enrollment reactivated", enrollment_requested: "Enrollment requested",
  enrollment_request_cancelled: "Enrollment request withdrawn", enrollment_request_approved: "Enrollment request approved",
  enrollment_request_rejected: "Enrollment request rejected", claim_created: "Claim drafted", claim_updated: "Claim edited",
  claim_submitted: "Claim submitted", claim_resubmitted: "Claim resubmitted", claim_approved: "Claim approved", claim_rejected: "Claim rejected",
  claim_returned: "Claim returned for changes", claim_cancelled: "Claim withdrawn", claim_paid_externally: "Payment recorded (outside payroll)",
  claim_document_added: "Document added", claim_document_removed: "Document removed",
};
export const eventLabel = (a) => EVENT_LABEL[a] ?? label(a);

/** Chronological list of hr_benefit_events rows. */
export function BenefitTimeline({ events, showPlan = false, empty = "No history yet." }) {
  if (!events?.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ol className="flex flex-col gap-2">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#f96706]" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-[#101a3a]">{eventLabel(e.action)}{showPlan && e.plan?.name ? <span className="font-normal text-slate-600"> · {e.plan.name}</span> : null}</p>
            {e.note && <p className="whitespace-pre-line break-words text-slate-700">{e.note}</p>}
            <p className="text-xs text-slate-500">{formatDateTime(e.occurred_at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Supporting documents of a claim, opened through short-lived signed URLs. */
export function ClaimDocuments({ documents, onRemove, canRemove = false }) {
  const { notify } = useToast();
  async function open(d) {
    const res = await getClaimDocumentUrl(d);
    if (res.error) notify(res.error, "error"); else window.open(res.data, "_blank", "noopener");
  }
  if (!documents?.length) return <EmptyState icon={Paperclip} title="No documents" description="Bills, receipts or certificates attached to the claim appear here." />;
  return (
    <ul className="flex flex-col gap-1.5">
      {documents.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-[#3089a6]" aria-hidden="true" /><span className="truncate">{d.file_name}</span>
            <span className="text-xs text-slate-500">{Math.max(1, Math.round((d.size_bytes ?? 0) / 1024))} KB · {formatDate(d.created_at)}</span></span>
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => open(d)}>Open</Button>
            {canRemove && <Button size="sm" variant="ghost" onClick={() => onRemove?.(d)} aria-label={`Remove ${d.file_name}`}>Remove</Button>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Pick claim documents (validated locally; uploaded after the claim is saved). */
export function ClaimFilePicker({ files, setFiles, required, label: lbl = "Supporting documents" }) {
  const ref = useRef(null);
  const [err, setErr] = useState(null);
  function pick(e) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = "";
    for (const f of picked) { const c = checkClaimFile(f); if (c.error) { setErr(`${f.name}: ${c.error}`); return; } }
    setErr(null);
    setFiles((x) => [...x, ...picked].slice(0, 5));
  }
  return (
    <Field label={lbl} required={required} error={err} hint="Bills, receipts or certificates. PDF, PNG, JPEG or WEBP, up to 10 MB each. Stored privately.">
      <div className="flex flex-col gap-2">
        <input ref={ref} type="file" multiple accept={CLAIM_FILE_ACCEPT} onChange={pick} className="sr-only" tabIndex={-1} aria-label={lbl} />
        <div><Button type="button" size="sm" variant="secondary" onClick={() => ref.current?.click()}><Paperclip className="h-4 w-4" aria-hidden="true" />Choose file</Button></div>
        {files.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5">
                <span className="truncate">{f.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

/** Limit usage bar for one enrollment balance row (hr_benefit_balances). */
export function LimitBar({ balance }) {
  if (!balance) return null;
  if (balance.annual_limit == null) return <p className="text-xs text-slate-500">No annual limit · {money(balance.used)} approved this plan year</p>;
  const lim = Number(balance.annual_limit) || 0;
  const used = Math.min(100, lim ? (Number(balance.used) / lim) * 100 : 0);
  const pend = Math.min(100 - used, lim ? (Number(balance.pending) / lim) * 100 : 0);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" role="img"
        aria-label={`${money(balance.used)} used and ${money(balance.pending)} pending of ${money(lim)}`}>
        <span className="h-full bg-gradient-to-r from-[#f7941e] to-[#f96706]" style={{ width: `${used}%` }} />
        <span className="h-full bg-amber-300" style={{ width: `${pend}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {money(balance.used)} used · {money(balance.pending)} pending · <strong className="text-[#101a3a]">{money(balance.available)} available</strong> of {money(lim)}
      </p>
    </div>
  );
}

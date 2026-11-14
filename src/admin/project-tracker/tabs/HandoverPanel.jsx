import { useCallback, useState } from "react";
import useLoad from "../useLoad";
import { CircleCheck, ClipboardCheck, Pencil, Send, Undo2 } from "lucide-react";
import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, Modal, Select, Spinner, TextArea, TextInput, useToast } from "../ui";
import { useProject, useRole } from "../context";
import { getHandover, startHandover, transitionHandover, updateRecord } from "@/lib/api/admin/projectTracker";
import { HANDOVER_ITEMS, HANDOVER_ITEM_STATE, HANDOVER_MANDATORY, HANDOVER_STATUS, labelOf } from "../lib/options";
import { formatDate, formatDateTime, todayISO } from "../lib/format";
import { isEmail, looksLikeSecret } from "../lib/validation";

const STEPS = ["draft", "ready_for_review", "approved", "handed_over"];
const APPROVAL_CATEGORIES = ["client_approval", "completion_certificate", "admin_access_handover", "agreement"];

function Stepper({ status }) {
  const idx = STEPS.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold" aria-label="Handover progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === idx ? "step" : undefined}>
          <span className={`rounded-full px-2.5 py-1 ${i < idx ? "bg-emerald-50 text-emerald-700" : i === idx ? "bg-[#101a3a] text-white" : "bg-[#f1f3f7] text-[#8a8f9c]"}`}>
            {i + 1}. {labelOf(HANDOVER_STATUS, s)}
          </span>
          {i < STEPS.length - 1 && <span aria-hidden="true" className="text-[#c9cdd6]">→</span>}
        </li>
      ))}
    </ol>
  );
}

function ItemModal({ item, docs, amcApplicable, onClose, onSaved }) {
  const toast = useToast();
  const [state, setState] = useState(item.state);
  const [note, setNote] = useState(item.evidence_note || "");
  const [docId, setDocId] = useState(item.evidence_document_id || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mandatory = HANDOVER_MANDATORY.includes(item.item_key) || (item.item_key === "amc_terms_documented" && amcApplicable);
  const needsDoc = item.item_key === "signed_approval_attached";

  async function save(e) {
    e.preventDefault();
    if (state === "done" && needsDoc && !docId) return setError("Attach the signed approval document.");
    if (state === "done" && !docId && note.trim().length < 5) return setError("Add evidence: a note (at least 5 characters) or a document.");
    if (state === "not_applicable" && note.trim().length < 5) return setError("Explain why this item does not apply (at least 5 characters).");
    if (looksLikeSecret(note)) return setError("The note looks like it contains a secret. Remove it.");
    setBusy(true);
    setError("");
    try {
      await updateRecord("pt_handover_items", item.id, { state, evidence_note: note.trim() || null, evidence_document_id: docId || null }, item.updated_at);
      toast.push("Checklist item saved.");
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={labelOf(HANDOVER_ITEMS, item.item_key)} onClose={onClose} busy={busy}>
      <form onSubmit={save} noValidate className="space-y-4">
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-[#2b303b]">Status</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {HANDOVER_ITEM_STATE.map((s) => (
              <label key={s.value} className={`flex items-center gap-2 ${s.value === "not_applicable" && mandatory ? "opacity-50" : ""}`}>
                <input type="radio" name="pt-item-state" value={s.value} checked={state === s.value} disabled={s.value === "not_applicable" && mandatory}
                  onChange={() => setState(s.value)} className="accent-[#1f4693]" />
                {s.label}
              </label>
            ))}
          </div>
          {mandatory && <p className="mt-1 text-xs text-[#676b7a]">This item is mandatory and cannot be marked Not applicable.</p>}
        </fieldset>
        <TextArea label={state === "not_applicable" ? "Reason it does not apply" : "Evidence note"} value={note} onChange={setNote} maxLength={2000}
          help="Say how this was confirmed (who, when, where it is documented). A tick alone does not complete an item." />
        <Select label={needsDoc ? "Signed approval document" : "Evidence document (optional)"} value={docId} onChange={setDocId} required={needsDoc && state === "done"}
          options={docs.map((d) => ({ value: d.id, label: `${d.name}${d.version ? ` v${d.version}` : ""}` }))} placeholder={docs.length ? "— None —" : "— Upload documents first —"} />
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex justify-end gap-2 border-t border-[#eef0f4] pt-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save item</Button>
        </div>
      </form>
    </Modal>
  );
}

function DetailsModal({ handover, docs, onClose, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState({
    recipient_name: handover.recipient_name || "", recipient_organisation: handover.recipient_organisation || "",
    recipient_email: handover.recipient_email || "", handover_date: handover.handover_date || "", approval_document_id: handover.approval_document_id || "",
    notes: handover.notes || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const approvalDocs = docs.filter((d) => APPROVAL_CATEGORIES.includes(d.category));

  async function save(e) {
    e.preventDefault();
    if (v.recipient_email && !isEmail(v.recipient_email)) return setError("Enter a valid recipient email.");
    if (Object.values(v).some((x) => looksLikeSecret(x))) return setError("One of the values looks like a secret. Remove it.");
    setBusy(true);
    setError("");
    try {
      await updateRecord("pt_handovers", handover.id, { ...v, recipient_email: v.recipient_email.trim().toLowerCase() }, handover.updated_at);
      toast.push("Handover details saved.");
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Handover details" onClose={onClose} busy={busy} size="lg">
      <form onSubmit={save} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput label="Recipient name" value={v.recipient_name} onChange={(x) => setV({ ...v, recipient_name: x })} maxLength={200} />
        <TextInput label="Recipient organisation" value={v.recipient_organisation} onChange={(x) => setV({ ...v, recipient_organisation: x })} maxLength={200} />
        <TextInput type="email" label="Recipient email" value={v.recipient_email} onChange={(x) => setV({ ...v, recipient_email: x })} />
        <TextInput type="date" label="Handover date" value={v.handover_date} onChange={(x) => setV({ ...v, handover_date: x })} />
        <Select full label="Signed approval document" value={v.approval_document_id} onChange={(x) => setV({ ...v, approval_document_id: x })}
          options={approvalDocs.map((d) => ({ value: d.id, label: `${d.name}${d.version ? ` v${d.version}` : ""}` }))}
          placeholder={approvalDocs.length ? "— Select —" : "— Upload a Client Approval / Completion Certificate document first —"}
          help="Must be a Client Approval, Completion Certificate, Admin Access Handover or Agreement document." />
        <TextArea full label="Notes" value={v.notes} onChange={(x) => setV({ ...v, notes: x })} maxLength={5000} />
        {error && <div className="sm:col-span-2"><Banner tone="danger">{error}</Banner></div>}
        <div className="flex justify-end gap-2 border-t border-[#eef0f4] pt-4 sm:col-span-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save details</Button>
        </div>
      </form>
    </Modal>
  );
}

function CompleteModal({ handover, onClose, onDone }) {
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    if (comment.trim().length < 10) return setError("Describe how the handover was confirmed (at least 10 characters).");
    if (!confirmed) return setError("Tick the confirmation.");
    setBusy(true);
    try {
      await transitionHandover(handover.id, "handed_over", comment.trim());
      await onDone("Handover recorded as completed.");
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Record handover as completed" onClose={onClose} busy={busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>Record completion</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-[#4b4f5c]">Recipient: <strong>{handover.recipient_name}</strong>{handover.recipient_organisation ? ` (${handover.recipient_organisation})` : ""} · Handover date {formatDate(handover.handover_date)}</p>
        <TextArea label="How was the handover confirmed?" required value={comment} onChange={setComment} maxLength={2000}
          help="e.g. 'Credentials transferred in person on 14 Nov; client confirmed receipt by email the same day.'" />
        <Checkbox label="I confirm the recipient has received the project, its access and its documentation." checked={confirmed} onChange={setConfirmed} />
        {error && <Banner tone="danger">{error}</Banner>}
      </div>
    </Modal>
  );
}

export default function HandoverPanel({ docsVersion }) {
  const { project, refs, readOnly, reloadProject } = useProject();
  const { canEdit, isManager } = useRole();
  const toast = useToast();
  const [editingItem, setEditingItem] = useState(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: loaded, error: loadError, reload: load } = useLoad(() => getHandover(project.id), [project.id, docsVersion ?? 0]);
  const data = loaded || (loadError ? { handover: null, items: [], events: [] } : undefined);
  const error = loadError?.message || "";

  const after = useCallback(async (msg) => {
    if (msg) toast.push(msg);
    load();
    reloadProject();
  }, [load, reloadProject, toast]);

  const docs = (refs.documents || []).filter((d) => !d.archived_at);
  const docName = (id) => docs.find((d) => d.id === id)?.name;

  if (data === undefined) return <Card title="Handover"><Spinner /></Card>;
  const { handover, items, events } = data;
  const writable = canEdit && !readOnly;

  if (!handover) {
    return (
      <Card title="Handover">
        {error && <Banner tone="danger" className="mb-3">{error}</Banner>}
        <p className="text-sm text-[#676b7a]">No handover has been started for this project.</p>
        {writable && (
          <Button className="mt-3" variant="primary" icon={ClipboardCheck} busy={busy} onClick={async () => {
            setBusy(true);
            try { await startHandover(project.id); await after("Handover checklist created."); } catch (e) { toast.push(e.message, "danger"); } finally { setBusy(false); }
          }}>Start handover</Button>
        )}
      </Card>
    );
  }

  const pending = items.filter((i) => i.state === "pending").length;
  const isDraft = handover.status === "draft";

  return (
    <Card title="Handover" actions={<Badge value={handover.status} label={labelOf(HANDOVER_STATUS, handover.status)} />}>
      {error && <Banner tone="danger" className="mb-3">{error}</Banner>}
      <Stepper status={handover.status} />
      <p className="mt-3 text-sm text-[#676b7a]">
        Draft → Ready for Review (all items evidenced, recipient, date and signed approval) → Approved (manager) → Handed Over (manager, with confirmation).
        A ticked box alone never completes a handover.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-[#eef0f4] p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs text-[#8a8f9c]">Recipient</p><p className="font-medium">{handover.recipient_name || "—"}{handover.recipient_organisation ? `, ${handover.recipient_organisation}` : ""}</p></div>
        <div><p className="text-xs text-[#8a8f9c]">Recipient email</p><p className="break-all">{handover.recipient_email || "—"}</p></div>
        <div><p className="text-xs text-[#8a8f9c]">Handover date</p><p>{formatDate(handover.handover_date)}</p></div>
        <div><p className="text-xs text-[#8a8f9c]">Signed approval</p><p>{docName(handover.approval_document_id) || (handover.approval_document_id ? "Document (restricted)" : "—")}</p></div>
        {handover.approved_at && <div className="sm:col-span-2"><p className="text-xs text-[#8a8f9c]">Approved</p><p>{formatDateTime(handover.approved_at)} by {handover.approved_by_email || "—"}</p></div>}
        {handover.handed_over_at && <div className="sm:col-span-2"><p className="text-xs text-[#8a8f9c]">Handed over</p><p>{formatDateTime(handover.handed_over_at)} by {handover.handed_over_by_email || "—"}</p></div>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {writable && isDraft && <Button size="sm" icon={Pencil} onClick={() => setEditingDetails(true)}>Edit details</Button>}
        {writable && isDraft && (
          <Button size="sm" variant="primary" icon={Send} disabled={pending > 0} title={pending ? `${pending} item(s) still pending` : undefined}
            onClick={() => setDialog({ to: "ready_for_review", title: "Submit handover for review?", message: "The checklist and details lock until it is sent back to Draft.", label: "Submit for review" })}>
            Submit for review{pending ? ` (${pending} pending)` : ""}
          </Button>
        )}
        {isManager && !readOnly && handover.status === "ready_for_review" && (
          <Button size="sm" variant="primary" icon={CircleCheck}
            onClick={() => setDialog({ to: "approved", title: "Approve this handover?", message: "Confirm you have reviewed every checklist item, its evidence and the signed approval document.", label: "Approve" })}>
            Approve
          </Button>
        )}
        {isManager && !readOnly && handover.status === "approved" && (
          <Button size="sm" variant="primary" icon={CircleCheck} disabled={handover.handover_date > todayISO()}
            title={handover.handover_date > todayISO() ? "The handover date is in the future" : undefined}
            onClick={() => setDialog({ kind: "complete" })}>Record handover completed</Button>
        )}
        {!readOnly && ((handover.status === "ready_for_review" && canEdit) || (["approved", "handed_over"].includes(handover.status) && isManager)) && (
          <Button size="sm" variant="secondary" icon={Undo2}
            onClick={() => setDialog({ to: "draft", title: "Send back to Draft?", message: "Approval (if any) is cleared and the checklist becomes editable again.", label: "Send back", reason: true })}>
            {handover.status === "ready_for_review" ? "Send back to Draft" : "Reopen"}
          </Button>
        )}
      </div>

      <div className="relative mt-4 overflow-x-auto rounded-xl border border-[#eef0f4]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Handover checklist</caption>
          <thead className="bg-[#f8f9fb] text-xs uppercase tracking-wide text-[#676b7a]">
            <tr><th scope="col" className="px-3 py-2">Item</th><th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2">Evidence</th><th scope="col" className="px-3 py-2">Completed</th><th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-[#eef0f4] align-top">
                <td className="px-3 py-2 font-medium text-[#2b303b]">{labelOf(HANDOVER_ITEMS, it.item_key)}</td>
                <td className="px-3 py-2"><Badge value={it.state === "done" ? "done" : it.state === "not_applicable" ? "not_applicable" : "pending"} label={labelOf(HANDOVER_ITEM_STATE, it.state)} /></td>
                <td className="px-3 py-2 text-[#4b4f5c]">
                  {it.evidence_note && <p className="whitespace-pre-wrap">{it.evidence_note}</p>}
                  {it.evidence_document_id && <p className="text-xs text-[#1f4693]">📎 {docName(it.evidence_document_id) || "Document"}</p>}
                  {!it.evidence_note && !it.evidence_document_id && "—"}
                </td>
                <td className="px-3 py-2 text-xs text-[#676b7a]">{it.completed_at ? `${formatDateTime(it.completed_at)}${it.completed_by_email ? ` · ${it.completed_by_email}` : ""}` : "—"}</td>
                <td className="px-3 py-2 text-right">
                  {writable && isDraft && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditingItem(it)} aria-label={`Update ${labelOf(HANDOVER_ITEMS, it.item_key)}`}>Update</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-[#2b303b]">Handover history ({events.length})</summary>
        <ul className="mt-2 space-y-1 text-sm">
          {events.map((ev) => (
            <li key={ev.id} className="text-[#4b4f5c]">
              <span className="font-medium">{ev.from_status ? `${labelOf(HANDOVER_STATUS, ev.from_status)} → ` : ""}{labelOf(HANDOVER_STATUS, ev.to_status)}</span>
              {" · "}{formatDateTime(ev.created_at)}{ev.actor_email ? ` · ${ev.actor_email}` : ""}{ev.comment ? ` — ${ev.comment}` : ""}
            </li>
          ))}
        </ul>
      </details>

      {editingItem && <ItemModal item={editingItem} docs={docs} amcApplicable={project.amc_applicable} onClose={() => setEditingItem(null)} onSaved={load} />}
      {editingDetails && <DetailsModal handover={handover} docs={docs} onClose={() => setEditingDetails(false)} onSaved={load} />}
      {dialog?.kind === "complete" && <CompleteModal handover={handover} onClose={() => setDialog(null)} onDone={after} />}
      {dialog && dialog.to && (
        <ConfirmDialog title={dialog.title} message={dialog.message} confirmLabel={dialog.label} tone="primary"
          requireReason={dialog.reason} reasonLabel="Reason" minReason={5}
          onConfirm={async (reason) => { await transitionHandover(handover.id, dialog.to, reason || null); await after("Handover updated."); }}
          onClose={() => setDialog(null)} />
      )}
    </Card>
  );
}

// Module 9 — Employee Documents (HR): the central document service.
// Overview, directory, verification queue, letters (templates / preview /
// issue / offer filing), contracts, policies, acknowledgements, expiry
// reminders and the required-document checklist. Files live in the private
// hr-documents bucket; reads use 60-second signed URLs and every
// view/download is logged on the server. Exports below are reused by the
// Employee Portal and the employee profile.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Archive, CheckCircle2, Download, Eye, FilePlus2, History, Paperclip, Pencil, RefreshCw, RotateCcw, Upload, XCircle,
} from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import {
  DOC_ACCEPT, archiveDocument, checkDocumentFile, documentChecklist, formatBytes,
  getDocumentUrl, getLatestVersionOf, latestVersion, listDocumentCategories, uploadDocument, uploadDocumentObject, uploadDocumentVersion,
} from "@/lib/hr/documents";
import {
  CONTRACT_STATUSES, CONTRACT_TYPES, getDocumentMeta, listAttachments, listDocumentAcknowledgements, listDocumentReviews,
  listLetterContent, listRenewalRequests, cancelRenewal, pendingLetter, renewContract, requestRenewal, resumeLetterPdf,
  reviewDocument, setDocumentDetails, uploadAttachment, uploadDocumentEx,
} from "@/lib/hr/documentCenter";
import { useEmployeeOptions } from "@/lib/hr/org";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input,
  Loading, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import OverviewTab from "./documents/OverviewTab";
import DirectoryTab from "./documents/DirectoryTab";
import LettersTab from "./documents/LettersTab";
import TemplatesTab from "./documents/TemplatesTab";
import PoliciesTab from "./documents/PoliciesTab";
import AcknowledgementsTab from "./documents/AcknowledgementsTab";
import ExpiryTab from "./documents/ExpiryTab";

export const businessToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const label = (s) => String(s ?? "").replace(/_/g, " ");

export function ExpiryText({ date }) {
  if (!date) return <span className="text-slate-400">—</span>;
  const past = date < businessToday();
  return <span className={past ? "font-semibold text-rose-700" : undefined}>{formatDate(date)}{past ? " (expired)" : ""}</span>;
}

/**
 * Open a document version in a new tab (view) or download it. The tab is
 * opened synchronously (popup blockers) and pointed at the signed URL only
 * after the server created it and logged the access.
 */
function preopenTab() {
  const w = window.open("", "_blank");
  if (w) { try { w.opener = null; } catch { /* cross-origin */ } }
  return w;
}

export async function openVersion(version, action, notify, preopened) {
  const w = preopened ?? preopenTab();
  const res = await getDocumentUrl(version, action);
  if (res.error) { w?.close(); notify(res.error, "error"); return; }
  if (w) w.location.href = res.data;
  else {
    const a = document.createElement("a");
    a.href = res.data; a.target = "_blank"; a.rel = "noopener noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
  }
}

/** Open the latest version of a document known only by id (checklist / directory rows). */
export async function openLatestOf(documentId, action, notify) {
  const w = preopenTab();
  const v = await getLatestVersionOf(documentId);
  if (v.error || !v.data) { w?.close(); notify(v.error || "No file is available for this document.", "error"); return; }
  await openVersion(v.data, action, notify, w);
}

function FileField({ file, onFile, error }) {
  return (
    <Field label="File" required error={error} hint="PDF, PNG, JPEG, WEBP, DOC, DOCX or XLSX · max 10 MB">
      <Input type="file" accept={DOC_ACCEPT} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file && <span className="text-xs text-slate-500">{file.name} · {formatBytes(file.size)}</span>}
    </Field>
  );
}

/** Retry block shown when the record was registered but the file did not reach storage. */
function PendingUpload({ pending, file, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function retry() {
    setBusy(true); setError(null);
    const res = await uploadDocumentObject(pending.storage_path, file, pending.mime);
    setBusy(false);
    if (res.error) setError(res.error); else onUploaded();
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">The file has not been stored yet.</p>
      <p className="mt-1">The document record was created, but the upload did not complete. Retry now (possible for 24 hours), or upload a new version later.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2"><Button size="sm" loading={busy} onClick={retry}><RefreshCw className="h-4 w-4" aria-hidden="true" />Retry upload</Button></div>
      {error && <div className="mt-2"><InlineError message={error} /></div>}
    </div>
  );
}

/** Contract / certificate metadata inputs (HR). */
function DetailFields({ v, set, group }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Issue date"><Input type="date" value={v.issue_date ?? ""} onChange={set("issue_date")} /></Field>
      <Field label="Effective date"><Input type="date" value={v.effective_date ?? ""} onChange={set("effective_date")} /></Field>
      {group === "contract" && <>
        <Field label="Contract type"><Select placeholder="Choose" value={v.contract_type ?? ""} onChange={set("contract_type")} options={CONTRACT_TYPES.map((x) => ({ value: x, label: label(x) }))} /></Field>
        <Field label="Renewal date" hint="HR is reminded before this date."><Input type="date" value={v.renewal_date ?? ""} onChange={set("renewal_date")} /></Field>
      </>}
    </div>
  );
}

/**
 * Upload a new document. mode "hr": employee picker + any active category
 * (with contract / certificate details). mode "self": fixed employee, only
 * categories employees may upload.
 */
export function UploadDocumentModal({ open, onClose, onDone, mode = "hr", employeeId, employeeOptions, categories, preset }) {
  const { notify } = useToast();
  const [v, setV] = useState({ employee: preset?.employee ?? employeeId ?? "", category: preset?.category ?? "", title: "", expiry: "" });
  const [details, setDetails] = useState({ requires_acknowledgement: false });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const setD = (k) => (e) => setDetails((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const usable = (categories ?? []).filter((c) => c.active && (mode === "hr" || (c.employee_can_upload && !c.is_confidential)) && (!preset?.groups || preset.groups.includes(c.doc_group)));
  const cat = usable.find((c) => c.code === v.category);

  function close() {
    if (pending) { notify("The document record was saved without a file. Retry from \"Upload new version\" if needed.", "error"); onDone?.(); }
    onClose();
  }
  async function submit() {
    const errs = {};
    if (mode === "hr" && !v.employee) errs.employee = "Choose an employee.";
    if (!v.category) errs.category = "Choose a category.";
    if (v.title.length > 200) errs.title = "200 characters maximum.";
    if (cat?.requires_expiry && !v.expiry) errs.expiry = "This category needs an expiry date.";
    if (v.expiry && v.expiry < businessToday()) errs.expiry = "The expiry date is already in the past.";
    if (details.renewal_date && v.expiry && details.renewal_date > v.expiry) errs.expiry = "The renewal date must be on or before the expiry date.";
    const chk = checkDocumentFile(file);
    if (chk.error) errs.file = chk.error;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const d = mode === "hr"
      ? { ...details, requires_acknowledgement: details.requires_acknowledgement || undefined }
      : { issue_date: details.issue_date };
    const hasDetails = Object.values(d).some((x) => x !== "" && x !== undefined && x !== null && x !== false);
    const args = { employeeId: mode === "hr" ? v.employee : employeeId, categoryCode: v.category, title: v.title, expiryDate: v.expiry, file };
    const res = hasDetails ? await uploadDocumentEx({ ...args, details: d }) : await uploadDocument(args);
    setBusy(false);
    if (res.pending) { setPending(res.pending); setError(res.error); return; }
    if (res.error) { setError(res.error); return; }
    notify(mode === "self" ? "Document uploaded. HR has been asked to verify it." : "Document uploaded. It is pending verification.");
    onDone?.();
    onClose();
  }
  function uploadedAfterRetry() {
    setPending(null);
    notify("Document uploaded. It is pending verification.");
    onDone?.();
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title={preset?.title ?? "Upload document"} size="md"
      footer={<><Button variant="secondary" onClick={close} disabled={busy}>{pending ? "Close" : "Cancel"}</Button>{!pending && <Button loading={busy} onClick={submit}><Upload className="h-4 w-4" aria-hidden="true" />Upload</Button>}</>}>
      <div className="flex flex-col gap-3">
        {mode === "hr" && (
          <Field label="Employee" required error={errors.employee}>
            <Select placeholder="Choose an employee" value={v.employee} onChange={set("employee")} options={employeeOptions ?? []} disabled={Boolean(pending)} />
          </Field>
        )}
        <Field label="Category" required error={errors.category} hint={cat?.description}>
          <Select placeholder="Choose a category" value={v.category} onChange={set("category")} disabled={Boolean(pending)}
            options={usable.map((c) => ({ value: c.code, label: `${c.name}${c.is_confidential ? " (confidential)" : ""}` }))} />
        </Field>
        <Field label="Title" error={errors.title} hint="Optional — defaults to the category name.">
          <Input value={v.title} maxLength={200} onChange={set("title")} disabled={Boolean(pending)} placeholder="e.g. Sample ID proof" />
        </Field>
        <Field label="Expiry date" required={Boolean(cat?.requires_expiry)} error={errors.expiry}>
          <Input type="date" min={businessToday()} value={v.expiry} onChange={set("expiry")} disabled={Boolean(pending)} />
        </Field>
        {!pending && mode === "hr" && cat && ["contract", "certificate", "appointment_letter", "letter"].includes(cat.doc_group) && (
          <>
            <DetailFields v={details} set={setD} group={cat.doc_group} />
            <Checkbox label="Employee must acknowledge receipt" checked={Boolean(details.requires_acknowledgement)} onChange={setD("requires_acknowledgement")} />
          </>
        )}
        {!pending && mode === "self" && cat?.doc_group === "certificate" && (
          <Field label="Issue date" hint="Optional"><Input type="date" max={businessToday()} value={details.issue_date ?? ""} onChange={setD("issue_date")} /></Field>
        )}
        {!pending && <FileField file={file} onFile={setFile} error={errors.file} />}
        {mode === "self" && !usable.length && <p className="text-sm text-slate-600">There are no categories you can upload yourself. Ask HR to add the document.</p>}
        <InlineError message={error} />
        {pending && <PendingUpload pending={pending} file={file} onUploaded={uploadedAfterRetry} />}
      </div>
    </Modal>
  );
}

export function NewVersionModal({ doc, onClose, onDone }) {
  const { notify } = useToast();
  const [expiry, setExpiry] = useState(doc.expiry_date && doc.expiry_date >= businessToday() ? doc.expiry_date : "");
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const needsExpiry = Boolean(doc.category?.requires_expiry);

  function close() {
    if (pending) { notify("The new version was registered without a file. Upload again if needed.", "error"); onDone?.(); }
    onClose();
  }
  async function submit() {
    const errs = {};
    if (needsExpiry && !expiry) errs.expiry = "This category needs an expiry date.";
    if (expiry && expiry < businessToday()) errs.expiry = "The expiry date is already in the past.";
    const chk = checkDocumentFile(file);
    if (chk.error) errs.file = chk.error;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await uploadDocumentVersion({ documentId: doc.id, expiryDate: expiry, file });
    setBusy(false);
    if (res.pending) { setPending(res.pending); setError(res.error); return; }
    if (res.error) { setError(res.error); return; }
    notify(`Version ${res.data.version} uploaded. Verification was reset to pending.`);
    onDone?.();
    onClose();
  }
  return (
    <Modal open onClose={close} title={`New version · ${doc.title}`} size="md"
      footer={<><Button variant="secondary" onClick={close} disabled={busy}>{pending ? "Close" : "Cancel"}</Button>{!pending && <Button loading={busy} onClick={submit}><Upload className="h-4 w-4" aria-hidden="true" />Upload version {doc.current_version + 1}</Button>}</>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Earlier versions are kept. The document returns to <strong>pending</strong> verification.</p>
        <Field label="Expiry date" required={needsExpiry} error={errors.expiry}>
          <Input type="date" min={businessToday()} value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={Boolean(pending)} />
        </Field>
        {!pending && <FileField file={file} onFile={setFile} error={errors.file} />}
        <InlineError message={error} />
        {pending && <PendingUpload pending={pending} file={file} onUploaded={() => { setPending(null); notify("New version uploaded."); onDone?.(); onClose(); }} />}
      </div>
    </Modal>
  );
}

/** Version list with view / download buttons. */
export function VersionList({ doc }) {
  const { notify } = useToast();
  const versions = [...(doc.versions ?? [])].sort((a, b) => b.version - a.version);
  if (!versions.length) return <p className="text-sm text-slate-600">No versions registered.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {versions.map((ver) => (
        <li key={ver.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
          <span className="min-w-0 text-sm">
            <span className="font-semibold text-[#101a3a]">v{ver.version}</span>{ver.version === doc.current_version && <Badge tone="blue" className="ml-2">latest</Badge>}
            <span className="block truncate text-xs text-slate-500">{ver.file_name} · {formatBytes(ver.size_bytes)} · {formatDateTime(ver.uploaded_at)}</span>
          </span>
          <span className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={() => openVersion(ver, "view", notify)} aria-label={`View version ${ver.version}`}><Eye className="h-4 w-4" aria-hidden="true" />View</Button>
            <Button size="sm" variant="secondary" onClick={() => openVersion(ver, "download", notify)} aria-label={`Download version ${ver.version}`}><Download className="h-4 w-4" aria-hidden="true" />Download</Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Verify / reject with review notes (history is recorded server-side). */
function ReviewModal({ doc, approve, onClose, onDone }) {
  const { notify } = useToast();
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!approve && !reason.trim()) { setError("Give a reason for the rejection."); return; }
    setBusy(true); setError(null);
    const res = await reviewDocument(doc.id, approve, reason.trim(), notes.trim());
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(approve ? "Document verified. The employee is notified." : "Document rejected. The employee sees the reason.");
    onDone();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title={`${approve ? "Verify" : "Reject"} · ${doc.title} (v${doc.current_version})`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant={approve ? "success" : "danger"} loading={busy} onClick={go}>{approve ? "Verify" : "Reject"}</Button></>}>
      <div className="flex flex-col gap-3">
        {!approve && <Field label="Reason (shown to the employee)" required><Textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></Field>}
        <Field label="Verification notes" hint="Internal record of what was checked."><Textarea value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function DetailsModal({ doc, meta, onClose, onDone }) {
  const { notify } = useToast();
  const { hasPermission } = useAuth();
  const [v, setV] = useState({
    issue_date: meta?.issue_date ?? "", effective_date: meta?.effective_date ?? "", renewal_date: meta?.renewal_date ?? "",
    contract_type: meta?.contract_type ?? "", contract_status: meta?.contract_status ?? "", notes: meta?.notes ?? "",
    requires_acknowledgement: Boolean(meta?.requires_acknowledgement), includes_compensation: Boolean(meta?.includes_compensation),
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const group = doc.category?.doc_group;
  async function save() {
    setBusy(true); setError(null);
    const values = {
      issue_date: v.issue_date || null, effective_date: v.effective_date || null, renewal_date: v.renewal_date || null,
      notes: v.notes || null, requires_acknowledgement: v.requires_acknowledgement,
      ...(group === "contract" ? { contract_type: v.contract_type || null, contract_status: v.contract_status === "renewed" ? undefined : v.contract_status || null } : {}),
      ...(hasPermission("documents.compensation") ? { includes_compensation: v.includes_compensation } : {}),
    };
    const res = await setDocumentDetails(doc.id, Object.fromEntries(Object.entries(values).filter(([, x]) => x !== undefined)));
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Document details saved.");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Details · ${doc.title}`} size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <DetailFields v={v} set={set} group={group} />
        {group === "contract" && v.contract_status !== "renewed" && (
          <Field label="Contract status"><Select placeholder="—" value={v.contract_status} onChange={set("contract_status")} options={CONTRACT_STATUSES.map((x) => ({ value: x, label: label(x) }))} /></Field>
        )}
        <Field label="Notes"><Textarea value={v.notes} maxLength={2000} onChange={set("notes")} /></Field>
        <Checkbox label="Employee must acknowledge receipt" checked={v.requires_acknowledgement} onChange={set("requires_acknowledgement")} />
        {hasPermission("documents.compensation") && <Checkbox label="Contains compensation details (restricts who can open it)" checked={v.includes_compensation} onChange={set("includes_compensation")} />}
        <p className="text-xs text-slate-500">The expiry date changes only with a new version, so the history stays intact.</p>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function RenewalRequestModal({ doc, onClose, onDone }) {
  const { notify } = useToast();
  const [message, setMessage] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setError(null);
    const res = await requestRenewal(doc.id, message.trim(), due);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(doc.category?.employee_can_upload ? "Renewal requested. The employee is notified." : "Renewal request recorded for HR.");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Request renewal · ${doc.title}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={go}><RotateCcw className="h-4 w-4" aria-hidden="true" />Request</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">{doc.category?.employee_can_upload ? "The employee is asked to upload a renewed copy. The request closes automatically when a new version arrives." : "Employees cannot upload this category; the request tracks the renewal for HR."}</p>
        <Field label="Message"><Textarea value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} /></Field>
        <Field label="Due date"><Input type="date" min={businessToday()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function RenewContractModal({ doc, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ title: doc.title, expiry: "", effective_date: "", renewal_date: "" });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function go() {
    const chk = checkDocumentFile(file);
    if (chk.error) { setError(chk.error); return; }
    if (v.expiry && v.expiry < businessToday()) { setError("The expiry date is already in the past."); return; }
    setBusy(true); setError(null);
    const res = await renewContract({ documentId: doc.id, file, expiryDate: v.expiry, title: v.title, details: { effective_date: v.effective_date, renewal_date: v.renewal_date } });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Renewed contract stored. The previous contract is kept as replaced.");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Renew contract · ${doc.title}`} size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={go}><Upload className="h-4 w-4" aria-hidden="true" />Store renewal</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">The renewed, signed contract becomes a <strong>new record</strong>. The current contract and all its versions stay unchanged and are marked <em>replaced</em>.</p>
        <Field label="Title"><Input value={v.title} maxLength={200} onChange={set("title")} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Effective date"><Input type="date" value={v.effective_date} onChange={set("effective_date")} /></Field>
          <Field label="Expiry date"><Input type="date" min={businessToday()} value={v.expiry} onChange={set("expiry")} /></Field>
          <Field label="Renewal date"><Input type="date" value={v.renewal_date} onChange={set("renewal_date")} /></Field>
        </div>
        <FileField file={file} onFile={setFile} />
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function AttachmentModal({ doc, onClose, onDone }) {
  const { notify } = useToast();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    const chk = checkDocumentFile(file);
    if (chk.error) { setError(chk.error); return; }
    setBusy(true); setError(null);
    const res = await uploadAttachment({ parentId: doc.id, title, file });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Attachment added.");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Add attachment · ${doc.title}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={go}><Paperclip className="h-4 w-4" aria-hidden="true" />Attach</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Title"><Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annexure A — role description" /></Field>
        <FileField file={file} onFile={setFile} />
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

/** Letter text (what the stored PDF renders), shown read-only. */
export function LetterText({ letter }) {
  if (!letter) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{letter.reference} · {letter.template_name}{letter.template_version ? ` v${letter.template_version}` : ""}</p>
      <p className="mt-2 font-bold text-[#101a3a]">{letter.title}</p>
      <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm text-slate-800">{letter.body}</div>
    </div>
  );
}

export function DocumentDetailModal({ doc, onClose, onChanged, canManage, myEmployeeId }) {
  const { notify } = useToast();
  const [action, setAction] = useState(null);   // version | verify | reject | archive | details | renewal | renew | attach
  const [busy, setBusy] = useState(false);
  const meta = useHrQuery(() => getDocumentMeta(doc.id), [doc.id]);
  const reviews = useHrQuery(() => listDocumentReviews(doc.id), [doc.id]);
  const letters = useHrQuery(() => listLetterContent(doc.id), [doc.id]);
  const acks = useHrQuery(() => listDocumentAcknowledgements(doc.id), [doc.id]);
  const attachments = useHrQuery(() => listAttachments(doc.id), [doc.id]);
  const renewals = useHrQuery(() => listRenewalRequests(doc.id), [doc.id]);
  const pending = useHrQuery(() => (canManage && meta.data?.source !== "upload" && meta.data ? pendingLetter(doc.id) : Promise.resolve({ data: null })), [doc.id, meta.data?.source, canManage]);
  const archived = Boolean(doc.archived_at);
  const replaced = doc.verification_status === "replaced";
  const own = doc.employee_id === myEmployeeId;
  const m = meta.data ?? {};
  const group = doc.category?.doc_group;
  const openRenewal = (renewals.data ?? []).find((r) => r.status === "open");
  const refresh = () => { meta.reload(); reviews.reload(); letters.reload(); acks.reload(); attachments.reload(); renewals.reload(); pending.reload(); onChanged?.(); };
  const done = () => { setAction(null); refresh(); };
  const canAct = canManage && !archived && !replaced;

  async function resume() {
    setBusy(true);
    const res = await resumeLetterPdf(doc.id);
    setBusy(false);
    if (res.error) notify(res.error, "error"); else { notify("Letter PDF stored."); refresh(); onClose(); }
  }

  return (
    <>
      <Modal open onClose={onClose} title={doc.title} size="lg"
        footer={<>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {canManage && !archived && <Button variant="secondary" onClick={() => setAction("archive")}><Archive className="h-4 w-4" aria-hidden="true" />Archive</Button>}
          {canAct && <Button variant="secondary" onClick={() => setAction("details")}><Pencil className="h-4 w-4" aria-hidden="true" />Details</Button>}
          {canAct && !openRenewal && <Button variant="secondary" onClick={() => setAction("renewal")}><RotateCcw className="h-4 w-4" aria-hidden="true" />Request renewal</Button>}
          {canAct && group === "contract" && <Button variant="secondary" onClick={() => setAction("renew")}><RefreshCw className="h-4 w-4" aria-hidden="true" />Renew contract</Button>}
          {canAct && group === "contract" && !m.parent_document_id && <Button variant="secondary" onClick={() => setAction("attach")}><Paperclip className="h-4 w-4" aria-hidden="true" />Attachment</Button>}
          {canAct && <Button variant="secondary" onClick={() => setAction("version")}><FilePlus2 className="h-4 w-4" aria-hidden="true" />Upload new version</Button>}
          {canAct && !own && doc.verification_status !== "rejected" && doc.current_version > 0 && <Button variant="danger" onClick={() => setAction("reject")}><XCircle className="h-4 w-4" aria-hidden="true" />Reject</Button>}
          {canAct && !own && doc.verification_status !== "verified" && doc.current_version > 0 && <Button variant="success" onClick={() => setAction("verify")}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Verify</Button>}
        </>}>
        <div className="flex flex-col gap-5">
          {pending.data && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">An issued letter is waiting for its PDF.</p>
              <p className="mt-1">The text ({pending.data.reference}) is stored on the server. Build and store the PDF now.</p>
              <Button size="sm" className="mt-2" loading={busy} onClick={resume}><RefreshCw className="h-4 w-4" aria-hidden="true" />Store PDF</Button>
            </div>
          )}
          <DescriptionList items={[
            { label: "Employee", value: doc.employee ? `${fullName(doc.employee)} (${doc.employee.employee_code})` : null },
            { label: "Category", value: doc.category ? <span>{doc.category.name}{doc.category.is_confidential && <Badge tone="red" className="ml-2">confidential</Badge>}{m.includes_compensation && <Badge tone="violet" className="ml-2">compensation</Badge>}</span> : null },
            { label: "Status", value: <StatusBadge status={doc.verification_status} /> },
            { label: "Expiry", value: <ExpiryText date={doc.expiry_date} /> },
            { label: "Source", value: m.source ? (m.source === "generated" ? "Generated from template" : m.source === "recruitment" ? "Filed from Recruitment" : "Uploaded") : null },
            m.issue_date && { label: "Issue date", value: formatDate(m.issue_date) },
            m.effective_date && { label: "Effective date", value: formatDate(m.effective_date) },
            m.renewal_date && { label: "Renewal date", value: formatDate(m.renewal_date) },
            m.contract_type && { label: "Contract", value: `${label(m.contract_type)} · ${label(m.contract_status ?? "—")}` },
            { label: "Verified / rejected at", value: formatDateTime(doc.verified_at) },
            doc.rejection_reason && { label: "Rejection reason", value: doc.rejection_reason },
            m.verification_notes && { label: "Verification notes", value: m.verification_notes },
            m.requires_acknowledgement && { label: "Acknowledgement", value: (acks.data ?? []).some((a) => a.version === doc.current_version) ? <Badge tone="green">acknowledged v{doc.current_version}</Badge> : <Badge tone="amber">pending</Badge> },
            m.supersedes_document_id && { label: "Renews", value: "A previous contract (kept as replaced)" },
            m.notes && { label: "Notes", value: m.notes },
            { label: "Created", value: formatDateTime(doc.created_at) },
            archived && { label: "Archived", value: formatDateTime(doc.archived_at) },
          ]} />
          {own && canManage && !archived && <p className="text-xs text-slate-500">This is your own document; another HR user must verify it.</p>}
          {openRenewal && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              <span>Renewal requested {formatDateTime(openRenewal.requested_at)}{openRenewal.due_date ? ` · due ${formatDate(openRenewal.due_date)}` : ""}{openRenewal.message ? ` — ${openRenewal.message}` : ""}</span>
              {canManage && <Button size="sm" variant="ghost" onClick={async () => { const r = await cancelRenewal(openRenewal.id); if (r.error) notify(r.error, "error"); else { notify("Renewal request cancelled."); refresh(); } }}>Cancel request</Button>}
            </div>
          )}
          <section>
            <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Versions</h3>
            <VersionList doc={doc} />
          </section>
          {(letters.data ?? []).length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Issued text</h3>
              <LetterText letter={letters.data[0]} />
              {letters.data.length > 1 && <p className="mt-1 text-xs text-slate-500">{letters.data.length - 1} earlier issue(s) kept.</p>}
            </section>
          )}
          {(attachments.data ?? []).length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Attachments</h3>
              <ul className="flex flex-col gap-2">
                {attachments.data.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm">
                    <span className="font-semibold text-[#101a3a]">{a.title}</span>
                    <Button size="sm" variant="secondary" disabled={!latestVersion(a)} onClick={() => openVersion(latestVersion(a), "view", notify)}><Eye className="h-4 w-4" aria-hidden="true" />View</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(reviews.data ?? []).length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[#101a3a]"><History className="h-4 w-4" aria-hidden="true" />Verification history</h3>
              <ol className="flex flex-col gap-1.5 text-sm">
                {reviews.data.map((r) => (
                  <li key={r.id} className="rounded-lg bg-slate-50 px-3 py-1.5">
                    <span className="font-semibold">v{r.version}</span> · {label(r.from_status)} → <StatusBadge status={r.to_status} /> <span className="text-xs text-slate-500">{formatDateTime(r.created_at)}</span>
                    {r.reason && <span className="block text-xs text-rose-700">Reason: {r.reason}</span>}
                    {r.notes && <span className="block text-xs text-slate-600">Notes: {r.notes}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {(acks.data ?? []).length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Acknowledgements</h3>
              <ul className="flex flex-col gap-1 text-sm">{acks.data.map((a) => <li key={a.id}>v{a.version} · {formatDateTime(a.acknowledged_at)}</li>)}</ul>
              <p className="mt-1 text-xs text-slate-500">A record of receipt — not a digital signature.</p>
            </section>
          )}
        </div>
      </Modal>
      {action === "version" && <NewVersionModal doc={doc} onClose={() => setAction(null)} onDone={refresh} />}
      {(action === "verify" || action === "reject") && <ReviewModal doc={doc} approve={action === "verify"} onClose={() => setAction(null)} onDone={() => { setAction(null); onChanged?.(); onClose(); }} />}
      {action === "details" && <DetailsModal doc={doc} meta={m} onClose={() => setAction(null)} onDone={done} />}
      {action === "renewal" && <RenewalRequestModal doc={doc} onClose={() => setAction(null)} onDone={done} />}
      {action === "renew" && <RenewContractModal doc={doc} onClose={() => setAction(null)} onDone={() => { setAction(null); onChanged?.(); onClose(); }} />}
      {action === "attach" && <AttachmentModal doc={doc} onClose={() => setAction(null)} onDone={done} />}
      <ConfirmDialog open={action === "archive"} onClose={() => setAction(null)} tone="danger" title="Archive document"
        message="Archived documents are hidden from the employee and managers and leave the checklist. The file and its history are kept." confirmLabel="Archive"
        onConfirm={async () => { const res = await archiveDocument(doc.id); if (!res.error) { notify("Document archived."); onChanged?.(); onClose(); } return res; }} />
    </>
  );
}

function Checklist({ employees, categories, canManage }) {
  const { notify } = useToast();
  const [employee, setEmployee] = useState("");
  const [uploadFor, setUploadFor] = useState(null);
  const [opening, setOpening] = useState(null);
  const q = useHrQuery(() => documentChecklist(employee), [employee]);
  async function openDoc(row, action) {
    setOpening(row.document_id);
    await openLatestOf(row.document_id, action, notify);
    setOpening(null);
  }
  return (
    <>
      <Toolbar>
        <Select aria-label="Employee" className="sm:w-72" placeholder="Choose an employee" value={employee} onChange={(e) => setEmployee(e.target.value)} options={employees ?? []} />
      </Toolbar>
      {!employee ? <Card><EmptyState title="Choose an employee" description="See which required documents are complete, pending or missing." /></Card> : (
        <DataTable caption="Document checklist" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} rowKey="category_code"
          emptyTitle="No required documents" emptyDescription="No checklist categories apply to this employee's employment type."
          columns={[
            { key: "category_name", header: "Required document", render: (r) => <span className="font-semibold text-[#101a3a]">{r.category_name}</span> },
            { key: "is_complete", header: "Complete", render: (r) => (r.is_complete ? <Badge tone="green">complete</Badge> : r.document_id ? <Badge tone="amber">incomplete</Badge> : <Badge tone="red">missing</Badge>) },
            { key: "verification_status", header: "Status", render: (r) => (r.verification_status ? <StatusBadge status={r.verification_status} /> : "—") },
            { key: "expiry_date", header: "Expiry", render: (r) => <ExpiryText date={r.expiry_date} /> },
            { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
              <span className="flex gap-1">
                {r.document_id && <Button size="sm" variant="ghost" loading={opening === r.document_id} onClick={() => openDoc(r, "view")}><Eye className="h-4 w-4" aria-hidden="true" />View</Button>}
                {canManage && !r.is_complete && <Button size="sm" variant="secondary" onClick={() => setUploadFor(r)}><Upload className="h-4 w-4" aria-hidden="true" />Upload</Button>}
              </span>) },
          ]} />
      )}
      {uploadFor && <UploadDocumentModal open mode="hr" employeeOptions={employees} categories={categories} preset={{ employee, category: uploadFor.category_code }}
        onClose={() => setUploadFor(null)} onDone={q.reload} />}
    </>
  );
}

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "directory", label: "Directory" },
  { value: "verification", label: "Verification", manage: true },
  { value: "letters", label: "Letters", manage: true },
  { value: "contracts", label: "Contracts" },
  { value: "certificates", label: "Certificates" },
  { value: "templates", label: "Templates", manage: true },
  { value: "policies", label: "Policies", hr: true },
  { value: "acknowledgements", label: "Acknowledgements", hr: true },
  { value: "expiry", label: "Expiry & reminders" },
  { value: "checklist", label: "Checklist" },
];

export default function DocumentsPage() {
  const { hasPermission, hr } = useAuth();
  const canManage = hasPermission("documents.manage");
  const isHr = canManage || hasPermission("documents.view");
  const tabs = TABS.filter((t) => (!t.manage || canManage) && (!t.hr || isHr));
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("tab") === "expiring" ? "expiry" : params.get("tab") === "all" ? "directory" : params.get("tab");
  const [tab, setTabState] = useState(() => (tabs.some((t) => t.value === fromUrl) ? fromUrl : "overview"));
  const setTab = (t) => { setTabState(t); setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true }); };
  const cats = useHrQuery(() => listDocumentCategories(), []);
  const employees = useEmployeeOptions({ includeInactive: true });
  const shared = { categories: cats.data, employees: employees.data, canManage, myEmployeeId: hr?.employee?.id, onNavigate: setTab };

  return (
    <>
      <PageHeader title="Employee Documents" description="Letters, contracts, certificates, policies and acknowledgements in private storage. Every view and download is logged." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} label="Document sections" />
      {cats.loading && !cats.data ? <Loading /> : cats.error ? <ErrorState message={cats.error} onRetry={cats.reload} /> : (
        <>
          {tab === "overview" && <OverviewTab {...shared} />}
          {tab === "directory" && <DirectoryTab {...shared} key="directory" />}
          {tab === "verification" && <DirectoryTab {...shared} key="verification" preset={{ status: "pending" }} mode="verification" />}
          {tab === "contracts" && <DirectoryTab {...shared} key="contracts" preset={{ group: "contract" }} mode="contracts" />}
          {tab === "certificates" && <DirectoryTab {...shared} key="certificates" preset={{ group: "certificate" }} mode="certificates" />}
          {tab === "letters" && <LettersTab {...shared} />}
          {tab === "templates" && <TemplatesTab {...shared} />}
          {tab === "policies" && <PoliciesTab {...shared} />}
          {tab === "acknowledgements" && <AcknowledgementsTab {...shared} />}
          {tab === "expiry" && <ExpiryTab {...shared} />}
          {tab === "checklist" && <Checklist employees={employees.data} categories={cats.data} canManage={canManage} />}
        </>
      )}
    </>
  );
}

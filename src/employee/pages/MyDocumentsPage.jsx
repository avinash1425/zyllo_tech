// Employee Portal — My Documents (Module 9). Own documents by type (letters,
// contracts, certificates…), upload / new version for permitted categories,
// pending acknowledgements, company policies addressed to me, expiring
// documents with renewal requests, required-document checklist and the
// profile photo. The server (RLS + RPCs) limits everything to my own
// documents and to published policies for my audience.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Camera, CheckCircle2, Download, Eye, FilePlus2, FileText, Trash2, Upload, UserRound } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import {
  AVATAR_ACCEPT, checkAvatarFile, documentChecklist, getAvatarUrl, latestVersion, listDocumentCategories, listEmployeeDocuments,
  removeMyPhoto, uploadMyPhoto,
} from "@/lib/hr/documents";
import {
  DOC_GROUPS, acknowledgeDocument, acknowledgePolicy, listMyPolicies, listOpenRenewalRequests, myAcknowledgements, myPendingAcknowledgements,
  searchDocuments,
} from "@/lib/hr/documentCenter";
import { ExpiryText, NewVersionModal, UploadDocumentModal, openLatestOf, openVersion } from "@/hr/pages/DocumentsPage";
import { downloadPolicyText, openPolicyPdf } from "@/hr/pages/documents/PoliciesTab";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, PageHeader, StatusBadge, Tabs, useToast,
} from "@/hr/ui";

const TAB_KEYS = ["documents", "acknowledgements", "policies", "expiring"];

export default function MyDocumentsPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const [params, setParams] = useSearchParams();
  const [tab, setTabState] = useState(() => (TAB_KEYS.includes(params.get("tab")) ? params.get("tab") : "documents"));
  const setTab = (t) => { setTabState(t); setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true }); };
  const pending = useHrQuery(() => (me ? myPendingAcknowledgements() : Promise.resolve({ data: [] })), [me, tab]);
  const pendingCount = pending.data?.length ?? undefined;

  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;
  return (
    <>
      <PageHeader title="My Documents" description="Your documents are stored privately. Only you and authorised HR staff can open them." />
      <Tabs value={tab} onChange={setTab} label="My documents sections" tabs={[
        { value: "documents", label: "Documents" },
        { value: "acknowledgements", label: "Acknowledgements", count: pendingCount || undefined },
        { value: "policies", label: "Company policies" },
        { value: "expiring", label: "Expiring" },
      ]} />
      {tab === "documents" && <DocumentsSection me={me} photoPath={hr?.employee?.photo_path} />}
      {tab === "acknowledgements" && <AcknowledgementsSection pending={pending} onChanged={pending.reload} goPolicies={() => setTab("policies")} />}
      {tab === "policies" && <PoliciesSection onChanged={pending.reload} />}
      {tab === "expiring" && <ExpiringSection me={me} />}
    </>
  );
}

function DocumentsSection({ me, photoPath }) {
  const { notify } = useToast();
  const docs = useHrQuery(() => listEmployeeDocuments(me), [me]);
  const checklist = useHrQuery(() => documentChecklist(me), [me]);
  const cats = useHrQuery(() => listDocumentCategories({ activeOnly: true }), []);
  const [group, setGroup] = useState("");
  const [uploading, setUploading] = useState(null);   // {} or { category }
  const [versionFor, setVersionFor] = useState(null);
  const [opening, setOpening] = useState(null);
  const refresh = () => { docs.reload(); checklist.reload(); };
  const selfUpload = (cats.data ?? []).filter((c) => c.employee_can_upload && !c.is_confidential);
  const groupsPresent = DOC_GROUPS.filter((g) => (docs.data ?? []).some((d) => d.category?.doc_group === g.value));
  const rows = (docs.data ?? []).filter((d) => !group || d.category?.doc_group === group);

  const columns = [
    { key: "title", header: "Document", render: (r) => <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{r.title}</p><p className="text-xs text-slate-500">{r.category?.name}</p></div> },
    { key: "current_version", header: "Version", render: (r) => (r.current_version ? `v${r.current_version}` : "—") },
    { key: "expiry_date", header: "Expiry", render: (r) => <ExpiryText date={r.expiry_date} /> },
    { key: "verification_status", header: "Status", render: (r) => (
      <div className="max-w-xs"><StatusBadge status={r.verification_status} />{r.verification_status === "rejected" && r.rejection_reason && <p className="mt-1 text-xs text-rose-700">Reason: {r.rejection_reason}</p>}</div>) },
    { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => {
      const latest = latestVersion(r);
      return (
        <span className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" disabled={!latest} onClick={() => openVersion(latest, "view", notify)} aria-label={`View ${r.title}`}><Eye className="h-4 w-4" aria-hidden="true" />View</Button>
          <Button size="sm" variant="ghost" disabled={!latest} onClick={() => openVersion(latest, "download", notify)} aria-label={`Download ${r.title}`}><Download className="h-4 w-4" aria-hidden="true" />Download</Button>
          {r.category?.employee_can_upload && !r.category?.is_confidential && r.verification_status !== "replaced" && <Button size="sm" variant="secondary" onClick={() => setVersionFor(r)}><FilePlus2 className="h-4 w-4" aria-hidden="true" />New version</Button>}
        </span>
      );
    } },
  ];

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Required documents" actions={selfUpload.length > 0 && <Button size="sm" onClick={() => setUploading({})}><Upload className="h-4 w-4" aria-hidden="true" />Upload document</Button>}>
            {checklist.loading && !checklist.data ? <Loading /> : checklist.error ? <ErrorState message={checklist.error} onRetry={checklist.reload} /> : !checklist.data?.length ? (
              <EmptyState title="No required documents" description="Nothing is required for your employment type." />
            ) : (
              <ul className="flex flex-col gap-2">
                {checklist.data.map((c) => (
                  <li key={c.category_code} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-semibold text-[#101a3a]">{c.category_name}</span>
                      <span className="ml-2">{c.is_complete ? <Badge tone="green">complete</Badge> : c.document_id ? <StatusBadge status={c.verification_status} /> : <Badge tone="red">missing</Badge>}</span>
                      {c.expiry_date && <span className="block text-xs text-slate-500">Expires <ExpiryText date={c.expiry_date} /></span>}
                    </span>
                    <span className="flex gap-1">
                      {c.document_id && <Button size="sm" variant="ghost" loading={opening === c.document_id} onClick={async () => { setOpening(c.document_id); await openLatestOf(c.document_id, "view", notify); setOpening(null); }}><Eye className="h-4 w-4" aria-hidden="true" />View</Button>}
                      {!c.is_complete && !c.document_id && c.employee_can_upload && <Button size="sm" variant="secondary" onClick={() => setUploading({ category: c.category_code })}><Upload className="h-4 w-4" aria-hidden="true" />Upload</Button>}
                      {!c.is_complete && !c.document_id && !c.employee_can_upload && <span className="text-xs text-slate-500">Provided by HR</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <ProfilePhoto employeeId={me} path={photoPath} />
      </div>
      {groupsPresent.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by document type">
          {[{ value: "", label: "All" }, ...groupsPresent].map((g) => (
            <button key={g.value || "all"} type="button" onClick={() => setGroup(g.value)} aria-pressed={group === g.value}
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${group === g.value ? "bg-[#101a3a] text-white ring-[#101a3a]" : "bg-white text-[#173a52] ring-slate-200 hover:bg-slate-50"}`}>
              {g.label}
            </button>
          ))}
        </div>
      )}
      <DataTable caption="My documents" columns={columns} rows={rows} loading={docs.loading} error={docs.error} onRetry={docs.reload}
        emptyTitle="No documents yet" emptyDescription={selfUpload.length ? "Upload your documents, or wait for HR to add them." : "HR will add your documents."} />
      {uploading && <UploadDocumentModal open mode="self" employeeId={me} categories={cats.data} preset={{ category: uploading.category ?? "" }}
        onClose={() => setUploading(null)} onDone={refresh} />}
      {versionFor && <NewVersionModal doc={versionFor} onClose={() => setVersionFor(null)} onDone={refresh} />}
    </>
  );
}

function AcknowledgementsSection({ pending, onChanged, goPolicies }) {
  const { notify } = useToast();
  const history = useHrQuery(() => myAcknowledgements(), []);
  const [confirm, setConfirm] = useState(null);
  const [opening, setOpening] = useState(null);
  return (
    <div className="flex flex-col gap-4">
      <Card title="Waiting for your acknowledgement">
        {pending.loading && !pending.data ? <Loading /> : pending.error ? <ErrorState message={pending.error} onRetry={pending.reload} /> : !pending.data?.length ? (
          <EmptyState icon={CheckCircle2} title="All caught up" description="Nothing needs your acknowledgement." />
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.data.map((p) => (
              <li key={`${p.subject_type}-${p.item_id}-${p.version}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-semibold text-[#101a3a]">{p.title}</span> <Badge tone={p.subject_type === "policy" ? "blue" : "slate"}>{p.subject_type === "policy" ? "policy" : "document"} v{p.version}</Badge>
                  <span className="block text-xs text-slate-500">Shared {formatDateTime(p.requested_at)}</span>
                </span>
                <span className="flex gap-1">
                  {p.subject_type === "document"
                    ? <Button size="sm" variant="ghost" loading={opening === p.item_id} onClick={async () => { setOpening(p.item_id); await openLatestOf(p.item_id, "view", notify); setOpening(null); }}><Eye className="h-4 w-4" aria-hidden="true" />Read</Button>
                    : <Button size="sm" variant="ghost" onClick={goPolicies}><Eye className="h-4 w-4" aria-hidden="true" />Read</Button>}
                  <Button size="sm" onClick={() => setConfirm(p)}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Acknowledge</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="My acknowledgement history">
        <DataTable caption="Acknowledgement history" rows={history.data} loading={history.loading} error={history.error} onRetry={history.reload} emptyTitle="No acknowledgements yet" pageSize={10}
          columns={[
            { key: "title", header: "Item", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.title}</p><p className="text-xs text-slate-500">{r.subject_type} · version {r.version}</p></div> },
            { key: "acknowledged_at", header: "Acknowledged", render: (r) => formatDateTime(r.acknowledged_at) },
          ]} />
      </Card>
      <ConfirmDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} title="Acknowledge receipt" confirmLabel="I acknowledge" tone="success"
        message={confirm ? `I confirm that I have received and read "${confirm.title}" (version ${confirm.version}). This records receipt; it is not a digital signature.` : ""}
        onConfirm={async () => {
          const res = await (confirm.subject_type === "policy" ? acknowledgePolicy(confirm.item_id) : acknowledgeDocument(confirm.item_id));
          if (!res.error) { notify("Acknowledged. Thank you."); onChanged(); history.reload(); }
          return res;
        }} />
    </div>
  );
}

function PoliciesSection({ onChanged }) {
  const { notify } = useToast();
  const q = useHrQuery(() => listMyPolicies(), []);
  const pending = useHrQuery(() => myPendingAcknowledgements(), []);
  const [reading, setReading] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const isPending = (p) => (pending.data ?? []).some((x) => x.subject_type === "policy" && x.item_id === p.id);
  return (
    <>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <Card><EmptyState icon={FileText} title="No policies" description="Company policies published for you will appear here." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {q.data.map((p) => (
            <Card key={p.id}>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-bold text-[#101a3a]">{p.title}</p>
                  {p.requires_acknowledgement && (isPending(p) ? <Badge tone="amber">acknowledgement pending</Badge> : <Badge tone="green">acknowledged</Badge>)}
                </div>
                <p className="text-xs text-slate-500">Version {p.version?.version ?? p.current_version}{p.version?.effective_date ? ` · effective ${formatDate(p.version.effective_date)}` : ""}</p>
                {p.version?.change_summary && p.version.version > 1 && <p className="text-xs text-slate-600">What changed: {p.version.change_summary}</p>}
                <div className="flex flex-wrap gap-1">
                  {p.version?.content && <Button size="sm" variant="secondary" onClick={() => setReading(p)}><Eye className="h-4 w-4" aria-hidden="true" />Read</Button>}
                  {p.version?.storage_path && <Button size="sm" variant="ghost" onClick={() => openPolicyPdf(p.version, notify)}><FileText className="h-4 w-4" aria-hidden="true" />PDF</Button>}
                  {p.version?.content && <Button size="sm" variant="ghost" onClick={() => downloadPolicyText(p, p.version)}><Download className="h-4 w-4" aria-hidden="true" />Download</Button>}
                  {p.requires_acknowledgement && isPending(p) && <Button size="sm" onClick={() => setConfirm(p)}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Acknowledge</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {reading && (
        <Modal open onClose={() => setReading(null)} title={`${reading.title} · v${reading.version?.version}`} size="lg"
          footer={<><Button variant="secondary" onClick={() => setReading(null)}>Close</Button>{reading.requires_acknowledgement && isPending(reading) && <Button onClick={() => { setConfirm(reading); setReading(null); }}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Acknowledge</Button>}</>}>
          <div className="whitespace-pre-wrap break-words text-sm text-slate-800">{reading.version?.content}</div>
        </Modal>
      )}
      <ConfirmDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} title="Acknowledge policy" confirmLabel="I acknowledge" tone="success"
        message={confirm ? `I confirm that I have received and read "${confirm.title}" (version ${confirm.version?.version ?? confirm.current_version}). This records receipt; it is not a digital signature.` : ""}
        onConfirm={async () => { const res = await acknowledgePolicy(confirm.id); if (!res.error) { notify("Policy acknowledged."); pending.reload(); onChanged(); } return res; }} />
    </>
  );
}

function ExpiringSection({ me }) {
  const { notify } = useToast();
  const exp = useHrQuery(() => searchDocuments({ employee: me, expiry_status: "expiring" }, 1, 100), [me]);
  const expired = useHrQuery(() => searchDocuments({ employee: me, expiry_status: "expired" }, 1, 100), [me]);
  const requests = useHrQuery(() => listOpenRenewalRequests(), []);
  const cats = useHrQuery(() => listDocumentCategories({ activeOnly: true }), []);
  const docs = useHrQuery(() => listEmployeeDocuments(me), [me]);
  const [versionFor, setVersionFor] = useState(null);
  const rows = [...(expired.data ?? []), ...(exp.data ?? [])];
  const canUpload = (r) => (cats.data ?? []).some((c) => c.id === r.category_id && c.employee_can_upload && !c.is_confidential);
  const requestFor = (id) => (requests.data ?? []).find((x) => x.document_id === id);
  const refresh = () => { exp.reload(); expired.reload(); requests.reload(); docs.reload(); };
  return (
    <>
      <p className="mb-3 text-sm text-slate-600">Documents that have expired or expire soon. Upload a renewed copy as a new version — earlier versions are kept, and HR verifies the new one.</p>
      <DataTable caption="Expiring documents" rows={rows} loading={exp.loading || expired.loading} error={exp.error || expired.error} onRetry={refresh}
        emptyTitle="Nothing expiring" emptyDescription="None of your documents expire soon."
        columns={[
          { key: "title", header: "Document", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.title}</p><p className="text-xs text-slate-500">{r.category_name}</p></div> },
          { key: "expiry_date", header: "Expiry", render: (r) => <ExpiryText date={r.expiry_date} /> },
          { key: "verification_status", header: "Status", render: (r) => {
            const rq = requestFor(r.id);
            return <div className="flex flex-col items-start gap-1"><StatusBadge status={r.verification_status} />{rq && <Badge tone="blue">HR requested a renewal{rq.due_date ? ` by ${formatDate(rq.due_date)}` : ""}</Badge>}{rq?.message && <p className="max-w-xs text-xs text-slate-600">“{rq.message}”</p>}</div>;
          } },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
            canUpload(r) ? <Button size="sm" variant="secondary" onClick={() => { const d = (docs.data ?? []).find((x) => x.id === r.id); if (d) setVersionFor(d); else notify("Document not found.", "error"); }}><Upload className="h-4 w-4" aria-hidden="true" />Upload renewed copy</Button>
              : <span className="text-xs text-slate-500">HR will arrange the renewal</span>) },
        ]} />
      {versionFor && <NewVersionModal doc={versionFor} onClose={() => setVersionFor(null)} onDone={refresh} />}
    </>
  );
}

function ProfilePhoto({ employeeId, path }) {
  const { refreshProfile } = useAuth();
  const { notify } = useToast();
  const url = useHrQuery(() => getAvatarUrl(path), [path]);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  return (
    <Card title="Profile photo">
      <div className="flex flex-col items-center gap-3">
        {url.loading ? <Loading /> : url.data ? (
          <img src={url.data} alt="Your profile" className="h-28 w-28 rounded-full object-cover ring-4 ring-orange-100" />
        ) : (
          <span className="flex h-28 w-28 items-center justify-center rounded-full bg-slate-100 text-slate-400"><UserRound className="h-12 w-12" aria-hidden="true" /></span>
        )}
        {url.error && <InlineError message={url.error} />}
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Camera className="h-4 w-4" aria-hidden="true" />{path ? "Change photo" : "Add photo"}</Button>
          {path && <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove</Button>}
        </div>
        <p className="text-center text-xs text-slate-500">PNG, JPEG or WEBP · max 2 MB</p>
      </div>
      {editing && <PhotoModal employeeId={employeeId} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await refreshProfile(); url.reload(); notify("Profile photo updated."); }} />}
      <ConfirmDialog open={removing} onClose={() => setRemoving(false)} title="Remove profile photo" message="Your profile will show initials instead of a photo." confirmLabel="Remove" tone="danger"
        onConfirm={async () => { const res = await removeMyPhoto(); if (!res.error) { await refreshProfile(); notify("Profile photo removed."); } return res; }} />
    </Card>
  );
}

function PhotoModal({ employeeId, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const chk = checkAvatarFile(file);
    if (chk.error) { setFieldError(chk.error); return; }
    setFieldError(null); setBusy(true); setError(null);
    const res = await uploadMyPhoto(employeeId, file);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Profile photo" size="sm" footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={save}>Save photo</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Image" required error={fieldError}><Input type="file" accept={AVATAR_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

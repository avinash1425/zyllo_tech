// Employee Portal — My Documents (Module 9), organised the way an employee
// looks for things:
//   * Employment documents — offer letter, appointment letter, employment
//     agreement and other HR letters, each with issue details, versions and
//     acknowledgement;
//   * Certificates — issued by Zyllo Tech, and the ones I uploaded;
//   * Company documents — published policies addressed to me;
//   * My uploads — required-document checklist, my uploads (status,
//     rejection reason, new version) and the profile photo;
//   * Acknowledgements (documents, policies and, while onboarding is open,
//     onboarding items HR is waiting on) and Expiring (renewals).
// The server (RLS + RPCs) limits everything to my own documents and to
// published policies for my audience; nothing here grants access.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Award, Building2, Camera, CheckCircle2, Download, Eye, FilePlus2, FileSignature, FileText, History, Trash2, Upload, UploadCloud, UserRound,
} from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { myLifecycle } from "@/lib/hr/lifecycle";
import { OnboardingAckCard, pendingOnboardingAcks } from "@/employee/components/OnboardingParts";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import {
  AVATAR_ACCEPT, checkAvatarFile, documentChecklist, formatBytes, getAvatarUrl, latestVersion, listDocumentCategories, listEmployeeDocuments,
  removeMyPhoto, uploadMyPhoto,
} from "@/lib/hr/documents";
import {
  DOC_GROUPS, POLICY_CATEGORIES, acknowledgeDocument, acknowledgePolicy, listMyPolicies, listOpenRenewalRequests, myAcknowledgements, myPendingAcknowledgements,
  searchDocuments,
} from "@/lib/hr/documentCenter";
import { ExpiryText, NewVersionModal, UploadDocumentModal, openLatestOf, openVersion } from "@/hr/pages/DocumentsPage";
import { downloadPolicyText, openPolicyPdf } from "@/hr/pages/documents/PoliciesTab";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, InlineError, Input, KpiCard, Loading, Modal, PageHeader, StatusBadge, Tabs,
  useToast,
} from "@/hr/ui";

// Tab keys are part of notification links (?tab=policies / acknowledgements / expiring).
const TAB_KEYS = ["documents", "certificates", "policies", "uploads", "acknowledgements", "expiring"];

const EMPLOYMENT_SECTIONS = [
  { group: "offer_letter", title: "Offer letter", empty: "Your offer letter appears here once HR files it." },
  { group: "appointment_letter", title: "Appointment letter", empty: "HR issues your appointment letter after you join." },
  { group: "contract", title: "Employment agreement", empty: "Your employment or internship agreement appears here once HR adds it." },
  { group: "letter", title: "Other HR letters", optional: true },
];
const EMPLOYMENT_GROUPS = new Set(EMPLOYMENT_SECTIONS.map((s) => s.group));

const groupOf = (d) => d.category?.doc_group ?? "other";
const isSuperseded = (d) => d.verification_status === "replaced";
const canSelfUpload = (c) => Boolean(c?.employee_can_upload && !c?.is_confidential);
/** A certificate HR issued (generated letter, recruitment filing, or an HR-only category). */
const isIssuedCertificate = (d) => groupOf(d) === "certificate" && (d.source !== "upload" || !d.category?.employee_can_upload);
/** Everything that is not an employment document or an issued certificate. */
const isUploadsDoc = (d) => !EMPLOYMENT_GROUPS.has(groupOf(d)) && !isIssuedCertificate(d);
const labelize = (s) => String(s ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
/** Current documents first, then newest issue / upload first. */
const byCurrency = (a, b) => Number(isSuperseded(a)) - Number(isSuperseded(b))
  || String(b.issue_date ?? b.created_at ?? "").localeCompare(String(a.issue_date ?? a.created_at ?? ""));

export default function MyDocumentsPage() {
  const { hr } = useAuth();
  const { notify } = useToast();
  const me = hr?.employee?.id;
  const [params, setParams] = useSearchParams();
  const [tab, setTabState] = useState(() => (TAB_KEYS.includes(params.get("tab")) ? params.get("tab") : "documents"));
  const setTab = (t) => { setTabState(t); setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true }); };

  const docs = useHrQuery(() => listEmployeeDocuments(me), [me]);
  const checklist = useHrQuery(() => documentChecklist(me), [me]);
  const cats = useHrQuery(() => listDocumentCategories({ activeOnly: true }), []);
  const pending = useHrQuery(() => (me ? myPendingAcknowledgements() : Promise.resolve({ data: [] })), [me]);
  const lifecycle = useHrQuery(() => (me ? myLifecycle() : Promise.resolve({ data: null })), [me]);

  // Modals shared by every section.
  const [uploading, setUploading] = useState(null);   // { category?, groups? }
  const [versionFor, setVersionFor] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [ackFor, setAckFor] = useState(null);
  const [rev, setRev] = useState(0);   // bumps the Expiring tab's own queries
  const refresh = () => { docs.reload(); checklist.reload(); pending.reload(); lifecycle.reload(); setRev((n) => n + 1); };

  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;

  const all = docs.data ?? [];
  const current = all.filter((d) => !isSuperseded(d));
  const employmentCount = current.filter((d) => EMPLOYMENT_GROUPS.has(groupOf(d))).length;
  const certificateCount = current.filter((d) => groupOf(d) === "certificate").length;
  const pendingCount = (pending.data?.length ?? 0) + pendingOnboardingAcks(lifecycle.data).length;
  const missing = (checklist.data ?? []).filter((c) => !c.is_complete && !c.document_id && c.employee_can_upload).length;
  const ackPending = (d) => (pending.data ?? []).some((p) => p.subject_type === "document" && p.item_id === d.id);

  const cardProps = {
    ackPending, ackKnown: Boolean(pending.data),
    onAcknowledge: setAckFor, onHistory: setHistoryFor, onNewVersion: setVersionFor,
  };

  return (
    <>
      <PageHeader title="My Documents" description="Your documents are stored privately. Only you and authorised HR staff can open them." />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Employment documents" value={employmentCount} hint="Offer, appointment, agreement" icon={FileSignature} tone="navy" loading={docs.loading && !docs.data} onClick={() => setTab("documents")} />
        <KpiCard label="Certificates" value={certificateCount} hint="Issued and uploaded" icon={Award} tone="teal" loading={docs.loading && !docs.data} onClick={() => setTab("certificates")} />
        <KpiCard label="To acknowledge" value={pendingCount} hint={pendingCount ? "Read and acknowledge" : "All caught up"} icon={CheckCircle2} tone={pendingCount ? "orange" : "green"} loading={pending.loading && !pending.data} onClick={() => setTab("acknowledgements")} />
        <KpiCard label="Uploads needed" value={missing} hint={missing ? "Required documents missing" : "Checklist complete"} icon={UploadCloud} tone={missing ? "red" : "green"} loading={checklist.loading && !checklist.data} onClick={() => setTab("uploads")} />
      </div>
      <Tabs value={tab} onChange={setTab} label="My documents sections" tabs={[
        { value: "documents", label: "Employment documents" },
        { value: "certificates", label: "Certificates" },
        { value: "policies", label: "Company documents" },
        { value: "uploads", label: "My uploads", count: missing || undefined },
        { value: "acknowledgements", label: "Acknowledgements", count: pendingCount || undefined },
        { value: "expiring", label: "Expiring" },
      ]} />

      {(tab === "documents" || tab === "certificates" || tab === "uploads") && docs.error && !docs.data
        ? <ErrorState message={docs.error} onRetry={docs.reload} />
        : <>
          {tab === "documents" && <EmploymentSection docs={all} loading={docs.loading && !docs.data} cardProps={cardProps} />}
          {tab === "certificates" && <CertificatesSection docs={all} loading={docs.loading && !docs.data} cats={cats.data} cardProps={cardProps}
            onUpload={() => setUploading({ groups: ["certificate"] })} />}
          {tab === "uploads" && <UploadsSection me={me} photoPath={hr?.employee?.photo_path} docs={all} docsQuery={docs} checklist={checklist} cats={cats.data}
            onUpload={setUploading} onNewVersion={setVersionFor} />}
        </>}
      {tab === "policies" && <PoliciesSection pending={pending} />}
      {tab === "acknowledgements" && (
        <div className="flex flex-col gap-4">
          <OnboardingAckCard query={lifecycle} onChanged={lifecycle.reload} />
          <AcknowledgementsSection pending={pending} onChanged={refresh} goPolicies={() => setTab("policies")} />
        </div>
      )}
      {tab === "expiring" && <ExpiringSection me={me} rev={rev} docs={all} cats={cats.data} onNewVersion={setVersionFor} />}

      {uploading && <UploadDocumentModal open mode="self" employeeId={me} categories={cats.data}
        preset={{ category: uploading.category ?? "", ...(uploading.groups ? { groups: uploading.groups } : {}) }}
        onClose={() => setUploading(null)} onDone={refresh} />}
      {versionFor && <NewVersionModal doc={versionFor} onClose={() => setVersionFor(null)} onDone={refresh} />}
      {historyFor && <VersionHistoryModal doc={historyFor} onClose={() => setHistoryFor(null)} />}
      <ConfirmDialog open={Boolean(ackFor)} onClose={() => setAckFor(null)} title="Acknowledge receipt" confirmLabel="I acknowledge" tone="success"
        message={ackFor ? `I confirm that I have received and read "${ackFor.title}" (version ${ackFor.current_version}). This records receipt; it is not a digital signature.` : ""}
        onConfirm={async () => { const res = await acknowledgeDocument(ackFor.id); if (!res.error) { notify("Acknowledged. Thank you."); pending.reload(); } return res; }} />
    </>
  );
}

// ------------------------------------------------------------- document card
function DocumentCard({ doc, ackPending, ackKnown, onAcknowledge, onHistory, onNewVersion }) {
  const { notify } = useToast();
  const latest = latestVersion(doc);
  const superseded = isSuperseded(doc);
  const needsAck = ackPending(doc);
  const meta = [
    doc.issue_date && `Issued ${formatDate(doc.issue_date)}`,
    doc.effective_date && `Effective ${formatDate(doc.effective_date)}`,
    doc.contract_type && labelize(doc.contract_type),
    doc.current_version > 1 && `Version ${doc.current_version}`,
  ].filter(Boolean);
  const showStatus = Boolean(doc.verification_status) && !superseded;
  const canNewVersion = canSelfUpload(doc.category) && !superseded;
  return (
    <li className={`flex flex-col gap-2 rounded-xl border px-3 py-3 ${superseded ? "border-dashed border-slate-200 bg-slate-50/70" : "border-slate-100"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-semibold ${superseded ? "text-slate-500" : "text-[#101a3a]"}`}>{doc.title}</p>
          <p className="text-xs text-slate-500">{doc.category?.name}{meta.length ? ` · ${meta.join(" · ")}` : ` · Added ${formatDate(doc.created_at)}`}</p>
          {doc.expiry_date && <p className="text-xs text-slate-500">Valid until <ExpiryText date={doc.expiry_date} /></p>}
        </div>
        <div className="flex flex-wrap gap-1">
          {superseded && <Badge>superseded</Badge>}
          {!superseded && doc.contract_status && <StatusBadge status={doc.contract_status} />}
          {showStatus && <StatusBadge status={doc.verification_status} />}
          {needsAck ? <Badge tone="amber">acknowledgement pending</Badge>
            : doc.requires_acknowledgement && ackKnown && !superseded && <Badge tone="green">acknowledged</Badge>}
        </div>
      </div>
      {doc.verification_status === "rejected" && doc.rejection_reason && <p className="text-xs text-rose-700">Reason: {doc.rejection_reason}</p>}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" disabled={!latest} onClick={() => openVersion(latest, "view", notify)} aria-label={`View ${doc.title}`}><Eye className="h-4 w-4" aria-hidden="true" />View</Button>
        <Button size="sm" variant="ghost" disabled={!latest} onClick={() => openVersion(latest, "download", notify)} aria-label={`Download ${doc.title}`}><Download className="h-4 w-4" aria-hidden="true" />Download</Button>
        {(doc.versions?.length ?? 0) > 1 && <Button size="sm" variant="ghost" onClick={() => onHistory(doc)}><History className="h-4 w-4" aria-hidden="true" />Versions ({doc.versions.length})</Button>}
        {canNewVersion && <Button size="sm" variant="ghost" onClick={() => onNewVersion(doc)}><FilePlus2 className="h-4 w-4" aria-hidden="true" />New version</Button>}
        {needsAck && <Button size="sm" onClick={() => onAcknowledge(doc)}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Acknowledge</Button>}
      </div>
    </li>
  );
}

function DocumentList({ docs, cardProps }) {
  return <ul className="flex flex-col gap-2">{docs.map((d) => <DocumentCard key={d.id} doc={d} {...cardProps} />)}</ul>;
}

function VersionHistoryModal({ doc, onClose }) {
  const { notify } = useToast();
  const versions = [...(doc.versions ?? [])].sort((a, b) => b.version - a.version);
  return (
    <Modal open onClose={onClose} title={`${doc.title} · versions`} size="md" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <ul className="flex flex-col gap-2">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
            <span className="min-w-0">
              <span className="font-semibold text-[#101a3a]">Version {v.version}</span>
              {v.version === doc.current_version && <Badge tone="green" className="ml-2">current</Badge>}
              <span className="block truncate text-xs text-slate-500">{v.file_name} · {formatBytes(v.size_bytes)} · {formatDateTime(v.uploaded_at)}</span>
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => openVersion(v, "view", notify)} aria-label={`View version ${v.version}`}><Eye className="h-4 w-4" aria-hidden="true" />View</Button>
              <Button size="sm" variant="ghost" onClick={() => openVersion(v, "download", notify)} aria-label={`Download version ${v.version}`}><Download className="h-4 w-4" aria-hidden="true" />Download</Button>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ------------------------------------------------------ employment documents
function EmploymentSection({ docs, loading, cardProps }) {
  if (loading) return <Loading />;
  const sections = EMPLOYMENT_SECTIONS
    .map((s) => ({ ...s, rows: docs.filter((d) => groupOf(d) === s.group).sort(byCurrency) }))
    .filter((s) => !s.optional || s.rows.length);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">Letters and agreements HR has issued to you. Earlier copies are kept as versions; superseded documents stay available for your records.</p>
      {sections.map((s) => (
        <Card key={s.group} title={s.title} actions={s.rows.length > 0 && <Badge>{s.rows.length}</Badge>}>
          {s.rows.length ? <DocumentList docs={s.rows} cardProps={cardProps} /> : <p className="text-sm text-slate-500">{s.empty}</p>}
        </Card>
      ))}
    </div>
  );
}

// -------------------------------------------------------------- certificates
function CertificatesSection({ docs, loading, cats, cardProps, onUpload }) {
  if (loading) return <Loading />;
  const certs = docs.filter((d) => groupOf(d) === "certificate").sort(byCurrency);
  const issued = certs.filter(isIssuedCertificate);
  const mine = certs.filter((d) => !isIssuedCertificate(d));
  const canUpload = (cats ?? []).some((c) => c.doc_group === "certificate" && canSelfUpload(c));
  return (
    <div className="flex flex-col gap-4">
      <Card title="Issued by Zyllo Tech">
        {issued.length ? <DocumentList docs={issued} cardProps={cardProps} />
          : <EmptyState icon={Award} title="No certificates issued yet" description="Experience letters, confirmation letters and internship certificates HR issues to you appear here." />}
      </Card>
      <Card title="Your certificates" actions={canUpload && <Button size="sm" onClick={onUpload}><Upload className="h-4 w-4" aria-hidden="true" />Upload certificate</Button>}>
        {mine.length ? <DocumentList docs={mine} cardProps={cardProps} />
          : <EmptyState icon={Award} title="No certificates uploaded" description={canUpload ? "Upload your education, experience or training certificates. HR verifies each one." : "HR will add your certificates."} />}
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------- uploads
function UploadsSection({ me, photoPath, docs, docsQuery, checklist, cats, onUpload, onNewVersion }) {
  const { notify } = useToast();
  const [group, setGroup] = useState("");
  const [opening, setOpening] = useState(null);
  const selfUpload = (cats ?? []).filter(canSelfUpload);
  const uploads = docs.filter(isUploadsDoc);
  const groupsPresent = DOC_GROUPS.filter((g) => uploads.some((d) => groupOf(d) === g.value));
  const rows = uploads.filter((d) => !group || groupOf(d) === group);

  const columns = [
    { key: "title", header: "Document", render: (r) => <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{r.title}</p><p className="text-xs text-slate-500">{r.category?.name}</p></div> },
    { key: "current_version", header: "Version", render: (r) => (r.current_version ? `v${r.current_version}` : "—") },
    { key: "created_at", header: "Added", render: (r) => formatDate(r.created_at) },
    { key: "expiry_date", header: "Expiry", render: (r) => <ExpiryText date={r.expiry_date} /> },
    { key: "verification_status", header: "Status", render: (r) => (
      <div className="max-w-xs"><StatusBadge status={r.verification_status} />{r.verification_status === "rejected" && r.rejection_reason && <p className="mt-1 text-xs text-rose-700">Reason: {r.rejection_reason}</p>}</div>) },
    { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => {
      const latest = latestVersion(r);
      return (
        <span className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" disabled={!latest} onClick={() => openVersion(latest, "view", notify)} aria-label={`View ${r.title}`}><Eye className="h-4 w-4" aria-hidden="true" />View</Button>
          <Button size="sm" variant="ghost" disabled={!latest} onClick={() => openVersion(latest, "download", notify)} aria-label={`Download ${r.title}`}><Download className="h-4 w-4" aria-hidden="true" />Download</Button>
          {canSelfUpload(r.category) && !isSuperseded(r) && <Button size="sm" variant="secondary" onClick={() => onNewVersion(r)}><FilePlus2 className="h-4 w-4" aria-hidden="true" />{r.verification_status === "rejected" ? "Re-upload" : "New version"}</Button>}
        </span>
      );
    } },
  ];

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Required documents" actions={selfUpload.length > 0 && <Button size="sm" onClick={() => onUpload({})}><Upload className="h-4 w-4" aria-hidden="true" />Upload document</Button>}>
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
                      {!c.is_complete && !c.document_id && c.employee_can_upload && <Button size="sm" variant="secondary" onClick={() => onUpload({ category: c.category_code })}><Upload className="h-4 w-4" aria-hidden="true" />Upload</Button>}
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
      <DataTable caption="My uploaded documents" columns={columns} rows={rows} loading={docsQuery.loading} error={docsQuery.error} onRetry={docsQuery.reload}
        emptyTitle="No uploads yet" emptyDescription={selfUpload.length ? "Upload your identity, education and other documents. HR verifies each one." : "HR will add your documents."} />
    </>
  );
}

// ------------------------------------------------------- acknowledgements
export function AcknowledgementsSection({ pending, onChanged, goPolicies }) {
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

// -------------------------------------------------------- company documents
export function PoliciesSection({ pending }) {
  const { notify } = useToast();
  // The employee handbook is listed first, then policies by title.
  const q = useHrQuery(async () => {
    const res = await listMyPolicies();
    return res.error ? res : { ...res, data: [...res.data].sort((a, b) => Number(b.category === "handbook") - Number(a.category === "handbook")) };
  }, []);
  const [reading, setReading] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const isPending = (p) => (pending.data ?? []).some((x) => x.subject_type === "policy" && x.item_id === p.id);
  return (
    <>
      <p className="mb-3 text-sm text-slate-600">Company policies and handbooks published for you. Some need your acknowledgement after you read them.</p>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <Card><EmptyState icon={Building2} title="No company documents" description="Company policies published for you will appear here." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {q.data.map((p) => (
            <Card key={p.id}>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-bold text-[#101a3a]">{p.title}</p>
                  {p.requires_acknowledgement && (isPending(p) ? <Badge tone="amber">acknowledgement pending</Badge> : <Badge tone="green">acknowledged</Badge>)}
                </div>
                <p className="text-xs text-slate-500">{p.category ? `${POLICY_CATEGORIES.find((c) => c.value === p.category)?.label ?? labelize(p.category)} · ` : ""}Version {p.version?.version ?? p.current_version}{p.version?.effective_date ? ` · effective ${formatDate(p.version.effective_date)}` : ""}</p>
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
        onConfirm={async () => { const res = await acknowledgePolicy(confirm.id); if (!res.error) { notify("Policy acknowledged."); pending.reload(); } return res; }} />
    </>
  );
}

// ---------------------------------------------------------------- expiring
function ExpiringSection({ me, rev, docs, cats, onNewVersion }) {
  const { notify } = useToast();
  const exp = useHrQuery(() => searchDocuments({ employee: me, expiry_status: "expiring" }, 1, 100), [me, rev]);
  const expired = useHrQuery(() => searchDocuments({ employee: me, expiry_status: "expired" }, 1, 100), [me, rev]);
  const requests = useHrQuery(() => listOpenRenewalRequests(), [rev]);
  const rows = [...(expired.data ?? []), ...(exp.data ?? [])];
  const canUpload = (r) => (cats ?? []).some((c) => c.id === r.category_id && canSelfUpload(c));
  const requestFor = (id) => (requests.data ?? []).find((x) => x.document_id === id);
  const refresh = () => { exp.reload(); expired.reload(); requests.reload(); };
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
            canUpload(r) ? <Button size="sm" variant="secondary" onClick={() => { const d = docs.find((x) => x.id === r.id); if (d) onNewVersion(d); else notify("Document not found.", "error"); }}><Upload className="h-4 w-4" aria-hidden="true" />Upload renewed copy</Button>
              : <span className="text-xs text-slate-500">HR will arrange the renewal</span>) },
        ]} />
    </>
  );
}

// ------------------------------------------------------------ profile photo
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

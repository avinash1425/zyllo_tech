// Document verification for joiners. Reuses the secure employee document
// store (hr_documents, private bucket, signed URLs, hr_verify_document) —
// no second file store. HR uploads on someone's behalf stay in Visa & Documents.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Eye, FileWarning } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { documentChecklist, getDocumentUrl, latestVersion, listEmployeeDocuments, verifyDocument } from "@/lib/hr/documents";
import { onboardingDocumentQueue } from "@/lib/hr/lifecycle";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, InlineError, Loading, SearchInput, StatusBadge, Toolbar, useToast } from "@/hr/ui";
import { cx } from "./shared";

function EmployeeDocuments({ row, canVerify, onChanged }) {
  const { notify } = useToast();
  const docs = useHrQuery(() => listEmployeeDocuments(row.employee_id), [row.employee_id]);
  const checklist = useHrQuery(() => documentChecklist(row.employee_id), [row.employee_id]);
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState(null);
  const refresh = () => { docs.reload(); checklist.reload(); onChanged(); };
  async function open(doc) {
    setError(null);
    const res = await getDocumentUrl(latestVersion(doc), "view");
    if (res.error) { setError(res.error); return; }
    window.open(res.data, "_blank", "noopener,noreferrer");
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2" title="Required checklist">
        {checklist.loading && !checklist.data ? <Loading /> : checklist.error ? <ErrorState message={checklist.error} onRetry={checklist.reload} /> : !checklist.data?.length ? (
          <p className="text-sm text-slate-600">No required documents for this employment type.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {checklist.data.map((d) => (
              <li key={d.category_code} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">{d.is_complete ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Circle className="h-4 w-4 text-amber-500" aria-hidden="true" />}{d.category_name}</span>
                <span className="flex items-center gap-1">{d.employee_can_upload ? <Badge>Employee uploads</Badge> : <Badge tone="blue">HR uploads</Badge>}<StatusBadge status={d.verification_status ?? "missing"} /></span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">Employees upload from <span className="font-semibold">My Documents</span> in the Employee Portal; HR is notified of every upload. HR uploads are made in <Link className="font-semibold text-[#1f4693] hover:underline" to="/hr/documents">Visa &amp; Documents</Link>.</p>
      </Card>
      <Card className="lg:col-span-3" title="Uploaded documents">
        <InlineError message={error} />
        {docs.loading && !docs.data ? <Loading /> : docs.error ? <ErrorState message={docs.error} onRetry={docs.reload} /> : !docs.data?.length ? (
          <EmptyState icon={FileWarning} title="Nothing uploaded yet" description="Missing documents are listed in the checklist." />
        ) : (
          <ul className="flex flex-col gap-2">
            {docs.data.map((d) => {
              const v = latestVersion(d);
              const expired = d.expiry_date && d.expiry_date < new Date().toLocaleDateString("en-CA");
              return (
                <li key={d.id} className="rounded-xl border border-slate-100 px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#101a3a]">{d.title}</p>
                      <p className="text-xs text-slate-500">{d.category?.name} · v{d.current_version}{v ? ` · ${formatDateTime(v.uploaded_at)}` : ""}{d.expiry_date ? ` · expires ${formatDate(d.expiry_date)}` : ""}</p>
                      {d.rejection_reason && <p className="mt-1 text-sm text-rose-700">Rejected: {d.rejection_reason}</p>}
                    </div>
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={expired ? "expired" : d.verification_status} />
                      <Button size="sm" variant="ghost" onClick={() => open(d)} aria-label={`View ${d.title}`}><Eye className="h-4 w-4" aria-hidden="true" /></Button>
                      {canVerify && d.verification_status === "pending" && <>
                        <Button size="sm" variant="success" onClick={() => setDialog({ kind: "verify", doc: d })}>Verify</Button>
                        <Button size="sm" variant="danger" onClick={() => setDialog({ kind: "reject", doc: d })}>Reject</Button>
                      </>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <ConfirmDialog open={dialog?.kind === "verify"} onClose={() => setDialog(null)} tone="success" title={`Verify: ${dialog?.doc?.title ?? ""}`}
        message="Confirm you have checked the latest version against the original." confirmLabel="Verify"
        onConfirm={async () => { const res = await verifyDocument(dialog.doc.id, true); if (!res.error) { notify("Document verified."); refresh(); } return res; }} />
      <ConfirmDialog open={dialog?.kind === "reject"} onClose={() => setDialog(null)} tone="danger" title={`Reject: ${dialog?.doc?.title ?? ""}`}
        message="The employee is notified with your reason and can upload a new version." confirmLabel="Reject" requireReason reasonLabel="Reason"
        onConfirm={async (reason) => { const res = await verifyDocument(dialog.doc.id, false, reason); if (!res.error) { notify("Document rejected."); refresh(); } return res; }} />
    </div>
  );
}

export default function DocumentVerificationPage() {
  const { hasPermission } = useAuth();
  const q = useHrQuery(onboardingDocumentQueue, []);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => !s || `${r.employee} ${r.employee_code}`.toLowerCase().includes(s));
  }, [q.data, search]);
  const sel = rows.find((r) => r.employee_id === selected) ?? null;
  return (
    <>
      <Toolbar><SearchInput value={search} onChange={setSearch} placeholder="Search joiners…" /></Toolbar>
      <DataTable caption="Joiners' documents" rows={rows} rowKey="employee_id" loading={q.loading} error={q.error} onRetry={q.reload}
        emptyTitle="No joiners with open onboarding" onRowClick={(r) => setSelected(r.employee_id)}
        columns={[
          { key: "employee", header: "Joiner", render: (r) => <div className={cx("min-w-[10rem]", r.employee_id === selected && "text-[#c24f05]")}><p className="font-semibold">{r.employee}</p><p className="font-mono text-xs text-slate-500">{r.employee_code}</p></div> },
          { key: "joining_date", header: "Joining", sortable: true, render: (r) => formatDate(r.joining_date) },
          { key: "pending", header: "To verify", render: (r) => (r.pending ? <Badge tone="amber">{r.pending}</Badge> : <span className="text-slate-400">0</span>) },
          { key: "rejected", header: "Rejected", render: (r) => (r.rejected ? <Badge tone="red">{r.rejected}</Badge> : <span className="text-slate-400">0</span>) },
          { key: "missing", header: "Missing", render: (r) => (r.missing ? <span className="text-sm text-amber-800">{r.missing}</span> : <Badge tone="green">Complete</Badge>) },
          { key: "expiring", header: "Expiring ≤30d", render: (r) => (r.expiring ? <Badge tone="orange">{r.expiring}</Badge> : <span className="text-slate-400">0</span>) },
        ]} />
      {sel && (
        <div className="mt-5">
          <h3 className="mb-3 text-base font-bold text-[#101a3a]">{sel.employee} <span className="font-mono text-sm text-slate-500">{sel.employee_code}</span></h3>
          <EmployeeDocuments row={sel} canVerify={hasPermission("documents.manage")} onChanged={q.reload} />
        </div>
      )}
      {!sel && rows.length > 0 && <p className="mt-3 text-sm text-slate-500">Select a joiner to review and verify their documents.</p>}
    </>
  );
}

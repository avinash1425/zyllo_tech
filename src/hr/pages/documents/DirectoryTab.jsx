// Employee document directory (server-side filters + paging). The same
// component serves the verification queue, contracts and certificates views.
import { useState } from "react";
import { Download, Eye, Upload } from "lucide-react";
import { formatDate, useHrQuery } from "@/lib/hr/client";
import { getDocument } from "@/lib/hr/documents";
import { groupLabel, searchDocuments } from "@/lib/hr/documentCenter";
import { Badge, Button, Checkbox, DataTable, StatusBadge, useToast } from "@/hr/ui";
import { DocumentDetailModal, ExpiryText, UploadDocumentModal, openLatestOf } from "@/hr/pages/DocumentsPage";
import DocumentFilters, { EMPTY_FILTERS } from "./DocumentFilters";

const PAGE_SIZE = 25;
const MODES = {
  directory: { caption: "Employee documents", hide: [], upload: "Upload document" },
  verification: { caption: "Verification queue", hide: ["status"], upload: null,
    empty: "Nothing is waiting for verification." },
  contracts: { caption: "Employment contracts", hide: ["group"], upload: "Upload contract", groups: ["contract", "attachment"] },
  certificates: { caption: "Certificates", hide: ["group"], upload: "Upload certificate", groups: ["certificate"] },
  letters: { caption: "Issued letters", hide: [], upload: null },
};

export default function DirectoryTab({ employees, categories, canManage, myEmployeeId, preset = {}, mode = "directory" }) {
  const { notify } = useToast();
  const cfg = MODES[mode] ?? MODES.directory;
  const [f, setF] = useState({ ...EMPTY_FILTERS, ...preset });
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState(null);
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);
  const list = useHrQuery(() => searchDocuments(f, page, PAGE_SIZE), [JSON.stringify(f), page]);
  // The view's preset (e.g. group = contract, source = generated) always applies.
  const change = (next) => { setPage(1); setF({ ...next, ...preset }); };

  async function openDetails(row) {
    setOpening(row.id);
    const res = await getDocument(row.id);
    setOpening(null);
    if (res.error || !res.data) { notify(res.error || "Document not found.", "error"); return; }
    setSelected(res.data);
  }

  const columns = [
    { key: "employee", header: "Employee", render: (r) => <div className="min-w-[9rem]"><p className="font-semibold text-[#101a3a]">{r.employee_name}</p><p className="font-mono text-xs text-slate-500">{r.employee_code}{r.department_name ? ` · ${r.department_name}` : ""}</p></div> },
    { key: "title", header: "Document", render: (r) => (
      <div className="min-w-[11rem]">
        <p className="font-medium text-[#101a3a]">{r.title}</p>
        <p className="text-xs text-slate-500">{r.category_name} · {groupLabel(r.doc_group)}</p>
        <span className="mt-1 flex flex-wrap gap-1">
          {r.is_confidential && <Badge tone="red">confidential</Badge>}
          {r.includes_compensation && <Badge tone="violet">compensation</Badge>}
          {r.source !== "upload" && <Badge tone="blue">{r.source === "generated" ? "generated" : "from recruitment"}</Badge>}
          {r.requires_acknowledgement && <Badge tone="slate">ack required</Badge>}
          {r.parent_document_id && <Badge tone="slate">attachment</Badge>}
        </span>
      </div>) },
    { key: "current_version", header: "Ver.", render: (r) => (r.current_version ? `v${r.current_version}` : "—") },
    mode === "contracts"
      ? { key: "contract", header: "Contract", render: (r) => (r.contract_type ? <div className="text-xs"><p className="font-semibold capitalize">{r.contract_type.replace(/_/g, " ")}</p><p>{r.effective_date ? `from ${formatDate(r.effective_date)}` : ""}</p>{r.renewal_date && <p>renew by {formatDate(r.renewal_date)}</p>}{r.contract_status && <StatusBadge status={r.contract_status} />}</div> : "—") }
      : { key: "issue_date", header: "Issued", render: (r) => formatDate(r.issue_date) },
    { key: "expiry_date", header: "Expiry", render: (r) => <ExpiryText date={r.expiry_date} /> },
    { key: "verification_status", header: "Status", render: (r) => (
      <div className="flex flex-col items-start gap-1">
        {r.archived_at ? <Badge>archived</Badge> : <StatusBadge status={r.verification_status} />}
        {!r.file_uploaded && !r.archived_at && <Badge tone="orange">file missing</Badge>}
      </div>) },
    { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
      <span className="flex gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
        <Button size="sm" variant="ghost" disabled={!r.file_uploaded} onClick={() => openLatestOf(r.id, "view", notify)} aria-label={`View ${r.title}`}><Eye className="h-4 w-4" aria-hidden="true" /></Button>
        <Button size="sm" variant="ghost" disabled={!r.file_uploaded} onClick={() => openLatestOf(r.id, "download", notify)} aria-label={`Download ${r.title}`}><Download className="h-4 w-4" aria-hidden="true" /></Button>
        <Button size="sm" variant="secondary" loading={opening === r.id} onClick={() => openDetails(r)}>{canManage ? (mode === "verification" ? "Review" : "Manage") : "Details"}</Button>
      </span>) },
  ];

  return (
    <>
      {mode === "verification" && <p className="mb-3 text-sm text-slate-600">Pending documents (newest first). Open one to verify or reject it with notes; you cannot verify your own documents. HR is notified in-app whenever an employee uploads.</p>}
      <DocumentFilters value={f} onChange={change} employees={employees} categories={cfg.groups ? (categories ?? []).filter((c) => cfg.groups.includes(c.doc_group)) : categories} hide={cfg.hide} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {canManage && <Checkbox label="Archived only" checked={Boolean(f.archived)} onChange={(e) => change({ ...f, archived: e.target.checked })} />}
        {canManage && cfg.upload && <Button className="sm:ml-auto" onClick={() => setUploading(true)}><Upload className="h-4 w-4" aria-hidden="true" />{cfg.upload}</Button>}
      </div>
      <DataTable caption={cfg.caption} columns={columns} rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No documents match" emptyDescription={cfg.empty ?? "Adjust the filters."}
        serverPaging={{ page, pageSize: PAGE_SIZE, total: list.count ?? 0, onPage: setPage }} onRowClick={openDetails} />
      {selected && <DocumentDetailModal doc={selected} canManage={canManage} myEmployeeId={myEmployeeId} onClose={() => setSelected(null)} onChanged={list.reload} />}
      {uploading && <UploadDocumentModal open mode="hr" employeeOptions={employees} categories={categories}
        preset={{ groups: cfg.groups?.filter((g) => g !== "attachment"), title: cfg.upload }} onClose={() => setUploading(false)} onDone={list.reload} />}
    </>
  );
}

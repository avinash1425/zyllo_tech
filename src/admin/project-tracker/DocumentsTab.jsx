import { useCallback, useMemo, useState } from "react";
import { Briefcase, ClipboardList, Download, Eye, FileText, Files, Link2, PackageCheck, Pencil, Plus, Receipt, RotateCcw, Trash2 } from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import EmptyState from "../EmptyState";
import { DOCUMENT_CATEGORIES, deleteDocument, fetchDocuments } from "@/lib/api/admin/projectTrackerProject";
import { ConfirmDialog, Notice } from "./ui";
import { formatDate } from "./styles";
import { dateLabel, formatSize, openDocument, refLabel } from "./docActions";
import { BlockedLink, DocumentFormModal, DocumentViewModal } from "./documentDialogs";

const ICON_BTN = "rounded-lg p-2 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693]";

const SECTION_ICONS = {
  quotation: Receipt,
  invoice: FileText,
  sales_order: Briefcase,
  purchase_order: Files,
  handover: PackageCheck,
  mom: ClipboardList,
  revision: RotateCcw,
  other: FileText,
};

export default function DocumentsTab({ projectId, projectLabel }) {
  const loader = useCallback(() => fetchDocuments(projectId), [projectId]);
  const { data, loading, error, reload } = useAdminData(loader, [projectId]);
  const [editing, setEditing] = useState(null); // null | { category } | doc
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [notice, setNotice] = useState(null);

  const docs = useMemo(() => data ?? [], [data]);
  const nextRefs = useMemo(() => {
    const next = {};
    for (const c of DOCUMENT_CATEGORIES) {
      if (!c.prefix) continue;
      next[c.value] = Math.max(0, ...docs.filter((d) => d.category === c.value).map((d) => d.ref_no ?? 0)) + 1;
    }
    return next;
  }, [docs]);

  async function afterSave(text, tone = "success") {
    setEditing(null);
    setDeleting(null);
    setNotice({ text, tone });
    await reload();
  }

  async function open(doc, download) {
    const { result, url } = await openDocument(doc, { download });
    if (result === "failed") setNotice({ text: "Could not open the file. Please try again.", tone: "warning" });
    if (result === "blocked") setNotice({ tone: "warning", text: <BlockedLink doc={doc} url={url} download={download} /> });
  }

  if (loading) return <AdminLoading />;
  if (error) return <EmptyState bordered icon={FileText} title="Could not load documents" message={error.message} />;

  return (
    <div className="flex flex-col gap-5">
      <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

      <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] shadow-lg">
        {/* Banner */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] px-5 py-3.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/20">
            <FileText className="h-4 w-4 text-white" aria-hidden="true" />
          </span>
          <span className="flex-1 text-sm font-bold text-white">
            Documents
            {docs.length > 0 && <span className="ml-2 font-normal text-white/55">{docs.length}</span>}
          </span>
          <button
            type="button"
            onClick={() => setEditing({ category: "" })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/25"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add document
          </button>
        </div>

        <div className="flex flex-col gap-3 bg-[#f8fafc] p-4">
      {DOCUMENT_CATEGORIES.map((section) => {
        const items = docs.filter((d) => d.category === section.value);
        const SectionIcon = SECTION_ICONS[section.value] ?? FileText;
        const addLabel = section.commercial
          ? `Add ${section.single.toLowerCase()}`
          : `Add${section.prefix ? ` ${section.prefix}-${nextRefs[section.value]}` : ""}`;
        return (
          <section key={section.value} className="overflow-hidden rounded-xl border border-[#e3e9f5] bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[#1a3a7a] bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/20">
                  <SectionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {section.label}
                <span className="ml-1 font-medium text-white/60">({items.length})</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditing({ category: section.value, lock: true })}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white/80 hover:bg-white/20"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {addLabel}
              </button>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-4 text-sm text-[#9aa0ad]">Nothing here yet.</p>
            ) : (
              <ul className="divide-y divide-[#eef0f3]">
                {items.map((d) => {
                  const ref = refLabel(d);
                  return (
                    <li key={d.id} className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-[#f8faff] sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1f4693]/8 text-[#1f4693]">
                          {d.external_url ? <Link2 className="h-4 w-4" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
                        </span>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            {ref && <span className="rounded bg-[#1f4693]/10 px-1.5 py-0.5 font-mono text-xs font-bold text-[#1f4693]">{ref}</span>}
                            <span className="break-words font-semibold text-[#2b303b]">{d.title}</span>
                            {d.doc_type && <span className="rounded-full bg-[#f1f2f5] px-2 py-0.5 text-[11px] text-[#676b7a]">{d.doc_type}</span>}
                          </p>
                          <p className="text-xs text-[#676b7a]">
                            {[
                              d.doc_date && `${dateLabel(d.category)}: ${formatDate(d.doc_date)}`,
                              d.external_url ? "Link" : `${d.file_name} · ${formatSize(d.file_size)}`,
                              `Added ${new Date(d.created_at).toLocaleDateString("en-IN")}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {d.description && <p className="mt-0.5 line-clamp-2 text-xs text-[#676b7a]">{d.description}</p>}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1 pl-12 sm:pl-0">
                        <button type="button" onClick={() => setViewing(d)} aria-label={`View ${ref ?? d.title}`} title="View" className={ICON_BTN}>
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {!d.external_url && (
                          <button type="button" onClick={() => open(d, true)} aria-label={`Download ${ref ?? d.title}`} title="Download" className={ICON_BTN}>
                            <Download className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                        <button type="button" onClick={() => setEditing(d)} aria-label={`Edit ${ref ?? d.title}`} title="Edit" className={ICON_BTN}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(d)}
                          aria-label={`Delete ${ref ?? d.title}`}
                          title="Delete"
                          className="rounded-lg p-2 text-[#676b7a] hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
        </div>
      </div>

      {viewing && (
        <DocumentViewModal
          doc={viewing}
          projectLabel={projectLabel}
          onOpen={open}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
          onClose={() => setViewing(null)}
        />
      )}
      {editing && (
        <DocumentFormModal
          projectId={projectId}
          doc={editing.id ? editing : null}
          defaultCategory={editing.category}
          lockCategory={Boolean(editing.lock)}
          nextRefs={nextRefs}
          onClose={() => setEditing(null)}
          onSaved={afterSave}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete document?"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const result = await deleteDocument(deleting);
            if (result.status === "success") await afterSave("Document deleted.");
            return result;
          }}
        >
          <span className="font-semibold text-[#2b303b]">
            {refLabel(deleting) ? `${refLabel(deleting)} ` : ""}
            {deleting.title}
          </span>
          {deleting.external_url ? " (the link only — the file in Drive is not touched)" : " and its uploaded file"} will be
          deleted permanently.
        </ConfirmDialog>
      )}
    </div>
  );
}

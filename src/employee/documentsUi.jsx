import { useState } from "react";
import { Download, Eye, FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import { docCategoryLabel, documentUrl } from "@/lib/api/employee/documents";
import { fileSize } from "@/lib/api/employee/certificate";
import { formatDateTime } from "./attendanceFormat";
import { Badge, Chips } from "@/components/portal/PortalUI";
import { BTN_DANGER, BTN_SECONDARY, ICON_BTN, ICON_BTN_DANGER } from "@/components/portal/portalStyles";

/** Opens a short-lived link in a new tab, or saves the file. Returns false on failure. */
async function openDocument(doc, download) {
  // Open the tab first (browsers block pop-ups opened after waiting).
  const tab = download ? null : window.open("", "_blank");
  try {
    const url = await documentUrl(doc, { download });
    if (tab) {
      tab.location.href = url;
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    return true;
  } catch {
    tab?.close();
    return false;
  }
}

/**
 * List of employee documents with View / Download (hidden when canDownload is false), optional Delete (employee only),
 * and category filter buttons when there are documents of more than one kind.
 */
export function DocumentList({ docs, onDelete, onError, canDownload = true }) {
  const [filter, setFilter] = useState("all");
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const kinds = [...new Set(docs.map((d) => d.category))];
  const shown = filter === "all" ? docs : docs.filter((d) => d.category === filter);
  const filterItems = [
    { key: "all", label: "All", count: docs.length },
    ...kinds.map((k) => ({ key: k, label: docCategoryLabel(k), count: docs.filter((d) => d.category === k).length })),
  ];

  async function view(doc, download) {
    const ok = await openDocument(doc, download);
    if (!ok) onError?.("Could not open the file. Please try again.");
  }

  async function remove(doc) {
    setBusyId(doc.id);
    await onDelete(doc);
    setBusyId(null);
    setConfirmId(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {kinds.length > 1 && <Chips items={filterItems} value={kinds.includes(filter) ? filter : "all"} onChange={setFilter} label="Filter documents" />}
      <ul className="flex flex-col gap-2">
        {shown.map((d) => {
          const isImage = d.mime_type?.startsWith("image/");
          const Icon = isImage ? ImageIcon : FileText;
          return (
            <li key={d.id} className="rounded-xl bg-[#f8fafd] p-3 ring-1 ring-inset ring-[#eef1f7]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1f4693] to-[#3b6fd1] text-white shadow-[0_6px_14px_-6px_rgba(31,70,147,0.6)]">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#101a3a]">
                      <span className="break-words">{d.title}</span>
                      <Badge tone="blue">{docCategoryLabel(d.category)}</Badge>
                    </p>
                    <p className="truncate text-xs text-[#676b7a]">
                      {d.file_name} · {fileSize(d.file_size)} · uploaded {formatDateTime(d.uploaded_at)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canDownload && (
                    <>
                      <button type="button" onClick={() => view(d, false)} className={BTN_SECONDARY}>
                        <Eye size={14} aria-hidden="true" /> View
                      </button>
                      <button type="button" onClick={() => view(d, true)} className={ICON_BTN} aria-label={`Download ${d.title}`} title="Download">
                        <Download size={15} aria-hidden="true" />
                      </button>
                    </>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      disabled={busyId === d.id}
                      onClick={() => setConfirmId(d.id)}
                      className={ICON_BTN_DANGER}
                      aria-label={`Delete ${d.title}`}
                      title="Delete"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              {confirmId === d.id && (
                <div role="alertdialog" aria-label="Delete document" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <span className="font-semibold">Delete “{d.title}”? The company will no longer see it.</span>
                  <button type="button" disabled={busyId === d.id} onClick={() => remove(d)} className={BTN_DANGER}>
                    {busyId === d.id ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" disabled={busyId === d.id} onClick={() => setConfirmId(null)} className={BTN_SECONDARY}>
                    Cancel
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

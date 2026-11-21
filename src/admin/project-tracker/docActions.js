import { documentCategory, documentFileUrl } from "@/lib/api/admin/projectTrackerProject";

/** "MOM-3", "Rev-2", the document number for quotations / invoices / orders, else null. */
export function refLabel(doc) {
  const section = documentCategory(doc.category);
  if (section?.commercial) return doc.doc_number || null;
  return section?.prefix && doc.ref_no ? `${section.prefix}-${doc.ref_no}` : null;
}

export function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const dateLabel = (category) => documentCategory(category)?.dateLabel ?? "Date";

export const isPdf = (doc) => doc.mime_type === "application/pdf" || /\.pdf$/i.test(doc.file_name ?? "");

/**
 * Opens a document (download = save the file instead of viewing it).
 * Links open as they are. Uploaded files get a 1-minute private link; the tab is
 * opened during the click so pop-up blockers allow it.
 * Returns { result: "opened" } | { result: "blocked", url } | { result: "failed" }.
 * Never navigates away from the tracker.
 */
export async function openDocument(doc, { download = false } = {}) {
  if (doc.external_url) {
    const win = window.open(doc.external_url, "_blank", "noopener,noreferrer");
    return win === null ? { result: "blocked", url: doc.external_url } : { result: "opened" };
  }
  if (download) {
    // Fetch the file through its 1-minute private link and save it under its own
    // name: always a download, the page stays where it is, no extra tab.
    const url = await documentFileUrl(doc, { download: true });
    if (!url) return { result: "failed" };
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = doc.file_name || "document";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
      return { result: "opened" };
    } catch (e) {
      console.error("Download failed:", e?.message || e);
      return { result: "failed" };
    }
  }
  const win = window.open("about:blank", "_blank");
  const url = await documentFileUrl(doc, { download });
  if (!url) {
    win?.close();
    return { result: "failed" };
  }
  if (!win) return { result: "blocked", url };
  win.opener = null;
  win.location.href = url;
  return { result: "opened" };
}

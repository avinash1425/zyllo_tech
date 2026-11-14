import { useCallback, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FilePlus2, History, ImageIcon, Upload, X } from "lucide-react";
import RecordSection from "../RecordSection";
import HandoverPanel from "./HandoverPanel";
import { Badge, Banner, Button, DataTable, Modal, Select, Spinner, TextArea, TextInput, useToast } from "../ui";
import { useProject, useRole } from "../context";
import useLoad from "../useLoad";
import { createLinkDocument, getDocumentUrl, listDocumentVersions, uploadDocumentWithProgress } from "@/lib/api/admin/projectTracker";
import { CLASSIFICATION, DOCUMENT_CATEGORY } from "../lib/options";
import { ALLOWED_EXTENSIONS, checkUpload, fileExtension, isUrl, looksLikeSecret } from "../lib/validation";
import { formatBytes, formatDateTime } from "../lib/format";

const PREVIEW_IMAGE = ["png", "jpg", "jpeg", "webp"];
const PREVIEW_TEXT = ["txt", "csv", "md"];
const ACCEPT = ALLOWED_EXTENSIONS.map((x) => `.${x}`).join(",");
const nameOf = (f) => f.name.replace(/\.[^.]+$/, "").slice(0, 200);

/**
 * Upload one or more files (drag & drop or browse), or add an access-controlled link.
 * `supersedes` = the current version being replaced (single file, metadata prefilled).
 */
function UploadModal({ onClose, onDone, supersedes }) {
  const { project, refs } = useProject();
  const { isManager, settings } = useRole();
  const toast = useToast();
  const maxMb = settings?.max_document_mb || 50;
  const [mode, setMode] = useState("file");
  const [items, setItems] = useState([]); // { file, name, error, progress, done }
  const [dragOver, setDragOver] = useState(false);
  const [v, setV] = useState({
    category: supersedes?.category || "other", version: "", classification: supersedes?.classification || "internal",
    task_id: supersedes?.task_id || "", description: "", remarks: "", external_url: "", name: supersedes?.name || "",
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const classOptions = isManager ? CLASSIFICATION : CLASSIFICATION.filter((c) => c.value !== "restricted");

  function addFiles(list) {
    const files = [...list];
    if (supersedes && files.length > 1) { setError("Choose one file for a new version."); return; }
    setError("");
    setItems((prev) => {
      const next = supersedes ? [] : [...prev];
      for (const f of files) next.push({ file: f, name: supersedes ? supersedes.name : nameOf(f), error: checkUpload(f, maxMb), progress: 0, done: false });
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    for (const k of ["remarks", "version", "description"]) if (looksLikeSecret(v[k])) errs[k] = "This looks like a secret. Remove it.";
    if (mode === "link") {
      if (!isUrl(v.external_url.trim())) errs.external_url = "Enter a full https:// link.";
      if (!v.name.trim()) errs.name = "Document name is required.";
    } else {
      if (items.length === 0) errs.file = "Choose at least one file.";
      if (items.some((it) => it.error)) errs.file = "Remove the files that cannot be uploaded.";
      if (items.some((it) => !it.name.trim())) errs.file = "Every file needs a document name.";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const meta = {
      category: v.category, version: v.version, classification: v.classification, task_id: v.task_id || null,
      description: v.description, remarks: v.remarks, supersedes_id: supersedes?.id || null,
    };
    setBusy(true);
    setError("");
    try {
      if (mode === "link") {
        await createLinkDocument(project.id, { ...meta, name: v.name.trim(), external_url: v.external_url.trim() });
        toast.push(supersedes ? "New version added." : "Document link added.");
      } else {
        for (let i = 0; i < items.length; i++) {
          if (items[i].done) continue;
          await uploadDocumentWithProgress(project.id, items[i].file, { ...meta, name: items[i].name.trim() },
            (p) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, progress: p } : x))), { maxMb });
          setItems((prev) => prev.map((x, j) => (j === i ? { ...x, done: true, progress: 100 } : x)));
        }
        toast.push(supersedes ? "New version uploaded." : items.length > 1 ? `${items.length} documents uploaded.` : "Document uploaded.");
      }
      await onDone();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={supersedes ? `New version — ${supersedes.name}` : "Add documents"} onClose={onClose} busy={busy} size="lg">
      <form onSubmit={submit} noValidate className="space-y-4">
        {supersedes && <Banner tone="info">The current version ({supersedes.version || "no version"}) stays in the history; the new file becomes current.</Banner>}
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">Document source</legend>
          <label className="flex items-center gap-2"><input type="radio" name="pt-doc-mode" checked={mode === "file"} onChange={() => setMode("file")} className="accent-[#1f4693]" />Upload files (private)</label>
          <label className="flex items-center gap-2"><input type="radio" name="pt-doc-mode" checked={mode === "link"} onChange={() => setMode("link")} className="accent-[#1f4693]" />External link (e.g. large training recording)</label>
        </fieldset>
        {mode === "file" ? (
          <div>
            <div data-pt-dropzone="" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm ${dragOver ? "border-[#1f4693] bg-[#1f4693]/5" : "border-[#d9dce3] bg-[#fafbfc]"}`}>
              <Upload className="h-6 w-6 text-[#1f4693]" aria-hidden="true" />
              <p className="text-[#2b303b]">Drag and drop {supersedes ? "the new file" : "files"} here, or</p>
              <label htmlFor="pt-doc-file" className="cursor-pointer rounded-lg bg-[#1f4693] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#183a7a] focus-within:outline focus-within:outline-2">
                Browse…
                <input ref={inputRef} id="pt-doc-file" type="file" multiple={!supersedes} accept={ACCEPT} className="sr-only"
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </label>
              <p className="text-xs text-[#676b7a]">PDF, Word, Excel, PowerPoint, images, text (and csv, md, zip, mp4, webm, mp3). Max {maxMb} MB each. Stored privately; opened only through 60-second links.</p>
            </div>
            {errors.file && <p className="mt-1 text-xs font-medium text-red-600">{errors.file}</p>}
            {items.length > 0 && (
              <ul className="mt-3 space-y-2">
                {items.map((it, i) => (
                  <li key={`${it.file.name}-${i}`} className="rounded-lg border border-[#eef0f4] p-2">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[12rem] flex-1">
                        <TextInput label={i === 0 ? "Document name" : `Document name (file ${i + 1})`} required value={it.name} maxLength={200}
                          onChange={(x) => setItems((prev) => prev.map((y, j) => (j === i ? { ...y, name: x } : y)))} />
                      </div>
                      <span className="pb-2 text-xs text-[#676b7a]">{it.file.name} · {formatBytes(it.file.size)}</span>
                      {!busy && !supersedes && (
                        <button type="button" aria-label={`Remove ${it.file.name}`} onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                          className="mb-1 rounded p-1.5 text-[#676b7a] hover:bg-[#f1f3f7]"><X className="h-4 w-4" aria-hidden="true" /></button>
                      )}
                    </div>
                    {it.error ? <p className="mt-1 text-xs font-medium text-red-600">{it.error}</p> : (busy || it.done) && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eef0f4]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={it.progress} aria-label={`Upload progress ${it.file.name}`}>
                        <div className="h-full rounded-full bg-[#1f4693] transition-all" style={{ width: `${it.progress}%` }} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput full type="url" label="External link" required value={v.external_url} onChange={(x) => setV({ ...v, external_url: x })} error={errors.external_url}
              help="Make sure the link itself is access-controlled (not public)." />
            <TextInput label="Document name" required value={v.name} onChange={(x) => setV({ ...v, name: x })} error={errors.name} maxLength={200} />
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Document category" required allowEmpty={false} value={v.category} onChange={(x) => setV({ ...v, category: x })} options={DOCUMENT_CATEGORY} />
          <TextInput label="Version" value={v.version} onChange={(x) => setV({ ...v, version: x })} maxLength={50} error={errors.version} placeholder={supersedes ? "e.g. 2.0" : "e.g. 1.0"} />
          <Select label="Visibility / access classification" required allowEmpty={false} value={v.classification} onChange={(x) => setV({ ...v, classification: x })}
            options={classOptions} help={isManager ? "Restricted documents are visible to managers only." : undefined} />
          <Select label="Attach to task (optional)" value={v.task_id} onChange={(x) => setV({ ...v, task_id: x })}
            options={(refs.tasks || []).map((t) => ({ value: t.id, label: `${t.task_code} ${t.title}` }))} placeholder="— None —" />
          <TextArea full label="Description" value={v.description} onChange={(x) => setV({ ...v, description: x })} maxLength={2000} error={errors.description} />
          <TextArea full label="Remarks" value={v.remarks} onChange={(x) => setV({ ...v, remarks: x })} maxLength={5000} error={errors.remarks} />
        </div>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex justify-end gap-2 border-t border-[#eef0f4] pt-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" icon={Upload} busy={busy}>
            {mode === "link" ? "Add link" : items.length > 1 ? `Upload ${items.length} files` : "Upload"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({ doc, onClose, onOpen }) {
  const { data, error } = useLoad(() => listDocumentVersions(doc.version_group_id || doc.id), [doc.version_group_id || doc.id]);
  const columns = [
    { key: "version", label: "Version", sortable: false, render: (r) => r.version || "—" },
    { key: "name", label: "Name", sortable: false, render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "created_at", label: "Uploaded", sortable: false, render: (r) => <span className="text-xs">{formatDateTime(r.created_at)}{r.created_by_email ? ` · ${r.created_by_email}` : ""}</span> },
    { key: "is_current", label: "State", sortable: false, render: (r) => (r.archived_at ? <Badge value="archived" tone="neutral" label="Archived" /> : r.is_current ? <Badge value="active" label="Current" /> : <Badge value="neutral" tone="neutral" label="Previous" />) },
    { key: "_a", label: <span className="sr-only">Actions</span>, sortable: false, className: "text-right", render: (r) => (
      <Button size="sm" variant="ghost" icon={r.external_url ? ExternalLink : Download} onClick={() => onOpen(r, !r.external_url)}>{r.external_url ? "Open" : "Download"}</Button>) },
  ];
  return (
    <Modal title={`Version history — ${doc.name}`} onClose={onClose} size="lg" footer={<Button onClick={onClose}>Close</Button>}>
      {error && <Banner tone="danger">{error.message}</Banner>}
      {!data ? <Spinner /> : <DataTable caption="Version history" columns={columns} rows={data} empty="No versions." />}
    </Modal>
  );
}

function PreviewModal({ doc, onClose }) {
  const ext = fileExtension(doc.file_name || doc.storage_path || "");
  const { data, error } = useLoad(async () => {
    const url = await getDocumentUrl(doc, { action: "previewed" });
    if (PREVIEW_IMAGE.includes(ext)) return { url };
    const res = await fetch(url);
    const text = await res.text();
    return { text: text.slice(0, 200000), truncated: text.length > 200000 };
  }, [doc.id]);
  return (
    <Modal title={`Preview — ${doc.name}`} onClose={onClose} size="lg" footer={<Button onClick={onClose}>Close</Button>}>
      {error ? <Banner tone="danger">{error.message}</Banner> : !data ? <Spinner /> : data.url ? (
        <img src={data.url} alt={doc.name} className="mx-auto max-h-[70vh] max-w-full rounded-lg border border-[#eef0f4]" />
      ) : (
        <>
          <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#f8f9fb] p-3 text-xs text-[#2b303b]">{data.text}</pre>
          {data.truncated && <p className="mt-2 text-xs text-[#676b7a]">Showing the first 200,000 characters.</p>}
        </>
      )}
    </Modal>
  );
}

export default function DocumentsTab() {
  const { readOnly, reloadRefs } = useProject();
  const { canEdit, isManager } = useRole();
  const toast = useToast();
  const [uploading, setUploading] = useState(null); // null | "new" | doc (new version)
  const [history, setHistory] = useState(null);
  const [preview, setPreview] = useState(null);
  const [allVersions, setAllVersions] = useState(false);
  const [version, setVersion] = useState(0);
  const [opening, setOpening] = useState(null);
  const done = useCallback(async () => { setVersion((n) => n + 1); await reloadRefs(); }, [reloadRefs]);

  // Non-managers cannot set "restricted" when editing metadata.
  const fieldsOverride = useMemo(() => (isManager ? null : (fields) => fields.map((f) => (
    f.name === "classification" ? { ...f, options: CLASSIFICATION.filter((c) => c.value !== "restricted") } : f
  ))), [isManager]);
  const columnsOverride = useCallback((cols) => cols.map((c) => (c.key !== "version" ? c : {
    ...c, render: (r) => <span className="whitespace-nowrap">{r.version || "—"}{r.is_current === false && <Badge value="neutral" tone="neutral" label="Previous" className="ml-1" />}</span>,
  })), []);
  const rowFilter = useMemo(() => (allVersions ? null : (r) => r.is_current !== false), [allVersions]);

  // The tab is opened synchronously (inside the click) so pop-up blockers allow
  // it; the access is logged and the 60-second signed URL created afterwards.
  async function open(doc, download) {
    setOpening(doc.id);
    const win = download ? null : window.open("about:blank", "_blank");
    if (win) win.opener = null;
    try {
      const url = await getDocumentUrl(doc, { download });
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else if (win) {
        win.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (e) {
      if (win) win.close();
      toast.push(e.message, "danger");
    } finally {
      setOpening(null);
    }
  }

  const canPreview = (r) => !r.external_url && [...PREVIEW_IMAGE, ...PREVIEW_TEXT].includes(fileExtension(r.file_name || r.storage_path || ""));
  const writable = canEdit && !readOnly;

  return (
    <div className="space-y-5">
      <RecordSection
        key={`docs-${version}`}
        sectionKey="documents"
        hideAdd
        fieldsOverride={fieldsOverride || undefined}
        columnsOverride={columnsOverride}
        rowFilter={rowFilter}
        description="Files are stored in a private bucket, checked on the server (type and size from the stored file), and opened only through signed links that expire after 60 seconds. Every open, download and preview is logged. Files are never deleted — upload a new version or archive a document to retire it."
        toolbar={<>
          <label className="flex items-center gap-2 text-xs font-medium text-[#676b7a]">
            <input type="checkbox" className="accent-[#1f4693]" checked={allVersions} onChange={(e) => setAllVersions(e.target.checked)} />Show previous versions
          </label>
          {writable && <Button size="sm" variant="primary" icon={Upload} onClick={() => setUploading("new")}>Upload / link</Button>}
        </>}
        onChanged={done}
        rowActions={(r) => [
          { key: "open", label: opening === r.id ? "Opening…" : r.external_url ? "Open link" : "Open", icon: ExternalLink, onClick: () => open(r, false) },
          { key: "dl", label: "Download", icon: Download, hidden: !!r.external_url, onClick: () => open(r, true) },
          { key: "preview", label: "Preview", icon: ImageIcon, hidden: !canPreview(r), onClick: () => setPreview(r) },
          { key: "newver", label: "New version", icon: FilePlus2, hidden: !writable || !!r.archived_at || r.is_current === false, onClick: () => setUploading(r) },
          { key: "history", label: "History", icon: History, onClick: () => setHistory(r) },
        ]}
      />
      <HandoverPanel docsVersion={version} />
      {uploading && <UploadModal supersedes={uploading === "new" ? null : uploading} onClose={() => setUploading(null)} onDone={done} />}
      {history && <HistoryModal doc={history} onClose={() => setHistory(null)} onOpen={open} />}
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
      <p className="text-xs text-[#8a8f9c]">Office documents are not previewed in the browser (download them instead). No malware scanner is connected; files are never executed by Project Tracker. Showing {allVersions ? "all versions" : "current versions only"}.</p>
    </div>
  );
}

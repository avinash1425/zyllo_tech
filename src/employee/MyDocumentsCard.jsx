import { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, Upload, X } from "lucide-react";
import {
  checkDocumentFile,
  deleteMyDocument,
  DOC_ACCEPT,
  DOC_LIMIT,
  listMyDocuments,
  UPLOAD_CATEGORIES,
  uploadMyDocument,
} from "@/lib/api/employee/documents";
import { fileSize } from "@/lib/api/employee/certificate";
import { Alert, Badge, Chips, Empty, Panel } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/components/portal/portalStyles";
import { DocumentList } from "./documentsUi";

/** Upload form: kind of document (buttons, no dropdown), optional name, file. */
function UploadForm({ onDone, onCancel }) {
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const problem = checkDocumentFile(f);
    if (problem) {
      setFile(null);
      return setError(problem);
    }
    setError("");
    setFile(f);
  }

  async function submit(e) {
    e.preventDefault();
    if (!category) return setError("Choose what kind of document this is.");
    if (!file) return setError("Choose a file to upload.");
    setBusy(true);
    setError("");
    let r;
    try {
      r = await uploadMyDocument({ file, category, title });
    } catch {
      r = { ok: false, message: "Could not upload the file. Please try again." };
    }
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onDone(title.trim() || file.name);
  }

  return (
    <form onSubmit={submit} className="mb-4 flex flex-col gap-4 rounded-xl border border-[#dce6f7] bg-[#fafbff] p-4">
      <div>
        <span className={LABEL}>Kind of document *</span>
        <Chips items={UPLOAD_CATEGORIES} value={category} onChange={setCategory} label="Kind of document" />
      </div>
      <div>
        <label htmlFor="doc-title" className={LABEL}>
          Document name <span className="font-normal normal-case tracking-normal text-[#9aa0ad]">(optional, e.g. “Aadhaar card”, “B.Tech degree”)</span>
        </label>
        <input id="doc-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={INPUT(false)} placeholder="Uses the file name if left empty" />
      </div>
      <div className="flex flex-col items-start gap-3 rounded-xl border-2 border-dashed border-[#dce6f7] bg-white p-4 sm:flex-row sm:items-center">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/10 text-[#1f4693]">
          <Upload size={18} aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 text-sm text-[#676b7a]">
          {file ? (
            <>
              <span className="block truncate font-semibold text-[#2b303b]">{file.name}</span>
              {fileSize(file.size)}
            </>
          ) : (
            <>
              <span className="block font-semibold text-[#2b303b]">No file chosen</span>
              PDF, PNG, JPG or WEBP, up to 10 MB.
            </>
          )}
        </p>
        <button type="button" onClick={() => input.current?.click()} className={BTN_SECONDARY}>
          {file ? "Change file" : "Choose file"}
        </button>
        <input ref={input} type="file" accept={DOC_ACCEPT} onChange={pick} className="hidden" aria-hidden="true" tabIndex={-1} />
      </div>
      {error && <Alert kind="err">{error}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className={BTN_SECONDARY}>
          <X size={14} aria-hidden="true" /> Cancel
        </button>
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
          <Upload size={14} aria-hidden="true" /> {busy ? "Uploading…" : "Upload document"}
        </button>
      </div>
    </form>
  );
}

/** My Profile: documents the employee uploads (certificates, ID proofs, …). Migration 251. */
export default function MyDocumentsCard() {
  const [docs, setDocs] = useState(undefined); // undefined = loading
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });

  useEffect(() => {
    let active = true;
    listMyDocuments()
      .then((d) => active && setDocs(d))
      .catch(() => active && setDocs(null));
    return () => {
      active = false;
    };
  }, [reload]);

  const full = (docs?.length ?? 0) >= DOC_LIMIT;

  async function onDelete(doc) {
    const r = await deleteMyDocument(doc.id);
    setMsg(r.ok ? { kind: "ok", text: `“${doc.title}” deleted.` } : { kind: "err", text: r.message });
    setReload((n) => n + 1);
  }

  return (
    <Panel
      icon={FolderOpen}
      title="My documents"
      subtitle="Certificates, ID proofs and other documents — visible to you and the company admin"
      action={
        <div className="flex items-center gap-2">
          {docs?.length > 0 && <Badge tone="blue">{docs.length}</Badge>}
          {!adding && docs && (
            <button
              type="button"
              disabled={full}
              title={full ? `You can keep up to ${DOC_LIMIT} documents` : undefined}
              onClick={() => {
                setAdding(true);
                setMsg({ kind: "", text: "" });
              }}
              className={BTN_PRIMARY}
            >
              <Plus size={14} aria-hidden="true" /> Add document
            </button>
          )}
        </div>
      }
    >
      {msg.text && (
        <Alert kind={msg.kind === "ok" ? "ok" : "err"} className="mb-4">
          {msg.text}
        </Alert>
      )}
      {adding && (
        <UploadForm
          onCancel={() => setAdding(false)}
          onDone={(name) => {
            setAdding(false);
            setMsg({ kind: "ok", text: `“${name}” uploaded.` });
            setReload((n) => n + 1);
          }}
        />
      )}
      {docs === undefined ? (
        <p role="status" className="text-sm text-[#676b7a]">
          Loading…
        </p>
      ) : docs === null ? (
        <Alert kind="err">Could not load your documents. Please refresh the page.</Alert>
      ) : docs.length === 0 ? (
        !adding && (
          <Empty
            icon={FolderOpen}
            title="No documents yet"
            message="Upload your education certificates, ID proof and other documents here."
            className="py-6"
          />
        )
      ) : (
        <DocumentList docs={docs} onDelete={onDelete} onError={(text) => setMsg({ kind: "err", text })} />
      )}
    </Panel>
  );
}

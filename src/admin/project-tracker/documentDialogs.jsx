import { useRef, useState } from "react";
import { Download, ExternalLink, FileText, Link2, Pencil, UploadCloud } from "lucide-react";
import {
  DOCUMENT_CATEGORIES,
  DOC_ACCEPT,
  checkDocumentFile,
  createDocument,
  documentCategory,
  updateDocument,
} from "@/lib/api/admin/projectTrackerProject";
import { ChoiceChips, Field, FormMessage, Modal } from "./ui";
import { BTN_PRIMARY, BTN_SECONDARY, formatDate, inputClass } from "./styles";
import { dateLabel, formatSize, isPdf, refLabel } from "./docActions";

const sectionOf = documentCategory;

// Document dialogs shared by the project's Documents tab and the dashboard.

/**
 * Add or edit a document. `lockCategory` hides the section picker (e.g. "Add invoice"
 * from the dashboard). `nextRefs` previews the next MOM / Rev number.
 */
export function DocumentFormModal({ projectId, doc, defaultCategory, lockCategory, nextRefs = {}, onClose, onSaved }) {
  const editing = Boolean(doc?.id);
  const [mode, setMode] = useState(doc ? (doc.external_url ? "link" : "file") : "file");
  const [form, setForm] = useState(() => ({
    category: doc?.category ?? defaultCategory ?? "handover",
    doc_type: doc?.doc_type ?? "",
    doc_number: doc?.doc_number ?? "",
    title: doc?.title ?? "",
    doc_date: doc?.doc_date ?? "",
    description: doc?.description ?? "",
    external_url: doc?.external_url ?? "",
  }));
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const set = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  function pickFile(f) {
    if (!f) return;
    const problem = checkDocumentFile(f);
    setErrors((e) => ({ ...e, file: problem || undefined }));
    if (problem) return;
    setFile(f);
    if (!form.title && !sectionOf(form.category)?.commercial) set("title", f.name.replace(/\.[^.]+$/, ""));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const result = editing ? await updateDocument(doc, form) : await createDocument(projectId, form, { mode, file });
    setSaving(false);
    if (result.status === "success") return onSaved(editing ? "Document updated." : "Document added.");
    setErrors(result.errors ?? {});
    setMessage(result.message);
  }

  const section = sectionOf(form.category);
  const commercial = Boolean(section?.commercial);
  const numbered = Boolean(section?.prefix);
  const sameSection = editing && form.category === doc.category;
  const refPreview = numbered
    ? sameSection && doc.ref_no
      ? `${section.prefix}-${doc.ref_no}`
      : `${section.prefix}-${nextRefs[form.category] ?? 1}`
    : null;

  return (
    <Modal
      title={`${editing ? "Edit" : "Add"} ${lockCategory && section?.single ? section.single.toLowerCase() : "document"}`}
      titleId="pt-doc-dialog-title"
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {lockCategory ? (
          <p className="text-sm text-[#676b7a] sm:col-span-2">
            Section: <span className="font-semibold text-[#2b303b]">{section?.label}</span>
          </p>
        ) : (
          <div className="sm:col-span-2">
            <ChoiceChips
              id="pt-doc-category"
              label={form.category ? "Section" : "Section — choose one"}
              size="sm"
              value={form.category}
              onChange={(v) => set("category", v)}
              options={DOCUMENT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              error={errors.category}
            />
          </div>
        )}
        {commercial && (
          <Field id="pt-doc-number" label={section.numberLabel} required error={errors.doc_number}>
            <input
              id="pt-doc-number"
              value={form.doc_number}
              autoFocus
              onChange={(e) => set("doc_number", e.target.value)}
              placeholder="e.g. INV-2026-001"
              maxLength={60}
              aria-invalid={errors.doc_number ? "true" : undefined}
              aria-describedby={errors.doc_number ? "pt-doc-number-error" : undefined}
              className={`${inputClass(errors.doc_number)} font-mono`}
            />
          </Field>
        )}
        <Field id="pt-doc-type" label="Type" error={errors.doc_type}>
          <input
            id="pt-doc-type"
            value={form.doc_type}
            onChange={(e) => set("doc_type", e.target.value)}
            placeholder={section ? `e.g. ${section.types.slice(0, 2).join(", ")}` : "Choose a section first"}
            className={inputClass(errors.doc_type)}
          />
        </Field>

        {numbered && (
          <p className="rounded-lg bg-[#f6f7fb] px-3.5 py-2.5 text-xs text-[#676b7a] sm:col-span-2">
            Number: <span className="font-mono font-semibold text-[#1f4693]">{refPreview}</span>
            {!sameSection && " — assigned automatically when you save."}
          </p>
        )}

        <Field id="pt-doc-title" label={commercial ? "Title (optional)" : "Title"} required={!commercial} error={errors.title} className="sm:col-span-2">
          <input
            id="pt-doc-title"
            value={form.title}
            autoFocus={!commercial}
            onChange={(e) => set("title", e.target.value)}
            placeholder={
              commercial
                ? `Leave empty to use "${section.single} ${form.doc_number || "<number>"}"`
                : form.category === "mom"
                  ? "e.g. Requirement discussion with client"
                  : "e.g. Admin user manual v1"
            }
            aria-invalid={errors.title ? "true" : undefined}
            className={inputClass(errors.title)}
          />
        </Field>
        <Field id="pt-doc-date" label={dateLabel(form.category)} error={errors.doc_date}>
          <input id="pt-doc-date" type="date" value={form.doc_date} onChange={(e) => set("doc_date", e.target.value)} className={inputClass(errors.doc_date)} />
        </Field>
        <div className="hidden sm:block" />

        {!editing && (
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs font-semibold text-[#2b303b]">File</p>
            <div className="mb-3 inline-flex rounded-lg border border-[#e7e9ee] p-0.5" role="radiogroup" aria-label="Upload a file or save a link">
              {[
                { v: "file", label: "Upload a file", icon: UploadCloud },
                { v: "link", label: "Save a link", icon: Link2 },
              ].map(({ v, label, icon: Icon }) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={mode === v}
                  onClick={() => setMode(v)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                    mode === v ? "bg-[#f7941e] text-white" : "text-[#676b7a] hover:text-[#2b303b]"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            {mode === "file" ? (
              <>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    pickFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center ${
                    dragging ? "border-[#f7941e] bg-[#f7941e]/5" : errors.file ? "border-red-300" : "border-[#d9dce3]"
                  }`}
                >
                  <UploadCloud className="h-7 w-7 text-[#9aa0ad]" aria-hidden="true" />
                  {file ? (
                    <p className="text-sm text-[#2b303b]">
                      <span className="font-semibold">{file.name}</span> · {formatSize(file.size)}
                    </p>
                  ) : (
                    <p className="text-sm text-[#676b7a]">Drag a file here, or</p>
                  )}
                  <button type="button" onClick={() => fileRef.current?.click()} className={BTN_SECONDARY}>
                    {file ? "Choose another file" : "Choose file"}
                  </button>
                  <p className="text-xs text-[#9aa0ad]">PDF, Word, Excel, PowerPoint, text, CSV or images · up to 25 MB</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={DOC_ACCEPT}
                    className="hidden"
                    aria-label="Document file"
                    onChange={(e) => {
                      pickFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
                {errors.file && <p className="mt-1 text-xs text-red-600">{errors.file}</p>}
              </>
            ) : (
              <Field id="pt-doc-url" label="Link" error={errors.external_url}>
                <input
                  id="pt-doc-url"
                  type="url"
                  value={form.external_url}
                  onChange={(e) => set("external_url", e.target.value)}
                  placeholder="https://drive.google.com/…"
                  className={inputClass(errors.external_url)}
                />
              </Field>
            )}
          </div>
        )}
        {editing && doc.external_url && (
          <Field id="pt-doc-url" label="Link" error={errors.external_url} className="sm:col-span-2">
            <input id="pt-doc-url" type="url" value={form.external_url} onChange={(e) => set("external_url", e.target.value)} className={inputClass(errors.external_url)} />
          </Field>
        )}
        {editing && !doc.external_url && (
          <p className="text-xs text-[#676b7a] sm:col-span-2">
            File: <span className="font-semibold text-[#2b303b]">{doc.file_name}</span>. To replace the file, add the new
            version as a new document.
          </p>
        )}

        <Field id="pt-doc-description" label="Description" error={errors.description} className="sm:col-span-2">
          <textarea
            id="pt-doc-description"
            rows={2}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder={form.category === "mom" ? "Key decisions and action points" : ""}
            className={`${inputClass(errors.description)} resize-none`}
          />
        </Field>

        <FormMessage message={message} />
        <div className="flex justify-end gap-3 sm:col-span-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? (mode === "file" && !editing ? "Uploading…" : "Saving…") : editing ? "Save changes" : "Add document"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * View one document: its details plus Open and Download.
 * `onOpen(doc, download)` does the opening (and reports pop-up blocks); `onEdit` is optional.
 */
export function DocumentViewModal({ doc, projectLabel, onOpen, onEdit, onClose }) {
  const section = sectionOf(doc.category);
  const ref = refLabel(doc);
  const rows = [
    ["Section", section?.label],
    [section?.numberLabel ?? "Number", ref],
    ["Title", doc.title],
    ["Type", doc.doc_type],
    [dateLabel(doc.category), formatDate(doc.doc_date)],
    ["Project", projectLabel],
    ["File", doc.external_url ? "Saved as a link" : `${doc.file_name} · ${formatSize(doc.file_size)}`],
    ["Description", doc.description],
    ["Added", new Date(doc.created_at).toLocaleString("en-IN")],
  ].filter(([label]) => label);
  const pdf = !doc.external_url && isPdf(doc);

  return (
    <Modal title={ref ? `${section?.single ?? "Document"} ${ref}` : doc.title} titleId="pt-doc-view-title" onClose={onClose}>
      <div className="mb-4 flex items-center gap-3 rounded-xl bg-[#f6f7fb] p-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-[#1f4693] shadow-sm">
          {doc.external_url ? <Link2 className="h-5 w-5" aria-hidden="true" /> : <FileText className="h-5 w-5" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-[#2b303b]">{doc.external_url ? doc.external_url.replace(/^https?:\/\//, "") : doc.file_name}</p>
          <p className="text-xs text-[#676b7a]">{doc.external_url ? "Link" : `${pdf ? "PDF" : "File"} · ${formatSize(doc.file_size)}`}</p>
        </div>
      </div>
      <dl className="divide-y divide-[#eef0f3] rounded-xl border border-[#e7e9ee]">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="font-semibold text-[#676b7a]">{label}</dt>
            <dd className="min-w-0 break-words text-[#2b303b]">{value || <span className="text-[#c4c8d0]">—</span>}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {onEdit && (
          <button type="button" onClick={onEdit} className={BTN_SECONDARY}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit
          </button>
        )}
        <button type="button" onClick={() => onOpen(doc, false)} className={BTN_SECONDARY}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          {doc.external_url ? "Open link" : "Open"}
        </button>
        {!doc.external_url && (
          <button type="button" onClick={() => onOpen(doc, true)} className={BTN_PRIMARY}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {pdf ? "Download PDF" : "Download"}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Notice text when the browser blocked the new tab: a link to open / download instead. */
export function BlockedLink({ doc, url, download }) {
  return (
    <>
      Your browser blocked the new tab.{" "}
      <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
        Click here to {download ? "download" : "open"} {refLabel(doc) ?? doc.title}
      </a>
      {doc.external_url ? "." : " (link valid for 1 minute)."}
    </>
  );
}

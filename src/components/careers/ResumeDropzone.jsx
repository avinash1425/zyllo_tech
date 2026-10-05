import { useState } from "react";
import { CheckCircle2, FileText, UploadCloud, X } from "lucide-react";

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Drag-and-drop PDF picker. The real <input type="file" name="resume"> stays
// mounted inside the form at all times, so the form submits the File exactly
// like a plain file input would.
export default function ResumeDropzone({ inputRef, file, error, onChange, onRemove }) {
  const [dragging, setDragging] = useState(false);

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer?.files;
    if (!dropped || dropped.length === 0 || !inputRef.current) return;
    try {
      const dt = new DataTransfer();
      dt.items.add(dropped[0]);
      inputRef.current.files = dt.files;
    } catch {
      return;
    }
    onChange(inputRef.current.files[0] ?? null);
  }

  return (
    <div>
      <input
        ref={inputRef}
        id="resume"
        name="resume"
        type="file"
        accept="application/pdf"
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "resume-error resume-hint" : "resume-hint"}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="peer sr-only"
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-2xl border border-[#3089a6]/30 bg-gradient-to-r from-[#3089a6]/[0.07] to-[#f7941e]/[0.05] p-3.5">
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-[#f96706] shadow-sm ring-1 ring-[#e7e9ee]">
            <FileText className="h-6 w-6" aria-hidden="true" />
            <CheckCircle2 className="absolute -bottom-1.5 -right-1.5 h-5 w-5 rounded-full bg-white text-[#16a34a]" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#1b2030]">{file.name}</p>
            <p className="text-xs text-[#676b7a]">{formatBytes(file.size)} &middot; ready to upload</p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${file.name}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#676b7a] transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/30"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <label
          htmlFor="resume"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`group/drop flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-all duration-200 peer-focus-visible:ring-4 peer-focus-visible:ring-[#f7941e]/30 ${
            error
              ? "border-red-300 bg-red-50/40"
              : dragging
                ? "scale-[1.01] border-[#f96706] bg-[#f7941e]/10"
                : "border-[#f7941e]/40 bg-gradient-to-b from-[#fffaf3] to-white hover:border-[#f96706] hover:bg-[#f7941e]/5"
          }`}
        >
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg shadow-[#f7941e]/30 transition-transform duration-200 group-hover/drop:-translate-y-0.5 group-hover/drop:scale-105 ${
              dragging ? "-translate-y-1 scale-110" : ""
            } bg-gradient-to-br from-[#f96706] to-[#f7941e]`}
          >
            <UploadCloud className="h-7 w-7" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-[#1b2030]">
            {dragging ? "Drop your resume here" : "Drag & drop your resume, or "}
            {!dragging && <span className="text-[#1f4693] underline underline-offset-2">browse</span>}
          </span>
        </label>
      )}

      <p id="resume-hint" className="mt-2 text-xs text-[#676b7a]">
        PDF only, max 5 MB.
      </p>
      {error && (
        <p id="resume-error" role="alert" className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

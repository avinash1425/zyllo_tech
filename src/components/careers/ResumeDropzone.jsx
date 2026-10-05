import { useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";

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
        <div className="flex items-center gap-3 rounded-xl border border-[#e7e9ee] bg-[#fafbfc] p-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#f7941e]/10 text-[#b3560a]">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#2b303b]">{file.name}</p>
            <p className="text-xs text-[#676b7a]">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${file.name}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#676b7a] transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/30"
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
          className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors peer-focus-visible:ring-4 peer-focus-visible:ring-[#f7941e]/30 ${
            error
              ? "border-red-300 bg-red-50/40"
              : dragging
                ? "border-[#f7941e] bg-[#f7941e]/10"
                : "border-[#d5d9e2] bg-[#fafbfc] hover:border-[#f7941e]/60 hover:bg-[#f7941e]/5"
          }`}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#1f4693] shadow-sm ring-1 ring-[#e7e9ee]">
            <UploadCloud className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-[#2b303b]">
            Drag &amp; drop your resume, or{" "}
            <span className="text-[#1f4693] underline">browse</span>
          </span>
        </label>
      )}

      <p id="resume-hint" className="mt-1.5 text-xs text-[#676b7a]">
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

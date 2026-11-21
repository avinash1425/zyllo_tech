import { useEffect, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { BTN_SECONDARY, inputClass } from "./styles";

/** Password field with a show/hide eye. Browsers are told not to autofill it. */
export function PasswordInput({ id, value, onChange, error, autoFocus, autoComplete = "new-password", placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputClass(error)} pr-10 font-mono`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#676b7a] hover:text-[#2b303b]"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

/** Dialog shell: backdrop click and Escape close it. */
export function Modal({ title, titleId, onClose, children, size = "max-w-2xl", role = "dialog" }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0e17]/50 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className={`max-h-[90vh] w-full ${size} overflow-y-auto rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-lg font-bold text-[#2b303b]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-[#676b7a] hover:bg-[#f3f4f7]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Label + control + error message. `children` renders a custom control. */
export function Field({ id, label, required, error, className = "", children }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-[#2b303b]">
        {label}
        {required && <span className="text-[#d9650a]"> *</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormMessage({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700 sm:col-span-2">
      {message}
    </p>
  );
}

export function ConfirmDialog({ title, children, confirmLabel = "Delete", onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function confirm() {
    setBusy(true);
    setMessage("");
    const result = await onConfirm();
    setBusy(false);
    if (result?.status !== "success") setMessage(result?.message || "Something went wrong.");
  }

  return (
    <Modal title={title} titleId="pt-confirm-title" onClose={onClose} size="max-w-sm" role="alertdialog">
      <div className="text-sm text-[#676b7a]">{children}</div>
      {message && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Notice({ text, tone = "success", onClose }) {
  if (!text) return null;
  const styles = tone === "success" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900";
  return (
    <div role="status" className={`flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm ${styles}`}>
      <span>{text}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="p-1">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Company logo, or the company's initials when there is no logo (or it fails to load). */
export function CompanyLogo({ name, url, className = "h-20 w-20", textClass = "text-2xl" }) {
  const [failedUrl, setFailedUrl] = useState(null);
  if (url && failedUrl !== url) {
    return (
      <span className={`flex items-center justify-center overflow-hidden rounded-xl bg-white ${className}`}>
        <img src={url} alt={`${name} logo`} className="h-full w-full object-contain" onError={() => setFailedUrl(url)} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e] to-[#1f4693] font-bold text-white ${className} ${textClass}`}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Pick one option with buttons (used instead of dropdowns).
 * options: [{ value, label }]. With `allowEmpty`, clicking the chosen button again clears it.
 */
export function ChoiceChips({ id, label, options, value, onChange, allowEmpty = false, error, size = "md" }) {
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div>
      {label && (
        <p id={id} className="mb-1.5 block text-xs font-semibold text-[#2b303b]">
          {label}
        </p>
      )}
      <div role="radiogroup" aria-labelledby={label ? id : undefined} aria-label={label ? undefined : id} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(selected && allowEmpty ? "" : o.value)}
              className={`rounded-lg border font-medium transition-colors ${pad} ${
                selected
                  ? "border-[#f7941e] bg-[#f7941e] text-white"
                  : "border-[#e7e9ee] bg-white text-[#2b303b] hover:border-[#f7941e]/60 hover:text-[#c24f05]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

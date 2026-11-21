import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, X } from "lucide-react";
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0e17]/65 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[90vh] w-full ${size} flex-col overflow-hidden rounded-2xl border border-[#dce6f7] shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gradient header */}
        <div className="shrink-0 bg-gradient-to-r from-[#1f4693] via-[#2d5fbe] to-[#3089a6] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <h2 id={titleId} className="text-lg font-bold text-white">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        {/* Scrollable body */}
        <div className="overflow-y-auto bg-white p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Label + control + error message. `children` renders a custom control. */
export function Field({ id, label, required, error, className = "", children }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[#8a90a0]">
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
  const timerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(false);

  useEffect(() => {
    if (!text) { setVisible(false); setProgress(false); return; }
    setVisible(true);
    setProgress(false);
    // Start progress bar on next frame so CSS transition fires
    const raf = requestAnimationFrame(() => setProgress(true));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setVisible(false); setTimeout(onClose, 300); }, 4000);
    return () => { clearTimeout(timerRef.current); cancelAnimationFrame(raf); };
  }, [text]);

  if (!text) return null;

  const isSuccess = tone === "success";
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;
  const accent = isSuccess ? "#059669" : "#d97706";
  const iconBg = isSuccess ? "#ecfdf5" : "#fffbeb";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        transform: visible ? "translateY(0)" : "translateY(1.5rem)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.25s ease, opacity 0.25s ease",
      }}
      className="fixed bottom-6 right-6 z-50 flex w-80 items-start gap-3 rounded-xl border border-[#e5e7eb] bg-white px-4 py-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
    >
      {/* Icon */}
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ background: iconBg }}
      >
        <Icon className="h-4 w-4" style={{ color: accent }} aria-hidden="true" />
      </span>

      {/* Text */}
      <div className="flex-1 pt-0.5">
        <p className="text-[13px] font-semibold text-[#111827]">
          {isSuccess ? "Success" : "Notice"}
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[#6b7280]">{text}</p>
      </div>

      {/* Close */}
      <button
        type="button"
        onClick={() => { setVisible(false); setTimeout(onClose, 300); }}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-[#9ca3af] transition-colors hover:bg-[#f3f4f6] hover:text-[#374151]"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* Progress bar — shrinks from 100% → 0% over 4 s */}
      <span
        className="absolute bottom-0 left-0 h-[3px] rounded-b-xl"
        style={{
          background: accent,
          width: progress ? "0%" : "100%",
          transition: progress ? "width 4s linear" : "none",
        }}
      />
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
  const pad = size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm";
  return (
    <div>
      {label && (
        <p id={id} className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[#8a90a0]">
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
              className={`rounded-full border font-semibold transition-all ${pad} ${
                selected
                  ? "border-transparent bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-sm"
                  : "border-[#e3e9f5] bg-[#f8faff] text-[#676b7a] hover:border-[#1f4693]/30 hover:bg-[#eef2fb] hover:text-[#1f4693]"
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

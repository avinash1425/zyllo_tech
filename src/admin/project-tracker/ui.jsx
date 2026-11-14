// Small UI kit for Project Tracker, in the existing Zyllo admin style.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "@/lib/nx/link";
import { ArrowUpDown, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, X, CircleAlert, CircleCheck, Eye, EyeOff, Info, Loader2 } from "lucide-react";

// ------------------------------------------------------------------ buttons
const BTN = {
  primary: "bg-[#1f4693] text-white shadow-sm hover:bg-[#183a7a]",
  accent: "bg-gradient-to-r from-[#f7941e] to-[#f96706] text-white shadow-sm hover:brightness-105",
  secondary: "border border-[#e7e9ee] bg-white text-[#2b303b] hover:border-[#1f4693]/30 hover:bg-[#fafbfc]",
  ghost: "text-[#676b7a] hover:bg-[#f1f3f7] hover:text-[#2b303b]",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  blue: "bg-[#1f4693] text-white hover:bg-[#183a7a]",
};
export function Button({ variant = "secondary", size = "md", icon: Icon, busy, children, className = "", type = "button", ...rest }) {
  const sz = size === "sm" ? "h-8 px-2.5 text-[12.5px] gap-1.5" : "h-10 px-3.5 text-sm gap-2";
  return (
    <button
      type={type}
      disabled={busy || rest.disabled}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693] disabled:cursor-not-allowed disabled:opacity-55 ${sz} ${BTN[variant]} ${className}`}
      {...rest}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ breadcrumbs
/** items: [{ label, href? }] — the last item is the current page. */
export function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Project Tracker breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-[#676b7a]">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#b3b8c4]" aria-hidden="true" />}
            {it.href && i < items.length - 1 ? (
              <Link href={it.href} className="truncate font-medium text-[#1f4693] hover:underline">{it.label}</Link>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined} className="truncate font-medium text-[#2b303b]">{it.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ------------------------------------------------------------------ badge
const TONES = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-[#1f4693]/8 text-[#1f4693] ring-[#1f4693]/20",
  teal: "bg-[#3089a6]/10 text-[#216478] ring-[#3089a6]/25",
  neutral: "bg-[#676b7a]/10 text-[#4b4f5c] ring-[#676b7a]/20",
};
const TONE_OF = {
  success: ["active", "live", "completed", "complete", "verified", "succeeded", "passed", "approved", "handed_over", "done", "enabled", "encrypted", "private", "renewed"],
  warning: ["pending", "in_progress", "under_testing", "under_client_review", "scheduled", "ready_for_review", "partial", "on_hold", "upcoming",
    "in_testing", "not_tested", "unknown", "high", "draft", "not_started", "paused", "internal", "confidential", "public", "parked"],
  danger: ["expired", "failed", "cancelled", "revoked", "missing", "missing_critical", "rejected", "blocked", "disabled", "lapsed",
    "rolled_back", "critical", "suspended", "not_encrypted", "lost", "restricted", "missed"],
  info: ["planned", "under_maintenance", "migrated", "medium", "todo", "transferred"],
  teal: ["low", "client_shareable", "not_applicable", "na", "not_required", "not_supported"],
};
export function toneFor(value) {
  for (const [tone, list] of Object.entries(TONE_OF)) if (list.includes(value)) return tone;
  return "neutral";
}
export function Badge({ value, label, tone, className = "" }) {
  const t = tone || toneFor(value);
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[t]} ${className}`}>
      {label ?? value}
    </span>
  );
}

// ------------------------------------------------------------------ cards / banners
export function Card({ title, actions, children, className = "", bodyClass = "p-4 sm:p-5" }) {
  return (
    <section className={`rounded-2xl border border-[#e7e9ee] bg-white shadow-[0_1px_2px_rgba(16,26,58,0.04)] ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef0f4] px-4 py-3 sm:px-5">
          {title && <h2 className="text-[15px] font-bold text-[#2b303b]">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Banner({ tone = "info", title, children, className = "" }) {
  const Icon = tone === "danger" || tone === "warning" ? CircleAlert : tone === "success" ? CircleCheck : Info;
  const cls = {
    info: "border-[#1f4693]/20 bg-[#1f4693]/[0.04] text-[#1f3a6e]",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${cls} ${className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-[#676b7a]">
      <Loader2 className="h-5 w-5 animate-spin text-[#1f4693] motion-reduce:animate-none" aria-hidden="true" />
      {label}
    </div>
  );
}

// ------------------------------------------------------------------ modal
export function Modal({ title, onClose, children, footer, size = "md", busy = false }) {
  const titleId = useId();
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const first = el?.querySelector("input, select, textarea, button:not([data-close])");
    (first || el)?.focus();
    function onKey(e) {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab" && el) {
        const nodes = [...el.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
        if (nodes.length === 0) return;
        const firstN = nodes[0];
        const lastN = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === firstN) { e.preventDefault(); lastN.focus(); }
        else if (!e.shiftKey && document.activeElement === lastN) { e.preventDefault(); firstN.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const width = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl" }[size];
  // Portal to <body>: an admin-shell ancestor with a transform/filter would
  // otherwise become the containing block of this fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#0b0e17]/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[94vh] w-full ${width} flex-col rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#eef0f4] px-5 py-4">
          <h2 id={titleId} className="text-lg font-bold text-[#2b303b]">{title}</h2>
          <button type="button" data-close onClick={onClose} disabled={busy} aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#676b7a] hover:bg-[#f1f3f7] disabled:opacity-50">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eef0f4] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation dialog. `requireReason` adds a mandatory text box (value passed to onConfirm). */
export function ConfirmDialog({ title, message, confirmLabel = "Confirm", tone = "danger", requireReason, reasonLabel = "Reason", minReason = 3, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = !requireReason || reason.trim().length >= minReason;
  async function go() {
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(e?.message || "Failed.");
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} size="sm" busy={busy}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={go} busy={busy} disabled={!ok}>{confirmLabel}</Button>
      </>}>
      <div className="space-y-3 text-sm text-[#4b4f5c]">
        {typeof message === "string" ? <p>{message}</p> : message}
        {requireReason && (
          <TextArea label={reasonLabel} value={reason} onChange={setReason} rows={3} required
            help={minReason > 3 ? `At least ${minReason} characters.` : undefined} />
        )}
        {error && <Banner tone="danger">{error}</Banner>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ toasts
const ToastCtx = createContext({ push: () => {} });
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, tone = "success") => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "danger" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      {createPortal(
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[70] flex max-w-[calc(100vw-2rem)] flex-col gap-2 sm:max-w-sm">
        {items.map((t) => (
          <div key={t.id} role="status"
            className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
              t.tone === "danger" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            {t.message}
          </div>
        ))}
      </div>,
      document.body,
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ form controls
const INPUT = "w-full rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 text-sm text-[#2b303b] outline-none transition-colors placeholder:text-[#9aa0ad] focus:border-[#1f4693]/60 focus:ring-2 focus:ring-[#1f4693]/10 disabled:bg-[#f6f7fb]";
const INPUT_ERR = "border-red-300 focus:border-red-400 focus:ring-red-100";

export function FieldShell({ id, label, required, help, error, children, full }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-[#2b303b]">
          {label}{required && <span className="text-red-600" aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : help ? (
        <p id={`${id}-help`} className="mt-1 text-xs text-[#676b7a]">{help}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ label, value, onChange, type = "text", required, help, error, full, list, ...rest }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={required} help={help} error={error} full={full}>
      <input id={id} type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} list={list}
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : help ? `${id}-help` : undefined}
        className={`${INPUT} ${error ? INPUT_ERR : ""}`} {...rest} />
    </FieldShell>
  );
}

export function TextArea({ label, value, onChange, rows = 3, required, help, error, full, ...rest }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={required} help={help} error={error} full={full}>
      <textarea id={id} rows={rows} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : help ? `${id}-help` : undefined}
        className={`${INPUT} resize-y ${error ? INPUT_ERR : ""}`} {...rest} />
    </FieldShell>
  );
}

export function Select({ label, value, onChange, options, required, help, error, full, placeholder = "— Select —", allowEmpty = true, ...rest }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={required} help={help} error={error} full={full}>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : help ? `${id}-help` : undefined}
        className={`${INPUT} ${error ? INPUT_ERR : ""}`} {...rest}>
        {(allowEmpty || value === "" || value === null || value === undefined) && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FieldShell>
  );
}

/** Masked input for a password being typed. The value lives only in component state. */
export function PasswordInput({ label, value, onChange, required, help, error, full, disabled, disabledReason }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <FieldShell id={id} label={label} required={required} help={disabled ? disabledReason : help} error={error} full={full}>
      <div className="relative">
        <input id={id} type={shown ? "text" : "password"} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}
          autoComplete="new-password" spellCheck={false} data-lpignore="true" maxLength={500}
          aria-invalid={!!error} className={`${INPUT} pr-10 ${error ? INPUT_ERR : ""}`} />
        <button type="button" onClick={() => setShown((s) => !s)} disabled={disabled}
          aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[#676b7a] hover:text-[#1f4693] disabled:opacity-40">
          {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </FieldShell>
  );
}

export function Checkbox({ label, checked, onChange, help, full, disabled }) {
  const id = useId();
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm text-[#2b303b]">
        <input id={id} type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-[#c9cdd6] accent-[#1f4693]" />
        {label}
      </label>
      {help && <p className="text-xs text-[#676b7a]">{help}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ table
/**
 * columns: [{ key, label, sortable?, render?(row), className? }]
 * sort: { key, dir } ; onSort(key)
 */
export function DataTable({ columns, rows, sort, onSort, onRowClick, rowKey = (r) => r.id, empty, caption, rowClass }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border border-[#eef0f4]">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-[#f8f9fb] text-xs uppercase tracking-wide text-[#676b7a]">
          <tr>
            {columns.map((c) => {
              const active = sort && sort.key === c.key;
              const Icon = active ? (sort.dir === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown;
              return (
                <th key={c.key} scope="col" className={`whitespace-nowrap px-3 py-2.5 font-semibold ${c.className || ""}`}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sortable !== false && onSort ? (
                    <button type="button" onClick={() => onSort(c.key)}
                      className="inline-flex items-center gap-1 rounded uppercase hover:text-[#2b303b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]">
                      {c.label}<Icon className={`h-3.5 w-3.5 ${active ? "text-[#1f4693]" : "opacity-50"}`} aria-hidden="true" />
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-[#676b7a]">{empty || "No records."}</td></tr>
          ) : rows.map((r) => (
            <tr key={rowKey(r)}
              onClick={onRowClick ? (e) => { if (!e.target.closest("button, a, input, select")) onRowClick(r); } : undefined}
              className={`border-t border-[#eef0f4] align-top ${onRowClick ? "cursor-pointer hover:bg-[#fafbfc]" : ""} ${rowClass ? rowClass(r) : ""}`}>
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2.5 text-[#2b303b] ${c.className || ""}`}>{c.render ? c.render(r) : r[c.key] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, count, onPage }) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (count <= pageSize) return <p className="mt-3 text-xs text-[#676b7a]">{count} record{count === 1 ? "" : "s"}</p>;
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-[#676b7a]">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, count)} of {count}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">Prev</Button>
        <span className="px-2">Page {page} / {pages}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next<ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ tabs (links)
export function TabBar({ tabs, active, onSelect, label = "Sections" }) {
  return (
    <div className="relative overflow-x-auto pb-1">
      <div role="tablist" aria-label={label} className="flex min-w-max gap-1">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button key={t.key} role="tab" type="button" aria-selected={on} onClick={() => onSelect(t.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693] ${
                on ? "bg-[#101a3a] text-white" : "text-[#4b4f5c] hover:bg-white hover:text-[#101a3a]"}`}>
              {t.icon && <t.icon className="h-4 w-4" aria-hidden="true" />}
              {t.label}
              {t.dot && <span className={`h-2 w-2 rounded-full ${t.dot}`} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DefinitionGrid({ items, compact = false }) {
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 ${compact ? "" : "lg:grid-cols-3"}`}>
      {items.map((it) => (
        <div key={it.label} className={it.full ? (compact ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-3") : ""}>
          <dt className="text-xs font-medium uppercase tracking-wide text-[#8a8f9c]">{it.label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-[#2b303b]">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// Shared HRMS UI kit (Zyllo Tech visual language: navy #101a3a, orange
// #f96706/#f7941e, teal #3089a6). Accessible, responsive building blocks used
// by every HR Operations and Employee Portal page.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from "lucide-react";

const cx = (...c) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------- buttons
const VARIANTS = {
  primary: "bg-gradient-to-r from-[#f7941e] to-[#f96706] text-white shadow-[0_8px_18px_-10px_rgba(249,103,6,0.8)] hover:brightness-105",
  secondary: "border border-slate-200 bg-white text-[#173a52] hover:border-[#1f4693]/40 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-[#173a52] hover:bg-slate-100",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
};
export function Button({ variant = "primary", size = "md", loading = false, className, children, disabled, ...props }) {
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-11 px-5 text-sm" };
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx("inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693] disabled:cursor-not-allowed disabled:opacity-60", sizes[size], VARIANTS[variant], className)}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- layout
export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-lg font-extrabold tracking-tight text-[#101a3a] sm:text-xl">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, className, children, padded = true }) {
  return (
    <section className={cx("rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,26,58,0.04)]", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          {title && <h3 className="text-sm font-bold text-[#101a3a]">{title}</h3>}
          {actions}
        </div>
      )}
      <div className={padded ? "p-4 sm:p-5" : ""}>{children}</div>
    </section>
  );
}

export function KpiCard({ label, value, hint, icon: Icon, tone = "orange", onClick, loading }) {
  const tones = { orange: "from-[#f7941e] to-[#f96706]", teal: "from-[#3089a6] to-[#1f6f8a]", navy: "from-[#1f4693] to-[#101a3a]", green: "from-emerald-500 to-emerald-700", red: "from-rose-500 to-rose-700", slate: "from-slate-500 to-slate-700" };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick}
      className={cx("flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,26,58,0.04)]", onClick && "transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]")}>
      {Icon && <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white", tones[tone])}><Icon className="h-5 w-5" aria-hidden="true" /></span>}
      <span className="min-w-0">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="block text-2xl font-extrabold text-[#101a3a]">{loading ? <span className="inline-block h-6 w-10 animate-pulse rounded bg-slate-200" /> : value ?? "—"}</span>
        {hint && <span className="block truncate text-xs text-slate-500">{hint}</span>}
      </span>
    </Tag>
  );
}

// ---------------------------------------------------------------- states
export function Loading({ label = "Loading…", className }) {
  return (
    <div role="status" className={cx("flex items-center justify-center gap-2 py-10 text-sm text-slate-500", className)}>
      <Loader2 className="h-5 w-5 animate-spin text-[#f96706]" aria-hidden="true" /> {label}
    </div>
  );
}

export function EmptyState({ title = "Nothing here yet", description, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon className="h-6 w-6" aria-hidden="true" /></span>
      <p className="text-sm font-bold text-[#101a3a]">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
      <AlertTriangle className="h-6 w-6 text-red-600" aria-hidden="true" />
      <p className="text-sm font-semibold text-red-800">{message || "Could not load data."}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function InlineError({ message }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{message}</p>;
}

/** Render loading / error / empty / content for a useHrQuery result. */
export function QueryState({ query, empty, children, emptyTitle, emptyDescription }) {
  if (query.loading && query.data == null) return <Loading />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.reload} />;
  const isEmpty = empty ?? (Array.isArray(query.data) ? query.data.length === 0 : query.data == null);
  if (isEmpty) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return children;
}

// ---------------------------------------------------------------- badges
const BADGE_TONES = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
const STATUS_TONE = {
  active: "green", approved: "green", present: "green", completed: "green", verified: "green", reviewed: "green", published: "green",
  finalized: "green", paid: "green", resolved: "green", returned: "green", achieved: "green", joined: "green", accepted: "green", done: "green", sent: "green", closed: "slate",
  pending: "amber", pending_approval: "amber", submitted: "amber", under_review: "amber", in_progress: "blue", probation: "blue", onboarding: "blue",
  draft: "slate", scheduled: "violet", calculated: "violet", open: "blue", queued: "violet", interview: "violet", shortlisted: "violet", screening: "blue",
  late: "orange", half_day: "orange", missing_punch: "orange", notice_period: "orange", revision_requested: "orange", waiting_on_employee: "orange", on_leave: "blue",
  rejected: "red", absent: "red", cancelled: "slate", exited: "slate", archived: "slate", suspended: "red", failed: "red", expired: "red", lost: "red", withdrawn: "slate",
};
export function Badge({ children, tone = "slate", className }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", BADGE_TONES[tone] ?? BADGE_TONES.slate, className)}>{children}</span>;
}
export function StatusBadge({ status }) {
  if (!status) return <Badge>—</Badge>;
  return <Badge tone={STATUS_TONE[status] ?? "slate"}>{String(status).replace(/_/g, " ")}</Badge>;
}

// ---------------------------------------------------------------- forms
export function Field({ label, error, hint, required, children, className }) {
  const id = useId();
  const child = typeof children === "function" ? children(id) : children;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      {label && <label htmlFor={id} className="text-sm font-semibold text-[#173a52]">{label}{required && <span className="text-red-600" aria-hidden="true"> *</span>}</label>}
      {typeof children === "function" ? child : <FieldIdContext.Provider value={{ id, error }}>{child}</FieldIdContext.Provider>}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs font-medium text-red-600" role="alert">{error}</p>}
    </div>
  );
}
const FieldIdContext = createContext(null);
const inputCls = (error) => cx("w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#f96706] focus:ring-4 focus:ring-[#f96706]/15 disabled:bg-slate-50 disabled:text-slate-500", error ? "border-red-400" : "border-slate-200");
export function Input(props) {
  const ctx = useContext(FieldIdContext);
  return <input id={ctx?.id} aria-invalid={ctx?.error ? true : undefined} {...props} className={cx(inputCls(ctx?.error), props.className)} />;
}
export function Textarea(props) {
  const ctx = useContext(FieldIdContext);
  return <textarea id={ctx?.id} rows={props.rows ?? 3} aria-invalid={ctx?.error ? true : undefined} {...props} className={cx(inputCls(ctx?.error), props.className)} />;
}
export function Select({ options = [], placeholder, ...props }) {
  const ctx = useContext(FieldIdContext);
  return (
    <select id={ctx?.id} aria-invalid={ctx?.error ? true : undefined} {...props} className={cx(inputCls(ctx?.error), "pr-8", props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
}
export function Checkbox({ label, ...props }) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#173a52]">
      <input id={id} type="checkbox" {...props} className="h-4 w-4 rounded border-slate-300 text-[#f96706] focus:ring-[#f96706]" />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- modal
export function Modal({ open, onClose, title, children, footer, size = "md" }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const el = ref.current;
    const focusables = () => el?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [];
    setTimeout(() => (focusables()[0] ?? el)?.focus(), 0);
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
      if (e.key === "Tab") {
        const f = Array.from(focusables()).filter((n) => !n.disabled);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#0b0e17]/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={cx("flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl", widths[size])}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 id={titleId} className="text-base font-extrabold text-[#101a3a]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Confirmation dialog. `onConfirm` must return { error } — the dialog stays
 * open and shows the error if the server rejected the action.
 */
export function ConfirmDialog({ open, onClose, title, message, confirmLabel = "Confirm", tone = "primary", onConfirm, requireReason, reasonLabel = "Reason" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) { setError(null); setReason(""); } }, [open]);
  async function go() {
    if (requireReason && !reason.trim()) { setError(`${reasonLabel} is required.`); return; }
    setBusy(true); setError(null);
    const res = (await onConfirm?.(reason.trim())) ?? {};
    setBusy(false);
    if (res.error) setError(res.error); else onClose?.();
  }
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant={tone} loading={busy} onClick={go}>{confirmLabel}</Button></>}>
      <div className="flex flex-col gap-3">
        {message && <p className="text-sm text-slate-700">{message}</p>}
        {requireReason !== undefined && (
          <Field label={reasonLabel} required={Boolean(requireReason)}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        )}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- toast
const ToastContext = createContext({ notify: () => {} });
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, tone = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,22rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={cx("pointer-events-auto flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg", t.tone === "error" ? "bg-red-600 text-white" : "bg-[#101a3a] text-white")}>
            {t.tone === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
/** notify(message, "success"|"error"). Only call "success" AFTER the server confirmed. */
export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------- table
/**
 * columns: [{ key, header, render?(row), className?, sortable? }]
 * Client-side search/sort/pagination unless `serverPaging` is given:
 *   serverPaging = { page, pageSize, total, onPage }
 */
export function DataTable({ columns, rows, loading, error, onRetry, emptyTitle = "No records found", emptyDescription, rowKey = "id", pageSize = 20, serverPaging, onRowClick, caption }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(null);
  const list = useMemo(() => {
    const data = [...(rows ?? [])];
    if (sort && !serverPaging) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (r) => (col?.sortValue ? col.sortValue(r) : r[sort.key]);
      data.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * (sort.dir === "asc" ? 1 : -1); });
    }
    return data;
  }, [rows, sort, columns, serverPaging]);
  useEffect(() => { setPage(1); }, [rows?.length]);
  // Defensive numbers: a missing / NaN count must never reach the footer ("Showing 1–NaN").
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : fallback);
  const total = Math.max(0, Math.floor(num(serverPaging ? serverPaging.total : list.length, 0)));
  const size = Math.max(1, Math.floor(num(serverPaging ? serverPaging.pageSize : pageSize, 20)));
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pages, Math.max(1, Math.floor(num(serverPaging ? serverPaging.page : page, 1))));
  const visible = serverPaging ? list : list.slice((current - 1) * size, current * size);
  const go = (p) => { const n = Math.min(pages, Math.max(1, p)); return serverPaging ? serverPaging.onPage(n) : setPage(n); };
  const first = total ? (current - 1) * size + 1 : 0;
  const last = Math.min(total, current * size);

  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="relative overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-slate-50">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cx("whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-600", c.className)}
                  aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sortable && !serverPaging ? (
                    <button type="button" className="inline-flex items-center gap-1 hover:text-[#f96706]" onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === "asc" ? "desc" : "asc" }))}>
                      {c.header}{sort?.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !rows?.length ? (
              <tr><td colSpan={columns.length}><Loading /></td></tr>
            ) : !visible.length ? (
              <tr><td colSpan={columns.length}><EmptyState title={emptyTitle} description={emptyDescription} /></td></tr>
            ) : visible.map((r) => (
              <tr key={typeof rowKey === "function" ? rowKey(r) : r[rowKey]}
                className={cx("align-top", onRowClick && "cursor-pointer hover:bg-orange-50/40")}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(r); } : undefined}
                tabIndex={onRowClick ? 0 : undefined}>
                {columns.map((c) => <td key={c.key} className={cx("px-4 py-3 text-slate-700", c.className)}>{c.render ? c.render(r) : r[c.key] ?? "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > size ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
          <span aria-live="polite">Showing {first}–{last} · Page {current} of {pages} · {total} records</span>
          <span className="flex gap-1">
            <Button variant="secondary" size="sm" onClick={() => go(current - 1)} disabled={current <= 1 || loading} aria-label="Previous page"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
            <Button variant="secondary" size="sm" onClick={() => go(current + 1)} disabled={current >= pages || loading} aria-label="Next page"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
          </span>
        </div>
      ) : serverPaging && !loading ? (
        <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">{total === 0 ? "0 records" : `${total} record${total === 1 ? "" : "s"}`}</div>
      ) : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", label = "Search" }) {
  return (
    <div className="relative min-w-[12rem] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#f96706] focus:ring-4 focus:ring-[#f96706]/15" />
    </div>
  );
}

export function Toolbar({ children }) {
  return <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}

export function Tabs({ tabs, value, onChange, label = "Sections" }) {
  return (
    <div role="tablist" aria-label={label} className="relative mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition", value === t.value ? "bg-gradient-to-r from-[#f7941e] to-[#f96706] text-white" : "text-slate-600 hover:bg-slate-100")}>
          {t.label}{t.count !== undefined ? <span className="ml-1.5 rounded-full bg-black/10 px-1.5 text-xs">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function DescriptionList({ items }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.filter(Boolean).map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-[#101a3a]">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

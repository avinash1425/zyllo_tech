// Employee Portal UI kit — used by the admin Employee Portal pages AND the
// employee portal, so both look like the main admin Dashboard and the Project
// Tracker. Class names / colours: portalStyles.js.
import { ArrowUpRight, Inbox, Search } from "lucide-react";
import Link from "@/lib/nx/link";
import useCountUp from "@/admin/dashboard/useCountUp";
import { ACCENTS, CARD, TONES } from "./portalStyles";

/**
 * Card with a header row: orange icon tile + title (+ subtitle) on the left,
 * an optional action on the right, a thin divider, then the content.
 * `flush` = no padding around the content (for tables / lists that touch the edges).
 */
export function Panel({ icon: Icon, title, subtitle, action, children, flush = false, className = "", id }) {
  return (
    <section id={id} className={`${CARD} ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef0f4] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/20 to-[#f96706]/10 text-[#d9650a] ring-1 ring-inset ring-[#f7941e]/25">
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="truncate text-[15px] font-bold text-[#101a3a]">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-xs text-[#676b7a]">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

/**
 * KPI card (main-dashboard style): coloured top bar, gradient medallion,
 * big counting number, label and hint. `accent` = key of ACCENTS.
 * Numbers count up; pass `display` to show text instead (e.g. "3 / 5" or "7.5 h").
 */
export function KpiCard({ icon: Icon, label, value, display, hint, accent = "blue", href, chip, onClick, selected }) {
  const a = ACCENTS[accent] ?? ACCENTS.blue;
  const counted = useCountUp(typeof value === "number" ? value : 0);
  const shown = display ?? (typeof value === "number" ? counted : value);
  const body = (
    <>
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ backgroundImage: `linear-gradient(90deg, ${a.from}, ${a.to})` }} />
      <div className="flex items-start justify-between gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-[0_6px_14px_-4px_rgba(16,26,58,0.35)]"
          style={{ backgroundImage: `linear-gradient(135deg, ${a.from}, ${a.to})` }}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        {chip ? (
          <span className="inline-flex items-center rounded-full bg-[#f6f7fb] px-2 py-1 text-[11px] font-semibold text-[#4b4f5c] ring-1 ring-inset ring-[#e7e9ee]">
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: a.color }} aria-hidden="true" />
            {chip}
          </span>
        ) : href ? (
          <ArrowUpRight className="h-4 w-4 text-[#8a8f9c] transition-colors group-hover:text-[#2b303b]" aria-hidden="true" />
        ) : null}
      </div>
      <p className="mt-4 text-[30px] font-extrabold leading-none tabular-nums tracking-tight text-[#101a3a]">{shown}</p>
      <p className="mt-1.5 text-sm font-semibold text-[#2b303b]">{label}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-[#676b7a]">{hint}</p>}
    </>
  );
  const cls = `group relative block overflow-hidden rounded-2xl border bg-white p-5 pt-6 text-left shadow-[0_1px_2px_rgba(16,26,58,0.04),0_8px_24px_-12px_rgba(16,26,58,0.10)] transition-all duration-200 motion-reduce:transition-none ${
    selected ? "border-[#1f4693]/40 ring-2 ring-[#1f4693]/15" : "border-[#e7e9ee]"
  }`;
  const interactive = "hover:border-[#d9dce3] hover:shadow-[0_14px_30px_-12px_rgba(16,26,58,0.22)] motion-safe:hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706]";
  if (href) {
    return (
      <Link href={href} aria-label={`${label}: ${shown}. Open`} className={`${cls} ${interactive}`}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={selected} className={`${cls} ${interactive} w-full`}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

/** Bold gradient KPI (white text, big faded icon) — for the one number that matters most. */
export function SolidKpi({ icon: Icon, label, value, display, hint, accent = "orange", href }) {
  const a = ACCENTS[accent] ?? ACCENTS.orange;
  const counted = useCountUp(typeof value === "number" ? value : 0);
  const shown = display ?? (typeof value === "number" ? counted : value);
  const cls =
    "group relative block overflow-hidden rounded-2xl p-5 text-white shadow-[0_14px_30px_-16px_rgba(16,26,58,0.55)] transition-all duration-200 motion-reduce:transition-none motion-safe:hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706]";
  const body = (
    <>
      <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10" />
      <Icon aria-hidden="true" className="pointer-events-none absolute -bottom-3 -right-2 h-24 w-24 text-white/15" strokeWidth={1.5} />
      <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 ring-1 ring-inset ring-white/30">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="relative mt-4 text-[32px] font-extrabold leading-none tabular-nums tracking-tight">{shown}</p>
      <p className="relative mt-1.5 text-[15px] font-semibold">{label}</p>
      {hint && <p className="relative mt-0.5 truncate text-[13px] text-white/80">{hint}</p>}
    </>
  );
  const style = { backgroundImage: `linear-gradient(135deg, ${a.from}, ${a.to})` };
  return href ? (
    <Link href={href} className={cls} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

/**
 * Navy → teal welcome banner (main dashboard style).
 * stats: [{ value, label }] shown as glass tiles on the right; `children` = buttons under the text.
 */
export function Hero({ eyebrow, title, subtitle, stats = [], children, aside }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#101a3a] via-[#173a52] to-[#3089a6] px-5 py-6 text-white shadow-[0_12px_32px_-16px_rgba(16,26,58,0.6)] sm:px-7">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-8 -top-20 h-60 w-60 rounded-full bg-[#f7941e]/40 blur-[70px]" />
        <div className="absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-[#3089a6]/30 blur-[70px]" />
        <div className="absolute -left-10 top-0 h-40 w-40 rounded-full bg-[#1f4693]/40 blur-[70px]" />
      </div>
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="min-w-0">
          {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">{eyebrow}</p>}
          <h2 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-[30px] sm:leading-9">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-white/80">{subtitle}</p>}
          {children && <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>}
        </div>
        {stats.length > 0 && (
          <div className={`grid shrink-0 gap-2 ${stats.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
            {stats.map((s) => (
              <div key={s.label} className="min-w-[5.5rem] rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-inset ring-white/15">
                <p className="text-xl font-bold leading-none tabular-nums sm:text-2xl">{s.value}</p>
                <p className="mt-1 truncate text-[11px] font-medium text-white/80">{s.label}</p>
              </div>
            ))}
          </div>
        )}
        {aside}
      </div>
    </div>
  );
}

/**
 * Project Tracker metric strip: one white bar split into tiles.
 * items: [{ key, label, value, icon, color }]. With onSelect the tiles are
 * filter buttons and `selected` highlights one.
 */
export function MetricStrip({ items, selected, onSelect }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#dde5f5] bg-white shadow-sm">
      <div className="grid grid-cols-2 divide-x divide-y divide-[#eef1f7] sm:flex sm:divide-y-0">
        {items.map((t) => {
          const on = selected === t.key;
          const Icon = t.icon;
          const inner = (
            <>
              {on && <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: t.color }} />}
              <span className="mb-1.5 flex items-center gap-1.5">
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: on ? t.color : "#9aa0ad" }} aria-hidden="true" />}
                <span className="truncate text-[10px] font-bold uppercase tracking-widest" style={{ color: on ? t.color : "#9aa0ad" }}>
                  {t.label}
                </span>
              </span>
              <span className="block text-[26px] font-black leading-none tabular-nums" style={{ color: on ? t.color : t.valueColor ?? "#0d1631" }}>
                {t.value}
              </span>
              {t.hint && <span className="mt-1 block truncate text-[11px] text-[#9aa0ad]">{t.hint}</span>}
            </>
          );
          return onSelect ? (
            <button
              key={t.key}
              type="button"
              onClick={() => onSelect(t.key)}
              aria-pressed={on}
              className={`relative flex min-w-0 flex-1 flex-col px-5 py-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1f4693] ${
                on ? "bg-[#f4f7ff]" : "hover:bg-[#f8faff]"
              }`}
            >
              {inner}
            </button>
          ) : (
            <div key={t.key} className="relative flex min-w-0 flex-1 flex-col px-5 py-4">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Table card (Project Tracker style): toolbar with title + count badge,
 * optional search box and actions, optional filter row, then the table.
 */
export function TableCard({ title, count, total, search, onSearch, searchPlaceholder = "Search…", actions, filters, children, className = "" }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-[#dde5f5] bg-white shadow-[0_1px_2px_rgba(16,26,58,0.04),0_8px_24px_-12px_rgba(16,26,58,0.10)] ${className}`}>
      <div className="flex flex-col gap-3 border-b border-[#eef1f7] bg-[#fafbff] px-5 py-3.5 sm:flex-row sm:items-center">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[14px] font-bold text-[#0d1631]">{title}</h2>
          {count != null && (
            <span className="rounded bg-[#eef2fb] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#1f4693]">
              {total != null && total !== count ? `${count} / ${total}` : count}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {onSearch && <SearchBox value={search} onChange={onSearch} placeholder={searchPlaceholder} />}
          {actions}
        </div>
      </div>
      {filters && <div className="border-b border-[#eef1f7] px-5 py-2.5">{filters}</div>}
      {children}
    </section>
  );
}

/** Search input with a magnifier. */
export function SearchBox({ value, onChange, placeholder = "Search…", className = "sm:w-64" }) {
  return (
    <div className={`relative w-full ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9aa0ad]" aria-hidden="true" />
      <input
        type="search"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-[#e3e9f5] bg-white py-2 pl-8 pr-3 text-[13px] text-[#2b303b] outline-none transition-colors placeholder:text-[#a3a8b5] focus:border-[#1f4693]/50 focus:ring-2 focus:ring-[#1f4693]/10"
      />
    </div>
  );
}

/**
 * Segmented tabs. items: [{ key, label, icon?, count? }]. Use for page-level views.
 */
export function Tabs({ items, value, onChange, label = "Views" }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <div role="tablist" aria-label={label} className="inline-flex min-w-max gap-1 rounded-xl border border-[#e3e9f5] bg-white p-1 shadow-sm">
        {items.map((t) => {
          const on = value === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-all ${
                on
                  ? "bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-[0_4px_12px_-4px_rgba(31,70,147,0.55)]"
                  : "text-[#4a5068] hover:bg-[#f4f7ff] hover:text-[#1f4693]"
              }`}
            >
              {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
              {t.label}
              {t.count != null && t.count !== "" && (
                <span
                  className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-[10.5px] font-bold leading-5 ${
                    on ? "bg-white/25 text-white" : t.alert ? "bg-[#f96706] text-white" : "bg-[#eef2fb] text-[#1f4693]"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Filter chips (Project Tracker ChoiceChips look). items: [{ key, label, count? }].
 * role="radiogroup" when one value; pass multiple via `isOn(key)`.
 */
export function Chips({ items, value, onChange, label, size = "sm", isOn }) {
  const pad = size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm";
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((o) => {
        const on = isOn ? isOn(o.key) : value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.key)}
            className={`rounded-full border font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${pad} ${
              on
                ? "border-transparent bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-sm"
                : "border-[#e3e9f5] bg-[#f8faff] text-[#676b7a] hover:border-[#1f4693]/30 hover:bg-[#eef2fb] hover:text-[#1f4693]"
            }`}
          >
            {o.label}
            {o.count != null && <span className={`ml-1 tabular-nums ${on ? "text-white/80" : "text-[#9aa0ad]"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Small rounded chip. tone = key of TONES (blue, green, red, amber, violet, orange, teal, sky, slate, navy). */
export function Badge({ tone = "blue", children, dot = false, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONES[tone] ?? TONES.blue} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Round initials avatar with the logo gradient. */
export function Avatar({ name, size = "h-9 w-9 text-sm", ring = false }) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f7941e] to-[#1f4693] font-bold text-white ${
        ring ? "ring-2 ring-white shadow-[0_2px_6px_rgba(16,26,58,0.25)]" : ""
      } ${size}`}
    >
      {initials}
    </span>
  );
}

/** Empty state (admin EmptyState look). */
export function Empty({ icon: Icon = Inbox, title, message, action, className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-10 text-center ${className}`}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/10 text-[#1f4693]">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      {title && <p className="mt-3 text-sm font-semibold text-[#2b303b]">{title}</p>}
      {message && <p className="mt-1 max-w-sm text-sm leading-relaxed text-[#676b7a]">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Label / value pair for detail grids (<dl>). */
export function Detail({ label, children, wide }) {
  return (
    <div className={`rounded-xl bg-[#f8fafd] px-3.5 py-3 ring-1 ring-inset ring-[#eef1f7] ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-[10.5px] font-bold uppercase tracking-wider text-[#9aa0ad]">{label}</dt>
      <dd className="mt-1 whitespace-pre-line break-words text-sm font-semibold text-[#101a3a]">
        {children ?? <span className="font-normal text-[#b0b8cc]">Not added</span>}
      </dd>
    </div>
  );
}

/** Gradient progress bar with % label. */
export function Progress({ value, label = true, className = "" }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef0f5]" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693] transition-[width] duration-500" style={{ width: `${v}%` }} />
      </div>
      {label && <span className="w-9 text-right text-xs font-bold tabular-nums text-[#2b303b]">{v}%</span>}
    </div>
  );
}

/** Coloured message strip: kind "ok" | "err" | "info" | "warn". */
export function Alert({ kind = "info", children, className = "" }) {
  if (!children) return null;
  const cls = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
    err: "border-red-200 bg-red-50 text-red-700",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    info: "border-[#dce6f7] bg-[#f5f8ff] text-[#1f4693]",
  }[kind];
  return (
    <p role={kind === "err" ? "alert" : "status"} className={`rounded-xl border px-4 py-2.5 text-sm ${cls} ${className}`}>
      {children}
    </p>
  );
}

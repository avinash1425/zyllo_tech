// Cell renderers shared by tables, detail views and registers.
import { ExternalLink, Lock, LockOpen } from "lucide-react";
import { Badge } from "./ui";
import { labelOf } from "./lib/options";
import { daysUntil, formatBytes, formatDate, formatDateTime, formatMoney, relativeDays } from "./lib/format";

export function DueCell({ date, done }) {
  if (!date) return <span className="text-[#9aa0ad]">—</span>;
  const n = daysUntil(date);
  const cls = done ? "text-[#676b7a]" : n < 0 ? "text-red-700 font-semibold" : n <= 15 ? "text-amber-800 font-semibold" : n <= 60 ? "text-[#2b303b]" : "text-[#676b7a]";
  return (
    <span className="whitespace-nowrap">
      {formatDate(date)}
      {!done && <span className={`block text-xs ${cls}`}>{n < 0 ? `overdue ${-n}d` : relativeDays(date)}</span>}
    </span>
  );
}

export function SafeLink({ href, children }) {
  if (!href || !/^https?:\/\//i.test(href)) return <span className="break-all">{children || href || "—"}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow"
      className="inline-flex max-w-full items-center gap-1 break-all text-[#1f4693] underline-offset-2 hover:underline">
      <span className="truncate">{children || href}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}

/** Render a column/field value according to its definition. */
export function renderValue(col, row) {
  const v = row[col.key ?? col.name];
  if (col.render) return col.render(row);
  if (col.text) return col.text(row) || <span className="text-[#9aa0ad]">—</span>;
  if (col.options) {
    if (v === null || v === undefined || v === "") return <span className="text-[#9aa0ad]">—</span>;
    const label = labelOf(col.options, v);
    return col.badge ? <Badge value={v} label={label} /> : label;
  }
  switch (col.format || col.type) {
    case "date": return formatDate(v);
    case "datetime": return formatDateTime(v);
    case "due": return <DueCell date={v} done={row.status && !["active", "pending", "parked", "upcoming"].includes(row.status)} />;
    case "taskdue": return <DueCell date={v} done={["done", "cancelled"].includes(row.status)} />;
    case "yesno":
    case "checkbox": return v ? "Yes" : "No";
    case "link":
    case "url": return v ? <SafeLink href={v} /> : <span className="text-[#9aa0ad]">—</span>;
    case "money": return formatMoney(v, row.currency || "INR");
    case "bytes": return formatBytes(v);
    case "truncate": return <span className="line-clamp-2 max-w-md">{v || "—"}</span>;
    case "password":
      return v ? (
        <span className="inline-flex items-center gap-1 text-emerald-700"><Lock className="h-3.5 w-3.5" aria-hidden="true" />Stored (vault)</span>
      ) : <span className="text-[#676b7a]">Not stored</span>;
    case "reference":
      return v ? (
        <span className="inline-flex items-center gap-1 text-emerald-700"><Lock className="h-3.5 w-3.5" aria-hidden="true" />Recorded</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-amber-800"><LockOpen className="h-3.5 w-3.5" aria-hidden="true" />Missing</span>
      );
    default:
      if (v === null || v === undefined || v === "") return <span className="text-[#9aa0ad]">—</span>;
      return String(v);
  }
}

/** Plain-text version for exports. */
export function plainValue(col, row) {
  const v = row[col.key ?? col.name];
  if (col.text) return col.text(row);
  if (col.options) return v ? labelOf(col.options, v) : "";
  switch (col.format || col.type) {
    case "date":
    case "due":
    case "taskdue": return v ? String(v).slice(0, 10) : "";
    case "datetime": return v ? formatDateTime(v) : "";
    case "yesno":
    case "checkbox": return v ? "Yes" : "No";
    case "reference": return v ? "Recorded" : "Missing";
    case "password": return v ? "Stored in vault" : "Not stored";
    default: return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

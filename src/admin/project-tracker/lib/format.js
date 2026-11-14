// Date / number formatting for Project Tracker. Pure module (node-testable).
// Date-only values ("YYYY-MM-DD") are treated as calendar dates in the
// viewer's local time zone — never shifted through UTC.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Local calendar date as "YYYY-MM-DD". */
export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function addDaysISO(iso, days) {
  const m = DATE_ONLY.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Whole days from `fromISO` (default today) to `iso`; negative when past. */
export function daysUntil(iso, fromISO = todayISO()) {
  const a = DATE_ONLY.exec(String(iso || "").slice(0, 10));
  const b = DATE_ONLY.exec(fromISO);
  if (!a || !b) return null;
  const t1 = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const t0 = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((t1 - t0) / 86400000);
}

/** "14 Nov 2026" for a date or timestamp; "—" when empty/invalid. */
export function formatDate(value) {
  if (!value) return "—";
  const s = String(value);
  const m = DATE_ONLY.exec(s);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "14 Nov 2026, 09:05" (local time) for a timestamp. */
export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return formatDate(value);
  return `${formatDate(toISODate(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Value for <input type="datetime-local"> from an ISO timestamp (local time). */
export function toDateTimeLocal(value) {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return "";
  return `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO timestamp from a datetime-local value (interpreted as local time). */
export function fromDateTimeLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function relativeDays(iso, fromISO) {
  const n = daysUntil(iso, fromISO);
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function formatBytes(n) {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "—";
  if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(x < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatMoney(amount, currency = "INR") {
  if (amount === null || amount === undefined || amount === "") return "—";
  const v = Number(amount);
  if (!Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

// Display helpers for attendance. All dates/times are shown in India time,
// matching the rules in migration 230 (public.ep_attendance_rules()).
export const TZ = "Asia/Kolkata";

export const RULES_TEXT = [
  "Office hours 9:40 AM – 7:00 PM",
  "Punch in 9:40 – 10:05 AM = on time; after 10:05 AM = Late",
  "Less than 4 hours = Leave",
  "4 hours or more, out before 7:00 PM = Half day",
  "4 hours or more, out at/after 7:00 PM = Present",
  "Not punched out by 8:00 PM = automatic punch out at 8:00 PM",
];

export const STATUS = {
  present: { label: "Present", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  half_day: { label: "Half day", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  leave: { label: "Leave", chip: "bg-red-100 text-red-700", dot: "bg-red-500" },
  working: { label: "Working", chip: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  absent: { label: "Absent", chip: "bg-rose-50 text-rose-700 ring-1 ring-rose-200", dot: "bg-rose-300" },
  on_leave: { label: "Approved leave", chip: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
  holiday: { label: "Holiday", chip: "bg-teal-100 text-teal-800", dot: "bg-teal-500" },
  off: { label: "Sunday", chip: "bg-slate-100 text-slate-500", dot: "bg-slate-300" },
};

export const LATE_CHIP = "bg-orange-100 text-orange-700";
export const AUTO_OUT_CHIP = "bg-violet-100 text-violet-700";

const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" for y, m (1-12), d. */
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Today's date in India as { y, m, d, iso }. */
export function todayIst() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date())
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  return { y, m, d, iso: ymd(y, m, d) };
}

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 0 = Monday … 6 = Sunday, for a calendar date. */
export function weekdayIndex(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function dayName(iso, style = "long") {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { weekday: style, timeZone: "UTC" });
}

export function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function monthTitle(y, m) {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function formatTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: true });
}

/** "21 Nov, 10:00 pm" in India time. */
export function formatDateTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

export function formatHours(minutes) {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${pad(m)}m`;
}

/**
 * Status of every day of a month: the DB row when there is one; otherwise
 * company holiday, Sunday = off, approved leave, a past day on/after
 * `fromIso` = absent, else nothing. `off` = { holidays: Map(iso -> name),
 * leave: Map(iso -> { type, half_day }) } from ep_my_days_off (migration 236).
 */
export function monthDays(y, m, rowsByDate, todayIso, fromIso, off) {
  const out = [];
  for (let d = 1; d <= daysInMonth(y, m); d += 1) {
    const iso = ymd(y, m, d);
    const row = rowsByDate.get(iso) ?? null;
    let status = row?.status ?? null;
    let note = null;
    const holiday = off?.holidays?.get(iso);
    const leave = off?.leave?.get(iso);
    if (holiday) note = holiday;
    else if (leave) note = `${leave.type}${leave.half_day ? " (half day)" : ""}`;
    if (!row) {
      if (holiday) status = "holiday";
      else if (weekdayIndex(iso) === 6) status = "off";
      else if (leave) status = "on_leave";
      else if (iso < todayIso && (!fromIso || iso >= fromIso)) status = "absent";
    }
    out.push({ iso, day: d, row, status, note });
  }
  return out;
}

/** "YYYY-MM-DD" n days before a "YYYY-MM-DD" date. */
export function minusDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** Earliest day a correction can be asked for (30 days back, India time). */
export const correctionMinDate = () => minusDays(todayIst().iso, 30);

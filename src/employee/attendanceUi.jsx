// Shared attendance pieces: status chips, month summary and calendar.
// Used by the employee Attendance page and the admin Attendance Management page.
import {
  AlarmClock,
  CalendarX2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Plane,
  Timer,
  UserX,
} from "lucide-react";
import { Badge } from "@/components/portal/PortalUI";
import {
  STATUS,
  formatDate,
  formatHours,
  weekdayIndex,
  ymd,
} from "./attendanceFormat";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Badge tone per attendance status (falls back to the status' own chip classes). */
const STATUS_TONE = {
  present: "green",
  half_day: "amber",
  leave: "red",
  working: "sky",
  absent: "red",
  on_leave: "violet",
  holiday: "teal",
  off: "slate",
};

export function StatusChip({ status }) {
  const s = STATUS[status];
  if (!s) return null;
  const tone = STATUS_TONE[status];
  if (!tone) {
    return (
      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>
        {s.label}
      </span>
    );
  }
  return (
    <Badge tone={tone} dot>
      {s.label}
    </Badge>
  );
}

export function LateChip() {
  return (
    <Badge tone="orange">
      <AlarmClock className="h-3 w-3" aria-hidden="true" />
      Late
    </Badge>
  );
}

export function AutoOutChip() {
  return (
    <span title="Did not punch out; punched out automatically at 8:00 PM" className="inline-flex">
      <Badge tone="violet">
        <Timer className="h-3 w-3" aria-hidden="true" />
        Auto punch out
      </Badge>
    </span>
  );
}

export function Summary({ days }) {
  const count = (fn) => days.filter(fn).length;
  const items = [
    { label: "Present", value: count((d) => d.status === "present"), color: "#059669", icon: CheckCircle2 },
    { label: "Half day", value: count((d) => d.status === "half_day"), color: "#d97706", icon: CircleDashed },
    { label: "Leave", value: count((d) => d.status === "leave"), color: "#dc2626", icon: CalendarX2 },
    { label: "Absent", value: count((d) => d.status === "absent"), color: "#e11d48", icon: UserX },
    { label: "Approved leave", value: count((d) => d.status === "on_leave"), color: "#7c3aed", icon: Plane },
    { label: "Late", value: count((d) => d.row?.is_late), color: "#ea580c", icon: AlarmClock },
    {
      label: "Hours worked",
      value: formatHours(days.reduce((sum, d) => sum + (d.row?.worked_minutes ?? 0), 0)),
      color: "#1f4693",
      icon: Timer,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div
            key={it.label}
            className="relative min-w-0 overflow-hidden rounded-xl border border-[#e7e9ee] bg-white px-4 pb-3 pt-3.5 shadow-[0_1px_2px_rgba(16,26,58,0.04)]"
          >
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px]" style={{ background: it.color }} />
            <p className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: it.color }} aria-hidden="true" />
              <span className="truncate text-[10px] font-bold uppercase tracking-widest text-[#9aa0ad]">{it.label}</span>
            </p>
            <p className="mt-1.5 text-[22px] font-black leading-none tabular-nums" style={{ color: it.color }}>
              {it.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function Calendar({ year, month, days, todayIso }) {
  const blanks = weekdayIndex(ymd(year, month, 1));
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 rounded-lg bg-[#1f4693] text-center text-[10.5px] font-bold uppercase tracking-[.12em] text-white/90 sm:gap-2">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 sm:gap-2">
        {Array.from({ length: blanks }, (_, i) => (
          <div key={`b${i}`} aria-hidden="true" />
        ))}
        {days.map((d) => {
          const s = STATUS[d.status];
          const isToday = d.iso === todayIso;
          const label = [
            formatDate(d.iso),
            s?.label,
            d.note,
            d.row?.is_late ? "Late" : null,
            d.row ? formatHours(d.row.worked_minutes) : null,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <div
              key={d.iso}
              title={label}
              aria-label={label}
              className={`flex min-h-[3.6rem] min-w-0 flex-col rounded-xl border p-1 text-left transition-colors sm:min-h-[5rem] sm:p-2 ${
                isToday
                  ? "border-[#1f4693] bg-[#f4f7ff] ring-2 ring-[#1f4693]/20"
                  : d.status === "off"
                    ? "border-[#eef0f5] bg-[#f8fafd]"
                    : "border-[#eef0f5] bg-white hover:border-[#dce6f7] hover:bg-[#fafbff]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-5 min-w-[1.25rem] items-center justify-center rounded-full text-xs font-bold tabular-nums sm:h-6 sm:min-w-[1.5rem] sm:text-sm ${
                    isToday ? "bg-gradient-to-br from-[#f7941e] to-[#f96706] px-1 text-white" : "text-[#2b303b]"
                  }`}
                >
                  {d.day}
                </span>
                {d.row?.is_late && <span className="h-2 w-2 rounded-full bg-orange-500" aria-hidden="true" />}
              </div>
              {s && (
                <>
                  <span className={`mt-auto hidden truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold sm:block ${s.chip}`}>
                    {s.label}
                  </span>
                  <span className={`mt-auto h-1.5 w-full rounded-full sm:hidden ${s.dot}`} aria-hidden="true" />
                </>
              )}
              {d.note && !d.row && (
                <span className="mt-0.5 hidden truncate text-[10px] text-[#676b7a] sm:block">{d.note}</span>
              )}
              {d.row && (
                <span className="mt-0.5 hidden text-[10px] font-semibold tabular-nums text-[#676b7a] sm:block">
                  {formatHours(d.row.worked_minutes)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5 text-xs text-[#4a5068]">
        {Object.entries(STATUS).map(([key, s]) => (
          <span key={key} className="inline-flex items-center gap-1.5 rounded-full bg-[#f8fafd] px-2.5 py-1 ring-1 ring-inset ring-[#eef1f7]">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden="true" />
            {s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f8fafd] px-2.5 py-1 ring-1 ring-inset ring-[#eef1f7]">
          <span className="h-2 w-2 rounded-full bg-orange-500" aria-hidden="true" />
          Late
        </span>
      </div>
    </div>
  );
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Choose the month to show: "This month", "Last month", or a year (‹ ›) and a month
 * from the dropdown (months that have not started yet are disabled). view = { y, m }.
 */
export function PeriodPicker({ view, setView, today, minYear = 2024 }) {
  const last = today.m === 1 ? { y: today.y - 1, m: 12 } : { y: today.y, m: today.m - 1 };
  const is = (v) => view.y === v.y && view.m === v.m;
  const pill = (on) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693] ${
      on
        ? "border-transparent bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-sm"
        : "border-[#e3e9f5] bg-[#f8faff] text-[#676b7a] hover:border-[#1f4693]/30 hover:bg-[#eef2fb] hover:text-[#1f4693]"
    }`;
  const arrow =
    "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#e3e9f5] bg-white text-[#4a5068] transition-colors hover:bg-[#f0f4ff] hover:text-[#1f4693] disabled:cursor-not-allowed disabled:opacity-40";
  const setYear = (y) => setView({ y, m: y === today.y ? Math.min(view.m, today.m) : view.m });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={is(today)} onClick={() => setView({ y: today.y, m: today.m })} className={pill(is(today))}>
        This month
      </button>
      <button type="button" aria-pressed={is(last)} onClick={() => setView(last)} className={pill(is(last))}>
        Last month
      </button>
      <span className="mx-0.5 hidden h-5 w-px bg-[#e7e9ee] sm:block" aria-hidden="true" />
      <span className="flex items-center gap-1" role="group" aria-label="Year">
        <button type="button" onClick={() => setYear(view.y - 1)} disabled={view.y <= minYear} className={arrow} aria-label="Previous year">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="w-12 text-center text-sm font-bold tabular-nums text-[#101a3a]">{view.y}</span>
        <button type="button" onClick={() => setYear(view.y + 1)} disabled={view.y >= today.y} className={arrow} aria-label="Next year">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </span>
      <span className="mx-0.5 hidden h-5 w-px bg-[#e7e9ee] sm:block" aria-hidden="true" />
      {/* Month dropdown: an exception to the no-dropdowns rule, asked for by the user (2026-11-23). */}
      <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8a90a0]">
        Month
        <span className="relative">
          <select
            value={view.m}
            onChange={(e) => setView({ y: view.y, m: Number(e.target.value) })}
            aria-label={`Month in ${view.y}`}
            className="cursor-pointer appearance-none rounded-lg border border-[#e3e8f2] bg-white py-1.5 pl-3 pr-8 text-xs font-semibold normal-case tracking-normal text-[#101a3a] outline-none transition-colors hover:bg-[#f8faff] focus:border-[#1f4693] focus:ring-2 focus:ring-[#1f4693]/10"
          >
            {MONTH_NAMES.map((name, i) => {
              const m = i + 1;
              const future = view.y > today.y || (view.y === today.y && m > today.m);
              return (
                <option key={name} value={m} disabled={future}>
                  {name}
                </option>
              );
            })}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#676b7a]"
            aria-hidden="true"
          />
        </span>
      </label>
    </div>
  );
}

// Month calendar of computed attendance days (hr_my_attendance_calendar).
// Used by the Employee Portal (own calendar) and by HR / managers (team
// member calendar). Purely presentational: the server classifies each day.
import { minutesToHm } from "@/lib/hr/client";
import { formatTime } from "@/lib/hr/attendance";
import { AttStatusBadge } from "./common";

const HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CELL_TONE = {
  present: "border-emerald-200 bg-emerald-50/60", late: "border-orange-200 bg-orange-50/60", half_day: "border-orange-200 bg-orange-50/60",
  absent: "border-rose-200 bg-rose-50/60", missing_punch: "border-orange-300 bg-orange-50", on_leave: "border-sky-200 bg-sky-50/60",
  holiday: "border-violet-200 bg-violet-50/60", weekend: "border-slate-200 bg-slate-50", not_started: "border-sky-100 bg-white", upcoming: "border-slate-100 bg-white",
};

export default function AttendanceCalendar({ days = [], tz, onDayClick }) {
  if (!days.length) return null;
  const lead = (new Date(`${days[0].work_date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return (
    <div>
      <div className="hidden grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500 sm:grid" aria-hidden="true">
        {HEAD.map((h) => <div key={h} className="py-1">{h}</div>)}
      </div>
      <ol className="grid grid-cols-1 gap-1 sm:grid-cols-7" aria-label="Attendance calendar">
        {Array.from({ length: lead }).map((_, i) => <li key={`pad${i}`} className="hidden sm:block" aria-hidden="true" />)}
        {days.map((d) => {
          const dt = new Date(`${d.work_date}T00:00:00Z`);
          const label = dt.toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short" });
          const content = (
            <>
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold text-[#101a3a]"><span className="sm:hidden">{label}</span><span className="hidden sm:inline">{dt.getUTCDate()}</span></span>
                <AttStatusBadge status={d.status} />
              </div>
              {d.check_in_at && <p className="mt-1 text-[11px] text-slate-600">{formatTime(d.check_in_at, tz)}–{formatTime(d.check_out_at, tz)}</p>}
              {d.worked_minutes != null && <p className="text-[11px] font-semibold text-slate-700">{minutesToHm(d.worked_minutes)}</p>}
              {d.late_minutes > 0 && <p className="text-[11px] text-orange-700">late {minutesToHm(d.late_minutes)}</p>}
              {d.missing_punch_out && <p className="text-[11px] text-orange-700">no punch-out</p>}
              {d.holiday_name && <p className="truncate text-[11px] text-violet-700" title={d.holiday_name}>{d.holiday_name}</p>}
            </>
          );
          return (
            <li key={d.work_date} className={`min-h-[4.5rem] rounded-lg border p-1.5 ${CELL_TONE[d.status] ?? "border-slate-200"}`}>
              {onDayClick && d.status !== "upcoming"
                ? <button type="button" className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f96706]" onClick={() => onDayClick(d)} aria-label={`${label}: ${d.status.replace(/_/g, " ")}`}>{content}</button>
                : content}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Small totals strip (one week or month). */
export function TotalsStrip({ totals: t = {} }) {
  const items = [
    ["Present", `${t.present_days ?? 0}/${t.working_days ?? 0} days`], ["Worked", minutesToHm(t.worked_minutes ?? 0)], ["Expected", minutesToHm(t.expected_minutes ?? 0)],
    ["Short", minutesToHm(t.short_minutes ?? 0)], ["Overtime", minutesToHm(t.overtime_minutes ?? 0)], ["Late", `${t.late_days ?? 0} (${minutesToHm(t.late_minutes ?? 0)})`],
    ["Absent", t.absent_days ?? 0], ["Leave", t.leave_days ?? 0], ["Holidays", t.holidays ?? 0], ["Weekly offs", t.weekly_offs ?? 0],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-xs text-slate-500">{k}</dt><dd className="font-semibold text-[#101a3a]">{v}</dd></div>
      ))}
    </dl>
  );
}

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { getMyAttendance, getMySessionsByDay, getMyStartDate } from "@/lib/api/employee/attendance";
import { getMyDaysOff } from "@/lib/api/employee/leave";
import {
  AUTO_OUT_CHIP,
  LATE_CHIP,
  RULES_TEXT,
  STATUS,
  dayName,
  daysInMonth,
  formatDate,
  formatHours,
  formatTime,
  monthDays,
  monthTitle,
  todayIst,
  weekdayIndex,
  ymd,
} from "../attendanceFormat";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CARD = "rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-[0_1px_2px_rgba(16,26,58,0.06)] sm:p-5";

function StatusChip({ status }) {
  const s = STATUS[status];
  if (!s) return null;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>{s.label}</span>;
}

function LateChip() {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${LATE_CHIP}`}>Late</span>;
}

function AutoOutChip() {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${AUTO_OUT_CHIP}`}
      title="Did not punch out; punched out automatically at 10:00 PM"
    >
      Auto punch out
    </span>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-[#101a3a] sm:text-base">{value}</p>
    </div>
  );
}

/** Minutes of one session (an open session counts up to now). */
function sessionMinutes(s) {
  const end = s.punch_out_at ? new Date(s.punch_out_at) : new Date();
  return Math.max(0, Math.floor((end - new Date(s.punch_in_at)) / 60_000));
}

/** Every punch in -> punch out of a day, one line each. */
function SessionList({ sessions }) {
  if (!sessions?.length) return null;
  return (
    <ol className="flex flex-col gap-1 text-sm" aria-label="Punch in and punch out times">
      {sessions.map((s, i) => (
        <li key={s.id} className="flex flex-wrap items-center gap-x-2 tabular-nums">
          <span className="w-5 text-right text-xs text-[#9aa0ad]">{i + 1}.</span>
          <span className="font-semibold text-[#101a3a]">{formatTime(s.punch_in_at)}</span>
          <span className="text-[#9aa0ad]" aria-hidden="true">→</span>
          {s.punch_out_at ? (
            <span className="font-semibold text-[#101a3a]">{formatTime(s.punch_out_at)}</span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 text-xs font-semibold text-emerald-700">now</span>
          )}
          <span className="text-xs text-[#676b7a]">({formatHours(sessionMinutes(s))})</span>
          {s.auto_punched_out && <AutoOutChip />}
        </li>
      ))}
    </ol>
  );
}

function TodayCard({ today, row, sessions }) {
  return (
    <section className={CARD} aria-labelledby="ep-today">
      <div className="flex flex-wrap items-center gap-2">
        <Clock className="h-5 w-5 text-[#1f4693]" aria-hidden="true" />
        <h2 id="ep-today" className="text-base font-bold text-[#101a3a]">
          Today
        </h2>
        {row && <StatusChip status={row.status} />}
        {row?.is_late && <LateChip />}
        {row?.auto_out && <AutoOutChip />}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Date" value={formatDate(today.iso)} />
        <Stat label="Day" value={dayName(today.iso)} />
        <Stat label="First punch in" value={formatTime(row?.first_in)} />
        <Stat label="Last punch out" value={row?.is_open ? "—" : formatTime(row?.last_out)} />
        <Stat label="Total hours" value={formatHours(row?.worked_minutes ?? 0)} />
        <Stat label="Punch ins" value={row?.sessions ?? 0} />
      </div>
      {sessions?.length > 0 && (
        <div className="mt-4 border-t border-[#f0f2f6] pt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">Punch in / punch out today</p>
          <SessionList sessions={sessions} />
        </div>
      )}
    </section>
  );
}

function Summary({ days }) {
  const count = (fn) => days.filter(fn).length;
  const items = [
    { label: "Present", value: count((d) => d.status === "present"), color: "text-emerald-700" },
    { label: "Half day", value: count((d) => d.status === "half_day"), color: "text-amber-700" },
    { label: "Leave", value: count((d) => d.status === "leave"), color: "text-red-700" },
    { label: "Absent", value: count((d) => d.status === "absent"), color: "text-rose-700" },
    { label: "Approved leave", value: count((d) => d.status === "on_leave"), color: "text-violet-700" },
    { label: "Late", value: count((d) => d.row?.is_late), color: "text-orange-700" },
    {
      label: "Hours worked",
      value: formatHours(days.reduce((sum, d) => sum + (d.row?.worked_minutes ?? 0), 0)),
      color: "text-[#1f4693]",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {items.map((it) => (
        <div key={it.label} className="rounded-xl border border-[#e7e9ee] bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">{it.label}</p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${it.color}`}>{it.value}</p>
        </div>
      ))}
    </div>
  );
}

function Calendar({ year, month, days, todayIso }) {
  const blanks = weekdayIndex(ymd(year, month, 1));
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad] sm:gap-2">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1 sm:gap-2">
        {Array.from({ length: blanks }, (_, i) => (
          <div key={`b${i}`} aria-hidden="true" />
        ))}
        {days.map((d) => {
          const s = STATUS[d.status];
          const isToday = d.iso === todayIso;
          const label = [formatDate(d.iso), s?.label, d.note, d.row?.is_late ? "Late" : null, d.row ? formatHours(d.row.worked_minutes) : null]
            .filter(Boolean)
            .join(", ");
          return (
            <div
              key={d.iso}
              title={label}
              aria-label={label}
              className={`flex min-h-[3.6rem] flex-col rounded-lg border p-1 text-left sm:min-h-[5rem] sm:p-2 ${
                isToday ? "border-[#1f4693] ring-2 ring-[#1f4693]/20" : "border-[#eef0f5]"
              } ${d.status === "off" ? "bg-slate-50" : "bg-white"}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold sm:text-sm ${isToday ? "text-[#1f4693]" : "text-[#2b303b]"}`}>{d.day}</span>
                {d.row?.is_late && <span className="h-2 w-2 rounded-full bg-orange-500" aria-hidden="true" />}
              </div>
              {s && (
                <>
                  <span className={`mt-auto hidden truncate rounded px-1 py-0.5 text-[10px] font-semibold sm:block ${s.chip}`}>
                    {s.label}
                  </span>
                  <span className={`mt-auto h-1.5 w-full rounded-full sm:hidden ${s.dot}`} aria-hidden="true" />
                </>
              )}
              {d.note && !d.row && (
                <span className="mt-0.5 hidden truncate text-[10px] text-[#676b7a] sm:block">{d.note}</span>
              )}
              {d.row && (
                <span className="mt-0.5 hidden text-[10px] tabular-nums text-[#676b7a] sm:block">
                  {formatHours(d.row.worked_minutes)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[#676b7a]">
        {Object.entries(STATUS).map(([key, s]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} aria-hidden="true" />
            {s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500" aria-hidden="true" />
          Late
        </span>
      </div>
    </div>
  );
}

function History({ days, sessionsByDay }) {
  const rows = days
    .filter((d) => d.row || ["absent", "on_leave", "holiday"].includes(d.status))
    .slice()
    .reverse();
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-[#676b7a]">No attendance in this month yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-[#eef0f5] text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">
            <th className="py-2 pr-3">Date</th>
            <th className="py-2 pr-3">Day</th>
            <th className="py-2 pr-3">Punch in</th>
            <th className="py-2 pr-3">Punch out</th>
            <th className="py-2 pr-3">Total hours</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.iso} className="border-b border-[#f3f4f8] last:border-0">
              <td className="py-2.5 pr-3 font-medium text-[#101a3a]">{formatDate(d.iso)}</td>
              <td className="py-2.5 pr-3 text-[#676b7a]">{dayName(d.iso)}</td>
              {(() => {
                const list = sessionsByDay?.get(d.iso);
                if (!list?.length) {
                  return (
                    <>
                      <td className="py-2.5 pr-3 tabular-nums">{formatTime(d.row?.first_in)}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{d.row?.is_open ? "—" : formatTime(d.row?.last_out)}</td>
                    </>
                  );
                }
                return (
                  <>
                    <td className="py-2.5 pr-3 align-top tabular-nums">
                      {list.map((s) => (
                        <span key={s.id} className="block leading-6">{formatTime(s.punch_in_at)}</span>
                      ))}
                    </td>
                    <td className="py-2.5 pr-3 align-top tabular-nums">
                      {list.map((s) => (
                        <span key={s.id} className="block leading-6">
                          {s.punch_out_at ? formatTime(s.punch_out_at) : <span className="text-xs font-semibold text-emerald-700">now</span>}
                          {s.auto_punched_out && <span className="ml-1 text-[11px] text-violet-700">(auto)</span>}
                        </span>
                      ))}
                    </td>
                  </>
                );
              })()}
              <td className="py-2.5 pr-3 tabular-nums">{d.row ? formatHours(d.row.worked_minutes) : "—"}</td>
              <td className="py-2.5">
                <span className="flex flex-wrap gap-1">
                  <StatusChip status={d.status} />
                  {d.row?.is_late && <LateChip />}
                  {d.row?.auto_out && <AutoOutChip />}
                  {d.note && <span className="text-xs text-[#676b7a]">{d.note}</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AttendancePage({ me }) {
  const today = useMemo(() => todayIst(), []);
  const [view, setView] = useState({ y: today.y, m: today.m });
  const [rows, setRows] = useState(null);
  const [startIso, setStartIso] = useState(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  // While punched in, refresh once a minute so "Total hours" keeps counting.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    getMyStartDate(me.employee_id).then((iso) => active && setStartIso(iso));
    return () => {
      active = false;
    };
  }, [me.employee_id]);

  useEffect(() => {
    let active = true;
    getMyAttendance(ymd(view.y, view.m, 1), ymd(view.y, view.m, daysInMonth(view.y, view.m)))
      .then((data) => {
        if (!active) return;
        setRows(data);
        setError("");
      })
      .catch(() => active && setError("Could not load attendance. Please try again."));
    return () => {
      active = false;
    };
  }, [view, tick]);

  // Every punch in / punch out of the month shown, and of today (for the Today card).
  const [sessionsByDay, setSessionsByDay] = useState(null);
  useEffect(() => {
    let active = true;
    getMySessionsByDay(me.employee_id, ymd(view.y, view.m, 1), ymd(view.y, view.m, daysInMonth(view.y, view.m)))
      .then((m) => active && setSessionsByDay(m))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [me.employee_id, view, tick]);
  const [todaySessions, setTodaySessions] = useState(null);
  useEffect(() => {
    let active = true;
    getMySessionsByDay(me.employee_id, today.iso, today.iso)
      .then((m) => active && setTodaySessions(m.get(today.iso) ?? []))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [me.employee_id, today.iso, tick]);

  // Holidays and approved leave of the month (so those days are not "Absent").
  const [daysOff, setDaysOff] = useState(null);
  useEffect(() => {
    let active = true;
    getMyDaysOff(ymd(view.y, view.m, 1), ymd(view.y, view.m, daysInMonth(view.y, view.m)))
      .then((d) => active && setDaysOff(d))
      .catch(() => active && setDaysOff(null));
    return () => {
      active = false;
    };
  }, [view]);

  // Today's row is shown even when another month is being viewed.
  const [todayRow, setTodayRow] = useState(null);
  useEffect(() => {
    let active = true;
    getMyAttendance(today.iso, today.iso)
      .then((data) => active && setTodayRow(data[0] ?? null))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [today.iso, tick]);

  const byDate = useMemo(() => new Map((rows ?? []).map((r) => [r.work_date, r])), [rows]);
  const days = useMemo(
    () => monthDays(view.y, view.m, byDate, today.iso, startIso, daysOff),
    [view, byDate, today.iso, startIso, daysOff],
  );

  const isCurrentMonth = view.y === today.y && view.m === today.m;
  const shift = (delta) =>
    setView(({ y, m }) => {
      const idx = y * 12 + (m - 1) + delta;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <TodayCard today={today} row={todayRow} sessions={todaySessions} />

      <section className={CARD} aria-labelledby="ep-month">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="ep-month" className="flex-1 text-base font-bold text-[#101a3a]">
            {monthTitle(view.y, view.m)}
          </h2>
          <button
            type="button"
            onClick={() => shift(-1)}
            className="rounded-lg border border-[#e7e9ee] p-2 text-[#2b303b] hover:bg-[#f6f7fb]"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setView({ y: today.y, m: today.m })}
            disabled={isCurrentMonth}
            className="rounded-lg border border-[#e7e9ee] px-3 py-1.5 text-sm font-semibold text-[#2b303b] hover:bg-[#f6f7fb] disabled:opacity-50"
          >
            This month
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            disabled={isCurrentMonth}
            className="rounded-lg border border-[#e7e9ee] p-2 text-[#2b303b] hover:bg-[#f6f7fb] disabled:opacity-50"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4">
          <Summary days={days} />
        </div>

        <div className="mt-5">
          <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Monthly calendar</h3>
          {rows === null && !error ? (
            <p className="py-6 text-center text-sm text-[#676b7a]">Loading…</p>
          ) : (
            <Calendar year={view.y} month={view.m} days={days} todayIso={today.iso} />
          )}
        </div>
      </section>

      <section className={CARD} aria-labelledby="ep-history">
        <h2 id="ep-history" className="text-base font-bold text-[#101a3a]">
          Attendance history — {monthTitle(view.y, view.m)}
        </h2>
        <div className="mt-3">{rows === null && !error ? <p className="py-6 text-center text-sm text-[#676b7a]">Loading…</p> : <History days={days} sessionsByDay={sessionsByDay} />}</div>
      </section>

      <section className="rounded-2xl border border-dashed border-[#dce1ec] bg-white/60 p-4 text-xs text-[#676b7a]">
        <p className="mb-1.5 font-semibold uppercase tracking-wider text-[#9aa0ad]">Attendance rules</p>
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {RULES_TEXT.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, History as HistoryIcon, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { getMyAttendance, getMySessionsByDay, getMyStartDate } from "@/lib/api/employee/attendance";
import { getMyDaysOff } from "@/lib/api/employee/leave";
import { Alert, Badge, Detail, Empty, Panel } from "@/components/portal/PortalUI";
import { BTN_SECONDARY, TABLE, TD, TH_STICKY, TR } from "@/components/portal/portalStyles";
import { AutoOutChip, Calendar, LateChip, PeriodPicker, StatusChip, Summary } from "../attendanceUi";
import CorrectionsCard from "../CorrectionsCard";
import { useAccess } from "@/lib/access";
import {
  RULES_TEXT,
  dayName,
  daysInMonth,
  formatDate,
  formatHours,
  formatTime,
  correctionMinDate,
  monthDays,
  monthTitle,
  todayIst,
  ymd,
} from "../attendanceFormat";

/** Table cell, top-aligned (rows can hold several punch times). */
const TDT = TD.replace("align-middle", "align-top");
const NAV_BTN =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#dce6f7] bg-white text-[#1f4693] transition-colors hover:bg-[#f0f4ff] disabled:cursor-not-allowed disabled:opacity-50";

function Loading() {
  return (
    <p className="flex items-center justify-center gap-2 py-8 text-sm text-[#676b7a]">
      <Loader2 className="h-4 w-4 animate-spin text-[#1f4693]" aria-hidden="true" />
      Loading…
    </p>
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
    <ol className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Punch in and punch out times">
      {sessions.map((s, i) => (
        <li
          key={s.id}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-[#f8fafd] px-3 py-2 tabular-nums ring-1 ring-inset ring-[#eef1f7]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef2fb] text-[11px] font-bold text-[#1f4693]">
            {i + 1}
          </span>
          <span className="font-semibold text-[#101a3a]">{formatTime(s.punch_in_at)}</span>
          <span className="text-[#9aa0ad]" aria-hidden="true">
            →
          </span>
          {s.punch_out_at ? (
            <span className="font-semibold text-[#101a3a]">{formatTime(s.punch_out_at)}</span>
          ) : (
            <Badge tone="green" dot>
              now
            </Badge>
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
    <Panel
      icon={Clock}
      title="Today"
      subtitle={`${dayName(today.iso)}, ${formatDate(today.iso)}`}
      action={
        row && (
          <>
            <StatusChip status={row.status} />
            {row.is_late && <LateChip />}
            {row.auto_out && <AutoOutChip />}
          </>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Detail label="Date">{formatDate(today.iso)}</Detail>
        <Detail label="Day">{dayName(today.iso)}</Detail>
        <Detail label="First punch in">{formatTime(row?.first_in)}</Detail>
        <Detail label="Last punch out">{row?.is_open ? "—" : formatTime(row?.last_out)}</Detail>
        <Detail label="Total hours">{formatHours(row?.worked_minutes ?? 0)}</Detail>
        <Detail label="Punch ins">{row?.sessions ?? 0}</Detail>
      </dl>
      {sessions?.length > 0 && (
        <div className="mt-5 border-t border-[#eef0f4] pt-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#8a90a0]">Punch in / punch out today</p>
          <SessionList sessions={sessions} />
        </div>
      )}
    </Panel>
  );
}

function History({ days, sessionsByDay, todayIso, onCorrect }) {
  const { can } = useAccess();
  const minIso = correctionMinDate();
  const rows = days
    .filter((d) => d.row || ["absent", "on_leave", "holiday"].includes(d.status))
    .slice()
    .reverse();
  if (rows.length === 0) {
    return <Empty icon={HistoryIcon} title="No attendance in this month yet." />;
  }
  return (
    <div className="max-h-[26rem] overflow-auto">
      <table className={`${TABLE} min-w-[700px]`}>
        <thead>
          <tr>
            <th className={TH_STICKY}>Date</th>
            <th className={TH_STICKY}>Day</th>
            <th className={TH_STICKY}>Punch in</th>
            <th className={TH_STICKY}>Punch out</th>
            <th className={TH_STICKY}>Total hours</th>
            <th className={TH_STICKY}>Status</th>
            <th className={TH_STICKY}>
              <span className="sr-only">Correction</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.iso} className={TR}>
              <td className={`${TDT} whitespace-nowrap font-semibold text-[#101a3a]`}>{formatDate(d.iso)}</td>
              <td className={TDT}>{dayName(d.iso)}</td>
              {(() => {
                const list = sessionsByDay?.get(d.iso);
                if (!list?.length) {
                  return (
                    <>
                      <td className={`${TDT} tabular-nums`}>{formatTime(d.row?.first_in)}</td>
                      <td className={`${TDT} tabular-nums`}>{d.row?.is_open ? "—" : formatTime(d.row?.last_out)}</td>
                    </>
                  );
                }
                return (
                  <>
                    <td className={`${TDT} tabular-nums`}>
                      {list.map((s) => (
                        <span key={s.id} className="block leading-6">
                          {formatTime(s.punch_in_at)}
                        </span>
                      ))}
                    </td>
                    <td className={`${TDT} tabular-nums`}>
                      {list.map((s) => (
                        <span key={s.id} className="block leading-6">
                          {s.punch_out_at ? formatTime(s.punch_out_at) : <span className="text-xs font-semibold text-emerald-700">now</span>}
                          {s.auto_punched_out && <span className="ml-1 text-[11px] font-semibold text-violet-700">(auto)</span>}
                        </span>
                      ))}
                    </td>
                  </>
                );
              })()}
              <td className={`${TDT} font-semibold tabular-nums text-[#101a3a]`}>{d.row ? formatHours(d.row.worked_minutes) : "—"}</td>
              <td className={TDT}>
                <span className="flex flex-wrap items-center gap-1">
                  <StatusChip status={d.status} />
                  {d.row?.is_late && <LateChip />}
                  {d.row?.auto_out && <AutoOutChip />}
                  {d.note && <span className="text-xs text-[#676b7a]">{d.note}</span>}
                </span>
              </td>
              <td className={`${TDT} text-right`}>
                {can("emp.attendance.edit") && d.iso >= minIso && d.iso <= todayIso && (d.row || d.status === "absent") && (
                  <button
                    type="button"
                    onClick={() => onCorrect(d.iso)}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[#dce6f7] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4693] transition-colors hover:bg-[#f0f4ff]"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    Correct
                  </button>
                )}
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

  // "Correct" in the history opens the correction form for that day.
  const [correctFor, setCorrectFor] = useState(null);
  const openCorrection = (iso) => {
    setCorrectFor(`${iso}#${Date.now()}`);
    setTimeout(() => document.getElementById("ep-corrections")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const isCurrentMonth = view.y === today.y && view.m === today.m;
  const shift = (delta) =>
    setView(({ y, m }) => {
      const idx = y * 12 + (m - 1) + delta;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <TodayCard today={today} row={todayRow} sessions={todaySessions} />

      <Panel
        icon={CalendarDays}
        title={monthTitle(view.y, view.m)}
        subtitle="Monthly summary and calendar"
        action={
          <>
            <button type="button" onClick={() => shift(-1)} className={NAV_BTN} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setView({ y: today.y, m: today.m })}
              disabled={isCurrentMonth}
              className={`${BTN_SECONDARY} !px-3 !py-1.5`}
            >
              This month
            </button>
            <button type="button" onClick={() => shift(1)} disabled={isCurrentMonth} className={NAV_BTN} aria-label="Next month">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        }
      >
        <Alert kind="err" className="mb-4">
          {error}
        </Alert>

        <Summary days={days} />

        <div className="mt-6">
          <h3 className="mb-3 text-sm font-bold text-[#101a3a]">Monthly calendar</h3>
          {rows === null && !error ? <Loading /> : <Calendar year={view.y} month={view.m} days={days} todayIso={today.iso} />}
        </div>
      </Panel>

      <Panel
        icon={HistoryIcon}
        title={`Attendance history — ${monthTitle(view.y, view.m)}`}
        subtitle="Every punch in and punch out of the month"
        action={<PeriodPicker view={view} setView={setView} today={today} />}
        flush
      >
        {rows === null && !error ? (
          <Loading />
        ) : (
          <History days={days} sessionsByDay={sessionsByDay} todayIso={today.iso} onCorrect={openCorrection} />
        )}
      </Panel>

      <CorrectionsCard employeeId={me.employee_id} openFor={correctFor} onChanged={() => setTick((t) => t + 1)} />

      <section
        aria-labelledby="ep-rules"
        className="rounded-2xl border border-dashed border-[#dce1ec] bg-gradient-to-br from-white to-[#f8fafd] p-5 text-xs text-[#4a5068]"
      >
        <p id="ep-rules" className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[#8a90a0]">
          <ShieldCheck className="h-4 w-4 text-[#1f4693]" aria-hidden="true" />
          Attendance rules
        </p>
        <ul className="grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {RULES_TEXT.map((r) => (
            <li key={r} className="flex gap-2 leading-relaxed">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#f96706]" aria-hidden="true" />
              {r}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

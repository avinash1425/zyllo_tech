import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import {
  Activity,
  AlarmClock,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleX,
  ClipboardList,
  ExternalLink,
  History,
  Info,
  LogOut,
  Palmtree,
  Users,
  X,
} from "lucide-react";
import PageHeader from "../PageHeader";
import { daysOffFor, getAttendance } from "@/lib/api/admin/attendanceLeave";
import { CORRECTION_STATUS, decideCorrection, getAllCorrections, toHm } from "@/lib/api/employee/corrections";
import {
  RULES_TEXT,
  dayName,
  daysInMonth,
  formatDate,
  formatDateTime,
  formatHours,
  formatTime,
  monthDays,
  monthTitle,
  todayIst,
  ymd,
} from "@/employee/attendanceFormat";
import { AutoOutChip, LateChip, PeriodPicker, StatusChip, Summary } from "@/employee/attendanceUi";
import { Alert, Avatar, Badge, Chips, Empty, MetricStrip, Panel, TableCard, Tabs } from "@/components/portal/PortalUI";
import {
  BTN_DANGER,
  BTN_DANGER_SOFT,
  BTN_NAVY,
  BTN_SECONDARY,
  INPUT,
  INPUT_INLINE,
  LABEL,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TH_STICKY,
  TR,
} from "@/components/portal/portalStyles";

const TABS = [
  { key: "daily", label: "Daily view", icon: CalendarDays },
  { key: "employee", label: "Employee calendar", icon: Users },
  { key: "late", label: "Late arrivals", icon: AlarmClock },
  { key: "missing", label: "Missing check-outs", icon: LogOut },
  { key: "corrections", label: "Correction requests", icon: ClipboardList },
];
const LATE_AFTER_MIN = 9 * 60 + 40; // 09:40, same as ep_attendance_rules()
const STATUS_TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "slate" };

/** Bordered square arrow button used by the month / day navigators. */
const NAV_BTN =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#e3e9f5] bg-white text-[#4a5068] transition-colors hover:bg-[#f0f4ff] hover:text-[#1f4693] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693]";

const CorrectedChip = () => (
  <Badge tone="sky" className="cursor-help">
    <span title="Changed by an approved correction">Corrected</span>
  </Badge>
);

function Sessions({ list }) {
  if (!list?.length) return <span className="text-[#b0b8cc]">—</span>;
  return (
    <span className="flex flex-col tabular-nums">
      {list.map((s) => (
        <span key={s.id} className="whitespace-nowrap leading-6 text-[#2b303b]">
          {formatTime(s.punch_in_at)} <span className="text-[#9aa0ad]">→</span>{" "}
          {s.punch_out_at ? formatTime(s.punch_out_at) : <span className="text-xs font-semibold text-emerald-700">now</span>}
          {s.auto_punched_out && <span className="ml-1 text-[11px] font-semibold text-violet-700">(auto)</span>}
        </span>
      ))}
    </span>
  );
}

function StatusCell({ x }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {x?.status ? <StatusChip status={x.status} /> : <span className="text-xs text-[#b0b8cc]">—</span>}
      {x?.row?.is_late && <LateChip />}
      {x?.row?.auto_out && <AutoOutChip />}
      {x?.row?.corrected && <CorrectedChip />}
      {x?.note && <span className="text-xs text-[#676b7a]">{x.note}</span>}
    </span>
  );
}

function Hint({ children }) {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-[#676b7a]">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1f4693]/60" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function EmployeeCell({ e }) {
  return (
    <span className="flex items-center gap-2.5">
      <Avatar name={e?.full_name} size="h-8 w-8 text-xs" />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-[#101a3a]">{e?.full_name}</span>
        <span className="block font-mono text-[11px] text-[#9aa0ad]">{e?.employee_code}</span>
      </span>
    </span>
  );
}

function MonthNav({ view, setView, today }) {
  const isCurrent = view.y === today.y && view.m === today.m;
  const shift = (delta) =>
    setView(({ y, m }) => {
      const idx = y * 12 + (m - 1) + delta;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-xl border border-[#e3e9f5] bg-white p-1 shadow-sm">
        <button type="button" onClick={() => shift(-1)} className={`${NAV_BTN} h-8 w-8 border-transparent`} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="flex min-w-[9rem] items-center justify-center gap-1.5 text-center text-sm font-bold text-[#101a3a]" aria-live="polite">
          <CalendarDays className="h-4 w-4 text-[#f96706]" aria-hidden="true" />
          {monthTitle(view.y, view.m)}
        </span>
        <button
          type="button"
          onClick={() => shift(1)}
          disabled={isCurrent}
          className={`${NAV_BTN} h-8 w-8 border-transparent`}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {!isCurrent && (
        <button type="button" onClick={() => setView({ y: today.y, m: today.m })} className={`${BTN_SECONDARY} px-3 py-1.5 text-xs`}>
          This month
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- daily view
function DailyView({ model, view, today }) {
  const lastDay = view.y === today.y && view.m === today.m ? today.d : daysInMonth(view.y, view.m);
  const [day, setDay] = useState(lastDay);
  const d = Math.min(day, lastDay);
  const iso = ymd(view.y, view.m, d);

  const list = model.employees
    .map((e) => ({ e, day: model.monthByEmp.get(e.id)?.[d - 1] }))
    .filter((x) => x.e.is_active || x.day?.row);
  const count = (fn) => list.filter(fn).length;
  const stats = [
    { key: "present", label: "Present", value: count((x) => x.day?.status === "present"), icon: CircleCheck, color: "#059669", valueColor: "#047857" },
    { key: "half", label: "Half day", value: count((x) => x.day?.status === "half_day"), icon: CircleDot, color: "#d97706", valueColor: "#b45309" },
    { key: "working", label: "Working now", value: count((x) => x.day?.status === "working"), icon: Activity, color: "#0284c7", valueColor: "#0369a1" },
    { key: "absent", label: "Absent", value: count((x) => x.day?.status === "absent"), icon: CircleX, color: "#e11d48", valueColor: "#be123c" },
    { key: "leave", label: "Approved leave", value: count((x) => x.day?.status === "on_leave"), icon: Palmtree, color: "#7c3aed", valueColor: "#6d28d9" },
    { key: "late", label: "Late", value: count((x) => x.day?.row?.is_late), icon: AlarmClock, color: "#f96706", valueColor: "#c2410c" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <MetricStrip items={stats} />
      <TableCard
        title={`${dayName(iso)}, ${formatDate(iso)}`}
        count={list.length}
        actions={
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => setDay(Math.max(1, d - 1))} disabled={d <= 1} className={NAV_BTN} aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <input
              type="date"
              value={iso}
              min={ymd(view.y, view.m, 1)}
              max={ymd(view.y, view.m, lastDay)}
              onChange={(ev) => ev.target.value && setDay(Number(ev.target.value.slice(8, 10)))}
              aria-label="Day"
              className={`${INPUT_INLINE(false)} w-auto py-2`}
            />
            <button type="button" onClick={() => setDay(Math.min(lastDay, d + 1))} disabled={d >= lastDay} className={NAV_BTN} aria-label="Next day">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        }
      >
        {list.length === 0 ? (
          <Empty icon={Users} title="No employees yet" />
        ) : (
          <div className={TABLE_WRAP}>
            <table className={`${TABLE} min-w-[720px]`}>
              <thead>
                <tr>
                  <th className={TH}>Employee</th>
                  <th className={TH}>Check in → check out</th>
                  <th className={TH}>Total hours</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map(({ e, day: x }) => (
                  <tr key={e.id} className={TR}>
                    <td className={TD}>
                      <EmployeeCell e={e} />
                    </td>
                    <td className={`${TD} align-top`}>
                      <Sessions list={model.sessions.get(`${e.id}|${iso}`)} />
                    </td>
                    <td className={`${TD} font-semibold tabular-nums text-[#101a3a]`}>{x?.row ? formatHours(x.row.worked_minutes) : "—"}</td>
                    <td className={TD}>
                      <StatusCell x={x} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>
    </div>
  );
}

// ---------------------------------------------------------------- one employee
function EmployeeView({ model, view, setView, today }) {
  const people = model.employees.filter((e) => e.is_active || model.monthByEmp.get(e.id)?.some((x) => x.row));
  const [picked, setPicked] = useState(null);
  const emp = people.find((e) => e.id === picked) ?? people[0];
  if (!emp) {
    return (
      <Panel>
        <Empty icon={Users} title="No employees yet." />
      </Panel>
    );
  }
  const days = model.monthByEmp.get(emp.id) ?? [];
  const history = days.filter((x) => x.row || ["absent", "on_leave", "holiday"].includes(x.status)).slice().reverse();

  return (
    <div className="flex flex-col gap-5">
      <Panel icon={Users} title="Employee" subtitle="Pick whose attendance to see.">
        <Chips items={people.map((e) => ({ key: e.id, label: e.full_name }))} value={emp.id} onChange={setPicked} label="Employee" />
      </Panel>
      <Panel
        icon={CalendarCheck}
        title={`${emp.full_name} — ${monthTitle(view.y, view.m)}`}
        subtitle={emp.employee_code}
        action={
          <Link href={`/admin/employees/${emp.id}`} className={`${BTN_SECONDARY} px-3 py-1.5 text-xs`}>
            Open profile <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      >
        <Summary days={days} />
      </Panel>
      <TableCard
        title={`Attendance history — ${monthTitle(view.y, view.m)}`}
        count={history.length}
        actions={<PeriodPicker view={view} setView={setView} today={today} />}
      >
        {history.length === 0 ? (
          <Empty icon={History} title="No attendance in this month." />
        ) : (
          <div className="max-h-[26rem] overflow-auto">
            <table className={`${TABLE} min-w-[640px]`}>
              <thead>
                <tr>
                  <th className={TH_STICKY}>Date</th>
                  <th className={TH_STICKY}>Check in → check out</th>
                  <th className={TH_STICKY}>Total hours</th>
                  <th className={TH_STICKY}>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((x) => (
                  <tr key={x.iso} className={TR}>
                    <td className={TD}>
                      <span className="block whitespace-nowrap font-semibold text-[#101a3a]">{formatDate(x.iso)}</span>
                      <span className="text-xs text-[#9aa0ad]">{dayName(x.iso)}</span>
                    </td>
                    <td className={TD}>
                      <Sessions list={model.sessions.get(`${emp.id}|${x.iso}`)} />
                    </td>
                    <td className={`${TD} font-semibold tabular-nums text-[#101a3a]`}>{x.row ? formatHours(x.row.worked_minutes) : "—"}</td>
                    <td className={TD}>
                      <StatusCell x={x} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>
    </div>
  );
}

// ---------------------------------------------------------------- late / missing
function LateView({ model }) {
  const rows = model.rows.filter((r) => r.is_late).sort((a, b) => b.work_date.localeCompare(a.work_date));
  return (
    <TableCard title="Late arrivals" count={rows.length} filters={<Hint>First punch in of the day after 9:40 AM.</Hint>}>
      {rows.length === 0 ? (
        <Empty icon={AlarmClock} title="No late arrivals this month." />
      ) : (
        <div className={TABLE_WRAP}>
          <table className={`${TABLE} min-w-[640px]`}>
            <thead>
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Employee</th>
                <th className={TH}>Punched in</th>
                <th className={TH}>Late by</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const e = model.empById.get(r.employee_id);
                const [h, m] = toHm(r.first_in).split(":").map(Number);
                const lateBy = h * 60 + m - LATE_AFTER_MIN;
                return (
                  <tr key={`${r.employee_id}|${r.work_date}`} className={TR}>
                    <td className={TD}>
                      <span className="block whitespace-nowrap font-semibold text-[#101a3a]">{formatDate(r.work_date)}</span>
                      <span className="text-xs text-[#9aa0ad]">{dayName(r.work_date)}</span>
                    </td>
                    <td className={TD}>
                      <EmployeeCell e={e} />
                    </td>
                    <td className={`${TD} tabular-nums`}>In at {formatTime(r.first_in)}</td>
                    <td className={TD}>
                      <Badge tone="orange" dot>
                        Late by {formatHours(lateBy)}
                      </Badge>
                    </td>
                    <td className={TD}>
                      <StatusChip status={r.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}

function MissingView({ model, today }) {
  const list = model.allSessions
    .filter((s) => (s.auto_punched_out && !s.corrected_at) || (!s.punch_out_at && s.work_date < today.iso))
    .sort((a, b) => b.punch_in_at.localeCompare(a.punch_in_at));
  return (
    <TableCard
      title="Missing check-outs"
      count={list.length}
      filters={
        <Hint>
          Sessions where the employee did not punch out and was punched out automatically at 8:00 PM. They can ask for a
          correction with the real time; it appears under Correction requests.
        </Hint>
      }
    >
      {list.length === 0 ? (
        <Empty icon={LogOut} title="No missing check-outs this month." />
      ) : (
        <div className={TABLE_WRAP}>
          <table className={`${TABLE} min-w-[600px]`}>
            <thead>
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Employee</th>
                <th className={TH}>Punched in</th>
                <th className={TH}>Check out</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={TR}>
                  <td className={TD}>
                    <span className="block whitespace-nowrap font-semibold text-[#101a3a]">{formatDate(s.work_date)}</span>
                    <span className="text-xs text-[#9aa0ad]">{dayName(s.work_date)}</span>
                  </td>
                  <td className={TD}>
                    <EmployeeCell e={model.empById.get(s.employee_id)} />
                  </td>
                  <td className={`${TD} tabular-nums`}>In at {formatTime(s.punch_in_at)}</td>
                  <td className={TD}>
                    {s.punch_out_at ? (
                      <Badge tone="violet">Auto out {formatTime(s.punch_out_at)}</Badge>
                    ) : (
                      <Badge tone="red" dot>
                        Still open
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}

// ---------------------------------------------------------------- corrections
const CORR_FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

function CorrectionItem({ c, onDone }) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const st = CORRECTION_STATUS[c.status];
  const times = (i, o) => `${i ? formatTime(i) : "—"} → ${o ? formatTime(o) : "—"}`;

  async function decide(action) {
    if (action === "rejected" && !comment.trim()) return setError("Write a reason for rejecting.");
    setBusy(true);
    setError("");
    const r = await decideCorrection(c.id, action, comment);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onDone();
  }

  return (
    <li className="px-5 py-4 transition-colors hover:bg-[#fafbff]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Avatar name={c.employee?.full_name} />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-[#101a3a]">
            {c.employee?.full_name} <span className="font-mono text-[11px] font-normal text-[#9aa0ad]">{c.employee?.employee_code}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[#2b303b]">
            <span className="font-medium">{formatDate(c.work_date)}</span>
            <Badge tone={c.kind === "add" ? "teal" : "blue"}>{c.kind === "add" ? "Add a missing session" : "Fix punch times"}</Badge>
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs tabular-nums">
            {c.kind === "fix" && (
              <span className="rounded-lg bg-[#f6f7fb] px-2.5 py-1 text-[#676b7a] ring-1 ring-inset ring-[#eef0f4]">
                Now: {times(c.old_in, c.old_out)}
              </span>
            )}
            <span className="rounded-lg bg-[#eef2fb] px-2.5 py-1 font-semibold text-[#1f4693] ring-1 ring-inset ring-[#1f4693]/15">
              Asked: {times(c.requested_in ?? c.old_in, c.requested_out ?? c.old_out)}
            </span>
          </div>
          <p className="mt-2 border-l-2 border-[#f7941e]/50 pl-2.5 text-xs italic text-[#2b303b]">“{c.reason}”</p>
          <p className="mt-1.5 text-[11px] text-[#9aa0ad]">Requested {formatDateTime(c.created_at)}</p>
          {c.decision_comment && <p className="mt-0.5 text-xs text-[#676b7a]">Comment: {c.decision_comment}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Badge tone={STATUS_TONE[c.status] ?? "slate"} dot>
            {st?.label}
          </Badge>
          {c.status === "pending" && !rejecting && (
            <>
              <button type="button" disabled={busy} onClick={() => decide("approved")} className={`${BTN_NAVY} px-3 py-1.5`}>
                <Check className="h-4 w-4" aria-hidden="true" />
                {busy ? "Saving…" : "Approve"}
              </button>
              <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={`${BTN_DANGER_SOFT} px-3 py-1.5`}>
                <X className="h-4 w-4" aria-hidden="true" />
                Reject
              </button>
            </>
          )}
        </div>
      </div>
      {rejecting && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-red-100 bg-red-50/70 p-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className={`${LABEL} text-red-800`}>Reason for rejecting</span>
            <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} className={INPUT(!!error)} />
          </label>
          <button type="button" disabled={busy} onClick={() => decide("rejected")} className={BTN_DANGER}>
            {busy ? "Saving…" : "Reject"}
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(false)} className={BTN_SECONDARY}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <Alert kind="err" className="mt-2 py-2 text-xs">
          {error}
        </Alert>
      )}
    </li>
  );
}

function CorrectionsView({ onChanged }) {
  const [filter, setFilter] = useState("pending");
  const [list, setList] = useState(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    getAllCorrections(filter)
      .then((d) => active && setList(d))
      .catch(() => active && setList([]));
    return () => {
      active = false;
    };
  }, [filter, reload]);

  return (
    <Panel
      flush
      icon={ClipboardList}
      title="Attendance correction requests"
      subtitle="Employees ask from their Attendance page. Approving changes their punch times (or adds the missing session) and updates hours and status at once. They are notified either way."
    >
      <div className="border-b border-[#eef1f7] bg-[#fafbff] px-5 py-3">
        <Chips
          items={CORR_FILTERS}
          value={filter}
          onChange={(k) => {
            setList(null);
            setFilter(k);
          }}
          label="Filter requests"
        />
      </div>
      {list === null ? (
        <p className="px-5 py-8 text-center text-sm text-[#676b7a]" role="status">
          Loading…
        </p>
      ) : list.length === 0 ? (
        <Empty icon={ClipboardList} title="No requests here." />
      ) : (
        <ul className="divide-y divide-[#eef1f7]">
          {list.map((c) => (
            <CorrectionItem
              key={c.id}
              c={c}
              onDone={() => {
                setReload((n) => n + 1);
                onChanged();
              }}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Admin: Attendance Management — check-in/out times, total hours, calendars,
 * late arrivals, missing check-outs and correction requests. Migration 242.
 */
export default function AttendanceAdminPage() {
  const today = useMemo(() => todayIst(), []);
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "daily";
  const [view, setView] = useState({ y: today.y, m: today.m });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    getAttendance(ymd(view.y, view.m, 1), ymd(view.y, view.m, daysInMonth(view.y, view.m)))
      .then((d) => {
        if (!active) return;
        setData(d);
        setError("");
      })
      .catch(() => active && setError("Could not load attendance. Please refresh the page."));
    return () => {
      active = false;
    };
  }, [view, reload]);

  const model = useMemo(() => {
    if (!data) return null;
    const employees = data.employees ?? [];
    const rows = data.rows ?? [];
    const allSessions = data.sessions ?? [];
    const empById = new Map(employees.map((e) => [e.id, e]));
    const sessions = new Map();
    for (const s of allSessions) {
      const k = `${s.employee_id}|${s.work_date}`;
      if (!sessions.has(k)) sessions.set(k, []);
      sessions.get(k).push(s);
    }
    const monthByEmp = new Map(
      employees.map((e) => {
        const byDate = new Map(rows.filter((r) => r.employee_id === e.id).map((r) => [r.work_date, r]));
        return [e.id, monthDays(view.y, view.m, byDate, today.iso, e.start_date, daysOffFor(data, e.id))];
      }),
    );
    return { employees, rows, allSessions, empById, sessions, monthByEmp };
  }, [data, view, today.iso]);

  const pending = data?.pending_corrections ?? 0;
  const tabItems = TABS.map((t) => (t.key === "corrections" && pending > 0 ? { ...t, count: pending, alert: true } : t));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance Management"
        icon={CalendarCheck}
        subtitle="Check-in / check-out times, total working hours, attendance calendars, late arrivals, missing check-outs and correction requests of all employees."
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          items={tabItems}
          value={tab}
          onChange={(k) => setParams(k === "daily" ? {} : { tab: k }, { replace: true })}
          label="Attendance views"
        />
        {tab !== "corrections" && tab !== "employee" && <MonthNav view={view} setView={setView} today={today} />}
      </div>

      <Alert kind="err">{error}</Alert>
      {tab === "corrections" ? (
        <CorrectionsView onChanged={() => setReload((n) => n + 1)} />
      ) : !model ? (
        !error && (
          <p className="text-sm text-[#676b7a]" role="status">
            Loading attendance…
          </p>
        )
      ) : tab === "employee" ? (
        <EmployeeView model={model} view={view} setView={setView} today={today} />
      ) : tab === "late" ? (
        <LateView model={model} />
      ) : tab === "missing" ? (
        <MissingView model={model} today={today} />
      ) : (
        <DailyView key={`${view.y}-${view.m}`} model={model} view={view} today={today} />
      )}

      <section className="rounded-2xl border border-dashed border-[#dce1ec] bg-gradient-to-br from-white to-[#f8faff] p-5 text-xs text-[#676b7a]">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#8a90a0]">
          <Info className="h-3.5 w-3.5 text-[#f96706]" aria-hidden="true" />
          Attendance rules
        </p>
        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {RULES_TEXT.map((r) => (
            <li key={r} className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#1f4693]/50" aria-hidden="true" />
              {r}
            </li>
          ))}
          <li className="flex gap-1.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#1f4693]/50" aria-hidden="true" />
            Approved leave and company holidays are not counted as absent
          </li>
        </ul>
      </section>
    </div>
  );
}

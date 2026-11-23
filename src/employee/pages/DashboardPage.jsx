// Employee Portal: Dashboard — a calm, at-a-glance overview.
// Top: Today (check-in / check-out / hours), today's work report, leave
// balance, attendance this month. Below: assigned projects, my open tasks,
// recent notifications. Everything comes from existing RPCs (+ 238).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Link from "@/lib/nx/link";
import { Bell, CalendarCheck, ClipboardList, Clock, FolderKanban, ListTodo, Plane } from "lucide-react";
import { getMyAttendance, getMySessions, getMyStartDate } from "@/lib/api/employee/attendance";
import { getMyReport } from "@/lib/api/employee/reports";
import { getLeaveOverview, getMyDaysOff } from "@/lib/api/employee/leave";
import { TASK_STATUS, getMyOpenTasks, getMyProjects } from "@/lib/api/employee/projects";
import { KINDS, getMyNotifications, markRead, timeAgo } from "@/lib/api/employee/notifications";
import { TZ, daysInMonth, dayName, formatDate, formatHours, formatTime, monthDays, monthTitle, todayIst, ymd } from "../attendanceFormat";
import { CARD, DeadlineText, ProgressBar, StatusChip } from "../projectsUi";
import { ReportStatusChip } from "../reportsUi";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const num = (v) => Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const Loading = () => <p className="text-sm text-[#9aa0ad]">Loading…</p>;
const Label = ({ children }) => <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">{children}</p>;

/** Small status card: icon + label, content, one link at the bottom. */
function StatCard({ icon: Icon, label, children, href, action }) {
  return (
    <section className={`${CARD} flex flex-col`}>
      <div className="flex items-center gap-2 text-xs font-semibold text-[#4a5880]">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f0f4ff] text-[#1f4693]">
          <Icon size={15} aria-hidden="true" />
        </span>
        {label}
      </div>
      <div className="mt-3 flex-1">{children}</div>
      {href && (
        <Link href={href} className="mt-3 text-xs font-semibold text-[#1f4693] hover:underline">
          {action} →
        </Link>
      )}
    </section>
  );
}

/** List panel with a title and a "View all" link. */
function Panel({ icon: Icon, title, href, children }) {
  return (
    <section className={`${CARD} flex flex-col`}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-5 w-5 text-[#1f4693]" aria-hidden="true" />
        <h3 className="flex-1 text-base font-bold text-[#101a3a]">{title}</h3>
        <Link href={href} className="text-xs font-semibold text-[#1f4693] hover:underline">
          View all
        </Link>
      </div>
      {children}
    </section>
  );
}

export default function DashboardPage({ me, onNotificationsChanged }) {
  const navigate = useNavigate();
  const today = todayIst();
  const [todayRow, setTodayRow] = useState(undefined); // today's attendance (null = none)
  const [sessions, setSessions] = useState(undefined); // every punch in / out today
  const [tick, setTick] = useState(0);
  const [month, setMonth] = useState(undefined); // { rows, off, startIso }
  const [report, setReport] = useState(undefined);
  const [leave, setLeave] = useState(undefined);
  const [projects, setProjects] = useState(undefined);
  const [tasks, setTasks] = useState(undefined);
  const [notes, setNotes] = useState(undefined);

  // Hours keep counting: refresh today's attendance once a minute.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    getMyAttendance(today.iso, today.iso)
      .then((r) => setTodayRow(r[0] ?? null))
      .catch(() => setTodayRow(null));
    getMySessions(me.employee_id, today.iso)
      .then(setSessions)
      .catch(() => setSessions(null));
  }, [today.iso, tick, me.employee_id]);

  // Each part loads on its own, so one failure does not blank the page.
  useEffect(() => {
    const from = ymd(today.y, today.m, 1);
    const to = ymd(today.y, today.m, daysInMonth(today.y, today.m));
    Promise.all([getMyAttendance(from, to), getMyDaysOff(from, to).catch(() => null), getMyStartDate(me.employee_id)])
      .then(([rows, off, startIso]) => setMonth({ rows, off, startIso }))
      .catch(() => setMonth(null));
    getMyReport(today.iso).then((d) => setReport(d?.report ?? null)).catch(() => setReport(null));
    getLeaveOverview(today.y).then(setLeave).catch(() => setLeave(null));
    getMyProjects().then(setProjects).catch(() => setProjects(null));
    getMyOpenTasks(5).then(setTasks).catch(() => setTasks(null));
    getMyNotifications("all")
      .then((d) => setNotes(d.items.slice(0, 4)))
      .catch(() => setNotes(null));
  }, [today.iso, today.y, today.m, me.employee_id]);

  // Same day rules as the Attendance page (monthDays), counted up to today.
  const monthStats = useMemo(() => {
    if (!month) return null;
    const byDate = new Map(month.rows.map((r) => [r.work_date, r]));
    const days = monthDays(today.y, today.m, byDate, today.iso, month.startIso, month.off).filter((d) => d.iso <= today.iso);
    const count = (s) => days.filter((d) => d.status === s).length;
    return {
      present: count("present"),
      half: count("half_day"),
      leave: count("leave"),
      absent: count("absent"),
      onLeave: count("on_leave"),
      late: days.filter((d) => d.row?.is_late).length,
      minutes: days.reduce((s, d) => s + (d.row?.worked_minutes ?? 0), 0),
    };
  }, [month, today.y, today.m, today.iso]);

  const firstName = (me.full_name ?? "").split(" ")[0];
  const paid = (leave?.balances ?? []).filter((b) => b.is_paid && b.allowed != null);
  const pendingLeave = (leave?.requests ?? []).filter((r) => r.status === "pending").length;
  const nextHoliday = (leave?.holidays ?? []).find((h) => h.date >= today.iso);
  const statusLabel = (s) => TASK_STATUS.find((t) => t.value === s)?.label ?? s;
  // Minutes of one session (open session counts up to now).
  const sessionMinutes = (s) =>
    Math.max(0, Math.floor(((s.punch_out_at ? new Date(s.punch_out_at) : new Date()) - new Date(s.punch_in_at)) / 60_000));
  const SHOW = 4; // newest sessions shown on the card; the rest are summed up
  const shownSessions = (sessions ?? []).slice(-SHOW);
  const hiddenCount = (sessions?.length ?? 0) - shownSessions.length;

  async function openNote(n) {
    if (!n.read_at) {
      await markRead([n.id]).catch(() => {});
      onNotificationsChanged?.();
    }
    navigate(n.link || "/employee/notifications");
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-[#101a3a]">
          {greeting()}, {firstName}
        </h2>
        <p className="mt-0.5 text-sm text-[#676b7a]">
          {dayName(today.iso)}, {formatDate(today.iso)}
        </p>
      </div>

      {/* ---------------------------------------------------------- top cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Clock} label="Today" href="/employee/attendance" action="Attendance">
          <div className="flex items-baseline justify-between gap-2">
            <Label>Check-ins today</Label>
            <span className="text-base font-bold tabular-nums text-[#101a3a]">{sessions?.length ?? "…"}</span>
          </div>
          {sessions && sessions.length > 0 && (
            <ol className="mt-1.5 space-y-1 text-[13px]" aria-label="Punch in and punch out times today">
              {hiddenCount > 0 && <li className="text-xs text-[#9aa0ad]">+ {hiddenCount} earlier</li>}
              {shownSessions.map((s, i) => (
                <li key={s.id} className="flex items-center gap-1.5 tabular-nums">
                  <span className="w-4 text-right text-[11px] text-[#9aa0ad]">{hiddenCount + i + 1}.</span>
                  <span className="font-semibold text-[#101a3a]">{formatTime(s.punch_in_at)}</span>
                  <span className="text-[#9aa0ad]" aria-hidden="true">→</span>
                  {s.punch_out_at ? (
                    <span className="font-semibold text-[#101a3a]">{formatTime(s.punch_out_at)}</span>
                  ) : (
                    <span className="rounded-full bg-emerald-50 px-1.5 text-[11px] font-semibold text-emerald-700">now</span>
                  )}
                  <span className="ml-auto text-xs text-[#676b7a]">{formatHours(sessionMinutes(s))}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 border-t border-[#f0f2f6] pt-2 text-sm text-[#2b303b]">
            Total <b className="tabular-nums">{todayRow === undefined ? "…" : formatHours(todayRow?.worked_minutes ?? 0)}</b>
            {todayRow?.is_late && (
              <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">Late</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-[#9aa0ad]">Still checked in · auto check-out at 10:00 PM</p>
        </StatCard>

        <StatCard
          icon={ClipboardList}
          label="Today's work report"
          href="/employee/reports"
          action={!report || ["draft", "returned"].includes(report.status) ? "Write report" : "View report"}
        >
          {report === undefined ? (
            <Loading />
          ) : report ? (
            <>
              <ReportStatusChip status={report.status} />
              <p className="mt-2 text-sm text-[#2b303b]">
                {num(report.total_hours)} h on {report.items.length} project(s)
              </p>
            </>
          ) : (
            <p className="text-sm text-[#676b7a]">Not started yet</p>
          )}
        </StatCard>

        <StatCard icon={Plane} label={`Leave balance ${today.y}`} href="/employee/leave" action="Apply for leave">
          {leave === undefined ? (
            <Loading />
          ) : (
            <>
              <ul className="space-y-0.5 text-sm">
                {paid.map((b) => (
                  <li key={b.code} className="flex justify-between gap-2">
                    <span className="text-[#676b7a]">{b.name}</span>
                    <span className="font-semibold tabular-nums text-[#101a3a]">
                      {num(Number(b.allowed) - Number(b.approved) - Number(b.pending))} / {num(b.allowed)}
                    </span>
                  </li>
                ))}
              </ul>
              {pendingLeave > 0 && <p className="mt-1 text-xs text-amber-700">{pendingLeave} request(s) pending</p>}
              {nextHoliday && (
                <p className="mt-1 text-xs text-[#676b7a]">
                  Next holiday: {nextHoliday.name}, {formatDate(nextHoliday.date).replace(/ \d{4}$/, "")}
                </p>
              )}
            </>
          )}
        </StatCard>

        <StatCard icon={CalendarCheck} label={`Attendance · ${monthTitle(today.y, today.m)}`} href="/employee/attendance" action="Full calendar">
          {month === undefined ? (
            <Loading />
          ) : !monthStats ? (
            <p className="text-sm text-[#676b7a]">Could not load.</p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                {[
                  ["Present", monthStats.present, "text-emerald-700"],
                  ["Half day", monthStats.half, "text-amber-700"],
                  ["Absent", monthStats.absent, "text-rose-700"],
                  ["Late", monthStats.late, "text-orange-700"],
                  ["Leave (<4h)", monthStats.leave, "text-red-700"],
                  ["On leave", monthStats.onLeave, "text-violet-700"],
                ].map(([label, value, color]) => (
                  <li key={label} className="flex justify-between">
                    <span className="text-[#676b7a]">{label}</span>
                    <span className={`font-bold tabular-nums ${color}`}>{value}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-[#676b7a]">{formatHours(monthStats.minutes)} worked this month</p>
            </>
          )}
        </StatCard>
      </div>

      {/* ---------------------------------------------------------- lists */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel icon={FolderKanban} title="Assigned projects" href="/employee/projects">
          {projects === undefined ? (
            <Loading />
          ) : !projects || projects.length === 0 ? (
            <p className="py-2 text-sm text-[#676b7a]">You are not on any project yet.</p>
          ) : (
            <ul className="divide-y divide-[#f0f2f6]">
              {projects.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <Link href={`/employee/projects/${p.id}`} className="block rounded-lg px-1 py-2.5 hover:bg-[#f6f7fb]">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#101a3a]">{p.name}</span>
                      <StatusChip value={p.status} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[#9aa0ad]">
                      {p.my_role ?? p.project_code}
                      {p.my_open_tasks > 0 ? ` · ${p.my_open_tasks} open task(s)` : ""}
                    </span>
                    <span className="mt-1.5 block">
                      <ProgressBar value={p.progress} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={ListTodo} title="My open tasks" href="/employee/projects">
          {tasks === undefined ? (
            <Loading />
          ) : !tasks || tasks.items.length === 0 ? (
            <p className="py-2 text-sm text-[#676b7a]">No open tasks assigned to you.</p>
          ) : (
            <ul className="divide-y divide-[#f0f2f6]">
              {tasks.items.map((t) => (
                <li key={t.id}>
                  <Link href={`/employee/projects/${t.project_id}`} className="block rounded-lg px-1 py-2.5 hover:bg-[#f6f7fb]">
                    <span className="block truncate text-sm font-semibold text-[#101a3a]">{t.title}</span>
                    <span className="mt-0.5 flex flex-wrap justify-between gap-x-2 text-xs">
                      <span className="truncate text-[#9aa0ad]">
                        {t.project_name} · {statusLabel(t.status)}
                      </span>
                      <DeadlineText iso={t.due_date} done={false} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {tasks?.total > (tasks?.items.length ?? 0) && (
            <p className="mt-1 text-xs text-[#9aa0ad]">
              Showing {tasks.items.length} of {tasks.total}
            </p>
          )}
        </Panel>

        <Panel icon={Bell} title="Recent notifications" href="/employee/notifications">
          {notes === undefined ? (
            <Loading />
          ) : !notes || notes.length === 0 ? (
            <p className="py-2 text-sm text-[#676b7a]">No notifications yet.</p>
          ) : (
            <ul className="divide-y divide-[#f0f2f6]">
              {notes.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => openNote(n)} className="flex w-full gap-2 rounded-lg px-1 py-2.5 text-left hover:bg-[#f6f7fb]">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        n.read_at ? "bg-transparent" : n.priority === "urgent" ? "bg-red-500" : "bg-[#1f4693]"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${n.read_at ? "text-[#2b303b]" : "font-semibold text-[#101a3a]"}`}>
                        {n.title}
                        {!n.read_at && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="text-xs text-[#9aa0ad]">
                        {KINDS[n.kind]?.label ?? n.kind} · {timeAgo(n.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

// Employee Portal: Dashboard — a calm, at-a-glance overview.
// Top: greeting banner + KPI cards (hours today, today's work report,
// attendance this month, leave left). Then Today / Attendance / Leave panels,
// then assigned projects, my open tasks, recent notifications.
// Everything comes from existing RPCs (+ 238).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Link from "@/lib/nx/link";
import { ArrowRight, Bell, CalendarCheck, ClipboardList, Clock, FolderKanban, ListTodo, Plane } from "lucide-react";
import { getMyAttendance, getMySessions, getMyStartDate } from "@/lib/api/employee/attendance";
import { REPORT_STATUS, getMyReport } from "@/lib/api/employee/reports";
import { getLeaveOverview, getMyDaysOff } from "@/lib/api/employee/leave";
import { TASK_STATUS, getMyOpenTasks, getMyProjects } from "@/lib/api/employee/projects";
import { KINDS, getMyNotifications, markRead, timeAgo } from "@/lib/api/employee/notifications";
import { Badge, Empty, Hero, KpiCard, Panel, Progress } from "@/components/portal/PortalUI";
import { TZ, daysInMonth, dayName, formatDate, formatHours, formatTime, monthDays, monthTitle, todayIst, ymd } from "../attendanceFormat";
import { DeadlineText, ProgressBar, StatusChip } from "../projectsUi";
import { ReportStatusChip } from "../reportsUi";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const num = (v) => Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const Loading = () => <p className="py-2 text-sm text-[#9aa0ad]">Loading…</p>;

/** Small "View all →" link for panel headers. */
function ViewLink({ href, children = "View all" }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#1f4693] transition-colors hover:bg-[#f0f4ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
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
  const remaining = (b) => Number(b.allowed) - Number(b.approved) - Number(b.pending);
  const paidLeft = paid.reduce((s, b) => s + remaining(b), 0);
  const pendingLeave = (leave?.requests ?? []).filter((r) => ["manager_review", "pending", "manager_pending"].includes(r.status)).length;
  const nextHoliday = (leave?.holidays ?? []).find((h) => h.date >= today.iso);
  const holidayText = nextHoliday && `Next holiday: ${nextHoliday.name}, ${formatDate(nextHoliday.date).replace(/ \d{4}$/, "")}`;
  const statusLabel = (s) => TASK_STATUS.find((t) => t.value === s)?.label ?? s;
  // Minutes of one session (open session counts up to now).
  const sessionMinutes = (s) =>
    Math.max(0, Math.floor(((s.punch_out_at ? new Date(s.punch_out_at) : new Date()) - new Date(s.punch_in_at)) / 60_000));
  const SHOW = 4; // newest sessions shown on the card; the rest are summed up
  const shownSessions = (sessions ?? []).slice(-SHOW);
  const hiddenCount = (sessions?.length ?? 0) - shownSessions.length;
  const reportAction = !report || ["draft", "returned"].includes(report.status) ? "Write report" : "View report";
  const workedToday = todayRow === undefined ? "…" : formatHours(todayRow?.worked_minutes ?? 0);

  async function openNote(n) {
    if (!n.read_at) {
      await markRead([n.id]).catch(() => {});
      onNotificationsChanged?.();
    }
    navigate(n.link || "/employee/notifications");
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      {/* ---------------------------------------------------------- greeting */}
      <Hero
        eyebrow={`${dayName(today.iso)}, ${formatDate(today.iso)}`}
        title={`${greeting()}, ${firstName}`}
        subtitle="Here is your day at a glance"
      />

      {/* ---------------------------------------------------------- KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Clock}
          accent="teal"
          label="Worked today"
          display={workedToday}
          chip={todayRow?.is_late ? "Late" : undefined}
          hint="Auto check-out at 8:00 PM"
          href="/employee/attendance"
        />
        <KpiCard
          icon={ClipboardList}
          accent="orange"
          label="Today's work report"
          display={report === undefined ? "…" : report ? `${num(report.total_hours)} h` : "—"}
          chip={report ? REPORT_STATUS[report.status]?.label : undefined}
          hint={report ? `On ${report.items.length} project(s) · ${reportAction}` : report === null ? `Not started yet · ${reportAction}` : undefined}
          href="/employee/reports"
        />
        <KpiCard
          icon={CalendarCheck}
          accent="green"
          label={`Present · ${monthTitle(today.y, today.m)}`}
          display={month === undefined ? "…" : monthStats ? String(monthStats.present) : "—"}
          hint={monthStats ? `${formatHours(monthStats.minutes)} worked this month` : month === null ? "Could not load." : undefined}
          href="/employee/attendance"
        />
        <KpiCard
          icon={Plane}
          accent="violet"
          label={`Paid leave left ${today.y}`}
          display={leave === undefined ? "…" : leave ? num(paidLeft) : "—"}
          chip={pendingLeave > 0 ? `${pendingLeave} pending` : undefined}
          hint={holidayText}
          href="/employee/leave"
        />
      </div>

      {/* ---------------------------------------------------------- today / month / leave */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel icon={Clock} title="Today" subtitle="Punch in and punch out" action={<ViewLink href="/employee/attendance">Attendance</ViewLink>}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#9aa0ad]">Check-ins today</span>
            <span className="text-base font-bold tabular-nums text-[#101a3a]">{sessions?.length ?? "…"}</span>
          </div>
          {sessions && sessions.length > 0 && (
            <ol className="mt-2 space-y-1.5 text-[13px]" aria-label="Punch in and punch out times today">
              {hiddenCount > 0 && <li className="text-xs text-[#9aa0ad]">+ {hiddenCount} earlier</li>}
              {shownSessions.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2 rounded-lg bg-[#f8fafd] px-2.5 py-1.5 tabular-nums ring-1 ring-inset ring-[#eef1f7]">
                  <span className="w-4 text-right text-[11px] text-[#9aa0ad]">{hiddenCount + i + 1}.</span>
                  <span className="font-semibold text-[#101a3a]">{formatTime(s.punch_in_at)}</span>
                  <span className="text-[#9aa0ad]" aria-hidden="true">→</span>
                  {s.punch_out_at ? (
                    <span className="font-semibold text-[#101a3a]">{formatTime(s.punch_out_at)}</span>
                  ) : (
                    <Badge tone="green" dot>
                      now
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-[#676b7a]">{formatHours(sessionMinutes(s))}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 flex items-center gap-2 border-t border-[#f0f2f6] pt-3 text-sm text-[#2b303b]">
            Total <b className="tabular-nums">{workedToday}</b>
            {todayRow?.is_late && <Badge tone="orange">Late</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-[#9aa0ad]">Still checked in · auto check-out at 8:00 PM</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#f0f2f6] pt-3 text-xs text-[#676b7a]">
            <span className="font-semibold text-[#4a5068]">Work report:</span>
            {report === undefined ? "…" : report ? <ReportStatusChip status={report.status} /> : "Not started yet"}
            <span className="ml-auto">
              <ViewLink href="/employee/reports">{reportAction}</ViewLink>
            </span>
          </div>
        </Panel>

        <Panel
          icon={CalendarCheck}
          title="Attendance"
          subtitle={monthTitle(today.y, today.m)}
          action={<ViewLink href="/employee/attendance">Full calendar</ViewLink>}
        >
          {month === undefined ? (
            <Loading />
          ) : !monthStats ? (
            <p className="text-sm text-[#676b7a]">Could not load.</p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                {[
                  ["Present", monthStats.present, "text-emerald-700"],
                  ["Half day", monthStats.half, "text-amber-700"],
                  ["Absent", monthStats.absent, "text-rose-700"],
                  ["Late", monthStats.late, "text-orange-700"],
                  ["Leave (<4h)", monthStats.leave, "text-red-700"],
                  ["On leave", monthStats.onLeave, "text-violet-700"],
                ].map(([label, value, color]) => (
                  <li key={label} className="rounded-xl bg-[#f8fafd] px-3 py-2.5 ring-1 ring-inset ring-[#eef1f7]">
                    <span className={`block text-xl font-extrabold leading-none tabular-nums ${color}`}>{value}</span>
                    <span className="mt-1 block truncate text-[11px] font-semibold text-[#676b7a]">{label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-[#676b7a]">{formatHours(monthStats.minutes)} worked this month</p>
            </>
          )}
        </Panel>

        <Panel icon={Plane} title={`Leave balance ${today.y}`} subtitle="Left / allowed" action={<ViewLink href="/employee/leave">Apply for leave</ViewLink>}>
          {leave === undefined ? (
            <Loading />
          ) : (
            <>
              <ul className="space-y-3 text-sm">
                {paid.map((b) => (
                  <li key={b.code}>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#676b7a]">{b.name}</span>
                      <span className="font-semibold tabular-nums text-[#101a3a]">
                        {num(remaining(b))} / {num(b.allowed)}
                      </span>
                    </div>
                    <Progress
                      className="mt-1"
                      label={false}
                      value={Number(b.allowed) > 0 ? (remaining(b) / Number(b.allowed)) * 100 : 0}
                    />
                  </li>
                ))}
              </ul>
              {pendingLeave > 0 && (
                <p className="mt-3">
                  <Badge tone="amber" dot>
                    {pendingLeave} request(s) pending
                  </Badge>
                </p>
              )}
              {holidayText && <p className="mt-2 text-xs text-[#676b7a]">{holidayText}</p>}
            </>
          )}
        </Panel>
      </div>

      {/* ---------------------------------------------------------- lists */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel icon={FolderKanban} title="Assigned projects" action={<ViewLink href="/employee/projects" />} flush>
          {projects === undefined ? (
            <div className="px-5 py-3">
              <Loading />
            </div>
          ) : !projects || projects.length === 0 ? (
            <Empty icon={FolderKanban} message="You are not on any project yet." className="py-8" />
          ) : (
            <ul className="divide-y divide-[#f0f2f6] p-2">
              {projects.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <Link href={`/employee/projects/${p.id}`} className="block rounded-xl px-3 py-3 transition-colors hover:bg-[#f6f8fd]">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#101a3a]">{p.name}</span>
                      <StatusChip value={p.status} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[#9aa0ad]">
                      {p.my_role ?? p.project_code}
                      {p.my_open_tasks > 0 ? ` · ${p.my_open_tasks} open task(s)` : ""}
                    </span>
                    <span className="mt-2 block">
                      <ProgressBar value={p.progress} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={ListTodo} title="My open tasks" action={<ViewLink href="/employee/projects" />} flush>
          {tasks === undefined ? (
            <div className="px-5 py-3">
              <Loading />
            </div>
          ) : !tasks || tasks.items.length === 0 ? (
            <Empty icon={ListTodo} message="No open tasks assigned to you." className="py-8" />
          ) : (
            <ul className="divide-y divide-[#f0f2f6] p-2">
              {tasks.items.map((t) => (
                <li key={t.id}>
                  <Link href={`/employee/projects/${t.project_id}`} className="block rounded-xl px-3 py-3 transition-colors hover:bg-[#f6f8fd]">
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
            <p className="border-t border-[#f0f2f6] px-5 py-2.5 text-xs text-[#9aa0ad]">
              Showing {tasks.items.length} of {tasks.total}
            </p>
          )}
        </Panel>

        <Panel icon={Bell} title="Recent notifications" action={<ViewLink href="/employee/notifications" />} flush>
          {notes === undefined ? (
            <div className="px-5 py-3">
              <Loading />
            </div>
          ) : !notes || notes.length === 0 ? (
            <Empty icon={Bell} message="No notifications yet." className="py-8" />
          ) : (
            <ul className="divide-y divide-[#f0f2f6] p-2">
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openNote(n)}
                    className="flex w-full gap-2.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[#f6f8fd] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]"
                  >
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

// Employee Portal — My Dashboard.
// Seven blocks, each loading independently from the employee's own records
// (RLS restricts every query to the caller): attendance status, working
// hours, leave balance, assigned tasks, announcements, pending requests and
// upcoming holidays. While onboarding is open, a Joining checklist card is
// shown above them.
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarCheck, CalendarDays, Clock, HeartHandshake, KanbanSquare, Megaphone, Timer } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, from, minutesToHm, rpc, run, useHrQuery } from "@/lib/hr/client";
import { addDays, businessToday, getCalendar, getHolidayCalendar, getMyToday, useBusinessTimezone } from "@/lib/hr/attendance";
import { listMyTasks } from "@/lib/hr/dailyReports";
import { myLifecycle } from "@/lib/hr/lifecycle";
import { JoiningChecklistCard } from "@/employee/components/OnboardingParts";
import { listMyRequests as listMyLeaveRequests } from "@/lib/hr/leave";
import { ACTIVE_REQUEST_STATUSES, listMyRequests as listMyHrRequests } from "@/lib/hr/requests";
import { Badge, Button, Card, EmptyState, ErrorState, KpiCard, Loading, PageHeader, StatusBadge } from "@/hr/ui";

const PRIORITY_TONE = { low: "slate", medium: "blue", high: "orange", urgent: "red" };
const CATEGORY_TONE = { general: "slate", policy: "blue", holiday: "green", event: "violet", urgent: "red" };
const HOLIDAY_WINDOW_DAYS = 90;

function Block({ title, icon: Icon, to, query, empty, children }) {
  const navigate = useNavigate();
  let body;
  if (query.loading && query.data == null) body = <Loading />;
  else if (query.error) body = <ErrorState message={query.error} onRetry={query.reload} />;
  else if (empty) body = <EmptyState title={empty} />;
  else body = children;
  return (
    <Card
      title={<span className="flex items-center gap-2">{Icon && <Icon className="h-4 w-4 text-[#f96706]" aria-hidden="true" />}{title}</span>}
      actions={to && <Button size="sm" variant="ghost" onClick={() => navigate(to)}>View all</Button>}>
      {body}
    </Card>
  );
}

function attendanceLabel(t) {
  if (!t) return "—";
  if (t.checked_out) return "Checked out";
  if (t.checked_in) return "Checked in";
  if (t.shift?.is_working_day === false) return "Day off";
  return "Not checked in";
}

export default function EmployeeDashboardPage() {
  const navigate = useNavigate();
  const { hr } = useAuth();
  const me = hr?.employee;
  const tz = useBusinessTimezone();
  const todayIso = businessToday(tz);

  const today = useHrQuery(() => getMyToday(), []);
  const calendar = useHrQuery(() => getCalendar(todayIso.slice(0, 7)), [todayIso]);
  const balances = useHrQuery(() => rpc("hr_my_leave_balances", {}), []);
  const tasks = useHrQuery(() => listMyTasks(me?.id), [me?.id]);
  const announcements = useHrQuery(() => run(from("hr_announcements")
    .select("id, title, category, published_at, expires_at, requires_acknowledgement")
    .eq("status", "published").order("published_at", { ascending: false }).limit(20)), []);
  const leaveReqs = useHrQuery(() => listMyLeaveRequests(me?.id), [me?.id]);
  const hrReqs = useHrQuery(() => listMyHrRequests(me?.id), [me?.id]);
  const lifecycle = useHrQuery(() => myLifecycle(), []);
  const holidays = useHrQuery(() => getHolidayCalendar({ from: todayIso, to: addDays(todayIso, HOLIDAY_WINDOW_DAYS) }), [todayIso]);

  const t = today.data;
  const week = useMemo(() => (calendar.data?.weeks ?? []).find((w) => w.from <= todayIso && todayIso <= w.to), [calendar.data, todayIso]);
  const monthTotals = calendar.data?.totals;

  const openTasks = useMemo(() => (tasks.data ?? []).filter((x) => x.status !== "done"), [tasks.data]);
  const overdueTasks = openTasks.filter((x) => x.due_date && x.due_date < todayIso).length;

  const liveAnnouncements = useMemo(() => {
    const now = Date.now();
    return (announcements.data ?? []).filter((a) => !a.expires_at || new Date(a.expires_at).getTime() > now).slice(0, 5);
  }, [announcements.data]);

  const pending = useMemo(() => {
    const leave = (leaveReqs.data ?? []).filter((r) => r.status === "pending_approval").map((r) => ({
      key: `leave-${r.id}`, kind: "Leave", title: `${r.leave_type?.name ?? "Leave"} · ${formatDate(r.start_date, { day: "2-digit", month: "short" })}${r.end_date !== r.start_date ? ` – ${formatDate(r.end_date, { day: "2-digit", month: "short" })}` : ""}`,
      status: r.status, at: r.created_at, to: "/employee/leave",
    }));
    const other = (hrReqs.data ?? []).filter((r) => ACTIVE_REQUEST_STATUSES.includes(r.status)).map((r) => ({
      key: `req-${r.id}`, kind: "HR request", title: r.subject, status: r.status, at: r.created_at, to: "/employee/requests",
    }));
    return [...leave, ...other].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [leaveReqs.data, hrReqs.data]);
  const pendingQuery = {
    loading: leaveReqs.loading || hrReqs.loading,
    data: leaveReqs.data && hrReqs.data ? pending : null,
    error: leaveReqs.error || hrReqs.error,
    reload: () => { leaveReqs.reload(); hrReqs.reload(); },
  };

  const totalAvailable = (balances.data ?? []).reduce((s, b) => s + Number(b.available ?? 0), 0);
  const upcomingHolidays = (holidays.data ?? []).slice(0, 5);

  return (
    <>
      <PageHeader
        title={`Welcome, ${me?.display_name ?? ""}`}
        description={<span className="flex items-center gap-2"><span className="font-mono font-bold text-[#1f4693]">{me?.employee_code}</span><StatusBadge status={me?.status} /><span className="text-slate-500">· {formatDate(todayIso, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</span></span>}
      />

      {/* At a glance */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Attendance today" value={attendanceLabel(t)} icon={Clock} tone="orange" loading={today.loading && !t} onClick={() => navigate("/employee/attendance")} />
        <KpiCard label="Hours today" value={minutesToHm(t?.record?.worked_minutes ?? 0)} hint={week ? `This week ${minutesToHm(week.totals?.worked_minutes ?? 0)}` : undefined} icon={Timer} tone="teal" loading={today.loading && !t} />
        <KpiCard label="Leave available" value={balances.data ? `${totalAvailable} days` : undefined} icon={CalendarCheck} tone="green" loading={balances.loading && !balances.data} onClick={() => navigate("/employee/leave")} />
        <KpiCard label="Open tasks" value={tasks.data ? openTasks.length : undefined} hint={overdueTasks ? `${overdueTasks} overdue` : undefined} icon={KanbanSquare} tone={overdueTasks ? "red" : "navy"} loading={tasks.loading && !tasks.data} onClick={() => navigate("/employee/tasks")} />
      </div>

      <JoiningChecklistCard query={lifecycle} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* 1 + 2. Attendance status and working hours */}
        <Block title="Attendance & working hours" icon={Clock} to="/employee/attendance" query={today}>
          {t && (
            <div className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-extrabold text-[#101a3a]">{attendanceLabel(t)}</p>
                {t.record?.status && <StatusBadge status={t.record.status} />}
              </div>
              <p className="text-slate-600">{t.shift?.is_working_day === false ? "Non-working day" : "Working day"}{t.shift?.name ? ` · ${t.shift.name}` : ""}</p>
              {t.record?.check_in_at && (
                <p className="mt-1 text-slate-600">In {formatDateTime(t.record.check_in_at)}{t.record.check_out_at ? ` · Out ${formatDateTime(t.record.check_out_at)}` : ""}</p>
              )}
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
                <div><dt className="text-xs text-slate-500">Today</dt><dd className="font-bold text-[#101a3a]">{minutesToHm(t.record?.worked_minutes ?? 0)}</dd></div>
                <div><dt className="text-xs text-slate-500">This week</dt><dd className="font-bold text-[#101a3a]">{week ? minutesToHm(week.totals?.worked_minutes ?? 0) : "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">This month</dt><dd className="font-bold text-[#101a3a]">{monthTotals ? minutesToHm(monthTotals.worked_minutes ?? 0) : "—"}</dd></div>
              </dl>
              {week?.totals?.expected_minutes > 0 && (
                <p className="mt-2 text-center text-xs text-slate-500">Expected this week {minutesToHm(week.totals.expected_minutes)}</p>
              )}
            </div>
          )}
        </Block>

        {/* 3. Leave balance */}
        <Block title="Leave balance" icon={CalendarCheck} to="/employee/leave" query={balances} empty={balances.data && !balances.data.length ? "No leave balances yet" : null}>
          <ul className="flex flex-col gap-2 text-sm">
            {(balances.data ?? []).map((b) => (
              <li key={b.balance_id ?? b.leave_type_id} className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-700">{b.name ?? b.code}</span>
                <span className="shrink-0 text-right">
                  <span className="font-bold text-[#101a3a]">{b.available}</span>
                  <span className="text-xs text-slate-500"> available{Number(b.pending) > 0 ? ` · ${b.pending} pending` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </Block>

        {/* 4. Assigned tasks */}
        <Block title="Assigned tasks" icon={KanbanSquare} to="/employee/tasks" query={tasks} empty={tasks.data && !openTasks.length ? "No open tasks" : null}>
          <ul className="flex flex-col gap-2 text-sm">
            {openTasks.slice(0, 5).map((x) => {
              const overdue = x.due_date && x.due_date < todayIso;
              return (
                <li key={x.id} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-[#101a3a]">{x.title}</span>
                    <span className={`block text-xs ${overdue ? "font-semibold text-rose-600" : "text-slate-500"}`}>
                      {x.project?.name ? `${x.project.name} · ` : ""}{x.due_date ? `${overdue ? "Overdue · " : "Due "}${formatDate(x.due_date, { day: "2-digit", month: "short" })}` : "No due date"}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {x.priority && <Badge tone={PRIORITY_TONE[x.priority]}>{x.priority}</Badge>}
                    <StatusBadge status={x.status} />
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>

        {/* 5. Announcements */}
        <Block title="Announcements" icon={Megaphone} to="/employee/announcements" query={announcements} empty={announcements.data && !liveAnnouncements.length ? "No announcements" : null}>
          <ul className="flex flex-col gap-2 text-sm">
            {liveAnnouncements.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[#101a3a]">{a.title}</span>
                  <span className="block text-xs text-slate-500">{formatDate(a.published_at)}{a.requires_acknowledgement ? " · acknowledgement required" : ""}</span>
                </span>
                {a.category && <Badge tone={CATEGORY_TONE[a.category]}>{a.category}</Badge>}
              </li>
            ))}
          </ul>
        </Block>

        {/* 6. Pending requests */}
        <Block title="Pending requests" icon={HeartHandshake} to="/employee/requests" query={pendingQuery} empty={pendingQuery.data && !pending.length ? "No pending requests" : null}>
          <ul className="flex flex-col gap-2 text-sm">
            {pending.slice(0, 5).map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => navigate(r.to)} className="flex w-full items-start justify-between gap-2 rounded-lg text-left hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-[#101a3a]">{r.title}</span>
                    <span className="block text-xs text-slate-500">{r.kind} · {formatDate(r.at)}</span>
                  </span>
                  <StatusBadge status={r.status} />
                </button>
              </li>
            ))}
          </ul>
        </Block>

        {/* 7. Upcoming holidays */}
        <Block title="Upcoming holidays" icon={CalendarDays} query={holidays} empty={holidays.data && !upcomingHolidays.length ? `No holidays in the next ${HOLIDAY_WINDOW_DAYS} days` : null}>
          <ul className="flex flex-col gap-2 text-sm">
            {upcomingHolidays.map((h) => (
              <li key={`${h.id}-${h.date}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[#101a3a]">{h.name}</span>
                  <span className="block text-xs text-slate-500">{formatDate(h.date, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</span>
                </span>
                {h.type && <Badge tone={h.type === "optional" ? "violet" : "blue"}>{h.type}</Badge>}
              </li>
            ))}
          </ul>
        </Block>
      </div>

      {overdueTasks > 0 && (
        <p className="mt-4 flex items-center gap-2 text-sm font-medium text-rose-700">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          You have {overdueTasks} overdue task{overdueTasks === 1 ? "" : "s"}.
        </p>
      )}
    </>
  );
}

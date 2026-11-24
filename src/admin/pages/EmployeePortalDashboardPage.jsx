import { useEffect, useState } from "react";
import Link from "@/lib/nx/link";
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  ClipboardEdit,
  ClipboardList,
  Clock,
  FileText,
  Flag,
  Palmtree,
  PartyPopper,
  RefreshCw,
  UserCheck,
  UsersRound,
} from "lucide-react";
import PageHeader from "../PageHeader";
import { getPortalDashboard } from "@/lib/api/admin/employees";
import { dayName, formatDate, formatTime } from "@/employee/attendanceFormat";
import { DeadlineText } from "@/employee/projectsUi";
import { Alert, Avatar, Badge, Empty, Hero, KpiCard, Panel } from "@/components/portal/PortalUI";
import { BTN_SECONDARY } from "@/components/portal/portalStyles";

const STATUS = {
  in: { label: "In office", tone: "green" },
  out: { label: "Checked out", tone: "slate" },
  leave: { label: "On leave", tone: "violet" },
  not_in: { label: "Not in yet", tone: "red" },
  off: { label: "Day off", tone: "slate" },
};

const SUB_HEAD = "mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[#9aa0ad]";

function Attention({ p }) {
  const rows = [
    { n: p.leave, href: "/admin/leave", icon: Palmtree, text: "leave request(s) waiting for approval" },
    { n: p.corrections, href: "/admin/attendance?tab=corrections", icon: ClipboardEdit, text: "attendance correction request(s)" },
    { n: p.reports_to_review, href: "/admin/reports", icon: FileText, text: "daily report(s) waiting for review" },
    { n: p.reports_missing, href: "/admin/reports?tab=pending", icon: ClipboardList, text: "daily report(s) not submitted for the last working day" },
    { n: p.tasks_overdue_no_reason, href: "/admin/project-management", icon: AlertTriangle, text: "overdue task(s) without a reason" },
    { n: p.projects_overdue, href: "/admin/project-management", icon: CalendarClock, text: "project(s) past their deadline" },
  ].filter((r) => r.n > 0);

  return (
    <Panel
      icon={BellRing}
      title="Needs your attention"
      subtitle={rows.length ? "Open an item to deal with it" : undefined}
      action={rows.length > 0 && <Badge tone="orange">{rows.length} to do</Badge>}
      flush
    >
      {rows.length === 0 ? (
        <div className="p-5">
          <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/15">
            <CheckCircle2 size={18} aria-hidden="true" /> All caught up — nothing waiting for you.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <li key={r.text}>
              <Link
                href={r.href}
                className="group flex h-full items-center gap-3 rounded-xl border border-[#eef1f7] bg-[#fbfcfe] p-3.5 transition-all hover:border-[#f7941e]/40 hover:bg-[#fff9f2] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff4e6] text-[#d9650a] ring-1 ring-inset ring-[#f7941e]/25">
                  <r.icon size={18} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug text-[#2b303b]">
                  <span className="mr-1 text-lg font-extrabold tabular-nums text-[#101a3a]">{r.n}</span>
                  {r.text}
                </span>
                <ChevronRight size={16} className="shrink-0 text-[#c4cad6] transition-colors group-hover:text-[#d9650a]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Today({ data }) {
  return (
    <Panel
      icon={UserCheck}
      title="Today’s attendance"
      subtitle={`${data.people.length} active employee${data.people.length === 1 ? "" : "s"}`}
      action={
        <Link href="/admin/attendance" className="inline-flex items-center gap-1 text-xs font-semibold text-[#1f4693] hover:underline">
          Open attendance <ChevronRight size={14} aria-hidden="true" />
        </Link>
      }
      flush
    >
      {data.people.length === 0 ? (
        <Empty icon={UsersRound} title="No active employees yet." />
      ) : (
        <ul className="flex max-h-[24rem] flex-col divide-y divide-[#f0f2f6] overflow-y-auto">
          {data.people.map((p) => {
            const s = STATUS[p.status];
            return (
              <li key={p.id} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-[#f8fafd]">
                <Avatar name={p.full_name} size="h-9 w-9 text-xs" />
                <span className="min-w-0 flex-1">
                  <Link href={`/admin/employees/${p.id}`} className="block truncate text-sm font-semibold text-[#101a3a] hover:text-[#1f4693]">
                    {p.full_name}
                  </Link>
                  <span className="block truncate text-xs text-[#676b7a]">
                    {p.first_in ? `In at ${formatTime(p.first_in)}` : p.status === "leave" ? `${p.leave_type}${p.half_day ? " (half day)" : ""}` : p.designation ?? ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {p.late && <Badge tone="orange">Late</Badge>}
                  {s && (
                    <Badge tone={s.tone} dot>
                      {s.label}
                    </Badge>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ComingUp({ data }) {
  return (
    <Panel icon={CalendarRange} title="Coming up" subtitle="Next 7 days">
      <div className="flex flex-col gap-5">
        <div>
          <p className={SUB_HEAD}>
            <Flag size={12} aria-hidden="true" /> Deadlines
          </p>
          {data.deadlines.length === 0 ? (
            <p className="text-sm text-[#676b7a]">No deadlines this week.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.deadlines.map((d, i) => (
                <li key={`${d.kind}-${d.title}-${i}`}>
                  <Link
                    href={`/admin/project-management/${d.project_id}`}
                    className="group block rounded-xl border border-[#eef1f7] bg-[#fbfcfe] px-3.5 py-2.5 text-sm transition-colors hover:border-[#1f4693]/25 hover:bg-[#f4f7ff]"
                  >
                    <span className="flex items-center gap-2">
                      {d.kind === "project" && <Badge tone="blue">Project</Badge>}
                      <span className="min-w-0 truncate font-semibold text-[#101a3a] group-hover:text-[#1f4693]">
                        <span className="sr-only">{d.kind === "project" ? "Project: " : ""}</span>
                        {d.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-[#676b7a]">
                      {d.kind === "task" && `${d.project_name} · ${d.who ?? "Unassigned"} · `}
                      {formatDate(d.due_date)} · <DeadlineText iso={d.due_date} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className={SUB_HEAD}>
            <Palmtree size={12} aria-hidden="true" /> Leave
          </p>
          {data.leave_upcoming.length === 0 ? (
            <p className="text-sm text-[#676b7a]">Nobody is on leave this week.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.leave_upcoming.map((l, i) => (
                <li key={`${l.full_name}-${l.start_date}-${i}`} className="flex items-center gap-3 text-sm">
                  <Avatar name={l.full_name} size="h-8 w-8 text-[11px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-[#101a3a]">{l.full_name}</span>
                    <span className="block text-xs text-[#676b7a]">
                      {l.leave_type} · {formatDate(l.start_date)}
                      {l.end_date !== l.start_date && ` – ${formatDate(l.end_date)}`}
                      {l.half_day && " (half day)"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className={SUB_HEAD}>
            <PartyPopper size={12} aria-hidden="true" /> Next holiday
          </p>
          {data.next_holiday ? (
            <div className="flex items-center gap-3 rounded-xl bg-teal-50 px-3.5 py-2.5 ring-1 ring-inset ring-teal-600/15">
              <CalendarDays size={18} className="shrink-0 text-teal-700" aria-hidden="true" />
              <p className="min-w-0 text-sm">
                <span className="font-semibold text-[#101a3a]">{data.next_holiday.name}</span>
                <span className="block text-xs text-teal-800">
                  {dayName(data.next_holiday.date)}, {formatDate(data.next_holiday.date)}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-[#676b7a]">
              None added.{" "}
              <Link href="/admin/leave?tab=holidays" className="font-semibold text-[#1f4693] hover:underline">
                Add holidays
              </Link>
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

/**
 * Admin: Employee Portal — dashboard. Today's attendance, what is waiting for
 * the admin, and what is coming up in the next 7 days. Migration 247.
 */
export default function EmployeePortalDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    getPortalDashboard()
      .then((d) => {
        if (!active) return;
        setData(d);
        setError("");
      })
      .catch(() => active && setError("Could not load the dashboard. Please refresh the page."));
    return () => {
      active = false;
    };
  }, [reload]);

  const people = data?.people ?? [];
  const count = (st) => people.filter((p) => p.status === st).length;
  const pending = data ? Object.values(data.pending).reduce((a, b) => a + Number(b), 0) : 0;
  const late = people.filter((p) => p.late).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employee Portal"
        icon={UsersRound}
        subtitle={data ? `${dayName(data.today)}, ${formatDate(data.today)} — today at a glance.` : "Today at a glance."}
        actions={
          <button type="button" onClick={() => setReload((n) => n + 1)} className={BTN_SECONDARY}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        }
      />
      <Alert kind="err">{error}</Alert>
      {!data ? (
        !error && (
          <p role="status" className="text-sm text-[#676b7a]">
            Loading…
          </p>
        )
      ) : (
        <>
          <Hero
            eyebrow={`${dayName(data.today)}, ${formatDate(data.today)}`}
            title="Today at a glance"
            subtitle={pending ? `${pending} item${pending === 1 ? "" : "s"} waiting for you.` : "All caught up — nothing waiting for you."}
            stats={[
              { label: "In office", value: count("in") },
              { label: "Checked out", value: count("out") },
              { label: "On leave", value: count("leave") },
              { label: "Late", value: late },
            ]}
          />
          {!data.working_day && (
            <p className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
              <CalendarDays size={18} aria-hidden="true" />
              {data.holiday ? `Today is a company holiday: ${data.holiday}.` : "Today is Sunday — a day off."}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              href="/admin/employees"
              icon={UsersRound}
              accent="blue"
              label="Active employees"
              value={data.employees.active}
              hint={`${data.employees.interns} intern${data.employees.interns === 1 ? "" : "s"}${data.employees.access_off ? ` · ${data.employees.access_off} access off` : ""}`}
            />
            <KpiCard
              href="/admin/attendance"
              icon={UserCheck}
              accent="green"
              label="In office now"
              display={`${count("in")} / ${data.employees.active}`}
              hint={`${count("in") + count("out")} checked in today · ${late} late`}
            />
            <KpiCard
              href="/admin/attendance"
              icon={Clock}
              accent="red"
              label="Not in yet"
              value={data.working_day ? count("not_in") : undefined}
              display={data.working_day ? undefined : "—"}
              hint={`${count("leave")} on leave today`}
            />
            <KpiCard
              href={data.pending.leave ? "/admin/leave" : "/admin/reports"}
              icon={AlertTriangle}
              accent="orange"
              label="Waiting for you"
              value={pending}
              hint={pending ? "See the list below" : "All caught up"}
            />
          </div>
          <Attention p={data.pending} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Today data={data} />
            <ComingUp data={data} />
          </div>
        </>
      )}
    </div>
  );
}

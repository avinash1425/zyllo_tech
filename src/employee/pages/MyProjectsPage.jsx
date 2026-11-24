import { useEffect, useState } from "react";
import Link from "@/lib/nx/link";
import { AlertTriangle, ArrowUpRight, CalendarClock, FolderKanban, ListChecks, ListTodo, PlayCircle, Users } from "lucide-react";
import { getMyProjects } from "@/lib/api/employee/projects";
import { Alert, Badge, Chips, Empty, KpiCard } from "@/components/portal/PortalUI";
import { CARD } from "@/components/portal/portalStyles";
import { formatDate } from "../attendanceFormat";
import { DeadlineText, HealthChip, ProgressBar, StatusChip } from "../projectsUi";

const FILTERS = [
  { key: "active", label: "Active", test: (p) => ["planning", "in_progress", "on_hold"].includes(p.status) },
  { key: "all", label: "All", test: () => true },
  { key: "closed", label: "Live / completed", test: (p) => ["live", "completed", "cancelled"].includes(p.status) },
];

function ProjectCard({ p }) {
  const done = ["live", "completed", "cancelled"].includes(p.status);
  return (
    <Link
      href={`/employee/projects/${p.id}`}
      className={`${CARD} group relative flex flex-col overflow-hidden transition-all duration-200 hover:border-[#d9dce3] hover:shadow-[0_14px_30px_-12px_rgba(16,26,58,0.22)] motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706]`}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#f7941e] to-[#1f4693]" />
      <div className="flex flex-col gap-3 p-5 pt-6">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1f4693] to-[#3b6fd1] text-white shadow-[0_6px_14px_-4px_rgba(16,26,58,0.35)]">
              <FolderKanban className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[11px] text-[#9aa0ad]">{p.project_code}</p>
              <h2 className="truncate text-base font-bold text-[#101a3a] group-hover:text-[#1f4693]">{p.name}</h2>
              <p className="truncate text-xs text-[#676b7a]">{[p.client, p.project_type].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            <StatusChip value={p.status} />
            <ArrowUpRight className="h-4 w-4 text-[#8a8f9c] transition-colors group-hover:text-[#1f4693]" aria-hidden="true" />
          </span>
        </div>
        <ProgressBar value={p.progress} />
        <div className="flex flex-wrap gap-1.5">
          {p.health && <HealthChip value={p.health} />}
          {p.my_role && (
            <Badge tone="blue">
              {p.i_am_lead ? "Lead · " : ""}
              {p.my_role}
            </Badge>
          )}
        </div>
      </div>
      <dl className="mt-auto grid grid-cols-2 gap-px border-t border-[#eef1f7] bg-[#eef1f7] text-xs">
        <div className="flex items-start gap-2 bg-[#fafbff] px-4 py-3 text-[#4a5880]">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9aa0ad]" aria-hidden="true" />
          <dt className="sr-only">Deadline</dt>
          <dd className="min-w-0">
            {p.end_date ? (
              <>
                <span className="font-semibold text-[#101a3a]">{formatDate(p.end_date)}</span>
                <span className="block">
                  <DeadlineText iso={p.end_date} done={done} />
                </span>
              </>
            ) : (
              "No end date"
            )}
          </dd>
        </div>
        <div className="flex items-start gap-2 bg-[#fafbff] px-4 py-3 text-[#4a5880]">
          <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9aa0ad]" aria-hidden="true" />
          <dt className="sr-only">Tasks</dt>
          <dd className="min-w-0">
            <span className="font-semibold text-[#101a3a]">
              {p.tasks_done}/{p.tasks_total}
            </span>{" "}
            tasks done
            {p.my_open_tasks > 0 && (
              <span className="block">
                {p.my_open_tasks} mine open
                {p.my_overdue_tasks > 0 && <span className="font-semibold text-red-600"> · {p.my_overdue_tasks} overdue</span>}
              </span>
            )}
          </dd>
        </div>
        <div className="col-span-2 flex items-center gap-2 bg-[#fafbff] px-4 py-2.5 text-[#4a5880]">
          <Users className="h-3.5 w-3.5 shrink-0 text-[#9aa0ad]" aria-hidden="true" />
          <dt className="sr-only">Team</dt>
          <dd>{p.team_size} in team</dd>
        </div>
      </dl>
    </Link>
  );
}

export default function MyProjectsPage() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let active = true;
    getMyProjects()
      .then((d) => active && setProjects(d))
      .catch(() => active && setError("Could not load your projects. Please refresh the page."));
    return () => {
      active = false;
    };
  }, []);

  if (error)
    return (
      <Alert kind="err" className="mx-auto max-w-6xl">
        {error}
      </Alert>
    );
  if (!projects) return <p className="py-10 text-center text-sm text-[#676b7a]">Loading your projects…</p>;

  const f = FILTERS.find((x) => x.key === filter);
  const shown = projects.filter(f.test);
  const openTasks = projects.reduce((s, p) => s + p.my_open_tasks, 0);
  const overdue = projects.reduce((s, p) => s + p.my_overdue_tasks, 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={FolderKanban} accent="blue" label="My projects" value={projects.length} />
        <KpiCard icon={PlayCircle} accent="teal" label="Active" value={projects.filter(FILTERS[0].test).length} />
        <KpiCard icon={ListTodo} accent="orange" label="My open tasks" value={openTasks} />
        <KpiCard icon={AlertTriangle} accent={overdue ? "red" : "green"} label="Overdue tasks" value={overdue} />
      </div>

      {projects.length === 0 ? (
        <div className={CARD}>
          <Empty
            icon={FolderKanban}
            title="No projects assigned yet"
            message="When the company adds you to a project team, it will appear here."
            className="py-12"
          />
        </div>
      ) : (
        <>
          <Chips
            label="Filter projects"
            size="md"
            value={filter}
            onChange={setFilter}
            items={FILTERS.map((x) => ({ key: x.key, label: x.label, count: projects.filter(x.test).length }))}
          />
          {shown.length === 0 ? (
            <div className={CARD}>
              <Empty icon={FolderKanban} message="No projects in this view." />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((p) => (
                <ProjectCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

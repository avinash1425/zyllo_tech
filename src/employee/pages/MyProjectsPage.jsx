import { useEffect, useState } from "react";
import Link from "@/lib/nx/link";
import { CalendarClock, FolderKanban, ListChecks, Users } from "lucide-react";
import { getMyProjects } from "@/lib/api/employee/projects";
import { formatDate } from "../attendanceFormat";
import { CARD, DeadlineText, HealthChip, ProgressBar, StatusChip } from "../projectsUi";

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
      className={`${CARD} group flex flex-col gap-3 transition-shadow hover:shadow-[0_10px_30px_-18px_rgba(16,26,58,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-[#9aa0ad]">{p.project_code}</p>
          <h2 className="truncate text-base font-bold text-[#101a3a] group-hover:text-[#1f4693]">{p.name}</h2>
          <p className="truncate text-xs text-[#676b7a]">{[p.client, p.project_type].filter(Boolean).join(" · ")}</p>
        </div>
        <StatusChip value={p.status} />
      </div>
      <ProgressBar value={p.progress} />
      <div className="flex flex-wrap gap-1.5">
        {p.health && <HealthChip value={p.health} />}
        {p.my_role && (
          <span className="rounded-full bg-[#f0f4ff] px-2 py-0.5 text-[11px] font-semibold text-[#1f4693]">
            {p.i_am_lead ? "Lead · " : ""}
            {p.my_role}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-2 border-t border-[#f3f4f8] pt-3 text-xs">
        <div className="flex items-center gap-1.5 text-[#4a5880]">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          <dt className="sr-only">Deadline</dt>
          <dd>
            {p.end_date ? (
              <>
                {formatDate(p.end_date)}
                <span className="block">
                  <DeadlineText iso={p.end_date} done={done} />
                </span>
              </>
            ) : (
              "No end date"
            )}
          </dd>
        </div>
        <div className="flex items-center gap-1.5 text-[#4a5880]">
          <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
          <dt className="sr-only">Tasks</dt>
          <dd>
            {p.tasks_done}/{p.tasks_total} tasks done
            {p.my_open_tasks > 0 && (
              <span className="block">
                {p.my_open_tasks} mine open
                {p.my_overdue_tasks > 0 && <span className="font-semibold text-red-600"> · {p.my_overdue_tasks} overdue</span>}
              </span>
            )}
          </dd>
        </div>
        <div className="col-span-2 flex items-center gap-1.5 text-[#4a5880]">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          <dt className="sr-only">Team</dt>
          <dd>
            {p.team_size} in team
          </dd>
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

  if (error) return <p role="alert" className="mx-auto max-w-6xl rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!projects) return <p className="py-10 text-center text-sm text-[#676b7a]">Loading your projects…</p>;

  const f = FILTERS.find((x) => x.key === filter);
  const shown = projects.filter(f.test);
  const openTasks = projects.reduce((s, p) => s + p.my_open_tasks, 0);
  const overdue = projects.reduce((s, p) => s + p.my_overdue_tasks, 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "My projects", value: projects.length, color: "text-[#1f4693]" },
          { label: "Active", value: projects.filter(FILTERS[0].test).length, color: "text-sky-700" },
          { label: "My open tasks", value: openTasks, color: "text-amber-700" },
          { label: "Overdue tasks", value: overdue, color: overdue ? "text-red-600" : "text-emerald-700" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-[#e7e9ee] bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {projects.length === 0 ? (
        <div className={`${CARD} flex flex-col items-center gap-2 py-12 text-center`}>
          <FolderKanban className="h-10 w-10 text-[#b0b8cc]" aria-hidden="true" />
          <p className="font-semibold text-[#101a3a]">No projects assigned yet</p>
          <p className="max-w-sm text-sm text-[#676b7a]">When the company adds you to a project team, it will appear here.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter projects">
            {FILTERS.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={filter === x.key}
                onClick={() => setFilter(x.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  filter === x.key ? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
                }`}
              >
                {x.label} ({projects.filter(x.test).length})
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#676b7a]">No projects in this view.</p>
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

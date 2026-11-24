import { useEffect, useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { AlertTriangle, CheckCircle2, ChevronRight, FolderKanban, Layers, PlayCircle } from "lucide-react";
import PageHeader from "../PageHeader";
import { ACTIVE_STATUSES, DONE_STATUSES, listProjects, pct } from "@/lib/api/admin/projectManagement";
import { DeadlineText, StatusChip } from "@/employee/projectsUi";
import { Alert, Empty, MetricStrip, Progress, TableCard } from "@/components/portal/PortalUI";
import { TABLE, TABLE_WRAP, TD, TH, TR } from "@/components/portal/portalStyles";

const FILTERS = [
  { key: "active", label: "Active", icon: PlayCircle, color: "#1f4693" },
  { key: "completed", label: "Completed", icon: CheckCircle2, color: "#059669" },
  { key: "all", label: "All projects", icon: Layers, color: "#f96706" },
];

function Team({ team }) {
  if (!team?.length) return <span className="text-xs text-[#b0b8cc]">No one assigned</span>;
  const shown = team.slice(0, 3);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((m) => (
        <span
          key={m.id}
          title={m.is_lead ? `${m.full_name} (lead)` : m.full_name}
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
            m.is_lead ? "bg-[#fff4e6] text-[#c24f05] ring-[#f7941e]/25" : "bg-[#eef2fb] text-[#1f4693] ring-[#1f4693]/15"
          }`}
        >
          {m.full_name}
        </span>
      ))}
      {team.length > 3 && <span className="text-[11px] font-semibold text-[#676b7a]">+{team.length - 3} more</span>}
    </span>
  );
}

function TaskProgress({ p }) {
  if (!(p.tasks_total > 0)) return <span className="text-xs text-[#b0b8cc]">No tasks</span>;
  return (
    <>
      <Progress value={pct(p.tasks_done, p.tasks_total)} />
      <span className="mt-1 flex items-center gap-2 text-[11px] text-[#676b7a]">
        {p.tasks_done} of {p.tasks_total}
        {p.tasks_overdue > 0 && (
          <span className="inline-flex items-center gap-0.5 font-semibold text-red-600">
            <AlertTriangle size={11} aria-hidden="true" /> {p.tasks_overdue} overdue
          </span>
        )}
      </span>
    </>
  );
}

/**
 * Admin: Project Management — every Project Tracker project with its team,
 * status, deadline and task completion. Open one to manage its team and
 * tasks. Migration 241.
 */
export default function ProjectManagementPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");

  useEffect(() => {
    let active = true;
    listProjects()
      .then((d) => active && setRows(d))
      .catch(() => active && setError("Could not load projects. Please refresh the page."));
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    const list = rows ?? [];
    return {
      active: list.filter((p) => ACTIVE_STATUSES.includes(p.status)).length,
      completed: list.filter((p) => DONE_STATUSES.includes(p.status)).length,
      all: list.length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((p) => {
      if (filter === "active" && !ACTIVE_STATUSES.includes(p.status)) return false;
      if (filter === "completed" && !DONE_STATUSES.includes(p.status)) return false;
      if (!q) return true;
      return [p.name, p.project_code, p.client, ...(p.team ?? []).map((m) => m.full_name)]
        .filter(Boolean)
        .some((s) => s.toLowerCase().includes(q));
    });
  }, [rows, query, filter]);

  const filterLabel = FILTERS.find((f) => f.key === filter)?.label ?? "Projects";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Project Management"
        icon={FolderKanban}
        subtitle="Every project with its team, status and deadline. Open a project to assign employees and tasks, set deadlines and follow each employee's progress."
      />

      <MetricStrip
        items={FILTERS.map((f) => ({ ...f, value: rows === null ? "–" : counts[f.key] }))}
        selected={filter}
        onSelect={setFilter}
      />

      <TableCard
        title={filter === "all" ? "All projects" : `${filterLabel} projects`}
        count={rows === null ? null : shown.length}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search project, client, employee…"
      >
        {error ? (
          <div className="p-5">
            <Alert kind="err">{error}</Alert>
          </div>
        ) : rows === null ? (
          <p className="p-5 text-sm text-[#676b7a]">Loading projects…</p>
        ) : shown.length === 0 ? (
          <Empty
            icon={FolderKanban}
            title={rows.length ? "No projects match" : "No projects yet"}
            message={rows.length ? "Try another search or filter." : "Add projects in the Project Tracker."}
          />
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="divide-y divide-[#eef1f7] lg:hidden">
              {shown.map((p) => (
                <li key={p.id}>
                  <Link href={`/admin/project-management/${p.id}`} className="flex flex-col gap-2.5 p-4 transition-colors hover:bg-[#f8faff]">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-[#101a3a]">{p.name}</p>
                        <p className="truncate text-xs text-[#676b7a]">
                          <span className="font-mono">{p.project_code}</span>
                          {p.client && ` · ${p.client}`}
                        </p>
                      </div>
                      <StatusChip value={p.status} />
                    </div>
                    <Team team={p.team} />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <DeadlineText iso={p.end_date} done={DONE_STATUSES.includes(p.status)} />
                    </div>
                    <div>
                      <TaskProgress p={p} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {/* Larger screens: table */}
            <div className={`hidden lg:block ${TABLE_WRAP}`}>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Project</th>
                    <th className={TH}>Assigned to</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Deadline</th>
                    <th className={`${TH} w-48`}>Tasks done</th>
                    <th className={TH}>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} className={`group ${TR}`}>
                      <td className={TD}>
                        <Link href={`/admin/project-management/${p.id}`} className="block">
                          <span className="block font-semibold text-[#101a3a] group-hover:text-[#1f4693]">{p.name}</span>
                          <span className="block text-xs text-[#9aa0ad]">
                            <span className="font-mono">{p.project_code}</span>
                            {p.client && ` · ${p.client}`}
                          </span>
                        </Link>
                      </td>
                      <td className={`${TD} max-w-[16rem]`}>
                        <Team team={p.team} />
                      </td>
                      <td className={TD}>
                        <StatusChip value={p.status} />
                      </td>
                      <td className={`${TD} whitespace-nowrap text-xs`}>
                        <span className="block font-semibold text-[#2b303b]">{p.end_date ? p.end_date.split("-").reverse().join("-") : "—"}</span>
                        {p.end_date && <DeadlineText iso={p.end_date} done={DONE_STATUSES.includes(p.status)} />}
                      </td>
                      <td className={TD}>
                        <TaskProgress p={p} />
                      </td>
                      <td className={`${TD} text-right`}>
                        <Link
                          href={`/admin/project-management/${p.id}`}
                          aria-label={`Open ${p.name}`}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#1f4693] transition-colors hover:bg-[#eef2fb]"
                        >
                          Open <ChevronRight size={14} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </TableCard>
    </div>
  );
}

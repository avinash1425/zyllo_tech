import { useCallback, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { ArrowLeft, CalendarDays, DatabaseBackup, ExternalLink, FileText, FolderOpen, KeyRound, Pencil } from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import EmptyState from "../EmptyState";
import { fetchProjectPage } from "@/lib/api/admin/projectTrackerProject";
import ProjectFormModal from "../project-tracker/ProjectFormModal";
import CredentialsTab from "../project-tracker/CredentialsTab";
import DocumentsTab from "../project-tracker/DocumentsTab";
import BackupsTab from "../project-tracker/BackupsTab";
import { HealthBadge, PriorityBadge, ProgressBar, StatusBadge } from "../project-tracker/badges";
import { Notice } from "../project-tracker/ui";
import { BTN_SECONDARY, formatDate } from "../project-tracker/styles";

const TABS = [
  { key: "access", label: "Access & Logins", icon: KeyRound },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "backups", label: "Backups", icon: DatabaseBackup },
];

// One project: header with its details, then Access & Logins / Documents / Backups.
export default function ProjectTrackerProjectPage() {
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "access";
  const loader = useCallback(() => fetchProjectPage(projectId), [projectId]);
  const { data: project, loading, error, reload } = useAdminData(loader, [projectId]);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(null);

  const setTab = (key) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.set("tab", key);
    return next;
  }, { replace: true });

  if (loading) return <AdminLoading />;

  if (error || !project) {
    return (
      <div className="flex flex-col gap-6">
        <Link href="/admin/project-tracker" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#676b7a] hover:text-[#c24f05]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Project overview
        </Link>
        <EmptyState
          bordered
          icon={FolderOpen}
          title={error ? "Could not load this project" : "Project not found"}
          message={error ? error.message : "It may have been deleted."}
        />
      </div>
    );
  }

  const companyHref = `/admin/project-tracker/companies/${project.company?.id ?? project.company_id}`;
  const start = formatDate(project.start_date);
  const end = formatDate(project.end_date);

  return (
    <div className="flex flex-col gap-6">
      <Link href={companyHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#676b7a] hover:text-[#c24f05]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {project.company?.name ?? "Company"}
      </Link>

      <section className="flex flex-col gap-4 rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold text-[#1f4693]">{project.project_code}</p>
            <h1 className="break-words text-2xl font-bold tracking-tight text-[#2b303b]">{project.name}</h1>
            <p className="mt-0.5 text-sm text-[#676b7a]">
              <Link href={companyHref} className="hover:text-[#c24f05] hover:underline">
                {project.company?.name}
              </Link>
              {project.project_type && ` · ${project.project_type}`}
              {project.project_manager && ` · PM: ${project.project_manager}`}
            </p>
          </div>
          <button type="button" onClick={() => setEditing(true)} className={`${BTN_SECONDARY} shrink-0`}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit project
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusBadge status={project.status} />
          <PriorityBadge priority={project.priority} />
          <HealthBadge health={project.health} />
          <ProgressBar value={project.progress} className="w-40" />
          {(start || end) && (
            <span className="flex items-center gap-1.5 text-xs text-[#676b7a]">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              {start ?? "—"} → {end ?? "—"}
            </span>
          )}
          {project.live_url && (
            <a href={project.live_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#1f4693] hover:underline">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              {project.live_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          )}
        </div>
        {project.next_action && (
          <p className="text-sm text-[#2b303b]">
            <span className="font-semibold">Next action: </span>
            {project.next_action}
          </p>
        )}
      </section>

      <Notice text={notice} onClose={() => setNotice(null)} />

      <div role="tablist" aria-label="Project sections" className="flex gap-1 overflow-x-auto border-b border-[#e7e9ee]">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`pt-tab-${key}`}
              aria-selected={active}
              aria-controls={`pt-panel-${key}`}
              onClick={() => setTab(key)}
              className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                active ? "border-[#f7941e] text-[#c24f05]" : "border-transparent text-[#676b7a] hover:text-[#2b303b]"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`pt-panel-${tab}`} aria-labelledby={`pt-tab-${tab}`}>
        {tab === "access" && <CredentialsTab project={project} onProjectChanged={reload} />}
        {tab === "documents" && <DocumentsTab projectId={project.id} projectLabel={`${project.project_code} ${project.name}`} />}
        {tab === "backups" && <BackupsTab projectId={project.id} />}
      </div>

      {editing && (
        <ProjectFormModal
          companyId={project.company_id}
          companyName={project.company?.name}
          project={project}
          onClose={() => setEditing(false)}
          onSaved={async (text) => {
            setEditing(false);
            setNotice(text);
            await reload();
          }}
        />
      )}
    </div>
  );
}

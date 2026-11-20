import { useCallback, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { ArrowLeft, CalendarDays, DatabaseBackup, ExternalLink, FileText, FolderOpen, KeyRound, Pencil, User, Zap } from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import EmptyState from "../EmptyState";
import { fetchProjectPage } from "@/lib/api/admin/projectTrackerProject";
import ProjectFormModal from "../project-tracker/ProjectFormModal";
import CredentialsTab from "../project-tracker/CredentialsTab";
import DocumentsTab from "../project-tracker/DocumentsTab";
import BackupsTab from "../project-tracker/BackupsTab";
import { CompanyLogo, Notice } from "../project-tracker/ui";
import { BTN_SECONDARY, formatDate } from "../project-tracker/styles";

const TABS = [
  { key: "access", label: "Access & Logins", icon: KeyRound },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "backups", label: "Backups", icon: DatabaseBackup },
];

const STATUS_COLOR = { live: "#34d399", in_progress: "#fbbf24", planning: "#93c5fd", on_hold: "#94a3b8", completed: "#5eead4", cancelled: "#f87171" };
const PRIORITY_COLOR = { high: "#f87171", medium: "#fbbf24", low: "#94a3b8" };
const HEALTH_COLOR = { on_track: "#34d399", at_risk: "#fb923c", off_track: "#f87171" };
function fmtLabel(val) {
  if (!val) return "—";
  return val.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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

  const statusItems = [
    { label: "Status", value: fmtLabel(project.status), color: STATUS_COLOR[project.status] ?? "#fff" },
    { label: "Priority", value: fmtLabel(project.priority), color: PRIORITY_COLOR[project.priority] ?? "#fff" },
    { label: "Health", value: fmtLabel(project.health), color: HEALTH_COLOR[project.health] ?? "#fff" },
    { label: "Progress", value: `${project.progress ?? 0}%`, color: "#fbbf24" },
    { label: "Timeline", value: (start && end) ? `${start} → ${end}` : (start ?? end ?? "—"), color: "#fff" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Breadcrumb */}
      <Link href={companyHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#8a90a0] hover:text-[#1f4693]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {project.company?.name ?? "Company"}
      </Link>

      {/* Status Hub card */}
      <section className="overflow-hidden rounded-2xl border border-[#1a3a7a] bg-white shadow-lg">

        {/* Navy metrics strip */}
        <div className="flex items-stretch overflow-x-auto bg-[#1f4693] px-6 py-3">
          {statusItems.map((item, i) => (
            <div
              key={item.label}
              className={`min-w-[80px] flex-1 px-4 text-center${i < statusItems.length - 1 ? " border-r border-white/15" : ""}`}
            >
              <p className="text-[9px] font-bold uppercase tracking-widest text-white/45">{item.label}</p>
              <p className="mt-1 text-sm font-bold" style={{ color: item.color }}>{item.value}</p>
            </div>
          ))}
        </div>

        {/* White hero body */}
        <div className="flex flex-col items-start gap-4 px-6 py-5 sm:flex-row sm:items-center">
          <div className="shrink-0">
            <CompanyLogo
              name={project.company?.name ?? ""}
              url={project.company?.logo_url}
              className="h-14 w-14 rounded-xl border border-[#e3e9f5] shadow-sm"
              textClass="text-xl"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-[#eef2fb] px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-widest text-[#1f4693]">
                {project.project_code}
              </span>
              {project.project_type && (
                <span className="rounded-md bg-[#f4f6f9] px-2 py-0.5 text-[11px] font-semibold text-[#676b7a]">
                  {project.project_type}
                </span>
              )}
            </div>
            <h1 className="mt-1.5 break-words text-[22px] font-extrabold leading-snug tracking-tight text-[#101a3a] sm:text-[26px]">
              {project.name}
            </h1>
            <p className="mt-0.5 text-sm text-[#8a90a0]">
              <Link href={companyHref} className="font-semibold text-[#1f4693] hover:underline">
                {project.company?.name}
              </Link>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              {project.project_manager && (
                <span className="flex items-center gap-1.5 text-sm">
                  <User className="h-3.5 w-3.5 shrink-0 text-[#9aa0ad]" aria-hidden="true" />
                  <span className="font-medium text-[#2b303b]">{project.project_manager}</span>
                </span>
              )}
              {(start || end) && (
                <span className="flex items-center gap-1.5 text-sm">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#9aa0ad]" aria-hidden="true" />
                  <span className="text-[#4a5068]">{start ?? "—"} → {end ?? "—"}</span>
                </span>
              )}
              {project.live_url && (
                <a href={project.live_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-[#1f4693] hover:underline">
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-[22rem] truncate">
                    {project.live_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </span>
                </a>
              )}
            </div>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#1f4693] to-[#2d5fbe] px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:shadow-lg"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit project
            </button>
          </div>
        </div>

        {/* Next action strip */}
        {project.next_action && (
          <div className="flex items-start gap-3 border-t border-[#fde8c0] bg-[#fef9f0] px-6 py-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#fff3e0]">
              <Zap className="h-3.5 w-3.5 text-[#c24f05]" aria-hidden="true" />
            </span>
            <p className="text-sm leading-snug text-[#78350f]">
              <span className="font-bold text-[#c24f05]">Next action — </span>
              {project.next_action}
            </p>
          </div>
        )}
      </section>

      <Notice text={notice} onClose={() => setNotice(null)} />

      {/* Underline tab bar */}
      <div
        role="tablist"
        aria-label="Project sections"
        className="flex overflow-x-auto rounded-2xl border border-[#e8edf8] bg-white px-2 shadow-sm"
      >
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
              className={`inline-flex flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap border-b-[3px] px-5 py-3.5 text-sm font-semibold transition-colors ${
                active
                  ? "border-[#1f4693] text-[#1f4693]"
                  : "border-transparent text-[#8a90a0] hover:border-[#dce5f7] hover:text-[#2d5fbe]"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${active ? "text-[#1f4693]" : "text-[#9aa0ad]"}`}
                aria-hidden="true"
              />
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

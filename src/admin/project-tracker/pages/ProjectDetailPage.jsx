import { useMemo, useState } from "react";
import useLoad from "../useLoad";
import { useParams, useSearchParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import {
  Archive, ArchiveRestore, ClipboardCheck, DatabaseBackup, GitBranch, Globe, History, KeyRound,
  LayoutGrid, ListChecks, Mail, Pencil, Printer, Search as SearchIcon, Server, Wrench, CalendarClock,
} from "lucide-react";
import EmptyState from "../../EmptyState";
import { getProject, archiveRecord, restoreRecord } from "@/lib/api/admin/projectTracker";
import { Badge, Banner, Breadcrumbs, Button, ConfirmDialog, Spinner, TabBar, useToast } from "../ui";
import { ProjectContext, useProjectRefs, useRole } from "../context";
import RecordSection from "../RecordSection";
import ProjectFormModal from "../ProjectFormModal";
import { SafeLink } from "../cells";
import { CompletenessPill, ProgressBar } from "./ProjectsPage";
import AccessTab from "../tabs/AccessTab";
import AmcTab from "../tabs/AmcTab";
import SeoTab from "../tabs/SeoTab";
import DocumentsTab from "../tabs/DocumentsTab";
import ActivityTab from "../tabs/ActivityTab";
import OverviewTab from "../tabs/OverviewTab";
import { EmailsTab, HostingTab } from "../tabs/LinkedCredentialTabs";
import { PROJECT_STATUS, SECTION_STATE as SECTION_LABEL, labelOf } from "../lib/options";
import { formatDateTime } from "../lib/format";

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "hosting", label: "Hosting & Servers", icon: Server, state: "hosting_state" },
  { key: "domains", label: "Domains & SSL", icon: Globe, state: "domain_state" },
  { key: "emails", label: "Emails & Accounts", icon: Mail },
  { key: "access", label: "Credentials & Access", icon: KeyRound, state: "admin_access_state" },
  { key: "backups", label: "Backups & Recovery", icon: DatabaseBackup, state: "backups_state" },
  { key: "source", label: "Source Code & Deployments", icon: GitBranch, state: "source_state" },
  { key: "maintenance", label: "Updates & Maintenance", icon: Wrench, state: "maintenance_state" },
  { key: "amc", label: "AMC & Renewals", icon: CalendarClock, state: "amc_state" },
  { key: "seo", label: "SEO & Analytics", icon: SearchIcon, state: "seo_state" },
  { key: "tasks", label: "Tasks & Milestones", icon: ListChecks },
  { key: "documents", label: "Documents & Handover", icon: ClipboardCheck, state: "handover_state" },
  { key: "activity", label: "Activity & Remarks", icon: History },
];
const DOT = { complete: "bg-emerald-500", partial: "bg-amber-400", missing: "bg-red-500" };

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "overview";
  const { canEdit, isManager } = useRole();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const { data, error: loadError, reload: reloadProject } = useLoad(() => getProject(id), [id]);
  // undefined = loading this project; null = not found / no access
  const project = data === undefined || (data && data.id !== id) ? (loadError ? null : undefined) : data;
  const error = loadError?.message || "";
  const { refs, reloadRefs } = useProjectRefs(project?.id);

  const ctx = useMemo(() => ({
    project, refs, reloadRefs, reloadProject, readOnly: Boolean(project?.archived_at),
  }), [project, refs, reloadRefs, reloadProject]);

  if (project === undefined) return <Spinner label="Loading project…" />;
  if (!project) {
    return (
      <EmptyState bordered title="Project not found" message={error || "This project does not exist, or you do not have access to it."}
        action={<Link href="/admin/project-tracker/projects" className="text-sm font-semibold text-[#1f4693] hover:underline">Back to All Projects</Link>} />
    );
  }

  const tabs = TABS.map((t) => ({ ...t, dot: t.state ? DOT[project[t.state]] : undefined }));
  function selectTab(k) {
    const next = new URLSearchParams(params);
    if (k === "overview") next.delete("tab"); else next.set("tab", k);
    setParams(next);
  }

  return (
    <ProjectContext.Provider value={ctx}>
      <div className="space-y-5">
        <Breadcrumbs items={project.company_id ? [
          { label: "Companies", href: "/admin/project-tracker/companies" },
          { label: project.company_name, href: `/admin/project-tracker/companies/${project.company_id}` },
          { label: "Projects", href: `/admin/project-tracker/companies/${project.company_id}` },
          { label: project.name },
        ] : [
          { label: "All Projects", href: "/admin/project-tracker/projects" },
          { label: project.name },
        ]} />
        <header className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-[0_1px_2px_rgba(16,26,58,0.04)] sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8a8f9c]">{project.project_code} · #{project.serial_no}</p>
              <h1 className="mt-0.5 break-words text-2xl font-bold tracking-tight text-[#101a3a]">{project.name}</h1>
              <p className="text-sm text-[#676b7a]">
                {project.company_id
                  ? <Link href={`/admin/project-tracker/companies/${project.company_id}`} className="font-medium text-[#1f4693] hover:underline">{project.company_name}</Link>
                  : <>No company assigned <span className="text-xs">(was: {project.client_name})</span></>}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge value={project.status} label={labelOf(PROJECT_STATUS, project.status)} />
                <CompletenessPill label={project.completeness_label} score={project.completeness_score} />
                <ProgressBar value={project.progress} />
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div><dt className="inline text-[#8a8f9c]">Live URL: </dt><dd className="inline">{project.live_url ? <SafeLink href={project.live_url} /> : "—"}</dd></div>
                <div><dt className="inline text-[#8a8f9c]">Responsible: </dt><dd className="inline">{project.responsible_person || "—"}</dd></div>
                <div><dt className="inline text-[#8a8f9c]">Last updated: </dt><dd className="inline">{formatDateTime(project.last_activity_at || project.updated_at)}</dd></div>
              </dl>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {canEdit && !project.archived_at && <Button icon={Pencil} onClick={() => setEditing(true)}>Edit Project</Button>}
              <Link href={`/admin/project-tracker/projects/${project.id}/report`}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#1f4693] px-3.5 text-sm font-semibold text-white hover:bg-[#183a7a]">
                <Printer className="h-4 w-4" aria-hidden="true" />Generate Report
              </Link>
              {canEdit && !project.archived_at && <Button variant="danger" icon={Archive} onClick={() => setConfirm("archive")}>Archive</Button>}
              {isManager && project.archived_at && <Button variant="primary" icon={ArchiveRestore} onClick={() => setConfirm("restore")}>Restore project</Button>}
            </div>
          </div>
          {!project.company_id && !project.archived_at && (
            <Banner tone="warning" className="mt-4" title="This project is not linked to a company yet">
              It was created before companies existed. {canEdit ? "Use Edit Project and choose its company." : "An editor can assign its company."}
            </Banner>
          )}
          {project.archived_at && (
            <Banner tone="warning" className="mt-4" title="This project is archived and read-only">
              Archived {formatDateTime(project.archived_at)}{project.archive_reason ? ` — ${project.archive_reason}` : ""}. {isManager ? "Restore it to make changes." : "A manager can restore it."}
            </Banner>
          )}
        </header>

        <div className="sm:hidden">
          <label htmlFor="pt-section-select" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#676b7a]">Section</label>
          <select id="pt-section-select" value={tab} onChange={(e) => selectTab(e.target.value)}
            className="h-11 w-full rounded-lg border border-[#e7e9ee] bg-white px-3 text-sm font-semibold text-[#101a3a]">
            {tabs.map((t) => <option key={t.key} value={t.key}>{t.label}{t.state ? ` — ${labelOf(SECTION_LABEL, project[t.state])}` : ""}</option>)}
          </select>
        </div>
        <div className="hidden sm:block">
          <TabBar tabs={tabs} active={tab} onSelect={selectTab} label="Project sections" />
        </div>

        <div role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label}>
          {tab === "overview" && <OverviewTab onEdit={() => setEditing(true)} onOpenTab={selectTab} />}
          {tab === "hosting" && <HostingTab />}
          {tab === "domains" && <RecordSection sectionKey="domains" description="Domains and subdomains with registrar, DNS and SSL details. Expiry dates feed the renewal alerts." />}
          {tab === "emails" && <EmailsTab />}
          {tab === "access" && <AccessTab />}
          {tab === "backups" && (
            <>
              {project.backup_missing && <Banner tone="danger" className="mb-4" title="No completed backup recorded in the last 35 days">Record the latest backup (with date and storage location) or check the backup schedule.</Banner>}
              {project.backup_verification_overdue && <Banner tone="warning" className="mb-4" title="Backup verification overdue">No backup of this project has been verified in the last 90 days.</Banner>}
              <RecordSection sectionKey="backups"
                description="Scheduled → Completed (date and protected location) → Verified (who, when, evidence) → Restore tested (date and evidence). The system will not mark a backup successful without evidence. Never link a public backup file." />
            </>
          )}
          {tab === "source" && (
            <div className="space-y-5">
              <RecordSection sectionKey="repositories" description="Source repositories (multiple allowed) and where each part is hosted." />
              <RecordSection sectionKey="deployments" description="Deployment history is kept; mistaken entries can be archived but are never deleted." />
            </div>
          )}
          {tab === "maintenance" && <RecordSection sectionKey="updates" description="Chronological log of maintenance, bug fixes, security updates, content changes and releases. The newest update is shown on the Project Overview." />}
          {tab === "amc" && <AmcTab />}
          {tab === "seo" && <SeoTab />}
          {tab === "tasks" && (
            <div className="space-y-5">
              <RecordSection sectionKey="milestones" />
              <RecordSection sectionKey="tasks" description="Lightweight tasks for this project only. Attach files to a task from Documents & Handover (choose “Attached to Task”)." />
            </div>
          )}
          {tab === "documents" && <DocumentsTab />}
          {tab === "activity" && <ActivityTab />}
        </div>

        {editing && <ProjectFormModal project={project} onClose={() => setEditing(false)} onSaved={() => reloadProject()} />}
        {confirm === "archive" && (
          <ConfirmDialog title={`Archive ${project.name}?`} confirmLabel="Archive project" requireReason reasonLabel="Reason for archiving"
            message="The project and all its records become read-only and leave the active lists and alerts. Nothing is deleted. A manager can restore it."
            onConfirm={async (reason) => { await archiveRecord("pt_projects", project.id, reason); toast.push("Project archived."); await reloadProject(); }}
            onClose={() => setConfirm(null)} />
        )}
        {confirm === "restore" && (
          <ConfirmDialog title={`Restore ${project.name}?`} tone="primary" confirmLabel="Restore"
            message="The project returns to its previous status and becomes editable again."
            onConfirm={async () => { await restoreRecord("pt_projects", project.id); toast.push("Project restored."); await reloadProject(); }}
            onClose={() => setConfirm(null)} />
        )}
      </div>
    </ProjectContext.Provider>
  );
}


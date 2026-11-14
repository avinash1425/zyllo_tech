import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { Archive, ArchiveRestore, Building2, Eye, Pencil, Plus } from "lucide-react";
import EmptyState from "../../EmptyState";
import useLoad from "../useLoad";
import { archiveRecord, getCompany, listCompanyActivity, listProjects, restoreRecord } from "@/lib/api/admin/projectTracker";
import { Badge, Banner, Breadcrumbs, Button, Card, ConfirmDialog, DataTable, DefinitionGrid, Spinner, useToast } from "../ui";
import { useRole } from "../context";
import { SafeLink } from "../cells";
import { COMPANY_STATUS, COMPANY_TYPE, PROJECT_CATEGORY, PROJECT_STATUS, labelOf } from "../lib/options";
import { formatDateTime } from "../lib/format";
import { actionLabel, entityText } from "../lib/activity";
import CompanyFormModal from "../CompanyFormModal";
import ProjectFormModal from "../ProjectFormModal";

function Stat({ label, value, href, tone = "text-[#101a3a]" }) {
  return (
    <Link href={href} className="rounded-2xl border border-[#e7e9ee] bg-white p-4 transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]">
      <span className="block text-[12.5px] font-semibold text-[#676b7a]">{label}</span>
      <span className={`mt-1 block text-2xl font-extrabold tabular-nums ${tone}`}>{value}</span>
    </Link>
  );
}

export default function CompanyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { canEdit, isManager } = useRole();
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState(null);
  const { data: company, error, reload: reloadCompany } = useLoad(() => getCompany(id), [id]);
  const { data: projects, loading: projLoading, reload: reloadProjects } = useLoad(
    () => listProjects({ companyId: id, includeArchived: showArchived, sort: "name", dir: "asc", pageSize: 100 }), [id, showArchived],
  );
  const projectIds = (projects?.rows || []).map((p) => p.id);
  const { data: activity } = useLoad(() => listCompanyActivity(id, projectIds, { limit: 8 }), [id, projectIds.join(",")]);
  const reloadAll = () => { reloadCompany(); reloadProjects(); };

  if (company === undefined && !error) return <Spinner label="Loading company…" />;
  if (!company) {
    return <EmptyState bordered title="Company not found" message={error?.message || "This company does not exist, or you do not have access to it."}
      action={<Link href="/admin/project-tracker/companies" className="text-sm font-semibold text-[#1f4693] hover:underline">Back to Companies</Link>} />;
  }
  const base = `/admin/project-tracker/projects?company=${company.id}`;
  const archived = Boolean(company.archived_at);
  const rows = projects?.rows || [];

  const columns = [
    { key: "sl", label: "Sl. No.", sortable: false, className: "w-16", render: (p) => <span className="tabular-nums text-[#676b7a]">{rows.indexOf(p) + 1}</span> },
    { key: "project_code", label: "Project ID", sortable: false, render: (p) => <span className="whitespace-nowrap font-semibold">{p.project_code}</span> },
    { key: "name", label: "Project Name", sortable: false, render: (p) => <Link href={`/admin/project-tracker/projects/${p.id}`} className="font-semibold text-[#1f4693] hover:underline">{p.name}</Link> },
    { key: "category", label: "Project Type", sortable: false, render: (p) => (p.category === "other" ? p.category_other || "Other" : labelOf(PROJECT_CATEGORY, p.category)) },
    { key: "status", label: "Project Status", sortable: false, render: (p) => <Badge value={p.status} label={labelOf(PROJECT_STATUS, p.status)} /> },
    { key: "live_url", label: "Live URL", sortable: false, render: (p) => (p.live_url ? <SafeLink href={p.live_url}>{p.live_url.replace(/^https?:\/\//, "")}</SafeLink> : "—") },
    { key: "updated_at", label: "Last Updated", sortable: false, render: (p) => <span className="whitespace-nowrap text-xs">{formatDateTime(p.last_activity_at || p.updated_at)}</span> },
    {
      key: "_a", label: <span className="sr-only">Actions</span>, sortable: false, className: "w-px whitespace-nowrap text-right",
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon={Eye} onClick={() => navigate(`/admin/project-tracker/projects/${p.id}`)} aria-label={`View ${p.name}`}>View</Button>
          {canEdit && !p.archived_at && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setDialog({ kind: "editProject", p })} aria-label={`Edit ${p.name}`}>Edit</Button>}
          {canEdit && !p.archived_at && <Button size="sm" variant="ghost" icon={Archive} onClick={() => setDialog({ kind: "archiveProject", p })} aria-label={`Archive ${p.name}`}>Archive</Button>}
          {isManager && p.archived_at && !archived && <Button size="sm" variant="ghost" icon={ArchiveRestore} onClick={() => setDialog({ kind: "restoreProject", p })}>Restore</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[
        { label: "Project Tracker", href: "/admin/project-tracker" },
        { label: "Companies", href: "/admin/project-tracker/companies" },
        { label: company.company_name, href: `/admin/project-tracker/companies/${company.id}` },
        { label: "Projects" },
      ]} />

      <header className="flex flex-col gap-4 rounded-2xl border border-[#e7e9ee] bg-white p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1f4693]/10 text-[#1f4693]"><Building2 className="h-6 w-6" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#8a8f9c]">{company.company_number}{company.company_code ? ` · ${company.company_code}` : ""}</p>
            <h1 className="break-words text-2xl font-bold tracking-tight text-[#101a3a]">{company.company_name}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              {archived ? <Badge value="archived" tone="neutral" label="Archived" /> : <Badge value={company.status} label={labelOf(COMPANY_STATUS, company.status)} />}
              <Badge value="info" tone="info" label={labelOf(COMPANY_TYPE, company.company_type)} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && !archived && <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: "addProject" })}>Add Project</Button>}
          {canEdit && !archived && <Button icon={Pencil} onClick={() => setDialog({ kind: "editCompany" })}>Edit Company</Button>}
          {canEdit && !archived && <Button variant="danger" icon={Archive} onClick={() => setDialog({ kind: "archiveCompany" })}>Archive</Button>}
          {isManager && archived && <Button variant="primary" icon={ArchiveRestore} onClick={() => setDialog({ kind: "restoreCompany" })}>Restore company</Button>}
        </div>
      </header>
      {archived && <Banner tone="warning" title="This company is archived and read-only">Archived {formatDateTime(company.archived_at)}{company.archive_reason ? ` — ${company.archive_reason}` : ""}. {isManager ? "Restore it to add or restore projects." : "A manager can restore it."}</Banner>}

      <section aria-label="Project summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total Projects" value={company.total_projects} href={base} />
        <Stat label="Live Projects" value={company.live_projects} href={`${base}&status=live`} tone="text-emerald-700" />
        <Stat label="In Progress" value={company.in_progress_projects} href={`${base}&status=in_progress`} tone="text-amber-800" />
        <Stat label="Under Maintenance" value={company.maintenance_projects} href={`${base}&status=under_maintenance`} />
        <Stat label="Completed Projects" value={company.completed_projects} href={`${base}&status=completed`} />
        <Stat label="Pending Handover" value={company.pending_handover_projects} href={`${base}&flag=pending_handover`} tone={company.pending_handover_projects ? "text-red-700" : "text-[#101a3a]"} />
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Projects" className="xl:col-span-2" actions={<>
          <label className="flex items-center gap-2 text-xs font-medium text-[#676b7a]">
            <input type="checkbox" className="accent-[#1f4693]" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived
          </label>
          {canEdit && !archived && <Button size="sm" variant="primary" icon={Plus} onClick={() => setDialog({ kind: "addProject" })}>Add Project</Button>}
        </>}>
          {!projects ? <Spinner /> : (
            <div className={projLoading ? "opacity-60" : ""}>
              <DataTable caption={`Projects of ${company.company_name}`} columns={columns} rows={rows}
                rowClass={(p) => (p.archived_at ? "opacity-60" : "")} onRowClick={(p) => navigate(`/admin/project-tracker/projects/${p.id}`)}
                empty={canEdit && !archived ? "No projects yet — use Add Project." : "No projects."} />
              {company.archived_projects > 0 && !showArchived && <p className="mt-2 text-xs text-[#676b7a]">{company.archived_projects} archived project(s) hidden.</p>}
            </div>
          )}
        </Card>
        <div className="space-y-5">
          <Card title="Company Information" actions={canEdit && !archived && <Button size="sm" icon={Pencil} onClick={() => setDialog({ kind: "editCompany" })}>Edit</Button>}>
            <DefinitionGrid compact items={[
              { label: "Company ID", value: company.company_number },
              { label: "Company Code", value: company.company_code || "—" },
              { label: "Website", value: company.website ? <SafeLink href={company.website} /> : "—" },
              { label: "Contact Person", value: company.contact_person || "—" },
              { label: "Contact Email", value: company.contact_email || "—" },
              { label: "Contact Phone", value: company.contact_phone || "—" },
              { label: "Location", value: [company.city, company.state, company.country].filter(Boolean).join(", ") || "—" },
              { label: "Address", value: company.address || "—", full: true },
              { label: "Created", value: `${formatDateTime(company.created_at)}${company.created_by_email ? ` by ${company.created_by_email}` : ""}`, full: true },
              { label: "Last Updated", value: `${formatDateTime(company.updated_at)}${company.updated_by_email ? ` by ${company.updated_by_email}` : ""}`, full: true },
              { label: "Remarks", value: company.remarks || "—", full: true },
            ]} />
          </Card>
          <Card title="Recent activity">
            {!activity ? <Spinner /> : activity.length === 0 ? <p className="text-sm text-[#676b7a]">No activity yet.</p> : (
              <ol className="space-y-2">
                {activity.map((r) => (
                  <li key={r.id} className="border-l-2 border-[#e7e9ee] pl-3 text-sm">
                    <p className="text-[#2b303b]"><span className="font-semibold">{actionLabel(r.action)}</span>{entityText(r) ? ` — ${entityText(r)}` : ""}</p>
                    <p className="text-xs text-[#8a8f9c]">{formatDateTime(r.created_at)}{r.actor_email ? ` · ${r.actor_email}` : ""}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {dialog?.kind === "addProject" && <ProjectFormModal presetCompanyId={company.id} onClose={() => setDialog(null)} onSaved={() => reloadAll()} />}
      {dialog?.kind === "editProject" && <ProjectFormModal project={dialog.p} onClose={() => setDialog(null)} onSaved={() => reloadAll()} />}
      {dialog?.kind === "editCompany" && <CompanyFormModal company={company} onClose={() => setDialog(null)} onSaved={() => reloadAll()} />}
      {dialog?.kind === "archiveCompany" && (
        <ConfirmDialog title={`Archive ${company.company_name}?`} confirmLabel="Archive company" requireReason reasonLabel="Reason for archiving"
          message={company.total_projects > 0
            ? `${company.total_projects} active project(s) belong to this company. Archive them (or ask a manager to move them) first — the system will refuse otherwise.`
            : "The company becomes read-only and leaves the active list. Nothing is deleted; a manager can restore it."}
          onConfirm={async (reason) => { await archiveRecord("pt_companies", company.id, reason); toast.push("Company archived."); reloadAll(); }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "restoreCompany" && (
        <ConfirmDialog title={`Restore ${company.company_name}?`} tone="primary" confirmLabel="Restore"
          message="The company becomes active again. Its archived projects stay archived until you restore them."
          onConfirm={async () => { await restoreRecord("pt_companies", company.id); toast.push("Company restored."); reloadAll(); }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "archiveProject" && (
        <ConfirmDialog title={`Archive ${dialog.p.name}?`} confirmLabel="Archive project" requireReason reasonLabel="Reason for archiving"
          message="The project and its records become read-only and leave the active lists. Nothing is deleted."
          onConfirm={async (reason) => { await archiveRecord("pt_projects", dialog.p.id, reason); toast.push("Project archived."); reloadAll(); }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "restoreProject" && (
        <ConfirmDialog title={`Restore ${dialog.p.name}?`} tone="primary" confirmLabel="Restore"
          message="The project returns to its previous status."
          onConfirm={async () => { await restoreRecord("pt_projects", dialog.p.id); toast.push("Project restored."); reloadAll(); }}
          onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

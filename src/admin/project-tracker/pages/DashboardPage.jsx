import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Link from "@/lib/nx/link";
import { Activity, Building2, CalendarClock, ClipboardCheck, FolderKanban, Globe, Plus, RefreshCw, Search, Server, Users, Wrench } from "lucide-react";
import PageHeader from "../../PageHeader";
import useAdminData from "../../useAdminData";
import { getDashboard } from "@/lib/api/admin/projectTracker";
import { Badge, Banner, Breadcrumbs, Button, Card, DataTable, Spinner } from "../ui";
import { useRole } from "../context";
import { DUE_WINDOWS, PROJECT_STATUS, labelOf } from "../lib/options";
import { daysUntil, formatDate, formatDateTime, relativeDays } from "../lib/format";
import { actionLabel, entityText } from "../lib/activity";
import ProjectFormModal from "../ProjectFormModal";
import CompanyFormModal from "../CompanyFormModal";

const P = "/admin/project-tracker/projects";

function Kpi({ label, value, href, icon: Icon, accent }) {
  return (
    <Link href={href}
      className="group flex items-center gap-4 rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-[0_1px_2px_rgba(16,26,58,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693] motion-reduce:hover:translate-y-0">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accent}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold leading-snug text-[#676b7a]">{label}</span>
        <span className="mt-0.5 block text-[1.6rem] font-extrabold leading-none tracking-tight text-[#101a3a] tabular-nums">{value}</span>
      </span>
    </Link>
  );
}

function DueList({ items, empty, tab }) {
  if (items.length === 0) return <p className="text-sm text-[#676b7a]">{empty}</p>;
  return (
    <ul className="divide-y divide-[#eef0f4]">
      {items.slice(0, 6).map((d) => {
        const n = daysUntil(d.due_date);
        return (
          <li key={`${d.source_table}-${d.record_id}-${d.kind}-${d.due_date}`} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-[#2b303b]">{d.label}</p>
              <Link href={`${P}/${d.project_id}?tab=${tab}`} className="block truncate text-xs text-[#1f4693] hover:underline">
                {d.company_name ? `${d.company_name} · ` : ""}{d.project_name}
              </Link>
            </div>
            <span className={`shrink-0 text-right text-xs ${n < 0 ? "font-semibold text-red-700" : n <= 15 ? "font-semibold text-amber-800" : "text-[#676b7a]"}`}>
              {formatDate(d.due_date)}<span className="block">{n < 0 ? `overdue ${-n}d` : relativeDays(d.due_date)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Attention({ label, count, href, danger }) {
  return (
    <Link href={href} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm hover:shadow-sm ${count ? (danger ? "border-red-200 bg-red-50/60" : "border-amber-200 bg-amber-50/60") : "border-[#eef0f4] bg-white"}`}>
      <span className="font-medium text-[#2b303b]">{label}</span>
      <span className={`font-bold tabular-nums ${count ? (danger ? "text-red-700" : "text-amber-800") : "text-[#676b7a]"}`}>{count}</span>
    </Link>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { canEdit, isManager } = useRole();
  const [windowDays, setWindowDays] = useState(30);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState(null);
  const { data, loading, error, reload } = useAdminData(() => getDashboard(windowDays), [windowDays]);

  const view = useMemo(() => {
    if (!data) return null;
    const active = data.projects.filter((p) => !p.archived_at);
    const count = (s) => active.filter((p) => p.status === s).length;
    const names = new Map(data.projects.map((p) => [p.id, p]));
    const recentProjects = [...active].sort((a, b) => String(b.last_activity_at || b.updated_at).localeCompare(String(a.last_activity_at || a.updated_at))).slice(0, 8);
    return {
      companies: data.companies.filter((c) => !c.archived_at).length,
      total: active.length,
      live: count("live"),
      inProgress: count("in_progress"),
      maintenance: count("under_maintenance"),
      pendingHandover: active.filter((p) => p.handover_pending).length,
      missingBackups: active.filter((p) => p.backup_missing).length,
      verificationOverdue: active.filter((p) => p.backup_verification_overdue).length,
      missingAdmin: active.filter((p) => p.admin_details_missing).length,
      missingCritical: active.filter((p) => p.completeness_label === "missing_critical").length,
      overdueTasks: active.filter((p) => p.overdue_tasks > 0).length,
      unassigned: active.filter((p) => !p.company_id).length,
      sslDue: data.due.filter((d) => d.kind === "ssl").length,
      domainDue: data.due.filter((d) => d.kind === "domain"),
      hostingDue: data.due.filter((d) => d.kind === "hosting"),
      amcDue: data.due.filter((d) => d.kind === "amc"),
      recentProjects,
      recent: data.recent.map((r) => ({ ...r, project: names.get(r.project_id) })),
      byStatus: Object.fromEntries(PROJECT_STATUS.map((s) => [s.value, data.projects.filter((p) => p.status === s.value).length])),
    };
  }, [data]);

  const recentColumns = [
    { key: "project_code", label: "Project ID", sortable: false, render: (p) => <span className="whitespace-nowrap font-semibold">{p.project_code}</span> },
    { key: "name", label: "Project Name", sortable: false, render: (p) => <Link href={`${P}/${p.id}`} className="font-semibold text-[#1f4693] hover:underline">{p.name}</Link> },
    { key: "company_name", label: "Company", sortable: false, render: (p) => (p.company_id ? <Link href={`/admin/project-tracker/companies/${p.company_id}`} className="hover:underline">{p.company_name}</Link> : <Badge value="warning" tone="warning" label="Unassigned" />) },
    { key: "status", label: "Project Status", sortable: false, render: (p) => <Badge value={p.status} label={labelOf(PROJECT_STATUS, p.status)} /> },
    { key: "updated_at", label: "Last Updated", sortable: false, render: (p) => <span className="whitespace-nowrap text-xs">{formatDateTime(p.last_activity_at || p.updated_at)}</span> },
    { key: "_a", label: "Action", sortable: false, className: "text-right", render: (p) => <Button size="sm" variant="secondary" onClick={() => navigate(`${P}/${p.id}`)} aria-label={`View ${p.name}`}>View</Button> },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Project Tracker" }, { label: "Dashboard" }]} />
      <PageHeader
        title="Project Tracker"
        icon={FolderKanban}
        subtitle="Companies, their projects and everything about each project — hosting, domains, accounts, credentials (by reference), backups, renewals, documents and handover."
        actions={<>
          {canEdit && <Button variant="primary" icon={Plus} onClick={() => setDialog("company")}>Add Company</Button>}
          {canEdit && <Button variant="primary" icon={Plus} onClick={() => setDialog("project")}>Add Project</Button>}
          {isManager && <Link href="/admin/project-tracker/access" className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#e7e9ee] bg-white px-3.5 text-sm font-semibold text-[#2b303b] hover:bg-[#fafbfc]"><Users className="h-4 w-4" aria-hidden="true" />Access</Link>}
        </>}
      />
      <form role="search" onSubmit={(e) => { e.preventDefault(); navigate(`${P}?q=${encodeURIComponent(q)}`); }} className="flex max-w-xl gap-2">
        <label htmlFor="pt-dash-search" className="sr-only">Search projects</label>
        <input id="pt-dash-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects or companies…"
          className="h-10 w-full min-w-0 rounded-lg border border-[#e7e9ee] bg-white px-3 text-sm outline-none focus:border-[#1f4693]/60" />
        <Button type="submit" icon={Search}>Search</Button>
      </form>

      {error && <Banner tone="danger" title="Could not load the dashboard">{error.message}</Banner>}
      {loading || !view ? <Spinner label="Loading dashboard…" /> : (
        <>
          <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <Kpi label="Total Companies" value={view.companies} href="/admin/project-tracker/companies" icon={Building2} accent="bg-[#1f4693]/10 text-[#1f4693]" />
            <Kpi label="Total Projects" value={view.total} href={P} icon={FolderKanban} accent="bg-[#3089a6]/12 text-[#216478]" />
            <Kpi label="Live Projects" value={view.live} href={`${P}?status=live`} icon={Globe} accent="bg-emerald-50 text-emerald-700" />
            <Kpi label="In Progress" value={view.inProgress} href={`${P}?status=in_progress`} icon={Activity} accent="bg-amber-50 text-amber-700" />
            <Kpi label="Under Maintenance" value={view.maintenance} href={`${P}?status=under_maintenance`} icon={Wrench} accent="bg-indigo-50 text-indigo-700" />
            <Kpi label="Pending Handover" value={view.pendingHandover} href={`${P}?flag=pending_handover`} icon={ClipboardCheck} accent="bg-red-50 text-red-700" />
          </section>

          <section aria-label="Needs attention" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Attention label="Projects missing backups" count={view.missingBackups} href={`${P}?flag=missing_backups`} danger />
            <Attention label="Backup verification overdue" count={view.verificationOverdue} href={`${P}?flag=backup_verification_overdue`} />
            <Attention label="Missing admin details" count={view.missingAdmin} href={`${P}?flag=missing_admin`} />
            <Attention label="Missing critical documentation" count={view.missingCritical} href={`${P}?flag=missing_critical`} danger />
            <Attention label="Projects with overdue tasks" count={view.overdueTasks} href={`${P}?flag=overdue_tasks`} />
            <Attention label={`SSL expiring (${windowDays} days)`} count={view.sslDue} href={`${P}?due=ssl&within=${windowDays}`} />
            <Attention label="Projects without a company" count={view.unassigned} href={`${P}?company=unassigned`} />
            <Attention label="Archived projects" count={view.byStatus.archived} href={`${P}?status=archived`} />
          </section>

          <Card title="Recent Projects" actions={<Link href={P} className="text-sm font-semibold text-[#1f4693] hover:underline">All projects</Link>}>
            <DataTable caption="Recent projects" columns={recentColumns} rows={view.recentProjects} empty={canEdit ? "No projects yet — add a company, then its projects." : "No projects yet."} />
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#676b7a]">Upcoming renewals</h2>
            <div className="flex items-center gap-2">
              <label htmlFor="pt-window" className="text-xs font-medium text-[#676b7a]">Due within</label>
              <select id="pt-window" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="h-8 rounded-lg border border-[#e7e9ee] bg-white px-2 text-sm">
                {DUE_WINDOWS.map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={reload} aria-label="Refresh dashboard">Refresh</Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card title={<span className="inline-flex items-center gap-2"><Globe className="h-4 w-4 text-[#1f4693]" aria-hidden="true" />Upcoming Domain Renewals</span>}
              actions={<Link href={`${P}?due=domain&within=${windowDays}`} className="text-sm font-semibold text-[#1f4693] hover:underline">{view.domainDue.length}</Link>}>
              <DueList items={view.domainDue} empty={`No domain renewals in ${windowDays} days.`} tab="domains" />
            </Card>
            <Card title={<span className="inline-flex items-center gap-2"><Server className="h-4 w-4 text-[#1f4693]" aria-hidden="true" />Upcoming Hosting Renewals</span>}
              actions={<Link href={`${P}?due=hosting&within=${windowDays}`} className="text-sm font-semibold text-[#1f4693] hover:underline">{view.hostingDue.length}</Link>}>
              <DueList items={view.hostingDue} empty={`No hosting renewals in ${windowDays} days.`} tab="hosting" />
            </Card>
            <Card title={<span className="inline-flex items-center gap-2"><CalendarClock className="h-4 w-4 text-[#1f4693]" aria-hidden="true" />Upcoming AMC Renewals</span>}
              actions={<Link href={`${P}?due=amc&within=${windowDays}`} className="text-sm font-semibold text-[#1f4693] hover:underline">{view.amcDue.length}</Link>}>
              <DueList items={view.amcDue} empty={`No AMC renewals in ${windowDays} days.`} tab="amc" />
            </Card>
          </div>

          <Card title="Recent Activity" actions={<Badge value="info" tone="neutral" label="In-app alerts only — no emails are sent" />}>
            {view.recent.length === 0 ? <p className="text-sm text-[#676b7a]">No activity yet.</p> : (
              <ol className="relative space-y-3 border-l-2 border-[#e7e9ee] pl-4">
                {view.recent.map((r) => (
                  <li key={r.id} className="relative text-sm">
                    <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#1f4693]" />
                    <p className="text-[#2b303b]"><span className="font-semibold">{actionLabel(r.action)}</span>{entityText(r) ? ` — ${entityText(r)}` : ""}</p>
                    <p className="text-xs text-[#676b7a]">
                      {r.project ? <Link href={`${P}/${r.project_id}?tab=activity`} className="text-[#1f4693] hover:underline">{r.project.company_name ? `${r.project.company_name} · ` : ""}{r.project.name}</Link>
                        : r.entity_type === "company" && r.entity_id ? <Link href={`/admin/project-tracker/companies/${r.entity_id}`} className="text-[#1f4693] hover:underline">Company</Link> : "Project Tracker"}
                      {" · "}{formatDateTime(r.created_at)}{r.actor_email ? ` · ${r.actor_email}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
      {dialog === "company" && <CompanyFormModal onClose={() => setDialog(null)} onSaved={(c) => navigate(`/admin/project-tracker/companies/${c.id}`)} />}
      {dialog === "project" && <ProjectFormModal onClose={() => setDialog(null)} onSaved={(p) => navigate(`${P}/${p.id}`)} />}
    </div>
  );
}

export function tabForKind(kind) {
  if (kind === "hosting") return "hosting";
  if (kind === "domain" || kind === "ssl") return "domains";
  return "amc";
}

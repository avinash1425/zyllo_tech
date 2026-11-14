import { useState } from "react";
import useLoad from "../useLoad";
import { useNavigate, useSearchParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { FolderOpen, Plus, X } from "lucide-react";
import PageHeader from "../../PageHeader";
import { listCompanyOptions, listProjects } from "@/lib/api/admin/projectTracker";
import { Badge, Banner, Breadcrumbs, Button, DataTable, Pagination, Spinner } from "../ui";
import { useRole } from "../context";
import { COMPLETENESS, DUE_KINDS, PRIORITY, PROJECT_CATEGORY, PROJECT_STATUS, DUE_WINDOWS, labelOf } from "../lib/options";
import { formatDate, formatDateTime } from "../lib/format";
import ProjectFormModal from "../ProjectFormModal";

const FLAGS = [
  { value: "pending_handover", label: "Pending handover" },
  { value: "missing_backups", label: "Missing backups" },
  { value: "backup_verification_overdue", label: "Backup verification overdue" },
  { value: "missing_admin", label: "Missing admin details" },
  { value: "missing_critical", label: "Missing critical information" },
  { value: "partial", label: "Documentation partially complete" },
  { value: "complete_docs", label: "Documentation complete" },
  { value: "overdue_tasks", label: "Has overdue tasks" },
];
const DATE_FIELDS = [
  { value: "start_date", label: "Start date" },
  { value: "expected_completion_date", label: "Expected completion" },
  { value: "actual_completion_date", label: "Actual completion" },
  { value: "updated_at", label: "Last updated" },
  { value: "created_at", label: "Created" },
];

export function ProgressBar({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="flex items-center gap-2" title={`${v}% development progress`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#eef0f4]" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label="Development progress">
        <div className="h-full rounded-full bg-gradient-to-r from-[#3089a6] to-[#1f4693]" style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs tabular-nums text-[#676b7a]">{v}%</span>
    </div>
  );
}

export function CompletenessPill({ label, score }) {
  return <Badge value={label} label={`${score}% · ${labelOf(COMPLETENESS, label)}`} />;
}

function Sel({ id, label, value, onChange, options, any = "Any" }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-[#676b7a]">{label}</label>
      <select id={id} value={value || ""} onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-[#e7e9ee] bg-white px-2 text-sm outline-none focus:border-[#1f4693]/60">
        <option value="">{any}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function SearchForm({ initial, onSearch }) {
  const [q, setQ] = useState(initial);
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); onSearch(q.trim()); }} className="mb-3 flex gap-2">
      <label htmlFor="pt-q" className="sr-only">Search</label>
      <input id="pt-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by project, company, ID or responsible person…"
        className="h-10 w-full rounded-lg border border-[#e7e9ee] px-3 text-sm outline-none focus:border-[#1f4693]/60" />
      <Button type="submit" variant="primary">Search</Button>
    </form>
  );
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { canEdit } = useRole();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const opts = Object.fromEntries(params.entries());
  const key = params.toString();
  const { data, error: loadError, loading } = useLoad(() => listProjects({
    q: opts.q, status: opts.status, category: opts.category, priority: opts.priority, flag: opts.flag,
    dueKind: opts.due, within: opts.within, dateField: opts.date, from: opts.from, to: opts.to,
    includeArchived: opts.archived === "1", sort: opts.sort, dir: opts.dir, page: opts.page, pageSize: 20, companyId: opts.company,
  }), [key]);
  const { data: companies } = useLoad(() => listCompanyOptions(), []);
  const error = loadError?.message || "";
  const result = data || (loadError ? { rows: [], count: 0, page: 1, pageSize: 20 } : null);

  function update(patch, { resetPage = true } = {}) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    if (resetPage) next.delete("page");
    setParams(next);
  }

  const sort = { key: opts.sort || "updated_at", dir: opts.dir || (opts.sort && opts.sort !== "updated_at" ? "asc" : "desc") };
  const activeFilters = ["q", "company", "status", "category", "priority", "flag", "due", "date", "from", "to", "archived"].filter((k) => params.get(k));

  const columns = [
    { key: "project_code", label: "Project ID", render: (p) => <span className="whitespace-nowrap font-semibold text-[#101a3a]">{p.project_code}</span> },
    {
      key: "name", label: "Project", render: (p) => (
        <div className="min-w-[12rem]">
          <Link href={`/admin/project-tracker/projects/${p.id}`} className="font-semibold text-[#1f4693] hover:underline">{p.name}</Link>
        </div>
      ),
    },
    {
      key: "company_name", label: "Company", render: (p) => (p.company_id
        ? <Link href={`/admin/project-tracker/companies/${p.company_id}`} className="text-[#1f4693] hover:underline">{p.company_name}</Link>
        : <Badge value="warning" tone="warning" label="Unassigned" />),
    },
    { key: "category", label: "Type", render: (p) => (p.category === "other" ? p.category_other || "Other" : labelOf(PROJECT_CATEGORY, p.category)) },
    { key: "status", label: "Status", render: (p) => <Badge value={p.status} label={labelOf(PROJECT_STATUS, p.status)} /> },
    { key: "priority", label: "Priority", render: (p) => <Badge value={p.priority} label={labelOf(PRIORITY, p.priority)} /> },
    { key: "progress", label: "Progress", render: (p) => <ProgressBar value={p.progress} /> },
    { key: "completeness_score", label: "Documentation", render: (p) => <CompletenessPill label={p.completeness_label} score={p.completeness_score} /> },
    { key: "responsible_person", label: "Responsible", sortable: false, render: (p) => p.responsible_person || "—" },
    { key: "start_date", label: "Start", render: (p) => formatDate(p.start_date) },
    { key: "updated_at", label: "Last updated", render: (p) => <span className="whitespace-nowrap text-xs">{formatDateTime(p.last_activity_at || p.updated_at)}</span> },
  ];

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Project Tracker", href: "/admin/project-tracker" }, { label: "All Projects" }]} />
      <PageHeader title="All Projects" icon={FolderOpen}
        subtitle="Every project across all companies. Open a project for its complete details workspace."
        actions={canEdit && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New project</Button>} />

      <section aria-label="Filters" className="rounded-2xl border border-[#e7e9ee] bg-white p-4">
        <SearchForm key={params.get("q") || ""} initial={params.get("q") || ""} onSearch={(q) => update({ q })} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-9">
          <Sel id="pt-f-company" label="Company" value={opts.company} onChange={(v) => update({ company: v })}
            options={[{ value: "unassigned", label: "Unassigned (no company)" }, ...(companies || []).map((c) => ({ value: c.id, label: c.company_name }))]} />
          <Sel id="pt-f-status" label="Status" value={opts.status} onChange={(v) => update({ status: v })} options={PROJECT_STATUS} />
          <Sel id="pt-f-cat" label="Project type" value={opts.category} onChange={(v) => update({ category: v })} options={PROJECT_CATEGORY} />
          <Sel id="pt-f-pri" label="Priority" value={opts.priority} onChange={(v) => update({ priority: v })} options={PRIORITY} />
          <Sel id="pt-f-flag" label="Attention" value={opts.flag} onChange={(v) => update({ flag: v })} options={FLAGS} />
          <Sel id="pt-f-due" label="Renewal due" value={opts.due} onChange={(v) => update({ due: v, within: v ? opts.within || 30 : null })} options={[{ value: "any", label: "Any renewal" }, ...DUE_KINDS]} />
          <Sel id="pt-f-within" label="Within" value={opts.within} any="30 days" onChange={(v) => update({ within: v })} options={DUE_WINDOWS.map((d) => ({ value: String(d), label: `${d} days` }))} />
          <Sel id="pt-f-date" label="Date field" value={opts.date} any="(no date filter)" onChange={(v) => update({ date: v })} options={DATE_FIELDS} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="pt-f-from" className="mb-1 block text-xs font-medium text-[#676b7a]">From</label>
              <input id="pt-f-from" type="date" value={opts.from || ""} disabled={!opts.date} onChange={(e) => update({ from: e.target.value })}
                className="h-9 w-full rounded-lg border border-[#e7e9ee] px-1.5 text-xs disabled:bg-[#f6f7fb]" />
            </div>
            <div>
              <label htmlFor="pt-f-to" className="mb-1 block text-xs font-medium text-[#676b7a]">To</label>
              <input id="pt-f-to" type="date" value={opts.to || ""} disabled={!opts.date} onChange={(e) => update({ to: e.target.value })}
                className="h-9 w-full rounded-lg border border-[#e7e9ee] px-1.5 text-xs disabled:bg-[#f6f7fb]" />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-[#676b7a]">
            <input type="checkbox" className="accent-[#1f4693]" checked={opts.archived === "1"} onChange={(e) => update({ archived: e.target.checked ? "1" : null })} />
            Include archived
          </label>
          {activeFilters.length > 0 && (
            <Button size="sm" variant="ghost" icon={X} onClick={() => setParams(new URLSearchParams())}>Clear filters</Button>
          )}
        </div>
      </section>

      {error && <Banner tone="danger">{error}</Banner>}
      {!result ? <Spinner label="Loading projects…" /> : (
        <div className={loading ? "opacity-60 transition-opacity" : ""} aria-busy={loading}>
          <DataTable caption="Projects" columns={columns} rows={result.rows} sort={sort}
            onSort={(k) => update({ sort: k, dir: sort.key === k && sort.dir === "asc" ? "desc" : "asc" }, { resetPage: false })}
            onRowClick={(p) => navigate(`/admin/project-tracker/projects/${p.id}`)}
            empty={activeFilters.length ? "No projects match these filters." : "No projects yet. Create the first one."} />
          <Pagination page={result.page} pageSize={result.pageSize} count={result.count} onPage={(n) => update({ page: n }, { resetPage: false })} />
        </div>
      )}
      {creating && <ProjectFormModal onClose={() => setCreating(false)} onSaved={(p) => navigate(`/admin/project-tracker/projects/${p.id}`)} />}
    </div>
  );
}

import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { Archive, ArchiveRestore, Building2, Eye, Pencil, Plus } from "lucide-react";
import PageHeader from "../../PageHeader";
import useLoad from "../useLoad";
import { archiveRecord, listCompanies, restoreRecord } from "@/lib/api/admin/projectTracker";
import { Badge, Banner, Breadcrumbs, Button, ConfirmDialog, DataTable, Pagination, Spinner, useToast } from "../ui";
import { useRole } from "../context";
import { COMPANY_STATUS, COMPANY_TYPE, labelOf } from "../lib/options";
import { formatDateTime } from "../lib/format";
import CompanyFormModal from "../CompanyFormModal";

function SearchForm({ initial, onSearch }) {
  const [q, setQ] = useState(initial);
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); onSearch(q.trim()); }} className="flex w-full gap-2 md:max-w-md">
      <label htmlFor="pt-co-q" className="sr-only">Search companies</label>
      <input id="pt-co-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code, ID, city or contact…"
        className="h-10 w-full rounded-lg border border-[#e7e9ee] bg-white px-3 text-sm outline-none focus:border-[#1f4693]/60" />
      <Button type="submit" variant="primary">Search</Button>
    </form>
  );
}

export default function CompaniesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { canEdit, isManager } = useRole();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(null); // null | "new" | company
  const [confirm, setConfirm] = useState(null);
  const opts = Object.fromEntries(params.entries());
  const key = params.toString();
  const { data, error, loading, reload } = useLoad(() => listCompanies({
    q: opts.q, state: opts.state || "active", status: opts.status, sort: opts.sort, dir: opts.dir, page: opts.page, pageSize: 20,
  }), [key]);

  function update(patch, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, String(v)) : next.delete(k));
    if (resetPage) next.delete("page");
    setParams(next);
  }
  const sort = { key: opts.sort || "company_name", dir: opts.dir || "asc" };
  const page = data?.page || 1;

  const columns = [
    { key: "serial_no", label: "Sl. No.", sortable: false, className: "w-16", render: (c) => <span className="tabular-nums text-[#676b7a]">{(page - 1) * 20 + data.rows.indexOf(c) + 1}</span> },
    {
      key: "company_name", label: "Company Name", render: (c) => (
        <div className="min-w-[12rem]">
          <Link href={`/admin/project-tracker/companies/${c.id}`} className="font-semibold text-[#1f4693] hover:underline">{c.company_name}</Link>
          <p className="text-xs text-[#676b7a]">
            {c.company_number}{c.company_code ? ` · ${c.company_code}` : ""}{c.city ? ` · ${c.city}` : ""} · {labelOf(COMPANY_TYPE, c.company_type)}
          </p>
          {c.archived_at && <Badge value="archived" tone="neutral" label="Archived" className="mt-1" />}
          {!c.archived_at && c.status !== "active" && <Badge value={c.status} label={labelOf(COMPANY_STATUS, c.status)} className="mt-1" />}
        </div>
      ),
    },
    { key: "total_projects", label: "Total Projects", className: "text-center", render: (c) => <span className="font-semibold tabular-nums">{c.total_projects}</span> },
    { key: "live_projects", label: "Live", className: "text-center", render: (c) => <span className="tabular-nums text-emerald-700">{c.live_projects}</span> },
    { key: "in_progress_projects", label: "In Progress", className: "text-center", render: (c) => <span className="tabular-nums text-amber-800">{c.in_progress_projects}</span> },
    { key: "updated_at", label: "Last Updated", render: (c) => <span className="whitespace-nowrap text-xs">{formatDateTime(c.last_project_activity_at && c.last_project_activity_at > c.updated_at ? c.last_project_activity_at : c.updated_at)}</span> },
    {
      key: "_actions", label: <span className="sr-only">Actions</span>, sortable: false, className: "w-px whitespace-nowrap text-right",
      render: (c) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon={Eye} onClick={() => navigate(`/admin/project-tracker/companies/${c.id}`)} aria-label={`View ${c.company_name}`}>View</Button>
          {canEdit && !c.archived_at && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(c)} aria-label={`Edit ${c.company_name}`}>Edit</Button>}
          {canEdit && !c.archived_at && <Button size="sm" variant="ghost" icon={Archive} onClick={() => setConfirm({ kind: "archive", c })} aria-label={`Archive ${c.company_name}`}>Archive</Button>}
          {isManager && c.archived_at && <Button size="sm" variant="ghost" icon={ArchiveRestore} onClick={() => setConfirm({ kind: "restore", c })}>Restore</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Project Tracker", href: "/admin/project-tracker" }, { label: "Companies" }]} />
      <PageHeader title="Companies" icon={Building2} subtitle="Every client company and its projects. Open a company to see and add its projects."
        actions={canEdit && <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>Add Company</Button>} />

      <section aria-label="Search and filters" className="flex flex-col gap-3 rounded-2xl border border-[#e7e9ee] bg-white p-4 md:flex-row md:items-end md:justify-between">
        <SearchForm key={opts.q || ""} initial={opts.q || ""} onSearch={(q) => update({ q })} />
        <div className="flex flex-wrap gap-3">
          <label className="text-xs font-medium text-[#676b7a]">Show
            <select value={opts.state || "active"} onChange={(e) => update({ state: e.target.value === "active" ? "" : e.target.value })}
              className="mt-1 block h-9 rounded-lg border border-[#e7e9ee] bg-white px-2 text-sm text-[#2b303b]">
              <option value="active">Active companies</option><option value="archived">Archived companies</option><option value="all">All</option>
            </select>
          </label>
          <label className="text-xs font-medium text-[#676b7a]">Status
            <select value={opts.status || ""} onChange={(e) => update({ status: e.target.value })}
              className="mt-1 block h-9 rounded-lg border border-[#e7e9ee] bg-white px-2 text-sm text-[#2b303b]">
              <option value="">Any</option>
              {COMPANY_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </section>

      {error && <Banner tone="danger">{error.message}</Banner>}
      {!data ? <Spinner label="Loading companies…" /> : (
        <div className={loading ? "opacity-60 transition-opacity" : ""} aria-busy={loading}>
          <DataTable caption="Companies" columns={columns} rows={data.rows} sort={sort}
            onSort={(k) => update({ sort: k, dir: sort.key === k && sort.dir === "asc" ? "desc" : "asc" }, false)}
            onRowClick={(c) => navigate(`/admin/project-tracker/companies/${c.id}`)}
            empty={opts.q || opts.status || opts.state ? "No companies match." : "No companies yet. Add the first one."} />
          <Pagination page={data.page} pageSize={data.pageSize} count={data.count} onPage={(n) => update({ page: n }, false)} />
        </div>
      )}

      {editing && <CompanyFormModal company={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={(c) => (editing === "new" ? navigate(`/admin/project-tracker/companies/${c.id}`) : reload())} />}
      {confirm?.kind === "archive" && (
        <ConfirmDialog title={`Archive ${confirm.c.company_name}?`} confirmLabel="Archive company" requireReason reasonLabel="Reason for archiving"
          message={confirm.c.total_projects > 0
            ? `This company has ${confirm.c.total_projects} active project(s). Archive or move them first — the system will refuse otherwise.`
            : "The company becomes read-only and leaves the active list. Nothing is deleted; a manager can restore it."}
          onConfirm={async (reason) => { await archiveRecord("pt_companies", confirm.c.id, reason); toast.push("Company archived."); reload(); }}
          onClose={() => setConfirm(null)} />
      )}
      {confirm?.kind === "restore" && (
        <ConfirmDialog title={`Restore ${confirm.c.company_name}?`} tone="primary" confirmLabel="Restore"
          message="The company becomes active again. Its archived projects stay archived until you restore them."
          onConfirm={async () => { await restoreRecord("pt_companies", confirm.c.id); toast.push("Company restored."); reload(); }}
          onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { Activity, AlertCircle, CheckCircle2, ClipboardList, ExternalLink, Eye, FileText, Info, Layers, PauseCircle, Pencil, Plus, Search, Trash2, Zap } from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import PageHeader from "../PageHeader";
import EmptyState from "../EmptyState";
import { PROJECT_STATUSES, deleteProject, fetchAllProjects } from "@/lib/api/admin/projectTracker";
import { COMMERCIAL_CATEGORIES, fetchCommercialDocuments } from "@/lib/api/admin/projectTrackerProject";
import { HealthBadge, PriorityBadge, ProgressBar, StatusBadge } from "../project-tracker/badges";
import { INPUT, formatDate } from "../project-tracker/styles";
import { ChoiceChips, Notice } from "../project-tracker/ui";
import { openDocument } from "../project-tracker/docActions";
import { BlockedLink, DocumentFormModal, DocumentViewModal } from "../project-tracker/documentDialogs";

async function loadDashboard() {
  const [projects, docs] = await Promise.all([fetchAllProjects(), fetchCommercialDocuments()]);
  return { projects, docs };
}

function CommercialCell({ docs, label, onView, onAdd }) {
  const visible = docs.slice(0, 2);
  const extra = docs.length - visible.length;
  return (
    <div className="flex items-center gap-1.5">
      {visible.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => onView(d)}
          title={`View ${label} ${d.doc_number}`}
          className="inline-flex items-center gap-1 rounded bg-[#1f4693]/8 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#1f4693] hover:bg-[#1f4693]/15"
        >
          <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
          {d.doc_number}
        </button>
      ))}
      {extra > 0 && (
        <span className="text-[11px] font-semibold text-[#9aa0ad]">+{extra}</span>
      )}
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${label.toLowerCase()}`}
        title={`Add ${label.toLowerCase()}`}
        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-[#9aa0ad] hover:bg-[#f1f4fc] hover:text-[#1f4693]"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        Add
      </button>
    </div>
  );
}

const TILES = [
  { key: "all",         label: "Total",       icon: Layers,       color: "#1f4693" },
  { key: "in_progress", label: "In Progress", icon: Zap,          color: "#c24f05" },
  { key: "live",        label: "Live",        icon: CheckCircle2, color: "#059669" },
  { key: "planning",    label: "Planning",    icon: Activity,     color: "#2563eb" },
  { key: "on_hold",     label: "On Hold",     icon: PauseCircle,  color: "#64748b" },
  { key: "issues",      label: "Open Issues", icon: AlertCircle,  color: "#dc2626" },
];

// show: "" = always, "lg" = lg+, "xl" = xl+, "2xl" = 2xl+
const COLUMNS = [
  { label: "Project ID",      show: "" },
  { label: "Project Name",    show: "" },
  { label: "Client",          show: "" },
  { label: "Status",          show: "" },
  { label: "Priority",        show: "" },
  { label: "Progress %",      show: "" },
  { label: "Health",          show: "" },
  { label: "Project Manager", show: "lg" },
  { label: "Target Date",     show: "lg" },
  { label: "Next Action",     show: "lg" },
  { label: "Type",            show: "xl" },
  { label: "Start Date",      show: "xl" },
  { label: "Live URL",        show: "xl" },
  { label: "Repo / Source",   show: "xl" },
  ...COMMERCIAL_CATEGORIES.map((c) => ({ label: `${c.single} No.`, show: "xl" })),
  { label: "Notes",           show: "2xl" },
  { label: "Actions",         show: "" },
];

// Dashboard table columns, in order, with fixed widths (px). Total > screen width = side scroll.
const TABLE_COLUMNS = [
  { label: "Project ID",     width: 130 },
  { label: "Project Name",   width: 220 },
  { label: "Client",         width: 130 },
  { label: "Status",         width: 130 },
  { label: "Priority",       width: 110 },
  { label: "Progress %",     width: 160 },
  { label: "Health",         width: 130 },
  { label: "Start Date",     width: 130 },
  { label: "End Date",       width: 140 },
  { label: "Completed Date", width: 150 },
  { label: "Next Action",    width: 220 },
  { label: "Actions",        width: 120 },
];
const TABLE_WIDTH = TABLE_COLUMNS.reduce((sum, c) => sum + c.width, 0);

const showCls = { "": "", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell", "2xl": "hidden 2xl:table-cell" };

const STATUS_BORDER = {
  live:        "#059669",
  in_progress: "#c24f05",
  planning:    "#2563eb",
  on_hold:     "#94a3b8",
  completed:   "#0d9488",
  cancelled:   "#dc2626",
};

// border color tokens
const BD = "#dde6f5";       // body cell border
const BD_HD = "#2a4fa0";    // header cell border (on navy bg)

// Natural order by Project ID: ZT-AIMS-001, ZT-AIMS-002 … ZT-AIMS-010, then ZT-STSLEV-001 …
const byProjectCode = (a, b) =>
  String(a.project_code ?? "").localeCompare(String(b.project_code ?? ""), "en", { numeric: true, sensitivity: "base" });
const Dash = () => <span className="select-none text-[#c8cdd8]">—</span>;

function SafeLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 truncate text-[#1f4693] hover:text-[#c24f05] hover:underline"
    >
      <span className="truncate">{children}</span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

// Whole days from date string a to b ("YYYY-MM-DD"); positive = b is later.
const daysBetween = (a, b) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function DateText({ value }) {
  const text = formatDate(value);
  return text ? <span className="whitespace-nowrap tabular-nums">{text}</span> : <Dash />;
}

/** End date promised to the client; flags it when it has passed and the project is not finished. */
function EndDateCell({ project }) {
  const { end_date: end, completed_date: done, status } = project;
  if (!end) return <Dash />;
  const late = !done && !["completed", "live", "cancelled"].includes(status) ? daysBetween(end, todayIso()) : 0;
  return (
    <span className="flex flex-col gap-0.5">
      <DateText value={end} />
      {late > 0 && (
        <span className="w-fit rounded bg-[#fee2e2] px-1.5 text-[10.5px] font-semibold text-[#b91c1c]">
          Overdue {late} {late === 1 ? "day" : "days"}
        </span>
      )}
    </span>
  );
}

/** Actual completion date, compared with the promised end date. */
function CompletedCell({ project }) {
  const { end_date: end, completed_date: done } = project;
  if (!done) return <Dash />;
  const delay = end ? daysBetween(end, done) : null;
  return (
    <span className="flex flex-col gap-0.5">
      <DateText value={done} />
      {delay != null && (
        delay > 0 ? (
          <span className="w-fit rounded bg-[#fee2e2] px-1.5 text-[10.5px] font-semibold text-[#b91c1c]">
            Delayed {delay} {delay === 1 ? "day" : "days"}
          </span>
        ) : (
          <span className="w-fit rounded bg-[#dcfce7] px-1.5 text-[10.5px] font-semibold text-[#15803d]">
            {delay === 0 ? "On time" : `Early ${-delay} ${delay === -1 ? "day" : "days"}`}
          </span>
        )
      )}
    </span>
  );
}

const isHttpUrl = (v) => /^https?:\/\/\S+$/i.test(v ?? "");
const shortUrl = (v) => v.replace(/^https?:\/\//i, "").replace(/\/$/, "");

export default function ProjectTrackerDashboardPage() {
  const { data, loading, error, reload } = useAdminData(loadDashboard);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState(null);
  const [adding, setAdding] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { project }
  const [deleting, setDeleting] = useState(false);

  const projects = useMemo(
    () => [...(data?.projects ?? [])].sort(byProjectCode),
    [data],
  );

  const docsByProject = useMemo(() => {
    const map = new Map();
    for (const d of data?.docs ?? []) {
      if (!map.has(d.project_id)) map.set(d.project_id, {});
      const byCat = map.get(d.project_id);
      (byCat[d.category] ??= []).push(d);
    }
    return map;
  }, [data]);

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deleteProject(confirmDelete.project.id);
      setConfirmDelete(null);
      setNotice({ text: `Project "${confirmDelete.project.name}" deleted.`, tone: "success" });
      await reload();
    } catch (err) {
      setNotice({ text: `Delete failed: ${err.message}`, tone: "warning" });
    } finally {
      setDeleting(false);
    }
  }

  async function openDoc(doc, download) {
    const { result, url } = await openDocument(doc, { download });
    if (result === "failed") setNotice({ text: "Could not open the file. Please try again.", tone: "warning" });
    if (result === "blocked") setNotice({ tone: "warning", text: <BlockedLink doc={doc} url={url} download={download} /> });
  }

  const counts = useMemo(() => {
    const c = { all: projects.length };
    for (const s of PROJECT_STATUSES) c[s.value] = 0;
    for (const p of projects) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [projects]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (!q) return true;
      const numbers = Object.values(docsByProject.get(p.id) ?? {}).flat().map((d) => d.doc_number);
      return [p.project_code, p.name, p.company?.name, p.project_type, p.project_manager, p.next_action, ...numbers]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [projects, filter, query, docsByProject]);

  if (loading) return <AdminLoading />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Zyllo Tech — Project Overview"
        subtitle="Every project across your clients, one row per project."
        icon={ClipboardList}
      />

      {error ? (
        <EmptyState bordered icon={ClipboardList} title="Could not load projects" message={error.message} />
      ) : (
        <>
          {/* ── Compact KPI metrics strip ── */}
          <div className="overflow-hidden rounded-xl border border-[#dde5f5] bg-white shadow-sm">
            <div className="flex divide-x divide-[#eef1f7]">
              {TILES.map((t) => {
                const isIssues = t.key === "issues";
                const selected = filter === t.key;
                const value = isIssues ? 0 : counts[t.key] ?? 0;
                const Icon = t.icon;

                const inner = (
                  <>
                    {selected && (
                      <span
                        className="absolute inset-x-0 top-0 h-[3px] rounded-t-sm"
                        style={{ background: t.color }}
                      />
                    )}
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <Icon
                        className="h-3.5 w-3.5 shrink-0"
                        style={{ color: selected ? t.color : "#9aa0ad" }}
                        aria-hidden="true"
                      />
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest"
                        style={{ color: selected ? t.color : "#9aa0ad" }}
                      >
                        {t.label}
                      </span>
                    </div>
                    <span
                      className="block text-[28px] font-black tabular-nums leading-none"
                      style={{ color: isIssues ? "#c8cdd8" : selected ? t.color : "#0d1631" }}
                    >
                      {value}
                    </span>
                  </>
                );

                return isIssues ? (
                  <div key={t.key} className="relative flex flex-1 flex-col px-5 py-4">{inner}</div>
                ) : (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFilter(selected && t.key !== "all" ? "all" : t.key)}
                    aria-pressed={selected}
                    className={`relative flex flex-1 flex-col px-5 py-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1f4693] ${
                      selected ? "bg-[#f4f7ff]" : "hover:bg-[#f8faff]"
                    }`}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          </div>

          {/* How-to-use */}
          <p className="flex items-start gap-2 rounded-lg border border-[#e3ecf8] bg-[#f5f8ff] px-4 py-2.5 text-[12.5px] text-[#676b7a]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1f4693]" aria-hidden="true" />
            <span>
              Add clients under{" "}
              <Link href="/admin/project-tracker/companies" className="font-semibold text-[#1f4693] hover:underline">
                Clients
              </Link>
              , then add projects on each client page. Click a metric above to filter. Use{" "}
              <span className="font-semibold">+ Add</span> in the commercial columns to attach quotations, invoices, or orders.
            </span>
          </p>

          <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

          {/* ── Projects table ── */}
          <section className="overflow-hidden rounded-xl border border-[#dde5f5] bg-white shadow-md">
            {/* Toolbar */}
            <div className="flex flex-col gap-3 border-b border-[#eef1f7] bg-[#fafbff] px-5 py-3.5 sm:flex-row sm:items-center">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[14px] font-bold text-[#0d1631]">
                  {filter === "all" ? "All Projects" : TILES.find((t) => t.key === filter)?.label}
                </h2>
                <span className="rounded bg-[#eef2fb] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#1f4693]">
                  {rows.length === projects.length ? projects.length : `${rows.length} / ${projects.length}`}
                </span>
              </div>
              <div className="relative sm:ml-auto sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9aa0ad]" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ID, name, client, invoice…"
                  aria-label="Search projects"
                  className={`${INPUT} border-[#e3e9f5] py-1.5 pl-8 text-[13px] focus:border-[#1f4693]/50 focus:ring-2 focus:ring-[#1f4693]/10`}
                />
              </div>
            </div>

            {/* Filter chips */}
            <div className="border-b border-[#eef1f7] px-5 py-2.5">
              <ChoiceChips
                id="Filter by status"
                size="sm"
                value={filter}
                onChange={(v) => setFilter(v)}
                options={[{ value: "all", label: "All statuses" }, ...PROJECT_STATUSES]}
              />
            </div>

            {projects.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No projects yet"
                message="Open a client and add its projects — they will be listed here."
                action={
                  <Link
                    href="/admin/project-tracker/companies"
                    className="inline-flex items-center rounded-lg bg-gradient-to-r from-[#f7941e] to-[#f96706] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
                  >
                    Go to Clients
                  </Link>
                }
              />
            ) : rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#676b7a]">No projects match this filter.</p>
            ) : (
              /* Fixed column widths wider than the screen: the table scrolls sideways
                 (scroll bar below it) and the Actions column stays pinned on the right. */
              <div className="overflow-x-auto">
              <table
                className="border-collapse text-left text-[13px]"
                style={{ tableLayout: "fixed", width: TABLE_WIDTH, minWidth: "100%" }}
              >
                <colgroup>
                  {TABLE_COLUMNS.map((c) => <col key={c.label} style={{ width: c.width }} />)}
                </colgroup>
                <thead>
                  <tr>
                    {TABLE_COLUMNS.map(({ label }, i) => (
                      <th
                        key={label}
                        scope="col"
                        style={{ borderColor: BD_HD }}
                        className={`border bg-[#1f4693] px-3 py-2.5 text-[10px] font-bold uppercase tracking-[.12em] text-white/85 ${
                          i === TABLE_COLUMNS.length - 1 ? "sticky right-0 z-10 text-center shadow-[-4px_0_6px_-4px_rgba(13,22,49,.35)]" : ""
                        }`}
                      >
                        <span className="block truncate">{label}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, rowIdx) => {
                    const companyHref = p.company ? `/admin/project-tracker/companies/${p.company.id}` : null;
                    const isEven = rowIdx % 2 === 0;
                    const rowBg = isEven ? "#ffffff" : "#f8fafd";
                    const hoverBg = "#e8f0fe";
                    const statusColor = STATUS_BORDER[p.status];
                    const tdStyle = { borderColor: BD, background: rowBg };
                    const td = `border px-3 py-2.5 text-[#4a5068]`;

                    return (
                      <tr
                        key={p.id}
                        onMouseEnter={(e) => { for (const cell of e.currentTarget.cells) cell.style.background = hoverBg; }}
                        onMouseLeave={(e) => { for (const cell of e.currentTarget.cells) cell.style.background = cell.dataset.bg ?? rowBg; }}
                      >
                        {/* Project ID */}
                        <td
                          className="border px-3 py-2.5"
                          style={{ borderColor: BD, background: rowBg, boxShadow: statusColor ? `inset 3px 0 0 ${statusColor}` : undefined }}
                          data-bg={rowBg}
                        >
                          <span className="inline-flex w-full items-center overflow-hidden rounded bg-[#eef2fb] px-2 py-0.5 font-mono text-[11px] font-bold text-[#1f4693]">
                            <span className="block truncate">{p.project_code}</span>
                          </span>
                        </td>

                        {/* Project Name */}
                        <td className={td} style={tdStyle} data-bg={rowBg}>
                          <Link href={`/admin/project-tracker/projects/${p.id}`} title={p.name}
                            className="block truncate font-semibold text-[#1a2340] hover:text-[#1f4693] hover:underline">
                            {p.name}
                          </Link>
                        </td>

                        {/* Client */}
                        <td className={td} style={tdStyle} data-bg={rowBg}>
                          {companyHref
                            ? <Link href={companyHref} title={p.company.name} className="block truncate hover:text-[#1f4693] hover:underline">{p.company.name}</Link>
                            : <Dash />}
                        </td>

                        {/* Status */}
                        <td className={td} style={tdStyle} data-bg={rowBg}><StatusBadge status={p.status} /></td>

                        {/* Priority */}
                        <td className={td} style={tdStyle} data-bg={rowBg}><PriorityBadge priority={p.priority} /></td>

                        {/* Progress */}
                        <td className={td} style={tdStyle} data-bg={rowBg}><ProgressBar value={p.progress} className="w-full" /></td>

                        {/* Health */}
                        <td className={td} style={tdStyle} data-bg={rowBg}><HealthBadge health={p.health} /></td>

                        {/* Start / End (promised to client) / Completed (actual) */}
                        <td className={td} style={tdStyle} data-bg={rowBg}><DateText value={p.start_date} /></td>
                        <td className={td} style={tdStyle} data-bg={rowBg}><EndDateCell project={p} /></td>
                        <td className={td} style={tdStyle} data-bg={rowBg}><CompletedCell project={p} /></td>

                        {/* Next Action */}
                        <td className={td} style={tdStyle} data-bg={rowBg}>
                          <span className="block truncate" title={p.next_action || undefined}>{p.next_action || <Dash />}</span>
                        </td>

                        {/* Actions */}
                        <td
                          className="sticky right-0 z-[1] border px-1.5 py-2.5 shadow-[-4px_0_6px_-4px_rgba(13,22,49,.18)]"
                          style={{ borderColor: BD, background: rowBg }}
                          data-bg={rowBg}
                        >
                          <div className="flex items-center justify-center gap-0.5">
                            <Link href={`/admin/project-tracker/projects/${p.id}`} title="View project"
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-[#1f4693] hover:bg-[#1f4693]/10">
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">View</span>
                            </Link>
                            <Link href={`/admin/project-tracker/projects/${p.id}?edit=1`} title="Edit project"
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-[#64748b] hover:bg-[#f1f4fc] hover:text-[#1f4693]">
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Edit</span>
                            </Link>
                            <button type="button" title="Delete project" onClick={() => setConfirmDelete({ project: p })}
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-[#9aa0ad] hover:bg-[#fee2e2] hover:text-[#dc2626]">
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </section>
        </>
      )}

      {viewing && (
        <DocumentViewModal
          doc={viewing.doc}
          projectLabel={`${viewing.project.project_code} ${viewing.project.name}${viewing.project.company ? ` — ${viewing.project.company.name}` : ""}`}
          onOpen={openDoc}
          onClose={() => setViewing(null)}
        />
      )}
      {adding && (
        <DocumentFormModal
          projectId={adding.project.id}
          defaultCategory={adding.category}
          lockCategory
          onClose={() => setAdding(null)}
          onSaved={async (text) => {
            setAdding(null);
            setNotice({ text: `${text} (${adding.project.project_code} ${adding.project.name})`, tone: "success" });
            await reload();
          }}
        />
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start gap-3 bg-[#fef2f2] px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fee2e2]">
                <Trash2 className="h-4.5 w-4.5 text-[#dc2626]" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[13px] font-bold text-[#1a2340]">Delete Project</p>
                <p className="mt-0.5 text-[12px] text-[#6b7280]">
                  This will permanently remove{" "}
                  <span className="font-semibold text-[#1a2340]">
                    {confirmDelete.project.project_code} — {confirmDelete.project.name}
                  </span>{" "}
                  and all its associated data.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5568] hover:bg-[#f8fafc] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-[#dc2626] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#b91c1c] disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

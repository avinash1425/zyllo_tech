import { useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { ClipboardList, ExternalLink, FileText, Info, Plus, Search } from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import PageHeader from "../PageHeader";
import EmptyState from "../EmptyState";
import { PROJECT_STATUSES, fetchAllProjects } from "@/lib/api/admin/projectTracker";
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

/** Quotation / invoice / order numbers of one project; each opens View, "+" adds another. */
function CommercialCell({ docs, label, onView, onAdd }) {
  return (
    <div className="flex min-w-[8.5rem] flex-col items-start gap-1">
      {docs.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => onView(d)}
          title={`View ${label} ${d.doc_number}`}
          className="inline-flex max-w-[11rem] items-center gap-1 rounded-md bg-[#1f4693]/8 px-1.5 py-0.5 font-mono text-xs font-semibold text-[#1f4693] hover:bg-[#1f4693]/15"
        >
          <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{d.doc_number}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${label.toLowerCase()}`}
        className="inline-flex items-center gap-0.5 rounded px-1 text-[11px] font-semibold text-[#9aa0ad] hover:text-[#c24f05]"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        Add
      </button>
    </div>
  );
}

// Project Tracker dashboard, laid out like the Zyllo Tech project sheet:
// overview counts on top, then one row per project with the sheet's columns.

const TILES = [
  { key: "all", label: "Total projects", accent: "from-[#1f4693] to-[#3089a6]" },
  { key: "in_progress", label: "In progress", accent: "from-[#f7941e] to-[#f96706]" },
  { key: "live", label: "Live", accent: "from-emerald-500 to-emerald-600" },
  { key: "planning", label: "Planning", accent: "from-sky-500 to-sky-600" },
  { key: "on_hold", label: "On hold", accent: "from-slate-400 to-slate-500" },
  { key: "issues", label: "Open issues", accent: "from-red-500 to-red-600" },
];

const COLUMNS = [
  "Project ID",
  "Project Name",
  "Client",
  "Type",
  "Status",
  "Progress %",
  "Project Manager",
  "Priority",
  "Start Date",
  "Target Date",
  "Health",
  "Live URL",
  "Repo / Source",
  "Next Action",
  ...COMMERCIAL_CATEGORIES.map((c) => `${c.single} No.`),
  "Notes",
];

const codeNumber = (code) => Number(String(code ?? "").replace(/\D/g, "")) || 0;
const Dash = () => <span className="text-[#c4c8d0]">—</span>;

function SafeLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-[16rem] items-center gap-1 truncate text-[#1f4693] hover:text-[#c24f05] hover:underline"
    >
      <span className="truncate">{children}</span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

const isHttpUrl = (v) => /^https?:\/\/\S+$/i.test(v ?? "");
const shortUrl = (v) => v.replace(/^https?:\/\//i, "").replace(/\/$/, "");

export default function ProjectTrackerDashboardPage() {
  const { data, loading, error, reload } = useAdminData(loadDashboard);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState(null); // { doc, project }
  const [adding, setAdding] = useState(null); // { project, category }
  const [notice, setNotice] = useState(null);

  const projects = useMemo(
    () => [...(data?.projects ?? [])].sort((a, b) => codeNumber(a.project_code) - codeNumber(b.project_code)),
    [data],
  );

  // projectId -> category -> [documents]
  const docsByProject = useMemo(() => {
    const map = new Map();
    for (const d of data?.docs ?? []) {
      if (!map.has(d.project_id)) map.set(d.project_id, {});
      const byCat = map.get(d.project_id);
      (byCat[d.category] ??= []).push(d);
    }
    return map;
  }, [data]);

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Zyllo Tech — Project Overview"
        subtitle="Every project across your client companies, one row per project."
        icon={ClipboardList}
      />

      {error ? (
        <EmptyState bordered icon={ClipboardList} title="Could not load projects" message={error.message} />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {TILES.map((t) => {
              const isIssues = t.key === "issues";
              const selected = filter === t.key;
              const value = isIssues ? 0 : counts[t.key] ?? 0;
              const body = (
                <>
                  <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.accent}`} />
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#676b7a]">{t.label}</span>
                  <span className="mt-1 block text-3xl font-bold tabular-nums text-[#101a3a]">{value}</span>
                  {isIssues && <span className="mt-0.5 block text-[11px] text-[#9aa0ad]">Issues log coming soon</span>}
                </>
              );
              const base = "relative block w-full overflow-hidden rounded-2xl border bg-white p-4 text-left shadow-sm";
              return (
                <li key={t.key}>
                  {isIssues ? (
                    <div className={`${base} border-[#e7e9ee]`}>{body}</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setFilter(selected && t.key !== "all" ? "all" : t.key)}
                      aria-pressed={selected}
                      className={`${base} transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f7941e] ${
                        selected ? "border-[#f7941e] ring-1 ring-[#f7941e]/40" : "border-[#e7e9ee]"
                      }`}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="flex items-start gap-2 rounded-xl border border-[#e7e9ee] bg-white px-4 py-3 text-sm text-[#676b7a]">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#1f4693]" aria-hidden="true" />
            <span>
              <span className="font-semibold text-[#2b303b]">How to use:</span> add a client under{" "}
              <Link href="/admin/project-tracker/companies" className="font-medium text-[#1f4693] hover:underline">
                Client Companies
              </Link>
              , then add each of its projects on the company page — every project appears here as one row. Click a
              count above to filter the table. In the Quotation / Invoice / Sales order / Purchase order columns, click a
              number to view or download it, or <span className="font-semibold">+ Add</span> to upload one.
            </span>
          </p>

          <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

          <section className="rounded-2xl border border-[#e7e9ee] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#e7e9ee] p-4 sm:flex-row sm:items-center">
              <h2 className="text-base font-bold text-[#2b303b]">Projects</h2>
              <div className="relative sm:ml-auto sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0ad]" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ID, name, client, invoice / PO no.…"
                  aria-label="Search projects"
                  className={`${INPUT} border-[#e7e9ee] py-2 pl-9`}
                />
              </div>
            </div>
            <div className="border-b border-[#e7e9ee] px-4 py-3">
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
                message="Open a client company and add its projects — they will be listed here."
                action={
                  <Link
                    href="/admin/project-tracker/companies"
                    className="inline-flex items-center rounded-lg bg-gradient-to-r from-[#f7941e] to-[#f96706] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
                  >
                    Go to Client Companies
                  </Link>
                }
              />
            ) : rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#676b7a]">No projects match this filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[2400px] text-left text-sm">
                  <thead className="bg-[#fafbfc] text-xs uppercase tracking-wide text-[#676b7a]">
                    <tr>
                      {COLUMNS.map((c, i) => (
                        <th
                          key={c}
                          scope="col"
                          className={`whitespace-nowrap px-3 py-3 font-semibold ${i === 0 ? "sticky left-0 z-10 bg-[#fafbfc]" : ""}`}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eef0f3] align-top">
                    {rows.map((p) => {
                      const companyHref = p.company ? `/admin/project-tracker/companies/${p.company.id}` : null;
                      return (
                        <tr key={p.id} className="hover:bg-[#fafbfc]">
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-3 font-mono text-xs font-semibold text-[#1f4693]">
                            {p.project_code}
                          </td>
                          <td className="min-w-[10rem] px-3 py-3 font-semibold text-[#2b303b]">
                            <Link href={`/admin/project-tracker/projects/${p.id}`} className="hover:text-[#c24f05] hover:underline">
                              {p.name}
                            </Link>
                          </td>
                          <td className="min-w-[10rem] px-3 py-3 text-[#2b303b]">
                            {companyHref ? (
                              <Link href={companyHref} className="hover:text-[#c24f05]">
                                {p.company.name}
                              </Link>
                            ) : (
                              <Dash />
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-[#2b303b]">{p.project_type || <Dash />}</td>
                          <td className="px-3 py-3">
                            <StatusBadge status={p.status} />
                          </td>
                          <td className="px-3 py-3">
                            <ProgressBar value={p.progress} className="w-28" />
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-[#2b303b]">{p.project_manager || <Dash />}</td>
                          <td className="px-3 py-3">
                            <PriorityBadge priority={p.priority} />
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-[#2b303b]">{formatDate(p.start_date) ?? <Dash />}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-[#2b303b]">{formatDate(p.end_date) ?? <Dash />}</td>
                          <td className="px-3 py-3">
                            <HealthBadge health={p.health} />
                          </td>
                          <td className="px-3 py-3">
                            {p.live_url ? <SafeLink href={p.live_url}>{shortUrl(p.live_url)}</SafeLink> : <Dash />}
                          </td>
                          <td className="min-w-[10rem] max-w-[16rem] px-3 py-3 text-[#2b303b]">
                            {!p.repo_source ? (
                              <Dash />
                            ) : isHttpUrl(p.repo_source) ? (
                              <SafeLink href={p.repo_source}>{shortUrl(p.repo_source)}</SafeLink>
                            ) : (
                              <span className="break-words">{p.repo_source}</span>
                            )}
                          </td>
                          <td className="min-w-[12rem] max-w-[18rem] px-3 py-3 text-[#2b303b]">
                            <span className="break-words">{p.next_action || <Dash />}</span>
                          </td>
                          {COMMERCIAL_CATEGORIES.map((c) => (
                            <td key={c.value} className="px-3 py-3">
                              <CommercialCell
                                label={c.single}
                                docs={docsByProject.get(p.id)?.[c.value] ?? []}
                                onView={(doc) => setViewing({ doc, project: p })}
                                onAdd={() => setAdding({ project: p, category: c.value })}
                              />
                            </td>
                          ))}
                          <td className="min-w-[12rem] max-w-[18rem] px-3 py-3 text-[#676b7a]">
                            <span className="line-clamp-3 break-words" title={p.notes || undefined}>
                              {p.notes || <Dash />}
                            </span>
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
    </div>
  );
}

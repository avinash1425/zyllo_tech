import { useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { Building2, Plus, Search } from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import PageHeader from "../PageHeader";
import EmptyState from "../EmptyState";
import { fetchCompanies } from "@/lib/api/admin/projectTracker";
import CompanyFormModal from "../project-tracker/CompanyFormModal";
import { CompanyLogo, Notice } from "../project-tracker/ui";
import { BTN_PRIMARY, INPUT } from "../project-tracker/styles";

// Page 1: every client company as a card (logo on top, name below).
// Clicking a card opens that company's projects page.
export default function ProjectTrackerCompaniesPage() {
  const { data, loading, error, reload } = useAdminData(fetchCompanies);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(null);

  const companies = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.name, c.industry, c.contact_person, c.country].filter(Boolean).some((v) => v.toLowerCase().includes(q)),
    );
  }, [companies, query]);

  async function onSaved(text, tone) {
    setAdding(false);
    setNotice({ text, tone });
    await reload();
  }

  if (loading) return <AdminLoading />;

  const addButton = (
    <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY} disabled={Boolean(error)}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      Add company
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Client Companies"
        subtitle="Open a company to see and add its projects."
        icon={Building2}
        actions={addButton}
      />

      <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

      {error ? (
        <EmptyState bordered icon={Building2} title="Could not load companies" message={error.message} />
      ) : companies.length === 0 ? (
        <EmptyState
          bordered
          icon={Building2}
          title="No client companies yet"
          message="Add your first client company to get started."
          action={addButton}
        />
      ) : (
        <>
          {companies.length > 6 && (
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0ad]" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search companies…"
                aria-label="Search companies"
                className={`${INPUT} border-[#e7e9ee] pl-9`}
              />
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#676b7a]">No companies match your search.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/project-tracker/companies/${c.id}`}
                    className="group flex h-full flex-col items-center gap-3 rounded-2xl border border-[#e7e9ee] bg-white p-5 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#1f4693]/30 hover:bg-[#f7f9ff] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693]"
                  >
                    <CompanyLogo name={c.name} url={c.logo_url} className="h-20 w-20 border border-[#eef0f3]" />
                    <span className="line-clamp-2 break-words text-sm font-semibold text-[#2b303b] group-hover:text-[#1f4693]">
                      {c.name}
                    </span>
                    <span className="mt-auto text-xs text-[#676b7a]">
                      {c.project_count === 1 ? "1 project" : `${c.project_count} projects`}
                      {c.status === "inactive" && " · Inactive"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {adding && <CompanyFormModal company={null} onClose={() => setAdding(false)} onSaved={onSaved} />}
    </div>
  );
}

import { useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { KeyRound, Search } from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import PageHeader from "../PageHeader";
import EmptyState from "../EmptyState";
import { fetchAccessCompanies } from "@/lib/api/admin/projectTrackerProject";
import { CompanyLogo } from "../project-tracker/ui";
import { INPUT } from "../project-tracker/styles";

// Access & Logins, step 1: pick a company.
export default function AccessCompaniesPage() {
  const { data, loading, error } = useAdminData(fetchAccessCompanies);
  const [query, setQuery] = useState("");
  const companies = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? companies.filter((c) => c.name.toLowerCase().includes(q)) : companies;
  }, [companies, query]);

  if (loading) return <AdminLoading />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Access & Logins"
        subtitle="Every login of every project, by company. Open a company, then a project, to view, edit or download its logins."
        icon={KeyRound}
      />

      {error ? (
        <EmptyState bordered icon={KeyRound} title="Could not load companies" message={error.message} />
      ) : companies.length === 0 ? (
        <EmptyState
          bordered
          icon={KeyRound}
          title="No companies yet"
          message="Add client companies and projects in Client Companies first."
          action={
            <Link href="/admin/project-tracker/companies" className="inline-flex items-center rounded-lg bg-gradient-to-r from-[#f7941e] to-[#f96706] px-4 py-2 text-sm font-semibold text-white">
              Go to Client Companies
            </Link>
          }
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
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/admin/project-tracker/access/${c.id}`}
                  className="group flex h-full flex-col items-center gap-3 rounded-2xl border border-[#e7e9ee] bg-white p-5 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#f7941e]/50 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f7941e]"
                >
                  <CompanyLogo name={c.name} url={c.logo_url} className="h-20 w-20 border border-[#eef0f3]" />
                  <span className="line-clamp-2 break-words text-sm font-semibold text-[#2b303b] group-hover:text-[#c24f05]">{c.name}</span>
                  <span className="mt-auto text-xs text-[#676b7a]">
                    {c.project_count} project{c.project_count === 1 ? "" : "s"} · {c.login_count} login{c.login_count === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-[#676b7a]">No companies match your search.</p>}
        </>
      )}
    </div>
  );
}

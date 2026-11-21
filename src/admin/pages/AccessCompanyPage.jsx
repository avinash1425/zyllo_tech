import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { useRouter } from "@/lib/nx/navigation";
import { ArrowLeft, Download, Eye, FolderOpen, KeyRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import EmptyState from "../EmptyState";
import { fetchAccessProjects, fetchCompanyCredentials, fetchCredentials } from "@/lib/api/admin/projectTrackerProject";
import { CompanyLogo, Notice } from "../project-tracker/ui";
import { StatusBadge } from "../project-tracker/badges";
import { BTN_PRIMARY } from "../project-tracker/styles";
import { ReauthModal } from "../project-tracker/credentialDialogs";
import { downloadLoginsExcel, loginsFileName } from "../project-tracker/exportLogins";

// Access & Logins, step 2: the projects of one company.
export default function AccessCompanyPage() {
  const { companyId } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const loader = useCallback(() => fetchAccessProjects(companyId), [companyId]);
  const { data, loading, error } = useAdminData(loader, [companyId]);
  const [busy, setBusy] = useState(null);
  const [pending, setPending] = useState(null);
  const [notice, setNotice] = useState(null);

  async function download(project) {
    const { company } = data;
    setBusy(project?.id ?? "all");
    setNotice(null);
    try {
      const items = project
        ? (await fetchCredentials(project.id)).map((cred) => ({
            cred,
            company: company.name,
            project_code: project.project_code,
            project: project.name,
            live_url: project.live_url,
          }))
        : (await fetchCompanyCredentials(company.id)).map(({ project: p, ...cred }) => ({
            cred,
            company: company.name,
            project_code: p.project_code,
            project: p.name,
            live_url: p.live_url,
          }));
      const result = await downloadLoginsExcel({
        items,
        fileName: loginsFileName(company.name, project?.project_code),
        title: project ? `${company.name} — ${project.project_code} ${project.name}` : `${company.name} — all projects`,
        exportedBy: user?.email,
      });
      if (result.status === "reauth") setPending(() => () => download(project));
      else if (result.status === "error") setNotice({ text: result.message, tone: "warning" });
      else setNotice({ text: `Downloaded ${result.count} login${result.count === 1 ? "" : "s"} (${result.withPasswords} with passwords — recorded in the access log).`, tone: "success" });
    } catch (e) {
      setNotice({ text: e.message || "Download failed.", tone: "warning" });
    } finally {
      setBusy(null);
    }
}


  if (loading) return <AdminLoading />;

  const back = (
    <Link href="/admin/project-tracker/access" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#676b7a] hover:text-[#c24f05]">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      All companies
    </Link>
  );

  if (error || !data?.company) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <EmptyState bordered icon={KeyRound} title={error ? "Could not load this company" : "Company not found"} message={error?.message ?? "It may have been deleted."} />
      </div>
    );
  }

  const { company, projects } = data;
  const totalLogins = projects.reduce((n, p) => n + p.login_count, 0);

  return (
    <div className="flex flex-col gap-6">
      {back}

      <section className="flex flex-col gap-4 rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <CompanyLogo name={company.name} url={company.logo_url} className="h-16 w-16 shrink-0 border border-[#eef0f3]" />
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-bold tracking-tight text-[#2b303b]">{company.name}</h1>
          <p className="text-sm text-[#676b7a]">
            {projects.length} project{projects.length === 1 ? "" : "s"} · {totalLogins} login{totalLogins === 1 ? "" : "s"}
          </p>
        </div>
        <button type="button" onClick={() => download(null)} disabled={!totalLogins || busy !== null} className={`${BTN_PRIMARY} shrink-0`}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {busy === "all" ? "Preparing…" : "Download all (Excel)"}
        </button>
      </section>

      <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

      {projects.length === 0 ? (
        <EmptyState bordered icon={FolderOpen} title="No projects yet" message="Add projects to this company in Client Companies." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#e7e9ee] bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-[#fafbfc] text-xs uppercase tracking-wide text-[#676b7a]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Project ID</th>
                <th scope="col" className="px-4 py-3 font-semibold">Project</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">Live site</th>
                <th scope="col" className="px-4 py-3 font-semibold">Logins</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef0f3]">
              {projects.map((p) => {
                const href = `/admin/project-tracker/access/${company.id}/${p.id}`;
                return (
                  <tr key={p.id} onClick={() => router.push(href)} className="cursor-pointer hover:bg-[#fafbfc]">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-[#1f4693]">{p.project_code}</td>
                    <td className="px-4 py-3 font-semibold text-[#2b303b]">
                      <Link href={href} onClick={(e) => e.stopPropagation()} className="hover:text-[#c24f05] hover:underline">
                        {p.name}
                      </Link>
                      {p.project_type && <span className="block text-xs font-normal text-[#676b7a]">{p.project_type}</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="max-w-[16rem] truncate px-4 py-3 text-[#2b303b]">
                      {p.live_url ? p.live_url.replace(/^https?:\/\//, "").replace(/\/$/, "") : <span className="text-[#c4c8d0]">—</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[#2b303b]">{p.login_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Link href={href} aria-label={`View logins of ${p.name}`} title="View" className="rounded-lg p-2 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693]">
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => download(p)}
                          disabled={!p.login_count || busy !== null}
                          aria-label={`Download logins of ${p.name} as Excel`}
                          title="Download Excel"
                          className="rounded-lg p-2 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693] disabled:opacity-40"
                        >
                          <Download className="h-4 w-4" aria-hidden="true" />
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

      {pending && (
        <ReauthModal
          onClose={() => setPending(null)}
          onConfirmed={() => {
            const fn = pending;
            setPending(null);
            fn();
          }}
        />
      )}
    </div>
  );
}

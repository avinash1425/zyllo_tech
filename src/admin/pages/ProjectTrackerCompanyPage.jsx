import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { useRouter } from "@/lib/nx/navigation";
import { ArrowLeft, Building2, CalendarDays, FolderOpen, Mail, MapPin, Pencil, Phone, Plus, Trash2, User } from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import EmptyState from "../EmptyState";
import { deleteCompany, deleteProject, fetchCompany, fetchProjects } from "@/lib/api/admin/projectTracker";
import CompanyFormModal from "../project-tracker/CompanyFormModal";
import ProjectFormModal from "../project-tracker/ProjectFormModal";
import { CompanyLogo, ConfirmDialog, Notice } from "../project-tracker/ui";
import { HealthBadge, PriorityBadge, ProgressBar, StatusBadge } from "../project-tracker/badges";
import { BTN_PRIMARY, BTN_SECONDARY, formatDate } from "../project-tracker/styles";

// Page 2: one client company and its projects as cards.
export default function ProjectTrackerCompanyPage() {
  const { companyId } = useParams();
  const router = useRouter();
  const loader = useCallback(async () => {
    const company = await fetchCompany(companyId);
    if (!company) return { company: null, projects: [] };
    return { company, projects: await fetchProjects(companyId) };
  }, [companyId]);
  const { data, loading, error, reload } = useAdminData(loader, [companyId]);

  const [editingCompany, setEditingCompany] = useState(false);
  const [deletingCompany, setDeletingCompany] = useState(false);
  const [projectForm, setProjectForm] = useState(null); // null = closed, {} = new, project = edit
  const [deletingProject, setDeletingProject] = useState(null);
  const [notice, setNotice] = useState(null);

  async function afterSave(text, tone = "success") {
    setEditingCompany(false);
    setProjectForm(null);
    setDeletingProject(null);
    setNotice({ text, tone });
    await reload();
  }

  if (loading) return <AdminLoading />;

  const back = (
    <Link
      href="/admin/project-tracker/companies"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-[#676b7a] hover:text-[#c24f05]"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      All companies
    </Link>
  );

  if (error || !data?.company) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <EmptyState
          bordered
          icon={Building2}
          title={error ? "Could not load this company" : "Company not found"}
          message={error ? error.message : "It may have been deleted."}
        />
      </div>
    );
  }

  const { company, projects } = data;
  const location = [company.address, company.country].filter(Boolean).join(", ");
  const addProject = (
    <button type="button" onClick={() => setProjectForm({})} className={BTN_PRIMARY}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      Add project
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      {back}

      <section className="overflow-hidden rounded-2xl border border-[#1a3a7a] shadow-lg">
        <div className="bg-gradient-to-r from-[#1f4693] via-[#2d5fbe] to-[#3089a6] p-5 sm:flex sm:items-center sm:gap-5">
        <CompanyLogo name={company.name} url={company.logo_url} className="h-24 w-24 shrink-0 border-2 border-white/30" textClass="text-3xl" />
        <div className="mt-4 min-w-0 flex-1 sm:mt-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-2xl font-bold tracking-tight text-white">{company.name}</h1>
            {company.status === "inactive" && (
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold text-white/80">Inactive</span>
            )}
          </div>
          {company.industry && <p className="mt-0.5 text-sm text-white/70">{company.industry}</p>}
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-white/80">
            {company.contact_person && (
              <li className="flex items-center gap-1.5">
                <User className="h-4 w-4 text-white/50" aria-hidden="true" />
                {company.contact_person}
              </li>
            )}
            {company.email && (
              <li className="flex min-w-0 items-center gap-1.5">
                <Mail className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
                <a href={`mailto:${company.email}`} className="truncate hover:text-white">
                  {company.email}
                </a>
              </li>
            )}
            {company.phone && (
              <li className="flex items-center gap-1.5">
                <Phone className="h-4 w-4 text-white/50" aria-hidden="true" />
                <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`} className="hover:text-white">
                  {company.phone}
                </a>
              </li>
            )}
            {location && (
              <li className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-white/50" aria-hidden="true" />
                {location}
              </li>
            )}
          </ul>
        </div>
        <div className="mt-4 flex gap-2 sm:mt-0 sm:self-start">
          <button type="button" onClick={() => setEditingCompany(true)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/30 bg-white/15 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setDeletingCompany(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/30 bg-white/15 px-2.5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-red-500/60"
            aria-label={`Delete ${company.name}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        </div>
      </section>

      <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold text-[#2b303b]">
          Projects <span className="text-sm font-medium text-[#676b7a]">({projects.length})</span>
        </h2>
        {projects.length > 0 && addProject}
      </div>

      {projects.length === 0 ? (
        <EmptyState
          bordered
          icon={FolderOpen}
          title="No projects yet"
          message={`Add the first project for ${company.name}.`}
          action={addProject}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const start = formatDate(p.start_date);
            const end = formatDate(p.end_date);
            return (
              <li key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-[#e3e9f5] bg-white shadow-sm transition-shadow hover:shadow-md">
                <div className="h-[3px] w-full bg-gradient-to-r from-[#1f4693] to-[#3089a6]" />
                <div className="flex flex-col gap-3 px-5 pb-4 pt-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1f4693] to-[#3089a6] text-white shadow-sm">
                      <FolderOpen className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] font-semibold text-[#1f4693]">{p.project_code}</p>
                      <h3 className="break-words font-semibold text-[#2b303b]">
                        <Link href={`/admin/project-tracker/projects/${p.id}`} className="hover:text-[#c24f05] hover:underline">
                          {p.name}
                        </Link>
                      </h3>
                      {p.project_type && <p className="text-xs text-[#676b7a]">{p.project_type}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => setProjectForm(p)}
                      aria-label={`Edit ${p.name}`}
                      className="rounded-lg p-2 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693]"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingProject(p)}
                      aria-label={`Delete ${p.name}`}
                      className="rounded-lg p-2 text-[#676b7a] hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {p.description && <p className="line-clamp-3 text-sm text-[#676b7a]">{p.description}</p>}
                <ProgressBar value={p.progress} className="w-full" />
                {p.next_action && (
                  <p className="text-sm text-[#2b303b]">
                    <span className="font-semibold">Next: </span>
                    {p.next_action}
                  </p>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
                  <StatusBadge status={p.status} />
                  <PriorityBadge priority={p.priority} />
                  <HealthBadge health={p.health} />
                  {(start || end) && (
                    <span className="flex items-center gap-1.5 text-xs text-[#676b7a]">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                      {start ?? "—"} → {end ?? "—"}
                    </span>
                  )}
                </div>
                </div>{/* end px-5 wrapper */}
                <Link
                  href={`/admin/project-tracker/projects/${p.id}`}
                  className="mt-1 flex items-center justify-between border-t border-[#eef2fb] bg-[#f7f9ff] px-5 py-2.5 text-xs font-semibold text-[#1f4693] hover:bg-[#eef2fb]"
                >
                  Logins, documents &amp; backups
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {editingCompany && (
        <CompanyFormModal company={company} onClose={() => setEditingCompany(false)} onSaved={afterSave} />
      )}
      {deletingCompany && (
        <ConfirmDialog
          title="Delete company?"
          onClose={() => setDeletingCompany(false)}
          onConfirm={async () => {
            const result = await deleteCompany(company.id, company.logo_path);
            if (result.status === "success") router.push("/admin/project-tracker/companies");
            return result;
          }}
        >
          <span className="font-semibold text-[#2b303b]">{company.name}</span> and its logo will be removed permanently.
          {projects.length > 0 && " Delete its projects first."}
        </ConfirmDialog>
      )}
      {projectForm && (
        <ProjectFormModal
          companyId={company.id}
          companyName={company.name}
          project={projectForm.id ? projectForm : null}
          onClose={() => setProjectForm(null)}
          onSaved={afterSave}
        />
      )}
      {deletingProject && (
        <ConfirmDialog
          title="Delete project?"
          onClose={() => setDeletingProject(null)}
          onConfirm={async () => {
            const result = await deleteProject(deletingProject.id);
            if (result.status === "success") await afterSave("Project deleted.");
            return result;
          }}
        >
          <span className="font-semibold text-[#2b303b]">{deletingProject.name}</span> will be removed permanently.
        </ConfirmDialog>
      )}
    </div>
  );
}

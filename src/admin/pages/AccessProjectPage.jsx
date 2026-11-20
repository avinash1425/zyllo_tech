import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { ArrowLeft, Check, Copy, Download, ExternalLink, Eye, EyeOff, KeyRound, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import EmptyState from "../EmptyState";
import {
  CREDENTIAL_CATEGORIES,
  fetchCredentials,
  fetchProjectPage,
  repositoryUrl,
} from "@/lib/api/admin/projectTrackerProject";
import { Modal, Notice } from "../project-tracker/ui";
import { StatusBadge } from "../project-tracker/badges";
import { BTN_PRIMARY, BTN_SECONDARY } from "../project-tracker/styles";
import { CredentialFormModal, PasswordModal, ReauthModal } from "../project-tracker/credentialDialogs";
import usePasswordReveal, { SHOW_SECONDS, copyToClipboard } from "../project-tracker/usePasswordReveal";
import { downloadLoginsExcel, loginsFileName } from "../project-tracker/exportLogins";

const typeLabel = (v) => CREDENTIAL_CATEGORIES.find((c) => c.value === v)?.label ?? v;
const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
const Dash = () => <span className="text-[#c4c8d0]">—</span>;

function ExtLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex max-w-[15rem] items-center gap-1 text-[#1f4693] hover:underline">
      <span className="truncate">{children}</span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

function PasswordCell({ cred, pw, compact }) {
  if (!cred.has_password) return <span className="text-[#9aa0ad]">Not saved</span>;
  const shown = pw.revealed[cred.id];
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-live="polite"
        className={`max-w-[12rem] truncate rounded px-1.5 py-0.5 font-mono text-xs ${shown ? "bg-amber-50 text-[#2b303b]" : "bg-[#f6f7fb] text-[#676b7a]"}`}
      >
        {shown ?? "••••••••"}
      </span>
      <button
        type="button"
        disabled={pw.busyId === cred.id}
        onClick={(e) => {
          e.stopPropagation();
          if (shown) pw.hide(cred.id);
          else pw.run(cred, "view");
        }}
        aria-label={shown ? `Hide password for ${cred.service}` : `Show password for ${cred.service}`}
        title={shown ? "Hide" : `Show for ${SHOW_SECONDS} seconds`}
        className="rounded p-1 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693] disabled:opacity-50"
      >
        {shown ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      {!compact && (
        <button
          type="button"
          disabled={pw.busyId === cred.id}
          onClick={(e) => {
            e.stopPropagation();
            pw.run(cred, "copy");
          }}
          aria-label={`Copy password for ${cred.service}`}
          title="Copy without showing"
          className="rounded p-1 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693] disabled:opacity-50"
        >
          {pw.copiedId === cred.id ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      )}
    </span>
  );
}

function ViewModal({ cred, pw, onClose, onEdit, onChangePassword, onDownload, downloading }) {
  const repoLink = repositoryUrl(cred.service, cred.repository);
  const rows = [
    ["Type", typeLabel(cred.category)],
    ["Platform / service", cred.service],
    ["Account / username", cred.account],
    ["Email", cred.email],
    ["Password", <PasswordCell key="pw" cred={cred} pw={pw} />],
    ["Repository", cred.repository && (repoLink ? <ExtLink href={repoLink}>{cred.repository}</ExtLink> : cred.repository)],
    ["Login URL", cred.login_url && <ExtLink href={cred.login_url}>{shortUrl(cred.login_url)}</ExtLink>],
    ["Used for", cred.purpose],
    ["2FA", cred.two_factor ? "On" : "Off"],
    ["Notes", cred.notes],
    ["Password last changed", cred.password_updated_at && new Date(cred.password_updated_at).toLocaleString("en-IN")],
  ];
  return (
    <Modal title={`${cred.service}${cred.account ? ` — ${cred.account}` : ""}`} titleId="pt-view-login-title" onClose={onClose}>
      <dl className="divide-y divide-[#eef0f3] rounded-xl border border-[#e7e9ee]">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 px-4 py-2.5 text-sm sm:grid-cols-[11rem_1fr]">
            <dt className="font-semibold text-[#676b7a]">{label}</dt>
            <dd className="min-w-0 break-words text-[#2b303b]">{value || <Dash />}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onChangePassword} className={BTN_SECONDARY}>
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {cred.has_password ? "Change password" : "Add password"}
        </button>
        <button type="button" onClick={onDownload} disabled={downloading} className={BTN_SECONDARY}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {downloading ? "Preparing…" : "Download (Excel)"}
        </button>
        <button type="button" onClick={onEdit} className={BTN_PRIMARY}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit
        </button>
      </div>
    </Modal>
  );
}

// Access & Logins, step 3: all logins of one project, one per line.
export default function AccessProjectPage() {
  const { companyId, projectId } = useParams();
  const { user } = useAuth();
  const loader = useCallback(async () => {
    const [project, credentials] = await Promise.all([fetchProjectPage(projectId), fetchCredentials(projectId)]);
    return { project, credentials };
  }, [projectId]);
  const { data, loading, error, reload } = useAdminData(loader, [projectId]);
  const [notice, setNotice] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [passwordFor, setPasswordFor] = useState(null);
  const [busy, setBusy] = useState(null);
  const pw = usePasswordReveal({ onMessage: (text, tone) => setNotice({ text, tone }) });

  const credentials = useMemo(() => data?.credentials ?? [], [data]);
  const viewingCred = viewing ? credentials.find((c) => c.id === viewing) : null;

  async function download(creds, key) {
    const project = data.project;
    setBusy(key);
    setNotice(null);
    try {
      const single = creds.length === 1 && key !== "all";
      const result = await downloadLoginsExcel({
        items: creds.map((cred) => ({
          cred,
          company: project.company?.name,
          project_code: project.project_code,
          project: project.name,
          live_url: project.live_url,
        })),
        fileName: loginsFileName(project.company?.name, project.project_code, single ? creds[0].service : null),
        title: `${project.company?.name ?? ""} — ${project.project_code} ${project.name}${single ? ` — ${creds[0].service}` : ""}`,
        exportedBy: user?.email,
      });
      if (result.status === "reauth") pw.requireReauth(() => download(creds, key));
      else if (result.status === "error") setNotice({ text: result.message, tone: "warning" });
      else setNotice({ text: `Downloaded ${result.count} login${result.count === 1 ? "" : "s"} (${result.withPasswords} with passwords — recorded in the access log).`, tone: "success" });
    } catch (e) {
      setNotice({ text: e.message || "Download failed.", tone: "warning" });
    } finally {
      setBusy(null);
    }
}


  async function afterSave(text, tone = "success") {
    setEditing(null);
    setPasswordFor(null);
    if (text) setNotice({ text, tone });
    await reload();
  }

  if (loading) return <AdminLoading />;

  const companyHref = `/admin/project-tracker/access/${companyId}`;
  if (error || !data?.project) {
    return (
      <div className="flex flex-col gap-6">
        <Link href={companyHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#676b7a] hover:text-[#c24f05]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>
        <EmptyState bordered icon={KeyRound} title={error ? "Could not load this project" : "Project not found"} message={error?.message ?? "It may have been deleted."} />
      </div>
    );
  }

  const { project } = data;

  return (
    <div className="flex flex-col gap-5">
      {/* Back button + breadcrumb */}
      <div className="flex flex-col gap-2">
        <Link
          href={companyHref}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-[#e7e9ee] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#4a5068] shadow-sm hover:border-[#1f4693]/30 hover:text-[#1f4693]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to {project.company?.name ?? "Company"}
        </Link>
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-[#9aa0ad]">
          <Link href="/admin/project-tracker/access" className="hover:text-[#c24f05]">All companies</Link>
          <span aria-hidden="true">/</span>
          <Link href={companyHref} className="hover:text-[#c24f05]">{project.company?.name}</Link>
          <span aria-hidden="true">/</span>
          <span className="text-[#4a5068]">{project.name}</span>
        </nav>
      </div>

      {/* Project header card */}
      <section className="flex flex-col gap-3 rounded-xl border border-[#e7e9ee] bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] font-bold text-[#1f4693]">{project.project_code}</p>
          <h1 className="break-words text-xl font-bold tracking-tight text-[#1a2340]">{project.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#676b7a]">
            <StatusBadge status={project.status} />
            {project.live_url ? <ExtLink href={project.live_url}>{shortUrl(project.live_url)}</ExtLink> : <span>No live site yet</span>}
            <Link href={`/admin/project-tracker/projects/${project.id}`} className="text-[12px] font-semibold text-[#1f4693] hover:underline">
              Open full project →
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => download(credentials, "all")} disabled={!credentials.length || busy !== null} className={BTN_PRIMARY}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {busy === "all" ? "Preparing…" : "Download all (Excel)"}
          </button>
        </div>
      </section>

      <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

      {credentials.length === 0 ? (
        <EmptyState
          bordered
          icon={KeyRound}
          title="No logins for this project yet"
          message="Logins are added on the project page, in its Access & Logins tab."
          action={
            <Link href={`/admin/project-tracker/projects/${project.id}?tab=access`} className={BTN_PRIMARY}>
              Open project page
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#e7e9ee] bg-white shadow-sm">
          <table className="w-full min-w-[1400px] text-left text-sm">
            <thead className="bg-[#fafbfc] text-xs uppercase tracking-wide text-[#676b7a]">
              <tr>
                {["No.", "Type", "Platform / service", "Account / username", "Email", "Password", "Repository", "Login URL", "Used for", "2FA", "Notes"].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">{h}</th>
                ))}
                <th scope="col" className="sticky right-0 whitespace-nowrap bg-[#fafbfc] px-3 py-3 text-right font-semibold shadow-[-8px_0_8px_-8px_rgba(16,26,58,0.15)]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef0f3] align-top">
              {credentials.map((c, i) => {
                const repoLink = repositoryUrl(c.service, c.repository);
                return (
                  <tr key={c.id} className="group hover:bg-[#fafbfc]">
                    <td className="px-3 py-3 tabular-nums text-[#676b7a]">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-[#2b303b]">{typeLabel(c.category)}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold text-[#2b303b]">{c.service}</td>
                    <td className="px-3 py-3 text-[#2b303b]">
                      {c.account ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="max-w-[14rem] truncate">{c.account}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(c.account).then((ok) => ok && setNotice({ text: "Username copied.", tone: "success" }))}
                            aria-label={`Copy username for ${c.service}`}
                            className="rounded p-1 text-[#9aa0ad] hover:bg-[#f3f4f7] hover:text-[#2b303b]"
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="max-w-[14rem] truncate px-3 py-3 text-[#2b303b]">{c.email || <Dash />}</td>
                    <td className="whitespace-nowrap px-3 py-3"><PasswordCell cred={c} pw={pw} /></td>
                    <td className="px-3 py-3">{c.repository ? (repoLink ? <ExtLink href={repoLink}>{c.repository.replace(/^https?:\/\/(www\.)?/, "")}</ExtLink> : c.repository) : <Dash />}</td>
                    <td className="px-3 py-3">{c.login_url ? <ExtLink href={c.login_url}>{shortUrl(c.login_url)}</ExtLink> : <Dash />}</td>
                    <td className="max-w-[14rem] px-3 py-3 text-[#2b303b]"><span className="line-clamp-2">{c.purpose || <Dash />}</span></td>
                    <td className="px-3 py-3">{c.two_factor ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">On</span> : <span className="text-xs text-[#9aa0ad]">Off</span>}</td>
                    <td className="max-w-[16rem] px-3 py-3 text-[#676b7a]"><span className="line-clamp-2" title={c.notes || undefined}>{c.notes || <Dash />}</span></td>
                    <td className="sticky right-0 bg-white px-2 py-2 shadow-[-8px_0_8px_-8px_rgba(16,26,58,0.15)] group-hover:bg-[#fafbfc]">
                      <div className="flex justify-end gap-0.5">
                        <button type="button" onClick={() => setViewing(c.id)} aria-label={`View ${c.service}`} title="View" className="rounded-lg p-2 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693]">
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => setEditing(c)} aria-label={`Edit ${c.service}`} title="Edit" className="rounded-lg p-2 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693]">
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => download([c], c.id)}
                          disabled={busy !== null}
                          aria-label={`Download ${c.service} as Excel`}
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

      {viewingCred && (
        <ViewModal
          cred={viewingCred}
          pw={pw}
          downloading={busy === viewingCred.id}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setViewing(null);
            setEditing(viewingCred);
          }}
          onChangePassword={() => {
            setViewing(null);
            setPasswordFor(viewingCred);
          }}
          onDownload={() => download([viewingCred], viewingCred.id)}
        />
      )}
      {editing && <CredentialFormModal projectId={project.id} credential={editing} onClose={() => setEditing(null)} onSaved={afterSave} />}
      {passwordFor && <PasswordModal credential={passwordFor} onClose={() => setPasswordFor(null)} onSaved={afterSave} />}
      {pw.pending && <ReauthModal onClose={pw.clearPending} onConfirmed={pw.confirmPending} />}
    </div>
  );
}

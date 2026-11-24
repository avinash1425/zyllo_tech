import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Database,
  Eye,
  EyeOff,
  GitBranch,
  Globe,
  HardDrive,

  KeyRound,
  Link2,
  Lock,
  Mail,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useAccess } from "@/lib/access";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import EmptyState from "../EmptyState";
import {
  CREDENTIAL_CATEGORIES,
  deleteCredential,

  fetchCredentials,
  removeCredentialPassword,
  repositoryUrl,
  revealCredentialPassword,
} from "@/lib/api/admin/projectTrackerProject";
import ProjectLoginsFormModal from "./ProjectLoginsFormModal";
import { CredentialFormModal, PasswordModal, ReauthModal } from "./credentialDialogs";
import { ConfirmDialog, Notice } from "./ui";
import { BTN_PRIMARY } from "./styles";

const SHOW_SECONDS = 20;

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const CAT_ICONS = {
  code_repo: GitBranch,
  database: Database,
  hosting: Server,
  domain: Globe,
  email: Mail,
  admin_login: Lock,
  backup_storage: HardDrive,
  other: KeyRound,
};


// -------------------------------------------------------------------- tab

export default function CredentialsTab({ project, onProjectChanged }) {
  const projectId = project.id;
  const [addingAll, setAddingAll] = useState(false);
  const loader = useCallback(() => fetchCredentials(projectId), [projectId]);
  const { data, loading, error, reload } = useAdminData(loader, [projectId]);
  const [editing, setEditing] = useState(null); // null | {} | credential
  const [passwordFor, setPasswordFor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [removingPw, setRemovingPw] = useState(null);
  const [pending, setPending] = useState(null); // action waiting for re-authentication
  const [revealed, setRevealed] = useState({}); // id -> { value, until }
  const [busyId, setBusyId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [notice, setNotice] = useState(null);
  const timers = useRef({});
  const { can } = useAccess();
  const canCreate = can("projects.logins.create");
  const canEdit = can("projects.logins.edit");
  const canDelete = can("projects.logins.delete");
  const canReveal = can("projects.logins.reveal");

  // Clear every shown password when leaving the tab.
  useEffect(() => {
    const all = timers.current;
    return () => Object.values(all).forEach(clearTimeout);
  }, []);

  const groups = useMemo(() => {
    const list = data ?? [];
    return CREDENTIAL_CATEGORIES.map((c) => ({ ...c, items: list.filter((x) => x.category === c.value) })).filter(
      (g) => g.items.length,
    );
  }, [data]);

  const hide = useCallback((id) => {
    clearTimeout(timers.current[id]);
    setRevealed((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
  }, []);

  async function runPasswordAction(cred, purpose) {
    setBusyId(cred.id);
    const result = await revealCredentialPassword(cred.id, purpose);
    setBusyId(null);
    if (result.status === "reauth") {
      setPending({ cred, purpose });
      return;
    }
    if (result.status !== "success") {
      setNotice({ text: result.message, tone: "warning" });
      return;
    }
    if (purpose === "copy") {
      const ok = await copyToClipboard(result.password);
      if (ok) {
        setCopiedId(cred.id);
        setTimeout(() => setCopiedId((c) => (c === cred.id ? null : c)), 2000);
      } else {
        setNotice({ text: "Your browser blocked copying. Use Show instead.", tone: "warning" });
      }
      return;
    }
    clearTimeout(timers.current[cred.id]);
    setRevealed((r) => ({ ...r, [cred.id]: { value: result.password } }));
    timers.current[cred.id] = setTimeout(() => hide(cred.id), SHOW_SECONDS * 1000);
  }

  async function afterSave(text, tone = "success") {
    setEditing(null);
    setPasswordFor(null);
    setNotice({ text, tone });
    await reload();
  }

  if (loading) return <AdminLoading />;
  if (error) return <EmptyState bordered icon={KeyRound} title="Could not load logins" message={error.message} />;

  return (
    <div className="flex flex-col gap-4">
      <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

      <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] shadow-lg">
        {/* Banner */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] px-5 py-3.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/20">
            <ShieldCheck className="h-4 w-4 text-white" aria-hidden="true" />
          </span>
          <span className="flex-1 text-sm font-bold text-white">
            Access &amp; Logins
            {data?.length > 0 && <span className="ml-2 font-normal text-white/55">{data.length}</span>}
          </span>
          <span className="hidden text-[11px] text-white/50 sm:block mr-1">🔒 Encrypted</span>
          {canCreate && (
          <button
            type="button"
            onClick={() => setAddingAll(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/25"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add logins
          </button>
          )}
        </div>

        {!data?.length ? (
          <div className="bg-white px-6 py-10 text-center">
            <KeyRound className="mx-auto mb-3 h-10 w-10 text-[#c0c8d8]" aria-hidden="true" />
            <p className="text-sm text-[#8a90a0]">No logins yet. Add GitHub, database, hosting and admin logins.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 bg-[#f8fafc] p-4">
            {groups.map((g) => {
              const GrpIcon = CAT_ICONS[g.value] ?? KeyRound;
              return (
                <section key={g.value} className="overflow-hidden rounded-xl border border-[#e3e9f5] bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-[#1a3a7a] bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] px-4 py-3">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/20">
                        <GrpIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      {g.label}
                      <span className="ml-1 font-medium text-white/60">({g.items.length})</span>
                    </h3>
                    {canCreate && (
                    <button
                      type="button"
                      onClick={() => setEditing({})}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white/80 hover:bg-white/20"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add
                    </button>
                    )}
                  </div>
                  <ul className="divide-y divide-[#f1f3f7]">
                    {g.items.map((c) => {
                      const shown = revealed[c.id];
                      return (
                        <li key={c.id} className="flex gap-4 px-5 py-4 transition-colors hover:bg-[#f8faff]">
                          {/* Category icon badge */}
                          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef2fb] text-[#1f4693]">
                            <GrpIcon className="h-5 w-5" aria-hidden="true" />
                          </span>

                          <div className="min-w-0 flex-1">
                            {/* Top row: service name + actions */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[15px] font-bold text-[#101a3a]">{c.service}</span>
                                {c.two_factor && (
                                  <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">2FA</span>
                                )}
                                {c.purpose && (
                                  <span className="rounded-md bg-[#f4f6f9] px-2 py-0.5 text-[11px] text-[#676b7a]">{c.purpose}</span>
                                )}
                              </div>
                              <div className="flex shrink-0 gap-0.5">
                                {canEdit && (
                                <button type="button" onClick={() => setEditing(c)} aria-label={`Edit ${c.service}`} className="rounded-lg p-2 text-[#9aa0ad] hover:bg-[#eef2fb] hover:text-[#1f4693]">
                                  <Pencil className="h-4 w-4" aria-hidden="true" />
                                </button>
                                )}
                                {canDelete && (
                                <button type="button" onClick={() => setDeleting(c)} aria-label={`Delete ${c.service}`} className="rounded-lg p-2 text-[#9aa0ad] hover:bg-red-50 hover:text-red-600">
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                                )}
                              </div>
                            </div>

                            {/* Account / email meta */}
                            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5">
                              {c.account && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#b0b7c3]">User</span>
                                  <span className="text-sm font-medium text-[#2b303b]">{c.account}</span>
                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(c.account).then((ok) => ok && setNotice({ text: "Username copied.", tone: "success" }))}
                                    aria-label={`Copy username for ${c.service}`}
                                    className="rounded p-1 text-[#c0c8d8] hover:text-[#1f4693]"
                                  >
                                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              )}
                              {c.email && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#b0b7c3]">Email</span>
                                  <span className="text-sm text-[#4a5068]">{c.email}</span>
                                </div>
                              )}
                            </div>

                            {/* Password row */}
                            {c.has_password ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#e8edf8] bg-[#f8fafc] px-4 py-2.5">
                                <span
                                  className={`min-w-[6rem] flex-1 font-mono text-sm ${shown ? "text-[#2b303b]" : "tracking-widest text-[#9aa0ad]"}`}
                                  aria-live="polite"
                                >
                                  {shown ? shown.value : "••••••••••"}
                                </span>
                                <div className="flex items-center gap-1">
                                  {canReveal && (
                                  <>
                                  <button type="button" disabled={busyId === c.id} onClick={() => (shown ? hide(c.id) : runPasswordAction(c, "view"))} aria-label={shown ? `Hide password for ${c.service}` : `Show password for ${c.service}`} title={shown ? "Hide" : `Show for ${SHOW_SECONDS}s`} className="rounded-lg p-2 text-[#8a90a0] hover:bg-white hover:text-[#1f4693] disabled:opacity-40">
                                    {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                                  </button>
                                  <button type="button" disabled={busyId === c.id} onClick={() => runPasswordAction(c, "copy")} aria-label={`Copy password for ${c.service}`} title="Copy without showing" className="rounded-lg p-2 text-[#8a90a0] hover:bg-white hover:text-[#1f4693] disabled:opacity-40">
                                    {copiedId === c.id ? <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                                  </button>
                                  </>
                                  )}
                                  {canReveal && canEdit && <div className="mx-1 h-4 w-px bg-[#e2e8f0]" />}
                                  {canEdit && (
                                  <>
                                  <button type="button" onClick={() => setPasswordFor(c)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#1f4693] hover:bg-white">Change</button>
                                  <button type="button" onClick={() => setRemovingPw(c)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-white">Remove</button>
                                  </>
                                  )}
                                </div>
                              </div>
                            ) : canEdit && (
                              <div className="mt-2.5">
                                <button type="button" onClick={() => setPasswordFor(c)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#c8d4f0] px-3 py-1.5 text-xs font-semibold text-[#1f4693] hover:border-[#1f4693] hover:bg-[#eef2fb]">
                                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                  Add password
                                </button>
                              </div>
                            )}

                            {/* Links row */}
                            {(c.login_url || c.repository || c.notes) && (
                              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                {c.login_url && (
                                  <a href={c.login_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#1f4693] hover:underline">
                                    <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                                    <span className="truncate max-w-[20rem]">{c.login_url.replace(/^https?:\/\//, "")}</span>
                                  </a>
                                )}
                                {c.repository && (
                                  repositoryUrl(c.service, c.repository) ? (
                                    <a href={repositoryUrl(c.service, c.repository)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#1f4693] hover:underline">
                                      <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
                                      <span className="truncate max-w-[20rem]">{c.repository.replace(/^https?:\/\/(www\.)?/, "")}</span>
                                    </a>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-xs text-[#676b7a]">
                                      <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
                                      <span className="truncate">{c.repository}</span>
                                    </span>
                                  )
                                )}
                                {c.notes && (
                                  <span className="text-xs italic text-[#8a90a0]">{c.notes}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {addingAll && (
        <ProjectLoginsFormModal
          project={project}
          onClose={() => setAddingAll(false)}
          onSaved={async (text, opts) => {
            if (!opts?.keepOpen) setAddingAll(false);
            if (text) setNotice({ text, tone: "success" });
            await Promise.all([reload(), onProjectChanged?.()]);
          }}
        />
      )}

      {editing && (
        <CredentialFormModal
          projectId={projectId}
          credential={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={afterSave}
        />
      )}
      {passwordFor && <PasswordModal credential={passwordFor} onClose={() => setPasswordFor(null)} onSaved={afterSave} />}
      {pending && (
        <ReauthModal
          onClose={() => setPending(null)}
          onConfirmed={() => {
            const { cred, purpose } = pending;
            setPending(null);
            runPasswordAction(cred, purpose);
          }}
        />
      )}
      {removingPw && (
        <ConfirmDialog
          title="Remove password?"
          confirmLabel="Remove"
          onClose={() => setRemovingPw(null)}
          onConfirm={async () => {
            const result = await removeCredentialPassword(removingPw.id);
            if (result.status === "success") {
              hide(removingPw.id);
              setRemovingPw(null);
              await afterSave("Password removed.");
            }
            return result;
          }}
        >
          The saved password for <span className="font-semibold text-[#2b303b]">{removingPw.service}</span> will be deleted
          from the vault. The login itself stays.
        </ConfirmDialog>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete login?"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const result = await deleteCredential(deleting.id);
            if (result.status === "success") {
              hide(deleting.id);
              setDeleting(null);
              await afterSave("Login deleted.");
            }
            return result;
          }}
        >
          <span className="font-semibold text-[#2b303b]">{deleting.service}</span>
          {deleting.account ? ` (${deleting.account})` : ""} and its saved password will be deleted permanently. Backups
          linked to it will be unlinked.
        </ConfirmDialog>
      )}
    </div>
  );
}


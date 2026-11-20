import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  Globe,
  History,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import EmptyState from "../EmptyState";
import {
  CREDENTIAL_CATEGORIES,
  deleteCredential,
  fetchCredentialEvents,
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

const EVENT_LABELS = {
  password_set: "Password saved",
  password_changed: "Password changed",
  password_removed: "Password removed",
  password_viewed: "Password viewed",
  password_copied: "Password copied",
  login_deleted: "Login deleted",
};

function AccessLog({ projectId, refreshKey }) {
  const [open, setOpen] = useState(false);
  const loader = useCallback(() => (open ? fetchCredentialEvents(projectId) : Promise.resolve(null)), [open, projectId]);
  const { data, loading, error } = useAdminData(loader, [open, projectId, refreshKey]);
  return (
    <section className="rounded-2xl border border-[#e7e9ee] bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-[#2b303b]"
      >
        <History className="h-4 w-4 text-[#1f4693]" aria-hidden="true" />
        Password access log
        <span className="ml-auto text-xs font-normal text-[#676b7a]">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="border-t border-[#eef0f3] px-4 py-3">
          {loading ? (
            <p className="text-sm text-[#676b7a]">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-700">{error.message}</p>
          ) : !data?.length ? (
            <p className="text-sm text-[#676b7a]">No password activity yet.</p>
          ) : (
            <ul className="divide-y divide-[#f1f2f5] text-sm">
              {data.map((ev) => (
                <li key={ev.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                  <span className="font-medium text-[#2b303b]">{EVENT_LABELS[ev.action] ?? ev.action}</span>
                  <span className="text-[#676b7a]">{ev.credential_label}</span>
                  <span className="ml-auto text-xs text-[#9aa0ad]">
                    {ev.actor_email ?? "unknown"} · {new Date(ev.created_at).toLocaleString("en-IN")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-[#9aa0ad]">Shows the last 50 events. Password values are never logged.</p>
        </div>
      )}
    </section>
  );
}

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
  const [logKey, setLogKey] = useState(0);
  const timers = useRef({});

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
    setLogKey((k) => k + 1);
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
    setLogKey((k) => k + 1);
    await reload();
  }

  if (loading) return <AdminLoading />;
  if (error) return <EmptyState bordered icon={KeyRound} title="Could not load logins" message={error.message} />;

  const addButton = (
    <button type="button" onClick={() => setAddingAll(true)} className={BTN_PRIMARY}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      Add logins
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm text-[#676b7a]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          Passwords are stored encrypted. Showing or copying one may ask for your login password, and every view is logged.
        </p>
        {(data?.length ?? 0) > 0 && addButton}
      </div>

      <section className="flex flex-col gap-2 rounded-2xl border border-[#e7e9ee] bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center">
        <span className="flex items-center gap-2 text-sm font-bold text-[#2b303b]">
          <Globe className="h-4 w-4 text-[#1f4693]" aria-hidden="true" />
          Live site / domain
        </span>
        {project.live_url ? (
          <a
            href={project.live_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-sm text-[#1f4693] hover:underline sm:ml-3"
          >
            <span className="truncate">{project.live_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-sm text-[#9aa0ad] sm:ml-3">Not added yet</span>
        )}
        <button
          type="button"
          onClick={() => setAddingAll(true)}
          className="self-start rounded-md px-2 py-1 text-xs font-semibold text-[#1f4693] hover:bg-[#f3f4f7] sm:ml-auto sm:self-auto"
        >
          {project.live_url ? "Change" : "Add live site"}
        </button>
      </section>

      <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

      {!data?.length ? (
        <EmptyState
          bordered
          icon={KeyRound}
          title="No logins yet"
          message="Add the GitHub repo, database, hosting, email and admin logins for this project."
          action={addButton}
        />
      ) : (
        groups.map((g) => (
          <section key={g.value} className="rounded-2xl border border-[#e7e9ee] bg-white shadow-sm">
            <h3 className="border-b border-[#eef0f3] px-4 py-3 text-sm font-bold text-[#2b303b]">
              {g.label} <span className="font-medium text-[#9aa0ad]">({g.items.length})</span>
            </h3>
            <ul className="divide-y divide-[#eef0f3]">
              {g.items.map((c) => {
                const shown = revealed[c.id];
                return (
                  <li key={c.id} className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-[1.2fr_1.3fr_1.4fr_auto] lg:items-center">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-[#2b303b]">
                        {c.service}
                        {c.two_factor && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">2FA</span>
                        )}
                      </p>
                      {c.purpose && <p className="text-xs text-[#676b7a]">{c.purpose}</p>}
                      {c.login_url && (
                        <a
                          href={c.login_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-[#1f4693] hover:underline"
                        >
                          <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{c.login_url.replace(/^https?:\/\//, "")}</span>
                        </a>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ad]">
                        {c.category === "code_repo" ? "Account" : "Username / email"}
                      </p>
                      {c.account ? (
                        <p className="flex items-center gap-1.5">
                          <span className="truncate text-sm text-[#2b303b]">{c.account}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(c.account).then((ok) => ok && setNotice({ text: "Username copied.", tone: "success" }))}
                            aria-label={`Copy username for ${c.service}`}
                            className="rounded p-1 text-[#9aa0ad] hover:bg-[#f3f4f7] hover:text-[#2b303b]"
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </p>
                      ) : (
                        <p className="text-sm text-[#c4c8d0]">—</p>
                      )}
                      {c.email && <p className="truncate text-xs text-[#676b7a]">{c.email}</p>}
                      {c.repository &&
                        (repositoryUrl(c.service, c.repository) ? (
                          <a
                            href={repositoryUrl(c.service, c.repository)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-[#1f4693] hover:underline"
                          >
                            <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{c.repository.replace(/^https?:\/\/(www\.)?/, "")}</span>
                          </a>
                        ) : (
                          <p className="flex items-center gap-1 text-xs text-[#676b7a]">
                            <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{c.repository}</span>
                          </p>
                        ))}
                    </div>

                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ad]">Password</p>
                      {c.has_password ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`max-w-[14rem] truncate rounded-md px-2 py-1 font-mono text-sm ${
                              shown ? "bg-amber-50 text-[#2b303b]" : "bg-[#f6f7fb] text-[#676b7a]"
                            }`}
                            aria-live="polite"
                          >
                            {shown ? shown.value : "••••••••••"}
                          </span>
                          <button
                            type="button"
                            disabled={busyId === c.id}
                            onClick={() => (shown ? hide(c.id) : runPasswordAction(c, "view"))}
                            aria-label={shown ? `Hide password for ${c.service}` : `Show password for ${c.service}`}
                            title={shown ? "Hide" : `Show for ${SHOW_SECONDS} seconds`}
                            className="rounded-md p-1.5 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693] disabled:opacity-50"
                          >
                            {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === c.id}
                            onClick={() => runPasswordAction(c, "copy")}
                            aria-label={`Copy password for ${c.service}`}
                            title="Copy without showing"
                            className="rounded-md p-1.5 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693] disabled:opacity-50"
                          >
                            {copiedId === c.id ? (
                              <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                            ) : (
                              <Copy className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPasswordFor(c)}
                            className="rounded-md px-2 py-1 text-xs font-semibold text-[#1f4693] hover:bg-[#f3f4f7]"
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemovingPw(c)}
                            className="rounded-md px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </button>
                          {copiedId === c.id && <span className="text-xs text-emerald-700">Copied</span>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[#9aa0ad]">Not saved</span>
                          <button
                            type="button"
                            onClick={() => setPasswordFor(c)}
                            className="rounded-md px-2 py-1 text-xs font-semibold text-[#1f4693] hover:bg-[#f3f4f7]"
                          >
                            Add password
                          </button>
                        </div>
                      )}
                      {c.notes && <p className="mt-1 line-clamp-2 text-xs text-[#676b7a]" title={c.notes}>{c.notes}</p>}
                    </div>

                    <div className="flex gap-1 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => setEditing(c)}
                        aria-label={`Edit ${c.service}`}
                        className="rounded-lg p-2 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693]"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(c)}
                        aria-label={`Delete ${c.service}`}
                        className="rounded-lg p-2 text-[#676b7a] hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <AccessLog projectId={projectId} refreshKey={logKey} />

      {addingAll && (
        <ProjectLoginsFormModal
          project={project}
          onClose={() => setAddingAll(false)}
          onSaved={async (text, opts) => {
            if (!opts?.keepOpen) setAddingAll(false);
            if (text) setNotice({ text, tone: "success" });
            setLogKey((k) => k + 1);
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


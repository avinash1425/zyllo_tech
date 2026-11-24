import { useCallback, useState } from "react";
import { Check, Copy, DatabaseBackup, ExternalLink, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { useAccess } from "@/lib/access";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import EmptyState from "../EmptyState";
import { BACKUP_PLAN, deleteBackup, fetchBackupPlan, saveBackupPlan } from "@/lib/api/admin/projectTrackerProject";
import { ConfirmDialog, Field, Modal, Notice, PasswordInput } from "./ui";
import { BTN_PRIMARY, BTN_SECONDARY, formatDate, inputClass } from "./styles";
import { ReauthModal } from "./credentialDialogs";
import usePasswordReveal, { SHOW_SECONDS, copyToClipboard } from "./usePasswordReveal";

const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function toForm(existing) {
  return Object.fromEntries(
    BACKUP_PLAN.map((p) => {
      const row = existing[p.key];
      return [
        p.key,
        {
          kept: row ? (row.kept ? "yes" : "no") : "",
          location: row?.location ?? "",
          link: row?.link ?? "",
          account: row?.credential?.account ?? "",
          password: "",
          backup_date: row?.backup_date ?? "",
          notes: row?.notes ?? "",
        },
      ];
    }),
  );
}

function YesNo({ id, value, onChange }) {
  return (
    <div role="radiogroup" aria-labelledby={id} className="inline-flex rounded-lg border border-[#e7e9ee] p-0.5">
      {[
        ["yes", "Yes"],
        ["no", "No"],
      ].map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(value === v ? "" : v)}
          className={`min-w-[4rem] rounded-md px-3 py-1.5 text-sm font-semibold ${
            value === v ? (v === "yes" ? "bg-emerald-600 text-white" : "bg-[#676b7a] text-white") : "text-[#676b7a] hover:text-[#2b303b]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function BackupPlanModal({ projectId, existing, onClose, onSaved }) {
  const [values, setValues] = useState(() => toForm(existing));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (key, name, value) => {
    setValues((v) => ({ ...v, [key]: { ...v[key], [name]: value } }));
    if (errors[`${key}.${name}`]) setErrors((e) => ({ ...e, [`${key}.${name}`]: undefined }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const result = await saveBackupPlan(projectId, values, existing);
    setSaving(false);
    if (result.status === "success" || result.status === "partial") {
      // Never keep typed passwords once they have been saved.
      setValues((v) => Object.fromEntries(Object.entries(v).map(([k, s]) => [k, { ...s, password: "" }])));
    }
    if (result.status === "success") return onSaved(result.message);
    if (result.status === "partial") return onSaved(`Saved, but: ${result.message}`, "warning");
    setErrors(result.errors ?? {});
    setMessage(result.message);
  }

  return (
    <Modal title="Backup details" titleId="pt-backup-plan-title" onClose={onClose} size="max-w-3xl">
      <form onSubmit={onSubmit} noValidate autoComplete="off" className="flex flex-col gap-5">
        <p className="rounded-lg bg-[#f6f7fb] px-3.5 py-2.5 text-xs text-[#676b7a]">
          Fill in what you have. The username / email and password of each backup are saved as a login of this project
          (category &ldquo;Backup storage&rdquo;) and the password is stored encrypted.
        </p>
        {BACKUP_PLAN.map((p) => {
          const v = values[p.key];
          const row = existing[p.key];
          const show = !p.askKept || v.kept === "yes";
          const err = (n) => errors[`${p.key}.${n}`];
          const fid = (n) => `pt-bk-${p.key}-${n}`;
          const text = (name, label, props = {}) => (
            <Field id={fid(name)} label={label} required={props.required} error={err(name)} className={props.className}>
              <input
                id={fid(name)}
                type={props.type || "text"}
                value={v[name]}
                placeholder={props.placeholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => set(p.key, name, e.target.value)}
                aria-invalid={err(name) ? "true" : undefined}
                aria-describedby={err(name) ? `${fid(name)}-error` : undefined}
                className={inputClass(err(name))}
              />
            </Field>
          );
          return (
            <section key={p.key} className={`rounded-xl border p-4 ${show && (v.location || v.kept) ? "border-[#f7941e]/50" : "border-[#e7e9ee]"}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 id={`${fid("title")}`} className="text-sm font-bold text-[#2b303b]">{p.title}</h3>
                  <p className="text-xs text-[#9aa0ad]">{p.hint}</p>
                </div>
                {p.askKept && <YesNo id={fid("title")} value={v.kept} onChange={(val) => set(p.key, "kept", val)} />}
              </div>
              {show ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {text("location", "Where it is kept", { required: true, placeholder: "e.g. Google Drive, GitHub, OneDrive, local drive" })}
                  {text("link", "Link", { type: "url", placeholder: "https://… (folder or repository link)" })}
                  {text("account", "Username / email", { placeholder: "Account the backup is stored in" })}
                  <Field id={fid("password")} label="Password" error={err("password")}>
                    <PasswordInput
                      id={fid("password")}
                      value={v.password}
                      onChange={(val) => set(p.key, "password", val)}
                      placeholder={row?.credential?.has_password ? "Saved — leave empty to keep it" : "Saved encrypted"}
                    />
                  </Field>
                  {text("backup_date", "Last backup date", { type: "date" })}
                  {text("notes", "Notes", { placeholder: "e.g. folder name, what is included" })}
                </div>
              ) : (
                <p className="text-sm text-[#9aa0ad]">{v.kept === "no" ? "Marked as not kept." : "Choose Yes or No."}</p>
              )}
            </section>
          );
        })}
        {message && <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{message}</p>}
        <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex justify-end gap-3 rounded-b-2xl border-t border-[#e7e9ee] bg-white px-6 py-4">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}


export default function BackupsTab({ projectId }) {
  const loader = useCallback(() => fetchBackupPlan(projectId), [projectId]);
  const { data, loading, error, reload } = useAdminData(loader, [projectId]);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState(null);
  const pw = usePasswordReveal({ onMessage: (text, tone) => setNotice({ text, tone }) });
  const { can } = useAccess();
  const canEdit = can("projects.tracker.edit");
  const canDelete = can("projects.tracker.delete");
  const canReveal = can("projects.logins.reveal");

  async function afterSave(text, tone = "success") {
    setEditing(false);
    setRemoving(null);
    setNotice({ text, tone });
    await reload();
  }

  if (loading) return <AdminLoading />;
  if (error) return <EmptyState bordered icon={DatabaseBackup} title="Could not load backups" message={error.message} />;

  const plan = data ?? {};
  const anything = Object.keys(plan).length > 0;

  return (
    <div className="flex flex-col gap-5">
      <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

      <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] shadow-lg">
        {/* Banner */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] px-5 py-3.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/20">
            <DatabaseBackup className="h-4 w-4 text-white" aria-hidden="true" />
          </span>
          <span className="flex-1 text-sm font-bold text-white">Backups</span>
          {canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/25"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            {anything ? "Edit backup details" : "Add backup details"}
          </button>
          )}
        </div>

        <div className="flex flex-col gap-3 bg-[#f8fafc] p-4">
          <section className="overflow-hidden rounded-xl border border-[#e3e9f5] bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-[#1a3a7a] bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] px-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/20">
                <DatabaseBackup className="h-3.5 w-3.5 text-white" aria-hidden="true" />
              </span>
              <h3 className="flex-1 text-sm font-bold text-white">Backup Plan</h3>
            </div>
            <ul className="divide-y divide-[#eef0f3]">
              {BACKUP_PLAN.map((p) => {
                const row = plan[p.key];
                const cred = row?.credential;
                const shown = cred ? pw.revealed[cred.id] : null;
                const statusLabel = !row ? "Not recorded" : row.kept ? (p.askKept ? "Kept" : "Recorded") : "Not kept";
                const statusColor = !row ? "text-[#9aa0ad]" : row.kept ? "text-emerald-600" : "text-amber-600";
                return (
                  <li key={p.key} className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-[#f8faff] sm:flex-row sm:items-start">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1f4693]/8 text-[#1f4693]">
                      <DatabaseBackup className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#2b303b]">{p.title}</span>
                        <span className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</span>
                      </p>
                      {p.hint && <p className="text-xs text-[#8a90a0]">{p.hint}</p>}
                      {row?.kept && (
                        <>
                          {row.location && (
                            <p className="mt-1 text-xs text-[#4a5068]">
                              <span className="font-medium text-[#8a90a0]">Location:</span> {row.location}
                            </p>
                          )}
                          {row.link && (
                            <a href={row.link} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-[#1f4693] hover:underline">
                              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">{shortUrl(row.link)}</span>
                            </a>
                          )}
                          {cred?.account && (
                            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#4a5068]">
                              <span className="font-medium text-[#8a90a0]">User:</span>
                              <span>{cred.account}</span>
                              <button type="button" onClick={() => copyToClipboard(cred.account).then((ok) => ok && setNotice({ text: "Username copied.", tone: "success" }))} aria-label={`Copy username for ${p.title}`} className="rounded p-0.5 text-[#9aa0ad] hover:text-[#1f4693]">
                                <Copy className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </p>
                          )}
                          {cred?.has_password && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span aria-live="polite" className={`rounded-md px-2 py-0.5 font-mono text-xs ${shown ? "bg-amber-50 text-[#2b303b]" : "bg-[#eef2fb] text-[#8a90a0] tracking-widest"}`}>
                                {shown ?? "••••••"}
                              </span>
                              {canReveal && (
                              <>
                              <button type="button" disabled={pw.busyId === cred.id} onClick={() => (shown ? pw.hide(cred.id) : pw.run(cred, "view"))} aria-label={shown ? `Hide password for ${p.title}` : `Show password for ${p.title}`} title={shown ? "Hide" : `Show for ${SHOW_SECONDS} seconds`} className="rounded p-1 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693] disabled:opacity-50">
                                {shown ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                              </button>
                              <button type="button" disabled={pw.busyId === cred.id} onClick={() => pw.run(cred, "copy")} aria-label={`Copy password for ${p.title}`} title="Copy without showing" className="rounded p-1 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693] disabled:opacity-50">
                                {pw.copiedId === cred.id ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                              </button>
                              </>
                              )}
                            </div>
                          )}
                          {row.backup_date && (
                            <p className="mt-0.5 text-xs text-[#4a5068]">
                              <span className="font-medium text-[#8a90a0]">Last backup:</span> {formatDate(row.backup_date)}
                            </p>
                          )}
                          {row.notes && <p className="mt-0.5 line-clamp-2 text-xs text-[#676b7a]">{row.notes}</p>}
                        </>
                      )}
                    </div>
                    {row && canDelete && (
                      <div className="flex shrink-0 gap-1 pl-11 sm:pl-0">
                        <button type="button" onClick={() => setRemoving({ row, plan: p })} aria-label={`Clear ${p.title}`} title="Clear" className="rounded-lg p-2 text-[#676b7a] hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      {editing && <BackupPlanModal projectId={projectId} existing={plan} onClose={() => setEditing(false)} onSaved={afterSave} />}
      {removing && (
        <ConfirmDialog
          title={`Clear ${removing.plan.title.toLowerCase()}?`}
          confirmLabel="Clear"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const result = await deleteBackup(removing.row.id);
            if (result.status === "success") await afterSave(`${removing.plan.title} cleared.`);
            return result;
          }}
        >
          The {removing.plan.title.toLowerCase()} details are removed from this sheet. Its login (username / password) stays in
          Access &amp; Logins, where you can delete it if no longer needed.
        </ConfirmDialog>
      )}
      {pw.pending && <ReauthModal onClose={pw.clearPending} onConfirmed={pw.confirmPending} />}
    </div>
  );
}

import { useCallback, useState } from "react";
import { Check, Copy, DatabaseBackup, ExternalLink, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
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

function Detail({ label, children }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-[#676b7a]">{label}</dt>
      <dd className="min-w-0 break-words text-[#2b303b]">{children || <span className="text-[#c4c8d0]">—</span>}</dd>
    </div>
  );
}

export default function BackupsTab({ projectId }) {
  const loader = useCallback(() => fetchBackupPlan(projectId), [projectId]);
  const { data, loading, error, reload } = useAdminData(loader, [projectId]);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState(null);
  const pw = usePasswordReveal({ onMessage: (text, tone) => setNotice({ text, tone }) });

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[#676b7a]">
          Where the complete code backup is kept, whether daily, weekly and monthly backups are kept, and the login for each.
        </p>
        <button type="button" onClick={() => setEditing(true)} className={BTN_PRIMARY}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {anything ? "Edit backup details" : "Add backup details"}
        </button>
      </div>

      <Notice text={notice?.text} tone={notice?.tone} onClose={() => setNotice(null)} />

      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {BACKUP_PLAN.map((p) => {
          const row = plan[p.key];
          const cred = row?.credential;
          const status = !row ? "Not recorded" : row.kept ? (p.askKept ? "Yes — kept" : "Recorded") : "No — not kept";
          const tone = !row ? "bg-[#f1f2f5] text-[#676b7a]" : row.kept ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800";
          const shown = cred ? pw.revealed[cred.id] : null;
          return (
            <li key={p.key} className="flex flex-col rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-[#2b303b]">{p.title}</h3>
                  <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{status}</span>
                </div>
                {row && (
                  <button
                    type="button"
                    onClick={() => setRemoving({ row, plan: p })}
                    aria-label={`Clear ${p.title}`}
                    title="Clear"
                    className="rounded-lg p-2 text-[#676b7a] hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {row?.kept ? (
                <dl className="divide-y divide-[#f1f2f5]">
                  <Detail label="Where it is kept">{row.location}</Detail>
                  <Detail label="Link">
                    {row.link && (
                      <a href={row.link} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-[#1f4693] hover:underline">
                        <span className="truncate">{shortUrl(row.link)}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </a>
                    )}
                  </Detail>
                  <Detail label="Username / email">
                    {cred?.account && (
                      <span className="inline-flex items-center gap-1">
                        <span className="truncate">{cred.account}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(cred.account).then((ok) => ok && setNotice({ text: "Username copied.", tone: "success" }))}
                          aria-label={`Copy username for ${p.title}`}
                          className="rounded p-1 text-[#9aa0ad] hover:bg-[#f3f4f7] hover:text-[#2b303b]"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </Detail>
                  <Detail label="Password">
                    {cred?.has_password && (
                      <span className="inline-flex items-center gap-1">
                        <span aria-live="polite" className={`max-w-[12rem] truncate rounded px-1.5 py-0.5 font-mono text-xs ${shown ? "bg-amber-50" : "bg-[#f6f7fb] text-[#676b7a]"}`}>
                          {shown ?? "••••••••"}
                        </span>
                        <button
                          type="button"
                          disabled={pw.busyId === cred.id}
                          onClick={() => (shown ? pw.hide(cred.id) : pw.run(cred, "view"))}
                          aria-label={shown ? `Hide password for ${p.title}` : `Show password for ${p.title}`}
                          title={shown ? "Hide" : `Show for ${SHOW_SECONDS} seconds`}
                          className="rounded p-1 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693] disabled:opacity-50"
                        >
                          {shown ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          disabled={pw.busyId === cred.id}
                          onClick={() => pw.run(cred, "copy")}
                          aria-label={`Copy password for ${p.title}`}
                          title="Copy without showing"
                          className="rounded p-1 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#1f4693] disabled:opacity-50"
                        >
                          {pw.copiedId === cred.id ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                      </span>
                    )}
                  </Detail>
                  <Detail label="Last backup">{formatDate(row.backup_date)}</Detail>
                  <Detail label="Notes">{row.notes}</Detail>
                </dl>
              ) : (
                <p className="text-sm text-[#9aa0ad]">
                  {row ? "Not kept for this project." : "Not filled in yet — use “" + (anything ? "Edit" : "Add") + " backup details”."}
                </p>
              )}
            </li>
          );
        })}
      </ul>

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

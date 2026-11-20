import { useState } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  CREDENTIAL_CATEGORIES,
  createCredential,
  setCredentialPassword,
  updateCredential,
} from "@/lib/api/admin/projectTrackerProject";
import { ChoiceChips, Field, FormMessage, Modal, PasswordInput } from "./ui";
import { BTN_PRIMARY, BTN_SECONDARY, inputClass } from "./styles";

// Dialogs shared by the project page's Access & Logins tab and the Access & Logins section.

// ---------------------------------------------------------------- dialogs

export function CredentialFormModal({ projectId, credential, onClose, onSaved }) {
  const editing = Boolean(credential?.id);
  const [form, setForm] = useState(() => ({
    category: credential?.category ?? "code_repo",
    service: credential?.service ?? "",
    account: credential?.account ?? "",
    email: credential?.email ?? "",
    repository: credential?.repository ?? "",
    login_url: credential?.login_url ?? "",
    purpose: credential?.purpose ?? "",
    two_factor: credential?.two_factor ?? false,
    notes: credential?.notes ?? "",
    password: "",
  }));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const result = editing ? await updateCredential(credential.id, form) : await createCredential(projectId, form);
    setSaving(false);
    if (result.status === "success") return onSaved(editing ? "Login updated." : "Login added.");
    if (result.status === "partial") return onSaved(result.message, "warning");
    setErrors(result.errors ?? {});
    setMessage(result.message);
  }

  const hint = CREDENTIAL_CATEGORIES.find((c) => c.value === form.category)?.hint;
  const text = (name, label, props = {}) => (
    <Field id={`pt-cred-${name}`} label={label} required={props.required} error={errors[name]} className={props.className}>
      <input
        id={`pt-cred-${name}`}
        type={props.type || "text"}
        value={form[name]}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        autoComplete="off"
        onChange={(e) => set(name, e.target.value)}
        aria-invalid={errors[name] ? "true" : undefined}
        aria-describedby={errors[name] ? `pt-cred-${name}-error` : undefined}
        className={inputClass(errors[name])}
      />
    </Field>
  );

  return (
    <Modal title={editing ? "Edit login" : "Add login"} titleId="pt-cred-dialog-title" onClose={onClose}>
      <form onSubmit={onSubmit} noValidate autoComplete="off" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <ChoiceChips
            id="pt-cred-category"
            label="Category"
            size="sm"
            value={form.category}
            onChange={(v) => set("category", v)}
            options={CREDENTIAL_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          />
        </div>
        {text("service", "Service / platform", { required: true, autoFocus: true, placeholder: hint ? `e.g. ${hint}` : "" })}
        {form.category === "code_repo" ? (
          <>
            {text("account", "Account (username)", { placeholder: "e.g. zyllotech-dev" })}
            {text("repository", "Repository", { placeholder: "owner/repo or repository link" })}
            {text("email", "Account email", { type: "email" })}
          </>
        ) : (
          text("account", "Username / email", { placeholder: "The login name or email for this account" })
        )}
        {text("login_url", "Login URL", { type: "url", placeholder: "https://" })}
        {text("purpose", "Used for", { className: "sm:col-span-2", placeholder: "e.g. Main code repo, production database, client admin panel" })}

        {!editing && (
          <Field id="pt-cred-password" label="Password" error={errors.password} className="sm:col-span-2">
            <PasswordInput
              id="pt-cred-password"
              value={form.password}
              onChange={(v) => set("password", v)}
              error={errors.password}
              placeholder="Optional — saved encrypted"
            />
            <p className="mt-1 flex items-center gap-1.5 text-xs text-[#676b7a]">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Saved encrypted in Supabase Vault. Never shown in lists, reports or logs.
            </p>
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm text-[#2b303b] sm:col-span-2">
          <input
            type="checkbox"
            checked={form.two_factor}
            onChange={(e) => set("two_factor", e.target.checked)}
            className="h-4 w-4 accent-[#f7941e]"
          />
          Two-factor authentication (2FA) is on for this account
        </label>

        <Field id="pt-cred-notes" label="Notes" error={errors.notes} className="sm:col-span-2">
          <textarea
            id="pt-cred-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="e.g. Recovery email, who owns the account, renewal date"
            className={`${inputClass(errors.notes)} resize-none`}
          />
        </Field>
        {editing && (
          <p className="text-xs text-[#676b7a] sm:col-span-2">
            To change the password, use <span className="font-semibold">Change password</span> (in View, or in the project's Access &amp; Logins tab).
          </p>
        )}

        <FormMessage message={message} />
        <div className="flex justify-end gap-3 sm:col-span-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add login"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PasswordModal({ credential, onClose, onSaved }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const changing = credential.has_password;

  async function onSubmit(e) {
    e.preventDefault();
    if (!password) return setError("Enter the password.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setSaving(true);
    const result = await setCredentialPassword(credential.id, password);
    setSaving(false);
    setPassword("");
    setConfirm("");
    if (result.status === "success") return onSaved(changing ? "Password changed." : "Password saved.");
    setError(result.message);
  }

  return (
    <Modal
      title={`${changing ? "Change" : "Add"} password — ${credential.service}`}
      titleId="pt-pw-dialog-title"
      onClose={onClose}
      size="max-w-md"
    >
      <form onSubmit={onSubmit} noValidate autoComplete="off" className="flex flex-col gap-4">
        {credential.account && <p className="text-sm text-[#676b7a]">Account: {credential.account}</p>}
        <Field id="pt-pw-new" label={changing ? "New password" : "Password"}>
          <PasswordInput id="pt-pw-new" value={password} onChange={setPassword} autoFocus />
        </Field>
        <Field id="pt-pw-confirm" label="Type it again">
          <PasswordInput id="pt-pw-confirm" value={confirm} onChange={setConfirm} />
        </Field>
        <p className="flex items-center gap-1.5 text-xs text-[#676b7a]">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Saved encrypted in Supabase Vault{changing ? "; the old password is replaced" : ""}.
        </p>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : "Save password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Asks for the admin's own login password, signs in again, then continues. */
export function ReauthModal({ onClose, onConfirmed }) {
  const { user, signIn } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!password) return setError("Enter your password.");
    setBusy(true);
    setError("");
    const { error: authError } = await signIn(user?.email, password);
    setPassword("");
    setBusy(false);
    if (authError) return setError("That password is not correct.");
    onConfirmed();
  }

  return (
    <Modal title="Confirm it's you" titleId="pt-reauth-title" onClose={onClose} size="max-w-sm">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-[#676b7a]">
          To see, copy or download saved passwords, enter the password you use to sign in to this admin area.
          You won&apos;t be asked again for 10 minutes.
        </p>
        <p className="text-sm font-medium text-[#2b303b]">{user?.email}</p>
        <Field id="pt-reauth-password" label="Your login password">
          <PasswordInput
            id="pt-reauth-password"
            value={password}
            onChange={setPassword}
            autoFocus
            autoComplete="current-password"
          />
        </Field>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={BTN_PRIMARY}>
            {busy ? "Checking…" : "Confirm"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

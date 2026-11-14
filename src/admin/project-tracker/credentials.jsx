// Vault-backed password UI. Security notes:
// * A password reaches the browser only from an explicit reveal/copy call that
//   the server authorizes (manager + recent sign-in) and logs.
// * Revealed values live only in component state, are hidden again after the
//   server-given time, are never written to storage, logs or the URL.
// * "Copy" never renders the value. The browser clipboard cannot be cleared
//   reliably by a web page; users are told so.
import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Lock, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { Banner, Button, ConfirmDialog, Modal, PasswordInput, useToast } from "./ui";
import { useRole } from "./context";
import { clearAccessPassword, reauthenticate, revealAccessPassword, setAccessPassword } from "@/lib/api/admin/projectTracker";
import { formatDateTime } from "./lib/format";

export function useBackend() {
  const { settings } = useRole();
  return settings?.password_backend || "disabled";
}

export function VaultBanner() {
  const backend = useBackend();
  const { settings } = useRole();
  if (backend === "supabase_vault") {
    return (
      <Banner tone="success" title="Passwords are stored encrypted in Supabase Vault">
        Managers can reveal or copy a password after signing in within the last {settings?.reauth_minutes ?? 10} minutes. Revealed passwords hide
        again after {settings?.reveal_seconds ?? 30} seconds. Every reveal, copy, change and refusal is recorded — never the password itself.
      </Banner>
    );
  }
  if (backend === "test_double") {
    return (
      <Banner tone="danger" title="TEST DOUBLE — NOT ENCRYPTED — local testing only">
        Passwords are kept in a plaintext stand-in for Supabase Vault so the authorization and audit flow can be tested. Use synthetic passwords only.
        This mode can never be enabled on a real project.
      </Banner>
    );
  }
  return (
    <Banner tone="warning" title="Saving actual passwords is disabled — no secure vault is configured">
      Project Tracker is ready to store passwords in Supabase Vault (encrypted, key managed outside the database), but it stays switched off until the
      vault is enabled and verified on this project with your approval. Until then, record the account details here and keep the password in your
      password manager — use <strong>Set reference</strong> to note where.
    </Banner>
  );
}

function ReauthModal({ minutes, onClose, onDone }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    if (!pw) return;
    setBusy(true);
    setError("");
    try {
      await reauthenticate(pw);
      setPw("");
      await onDone();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Confirm it's you" onClose={onClose} size="sm" busy={busy}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-[#4b4f5c]">
          Viewing a stored password needs a sign-in within the last {minutes} minutes. Enter <strong>your own</strong> admin password to continue.
        </p>
        <PasswordInput label="Your password" value={pw} onChange={setPw} required />
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!pw}>Confirm</Button>
        </div>
      </form>
    </Modal>
  );
}

export function SetPasswordModal({ record, onClose, onDone }) {
  const backend = useBackend();
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    if (!pw) return setError("Enter the password.");
    if (pw !== pw2) return setError("The two passwords do not match.");
    setBusy(true);
    setError("");
    try {
      await setAccessPassword(record.id, pw);
      setPw(""); setPw2("");
      toast.push(record.has_password ? "Password changed." : "Password saved.");
      await onDone?.();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title={`${record.has_password ? "Change" : "Save"} password — ${record.service_name}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="space-y-3" autoComplete="off">
        {backend === "test_double" && <Banner tone="danger" title="TEST DOUBLE — not encrypted">Use a synthetic password only.</Banner>}
        <p className="text-sm text-[#4b4f5c]">
          {record.login_identifier ? <>Account: <strong className="break-all">{record.login_identifier}</strong>. </> : null}
          The password goes straight to the vault; it is never stored in Project Tracker tables. Do not enter API keys, service-role keys or tokens.
        </p>
        <PasswordInput label="Password" value={pw} onChange={setPw} required />
        <PasswordInput label="Repeat password" value={pw2} onChange={setPw2} required />
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save password</Button>
        </div>
      </form>
    </Modal>
  );
}

const REASON = {
  forbidden: "Only Project Tracker managers can view or copy passwords.",
  rate_limited: "Too many password views in the last 10 minutes. Try again later.",
  no_password: "No password is stored for this account.",
  disabled: "Password storage is disabled (no secure vault configured).",
};

/**
 * Password cell for one credential record: masked by default; eye = reveal
 * (auto-hides), copy = copy without showing. `record` is a pt_access_records
 * row (has_password, password_updated_at, service_name, login_identifier).
 * `onEnsure` (optional) creates the credential record first (email/hosting rows).
 */
export function PasswordCell({ record, readOnly, onChanged, onEnsure, compact = false }) {
  const backend = useBackend();
  const { isManager, canEdit, settings } = useRole();
  const toast = useToast();
  const [shown, setShown] = useState(null); // { value, left }
  const [busy, setBusy] = useState("");
  const [reauth, setReauth] = useState(null); // pending action
  const [setting, setSetting] = useState(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!shown) return undefined;
    const t = setInterval(() => setShown((s) => (s && s.left > 1 ? { ...s, left: s.left - 1 } : null)), 1000);
    return () => clearInterval(t);
  }, [shown]);
  useEffect(() => () => setShown(null), []);

  const run = useCallback(async (purpose) => {
    setBusy(purpose);
    try {
      const r = await revealAccessPassword(record.id, purpose);
      if (r?.ok) {
        if (purpose === "copy") {
          try {
            await navigator.clipboard.writeText(r.password);
            toast.push("Password copied. Paste it where needed — the clipboard is not cleared automatically.");
          } catch {
            toast.push("The browser blocked clipboard access. Use the eye button instead.", "danger");
          }
        } else {
          setShown({ value: r.password, left: Number(r.expires_in) || 30 });
        }
      } else if (r?.reason === "reauth_required") {
        setReauth(purpose);
      } else {
        toast.push(REASON[r?.reason] || "The password could not be shown.", "danger");
      }
    } catch (e) {
      toast.push(e.message, "danger");
    } finally {
      setBusy("");
    }
  }, [record.id, toast]);

  if (backend === "disabled") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[#676b7a]" title="Password storage is disabled until a secure vault is configured">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />Vault not configured
        <button type="button" disabled aria-label="Show password (disabled: no secure vault)" className="rounded p-1 opacity-40"><Eye className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" disabled aria-label="Copy password (disabled: no secure vault)" className="rounded p-1 opacity-40"><Copy className="h-4 w-4" aria-hidden="true" /></button>
      </span>
    );
  }

  const writable = canEdit && !readOnly;
  if (!record.has_password) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-[#676b7a]">
        Not stored
        {writable && (
          <Button size="sm" variant="secondary" icon={KeyRound} onClick={async () => {
            try { const rec = onEnsure ? await onEnsure() : record; setSetting(rec); } catch (e) { toast.push(e.message, "danger"); }
          }}>Set password</Button>
        )}
        {setting && <SetPasswordModal record={setting} onClose={() => setSetting(null)} onDone={onChanged} />}
      </span>
    );
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${compact ? "" : "min-w-[13rem]"}`}>
      <span aria-live="polite" className={`rounded-md border px-2 py-1 font-mono text-[13px] ${shown ? "border-amber-300 bg-amber-50 text-[#101a3a]" : "border-[#e7e9ee] bg-[#f8f9fb] text-[#676b7a]"}`}>
        {shown ? <span className="select-all break-all">{shown.value}</span> : "••••••••••"}
      </span>
      {shown && <span className="text-[11px] text-amber-800">hides in {shown.left}s</span>}
      <button type="button" disabled={!isManager || busy === "reveal"} onClick={() => (shown ? setShown(null) : run("reveal"))}
        title={isManager ? (shown ? "Hide password" : "Show password") : "Only managers can view passwords"}
        aria-label={shown ? "Hide password" : "Show password"} aria-pressed={Boolean(shown)}
        className="rounded p-1.5 text-[#1f4693] hover:bg-[#1f4693]/10 disabled:cursor-not-allowed disabled:text-[#b3b8c4]">
        {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
      <button type="button" disabled={!isManager || busy === "copy"} onClick={() => run("copy")}
        title={isManager ? "Copy password" : "Only managers can copy passwords"} aria-label="Copy password"
        className="rounded p-1.5 text-[#1f4693] hover:bg-[#1f4693]/10 disabled:cursor-not-allowed disabled:text-[#b3b8c4]">
        <Copy className="h-4 w-4" aria-hidden="true" />
      </button>
      {writable && (
        <button type="button" onClick={() => setSetting(record)} title="Change password" aria-label="Change password"
          className="rounded p-1.5 text-[#676b7a] hover:bg-[#f1f3f7]"><KeyRound className="h-4 w-4" aria-hidden="true" /></button>
      )}
      {isManager && !readOnly && (
        <button type="button" onClick={() => setClearing(true)} title="Remove stored password" aria-label="Remove stored password"
          className="rounded p-1.5 text-[#676b7a] hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
      )}
      {!compact && record.password_updated_at && (
        <span className="w-full text-[11px] text-[#8a8f9c]">updated {formatDateTime(record.password_updated_at)}{record.password_updated_by_email ? ` · ${record.password_updated_by_email}` : ""}</span>
      )}
      {reauth && <ReauthModal minutes={settings?.reauth_minutes ?? 10} onClose={() => setReauth(null)} onDone={() => run(reauth)} />}
      {setting && <SetPasswordModal record={setting} onClose={() => setSetting(null)} onDone={onChanged} />}
      {clearing && (
        <ConfirmDialog title={`Remove the stored password for ${record.service_name}?`} confirmLabel="Remove password"
          message="The password is deleted from the vault (revocation). The account details stay. This cannot be undone."
          onConfirm={async () => { await clearAccessPassword(record.id); toast.push("Stored password removed."); await onChanged?.(); }}
          onClose={() => setClearing(false)} />
      )}
    </span>
  );
}

export function BackendBadge() {
  const backend = useBackend();
  const Icon = backend === "supabase_vault" ? ShieldCheck : ShieldAlert;
  const cls = backend === "supabase_vault" ? "text-emerald-700" : backend === "test_double" ? "text-red-700" : "text-amber-800";
  const label = backend === "supabase_vault" ? "Vault: encrypted" : backend === "test_double" ? "Vault: TEST DOUBLE" : "Vault: not configured";
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold ${cls}`}><Icon className="h-4 w-4" aria-hidden="true" />{label}</span>;
}

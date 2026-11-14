import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, KeyRound } from "lucide-react";
import RecordSection from "../RecordSection";
import { Banner, Button, Modal, TextInput, useToast } from "../ui";
import { useProject, useRole } from "../context";
import { BackendBadge, PasswordCell, VaultBanner, useBackend } from "../credentials";
import { revealAccessReference, setAccessPassword, setAccessReference } from "@/lib/api/admin/projectTracker";
import { looksLikeSecret } from "../lib/validation";
import { formatDateTime } from "../lib/format";
import { CREDENTIAL_GROUPS } from "../lib/options";

function SetReferenceModal({ record, onClose, onSaved }) {
  const toast = useToast();
  const [identifier, setIdentifier] = useState(record.login_identifier || "");
  const [vaultRef, setVaultRef] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (vaultRef.trim().length < 3) errs.vaultRef = "Enter where the secret is stored (3–300 characters).";
    if (vaultRef.length > 300) errs.vaultRef = "300 characters max.";
    if (identifier.length > 200) errs.identifier = "200 characters max.";
    if (looksLikeSecret(vaultRef)) errs.vaultRef = "This looks like a password, key or token. Enter only its location in the password manager.";
    if (looksLikeSecret(identifier)) errs.identifier = "This looks like a secret. Enter only the username / account ID.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError("");
    try {
      await setAccessReference(record.id, identifier.trim(), vaultRef.trim());
      toast.push("Password-manager reference saved.");
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Password-manager reference — ${record.service_name}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Banner tone="info" title="Where the password lives (not the password)">
          For accounts whose password stays in your password manager, record where it is kept, e.g. <em>1Password › Clients › Acme › cPanel</em>.
          Managers can view this reference; every view is logged.
        </Banner>
        {record.has_reference && <p className="text-sm text-[#676b7a]">A reference already exists (updated {formatDateTime(record.reference_updated_at)}). Saving replaces it.</p>}
        <TextInput label="Username / Account Identifier" value={identifier} onChange={setIdentifier} error={errors.identifier} autoComplete="off" maxLength={200} />
        <TextInput label="Password-manager reference" required value={vaultRef} onChange={setVaultRef} error={errors.vaultRef} autoComplete="off" maxLength={300} />
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex justify-end gap-2 border-t border-[#eef0f4] pt-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save reference</Button>
        </div>
      </form>
    </Modal>
  );
}

function RevealReferenceModal({ record, onClose }) {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(60);
  useEffect(() => {
    let active = true;
    revealAccessReference(record.id).then((d) => active && setData(d)).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [record.id]);
  useEffect(() => {
    if (!data) return undefined;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [data]);
  useEffect(() => { if (secondsLeft === 0) onClose(); }, [secondsLeft, onClose]);
  return (
    <Modal title={`Reference — ${record.service_name}`} onClose={onClose} size="sm" footer={<Button onClick={onClose}>Hide</Button>}>
      {error ? <Banner tone="danger">{error}</Banner> : data === undefined ? <p className="text-sm text-[#676b7a]">Loading…</p> : !data ? (
        <p className="text-sm text-[#676b7a]">No reference recorded.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div><p className="text-xs font-medium uppercase tracking-wide text-[#8a8f9c]">Username / Account Identifier</p><p className="break-all font-mono">{data.account_identifier || "—"}</p></div>
          <div><p className="text-xs font-medium uppercase tracking-wide text-[#8a8f9c]">Password-manager reference</p><p className="break-all font-mono">{data.vault_reference}</p></div>
          <p className="text-xs text-[#676b7a]">Last changed {formatDateTime(data.updated_at)}{data.updated_by_email ? ` by ${data.updated_by_email}` : ""}. This view is recorded in the activity log. Hides in {secondsLeft}s.</p>
        </div>
      )}
    </Modal>
  );
}

export default function AccessTab() {
  const { readOnly, reloadProject, reloadRefs } = useProject();
  const { canEdit, isManager } = useRole();
  const backend = useBackend();
  const toast = useToast();
  const [group, setGroup] = useState("");
  const [setting, setSetting] = useState(null);
  const [revealing, setRevealing] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => { setReloadKey((k) => k + 1); reloadRefs(); reloadProject(); }, [reloadRefs, reloadProject]);

  const rowFilter = useMemo(() => {
    if (!group) return null;
    const g = CREDENTIAL_GROUPS.find((x) => x.value === group);
    const cats = g?.includes || [group];
    return (r) => cats.includes(r.category);
  }, [group]);

  // Password input in the form: disabled (with the reason) until a vault is configured.
  const fieldsOverride = useMemo(() => (fields) => fields.map((f) => (f.name !== "password" ? f
    : backend === "disabled" ? { ...f, disabled: true, disabledReason: "Saving passwords is disabled until a secure vault is configured." } : f)), [backend]);

  const columnsOverride = useCallback((cols) => cols.map((c) => (c.key !== "has_password" ? c : {
    ...c, sortable: false,
    render: (r) => <PasswordCell record={r} readOnly={readOnly || Boolean(r.archived_at)} onChanged={refresh} />,
  })), [readOnly, refresh]);

  const afterSave = useCallback(async (record, values) => {
    if (values?.password && backend !== "disabled") {
      await setAccessPassword(record.id, values.password);
      toast.push("Password saved to the vault.");
    }
  }, [backend, toast]);

  return (
    <div className="space-y-4">
      <VaultBanner />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Credential type">
        <Button size="sm" variant={group === "" ? "primary" : "secondary"} aria-pressed={group === ""} onClick={() => setGroup("")}>All</Button>
        {CREDENTIAL_GROUPS.map((g) => (
          <Button key={g.value} size="sm" variant={group === g.value ? "primary" : "secondary"} aria-pressed={group === g.value} onClick={() => setGroup(g.value)}>{g.label}</Button>
        ))}
        <span className="ml-auto"><BackendBadge /></span>
      </div>
      <RecordSection
        key={reloadKey}
        sectionKey="access"
        rowFilter={rowFilter}
        fieldsOverride={fieldsOverride}
        columnsOverride={columnsOverride}
        afterSave={afterSave}
        onChanged={refresh}
        description="Email, hosting, website admin, Supabase, database, registrar, GitHub and other service logins for this project. Passwords are masked; only managers can reveal or copy them, after a recent sign-in. Never enter API keys or service-role keys."
        emptyHint={group ? "No credentials of this type yet." : "No credentials recorded for this project yet."}
        rowActions={(r) => [
          { key: "ref", label: r.has_reference ? "Change reference" : "Set reference", icon: KeyRound, hidden: !canEdit || readOnly || !!r.archived_at, onClick: () => setSetting(r) },
          { key: "reveal", label: "View reference", icon: Eye, hidden: !isManager || !r.has_reference, onClick: () => setRevealing(r) },
        ]}
      />
      {setting && <SetReferenceModal record={setting} onClose={() => setSetting(null)} onSaved={refresh} />}
      {revealing && <RevealReferenceModal record={revealing} onClose={() => setRevealing(null)} />}
    </div>
  );
}

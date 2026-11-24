import { useState } from "react";
import { Check, Eye, EyeOff, KeyRound, X } from "lucide-react";
import { changeOwnPassword } from "@/lib/api/account";
import { PASSWORD_RULES } from "@/lib/api/employee/password";
import { Alert, Panel } from "./PortalUI";
import { BTN_PRIMARY, INPUT, LABEL } from "./portalStyles";

function PasswordInput({ id, label, value, onChange, error, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <label htmlFor={id} className="block">
      <span className={LABEL}>{label}</span>
      <span className="relative block">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-invalid={error ? "true" : undefined}
          className={`${INPUT(!!error)} pr-10`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#9aa0ad] hover:text-[#1f4693]"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </span>
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

/** My profile: change my own password (current password required). Works for admins and employees. */
export default function ChangePasswordCard({ onChanged } = {}) {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => {
    setF((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!f.current) errs.current = "Enter your current password.";
    if (!f.next) errs.next = "Enter a new password.";
    if (f.next && f.confirm !== f.next) errs.confirm = "The two new passwords are not the same.";
    if (Object.keys(errs).length) return setErrors(errs);
    setBusy(true);
    setMsg({ kind: "", text: "" });
    const r = await changeOwnPassword(f.current, f.next);
    setBusy(false);
    if (!r.ok) {
      if (r.field) setErrors({ [r.field]: r.message });
      return setMsg({ kind: "err", text: r.message });
    }
    setF({ current: "", next: "", confirm: "" });
    setMsg({ kind: "ok", text: "Password changed. Use your new password the next time you sign in." });
    onChanged?.();
  }

  return (
    <Panel icon={KeyRound} title="Change password" subtitle="Enter your current password, then the new one twice.">
      <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-3">
        <PasswordInput id="pw-current" label="Current password" value={f.current} onChange={(v) => set("current", v)} error={errors.current} autoComplete="current-password" />
        <PasswordInput id="pw-next" label="New password" value={f.next} onChange={(v) => set("next", v)} error={errors.next} autoComplete="new-password" />
        <PasswordInput id="pw-confirm" label="Repeat new password" value={f.confirm} onChange={(v) => set("confirm", v)} error={errors.confirm} autoComplete="new-password" />
        <ul className="grid gap-1 text-xs md:col-span-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Password rules">
          {PASSWORD_RULES.map((r) => {
            const ok = r.test(f.next);
            return (
              <li key={r.key} className={`flex items-center gap-1.5 ${ok ? "text-emerald-700" : "text-[#9aa0ad]"}`}>
                {ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                {r.label}
              </li>
            );
          })}
        </ul>
        {msg.text && (
          <Alert kind={msg.kind === "ok" ? "ok" : "err"} className="md:col-span-3">
            {msg.text}
          </Alert>
        )}
        <div className="md:col-span-3">
          <button type="submit" disabled={busy} className={BTN_PRIMARY}>
            <KeyRound className="h-4 w-4" aria-hidden="true" /> {busy ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

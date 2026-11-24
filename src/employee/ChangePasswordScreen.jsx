import { useState } from "react";
import { Check, Eye, EyeOff, KeyRound, LogOut, X } from "lucide-react";
import { PASSWORD_RULES, changeMyPassword, passwordProblem } from "@/lib/api/employee/password";
import { Alert } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/components/portal/portalStyles";

function PasswordField({ id, label, value, onChange, show, onToggle, autoFocus }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          autoFocus={autoFocus}
          spellCheck={false}
          className={`${INPUT(false)} pr-10`}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#676b7a] hover:text-[#2b303b]"
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/**
 * First sign-in with a temporary password (migration 249): the employee must
 * set their own password. Afterwards they are signed out and sent to the login
 * page to sign in with the new password.
 */
export default function ChangePasswordScreen({ me, signOut }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    const problem = passwordProblem(pw);
    if (problem) return setError(problem);
    if (pw !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    setError("");
    const r = await changeMyPassword(pw);
    if (!r.ok) {
      setBusy(false);
      return setError(r.message);
    }
    // Sign out and go to the login page to sign in with the new password.
    await signOut().catch(() => {});
    window.location.replace("/login?changed=1&next=%2Femployee");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f6f7fb] p-4 sm:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#f7941e]/15 blur-[90px]" />
        <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-[#1f4693]/15 blur-[90px]" />
      </div>
      <form
        onSubmit={submit}
        noValidate
        className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_-24px_rgba(16,26,58,0.45)] ring-1 ring-[#e7e9ee]"
        aria-labelledby="cp-title"
      >
        <div className="relative bg-gradient-to-br from-[#101a3a] via-[#173a52] to-[#3089a6] px-6 pb-10 pt-6 text-white">
          <div aria-hidden="true" className="absolute -right-8 -top-14 h-40 w-40 rounded-full bg-[#f7941e]/40 blur-[60px]" />
          <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">First sign-in</p>
          <h1 id="cp-title" className="relative mt-1 text-2xl font-bold">
            Change your password
          </h1>
          <p className="relative mt-1 text-sm text-white/80">
            Hi {me.full_name?.split(" ")[0] || "there"}, you signed in with a temporary password. Set your own password to continue.
          </p>
        </div>
        <span className="relative mx-auto -mt-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white shadow-[0_10px_24px_-8px_rgba(249,103,6,0.7)] ring-4 ring-white">
          <KeyRound className="h-6 w-6" aria-hidden="true" />
        </span>

        <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
          {error && <Alert kind="err">{error}</Alert>}
          <PasswordField id="cp-new" label="New password" value={pw} onChange={setPw} show={show} onToggle={() => setShow(!show)} autoFocus />
          <ul className="grid gap-1.5 rounded-xl bg-[#f8fafd] px-3.5 py-3 text-xs ring-1 ring-inset ring-[#eef1f7]" aria-label="Password rules">
            {PASSWORD_RULES.map((r) => {
              const ok = r.test(pw);
              return (
                <li key={r.key} className={`flex items-center gap-2 ${ok ? "text-emerald-700" : "text-[#676b7a]"}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full ${ok ? "bg-emerald-100" : "bg-[#eef0f5]"}`}>
                    {ok ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3 text-[#b0b8cc]" aria-hidden="true" />}
                  </span>
                  {r.label}
                  <span className="sr-only">{ok ? "(done)" : "(missing)"}</span>
                </li>
              );
            })}
          </ul>
          <PasswordField id="cp-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} show={show} onToggle={() => setShow(!show)} />
          {confirm && pw !== confirm && <p className="-mt-2 text-xs text-red-600">The passwords do not match yet.</p>}
          <button type="submit" disabled={busy} className={`${BTN_PRIMARY} w-full py-3 text-base`}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {busy ? "Saving…" : "Change password"}
          </button>
          <p className="text-center text-xs text-[#9aa0ad]">After this you will sign in again with your new password.</p>
          <button type="button" disabled={busy} onClick={() => signOut()} className={`${BTN_SECONDARY} w-full`}>
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </button>
        </div>
      </form>
    </div>
  );
}

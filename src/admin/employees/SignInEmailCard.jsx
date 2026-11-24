import { useState } from "react";
import { AtSign, CheckCircle2, Loader2, Mail, MailWarning, Send } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { checkRealEmail } from "@/lib/emailCheck";
import { Alert, Badge, Panel } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/components/portal/portalStyles";

const KNOWN = /real email|valid sign-in email|already belongs|permission|Super Admin|not possible/i;

/** Status of the welcome email (migration 268) as a small badge. */
export function WelcomeBadge({ welcome }) {
  if (!welcome) return null;
  if (welcome.status === "delivered")
    return (
      <Badge tone="green">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Sign-in email delivered
      </Badge>
    );
  if (welcome.status === "bounced")
    return (
      <Badge tone="red">
        <MailWarning className="h-3 w-3" aria-hidden="true" /> Mailbox does not exist
      </Badge>
    );
  if (welcome.status === "failed")
    return (
      <Badge tone="red">
        <MailWarning className="h-3 w-3" aria-hidden="true" /> Sign-in email not sent
      </Badge>
    );
  return (
    <Badge tone="amber">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Sign-in email sending
    </Badge>
  );
}

/** Change the sign-in email and email a new one-time password (rbac_admin_change_email). */
export function ChangeEmailForm({ userId, currentEmail, needsRealEmail = true, onDone, onCancel }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!v) return setError("Enter the correct email address.");
    setBusy(true);
    setError("");
    if (needsRealEmail) {
      const real = await checkRealEmail(v);
      if (!real.ok) {
        setBusy(false);
        return setError(real.message);
      }
    }
    const { data, error: err } = await supabase.rpc("rbac_admin_change_email", { p_user: userId, p_email: v });
    setBusy(false);
    if (err) return setError(KNOWN.test(err.message ?? "") ? err.message : "Could not change the email. Please try again.");
    setResult(data);
    onDone?.(data);
  }

  if (result) {
    return result.welcome === "sending" ? (
      <Alert kind="ok">New sign-in details were emailed to {result.email}. They must choose their own password at the first sign-in.</Alert>
    ) : (
      <Alert kind="warn">
        Sign-in email changed to <b>{result.email}</b>. Email is not set up yet, so give them this one-time password yourself:{" "}
        <span className="font-mono font-semibold">{result.password}</span>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <label htmlFor={`ce-${userId}`} className={LABEL}>
        Correct sign-in email (now: {currentEmail})
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`ce-${userId}`}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError("");
          }}
          placeholder="name@company.com"
          className={INPUT(!!error)}
        />
        <button type="submit" disabled={busy} className={`${BTN_PRIMARY} shrink-0`}>
          <Send className="h-4 w-4" aria-hidden="true" /> {busy ? "Saving…" : "Change & resend"}
        </button>
        {onCancel && (
          <button type="button" disabled={busy} onClick={onCancel} className={`${BTN_SECONDARY} shrink-0`}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-[#9aa0ad]">A new one-time password is emailed to the new address; the old password stops working.</p>
    </form>
  );
}

/** Employee page: sign-in email, welcome email status, change & resend. */
export default function SignInEmailCard({ emp, canEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const w = emp.welcome;
  return (
    <Panel icon={AtSign} title="Sign-in email" subtitle="Where the sign-in details (one-time password) were sent" action={<WelcomeBadge welcome={w} />}>
      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-[#101a3a]">
          <Mail className="h-4 w-4 text-[#9aa0ad]" aria-hidden="true" />
          <span className="break-all font-semibold">{emp.sign_in_email ?? emp.work_email}</span>
        </p>
        {w?.status === "bounced" && (
          <Alert kind="err">The mailbox {w.email} does not exist, so the sign-in details never arrived. Enter the correct email below.</Alert>
        )}
        {w?.status === "failed" && <Alert kind="err">The sign-in email could not be sent{w.error ? `: ${w.error}` : "."}</Alert>}
        {canEdit &&
          (open || w?.status === "bounced" || w?.status === "failed" ? (
            <ChangeEmailForm
              userId={emp.user_id}
              currentEmail={emp.sign_in_email ?? emp.work_email}
              onDone={(d) => onChanged?.(d)}
              onCancel={w?.status === "bounced" || w?.status === "failed" ? undefined : () => setOpen(false)}
            />
          ) : (
            <div>
              <button type="button" onClick={() => setOpen(true)} className={BTN_SECONDARY}>
                <Send className="h-4 w-4" aria-hidden="true" /> Change sign-in email & resend
              </button>
            </div>
          ))}
      </div>
    </Panel>
  );
}

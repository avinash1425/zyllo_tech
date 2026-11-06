// /employee/activate — landing page of the HR invitation email. Supabase Auth
// puts a one-time session in the URL; the employee sets their own password
// here (never seen or stored by HR), then the account is marked activated.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck } from "lucide-react";
import Seo from "@/hr/platform/Seo";
import { supabase } from "@/hr/platform/supabase";
import { rpc } from "@/lib/hr/client";
import { useAuth } from "@/hr/platform/auth";
import { Button, Field, InlineError, Input, Loading } from "@/hr/ui";

export function passwordProblems(pw) {
  const p = [];
  if (pw.length < 12) p.push("at least 12 characters");
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) p.push("upper- and lower-case letters");
  if (!/\d/.test(pw)) p.push("a number");
  return p;
}

export default function ActivatePage() {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const [state, setState] = useState("checking");   // checking | ready | invalid
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    // supabase-js parses the invite tokens from the URL on load.
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (active) setState(data.session ? "ready" : "invalid");
    }, 400);
    return () => { active = false; clearTimeout(t); };
  }, []);

  async function submit(e) {
    e.preventDefault();
    const problems = passwordProblems(pw);
    if (problems.length) { setError(`Password needs ${problems.join(", ")}.`); return; }
    if (pw !== pw2) { setError("The passwords do not match."); return; }
    setBusy(true); setError(null);
    const { error: upErr } = await supabase.auth.updateUser({ password: pw });
    if (upErr) { setBusy(false); setError(upErr.message); return; }
    const res = await rpc("hr_activate_my_account");
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    await refreshProfile();
    navigate("/employee", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0e17] px-4 py-10">
      <Seo title="Activate your account" noindex />
      <div className="w-full max-w-md rounded-[1.65rem] bg-white p-7 shadow-2xl">
        <div className="flex items-center gap-2 text-[#101a3a]"><ShieldCheck className="h-6 w-6 text-[#f96706]" aria-hidden="true" /><h1 className="text-xl font-extrabold">Activate your Zyllo Tech account</h1></div>
        {state === "checking" && <Loading label="Verifying your invitation…" />}
        {state === "invalid" && (
          <div className="mt-4 text-sm text-slate-700">
            <p>This invitation link is invalid or has expired. Invitation links can be used once.</p>
            <p className="mt-2">Ask HR to send a new invitation, or <a className="font-semibold text-[#1f4693] underline" href="/login">sign in</a> if you already set your password.</p>
          </div>
        )}
        {state === "ready" && (
          <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-3">
            <p className="text-sm text-slate-600">Choose a password. It is known only to you.</p>
            <Field label="New password" required hint="At least 12 characters, with upper- and lower-case letters and a number."><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Confirm password" required><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
            <InlineError message={error} />
            <Button type="submit" loading={busy}><KeyRound className="h-4 w-4" aria-hidden="true" />Set password and continue</Button>
          </form>
        )}
      </div>
    </div>
  );
}

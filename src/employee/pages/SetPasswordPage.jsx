// /employee/set-password — Employee ID accounts choose their own password
// after HR issues a temporary one (first login / reset) or when it expires.
// Until then the database grants the account no employee data (hr_me shows
// login.password_change_required). The change runs in the Edge Function
// hr-change-my-password, which verifies the current password, stores the new
// one in Supabase Auth only, and ends every session (this page then signs in
// again with the new password).
// Mounted as its own route (outside RequireEmployee) so it cannot loop.
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import Seo from "@/hr/platform/Seo";
import { SET_PASSWORD_PATH, useAuth } from "@/hr/platform/auth";
import { invokeFunction } from "@/lib/hr/client";
import { Button, Field, InlineError, Input, Loading } from "@/hr/ui";
import { passwordProblems } from "@/employee/pages/ActivatePage";

export default function SetPasswordPage() {
  const navigate = useNavigate();
  const { user, hr, loading, signIn, signOut, destination } = useAuth();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="min-h-screen bg-[#0b0e17]"><Loading label="Checking your account…" /></div>;
  if (!user) return <Navigate to="/hr/login?next=/employee/set-password" replace />;
  // Email accounts (Website Admin / HR Admin / invited employees) do not use this page.
  if (!hr?.login) return <Navigate to={destination} replace />;

  const required = Boolean(hr.login.password_change_required);
  const reason = hr.login.reason;

  async function submit(e) {
    e.preventDefault();
    const problems = passwordProblems(pw);
    if (hr.login.login_id && pw.toLowerCase().includes(String(hr.login.login_id).toLowerCase())) problems.push("not your Employee ID");
    if (!current) { setError("Enter your current password."); return; }
    if (problems.length) { setError(`Password needs ${problems.join(", ")}.`); return; }
    if (pw !== pw2) { setError("The passwords do not match."); return; }
    if (pw === current) { setError("Choose a password different from the current one."); return; }
    setBusy(true); setError(null);
    const res = await invokeFunction("hr-change-my-password", { current_password: current, new_password: pw });
    if (res.error) { setBusy(false); setError(res.error); return; }
    // Supabase Auth ended every session when the password changed: sign in
    // again with the new password (kept only in this component's memory).
    const again = await signIn(hr.login.login_id, pw);
    setCurrent(""); setPw(""); setPw2("");
    setBusy(false);
    if (again.error) { navigate("/hr/login", { replace: true }); return; }
    navigate(again.destination === SET_PASSWORD_PATH ? "/employee" : again.destination, { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0e17] px-4 py-10">
      <Seo title="Choose your password" noindex />
      <div className="w-full max-w-md rounded-[1.65rem] bg-white p-7 shadow-2xl">
        <div className="flex items-center gap-2 text-[#101a3a]">
          <ShieldCheck className="h-6 w-6 text-[#f96706]" aria-hidden="true" />
          <h1 className="text-xl font-extrabold">{required ? "Choose your password" : "Change your password"}</h1>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Employee ID <span className="font-semibold text-[#101a3a]">{hr.login.login_id}</span>.{" "}
          {required && reason === "expired" && "Your password has expired. Choose a new one to continue."}
          {required && reason !== "expired" && "You signed in with a temporary password from HR. Choose your own password to continue; it will be known only to you."}
          {!required && "All your signed-in devices will be signed out."}
        </p>
        <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-3">
          <Field label={required && reason !== "expired" ? "Temporary password" : "Current password"} required>
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" required hint="At least 12 characters, with upper- and lower-case letters and a number. Do not include your Employee ID.">
            <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          <InlineError message={error} />
          <Button type="submit" loading={busy}><KeyRound className="h-4 w-4" aria-hidden="true" />Save password and continue</Button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          {!required ? <a className="font-semibold text-[#1f4693] underline" href="/employee">Back to the portal</a> : <span />}
          <button type="button" className="inline-flex items-center gap-1 font-semibold text-slate-600 underline"
            onClick={async () => { await signOut(); navigate("/hr/login", { replace: true }); }}>
            <LogOut className="h-4 w-4" aria-hidden="true" />Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

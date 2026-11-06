// HRMS sign-in (HR Operations + Employee Portal). Supabase Auth only; after
// sign-in the user goes to ?next (same-origin HRMS paths only) or to the
// portal their server-side roles allow.
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, LogIn } from "lucide-react";
import Seo from "@/hr/platform/Seo";
import Link from "@/hr/platform/link";
import { useAuth, usableNext } from "@/hr/platform/auth";

const SAFE_NEXT = /^\/(hr|employee|account-pending)(\/|$|\?)/;

export default function HrLoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");
  const safeNext = next && SAFE_NEXT.test(next) && !next.startsWith("//") ? next : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setError(""); }, [email, password]);

  if (!auth.loading && auth.user) return <Navigate to={usableNext(safeNext, auth.hr) ?? auth.destination} replace />;

  async function submit(e) {
    e.preventDefault();
    if (!email || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    const res = await auth.signIn(email, password);
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    navigate(usableNext(safeNext, res.hr) ?? res.destination, { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f7fb] px-4 py-10">
      <Seo title="HRMS sign in" />
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm" noValidate>
        <h1 className="text-xl font-extrabold text-[#101a3a]">Zyllo Tech HRMS</h1>
        <p className="mt-1 text-sm text-slate-600">Sign in to HR Operations or the Employee Portal.</p>
        <label className="mt-6 block text-sm font-semibold text-[#173a52]" htmlFor="hr-email">Work email</label>
        <input id="hr-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#f96706] focus:outline-none focus:ring-2 focus:ring-[#f96706]/30" />
        <label className="mt-4 block text-sm font-semibold text-[#173a52]" htmlFor="hr-password">Password</label>
        <input id="hr-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#f96706] focus:outline-none focus:ring-2 focus:ring-[#f96706]/30" />
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy || auth.loading}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f7941e] to-[#f96706] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
          Sign in
        </button>
        <p className="mt-5 text-center text-xs text-slate-500">
          New employee? Use the invitation link from HR to <Link href="/employee/activate" className="font-semibold text-[#173a52] underline">activate your account</Link>.
        </p>
        <p className="mt-2 text-center text-xs text-slate-500"><Link href="/" className="underline">Back to the website</Link></p>
      </form>
    </div>
  );
}

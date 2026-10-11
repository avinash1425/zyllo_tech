import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, User, UserPlus, ArrowRight } from "lucide-react";
import Link from "@/lib/nx/link";
import Seo from "@/components/Seo";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

function validate({ name, email, password, confirm, accept }) {
  if (name.trim().length < 2) return "Please enter your full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password))
    return "Password must include upper, lower, and numeric characters.";
  if (password !== confirm) return "Passwords do not match.";
  if (!accept) return "Please accept the Terms of Service and Privacy Policy.";
  return "";
}

const field =
  "w-full rounded-lg border border-[#e7e9ee] bg-white py-3 pl-10 pr-3 text-sm text-[#2b303b] outline-none focus:border-[#f7941e] focus:ring-2 focus:ring-[#f7941e]/20";

export default function Signup() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", accept: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/dashboard", { replace: true });
  }, [user, loading, navigate]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    const msg = validate(form);
    if (msg) return setError(msg);
    setError("");
    setBusy(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: { data: { full_name: form.name.trim() }, emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setBusy(false);
    if (err) return setError(err.message || "Unable to create account.");
    if (data.session) navigate("/dashboard", { replace: true });
    else setPending(true);
  }

  return (
    <>
      <Seo title="Create an account" path="/signup" noindex />
      <section className="flex min-h-[70vh] items-center justify-center bg-[#f6f7fb] px-4 pb-16 pt-32">
        <div className="w-full max-w-md rounded-2xl border border-[#e7e9ee] bg-white p-8 shadow-xl">
          {pending ? (
            <div className="text-center">
              <Mail className="mx-auto h-10 w-10 text-[#f7941e]" aria-hidden="true" />
              <h1 className="mt-4 text-2xl font-bold text-[#2b303b]">Check your email</h1>
              <p className="mt-2 text-sm text-[#676b7a]">
                We sent a confirmation link to {form.email}. Confirm it, then sign in.
              </p>
              <Link href="/login?next=/dashboard" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#f7941e] px-6 py-3 text-sm font-semibold text-white">
                Go to Sign In <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <UserPlus className="h-6 w-6 text-[#f7941e]" aria-hidden="true" />
                <h1 className="text-2xl font-bold text-[#2b303b]">Create your account</h1>
              </div>
              <p className="mt-1 text-sm text-[#676b7a]">Join Zyllo Tech to track your enquiries and applications.</p>
              <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3.5" noValidate>
                {[
                  { k: "name", label: "Full name", type: "text", icon: User, ac: "name" },
                  { k: "email", label: "Email", type: "email", icon: Mail, ac: "email" },
                  { k: "password", label: "Password", type: "password", icon: Lock, ac: "new-password" },
                  { k: "confirm", label: "Confirm password", type: "password", icon: Lock, ac: "new-password" },
                ].map(({ k, label, type, icon: Icon, ac }) => (
                  <div key={k}>
                    <label htmlFor={`su-${k}`} className="mb-1 block text-sm font-medium text-[#2b303b]">{label}</label>
                    <div className="relative">
                      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#676b7a]" aria-hidden="true" />
                      <input id={`su-${k}`} type={type} autoComplete={ac} value={form[k]} onChange={set(k)} className={field} />
                    </div>
                  </div>
                ))}
                <label className="flex items-start gap-2 text-sm text-[#676b7a]">
                  <input type="checkbox" checked={form.accept} onChange={set("accept")} className="mt-1" />
                  <span>
                    I agree to the <Link href="/terms" className="underline">Terms of Service</Link> and{" "}
                    <Link href="/privacy" className="underline">Privacy Policy</Link>.
                  </span>
                </label>
                {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                <button type="submit" disabled={busy} className="mt-1 rounded-lg bg-[#f7941e] py-3 text-sm font-semibold text-white transition hover:bg-[#db7d17] disabled:opacity-60">
                  {busy ? "Creating account…" : "Create account"}
                </button>
              </form>
              <p className="mt-5 text-center text-sm text-[#676b7a]">
                Already have an account?{" "}
                <Link href="/login?next=/dashboard" className="font-medium text-[#f7941e] hover:underline">Sign In</Link>
              </p>
            </>
          )}
        </div>
      </section>
    </>
  );
}

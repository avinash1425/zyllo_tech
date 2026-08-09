"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Gauge,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { signIn } from "./actions";

const initialState = { status: "idle", message: "" };

const HIGHLIGHTS = [
  { icon: Gauge, label: "Real-time visibility" },
  { icon: Users, label: "Unified team workspace" },
  { icon: ShieldCheck, label: "Permissioned access" },
];

function NextRedirectField() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/admin";
  return <input type="hidden" name="next" value={next} />;
}

export default function LoginPage() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, isPending] = useActionState(signIn, initialState);

  return (
    <section className="relative isolate flex min-h-dvh items-center justify-center overflow-y-auto bg-[#0b0e17] px-4 py-8 sm:px-6 sm:py-10">
      {/* Plain dark stage, no background photo — `isolate` above still
          pins this section as its own stacking context so the glow blobs
          inside the card stay correctly layered. */}
      <div aria-hidden="true" className="fixed inset-0 z-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 40%, rgba(48,137,166,0.1) 0%, transparent 60%), radial-gradient(ellipse 60% 60% at 20% 90%, rgba(249,103,6,0.08) 0%, transparent 60%)",
          }}
        />
      </div>

      <Link
        href="/"
        className="group absolute left-6 top-6 z-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md transition-all duration-300 hover:border-transparent hover:bg-gradient-to-r hover:from-[#f96706] hover:to-[#3089a6] hover:text-white"
      >
        <ArrowLeft
          className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5"
          aria-hidden="true"
        />
        Back to Home
      </Link>

      <div className="login-fade-in relative z-[1] w-full max-w-md" style={{ animationDelay: "0.05s" }}>
        <div className="flex flex-col items-center text-center">
          <Image
            src="/zyllo-logo-dark.png"
            alt="Zyllo Tech Software Solutions Private Limited"
            width={1846}
            height={333}
            priority
            className="h-12 w-auto drop-shadow-[0_2px_14px_rgba(0,0,0,0.6)] sm:h-14"
          />
          <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-[#f96706] backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            AI-Driven Software Delivery
          </span>
        </div>

        {/* Gradient border frame — orange-to-blue, matching the logo's own color combination */}
        <div className="mt-7 rounded-[1.75rem] bg-gradient-to-br from-[#f96706] via-[#ffb15c]/70 to-[#3089a6] p-[2px] shadow-2xl shadow-black/70">
          <div className="relative overflow-hidden rounded-[1.65rem] bg-[#0d1220] p-7 backdrop-blur-2xl sm:p-9">
            <div
              aria-hidden="true"
              className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-[#f96706]/20 blur-[80px]"
            />
            <div
              aria-hidden="true"
              className="absolute -bottom-20 -left-20 h-48 w-48 rounded-full bg-[#3089a6]/20 blur-[80px]"
            />

            <div className="relative">
              {/* Sign In / Sign Up segmented toggle */}
              <div className="mx-auto flex w-full max-w-[15rem] rounded-full border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className={`flex-1 rounded-full py-1.5 text-xs font-semibold transition-all duration-200 ${
                    mode === "signin"
                      ? "bg-gradient-to-r from-[#f96706] to-[#3089a6] text-white shadow-sm"
                      : "text-white/50 hover:text-white/80"
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className={`flex-1 rounded-full py-1.5 text-xs font-semibold transition-all duration-200 ${
                    mode === "signup"
                      ? "bg-gradient-to-r from-[#f96706] to-[#3089a6] text-white shadow-sm"
                      : "text-white/50 hover:text-white/80"
                  }`}
                >
                  Sign Up
                </button>
              </div>

              {mode === "signin" ? (
                <>
                  <h1 className="mt-6 text-center text-2xl font-bold text-white">Welcome back</h1>
                  <p className="mt-1.5 text-center text-sm text-white/60">
                    Sign in to your Zyllo Tech account
                  </p>

                  <form action={formAction} className="mt-6 flex flex-col gap-3.5">
                    <Suspense fallback={<input type="hidden" name="next" value="/admin" />}>
                      <NextRedirectField />
                    </Suspense>

                    <div>
                      <label htmlFor="email" className="mb-1 block text-sm font-medium text-white/80">
                        Email
                      </label>
                      <div className="relative">
                        <Mail
                          className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-white/40"
                          aria-hidden="true"
                        />
                        <input
                          id="email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          required
                          placeholder="you@company.com"
                          className="w-full rounded-lg border border-white/20 bg-white/[0.08] py-2.5 pl-10 pr-3.5 text-sm text-white placeholder:text-white/30 outline-none transition-all duration-200 focus:border-[#f96706]/60 focus:shadow-[0_0_0_3px_rgba(249,103,6,0.12),0_0_20px_-6px_rgba(48,137,166,0.5)]"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="password" className="mb-1 block text-sm font-medium text-white/80">
                        Password
                      </label>
                      <div className="relative">
                        <Lock
                          className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-white/40"
                          aria-hidden="true"
                        />
                        <input
                          id="password"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          required
                          placeholder="Enter your password"
                          className="w-full rounded-lg border border-white/20 bg-white/[0.08] py-2.5 pl-10 pr-11 text-sm text-white placeholder:text-white/30 outline-none transition-all duration-200 focus:border-[#3089a6]/60 focus:shadow-[0_0_0_3px_rgba(48,137,166,0.12),0_0_20px_-6px_rgba(249,103,6,0.5)]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((show) => !show)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4.5 w-4.5" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4.5 w-4.5" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>

                    {state.status === "error" && (
                      <p className="text-sm font-medium text-red-400">{state.message}</p>
                    )}

                    <button
                      type="submit"
                      disabled={isPending}
                      className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#f96706] to-[#f96706] bg-[length:200%_100%] bg-left px-6 py-3 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(249,103,6,0.35)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-right hover:from-[#f96706] hover:to-[#3089a6] hover:shadow-[0_20px_25px_-5px_rgba(48,137,166,0.45)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isPending ? "Signing in..." : "Sign In"}
                    </button>
                  </form>
                </>
              ) : (
                <div className="mt-6 flex flex-col items-center text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#f96706] to-[#3089a6]">
                    <Users className="h-5.5 w-5.5 text-white" aria-hidden="true" />
                  </span>
                  <h1 className="mt-4 text-2xl font-bold text-white">Request access</h1>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/60">
                    Zyllo Tech accounts are provisioned by our team — there&apos;s no
                    public self sign-up. Reach out and we&apos;ll set one up for you.
                  </p>
                  <Link
                    href="/contact"
                    className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#f96706] to-[#3089a6] px-6 py-3 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(249,103,6,0.35)] transition-all duration-300 hover:-translate-y-0.5"
                  >
                    Contact Us
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              )}

              <div className="mt-6 grid grid-cols-3 gap-2 border-t border-white/10 pt-5">
                {HIGHLIGHTS.map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-1 text-center">
                    <item.icon className="h-4 w-4 text-[#f96706]" aria-hidden="true" />
                    <span className="text-[10.5px] font-medium leading-tight text-white/50">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-white/35">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Access is restricted to authorized Zyllo Tech accounts
        </p>
      </div>

      <style jsx>{`
        .login-fade-in {
          opacity: 0;
          animation: loginFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes loginFadeIn {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </section>
  );
}

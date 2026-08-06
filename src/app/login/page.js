"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { signIn } from "./actions";

const initialState = { status: "idle", message: "" };

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/admin";
  const [state, formAction, isPending] = useActionState(signIn, initialState);

  return (
    <section className="relative min-h-[calc(100vh-64px)] overflow-hidden bg-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-[#f7941e]/10 blur-[110px]" />
        <div className="absolute -bottom-40 left-1/4 h-[24rem] w-[24rem] rounded-full bg-[#1f4693]/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl grid-cols-1 lg:grid-cols-2">
        {/* Left: illustration / branding panel */}
        <div className="relative hidden flex-col items-center justify-center overflow-hidden border-r border-[#e7e9ee] px-12 py-16 lg:flex">
          <div className="relative flex h-72 w-72 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15 blur-2xl" />
            <div className="relative flex h-56 w-56 items-center justify-center rounded-[2rem] border border-white/60 bg-white/70 shadow-xl backdrop-blur-xl">
              <ShieldCheck className="h-24 w-24 text-[#f7941e]" strokeWidth={1.25} aria-hidden="true" />
            </div>
          </div>

          <h2 className="mt-10 text-center text-3xl font-bold text-[#2b303b]">Welcome Back</h2>
          <p className="mt-3 max-w-sm text-center text-base leading-relaxed text-[#676b7a]">
            Secure Admin Portal — sign in to manage your Zyllo Tech workspace.
          </p>
        </div>

        {/* Right: login card */}
        <div className="flex flex-col items-center justify-center px-6 py-16 lg:px-12">
          <div className="w-full max-w-md">
            <div className="mb-8 flex justify-center lg:hidden">
              <Link href="/" className="inline-flex items-center rounded-lg bg-white px-4 py-2.5 shadow-sm">
                <Image
                  src="/zyllo-logo.png"
                  alt="Zyllo Tech"
                  width={200}
                  height={40}
                  priority
                  className="h-10 w-auto"
                />
              </Link>
            </div>

            <div className="rounded-2xl border border-[#e7e9ee] bg-white/70 p-8 shadow-xl backdrop-blur-xl">
              <h1 className="text-center text-2xl font-bold text-[#2b303b]">Welcome back</h1>
              <p className="mt-2 text-center text-sm text-[#676b7a]">
                Sign in to your Zyllo Tech account
              </p>

              <form action={formAction} className="mt-8 flex flex-col gap-5">
                <input type="hidden" name="next" value={next} />

                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-sm font-medium text-[#2b303b]"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-[#676b7a]/60"
                      aria-hidden="true"
                    />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="you@company.com"
                      className="w-full rounded-lg border border-[#e7e9ee] bg-white py-2.5 pl-10 pr-3.5 text-sm text-[#2b303b] placeholder:text-[#676b7a]/50 outline-none transition-colors focus:border-[#f7941e]/60"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-[#676b7a]/60"
                      aria-hidden="true"
                    />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      placeholder="Enter your password"
                      className="w-full rounded-lg border border-[#e7e9ee] bg-white py-2.5 pl-10 pr-11 text-sm text-[#2b303b] placeholder:text-[#676b7a]/50 outline-none transition-colors focus:border-[#f7941e]/60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((show) => !show)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#676b7a]/60 transition-colors hover:text-[#2b303b]"
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
                  <p className="text-sm font-medium text-red-600">{state.message}</p>
                )}

                <button
                  type="submit"
                  disabled={isPending}
                  className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#f7941e] px-6 py-3 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(247,148,30,0.35)] transition-transform duration-150 hover:-translate-y-0.5 hover:bg-[#db7d17] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? "Signing in..." : "Login"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

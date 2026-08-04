"use client";

import { Mail } from "lucide-react";

export default function Newsletter() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-6 text-center lg:px-8">
        <div className="rounded-[28px] border border-white/60 bg-white/60 p-10 shadow-xl backdrop-blur-xl sm:p-12">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15">
            <Mail className="h-6 w-6 text-[#f7941e]" aria-hidden="true" />
          </div>

          <h2 className="mt-5 text-2xl font-bold tracking-tight text-[#2b303b] sm:text-3xl">
            Get new articles in your inbox
          </h2>
          <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-[#676b7a]">
            No spam, just practical notes on engineering and product — sent
            when we actually have something worth sharing.
          </p>

          <form className="mx-auto mt-6 flex max-w-md flex-col gap-3 sm:flex-row">
            <input
              type="email"
              required
              placeholder="you@company.com"
              aria-label="Email address"
              className="w-full flex-1 rounded-lg border border-[#e7e9ee] bg-white px-4 py-3 text-sm text-[#2b303b] placeholder:text-[#676b7a]/60 outline-none transition-colors focus:border-[#f7941e]/60"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-[#f7941e] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#db7d17]"
            >
              Subscribe
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

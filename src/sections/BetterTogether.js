"use client";

import { Cloud, Code2, Lightbulb, Palette, Plus, ShieldCheck, Smartphone, Sparkles, TestTube2 } from "lucide-react";

// Each pairing shows the two actual services being combined, joined by a
// connector — makes "stronger combined" a literal visual instead of a
// repeated generic icon. Icon badges are flat orange/blue (not a gradient
// blend) — at this size a diagonal gradient's blue end barely shows, so
// every card read as solid orange. Flat two-tone matches the logo's own
// split orange/blue ring and keeps both brand colors clearly visible.
const PAIRINGS = [
  {
    iconA: Lightbulb,
    iconB: Code2,
    combo: "Strategy + Engineering",
    description:
      "Product consulting feeds directly into the build — so what gets designed is what actually ships.",
  },
  {
    iconA: Palette,
    iconB: Smartphone,
    combo: "Design + Development",
    description:
      "Designers and engineers work side by side, so interfaces don't lose fidelity between prototype and production.",
  },
  {
    iconA: Cloud,
    iconB: ShieldCheck,
    combo: "Cloud + Security",
    description:
      "Infrastructure and security engineering are planned together from day one, not bolted on after launch.",
  },
  {
    iconA: Sparkles,
    iconB: TestTube2,
    combo: "AI + Quality Engineering",
    description:
      "New AI features ship with the same automated test coverage as the rest of your product — not as an afterthought.",
  },
];

export default function BetterTogether() {
  return (
    <section className="relative overflow-hidden border-t border-[#e2e5ea] bg-gradient-to-b from-[#fff8f0] via-white to-[#f3f8fa] py-12 lg:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 -left-16 h-64 w-64 rounded-full bg-[#f96706] opacity-[0.05] blur-[100px]" />
        <div className="absolute -bottom-20 right-0 h-64 w-64 rounded-full bg-[#3089a6] opacity-[0.06] blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f96706]">
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
            Stronger As One
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[#0f172a] sm:text-4xl">
            Our services are stronger combined
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#54607a] sm:text-lg">
            We rarely deliver one service in isolation. Here&apos;s how they
            work together on a real project.
          </p>
        </div>

        {/* Deliberately not a card grid — every other light section on the
            page is bordered-card-with-icon-badge, so this one is a single
            connected matrix instead: divided cells, icon+text sit side by
            side (not stacked), no individual shadows or floating cards. */}
        <div className="mt-10 grid grid-cols-1 divide-y divide-[#e2e5ea] overflow-hidden rounded-2xl border border-[#e2e5ea] bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          {PAIRINGS.map(({ iconA: IconA, iconB: IconB, combo, description }, index) => (
            <div
              key={combo}
              style={{ animationDelay: `${index * 0.1}s` }}
              className="pairing-in group relative flex flex-col gap-3 p-6 transition-colors duration-300 hover:bg-[#fafbfc] sm:border-t sm:border-[#e2e5ea] lg:border-t-0"
            >
              <span className="text-[11px] font-bold tracking-widest text-[#c7cdd6]">
                0{index + 1}
              </span>

              <div className="flex items-center gap-1.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f96706] text-white transition-transform duration-300 group-hover:-translate-y-0.5">
                  <IconA className="h-4 w-4" aria-hidden="true" />
                </span>
                <Plus className="h-3.5 w-3.5 shrink-0 text-[#c7cdd6]" aria-hidden="true" />
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3089a6] text-white transition-transform duration-300 group-hover:-translate-y-0.5">
                  <IconB className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>

              <h3 className="text-base font-bold leading-snug text-[#0f172a]">{combo}</h3>
              <p className="text-sm leading-relaxed text-[#54607a]">{description}</p>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .pairing-in {
          animation: pairingFadeUp 0.6s ease-out both;
        }
        @keyframes pairingFadeUp {
          from {
            opacity: 0;
            transform: translateY(16px);
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

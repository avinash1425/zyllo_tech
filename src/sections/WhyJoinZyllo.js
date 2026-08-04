"use client";

import { Compass, Heart, Rocket, ShieldCheck, Sparkles, Users } from "lucide-react";

const REASONS = [
  {
    icon: Compass,
    title: "Real Ownership",
    description:
      "You'll own features end to end, not just tickets. Your decisions shape the product.",
  },
  {
    icon: Rocket,
    title: "Fast-Moving Teams",
    description:
      "Small, focused teams that ship often — no layers of approval slowing you down.",
  },
  {
    icon: Sparkles,
    title: "Modern Tech Stack",
    description:
      "Work with the tools and technologies actively used by the industry today, not legacy systems.",
  },
  {
    icon: Users,
    title: "Direct Mentorship",
    description:
      "Learn from senior engineers and designers who are genuinely invested in your growth.",
  },
  {
    icon: ShieldCheck,
    title: "Stability & Trust",
    description:
      "A growing company with steady client relationships, not chasing short-term contracts.",
  },
  {
    icon: Heart,
    title: "People-First Culture",
    description:
      "Flexible schedules and a team that respects work-life balance, not just says it does.",
  },
];

export default function WhyJoinZyllo() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Why Join Zyllo Tech
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Build your career somewhere that means it
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            We're small enough that your work matters, and serious enough
            that you'll grow doing it.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#f7941e]/[0.03] p-7 shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-xl hover:shadow-[#f7941e]/10"
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-50 bg-gradient-to-r from-[#f7941e] to-[#1f4693] opacity-40 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
              />
              <div
                aria-hidden="true"
                className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-gradient-to-br from-[#f7941e]/10 to-[#1f4693]/10 opacity-40 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
              />

              <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-white/70 bg-gradient-to-br from-[#f7941e]/20 to-[#1f4693]/20 shadow-md shadow-[#f7941e]/10 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                <Icon className="h-6 w-6 text-[#f7941e]" aria-hidden="true" />
              </div>

              <h3 className="relative mt-5 text-lg font-semibold text-[#2b303b]">{title}</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-[#676b7a]">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

"use client";

import { Users, Rocket, ShieldCheck, Target } from "lucide-react";

const REASONS = [
  {
    number: "01",
    icon: Users,
    title: "Experienced Team",
    description:
      "Senior engineers, designers, and architects who've shipped products at scale.",
  },
  {
    number: "02",
    icon: Rocket,
    title: "Fast Delivery",
    description:
      "Agile sprints and clear milestones keep your project moving without sacrificing quality.",
  },
  {
    number: "03",
    icon: ShieldCheck,
    title: "Secure Solutions",
    description:
      "Security-first delivery with rigorous testing and code review before every release.",
  },
  {
    number: "04",
    icon: Target,
    title: "Client Focused",
    description:
      "Every technical decision is tied back to measurable outcomes for your business.",
  },
];

export default function WhyChooseUs() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Our Advantages
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Why Industry Leaders Choose Zyllo Tech
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Experience the difference that comes from partnering with a
            trusted, results-driven technology team.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {REASONS.map(({ icon: Icon, title, description }, index) => {
            const accent = index % 2 === 0 ? "#f7941e" : "#1f4693";
            return (
              <div
                key={title}
                className="advantage-card group relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#1f4693]/[0.03] p-7 shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-xl hover:shadow-[#1f4693]/10"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-50 bg-gradient-to-r from-[#f7941e] to-[#1f4693] opacity-40 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
                />
                <div
                  aria-hidden="true"
                  className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-gradient-to-br from-[#f7941e]/10 to-[#1f4693]/10 opacity-40 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                />

                <Icon
                  className="pointer-events-none absolute -bottom-4 -right-4 h-28 w-28 text-[#1f4693]/[0.04] transition-all duration-300 group-hover:scale-110 group-hover:text-[#f7941e]/[0.08]"
                  aria-hidden="true"
                />

                <div
                  className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-white/70 shadow-md transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
                  style={{ backgroundColor: `${accent}20` }}
                >
                  <Icon className="h-6 w-6" style={{ color: accent }} aria-hidden="true" />
                </div>

                <h3 className="relative mt-5 text-lg font-semibold text-[#2b303b]">{title}</h3>
                <p className="relative mt-2 text-sm leading-relaxed text-[#676b7a]">
                  {description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

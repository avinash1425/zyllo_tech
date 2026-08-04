"use client";

import { Headset, Rocket, ShieldCheck, Sparkles, Target, Users } from "lucide-react";

const REASONS = [
  {
    number: "01",
    icon: ShieldCheck,
    title: "Quality Assurance",
    description:
      "Every release goes through rigorous testing and code review before it reaches production.",
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
    icon: Users,
    title: "Expert Team",
    description:
      "Experienced engineers, designers, and architects who've shipped products at scale.",
  },
  {
    number: "04",
    icon: Headset,
    title: "Dedicated Support",
    description:
      "Ongoing monitoring and responsive support long after your product goes live.",
  },
  {
    number: "05",
    icon: Sparkles,
    title: "Innovation Driven",
    description:
      "We stay ahead of the curve with AI, cloud-native architecture, and modern tooling.",
  },
  {
    number: "06",
    icon: Target,
    title: "Business Aligned",
    description:
      "Every technical decision is tied back to measurable outcomes for your business.",
  },
];

export default function WhyChooseUs() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-10 lg:py-14">
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

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map(({ number, icon: Icon, title, description }) => (
            <div
              key={title}
              className="advantage-card group relative overflow-hidden rounded-2xl border border-white/60 bg-white/60 p-7 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#f7941e]/30 hover:shadow-lg"
            >
              <Icon
                className="pointer-events-none absolute -bottom-4 -right-4 h-28 w-28 text-[#1f4693]/[0.04] transition-colors duration-300 group-hover:text-[#f7941e]/[0.08]"
                aria-hidden="true"
              />

              <span className="text-xs font-bold tracking-widest text-[#2b303b]/25">
                {number}
              </span>

              <div className="relative mt-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15 transition-transform duration-300 group-hover:scale-110">
                <Icon className="h-6 w-6 text-[#f7941e]" aria-hidden="true" />
              </div>

              <h3 className="relative mt-5 text-lg font-semibold text-[#2b303b]">{title}</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-[#676b7a]">
                {description}
              </p>

              <span className="absolute bottom-0 left-0 h-0.5 w-0 bg-gradient-to-r from-[#f7941e] to-[#1f4693] transition-all duration-300 group-hover:w-full" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

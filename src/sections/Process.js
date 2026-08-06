"use client";

import { Compass, Hammer, PenTool, Rocket, Wrench } from "lucide-react";

const STEPS = [
  {
    number: "01",
    icon: Compass,
    title: "Discover",
    description:
      "We dig into your goals, users, and constraints to define what actually needs to be built.",
  },
  {
    number: "02",
    icon: PenTool,
    title: "Design",
    description:
      "Wireframes and prototypes turn requirements into a clear, testable product plan.",
  },
  {
    number: "03",
    icon: Hammer,
    title: "Build",
    description:
      "Agile sprints with regular check-ins so you always know what's shipping next.",
  },
  {
    number: "04",
    icon: Rocket,
    title: "Launch",
    description:
      "A tested, production-ready release with a clear rollout and monitoring plan.",
  },
  {
    number: "05",
    icon: Wrench,
    title: "Support",
    description:
      "Ongoing maintenance, monitoring, and improvements after your product goes live.",
  },
];

export default function Process() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#f7941e]/5 to-[#1f4693]/5 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            How We Work
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            A clear process from idea to launch
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            No black boxes. Every engagement follows the same transparent
            process, so you always know what&apos;s happening and why.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map(({ number, icon: Icon, title, description }, index) => {
            const accent = index % 2 === 0 ? "#f7941e" : "#1f4693";
            return (
              <div
                key={number}
                className="process-step group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0e17] p-6 shadow-lg shadow-black/10 transition-all duration-300 hover:-translate-y-1.5"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div
                  aria-hidden="true"
                  className="absolute -bottom-6 -right-4 text-7xl font-bold opacity-[0.06]"
                  style={{ color: accent }}
                >
                  {number}
                </div>

                <div
                  className="relative flex h-12 w-12 items-center justify-center rounded-xl shadow-md transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
                  style={{ backgroundColor: `${accent}25` }}
                >
                  <Icon className="h-5.5 w-5.5" style={{ color: accent }} aria-hidden="true" />
                </div>

                <span className="relative mt-5 block text-xs font-bold tracking-widest text-white/30">
                  STEP {number}
                </span>
                <h3 className="relative mt-1.5 text-lg font-semibold text-white">{title}</h3>
                <p className="relative mt-2 text-sm leading-relaxed text-white/60">
                  {description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        @keyframes stepFadeUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .process-step {
          animation: stepFadeUp 0.6s ease-out both;
        }
      `}</style>
    </section>
  );
}

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
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
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

        <div className="relative mt-8">
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-[#e7e9ee] to-transparent lg:block"
          />
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
            {STEPS.map(({ number, icon: Icon, title, description }, index) => (
              <div
                key={number}
                className="process-step relative flex flex-col items-center text-center"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-[#f7941e]/30 bg-white shadow-sm transition-transform duration-300 hover:scale-110">
                  <Icon className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
                </div>
                <span className="mt-4 text-xs font-bold tracking-widest text-[#2b303b]/30">
                  STEP {number}
                </span>
                <h3 className="mt-1.5 text-lg font-semibold text-[#2b303b]">{title}</h3>
                <p className="mt-2 max-w-[220px] text-sm leading-relaxed text-[#676b7a]">
                  {description}
                </p>
              </div>
            ))}
          </div>
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

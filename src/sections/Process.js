"use client";

import Image from "next/image";
import { Compass, Hammer, PenTool, Rocket, Wrench } from "lucide-react";

// Light version of the "equal-height cards" concept — every card stretches
// to match the tallest one in its row (a CSS grid property, not manual
// sizing), so different description lengths no longer leave ragged bottom
// edges the way the original horizontal layout did. Background photo (the
// network-mesh image) sits very faintly behind everything, on white.
const STEPS = [
  {
    number: "01",
    icon: Compass,
    title: "Discover",
    description: "Understanding your business, goals, and project requirements.",
    accent: "#f96706",
    accentSoft: "#fbbf62",
  },
  {
    number: "02",
    icon: PenTool,
    title: "Design",
    description: "Creating user focused designs and scalable solution architecture.",
    accent: "#3089a6",
    accentSoft: "#6d94d6",
  },
  {
    number: "03",
    icon: Hammer,
    title: "Develop",
    description: "Building robust, secure, and high quality software.",
    accent: "#f0650f",
    accentSoft: "#fb923c",
  },
  {
    number: "04",
    icon: Rocket,
    title: "Deploy",
    description: "Launching reliable solutions with seamless deployment.",
    accent: "#3089a6",
    accentSoft: "#4d6fb8",
  },
  {
    number: "05",
    icon: Wrench,
    title: "Support",
    description: "Continuous maintenance, enhancements, and technical support.",
    accent: "#f96706",
    accentSoft: "#fbbf62",
  },
];

export default function Process() {
  return (
    <section className="relative isolate overflow-hidden bg-white py-12 lg:py-16">
      <Image
        src="/hero-home1.png"
        alt=""
        fill
        sizes="100vw"
        className="-z-20 object-cover object-[30%_45%] opacity-[0.05]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-b from-white via-white/95 to-white"
      />

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f96706]">
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
            Process
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[#0f172a] sm:text-4xl">
            Our Development{" "}
            <span className="bg-gradient-to-r from-[#f96706] to-[#3089a6] bg-clip-text text-transparent">
              Process
            </span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#54607a] sm:text-lg">
            A structured approach that ensures transparency and successful
            project delivery.
          </p>
        </div>

        {/* Distinct from every other card section on the page: circular
            markers (not rounded-xl badges) sit pinned half-outside each
            card, strung together by a connecting line — reads as a
            sequence/timeline rather than a plain feature grid. */}
        <div className="relative mt-16">
          <div
            aria-hidden="true"
            className="absolute left-[8%] right-[8%] top-8 hidden h-px bg-gradient-to-r from-[#f96706] to-[#3089a6] opacity-30 lg:block"
          />
          <div className="grid grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map(({ number, icon: Icon, title, description, accent, accentSoft }, index) => (
              <div
                key={number}
                style={{ animationDelay: `${index * 0.08}s` }}
                className="process-step group relative flex h-full flex-col items-center"
              >
                <div
                  className="relative z-[1] -mb-8 flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-white transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105"
                  style={{
                    background: `linear-gradient(135deg, ${accent}, ${accentSoft})`,
                    boxShadow: `0 10px 22px -6px ${accent}70`,
                  }}
                >
                  <Icon className="h-6 w-6" aria-hidden="true" />
                  <span
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[9px] font-extrabold shadow-sm"
                    style={{ color: accent }}
                  >
                    {number}
                  </span>
                </div>
                <div className="flex h-full w-full flex-col items-center rounded-2xl border border-[#e2e5ea] bg-white px-5 pb-5 pt-11 text-center shadow-sm transition-all duration-300 group-hover:border-[#f96706]/30 group-hover:shadow-lg group-hover:shadow-[#1c2f4a]/5">
                  <h3 className="text-base font-bold text-[#0f172a]">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#54607a]">
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes stepFadeUp {
          from {
            opacity: 0;
            transform: translateY(14px);
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

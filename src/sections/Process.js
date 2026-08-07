"use client";

import { Compass, Hammer, PenTool, Rocket, Wrench } from "lucide-react";

// Light section. Warm orange-to-blue 5-stop gradient sequence connects all
// 5 steps, matching the logo's palette.
const STEPS = [
  {
    number: "01",
    icon: Compass,
    title: "Discover",
    description:
      "Understanding your business, goals, and project requirements.",
    accent: "#f7941e",
  },
  {
    number: "02",
    icon: PenTool,
    title: "Design",
    description:
      "Creating user focused designs and scalable solution architecture.",
    accent: "#f0650f",
  },
  {
    number: "03",
    icon: Hammer,
    title: "Develop",
    description:
      "Building robust, secure, and high quality software.",
    accent: "#8a5a7a",
  },
  {
    number: "04",
    icon: Rocket,
    title: "Deploy",
    description:
      "Launching reliable solutions with seamless deployment.",
    accent: "#2f5fb3",
  },
  {
    number: "05",
    icon: Wrench,
    title: "Support",
    description:
      "Continuous maintenance, enhancements, and technical support.",
    accent: "#1f4693",
  },
];

export default function Process() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-[#eff4fc]/50 to-white py-8 lg:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#f7941e]/8 to-[#1f4693]/8 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#1f4693] uppercase">
            Process
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#0f172a] sm:text-4xl">
            Our Development Process
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#475569]">
            A structured approach that ensures transparency and successful
            project delivery.
          </p>
        </div>

        <div className="relative mt-16">
          {/* Connector line threading through all 5 steps */}
          <div
            aria-hidden="true"
            className="absolute left-[10%] right-[10%] top-8 hidden h-0.5 rounded-full bg-gradient-to-r from-[#f7941e] via-[#8a5a7a] to-[#1f4693] opacity-30 lg:block"
          />

          <div className="grid grid-cols-1 gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map(({ number, icon: Icon, title, description, accent }, index) => (
              <div
                key={number}
                className="process-step group relative flex flex-col items-center text-center"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                {/* Numbered node sitting on the connector line */}
                <div className="relative flex flex-col items-center">
                  <div
                    className="relative flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg transition-all duration-300 group-hover:-translate-y-1 group-hover:scale-105"
                    style={{
                      background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                      boxShadow: `0 10px 24px -6px ${accent}55`,
                    }}
                  >
                    <Icon className="h-7 w-7 text-white" aria-hidden="true" />
                  </div>
                  <span className="mt-3 text-xs font-bold tracking-widest" style={{ color: accent }}>
                    STEP {number}
                  </span>
                </div>

                {/* Card panel */}
                <div className="relative mt-4 w-full max-w-[13rem] overflow-hidden rounded-xl border border-[#fde8cc] bg-white/70 p-4 shadow-sm backdrop-blur-md transition-all duration-300 group-hover:-translate-y-0.5 group-hover:bg-white/90 group-hover:shadow-md">
                  <h3 className="text-base font-semibold text-[#0f172a]">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#475569]">
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

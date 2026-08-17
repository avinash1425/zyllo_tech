"use client";

import { Check, Clock, Target, Users } from "lucide-react";

// Padding was py-6/py-8 — far tighter than every other section on the page
// (which run py-12 to py-20), so this read as visually cramped next to
// everything else. Brought in line, added icons per model and entrance
// animation to match the polish level of the rest of the site.
const MODELS = [
  {
    icon: Target,
    name: "Fixed Scope",
    tagline: "For clearly defined projects",
    features: [
      "Agreed scope, timeline, and price upfront",
      "Milestone-based delivery and check-ins",
      "Best for MVPs and well-scoped builds",
    ],
    highlighted: false,
  },
  {
    icon: Users,
    name: "Dedicated Team",
    tagline: "For ongoing product development",
    features: [
      "A consistent team embedded in your roadmap",
      "Flexible scope as priorities shift",
      "Best for long-term product partnerships",
    ],
    highlighted: true,
  },
  {
    icon: Clock,
    name: "Time & Materials",
    tagline: "For evolving or exploratory work",
    features: [
      "Pay for actual hours worked",
      "Adjust direction as you learn",
      "Best for R&D and early-stage exploration",
    ],
    highlighted: false,
  },
];

export default function EngagementModels() {
  return (
    <section className="relative overflow-hidden border-t border-[#e2e5ea] bg-white py-14 lg:py-18">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-72 w-72 rounded-full bg-[#f96706]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-[#1c2f4a]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f96706]">
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
            How We Engage
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[#0f172a] sm:text-4xl">
            An engagement model that fits how you work
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#54607a] sm:text-lg">
            Every project is different. Here are the three ways teams
            typically work with us.
          </p>
        </div>

        {/* Styled as a comparison table, not another icon-badge card grid —
            a top color band per tier + a divided feature list instead of
            individual bordered cards with a square icon badge. */}
        <div className="mt-10 grid grid-cols-1 overflow-hidden rounded-2xl border border-[#e2e5ea] shadow-sm lg:grid-cols-3">
          {MODELS.map(({ icon: Icon, name, tagline, features, highlighted }, index) => (
            <div
              key={name}
              style={{ animationDelay: `${index * 0.1}s` }}
              className={`model-in relative flex flex-col ${
                highlighted ? "bg-[#fffaf5]" : "bg-white"
              } ${index > 0 ? "border-t border-[#e2e5ea] lg:border-l lg:border-t-0" : ""}`}
            >
              <div
                className="h-1.5 w-full"
                style={{
                  background: highlighted
                    ? "linear-gradient(90deg, #f96706, #3089a6)"
                    : index === 0
                      ? "#f96706"
                      : "#3089a6",
                }}
              />
              {highlighted && (
                <span className="absolute right-5 top-5 rounded-full bg-gradient-to-r from-[#f96706] to-[#3089a6] px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-white shadow-sm">
                  Most Common
                </span>
              )}

              <div className="flex flex-1 flex-col p-8">
                <Icon
                  className="h-6 w-6"
                  style={{ color: index === 1 ? "#f96706" : index === 0 ? "#f96706" : "#3089a6" }}
                  aria-hidden="true"
                />
                <h3 className="mt-4 text-xl font-bold tracking-tight text-[#0f172a]">{name}</h3>
                <p className="mt-1.5 text-sm font-medium text-[#f96706]">{tagline}</p>

                <ul className="mt-6 flex flex-1 flex-col divide-y divide-[#eef0f2] border-t border-[#eef0f2]">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 py-3 text-sm text-[#54607a]">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#f96706]" aria-hidden="true" />
                      <span className="leading-relaxed">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .model-in {
          animation: modelFadeUp 0.6s ease-out both;
        }
        @keyframes modelFadeUp {
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

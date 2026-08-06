import { Check } from "lucide-react";

const MODELS = [
  {
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
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            How We Engage
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            An engagement model that fits how you work
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Every project is different. Here are the three ways teams
            typically work with us.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {MODELS.map(({ name, tagline, features, highlighted }) => (
            <div
              key={name}
              className={`relative flex flex-col rounded-2xl border p-7 shadow-md transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl ${
                highlighted
                  ? "border-[#f7941e]/40 bg-gradient-to-br from-[#f7941e]/[0.06] to-[#1f4693]/[0.04] shadow-[#f7941e]/10"
                  : "border-white/70 bg-gradient-to-br from-white/80 to-[#1f4693]/[0.03] shadow-[#1f4693]/5 hover:shadow-[#1f4693]/10"
              }`}
            >
              {highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#f7941e] to-[#db7d17] px-4 py-1 text-xs font-bold text-white shadow-md shadow-[#f7941e]/25">
                  Most Common
                </span>
              )}
              <h3 className="text-xl font-bold tracking-tight text-[#2b303b]">{name}</h3>
              <p className="mt-1.5 text-sm font-medium text-[#f7941e]">{tagline}</p>

              <ul className="mt-6 flex flex-1 flex-col gap-3">
                {features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-[#676b7a]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#f7941e]" aria-hidden="true" />
                    <span className="leading-relaxed">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import {
  BarChart3,
  Boxes,
  Lock,
  Repeat,
  Smartphone,
  Workflow,
} from "lucide-react";

const SOLUTIONS = [
  {
    icon: Workflow,
    title: "Custom Platforms",
    description:
      "Purpose-built web and mobile platforms designed around how your industry actually operates.",
  },
  {
    icon: Repeat,
    title: "System Integration",
    description:
      "Connecting the tools you already use so data moves automatically instead of manually.",
  },
  {
    icon: BarChart3,
    title: "Reporting & Dashboards",
    description:
      "Real-time visibility into the metrics that matter most to your operations and leadership.",
  },
  {
    icon: Lock,
    title: "Compliance & Security",
    description:
      "Architecture built to meet the regulatory and data-protection standards of your sector.",
  },
  {
    icon: Boxes,
    title: "Legacy Modernization",
    description:
      "Rebuilding aging systems into maintainable, scalable software without disrupting operations.",
  },
  {
    icon: Smartphone,
    title: "Field & Mobile Tools",
    description:
      "Apps built for teams working outside the office — on-site, on the road, or on the floor.",
  },
];

export default function SolutionsWeDeliver() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-5 lg:py-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Solutions We Deliver
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            The building blocks behind every industry engagement
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Whatever sector you&apos;re in, most projects draw on the same core
            set of capabilities.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#1f4693]/[0.03] p-6 shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-xl hover:shadow-[#1f4693]/10"
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-50 bg-gradient-to-r from-[#f7941e] to-[#1f4693] opacity-40 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
              />
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/70 bg-gradient-to-br from-[#f7941e]/20 to-[#1f4693]/20 shadow-md shadow-[#1f4693]/10 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                <Icon className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-[#2b303b]">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#676b7a]">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

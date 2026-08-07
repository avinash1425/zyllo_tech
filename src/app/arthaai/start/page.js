import Link from "next/link";
import { Calculator, Target, GraduationCap, ArrowRight, ArrowLeft } from "lucide-react";

const MODULES = [
  {
    icon: Calculator,
    title: "ArthaCalc",
    subtitle: "Smart Calculator Suite",
    description:
      "Instant, transparent financial projections for the decisions that matter — from loans to retirement.",
    href: "/arthaai/calculators",
    cta: "Open Calculators",
    available: true,
  },
  {
    icon: Target,
    title: "ArthaPlanner",
    subtitle: "Financial Life Planner",
    description:
      "List your financial goals in priority order and see exactly how much to set aside for each one every month.",
    href: "/arthaai/planner",
    cta: "Build My Plan",
    available: true,
  },
  {
    icon: GraduationCap,
    title: "ArthaGuru",
    subtitle: "Investment Education Engine",
    description:
      "Unbiased financial education in plain language — from mutual fund basics to retirement planning.",
    href: "/arthaai/guru",
    cta: "Ask ArthaGuru",
    available: true,
  },
];

export default function ArthaAIStartPage() {
  return (
    <section className="bg-[#fbfaf7] py-14 lg:py-18">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Link
          href="/arthaai"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] transition-all hover:gap-2.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          ArthaAI Home
        </Link>

        <div className="mx-auto mt-6 max-w-2xl text-center">
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-[#1f4693]">
            Three Core Modules
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#1c2333] sm:text-4xl">
            Everything you need for financial clarity
          </h1>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {MODULES.map(({ icon: Icon, title, subtitle, description, href, cta, available }) => (
            <div
              key={title}
              className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${
                available ? "border-[#1f4693]/20" : "border-[#e3e8ee] opacity-75"
              }`}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#1f4693] to-[#163570]">
                <Icon className="h-6 w-6 text-white" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-bold text-[#1c2333]">{title}</h3>
              <p className="text-sm font-medium text-[#1f4693]">{subtitle}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-[#6b7280]">{description}</p>
              {available ? (
                <Link
                  href={href}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] transition-all hover:gap-2.5"
                >
                  {cta}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : (
                <span className="mt-5 inline-flex w-fit rounded-full bg-[#e3e8ee] px-3 py-1 text-xs font-semibold text-[#6b7280]">
                  {cta}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

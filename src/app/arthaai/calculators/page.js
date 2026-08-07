import Link from "next/link";
import {
  Landmark,
  TrendingUp,
  Receipt,
  PiggyBank,
  Home,
  ArrowRight,
  ArrowLeft,
  KeyRound,
  Target,
  ShieldAlert,
} from "lucide-react";

const CATEGORIES = [
  {
    name: "Borrowing & Housing",
    calculators: [
      {
        icon: Landmark,
        title: "EMI Calculator",
        description:
          "Home, car, personal, education loan, or credit card debt payments, with a year-by-year breakdown.",
        href: "/arthaai/calculators/emi",
      },
      {
        icon: KeyRound,
        title: "Home Loan Eligibility",
        description:
          "Rough estimate of the maximum loan amount you could qualify for, based on income and existing debts.",
        href: "/arthaai/calculators/loan-eligibility",
      },
      {
        icon: Home,
        title: "Rent vs. Buy",
        description: "Compare the long-term cost of renting against buying a home.",
        href: "/arthaai/calculators/rent-vs-buy",
      },
    ],
  },
  {
    name: "Wealth & Investments",
    calculators: [
      {
        icon: TrendingUp,
        title: "Investment Growth Calculator",
        description: "Project the future value of a recurring monthly investment or a one-time lumpsum.",
        href: "/arthaai/calculators/sip-lumpsum",
      },
      {
        icon: Target,
        title: "Monthly Savings Goal",
        description: "Work backward from a target amount to find how much to invest each month.",
        href: "/arthaai/calculators/savings-goal",
      },
      {
        icon: PiggyBank,
        title: "FD / RD / PPF / NPS Calculator",
        description: "Maturity value for Fixed Deposits, Recurring Deposits, PPF, and NPS projections.",
        href: "/arthaai/calculators/fd-rd-ppf",
      },
      {
        icon: Receipt,
        title: "Tax Savings Calculator",
        description: "Compare Old vs. New tax regime and see which saves you more under FY 2026-27 rules.",
        href: "/arthaai/calculators/tax-savings",
      },
    ],
  },
  {
    name: "Protection & Essentials",
    calculators: [
      {
        icon: ShieldAlert,
        title: "Emergency Fund Calculator",
        description: "Figure out how much to set aside for unexpected expenses, and how long it'll take.",
        href: "/arthaai/calculators/emergency-fund",
      },
    ],
  },
];

export default function CalculatorsHubPage() {
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
            ArthaCalc
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#1c2333] sm:text-4xl">
            Smart Calculator Suite
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-[#4b5563]">
            Free, transparent financial calculators — built on standard,
            verifiable formulas and India&apos;s FY 2026-27 tax rules.
          </p>
        </div>

        <div className="mt-14 flex flex-col gap-14">
          {CATEGORIES.map((category) => (
            <div key={category.name}>
              <h2 className="text-xl font-bold text-[#1c2333]">{category.name}</h2>
              <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {category.calculators.map(({ icon: Icon, title, description, href }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group flex flex-col rounded-2xl border border-[#e3e8ee] bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#1f4693] to-[#163570]">
                      <Icon className="h-6 w-6 text-white" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-base font-bold text-[#1c2333]">{title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-[#6b7280]">
                      {description}
                    </p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] transition-all duration-200 group-hover:gap-2.5">
                      Open Calculator
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

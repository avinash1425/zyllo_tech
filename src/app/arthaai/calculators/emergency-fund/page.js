"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import NumberField from "@/components/arthaai/NumberField";
import ResultCard from "@/components/arthaai/ResultCard";
import Disclaimer from "@/components/arthaai/Disclaimer";
import { formatINR } from "@/lib/arthaai-calculations";

export default function EmergencyFundCalculatorPage() {
  const [monthlyExpenses, setMonthlyExpenses] = useState(2000);
  const [monthsOfCover, setMonthsOfCover] = useState(6);
  const [currentSavings, setCurrentSavings] = useState(0);
  const [monthlyContribution, setMonthlyContribution] = useState(200);

  const result = useMemo(() => {
    const target = monthlyExpenses * monthsOfCover;
    const remaining = Math.max(0, target - currentSavings);
    const monthsToGoal =
      monthlyContribution > 0 ? Math.ceil(remaining / monthlyContribution) : Infinity;
    return { target, remaining, monthsToGoal };
  }, [monthlyExpenses, monthsOfCover, currentSavings, monthlyContribution]);

  const fmt = (v) => formatINR(v);

  return (
    <section className="bg-[#fbfaf7] py-10 lg:py-14">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <Link
          href="/arthaai/calculators"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] transition-all hover:gap-2.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          All Calculators
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[#1c2333] sm:text-4xl">
              Emergency Fund Calculator
            </h1>
            <p className="mt-2 text-base leading-relaxed text-[#6b7280]">
              Figure out how much to keep set aside for unexpected expenses
              or income loss, and how long it&apos;ll take to build it up.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-6 rounded-2xl border border-[#e3e8ee] bg-white p-6">
            <NumberField
              label="Essential Monthly Expenses"
              value={monthlyExpenses}
              onChange={setMonthlyExpenses}
              min={200}
              max={20000}
              step={100}
              useCurrencyPrefix
              helpText="Rent/mortgage, utilities, food, insurance, minimum debt payments — what you'd need to cover if income stopped."
            />
            <NumberField
              label="Months of Cover"
              value={monthsOfCover}
              onChange={setMonthsOfCover}
              min={1}
              max={12}
              step={1}
              suffix=" months"
              helpText="3-6 months is a common guideline, more if your income is variable or a single household earner."
            />
            <NumberField
              label="Current Emergency Savings"
              value={currentSavings}
              onChange={setCurrentSavings}
              min={0}
              max={100000}
              step={100}
              useCurrencyPrefix
            />
            <NumberField
              label="Monthly Contribution Toward Goal"
              value={monthlyContribution}
              onChange={setMonthlyContribution}
              min={0}
              max={5000}
              step={50}
              useCurrencyPrefix
            />
          </div>

          <div className="flex flex-col gap-4">
            <ResultCard label="Emergency Fund Target" value={fmt(result.target)} size="lg" />
            <div className="grid grid-cols-2 gap-4">
              <ResultCard
                label="Still Needed"
                value={fmt(result.remaining)}
                accent="#f7941e"
              />
              <ResultCard
                label="Time to Reach Goal"
                value={
                  result.monthsToGoal === Infinity
                    ? "—"
                    : result.monthsToGoal === 0
                      ? "Goal reached"
                      : `${result.monthsToGoal} mo`
                }
                accent="#1f4693"
              />
            </div>
            <Disclaimer />
          </div>
        </div>
      </div>
    </section>
  );
}

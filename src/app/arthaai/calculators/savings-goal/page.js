"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import NumberField from "@/components/arthaai/NumberField";
import ResultCard from "@/components/arthaai/ResultCard";
import Disclaimer from "@/components/arthaai/Disclaimer";
import { calculateRequiredMonthlyContribution, calculateSIP, formatINR } from "@/lib/arthaai-calculations";

export default function SavingsGoalCalculatorPage() {
  const [targetAmount, setTargetAmount] = useState(50000);
  const [years, setYears] = useState(10);
  const [annualReturn, setAnnualReturn] = useState(7);

  const requiredMonthly = useMemo(
    () => calculateRequiredMonthlyContribution(targetAmount, annualReturn, years),
    [targetAmount, annualReturn, years]
  );

  // Also show total contributed vs. growth, for context on the result.
  const breakdown = useMemo(
    () => calculateSIP(requiredMonthly, annualReturn, years),
    [requiredMonthly, annualReturn, years]
  );

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
              Monthly Savings Goal
            </h1>
            <p className="mt-2 text-base leading-relaxed text-[#6b7280]">
              Enter a target amount and timeframe — this works backward to
              tell you how much to invest each month to get there.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-6 rounded-2xl border border-[#e3e8ee] bg-white p-6">
            <NumberField
              label="Target Amount"
              value={targetAmount}
              onChange={setTargetAmount}
              min={1000}
              max={2000000}
              step={1000}
              useCurrencyPrefix
              helpText="What you want to have saved by the end of the timeframe — a down payment, a milestone, a big purchase."
            />
            <NumberField
              label="Time to Reach Goal"
              value={years}
              onChange={setYears}
              min={1}
              max={40}
              step={1}
              suffix=" years"
            />
            <NumberField
              label="Expected Annual Return"
              value={annualReturn}
              onChange={setAnnualReturn}
              min={0}
              max={20}
              step={0.5}
              suffix="%"
              helpText="Use 0% if you're saving in cash; use a higher rate if you plan to invest along the way. Returns are never guaranteed."
            />
          </div>

          <div className="flex flex-col gap-4">
            <ResultCard
              label="Required Monthly Contribution"
              value={fmt(requiredMonthly)}
              size="lg"
            />
            <div className="grid grid-cols-2 gap-4">
              <ResultCard
                label="Total You'll Contribute"
                value={fmt(breakdown.investedAmount)}
                accent="#1c2333"
              />
              <ResultCard
                label="Growth from Returns"
                value={fmt(breakdown.estimatedReturns)}
                accent="#f7941e"
              />
            </div>
            <Disclaimer />
          </div>
        </div>
      </div>
    </section>
  );
}

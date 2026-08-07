"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import NumberField from "@/components/arthaai/NumberField";
import ResultCard from "@/components/arthaai/ResultCard";
import Disclaimer from "@/components/arthaai/Disclaimer";
import { calculateSIP, calculateLumpsum, inflationAdjust, formatINR } from "@/lib/arthaai-calculations";

export default function RecurringInvestmentCalculatorPage() {
  const [mode, setMode] = useState("recurring"); // "recurring" | "lumpsum"
  const [monthlyAmount, setMonthlyAmount] = useState(200);
  const [lumpsumAmount, setLumpsumAmount] = useState(20000);
  const [annualReturn, setAnnualReturn] = useState(8);
  const [years, setYears] = useState(10);
  const [adjustInflation, setAdjustInflation] = useState(false);
  const [inflationRate, setInflationRate] = useState(3);

  const result = useMemo(() => {
    return mode === "recurring"
      ? calculateSIP(monthlyAmount, annualReturn, years)
      : calculateLumpsum(lumpsumAmount, annualReturn, years);
  }, [mode, monthlyAmount, lumpsumAmount, annualReturn, years]);

  const realValue = useMemo(
    () =>
      adjustInflation ? inflationAdjust(result.futureValue, inflationRate, years) : null,
    [adjustInflation, result.futureValue, inflationRate, years]
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
              Investment Growth Calculator
            </h1>
            <p className="mt-2 text-base leading-relaxed text-[#6b7280]">
              Project the future value of a recurring monthly investment or a
              one-time lumpsum, using standard compound-growth formulas.
            </p>
          </div>
        </div>

        <div className="mt-6 inline-flex rounded-full border border-[#e3e8ee] bg-white p-1">
          <button
            type="button"
            onClick={() => setMode("recurring")}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
              mode === "recurring"
                ? "bg-[#1f4693] text-white"
                : "text-[#6b7280] hover:text-[#1c2333]"
            }`}
          >
            Monthly Investment
          </button>
          <button
            type="button"
            onClick={() => setMode("lumpsum")}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
              mode === "lumpsum"
                ? "bg-[#1f4693] text-white"
                : "text-[#6b7280] hover:text-[#1c2333]"
            }`}
          >
            Lumpsum
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-6 rounded-2xl border border-[#e3e8ee] bg-white p-6">
            {mode === "recurring" ? (
              <NumberField
                label="Monthly Investment"
                value={monthlyAmount}
                onChange={setMonthlyAmount}
                min={10}
                max={10000}
                step={10}
                useCurrencyPrefix
              />
            ) : (
              <NumberField
                label="Lumpsum Amount"
                value={lumpsumAmount}
                onChange={setLumpsumAmount}
                min={500}
                max={1000000}
                step={500}
                useCurrencyPrefix
              />
            )}
            <NumberField
              label="Expected Annual Return"
              value={annualReturn}
              onChange={setAnnualReturn}
              min={1}
              max={30}
              step={0.5}
              suffix="%"
              helpText="Diversified equity investments have historically returned roughly 7-10% p.a. over long periods in many markets, but returns are never guaranteed and vary by market and period."
            />
            <NumberField
              label="Investment Period"
              value={years}
              onChange={setYears}
              min={1}
              max={40}
              step={1}
              suffix=" years"
            />

            <label className="flex items-center gap-2 text-sm text-[#4b5563]">
              <input
                type="checkbox"
                checked={adjustInflation}
                onChange={(e) => setAdjustInflation(e.target.checked)}
                className="h-4 w-4 rounded border-[#dde3ea] text-[#1f4693] focus:ring-[#1f4693]/40"
              />
              Adjust for inflation (show value in today&apos;s money)
            </label>
            {adjustInflation && (
              <NumberField
                label="Expected Inflation Rate"
                value={inflationRate}
                onChange={setInflationRate}
                min={0}
                max={15}
                step={0.5}
                suffix="%"
              />
            )}
          </div>

          <div className="flex flex-col gap-4">
            <ResultCard label="Future Value" value={fmt(result.futureValue)} size="lg" />
            <div className="grid grid-cols-2 gap-4">
              <ResultCard
                label="Amount Invested"
                value={fmt(result.investedAmount)}
                accent="#1c2333"
              />
              <ResultCard
                label="Estimated Returns"
                value={fmt(result.estimatedReturns)}
                accent="#f7941e"
              />
            </div>
            {adjustInflation && realValue !== null && (
              <ResultCard label="Value in Today's Money" value={fmt(realValue)} accent="#1f4693" />
            )}
            <Disclaimer />
          </div>
        </div>
      </div>
    </section>
  );
}

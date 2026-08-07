"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import NumberField from "@/components/arthaai/NumberField";
import ResultCard from "@/components/arthaai/ResultCard";
import Disclaimer from "@/components/arthaai/Disclaimer";
import { estimateLoanEligibility, formatINR } from "@/lib/arthaai-calculations";

export default function LoanEligibilityCalculatorPage() {
  const [monthlyIncome, setMonthlyIncome] = useState(5000);
  const [existingDebts, setExistingDebts] = useState(300);
  const [maxDti, setMaxDti] = useState(40);
  const [rate, setRate] = useState(7);
  const [tenureYears, setTenureYears] = useState(20);

  const result = useMemo(
    () =>
      estimateLoanEligibility({
        monthlyIncome,
        existingMonthlyDebts: existingDebts,
        maxDtiPercent: maxDti,
        annualRatePercent: rate,
        tenureYears,
      }),
    [monthlyIncome, existingDebts, maxDti, rate, tenureYears]
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
              Home Loan Eligibility
            </h1>
            <p className="mt-2 text-base leading-relaxed text-[#6b7280]">
              Estimates a rough maximum loan amount based on your income,
              existing debts, and a debt-to-income ratio — the same
              affordability logic most lenders use, simplified.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-[#f0d9a8] bg-[#fdf6e8] p-4">
          <p className="text-xs leading-relaxed text-[#7a5c1e]">
            <span className="font-semibold">This is not a pre-approval.</span>{" "}
            Actual lending decisions depend on your credit history, employment
            type, the specific lender&apos;s policies, local regulations, and
            factors this calculator doesn&apos;t consider. Treat this as a
            rough starting estimate only.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-6 rounded-2xl border border-[#e3e8ee] bg-white p-6">
            <NumberField
              label="Gross Monthly Income"
              value={monthlyIncome}
              onChange={setMonthlyIncome}
              min={500}
              max={50000}
              step={100}
              useCurrencyPrefix
            />
            <NumberField
              label="Existing Monthly Debt Payments"
              value={existingDebts}
              onChange={setExistingDebts}
              min={0}
              max={10000}
              step={50}
              useCurrencyPrefix
              helpText="Car loans, student loans, credit card minimums, and any other recurring debt payments."
            />
            <NumberField
              label="Max Debt-to-Income Ratio"
              value={maxDti}
              onChange={setMaxDti}
              min={20}
              max={60}
              step={1}
              suffix="%"
              helpText="The share of your income lenders will let go toward all debt payments combined. 36-45% is a common range, but it varies by lender and country."
            />
            <NumberField
              label="Interest Rate (per annum)"
              value={rate}
              onChange={setRate}
              min={1}
              max={20}
              step={0.05}
              suffix="%"
            />
            <NumberField
              label="Loan Tenure"
              value={tenureYears}
              onChange={setTenureYears}
              min={5}
              max={30}
              step={1}
              suffix=" years"
            />
          </div>

          <div className="flex flex-col gap-4">
            <ResultCard label="Estimated Max Loan Amount" value={fmt(result.maxLoanAmount)} size="lg" />
            <div className="grid grid-cols-2 gap-4">
              <ResultCard
                label="Max Total Debt Payment / mo"
                value={fmt(result.maxTotalDebtPayment)}
                accent="#1c2333"
              />
              <ResultCard
                label="Affordable New Payment / mo"
                value={fmt(result.affordableNewEMI)}
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

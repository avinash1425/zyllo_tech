"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Home, KeyRound } from "lucide-react";
import NumberField from "@/components/arthaai/NumberField";
import ResultCard from "@/components/arthaai/ResultCard";
import Disclaimer from "@/components/arthaai/Disclaimer";
import { compareRentVsBuy, formatINR } from "@/lib/arthaai-calculations";

export default function RentVsBuyCalculatorPage() {
  const [homePrice, setHomePrice] = useState(350000);
  const [downPaymentPercent, setDownPaymentPercent] = useState(20);
  const [loanRate, setLoanRate] = useState(7);
  const [loanTenure, setLoanTenure] = useState(20);
  const [monthlyRent, setMonthlyRent] = useState(1500);
  const [rentEscalation, setRentEscalation] = useState(3);
  const [homeAppreciation, setHomeAppreciation] = useState(3);
  const [investmentReturn, setInvestmentReturn] = useState(7);
  const [horizonYears, setHorizonYears] = useState(10);

  const result = useMemo(
    () =>
      compareRentVsBuy({
        homePrice,
        downPaymentPercent,
        loanRatePercent: loanRate,
        loanTenureYears: loanTenure,
        monthlyRent,
        rentEscalationPercent: rentEscalation,
        homeAppreciationPercent: homeAppreciation,
        investmentReturnPercent: investmentReturn,
        horizonYears,
      }),
    [
      homePrice,
      downPaymentPercent,
      loanRate,
      loanTenure,
      monthlyRent,
      rentEscalation,
      homeAppreciation,
      investmentReturn,
      horizonYears,
    ]
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
              Rent vs. Buy Decision Engine
            </h1>
            <p className="mt-2 text-base leading-relaxed text-[#6b7280]">
              Compares the long-term net cost of renting against buying, over
              your chosen time horizon. This is a simplified estimate — real
              decisions also depend on stability, lifestyle, and factors this
              tool doesn&apos;t capture.
            </p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <div className="rounded-2xl border border-[#e3e8ee] bg-white p-6">
              <p className="mb-4 flex items-center gap-2 text-sm font-bold text-[#1c2333]">
                <Home className="h-4 w-4 text-[#1f4693]" aria-hidden="true" />
                Buying
              </p>
              <div className="flex flex-col gap-6">
                <NumberField
                  label="Home Price"
                  value={homePrice}
                  onChange={setHomePrice}
                  min={20000}
                  max={3000000}
                  step={5000}
                  useCurrencyPrefix
                />
                <NumberField
                  label="Down Payment"
                  value={downPaymentPercent}
                  onChange={setDownPaymentPercent}
                  min={10}
                  max={100}
                  step={5}
                  suffix="%"
                />
                <NumberField
                  label="Home Loan Interest Rate"
                  value={loanRate}
                  onChange={setLoanRate}
                  min={2}
                  max={15}
                  step={0.05}
                  suffix="%"
                />
                <NumberField
                  label="Loan Tenure"
                  value={loanTenure}
                  onChange={setLoanTenure}
                  min={5}
                  max={30}
                  step={1}
                  suffix=" years"
                />
                <NumberField
                  label="Home Appreciation Rate"
                  value={homeAppreciation}
                  onChange={setHomeAppreciation}
                  min={0}
                  max={15}
                  step={0.5}
                  suffix="%"
                  helpText="Long-term residential real estate appreciation varies widely by location — check typical rates for your area rather than relying on this default."
                />
              </div>
            </div>

            <div className="rounded-2xl border border-[#e3e8ee] bg-white p-6">
              <p className="mb-4 flex items-center gap-2 text-sm font-bold text-[#1c2333]">
                <KeyRound className="h-4 w-4 text-[#1f4693]" aria-hidden="true" />
                Renting
              </p>
              <div className="flex flex-col gap-6">
                <NumberField
                  label="Current Monthly Rent"
                  value={monthlyRent}
                  onChange={setMonthlyRent}
                  min={100}
                  max={20000}
                  step={50}
                  useCurrencyPrefix
                />
                <NumberField
                  label="Annual Rent Escalation"
                  value={rentEscalation}
                  onChange={setRentEscalation}
                  min={0}
                  max={15}
                  step={0.5}
                  suffix="%"
                />
                <NumberField
                  label="Return if Difference Invested"
                  value={investmentReturn}
                  onChange={setInvestmentReturn}
                  min={0}
                  max={20}
                  step={0.5}
                  suffix="%"
                  helpText="If renting costs less than buying each month, this assumes the saved amount is invested at this rate."
                />
              </div>
            </div>

            <NumberField
              label="Comparison Horizon"
              value={horizonYears}
              onChange={setHorizonYears}
              min={3}
              max={30}
              step={1}
              suffix=" years"
            />
          </div>

          <div className="flex flex-col gap-4">
            <div
              className={`rounded-2xl border-2 p-6 text-center ${
                result.recommendation === "buy"
                  ? "border-[#1f4693] bg-[#1f4693]/5"
                  : "border-[#f7941e] bg-[#f7941e]/5"
              }`}
            >
              <p className="text-xs font-bold uppercase tracking-wide text-[#6b7280]">
                Over {horizonYears} years, the numbers favor
              </p>
              <p
                className={`mt-1 text-3xl font-bold ${
                  result.recommendation === "buy" ? "text-[#1f4693]" : "text-[#f7941e]"
                }`}
              >
                {result.recommendation === "buy" ? "Buying" : "Renting"}
              </p>
              <p className="mt-1 text-sm text-[#6b7280]">by roughly {fmt(result.difference)}</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <ResultCard label="Monthly Loan Payment (Buying)" value={fmt(result.emi)} accent="#1c2333" />
              <ResultCard
                label="Net Cost of Buying"
                value={fmt(result.netBuyingCost)}
                accent="#1f4693"
              />
              <ResultCard
                label="Net Cost of Renting"
                value={fmt(result.netRentingCost)}
                accent="#f7941e"
              />
              <ResultCard
                label="Estimated Home Value at End of Horizon"
                value={fmt(result.homeFutureValue)}
                accent="#1c2333"
              />
            </div>

            <Disclaimer />
          </div>
        </div>
      </div>
    </section>
  );
}

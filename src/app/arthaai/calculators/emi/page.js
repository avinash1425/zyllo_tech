"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import NumberField from "@/components/arthaai/NumberField";
import ResultCard from "@/components/arthaai/ResultCard";
import Disclaimer from "@/components/arthaai/Disclaimer";
import { calculateEMI, formatINR } from "@/lib/arthaai-calculations";

const LOAN_TYPES = [
  {
    key: "home",
    label: "Home Loan",
    defaultPrincipal: 300000,
    defaultRate: 7,
    defaultTenureYears: 20,
    maxTenureYears: 30,
    maxPrincipal: 2000000,
  },
  {
    key: "car",
    label: "Car Loan",
    defaultPrincipal: 25000,
    defaultRate: 8,
    defaultTenureYears: 5,
    maxTenureYears: 8,
    maxPrincipal: 150000,
  },
  {
    key: "personal",
    label: "Personal Loan",
    defaultPrincipal: 10000,
    defaultRate: 12,
    defaultTenureYears: 3,
    maxTenureYears: 7,
    maxPrincipal: 100000,
  },
  {
    key: "education",
    label: "Education Loan",
    defaultPrincipal: 40000,
    defaultRate: 8,
    defaultTenureYears: 10,
    maxTenureYears: 15,
    maxPrincipal: 200000,
  },
  {
    key: "creditcard",
    label: "Credit Card Debt Payoff",
    defaultPrincipal: 5000,
    defaultRate: 22,
    defaultTenureYears: 2,
    maxTenureYears: 5,
    maxPrincipal: 30000,
  },
];

export default function EMICalculatorPage() {
  const [loanTypeKey, setLoanTypeKey] = useState("home");
  const loanType = LOAN_TYPES.find((t) => t.key === loanTypeKey) ?? LOAN_TYPES[0];

  const [principal, setPrincipal] = useState(loanType.defaultPrincipal);
  const [rate, setRate] = useState(loanType.defaultRate);
  const [tenureYears, setTenureYears] = useState(loanType.defaultTenureYears);

  // Reset field values to sensible defaults when switching loan type, so
  // e.g. a $300,000 home-loan amount doesn't linger after switching to
  // "Credit Card Debt Payoff".
  useEffect(() => {
    setPrincipal(loanType.defaultPrincipal);
    setRate(loanType.defaultRate);
    setTenureYears(loanType.defaultTenureYears);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanTypeKey]);

  const result = useMemo(
    () => calculateEMI(principal, rate, tenureYears * 12),
    [principal, rate, tenureYears]
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
              EMI Calculator
            </h1>
            <p className="mt-2 text-base leading-relaxed text-[#6b7280]">
              Calculate your monthly loan payment using the standard
              amortization formula, for any type of installment loan.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {LOAN_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setLoanTypeKey(t.key)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                loanTypeKey === t.key
                  ? "border-transparent bg-[#1f4693] text-white"
                  : "border-[#e3e8ee] bg-white text-[#6b7280] hover:border-[#1f4693]/30 hover:text-[#1c2333]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-6 rounded-2xl border border-[#e3e8ee] bg-white p-6">
            <NumberField
              label="Loan Amount"
              value={principal}
              onChange={setPrincipal}
              min={500}
              max={loanType.maxPrincipal}
              step={500}
              useCurrencyPrefix
            />
            <NumberField
              label="Interest Rate (per annum)"
              value={rate}
              onChange={setRate}
              min={1}
              max={30}
              step={0.05}
              suffix="%"
              helpText={
                loanTypeKey === "creditcard"
                  ? "Credit card interest rates are typically much higher than secured loans — check your actual card's APR."
                  : undefined
              }
            />
            <NumberField
              label="Loan Tenure"
              value={tenureYears}
              onChange={setTenureYears}
              min={1}
              max={loanType.maxTenureYears}
              step={1}
              suffix=" years"
            />
          </div>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-1">
              <ResultCard label="Monthly Payment" value={fmt(result.emi)} size="lg" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <ResultCard
                label="Total Interest"
                value={fmt(result.totalInterest)}
                accent="#f7941e"
              />
              <ResultCard
                label="Total Payment"
                value={fmt(result.totalPayment)}
                accent="#1c2333"
              />
            </div>
            <Disclaimer />
          </div>
        </div>

        {result.schedule.length > 0 && (
          <div className="mt-10 overflow-hidden rounded-2xl border border-[#e3e8ee] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[500px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#e3e8ee] bg-[#fbfaf7] text-xs font-bold uppercase tracking-wide text-[#6b7280]">
                    <th className="px-5 py-3">Year</th>
                    <th className="px-5 py-3">Principal Paid</th>
                    <th className="px-5 py-3">Interest Paid</th>
                    <th className="px-5 py-3">Remaining Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {result.schedule.map((row) => (
                    <tr key={row.year} className="border-b border-[#e3e8ee] last:border-0">
                      <td className="px-5 py-3 font-medium text-[#1c2333]">Year {row.year}</td>
                      <td className="px-5 py-3 text-[#4b5563]">{fmt(row.principalPaid)}</td>
                      <td className="px-5 py-3 text-[#4b5563]">{fmt(row.interestPaid)}</td>
                      <td className="px-5 py-3 text-[#4b5563]">{fmt(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

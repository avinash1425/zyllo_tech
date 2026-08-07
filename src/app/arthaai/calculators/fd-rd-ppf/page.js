"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import NumberField from "@/components/arthaai/NumberField";
import ResultCard from "@/components/arthaai/ResultCard";
import Disclaimer from "@/components/arthaai/Disclaimer";
import {
  calculateCompoundMaturity,
  calculateRDMaturity,
  calculatePPFMaturity,
  calculateSIP,
  formatINR,
} from "@/lib/arthaai-calculations";
import {
  SMALL_SAVINGS_RATES,
  DEFAULT_BANK_RATES,
  NPS_ASSUMED_RETURN,
} from "@/data/arthaai-rates";

const MODES = [
  { key: "fd", label: "Fixed Deposit" },
  { key: "rd", label: "Recurring Deposit" },
  { key: "ppf", label: "PPF" },
  { key: "nps", label: "NPS" },
];

export default function SavingsMaturityCalculatorPage() {
  const [mode, setMode] = useState("fd");

  const [fdPrincipal, setFdPrincipal] = useState(100000);
  const [fdRate, setFdRate] = useState(DEFAULT_BANK_RATES.fdGeneral * 100);
  const [fdYears, setFdYears] = useState(5);
  const [fdCompounding, setFdCompounding] = useState(4);

  const [rdMonthly, setRdMonthly] = useState(5000);
  const [rdRate, setRdRate] = useState(DEFAULT_BANK_RATES.rdGeneral * 100);
  const [rdYears, setRdYears] = useState(5);

  const [ppfAnnual, setPpfAnnual] = useState(150000);
  const [ppfYears, setPpfYears] = useState(15);

  const [npsMonthly, setNpsMonthly] = useState(5000);
  const [npsYears, setNpsYears] = useState(20);

  const fdResult = useMemo(
    () => calculateCompoundMaturity(fdPrincipal, fdRate, fdYears, fdCompounding),
    [fdPrincipal, fdRate, fdYears, fdCompounding]
  );
  const rdResult = useMemo(
    () => calculateRDMaturity(rdMonthly, rdRate, rdYears * 12),
    [rdMonthly, rdRate, rdYears]
  );
  const ppfResult = useMemo(
    () => calculatePPFMaturity(ppfAnnual, SMALL_SAVINGS_RATES.ppf * 100, ppfYears),
    [ppfAnnual, ppfYears]
  );
  const npsResult = useMemo(
    () => calculateSIP(npsMonthly, NPS_ASSUMED_RETURN * 100, npsYears),
    [npsMonthly, npsYears]
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

        <div className="mt-4">
          <h1 className="text-3xl font-bold tracking-tight text-[#1c2333] sm:text-4xl">
            FD / RD / PPF / NPS Calculator
          </h1>
          <p className="mt-2 text-base leading-relaxed text-[#6b7280]">
            Estimate maturity value for Fixed Deposits, Recurring Deposits,
            Public Provident Fund, and National Pension System contributions.
          </p>
        </div>

        <div className="mt-6 inline-flex flex-wrap rounded-full border border-[#e3e8ee] bg-white p-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                mode === m.key ? "bg-[#1f4693] text-white" : "text-[#6b7280] hover:text-[#1c2333]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "fd" && (
          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="flex flex-col gap-6 rounded-2xl border border-[#e3e8ee] bg-white p-6">
              <NumberField
                label="Deposit Amount"
                value={fdPrincipal}
                onChange={setFdPrincipal}
                min={1000}
                max={2000000}
                step={1000}
                useCurrencyPrefix
              />
              <NumberField
                label="Interest Rate (per annum)"
                value={fdRate}
                onChange={setFdRate}
                min={3}
                max={9}
                step={0.05}
                suffix="%"
                helpText={`Default is a typical general-FD rate (~${(DEFAULT_BANK_RATES.fdGeneral * 100).toFixed(2)}%, 3-5yr tenure). Senior citizens typically get ~${(DEFAULT_BANK_RATES.fdSeniorCitizen * 100).toFixed(2)}%. Check your bank's actual rate.`}
              />
              <NumberField
                label="Tenure"
                value={fdYears}
                onChange={setFdYears}
                min={1}
                max={10}
                step={1}
                suffix=" years"
              />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#1c2333]">
                  Compounding Frequency
                </label>
                <select
                  value={fdCompounding}
                  onChange={(e) => setFdCompounding(Number(e.target.value))}
                  className="w-full rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm text-[#1c2333] outline-none focus:border-[#1f4693]/60"
                >
                  <option value={1}>Annually</option>
                  <option value={2}>Semi-annually</option>
                  <option value={4}>Quarterly</option>
                  <option value={12}>Monthly</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <ResultCard label="Maturity Value" value={fmt(fdResult.maturityValue)} size="lg" />
              <div className="grid grid-cols-2 gap-4">
                <ResultCard label="Principal" value={fmt(fdPrincipal)} accent="#1c2333" />
                <ResultCard
                  label="Interest Earned"
                  value={fmt(fdResult.interestEarned)}
                  accent="#f7941e"
                />
              </div>
              <Disclaimer />
            </div>
          </div>
        )}

        {mode === "rd" && (
          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="flex flex-col gap-6 rounded-2xl border border-[#e3e8ee] bg-white p-6">
              <NumberField
                label="Monthly Deposit"
                value={rdMonthly}
                onChange={setRdMonthly}
                min={100}
                max={100000}
                step={100}
                useCurrencyPrefix
              />
              <NumberField
                label="Interest Rate (per annum)"
                value={rdRate}
                onChange={setRdRate}
                min={3}
                max={9}
                step={0.05}
                suffix="%"
                helpText={`Default is a typical general-RD rate (~${(DEFAULT_BANK_RATES.rdGeneral * 100).toFixed(2)}%). Check your bank's actual rate.`}
              />
              <NumberField
                label="Tenure"
                value={rdYears}
                onChange={setRdYears}
                min={1}
                max={10}
                step={1}
                suffix=" years"
              />
            </div>
            <div className="flex flex-col gap-4">
              <ResultCard label="Maturity Value" value={fmt(rdResult.maturityValue)} size="lg" />
              <div className="grid grid-cols-2 gap-4">
                <ResultCard
                  label="Total Deposited"
                  value={fmt(rdResult.investedAmount)}
                  accent="#1c2333"
                />
                <ResultCard
                  label="Interest Earned"
                  value={fmt(rdResult.interestEarned)}
                  accent="#f7941e"
                />
              </div>
              <Disclaimer />
            </div>
          </div>
        )}

        {mode === "ppf" && (
          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="flex flex-col gap-6 rounded-2xl border border-[#e3e8ee] bg-white p-6">
              <NumberField
                label="Annual Contribution"
                value={ppfAnnual}
                onChange={setPpfAnnual}
                min={500}
                max={150000}
                step={500}
                useCurrencyPrefix
                helpText="PPF allows ₹500 to ₹1,50,000 per financial year, contributed at the start of each year in this projection."
              />
              <NumberField
                label="Tenure"
                value={ppfYears}
                onChange={setPpfYears}
                min={15}
                max={50}
                step={1}
                suffix=" years"
                helpText="PPF has a mandatory 15-year lock-in, extendable in blocks of 5 years."
              />
              <p className="text-xs text-[#6b7280]">
                Current PPF rate: {(SMALL_SAVINGS_RATES.ppf * 100).toFixed(1)}% p.a.
                (govt-set, {SMALL_SAVINGS_RATES.quarterLabel} quarter — reviewed
                quarterly and can change).
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <ResultCard label="Maturity Value" value={fmt(ppfResult.maturityValue)} size="lg" />
              <div className="grid grid-cols-2 gap-4">
                <ResultCard
                  label="Total Contributed"
                  value={fmt(ppfResult.investedAmount)}
                  accent="#1c2333"
                />
                <ResultCard
                  label="Interest Earned"
                  value={fmt(ppfResult.interestEarned)}
                  accent="#f7941e"
                />
              </div>
              <Disclaimer />
            </div>
          </div>
        )}

        {mode === "nps" && (
          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="flex flex-col gap-6 rounded-2xl border border-[#e3e8ee] bg-white p-6">
              <NumberField
                label="Monthly Contribution"
                value={npsMonthly}
                onChange={setNpsMonthly}
                min={500}
                max={100000}
                step={500}
                useCurrencyPrefix
              />
              <NumberField
                label="Years to Retirement"
                value={npsYears}
                onChange={setNpsYears}
                min={1}
                max={40}
                step={1}
                suffix=" years"
              />
              <p className="text-xs text-[#6b7280]">
                Illustrative long-term assumption of {(NPS_ASSUMED_RETURN * 100).toFixed(0)}% p.a.
                NPS is market-linked (equity + debt mix) — actual returns vary
                with market performance and your chosen asset allocation, and
                are never guaranteed.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <ResultCard label="Projected Corpus" value={fmt(npsResult.futureValue)} size="lg" />
              <div className="grid grid-cols-2 gap-4">
                <ResultCard
                  label="Total Contributed"
                  value={fmt(npsResult.investedAmount)}
                  accent="#1c2333"
                />
                <ResultCard
                  label="Estimated Growth"
                  value={fmt(npsResult.estimatedReturns)}
                  accent="#f7941e"
                />
              </div>
              <Disclaimer />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

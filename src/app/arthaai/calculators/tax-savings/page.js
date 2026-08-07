"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import NumberField from "@/components/arthaai/NumberField";
import ResultCard from "@/components/arthaai/ResultCard";
import Disclaimer from "@/components/arthaai/Disclaimer";
import { compareTaxRegimes, formatINR } from "@/lib/arthaai-calculations";
import { TAX_RATES_FY_2026_27 } from "@/data/arthaai-rates";

export default function TaxSavingsCalculatorPage() {
  const [grossIncome, setGrossIncome] = useState(1200000);
  const [section80C, setSection80C] = useState(150000);
  const [section80D, setSection80D] = useState(25000);
  const [section80CCD1B, setSection80CCD1B] = useState(0);
  const [otherDeductions, setOtherDeductions] = useState(0);

  const oldRegimeDeductions = useMemo(
    () =>
      Math.min(section80C, TAX_RATES_FY_2026_27.oldRegime.section80C) +
      Math.min(section80D, TAX_RATES_FY_2026_27.oldRegime.section80D.self) +
      Math.min(section80CCD1B, TAX_RATES_FY_2026_27.oldRegime.section80CCD1B) +
      otherDeductions,
    [section80C, section80D, section80CCD1B, otherDeductions]
  );

  const result = useMemo(
    () =>
      compareTaxRegimes({
        grossIncome,
        oldRegimeDeductions,
        rates: TAX_RATES_FY_2026_27,
      }),
    [grossIncome, oldRegimeDeductions]
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
            Tax Savings Calculator
          </h1>
          <p className="mt-2 text-base leading-relaxed text-[#6b7280]">
            Compare your tax liability under the Old and New regimes for{" "}
            {TAX_RATES_FY_2026_27.label} and see which one saves you more.
          </p>
        </div>

        <div className="mt-6 rounded-xl border border-[#f0d9a8] bg-[#fdf6e8] p-4">
          <p className="text-xs leading-relaxed text-[#7a5c1e]">
            <span className="font-semibold">India-specific, {TAX_RATES_FY_2026_27.label}.</span>{" "}
            Slabs, deduction caps, and rebate thresholds are sourced from the
            Income Tax Act 2025 (carrying forward Budget 2025 figures, no
            changes in Budget 2026). This is an estimate for planning
            purposes only — confirm your actual liability with a tax
            professional or the official income tax portal.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-6 rounded-2xl border border-[#e3e8ee] bg-white p-6">
            <NumberField
              label="Gross Annual Income"
              value={grossIncome}
              onChange={setGrossIncome}
              min={250000}
              max={5000000}
              step={10000}
              useCurrencyPrefix
            />
            <NumberField
              label="Section 80C (PPF, ELSS, EPF, life insurance, etc.)"
              value={section80C}
              onChange={setSection80C}
              min={0}
              max={150000}
              step={5000}
              useCurrencyPrefix
              helpText="80C + 80CCC + 80CCD(1) combined cap of ₹1,50,000. Old regime only."
            />
            <NumberField
              label="Section 80D (health insurance premiums)"
              value={section80D}
              onChange={setSection80D}
              min={0}
              max={100000}
              step={1000}
              useCurrencyPrefix
              helpText="₹25,000 self/family (non-senior), up to ₹50,000 if senior citizen. Old regime only."
            />
            <NumberField
              label="Section 80CCD(1B) (additional NPS)"
              value={section80CCD1B}
              onChange={setSection80CCD1B}
              min={0}
              max={50000}
              step={5000}
              useCurrencyPrefix
              helpText="Additional ₹50,000 NPS-only deduction, on top of the 80C cap. Old regime only."
            />
            <NumberField
              label="Other Deductions"
              value={otherDeductions}
              onChange={setOtherDeductions}
              min={0}
              max={200000}
              step={5000}
              useCurrencyPrefix
              helpText="Home loan interest (80EE/24b), HRA exemption, or other old-regime-only deductions not covered above."
            />
          </div>

          <div className="flex flex-col gap-4">
            <div
              className={`rounded-2xl border-2 p-6 text-center ${
                result.betterRegime === "old"
                  ? "border-[#1f4693] bg-[#1f4693]/5"
                  : "border-[#f7941e] bg-[#f7941e]/5"
              }`}
            >
              <p className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#6b7280]">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Recommended regime
              </p>
              <p
                className={`mt-1 text-3xl font-bold ${
                  result.betterRegime === "old" ? "text-[#1f4693]" : "text-[#f7941e]"
                }`}
              >
                {result.betterRegime === "old" ? "Old Regime" : "New Regime"}
              </p>
              <p className="mt-1 text-sm text-[#6b7280]">
                Saves you {fmt(result.savings)} vs. the other regime
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <ResultCard
                label="Old Regime — Total Tax"
                value={fmt(result.oldRegime.totalTax)}
                accent="#1f4693"
              />
              <ResultCard
                label="New Regime — Total Tax"
                value={fmt(result.newRegime.totalTax)}
                accent="#f7941e"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <ResultCard
                label="Old Regime — Taxable Income"
                value={fmt(result.oldRegime.taxableIncome)}
                accent="#1c2333"
              />
              <ResultCard
                label="New Regime — Taxable Income"
                value={fmt(result.newRegime.taxableIncome)}
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

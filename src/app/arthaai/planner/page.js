"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Target } from "lucide-react";
import ResultCard from "@/components/arthaai/ResultCard";
import Disclaimer from "@/components/arthaai/Disclaimer";
import { calculateRequiredMonthlyContribution, calculateSIP, formatINR } from "@/lib/arthaai-calculations";

let nextId = 1;
function makeGoal(overrides = {}) {
  return {
    id: nextId++,
    name: "",
    targetAmount: 10000,
    years: 5,
    annualReturn: 6,
    ...overrides,
  };
}

const STARTER_GOALS = [
  makeGoal({ name: "Emergency Fund", targetAmount: 6000, years: 2, annualReturn: 3 }),
  makeGoal({ name: "Retirement", targetAmount: 300000, years: 25, annualReturn: 8 }),
];

export default function ArthaPlannerPage() {
  const [goals, setGoals] = useState(STARTER_GOALS);
  const [monthlyIncome, setMonthlyIncome] = useState(4000);

  const fmt = (v) => formatINR(v);

  function updateGoal(id, patch) {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  function addGoal() {
    setGoals((prev) => [...prev, makeGoal({ name: `Goal ${prev.length + 1}` })]);
  }

  function removeGoal(id) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }

  // Each goal is solved independently with the same reverse-SIP formula the
  // Monthly Savings Goal calculator uses — this just runs it per goal and
  // adds a combined view across all of them, in the order entered (treated
  // as priority order, first = highest priority).
  const results = useMemo(
    () =>
      goals.map((goal) => {
        const requiredMonthly = calculateRequiredMonthlyContribution(
          goal.targetAmount,
          goal.annualReturn,
          goal.years
        );
        const breakdown = calculateSIP(requiredMonthly, goal.annualReturn, goal.years);
        return { ...goal, requiredMonthly, breakdown };
      }),
    [goals]
  );

  const totalMonthly = results.reduce((sum, r) => sum + r.requiredMonthly, 0);
  const incomePercent = monthlyIncome > 0 ? (totalMonthly / monthlyIncome) * 100 : 0;

  return (
    <section className="bg-[#fbfaf7] py-10 lg:py-14">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <Link
          href="/arthaai/start"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] transition-all hover:gap-2.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          ArthaAI
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[#1c2333] sm:text-4xl">
              ArthaPlanner
            </h1>
            <p className="mt-2 text-base leading-relaxed text-[#6b7280]">
              List out your financial goals in priority order — this works
              backward to tell you how much to set aside for each one every
              month.
            </p>
          </div>
        </div>

        {/* Monthly income — used only to show goals as a % of income, not stored or sent anywhere */}
        <div className="mt-6 flex flex-col gap-2 rounded-2xl border border-[#e3e8ee] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <label htmlFor="monthlyIncome" className="text-sm font-medium text-[#1c2333]">
              Monthly Income (optional)
            </label>
            <p className="mt-0.5 text-xs text-[#6b7280]">
              Used only to show your goals as a share of income — nothing is saved.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#6b7280]">₹</span>
            <input
              id="monthlyIncome"
              type="number"
              min={0}
              step={100}
              value={monthlyIncome}
              onChange={(e) => setMonthlyIncome(Number(e.target.value))}
              className="w-32 rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm text-[#1c2333] outline-none focus:border-[#1f4693]/60"
            />
          </div>
        </div>

        {/* Goal list */}
        <div className="mt-6 flex flex-col gap-4">
          {results.map((goal, index) => (
            <div key={goal.id} className="rounded-2xl border border-[#e3e8ee] bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1f4693]/10 text-xs font-bold text-[#1f4693]">
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    value={goal.name}
                    onChange={(e) => updateGoal(goal.id, { name: e.target.value })}
                    placeholder="Goal name"
                    className="w-full min-w-0 rounded-lg border-none bg-transparent text-base font-semibold text-[#1c2333] outline-none placeholder:text-[#9ca3af] focus:bg-[#f5f6f7]"
                  />
                </div>
                {results.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeGoal(goal.id)}
                    aria-label="Remove goal"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#9ca3af] transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="text-xs font-medium text-[#6b7280]">Target Amount</label>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-sm text-[#6b7280]">₹</span>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={goal.targetAmount}
                      onChange={(e) =>
                        updateGoal(goal.id, { targetAmount: Number(e.target.value) })
                      }
                      className="w-full rounded-lg border border-[#dde3ea] bg-white px-2.5 py-1.5 text-sm text-[#1c2333] outline-none focus:border-[#1f4693]/60"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-[#6b7280]">Timeframe (years)</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={goal.years}
                    onChange={(e) => updateGoal(goal.id, { years: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-[#dde3ea] bg-white px-2.5 py-1.5 text-sm text-[#1c2333] outline-none focus:border-[#1f4693]/60"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#6b7280]">Expected Return (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={25}
                    step={0.5}
                    value={goal.annualReturn}
                    onChange={(e) =>
                      updateGoal(goal.id, { annualReturn: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded-lg border border-[#dde3ea] bg-white px-2.5 py-1.5 text-sm text-[#1c2333] outline-none focus:border-[#1f4693]/60"
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-[#f0f1f4] pt-3">
                <p className="text-sm text-[#6b7280]">
                  Set aside{" "}
                  <span className="font-bold text-[#1f4693]">{fmt(goal.requiredMonthly)}</span>
                  /month
                </p>
                <p className="text-xs text-[#9ca3af]">
                  Total contributed {fmt(goal.breakdown.investedAmount)} · Growth{" "}
                  {fmt(goal.breakdown.estimatedReturns)}
                </p>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addGoal}
            className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#e3e8ee] bg-white/50 py-4 text-sm font-semibold text-[#1f4693] transition-colors hover:border-[#1f4693]/30 hover:bg-[#1f4693]/5"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Another Goal
          </button>
        </div>

        {/* Combined summary */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ResultCard label="Total Monthly Commitment" value={fmt(totalMonthly)} size="lg" />
          <ResultCard
            label={monthlyIncome > 0 ? "Share of Monthly Income" : "Number of Goals"}
            value={monthlyIncome > 0 ? `${incomePercent.toFixed(0)}%` : `${results.length}`}
            accent={incomePercent > 50 ? "#dc2626" : "#d9a441"}
          />
        </div>

        {monthlyIncome > 0 && incomePercent > 50 && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#f0d9a8] bg-[#fdf6e8] p-4">
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-[#d9a441]" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-[#7a5c1e]">
              These goals together call for more than half your monthly
              income. Consider stretching timeframes, lowering targets, or
              re-prioritizing which goals to fund first.
            </p>
          </div>
        )}

        <div className="mt-6">
          <Disclaimer />
        </div>
      </div>
    </section>
  );
}

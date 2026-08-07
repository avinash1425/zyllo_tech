// RETIRED / UNUSED as of Aug 2026: see the retirement note at the top of
// CurrencyContext.js in this same directory. Nothing in the app imports
// this file anymore.

"use client";

import { CURRENCIES, useCurrency } from "./CurrencyContext";

export default function CurrencySelector() {
  const { currency, setCurrencyCode } = useCurrency();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-[#4b5563]">
      Currency
      <select
        value={currency.code}
        onChange={(e) => setCurrencyCode(e.target.value)}
        className="rounded-lg border border-[#dde3ea] bg-white px-2.5 py-1.5 text-sm font-medium text-[#1c2333] outline-none focus:border-[#1f4693]/60"
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.symbol} {c.code}
          </option>
        ))}
      </select>
    </label>
  );
}

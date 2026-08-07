// RETIRED / UNUSED as of Aug 2026: ArthaAI's calculator suite was reverted
// back to India-only framing (₹/INR hardcoded via formatINR() in
// src/lib/arthaai-calculations.js). Nothing in the app imports this file
// anymore. Left in place for reference only — do NOT wire this back into a
// page without confirming multi-currency support is actually wanted again.

"use client";

import { createContext, useContext, useMemo, useState } from "react";

export const CURRENCIES = [
  { code: "USD", symbol: "$", label: "US Dollar", locale: "en-US" },
  { code: "EUR", symbol: "€", label: "Euro", locale: "de-DE" },
  { code: "GBP", symbol: "£", label: "British Pound", locale: "en-GB" },
  { code: "INR", symbol: "₹", label: "Indian Rupee", locale: "en-IN" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar", locale: "en-AU" },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar", locale: "en-CA" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar", locale: "en-SG" },
  { code: "AED", symbol: "AED", label: "UAE Dirham", locale: "en-AE" },
];

const DEFAULT_CURRENCY = CURRENCIES[0]; // USD

const CurrencyContext = createContext({
  currency: DEFAULT_CURRENCY,
  setCurrencyCode: () => {},
});

export function CurrencyProvider({ children }) {
  const [code, setCode] = useState(DEFAULT_CURRENCY.code);

  const value = useMemo(() => {
    const currency = CURRENCIES.find((c) => c.code === code) ?? DEFAULT_CURRENCY;
    return { currency, setCurrencyCode: setCode };
  }, [code]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  return useContext(CurrencyContext);
}

/**
 * Formats a number using the given currency's own locale grouping (e.g.
 * INR uses lakh/crore grouping via en-IN, everything else uses standard
 * thousands grouping) — no currency conversion, this only changes how the
 * same numeric input is labeled and grouped.
 */
export function formatCurrency(value, currency, options = {}) {
  const { decimals = 0 } = options;
  if (!Number.isFinite(value)) return `${currency.symbol}0`;
  try {
    return new Intl.NumberFormat(currency.locale, {
      style: "currency",
      currency: currency.code,
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(value);
  } catch {
    // Fallback for currency codes Intl might not format natively (e.g. AED
    // in some environments) — manual symbol + grouped number.
    return `${currency.symbol}${value.toLocaleString(currency.locale, {
      maximumFractionDigits: decimals,
    })}`;
  }
}

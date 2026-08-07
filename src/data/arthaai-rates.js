// ArthaAI reference financial rates — FY 2026-27 (AY 2027-28), India only.
//
// SOURCED AND VERIFIED (Aug 2026): The Income Tax Act 2025 took effect
// 1 April 2026, replacing the 1961 Act, but explicitly carried forward the
// same slabs, rates, and deduction limits set in Budget 2025 — no changes
// were announced in Budget 2026. Small savings scheme rates below are the
// government's official quarterly rates (unchanged for 9 straight quarters
// as of the July–Sept 2026 quarter).
//
// IMPORTANT — THESE NUMBERS CHANGE:
// - Small savings rates (PPF, NSC, SSY, etc.) are reset quarterly by the
//   Finance Ministry. Re-verify each quarter.
// - Tax slabs/deduction limits typically only change at the annual Union
//   Budget (usually presented ~Feb 1). Re-verify after every Budget.
// - Bank FD rates vary by bank and change with RBI repo rate moves; the
//   figures here are working *defaults* for the calculator, not live rates
//   — the calculator lets the user override them.
//
// Do not silently change these values without updating the sourcing note
// above and re-verifying against an official/authoritative source.

export const TAX_RATES_FY_2026_27 = {
  label: "FY 2026-27 (AY 2027-28)",

  // Old regime — deduction limits (₹)
  oldRegime: {
    section80C: 150000, // 80C + 80CCC + 80CCD(1) combined cap
    section80D: {
      self: 25000, // self + family, non-senior
      selfSenior: 50000, // self senior citizen
      parents: 25000, // parents, non-senior
      parentsSenior: 50000, // parents senior citizen
    },
    section80CCD1B: 50000, // additional NPS-only deduction, on top of 80C cap
    standardDeduction: 50000,
    slabs: [
      { upTo: 250000, rate: 0 },
      { upTo: 500000, rate: 0.05 },
      { upTo: 1000000, rate: 0.2 },
      { upTo: Infinity, rate: 0.3 },
    ],
    rebate87A: { thresholdIncome: 500000, maxRebate: 12500 },
  },

  // New regime (default since FY 2025-26) — no 80C/80D deductions for own
  // contributions, but standard deduction and 80CCD(2) employer NPS still
  // apply.
  newRegime: {
    standardDeduction: 75000,
    section80CCD2EmployerNps: true, // employer NPS contribution still deductible
    slabs: [
      { upTo: 400000, rate: 0 },
      { upTo: 800000, rate: 0.05 },
      { upTo: 1200000, rate: 0.1 },
      { upTo: 1600000, rate: 0.15 },
      { upTo: 2000000, rate: 0.2 },
      { upTo: 2400000, rate: 0.25 },
      { upTo: Infinity, rate: 0.3 },
    ],
    rebate87A: { thresholdIncome: 1200000, maxRebate: 60000 },
  },

  cessRate: 0.04, // Health & Education Cess, applies on top of tax + surcharge in both regimes
};

// Small savings scheme rates — govt-set, reviewed quarterly.
// Current as of Jul–Sep 2026 quarter.
export const SMALL_SAVINGS_RATES = {
  quarterLabel: "Jul–Sep 2026",
  ppf: 0.071, // Public Provident Fund
  nsc: 0.077, // National Savings Certificate
  ssy: 0.082, // Sukanya Samriddhi Yojana
  kvp: { rate: 0.075, maturityMonths: 115 }, // Kisan Vikas Patra
  postOfficeTd3yr: 0.071, // 3-year post office time deposit
  postOfficeSavings: 0.04,
};

// Default working rates for the FD/RD calculator — user-editable in the UI.
// These are *typical* market rates, not live bank rates (the calculator is
// not a live-rate aggregator).
export const DEFAULT_BANK_RATES = {
  fdGeneral: 0.0665, // ~mid-point of major bank general FD rates, 3-5yr tenure
  fdSeniorCitizen: 0.0715, // general + typical 0.5% senior premium
  rdGeneral: 0.065,
};

// NPS is market-linked (equity + debt mix), not a fixed-rate scheme. This
// is a long-run *illustrative* assumption for projections only — actual
// returns vary with market performance and the chosen asset allocation.
export const NPS_ASSUMED_RETURN = 0.1; // 10% p.a., illustrative long-term average

export const NPS_DEDUCTION_INFO = {
  section80CCD1: { capPercentOfSalary: 0.1, sharesCapWith80C: true },
  section80CCD1B: 50000,
  section80CCD2: { capPercentOfSalary: 0.1, capPercentGovtEmployee: 0.14 },
};

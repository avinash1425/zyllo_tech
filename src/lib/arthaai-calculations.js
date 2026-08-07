// Pure financial calculation functions for ArthaAI's calculator suite.
// Kept separate from UI components so the math can be reasoned about (and
// spot-checked) independently of any rendering code.

/**
 * Standard loan EMI formula: EMI = P * r * (1+r)^n / ((1+r)^n - 1)
 * where r is the monthly interest rate and n is the number of months.
 */
export function calculateEMI(principal, annualRatePercent, tenureMonths) {
  if (principal <= 0 || tenureMonths <= 0) {
    return { emi: 0, totalPayment: 0, totalInterest: 0, schedule: [] };
  }

  const monthlyRate = annualRatePercent / 12 / 100;

  let emi;
  if (monthlyRate === 0) {
    emi = principal / tenureMonths;
  } else {
    const factor = Math.pow(1 + monthlyRate, tenureMonths);
    emi = (principal * monthlyRate * factor) / (factor - 1);
  }

  const totalPayment = emi * tenureMonths;
  const totalInterest = totalPayment - principal;

  // Year-by-year amortization summary (principal vs interest paid that year).
  const schedule = [];
  let balance = principal;
  let yearPrincipal = 0;
  let yearInterest = 0;

  for (let month = 1; month <= tenureMonths; month++) {
    const interestPortion = monthlyRate === 0 ? 0 : balance * monthlyRate;
    const principalPortion = emi - interestPortion;
    balance = Math.max(0, balance - principalPortion);
    yearPrincipal += principalPortion;
    yearInterest += interestPortion;

    if (month % 12 === 0 || month === tenureMonths) {
      schedule.push({
        year: Math.ceil(month / 12),
        principalPaid: yearPrincipal,
        interestPaid: yearInterest,
        balance,
      });
      yearPrincipal = 0;
      yearInterest = 0;
    }
  }

  return { emi, totalPayment, totalInterest, schedule };
}

/**
 * Reverse of calculateEMI: given a monthly payment budget, annual rate,
 * and tenure, solves for the maximum loan principal that budget can
 * service. Derived directly from the EMI formula solved for P:
 * P = EMI * ((1+r)^n - 1) / (r * (1+r)^n)
 */
export function calculateMaxLoanFromEMI(affordableMonthlyEMI, annualRatePercent, tenureMonths) {
  if (affordableMonthlyEMI <= 0 || tenureMonths <= 0) return 0;

  const monthlyRate = annualRatePercent / 12 / 100;
  if (monthlyRate === 0) return affordableMonthlyEMI * tenureMonths;

  const factor = Math.pow(1 + monthlyRate, tenureMonths);
  return (affordableMonthlyEMI * (factor - 1)) / (monthlyRate * factor);
}

/**
 * Home loan eligibility estimate. Lenders typically cap total monthly
 * debt obligations (existing EMIs + the new loan's EMI) at a percentage
 * of gross monthly income — commonly referred to as a debt-to-income
 * (DTI) ratio, though the exact cap varies significantly by lender and
 * country (40-50% is a common illustrative range). This gives a rough,
 * illustrative eligibility estimate, NOT a lending decision.
 */
export function estimateLoanEligibility({
  monthlyIncome,
  existingMonthlyDebts,
  maxDtiPercent,
  annualRatePercent,
  tenureYears,
}) {
  const maxTotalDebtPayment = monthlyIncome * (maxDtiPercent / 100);
  const affordableNewEMI = Math.max(0, maxTotalDebtPayment - existingMonthlyDebts);
  const maxLoanAmount = calculateMaxLoanFromEMI(
    affordableNewEMI,
    annualRatePercent,
    tenureYears * 12
  );

  return {
    maxTotalDebtPayment,
    affordableNewEMI,
    maxLoanAmount,
  };
}

/**
 * Reverse of calculateSIP: given a target future value, expected return,
 * and time horizon, solves for the required monthly contribution.
 * Derived from the SIP annuity-due formula solved for the payment P:
 * P = FV / ( [((1+i)^n - 1) / i] * (1+i) )
 */
export function calculateRequiredMonthlyContribution(targetAmount, annualReturnPercent, years) {
  const months = years * 12;
  const monthlyRate = annualReturnPercent / 12 / 100;

  if (targetAmount <= 0 || months <= 0) return 0;
  if (monthlyRate === 0) return targetAmount / months;

  const growthFactor = ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate);
  return targetAmount / growthFactor;
}

/**
 * SIP future value using the standard monthly-compounding annuity-due
 * formula (investment made at the start of each month, common convention
 * for Indian SIP projections):
 * FV = P * [((1+i)^n - 1) / i] * (1+i)
 * where i is the monthly rate and n is the number of months.
 */
export function calculateSIP(monthlyAmount, annualReturnPercent, years) {
  const months = years * 12;
  const monthlyRate = annualReturnPercent / 12 / 100;

  if (monthlyAmount <= 0 || months <= 0) {
    return { futureValue: 0, investedAmount: 0, estimatedReturns: 0 };
  }

  let futureValue;
  if (monthlyRate === 0) {
    futureValue = monthlyAmount * months;
  } else {
    futureValue =
      monthlyAmount *
      ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) *
      (1 + monthlyRate);
  }

  const investedAmount = monthlyAmount * months;
  const estimatedReturns = futureValue - investedAmount;

  return { futureValue, investedAmount, estimatedReturns };
}

/**
 * Lumpsum future value: FV = P * (1 + r)^n, compounded annually.
 */
export function calculateLumpsum(principal, annualReturnPercent, years) {
  if (principal <= 0 || years <= 0) {
    return { futureValue: 0, investedAmount: 0, estimatedReturns: 0 };
  }
  const futureValue = principal * Math.pow(1 + annualReturnPercent / 100, years);
  return {
    futureValue,
    investedAmount: principal,
    estimatedReturns: futureValue - principal,
  };
}

/** Adjusts a future nominal value to today's purchasing power. */
export function inflationAdjust(futureValue, inflationRatePercent, years) {
  return futureValue / Math.pow(1 + inflationRatePercent / 100, years);
}

/**
 * Compound interest maturity value for FD/PPF/NSC-style annual-compounding
 * instruments: A = P * (1 + r/n)^(n*t)
 */
export function calculateCompoundMaturity(
  principal,
  annualRatePercent,
  years,
  compoundingPerYear = 4 // quarterly is standard for Indian bank FDs
) {
  if (principal <= 0 || years <= 0) return { maturityValue: principal, interestEarned: 0 };
  const n = compoundingPerYear;
  const r = annualRatePercent / 100;
  const maturityValue = principal * Math.pow(1 + r / n, n * years);
  return { maturityValue, interestEarned: maturityValue - principal };
}

/**
 * RD (Recurring Deposit) maturity — each monthly deposit compounds
 * quarterly for its own remaining tenure. Uses the standard bank RD
 * formula summed per installment.
 */
export function calculateRDMaturity(monthlyAmount, annualRatePercent, months) {
  if (monthlyAmount <= 0 || months <= 0) {
    return { maturityValue: 0, investedAmount: 0, interestEarned: 0 };
  }
  const quarterlyRate = annualRatePercent / 100 / 4;
  let maturityValue = 0;

  for (let i = 1; i <= months; i++) {
    const remainingMonths = months - i + 1;
    const remainingQuarters = remainingMonths / 3;
    maturityValue += monthlyAmount * Math.pow(1 + quarterlyRate, remainingQuarters);
  }

  const investedAmount = monthlyAmount * months;
  return { maturityValue, investedAmount, interestEarned: maturityValue - investedAmount };
}

/**
 * PPF maturity — annual compounding, contribution made at the start of
 * each year (standard PPF calculator convention).
 */
export function calculatePPFMaturity(annualContribution, ratePercent, years) {
  if (annualContribution <= 0 || years <= 0) {
    return { maturityValue: 0, investedAmount: 0, interestEarned: 0 };
  }
  const r = ratePercent / 100;
  let balance = 0;
  for (let year = 1; year <= years; year++) {
    balance = (balance + annualContribution) * (1 + r);
  }
  const investedAmount = annualContribution * years;
  return { maturityValue: balance, investedAmount, interestEarned: balance - investedAmount };
}

/**
 * Progressive slab-wise income tax calculation given a slab table
 * (array of { upTo, rate }, cumulative thresholds) and taxable income.
 */
export function calculateSlabTax(taxableIncome, slabs) {
  let tax = 0;
  let lastThreshold = 0;

  for (const slab of slabs) {
    if (taxableIncome <= lastThreshold) break;
    const slabTop = Math.min(taxableIncome, slab.upTo);
    const slabAmount = Math.max(0, slabTop - lastThreshold);
    tax += slabAmount * slab.rate;
    lastThreshold = slab.upTo;
  }

  return tax;
}

/**
 * Generic progressive-bracket tax estimate — works for any country's
 * bracket structure, since it takes the brackets as plain input rather
 * than assuming any specific country's tax code. Returns total tax,
 * effective (average) rate, and marginal (top-bracket-reached) rate.
 */
export function estimateBracketTax({ grossIncome, deductions = 0, brackets }) {
  const taxableIncome = Math.max(0, grossIncome - deductions);
  const tax = calculateSlabTax(taxableIncome, brackets);

  const effectiveRate = taxableIncome > 0 ? tax / taxableIncome : 0;

  let marginalRate = 0;
  for (const bracket of brackets) {
    if (taxableIncome > 0 && taxableIncome <= bracket.upTo) {
      marginalRate = bracket.rate;
      break;
    }
    marginalRate = bracket.rate;
  }

  return {
    taxableIncome,
    tax,
    afterTaxIncome: grossIncome - tax,
    effectiveRate,
    marginalRate,
  };
}

/**
 * Full old-vs-new regime comparison given gross income and old-regime
 * deductions claimed. Applies standard deduction, slab tax, Section 87A
 * rebate, and 4% health & education cess in both regimes.
 *
 * NOTE: This function is India-specific (Old vs New regime is an Indian
 * tax-code concept) and is kept only for backward compatibility. The
 * Tax Savings calculator UI now uses the generic estimateBracketTax()
 * above instead.
 */
export function compareTaxRegimes({ grossIncome, oldRegimeDeductions, rates }) {
  const { oldRegime, newRegime, cessRate } = rates;

  // Old regime
  const oldTaxableIncome = Math.max(
    0,
    grossIncome - oldRegime.standardDeduction - oldRegimeDeductions
  );
  let oldTax = calculateSlabTax(oldTaxableIncome, oldRegime.slabs);
  if (oldTaxableIncome <= oldRegime.rebate87A.thresholdIncome) {
    oldTax = Math.max(0, oldTax - oldRegime.rebate87A.maxRebate);
  }
  const oldCess = oldTax * cessRate;
  const oldTotalTax = oldTax + oldCess;

  // New regime — standard deduction only, no 80C/80D on own contributions
  const newTaxableIncome = Math.max(0, grossIncome - newRegime.standardDeduction);
  let newTax = calculateSlabTax(newTaxableIncome, newRegime.slabs);
  if (newTaxableIncome <= newRegime.rebate87A.thresholdIncome) {
    newTax = Math.max(0, newTax - newRegime.rebate87A.maxRebate);
  }
  const newCess = newTax * cessRate;
  const newTotalTax = newTax + newCess;

  return {
    oldRegime: { taxableIncome: oldTaxableIncome, tax: oldTax, cess: oldCess, totalTax: oldTotalTax },
    newRegime: { taxableIncome: newTaxableIncome, tax: newTax, cess: newCess, totalTax: newTotalTax },
    betterRegime: oldTotalTax <= newTotalTax ? "old" : "new",
    savings: Math.abs(oldTotalTax - newTotalTax),
  };
}

/**
 * Simplified rent-vs-buy comparison over a fixed horizon. Compares total
 * cost of renting (with annual rent escalation) vs. buying (down payment +
 * EMI + maintenance, minus the eventual home equity built), against the
 * opportunity cost of investing the money that renting would have freed up.
 * This is a decision-support estimate, not a precise financial model —
 * real decisions depend on many factors (tax benefits, transaction costs,
 * personal circumstances) not captured here.
 */
export function compareRentVsBuy({
  homePrice,
  downPaymentPercent,
  loanRatePercent,
  loanTenureYears,
  monthlyRent,
  rentEscalationPercent,
  homeAppreciationPercent,
  investmentReturnPercent,
  horizonYears,
  maintenancePercentOfPrice = 0.01,
}) {
  const downPayment = homePrice * (downPaymentPercent / 100);
  const loanAmount = homePrice - downPayment;
  const { emi } = calculateEMI(loanAmount, loanRatePercent, loanTenureYears * 12);
  const annualMaintenance = homePrice * maintenancePercentOfPrice;

  let totalBuyingCost = downPayment;
  let totalRentPaid = 0;
  let rentInvestmentValue = 0; // if renting, invest the EMI-vs-rent difference
  let currentRent = monthlyRent;

  const horizonMonths = horizonYears * 12;
  const monthlyInvestReturn = investmentReturnPercent / 12 / 100;

  for (let month = 1; month <= horizonMonths; month++) {
    if (month % 12 === 1 && month > 1) {
      currentRent *= 1 + rentEscalationPercent / 100;
    }
    totalRentPaid += currentRent;

    const monthlyBuyingOutflow = emi + annualMaintenance / 12;
    const monthlyRentingOutflow = currentRent;
    const investableDifference = Math.max(0, monthlyBuyingOutflow - monthlyRentingOutflow);

    rentInvestmentValue =
      (rentInvestmentValue + investableDifference) * (1 + monthlyInvestReturn);
  }

  totalBuyingCost += emi * Math.min(horizonMonths, loanTenureYears * 12) + annualMaintenance * horizonYears;

  const homeFutureValue = homePrice * Math.pow(1 + homeAppreciationPercent / 100, horizonYears);
  const netBuyingCost = totalBuyingCost - homeFutureValue;
  const netRentingCost = totalRentPaid - rentInvestmentValue;

  return {
    emi,
    downPayment,
    totalBuyingOutflow: totalBuyingCost,
    homeFutureValue,
    netBuyingCost,
    totalRentPaid,
    rentInvestmentValue,
    netRentingCost,
    recommendation: netBuyingCost <= netRentingCost ? "buy" : "rent",
    difference: Math.abs(netBuyingCost - netRentingCost),
  };
}

/** Formats a number as Indian Rupees with lakh/crore grouping. */
export function formatINR(value, options = {}) {
  const { decimals = 0 } = options;
  if (!Number.isFinite(value)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value);
}

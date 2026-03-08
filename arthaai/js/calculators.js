/**
 * ArthaAI — calculators.js (v2 — Fixed & Enhanced)
 * Full calculator logic for ArthaCalc module:
 *   1. EMI Calculator
 *   2. SIP / Lumpsum Calculator
 *   3. Tax Savings (Old vs New Regime — FY 2025-26)
 *   4. FD / PPF / NPS / RD Comparator
 *   5. Retirement Corpus Planner
 *   6. Rent vs Buy Analyser
 * Zyllo Tech Software Solutions Pvt Ltd
 */

'use strict';

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
const $ = (id) => document.getElementById(id);
const num = (id) => parseFloat($(id)?.value) || 0;
const html = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };
const setV = (id, v) => { const el = $(id); if (el) el.value = v; };
const show = (id) => {
  const el = $(id);
  if (el) {
    el.style.display = '';
    el.style.opacity = '0';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .4s ease';
      el.style.opacity = '1';
    });
  }
};

/* ══════════════════════════════════════
   1. EMI CALCULATOR
══════════════════════════════════════ */
window.calculateEMI = function () {
  const P = num('emi-principal') || 3000000;
  const annualRate = num('emi-rate') || 8.5;
  const r = annualRate / 100 / 12;
  const tenureYears = num('emi-tenure') || 20;
  const n = tenureYears * 12;

  // Auto-fill months
  setV('emi-tenure-months', n);

  if (P <= 0 || r <= 0 || n <= 0) return;

  const emi = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  const total = emi * n;
  const interest = total - P;
  const principalPct = Math.round((P / total) * 100);
  const interestPct = 100 - principalPct;

  html('emi-monthly', formatINR(emi, 0));
  html('emi-total-interest', formatINR(interest, 0));
  html('emi-total-amount', formatINR(total, 0));
  html('emi-principal-display', formatINR(P, 0));
  html('emi-interest-pct', interestPct + '%');

  // Update SVG donut circles
  const C = 2 * Math.PI * 60; // circumference, r=60
  const interestArc = C * (interestPct / 100);
  const principalArc = C * (principalPct / 100);
  const intCircle = $('emi-donut-interest');
  const priCircle = $('emi-donut-principal');
  if (intCircle) {
    intCircle.setAttribute('stroke-dasharray', `${interestArc} ${C}`);
    intCircle.setAttribute('stroke-dashoffset', '0');
  }
  if (priCircle) {
    priCircle.setAttribute('stroke-dasharray', `${principalArc} ${C}`);
    priCircle.setAttribute('stroke-dashoffset', `-${interestArc}`);
  }

  // Yearly breakdown table
  buildEMITable(P, r, n, emi);
  show('emi-result');
};

function buildEMITable(P, r, n, emi) {
  const tbody = $('emi-breakdown-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  let balance = P;
  for (let yr = 1; yr <= Math.ceil(n / 12); yr++) {
    const months = Math.min(12, n - (yr - 1) * 12);
    let yrPri = 0, yrInt = 0;
    for (let m = 0; m < months; m++) {
      const intPart = balance * r;
      const priPart = emi - intPart;
      yrInt += intPart;
      yrPri += priPart;
      balance -= priPart;
    }
    tbody.innerHTML += `<tr>
      <td>Year ${yr}</td>
      <td>${formatINR(yrPri, 0)}</td>
      <td>${formatINR(yrInt, 0)}</td>
      <td>${formatINR(Math.max(balance, 0), 0)}</td>
    </tr>`;
  }
}

/* EMI Loan presets */
window.setLoanPreset = function (type) {
  document.querySelectorAll('.tag-pill[data-preset]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-preset') === type)
  );
  const presets = {
    home:      { principal: 3000000, rate: 8.5, tenure: 20 },
    car:       { principal: 700000,  rate: 9.0, tenure: 5  },
    personal:  { principal: 300000,  rate: 12.0, tenure: 3  },
    education: { principal: 1000000, rate: 10.5, tenure: 7  },
  };
  const p = presets[type];
  if (!p) return;
  setV('emi-principal', p.principal);
  setV('emi-rate', p.rate);
  setV('emi-rate-range', p.rate);
  setV('emi-tenure', p.tenure);
  setV('emi-tenure-range', p.tenure);
  setV('emi-tenure-months', p.tenure * 12);
  calculateEMI();
};

/* ══════════════════════════════════════
   2. SIP / LUMPSUM CALCULATOR
══════════════════════════════════════ */
window.toggleSIPMode = function (mode) {
  document.querySelectorAll('.tag-pill[data-mode]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-mode') === mode)
  );
  const label = $('sip-amount-label');
  if (label) label.textContent = mode === 'lumpsum' ? 'Lumpsum Amount' : 'Monthly SIP Amount';
  // Show/hide step-up row for lumpsum mode
  const stepRow = $('sip-stepup');
  if (stepRow) stepRow.closest('.form-group').style.display = mode === 'lumpsum' ? 'none' : '';
  calculateSIP();
};

window.calculateSIP = function () {
  const modeBtn = document.querySelector('.tag-pill[data-mode].active');
  const mode = modeBtn?.getAttribute('data-mode') || 'sip';
  const amount = num('sip-amount') || 5000;
  const rate = num('sip-return') || 12;
  const years = num('sip-period') || 10;
  const stepUp = num('sip-stepup') || 0;
  const r = rate / 100;
  const rMonthly = r / 12;

  let invested, total;

  if (mode === 'lumpsum') {
    total = amount * Math.pow(1 + r, years);
    invested = amount;
  } else if (stepUp > 0) {
    // Step-up SIP: increase monthly SIP by stepUp% every year
    let corpus = 0, monthlyAmt = amount, inv = 0;
    for (let yr = 0; yr < years; yr++) {
      if (yr > 0) monthlyAmt *= (1 + stepUp / 100);
      for (let m = 0; m < 12; m++) {
        corpus = (corpus + monthlyAmt) * (1 + rMonthly);
        inv += monthlyAmt;
      }
    }
    invested = inv;
    total = corpus;
  } else {
    // Regular SIP formula
    const n = years * 12;
    total = amount * ((Math.pow(1 + rMonthly, n) - 1) / rMonthly) * (1 + rMonthly);
    invested = amount * n;
  }

  const gains = total - invested;
  const xirr = invested > 0
    ? ((Math.pow(total / invested, 1 / years) - 1) * 100).toFixed(1)
    : '0';

  html('sip-maturity', formatINR(total, 0));
  html('sip-maturity-sub',
    `In ${years} years · ${mode === 'lumpsum' ? formatINR(amount, 0) + ' lumpsum' : formatINR(amount, 0) + '/month'}${stepUp > 0 ? ' with ' + stepUp + '% step-up' : ''} at ${rate}%`
  );
  html('sip-invested', formatINR(invested, 0));
  html('sip-gains', formatINR(gains, 0));
  html('sip-cagr', xirr + '%');

  // Year-wise growth bars
  buildSIPBars(mode, amount, r, years, stepUp);
  show('sip-result');
};

function buildSIPBars(mode, amount, r, years, stepUp) {
  const container = $('sip-year-bars');
  if (!container) return;
  container.innerHTML = '';
  const rMonthly = r / 12;

  const yearVals = [];
  let maxVal = 0;
  for (let yr = 1; yr <= years; yr++) {
    let v, inv;
    if (mode === 'lumpsum') {
      v = amount * Math.pow(1 + r, yr);
      inv = amount;
    } else if (stepUp > 0) {
      let corpus = 0, mAmt = amount, invA = 0;
      for (let y = 0; y < yr; y++) {
        if (y > 0) mAmt *= (1 + stepUp / 100);
        for (let m = 0; m < 12; m++) { corpus = (corpus + mAmt) * (1 + rMonthly); invA += mAmt; }
      }
      v = corpus; inv = invA;
    } else {
      const n = yr * 12;
      v = amount * ((Math.pow(1 + rMonthly, n) - 1) / rMonthly) * (1 + rMonthly);
      inv = amount * n;
    }
    yearVals.push({ year: yr, val: v, inv });
    if (v > maxVal) maxVal = v;
  }

  const step = years > 15 ? 3 : years > 10 ? 2 : 1;
  yearVals.forEach(({ year, val, inv }) => {
    if (year % step !== 0 && year !== years) return;
    const pct = Math.round((val / maxVal) * 100);
    container.innerHTML += `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
        <span style="min-width:32px; font-size:.75rem; color:rgba(255,255,255,.6); text-align:right;">Y${year}</span>
        <div style="flex:1; height:8px; background:rgba(255,255,255,.12); border-radius:4px; overflow:hidden;">
          <div style="width:${pct}%; height:100%; background:var(--og); border-radius:4px; transition:width .5s;"></div>
        </div>
        <span style="min-width:80px; text-align:right; font-size:.75rem; font-weight:600; color:rgba(255,255,255,.85);">${formatINRShort(val)}</span>
      </div>`;
  });
}

/* ══════════════════════════════════════
   3. TAX SAVINGS CALCULATOR
   Updated for FY 2025-26 slabs
══════════════════════════════════════ */
window.calculateTax = function () {
  const income = num('tax-income') || 1200000;
  const c80c = Math.min(num('tax-80c') || 0, 150000);
  const c80d = Math.min(num('tax-80d') || 0, 100000);
  const nps80ccd = Math.min(num('tax-nps') || 0, 50000);
  const hra = num('tax-hra') || 0;
  const empType = $('tax-type')?.value || 'salaried';

  /* ── OLD REGIME ── */
  const oldStdDedn = empType === 'salaried' ? 50000 : 0;
  const oldDeductions = oldStdDedn + c80c + c80d + nps80ccd + hra;
  const oldTaxable = Math.max(0, income - oldDeductions);

  let oldTax = 0;
  if (oldTaxable > 1000000) oldTax += (oldTaxable - 1000000) * 0.30;
  if (oldTaxable > 500000)  oldTax += (Math.min(oldTaxable, 1000000) - 500000) * 0.20;
  if (oldTaxable > 250000)  oldTax += (Math.min(oldTaxable, 500000)  - 250000) * 0.05;
  // 87A rebate (old regime): up to ₹5L taxable → zero tax
  const oldFinal = oldTaxable <= 500000 ? 0 : Math.round(oldTax * 1.04);

  /* ── NEW REGIME (FY 2025-26) ── */
  const newStdDedn = empType === 'salaried' ? 75000 : 0;
  const newTaxable = Math.max(0, income - newStdDedn);

  let newTax = 0;
  if (newTaxable > 2400000) newTax += (newTaxable - 2400000) * 0.30;
  if (newTaxable > 2000000) newTax += (Math.min(newTaxable, 2400000) - 2000000) * 0.25;
  if (newTaxable > 1600000) newTax += (Math.min(newTaxable, 2000000) - 1600000) * 0.20;
  if (newTaxable > 1200000) newTax += (Math.min(newTaxable, 1600000) - 1200000) * 0.15;
  if (newTaxable > 800000)  newTax += (Math.min(newTaxable, 1200000) - 800000)  * 0.10;
  if (newTaxable > 400000)  newTax += (Math.min(newTaxable, 800000)  - 400000)  * 0.05;
  // 87A rebate (new regime FY 2025-26): up to ₹12L taxable → zero tax
  const newFinal = newTaxable <= 1200000 ? 0 : Math.round(newTax * 1.04);

  const saving = Math.abs(oldFinal - newFinal);
  const winner = newFinal <= oldFinal ? 'New Regime' : 'Old Regime';

  html('tax-saved', formatINR(saving, 0));
  html('tax-saved-sub', `${winner} saves you ${formatINR(saving, 0)}`);
  html('tax-old', formatINR(oldFinal, 0));
  html('tax-new', formatINR(newFinal, 0));

  // Deductions breakdown table
  const tbody = $('tax-breakdown-body');
  if (tbody) {
    const items = [
      ['Standard Deduction', oldStdDedn, '₹50K (Old) / ₹75K (New)'],
      ['80C Investments', c80c, 'ELSS · PPF · EPF · LIC · Home Loan'],
      ['80D Health Insurance', c80d, 'Self ₹25K + Parents ₹50K (Sr Citizen)'],
      ['80CCD(1B) NPS', nps80ccd, 'Additional ₹50K over 80C'],
      ['HRA Exemption', hra, 'Actual HRA exempt amount'],
    ].filter(i => i[1] > 0);

    tbody.innerHTML = items.map(([name, amt, note]) =>
      `<tr><td>${name}</td><td>${formatINR(amt, 0)}</td><td style="font-size:.8rem; opacity:.75">${note}</td></tr>`
    ).join('') +
    `<tr style="font-weight:700; background:rgba(255,255,255,.08)">
       <td colspan="2" style="color:#22c55e">✅ ${winner} → Tax: ${formatINR(Math.min(oldFinal, newFinal), 0)}</td>
       <td style="font-size:.8rem">Includes 4% HE Cess</td>
     </tr>`;
  }

  show('tax-result');
};

/* ══════════════════════════════════════
   4. FD / PPF / NPS / RD COMPARATOR
══════════════════════════════════════ */
window.calculateFD = function () {
  const typeBtn = document.querySelector('.tag-pill[data-fdtype].active');
  const type = typeBtn?.getAttribute('data-fdtype') || 'fd';
  const principal = num('fd-amount') || 100000;
  const rate = num('fd-rate') || 7;
  const years = num('fd-period') || 5;
  const freq = parseInt($('fd-compound')?.value || '4');

  let maturity, interest, effectiveRate;

  switch (type) {
    case 'fd': {
      maturity = principal * Math.pow(1 + rate / 100 / freq, freq * years);
      interest = maturity - principal;
      effectiveRate = (Math.pow(1 + rate / 100 / freq, freq) - 1) * 100;
      break;
    }
    case 'ppf': {
      const annualCap = 150000;
      const yearlyInvest = Math.min(principal, annualCap);
      let corpus = 0;
      for (let yr = 0; yr < years; yr++) corpus = (corpus + yearlyInvest) * (1 + rate / 100);
      maturity = corpus;
      interest = maturity - yearlyInvest * years;
      effectiveRate = rate;
      break;
    }
    case 'rd': {
      const rM = rate / 100 / 12;
      const n = years * 12;
      maturity = principal * ((Math.pow(1 + rM, n) - 1) / rM) * (1 + rM);
      interest = maturity - principal * n;
      effectiveRate = rate;
      break;
    }
    case 'nps': {
      maturity = principal * Math.pow(1 + rate / 100, years);
      interest = maturity - principal;
      effectiveRate = rate;
      break;
    }
    default:
      maturity = principal; interest = 0; effectiveRate = 0;
  }

  html('fd-maturity', formatINR(maturity, 0));
  html('fd-principal-show', type === 'rd' ? formatINR(principal * years * 12, 0) : type === 'ppf' ? formatINR(Math.min(principal, 150000) * years, 0) : formatINR(principal, 0));
  html('fd-interest-show', formatINR(interest, 0));
  html('fd-effective', effectiveRate.toFixed(2) + '%');

  // Show/hide compounding dropdown (only for FD)
  const compGroup = $('fd-compound-group');
  if (compGroup) compGroup.style.display = type === 'fd' ? '' : 'none';

  // Update labels based on type
  const amtLabel = $('fd-amount-label');
  if (amtLabel) {
    const labels = { fd: 'Deposit Amount', ppf: 'Yearly Contribution (max ₹1.5L)', rd: 'Monthly Deposit', nps: 'Lumpsum Investment' };
    amtLabel.textContent = labels[type] || 'Amount';
  }

  show('fd-result');
};

window.setFDType = function (type) {
  document.querySelectorAll('.tag-pill[data-fdtype]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-fdtype') === type)
  );
  calculateFD();
};

/* ══════════════════════════════════════
   5. RETIREMENT CORPUS CALCULATOR
══════════════════════════════════════ */
window.calculateRetirement = function () {
  const currentAge    = num('ret-age')        || 30;
  const retireAge     = num('ret-retire-age') || 60;
  const lifeExp       = num('ret-life')       || 85;
  const monthlyExp    = num('ret-expenses')   || 50000;
  const currentSaving = num('ret-savings')    || 0;
  const inflation     = (num('ret-inflation') || 6) / 100;
  const roi           = (num('ret-roi')       || 12) / 100;
  const postROI       = 0.07; // assumed 7% post-retirement

  const yearsToRetire = retireAge - currentAge;
  const yearsInRetire = lifeExp - retireAge;
  if (yearsToRetire <= 0 || yearsInRetire <= 0) return;

  // Inflation-adjusted future monthly expense
  const futureMonthlyExp = monthlyExp * Math.pow(1 + inflation, yearsToRetire);

  // Required corpus using real rate of return
  const rReal = ((1 + postROI) / (1 + inflation)) - 1;
  let corpusNeeded;
  if (Math.abs(rReal) > 0.001) {
    corpusNeeded = futureMonthlyExp * 12 * ((1 - Math.pow(1 + rReal, -yearsInRetire)) / rReal);
  } else {
    corpusNeeded = futureMonthlyExp * 12 * yearsInRetire;
  }

  // Future value of current savings
  const fvSavings = currentSaving * Math.pow(1 + roi, yearsToRetire);
  const gap = Math.max(0, corpusNeeded - fvSavings);

  // Monthly SIP to fill the gap
  const rMonthly = roi / 12;
  const n = yearsToRetire * 12;
  const monthlySIP = gap > 0
    ? gap * rMonthly / ((Math.pow(1 + rMonthly, n) - 1) * (1 + rMonthly))
    : 0;

  const readiness = Math.min(100, Math.round((fvSavings / Math.max(1, corpusNeeded)) * 100));

  html('ret-corpus', formatINRShort(corpusNeeded));
  html('ret-monthly-need', formatINR(futureMonthlyExp, 0) + '/mo');
  html('ret-years', yearsToRetire + ' yrs');
  html('ret-monthly-sip', formatINR(monthlySIP, 0));

  // Readiness bar
  const fillBar = $('ret-readiness-fill');
  if (fillBar) {
    fillBar.style.width = readiness + '%';
    fillBar.style.background = readiness >= 70 ? '#22c55e' : readiness >= 40 ? '#f59e0b' : '#ef4444';
  }
  const readText = $('ret-readiness-text');
  if (readText) {
    readText.textContent = readiness >= 80
      ? `${readiness}% ready — on track! Maintain your investments.`
      : readiness >= 40
        ? `${readiness}% ready — invest ${formatINR(monthlySIP, 0)}/month to catch up.`
        : `${readiness}% ready — start investing ${formatINR(monthlySIP, 0)}/month now to build your corpus.`;
  }

  show('ret-result');
};

/* ══════════════════════════════════════
   6. RENT vs BUY ANALYSER
══════════════════════════════════════ */
window.calculateRentVsBuy = function () {
  const propPrice   = num('rvb-price')        || 7500000;
  const downPayment = num('rvb-down')         || 1500000;
  const loanRate    = (num('rvb-loan-rate')   || 8.5) / 100;
  const loanYears   = num('rvb-tenure')       || 20;
  const rent        = num('rvb-rent')         || 25000;
  const rentInc     = (num('rvb-rent-inc')    || 5) / 100;
  const appreciation= (num('rvb-appreciation')|| 5) / 100;
  const analysisYrs = 15; // standard 15-year analysis

  const loanAmt = Math.max(0, propPrice - downPayment);
  const rM = loanRate / 12;
  const n = loanYears * 12;
  const emi = rM === 0
    ? loanAmt / Math.max(1, n)
    : loanAmt * rM * Math.pow(1 + rM, n) / (Math.pow(1 + rM, n) - 1);

  // ── BUYING COSTS over analysis period ──
  const emiMonths = Math.min(analysisYrs, loanYears) * 12;
  const totalEMI = emi * emiMonths;
  const maintenancePA = propPrice * 0.01;
  const totalMaint = maintenancePA * analysisYrs;
  const regStampDuty = propPrice * 0.07; // ~7% stamp+registration
  const buyOutflow = downPayment + totalEMI + totalMaint + regStampDuty;
  const futureValue = propPrice * Math.pow(1 + appreciation, analysisYrs);

  // Outstanding balance at analysis end
  const outstandingAfterMonths = (months) => {
    if (rM === 0) return Math.max(0, loanAmt - emi * months);
    const factor = Math.pow(1 + rM, months);
    return Math.max(0, loanAmt * factor - emi * (factor - 1) / rM);
  };
  const outstanding = outstandingAfterMonths(emiMonths);
  const buyNetWorth = futureValue - outstanding;

  // ── RENTING COSTS over analysis period ──
  let totalRent = 0, curRent = rent * 12;
  for (let yr = 0; yr < analysisYrs; yr++) {
    totalRent += curRent;
    curRent *= (1 + rentInc);
  }

  // Opportunity: invest down payment + stamp duty at ~11% equity return
  const investReturn = 0.11;
  let rentCorpus = downPayment + regStampDuty;
  const monthlyInvReturn = investReturn / 12;
  for (let yr = 0; yr < analysisYrs; yr++) {
    const yearlyRent = rent * Math.pow(1 + rentInc, yr) * 12;
    const yearlyBuy = (emi + maintenancePA / 12) * 12;
    const savings = Math.max(0, yearlyBuy - yearlyRent);
    for (let m = 0; m < 12; m++) {
      rentCorpus = rentCorpus * (1 + monthlyInvReturn) + savings / 12;
    }
  }

  const isBuyBetter = buyNetWorth >= rentCorpus;
  const edge = Math.abs(buyNetWorth - rentCorpus);

  html('rvb-winner', isBuyBetter ? '🏠 Buying Looks Better' : '🏢 Renting Looks Better');
  html('rvb-sub', `Over ${analysisYrs} years, better by ~${formatINRShort(edge)}`);
  html('rvb-buy-cost', formatINR(buyOutflow, 0));
  html('rvb-rent-cost', formatINR(totalRent, 0));

  const detail = $('rvb-detail');
  if (detail) {
    detail.innerHTML = `
      <p>📌 <strong>EMI:</strong> ${formatINR(emi, 0)}/month for ${loanYears} years</p>
      <p>📌 <strong>Future Property Value:</strong> ${formatINR(futureValue, 0)}</p>
      <p>📌 <strong>Buy Net Worth:</strong> ${formatINR(buyNetWorth, 0)} (value minus outstanding loan)</p>
      <p>📌 <strong>Rent + Invest Corpus:</strong> ${formatINR(rentCorpus, 0)} (DP + savings invested at ${(investReturn * 100).toFixed(0)}%)</p>
      <p style="margin-top:10px; padding:8px; background:rgba(255,255,255,.08); border-radius:8px;">
        ${isBuyBetter
          ? '<strong style="color:#22c55e">✅ Buying builds equity.</strong> Hold 10+ years for best value.'
          : '<strong style="color:#f59e0b">💡 Renting + Investing wins.</strong> Invest the down payment in equity mutual funds.'}
      </p>
    `;
  }

  show('rvb-result');
};

/* ══════════════════════════════════════
   7. GOLD INVESTMENT CALCULATOR
══════════════════════════════════════ */
let goldMode = 'sip';

window.calculateGold = function () {
  const amount = num('gold-amount') || 5000;
  const years = num('gold-years') || 10;
  const cagr = num('gold-return') || 11;
  const goldPrice = num('gold-price') || 7200;

  let invested, futureValue;
  if (goldMode === 'sip') {
    invested = amount * 12 * years;
    const monthlyReturn = cagr / 12 / 100;
    const n = years * 12;
    futureValue = amount * ((Math.pow(1 + monthlyReturn, n) - 1) / monthlyReturn) * (1 + monthlyReturn);
  } else {
    invested = amount;
    futureValue = amount * Math.pow(1 + cagr / 100, years);
  }

  const gains = futureValue - invested;
  const gainPct = invested > 0 ? Math.round((gains / futureValue) * 100) : 0;
  const goldGrams = futureValue / goldPrice;
  const projectedPrice = goldPrice * Math.pow(1 + cagr / 100, years);

  html('gold-total', formatINR(futureValue, 0));
  html('gold-total-sub', `${goldMode === 'sip' ? 'Gold SIP' : 'Lumpsum'} for ${years} years at ${cagr}% CAGR`);
  html('gold-invested', formatINR(invested, 0));
  html('gold-gains', formatINR(gains, 0));
  html('gold-grams', goldGrams.toFixed(1) + 'g');
  html('gold-gain-pct', gainPct + '%');
  html('gold-projection', `
    <p>Projected gold price in ${years}yr: <strong>₹${Math.round(projectedPrice).toLocaleString('en-IN')}/g</strong></p>
    <p style="margin-top:6px; font-size:0.8rem; opacity:0.7;">Approx gold equivalent: ${goldGrams.toFixed(1)}g at today's price (₹${goldPrice.toLocaleString('en-IN')}/g)</p>
  `);

  // Donut
  const C = 2 * Math.PI * 60;
  const gainsArc = C * (gainPct / 100);
  const investedArc = C * ((100 - gainPct) / 100);
  const gc = $('gold-donut-gains');
  const ic = $('gold-donut-invested');
  if (gc) { gc.setAttribute('stroke-dasharray', `${gainsArc} ${C}`); gc.setAttribute('stroke-dashoffset', '0'); }
  if (ic) { ic.setAttribute('stroke-dasharray', `${investedArc} ${C}`); ic.setAttribute('stroke-dashoffset', `-${gainsArc}`); }

  show('gold-result');
};

window.toggleGoldMode = function(mode) {
  goldMode = mode;
  document.querySelectorAll('.tag-pill[data-goldmode]').forEach(b => b.classList.toggle('active', b.getAttribute('data-goldmode') === mode));
  const label = $('gold-amount-label');
  if (label) label.textContent = mode === 'sip' ? 'Monthly Investment' : 'Lumpsum Investment';
  calculateGold();
};

/* ══════════════════════════════════════
   8. EDUCATION LOAN CALCULATOR
══════════════════════════════════════ */
window.calculateEduLoan = function () {
  const P = num('edu-amount') || 2000000;
  const annualRate = num('edu-rate') || 10.5;
  const tenure = num('edu-tenure') || 7;
  const moratorium = num('edu-moratorium') || 1;
  const taxBracket = num('edu-taxbracket') || 20;

  const r = annualRate / 100 / 12;
  const n = tenure * 12;

  // Moratorium interest accrual
  const effectivePrincipal = P * Math.pow(1 + annualRate / 100, moratorium);
  const extraInterest = effectivePrincipal - P;

  // EMI on effective principal
  const emi = effectivePrincipal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  const totalPayment = emi * n;
  const totalInterest = totalPayment - effectivePrincipal + extraInterest;
  const taxSaved = totalInterest * (taxBracket / 100);

  const principalPct = Math.round((P / (P + totalInterest)) * 100);

  html('edu-emi', formatINR(emi, 0));
  html('edu-emi-sub', `₹${(P / 100000).toFixed(0)}L at ${annualRate}% for ${tenure} years`);
  html('edu-principal-show', formatINR(P, 0));
  html('edu-interest-show', formatINR(totalInterest, 0));
  html('edu-tax-saved', formatINR(taxSaved, 0));
  html('edu-principal-pct', principalPct + '%');

  // Donut
  const C = 2 * Math.PI * 60;
  const interestPct = 100 - principalPct;
  const intArc = C * (interestPct / 100);
  const priArc = C * (principalPct / 100);
  const ec = $('edu-donut-interest');
  const pc = $('edu-donut-principal');
  if (ec) { ec.setAttribute('stroke-dasharray', `${intArc} ${C}`); ec.setAttribute('stroke-dashoffset', '0'); }
  if (pc) { pc.setAttribute('stroke-dasharray', `${priArc} ${C}`); pc.setAttribute('stroke-dashoffset', `-${intArc}`); }

  // Moratorium comparison table
  html('edu-moratorium-body', `
    <tr><td>No Moratorium</td><td>${formatINR(P, 0)}</td></tr>
    <tr><td>After ${moratorium}yr moratorium</td><td>${formatINR(effectivePrincipal, 0)}</td></tr>
    <tr><td>Extra Interest Accrued</td><td style="color:#ef4444;">${formatINR(extraInterest, 0)}</td></tr>
  `);

  show('edu-result');
};

/* ══════════════════════════════════════
   9. GRATUITY CALCULATOR
══════════════════════════════════════ */
let gratuityType = 'covered';

window.calculateGratuity = function () {
  const salary = num('grat-salary') || 60000;
  const years = num('grat-years') || 12;
  const divisor = gratuityType === 'covered' ? 26 : 30;
  const taxExemptLimit = 2000000; // ₹20L

  const gratuity = (15 * salary * years) / divisor;
  const exempt = Math.min(gratuity, taxExemptLimit);
  const taxable = Math.max(0, gratuity - taxExemptLimit);
  const eligible = years >= 5;

  html('grat-amount', formatINR(gratuity, 0));
  html('grat-sub', `Formula: (15 × ₹${salary.toLocaleString('en-IN')} × ${years}) ÷ ${divisor}`);
  html('grat-exempt', formatINR(exempt, 0));
  html('grat-taxable', formatINR(taxable, 0));

  // Eligibility
  html('grat-eligibility', eligible
    ? `<span style="color:#4ade80;">✅ Eligible</span> — Minimum 5 years of continuous service met.`
    : `<span style="color:#ef4444;">❌ Not Eligible</span> — Need at least 5 years of continuous service (currently ${years}).`
  );

  // Projection bars
  const milestones = [5, 10, 15, 20, 25].filter(y => y !== years);
  milestones.push(years);
  milestones.sort((a, b) => a - b);
  const maxGrat = (15 * salary * Math.max(...milestones)) / divisor;

  let barsHtml = '';
  milestones.forEach(y => {
    const g = (15 * salary * y) / divisor;
    const pct = maxGrat > 0 ? (g / maxGrat) * 100 : 0;
    const isCurrentYear = y === years;
    barsHtml += `
      <div>
        <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:3px; color:rgba(255,255,255,${isCurrentYear ? '1' : '0.6'});">
          <span>${y} yrs${isCurrentYear ? ' ←' : ''}</span>
          <span style="font-weight:${isCurrentYear ? '700' : '400'};">${formatINR(g, 0)}</span>
        </div>
        <div style="height:6px; background:rgba(255,255,255,0.15); border-radius:99px; overflow:hidden;">
          <div style="height:100%; width:${pct}%; background:${isCurrentYear ? 'var(--og)' : 'rgba(255,255,255,0.35)'}; border-radius:99px;"></div>
        </div>
      </div>
    `;
  });
  html('grat-projection-bars', barsHtml);

  show('grat-result');
};

window.toggleGratuityType = function(type) {
  gratuityType = type;
  document.querySelectorAll('.tag-pill[data-gratuitytype]').forEach(b => b.classList.toggle('active', b.getAttribute('data-gratuitytype') === type));
  calculateGratuity();
};

/* ══════════════════════════════════════
   WHATSAPP SHARE
══════════════════════════════════════ */
window.shareViaWhatsApp = function(elementId, title) {
  const el = document.getElementById(elementId);
  if (!el) return;

  // Extract key numbers from the result container
  const statEls = el.querySelectorAll('.stat-value, .stat-big, .big-stat, [class*="stat"]');
  const labelEls = el.querySelectorAll('.stat-label, .stat-sub, [class*="label"]');
  let lines = [];

  statEls.forEach((s, i) => {
    const val = s.textContent.trim();
    const label = labelEls[i] ? labelEls[i].textContent.trim() : '';
    if (val) lines.push(label ? `${label}: ${val}` : val);
  });

  // Fallback: grab text from the element if no stats found
  if (lines.length === 0) {
    const text = el.innerText.replace(/\n{3,}/g, '\n\n').trim();
    lines = text.split('\n').filter(l => l.trim()).slice(0, 12);
  }

  const msg = `📊 *ArthaAI — ${title || 'Financial Report'}*\n\n` +
    lines.slice(0, 10).join('\n') +
    `\n\n🔗 Try it free: https://zyllo-spark-studio.lovable.app/arthaai` +
    `\n_Powered by ArthaAI · Zyllo Tech_`;

  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
};


══════════════════════════════════════ */
window.exportPDF = async function(elementId, filename) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const btn = el.querySelector('.pdf-download-btn');
  if (btn) { btn.classList.add('loading'); btn.textContent = '⏳ Generating PDF…'; }

  try {
    if (btn) btn.style.display = 'none';

    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#1A3A5C',
      logging: false,
    });

    if (btn) btn.style.display = '';

    if (!window.jspdf) {
      showToast('PDF library still loading. Please try again in a moment.', 'warning');
      return;
    }
    const { jsPDF } = window.jspdf;
    const imgData = canvas.toDataURL('image/png');
    const imgW = canvas.width;
    const imgH = canvas.height;

    const pdfW = 210;
    const margin = 12;
    const contentW = pdfW - margin * 2;
    const contentH = (imgH * contentW) / imgW;

    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

    // Header branding
    pdf.setFillColor(26, 58, 92);
    pdf.rect(0, 0, 210, 28, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('ArthaAI', margin, 14);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Smart Money Guidance for Every Indian', margin, 20);
    pdf.setTextColor(224, 92, 26);
    pdf.text('by Zyllo Tech Software Solutions Pvt Ltd', margin, 24);

    // Calculator result image
    const startY = 34;
    const maxH = 297 - startY - 20;
    if (contentH > maxH) {
      const scale = maxH / contentH;
      pdf.addImage(imgData, 'PNG', margin, startY, contentW * scale, maxH);
    } else {
      pdf.addImage(imgData, 'PNG', margin, startY, contentW, contentH);
    }

    // Footer
    pdf.setFillColor(245, 245, 245);
    pdf.rect(0, 285, 210, 12, 'F');
    pdf.setTextColor(120, 120, 120);
    pdf.setFontSize(6.5);
    pdf.text('Disclaimer: ArthaAI calculators are for educational purposes only. Not financial advice. Consult a SEBI-registered adviser.', margin, 290);
    pdf.text('Generated on ' + new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }) + ' · arthaai.zyllotech.com', margin, 294);

    pdf.save((filename || 'ArthaAI_Report') + '.pdf');
    if (window.showToast) showToast('PDF downloaded successfully!', 'success');
  } catch (err) {
    console.error('PDF export error:', err);
    if (window.showToast) showToast('PDF generation failed. Please try again.', 'error');
  } finally {
    if (btn) { btn.classList.remove('loading'); btn.textContent = '📥 Download PDF Report'; }
  }
};

/* ══════════════════════════════════════
   INIT: Event listeners & sync
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Sync range sliders ↔ inputs
  const pairs = [
    ['emi-rate-range', 'emi-rate'],
    ['emi-tenure-range', 'emi-tenure'],
    ['sip-return-range', 'sip-return'],
    ['sip-period-range', 'sip-period'],
    ['fd-rate-range', 'fd-rate'],
    ['fd-period-range', 'fd-period'],
    ['gold-years-range', 'gold-years'],
    ['edu-rate-range', 'edu-rate'],
    ['grat-years-range', 'grat-years'],
  ];
  pairs.forEach(([rangeId, inputId]) => {
    if (window.syncRange) {
      syncRange(rangeId, inputId);
      syncRange(inputId, rangeId);
    }
  });

  // Tenure years → months auto-sync
  const tenureInput = $('emi-tenure');
  if (tenureInput) {
    tenureInput.addEventListener('input', () => {
      setV('emi-tenure-months', (parseFloat(tenureInput.value) || 0) * 12);
    });
  }

  // EMI loan preset buttons
  document.querySelectorAll('.tag-pill[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => setLoanPreset(btn.getAttribute('data-preset')));
  });

  // SIP mode toggle
  document.querySelectorAll('.tag-pill[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => toggleSIPMode(btn.getAttribute('data-mode')));
  });

  // FD type toggle
  document.querySelectorAll('.tag-pill[data-fdtype]').forEach(btn => {
    btn.addEventListener('click', () => setFDType(btn.getAttribute('data-fdtype')));
  });

  // Gold mode toggle
  document.querySelectorAll('.tag-pill[data-goldmode]').forEach(btn => {
    btn.addEventListener('click', () => toggleGoldMode(btn.getAttribute('data-goldmode')));
  });

  // Gratuity type toggle
  document.querySelectorAll('.tag-pill[data-gratuitytype]').forEach(btn => {
    btn.addEventListener('click', () => toggleGratuityType(btn.getAttribute('data-gratuitytype')));
  });

  // Run default calculations for all tabs
  calculateEMI();
  calculateSIP();
  calculateTax();
  calculateFD();
  calculateRetirement();
  calculateRentVsBuy();
  calculateGold();
  calculateEduLoan();
  calculateGratuity();
});

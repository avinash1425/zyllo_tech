/**
 * ArthaAI — calculators.js
 * Full calculator logic for ArthaCalc module:
 *   1. EMI Calculator
 *   2. SIP / Lumpsum Calculator
 *   3. Tax Savings (Old vs New Regime)
 *   4. FD / PPF / NPS / RD Comparator
 *   5. Retirement Corpus Planner
 *   6. Rent vs Buy Analyser
 * Zyllo Tech Software Solutions Pvt Ltd
 */

'use strict';

/* ══════════════════════════════════════
   GLOBAL: TAB SWITCHER
══════════════════════════════════════ */
window.switchCalcTab = function(tabName) {
  document.querySelectorAll('.calc-tab-btn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-calc') === tabName)
  );
  document.querySelectorAll('.calc-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'calc-' + tabName)
  );
};

/* ══════════════════════════════════════
   GLOBAL: LOAN TYPE PRESETS (EMI)
══════════════════════════════════════ */
window.setLoanPreset = function(type) {
  document.querySelectorAll('.loan-preset-btn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-preset') === type)
  );
  const presets = {
    home:      { principal: 3000000,  rate: 8.5,  tenure: 240 },
    car:       { principal: 700000,   rate: 9.0,  tenure: 60  },
    personal:  { principal: 300000,   rate: 12.0, tenure: 36  },
    education: { principal: 1000000,  rate: 10.5, tenure: 84  }
  };
  const p = presets[type];
  if (!p) return;
  setVal('emiPrincipal',   p.principal);
  setVal('emiRate',        p.rate);
  setVal('emiTenure',      p.tenure);
  setVal('emiPrincipalRange', p.principal);
  setVal('emiRateRange',     p.rate);
  setVal('emiTenureRange',   p.tenure);
  calculateEMI();
};

/* ═══════════════════════════════════════════
   1. EMI CALCULATOR
═══════════════════════════════════════════ */
window.calculateEMI = function() {
  const P = parseNum('emiPrincipal') || 3000000;
  const r = (parseNum('emiRate') || 8.5) / 100 / 12;
  const n = parseNum('emiTenure') || 240;

  if (P <= 0 || r <= 0 || n <= 0) return;

  const emi       = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  const total     = emi * n;
  const interest  = total - P;
  const principalPct = Math.round((P / total) * 100);
  const interestPct  = 100 - principalPct;

  setHTML('emiMonthly',      formatINR(emi, 0));
  setHTML('emiTotalPayment', formatINR(total, 0));
  setHTML('emiTotalInterest',formatINR(interest, 0));

  // Donut chart
  if (window.drawDonut) {
    drawDonut('emiDonut', principalPct, interestPct, ['#1A3A5C', '#E05C1A']);
  }

  // Donut labels
  setHTML('emiPrincipalPct', principalPct + '%');
  setHTML('emiInterestPct',  interestPct  + '%');

  // Yearly table
  buildEMITable(P, r, n, emi);

  // Animate result reveal
  revealResult('emiResult');
};

function buildEMITable(P, r, n, emi) {
  const tbody = document.getElementById('emiTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let balance = P;
  let cumPrincipal = 0, cumInterest = 0;

  for (let yr = 1; yr <= Math.ceil(n / 12); yr++) {
    const monthsThisYear = Math.min(12, n - (yr - 1) * 12);
    let yrPrincipal = 0, yrInterest = 0;
    for (let m = 0; m < monthsThisYear; m++) {
      const intPart = balance * r;
      const priPart = emi - intPart;
      yrInterest  += intPart;
      yrPrincipal += priPart;
      balance     -= priPart;
    }
    cumPrincipal += yrPrincipal;
    cumInterest  += yrInterest;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>Year ${yr}</td>
      <td>${formatINR(yrPrincipal, 0)}</td>
      <td>${formatINR(yrInterest, 0)}</td>
      <td>${formatINR(cumPrincipal, 0)}</td>
      <td>${formatINR(Math.max(balance, 0), 0)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* ═══════════════════════════════════════════
   2. SIP / LUMPSUM CALCULATOR
═══════════════════════════════════════════ */
window.toggleSIPMode = function(mode) {
  document.querySelectorAll('.sip-mode-btn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-mode') === mode)
  );
  const sipRow  = document.getElementById('sipInputRow');
  const stepRow = document.getElementById('sipStepUpRow');
  if (mode === 'lumpsum') {
    if (sipRow)  sipRow.style.display  = 'none';
    if (stepRow) stepRow.style.display = 'none';
  } else {
    if (sipRow)  sipRow.style.display  = '';
    if (stepRow) stepRow.style.display = '';
  }
  calculateSIP();
};

window.calculateSIP = function() {
  const mode     = document.querySelector('.sip-mode-btn.active')?.getAttribute('data-mode') || 'sip';
  const amount   = parseNum('sipAmount')  || 5000;
  const rate     = parseNum('sipReturn')  || 12;
  const years    = parseNum('sipPeriod')  || 10;
  const stepUp   = parseNum('sipStepUp')  || 0;
  const lumpsum  = parseNum('sipLumpsum') || 100000;
  const r        = rate / 100;

  let invested, returns, total;

  if (mode === 'sip') {
    const rMonthly = r / 12;
    const n        = years * 12;

    if (stepUp > 0) {
      // Step-up SIP
      let corpus = 0;
      let monthlyAmt = amount;
      let inv = 0;
      for (let yr = 0; yr < years; yr++) {
        if (yr > 0) monthlyAmt *= (1 + stepUp / 100);
        for (let m = 0; m < 12; m++) {
          corpus = (corpus + monthlyAmt) * (1 + rMonthly);
          inv   += monthlyAmt;
        }
      }
      invested = inv;
      total    = corpus;
    } else {
      // Regular SIP
      total    = amount * ((Math.pow(1 + rMonthly, n) - 1) / rMonthly) * (1 + rMonthly);
      invested = amount * n;
    }
  } else {
    // Lumpsum
    total    = lumpsum * Math.pow(1 + r, years);
    invested = lumpsum;
  }

  returns = total - invested;

  setHTML('sipTotalInvested',  formatINR(invested, 0));
  setHTML('sipEstReturns',     formatINR(returns,  0));
  setHTML('sipTotalValue',     formatINR(total,    0));
  setHTML('sipXIRR',           (((total / invested) ** (1 / years) - 1) * 100).toFixed(1) + '%');

  // Year-wise bar chart
  buildSIPBars(mode, amount, r, years, stepUp, lumpsum);
  revealResult('sipResult');
};

function buildSIPBars(mode, amount, r, years, stepUp, lumpsum) {
  const container = document.getElementById('sipBars');
  if (!container) return;
  container.innerHTML = '';

  const rMonthly = r / 12;
  let   maxVal   = 0;

  // Calculate end values per year
  const yearVals = [];
  for (let yr = 1; yr <= years; yr++) {
    let val, inv;
    if (mode === 'lumpsum') {
      val = lumpsum * Math.pow(1 + r, yr);
      inv = lumpsum;
    } else if (stepUp > 0) {
      let corpus = 0, monthlyAmt = amount, invAmt = 0;
      for (let y = 0; y < yr; y++) {
        if (y > 0) monthlyAmt *= (1 + stepUp / 100);
        for (let m = 0; m < 12; m++) {
          corpus = (corpus + monthlyAmt) * (1 + rMonthly);
          invAmt += monthlyAmt;
        }
      }
      val = corpus; inv = invAmt;
    } else {
      const n = yr * 12;
      val = amount * ((Math.pow(1 + rMonthly, n) - 1) / rMonthly) * (1 + rMonthly);
      inv = amount * n;
    }
    yearVals.push({ year: yr, val, inv });
    if (val > maxVal) maxVal = val;
  }

  // Build bars (only show every 2nd year if > 10 years)
  const step = years > 10 ? 2 : 1;
  yearVals.forEach(({ year, val, inv }) => {
    if (year % step !== 0 && year !== years) return;
    const pct   = Math.round((val / maxVal) * 100);
    const invPct= Math.round((inv / val) * pct);
    const div   = document.createElement('div');
    div.className = 'sip-bar-item';
    div.innerHTML = `
      <div class="sip-bar-wrap" title="${formatINR(val,0)}">
        <div class="sip-bar" style="height:${pct}%">
          <div class="sip-bar-inv" style="height:${invPct}%"></div>
        </div>
      </div>
      <span class="sip-bar-label">Y${year}</span>
    `;
    container.appendChild(div);
  });
}

/* ═══════════════════════════════════════════
   3. TAX SAVINGS CALCULATOR
═══════════════════════════════════════════ */
window.calculateTax = function() {
  const income     = parseNum('taxIncome')  || 1000000;
  const c80c       = Math.min(parseNum('tax80C')   || 0, 150000);
  const c80d       = Math.min(parseNum('tax80D')   || 0, 75000);
  const nps80ccd   = Math.min(parseNum('taxNPS')   || 0, 50000);
  const hra        = parseNum('taxHRA')     || 0;
  const empType    = document.getElementById('taxEmpType')?.value || 'salaried';
  const stdDeduct  = empType === 'salaried' ? 50000 : 0;

  // ── OLD REGIME ──
  const oldDeductions = stdDeduct + c80c + c80d + nps80ccd + hra;
  const oldTaxable    = Math.max(0, income - oldDeductions);
  const oldTax        = calcOldRegimeTax(oldTaxable);

  // ── NEW REGIME ──
  const newStd     = empType === 'salaried' ? 75000 : 0;
  const newTaxable = Math.max(0, income - newStd);
  const newTax     = calcNewRegimeTax(newTaxable);

  // Rebate u/s 87A
  const oldFinal = oldTaxable <= 500000   ? 0 : applyHECess(oldTax);
  const newFinal = newTaxable <= 700000   ? 0 : applyHECess(newTax);

  const saving = Math.abs(oldFinal - newFinal);
  const winner = newFinal <= oldFinal ? 'New Regime' : 'Old Regime';
  const winnerClass = newFinal <= oldFinal ? 'new' : 'old';

  setHTML('oldRegimeTax',  formatINR(oldFinal, 0));
  setHTML('newRegimeTax',  formatINR(newFinal, 0));
  setHTML('taxSaving',     formatINR(saving,   0));
  setHTML('taxWinner',     `<span class="tax-winner ${winnerClass}">${winner} saves ₹${formatINR(saving,0)}</span>`);

  // Deductions breakdown
  buildTaxDeductionsTable(income, stdDeduct, c80c, c80d, nps80ccd, hra, oldDeductions);
  revealResult('taxResult');
};

function calcOldRegimeTax(taxable) {
  let tax = 0;
  const slabs = [[250000,0],[500000,.05],[1000000,.2],[Infinity,.3]];
  let prev = 0;
  for (const [limit, rate] of slabs) {
    if (taxable <= prev) break;
    tax += Math.min(taxable, limit) - prev;
    if (rate) tax = (prev === 0 ? 0 : tax) + (Math.min(taxable, limit) - prev) * rate;
    prev = limit;
  }
  // Recalculate properly
  tax = 0;
  if (taxable > 1000000) tax += (taxable - 1000000) * 0.30;
  if (taxable > 500000)  tax += (Math.min(taxable, 1000000) - 500000) * 0.20;
  if (taxable > 250000)  tax += (Math.min(taxable, 500000)  - 250000) * 0.05;
  return tax;
}

function calcNewRegimeTax(taxable) {
  let tax = 0;
  if (taxable > 1500000) tax += (taxable - 1500000) * 0.30;
  if (taxable > 1200000) tax += (Math.min(taxable, 1500000) - 1200000) * 0.20;
  if (taxable > 1000000) tax += (Math.min(taxable, 1200000) - 1000000) * 0.15;
  if (taxable > 700000)  tax += (Math.min(taxable, 1000000) - 700000)  * 0.10;
  if (taxable > 300000)  tax += (Math.min(taxable, 700000)  - 300000)  * 0.05;
  return tax;
}

function applyHECess(tax) {
  return Math.round(tax + tax * 0.04); // 4% Health & Education Cess
}

function buildTaxDeductionsTable(income, std, c80c, c80d, nps, hra, total) {
  const tbody = document.getElementById('taxDeductionsBody');
  if (!tbody) return;
  const items = [
    ['Standard Deduction', std, '— (New: ₹75,000)'],
    ['80C Investments', c80c, 'ELSS / PPF / EPF / LIC'],
    ['80D Health Insurance', c80d, 'Self + Parents'],
    ['80CCD(1B) NPS', nps, 'Additional pension contribution'],
    ['HRA Exemption', hra, 'Actual / Calculated exempt amount'],
  ];
  tbody.innerHTML = items.filter(i => i[1] > 0).map(([name, amt, note]) => `
    <tr>
      <td>${name}</td>
      <td>${formatINR(amt,0)}</td>
      <td style="color:var(--g500);font-size:.82rem">${note}</td>
    </tr>
  `).join('') + `<tr style="font-weight:700;background:var(--g50)">
    <td>Total Deductions</td>
    <td>${formatINR(total,0)}</td>
    <td>Taxable: ${formatINR(Math.max(0, income - total), 0)}</td>
  </tr>`;
}

/* ═══════════════════════════════════════════
   4. FD / PPF / NPS / RD COMPARATOR
═══════════════════════════════════════════ */
window.calculateFD = function() {
  const type       = document.querySelector('.fd-type-btn.active')?.getAttribute('data-type') || 'fd';
  const principal  = parseNum('fdPrincipal') || 100000;
  const rate       = parseNum('fdRate')      || 7;
  const years      = parseNum('fdPeriod')    || 5;
  const freq       = parseInt(document.getElementById('fdFreq')?.value || '4');
  let maturity, interest, effectiveRate;

  switch(type) {
    case 'fd': {
      // Compound interest with frequency
      maturity      = principal * Math.pow(1 + rate / 100 / freq, freq * years);
      interest      = maturity - principal;
      effectiveRate = (Math.pow(1 + rate / 100 / freq, freq) - 1) * 100;
      break;
    }
    case 'ppf': {
      // PPF: compounded annually, invested at start of year
      const r = rate / 100;
      maturity = 0;
      for (let yr = 1; yr <= years; yr++) {
        maturity = (maturity + principal) * (1 + r);
      }
      interest      = maturity - principal * years;
      effectiveRate = rate;
      break;
    }
    case 'rd': {
      // RD: monthly deposits
      const rMonthly = rate / 100 / 12;
      const n        = years * 12;
      maturity       = principal * ((Math.pow(1 + rMonthly, n) - 1) / rMonthly) * (1 + rMonthly);
      interest       = maturity - principal * n;
      effectiveRate  = rate;
      break;
    }
    case 'nps': {
      // NPS Tier I: market return (use rate input as expected return)
      maturity      = principal * Math.pow(1 + rate / 100, years);
      interest      = maturity - principal;
      effectiveRate = rate;
      break;
    }
    default:
      maturity = principal; interest = 0; effectiveRate = 0;
  }

  setHTML('fdMaturityAmt',  formatINR(maturity,      0));
  setHTML('fdInterestEarned', formatINR(interest,    0));
  setHTML('fdEffectiveRate',  effectiveRate.toFixed(2) + '%');

  // Quick comparison table
  buildFDComparisonTable(principal, rate, years);
  revealResult('fdResult');
};

function buildFDComparisonTable(principal, rate, years) {
  const tbody = document.getElementById('fdCompTable');
  if (!tbody) return;
  const r = rate / 100;
  const rM = r / 12;
  const n  = years * 12;

  const fdMat   = principal * Math.pow(1 + r / 4, 4 * years);
  let   ppfMat  = 0;
  for (let yr = 1; yr <= years; yr++) ppfMat = (ppfMat + principal) * (1 + r);
  const rdMat   = principal * ((Math.pow(1 + rM, n) - 1) / rM) * (1 + rM);
  const npsMat  = principal * Math.pow(1 + (rate + 2) / 100, years); // NPS typically outperforms FD by ~2%

  const rows = [
    { name: 'Fixed Deposit (FD)',       mat: fdMat,  risk: 'Nil',   tax: 'As per slab',   lock: 'Flexible'    },
    { name: 'Public Provident Fund (PPF)', mat: ppfMat,risk:'Nil',  tax: 'Tax-Free (EEE)', lock: '15 years'   },
    { name: 'Recurring Deposit (RD)',    mat: rdMat,  risk: 'Nil',   tax: 'As per slab',   lock: 'Flexible'    },
    { name: 'NPS Tier I (est.)',         mat: npsMat, risk: 'Low',   tax: 'Partial',        lock: 'Till age 60' },
  ];

  const maxMat = Math.max(...rows.map(r => r.mat));
  tbody.innerHTML = rows.map(row => `
    <tr ${row.mat === maxMat ? 'class="best-row"' : ''}>
      <td>${row.name} ${row.mat === maxMat ? '<span style="color:#16a34a;font-size:.78rem">★ Best</span>' : ''}</td>
      <td><strong>${formatINR(row.mat, 0)}</strong></td>
      <td>${formatINR(row.mat - principal, 0)}</td>
      <td>${row.risk}</td>
      <td>${row.tax}</td>
      <td>${row.lock}</td>
    </tr>
  `).join('');
}

window.setFDType = function(type) {
  document.querySelectorAll('.fd-type-btn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-type') === type)
  );
  calculateFD();
};

/* ═══════════════════════════════════════════
   5. RETIREMENT CORPUS CALCULATOR
═══════════════════════════════════════════ */
window.calculateRetirement = function() {
  const currentAge    = parseNum('retCurrentAge')    || 30;
  const retireAge     = parseNum('retRetireAge')      || 60;
  const lifeExp       = parseNum('retLifeExp')        || 85;
  const monthlyExp    = parseNum('retMonthlyExp')     || 50000;
  const currentSaving = parseNum('retCurrentSaving')  || 500000;
  const inflation     = (parseNum('retInflation')     || 6)  / 100;
  const preSavingROI  = (parseNum('retPreROI')        || 12) / 100;
  const postSavingROI = (parseNum('retPostROI')       || 7)  / 100;

  const yearsToRetire  = retireAge  - currentAge;
  const yearsInRetire  = lifeExp    - retireAge;
  if (yearsToRetire <= 0 || yearsInRetire <= 0) return;

  // Future monthly expense at retirement (inflation-adjusted)
  const futureMonthlyExp = monthlyExp * Math.pow(1 + inflation, yearsToRetire);
  // Corpus needed to sustain retirement (Present Value of annuity at post-retirement ROI)
  const rReal = (postSavingROI - inflation) / (1 + inflation); // real rate
  let corpusNeeded;
  if (rReal > 0) {
    corpusNeeded = futureMonthlyExp * 12 * ((1 - Math.pow(1 + rReal, -yearsInRetire)) / rReal);
  } else {
    corpusNeeded = futureMonthlyExp * 12 * yearsInRetire;
  }

  // Future value of current savings
  const fvCurrentSavings = currentSaving * Math.pow(1 + preSavingROI, yearsToRetire);
  // Gap
  const gap = Math.max(0, corpusNeeded - fvCurrentSavings);
  // Monthly SIP needed to fill the gap
  const rMonthly = preSavingROI / 12;
  const n        = yearsToRetire * 12;
  const monthlySIP = gap > 0
    ? gap * rMonthly / ((Math.pow(1 + rMonthly, n) - 1) * (1 + rMonthly))
    : 0;

  // Readiness %
  const readiness = Math.min(100, Math.round((fvCurrentSavings / corpusNeeded) * 100));

  setHTML('retCorpusNeeded',   formatINRShort(corpusNeeded));
  setHTML('retFutureExpense',  formatINR(futureMonthlyExp, 0) + '/mo');
  setHTML('retFVSavings',      formatINRShort(fvCurrentSavings));
  setHTML('retMonthlySIP',     formatINR(monthlySIP, 0));
  setHTML('retReadinessPct',   readiness + '%');

  const bar = document.getElementById('retReadinessBar');
  if (bar) {
    bar.style.width = readiness + '%';
    bar.style.background = readiness >= 70 ? '#22c55e' : readiness >= 40 ? '#f59e0b' : '#ef4444';
  }

  revealResult('retResult');
};

/* ═══════════════════════════════════════════
   6. RENT vs BUY ANALYSER
═══════════════════════════════════════════ */
window.calculateRentVsBuy = function() {
  const propPrice   = parseNum('rvbPropertyPrice') || 6000000;
  const downPct     = (parseNum('rvbDownPayment')  || 20) / 100;
  const loanRate    = (parseNum('rvbLoanRate')     || 8.5) / 100;
  const loanYears   = parseNum('rvbLoanTenure')    || 20;
  const rent        = parseNum('rvbMonthlyRent')   || 20000;
  const rentIncrease= (parseNum('rvbRentIncrease') || 6)  / 100;
  const appreciation= (parseNum('rvbAppreciation') || 7)  / 100;
  const years       = parseNum('rvbHorizon')       || 10;

  const downPayment = propPrice * downPct;
  const loanAmt     = propPrice - downPayment;
  const rMonthly    = loanRate / 12;
  const n           = loanYears * 12;
  const emi         = loanAmt * rMonthly * Math.pow(1 + rMonthly, n) / (Math.pow(1 + rMonthly, n) - 1);

  // Buying costs over horizon
  const totalEMI        = emi * Math.min(years, loanYears) * 12;
  const maintenancePA   = propPrice * 0.01; // 1% p.a. maintenance
  const totalMaintenance= maintenancePA * years;
  const propFutureValue = propPrice * Math.pow(1 + appreciation, years);
  const equityBuilt     = propFutureValue - Math.max(0, loanAmt - (emi * 12 * years - loanAmt * (Math.pow(1 + rMonthly, years * 12) - 1) / (Math.pow(1 + rMonthly, loanYears * 12) - 1)));
  const buyNetCost      = downPayment + totalEMI + totalMaintenance - propFutureValue;

  // Renting costs over horizon
  let totalRent = 0, currentRent = rent * 12;
  for (let yr = 0; yr < years; yr++) {
    totalRent   += currentRent;
    currentRent *= (1 + rentIncrease);
  }
  // Opportunity cost: down payment could have been invested
  const investedDP       = downPayment * Math.pow(1.12, years); // 12% equity return assumption
  const rentOpportunityCost = totalRent - (investedDP - downPayment);
  const rentNetCost      = totalRent;

  const isBuyBetter = buyNetCost < rentNetCost;
  const difference  = Math.abs(buyNetCost - rentNetCost);

  setHTML('rvbEMI',             formatINR(emi, 0));
  setHTML('rvbTotalBuyCost',    formatINR(Math.max(0, buyNetCost), 0));
  setHTML('rvbTotalRentCost',   formatINR(totalRent, 0));
  setHTML('rvbFutureValue',     formatINR(propFutureValue, 0));
  setHTML('rvbVerdict', isBuyBetter
    ? `<div class="verdict-card buy">🏠 <strong>Buying is better</strong> over ${years} years — you save approx. ${formatINR(difference,0)} compared to renting.</div>`
    : `<div class="verdict-card rent">🏢 <strong>Renting is better</strong> over ${years} years — you save approx. ${formatINR(difference,0)} compared to buying. Invest the down payment instead.</div>`
  );

  revealResult('rvbResult');
};

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function revealResult(id) {
  const el = document.getElementById(id);
  if (el && !el.classList.contains('visible')) {
    el.classList.add('visible');
    el.style.display = '';
    el.style.opacity  = '0';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .4s ease';
      el.style.opacity    = '1';
    });
  }
}

/* ══════════════════════════════════════
   INIT: Sync range sliders on load
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // EMI
  ['emiPrincipal','emiRate','emiTenure'].forEach(id => {
    window.syncRange && syncRange(id + 'Range', id);
    syncRange(id, id + 'Range');
  });

  // SIP
  ['sipAmount','sipReturn','sipPeriod'].forEach(id => {
    window.syncRange && syncRange(id + 'Range', id);
    syncRange(id, id + 'Range');
  });

  // Run default calculations
  calculateEMI();
  calculateSIP();
});

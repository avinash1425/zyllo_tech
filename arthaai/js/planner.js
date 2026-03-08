/**
 * ArthaAI — planner.js
 * Full planner logic for ArthaPlanner module:
 *   1. Goal Planner
 *   2. Budget Builder (50-30-20 rule)
 *   3. Emergency Fund Calculator
 *   4. Debt Repayment (Avalanche & Snowball)
 *   5. Life Stage Guide
 *   6. Net Worth Tracker
 * Zyllo Tech Software Solutions Pvt Ltd
 */

'use strict';

/* ══════════════════════════════════════
   GLOBAL: PLANNER TAB SWITCHER
══════════════════════════════════════ */
window.switchPlannerTab = function(tabName) {
  document.querySelectorAll('.planner-tab-btn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-planner') === tabName)
  );
  document.querySelectorAll('.planner-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'planner-' + tabName)
  );
};

/* ═══════════════════════════════════════════
   1. GOAL PLANNER
═══════════════════════════════════════════ */
let selectedGoals = new Set();

window.toggleGoal = function(el, goalId) {
  if (selectedGoals.has(goalId)) {
    selectedGoals.delete(goalId);
    el.classList.remove('selected');
  } else {
    selectedGoals.add(goalId);
    el.classList.add('selected');
  }
  renderSelectedGoalsList();
};

window.calculateGoal = function() {
  const goalName = document.getElementById('goalName')?.value || 'My Goal';
  const target   = parseFloat(document.getElementById('goalAmount')?.value) || 1000000;
  const years    = parseFloat(document.getElementById('goalYears')?.value)  || 5;
  const saved    = parseFloat(document.getElementById('goalSaved')?.value)  || 0;
  const rate     = 12; // assume 12% p.a. equity return

  if (target <= 0 || years <= 0) return;

  const rMonthly  = rate / 100 / 12;
  const n         = years * 12;
  const fvSaved   = saved * Math.pow(1 + rate / 100, years);
  const remaining = Math.max(0, target - fvSaved);

  const monthlySIP = remaining > 0
    ? remaining * rMonthly / ((Math.pow(1 + rMonthly, n) - 1) * (1 + rMonthly))
    : 0;

  const lumpSumNeeded = remaining > 0
    ? remaining / Math.pow(1 + rate / 100, years)
    : 0;

  setHTML('goalResultName',    goalName);
  setHTML('goalSIPNeeded',     formatINR(monthlySIP, 0));
  setHTML('goalLumpNeeded',    formatINR(lumpSumNeeded, 0));
  setHTML('goalTargetAmt',     formatINR(target, 0));
  setHTML('goalFVSavings',     formatINR(fvSaved, 0));
  setHTML('goalRemainingCorpus', formatINR(remaining, 0));

  revealPlanner('goalResult');
};

function renderSelectedGoalsList() {
  const container = document.getElementById('selectedGoalsList');
  if (!container) return;
  if (selectedGoals.size === 0) {
    container.innerHTML = '<p style="color:var(--g400);font-size:.85rem">Select goals above to see them here.</p>';
    return;
  }
  const goalNames = {
    home: '🏠 Home Purchase', education: '🎓 Education Fund',
    marriage: '💍 Marriage', retirement: '🌅 Retirement',
    vehicle: '🚗 Vehicle', travel: '✈️ Dream Vacation',
    startup: '🚀 Start a Business', wealth: '📈 Wealth Building'
  };
  container.innerHTML = [...selectedGoals].map(id => `
    <div class="selected-goal-tag">
      ${goalNames[id] || id}
      <span onclick="removeGoal('${id}')" style="cursor:pointer;margin-left:.3rem;">✕</span>
    </div>
  `).join('');
}

window.removeGoal = function(id) {
  selectedGoals.delete(id);
  const el = document.querySelector(`.goal-card[data-goal="${id}"]`);
  if (el) el.classList.remove('selected');
  renderSelectedGoalsList();
};

/* ═══════════════════════════════════════════
   2. BUDGET BUILDER (50-30-20 Rule)
═══════════════════════════════════════════ */
window.updateBudget = function() {
  const income = parseFloat(document.getElementById('budgetIncome')?.value) || 0;
  if (income <= 0) return;

  // Collect categories
  const needsTotal   = sumCategory('needs');
  const wantsTotal   = sumCategory('wants');
  const savingsTotal = sumCategory('savings');
  const totalSpent   = needsTotal + wantsTotal + savingsTotal;

  const needsPct   = income > 0 ? Math.round((needsTotal   / income) * 100) : 0;
  const wantsPct   = income > 0 ? Math.round((wantsTotal   / income) * 100) : 0;
  const savingsPct = income > 0 ? Math.round((savingsTotal / income) * 100) : 0;
  const surplus    = income - totalSpent;

  // Update totals
  setHTML('budgetNeedsTotal',   formatINR(needsTotal, 0));
  setHTML('budgetWantsTotal',   formatINR(wantsTotal, 0));
  setHTML('budgetSavingsTotal', formatINR(savingsTotal, 0));
  setHTML('budgetSurplus',      formatINR(surplus, 0));

  // Update 50-30-20 health bars
  updateBudgetBar('needsBar',   needsPct,   50,  'Needs (target: 50%)');
  updateBudgetBar('wantsBar',   wantsPct,   30,  'Wants (target: 30%)');
  updateBudgetBar('savingsBar', savingsPct, 20,  'Savings (target: 20%)');

  setHTML('budgetNeedsPct',   needsPct   + '%');
  setHTML('budgetWantsPct',   wantsPct   + '%');
  setHTML('budgetSavingsPct', savingsPct + '%');

  // Overall health grade
  const grade = getBudgetGrade(needsPct, wantsPct, savingsPct);
  setHTML('budgetGrade', grade.label);
  const gradeEl = document.getElementById('budgetGrade');
  if (gradeEl) gradeEl.className = 'budget-grade grade-' + grade.level;

  revealPlanner('budgetResult');
};

function sumCategory(cat) {
  let total = 0;
  document.querySelectorAll(`[data-budget-cat="${cat}"]`).forEach(el => {
    total += parseFloat(el.value) || 0;
  });
  return total;
}

function updateBudgetBar(id, pct, target, label) {
  const bar = document.getElementById(id);
  if (!bar) return;
  bar.style.width    = Math.min(pct, 100) + '%';
  bar.style.background = pct <= target ? '#22c55e' : pct <= target * 1.25 ? '#f59e0b' : '#ef4444';
  bar.title = `${label} — Current: ${pct}%`;
}

function getBudgetGrade(needs, wants, savings) {
  const score = (needs <= 50 ? 1 : 0) + (wants <= 30 ? 1 : 0) + (savings >= 20 ? 1 : 0);
  if (score === 3) return { label: '🟢 Excellent — You\'re following the 50-30-20 rule!', level: 'green'  };
  if (score === 2) return { label: '🟡 Good — Minor adjustments needed.',                  level: 'yellow' };
  return           { label: '🔴 Needs Work — Review your spending categories.',            level: 'red'    };
}

/* ═══════════════════════════════════════════
   3. EMERGENCY FUND CALCULATOR
═══════════════════════════════════════════ */
window.calculateEmergencyFund = function() {
  const expenses   = parseFloat(document.getElementById('efExpenses')?.value)    || 30000;
  const months     = parseFloat(document.getElementById('efMonths')?.value)      || 6;
  const currentSav = parseFloat(document.getElementById('efCurrentSav')?.value)  || 0;
  const monthly    = parseFloat(document.getElementById('efMonthlyContrib')?.value) || 5000;

  const target   = expenses * months;
  const gap      = Math.max(0, target - currentSav);
  const timeline = gap > 0 && monthly > 0 ? Math.ceil(gap / monthly) : 0;

  setHTML('efTarget',       formatINR(target, 0));
  setHTML('efCurrentSaved', formatINR(currentSav, 0));
  setHTML('efGap',          formatINR(gap, 0));
  setHTML('efTimeline',     timeline > 0 ? `${timeline} months` : '✅ Already funded!');

  const pct   = Math.min(100, Math.round((currentSav / target) * 100));
  const bar   = document.getElementById('efProgressBar');
  if (bar) {
    bar.style.width      = pct + '%';
    bar.style.background = pct >= 100 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  }
  setHTML('efProgressPct', pct + '%');

  // Recommendations
  const recList = [
    { label: 'Liquid Funds (Instant Redemption)', note: 'Best option — slightly higher returns than savings, T+0 redemption' },
    { label: 'Savings Account (HDFC/SBI)', note: '2.5–3.5% p.a. — fully liquid, DICGC insured' },
    { label: 'Sweep-in FD', note: 'Auto-linked FD to savings — earns FD rate with savings liquidity' },
  ];
  const rContainer = document.getElementById('efRecommendations');
  if (rContainer) {
    rContainer.innerHTML = recList.map(r => `
      <div class="ef-rec-item">
        <strong>${r.label}</strong>
        <span>${r.note}</span>
      </div>
    `).join('');
  }

  revealPlanner('efResult');
};

/* ═══════════════════════════════════════════
   4. DEBT REPAYMENT PLANNER
═══════════════════════════════════════════ */
let debtList = [];
let debtMethod = 'avalanche';

window.setDebtMethod = function(method) {
  debtMethod = method;
  document.querySelectorAll('.debt-method-btn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-method') === method)
  );
  if (debtList.length > 0) calculateDebtPlan();
};

window.addDebt = function() {
  const name    = document.getElementById('debtName')?.value   || 'Loan';
  const balance = parseFloat(document.getElementById('debtBalance')?.value)  || 0;
  const rate    = parseFloat(document.getElementById('debtRate')?.value)     || 0;
  const minPay  = parseFloat(document.getElementById('debtMinPay')?.value)   || 0;

  if (balance <= 0 || rate <= 0) {
    showToast && showToast('Please enter valid balance and interest rate.', 'error');
    return;
  }

  debtList.push({ id: Date.now(), name, balance, rate, minPay });
  renderDebtList();
  // Clear inputs
  ['debtName','debtBalance','debtRate','debtMinPay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  calculateDebtPlan();
};

window.removeDebt = function(id) {
  debtList = debtList.filter(d => d.id !== id);
  renderDebtList();
  if (debtList.length > 0) calculateDebtPlan();
  else {
    const res = document.getElementById('debtResult');
    if (res) res.style.display = 'none';
  }
};

function renderDebtList() {
  const container = document.getElementById('debtListItems');
  if (!container) return;
  if (debtList.length === 0) {
    container.innerHTML = '<p style="color:var(--g400);font-size:.85rem;text-align:center;padding:1rem">No debts added yet. Add your first debt above.</p>';
    return;
  }
  container.innerHTML = debtList.map(d => `
    <div class="debt-item">
      <div class="debt-item-info">
        <strong>${d.name}</strong>
        <span>${formatINR(d.balance, 0)} @ ${d.rate}% p.a.</span>
      </div>
      <span class="debt-item-min">Min: ${formatINR(d.minPay, 0)}/mo</span>
      <button class="debt-remove-btn" onclick="removeDebt(${d.id})">✕</button>
    </div>
  `).join('');
}

window.calculateDebtPlan = function() {
  if (debtList.length === 0) return;

  const budget = parseFloat(document.getElementById('debtBudget')?.value) || 0;
  const totalMin = debtList.reduce((a, d) => a + d.minPay, 0);
  if (budget < totalMin) {
    setHTML('debtError', `⚠️ Monthly budget (${formatINR(budget,0)}) is less than total minimum payments (${formatINR(totalMin,0)}). Please increase your budget.`);
    revealPlanner('debtResult');
    return;
  }
  setHTML('debtError', '');

  // Clone debts for simulation
  let debts = debtList.map(d => ({ ...d }));
  let months = 0;
  let totalInterest = 0;
  const maxMonths = 600; // 50 years safety cap

  // Sort by method
  const sortDebts = () => {
    if (debtMethod === 'avalanche') {
      debts.sort((a, b) => b.rate - a.rate);      // highest rate first
    } else {
      debts.sort((a, b) => a.balance - b.balance); // lowest balance first
    }
  };

  sortDebts();

  while (debts.some(d => d.balance > 0) && months < maxMonths) {
    months++;
    let extra = budget - debts.reduce((a, d) => a + Math.min(d.minPay, d.balance > 0 ? d.balance : 0), 0);

    // Pay minimums first + accrue interest
    debts.forEach(d => {
      if (d.balance <= 0) return;
      const interest  = d.balance * d.rate / 100 / 12;
      totalInterest  += interest;
      d.balance      += interest;
      d.balance      -= Math.min(d.minPay, d.balance);
      if (d.balance < 0.01) d.balance = 0;
    });

    // Apply extra to priority debt
    sortDebts();
    for (const d of debts) {
      if (d.balance <= 0) continue;
      const payment = Math.min(extra, d.balance);
      d.balance    -= payment;
      extra        -= payment;
      if (d.balance < 0.01) d.balance = 0;
      if (extra <= 0) break;
    }
  }

  const years  = Math.floor(months / 12);
  const mths   = months % 12;
  const freedomDate = new Date();
  freedomDate.setMonth(freedomDate.getMonth() + months);
  const fdStr  = freedomDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  setHTML('debtFreedomDate',   fdStr);
  setHTML('debtMonths',        `${years > 0 ? years + ' yr' : ''} ${mths > 0 ? mths + ' mo' : ''}`);
  setHTML('debtTotalInterest', formatINR(totalInterest, 0));
  setHTML('debtTotalPaid',     formatINR(totalInterest + debtList.reduce((a,d) => a + d.balance, 0) + debtList.reduce((a,d) => a + d.balance, 0), 0));

  const methodTip = debtMethod === 'avalanche'
    ? '📉 <strong>Avalanche method:</strong> You pay the highest-interest debt first. This saves the most money in interest.'
    : '⚡ <strong>Snowball method:</strong> You pay the smallest balance first. This builds momentum and motivation.';
  setHTML('debtMethodTip', methodTip);

  revealPlanner('debtResult');
};

/* ═══════════════════════════════════════════
   5. LIFE STAGE GUIDE
═══════════════════════════════════════════ */
const lifeStageContent = {
  '20s': {
    icon: '🚀',
    title: 'Your 20s — Build the Foundation',
    subtitle: 'The most powerful decade for compounding. Every rupee invested now is worth 16× at retirement (at 12% over 30 years).',
    milestones: [
      { icon: '💼', title: 'Start investing immediately — even ₹1,000/month', desc: 'Time is your biggest asset. A ₹1,000 SIP started at 22 beats ₹10,000 started at 32 over 30 years due to compounding.' },
      { icon: '🛡️', title: 'Buy term insurance if anyone depends on you', desc: 'At 25, ₹1 Cr term cover costs ₹8,000/year. At 35, it costs ₹15,000+. Lock in low rates now.' },
      { icon: '🏥', title: 'Get independent health insurance — don\'t rely on employer', desc: 'Employer covers end when you leave. Get a ₹5L personal floater for ₹3,000–5,000/year.' },
      { icon: '💰', title: 'Build 3-month emergency fund before investing in equities', desc: 'Without emergency savings, you\'ll break your SIPs when life happens. Build ₹1–2L in a liquid fund first.' },
      { icon: '🎓', title: 'Learn — read 2 personal finance books a year', desc: 'The Intelligent Investor, Let\'s Talk Money, Psychology of Money. Your financial IQ is your real asset.' },
    ]
  },
  '30s': {
    icon: '🏗️',
    title: 'Your 30s — Build Aggressively',
    subtitle: 'Peak income years. Maximize investments while managing family responsibilities. This is your wealth accumulation decade.',
    milestones: [
      { icon: '📈', title: 'Scale up SIPs to 20-30% of income', desc: 'As income grows, increase SIP proportionally. If you earn ₹1L, invest ₹20-30K. Automate with SIP date set to salary day + 3.' },
      { icon: '🏠', title: 'If buying a home, keep EMI < 35% of take-home', desc: 'Don\'t over-leverage. Maintain your investment rate even while paying EMI. Treat home as lifestyle, not investment.' },
      { icon: '👨‍👩‍👧', title: 'Start education fund for children the day they\'re born', desc: 'Education inflation is 10-12%/year. For a child born today, college in 18 years will cost ₹30-60L. Start a ₹3K SIP now.' },
      { icon: '🔄', title: 'Review and increase life insurance as income grows', desc: 'Your cover should be 10-15× annual income. If your income grew from ₹6L to ₹15L, your cover should be ₹1.5-2 Cr now.' },
      { icon: '📊', title: 'Diversify portfolio: equity, debt, gold, real estate', desc: '70% equity / 20% debt / 10% gold is a good thumb rule for 30s. Rebalance annually.' },
    ]
  },
  '40s': {
    icon: '⚖️',
    title: 'Your 40s — Consolidate & Protect',
    subtitle: 'Shift from pure accumulation to balanced growth and protection. Retirement is 15-20 years away — start getting serious.',
    milestones: [
      { icon: '📉', title: 'Gradually reduce equity exposure to 60-70%', desc: 'Start shifting 2-3% from equity to debt every 2 years. By 50, aim for 60% equity / 40% debt allocation.' },
      { icon: '🧾', title: 'Maximize NPS contributions for tax benefits', desc: 'Extra ₹50K under 80CCD(1B) saves ₹15K tax in 30% bracket. At 40, NPS corpus will compound for 20 years till retirement.' },
      { icon: '🏥', title: 'Upgrade health cover to ₹15-25 Lakh', desc: 'Medical costs in 50s can be ₹3-5L per hospitalization. Super top-up plans offer ₹15L cover for just ₹5-8K/year.' },
      { icon: '📝', title: 'Create or update your Will', desc: 'Many Indians die intestate. A Will ensures your family gets assets without legal disputes. Use a lawyer — it\'s a one-time cost.' },
      { icon: '💳', title: 'Clear all high-interest debt by 45', desc: 'Enter 50s debt-free except possibly home loan. Personal loans, credit card debt, car loans — close them all.' },
    ]
  },
  '50s': {
    icon: '🌅',
    title: 'Your 50s & Beyond — Preservation & Income',
    subtitle: 'The final stretch before retirement. Shift focus from growth to capital preservation and building retirement income.',
    milestones: [
      { icon: '🔄', title: 'Shift to 40-50% equity, 50-60% debt', desc: 'Reduce volatility. Your portfolio cannot afford a 40% drawdown when retirement is 5-10 years away. Be conservative.' },
      { icon: '💰', title: 'Start building retirement income streams', desc: 'SWP (Systematic Withdrawal Plan) from mutual funds, SCSS (Senior Citizen Savings Scheme), RBI floating rate bonds — build multiple sources.' },
      { icon: '🏦', title: 'Don\'t dip into retirement corpus for children\'s needs', desc: 'You can take a loan for education or marriage — not for retirement. Your children have 30+ years to recover; you don\'t.' },
      { icon: '🧠', title: 'Plan for long-term care and health costs', desc: 'Keep ₹15-20L liquid specifically for medical emergencies. Consider critical illness cover if not already done.' },
      { icon: '📋', title: 'Nominate, inform, organize your financial portfolio', desc: 'Ensure nominees are updated across all accounts, MF folios, insurance policies. Share a consolidated list with your family.' },
    ]
  }
};

window.showLifeStage = function(stage) {
  document.querySelectorAll('.life-stage-card').forEach(c =>
    c.classList.toggle('active', c.getAttribute('data-stage') === stage)
  );

  const content = lifeStageContent[stage];
  if (!content) return;

  const detailContainer = document.getElementById('lifeStageDetail');
  if (!detailContainer) return;

  detailContainer.innerHTML = `
    <div class="life-stage-detail-header">
      <span class="life-stage-emoji">${content.icon}</span>
      <div>
        <h3>${content.title}</h3>
        <p>${content.subtitle}</p>
      </div>
    </div>
    <div class="life-milestones">
      ${content.milestones.map((m, i) => `
        <div class="milestone-item" style="animation-delay:${i * 80}ms">
          <div class="milestone-icon">${m.icon}</div>
          <div class="milestone-content">
            <h4>${m.title}</h4>
            <p>${m.desc}</p>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  detailContainer.style.display = 'block';
  detailContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

/* ═══════════════════════════════════════════
   6. NET WORTH TRACKER
═══════════════════════════════════════════ */
window.calculateNetWorth = function() {
  // Assets
  const assets = {
    'Savings & Current Account' : getVal('nwSavings'),
    'Fixed Deposits'            : getVal('nwFD'),
    'Mutual Funds'              : getVal('nwMF'),
    'Direct Stocks / ETFs'      : getVal('nwStocks'),
    'PPF / EPF / NPS'           : getVal('nwPPF'),
    'Real Estate (market value)': getVal('nwRealEstate'),
    'Gold / Silver'             : getVal('nwGold'),
    'Vehicle (current value)'   : getVal('nwVehicle'),
    'Other Assets'              : getVal('nwOther'),
  };

  // Liabilities
  const liabilities = {
    'Home Loan Outstanding'     : getVal('nwHomeLoan'),
    'Car Loan Outstanding'      : getVal('nwCarLoan'),
    'Personal Loan'             : getVal('nwPersonalLoan'),
    'Credit Card Outstanding'   : getVal('nwCreditCard'),
    'Education Loan'            : getVal('nwEduLoan'),
    'Other Loans'               : getVal('nwOtherLoan'),
  };

  const totalAssets      = Object.values(assets).reduce((a, b) => a + b, 0);
  const totalLiabilities = Object.values(liabilities).reduce((a, b) => a + b, 0);
  const netWorth         = totalAssets - totalLiabilities;

  setHTML('nwTotalAssets',      formatINR(totalAssets,      0));
  setHTML('nwTotalLiabilities', formatINR(totalLiabilities, 0));
  setHTML('nwNetWorth',         formatINR(netWorth,         0));

  const nwEl = document.getElementById('nwNetWorth');
  if (nwEl) {
    nwEl.style.color = netWorth >= 0 ? '#16a34a' : '#dc2626';
  }

  // Net worth interpretation
  let msg = '';
  if (netWorth < 0)       msg = '⚠️ Negative net worth — focus on clearing debt before investing.';
  else if (netWorth < 100000)  msg = '🌱 You\'re starting your journey. Keep building consistently.';
  else if (netWorth < 1000000) msg = '📈 Good progress! Stay consistent with investments.';
  else if (netWorth < 10000000)msg = '💪 Solid net worth! Focus on accelerating growth.';
  else                    msg = '🏆 Excellent! You\'re in the top percentile of Indian savers.';
  setHTML('nwMessage', msg);

  // Asset allocation chart (simple text-based bars)
  buildAssetAllocation(assets, totalAssets);

  revealPlanner('nwResult');
};

function buildAssetAllocation(assets, total) {
  const container = document.getElementById('nwAssetAllocation');
  if (!container || total === 0) return;

  const colors = ['#1A3A5C','#2E86AB','#E05C1A','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#64748b'];
  const entries = Object.entries(assets).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  container.innerHTML = entries.map(([name, value], i) => {
    const pct = Math.round((value / total) * 100);
    return `
      <div class="allocation-row">
        <div class="alloc-label">
          <span class="alloc-dot" style="background:${colors[i % colors.length]}"></span>
          ${name}
        </div>
        <div class="alloc-bar-wrap">
          <div class="alloc-bar" style="width:${pct}%;background:${colors[i % colors.length]}"></div>
        </div>
        <div class="alloc-pct">${pct}%</div>
        <div class="alloc-val">${formatINRShort(value)}</div>
      </div>
    `;
  }).join('');
}

function getVal(id) {
  const el = document.getElementById(id);
  const v  = parseFloat(el?.value) || 0;
  return isNaN(v) ? 0 : v;
}

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function revealPlanner(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = '';
  if (!el.classList.contains('visible')) {
    el.classList.add('visible');
    el.style.opacity  = '0';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .4s ease';
      el.style.opacity    = '1';
    });
  }
}

// Use window.formatINR and window.formatINRShort from main.js
// Fallback if loaded standalone
if (typeof formatINR === 'undefined') {
  window.formatINR = (n, d = 0) => '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}
if (typeof formatINRShort === 'undefined') {
  window.formatINRShort = (n) => {
    const a = Math.abs(n);
    if (a >= 1e7) return '₹' + (a / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return '₹' + (a / 1e5).toFixed(2) + ' L';
    return '₹' + Math.round(a).toLocaleString('en-IN');
  };

/* ══════════════════════════════════════
   SUPABASE SAVE PLAN
══════════════════════════════════════ */
const PLANNER_SUPABASE_URL  = 'https://zfjeflpvwizlteflypsx.supabase.co';
const PLANNER_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmamVmbHB2d2l6bHRlZmx5cHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MzI3NDQsImV4cCI6MjA4ODIwODc0NH0.ByQFv9bNnc1ibdeE1nWoHhqIKFw-mGxFbb2nsPc7F_s';

/**
 * Collect data from all planner tabs and save to Supabase planner_journeys table.
 * Requires the user to be authenticated (Supabase session must exist).
 */
window.savePlannerToSupabase = async function() {
  const btn = document.getElementById('savePlannerBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    /* 1. Get current auth session */
    const sessionRes = await fetch(`${PLANNER_SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': PLANNER_SUPABASE_ANON, 'Authorization': `Bearer ${PLANNER_SUPABASE_ANON}` }
    });
    const sessionData = await sessionRes.json();

    /* Check for a stored access token (set during login) */
    let accessToken = PLANNER_SUPABASE_ANON;
    const stored = Object.keys(localStorage)
      .find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (stored) {
      try {
        const parsed = JSON.parse(localStorage.getItem(stored));
        if (parsed?.access_token) accessToken = parsed.access_token;
      } catch (_) {}
    }

    /* 2. Verify the user is logged in */
    const meRes  = await fetch(`${PLANNER_SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': PLANNER_SUPABASE_ANON, 'Authorization': `Bearer ${accessToken}` }
    });
    const meData = await meRes.json();

    if (!meData?.id) {
      alert('Please log in to save your plan. Your plan data is still visible on this page.');
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save My Plan'; }
      return;
    }

    /* 3. Collect planner data from the page */
    const g = (id) => { const el = document.getElementById(id); return el ? (el.value || el.textContent || '') : ''; };
    const gn = (id) => parseFloat(document.getElementById(id)?.value) || 0;

    const plannerData = {
      monthly_income:   gn('income-salary') + gn('income-business') + gn('income-freelance') + gn('income-rent') + gn('income-other'),
      monthly_expenses: gn('exp-rent') + gn('exp-food') + gn('exp-transport') + gn('exp-health') + gn('exp-entertainment') + gn('exp-shopping') + gn('exp-utilities') + gn('exp-subscriptions') + gn('exp-other'),
      existing_corpus:  gn('nw-cash') + gn('nw-stocks') + gn('nw-mf') + gn('nw-ppf') + gn('nw-epf') + gn('nw-fd') + gn('nw-realestate') + gn('nw-gold') + gn('nw-crypto') + gn('nw-other'),
      risk_profile:     'balanced',
      profile_data: {
        budget: {
          income: { salary: gn('income-salary'), business: gn('income-business'), freelance: gn('income-freelance'), rent: gn('income-rent'), other: gn('income-other') },
          expenses: { rent: gn('exp-rent'), food: gn('exp-food'), transport: gn('exp-transport'), health: gn('exp-health'), entertainment: gn('exp-entertainment'), shopping: gn('exp-shopping'), utilities: gn('exp-utilities'), subscriptions: gn('exp-subscriptions'), other: gn('exp-other') }
        },
        netWorth: {
          assets: { cash: gn('nw-cash'), stocks: gn('nw-stocks'), mf: gn('nw-mf'), ppf: gn('nw-ppf'), epf: gn('nw-epf'), fd: gn('nw-fd'), realestate: gn('nw-realestate'), gold: gn('nw-gold'), crypto: gn('nw-crypto'), other: gn('nw-other') },
          liabilities: { homeloan: gn('nw-homeloan'), carloan: gn('nw-carloan'), personalloan: gn('nw-personalloan'), creditcard: gn('nw-creditcard'), other: gn('nw-otherliab') }
        }
      },
      goals: window._selectedGoals || [],
      report_text: `ArthaPlanner snapshot saved on ${new Date().toLocaleDateString('en-IN')}`
    };

    /* 4. Upsert to planner_journeys (unique per user_id) */
    const upsertRes = await fetch(`${PLANNER_SUPABASE_URL}/rest/v1/planner_journeys?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        'apikey': PLANNER_SUPABASE_ANON,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ user_id: meData.id, ...plannerData })
    });

    if (!upsertRes.ok) {
      const err = await upsertRes.text();
      throw new Error(err);
    }

    if (btn) { btn.disabled = false; btn.textContent = '✅ Plan Saved!'; }
    setTimeout(() => { if (btn) btn.textContent = '💾 Save My Plan'; }, 3000);
    if (typeof window.showToast === 'function') window.showToast('Plan saved to your account!', 'success');

  } catch (err) {
    console.error('Save plan error:', err);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save My Plan'; }
    alert('Could not save plan: ' + err.message);
  }
};
}

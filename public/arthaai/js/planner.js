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
  // Support both toggleGoal(el) and toggleGoal(el, goalId)
  if (!goalId) goalId = el.getAttribute('data-goal');
  if (!goalId) return;

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
  const goalName = document.getElementById('goal-name')?.value || 'My Goal';
  const target   = parseFloat(document.getElementById('goal-amount')?.value) || 1000000;
  const targetYear = parseFloat(document.getElementById('goal-year')?.value) || (new Date().getFullYear() + 5);
  const years    = Math.max(1, targetYear - new Date().getFullYear());
  const saved    = parseFloat(document.getElementById('goal-saved')?.value)  || 0;
  const rate     = 12; // assume 12% p.a. equity return

  if (target <= 0 || years <= 0) return;

  const rMonthly  = rate / 100 / 12;
  const n         = years * 12;
  const fvSaved   = saved * Math.pow(1 + rate / 100, years);
  const remaining = Math.max(0, target - fvSaved);

  const monthlySIP = remaining > 0
    ? remaining * rMonthly / ((Math.pow(1 + rMonthly, n) - 1) * (1 + rMonthly))
    : 0;

  const totalInvested = monthlySIP * n;

  setHTML('goal-monthly-sip',  formatINR(monthlySIP, 0));
  setHTML('goal-result-sub',   `${goalName} — ${years} years at 12% expected returns`);
  setHTML('goal-target-show',  formatINR(target, 0));
  setHTML('goal-years',        years + ' yrs');
  setHTML('goal-total-invest', formatINR(totalInvested, 0));

  revealPlanner('goal-result');
};

function renderSelectedGoalsList() {
  const container = document.getElementById('selectedGoalsList');
  if (!container) return;
  if (selectedGoals.size === 0) {
    container.innerHTML = '<p style="color:var(--gray-400);font-size:.85rem">Select goals above to see them here.</p>';
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
window.updateBudgetChart = function() {
  const income = parseFloat(document.getElementById('budget-income')?.value) || 0;
  if (income <= 0) return;

  // Collect from budget inputs — HTML uses IDs like b-rent, b-groceries etc
  const needsTotal = (parseFloat(document.getElementById('b-rent')?.value) || 0)
                   + (parseFloat(document.getElementById('b-groceries')?.value) || 0)
                   + (parseFloat(document.getElementById('b-transport')?.value) || 0)
                   + (parseFloat(document.getElementById('b-utilities')?.value) || 0);

  const wantsTotal = (parseFloat(document.getElementById('b-dining')?.value) || 0)
                   + (parseFloat(document.getElementById('b-entertainment')?.value) || 0)
                   + (parseFloat(document.getElementById('b-shopping')?.value) || 0);

  const savingsTotal = (parseFloat(document.getElementById('b-investments')?.value) || 0)
                     + (parseFloat(document.getElementById('b-emergency')?.value) || 0);

  const totalSpent = needsTotal + wantsTotal + savingsTotal;

  const needsPct   = income > 0 ? Math.round((needsTotal   / income) * 100) : 0;
  const wantsPct   = income > 0 ? Math.round((wantsTotal   / income) * 100) : 0;
  const savingsPct = income > 0 ? Math.round((savingsTotal / income) * 100) : 0;
  const surplus    = income - totalSpent;

  // Update result box values
  setHTML('budget-balance',     formatINR(surplus, 0));
  const balSub = document.getElementById('budget-balance-sub');
  if (balSub) balSub.textContent = surplus >= 0 ? 'Monthly surplus' : 'Monthly deficit ⚠️';

  setHTML('budget-needs',   formatINR(needsTotal, 0));
  setHTML('budget-wants',   formatINR(wantsTotal, 0));
  setHTML('budget-savings', formatINR(savingsTotal, 0));

  // Update 50-30-20 health bars
  updateBudgetBar('budget-needs-bar',   needsPct,   50);
  updateBudgetBar('budget-wants-bar',   wantsPct,   30);
  updateBudgetBar('budget-savings-bar', savingsPct, 20);

  setHTML('budget-needs-pct',   needsPct   + '%');
  setHTML('budget-wants-pct',   wantsPct   + '%');
  setHTML('budget-savings-pct', savingsPct + '%');

  revealPlanner('budget-result');
  if (window.fetchAIInsights) fetchAIInsights('Budget Builder (50-30-20 Rule)', 'budget-result');
};

// Alias for backward compat
window.updateBudget = window.updateBudgetChart;

window.updateBudgetSuggestions = function() {
  const income = parseFloat(document.getElementById('budget-income')?.value) || 0;
  // Update suggested labels
  setHTML('bs-rent', `Suggested: ${formatINR(income * 0.25, 0)}`);
  setHTML('bs-groceries', `Suggested: ${formatINR(income * 0.10, 0)}`);
  setHTML('bs-transport', `Suggested: ${formatINR(income * 0.0625, 0)}`);
  setHTML('bs-savings', `Suggested: ${formatINR(income * 0.20, 0)}`);
};

function updateBudgetBar(id, pct, target) {
  const bar = document.getElementById(id);
  if (!bar) return;
  bar.style.width = Math.min(pct, 100) + '%';
  if (id.includes('savings')) {
    // For savings, green if >= target
    bar.style.background = pct >= target ? '#22c55e' : pct >= target * 0.5 ? '#f59e0b' : '#ef4444';
  } else {
    // For needs/wants, green if <= target
    bar.style.background = pct <= target ? '#22c55e' : pct <= target * 1.25 ? '#f59e0b' : '#ef4444';
  }
}

/* ═══════════════════════════════════════════
   3. EMERGENCY FUND CALCULATOR
═══════════════════════════════════════════ */
window.calculateEmergencyFund = function() {
  const expenses   = parseFloat(document.getElementById('ef-expenses')?.value)   || 40000;
  const months     = parseFloat(document.getElementById('ef-months')?.value)     || 6;
  const currentSav = parseFloat(document.getElementById('ef-current')?.value)    || 0;
  const monthly    = parseFloat(document.getElementById('ef-monthly')?.value)    || 5000;

  const target   = expenses * months;
  const gap      = Math.max(0, target - currentSav);
  const timeline = gap > 0 && monthly > 0 ? Math.ceil(gap / monthly) : 0;

  setHTML('ef-target',     formatINR(target, 0));
  setHTML('ef-saved-show', formatINR(currentSav, 0));
  setHTML('ef-gap',        formatINR(gap, 0));

  const timelineText = gap <= 0 ? '✅ Fully funded! Great job!' :
    `⏳ At ${formatINR(monthly, 0)}/month, you'll reach your target in <strong>${timeline} months</strong> (${Math.ceil(timeline / 12)} year${timeline > 12 ? 's' : ''}).`;
  setHTML('ef-timeline', timelineText);

  revealPlanner('ef-result');
  if (window.fetchAIInsights) fetchAIInsights('Emergency Fund Calculator', 'ef-result');
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
  // Also toggle by ID
  const avEl = document.getElementById('method-avalanche');
  const snEl = document.getElementById('method-snowball');
  if (avEl) avEl.classList.toggle('active', method === 'avalanche');
  if (snEl) snEl.classList.toggle('active', method === 'snowball');
  if (debtList.length > 0) calculateDebtPlan();
};

window.addDebt = function() {
  const name    = document.getElementById('debt-name')?.value   || 'Loan';
  const balance = parseFloat(document.getElementById('debt-balance')?.value)  || 0;
  const rate    = parseFloat(document.getElementById('debt-rate')?.value)     || 0;
  const minPay  = parseFloat(document.getElementById('debt-min')?.value)      || 0;

  if (balance <= 0 || rate <= 0) {
    if (window.showToast) showToast('Please enter valid balance and interest rate.', 'error');
    return;
  }

  debtList.push({ id: Date.now(), name, balance, rate, minPay });
  renderDebtList();
  // Clear inputs
  ['debt-name','debt-balance','debt-rate','debt-min'].forEach(id => {
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
    const res = document.getElementById('debt-result');
    if (res) res.style.display = 'none';
  }
};

function renderDebtList() {
  const container = document.getElementById('debt-list');
  if (!container) return;
  if (debtList.length === 0) {
    container.innerHTML = '<p style="color:var(--gray-400);font-size:.85rem;text-align:center;padding:1rem">No debts added yet. Add your first debt above.</p>';
    return;
  }
  container.innerHTML = debtList.map(d => `
    <div class="debt-item">
      <div class="debt-item-header">
        <div>
          <strong>${d.name}</strong>
          <span style="font-size:0.82rem; color:var(--gray-500); margin-left:8px;">${formatINR(d.balance, 0)} @ ${d.rate}% p.a. · Min: ${formatINR(d.minPay, 0)}/mo</span>
        </div>
        <button class="debt-item-remove" onclick="removeDebt(${d.id})">✕ Remove</button>
      </div>
    </div>
  `).join('');
}

window.calculateDebtPlan = function() {
  if (debtList.length === 0) return;

  const budget = parseFloat(document.getElementById('debt-monthly-budget')?.value) || 0;
  const totalMin = debtList.reduce((a, d) => a + d.minPay, 0);
  if (budget < totalMin) {
    setHTML('debt-freedom-date', '⚠️');
    setHTML('debt-freedom-sub', `Monthly budget (${formatINR(budget,0)}) is less than total minimum payments (${formatINR(totalMin,0)}). Please increase.`);
    revealPlanner('debt-result');
    return;
  }

  // Clone debts for simulation
  let debts = debtList.map(d => ({ ...d }));
  let months = 0;
  let totalInterest = 0;
  const maxMonths = 600;
  const originalTotal = debtList.reduce((a, d) => a + d.balance, 0);

  const sortDebts = () => {
    if (debtMethod === 'avalanche') debts.sort((a, b) => b.rate - a.rate);
    else debts.sort((a, b) => a.balance - b.balance);
  };

  sortDebts();

  while (debts.some(d => d.balance > 0) && months < maxMonths) {
    months++;
    let extra = budget - debts.reduce((a, d) => a + Math.min(d.minPay, d.balance > 0 ? d.balance : 0), 0);

    debts.forEach(d => {
      if (d.balance <= 0) return;
      const interest  = d.balance * d.rate / 100 / 12;
      totalInterest  += interest;
      d.balance      += interest;
      d.balance      -= Math.min(d.minPay, d.balance);
      if (d.balance < 0.01) d.balance = 0;
    });

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

  setHTML('debt-freedom-date',  fdStr);
  setHTML('debt-freedom-sub',   `Using ${debtMethod} method`);
  setHTML('debt-total-amount',  formatINR(originalTotal, 0));
  setHTML('debt-interest-saved', formatINR(totalInterest, 0));
  setHTML('debt-payoff-time',   `${years > 0 ? years + ' yr ' : ''}${mths > 0 ? mths + ' mo' : ''}`);

  revealPlanner('debt-result');
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
  document.querySelectorAll('.lifestage-card').forEach(c => {
    const s = c.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    c.classList.toggle('active', s === stage);
  });

  const content = lifeStageContent[stage];
  if (!content) return;

  const detailContainer = document.getElementById('lifestage-detail');
  if (!detailContainer) return;

  const contentEl = document.getElementById('lifestage-content') || detailContainer;
  contentEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;">
      <span style="font-size:2.5rem;">${content.icon}</span>
      <div>
        <h3 style="margin-bottom:4px;">${content.title}</h3>
        <p style="color:var(--gray-500);font-size:0.9rem;">${content.subtitle}</p>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${content.milestones.map((m, i) => `
        <div class="milestone-item" style="animation-delay:${i * 80}ms">
          <div class="milestone-icon" style="background:var(--og-light);">${m.icon}</div>
          <div>
            <h4 style="font-size:0.9rem;margin-bottom:4px;">${m.title}</h4>
            <p style="font-size:0.82rem;color:var(--gray-500);margin:0;">${m.desc}</p>
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
  // Assets — using actual HTML element IDs (hyphenated)
  const assets = {
    'Savings & Bank Accounts'   : getVal('nw-savings'),
    'Fixed Deposits / RD'       : getVal('nw-fd'),
    'Mutual Funds'              : getVal('nw-mf'),
    'Direct Stocks / ETFs'      : getVal('nw-stocks'),
    'PPF / EPF / NPS'           : getVal('nw-ppf'),
    'Real Estate (market value)': getVal('nw-realestate'),
    'Gold / Jewellery'          : getVal('nw-gold'),
    'Vehicle (current value)'   : getVal('nw-vehicle'),
  };

  // Liabilities
  const liabilities = {
    'Home Loan Outstanding'     : getVal('nw-homeloan'),
    'Car / Vehicle Loan'        : getVal('nw-carloan'),
    'Personal Loan'             : getVal('nw-personalloan'),
    'Credit Card Outstanding'   : getVal('nw-cc'),
    'Education Loan'            : getVal('nw-educloan'),
    'Other Loans'               : getVal('nw-other'),
  };

  const totalAssets      = Object.values(assets).reduce((a, b) => a + b, 0);
  const totalLiabilities = Object.values(liabilities).reduce((a, b) => a + b, 0);
  const netWorth         = totalAssets - totalLiabilities;

  setHTML('nw-value',            formatINR(netWorth, 0));
  setHTML('nw-total-assets',     formatINR(totalAssets, 0));
  setHTML('nw-total-liabilities', formatINR(totalLiabilities, 0));

  const nwEl = document.getElementById('nw-value');
  if (nwEl) nwEl.style.color = netWorth >= 0 ? '#22c55e' : '#ef4444';

  // Net worth interpretation
  let msg = '';
  if (netWorth < 0)           msg = '⚠️ Negative net worth — focus on clearing debt before investing.';
  else if (netWorth < 100000) msg = '🌱 You\'re starting your journey. Keep building consistently.';
  else if (netWorth < 1000000) msg = '📈 Good progress! Stay consistent with investments.';
  else if (netWorth < 10000000) msg = '💪 Solid net worth! Focus on accelerating growth.';
  else                         msg = '🏆 Excellent! You\'re in the top percentile of Indian savers.';
  setHTML('nw-health', msg);

  // Asset allocation
  buildAssetAllocation(assets, totalAssets);

  revealPlanner('nw-result');
  if (window.fetchAIInsights) fetchAIInsights('Net Worth Tracker', 'nw-result');
};

function buildAssetAllocation(assets, total) {
  const container = document.getElementById('nw-allocation');
  if (!container || total === 0) return;

  const colors = ['#1A3A5C','#2E86AB','#E05C1A','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#64748b'];
  const entries = Object.entries(assets).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  container.innerHTML = entries.map(([name, value], i) => {
    const pct = Math.round((value / total) * 100);
    return `
      <div style="display:flex;align-items:center;gap:8px;font-size:0.78rem;">
        <span style="width:8px;height:8px;border-radius:50%;background:${colors[i % colors.length]};flex-shrink:0;"></span>
        <span style="flex:1;color:rgba(255,255,255,0.75);">${name}</span>
        <span style="font-weight:600;color:rgba(255,255,255,0.9);">${pct}%</span>
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
}

/* ══════════════════════════════════════
   WHATSAPP SHARE (PLANNER)
══════════════════════════════════════ */
window.shareViaWhatsApp = function(elementId, title) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const statEls = el.querySelectorAll('.stat-value, .stat-big, .big-stat, [class*="stat"]');
  const labelEls = el.querySelectorAll('.stat-label, .stat-sub, [class*="label"]');
  let lines = [];

  statEls.forEach((s, i) => {
    const val = s.textContent.trim();
    const label = labelEls[i] ? labelEls[i].textContent.trim() : '';
    if (val) lines.push(label ? `${label}: ${val}` : val);
  });

  if (lines.length === 0) {
    const text = el.innerText.replace(/\n{3,}/g, '\n\n').trim();
    lines = text.split('\n').filter(l => l.trim()).slice(0, 12);
  }

  const msg = `📊 *ArthaAI — ${title || 'Financial Plan'}*\n\n` +
    lines.slice(0, 10).join('\n') +
    `\n\n🔗 Try it free: https://zyllo-spark-studio.lovable.app/arthaai` +
    `\n_Powered by ArthaAI · Zyllo Tech_`;

  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
};


══════════════════════════════════════ */
window.exportPlannerPDF = async function(elementId, filename) {
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
    pdf.text('ArthaAI — ArthaPlanner', margin, 14);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Smart Money Guidance for Every Indian', margin, 20);
    pdf.setTextColor(224, 92, 26);
    pdf.text('by Zyllo Tech Software Solutions Pvt Ltd', margin, 24);

    // Planner result image
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
    pdf.text('Disclaimer: ArthaAI planners are for educational purposes only. Not financial advice. Consult a SEBI-registered adviser.', margin, 290);
    pdf.text('Generated on ' + new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }) + ' · arthaai.zyllotech.com', margin, 294);

    pdf.save((filename || 'ArthaAI_Planner_Report') + '.pdf');
    if (window.showToast) showToast('PDF downloaded successfully!', 'success');
  } catch (err) {
    console.error('PDF export error:', err);
    if (window.showToast) showToast('PDF generation failed. Please try again.', 'error');
  } finally {
    if (btn) { btn.classList.remove('loading'); btn.textContent = '📥 Download PDF Report'; }
  }
};

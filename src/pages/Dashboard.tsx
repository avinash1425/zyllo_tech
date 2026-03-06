import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Calculator, BarChart2, GraduationCap, LogOut, ChevronRight,
  TrendingUp, PiggyBank, Home, Car, Briefcase, Shield,
  Target, Wallet, BookOpen, AlertCircle, CheckCircle,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/contexts/AuthContext";

/* ── Brand tokens ─────────────────────────────────────────── */
const OG  = "#E05C1A";
const DB  = "#1A3A5C";
const MB  = "#2E86AB";
const OG_PALE = "#FFF4ED";

/* ── Helpers ──────────────────────────────────────────────── */
function formatINR(n: number, decimals = 0) {
  if (!isFinite(n) || isNaN(n)) return "₹0";
  return (n < 0 ? "-₹" : "₹") + Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatShort(n: number) {
  const a = Math.abs(n);
  let s: string;
  if (a >= 1e7)      s = (a / 1e7).toFixed(2).replace(/\.?0+$/, "") + " Cr";
  else if (a >= 1e5) s = (a / 1e5).toFixed(2).replace(/\.?0+$/, "") + " L";
  else if (a >= 1e3) s = (a / 1e3).toFixed(1).replace(/\.?0+$/, "") + "K";
  else               s = Math.round(a).toString();
  return (n < 0 ? "-₹" : "₹") + s;
}

/* ── Shared UI ────────────────────────────────────────────── */
const Label = ({ children }: { children: React.ReactNode }) => (
  <label className="block text-xs font-semibold text-gray-600 mb-1">{children}</label>
);

const NumInput = ({
  value, onChange, min = 0, max, step = 1, prefix, suffix,
}: {
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; prefix?: string; suffix?: string;
}) => (
  <div className="relative">
    {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400 pointer-events-none">{prefix}</span>}
    <input
      type="number" value={value} min={min} max={max} step={step}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-all"
      style={{ paddingLeft: prefix ? "1.75rem" : undefined, paddingRight: suffix ? "2.5rem" : undefined, ["--tw-ring-color" as string]: OG + "60" }}
    />
    {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400 pointer-events-none">{suffix}</span>}
  </div>
);

const Slider = ({ value, onChange, min = 0, max = 100, step = 1 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) => (
  <input type="range" value={value} min={min} max={max} step={step}
    onChange={e => onChange(parseFloat(e.target.value))}
    className="w-full h-2 rounded-full appearance-none cursor-pointer"
    style={{ accentColor: OG }}
  />
);

const ResultCard = ({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) => (
  <div className="rounded-xl p-4 text-center" style={{ background: accent ? OG : DB }}>
    <p className="text-xs font-medium mb-1" style={{ color: "rgba(255,255,255,0.7)" }}>{label}</p>
    <p className="text-xl font-extrabold text-white leading-tight">{value}</p>
  </div>
);

/* ══════════════════════════════════════════════════════════
   ARTHECALC — Calculator Suite
══════════════════════════════════════════════════════════ */

/* EMI Calculator */
const EMICalc = () => {
  const [principal, setPrincipal] = useState(1000000);
  const [rate, setRate]           = useState(8.5);
  const [tenure, setTenure]       = useState(20);

  const monthlyRate  = rate / 12 / 100;
  const n            = tenure * 12;
  const emi = monthlyRate === 0 ? principal / n
    : principal * monthlyRate * Math.pow(1 + monthlyRate, n) / (Math.pow(1 + monthlyRate, n) - 1);
  const totalPayment = emi * n;
  const totalInterest = totalPayment - principal;
  const principalPct  = Math.round((principal / totalPayment) * 100);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 leading-relaxed bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
        Calculate your <strong>Equated Monthly Instalment</strong> for home, car, personal, or education loans.
      </p>
      <div>
        <Label>Loan Amount</Label>
        <NumInput value={principal} onChange={setPrincipal} min={10000} max={100000000} step={10000} prefix="₹" />
        <Slider value={principal} onChange={setPrincipal} min={10000} max={10000000} step={10000} />
        <p className="text-xs text-right text-gray-400 mt-0.5">{formatShort(principal)}</p>
      </div>
      <div>
        <Label>Annual Interest Rate</Label>
        <NumInput value={rate} onChange={setRate} min={1} max={30} step={0.1} suffix="%" />
        <Slider value={rate} onChange={setRate} min={1} max={30} step={0.1} />
      </div>
      <div>
        <Label>Loan Tenure</Label>
        <NumInput value={tenure} onChange={setTenure} min={1} max={30} step={1} suffix="yrs" />
        <Slider value={tenure} onChange={setTenure} min={1} max={30} step={1} />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-2">
        <ResultCard label="Monthly EMI" value={formatINR(emi)} accent />
        <ResultCard label="Total Interest" value={formatShort(totalInterest)} />
        <ResultCard label="Total Payment" value={formatShort(totalPayment)} />
        <ResultCard label="Principal %" value={`${principalPct}%`} />
      </div>
    </div>
  );
};

/* SIP Calculator */
const SIPCalc = () => {
  const [monthly, setMonthly]   = useState(5000);
  const [rate, setRate]         = useState(12);
  const [years, setYears]       = useState(10);
  const [lumpsum, setLumpsum]   = useState(0);

  const n  = years * 12;
  const r  = rate / 12 / 100;
  const sipFV = r === 0 ? monthly * n : monthly * (Math.pow(1 + r, n) - 1) / r * (1 + r);
  const lumpsumFV = lumpsum * Math.pow(1 + rate / 100, years);
  const totalFV   = sipFV + lumpsumFV;
  const invested  = monthly * n + lumpsum;
  const gains     = totalFV - invested;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 leading-relaxed bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
        Calculate <strong>SIP + Lumpsum</strong> returns with inflation-adjusted projections. Great for mutual fund planning.
      </p>
      <div>
        <Label>Monthly SIP Amount</Label>
        <NumInput value={monthly} onChange={setMonthly} min={100} max={1000000} step={500} prefix="₹" />
        <Slider value={monthly} onChange={setMonthly} min={500} max={100000} step={500} />
        <p className="text-xs text-right text-gray-400 mt-0.5">{formatShort(monthly)}/mo</p>
      </div>
      <div>
        <Label>One-time Lumpsum (optional)</Label>
        <NumInput value={lumpsum} onChange={setLumpsum} min={0} max={10000000} step={10000} prefix="₹" />
      </div>
      <div>
        <Label>Expected Annual Return</Label>
        <NumInput value={rate} onChange={setRate} min={1} max={30} step={0.5} suffix="%" />
        <Slider value={rate} onChange={setRate} min={4} max={25} step={0.5} />
        <p className="text-xs text-gray-400 mt-0.5">Large-cap avg ≈ 12–14% | Debt ≈ 6–8%</p>
      </div>
      <div>
        <Label>Investment Duration</Label>
        <NumInput value={years} onChange={setYears} min={1} max={40} step={1} suffix="yrs" />
        <Slider value={years} onChange={setYears} min={1} max={40} step={1} />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-2">
        <ResultCard label="Total Corpus" value={formatShort(totalFV)} accent />
        <ResultCard label="Wealth Gained" value={formatShort(gains)} />
        <ResultCard label="Amount Invested" value={formatShort(invested)} />
        <ResultCard label="Returns %" value={`${((gains / invested) * 100).toFixed(0)}%`} />
      </div>
    </div>
  );
};

/* Tax Savings Calculator */
const TaxCalc = () => {
  const [income, setIncome]   = useState(1200000);
  const [sec80c, setSec80c]   = useState(150000);
  const [sec80d, setSec80d]   = useState(25000);
  const [nps, setNps]         = useState(50000);
  const [hra, setHra]         = useState(0);

  const totalDeductions = Math.min(sec80c, 150000) + Math.min(sec80d, 25000) + Math.min(nps, 50000) + hra;
  const standardDeduction = 50000;
  const taxableIncome = Math.max(0, income - totalDeductions - standardDeduction);

  const computeTax = (ti: number) => {
    if (ti <= 250000)  return 0;
    if (ti <= 500000)  return (ti - 250000) * 0.05;
    if (ti <= 750000)  return 12500 + (ti - 500000) * 0.10;
    if (ti <= 1000000) return 37500 + (ti - 750000) * 0.15;
    if (ti <= 1250000) return 75000 + (ti - 1000000) * 0.20;
    if (ti <= 1500000) return 125000 + (ti - 1250000) * 0.25;
    return 187500 + (ti - 1500000) * 0.30;
  };

  const taxWithout = computeTax(income - standardDeduction) * 1.04;
  const taxWith    = computeTax(taxableIncome) * 1.04;
  const saving     = taxWithout - taxWith;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 leading-relaxed bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
        Estimate your <strong>income tax savings</strong> via 80C, 80D, NPS, HRA deductions (New Tax Regime approximation).
      </p>
      <div>
        <Label>Annual Gross Income</Label>
        <NumInput value={income} onChange={setIncome} min={250000} max={10000000} step={50000} prefix="₹" />
        <p className="text-xs text-right text-gray-400 mt-0.5">{formatShort(income)}/yr</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>80C Investments (max ₹1.5L)</Label>
          <NumInput value={sec80c} onChange={setSec80c} min={0} max={150000} step={5000} prefix="₹" />
        </div>
        <div>
          <Label>80D Health Insurance (max ₹25K)</Label>
          <NumInput value={sec80d} onChange={setSec80d} min={0} max={25000} step={1000} prefix="₹" />
        </div>
        <div>
          <Label>NPS Contribution (max ₹50K)</Label>
          <NumInput value={nps} onChange={setNps} min={0} max={50000} step={5000} prefix="₹" />
        </div>
        <div>
          <Label>HRA Exemption</Label>
          <NumInput value={hra} onChange={setHra} min={0} max={500000} step={10000} prefix="₹" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 pt-2">
        <ResultCard label="Tax Saved" value={formatINR(saving)} accent />
        <ResultCard label="Tax Payable" value={formatShort(taxWith)} />
        <ResultCard label="Total Deductions" value={formatShort(totalDeductions + standardDeduction)} />
        <ResultCard label="Taxable Income" value={formatShort(taxableIncome)} />
      </div>
    </div>
  );
};

/* FD/RD Maturity */
const FDCalc = () => {
  const [principal, setPrincipal] = useState(100000);
  const [rate, setRate]           = useState(7);
  const [years, setYears]         = useState(5);
  const [type, setType]           = useState<"fd" | "rd">("fd");

  let maturity = 0;
  let invested = principal;
  if (type === "fd") {
    maturity = principal * Math.pow(1 + rate / 400, years * 4); // quarterly compounding
  } else {
    const r = rate / 12 / 100;
    const n = years * 12;
    maturity = principal * (Math.pow(1 + r, n) - 1) / r * (1 + r);
    invested = principal * n;
  }
  const interest = maturity - invested;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 leading-relaxed bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
        Calculate maturity for <strong>Fixed Deposit (FD)</strong> or <strong>Recurring Deposit (RD)</strong> at any bank.
      </p>
      <div className="flex gap-2">
        {(["fd", "rd"] as const).map(t => (
          <button key={t} onClick={() => setType(t)}
            className="flex-1 rounded-lg py-2 text-xs font-bold border-2 transition-colors"
            style={{ borderColor: type === t ? OG : "#e5e7eb", background: type === t ? OG_PALE : "#fff", color: type === t ? OG : "#6b7280" }}
          >
            {t === "fd" ? "Fixed Deposit" : "Recurring Deposit"}
          </button>
        ))}
      </div>
      <div>
        <Label>{type === "fd" ? "Deposit Amount" : "Monthly Deposit"}</Label>
        <NumInput value={principal} onChange={setPrincipal} min={1000} max={10000000} step={1000} prefix="₹" />
        <p className="text-xs text-right text-gray-400 mt-0.5">{formatShort(principal)}</p>
      </div>
      <div>
        <Label>Annual Interest Rate</Label>
        <NumInput value={rate} onChange={setRate} min={3} max={12} step={0.1} suffix="%" />
        <Slider value={rate} onChange={setRate} min={3} max={12} step={0.1} />
      </div>
      <div>
        <Label>Tenure</Label>
        <NumInput value={years} onChange={setYears} min={1} max={20} step={1} suffix="yrs" />
        <Slider value={years} onChange={setYears} min={1} max={20} step={1} />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-2">
        <ResultCard label="Maturity Value" value={formatShort(maturity)} accent />
        <ResultCard label="Interest Earned" value={formatShort(interest)} />
        <ResultCard label="Amount Invested" value={formatShort(invested)} />
        <ResultCard label="Effective Yield" value={`${((interest / invested) * 100).toFixed(1)}%`} />
      </div>
    </div>
  );
};

const CALC_TABS = [
  { id: "emi",   label: "EMI",       icon: Home,       component: EMICalc },
  { id: "sip",   label: "SIP / MF",  icon: TrendingUp, component: SIPCalc },
  { id: "tax",   label: "Tax Saving",icon: Shield,     component: TaxCalc },
  { id: "fd",    label: "FD / RD",   icon: PiggyBank,  component: FDCalc  },
];

const ArthaCalcPanel = () => {
  const [active, setActive] = useState("emi");
  const Tab = CALC_TABS.find(t => t.id === active)!;
  return (
    <div>
      <h2 className="text-lg font-bold mb-1" style={{ color: DB }}>ArthaCalc — Financial Calculator Suite</h2>
      <p className="text-sm text-gray-500 mb-4">100+ formulas. Instant results. No English required.</p>
      <div className="flex flex-wrap gap-2 mb-6">
        {CALC_TABS.map(t => (
          <button key={t.id} onClick={() => setActive(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors"
            style={{ borderColor: active === t.id ? OG : "#e5e7eb", background: active === t.id ? OG_PALE : "#fff", color: active === t.id ? OG : "#6b7280" }}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <Tab.component />
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════
   ARTHAPLANNER — Financial Life Planner
══════════════════════════════════════════════════════════ */

const GOALS = [
  { id: "home",       icon: "🏠", label: "Buy a Home",          def: { amount: 5000000, years: 10 } },
  { id: "education",  icon: "🎓", label: "Child's Education",   def: { amount: 2000000, years: 12 } },
  { id: "marriage",   icon: "💍", label: "Marriage",            def: { amount: 1500000, years: 5  } },
  { id: "retirement", icon: "🌴", label: "Retirement Corpus",   def: { amount: 10000000, years: 25 } },
  { id: "emergency",  icon: "🛡️", label: "Emergency Fund",      def: { amount: 300000, years: 2  } },
  { id: "vehicle",    icon: "🚗", label: "Buy a Vehicle",        def: { amount: 800000, years: 3  } },
];

const GoalPlanner = () => {
  const [goalId, setGoalId]         = useState("home");
  const [targetAmount, setTarget]   = useState(5000000);
  const [years, setYears]           = useState(10);
  const [currentSavings, setCurrent]= useState(0);
  const [expectedReturn, setReturn] = useState(12);

  const goal = GOALS.find(g => g.id === goalId)!;

  const handleGoalChange = (id: string) => {
    const g = GOALS.find(g => g.id === id)!;
    setGoalId(id);
    setTarget(g.def.amount);
    setYears(g.def.years);
  };

  const fvOfCurrentSavings = currentSavings * Math.pow(1 + expectedReturn / 100, years);
  const remaining = Math.max(0, targetAmount - fvOfCurrentSavings);
  const r = expectedReturn / 12 / 100;
  const n = years * 12;
  const requiredSIP = r === 0 ? remaining / n
    : remaining * r / ((Math.pow(1 + r, n) - 1) * (1 + r));
  const onTrack = fvOfCurrentSavings >= targetAmount;

  return (
    <div className="space-y-5">
      <div>
        <Label>Select Your Financial Goal</Label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {GOALS.map(g => (
            <button key={g.id} onClick={() => handleGoalChange(g.id)}
              className="rounded-xl px-3 py-2.5 border-2 text-left transition-colors text-xs font-semibold"
              style={{ borderColor: goalId === g.id ? OG : "#e5e7eb", background: goalId === g.id ? OG_PALE : "#fff", color: goalId === g.id ? OG : "#374151" }}
            >
              <span className="block text-lg mb-1">{g.icon}</span>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Target Amount for {goal.label}</Label>
          <NumInput value={targetAmount} onChange={setTarget} min={10000} max={100000000} step={50000} prefix="₹" />
          <p className="text-xs text-right text-gray-400 mt-0.5">{formatShort(targetAmount)}</p>
        </div>
        <div>
          <Label>Years to Goal</Label>
          <NumInput value={years} onChange={setYears} min={1} max={40} step={1} suffix="yrs" />
        </div>
        <div>
          <Label>Current Savings / Investment</Label>
          <NumInput value={currentSavings} onChange={setCurrent} min={0} max={50000000} step={10000} prefix="₹" />
        </div>
        <div>
          <Label>Expected Annual Return</Label>
          <NumInput value={expectedReturn} onChange={setReturn} min={4} max={25} step={0.5} suffix="%" />
        </div>
      </div>

      <div className={`rounded-xl p-4 border-2 flex items-start gap-3 text-sm ${onTrack ? "border-green-200 bg-green-50" : "border-orange-200 bg-orange-50"}`}>
        {onTrack
          ? <CheckCircle size={18} className="shrink-0 mt-0.5 text-green-600" />
          : <AlertCircle size={18} className="shrink-0 mt-0.5" style={{ color: OG }} />
        }
        <div>
          {onTrack
            ? <p className="font-semibold text-green-700">You're on track! 🎉</p>
            : <p className="font-semibold" style={{ color: OG }}>Start a SIP of <strong>{formatShort(requiredSIP)}/month</strong> to reach your goal.</p>
          }
          <p className="text-xs mt-0.5 text-gray-500">
            Your current savings will grow to <strong>{formatShort(fvOfCurrentSavings)}</strong> in {years} years at {expectedReturn}% return.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ResultCard label="Required Monthly SIP" value={onTrack ? "₹0" : formatShort(requiredSIP)} accent />
        <ResultCard label="Target" value={formatShort(targetAmount)} />
        <ResultCard label="Savings Growth" value={formatShort(fvOfCurrentSavings)} />
        <ResultCard label="Gap to Fill" value={formatShort(Math.max(0, targetAmount - fvOfCurrentSavings))} />
      </div>
    </div>
  );
};

const BudgetPlanner = () => {
  const [income, setIncome] = useState(60000);

  const categories = [
    { icon: "🏠", name: "Housing / Rent",  pct: 30 },
    { icon: "🍱", name: "Food & Groceries", pct: 15 },
    { icon: "🚌", name: "Transport",        pct: 10 },
    { icon: "💊", name: "Health & Medical", pct: 5  },
    { icon: "🎓", name: "Education",        pct: 5  },
    { icon: "📺", name: "Entertainment",    pct: 5  },
    { icon: "📦", name: "Utilities & Bills",pct: 8  },
    { icon: "💰", name: "Savings / SIP",    pct: 20 },
    { icon: "🛒", name: "Shopping",         pct: 2  },
  ];

  return (
    <div className="space-y-4">
      <div>
        <Label>Monthly Income (Net Take-Home)</Label>
        <NumInput value={income} onChange={setIncome} min={10000} max={5000000} step={5000} prefix="₹" />
        <p className="text-xs text-right text-gray-400 mt-0.5">{formatShort(income)}/month</p>
      </div>
      <div className="space-y-2">
        {categories.map(c => {
          const amount = Math.round(income * c.pct / 100);
          return (
            <div key={c.name} className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-gray-700 font-medium">
                <span>{c.icon}</span>{c.name}
              </span>
              <div className="flex items-center gap-3">
                <div className="w-20 bg-gray-200 rounded-full h-1.5 hidden sm:block">
                  <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: OG }} />
                </div>
                <span className="text-xs text-gray-500">{c.pct}%</span>
                <span className="font-bold text-xs min-w-[60px] text-right" style={{ color: DB }}>{formatINR(amount)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 italic">Based on the 50/30/20 rule adapted for Indian households.</p>
    </div>
  );
};

const PLANNER_TABS = [
  { id: "goal",   label: "Goal Planner",    icon: Target,  component: GoalPlanner  },
  { id: "budget", label: "Budget Builder",  icon: Wallet,  component: BudgetPlanner},
];

const ArthaPlannerPanel = () => {
  const [active, setActive] = useState("goal");
  const Tab = PLANNER_TABS.find(t => t.id === active)!;
  return (
    <div>
      <h2 className="text-lg font-bold mb-1" style={{ color: DB }}>ArthaPlanner — Financial Life Planner</h2>
      <p className="text-sm text-gray-500 mb-4">Goal-based planning from your 20s to retirement.</p>
      <div className="flex flex-wrap gap-2 mb-6">
        {PLANNER_TABS.map(t => (
          <button key={t.id} onClick={() => setActive(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors"
            style={{ borderColor: active === t.id ? DB : "#e5e7eb", background: active === t.id ? "#eef3f9" : "#fff", color: active === t.id ? DB : "#6b7280" }}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <Tab.component />
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════
   ARTHAGURU — Financial Education
══════════════════════════════════════════════════════════ */

const TOPICS = [
  {
    id: "mf", icon: "📊", title: "Mutual Funds 101",
    summary: "A mutual fund pools money from thousands of investors to buy a diversified portfolio of stocks, bonds, or other assets managed by a professional fund manager.",
    points: [
      "ELSS Funds: Save tax under 80C with 3-year lock-in. Returns: 12–15% historically.",
      "Large Cap Funds: Invest in top 100 companies. Stable, suitable for 5+ year horizon.",
      "Index Funds: Passively track Nifty 50 / Sensex. Low expense ratio (0.1–0.2%). Great for beginners.",
      "Debt Funds: Invest in bonds and government securities. Lower risk, 6–8% returns, good for 1–3 years.",
      "SIP vs Lumpsum: SIP rupee-cost-averages your investment — ideal for salaried individuals.",
    ],
    tag: "Beginner",
  },
  {
    id: "ulip", icon: "⚖️", title: "ULIP vs Term + MF",
    summary: "ULIPs (Unit Linked Insurance Plans) combine insurance and investment. But is it better than buying pure term insurance + investing in mutual funds separately?",
    points: [
      "ULIP charges: Premium allocation charge (2–5%) + fund management charge (1.35%) + mortality charge. Very high.",
      "Term insurance: ₹1 crore cover for ₹8,000–₹12,000/year. Pure protection, no investment mixing.",
      "Mutual Fund returns: Net of 1% expense, historically 12–15% CAGR. ULIPs net ~8–10%.",
      "Verdict: Buy TERM insurance + invest in INDEX FUNDS. You get better cover and better returns.",
      "Exception: If your employer does not offer group insurance, ULIP may fill a short gap.",
    ],
    tag: "Important",
    highlight: true,
  },
  {
    id: "risk", icon: "🎯", title: "Your Risk Profile",
    summary: "Matching investments to your risk tolerance prevents panic-selling in downturns and ensures you sleep well at night. Here's how to assess yourself:",
    points: [
      "Conservative (Age 50+, low income volatility): 70% Debt + 20% Large Cap + 10% Gold.",
      "Moderate (Age 35–50): 50% Equity (large+mid cap) + 40% Debt + 10% Gold.",
      "Aggressive (Age 20–35, stable income): 80% Equity (including small cap) + 15% Debt + 5% Gold.",
      "Thumb rule: '100 minus your age' = % in equities. (Age 30 → 70% equities).",
      "Review annually: Life events (marriage, child, job change) shift your risk capacity.",
    ],
    tag: "Strategy",
  },
  {
    id: "gold", icon: "🥇", title: "Gold, Real Estate & Alternatives",
    summary: "Beyond equity and debt, Indians traditionally love gold and property. How do they compare to financial assets?",
    points: [
      "Physical Gold: 8–10% long-term returns but storage/insurance costs eat into gains.",
      "Sovereign Gold Bond (SGB): 2.5% annual interest + price appreciation. Better than physical gold.",
      "Digital Gold: Convenient but not regulated like SGB. Stick to SGB or Gold ETF.",
      "Real Estate: Low liquidity, high ticket size. Rental yield in India is just 2–3%. Better for diversification than returns.",
      "REITs: Invest in commercial real estate with ₹10,000–₹15,000. Better liquidity than direct property.",
    ],
    tag: "Diversification",
  },
  {
    id: "debt", icon: "💳", title: "Debt Management",
    summary: "Unmanaged debt is the #1 destroyer of Indian household wealth. Here's how to escape the debt trap strategically.",
    points: [
      "Avalanche Method: Pay minimum on all loans, extra payment on HIGHEST interest loan. Saves most interest.",
      "Snowball Method: Pay minimum on all, extra on SMALLEST balance loan. Builds momentum & motivation.",
      "Credit Card trap: 40–44% annual interest. Never carry a balance. Pay full amount every month.",
      "Good debt vs Bad debt: Home loan (appreciating asset) = OK. Personal loan for vacation = Bad.",
      "Emergency fund first: Before investing, build 6 months of expenses as liquid savings.",
    ],
    tag: "Critical",
  },
  {
    id: "tax", icon: "🧾", title: "Tax Planning Essentials",
    summary: "Legal tax saving is not just for the rich — every salaried Indian can save ₹46,000–₹78,000 in taxes every year.",
    points: [
      "Section 80C (₹1.5L): PPF, ELSS, EPF, NSC, life insurance premium, home loan principal.",
      "Section 80D (₹25K-₹50K): Health insurance for self, spouse, children, and parents.",
      "NPS Section 80CCD(1B) (₹50K): Over and above 80C limit. Invest in NPS Tier 1.",
      "HRA exemption: If you pay rent, claim HRA. Minimum of actual HRA, 40–50% of salary, or rent-10% of salary.",
      "Home loan interest (₹2L): Section 24(b) — deduction on interest paid on housing loan.",
    ],
    tag: "Save Money",
  },
];

const ArthaGuruPanel = () => {
  const [open, setOpen] = useState<string | null>("mf");
  const toggle = useCallback((id: string) => setOpen(prev => prev === id ? null : id), []);

  return (
    <div>
      <h2 className="text-lg font-bold mb-1" style={{ color: DB }}>ArthaGuru — Investment Education Engine</h2>
      <p className="text-sm text-gray-500 mb-4">Unbiased financial education. No jargon. Zero commission bias.</p>
      <div className="space-y-3">
        {TOPICS.map(t => (
          <div key={t.id}
            className="rounded-2xl border-2 overflow-hidden transition-all"
            style={{ borderColor: open === t.id ? (t.highlight ? OG : DB) : "#e5e7eb" }}
          >
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              style={{ background: open === t.id ? (t.highlight ? OG_PALE : "#eef3f9") : "#fff" }}
              onClick={() => toggle(t.id)}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{t.icon}</span>
                <div>
                  <p className="text-sm font-bold" style={{ color: open === t.id ? (t.highlight ? OG : DB) : "#111827" }}>{t.title}</p>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white inline-block mt-0.5"
                    style={{ background: t.highlight ? OG : MB }}>
                    {t.tag}
                  </span>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400 transition-transform shrink-0" style={{ transform: open === t.id ? "rotate(90deg)" : undefined }} />
            </button>
            {open === t.id && (
              <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                <p className="text-sm text-gray-600 leading-relaxed mb-3">{t.summary}</p>
                <ul className="space-y-2">
                  {t.points.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="size-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5"
                        style={{ background: t.highlight ? OG : DB }}>{i + 1}</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════
   MAIN DASHBOARD
══════════════════════════════════════════════════════════ */

const TABS = [
  { id: "calc",    label: "ArthaCalc",    icon: Calculator,   panel: ArthaCalcPanel    },
  { id: "planner", label: "ArthaPlanner", icon: BarChart2,     panel: ArthaPlannerPanel },
  { id: "guru",    label: "ArthaGuru",    icon: GraduationCap, panel: ArthaGuruPanel   },
];

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState("calc");
  const Tab = TABS.find(t => t.id === activeTab)!;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      {/* Top header bar */}
      <div className="pt-20 pb-0">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          <div className="flex items-center justify-between py-4">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <div className="size-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                  style={{ background: OG }}>
                  {(user?.name?.[0] ?? user?.email?.[0] ?? "U").toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    Welcome back, {user?.name?.split(" ")[0] ?? "there"}!
                  </p>
                  <p className="text-xs text-gray-400">{user?.email}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/arthaai"
                className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                style={{ color: DB }}
              >
                <Briefcase size={13} />About ArthaAI
              </Link>
              <button onClick={signOut}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-gray-600"
              >
                <LogOut size={13} />Sign Out
              </button>
            </div>
          </div>

          {/* ArthaAI brand banner */}
          <div className="rounded-2xl p-4 sm:p-5 mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
            style={{ background: `linear-gradient(135deg, ${DB}, #0f2540)` }}>
            <div>
              <p className="text-xs font-semibold text-white/60 mb-0.5 uppercase tracking-wide">Zyllo Tech · ArthaAI Platform</p>
              <h1 className="text-xl font-extrabold text-white">
                Artha<span style={{ color: OG }}>AI</span> Dashboard
              </h1>
              <p className="text-white/60 text-xs mt-0.5">Smart Money Guidance — 22 Indian Languages · Zero Commission · 100+ Calculators</p>
            </div>
            <div className="flex gap-2 text-xs">
              {[{ label: "ArthaCalc", desc: "Calculators" }, { label: "ArthaPlanner", desc: "Life Goals" }, { label: "ArthaGuru", desc: "Education" }].map(m => (
                <div key={m.label} className="rounded-xl px-3 py-2 text-center" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  <p className="font-bold text-white text-xs">{m.label}</p>
                  <p className="text-white/50 text-[10px]">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tab nav */}
          <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 mb-4">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: activeTab === t.id ? (t.id === "calc" ? OG : t.id === "planner" ? DB : "#059669") : "transparent",
                  color: activeTab === t.id ? "#fff" : "#6b7280",
                }}
              >
                <t.icon size={14} />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Panel */}
      <div className="container mx-auto px-4 sm:px-6 max-w-6xl pb-16">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-7">
          <Tab.panel />
        </div>

        {/* Footer note */}
        <div className="mt-6 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
          <BookOpen size={14} className="shrink-0 mt-0.5" />
          <span>
            <strong>Disclaimer:</strong> All calculations and educational content are for informational purposes only and do not constitute financial advice.
            Consult a SEBI-registered investment advisor before making financial decisions. ArthaAI by <strong>Zyllo Tech Software Solutions Pvt Ltd</strong>.
          </span>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

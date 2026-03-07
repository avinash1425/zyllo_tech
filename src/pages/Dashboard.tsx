import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Send, Sparkles, Calculator, LogOut,
  TrendingUp, Shield, Home, Car, Target,
  RefreshCw, Zap, BookOpen,
  ArrowRight, Check, X, AlertCircle,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/* ── Brand ───────────────────────────────────────────────── */
const OG       = "#E05C1A";
const DB       = "#1A3A5C";
const MB       = "#2E86AB";
const OG_PALE  = "#FFF4ED";
const OG_LIGHT = "#FDDECA";
const GREEN    = "#059669";

/* ── Formatters ──────────────────────────────────────────── */
const fmt = (n: number, d = 0) =>
  !isFinite(n) || isNaN(n) ? "₹0"
    : (n < 0 ? "-₹" : "₹") + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtShort = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e7 ? (a / 1e7).toFixed(2).replace(/\.?0+$/, "") + " Cr"
    : a >= 1e5 ? (a / 1e5).toFixed(2).replace(/\.?0+$/, "") + " L"
    : a >= 1e3 ? (a / 1e3).toFixed(1).replace(/\.?0+$/, "") + "K"
    : Math.round(a).toString();
  return (n < 0 ? "-₹" : "₹") + s;
};

const sipFutureValueWithStepUp = (monthly: number, annualStepUpPct: number, annualReturnPct: number, years: number) => {
  const monthlyReturn = annualReturnPct / 12 / 100;
  let corpus = 0;
  for (let y = 0; y < years; y += 1) {
    const sip = monthly * Math.pow(1 + annualStepUpPct / 100, y);
    for (let m = 0; m < 12; m += 1) corpus = corpus * (1 + monthlyReturn) + sip;
  }
  return corpus;
};

/* ═══════════════════════════════════════════════════════════
   AI CHAT — ARTHAGURU
═══════════════════════════════════════════════════════════ */

interface ChatMessage { role: "user" | "assistant"; content: string; }

/* Smart fallback responses when API key not yet configured */
const FALLBACK: Record<string, string> = {
  sip: `**Starting a SIP? Here's the smartest way:**\n\n• **Amount**: Invest at least 20% of your monthly income. Even ₹500/month matters.\n• **Fund type for beginners**: Index fund (Nifty 50) — low cost (0.1% expense ratio), consistent returns.\n• **Expected returns**: 12–14% CAGR over 10+ years historically.\n• **Power of SIP example**: ₹5,000/month × 12% × 15 years = **₹25.2 Lakhs** (invested ₹9L, gained ₹16.2L)\n\n**What to avoid**: Don't stop SIP during market falls — that's actually when you buy cheaper units.\n\n**Next step**: Open a Zerodha or Groww account, pick a Nifty 50 index fund, set up auto-debit on salary day.`,
  emi: `**Before taking any loan, check these 3 things:**\n\n1. **EMI should be ≤ 40% of take-home salary** — beyond this, finances get strained.\n2. **Effective interest rate** — home loans: 8.5–9.5%, personal loans: 12–24% (avoid if possible).\n3. **Prepayment strategy** — even one extra EMI/year saves months of loan tenure.\n\n**Home loan tip**: At 9% for ₹50L over 20 years, you pay **₹54L in interest alone** — almost double the principal. Consider 15-year tenure instead.\n\n**Next step**: Use the EMI Calculator tab to compute your exact numbers, then check if the EMI fits within 40% of your salary.`,
  tax: `**Save ₹46,800–₹78,000 in tax legally every year:**\n\n• **Section 80C** (₹1,50,000): PPF + ELSS funds — dual benefit (tax saving + wealth creation)\n• **Section 80D** (₹25,000): Health insurance premium — non-negotiable, buy term + health\n• **NPS 80CCD(1B)** (₹50,000 extra): Over and above 80C, reduces tax significantly\n• **Standard Deduction**: ₹50,000 automatic for salaried employees\n• **HRA**: If you pay rent, claim HRA — it's often ₹1–2L tax-free\n\n**Example**: For ₹12L income, total deductions of ₹2.75L + ₹50K standard = taxable income ₹8.75L. Tax saved: **₹46,800**.\n\n**Next step**: Go to Tax Calculator tab, enter your income and current investments to see your exact savings.`,
  retirement: `**How much do you need to retire comfortably?**\n\nUse the **25x rule**: If you need ₹60,000/month = ₹7.2L/year, you need **₹1.8 Crore corpus** (25 × ₹7.2L). This corpus at 4% safe withdrawal rate lasts 30+ years.\n\n**Building the corpus:**\n• At age 25, investing ₹10,000/month at 12% = **₹3.5 Cr by age 55**\n• At age 35, same investment = **₹1.1 Cr by age 55** (starting early matters enormously)\n\n**Instruments to use:**\n• NPS — tax benefit + equity growth, locked till 60\n• PPF — guaranteed 7.1%, tax-free maturity\n• ELSS mutual funds — highest returns in tax-saving category\n\n**Next step**: Open ArthaPlanner tab → set Retirement as your goal → see your required monthly SIP.`,
  insurance: `**The only insurance you truly NEED:**\n\n**1. Term Insurance** (highest priority)\n• Cover = 15–20× your annual income\n• For ₹8L income: buy ₹1.2–1.6 Cr term cover\n• Cost: Only ₹8,000–₹12,000/year for ₹1 Cr cover at age 30\n• Buy online — 30–40% cheaper than agent\n\n**2. Health Insurance** (must-have)\n• Minimum ₹10L individual + ₹20L super top-up\n• Buy young (age 25–30) before pre-existing conditions develop\n• Cost: ₹6,000–₹15,000/year\n\n**❌ What NOT to buy:**\n• ULIPs — high charges (5–8% of premium) eat your returns\n• Endowment/money-back plans — 4–5% returns, terrible\n• ULIP vs Term+MF: Term (₹12K) + SIP (₹8K) = SAME total as ULIP premium but **5× better corpus**\n\n**Next step**: Get quotes from PolicyBazaar — compare and buy pure term insurance today.`,
  emergency: `**Emergency Fund: Your financial seatbelt**\n\n**Target**: 6 months of all expenses (rent + groceries + EMIs + utilities)\n\n**Example**: Monthly expenses ₹35,000 → Emergency fund = **₹2,10,000**\n\n**Where to keep it:**\n• **50%** in high-yield savings account (7–7.5% interest)\n• **30%** in liquid mutual fund — accessible in 24 hours, ~7% returns\n• **20%** in FD — slightly higher return, 1–3 day access\n\n**What NOT to do**: Don't invest emergency fund in equity/stocks — markets can be down exactly when you need money.\n\n**Build it in 6 steps**: Calculate target → Open a separate savings account → Auto-transfer ₹X every salary day → Track progress monthly → Don't touch unless genuine emergency → Replenish immediately after using.\n\n**Next step**: Calculate your monthly expenses and multiply by 6. That's your target.`,
};

function getFallbackResponse(q: string): string {
  const lower = q.toLowerCase();
  if (lower.includes("sip") || lower.includes("mutual fund") || lower.includes("invest")) return FALLBACK.sip;
  if (lower.includes("emi") || lower.includes("loan") || lower.includes("home loan")) return FALLBACK.emi;
  if (lower.includes("tax") || lower.includes("80c") || lower.includes("save")) return FALLBACK.tax;
  if (lower.includes("retire") || lower.includes("pension") || lower.includes("nps")) return FALLBACK.retirement;
  if (lower.includes("insurance") || lower.includes("term") || lower.includes("ulip")) return FALLBACK.insurance;
  if (lower.includes("emergency") || lower.includes("fund") || lower.includes("savings")) return FALLBACK.emergency;
  return `**Great question!** Here's my guidance:\n\nAs your AI financial advisor, I'm here to help you navigate every aspect of personal finance — from investments and tax planning to insurance and retirement.\n\n**Common areas I can help with:**\n• 📈 SIP & mutual fund strategy\n• 🏠 Home loan EMI planning\n• 🧾 Tax saving (80C, 80D, NPS)\n• 🌴 Retirement corpus planning\n• 🛡️ Term & health insurance\n• 🆘 Emergency fund building\n\nTry asking me something specific like:\n*"How much SIP should I start with ₹5,000?"*\n*"How can I save tax on ₹12 lakh income?"*\n*"What insurance do I need at 30?"*\n\n**Next step**: Ask me your specific financial question and I'll give you a personalised answer.`;
}

/* Markdown-lite renderer */
const renderMD = (text: string) => {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("**") && line.endsWith("**") && !line.slice(2, -2).includes("**")) {
      return <p key={i} className="font-bold text-gray-800 mt-3 first:mt-0">{line.slice(2, -2)}</p>;
    }
    const parts: React.ReactNode[] = [];
    let remaining = line.replace(/\*\*(.*?)\*\*/g, (_, m) => `§§${m}§§`);
    remaining.split("§§").forEach((seg, j) => {
      if (j % 2 === 1) parts.push(<strong key={j} className="font-semibold text-gray-900">{seg}</strong>);
      else if (seg) parts.push(<span key={j}>{seg}</span>);
    });
    if (line.startsWith("• ") || line.startsWith("- ")) {
      return <div key={i} className="flex items-start gap-2 mt-1.5"><span className="mt-1 size-1.5 rounded-full shrink-0" style={{ background: OG }} /><p className="text-sm leading-relaxed">{parts}</p></div>;
    }
    if (line.startsWith("❌ ")) return <div key={i} className="flex items-start gap-2 mt-2"><X size={14} className="shrink-0 mt-0.5 text-red-500" /><p className="text-sm leading-relaxed">{parts}</p></div>;
    if (line.trim() === "") return <div key={i} className="h-1.5" />;
    return <p key={i} className="text-sm leading-relaxed">{parts}</p>;
  });
};

const QUICK_PROMPTS = [
  { label: "How to start SIP?", icon: "📈" },
  { label: "Save tax on ₹12L income", icon: "🧾" },
  { label: "Term insurance guide", icon: "🛡️" },
  { label: "Retirement corpus plan", icon: "🌴" },
  { label: "Emergency fund setup", icon: "🆘" },
  { label: "ULIP vs Term + MF", icon: "⚖️" },
];

const ArthaGuruChat = ({ calcContext }: { calcContext: string }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: `**Namaste! I'm ArthaGuru** 🙏\n\nYour personal AI financial advisor — unbiased, knowledgeable, and built for India.\n\nI can help you with:\n• SIP & mutual fund strategy\n• Tax saving (80C, 80D, NPS)\n• Home loan EMI planning\n• Retirement & goal planning\n• Insurance guidance\n• And much more...\n\nWhat's your money question today? You can ask in **Hindi, Telugu, or English**.`,
    },
  ]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [dots, setDots]         = useState(".");
  const bottomRef               = useRef<HTMLDivElement>(null);
  const inputRef                = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setDots(d => d.length >= 3 ? "." : d + "."), 400);
    return () => clearInterval(t);
  }, [loading]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setInput("");
    const userMsg: ChatMessage = { role: "user", content: q };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("arthaai-chat", {
        body: {
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          calcContext: calcContext || undefined,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      setMessages(prev => [...prev, { role: "assistant", content: data.message }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: getFallbackResponse(q) }]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading, calcContext]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl flex items-center justify-center text-white font-extrabold text-lg shadow-lg" style={{ background: `linear-gradient(135deg, ${OG}, #c44d12)` }}>
            A
          </div>
          <div>
            <h2 className="font-bold text-gray-900">ArthaGuru AI</h2>
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-green-500 animate-pulse" />
              <p className="text-xs text-green-600 font-medium">Online · 22 Indian Languages</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white" style={{ background: DB }}>
          <Zap size={11} />Powered by Claude AI
        </div>
      </div>

      {/* Quick prompts */}
      <div className="flex flex-wrap gap-2 mb-4">
        {QUICK_PROMPTS.map(p => (
          <button key={p.label} onClick={() => send(p.label)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border-2 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
            style={{ borderColor: OG_LIGHT, background: OG_PALE, color: OG }}
          >
            <span>{p.icon}</span>{p.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-[320px] max-h-[420px]"
        style={{ scrollbarWidth: "thin", scrollbarColor: `${OG_LIGHT} transparent` }}
      >
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`size-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${m.role === "assistant" ? "text-white" : "text-white"}`}
              style={{ background: m.role === "assistant" ? `linear-gradient(135deg, ${OG}, #c44d12)` : DB }}
            >
              {m.role === "assistant" ? "A" : "U"}
            </div>
            <div className={`rounded-2xl px-4 py-3 max-w-[85%] ${m.role === "user"
              ? "text-white rounded-tr-sm"
              : "bg-white border border-gray-100 shadow-sm rounded-tl-sm text-gray-700"
            }`}
              style={m.role === "user" ? { background: DB } : {}}
            >
              {m.role === "assistant" ? (
                <div className="space-y-1">{renderMD(m.content)}</div>
              ) : (
                <p className="text-sm">{m.content}</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="size-8 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: `linear-gradient(135deg, ${OG}, #c44d12)` }}>A</div>
            <div className="rounded-2xl rounded-tl-sm bg-white border border-gray-100 shadow-sm px-4 py-3">
              <div className="flex items-center gap-2">
                <RefreshCw size={13} className="animate-spin" style={{ color: OG }} />
                <span className="text-sm text-gray-500">ArthaGuru is thinking{dots}</span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2 items-end">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask anything about money… (Enter to send)"
            className="w-full resize-none rounded-2xl border-2 border-gray-200 bg-white px-4 py-3 pr-12 text-sm text-gray-800 focus:outline-none focus:border-orange-300 transition-colors leading-snug"
            style={{ minHeight: "48px", maxHeight: "120px" }}
          />
        </div>
        <button onClick={() => send(input)} disabled={!input.trim() || loading}
          className="size-12 rounded-2xl flex items-center justify-center text-white shrink-0 transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
          style={{ background: `linear-gradient(135deg, ${OG}, #c44d12)` }}
        >
          <Send size={18} />
        </button>
      </div>
      <p className="text-[10px] text-gray-400 text-center mt-2">ArthaGuru provides educational guidance only. Consult a SEBI-registered advisor for investments.</p>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   SVG CHARTS
═══════════════════════════════════════════════════════════ */

const DonutChart = ({ pct, color, size = 120 }: { pct: number; color: string; size?: number }) => {
  const r = size / 2 - 12;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f3f4f6" strokeWidth="10" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ / 4}
        strokeLinecap="round" style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
    </svg>
  );
};

const BarChart = ({ data }: { data: { label: string; value: number; color: string }[] }) => {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div className="space-y-2 w-full">
      {data.map(d => (
        <div key={d.label}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-600 font-medium">{d.label}</span>
            <span className="font-bold" style={{ color: d.color }}>{fmtShort(d.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const BenchmarkBand = ({ value, min, max, goodMax, label, format }: {
  value: number;
  min: number;
  max: number;
  goodMax: number;
  label: string;
  format?: (n: number) => string;
}) => {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = ((clamped - min) / (max - min)) * 100;
  const goodPct = ((goodMax - min) / (max - min)) * 100;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-600">{label}</p>
        <p className="text-xs font-bold text-gray-800">{format ? format(value) : value.toFixed(1)}</p>
      </div>
      <div className="relative h-2.5 rounded-full overflow-hidden bg-gray-100">
        <div className="absolute inset-y-0 left-0 bg-green-300" style={{ width: `${Math.max(0, Math.min(100, goodPct))}%` }} />
        <div className="absolute inset-y-0 right-0 bg-red-200" style={{ width: `${Math.max(0, 100 - goodPct)}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 h-4 w-1.5 rounded-full bg-gray-900" style={{ left: `calc(${pct}% - 3px)` }} />
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{format ? format(min) : min}</span>
        <span>Good ≤ {format ? format(goodMax) : goodMax}</span>
        <span>{format ? format(max) : max}</span>
      </div>
    </div>
  );
};

const ScenarioComparison = ({ title, scenarios }: { title: string; scenarios: Array<{ label: string; value: number; color: string }> }) => {
  const max = Math.max(1, ...scenarios.map((s) => s.value));
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">{title}</p>
      <div className="space-y-2">
        {scenarios.map((s) => (
          <div key={s.label}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium text-gray-600">{s.label}</span>
              <span className="font-bold" style={{ color: s.color }}>{fmtShort(s.value)}</span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(s.value / max) * 100}%`, background: s.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   SHARED INPUT COMPONENTS
═══════════════════════════════════════════════════════════ */

const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
    {children}
  </div>
);

const NumField = ({ value, onChange, min = 0, max, step = 1, prefix, suffix, readOnly = false }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; prefix?: string; suffix?: string; readOnly?: boolean;
}) => (
  <div className="relative">
    {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none select-none">{prefix}</span>}
    <input type="number" value={value} min={min} max={max} step={step}
      onChange={e => onChange(Number(e.target.value) || 0)}
      readOnly={readOnly}
      className="w-full rounded-xl border-2 border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-800 focus:outline-none focus:border-orange-300 transition-colors"
      style={{ paddingLeft: prefix ? "1.8rem" : "0.75rem", paddingRight: suffix ? "2.5rem" : "0.75rem" }}
    />
    {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none select-none">{suffix}</span>}
  </div>
);

const SelectField = ({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-800 focus:outline-none focus:border-orange-300 transition-colors"
  >
    {options.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
);

const RangeSlider = ({ value, onChange, min = 0, max = 100, step = 1 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) => (
  <input type="range" value={value} min={min} max={max} step={step}
    onChange={e => onChange(Number(e.target.value))}
    className="w-full h-1.5 rounded-full appearance-none cursor-pointer mt-1"
    style={{ accentColor: OG }}
  />
);

/* ═══════════════════════════════════════════════════════════
   CALCULATORS WITH AI INSIGHTS
═══════════════════════════════════════════════════════════ */

const InsightBanner = ({ text }: { text: string }) => (
  <div className="mt-4 rounded-2xl p-4 border-2 text-sm leading-relaxed" style={{ background: OG_PALE, borderColor: OG_LIGHT, color: "#7c3700" }}>
    <div className="flex items-start gap-2">
      <Sparkles size={15} className="shrink-0 mt-0.5" style={{ color: OG }} />
      <div>{renderMD(text)}</div>
    </div>
  </div>
);

/* EMI */
const EMICalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [loanType, setLoanType] = useState<"home" | "car">("home");
  const [assetCost, setAssetCost] = useState(8500000);
  const [downPct, setDownPct] = useState(20);
  const [rate, setR] = useState(8.75);
  const [tenure, setT] = useState(20);
  const [processingFeePct, setProcessingFeePct] = useState(0.5);
  const [insuranceOneTime, setInsuranceOneTime] = useState(50000);
  const [monthlyIncome, setMonthlyIncome] = useState(120000);
  const [existingEmi, setExistingEmi] = useState(0);
  const [annualPrepay, setAnnualPrepay] = useState(100000);

  useEffect(() => {
    if (loanType === "home") {
      setAssetCost(8500000);
      setR(8.75);
      setT(20);
      setDownPct(20);
      setProcessingFeePct(0.5);
      setInsuranceOneTime(50000);
      setAnnualPrepay(100000);
    } else {
      setAssetCost(1400000);
      setR(9.5);
      setT(7);
      setDownPct(15);
      setProcessingFeePct(1);
      setInsuranceOneTime(25000);
      setAnnualPrepay(30000);
    }
  }, [loanType]);

  const downPayment = assetCost * downPct / 100;
  const processingFee = (assetCost - downPayment) * processingFeePct / 100;
  const principal = Math.max(0, assetCost - downPayment + processingFee + insuranceOneTime);

  const r = rate / 12 / 100;
  const n = tenure * 12;
  const emi = r === 0 ? principal / Math.max(1, n) : principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  const total = emi * n;
  const interest = Math.max(0, total - principal);
  const pPct = total > 0 ? Math.round(principal / total * 100) : 0;

  const annualPrepayImpact = (() => {
    if (annualPrepay <= 0 || principal <= 0 || emi <= 0) return { interest: interest, months: n };
    let bal = principal;
    let paidInterest = 0;
    let month = 0;
    while (bal > 1 && month < n * 2) {
      const intPart = bal * r;
      const principalPart = Math.min(bal, emi - intPart);
      bal -= principalPart;
      paidInterest += intPart;
      month += 1;
      if (month % 12 === 0 && bal > 0) {
        bal = Math.max(0, bal - annualPrepay);
      }
    }
    return { interest: paidInterest, months: month };
  })();

  const totalMonthlyObligation = emi + existingEmi;
  const foir = monthlyIncome > 0 ? (totalMonthlyObligation / monthlyIncome) * 100 : 0;

  useEffect(() => {
    onContextUpdate(
      `${loanType.toUpperCase()} Loan: Asset ${fmtShort(assetCost)}, down payment ${fmtShort(downPayment)}, financed ${fmtShort(principal)}, rate ${rate}%, tenure ${tenure}yr, EMI ${fmtShort(emi)}, FOIR ${foir.toFixed(1)}%.`
    );
  }, [loanType, assetCost, downPayment, principal, rate, tenure, emi, foir]);

  const insight = `**${loanType === "home" ? "Home" : "Car"} loan assessment:**\n\n• Financed amount: **${fmtShort(principal)}** after down payment + charges\n• EMI: **${fmtShort(emi)}** and total interest outgo: **${fmtShort(interest)}**\n• Debt load (FOIR): **${foir.toFixed(1)}%** including existing EMIs ${foir <= 40 ? "✅ within a safer range" : "⚠️ above ideal limit"}\n• With annual prepayment of ${fmtShort(annualPrepay)}, you may save about **${fmtShort(Math.max(0, interest - annualPrepayImpact.interest))}** in interest and close roughly **${Math.max(0, n - annualPrepayImpact.months)} months** earlier\n\n**Practical tip**: Keep fixed obligations below 40% of net income and maintain at least 6 months EMI + expense emergency buffer.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setLoanType("home")}
            className="flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition-all"
            style={{ borderColor: loanType === "home" ? OG : "#e5e7eb", background: loanType === "home" ? OG_PALE : "#fff", color: loanType === "home" ? OG : "#6b7280" }}
          >
            <Home size={14} />Home Loan
          </button>
          <button
            onClick={() => setLoanType("car")}
            className="flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition-all"
            style={{ borderColor: loanType === "car" ? OG : "#e5e7eb", background: loanType === "car" ? OG_PALE : "#fff", color: loanType === "car" ? OG : "#6b7280" }}
          >
            <Car size={14} />Car Loan
          </button>
        </div>
        <FieldRow label={loanType === "home" ? "Property Cost" : "Vehicle On-road Price"}>
          <NumField value={assetCost} onChange={setAssetCost} min={300000} max={200000000} step={100000} prefix="₹" />
          <RangeSlider value={assetCost} onChange={setAssetCost} min={loanType === "home" ? 1000000 : 300000} max={loanType === "home" ? 30000000 : 5000000} step={50000} />
          <p className="text-xs text-right text-gray-400 font-medium mt-0.5">{fmtShort(assetCost)}</p>
        </FieldRow>
        <FieldRow label="Down Payment">
          <NumField value={downPct} onChange={setDownPct} min={5} max={70} step={1} suffix="%" />
          <RangeSlider value={downPct} onChange={setDownPct} min={5} max={70} step={1} />
          <p className="text-xs text-right text-gray-400 font-medium mt-0.5">{fmtShort(downPayment)} ({downPct}%)</p>
        </FieldRow>
        <FieldRow label="Loan Amount">
          <NumField value={principal} onChange={() => {}} min={100000} max={100000000} step={100000} prefix="₹" readOnly />
          <p className="text-xs text-right text-gray-400 font-medium mt-0.5">{fmtShort(principal)}</p>
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Processing Fee">
            <NumField value={processingFeePct} onChange={setProcessingFeePct} min={0} max={3} step={0.1} suffix="%" />
          </FieldRow>
          <FieldRow label="Insurance / Other Charges">
            <NumField value={insuranceOneTime} onChange={setInsuranceOneTime} min={0} max={3000000} step={5000} prefix="₹" />
          </FieldRow>
        </div>
        <FieldRow label="Annual Interest Rate">
          <NumField value={rate} onChange={setR} min={4} max={20} step={0.25} suffix="%" />
          <RangeSlider value={rate} onChange={setR} min={6} max={18} step={0.25} />
        </FieldRow>
        <FieldRow label="Loan Tenure">
          <NumField value={tenure} onChange={setT} min={1} max={30} step={1} suffix="yrs" />
          <RangeSlider value={tenure} onChange={setT} min={1} max={30} step={1} />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Net Monthly Income">
            <NumField value={monthlyIncome} onChange={setMonthlyIncome} min={10000} max={2000000} step={1000} prefix="₹" />
          </FieldRow>
          <FieldRow label="Existing EMIs">
            <NumField value={existingEmi} onChange={setExistingEmi} min={0} max={500000} step={500} prefix="₹" />
          </FieldRow>
        </div>
        <FieldRow label="Annual Prepayment Plan">
          <NumField value={annualPrepay} onChange={setAnnualPrepay} min={0} max={3000000} step={5000} prefix="₹" />
        </FieldRow>
      </div>
      <div>
        <div className="flex items-center justify-center gap-8 mb-4">
          <div className="relative">
            <DonutChart pct={pPct} color={DB} size={140} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-xl font-extrabold" style={{ color: DB }}>{pPct}%</p>
              <p className="text-xs text-gray-400">Principal</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 font-medium">Monthly EMI</p>
              <p className="text-2xl font-extrabold" style={{ color: OG }}>{fmtShort(emi)}</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: "#f8fafc" }}>
              <p className="text-xs text-gray-500">Debt Ratio (FOIR)</p>
              <p className="text-lg font-extrabold" style={{ color: foir <= 40 ? GREEN : "#dc2626" }}>{foir.toFixed(1)}%</p>
              <p className="text-[11px] text-gray-500">Existing EMIs + new EMI / net income</p>
            </div>
            <div className="flex gap-3 text-xs">
              <div><span className="size-2.5 rounded-full inline-block mr-1" style={{ background: DB }} /><span className="text-gray-500">Principal</span><p className="font-bold text-gray-800">{fmtShort(principal)}</p></div>
              <div><span className="size-2.5 rounded-full inline-block mr-1" style={{ background: OG }} /><span className="text-gray-500">Interest</span><p className="font-bold text-gray-800">{fmtShort(interest)}</p></div>
            </div>
            <div className="rounded-xl p-3 text-center" style={{ background: DB }}>
              <p className="text-xs text-white/60">Total Payment</p>
              <p className="text-lg font-extrabold text-white">{fmtShort(total)}</p>
            </div>
          </div>
        </div>
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

/* SIP */
const SIPCalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [monthly, setM] = useState(8000);
  const [stepUp, setStepUp] = useState(10);
  const [rate, setR] = useState(12);
  const [years, setY] = useState(15);
  const [lump, setL] = useState(0);
  const [inflation, setInflation] = useState(6);
  const [monthlyIncome, setMonthlyIncome] = useState(90000);
  const [monthlyExpenses, setMonthlyExpenses] = useState(55000);
  const [existingInvestments, setExistingInvestments] = useState(500000);
  const [targetCorpus, setTargetCorpus] = useState(5000000);
  const [profile, setProfile] = useState<"conservative" | "balanced" | "aggressive">("balanced");

  const monthlyReturn = rate / 12 / 100;
  const months = years * 12;
  let invested = lump + existingInvestments;
  let corpus = lump + existingInvestments;
  for (let y = 0; y < years; y += 1) {
    const yearlySip = monthly * Math.pow(1 + stepUp / 100, y);
    for (let m = 0; m < 12; m += 1) {
      corpus = corpus * (1 + monthlyReturn) + yearlySip;
      invested += yearlySip;
    }
  }
  const total = corpus;
  const gains = total - invested;
  const realCorpus = total / Math.pow(1 + inflation / 100, years);
  const multiplier = invested > 0 ? (total / invested).toFixed(1) : "0";
  const monthlySurplus = Math.max(0, monthlyIncome - monthlyExpenses);
  const sipShare = monthlyIncome > 0 ? (monthly / monthlyIncome) * 100 : 0;
  const inflationAdjustedTarget = targetCorpus * Math.pow(1 + inflation / 100, years);
  const targetGap = Math.max(0, inflationAdjustedTarget - total);

  useEffect(() => {
    onContextUpdate(
      `SIP Planner: profile ${profile}, SIP ${fmtShort(monthly)}/mo with ${stepUp}% step-up, return ${rate}%, tenure ${years}yr, corpus ${fmtShort(total)}, real corpus ${fmtShort(realCorpus)}.`
    );
  }, [monthly, stepUp, rate, years, lump, inflation, profile, total, realCorpus]);

  const insight = `**SIP realism check:**\n\n• Corpus in ${years} years: **${fmtShort(total)}** (inflation-adjusted value today: **${fmtShort(realCorpus)}**)\n• You invest **${fmtShort(invested)}** and create wealth gain of **${fmtShort(gains)}**\n• SIP is **${sipShare.toFixed(1)}% of monthly income** and monthly surplus is **${fmtShort(monthlySurplus)}**\n• Goal shortfall vs inflation-adjusted target: **${fmtShort(targetGap)}**\n\n**Action**: ${targetGap > 0 ? `Increase SIP by at least ${fmtShort(Math.max(500, targetGap / (years * 12 * 2)))} and review yearly step-up.` : "You are on track for your target if you stay consistent."}`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Investor Profile">
          <SelectField
            value={profile}
            onChange={(v) => {
              const p = v as "conservative" | "balanced" | "aggressive";
              setProfile(p);
              if (p === "conservative") setR(10);
              if (p === "balanced") setR(12);
              if (p === "aggressive") setR(14);
            }}
            options={[
              { value: "conservative", label: "Conservative (lower risk)" },
              { value: "balanced", label: "Balanced (moderate risk)" },
              { value: "aggressive", label: "Aggressive (higher risk)" },
            ]}
          />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Monthly Income">
            <NumField value={monthlyIncome} onChange={setMonthlyIncome} min={10000} max={2000000} step={1000} prefix="₹" />
          </FieldRow>
          <FieldRow label="Monthly Expenses">
            <NumField value={monthlyExpenses} onChange={setMonthlyExpenses} min={0} max={2000000} step={1000} prefix="₹" />
          </FieldRow>
        </div>
        <FieldRow label="Monthly SIP">
          <NumField value={monthly} onChange={setM} min={500} max={500000} step={500} prefix="₹" />
          <RangeSlider value={monthly} onChange={setM} min={500} max={100000} step={500} />
          <p className="text-xs text-right text-gray-400 mt-0.5">{fmtShort(monthly)}/month</p>
        </FieldRow>
        <FieldRow label="Annual SIP Step-up">
          <NumField value={stepUp} onChange={setStepUp} min={0} max={25} step={1} suffix="%" />
          <RangeSlider value={stepUp} onChange={setStepUp} min={0} max={25} step={1} />
        </FieldRow>
        <FieldRow label="One-time Lumpsum (optional)">
          <NumField value={lump} onChange={setL} min={0} max={10000000} step={10000} prefix="₹" />
        </FieldRow>
        <FieldRow label="Existing Investments (already accumulated)">
          <NumField value={existingInvestments} onChange={setExistingInvestments} min={0} max={100000000} step={10000} prefix="₹" />
        </FieldRow>
        <FieldRow label="Expected Annual Return">
          <NumField value={rate} onChange={setR} min={6} max={25} step={0.5} suffix="%" />
          <RangeSlider value={rate} onChange={setR} min={6} max={20} step={0.5} />
        </FieldRow>
        <FieldRow label="Expected Inflation">
          <NumField value={inflation} onChange={setInflation} min={3} max={12} step={0.5} suffix="%" />
        </FieldRow>
        <FieldRow label="Investment Duration">
          <NumField value={years} onChange={setY} min={1} max={40} step={1} suffix="yrs" />
          <RangeSlider value={years} onChange={setY} min={1} max={40} step={1} />
        </FieldRow>
        <FieldRow label="Target Corpus (Today's Value)">
          <NumField value={targetCorpus} onChange={setTargetCorpus} min={100000} max={300000000} step={100000} prefix="₹" />
        </FieldRow>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-center text-white" style={{ background: `linear-gradient(135deg, ${DB}, #0f2540)` }}>
          <p className="text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Total Corpus in {years} years</p>
          <p className="text-4xl font-extrabold mb-3">{fmtShort(total)}</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <p className="text-[10px] text-white/50">Invested</p>
              <p className="text-sm font-bold text-white/90">{fmtShort(invested)}</p>
            </div>
            <div className="rounded-xl p-2.5" style={{ background: `rgba(224,92,26,0.3)`, border: `1px solid ${OG}` }}>
              <p className="text-[10px] text-white/50">Gains</p>
              <p className="text-sm font-bold" style={{ color: OG_LIGHT }}>{fmtShort(gains)}</p>
            </div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <p className="text-[10px] text-white/50">Multiplier</p>
              <p className="text-sm font-bold text-white/90">{multiplier}×</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl p-4 mb-4 border border-blue-100 bg-blue-50">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-gray-500">Inflation-adjusted corpus</p>
              <p className="font-extrabold text-gray-800">{fmtShort(realCorpus)}</p>
            </div>
            <div>
              <p className="text-gray-500">Inflation-adjusted target</p>
              <p className="font-extrabold text-gray-800">{fmtShort(inflationAdjustedTarget)}</p>
            </div>
            <div>
              <p className="text-gray-500">Monthly surplus</p>
              <p className="font-extrabold text-gray-800">{fmtShort(monthlySurplus)}</p>
            </div>
            <div>
              <p className="text-gray-500">Target gap</p>
              <p className="font-extrabold" style={{ color: targetGap > 0 ? "#dc2626" : GREEN }}>{fmtShort(targetGap)}</p>
            </div>
          </div>
        </div>
        <BarChart data={[
          { label: "Amount Invested", value: invested, color: DB },
          { label: "Wealth Gained", value: gains, color: OG },
          { label: "Total Corpus", value: total, color: GREEN },
        ]} />
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

/* Rent vs Buy */
const RentVsBuyCalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [homePrice, setHomePrice] = useState(7500000);
  const [downPct, setDownPct] = useState(20);
  const [loanRate, setLoanRate] = useState(8.75);
  const [loanTenure, setLoanTenure] = useState(20);
  const [monthlyRent, setMonthlyRent] = useState(25000);
  const [rentIncrease, setRentIncrease] = useState(7);
  const [homeAppreciation, setHomeAppreciation] = useState(6);
  const [maintenancePct, setMaintenancePct] = useState(1.5);
  const [propertyTaxPct, setPropertyTaxPct] = useState(0.2);
  const [upfrontPct, setUpfrontPct] = useState(7);
  const [investReturn, setInvestReturn] = useState(11);
  const [analysisYears, setAnalysisYears] = useState(10);

  const downPayment = homePrice * downPct / 100;
  const upfrontCost = homePrice * upfrontPct / 100;
  const principal = Math.max(0, homePrice - downPayment);
  const rm = loanRate / 12 / 100;
  const nm = loanTenure * 12;
  const emi = rm === 0 ? principal / Math.max(1, nm) : principal * rm * Math.pow(1 + rm, nm) / (Math.pow(1 + rm, nm) - 1);

  const outstandingAfter = (months: number) => {
    if (months <= 0) return principal;
    if (rm === 0) return Math.max(0, principal - emi * months);
    const factor = Math.pow(1 + rm, months);
    return Math.max(0, principal * factor - emi * (factor - 1) / rm);
  };

  let totalRentPaid = 0;
  let currentRent = monthlyRent;
  for (let y = 0; y < analysisYears; y += 1) {
    totalRentPaid += currentRent * 12;
    currentRent *= (1 + rentIncrease / 100);
  }

  let totalBuyOutflow = downPayment + upfrontCost;
  const monthlyMaintenance = homePrice * maintenancePct / 100 / 12;
  const monthlyTax = homePrice * propertyTaxPct / 100 / 12;
  totalBuyOutflow += (emi + monthlyMaintenance + monthlyTax) * 12 * analysisYears;

  const monthsElapsed = Math.min(analysisYears * 12, loanTenure * 12);
  const outstanding = outstandingAfter(monthsElapsed);
  const futureHomeValue = homePrice * Math.pow(1 + homeAppreciation / 100, analysisYears);
  const buyNetWorth = Math.max(0, futureHomeValue - outstanding);

  let rentCorpus = downPayment + upfrontCost;
  const investMonthly = investReturn / 12 / 100;
  for (let y = 0; y < analysisYears; y += 1) {
    const yearlyRent = monthlyRent * Math.pow(1 + rentIncrease / 100, y) * 12;
    const yearlyBuy = (emi + monthlyMaintenance + monthlyTax) * 12;
    const yearlySavings = Math.max(0, yearlyBuy - yearlyRent);
    for (let m = 0; m < 12; m += 1) {
      rentCorpus = rentCorpus * (1 + investMonthly) + yearlySavings / 12;
    }
  }

  const decision = buyNetWorth >= rentCorpus ? "buy" : "rent";
  const edge = Math.abs(buyNetWorth - rentCorpus);

  useEffect(() => {
    onContextUpdate(
      `Rent vs Buy: home ${fmtShort(homePrice)}, down ${downPct}%, EMI ${fmtShort(emi)}, rent ${fmtShort(monthlyRent)}, ${analysisYears}yr -> ${decision.toUpperCase()} better by ${fmtShort(edge)}.`
    );
  }, [homePrice, downPct, emi, monthlyRent, analysisYears, decision, edge]);

  const insight = `**Rent vs buy analysis (${analysisYears} years):**\n\n• Buying builds projected net equity of **${fmtShort(buyNetWorth)}**\n• Renting + investing surplus builds projected corpus of **${fmtShort(rentCorpus)}**\n• Current model suggests **${decision === "buy" ? "Buy" : "Rent"} is ahead by ${fmtShort(edge)}**\n• Includes down payment, registration/upfront costs, EMI, maintenance, property tax, rent escalation, and investment return assumptions\n\n**Rule of thumb**: Buy when you can hold 8-10+ years and EMI stays comfortable; rent when mobility is important or market prices are stretched.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="House Price">
          <NumField value={homePrice} onChange={setHomePrice} min={1500000} max={30000000} step={100000} prefix="₹" />
          <RangeSlider value={homePrice} onChange={setHomePrice} min={1500000} max={30000000} step={100000} />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Down Payment">
            <NumField value={downPct} onChange={setDownPct} min={5} max={70} step={1} suffix="%" />
          </FieldRow>
          <FieldRow label="Upfront Cost (stamp + reg + misc)">
            <NumField value={upfrontPct} onChange={setUpfrontPct} min={3} max={12} step={0.5} suffix="%" />
          </FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Loan Interest Rate">
            <NumField value={loanRate} onChange={setLoanRate} min={6} max={15} step={0.1} suffix="%" />
          </FieldRow>
          <FieldRow label="Loan Tenure">
            <NumField value={loanTenure} onChange={setLoanTenure} min={5} max={30} step={1} suffix="yrs" />
          </FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Monthly Rent">
            <NumField value={monthlyRent} onChange={setMonthlyRent} min={5000} max={300000} step={500} prefix="₹" />
          </FieldRow>
          <FieldRow label="Rent Increase">
            <NumField value={rentIncrease} onChange={setRentIncrease} min={0} max={15} step={0.5} suffix="%" />
          </FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Home Appreciation">
            <NumField value={homeAppreciation} onChange={setHomeAppreciation} min={0} max={15} step={0.5} suffix="%" />
          </FieldRow>
          <FieldRow label="Investment Return (if renting)">
            <NumField value={investReturn} onChange={setInvestReturn} min={4} max={16} step={0.5} suffix="%" />
          </FieldRow>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <FieldRow label="Maintenance">
            <NumField value={maintenancePct} onChange={setMaintenancePct} min={0.5} max={4} step={0.1} suffix="%" />
          </FieldRow>
          <FieldRow label="Property Tax">
            <NumField value={propertyTaxPct} onChange={setPropertyTaxPct} min={0} max={1.5} step={0.1} suffix="%" />
          </FieldRow>
          <FieldRow label="Analysis Period">
            <NumField value={analysisYears} onChange={setAnalysisYears} min={3} max={30} step={1} suffix="yrs" />
          </FieldRow>
        </div>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${DB}, #0f2540)` }}>
          <p className="text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Decision Snapshot</p>
          <p className="text-3xl font-extrabold mb-3">{decision === "buy" ? "Buying Looks Better" : "Renting Looks Better"}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <p className="text-[10px] text-white/50">Buy Net Worth</p>
              <p className="text-sm font-bold text-white/90">{fmtShort(buyNetWorth)}</p>
            </div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <p className="text-[10px] text-white/50">Rent + Invest Corpus</p>
              <p className="text-sm font-bold text-white/90">{fmtShort(rentCorpus)}</p>
            </div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <p className="text-[10px] text-white/50">EMI</p>
              <p className="text-sm font-bold text-white/90">{fmtShort(emi)}/mo</p>
            </div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <p className="text-[10px] text-white/50">Edge</p>
              <p className="text-sm font-bold text-white/90">{fmtShort(edge)}</p>
            </div>
          </div>
        </div>
        <BarChart data={[
          { label: "Total Rent Paid", value: totalRentPaid, color: OG },
          { label: "Total Buy Outflow", value: totalBuyOutflow, color: DB },
          { label: "Future House Value", value: futureHomeValue, color: GREEN },
        ]} />
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const SavingsSchemeCalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [mode, setMode] = useState<"lumpsum" | "monthly" | "yearly">("lumpsum");
  const [amount, setAmount] = useState(500000);
  const [years, setYears] = useState(10);
  const [fdRate, setFdRate] = useState(7);
  const [rdRate, setRdRate] = useState(6.7);
  const [ppfRate, setPpfRate] = useState(7.1);
  const [npsRate, setNpsRate] = useState(10);
  const [inflation, setInflation] = useState(6);
  const [npsAnnuityPct, setNpsAnnuityPct] = useState(40);

  const annualAmount = mode === "yearly" ? amount : mode === "monthly" ? amount * 12 : amount;
  const months = years * 12;

  const fdMaturity = mode === "lumpsum"
    ? amount * Math.pow(1 + fdRate / 400, years * 4)
    : sipFutureValueWithStepUp(mode === "monthly" ? amount : amount / 12, 0, fdRate, years);

  const rdMaturity = mode === "monthly"
    ? sipFutureValueWithStepUp(amount, 0, rdRate, years)
    : sipFutureValueWithStepUp(amount / 12, 0, rdRate, years);

  let ppfCorpus = mode === "lumpsum" ? amount : 0;
  for (let y = 0; y < years; y += 1) {
    const yearlyContrib = mode === "yearly" ? Math.min(150000, amount) : mode === "monthly" ? Math.min(150000, amount * 12) : 0;
    ppfCorpus = (ppfCorpus + yearlyContrib) * (1 + ppfRate / 100);
  }

  let npsCorpus = mode === "lumpsum" ? amount : 0;
  for (let y = 0; y < years; y += 1) {
    const contrib = mode === "monthly" ? amount * 12 : mode === "yearly" ? amount : 0;
    npsCorpus = (npsCorpus + contrib) * (1 + npsRate / 100);
  }
  const npsLumpsum = npsCorpus * (1 - npsAnnuityPct / 100);
  const npsAnnuity = npsCorpus * (npsAnnuityPct / 100);

  const real = (n: number) => n / Math.pow(1 + inflation / 100, years);

  useEffect(() => {
    onContextUpdate(
      `Savings Schemes: mode ${mode}, amount ${fmtShort(amount)}, ${years}yr; FD ${fmtShort(fdMaturity)}, PPF ${fmtShort(ppfCorpus)}, NPS ${fmtShort(npsCorpus)}.`
    );
  }, [mode, amount, years, fdMaturity, ppfCorpus, npsCorpus]);

  const best = [
    { name: "FD", value: fdMaturity },
    { name: "RD", value: rdMaturity },
    { name: "PPF", value: ppfCorpus },
    { name: "NPS", value: npsCorpus },
  ].sort((a, b) => b.value - a.value)[0];

  const insight = `**India savings comparison (${years} years):**\n\n• FD maturity: **${fmtShort(fdMaturity)}**\n• RD maturity: **${fmtShort(rdMaturity)}**\n• PPF maturity (annual cap ₹1.5L): **${fmtShort(ppfCorpus)}**\n• NPS corpus estimate: **${fmtShort(npsCorpus)}** (Lumpsum ${fmtShort(npsLumpsum)} + Annuity ${fmtShort(npsAnnuity)})\n• Inflation-adjusted best corpus: **${fmtShort(real(best.value))}**\n\n**Interpretation**: ${best.name} gives the highest projected maturity under current assumptions.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Contribution Mode">
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "lumpsum", label: "Lumpsum" },
              { id: "monthly", label: "Monthly" },
              { id: "yearly", label: "Yearly" },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id as "lumpsum" | "monthly" | "yearly")}
                className="rounded-xl border-2 px-3 py-2 text-sm font-semibold"
                style={{ borderColor: mode === m.id ? OG : "#e5e7eb", background: mode === m.id ? OG_PALE : "#fff", color: mode === m.id ? OG : "#6b7280" }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </FieldRow>
        <FieldRow label={mode === "lumpsum" ? "One-time Amount" : mode === "monthly" ? "Monthly Contribution" : "Yearly Contribution"}>
          <NumField value={amount} onChange={setAmount} min={500} max={5000000} step={500} prefix="₹" />
          <p className="text-xs text-right text-gray-400 mt-0.5">Annualized: {fmtShort(annualAmount)}</p>
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Duration"><NumField value={years} onChange={setYears} min={1} max={30} step={1} suffix="yrs" /></FieldRow>
          <FieldRow label="Inflation"><NumField value={inflation} onChange={setInflation} min={3} max={10} step={0.5} suffix="%" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="FD Rate"><NumField value={fdRate} onChange={setFdRate} min={4} max={10} step={0.1} suffix="%" /></FieldRow>
          <FieldRow label="RD Rate"><NumField value={rdRate} onChange={setRdRate} min={4} max={10} step={0.1} suffix="%" /></FieldRow>
          <FieldRow label="PPF Rate"><NumField value={ppfRate} onChange={setPpfRate} min={6} max={9} step={0.1} suffix="%" /></FieldRow>
          <FieldRow label="NPS Return"><NumField value={npsRate} onChange={setNpsRate} min={7} max={15} step={0.1} suffix="%" /></FieldRow>
        </div>
        <FieldRow label="NPS Mandatory Annuity Portion">
          <NumField value={npsAnnuityPct} onChange={setNpsAnnuityPct} min={40} max={100} step={1} suffix="%" />
        </FieldRow>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${DB}, ${MB})` }}>
          <p className="text-xs text-white/60 uppercase font-semibold">Maturity Snapshot</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{best.name} leads at {fmtShort(best.value)}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">FD</p><p className="text-sm font-bold">{fmtShort(fdMaturity)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">RD</p><p className="text-sm font-bold">{fmtShort(rdMaturity)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">PPF</p><p className="text-sm font-bold">{fmtShort(ppfCorpus)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">NPS</p><p className="text-sm font-bold">{fmtShort(npsCorpus)}</p></div>
          </div>
        </div>
        <BarChart data={[
          { label: "FD", value: fdMaturity, color: DB },
          { label: "PPF", value: ppfCorpus, color: GREEN },
          { label: "NPS", value: npsCorpus, color: OG },
        ]} />
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const EmergencyFundCalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [monthlyExpense, setMonthlyExpense] = useState(50000);
  const [dependents, setDependents] = useState(2);
  const [jobStability, setJobStability] = useState("medium");
  const [existingFund, setExistingFund] = useState(80000);
  const [monthlyContribution, setMonthlyContribution] = useState(10000);
  const [savingsRate, setSavingsRate] = useState(6.5);

  const monthsTarget = jobStability === "high" ? 6 : jobStability === "medium" ? 9 : 12;
  const dependentAdj = dependents >= 3 ? 1.25 : dependents === 2 ? 1.15 : 1;
  const target = monthlyExpense * monthsTarget * dependentAdj;
  const gap = Math.max(0, target - existingFund);
  const monthlyReturn = savingsRate / 12 / 100;

  let months = 0;
  let corpus = existingFund;
  while (corpus < target && months < 600) {
    corpus = corpus * (1 + monthlyReturn) + monthlyContribution;
    months += 1;
  }

  const allocation = {
    savings: target * 0.4,
    liquid: target * 0.4,
    fd: target * 0.2,
  };

  useEffect(() => {
    onContextUpdate(
      `Emergency Fund: monthly expense ${fmtShort(monthlyExpense)}, target ${fmtShort(target)}, existing ${fmtShort(existingFund)}, gap ${fmtShort(gap)}, completion ${months} months.`
    );
  }, [monthlyExpense, target, existingFund, gap, months]);

  const insight = `**Emergency buffer plan:**\n\n• Recommended corpus: **${fmtShort(target)}** (${monthsTarget} months adjusted for dependents)\n• Current corpus: **${fmtShort(existingFund)}** | Gap: **${fmtShort(gap)}**\n• At ${fmtShort(monthlyContribution)}/month, estimated completion time: **${months} months**\n• Suggested split: Savings ${fmtShort(allocation.savings)} | Liquid Fund ${fmtShort(allocation.liquid)} | FD ${fmtShort(allocation.fd)}\n\n**Rule**: Never invest emergency corpus in equities. Keep withdrawals possible within 24 hours.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Monthly Household Expenses">
          <NumField value={monthlyExpense} onChange={setMonthlyExpense} min={5000} max={500000} step={500} prefix="₹" />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Dependents"><NumField value={dependents} onChange={setDependents} min={0} max={8} step={1} /></FieldRow>
          <FieldRow label="Job Stability">
            <SelectField
              value={jobStability}
              onChange={setJobStability}
              options={[
                { value: "high", label: "High (stable income)" },
                { value: "medium", label: "Medium" },
                { value: "low", label: "Low (volatile income)" },
              ]}
            />
          </FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Existing Emergency Fund"><NumField value={existingFund} onChange={setExistingFund} min={0} max={10000000} step={1000} prefix="₹" /></FieldRow>
          <FieldRow label="Monthly Contribution"><NumField value={monthlyContribution} onChange={setMonthlyContribution} min={500} max={300000} step={500} prefix="₹" /></FieldRow>
        </div>
        <FieldRow label="Expected Return (savings/liquid)">
          <NumField value={savingsRate} onChange={setSavingsRate} min={3} max={9} step={0.1} suffix="%" />
        </FieldRow>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${GREEN}, #047857)` }}>
          <p className="text-xs text-white/60 uppercase font-semibold">Emergency Readiness</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{fmtShort(target)}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Current</p><p className="text-sm font-bold">{fmtShort(existingFund)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Gap</p><p className="text-sm font-bold">{fmtShort(gap)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Months Target</p><p className="text-sm font-bold">{monthsTarget}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Completion ETA</p><p className="text-sm font-bold">{months} mo</p></div>
          </div>
        </div>
        <BarChart data={[
          { label: "Target Corpus", value: target, color: DB },
          { label: "Current Corpus", value: existingFund, color: GREEN },
          { label: "Remaining Gap", value: gap, color: OG },
        ]} />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
            <p className="text-[10px] text-gray-500">Savings A/c</p>
            <p className="text-sm font-bold text-gray-800">{fmtShort(allocation.savings)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
            <p className="text-[10px] text-gray-500">Liquid Fund</p>
            <p className="text-sm font-bold text-gray-800">{fmtShort(allocation.liquid)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
            <p className="text-[10px] text-gray-500">FD Ladder</p>
            <p className="text-sm font-bold text-gray-800">{fmtShort(allocation.fd)}</p>
          </div>
        </div>
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const InsuranceNeedCalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [age, setAge] = useState(32);
  const [annualIncome, setAnnualIncome] = useState(1200000);
  const [existingTermCover, setExistingTermCover] = useState(0);
  const [outstandingLoans, setOutstandingLoans] = useState(1500000);
  const [dependents, setDependents] = useState(2);
  const [yearsToSupport, setYearsToSupport] = useState(20);
  const [existingInvestments, setExistingInvestments] = useState(800000);
  const [medicalInflation, setMedicalInflation] = useState(10);
  const [existingHealthCover, setExistingHealthCover] = useState(500000);

  const incomeProtectionNeed = annualIncome * yearsToSupport * 0.7;
  const dependentBuffer = dependents * annualIncome;
  const totalLifeNeed = Math.max(0, incomeProtectionNeed + outstandingLoans + dependentBuffer - existingInvestments);
  const additionalTermNeed = Math.max(0, totalLifeNeed - existingTermCover);

  const baseHealthNeed = 1000000 + dependents * 300000;
  const futureHealthNeed = baseHealthNeed * Math.pow(1 + medicalInflation / 100, 5);
  const additionalHealthNeed = Math.max(0, futureHealthNeed - existingHealthCover);

  useEffect(() => {
    onContextUpdate(
      `Insurance Need: age ${age}, life cover need ${fmtShort(totalLifeNeed)}, additional term ${fmtShort(additionalTermNeed)}, health top-up need ${fmtShort(additionalHealthNeed)}.`
    );
  }, [age, totalLifeNeed, additionalTermNeed, additionalHealthNeed]);

  const insight = `**Insurance adequacy check:**\n\n• Total life cover need estimate: **${fmtShort(totalLifeNeed)}**\n• Additional term cover required: **${fmtShort(additionalTermNeed)}**\n• Health cover target (5-year medical inflation adjusted): **${fmtShort(futureHealthNeed)}**\n• Additional health cover/top-up needed: **${fmtShort(additionalHealthNeed)}**\n\n**Guidance**: Prioritize pure term plan + family floater with super top-up. Avoid mixing insurance with investment products.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Age"><NumField value={age} onChange={setAge} min={18} max={70} step={1} suffix="yrs" /></FieldRow>
          <FieldRow label="Dependents"><NumField value={dependents} onChange={setDependents} min={0} max={8} step={1} /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Annual Income"><NumField value={annualIncome} onChange={setAnnualIncome} min={100000} max={10000000} step={10000} prefix="₹" /></FieldRow>
          <FieldRow label="Years of Income Support"><NumField value={yearsToSupport} onChange={setYearsToSupport} min={5} max={35} step={1} suffix="yrs" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Outstanding Loans"><NumField value={outstandingLoans} onChange={setOutstandingLoans} min={0} max={50000000} step={10000} prefix="₹" /></FieldRow>
          <FieldRow label="Existing Investments"><NumField value={existingInvestments} onChange={setExistingInvestments} min={0} max={50000000} step={10000} prefix="₹" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Existing Term Cover"><NumField value={existingTermCover} onChange={setExistingTermCover} min={0} max={100000000} step={100000} prefix="₹" /></FieldRow>
          <FieldRow label="Existing Health Cover"><NumField value={existingHealthCover} onChange={setExistingHealthCover} min={0} max={10000000} step={50000} prefix="₹" /></FieldRow>
        </div>
        <FieldRow label="Medical Inflation">
          <NumField value={medicalInflation} onChange={setMedicalInflation} min={5} max={15} step={0.5} suffix="%" />
        </FieldRow>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${OG}, #c44d12)` }}>
          <p className="text-xs text-white/60 uppercase font-semibold">Coverage Snapshot</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{fmtShort(additionalTermNeed)}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Life Need</p><p className="text-sm font-bold">{fmtShort(totalLifeNeed)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Addl Term</p><p className="text-sm font-bold">{fmtShort(additionalTermNeed)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Health Target</p><p className="text-sm font-bold">{fmtShort(futureHealthNeed)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Health Gap</p><p className="text-sm font-bold">{fmtShort(additionalHealthNeed)}</p></div>
          </div>
        </div>
        <BarChart data={[
          { label: "Life Cover Need", value: totalLifeNeed, color: DB },
          { label: "Existing Term Cover", value: existingTermCover, color: GREEN },
          { label: "Additional Term Needed", value: additionalTermNeed, color: OG },
        ]} />
        <div className="mt-4 flex items-center justify-center">
          <div className="relative">
            <DonutChart
              pct={Math.max(0, Math.min(100, totalLifeNeed > 0 ? (existingTermCover / totalLifeNeed) * 100 : 0))}
              color={GREEN}
              size={130}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-lg font-extrabold text-gray-800">
                {Math.round(Math.max(0, Math.min(100, totalLifeNeed > 0 ? (existingTermCover / totalLifeNeed) * 100 : 0)))}%
              </p>
              <p className="text-[10px] text-gray-500">Life Cover Ready</p>
            </div>
          </div>
        </div>
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const HomeLoanEligibilityCalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [netMonthlyIncome, setNetMonthlyIncome] = useState(120000);
  const [existingObligations, setExistingObligations] = useState(15000);
  const [foirLimit, setFoirLimit] = useState(45);
  const [loanRate, setLoanRate] = useState(8.75);
  const [tenureYears, setTenureYears] = useState(20);
  const [downPaymentPct, setDownPaymentPct] = useState(20);

  const eligibleEmi = Math.max(0, (netMonthlyIncome * foirLimit / 100) - existingObligations);
  const r = loanRate / 12 / 100;
  const n = tenureYears * 12;
  const eligibleLoan = r === 0 ? eligibleEmi * n : eligibleEmi * ((Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n)));
  const maxPropertyValue = downPaymentPct >= 100 ? eligibleLoan : eligibleLoan / (1 - downPaymentPct / 100);
  const maxTotalObligation = netMonthlyIncome * foirLimit / 100;
  const usedPct = maxTotalObligation > 0 ? (existingObligations / maxTotalObligation) * 100 : 0;
  const eligibilityAt = (testRate: number) => {
    const tr = testRate / 12 / 100;
    return tr === 0 ? eligibleEmi * n : eligibleEmi * ((Math.pow(1 + tr, n) - 1) / (tr * Math.pow(1 + tr, n)));
  };

  useEffect(() => {
    onContextUpdate(
      `Home Loan Eligibility: income ${fmtShort(netMonthlyIncome)}, FOIR ${foirLimit}%, eligible EMI ${fmtShort(eligibleEmi)}, eligible loan ${fmtShort(eligibleLoan)}.`
    );
  }, [netMonthlyIncome, foirLimit, eligibleEmi, eligibleLoan]);

  const insight = `**Home loan eligibility estimate:**\n\n• Max eligible EMI: **${fmtShort(eligibleEmi)}**\n• Approx loan eligibility: **${fmtShort(eligibleLoan)}**\n• Approx max property budget (with ${downPaymentPct}% down payment): **${fmtShort(maxPropertyValue)}**\n\n**Tip**: Keep FOIR below 40-45% for better approval odds and lower repayment stress.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Net Monthly Income"><NumField value={netMonthlyIncome} onChange={setNetMonthlyIncome} min={10000} max={2000000} step={1000} prefix="₹" /></FieldRow>
        <FieldRow label="Existing Monthly Obligations"><NumField value={existingObligations} onChange={setExistingObligations} min={0} max={500000} step={500} prefix="₹" /></FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="FOIR Limit"><NumField value={foirLimit} onChange={setFoirLimit} min={30} max={60} step={1} suffix="%" /></FieldRow>
          <FieldRow label="Loan Tenure"><NumField value={tenureYears} onChange={setTenureYears} min={5} max={30} step={1} suffix="yrs" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Interest Rate"><NumField value={loanRate} onChange={setLoanRate} min={6} max={14} step={0.1} suffix="%" /></FieldRow>
          <FieldRow label="Down Payment"><NumField value={downPaymentPct} onChange={setDownPaymentPct} min={10} max={50} step={1} suffix="%" /></FieldRow>
        </div>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${DB}, #0f2540)` }}>
          <p className="text-xs text-white/60 uppercase font-semibold">Eligibility Snapshot</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{fmtShort(eligibleLoan)}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Eligible EMI</p><p className="text-sm font-bold">{fmtShort(eligibleEmi)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Loan Eligibility</p><p className="text-sm font-bold">{fmtShort(eligibleLoan)}</p></div>
            <div className="rounded-xl p-2.5 col-span-2" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Max Property Budget</p><p className="text-sm font-bold">{fmtShort(maxPropertyValue)}</p></div>
          </div>
        </div>
        <BarChart data={[
          { label: "Max Allowed Obligation", value: maxTotalObligation, color: DB },
          { label: "Existing Obligation", value: existingObligations, color: OG },
          { label: "New EMI Capacity", value: eligibleEmi, color: GREEN },
        ]} />
        <div className="mt-4 flex items-center justify-center">
          <div className="relative">
            <DonutChart pct={Math.max(0, Math.min(100, usedPct))} color={OG} size={130} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-lg font-extrabold text-gray-800">{Math.round(usedPct)}%</p>
              <p className="text-[10px] text-gray-500">FOIR Used</p>
            </div>
          </div>
        </div>
        <BenchmarkBand
          label="FOIR Stress Meter"
          value={foirLimit}
          min={30}
          max={60}
          goodMax={45}
          format={(n) => `${n.toFixed(0)}%`}
        />
        <ScenarioComparison
          title="Rate Sensitivity (Loan Eligibility)"
          scenarios={[
            { label: `${(loanRate - 1).toFixed(1)}% (Best Case)`, value: eligibilityAt(Math.max(loanRate - 1, 1)), color: GREEN },
            { label: `${loanRate.toFixed(1)}% (Base Case)`, value: eligibilityAt(loanRate), color: DB },
            { label: `${(loanRate + 1).toFixed(1)}% (Stress Case)`, value: eligibilityAt(loanRate + 1), color: OG },
          ]}
        />
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const CreditCardEMICalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [outstanding, setOutstanding] = useState(120000);
  const [annualRate, setAnnualRate] = useState(36);
  const [processingFeePct, setProcessingFeePct] = useState(2);
  const [months, setMonths] = useState(12);

  const principal = outstanding + (outstanding * processingFeePct / 100);
  const r = annualRate / 12 / 100;
  const emi = r === 0 ? principal / Math.max(1, months) : principal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
  const total = emi * months;
  const interest = total - principal;
  const principalPct = total > 0 ? (principal / total) * 100 : 0;
  const emiAt = (testMonths: number) => {
    const tm = Math.max(1, testMonths);
    return r === 0 ? principal / tm : principal * r * Math.pow(1 + r, tm) / (Math.pow(1 + r, tm) - 1);
  };

  useEffect(() => {
    onContextUpdate(`Credit Card EMI: outstanding ${fmtShort(outstanding)}, rate ${annualRate}%, tenure ${months}m, EMI ${fmtShort(emi)}.`);
  }, [outstanding, annualRate, months, emi]);

  const insight = `**Credit card EMI conversion:**\n\n• Converted principal (incl. processing fee): **${fmtShort(principal)}**\n• EMI: **${fmtShort(emi)}** for ${months} months\n• Total interest cost: **${fmtShort(interest)}**\n\n**Tip**: If card EMI APR is high, compare a lower-rate personal loan balance transfer.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Outstanding Amount"><NumField value={outstanding} onChange={setOutstanding} min={5000} max={5000000} step={500} prefix="₹" /></FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Card EMI Annual Rate"><NumField value={annualRate} onChange={setAnnualRate} min={10} max={48} step={0.5} suffix="%" /></FieldRow>
          <FieldRow label="Processing Fee"><NumField value={processingFeePct} onChange={setProcessingFeePct} min={0} max={5} step={0.1} suffix="%" /></FieldRow>
        </div>
        <FieldRow label="Tenure"><NumField value={months} onChange={setMonths} min={3} max={48} step={1} suffix="mo" /></FieldRow>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${OG}, #c44d12)` }}>
          <p className="text-xs text-white/60 uppercase font-semibold">Card EMI Snapshot</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{fmtShort(emi)}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Principal</p><p className="text-sm font-bold">{fmtShort(principal)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Interest</p><p className="text-sm font-bold">{fmtShort(interest)}</p></div>
            <div className="rounded-xl p-2.5 col-span-2" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Total Payable</p><p className="text-sm font-bold">{fmtShort(total)}</p></div>
          </div>
        </div>
        <BarChart data={[
          { label: "Converted Principal", value: principal, color: DB },
          { label: "Interest Cost", value: interest, color: OG },
          { label: "Total Payable", value: total, color: GREEN },
        ]} />
        <div className="mt-4 flex items-center justify-center">
          <div className="relative">
            <DonutChart pct={Math.max(0, Math.min(100, principalPct))} color={DB} size={130} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-lg font-extrabold text-gray-800">{Math.round(principalPct)}%</p>
              <p className="text-[10px] text-gray-500">Principal Share</p>
            </div>
          </div>
        </div>
        <BenchmarkBand
          label="APR Risk Band"
          value={annualRate}
          min={10}
          max={48}
          goodMax={18}
          format={(n) => `${n.toFixed(1)}%`}
        />
        <ScenarioComparison
          title="Tenure Trade-off (EMI vs Cost)"
          scenarios={[
            { label: "6 Months", value: emiAt(6), color: GREEN },
            { label: "12 Months", value: emiAt(12), color: DB },
            { label: "24 Months", value: emiAt(24), color: OG },
          ]}
        />
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const HRACalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [basicSalary, setBasicSalary] = useState(700000);
  const [hraReceived, setHraReceived] = useState(240000);
  const [rentPaid, setRentPaid] = useState(300000);
  const [isMetro, setIsMetro] = useState("yes");

  const salary10pct = basicSalary * 0.1;
  const rentMinus10pct = Math.max(0, rentPaid - salary10pct);
  const salaryLimit = basicSalary * (isMetro === "yes" ? 0.5 : 0.4);
  const exemptHra = Math.max(0, Math.min(hraReceived, rentMinus10pct, salaryLimit));
  const taxableHra = Math.max(0, hraReceived - exemptHra);

  useEffect(() => {
    onContextUpdate(`HRA Calculator: basic ${fmtShort(basicSalary)}, HRA ${fmtShort(hraReceived)}, rent ${fmtShort(rentPaid)}, exempt ${fmtShort(exemptHra)}.`);
  }, [basicSalary, hraReceived, rentPaid, exemptHra]);

  const insight = `**HRA exemption estimate:**\n\n• Exempt HRA: **${fmtShort(exemptHra)}**\n• Taxable HRA: **${fmtShort(taxableHra)}**\n• Limiting factor used among 3-rule method (HRA received, rent-10% salary, ${isMetro === "yes" ? "50%" : "40%"} of salary)\n\nKeep valid rent receipts and PAN details where applicable.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Basic Salary (Annual)"><NumField value={basicSalary} onChange={setBasicSalary} min={100000} max={10000000} step={10000} prefix="₹" /></FieldRow>
        <FieldRow label="HRA Received (Annual)"><NumField value={hraReceived} onChange={setHraReceived} min={0} max={5000000} step={5000} prefix="₹" /></FieldRow>
        <FieldRow label="Rent Paid (Annual)"><NumField value={rentPaid} onChange={setRentPaid} min={0} max={5000000} step={5000} prefix="₹" /></FieldRow>
        <FieldRow label="Metro City">
          <SelectField
            value={isMetro}
            onChange={setIsMetro}
            options={[
              { value: "yes", label: "Yes (Delhi, Mumbai, Kolkata, Chennai)" },
              { value: "no", label: "No (Non-metro)" },
            ]}
          />
        </FieldRow>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${GREEN}, #047857)` }}>
          <p className="text-xs text-white/60 uppercase font-semibold">HRA Summary</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{fmtShort(exemptHra)}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">HRA Received</p><p className="text-sm font-bold">{fmtShort(hraReceived)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Exempt HRA</p><p className="text-sm font-bold">{fmtShort(exemptHra)}</p></div>
            <div className="rounded-xl p-2.5 col-span-2" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Taxable HRA</p><p className="text-sm font-bold">{fmtShort(taxableHra)}</p></div>
          </div>
        </div>
        <BarChart data={[
          { label: "HRA Received", value: hraReceived, color: DB },
          { label: "Rent - 10% Salary", value: rentMinus10pct, color: OG },
          { label: `${isMetro === "yes" ? "50%" : "40%"} Salary Limit`, value: salaryLimit, color: MB },
          { label: "Exempt HRA", value: exemptHra, color: GREEN },
        ]} />
        <BenchmarkBand
          label="Rent-to-Salary Ratio"
          value={basicSalary > 0 ? (rentPaid / basicSalary) * 100 : 0}
          min={0}
          max={100}
          goodMax={40}
          format={(n) => `${n.toFixed(1)}%`}
        />
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const SSYCalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [girlAge, setGirlAge] = useState(3);
  const [yearlyContribution, setYearlyContribution] = useState(100000);
  const [interestRate, setInterestRate] = useState(8.2);

  const investYears = 15;
  const maturityYears = Math.max(0, 21 - girlAge);
  let corpus = 0;
  let totalInvested = 0;
  for (let y = 0; y < maturityYears; y += 1) {
    if (y < investYears) {
      const amt = Math.min(150000, yearlyContribution);
      corpus += amt;
      totalInvested += amt;
    }
    corpus *= (1 + interestRate / 100);
  }
  const gains = corpus - totalInvested;

  useEffect(() => {
    onContextUpdate(`SSY Calculator: age ${girlAge}, yearly ${fmtShort(yearlyContribution)}, maturity ${fmtShort(corpus)}.`);
  }, [girlAge, yearlyContribution, corpus]);

  const insight = `**SSY projection:**\n\n• Investment years: **${Math.min(investYears, maturityYears)}**\n• Maturity age: **21 years** (in ${maturityYears} years)\n• Total invested: **${fmtShort(totalInvested)}**\n• Estimated maturity corpus: **${fmtShort(corpus)}**\n\nSSY annual contribution cap is ₹1.5 lakh.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Girl Child Current Age"><NumField value={girlAge} onChange={setGirlAge} min={0} max={10} step={1} suffix="yrs" /></FieldRow>
        <FieldRow label="Yearly Contribution"><NumField value={yearlyContribution} onChange={setYearlyContribution} min={250} max={150000} step={500} prefix="₹" /></FieldRow>
        <FieldRow label="SSY Interest Rate"><NumField value={interestRate} onChange={setInterestRate} min={6} max={10} step={0.1} suffix="%" /></FieldRow>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${MB}, ${DB})` }}>
          <p className="text-xs text-white/60 uppercase font-semibold">SSY Summary</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{fmtShort(corpus)}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Invested</p><p className="text-sm font-bold">{fmtShort(totalInvested)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Gains</p><p className="text-sm font-bold">{fmtShort(gains)}</p></div>
          </div>
        </div>
        <BarChart data={[
          { label: "Total Invested", value: totalInvested, color: DB },
          { label: "Interest Gains", value: gains, color: OG },
          { label: "Maturity Corpus", value: corpus, color: GREEN },
        ]} />
        <ScenarioComparison
          title="Rate Sensitivity (Maturity)"
          scenarios={[
            { label: `${Math.max(0, interestRate - 1).toFixed(1)}%`, value: (() => {
              let c = 0;
              for (let y = 0; y < maturityYears; y += 1) {
                if (y < investYears) c += Math.min(150000, yearlyContribution);
                c *= (1 + Math.max(0, interestRate - 1) / 100);
              }
              return c;
            })(), color: OG },
            { label: `${interestRate.toFixed(1)}%`, value: corpus, color: DB },
            { label: `${(interestRate + 1).toFixed(1)}%`, value: (() => {
              let c = 0;
              for (let y = 0; y < maturityYears; y += 1) {
                if (y < investYears) c += Math.min(150000, yearlyContribution);
                c *= (1 + (interestRate + 1) / 100);
              }
              return c;
            })(), color: GREEN },
          ]}
        />
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const MonthlySavingsGoalCalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [targetAmount, setTargetAmount] = useState(2000000);
  const [years, setYears] = useState(8);
  const [existingCorpus, setExistingCorpus] = useState(200000);
  const [returnRate, setReturnRate] = useState(10);
  const [stepUpPct, setStepUpPct] = useState(8);

  const r = returnRate / 12 / 100;
  const months = years * 12;
  const fvExisting = existingCorpus * Math.pow(1 + returnRate / 100, years);
  const gap = Math.max(0, targetAmount - fvExisting);

  const monthlyNeed = (() => {
    if (gap <= 0) return 0;
    let low = 0;
    let high = 1000000;
    for (let i = 0; i < 40; i += 1) {
      const mid = (low + high) / 2;
      const fv = sipFutureValueWithStepUp(mid, stepUpPct, returnRate, years);
      if (fv >= gap) high = mid;
      else low = mid;
    }
    return Math.round(high);
  })();

  const projected = fvExisting + sipFutureValueWithStepUp(monthlyNeed, stepUpPct, returnRate, years);
  const requiredSipAtReturn = (testReturn: number) => {
    const tr = Math.max(0.1, testReturn);
    const testFvExisting = existingCorpus * Math.pow(1 + tr / 100, years);
    const testGap = Math.max(0, targetAmount - testFvExisting);
    if (testGap <= 0) return 0;
    let low = 0;
    let high = 1000000;
    for (let i = 0; i < 36; i += 1) {
      const mid = (low + high) / 2;
      const fv = sipFutureValueWithStepUp(mid, stepUpPct, tr, years);
      if (fv >= testGap) high = mid;
      else low = mid;
    }
    return Math.round(high);
  };

  useEffect(() => {
    onContextUpdate(`Monthly Savings Goal: target ${fmtShort(targetAmount)}, years ${years}, required SIP ${fmtShort(monthlyNeed)}.`);
  }, [targetAmount, years, monthlyNeed]);

  const insight = `**Monthly savings target planner:**\n\n• Goal amount: **${fmtShort(targetAmount)}** in ${years} years\n• Existing corpus future value: **${fmtShort(fvExisting)}**\n• Required monthly investment: **${fmtShort(monthlyNeed)}** with ${stepUpPct}% annual step-up\n• Projected corpus: **${fmtShort(projected)}**\n\nUse this for short/medium goals like car, wedding, business seed, travel, or down payment.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Target Amount"><NumField value={targetAmount} onChange={setTargetAmount} min={50000} max={100000000} step={10000} prefix="₹" /></FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Years to Goal"><NumField value={years} onChange={setYears} min={1} max={30} step={1} suffix="yrs" /></FieldRow>
          <FieldRow label="Expected Return"><NumField value={returnRate} onChange={setReturnRate} min={4} max={16} step={0.5} suffix="%" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Existing Corpus"><NumField value={existingCorpus} onChange={setExistingCorpus} min={0} max={50000000} step={10000} prefix="₹" /></FieldRow>
          <FieldRow label="Annual Step-up"><NumField value={stepUpPct} onChange={setStepUpPct} min={0} max={20} step={1} suffix="%" /></FieldRow>
        </div>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${DB}, ${MB})` }}>
          <p className="text-xs text-white/60 uppercase font-semibold">Savings Goal Summary</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{fmtShort(monthlyNeed)}/mo</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Target</p><p className="text-sm font-bold">{fmtShort(targetAmount)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Projected</p><p className="text-sm font-bold">{fmtShort(projected)}</p></div>
          </div>
        </div>
        <BarChart data={[
          { label: "Target Amount", value: targetAmount, color: DB },
          { label: "Future Value of Existing", value: fvExisting, color: GREEN },
          { label: "Projected Total", value: projected, color: OG },
          { label: "Residual Gap", value: Math.max(0, targetAmount - projected), color: "#ef4444" },
        ]} />
        <ScenarioComparison
          title="Return Assumption Sensitivity (Required SIP)"
          scenarios={[
            { label: `${Math.max(0, returnRate - 2).toFixed(1)}% Return`, value: requiredSipAtReturn(returnRate - 2), color: OG },
            { label: `${returnRate.toFixed(1)}% Return`, value: requiredSipAtReturn(returnRate), color: DB },
            { label: `${(returnRate + 2).toFixed(1)}% Return`, value: requiredSipAtReturn(returnRate + 2), color: GREEN },
          ]}
        />
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

/* Tax Saving */
const TaxCalc = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [income, setI]  = useState(1200000);
  const [c80, setC80]   = useState(150000);
  const [d80, setD80]   = useState(25000);
  const [nps, setNps]   = useState(50000);
  const [hra, setHra]   = useState(0);

  const dedns = Math.min(c80, 150000) + Math.min(d80, 25000) + Math.min(nps, 50000) + hra;
  const stdDedn = 50000;
  const taxable = Math.max(0, income - dedns - stdDedn);

  const computeTax = (ti: number) => {
    if (ti <= 250000) return 0;
    if (ti <= 500000) return (ti - 250000) * 0.05;
    if (ti <= 750000) return 12500 + (ti - 500000) * 0.10;
    if (ti <= 1000000) return 37500 + (ti - 750000) * 0.15;
    if (ti <= 1250000) return 75000 + (ti - 1000000) * 0.20;
    if (ti <= 1500000) return 125000 + (ti - 1250000) * 0.25;
    return 187500 + (ti - 1500000) * 0.30;
  };

  const taxBefore = computeTax(income - stdDedn) * 1.04;
  const taxAfter  = computeTax(taxable) * 1.04;
  const saved     = taxBefore - taxAfter;
  const effRate   = ((taxAfter / income) * 100).toFixed(1);

  useEffect(() => {
    onContextUpdate(`Tax Calculator: Income ${fmtShort(income)}, deductions ${fmtShort(dedns+stdDedn)}, tax payable ${fmtShort(taxAfter)}, saved ${fmtShort(saved)}`);
  }, [income, c80, d80, nps, hra]);

  const insight = `**You're saving ${fmt(saved)}/year in taxes** 🎉\n\n• Effective tax rate after deductions: **${effRate}%** of gross income\n• Still untapped: ${150000 - c80 > 0 ? `**${fmtShort(150000 - c80)} more in 80C** (PPF/ELSS) ` : ""}${50000 - nps > 0 ? `**${fmtShort(50000 - nps)} more in NPS** ` : ""}\n• Every ₹1L in additional 80C saves **₹10,000–₹30,000** depending on your tax slab\n\n**Quick win**: If you don't have health insurance, buying a ₹25K policy saves ₹7,500 in tax AND protects your family.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Annual Gross Income">
          <NumField value={income} onChange={setI} min={300000} max={10000000} step={100000} prefix="₹" />
          <p className="text-xs text-right text-gray-400 mt-0.5">{fmtShort(income)}/year</p>
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="80C Investments (max ₹1.5L)"><NumField value={c80} onChange={setC80} min={0} max={150000} step={5000} prefix="₹" /></FieldRow>
          <FieldRow label="80D Health Insurance (max ₹25K)"><NumField value={d80} onChange={setD80} min={0} max={25000} step={1000} prefix="₹" /></FieldRow>
          <FieldRow label="NPS Contribution (max ₹50K)"><NumField value={nps} onChange={setNps} min={0} max={50000} step={5000} prefix="₹" /></FieldRow>
          <FieldRow label="HRA Exemption"><NumField value={hra} onChange={setHra} min={0} max={600000} step={10000} prefix="₹" /></FieldRow>
        </div>
      </div>
      <div className="space-y-3">
        <div className="rounded-2xl p-5 text-center" style={{ background: `linear-gradient(135deg, ${GREEN}, #047857)` }}>
          <p className="text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Tax Saved This Year</p>
          <p className="text-4xl font-extrabold text-white">{fmt(saved)}</p>
          <p className="text-white/60 text-xs mt-1">Effective rate: {effRate}% of gross income</p>
        </div>
        <BarChart data={[
          { label: "Total Deductions", value: dedns + stdDedn, color: GREEN },
          { label: "Taxable Income", value: taxable, color: MB },
          { label: "Tax Payable", value: taxAfter, color: OG },
        ]} />
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   FINANCIAL PLANNER — GOAL ENGINE
═══════════════════════════════════════════════════════════ */

const GOAL_LIST = [
  { id: "home",       icon: "🏠", label: "Buy a Home",          amount: 7500000, years: 10 },
  { id: "education",  icon: "🎓", label: "Child's Education",   amount: 3000000, years: 12 },
  { id: "retirement", icon: "🌴", label: "Retire Comfortably",  amount: 20000000, years: 25 },
  { id: "marriage",   icon: "💍", label: "Wedding Expenses",    amount: 2000000, years: 5  },
  { id: "vehicle",    icon: "🚗", label: "Buy a Car",           amount: 1200000, years: 4  },
  { id: "emergency",  icon: "🛡️", label: "Emergency Fund",     amount: 500000, years: 2  },
];

const GoalEngine = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [goalId, setGoalId]     = useState("home");
  const [target, setTarget]     = useState(7500000);
  const [years, setYears]       = useState(10);
  const [current, setCurrent]   = useState(0);
  const [retRate]               = useState(12);
  const [income, setIncome]     = useState(80000);

  const goal = GOAL_LIST.find(g => g.id === goalId)!;

  const fvCurrent = current * Math.pow(1 + retRate / 100, years);
  const gap       = Math.max(0, target - fvCurrent);
  const r  = retRate / 12 / 100;
  const n  = years * 12;
  const reqSIP = r === 0 ? gap / n : gap * r / ((Math.pow(1+r,n)-1)*(1+r));
  const onTrack   = fvCurrent >= target;
  const sipPct    = (reqSIP / income * 100).toFixed(0);
  const healthScore = Math.min(100, Math.round(
    (current > 0 ? 30 : 0) + (reqSIP < income * 0.2 ? 30 : 15) + (years >= 10 ? 20 : 10) + (onTrack ? 20 : 0)
  ));

  useEffect(() => {
    onContextUpdate(`Goal Planner: ${goal.label}, target ${fmtShort(target)}, ${years}yr, current savings ${fmtShort(current)}, required SIP ${fmtShort(reqSIP)}/mo`);
  }, [goalId, target, years, current, retRate]);

  return (
    <div className="space-y-5">
      {/* Goal selector */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Choose Your Goal</p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {GOAL_LIST.map(g => (
            <button key={g.id} onClick={() => { setGoalId(g.id); setTarget(g.amount); setYears(g.years); }}
              className="rounded-2xl p-3 border-2 text-center transition-all hover:scale-105"
              style={{ borderColor: goalId === g.id ? OG : "#e5e7eb", background: goalId === g.id ? OG_PALE : "#fff" }}
            >
              <span className="block text-2xl mb-1">{g.icon}</span>
              <span className="text-[11px] font-semibold leading-tight block" style={{ color: goalId === g.id ? OG : "#374151" }}>{g.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <FieldRow label={`Target for ${goal.label}`}>
          <NumField value={target} onChange={setTarget} min={50000} max={100000000} step={100000} prefix="₹" />
          <p className="text-xs text-right text-gray-400 mt-0.5">{fmtShort(target)}</p>
        </FieldRow>
        <FieldRow label="Years to Goal">
          <NumField value={years} onChange={setYears} min={1} max={40} step={1} suffix="yrs" />
        </FieldRow>
        <FieldRow label="Current Savings">
          <NumField value={current} onChange={setCurrent} min={0} max={50000000} step={10000} prefix="₹" />
        </FieldRow>
        <FieldRow label="Monthly Income">
          <NumField value={income} onChange={setIncome} min={10000} max={2000000} step={5000} prefix="₹" />
        </FieldRow>
      </div>

      {/* Result */}
      <div className={`rounded-2xl p-5 border-2 ${onTrack ? "border-green-200" : "border-orange-200"}`}
        style={{ background: onTrack ? "#f0fdf4" : OG_PALE }}
      >
        <div className="grid sm:grid-cols-3 gap-4 items-center">
          <div className="flex items-center gap-3 sm:col-span-2">
            <div className="size-12 rounded-2xl flex items-center justify-center text-white"
              style={{ background: onTrack ? GREEN : OG }}>
              {onTrack ? <Check size={22} /> : <AlertCircle size={22} />}
            </div>
            <div>
              {onTrack
                ? <p className="font-bold text-green-700 text-lg">You're on track! 🎉</p>
                : <><p className="font-bold text-lg" style={{ color: OG }}>Start SIP of <span className="text-2xl">{fmtShort(reqSIP)}</span>/month</p>
                    <p className="text-sm text-gray-500 mt-0.5">That's {sipPct}% of your income — {Number(sipPct) <= 20 ? "very manageable" : Number(sipPct) <= 30 ? "achievable with planning" : "may need to increase income or extend timeline"}</p></>
              }
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="rounded-xl p-3 text-center" style={{ background: onTrack ? GREEN : OG }}>
              <p className="text-[10px] text-white/70">Goal</p>
              <p className="font-extrabold text-white">{fmtShort(target)}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-black/5 grid grid-cols-3 gap-3 text-center text-xs">
          <div><p className="text-gray-500">Current savings grows to</p><p className="font-bold text-gray-800">{fmtShort(fvCurrent)}</p></div>
          <div><p className="text-gray-500">Gap to fill via SIP</p><p className="font-bold text-gray-800">{fmtShort(gap)}</p></div>
          <div><p className="text-gray-500">Financial Health</p>
            <div className="flex items-center justify-center gap-1">
              <div className="flex-1 h-1.5 rounded-full bg-gray-200"><div className="h-full rounded-full" style={{ width: `${healthScore}%`, background: healthScore > 70 ? GREEN : healthScore > 40 ? OG : "#ef4444" }} /></div>
              <span className="font-bold" style={{ color: healthScore > 70 ? GREEN : healthScore > 40 ? OG : "#ef4444" }}>{healthScore}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const HomeGoalPlanner = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [cityTier, setCityTier] = useState("tier1");
  const [propertyType, setPropertyType] = useState("apartment");
  const [purpose, setPurpose] = useState("self");
  const [homeCostToday, setHomeCostToday] = useState(8000000);
  const [yearsToBuy, setYearsToBuy] = useState(7);
  const [homeInflation, setHomeInflation] = useState(7);
  const [downPct, setDownPct] = useState(20);
  const [existingDownCorpus, setExistingDownCorpus] = useState(600000);
  const [monthlySIP, setMonthlySIP] = useState(25000);
  const [annualStepUp, setAnnualStepUp] = useState(8);
  const [returnRate, setReturnRate] = useState(11);
  const [loanRate, setLoanRate] = useState(8.75);
  const [loanTenure, setLoanTenure] = useState(20);
  const [monthlyIncome, setMonthlyIncome] = useState(140000);
  const [existingEmi, setExistingEmi] = useState(10000);

  const futureCost = homeCostToday * Math.pow(1 + homeInflation / 100, yearsToBuy);
  const requiredDown = futureCost * downPct / 100;
  const downCorpusFuture = existingDownCorpus * Math.pow(1 + returnRate / 100, yearsToBuy)
    + sipFutureValueWithStepUp(monthlySIP, annualStepUp, returnRate, yearsToBuy);
  const downGap = Math.max(0, requiredDown - downCorpusFuture);
  const additionalSipNeeded = downGap > 0 ? downGap / Math.max(12, yearsToBuy * 12) : 0;

  const loanPrincipal = Math.max(0, futureCost - requiredDown);
  const rm = loanRate / 12 / 100;
  const n = loanTenure * 12;
  const emi = rm === 0 ? loanPrincipal / Math.max(1, n) : loanPrincipal * rm * Math.pow(1 + rm, n) / (Math.pow(1 + rm, n) - 1);
  const projectedIncomeAtPurchase = monthlyIncome * Math.pow(1 + 7 / 100, yearsToBuy);
  const foir = projectedIncomeAtPurchase > 0 ? ((emi + existingEmi) / projectedIncomeAtPurchase) * 100 : 0;

  useEffect(() => {
    onContextUpdate(
      `Home Goal Planner: ${cityTier}, ${propertyType}, purpose ${purpose}, target purchase ${yearsToBuy} years, future cost ${fmtShort(futureCost)}, down payment need ${fmtShort(requiredDown)}, EMI at purchase ${fmtShort(emi)}.`
    );
  }, [cityTier, propertyType, purpose, yearsToBuy, futureCost, requiredDown, emi]);

  const insight = `**Home goal readiness (${yearsToBuy} years):**\n\n• Future home cost estimate: **${fmtShort(futureCost)}**\n• Required down payment (${downPct}%): **${fmtShort(requiredDown)}**\n• Projected down corpus: **${fmtShort(downCorpusFuture)}**\n• Expected EMI at purchase: **${fmtShort(emi)}** | Projected FOIR: **${foir.toFixed(1)}%**\n\n**Action**: ${downGap > 0 ? `Increase monthly savings by ~${fmtShort(additionalSipNeeded)} for down payment readiness.` : "Down payment plan looks on track."}`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <FieldRow label="City Category">
            <SelectField
              value={cityTier}
              onChange={setCityTier}
              options={[
                { value: "tier1", label: "Tier-1 Metro" },
                { value: "tier2", label: "Tier-2 City" },
                { value: "tier3", label: "Tier-3 / Town" },
              ]}
            />
          </FieldRow>
          <FieldRow label="Property Type">
            <SelectField
              value={propertyType}
              onChange={setPropertyType}
              options={[
                { value: "apartment", label: "Apartment" },
                { value: "villa", label: "Villa / Independent House" },
                { value: "plot", label: "Plot + Construction" },
              ]}
            />
          </FieldRow>
          <FieldRow label="Purpose">
            <SelectField
              value={purpose}
              onChange={setPurpose}
              options={[
                { value: "self", label: "Self Occupied" },
                { value: "upgrade", label: "Upgrade / Larger Home" },
                { value: "investment", label: "Investment Property" },
              ]}
            />
          </FieldRow>
        </div>
        <FieldRow label="Current Property Cost">
          <NumField value={homeCostToday} onChange={setHomeCostToday} min={1500000} max={50000000} step={100000} prefix="₹" />
        </FieldRow>
        <div className="grid grid-cols-3 gap-3">
          <FieldRow label="Years to Buy"><NumField value={yearsToBuy} onChange={setYearsToBuy} min={1} max={20} step={1} suffix="yrs" /></FieldRow>
          <FieldRow label="Property Inflation"><NumField value={homeInflation} onChange={setHomeInflation} min={3} max={12} step={0.5} suffix="%" /></FieldRow>
          <FieldRow label="Down Payment"><NumField value={downPct} onChange={setDownPct} min={10} max={50} step={1} suffix="%" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Existing Down Payment Corpus"><NumField value={existingDownCorpus} onChange={setExistingDownCorpus} min={0} max={50000000} step={10000} prefix="₹" /></FieldRow>
          <FieldRow label="Monthly Savings for Down Payment"><NumField value={monthlySIP} onChange={setMonthlySIP} min={500} max={300000} step={500} prefix="₹" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Step-up on Savings"><NumField value={annualStepUp} onChange={setAnnualStepUp} min={0} max={20} step={1} suffix="%" /></FieldRow>
          <FieldRow label="Expected Return"><NumField value={returnRate} onChange={setReturnRate} min={5} max={16} step={0.5} suffix="%" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Home Loan Interest"><NumField value={loanRate} onChange={setLoanRate} min={6} max={14} step={0.1} suffix="%" /></FieldRow>
          <FieldRow label="Loan Tenure"><NumField value={loanTenure} onChange={setLoanTenure} min={10} max={30} step={1} suffix="yrs" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Current Monthly Income"><NumField value={monthlyIncome} onChange={setMonthlyIncome} min={10000} max={2000000} step={1000} prefix="₹" /></FieldRow>
          <FieldRow label="Existing EMIs"><NumField value={existingEmi} onChange={setExistingEmi} min={0} max={500000} step={500} prefix="₹" /></FieldRow>
        </div>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${DB}, #0f2540)` }}>
          <p className="text-xs text-white/60 uppercase font-semibold">Home Goal Summary</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{fmtShort(futureCost)}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}><p className="text-[10px] text-white/50">Down Payment Need</p><p className="text-sm font-bold">{fmtShort(requiredDown)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}><p className="text-[10px] text-white/50">Projected Corpus</p><p className="text-sm font-bold">{fmtShort(downCorpusFuture)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}><p className="text-[10px] text-white/50">EMI at Purchase</p><p className="text-sm font-bold">{fmtShort(emi)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}><p className="text-[10px] text-white/50">Projected FOIR</p><p className="text-sm font-bold" style={{ color: foir <= 40 ? "#86efac" : "#fca5a5" }}>{foir.toFixed(1)}%</p></div>
          </div>
        </div>
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const EducationGoalPlanner = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [courseType, setCourseType] = useState("undergrad");
  const [studyLocation, setStudyLocation] = useState("india-private");
  const [childAge, setChildAge] = useState(5);
  const [startAge, setStartAge] = useState(18);
  const [durationYears, setDurationYears] = useState(4);
  const [currentAnnualCost, setCurrentAnnualCost] = useState(400000);
  const [educationInflation, setEducationInflation] = useState(9);
  const [existingCorpus, setExistingCorpus] = useState(300000);
  const [monthlySIP, setMonthlySIP] = useState(18000);
  const [stepUp, setStepUp] = useState(10);
  const [returnRate, setReturnRate] = useState(11);
  const [postGoalReturn, setPostGoalReturn] = useState(6);

  useEffect(() => {
    if (studyLocation === "india-gov") {
      setCurrentAnnualCost((v) => Math.min(v, 250000));
      setEducationInflation(7.5);
    } else if (studyLocation === "india-private") {
      setCurrentAnnualCost((v) => Math.max(350000, v));
      setEducationInflation(9);
    } else {
      setCurrentAnnualCost((v) => Math.max(1500000, v));
      setEducationInflation(10);
    }
    if (courseType === "professional") {
      setDurationYears((d) => Math.max(d, 5));
    } else if (courseType === "postgrad") {
      setDurationYears((d) => Math.min(Math.max(d, 2), 3));
    }
  }, [studyLocation, courseType]);

  const yearsToGoal = Math.max(0, startAge - childAge);
  const firstYearCost = currentAnnualCost * Math.pow(1 + educationInflation / 100, yearsToGoal);
  let totalCourseCostAtGoal = 0;
  for (let i = 0; i < durationYears; i += 1) {
    const yrCost = firstYearCost * Math.pow(1 + educationInflation / 100, i);
    totalCourseCostAtGoal += yrCost / Math.pow(1 + postGoalReturn / 100, i);
  }

  const futureCorpus = existingCorpus * Math.pow(1 + returnRate / 100, yearsToGoal)
    + sipFutureValueWithStepUp(monthlySIP, stepUp, returnRate, yearsToGoal);
  const gap = Math.max(0, totalCourseCostAtGoal - futureCorpus);
  const addlSip = gap > 0 ? gap / Math.max(12, yearsToGoal * 12) : 0;

  useEffect(() => {
    onContextUpdate(
      `Child Education Planner: ${courseType}, ${studyLocation}, child age ${childAge}, start age ${startAge}, years ${yearsToGoal}, target corpus ${fmtShort(totalCourseCostAtGoal)}, projected corpus ${fmtShort(futureCorpus)}.`
    );
  }, [courseType, studyLocation, childAge, startAge, yearsToGoal, totalCourseCostAtGoal, futureCorpus]);

  const insight = `**Child education projection:**\n\n• Education starts in **${yearsToGoal} years**\n• First-year cost estimate: **${fmtShort(firstYearCost)}**\n• Total course corpus needed today-at-goal value: **${fmtShort(totalCourseCostAtGoal)}**\n• Projected corpus: **${fmtShort(futureCorpus)}**\n\n**Action**: ${gap > 0 ? `Increase SIP by around ${fmtShort(addlSip)} per month.` : "Current plan looks sufficient for this goal."}`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Course Type">
            <SelectField
              value={courseType}
              onChange={setCourseType}
              options={[
                { value: "undergrad", label: "Undergraduate" },
                { value: "postgrad", label: "Postgraduate" },
                { value: "professional", label: "Professional / Medical / MBA" },
              ]}
            />
          </FieldRow>
          <FieldRow label="Study Location">
            <SelectField
              value={studyLocation}
              onChange={setStudyLocation}
              options={[
                { value: "india-gov", label: "India - Public / Government" },
                { value: "india-private", label: "India - Private" },
                { value: "abroad", label: "Abroad" },
              ]}
            />
          </FieldRow>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <FieldRow label="Child Age"><NumField value={childAge} onChange={setChildAge} min={0} max={18} step={1} suffix="yrs" /></FieldRow>
          <FieldRow label="Education Starts At"><NumField value={startAge} onChange={setStartAge} min={16} max={25} step={1} suffix="yrs" /></FieldRow>
          <FieldRow label="Course Duration"><NumField value={durationYears} onChange={setDurationYears} min={1} max={7} step={1} suffix="yrs" /></FieldRow>
        </div>
        <FieldRow label="Current Annual Education Cost">
          <NumField value={currentAnnualCost} onChange={setCurrentAnnualCost} min={100000} max={5000000} step={10000} prefix="₹" />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Education Inflation"><NumField value={educationInflation} onChange={setEducationInflation} min={5} max={15} step={0.5} suffix="%" /></FieldRow>
          <FieldRow label="Expected Return (till goal)"><NumField value={returnRate} onChange={setReturnRate} min={6} max={16} step={0.5} suffix="%" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Existing Corpus"><NumField value={existingCorpus} onChange={setExistingCorpus} min={0} max={30000000} step={10000} prefix="₹" /></FieldRow>
          <FieldRow label="Monthly SIP"><NumField value={monthlySIP} onChange={setMonthlySIP} min={500} max={300000} step={500} prefix="₹" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="SIP Step-up"><NumField value={stepUp} onChange={setStepUp} min={0} max={20} step={1} suffix="%" /></FieldRow>
          <FieldRow label="Return During Payout"><NumField value={postGoalReturn} onChange={setPostGoalReturn} min={4} max={10} step={0.5} suffix="%" /></FieldRow>
        </div>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${GREEN}, #047857)` }}>
          <p className="text-xs text-white/70 uppercase font-semibold">Education Goal Summary</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{fmtShort(totalCourseCostAtGoal)}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Years Remaining</p><p className="text-sm font-bold">{yearsToGoal}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">First-year Cost</p><p className="text-sm font-bold">{fmtShort(firstYearCost)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Projected Corpus</p><p className="text-sm font-bold">{fmtShort(futureCorpus)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Gap</p><p className="text-sm font-bold">{fmtShort(gap)}</p></div>
          </div>
        </div>
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const RetirementGoalPlanner = ({ onContextUpdate }: { onContextUpdate: (s: string) => void }) => {
  const [lifestyle, setLifestyle] = useState("comfortable");
  const [currentAge, setCurrentAge] = useState(30);
  const [retirementAge, setRetirementAge] = useState(60);
  const [lifeExpectancy, setLifeExpectancy] = useState(85);
  const [monthlyExpenseToday, setMonthlyExpenseToday] = useState(70000);
  const [replacementPct, setReplacementPct] = useState(80);
  const [inflationPre, setInflationPre] = useState(6);
  const [inflationPost, setInflationPost] = useState(5);
  const [returnPre, setReturnPre] = useState(11);
  const [returnPost, setReturnPost] = useState(7);
  const [existingCorpus, setExistingCorpus] = useState(900000);
  const [monthlyInvest, setMonthlyInvest] = useState(25000);
  const [stepUp, setStepUp] = useState(10);
  const [expectedMonthlyPensionToday, setExpectedMonthlyPensionToday] = useState(12000);

  useEffect(() => {
    if (lifestyle === "basic") setReplacementPct(65);
    if (lifestyle === "comfortable") setReplacementPct(80);
    if (lifestyle === "premium") setReplacementPct(95);
  }, [lifestyle]);

  const yearsToRetire = Math.max(0, retirementAge - currentAge);
  const yearsAfterRetire = Math.max(1, lifeExpectancy - retirementAge);
  const expenseAtRetire = monthlyExpenseToday * (replacementPct / 100) * Math.pow(1 + inflationPre / 100, yearsToRetire);
  const annualExpenseAtRetire = expenseAtRetire * 12;

  const realRatePost = ((1 + returnPost / 100) / (1 + inflationPost / 100)) - 1;
  const annuityFactor = Math.abs(realRatePost) < 1e-6
    ? yearsAfterRetire
    : (1 - Math.pow(1 + realRatePost, -yearsAfterRetire)) / realRatePost;
  const requiredCorpus = annualExpenseAtRetire * annuityFactor;

  const pensionAtRetire = expectedMonthlyPensionToday * Math.pow(1 + inflationPre / 100, yearsToRetire) * 12;
  const pensionPV = pensionAtRetire * annuityFactor;
  const corpusNeededFromInvestments = Math.max(0, requiredCorpus - pensionPV);

  const projectedCorpus = existingCorpus * Math.pow(1 + returnPre / 100, yearsToRetire)
    + sipFutureValueWithStepUp(monthlyInvest, stepUp, returnPre, yearsToRetire);
  const gap = Math.max(0, corpusNeededFromInvestments - projectedCorpus);
  const addlSip = gap > 0 ? gap / Math.max(12, yearsToRetire * 12) : 0;

  useEffect(() => {
    onContextUpdate(
      `Retirement Planner: lifestyle ${lifestyle}, age ${currentAge}->${retirementAge}, required corpus ${fmtShort(corpusNeededFromInvestments)}, projected corpus ${fmtShort(projectedCorpus)}, gap ${fmtShort(gap)}.`
    );
  }, [lifestyle, currentAge, retirementAge, corpusNeededFromInvestments, projectedCorpus, gap]);

  const insight = `**Retirement readiness:**\n\n• Expense needed at retirement (monthly): **${fmtShort(expenseAtRetire)}**\n• Corpus needed (net of pension): **${fmtShort(corpusNeededFromInvestments)}**\n• Projected corpus by retirement: **${fmtShort(projectedCorpus)}**\n• Gap: **${fmtShort(gap)}** over ${yearsToRetire} years\n\n**Action**: ${gap > 0 ? `Increase retirement investing by ~${fmtShort(addlSip)} per month or postpone retirement by 2-3 years.` : "Plan is broadly on track if assumptions hold."}`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Lifestyle Target">
          <SelectField
            value={lifestyle}
            onChange={setLifestyle}
            options={[
              { value: "basic", label: "Basic (frugal)" },
              { value: "comfortable", label: "Comfortable" },
              { value: "premium", label: "Premium / Travel-heavy" },
            ]}
          />
        </FieldRow>
        <div className="grid grid-cols-3 gap-3">
          <FieldRow label="Current Age"><NumField value={currentAge} onChange={setCurrentAge} min={18} max={59} step={1} suffix="yrs" /></FieldRow>
          <FieldRow label="Retirement Age"><NumField value={retirementAge} onChange={setRetirementAge} min={45} max={75} step={1} suffix="yrs" /></FieldRow>
          <FieldRow label="Life Expectancy"><NumField value={lifeExpectancy} onChange={setLifeExpectancy} min={70} max={100} step={1} suffix="yrs" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Monthly Expense Today"><NumField value={monthlyExpenseToday} onChange={setMonthlyExpenseToday} min={10000} max={1000000} step={1000} prefix="₹" /></FieldRow>
          <FieldRow label="Replacement Ratio"><NumField value={replacementPct} onChange={setReplacementPct} min={50} max={120} step={1} suffix="%" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Inflation (Pre-retirement)"><NumField value={inflationPre} onChange={setInflationPre} min={3} max={10} step={0.5} suffix="%" /></FieldRow>
          <FieldRow label="Inflation (Post-retirement)"><NumField value={inflationPost} onChange={setInflationPost} min={2} max={9} step={0.5} suffix="%" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Return (Accumulation)"><NumField value={returnPre} onChange={setReturnPre} min={6} max={16} step={0.5} suffix="%" /></FieldRow>
          <FieldRow label="Return (Retirement phase)"><NumField value={returnPost} onChange={setReturnPost} min={4} max={10} step={0.5} suffix="%" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Existing Retirement Corpus"><NumField value={existingCorpus} onChange={setExistingCorpus} min={0} max={500000000} step={10000} prefix="₹" /></FieldRow>
          <FieldRow label="Current Monthly Investment"><NumField value={monthlyInvest} onChange={setMonthlyInvest} min={500} max={500000} step={500} prefix="₹" /></FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Annual Step-up"><NumField value={stepUp} onChange={setStepUp} min={0} max={20} step={1} suffix="%" /></FieldRow>
          <FieldRow label="Expected Pension (today value)"><NumField value={expectedMonthlyPensionToday} onChange={setExpectedMonthlyPensionToday} min={0} max={300000} step={500} prefix="₹" /></FieldRow>
        </div>
      </div>
      <div>
        <div className="rounded-2xl p-5 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${MB}, ${DB})` }}>
          <p className="text-xs text-white/60 uppercase font-semibold">Retirement Summary</p>
          <p className="text-3xl font-extrabold mt-1 mb-3">{fmtShort(corpusNeededFromInvestments)}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Years to Retire</p><p className="text-sm font-bold">{yearsToRetire}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Expense at Retirement</p><p className="text-sm font-bold">{fmtShort(expenseAtRetire)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Projected Corpus</p><p className="text-sm font-bold">{fmtShort(projectedCorpus)}</p></div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}><p className="text-[10px] text-white/60">Gap</p><p className="text-sm font-bold">{fmtShort(gap)}</p></div>
          </div>
        </div>
        <InsightBanner text={insight} />
      </div>
    </div>
  );
};

const PLANNER_TABS = [
  { id: "goal", label: "Goal Builder", comp: GoalEngine },
  { id: "home", label: "Buy Home Plan", comp: HomeGoalPlanner },
  { id: "education", label: "Child Education Plan", comp: EducationGoalPlanner },
  { id: "retirement", label: "Retirement Plan", comp: RetirementGoalPlanner },
];

/* ═══════════════════════════════════════════════════════════
   MAIN DASHBOARD
═══════════════════════════════════════════════════════════ */

const CALC_TABS = [
  { id: "emi",       label: "Home / Car Loan",      icon: Home,       comp: EMICalc,          category: "Borrowing & Housing" },
  { id: "eligibility",label:"Home Loan Eligibility",icon: Home,       comp: HomeLoanEligibilityCalc, category: "Borrowing & Housing" },
  { id: "rentbuy",   label: "Rent vs Buy",          icon: Home,       comp: RentVsBuyCalc,    category: "Borrowing & Housing" },
  { id: "ccemi",     label: "Credit Card EMI",      icon: Calculator, comp: CreditCardEMICalc,category: "Borrowing & Housing" },
  { id: "sip",       label: "SIP & Mutual Funds",   icon: TrendingUp, comp: SIPCalc,          category: "Wealth & Investments" },
  { id: "monthlygoal",label:"Monthly Savings Goal", icon: Target,     comp: MonthlySavingsGoalCalc, category: "Wealth & Investments" },
  { id: "savings",   label: "FD / PPF / NPS / RD",  icon: Target,     comp: SavingsSchemeCalc,category: "Wealth & Investments" },
  { id: "ssy",       label: "Sukanya Samriddhi (SSY)", icon: Target,  comp: SSYCalc,          category: "Wealth & Investments" },
  { id: "emergency", label: "Emergency Fund",       icon: Shield,     comp: EmergencyFundCalc,category: "Protection & Essentials" },
  { id: "insurance", label: "Insurance Need",       icon: Shield,     comp: InsuranceNeedCalc,category: "Protection & Essentials" },
  { id: "hra",       label: "HRA Exemption",        icon: Shield,     comp: HRACalc,          category: "Tax & Compliance" },
  { id: "tax",       label: "Tax Savings",          icon: Shield,     comp: TaxCalc,          category: "Tax & Compliance" },
] as const;

const MAIN_TABS = [
  { id: "guru",    label: "ArthaGuru AI",   icon: Sparkles,   color: OG },
  { id: "calc",    label: "ArthaCalc",      icon: Calculator, color: DB },
  { id: "planner", label: "ArthaPlanner",   icon: Target,     color: GREEN },
];

const Dashboard = () => {
  const { user, signOut }         = useAuth();
  const [mainTab, setMainTab]     = useState("guru");
  const [calcTab, setCalcTab]     = useState("emi");
  const [plannerTab, setPlannerTab] = useState("goal");
  const [calcCtx, setCalcCtx]     = useState("");

  const activeCalc = CALC_TABS.find(t => t.id === calcTab)!;
  const activePlanner = PLANNER_TABS.find(t => t.id === plannerTab)!;
  const calcCategories = Array.from(new Set(CALC_TABS.map((t) => t.category)));

  return (
    <div className="min-h-screen bg-gray-50/80">
      <Navbar />

      <div className="pt-20">
        {/* Top bar */}
        <div className="border-b border-gray-200 bg-white">
          <div className="container mx-auto px-4 sm:px-6 max-w-7xl">
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-xl flex items-center justify-center text-white font-extrabold text-base shadow"
                  style={{ background: `linear-gradient(135deg, ${OG}, #c44d12)` }}>
                  {(user?.name?.[0] ?? user?.email?.[0] ?? "U").toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">
                    {user?.name?.split(" ")[0] ? `Welcome, ${user.name.split(" ")[0]}` : "ArthaAI Dashboard"}
                  </p>
                  <p className="text-xs text-gray-400 hidden sm:block">{user?.email ?? "Guest"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link to="/arthaai"
                  className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-gray-600"
                >
                  <BookOpen size={12} />About ArthaAI
                </Link>
                {user && (
                  <button onClick={signOut}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-gray-600"
                  >
                    <LogOut size={12} />Sign Out
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Hero brand strip */}
        <div style={{ background: `linear-gradient(135deg, ${DB} 0%, #0f2540 100%)` }}>
          <div className="container mx-auto px-4 sm:px-6 max-w-7xl py-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl font-extrabold text-white">Artha<span style={{ color: OG }}>AI</span></span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: "rgba(255,255,255,0.15)" }}>by Zyllo Tech</span>
                </div>
                <p className="text-white/60 text-xs">India's AI-powered personal finance platform · 22 languages · Zero commission · 100+ tools</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { n: "₹0", l: "Commission" },
                  { n: "22", l: "Languages" },
                  { n: "AI", l: "Powered" },
                  { n: "100+", l: "Formulas" },
                ].map(s => (
                  <div key={s.l} className="rounded-xl px-3 py-2 text-center min-w-[56px]" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                    <p className="text-sm font-extrabold text-white">{s.n}</p>
                    <p className="text-[10px] text-white/50">{s.l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Main tab navigation */}
        <div className="bg-white border-b border-gray-200 sticky top-16 z-10 shadow-sm">
          <div className="container mx-auto px-4 sm:px-6 max-w-7xl">
            <div className="flex gap-0">
              {MAIN_TABS.map(t => (
                <button key={t.id} onClick={() => setMainTab(t.id)}
                  className="flex items-center gap-2 px-5 py-4 text-sm font-semibold border-b-2 transition-all"
                  style={{
                    borderBottomColor: mainTab === t.id ? t.color : "transparent",
                    color: mainTab === t.id ? t.color : "#6b7280",
                  }}
                >
                  <t.icon size={15} />
                  <span className="hidden sm:inline">{t.label}</span>
                  <span className="sm:hidden">{t.id === "guru" ? "AI Chat" : t.id === "calc" ? "Calculate" : "Plan"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-4 sm:px-6 max-w-7xl py-6 pb-16">

          {/* ARTHAGURU TAB */}
          {mainTab === "guru" && (
            <div className="max-w-3xl mx-auto">
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 sm:p-7">
                <ArthaGuruChat calcContext={calcCtx} />
              </div>
              {/* Feature cards below chat */}
              <div className="grid grid-cols-3 gap-3 mt-4">
                {[
                  { icon: "🇮🇳", title: "22 Indian Languages", desc: "Hindi, Telugu, Bengali, Tamil + 18 more" },
                  { icon: "⚡", title: "Instant Answers", desc: "AI responds in seconds, not days" },
                  { icon: "🔒", title: "Zero Bias", desc: "No commission, no product push, ever" },
                ].map(c => (
                  <div key={c.title} className="rounded-2xl bg-white border border-gray-100 p-4 text-center shadow-sm">
                    <span className="text-2xl block mb-2">{c.icon}</span>
                    <p className="text-xs font-bold text-gray-800 mb-1">{c.title}</p>
                    <p className="text-[11px] text-gray-400 leading-snug">{c.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ARTHACALC TAB */}
          {mainTab === "calc" && (
            <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-5">
              <aside className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4 h-fit lg:sticky lg:top-24">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Calculator Library</p>
                <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                  {calcCategories.map((cat) => (
                    <div key={cat}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 px-2">{cat}</p>
                      <div className="space-y-1.5">
                        {CALC_TABS.filter((t) => t.category === cat).map((t) => (
                          <button
                            key={t.id}
                            onClick={() => setCalcTab(t.id)}
                            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border transition-all text-left"
                            style={{
                              borderColor: calcTab === t.id ? OG : "#e5e7eb",
                              background: calcTab === t.id ? OG_PALE : "#fff",
                              color: calcTab === t.id ? OG : "#6b7280",
                            }}
                          >
                            <t.icon size={14} />
                            <span>{t.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </aside>

              <div>
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 sm:p-8">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">{activeCalc.label}</h2>
                      <p className="text-sm text-gray-400">AI-powered insights after every calculation</p>
                    </div>
                    <button onClick={() => setMainTab("guru")}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition-colors text-white"
                      style={{ background: `linear-gradient(135deg, ${OG}, #c44d12)` }}
                    >
                      <Sparkles size={12} />Ask ArthaGuru
                    </button>
                  </div>
                  <activeCalc.comp onContextUpdate={setCalcCtx} />
                </div>

                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
                  <AlertCircle size={13} className="shrink-0" />
                  <span>Calculations are for planning purposes only. Consult a SEBI-registered advisor before investing.</span>
                  <button onClick={() => setMainTab("guru")} className="ml-auto flex items-center gap-1 font-semibold shrink-0 hover:underline">
                    Ask ArthaGuru <ArrowRight size={11} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ARTHAPLANNER TAB */}
          {mainTab === "planner" && (
            <div>
              <div className="flex flex-wrap gap-2 mb-6">
                {PLANNER_TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setPlannerTab(t.id)}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all"
                    style={{
                      borderColor: plannerTab === t.id ? GREEN : "#e5e7eb",
                      background: plannerTab === t.id ? "#ecfdf5" : "#fff",
                      color: plannerTab === t.id ? GREEN : "#6b7280",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">ArthaPlanner — {activePlanner.label}</h2>
                    <p className="text-sm text-gray-400">Detailed planner questionnaire with realistic assumptions</p>
                  </div>
                  <button onClick={() => setMainTab("guru")}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl text-white"
                    style={{ background: `linear-gradient(135deg, ${OG}, #c44d12)` }}
                  >
                    <Sparkles size={12} />Ask ArthaGuru
                  </button>
                </div>
                <activePlanner.comp onContextUpdate={setCalcCtx} />
              </div>

              {/* Life stage guide */}
              <div className="mt-6 grid sm:grid-cols-4 gap-3">
                {[
                  { age: "20s", icon: "🚀", title: "Build Foundation", tips: ["Start SIP early", "Get term insurance", "Build emergency fund"] },
                  { age: "30s", icon: "🏗️", title: "Grow Aggressively", tips: ["Buy home (if needed)", "Increase SIP by 10%/yr", "Start NPS for tax"] },
                  { age: "40s", icon: "⚖️", title: "Protect & Optimize", tips: ["Reduce equity to 60%", "Pay off debts", "Review insurance covers"] },
                  { age: "50s+", icon: "🌴", title: "Secure & Harvest", tips: ["Shift to debt funds", "Plan withdrawals", "Transfer wealth plan"] },
                ].map(s => (
                  <div key={s.age} className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xl">{s.icon}</span>
                      <div>
                        <p className="text-xs font-bold text-gray-400">Age</p>
                        <p className="font-extrabold text-gray-900">{s.age}</p>
                      </div>
                    </div>
                    <p className="text-sm font-bold mb-2" style={{ color: DB }}>{s.title}</p>
                    <ul className="space-y-1">
                      {s.tips.map(tip => (
                        <li key={tip} className="flex items-start gap-1.5 text-xs text-gray-500">
                          <span className="size-1.5 rounded-full shrink-0 mt-1.5" style={{ background: OG }} />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default Dashboard;

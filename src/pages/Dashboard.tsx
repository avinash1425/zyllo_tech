import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Send, Sparkles, Calculator, LogOut,
  TrendingUp, Shield, Home, Target,
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
  const max = Math.max(...data.map(d => d.value));
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

/* ═══════════════════════════════════════════════════════════
   SHARED INPUT COMPONENTS
═══════════════════════════════════════════════════════════ */

const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
    {children}
  </div>
);

const NumField = ({ value, onChange, min = 0, max, step = 1, prefix, suffix }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; prefix?: string; suffix?: string;
}) => (
  <div className="relative">
    {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none select-none">{prefix}</span>}
    <input type="number" value={value} min={min} max={max} step={step}
      onChange={e => onChange(Number(e.target.value) || 0)}
      className="w-full rounded-xl border-2 border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-800 focus:outline-none focus:border-orange-300 transition-colors"
      style={{ paddingLeft: prefix ? "1.8rem" : "0.75rem", paddingRight: suffix ? "2.5rem" : "0.75rem" }}
    />
    {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none select-none">{suffix}</span>}
  </div>
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
  const [principal, setP] = useState(2500000);
  const [rate, setR]      = useState(8.75);
  const [tenure, setT]    = useState(20);

  const r  = rate / 12 / 100;
  const n  = tenure * 12;
  const emi = r === 0 ? principal / n : principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  const total   = emi * n;
  const interest = total - principal;
  const pPct    = Math.round(principal / total * 100);

  useEffect(() => {
    onContextUpdate(`EMI Calculator: Loan ₹${fmtShort(principal)}, Rate ${rate}%, Tenure ${tenure}yr. EMI=${fmtShort(emi)}, Total interest=${fmtShort(interest)}`);
  }, [principal, rate, tenure]);

  const insight = `**Your home loan reality check:**\n\n• You'll pay **${fmtShort(interest)} in interest** — ${(interest/principal*100).toFixed(0)}% extra over the loan amount\n• Reducing tenure from ${tenure} to ${Math.max(10, tenure-5)} years saves **${fmtShort(interest - (principal * r * Math.pow(1+r,(tenure-5)*12) / (Math.pow(1+r,(tenure-5)*12)-1) * (tenure-5)*12 - principal))} in interest**\n• Keep EMI ≤ 40% of take-home salary. Your current EMI is ${fmtShort(emi)}/month\n\n**Smart move**: Pay one extra EMI per year — saves 3–4 years of loan tenure.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Loan Amount">
          <NumField value={principal} onChange={setP} min={100000} max={100000000} step={100000} prefix="₹" />
          <RangeSlider value={principal} onChange={setP} min={500000} max={20000000} step={100000} />
          <p className="text-xs text-right text-gray-400 font-medium mt-0.5">{fmtShort(principal)}</p>
        </FieldRow>
        <FieldRow label="Annual Interest Rate">
          <NumField value={rate} onChange={setR} min={4} max={20} step={0.25} suffix="%" />
          <RangeSlider value={rate} onChange={setR} min={6} max={18} step={0.25} />
        </FieldRow>
        <FieldRow label="Loan Tenure">
          <NumField value={tenure} onChange={setT} min={1} max={30} step={1} suffix="yrs" />
          <RangeSlider value={tenure} onChange={setT} min={1} max={30} step={1} />
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
  const [monthly, setM]  = useState(5000);
  const [rate, setR]     = useState(12);
  const [years, setY]    = useState(15);
  const [lump, setL]     = useState(0);

  const n   = years * 12;
  const r   = rate / 12 / 100;
  const sipFV   = r === 0 ? monthly * n : monthly * (Math.pow(1+r,n)-1) / r * (1+r);
  const lumpFV  = lump * Math.pow(1+rate/100, years);
  const total   = sipFV + lumpFV;
  const invested= monthly * n + lump;
  const gains   = total - invested;
  const multiplier = (total / invested).toFixed(1);

  useEffect(() => {
    onContextUpdate(`SIP Calculator: ₹${fmtShort(monthly)}/mo + ₹${fmtShort(lump)} lumpsum, ${rate}% return, ${years}yr. Corpus=${fmtShort(total)}, Gains=${fmtShort(gains)}`);
  }, [monthly, rate, years, lump]);

  const insight = `**${multiplier}× wealth multiplier in ${years} years:**\n\n• Invested **${fmtShort(invested)}** → grew to **${fmtShort(total)}**\n• Wealth gain of **${fmtShort(gains)}** — that's the power of compounding\n• If you increase SIP by just ₹500/year, final corpus grows by ~${fmtShort(gains * 0.12)} more\n\n**Benchmark**: Nifty 50 has delivered ~13.5% CAGR over 20 years. Your ${rate}% assumption is ${rate <= 12 ? "conservative — actual returns may be higher" : "aggressive — consider 11–12% for planning"}.`;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <FieldRow label="Monthly SIP">
          <NumField value={monthly} onChange={setM} min={500} max={500000} step={500} prefix="₹" />
          <RangeSlider value={monthly} onChange={setM} min={500} max={100000} step={500} />
          <p className="text-xs text-right text-gray-400 mt-0.5">{fmtShort(monthly)}/month</p>
        </FieldRow>
        <FieldRow label="One-time Lumpsum (optional)">
          <NumField value={lump} onChange={setL} min={0} max={10000000} step={10000} prefix="₹" />
        </FieldRow>
        <FieldRow label="Expected Annual Return">
          <NumField value={rate} onChange={setR} min={6} max={25} step={0.5} suffix="%" />
          <RangeSlider value={rate} onChange={setR} min={6} max={20} step={0.5} />
        </FieldRow>
        <FieldRow label="Investment Duration">
          <NumField value={years} onChange={setY} min={1} max={40} step={1} suffix="yrs" />
          <RangeSlider value={years} onChange={setY} min={1} max={40} step={1} />
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

/* ═══════════════════════════════════════════════════════════
   MAIN DASHBOARD
═══════════════════════════════════════════════════════════ */

const CALC_TABS = [
  { id: "emi",  label: "Home / Car Loan",   icon: Home,       comp: EMICalc  },
  { id: "sip",  label: "SIP & Mutual Funds",icon: TrendingUp, comp: SIPCalc  },
  { id: "tax",  label: "Tax Savings",       icon: Shield,     comp: TaxCalc  },
];

const MAIN_TABS = [
  { id: "guru",    label: "ArthaGuru AI",   icon: Sparkles,   color: OG },
  { id: "calc",    label: "ArthaCalc",      icon: Calculator, color: DB },
  { id: "planner", label: "ArthaPlanner",   icon: Target,     color: GREEN },
];

const Dashboard = () => {
  const { user, signOut }         = useAuth();
  const [mainTab, setMainTab]     = useState("guru");
  const [calcTab, setCalcTab]     = useState("emi");
  const [calcCtx, setCalcCtx]     = useState("");

  const activeCalc = CALC_TABS.find(t => t.id === calcTab)!;

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
            <div>
              {/* Calculator sub-tabs */}
              <div className="flex flex-wrap gap-2 mb-6">
                {CALC_TABS.map(t => (
                  <button key={t.id} onClick={() => setCalcTab(t.id)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all"
                    style={{
                      borderColor: calcTab === t.id ? OG : "#e5e7eb",
                      background: calcTab === t.id ? OG_PALE : "#fff",
                      color: calcTab === t.id ? OG : "#6b7280",
                    }}
                  >
                    <t.icon size={14} />{t.label}
                  </button>
                ))}
              </div>

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
          )}

          {/* ARTHAPLANNER TAB */}
          {mainTab === "planner" && (
            <div>
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">ArthaPlanner — Financial Life Goals</h2>
                    <p className="text-sm text-gray-400">Goal-based planning from your 20s to retirement</p>
                  </div>
                  <button onClick={() => setMainTab("guru")}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl text-white"
                    style={{ background: `linear-gradient(135deg, ${OG}, #c44d12)` }}
                  >
                    <Sparkles size={12} />Ask ArthaGuru
                  </button>
                </div>
                <GoalEngine onContextUpdate={setCalcCtx} />
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

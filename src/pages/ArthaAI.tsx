import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

/* ── Brand tokens ─────────────────────────────────────────── */
const OG  = "#E05C1A";
const DB  = "#1A3A5C";
const MB  = "#2E86AB";
const OG_PALE = "#FFF4ED";
const OG_LIGHT = "#FDDECA";
const GREEN = "#059669";
const GREEN_LIGHT = "#D1FAE5";

const fade = { hidden: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0, transition: { duration: 0.55 } } };
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };

/* ── Re-usable small bits ─────────────────────────────────── */
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: OG }}>{children}</p>
);

const Check = ({ color = OG }: { color?: string }) => (
  <span className="mr-2 font-bold" style={{ color }}>✓</span>
);
const Cross = () => (
  <span className="mr-2 font-bold text-gray-300">✗</span>
);

/* ── Page ─────────────────────────────────────────────────── */
const ArthaAI = () => (
  <div className="min-h-screen bg-background">
    <SEOHead
      title="ArthaAI — Smart Money Guidance for Every Indian | Zyllo Tech"
      description="India's first AI-powered personal finance platform — multilingual, unbiased, and built for Bharat. ArthaAI by Zyllo Tech."
      canonical="/arthaai"
      structuredData={breadcrumbSchema([
        { name: "Home", url: SITE_URL },
        { name: "ArthaAI", url: `${SITE_URL}/arthaai` },
      ])}
    />
    <Navbar />

    {/* ── HERO ──────────────────────────────────────────────── */}
    <section
      className="pt-28 pb-20 px-4"
      style={{ background: `linear-gradient(135deg, ${DB} 0%, #0f2540 100%)` }}
    >
      <div className="container mx-auto max-w-6xl">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div initial="hidden" animate="show" variants={stagger}>
            <motion.div variants={fade}>
              <span
                className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold mb-6"
                style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
              >
                🇮🇳 &nbsp;Proudly Made in India &nbsp;·&nbsp; DPIIT Startup India
              </span>
            </motion.div>
            <motion.h1 variants={fade} className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-5">
              Smart Money Guidance<br />
              <em style={{ fontStyle: "normal", color: OG }}>for Every Indian</em>
            </motion.h1>
            <motion.p variants={fade} className="text-white/70 text-lg leading-relaxed mb-8">
              India's first AI-powered personal finance platform — multilingual, unbiased, and built for Bharat. No jargon. No commission bias. No English required.
            </motion.p>
            <motion.div variants={fade} className="flex flex-wrap gap-3 mb-8">
              <a
                href="mailto:info@zyllotech.com"
                className="rounded-lg px-7 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90"
                style={{ background: OG }}
              >
                Get Started Free →
              </a>
              <a
                href="#how-it-works"
                className="rounded-lg px-7 py-3 text-sm font-bold transition-colors"
                style={{ background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)" }}
              >
                See How It Works
              </a>
            </motion.div>
            <motion.div variants={fade} className="flex flex-wrap gap-4 text-xs text-white/60">
              {["Free to Start", "22 Indian Languages", "DPDP Act 2023 Compliant", "Zero Commission Bias"].map(t => (
                <span key={t} className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full inline-block" style={{ background: OG }} />
                  {t}
                </span>
              ))}
            </motion.div>
          </motion.div>

          {/* Phone mock */}
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.6 }}
            className="hidden lg:flex justify-center"
          >
            <div
              className="rounded-3xl p-6 w-72 shadow-2xl"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(10px)" }}
            >
              <div className="flex justify-between items-center mb-5">
                <span className="font-extrabold text-white text-lg">Artha<span style={{ color: OG }}>AI</span></span>
                <span className="rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: OG }}>తెలుగు ▾</span>
              </div>
              <div className="rounded-xl p-4 mb-3" style={{ background: OG }}>
                <p className="text-white/80 text-xs mb-1">Your Monthly SIP Projection</p>
                <p className="text-white text-2xl font-extrabold mb-1">₹14,86,423</p>
                <p className="text-white/70 text-xs">In 10 years · ₹5,000/month · 12% CAGR</p>
                <div className="mt-2 h-1.5 rounded-full bg-white/20"><div className="h-full rounded-full bg-white/80 w-[72%]" /></div>
              </div>
              <div className="rounded-xl p-4 mb-3" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <p className="text-white/70 text-xs mb-1">Tax Savings This Year</p>
                <p className="text-white text-xl font-extrabold">₹46,800</p>
                <p className="text-white/50 text-xs">via 80C + 80D + NPS deductions</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[{ icon: "🧮", label: "ArthaCalc" }, { icon: "📊", label: "Planner" }, { icon: "🎓", label: "ArthaGuru" }].map(m => (
                  <div key={m.label} className="rounded-xl p-2 text-center" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <div className="text-lg mb-0.5">{m.icon}</div>
                    <p className="text-white/70 text-[10px]">{m.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Stats bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.5 }}
          className="mt-16 grid grid-cols-2 md:grid-cols-5 gap-6 rounded-2xl p-6"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {[
            { value: "400M+", label: "Underserved Indian Investors" },
            { value: "22", label: "Indian Languages at Launch" },
            { value: "100+", label: "Financial Formulas" },
            { value: "28%", label: "CAGR Digital Finance Growth" },
            { value: "₹0", label: "Commission or Hidden Charges" },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-extrabold mb-1" style={{ color: OG }}>{s.value}</div>
              <div className="text-white/50 text-xs leading-snug">{s.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>

    {/* ── PROBLEM ───────────────────────────────────────────── */}
    <section className="py-20 px-4 bg-gray-50">
      <div className="container mx-auto max-w-6xl">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="text-center mb-12">
          <motion.div variants={fade}><Eyebrow>The Problem We Solve</Eyebrow></motion.div>
          <motion.h2 variants={fade} className="text-3xl md:text-4xl font-bold mb-3" style={{ color: DB }}>
            India's 400 Million Middle Class is Financially Abandoned
          </motion.h2>
          <motion.p variants={fade} className="text-gray-500 max-w-xl mx-auto">The financial system was never built for them — and they know it.</motion.p>
        </motion.div>
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger}
          className="grid md:grid-cols-3 gap-6"
        >
          {[
            { num: "01", icon: "🎯", title: "No Accessible Advisor", body: "India has only 1,300 SEBI-registered advisors for 1.4 billion people. Quality advice costs ₹10,000–₹50,000/year — out of reach for 95% of households.", badge: "1 advisor per 10.7 lakh people" },
            { num: "02", icon: "⚠️", title: "Biased, Commission-Driven Advice", body: "80%+ of financial advice comes from agents who earn commissions — ULIPs, endowment policies, high-fee funds. The average Indian loses ₹2.3 lakh in suboptimal choices over a lifetime.", badge: "₹2.3 Lakh lost per household" },
            { num: "03", icon: "🗣️", title: "Language & Literacy Barrier", body: "Only 11% of Indians are comfortable in English. All financial apps, calculators, and products are built exclusively in English. 700+ million people are locked out.", badge: "700M+ financially excluded" },
          ].map(c => (
            <motion.div key={c.num} variants={fade}
              className="bg-white rounded-2xl p-7 shadow-md hover:shadow-lg transition-shadow"
              style={{ borderLeft: `4px solid ${OG}` }}
            >
              <div className="text-5xl font-extrabold opacity-10 mb-1 leading-none" style={{ color: OG }}>{c.num}</div>
              <div className="text-3xl mb-3">{c.icon}</div>
              <h4 className="font-bold mb-2" style={{ color: DB }}>{c.title}</h4>
              <p className="text-gray-500 text-sm leading-relaxed mb-3">{c.body}</p>
              <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold" style={{ background: OG_PALE, color: OG }}>{c.badge}</span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>

    {/* ── THREE MODULES ─────────────────────────────────────── */}
    <section className="py-20 px-4" id="modules">
      <div className="container mx-auto max-w-6xl">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="text-center mb-12">
          <motion.div variants={fade}><Eyebrow>Three Core Modules</Eyebrow></motion.div>
          <motion.h2 variants={fade} className="text-3xl md:text-4xl font-bold mb-3" style={{ color: DB }}>Everything You Need for Financial Clarity</motion.h2>
          <motion.p variants={fade} className="text-gray-500 max-w-xl mx-auto">Every feature designed around the real pain points of Indian households — from calculators to AI-powered guidance.</motion.p>
        </motion.div>
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="grid md:grid-cols-3 gap-6">
          {[
            {
              num: "01", badge: "ArthaCalc", color: OG,
              bg: "linear-gradient(135deg,#fff9f5,#fff4ec)", border: "#f5d8c8",
              title: "Smart Calculator Suite",
              desc: "Instant, accurate financial projections for every life decision.",
              items: ["EMI Calculator (Home, Car, Personal, Education)", "SIP & Lumpsum with inflation-adjusted returns", "Tax Savings — 80C, 80D, HRA, NPS, ELSS", "FD / RD / PPF / NPS / EPF Maturity", "Insurance Premium vs Coverage Analyser", "Rent vs. Buy Decision Engine"],
            },
            {
              num: "02", badge: "ArthaPlanner", color: DB,
              bg: "linear-gradient(135deg,#f0f6fc,#e8f4fb)", border: "#c8dff0",
              title: "Financial Life Planner",
              desc: "Personalised life-stage planning — from your 20s to retirement.",
              items: ["Goal-based planning — education, home, marriage, retirement", "Monthly budget builder with expense categorisation", "Debt repayment — avalanche vs. snowball method", "Emergency fund calculator with target-setting", "Life-stage milestones (20s, 30s, 40s, 50s+)", "Net Worth tracker updated monthly"],
            },
            {
              num: "03", badge: "ArthaGuru", color: GREEN,
              bg: "linear-gradient(135deg,#f0faf5,#e8f7ef)", border: "#c0e8d0",
              title: "Investment Education Engine",
              desc: "Unbiased financial education in your language.",
              items: ["Mutual Fund explainer (large cap, ELSS, debt, hybrid)", "Risk profiling with portfolio suggestions", "Unbiased comparison — ULIP vs. Term+MF", "Stock market basics & long-term investing", "Gold, Real Estate, PPF, NPS — when & why", "AI-powered 'What should I do next?' guide"],
            },
          ].map(m => (
            <motion.div key={m.num} variants={fade}
              className="rounded-2xl p-8 relative overflow-hidden hover:-translate-y-1 transition-transform duration-300"
              style={{ background: m.bg, border: `2px solid ${m.border}` }}
            >
              <div className="absolute right-6 top-4 text-8xl font-extrabold opacity-5 leading-none select-none" style={{ color: DB }}>{m.num}</div>
              <span className="inline-block rounded-full px-3 py-1 text-xs font-bold mb-4" style={{ background: m.color, color: "#fff" }}>{m.badge}</span>
              <h3 className="text-xl font-bold mb-2" style={{ color: m.color }}>{m.title}</h3>
              <p className="text-gray-500 text-sm mb-4">{m.desc}</p>
              <ul className="space-y-2 mb-5">
                {m.items.map(item => (
                  <li key={item} className="flex items-start text-sm text-gray-600">
                    <Check color={m.color} />{item}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>

    {/* ── HOW IT WORKS ──────────────────────────────────────── */}
    <section className="py-20 px-4 bg-gray-50" id="how-it-works">
      <div className="container mx-auto max-w-3xl">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="text-center mb-12">
          <motion.div variants={fade}><Eyebrow>How It Works</Eyebrow></motion.div>
          <motion.h2 variants={fade} className="text-3xl md:text-4xl font-bold mb-3" style={{ color: DB }}>From Download to Financial Clarity in 60 Seconds</motion.h2>
          <motion.p variants={fade} className="text-gray-500">No paperwork. No English required. No waiting.</motion.p>
        </motion.div>
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="space-y-4">
          {[
            { step: "1", title: "Download & Onboard", desc: "Select your preferred language from 22 options. Answer 5 quick profile questions. Live in 60 seconds — no paperwork." },
            { step: "2", title: "Set Your Goals", desc: "Input monthly income, expenses, and financial goals — buying a home, child's education, retirement. Smart defaults by income & life stage." },
            { step: "3", title: "AI Analyses Your Profile", desc: "ArthaAI engine processes your goals, income level, risk appetite, and life stage to build a personalised financial snapshot — in under 30 seconds." },
            { step: "4", title: "Get Guidance", desc: "Step-by-step recommendations: which SIP to start, how much to save, what insurance is missing, how to save tax. Plain language — zero financial jargon." },
            { step: "5", title: "Learn & Grow", desc: "Ongoing financial education in your local language. Quarterly goal reviews. Smart nudges. The AI gets smarter as your data grows." },
          ].map(s => (
            <motion.div key={s.step} variants={fade}
              className="flex gap-4 items-start bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:border-orange-200 hover:shadow-md transition-all"
            >
              <div className="shrink-0 size-10 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ background: OG }}>{s.step}</div>
              <div>
                <h4 className="font-semibold mb-1" style={{ color: DB }}>{s.title}</h4>
                <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>

    {/* ── LANGUAGES ─────────────────────────────────────────── */}
    <section className="py-20 px-4">
      <div className="container mx-auto max-w-6xl">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="text-center mb-10">
          <motion.div variants={fade}><Eyebrow>Language Is Our Moat</Eyebrow></motion.div>
          <motion.h2 variants={fade} className="text-3xl md:text-4xl font-bold mb-3" style={{ color: DB }}>ArthaAI Speaks Your Language</motion.h2>
          <motion.p variants={fade} className="text-gray-500 max-w-xl mx-auto">22 scheduled Indian languages — voice + text. No competitor offers genuine multilingual financial guidance.</motion.p>
        </motion.div>
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger}
          className="flex flex-wrap justify-center gap-3"
        >
          {[
            { script: "हिन्दी", name: "Hindi", speakers: "500M", featured: true },
            { script: "తెలుగు", name: "Telugu", speakers: "90M", featured: true },
            { script: "বাংলা", name: "Bengali", speakers: "100M" },
            { script: "मराठी", name: "Marathi", speakers: "85M" },
            { script: "தமிழ்", name: "Tamil", speakers: "78M" },
            { script: "اردو", name: "Urdu", speakers: "60M" },
            { script: "ಕನ್ನಡ", name: "Kannada", speakers: "55M" },
            { script: "ਪੰਜਾਬੀ", name: "Punjabi", speakers: "50M" },
            { script: "ગુજરાતી", name: "Gujarati", speakers: "58M" },
            { script: "ଓଡ଼ିଆ", name: "Odia", speakers: "40M" },
            { script: "English", name: "English", speakers: "130M" },
            { script: "+11", name: "More", speakers: "Regional", dim: true },
          ].map(l => (
            <motion.div key={l.name} variants={fade}
              className="rounded-xl px-4 py-3 text-center min-w-[90px]"
              style={{
                background: l.featured ? OG_PALE : "#f8f9fa",
                border: `2px solid ${l.featured ? OG_LIGHT : "#e5e7eb"}`,
                opacity: l.dim ? 0.6 : 1,
                borderStyle: l.dim ? "dashed" : "solid",
              }}
            >
              <div className="text-lg font-bold mb-0.5" style={{ color: DB }}>{l.script}</div>
              <div className="text-xs font-semibold" style={{ color: l.featured ? OG : "#374151" }}>{l.name}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{l.speakers}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>

    {/* ── COMPARISON TABLE ──────────────────────────────────── */}
    <section className="py-20 px-4 bg-gray-50">
      <div className="container mx-auto max-w-5xl">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="text-center mb-10">
          <motion.div variants={fade}><Eyebrow>Competitive Edge</Eyebrow></motion.div>
          <motion.h2 variants={fade} className="text-3xl md:text-4xl font-bold mb-3" style={{ color: DB }}>No Competitor Matches ArthaAI</motion.h2>
          <motion.p variants={fade} className="text-gray-500 max-w-xl mx-auto">We combine AI guidance + calculators + multilingual support + unbiased analysis in one platform.</motion.p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="rounded-2xl overflow-hidden shadow-lg"
        >
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="p-4 text-left text-white text-xs uppercase tracking-wider" style={{ background: DB }}>Feature</th>
                <th className="p-4 text-left text-white text-xs uppercase tracking-wider" style={{ background: OG }}>ArthaAI ✦</th>
                {["ET Money", "Groww", "BankBazaar"].map(c => (
                  <th key={c} className="p-4 text-left text-white text-xs uppercase tracking-wider" style={{ background: DB }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["AI Financial Guidance (Personalised)", true, false, false, false],
                ["Multilingual (22 Indian Languages)", true, false, false, false],
                ["Voice Input in Vernacular", true, false, false, false],
                ["Unbiased (Zero Commission Products)", true, "partial", false, false],
                ["Calculator Suite (100+ Formulas)", true, "partial", "partial", "partial"],
                ["WhatsApp Accessible", true, false, false, false],
                ["B2B Employer Module", true, false, false, false],
                ["DPDP Compliant + Explainable AI", true, "partial", "partial", "partial"],
              ].map(([feature, ...vals], i) => (
                <tr key={String(feature)} className={i % 2 === 1 ? "bg-gray-50" : "bg-white"}>
                  <td className="px-4 py-3 text-gray-700">{feature}</td>
                  {vals.map((v, vi) => (
                    <td key={vi} className={`px-4 py-3 font-bold ${vi === 0 ? "" : ""}`}
                      style={vi === 0 ? { background: "#fff9f6" } : {}}
                    >
                      {v === true ? <span style={{ color: GREEN }}>✓</span>
                        : v === "partial" ? <span className="text-xs font-semibold text-yellow-600">Partial</span>
                        : <span className="text-gray-200">✗</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>

    {/* ── PRICING ───────────────────────────────────────────── */}
    <section className="py-20 px-4" id="pricing">
      <div className="container mx-auto max-w-5xl">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="text-center mb-12">
          <motion.div variants={fade}><Eyebrow>Pricing</Eyebrow></motion.div>
          <motion.h2 variants={fade} className="text-3xl md:text-4xl font-bold mb-3" style={{ color: DB }}>Free to Start. Powerful to Grow.</motion.h2>
          <motion.p variants={fade} className="text-gray-500">Every Indian deserves access to financial guidance — that's why our core is always free.</motion.p>
        </motion.div>
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger}
          className="grid md:grid-cols-3 gap-6 items-start"
        >
          {/* Basic */}
          <motion.div variants={fade} className="rounded-2xl border border-gray-200 bg-white p-7">
            <span className="rounded-full px-3 py-1 text-xs font-bold text-white mb-3 inline-block" style={{ background: DB }}>Free Forever</span>
            <h3 className="text-xl font-bold mb-1" style={{ color: DB }}>Basic</h3>
            <div className="text-4xl font-extrabold mb-0.5" style={{ color: DB }}>₹<span>0</span><span className="text-base font-normal text-gray-400">/month</span></div>
            <p className="text-xs text-gray-400 mb-5">No credit card needed</p>
            <ul className="space-y-2 mb-6 text-sm">
              {["All 6 financial calculators", "Basic financial plan", "Hindi + 4 regional languages", "Educational articles"].map(f => <li key={f}><Check color={DB} />{f}</li>)}
              {["AI advisor chat", "Full 22 languages", "Advanced investment report"].map(f => <li key={f} className="text-gray-400"><Cross />{f}</li>)}
            </ul>
            <a href="mailto:info@zyllotech.com" className="block text-center rounded-lg py-2.5 text-sm font-bold border border-gray-300 hover:bg-gray-50 transition-colors" style={{ color: DB }}>Get Started Free</a>
          </motion.div>

          {/* Pro */}
          <motion.div variants={fade}
            className="rounded-2xl p-7 relative shadow-xl scale-[1.03]"
            style={{ background: `linear-gradient(135deg, ${DB}, #0f2540)`, border: `2px solid ${OG}` }}
          >
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-xs font-bold text-white" style={{ background: OG }}>Most Popular</div>
            <span className="rounded-full px-3 py-1 text-xs font-bold mb-3 inline-block" style={{ background: OG, color: "#fff" }}>Premium</span>
            <h3 className="text-xl font-bold text-white mb-1">Pro</h3>
            <div className="text-4xl font-extrabold text-white mb-0.5">₹99<span className="text-base font-normal text-white/50">/month</span></div>
            <p className="text-xs text-white/50 mb-5">₹999/year — Save 2 months</p>
            <ul className="space-y-2 mb-6 text-sm text-white/80">
              {["Everything in Free", "Full 22 Indian languages", "AI advisor chat (ArthaGuru)", "Advanced life planner", "Personalised investment report", "WhatsApp integration", "Priority support"].map(f => <li key={f}><Check color={OG} />{f}</li>)}
            </ul>
            <a href="mailto:info@zyllotech.com" className="block text-center rounded-lg py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90" style={{ background: OG }}>Start 14-Day Free Trial</a>
          </motion.div>

          {/* Enterprise */}
          <motion.div variants={fade} className="rounded-2xl border border-gray-200 bg-white p-7">
            <span className="rounded-full px-3 py-1 text-xs font-bold text-white mb-3 inline-block" style={{ background: MB }}>Enterprise</span>
            <h3 className="text-xl font-bold mb-1" style={{ color: DB }}>B2B / B2G</h3>
            <div className="text-3xl font-extrabold mb-0.5" style={{ color: DB }}>Custom</div>
            <p className="text-xs text-gray-400 mb-5">For employers, banks &amp; NBFCs</p>
            <ul className="space-y-2 mb-6 text-sm">
              {["Employee financial wellness module", "Group dashboard & analytics", "Payroll-linked budgeting tool", "White-label option for banks", "API access for NBFC partners", "Dedicated account manager", "Custom language pack"].map(f => <li key={f}><Check color={MB} />{f}</li>)}
            </ul>
            <a href="mailto:info@zyllotech.com" className="block text-center rounded-lg py-2.5 text-sm font-bold border border-gray-300 hover:bg-gray-50 transition-colors" style={{ color: DB }}>Contact Sales</a>
          </motion.div>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          className="mt-8 rounded-xl border border-blue-100 bg-blue-50 p-4 flex gap-3 text-sm text-blue-700"
        >
          <span>ℹ️</span>
          <span><strong>Free Tier Commitment:</strong> ArthaAI's free tier will remain permanently available for retail investors with portfolio &lt; ₹5 lakh. Our mission is to democratise financial guidance for every Indian.</span>
        </motion.div>
      </div>
    </section>

    {/* ── CTA ───────────────────────────────────────────────── */}
    <section className="py-20 px-4" style={{ background: `linear-gradient(135deg, ${DB}, #0f2540)` }}>
      <div className="container mx-auto max-w-3xl text-center">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger}>
          <motion.div variants={fade}>
            <span className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold mb-6"
              style={{ background: "rgba(255,255,255,0.1)", color: "#fff", border: `1px solid ${OG}` }}
            >
              🚀 &nbsp; Now in Development — MVP Launching June 2026
            </span>
          </motion.div>
          <motion.h2 variants={fade} className="text-3xl md:text-4xl font-bold text-white mb-4">
            Empowering Every Indian to Achieve Their <em style={{ fontStyle: "normal", color: OG }}>Artha</em>
          </motion.h2>
          <motion.p variants={fade} className="text-white/70 mb-8 max-w-md mx-auto italic">
            "Artha is the foundation of all human endeavour. Without Artha, Dharma and Kama cannot be attained." — Chanakya, Arthashastra (~321 BCE)
          </motion.p>
          <motion.div variants={fade} className="flex flex-wrap gap-4 justify-center">
            <a href="mailto:info@zyllotech.com" className="rounded-lg px-8 py-3.5 text-sm font-bold text-white transition-opacity hover:opacity-90" style={{ background: OG }}>
              Contact the Team
            </a>
            <Link to="/startups" className="rounded-lg px-8 py-3.5 text-sm font-bold transition-colors"
              style={{ background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)" }}
            >
              Learn More →
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </section>

    <Footer />
    <FloatingButtons />
  </div>
);

export default ArthaAI;

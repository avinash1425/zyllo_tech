# ArthaAI — Smart Money Guidance for Every Indian

> **By Zyllo Tech Software Solutions Pvt Ltd**
> CIN: U62013AP2026PTC124120 | Hyderabad, India | info@zyllotech.com

---

## 🚀 Overview

ArthaAI is India's first multilingual AI-powered financial education and planning platform — designed to democratize financial literacy across 400M+ underserved Indians in 22 languages.

**Three core modules:**

| Module | Description |
|---|---|
| 🧮 **ArthaCalc** | 6 fully-functional financial calculators |
| 📋 **ArthaPlanner** | Life-stage financial planner with 6 tools |
| 🎓 **ArthaGuru** | AI education engine, risk profiler, product comparisons, glossary |

---

## 📁 Folder Structure

```
arthaai/
├── index.html          ← Landing page
├── calculators.html    ← ArthaCalc module
├── planner.html        ← ArthaPlanner module
├── guru.html           ← ArthaGuru module
├── css/
│   └── style.css       ← Shared brand stylesheet (all pages)
├── js/
│   ├── main.js         ← Shared JS: nav, scroll, animations, utilities
│   ├── calculators.js  ← Calculator logic (EMI, SIP, Tax, FD, Retirement, Rent vs Buy)
│   └── planner.js      ← Planner logic (Goals, Budget, Emergency, Debt, Life Stage, Net Worth)
└── README.md
```

---

## 🛠️ Deployment

### GitHub / Static Site

This folder is fully self-contained — no build step, no npm, no framework required.

1. Copy the entire `arthaai/` folder into your website repository
2. It will be accessible at `https://yourdomain.com/arthaai/`
3. All internal links use relative paths — works out of the box

### Direct Drop-in

```bash
# Copy to your website repo
cp -r arthaai/ /path/to/your/website/repo/

# Commit and push
cd /path/to/your/website/repo
git add arthaai/
git commit -m "Add ArthaAI module"
git push origin main
```

---

## 🎨 Brand

| Token | Value | Use |
|---|---|---|
| Orange | `#E05C1A` | CTA buttons, highlights, brand |
| Dark Blue | `#1A3A5C` | Headers, dark sections, nav |
| Medium Blue | `#2E86AB` | Accents, links |
| Font | Inter + Poppins | Body + Display |

---

## 📊 ArthaCalc — Calculators

| Calculator | Key Features |
|---|---|
| EMI Calculator | Loan presets (Home/Car/Personal/Education), range sliders, donut chart, year-wise table |
| SIP Calculator | SIP + Lumpsum mode, step-up SIP, visual year-wise bars |
| Tax Savings | Old vs New Regime comparison, all deductions, recommended regime |
| FD/PPF/NPS/RD | 4-instrument comparator, best instrument highlight |
| Retirement Planner | Inflation-adjusted corpus, readiness bar, monthly SIP needed |
| Rent vs Buy | EMI vs rent comparison, future property value, verdict |

---

## 📋 ArthaPlanner — Planning Tools

| Tool | Key Features |
|---|---|
| Goal Planner | 8 goal types, custom goal form, SIP & lumpsum needed |
| Budget Builder | 50-30-20 rule, category expense tracking, health grade |
| Emergency Fund | Target amount, timeline, where-to-keep recommendations |
| Debt Repayment | Avalanche + Snowball methods, debt-free date, interest saved |
| Life Stage Guide | 20s / 30s / 40s / 50s milestone checklists |
| Net Worth Tracker | Assets + Liabilities, asset allocation chart, interpretation |

---

## 🎓 ArthaGuru — Education Engine

| Feature | Description |
|---|---|
| Learn Hub | 6 topic cards (MF, Insurance, Stocks, Tax, Savings, Real Estate), 30+ articles |
| Risk Profiler | 7-question quiz → Conservative / Moderate / Aggressive profile + recommended products |
| Product Comparisons | ULIP vs Term+MF, Endowment vs SIP, PPF vs ELSS, NPS vs MF, Gold instruments |
| AI Chat | Simulated ArthaGuru chatbot with 8 topic responses + 22-language selector UI |
| Financial Glossary | 35+ terms searchable alphabetically + keyword filter |

---

## ⚖️ Legal & Compliance

- **Not SEBI-registered** Investment Adviser
- Content falls under **SEBI Act Sec. 2(1)(g)** — Financial Education Exemption
- **DPDP Act 2023** compliant — no personal data stored
- All calculators provide **educational estimates only** — not financial advice
- Disclaimer displayed on all calculator and planner pages

---

## 🔒 Tech Stack

- **HTML5** — Semantic, accessible markup
- **CSS3** — Custom Properties, Flexbox, Grid, responsive
- **Vanilla JavaScript** — No framework, no dependencies
- **Google Fonts** — Inter + Poppins (loaded from CDN)
- **Zero external dependencies** for core functionality

---

*ArthaAI — Smart Money Guidance for Every Indian 🇮🇳*
*© 2025 Zyllo Tech Software Solutions Pvt Ltd*

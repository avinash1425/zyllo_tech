/**
 * ArthaAI — Internationalisation (i18n) Engine
 * Translates all [data-i18n] elements when language changes.
 * Zyllo Tech Software Solutions Pvt Ltd
 */
'use strict';

(function () {
  /* ─────────────────────────────────────
     TRANSLATION DICTIONARIES
     Key = data-i18n attribute value
     ───────────────────────────────────── */

  const T = {};

  // ── English (default / fallback) ──
  T.en = {
    // ── Nav / Global ──
    'nav.home': 'Home',
    'nav.calculators': 'ArthaCalc',
    'nav.planner': 'ArthaPlanner',
    'nav.guru': 'ArthaGuru',
    'nav.pricing': 'Pricing',
    'nav.login': 'Login',
    'nav.getstarted': 'Get Started Free',
    'nav.calcfull': 'ArthaCalc — Calculators',
    'nav.plannerfull': 'ArthaPlanner — Life Planner',
    'nav.gurufull': 'ArthaGuru — Education',

    // ── INDEX: Hero ──
    'hero.badge': '🇮🇳  Proudly Made in India  ·  DPIIT Startup India',
    'hero.title': 'Smart Money Guidance<br>for <em>Every Indian</em>',
    'hero.desc': "India's first AI-powered personal finance platform — multilingual, unbiased, and built for Bharat. No jargon. No commission bias. No English required.",
    'hero.cta1': 'Try Free Calculators →',
    'hero.cta2': 'See How It Works',
    'hero.trust1': 'Free to Start',
    'hero.trust2': '22 Indian Languages',
    'hero.trust3': 'DPDP Act 2023 Compliant',
    'hero.trust4': 'Zero Commission Bias',

    // ── INDEX: Stats ──
    'stat.investors': 'Underserved Indian Investors',
    'stat.languages': 'Indian Languages at Launch',
    'stat.formulas': 'Financial Formulas',
    'stat.cagr': 'CAGR Digital Finance Growth',
    'stat.commission': 'Commission or Hidden Charges',

    // ── INDEX: Problem ──
    'problem.eyebrow': 'The Problem We Solve',
    'problem.title': "India's 400 Million Middle Class is Financially Abandoned",
    'problem.subtitle': 'The financial system was never built for them — and they know it.',
    'problem.card1.title': 'No Accessible Advisor',
    'problem.card1.desc': 'India has only <strong>1,300 SEBI-registered advisors</strong> for 1.4 billion people. Quality advice costs ₹10,000–₹50,000/year — out of reach for 95% of households.',
    'problem.card1.badge': '1 advisor per 10.7 lakh people',
    'problem.card2.title': 'Biased, Commission-Driven Advice',
    'problem.card2.desc': '<strong>80%+ of financial advice</strong> comes from agents who earn commissions — ULIPs, endowment policies, high-fee funds. The average Indian loses ₹2.3 lakh in suboptimal choices over a lifetime.',
    'problem.card2.badge': '₹2.3 Lakh lost per household',
    'problem.card3.title': 'Language & Literacy Barrier',
    'problem.card3.desc': 'Only <strong>11% of Indians</strong> are comfortable in English. All financial apps, calculators, and products are built exclusively in English. 700+ million people are locked out.',
    'problem.card3.badge': '700M+ financially excluded',

    // ── INDEX: Modules ──
    'modules.eyebrow': 'Three Core Modules',
    'modules.title': 'Everything You Need for Financial Clarity',
    'modules.subtitle': 'Every feature designed around the real pain points of Indian households — from calculators to AI-powered guidance.',
    'mod1.title': 'Smart Calculator Suite',
    'mod1.desc': 'Instant, accurate financial projections for every life decision — from home loans to retirement.',
    'mod1.cta': 'Open Calculators →',
    'mod2.title': 'Financial Life Planner',
    'mod2.desc': 'Personalised life-stage planning — from your 20s to retirement, mapped to your actual goals.',
    'mod2.cta': 'Open Planner →',
    'mod3.title': 'Investment Education Engine',
    'mod3.desc': 'Unbiased financial education in your language — from stock market basics to retirement planning.',
    'mod3.cta': 'Open ArthaGuru →',

    // ── INDEX: How It Works ──
    'how.eyebrow': 'How It Works',
    'how.title': 'From Download to Financial Clarity in 60 Seconds',
    'how.subtitle': 'No paperwork. No English required. No waiting. Just clear, personalised guidance — in your language.',
    'how.step1.title': 'Download & Onboard',
    'how.step1.desc': 'Select your preferred language from 22 options. Answer 5 quick profile questions. Live in 60 seconds — no paperwork.',
    'how.step2.title': 'Set Your Goals',
    'how.step2.desc': 'Input monthly income, expenses, and financial goals — buying a home, child\'s education, retirement. Smart defaults by income & life stage.',
    'how.step3.title': 'AI Analyses Your Profile',
    'how.step3.desc': 'ArthaAI engine processes your goals, income level, risk appetite, and life stage to build a personalised financial snapshot — in under 30 seconds.',
    'how.step4.title': 'Get Guidance',
    'how.step4.desc': 'Step-by-step recommendations: which SIP to start, how much to save, what insurance is missing, how to save tax. Plain language — zero financial jargon.',
    'how.step5.title': 'Learn & Grow',
    'how.step5.desc': 'Ongoing financial education in your local language. Quarterly goal reviews. Smart nudges. The AI gets smarter as your data grows.',
    'how.quote': '"No jargon. No bias. No English required. — ArthaAI speaks your language and thinks for your future."',
    'how.cta': 'Start for Free →',

    // ── INDEX: Language ──
    'lang.eyebrow': 'Language Is Our Moat',
    'lang.title': 'ArthaAI Speaks Your Language',
    'lang.subtitle': "22 scheduled Indian languages — voice + text. No competitor offers genuine multilingual financial guidance. This is ArthaAI's deepest and most defensible advantage.",

    // ── INDEX: Why ArthaAI ──
    'why.eyebrow': 'Why ArthaAI',
    'why.title': 'Built Different. Built for Bharat.',
    'why.subtitle': "ArthaAI isn't just another finance app — it's a purpose-built platform designed from the ground up for India's unique needs.",
    'why.card1.title': 'AI-First, Not AI-Washed',
    'why.card1.desc': 'Personalised guidance powered by real AI models — not generic tips or recycled blog content.',
    'why.card2.title': '22 Languages, Zero Jargon',
    'why.card2.desc': 'From Hindi to Tamil to Assamese — get advice in the language you think in, without confusing financial terms.',
    'why.card3.title': 'Zero Commission Bias',
    'why.card3.desc': 'We don\'t sell products or earn commissions. Our only goal is your financial well-being.',
    'why.card4.title': 'WhatsApp & Offline Ready',
    'why.card4.desc': 'Access calculators and guidance via WhatsApp or offline mode — even with low connectivity.',
    'why.card5.title': 'DPDP Act 2023 Compliant',
    'why.card5.desc': 'Your data stays yours. Explainable AI ensures you always know why a recommendation was made.',
    'why.card6.title': 'B2B & Enterprise Ready',
    'why.card6.desc': 'Employer wellness modules, white-label options, and government-ready deployment for financial inclusion at scale.',

    // ── INDEX: Pricing ──
    'pricing.eyebrow': 'Pricing',
    'pricing.title': 'Free to Start. Powerful to Grow.',
    'pricing.subtitle': "Every Indian deserves access to financial guidance — that's why our core is always free.",
    'pricing.free.badge': 'Free Forever',
    'pricing.free.name': 'Basic',
    'pricing.free.note': 'No credit card needed',
    'pricing.free.cta': 'Get Started Free',
    'pricing.pro.badge': 'Premium',
    'pricing.pro.name': 'Pro',
    'pricing.pro.note': '₹999/year — Save 2 months',
    'pricing.pro.cta': 'Start 14-Day Free Trial',
    'pricing.enterprise.badge': 'Enterprise',
    'pricing.enterprise.name': 'B2B / B2G',
    'pricing.enterprise.note': 'For employers, banks & NBFCs',
    'pricing.enterprise.cta': 'Contact Sales',
    'pricing.notice': '<strong>Free Tier Commitment:</strong> ArthaAI\'s free tier will remain permanently available for retail investors with portfolio < ₹5 lakh. Our mission is to democratise financial guidance for every Indian.',

    // ── INDEX: CTA ──
    'cta.badge': '🚀  Now in Development — MVP Launching June 2026',
    'cta.title': 'Empowering Every Indian<br>to Achieve Their <em style="font-style:normal;color:var(--og);">Artha</em>',
    'cta.quote': '"Artha is the foundation of all human endeavour. Without Artha, Dharma and Kama cannot be attained." — Chanakya, Arthashastra (~321 BCE)',
    'cta.cta1': 'Try Free Calculators →',
    'cta.cta2': 'Contact the Team',

    // ── INDEX: Footer ──
    'footer.brand': "India's first AI-powered personal finance guidance platform — multilingual, unbiased, and built for Bharat. Smart Money Guidance for Every Indian.",
    'footer.product': 'Product',
    'footer.company': 'Company',
    'footer.legal': 'Legal',
    'footer.about': 'About ArthaAI',
    'footer.blog': 'Blog',
    'footer.contact': 'Contact Us',
    'footer.privacy': 'Privacy Policy',
    'footer.terms': 'Terms of Service',
    'footer.dpdp': 'DPDP Compliance',
    'footer.disclaimer': 'Disclaimer',
    'footer.legal.text': 'ArthaAI is a financial education platform, not a SEBI-registered Investment Adviser. All content is educational only. Past performance is not indicative of future results.',

    // ── CALCULATORS PAGE ──
    'calc.header.title': 'Smart Financial Calculators',
    'calc.header.desc': '100+ financial formulas. Free forever. Accurate results in seconds — in your language.',
    'calc.badge1': '🧮 9 Calculator Types',
    'calc.badge2': '📱 Mobile Friendly',
    'calc.badge3': '✅ 100% Free',
    'calc.tab.emi': '🏠 EMI Calculator',
    'calc.tab.sip': '📈 SIP Calculator',
    'calc.tab.tax': '💰 Tax Savings',
    'calc.tab.fd': '🏦 FD / PPF / NPS',
    'calc.tab.retirement': '👴 Retirement',
    'calc.tab.rentvsbuy': '🏡 Rent vs Buy',
    'calc.tab.gold': '🪙 Gold Investment',
    'calc.tab.eduloan': '🎓 Education Loan',
    'calc.tab.gratuity': '🏆 Gratuity',
    'calc.emi.title': 'EMI Calculator',
    'calc.emi.desc': 'Calculate your monthly EMI for Home Loan, Car Loan, Personal Loan, or Education Loan. Understand the total interest you\'ll pay and the full cost of borrowing.',
    'calc.emi.preset.home': '🏠 Home Loan',
    'calc.emi.preset.car': '🚗 Car Loan',
    'calc.emi.preset.personal': '💳 Personal Loan',
    'calc.emi.preset.education': '🎓 Education Loan',
    'calc.emi.label.principal': 'Loan Amount',
    'calc.emi.label.principal.sub': '(Principal)',
    'calc.emi.label.rate': 'Interest Rate',
    'calc.emi.label.rate.sub': '(Annual %)',
    'calc.emi.label.tenure': 'Loan Tenure',
    'calc.emi.hint.amount': 'Enter loan amount in ₹',
    'calc.emi.hint.years': 'Years',
    'calc.emi.hint.months': 'Months (auto)',
    'calc.emi.btn': 'Calculate EMI →',
    'calc.result.interest': 'Interest',
    'calc.result.principal': 'Principal',
    'calc.market.banner': '📡 Fetching live rates...',
    'calc.sip.title': 'SIP & Lumpsum Calculator',
    'calc.sip.desc': 'Estimate the future value of your mutual fund investments. Switch between SIP (monthly investment) and Lumpsum to plan your wealth creation journey.',
    'calc.tax.title': 'Tax Savings Calculator',
    'calc.tax.desc': 'Calculate your income tax under the New Tax Regime vs Old Tax Regime, and find your maximum deduction potential under Section 80C, 80D, HRA, NPS, and more.',
    'calc.fd.title': 'FD / PPF / NPS Maturity Calculator',
    'calc.fd.desc': 'Calculate the maturity value of your fixed deposit, PPF account, or NPS corpus. Compare returns across instruments.',
    'calc.ret.title': 'Retirement Corpus Calculator',
    'calc.ret.desc': 'Find out how much you need to retire comfortably, what you should be saving today, and whether your current savings are on track.',
    'calc.rvb.title': 'Rent vs. Buy Decision Engine',
    'calc.rvb.desc': 'Compare the true cost of renting vs. buying a home over time, accounting for opportunity cost and appreciation.',
    'calc.gold.title': 'Gold Investment Calculator',
    'calc.gold.desc': 'Plan your gold investment via SIP or Lumpsum. Calculate future value based on historical gold CAGR and projected gold price.',
    'calc.edu.title': 'Education Loan Calculator',
    'calc.edu.desc': 'Calculate your EMI, total interest, moratorium impact, and Section 80E tax savings for education loans.',
    'calc.grat.title': 'Gratuity Calculator',
    'calc.grat.desc': 'Calculate your gratuity entitlement under the Payment of Gratuity Act, 1972. Tax-exempt up to ₹20 Lakhs.',

    // ── PLANNER PAGE ──
    'plan.header.title': 'Your Financial Life Planner',
    'plan.header.desc': 'Personalised planning for every life stage — goals, budget, debt, emergency fund, and net worth — all in one place.',
    'plan.badge1': '🎯 6 Planning Tools',
    'plan.badge2': '📊 Life-Stage Milestones',
    'plan.badge3': '💳 Debt Payoff Plans',
    'plan.tab.goals': '🎯 Goal Planner',
    'plan.tab.budget': '📊 Budget Builder',
    'plan.tab.emergency': '🛡️ Emergency Fund',
    'plan.tab.debt': '💳 Debt Repayment',
    'plan.tab.lifestage': '🌟 Life Stage Guide',
    'plan.tab.networth': '💰 Net Worth',
    'plan.goals.title': 'Set Your Financial Goals',
    'plan.goals.desc': 'Select all goals that apply to you. ArthaAI will help you prioritise and build a step-by-step plan.',
    'plan.goal.home': 'Buy a Home',
    'plan.goal.home.desc': 'Down payment & EMI planning',
    'plan.goal.education': "Child's Education",
    'plan.goal.education.desc': 'Plan for school, college & abroad',
    'plan.goal.marriage': 'Marriage',
    'plan.goal.marriage.desc': 'Wedding corpus planning',
    'plan.goal.retirement': 'Retirement',
    'plan.goal.retirement.desc': 'Corpus & monthly income plan',
    'plan.goal.vehicle': 'Buy a Vehicle',
    'plan.goal.vehicle.desc': 'Car or two-wheeler purchase',
    'plan.goal.travel': 'Travel Fund',
    'plan.goal.travel.desc': 'Dream vacation savings',
    'plan.goal.startup': 'Start a Business',
    'plan.goal.startup.desc': 'Build your startup fund',
    'plan.goal.wealth': 'Wealth Creation',
    'plan.goal.wealth.desc': 'Long-term investment corpus',
  };

  // ── Hindi ──
  T.hi = {
    'nav.home': 'होम', 'nav.calculators': 'अर्थाकैल्क', 'nav.planner': 'अर्थाप्लानर', 'nav.guru': 'अर्थागुरु', 'nav.pricing': 'मूल्य', 'nav.login': 'लॉगिन', 'nav.getstarted': 'मुफ्त शुरू करें',
    'nav.calcfull': 'अर्थाकैल्क — कैलकुलेटर', 'nav.plannerfull': 'अर्थाप्लानर — जीवन योजना', 'nav.gurufull': 'अर्थागुरु — शिक्षा',
    'hero.badge': '🇮🇳  गर्व से भारत में निर्मित  ·  DPIIT स्टार्टअप इंडिया',
    'hero.title': 'हर भारतीय के लिए<br><em>स्मार्ट मनी गाइडेंस</em>',
    'hero.desc': 'भारत का पहला AI-संचालित व्यक्तिगत वित्त मंच — बहुभाषी, निष्पक्ष, और भारत के लिए बनाया गया। कोई जटिल शब्द नहीं। कोई कमीशन पूर्वाग्रह नहीं। अंग्रेज़ी ज़रूरी नहीं।',
    'hero.cta1': 'मुफ्त कैलकुलेटर आज़माएं →', 'hero.cta2': 'देखें कैसे काम करता है',
    'hero.trust1': 'मुफ्त शुरू करें', 'hero.trust2': '22 भारतीय भाषाएं', 'hero.trust3': 'DPDP एक्ट 2023 अनुरूप', 'hero.trust4': 'शून्य कमीशन पूर्वाग्रह',
    'stat.investors': 'वंचित भारतीय निवेशक', 'stat.languages': 'लॉन्च पर भारतीय भाषाएं', 'stat.formulas': 'वित्तीय सूत्र', 'stat.cagr': 'CAGR डिजिटल वित्त वृद्धि', 'stat.commission': 'कमीशन या छिपे शुल्क',
    'problem.eyebrow': 'हम जो समस्या हल करते हैं', 'problem.title': 'भारत का 40 करोड़ मध्यम वर्ग आर्थिक रूप से उपेक्षित है', 'problem.subtitle': 'वित्तीय प्रणाली उनके लिए कभी नहीं बनी — और वे जानते हैं।',
    'problem.card1.title': 'कोई सुलभ सलाहकार नहीं', 'problem.card1.desc': 'भारत में 1.4 अरब लोगों के लिए सिर्फ <strong>1,300 SEBI-पंजीकृत सलाहकार</strong> हैं। गुणवत्ता वाली सलाह की कीमत ₹10,000–₹50,000/वर्ष — 95% परिवारों की पहुंच से बाहर।', 'problem.card1.badge': '1 सलाहकार प्रति 10.7 लाख लोग',
    'problem.card2.title': 'पक्षपाती, कमीशन-आधारित सलाह', 'problem.card2.desc': '<strong>80%+ वित्तीय सलाह</strong> कमीशन कमाने वाले एजेंटों से आती है — ULIP, एंडोमेंट पॉलिसी, हाई-फीस फंड। औसत भारतीय जीवनभर में ₹2.3 लाख खोता है।', 'problem.card2.badge': '₹2.3 लाख प्रति परिवार नुकसान',
    'problem.card3.title': 'भाषा और साक्षरता बाधा', 'problem.card3.desc': 'केवल <strong>11% भारतीय</strong> अंग्रेज़ी में सहज हैं। सभी वित्तीय ऐप अंग्रेज़ी में बने हैं। 70 करोड़+ लोग बाहर हैं।', 'problem.card3.badge': '70 करोड़+ आर्थिक रूप से बाहर',
    'modules.eyebrow': 'तीन मुख्य मॉड्यूल', 'modules.title': 'आर्थिक स्पष्टता के लिए सब कुछ', 'modules.subtitle': 'हर फीचर भारतीय परिवारों की असल समस्याओं के लिए बनाया गया है।',
    'mod1.title': 'स्मार्ट कैलकुलेटर सूट', 'mod1.desc': 'हर जीवन निर्णय के लिए तुरंत, सटीक वित्तीय अनुमान।', 'mod1.cta': 'कैलकुलेटर खोलें →',
    'mod2.title': 'वित्तीय जीवन योजना', 'mod2.desc': 'आपके 20s से रिटायरमेंट तक — व्यक्तिगत जीवन-चरण योजना।', 'mod2.cta': 'प्लानर खोलें →',
    'mod3.title': 'निवेश शिक्षा इंजन', 'mod3.desc': 'आपकी भाषा में निष्पक्ष वित्तीय शिक्षा।', 'mod3.cta': 'अर्थागुरु खोलें →',
    'how.eyebrow': 'कैसे काम करता है', 'how.title': 'डाउनलोड से वित्तीय स्पष्टता 60 सेकंड में', 'how.subtitle': 'कोई कागज़ी कार्रवाई नहीं। अंग्रेज़ी ज़रूरी नहीं। बस स्पष्ट मार्गदर्शन — आपकी भाषा में।',
    'how.step1.title': 'डाउनलोड करें', 'how.step1.desc': '22 भाषाओं में से चुनें। 5 प्रश्नों का उत्तर दें। 60 सेकंड में शुरू करें।',
    'how.step2.title': 'अपने लक्ष्य सेट करें', 'how.step2.desc': 'मासिक आय, खर्च, और वित्तीय लक्ष्य दर्ज करें।',
    'how.step3.title': 'AI आपकी प्रोफ़ाइल का विश्लेषण करता है', 'how.step3.desc': 'ArthaAI इंजन आपके लक्ष्यों का विश्लेषण करके 30 सेकंड में वित्तीय स्नैपशॉट बनाता है।',
    'how.step4.title': 'मार्गदर्शन प्राप्त करें', 'how.step4.desc': 'कौन सा SIP शुरू करें, कितना बचाएं, कौन सा बीमा लें — सरल भाषा में।',
    'how.step5.title': 'सीखें और बढ़ें', 'how.step5.desc': 'आपकी स्थानीय भाषा में निरंतर वित्तीय शिक्षा।',
    'how.quote': '"कोई जटिल शब्द नहीं। कोई पूर्वाग्रह नहीं। अंग्रेज़ी ज़रूरी नहीं। — अर्थाAI आपकी भाषा बोलता है।"',
    'how.cta': 'मुफ्त शुरू करें →',
    'lang.eyebrow': 'भाषा हमारी ताक़त है', 'lang.title': 'अर्थाAI आपकी भाषा बोलता है', 'lang.subtitle': '22 अनुसूचित भारतीय भाषाएं — ध्वनि + पाठ। कोई प्रतिस्पर्धी वास्तविक बहुभाषी वित्तीय मार्गदर्शन नहीं देता।',
    'why.eyebrow': 'अर्थाAI क्यों', 'why.title': 'अलग बनाया। भारत के लिए बनाया।', 'why.subtitle': 'अर्थाAI सिर्फ एक और वित्त ऐप नहीं है — यह भारत की अनूठी ज़रूरतों के लिए बनाया गया है।',
    'why.card1.title': 'AI-फर्स्ट, AI-वॉश्ड नहीं', 'why.card1.desc': 'असली AI मॉडल पर आधारित व्यक्तिगत मार्गदर्शन।',
    'why.card2.title': '22 भाषाएं, शून्य जटिलता', 'why.card2.desc': 'हिन्दी से तमिल तक — आपकी भाषा में सलाह।',
    'why.card3.title': 'शून्य कमीशन पूर्वाग्रह', 'why.card3.desc': 'हम उत्पाद नहीं बेचते। हमारा लक्ष्य सिर्फ आपकी आर्थिक भलाई है।',
    'why.card4.title': 'WhatsApp और ऑफ़लाइन तैयार', 'why.card4.desc': 'WhatsApp या ऑफ़लाइन मोड से कैलकुलेटर और मार्गदर्शन।',
    'why.card5.title': 'DPDP एक्ट 2023 अनुरूप', 'why.card5.desc': 'आपका डेटा आपका है। पारदर्शी AI सुनिश्चित करता है।',
    'why.card6.title': 'B2B और एंटरप्राइज़ तैयार', 'why.card6.desc': 'नियोक्ता कल्याण मॉड्यूल और व्हाइट-लेबल विकल्प।',
    'pricing.eyebrow': 'मूल्य', 'pricing.title': 'मुफ्त शुरू करें। शक्तिशाली बनें।', 'pricing.subtitle': 'हर भारतीय को वित्तीय मार्गदर्शन मिलना चाहिए।',
    'pricing.free.badge': 'सदा मुफ्त', 'pricing.free.name': 'बेसिक', 'pricing.free.note': 'क्रेडिट कार्ड ज़रूरी नहीं', 'pricing.free.cta': 'मुफ्त शुरू करें',
    'pricing.pro.badge': 'प्रीमियम', 'pricing.pro.name': 'प्रो', 'pricing.pro.note': '₹999/वर्ष — 2 महीने बचाएं', 'pricing.pro.cta': '14-दिन मुफ्त ट्रायल शुरू करें',
    'pricing.enterprise.badge': 'एंटरप्राइज़', 'pricing.enterprise.name': 'B2B / B2G', 'pricing.enterprise.note': 'नियोक्ताओं, बैंकों और NBFCs के लिए', 'pricing.enterprise.cta': 'सेल्स से संपर्क करें',
    'cta.badge': '🚀  विकास में — MVP जून 2026 में लॉन्च', 'cta.title': 'हर भारतीय को सशक्त बनाना<br>अपना <em style="font-style:normal;color:var(--og);">अर्थ</em> प्राप्त करने के लिए',
    'cta.quote': '"अर्थ सभी मानव प्रयासों का आधार है। अर्थ के बिना, धर्म और काम प्राप्त नहीं किए जा सकते।" — चाणक्य, अर्थशास्त्र (~321 ईसा पूर्व)',
    'cta.cta1': 'मुफ्त कैलकुलेटर आज़माएं →', 'cta.cta2': 'टीम से संपर्क करें',
    'footer.brand': 'भारत का पहला AI-संचालित व्यक्तिगत वित्त मंच — बहुभाषी, निष्पक्ष, और भारत के लिए।',
    'footer.product': 'उत्पाद', 'footer.company': 'कंपनी', 'footer.legal': 'कानूनी', 'footer.about': 'अर्थाAI के बारे में', 'footer.blog': 'ब्लॉग', 'footer.contact': 'संपर्क करें',
    'footer.privacy': 'गोपनीयता नीति', 'footer.terms': 'सेवा शर्तें', 'footer.dpdp': 'DPDP अनुपालन', 'footer.disclaimer': 'अस्वीकरण',
    'footer.legal.text': 'अर्थाAI एक वित्तीय शिक्षा मंच है, SEBI-पंजीकृत निवेश सलाहकार नहीं। सभी सामग्री केवल शैक्षिक उद्देश्यों के लिए है। पिछला प्रदर्शन भविष्य के परिणामों का संकेत नहीं है।',
    'calc.header.title': 'स्मार्ट वित्तीय कैलकुलेटर', 'calc.header.desc': '100+ वित्तीय सूत्र। सदा मुफ्त। सेकंडों में सटीक परिणाम — आपकी भाषा में।',
    'calc.badge1': '🧮 9 कैलकुलेटर प्रकार', 'calc.badge2': '📱 मोबाइल फ्रेंडली', 'calc.badge3': '✅ 100% मुफ्त',
    'calc.tab.emi': '🏠 EMI कैलकुलेटर', 'calc.tab.sip': '📈 SIP कैलकुलेटर', 'calc.tab.tax': '💰 टैक्स बचत', 'calc.tab.fd': '🏦 FD / PPF / NPS', 'calc.tab.retirement': '👴 रिटायरमेंट', 'calc.tab.rentvsbuy': '🏡 किराया बनाम खरीदें', 'calc.tab.gold': '🪙 सोना निवेश', 'calc.tab.eduloan': '🎓 शिक्षा ऋण', 'calc.tab.gratuity': '🏆 ग्रैच्युटी',
    'calc.emi.btn': 'EMI गणना करें →',
    'calc.emi.label.principal': 'ऋण राशि', 'calc.emi.label.principal.sub': '(मूलधन)', 'calc.emi.label.rate': 'ब्याज दर', 'calc.emi.label.rate.sub': '(वार्षिक %)', 'calc.emi.label.tenure': 'ऋण अवधि',
    'calc.emi.hint.amount': 'ऋण राशि ₹ में दर्ज करें', 'calc.emi.hint.years': 'वर्ष', 'calc.emi.hint.months': 'महीने (स्वतः)',
    'plan.header.title': 'आपका वित्तीय जीवन प्लानर', 'plan.header.desc': 'हर जीवन चरण के लिए व्यक्तिगत योजना — लक्ष्य, बजट, ऋण, आपातकालीन कोष, और कुल संपत्ति।',
    'plan.badge1': '🎯 6 योजना उपकरण', 'plan.badge2': '📊 जीवन-चरण मील के पत्थर', 'plan.badge3': '💳 ऋण भुगतान योजनाएं',
    'plan.tab.goals': '🎯 लक्ष्य योजना', 'plan.tab.budget': '📊 बजट बिल्डर', 'plan.tab.emergency': '🛡️ आपातकालीन कोष', 'plan.tab.debt': '💳 ऋण भुगतान', 'plan.tab.lifestage': '🌟 जीवन चरण गाइड', 'plan.tab.networth': '💰 कुल संपत्ति',
    'plan.goals.title': 'अपने वित्तीय लक्ष्य सेट करें', 'plan.goals.desc': 'अपने सभी लक्ष्य चुनें। अर्थाAI प्राथमिकता और योजना बनाने में मदद करेगा।',
    'plan.goal.home': 'घर खरीदें', 'plan.goal.home.desc': 'डाउन पेमेंट और EMI योजना',
    'plan.goal.education': 'बच्चे की शिक्षा', 'plan.goal.education.desc': 'स्कूल, कॉलेज और विदेश की योजना',
    'plan.goal.marriage': 'विवाह', 'plan.goal.marriage.desc': 'शादी कोष योजना',
    'plan.goal.retirement': 'रिटायरमेंट', 'plan.goal.retirement.desc': 'कोष और मासिक आय योजना',
    'plan.goal.vehicle': 'वाहन खरीदें', 'plan.goal.vehicle.desc': 'कार या दोपहिया खरीद',
    'plan.goal.travel': 'यात्रा कोष', 'plan.goal.travel.desc': 'सपनों की छुट्टी बचत',
    'plan.goal.startup': 'व्यवसाय शुरू करें', 'plan.goal.startup.desc': 'स्टार्टअप फंड बनाएं',
    'plan.goal.wealth': 'संपत्ति निर्माण', 'plan.goal.wealth.desc': 'दीर्घकालिक निवेश कोष',
  };

  // ── Telugu ──
  T.te = {
    'nav.home': 'హోమ్', 'nav.calculators': 'అర్థాక్యాల్క్', 'nav.planner': 'అర్థాప్లానర్', 'nav.guru': 'అర్థాగురు', 'nav.pricing': 'ధర', 'nav.login': 'లాగిన్', 'nav.getstarted': 'ఉచితంగా ప్రారంభించండి',
    'nav.calcfull': 'అర్థాక్యాల్క్ — కాలిక్యులేటర్లు', 'nav.plannerfull': 'అర్థాప్లానర్ — జీవిత ప్రణాళిక', 'nav.gurufull': 'అర్థాగురు — విద్య',
    'hero.badge': '🇮🇳  గర్వంగా భారతదేశంలో తయారు  ·  DPIIT స్టార్టప్ ఇండియా',
    'hero.title': 'ప్రతి భారతీయుడికి<br><em>స్మార్ట్ మనీ గైడెన్స్</em>',
    'hero.desc': 'భారతదేశపు మొదటి AI-ఆధారిత వ్యక్తిగత ఆర్థిక ప్లాట్‌ఫామ్ — బహుభాషా, నిష్పక్షపాతం, భారత్ కోసం నిర్మించబడింది.',
    'hero.cta1': 'ఉచిత కాలిక్యులేటర్లు ప్రయత్నించండి →', 'hero.cta2': 'ఎలా పనిచేస్తుందో చూడండి',
    'hero.trust1': 'ఉచితంగా ప్రారంభించండి', 'hero.trust2': '22 భారతీయ భాషలు', 'hero.trust3': 'DPDP చట్టం 2023 అనుగుణం', 'hero.trust4': 'సున్నా కమీషన్ పక్షపాతం',
    'stat.investors': 'అవకాశం లేని భారతీయ పెట్టుబడిదారులు', 'stat.languages': 'లాంచ్ సమయంలో భారతీయ భాషలు', 'stat.formulas': 'ఆర్థిక సూత్రాలు', 'stat.cagr': 'CAGR డిజిటల్ ఫైనాన్స్ వృద్ధి', 'stat.commission': 'కమీషన్ లేదా దాచిన ఛార్జీలు',
    'problem.eyebrow': 'మేము పరిష్కరించే సమస్య', 'problem.title': 'భారతదేశపు 40 కోట్ల మధ్యతరగతి ఆర్థికంగా విడిచిపెట్టబడింది', 'problem.subtitle': 'ఆర్థిక వ్యవస్థ వారి కోసం నిర్మించబడలేదు.',
    'problem.card1.title': 'అందుబాటులో సలహాదారు లేడు', 'problem.card2.title': 'పక్షపాత, కమీషన్-ఆధారిత సలహా', 'problem.card3.title': 'భాష & అక్షరాస్యత అడ్డంకి',
    'modules.eyebrow': 'మూడు ప్రధాన మాడ్యూల్స్', 'modules.title': 'ఆర్థిక స్పష్టత కోసం అన్నీ', 'modules.subtitle': 'భారతీయ కుటుంబాల నిజమైన సమస్యల కోసం రూపొందించబడింది.',
    'mod1.title': 'స్మార్ట్ కాలిక్యులేటర్ సూట్', 'mod1.cta': 'కాలిక్యులేటర్లు తెరవండి →', 'mod2.title': 'ఆర్థిక జీవిత ప్లానర్', 'mod2.cta': 'ప్లానర్ తెరవండి →', 'mod3.title': 'పెట్టుబడి విద్య ఇంజన్', 'mod3.cta': 'అర్థాగురు తెరవండి →',
    'how.eyebrow': 'ఎలా పనిచేస్తుంది', 'how.title': 'డౌన్‌లోడ్ నుండి ఆర్థిక స్పష్టత 60 సెకన్లలో', 'how.subtitle': 'కాగితపు పని లేదు. ఆంగ్లం అవసరం లేదు. మీ భాషలో స్పష్టమైన మార్గదర్శకత్వం.',
    'how.step1.title': 'డౌన్‌లోడ్ చేయండి', 'how.step2.title': 'మీ లక్ష్యాలు సెట్ చేయండి', 'how.step3.title': 'AI మీ ప్రొఫైల్ విశ్లేషిస్తుంది', 'how.step4.title': 'మార్గదర్శకత్వం పొందండి', 'how.step5.title': 'నేర్చుకోండి & ఎదగండి',
    'how.cta': 'ఉచితంగా ప్రారంభించండి →',
    'lang.eyebrow': 'భాష మా బలం', 'lang.title': 'అర్థాAI మీ భాష మాట్లాడుతుంది',
    'why.eyebrow': 'అర్థాAI ఎందుకు', 'why.title': 'భిన్నంగా నిర్మించబడింది. భారత్ కోసం.',
    'pricing.eyebrow': 'ధర', 'pricing.title': 'ఉచితంగా ప్రారంభించండి. శక్తివంతంగా ఎదగండి.',
    'pricing.free.badge': 'ఎప్పటికీ ఉచితం', 'pricing.free.name': 'బేసిక్', 'pricing.free.cta': 'ఉచితంగా ప్రారంభించండి',
    'pricing.pro.badge': 'ప్రీమియం', 'pricing.pro.name': 'ప్రో', 'pricing.pro.cta': '14-రోజుల ఉచిత ట్రయల్',
    'pricing.enterprise.cta': 'సేల్స్ సంప్రదించండి',
    'cta.cta1': 'ఉచిత కాలిక్యులేటర్లు ప్రయత్నించండి →', 'cta.cta2': 'టీమ్‌ను సంప్రదించండి',
    'calc.header.title': 'స్మార్ట్ ఆర్థిక కాలిక్యులేటర్లు', 'calc.header.desc': '100+ ఆర్థిక సూత్రాలు. ఎప్పటికీ ఉచితం. సెకన్లలో ఖచ్చితమైన ఫలితాలు — మీ భాషలో.',
    'calc.tab.emi': '🏠 EMI కాలిక్యులేటర్', 'calc.tab.sip': '📈 SIP కాలిక్యులేటర్', 'calc.tab.tax': '💰 టాక్స్ సేవింగ్స్', 'calc.tab.fd': '🏦 FD / PPF / NPS', 'calc.tab.retirement': '👴 రిటైర్మెంట్', 'calc.tab.rentvsbuy': '🏡 అద్దె vs కొనుగోలు', 'calc.tab.gold': '🪙 బంగారు పెట్టుబడి', 'calc.tab.eduloan': '🎓 విద్యా రుణం', 'calc.tab.gratuity': '🏆 గ్రాట్యుటీ',
    'calc.emi.btn': 'EMI లెక్కించండి →',
    'plan.header.title': 'మీ ఆర్థిక జీవిత ప్లానర్', 'plan.header.desc': 'ప్రతి జీవిత దశ కోసం వ్యక్తిగత ప్రణాళిక.',
    'plan.tab.goals': '🎯 లక్ష్య ప్లానర్', 'plan.tab.budget': '📊 బడ్జెట్ బిల్డర్', 'plan.tab.emergency': '🛡️ ఎమర్జెన్సీ ఫండ్', 'plan.tab.debt': '💳 అప్పు తిరిగి చెల్లింపు', 'plan.tab.lifestage': '🌟 జీవిత దశ గైడ్', 'plan.tab.networth': '💰 నికర విలువ',
    'plan.goals.title': 'మీ ఆర్థిక లక్ష్యాలు సెట్ చేయండి', 'plan.goals.desc': 'మీకు వర్తించే లక్ష్యాలన్నీ ఎంచుకోండి.',
    'plan.goal.home': 'ఇల్లు కొనండి', 'plan.goal.education': 'పిల్లల విద్య', 'plan.goal.marriage': 'వివాహం', 'plan.goal.retirement': 'రిటైర్మెంట్', 'plan.goal.vehicle': 'వాహనం కొనండి', 'plan.goal.travel': 'ప్రయాణ నిధి', 'plan.goal.startup': 'వ్యాపారం ప్రారంభించండి', 'plan.goal.wealth': 'సంపద సృష్టి',
  };

  // ── Tamil ──
  T.ta = {
    'nav.home': 'முகப்பு', 'nav.calculators': 'அர்த்தாகால்க்', 'nav.planner': 'அர்த்தாப்ளானர்', 'nav.guru': 'அர்த்தாகுரு', 'nav.pricing': 'விலை', 'nav.login': 'உள்நுழை', 'nav.getstarted': 'இலவசமாக தொடங்கு',
    'hero.badge': '🇮🇳  இந்தியாவில் பெருமையாக தயாரிக்கப்பட்டது  ·  DPIIT ஸ்டார்ட்அப் இந்தியா',
    'hero.title': 'ஒவ்வொரு இந்தியருக்கும்<br><em>புத்திசாலி பண வழிகாட்டுதல்</em>',
    'hero.desc': 'இந்தியாவின் முதல் AI-இயக்கப்படும் தனிநபர் நிதி தளம் — பன்மொழி, நிலையான, பாரதத்திற்காக கட்டப்பட்டது.',
    'hero.cta1': 'இலவச கால்குலேட்டர்களை முயற்சிக்கவும் →', 'hero.cta2': 'எவ்வாறு செயல்படுகிறது பாருங்கள்',
    'hero.trust1': 'இலவசமாக தொடங்கு', 'hero.trust2': '22 இந்திய மொழிகள்', 'hero.trust3': 'DPDP சட்டம் 2023 இணக்கம்', 'hero.trust4': 'பூஜ்ய கமிஷன் சார்பு',
    'problem.eyebrow': 'நாங்கள் தீர்க்கும் பிரச்சனை', 'problem.title': 'இந்தியாவின் 40 கோடி நடுத்தர வர்க்கம் நிதி ரீதியாக கைவிடப்பட்டது',
    'modules.eyebrow': 'மூன்று முக்கிய தொகுதிகள்', 'modules.title': 'நிதி தெளிவுக்கு தேவையான அனைத்தும்',
    'mod1.title': 'ஸ்மார்ட் கால்குலேட்டர் தொகுப்பு', 'mod1.cta': 'கால்குலேட்டர்களைத் திறக்கவும் →', 'mod2.title': 'நிதி வாழ்க்கை திட்டமிடல்', 'mod2.cta': 'திட்டமிடலைத் திறக்கவும் →', 'mod3.title': 'முதலீட்டு கல்வி இயந்திரம்', 'mod3.cta': 'அர்த்தாகுருவைத் திறக்கவும் →',
    'how.eyebrow': 'எவ்வாறு செயல்படுகிறது', 'how.title': 'பதிவிறக்கத்திலிருந்து நிதி தெளிவு 60 வினாடிகளில்',
    'pricing.eyebrow': 'விலை', 'pricing.title': 'இலவசமாக தொடங்கு. சக்திவாய்ந்ததாக வளரு.',
    'pricing.free.badge': 'எப்போதும் இலவசம்', 'pricing.free.cta': 'இலவசமாக தொடங்கு', 'pricing.pro.cta': '14-நாள் இலவச சோதனை', 'pricing.enterprise.cta': 'விற்பனையை தொடர்புகொள்ளுங்கள்',
    'calc.header.title': 'ஸ்மார்ட் நிதி கால்குலேட்டர்கள்', 'calc.header.desc': '100+ நிதி சூத்திரங்கள். எப்போதும் இலவசம்.',
    'calc.tab.emi': '🏠 EMI கால்குலேட்டர்', 'calc.tab.sip': '📈 SIP கால்குலேட்டர்', 'calc.tab.tax': '💰 வரி சேமிப்பு',
    'calc.emi.btn': 'EMI கணக்கிடு →',
    'plan.header.title': 'உங்கள் நிதி வாழ்க்கை திட்டமிடல்',
    'plan.tab.goals': '🎯 இலக்கு திட்டமிடல்', 'plan.tab.budget': '📊 பட்ஜெட் உருவாக்கி', 'plan.tab.emergency': '🛡️ அவசரகால நிதி', 'plan.tab.debt': '💳 கடன் திருப்பிச் செலுத்தல்', 'plan.tab.lifestage': '🌟 வாழ்க்கை நிலை வழிகாட்டி', 'plan.tab.networth': '💰 நிகர மதிப்பு',
    'plan.goals.title': 'உங்கள் நிதி இலக்குகளை அமைக்கவும்',
    'plan.goal.home': 'வீடு வாங்கு', 'plan.goal.education': 'குழந்தை கல்வி', 'plan.goal.marriage': 'திருமணம்', 'plan.goal.retirement': 'ஓய்வு', 'plan.goal.vehicle': 'வாகனம் வாங்கு', 'plan.goal.travel': 'பயண நிதி', 'plan.goal.startup': 'தொழில் தொடங்கு', 'plan.goal.wealth': 'செல்வ உருவாக்கம்',
  };

  // ── Marathi ──
  T.mr = {
    'nav.home': 'होम', 'nav.calculators': 'अर्थाकॅल्क', 'nav.planner': 'अर्थाप्लॅनर', 'nav.guru': 'अर्थागुरु', 'nav.pricing': 'किंमत', 'nav.login': 'लॉगिन', 'nav.getstarted': 'मोफत सुरू करा',
    'hero.badge': '🇮🇳  अभिमानाने भारतात निर्मित  ·  DPIIT स्टार्टअप इंडिया',
    'hero.title': 'प्रत्येक भारतीयासाठी<br><em>स्मार्ट मनी मार्गदर्शन</em>',
    'hero.desc': 'भारतातील पहिले AI-संचालित वैयक्तिक अर्थव्यवस्था व्यासपीठ — बहुभाषिक, निष्पक्ष, आणि भारतासाठी बनवलेले.',
    'hero.cta1': 'मोफत कॅल्क्युलेटर वापरा →', 'hero.cta2': 'कसे काम करते ते पहा',
    'hero.trust1': 'मोफत सुरू करा', 'hero.trust2': '22 भारतीय भाषा', 'hero.trust3': 'DPDP कायदा 2023 अनुरूप', 'hero.trust4': 'शून्य कमिशन पूर्वग्रह',
    'problem.eyebrow': 'आम्ही सोडवतो ती समस्या', 'problem.title': 'भारतातील 40 कोटी मध्यमवर्ग आर्थिकदृष्ट्या उपेक्षित',
    'modules.eyebrow': 'तीन मुख्य मॉड्यूल्स', 'modules.title': 'आर्थिक स्पष्टतेसाठी सर्व काही',
    'mod1.title': 'स्मार्ट कॅल्क्युलेटर सूट', 'mod1.cta': 'कॅल्क्युलेटर उघडा →', 'mod2.title': 'आर्थिक जीवन योजना', 'mod2.cta': 'प्लॅनर उघडा →', 'mod3.title': 'गुंतवणूक शिक्षण इंजिन', 'mod3.cta': 'अर्थागुरु उघडा →',
    'how.eyebrow': 'कसे काम करते', 'how.title': 'डाउनलोड ते आर्थिक स्पष्टता 60 सेकंदात',
    'pricing.eyebrow': 'किंमत', 'pricing.title': 'मोफत सुरू करा. शक्तिशाली वाढा.',
    'calc.header.title': 'स्मार्ट आर्थिक कॅल्क्युलेटर', 'calc.header.desc': '100+ आर्थिक सूत्रे. सदैव मोफत. सेकंदात अचूक निकाल.',
    'calc.tab.emi': '🏠 EMI कॅल्क्युलेटर', 'calc.tab.sip': '📈 SIP कॅल्क्युलेटर', 'calc.tab.tax': '💰 कर बचत',
    'calc.emi.btn': 'EMI मोजा →',
    'plan.header.title': 'तुमचा आर्थिक जीवन प्लॅनर',
    'plan.tab.goals': '🎯 ध्येय योजना', 'plan.tab.budget': '📊 बजेट बिल्डर', 'plan.tab.emergency': '🛡️ आपत्कालीन निधी', 'plan.tab.debt': '💳 कर्ज परतफेड', 'plan.tab.lifestage': '🌟 जीवन टप्पा मार्गदर्शक', 'plan.tab.networth': '💰 एकूण संपत्ती',
    'plan.goals.title': 'तुमची आर्थिक ध्येये सेट करा',
    'plan.goal.home': 'घर खरेदी करा', 'plan.goal.education': 'मुलांचे शिक्षण', 'plan.goal.marriage': 'लग्न', 'plan.goal.retirement': 'निवृत्ती', 'plan.goal.vehicle': 'वाहन खरेदी करा', 'plan.goal.travel': 'प्रवास निधी', 'plan.goal.startup': 'व्यवसाय सुरू करा', 'plan.goal.wealth': 'संपत्ती निर्मिती',
  };

  // ── Bengali ──
  T.bn = {
    'nav.home': 'হোম', 'nav.calculators': 'অর্থাক্যাল্ক', 'nav.planner': 'অর্থাপ্ল্যানার', 'nav.guru': 'অর্থাগুরু', 'nav.pricing': 'মূল্য', 'nav.login': 'লগইন', 'nav.getstarted': 'বিনামূল্যে শুরু করুন',
    'hero.badge': '🇮🇳  গর্বের সাথে ভারতে তৈরি  ·  DPIIT স্টার্টআপ ইন্ডিয়া',
    'hero.title': 'প্রতিটি ভারতীয়ের জন্য<br><em>স্মার্ট মানি গাইডেন্স</em>',
    'hero.desc': 'ভারতের প্রথম AI-চালিত ব্যক্তিগত অর্থ প্ল্যাটফর্ম — বহুভাষিক, নিরপেক্ষ, এবং ভারতের জন্য তৈরি।',
    'hero.cta1': 'বিনামূল্যে ক্যালকুলেটর চেষ্টা করুন →', 'hero.cta2': 'কীভাবে কাজ করে দেখুন',
    'hero.trust1': 'বিনামূল্যে শুরু', 'hero.trust2': '22 ভারতীয় ভাষা', 'hero.trust3': 'DPDP আইন 2023 সম্মত', 'hero.trust4': 'শূন্য কমিশন পক্ষপাত',
    'problem.eyebrow': 'আমরা যে সমস্যা সমাধান করি', 'problem.title': 'ভারতের 40 কোটি মধ্যবিত্ত আর্থিকভাবে পরিত্যক্ত',
    'modules.eyebrow': 'তিনটি মূল মডিউল', 'modules.title': 'আর্থিক স্পষ্টতার জন্য সবকিছু',
    'mod1.title': 'স্মার্ট ক্যালকুলেটর সুইট', 'mod1.cta': 'ক্যালকুলেটর খুলুন →', 'mod2.title': 'আর্থিক জীবন পরিকল্পক', 'mod2.cta': 'প্ল্যানার খুলুন →', 'mod3.title': 'বিনিয়োগ শিক্ষা ইঞ্জিন', 'mod3.cta': 'অর্থাগুরু খুলুন →',
    'how.eyebrow': 'কীভাবে কাজ করে', 'how.title': 'ডাউনলোড থেকে আর্থিক স্পষ্টতা 60 সেকেন্ডে',
    'pricing.eyebrow': 'মূল্য', 'pricing.title': 'বিনামূল্যে শুরু করুন। শক্তিশালী হয়ে উঠুন।',
    'calc.header.title': 'স্মার্ট আর্থিক ক্যালকুলেটর', 'calc.header.desc': '100+ আর্থিক সূত্র। চিরকালের জন্য বিনামূল্যে।',
    'calc.tab.emi': '🏠 EMI ক্যালকুলেটর', 'calc.tab.sip': '📈 SIP ক্যালকুলেটর', 'calc.tab.tax': '💰 কর সঞ্চয়',
    'calc.emi.btn': 'EMI গণনা করুন →',
    'plan.header.title': 'আপনার আর্থিক জীবন পরিকল্পক',
    'plan.tab.goals': '🎯 লক্ষ্য পরিকল্পক', 'plan.tab.budget': '📊 বাজেট নির্মাতা', 'plan.tab.emergency': '🛡️ জরুরি তহবিল', 'plan.tab.debt': '💳 ঋণ পরিশোধ', 'plan.tab.lifestage': '🌟 জীবন পর্যায় গাইড', 'plan.tab.networth': '💰 মোট সম্পদ',
    'plan.goals.title': 'আপনার আর্থিক লক্ষ্য সেট করুন',
    'plan.goal.home': 'বাড়ি কিনুন', 'plan.goal.education': 'সন্তানের শিক্ষা', 'plan.goal.marriage': 'বিবাহ', 'plan.goal.retirement': 'অবসর', 'plan.goal.vehicle': 'গাড়ি কিনুন', 'plan.goal.travel': 'ভ্রমণ তহবিল', 'plan.goal.startup': 'ব্যবসা শুরু করুন', 'plan.goal.wealth': 'সম্পদ সৃষ্টি',
  };

  // ── Gujarati ──
  T.gu = {
    'nav.home': 'હોમ', 'nav.calculators': 'અર્થાકેલ્ક', 'nav.planner': 'અર્થાપ્લાનર', 'nav.guru': 'અર્થાગુરુ', 'nav.pricing': 'કિંમત', 'nav.login': 'લૉગિન', 'nav.getstarted': 'મફત શરૂ કરો',
    'hero.badge': '🇮🇳  ગર્વથી ભારતમાં બનેલું  ·  DPIIT સ્ટાર્ટઅપ ઈન્ડિયા',
    'hero.title': 'દરેક ભારતીય માટે<br><em>સ્માર્ટ મની ગાઈડન્સ</em>',
    'hero.desc': 'ભારતનું પ્રથમ AI-સંચાલિત વ્યક્તિગત નાણાકીય પ્લેટફોર્મ — બહુભાષી, નિષ્પક્ષ, અને ભારત માટે બનાવેલું.',
    'hero.cta1': 'મફત કેલ્ક્યુલેટર અજમાવો →', 'hero.cta2': 'કેવી રીતે કામ કરે છે જુઓ',
    'hero.trust1': 'મફત શરૂ કરો', 'hero.trust2': '22 ભારતીય ભાષાઓ', 'hero.trust3': 'DPDP એક્ટ 2023 અનુરૂપ', 'hero.trust4': 'શૂન્ય કમિશન પૂર્વગ્રહ',
    'modules.eyebrow': 'ત્રણ મુખ્ય મોડ્યુલ્સ', 'modules.title': 'નાણાકીય સ્પષ્ટતા માટે બધું',
    'mod1.title': 'સ્માર્ટ કેલ્ક્યુલેટર સૂટ', 'mod1.cta': 'કેલ્ક્યુલેટર ખોલો →', 'mod2.title': 'નાણાકીય જીવન પ્લાનર', 'mod2.cta': 'પ્લાનર ખોલો →', 'mod3.title': 'રોકાણ શિક્ષણ એંજિન', 'mod3.cta': 'અર્થાગુરુ ખોલો →',
    'calc.header.title': 'સ્માર્ટ નાણાકીય કેલ્ક્યુલેટર', 'calc.header.desc': '100+ નાણાકીય સૂત્રો. હંમેશા મફત.',
    'calc.tab.emi': '🏠 EMI કેલ્ક્યુલેટર', 'calc.tab.sip': '📈 SIP કેલ્ક્યુલેટર', 'calc.tab.tax': '💰 કર બચત',
    'calc.emi.btn': 'EMI ગણો →',
    'plan.header.title': 'તમારું નાણાકીય જીવન પ્લાનર',
    'plan.tab.goals': '🎯 લક્ષ્ય પ્લાનર', 'plan.tab.budget': '📊 બજેટ બિલ્ડર', 'plan.tab.emergency': '🛡️ ઈમરજન્સી ફંડ', 'plan.tab.debt': '💳 દેવું ચુકવણી', 'plan.tab.lifestage': '🌟 જીવન તબક્કો ગાઈડ', 'plan.tab.networth': '💰 કુલ સંપત્તિ',
    'plan.goals.title': 'તમારા નાણાકીય લક્ષ્યો સેટ કરો',
    'plan.goal.home': 'ઘર ખરીદો', 'plan.goal.education': 'બાળકનું શિક્ષણ', 'plan.goal.marriage': 'લગ્ન', 'plan.goal.retirement': 'નિવૃત્તિ', 'plan.goal.vehicle': 'વાહન ખરીદો', 'plan.goal.travel': 'મુસાફરી ભંડોળ', 'plan.goal.startup': 'વ્યવસાય શરૂ કરો', 'plan.goal.wealth': 'સંપત્તિ સર્જન',
  };

  // ── Kannada ──
  T.kn = {
    'nav.home': 'ಹೋಮ್', 'nav.calculators': 'ಅರ್ಥಾಕ್ಯಾಲ್ಕ್', 'nav.planner': 'ಅರ್ಥಾಪ್ಲಾನರ್', 'nav.guru': 'ಅರ್ಥಾಗುರು', 'nav.pricing': 'ಬೆಲೆ', 'nav.login': 'ಲಾಗಿನ್', 'nav.getstarted': 'ಉಚಿತವಾಗಿ ಪ್ರಾರಂಭಿಸಿ',
    'hero.badge': '🇮🇳  ಹೆಮ್ಮೆಯಿಂದ ಭಾರತದಲ್ಲಿ ತಯಾರಾಗಿದೆ  ·  DPIIT ಸ್ಟಾರ್ಟ್ಅಪ್ ಇಂಡಿಯಾ',
    'hero.title': 'ಪ್ರತಿ ಭಾರತೀಯರಿಗೂ<br><em>ಸ್ಮಾರ್ಟ್ ಮನಿ ಗೈಡೆನ್ಸ್</em>',
    'hero.desc': 'ಭಾರತದ ಮೊದಲ AI-ಚಾಲಿತ ವೈಯಕ್ತಿಕ ಹಣಕಾಸು ವೇದಿಕೆ — ಬಹುಭಾಷಿಕ, ನಿಷ್ಪಕ್ಷಪಾತ, ಭಾರತಕ್ಕಾಗಿ ನಿರ್ಮಿಸಲಾಗಿದೆ.',
    'hero.cta1': 'ಉಚಿತ ಕ್ಯಾಲ್ಕುಲೇಟರ್‌ಗಳನ್ನು ಪ್ರಯತ್ನಿಸಿ →', 'hero.cta2': 'ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ ನೋಡಿ',
    'modules.eyebrow': 'ಮೂರು ಪ್ರಮುಖ ಮಾಡ್ಯೂಲ್‌ಗಳು', 'modules.title': 'ಹಣಕಾಸು ಸ್ಪಷ್ಟತೆಗೆ ಬೇಕಾದ ಎಲ್ಲವೂ',
    'mod1.title': 'ಸ್ಮಾರ್ಟ್ ಕ್ಯಾಲ್ಕುಲೇಟರ್ ಸೂಟ್', 'mod1.cta': 'ಕ್ಯಾಲ್ಕುಲೇಟರ್ ತೆರೆಯಿರಿ →', 'mod2.title': 'ಹಣಕಾಸು ಜೀವನ ಯೋಜಕ', 'mod2.cta': 'ಪ್ಲಾನರ್ ತೆರೆಯಿರಿ →', 'mod3.title': 'ಹೂಡಿಕೆ ಶಿಕ್ಷಣ ಎಂಜಿನ್', 'mod3.cta': 'ಅರ್ಥಾಗುರು ತೆರೆಯಿರಿ →',
    'calc.header.title': 'ಸ್ಮಾರ್ಟ್ ಹಣಕಾಸು ಕ್ಯಾಲ್ಕುಲೇಟರ್‌ಗಳು',
    'calc.tab.emi': '🏠 EMI ಕ್ಯಾಲ್ಕುಲೇಟರ್', 'calc.tab.sip': '📈 SIP ಕ್ಯಾಲ್ಕುಲೇಟರ್', 'calc.tab.tax': '💰 ತೆರಿಗೆ ಉಳಿತಾಯ',
    'calc.emi.btn': 'EMI ಲೆಕ್ಕ ಹಾಕಿ →',
    'plan.header.title': 'ನಿಮ್ಮ ಹಣಕಾಸು ಜೀವನ ಯೋಜಕ',
    'plan.tab.goals': '🎯 ಗುರಿ ಯೋಜಕ', 'plan.tab.budget': '📊 ಬಜೆಟ್ ಬಿಲ್ಡರ್', 'plan.tab.emergency': '🛡️ ತುರ್ತು ನಿಧಿ', 'plan.tab.debt': '💳 ಸಾಲ ಮರುಪಾವತಿ', 'plan.tab.lifestage': '🌟 ಜೀವನ ಹಂತ ಮಾರ್ಗದರ್ಶಿ', 'plan.tab.networth': '💰 ನಿವ್ವಳ ಮೌಲ್ಯ',
    'plan.goal.home': 'ಮನೆ ಖರೀದಿಸಿ', 'plan.goal.education': 'ಮಕ್ಕಳ ಶಿಕ್ಷಣ', 'plan.goal.marriage': 'ವಿವಾಹ', 'plan.goal.retirement': 'ನಿವೃತ್ತಿ', 'plan.goal.vehicle': 'ವಾಹನ ಖರೀದಿಸಿ', 'plan.goal.travel': 'ಪ್ರಯಾಣ ನಿಧಿ', 'plan.goal.startup': 'ವ್ಯಾಪಾರ ಪ್ರಾರಂಭಿಸಿ', 'plan.goal.wealth': 'ಸಂಪತ್ತು ಸೃಷ್ಟಿ',
  };

  // ── Malayalam ──
  T.ml = {
    'nav.home': 'ഹോം', 'nav.calculators': 'അർത്ഥാകാൽക്', 'nav.planner': 'അർത്ഥാപ്ലാനർ', 'nav.guru': 'അർത്ഥാഗുരു', 'nav.pricing': 'വില', 'nav.login': 'ലോഗിൻ', 'nav.getstarted': 'സൗജന്യമായി ആരംഭിക്കുക',
    'hero.badge': '🇮🇳  അഭിമാനത്തോടെ ഇന്ത്യയിൽ നിർമ്മിച്ചത്  ·  DPIIT സ്റ്റാർട്ടപ്പ് ഇന്ത്യ',
    'hero.title': 'എല്ലാ ഇന്ത്യക്കാരനും<br><em>സ്മാർട്ട് മണി ഗൈഡൻസ്</em>',
    'hero.desc': 'ഇന്ത്യയുടെ ആദ്യ AI-പ്രവർത്തിത വ്യക്തിഗത ധനകാര്യ പ്ലാറ്റ്ഫോം — ബഹുഭാഷാ, നിഷ്പക്ഷ, ഭാരതത്തിനായി.',
    'hero.cta1': 'സൗജന്യ കാൽക്കുലേറ്ററുകൾ ശ്രമിക്കുക →', 'hero.cta2': 'എങ്ങനെ പ്രവർത്തിക്കുന്നു കാണുക',
    'modules.eyebrow': 'മൂന്ന് പ്രധാന മൊഡ്യൂളുകൾ', 'modules.title': 'സാമ്പത്തിക വ്യക്തതയ്ക്ക് എല്ലാം',
    'mod1.title': 'സ്മാർട്ട് കാൽക്കുലേറ്റർ സ്യൂട്ട്', 'mod1.cta': 'കാൽക്കുലേറ്ററുകൾ തുറക്കുക →', 'mod2.title': 'സാമ്പത്തിക ജീവിത പ്ലാനർ', 'mod2.cta': 'പ്ലാനർ തുറക്കുക →', 'mod3.title': 'നിക്ഷേപ വിദ്യാഭ്യാസ എഞ്ചിൻ', 'mod3.cta': 'അർത്ഥാഗുരു തുറക്കുക →',
    'calc.header.title': 'സ്മാർട്ട് സാമ്പത്തിക കാൽക്കുലേറ്ററുകൾ',
    'calc.tab.emi': '🏠 EMI കാൽക്കുലേറ്റർ', 'calc.tab.sip': '📈 SIP കാൽക്കുലേറ്റർ', 'calc.tab.tax': '💰 നികുതി ലാഭം',
    'calc.emi.btn': 'EMI കണക്കാക്കുക →',
    'plan.header.title': 'നിങ്ങളുടെ സാമ്പത്തിക ജീവിത പ്ലാനർ',
    'plan.tab.goals': '🎯 ലക്ഷ്യ പ്ലാനർ', 'plan.tab.budget': '📊 ബജറ്റ് ബിൽഡർ', 'plan.tab.emergency': '🛡️ അടിയന്തര ഫണ്ട്', 'plan.tab.debt': '💳 കടം തിരിച്ചടവ്', 'plan.tab.lifestage': '🌟 ജീവിത ഘട്ട ഗൈഡ്', 'plan.tab.networth': '💰 മൊത്ത മൂല്യം',
    'plan.goal.home': 'വീട് വാങ്ങുക', 'plan.goal.education': 'കുട്ടിയുടെ വിദ്യാഭ്യാസം', 'plan.goal.marriage': 'വിവാഹം', 'plan.goal.retirement': 'വിരമിക്കൽ', 'plan.goal.vehicle': 'വാഹനം വാങ്ങുക', 'plan.goal.travel': 'യാത്ര ഫണ്ട്', 'plan.goal.startup': 'ബിസിനസ്സ് ആരംഭിക്കുക', 'plan.goal.wealth': 'സമ്പത്ത് സൃഷ്ടി',
  };

  // ── Punjabi ──
  T.pa = {
    'nav.home': 'ਹੋਮ', 'nav.calculators': 'ਅਰਥਾਕੈਲਕ', 'nav.planner': 'ਅਰਥਾਪਲੈਨਰ', 'nav.guru': 'ਅਰਥਾਗੁਰੂ', 'nav.pricing': 'ਕੀਮਤ', 'nav.login': 'ਲੌਗਿਨ', 'nav.getstarted': 'ਮੁਫ਼ਤ ਸ਼ੁਰੂ ਕਰੋ',
    'hero.badge': '🇮🇳  ਮਾਣ ਨਾਲ ਭਾਰਤ ਵਿੱਚ ਬਣਿਆ  ·  DPIIT ਸਟਾਰਟਅੱਪ ਇੰਡੀਆ',
    'hero.title': 'ਹਰ ਭਾਰਤੀ ਲਈ<br><em>ਸਮਾਰਟ ਮਨੀ ਗਾਈਡੈਂਸ</em>',
    'hero.desc': 'ਭਾਰਤ ਦਾ ਪਹਿਲਾ AI-ਸੰਚਾਲਿਤ ਨਿੱਜੀ ਵਿੱਤ ਪਲੇਟਫਾਰਮ — ਬਹੁ-ਭਾਸ਼ਾਈ, ਨਿਰਪੱਖ, ਅਤੇ ਭਾਰਤ ਲਈ ਬਣਾਇਆ ਗਿਆ.',
    'hero.cta1': 'ਮੁਫ਼ਤ ਕੈਲਕੁਲੇਟਰ ਅਜ਼ਮਾਓ →', 'hero.cta2': 'ਕਿਵੇਂ ਕੰਮ ਕਰਦਾ ਹੈ ਵੇਖੋ',
    'calc.header.title': 'ਸਮਾਰਟ ਵਿੱਤੀ ਕੈਲਕੁਲੇਟਰ',
    'plan.header.title': 'ਤੁਹਾਡਾ ਵਿੱਤੀ ਜੀਵਨ ਯੋਜਨਾਕਾਰ',
  };

  // ── Odia ──
  T.or = {
    'nav.home': 'ହୋମ', 'nav.calculators': 'ଅର୍ଥାକ୍ୟାଲ୍କ', 'nav.planner': 'ଅର୍ଥାପ୍ଲାନର', 'nav.guru': 'ଅର୍ଥାଗୁରୁ', 'nav.pricing': 'ମୂଲ୍ୟ', 'nav.login': 'ଲଗଇନ', 'nav.getstarted': 'ମାଗଣାରେ ଆରମ୍ଭ କରନ୍ତୁ',
    'hero.badge': '🇮🇳  ଗର୍ବରେ ଭାରତରେ ତିଆରି  ·  DPIIT ଷ୍ଟାର୍ଟଅପ ଇଣ୍ଡିଆ',
    'hero.title': 'ପ୍ରତ୍ୟେକ ଭାରତୀୟ ପାଇଁ<br><em>ସ୍ମାର୍ଟ ମନି ଗାଇଡେନ୍ସ</em>',
    'calc.header.title': 'ସ୍ମାର୍ଟ ଆର୍ଥିକ କ୍ୟାଲକୁଲେଟର',
    'plan.header.title': 'ଆପଣଙ୍କ ଆର୍ଥିକ ଜୀବନ ପ୍ଲାନର',
  };

  // ── Urdu ──
  T.ur = {
    'nav.home': 'ہوم', 'nav.calculators': 'ارتھا کیلک', 'nav.planner': 'ارتھا پلینر', 'nav.guru': 'ارتھا گرو', 'nav.pricing': 'قیمت', 'nav.login': 'لاگ ان', 'nav.getstarted': 'مفت شروع کریں',
    'hero.badge': '🇮🇳  فخر سے بھارت میں بنا  ·  DPIIT اسٹارٹ اپ انڈیا',
    'hero.title': 'ہر ہندوستانی کے لیے<br><em>سمارٹ منی گائیڈنس</em>',
    'hero.desc': 'بھارت کا پہلا AI سے چلنے والا ذاتی مالیاتی پلیٹ فارم — کثیر لسانی، غیر جانبدار، اور بھارت کے لیے بنایا گیا.',
    'hero.cta1': 'مفت کیلکولیٹر آزمائیں →', 'hero.cta2': 'کیسے کام کرتا ہے دیکھیں',
    'calc.header.title': 'سمارٹ مالیاتی کیلکولیٹر',
    'plan.header.title': 'آپ کا مالیاتی زندگی پلینر',
  };

  // Remaining languages inherit from English with partial overrides
  ['as', 'sa', 'mai', 'kok', 'doi', 'bho', 'ne'].forEach(code => { T[code] = T[code] || {}; });

  /* ─────────────────────────────────────
     TRANSLATION ENGINE
     ───────────────────────────────────── */

  function translate(lang) {
    const dict = Object.assign({}, T.en, T[lang] || {});

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!dict[key]) return;

      const val = dict[key];
      // If the translation contains HTML tags, use innerHTML
      if (val.includes('<') && val.includes('>')) {
        el.innerHTML = val;
      } else {
        el.textContent = val;
      }
    });

    // Update html lang attribute
    document.documentElement.lang = lang === 'en' ? 'en' : lang;
  }

  // Expose globally
  window.arthaI18n = { translate, T };

  // Initial translation on page load
  function init() {
    const lang = (window.arthaLang && window.arthaLang.get()) || localStorage.getItem('arthaai-language') || 'en';
    translate(lang);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

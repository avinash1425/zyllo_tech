import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Code2,
  Database,
  Globe,
  Shield,
  Smartphone,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";

type Service = {
  id: string;
  icon: typeof Globe;
  title: string;
  category: "Engineering" | "Platform" | "Security";
  summary: string;
  outcomes: string[];
  deliverables: string[];
  technologies: string[];
  keywords: string[];
  faqs: { q: string; a: string }[];
};

const services: Service[] = [
  {
    id: "web-engineering",
    icon: Globe,
    title: "Website & Web Application Development",
    category: "Engineering",
    summary:
      "From high-conversion marketing sites to complex SaaS platforms and enterprise portals — we architect, build, and ship production-grade web applications that are fast, secure, and built to grow.",
    outcomes: [
      "Production-ready applications with clean architecture that your team can own and extend",
      "Sub-2s load times with optimized Core Web Vitals for better SEO and conversion",
      "Secure, scalable backends with proper authentication, authorization, and audit trails",
      "Full source code ownership, documentation, and zero vendor lock-in",
    ],
    deliverables: [
      "Discovery workshops: requirements, user flows, API contracts, and system design",
      "Frontend development: React / Next.js with TypeScript, accessibility (WCAG 2.1), and responsive design",
      "Backend APIs: REST or GraphQL with Node.js, Python, or Go — fully documented",
      "Database design, migrations, and query optimization (PostgreSQL / MySQL / MongoDB)",
      "CI/CD pipelines, staging environments, and automated deployment workflows",
      "Technical SEO: structured data, canonical URLs, sitemaps, and performance hardening",
      "Post-launch handover: source code, runbooks, credentials, and knowledge transfer",
    ],
    technologies: ["React", "Next.js", "TypeScript", "Node.js", "Python", "PostgreSQL", "Redis", "Docker", "Nginx", "Vercel / AWS"],
    keywords: ["website", "web", "frontend", "backend", "seo", "portal", "saas"],
    faqs: [
      {
        q: "Can you redesign our existing site without losing SEO rankings?",
        a: "Yes. We run a full SEO audit before migration — URL mapping, 301 redirect strategy, metadata parity, canonical tags, and Core Web Vitals benchmarking. We do pre/post comparison to ensure ranking continuity.",
      },
      {
        q: "Will we own the code and be able to maintain it ourselves?",
        a: "Absolutely. You get full source code ownership, clean documentation, and a structured handover. We also offer optional post-launch support if your internal team needs time to ramp up.",
      },
      {
        q: "Can you integrate with our existing CRM, ERP, or payment systems?",
        a: "Yes. We have experience integrating with Salesforce, HubSpot, SAP, Razorpay, Stripe, PayU, and most REST/SOAP APIs. We document all integration contracts clearly.",
      },
    ],
  },
  {
    id: "mobile-apps",
    icon: Smartphone,
    title: "Mobile App Development",
    category: "Engineering",
    summary:
      "iOS and Android applications built for real-world usage — with offline support, secure data handling, smooth performance, and production-grade release engineering from day one.",
    outcomes: [
      "Store-approved apps with clean UX that users actually retain and return to",
      "Crash-free rate above 99.5% with real-time monitoring and alerting in place",
      "Secure data storage, biometric authentication, and encrypted communications",
      "Automated release pipelines reducing deployment effort and human error",
    ],
    deliverables: [
      "Product discovery: user personas, feature scope, technical constraints, and API design",
      "UI/UX wireframes and interactive prototypes for stakeholder sign-off before build",
      "Cross-platform development with React Native or native iOS (Swift) / Android (Kotlin)",
      "Push notifications, offline-first architecture, background sync, and deep linking",
      "Third-party integrations: maps, payments, analytics, camera, biometrics, and more",
      "App Store (Apple) and Google Play submission, review handling, and release notes",
      "Crash monitoring (Sentry / Firebase Crashlytics), analytics, and post-launch support",
    ],
    technologies: ["React Native", "Swift", "Kotlin", "Expo", "Firebase", "Fastlane", "Sentry", "Zustand", "SQLite", "Push Notifications"],
    keywords: ["mobile", "ios", "android", "app", "react native", "swift", "kotlin"],
    faqs: [
      {
        q: "Should we choose native (Swift/Kotlin) or cross-platform (React Native)?",
        a: "We recommend native for apps that require deep device APIs, complex animations, or hardware-level performance. React Native is excellent for most business apps — it cuts build time significantly while delivering near-native UX. We assess your specific needs and recommend accordingly.",
      },
      {
        q: "Can you rebuild or modernize our existing app without disrupting current users?",
        a: "Yes. We use feature flags, phased rollouts, and backward-compatible API versioning so existing users see no disruption. We also run parallel environments during migration for safety.",
      },
      {
        q: "How do you handle app security for enterprise use cases?",
        a: "We implement certificate pinning, encrypted local storage, jailbreak/root detection, secure token handling, and OWASP Mobile Top 10 controls — essential for finance, healthcare, and enterprise apps.",
      },
    ],
  },
  {
    id: "cloud-platform",
    icon: Cloud,
    title: "Cloud Solutions & DevOps",
    category: "Platform",
    summary:
      "Cloud architecture, migration, and DevOps engineering — from greenfield infrastructure to legacy modernization — with a focus on resilience, security, and right-sized costs.",
    outcomes: [
      "Deployment frequency increases from weeks to hours with zero-downtime pipelines",
      "Infrastructure cost reduction through right-sizing, reserved instances, and waste elimination",
      "99.9%+ uptime with multi-AZ deployments, auto-scaling, and automated failover",
      "Full audit trail with IaC — every infrastructure change tracked, reviewed, and reproducible",
    ],
    deliverables: [
      "Cloud readiness assessment: current state audit, migration risks, and TCO comparison",
      "Architecture design: multi-region, high-availability, and disaster recovery planning",
      "Infrastructure as Code: Terraform / Pulumi for AWS, Azure, or GCP — fully version controlled",
      "CI/CD pipelines: GitHub Actions / GitLab CI with build, test, security scan, and deploy stages",
      "Container orchestration: Kubernetes (EKS / AKS / GKE) with autoscaling and resource policies",
      "Observability stack: centralized logging (ELK / CloudWatch), APM, dashboards, and on-call alerting",
      "Cost optimization reports, security hardening, and monthly platform health reviews",
    ],
    technologies: ["AWS", "Azure", "GCP", "Terraform", "Kubernetes", "Docker", "GitHub Actions", "Helm", "Prometheus", "Grafana"],
    keywords: ["cloud", "devops", "aws", "azure", "gcp", "migration", "infra"],
    faqs: [
      {
        q: "Can you migrate our on-premise or legacy systems to cloud with minimal risk?",
        a: "Yes. We use the Strangler Fig pattern for gradual migrations, define rollback paths at every wave, run parallel environments during cutover, and validate post-migration performance against pre-defined baselines.",
      },
      {
        q: "We have no in-house DevOps. Can you set up everything from scratch?",
        a: "Yes. We've built cloud platforms from zero for multiple companies. We set up the full stack — environments, CI/CD, secrets management, monitoring, and runbooks — and can train your team to own it afterward.",
      },
      {
        q: "How do you control cloud costs from getting out of hand?",
        a: "We implement tagging policies, budget alerts, and rightsizing from day one. We also run monthly cost reviews, identify waste (idle resources, over-provisioned instances), and apply savings plans and reserved instances where appropriate.",
      },
    ],
  },
  {
    id: "cybersecurity",
    icon: Shield,
    title: "Cybersecurity Engineering",
    category: "Security",
    summary:
      "End-to-end security engineering — from threat modeling and code-level vulnerability assessment to compliance alignment and secure SDLC integration — so security is built in, not bolted on.",
    outcomes: [
      "Identified and remediated critical vulnerabilities before they reach production",
      "Security controls embedded in CI/CD so every release is automatically validated",
      "Compliance-ready posture aligned with OWASP, ISO 27001, SOC 2, GDPR, or PCI DSS requirements",
      "Engineering teams trained and equipped with secure coding standards and checklists",
    ],
    deliverables: [
      "Threat modeling: STRIDE/DREAD analysis, attack surface mapping, and trust boundary review",
      "Vulnerability assessment: SAST (static), DAST (dynamic), SCA (dependencies), and secrets scanning",
      "Penetration testing: web apps, APIs, mobile apps, and internal network surfaces",
      "Security architecture review: authentication, authorization, encryption, and data handling",
      "Secure SDLC integration: security gates in CI pipelines, pre-commit hooks, and branch policies",
      "Compliance gap analysis and remediation roadmap for ISO 27001, SOC 2, GDPR, PCI DSS",
      "Security awareness training and secure coding guidelines for development teams",
    ],
    technologies: ["OWASP ASVS", "NIST CSF", "Burp Suite", "SonarQube", "Snyk", "Trivy", "WAF", "SIEM", "Zero Trust", "Vault"],
    keywords: ["security", "cyber", "vulnerability", "compliance", "owasp", "nist", "penetration testing"],
    faqs: [
      {
        q: "Do you only assess security, or do you fix vulnerabilities too?",
        a: "We do both. After assessment, we prioritize findings by risk severity, work directly with your engineering team to remediate, and then verify fixes. You get a clear before/after security posture report.",
      },
      {
        q: "Can security engineering be added without slowing down our release cycles?",
        a: "Yes. We integrate lightweight, automated security checks into your CI/CD pipeline — SAST, SCA, and secrets scanning run in under 5 minutes on most codebases. Critical-only blocking gates ensure speed isn't sacrificed.",
      },
      {
        q: "We need to be ISO 27001 or SOC 2 compliant. Can you help?",
        a: "Yes. We run a gap analysis against the target framework, map your current controls, identify gaps, and build a remediation roadmap with clear ownership. We also help prepare evidence for auditor review.",
      },
    ],
  },
  {
    id: "qa-testing",
    icon: Workflow,
    title: "Quality Engineering & Test Automation",
    category: "Engineering",
    summary:
      "Comprehensive quality engineering across web, mobile, API, and performance — with automated test suites, CI-integrated quality gates, and shift-left practices that catch defects before they reach users.",
    outcomes: [
      "Up to 70% reduction in production defects with automated regression coverage",
      "Release confidence with full test reports, traceability, and coverage metrics",
      "API and UI test suites that run in CI — no manual regression before every release",
      "Performance baselines established so degradation is caught before go-live",
    ],
    deliverables: [
      "QA strategy document: test scope, coverage targets, environments, and tooling decisions",
      "Test case design: functional, edge case, negative, and acceptance criteria per feature",
      "UI automation: end-to-end test suites with Playwright or Cypress across browsers and viewports",
      "API testing: contract testing, schema validation, auth flows, and edge case coverage (Postman / REST Assured)",
      "Performance & load testing: baseline benchmarks, load profiles, and bottleneck identification (k6 / JMeter)",
      "CI/CD integration: automated test runs on pull requests with pass/fail gates and HTML reports",
      "Mobile testing: device matrix coverage using real devices and emulators (iOS + Android)",
    ],
    technologies: ["Playwright", "Cypress", "Postman", "k6", "Jest", "Selenium", "Appium", "JMeter", "Allure Reports", "GitHub Actions"],
    keywords: ["qa", "testing", "automation", "regression", "performance", "quality"],
    faqs: [
      {
        q: "Our product has no tests at all. Where do you start?",
        a: "We start with a risk-based prioritization — critical user journeys, payment flows, and auth paths first. We build a test harness, write foundational automation, integrate it into CI, and then expand coverage sprint by sprint.",
      },
      {
        q: "Can you embed a QA engineer within our existing development team?",
        a: "Yes. We provide dedicated QA engineers who work inside your sprint cycle — reviewing stories, writing tests alongside developers, and owning quality metrics. They align with your tools, rituals, and release cadence.",
      },
      {
        q: "How do you handle testing for mobile apps across many device types?",
        a: "We build a device matrix based on your user analytics (top OS versions and screen sizes), then run automated tests using Appium on real device clouds (BrowserStack / AWS Device Farm) to ensure consistent behavior.",
      },
    ],
  },
  {
    id: "support-maintenance",
    icon: Wrench,
    title: "Application Support & Maintenance",
    category: "Platform",
    summary:
      "Reliable post-launch support with defined SLAs, proactive monitoring, dependency upgrades, and continuous improvement — so your application stays healthy, secure, and aligned with your business as it evolves.",
    outcomes: [
      "Defined SLA tiers with guaranteed response and resolution times you can hold us to",
      "Zero critical security vulnerabilities left unpatched beyond agreed windows",
      "Proactive identification and resolution of issues before they impact end users",
      "Gradual technical debt reduction with planned improvement sprints each quarter",
    ],
    deliverables: [
      "System onboarding audit: architecture review, dependency mapping, and risk register",
      "Monitoring setup: uptime, error rate, latency, and business KPI dashboards",
      "Incident management: triage, root cause analysis, fix, and post-mortem documentation",
      "Security patching: CVE tracking, dependency upgrades, and OS-level patch management",
      "Scheduled maintenance windows: database tuning, cache optimization, and storage cleanup",
      "Monthly health reports: incidents summary, performance trends, and recommended improvements",
      "Enhancement backlog: small feature requests and UX improvements handled within support plans",
    ],
    technologies: ["PagerDuty", "Datadog", "Sentry", "Grafana", "New Relic", "Uptime Robot", "GitHub", "Jira", "Dependabot", "Runbooks"],
    keywords: ["support", "maintenance", "bug fix", "upgrade", "incident", "sla"],
    faqs: [
      {
        q: "We're currently with another vendor. Can you take over support smoothly?",
        a: "Yes. We run a structured 4-week transition: system audit, documentation review, access handover, monitoring setup, and a stabilization period before we assume full SLA responsibility. No disruption to your users.",
      },
      {
        q: "What SLA tiers do you offer?",
        a: "We offer Standard (8×5, 4-hour response for critical), Business (16×5, 2-hour), and Enterprise (24×7, 30-minute response for P1) tiers — customized based on your business criticality and budget.",
      },
      {
        q: "Can the support plan include new feature development too?",
        a: "Yes. We offer hybrid plans that combine support hours with enhancement sprints — so your product keeps improving while staying stable. Enhancement scope is agreed monthly based on priority.",
      },
    ],
  },
  {
    id: "data-ai",
    icon: Database,
    title: "Data Engineering & Applied AI",
    category: "Platform",
    summary:
      "From raw data pipelines to production AI features — we help businesses build reliable data infrastructure, actionable analytics, and targeted AI capabilities that create measurable operational value.",
    outcomes: [
      "Single source of truth for business data — no more conflicting spreadsheet reports",
      "Real-time and batch pipelines that deliver clean, trusted data to downstream systems",
      "AI features in production: document intelligence, recommendation engines, forecasting, or RAG chatbots",
      "Data teams and business stakeholders aligned with self-serve BI dashboards and clear KPI definitions",
    ],
    deliverables: [
      "Data architecture design: source systems mapping, warehouse schema, and data flow diagrams",
      "ELT/ETL pipelines: ingestion from APIs, databases, files, and SaaS tools (Fivetran / Airbyte / custom)",
      "Data transformation and modeling with dbt — tested, documented, version-controlled",
      "BI dashboards and reporting: Metabase, Looker, Power BI, or Superset — role-based access",
      "Applied AI implementation: RAG pipelines, document extraction, classification, or prediction models",
      "MLOps setup: model versioning, evaluation, deployment, and drift monitoring",
      "Data governance: lineage, cataloging, PII handling, and access control policies",
    ],
    technologies: ["Python", "dbt", "Apache Airflow", "BigQuery", "Snowflake", "PostgreSQL", "LangChain", "OpenAI / Gemini APIs", "Spark", "Metabase"],
    keywords: ["data", "analytics", "dashboard", "etl", "ai", "automation", "machine learning", "llm", "rag"],
    faqs: [
      {
        q: "We have data scattered across many tools. Where do you start?",
        a: "We start with a data audit — identifying all sources, volumes, quality issues, and business questions that need answering. Then we design a warehouse schema and build pipelines in priority order, delivering usable dashboards early in the engagement.",
      },
      {
        q: "Can you build AI features that work securely with our proprietary business data?",
        a: "Yes. We implement RAG (Retrieval Augmented Generation) architectures where your data stays in your own infrastructure. We use strict access controls, no data training sharing with model providers, and audit logs for all AI interactions.",
      },
      {
        q: "How do you ensure AI outputs are reliable enough for business decisions?",
        a: "We build evaluation frameworks — automated output testing, confidence thresholds, human-in-the-loop checkpoints, and fallback logic. We never ship AI features without measurable accuracy baselines and monitoring in place.",
      },
    ],
  },
  {
    id: "dedicated-team",
    icon: Code2,
    title: "Dedicated Teams & Product Delivery",
    category: "Engineering",
    summary:
      "Dedicated engineering squads that work as an extension of your team — fully integrated into your processes, accountable to your roadmap, and committed to long-term product quality.",
    outcomes: [
      "Faster roadmap execution with an experienced, immediately productive team",
      "Full IP ownership and code escrow — everything your team builds belongs to you",
      "Transparent delivery with sprint reviews, velocity metrics, and risk visibility",
      "Significantly lower hiring cost compared to building an equivalent in-house team",
    ],
    deliverables: [
      "Team composition: frontend, backend, mobile, QA, DevOps, or full-stack — based on your needs",
      "Onboarding: codebase review, architecture walkthrough, tooling setup, and first sprint within 2 weeks",
      "Agile ceremonies: sprint planning, daily standups, retrospectives, and demo sessions with your stakeholders",
      "Delivery governance: Definition of Done, branch policies, code review standards, and release checklists",
      "Weekly and monthly reporting: velocity trends, blockers, risks, and roadmap progress",
      "Knowledge transfer: living documentation, architecture decision records (ADRs), and runbooks",
      "NDA, IP assignment agreements, and background verification for all team members",
    ],
    technologies: ["Agile / Scrum", "Jira / Linear", "GitHub / GitLab", "Slack / Teams", "CI/CD", "Figma", "Notion", "Code Review", "ADRs"],
    keywords: ["dedicated team", "augmentation", "squad", "delivery", "engineering", "staff augmentation", "outsourcing"],
    faqs: [
      {
        q: "Can we start with a small team and scale up as the product grows?",
        a: "Yes. Teams are modular — you can start with 2 engineers and expand by role or domain as your roadmap grows. Scale-up usually takes 1–2 weeks per additional engineer since our onboarding is structured.",
      },
      {
        q: "Who owns the intellectual property and code written by your team?",
        a: "You do — 100%. All work is covered by IP assignment agreements. We sign NDAs before any engagement starts, and code is committed to your repositories throughout, not held by us.",
      },
      {
        q: "How do you ensure quality when engineers are remote?",
        a: "We enforce mandatory peer code reviews on every PR, maintain a Definition of Done with clear quality criteria, run automated test and lint gates in CI, and conduct bi-weekly architecture reviews to prevent drift.",
      },
    ],
  },
];

const bestPracticePillars = [
  {
    title: "Architecture First",
    desc: "We define system design, integration contracts, and non-functional requirements before writing a single line of code — preventing costly rework later.",
  },
  {
    title: "Secure by Design",
    desc: "Security is embedded at every stage — threat modeling in design, SAST/SCA in CI, OWASP controls in code, and penetration testing before major releases.",
  },
  {
    title: "Automated Quality Gates",
    desc: "Every pull request triggers automated linting, unit tests, integration tests, and coverage checks. Nothing ships without passing defined quality thresholds.",
  },
  {
    title: "Full Observability",
    desc: "We instrument every system with structured logging, distributed tracing, and business-level metrics — so issues are detected and resolved before users notice.",
  },
];

const categories: Array<"All" | Service["category"]> = ["All", "Engineering", "Platform", "Security"];

const servicesFaqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    { "@type": "Question", name: "What software development services does Zyllo Tech offer?", acceptedAnswer: { "@type": "Answer", text: "Zyllo Tech offers web & mobile app development, cloud DevOps, data engineering & AI/ML, cybersecurity engineering, quality assurance & test automation, and dedicated engineering teams." } },
    { "@type": "Question", name: "Does Zyllo Tech work with startups and enterprises?", acceptedAnswer: { "@type": "Answer", text: "Yes. We work with early-stage startups, scale-ups, and large enterprises across India, USA, UAE, UK, Singapore, and other countries." } },
    { "@type": "Question", name: "What technologies does Zyllo Tech use?", acceptedAnswer: { "@type": "Answer", text: "We use React, Next.js, Node.js, Python, React Native, AWS, Azure, GCP, Kubernetes, Terraform, PostgreSQL, dbt, Snowflake, and more depending on project requirements." } },
    { "@type": "Question", name: "How does Zyllo Tech ensure software quality?", acceptedAnswer: { "@type": "Answer", text: "We use automated testing (Playwright, Cypress, k6), CI/CD pipelines with quality gates, OWASP security scanning, and code reviews on every pull request." } },
  ],
};

import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const ServicesPage = () => {
  const [selectedCategory, setSelectedCategory] = useState<"All" | Service["category"]>("All");
  const [activeService, setActiveService] = useState<Service | null>(null);

  const filteredServices = useMemo(() => {
    if (selectedCategory === "All") return services;
    return services.filter((service) => service.category === selectedCategory);
  }, [selectedCategory]);

  const openServiceModal = (service: Service) => {
    setActiveService(service);
  };

  const closeServiceModal = () => {
    setActiveService(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Software Development Services | Web, Mobile, Cloud, AI & Cybersecurity | Zyllo Tech"
        description="Zyllo Tech offers end-to-end software engineering services — web & mobile app development, cloud DevOps, data & AI engineering, cybersecurity, QA automation, and dedicated teams for enterprises in India and globally."
        canonical="/services"
        keywords="software development services India, web development company India, mobile app development, cloud DevOps services, AI ML development, cybersecurity services India, QA testing automation, dedicated development team India"
        structuredData={[
          servicesFaqSchema,
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Services", url: `${SITE_URL}/services` },
          ]),
        ]}
      />
      <Navbar />
      <PageHero
        title="Software"
        highlight="Services"
        description="Website development, mobile apps, cloud platforms, cybersecurity, and end-to-end product engineering services."
        breadcrumb="Services"
      />

      <section className="py-12 border-b border-border/70">
        <div className="container mx-auto px-6">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`rounded-full border px-4 py-1.5 text-xs transition-colors ${
                  selectedCategory === category
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {filteredServices.map((service, i) => (
              <motion.article
                key={service.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.04 }}
                className="rounded-xl border border-border bg-background p-6 transition-all duration-300 hover:border-primary/40 hover:shadow-md"
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <service.icon size={24} />
                </div>
                <div className="mb-2 inline-flex rounded-full border border-border px-2.5 py-0.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {service.category}
                </div>
                <h3 className="font-display text-xl font-semibold text-foreground">{service.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{service.summary}</p>

                <button
                  onClick={() => openServiceModal(service)}
                  className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80"
                >
                  View scope <ArrowRight size={14} />
                </button>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted/50">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <span className="text-xs font-medium uppercase tracking-widest text-primary">
              Best Practices
            </span>
            <h2 className="mt-3 font-display text-4xl md:text-5xl font-bold text-foreground">
              Engineering Standards We Follow
            </h2>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {bestPracticePillars.map((pillar, i) => (
              <motion.div
                key={pillar.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="rounded-xl border border-border bg-background p-6"
              >
                <h3 className="font-display text-lg font-semibold text-foreground">{pillar.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{pillar.desc}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 justify-center">
            <Link
              to="/contact"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Discuss Your Requirement
            </Link>
            <Link
              to="/portfolio"
              className="inline-flex items-center justify-center rounded-lg border border-border px-5 py-3 text-sm font-medium text-foreground hover:border-primary/40"
            >
              Explore Case Studies
            </Link>
          </div>
        </div>
      </section>

      <AnimatePresence>
        {activeService && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50"
              onClick={closeServiceModal}
            />

            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="relative z-10 w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-primary">Service Scope</p>
                  <h3 className="mt-1 font-display text-2xl font-bold text-foreground">
                    {activeService.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">{activeService.summary}</p>
                </div>
                <button
                  onClick={closeServiceModal}
                  className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground"
                  aria-label="Close service details"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground">Business Outcomes</h4>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {activeService.outcomes.map((outcome) => (
                      <li key={outcome} className="flex items-start gap-2">
                        <CheckCircle2 size={14} className="mt-0.5 text-primary shrink-0" />
                        <span>{outcome}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground">Delivery Scope</h4>
                  <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                    {activeService.deliverables.map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-border p-4">
                <h4 className="text-sm font-semibold text-foreground">Typical Technology Stack</h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {activeService.technologies.map((tech) => (
                    <span
                      key={tech}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default ServicesPage;

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Code2,
  Database,
  Globe,
  Search,
  Shield,
  Smartphone,
  Sparkles,
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
      "Marketing websites, customer portals, and SaaS applications built for speed, SEO, accessibility, and maintainable growth.",
    outcomes: [
      "Faster launch cycles with reusable architecture",
      "High-performance UX for conversion and retention",
      "Clean analytics events for product and growth decisions",
    ],
    deliverables: [
      "Discovery, UX flows, and solution architecture",
      "Frontend and backend implementation with CI/CD",
      "Technical SEO, schema, and performance hardening",
    ],
    technologies: ["React", "Next.js", "TypeScript", "Node.js", "PostgreSQL"],
    keywords: ["website", "web", "frontend", "backend", "seo", "portal", "saas"],
    faqs: [
      {
        q: "Can you redesign our existing site without losing SEO?",
        a: "Yes. We run URL mapping, redirect strategy, metadata parity, and Core Web Vitals checks before launch.",
      },
      {
        q: "Do you build admin panels and customer dashboards too?",
        a: "Yes. We design role-based dashboards, reporting views, and workflow-driven admin operations.",
      },
    ],
  },
  {
    id: "mobile-apps",
    icon: Smartphone,
    title: "Mobile App Development",
    category: "Engineering",
    summary:
      "iOS and Android apps with production-ready release engineering, app security, offline support, and observability.",
    outcomes: [
      "Reliable releases with crash and performance monitoring",
      "Better user retention with fast, intuitive flows",
      "Scalable integrations with existing business systems",
    ],
    deliverables: [
      "Product discovery and app architecture",
      "Native or cross-platform development",
      "Store submission, release automation, and support",
    ],
    technologies: ["React Native", "Swift", "Kotlin", "Firebase", "Fastlane"],
    keywords: ["mobile", "ios", "android", "app", "react native", "swift", "kotlin"],
    faqs: [
      {
        q: "Should we choose native or cross-platform?",
        a: "We recommend based on required performance, device APIs, roadmap speed, and maintenance costs.",
      },
      {
        q: "Can you modernize our app without downtime for users?",
        a: "Yes. We use phased rollout, feature flags, and backward-compatible APIs for safer migration.",
      },
    ],
  },
  {
    id: "cloud-platform",
    icon: Cloud,
    title: "Cloud Solutions & DevOps",
    category: "Platform",
    summary:
      "Cloud architecture, migration, CI/CD, observability, and SRE support for resilient and cost-aware operations.",
    outcomes: [
      "Reduced outage risk through resilient architecture patterns",
      "Faster deployments through automated delivery pipelines",
      "Better cost control with usage visibility and optimization",
    ],
    deliverables: [
      "Cloud readiness assessment and migration blueprint",
      "Infrastructure as Code and deployment automation",
      "Monitoring, alerting, and incident response playbooks",
    ],
    technologies: ["AWS", "Azure", "GCP", "Terraform", "Kubernetes"],
    keywords: ["cloud", "devops", "aws", "azure", "gcp", "migration", "infra"],
    faqs: [
      {
        q: "Can you migrate legacy systems to cloud with low risk?",
        a: "Yes. We use phased migration waves, rollback paths, and pre/post cutover validation.",
      },
      {
        q: "Do you also provide ongoing cloud management?",
        a: "Yes. We support ongoing patching, incident handling, optimization, and platform reliability.",
      },
    ],
  },
  {
    id: "cybersecurity",
    icon: Shield,
    title: "Cybersecurity Engineering",
    category: "Security",
    summary:
      "Security assessments, secure SDLC controls, vulnerability remediation, and compliance-ready implementation support.",
    outcomes: [
      "Lower security risk via prioritized remediation roadmaps",
      "Stronger delivery controls across code, infra, and operations",
      "Higher enterprise trust with framework-aligned practices",
    ],
    deliverables: [
      "Threat modeling and security posture baseline",
      "SAST/DAST integration and remediation management",
      "Security standards aligned with OWASP and NIST practices",
    ],
    technologies: ["OWASP ASVS", "NIST CSF", "SIEM", "WAF", "Zero Trust"],
    keywords: ["security", "cyber", "vulnerability", "compliance", "owasp", "nist"],
    faqs: [
      {
        q: "Do you only audit, or do you fix vulnerabilities too?",
        a: "We do both: assessment, prioritization, remediation, and verification with your engineering teams.",
      },
      {
        q: "Can security be added without slowing releases?",
        a: "Yes. We implement security checks directly in CI/CD with risk-based gates.",
      },
    ],
  },
  {
    id: "qa-testing",
    icon: Workflow,
    title: "Quality Engineering & Test Automation",
    category: "Engineering",
    summary:
      "Automated and manual testing strategy across web, mobile, API, performance, and regression quality gates.",
    outcomes: [
      "Lower production defects and better release confidence",
      "Faster test cycles through automation",
      "Improved user experience stability across devices",
    ],
    deliverables: [
      "QA strategy and acceptance criteria framework",
      "Automated test suites and regression pipelines",
      "Performance and reliability benchmarking",
    ],
    technologies: ["Playwright", "Cypress", "Postman", "k6", "Jest"],
    keywords: ["qa", "testing", "automation", "regression", "performance", "quality"],
    faqs: [
      {
        q: "Can you build QA automation for an existing product?",
        a: "Yes. We start from critical user flows, build coverage, and integrate tests into CI pipelines.",
      },
      {
        q: "Do you support performance and load testing?",
        a: "Yes. We benchmark system behavior under load and produce optimization recommendations.",
      },
    ],
  },
  {
    id: "support-maintenance",
    icon: Wrench,
    title: "Application Support & Maintenance",
    category: "Platform",
    summary:
      "Post-launch maintenance, incident management, version upgrades, and continuous optimization for business continuity.",
    outcomes: [
      "Stable systems with proactive issue prevention",
      "Faster issue resolution with clear SLAs",
      "Continuous technical debt reduction over time",
    ],
    deliverables: [
      "Runbook-driven support operations",
      "Security patching and dependency upgrades",
      "Monthly health reports and improvement backlog",
    ],
    technologies: ["SLA/SLO", "Monitoring", "Incident Ops", "Patch Mgmt", "Runbooks"],
    keywords: ["support", "maintenance", "bug fix", "upgrade", "incident", "sla"],
    faqs: [
      {
        q: "Can you take over support from another vendor?",
        a: "Yes. We run a structured transition with system audit, documentation, and stabilization phases.",
      },
      {
        q: "Do you provide planned enhancement support too?",
        a: "Yes. Support plans can include small feature releases and optimization work.",
      },
    ],
  },
  {
    id: "data-ai",
    icon: Database,
    title: "Data Engineering & Applied AI",
    category: "Platform",
    summary:
      "Data pipelines, BI dashboards, and targeted AI use cases that improve decision-making and operational efficiency.",
    outcomes: [
      "Trusted business reporting and KPI visibility",
      "Automation of repetitive workflows",
      "Faster and more consistent operational decisions",
    ],
    deliverables: [
      "Data architecture and pipeline implementation",
      "Dashboarding and analytics model setup",
      "Applied AI feature prototyping with measurable KPIs",
    ],
    technologies: ["dbt", "BigQuery", "Snowflake", "Python", "LLM APIs"],
    keywords: ["data", "analytics", "dashboard", "etl", "ai", "automation"],
    faqs: [
      {
        q: "Can AI features be implemented securely for enterprise data?",
        a: "Yes. We define strict access control, data boundaries, and provider-level safeguards.",
      },
      {
        q: "How quickly can we get useful dashboards?",
        a: "Initial KPI dashboards can be delivered quickly, then expanded in phases.",
      },
    ],
  },
  {
    id: "dedicated-team",
    icon: Code2,
    title: "Dedicated Teams & Product Delivery",
    category: "Engineering",
    summary:
      "Dedicated engineering squads integrated with your team to accelerate roadmap delivery while preserving quality.",
    outcomes: [
      "Faster sprint throughput and predictable releases",
      "Stronger engineering governance with shared standards",
      "Smoother collaboration across internal and external teams",
    ],
    deliverables: [
      "Team structure and delivery governance model",
      "Sprint execution with transparent reporting",
      "Knowledge transfer and scale-up plan",
    ],
    technologies: ["Agile", "Jira", "GitHub", "CI/CD", "Code Review"],
    keywords: ["dedicated team", "augmentation", "squad", "delivery", "engineering"],
    faqs: [
      {
        q: "Can we start with a small team and scale later?",
        a: "Yes. The model is modular and scales by capability, domain, or delivery phase.",
      },
      {
        q: "How do you maintain engineering quality in distributed teams?",
        a: "We enforce standards, mandatory reviews, testing gates, and release criteria.",
      },
    ],
  },
];

const bestPracticePillars = [
  {
    title: "Architecture First",
    desc: "Clear architecture decisions, integration boundaries, and non-functional requirements before build.",
  },
  {
    title: "Secure SDLC",
    desc: "Security requirements and checks integrated in backlog, coding, testing, and release workflows.",
  },
  {
    title: "Quality Gates",
    desc: "Automated validation for code quality, test coverage, and release readiness on every change.",
  },
  {
    title: "Observability",
    desc: "Metrics, logs, traces, and alerting with clear ownership for rapid incident response.",
  },
];

const categories: Array<"All" | Service["category"]> = ["All", "Engineering", "Platform", "Security"];

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
      <Navbar />
      <PageHero
        title="Software"
        highlight="Services"
        description="Website development, mobile apps, cloud platforms, cybersecurity, and end-to-end product engineering services."
        breadcrumb="Services"
      />

      <section className="py-12 border-b border-border/70">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-[0_14px_44px_hsl(215_35%_18%_/_0.12)]"
          >
            <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(24,95%,50%)] to-[hsl(195,55%,42%)] text-white">
                  <Sparkles size={17} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Zyllo AI Service Guide</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Describe your goal and get the right service path instantly.
                  </p>
                </div>
              </div>
              <button
                onClick={() => window.dispatchEvent(new Event("open-ai-search"))}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[hsl(24,95%,50%)] to-[hsl(195,55%,42%)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
              >
                <Search size={15} /> Search with AI
              </button>
            </div>
            <div className="h-1.5 bg-gradient-to-r from-[hsl(24,95%,50%)] via-[hsl(195,55%,42%)] to-[hsl(24,95%,50%)]" />
          </motion.div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
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

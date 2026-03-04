import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Cloud,
  Code2,
  Database,
  Globe,
  Search,
  Shield,
  Smartphone,
  Sparkles,
  Workflow,
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
      "Conversion-focused marketing websites, portals, and SaaS products with performance, accessibility, and SEO built-in from day one.",
    outcomes: [
      "Faster launch cycles with reusable frontend and backend modules",
      "High Lighthouse and Core Web Vitals targets for public pages",
      "Clean analytics instrumentation for growth and product decisions",
    ],
    deliverables: [
      "Information architecture, UX flows, and production-ready UI",
      "Full-stack implementation with QA automation and CI/CD",
      "Technical SEO setup, schema, and performance optimization",
    ],
    technologies: ["React", "Next.js", "Node.js", "TypeScript", "PostgreSQL"],
    keywords: ["website", "web", "frontend", "backend", "seo", "landing", "portal", "saas"],
    faqs: [
      {
        q: "Can you redesign and rebuild an existing website without hurting SEO?",
        a: "Yes. We run a migration map for URLs, metadata, schema, redirects, and Core Web Vitals to preserve and improve search visibility.",
      },
      {
        q: "Do you support multilingual and multi-region websites?",
        a: "Yes. We implement internationalization, localized content models, and region-specific performance and compliance requirements.",
      },
    ],
  },
  {
    id: "mobile-apps",
    icon: Smartphone,
    title: "Mobile App Development",
    category: "Engineering",
    summary:
      "Native and cross-platform mobile products for iOS and Android with production observability, secure auth, and release governance.",
    outcomes: [
      "Improved retention through user-centered flows and performance tuning",
      "Reliable releases using staged rollout, crash monitoring, and QA gates",
      "Scalable backend integration with offline-friendly app behavior",
    ],
    deliverables: [
      "Product discovery, app architecture, and UX prototypes",
      "iOS/Android development with API integration and test automation",
      "App Store and Play Store release pipeline with monitoring",
    ],
    technologies: ["React Native", "Swift", "Kotlin", "Firebase", "Fastlane"],
    keywords: ["mobile", "ios", "android", "app", "cross-platform", "react native", "swift", "kotlin"],
    faqs: [
      {
        q: "Should we build native or cross-platform?",
        a: "We recommend based on product complexity, expected scale, device-level features, and release velocity requirements.",
      },
      {
        q: "Can you modernize our old app while users stay active?",
        a: "Yes. We use phased rollouts, feature flags, and backward-compatible APIs to reduce migration risk.",
      },
    ],
  },
  {
    id: "cloud-solutions",
    icon: Cloud,
    title: "Cloud Solutions & DevOps",
    category: "Platform",
    summary:
      "Cloud architecture, migration, and operations with security, resilience, and cost controls aligned to modern Well-Architected practices.",
    outcomes: [
      "Lower downtime risk through resilient architecture patterns",
      "Faster engineering throughput with automated pipelines",
      "Cost visibility and optimization with right-sized infrastructure",
    ],
    deliverables: [
      "Cloud readiness assessment and target architecture",
      "Infrastructure as Code, CI/CD, observability, and SRE runbooks",
      "Migration execution plan and post-go-live optimization",
    ],
    technologies: ["AWS", "Azure", "GCP", "Terraform", "Kubernetes"],
    keywords: ["cloud", "devops", "aws", "azure", "gcp", "migration", "kubernetes", "infra"],
    faqs: [
      {
        q: "Can you migrate from on-prem or legacy servers to cloud safely?",
        a: "Yes. We define migration waves, rollback paths, and SLO/SLA checkpoints for each workload.",
      },
      {
        q: "Do you provide ongoing managed cloud operations?",
        a: "Yes. We can run monthly operations, incident response, security patching, and cost optimization.",
      },
    ],
  },
  {
    id: "cyber-security",
    icon: Shield,
    title: "Cybersecurity Engineering",
    category: "Security",
    summary:
      "Application and cloud security services including threat modeling, secure SDLC, vulnerability management, and compliance readiness.",
    outcomes: [
      "Reduced security risk through prioritized remediation roadmaps",
      "Faster security response with monitoring and incident workflows",
      "Stronger trust posture for enterprise and regulated clients",
    ],
    deliverables: [
      "Security posture assessment and risk register",
      "Secure coding practices, SAST/DAST integration, and pen-test support",
      "Policies and controls aligned to recognized frameworks",
    ],
    technologies: ["OWASP ASVS", "NIST CSF", "SIEM", "WAF", "Zero Trust"],
    keywords: ["security", "cyber", "pentest", "vulnerability", "compliance", "owasp", "nist", "soc2"],
    faqs: [
      {
        q: "Do you only audit, or can you help fix vulnerabilities too?",
        a: "We do both. The engagement includes finding, prioritizing, and remediating issues with engineering teams.",
      },
      {
        q: "Can security be added without slowing delivery?",
        a: "Yes. We embed security controls in CI/CD and define risk-based quality gates for speed with safety.",
      },
    ],
  },
  {
    id: "data-ai",
    icon: Database,
    title: "Data & Applied AI",
    category: "Platform",
    summary:
      "Data platforms, analytics, and applied AI workflows that turn operational data into decision systems and automation.",
    outcomes: [
      "Reliable reporting with governed data pipelines",
      "Operational efficiency through targeted AI-assisted workflows",
      "Faster decision-making with trusted dashboards and KPIs",
    ],
    deliverables: [
      "Data architecture, ingestion pipelines, and governance setup",
      "BI dashboards, event tracking model, and KPI framework",
      "Applied AI proofs of value with measurable business metrics",
    ],
    technologies: ["dbt", "BigQuery", "Snowflake", "Python", "LLM APIs"],
    keywords: ["data", "analytics", "ai", "dashboards", "etl", "warehouse", "insights", "automation"],
    faqs: [
      {
        q: "Can you build AI features without exposing private data?",
        a: "Yes. We design data controls, access boundaries, and provider-level security options for each workload.",
      },
      {
        q: "How quickly can we see value from analytics?",
        a: "Usually in phases. Initial KPI visibility can be delivered quickly, then expanded into deeper reporting and automation.",
      },
    ],
  },
  {
    id: "product-delivery",
    icon: Workflow,
    title: "Product Delivery & Team Augmentation",
    category: "Engineering",
    summary:
      "Dedicated squads and specialist engineers integrated with your team to accelerate roadmap delivery while maintaining quality standards.",
    outcomes: [
      "Reduced lead time from requirement to production",
      "Predictable delivery using sprint governance and quality gates",
      "Knowledge transfer through embedded collaboration",
    ],
    deliverables: [
      "Delivery plan with milestones, ownership model, and risk log",
      "Dedicated engineers, tech leads, and QA support as needed",
      "Documentation, handover, and scale-up plan",
    ],
    technologies: ["Agile", "Jira", "GitHub", "CI/CD", "Testing Automation"],
    keywords: ["team", "staffing", "augmentation", "delivery", "sprint", "engineering team", "project"],
    faqs: [
      {
        q: "Can we start with one product squad and scale later?",
        a: "Yes. The model is modular and can expand by capability, product line, or delivery phase.",
      },
      {
        q: "How do you ensure code quality across distributed teams?",
        a: "We enforce shared standards, code review policies, testing gates, and release checklists.",
      },
    ],
  },
];

const quickQuestions = [
  "Need a high-converting website in 8 weeks",
  "Want iOS and Android app with one codebase",
  "Need cloud migration with zero-downtime plan",
  "Need cybersecurity audit and remediation support",
  "Need a dedicated engineering team this quarter",
];

const ServicesPage = () => {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<"All" | Service["category"]>("All");
  const [activeService, setActiveService] = useState<Service>(services[0]);

  const serviceResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return services
      .map((service) => {
        let score = 0;
        if (!normalized) score = 1;
        if (normalized && service.title.toLowerCase().includes(normalized)) score += 8;
        if (normalized && service.summary.toLowerCase().includes(normalized)) score += 4;
        if (normalized && service.keywords.some((k) => k.includes(normalized))) score += 3;
        if (
          normalized &&
          service.faqs.some(
            (faq) =>
              faq.q.toLowerCase().includes(normalized) ||
              faq.a.toLowerCase().includes(normalized),
          )
        ) {
          score += 2;
        }
        if (selectedCategory !== "All" && service.category === selectedCategory) score += 2;
        return { service, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [query, selectedCategory]);

  const faqResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    return services
      .flatMap((service) =>
        service.faqs
          .filter(
            (faq) =>
              faq.q.toLowerCase().includes(normalized) ||
              faq.a.toLowerCase().includes(normalized),
          )
          .map((faq) => ({ ...faq, service })),
      )
      .slice(0, 4);
  }, [query]);

  const topMatch = serviceResults[0]?.service ?? null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero
        title="Software"
        highlight="Services"
        description="Engineering-first solutions for websites, mobile apps, cloud platforms, and cybersecurity programs."
        breadcrumb="Services"
      />

      <section className="py-14 border-b border-border/70 bg-muted/30">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mx-auto max-w-4xl rounded-2xl border border-border bg-background p-6 md:p-8 shadow-sm"
          >
            <div className="mb-6 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-primary">
              <Sparkles size={14} />
              Power Search
            </div>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground">
              Ask your question, get the right service path
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Search by business problem, technology, or outcome. Click a result to inspect scope,
              deliverables, and FAQs.
            </p>

            <div className="mt-6 rounded-xl border border-border bg-background">
              <div className="flex items-center gap-3 px-4 py-3">
                <Search size={16} className="text-muted-foreground shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Example: secure cloud migration, android app performance, website SEO issues..."
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {quickQuestions.map((question) => (
                <button
                  key={question}
                  onClick={() => setQuery(question)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                >
                  {question}
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {(["All", "Engineering", "Platform", "Security"] as const).map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                    selectedCategory === category
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
                  Recommended Services
                </p>
                {serviceResults.length > 0 ? (
                  <div className="space-y-2">
                    {serviceResults.slice(0, 4).map(({ service, score }) => (
                      <button
                        key={service.id}
                        onClick={() => setActiveService(service)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          activeService.id === service.id
                            ? "border-primary/60 bg-primary/5"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <p className="font-medium text-sm text-foreground">{service.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {service.category} match score: {score}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No exact match found. Try broader terms such as `web`, `mobile`, `cloud`, or `security`.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
                  FAQ Answers
                </p>
                {faqResults.length > 0 ? (
                  <div className="space-y-3">
                    {faqResults.map((faq) => (
                      <button
                        key={`${faq.service.id}-${faq.q}`}
                        onClick={() => setActiveService(faq.service)}
                        className="w-full rounded-lg border border-border p-3 text-left hover:border-primary/40 transition-colors"
                      >
                        <p className="text-xs text-primary font-medium">{faq.service.title}</p>
                        <p className="mt-1 text-sm text-foreground">{faq.q}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Start typing your question to see matching answers and recommended service tracks.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-10"
          >
            <span className="text-xs font-medium uppercase tracking-widest text-primary">
              Service Portfolio
            </span>
            <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
              Built for software outcomes, not generic outsourcing
            </h2>
          </motion.div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service, i) => (
              <motion.div
                key={service.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                className={`group rounded-xl border bg-background p-8 transition-all duration-300 ${
                  activeService.id === service.id
                    ? "border-primary/70 shadow-md"
                    : "border-border hover:border-primary/40 hover:shadow-md"
                }`}
              >
                <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <service.icon size={28} />
                </div>
                <div className="mb-2 inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {service.category}
                </div>
                <h3 className="font-display text-xl font-semibold text-foreground mb-3">{service.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{service.summary}</p>
                <button
                  onClick={() => setActiveService(service)}
                  className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80"
                >
                  View scope <ArrowRight size={14} />
                </button>
              </motion.div>
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
            className="mb-10"
          >
            <span className="text-xs font-medium uppercase tracking-widest text-primary">
              Selected Service Scope
            </span>
            <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
              {activeService.title}
            </h2>
            <p className="mt-2 max-w-3xl text-muted-foreground">{activeService.summary}</p>
          </motion.div>

          <div className="grid gap-6 lg:grid-cols-3">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="rounded-xl border border-border bg-background p-6"
            >
              <h3 className="font-display text-lg font-semibold text-foreground mb-3">
                Business Outcomes
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {activeService.outcomes.map((outcome) => (
                  <li key={outcome}>- {outcome}</li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 }}
              className="rounded-xl border border-border bg-background p-6"
            >
              <h3 className="font-display text-lg font-semibold text-foreground mb-3">
                Delivery Scope
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {activeService.deliverables.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="rounded-xl border border-border bg-background p-6"
            >
              <h3 className="font-display text-lg font-semibold text-foreground mb-3">
                Typical Tech Stack
              </h3>
              <div className="flex flex-wrap gap-2">
                {activeService.technologies.map((tech) => (
                  <span
                    key={tech}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </motion.div>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_auto] items-center rounded-2xl border border-border bg-background p-6">
            <div>
              <h3 className="font-display text-xl font-semibold text-foreground">
                Next Step: solution workshop
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                We map your requirements, delivery timeline, and architecture decisions into an
                actionable roadmap for the right service track.
              </p>
              {topMatch && (
                <p className="mt-3 text-sm text-primary">
                  Best current search match: {topMatch.title}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/contact"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Book Consultation
              </Link>
              <Link
                to="/portfolio"
                className="inline-flex items-center justify-center rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:border-primary/40 transition-colors"
              >
                View Case Studies
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="text-xs font-medium uppercase tracking-widest text-primary">
              Delivery Standards
            </span>
            <h2 className="mt-3 font-display text-4xl md:text-5xl font-bold text-foreground">
              How We Run Execution
            </h2>
            <p className="mt-4 mx-auto max-w-2xl text-muted-foreground">
              Every service engagement follows measurable engineering, platform, and security gates.
            </p>
          </motion.div>

          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                title: "Discovery to Delivery",
                desc: "Structured discovery, technical architecture, sprint execution, QA gates, and release readiness with clear ownership.",
              },
              {
                title: "Cloud-Native Operations",
                desc: "Automated CI/CD, infrastructure-as-code, observability, and incident playbooks for dependable operations.",
              },
              {
                title: "Security by Default",
                desc: "Threat modeling, secure coding checks, vulnerability management, and compliance-aligned controls integrated into delivery.",
              },
            ].map((model, i) => (
              <motion.div
                key={model.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="rounded-xl border border-border bg-background p-8 text-center hover:border-primary/40 hover:shadow-md transition-all"
              >
                <h3 className="font-display text-xl font-bold text-foreground mb-3">{model.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{model.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default ServicesPage;

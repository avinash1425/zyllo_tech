// Extended editorial content for each /services/[slug] page, keyed by slug.
// Split from services.js so the header dropdown / grids (which only need the
// summary fields) don't carry this weight, and so the prerender script can
// import one file for the full page content.
//
// Content rules for this file (see project memory): describe capability,
// process, and technology honestly — never invent client names, outcome
// metrics, or credentials. FAQs answer what buyers actually ask before
// contacting a vendor. `seoTitle`/`seoDescription` target long-tail queries;
// the H1 on the page stays the short human title.

export const SERVICE_DETAILS = {
  "product-strategy-consulting": {
    seoTitle: "Custom Software Development Company India | Zyllo Tech",
    seoDescription:
      "Custom software development from Hyderabad, India — discovery, roadmap, and delivery for enterprise apps and business platforms. Fixed-scope or dedicated teams.",
    // Blog/guide slugs (see src/data/articles.ts) shown as "Further reading"
    // on the service page and in its prerendered HTML.
    relatedReading: ["software-rfp-guide", "proptech-crm-project-management", "telecom-customer-portal-billing-automation"],
    process: [
      { title: "Discovery workshop", text: "We start with a structured workshop covering your users, workflows, constraints, and what success looks like — before anyone talks about features." },
      { title: "Scope & roadmap", text: "You get a written scope for a right-sized first version, a phased roadmap beyond it, and honest guidance on what to postpone." },
      { title: "Build in weekly increments", text: "Development runs in weekly demo cycles. You see working software every week, not a big reveal at the end." },
      { title: "Launch & iterate", text: "We ship, measure how the first version behaves with real users, and plan the next phase from evidence rather than assumptions." },
    ],
    deliverables: [
      "Written scope and phased product roadmap",
      "Architecture and technology recommendation with reasoning",
      "Working software demoed weekly",
      "Source code in your repository from day one",
      "Deployment pipeline and documentation",
      "Handover session with your team",
    ],
    stack: ["React", "Node.js", "TypeScript", "PostgreSQL", "Python", "AWS", "Docker", "REST & GraphQL APIs"],
    faqs: [
      { q: "How do you price custom software projects?", a: "Two models: fixed scope for well-defined builds, or a dedicated monthly team for evolving products. After the discovery workshop you get a written estimate broken down by phase — never a single opaque number." },
      { q: "Who owns the code and IP?", a: "You do, fully. Code lives in your repository from the first commit, and our contracts assign all work product to you. There is no lock-in to keep working with us." },
      { q: "How long does a typical first version take?", a: "Most first versions we scope land in the 8–16 week range depending on complexity. The discovery phase exists partly to give you a realistic timeline before you commit budget." },
      { q: "Can you take over an existing codebase?", a: "Yes. We start with a code and infrastructure review, document what we find, and agree on a stabilisation plan before adding new features to unfamiliar code." },
    ],
  },

  "web-development": {
    seoTitle: "Web Application Development Services India | Zyllo Tech",
    seoDescription:
      "Web development company in Hyderabad building fast, secure React and Node.js web applications, business websites, and e-commerce — performance and SEO built in.",
    relatedReading: ["headless-commerce-architecture-retail", "headless-cms-migration-media-publishing", "api-design-principles"],
    process: [
      { title: "Requirements & wireframes", text: "We map the pages, user flows, and content model first, so the build starts from an agreed blueprint instead of guesswork." },
      { title: "Design system & build", text: "Components are built against a shared design system, so every page stays consistent and future pages get faster to add." },
      { title: "Performance & SEO pass", text: "Core Web Vitals, semantic markup, structured data, and accessibility are checked before launch — not retrofitted after rankings suffer." },
      { title: "Launch & handover", text: "We deploy with a CI/CD pipeline, monitoring, and documentation, and walk your team through operating the site." },
    ],
    deliverables: [
      "Responsive web application or website",
      "Reusable component library",
      "CI/CD deployment pipeline",
      "Core Web Vitals and SEO baseline report",
      "Admin and content-editing workflows where needed",
      "Documentation and handover",
    ],
    stack: ["React", "Next.js", "Vite", "TypeScript", "Node.js", "Tailwind CSS", "PostgreSQL", "Cloudflare", "Vercel / AWS"],
    faqs: [
      { q: "Will the site be fast and rank well?", a: "Performance and SEO are acceptance criteria in our builds, not afterthoughts: we target passing Core Web Vitals, ship semantic HTML with structured data, and hand over a measurable baseline report at launch." },
      { q: "Do you work with our existing design or brand?", a: "Either way — we can build precisely to designs you supply, or our UI/UX team can design first. Brand guidelines, fonts, and existing component styles are followed where they exist." },
      { q: "Can you migrate our current website without losing SEO?", a: "Yes. Migrations include a URL inventory, redirect map, and structured-data parity check so existing rankings carry over instead of resetting." },
      { q: "What happens after launch?", a: "You can hand operation to your own team — everything is documented — or keep us on a maintenance plan for updates, monitoring, and continued improvements." },
    ],
  },

  "mobile-app-development": {
    seoTitle: "Mobile App Development Company India | iOS & Android | Zyllo Tech",
    seoDescription:
      "Mobile app development in India — native iOS/Android and cross-platform React Native or Flutter apps, from wireframe to App Store and Play Store launch.",
    relatedReading: ["lms-scaling-edtech-implementation", "fleet-tracking-iot-cloud-implementation", "iot-farm-monitoring-agritech-implementation"],
    process: [
      { title: "Platform strategy", text: "Native or cross-platform is a cost and UX decision, not an ideology. We recommend based on your audience, budget, and the features you actually need." },
      { title: "Design & prototype", text: "Clickable prototypes come before code, so navigation and flows get tested on a phone in your hand — where problems are cheap to fix." },
      { title: "Build & test on devices", text: "Weekly builds go to real devices through TestFlight and Play internal testing, with automated tests around the critical paths." },
      { title: "Store launch & beyond", text: "We handle store listings, review requirements, and release management, then monitor crashes and performance after launch." },
    ],
    deliverables: [
      "iOS and/or Android application",
      "App Store and Play Store listings and launch",
      "Crash reporting and analytics integration",
      "Automated test coverage on critical flows",
      "Backend APIs where the app needs them",
      "Release and versioning process your team can run",
    ],
    stack: ["React Native", "Flutter", "Swift", "Kotlin", "Firebase", "Supabase", "Node.js APIs", "TestFlight", "Play Console"],
    faqs: [
      { q: "Native or cross-platform — what do you recommend?", a: "For most business apps, one cross-platform codebase (React Native or Flutter) ships faster and costs less to maintain. We recommend native when an app depends on heavy platform-specific features. You get the reasoning in writing either way." },
      { q: "Do you handle App Store and Play Store approval?", a: "Yes — listings, screenshots, privacy declarations, and review back-and-forth are part of the launch phase, including resubmissions if a review raises issues." },
      { q: "Can you build the backend too?", a: "Yes. Most mobile engagements include the APIs, authentication, push notifications, and admin tooling behind the app, so you're not stitching together vendors." },
      { q: "How do updates work after launch?", a: "We set up a release pipeline your team can operate, or keep maintaining the app under a support plan — including OS-version updates when Apple and Google change requirements." },
    ],
  },

  "ui-ux-design": {
    seoTitle: "UI/UX Design Services India | Product & App Design | Zyllo Tech",
    seoDescription:
      "UI/UX design services from Hyderabad — research, wireframes, prototypes, and design systems for web and mobile products, validated with real usability testing.",
    relatedReading: ["design-systems-that-scale", "micro-interactions-ux", "hotel-booking-engine-travel-implementation"],
    process: [
      { title: "Research & user flows", text: "We interview stakeholders, map who the users are and what they came to do, and turn that into concrete user flows before drawing screens." },
      { title: "Wireframes first", text: "Low-fidelity wireframes settle structure and navigation cheaply. Layout debates happen here, where a change costs minutes instead of sprints." },
      { title: "Visual design & prototype", text: "High-fidelity screens become a clickable prototype that behaves like the product — the artifact your stakeholders and our engineers both work from." },
      { title: "Test & refine", text: "We watch real users attempt real tasks on the prototype, and revise what confused them before a line of production code is written." },
    ],
    deliverables: [
      "User flows and information architecture",
      "Wireframes and clickable prototypes",
      "High-fidelity screen designs",
      "A design system: tokens, components, usage rules",
      "Usability testing notes and revisions",
      "Developer-ready handoff in Figma",
    ],
    stack: ["Figma", "Design tokens", "Component libraries", "Prototyping", "Usability testing", "Accessibility (WCAG) checks"],
    faqs: [
      { q: "Can you redesign an existing product without breaking what works?", a: "Yes — redesigns start with an audit of what users currently succeed and struggle with, so we keep the patterns that work and fix the ones that don't, rather than changing everything for novelty." },
      { q: "Do we get a design system or just screens?", a: "A design system: reusable components, spacing and color tokens, and usage rules. Individual screens age fast; a system keeps every future screen consistent and cheaper to design." },
      { q: "How does design hand off to development?", a: "Engineers get organized Figma files with tokens and component specs, and when we also build the product the design system maps one-to-one to the code component library." },
      { q: "Do you test designs with real users?", a: "Yes — moderated task-based testing on prototypes. It's the cheapest point in the whole project to discover that a flow confuses people." },
    ],
  },

  "cloud-solutions": {
    seoTitle: "Cloud & DevOps Services India | AWS, CI/CD, Migration | Zyllo Tech",
    seoDescription:
      "Cloud solutions from Hyderabad — AWS and GCP architecture, cloud migration, Kubernetes, CI/CD pipelines, and cost optimization with 24/7 monitoring.",
    relatedReading: ["migrating-to-microservices-playbook", "kubernetes-cost-optimization", "fleet-tracking-iot-cloud-implementation"],
    process: [
      { title: "Infrastructure review", text: "We map what you run today — servers, costs, deployment steps, failure points — and identify what should change first and what shouldn't change at all." },
      { title: "Architecture & migration plan", text: "You get a target architecture and a stepwise migration plan designed so the business keeps running throughout — no big-bang cutovers." },
      { title: "Automate the path to production", text: "Infrastructure becomes code, deployments become a pipeline, and rollbacks become one command instead of an emergency." },
      { title: "Operate & optimize", text: "Monitoring, alerting, and a monthly cost review keep the platform healthy — cloud bills tend to drift, so we treat cost as an ongoing metric." },
    ],
    deliverables: [
      "Target architecture with written reasoning",
      "Infrastructure as code (Terraform)",
      "CI/CD pipelines with automated rollback",
      "Monitoring, alerting, and log aggregation",
      "Stepwise migration executed with the business online",
      "Monthly cost and reliability reporting",
    ],
    stack: ["AWS", "Google Cloud", "Terraform", "Docker", "Kubernetes", "GitHub Actions", "Grafana", "CloudWatch"],
    faqs: [
      { q: "Can you migrate us to the cloud without downtime?", a: "Migrations are planned as a sequence of small, reversible steps — parallel-running where needed — so the business stays online. A hard cutover with fingers crossed is exactly what the planning phase exists to avoid." },
      { q: "Our cloud bill keeps growing. Can you reduce it?", a: "Usually, yes — common causes are oversized instances, unused resources, and missing storage lifecycle rules. We start with a cost audit that itemises where the money goes before changing anything." },
      { q: "Do you manage infrastructure ongoing, or set it up and leave?", a: "Both models are available. Some clients take over a fully-documented, automated setup; others keep us on for monitoring, incident response, and monthly cost reviews." },
      { q: "Do we need Kubernetes?", a: "Only sometimes. Plenty of products run better and cheaper on simpler managed platforms. We recommend the least complex infrastructure that meets your actual scale — complexity is a cost, not a badge." },
    ],
  },

  "ai-solutions": {
    seoTitle: "AI Development Company India | LLM Apps & Automation | Zyllo Tech",
    seoDescription:
      "AI solutions from Hyderabad, India — LLM-powered copilots, RAG systems, chatbots, and workflow automation built on OpenAI, Claude, and open models.",
    relatedReading: ["ai-reshaping-enterprise-software-2025", "langchain-vs-llamaindex-rag", "predictive-maintenance-manufacturing-implementation"],
    process: [
      { title: "Use-case qualification", text: "We start by finding where AI genuinely saves time in your workflows — and we'll say so plainly if a use case doesn't justify the cost." },
      { title: "Data readiness check", text: "AI features are only as good as the data behind them. We assess what you have, what needs cleaning, and what governance the use case needs." },
      { title: "Prototype against real tasks", text: "A working prototype is tested on your real documents and workflows early, with accuracy measured — before committing to a full build." },
      { title: "Production hardening", text: "The build gets evaluation suites, guardrails, fallback behaviour, and cost monitoring — the parts that separate a demo from a dependable feature." },
    ],
    deliverables: [
      "Working AI feature integrated into your product or workflow",
      "Evaluation suite measuring output quality over time",
      "Guardrails, moderation, and fallback behaviour",
      "Token/API cost monitoring and budgets",
      "Prompt and retrieval pipeline documentation",
      "A written recommendation when AI is not the right tool",
    ],
    stack: ["Claude & OpenAI APIs", "RAG pipelines", "Vector databases", "LangChain", "Python", "Node.js", "Embeddings & fine-tuning"],
    faqs: [
      { q: "Will our data be used to train someone else's model?", a: "No. We build on API tiers with training opt-outs, keep your data inside your own infrastructure wherever possible, and document exactly which providers see what data." },
      { q: "How do you control AI costs?", a: "Cost is designed in: model routing (smaller models for simpler steps), caching, and per-feature budgets with alerts. You see projected per-request economics before the feature ships." },
      { q: "What about hallucinations and wrong answers?", a: "We constrain outputs with retrieval over your own verified content, add evaluation suites that measure accuracy on real examples, and design honest fallbacks for low-confidence cases rather than letting the model guess." },
      { q: "Do we need our own model?", a: "Almost never to start. Hosted models with good retrieval beat custom training for most business uses at a fraction of the cost. Fine-tuning becomes worth discussing only after usage data proves the case." },
    ],
  },

  "maintenance-support": {
    seoTitle: "Application Maintenance & Support Services India | Zyllo Tech",
    seoDescription:
      "Software maintenance and support from India — monitoring, security patching, bug fixes, and performance tuning under clear SLAs, for apps we built or inherited.",
    relatedReading: ["kubernetes-cost-optimization", "predictive-maintenance-manufacturing-implementation"],
    process: [
      { title: "Onboarding & audit", text: "We review the codebase, infrastructure, and known issues, and document the system's current health so the baseline is explicit." },
      { title: "Stabilise", text: "Monitoring, alerting, and backups are verified or added first — you can't support what you can't see." },
      { title: "Steady-state support", text: "A monthly plan covers dependency updates, security patches, bug fixes, and small improvements, with a named contact and agreed response times." },
      { title: "Report & review", text: "You get a monthly plain-language report: what broke, what was fixed, what was updated, and what deserves attention next." },
    ],
    deliverables: [
      "Documented system health baseline",
      "Monitoring, alerting, and verified backups",
      "Security patching and dependency updates",
      "Agreed response-time SLAs",
      "Monthly plain-language health report",
      "A team that already knows your codebase when something breaks",
    ],
    stack: ["Uptime & APM monitoring", "Sentry", "Dependency scanning", "Automated backups", "Staging environments", "Incident runbooks"],
    faqs: [
      { q: "Can you maintain software another company built?", a: "Yes — that's a large share of this work. We start with a paid audit that documents the system's state and risks, so both sides know what we're taking on before signing an SLA." },
      { q: "What do your SLAs look like?", a: "Response times are tiered by severity and agreed per contract — a production outage gets a different clock than a cosmetic bug. The commitments are written down, not implied." },
      { q: "Is there a minimum contract?", a: "Support plans are monthly with a small onboarding phase. Long lock-ins aren't necessary: if the service isn't earning its fee, you should be able to leave." },
      { q: "Do you just fix bugs, or improve things too?", a: "Plans include a monthly allowance for small improvements — performance tuning, UX fixes, minor features — so the product keeps getting better, not just staying alive." },
    ],
  },

  "cybersecurity-engineering": {
    seoTitle: "Application Security Services India | OWASP, Audits | Zyllo Tech",
    seoDescription:
      "Cybersecurity engineering from India — secure development, OWASP-aligned code review, security assessments, and data protection for web and mobile applications.",
    relatedReading: ["digital-banking-platform-implementation-guide", "fhir-patient-portal-implementation", "game-backend-architecture-scaling"],
    process: [
      { title: "Threat model first", text: "We map what you're protecting, from whom, and what an attacker would actually target — so effort goes where the risk is, not where the checklist says." },
      { title: "Assess", text: "Code review, dependency audit, configuration review, and authentication/authorization testing against OWASP guidance, with findings ranked by real-world severity." },
      { title: "Fix with your team", text: "Findings come with concrete fixes, and we implement them ourselves or pair with your engineers — a report that nobody acts on protects nothing." },
      { title: "Build security in", text: "Secure defaults, secrets management, and automated dependency scanning get wired into the development workflow so the next feature ships safe by default." },
    ],
    deliverables: [
      "Threat model for your specific product",
      "Security assessment with severity-ranked findings",
      "Concrete remediation — implemented, not just recommended",
      "Secure authentication and access-control review",
      "Automated dependency and secret scanning in CI",
      "Plain-language summary your leadership can read",
    ],
    stack: ["OWASP ASVS", "Static analysis", "Dependency scanning", "Secrets management", "OAuth2 / OIDC", "Encryption at rest & transit"],
    faqs: [
      { q: "Do you do penetration testing?", a: "We perform application-level security assessments — code review, configuration audit, and authenticated testing of your app. For compliance-mandated third-party penetration tests, we prepare your systems and work alongside the certified testing firm you engage." },
      { q: "We had a security scare. Where do we start?", a: "With a rapid assessment: verify what happened, close the immediate hole, then a structured review to find related weaknesses. Panic-driven rewrites usually create more risk than they remove." },
      { q: "Can you help with compliance requirements?", a: "We implement the technical controls — access control, encryption, logging, data retention — that frameworks like ISO 27001 or SOC 2 require, and prepare the technical evidence for your auditors. Certification itself is issued by accredited auditors, not by us." },
      { q: "Is security a one-time project?", a: "The assessment is a project; staying secure is a practice. The lasting value is wiring scanning and secure defaults into your development workflow so new code ships safe without heroics." },
    ],
  },

  "quality-engineering-qa": {
    seoTitle: "QA & Test Automation Services India | Zyllo Tech",
    seoDescription:
      "Quality engineering from India — automated test suites, regression testing, and performance testing for web and mobile apps, wired into your CI/CD pipeline.",
    relatedReading: ["api-design-principles", "scalable-react-typescript", "ai-reshaping-enterprise-software-2025"],
    process: [
      { title: "Risk-map the product", text: "We identify the flows where a bug costs real money or trust — payments, sign-up, data integrity — and weight testing effort accordingly." },
      { title: "Automate the critical paths", text: "The high-risk flows get automated first, so every future release is checked against what matters most within minutes, not days." },
      { title: "Wire tests into CI", text: "Tests run on every pull request and block broken code from merging — quality enforcement becomes automatic instead of depending on discipline." },
      { title: "Measure & extend", text: "Flaky tests get fixed, coverage grows along real usage patterns, and performance tests catch slowdowns before users do." },
    ],
    deliverables: [
      "Automated test suite for critical user flows",
      "Tests running in CI on every change",
      "Regression checklist for release days",
      "Performance and load test baseline",
      "Bug tracking workflow with severity rules",
      "Coverage reporting your team can read",
    ],
    stack: ["Playwright", "Vitest / Jest", "Cypress", "k6 load testing", "GitHub Actions", "BrowserStack", "Appium"],
    faqs: [
      { q: "Manual or automated testing — which do we need?", a: "Both, in the right places: automation for repeatable critical paths and regressions, human exploratory testing for new features and UX judgment. Automating everything is as wasteful as automating nothing." },
      { q: "Our releases keep breaking things. Can you fix that?", a: "That pattern usually means no regression safety net. We build automated coverage over your critical flows and gate releases on it — most teams feel the difference within a few release cycles." },
      { q: "Can you test an app your team is actively developing?", a: "Yes — QA runs alongside development, not after it. Tests land in the same repository and pipeline your developers use, so quality checks happen on every pull request." },
      { q: "Do you do load and performance testing?", a: "Yes — we script realistic traffic patterns, establish a performance baseline, and test the points most likely to fail under load, so launch-day traffic is a rehearsed event instead of a surprise." },
    ],
  },
};

export function getServiceDetails(slug) {
  return SERVICE_DETAILS[slug] || null;
}

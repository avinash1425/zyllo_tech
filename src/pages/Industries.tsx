import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2,
  ShoppingCart,
  Truck,
  Gamepad2,
  HeartPulse,
  GraduationCap,
  Landmark,
  Factory,
  Plane,
  Wifi,
  Clapperboard,
  Leaf,
  ArrowRight,
  CheckCircle2,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";

type Industry = {
  id: string;
  icon: typeof Landmark;
  name: string;
  summary: string;
  challenges: string[];
  solutions: string[];
  outcomes: string[];
  stacks: string[];
};

const industries: Industry[] = [
  {
    id: "bfsi",
    icon: Landmark,
    name: "Banking & Financial Services",
    summary:
      "Secure and compliant digital banking systems, lending workflows, payment platforms, and fraud-aware operations.",
    challenges: [
      "Legacy core systems and integration bottlenecks",
      "Regulatory and audit pressure",
      "Fraud prevention with fast customer experience",
    ],
    solutions: [
      "Digital onboarding, KYC, and lending workflow automation",
      "Payment gateway and wallet platform engineering",
      "Risk analytics, alerts, and compliance reporting systems",
    ],
    outcomes: [
      "Reduced onboarding time and manual checks",
      "Improved transaction reliability and fraud visibility",
      "Better compliance readiness and audit traceability",
    ],
    stacks: ["Secure APIs", "Event-Driven Systems", "Encryption", "Audit Logs"],
  },
  {
    id: "retail",
    icon: ShoppingCart,
    name: "Retail & E-Commerce",
    summary:
      "Omnichannel commerce platforms that improve conversion, inventory accuracy, and customer retention.",
    challenges: [
      "Inventory mismatch across channels",
      "Slow storefront performance and cart drop-offs",
      "Limited personalization and loyalty insights",
    ],
    solutions: [
      "Headless commerce and high-speed storefront engineering",
      "Unified inventory and order orchestration systems",
      "Loyalty, recommendation, and customer data workflows",
    ],
    outcomes: [
      "Higher checkout conversion rates",
      "Lower stockout and overselling issues",
      "Improved repeat purchase and customer lifetime value",
    ],
    stacks: ["Headless CMS", "Commerce APIs", "Real-Time Inventory", "CDN"],
  },
  {
    id: "healthcare",
    icon: HeartPulse,
    name: "Healthcare & Life Sciences",
    summary:
      "Digital health products with security, interoperability, and patient-centric workflows.",
    challenges: [
      "Fragmented patient records and systems",
      "Strict data privacy requirements",
      "Operational inefficiencies in care workflows",
    ],
    solutions: [
      "Patient portals and telehealth platform development",
      "Clinical workflow automation and integration services",
      "Healthcare analytics dashboards and reporting",
    ],
    outcomes: [
      "Faster care coordination and patient service",
      "Improved data visibility across teams",
      "More secure and compliant data handling",
    ],
    stacks: ["FHIR Integrations", "Role-Based Access", "Audit Trails", "Secure Cloud"],
  },
  {
    id: "edtech",
    icon: GraduationCap,
    name: "Education & EdTech",
    summary:
      "Learning platforms, virtual classrooms, and academic workflows designed for scale and engagement.",
    challenges: [
      "Low student engagement in digital formats",
      "Manual academic operations and reporting",
      "Scalability issues during peak sessions",
    ],
    solutions: [
      "LMS and virtual classroom platform engineering",
      "Assessment, attendance, and progress tracking systems",
      "Mobile learning apps and parent/student portals",
    ],
    outcomes: [
      "Improved learning engagement and completion",
      "Reduced manual administrative workload",
      "Scalable digital delivery for institutions",
    ],
    stacks: ["Video Streaming", "LMS", "Mobile Apps", "Analytics"],
  },
  {
    id: "logistics",
    icon: Truck,
    name: "Logistics & Transportation",
    summary:
      "Operational platforms for route optimization, fleet visibility, and delivery performance.",
    challenges: [
      "Limited real-time fleet visibility",
      "High delivery costs and route inefficiency",
      "Disconnected warehouse and dispatch systems",
    ],
    solutions: [
      "Fleet tracking and route optimization platforms",
      "Warehouse and dispatch orchestration systems",
      "Driver mobile apps and proof-of-delivery workflows",
    ],
    outcomes: [
      "Lower fuel and delivery costs",
      "Improved on-time delivery rates",
      "Stronger operational control and transparency",
    ],
    stacks: ["GPS Integrations", "IoT", "Mobile Ops", "Real-Time Events"],
  },
  {
    id: "manufacturing",
    icon: Factory,
    name: "Manufacturing & Industrial",
    summary:
      "Factory and operations software that improves quality, uptime, and production planning.",
    challenges: [
      "Production downtime and reactive maintenance",
      "Quality variance across lines",
      "Limited plant-level operational intelligence",
    ],
    solutions: [
      "Production planning and execution systems",
      "Predictive maintenance and monitoring platforms",
      "Quality tracking and defect analytics dashboards",
    ],
    outcomes: [
      "Reduced unplanned downtime",
      "Better quality consistency and traceability",
      "Higher throughput and planning accuracy",
    ],
    stacks: ["IoT Data Pipelines", "MES Integrations", "Dashboards", "Automation"],
  },
  {
    id: "gaming",
    icon: Gamepad2,
    name: "Gaming & Entertainment",
    summary:
      "High-concurrency platforms, engagement systems, and monetization experiences for gaming businesses.",
    challenges: [
      "Peak traffic and concurrency management",
      "Retention and engagement gaps",
      "Real-time performance and latency constraints",
    ],
    solutions: [
      "Backend platform scaling and matchmaking systems",
      "Wallet, rewards, and engagement feature development",
      "Real-time analytics and anti-abuse monitoring",
    ],
    outcomes: [
      "Stable gameplay during traffic spikes",
      "Improved retention and session length",
      "Safer and more reliable monetization flows",
    ],
    stacks: ["Low-Latency APIs", "Real-Time Streams", "Scalable Cloud", "Fraud Controls"],
  },
  {
    id: "real-estate",
    icon: Building2,
    name: "Real Estate & Construction",
    summary:
      "Property lifecycle platforms for sales, operations, and project delivery control.",
    challenges: [
      "Fragmented lead and sales workflow",
      "Project delays and weak visibility",
      "Manual documentation and reporting",
    ],
    solutions: [
      "Property listing and CRM workflow platforms",
      "Construction progress and project tracking systems",
      "Document management and reporting automation",
    ],
    outcomes: [
      "Faster sales cycle movement",
      "Clearer project status and accountability",
      "Reduced manual coordination effort",
    ],
    stacks: ["CRM", "Workflow Automation", "Mobile Field Apps", "Dashboards"],
  },
  {
    id: "travel",
    icon: Plane,
    name: "Travel & Hospitality",
    summary:
      "Booking and guest-experience platforms that improve occupancy, loyalty, and service quality.",
    challenges: [
      "Disconnected booking and service systems",
      "Pricing and occupancy optimization issues",
      "Inconsistent guest experience across channels",
    ],
    solutions: [
      "Booking engine and reservation workflow platforms",
      "Guest mobile experience and loyalty systems",
      "Revenue analytics and operations dashboards",
    ],
    outcomes: [
      "Higher booking conversion and occupancy",
      "Improved guest satisfaction and repeat bookings",
      "Better operational and revenue visibility",
    ],
    stacks: ["Reservation APIs", "Mobile Apps", "Analytics", "Integrations"],
  },
  {
    id: "telecom",
    icon: Wifi,
    name: "Telecom & IT Services",
    summary:
      "Service platforms and operational automation for customer delivery, billing, and support at scale.",
    challenges: [
      "Complex provisioning and ticketing flows",
      "Billing disputes and data consistency issues",
      "Slow support operations",
    ],
    solutions: [
      "Provisioning and service assurance platform engineering",
      "Billing, usage, and customer portal development",
      "Support workflow automation and knowledge systems",
    ],
    outcomes: [
      "Faster service delivery turnaround",
      "Higher billing accuracy and transparency",
      "Improved support response and customer satisfaction",
    ],
    stacks: ["Workflow Engines", "Customer Portals", "Billing Integrations", "Automation"],
  },
  {
    id: "media",
    icon: Clapperboard,
    name: "Media & Publishing",
    summary:
      "Content, audience, and monetization platforms for digital media teams.",
    challenges: [
      "Content workflow inefficiencies",
      "Audience retention and personalization gaps",
      "Ad and subscription revenue pressure",
    ],
    solutions: [
      "CMS and publishing workflow modernization",
      "Personalization and recommendation features",
      "Subscription, paywall, and ad-tech integrations",
    ],
    outcomes: [
      "Faster content production cycles",
      "Higher audience engagement and retention",
      "Improved monetization across channels",
    ],
    stacks: ["CMS", "Recommendation Engines", "CDN", "Analytics"],
  },
  {
    id: "agri",
    icon: Leaf,
    name: "Agriculture & Environment",
    summary:
      "Data-driven platforms for smart farming, supply visibility, and sustainability operations.",
    challenges: [
      "Limited field-level visibility",
      "Yield variability and forecasting uncertainty",
      "Manual sustainability reporting",
    ],
    solutions: [
      "Farm operations monitoring and advisory applications",
      "Supply chain traceability and quality tracking systems",
      "Sustainability metrics and reporting dashboards",
    ],
    outcomes: [
      "Better crop planning and field operations",
      "Higher traceability across the value chain",
      "Stronger sustainability compliance readiness",
    ],
    stacks: ["IoT", "GIS", "Mobile Data Capture", "Reporting"],
  },
];

import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const industriesFaqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    { "@type": "Question", name: "Which industries does Zyllo Tech serve?", acceptedAnswer: { "@type": "Answer", text: "Zyllo Tech serves Banking & Financial Services, Retail & E-Commerce, Healthcare & Life Sciences, EdTech, Logistics & Transportation, Manufacturing, Gaming & Entertainment, Real Estate, Travel & Hospitality, Telecom, Media & Publishing, and Agriculture." } },
    { "@type": "Question", name: "Does Zyllo Tech build software for the BFSI sector?", acceptedAnswer: { "@type": "Answer", text: "Yes. We build KYC automation platforms, digital banking portals, payment gateway integrations, risk analytics dashboards, and PCI-DSS compliant infrastructure for banks, NBFCs, and FinTech companies." } },
    { "@type": "Question", name: "Can Zyllo Tech build HIPAA or FHIR compliant healthcare software?", acceptedAnswer: { "@type": "Answer", text: "Yes. We design and deliver FHIR R4 compliant patient portals, telehealth platforms, clinical workflow automation, and HIPAA-compliant cloud infrastructure for healthcare providers and life sciences companies." } },
  ],
};

const IndustriesPage = () => {
  const [activeIndustry, setActiveIndustry] = useState<Industry | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Industry-Specific Software Solutions | Banking, Healthcare, Retail & 9 More | Zyllo Tech"
        description="Zyllo Tech builds tailored software for Banking, Healthcare, E-Commerce, EdTech, Logistics, Manufacturing, Gaming, Real Estate, Travel, Telecom, Media, and AgriTech — with sector-specific architecture and compliance expertise."
        canonical="/industries"
        keywords="industry software solutions India, banking software development, healthcare software India, edtech platform development, logistics software, manufacturing software, retail e-commerce development India, fintech software company"
        structuredData={[
          industriesFaqSchema,
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Industries", url: `${SITE_URL}/industries` },
          ]),
        ]}
      />
      <Navbar />
      <PageHero
        title="Industries"
        highlight="We Serve"
        description="Sector-specific software solutions designed around business workflows, compliance requirements, and measurable outcomes."
        breadcrumb="Industries"
      />

      <section className="py-16 border-b border-border/70">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center"
          >
            <span className="text-xs font-medium uppercase tracking-widest text-primary">Industry Solutions</span>
            <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
              What We Build For Each Sector
            </h2>
            <p className="mt-3 mx-auto max-w-3xl text-muted-foreground">
              Each industry has different risks, compliance needs, and operational priorities. Our approach combines software engineering, cloud operations, and security controls aligned to sector requirements.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((industry, i) => (
              <motion.article
                key={industry.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.04 }}
                className="group rounded-xl border border-border bg-background p-7 hover:border-primary/40 hover:shadow-md transition-all"
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <industry.icon size={24} />
                </div>
                <h3 className="font-display text-lg font-semibold text-foreground">{industry.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{industry.summary}</p>

                <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                  {industry.solutions.slice(0, 2).map((solution) => (
                    <p key={solution}>- {solution}</p>
                  ))}
                </div>

                <button
                  onClick={() => setActiveIndustry(industry)}
                  className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80"
                >
                  View Solutions <ArrowRight size={14} />
                </button>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted/50">
        <div className="container mx-auto px-6">
          <div className="rounded-2xl border border-border bg-background p-7 md:p-9">
            <h3 className="font-display text-2xl font-bold text-foreground">Need a Sector-Specific Solution Plan?</h3>
            <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
              Share your business model, target users, and current systems. We will map the right service stack, implementation phases, and risk controls for your industry.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                to="/contact"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Talk to Our Team
              </Link>
              <Link
                to="/services"
                className="inline-flex items-center justify-center rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:border-primary/40"
              >
                Explore Services
              </Link>
            </div>
          </div>
        </div>
      </section>

      <AnimatePresence>
        {activeIndustry && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50"
              onClick={() => setActiveIndustry(null)}
            />

            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="relative z-10 w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-primary">Industry Solution Blueprint</p>
                  <h3 className="mt-1 font-display text-2xl font-bold text-foreground">{activeIndustry.name}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{activeIndustry.summary}</p>
                </div>
                <button
                  onClick={() => setActiveIndustry(null)}
                  className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground"
                  aria-label="Close industry details"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground">Key Challenges</h4>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {activeIndustry.challenges.map((challenge) => (
                      <li key={challenge}>- {challenge}</li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground">Solutions We Provide</h4>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {activeIndustry.solutions.map((solution) => (
                      <li key={solution} className="flex items-start gap-2">
                        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-primary" />
                        <span>{solution}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground">Expected Outcomes</h4>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {activeIndustry.outcomes.map((outcome) => (
                      <li key={outcome}>- {outcome}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-border p-4">
                <h4 className="text-sm font-semibold text-foreground">Typical Solution Stack</h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {activeIndustry.stacks.map((stack) => (
                    <span
                      key={stack}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {stack}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to="/contact"
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Discuss This Industry Use Case
                </Link>
                <Link
                  to="/services"
                  className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:border-primary/40"
                >
                  Map to Service Lines
                </Link>
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

export default IndustriesPage;

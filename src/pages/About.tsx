import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Code2,
  Cpu,
  Eye,
  Globe,
  Lock,
  Shield,
  Sparkles,
  Target,
  Users,
  Workflow,
} from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import aboutTeam from "@/assets/about-team.jpg";

const identityPillars = [
  {
    key: "who",
    title: "Who We Are",
    subtitle: "Engineering Team with Product Mindset",
    body: "We are a software company that combines strategy, design, engineering, QA, cloud, and security capabilities to deliver reliable digital systems.",
  },
  {
    key: "what",
    title: "What We Are",
    subtitle: "Service-Based Technology Partner",
    body: "We support businesses with end-to-end services across websites, mobile apps, cloud solutions, cybersecurity, and product operations.",
  },
  {
    key: "mission",
    title: "Our Mission",
    subtitle: "Create Measurable Business Value",
    body: "To build technology solutions that solve real operational problems, improve customer experience, and help companies scale with confidence.",
  },
  {
    key: "vision",
    title: "Our Vision",
    subtitle: "Trusted Global Delivery Partner",
    body: "To become a trusted software partner known for responsible engineering, secure delivery, and long-term product outcomes.",
  },
];

const capabilityAreas = [
  {
    icon: Globe,
    title: "Web Platforms",
    desc: "Marketing websites, portals, and SaaS products designed for performance, SEO, accessibility, and conversion.",
  },
  {
    icon: Code2,
    title: "Mobile Engineering",
    desc: "Native and cross-platform apps with release discipline, monitoring, and maintainable product architecture.",
  },
  {
    icon: Cloud,
    title: "Cloud & DevOps",
    desc: "Cloud architecture, infrastructure automation, observability, and incident-ready operations.",
  },
  {
    icon: Shield,
    title: "Cybersecurity",
    desc: "Secure SDLC, vulnerability remediation, and controls aligned to practical security standards.",
  },
  {
    icon: Cpu,
    title: "Data & Applied AI",
    desc: "Data pipelines, analytics systems, and focused AI use cases tied to operational improvement.",
  },
  {
    icon: Workflow,
    title: "Delivery & Support",
    desc: "Dedicated teams, QA automation, and post-launch support for continuous improvement.",
  },
];

const deliveryPrinciples = [
  "Start with business outcomes, not features.",
  "Design architecture for reliability and scale from day one.",
  "Integrate quality and security checks into every release.",
  "Keep communication direct, transparent, and accountable.",
  "Ship in phases and measure impact continuously.",
  "Document systems for long-term maintainability.",
];

const trustSignals = [
  {
    icon: Target,
    title: "Clear Scope",
    desc: "Each engagement starts with explicit scope, assumptions, risks, and delivery milestones.",
  },
  {
    icon: Lock,
    title: "Responsible Claims",
    desc: "We avoid inflated promises and focus on verifiable deliverables and practical outcomes.",
  },
  {
    icon: Users,
    title: "Accessible Communication",
    desc: "Decision logs, sprint updates, and working demos keep stakeholders aligned throughout delivery.",
  },
];

const AboutPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero
        title="About"
        highlight="Zyllo Tech"
        description="A software company focused on dependable engineering, secure delivery, and long-term product value."
        breadcrumb="About Us"
      />

      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="grid gap-12 lg:grid-cols-2 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <span className="text-xs font-medium uppercase tracking-widest text-primary">Company Overview</span>
              <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
                Who We Are, What We Are, and Why We Exist
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Zyllo Tech helps organizations move from ideas to reliable digital products through disciplined software engineering.
                We work across product development, cloud operations, cybersecurity, and ongoing support.
              </p>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                Our approach emphasizes clarity, transparency, and measurable progress so business teams and engineering teams stay aligned from discovery to production.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {identityPillars.map((item) => (
                  <div key={item.key} className="rounded-lg border border-border bg-background p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-primary">{item.title}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{item.subtitle}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="overflow-hidden rounded-2xl border border-border shadow-sm"
            >
              <img src={aboutTeam} alt="Zyllo Tech team working on software solutions" className="w-full h-auto" />
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted/50">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <span className="text-xs font-medium uppercase tracking-widest text-primary">Capabilities</span>
            <h2 className="mt-3 font-display text-4xl md:text-5xl font-bold text-foreground">
              What We Deliver
            </h2>
          </motion.div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {capabilityAreas.map((area, i) => (
              <motion.div
                key={area.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="rounded-xl border border-border bg-background p-6 hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <area.icon size={20} />
                </div>
                <h3 className="font-display text-lg font-semibold text-foreground">{area.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{area.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="grid gap-6 md:grid-cols-2">
            {[
              {
                icon: Target,
                title: "Mission",
                body: "Deliver practical, secure, and scalable software solutions that create real business outcomes for every client.",
              },
              {
                icon: Eye,
                title: "Vision",
                body: "Be a globally trusted software partner for companies building long-term digital capabilities.",
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="rounded-xl border border-border bg-background p-7"
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <item.icon size={20} />
                </div>
                <h3 className="font-display text-2xl font-bold text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="grid gap-8 lg:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="rounded-xl border border-border bg-background p-7"
            >
              <h3 className="font-display text-2xl font-bold text-foreground">Delivery Principles</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Our delivery model is designed to reduce project risk while keeping speed and quality in balance.
              </p>
              <div className="mt-5 space-y-3">
                {deliveryPrinciples.map((item) => (
                  <div key={item} className="flex items-start gap-2 rounded-lg border border-border p-3">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" />
                    <p className="text-sm text-foreground">{item}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 }}
              className="rounded-xl border border-border bg-background p-7"
            >
              <h3 className="font-display text-2xl font-bold text-foreground">Trust & Transparency</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                For service businesses, trust is built through transparency, responsible communication, and clear operating standards.
              </p>

              <div className="mt-5 space-y-4">
                {trustSignals.map((signal) => (
                  <div key={signal.title} className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 text-foreground">
                      <signal.icon size={16} className="text-primary" />
                      <p className="text-sm font-semibold">{signal.title}</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{signal.desc}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-lg border border-border p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-primary">Company Information</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to="/contact" className="rounded border border-border px-3 py-1 text-xs text-foreground hover:border-primary/40">
                    Contact
                  </Link>
                  <Link to="/services" className="rounded border border-border px-3 py-1 text-xs text-foreground hover:border-primary/40">
                    Services
                  </Link>
                  <Link to="/privacy-policy" className="rounded border border-border px-3 py-1 text-xs text-foreground hover:border-primary/40">
                    Privacy Policy
                  </Link>
                  <Link to="/terms-of-service" className="rounded border border-border px-3 py-1 text-xs text-foreground hover:border-primary/40">
                    Terms of Service
                  </Link>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted/50">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-border bg-background p-8 text-center"
          >
            <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles size={20} />
            </div>
            <h3 className="font-display text-3xl font-bold text-foreground">Let’s Build Something Durable</h3>
            <p className="mt-3 mx-auto max-w-2xl text-sm text-muted-foreground leading-relaxed">
              Share your goals, current constraints, and timelines. We will recommend a practical solution path and delivery model.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Discuss Your Project <ArrowRight size={14} />
              </Link>
              <Link
                to="/industries"
                className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:border-primary/40"
              >
                View Industry Solutions
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default AboutPage;

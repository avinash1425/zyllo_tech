import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Code2,
  Cpu,
  Globe,
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

const impactStats = [
  { value: "5+", label: "Years Building Products" },
  { value: "30+", label: "Global Clients" },
  { value: "50+", label: "Projects Delivered" },
  { value: "6+", label: "Countries Served" },
];

const servicePillars = [
  {
    icon: Globe,
    title: "Web & Product Engineering",
    desc: "Scalable websites, web applications, and product platforms built for performance and business outcomes.",
  },
  {
    icon: Code2,
    title: "Mobile App Development",
    desc: "iOS and Android applications with reliable release pipelines, analytics, and long-term maintainability.",
  },
  {
    icon: Cloud,
    title: "Cloud & DevOps",
    desc: "Cloud-native architecture, automation, observability, and cost-aware operations for dependable systems.",
  },
  {
    icon: Shield,
    title: "Cybersecurity Engineering",
    desc: "Secure SDLC, vulnerability management, and compliance-aligned controls embedded into delivery.",
  },
  {
    icon: Cpu,
    title: "Data & Applied AI",
    desc: "Data pipelines, analytics products, and AI-assisted workflows that improve operational decisions.",
  },
  {
    icon: Workflow,
    title: "Delivery & Support",
    desc: "Dedicated teams, QA, and post-launch support models designed for continuous product improvement.",
  },
];

const executionModel = [
  {
    step: "01",
    title: "Business Discovery",
    details: "We define objectives, risk constraints, integration dependencies, and success metrics before build.",
  },
  {
    step: "02",
    title: "Solution Architecture",
    details: "We map technical architecture, delivery scope, and release phases aligned with your timelines.",
  },
  {
    step: "03",
    title: "Agile Delivery",
    details: "Cross-functional teams execute in sprints with demos, QA gates, and transparent reporting.",
  },
  {
    step: "04",
    title: "Operate & Evolve",
    details: "Post-launch monitoring, security hardening, and ongoing optimization keep products reliable.",
  },
];

const standards = [
  "Architecture-first planning before implementation",
  "Security and quality controls in every release cycle",
  "Clear engineering governance and documentation",
  "Data-driven decision making and measurable outcomes",
  "Long-term maintainability over short-term shortcuts",
  "Partnership mindset with transparent communication",
];

const AboutPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero
        title="About"
        highlight="Zyllo Tech"
        description="A software engineering company helping businesses build, modernize, and scale digital products with clarity and confidence."
        breadcrumb="About Us"
      />

      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, x: -24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <span className="text-xs font-medium uppercase tracking-widest text-primary">Who We Are</span>
              <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
                Engineering-Led Team Focused on Business Impact
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Zyllo Tech is a service-based software company delivering websites, mobile products,
                cloud platforms, cybersecurity programs, and AI-enabled systems for growth-stage and
                enterprise teams.
              </p>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                We combine product thinking with disciplined engineering so every project ships with
                clear architecture, operational readiness, and measurable outcomes.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-4">
                {impactStats.map((stat) => (
                  <div key={stat.label} className="rounded-lg border border-border bg-background p-4">
                    <div className="font-display text-3xl font-bold text-primary">{stat.value}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="overflow-hidden rounded-2xl border border-border shadow-sm"
            >
              <img src={aboutTeam} alt="Zyllo Tech team collaboration" className="w-full h-auto" />
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
            <span className="text-xs font-medium uppercase tracking-widest text-primary">What We Deliver</span>
            <h2 className="mt-3 font-display text-4xl md:text-5xl font-bold text-foreground">
              Core Capability Areas
            </h2>
          </motion.div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {servicePillars.map((pillar, i) => (
              <motion.div
                key={pillar.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="rounded-xl border border-border bg-background p-6 hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <pillar.icon size={20} />
                </div>
                <h3 className="font-display text-lg font-semibold text-foreground">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="grid gap-8 lg:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="rounded-xl border border-border bg-background p-7"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Target size={20} />
              </div>
              <h3 className="font-display text-2xl font-bold text-foreground">Execution Model</h3>
              <div className="mt-5 space-y-4">
                {executionModel.map((item) => (
                  <div key={item.step} className="rounded-lg border border-border p-4">
                    <p className="text-xs font-semibold text-primary">STEP {item.step}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.details}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 }}
              className="rounded-xl border border-border bg-background p-7"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Users size={20} />
              </div>
              <h3 className="font-display text-2xl font-bold text-foreground">How We Work</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                Our team follows engineering and delivery practices designed to reduce risk, improve
                release quality, and keep stakeholders aligned.
              </p>

              <div className="mt-5 space-y-3">
                {standards.map((item) => (
                  <div key={item} className="flex items-start gap-2 rounded-lg border border-border p-3">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" />
                    <p className="text-sm text-foreground">{item}</p>
                  </div>
                ))}
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
            <h3 className="font-display text-3xl font-bold text-foreground">Build With a Reliable Technology Partner</h3>
            <p className="mt-3 mx-auto max-w-2xl text-sm text-muted-foreground leading-relaxed">
              If you are planning a new product, modernization initiative, or industry-specific
              digital platform, we can help you define the roadmap and deliver it with confidence.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Start a Conversation <ArrowRight size={14} />
              </Link>
              <Link
                to="/services"
                className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:border-primary/40"
              >
                Explore Services
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

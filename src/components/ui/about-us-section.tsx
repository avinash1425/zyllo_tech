"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Award,
  Calendar,
  CheckCircle,
  Cloud,
  Code2,
  Cpu,
  Lock,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Workflow,
  Globe,
} from "lucide-react";
import { motion, useInView, useScroll, useSpring, useTransform } from "framer-motion";
import { Link } from "react-router-dom";

type Capability = {
  title: string;
  description: string;
  icon: JSX.Element;
  position: "left" | "right";
};

const capabilities: Capability[] = [
  {
    title: "Web Engineering",
    description:
      "High-performance websites, portals, and SaaS experiences built for conversion, reliability, and maintainability.",
    icon: <Code2 className="h-6 w-6" />,
    position: "left",
  },
  {
    title: "Mobile Development",
    description:
      "iOS and Android products with stable releases, app analytics, and long-term architecture choices.",
    icon: <Workflow className="h-6 w-6" />,
    position: "left",
  },
  {
    title: "Cloud & DevOps",
    description:
      "Scalable cloud infrastructure, CI/CD automation, observability, and incident-ready platform operations.",
    icon: <Cloud className="h-6 w-6" />,
    position: "left",
  },
  {
    title: "Cybersecurity",
    description:
      "Secure engineering practices, vulnerability remediation, and risk-driven controls across application and cloud layers.",
    icon: <Shield className="h-6 w-6" />,
    position: "right",
  },
  {
    title: "Data & Applied AI",
    description:
      "Data pipelines, analytics workflows, and practical AI features connected directly to business outcomes.",
    icon: <Cpu className="h-6 w-6" />,
    position: "right",
  },
  {
    title: "Support & Evolution",
    description:
      "Post-launch maintenance, performance optimization, and release planning to keep products improving.",
    icon: <TrendingUp className="h-6 w-6" />,
    position: "right",
  },
];

const identity = [
  {
    title: "Who We Are",
    text: "A software company focused on dependable engineering, clear execution, and long-term product value.",
  },
  {
    title: "What We Are",
    text: "A service-based technology partner delivering websites, mobile apps, cloud platforms, and cybersecurity.",
  },
  {
    title: "Our Mission",
    text: "Build practical digital solutions that improve operations, customer experience, and business growth.",
  },
  {
    title: "Our Vision",
    text: "Become a trusted global partner known for responsible delivery, security-first execution, and transparency.",
  },
];

const stats = [
  { icon: <Award />, value: 6, label: "Core Service Lines", suffix: "" },
  { icon: <Users />, value: 12, label: "Industry Coverage Areas", suffix: "" },
  { icon: <Calendar />, value: 4, label: "Delivery Phases", suffix: "" },
  { icon: <Lock />, value: 100, label: "Security-First Delivery", suffix: "%" },
];

export default function AboutUsSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sectionRef, { once: false, amount: 0.1 });
  const isStatsInView = useInView(statsRef, { once: false, amount: 0.3 });
  const [mounted, setMounted] = useState(false);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  const yLeftBlob = useTransform(scrollYProgress, [0, 1], [0, -40]);
  const yRightBlob = useTransform(scrollYProgress, [0, 1], [0, 40]);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <section
      id="about-us-section"
      ref={sectionRef}
      className="relative w-full overflow-hidden bg-gradient-to-b from-muted/20 to-background px-4 py-20 text-foreground"
    >
      <motion.div
        className="absolute left-8 top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
        style={{ y: yLeftBlob }}
      />
      <motion.div
        className="absolute bottom-20 right-8 h-64 w-64 rounded-full bg-[hsl(195,55%,42%,0.12)] blur-3xl"
        style={{ y: yRightBlob }}
      />

      <motion.div
        className="container relative z-10 mx-auto max-w-6xl"
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="mb-10 flex flex-col items-center">
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            <Sparkles className="h-4 w-4" /> About Zyllo Tech
          </span>
          <h2 className="text-center font-display text-4xl font-bold md:text-5xl">Engineering With Accountability</h2>
          <div className="mt-4 h-1 w-24 rounded-full bg-primary" />
          <p className="mx-auto mt-5 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground md:text-base">
            We build and scale software systems for businesses that want clear architecture, secure execution,
            and predictable delivery.
          </p>
        </div>

        <div className="mb-12 grid gap-4 sm:grid-cols-2">
          {identity.map((item) => (
            <motion.div
              key={item.title}
              initial={{ y: 16, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              className="rounded-xl border border-border bg-background p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{item.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.text}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div className="space-y-10">
            {capabilities
              .filter((item) => item.position === "left")
              .map((item) => (
                <CapabilityCard key={item.title} item={item} />
              ))}
          </div>

          <div className="order-first flex items-center justify-center md:order-none">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              whileInView={{ scale: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="relative w-full max-w-xs"
            >
              <div className="overflow-hidden rounded-xl border border-border shadow-lg">
                <img
                  src="https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1400&auto=format&fit=crop"
                  alt="Software team planning architecture"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[hsl(215,30%,16%,0.7)] to-transparent p-4">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[hsl(215,30%,16%)] shadow-sm">
                    <Globe className="h-4.5 w-4.5" strokeWidth={2.1} /> About Us
                  </span>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="space-y-10">
            {capabilities
              .filter((item) => item.position === "right")
              .map((item) => (
                <CapabilityCard key={item.title} item={item} />
              ))}
          </div>
        </div>

        <motion.div
          ref={statsRef}
          className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4"
          initial={{ opacity: 0 }}
          animate={isStatsInView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          {stats.map((stat, index) => (
            <StatCounter key={stat.label} {...stat} delay={index * 0.08} active={mounted && isStatsInView} />
          ))}
        </motion.div>

        <motion.div
          className="mt-16 flex flex-col items-center justify-between gap-5 rounded-xl border border-border bg-[hsl(215,30%,16%)] p-7 text-white md:flex-row"
          initial={{ y: 20, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
        >
          <div>
            <h3 className="text-2xl font-semibold">Plan Your Product Roadmap With Us</h3>
            <p className="mt-1 text-sm text-white/70">Share your use case, constraints, and goals. We will map a practical solution path.</p>
          </div>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Start Conversation <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </motion.div>
    </section>
  );
}

function CapabilityCard({ item }: { item: Capability }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -4 }}
      className="rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/40"
    >
      <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">{item.icon}</div>
      <h3 className="font-display text-lg font-semibold">{item.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
        <CheckCircle className="h-3.5 w-3.5" /> Delivery-ready
      </div>
    </motion.article>
  );
}

function StatCounter({
  icon,
  value,
  label,
  suffix,
  delay,
  active,
}: {
  icon: JSX.Element;
  value: number;
  label: string;
  suffix: string;
  delay: number;
  active: boolean;
}) {
  const spring = useSpring(0, { stiffness: 50, damping: 14 });
  const output = useTransform(spring, (latest) => Math.floor(latest));

  useEffect(() => {
    spring.set(active ? value : 0);
  }, [active, value, spring]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay }}
      className="rounded-xl border border-border bg-background p-5 text-center"
    >
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</div>
      <div className="font-display text-3xl font-bold text-foreground">
        <motion.span>{output}</motion.span>
        <span>{suffix}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </motion.div>
  );
}

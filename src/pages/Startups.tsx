import { motion } from "framer-motion";
import { ExternalLink, ArrowRight, Rocket, IndianRupee, Globe2, Brain } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import { Link } from "react-router-dom";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const startups = [
  {
    name: "ArthaAI",
    tagline: "Smart Money Guidance for Every Indian",
    description:
      "India's first AI-powered personal finance guidance platform — multilingual, unbiased, and built for Bharat. ArthaAI makes financial clarity accessible to 400M+ underserved Indians in 22 languages. No jargon. No commission bias. No English required.",
    status: "In Development",
    statusColor: "text-amber-400",
    statusBg: "bg-amber-400/10 border-amber-400/30",
    stage: "MVP Launching June 2026",
    modules: ["ArthaCalc — Smart Calculators", "ArthaPlanner — Life Planning", "ArthaGuru — Education Engine"],
    highlights: [
      { icon: Globe2, value: "22", label: "Indian Languages" },
      { icon: IndianRupee, value: "400M+", label: "Target Users" },
      { icon: Brain, value: "100+", label: "Financial Formulas" },
    ],
    tags: ["FinTech", "AI/ML", "EdTech", "Bharat", "Multilingual"],
    color: "from-orange-600/20 to-orange-900/10",
    accentColor: "text-orange-400",
    borderColor: "border-orange-500/30",
    href: "/arthaai/",
    isExternal: true,
  },
];

const StartupsPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Startups by Zyllo Tech | ArthaAI — AI-Powered Finance for India"
        description="Discover startups incubated and built by Zyllo Tech. ArthaAI is India's first multilingual AI-powered personal finance platform, democratising financial guidance for 400M+ Indians."
        canonical="/startups"
        keywords="Zyllo Tech startups, ArthaAI, Indian fintech startup, AI finance India, multilingual finance app, startup incubation India, Zyllo Tech ventures"
        structuredData={[
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Startups", url: `${SITE_URL}/startups` },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Startups by Zyllo Tech",
            description: "Startup ventures incubated and built by Zyllo Tech Software Solutions.",
            url: `${SITE_URL}/startups`,
            hasPart: [
              {
                "@type": "SoftwareApplication",
                name: "ArthaAI",
                applicationCategory: "FinanceApplication",
                description: "India's first AI-powered multilingual personal finance guidance platform.",
                url: `${SITE_URL}/arthaai/`,
              },
            ],
          },
        ]}
      />
      <Navbar />
      <PageHero
        title="Our"
        highlight="Startups"
        description="Beyond client delivery — Zyllo Tech builds its own ventures. Products born from real problems, engineered for massive impact."
        breadcrumb="Startups"
      />

      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6 max-w-5xl">
          {/* Intro */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-16 rounded-2xl border border-border bg-muted/30 p-8 text-center"
          >
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 border border-primary/20 px-4 py-1.5 text-xs font-semibold text-primary mb-4">
              <Rocket size={13} />
              Startup Studio
            </div>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-3">
              Built by Zyllo Tech. Built for Bharat.
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-sm leading-relaxed">
              We don't just build software for others — we identify unsolved problems and engineer our own solutions. Each startup is fully owned, designed, and developed in-house by the Zyllo Tech team.
            </p>
          </motion.div>

          {/* Startup Cards */}
          <div className="flex flex-col gap-10">
            {startups.map((startup, i) => (
              <motion.div
                key={startup.name}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.55, delay: i * 0.08 }}
                className={`group rounded-2xl border ${startup.borderColor} bg-gradient-to-br ${startup.color} p-8 hover:shadow-xl transition-all duration-300`}
              >
                <div className="flex flex-col md:flex-row md:items-start gap-6">
                  {/* Left: Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <h3 className="font-display text-2xl font-bold text-foreground">{startup.name}</h3>
                      <span className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${startup.statusBg} ${startup.statusColor}`}>
                        {startup.status}
                      </span>
                    </div>
                    <p className={`text-sm font-semibold mb-3 ${startup.accentColor}`}>{startup.tagline}</p>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-5">{startup.description}</p>

                    {/* Modules */}
                    <div className="mb-5">
                      <p className="text-xs font-semibold text-foreground/60 uppercase tracking-widest mb-2">Core Modules</p>
                      <ul className="flex flex-col gap-1.5">
                        {startup.modules.map((mod) => (
                          <li key={mod} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className={`size-1.5 rounded-full ${startup.accentColor.replace("text-", "bg-")}`} />
                            {mod}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-2 mb-5">
                      {startup.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-background/50 border border-border px-2.5 py-0.5 text-xs font-medium text-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    <p className="text-xs text-muted-foreground/70 italic mb-5">{startup.stage}</p>

                    <a
                      href={startup.href}
                      target={startup.isExternal ? "_blank" : undefined}
                      rel={startup.isExternal ? "noopener noreferrer" : undefined}
                      className={`inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-md`}
                    >
                      Explore ArthaAI
                      <ExternalLink size={14} />
                    </a>
                  </div>

                  {/* Right: Highlights */}
                  <div className="md:w-52 shrink-0">
                    <div className="rounded-xl border border-border/60 bg-background/40 p-5 space-y-5">
                      {startup.highlights.map((h) => (
                        <div key={h.label} className="flex items-center gap-3">
                          <div className={`flex size-9 items-center justify-center rounded-lg bg-background/60 border border-border ${startup.accentColor}`}>
                            <h.icon size={16} />
                          </div>
                          <div>
                            <div className={`font-display text-lg font-bold ${startup.accentColor}`}>{h.value}</div>
                            <div className="text-[11px] text-muted-foreground leading-tight">{h.label}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-muted/50">
        <div className="container mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl bg-[hsl(215,25%,15%)] p-12 text-center"
          >
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
              Have a <span className="text-primary">Startup Idea?</span>
            </h2>
            <p className="text-white/70 mb-8 max-w-lg mx-auto">
              We partner with founders to engineer their vision — from MVP to scale. Let's build something that matters.
            </p>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-md"
            >
              Talk to Us
              <ArrowRight size={16} />
            </Link>
          </motion.div>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default StartupsPage;

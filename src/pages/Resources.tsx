import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Bot, FileText, Layers, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";

const resources = [
  {
    title: "AI Playbooks",
    description: "Practical guides for introducing AI features into business workflows.",
    icon: Bot,
    href: "/blog",
    tag: "AI-Powered",
  },
  {
    title: "Engineering Insights",
    description: "Architecture patterns, scaling tips, and code quality best practices.",
    icon: Layers,
    href: "/blog",
    tag: "Engineering",
  },
  {
    title: "Product Templates",
    description: "Kickoff documents, discovery checklists, and roadmap templates.",
    icon: FileText,
    href: "/contact",
    tag: "Templates",
  },
  {
    title: "Case Stories",
    description: "Real examples of delivery outcomes from idea to production launch.",
    icon: BookOpen,
    href: "/contact",
    tag: "Case Study",
  },
];

const Resources = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero
        title="Resources"
        highlight="Hub"
        description="Explore practical resources across AI, engineering, product strategy, and delivery execution."
        breadcrumb="Resources"
      />

      <section className="py-20">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-10 rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/10 via-background to-[hsl(195,55%,42%,0.08)] p-6 md:p-8"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Sparkles size={12} />
                  AI Capability
                </p>
                <h2 className="mt-3 font-display text-2xl font-bold text-foreground md:text-3xl">
                  AI-powered discovery and faster delivery workflows
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
                  We combine human engineering quality with AI-assisted research, design acceleration,
                  and quality checks to reduce cycle time while improving output quality.
                </p>
              </div>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Talk to Us
                <ArrowRight size={15} />
              </Link>
            </div>
          </motion.div>

          <div className="grid gap-6 sm:grid-cols-2">
            {resources.map((resource, i) => (
              <motion.article
                key={resource.title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="group rounded-xl border border-border bg-background p-6 hover:border-primary/40 hover:shadow-md transition-all"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <resource.icon size={18} />
                  </div>
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                    {resource.tag}
                  </span>
                </div>
                <h3 className="font-display text-lg font-bold text-foreground">{resource.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{resource.description}</p>
                <Link
                  to={resource.href}
                  className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                >
                  Explore
                  <ArrowRight size={14} />
                </Link>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default Resources;

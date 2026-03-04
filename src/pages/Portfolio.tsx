import { useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Users, Clock, Award, ArrowRight, ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import { Link } from "react-router-dom";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const categories = ["All", "Web App", "Mobile", "AI/ML", "Cloud", "E-Commerce"];

const projects = [
  {
    title: "FinEdge Banking Dashboard",
    client: "FinEdge Solutions",
    industry: "Banking & Financial Services",
    type: "Web App",
    description:
      "A comprehensive core banking dashboard with real-time transaction monitoring, compliance reporting, and advanced analytics. Built with high-security standards and multi-role access control.",
    tags: ["React", "Node.js", "PostgreSQL", "AWS"],
    metrics: [
      { icon: TrendingUp, value: "40%", label: "Efficiency Boost" },
      { icon: Users, value: "5K+", label: "Daily Users" },
      { icon: Clock, value: "3 mo", label: "Delivered In" },
    ],
    color: "from-blue-600/20 to-blue-800/10",
    accentColor: "text-blue-400",
    borderColor: "border-blue-500/30",
  },
  {
    title: "MedCare Patient Portal",
    client: "MedCare Innovations",
    industry: "Healthcare",
    type: "Web App",
    description:
      "End-to-end patient management platform with AI-powered appointment scheduling, telemedicine integration, electronic health records, and real-time doctor-patient messaging.",
    tags: ["React", "Python", "FastAPI", "MongoDB", "Azure"],
    metrics: [
      { icon: TrendingUp, value: "35%", label: "Fewer No-Shows" },
      { icon: Users, value: "12K+", label: "Patients Served" },
      { icon: Clock, value: "5 mo", label: "Delivered In" },
    ],
    color: "from-teal-600/20 to-teal-800/10",
    accentColor: "text-teal-400",
    borderColor: "border-teal-500/30",
  },
  {
    title: "RetailX Commerce Platform",
    client: "RetailX Global",
    industry: "Retail & E-Commerce",
    type: "E-Commerce",
    description:
      "Highly scalable multi-vendor e-commerce platform capable of handling peak traffic spikes. Includes real-time inventory, advanced search, recommendation engine, and analytics dashboard.",
    tags: ["Next.js", "Node.js", "Redis", "Kubernetes", "GCP"],
    metrics: [
      { icon: TrendingUp, value: "10x", label: "Traffic Handled" },
      { icon: Users, value: "200K+", label: "Monthly Visitors" },
      { icon: Award, value: "99.9%", label: "Uptime SLA" },
    ],
    color: "from-orange-600/20 to-orange-800/10",
    accentColor: "text-orange-400",
    borderColor: "border-orange-500/30",
  },
  {
    title: "LogiTrack Fleet Management",
    client: "LogiTrack Systems",
    industry: "Logistics & Transportation",
    type: "Mobile",
    description:
      "Real-time fleet tracking and route optimization system with a mobile app for drivers, dispatchers, and management. Integrated with GPS, IoT sensors, and ERP systems.",
    tags: ["React Native", "Node.js", "PostgreSQL", "AWS IoT"],
    metrics: [
      { icon: TrendingUp, value: "28%", label: "Cost Reduction" },
      { icon: Clock, value: "22%", label: "Faster Delivery" },
      { icon: Users, value: "500+", label: "Fleet Vehicles" },
    ],
    color: "from-purple-600/20 to-purple-800/10",
    accentColor: "text-purple-400",
    borderColor: "border-purple-500/30",
  },
  {
    title: "EduSpark Learning Platform",
    client: "EduSpark Academy",
    industry: "Education & EdTech",
    type: "Web App",
    description:
      "Interactive learning platform with live classes, AI-generated assessments, gamified progress tracking, and parent dashboards. Supports 10,000+ concurrent learners.",
    tags: ["React", "Python", "TensorFlow", "WebRTC", "PostgreSQL"],
    metrics: [
      { icon: TrendingUp, value: "60%", label: "Engagement Rise" },
      { icon: Users, value: "10K+", label: "Students" },
      { icon: Award, value: "4.9/5", label: "App Rating" },
    ],
    color: "from-emerald-600/20 to-emerald-800/10",
    accentColor: "text-emerald-400",
    borderColor: "border-emerald-500/30",
  },
  {
    title: "SmartFarm AI Analytics",
    client: "AgroTech Partners",
    industry: "Agriculture & Environment",
    type: "AI/ML",
    description:
      "AI-powered precision agriculture platform that analyzes satellite imagery, soil data, and weather patterns to provide actionable crop recommendations and yield predictions.",
    tags: ["Python", "TensorFlow", "Computer Vision", "FastAPI", "AWS SageMaker"],
    metrics: [
      { icon: TrendingUp, value: "22%", label: "Yield Increase" },
      { icon: Users, value: "300+", label: "Farms Monitored" },
      { icon: Clock, value: "4 mo", label: "Delivered In" },
    ],
    color: "from-lime-600/20 to-lime-800/10",
    accentColor: "text-lime-400",
    borderColor: "border-lime-500/30",
  },
  {
    title: "CloudMigrate Enterprise Suite",
    client: "TechCorp International",
    industry: "IT Services",
    type: "Cloud",
    description:
      "Full cloud migration and modernization of a legacy monolith to microservices architecture on AWS. Included CI/CD pipelines, monitoring, disaster recovery, and cost optimization.",
    tags: ["AWS", "Terraform", "Docker", "Kubernetes", "Datadog"],
    metrics: [
      { icon: TrendingUp, value: "45%", label: "Cost Savings" },
      { icon: Clock, value: "2x", label: "Deploy Speed" },
      { icon: Award, value: "99.99%", label: "Uptime" },
    ],
    color: "from-sky-600/20 to-sky-800/10",
    accentColor: "text-sky-400",
    borderColor: "border-sky-500/30",
  },
  {
    title: "BetaPlay Sports Sportsbook",
    client: "BetaPlay Gaming",
    industry: "Gaming & Entertainment",
    type: "Web App",
    description:
      "High-performance sports betting platform with real-time odds, live match data, wallet management, KYC verification, and a responsive web & mobile experience.",
    tags: ["React", "Node.js", "Redis", "WebSocket", "PostgreSQL"],
    metrics: [
      { icon: Users, value: "50K+", label: "Registered Users" },
      { icon: TrendingUp, value: "3ms", label: "Avg Latency" },
      { icon: Award, value: "99.9%", label: "Uptime" },
    ],
    color: "from-rose-600/20 to-rose-800/10",
    accentColor: "text-rose-400",
    borderColor: "border-rose-500/30",
  },
  {
    title: "PropView Real Estate CRM",
    client: "PropView Realty",
    industry: "Real Estate",
    type: "Web App",
    description:
      "Full-featured CRM for real estate agencies with property listings, virtual tours, lead management, automated follow-ups, and a buyer portal with document e-signing.",
    tags: ["React", "Django", "PostgreSQL", "AWS S3", "Stripe"],
    metrics: [
      { icon: TrendingUp, value: "55%", label: "Lead Conversion" },
      { icon: Users, value: "1.2K+", label: "Agents Using It" },
      { icon: Clock, value: "6 mo", label: "Delivered In" },
    ],
    color: "from-amber-600/20 to-amber-800/10",
    accentColor: "text-amber-400",
    borderColor: "border-amber-500/30",
  },
];

const PortfolioPage = () => {
  const [activeCategory, setActiveCategory] = useState("All");

  const filtered =
    activeCategory === "All"
      ? projects
      : projects.filter((p) => p.type === activeCategory);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Software Development Portfolio & Case Studies | Zyllo Tech"
        description="Explore Zyllo Tech's portfolio of delivered software projects — a FinTech banking dashboard, patient portal, headless commerce platform, IoT fleet tracker, EdTech LMS, AI farm analytics, and more."
        canonical="/portfolio"
        keywords="software portfolio India, IT company case studies, fintech software case study, healthcare portal development, e-commerce platform, fleet management system, AI ML case study India"
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "Portfolio", url: `${SITE_URL}/portfolio` },
        ])}
      />
      <Navbar />
      <PageHero
        title="Our"
        highlight="Portfolio"
        description="A showcase of the innovative digital solutions we've built for clients across industries — from fintech to farming."
        breadcrumb="Portfolio"
      />

      <section className="py-24">
        <div className="container mx-auto px-6">
          {/* Category Filter */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-wrap justify-center gap-3 mb-14"
          >
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-200 border ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground border-primary shadow-md"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground bg-background"
                }`}
              >
                {cat}
              </button>
            ))}
          </motion.div>

          {/* Project Grid */}
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((project, i) => (
              <motion.div
                key={project.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.07 }}
                className={`group rounded-2xl border ${project.borderColor} bg-gradient-to-br ${project.color} p-7 hover:shadow-lg transition-all duration-300 flex flex-col`}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className={`text-xs font-semibold uppercase tracking-widest ${project.accentColor}`}>
                      {project.industry}
                    </span>
                    <h3 className="font-display text-lg font-bold text-foreground mt-1 leading-tight">
                      {project.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{project.client}</p>
                  </div>
                  <span className="rounded-full bg-background/60 border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground shrink-0 ml-2">
                    {project.type}
                  </span>
                </div>

                {/* Description */}
                <p className="text-sm text-muted-foreground leading-relaxed mb-5 flex-1">
                  {project.description}
                </p>

                {/* Tags */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {project.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-background/50 border border-border px-2.5 py-0.5 text-xs font-medium text-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-3 border-t border-border/60 pt-4">
                  {project.metrics.map((metric) => (
                    <div key={metric.label} className="text-center">
                      <metric.icon size={14} className={`mx-auto mb-1 ${project.accentColor}`} />
                      <div className={`font-display text-base font-bold ${project.accentColor}`}>
                        {metric.value}
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-tight">
                        {metric.label}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-muted/50">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl bg-[hsl(215,25%,15%)] p-12 text-center"
          >
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
              Have a Project in <span className="text-primary">Mind?</span>
            </h2>
            <p className="text-white/70 mb-8 max-w-lg mx-auto">
              Let's build something remarkable together. Tell us about your vision and we'll turn it into reality.
            </p>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-md"
            >
              Start a Project
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

export default PortfolioPage;

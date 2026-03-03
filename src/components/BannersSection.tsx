import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import bannerDigital from "@/assets/banner-digital.jpg";
import bannerTransform from "@/assets/banner-transform.jpg";
import bannerSoftware from "@/assets/banner-software.jpg";
import bannerAi from "@/assets/banner-ai.jpg";
import bannerCloud from "@/assets/banner-cloud.jpg";
import bannerDesign from "@/assets/banner-design.jpg";

const slides = [
  {
    image: bannerDigital,
    badge: "End-to-End Digital Solutions",
    titleStart: "We Build the Future of",
    titleAccent: "Digital",
    description: "End to End Solutions for all kinds of business applications. Software Development, AI, Cloud, Design & Marketing.",
    link: "/contact",
    cta: "Start Your Project",
    secondaryLink: "/about",
    secondaryCta: "Learn More",
    tags: ["Software Dev", "AI & ML", "Cloud Solutions", "UI/UX Design"],
  },
  {
    image: bannerTransform,
    badge: "Innovation & Technology",
    titleStart: "Your Digital Transformation",
    titleAccent: "Partner",
    description: "We deliver cutting-edge digital solutions that empower businesses to thrive in the modern world.",
    link: "/about",
    cta: "Learn More",
    secondaryLink: "/contact",
    secondaryCta: "Request a Quote",
    tags: ["Digital Strategy", "Consulting", "Automation"],
  },
  {
    image: bannerSoftware,
    badge: "Web & Mobile Applications",
    titleStart: "Custom Software",
    titleAccent: "Development",
    description: "End-to-end custom software solutions built for performance, scalability, and your unique business needs.",
    link: "/services",
    cta: "Explore Services",
    secondaryLink: "/contact",
    secondaryCta: "Request a Quote",
    tags: ["React", "Node.js", "Mobile Apps", "APIs"],
  },
  {
    image: bannerAi,
    badge: "Intelligent Automation",
    titleStart: "AI & Machine",
    titleAccent: "Learning",
    description: "Harness the power of artificial intelligence to automate processes, unlock insights, and drive innovation.",
    link: "/services",
    cta: "Discover AI",
    secondaryLink: "/contact",
    secondaryCta: "Request a Quote",
    tags: ["NLP", "Computer Vision", "Predictive Analytics"],
  },
  {
    image: bannerCloud,
    badge: "Infrastructure & DevOps",
    titleStart: "Scalable Cloud",
    titleAccent: "Solutions",
    description: "Scalable cloud architecture, migration, and managed services to keep your business running seamlessly.",
    link: "/services",
    cta: "Learn More",
    secondaryLink: "/contact",
    secondaryCta: "Request a Quote",
    tags: ["AWS", "Azure", "DevOps", "Kubernetes"],
  },
  {
    image: bannerDesign,
    badge: "UI/UX & Digital Strategy",
    titleStart: "Design &",
    titleAccent: "Marketing",
    description: "Stunning designs and data-driven marketing strategies that captivate audiences and drive conversions.",
    link: "/services",
    cta: "See Our Work",
    secondaryLink: "/contact",
    secondaryCta: "Request a Quote",
    tags: ["UI/UX", "Branding", "SEO", "Social Media"],
  },
];

const quickLinks = [
  { label: "Our Services", href: "/services" },
  { label: "Contact Us", href: "/contact" },
  { label: "Industries", href: "/industries" },
];

const BannersSection = () => {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1);

  const next = useCallback(() => {
    setDirection(1);
    setCurrent((prev) => (prev + 1) % slides.length);
  }, []);

  useEffect(() => {
    const timer = setInterval(next, 6000);
    return () => clearInterval(timer);
  }, [next]);

  const slide = slides[current];

  return (
    <section className="relative w-full h-[75vh] md:h-[90vh] overflow-hidden bg-foreground">
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={current}
          custom={direction}
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
          className="absolute inset-0"
        >
          <img
            src={slide.image}
            alt={slide.titleStart + " " + slide.titleAccent}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[hsl(215,30%,10%,0.55)] via-[hsl(215,30%,10%,0.6)] to-[hsl(215,30%,10%,0.75)]" />
        </motion.div>
      </AnimatePresence>

      {/* Content */}
      <div className="absolute inset-0 flex items-center justify-center z-[5]">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center">
            <motion.div
              key={`tags-${current}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.6 }}
              className="flex flex-wrap items-center justify-center gap-2 mb-6"
            >
              {slide.tags?.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm px-3.5 py-1.5 text-xs font-medium text-white/90 tracking-wide"
                >
                  {tag}
                </span>
              ))}
            </motion.div>

            <motion.span
              key={`badge-${current}`}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="inline-block text-primary text-xs sm:text-sm font-semibold tracking-[0.2em] uppercase mb-4"
            >
              {slide.badge}
            </motion.span>

            <motion.h2
              key={`title-${current}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-5 leading-tight"
            >
              {slide.titleStart}{" "}
              <span className="text-primary">{slide.titleAccent}</span>
            </motion.h2>

            <motion.p
              key={`desc-${current}`}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}
              className="text-white/70 text-sm sm:text-base md:text-lg mb-8 max-w-xl mx-auto leading-relaxed"
            >
              {slide.description}
            </motion.p>

            <motion.div
              key={`cta-${current}`}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.5 }}
              className="flex flex-wrap items-center justify-center gap-4 mb-8"
            >
              <Link
                to={slide.link}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-lg"
              >
                {slide.cta}
                <ArrowRight size={16} />
              </Link>
              <Link
                to={slide.secondaryLink}
                className="inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/5 backdrop-blur-sm px-7 py-3.5 text-sm font-semibold text-white hover:bg-white/10 transition-all"
              >
                {slide.secondaryCta}
              </Link>
            </motion.div>

            <motion.div
              key={`quick-${current}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.5 }}
              className="flex items-center justify-center gap-6 text-xs text-white/50"
            >
              {quickLinks.map((ql) => (
                <Link
                  key={ql.label}
                  to={ql.href}
                  className="flex items-center gap-1 hover:text-white/80 transition-colors"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {ql.label}
                </Link>
              ))}
            </motion.div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 text-white/40 text-xs flex flex-col items-center gap-2">
        <span>Scroll to explore</span>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="w-px h-6 bg-white/30"
        />
      </div>

      {/* Dots */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              setDirection(i > current ? 1 : -1);
              setCurrent(i);
            }}
            className={`h-2.5 rounded-full transition-all duration-300 ${
              i === current ? "w-8 bg-primary" : "w-2.5 bg-white/40"
            }`}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </section>
  );
};

export default BannersSection;

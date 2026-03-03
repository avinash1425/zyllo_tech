import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import heroBg from "@/assets/hero-dark.jpg";

const HeroSection = () => {
  return (
    <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img src={heroBg} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[hsl(215,25%,12%)] via-[hsl(215,25%,12%,0.85)] to-[hsl(215,25%,12%,0.5)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(215,25%,12%)] via-transparent to-[hsl(215,25%,12%,0.6)]" />
      </div>

      <div className="container relative z-10 mx-auto px-4 sm:px-6 pt-20 pb-12">
        <div className="max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="mb-5"
          >
            <span className="inline-block rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium text-white tracking-wider uppercase">
              Your Digital Transformation Partner
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="font-display text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[0.95] tracking-tight mb-4"
          >
            <span className="text-white">We Build the</span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[hsl(24,95%,50%)] to-[hsl(24,95%,65%)]">Future of Digital</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="max-w-xl text-lg text-white/70 mb-8"
          >
            End to End Solutions for all kinds of business applications.
            Software Development, AI, Cloud, Design & Marketing.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="flex flex-col sm:flex-row items-start gap-4"
          >
            <Link
              to="/contact"
              className="group flex items-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-lg"
            >
              Start Your Project
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/services"
              className="rounded-lg border border-white/30 px-8 py-3.5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
            >
              Explore Our Capabilities
            </Link>
          </motion.div>
        </div>

        {/* Stats bar */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1 }}
          className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-6 border-t border-white/20 pt-6"
        >
          {[
            { value: "50+", label: "Projects Delivered" },
            { value: "30+", label: "Happy Clients" },
            { value: "5+", label: "Years Experience" },
            { value: "6+", label: "Countries Served" },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="font-display text-3xl md:text-4xl font-bold text-[hsl(24,95%,50%)]">{stat.value}</div>
              <div className="mt-1 text-sm text-white/60">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>

    </section>
  );
};

export default HeroSection;

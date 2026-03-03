import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

const CTASection = () => {
  return (
    <section id="contact" className="relative py-16 lg:py-20 bg-muted/50">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="relative overflow-hidden rounded-2xl bg-[hsl(215,25%,15%)] p-10 md:p-16 text-center shadow-lg"
        >
          {/* Decorative background blobs */}
          <div className="pointer-events-none absolute -top-16 -left-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-[hsl(195,55%,42%)]/10 blur-3xl" />

          <div className="relative inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary mb-5">
            <Sparkles size={12} />
            Free Consultation Available
          </div>

          <h2 className="relative font-display text-3xl md:text-4xl font-bold mb-4 text-white">
            Ready to <span className="text-primary">Get Started?</span>
          </h2>
          <p className="relative mx-auto max-w-lg text-white/70 mb-8">
            Let's discuss how Zyllo Tech can help bring your vision to life.
            Get in touch today for a free consultation.
          </p>
          <div className="relative flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/contact"
              className="group flex items-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-md"
            >
              Contact Us
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="tel:+91705773680"
              className="rounded-lg border border-white/30 px-8 py-3.5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
            >
              Call Us Today
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;

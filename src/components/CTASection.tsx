import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
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
              href="tel:+919999999999"
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

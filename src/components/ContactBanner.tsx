import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, Mail } from "lucide-react";

const ContactBanner = () => {
  return (
    <section className="py-12">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="relative overflow-hidden rounded-2xl border border-border bg-background p-8 md:p-12 flex flex-col md:flex-row items-center gap-6 shadow-sm"
        >
          <div className="flex-1">
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-2">
              Let's Help You With Your Queries
            </h2>
            <p className="text-muted-foreground">
              Share your project requirements. We're looking forward to your message.
            </p>
          </div>
          <div className="flex gap-4 flex-wrap">
            <Link
              to="/contact"
              className="group flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-md"
            >
              Contact Us
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="mailto:info@zyllotech.com"
              className="flex items-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Mail size={16} />
              Email Us
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default ContactBanner;

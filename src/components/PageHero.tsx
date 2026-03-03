import { motion } from "framer-motion";

interface PageHeroProps {
  title: string;
  highlight: string;
  description: string;
  breadcrumb?: string;
}

const PageHero = ({ title, highlight, description, breadcrumb }: PageHeroProps) => {
  return (
    <section className="relative pt-28 pb-16 overflow-hidden bg-[hsl(215,25%,15%)]">
      <div className="container relative z-10 mx-auto px-4 sm:px-6 text-center">
        {breadcrumb && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 text-xs text-white/50 uppercase tracking-widest"
          >
            Home / {breadcrumb}
          </motion.div>
        )}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="font-display text-3xl md:text-5xl font-bold text-white mb-4"
        >
          {title} <span className="text-primary">{highlight}</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mx-auto max-w-2xl text-white/60"
        >
          {description}
        </motion.p>
      </div>
    </section>
  );
};

export default PageHero;

import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import careersBanner from "@/assets/careers-banner.jpg";

const CareersSection = () => {
  return (
    <section className="py-16 lg:py-20">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="text-xs font-medium uppercase tracking-widest text-primary">Careers</span>
            <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
              Join the Best Team of <span className="text-primary">Experts</span>
            </h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              Together we dream, aspire and create opportunities for people to grow in their career. 
              Be part of a team that's shaping the future of technology.
            </p>
            <div className="mt-6">
              <Link
                to="/careers"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-md"
              >
                View Open Positions
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="rounded-2xl overflow-hidden border border-border shadow-sm"
          >
            <img src={careersBanner} alt="Careers at Zyllo Tech" className="w-full h-72 object-cover" />
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default CareersSection;

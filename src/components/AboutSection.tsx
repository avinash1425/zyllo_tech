import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import teamImg from "@/assets/team-dark.jpg";

const highlights = [
  "Expert team of developers, designers & strategists",
  "Agile development with transparent communication",
  "Cutting-edge AI integration for smarter solutions",
  "End-to-end project delivery from concept to launch",
  "Scalable architectures built for growth",
  "Dedicated post-launch support & maintenance",
];

const AboutSection = () => {
  return (
    <section id="about" className="relative py-16 lg:py-20">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="text-xs font-medium uppercase tracking-widest text-primary">About Us</span>
            <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold leading-tight text-foreground">
              Innovating with <span className="text-primary">Purpose & Precision</span>
            </h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              Zyllo Tech Software Solutions Private Limited is a forward-thinking software company
              dedicated to empowering businesses through technology. We combine deep technical expertise
              with creative design thinking to deliver solutions that make a real impact.
            </p>

            <div className="mt-6 rounded-2xl overflow-hidden border border-border shadow-sm">
              <img src={teamImg} alt="Zyllo Tech Team" className="w-full h-52 object-cover" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="space-y-3"
          >
            {highlights.map((item, i) => (
              <motion.div
                key={item}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="flex items-start gap-3 rounded-lg border border-border bg-background p-4 hover:border-primary/40 transition-colors shadow-sm"
              >
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-primary" />
                <span className="text-sm text-foreground">{item}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default AboutSection;

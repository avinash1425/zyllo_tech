import { motion } from "framer-motion";
import { Eye, Handshake, BarChart3, Lightbulb } from "lucide-react";
import digitalModel from "@/assets/digital-model.jpg";

const features = [
  { icon: Handshake, title: "Flexibility", desc: "Flexibility to adopt requirements and allocate work efficiently across teams." },
  { icon: Eye, title: "Visibility", desc: "Complete visibility into delivery activity, proactive alerts and key metrics." },
  { icon: BarChart3, title: "Collaboration", desc: "Timely collaboration to improve performance outcomes and drive results." },
  { icon: Lightbulb, title: "Insight", desc: "Deeper insight to drive business outcomes with data-driven decisions." },
];

const WhyZylloSection = () => {
  return (
    <section className="py-16 lg:py-20 bg-muted/50">
      <div className="container mx-auto px-4 sm:px-6">
        {/* Digital Operating Model banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="relative overflow-hidden rounded-2xl border border-border mb-14 shadow-sm"
        >
          <img src={digitalModel} alt="Digital Operating Model" className="w-full h-56 md:h-72 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[hsl(215,25%,12%)] via-[hsl(215,25%,12%,0.7)] to-transparent flex items-center">
            <div className="p-8 md:p-12 max-w-lg">
              <span className="text-xs font-medium uppercase tracking-widest text-[hsl(195,60%,55%)]">Digital Operating Models</span>
              <h3 className="mt-2 font-display text-2xl md:text-3xl font-bold text-white">
                Adopt Accelerators to <span className="text-[hsl(24,95%,50%)]">Evolve Your Way</span> of Working
              </h3>
            </div>
          </div>
        </motion.div>

        <div className="grid gap-10 lg:grid-cols-2 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="text-xs font-medium uppercase tracking-widest text-primary">Why Zyllo Tech?</span>
            <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground leading-tight">
              We Design & Deploy <span className="text-primary">Digital Solutions at Scale</span>
            </h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              Zyllo Tech modernizes the way businesses use technology to deliver better outcomes. 
              Our approach combines deep domain expertise with innovative engineering to create solutions that matter.
            </p>

            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-5">
              {[
                { value: "50+", label: "Projects" },
                { value: "30+", label: "Clients" },
                { value: "5+", label: "Years" },
                { value: "6+", label: "Countries" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="font-display text-2xl font-bold text-primary">{stat.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-5"
          >
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="rounded-xl border border-border bg-background p-5 hover:border-primary/40 transition-colors shadow-sm"
              >
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon size={20} />
                </div>
                <h3 className="font-display font-semibold text-foreground mb-1">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default WhyZylloSection;

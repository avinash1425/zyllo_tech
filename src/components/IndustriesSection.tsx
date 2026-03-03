import { motion } from "framer-motion";
import {
  Building2, ShoppingCart, Truck, Gamepad2, HeartPulse, GraduationCap,
  Landmark, Factory, Plane, Wifi
} from "lucide-react";

const industries = [
  { icon: Landmark, name: "Banking & Financial" },
  { icon: ShoppingCart, name: "Retail & E-Commerce" },
  { icon: HeartPulse, name: "Healthcare" },
  { icon: GraduationCap, name: "Education" },
  { icon: Truck, name: "Logistics & Transport" },
  { icon: Factory, name: "Manufacturing" },
  { icon: Gamepad2, name: "Gaming & Entertainment" },
  { icon: Building2, name: "Real Estate" },
  { icon: Plane, name: "Travel & Hospitality" },
  { icon: Wifi, name: "Telecom" },
];

const IndustriesSection = () => {
  return (
    <section className="py-16 lg:py-20 bg-muted/50">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="text-xs font-medium uppercase tracking-widest text-primary">Industries We Support</span>
          <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
            Serving Clients Across <span className="text-primary">All Sectors</span>
          </h2>
          <p className="mt-3 mx-auto max-w-xl text-muted-foreground">
            We support 50+ global clients from all major industries with tailored digital solutions.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-5">
          {industries.map((ind, i) => (
            <motion.div
              key={ind.name}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="flex flex-col items-center gap-3 rounded-xl border border-border bg-background p-5 hover:border-primary/40 hover:shadow-md transition-all duration-300 group"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <ind.icon size={22} />
              </div>
              <span className="text-sm font-medium text-foreground text-center">{ind.name}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default IndustriesSection;

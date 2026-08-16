import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Building2, ShoppingCart, Truck, Gamepad2, HeartPulse, GraduationCap,
  Landmark, Factory, Plane, Wifi
} from "lucide-react";

const industries = [
  {
    icon: Landmark,
    name: "Banking & Financial",
    description: "Secure, compliant platforms for payments, lending, and wealth management.",
  },
  {
    icon: ShoppingCart,
    name: "Retail & E-Commerce",
    description: "Scalable storefronts, inventory systems, and personalized shopping experiences.",
  },
  {
    icon: HeartPulse,
    name: "Healthcare",
    description: "HIPAA-ready patient portals, telemedicine apps, and clinical workflow tools.",
  },
  {
    icon: GraduationCap,
    name: "Education",
    description: "LMS platforms, virtual classrooms, and adaptive learning applications.",
  },
  {
    icon: Truck,
    name: "Logistics & Transport",
    description: "Real-time fleet tracking, route optimization, and supply chain visibility.",
  },
  {
    icon: Factory,
    name: "Manufacturing",
    description: "IoT-connected production monitoring, ERP integrations, and automation.",
  },
  {
    icon: Gamepad2,
    name: "Gaming & Entertainment",
    description: "High-performance game backends, streaming platforms, and media solutions.",
  },
  {
    icon: Building2,
    name: "Real Estate",
    description: "Property listing platforms, CRM tools, and virtual tour experiences.",
  },
  {
    icon: Plane,
    name: "Travel & Hospitality",
    description: "Booking engines, itinerary managers, and loyalty program integrations.",
  },
  {
    icon: Wifi,
    name: "Telecom",
    description: "BSS/OSS modernization, subscriber portals, and network analytics dashboards.",
  },
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

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
          {industries.map((ind, i) => (
            <motion.div
              key={ind.name}
              initial={{ opacity: 0, scale: 0.92 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="flex flex-col items-center gap-3 rounded-xl border border-border bg-background p-5 hover:border-primary/40 hover:shadow-md transition-all duration-300 group text-center"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <ind.icon size={22} />
              </div>
              <span className="text-sm font-semibold text-foreground">{ind.name}</span>
              <p className="text-xs text-muted-foreground leading-relaxed">{ind.description}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-10 text-center"
        >
          <Link
            to="/industries"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-2.5 text-sm font-medium text-foreground hover:border-primary hover:text-primary transition-colors"
          >
            Explore All Industries
          </Link>
        </motion.div>
      </div>
    </section>
  );
};

export default IndustriesSection;

import { motion } from "framer-motion";
import {
  Building2, ShoppingCart, Truck, Gamepad2, HeartPulse, GraduationCap,
  Landmark, Factory, Plane, Wifi, Clapperboard, Leaf
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";

const industries = [
  { icon: Landmark, name: "Banking & Financial Services", desc: "Secure payment solutions, fintech applications, core banking systems, and regulatory compliance platforms." },
  { icon: ShoppingCart, name: "Retail & E-Commerce", desc: "Online stores, inventory management, POS systems, loyalty programs, and omnichannel commerce solutions." },
  { icon: HeartPulse, name: "Healthcare & Life Sciences", desc: "EHR systems, telemedicine platforms, medical device software, patient portals, and health analytics." },
  { icon: GraduationCap, name: "Education & EdTech", desc: "Learning management systems, virtual classrooms, student portals, assessment platforms, and educational apps." },
  { icon: Truck, name: "Logistics & Transportation", desc: "Fleet management, route optimization, supply chain visibility, warehouse management, and tracking systems." },
  { icon: Factory, name: "Manufacturing & Industrial", desc: "Production automation, IoT integration, quality control systems, ERP solutions, and predictive maintenance." },
  { icon: Gamepad2, name: "Gaming & Entertainment", desc: "Sportsbook platforms, casino applications, game development, streaming services, and engagement tools." },
  { icon: Building2, name: "Real Estate & Construction", desc: "Property management, CRM for realtors, virtual tours, project management, and construction analytics." },
  { icon: Plane, name: "Travel & Hospitality", desc: "Booking engines, hotel management systems, travel portals, loyalty programs, and customer experience platforms." },
  { icon: Wifi, name: "Telecom & IT Services", desc: "Network management, billing systems, customer portals, telecom testing, and service delivery platforms." },
  { icon: Clapperboard, name: "Media & Publishing", desc: "Content management systems, digital publishing platforms, ad tech solutions, and media analytics." },
  { icon: Leaf, name: "Agriculture & Environment", desc: "Smart farming solutions, crop monitoring, supply chain tracking, weather analytics, and sustainability tools." },
];

const IndustriesPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero title="Industries" highlight="We Serve" description="We support global clients from all major industries with tailored digital solutions that address unique sector challenges." breadcrumb="Industries" />

      <section className="py-24">
        <div className="container mx-auto px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((ind, i) => (
              <motion.div
                key={ind.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                className="group rounded-xl border border-border bg-background p-8 hover:border-primary/40 hover:shadow-md transition-all"
              >
                <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <ind.icon size={28} />
                </div>
                <h3 className="font-display text-lg font-semibold text-foreground mb-2">{ind.name}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{ind.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default IndustriesPage;

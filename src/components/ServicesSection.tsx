import { motion } from "framer-motion";
import { Code2, Brain, Palette, Megaphone, Globe, Smartphone } from "lucide-react";

const services = [
  { icon: Code2, title: "Software Development", description: "Custom web and enterprise applications built with modern technologies for scalability and performance." },
  { icon: Brain, title: "AI & Machine Learning", description: "Intelligent solutions powered by AI — from chatbots and automation to predictive analytics." },
  { icon: Palette, title: "UI/UX Design", description: "Beautiful, user-centric designs that elevate your brand and create seamless digital experiences." },
  { icon: Megaphone, title: "Digital Marketing", description: "Data-driven marketing strategies including SEO, social media, and paid campaigns that convert." },
  { icon: Globe, title: "Web Applications", description: "Full-stack web applications with responsive design, real-time features, and cloud deployment." },
  { icon: Smartphone, title: "Mobile Development", description: "Cross-platform mobile apps that deliver native-like performance on iOS and Android." },
];

const ServicesSection = () => {
  return (
    <section id="services" className="relative py-16 lg:py-20">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="text-xs font-medium uppercase tracking-widest text-primary">Our Core Capabilities</span>
          <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
            Services That <span className="text-primary">Drive Growth</span>
          </h2>
          <p className="mt-3 mx-auto max-w-xl text-muted-foreground">
            End-to-end digital solutions tailored to your business needs.
          </p>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service, i) => (
            <motion.div
              key={service.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="group rounded-xl border border-border bg-background p-6 hover:border-primary/40 hover:shadow-md transition-all duration-300"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <service.icon size={24} />
              </div>
              <h3 className="font-display text-lg font-semibold text-foreground mb-2">{service.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{service.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ServicesSection;

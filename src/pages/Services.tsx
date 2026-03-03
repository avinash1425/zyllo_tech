import { motion } from "framer-motion";
import {
  Code2, Brain, Palette, Megaphone, Globe, Smartphone, Database, TestTube,
  Cloud, Shield, Settings, BarChart3
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";

const services = [
  { icon: Code2, title: "Application Development", description: "Our development service empowers businesses with custom-built applications tailored to their unique needs. We leverage modern frameworks and agile methodologies to deliver robust, scalable solutions." },
  { icon: Globe, title: "Web Development", description: "Web development services that meet diverse business requirements. We build responsive, high-performance websites and web applications using the latest technologies and best practices." },
  { icon: Smartphone, title: "Mobile App Development", description: "Crafting feature-packed native and cross-platform mobile applications for iOS and Android. We focus on user experience, performance, and seamless integration with backend systems." },
  { icon: Brain, title: "AI & Machine Learning", description: "Invest in next-gen technology to upscale your business. Our AI/ML solutions include chatbots, predictive analytics, natural language processing, computer vision, and intelligent automation." },
  { icon: Database, title: "Data Analytics", description: "Transform your business with our data analytics services. We help you collect, process, and visualize data to make informed decisions and uncover hidden opportunities." },
  { icon: Cloud, title: "Cloud Solutions", description: "Cloud-based application development and migration services. We help businesses leverage AWS, Azure, and Google Cloud for scalable, secure, and cost-effective infrastructure." },
  { icon: Palette, title: "UI/UX Design", description: "Beautiful, user-centric designs that elevate your brand. Our design team creates intuitive interfaces, wireframes, prototypes, and complete design systems for digital products." },
  { icon: Megaphone, title: "SEO & Digital Marketing", description: "SEO ensures that your business gets the most visibility online. We offer comprehensive digital marketing services including social media management, PPC campaigns, and content strategy." },
  { icon: TestTube, title: "Testing & QA", description: "We perform comprehensive testing and quality assurance to ensure your software is bug-free, secure, and performs optimally across all devices and platforms." },
  { icon: Shield, title: "Cybersecurity", description: "Protect your digital assets with our cybersecurity services. We offer vulnerability assessments, penetration testing, security audits, and compliance consulting." },
  { icon: Settings, title: "DevOps & Automation", description: "Streamline your development pipeline with CI/CD, infrastructure as code, containerization, and automated deployment strategies for faster releases." },
  { icon: BarChart3, title: "Workforce Solutions", description: "Hiring quality talent made easy. We provide IT staffing, team augmentation, and dedicated development teams to scale your projects efficiently." },
];

const ServicesPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero title="Our" highlight="Services" description="We offer varied services including Software Development, Data Analytics, AI Solutions, Cloud Applications, Mobile Development, and Digital Marketing." breadcrumb="Services" />

      <section className="py-24">
        <div className="container mx-auto px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service, i) => (
              <motion.div
                key={service.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                className="group rounded-xl border border-border bg-background p-8 hover:border-primary/40 hover:shadow-md transition-all duration-300"
              >
                <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <service.icon size={28} />
                </div>
                <h3 className="font-display text-xl font-semibold text-foreground mb-3">{service.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{service.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted/50">
        <div className="container mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <span className="text-xs font-medium uppercase tracking-widest text-primary">Our Approach</span>
            <h2 className="mt-3 font-display text-4xl md:text-5xl font-bold text-foreground">
              Digital <span className="text-gradient">Operating Models</span>
            </h2>
            <p className="mt-4 mx-auto max-w-2xl text-muted-foreground">
              Adopt accelerators to evolve your way of working. Our digital operating models ensure seamless delivery and continuous improvement.
            </p>
          </motion.div>

          <div className="grid gap-8 md:grid-cols-3">
            {[
              { title: "Agile Development", desc: "Iterative development with continuous feedback loops, sprint-based delivery, and adaptive planning to respond to changing requirements." },
              { title: "DevOps Integration", desc: "Automated CI/CD pipelines, infrastructure as code, and monitoring to ensure rapid, reliable deployments with minimal downtime." },
              { title: "Quality First", desc: "Comprehensive testing at every stage — unit, integration, performance, and security testing to deliver bulletproof software." },
            ].map((model, i) => (
              <motion.div
                key={model.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="rounded-xl border border-border bg-background p-8 text-center hover:border-primary/40 hover:shadow-md transition-all"
              >
                <h3 className="font-display text-xl font-bold text-foreground mb-3">{model.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{model.desc}</p>
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

export default ServicesPage;

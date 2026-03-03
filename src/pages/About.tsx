import { motion } from "framer-motion";
import { CheckCircle2, Target, Eye, Heart, Linkedin, Twitter, Github } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import aboutTeam from "@/assets/about-team.jpg";

const team = [
  {
    name: "Vikram Sinha",
    role: "CEO & Co-Founder",
    bio: "15+ years in enterprise software. Previously led engineering at TCS and Infosys. Passionate about AI and building great teams.",
    initials: "VS",
    color: "bg-blue-600",
    linkedin: "#",
    twitter: "#",
  },
  {
    name: "Ananya Patel",
    role: "CTO & Co-Founder",
    bio: "Full-stack architect with deep expertise in cloud-native systems. Former principal engineer at Microsoft. Loves distributed systems and open source.",
    initials: "AP",
    color: "bg-teal-600",
    linkedin: "#",
    github: "#",
  },
  {
    name: "Meera Joshi",
    role: "Head of Design",
    bio: "Award-winning product designer with 10+ years crafting digital experiences. Believer in human-centered design and accessible interfaces.",
    initials: "MJ",
    color: "bg-purple-600",
    linkedin: "#",
    twitter: "#",
  },
  {
    name: "Arun Sharma",
    role: "AI/ML Lead",
    bio: "PhD in Machine Learning from IIT Hyderabad. Published researcher in NLP and computer vision. Building AI products that actually work in production.",
    initials: "AS",
    color: "bg-orange-500",
    linkedin: "#",
    github: "#",
  },
  {
    name: "Priya Reddy",
    role: "Cloud Architecture Lead",
    bio: "AWS & GCP certified architect. Specializes in cloud migrations, DevOps transformation, and building infra that scales to millions of users.",
    initials: "PR",
    color: "bg-emerald-600",
    linkedin: "#",
    twitter: "#",
  },
  {
    name: "Kiran Babu",
    role: "Head of Delivery",
    bio: "PMP-certified project manager and full-stack developer. Ensures every project ships on time, on budget, and with exceptional quality.",
    initials: "KB",
    color: "bg-rose-500",
    linkedin: "#",
    github: "#",
  },
];

const AboutPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero title="About" highlight="Zyllo Tech" description="We are a forward-thinking software company dedicated to empowering businesses through innovative technology solutions." breadcrumb="About Us" />

      {/* Company Overview */}
      <section className="py-24">
        <div className="container mx-auto px-6">
          <div className="grid gap-16 lg:grid-cols-2 items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-6">
                Your Digital <span className="text-gradient">Transformation Partner</span>
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Zyllo Tech Software Solutions Private Limited is a premier software company that provides end-to-end solutions for all kinds of business applications.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Our team of expert developers, designers, and strategists work collaboratively to deliver cutting-edge solutions that drive real business impact.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                With a focus on quality, innovation, and client satisfaction, we have successfully delivered 50+ projects for clients across 6+ countries.
              </p>
            </motion.div>
            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="rounded-2xl overflow-hidden border border-border shadow-sm">
              <img src={aboutTeam} alt="Zyllo Tech Team" className="w-full h-auto" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Mission / Vision / Values */}
      <section className="py-20 bg-muted/50">
        <div className="container mx-auto px-6">
          <div className="grid gap-8 md:grid-cols-3">
            {[
              { icon: Target, title: "Our Mission", desc: "To empower businesses with innovative technology solutions that drive growth, efficiency, and competitive advantage in the digital era." },
              { icon: Eye, title: "Our Vision", desc: "To be a globally recognized leader in software development and AI solutions, known for transforming businesses through cutting-edge technology." },
              { icon: Heart, title: "Our Values", desc: "Innovation, integrity, collaboration, and excellence. We believe in building long-term partnerships and delivering beyond expectations." },
            ].map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="rounded-xl border border-border bg-background p-8 text-center shadow-sm">
                <div className="mb-4 mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <item.icon size={28} />
                </div>
                <h3 className="font-display text-xl font-bold text-foreground mb-3">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Choose Zyllo */}
      <section className="py-20">
        <div className="container mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground">
              Why Choose <span className="text-gradient">Zyllo Tech?</span>
            </h2>
          </motion.div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              "Expert team of 50+ developers, designers & strategists",
              "Agile development with transparent communication",
              "Cutting-edge AI and ML integration capabilities",
              "End-to-end project delivery from concept to launch",
              "Scalable cloud-native architectures built for growth",
              "Dedicated 24/7 post-launch support & maintenance",
              "ISO-certified quality processes and security standards",
              "Proven track record with 50+ successful projects",
              "Cost-effective solutions without compromising quality",
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }} className="flex items-start gap-3 rounded-lg border border-border bg-background p-5 shadow-sm">
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-primary" />
                <span className="text-sm text-foreground">{item}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 bg-muted/50">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 text-center">
            {[
              { value: "5+", label: "Years of Experience" },
              { value: "30+", label: "Global Clients" },
              { value: "50+", label: "Projects Delivered" },
              { value: "40+", label: "Expert Developers" },
              { value: "6+", label: "Countries Served" },
            ].map((stat) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
              >
                <div className="font-display text-4xl md:text-5xl font-bold text-primary">{stat.value}</div>
                <div className="mt-2 text-sm text-muted-foreground">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Leadership Team */}
      <section className="py-24">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <span className="text-xs font-medium uppercase tracking-widest text-primary">The People Behind the Magic</span>
            <h2 className="mt-3 font-display text-4xl md:text-5xl font-bold text-foreground">
              Meet Our <span className="text-gradient">Leadership Team</span>
            </h2>
            <p className="mt-4 mx-auto max-w-2xl text-muted-foreground">
              A diverse group of technologists, designers, and business leaders united by a passion for building exceptional software.
            </p>
          </motion.div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((member, i) => (
              <motion.div
                key={member.name}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="group rounded-2xl border border-border bg-background p-7 hover:border-primary/40 hover:shadow-md transition-all duration-300 text-center"
              >
                {/* Avatar */}
                <div className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full ${member.color} text-white font-bold text-xl shadow-md group-hover:scale-105 transition-transform`}>
                  {member.initials}
                </div>

                <h3 className="font-display text-lg font-bold text-foreground mb-0.5">{member.name}</h3>
                <p className="text-sm font-medium text-primary mb-3">{member.role}</p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-5">{member.bio}</p>

                {/* Social Links */}
                <div className="flex items-center justify-center gap-3">
                  {member.linkedin && (
                    <a href={member.linkedin} className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors" aria-label="LinkedIn">
                      <Linkedin size={15} />
                    </a>
                  )}
                  {member.twitter && (
                    <a href={member.twitter} className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors" aria-label="Twitter">
                      <Twitter size={15} />
                    </a>
                  )}
                  {member.github && (
                    <a href={member.github} className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors" aria-label="GitHub">
                      <Github size={15} />
                    </a>
                  )}
                </div>
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

export default AboutPage;

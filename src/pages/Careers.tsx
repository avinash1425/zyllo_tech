import { motion } from "framer-motion";
import { MapPin, Clock, Briefcase } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import careersBanner from "@/assets/careers-banner.jpg";

const openings = [
  { title: "Senior Full Stack Developer", location: "Hyderabad / Remote", type: "Full Time", experience: "5+ Years", skills: ["React", "Node.js", "TypeScript", "PostgreSQL", "AWS"] },
  { title: "AI/ML Engineer", location: "Hyderabad / Remote", type: "Full Time", experience: "3+ Years", skills: ["Python", "TensorFlow", "PyTorch", "NLP", "Computer Vision"] },
  { title: "UI/UX Designer", location: "Hyderabad", type: "Full Time", experience: "3+ Years", skills: ["Figma", "Adobe XD", "Prototyping", "User Research", "Design Systems"] },
  { title: "React Native Developer", location: "Remote", type: "Full Time", experience: "3+ Years", skills: ["React Native", "TypeScript", "Redux", "REST APIs", "Firebase"] },
  { title: "DevOps Engineer", location: "Hyderabad / Remote", type: "Full Time", experience: "4+ Years", skills: ["Docker", "Kubernetes", "CI/CD", "AWS", "Terraform"] },
  { title: "Digital Marketing Specialist", location: "Hyderabad", type: "Full Time", experience: "2+ Years", skills: ["SEO", "Google Ads", "Social Media", "Content Strategy", "Analytics"] },
  { title: "QA Test Engineer", location: "Hyderabad", type: "Full Time", experience: "2+ Years", skills: ["Selenium", "Cypress", "API Testing", "Performance Testing", "Agile"] },
  { title: "Business Analyst", location: "Hyderabad / Remote", type: "Full Time", experience: "3+ Years", skills: ["Requirements Gathering", "Agile", "JIRA", "Documentation", "Stakeholder Management"] },
];

const CareersPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero title="Join Our" highlight="Team" description="Together we dream, aspire and create opportunities for people to grow in their career. Explore exciting opportunities at Zyllo Tech." breadcrumb="Careers" />

      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="grid gap-12 lg:grid-cols-2 items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-6">
                Why Work at <span className="text-gradient">Zyllo Tech?</span>
              </h2>
              <div className="space-y-4">
                {[
                  "Work on cutting-edge technologies and innovative projects",
                  "Collaborative and inclusive work environment",
                  "Competitive salary and benefits package",
                  "Flexible work arrangements — remote & hybrid options",
                  "Continuous learning and professional development",
                  "Career growth opportunities and mentorship programs",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="rounded-2xl overflow-hidden border border-border shadow-sm">
              <img src={careersBanner} alt="Work at Zyllo Tech" className="w-full h-80 object-cover" />
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted/50">
        <div className="container mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
            <span className="text-xs font-medium uppercase tracking-widest text-primary">We're Hiring</span>
            <h2 className="mt-3 font-display text-4xl md:text-5xl font-bold text-foreground">
              Current <span className="text-gradient">Openings</span>
            </h2>
          </motion.div>

          <div className="grid gap-6 lg:grid-cols-2">
            {openings.map((job, i) => (
              <motion.div key={job.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }} className="rounded-xl border border-border bg-background p-6 hover:border-primary/40 hover:shadow-md transition-all">
                <h3 className="font-display text-lg font-semibold text-foreground mb-3">{job.title}</h3>
                <div className="flex flex-wrap gap-4 mb-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin size={14} className="text-primary" /> {job.location}</span>
                  <span className="flex items-center gap-1"><Briefcase size={14} className="text-primary" /> {job.type}</span>
                  <span className="flex items-center gap-1"><Clock size={14} className="text-primary" /> {job.experience}</span>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {job.skills.map((skill) => (
                    <span key={skill} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{skill}</span>
                  ))}
                </div>
                <a href="mailto:careers@zyllotech.com" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Apply Now →</a>
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

export default CareersPage;

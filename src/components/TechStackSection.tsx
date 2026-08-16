import { motion } from "framer-motion";

const categories = [
  {
    label: "Frontend",
    techs: ["React", "Next.js", "TypeScript", "Vue.js", "Tailwind CSS", "Figma"],
  },
  {
    label: "Backend",
    techs: ["Node.js", "Python", "Django", "FastAPI", "GraphQL", "REST APIs"],
  },
  {
    label: "Mobile",
    techs: ["React Native", "Flutter", "Swift", "Kotlin", "Expo", "Firebase"],
  },
  {
    label: "Cloud & DevOps",
    techs: ["AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform"],
  },
  {
    label: "AI & Data",
    techs: ["TensorFlow", "PyTorch", "OpenAI", "LangChain", "Spark", "Power BI"],
  },
  {
    label: "Databases",
    techs: ["PostgreSQL", "MongoDB", "MySQL", "Redis", "Elasticsearch", "Supabase"],
  },
];

const TechStackSection = () => {
  return (
    <section className="py-16 lg:py-20">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="text-xs font-medium uppercase tracking-widest text-primary">
            Our Technology Stack
          </span>
          <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
            Built With <span className="text-primary">Best-in-Class Tools</span>
          </h2>
          <p className="mt-3 mx-auto max-w-xl text-muted-foreground">
            We choose the right technology for every project — modern, battle-tested, and scalable.
          </p>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat, i) => (
            <motion.div
              key={cat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="rounded-xl border border-border bg-background p-6 hover:border-primary/40 hover:shadow-md transition-all duration-300"
            >
              <h3 className="font-display text-sm font-semibold text-primary uppercase tracking-wider mb-4">
                {cat.label}
              </h3>
              <div className="flex flex-wrap gap-2">
                {cat.techs.map((tech) => (
                  <span
                    key={tech}
                    className="inline-flex items-center rounded-md border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TechStackSection;

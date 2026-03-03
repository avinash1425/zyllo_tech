import { motion } from "framer-motion";
import { Search, PenTool, Code2, TestTube, Rocket, Headphones } from "lucide-react";

const steps = [
  {
    step: "01",
    icon: Search,
    title: "Discovery & Planning",
    description:
      "We start by understanding your business goals, user needs, and technical requirements through in-depth consultations and research.",
  },
  {
    step: "02",
    icon: PenTool,
    title: "Design & Prototyping",
    description:
      "Our designers craft intuitive wireframes and high-fidelity prototypes, validating the experience with stakeholders before a single line of code is written.",
  },
  {
    step: "03",
    icon: Code2,
    title: "Agile Development",
    description:
      "We build in two-week sprints with continuous demos and feedback loops, ensuring you're always aligned with progress and can adapt quickly.",
  },
  {
    step: "04",
    icon: TestTube,
    title: "Quality Assurance",
    description:
      "Every feature goes through rigorous automated and manual testing — functional, performance, security, and cross-device — before reaching production.",
  },
  {
    step: "05",
    icon: Rocket,
    title: "Deployment & Launch",
    description:
      "We handle CI/CD pipelines, cloud infrastructure setup, and a smooth go-live process so your product launches without surprises.",
  },
  {
    step: "06",
    icon: Headphones,
    title: "Support & Growth",
    description:
      "Post-launch, we provide dedicated maintenance, monitoring, and iterative improvements to keep your product evolving with your business.",
  },
];

const ProcessSection = () => {
  return (
    <section className="py-16 lg:py-20">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <span className="text-xs font-medium uppercase tracking-widest text-primary">
            Our Process
          </span>
          <h2 className="mt-3 font-display text-3xl md:text-4xl font-bold text-foreground">
            How We <span className="text-primary">Bring Ideas to Life</span>
          </h2>
          <p className="mt-3 mx-auto max-w-xl text-muted-foreground">
            A proven six-step framework that ensures on-time delivery, transparent communication, and exceptional quality.
          </p>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, i) => (
            <motion.div
              key={step.step}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="group relative rounded-xl border border-border bg-background p-6 hover:border-primary/40 hover:shadow-md transition-all duration-300"
            >
              {/* Step number watermark */}
              <span className="absolute top-4 right-5 font-display text-4xl font-bold text-border select-none group-hover:text-primary/10 transition-colors">
                {step.step}
              </span>

              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <step.icon size={22} />
              </div>
              <h3 className="font-display text-lg font-semibold text-foreground mb-2">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ProcessSection;

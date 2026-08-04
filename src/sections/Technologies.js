import { Cloud, Code2, Database, Layers, Smartphone, Sparkles } from "lucide-react";

const STACK_CATEGORIES = [
  {
    icon: Code2,
    title: "Frontend",
    items: ["React", "Next.js", "TypeScript", "Tailwind CSS"],
  },
  {
    icon: Layers,
    title: "Backend",
    items: ["Node.js", "Python", "Java", "REST & GraphQL"],
  },
  {
    icon: Smartphone,
    title: "Mobile",
    items: ["React Native", "Flutter", "Swift", "Kotlin"],
  },
  {
    icon: Cloud,
    title: "Cloud & DevOps",
    items: ["AWS", "Azure", "Docker", "Kubernetes"],
  },
  {
    icon: Database,
    title: "Data",
    items: ["PostgreSQL", "MongoDB", "Redis", "Elasticsearch"],
  },
  {
    icon: Sparkles,
    title: "AI & ML",
    items: ["OpenAI", "LangChain", "TensorFlow", "Vector Databases"],
  },
];

export default function Technologies() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Technologies
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Tools we use to build reliable software
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            We pick technology based on what the project needs, not what's
            trending — these are the tools we reach for most often.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STACK_CATEGORIES.map(({ icon: Icon, title, items }) => (
            <div
              key={title}
              className="rounded-2xl border border-white/60 bg-white/60 p-6 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#f7941e]/30 hover:shadow-lg"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15">
                <Icon className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-[#2b303b]">{title}</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {items.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-[#e7e9ee] bg-white px-3 py-1 text-xs font-medium text-[#676b7a]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

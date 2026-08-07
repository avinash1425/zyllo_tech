"use client";

import { Cloud, Code2, Database, Layers, Smartphone, Sparkles } from "lucide-react";

// Icon medallion style matches WhyChooseUs.js / Values.js — glowing
// gradient tile with a pulsing blur behind it, per-card accent color —
// so every icon-card section on the About page reads as one family.
const STACK_CATEGORIES = [
  {
    icon: Code2,
    title: "Frontend",
    items: ["React", "Next.js", "TypeScript", "Tailwind CSS"],
    accent: "#f7941e",
    accentSoft: "#fbbf62",
  },
  {
    icon: Layers,
    title: "Backend",
    items: ["Node.js", "Python", "Java", "REST APIs & GraphQL"],
    accent: "#f0650f",
    accentSoft: "#fb923c",
  },
  {
    icon: Smartphone,
    title: "Mobile",
    items: ["React Native", "Flutter", "Swift", "Kotlin"],
    accent: "#8a5a7a",
    accentSoft: "#c295b3",
  },
  {
    icon: Cloud,
    title: "Cloud & DevOps",
    items: ["AWS", "Azure", "Docker", "Kubernetes"],
    accent: "#2f5fb3",
    accentSoft: "#6d94d6",
  },
  {
    icon: Database,
    title: "Database",
    items: ["PostgreSQL", "MongoDB", "Redis", "Elasticsearch"],
    accent: "#1f4693",
    accentSoft: "#4d6fb8",
  },
  {
    icon: Sparkles,
    title: "AI & Machine Learning",
    items: ["OpenAI", "LangChain", "TensorFlow", "Vector Databases"],
    accent: "#f7941e",
    accentSoft: "#fbbf62",
  },
];

export default function Technologies({ tint = "tint" }) {
  const bg = tint === "tint" ? "bg-[#fafbfc]" : "bg-white";
  return (
    <section className={`relative overflow-hidden border-t border-[#e7e9ee] ${bg} py-6 lg:py-8`}>
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
            Technologies We Use
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            We choose the right technology stack based on your business
            requirements.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STACK_CATEGORIES.map(({ icon: Icon, title, items, accent, accentSoft }) => (
            <div
              key={title}
              className="group relative flex flex-col items-center rounded-2xl border bg-white/60 p-6 text-center shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:bg-white/80 hover:shadow-lg"
              style={{ borderColor: `${accent}30` }}
            >
              <div className="relative flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className="pulse-glow absolute top-2 h-14 w-14 rounded-full blur-xl"
                  style={{ backgroundColor: accentSoft, opacity: 0.5 }}
                />
                <div
                  className="relative flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105"
                  style={{
                    background: `linear-gradient(135deg, ${accent}, ${accentSoft})`,
                    boxShadow: `0 10px 24px -6px ${accent}55`,
                  }}
                >
                  <Icon className="h-6 w-6 text-white" aria-hidden="true" />
                </div>
              </div>

              <h3 className="mt-5 text-base font-semibold text-[#2b303b]">{title}</h3>
              <ul className="mt-3 flex flex-wrap justify-center gap-2">
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

      <style jsx>{`
        .pulse-glow {
          animation: pulseGlow 3.5s ease-in-out infinite;
        }
        @keyframes pulseGlow {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.35;
          }
          50% {
            transform: scale(1.15);
            opacity: 0.6;
          }
        }
      `}</style>
    </section>
  );
}

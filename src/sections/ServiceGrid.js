import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SERVICES } from "@/data/services";

// Matches a "What We Do" reference mockup exactly: light section, centered
// heading, a compact 4-column grid of every service, each card a soft
// pastel gradient tile with a glowing icon circle, title, one-line
// description, and a plain "Learn More" link — no photos, no second button.
// One distinct color per card (not cycled), keyed by slug so it stays
// consistent with the homepage's featured 4.
export const SERVICE_THEMES = {
  "ui-ux-design": {
    accent: "#3b82f6",
    border: "border-[#3b82f6]/25 hover:border-[#3b82f6]/50",
    wash: "from-[#3b82f6]/[0.1] via-white to-white",
    badge: "bg-gradient-to-br from-[#3b82f6] to-[#60a5fa] shadow-[#3b82f6]/30",
  },
  "web-development": {
    accent: "#10b981",
    border: "border-[#10b981]/25 hover:border-[#10b981]/50",
    wash: "from-[#10b981]/[0.1] via-white to-white",
    badge: "bg-gradient-to-br from-[#10b981] to-[#34d399] shadow-[#10b981]/30",
  },
  "mobile-app-development": {
    accent: "#6366f1",
    border: "border-[#6366f1]/25 hover:border-[#6366f1]/50",
    wash: "from-[#6366f1]/[0.1] via-white to-white",
    badge: "bg-gradient-to-br from-[#6366f1] to-[#818cf8] shadow-[#6366f1]/30",
  },
  "product-strategy-consulting": {
    accent: "#f59e0b",
    border: "border-[#f59e0b]/25 hover:border-[#f59e0b]/50",
    wash: "from-[#f59e0b]/[0.1] via-white to-white",
    badge: "bg-gradient-to-br from-[#f59e0b] to-[#fbbf24] shadow-[#f59e0b]/30",
  },
  "cloud-solutions": {
    accent: "#06b6d4",
    border: "border-[#06b6d4]/25 hover:border-[#06b6d4]/50",
    wash: "from-[#06b6d4]/[0.1] via-white to-white",
    badge: "bg-gradient-to-br from-[#06b6d4] to-[#22d3ee] shadow-[#06b6d4]/30",
  },
  "ai-solutions": {
    accent: "#8b5cf6",
    border: "border-[#8b5cf6]/25 hover:border-[#8b5cf6]/50",
    wash: "from-[#8b5cf6]/[0.1] via-white to-white",
    badge: "bg-gradient-to-br from-[#8b5cf6] to-[#a78bfa] shadow-[#8b5cf6]/30",
  },
  "cybersecurity-engineering": {
    accent: "#ef4444",
    border: "border-[#ef4444]/25 hover:border-[#ef4444]/50",
    wash: "from-[#ef4444]/[0.1] via-white to-white",
    badge: "bg-gradient-to-br from-[#ef4444] to-[#f87171] shadow-[#ef4444]/30",
  },
  "quality-engineering-qa": {
    accent: "#eab308",
    border: "border-[#eab308]/25 hover:border-[#eab308]/50",
    wash: "from-[#eab308]/[0.1] via-white to-white",
    badge: "bg-gradient-to-br from-[#eab308] to-[#facc15] shadow-[#eab308]/30",
  },
  "maintenance-support": {
    accent: "#14b8a6",
    border: "border-[#14b8a6]/25 hover:border-[#14b8a6]/50",
    wash: "from-[#14b8a6]/[0.1] via-white to-white",
    badge: "bg-gradient-to-br from-[#14b8a6] to-[#2dd4bf] shadow-[#14b8a6]/30",
  },
};

const DEFAULT_THEME = SERVICE_THEMES["web-development"];

export default function ServiceGrid() {
  return (
    <section id="services-grid" className="relative overflow-hidden bg-gradient-to-b from-white via-[#fff7ed] to-white py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <h2 className="text-center text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
          What We Do
        </h2>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((service) => {
            const Icon = service.icon;
            const theme = SERVICE_THEMES[service.slug] ?? DEFAULT_THEME;
            return (
              <Link
                key={service.slug}
                href={`/services/${service.slug}`}
                className={`group flex flex-col rounded-2xl border bg-gradient-to-br p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${theme.border} ${theme.wash}`}
              >
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-lg ${theme.badge}`}
                >
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>

                <h3 className="mt-4 text-base font-bold leading-snug text-[#2b303b]">
                  {service.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#676b7a]">
                  {service.description}
                </p>

                {service.subServices && (
                  <ul className="mt-3 flex flex-col gap-1">
                    {service.subServices.map((item) => (
                      <li
                        key={item}
                        className="text-xs font-medium text-[#676b7a] before:mr-1.5 before:text-[#f7941e] before:content-['•']"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                )}

                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#2b303b] transition-all duration-200 group-hover:gap-2.5">
                  Learn More
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

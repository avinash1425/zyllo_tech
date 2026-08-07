"use client";

import { Users, Rocket, ShieldCheck, Target } from "lucide-react";

// Light section, warm orange-to-blue glassmorphism icon medallions matching
// the logo's palette across all 4 cards.
const REASONS = [
  {
    icon: Users,
    title: "Experienced Team",
    description:
      "Skilled professionals with expertise across modern technologies.",
    accent: "#f7941e",
    accentSoft: "#fbbf62",
  },
  {
    icon: Rocket,
    title: "Quality Delivery",
    description:
      "Reliable solutions delivered on time with industry best practices.",
    accent: "#f0650f",
    accentSoft: "#fb923c",
  },
  {
    icon: ShieldCheck,
    title: "Secure Solutions",
    description:
      "Applications built with security, performance, and scalability in mind.",
    accent: "#2f5fb3",
    accentSoft: "#6d94d6",
  },
  {
    icon: Target,
    title: "Customer Focused",
    description:
      "Every solution is designed around your business goals and long-term success.",
    accent: "#1f4693",
    accentSoft: "#4d6fb8",
  },
];

export default function WhyChooseUs() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-[#fff7ed]/60 to-white py-8 lg:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-[#f7941e]/8 blur-[120px]" />
        <div className="absolute -bottom-32 right-1/4 h-96 w-96 rounded-full bg-[#1f4693]/8 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Why Choose Zyllo Tech
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#0f172a] sm:text-4xl">
            Why Businesses Choose Us
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#475569]">
            We combine technical expertise with a customer-focused approach
            to deliver software that creates real business value.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {REASONS.map(({ icon: Icon, title, description, accent, accentSoft }) => (
            <div
              key={title}
              className="group flex flex-col items-center rounded-2xl border bg-white/60 p-6 text-center shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:bg-white/80 hover:shadow-lg"
              style={{ borderColor: `${accent}30` }}
            >
              <div className="relative flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className="pulse-glow absolute top-2 h-16 w-16 rounded-full blur-xl"
                  style={{ backgroundColor: accentSoft, opacity: 0.5 }}
                />
                <div
                  className="relative flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105"
                  style={{
                    background: `linear-gradient(135deg, ${accent}, ${accentSoft})`,
                    boxShadow: `0 10px 24px -6px ${accent}55`,
                  }}
                >
                  <Icon className="h-7 w-7 text-white" aria-hidden="true" />
                </div>
              </div>

              <h3 className="mt-5 text-base font-semibold text-[#0f172a]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#475569]">{description}</p>
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

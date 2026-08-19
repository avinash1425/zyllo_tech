import { Users, Rocket, ShieldCheck, Target } from "lucide-react";

// Numbered connected timeline — same visual language as "Our Development
// Process" (connecting line through numbered badges), reused here on a
// light background so the two sections read as a matched pair without
// being identical.
const REASONS = [
  {
    icon: Users,
    title: "Experienced Team",
    description:
      "Skilled professionals with expertise across modern technologies.",
    accent: "#f96706",
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
    accent: "#3089a6",
    accentSoft: "#6d94d6",
  },
  {
    icon: Target,
    title: "Customer Focused",
    description:
      "Every solution is designed around your business goals and long-term success.",
    accent: "#3089a6",
    accentSoft: "#4d6fb8",
  },
];

export default function WhyChooseUs() {
  return (
    <section className="relative bg-white py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f96706]">
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
            Why Choose Zyllo Tech
          </span>

          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[#0f172a] sm:text-4xl">
            Why Businesses Choose{" "}
            <span className="bg-gradient-to-r from-[#f96706] to-[#3089a6] bg-clip-text text-transparent">
              Us
            </span>
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#54607a]">
            We combine technical expertise with a customer-focused approach
            to deliver software that creates real business value.
          </p>
        </div>

        <div className="relative mt-16">
          <div
            aria-hidden="true"
            className="absolute left-[10%] right-[10%] top-8 hidden h-px bg-gradient-to-r from-[#f96706] to-[#3089a6] opacity-30 lg:block"
          />

          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {REASONS.map(({ icon: Icon, title, description, accent, accentSoft }, index) => (
              <div
                key={title}
                style={{ animationDelay: `${index * 0.1}s` }}
                className="why-item group relative flex flex-col items-center text-center"
              >
                <div className="relative z-[1] flex flex-col items-center">
                  <span
                    aria-hidden="true"
                    className="pulse-glow absolute h-16 w-16 rounded-full blur-xl"
                    style={{ backgroundColor: accentSoft, opacity: 0.35 }}
                  />
                  <div
                    className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#e2e5ea] bg-white shadow-sm transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-lg"
                    style={{ borderColor: `${accent}30` }}
                  >
                    <Icon className="h-6 w-6" style={{ color: accent }} aria-hidden="true" />
                  </div>
                  <span
                    className="mt-3 text-xs font-bold tracking-widest"
                    style={{ color: accent }}
                  >
                    0{index + 1}
                  </span>
                </div>

                <h3 className="mt-3 text-base font-bold text-[#0f172a]">{title}</h3>
                <p className="mt-2 max-w-[15rem] text-sm leading-relaxed text-[#54607a]">
                  {description}
                </p>
              </div>
            ))}
          </div>
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
            opacity: 0.25;
          }
          50% {
            transform: scale(1.15);
            opacity: 0.45;
          }
        }
        .why-item {
          animation: whyItemIn 0.6s ease-out both;
        }
        @keyframes whyItemIn {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </section>
  );
}

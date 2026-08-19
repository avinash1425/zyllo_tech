import { Compass, Heart, Lightbulb, ShieldCheck } from "lucide-react";

// Card style matches WhyChooseUs.js (glowing gradient icon medallions with
// a pulsing blur, per-card orange-to-blue accent) so Values and Our
// Advantages read as the same visual family across the About page.
const VALUES = [
  {
    icon: Lightbulb,
    title: "Innovation",
    description:
      "Embracing modern technologies to build smarter solutions.",
    accent: "#f7941e",
    accentSoft: "#fbbf62",
  },
  {
    icon: Compass,
    title: "Quality",
    description:
      "Delivering reliable software with high development standards.",
    accent: "#f0650f",
    accentSoft: "#fb923c",
  },
  {
    icon: ShieldCheck,
    title: "Integrity",
    description:
      "Building trust through transparency, honesty, and accountability.",
    accent: "#2f5fb3",
    accentSoft: "#6d94d6",
  },
  {
    icon: Heart,
    title: "Collaboration",
    description:
      "Working closely with clients to achieve shared success.",
    accent: "#1f4693",
    accentSoft: "#4d6fb8",
  },
];

export default function Values() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Our Values
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Our Core Values
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map(({ icon: Icon, title, description, accent, accentSoft }) => (
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

              <h3 className="mt-5 text-base font-semibold text-[#2b303b]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#676b7a]">{description}</p>
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

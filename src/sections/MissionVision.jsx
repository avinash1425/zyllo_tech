import { Compass, Eye } from "lucide-react";

// Icon medallion style matches WhyChooseUs.js / Values.js / Technologies.js
// — glowing gradient tile with a pulsing blur — so every icon-card section
// on the About page reads as one visual family.
const CARDS = [
  {
    icon: Compass,
    title: "Our Mission",
    description:
      "To deliver innovative, secure, and scalable software solutions that help businesses grow through technology.",
    accent: "#f7941e",
    accentSoft: "#fbbf62",
  },
  {
    icon: Eye,
    title: "Our Vision",
    description:
      "To become a trusted global technology partner known for delivering high-quality digital solutions and lasting client relationships.",
    accent: "#1f4693",
    accentSoft: "#4d6fb8",
  },
];

export default function MissionVision() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 left-1/3 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-20 right-1/3 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {CARDS.map(({ icon: Icon, title, description, accent, accentSoft }) => (
            <div
              key={title}
              className="group flex flex-col items-center rounded-2xl border bg-white/60 p-8 text-center shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:bg-white/80 hover:shadow-lg"
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

              <h2 className="mt-5 text-2xl font-bold tracking-tight text-[#2b303b]">
                {title}
              </h2>
              <p className="mt-3 text-lg leading-relaxed text-[#676b7a]">{description}</p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
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

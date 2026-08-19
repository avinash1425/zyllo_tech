import { Compass, Heart, Rocket, ShieldCheck, Sparkles, Users } from "lucide-react";

const REASONS = [
  {
    icon: Rocket,
    title: "Career Growth",
    description:
      "Develop your skills through challenging projects and continuous learning.",
    accent: "#f7941e",
    accentSoft: "#fbbf62",
  },
  {
    icon: Users,
    title: "Collaborative Environment",
    description:
      "Work alongside talented professionals in a supportive and inclusive culture.",
    accent: "#1f4693",
    accentSoft: "#4d6fb8",
  },
  {
    icon: Sparkles,
    title: "Modern Technologies",
    description:
      "Build innovative solutions using the latest tools and technologies.",
    accent: "#f0650f",
    accentSoft: "#fb923c",
  },
  {
    icon: Compass,
    title: "Learning & Development",
    description:
      "Enhance your expertise through mentorship, knowledge sharing, and hands-on experience.",
    accent: "#2f5fb3",
    accentSoft: "#6d94d6",
  },
  {
    icon: ShieldCheck,
    title: "Innovation Driven",
    description:
      "Bring your ideas to life and contribute to meaningful digital solutions.",
    accent: "#8a5a7a",
    accentSoft: "#c295b3",
  },
  {
    icon: Heart,
    title: "Work-Life Balance",
    description:
      "A healthy work environment that values productivity, flexibility, and well-being.",
    accent: "#1f4693",
    accentSoft: "#4d6fb8",
  },
];

export default function WhyJoinZyllo() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Why Join Us
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            A Workplace Where You Can Thrive
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            We believe great people build great products. That's why we
            invest in our team, encourage new ideas, and create
            opportunities for professional growth.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map(({ icon: Icon, title, description, accent, accentSoft }) => (
            <div
              key={title}
              className="join-card group relative overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-7 pt-8 transition-all duration-300 hover:-translate-y-2"
              style={{ "--join-accent": accent, "--join-accent-soft": accentSoft }}
            >
              <div
                className="relative flex h-12 w-12 rotate-[-6deg] items-center justify-center rounded-xl text-white shadow-lg transition-transform duration-300 group-hover:rotate-0 group-hover:scale-110"
                style={{
                  background: `linear-gradient(135deg, ${accent}, ${accentSoft})`,
                  boxShadow: `0 10px 20px -8px ${accent}70`,
                }}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
              </div>

              <h3 className="relative mt-5 text-lg font-semibold text-[#2b303b]">{title}</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-[#676b7a]">
                {description}
              </p>

              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
                style={{ background: `linear-gradient(90deg, ${accent}, ${accentSoft})` }}
              />
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .join-card::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 1rem;
          padding: 1px;
          background: linear-gradient(
            135deg,
            var(--join-accent),
            transparent 40%
          );
          opacity: 0;
          transition: opacity 0.3s ease;
          -webkit-mask: linear-gradient(#fff 0 0) content-box,
            linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }
        .join-card:hover::before {
          opacity: 1;
        }
      `}</style>
    </section>
  );
}

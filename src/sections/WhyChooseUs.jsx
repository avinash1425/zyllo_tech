import { Users, Rocket, ShieldCheck, Target } from "lucide-react";

// Engineered bento band: a slim stats strip and the four reasons rendered as
// tiles inside single bordered containers with shared 1px internal borders
// (21st.dev-style tile grid), over a subtle dot-grid backdrop. Per-cell
// border-t / border-l classes are computed per breakpoint instead of
// divide-x/divide-y so wrapped rows never show stray divider lines.
const REASONS = [
  {
    icon: Rocket,
    title: "Speed",
    description:
      "Working software demoed every week — a first production version typically ships in 8–16 weeks.",
    accent: "#f96706",
  },
  {
    icon: Target,
    title: "Cost That Makes Sense",
    description:
      "Senior engineering at India economics, with written phased estimates and no surprise invoices.",
    accent: "#f0650f",
  },
  {
    icon: ShieldCheck,
    title: "Zero Lock-In",
    description:
      "Your code in your repository from the first commit, IP assigned to you, written scope, and an easy exit.",
    accent: "#3089a6",
  },
  {
    icon: Users,
    title: "Communication That Works",
    description:
      "English-first written process, 4+ hours of daily overlap with the US East Coast plus full UK/EU hours, and a response within 1 business day.",
    accent: "#3089a6",
  },
];

// Honest micro-stats — every figure is already claimed elsewhere on the site
// (OurStory / SEOHead foundingDate, services.js catalog, articles.ts guides,
// and the Communication reason copy below).
const STATS = [
  { value: "2023", label: "Founded" },
  { value: "9", label: "Services" },
  { value: "21+", label: "Engineering guides" },
  { value: "4+ hrs", label: "US overlap daily" },
  { value: "<1 day", label: "Response time" },
];

// Shared-border cell classes for the stats strip: 2 cols on mobile
// (last cell spans full width), 5 cols from sm up.
const STAT_CELL_BORDERS = [
  "",
  "border-l",
  "border-t sm:border-l sm:border-t-0",
  "border-l border-t sm:border-t-0",
  "col-span-2 border-t sm:col-span-1 sm:border-l sm:border-t-0",
];

// Shared-border cell classes for the reason tiles: 1 col mobile,
// 2 cols at sm, 4 cols at lg.
const REASON_CELL_BORDERS = [
  "",
  "border-t sm:border-l sm:border-t-0",
  "border-t lg:border-l lg:border-t-0",
  "border-t sm:border-l lg:border-t-0",
];

export default function WhyChooseUs() {
  return (
    <section className="relative bg-white bg-dot-grid py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#c2410c]">
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

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white sm:grid-cols-5">
          {STATS.map(({ value, label }, index) => (
            <div
              key={label}
              className={`flex flex-col items-center justify-center border-[#e7e9ee] px-4 py-5 text-center ${STAT_CELL_BORDERS[index]}`}
            >
              <span className="text-2xl font-extrabold tabular-nums tracking-tight text-[#c2410c]">
                {value}
              </span>
              <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#54607a]">
                {label}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-8 grid overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white sm:grid-cols-2 lg:grid-cols-4">
          {REASONS.map(({ icon: Icon, title, description, accent }, index) => (
            <div
              key={title}
              style={{ animationDelay: `${index * 0.1}s`, "--accent": accent }}
              className={`why-item group flex flex-col border-[#e7e9ee] p-7 transition-colors duration-300 hover:bg-[#fff7ed] ${REASON_CELL_BORDERS[index]}`}
            >
              <div className="flex items-start justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#e7e9ee] bg-white text-[var(--accent)] transition-colors duration-300 group-hover:border-[#f96706] group-hover:bg-[#f96706] group-hover:text-white">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-bold tracking-widest text-[var(--accent)]">
                  0{index + 1}
                </span>
              </div>

              <h3 className="mt-5 text-base font-bold text-[#0f172a]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#54607a]">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
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

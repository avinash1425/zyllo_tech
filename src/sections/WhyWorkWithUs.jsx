import { Clock3, MessageSquare, ShieldCheck, Users } from "lucide-react";

const REASONS = [
  {
    icon: Clock3,
    title: "Fast Response",
    description: "We reply to every inquiry within one business day.",
  },
  {
    icon: Users,
    title: "Direct Access to Engineers",
    description: "You talk to the people actually building your product.",
  },
  {
    icon: MessageSquare,
    title: "Clear Communication",
    description: "No jargon-heavy proposals — just a straightforward conversation.",
  },
  {
    icon: ShieldCheck,
    title: "No-Pressure Consultation",
    description: "Your first call is about understanding your needs, not a pitch.",
  },
];

export default function WhyWorkWithUs() {
  return (
    <section className="relative overflow-hidden border-t border-[#d9dde2] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/3 h-72 w-72 rounded-full bg-[#f96706]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-[#1c2f4a]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f96706]">
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
            Why Work With Us
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[#1d2735] sm:text-4xl">
            What happens after you{" "}
            <span className="bg-gradient-to-r from-[#f96706] to-[#3089a6] bg-clip-text text-transparent">
              hit send
            </span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#6c7889]">
            Reaching out shouldn&apos;t feel like a black box. Here&apos;s what
            to expect, in order.
          </p>
        </div>

        {/* Connected process row — circular badges on a dashed connector,
            same visual family as a step-by-step implementation timeline.
            Step titles carry real weight since they ARE the content here. */}
        <div className="relative mt-14 rounded-[28px] border border-[#e2e5ea] bg-white px-8 py-12 shadow-sm sm:px-10 lg:px-12">
          <div className="relative flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
            <span
              aria-hidden="true"
              className="absolute top-[34px] left-[76px] right-[76px] hidden h-0.5 lg:block"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, #d9dde2 0, #d9dde2 8px, transparent 8px, transparent 15px)",
              }}
            />
            {REASONS.map(({ icon: Icon, title, description }, index) => {
              const accent = index % 2 === 0 ? "#f96706" : "#3089a6";
              const accentDeep = index % 2 === 0 ? "#c9580d" : "#1c2f4a";
              return (
                <div
                  key={title}
                  className="group relative flex flex-1 flex-row items-start gap-4 text-left lg:flex-col lg:items-center lg:text-center"
                >
                  <span
                    className="relative z-[1] flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition-transform duration-300 group-hover:scale-110 lg:h-[68px] lg:w-[68px]"
                    style={{
                      background: `linear-gradient(135deg, ${accent}, ${accentDeep})`,
                      boxShadow: `0 14px 26px -10px ${accentDeep}55`,
                    }}
                  >
                    <Icon className="h-6 w-6 lg:h-7 lg:w-7" aria-hidden="true" />
                  </span>
                  <div className="lg:mt-4">
                    <h3 className="text-lg font-extrabold leading-snug tracking-tight text-[#1d2735] lg:text-[17px]">
                      {title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#6c7889] lg:mt-2 lg:max-w-[200px]">
                      {description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

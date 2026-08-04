import { Compass, Heart, Lightbulb, ShieldCheck } from "lucide-react";

const VALUES = [
  {
    icon: Compass,
    title: "Clarity Over Complexity",
    description:
      "We explain decisions in plain language and keep every engagement transparent, from scope to cost.",
  },
  {
    icon: Lightbulb,
    title: "Curiosity Driven",
    description:
      "We stay close to new tools and techniques, but only adopt what genuinely serves the product.",
  },
  {
    icon: ShieldCheck,
    title: "Ownership Mindset",
    description:
      "We treat every project like it's our own product, not just a ticket to close.",
  },
  {
    icon: Heart,
    title: "People First",
    description:
      "Good software comes from good collaboration — with clients, and with each other.",
  },
];

export default function Mission() {
  return (
    <section className="relative overflow-hidden bg-white py-12 lg:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 left-1/3 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-20 right-1/3 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
              Our Mission
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
              Building software that businesses can actually rely on
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[#676b7a]">
              We started Zyllo Tech to close the gap between what businesses
              need and what most software vendors deliver. Too many projects
              get lost in miscommunication, scope creep, and code that&apos;s
              hard to maintain.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
              Our mission is simple: build technology that works, explain it
              clearly, and stay accountable long after launch.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {VALUES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-2xl border border-white/60 bg-white/60 p-6 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#f7941e]/30 hover:shadow-lg"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15">
                  <Icon className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-[#2b303b]">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#676b7a]">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

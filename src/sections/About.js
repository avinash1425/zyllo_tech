import Image from "next/image";
import { Building2, Globe2, Users2 } from "lucide-react";

const HIGHLIGHTS = [
  {
    icon: Users2,
    label: "A small, senior team",
    description: "No account managers between you and the engineers building your product.",
  },
  {
    icon: Globe2,
    label: "India based, global reach",
    description: "Working with founders and teams across time zones without missing a beat.",
  },
  {
    icon: Building2,
    label: "One team, every discipline",
    description:
      "Strategy, design, engineering, and support under one roof, so nothing gets lost in handoffs.",
  },
];

export default function About() {
  return (
    <section className="relative overflow-hidden bg-white py-12 lg:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 -left-24 h-72 w-72 rounded-full bg-[#f7941e]/10 blur-[100px]" />
        <div className="absolute bottom-0 -right-24 h-72 w-72 rounded-full bg-[#1f4693]/10 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="relative order-2 lg:order-1">
            <div className="absolute -inset-4 -z-10 rounded-[28px] bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15 blur-2xl" />
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/60 shadow-xl">
              <Image
                src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1000&q=80"
                alt="Zyllo Tech team collaborating"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
              Who We Are
            </span>

            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
              A software team built to move as fast as your ideas
            </h2>

            <p className="mt-5 text-lg leading-relaxed text-[#676b7a]">
              At Zyllo Tech, we partner with businesses to design, develop,
              and deliver intelligent software solutions that solve real
              world challenges. From web and mobile applications to AI
              powered platforms and cloud solutions, we create technology
              that empowers organizations to innovate, scale, and stay ahead
              in a rapidly evolving digital world.
            </p>

            <p className="mt-8 text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
              What Sets Us Apart
            </p>

            <div className="mt-4 flex flex-col gap-4">
              {HIGHLIGHTS.map(({ icon: Icon, label, description }) => (
                <div
                  key={label}
                  className="flex items-start gap-4 rounded-xl border border-white/60 bg-white/60 p-4 shadow-sm backdrop-blur-md transition-shadow duration-300 hover:shadow-md"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15">
                    <Icon className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-semibold text-[#2b303b]">{label}</p>
                    <p className="mt-0.5 text-sm text-[#676b7a]">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

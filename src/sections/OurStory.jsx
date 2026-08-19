import { CompatImage as Image } from "@/components/NextCompat";
import { Compass, Target } from "lucide-react";

// Mission/Vision moved down into this section (was its own standalone
// section higher up the page) — sits below the story + photo row instead.
const CARDS = [
  {
    icon: Target,
    title: "Our Mission",
    description:
      "To deliver innovative, secure, and scalable software solutions that help businesses grow through technology.",
    color: "#f96706",
  },
  {
    icon: Compass,
    title: "Our Vision",
    description:
      "To become a trusted global technology partner known for delivering high-quality digital solutions and lasting client relationships.",
    color: "#3089a6",
  },
];

export default function OurStory() {
  return (
    <section className="relative overflow-hidden bg-white py-14 lg:py-18">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 -right-24 h-72 w-72 rounded-full bg-[#f96706]/10 blur-[100px]" />
        <div className="absolute bottom-0 -left-24 h-72 w-72 rounded-full bg-[#1c2f4a]/10 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-[#f96706]">
              <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
              About Us
            </span>

            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#1d2735] sm:text-4xl">
              Your Trusted{" "}
              <span className="bg-gradient-to-r from-[#f96706] to-[#3089a6] bg-clip-text text-transparent">
                Technology Partner
              </span>
            </h2>

            <p className="mt-5 text-lg leading-relaxed text-[#6c7889]">
              At Zyllo Tech, we help businesses transform ideas into powerful
              digital products. From strategy and design to development and
              deployment, we deliver solutions that are secure, scalable, and
              built for long-term success.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-[#6c7889]">
              We believe successful software comes from strong collaboration,
              clear communication, and a commitment to quality at every
              stage.
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 -z-10 rounded-[28px] bg-gradient-to-br from-[#1c2f4a]/15 to-[#f96706]/15 blur-2xl" />
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/60 shadow-xl">
              <Image
                src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1000&q=80"
                alt="Zyllo Tech engineers planning a project"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
          </div>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 border-t border-[#e2e5ea] pt-12 lg:grid-cols-2">
          {CARDS.map(({ icon: Icon, title, description, color }) => (
            <div
              key={title}
              style={{ borderLeftWidth: "3px", borderLeftColor: color }}
              className="group flex gap-5 rounded-2xl border border-[#e2e5ea] bg-[#f8f9fb] p-7 transition-all duration-300 hover:-translate-y-1 hover:bg-white hover:shadow-lg"
            >
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
                style={{ backgroundColor: color }}
              >
                <Icon className="h-5.5 w-5.5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-[#0f172a]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#54607a]">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { CompatImage as Image } from "@/components/NextCompat";
import { CompatLink as Link } from "@/components/NextCompat";
import { ArrowRight, Compass, Target } from "lucide-react";

const VISION_MISSION = [
  {
    icon: Compass,
    title: "Our Vision",
    description:
      "To be the trusted technology partner for ambitious businesses across India and beyond.",
    color: "bg-[#f96706]",
    hoverBorder: "hover:border-[#f96706]/40",
    hoverShadow: "hover:shadow-[#f96706]/10",
  },
  {
    icon: Target,
    title: "Our Mission",
    description:
      "AI-driven engineering, hands-on partnership — production-ready products, faster.",
    color: "bg-[#3089a6]",
    hoverBorder: "hover:border-[#3089a6]/40",
    hoverShadow: "hover:shadow-[#3089a6]/10",
  },
];

export default function About() {
  return (
    <section className="relative bg-white py-14 lg:py-20">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f96706]">
              <span aria-hidden="true" className="h-px w-8 bg-gradient-to-r from-[#f96706] to-[#3089a6]" />
              About Us
            </span>

            <h2 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-[#0f172a] sm:text-5xl">
              Who We{" "}
              <span className="bg-gradient-to-r from-[#f96706] via-[#c9580d] to-[#3089a6] bg-clip-text text-transparent">
                Are
              </span>
            </h2>

            <p className="mt-5 max-w-md text-base leading-relaxed text-[#54607a] sm:text-lg">
              Zyllo Tech is a software development company delivering
              innovative web, mobile, AI, and cloud solutions — partnering
              with startups and enterprises to build products that create
              lasting business value.
            </p>

            <div className="mt-7 flex flex-col gap-3">
              {VISION_MISSION.map(({ icon: Icon, title, description, color, hoverBorder, hoverShadow }) => (
                <div
                  key={title}
                  className={`group flex items-start gap-3 rounded-xl border border-[#e2e5ea] bg-[#f8f9fb] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:shadow-lg ${hoverBorder} ${hoverShadow}`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 ${color}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-[#0f172a]">{title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-[#54607a]">{description}</p>
                  </div>
                </div>
              ))}
            </div>

            <Link
              href="/about"
              className="mt-7 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] to-[#c9580d] px-6 py-3 text-sm font-semibold text-white shadow-[0_16px_30px_-8px_rgba(249,103,6,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-8px_rgba(48,137,166,0.35)] hover:from-[#f96706] hover:to-[#3089a6]"
            >
              Learn More About Us
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          {/* Gradient-framed photo — same frame technique as the login page */}
          <div className="rounded-[1.6rem] bg-gradient-to-br from-[#f96706] via-[#ffb15c] to-[#3089a6] p-[3px] shadow-xl shadow-[#1c2f4a]/10">
            <div className="relative aspect-[4/3.4] w-full overflow-hidden rounded-[1.45rem] bg-white">
              <Image
                src="/protfolio.png"
                alt="The Zyllo Tech team collaborating in the studio"
                fill
                sizes="(min-width: 1024px) 48vw, 100vw"
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

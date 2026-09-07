import { CompatImage as Image } from "@/components/NextCompat";
import { CompatLink as Link } from "@/components/NextCompat";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { SERVICES } from "@/data/services";

// Engineered tile grid: all 8 services live inside ONE bordered container
// with shared 1px white/10 internal borders (no gaps), 21st.dev-style, over
// the dark photo plus a subtle dot-grid overlay. Per-cell border-t/border-l
// classes are computed per breakpoint instead of divide-x/divide-y so
// wrapped rows never show stray divider lines.
const TILES = SERVICES.slice(0, 8);

const ACCENT = "from-[#f96706] via-[#ffb15c] to-[#3089a6]";

// 2 cols on mobile, 4 cols from lg up.
const TILE_BORDERS = [
  "",
  "border-l",
  "border-t lg:border-l lg:border-t-0",
  "border-l border-t lg:border-t-0",
  "border-t",
  "border-l border-t",
  "border-t lg:border-l",
  "border-l border-t",
];

export default function ServiceTiles() {
  return (
    <section className="relative isolate overflow-hidden bg-[#0b0e17] py-10 lg:py-14">
      <Image
        src="/robo.jpg"
        alt=""
        fill
        sizes="100vw"
        className="-z-20 object-cover object-[72%_38%] opacity-[0.42] saturate-[1.1] contrast-[1.05]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-br from-[#0b0e17]/35 via-[#0b0e17]/55 to-[#0b0e17]/80"
      />
      <div aria-hidden="true" className="bg-dot-grid-dark absolute inset-0 -z-[5]" />

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-lg">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f96706]">
              <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
              What We Offer
            </span>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              Services We{" "}
              <span className="bg-gradient-to-r from-[#ffb15c] to-[#6d94d6] bg-clip-text text-transparent">
                Deliver
              </span>
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-white/70">
              A cross-section of the engineering, design, and delivery work
              our team takes on every day.
            </p>
          </div>
          <Link
            href="/services"
            className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-transparent hover:bg-gradient-to-r hover:from-[#f96706] hover:to-[#3089a6]"
          >
            View More Services
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1"
              aria-hidden="true"
            />
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-[#0b0e17]/60 backdrop-blur-md lg:grid-cols-4">
          {TILES.map(({ slug, title, tagline, icon: Icon }, index) => (
            <Link
              key={slug}
              href={`/services/${slug}`}
              style={{ animationDelay: `${index * 0.06}s` }}
              className={`tile-in group relative border-white/10 p-6 transition-colors duration-300 hover:bg-white/[0.04] lg:p-7 ${TILE_BORDERS[index]}`}
            >
              <ArrowUpRight
                className="absolute right-5 top-5 h-4 w-4 text-[#ffb15c] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                aria-hidden="true"
              />
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${ACCENT}`}
              >
                <Icon className="h-5.5 w-5.5" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-base font-bold leading-snug text-white transition-colors duration-200 group-hover:text-[#f96706]">
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/65">
                {tagline}
              </p>
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        .tile-in {
          animation: tileFadeUp 0.6s ease-out both;
        }
        @keyframes tileFadeUp {
          from {
            opacity: 0;
            transform: translateY(14px);
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

"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SERVICES } from "@/data/services";

// Even grid of boxes, all 8 services equal — swapped out from an earlier
// spotlight-plus-list layout per request. Dark background photo (kept
// genuinely visible, not buried under a heavy wash) stays; each service is
// now a glass card with icon, title, and tagline, gapped evenly.
const TILES = SERVICES.slice(0, 8);

const ACCENT = "from-[#f96706] via-[#ffb15c] to-[#3089a6]";

export default function ServiceTiles() {
  return (
    <section className="relative isolate overflow-hidden bg-[#0b0e17] py-10 lg:py-14">
      <Image
        src="/home-service.jpg"
        alt=""
        fill
        sizes="100vw"
        className="-z-20 object-cover object-[80%_40%] opacity-[0.42] saturate-[1.1] contrast-[1.05]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-br from-[#0b0e17]/35 via-[#0b0e17]/55 to-[#0b0e17]/80"
      />

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

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TILES.map(({ slug, title, tagline, icon: Icon }, index) => (
            <Link
              key={slug}
              href={`/services/${slug}`}
              style={{ animationDelay: `${index * 0.06}s` }}
              className="tile-in group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-lg shadow-black/20 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#f96706]/40 hover:bg-white/[0.1] hover:shadow-xl hover:shadow-[#f96706]/10"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r transition-transform duration-300 group-hover:scale-x-100 ${ACCENT}`}
              />
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105 ${ACCENT}`}
              >
                <Icon className="h-5.5 w-5.5" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-base font-bold leading-snug text-white">
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/65">
                {tagline}
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#ffb15c] opacity-0 transition-all duration-200 group-hover:opacity-100">
                Learn More
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </div>

      <style jsx>{`
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

"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getServiceBySlug } from "@/data/services";
import { SERVICE_THEMES } from "./ServiceGrid";

// Matches a "What We Do" reference mockup exactly: centered heading, 4
// flagship services in a single row, each card a soft pastel gradient tile
// with a glowing icon circle, title, one-line description, and "Learn
// More" — same card style and colors as the full /services grid, just
// narrowed to 4 featured slugs with a "See all services" link below.
const FEATURED_SLUGS = [
  "ui-ux-design",
  "web-development",
  "mobile-app-development",
  "cloud-solutions",
];

export default function Services() {
  const featured = FEATURED_SLUGS.map(getServiceBySlug).filter(Boolean);

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-[#fff7ed] to-white py-8 lg:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#1f4693]/10 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#1f4693] uppercase">
            Services
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#0f172a] sm:text-4xl">
            Our Services
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#475569]">
            Comprehensive technology solutions tailored to your business
            needs.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((service) => {
            const Icon = service.icon;
            const theme = SERVICE_THEMES[service.slug];
            return (
              <Link
                key={service.slug}
                href={`/services/${service.slug}`}
                className={`group flex flex-col rounded-2xl border bg-white/60 p-5 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:bg-white/80 hover:shadow-lg ${theme.border}`}
              >
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-lg ${theme.badge}`}
                >
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>

                <h3 className="mt-4 text-base font-bold leading-snug text-[#0f172a]">
                  {service.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#475569]">
                  {service.description}
                </p>

                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0f172a] transition-all duration-200 group-hover:gap-2.5">
                  Learn More
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </Link>
            );
          })}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/services"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] transition-all duration-200 hover:gap-2.5"
          >
            Explore All Services
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

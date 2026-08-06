"use client";

import Link from "next/link";
import { Code2, Smartphone, Cloud, Sparkles, ArrowRight } from "lucide-react";

const FEATURED_SERVICES = [
  {
    slug: "web-development",
    icon: Code2,
    title: "Web Development",
    items: ["Custom Websites", "Web Applications", "E-Commerce Builds"],
  },
  {
    slug: "mobile-app-development",
    icon: Smartphone,
    title: "Mobile Apps",
    items: ["iOS & Android", "Cross-Platform Apps", "App Store Launch"],
  },
  {
    slug: "cloud-solutions",
    icon: Cloud,
    title: "Cloud Solutions",
    items: ["Infrastructure Setup", "CI/CD Pipelines", "24/7 Monitoring"],
  },
  {
    slug: "ai-solutions",
    icon: Sparkles,
    title: "AI & Automation",
    items: ["Workflow Automation", "AI Copilots", "Process Optimization"],
  },
];

export default function Services() {
  return (
    <section className="relative overflow-hidden bg-[#fafbfc] py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <span className="text-sm font-bold tracking-[0.2em] text-[#1f4693] uppercase">
              What We Do
            </span>
            <h2 className="mt-4 max-w-xl text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
              We can help your business scale and leverage technology
            </h2>
          </div>

          <Link
            href="/services"
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#2b303b]/15 px-5 py-2.5 text-sm font-semibold text-[#2b303b] transition-all duration-200 hover:border-[#f7941e] hover:text-[#f7941e]"
          >
            Explore Our Solutions
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURED_SERVICES.map(({ slug, icon: Icon, title, items }) => (
            <Link
              key={slug}
              href={`/services/${slug}`}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/50 p-6 text-[#2b303b] shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:bg-[#1f4693] hover:text-white hover:shadow-xl hover:shadow-[#1f4693]/25"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#2b303b]/15 backdrop-blur-sm transition-all duration-300 group-hover:-rotate-6 group-hover:scale-110 group-hover:border-white/30">
                <Icon
                  className="h-5 w-5 text-[#2b303b] transition-colors duration-300 group-hover:text-white"
                  aria-hidden="true"
                />
              </span>

              <h3 className="mt-6 text-lg font-semibold">{title}</h3>

              <ul className="mt-3 flex flex-col gap-1.5">
                {items.map((item) => (
                  <li
                    key={item}
                    className="text-sm leading-relaxed text-[#676b7a] transition-colors duration-300 group-hover:text-white/75"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

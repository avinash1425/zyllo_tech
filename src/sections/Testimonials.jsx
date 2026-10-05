"use client";

import { Star, Quote } from "lucide-react";

// Placeholder testimonials — swap in real client quotes and names once available.
const TESTIMONIALS = [
  {
    quote:
      "Zyllo Tech delivered our platform on time with excellent quality. Communication was clear at every stage, and the final product exceeded what we expected.",
    name: "Sample Client",
    role: "CEO, Sample Company",
  },
  {
    quote:
      "Their team understood our requirements quickly and shipped a reliable, well-built product. A genuinely dependable partner to work with.",
    name: "Sample Client",
    role: "Founder, Sample Startup",
  },
];

export default function Testimonials() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Testimonials
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            What clients say about working with us
          </h2>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {TESTIMONIALS.map(({ quote, name, role }, index) => {
            const accent = index % 2 === 0 ? "#f7941e" : "#1f4693";
            return (
              <div
                key={name + index}
                className="group relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#1f4693]/[0.03] p-7 shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-xl hover:shadow-[#1f4693]/10"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-50 bg-gradient-to-r from-[#f7941e] to-[#1f4693] opacity-40 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
                />
                <Quote
                  className="pointer-events-none absolute -bottom-3 -right-3 h-24 w-24 text-[#1f4693]/[0.05]"
                  aria-hidden="true"
                />

                <div className="relative flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, starIndex) => (
                    <Star
                      key={starIndex}
                      className="h-4 w-4 fill-current"
                      style={{ color: accent }}
                      aria-hidden="true"
                    />
                  ))}
                </div>

                <p className="relative mt-4 text-base leading-relaxed text-[#2b303b]">
                  &ldquo;{quote}&rdquo;
                </p>

                <div className="relative mt-6 flex items-center gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: accent }}
                  >
                    {name.charAt(0)}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[#2b303b]">{name}</p>
                    <p className="text-xs text-[#676b7a]">{role}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

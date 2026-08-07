"use client";

import { Users, Zap, Layers, Handshake } from "lucide-react";

const BELIEFS = [
  {
    icon: Users,
    title: "Experienced Team",
    description:
      "A skilled team delivering modern technology solutions with industry best practices.",
  },
  {
    icon: Zap,
    title: "Quality First",
    description:
      "Clean, secure, and scalable software built for long-term success.",
  },
  {
    icon: Layers,
    title: "Business Focused",
    description:
      "Every solution is designed to support your goals and future growth.",
  },
  {
    icon: Handshake,
    title: "Reliable Partnership",
    description:
      "Transparent communication, timely delivery, and ongoing support throughout your journey.",
  },
];

export default function WhatWeBelieve() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Why Choose Our Services
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Built Around Your Business Goals
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            We focus on delivering reliable, scalable, and high-quality
            solutions that create lasting value.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {BELIEFS.map(({ icon: Icon, title, description }, index) => {
            const accent = index % 2 === 0 ? "#f7941e" : "#1f4693";
            return (
              <div
                key={title}
                className="group relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#1f4693]/[0.03] p-6 shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-xl hover:shadow-[#1f4693]/10"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-50 bg-gradient-to-r from-[#f7941e] to-[#1f4693] opacity-40 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
                />
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/70 shadow-md transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
                  style={{ backgroundColor: `${accent}20` }}
                >
                  <Icon className="h-6 w-6" style={{ color: accent }} aria-hidden="true" />
                </div>

                <h3 className="mt-5 text-lg font-semibold text-[#2b303b]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#676b7a]">{description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

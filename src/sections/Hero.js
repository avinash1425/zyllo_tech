"use client";

import Link from "next/link";
import { ArrowRight, Code2, Cloud, Smartphone, Sparkles } from "lucide-react";
import GlowHorizon from "@/components/GlowHorizon";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#0b0e17]">
      <GlowHorizon />

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-6 py-24 lg:grid-cols-2 lg:gap-10 lg:px-8 lg:py-32">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-sm">
            Custom Software &amp; AI Solutions
          </span>

          <h1 className="mt-6 text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl">
            Building Software That Grows Your Business
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-white/70 sm:text-xl lg:mx-0">
            We design and develop scalable web, mobile, and cloud solutions
            for startups and enterprises.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f7941e] px-8 py-4 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(0,0,0,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:bg-[#db7d17]"
            >
              Get Started
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-8 py-4 text-sm font-semibold text-white backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/10"
            >
              Contact Us
            </Link>
          </div>
        </div>

        {/* Professional 3D-style illustration */}
        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-gradient-to-br from-[#f7941e]/20 to-[#1f4693]/30 blur-[80px]"
          />

          <div className="relative flex aspect-square items-center justify-center">
            {/* Floating card stack illustration */}
            <div className="absolute left-1/2 top-1/2 h-56 w-72 -translate-x-1/2 -translate-y-1/2 rotate-[-8deg]">
              <div className="floating-card h-full w-full rounded-2xl border border-white/10 bg-gradient-to-br from-[#1f4693]/40 to-[#141826] p-6 shadow-2xl shadow-black/40 backdrop-blur-md">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f7941e]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                </div>
                <div className="mt-6 h-3 w-3/4 rounded-full bg-white/15" />
                <div className="mt-3 h-3 w-1/2 rounded-full bg-white/10" />
                <div className="mt-6 flex gap-2">
                  <div className="h-16 flex-1 rounded-lg bg-[#f7941e]/20" />
                  <div className="h-16 flex-1 rounded-lg bg-[#5b7fd4]/20" />
                </div>
              </div>
            </div>

            <div className="absolute left-1/2 top-1/2 h-48 w-64 -translate-x-1/2 -translate-y-1/2 translate-x-16 translate-y-10 rotate-[6deg]">
              <div className="floating-card floating-card-delay h-full w-full rounded-2xl border border-white/10 bg-gradient-to-br from-[#f7941e]/25 to-[#141826] p-6 shadow-2xl shadow-black/40 backdrop-blur-md">
                <Code2 className="h-6 w-6 text-[#f7941e]" aria-hidden="true" />
                <div className="mt-4 h-3 w-2/3 rounded-full bg-white/15" />
                <div className="mt-3 h-3 w-1/3 rounded-full bg-white/10" />
              </div>
            </div>

            {/* Orbiting icon chips */}
            <span className="orbit-chip absolute -top-2 right-8 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-[#141826] shadow-lg shadow-black/30">
              <Smartphone className="h-6 w-6 text-[#5b7fd4]" aria-hidden="true" />
            </span>
            <span className="orbit-chip orbit-chip-delay absolute bottom-4 -left-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-[#141826] shadow-lg shadow-black/30">
              <Cloud className="h-6 w-6 text-[#f7941e]" aria-hidden="true" />
            </span>
            <span className="orbit-chip absolute bottom-0 right-0 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#141826] shadow-lg shadow-black/30">
              <Sparkles className="h-5 w-5 text-[#5b7fd4]" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .floating-card {
          animation: floatCard 6s ease-in-out infinite;
        }
        .floating-card-delay {
          animation-delay: 1.2s;
        }
        @keyframes floatCard {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-14px);
          }
        }
        .orbit-chip {
          animation: orbitFloat 5s ease-in-out infinite;
        }
        .orbit-chip-delay {
          animation-delay: 1.6s;
        }
        @keyframes orbitFloat {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }
      `}</style>
    </section>
  );
}

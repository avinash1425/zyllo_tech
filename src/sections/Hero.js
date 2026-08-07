"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

// Rotating hero background. Add more image paths here (drop the files into
// /public first) and the crossfade below will automatically cycle through
// all of them — no other code changes needed.
const HERO_IMAGES = [
  "/hero-home1.png",
  "/hero-home2.png",
  "/hero-home3.png",
  "/hero-home4.png",
  "/hero-home5.png",
];

const ROTATE_INTERVAL_MS = 6000;

export default function Hero() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (HERO_IMAGES.length <= 1) return; // nothing to rotate with only one image
    const timer = setInterval(() => {
      setActiveIndex((i) => (i + 1) % HERO_IMAGES.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="relative isolate flex min-h-[42vh] items-center overflow-hidden py-10 lg:min-h-[45vh] lg:py-12">
      {/* Full-bleed background image, crossfading between HERO_IMAGES */}
      <div aria-hidden="true" className="absolute inset-0 -z-20">
        {HERO_IMAGES.map((src, index) => (
          <Image
            key={src}
            src={src}
            alt=""
            fill
            priority={index === 0}
            sizes="100vw"
            className={`object-cover transition-opacity duration-1000 ease-in-out ${
              index === activeIndex ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
      </div>

      {/* Light readability scrim, warm orange/blue tone matching the logo */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-r from-white/45 via-white/20 to-[#eff4fc]/10"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-t from-white/25 via-transparent to-transparent"
      />

      <div className="relative mx-auto w-full max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/50 px-3.5 py-1.5 text-xs font-semibold text-[#f7941e] shadow-sm backdrop-blur-sm">
            Custom Software &amp; AI Solutions
          </span>

          <h1 className="mt-6 text-4xl font-bold leading-tight text-[#0f172a] sm:text-5xl lg:text-6xl">
            Engineering Digital Solutions for Modern Businesses
          </h1>

          <p
            className="mx-auto mt-6 max-w-xl text-lg leading-8 text-[#1c2333] sm:text-xl"
            style={{ textShadow: "0 1px 12px rgba(255,255,255,0.8)" }}
          >
            We design and develop secure, scalable, and high performance
            software that helps businesses innovate, streamline operations,
            and accelerate growth.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693] px-8 py-4 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:brightness-110"
            >
              Get Started
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/70 bg-white/50 px-8 py-4 text-sm font-semibold text-[#0f172a] shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/80"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

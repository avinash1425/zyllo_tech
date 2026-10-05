"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/lib/nx/link";
import Image from "@/lib/nx/image";
import { ArrowRight, Check } from "lucide-react";

// Slider structure, timing, and interactions replicated from a reference
// banner (arrows, dots, autoplay interval, hover-pause, swipe, staggered
// entrance animation, section height) — content and colors are our own.
const AUTOPLAY_MS = 6500;

const TRUST_ITEMS = [
  "DPIIT-Recognized — Startup India",
  "Response Within 1 Business Day",
  "India-Based, Globally Delivered",
];

const SLIDES = [
  {
    image: "/hero-home1.png",
    accent: "#f96706",
    accentSoft: "#ffb15c",
    eyebrow: "Custom Software Development",
    titleLine1: "Engineering Digital Solutions,",
    titleAccent: "Built to Scale",
    text: "Custom software designed to streamline operations, improve productivity, and support business growth — from strategy to launch.",
    primaryCta: { label: "Start Your Project", href: "/contact" },
    secondaryCta: { label: "Explore Services", href: "/services" },
  },
  {
    image: "/hero-home3.png",
    accent: "#3089a6",
    accentSoft: "#6d94d6",
    eyebrow: "Mobile App Development",
    titleLine1: "Apps People",
    titleAccent: "Actually Use",
    text: "Native and cross-platform mobile applications that deliver seamless experiences across every device.",
    primaryCta: { label: "Explore Mobile Apps", href: "/services/mobile-app-development" },
    secondaryCta: { label: "Request a Quote", href: "/contact" },
  },
  {
    image: "/hero-home5.png",
    accent: "#f96706",
    accentSoft: "#ffb15c",
    eyebrow: "AI Solutions",
    titleLine1: "Practical AI,",
    titleAccent: "Not Novelty",
    text: "AI-powered applications and automation that improve efficiency and enable smarter business decisions.",
    primaryCta: { label: "Explore AI Solutions", href: "/services/ai-solutions" },
    secondaryCta: { label: "Request a Quote", href: "/contact" },
  },
  {
    image: "/hero-home4.png",
    accent: "#3089a6",
    accentSoft: "#6d94d6",
    eyebrow: "Cloud & DevOps",
    titleLine1: "Infrastructure That",
    titleAccent: "Scales As You Grow",
    text: "Scalable cloud infrastructure and deployment solutions for secure, reliable, and high-performing applications.",
    primaryCta: { label: "Explore Cloud Solutions", href: "/services/cloud-solutions" },
    secondaryCta: { label: "Request a Quote", href: "/contact" },
  },
];

export default function Hero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const intervalRef = useRef(null);
  const touchStartRef = useRef(null);

  function goTo(index) {
    setActiveIndex(((index % SLIDES.length) + SLIDES.length) % SLIDES.length);
  }

  function next() {
    goTo(activeIndex + 1);
  }

  function prev() {
    goTo(activeIndex - 1);
  }

  function stopAutoplay() {
    if (intervalRef.current) clearInterval(intervalRef.current);
  }

  function startAutoplay() {
    intervalRef.current = setInterval(() => {
      setActiveIndex((i) => (i + 1) % SLIDES.length);
    }, AUTOPLAY_MS);
  }

  function restartAutoplay() {
    stopAutoplay();
    startAutoplay();
  }

  useEffect(() => {
    startAutoplay();
    return stopAutoplay;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleTouchStart(event) {
    touchStartRef.current = event.touches[0].clientX;
  }

  function handleTouchEnd(event) {
    if (touchStartRef.current === null) return;
    const delta = event.changedTouches[0].clientX - touchStartRef.current;
    if (Math.abs(delta) > 40) {
      delta < 0 ? next() : prev();
      restartAutoplay();
    }
    touchStartRef.current = null;
  }

  return (
    <section
      className="zt-hero-slider relative isolate grid overflow-hidden bg-[#0b0e17] text-white"
      aria-roledescription="carousel"
      aria-label="Zyllo Tech highlights"
      onMouseEnter={stopAutoplay}
      onMouseLeave={startAutoplay}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <h1 className="sr-only">
        Zyllo Tech Software Solutions — Web, Mobile, AI &amp; Cloud Engineering
      </h1>

      {SLIDES.map((slide, index) => {
        const isActive = index === activeIndex;
        return (
          <article
            key={slide.image}
            className={`zt-hero-slide relative col-start-1 row-start-1 min-w-0 transition-[opacity,visibility] duration-1000 ease-in-out ${
              isActive ? "visible opacity-100" : "invisible opacity-0"
            }`}
            aria-hidden={!isActive}
          >
            <Image
              src={slide.image}
              alt=""
              fill
              priority={index === 0}
              sizes="100vw"
              className={`zt-hero-slide-img object-cover transition-transform duration-[9000ms] ease-out ${
                isActive ? "scale-100" : "scale-[1.08]"
              }`}
            />
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 90% 85% at 50% 55%, rgba(11,14,23,0.86) 0%, rgba(11,14,23,0.68) 45%, rgba(11,14,23,0.4) 75%, rgba(28,47,74,0.28) 100%)",
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-32"
              style={{ background: "linear-gradient(to top, rgba(11,14,23,0.65) 0%, transparent 100%)" }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 right-0 h-[30rem] w-[30rem] rounded-full opacity-30 blur-3xl"
              style={{ background: `radial-gradient(circle, ${slide.accentSoft} 0%, transparent 70%)` }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-32 -left-16 h-[28rem] w-[28rem] rounded-full opacity-25 blur-3xl"
              style={{ background: slide.accent }}
            />

            <div className="zt-hero-content relative mx-auto flex h-full max-w-7xl items-center justify-center px-6 sm:px-20 lg:px-24">
              <div className="mx-auto flex w-full max-w-3xl flex-col items-center py-10 pb-24 text-center sm:py-16 sm:pb-24 lg:py-20 lg:pb-24">
                <span
                  className={`zt-hero-eyebrow inline-flex items-center gap-2.5 rounded-full border border-white/20 bg-white/10 py-1.5 pl-2 pr-3.5 text-[11px] font-bold uppercase tracking-[0.18em] backdrop-blur-md sm:text-xs ${
                    isActive ? "zt-hero-rise" : ""
                  }`}
                  style={isActive ? { animationDelay: "0.05s" } : undefined}
                >
                  <span
                    className="grid h-4 w-4 place-items-center rounded-full"
                    style={{ background: slide.accent }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                  {slide.eyebrow}
                </span>

                <h2
                  className={`mt-4 text-[30px] font-extrabold leading-[1.04] tracking-[-0.028em] text-white [text-shadow:0_2px_22px_rgba(0,0,0,0.65)] sm:text-[44px] lg:text-[52px] 2xl:text-[60px] ${
                    isActive ? "zt-hero-rise" : ""
                  }`}
                  style={isActive ? { animationDelay: "0.16s" } : undefined}
                >
                  {slide.titleLine1}
                  <span
                    className="block bg-clip-text pt-1 text-transparent"
                    style={{
                      backgroundImage: `linear-gradient(90deg, #ffffff 0%, #ffffff 55%, ${slide.accentSoft} 100%)`,
                    }}
                  >
                    {slide.titleAccent}
                  </span>
                </h2>

                <span
                  className="mx-auto mt-4 block h-1 w-20 rounded-full"
                  style={{ background: `linear-gradient(to right, ${slide.accent}, ${slide.accentSoft})` }}
                />

                <p
                  className={`mt-4 max-w-2xl text-[14.5px] leading-[1.6] text-white/90 [text-shadow:0_1px_10px_rgba(0,0,0,0.55)] sm:text-base ${
                    isActive ? "zt-hero-rise" : ""
                  }`}
                  style={isActive ? { animationDelay: "0.28s" } : undefined}
                >
                  {slide.text}
                </p>

                <div
                  className={`mt-6 flex w-full flex-col items-stretch justify-center gap-2.5 min-[420px]:w-auto min-[420px]:flex-row min-[420px]:flex-wrap min-[420px]:items-center ${isActive ? "zt-hero-rise" : ""}`}
                  style={isActive ? { animationDelay: "0.4s" } : undefined}
                >
                  <Link
                    href={slide.primaryCta.href}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold text-white shadow-[0_14px_34px_rgba(0,0,0,0.4)] transition-transform duration-200 hover:-translate-y-0.5"
                    style={{ background: `linear-gradient(135deg, ${slide.accent}, ${slide.accentSoft})` }}
                  >
                    {slide.primaryCta.label}
                  </Link>
                  <Link
                    href={slide.secondaryCta.href}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/50 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-white/20"
                  >
                    {slide.secondaryCta.label}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>

                <ul
                  className={`mt-6 flex flex-col items-center gap-2 text-xs sm:flex-row sm:flex-wrap sm:justify-center font-semibold text-white/90 ${
                    isActive ? "zt-hero-rise" : ""
                  }`}
                  style={isActive ? { animationDelay: "0.52s" } : undefined}
                >
                  {TRUST_ITEMS.map((item) => (
                    <li
                      key={item}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 backdrop-blur-sm"
                    >
                      <span
                        className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-white"
                        style={{ background: "linear-gradient(135deg, #3089a6, #f96706)" }}
                      >
                        <Check className="h-2.5 w-2.5" aria-hidden="true" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        );
      })}

      {/* Arrows */}
      <button
        type="button"
        onClick={() => {
          prev();
          restartAutoplay();
        }}
        aria-label="Previous slide"
        className="zt-slider-arrow absolute left-3 top-1/2 z-20 hidden h-[2.875rem] w-[2.875rem] -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-[#0b0e17]/60 text-white shadow-lg shadow-black/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:border-white/70 hover:bg-[#0b0e17]/80 sm:left-5 sm:grid"
      >
        <ArrowRight className="h-6 w-6 rotate-180" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => {
          next();
          restartAutoplay();
        }}
        aria-label="Next slide"
        className="zt-slider-arrow absolute right-3 top-1/2 z-20 hidden h-[2.875rem] w-[2.875rem] -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-[#0b0e17]/60 text-white shadow-lg shadow-black/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:border-white/70 hover:bg-[#0b0e17]/80 sm:right-5 sm:grid"
      >
        <ArrowRight className="h-6 w-6" aria-hidden="true" />
      </button>

      {/* Dots (+ arrows on phones) */}
      <div className="absolute inset-x-0 bottom-5 z-20 flex items-center justify-center gap-3 sm:bottom-7">
        <button type="button" onClick={() => { prev(); restartAutoplay(); }} aria-label="Previous slide"
          className="grid h-11 w-11 place-items-center rounded-full border border-white/40 bg-[#0b0e17]/60 text-white backdrop-blur-md sm:hidden">
          <ArrowRight className="h-5 w-5 rotate-180" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-1">
          {SLIDES.map((slide, index) => (
            <button key={slide.image} type="button" onClick={() => { goTo(index); restartAutoplay(); }}
              aria-label={`Go to slide ${index + 1}`}
              className="grid h-11 w-5 place-items-center sm:h-6 sm:w-4">
              <span className={`block h-[0.55rem] rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.5)] ring-1 ring-black/20 transition-all duration-200 ${
                  index === activeIndex ? "w-[1.85rem] bg-white" : "w-[0.55rem] bg-white/70"
                }`} />
            </button>
          ))}
        </div>
        <button type="button" onClick={() => { next(); restartAutoplay(); }} aria-label="Next slide"
          className="grid h-11 w-11 place-items-center rounded-full border border-white/40 bg-[#0b0e17]/60 text-white backdrop-blur-md sm:hidden">
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Scroll cue */}
      <span className="zt-scroll-cue absolute bottom-7 right-8 z-20 hidden flex-col items-center gap-2 text-white/85 lg:flex">
        <span className="grid h-[1.6rem] w-4 place-items-start justify-center rounded-full border-[1.5px] border-current pt-1">
          <span className="zt-scroll-cue-dot h-1 w-0.5 rounded-full bg-current" />
        </span>
        <span className="text-[10.5px] font-bold uppercase tracking-[0.22em]">Scroll</span>
      </span>

      {/* Spectrum bar */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 z-20 h-1"
        style={{
          backgroundImage:
            "linear-gradient(90deg, #0b0e17 0%, #1c2f4a 22%, #3089a6 55%, #f96706 85%, #ffb15c 100%)",
        }}
      />

      <style>{`
        .zt-hero-slider { min-height: clamp(540px, 80svh, 760px); }
        @media (min-width: 640px) and (max-width: 1023px) { .zt-hero-slider { min-height: clamp(560px, 62svh, 700px); } }
        @media (min-width: 1024px) { .zt-hero-slider { min-height: clamp(560px, 72svh, 720px); } }
        @media (min-width: 1920px) { .zt-hero-slider { min-height: clamp(640px, 70svh, 820px); } }
        .zt-hero-rise {
          animation: zt-heroRise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes zt-heroRise {
          from {
            opacity: 0;
            transform: translateY(22px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        .zt-scroll-cue-dot {
          animation: zt-cueBounce 1.6s ease-in-out infinite;
        }
        @keyframes zt-cueBounce {
          0%,
          to {
            transform: translateY(0);
            opacity: 1;
          }
          50% {
            transform: translateY(8px);
            opacity: 0.4;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .zt-hero-rise,
          .zt-scroll-cue-dot,
          .zt-hero-slide-img {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </section>
  );
}

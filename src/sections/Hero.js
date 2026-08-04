"use client";

import Image from "next/image";
import Link from "next/link";
import { Award, Cpu, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

const BADGES = [
  { icon: Award, label: "Trusted Partner" },
  { icon: Cpu, label: "AI-Driven Delivery" },
  { icon: Sparkles, label: "India Based" },
];

// Rotating hero background images — one slide per Zyllo Tech service, matching the Services section exactly
const HERO_IMAGES = [
  {
    src: "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1920&q=80",
    alt: "Team in a product strategy and consulting workshop",
    heading: "Product Strategy & Consulting",
    description:
      "Discovery workshops, technical feasibility studies, MVP scoping, and roadmap planning to turn ideas into a clear path to build.",
  },
  {
    src: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1920&q=80",
    alt: "Developer writing code for a web application",
    heading: "Web Development",
    description:
      "Modern, responsive and scalable web applications built with the latest technologies.",
  },
  {
    src: "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1920&q=80",
    alt: "Mobile app development on smartphone and laptop",
    heading: "Mobile App Development",
    description:
      "Native and cross platform mobile applications designed for exceptional user experiences.",
  },
  {
    src: "https://images.unsplash.com/photo-1559028006-448665bd7c7f?w=1920&q=80",
    alt: "Designer sketching UI/UX wireframes",
    heading: "UI/UX Design",
    description:
      "Beautiful interfaces focused on usability, accessibility and business growth.",
  },
  {
    src: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80",
    alt: "Cloud infrastructure and server racks",
    heading: "Cloud Solutions",
    description:
      "Secure cloud infrastructure, deployment and scalable backend architecture.",
  },
  {
    src: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1920&q=80",
    alt: "AI and data analytics dashboards",
    heading: "AI Solutions",
    description:
      "Intelligent AI powered applications and automation that improve productivity.",
  },
  {
    src: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=1920&q=80",
    alt: "Engineer monitoring application maintenance dashboards",
    heading: "Maintenance & Support",
    description:
      "Continuous monitoring, maintenance and technical support for your applications.",
  },
  {
    src: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=1920&q=80",
    alt: "Cybersecurity engineer monitoring systems",
    heading: "Cybersecurity Engineering",
    description:
      "Security-first delivery with OWASP-aligned practices, threat modeling, vulnerability management, and compliance-ready controls.",
  },
  {
    src: "https://images.unsplash.com/photo-1516110833967-0b5716ca1387?w=1920&q=80",
    alt: "QA engineer testing software on multiple screens",
    heading: "Quality Engineering & QA",
    description:
      "Automated test suites, shift-left testing, performance validation, and structured QA processes across web, mobile, and APIs.",
  },
];

export default function Hero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = HERO_IMAGES[activeIndex];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((current) => (current + 1) % HERO_IMAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative overflow-hidden bg-[#0b0e17]">
      {/* Rotating background images */}
      <div aria-hidden="true" className="absolute inset-0">
        {HERO_IMAGES.map((image, index) => (
          <div
            key={image.src}
            className={`absolute inset-0 transition-opacity duration-[1500ms] ease-in-out ${
              index === activeIndex ? "opacity-100" : "opacity-0"
            }`}
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              priority={index === 0}
              sizes="100vw"
              className="object-cover"
            />
          </div>
        ))}
        {/* Dark gradient wash for text readability */}
        <div className="absolute inset-0 bg-[#0b0e17]/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0e17]/90 via-[#0b0e17]/20 to-transparent" />
      </div>

      {/* Soft brand glow accents on top of the image */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-[#f7941e] opacity-[0.12] blur-[110px]" />
        <div className="absolute -bottom-40 right-1/3 h-[24rem] w-[24rem] rounded-full bg-[#de9a3a] opacity-[0.1] blur-[110px]" />
      </div>

      <div className="relative mx-auto flex min-h-[56vh] max-w-5xl flex-col items-center justify-center px-6 pt-6 pb-16 text-center sm:min-h-[60vh] sm:pt-8 sm:pb-20 lg:px-8 lg:min-h-[64vh] lg:pt-10 lg:pb-24">
        {/* Trust badge pills */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {BADGES.map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-sm"
            >
              <Icon className="h-3.5 w-3.5 text-[#f7941e]" aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>

        <p className="mt-8 text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
          — Custom Software &amp; AI Solutions —
        </p>

        <h1
          key={`heading-${activeIndex}`}
          className="hero-pop mt-4 max-w-3xl text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl"
        >
          {active.heading}
        </h1>

        <p
          key={`description-${activeIndex}`}
          className="hero-pop hero-pop-delay-1 mt-6 max-w-2xl text-lg leading-8 text-white/80 sm:text-xl"
        >
          {active.description}
        </p>

        <div className="hero-pop hero-pop-delay-2 mt-10 flex flex-col gap-4 sm:flex-row">
          <Link
            href="/contact"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#f7941e] px-8 py-4 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(0,0,0,0.3),0_8px_10px_-6px_rgba(0,0,0,0.3)] transition-transform duration-150 hover:-translate-y-0.5 hover:bg-[#db7d17]"
          >
            Start Your Project
          </Link>
          <Link
            href="/portfolio"
            className="group inline-flex items-center justify-center gap-2 rounded-lg bg-white px-8 py-4 text-sm font-semibold text-[#1f4693] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.3),0_8px_10px_-6px_rgba(0,0,0,0.3)] transition-transform duration-150 hover:-translate-y-0.5"
          >
            View Our Work
            <svg
              className="h-4 w-4 transition-transform duration-300 ease-out group-hover:translate-x-1.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
              />
            </svg>
          </Link>
        </div>

        {/* Slide indicators */}
        <div className="mt-12 flex items-center justify-center gap-2">
          {HERO_IMAGES.map((image, index) => (
            <button
              key={image.src}
              type="button"
              aria-label={`Show ${image.heading} slide`}
              onClick={() => setActiveIndex(index)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                index === activeIndex
                  ? "w-8 bg-[#f7941e]"
                  : "w-1.5 bg-white/30 hover:bg-white/50"
              }`}
            />
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes heroPop {
          0% {
            opacity: 0;
            transform: scale(0.85) translateY(12px);
          }
          60% {
            opacity: 1;
            transform: scale(1.03) translateY(0);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .hero-pop {
          animation: heroPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        .hero-pop-delay-1 {
          animation-delay: 0.08s;
        }
        .hero-pop-delay-2 {
          animation-delay: 0.16s;
        }
      `}</style>
    </section>
  );
}

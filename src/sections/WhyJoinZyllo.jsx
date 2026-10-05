"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Compass, Heart, Lightbulb, Rocket, ShieldCheck, Sparkles, Users } from "lucide-react";

const REASONS = [
  {
    icon: Rocket,
    title: "Career Growth",
    description: "Develop your skills through challenging projects and continuous learning.",
    accent: "#f7941e",
    accentSoft: "#fbbf62",
  },
  {
    icon: Users,
    title: "Collaborative Environment",
    description: "Work alongside talented professionals in a supportive and inclusive culture.",
    accent: "#1f4693",
    accentSoft: "#4d6fb8",
  },
  {
    icon: Sparkles,
    title: "Modern Technologies",
    description: "Build innovative solutions using the latest tools and technologies.",
    accent: "#f0650f",
    accentSoft: "#fb923c",
  },
  {
    icon: Compass,
    title: "Learning & Development",
    description:
      "Enhance your expertise through mentorship, knowledge sharing, and hands-on experience.",
    accent: "#3089a6",
    accentSoft: "#6cb4c9",
  },
  {
    icon: ShieldCheck,
    title: "Innovation Driven",
    description: "Bring your ideas to life and contribute to meaningful digital solutions.",
    accent: "#8a5a7a",
    accentSoft: "#c295b3",
  },
  {
    icon: Heart,
    title: "Work-Life Balance",
    description:
      "A healthy work environment that values productivity, flexibility, and well-being.",
    accent: "#1f4693",
    accentSoft: "#4d6fb8",
  },
];

const VALUES = [
  { icon: Lightbulb, title: "Curiosity", text: "We ask why, try new approaches and keep learning." },
  { icon: ShieldCheck, title: "Ownership", text: "We take responsibility for outcomes, not just tasks." },
  { icon: Users, title: "Collaboration", text: "We win together and share what we know." },
  { icon: Sparkles, title: "Craft", text: "We care about the quality of what we build." },
];

export default function WhyJoinZyllo() {
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-12 lg:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center rounded-full bg-[#f7941e]/12 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-[#a64b06]">
            Why Join Us
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            A Workplace Where You Can Thrive
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            We believe great people build great products. That&apos;s why we invest in our team, encourage new
            ideas, and create opportunities for professional growth.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map(({ icon: Icon, title, description, accent, accentSoft }, i) => (
            <motion.div
              key={title}
              initial={reduce ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="group relative overflow-hidden rounded-3xl border border-white bg-gradient-to-br from-white via-white to-[#f4f6fb] p-7 shadow-[0_1px_2px_rgba(16,26,58,0.05),0_12px_32px_-16px_rgba(16,26,58,0.18)] ring-1 ring-[#e7e9ee] transition-all duration-300 hover:-translate-y-2 hover:ring-transparent motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              style={{ "--glow": accent }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{ boxShadow: `0 28px 50px -18px ${accent}66, inset 0 0 0 1.5px ${accent}55` }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-10 blur-2xl transition-opacity duration-300 group-hover:opacity-30"
                style={{ background: accent }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-5 top-3 select-none text-6xl font-black leading-none text-[#1f4693]/[0.06]"
              >
                {String(i + 1).padStart(2, "0")}
              </span>

              <div
                className="relative flex h-16 w-16 items-center justify-center rounded-2xl text-white ring-4 ring-white transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3"
                style={{
                  background: `linear-gradient(135deg, ${accent}, ${accentSoft})`,
                  boxShadow: `0 14px 28px -10px ${accent}a0`,
                }}
              >
                <Icon className="h-8 w-8" aria-hidden="true" />
              </div>

              <span aria-hidden="true" className="relative mt-6 block h-1 w-8 rounded-full transition-all duration-300 group-hover:w-14" style={{ background: accent }} />
              <h3 className="relative mt-3 text-lg font-bold tracking-tight text-[#1b2030]">{title}</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-[#676b7a]">{description}</p>
            </motion.div>
          ))}
        </div>

        {/* Culture / values band */}
        <div className="relative mt-14 overflow-hidden rounded-[2rem] bg-[#101a3a] px-6 py-12 text-white shadow-[0_30px_60px_-24px_rgba(16,26,58,0.6)] sm:px-10 lg:px-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(60% 80% at 100% 0%, rgba(249,103,6,0.40) 0%, transparent 60%), radial-gradient(55% 70% at 0% 100%, rgba(48,137,166,0.45) 0%, transparent 60%), radial-gradient(50% 60% at 50% 50%, rgba(31,70,147,0.55) 0%, transparent 70%)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
              maskImage: "linear-gradient(to bottom, black, transparent 85%)",
              WebkitMaskImage: "linear-gradient(to bottom, black, transparent 85%)",
            }}
          />
          <div className="relative grid gap-10 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-4">
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-[#ffb15c] backdrop-blur-sm">
                Our culture
              </span>
              <h3 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">What we value</h3>
              <span aria-hidden="true" className="mt-4 block h-1 w-14 rounded-full bg-gradient-to-r from-[#f96706] to-[#ffb15c]" />
              <p className="mt-4 text-sm leading-relaxed text-white/80">
                The principles that shape how we work with each other and with our clients.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-8">
              {VALUES.map(({ icon: Icon, title, text }) => (
                <li
                  key={title}
                  className="group/v relative flex items-start gap-4 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#ffb15c]/50 hover:bg-white/[0.12] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f96706] to-[#ffb15c] text-white shadow-lg shadow-[#f96706]/30 transition-transform duration-300 group-hover/v:scale-110">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-base font-bold">{title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-white/75">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

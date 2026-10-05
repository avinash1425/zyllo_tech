"use client";

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

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map(({ icon: Icon, title, description, accent, accentSoft }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-7 transition-all duration-300 hover:-translate-y-2 hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              style={{ "--accent": accent }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-25"
                style={{ background: accent }}
              />
              <div
                className="relative flex h-12 w-12 items-center justify-center rounded-xl text-white transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3"
                style={{
                  background: `linear-gradient(135deg, ${accent}, ${accentSoft})`,
                  boxShadow: `0 10px 20px -8px ${accent}90`,
                }}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
              </div>

              <h3 className="relative mt-5 text-lg font-semibold text-[#2b303b]">{title}</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-[#676b7a]">{description}</p>

              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
                style={{ background: `linear-gradient(90deg, ${accent}, ${accentSoft})` }}
              />
            </div>
          ))}
        </div>

        {/* Culture / values band */}
        <div className="relative mt-12 overflow-hidden rounded-3xl bg-gradient-to-br from-[#101a3a] via-[#173a52] to-[#1f4693] px-6 py-10 text-white sm:px-10 lg:px-14">
          <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#f96706]/25 blur-[90px]" />
          <div className="relative grid gap-8 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-4">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#ffb15c]">Our culture</span>
              <h3 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">What we value</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/80">
                The principles that shape how we work with each other and with our clients.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-8">
              {VALUES.map(({ icon: Icon, title, text }) => (
                <li
                  key={title}
                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#f96706] to-[#ffb15c] text-white">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-semibold">{title}</p>
                    <p className="mt-0.5 text-sm text-white/75">{text}</p>
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

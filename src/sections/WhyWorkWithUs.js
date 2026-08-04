"use client";

import { Clock3, MessageSquare, ShieldCheck, Users } from "lucide-react";

const REASONS = [
  {
    icon: Clock3,
    title: "Fast Response",
    description: "We reply to every inquiry within one business day — no long waits to get started.",
  },
  {
    icon: Users,
    title: "Direct Access to Engineers",
    description: "You talk to the people actually building your product, not just account managers.",
  },
  {
    icon: MessageSquare,
    title: "Clear Communication",
    description: "No jargon-heavy proposals — just a straightforward conversation about your goals.",
  },
  {
    icon: ShieldCheck,
    title: "No-Pressure Consultation",
    description: "Your first conversation with us is about understanding your needs, not a sales pitch.",
  },
];

export default function WhyWorkWithUs() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/3 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Why Work With Us
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            What happens after you hit send
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Reaching out shouldn&apos;t feel like a black box. Here&apos;s what
            to expect.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {REASONS.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#f7941e]/[0.03] p-6 shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-xl hover:shadow-[#f7941e]/10"
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-50 bg-gradient-to-r from-[#f7941e] to-[#1f4693] opacity-40 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
              />
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/70 bg-gradient-to-br from-[#f7941e]/20 to-[#1f4693]/20 shadow-md shadow-[#f7941e]/10 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                <Icon className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-[#2b303b]">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#676b7a]">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

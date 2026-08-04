"use client";

import { ArrowRight, MapPin } from "lucide-react";
import Link from "next/link";

const POSITIONS = [
  {
    title: "Senior Full-Stack Engineer",
    department: "Engineering",
    location: "Remote / India",
    type: "Full-time",
  },
  {
    title: "Product Designer (UI/UX)",
    department: "Design",
    location: "Remote / India",
    type: "Full-time",
  },
  {
    title: "Mobile Engineer (React Native)",
    department: "Engineering",
    location: "Remote / India",
    type: "Full-time",
  },
  {
    title: "QA & Automation Engineer",
    department: "Engineering",
    location: "Remote / India",
    type: "Full-time",
  },
  {
    title: "DevOps Engineer",
    department: "Engineering",
    location: "Remote / India",
    type: "Full-time",
  },
];

export default function OpenPositions() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/3 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Open Positions
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Roles we're currently hiring for
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Don&apos;t see the right fit? We&apos;re always open to hearing
            from strong candidates.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {POSITIONS.map((position) => (
            <Link
              key={position.title}
              href="/contact"
              className="group relative flex flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#f7941e]/[0.03] p-6 pl-7 shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-transparent hover:shadow-xl hover:shadow-[#f7941e]/10 sm:flex-row sm:items-center"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 scale-y-50 bg-gradient-to-b from-[#f7941e] to-[#1f4693] opacity-40 transition-all duration-300 group-hover:scale-y-100 group-hover:opacity-100"
              />
              <div>
                <h3 className="text-lg font-semibold text-[#2b303b]">
                  {position.title}
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#676b7a]">
                  <span className="font-medium text-[#f7941e]">
                    {position.department}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    {position.location}
                  </span>
                  <span>{position.type}</span>
                </div>
              </div>

              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f7941e]/10 px-4 py-2 text-sm font-semibold text-[#f7941e] transition-colors duration-300 group-hover:bg-[#f7941e] group-hover:text-white">
                Apply Now
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

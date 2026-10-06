"use client";

import { Compass, GraduationCap, Heart, Rocket, ShieldCheck, Sparkles, Users } from "lucide-react";

const REASONS = [
  { icon: Rocket, title: "Career Growth", description: "Develop your skills through challenging projects and continuous learning." },
  { icon: Users, title: "Collaborative Environment", description: "Work alongside talented professionals in a supportive and inclusive culture." },
  { icon: Sparkles, title: "Modern Technologies", description: "Build innovative solutions using the latest tools and technologies." },
  { icon: Compass, title: "Learning & Development", description: "Enhance your expertise through mentorship, knowledge sharing, and hands-on experience." },
  { icon: ShieldCheck, title: "Innovation Driven", description: "Bring your ideas to life and contribute to meaningful digital solutions." },
  { icon: Heart, title: "Work-Life Balance", description: "A healthy work environment that values productivity, flexibility, and well-being." },
];

export default function WhyJoinZyllo() {
  return (
    <section className="bg-white py-16 lg:py-24">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-8">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#3089a6]">Why Zyllo Tech</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-[#173a52] [text-wrap:balance] sm:text-4xl">
            A place to do meaningful work and grow with it
          </h2>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-[#4a5668] sm:text-lg">
            We believe great people build great products, so we invest in our team and in their growth.
          </p>

          <ul className="mt-10 grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2">
            {REASONS.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#eef3fb] text-[#1f4693] ring-1 ring-[#dbe5f5]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[17px] font-semibold leading-snug text-[#173a52]">{title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-[#4a5668]">{description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-xl pb-6 lg:max-w-none">
          <div className="relative overflow-hidden rounded-3xl shadow-[0_2px_4px_rgba(16,26,58,0.06),0_30px_60px_-24px_rgba(23,58,82,0.45)]">
            <img
              src="/about.png"
              alt="Two colleagues reviewing a workflow together on a tablet in a bright office"
              width="1408"
              height="768"
              loading="lazy"
              decoding="async"
              className="aspect-[4/5] h-full w-full object-cover object-[35%_50%] sm:aspect-[4/3] lg:aspect-[4/5]"
            />
            <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(to_top,rgba(16,34,60,0.55),rgba(23,58,82,0.08)_55%,transparent)]" />
          </div>
          <div className="absolute bottom-0 left-4 right-4 flex items-center gap-4 rounded-2xl border border-white/60 bg-white/85 p-4 shadow-[0_20px_40px_-18px_rgba(16,26,58,0.45)] backdrop-blur-md sm:left-auto sm:right-6 sm:max-w-[20rem]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#173a52] text-white">
              <GraduationCap className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-[#173a52]">Learning-first culture</p>
              <p className="text-sm leading-snug text-[#4a5668]">Mentorship and knowledge sharing, every day.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

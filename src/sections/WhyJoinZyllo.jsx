"use client";

import { Compass, Heart, Rocket, ShieldCheck, Sparkles, Users } from "lucide-react";

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
    <section className="border-t border-[#e7e9ee] bg-white py-14 lg:py-20">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#173a52] sm:text-4xl">Why Join Zyllo Tech?</h2>
          <p className="mt-3 text-base leading-relaxed text-[#4a5668] sm:text-lg">
            We believe great people build great products, so we invest in our team and in their growth.
          </p>
        </div>

        <ul className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:mt-12 lg:grid-cols-3 lg:gap-6">
          {REASONS.map(({ icon: Icon, title, description }) => (
            <li key={title} className="rounded-2xl bg-gradient-to-br from-[#1f4693] to-[#f96706] p-[1.5px]">
              <div className="h-full rounded-[14.5px] bg-white p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f7941e]/15 text-[#c2500a]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-bold text-[#1b2030]">{title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-[#4a5668]">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

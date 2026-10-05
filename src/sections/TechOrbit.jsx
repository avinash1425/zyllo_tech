"use client";

import { Code2, Layers, Smartphone, Cloud, Database, Sparkles } from "lucide-react";

const ORBIT_ITEMS = [
  { label: "React", angle: 0 },
  { label: "Next.js", angle: 40 },
  { label: "Node.js", angle: 80 },
  { label: "Python", angle: 120 },
  { label: "AWS", angle: 160 },
  { label: "Docker", angle: 200 },
  { label: "MongoDB", angle: 240 },
  { label: "TypeScript", angle: 280 },
  { label: "OpenAI", angle: 320 },
];

const CATEGORY_ICONS = [Code2, Layers, Smartphone, Cloud, Database, Sparkles];

export default function TechOrbit() {
  return (
    <section className="relative overflow-hidden border-t border-[#d9dde2] bg-[#171f2b] py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-[#f96706] opacity-[0.1] blur-[110px]" />
        <div className="absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-[#1c2f4a] opacity-25 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f96706] uppercase">
            Our Toolkit
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Modern technology, chosen deliberately
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-white/70">
            The languages, frameworks, and platforms we reach for most when
            building reliable software.
          </p>
        </div>

        <div className="relative mx-auto mt-14 flex aspect-square w-[min(90vw,480px)] items-center justify-center">
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full border border-white/10"
          />
          <div
            aria-hidden="true"
            className="absolute inset-8 rounded-full border border-white/[0.06]"
          />

          <div className="orbit-spin absolute inset-0">
            {ORBIT_ITEMS.map((item, index) => {
              const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length];
              const accent = index % 2 === 0 ? "#f96706" : "#5b7fd4";
              const radius = 38;
              const x = 50 + radius * Math.cos((item.angle * Math.PI) / 180);
              const y = 50 + radius * Math.sin((item.angle * Math.PI) / 180);
              return (
                <div
                  key={item.label}
                  className="orbit-counter-spin absolute flex flex-col items-center gap-1.5"
                  style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
                >
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-[#141826] shadow-lg shadow-black/30"
                  >
                    <Icon className="h-5 w-5" style={{ color: accent }} aria-hidden="true" />
                  </span>
                  <span className="whitespace-nowrap rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-white/70">
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="relative flex h-32 w-32 flex-col items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-[#f96706]/20 to-[#1c2f4a]/20 text-center shadow-xl shadow-black/20 backdrop-blur-md sm:h-36 sm:w-36">
            <span className="text-sm font-bold text-white">Zyllo</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
              Tech Stack
            </span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .orbit-spin {
          animation: orbitSpin 40s linear infinite;
        }
        .orbit-counter-spin {
          animation: orbitCounterSpin 40s linear infinite;
        }
        @keyframes orbitSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes orbitCounterSpin {
          from {
            transform: translate(-50%, -50%) rotate(0deg);
          }
          to {
            transform: translate(-50%, -50%) rotate(-360deg);
          }
        }
      `}</style>
    </section>
  );
}

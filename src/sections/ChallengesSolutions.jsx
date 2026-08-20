import { CompatImage as Image } from "@/components/NextCompat";
import { useState } from "react";

const ROWS = [
  {
    tag: "Startups & SaaS",
    title: "Ship an MVP before your runway runs out",
    description:
      "Early-stage teams need to validate fast without burning months on infrastructure. We scope lean, build in focused sprints, and get a working product in front of real users quickly.",
    image: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=900&q=80",
  },
  {
    tag: "Healthcare",
    title: "Handle sensitive data without slowing down care",
    description:
      "Patient records and telehealth platforms demand strict compliance alongside a smooth experience for clinicians and patients. We build with security and usability as equal priorities from day one.",
    image: "https://images.unsplash.com/photo-1550831107-1553da8c8464?w=900&q=80",
  },
  {
    tag: "Finance & Fintech",
    title: "Move money and data with zero room for error",
    description:
      "Financial systems can't afford downtime or inconsistency. We design for auditability, resilience, and clear monitoring so every transaction is traceable and every failure is caught early.",
    image: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=900&q=80",
  },
  {
    tag: "E-commerce & Retail",
    title: "Keep storefronts, stock, and payments in sync",
    description:
      "When systems don't talk to each other, stock counts drift and checkouts lose sales. We connect storefronts, inventory, and payment integrations into one accurate, real-time picture.",
    image: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=900&q=80",
  },
  {
    tag: "Manufacturing",
    title: "Connect the factory floor to the front office",
    description:
      "Production data often stays trapped on the shop floor, disconnected from planning and sales. We build operational software that gives everyone the same real-time view.",
    image: "https://images.unsplash.com/photo-1565043666747-69f6646db940?w=900&q=80",
  },
  {
    tag: "Education & EdTech",
    title: "Build learning tools people actually want to use",
    description:
      "Clunky portals frustrate students and teachers alike. We design learning platforms around real classroom workflows, not just feature checklists.",
    image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=900&q=80",
  },
  {
    tag: "Banking & Financial Services",
    title: "Modernize core systems without breaking trust",
    description:
      "Banking platforms carry decades of legacy constraints and zero tolerance for downtime. We modernize incrementally, with compliance and reliability built in from the start.",
    image: "https://images.unsplash.com/photo-1601597111158-2fceff292cdc?w=900&q=80",
  },
  {
    tag: "Agriculture & Environment",
    title: "Turn field data into decisions you can act on",
    description:
      "Environmental and farm data is often scattered across sensors, spreadsheets, and paper logs. We build platforms that centralize it into something actually usable.",
    image: "https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=900&q=80",
  },
  {
    tag: "Gaming & Entertainment",
    title: "Handle scale without breaking the experience",
    description:
      "Games and streaming platforms live or die on latency and uptime during peak traffic. We build backends and infrastructure engineered to hold up under real load.",
    image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=900&q=80",
  },
  {
    tag: "Telecom & IT Services",
    title: "Manage complex networks with confidence",
    description:
      "Telecom providers need visibility across sprawling infrastructure and fast response when something breaks. We build monitoring and management tools built for that scale.",
    image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=900&q=80",
  },
  {
    tag: "Media & Publishing",
    title: "Publish faster without losing editorial control",
    description:
      "Publishing teams need speed without sacrificing structure or governance. We build content platforms that keep editorial workflows organized as they scale.",
    image: "https://images.unsplash.com/photo-1495020689067-958852a7765e?w=900&q=80",
  },
  {
    tag: "Travel & Hospitality",
    title: "Make booking and guest experience effortless",
    description:
      "Guests expect booking and service to feel seamless end to end. We build reservation engines and guest experience tools that remove friction at every step.",
    image: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=900&q=80",
  },
  {
    tag: "Real Estate & Construction",
    title: "Bring listings and projects into one system",
    description:
      "Property and project data often lives across disconnected tools and spreadsheets. We build listing platforms and project management tools that keep builders and buyers aligned.",
    image: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=900&q=80",
  },
  {
    tag: "Logistics & Transportation",
    title: "Track fleets and shipments in real time",
    description:
      "Delays are often invisible until it's too late to fix them. We build fleet tracking and route optimization tools that give full visibility across the supply chain.",
    image: "https://images.unsplash.com/photo-1494412651409-8963ce7935a7?w=900&q=80",
  },
];

export default function ChallengesSolutions() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = ROWS[activeIndex];

  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-5 lg:py-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Industry Challenges & Solutions
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Real problems, solved with the right context
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Pick an industry to see the challenge we hear most often, and how
            we approach it.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          {ROWS.map((row, index) => (
            <button
              key={row.tag}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                index === activeIndex
                  ? "border-transparent bg-gradient-to-r from-[#f7941e] to-[#db7d17] text-white shadow-md shadow-[#f7941e]/25"
                  : "border-[#e7e9ee] bg-white text-[#676b7a] hover:-translate-y-0.5 hover:border-[#f7941e]/40 hover:text-[#f7941e] hover:shadow-sm"
              }`}
            >
              {row.tag}
            </button>
          ))}
        </div>

        <div
          key={activeIndex}
          className="challenge-panel mt-6 flex flex-col items-center gap-6 overflow-hidden rounded-3xl border border-[#e7e9ee] bg-white p-5 shadow-lg shadow-[#1f4693]/5 sm:p-6 lg:flex-row lg:gap-10 lg:p-8"
        >
          <div className="relative h-48 w-full shrink-0 overflow-hidden rounded-2xl shadow-md lg:h-64 lg:w-[340px]">
            <Image
              src={active.image}
              alt={active.tag}
              fill
              sizes="(min-width: 1024px) 380px, 100vw"
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          </div>

          <div className="text-center lg:flex-1 lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#f7941e]/10 to-[#1f4693]/10 px-4 py-1.5 text-xs font-bold tracking-[0.15em] text-[#f7941e] uppercase">
              {active.tag}
            </span>
            <h3 className="mt-4 text-2xl font-bold tracking-tight text-[#2b303b] sm:text-3xl">
              {active.title}
            </h3>
            <p className="mt-4 text-base leading-relaxed text-[#676b7a]">
              {active.description}
            </p>

            <div className="mt-6 flex items-center justify-center gap-1.5 lg:justify-start">
              {ROWS.map((row, index) => (
                <span
                  key={row.tag}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    index === activeIndex ? "w-6 bg-[#f7941e]" : "w-1.5 bg-[#e7e9ee]"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes panelFadeIn {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .challenge-panel {
          animation: panelFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
      `}</style>
    </section>
  );
}

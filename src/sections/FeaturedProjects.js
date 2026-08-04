"use client";

import Image from "next/image";

const PROJECTS = [
  {
    tag: "Web Platform",
    title: "Retail Inventory & Order Management System",
    description:
      "A unified dashboard connecting storefronts, warehouses, and delivery tracking into one real-time system.",
    image: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=900&q=80",
  },
  {
    tag: "Mobile App",
    title: "Telehealth Patient Companion App",
    description:
      "A cross-platform app for appointment booking, secure messaging, and remote patient monitoring.",
    image: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=900&q=80",
  },
  {
    tag: "AI Solution",
    title: "Financial Document Automation Tool",
    description:
      "An AI-powered pipeline that extracts, validates, and reconciles financial documents at scale.",
    image: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=900&q=80",
  },
  {
    tag: "Cloud Infrastructure",
    title: "SaaS Platform Migration & Scaling",
    description:
      "Migrated a monolithic application to a cloud-native architecture built to handle 10x traffic growth.",
    image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=900&q=80",
  },
];

export default function FeaturedProjects() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Featured Projects
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            A sample of the work we do
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Illustrative examples of the kind of products and platforms our
            team builds.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {PROJECTS.map((project) => (
            <div
              key={project.title}
              className="group overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="relative h-52 w-full overflow-hidden">
                <Image
                  src={project.image}
                  alt={project.title}
                  fill
                  sizes="(min-width: 640px) 50vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-6">
                <span className="text-xs font-bold tracking-[0.2em] text-[#f7941e] uppercase">
                  {project.tag}
                </span>
                <h3 className="mt-2 text-lg font-semibold text-[#2b303b]">
                  {project.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#676b7a]">
                  {project.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

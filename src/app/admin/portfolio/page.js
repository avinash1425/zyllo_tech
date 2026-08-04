"use client";

import Image from "next/image";
import { useState } from "react";
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";

const PROJECTS = [
  {
    id: 1,
    title: "Bringing inventory and orders into one system",
    tag: "E-commerce & Retail",
    status: "Published",
    image: "https://images.unsplash.com/photo-1553413077-190dd305871c?w=500&q=80",
  },
  {
    id: 2,
    title: "Launching a compliant telehealth platform",
    tag: "Healthcare",
    status: "Published",
    image: "https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=500&q=80",
  },
  {
    id: 3,
    title: "Modernizing a legacy transaction system",
    tag: "Finance & Fintech",
    status: "Published",
    image: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=500&q=80",
  },
  {
    id: 4,
    title: "Connecting the shop floor to the front office",
    tag: "Manufacturing",
    status: "Published",
    image: "https://images.unsplash.com/photo-1565043666747-69f6646db940?w=500&q=80",
  },
  {
    id: 5,
    title: "Real-time fleet visibility for a logistics operator",
    tag: "Logistics & Transportation",
    status: "Draft",
    image: "https://images.unsplash.com/photo-1494412651409-8963ce7935a7?w=500&q=80",
  },
  {
    id: 6,
    title: "Unified booking engine for a hospitality group",
    tag: "Travel & Hospitality",
    status: "Draft",
    image: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=500&q=80",
  },
];

const STATUS_STYLES = {
  Published: "bg-[#3b6d11]/10 text-[#3b6d11]",
  Draft: "bg-[#676b7a]/10 text-[#676b7a]",
};

export default function AdminPortfolioPage() {
  const [projects] = useState(PROJECTS);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Portfolio</h1>
          <p className="mt-1 text-sm text-[#676b7a]">
            {projects.filter((p) => p.status === "Published").length} published case studies,{" "}
            {projects.filter((p) => p.status === "Draft").length} in draft.
          </p>
        </div>

        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Case Study
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <div
            key={project.id}
            className="group relative overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-transparent hover:shadow-lg hover:shadow-[#f7941e]/10"
          >
            <div className="relative h-40 w-full overflow-hidden">
              <Image
                src={project.image}
                alt={project.title}
                fill
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <span
                className={`absolute left-3 top-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ${STATUS_STYLES[project.status]}`}
              >
                {project.status}
              </span>
            </div>

            <div className="p-4">
              <span className="text-xs font-bold uppercase tracking-wide text-[#f7941e]">
                {project.tag}
              </span>
              <h3 className="mt-1.5 text-sm font-semibold leading-snug text-[#2b303b]">
                {project.title}
              </h3>

              <div className="mt-4 flex items-center gap-1.5 border-t border-[#e7e9ee] pt-3">
                <button
                  type="button"
                  aria-label={`View ${project.title}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#1f4693]/10 hover:text-[#1f4693]"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${project.title}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#f7941e]/10 hover:text-[#f7941e]"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${project.title}`}
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

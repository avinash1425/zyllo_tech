import Image from "next/image";
import Link from "next/link";
import { ArrowRight, FolderKanban } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function getFeaturedProjects() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("portfolio_projects")
    .select("id, title, tag, description, image_url")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(6);

  if (error) {
    console.error("Failed to load featured projects:", error.message);
    return [];
  }

  return data ?? [];
}

export default async function FeaturedProjects() {
  const projects = await getFeaturedProjects();

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

        {projects.length === 0 ? (
          <div className="mx-auto mt-8 flex max-w-lg flex-col items-center rounded-2xl border border-[#e7e9ee] bg-white p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15">
              <FolderKanban className="h-5.5 w-5.5 text-[#f7941e]" aria-hidden="true" />
            </span>
            <p className="mt-4 text-base text-[#676b7a]">
              We&apos;re putting together project highlights from recent work
              — check back soon, or reach out to see examples directly.
            </p>
            <Link
              href="/contact"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#f7941e] transition-colors duration-200 hover:text-[#db7d17]"
            >
              Get in touch
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {projects.map((project) => (
              <div
                key={project.id}
                className="group overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="relative h-52 w-full overflow-hidden bg-[#f5f6f8]">
                  {project.image_url && (
                    <Image
                      src={project.image_url}
                      alt={project.title}
                      fill
                      sizes="(min-width: 640px) 50vw, 100vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                </div>
                <div className="p-6">
                  <span className="text-xs font-bold tracking-[0.15em] text-[#f7941e] uppercase">
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
        )}
      </div>
    </section>
  );
}

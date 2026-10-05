import Link from "@/lib/nx/link";
import { ArrowLeft } from "lucide-react";
import Seo from "@/components/Seo";

// Shared "not found" render used by the 404 route and by dynamic pages
// (blog post, career, service) when a slug/id doesn't resolve.
export default function NotFoundView() {
  return (
    <section className="relative flex min-h-[70vh] items-center justify-center overflow-hidden bg-white px-6 py-24">
      <Seo title="Page not found" noindex />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/10 blur-[110px]" />
      </div>
      <div className="relative mx-auto max-w-xl text-center">
        <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
          Error 404
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-[#2b303b] sm:text-5xl">
          This page could not be found
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
          The page you&apos;re looking for may have moved, been removed, or never existed.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#f7941e] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(247,148,30,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Home
        </Link>
      </div>
    </section>
  );
}

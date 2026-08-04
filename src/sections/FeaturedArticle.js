import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Calendar, Clock } from "lucide-react";

export default function FeaturedArticle() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
          Featured Article
        </span>

        <Link
          href="/blog"
          className="group mt-5 grid grid-cols-1 gap-0 overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl lg:grid-cols-2"
        >
          <div className="relative h-64 w-full overflow-hidden lg:h-full">
            <Image
              src="https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1000&q=80"
              alt="How AI is changing the way we build software"
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          </div>

          <div className="flex flex-col justify-center p-8 lg:p-10">
            <span className="inline-flex w-fit rounded-full bg-[#f7941e]/10 px-3 py-1 text-xs font-semibold text-[#f7941e]">
              AI & Automation
            </span>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-[#2b303b] sm:text-3xl">
              How AI is changing the way we build software
            </h2>
            <p className="mt-3 text-base leading-relaxed text-[#676b7a]">
              A look at how practical AI tooling is reshaping everyday
              engineering work — from code generation to testing and beyond.
            </p>

            <div className="mt-5 flex items-center gap-4 text-sm text-[#676b7a]">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                Jul 28, 2026
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" aria-hidden="true" />
                6 min read
              </span>
            </div>

            <span className="mt-6 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-[#f7941e] transition-colors group-hover:text-[#db7d17]">
              Read the article
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
            </span>
          </div>
        </Link>
      </div>
    </section>
  );
}

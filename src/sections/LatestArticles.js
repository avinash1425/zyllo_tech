import Image from "next/image";
import Link from "next/link";
import { Calendar, Clock } from "lucide-react";

const ARTICLES = [
  {
    tag: "Engineering",
    title: "Building APIs that scale without a rewrite",
    excerpt: "Practical patterns for designing APIs your team won't dread revisiting in a year.",
    date: "Jul 20, 2026",
    readTime: "5 min read",
    image: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=700&q=80",
  },
  {
    tag: "Design",
    title: "Why usability testing beats design trends",
    excerpt: "Chasing the latest UI pattern rarely beats sitting down and watching real users struggle.",
    date: "Jul 14, 2026",
    readTime: "4 min read",
    image: "https://images.unsplash.com/photo-1559028006-448665bd7c7f?w=700&q=80",
  },
  {
    tag: "Cloud & DevOps",
    title: "A practical guide to cutting cloud costs",
    excerpt: "Small architecture decisions that quietly save thousands on your monthly cloud bill.",
    date: "Jul 8, 2026",
    readTime: "7 min read",
    image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=700&q=80",
  },
  {
    tag: "Security",
    title: "The security review checklist we use internally",
    excerpt: "A rundown of the checks we run before any client project ships to production.",
    date: "Jun 30, 2026",
    readTime: "6 min read",
    image: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=700&q=80",
  },
  {
    tag: "Product Strategy",
    title: "Scoping an MVP without cutting the wrong corners",
    excerpt: "How to decide what actually belongs in version one of your product.",
    date: "Jun 22, 2026",
    readTime: "5 min read",
    image: "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=700&q=80",
  },
  {
    tag: "AI & Automation",
    title: "Where AI copilots actually save engineering time",
    excerpt: "A realistic look at where AI tooling helps versus where it just adds noise.",
    date: "Jun 15, 2026",
    readTime: "6 min read",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=700&q=80",
  },
];

export default function LatestArticles() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/3 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Latest Articles
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Fresh off the team's desk
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Practical notes on engineering, design, and building software
            that lasts.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ARTICLES.map((article) => (
            <Link
              key={article.title}
              href="/blog"
              className="group overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="relative h-44 w-full overflow-hidden">
                <Image
                  src={article.image}
                  alt={article.title}
                  fill
                  sizes="(min-width: 640px) 33vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-5">
                <span className="inline-flex rounded-full bg-[#f7941e]/10 px-2.5 py-1 text-xs font-semibold text-[#f7941e]">
                  {article.tag}
                </span>
                <h3 className="mt-3 text-base font-semibold text-[#2b303b]">
                  {article.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#676b7a]">
                  {article.excerpt}
                </p>
                <div className="mt-4 flex items-center gap-3 border-t border-[#e7e9ee] pt-3 text-xs text-[#676b7a]">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                    {article.date}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {article.readTime}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

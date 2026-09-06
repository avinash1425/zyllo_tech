import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Calendar, Clock, X } from "lucide-react";
import { CompatLink as Link } from "@/components/NextCompat";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import FeaturedArticle from "@/sections/FeaturedArticle";
import LatestArticles from "@/sections/LatestArticles";
import Newsletter from "@/sections/Newsletter";
import Reveal from "@/components/Reveal";
import { articles } from "@/data/articles";

// The sitewide WebSite JSON-LD declares a SearchAction with urlTemplate
// /blog?q={search_term_string}, and the header search's "see all blog
// results" link points here too — so ?q= must actually filter the archive.
// Matching is a simple tokenized AND over title/excerpt/category/tags/meta.
function filterArticles(query) {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];

  return articles.filter((article) => {
    const haystack = [
      article.title,
      article.excerpt,
      article.category,
      article.metaDescription,
      ...(article.tags || []),
    ]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

function SearchResults({ query, onClear }) {
  const matches = useMemo(() => filterArticles(query), [query]);

  return (
    <section className="relative border-t border-[#e7e9ee] bg-white py-10 lg:py-14">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-[#2b303b] sm:text-3xl">
              Results for &ldquo;{query}&rdquo;
            </h2>
            <p className="mt-1.5 text-sm text-[#676b7a]">
              {matches.length === 0
                ? "No matching articles."
                : `${matches.length} matching article${matches.length === 1 ? "" : "s"}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#e7e9ee] bg-[#fafbfc] px-4 py-2 text-sm font-semibold text-[#1f4693] transition-colors hover:border-[#f7941e]/40 hover:bg-[#fff7ed] hover:text-[#f7941e]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear search
          </button>
        </div>

        {matches.length === 0 ? (
          <p className="mt-8 max-w-xl text-base leading-relaxed text-[#676b7a]">
            Try a different term, or browse the full archive below. If you were
            looking for something specific,{" "}
            <Link href="/contact" className="font-semibold text-[#f7941e] hover:underline">
              get in touch
            </Link>{" "}
            and we&apos;ll point you the right way.
          </p>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {matches.map((article) => (
              <Link
                key={article.slug}
                href={`/blog/${article.slug}`}
                className="group flex flex-col rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <span className="inline-flex self-start rounded-full bg-[#1f4693]/10 px-2.5 py-1 text-xs font-semibold text-[#1f4693]">
                  {article.category}
                </span>
                <h3 className="mt-3 text-base font-semibold text-[#2b303b] group-hover:text-[#c2410c]">
                  {article.title}
                </h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[#676b7a]">
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
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function BlogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get("q") || "").trim();

  return (
    <>
      <SEOHead
        title="Blog | Zyllo Tech"
        description="Practical notes on engineering, design, AI, and product strategy from the Zyllo Tech team."
        canonical="/blog"
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "Blog", url: `${SITE_URL}/blog` },
        ])}
      />
      <PageHero
        breadcrumbLabel="Blog"
        eyebrow="Blog"
        title="Ideas, lessons, and notes from the team"
        description="Practical writing on engineering, design, and building software that lasts — not just theory."
        image="/blog.webp"
        imageAlt="Zyllo Tech blog"
      />
      {query ? (
        <>
          <Reveal>
            <SearchResults query={query} onClear={() => setSearchParams({}, { replace: true })} />
          </Reveal>
          <Reveal>
            <Newsletter />
          </Reveal>
        </>
      ) : (
        <>
          <Reveal>
            <FeaturedArticle />
          </Reveal>
          <Reveal>
            <LatestArticles />
          </Reveal>
          <Reveal>
            <Newsletter />
          </Reveal>
        </>
      )}
    </>
  );
}

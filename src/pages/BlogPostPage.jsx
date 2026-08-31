import { useParams } from "react-router-dom";
import { Calendar, Clock, ArrowLeft } from "lucide-react";
import { CompatLink as Link } from "@/components/NextCompat";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import Reveal from "@/components/Reveal";
import ContactCTA from "@/sections/ContactCTA";
import ArticleJsonLd from "@/components/ArticleJsonLd";
import NotFound from "@/pages/NotFound";
import { supabase } from "@/integrations/supabase/client";
import { useAsyncData } from "@/lib/useAsyncData";
import { safeImageUrl } from "@/lib/safe-image-url";
import { findFallbackPost, fallbackPosts } from "@/data/fallback-content";

// Maps a post category to the service page it naturally supports, so every
// article links contextually into the commercial pages (and not only via the
// boilerplate header/footer nav).
const CATEGORY_SERVICE = {
  "AI & ML": { href: "/services/ai-solutions", label: "AI Solutions" },
  Cloud: { href: "/services/cloud-solutions", label: "Cloud Solutions" },
  Development: { href: "/services/web-development", label: "Web Development" },
  Design: { href: "/services/ui-ux-design", label: "UI/UX Design" },
  Business: { href: "/services/product-strategy-consulting", label: "Software Development" },
  "Industry Solutions": { href: "/services/product-strategy-consulting", label: "Software Development" },
};

function estimateReadTime(content) {
  const words = (content || "").trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

// Contextual internal links: up to three same-category articles plus the
// service page the topic supports. Uses the fallback article list — the same
// source the blog index renders from.
function RelatedReading({ post }) {
  const related = fallbackPosts
    .filter((p) => p.category === post.category && p.slug !== post.slug)
    .slice(0, 3);
  const service = CATEGORY_SERVICE[post.category];
  if (related.length === 0 && !service) return null;

  return (
    <section className="bg-[#fafbfc] py-10">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <h2 className="text-xl font-bold tracking-tight text-[#151a22]">Related Reading</h2>
        <ul className="mt-5 flex flex-col gap-3">
          {related.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/blog/${p.slug}`}
                className="text-base font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]"
              >
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
        {service && (
          <p className="mt-6 text-base text-[#54607a]">
            Building something in this space?{" "}
            <Link
              href={service.href}
              className="font-semibold text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]"
            >
              See our {service.label} services
            </Link>
            .
          </p>
        )}
      </div>
    </section>
  );
}

// Renders the structured content blocks that fallback articles carry
// (see src/data/articles.ts) as real semantic HTML — h2/h3 headings,
// ul/ol lists — instead of one undifferentiated text blob. Search engines
// and AI answer engines key on this structure; a `whitespace-pre-line`
// div reads fine to humans but is a single paragraph to a parser.
// Inline [label](href) links inside block text — internal paths go through
// the router Link, external URLs open in a new tab. Deliberately minimal: no
// other markdown syntax is supported. Mirrored by the `inline` helper in
// scripts/prerender.mjs and stripped by blockToText in fallback-content.js.
const INLINE_LINK = /\[([^\]]+)\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)/g;
const INLINE_LINK_CLASS =
  "font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]";

function renderInline(text) {
  if (typeof text !== "string") return text;
  const nodes = [];
  let last = 0;
  let match;
  INLINE_LINK.lastIndex = 0;
  while ((match = INLINE_LINK.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [, label, href] = match;
    nodes.push(
      href.startsWith("/") ? (
        <Link key={match.index} href={href} className={INLINE_LINK_CLASS}>
          {label}
        </Link>
      ) : (
        <a key={match.index} href={href} target="_blank" rel="noopener noreferrer" className={INLINE_LINK_CLASS}>
          {label}
        </a>
      ),
    );
    last = INLINE_LINK.lastIndex;
  }
  if (nodes.length === 0) return text;
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function ArticleBody({ blocks }) {
  return (
    <div className="mt-8 text-base leading-relaxed text-[#2b303b]">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "h2":
            return (
              <h2 key={i} className="mt-9 text-xl font-bold tracking-tight text-[#151a22] first:mt-0">
                {block.text}
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="mt-7 text-lg font-semibold tracking-tight text-[#151a22]">
                {block.text}
              </h3>
            );
          case "ul":
            return (
              <ul key={i} className="mt-4 list-disc space-y-2 pl-6">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="mt-4 list-decimal space-y-2 pl-6">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          case "callout":
            return (
              <aside key={i} className="mt-6 border-l-4 border-[#f96706] bg-[#fdf3ea] p-4 text-[#4a3a2a]">
                {renderInline(block.text)}
              </aside>
            );
          case "metrics":
            // Deliberately rendered as plain label/value lines — visually no
            // louder than the flattened-text rendering it replaces.
            return (
              <ul key={i} className="mt-4 space-y-1 pl-0">
                {block.items.map((item, j) => (
                  <li key={j}>
                    {item.label}: {item.value}
                  </li>
                ))}
              </ul>
            );
          case "p":
          default:
            return (
              <p key={i} className="mt-4 first:mt-0">
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

export default function BlogPostPage() {
  const { slug } = useParams();

  const result = useAsyncData(async () => {
    const { data, error } = await supabase
      .from("blog_posts")
      .select("title, slug, category, author, excerpt, content, featured_image_url, status, created_at, updated_at")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();

    if (error) console.error("Failed to load post:", error.message);

    if (data) {
      supabase.rpc("increment_blog_post_views", { post_slug: slug }).then(({ error: rpcError }) => {
        if (rpcError) console.error("Failed to record blog view:", rpcError.message);
      });
    }

    return { loaded: true, post: data ?? findFallbackPost(slug) };
  }, { loaded: false, post: null });

  if (!result.loaded) return <div className="min-h-[60vh]" />;
  if (!result.post) return <NotFound />;

  const post = result.post;

  return (
    <>
      <SEOHead
        title={`${post.title} | Zyllo Tech`}
        description={post.excerpt || undefined}
        canonical={`/blog/${post.slug}`}
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "Blog", url: `${SITE_URL}/blog` },
          { name: post.title, url: `${SITE_URL}/blog/${post.slug}` },
        ])}
      />
      <ArticleJsonLd post={post} />
      <PageHero
        eyebrow={post.category}
        title={post.title}
        description={post.excerpt || undefined}
        image={safeImageUrl(post.featured_image_url) || undefined}
        imageAlt={post.title}
      />

      <section className="bg-white py-10 lg:py-14">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#f7941e] transition-all duration-200 hover:gap-2.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to Blog
          </Link>

          <div className="mt-5 flex flex-wrap items-center gap-4 border-b border-[#e7e9ee] pb-5 text-sm text-[#676b7a]">
            <span>{post.author}</span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4" aria-hidden="true" />
              {new Date(post.created_at).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4" aria-hidden="true" />
              {estimateReadTime(post.content)}
            </span>
          </div>

          {Array.isArray(post.blocks) && post.blocks.length > 0 ? (
            <ArticleBody blocks={post.blocks} />
          ) : (
            <div className="mt-8 whitespace-pre-line text-base leading-relaxed text-[#2b303b]">
              {post.content || "This post doesn't have any content yet."}
            </div>
          )}
        </div>
      </section>

      <RelatedReading post={post} />

      <Reveal>
        <ContactCTA
          heading="Have an idea after reading this?"
          description="We'd love to hear about it. Tell us what you're thinking of building."
          buttonLabel="Start The Conversation"
        />
      </Reveal>
    </>
  );
}

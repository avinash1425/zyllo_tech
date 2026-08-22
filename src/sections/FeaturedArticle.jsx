import { CompatImage as Image } from "@/components/NextCompat";
import { CompatLink as Link } from "@/components/NextCompat";
import { ArrowRight, Calendar, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAsyncData } from "@/lib/useAsyncData";
import { safeImageUrl } from "@/lib/safe-image-url";
import { fallbackPosts } from "@/data/fallback-content";

function estimateReadTime(content) {
  const words = (content || "").trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

async function getFeaturedPost() {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("title, slug, category, excerpt, content, featured_image_url, created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to load featured post:", error.message);
    return fallbackPosts[0] ?? null;
  }
  return data ?? fallbackPosts[0] ?? null;
}

export default function FeaturedArticle() {
  const post = useAsyncData(getFeaturedPost, fallbackPosts[0] ?? null);
  if (!post) return null;

  const imageUrl = safeImageUrl(post.featured_image_url);

  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <span className="text-sm font-bold tracking-[0.2em] text-[#1f4693] uppercase">
          Featured Article
        </span>

        <Link
          href={`/blog/${post.slug}`}
          className="group mt-5 grid grid-cols-1 gap-0 overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl lg:grid-cols-2"
        >
          <div className="relative h-64 w-full overflow-hidden bg-[#fafbfc] lg:h-full">
            {imageUrl && (
              <Image
                src={imageUrl}
                alt={post.title}
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
            )}
          </div>

          <div className="flex flex-col justify-center p-8 lg:p-10">
            <span className="inline-flex w-fit rounded-full bg-[#1f4693]/10 px-3 py-1 text-xs font-semibold text-[#1f4693]">
              {post.category}
            </span>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-[#2b303b] sm:text-3xl">
              {post.title}
            </h2>
            {post.excerpt && (
              <p className="mt-3 text-base leading-relaxed text-[#676b7a]">{post.excerpt}</p>
            )}

            <div className="mt-5 flex items-center gap-4 text-sm text-[#676b7a]">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                {new Date(post.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" aria-hidden="true" />
                {estimateReadTime(post.content)}
              </span>
            </div>

            <span className="mt-6 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-[#f7941e] transition-colors group-hover:text-[#db7d17]">
              Read the article
              <ArrowRight
                className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                aria-hidden="true"
              />
            </span>
          </div>
        </Link>
      </div>
    </section>
  );
}

import Image from "next/image";
import Link from "next/link";
import { Calendar, Clock } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeImageUrl } from "@/lib/safe-image-url";

function estimateReadTime(content) {
  const words = (content || "").trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

async function getLatestPosts() {
  const supabase = createServerSupabaseClient();
  // Skip the newest post (id offset via range) since it's already shown by
  // FeaturedArticle above — fetch 1 extra then drop the first if present.
  const { data, error } = await supabase
    .from("blog_posts")
    .select("title, slug, category, excerpt, content, featured_image_url, created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .range(1, 6);

  if (error) {
    console.error("Failed to load latest posts:", error.message);
    return [];
  }
  return data ?? [];
}

export default async function LatestArticles() {
  const posts = await getLatestPosts();
  if (posts.length === 0) return null;

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
            Fresh off the team&apos;s desk
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Practical notes on engineering, design, and building software
            that lasts.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => {
            const imageUrl = safeImageUrl(post.featured_image_url);
            return (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="relative h-44 w-full overflow-hidden bg-[#fafbfc]">
                {imageUrl && (
                  <Image
                    src={imageUrl}
                    alt={post.title}
                    fill
                    sizes="(min-width: 640px) 33vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                )}
              </div>
              <div className="p-5">
                <span className="inline-flex rounded-full bg-[#1f4693]/10 px-2.5 py-1 text-xs font-semibold text-[#1f4693]">
                  {post.category}
                </span>
                <h3 className="mt-3 text-base font-semibold text-[#2b303b]">{post.title}</h3>
                {post.excerpt && (
                  <p className="mt-1.5 text-sm leading-relaxed text-[#676b7a]">{post.excerpt}</p>
                )}
                <div className="mt-4 flex items-center gap-3 border-t border-[#e7e9ee] pt-3 text-xs text-[#676b7a]">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                    {new Date(post.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {estimateReadTime(post.content)}
                  </span>
                </div>
              </div>
            </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

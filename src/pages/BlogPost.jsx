import { useEffect } from "react";
import Link from "@/lib/nx/link";
import { useParams } from "@/lib/nx/navigation";
import { Calendar, Clock, ArrowLeft } from "lucide-react";
import PageHero from "@/components/PageHero";
import Reveal from "@/components/Reveal";
import ContactCTA from "@/sections/ContactCTA";
import { supabase } from "@/lib/supabase/client";
import { useAsync } from "@/lib/use-async";
import { safeImageUrl } from "@/lib/safe-image-url";
import { SITE_URL, OG_IMAGE_PATH } from "@/lib/site-config";
import Seo from "@/components/Seo";
import ArticleJsonLd from "@/components/ArticleJsonLd";
import NotFoundView from "@/components/NotFoundView";
import PageLoading from "@/components/PageLoading";

function estimateReadTime(content) {
  const words = (content || "").trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

async function getPost(slug) {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("title, slug, category, author, excerpt, content, featured_image_url, status, created_at")
    .eq("slug", slug)
    .single();

  if (error || !data) return null;
  return data;
}

// Fire-and-forget atomic increment (published posts only, enforced inside
// the SQL function too). Not awaited so a slow view-count write never
// delays the page render.
function recordView(slug) {
  supabase.rpc("increment_blog_post_views", { post_slug: slug }).then(({ error }) => {
    if (error) console.error("Failed to record blog view:", error.message);
  });
}

export default function BlogPostPage() {
  const { slug } = useParams();
  const { data: post, loading } = useAsync(() => getPost(slug), [slug]);
  const published = Boolean(post && post.status === "published");

  useEffect(() => {
    if (published) recordView(slug);
  }, [published, slug]);

  if (loading) return <PageLoading />;
  if (!published) return <NotFoundView />;

  const image = safeImageUrl(post.featured_image_url) || `${SITE_URL}${OG_IMAGE_PATH}`;

  return (
    <>
      <Seo
        title={post.title}
        description={post.excerpt || undefined}
        path={`/blog/${post.slug}`}
        image={image}
        type="article"
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

          <div className="mt-8 whitespace-pre-line text-base leading-relaxed text-[#2b303b]">
            {post.content || "This post doesn't have any content yet."}
          </div>
        </div>
      </section>

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

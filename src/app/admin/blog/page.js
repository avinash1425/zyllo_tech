import { createServerSupabaseClient } from "@/lib/supabase/server";
import BlogManager from "./BlogManager";

async function getBlogPosts() {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("blog_posts")
    .select(
      "id, title, slug, category, author, excerpt, content, featured_image_url, status, views, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load blog posts:", error.message);
    return [];
  }

  return data ?? [];
}

export default async function AdminBlogPage() {
  const posts = await getBlogPosts();

  return <BlogManager initialPosts={posts} />;
}

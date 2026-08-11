"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function slugify(text) {
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Appends a short random suffix if the slug is already taken, so two posts
// with the same title don't collide on the unique slug index.
async function uniqueSlug(supabase, baseSlug, excludeId) {
  let candidate = baseSlug || `post-${Date.now()}`;
  let attempt = 0;

  while (attempt < 5) {
    let query = supabase.from("blog_posts").select("id").eq("slug", candidate);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query.maybeSingle();

    if (!data) return candidate;
    attempt += 1;
    candidate = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  return `${baseSlug}-${Date.now()}`;
}

export async function createBlogPost(prevState, formData) {
  const title = formData.get("title")?.toString().trim();
  const category = formData.get("category")?.toString().trim() || "Engineering";
  const author = formData.get("author")?.toString().trim() || "Zyllo Engineering Team";
  const excerpt = formData.get("excerpt")?.toString().trim() || "";
  const content = formData.get("content")?.toString().trim() || "";
  const featuredImageUrl = formData.get("featuredImageUrl")?.toString().trim() || null;
  const status = formData.get("status")?.toString() === "published" ? "published" : "draft";
  const slugInput = formData.get("slug")?.toString().trim();

  if (!title) {
    return { status: "error", message: "Title is required." };
  }

  const supabase = await createServerSupabaseClient();
  const baseSlug = slugify(slugInput || title);
  const slug = await uniqueSlug(supabase, baseSlug);

  const { error } = await supabase.from("blog_posts").insert({
    title,
    slug,
    category,
    author,
    excerpt,
    content,
    featured_image_url: featuredImageUrl,
    status,
  });

  if (error) {
    console.error("Failed to create blog post:", error.message);
    return { status: "error", message: "Failed to create post. Please try again." };
  }

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  return { status: "success", message: "Post created." };
}

export async function updateBlogPost(prevState, formData) {
  const id = formData.get("id")?.toString();
  const title = formData.get("title")?.toString().trim();
  const category = formData.get("category")?.toString().trim() || "Engineering";
  const author = formData.get("author")?.toString().trim() || "Zyllo Engineering Team";
  const excerpt = formData.get("excerpt")?.toString().trim() || "";
  const content = formData.get("content")?.toString().trim() || "";
  const featuredImageUrl = formData.get("featuredImageUrl")?.toString().trim() || null;
  const status = formData.get("status")?.toString() === "published" ? "published" : "draft";
  const slugInput = formData.get("slug")?.toString().trim();

  if (!id || !title) {
    return { status: "error", message: "Title is required." };
  }

  const supabase = await createServerSupabaseClient();
  const baseSlug = slugify(slugInput || title);
  const slug = await uniqueSlug(supabase, baseSlug, id);

  const { error } = await supabase
    .from("blog_posts")
    .update({
      title,
      slug,
      category,
      author,
      excerpt,
      content,
      featured_image_url: featuredImageUrl,
      status,
    })
    .eq("id", id);

  if (error) {
    console.error("Failed to update blog post:", error.message);
    return { status: "error", message: "Failed to update post. Please try again." };
  }

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);
  return { status: "success", message: "Post updated." };
}

export async function togglePostStatus(id, currentStatus) {
  const supabase = await createServerSupabaseClient();
  const nextStatus = currentStatus === "published" ? "draft" : "published";
  const { error } = await supabase
    .from("blog_posts")
    .update({ status: nextStatus })
    .eq("id", id);

  if (error) {
    console.error("Failed to toggle post status:", error.message);
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  return { status: "success" };
}

export async function deleteBlogPost(id) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("blog_posts").delete().eq("id", id);

  if (error) {
    console.error("Failed to delete blog post:", error.message);
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  return { status: "success" };
}

"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function uploadImageIfProvided(supabase, imageFile) {
  if (!(imageFile instanceof File) || imageFile.size === 0) {
    return { url: null, error: null };
  }

  if (!ALLOWED_IMAGE_TYPES.includes(imageFile.type)) {
    return { url: null, error: "Image must be a JPG, PNG, or WEBP file." };
  }

  if (imageFile.size > MAX_IMAGE_BYTES) {
    return { url: null, error: "Image must be under 5MB." };
  }

  const ext = imageFile.type === "image/png" ? "png" : imageFile.type === "image/webp" ? "webp" : "jpg";
  const filePath = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("portfolio-images")
    .upload(filePath, imageFile, { contentType: imageFile.type, upsert: false });

  if (uploadError) {
    console.error("Failed to upload portfolio image:", uploadError.message);
    return { url: null, error: "Failed to upload image. Please try again." };
  }

  // Private bucket (public buckets aren't allowed on this host) — serve
  // the file through src/app/api/media/[...path] instead.
  return { url: `/api/media/portfolio-images/${filePath}`, error: null };

}

function buildProjectPayload(formData) {
  const title = formData.get("title")?.toString().trim();
  const tag = formData.get("tag")?.toString().trim();
  const description = formData.get("description")?.toString().trim();
  const status = formData.get("status")?.toString() === "published" ? "published" : "draft";

  if (!title || !tag || !description) {
    return { error: "Title, tag, and description are required." };
  }

  return {
    payload: {
      title,
      tag,
      description,
      status,
    },
  };
}

export async function createProject(prevState, formData) {
  const { payload, error } = buildProjectPayload(formData);
  if (error) return { status: "error", message: error };

  const supabase = await createServerSupabaseClient();

  const imageFile = formData.get("image");
  const { url: imageUrl, error: imageError } = await uploadImageIfProvided(supabase, imageFile);
  if (imageError) return { status: "error", message: imageError };

  const { error: insertError } = await supabase.from("portfolio_projects").insert({
    ...payload,
    image_url: imageUrl,
  });

  if (insertError) {
    console.error("Failed to create project:", insertError.message);
    return { status: "error", message: "Could not create project." };
  }

  revalidatePath("/admin/portfolio");
  revalidatePath("/portfolio");
  return { status: "success" };
}

export async function updateProject(projectId, prevState, formData) {
  const { payload, error } = buildProjectPayload(formData);
  if (error) return { status: "error", message: error };

  const supabase = await createServerSupabaseClient();

  const imageFile = formData.get("image");
  const { url: imageUrl, error: imageError } = await uploadImageIfProvided(supabase, imageFile);
  if (imageError) return { status: "error", message: imageError };

  const updatePayload = { ...payload };
  if (imageUrl) updatePayload.image_url = imageUrl;

  const { error: updateError } = await supabase
    .from("portfolio_projects")
    .update(updatePayload)
    .eq("id", projectId);

  if (updateError) {
    console.error("Failed to update project:", updateError.message);
    return { status: "error", message: "Could not update project." };
  }

  revalidatePath("/admin/portfolio");
  revalidatePath("/portfolio");
  return { status: "success" };
}

export async function toggleProjectStatus(projectId, newStatus) {
  if (!["draft", "published"].includes(newStatus)) {
    return { status: "error", message: "Invalid status." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("portfolio_projects")
    .update({ status: newStatus })
    .eq("id", projectId);

  if (error) {
    console.error("Failed to toggle project status:", error.message);
    return { status: "error", message: "Could not update status." };
  }

  revalidatePath("/admin/portfolio");
  revalidatePath("/portfolio");
  return { status: "success" };
}

export async function deleteProject(projectId) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("portfolio_projects").delete().eq("id", projectId);

  if (error) {
    console.error("Failed to delete project:", error.message);
    return { status: "error", message: "Could not delete project." };
  }

  revalidatePath("/admin/portfolio");
  revalidatePath("/portfolio");
  return { status: "success" };
}

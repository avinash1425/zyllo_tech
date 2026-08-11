import { createServerSupabaseClient } from "@/lib/supabase/server";

// Streams a file out of a private storage bucket.
//
// Public buckets are not permitted in this hosting environment, so
// uploaded resumes and portfolio images can't be served from a direct
// public storage URL. Instead we store a stable path like
// /api/media/portfolio-images/<file> in the database and stream the file
// through this route. Read access is still governed by the storage RLS
// policy on the bucket (both buckets below are readable).
const ALLOWED_BUCKETS = new Set(["portfolio-images", "resumes"]);

export async function GET(request, { params }) {
  const { path } = await params;
  const segments = path ?? [];
  const [bucket, ...rest] = segments;
  const objectPath = rest.join("/");

  if (!bucket || !ALLOWED_BUCKETS.has(bucket) || !objectPath) {
    return new Response("Not found", { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);

  if (error || !data) {
    console.error("Failed to load media:", bucket, objectPath, error?.message);
    return new Response("Not found", { status: 404 });
  }

  return new Response(data.stream(), {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

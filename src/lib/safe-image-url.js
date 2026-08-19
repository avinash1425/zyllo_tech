// Blog posts store featured_image_url as free-typed text in the admin
// form (no upload flow, just a URL field — see BlogManager.js), so
// Supabase can contain anything someone pasted, including local dev URLs
// like http://localhost:3000/blogs/AI.png. next/image throws a hard
// runtime error for any hostname not allow-listed in next.config.mjs's
// images.remotePatterns (which only allows https), crashing the whole
// page rather than just hiding one broken image.
//
// Use this to gate every next/image src that comes from post/user data:
// only allow https:// URLs (matches remotePatterns) or same-app relative
// paths (served from /public); anything else — localhost, http://,
// malformed strings — is treated as "no image" instead of a crash.
export function safeImageUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Relative path into this app's own /public folder — always safe,
  // next/image doesn't apply remotePatterns to local assets.
  if (trimmed.startsWith("/")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

import { supabase } from "@/lib/supabase/client";

const BUCKET = "resumes";
const SIGNED_TTL_SECONDS = 60 * 60;

// Old rows store the full public URL (".../object/public/resumes/<path>");
// new rows store the object path directly. Returns the object path or null.
export function resumePathFromValue(value) {
  if (!value) return null;
  const marker = `/${BUCKET}/`;
  if (/^https?:\/\//i.test(value)) {
    const idx = value.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(value.slice(idx + marker.length).split("?")[0]);
  }
  return value.replace(/^\/+/, "");
}

// Returns Map<path, signedUrl> for the given object paths (private bucket,
// signed with the admin session; RLS policy "resumes: admin read").
export async function signResumePaths(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  const map = new Map();
  if (unique.length === 0) return map;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(unique, SIGNED_TTL_SECONDS);
  if (error) {
    console.error("Failed to sign resume URLs:", error.message);
    return map;
  }
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) map.set(row.path, row.signedUrl);
  }
  return map;
}

// Adds `resume_path` and swaps `resume_url` for a signed URL on each row.
export async function withSignedResumeUrls(rows) {
  const paths = rows.map((r) => resumePathFromValue(r.resume_url));
  const signed = await signResumePaths(paths);
  return rows.map((r, i) => ({
    ...r,
    resume_path: paths[i],
    resume_url: paths[i] ? signed.get(paths[i]) ?? null : r.resume_url,
  }));
}

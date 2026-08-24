// Injects live, open job postings into public/sitemap.xml before every
// build. Job postings live in Supabase (job_postings table) and are added
// by the admin dashboard, so a hand-maintained static sitemap can never
// list them — this keeps /careers/:id pages discoverable without needing
// full SSR.
//
// Deliberately fails soft: if Supabase is unreachable or the table is
// empty, this logs a warning and leaves sitemap.xml untouched rather than
// failing the build. A stale sitemap is a much smaller problem than a
// broken production deploy.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITEMAP_PATH = path.resolve(__dirname, "../public/sitemap.xml");
const SITE_URL = process.env.VITE_SITE_URL || "https://zyllotech.com";

// Same public, RLS-scoped anon key used by src/integrations/supabase/client.ts.
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://zfjeflpvwizlteflypsx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmamVmbHB2d2l6bHRlZmx5cHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MzI3NDQsImV4cCI6MjA4ODIwODc0NH0.ByQFv9bNnc1ibdeE1nWoHhqIKFw-mGxFbb2nsPc7F_s";

const START_MARKER = "<!-- ── Job Postings (auto-generated, do not hand-edit) ──── -->";
const END_MARKER = "<!-- ── /Job Postings ─────────────────────────────────────── -->";

function buildJobUrlBlock(jobs) {
  if (jobs.length === 0) return "";
  const entries = jobs
    .map((job) => {
      const lastmod = (job.updated_at || job.created_at || "").slice(0, 10);
      return `  <url>
    <loc>${SITE_URL}/careers/${job.id}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
    })
    .join("\n\n");
  return `${START_MARKER}\n${entries}\n${END_MARKER}`;
}

async function main() {
  let jobs = [];
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const { data, error } = await supabase
      .from("job_postings")
      .select("id, created_at, updated_at")
      .eq("status", "open");
    if (error) throw error;
    jobs = data ?? [];
  } catch (err) {
    console.warn(
      `[generate-sitemap] Skipping job-posting sitemap entries — could not reach Supabase: ${err.message}`
    );
    return;
  }

  const xml = readFileSync(SITEMAP_PATH, "utf8");
  const withoutOldBlock = xml.replace(
    new RegExp(`${escapeRegex(START_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}\\n*`),
    ""
  );

  const block = buildJobUrlBlock(jobs);
  const updated = block
    ? withoutOldBlock.replace("</urlset>", `${block}\n\n</urlset>`)
    : withoutOldBlock;

  writeFileSync(SITEMAP_PATH, updated);
  console.log(`[generate-sitemap] Wrote ${jobs.length} job posting URL(s) into sitemap.xml`);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main();

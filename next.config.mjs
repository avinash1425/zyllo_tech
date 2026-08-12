/** @type {import('next').NextConfig} */

// Some hosts inject the backend credentials as VITE_* rather than
// NEXT_PUBLIC_*, so bridge those names here. An explicit NEXT_PUBLIC_*
// value always wins.
//
// IMPORTANT: only real values go into `env` below. Anything listed there
// is INLINED INTO THE BUNDLE AT BUILD TIME, so an empty-string fallback
// would be frozen into the output permanently — the app would then read
// "" for the Supabase URL forever, and setting the variable on the host
// afterwards could not override it (Next has already substituted the
// literal). That silently turned a missing variable into a site where
// every page 500s, instead of an obvious configuration error.
//
// By omitting absent values, `process.env.NEXT_PUBLIC_*` is left alone:
// Next still inlines it for client bundles when set at build time, and
// server code keeps reading it at runtime.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const env = {};
if (SUPABASE_URL) env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
if (SUPABASE_PUBLISHABLE_KEY) {
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = SUPABASE_PUBLISHABLE_KEY;
}

const nextConfig = {
  devIndicators: false,
  env,

  // The platform's post-build check looks for a `dist/` directory, so emit the
  // Next build there instead of the default `.next/`.
  distDir: "dist",

  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;

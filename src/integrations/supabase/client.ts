import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { brokeredPreviewStorage } from './previewAuthStorage';

// Falls back to this project's own public anon key when VITE_SUPABASE_URL /
// VITE_SUPABASE_PUBLISHABLE_KEY aren't injected at build time (e.g. Lovable's
// custom-domain publish pipeline has been observed to skip Connector env
// injection even though the same-origin dev/preview build receives it fine).
// Both values are the public, RLS-scoped anon key/URL for project
// zfjeflpvwizlteflypsx (matches supabase/config.toml) — safe to ship to the
// browser; there is no service-role key in this environment.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://zfjeflpvwizlteflypsx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmamVmbHB2d2l6bHRlZmx5cHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MzI3NDQsImV4cCI6MjA4ODIwODc0NH0.ByQFv9bNnc1ibdeE1nWoHhqIKFw-mGxFbb2nsPc7F_s";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  }
});
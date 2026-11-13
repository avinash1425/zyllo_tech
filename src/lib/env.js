// Website Supabase connection. VITE_SITE_SUPABASE_* are the website's own
// names, which Lovable Cloud does not manage or rewrite; they win only when
// BOTH are set, so a URL and key from different projects are never mixed.
// Otherwise the Lovable-managed VITE_SUPABASE_* pair is used.
const SITE_SUPABASE_URL = import.meta.env.VITE_SITE_SUPABASE_URL;
const SITE_SUPABASE_KEY = import.meta.env.VITE_SITE_SUPABASE_PUBLISHABLE_KEY;
const USE_SITE_SUPABASE = Boolean(SITE_SUPABASE_URL && SITE_SUPABASE_KEY);

export const SUPABASE_URL = USE_SITE_SUPABASE ? SITE_SUPABASE_URL : import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = USE_SITE_SUPABASE
  ? SITE_SUPABASE_KEY
  : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const SITE_URL_ENV = import.meta.env.VITE_SITE_URL;

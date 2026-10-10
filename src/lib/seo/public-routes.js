// Public, indexable routes the SEO audit expects to find in sitemap.xml.
// Keep equal to STATIC_ROUTES in supabase/functions/sitemap/index.ts and to
// the public routes in src/App.jsx. Service, blog and job URLs are added at
// audit time from src/data/services.js and the database.
export const STATIC_PUBLIC_ROUTES = [
  { path: "/", label: "Home" },
  { path: "/about", label: "About" },
  { path: "/services", label: "Services" },
  { path: "/industries", label: "Industries" },
  { path: "/portfolio", label: "Portfolio" },
  { path: "/blog", label: "Blog" },
  { path: "/careers", label: "Careers" },
  { path: "/contact", label: "Contact" },
  { path: "/privacy", label: "Privacy Policy" },
  { path: "/terms", label: "Terms of Service" },
];

// Routes that must stay out of search results. The audit verifies robots.txt
// blocks them; they are deliberately not in the sitemap.
export const PRIVATE_PATHS = ["/admin", "/login"];

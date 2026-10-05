# Next.js -> Vite/React/Lovable port: conventions (read before editing)

Stack: Vite + React 19 + react-router-dom v7 + react-helmet-async + Tailwind v4 (@tailwindcss/vite) + supabase-js (browser only).
NO server code: no "use server", no server components, no next/*, no process.env, no secret keys in src/.

Shims (already written): `@/lib/nx/link`, `@/lib/nx/image`, `@/lib/nx/navigation` (usePathname / useRouter / useSearchParams / useParams / `<Redirect to>`).
Auth: `useAuth()` from `@/lib/auth` -> { user, loading, signIn, signOut }. Supabase: `import { supabase } from "@/lib/supabase/client"`.
SEO: render `<Seo title description path image />` (src/components/Seo.jsx) in every page; JSON-LD components render a script tag inside Helmet.
Env: `import.meta.env.VITE_*` only (see src/lib/env.js).

Pages: src/pages/{Home,About,Services,ServiceDetail,Industries,Portfolio,Blog,BlogPost,Careers,CareerDetail,Contact,Privacy,Terms,SitemapPage,Login,NotFound}.jsx (default exports; names are fixed, App.jsx imports them).
Admin: src/admin/AdminRoutes.jsx (default export, mounted at /admin/*, contains the auth + admin guard and nested Routes); other admin files under src/admin/.
Old Next files under src/app/** are the SOURCE; after porting a file, delete the old one (git rm). src/app/globals.css stays (imported by main.jsx).
Server-component data fetching -> useEffect/useState (or a small hook) calling supabase, with loading and not-found states.
Server actions -> plain async functions in src/lib/api/*.js calling supabase directly (RLS enforces access) or supabase.functions.invoke("<name>").
revalidatePath -> drop; refetch after mutation instead.
Edge Functions + SQL policies are written as FILES ONLY (supabase/functions/*, supabase/policies/*.sql) - never applied.
Keep visual output identical to the Next version. Keep copy, classes, SEBI/identity text untouched.

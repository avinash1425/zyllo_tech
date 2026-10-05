# Lovable compatibility notes

This app is a browser-only Vite + React + react-router + Supabase project, so it matches the kind of project Lovable builds and hosts.

## Verified in this repo (local, not yet in a Lovable project)
- `vite build` passes; no Next.js code, no `process.env`, no server-only secrets in `src/`.
- Env only via `import.meta.env.VITE_*` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SITE_URL`).
- No horizontal overflow on 14 public routes at 320, 360, 390, 768, 1024, 1280, 1536 and 1920 px.
- Custom CSS classes and keyframes use a `zt-` prefix, so they cannot collide with Lovable/shadcn/tailwind-animate class names.
- Tailwind fractional sizes that exist only in v4 (`h-4.5`, `w-5.5`, `py-18`) were replaced with arbitrary values; `peer-not-placeholder-shown:` was replaced with `peer-[&:not(:placeholder-shown)]:`; text shadows use arbitrary values.

## Known risks to check on first Lovable import
1. **Tailwind v4.** This repo pins Tailwind v4 (`@tailwindcss/vite`, `@import "tailwindcss"` and `@theme inline` in `src/app/globals.css`). Lovable projects default to v3 + `tailwind.config.ts`. Keep the repo's own `package.json`/`vite.config.js`; do not let Lovable regenerate them. If its editor misbehaves with v4, downgrade to Tailwind v3.4 (a small follow-up).
2. `shadow-md/lg/xl` and `rounded-*` default-scale utilities are still used in places; sizes differ slightly between v3 and v4.
3. `max-sm:[html[data-zt-cookie]_&]:` (floating buttons lift above the cookie banner) was not tested under v3.4.
4. React 19 / JavaScript (JSX) rather than Lovable's default React 18 / TypeScript.
5. The Supabase project must be the same one this app was built against (RLS policies, `admin_users`, Edge Functions are in `supabase/`). See `supabase/DEPLOY.md`.

## Lovable import steps
1. Create a new Lovable project, connect it to GitHub.
2. Push this branch's code into the repo Lovable creates.
3. Set the three `VITE_` variables in Lovable project settings.
4. Add the Lovable preview URL and `https://zyllotech.com` to Supabase Auth redirect URLs.

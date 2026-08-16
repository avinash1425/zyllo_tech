# Permanently restore preview and publishing

## Diagnosis

The repository was changed from Lovable’s supported React/Vite application into a Next.js server application. The local sandbox can run that Next.js development server, but Lovable preview/publishing expects a Vite client build. This is why local checks appear healthy while Preview intermittently reports “Preview has not been built,” and publishing continues to serve the last compatible Vite deployment.

Changing `.env`, rebuilding `dist`, or switching Next.js cache directories cannot permanently resolve this framework mismatch.

## Implementation

1. **Restore a supported Vite application shell**
   - Replace the Next.js-only scripts and build configuration with React, Vite, TypeScript, and React Router.
   - Preserve the current public assets, design tokens, and Zyllo Tech branding.
   - Keep local development and Lovable publishing on the same build command and output format.

2. **Port the current website, not the obsolete deployed version**
   - Recreate the current public routes and shared chrome in the Vite app: home, about, services, industries, portfolio, blog, careers, contact, legal pages, login, and sitemap.
   - Convert Next-specific links, images, metadata, layouts, and server components into Vite-compatible React components.
   - Preserve responsive behavior and the current page content rather than reverting to the old website.

3. **Move dynamic behavior to Lovable Cloud-compatible flows**
   - Replace Next server actions and API routes with browser database/auth calls or Cloud functions where server-side protection is required.
   - Preserve role-protected admin access, content management, job applications, contact submissions, private resumes, search, and media access.
   - Keep the existing database, row-level access controls, auth, and storage data intact.

4. **Remove the conflicting runtime**
   - Remove Next.js-only configuration, proxy, generated cache/output assumptions, and incompatible imports after each equivalent Vite route is working.
   - Ensure environment access uses managed `VITE_*` variables only; do not commit or overwrite `.env` secrets.

5. **Verify and deploy**
   - Validate the Vite production build, local preview, major public routes, forms, authentication redirects, admin authorization, and mobile/desktop rendering.
   - Run the security scan, publish once the scan is clear, and verify both the Lovable URL and `zyllotech.com` serve the same new build.
   - Send an in-chat completion notification with the verified URLs and deployment state.

## Technical notes

- This is a framework migration, not another cache reset; keeping Next.js would leave the same unsupported deployment path in place.
- The work will be staged route-by-route so current source remains available as the reference until the Vite replacement is verified.
- No database reset or content deletion is required.

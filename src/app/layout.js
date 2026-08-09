import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import SiteChrome from "@/components/SiteChrome";
import OrganizationJsonLd from "@/components/OrganizationJsonLd";
import { SITE_URL, SITE_NAME, DEFAULT_DESCRIPTION, OG_IMAGE_PATH } from "@/lib/site-config";
import { createSsrServerClient } from "@/lib/supabase/ssr-server";

const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const headingFont = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata = {
  // metadataBase resolves every relative OG/Twitter image and canonical
  // URL below (and in any page-level metadata that doesn't set its own
  // absolute URL) against SITE_URL — see src/lib/site-config.js for the
  // placeholder-domain note.
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    // Lets every other page just set `title: "About Us"` and get
    // "About Us | Zyllo Tech" for free, instead of each page hand-writing
    // the " | Zyllo Tech" suffix (several already did, inconsistently).
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  keywords: [
    "custom software development",
    "mobile app development",
    "AI software solutions",
    "software company India",
    "Zyllo Tech",
  ],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    url: "/",
    locale: "en_US",
    images: [{ url: OG_IMAGE_PATH, width: 2816, height: 1536, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    images: [OG_IMAGE_PATH],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    // Real cropped infinity-mark artwork, served straight from /public.
    // src/app/icon.js was deleted (Next.js registers any file literally
    // named icon.* as a route regardless of its exports, so it had to go
    // rather than just be emptied) — this explicit metadata reference is
    // the one source of truth for the favicon now.
    //
    // The "?v=2" cache-buster is intentional: browsers cache favicons
    // per-URL very aggressively (often ignoring normal page/hard
    // refresh), so after the underlying PNG or this config changes again,
    // bump this version string so browsers see it as a new URL instead of
    // serving the stale cached icon.
    icon: "/Zyllo_Tech_Favicon_512x512.png?v=2",
    shortcut: "/Zyllo_Tech_Favicon_512x512.png?v=2",
    apple: "/Zyllo_Tech_Favicon_512x512.png?v=2",
  },
};

export default async function RootLayout({ children }) {
  // Session check runs on every page load, server-side — same getUser()
  // pattern proxy.js already uses to guard /admin. This is what lets
  // Header (a client component) show the logged-in state without doing
  // its own client-side auth fetch.
  const supabase = await createSsrServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${headingFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <OrganizationJsonLd />
        <SiteChrome user={user}>{children}</SiteChrome>
      </body>
    </html>
  );
}

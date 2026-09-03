import { Helmet } from "react-helmet-async";
import { serializeJsonLd } from "@/lib/jsonld";

export const SITE_URL = "https://zyllotech.com";
export const SITE_NAME = "Zyllo Tech";
export const SITE_LOGO = `${SITE_URL}/zyllo-logo.png`;
export const SITE_OG_IMAGE = `${SITE_URL}/og-default.png`;
export const SITE_TWITTER = "@ZylloS85154";

// ─── Global Organisation JSON-LD ────────────────────────────────────────────
export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": ["Organization", "ProfessionalService"],
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  legalName: "Zyllo Tech Software Solutions Private Limited",
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: SITE_LOGO,
    // Real pixel dimensions of public/zyllo-logo.png. Declaring the wrong
    // size (previously 200×60) is a validation defect — Google checks these
    // against the fetched asset.
    width: 1920,
    height: 384,
  },
  image: SITE_OG_IMAGE,
  description:
    "Zyllo Tech is a software engineering company based in Hyderabad, India, delivering web and mobile applications, AI/ML solutions, cloud DevOps, cybersecurity, and quality engineering for businesses in India, the US, and globally.",
  foundingDate: "2023",
  numberOfEmployees: { "@type": "QuantitativeValue", minValue: 10, maxValue: 50 },
  areaServed: ["IN", "US", "GB", "AE", "SG", "AU", "CA"],
  address: {
    "@type": "PostalAddress",
    addressCountry: "IN",
    addressRegion: "Telangana",
    addressLocality: "Hyderabad",
  },
  contactPoint: [
    {
      "@type": "ContactPoint",
      telephone: "+91-70757-73680",
      email: "info@zyllotech.com",
      contactType: "customer service",
      areaServed: ["IN", "SG", "AE", "AU", "CA", "GB"],
      availableLanguage: ["English", "Hindi", "Telugu"],
    },
    {
      "@type": "ContactPoint",
      email: "info@zyllotech.com",
      contactType: "sales",
      areaServed: "US",
      availableLanguage: "English",
    },
  ],
  // Facebook intentionally omitted: the previously-listed profile URL
  // (profile.php?id=61588192247341) resolves to "This content isn't
  // available" — dead/unverifiable, not a real page. Add it back once a
  // real Zyllo Tech Facebook page URL is confirmed.
  sameAs: [
    "https://www.linkedin.com/company/zyllo-tech",
    "https://x.com/ZylloS85154",
    "https://www.instagram.com/zyllotechsoftwaresolutions/",
    "https://www.youtube.com/@zylloTechSoftwareSolutions",
  ],
  knowsAbout: [
    "Software Development",
    "Web Application Development",
    "Mobile App Development",
    "Artificial Intelligence",
    "Machine Learning",
    "Cloud Computing",
    "DevOps",
    "Cybersecurity",
    "Data Engineering",
    "Quality Assurance",
  ],
  // Mirrors the 9 live service pages one-to-one, each Offer carrying the URL
  // of its Service page so the catalog resolves to real entities.
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Software Engineering Services",
    itemListElement: [
      { "@type": "Offer", url: `${SITE_URL}/services/product-strategy-consulting`, itemOffered: { "@type": "Service", name: "Custom Software Development", url: `${SITE_URL}/services/product-strategy-consulting`, description: "Discovery, roadmap, and end-to-end delivery of enterprise applications and business platforms." } },
      { "@type": "Offer", url: `${SITE_URL}/services/web-development`, itemOffered: { "@type": "Service", name: "Web Development", url: `${SITE_URL}/services/web-development`, description: "Fast, secure React and Node.js web applications, business websites, and e-commerce." } },
      { "@type": "Offer", url: `${SITE_URL}/services/mobile-app-development`, itemOffered: { "@type": "Service", name: "Mobile App Development", url: `${SITE_URL}/services/mobile-app-development`, description: "Native iOS/Android and cross-platform React Native or Flutter apps, wireframe to store launch." } },
      { "@type": "Offer", url: `${SITE_URL}/services/ui-ux-design`, itemOffered: { "@type": "Service", name: "UI/UX Design", url: `${SITE_URL}/services/ui-ux-design`, description: "Research, wireframes, prototypes, and design systems validated with real usability testing." } },
      { "@type": "Offer", url: `${SITE_URL}/services/cloud-solutions`, itemOffered: { "@type": "Service", name: "Cloud Solutions & DevOps", url: `${SITE_URL}/services/cloud-solutions`, description: "Cloud architecture, migration, Kubernetes, CI/CD pipelines, and cost optimization." } },
      { "@type": "Offer", url: `${SITE_URL}/services/ai-solutions`, itemOffered: { "@type": "Service", name: "AI Solutions", url: `${SITE_URL}/services/ai-solutions`, description: "LLM-powered copilots, RAG systems, chatbots, and workflow automation." } },
      { "@type": "Offer", url: `${SITE_URL}/services/maintenance-support`, itemOffered: { "@type": "Service", name: "Maintenance & Support", url: `${SITE_URL}/services/maintenance-support`, description: "Monitoring, security patching, bug fixes, and performance tuning under clear SLAs." } },
      { "@type": "Offer", url: `${SITE_URL}/services/cybersecurity-engineering`, itemOffered: { "@type": "Service", name: "Cybersecurity Engineering", url: `${SITE_URL}/services/cybersecurity-engineering`, description: "Secure development, OWASP-aligned code review, security assessments, and data protection." } },
      { "@type": "Offer", url: `${SITE_URL}/services/quality-engineering-qa`, itemOffered: { "@type": "Service", name: "Quality Engineering & QA", url: `${SITE_URL}/services/quality-engineering-qa`, description: "Automated test suites, regression testing, and performance testing wired into CI/CD." } },
    ],
  },
};

export const webSiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  url: SITE_URL,
  name: SITE_NAME,
  description: "Hyderabad-based software engineering company — web, mobile, AI/ML, cloud DevOps, cybersecurity, and quality engineering solutions.",
  publisher: { "@id": `${SITE_URL}/#organization` },
  potentialAction: {
    "@type": "SearchAction",
    target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/blog?q={search_term_string}` },
    "query-input": "required name=search_term_string",
  },
  inLanguage: ["en-IN", "en-US"],
};

// ─── Service helper ──────────────────────────────────────────────────────────
export function serviceSchema({
  name,
  description,
  url,
}: {
  name: string;
  description: string;
  url: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: name,
    name,
    description,
    url,
    provider: { "@id": `${SITE_URL}/#organization` },
    areaServed: ["IN", "US", "GB", "AE", "SG", "AU", "CA"],
  };
}

// ─── Breadcrumb helper ───────────────────────────────────────────────────────
export function breadcrumbSchema(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// ─── Component ───────────────────────────────────────────────────────────────
interface SEOHeadProps {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
  ogType?: "website" | "article" | "profile";
  noIndex?: boolean;
  structuredData?: object | object[];
  keywords?: string;
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  lang?: string;
  /** Pass hreflang alternates. If omitted, default en-IN / en-US / x-default are added automatically. */
  hreflang?: Array<{ lang: string; href: string }>;
}

const SEOHead = ({
  title,
  description,
  canonical,
  ogImage = SITE_OG_IMAGE,
  ogType = "website",
  noIndex = false,
  structuredData,
  keywords,
  publishedTime,
  modifiedTime,
  author,
  lang = "en",
  hreflang,
}: SEOHeadProps) => {
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  const canonicalUrl = canonical ? `${SITE_URL}${canonical}` : undefined;

  // Default hreflang: en-IN (primary), en-US (secondary), x-default
  const hreflangLinks = hreflang ?? (canonicalUrl
    ? [
        { lang: "en-IN", href: canonicalUrl },
        { lang: "en-US", href: canonicalUrl },
        { lang: "en",    href: canonicalUrl },
        { lang: "x-default", href: canonicalUrl },
      ]
    : []);

  const schemas: object[] = [organizationSchema, webSiteSchema];
  if (structuredData) {
    if (Array.isArray(structuredData)) schemas.push(...structuredData);
    else schemas.push(structuredData);
  }

  return (
    <Helmet defer={false}>
      {/* Sync commit: react-helmet-async defaults to requestAnimationFrame,
          which browsers pause entirely for hidden/background tabs — a real
          risk for crawlers or prerendering contexts that never gain focus. */}
      {/* ── Core ── */}
      <html lang={lang} />
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
      {noIndex && <meta name="robots" content="noindex,nofollow" />}
      {!noIndex && <meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1" />}

      {/* ── Author & Publisher ── */}
      <meta name="author" content={author ?? SITE_NAME} />
      <meta name="publisher" content={SITE_NAME} />
      <meta name="copyright" content={`© ${new Date().getFullYear()} ${SITE_NAME}`} />

      {/* ── Geo / Regional targeting (India-first, global) ── */}
      <meta name="geo.region" content="IN-TG" />
      <meta name="geo.placename" content="Hyderabad, India" />
      <meta name="geo.position" content="17.3850;78.4867" />
      <meta name="ICBM" content="17.3850, 78.4867" />
      <meta name="language" content="English" />
      <meta name="revisit-after" content="7 days" />
      <meta name="rating" content="general" />
      <meta name="distribution" content="global" />

      {/* ── Open Graph ── */}
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={fullTitle} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="en_IN" />
      <meta property="og:locale:alternate" content="en_US" />
      {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
      {hreflangLinks.map((h) => (
        <link key={h.lang} rel="alternate" hrefLang={h.lang} href={h.href} />
      ))}
      {publishedTime && <meta property="article:published_time" content={publishedTime} />}
      {modifiedTime && <meta property="article:modified_time" content={modifiedTime} />}

      {/* ── Twitter Card ── */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={SITE_TWITTER} />
      <meta name="twitter:creator" content={SITE_TWITTER} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      <meta name="twitter:image:alt" content={fullTitle} />

      {/* ── Mobile / PWA ── */}
      <meta name="theme-color" content="#f97316" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
      <link rel="manifest" href="/manifest.json" />

      {/* ── Structured Data ── */}
      {schemas.map((schema, i) => (
        <script key={i} type="application/ld+json">
          {serializeJsonLd(schema)}
        </script>
      ))}
    </Helmet>
  );
};

export default SEOHead;

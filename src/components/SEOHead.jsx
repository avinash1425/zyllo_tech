// Adapter for pages restored from the pre-port site (ArthaAI, Startups,
// Resources, city/market landing pages...). It renders through the current
// <Seo> component so those pages get the same canonical/OG/Twitter tags as
// the rest of the site, and adds only the page-specific JSON-LD. The global
// Organization/WebSite schema comes from OrganizationJsonLd, so it is NOT
// repeated here.
import Seo from "@/components/Seo";
import { SITE_URL, SITE_NAME } from "@/lib/site-config";

export { SITE_URL, SITE_NAME };

const AREA_SERVED = ["IN", "US", "GB", "AE", "SG", "AU", "CA"];

export function serviceSchema({ name, description, url }) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: name,
    name,
    description,
    url,
    provider: { "@id": `${SITE_URL}/#organization` },
    areaServed: AREA_SERVED,
  };
}

// Only pass questions that are visible on the page.
export function faqSchema(faqs) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function webPageSchema({ url, name, dateModified }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": url,
    url,
    name,
    dateModified,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

export function breadcrumbSchema(items) {
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

const safeJson = (data) => JSON.stringify(data).replace(/</g, "\\u003c");

export default function SEOHead({ title, description, canonical, ogImage, ogType, noIndex, structuredData, keywords }) {
  const schemas = structuredData ? (Array.isArray(structuredData) ? structuredData : [structuredData]) : [];
  const hasBrand = title?.includes(SITE_NAME);
  return (
    <Seo
      title={hasBrand ? undefined : title}
      absoluteTitle={hasBrand ? title : undefined}
      description={description}
      path={canonical}
      image={ogImage}
      type={ogType}
      noindex={noIndex}
    >
      {keywords && <meta name="keywords" content={keywords} />}
      {schemas.map((s, i) => (
        <script key={i} type="application/ld+json">{safeJson(s)}</script>
      ))}
    </Seo>
  );
}

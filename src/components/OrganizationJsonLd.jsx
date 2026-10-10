import { Helmet } from "react-helmet-async";
import {
  SITE_URL,
  SITE_NAME,
  LEGAL_NAME,
  OG_IMAGE_PATH,
  DEFAULT_DESCRIPTION,
  HOME_TITLE,
} from "@/lib/site-config";
import { SERVICE_COUNTRIES } from "@/data/service-areas";

// Site-wide Organization + WebSite schema. The address is the office on the
// company signboard; areaServed lists the countries the services are offered
// to remotely and does not claim any other office. Add "sameAs" (real
// LinkedIn/X/etc. URLs) once confirmed; guessing would be worse than
// omitting it. Keep in sync with the static copy in index.html.
//
// The meta tags are site-wide defaults, the same as the static fallback in
// index.html. Each page's <Seo> overrides them; they only show in the moment
// before a lazily loaded page has mounted, so the head is never left without
// a description.
export default function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        legalName: LEGAL_NAME,
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}${OG_IMAGE_PATH}`,
        description: DEFAULT_DESCRIPTION,
        email: "info@zyllotech.com",
        address: {
          "@type": "PostalAddress",
          streetAddress:
            "R V Plaza, Door No. 134-77/1, 3rd Floor, Gayathri Nagar, Phase-2, Mahatma Gandhi Inner Ring Road",
          addressLocality: "Guntur",
          addressRegion: "Andhra Pradesh",
          postalCode: "522034",
          addressCountry: "IN",
        },
        areaServed: SERVICE_COUNTRIES.map((name) => ({ "@type": "Country", name })),
        knowsAbout: [
          "Custom software development",
          "Web development",
          "Mobile app development",
          "AI development",
          "Cloud solutions",
          "UI/UX design",
          "Software testing",
          "Cybersecurity",
        ],
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "sales",
          email: "info@zyllotech.com",
          url: `${SITE_URL}/contact`,
          availableLanguage: "English",
          areaServed: "Worldwide",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: DEFAULT_DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };

  return (
    <Helmet>
      <meta name="description" content={DEFAULT_DESCRIPTION} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={HOME_TITLE} />
      <meta property="og:description" content={DEFAULT_DESCRIPTION} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={HOME_TITLE} />
      <meta name="twitter:description" content={DEFAULT_DESCRIPTION} />
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}

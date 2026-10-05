import { Helmet } from "react-helmet-async";
import { SITE_URL, SITE_NAME, LEGAL_NAME, OG_IMAGE_PATH } from "@/lib/site-config";

// Organization schema with the office address from the company signboard.
// Add "sameAs" (real LinkedIn/X/etc. URLs) once confirmed; guessing would be
// worse than omitting it.
export default function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    legalName: LEGAL_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}${OG_IMAGE_PATH}`,
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
  };

  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}

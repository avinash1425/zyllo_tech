import { Helmet } from "react-helmet-async";
import { SITE_URL, SITE_NAME, LEGAL_NAME, OG_IMAGE_PATH } from "@/lib/site-config";

// Minimal, honest Organization schema — no fabricated address or social
// profile links. Add "sameAs" (real LinkedIn/X/etc. URLs) and "address"
// (registered office) once those are confirmed; guessing either would be
// actively wrong structured data, worse than omitting them.
export default function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    legalName: LEGAL_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}${OG_IMAGE_PATH}`,
  };

  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}

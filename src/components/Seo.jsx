// Replaces Next metadata / generateMetadata. Render <Seo ... /> in each page.
import { Helmet } from "react-helmet-async";
import { SITE_URL, SITE_NAME, DEFAULT_DESCRIPTION, OG_IMAGE_PATH } from "@/lib/site-config";

export default function Seo({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  image = OG_IMAGE_PATH,
  type = "website",
  noindex = false,
  children,
}) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  const url = path != null ? `${SITE_URL}${path}` : undefined;
  const img = image?.startsWith("http") ? image : `${SITE_URL}${image}`;
  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}
      {url && <link rel="canonical" href={url} />}
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      {url && <meta property="og:url" content={url} />}
      <meta property="og:image" content={img} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={img} />
      {children}
    </Helmet>
  );
}

import { SITE_URL, SITE_NAME, OG_IMAGE_PATH } from "@/lib/site-config";

// Article structured data for a single published blog post.
export default function ArticleJsonLd({ post }) {
  const rawImage = post.featured_image_url || OG_IMAGE_PATH;
  // Schema.org wants an absolute image URL — post.featured_image_url can be
  // a site-relative path (real posts store free-typed URLs; fallback posts
  // use local /public paths like "/blog.png"), so resolve it against
  // SITE_URL rather than emitting a relative path.
  const image = rawImage.startsWith("/") ? `${SITE_URL}${rawImage}` : rawImage;

  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt || undefined,
    image: [image],
    datePublished: post.created_at,
    // Falls back to datePublished when there's no real edit timestamp
    // (fallback/static posts) rather than omitting the field outright.
    dateModified: post.updated_at || post.created_at,
    author: post.author
      ? { "@type": "Person", name: post.author }
      : { "@type": "Organization", name: SITE_NAME },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: `${SITE_URL}${OG_IMAGE_PATH}` },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}/blog/${post.slug}`,
    },
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

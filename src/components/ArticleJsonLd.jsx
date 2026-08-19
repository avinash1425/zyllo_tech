import { SITE_URL, SITE_NAME, OG_IMAGE_PATH } from "@/lib/site-config";

// Article structured data for a single published blog post. Only uses
// fields the post row actually has (see blog/[slug]/page.js's select) —
// no dateModified since blog_posts has no updated_at column to draw from.
export default function ArticleJsonLd({ post }) {
  const image = post.featured_image_url
    ? post.featured_image_url
    : `${SITE_URL}${OG_IMAGE_PATH}`;

  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt || undefined,
    image: [image],
    datePublished: post.created_at,
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

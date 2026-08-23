import { articles } from "@/data/articles";

// The blog and portfolio sections read from the backend so the admin dashboard
// can manage them. Until content is published there, the site falls back to
// this editorial content so pages are never empty.

function blockToText(block) {
  switch (block.type) {
    case "p":
    case "h2":
    case "h3":
    case "callout":
      return block.text;
    case "ul":
      return block.items.map((item) => `• ${item}`).join("\n");
    case "ol":
      return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
    case "metrics":
      return block.items.map((item) => `${item.label}: ${item.value}`).join("\n");
    default:
      return "";
  }
}

const IMAGE_BY_CATEGORY = {
  "AI & ML": "/blogs/AI.png",
  Cloud: "/globe.png",
  Development: "/home-service.jpg",
  Design: "/woman-enjoying-vr-headset.jpg",
  Business: "/about.png",
};

export const fallbackPosts = articles
  .map((article) => ({
    title: article.title,
    slug: article.slug,
    category: article.category,
    author: article.author,
    excerpt: article.excerpt,
    content: article.content.map(blockToText).filter(Boolean).join("\n\n"),
    featured_image_url: IMAGE_BY_CATEGORY[article.category] || "/blog.png",
    status: "published",
    created_at: new Date(article.date || Date.now()).toISOString(),
  }))
  .sort((a, b) => {
    const aFeatured = articles.find((x) => x.slug === a.slug)?.featured ? 1 : 0;
    const bFeatured = articles.find((x) => x.slug === b.slug)?.featured ? 1 : 0;
    if (aFeatured !== bFeatured) return bFeatured - aFeatured;
    return new Date(b.created_at) - new Date(a.created_at);
  });

export function findFallbackPost(slug) {
  return fallbackPosts.find((post) => post.slug === slug) || null;
}

export const fallbackProjects = [
  {
    id: "fallback-fintech-lending",
    title: "Digital Lending Platform",
    tag: "FinTech",
    description:
      "An end-to-end loan origination platform with KYC, credit scoring, and disbursal workflows for a fast-growing NBFC.",
    image_url: "/protfolio.png",
    challenge:
      "Loan files moved through spreadsheets and email, so approvals took days and compliance evidence was scattered across teams.",
    solution:
      "We built a single origination workflow with document capture, automated KYC checks, a rules-based scoring engine, and a full audit trail on every decision.",
    result:
      "Average approval time dropped from 4 days to under 6 hours, and audit reporting that used to take a week is now generated on demand.",
    status: "published",
    // Marks this as placeholder/example content (not a real completed
    // engagement) so FeaturedProjects/CaseStudies can show a visible
    // "Illustrative example" badge instead of implying a verified result.
    illustrative: true,
  },
  {
    id: "fallback-healthcare-portal",
    title: "Patient Care Portal",
    tag: "Healthcare",
    description:
      "A HIPAA-conscious portal connecting patients, clinicians, and diagnostics labs with appointments, records, and teleconsults.",
    image_url: "/robo.jpg",
    challenge:
      "Patients had no single place to see reports or book follow-ups, and clinic staff spent hours a day on phone scheduling.",
    solution:
      "We delivered a role-based portal with online scheduling, secure record sharing, video consults, and reminders over email and WhatsApp.",
    result:
      "Front-desk call volume fell by roughly 60%, and no-shows dropped sharply after automated reminders went live.",
    status: "published",
    // Marks this as placeholder/example content (not a real completed
    // engagement) so FeaturedProjects/CaseStudies can show a visible
    // "Illustrative example" badge instead of implying a verified result.
    illustrative: true,
  },
  {
    id: "fallback-retail-commerce",
    title: "Omnichannel Commerce Stack",
    tag: "Retail",
    description:
      "A headless storefront with unified inventory across warehouses, retail counters, and marketplaces.",
    image_url: "/home-service.jpg",
    challenge:
      "Stock counts drifted between the website, stores, and marketplaces, causing oversells and manual reconciliation every night.",
    solution:
      "We introduced an inventory service as the single source of truth, event-driven sync to every channel, and a headless storefront on a CDN.",
    result:
      "Oversells were effectively eliminated and page loads improved to under 1.5s on mobile, lifting conversion double digits.",
    status: "published",
    // Marks this as placeholder/example content (not a real completed
    // engagement) so FeaturedProjects/CaseStudies can show a visible
    // "Illustrative example" badge instead of implying a verified result.
    illustrative: true,
  },
  {
    id: "fallback-logistics-visibility",
    title: "Fleet Visibility Dashboard",
    tag: "Logistics",
    description:
      "Real-time tracking, route analytics, and delivery SLA monitoring for a regional logistics operator.",
    image_url: "/globe.png",
    challenge:
      "Dispatchers reacted to delays only after customers called, with no reliable view of where vehicles actually were.",
    solution:
      "We streamed GPS telemetry into a live dashboard with geofencing, ETA prediction, and exception alerts for at-risk shipments.",
    result:
      "On-time delivery improved by 18% in two quarters and customer status enquiries reduced significantly.",
    status: "published",
    // Marks this as placeholder/example content (not a real completed
    // engagement) so FeaturedProjects/CaseStudies can show a visible
    // "Illustrative example" badge instead of implying a verified result.
    illustrative: true,
  },
  {
    id: "fallback-ai-document-ai",
    title: "Document Intelligence Assistant",
    tag: "AI & ML",
    description:
      "A retrieval-augmented assistant that answers questions across thousands of internal policy and contract documents.",
    image_url: "/blogs/AI.png",
    challenge:
      "Teams lost hours searching contracts and policies, and answers varied depending on who was asked.",
    solution:
      "We built an ingestion pipeline with chunking and embeddings, a grounded answer layer that cites its sources, and role-aware access control.",
    result:
      "Research time per query fell from ~25 minutes to under 2, with every answer traceable to the source clause.",
    status: "published",
    // Marks this as placeholder/example content (not a real completed
    // engagement) so FeaturedProjects/CaseStudies can show a visible
    // "Illustrative example" badge instead of implying a verified result.
    illustrative: true,
  },
  {
    id: "fallback-saas-mvp",
    title: "SaaS MVP for a Funded Startup",
    tag: "Startups",
    description:
      "A production-ready MVP — auth, billing, analytics, and admin tooling — shipped in a single quarter.",
    image_url: "/woman-enjoying-vr-headset.jpg",
    challenge:
      "The founding team needed a credible, investor-ready product on a fixed runway, without accruing throwaway code.",
    solution:
      "We shipped in two-week increments on a modular architecture with subscriptions, usage analytics, and an internal admin console from day one.",
    result:
      "The MVP launched in 11 weeks, onboarded its first paying cohort, and the same codebase carried the team through their next raise.",
    status: "published",
    // Marks this as placeholder/example content (not a real completed
    // engagement) so FeaturedProjects/CaseStudies can show a visible
    // "Illustrative example" badge instead of implying a verified result.
    illustrative: true,
  },
];

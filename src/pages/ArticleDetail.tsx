import { useParams, Link, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Calendar, Clock, ArrowLeft, ArrowRight, Tag, ChevronRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import { getArticleBySlug, articles, type ContentBlock } from "@/data/articles";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

function renderBlock(block: ContentBlock, idx: number) {
  switch (block.type) {
    case "h2":
      return (
        <h2
          key={idx}
          className="font-display text-xl md:text-2xl font-bold text-foreground mt-10 mb-4 leading-snug"
        >
          {block.text}
        </h2>
      );
    case "h3":
      return (
        <h3
          key={idx}
          className="font-display text-lg font-semibold text-foreground mt-7 mb-3"
        >
          {block.text}
        </h3>
      );
    case "p":
      return (
        <p key={idx} className="text-muted-foreground leading-relaxed mb-5 text-[15px]">
          {block.text}
        </p>
      );
    case "ul":
      return (
        <ul key={idx} className="mb-5 space-y-2 pl-1">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-3 text-[15px] text-muted-foreground leading-relaxed">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {item}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={idx} className="mb-5 space-y-2 pl-1 counter-reset-[counter]">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-3 text-[15px] text-muted-foreground leading-relaxed">
              <span className="mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                {i + 1}
              </span>
              {item}
            </li>
          ))}
        </ol>
      );
    case "callout":
      return (
        <div
          key={idx}
          className="my-7 rounded-xl border border-primary/30 bg-primary/5 px-6 py-5"
        >
          <p className="text-[15px] font-medium text-foreground leading-relaxed italic">
            "{block.text}"
          </p>
        </div>
      );
    case "metrics":
      return (
        <div key={idx} className="my-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {block.items.map((metric, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-muted/40 px-4 py-4 text-center"
            >
              <p className="font-display text-2xl font-bold text-primary">{metric.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{metric.label}</p>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

const ArticleDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const article = slug ? getArticleBySlug(slug) : undefined;

  if (!article) {
    return <Navigate to="/blog" replace />;
  }

  const related = articles
    .filter((a) => a.slug !== article.slug && a.category === article.category)
    .slice(0, 3);

  const fallbackRelated =
    related.length > 0
      ? related
      : articles.filter((a) => a.slug !== article.slug).slice(0, 3);

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": article.category === "Industry Solutions" ? "TechArticle" : "Article",
    "@id": `${SITE_URL}/blog/${article.slug}`,
    headline: article.title,
    description: article.metaDescription || article.excerpt,
    url: `${SITE_URL}/blog/${article.slug}`,
    datePublished: article.date,
    dateModified: article.date,
    author: {
      "@type": "Person",
      name: article.author,
      jobTitle: article.role,
      worksFor: { "@type": "Organization", name: "Zyllo Tech", url: SITE_URL },
    },
    publisher: {
      "@type": "Organization",
      name: "Zyllo Tech",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/zyllo-logo.png` },
    },
    keywords: article.tags.join(", "),
    articleSection: article.category,
    inLanguage: "en-IN",
    isPartOf: { "@type": "Blog", name: "Zyllo Tech Engineering Blog", url: `${SITE_URL}/blog` },
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={article.title}
        description={article.metaDescription || article.excerpt}
        canonical={`/blog/${article.slug}`}
        ogType="article"
        keywords={article.tags.join(", ")}
        publishedTime={article.date}
        author={article.author}
        structuredData={[
          articleSchema,
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Blog", url: `${SITE_URL}/blog` },
            { name: article.title, url: `${SITE_URL}/blog/${article.slug}` },
          ]),
        ]}
      />
      <Navbar />

      {/* Breadcrumb */}
      <div className="border-b border-border bg-muted/30 py-3">
        <div className="container mx-auto px-4 sm:px-6">
          <nav className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
            <ChevronRight size={12} />
            <Link to="/blog" className="hover:text-foreground transition-colors">
              Blog
            </Link>
            <ChevronRight size={12} />
            <span className="text-foreground truncate max-w-[140px] sm:max-w-xs">
              {article.title}
            </span>
          </nav>
        </div>
      </div>

      <article className="py-14">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="mx-auto max-w-3xl">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                  {article.category}
                </span>
                {article.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"
                  >
                    <Tag size={9} />
                    {tag}
                  </span>
                ))}
              </div>

              <h1 className="font-display text-2xl font-bold text-foreground leading-tight md:text-3xl lg:text-4xl mb-5">
                {article.title}
              </h1>

              <p className="text-base text-muted-foreground leading-relaxed mb-6">
                {article.excerpt}
              </p>

              <div className="flex flex-wrap items-center gap-5 pb-8 border-b border-border">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-9 w-9 rounded-full ${article.color} flex items-center justify-center text-white text-xs font-bold`}
                  >
                    {article.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{article.author}</p>
                    <p className="text-xs text-muted-foreground">{article.role}</p>
                  </div>
                </div>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Calendar size={13} />
                  {article.date}
                </span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock size={13} />
                  {article.readTime}
                </span>
              </div>
            </motion.div>

            {/* Article Content */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="mt-10"
            >
              {article.content.map((block, idx) => renderBlock(block, idx))}
            </motion.div>

            {/* CTA Banner */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-14 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-[hsl(195,55%,42%,0.08)] p-8"
            >
              <h3 className="font-display text-xl font-bold text-foreground mb-2">
                Ready to implement this for your business?
              </h3>
              <p className="text-muted-foreground text-sm mb-5">
                Zyllo Tech has delivered these solutions across industries. Let's talk about your specific requirements.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  to="/contact"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  Start a Conversation
                  <ArrowRight size={15} />
                </Link>
                <Link
                  to="/industries"
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:border-primary/40 transition-colors"
                >
                  Explore All Industries
                </Link>
              </div>
            </motion.div>

            {/* Back to Blog */}
            <div className="mt-10">
              <Link
                to="/blog"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft size={14} />
                Back to all articles
              </Link>
            </div>
          </div>

          {/* Related Articles */}
          {fallbackRelated.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-20"
            >
              <div className="mx-auto max-w-3xl mb-8">
                <h2 className="font-display text-xl font-bold text-foreground">Related Articles</h2>
              </div>
              <div className="mx-auto max-w-3xl grid gap-5 sm:grid-cols-3">
                {fallbackRelated.map((rel) => (
                  <Link
                    key={rel.slug}
                    to={`/blog/${rel.slug}`}
                    className="group rounded-xl border border-border bg-background p-5 hover:border-primary/40 hover:shadow-md transition-all"
                  >
                    <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                      {rel.category}
                    </span>
                    <h3 className="mt-3 text-sm font-semibold text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-2">
                      {rel.title}
                    </h3>
                    <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                      <Clock size={10} /> {rel.readTime}
                    </p>
                  </Link>
                ))}
              </div>
            </motion.section>
          )}
        </div>
      </article>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default ArticleDetail;

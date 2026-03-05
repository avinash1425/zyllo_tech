import { useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Clock, ArrowRight, Tag } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import { Link } from "react-router-dom";
import { articles, articleCategories } from "@/data/articles";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const blogSchema = {
  "@context": "https://schema.org",
  "@type": "Blog",
  "@id": `${SITE_URL}/blog`,
  name: "Zyllo Tech Engineering Blog",
  description: "Technical articles, implementation guides, and industry insights from the Zyllo Tech engineering team.",
  url: `${SITE_URL}/blog`,
  publisher: { "@type": "Organization", name: "Zyllo Tech", url: SITE_URL },
  inLanguage: "en-IN",
};

const BlogPage = () => {
  const [activeCategory, setActiveCategory] = useState("All");

  const featured = articles.find((a) => a.featured)!;
  const filtered =
    activeCategory === "All"
      ? articles.filter((a) => !a.featured)
      : articles.filter((a) => !a.featured && a.category === activeCategory);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Engineering Blog & Industry Implementation Guides | Zyllo Tech"
        description="Read technical articles and deep-dive implementation guides from Zyllo Tech — covering AI/ML, cloud architecture, React, DevOps, and industry-specific software engineering for Banking, Healthcare, EdTech, Logistics, and more."
        canonical="/blog"
        keywords="software engineering blog India, tech articles India, AI ML blog, cloud architecture guide, React TypeScript tutorial, industry software implementation guide, banking software guide, healthcare software development"
        structuredData={[
          blogSchema,
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Blog", url: `${SITE_URL}/blog` },
          ]),
        ]}
      />
      <Navbar />
      <PageHero
        title="Insights &"
        highlight="Blog"
        description="Thoughts, tutorials, and industry implementation guides from the Zyllo Tech engineering and design team — on AI, cloud, product, and more."
        breadcrumb="Blog"
      />

      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6">
          {/* Featured Article */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-10 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-8 md:p-10 hover:shadow-lg transition-all duration-300"
          >
            <div className="flex flex-col md:flex-row md:items-start gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-4">
                  <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary uppercase tracking-wider">
                    Featured
                  </span>
                  <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                    {featured.category}
                  </span>
                </div>
                <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-3 leading-tight">
                  {featured.title}
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-5">{featured.excerpt}</p>
                <div className="flex flex-wrap items-center gap-4 mb-5 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <div className={`h-7 w-7 rounded-full ${featured.color} flex items-center justify-center text-white text-xs font-bold`}>
                      {featured.initials}
                    </div>
                    <span className="font-medium text-foreground">{featured.author}</span>
                    <span className="text-muted-foreground">· {featured.role}</span>
                  </div>
                  <span className="flex items-center gap-1"><Calendar size={13} /> {featured.date}</span>
                  <span className="flex items-center gap-1"><Clock size={13} /> {featured.readTime}</span>
                </div>
                <div className="flex flex-wrap gap-2 mb-6">
                  {featured.tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                      <Tag size={10} /> {tag}
                    </span>
                  ))}
                </div>
                <Link
                  to={`/blog/${featured.slug}`}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                >
                  Read Article <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </motion.div>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2 mb-8">
            {articleCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Article Grid */}
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((article, i) => (
              <motion.article
                key={article.slug}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
                className="group rounded-xl border border-border bg-background p-6 hover:border-primary/40 hover:shadow-md transition-all duration-300 flex flex-col"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {article.category}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock size={11} /> {article.readTime}
                  </span>
                </div>

                <h3 className="font-display text-base font-bold text-foreground mb-2 leading-snug group-hover:text-primary transition-colors">
                  {article.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4 flex-1 line-clamp-3">
                  {article.excerpt}
                </p>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {article.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div className="flex items-center gap-2">
                    <div className={`h-7 w-7 rounded-full ${article.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                      {article.initials}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">{article.author}</p>
                      <p className="text-[11px] text-muted-foreground">{article.date}</p>
                    </div>
                  </div>
                  <Link
                    to={`/blog/${article.slug}`}
                    className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                  >
                    Read <ArrowRight size={12} />
                  </Link>
                </div>
              </motion.article>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="py-20 text-center text-muted-foreground">
              No articles in this category yet. Check back soon.
            </div>
          )}

          {/* Newsletter CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-16 rounded-2xl bg-muted/60 border border-border p-10 text-center"
          >
            <h3 className="font-display text-2xl font-bold text-foreground mb-2">
              Stay in the Loop
            </h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Get our latest articles, industry implementation guides, and tech insights delivered to your inbox — no spam, ever.
            </p>
            <form
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                type="email"
                placeholder="your@email.com"
                required
                className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="submit"
                className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Subscribe
              </button>
            </form>
          </motion.div>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default BlogPage;

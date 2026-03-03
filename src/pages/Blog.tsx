import { motion } from "framer-motion";
import { Calendar, Clock, ArrowRight, Tag } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import { Link } from "react-router-dom";

const categories = ["All", "AI & ML", "Cloud", "Development", "Design", "Business"];

const articles = [
  {
    category: "AI & ML",
    title: "How AI is Reshaping Enterprise Software in 2025",
    excerpt:
      "From intelligent automation to generative AI copilots, explore how artificial intelligence is fundamentally changing the way enterprise software is built and used.",
    author: "Arun Sharma",
    role: "AI Lead",
    date: "Feb 20, 2025",
    readTime: "8 min read",
    featured: true,
    initials: "AS",
    color: "bg-blue-500",
    tags: ["AI", "Enterprise", "Automation"],
  },
  {
    category: "Cloud",
    title: "Migrating to Microservices: A Step-by-Step Playbook",
    excerpt:
      "Lessons learned from migrating a 10-year-old monolith to cloud-native microservices — what worked, what didn't, and the architecture decisions that saved us.",
    author: "Priya Reddy",
    role: "Cloud Architect",
    date: "Feb 12, 2025",
    readTime: "10 min read",
    featured: false,
    initials: "PR",
    color: "bg-teal-600",
    tags: ["Cloud", "DevOps", "Architecture"],
  },
  {
    category: "Development",
    title: "Building Scalable React Applications with TypeScript",
    excerpt:
      "Best practices, folder structures, state management patterns, and performance tips for building large-scale React applications that teams can maintain for years.",
    author: "Kiran Babu",
    role: "Senior Developer",
    date: "Feb 5, 2025",
    readTime: "7 min read",
    featured: false,
    initials: "KB",
    color: "bg-orange-500",
    tags: ["React", "TypeScript", "Frontend"],
  },
  {
    category: "AI & ML",
    title: "LangChain vs LlamaIndex: Choosing the Right RAG Framework",
    excerpt:
      "A practical comparison of the two leading retrieval-augmented generation frameworks — from setup complexity to performance benchmarks and production readiness.",
    author: "Arun Sharma",
    role: "AI Lead",
    date: "Jan 28, 2025",
    readTime: "9 min read",
    featured: false,
    initials: "AS",
    color: "bg-blue-500",
    tags: ["LLM", "RAG", "Python"],
  },
  {
    category: "Design",
    title: "Design Systems That Scale: Building for Teams of 50+",
    excerpt:
      "How we built and evolved a design system used by 50+ designers and developers — token structure, component governance, versioning, and documentation strategies.",
    author: "Meera Joshi",
    role: "Head of Design",
    date: "Jan 20, 2025",
    readTime: "6 min read",
    featured: false,
    initials: "MJ",
    color: "bg-purple-600",
    tags: ["Design System", "Figma", "UI/UX"],
  },
  {
    category: "Business",
    title: "How to Write a Software RFP That Gets Great Responses",
    excerpt:
      "After reviewing hundreds of RFPs, here's what separates the ones that attract top software companies from those that get generic responses — and a template to get you started.",
    author: "Rahul Nair",
    role: "Business Development",
    date: "Jan 14, 2025",
    readTime: "5 min read",
    featured: false,
    initials: "RN",
    color: "bg-emerald-600",
    tags: ["Business", "Procurement", "Strategy"],
  },
  {
    category: "Cloud",
    title: "Kubernetes Cost Optimization: 10 Tactics That Actually Work",
    excerpt:
      "Real-world strategies our DevOps team has used to cut Kubernetes infrastructure costs by 40%+ without sacrificing reliability or performance.",
    author: "Priya Reddy",
    role: "Cloud Architect",
    date: "Jan 8, 2025",
    readTime: "8 min read",
    featured: false,
    initials: "PR",
    color: "bg-teal-600",
    tags: ["Kubernetes", "Cost", "DevOps"],
  },
  {
    category: "Development",
    title: "The API Design Principles Behind Every Great Developer Experience",
    excerpt:
      "Naming conventions, versioning, error handling, pagination, and documentation practices that separate mediocre APIs from ones developers actually enjoy using.",
    author: "Kiran Babu",
    role: "Senior Developer",
    date: "Dec 30, 2024",
    readTime: "7 min read",
    featured: false,
    initials: "KB",
    color: "bg-orange-500",
    tags: ["API", "Backend", "Developer Experience"],
  },
  {
    category: "Design",
    title: "Micro-Interactions: The Secret Ingredient of Delightful UX",
    excerpt:
      "Small animations and feedback loops can dramatically improve how users feel about your product. Learn how to design, implement, and test micro-interactions effectively.",
    author: "Meera Joshi",
    role: "Head of Design",
    date: "Dec 22, 2024",
    readTime: "5 min read",
    featured: false,
    initials: "MJ",
    color: "bg-purple-600",
    tags: ["UX", "Animation", "Framer Motion"],
  },
];

const BlogPage = () => {
  const featured = articles.find((a) => a.featured)!;
  const rest = articles.filter((a) => !a.featured);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero
        title="Insights &"
        highlight="Blog"
        description="Thoughts, tutorials, and perspectives from the Zyllo Tech engineering and design team — on AI, cloud, product, and more."
        breadcrumb="Blog"
      />

      <section className="py-24">
        <div className="container mx-auto px-6">
          {/* Featured Article */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-14 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-8 md:p-10 hover:shadow-lg transition-all duration-300"
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
                  to="/contact"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                >
                  Read Article <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </motion.div>

          {/* Article Grid */}
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((article, i) => (
              <motion.article
                key={article.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.07 }}
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
                <p className="text-sm text-muted-foreground leading-relaxed mb-4 flex-1">
                  {article.excerpt}
                </p>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {article.tags.map((tag) => (
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
                  <Link to="/contact" className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
                    Read <ArrowRight size={12} />
                  </Link>
                </div>
              </motion.article>
            ))}
          </div>

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
              Get our latest articles, case studies, and tech insights delivered to your inbox — no spam, ever.
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

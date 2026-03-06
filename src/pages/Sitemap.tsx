import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const sections = [
  {
    title: "Main Pages",
    links: [
      { label: "Home", to: "/" },
      { label: "About Us", to: "/about" },
      { label: "Services", to: "/services" },
      { label: "Industries", to: "/industries" },
      { label: "Resources", to: "/resources" },
      { label: "Blog", to: "/blog" },
      { label: "Careers", to: "/careers" },
      { label: "Contact", to: "/contact" },
    ],
  },
  {
    title: "Legal Pages",
    links: [
      { label: "Privacy Policy", to: "/privacy-policy" },
      { label: "Terms of Service", to: "/terms-of-service" },
      { label: "Cookie Policy", to: "/cookie-policy" },
    ],
  },
];

const Sitemap = () => {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Sitemap | Zyllo Tech"
        description="Browse all important pages on Zyllo Tech. Human-friendly sitemap for quick navigation."
        canonical="/sitemap"
        keywords="zyllo tech sitemap, website pages, navigation"
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "Sitemap", url: `${SITE_URL}/sitemap` },
        ])}
      />

      <Navbar />
      <PageHero
        title="Site"
        highlight="Map"
        description="Quickly access all key sections of our website from one place."
        breadcrumb="Sitemap"
      />

      <section className="py-14">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid gap-6 md:grid-cols-2">
            {sections.map((section) => (
              <article key={section.title} className="rounded-xl border border-border bg-background p-6">
                <h2 className="font-display text-lg font-semibold text-foreground">{section.title}</h2>
                <ul className="mt-4 space-y-2">
                  {section.links.map((item) => (
                    <li key={item.to}>
                      <Link to={item.to} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="mt-8 rounded-xl border border-border bg-muted/40 p-5">
            <p className="text-sm text-muted-foreground">
              For search engines, XML sitemap:
              {" "}
              <a href="/sitemap.xml" className="font-medium text-primary hover:opacity-90 transition-opacity">
                /sitemap.xml
              </a>
            </p>
          </div>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default Sitemap;

import { CompatLink as Link } from "@/components/NextCompat";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import { SERVICES } from "@/data/services";

const GROUPS = [
  {
    title: "Company",
    links: [
      { href: "/", label: "Home" },
      { href: "/about", label: "About Us" },
      { href: "/industries", label: "Industries" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/blog", label: "Blog" },
      { href: "/careers", label: "Careers" },
      { href: "/contact", label: "Contact Us" },
    ],
  },
  {
    title: "Services",
    links: [
      { href: "/services", label: "All Services" },
      ...SERVICES.map((service) => ({
        href: `/services/${service.slug}`,
        label: service.title,
      })),
    ],
  },
  {
    title: "Products",
    links: [{ href: "/arthaai", label: "ArthaAI" }],
  },
  {
    title: "Account & Legal",
    links: [
      { href: "/login", label: "Login" },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms & Conditions" },
    ],
  },
];

export default function SitemapPage() {
  return (
    <>
      <SEOHead
        title="Sitemap | Zyllo Tech"
        description="A complete overview of every page on the Zyllo Tech website — services, industries, blog, careers, and legal pages."
        canonical="/sitemap"
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "Sitemap", url: `${SITE_URL}/sitemap` },
        ])}
      />
      <PageHero
        breadcrumbLabel="Sitemap"
        eyebrow="Navigate"
        title="Sitemap"
        description="A complete overview of every page on the Zyllo Tech website."
      />

      <section className="bg-white py-12 lg:py-16">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className="relative inline-block pb-3 text-sm font-bold uppercase tracking-[0.15em] text-[#f96706] after:absolute after:bottom-0 after:left-0 after:h-px after:w-8 after:bg-[#f96706]">
                  {group.title}
                </h2>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm font-medium text-[#54607a] transition-all duration-200 hover:translate-x-1 hover:text-[#f96706]"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

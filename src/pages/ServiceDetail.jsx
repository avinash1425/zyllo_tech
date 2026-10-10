import { useParams } from "@/lib/nx/navigation";
import Image from "@/lib/nx/image";
import { Check } from "lucide-react";
import PageHero from "@/components/PageHero";
import Seo from "@/components/Seo";
import NotFoundView from "@/components/NotFoundView";
import OtherServices from "@/sections/OtherServices";
import ServiceFaq from "@/sections/ServiceFaq";
import GlobalDelivery from "@/sections/GlobalDelivery";
import { getServiceBySlug } from "@/data/services";
import { SERVICE_THEMES } from "@/sections/ServiceGrid";
import { SITE_URL, SITE_NAME } from "@/lib/site-config";

const DEFAULT_THEME = SERVICE_THEMES["web-development"];

// Service + FAQPage + BreadcrumbList structured data. Everything here is
// taken from the visible page content; nothing is added that the page
// does not show.
function buildJsonLd(service, heading, url) {
  const graph = [
    {
      "@type": "Service",
      "@id": `${url}#service`,
      name: heading,
      serviceType: service.title,
      description: service.seoDescription || service.description,
      url,
      provider: { "@id": `${SITE_URL}/#organization` },
      areaServed: "Worldwide",
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: service.title,
        itemListElement: service.subServices.map((name) => ({
          "@type": "Offer",
          itemOffered: { "@type": "Service", name },
        })),
      },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Services", item: `${SITE_URL}/services` },
        { "@type": "ListItem", position: 3, name: heading, item: url },
      ],
    },
  ];
  if (service.faqs?.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: service.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.q,
        acceptedAnswer: { "@type": "Answer", text: faq.a },
      })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

export default function ServiceDetail() {
  const { slug } = useParams();
  const service = getServiceBySlug(slug);
  if (!service) return <NotFoundView />;

  const theme = SERVICE_THEMES[service.slug] ?? DEFAULT_THEME;
  const heading = service.pageTitle || service.title;
  const path = `/services/${service.slug}`;

  return (
    <>
      <Seo
        title={service.seoTitle || service.title}
        description={service.seoDescription || service.description}
        path={path}
      >
        <script type="application/ld+json">
          {JSON.stringify(buildJsonLd(service, heading, `${SITE_URL}${path}`))}
        </script>
      </Seo>
      <PageHero
        breadcrumbLabel="Services"
        eyebrow="Our Services"
        title={heading}
        description={service.description}
        image={service.image}
        imageAlt={`${heading} by ${SITE_NAME}`}
      />

      <section className="bg-white py-10 lg:py-14">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
              <Image
                src={service.image}
                alt={`${heading} services`}
                fill
                sizes="(min-width: 1024px) 480px, 100vw"
                className="object-cover"
              />
            </div>

            <div>
              <span
                className="text-sm font-bold tracking-[0.2em] uppercase"
                style={{ color: theme.accent }}
              >
                What We Deliver
              </span>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
                {service.title}
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-[#6c7889]">
                {service.overview}
              </p>

              <ul className="mt-6 flex flex-col gap-3">
                {service.highlights.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${theme.accent}26` }}
                    >
                      <Check className="h-3.5 w-3.5" style={{ color: theme.accent }} aria-hidden="true" />
                    </span>
                    <span className="text-base text-[#1d2735]">{point}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-6 text-sm font-semibold text-[#1d2735]">
                Includes: <span className="font-normal text-[#6c7889]">{service.subServices.join(", ")}</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <ServiceFaq serviceName={service.title} faqs={service.faqs} />
      <GlobalDelivery
        heading={`${service.title}, Delivered Remotely Worldwide`}
        excludeHref={path}
      />
      <OtherServices excludeSlug={service.slug} />
    </>
  );
}

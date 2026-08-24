import { useParams } from "react-router-dom";
import { Check } from "lucide-react";
import SEOHead, { breadcrumbSchema, serviceSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import OtherServices from "@/sections/OtherServices";
import NotFound from "@/pages/NotFound";
import { CompatImage as Image } from "@/components/NextCompat";
import { getServiceBySlug } from "@/data/services";
import { getServiceDetails } from "@/data/service-details";
import { SERVICE_THEMES } from "@/sections/ServiceGrid";

const DEFAULT_THEME = SERVICE_THEMES["web-development"];

export default function ServiceDetailPage() {
  const { slug } = useParams();
  const service = getServiceBySlug(slug);
  const details = getServiceDetails(slug);

  if (!service) return <NotFound />;

  const theme = SERVICE_THEMES[service.slug] ?? DEFAULT_THEME;

  return (
    <>
      <SEOHead
        title={details?.seoTitle || `${service.title} | Zyllo Tech`}
        description={details?.seoDescription || service.description}
        canonical={`/services/${service.slug}`}
        structuredData={[
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Services", url: `${SITE_URL}/services` },
            { name: service.title, url: `${SITE_URL}/services/${service.slug}` },
          ]),
          serviceSchema({
            name: service.title,
            description: service.description,
            url: `${SITE_URL}/services/${service.slug}`,
          }),
        ]}
      />
      <PageHero
        breadcrumbLabel="Services"
        eyebrow="Our Services"
        title={service.title}
        description={service.description}
        image={service.image}
        imageAlt={service.title}
      />

      <section className="bg-white py-10 lg:py-14">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
              <Image src={service.image} alt={service.title} fill className="object-cover" />
            </div>

            <div>
              <span className="text-sm font-bold uppercase tracking-[0.2em]" style={{ color: theme.text ?? theme.accent }}>
                What We Deliver
              </span>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
                {service.title}
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-[#5d6878]">{service.overview}</p>

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
            </div>
          </div>
        </div>
      </section>

      {details && (
        <>
          {/* How we work */}
          <section className="bg-[#fafbfc] py-10 lg:py-14">
            <div className="mx-auto max-w-6xl px-6 lg:px-8">
              <span className="text-sm font-bold uppercase tracking-[0.2em]" style={{ color: theme.text ?? theme.accent }}>
                How We Work
              </span>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
                Our {service.title} Process
              </h2>
              <ol className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {details.process.map((step, i) => (
                  <li key={step.title} className="rounded-xl border border-[#e7e9ee] bg-white p-6">
                    <span className="text-sm font-bold" style={{ color: theme.text ?? theme.accent }}>
                      Step {i + 1}
                    </span>
                    <h3 className="mt-2 text-base font-semibold text-[#1d2735]">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#54607a]">{step.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* Deliverables + stack */}
          <section className="bg-white py-10 lg:py-14">
            <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-[#1d2735]">What You Get</h2>
                <ul className="mt-6 flex flex-col gap-3">
                  {details.deliverables.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <span
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: `${theme.accent}26` }}
                      >
                        <Check className="h-3.5 w-3.5" style={{ color: theme.accent }} aria-hidden="true" />
                      </span>
                      <span className="text-base text-[#1d2735]">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-[#1d2735]">Technology We Use</h2>
                <ul className="mt-6 flex flex-wrap gap-2.5">
                  {details.stack.map((tech) => (
                    <li
                      key={tech}
                      className="rounded-full border border-[#e7e9ee] bg-[#fafbfc] px-4 py-1.5 text-sm font-medium text-[#1d2735]"
                    >
                      {tech}
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-sm leading-relaxed text-[#54607a]">
                  Tools serve the project, not the other way around — recommendations always come
                  with the reasoning, and we work within your existing stack where it makes sense.
                </p>
              </div>
            </div>
          </section>

          {/* FAQs — on-page content only; deliberately no FAQPage schema
              (Google restricts FAQ rich results to gov/health sites). */}
          <section className="bg-[#fafbfc] py-10 lg:py-14">
            <div className="mx-auto max-w-3xl px-6 lg:px-8">
              <h2 className="text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
                {service.title} — Common Questions
              </h2>
              <div className="mt-8 flex flex-col gap-6">
                {details.faqs.map((faq) => (
                  <div key={faq.q} className="rounded-xl border border-[#e7e9ee] bg-white p-6">
                    <h3 className="text-base font-semibold text-[#1d2735]">{faq.q}</h3>
                    <p className="mt-2 text-base leading-relaxed text-[#54607a]">{faq.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      <OtherServices excludeSlug={service.slug} />
    </>
  );
}

import { notFound } from "next/navigation";
import Image from "next/image";
import { Check } from "lucide-react";
import PageHero from "@/components/PageHero";
import OtherServices from "@/sections/OtherServices";
import { SERVICES, getServiceBySlug } from "@/data/services";
import { SERVICE_THEMES } from "@/sections/ServiceGrid";

const DEFAULT_THEME = SERVICE_THEMES["web-development"];

export function generateStaticParams() {
  return SERVICES.map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) return {};
  return {
    title: `${service.title} | Zyllo Tech`,
    description: service.description,
  };
}

export default async function ServiceDetailPage({ params }) {
  const { slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) notFound();

  const theme = SERVICE_THEMES[service.slug] ?? DEFAULT_THEME;

  return (
    <>
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
              <Image
                src={service.image}
                alt={service.title}
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
            </div>
          </div>
        </div>
      </section>

      <OtherServices excludeSlug={service.slug} />
    </>
  );
}

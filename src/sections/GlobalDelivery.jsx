import Link from "@/lib/nx/link";
import { ArrowRight, Globe2, MessagesSquare, Clock } from "lucide-react";
import { SERVICE_REGIONS, SERVICE_AREA_SUMMARY } from "@/data/service-areas";

// Worldwide remote-delivery positioning plus internal links between the
// main sections of the site. Zyllo Tech has one office (Guntur, India):
// the countries in src/data/service-areas.js are places the services are
// available remotely, never office locations. The full list is shown only
// where `showCountries` is set (home and /services); other pages get a
// one-sentence summary so the names are not repeated on every page.
const POINTS = [
  {
    icon: Globe2,
    title: "One team, based in India",
    text: "Our engineers, designers and QA work together from our office in Guntur, Andhra Pradesh.",
  },
  {
    icon: MessagesSquare,
    title: "Remote by default",
    text: "Projects run over video calls, shared boards and written updates, so location is not a barrier.",
  },
  {
    icon: Clock,
    title: "A reply within one business day",
    text: "Tell us what you want to build and we will come back with clear next steps.",
  },
];

const LINKS = [
  { label: "Custom software development", href: "/services/product-strategy-consulting" },
  { label: "AI development", href: "/services/ai-solutions" },
  { label: "Web development", href: "/services/web-development" },
  { label: "Mobile app development", href: "/services/mobile-app-development" },
  { label: "All services", href: "/services" },
  { label: "Industries we serve", href: "/industries" },
  { label: "Our portfolio", href: "/portfolio" },
];

export default function GlobalDelivery({
  heading = "Custom Software & AI Development, Delivered Remotely Worldwide",
  excludeHref,
  showCountries = false,
}) {
  const links = LINKS.filter((link) => link.href !== excludeHref);

  return (
    <section aria-labelledby="global-delivery-heading" className="relative overflow-hidden bg-white py-12 lg:py-16">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#c9580d]">
              <span aria-hidden="true" className="h-px w-8 bg-gradient-to-r from-[#f96706] to-[#3089a6]" />
              Remote Delivery Worldwide
            </span>
            <h2
              id="global-delivery-heading"
              className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-[#1d2735] sm:text-4xl"
            >
              {heading}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[#54607a] sm:text-lg">
              Zyllo Tech is a software development company in Guntur, Andhra Pradesh, India. We
              build custom software, web and mobile apps, and AI solutions for startups and
              established businesses, and we deliver every project remotely.
            </p>
            {showCountries ? (
              <>
                <p className="mt-4 text-base leading-relaxed text-[#54607a]">
                  Our services are available to businesses in:
                </p>
                <dl className="mt-3 flex flex-col gap-3">
                  {SERVICE_REGIONS.map((region) => (
                    <div key={region.name}>
                      <dt className="text-xs font-bold uppercase tracking-[0.14em] text-[#6c7889]">
                        {region.name}
                      </dt>
                      <dd className="mt-1.5">
                        <ul className="flex flex-wrap gap-2">
                          {region.countries.map((country) => (
                            <li
                              key={country}
                              className="rounded-full border border-[#e2e5ea] bg-[#f8f9fb] px-3 py-1 text-sm font-medium text-[#2b303b]"
                            >
                              {country}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-sm text-[#54607a]">Enquiries from other countries are welcome.</p>
              </>
            ) : (
              <p className="mt-4 text-base leading-relaxed text-[#54607a]">{SERVICE_AREA_SUMMARY}</p>
            )}
            <p className="mt-3 text-sm text-[#6c7889]">
              We work from a single office in India and do not have offices in other countries.
            </p>

            <Link
              href="/contact"
              className="group mt-7 inline-flex items-center gap-2 rounded-full bg-[#f96706] px-6 py-3 text-sm font-bold text-white transition-colors duration-200 hover:bg-[#c9580d]"
            >
              Start your project
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </div>

          <div>
            <ul className="flex flex-col gap-3">
              {POINTS.map(({ icon: Icon, title, text }) => (
                <li
                  key={title}
                  className="flex items-start gap-3 rounded-xl border border-[#e2e5ea] bg-[#f8f9fb] p-4"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#3089a6] text-white">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-base font-bold text-[#1d2735]">{title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-[#54607a]">{text}</span>
                  </span>
                </li>
              ))}
            </ul>

            <nav aria-label="Explore Zyllo Tech" className="mt-6">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6c7889]">Explore</p>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-[#1f4693] underline-offset-4 hover:underline"
                    >
                      {link.label}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      </div>
    </section>
  );
}

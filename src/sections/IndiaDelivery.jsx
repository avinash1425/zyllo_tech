import { useEffect, useRef } from "react";
import Link from "@/lib/nx/link";
import { ArrowRight } from "lucide-react";
import { INDIA_CITY_GROUPS } from "@/data/india-service-areas";

// India positioning for /about. Zyllo Tech has one office (Guntur, Andhra
// Pradesh): the other cities in src/data/india-service-areas.js are places
// the services are available remotely, never office locations.
const LINKS = [
  { label: "Custom software development", href: "/services/product-strategy-consulting" },
  { label: "AI development", href: "/services/ai-solutions" },
  { label: "Web development", href: "/services/web-development" },
  { label: "Mobile app development", href: "/services/mobile-app-development" },
];

export default function IndiaDelivery() {
  const sectionRef = useRef(null);

  // Links from other pages point at /about#india; the router does not scroll
  // to a hash on its own.
  useEffect(() => {
    if (window.location.hash !== "#india") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sectionRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, []);

  return (
    <section
      ref={sectionRef}
      id="india"
      aria-labelledby="india-delivery-heading"
      className="relative scroll-mt-24 overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-12 lg:py-16"
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#c9580d]">
              <span aria-hidden="true" className="h-px w-8 bg-gradient-to-r from-[#f96706] to-[#3089a6]" />
              Serving Businesses Across India
            </span>
            <h2
              id="india-delivery-heading"
              className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-[#1d2735] sm:text-4xl"
            >
              Based in Guntur, Serving Businesses Across India Remotely
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[#54607a] sm:text-lg">
              Zyllo Tech operates from one office in Guntur, Andhra Pradesh. Businesses in other
              Indian cities work with us remotely for custom software development, AI development,
              web development and mobile app development.
            </p>
            <p className="mt-3 text-sm text-[#6c7889]">
              Guntur is our only office. We do not have offices or staff in any other city.
            </p>

            <nav aria-label="Core services" className="mt-6">
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {LINKS.map((link) => (
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

            <Link
              href="/contact"
              className="group mt-7 inline-flex items-center gap-2 rounded-full bg-[#f96706] px-6 py-3 text-sm font-bold text-white transition-colors duration-200 hover:bg-[#c9580d]"
            >
              Start your project
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </div>

          <div>
            <p className="text-base leading-relaxed text-[#54607a]">
              Our services are available to businesses in:
            </p>
            <dl className="mt-3 flex flex-col gap-4">
              {INDIA_CITY_GROUPS.map((group) => (
                <div key={group.name}>
                  <dt className="text-xs font-bold uppercase tracking-[0.14em] text-[#6c7889]">
                    {group.name}
                  </dt>
                  <dd className="mt-1.5">
                    <ul className="flex flex-wrap gap-2">
                      {group.cities.map((city) => (
                        <li
                          key={city}
                          className="rounded-full border border-[#e2e5ea] bg-white px-3 py-1 text-sm font-medium text-[#2b303b]"
                        >
                          {city}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-[#54607a]">Enquiries from anywhere else in India are welcome.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

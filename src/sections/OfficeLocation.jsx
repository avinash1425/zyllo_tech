import { ExternalLink, Globe, MapPin, Navigation } from "lucide-react";
import Link from "@/lib/nx/link";
import { CONTACT_INFO, DIRECTIONS_URL, MAP_EMBED_URL, MAP_OPEN_URL } from "@/data/contact-info";

// The one place on /contact where the full postal address is printed.
export default function OfficeLocation() {
  return (
    <section
      id="visit-us"
      aria-labelledby="office-location-heading"
      className="relative scroll-mt-24 overflow-hidden border-t border-[#d9dde2] bg-white py-12 lg:py-16"
    >
      <div className="relative mx-auto max-w-6xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-[#c9580d]">
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
            Visit Us
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
          </span>
          <h2
            id="office-location-heading"
            className="mt-4 text-3xl font-extrabold tracking-tight text-[#1d2735] sm:text-4xl"
          >
            Our{" "}
            <span className="bg-gradient-to-r from-[#f96706] to-[#3089a6] bg-clip-text text-transparent">
              office in Guntur
            </span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#4a5668]">
            Please get in touch before you visit so we can make sure someone is there to meet you.
          </p>
          <p className="mt-3 text-base leading-relaxed text-[#4a5668]">
            Not in Guntur? We serve businesses in{" "}
            <Link href="/about#india" className="font-semibold text-[#1f4693] underline underline-offset-4 hover:text-[#c9580d]">
              other Indian cities
            </Link>{" "}
            and abroad remotely.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-stretch lg:gap-8">
          <div className="flex min-w-0 flex-col rounded-2xl border border-[#e2e5ea] bg-[#fafbfc] p-6 shadow-xl shadow-[#1f4693]/5 sm:p-7 lg:p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#f96706] to-[#f7941e] text-white shadow-lg shadow-[#f96706]/25">
              <MapPin className="h-6 w-6" aria-hidden="true" />
            </span>
            <h3 className="mt-5 text-xl font-extrabold leading-snug text-[#173a52]">Head office</h3>
            <address className="mt-3 text-base not-italic leading-[1.7] text-[#2b303b]">
              {CONTACT_INFO.addressLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>

            <dl className="mt-4 space-y-2 text-[15px] leading-relaxed">
              <div className="flex flex-wrap items-center gap-x-2">
                <dt className="inline-flex items-center gap-1.5 font-semibold text-[#173a52]">
                  <Globe className="h-4 w-4 text-[#3089a6]" aria-hidden="true" />
                  Website:
                </dt>
                <dd>
                  <a
                    href={CONTACT_INFO.websiteHref}
                    className="inline-flex min-h-11 items-center break-all font-medium text-[#1f4693] underline underline-offset-4 transition-colors hover:text-[#c9580d]"
                  >
                    {CONTACT_INFO.websiteLabel}
                  </a>
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:flex-col 2xl:flex-row">
              <a
                href={DIRECTIONS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#c9580d] px-6 py-3 text-[15px] font-semibold text-white shadow-lg shadow-[#f96706]/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#a84a0b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <Navigation className="h-4 w-4" aria-hidden="true" />
                Get directions
              </a>
              <a
                href={MAP_OPEN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#1f4693]/40 bg-white px-6 py-3 text-[15px] font-semibold text-[#1f4693] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#1f4693] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open in Google Maps
              </a>
            </div>
          </div>

          <div className="relative min-h-[300px] overflow-hidden rounded-2xl border border-[#e2e5ea] bg-[#eef1f5] shadow-2xl shadow-[#1f4693]/10 lg:min-h-[420px]">
            {/* Fallback sits behind the iframe; visible if the embed is blocked or fails to render. */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <MapPin className="h-8 w-8 text-[#3089a6]" aria-hidden="true" />
              <p className="text-[15px] text-[#4a5668]">The map couldn&apos;t be loaded.</p>
              <a
                href={MAP_OPEN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-[15px] font-semibold text-[#c9580d] underline underline-offset-4"
              >
                View our location on Google Maps
              </a>
            </div>
            <iframe
              title="Zyllo Tech office location on Google Maps"
              src={MAP_EMBED_URL}
              width="100%"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
              className="relative block h-[300px] w-full border-0 sm:h-[420px] lg:absolute lg:inset-0 lg:h-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

import { ExternalLink, Globe, Mail, MapPin, Navigation } from "lucide-react";

const MAP_QUERY = "R V Plaza, Gayathri Nagar Phase-2, Mahatma Gandhi Inner Ring Road, Guntur 522034, Andhra Pradesh";
const ENCODED = encodeURIComponent(MAP_QUERY);
const DIRECTIONS_URL = `https://www.google.com/maps/dir/?api=1&destination=${ENCODED}`;
const OPEN_URL = `https://www.google.com/maps/search/?api=1&query=${ENCODED}`;
const EMBED_URL = `https://www.google.com/maps?q=${ENCODED}&output=embed`;

export default function OfficeLocation() {
  return (
    <section
      aria-labelledby="office-location-heading"
      className="relative overflow-hidden border-t border-[#d9dde2] bg-white py-12 lg:py-16"
    >
      <div className="relative mx-auto max-w-6xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f96706]">
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
          <p className="mt-4 text-lg leading-relaxed text-[#6c7889]">
            Find us at R V Plaza, Gayathri Nagar, on the Mahatma Gandhi Inner Ring Road.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-8">
          <div className="flex flex-col rounded-2xl border border-[#e2e5ea] bg-[#fafbfc] p-7 shadow-xl shadow-[#1f4693]/5 lg:p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#f96706] to-[#f7941e] text-white shadow-lg shadow-[#f96706]/25">
              <MapPin className="h-6 w-6" aria-hidden="true" />
            </span>
            <h3 className="mt-5 text-xl font-extrabold text-[#173a52]">Zyllo Tech Software Solutions Private Limited</h3>
            <address className="mt-3 text-[15px] not-italic leading-relaxed text-[#4a5668]">
              R V Plaza, Door No. 134-77/1, 3rd Floor,
              <br />
              Gayathri Nagar, Phase-2,
              <br />
              Mahatma Gandhi Inner Ring Road,
              <br />
              Guntur - 522034, Andhra Pradesh, India.
            </address>

            <ul className="mt-5 space-y-2.5 text-sm">
              <li>
                <a
                  href="mailto:info@zyllotech.com"
                  className="inline-flex items-center gap-2.5 font-medium text-[#1f4693] hover:text-[#f96706]"
                >
                  <Mail className="h-4 w-4 text-[#3089a6]" aria-hidden="true" />
                  info@zyllotech.com
                </a>
              </li>
              <li>
                <a
                  href="https://www.zyllotech.com"
                  className="inline-flex items-center gap-2.5 font-medium text-[#1f4693] hover:text-[#f96706]"
                >
                  <Globe className="h-4 w-4 text-[#3089a6]" aria-hidden="true" />
                  www.zyllotech.com
                </a>
              </li>
            </ul>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <a
                href={DIRECTIONS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f96706] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#f96706]/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#c9580d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706]"
              >
                <Navigation className="h-4 w-4" aria-hidden="true" />
                Get directions
              </a>
              <a
                href={OPEN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[#1f4693]/25 bg-white px-6 py-3 text-sm font-semibold text-[#1f4693] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#1f4693] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693]"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open in Google Maps
              </a>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-[#e2e5ea] bg-[#eef1f5] shadow-2xl shadow-[#1f4693]/10">
            {/* Fallback sits behind the iframe; visible if the embed is blocked or fails to render. */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <MapPin className="h-8 w-8 text-[#3089a6]" aria-hidden="true" />
              <p className="text-sm text-[#4a5668]">The map couldn&apos;t be loaded.</p>
              <a
                href={OPEN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-[#f96706] underline underline-offset-4"
              >
                View our location on Google Maps
              </a>
            </div>
            <iframe
              title="Zyllo Tech office location on Google Maps"
              src={EMBED_URL}
              width="100%"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
              className="relative block h-[300px] w-full border-0 sm:h-[420px]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

import { CompatImage as Image } from "@/components/NextCompat";
import { CompatLink as Link } from "@/components/NextCompat";
import { ArrowRight } from "lucide-react";
import { SERVICES } from "@/data/services";
import { SERVICE_THEMES } from "@/sections/ServiceGrid";

const DEFAULT_THEME = SERVICE_THEMES["web-development"];

// Same infinite marquee treatment as ServiceGrid, but scoped to a single
// service detail page: shows every service except the one being viewed.
export default function OtherServices({ excludeSlug }) {
  const others = SERVICES.filter((service) => service.slug !== excludeSlug);
  const track = [...others, ...others];

  return (
    <section className="relative overflow-hidden bg-[#fafbfc] py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Explore More
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Our Other Services
          </h2>
        </div>
      </div>

      <div className="marquee-mask relative mt-12 overflow-hidden px-10 lg:px-24">
        <div className="marquee-track flex w-max gap-6 px-6">
          {track.map((service, index) => {
            const Icon = service.icon;
            const theme = SERVICE_THEMES[service.slug] ?? DEFAULT_THEME;
            return (
              <Link
                key={`${service.slug}-${index}`}
                href={`/services/${service.slug}`}
                className="group flex w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:scale-[1.03] hover:shadow-xl"
              >
                <div className="relative h-44 w-full overflow-hidden">
                  <Image
                    src={service.image}
                    alt={service.title}
                    fill
                    sizes="320px"
                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/20" />
                  <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm">
                    <Icon className="h-4.5 w-4.5" style={{ color: theme.accent }} aria-hidden="true" />
                  </span>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <h3 className="text-lg font-semibold text-[#2b303b]">{service.title}</h3>
                  <p className="mt-1 text-sm font-semibold" style={{ color: theme.accent }}>
                    {service.tagline}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-[#676b7a]">
                    {service.description}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] transition-all duration-200 group-hover:gap-2.5">
                    Learn how we help
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <style>{`
        .marquee-mask {
          -webkit-mask-image: linear-gradient(
            to right,
            transparent,
            black 5%,
            black 95%,
            transparent
          );
          mask-image: linear-gradient(
            to right,
            transparent,
            black 5%,
            black 95%,
            transparent
          );
        }
        .marquee-track {
          animation: marqueeScroll 60s linear infinite;
        }
        .marquee-mask:hover .marquee-track {
          animation-play-state: paused;
        }
        @keyframes marqueeScroll {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </section>
  );
}

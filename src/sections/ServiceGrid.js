import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";
import { SERVICES } from "@/data/services";

export default function ServiceGrid() {
  return (
    <section id="services-grid" className="relative overflow-hidden bg-[#fafbfc] py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            What We Build
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            End-to-end software services under one roof
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            From first idea to long-term support, our team covers every stage
            of building and running modern software.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((service) => {
            const Icon = service.icon;
            return (
              <div
                key={service.slug}
                className="group flex flex-col overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <Link href={`/services/${service.slug}`} className="relative block h-44 w-full overflow-hidden">
                  <Image
                    src={service.image}
                    alt={service.title}
                    fill
                    sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/20" />
                  <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm">
                    <Icon className="h-4.5 w-4.5 text-[#f7941e]" aria-hidden="true" />
                  </span>
                </Link>

                <div className="flex flex-1 flex-col p-5">
                  <Link href={`/services/${service.slug}`}>
                    <h3 className="text-lg font-semibold text-[#2b303b] transition-colors hover:text-[#f7941e]">
                      {service.title}
                    </h3>
                  </Link>
                  <p className="mt-1 text-sm font-semibold text-[#f7941e]">{service.tagline}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[#676b7a]">
                    {service.description}
                  </p>

                  <div className="mt-4 flex flex-1 flex-col justify-end gap-3">
                    <Link
                      href={`/services/${service.slug}`}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] transition-all duration-200 hover:gap-2.5"
                    >
                      Learn how we help
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>

                    <Link
                      href="/contact"
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f7941e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:bg-[#db7d17] hover:shadow-md hover:shadow-[#f7941e]/25"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      Get In Touch
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

// Structure referenced from a corporate site's inner-page banner: a thin
// gradient accent bar across the top, a breadcrumb, left-aligned headline
// (not centered), and an optional grid of clickable quick-link tiles on
// the right for pages where a handful of related links make sense. Falls
// back to the original centered layout when no breadcrumbLabel/quickLinks
// are passed, so every existing call site keeps working unchanged.
export default function PageHero({
  eyebrow,
  title,
  description,
  image,
  imageAlt,
  primaryCta,
  secondaryCta,
  breadcrumbLabel,
  quickLinks,
  size = "default",
}) {
  const structured = Boolean(breadcrumbLabel || quickLinks?.length);
  const isLarge = size === "lg";

  return (
    <section
      className={`relative flex overflow-hidden bg-[#171f2b] items-center ${
        isLarge
          ? "min-h-[60vh] py-16 lg:py-20"
          : structured
            ? "min-h-[46vh] py-16 lg:py-20"
            : "min-h-[54vh] py-16 sm:min-h-[58vh] lg:min-h-[62vh] lg:py-20"
      }`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-[1] h-[3px] bg-gradient-to-r from-[#f96706] via-[#ffb15c] to-[#3089a6]"
      />

      {image && (
        <div aria-hidden="true" className="absolute inset-0">
          <Image
            src={image}
            alt={imageAlt || ""}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-[#171f2b]/90 via-[#171f2b]/55 to-[#171f2b]/80" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#171f2b] via-transparent to-transparent" />
        </div>
      )}

      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-[#f96706] opacity-[0.12] blur-[110px]" />
        <div className="absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-[#1c2f4a] opacity-25 blur-[110px]" />
      </div>

      <div
        className={`relative mx-auto w-full px-6 lg:px-8 ${
          structured ? "max-w-7xl" : "max-w-5xl text-center"
        }`}
      >
        <div className={structured ? "grid items-center gap-10 lg:grid-cols-12" : ""}>
          <div className={structured ? "lg:col-span-7" : ""}>
            {breadcrumbLabel && (
              <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-white/55">
                <Link href="/" className="transition-colors hover:text-white">
                  Home
                </Link>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="text-white">{breadcrumbLabel}</span>
              </nav>
            )}

            {eyebrow && (
              <span
                className={`inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-[#f96706] ${
                  structured ? "mt-4" : ""
                }`}
              >
                <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
                {eyebrow}
                <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
              </span>
            )}

            <h1
              className={`mt-4 max-w-3xl text-3xl font-bold leading-tight text-white [text-shadow:0_2px_20px_rgba(0,0,0,0.5)] sm:text-4xl lg:text-5xl ${
                structured ? "" : "mx-auto"
              }`}
            >
              {title}
            </h1>

            {description && (
              <p
                className={`mt-6 max-w-2xl text-lg leading-8 text-white/85 [text-shadow:0_1px_12px_rgba(0,0,0,0.4)] sm:text-xl ${
                  structured ? "" : "mx-auto"
                }`}
              >
                {description}
              </p>
            )}

            {(primaryCta || secondaryCta) && (
              <div
                className={`mt-8 flex flex-wrap items-center gap-4 ${
                  structured ? "" : "justify-center"
                }`}
              >
                {primaryCta &&
                  (primaryCta.href.startsWith("#") ? (
                    <a
                      href={primaryCta.href}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] to-[#1c2f4a] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(31,70,147,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:brightness-110"
                    >
                      {primaryCta.label}
                    </a>
                  ) : (
                    <Link
                      href={primaryCta.href}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] to-[#1c2f4a] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(31,70,147,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:brightness-110"
                    >
                      {primaryCta.label}
                    </Link>
                  ))}
                {secondaryCta &&
                  (secondaryCta.href.startsWith("#") ? (
                    <a
                      href={secondaryCta.href}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/20"
                    >
                      {secondaryCta.label}
                    </a>
                  ) : (
                    <Link
                      href={secondaryCta.href}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/20"
                    >
                      {secondaryCta.label}
                    </Link>
                  ))}
              </div>
            )}
          </div>

          {quickLinks?.length > 0 && (
            <div className="hidden lg:col-span-5 lg:flex lg:items-center lg:justify-end">
              <div className="grid w-72 grid-cols-2 gap-3">
                {quickLinks.map(({ icon: Icon, label, href }) => (
                  <Link
                    key={label}
                    href={href}
                    className="group flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-center backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-white/30 hover:bg-white/10"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#f96706] to-[#3089a6] transition-transform duration-300 group-hover:scale-110">
                      <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                    </span>
                    <span className="text-[11px] font-semibold text-white/75 group-hover:text-white">
                      {label}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

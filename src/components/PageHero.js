import Image from "next/image";
import Link from "next/link";

export default function PageHero({
  eyebrow,
  title,
  description,
  image,
  imageAlt,
  primaryCta,
  secondaryCta,
}) {
  return (
    <section className="relative flex min-h-[54vh] items-center overflow-hidden bg-[#0b0e17] py-16 sm:min-h-[58vh] lg:min-h-[62vh] lg:py-20">
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
          <div className="absolute inset-0 bg-[#0b0e17]/35" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b0e17]/85 via-[#0b0e17]/25 to-transparent" />
        </div>
      )}

      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-[#f7941e] opacity-[0.12] blur-[110px]" />
        <div className="absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-[#1f4693] opacity-25 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-5xl px-6 text-center lg:px-8">
        {eyebrow && (
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            {eyebrow}
          </span>
        )}

        <h1 className="mx-auto mt-4 max-w-3xl text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
          {title}
        </h1>

        {description && (
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/80 sm:text-xl">
            {description}
          </p>
        )}

        {(primaryCta || secondaryCta) && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {primaryCta &&
              (primaryCta.href.startsWith("#") ? (
                <a
                  href={primaryCta.href}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(31,70,147,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:brightness-110"
                >
                  {primaryCta.label}
                </a>
              ) : (
                <Link
                  href={primaryCta.href}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(31,70,147,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:brightness-110"
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
    </section>
  );
}

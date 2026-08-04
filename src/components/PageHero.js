export default function PageHero({ eyebrow, title, description }) {
  return (
    <section className="relative overflow-hidden bg-[#0b0e17] py-16 lg:py-20">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-[#f7941e] opacity-[0.12] blur-[110px]" />
        <div className="absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-[#1f4693] opacity-25 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 text-center lg:px-8">
        {eyebrow && (
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            {eyebrow}
          </span>
        )}

        <h1 className="mx-auto mt-4 max-w-3xl text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
          {title}
        </h1>

        {description && (
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
            {description}
          </p>
        )}
      </div>
    </section>
  );
}

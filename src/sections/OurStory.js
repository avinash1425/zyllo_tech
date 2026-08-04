import Image from "next/image";

export default function OurStory() {
  return (
    <section className="relative overflow-hidden bg-white py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 -right-24 h-72 w-72 rounded-full bg-[#f7941e]/10 blur-[100px]" />
        <div className="absolute bottom-0 -left-24 h-72 w-72 rounded-full bg-[#1f4693]/10 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
              Our Story
            </span>

            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
              Started by engineers who were tired of broken promises
            </h2>

            <p className="mt-5 text-lg leading-relaxed text-[#676b7a]">
              Zyllo Tech began with a simple observation: too many software
              projects fail not because of bad code, but because of poor
              communication, unclear expectations, and teams that disappear
              after launch.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
              We set out to build something different — a team small enough
              to stay close to every project, and experienced enough to
              handle the full journey from idea to production and beyond.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
              Today, that same principle guides every engagement: fewer
              handoffs, clearer communication, and software built to last.
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 -z-10 rounded-[28px] bg-gradient-to-br from-[#1f4693]/15 to-[#f7941e]/15 blur-2xl" />
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/60 shadow-xl">
              <Image
                src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1000&q=80"
                alt="Zyllo Tech engineers planning a project"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

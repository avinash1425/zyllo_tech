import Image from "next/image";

export default function About() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-[#fff7ed]/40 to-white py-8 lg:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 -left-24 h-72 w-72 rounded-full bg-[#1f4693]/10 blur-[100px]" />
        <div className="absolute bottom-0 -right-24 h-72 w-72 rounded-full bg-[#f7941e]/10 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="relative order-2 lg:order-1">
            <div className="absolute -inset-4 -z-10 rounded-[28px] bg-gradient-to-br from-[#1f4693]/20 to-[#f7941e]/20 blur-2xl" />
            <div className="relative overflow-hidden rounded-[1.75rem] border border-white/60 bg-white/40 p-3 shadow-xl shadow-[#1f4693]/10 backdrop-blur-xl">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[1.25rem]">
                <Image
                  src="/globe.png"
                  alt="Holographic display of a global network with AI, cloud, and mobile technology icons"
                  fill
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <span className="text-sm font-bold tracking-[0.2em] text-[#1f4693] uppercase">
              About Us
            </span>

            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#0f172a] sm:text-4xl">
              Who We Are
            </h2>

            <p className="mt-5 text-lg leading-relaxed text-[#475569]">
              Zyllo Tech is a software development company delivering
              innovative web, mobile, AI, and cloud solutions. We partner
              with startups, growing businesses, and enterprises to build
              scalable digital products that create lasting business value.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

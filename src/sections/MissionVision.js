import { Compass, Telescope } from "lucide-react";

export default function MissionVision() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-10 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 left-1/3 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-20 right-1/3 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/60 bg-white/60 p-8 shadow-sm backdrop-blur-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15">
              <Compass className="h-6 w-6 text-[#f7941e]" aria-hidden="true" />
            </div>
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-[#2b303b]">
              Our Mission
            </h2>
            <p className="mt-3 text-lg leading-relaxed text-[#676b7a]">
              To build reliable, well-engineered software and stay
              accountable to the businesses we work with — from the first
              conversation through the life of the product.
            </p>
          </div>

          <div className="rounded-2xl border border-white/60 bg-white/60 p-8 shadow-sm backdrop-blur-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#1f4693]/15 to-[#f7941e]/15">
              <Telescope className="h-6 w-6 text-[#1f4693]" aria-hidden="true" />
            </div>
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-[#2b303b]">
              Our Vision
            </h2>
            <p className="mt-3 text-lg leading-relaxed text-[#676b7a]">
              To be the technology partner businesses trust with their most
              important ideas, known for thoughtful engineering and
              long-term relationships rather than one-off projects.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

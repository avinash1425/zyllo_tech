import { CompatImage as Image } from "@/components/NextCompat";

const MOMENTS = [
  {
    image: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=700&q=80",
    title: "Collaborative by default",
    description: "Open discussions, shared whiteboards, and no silos between design and engineering.",
  },
  {
    image: "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=700&q=80",
    title: "Focused deep work",
    description: "Flexible hours built around getting meaningful work done, not watching the clock.",
  },
  {
    image: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=700&q=80",
    title: "Time to recharge",
    description: "Regular team breaks and a culture that treats rest as part of doing good work.",
  },
];

export default function LifeAtZyllo() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Life at Zyllo Tech
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            What a day here actually looks like
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Less about the ping-pong table, more about how the team actually
            works together day to day.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {MOMENTS.map((moment) => (
            <div
              key={moment.title}
              className="group overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="relative h-48 w-full overflow-hidden">
                <Image
                  src={moment.image}
                  alt={moment.title}
                  fill
                  sizes="(min-width: 640px) 33vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-5">
                <h3 className="text-base font-semibold text-[#2b303b]">{moment.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#676b7a]">
                  {moment.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

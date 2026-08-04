const STATS = [
  { value: "10+", label: "Years of Excellence" },
  { value: "150+", label: "Projects Delivered" },
  { value: "60+", label: "Clients Served" },
  { value: "98%", label: "Client Satisfaction" },
];

export default function Stats() {
  return (
    <section className="relative overflow-hidden bg-[#0b0e17] py-12 lg:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-64 w-64 rounded-full bg-[#f7941e] opacity-[0.08] blur-[100px]" />
        <div className="absolute -bottom-24 right-1/4 h-64 w-64 rounded-full bg-[#1f4693] opacity-20 blur-[100px]" />
      </div>

      <div className="relative mx-auto grid max-w-7xl grid-cols-2 divide-x divide-y divide-white/10 px-6 lg:grid-cols-4 lg:divide-y-0 lg:px-8">
        {STATS.map((stat) => (
          <div key={stat.label} className="px-4 py-4 text-center lg:py-0">
            <p className="text-3xl font-bold text-white sm:text-4xl">
              {stat.value}
            </p>
            <p className="mt-1.5 text-sm font-medium text-white/60">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

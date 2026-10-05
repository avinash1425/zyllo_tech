const RESULTS = [
  { value: "40+", label: "Projects delivered" },
  { value: "14", label: "Industries served" },
  { value: "6", label: "Years building software" },
  { value: "98%", label: "Client retention" },
];

export default function ResultsStrip() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#0b0e17] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#f7941e] opacity-[0.1] blur-[110px]" />
        <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-[#1f4693] opacity-25 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {RESULTS.map(({ value, label }) => (
            <div key={label} className="text-center">
              <p className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
                {value}
              </p>
              <p className="mt-2 text-sm font-medium text-white/60">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

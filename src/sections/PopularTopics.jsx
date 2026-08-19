const TOPICS = [
  "Web Development",
  "Mobile Apps",
  "AI & Machine Learning",
  "Cloud Architecture",
  "UI/UX Design",
  "Cybersecurity",
  "DevOps",
  "Product Strategy",
  "API Design",
  "Startups",
  "Performance",
  "Team Culture",
];

export default function PopularTopics() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/3 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
        <div className="absolute -bottom-24 right-1/3 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Popular Topics
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            What people are reading about
          </h2>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {TOPICS.map((topic) => (
            <span
              key={topic}
              className="cursor-pointer rounded-full border border-white/60 bg-white/60 px-4 py-2 text-sm font-medium text-[#2b303b] shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-[#f7941e]/40 hover:text-[#f7941e] hover:shadow-md"
            >
              {topic}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

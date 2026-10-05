const TEAM = [
  {
    name: "Arjun Rao",
    role: "Founder & CEO",
    focus: "Product strategy, client partnerships",
    initials: "AR",
  },
  {
    name: "Meera Nair",
    role: "Head of Design",
    focus: "UI/UX, design systems",
    initials: "MN",
  },
  {
    name: "Karthik Iyer",
    role: "Engineering Lead",
    focus: "Architecture, cloud infrastructure",
    initials: "KI",
  },
  {
    name: "Ananya Iyer",
    role: "Head of Delivery",
    focus: "Project execution, client success",
    initials: "AI",
  },
];

export default function Leadership() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/3 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 right-1/3 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Leadership
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            The people steering the work
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            A small leadership team that stays close to every engagement,
            not buried in layers of management.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TEAM.map(({ name, role, focus, initials }) => (
            <div
              key={name}
              className="group relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#1f4693]/[0.03] p-6 text-center shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-xl hover:shadow-[#1f4693]/10"
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-50 bg-gradient-to-r from-[#f7941e] to-[#1f4693] opacity-40 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
              />
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/70 bg-gradient-to-br from-[#f7941e]/20 to-[#1f4693]/20 text-lg font-bold text-[#1f4693] shadow-md shadow-[#1f4693]/10 transition-transform duration-300 group-hover:scale-110">
                {initials}
              </div>
              <h3 className="mt-4 text-base font-semibold text-[#2b303b]">{name}</h3>
              <p className="mt-1 text-sm font-medium text-[#f7941e]">{role}</p>
              <p className="mt-2 text-sm leading-relaxed text-[#676b7a]">{focus}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

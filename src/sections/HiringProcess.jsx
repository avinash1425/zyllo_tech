import { FileText, MessagesSquare, Code2, Handshake } from "lucide-react";

const STEPS = [
  {
    icon: FileText,
    title: "Apply",
    description: "Send your resume and a short note on what you're looking for.",
  },
  {
    icon: MessagesSquare,
    title: "Intro call",
    description: "A relaxed conversation about your experience and what we're building.",
  },
  {
    icon: Code2,
    title: "Skills round",
    description: "A practical exercise relevant to the role — no trick questions.",
  },
  {
    icon: Handshake,
    title: "Offer",
    description: "If it's a fit on both sides, we move fast to get you started.",
  },
];

export default function HiringProcess() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#f7941e]/5 to-[#1f4693]/5 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Our Hiring Process
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Simple, fast, and respectful of your time
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            No five-round marathons. Most candidates hear back within a
            week of applying.
          </p>
        </div>

        <div className="relative mt-10">
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-[#e7e9ee] to-transparent lg:block"
          />
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {STEPS.map(({ icon: Icon, title, description }, index) => (
              <div key={title} className="relative flex flex-col items-center text-center">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-[#f7941e]/30 bg-white shadow-sm transition-transform duration-300 hover:scale-110">
                  <Icon className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
                </div>
                <span className="mt-4 text-xs font-bold tracking-widest text-[#2b303b]/30">
                  STEP 0{index + 1}
                </span>
                <h3 className="mt-1.5 text-lg font-semibold text-[#2b303b]">{title}</h3>
                <p className="mt-2 max-w-[220px] text-sm leading-relaxed text-[#676b7a]">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

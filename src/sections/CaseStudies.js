import Image from "next/image";
import { CircleDot, Lightbulb, TrendingUp } from "lucide-react";

const CASES = [
  {
    tag: "E-commerce & Retail",
    title: "Bringing inventory and orders into one system",
    challenge:
      "A growing retail brand was managing inventory across spreadsheets and disconnected tools, causing stock errors and delayed shipments.",
    solution:
      "We built a unified platform connecting their storefront, warehouse, and courier partners into one real-time system.",
    result:
      "Order processing became faster and more accurate, with stock discrepancies largely eliminated.",
    image: "https://images.unsplash.com/photo-1553413077-190dd305871c?w=900&q=80",
  },
  {
    tag: "Healthcare",
    title: "Launching a compliant telehealth platform",
    challenge:
      "An early-stage healthcare startup needed a HIPAA-aligned telehealth platform but had no in-house engineering team.",
    solution:
      "We scoped, designed, and built the full platform — video consultations, scheduling, and secure records — as their embedded technical team.",
    result:
      "The platform launched on schedule and passed its compliance review on the first attempt.",
    image: "https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=900&q=80",
  },
  {
    tag: "Finance & Fintech",
    title: "Modernizing a legacy transaction system",
    challenge:
      "A fintech company was running critical transaction processing on an aging system that was difficult to scale and audit.",
    solution:
      "We re-architected the core system incrementally, adding monitoring and audit trails without disrupting live operations.",
    result:
      "The platform now handles higher transaction volume with clear visibility into every step.",
    image: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=900&q=80",
  },
  {
    tag: "Manufacturing",
    title: "Connecting the shop floor to the front office",
    challenge:
      "A manufacturer's production data lived in isolated machines and paper logs, disconnected from planning and sales teams.",
    solution:
      "We built an operational dashboard that pulled real-time data from the factory floor into a single reporting layer.",
    result:
      "Leadership gained real-time visibility into production, reducing planning delays across teams.",
    image: "https://images.unsplash.com/photo-1565043666747-69f6646db940?w=900&q=80",
  },
];

const FLOW = [
  { key: "challenge", label: "Challenge", icon: CircleDot },
  { key: "solution", label: "Solution", icon: Lightbulb },
  { key: "result", label: "Result", icon: TrendingUp },
];

export default function CaseStudies() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Case Studies
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            A closer look at how we work
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Sample engagements across the industries we work with, illustrating
            the kind of problems we solve and how we approach them.
          </p>
        </div>

        <div className="mt-10 flex flex-col gap-14 lg:gap-20">
          {CASES.map((item, index) => {
            const imageFirst = index % 2 === 1;
            return (
              <div
                key={item.title}
                className={`flex flex-col items-center gap-8 lg:items-stretch lg:gap-14 ${
                  imageFirst ? "lg:flex-row-reverse" : "lg:flex-row"
                }`}
              >
                <div className="relative w-full shrink-0 lg:w-[42%]">
                  <div
                    aria-hidden="true"
                    className="absolute -inset-3 -z-10 rounded-[28px] bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15 blur-xl"
                  />
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/60 shadow-xl">
                    <Image
                      src={item.image}
                      alt={item.tag}
                      fill
                      sizes="(min-width: 1024px) 42vw, 100vw"
                      className="object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                    <span className="absolute bottom-4 left-4 inline-flex items-center rounded-full bg-white/90 px-3.5 py-1.5 text-xs font-bold tracking-[0.15em] text-[#f7941e] uppercase backdrop-blur-sm">
                      {item.tag}
                    </span>
                  </div>
                </div>

                <div className="flex-1">
                  <h3 className="text-2xl font-bold tracking-tight text-[#2b303b] sm:text-3xl">
                    {item.title}
                  </h3>

                  <div className="mt-6 flex flex-col gap-0">
                    {FLOW.map(({ key, label, icon: Icon }, stepIndex) => (
                      <div key={key} className="relative flex gap-4 pb-6 last:pb-0">
                        {stepIndex < FLOW.length - 1 && (
                          <span
                            aria-hidden="true"
                            className="absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-px bg-gradient-to-b from-[#e7e9ee] to-transparent"
                          />
                        )}
                        <span
                          className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border shadow-sm ${
                            key === "result"
                              ? "border-[#f7941e]/30 bg-gradient-to-br from-[#f7941e]/15 to-[#db7d17]/15"
                              : "border-white/70 bg-gradient-to-br from-[#f7941e]/10 to-[#1f4693]/10"
                          }`}
                        >
                          <Icon
                            className={`h-4.5 w-4.5 ${key === "result" ? "text-[#f7941e]" : "text-[#1f4693]"}`}
                            aria-hidden="true"
                          />
                        </span>
                        <div className="pt-1.5">
                          <p
                            className={`text-xs font-bold uppercase tracking-wide ${
                              key === "result" ? "text-[#f7941e]" : "text-[#2b303b]/40"
                            }`}
                          >
                            {label}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-[#676b7a]">
                            {item[key]}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

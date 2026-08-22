import { CompatImage as Image } from "@/components/NextCompat";
import { CompatLink as Link } from "@/components/NextCompat";
import { ArrowRight, CircleDot, Lightbulb, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAsyncData } from "@/lib/useAsyncData";
import { fallbackProjects } from "@/data/fallback-content";

async function getCaseStudies() {
  const { data, error } = await supabase
    .from("portfolio_projects")
    .select("id, title, tag, image_url, challenge, solution, result")
    .eq("status", "published")
    .not("challenge", "is", null)
    .not("solution", "is", null)
    .not("result", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load case studies:", error.message);
    return fallbackProjects.slice(0, 3);
  }

  return data && data.length > 0 ? data : fallbackProjects.slice(0, 3);
}

const FLOW = [
  { key: "challenge", label: "Challenge", icon: CircleDot },
  { key: "solution", label: "Solution", icon: Lightbulb },
  { key: "result", label: "Result", icon: TrendingUp },
];

export default function CaseStudies() {
  const cases = useAsyncData(getCaseStudies, fallbackProjects.slice(0, 3));

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

        {cases.length === 0 ? (
          <div className="mx-auto mt-8 flex max-w-lg flex-col items-center rounded-2xl border border-[#e7e9ee] bg-[#fafbfc] p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15">
              <Lightbulb className="h-5.5 w-5.5 text-[#f7941e]" aria-hidden="true" />
            </span>
            <p className="mt-4 text-base text-[#676b7a]">
              We&apos;re documenting detailed case studies from recent
              engagements — check back soon, or ask us directly about a
              project similar to yours.
            </p>
            <Link
              href="/contact"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#f7941e] transition-colors duration-200 hover:text-[#db7d17]"
            >
              Get in touch
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        ) : (
        <div className="mt-10 flex flex-col gap-14 lg:gap-20">
          {cases.map((item, index) => {
            const imageFirst = index % 2 === 1;
            return (
              <div
                key={item.id}
                className={`flex flex-col items-center gap-8 lg:items-stretch lg:gap-14 ${
                  imageFirst ? "lg:flex-row-reverse" : "lg:flex-row"
                }`}
              >
                <div className="relative w-full shrink-0 lg:w-[42%]">
                  <div
                    aria-hidden="true"
                    className="absolute -inset-3 -z-10 rounded-[28px] bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15 blur-xl"
                  />
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/60 bg-[#f5f6f8] shadow-xl">
                    {item.image_url && (
                      <Image
                        src={item.image_url}
                        alt={item.tag}
                        fill
                        sizes="(min-width: 1024px) 42vw, 100vw"
                        className="object-cover"
                      />
                    )}
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
        )}
      </div>
    </section>
  );
}

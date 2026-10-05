import { ArrowDown } from "lucide-react";
import Seo from "@/components/Seo";
import WhyJoinZyllo from "@/sections/WhyJoinZyllo";
import OpenPositions from "@/sections/OpenPositions";

function scrollToOpenings(event) {
  const target = document.getElementById("open-positions");
  if (!target) return;
  event.preventDefault();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

export default function CareersPage() {
  return (
    <>
      <Seo
        title="Careers"
        description="Join the team building software at Zyllo Tech. Explore open roles and the benefits of working with us."
        path="/careers"
      />

      <section className="relative overflow-hidden bg-gradient-to-b from-[#fff4e8] via-[#f6f8fc] to-white px-6 pb-14 pt-16 text-center sm:pt-20 lg:pb-16 lg:pt-24">
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-[#f7941e]/15 blur-[100px]" />
        <div className="relative mx-auto max-w-3xl">
          <span className="inline-flex items-center rounded-full bg-[#1f4693] px-4 py-1.5 text-sm font-semibold text-white">
            Join Our Team
          </span>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-[#173a52] sm:text-5xl lg:text-6xl">
            Build Your Career With Zyllo Tech
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[#4a5668] sm:text-lg">
            Join a team that values innovation, collaboration, and continuous learning while building technology
            that makes an impact.
          </p>
          <a
            href="#open-positions"
            onClick={scrollToOpenings}
            className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] to-[#f7941e] px-8 py-3 text-base font-bold text-white shadow-lg shadow-[#f7941e]/30 transition-all hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40"
          >
            View Open Roles
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </section>

      <WhyJoinZyllo />
      <OpenPositions />
    </>
  );
}

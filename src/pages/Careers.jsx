import { ArrowDown, ArrowRight, Sparkles } from "lucide-react";
import Link from "@/lib/nx/link";
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

      <section className="relative isolate overflow-hidden bg-gradient-to-br from-[#0b1230] via-[#101a3a] to-[#173a52] px-6 pb-10 pt-10 text-center sm:pb-12 sm:pt-12">
        {/* Depth: colored glows + faint dot grid + infinity-mark watermark (all decorative) */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-24 -top-24 h-[26rem] w-[26rem] rounded-full bg-[#f7941e]/25 blur-[110px]" />
          <div className="absolute -bottom-32 -right-20 h-[28rem] w-[28rem] rounded-full bg-[#3089a6]/30 blur-[120px]" />
          <div className="absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-[#1f4693]/40 blur-[110px]" />
          <div className="absolute inset-0 opacity-[0.35] [background-image:radial-gradient(rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_75%)]" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#f7941e]/70 to-transparent" />
        </div>

        <div className="relative mx-auto max-w-4xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[15px] font-semibold text-white backdrop-blur-[6px]">
            <Sparkles className="h-4 w-4 text-[#ffb15c]" aria-hidden="true" />
            Join Our Team
          </span>
          <h1 className="mt-4 text-3xl font-extrabold leading-[1.15] tracking-tight text-white [text-wrap:balance] sm:text-4xl lg:text-5xl">
            Build Your{" "}
            <span className="bg-gradient-to-r from-[#ffb15c] via-[#f96706] to-[#3089a6] bg-clip-text text-transparent">
              Career
            </span>{" "}
            With Zyllo Tech
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-white/80 sm:text-base">
            Join a team that values innovation, collaboration, and continuous learning while building technology
            that makes an impact.
          </p>

          <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <a
              href="#open-positions"
              onClick={scrollToOpenings}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] to-[#f7941e] px-7 py-2.5 text-[15px] font-bold text-white shadow-[0_12px_30px_-8px_rgba(249,103,6,0.65)] transition-all hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/50"
            >
              View Open Roles
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </a>
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-7 py-2.5 text-[15px] font-semibold text-white backdrop-blur-[6px] transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40"
            >
              Send your resume
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <WhyJoinZyllo />
      <OpenPositions />
    </>
  );
}

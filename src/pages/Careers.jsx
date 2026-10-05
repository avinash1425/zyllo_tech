import { BookOpen, Globe2, Handshake, Lightbulb } from "lucide-react";
import Seo from "@/components/Seo";
import PageHero from "@/components/PageHero";
import WhyJoinZyllo from "@/sections/WhyJoinZyllo";
import OpenPositions from "@/sections/OpenPositions";
import Reveal from "@/components/Reveal";

const PERKS = [
  { icon: Globe2, label: "Remote-friendly", text: "Flexible ways of working" },
  { icon: BookOpen, label: "Learning budget", text: "Grow your skills with us" },
  { icon: Lightbulb, label: "Real ownership", text: "Your work makes an impact" },
  { icon: Handshake, label: "Supportive team", text: "Collaborative, inclusive culture" },
];

// Smoothly scroll to #open-positions (instant when the user prefers reduced motion).
function handleHeroClick(event) {
  const link = event.target.closest?.('a[href="#open-positions"]');
  if (!link) return;
  const target = document.getElementById("open-positions");
  if (!target) return;
  event.preventDefault();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

export default function CareersPage() {
  return (
    <>
      <Seo
        title="Careers"
        description="Join the team building software at Zyllo Tech. Explore open roles, life at the company, and the benefits of working with us."
        path="/careers"
      />
      <div onClick={handleHeroClick}>
        <PageHero
          breadcrumbLabel="Careers"
          eyebrow="Careers"
          title="Grow Your Career with Zyllo Tech"
          description="Join a team that values innovation, collaboration, and continuous learning while building technology that makes an impact."
          image="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1920&q=80"
          imageAlt="Team collaborating in a workshop session"
          primaryCta={{ label: "View Open Roles", href: "#open-positions" }}
          secondaryCta={{ label: "Send your resume", href: "/contact" }}
        />
      </div>

      <section aria-label="Perks at Zyllo Tech" className="relative z-[1] -mt-8 px-6 lg:px-8">
        <ul className="mx-auto grid max-w-7xl grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[#e7e9ee] bg-[#e7e9ee] shadow-xl shadow-[#101a3a]/10 sm:grid-cols-2 lg:grid-cols-4">
          {PERKS.map(({ icon: Icon, label, text }) => (
            <li key={label} className="flex items-center gap-3.5 bg-white px-5 py-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f96706] to-[#ffb15c] text-white shadow-md shadow-[#f7941e]/30">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#2b303b]">{label}</p>
                <p className="text-xs text-[#676b7a]">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Reveal>
        <WhyJoinZyllo />
      </Reveal>
      <Reveal>
        <OpenPositions />
      </Reveal>
    </>
  );
}

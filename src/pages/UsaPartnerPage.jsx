import { CompatLink as Link } from "@/components/NextCompat";
import { GitBranch, Globe, MessageSquare, Receipt, ShieldCheck } from "lucide-react";
import SEOHead, { breadcrumbSchema, faqSchema, serviceSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import ContactCTA from "@/sections/ContactCTA";

// Landing page for US-startup offshore-development intent. Content rules:
// honest process promises only — no invented clients, rates, or guarantees.
const FAQS = [
  {
    q: "Do you work with US contracts and NDAs?",
    a: "Yes. We sign US-style contracts with full IP assignment to you, and an NDA on request before any detailed discussion. The written phased scope forms part of the agreement, so what you're buying is on paper before work starts.",
  },
  {
    q: "What US time coverage do you offer?",
    a: "4+ hours of daily overlap with US East Coast. Morning-ET standups are possible, and demos and calls are scheduled in your timezone. Outside overlap, a written-first async process keeps decisions moving.",
  },
  {
    q: "Who owns the code?",
    a: "You do, from day one. Every commit lands in your repository, and contracts assign all work product and IP to you — there is no handover moment where you have to negotiate for your own codebase.",
  },
  {
    q: "How do you keep quality high across the distance?",
    a: "Weekly demos of working software, code review on every change, and CI pipelines that run tests before merge. You judge progress by what runs, not by status reports.",
  },
  {
    q: "How fast can we start, and how long does a build take?",
    a: "We respond within one business day, and after a discovery call you get a written phased scope. A first production version typically takes 8–16 weeks; dedicated-team developers typically start within 1–2 weeks of scope agreement.",
  },
  {
    q: "How does pricing work?",
    a: "Senior engineering at India economics — fixed quotes for defined builds, monthly rates for dedicated teams. We don't publish rate cards because they depend on team composition, but every engagement starts with a written estimate; ask and we'll give you numbers in the first call.",
  },
];

const CONCERNS = [
  {
    icon: MessageSquare,
    concern: "Communication gaps",
    answer:
      "English-first, written-first process: scopes, decisions, and updates in writing, plus 4+ hours of live East Coast overlap every day for standups and calls.",
  },
  {
    icon: ShieldCheck,
    concern: "Quality you can't see",
    answer:
      "Weekly demos of working software and code review plus CI on every change — you watch the product take shape instead of trusting a report.",
  },
  {
    icon: GitBranch,
    concern: "Vendor lock-in",
    answer:
      "Your repository from the first commit, IP assigned to you, and a written scope that includes an easy exit. Walking away is always technically and contractually simple.",
  },
  {
    icon: Receipt,
    concern: "Hidden costs",
    answer:
      "Written phased estimates before work starts — never a single opaque number, and changes go through written scope revisions, not surprise invoices.",
  },
];

export default function UsaPartnerPage() {
  return (
    <>
      <SEOHead
        title="Offshore Software Development for US Companies | Zyllo Tech"
        description="Zyllo Tech is an India-based software development partner for US startups — 4+ hours of East Coast overlap, US-style contracts with IP assignment, weekly demos in your timezone, and senior engineering at India economics."
        canonical="/software-development-company-usa"
        structuredData={[
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Software Development for US Companies", url: `${SITE_URL}/software-development-company-usa` },
          ]),
          serviceSchema({
            name: "Software Development for US Companies",
            description:
              "Offshore software development for US startups and businesses — web, mobile, AI, and cloud engineering from India with East Coast overlap, US-style contracts, and weekly demos.",
            url: `${SITE_URL}/software-development-company-usa`,
          }),
          faqSchema(FAQS),
        ]}
      />
      <PageHero
        eyebrow="For US Companies"
        title="Software Development Partner for US Companies"
        description="Senior engineering from India with real East Coast overlap, US-style contracts, and weekly demos in your timezone."
        primaryCta={{ label: "Get a Free Estimate", href: "/contact" }}
        secondaryCta={{ label: "Explore Services", href: "/services" }}
      />

      <section className="bg-white py-12 lg:py-16">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            Why US startups work with India-based teams
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#2b303b]">
            The math is straightforward: senior engineering talent at India economics lets a
            US startup fund a full team — frontend, backend, QA, DevOps — for what a partial
            team costs domestically. India's engineering depth means that trade-off doesn't
            have to cost you seniority. What actually separates good offshore engagements
            from bad ones isn't the talent; it's the working model.
          </p>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            How Zyllo makes it work
          </h2>
          <div className="mt-6 flex flex-col gap-4 rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-6 sm:flex-row sm:gap-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-[#fed7aa]">
              <Globe className="h-6 w-6 text-[#f96706]" aria-hidden="true" />
            </span>
            <ul className="list-disc space-y-2 pl-5 text-base leading-relaxed text-[#2b303b] marker:text-[#f96706]">
              <li>4+ hours of daily overlap with US East Coast — morning-ET standups are possible.</li>
              <li>Written-first async process, so work continues cleanly outside overlap hours.</li>
              <li>US-style contracts with full IP assignment and NDA on request.</li>
              <li>Weekly demos of working software, scheduled in your timezone.</li>
              <li>Your code in your repository from the first commit.</li>
            </ul>
          </div>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            The usual offshore concerns — and our answers
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {CONCERNS.map(({ icon: Icon, concern, answer }) => (
              <div
                key={concern}
                className="rounded-xl border border-[#e7e9ee] bg-white p-6 transition-all duration-300 hover:border-[#f96706]/30 hover:shadow-lg hover:shadow-[#1c2f4a]/5"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#fff7ed]">
                  <Icon className="h-5 w-5 text-[#f96706]" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-[#1d2735]">{concern}</h3>
                <p className="mt-2 text-base leading-relaxed text-[#54607a]">{answer}</p>
              </div>
            ))}
          </div>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            What we build for US clients
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#2b303b]">
            Full-stack product engineering:{" "}
            <Link href="/services/web-development" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              web applications
            </Link>
            ,{" "}
            <Link href="/services/mobile-app-development" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              mobile apps
            </Link>
            ,{" "}
            <Link href="/services/ai-solutions" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              AI and LLM solutions
            </Link>
            , and{" "}
            <Link href="/services/cloud-solutions" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              cloud and DevOps
            </Link>
            . Engage us on a fixed scope, as a{" "}
            <Link href="/hire-dedicated-developers" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              dedicated team
            </Link>
            , or through staff augmentation — the{" "}
            <Link href="/engagement-models" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              engagement models comparison
            </Link>{" "}
            explains when each fits.
          </p>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            Common questions
          </h2>
          <div className="mt-6 flex flex-col gap-5">
            {FAQS.map((faq) => (
              <div key={faq.q} className="rounded-xl border border-[#e7e9ee] bg-white p-6">
                <h3 className="text-base font-semibold text-[#1d2735]">{faq.q}</h3>
                <p className="mt-2 text-base leading-relaxed text-[#54607a]">{faq.a}</p>
              </div>
            ))}
          </div>

          <p className="mt-10 text-base leading-relaxed text-[#54607a]">
            Based in the UK or EU instead? See{" "}
            <Link href="/software-development-company-europe" className="font-medium text-[#1d2735] underline underline-offset-4">
              software development for European companies
            </Link>
            . Ready to talk?{" "}
            <Link href="/contact" className="font-medium text-[#1d2735] underline underline-offset-4">
              Contact us
            </Link>{" "}
            — we respond within one business day.
          </p>
        </div>
      </section>

      <ContactCTA />
    </>
  );
}

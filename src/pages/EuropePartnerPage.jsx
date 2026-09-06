import { CompatLink as Link } from "@/components/NextCompat";
import SEOHead, { breadcrumbSchema, faqSchema, serviceSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import ContactCTA from "@/sections/ContactCTA";

// Landing page for UK/EU offshore-development intent. Content rules: honest
// process promises only — GDPR-conscious, plainly not ISO-certified.
const FAQS = [
  {
    q: "What UK/EU time coverage do you offer?",
    a: "Full business-hours overlap. India Standard Time is only 3.5–4.5 hours ahead of Central European Time, so your entire working day overlaps with ours — standups, demos, and calls all happen live in your timezone.",
  },
  {
    q: "How do you handle GDPR?",
    a: "We build GDPR-conscious data flows — data minimisation, consent handling, deletion paths — and sign Data Processing Agreements (DPAs). We are not ISO-certified yet and say so plainly; what you get is engineering that takes data protection seriously and contracts that put it in writing.",
  },
  {
    q: "Do you sign contracts, NDAs, and DPAs?",
    a: "Yes. Written phased scope as part of the agreement, full IP assignment to you, NDA on request, and a DPA where you handle personal data of EU/UK residents.",
  },
  {
    q: "Who owns the code and where does it live?",
    a: "You own it, and it lives in your repository from the first commit. There is no handover negotiation and no lock-in — the written scope includes an easy exit.",
  },
  {
    q: "How is quality maintained remotely?",
    a: "Weekly demos of working software in your business hours, code review on every change, and CI pipelines that run tests before merge. You evaluate running software, not status reports.",
  },
  {
    q: "How fast can we start, and what does it cost?",
    a: "We respond within one business day; a first production version typically takes 8–16 weeks. Pricing is senior engineering at India economics — exact rates depend on team composition, so every engagement starts with a written estimate. Ask and we'll give you numbers in the first call.",
  },
];

export default function EuropePartnerPage() {
  return (
    <>
      <SEOHead
        title="Software Development for UK & European Companies | Zyllo Tech"
        description="Zyllo Tech is an India-based software development partner for UK and EU companies — full business-hours overlap with CET, GDPR-aware engineering with DPAs, English-first written process, and weekly demos."
        canonical="/software-development-company-europe"
        structuredData={[
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Software Development for European Companies", url: `${SITE_URL}/software-development-company-europe` },
          ]),
          serviceSchema({
            name: "Software Development for UK & European Companies",
            description:
              "Offshore software development for UK and EU businesses — web, mobile, AI, and cloud engineering from India with full business-hours overlap, GDPR-aware data flows, and weekly demos.",
            url: `${SITE_URL}/software-development-company-europe`,
          }),
          faqSchema(FAQS),
        ]}
      />
      <PageHero
        eyebrow="For UK & EU Companies"
        title="Software Development Partner for European Companies"
        description="Senior engineering from India with full UK/EU business-hours overlap, GDPR-aware delivery, and weekly demos."
      />

      <section className="bg-white py-12 lg:py-16">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            Why UK and EU companies work with India-based teams
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#2b303b]">
            The economics are the obvious draw: senior engineers at India economics fund a
            full product team for the cost of a partial one at European rates. What is less
            obvious is how well the geography works — IST is only 3.5–4.5 hours ahead of
            CET, so unlike US-facing offshore work there is no timezone squeeze at all. Your
            entire business day overlaps with ours.
          </p>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            How Zyllo makes it work
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-relaxed text-[#2b303b]">
            <li>Full UK/EU business-hours overlap — live standups, pairing, and calls all day.</li>
            <li>English-first written process: scopes, decisions, and estimates in writing before work starts.</li>
            <li>GDPR-aware engineering — see below for exactly what we do and don't claim.</li>
            <li>Weekly demos of working software in your business hours.</li>
            <li>Your code in your repository from the first commit, with IP assigned to you.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            GDPR-aware engineering, stated honestly
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#2b303b]">
            We build GDPR-conscious data flows — data minimisation by default, consent
            capture, export and deletion paths, and access controls — and we sign Data
            Processing Agreements. We are not ISO-certified yet, and we say so plainly
            rather than implying otherwise. If your procurement process requires a specific
            certification, tell us early and we'll tell you honestly whether we're the
            right fit today.
          </p>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            What we build for European clients
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
            ,{" "}
            <Link href="/services/cloud-solutions" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              cloud and DevOps
            </Link>
            , and{" "}
            <Link href="/services/cybersecurity-engineering" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              cybersecurity engineering
            </Link>
            . Work with us on a fixed scope, as a{" "}
            <Link href="/hire-dedicated-developers" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              dedicated team
            </Link>
            , or via staff augmentation — compare the three on our{" "}
            <Link href="/engagement-models" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              engagement models
            </Link>{" "}
            page.
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
            Based in the US instead? See{" "}
            <Link href="/software-development-company-usa" className="font-medium text-[#1d2735] underline underline-offset-4">
              software development for US companies
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

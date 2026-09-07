import { CompatLink as Link } from "@/components/NextCompat";
import { CalendarCheck, GitBranch, Globe, Lock, MessageSquare, ShieldCheck } from "lucide-react";
import SEOHead, { breadcrumbSchema, faqSchema, serviceSchema, SITE_URL } from "@/components/SEOHead";
import { PAGE_FAQS } from "@/data/page-faqs";
import PageHero from "@/components/PageHero";
import FaqSection from "@/components/FaqSection";
import ContactCTA from "@/sections/ContactCTA";

// Landing page for UK/EU offshore-development intent. Content rules: honest
// process promises only — GDPR-conscious, plainly not ISO-certified.
const FAQS = PAGE_FAQS["/software-development-company-europe"];

export default function EuropePartnerPage() {
  return (
    <>
      <SEOHead
        title="Software Development for UK & EU Companies | Zyllo Tech"
        description="India-based software development partner for UK and EU companies: full CET business-hours overlap, GDPR-aware engineering with DPAs, weekly demos."
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
        primaryCta={{ label: "Get a Free Estimate", href: "/contact" }}
        secondaryCta={{ label: "Explore Services", href: "/services" }}
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
            How we work with UK and EU teams
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {[
              {
                icon: Globe,
                lead: "Full UK/EU business-hours overlap",
                rest: " — live standups, pairing, and calls all day.",
              },
              {
                icon: MessageSquare,
                lead: "English-first written process",
                rest: ": scopes, decisions, and estimates in writing before work starts.",
              },
              {
                icon: Lock,
                lead: "GDPR-aware engineering",
                rest: " — see below for exactly what we do and don't claim.",
              },
              {
                icon: CalendarCheck,
                lead: "Weekly demos",
                rest: " of working software in your business hours.",
              },
              {
                icon: GitBranch,
                lead: "Your code in your repository",
                rest: " from the first commit, with IP assigned to you.",
              },
            ].map(({ icon: Icon, lead, rest }) => (
              <div
                key={lead}
                className="rounded-xl border border-[#e7e9ee] bg-white p-6 transition-all duration-300 hover:border-[#f96706]/30 hover:shadow-lg hover:shadow-[#1c2f4a]/5"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#fff7ed]">
                  <Icon className="h-5 w-5 text-[#f96706]" aria-hidden="true" />
                </span>
                <p className="mt-4 text-base leading-relaxed">
                  <span className="font-semibold text-[#1d2735]">{lead}</span>
                  <span className="text-[#54607a]">{rest}</span>
                </p>
              </div>
            ))}
          </div>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            GDPR-aware engineering, stated honestly
          </h2>
          <div className="mt-6 flex flex-col gap-4 rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-6 sm:flex-row sm:gap-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-[#fed7aa]">
              <ShieldCheck className="h-6 w-6 text-[#f96706]" aria-hidden="true" />
            </span>
            <p className="text-base leading-relaxed text-[#2b303b]">
              We build GDPR-conscious data flows — data minimisation by default, consent
              capture, export and deletion paths, and access controls — and we sign Data
              Processing Agreements. Where personal data of UK or EEA residents needs to
              reach our team at all, the DPA covers the transfer with Standard Contractual
              Clauses; in practice development and test environments run on masked or
              synthetic data, so production personal data usually never leaves your
              infrastructure in the first place. We are not ISO-certified yet, and we say
              so plainly rather than implying otherwise. If your procurement process
              requires a specific certification, tell us early and we'll tell you honestly
              whether we're the right fit today.
            </p>
          </div>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            VAT and invoicing from India
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#2b303b]">
            Invoices are raised from India as an export of services, so they arrive without
            Indian tax added. For VAT-registered UK and EU businesses, cross-border B2B
            services are typically self-accounted under the reverse-charge mechanism —
            meaning no surprise gross-up on our side and standard treatment on yours (your
            accountant will confirm how it applies to you). We invoice in your preferred
            currency, work against purchase orders where your procurement requires them,
            and every engagement starts from a written phased estimate rather than a single
            opaque number.
          </p>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            What we build for European clients
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#2b303b]">
            For UK and EU clients we deliver{" "}
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
          <FaqSection faqs={FAQS} />

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

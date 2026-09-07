import { CompatLink as Link } from "@/components/NextCompat";
import { Clock, Target, Users } from "lucide-react";
import SEOHead, { breadcrumbSchema, faqSchema, serviceSchema, SITE_URL } from "@/components/SEOHead";
import { PAGE_FAQS } from "@/data/page-faqs";
import PageHero from "@/components/PageHero";
import FaqSection from "@/components/FaqSection";
import ContactCTA from "@/sections/ContactCTA";

// Explains the three ways to engage Zyllo Tech. Content rules: honest
// guidance only — no invented rates, discounts, or client counts.
const FAQS = PAGE_FAQS["/engagement-models"];

const MODELS = [
  {
    name: "Fixed Scope",
    bestFor: "Well-defined builds with a clear endpoint",
    pricing: "Fixed quote",
    flexibility: "Changes go through written scope revisions",
    cadence: "Weekly demos of working software",
    timeline: "First production version typically 8–16 weeks",
  },
  {
    name: "Dedicated Team",
    bestFor: "Evolving products needing sustained development",
    pricing: "Monthly team rate",
    flexibility: "Reprioritise sprint to sprint — no re-scoping",
    cadence: "Your standups, weekly demos, written updates",
    timeline: "Ongoing; typically 3-month minimum",
  },
  {
    name: "Staff Augmentation",
    bestFor: "Existing teams needing specific skills",
    pricing: "Monthly per-developer rate",
    flexibility: "Scale individual roles up or down",
    cadence: "Developers work inside your own process",
    timeline: "Ongoing; agreed per role",
  },
];

const ROWS = [
  ["Best for", "bestFor"],
  ["Pricing basis", "pricing"],
  ["Flexibility", "flexibility"],
  ["Communication cadence", "cadence"],
  ["Typical timeline", "timeline"],
];

export default function EngagementModelsPage() {
  return (
    <>
      <SEOHead
        title="Software Development Engagement Models | Zyllo Tech"
        description="Fixed scope, dedicated team, or staff augmentation — an honest comparison of software development engagement models and when each one fits."
        canonical="/engagement-models"
        structuredData={[
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Engagement Models", url: `${SITE_URL}/engagement-models` },
          ]),
          serviceSchema({
            name: "Software Development Engagement Models",
            description:
              "Fixed-scope projects, dedicated development teams, and staff augmentation from Zyllo Tech — written phased scopes, weekly demos, and your code in your repository in every model.",
            url: `${SITE_URL}/engagement-models`,
          }),
          faqSchema(FAQS),
        ]}
      />
      <PageHero
        eyebrow="How We Work"
        title="Engagement Models: Fixed Scope, Dedicated Team, or Staff Augmentation"
        description="Three honest ways to work with us — and plain guidance on which fits your situation."
        primaryCta={{ label: "Get a Free Estimate", href: "/contact" }}
        secondaryCta={{ label: "Hire Dedicated Developers", href: "/hire-dedicated-developers" }}
      />

      <section className="bg-white py-12 lg:py-16">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-[#e7e9ee] shadow-sm lg:grid-cols-3">
            <div className="relative flex flex-col bg-white">
              <div className="h-1.5 w-full bg-[#f96706]" />
              <div className="flex flex-1 flex-col p-8">
                <Target className="h-6 w-6 text-[#f96706]" aria-hidden="true" />
                <h2 className="mt-4 text-xl font-bold tracking-tight text-[#1d2735]">
                  Fixed scope
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-[#54607a]">
                  You bring a well-defined build; we deliver it against a written, phased scope
                  for a fixed quote. Choose this when you know what you need — a customer portal,
                  a marketing site, a first product version with clear requirements — and want
                  budget certainty. You still see working software demoed weekly, and changes are
                  handled through written scope revisions rather than surprise invoices. The first
                  production version of a custom application typically lands in 8–16 weeks.
                </p>
              </div>
            </div>

            <div className="relative flex flex-col border-t border-[#e7e9ee] bg-[#fffaf5] lg:border-l lg:border-t-0">
              <div
                className="h-1.5 w-full"
                style={{ background: "linear-gradient(90deg, #f96706, #3089a6)" }}
              />
              <span className="absolute right-5 top-5 rounded-full bg-gradient-to-r from-[#f96706] to-[#3089a6] px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-white shadow-sm">
                Most Common
              </span>
              <div className="flex flex-1 flex-col p-8">
                <Users className="h-6 w-6 text-[#f96706]" aria-hidden="true" />
                <h2 className="mt-4 text-xl font-bold tracking-tight text-[#1d2735]">
                  Dedicated team
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-[#54607a]">
                  A stable team of senior engineers working only on your product for a monthly
                  team rate. Choose this when the product keeps evolving and a fixed spec would be
                  out of date before it was signed. You direct priorities sprint to sprint; the
                  team joins your standups and tools, and knowledge compounds instead of
                  evaporating between projects. This model is covered in depth on{" "}
                  <Link href="/hire-dedicated-developers" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
                    hire dedicated developers
                  </Link>.
                </p>
              </div>
            </div>

            <div className="relative flex flex-col border-t border-[#e7e9ee] bg-white lg:border-l lg:border-t-0">
              <div className="h-1.5 w-full bg-[#3089a6]" />
              <div className="flex flex-1 flex-col p-8">
                <Clock className="h-6 w-6 text-[#3089a6]" aria-hidden="true" />
                <h2 className="mt-4 text-xl font-bold tracking-tight text-[#1d2735]">
                  Staff augmentation
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-[#54607a]">
                  Individual engineers — say a{" "}
                  <Link href="/services/web-development" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
                    React developer
                  </Link>
                  , an{" "}
                  <Link href="/services/ai-solutions" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
                    AI/LLM engineer
                  </Link>
                  , or a{" "}
                  <Link href="/services/quality-engineering-qa" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
                    QA specialist
                  </Link>{" "}
                  — who report into your existing engineering process at a monthly per-developer
                  rate. Choose this when you already run delivery and just need specific skills
                  without a hiring cycle.
                </p>
              </div>
            </div>
          </div>

          <h2 className="mt-14 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            Side-by-side comparison
          </h2>
          <div className="mt-6 overflow-x-auto rounded-xl border border-[#e7e9ee]">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[#1d2735]">
                  <th className="p-3 font-semibold text-white"></th>
                  {MODELS.map((m) => (
                    <th key={m.name} className="p-3 font-semibold text-white">
                      {m.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([label, key], rowIndex) => (
                  <tr key={key} className={rowIndex % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}>
                    <th className="border-b border-[#e7e9ee] p-3 align-top font-semibold text-[#1d2735]">
                      {label}
                    </th>
                    {MODELS.map((m) => (
                      <td key={m.name} className="border-b border-[#e7e9ee] p-3 align-top leading-relaxed text-[#2b303b]">
                        {m[key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-[#54607a]">
            Exact rates depend on team composition — every engagement starts with a written
            estimate; ask and we'll give you numbers in the first call.
          </p>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            The same in every model
          </h2>
          <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-5 text-base leading-relaxed text-[#2b303b]">
            <li>Written phased scope before work starts — never an opaque single number.</li>
            <li>Weekly demos of working software.</li>
            <li>Your code in your repository from the first commit, IP assigned to you.</li>
            <li>NDA on request; response to first contact within one business day.</li>
            <li>4+ hours daily overlap with US East Coast and full UK/EU business-hours overlap.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            Common questions
          </h2>
          <div className="max-w-3xl"><FaqSection faqs={FAQS} /></div>

          <p className="mt-10 max-w-3xl text-base leading-relaxed text-[#54607a]">
            Working from the US or Europe? See how we partner with{" "}
            <Link href="/software-development-company-usa" className="font-medium text-[#1d2735] underline underline-offset-4">
              US companies
            </Link>{" "}
            and{" "}
            <Link href="/software-development-company-europe" className="font-medium text-[#1d2735] underline underline-offset-4">
              UK/EU companies
            </Link>
            , or{" "}
            <Link href="/contact" className="font-medium text-[#1d2735] underline underline-offset-4">
              start the conversation
            </Link>
            .
          </p>
        </div>
      </section>

      <ContactCTA />
    </>
  );
}

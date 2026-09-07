import { CompatLink as Link } from "@/components/NextCompat";
import { Check } from "lucide-react";
import SEOHead, { breadcrumbSchema, faqSchema, serviceSchema, SITE_URL } from "@/components/SEOHead";
import { PAGE_FAQS } from "@/data/page-faqs";
import PageHero from "@/components/PageHero";
import FaqSection from "@/components/FaqSection";
import ContactCTA from "@/sections/ContactCTA";

// Landing page for "hire dedicated developers india" intent. Content rules:
// honest process promises only — no invented clients, rates, or team counts.
const FAQS = PAGE_FAQS["/hire-dedicated-developers"];

// Presentation-only split of the "What's included" bullet copy into a bold
// lead phrase + body text; lead + rest concatenated is the original wording.
const INCLUDED = [
  { lead: "Senior engineers", rest: " — experienced developers at India economics, not a bench of juniors." },
  { lead: "English-first written process", rest: ": scopes, decisions, and estimates in writing before work starts." },
  { lead: "Weekly demos", rest: " of working software, not status decks." },
  { lead: "Your repository, your IP", rest: " — every commit lands in your repo from day one, with IP assigned to you." },
  { lead: "Code review and CI", rest: " on every change, with QA and DevOps support available in the same team." },
];

// Accent pairs reused from src/sections/Process.jsx step badges.
const STEP_ACCENTS = [
  { accent: "#f96706", accentSoft: "#fbbf62" },
  { accent: "#3089a6", accentSoft: "#6d94d6" },
  { accent: "#f0650f", accentSoft: "#fb923c" },
];

const ROLES = [
  { label: "Frontend engineers", detail: "React, Next.js, TypeScript", href: "/services/web-development" },
  { label: "Backend engineers", detail: "Node.js, Python, API and data layers", href: "/services/product-strategy-consulting" },
  { label: "Mobile engineers", detail: "Flutter, React Native, native iOS/Android", href: "/services/mobile-app-development" },
  { label: "AI/LLM engineers", detail: "copilots, RAG systems, workflow automation", href: "/services/ai-solutions" },
  { label: "QA engineers", detail: "automated test suites, regression, performance testing", href: "/services/quality-engineering-qa" },
  { label: "DevOps engineers", detail: "cloud infrastructure, Kubernetes, CI/CD", href: "/services/cloud-solutions" },
];

export default function HireDedicatedDevelopersPage() {
  return (
    <>
      <SEOHead
        title="Hire Dedicated Developers in India | Zyllo Tech"
        description="Hire senior React, Node, Python, Flutter, AI/LLM, QA and DevOps engineers from India who join your workflow, demo weekly, and own no lock-in."
        canonical="/hire-dedicated-developers"
        structuredData={[
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Hire Dedicated Developers", url: `${SITE_URL}/hire-dedicated-developers` },
          ]),
          serviceSchema({
            name: "Dedicated Development Team",
            description:
              "Dedicated software development teams from India — senior frontend, backend, mobile, AI, QA, and DevOps engineers integrated into your workflow, with weekly demos and your code in your repository.",
            url: `${SITE_URL}/hire-dedicated-developers`,
          }),
          faqSchema(FAQS),
        ]}
      />
      <PageHero
        eyebrow="Dedicated Teams"
        title="Hire Dedicated Developers Who Ship Weekly"
        description="Senior engineers from India who join your standups, work in your repository, and demo working software every week."
        primaryCta={{ label: "Get a Free Estimate", href: "/contact" }}
        secondaryCta={{ label: "See Engagement Models", href: "/engagement-models" }}
      />

      <section className="bg-white py-12 lg:py-16">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            What the dedicated-team model is
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-[#2b303b]">
            A dedicated team means developers who work only on your product, month after
            month — not a project handed over a wall. You direct the roadmap; we supply
            senior engineers who build it. This beats project outsourcing when your product
            keeps evolving: no re-scoping negotiation for every change, no knowledge lost
            between phases, and the same people who wrote the code are there to extend it.
            For a well-defined build with a fixed endpoint, our{" "}
            <Link href="/engagement-models" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              fixed-scope model
            </Link>{" "}
            is usually the better fit — we'll tell you which honestly on the first call.
          </p>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            What's included
          </h2>
          <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {INCLUDED.map(({ lead, rest }) => (
              <li
                key={lead}
                className="flex items-start gap-3 rounded-xl border border-[#e7e9ee] bg-white p-5 transition-all duration-300 hover:border-[#f96706]/30 hover:shadow-lg hover:shadow-[#1c2f4a]/5"
              >
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#f96706]" aria-hidden="true" />
                <p className="text-base leading-relaxed">
                  <span className="font-semibold text-[#1d2735]">{lead}</span>
                  <span className="text-[#54607a]">{rest}</span>
                </p>
              </li>
            ))}
          </ul>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            How onboarding works
          </h2>
          <ol className="mt-10 grid grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-3">
            {[
              {
                title: "Discovery call",
                body: (
                  <>
                    we map your product, stack, and the roles you actually need. Response
                    within one business day of your{" "}
                    <Link href="/contact" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
                      first message
                    </Link>.
                  </>
                ),
              },
              {
                title: "Written team proposal",
                body: (
                  <>
                    proposed team composition, working model, and phased scope in writing
                    before anything is signed.
                  </>
                ),
              },
              {
                title: "Integration into your workflow",
                body: (
                  <>
                    developers join your standups, your Slack, your Jira or Linear if you want
                    them there. You run the process; we plug into it. Developers typically
                    start within 1–2 weeks of scope agreement.
                  </>
                ),
              },
            ].map(({ title, body }, index) => {
              const { accent, accentSoft } = STEP_ACCENTS[index];
              return (
                <li key={title} className="group relative flex h-full flex-col items-center">
                  <div
                    className="relative z-[1] -mb-7 flex h-14 w-14 items-center justify-center rounded-full text-lg font-extrabold text-white shadow-lg ring-4 ring-white transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105"
                    style={{
                      background: `linear-gradient(135deg, ${accent}, ${accentSoft})`,
                      boxShadow: `0 10px 22px -6px ${accent}70`,
                    }}
                  >
                    {index + 1}
                  </div>
                  <div className="flex h-full w-full flex-col items-center rounded-2xl border border-[#e7e9ee] bg-white px-5 pb-5 pt-10 text-center shadow-sm transition-all duration-300 group-hover:border-[#f96706]/30 group-hover:shadow-lg group-hover:shadow-[#1c2f4a]/5">
                    <h3 className="text-base font-bold text-[#1d2735]">{title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#54607a]">{body}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            Timezone collaboration
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-[#2b303b]">
            Working from India, we keep 4+ hours of daily overlap with US East Coast — enough
            for morning-ET standups and afternoon pairing — and full business-hours overlap
            with the UK and EU, where IST is only 3.5–4.5 hours ahead of CET. Everything
            outside overlap hours runs on a written-first async process, so decisions never
            wait for a meeting. More on how we work with{" "}
            <Link href="/software-development-company-usa" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              US companies
            </Link>{" "}
            and{" "}
            <Link href="/software-development-company-europe" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
              European companies
            </Link>.
          </p>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            Roles you can hire
          </h2>
          <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map((r) => (
              <li
                key={r.href}
                className="rounded-xl border border-[#e7e9ee] bg-white p-5 transition-all duration-300 hover:border-[#f96706]/30 hover:shadow-lg hover:shadow-[#1c2f4a]/5"
              >
                <Link
                  href={r.href}
                  className="font-semibold text-[#1d2735] transition-colors hover:text-[#f96706]"
                >
                  {r.label}
                </Link>
                <p className="mt-1.5 text-sm leading-relaxed text-[#54607a]">{r.detail}</p>
              </li>
            ))}
          </ul>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            Common questions
          </h2>
          <div className="max-w-3xl"><FaqSection faqs={FAQS} /></div>

          <p className="mt-10 max-w-3xl text-base leading-relaxed text-[#54607a]">
            Not sure a dedicated team is the right shape? Compare all three{" "}
            <Link href="/engagement-models" className="font-medium text-[#1d2735] underline underline-offset-4">
              engagement models
            </Link>{" "}
            or{" "}
            <Link href="/contact" className="font-medium text-[#1d2735] underline underline-offset-4">
              talk to us
            </Link>{" "}
            — we respond within one business day.
          </p>
        </div>
      </section>

      <ContactCTA />
    </>
  );
}

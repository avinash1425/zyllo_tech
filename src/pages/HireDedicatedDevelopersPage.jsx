import { CompatLink as Link } from "@/components/NextCompat";
import SEOHead, { breadcrumbSchema, faqSchema, serviceSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import ContactCTA from "@/sections/ContactCTA";

// Landing page for "hire dedicated developers india" intent. Content rules:
// honest process promises only — no invented clients, rates, or team counts.
const FAQS = [
  {
    q: "How fast can developers start?",
    a: "Typically within 1–2 weeks after scope agreement. We first run a discovery call, send a written team proposal, and once you approve it your developers integrate into your workflow.",
  },
  {
    q: "Who owns the code and IP?",
    a: "You do. Your code lives in your repository from the first commit, and our contracts assign all work product and intellectual property to you.",
  },
  {
    q: "How do you handle timezones?",
    a: "We overlap 4+ hours daily with US East Coast and cover full UK/EU business hours from India. Standups, demos, and calls are scheduled in your timezone, backed by a written-first async process.",
  },
  {
    q: "What if a developer isn't a fit?",
    a: "Tell us — we replace or adjust. The written scope includes an easy exit, so you're never locked into a person or a team composition that isn't working.",
  },
  {
    q: "How is quality maintained?",
    a: "Code review on every change, CI pipelines that run tests before merge, and weekly demos of working software so you see progress rather than status reports.",
  },
  {
    q: "Do you sign contracts and NDAs?",
    a: "Yes. Every engagement starts with a written phased scope, contracts assign IP to you, and we sign an NDA on request before any detailed discussion.",
  },
  {
    q: "What communication tools do you use?",
    a: "Yours. Dedicated developers join your Slack, Jira, Linear, GitHub, or whatever your team already runs — plus email and scheduled video calls. Everything important is written down.",
  },
  {
    q: "Is there a minimum engagement?",
    a: "Typically 3 months for dedicated teams — long enough for developers to genuinely absorb your product and codebase. Shorter, well-defined builds fit our fixed-scope model better.",
  },
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
        description="Hire dedicated developers from Zyllo Tech, India — senior React, Node, Python, Flutter, AI/LLM, QA, and DevOps engineers who join your workflow, demo weekly, and commit to your repository from day one."
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
      />

      <section className="bg-white py-12 lg:py-16">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            What the dedicated-team model is
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#2b303b]">
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
          <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-relaxed text-[#2b303b]">
            <li>Senior engineers — experienced developers at India economics, not a bench of juniors.</li>
            <li>English-first written process: scopes, decisions, and estimates in writing before work starts.</li>
            <li>Weekly demos of working software, not status decks.</li>
            <li>Your repository, your IP — every commit lands in your repo from day one, with IP assigned to you.</li>
            <li>Code review and CI on every change, with QA and DevOps support available in the same team.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            How onboarding works
          </h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-base leading-relaxed text-[#2b303b]">
            <li>
              <strong>Discovery call</strong> — we map your product, stack, and the roles you
              actually need. Response within one business day of your{" "}
              <Link href="/contact" className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]">
                first message
              </Link>.
            </li>
            <li>
              <strong>Written team proposal</strong> — proposed team composition, working model,
              and phased scope in writing before anything is signed.
            </li>
            <li>
              <strong>Integration into your workflow</strong> — developers join your standups,
              your Slack, your Jira or Linear if you want them there. You run the process; we
              plug into it. Developers typically start within 1–2 weeks of scope agreement.
            </li>
          </ol>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            Timezone collaboration
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#2b303b]">
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
          <ul className="mt-5 flex flex-col gap-3">
            {ROLES.map((r) => (
              <li key={r.href}>
                <Link
                  href={r.href}
                  className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]"
                >
                  {r.label}
                </Link>
                <span className="text-[#54607a]"> — {r.detail}</span>
              </li>
            ))}
          </ul>

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

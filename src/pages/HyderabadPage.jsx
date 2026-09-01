import { CompatLink as Link } from "@/components/NextCompat";
import SEOHead, { breadcrumbSchema, serviceSchema, SITE_URL } from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import ContactCTA from "@/sections/ContactCTA";
import { SERVICES } from "@/data/services";

// Local landing page for Hyderabad-intent searches. Content rules: capability
// and location facts only — no invented clients, review counts, or rankings.
const FAQS = [
  {
    q: "Where in Hyderabad are you located?",
    a: "We operate from Hyderabad, Telangana, and work with clients across the city, India, and internationally. Meetings happen at your office, ours, or over video — whatever suits the project stage.",
  },
  {
    q: "Do you only work with Hyderabad companies?",
    a: "No — Hyderabad is home base, but delivery is remote-first and we serve clients across India, the Middle East, and other international markets in overlapping working hours.",
  },
  {
    q: "How do engagements start?",
    a: "With a discovery conversation about your users, workflows, and constraints. You then get a written scope and a phased estimate — fixed-scope for well-defined builds, or a dedicated monthly team for evolving products.",
  },
  {
    q: "How long does a typical project take?",
    a: "A content or marketing website usually ships in 3–6 weeks; a custom web or mobile application's first production version typically lands in 8–16 weeks depending on complexity, with working software demoed weekly throughout.",
  },
];

export default function HyderabadPage() {
  return (
    <>
      <SEOHead
        title="Custom Software Development Company in Hyderabad | Zyllo Tech"
        description="Zyllo Tech is a custom software development company in Hyderabad, Telangana — web and mobile apps, AI solutions, cloud and DevOps, delivered by a local engineering team."
        canonical="/custom-software-development-hyderabad"
        structuredData={[
          breadcrumbSchema([
            { name: "Home", url: SITE_URL },
            { name: "Software Development Hyderabad", url: `${SITE_URL}/custom-software-development-hyderabad` },
          ]),
          serviceSchema({
            name: "Custom Software Development in Hyderabad",
            description:
              "Custom software development services delivered from Hyderabad, Telangana — web applications, mobile apps, AI solutions, cloud and DevOps.",
            url: `${SITE_URL}/custom-software-development-hyderabad`,
          }),
        ]}
      />
      <PageHero
        eyebrow="Hyderabad, Telangana"
        title="Custom Software Development Company in Hyderabad"
        description="A local engineering team for web applications, mobile apps, AI, and cloud — discovery to launch and beyond."
      />

      <section className="bg-white py-12 lg:py-16">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            Software engineering, built in Hyderabad
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#2b303b]">
            Zyllo Tech is a software development company headquartered in Hyderabad, Telangana.
            We design, build, and support custom software for businesses that need more than a
            template: customer portals, internal platforms, mobile applications, AI-powered
            workflows, and the cloud infrastructure underneath them. Being in Hyderabad means
            in-person discovery workshops and working sessions are on the table for local
            clients — while our delivery process is remote-first, so teams anywhere in India or
            abroad get the same weekly demos and written scopes.
          </p>
          <p className="mt-4 text-base leading-relaxed text-[#2b303b]">
            Every engagement starts with a discovery conversation and a written, phased scope.
            Your code lives in your repository from the first commit, you see working software
            every week, and performance, security, and SEO are acceptance criteria rather than
            afterthoughts.
          </p>

          <h2 className="mt-10 text-2xl font-bold tracking-tight text-[#1d2735] sm:text-3xl">
            What we build
          </h2>
          <ul className="mt-5 flex flex-col gap-3">
            {SERVICES.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/services/${s.slug}`}
                  className="font-medium text-[#1d2735] underline decoration-[#e7e9ee] underline-offset-4 transition-colors hover:text-[#f96706] hover:decoration-[#f96706]"
                >
                  {s.title}
                </Link>
                <span className="text-[#54607a]"> — {s.tagline}</span>
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
            Zyllo Tech Software Solutions Pvt. Ltd. · Hyderabad, Telangana, India ·{" "}
            <a className="font-medium text-[#1d2735] underline underline-offset-4" href="tel:+917075773680">
              +91 70757 73680
            </a>{" "}
            ·{" "}
            <a className="font-medium text-[#1d2735] underline underline-offset-4" href="mailto:info@zyllotech.com">
              info@zyllotech.com
            </a>
          </p>
        </div>
      </section>

      <ContactCTA />
    </>
  );
}

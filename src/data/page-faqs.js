// FAQ content for the commercial-intent pages, keyed by route.
//
// Single source of truth on purpose: the page components render these as
// visible Q&A, and scripts/prerender.mjs emits the matching FAQPage JSON-LD
// into the crawler HTML. Google requires FAQPage markup to mirror what is
// actually rendered, so both sides must read the same array — never copy a
// question into one place without the other.

export const PAGE_FAQS = {
  "/hire-dedicated-developers": [
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
  ],

  "/engagement-models": [
    {
      q: "Which model is cheapest?",
      a: "It depends on how well-defined your work is. Fixed scope is most predictable for a clearly specified build; a dedicated team costs less per unit of work when requirements evolve, because you skip repeated re-scoping. Every engagement starts with a written estimate — ask and we'll give you numbers in the first call.",
    },
    {
      q: "Can we switch models mid-engagement?",
      a: "Yes. A common path is a fixed-scope first version followed by a dedicated team for ongoing product development. The written scope defines the transition so there are no surprises.",
    },
    {
      q: "Who manages the developers in each model?",
      a: "Fixed scope: we manage delivery end to end against the written scope. Dedicated team: shared — you set priorities, we run engineering practice. Staff augmentation: you manage the developers directly inside your own process.",
    },
    {
      q: "Who owns the code in every model?",
      a: "You do, in all three. Your code lives in your repository from the first commit and contracts assign all IP to you, regardless of engagement model.",
    },
    {
      q: "Is there a minimum commitment?",
      a: "Fixed scope has no minimum beyond the scoped build itself. Dedicated teams typically run 3 months minimum so the team can genuinely absorb your product. Staff augmentation is agreed per developer in the written scope, which always includes an easy exit.",
    },
    {
      q: "How do engagements start?",
      a: "The same way in every model: a discovery call, then a written phased scope and estimate before any commitment. We respond to first contact within one business day and sign an NDA on request.",
    },
  ],

  "/software-development-company-usa": [
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
  ],

  "/software-development-company-europe": [
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
  ],

  "/custom-software-development-hyderabad": [
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
  ],
};

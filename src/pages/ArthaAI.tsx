import { Link } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import SEOHead, { breadcrumbSchema, SITE_URL } from "@/components/SEOHead";

const ArthaAI = () => {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="ArthaAI App | Introduction, Free Start, and How It Works"
        description="Explore ArthaAI with a simple landing page: introduction, get started free, and how it works."
        canonical="/arthaai"
        structuredData={breadcrumbSchema([
          { name: "Home", url: SITE_URL },
          { name: "ArthaAI", url: `${SITE_URL}/arthaai` },
        ])}
      />
      <Navbar />

      <main className="pt-[108px]">
        <section className="px-4 pb-12">
          <div className="container mx-auto max-w-6xl">
            <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-[#10253a] via-[#16344f] to-[#1e4d71] p-8 md:p-12 text-white">
              <div className="absolute -top-24 -right-16 h-64 w-64 rounded-full bg-[#E05C1A]/30 blur-3xl" />
              <div className="absolute -bottom-28 left-1/4 h-72 w-72 rounded-full bg-[#2E86AB]/25 blur-3xl" />
              <div className="relative z-10 max-w-3xl">
                <p className="mb-4 inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-1 text-xs font-semibold tracking-wide">
                  ArthaAI App
                </p>
                <h1 className="mb-5 text-4xl font-extrabold leading-tight md:text-5xl">
                  Introduction to ArthaAI
                </h1>
                <p className="mb-8 text-base leading-relaxed text-white/80 md:text-lg">
                  ArthaAI is your AI-powered money guidance app built to make personal finance simple.
                  It helps users understand savings, goals, and planning in clear language without financial jargon.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link
                    to="/dashboard"
                    className="rounded-lg bg-[#E05C1A] px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90"
                  >
                    Get Started for Free
                  </Link>
                  <a
                    href="#how-it-works"
                    className="rounded-lg border border-white/25 bg-white/10 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-white/20"
                  >
                    See How It Works
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 py-10">
          <div className="container mx-auto max-w-6xl">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-2xl border border-border bg-card p-6">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#E05C1A]">Introduction</p>
                <h2 className="mb-3 text-2xl font-bold text-foreground">What is ArthaAI?</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  A guided finance app with calculators, planning tools, and AI support to help people make smarter money decisions.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-6">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#E05C1A]">Get Started</p>
                <h2 className="mb-3 text-2xl font-bold text-foreground">Start for Free</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  New users can begin immediately and explore core features at no cost.
                </p>
                <Link
                  to="/dashboard"
                  className="mt-5 inline-flex rounded-md bg-[#E05C1A] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Open Free Dashboard
                </Link>
              </div>
              <div className="rounded-2xl border border-border bg-card p-6">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#E05C1A]">How It Works</p>
                <h2 className="mb-3 text-2xl font-bold text-foreground">Simple 3-Step Flow</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Set goals, get personalized AI guidance, and track progress from one dashboard.
                </p>
                <a
                  href="#how-it-works"
                  className="mt-5 inline-flex rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
                >
                  View Steps
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="px-4 py-14">
          <div className="container mx-auto max-w-4xl">
            <div className="mb-8 text-center">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#E05C1A]">How It Works</p>
              <h2 className="text-3xl font-bold text-foreground md:text-4xl">From Sign Up to Clarity</h2>
            </div>
            <div className="space-y-4">
              {[
                {
                  step: "01",
                  title: "Create your profile",
                  body: "Answer a few basic questions so ArthaAI understands your income, goals, and preferences.",
                },
                {
                  step: "02",
                  title: "Get personalized guidance",
                  body: "ArthaAI gives practical next steps for saving, planning, and managing money with no jargon.",
                },
                {
                  step: "03",
                  title: "Track and improve",
                  body: "Use calculators, planner tools, and regular check-ins to stay on track and improve financial confidence.",
                },
              ].map((item) => (
                <div key={item.step} className="flex gap-4 rounded-xl border border-border bg-card p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E05C1A] text-sm font-bold text-white">
                    {item.step}
                  </div>
                  <div>
                    <h3 className="mb-1 text-lg font-semibold text-foreground">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default ArthaAI;

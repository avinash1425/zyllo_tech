import Link from "next/link";
import {
  Target,
  ArrowRight,
  Languages,
  ShieldCheck,
  UserCircle,
  Compass,
  LineChart,
} from "lucide-react";
import Disclaimer from "@/components/arthaai/Disclaimer";

const STEPS = [
  {
    number: "01",
    icon: UserCircle,
    title: "Tell us your goals",
    description:
      "Jump into a calculator or ask ArthaGuru a question — no account or sign-up needed to get started.",
  },
  {
    number: "02",
    icon: Compass,
    title: "Get clear guidance",
    description:
      "Run real numbers through transparent calculators, or get plain-language answers with no jargon and no sales pitch.",
  },
  {
    number: "03",
    icon: LineChart,
    title: "Track and improve",
    description:
      "Revisit the calculators as your numbers change, and lean on ArthaGuru whenever a new question comes up.",
  },
];

const PROBLEMS = [
  {
    icon: Target,
    title: "Advice Is Expensive",
    stat: "Professional advisers are often out of reach",
    description:
      "Quality, personalized financial guidance is typically priced for people who already have significant assets — leaving most people to figure things out alone.",
  },
  {
    icon: ShieldCheck,
    title: "Commission-Driven Advice",
    stat: "Advice is often tied to what pays the seller",
    description:
      "A large share of financial products sold anywhere come with a commission for the seller — which can quietly steer recommendations away from what's actually best for you.",
  },
  {
    icon: Languages,
    title: "Tools Are Confusing by Design",
    stat: "Jargon keeps people out",
    description:
      "Most financial calculators and apps are built with dense terminology that assumes prior knowledge, locking out anyone new to managing their own money.",
  },
];

export default function ArthaAILandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#fff7ed] via-white to-white py-16 lg:py-24">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#1f4693]/8 blur-[120px]" />
          <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[120px]" />
        </div>

        <div className="relative mx-auto max-w-4xl px-6 text-center lg:px-8">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1f4693]/20 bg-[#1f4693]/5 px-3.5 py-1.5 text-xs font-semibold text-[#1f4693]">
            A Zyllo Tech Product
          </span>

          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-[#1c2333] sm:text-5xl lg:text-6xl">
            Smart Money Guidance for <span className="text-[#1f4693]">Everyone</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-[#4b5563]">
            ArthaAI is your money-guidance companion, built to make personal
            finance simple. It helps you understand savings, goals, and
            planning in clear language — no jargon, no commission bias, and
            no sign-up required.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/arthaai/start"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#1f4693] to-[#163570] px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-[#1f4693]/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              Get Started for Free
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[#1f4693]/20 bg-white px-8 py-4 text-sm font-semibold text-[#1f4693] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1f4693]/5"
            >
              See How It Works
            </a>
          </div>

          <div className="mx-auto mt-6 max-w-md">
            <Disclaimer compact />
          </div>
        </div>
      </section>

      {/* Introduction / Get Started / How It Works — 3-card overview */}
      <section className="bg-white py-12 lg:py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#e3e8ee] bg-[#fbfaf7] p-8">
              <span className="text-sm font-bold uppercase tracking-[0.2em] text-[#1f4693]">
                Introduction
              </span>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-[#1c2333]">
                What is ArthaAI?
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-[#4b5563]">
                A guided finance toolkit with transparent calculators and an
                AI education assistant — built to help anyone make clearer
                money decisions, in plain language, wherever they are.
              </p>
            </div>

            <div className="rounded-2xl border border-[#e3e8ee] bg-[#fbfaf7] p-8">
              <span className="text-sm font-bold uppercase tracking-[0.2em] text-[#1f4693]">
                Get Started
              </span>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-[#1c2333]">
                Start for Free
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-[#4b5563]">
                New users can begin immediately and explore core features at
                no cost.
              </p>
              <Link
                href="/arthaai/start"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#1f4693] to-[#163570] px-6 py-3 text-sm font-semibold text-white shadow-md shadow-[#1f4693]/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
              >
                Unlock My Toolkit
              </Link>
            </div>

            <div className="rounded-2xl border border-[#e3e8ee] bg-[#fbfaf7] p-8">
              <span className="text-sm font-bold uppercase tracking-[0.2em] text-[#1f4693]">
                How It Works
              </span>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-[#1c2333]">
                Simple 3-Step Flow
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-[#4b5563]">
                Set goals, get personalized guidance, and track your progress
                from one place.
              </p>
              <a
                href="#how-it-works"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-full border border-[#1f4693]/20 bg-white px-6 py-3 text-sm font-semibold text-[#1f4693] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1f4693]/5"
              >
                View Steps
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Problem statement */}
      <section className="bg-[#fbfaf7] py-12 lg:py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-sm font-bold uppercase tracking-[0.2em] text-[#1f4693]">
              The Problem We Solve
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#1c2333] sm:text-4xl">
              Most people are financially underserved
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[#4b5563]">
              The financial system wasn&apos;t built with most households in
              mind — and it shows.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {PROBLEMS.map(({ icon: Icon, title, stat, description }) => (
              <div
                key={title}
                className="rounded-2xl border border-[#e3e8ee] bg-white p-6"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1f4693]/10">
                  <Icon className="h-6 w-6 text-[#1f4693]" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-[#1c2333]">{title}</h3>
                <p className="mt-1 text-sm font-semibold text-[#f7941e]">{stat}</p>
                <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works — step detail */}
      <section id="how-it-works" className="scroll-mt-20 bg-white py-12 lg:py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-sm font-bold uppercase tracking-[0.2em] text-[#1f4693]">
              How It Works
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#1c2333] sm:text-4xl">
              From Question to Clarity
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-3">
            {STEPS.map(({ number, icon: Icon, title, description }) => (
              <div key={number} className="relative rounded-2xl border border-[#e3e8ee] bg-[#fbfaf7] p-6">
                <span className="text-4xl font-bold text-[#1f4693]/15">{number}</span>
                <span className="mt-2 flex h-11 w-11 items-center justify-center rounded-xl bg-[#1f4693]/10">
                  <Icon className="h-5.5 w-5.5 text-[#1f4693]" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-bold text-[#1c2333]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

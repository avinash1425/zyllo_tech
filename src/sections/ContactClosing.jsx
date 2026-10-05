import Link from "@/lib/nx/link";
import { ArrowRight, Briefcase, MessageCircle, Phone } from "lucide-react";
import { CONTACT_INFO } from "@/data/contact-info";

// Short closing band for /contact. Deliberately prints no contact details
// (they are shown once, in the method cards above) - only actions.
export default function ContactClosing() {
  return (
    <section aria-labelledby="contact-closing-heading" className="relative bg-white px-6 pb-16 pt-4 lg:px-8 lg:pb-20">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#101a3a] via-[#173a52] to-[#1f4693] px-6 py-10 text-white shadow-[0_30px_60px_-24px_rgba(16,26,58,0.6)] sm:px-12 sm:py-12">
        <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#f96706]/30 blur-[90px]" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-[#3089a6]/30 blur-[90px]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <h2 id="contact-closing-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Prefer to talk it through?
            </h2>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-white/90">
              Call or message us on WhatsApp and we will take it from there.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href={CONTACT_INFO.phoneHref}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#f7941e] px-7 py-3 text-[15px] font-bold text-[#101a3a] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#ffb15c] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#ffb15c]/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                Call us
              </a>
              <a
                href={CONTACT_INFO.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/40 bg-white/10 px-7 py-3 text-[15px] font-semibold text-white transition-all duration-200 hover:bg-white/20 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                WhatsApp us
              </a>
            </div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-[#ffb15c]">
              <Briefcase className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-lg font-bold text-white">Looking for a job?</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-white/90">See the roles we are currently hiring for.</p>
            <Link
              href="/careers#open-positions"
              className="mt-4 inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-[#ffb15c] underline underline-offset-4 hover:text-white"
            >
              See open roles
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

import { MessageCircle } from "lucide-react";
import Link from "@/lib/nx/link";
import { CONTACT_INFO } from "@/data/contact-info";

export default function DontSeeCta() {
  return (
    <section className="relative isolate overflow-hidden bg-gradient-to-br from-[#0f2a40] via-[#173a52] to-[#1f4693] py-16 lg:py-20">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div className="mx-auto max-w-3xl px-6 text-center lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Don&apos;t see the right position?</h2>
        <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-white/80 sm:text-lg">
          We&apos;re always keen to meet talented people. Send us your resume and we&apos;ll keep you in mind for
          future openings.
        </p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link
            href="/contact"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#f96706] px-8 py-3 text-base font-semibold text-white shadow-[0_12px_28px_-10px_rgba(249,103,6,0.7)] transition-colors hover:bg-[#e25a02] focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
          >
            Contact HR Team
          </Link>
          <a
            href={CONTACT_INFO.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/60 bg-transparent px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Chat on WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

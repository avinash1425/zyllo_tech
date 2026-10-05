import { MessageCircle } from "lucide-react";
import Link from "@/lib/nx/link";
import { CONTACT_INFO } from "@/data/contact-info";

export default function DontSeeCta() {
  return (
    <section className="bg-white py-14 lg:py-20">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <div className="rounded-2xl bg-gradient-to-br from-[#1f4693] to-[#f96706] p-[1.5px]">
          <div className="rounded-[14.5px] bg-white px-6 py-10 text-center sm:px-10">
            <h2 className="text-2xl font-bold tracking-tight text-[#173a52] sm:text-3xl">Don&apos;t see the right position?</h2>
            <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-[#4a5668]">
              We&apos;re always keen to meet talented people. Send us your resume and we&apos;ll keep you in mind for
              future openings.
            </p>
            <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link
                href="/contact"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-gradient-to-r from-[#f96706] to-[#f7941e] px-7 py-3 text-[15px] font-bold text-white shadow-md shadow-[#f7941e]/30 transition-all hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40"
              >
                Contact HR Team
              </Link>
              <a
                href={CONTACT_INFO.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#c9ced9] bg-white px-7 py-3 text-[15px] font-semibold text-[#1b2030] transition-colors hover:border-[#1f4693] hover:text-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Chat on WhatsApp
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

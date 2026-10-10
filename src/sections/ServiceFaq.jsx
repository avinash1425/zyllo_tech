import { ChevronDown } from "lucide-react";

// Service-page FAQ. Uses native <details> so every answer is in the page
// markup; the same questions are mirrored in FAQPage structured data by
// src/pages/ServiceDetail.jsx.
export default function ServiceFaq({ serviceName, faqs }) {
  if (!faqs?.length) return null;

  return (
    <section
      aria-labelledby="service-faq-heading"
      className="border-t border-[#e7e9ee] bg-[#fafbfc] py-12 lg:py-16"
    >
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-[#c9580d]">
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
            FAQ
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
          </span>
          <h2
            id="service-faq-heading"
            className="mt-4 text-3xl font-extrabold tracking-tight text-[#1d2735] sm:text-4xl"
          >
            {serviceName}: common questions
          </h2>
        </div>

        <div className="mt-10 space-y-3">
          {faqs.map((faq, index) => (
            <details
              key={faq.q}
              open={index === 0}
              className="group rounded-2xl border border-[#e7e9ee] bg-white shadow-[0_1px_2px_rgba(16,26,58,0.06)] open:border-[#f7941e]/50"
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left text-base font-bold text-[#1b2030] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 [&::-webkit-details-marker]:hidden">
                <h3 className="min-w-0 break-words">{faq.q}</h3>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1f4693]/10 text-[#1f4693] transition-transform duration-300 group-open:rotate-180 group-open:bg-[#f96706] group-open:text-white motion-reduce:transition-none">
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </span>
              </summary>
              <p className="px-5 pb-5 text-base leading-[1.7] text-[#4a5668]">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

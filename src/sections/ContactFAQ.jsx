import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "How do I get started?",
    a: "Fill out the contact form above, or reach us by phone, email or WhatsApp. We reply to every inquiry within one business day.",
  },
  {
    q: "What should I include in my message?",
    a: "A short description of what you would like to build, the service you are interested in, and any context that helps us understand your needs. You do not need a finished brief.",
  },
  {
    q: "Who will I be speaking with?",
    a: "You talk to the people actually building your product, so questions get clear, direct answers.",
  },
  {
    q: "Is the first conversation a sales pitch?",
    a: "No. Your first call is about understanding your needs, not a pitch. It is a straightforward, no-pressure conversation.",
  },
  {
    q: "Can I visit your office?",
    a: "Our office is in Guntur, Andhra Pradesh, and the address and map are shown on this page. Please get in touch first so we can make sure someone is there to meet you.",
  },
];

function Item({ id, q, a, open, onToggle }) {
  return (
    <div
      className={`rounded-2xl border bg-white transition-all duration-300 motion-reduce:transition-none ${
        open
          ? "border-[#f7941e]/50 shadow-[0_16px_32px_-18px_rgba(249,103,6,0.35)]"
          : "border-[#e7e9ee] shadow-[0_1px_2px_rgba(16,26,58,0.06)] hover:border-[#1f4693]/30"
      }`}
    >
      <h3>
        <button
          type="button"
          id={`${id}-btn`}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={onToggle}
          className="flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left text-base font-bold text-[#1b2030] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40"
        >
          <span className="min-w-0 break-words">{q}</span>
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300 motion-reduce:transition-none ${
              open ? "rotate-180 bg-[#f96706] text-white" : "bg-[#1f4693]/10 text-[#1f4693]"
            }`}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </span>
        </button>
      </h3>
      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-btn`}
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-base leading-[1.7] text-[#4a5668]">{a}</p>
        </div>
      </div>
    </div>
  );
}

export default function ContactFAQ() {
  const [openIndex, setOpenIndex] = useState(0);
  return (
    <section
      aria-labelledby="contact-faq-heading"
      className="relative overflow-hidden border-t border-[#d9dde2] bg-[#fafbfc] py-12 lg:py-16"
    >
      <div className="relative mx-auto max-w-3xl px-6 lg:px-8">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-[#c9580d]">
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
            FAQ
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
          </span>
          <h2 id="contact-faq-heading" className="mt-4 text-3xl font-extrabold tracking-tight text-[#1d2735] sm:text-4xl">
            Common{" "}
            <span className="bg-gradient-to-r from-[#f96706] to-[#3089a6] bg-clip-text text-transparent">questions</span>
          </h2>
        </div>
        <div className="mt-10 space-y-3">
          {FAQS.map((f, i) => (
            <Item
              key={f.q}
              id={`contact-faq-${i}`}
              q={f.q}
              a={f.a}
              open={openIndex === i}
              onToggle={() => setOpenIndex(openIndex === i ? -1 : i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

// Shared FAQ accordion for the commercial pages and service detail pages.
// The first question starts open so the section never reads as an empty list
// of closed rows. Radix renders each trigger inside an <h3>, so the heading
// semantics of the old static cards are preserved; crawlers read the full
// Q&A from the prerendered HTML regardless of accordion state.
export default function FaqSection({ faqs }) {
  if (!faqs?.length) return null;
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={faqs[0].q}
      className="mt-6 rounded-xl border border-[#e7e9ee] bg-white px-6"
    >
      {faqs.map((faq) => (
        <AccordionItem key={faq.q} value={faq.q} className="border-[#e7e9ee] last:border-b-0">
          <AccordionTrigger className="gap-4 py-5 text-left text-base font-semibold text-[#1d2735] hover:no-underline hover:text-[#c2410c]">
            {faq.q}
          </AccordionTrigger>
          <AccordionContent className="pb-5 text-base leading-relaxed text-[#54607a]">
            {faq.a}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

// FAQ list for the restored landing pages. Native <details> keeps every
// answer in the HTML for crawlers; the first question starts open.
export default function FaqSection({ faqs }) {
  if (!faqs?.length) return null;
  return (
    <div className="mt-6 rounded-xl border border-[#e7e9ee] bg-white px-6">
      {faqs.map((faq, i) => (
        <details key={faq.q} open={i === 0} className="group border-b border-[#e7e9ee] last:border-b-0">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left">
            <h3 className="text-base font-semibold text-[#1d2735] group-hover:text-[#c2410c]">{faq.q}</h3>
            <span aria-hidden="true" className="text-xl text-[#676b7a] transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="pb-5 text-base leading-relaxed text-[#54607a]">{faq.a}</p>
        </details>
      ))}
    </div>
  );
}

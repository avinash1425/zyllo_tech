import { motion, useReducedMotion } from "framer-motion";
import { FileText, FileSearch, Handshake, MessagesSquare } from "lucide-react";

// Generic hiring flow - no timelines or promises beyond what the apply
// confirmation already says.
const STEPS = [
  { icon: FileText, title: "Apply", text: "Pick a role and send your details with your resume as a PDF." },
  { icon: FileSearch, title: "Review", text: "Our team reads your application and resume carefully." },
  { icon: MessagesSquare, title: "Interview", text: "If your profile is a good fit, we get in touch to talk further." },
  { icon: Handshake, title: "Offer", text: "Shortlisted candidates move on to a final decision." },
];

export default function HowWeHire() {
  const reduce = useReducedMotion();
  return (
    <section
      aria-labelledby="how-we-hire-heading"
      className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-12 lg:py-16"
    >
      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center rounded-full bg-[#3089a6]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-[#1f6f8a]">
            How we hire
          </span>
          <h2 id="how-we-hire-heading" className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            A simple, transparent process
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Four clear steps from your first application to a final decision.
          </p>
        </div>

        <ol className="relative mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-[2.1rem] hidden h-0.5 bg-gradient-to-r from-[#f96706] via-[#f7941e] to-[#3089a6] opacity-40 lg:block"
          />
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <motion.li
              key={title}
              initial={reduce ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="group relative rounded-3xl border border-[#e7e9ee] bg-white p-6 shadow-[0_1px_2px_rgba(16,26,58,0.05),0_12px_32px_-18px_rgba(16,26,58,0.18)] transition-all duration-300 hover:-translate-y-1.5 hover:border-[#f7941e]/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f96706] to-[#ffb15c] text-white shadow-[0_12px_24px_-10px_rgba(249,103,6,0.6)] ring-4 ring-white transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3 motion-reduce:transition-none motion-reduce:group-hover:transform-none">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <span aria-hidden="true" className="select-none text-5xl font-black leading-none text-[#1f4693]/10">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-bold tracking-tight text-[#1b2030]">
                <span className="sr-only">Step {i + 1}: </span>
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#676b7a]">{text}</p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

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
  return (
    <section aria-labelledby="how-we-hire-heading" className="border-y border-[#e5e8ef] bg-[#f7f9fc] py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#3089a6]">How we hire</p>
          <h2 id="how-we-hire-heading" className="mt-3 text-3xl font-bold tracking-tight text-[#173a52] sm:text-4xl">
            A simple, transparent process
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-[#4a5668] sm:text-lg">
            Four clear steps from your first application to a final decision.
          </p>
        </div>

        <ol className="relative mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-7 hidden h-px bg-[#c9d3e3] lg:block"
          />
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="relative flex flex-col items-center text-center">
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#173a52] text-lg font-bold text-white shadow-[0_0_0_6px_#f7f9fc,0_10px_24px_-8px_rgba(23,58,82,0.6)]">
                {i + 1}
                <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#3089a6] shadow-[0_2px_6px_rgba(16,26,58,0.2)]">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </span>
              <h3 className="mt-5 text-lg font-semibold text-[#173a52]">
                <span className="sr-only">Step {i + 1}: </span>
                {title}
              </h3>
              <p className="mt-2 max-w-[16rem] text-[15px] leading-relaxed text-[#4a5668]">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

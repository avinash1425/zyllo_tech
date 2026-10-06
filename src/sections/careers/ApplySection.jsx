import { CheckCircle2, Lock, Mail } from "lucide-react";
import ApplyForm from "@/components/ApplyForm";
import { CONTACT_INFO } from "@/data/contact-info";

const EXPECT = [
  "Choose a role and share your details",
  "Attach your resume as a PDF (max 5 MB)",
  "Our team reviews every application",
  "We contact you if your profile is a fit",
];

export default function ApplySection({ jobs, selectedJobId, onSelectJob, onViewOthers }) {
  return (
    <section id="apply" className="scroll-mt-24 bg-[#f7f9fc] py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#3089a6]">Apply</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#173a52] sm:text-4xl">Apply for a Position</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-[#4a5668] sm:text-lg">
            Fill out the form below and we&apos;ll get back to you as soon as possible.
          </p>
        </div>

        <div className="mt-12 grid items-start gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-10">
          <aside className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#173a52] via-[#1b4468] to-[#1f4693] p-8 text-white shadow-[0_2px_4px_rgba(16,26,58,0.08),0_30px_60px_-28px_rgba(23,58,82,0.7)] lg:sticky lg:top-28 lg:p-10">
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#3089a6]/30 blur-[70px]" />
            <h3 className="relative text-2xl font-bold tracking-tight">Apply in minutes</h3>
            <p className="relative mt-3 text-[15px] leading-relaxed text-white/80">
              A short form and your resume is all we need to get started.
            </p>
            <p className="relative mt-8 text-sm font-bold uppercase tracking-[0.16em] text-[#ffb15c]">What to expect</p>
            <ul className="relative mt-4 space-y-3.5">
              {EXPECT.map((t) => (
                <li key={t} className="flex items-start gap-3 text-[15px] leading-relaxed text-white/90">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#6cc3d8]" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
            <p className="relative mt-8 flex items-start gap-3 rounded-2xl border border-white/15 bg-white/5 p-4 text-[15px] leading-relaxed text-white/80">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#6cc3d8]" aria-hidden="true" />
              Your details and resume are used only to evaluate your application.
            </p>
            <p className="relative mt-6 flex flex-wrap items-center gap-2 text-[15px] text-white/80">
              <Mail className="h-4 w-4 text-[#ffb15c]" aria-hidden="true" />
              Questions?
              <a
                href={`mailto:${CONTACT_INFO.email}`}
                className="font-semibold text-white underline underline-offset-4 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40"
              >
                {CONTACT_INFO.email}
              </a>
            </p>
          </aside>

          <ApplyForm
            variant="inline"
            jobs={jobs}
            selectedJobId={selectedJobId}
            onSelectJob={onSelectJob}
            onViewOthers={onViewOthers}
          />
        </div>
      </div>
    </section>
  );
}

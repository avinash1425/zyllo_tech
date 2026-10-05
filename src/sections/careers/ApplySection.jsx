import ApplyForm from "@/components/ApplyForm";

export default function ApplySection({ jobs, selectedJobId, onSelectJob, onViewOthers }) {
  return (
    <section id="apply" className="scroll-mt-24 bg-[#f6f8fc] py-14 lg:py-20">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#173a52] sm:text-4xl">Apply for a Position</h2>
          <p className="mt-3 text-base leading-relaxed text-[#4a5668] sm:text-lg">
            Fill out the form below and we&apos;ll get back to you as soon as possible.
          </p>
        </div>
        <div className="mt-8">
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

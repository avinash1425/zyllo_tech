import { useActionState } from "@/lib/useActionState";
import { submitApplication } from "@/lib/actions/apply";

const initialState = { status: "idle", message: "" };

export default function ApplyForm({ jobId, jobTitle }) {
  const [state, formAction, isPending] = useActionState(submitApplication, initialState);

  if (state.status === "success") {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-white/70 bg-white/60 p-10 text-center shadow-lg shadow-[#1f4693]/5 backdrop-blur-md">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#f7941e] to-[#1f4693]"
        />
        <h3 className="text-xl font-semibold text-[#2b303b]">
          Thanks — your application is in.
        </h3>
        <p className="mt-2 text-sm text-[#676b7a]">
          We&apos;ll review it and get back to you if it&apos;s a fit for the{" "}
          {jobTitle} role.
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/70 bg-white/60 p-6 shadow-lg shadow-[#1f4693]/5 backdrop-blur-md sm:p-8">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#f7941e] to-[#1f4693]"
      />

      <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
        Apply for this role
      </h2>

      <form onSubmit={formAction} className="mt-6 flex flex-col gap-5">
        <input type="hidden" name="jobId" value={jobId} />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Full Name
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              required
              placeholder="Your full name"
              className="w-full rounded-lg border border-[#e7e9ee] bg-white px-4 py-2.5 text-sm text-[#2b303b] placeholder:text-[#676b7a]/60 outline-none transition-all duration-200 focus:border-[#f7941e]/60 focus:ring-4 focus:ring-[#f7941e]/10"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              className="w-full rounded-lg border border-[#e7e9ee] bg-white px-4 py-2.5 text-sm text-[#2b303b] placeholder:text-[#676b7a]/60 outline-none transition-all duration-200 focus:border-[#f7941e]/60 focus:ring-4 focus:ring-[#f7941e]/10"
            />
          </div>

          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Phone Number
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+91 00000 00000"
              className="w-full rounded-lg border border-[#e7e9ee] bg-white px-4 py-2.5 text-sm text-[#2b303b] placeholder:text-[#676b7a]/60 outline-none transition-all duration-200 focus:border-[#f7941e]/60 focus:ring-4 focus:ring-[#f7941e]/10"
            />
          </div>

          <div>
            <label htmlFor="experienceYears" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Years of Experience
            </label>
            <input
              id="experienceYears"
              name="experienceYears"
              type="number"
              min="0"
              max="60"
              step="1"
              required
              placeholder="e.g. 4"
              className="w-full rounded-lg border border-[#e7e9ee] bg-white px-4 py-2.5 text-sm text-[#2b303b] placeholder:text-[#676b7a]/60 outline-none transition-all duration-200 focus:border-[#f7941e]/60 focus:ring-4 focus:ring-[#f7941e]/10"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="resume" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Resume (PDF)
            </label>
            <input
              id="resume"
              name="resume"
              type="file"
              accept="application/pdf"
              required
              className="w-full rounded-lg border border-[#e7e9ee] bg-white px-4 py-2.5 text-sm text-[#2b303b] outline-none transition-all duration-200 file:mr-4 file:rounded-md file:border-0 file:bg-[#f7941e]/10 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#f7941e] file:transition-colors file:duration-200 hover:file:bg-[#f7941e]/20 focus:border-[#f7941e]/60 focus:ring-4 focus:ring-[#f7941e]/10"
            />
            <p className="mt-1.5 text-xs text-[#676b7a]">PDF only, up to 5MB.</p>
          </div>
        </div>

        <div>
          <label htmlFor="coverNote" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
            Why you&apos;re a good fit
          </label>
          <textarea
            id="coverNote"
            name="coverNote"
            rows={5}
            placeholder="Tell us a bit about your experience and why this role interests you..."
            className="w-full resize-none rounded-lg border border-[#e7e9ee] bg-white px-4 py-2.5 text-sm text-[#2b303b] placeholder:text-[#676b7a]/60 outline-none transition-all duration-200 focus:border-[#f7941e]/60 focus:ring-4 focus:ring-[#f7941e]/10"
          />
        </div>

        {state.status === "error" && (
          <p className="text-sm font-medium text-red-600">{state.message}</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-[#f7941e] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(247,148,30,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:bg-[#db7d17] disabled:pointer-events-none disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:scale-100"
        >
          {isPending ? "Submitting..." : "Submit Application"}
        </button>
      </form>
    </div>
  );
}

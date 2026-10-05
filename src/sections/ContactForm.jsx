"use client";

import { useActionState, useState } from "react";
import Link from "@/lib/nx/link";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Mail,
  Phone,
  Send,
  User,
} from "lucide-react";
import { SERVICES as SERVICES_LIST } from "@/data/services";
import { submitContactForm } from "@/lib/api/contact";

const SERVICES = [
  "Web Development",
  "Mobile App Development",
  "UI/UX Design",
  "Cloud Solutions",
  "AI Solutions",
  "Maintenance & Support",
  "Cybersecurity Engineering",
  "Quality Engineering & QA",
  "Product Strategy & Consulting",
  "Other",
];

const NEXT_STEPS = [
  { title: "We read your message", text: "Your inquiry goes straight to our team." },
  { title: "We get back to you", text: "You receive a reply with suggested next steps." },
  { title: "We talk it through", text: "A straightforward, no-pressure conversation." },
];

const INCLUDE = [
  "What you want to achieve (your goals)",
  "Your preferred timeline, if you have one",
  "A budget range, if known",
  "Existing systems or tools we should know about",
];

const initialState = { status: "idle", message: "" };

const inputBase =
  "min-h-12 w-full rounded-xl border border-[#d9dde2] bg-white py-3 pl-11 pr-4 text-base text-[#1d2735] placeholder:text-[#667085] outline-none transition-all duration-200 hover:border-[#b9c0cb] focus:border-[#f96706] focus:ring-4 focus:ring-[#f96706]/20";

function RequiredMark() {
  return (
    <span className="ml-0.5 text-[#c9580d]" aria-hidden="true">
      *
    </span>
  );
}

function Field({ id, label, required, icon: Icon, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[15px] font-semibold text-[#1d2735]">
        {label}
        {required && <RequiredMark />}
      </label>
      <div className="relative">
        <Icon
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]"
          aria-hidden="true"
        />
        {children}
      </div>
    </div>
  );
}

// Selectable chips. The hidden input keeps name="service" + the same option
// strings, so FormData (and submitContactForm) is unchanged.
function ServiceChips({ value, onChange, error }) {
  return (
    <div>
      <input type="hidden" name="service" value={value} />
      <div role="radiogroup" aria-labelledby="service-label" className="flex flex-wrap gap-2">
        {SERVICES.map((service) => {
          const selected = service === value;
          return (
            <button
              key={service}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(service)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2 text-[15px] font-medium transition-all duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f96706]/30 ${
                selected
                  ? "border-[#f96706] bg-[#fff2e2] font-semibold text-[#a84a0b]"
                  : "border-[#d9dde2] bg-white text-[#2b303b] hover:border-[#f96706]/60 hover:bg-[#fffaf5]"
              }`}
            >
              {selected && <Check className="h-4 w-4 text-[#f96706]" aria-hidden="true" />}
              {service}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[15px] font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export default function ContactForm() {
  const [state, formAction, isPending] = useActionState(submitContactForm, initialState);
  const [service, setService] = useState("");
  const [serviceError, setServiceError] = useState("");
  const [count, setCount] = useState(0);
  const [dismissed, setDismissed] = useState(null); // the success state object the user moved on from

  function handleSubmit(event) {
    if (!service) {
      event.preventDefault();
      setServiceError("Please select a service.");
    }
  }

  function sendAnother() {
    setDismissed(state);
    setService("");
    setServiceError("");
    setCount(0);
  }

  const showSuccess = state.status === "success" && dismissed !== state;

  return (
    <section className="relative overflow-hidden border-t border-[#d9dde2] bg-[#f6f8fc] py-10 lg:py-12">
      <div className="relative mx-auto max-w-6xl px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.78fr_1.22fr] lg:items-start lg:gap-8">
          {/* Calm, light side panel */}
          <aside className="order-2 rounded-2xl border border-[#dfe5ef] bg-[#eef3fa] p-6 text-[#1d2735] lg:order-1 lg:p-7">
            <span className="text-sm font-bold uppercase tracking-[0.14em] text-[#173a52]">What happens next</span>
            <ol className="mt-4 space-y-3.5">
              {NEXT_STEPS.map((step, i) => (
                <li key={step.title} className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#173a52] text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="min-w-0 text-[15px] leading-snug">
                    <span className="block font-semibold text-[#173a52]">{step.title}</span>
                    <span className="block text-[#3d4858]">{step.text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex items-center gap-2 text-[15px] font-semibold text-[#173a52]">
              <Clock className="h-4 w-4 shrink-0 text-[#c9580d]" aria-hidden="true" />
              We reply within one business day.
            </p>

            <div className="mt-6 border-t border-[#d3dbe8] pt-5">
              <span className="text-sm font-bold uppercase tracking-[0.14em] text-[#173a52]">What to include</span>
              <ul className="mt-3 space-y-2">
                {INCLUDE.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[15px] leading-snug text-[#3d4858]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#1f7f4d]" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 border-t border-[#d3dbe8] pt-5">
              <span className="text-sm font-bold uppercase tracking-[0.14em] text-[#173a52]">Our services</span>
              <ul className="mt-3 flex flex-wrap gap-2">
                {SERVICES_LIST.map((svc) => (
                  <li key={svc.slug}>
                    <Link
                      href={`/services/${svc.slug}`}
                      className="inline-flex min-h-11 items-center rounded-full border border-[#c9d3e3] bg-white px-3.5 py-2 text-[15px] font-medium text-[#1f4693] transition-colors hover:border-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/30"
                    >
                      {svc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Form card */}
          <div className="order-1 min-w-0 overflow-hidden rounded-2xl border border-[#e2e5ea] bg-white shadow-xl shadow-[#1c2f4a]/10 lg:order-2">
            <div aria-hidden="true" className="h-1.5 bg-gradient-to-r from-[#f96706] via-[#f7941e] to-[#3089a6]" />
            <div className="p-5 sm:p-8">
              {showSuccess ? (
                <div role="status" className="flex flex-col items-center justify-center py-12 text-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#e7f6ee] text-[#1f7f4d]">
                    <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-2xl font-extrabold text-[#1d2735]">Thanks, we&apos;ve got your message.</h3>
                  <p className="mt-2 max-w-sm text-base leading-relaxed text-[#4a5668]">
                    Our team will reach out within one business day.
                  </p>
                  <button
                    type="button"
                    onClick={sendAnother}
                    className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#1f4693]/40 bg-white px-6 py-2.5 text-[15px] font-semibold text-[#1f4693] transition-colors hover:border-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/30"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-5">
                  <div>
                    <h2 className="text-2xl font-extrabold tracking-tight text-[#1d2735] sm:text-3xl">
                      Send us a{" "}
                      <span className="bg-gradient-to-r from-[#f96706] to-[#3089a6] bg-clip-text text-transparent">
                        message
                      </span>
                    </h2>
                    <p className="mt-1.5 text-base leading-relaxed text-[#4a5668]">
                      Share a few details and we&apos;ll reply within one business day. No spam, no pressure.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field id="fullName" label="Full Name" required icon={User}>
                      <input
                        id="fullName"
                        name="fullName"
                        type="text"
                        autoComplete="name"
                        required
                        placeholder="Your full name"
                        className={inputBase}
                      />
                    </Field>
                    <Field id="email" label="Email" required icon={Mail}>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        placeholder="you@company.com"
                        className={inputBase}
                      />
                    </Field>
                    <Field id="phone" label="Phone Number" required icon={Phone}>
                      <input
                        id="phone"
                        name="phone"
                        type="tel"
                        autoComplete="tel"
                        required
                        placeholder="+91 00000 00000"
                        className={inputBase}
                      />
                    </Field>
                    <Field id="company" label="Company Name" icon={Building2}>
                      <input
                        id="company"
                        name="company"
                        type="text"
                        autoComplete="organization"
                        placeholder="Your company (optional)"
                        className={inputBase}
                      />
                    </Field>
                  </div>

                  <div>
                    <span id="service-label" className="mb-2 block text-[15px] font-semibold text-[#1d2735]">
                      Service Required
                      <RequiredMark />
                    </span>
                    <ServiceChips
                      value={service}
                      onChange={(next) => {
                        setService(next);
                        setServiceError("");
                      }}
                      error={serviceError}
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <label htmlFor="description" className="text-[15px] font-semibold text-[#1d2735]">
                        Project Description
                        <RequiredMark />
                      </label>
                      <span className="text-[15px] text-[#667085]">{count} characters</span>
                    </div>
                    <textarea
                      id="description"
                      name="description"
                      rows={4}
                      required
                      onChange={(e) => setCount(e.target.value.length)}
                      placeholder="Tell us a bit about what you're looking to build..."
                      className="w-full resize-y rounded-xl border border-[#d9dde2] bg-white px-4 py-3 text-base text-[#1d2735] placeholder:text-[#667085] outline-none transition-all duration-200 hover:border-[#b9c0cb] focus:border-[#f96706] focus:ring-4 focus:ring-[#f96706]/20"
                    />
                    <p className="mt-1.5 text-[15px] text-[#667085]">
                      <RequiredMark /> Required fields. A sentence or two is plenty to start.
                    </p>
                  </div>

                  {state.status === "error" && (
                    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] font-medium text-red-700">
                      {state.message}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isPending}
                    aria-busy={isPending}
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] to-[#e8590c] px-8 py-3 text-base font-bold text-white shadow-[0_14px_28px_-10px_rgba(249,103,6,0.7)] transition-all duration-200 hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f96706]/40 disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="h-5 w-5" aria-hidden="true" />
                        Send Message
                      </>
                    )}
                  </button>

                  <div className="flex flex-col gap-1 text-[15px] leading-relaxed text-[#4a5668] sm:flex-row sm:items-center sm:justify-between">
                    <p className="inline-flex items-center gap-2">
                      <Lock className="h-4 w-4 shrink-0 text-[#1f7f4d]" aria-hidden="true" />
                      <span>
                        Your details stay private. See our{" "}
                        <Link
                          href="/privacy"
                          className="font-semibold text-[#1f4693] underline underline-offset-4 hover:text-[#c9580d]"
                        >
                          Privacy Policy
                        </Link>
                        .
                      </span>
                    </p>
                    <Link
                      href="/careers#open-positions"
                      className="inline-flex min-h-11 items-center gap-1 font-semibold text-[#1f4693] underline underline-offset-4 hover:text-[#c9580d]"
                    >
                      Looking for a job?
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

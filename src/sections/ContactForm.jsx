"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "@/lib/nx/link";
import { ArrowRight, Check, ChevronDown, Clock } from "lucide-react";
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
  { title: "We talk it through", text: "A straightforward, no-pressure conversation about your needs." },
];

const INCLUDE = [
  "What you want to achieve (your goals)",
  "Your preferred timeline, if you have one",
  "A budget range, if known",
  "Any existing systems or tools we should know about",
];

const initialState = { status: "idle", message: "" };

function RequiredMark() {
  return (
    <span className="ml-0.5 text-[#f96706]" aria-hidden="true">
      *
    </span>
  );
}

// A fully custom listbox rather than a native <select> — native option
// styling can't be themed, which was the actual complaint. The hidden
// input keeps the value in the form's FormData for the server action.
function ServiceDropdown({ value, onChange, error }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <input type="hidden" name="service" value={value} />
      <button
        type="button"
        id="service"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-[#fafbfc] px-4 py-3 text-left text-base outline-none sm:py-2.5 sm:text-sm transition-all duration-200 ${
          error ? "border-red-400" : "border-[#d9dde2]"
        } ${open ? "border-[#1c2f4a]/60 bg-white ring-4 ring-[#1c2f4a]/10" : ""}`}
      >
        <span className={value ? "text-[#1d2735]" : "text-[#4a5668]/70"}>
          {value || "Select a service"}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#4a5668] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-[#e2e5ea] bg-white p-1.5 shadow-xl shadow-[#1c2f4a]/15"
        >
          {SERVICES.map((service) => {
            const selected = service === value;
            return (
              <li key={service} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(service);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3.5 py-3 text-left text-sm transition-colors duration-150 ${
                    selected
                      ? "bg-[#fff2e2] font-semibold text-[#c9580d]"
                      : "text-[#1d2735] hover:bg-[#fafbfc]"
                  }`}
                >
                  {service}
                  {selected && <Check className="h-4 w-4 shrink-0 text-[#f96706]" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="mt-1.5 text-[13px] font-medium text-red-700">{error}</p>}
    </div>
  );
}

export default function ContactForm() {
  const [state, formAction, isPending] = useActionState(submitContactForm, initialState);
  const [service, setService] = useState("");
  const [serviceError, setServiceError] = useState("");

  function handleSubmit(event) {
    if (!service) {
      event.preventDefault();
      setServiceError("Please select a service.");
    }
  }

  return (
    <section className="relative overflow-hidden border-t border-[#d9dde2] bg-[#fafbfc] py-10 lg:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#f96706]/8 blur-[110px]" />
        <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-[#1c2f4a]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-[#c9580d]">
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
            Contact Form
            <span aria-hidden="true" className="h-px w-8 bg-[#f96706]" />
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[#1d2735] sm:text-4xl">
            Tell us about{" "}
            <span className="bg-gradient-to-r from-[#f96706] to-[#3089a6] bg-clip-text text-transparent">
              your project
            </span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#4a5668]">
            Share a few details and we&apos;ll get back to you within one
            business day.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 overflow-hidden rounded-[28px] border border-[#e2e5ea] bg-white shadow-2xl shadow-[#1c2f4a]/10 lg:grid-cols-[0.8fr_1.2fr]">
          {/* Slim side panel: only content that is NOT shown elsewhere on the page. */}
          <aside className="relative order-2 overflow-hidden bg-gradient-to-br from-[#1c2f4a] to-[#0f1826] p-6 text-white sm:p-10 lg:order-1 lg:p-10">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <div
                className="absolute inset-0 opacity-[0.06]"
                style={{
                  backgroundImage: "radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)",
                  backgroundSize: "24px 24px",
                }}
              />
              <div className="absolute -top-16 -left-10 h-56 w-56 rounded-full bg-[#f96706] opacity-25 blur-[90px]" />
              <div className="absolute -bottom-16 -right-10 h-56 w-56 rounded-full bg-[#3089a6] opacity-30 blur-[90px]" />
            </div>

            <div className="relative flex flex-col gap-8">
              <div>
                <span className="text-sm font-bold uppercase tracking-[0.16em] text-[#ffb15c]">What happens next</span>
                <ol className="mt-4 space-y-4">
                  {NEXT_STEPS.map((step, i) => (
                    <li key={step.title} className="flex items-start gap-3.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f96706] text-sm font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-base font-bold text-white">{step.title}</span>
                        <span className="mt-0.5 block text-[15px] leading-relaxed text-white/90">{step.text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-5 flex items-center gap-2.5 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-[15px] font-semibold text-white">
                  <Clock className="h-5 w-5 shrink-0 text-[#ffb15c]" aria-hidden="true" />
                  We reply within one business day.
                </p>
              </div>

              <div>
                <span className="text-sm font-bold uppercase tracking-[0.16em] text-[#ffb15c]">What to include</span>
                <ul className="mt-4 space-y-2.5">
                  {INCLUDE.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-[15px] leading-relaxed text-white/90">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-[#ffb15c]" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <span className="text-sm font-bold uppercase tracking-[0.16em] text-[#ffb15c]">Learn about our services</span>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {SERVICES_LIST.map((svc) => (
                    <li key={svc.slug}>
                      <Link
                        href={`/services/${svc.slug}`}
                        className="inline-flex min-h-11 items-center rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-[#ffb15c] hover:bg-white/20 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#ffb15c]/60"
                      >
                        {svc.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>

          {/* Form */}
          <div className="order-1 min-w-0 p-5 sm:p-8 lg:order-2 lg:p-10">
            {state.status === "success" ? (
              <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                <h3 className="text-xl font-semibold text-[#1d2735]">
                  Thanks — we&apos;ve got your message.
                </h3>
                <p className="mt-2 text-base leading-relaxed text-[#4a5668]">
                  Our team will reach out within one business day.
                </p>
              </div>
            ) : (
              <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-7">
                <div>
                  <span className="text-sm font-bold uppercase tracking-[0.14em] text-[#1c2f4a]">
                    Your Details
                  </span>
                  <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-[#1d2735]">
                        Full Name
                        <RequiredMark />
                      </label>
                      <input
                        id="fullName"
                        name="fullName"
                        type="text"
                        required
                        placeholder="Your full name"
                        className="w-full rounded-lg border border-[#d9dde2] bg-[#fafbfc] px-4 py-3 text-base text-[#1d2735] sm:py-2.5 sm:text-sm placeholder:text-[#4a5668]/70 outline-none transition-all duration-200 focus:border-[#1c2f4a]/60 focus:bg-white focus:ring-4 focus:ring-[#1c2f4a]/10"
                      />
                    </div>

                    <div>
                      <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[#1d2735]">
                        Email
                        <RequiredMark />
                      </label>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        placeholder="you@company.com"
                        className="w-full rounded-lg border border-[#d9dde2] bg-[#fafbfc] px-4 py-3 text-base text-[#1d2735] sm:py-2.5 sm:text-sm placeholder:text-[#4a5668]/70 outline-none transition-all duration-200 focus:border-[#1c2f4a]/60 focus:bg-white focus:ring-4 focus:ring-[#1c2f4a]/10"
                      />
                    </div>

                    <div>
                      <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-[#1d2735]">
                        Phone Number
                        <RequiredMark />
                      </label>
                      <input
                        id="phone"
                        name="phone"
                        type="tel"
                        autoComplete="tel"
                        required
                        placeholder="+91 00000 00000"
                        className="w-full rounded-lg border border-[#d9dde2] bg-[#fafbfc] px-4 py-3 text-base text-[#1d2735] sm:py-2.5 sm:text-sm placeholder:text-[#4a5668]/70 outline-none transition-all duration-200 focus:border-[#1c2f4a]/60 focus:bg-white focus:ring-4 focus:ring-[#1c2f4a]/10"
                      />
                    </div>

                    <div>
                      <label htmlFor="company" className="mb-1.5 block text-sm font-medium text-[#1d2735]">
                        Company Name
                      </label>
                      <input
                        id="company"
                        name="company"
                        type="text"
                        placeholder="Your company"
                        className="w-full rounded-lg border border-[#d9dde2] bg-[#fafbfc] px-4 py-3 text-base text-[#1d2735] sm:py-2.5 sm:text-sm placeholder:text-[#4a5668]/70 outline-none transition-all duration-200 focus:border-[#1c2f4a]/60 focus:bg-white focus:ring-4 focus:ring-[#1c2f4a]/10"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <span className="text-sm font-bold uppercase tracking-[0.14em] text-[#1c2f4a]">
                    Project Details
                  </span>

                  <div className="mt-4">
                    <label htmlFor="service" className="mb-1.5 block text-sm font-medium text-[#1d2735]">
                      Service Required
                      <RequiredMark />
                    </label>
                    <ServiceDropdown
                      value={service}
                      onChange={(next) => {
                        setService(next);
                        setServiceError("");
                      }}
                      error={serviceError}
                    />
                  </div>

                  <div className="mt-5">
                    <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-[#1d2735]">
                      Project Description
                      <RequiredMark />
                    </label>
                    <textarea
                      id="description"
                      name="description"
                      rows={5}
                      required
                      placeholder="Tell us a bit about what you're looking to build..."
                      className="w-full resize-none rounded-lg border border-[#d9dde2] bg-[#fafbfc] px-4 py-3 text-base text-[#1d2735] sm:py-2.5 sm:text-sm placeholder:text-[#4a5668]/70 outline-none transition-all duration-200 focus:border-[#1c2f4a]/60 focus:bg-white focus:ring-4 focus:ring-[#1c2f4a]/10"
                    />
                  </div>
                </div>

                {state.status === "error" && (
                  <p className="text-sm font-medium text-red-600">{state.message}</p>
                )}

                <div className="flex flex-col gap-3 border-t border-[#e2e5ea] pt-7 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[13px] text-[#4a5668]">
                    <RequiredMark /> Required field
                  </p>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#f96706] px-8 py-3.5 sm:w-auto text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(247,148,30,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:bg-[#c9580d] disabled:pointer-events-none disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:scale-100"
                  >
                    {isPending ? "Sending..." : "Send Message"}
                  </button>
                </div>
                <div className="space-y-2 text-[15px] leading-relaxed text-[#4a5668]">
                  <p>
                    Read how we handle your details in our{" "}
                    <Link href="/privacy" className="font-semibold text-[#1f4693] underline underline-offset-4 hover:text-[#c9580d]">
                      Privacy Policy
                    </Link>
                    .
                  </p>
                  <p>
                    Looking for a job?{" "}
                    <Link href="/careers#open-positions" className="inline-flex items-center gap-1 font-semibold text-[#1f4693] underline underline-offset-4 hover:text-[#c9580d]">
                      See open roles
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </p>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

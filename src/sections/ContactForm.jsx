import { useEffect, useRef, useState } from "react";
import { useActionState } from "@/lib/useActionState";
import { Check, ChevronDown, Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { submitContactForm } from "@/lib/actions/contact";

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

// Folded in from the old standalone ContactInfo section — one unified
// card (dark rail + form) reads as a single, deliberate piece rather than
// two disconnected sections stacked on the page.
const CONTACT_ITEMS = [
  { icon: Phone, label: "Call Us", value: "+91 70757 73680", href: "tel:+917075773680" },
  { icon: Mail, label: "Email Us", value: "info@zyllotech.com", href: "mailto:info@zyllotech.com" },
  { icon: MessageCircle, label: "WhatsApp", value: "Chat with us", href: "https://wa.me/917075773680" },
  { icon: MapPin, label: "Location", value: "India", href: null },
  { icon: Clock, label: "Response Time", value: "Within one business day", href: null },
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
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-[#fafbfc] px-4 py-2.5 text-left text-sm outline-none transition-all duration-200 ${
          error ? "border-red-400" : "border-[#d9dde2]"
        } ${open ? "border-[#1c2f4a]/60 bg-white ring-4 ring-[#1c2f4a]/10" : ""}`}
      >
        <span className={value ? "text-[#1d2735]" : "text-[#6c7889]/60"}>
          {value || "Select a service"}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#6c7889] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
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
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3.5 py-2.5 text-left text-sm transition-colors duration-150 ${
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

      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
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
    <section className="relative overflow-hidden border-t border-[#d9dde2] bg-[#fafbfc] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#f96706]/8 blur-[110px]" />
        <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-[#1c2f4a]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#f96706]">
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
          <p className="mt-4 text-lg leading-relaxed text-[#6c7889]">
            Share a few details and we&apos;ll get back to you within one
            business day.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 overflow-hidden rounded-[28px] border border-[#e2e5ea] bg-white shadow-2xl shadow-[#1c2f4a]/10 lg:grid-cols-[0.85fr_1.15fr]">
          {/* Dark contact rail */}
          <div className="relative overflow-hidden bg-gradient-to-br from-[#1c2f4a] to-[#0f1826] p-10 text-white lg:p-11">
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

            <div className="relative flex h-full flex-col justify-center">
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#ffb15c]">
                Get in Touch
              </span>
              <h3 className="mt-2.5 text-2xl font-extrabold leading-tight">
                Let&apos;s talk about your project
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-white/65">
                Reach out however works best for you — we reply within one
                business day.
              </p>

              <div className="mt-7 flex flex-col divide-y divide-white/10">
                {CONTACT_ITEMS.map(({ icon: Icon, label, value, href }) => {
                  const content = (
                    <>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 transition-colors duration-200 group-hover:bg-white/15">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span>
                        <span className="block text-[13px] font-bold">{label}</span>
                        <span className="mt-0.5 block text-[12.5px] text-white/60">{value}</span>
                      </span>
                    </>
                  );
                  return href ? (
                    <a
                      key={label}
                      href={href}
                      target={href.startsWith("http") ? "_blank" : undefined}
                      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="group flex items-start gap-3.5 py-3.5 transition-transform duration-200 hover:translate-x-1"
                    >
                      {content}
                    </a>
                  ) : (
                    <div key={label} className="group flex items-start gap-3.5 py-3.5">
                      {content}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="p-8 lg:p-11">
            {state.status === "success" ? (
              <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                <h3 className="text-xl font-semibold text-[#1d2735]">
                  Thanks — we&apos;ve got your message.
                </h3>
                <p className="mt-2 text-sm text-[#6c7889]">
                  Our team will reach out within one business day.
                </p>
              </div>
            ) : (
              <form onSubmit={(event) => { handleSubmit(event); if (!event.defaultPrevented) formAction(event); }} className="flex flex-col gap-7">
                <div>
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#1c2f4a]">
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
                        className="w-full rounded-lg border border-[#d9dde2] bg-[#fafbfc] px-4 py-2.5 text-sm text-[#1d2735] placeholder:text-[#6c7889]/60 outline-none transition-all duration-200 focus:border-[#1c2f4a]/60 focus:bg-white focus:ring-4 focus:ring-[#1c2f4a]/10"
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
                        className="w-full rounded-lg border border-[#d9dde2] bg-[#fafbfc] px-4 py-2.5 text-sm text-[#1d2735] placeholder:text-[#6c7889]/60 outline-none transition-all duration-200 focus:border-[#1c2f4a]/60 focus:bg-white focus:ring-4 focus:ring-[#1c2f4a]/10"
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
                        className="w-full rounded-lg border border-[#d9dde2] bg-[#fafbfc] px-4 py-2.5 text-sm text-[#1d2735] placeholder:text-[#6c7889]/60 outline-none transition-all duration-200 focus:border-[#1c2f4a]/60 focus:bg-white focus:ring-4 focus:ring-[#1c2f4a]/10"
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
                        className="w-full rounded-lg border border-[#d9dde2] bg-[#fafbfc] px-4 py-2.5 text-sm text-[#1d2735] placeholder:text-[#6c7889]/60 outline-none transition-all duration-200 focus:border-[#1c2f4a]/60 focus:bg-white focus:ring-4 focus:ring-[#1c2f4a]/10"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#1c2f4a]">
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
                      className="w-full resize-none rounded-lg border border-[#d9dde2] bg-[#fafbfc] px-4 py-2.5 text-sm text-[#1d2735] placeholder:text-[#6c7889]/60 outline-none transition-all duration-200 focus:border-[#1c2f4a]/60 focus:bg-white focus:ring-4 focus:ring-[#1c2f4a]/10"
                    />
                  </div>
                </div>

                {state.status === "error" && (
                  <p className="text-sm font-medium text-red-600">{state.message}</p>
                )}

                <div className="flex flex-col gap-3 border-t border-[#e2e5ea] pt-7 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-[#6c7889]">
                    <RequiredMark /> Required field
                  </p>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f96706] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(247,148,30,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:bg-[#c9580d] disabled:pointer-events-none disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:scale-100"
                  >
                    {isPending ? "Sending..." : "Send Message"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

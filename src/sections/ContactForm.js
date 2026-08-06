"use client";

import { useActionState } from "react";
import { submitContactForm } from "@/app/contact/actions";

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

const initialState = { status: "idle", message: "" };

export default function ContactForm() {
  const [state, formAction, isPending] = useActionState(submitContactForm, initialState);

  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Contact Form
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Tell us about your project
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Share a few details and we&apos;ll get back to you within one
            business day.
          </p>
        </div>

        <div className="relative mt-8 overflow-hidden rounded-2xl border border-white/70 bg-white/60 p-6 shadow-lg shadow-[#1f4693]/5 backdrop-blur-md sm:p-8">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#f7941e] to-[#1f4693]"
          />
          {state.status === "success" ? (
            <div className="py-10 text-center">
              <h3 className="text-xl font-semibold text-[#2b303b]">
                Thanks — we&apos;ve got your message.
              </h3>
              <p className="mt-2 text-sm text-[#676b7a]">
                Our team will reach out within one business day.
              </p>
            </div>
          ) : (
            <form action={formAction} className="flex flex-col gap-5">
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
                    placeholder="you@company.com"
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
                    required
                    placeholder="+91 00000 00000"
                    className="w-full rounded-lg border border-[#e7e9ee] bg-white px-4 py-2.5 text-sm text-[#2b303b] placeholder:text-[#676b7a]/60 outline-none transition-all duration-200 focus:border-[#f7941e]/60 focus:ring-4 focus:ring-[#f7941e]/10"
                  />
                </div>

                <div>
                  <label htmlFor="company" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                    Company Name
                  </label>
                  <input
                    id="company"
                    name="company"
                    type="text"
                    placeholder="Your company"
                    className="w-full rounded-lg border border-[#e7e9ee] bg-white px-4 py-2.5 text-sm text-[#2b303b] placeholder:text-[#676b7a]/60 outline-none transition-all duration-200 focus:border-[#f7941e]/60 focus:ring-4 focus:ring-[#f7941e]/10"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="service" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                  Service Required
                </label>
                <select
                  id="service"
                  name="service"
                  required
                  defaultValue=""
                  className="w-full rounded-lg border border-[#e7e9ee] bg-white px-4 py-2.5 text-sm text-[#2b303b] outline-none transition-all duration-200 focus:border-[#f7941e]/60 focus:ring-4 focus:ring-[#f7941e]/10"
                >
                  <option value="" disabled>
                    Select a service
                  </option>
                  {SERVICES.map((service) => (
                    <option key={service} value={service}>
                      {service}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                  Project Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={5}
                  required
                  placeholder="Tell us a bit about what you're looking to build..."
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
                {isPending ? "Sending..." : "Send Message"}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

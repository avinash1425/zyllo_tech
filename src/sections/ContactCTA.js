import Link from "next/link";
import { Mail, MessageCircle, Phone } from "lucide-react";

const CONTACT_METHODS = [
  {
    icon: Phone,
    label: "Call us",
    value: "+91 70757 73680",
    href: "tel:+917075773680",
  },
  {
    icon: Mail,
    label: "Email us",
    value: "info@zyllotech.com",
    href: "mailto:info@zyllotech.com",
  },
  {
    icon: MessageCircle,
    label: "WhatsApp",
    value: "Chat with us",
    href: "https://wa.me/917075773680",
  },
];

export default function ContactCTA({
  heading = "Have a project in mind? Let's talk.",
  description = "Tell us what you're building and we'll get back to you within one business day.",
  buttonLabel = "Start Your Project",
  buttonHref = "/contact",
}) {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-gradient-to-br from-[#fff7ef] via-white to-[#eef2fa] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-[#f7941e]/15 blur-[110px]" />
        <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-[#1f4693]/15 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-4xl px-6 text-center lg:px-8">
        <div className="rounded-[28px] border border-white/60 bg-white/60 p-10 shadow-xl backdrop-blur-xl sm:p-14">
          <h2 className="text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            {heading}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-[#676b7a]">
            {description}
          </p>

          <div className="mt-8">
            <Link
              href={buttonHref}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f7941e] px-8 py-4 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(247,148,30,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:bg-[#db7d17]"
            >
              {buttonLabel}
            </Link>
          </div>

          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
            {CONTACT_METHODS.map(({ icon: Icon, label, value, href }, index) => {
              const accent = index % 2 === 0 ? "#f7941e" : "#1f4693";
              return (
                <a
                  key={label}
                  href={href}
                  target={href.startsWith("http") ? "_blank" : undefined}
                  rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="group relative flex flex-col items-center gap-2 overflow-hidden rounded-xl border border-white/70 bg-gradient-to-br from-white/90 to-[#1f4693]/[0.04] px-4 py-5 shadow-md shadow-[#1f4693]/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-transparent hover:shadow-lg hover:shadow-[#1f4693]/10"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-50 bg-gradient-to-r from-[#f7941e] to-[#1f4693] opacity-40 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
                  />
                  <Icon
                    className="h-5 w-5 transition-transform duration-300 group-hover:scale-110"
                    style={{ color: accent }}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-medium uppercase tracking-wide text-[#676b7a]">
                    {label}
                  </span>
                  <span className="text-sm font-semibold text-[#2b303b]">{value}</span>
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";

const INFO_CARDS = [
  {
    icon: Phone,
    label: "Call Us",
    value: "+91 70757 73680",
    href: "tel:+917075773680",
  },
  {
    icon: Mail,
    label: "Email Us",
    value: "info@zyllotech.com",
    href: "mailto:info@zyllotech.com",
  },
  {
    icon: MessageCircle,
    label: "WhatsApp",
    value: "Chat with us",
    href: "https://wa.me/917075773680",
  },
  {
    icon: MapPin,
    label: "Location",
    value: "India",
    href: null,
  },
  {
    icon: Clock,
    label: "Response Time",
    value: "Within one business day",
    href: null,
  },
];

export default function ContactInfo() {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#f7941e]/10 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#1f4693]/10 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#f7941e] uppercase">
            Contact Information
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Reach us however works best for you
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            We typically respond within one business day.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {INFO_CARDS.map(({ icon: Icon, label, value, href }) => {
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-50 bg-gradient-to-r from-[#f7941e] to-[#1f4693] opacity-40 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
                />
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/70 bg-gradient-to-br from-[#f7941e]/20 to-[#1f4693]/20 shadow-md shadow-[#f7941e]/10 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                  <Icon className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
                </div>
                <p className="mt-4 text-xs font-bold uppercase tracking-wide text-[#676b7a]">
                  {label}
                </p>
                <p className="mt-1 text-sm font-semibold text-[#2b303b]">{value}</p>
              </>
            );

            const className =
              "group relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#f7941e]/[0.03] p-6 shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-xl hover:shadow-[#f7941e]/10";

            return href ? (
              <a
                key={label}
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                className={className}
              >
                {content}
              </a>
            ) : (
              <div key={label} className={className}>
                {content}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

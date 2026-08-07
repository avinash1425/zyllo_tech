"use client";

import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";

// Icon medallion style matches ContactCTA.js / HomeContactCTA.js and every
// other icon-card section on the site — glowing gradient tile with a
// pulsing blur behind it, per-card accent color.
const INFO_CARDS = [
  {
    icon: Phone,
    label: "Call Us",
    value: "+91 70757 73680",
    href: "tel:+917075773680",
    accent: "#f7941e",
    accentSoft: "#fbbf62",
  },
  {
    icon: Mail,
    label: "Email Us",
    value: "info@zyllotech.com",
    href: "mailto:info@zyllotech.com",
    accent: "#f0650f",
    accentSoft: "#fb923c",
  },
  {
    icon: MessageCircle,
    label: "WhatsApp",
    value: "Chat with us",
    href: "https://wa.me/917075773680",
    accent: "#8a5a7a",
    accentSoft: "#c295b3",
  },
  {
    icon: MapPin,
    label: "Location",
    value: "India",
    href: null,
    accent: "#2f5fb3",
    accentSoft: "#6d94d6",
  },
  {
    icon: Clock,
    label: "Response Time",
    value: "Within one business day",
    href: null,
    accent: "#1f4693",
    accentSoft: "#4d6fb8",
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
          {INFO_CARDS.map(({ icon: Icon, label, value, href, accent, accentSoft }) => {
            const content = (
              <>
                <div className="relative flex flex-col items-center">
                  <span
                    aria-hidden="true"
                    className="pulse-glow absolute top-1 h-11 w-11 rounded-full blur-lg"
                    style={{ backgroundColor: accentSoft, opacity: 0.5 }}
                  />
                  <div
                    className="relative flex h-11 w-11 items-center justify-center rounded-xl shadow-md transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105"
                    style={{
                      background: `linear-gradient(135deg, ${accent}, ${accentSoft})`,
                      boxShadow: `0 8px 18px -6px ${accent}55`,
                    }}
                  >
                    <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                  </div>
                </div>
                <p className="mt-4 text-xs font-bold uppercase tracking-wide text-[#676b7a]">
                  {label}
                </p>
                <p className="mt-1 text-sm font-semibold text-[#2b303b]">{value}</p>
              </>
            );

            const className =
              "group flex flex-col items-center rounded-2xl border bg-white/60 p-6 text-center shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:bg-white/80 hover:shadow-lg";
            const style = { borderColor: `${accent}30` };

            return href ? (
              <a
                key={label}
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                className={className}
                style={style}
              >
                {content}
              </a>
            ) : (
              <div key={label} className={className} style={style}>
                {content}
              </div>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .pulse-glow {
          animation: pulseGlow 3.5s ease-in-out infinite;
        }
        @keyframes pulseGlow {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.35;
          }
          50% {
            transform: scale(1.15);
            opacity: 0.6;
          }
        }
      `}</style>
    </section>
  );
}

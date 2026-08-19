import { CompatLink as Link } from "@/components/NextCompat";
import { Mail, MessageCircle, Phone } from "lucide-react";

// Icon medallion style matches WhyChooseUs.js / Values.js / Technologies.js
// / MissionVision.js — glowing gradient tile with a pulsing blur — so this
// closing contact section reads as the same visual family as the rest of
// the site's icon-card sections.
const CONTACT_METHODS = [
  {
    icon: Phone,
    label: "Call us",
    value: "+91 70757 73680",
    href: "tel:+917075773680",
    accent: "#f7941e",
    accentSoft: "#fbbf62",
  },
  {
    icon: Mail,
    label: "Email us",
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
    accent: "#1f4693",
    accentSoft: "#4d6fb8",
  },
];

export default function ContactCTA({
  heading = "Have a project in mind? Let's talk.",
  description = "Tell us what you're building and we'll get back to you within one business day.",
  buttonLabel = "Start Your Project",
  buttonHref = "/contact",
}) {
  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-gradient-to-br from-[#fff7ed] via-white to-[#eff4fc] py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-[#f7941e]/12 blur-[110px]" />
        <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-[#1f4693]/12 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-4xl px-6 text-center lg:px-8">
        <div className="rounded-[28px] border border-white/60 bg-white/50 p-10 shadow-xl shadow-[#f7941e]/10 backdrop-blur-xl sm:p-14">
          <h2 className="text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            {heading}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-[#676b7a]">
            {description}
          </p>

          <div className="mt-8">
            <Link
              href={buttonHref}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693] px-8 py-4 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(31,70,147,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:brightness-110"
            >
              {buttonLabel}
            </Link>
          </div>

          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
            {CONTACT_METHODS.map(({ icon: Icon, label, value, href, accent, accentSoft }) => (
              <a
                key={label}
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                className="group flex flex-col items-center gap-1.5 rounded-xl border bg-white/60 px-4 py-5 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:bg-white/80 hover:shadow-lg"
                style={{ borderColor: `${accent}30` }}
              >
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

                <span className="mt-1 text-xs font-medium uppercase tracking-wide text-[#676b7a]">
                  {label}
                </span>
                <span className="text-sm font-semibold text-[#2b303b]">{value}</span>
              </a>
            ))}
          </div>
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

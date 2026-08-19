import { CompatLink as Link } from "@/components/NextCompat";
import { ArrowRight, Mail, MessageCircle, Phone } from "lucide-react";

// Compact corporate banner instead of a big centered hero-style card —
// heading/copy and the CTA button sit side by side in one row, contact
// methods run as a slim strip below. Much smaller footprint than the
// previous oversized centered treatment.
const CONTACT_METHODS = [
  {
    icon: Phone,
    label: "Call us",
    value: "+91 70757 73680",
    href: "tel:+917075773680",
    accent: "#f96706",
  },
  {
    icon: Mail,
    label: "Email us",
    value: "info@zyllotech.com",
    href: "mailto:info@zyllotech.com",
    accent: "#f0650f",
  },
  {
    icon: MessageCircle,
    label: "WhatsApp",
    value: "Chat with us",
    href: "https://wa.me/917075773680",
    accent: "#3089a6",
  },
];

export default function HomeContactCTA({
  heading = "Let's Build Your Next Digital Solution",
  description = "Partner with us to transform your ideas into scalable, secure, and future ready software.",
  buttonLabel = "Start Your Project",
  buttonHref = "/contact",
}) {
  return (
    <section className="relative overflow-hidden border-t border-[#e2e5ea] bg-[#f8f9fb] py-10 lg:py-12">
      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="cta-in relative isolate overflow-hidden rounded-2xl border border-[#e2e5ea] bg-white shadow-sm">
          {/* Subtle texture + accent glow — visual richness without adding
              back the height/padding that made the previous version big. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 opacity-[0.4]"
            style={{
              backgroundImage: "radial-gradient(rgba(15,23,42,0.06) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />
          <div
            aria-hidden="true"
            className="absolute -right-16 -top-20 -z-10 h-56 w-56 rounded-full bg-[#3089a6]/10 blur-[80px]"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-20 -left-10 -z-10 h-56 w-56 rounded-full bg-[#f96706]/10 blur-[80px]"
          />
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#f96706] to-[#3089a6]"
          />

          <div className="flex flex-col gap-5 p-7 sm:flex-row sm:items-center sm:justify-between lg:p-9">
            <div className="max-w-xl">
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#f96706]">
                Get In Touch
              </span>
              <h2 className="mt-1.5 text-2xl font-extrabold tracking-tight text-[#0f172a] sm:text-[1.75rem]">
                {heading}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[#54607a]">
                {description}
              </p>
            </div>

            <Link
              href={buttonHref}
              className="group relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-[#f96706] to-[#3089a6] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_12px_20px_-6px_rgba(249,103,6,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_20px_-6px_rgba(48,137,166,0.4)]"
            >
              <span className="cta-shine" aria-hidden="true" />
              <span className="relative z-[1]">{buttonLabel}</span>
              <ArrowRight
                className="relative z-[1] h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
          </div>

          <div className="flex flex-col divide-y divide-[#e2e5ea] border-t border-[#e2e5ea] sm:flex-row sm:divide-x sm:divide-y-0">
            {CONTACT_METHODS.map(({ icon: Icon, label, value, href, accent }) => (
              <a
                key={label}
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                className="group flex flex-1 items-center justify-center gap-2.5 px-4 py-3.5 transition-colors duration-200 hover:bg-[#fafbfc]"
              >
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={{ color: accent }}
                  aria-hidden="true"
                />
                <span className="text-[13px]">
                  <span className="font-medium text-[#94a3b8]">{label}: </span>
                  <span className="font-semibold text-[#0f172a]">{value}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        .cta-in {
          animation: ctaFadeUp 0.6s ease-out both;
        }
        @keyframes ctaFadeUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .cta-shine {
          position: absolute;
          top: 0;
          left: -75%;
          height: 100%;
          width: 50%;
          background: linear-gradient(120deg, transparent 0%, rgba(255, 255, 255, 0.35) 50%, transparent 100%);
          transform: skewX(-20deg);
        }
        a:hover .cta-shine {
          left: 130%;
          transition: left 0.6s ease;
        }
      `}</style>
    </section>
  );
}

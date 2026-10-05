import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Mail, MapPin, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { CONTACT_INFO } from "@/data/contact-info";

const METHODS = [
  { icon: Phone, label: "Call", value: CONTACT_INFO.phoneDisplay, action: "Call now", href: CONTACT_INFO.phoneHref, from: "#f96706", to: "#ffb15c" },
  { icon: Mail, label: "Email", value: CONTACT_INFO.email, action: "Send an email", href: `mailto:${CONTACT_INFO.email}`, from: "#1f4693", to: "#4d6fb8" },
  { icon: MessageCircle, label: "WhatsApp", value: "Message us on WhatsApp", action: "Open WhatsApp", href: CONTACT_INFO.whatsappHref, from: "#1f7f99", to: "#3089a6" },
  { icon: MapPin, label: "Visit", value: "Our office in Guntur", action: "See address and map", href: "#visit-us", from: "#f7941e", to: "#fbbf62" },
];

// Quick-contact row that overlaps the page hero (same pattern as the perks
// strip on /careers).
export default function ContactMethods() {
  const reduce = useReducedMotion();
  return (
    <section aria-label="Ways to reach us" className="relative z-[1] -mt-8 px-6 lg:px-8">
      <ul className="mx-auto grid max-w-6xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {METHODS.map(({ icon: Icon, label, value, action, href, from, to }, i) => {
          const external = href.startsWith("http");
          return (
            <motion.li
              key={label}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="min-w-0"
            >
              <a
                href={href}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                className="group flex h-full flex-col gap-4 rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-[0_1px_2px_rgba(16,26,58,0.05),0_16px_32px_-18px_rgba(16,26,58,0.25)] transition-all duration-300 hover:-translate-y-1 hover:border-[#f7941e]/50 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="flex items-center gap-3.5">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3 motion-reduce:transition-none motion-reduce:group-hover:transform-none"
                    style={{ background: `linear-gradient(135deg, ${from}, ${to})`, boxShadow: `0 10px 20px -8px ${from}99` }}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold uppercase tracking-[0.12em] text-[#4a5668]">{label}</span>
                    <span className="mt-1 block break-words text-base font-semibold leading-snug text-[#1b2030]">{value}</span>
                  </span>
                </span>
                <span className="mt-auto inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-[#1f4693] group-hover:text-[#c9580d]">
                  {action}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden="true" />
                </span>
              </a>
            </motion.li>
          );
        })}
      </ul>
      <p className="mx-auto mt-4 flex max-w-6xl items-center justify-center gap-2 text-center text-sm text-[#4a5668]">
        <ShieldCheck className="h-4 w-4 shrink-0 text-[#1f7f4d]" aria-hidden="true" />
        <span>
          GST registered &middot;{" "}
          <a href="#company-details" className="font-mono font-semibold tracking-wider text-[#173a52] underline-offset-4 hover:text-[#c9580d] hover:underline">
            GSTIN {CONTACT_INFO.gstin}
          </a>
        </span>
      </p>
    </section>
  );
}

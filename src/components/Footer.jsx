import { ArrowRight, Mail, MapPin, Phone, Sparkles } from "lucide-react";
import { CompatImage as Image } from "@/components/NextCompat";
import { CompatLink as Link } from "@/components/NextCompat";
import { useState } from "react";
import LegalModal from "@/components/LegalModal";
import {
  PRIVACY_LAST_UPDATED,
  PRIVACY_SECTIONS,
  TERMS_LAST_UPDATED,
  TERMS_SECTIONS,
} from "@/data/legal-content";

// Company/Services links kept as this site's own real pages — the
// zyllotech.com reference lists different labels (Industries, Resources,
// Startups...) that don't exist as routes here.
const COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/careers", label: "Careers" },
  { href: "/blog", label: "Blog" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/contact", label: "Contact" },
];

const SERVICE_LINKS = [
  { href: "/services/web-development", label: "Web Development" },
  { href: "/services/mobile-app-development", label: "Mobile App Development" },
  { href: "/services/ui-ux-design", label: "UI/UX Design" },
  { href: "/services/cloud-solutions", label: "Cloud Solutions" },
  { href: "/services", label: "All Services" },
];

// Same platform set and order as zyllotech.com's live footer. Real handles
// confirmed directly by the user — Facebook is the one exception, still a
// placeholder pending that URL.
const SOCIAL_LINKS = [
  {
    href: "https://www.instagram.com/zyllotechsoftwaresolutions/",
    label: "Instagram",
    path: "M12 2c-2.716 0-3.056.012-4.123.06-1.064.049-1.791.218-2.427.465a4.902 4.902 0 0 0-1.771 1.153A4.902 4.902 0 0 0 2.526 5.45c-.247.636-.416 1.363-.465 2.427C2.012 8.944 2 9.284 2 12s.012 3.056.06 4.123c.049 1.064.218 1.791.465 2.427a4.902 4.902 0 0 0 1.153 1.771 4.902 4.902 0 0 0 1.771 1.153c.636.247 1.363.416 2.427.465C8.944 21.988 9.284 22 12 22s3.056-.012 4.123-.06c1.064-.049 1.791-.218 2.427-.465a4.902 4.902 0 0 0 1.771-1.153 4.902 4.902 0 0 0 1.153-1.771c.247-.636.416-1.363.465-2.427.048-1.067.06-1.407.06-4.123s-.012-3.056-.06-4.123c-.049-1.064-.218-1.791-.465-2.427a4.902 4.902 0 0 0-1.153-1.771A4.902 4.902 0 0 0 18.55 2.526c-.636-.247-1.363-.416-2.427-.465C15.056 2.012 14.716 2 12 2zm0 1.802c2.67 0 2.987.01 4.042.059.976.045 1.505.207 1.858.344.467.181.8.398 1.15.748.35.35.566.683.747 1.15.137.353.3.882.344 1.858.05 1.055.06 1.372.06 4.042s-.01 2.987-.06 4.042c-.045.976-.207 1.505-.344 1.858a3.1 3.1 0 0 1-.747 1.15c-.35.35-.683.566-1.15.747-.353.137-.882.3-1.858.344-1.054.05-1.371.06-4.042.06s-2.988-.01-4.042-.06c-.976-.045-1.505-.207-1.858-.344a3.1 3.1 0 0 1-1.15-.747 3.1 3.1 0 0 1-.748-1.15c-.137-.353-.3-.882-.344-1.858-.048-1.055-.059-1.372-.059-4.042s.011-2.987.06-4.042c.043-.976.206-1.505.343-1.858.181-.467.398-.8.748-1.15.35-.35.683-.567 1.15-.748.353-.137.882-.3 1.858-.344 1.055-.048 1.372-.059 4.042-.059zm0 3.064a5.135 5.135 0 1 0 0 10.27 5.135 5.135 0 0 0 0-10.27zm0 8.468a3.333 3.333 0 1 1 0-6.666 3.333 3.333 0 0 1 0 6.666zm6.538-8.671a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0z",
  },
  {
    href: "#",
    label: "Facebook",
    path: "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.011c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.299h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  },
  {
    href: "https://www.linkedin.com/company/zyllo-tech/",
    label: "LinkedIn",
    path: "M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z",
  },
  {
    href: "https://www.youtube.com/@zylloTechSoftwareSolutions",
    label: "YouTube",
    path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  },
  {
    href: "https://x.com/ZylloS85154",
    label: "X (Twitter)",
    path: "M18.24 3H21l-6.55 7.49L22.2 21h-6.16l-4.83-6.32L5.64 21H2.87l7.01-8.02L2 3h6.32l4.37 5.78L18.24 3zm-1.08 16.2h1.71L7.02 4.7H5.18l11.98 14.5z",
  },
];

// Uppercase + tracked + a short gradient underline — deliberately distinct
// from the plain sentence-case body/link text below each of these.
// The underline is a plain Tailwind after: pseudo-element rather than a
// styled-jsx rule — styled-jsx only scopes elements written directly in
// the component that owns the <style> tag, so a rule targeting markup
// rendered by this separate helper component would silently never match.
function FooterHeading({ children, dot }) {
  return (
    <h3 className="relative inline-flex items-center gap-2 pb-3.5 text-xs font-bold uppercase tracking-[0.15em] text-white after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-10 after:rounded-full after:bg-gradient-to-r after:from-[#f96706] after:to-[#3089a6] after:shadow-[0_0_10px_rgba(249,103,6,0.55)] after:content-['']">
      {dot && (
        <span className="footer-dot h-1.5 w-1.5 rounded-full bg-[#2f8fe0]" aria-hidden="true" />
      )}
      {children}
    </h3>
  );
}

function FooterLink({ href, children }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 text-[#c9cfdb] transition-all duration-200 hover:translate-x-1 hover:text-white"
    >
      <ArrowRight
        aria-hidden="true"
        className="h-3 w-3 shrink-0 -ml-4 text-[#f96706] opacity-0 transition-all duration-200 group-hover:ml-0 group-hover:opacity-100"
      />
      {children}
    </Link>
  );
}

export default function Footer() {
  const year = new Date().getFullYear();
  const [openLegal, setOpenLegal] = useState(null); // null | "privacy" | "terms"
  const [subscribed, setSubscribed] = useState(false);

  function handleSubscribe(event) {
    event.preventDefault();
    setSubscribed(true);
  }

  return (
    <footer className="relative bg-[#131c2a] text-neutral-100">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8 lg:py-16">
        <div className="grid grid-cols-1 gap-y-10 gap-x-8 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div className="sm:col-span-2 lg:col-span-1">
            {/* White card behind the logo guarantees full contrast no
                matter what the footer's own background is. */}
            <span className="footer-brand inline-block rounded-lg bg-white p-3 shadow-sm transition-shadow duration-300 hover:shadow-lg">
              <Image
                src="/zyllo-logo.png"
                alt="Zyllo Tech Software Solutions Private Limited"
                width={1920}
                height={384}
                className="footer-logo h-10 w-auto"
              />
            </span>
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-[#c9cfdb]">
              Reliable software engineering for enterprises — web, mobile,
              cloud, AI, cybersecurity, and quality engineering. India-based,
              globally delivered.
            </p>

            <div className="mt-6">
              <FooterHeading dot>Stay Updated</FooterHeading>
            </div>
            {subscribed ? (
              <p className="mt-3 text-[12.5px] font-semibold text-[#2f8fe0]">
                You&apos;re subscribed — thank you!
              </p>
            ) : (
              <form
                onSubmit={handleSubscribe}
                className="footer-form mt-3 flex w-full max-w-xs items-stretch overflow-hidden rounded-lg border border-white/15"
              >
                <input
                  type="email"
                  required
                  placeholder="you@company.com"
                  className="h-11 min-w-0 flex-1 bg-white/[0.05] px-3.5 text-[12.5px] text-white placeholder:text-[#8b93a3] outline-none"
                />
                <button
                  type="submit"
                  className="flex shrink-0 items-center gap-1.5 bg-[#2f8fe0] px-4 text-[12px] font-bold tracking-wide text-white transition-colors duration-200 hover:bg-[#2478c4]"
                >
                  SUBSCRIBE
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </form>
            )}
          </div>

          <nav aria-label="Company">
            <FooterHeading>Company</FooterHeading>
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              {COMPANY_LINKS.map((link) => (
                <li key={link.href}>
                  <FooterLink href={link.href}>{link.label}</FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Services">
            <FooterHeading>Services</FooterHeading>
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              {SERVICE_LINKS.map((link) => (
                <li key={link.href}>
                  <FooterLink href={link.href}>{link.label}</FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <FooterHeading>Get in Touch</FooterHeading>
            <ul className="mt-4 space-y-3 text-[13.5px] text-[#c9cfdb]">
              <li>
                <a
                  href="mailto:info@zyllotech.com"
                  className="group flex items-start gap-2.5 transition-all duration-200 hover:translate-x-1 hover:text-white"
                >
                  <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f96706]" aria-hidden="true" />
                  <span className="break-all">info@zyllotech.com</span>
                </a>
              </li>
              <li>
                <a
                  href="tel:+917075773680"
                  className="group flex items-start gap-2.5 transition-all duration-200 hover:translate-x-1 hover:text-white"
                >
                  <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f96706]" aria-hidden="true" />
                  <span>+91 70757 73680</span>
                </a>
              </li>
              <li className="group flex items-start gap-2.5 transition-transform duration-200 hover:translate-x-1">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f96706]" aria-hidden="true" />
                <span className="transition-colors duration-200 group-hover:text-white">India</span>
              </li>
            </ul>

            <div className="mt-6">
              <FooterHeading>Follow Us</FooterHeading>
            </div>
            <ul className="mt-3 flex items-center gap-2.5">
              {SOCIAL_LINKS.map((social) => (
                <li key={social.label}>
                  <a
                    href={social.href}
                    aria-label={social.label}
                    target={social.href.startsWith("http") ? "_blank" : undefined}
                    rel={social.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="footer-social flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-white/70 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.12] hover:text-white"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d={social.path} />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <p className="text-[12.5px] text-[#c9cfdb]">
              © {year} Zyllo Tech Software Solutions Pvt. Ltd. All rights
              reserved.
            </p>
            <span className="footer-cert group inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1">
              <Sparkles className="h-3 w-3 text-[#f96706]" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-[#c9cfdb]">
                DPIIT-Recognized — Startup India
              </span>
            </span>
          </div>
          <ul className="flex items-center gap-6 text-[12.5px] text-[#c9cfdb]">
            <li>
              <button
                type="button"
                onClick={() => setOpenLegal("privacy")}
                className="transition-colors duration-200 hover:text-white"
              >
                Privacy Policy
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => setOpenLegal("terms")}
                className="transition-colors duration-200 hover:text-white"
              >
                Terms &amp; Conditions
              </button>
            </li>
            <li>
              <Link
                href="/sitemap"
                className="transition-colors duration-200 hover:text-white"
              >
                Sitemap
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <LegalModal
        isOpen={openLegal === "privacy"}
        onClose={() => setOpenLegal(null)}
        title="Privacy & Cookie Policy"
        lastUpdated={PRIVACY_LAST_UPDATED}
        sections={PRIVACY_SECTIONS}
      />
      <LegalModal
        isOpen={openLegal === "terms"}
        onClose={() => setOpenLegal(null)}
        title="Terms & Conditions"
        lastUpdated={TERMS_LAST_UPDATED}
        sections={TERMS_SECTIONS}
      />

      <style jsx>{`
        .footer-brand {
          transition: transform 0.3s ease;
        }
        .footer-brand:hover {
          transform: translateY(-2px);
        }
        .footer-logo {
          animation: footerLogoBreathe 4s ease-in-out infinite;
          transition: filter 0.3s ease;
        }
        .footer-brand:hover .footer-logo {
          animation: none;
          filter: drop-shadow(0 8px 18px rgba(48, 137, 166, 0.45));
        }
        @keyframes footerLogoBreathe {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.015);
          }
        }
        .footer-form:focus-within {
          border-color: rgba(47, 143, 224, 0.6);
        }
        .footer-dot {
          box-shadow: 0 0 8px rgba(47, 143, 224, 0.85);
          animation: footerDotPulse 1.8s ease-in-out infinite;
        }
        @keyframes footerDotPulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(1.4);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .footer-logo,
          .footer-dot {
            animation: none !important;
          }
          .footer-brand,
          .footer-social {
            transition: none !important;
          }
        }
      `}</style>
    </footer>
  );
}

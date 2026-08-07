"use client";

import { Mail, MapPin, Phone } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const COMPANY_LINKS = [
  { href: "/about", label: "About" },
  { href: "/careers", label: "Careers" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
];

const EXPLORE_LINKS = [
  { href: "/services", label: "Services" },
  { href: "/industries", label: "Industries" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/", label: "Home" },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
];

const SOCIAL_LINKS = [
  {
    href: "#",
    label: "LinkedIn",
    path: "M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z",
  },
  {
    href: "#",
    label: "X (Twitter)",
    path: "M18.24 3H21l-6.55 7.49L22.2 21h-6.16l-4.83-6.32L5.64 21H2.87l7.01-8.02L2 3h6.32l4.37 5.78L18.24 3zm-1.08 16.2h1.71L7.02 4.7H5.18l11.98 14.5z",
  },
  {
    href: "#",
    label: "GitHub",
    path: "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.03a9.4 9.4 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.37.2 2.39.1 2.64.64.7 1.03 1.6 1.03 2.69 0 3.85-2.35 4.7-4.58 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z",
  },
  {
    href: "#",
    label: "Instagram",
    path: "M12 2c-2.716 0-3.056.012-4.123.06-1.064.049-1.791.218-2.427.465a4.902 4.902 0 0 0-1.771 1.153A4.902 4.902 0 0 0 2.526 5.45c-.247.636-.416 1.363-.465 2.427C2.012 8.944 2 9.284 2 12s.012 3.056.06 4.123c.049 1.064.218 1.791.465 2.427a4.902 4.902 0 0 0 1.153 1.771 4.902 4.902 0 0 0 1.771 1.153c.636.247 1.363.416 2.427.465C8.944 21.988 9.284 22 12 22s3.056-.012 4.123-.06c1.064-.049 1.791-.218 2.427-.465a4.902 4.902 0 0 0 1.771-1.153 4.902 4.902 0 0 0 1.153-1.771c.247-.636.416-1.363.465-2.427.048-1.067.06-1.407.06-4.123s-.012-3.056-.06-4.123c-.049-1.064-.218-1.791-.465-2.427a4.902 4.902 0 0 0-1.153-1.771A4.902 4.902 0 0 0 18.55 2.526c-.636-.247-1.363-.416-2.427-.465C15.056 2.012 14.716 2 12 2zm0 1.802c2.67 0 2.987.01 4.042.059.976.045 1.505.207 1.858.344.467.181.8.398 1.15.748.35.35.566.683.747 1.15.137.353.3.882.344 1.858.05 1.055.06 1.372.06 4.042s-.01 2.987-.06 4.042c-.045.976-.207 1.505-.344 1.858a3.1 3.1 0 0 1-.747 1.15c-.35.35-.683.566-1.15.747-.353.137-.882.3-1.858.344-1.054.05-1.371.06-4.042.06s-2.988-.01-4.042-.06c-.976-.045-1.505-.207-1.858-.344a3.1 3.1 0 0 1-1.15-.747 3.1 3.1 0 0 1-.748-1.15c-.137-.353-.3-.882-.344-1.858-.048-1.055-.059-1.372-.059-4.042s.011-2.987.06-4.042c.043-.976.206-1.505.343-1.858.181-.467.398-.8.748-1.15.35-.35.683-.567 1.15-.748.353-.137.882-.3 1.858-.344 1.055-.048 1.372-.059 4.042-.059zm0 3.064a5.135 5.135 0 1 0 0 10.27 5.135 5.135 0 0 0 0-10.27zm0 8.468a3.333 3.333 0 1 1 0-6.666 3.333 3.333 0 0 1 0 6.666zm6.538-8.671a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0z",
  },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-[#1c2333] text-neutral-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/4 h-80 w-80 rounded-full bg-[#f7941e] opacity-[0.1] blur-[120px]" />
        <div className="absolute -bottom-32 right-1/4 h-80 w-80 rounded-full bg-[#1f4693] opacity-[0.18] blur-[120px]" />
      </div>
      <div className="relative mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <div className="grid grid-cols-1 gap-y-10 sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-[1.3fr_1fr_1fr_1fr] lg:gap-x-8">
          <div>
            <div className="-ml-3 inline-flex items-center rounded-lg bg-white px-4 py-3">
              <Image
                src="/zyllo-logo.png"
                alt="Zyllo Tech"
                width={180}
                height={36}
                className="h-16 w-auto"
              />
            </div>
            <p className="mt-3 max-w-xs text-base leading-relaxed text-neutral-300">
              Transforming Ideas into Powerful Digital Solutions
            </p>
            <ul className="mt-4 flex items-center gap-4">
              {SOCIAL_LINKS.map((social) => (
                <li key={social.label}>
                  <a
                    href={social.href}
                    aria-label={social.label}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-neutral-300 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-[#f7941e]/30 hover:bg-white/10 hover:text-[#f7941e]"
                  >
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d={social.path} />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <nav aria-label="Company">
            <h3 className="relative inline-block pb-3 text-base font-semibold text-white after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-8 after:rounded-full after:bg-[#f7941e]">
              Company
            </h3>
            <ul className="mt-3 space-y-2.5 text-base">
              {COMPANY_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-block text-neutral-300 transition-all duration-200 hover:translate-x-1 hover:text-[#f7941e]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Explore">
            <h3 className="relative inline-block pb-3 text-base font-semibold text-white after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-8 after:rounded-full after:bg-[#f7941e]">
              Explore
            </h3>
            <ul className="mt-3 space-y-2.5 text-base">
              {EXPLORE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-block text-neutral-300 transition-all duration-200 hover:translate-x-1 hover:text-[#f7941e]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h3 className="relative inline-block pb-3 text-base font-semibold text-white after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-8 after:rounded-full after:bg-[#f7941e]">
              Contact Us
            </h3>
            <div className="mt-3 flex flex-col gap-3 text-base text-neutral-300">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-[#f7941e]/10 to-[#1f4693]/10 backdrop-blur-md">
                  <Mail className="h-4 w-4 text-[#f7941e]" aria-hidden="true" />
                </span>
                <span>info@zyllotech.com</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-[#f7941e]/10 to-[#1f4693]/10 backdrop-blur-md">
                  <Phone className="h-4 w-4 text-[#f7941e]" aria-hidden="true" />
                </span>
                <span>+91 70757 73680</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-[#f7941e]/10 to-[#1f4693]/10 backdrop-blur-md">
                  <MapPin className="h-4 w-4 text-[#f7941e]" aria-hidden="true" />
                </span>
                <span>India</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row">
          <p className="text-sm text-neutral-400">
            © {year} Zyllo Tech. All rights reserved.
          </p>
          <ul className="flex items-center gap-6 text-sm text-neutral-400">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="underline decoration-transparent underline-offset-4 transition-all duration-200 hover:text-[#f7941e] hover:decoration-[#f7941e]/50"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

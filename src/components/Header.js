"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/services", label: "Services" },
  { href: "/industries", label: "Industries" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
];

const UTILITY_LINKS = [
  { href: "/careers", label: "Careers" },
  { href: "/login", label: "Login" },
];

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 bg-white/95 backdrop-blur transition-shadow duration-200 ${
        isScrolled ? "shadow-md" : "shadow-none"
      }`}
    >
      <div className="hidden border-b border-[#e7e9ee] lg:block">
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-6 px-6 py-2.5 text-sm font-semibold text-[#676b7a] lg:px-8">
          {UTILITY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-[#f7941e]"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-8 px-6 lg:px-8">
        <Link
          href="/"
          className="-ml-6 flex shrink-0 items-center sm:-ml-8"
          aria-label="Zyllo Tech home"
        >
          <Image
            src="/zyllo-logo.png"
            alt="Zyllo Tech"
            width={220}
            height={44}
            priority
            className="h-10 w-auto sm:h-11"
          />
        </Link>

        <div className="hidden flex-1 items-center justify-end gap-8 lg:flex">
          <nav aria-label="Primary">
            <ul className="flex items-center gap-8 text-sm font-medium text-[#2b303b]">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="transition-colors hover:text-[#f7941e]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <Link
            href="/contact"
            className="shrink-0 rounded-lg bg-[#f7941e] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#db7d17] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f7941e]"
          >
            Contact Us
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-[#2b303b] hover:bg-neutral-100 lg:hidden"
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={isMenuOpen}
          aria-controls="mobile-menu"
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.75}
            stroke="currentColor"
            aria-hidden="true"
          >
            {isMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
              />
            )}
          </svg>
        </button>
      </div>

      {isMenuOpen && (
        <nav
          id="mobile-menu"
          aria-label="Mobile"
          className="border-t border-neutral-200 bg-white px-6 py-4 lg:hidden"
        >
          <ul className="flex flex-col gap-1 text-sm font-medium text-[#2b303b]">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="block rounded-md px-3 py-2.5 transition-colors hover:bg-neutral-100 hover:text-[#f7941e]"
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-2 flex flex-col gap-1 border-t border-neutral-200 pt-2 text-sm font-medium text-[#676b7a]">
            {UTILITY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block rounded-md px-3 py-2.5 transition-colors hover:bg-neutral-100 hover:text-[#f7941e]"
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <Link
            href="/contact"
            className="mt-4 block rounded-lg bg-[#f7941e] px-5 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#db7d17]"
            onClick={() => setIsMenuOpen(false)}
          >
            Contact Us
          </Link>
        </nav>
      )}
    </header>
  );
}

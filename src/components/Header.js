"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ArrowRight, Sparkles } from "lucide-react";
import { SERVICES } from "@/data/services";
import { SERVICE_THEMES } from "@/sections/ServiceGrid";

const DEFAULT_SERVICE_THEME = SERVICE_THEMES["web-development"];

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/industries", label: "Industries" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact Us" },
];

const UTILITY_LINKS = [
  { href: "/careers", label: "Careers" },
  { href: "/login", label: "Login" },
];

export default function Header() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isServicesOpen, setIsServicesOpen] = useState(false);
  const [isMobileServicesOpen, setIsMobileServicesOpen] = useState(false);
  const closeTimeoutRef = useRef(null);

  function isActive(href) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const isServicesActive = pathname === "/services" || pathname.startsWith("/services/");

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  function openServicesMenu() {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setIsServicesOpen(true);
  }

  function scheduleCloseServicesMenu() {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => setIsServicesOpen(false), 150);
  }

  return (
    <header className="sticky top-0 z-50 transition-all duration-300">
      <div
        className={`hidden w-full items-center justify-end gap-6 border-b px-6 py-2.5 text-sm font-semibold backdrop-blur-xl transition-all duration-300 lg:flex lg:px-8 ${
          isHome
            ? "border-[#f7941e]/15 bg-[#fff7ed]/60 text-[#676b7a]"
            : "border-[#e5d9c3] bg-[#faf6ef] text-[#676b7a]"
        }`}
      >
        {UTILITY_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`transition-colors duration-200 hover:text-[#f7941e] ${
              isActive(link.href) ? "text-[#f7941e]" : ""
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>

      <div
        className={`relative flex w-full items-center justify-between gap-8 border-b px-6 backdrop-blur-xl transition-all duration-300 lg:px-8 ${
          isHome
            ? "border-[#f7941e]/20 bg-gradient-to-r from-[#fff7ed]/80 via-white/70 to-[#eff4fc]/80"
            : "border-[#e5d9c3] bg-gradient-to-r from-[#faf6ef] via-white to-[#f5efe4]"
        } ${isScrolled ? "h-16 shadow-lg shadow-[#f7941e]/10" : "h-20 shadow-sm"}`}
      >
        {isHome && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#f7941e] to-transparent opacity-50"
          />
        )}
        <Link
          href="/"
          className="flex shrink-0 items-center"
          aria-label="Zyllo Tech home"
        >
          <Image
            src="/zyllo-logo.png"
            alt="Zyllo Tech"
            width={280}
            height={56}
            priority
            className="h-14 w-auto sm:h-16"
          />
        </Link>

        <div className="hidden flex-1 items-center justify-end gap-8 lg:flex">
          <nav aria-label="Primary">
            <ul className="flex items-center gap-8 text-sm font-medium text-[#2b303b]">
              {NAV_LINKS.slice(0, 2).map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`group relative inline-block pb-1 transition-colors duration-200 hover:text-[#f7941e] ${
                      isActive(link.href) ? "text-[#f7941e]" : ""
                    }`}
                  >
                    {link.label}
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-0 left-0 h-0.5 rounded-full bg-[#f7941e] transition-all duration-300 ease-out ${
                        isActive(link.href) ? "w-full" : "w-0 group-hover:w-full"
                      }`}
                    />
                  </Link>
                </li>
              ))}

              <li
                className="relative"
                onMouseEnter={openServicesMenu}
                onMouseLeave={scheduleCloseServicesMenu}
              >
                <button
                  type="button"
                  onFocus={openServicesMenu}
                  aria-expanded={isServicesOpen}
                  aria-haspopup="true"
                  className={`group relative inline-flex items-center gap-1 pb-1 transition-colors duration-200 hover:text-[#f7941e] ${
                    isServicesActive || isServicesOpen ? "text-[#f7941e]" : ""
                  }`}
                >
                  Services
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${isServicesOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-0 left-0 h-0.5 rounded-full bg-[#f7941e] transition-all duration-300 ease-out ${
                      isServicesActive || isServicesOpen ? "w-full" : "w-0 group-hover:w-full"
                    }`}
                  />
                </button>

                {isServicesOpen && (
                  <div className="services-dropdown absolute left-0 top-full z-50 mt-3 w-[620px] overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-2xl shadow-black/10">
                    <div className="grid grid-cols-2 gap-3 p-4">
                      {SERVICES.map(({ slug, title, tagline, icon: Icon }) => {
                        const theme = SERVICE_THEMES[slug] ?? DEFAULT_SERVICE_THEME;
                        return (
                          <Link
                            key={slug}
                            href={`/services/${slug}`}
                            onClick={() => setIsServicesOpen(false)}
                            className="group flex items-start gap-3 rounded-xl border border-[#e7e9ee] p-3 transition-all duration-200 hover:border-[#f7941e]/40 hover:bg-[#fafbfc] hover:shadow-sm"
                          >
                            <span
                              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white shadow-sm transition-transform duration-200 group-hover:scale-110 ${theme.badge}`}
                            >
                              <Icon className="h-5 w-5" aria-hidden="true" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold leading-snug text-[#2b303b] group-hover:text-[#f7941e]">
                                {title}
                              </span>
                              <span className="mt-0.5 block text-xs leading-snug text-[#676b7a]">
                                {tagline}
                              </span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>

                    <Link
                      href="/services"
                      onClick={() => setIsServicesOpen(false)}
                      className="flex items-center justify-center gap-1.5 border-t border-[#e7e9ee] bg-[#fafbfc] px-4 py-3.5 text-sm font-semibold text-[#f7941e] transition-colors duration-200 hover:bg-[#1f4693]/10 hover:text-[#1f4693]"
                    >
                      View all services
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                )}
              </li>

              <li>
                <Link
                  href="/arthaai"
                  className="group relative inline-flex items-center gap-1.5 pb-1 transition-colors duration-200 hover:text-[#f7941e]"
                >
                  <Sparkles className="h-4 w-4 text-[#f7941e]" aria-hidden="true" />
                  ArthaAI
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 h-0.5 w-0 rounded-full bg-[#f7941e] transition-all duration-300 ease-out group-hover:w-full"
                  />
                </Link>
              </li>

              {NAV_LINKS.slice(2, 5).map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`group relative inline-block pb-1 transition-colors duration-200 hover:text-[#f7941e] ${
                      isActive(link.href) ? "text-[#f7941e]" : ""
                    }`}
                  >
                    {link.label}
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-0 left-0 h-0.5 rounded-full bg-[#f7941e] transition-all duration-300 ease-out ${
                        isActive(link.href) ? "w-full" : "w-0 group-hover:w-full"
                      }`}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <Link
            href="/contact"
            className="group inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_-4px_rgba(247,148,30,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-4px_rgba(31,70,147,0.55)]"
          >
            {NAV_LINKS[5].label}
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-[#2b303b] transition-colors duration-200 hover:bg-neutral-100 lg:hidden"
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
          <div className="mb-2 flex items-center gap-6 border-b border-neutral-200 pb-3 text-sm font-semibold text-[#676b7a]">
            {UTILITY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`transition-colors hover:text-[#f7941e] ${
                  isActive(link.href) ? "text-[#f7941e]" : ""
                }`}
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <ul className="flex flex-col gap-1 text-sm font-medium text-[#2b303b]">
            {NAV_LINKS.slice(0, 2).map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`block rounded-md px-3 py-2.5 transition-colors hover:bg-neutral-100 hover:text-[#f7941e] ${
                    isActive(link.href) ? "bg-[#f7941e]/10 text-[#f7941e]" : ""
                  }`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}

            <li>
              <button
                type="button"
                onClick={() => setIsMobileServicesOpen((open) => !open)}
                aria-expanded={isMobileServicesOpen}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left transition-colors hover:bg-neutral-100 hover:text-[#f7941e] ${
                  isServicesActive ? "bg-[#f7941e]/10 text-[#f7941e]" : ""
                }`}
              >
                Services
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${isMobileServicesOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              {isMobileServicesOpen && (
                <div className="ml-2 mt-1 flex flex-col gap-0.5 border-l border-neutral-200 pl-3">
                  {SERVICES.map(({ slug, title, icon: Icon }) => {
                    const theme = SERVICE_THEMES[slug] ?? DEFAULT_SERVICE_THEME;
                    return (
                      <Link
                        key={slug}
                        href={`/services/${slug}`}
                        onClick={() => {
                          setIsMenuOpen(false);
                          setIsMobileServicesOpen(false);
                        }}
                        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-[#676b7a] transition-colors hover:bg-neutral-100 hover:text-[#f7941e]"
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white ${theme.badge}`}
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        {title}
                      </Link>
                    );
                  })}
                  <Link
                    href="/services"
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsMobileServicesOpen(false);
                    }}
                    className="rounded-md px-3 py-2 text-sm font-semibold text-[#f7941e] transition-colors hover:bg-[#f7941e]/10"
                  >
                    View all services
                  </Link>
                </div>
              )}
            </li>

            <li>
              <Link
                href="/arthaai"
                className="flex items-center gap-2 rounded-md px-3 py-2.5 transition-colors hover:bg-neutral-100 hover:text-[#f7941e]"
                onClick={() => setIsMenuOpen(false)}
              >
                <Sparkles className="h-4 w-4 text-[#f7941e]" aria-hidden="true" />
                ArthaAI
              </Link>
            </li>

            {NAV_LINKS.slice(2).map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`block rounded-md px-3 py-2.5 transition-colors hover:bg-neutral-100 hover:text-[#f7941e] ${
                    isActive(link.href) ? "bg-[#f7941e]/10 text-[#f7941e]" : ""
                  }`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <style jsx>{`
        @keyframes dropdownFadeIn {
          from {
            opacity: 0;
            transform: translate(-50%, -6px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
        .services-dropdown {
          animation: dropdownFadeIn 0.18s ease-out both;
        }
      `}</style>
    </header>
  );
}

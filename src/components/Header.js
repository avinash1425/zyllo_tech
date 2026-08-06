"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ArrowRight } from "lucide-react";
import { SERVICES } from "@/data/services";

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
    <header className={`sticky top-0 z-50 transition-all duration-300 ${isScrolled ? "pt-3" : "pt-0"}`}>
      <div
        className={`mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 transition-all duration-300 lg:px-8 ${
          isScrolled
            ? "h-16 rounded-full border border-[#e7e9ee] bg-white/95 shadow-lg shadow-black/5 backdrop-blur-md"
            : "h-20 bg-white/95 backdrop-blur"
        }`}
      >
        <Link
          href="/"
          className="flex shrink-0 items-center"
          aria-label="Zyllo Tech home"
        >
          <Image
            src="/zyllo-logo.png"
            alt="Zyllo Tech"
            width={220}
            height={44}
            priority
            className="h-9 w-auto sm:h-10"
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
                  <div className="services-dropdown absolute left-1/2 top-full z-50 mt-3 w-[560px] -translate-x-1/2 overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-3 shadow-2xl shadow-black/10">
                    <div className="grid grid-cols-2 gap-1">
                      {SERVICES.map(({ slug, title, icon: Icon }) => (
                        <Link
                          key={slug}
                          href={`/services/${slug}`}
                          onClick={() => setIsServicesOpen(false)}
                          className="group flex items-center gap-3 rounded-xl p-3 transition-colors duration-200 hover:bg-[#fafbfc]"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15 transition-transform duration-200 group-hover:scale-110">
                            <Icon className="h-4.5 w-4.5 text-[#f7941e]" aria-hidden="true" />
                          </span>
                          <span className="text-sm font-medium text-[#2b303b] group-hover:text-[#f7941e]">
                            {title}
                          </span>
                        </Link>
                      ))}
                    </div>

                    <Link
                      href="/services"
                      onClick={() => setIsServicesOpen(false)}
                      className="mt-2 flex items-center justify-center rounded-xl bg-[#fafbfc] p-3 text-sm font-semibold text-[#f7941e] transition-colors duration-200 hover:bg-[#f7941e]/10"
                    >
                      View all services
                    </Link>
                  </div>
                )}
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

              {UTILITY_LINKS.map((link) => (
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
            className="group inline-flex items-center gap-1.5 rounded-full bg-[#1f4693] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1a3a7d] hover:shadow-md hover:shadow-[#1f4693]/25"
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
                  {SERVICES.map(({ slug, title, icon: Icon }) => (
                    <Link
                      key={slug}
                      href={`/services/${slug}`}
                      onClick={() => {
                        setIsMenuOpen(false);
                        setIsMobileServicesOpen(false);
                      }}
                      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-[#676b7a] transition-colors hover:bg-neutral-100 hover:text-[#f7941e]"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-[#f7941e]" aria-hidden="true" />
                      {title}
                    </Link>
                  ))}
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

          <div className="mt-2 flex flex-col gap-1 border-t border-neutral-200 pt-2 text-sm font-medium text-[#676b7a]">
            {UTILITY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`block rounded-md px-3 py-2.5 transition-colors hover:bg-neutral-100 hover:text-[#f7941e] ${
                  isActive(link.href) ? "bg-[#f7941e]/10 text-[#f7941e]" : ""
                }`}
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>
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

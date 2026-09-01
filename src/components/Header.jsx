import { CompatImage as Image } from "@/components/NextCompat";
import { CompatLink as Link } from "@/components/NextCompat";
import { usePathname } from "@/components/NextCompat";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ArrowRight } from "lucide-react";
import { SERVICES } from "@/data/services";
import { SERVICE_THEMES } from "@/sections/ServiceGrid";
import AISearchBar from "@/components/AISearchBar";

const DEFAULT_SERVICE_THEME = SERVICE_THEMES["web-development"];

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/industries", label: "Industries" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/blog", label: "Blog" },
];

const UTILITY_LINKS = [
  { href: "/careers", label: "Careers" },
  { href: "/contact", label: "Contact Us" },
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
    <header className="relative z-50">
      {/* Utility bar scrolls away with the page — only the nav row below stays pinned. */}
      <div className="hidden w-full border-b border-[#e2e5ea] bg-[#f3f4f6] text-[#57606f] backdrop-blur-xl transition-all duration-300 lg:flex">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-end gap-5 px-6 py-2.5 text-[12.5px] font-semibold lg:px-8">
          <Link
            href="/careers"
            className={`group relative inline-block pb-0.5 transition-colors duration-200 ease-out hover:text-[#c2410c] ${
              isActive("/careers") ? "text-[#c2410c]" : ""
            }`}
          >
            Careers
            <span
              aria-hidden="true"
              className={`absolute -bottom-0.5 left-0 h-px rounded-full bg-[#f96706] transition-all duration-300 ease-out ${
                isActive("/careers") ? "w-full" : "w-0 group-hover:w-full"
              }`}
            />
          </Link>

          <Link
            href="/contact"
            className={`group relative inline-block pb-0.5 transition-colors duration-200 ease-out hover:text-[#c2410c] ${
              isActive("/contact") ? "text-[#c2410c]" : ""
            }`}
          >
            Contact Us
            <span
              aria-hidden="true"
              className={`absolute -bottom-0.5 left-0 h-px rounded-full bg-[#f96706] transition-all duration-300 ease-out ${
                isActive("/contact") ? "w-full" : "w-0 group-hover:w-full"
              }`}
            />
          </Link>

          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#f96706]/30 bg-white px-3.5 py-1 text-[#c2410c] shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-transparent hover:bg-gradient-to-r hover:from-[#f96706] hover:to-[#3089a6] hover:text-white hover:shadow-md hover:shadow-[#f96706]/20"
          >
            Login
          </Link>
        </div>
      </div>

      <div
        className={`sticky top-0 z-50 w-full border-b border-[#e2e5ea] bg-white backdrop-blur-xl transition-all duration-300 h-16 ${
          isScrolled ? "shadow-lg shadow-[#f96706]/10" : "shadow-sm"
        }`}
      >
        {isHome && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#f96706] to-transparent opacity-50"
          />
        )}
        <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between gap-8 px-6 lg:px-8">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2 transition-transform duration-300 ease-out hover:scale-[1.03]"
          aria-label="Zyllo Tech home"
        >
          <Image
            src="/zyllo-logo-nav.png"
            alt="Zyllo Tech Software Solutions Private Limited"
            width={400}
            height={80}
            priority
            className="h-9 w-auto transition-all duration-300 sm:h-10"
          />
        </Link>

        <div className="hidden flex-1 items-center justify-end gap-8 lg:flex">
          <nav aria-label="Primary">
            <ul className="flex items-center gap-8 text-[14.5px] font-semibold text-[#1d2735]">
              {NAV_LINKS.slice(0, 2).map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`group relative inline-block pb-1 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:text-[#c2410c] ${
                      isActive(link.href) ? "text-[#c2410c]" : ""
                    }`}
                  >
                    {link.label}
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-0 left-0 h-0.5 rounded-full bg-gradient-to-r from-[#f96706] to-[#3089a6] transition-all duration-300 ease-out ${
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
                  className={`group relative inline-flex items-center gap-1 pb-1 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:text-[#c2410c] ${
                    isServicesActive || isServicesOpen ? "text-[#c2410c]" : ""
                  }`}
                >
                  Services
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${isServicesOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-0 left-0 h-0.5 rounded-full bg-gradient-to-r from-[#f96706] to-[#3089a6] transition-all duration-300 ease-out ${
                      isServicesActive || isServicesOpen ? "w-full" : "w-0 group-hover:w-full"
                    }`}
                  />
                </button>

                {isServicesOpen && (
                  <div className="services-dropdown absolute left-1/2 top-full z-50 mt-3 w-[min(620px,calc(100vw-3rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-[#d9dde2] bg-white shadow-2xl shadow-black/10">
                    <div className="grid grid-cols-2 gap-3 p-4">
                      {SERVICES.map(({ slug, title, tagline, icon: Icon }) => {
                        const theme = SERVICE_THEMES[slug] ?? DEFAULT_SERVICE_THEME;
                        return (
                          <Link
                            key={slug}
                            href={`/services/${slug}`}
                            onClick={() => setIsServicesOpen(false)}
                            className="group flex items-start gap-3 rounded-xl border border-[#d9dde2] p-3 transition-all duration-200 hover:border-[#f96706]/40 hover:bg-[#fafbfc] hover:shadow-sm"
                          >
                            <span
                              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white shadow-sm transition-transform duration-200 group-hover:scale-110 ${theme.badge}`}
                            >
                              <Icon className="h-5 w-5" aria-hidden="true" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold leading-snug text-[#1d2735] group-hover:text-[#c2410c]">
                                {title}
                              </span>
                              <span className="mt-0.5 block text-xs leading-snug text-[#6c7889]">
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
                      className="flex items-center justify-center gap-1.5 border-t border-[#d9dde2] bg-[#fafbfc] px-4 py-3.5 text-sm font-semibold text-[#c2410c] transition-colors duration-200 hover:bg-[#1c2f4a]/10 hover:text-[#1c2f4a]"
                    >
                      View all services
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                )}
              </li>

              {NAV_LINKS.slice(2, 5).map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`group relative inline-block pb-1 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:text-[#c2410c] ${
                      isActive(link.href) ? "text-[#c2410c]" : ""
                    }`}
                  >
                    {link.label}
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-0 left-0 h-0.5 rounded-full bg-gradient-to-r from-[#f96706] to-[#3089a6] transition-all duration-300 ease-out ${
                        isActive(link.href) ? "w-full" : "w-0 group-hover:w-full"
                      }`}
                    />
                  </Link>
                </li>
              ))}

              <li className="relative flex items-center">
                <AISearchBar />
              </li>
            </ul>
          </nav>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-3 text-[#1d2735] transition-colors duration-200 hover:bg-neutral-100 lg:hidden"
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
      </div>

      {isMenuOpen && (
        <nav
          id="mobile-menu"
          aria-label="Mobile"
          className="mobile-menu-in border-t border-neutral-200 bg-white px-6 py-4 lg:hidden"
        >
          <div className="mb-2 flex items-center gap-6 border-b border-neutral-200 pb-3 text-sm font-semibold text-[#6c7889]">
            {UTILITY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`transition-colors hover:text-[#c2410c] ${
                  isActive(link.href) ? "text-[#c2410c]" : ""
                }`}
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <ul className="flex flex-col gap-1 text-sm font-medium text-[#1d2735]">
            {NAV_LINKS.slice(0, 2).map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`block rounded-md px-3 py-2.5 transition-all duration-200 ease-out hover:translate-x-1 hover:bg-neutral-100 hover:text-[#c2410c] ${
                    isActive(link.href) ? "bg-[#f96706]/10 text-[#c2410c]" : ""
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
                className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left transition-colors hover:bg-neutral-100 hover:text-[#c2410c] ${
                  isServicesActive ? "bg-[#f96706]/10 text-[#c2410c]" : ""
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
                        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-[#6c7889] transition-colors hover:bg-neutral-100 hover:text-[#c2410c]"
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
                    className="rounded-md px-3 py-2 text-sm font-semibold text-[#c2410c] transition-colors hover:bg-[#f96706]/10"
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
                  className={`block rounded-md px-3 py-2.5 transition-all duration-200 ease-out hover:translate-x-1 hover:bg-neutral-100 hover:text-[#c2410c] ${
                    isActive(link.href) ? "bg-[#f96706]/10 text-[#c2410c]" : ""
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

      <style>{`
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
        @keyframes mobileMenuIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .mobile-menu-in {
          animation: mobileMenuIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
      `}</style>
    </header>
  );
}

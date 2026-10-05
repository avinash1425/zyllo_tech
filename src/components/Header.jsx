"use client";

import Image from "@/lib/nx/image";
import Link from "@/lib/nx/link";
import { usePathname } from "@/lib/nx/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ArrowRight } from "lucide-react";
import { SERVICES } from "@/data/services";
import { SERVICE_THEMES } from "@/sections/ServiceGrid";
import AISearchBar from "@/components/AISearchBar";
import AccountBar from "@/components/AccountBar";

const DEFAULT_SERVICE_THEME = SERVICE_THEMES["web-development"];

// Brand palette accents for the mega-menu medallions (orange / navy / teal).
const BRAND_ACCENTS = [
  "bg-gradient-to-br from-[#f96706] to-[#f7941e]",
  "bg-gradient-to-br from-[#1f4693] to-[#173a52]",
  "bg-gradient-to-br from-[#3089a6] to-[#1f4693]",
];

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/industries", label: "Industries" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/blog", label: "Blog" },
];

const MENU_MAX_W = 320;
const MENU_MARGIN = 16;

export default function Header() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isServicesOpen, setIsServicesOpen] = useState(false);
  const [isMobileServicesOpen, setIsMobileServicesOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: MENU_MARGIN, width: MENU_MAX_W, top: 104 });
  const closeTimeoutRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRef = useRef(null);
  const panelRef = useRef(null);
  const barRef = useRef(null);

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

  // Close everything on route change.
  useEffect(() => {
    setIsServicesOpen(false);
    setIsMenuOpen(false);
    setIsMobileServicesOpen(false);
  }, [pathname]);

  // Anchor the panel under the "Services" trigger, clamped to the viewport.
  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const vw = document.documentElement.clientWidth;
    const width = Math.min(MENU_MAX_W, vw - MENU_MARGIN * 2);
    const r = trigger.getBoundingClientRect();
    const center = r.left + r.width / 2;
    const left = Math.max(MENU_MARGIN, Math.min(center - width / 2, vw - MENU_MARGIN - width));
    const top = barRef.current ? barRef.current.getBoundingClientRect().bottom : 104;
    setMenuPos({ left, width, top });
  }, []);

  useLayoutEffect(() => {
    if (!isServicesOpen) return undefined;
    positionMenu();
    window.addEventListener("resize", positionMenu);
    return () => window.removeEventListener("resize", positionMenu);
  }, [isServicesOpen, positionMenu]);

  // Escape + click outside (desktop menu).
  useEffect(() => {
    if (!isServicesOpen) return undefined;
    function onKey(e) {
      if (e.key === "Escape") {
        setIsServicesOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onDown(e) {
      if (itemRef.current && !itemRef.current.contains(e.target)) setIsServicesOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [isServicesOpen]);

  // Mobile drawer: scroll lock, Escape, auto-close when growing to desktop.
  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e) {
      if (e.key === "Escape") setIsMenuOpen(false);
    }
    function onResize() {
      if (window.innerWidth >= 1024) setIsMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [isMenuOpen]);

  function openServicesMenu() {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setIsServicesOpen(true);
  }

  function scheduleCloseServicesMenu() {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => setIsServicesOpen(false), 180);
  }

  function focusables() {
    return Array.from(panelRef.current?.querySelectorAll("a[href]") ?? []);
  }

  function onTriggerKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsServicesOpen(true);
      requestAnimationFrame(() => requestAnimationFrame(() => focusables()[0]?.focus()));
    }
  }

  function onPanelKeyDown(e) {
    const items = focusables();
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    let next = null;
    if (e.key === "ArrowRight") next = i + 1;
    else if (e.key === "ArrowLeft") next = i - 1;
    else if (e.key === "ArrowDown") next = i + 1;
    else if (e.key === "ArrowUp") next = i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    if (next < 0) {
      triggerRef.current?.focus();
      return;
    }
    items[Math.min(next, items.length - 1)]?.focus();
  }

  const navLinkClass = (href) =>
    `group relative inline-block py-1 transition-colors duration-200 ease-out hover:text-[#f96706] ${
      isActive(href) ? "text-[#f96706]" : ""
    }`;
  const underline = (active) =>
    `absolute -bottom-0.5 left-0 h-[2px] rounded-full bg-gradient-to-r from-[#f96706] to-[#3089a6] transition-all duration-300 ease-out ${
      active ? "w-full" : "w-0 group-hover:w-full"
    }`;
  const mobileRow =
    "flex min-h-12 w-full items-center rounded-xl px-4 text-[16px] font-semibold text-[#1d2735] transition-colors hover:bg-neutral-100 hover:text-[#f96706] active:bg-neutral-100";

  return (
    <header className="sticky top-0 z-50 transition-all duration-300">
      <div className="hidden w-full border-b border-[#eceef2] bg-[#f6f7f9] text-[#6c7889] lg:flex">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-end gap-2.5 px-6 py-1 text-[12.5px] font-medium lg:px-8">
          {[
            { href: "/careers", label: "Careers" },
            { href: "/contact", label: "Contact Us" },
          ].map((l, i) => (
            <Fragment key={l.href}>
              {i > 0 && <span aria-hidden="true" className="h-[3px] w-[3px] rounded-full bg-[#c4c9d1]" />}
            <Link
              href={l.href}
              className={`group relative inline-block pb-0.5 transition-colors duration-200 ease-out hover:text-[#f96706] ${
                isActive(l.href) ? "text-[#f96706]" : ""
              }`}
            >
              {l.label}
              <span
                aria-hidden="true"
                className={`absolute -bottom-0.5 left-0 h-px rounded-full bg-[#f96706] transition-all duration-300 ease-out ${
                  isActive(l.href) ? "w-full" : "w-0 group-hover:w-full"
                }`}
              />
            </Link>
            </Fragment>
          ))}

          <span aria-hidden="true" className="h-[3px] w-[3px] rounded-full bg-[#c4c9d1]" />
          <AccountBar />
        </div>
      </div>

      <div
        ref={barRef}
        className={`relative z-[2] h-[60px] w-full border-b border-[#e8eaee] bg-white transition-shadow duration-300 ${
          isScrolled || isMenuOpen ? "shadow-[0_6px_18px_-6px_rgba(23,58,82,0.16)]" : "shadow-none"
        }`}
      >
        {isHome && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#f96706] to-transparent opacity-50"
          />
        )}
        <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:gap-8 lg:px-8">
          <Link
            href="/"
            className="group flex shrink-0 items-center gap-2 transition-opacity duration-300 ease-out hover:opacity-90"
            aria-label="Zyllo Tech home"
          >
            <Image
              src="/zyllo-logo.png"
              alt="Zyllo Tech Software Solutions Private Limited"
              width={1920}
              height={384}
              priority
              className="h-8 w-auto sm:h-9"
            />
          </Link>

          <div className="hidden flex-1 items-center justify-end gap-8 lg:flex">
            <nav aria-label="Primary">
              <ul className="flex items-center gap-6 text-[14.5px] font-medium text-[#1d2735] xl:gap-9">
                {NAV_LINKS.slice(0, 2).map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={navLinkClass(link.href)}>
                      {link.label}
                      <span aria-hidden="true" className={underline(isActive(link.href))} />
                    </Link>
                  </li>
                ))}

                <li
                  ref={itemRef}
                  className={`relative ${
                    isServicesOpen
                      ? "after:absolute after:left-1/2 after:top-full after:h-8 after:w-40 after:-translate-x-1/2 after:content-['']"
                      : ""
                  }`}
                  onMouseEnter={openServicesMenu}
                  onMouseLeave={scheduleCloseServicesMenu}
                >
                  <button
                    ref={triggerRef}
                    type="button"
                    id="services-trigger"
                    onClick={() => setIsServicesOpen((o) => !o)}
                    onKeyDown={onTriggerKeyDown}
                    aria-expanded={isServicesOpen}
                    aria-haspopup="true"
                    aria-controls="services-menu"
                    className={`group relative inline-flex items-center gap-1 py-1 transition-colors duration-200 ease-out hover:text-[#f96706] ${
                      isServicesActive || isServicesOpen ? "text-[#f96706]" : ""
                    }`}
                  >
                    Services
                    <ChevronDown
                      className={`h-3.5 w-3.5 opacity-70 transition-transform duration-200 ${isServicesOpen ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                    <span aria-hidden="true" className={underline(isServicesActive || isServicesOpen)} />
                  </button>

                  {isServicesOpen && (
                    <div
                      id="services-menu"
                      ref={panelRef}
                      role="region"
                      aria-label="Our services"
                      onKeyDown={onPanelKeyDown}
                      onMouseEnter={openServicesMenu}
                      style={{
                        left: menuPos.left,
                        width: menuPos.width,
                        top: menuPos.top,
                        maxHeight: `calc(100vh - ${menuPos.top}px - 16px)`,
                      }}
                      className="zt-services-dropdown fixed z-50 overflow-y-auto overscroll-contain rounded-xl border border-[#e2e5ea] bg-white shadow-[0_12px_32px_-8px_rgba(23,58,82,0.22),0_2px_6px_rgba(23,58,82,0.06)]"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#f96706] to-[#3089a6]"
                      />
                      <div className="flex flex-col gap-px px-2 pb-1 pt-3">
                        {SERVICES.map(({ slug, title, icon: Icon }, idx) => (
                          <Link
                            key={slug}
                            href={`/services/${slug}`}
                            className="group flex h-9 min-w-0 items-center gap-2.5 rounded-lg px-2 transition-colors duration-150 hover:bg-[#fff7f0] focus-visible:bg-[#fff7f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f96706]/40"
                          >
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white transition-transform duration-200 group-hover:scale-110 ${BRAND_ACCENTS[idx % 3]}`}
                            >
                              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 truncate text-[13.5px] font-medium text-[#1d2735] group-hover:text-[#f96706]">
                              {title}
                            </span>
                          </Link>
                        ))}
                      </div>
                      <div className="border-t border-[#e2e5ea] px-4 py-2">
                        <Link
                          href="/services"
                          className="group inline-flex items-center gap-1 text-[13px] font-semibold text-[#f96706] transition-colors hover:text-[#1f4693] focus-visible:outline-none focus-visible:underline"
                        >
                          View all services
                          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  )}
                </li>

                {NAV_LINKS.slice(2).map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={navLinkClass(link.href)}>
                      {link.label}
                      <span aria-hidden="true" className={underline(isActive(link.href))} />
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
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#1d2735] transition-colors duration-200 hover:bg-neutral-100 lg:hidden"
            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden="true">
              {isMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile / tablet full-height drawer (always mounted for smooth open/close) */}
      <div
        className={`fixed inset-x-0 bottom-0 top-[60px] z-[1] lg:hidden ${
          isMenuOpen ? "visible" : "invisible delay-300"
        }`}
        aria-hidden={!isMenuOpen}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setIsMenuOpen(false)}
          className={`absolute inset-0 bg-[#0b1623]/50 transition-opacity duration-300 ${
            isMenuOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <nav
          id="mobile-menu"
          aria-label="Mobile"
          className={`relative flex max-h-full flex-col overflow-y-auto overscroll-contain bg-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] transition-all duration-300 ease-out ${
            isMenuOpen ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"
          }`}
          style={{ height: "100%", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <ul className="flex flex-col gap-1 px-3 pt-3">
            {NAV_LINKS.slice(0, 2).map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`${mobileRow} ${isActive(link.href) ? "bg-[#f96706]/10 text-[#f96706]" : ""}`}
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
                aria-controls="mobile-services"
                className={`${mobileRow} justify-between text-left ${
                  isServicesActive ? "bg-[#f96706]/10 text-[#f96706]" : ""
                }`}
              >
                Services
                <ChevronDown
                  className={`h-5 w-5 transition-transform duration-300 ${isMobileServicesOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              <div
                id="mobile-services"
                className={`grid transition-all duration-300 ease-out ${
                  isMobileServicesOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div
                    className="ml-4 mt-1 flex flex-col gap-0.5 border-l-2 border-[#f96706]/25 pl-2"
                    {...(!isMobileServicesOpen ? { inert: "" } : {})}
                  >
                    {SERVICES.map(({ slug, title, icon: Icon }) => {
                      const theme = SERVICE_THEMES[slug] ?? DEFAULT_SERVICE_THEME;
                      return (
                        <Link
                          key={slug}
                          href={`/services/${slug}`}
                          onClick={() => setIsMenuOpen(false)}
                          className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-[14px] font-medium text-[#44505f] transition-colors hover:bg-neutral-100 hover:text-[#f96706]"
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
                      onClick={() => setIsMenuOpen(false)}
                      className="flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-[14px] font-semibold text-[#f96706] transition-colors hover:bg-[#f96706]/10"
                    >
                      View all services
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            </li>

            {NAV_LINKS.slice(2).map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`${mobileRow} ${isActive(link.href) ? "bg-[#f96706]/10 text-[#f96706]" : ""}`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-auto px-3 pt-4">
            <div className="rounded-2xl border border-[#e2e5ea] bg-[#f6f7f9] p-3">
              <div className="grid grid-cols-2 gap-2 text-[15px] font-semibold text-[#44505f]">
                <Link
                  href="/careers"
                  onClick={() => setIsMenuOpen(false)}
                  className={`flex min-h-11 items-center justify-center rounded-xl bg-white transition-colors hover:text-[#f96706] ${
                    isActive("/careers") ? "text-[#f96706]" : ""
                  }`}
                >
                  Careers
                </Link>
                <Link
                  href="/contact"
                  onClick={() => setIsMenuOpen(false)}
                  className={`flex min-h-11 items-center justify-center rounded-xl bg-white transition-colors hover:text-[#f96706] ${
                    isActive("/contact") ? "text-[#f96706]" : ""
                  }`}
                >
                  Contact Us
                </Link>
              </div>
              <div className="mt-2 text-[15px] font-semibold text-[#44505f]">
                <AccountBar mobile onNavigate={() => setIsMenuOpen(false)} />
              </div>
            </div>
          </div>
        </nav>
      </div>

      <style>{`
        @keyframes ztDropdownFadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .zt-services-dropdown { animation: ztDropdownFadeIn 0.18s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .zt-services-dropdown { animation: none; }
        }
      `}</style>
    </header>
  );
}

"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const MIN_VISIBLE_MS = 450;

export default function PageTransition() {
  const pathname = usePathname();
  const [isVisible, setIsVisible] = useState(false);
  const isFirstRender = useRef(true);
  const hideTimeoutRef = useRef(null);
  const shownAtRef = useRef(0);

  // Show the overlay as soon as a navigation click happens.
  useEffect(() => {
    function handleClick(e) {
      const link = e.target.closest("a");
      if (!link) return;

      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      if (link.target === "_blank") return;

      // Strip any hash/query before comparing so same-page anchor links
      // (e.g. "/services#services-grid" while already on "/services")
      // don't trigger the overlay — pathname alone would never change,
      // leaving it stuck visible.
      const hrefPath = href.split("#")[0].split("?")[0] || "/";
      if (hrefPath === pathname) return;

      shownAtRef.current = Date.now();
      setIsVisible(true);
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [pathname]);

  // Once the new route has actually rendered (pathname changed), keep the
  // overlay up until the minimum display time has elapsed, then hide it.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);

    const elapsed = Date.now() - shownAtRef.current;
    const remaining = Math.max(MIN_VISIBLE_MS - elapsed, 0);

    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, remaining);

    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [pathname]);

  if (!isVisible) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b0e17]"
    >
      <div className="page-transition-logo flex flex-col items-center gap-4">
        <Image
          src="/zyllo-logo.png"
          alt=""
          width={220}
          height={44}
          className="h-11 w-auto"
          priority
        />
        <div className="h-0.5 w-32 overflow-hidden rounded-full bg-white/10">
          <div className="loading-bar h-full w-full rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693]" />
        </div>
      </div>

      <style jsx>{`
        .page-transition-logo {
          animation: pulseIn 0.4s ease-out;
        }
        @keyframes pulseIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .loading-bar {
          animation: loadingSlide 0.5s ease-in-out infinite;
          transform-origin: left;
        }
        @keyframes loadingSlide {
          0% {
            transform: scaleX(0);
            transform-origin: left;
          }
          50% {
            transform: scaleX(1);
            transform-origin: left;
          }
          51% {
            transform-origin: right;
          }
          100% {
            transform: scaleX(0);
            transform-origin: right;
          }
        }
      `}</style>
    </div>
  );
}
